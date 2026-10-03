// The Seeker app's SKR-paid tools pass — the client half (docs/SEEKER_SKR_PASS_DESIGN.md).
//
// Thin on purpose: the signing is src/seeker/sign.js's signSendConfirm (the connected wallet signs,
// no other signer), the instructions come from window.splToken (the byte-verified shim
// public/airdrop-engine.js installs — NEVER a web3.js layout encoder or SystemProgram.transfer in
// a page, AGENTS.md), and the credential is still window.CluckGate's. What lives here is the part
// that is easy to get wrong with money in flight:
//
//   · the AMOUNT is the server's quote, never a number this file computes or hardcodes, and the
//     quote is checked for self-consistency before a wallet is ever asked to sign;
//   · the recovery record (paySig + quote + payIntent) is written BEFORE the transaction is
//     submitted (signSendConfirm's onSigned with requireOnSigned) and before any redemption request,
//     so a confirmed payment whose redemption then fails (network, 5xx, closed app) is always
//     redeemable — it is cleared only on a verified grant or a DEFINITIVE refusal;
//   · a payment that has not landed is never reported as paid, and never as "nothing happened":
//     `unconfirmed` keeps its signature, and a record is only released as "never landed" when the
//     chain itself proves the blockhash is dead (checkPendingSwap's rule).
//
// Pure functions over injected deps (fetch, storage, rpc) so scripts/seeker-skr-pay-test.cjs can
// drive every branch with a fake window — no React here.
import { checkPendingSwap, signSendConfirm, splTokenShim } from "./sign.js";

// The SKR mint is part of the token's identity, like the CLKN mint; a quote naming any other mint
// is refused before signing. (A look-alike mint named "Seeker" exists — docs/SEEKER_APP_PLAN.md §7.)
export const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const PAY_KEY = "clkn_seeker_skrpay:";            // + wallet — one unresolved payment per wallet
const RECORD_MAX_AGE_MS = 8 * 24 * 3600e3;        // like cluck-gate.js's clkn_tools_paysig
const RAW_RE = /^[1-9][0-9]{0,19}$/;
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function rawToUi(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  if (!decimals) return s;
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? whole + "." + frac : whole;
}

// ── the quote ─────────────────────────────────────────────────────────────────
// → { ok:true, quote } | { ok:false, kind:"price"|"offline"|"error", error }
//   price = 503 skr_price_unavailable (the server has no sanity-banded SKR price: no amount is
//   guessed, ever). A quote that is not internally consistent is refused as "error".
export async function fetchQuote(fetchFn, wallet) {
  let r, j = null;
  try { r = await fetchFn("/api/tool-gate/skr-quote?wallet=" + encodeURIComponent(wallet)); }
  catch (_) { return { ok: false, kind: "offline" }; }
  try { j = await r.json(); } catch (_) { j = null; }
  if (r.status === 503 && j && (j.error === "skr_price_unavailable" || j.error === "skr_chain_unavailable")) return { ok: false, kind: "price", error: j.error };
  if (!r.ok || !j || !j.success) return { ok: false, kind: "error", error: (j && j.error) || ("status " + r.status) };
  const bad = validateQuote(j);
  if (bad) return { ok: false, kind: "error", error: bad };
  return { ok: true, quote: j };
}
// Everything the wallet will be asked to sign is derived from these fields, so they are checked
// here, before the Confirm sheet, rather than trusted: right mint, a known token program, an
// integer amount whose human form is exactly the amount the sheet will print, a real receiver.
export function validateQuote(q) {
  if (!q || q.mint !== SKR_MINT) return "the quote names a different token";
  if (q.program !== TOKEN_CLASSIC && q.program !== TOKEN_2022) return "the quote names an unknown token program";
  if (!Number.isInteger(q.decimals) || q.decimals < 0 || q.decimals > 12) return "the quote has bad decimals";
  if (!RAW_RE.test(String(q.amountRaw))) return "the quote has a bad amount";
  if (rawToUi(q.amountRaw, q.decimals) !== String(q.amountUi)) return "the quote's amount is not self-consistent";
  if (!ADDR_RE.test(String(q.receiver || "")) || !ADDR_RE.test(String(q.receiverAta || ""))) return "the quote has a bad receiver";
  if (!q.quote || typeof q.quote !== "string" || !Number.isFinite(q.expiresAt)) return "the quote is incomplete";
  return null;
}

