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
  // Two LOCAL stopwatches started the moment the quote arrived (see quoteStale). They live on the
  // object only; the server never sees them and the quote token is untouched.
  return { ok: true, quote: { ...j, _perf0: perfNow(), _wall0: Date.now() } };
}
const perfNow = () => { try { return (typeof performance !== "undefined" && performance.now()) || 0; } catch (_) { return 0; } };
// Is this quote too old to pay at? Judged by how long it has been HERE since it arrived — never by
// comparing the phone's clock to the server's `expiresAt` (review of #421, P3: a slow clock saw a
// dead quote as fresh and paid late into a final refusal). The quote's life is the server's own
// span, `expiresAt − issuedAt` (both server time, so clock skew cancels); the larger of the
// monotonic and wall-clock elapsed times counts, so a device that slept or a clock that jumped
// can only make this stricter.
export function quoteStale(quote, marginMs = 60e3) {
  const life = Number(quote.expiresAt) - Number(quote.issuedAt);
  if (!(life > 0)) return true;
  const perf = perfNow() - Number(quote._perf0), wall = Date.now() - Number(quote._wall0);
  const elapsed = Math.max(Number.isFinite(perf) ? perf : Infinity, Number.isFinite(wall) ? wall : Infinity);
  return !(elapsed < life - marginMs);
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
  if (!q.quote || typeof q.quote !== "string" || !Number.isFinite(q.expiresAt) || !Number.isFinite(q.issuedAt) || !(q.expiresAt > q.issuedAt)) return "the quote is incomplete";
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
// apart).
//
// ⚠️ THE RECOVERY RECORD IS SAVED BEFORE THE WALLET IS ASKED TO SIGN (review of #421): a wallet that
// can only signAndSendTransaction BROADCASTS INSIDE that call, so "persist from onSigned" is too late
// for it — the signature is unknown until after the money has moved. So the record goes in from
// build() — which signSendConfirm runs before the wallet is ever touched — as an ATTEMPT (paySig
// null, with the blockhash, the receiver's account and the amount so the chain can be searched for
// it). If that save fails, build throws and the wallet is never asked. onSigned then fills in the
// signature (and, with requireOnSigned, still stops a signTransaction wallet's broadcast if THAT
// write fails).
//   { status:"sent", sig }          landed and succeeded → the caller redeems the stored record
//   { status:"unconfirmed", sig? }  MAY have landed; the record stays → "Check payment". `sig` is null
//                                   for a send-only wallet that threw without telling us anything.
//   { status:"failed", error }      the node refused it, or it landed and FAILED: nobody was paid;
//                                   the record is cleared and a retry is safe
//   { status:"declined" }           the person said no
export async function paySkr({ provider, owner, quote, source, payIntent, storage }) {
  let attempt = null;
  const res = await signSendConfirm({
    provider, owner,
    build: (web3, bh, live, life) => {
      const tx = buildSkrPayTx(web3, splTokenShim(), { payer: live, quote, source, blockhash: bh });
      const rec = { wallet: owner, paySig: null, attempt: true, skrQuote: quote.quote, payIntent, at: Date.now(),
        recentBlockhash: bh, lastValidBlockHeight: life && life.lastValidBlockHeight, amountUi: quote.amountUi,
        amountRaw: String(quote.amountRaw), receiverAta: quote.receiverAta,
        // SERVER time (the quote's issuedAt): the only clock a chain-time search bound may come from.
        // `at` above is the phone's clock and is used for nothing but the 8-day expiry of the record.
        quoteIssuedAt: quote.issuedAt };
      saveRecord(storage, rec);   // throws → build throws → signSendConfirm returns "failed"; the wallet is never asked
      attempt = rec;              // only once it is really stored (a failed save must not look like an in-flight attempt)
      return tx;
    },
    onSigned: (sig) => {
      if (!sig) throw new Error("no signature to record");
      saveRecord(storage, { ...attempt, paySig: sig, attempt: false });
    },
    requireOnSigned: true,
  });
  if (res.status === "declined") clearRecord(storage, owner);
  else if (res.status === "failed") {
    // No signature + a wallet that only signs-and-sends: it may have broadcast before it threw, and
    // the seam cannot know. Keep the attempt; "Check payment" searches the chain and only a dead
    // blockhash releases it. Everything else that failed moved nothing.
    const sendOnly = typeof provider.signTransaction !== "function";
    if (sendOnly && !res.sig && attempt) return { status: "unconfirmed", sig: null, error: res.error };
    clearRecord(storage, owner);
  }
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
    // paySig is null for an ATTEMPT (saved before the wallet was asked; the signature not known yet).
    if (!r || r.wallet !== wallet || !(r.paySig || r.attempt === true) || !(now - r.at < RECORD_MAX_AGE_MS)) return null;
    return r;
  } catch (_) { return null; }
}
export function clearRecord(storage, wallet) { try { storage.removeItem(PAY_KEY + wallet); } catch (_) {} }