// ── the payer's SKR ────────────────────────────────────────────────────────────
// → { total: BigInt, best: { pubkey, raw: BigInt } | null }. `best` is the richest unfrozen
// account; the transfer is built from it (one source account per transfer). Throws on RPC failure
// — the caller says "could not read your balance", never "you have none".
export async function readSkrAccounts(rpc, owner) {
  const res = await rpc("getTokenAccountsByOwner", [owner, { mint: SKR_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const list = (res && Array.isArray(res.value)) ? res.value : null;
  if (!list) throw new Error("could not read token accounts");
  let total = 0n, best = null;
  for (const a of list) {
    const info = a && a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
    if (!info || info.mint !== SKR_MINT || info.owner !== owner) continue;   // a look-alike entry is not the owner's SKR
    const raw = /^\d+$/.test(String(info.tokenAmount && info.tokenAmount.amount)) ? BigInt(info.tokenAmount.amount) : 0n;
    if (info.state === "frozen") continue;
    total += raw;
    if (!best || raw > best.raw) best = { pubkey: a.pubkey, raw };
  }
  return { total, best };
}

// ── the transaction ───────────────────────────────────────────────────────────
// Legacy Transaction: [create the receiver's SKR account (idempotent — a no-op once it exists),
// TransferChecked]. Built with the shim's browser-safe encoders. The receiver's account is
// RE-DERIVED here and must equal the quote's `receiverAta`; the payer is the fee payer and the
// transfer's authority, so the connected wallet is the only signer.
export function buildSkrPayTx(web3, spl, { payer, quote, source, blockhash }) {
  const { PublicKey, Transaction } = web3;
  const payerPk = new PublicKey(payer), mintPk = new PublicKey(quote.mint), receiverPk = new PublicKey(quote.receiver);
  const ata = spl.getAssociatedTokenAddressSync(mintPk, receiverPk, quote.program);
  if (ata.toBase58() !== quote.receiverAta) throw new Error("The quote's receiving account does not match the receiver — nothing was signed.");
  const tx = new Transaction();
  tx.feePayer = payerPk;
  tx.recentBlockhash = blockhash;
  tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(payerPk, ata, receiverPk, mintPk, quote.program));
  tx.add(spl.createTransferCheckedInstruction(new PublicKey(source), mintPk, ata, payerPk, BigInt(quote.amountRaw), quote.decimals, quote.program));
  return tx;
}

// ── signing ────────────────────────────────────────────────────────────────────
// The one call the pass sheet makes to put the payment on chain: signSendConfirm (the shared seam —
// the connected wallet signs, nobody else, and it keeps landed / failed / unconfirmed / declined
// apart), with the recovery record persisted from `onSigned` — i.e. AFTER the wallet signed and
// BEFORE the transaction is submitted — and `requireOnSigned`, so a record that could not be
// stored stops the broadcast: nothing is sent that cannot be recovered afterwards.
//   { status:"sent", sig }          landed and succeeded → the caller redeems the stored record
//   { status:"unconfirmed", sig }   MAY have landed; the record stays → "Check payment"
//   { status:"failed", error }      the node refused it, or it landed and FAILED: nobody was paid;
//                                   the record is cleared and a retry is safe
//   { status:"declined" }           the person said no
export async function paySkr({ provider, owner, quote, source, payIntent, storage }) {
  let blockhash = null, lastValid = null;
  const res = await signSendConfirm({
    provider, owner,
    build: (web3, bh, live, life) => {
      blockhash = bh; lastValid = life && life.lastValidBlockHeight;
      return buildSkrPayTx(web3, splTokenShim(), { payer: live, quote, source, blockhash: bh });
    },
    onSigned: (sig) => {
      if (!sig) throw new Error("no signature to record");
      saveRecord(storage, { wallet: owner, paySig: sig, skrQuote: quote.quote, payIntent, at: Date.now(), recentBlockhash: blockhash, lastValidBlockHeight: lastValid, amountUi: quote.amountUi });
    },
    requireOnSigned: true,
  });
  if (res.status === "failed" || res.status === "declined") clearRecord(storage, owner);
  return res;
}

// ── the recovery record ────────────────────────────────────────────────────────
// { wallet, paySig, skrQuote, payIntent, at, recentBlockhash, lastValidBlockHeight, amountUi }.
// Written with a read-back, throwing if it did not stick: signSendConfirm is told requireOnSigned,
// so a throw here stops the broadcast — nothing is sent that cannot be recovered afterwards.
export function saveRecord(storage, rec) {
  const json = JSON.stringify(rec);
  storage.setItem(PAY_KEY + rec.wallet, json);
  if (storage.getItem(PAY_KEY + rec.wallet) !== json) throw new Error("Could not verify the saved recovery record.");
}
export function loadRecord(storage, wallet, now = Date.now()) {
  try {
    const raw = storage.getItem(PAY_KEY + wallet);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || r.wallet !== wallet || !r.paySig || !(now - r.at < RECORD_MAX_AGE_MS)) return null;
    return r;
  } catch (_) { return null; }
}
export function clearRecord(storage, wallet) { try { storage.removeItem(PAY_KEY + wallet); } catch (_) {} }

// ── redemption ─────────────────────────────────────────────────────────────────
// Posts the stored record to the session route and classifies the answer.
//   { kind:"granted", pass, days, recovered }       record cleared
//   { kind:"refused", error, code }                 a DEFINITIVE refusal: that transfer will never
//                                                   buy a pass; record cleared, reason shown
//   { kind:"retry",   error }                       the chain/store/network could not say yet;
//                                                   record KEPT
//   { kind:"signin" }                               the pay intent expired and `refreshIntent`
//                                                   could not mint a new one; record kept
// `refreshIntent()` → a fresh payIntent string, or null (the wallet declined / user qualifies).
export async function redeemRecord({ fetchFn, storage, wallet, refreshIntent }) {
  let rec = loadRecord(storage, wallet);
  if (!rec) return { kind: "none" };
  const post = async () => {
    let r, j = null;
    try {
      r = await fetchFn("/api/tool-gate/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, payIntent: rec.payIntent, paySig: rec.paySig, payKind: "skr", skrQuote: rec.skrQuote }),
      });
    } catch (_) { return { transport: true }; }
    try { j = await r.json(); } catch (_) { j = null; }
    return { status: r.status, j };
  };
  let out = await post();
  if (!out.transport && out.status === 401 && out.j && /pay intent/i.test(String(out.j.error || ""))) {
    const fresh = typeof refreshIntent === "function" ? await refreshIntent().catch(() => null) : null;
    if (!fresh) return { kind: "signin" };
    rec = { ...rec, payIntent: fresh };
    try { saveRecord(storage, rec); } catch (_) { /* the in-memory copy still works for this call */ }
    out = await post();
  }
  if (out.transport) return { kind: "retry", error: null };
  const { j, status } = out;
  if (j && j.success && j.pass) {
    clearRecord(storage, wallet);
    return { kind: "granted", pass: j.pass, days: j.days || j.termDays || 7, recovered: !!j.recovered };
  }
  if (j && j.definitive === true) {
    clearRecord(storage, wallet);
    return { kind: "refused", error: j.error || "", code: j.code || "" };
  }
  // Everything else — 5xx, an unavailable chain read, "not visible yet", a store that could not
  // record, a malformed body — is "not yet", and the record stays.
  return { kind: "retry", error: (j && j.error) || null, status };
}

// "Check payment": redeem; if the chain has not shown it, ask whether the transaction can still
// land. Only a blockhash the node reports dead (checkPendingSwap → "expired"), or a transaction
// that landed and FAILED, releases the record as "never paid" — everything else keeps it.
//   → redeemRecord's kinds, plus { kind:"never-landed" }
export async function checkPayment({ fetchFn, storage, wallet, rpc, refreshIntent }) {
  const first = await redeemRecord({ fetchFn, storage, wallet, refreshIntent });
  if (first.kind !== "retry") return first;
  const rec = loadRecord(storage, wallet);
  if (!rec) return first;
  let st;
  try { st = await checkPendingSwap(rpc, { signature: rec.paySig, lastValidBlockHeight: rec.lastValidBlockHeight, recentBlockhash: rec.recentBlockhash }); }
  catch (_) { return first; }
  if (st.status === "expired" || st.status === "failed") { clearRecord(storage, wallet); return { kind: "never-landed", error: st.error || null }; }
  return first;
}