// ── payments that landed but cannot buy a pass ("needs attention") ─────────────────────────────
// { wallet, paySig, amountUi, code, error, at }[] per wallet, newest last, at most 5. Never cleared
// by anything but the person's own Dismiss — the signature is their evidence for support.
const STUCK_KEY = "clkn_seeker_skrstuck:";
export function loadStuck(storage, wallet) {
  try {
    const l = JSON.parse(storage.getItem(STUCK_KEY + wallet) || "[]");
    return Array.isArray(l) ? l.filter((r) => r && r.wallet === wallet && r.paySig) : [];
  } catch (_) { return []; }
}
export function saveStuck(storage, entry) {
  const l = loadStuck(storage, entry.wallet).filter((r) => r.paySig !== entry.paySig);
  l.push(entry);
  const json = JSON.stringify(l.slice(-5));
  storage.setItem(STUCK_KEY + entry.wallet, json);
  if (storage.getItem(STUCK_KEY + entry.wallet) !== json) throw new Error("Could not verify the saved record.");
}
export function dismissStuck(storage, wallet, paySig) {
  try {
    const l = loadStuck(storage, wallet).filter((r) => r.paySig !== paySig);
    if (l.length) storage.setItem(STUCK_KEY + wallet, JSON.stringify(l)); else storage.removeItem(STUCK_KEY + wallet);
  } catch (_) {}
}

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
  // An attempt has no signature to redeem yet — "Check payment" finds it on the chain first.
  if (!rec.paySig) return { kind: "retry", error: null };
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
    // The ACTIVE record is released (that transfer will never buy a pass, and it must not block a
    // new payment) — but a payment that may have LANDED is never dropped silently: it moves to the
    // "needs attention" list with its signature, reason and amount, shown until the person
    // dismisses it (review of #421, P3: an outside_window refusal used to clear a paid record).
    // Only a transaction that FAILED on chain moved nothing and has nothing to keep.
    const code = j.code || "";
    if (code !== "tx_failed") {
      // The active record is cleared ONLY after the support entry is safely stored (review of #421
      // round 2: a storage-exhaustion failure here used to be swallowed and the only evidence — the
      // signature — deleted anyway). If the save fails the active record stays exactly as it is, it
      // still carries the signature, and the caller shows the support state from it.
      try { saveStuck(storage, { wallet, paySig: rec.paySig, amountUi: rec.amountUi || null, code, error: j.error || "", at: Date.now() }); }
      catch (_) { return { kind: "refused", error: j.error || "", code, sig: rec.paySig, amountUi: rec.amountUi || null, stuck: false, keptActive: true }; }
    }
    clearRecord(storage, wallet);
    return { kind: "refused", error: j.error || "", code, sig: rec.paySig, amountUi: rec.amountUi || null, stuck: code !== "tx_failed" };
  }
  // Everything else — 5xx, an unavailable chain read, "not visible yet", a store that could not
  // record, a malformed body — is "not yet", and the record stays.
  return { kind: "retry", error: (j && j.error) || null, status };
}

// Did the wallet's attempt reach the chain? → { sig, complete }.
//   sig       the signature of a parsed SPL TransferChecked of SKR from this wallet to the quote's
//             receiving account for exactly the quoted amount, or null;
//   complete  true ONLY when the search PROVABLY covered every signature that could be the payment:
//             it paged (getSignaturesForAddress, before=) back past the lower time bound, every
//             candidate's details were read, and no RPC call failed. A page cap hit, a candidate
//             whose getTransaction is null/errored/has no meta, or any RPC error means "cannot tell",
//             and an incomplete search NEVER releases a record (review of #421 round 2: an expired
//             blockhash proves the payment cannot land in future, not that it never landed).
// The lower bound is SERVER time — the quote's issuedAt (a payment cannot predate the quote that
// priced it) minus a margin — never the phone's clock (a phone 10 minutes fast skipped the real
// payment). Throws never escape: a failure is reported as incomplete.
const SEARCH_PAGE = 100, SEARCH_MAX_PAGES = 10, SEARCH_MAX_CANDIDATES = 150, SEARCH_MARGIN_MS = 10 * 60e3, SEARCH_RETRIES = 3;
// One search call, retried a couple of times: a node that has not caught up to `minContextSlot` answers
// an error (-32016) until it does, and a brief lag must not be mistaken for a failed search.
async function searchCall(rpc, method, params) {
  let last;
  for (let i = 0; i < SEARCH_RETRIES; i++) {
    try { return await rpc(method, params); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 700)); }
  }
  throw last;
}
// `proofSlot` — the context slot of the response that proved the blockhash dead (null if it is not
// dead yet). Every search call runs at commitment `confirmed` (the same view the expiry proof used —
// the RPC default is often `finalized`, which can omit a payment that landed just before expiry), and
// the history pages carry `minContextSlot: proofSlot`, so a node whose view is OLDER than the expiry
// proof errors instead of answering with a stale, empty list. getTransaction has no minContextSlot;
// it is only asked about signatures that slot-bounded list returned, and a null answer is incomplete.
//
// A candidate matches only if it is THIS attempt's transaction: its message's recentBlockhash equals
// the blockhash saved on the attempt before the wallet was asked (Codex, #421 round 3: an identical
// older transfer with a different blockhash was selected and the current attempt deleted). Signatures
// the attempt has already decided to ignore are skipped.
async function findAttempt(rpc, rec, proofSlot) {
  const issued = Number(rec.quoteIssuedAt);
  if (!Number.isFinite(issued) || !rec.recentBlockhash) return { sig: null, complete: false };   // no server-time bound / no blockhash to match: cannot prove anything
  const lowerSec = (issued - SEARCH_MARGIN_MS) / 1000;
  const ignore = new Set(Array.isArray(rec.ignoreSigs) ? rec.ignoreSigs : []);
  const histCfg = (before) => ({ limit: SEARCH_PAGE, commitment: "confirmed", ...(Number.isFinite(proofSlot) ? { minContextSlot: proofSlot } : {}), ...(before ? { before } : {}) });
  let before, candidates = [], complete = false;
  try {
    for (let page = 0; page < SEARCH_MAX_PAGES && !complete; page++) {
      const list = await searchCall(rpc, "getSignaturesForAddress", [rec.wallet, histCfg(before)]);
      if (!Array.isArray(list)) return { sig: null, complete: false };
      for (const e of list) {
        if (!e || !e.signature) return { sig: null, complete: false };
        if (e.blockTime && e.blockTime < lowerSec) { complete = true; break; }   // newest-first: everything after this is older than the quote
        if (!e.err && !ignore.has(e.signature)) candidates.push(e.signature);
      }
      if (!complete && list.length < SEARCH_PAGE) complete = true;              // the wallet's history ends here
      if (list.length) before = list[list.length - 1].signature;
    }
    if (!complete) return { sig: null, complete: false };                       // page cap hit before the bound
    if (candidates.length > SEARCH_MAX_CANDIDATES) return { sig: null, complete: false };
    for (const sig of candidates) {
      const tx = await searchCall(rpc, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      if (!tx || !tx.meta) return { sig: null, complete: false };               // details unavailable → cannot rule it out
      if (tx.meta.err) continue;
      const msg = (tx.transaction && tx.transaction.message) || {};
      if (msg.recentBlockhash !== rec.recentBlockhash) continue;                // not THIS attempt's transaction
      const ixs = (msg.instructions || []).slice();
      for (const g of tx.meta.innerInstructions || []) ixs.push(...(g.instructions || []));
      for (const ix of ixs) {
        const p = ix && ix.parsed, i = p && p.info;
        if (p && p.type === "transferChecked" && i && i.mint === SKR_MINT && i.destination === rec.receiverAta
            && i.authority === rec.wallet && i.tokenAmount && String(i.tokenAmount.amount) === String(rec.amountRaw)) return { sig, complete: true };
      }
    }
    return { sig: null, complete: true };
  } catch (_) { return { sig: null, complete: false }; }
}

// "Check payment": redeem; if the chain has not shown it, ask whether the transaction can still
// land. Only a blockhash the node reports dead (checkPendingSwap → "expired"), or a transaction
// that landed and FAILED, releases the record as "never paid" — everything else keeps it.
// An ATTEMPT (saved before the wallet was asked; no signature yet) is resolved the same way, except
// that the chain is SEARCHED for the signature: only after the blockhash is proven dead — so nothing
// can land any more — does an empty search release it.
//   → redeemRecord's kinds, plus { kind:"never-landed" }
export async function checkPayment({ fetchFn, storage, wallet, rpc, refreshIntent }) {
  let rec = loadRecord(storage, wallet);
  let first = null;
  if (rec && !rec.paySig) {
    let dead = false, proofSlot = null;
    try {
      const [h, valid] = await Promise.all([rpc("getBlockHeight", [{ commitment: "confirmed" }]), rec.recentBlockhash ? rpc("isBlockhashValid", [rec.recentBlockhash, { commitment: "confirmed" }]) : null]);
      dead = typeof h === "number" && rec.lastValidBlockHeight != null && h > rec.lastValidBlockHeight && !!valid && valid.value === false;
      // The view that proved the expiry. A release needs a search at a view at least this new; a
      // response that does not say which slot it was read at cannot be used as proof at all.
      proofSlot = valid && valid.context && Number.isFinite(valid.context.slot) ? valid.context.slot : null;
      if (dead && proofSlot == null) dead = false;
    } catch (_) { return { kind: "cannot-confirm", error: null }; }
    const found = await findAttempt(rpc, rec, dead ? proofSlot : null);
    if (found.sig) {
      const attempt = rec;
      rec = { ...rec, paySig: found.sig, attempt: false };
      try { saveRecord(storage, rec); } catch (_) { return { kind: "cannot-confirm", error: null }; }   // keep the attempt; try again
      first = await redeemRecord({ fetchFn, storage, wallet, refreshIntent });
      // A refusal of a candidate found by SEARCH (not the signature the wallet handed back) must not
      // end the attempt while its blockhash can still produce the real transaction: the refusal is
      // kept as evidence (redeemRecord stored the support entry), the attempt is restored to keep
      // watching, and that candidate is ignored from now on.
      if (first.kind === "refused" && !dead && !first.keptActive) {
        try { saveRecord(storage, { ...attempt, ignoreSigs: [...(Array.isArray(attempt.ignoreSigs) ? attempt.ignoreSigs : []), found.sig] }); } catch (_) { /* evidence is already in the support list */ }
        return { ...first, watching: true };
      }
      if (first.kind !== "retry") return first;
    } else if (dead && found.complete) { clearRecord(storage, wallet); return { kind: "never-landed", error: null }; }
    else if (!found.complete) return { kind: "cannot-confirm", error: null };   // incomplete search: never a release, whatever the blockhash says
    else return { kind: "retry", error: null };                                  // searched everything, nothing yet, but it could still land
  }
  if (!first) first = await redeemRecord({ fetchFn, storage, wallet, refreshIntent });
  if (first.kind !== "retry") return first;
  rec = loadRecord(storage, wallet);
  if (!rec) return first;
  let st;
  try { st = await checkPendingSwap(rpc, { signature: rec.paySig, lastValidBlockHeight: rec.lastValidBlockHeight, recentBlockhash: rec.recentBlockhash }); }
  catch (_) { return first; }
  if (st.status === "expired" || st.status === "failed") { clearRecord(storage, wallet); return { kind: "never-landed", error: st.error || null }; }
  return first;
}
