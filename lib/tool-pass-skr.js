"use strict";
// The Seeker app's SKR-paid tools pass — the pure parts (docs/SEEKER_SKR_PASS_DESIGN.md).
//
// The paid pass is 7 days of every heavy tool, paid in SOL on the website (lib/tool-pass-terms.js,
// lib/tool-pass-redeem.js) or, in the Seeker app only, in SKR at a USD figure. A dollar price in a
// moving token cannot be a fixed amount in a schedule, and the server must be able to check LATER
// that what landed was the right amount THEN — without a price history and without trusting the
// client's number. So the amount is fixed by a server-signed QUOTE:
//
//   GET /api/tool-gate/skr-quote?wallet=  →  { amountRaw, quote: "<hmac token>" }
//   the app pays exactly amountRaw, then hands the token back with the payment signature;
//   the server verifies the token, then verifies on chain that at least that much SKR left the
//   proven wallet and reached the receiver, in a transaction timestamped inside the quote's window.
//
// This module holds: the BigInt amount maths, the quote token, and the on-chain evidence reader.
// Nothing here touches a store, a clock it was not handed, or a network it was not handed — every
// read is injected, so scripts/tool-pass-skr-test.cjs drives the whole thing with fixtures.
//
// Rules the design (and Codex round 27 on it) pinned, each with a named test:
//   · The payer is the wallet whose SKR BALANCE FELL, never the fee payer: wallet X can pay the fee
//     while wallet Y supplies the tokens. Balances are keyed by OWNER + MINT, never account index
//     (a look-alike account is the obvious forgery), and a parsed SPL transfer instruction from
//     that owner to the receiver's owner is a second, independent witness.
//   · verifySkrQuote does NOT compare `exp` to the clock. A quote's timing is judged against the
//     PAYMENT's chain timestamp, so a payment made at minute nine and redeemed at minute eleven is
//     honoured. The window has both ends: iat − LEAD ≤ blockTime ≤ exp + GRACE. Without the lower
//     bound a small transfer sent earlier could be redeemed later against a cheaper quote.
//   · An RPC failure is `unavailable`, never a denial and never a grant.

const crypto = require("crypto");

const QUOTE_PURPOSE = "tools-skr";
const QUOTE_TTL_MS = 10 * 60e3;
const QUOTE_MAX_SPAN_MS = 30 * 60e3;    // a token claiming a longer life than this is not ours
const WINDOW_LEAD_MS = 2 * 60e3;        // a payment may predate the quote by clock skew only
const WINDOW_GRACE_MS = 5 * 60e3;       // …and may land this long after the quote expired
const RAW_RE = /^[1-9][0-9]{0,19}$/;    // a u64-sized base-unit integer, no leading zero
const U64_MAX = (1n << 64n) - 1n;

const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAMS = new Set([TOKEN_CLASSIC, TOKEN_2022]);

// ── amounts ───────────────────────────────────────────────────────────────────
// A float → a BigInt scaled by 1e18, through toFixed so there is no exponent form. Deterministic
// for a given input; the final step is integer maths, never a float multiply.
function scaled(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e15) throw new Error("not a usable positive number");
  return BigInt(n.toFixed(18).replace(".", ""));
}
// amountRaw = ceil(usd / priceUsd × 10^decimals), as an integer string. Rounds UP so the quote
// is never worth less than the dollar figure it states.
function skrAmountRaw(usd, priceUsd, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("bad decimals");
  const u = scaled(usd), p = scaled(priceUsd);
  if (u <= 0n || p <= 0n) throw new Error("not a usable positive number");   // a price below 1e-18 rounds to zero
  const num = u * (10n ** BigInt(decimals));
  const raw = (num + p - 1n) / p;
  if (raw < 1n || raw > U64_MAX) throw new Error("amount out of range");
  return raw.toString();
}
function rawToUi(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  if (!decimals) return s;
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? whole + "." + frac : whole;
}

// ── the quote token ───────────────────────────────────────────────────────────
// base64url({ t:"tools-skr", w, a, iat, exp }) + "." + HMAC-sha256(secret, "tools-skr." + body).
// Its own purpose string: a pay-intent ("tools-pay") or a session token ("tools") can never be
// presented as a quote, and a quote can never be presented as either.
function hmac(secret, body) { return crypto.createHmac("sha256", secret).update(QUOTE_PURPOSE + "." + body).digest("base64url"); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function issueSkrQuote({ secret, wallet, amountRaw, now = Date.now(), ttlMs = QUOTE_TTL_MS }) {
  if (!secret || !wallet || !RAW_RE.test(String(amountRaw))) return null;
  const iat = Math.floor(now), exp = iat + ttlMs;
  const body = Buffer.from(JSON.stringify({ t: QUOTE_PURPOSE, w: wallet, a: String(amountRaw), iat, exp })).toString("base64url");
  return { token: body + "." + hmac(secret, body), iat, exp };
}
// → { amountRaw, iat, exp } when the HMAC, the purpose and the wallet all match; else null.
// ⚠️ It does NOT compare exp to the current time — see the header. Timing is checkPaymentWindow's.
function verifySkrQuote({ secret, token, wallet }) {
  if (!secret || !token || !wallet) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEq(parts[1], hmac(secret, parts[0]))) return null;
  let p; try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch (_) { return null; }
  if (!p || p.t !== QUOTE_PURPOSE || p.w !== wallet || !RAW_RE.test(String(p.a))) return null;
  if (!Number.isFinite(p.iat) || !Number.isFinite(p.exp) || p.exp <= p.iat || p.exp - p.iat > QUOTE_MAX_SPAN_MS) return null;
  return { amountRaw: String(p.a), iat: p.iat, exp: p.exp };
}
// The two-sided window, on CHAIN time only. Returns null when inside, else a refusal reason.
function checkPaymentWindow(quote, blockTimeMs) {
  if (blockTimeMs < quote.iat - WINDOW_LEAD_MS) return "this payment landed before the quote was issued, so the quote never priced it";
  if (blockTimeMs > quote.exp + WINDOW_GRACE_MS) return "this payment landed after its quote expired, so it was priced on a stale number";
  return null;
}

// ── the receiving account ─────────────────────────────────────────────────────
// The receiver's associated token account for the mint under the mint's own token program.
// Pure derivation (no network); the caller reads the mint account once for `program`.
function receiverAta({ receiver, mint, program }) {
  if (!TOKEN_PROGRAMS.has(program)) throw new Error("unknown token program " + program);
  const { PublicKey } = require("@solana/web3.js");
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(receiver).toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ATA_PROGRAM));
  return ata.toBase58();
}

// ── the on-chain evidence ─────────────────────────────────────────────────────
const bigOf = (v) => { try { return /^\d+$/.test(String(v)) ? BigInt(String(v)) : null; } catch (_) { return null; } };
const refuse = (error, code, extra) => Object.assign({ ok: false, status: 200, definitive: true, code, error }, extra || {});

// Reads a parsed `getTransaction` result (jsonParsed) and answers what SKR moved. Pure.
//   { ok:true, kind:"skr", payer: wallet | null, amountRaw, outRaw, inRaw, ixRaw, feePayer, blockTimeMs }
//   { ok:false, … }  — a definitive refusal about THIS transaction (never an outage; see the wrapper)
// `payer` is set to `wallet` only when the token-balance evidence AND a parsed transfer instruction
// both name that wallet. A payment funded by anyone else comes back ok:true with payer:null, which
// redeemPaidPass turns into "payment was made by a different wallet".
function evaluateSkrPayment(tx, { mint, receiver, wallet }) {
  if (!tx || !tx.meta) return { ok: false, status: 503, retry: true, unavailable: true, code: "skr_unavailable", error: "the chain returned no transaction details yet — try again in a moment; nothing was consumed" };
  if (tx.meta.err) return refuse("the payment transaction failed on chain, so no SKR moved", "tx_failed");
  if (wallet === receiver) return refuse("the receiving wallet cannot pay itself", "self_payment");
  const msg = (tx.transaction && tx.transaction.message) || {};
  const keys = (msg.accountKeys || []).map((k) => (typeof k === "string" ? k : k && k.pubkey));
  const pre = Array.isArray(tx.meta.preTokenBalances) ? tx.meta.preTokenBalances : [];
  const post = Array.isArray(tx.meta.postTokenBalances) ? tx.meta.postTokenBalances : [];

  // Net change per OWNER, for this mint only. Keyed by owner (not account index): the question is
  // "whose SKR fell", and an account the wallet does not own is not the wallet's money.
  const net = new Map();
  const acct = new Map();   // account index → { owner, mint } for the instruction witness below
  const add = (list, sign) => {
    for (const b of list) {
      if (!b || !b.owner || !b.mint) continue;
      acct.set(b.accountIndex, { owner: b.owner, mint: b.mint });
      if (b.mint !== mint) continue;                         // a same-owner entry of another mint is ignored
      const amt = bigOf(b.uiTokenAmount && b.uiTokenAmount.amount);
      if (amt == null) continue;
      net.set(b.owner, (net.get(b.owner) || 0n) + (sign * amt));
    }
  };
  add(pre, -1n); add(post, 1n);
  const delta = (owner) => net.get(owner) || 0n;
  const inRaw = delta(receiver) > 0n ? delta(receiver) : 0n;
  const outRaw = delta(wallet) < 0n ? -delta(wallet) : 0n;
  if (inRaw <= 0n) return refuse("this transaction did not move any SKR into the receiving account", "no_payment_to_receiver");

  // Second, independent witness: a parsed SPL transfer / transferChecked of THIS mint from an
  // account the wallet owns to an account the receiver owns (top level and inner instructions).
  let ixRaw = 0n;
  const ixs = (msg.instructions || []).slice();
  for (const g of tx.meta.innerInstructions || []) ixs.push(...(g.instructions || []));
  for (const ix of ixs) {
    const p = ix && ix.parsed;
    if (!p || !p.info || (p.type !== "transfer" && p.type !== "transferChecked")) continue;
    if (!TOKEN_PROGRAMS.has(ix.programId) && ix.program !== "spl-token" && ix.program !== "spl-token-2022") continue;
    const si = keys.indexOf(p.info.source), di = keys.indexOf(p.info.destination);
    const s = acct.get(si), d = acct.get(di);
    if (!s || !d || s.mint !== mint || d.mint !== mint) continue;
    if (s.owner !== wallet || d.owner !== receiver) continue;
    if (p.type === "transferChecked" && p.info.mint !== mint) continue;
    const amt = bigOf(p.type === "transferChecked" ? (p.info.tokenAmount && p.info.tokenAmount.amount) : p.info.amount);
    if (amt != null) ixRaw += amt;
  }

  const feePayer = keys[0] || null;
  const blockTimeMs = tx.blockTime ? tx.blockTime * 1000 : 0;
  const min = (a, b) => (a < b ? a : b);
  if (outRaw <= 0n) {
    // SKR reached the receiver but none left the proven wallet: someone else supplied the tokens.
    return { ok: true, kind: "skr", payer: null, amountRaw: "0", outRaw: "0", inRaw: inRaw.toString(), ixRaw: ixRaw.toString(), feePayer, blockTimeMs };
  }
  if (ixRaw <= 0n) return refuse("no SPL transfer of SKR from your wallet to the receiving account was found in this transaction", "no_transfer_instruction");
  return { ok: true, kind: "skr", payer: wallet, amountRaw: min(min(outRaw, inRaw), ixRaw).toString(), outRaw: outRaw.toString(), inRaw: inRaw.toString(), ixRaw: ixRaw.toString(), feePayer, blockTimeMs };
}

// Fetches the transaction and evaluates it. `rpcJson(method, params)` resolves the parsed JSON-RPC
// body and THROWS on transport failure (lib/rpc.js rpcJson). A transport failure or a JSON-RPC
// error is `unavailable` (503, retryable, nothing consumed); a null result is "not visible yet"
// (retryable) — neither is ever a denial, and neither is ever a grant.
async function verifySkrPaymentTx({ rpcJson, sig, wallet, mint, receiver }) {
  let j;
  try {
    j = await rpcJson("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  } catch (e) {
    return { ok: false, status: 503, retry: true, unavailable: true, code: "skr_unavailable", error: "could not reach the chain to check this payment — try again in a moment; nothing was consumed" };
  }
  if (!j || j.error) return { ok: false, status: 503, retry: true, unavailable: true, code: "skr_unavailable", error: "the chain node could not answer — try again in a moment; nothing was consumed" };
  if (!j.result) return { ok: false, status: 200, retry: true, notFound: true, code: "skr_not_found_yet", error: "the chain has not shown this payment yet — try again in a moment; nothing was consumed" };
  return evaluateSkrPayment(j.result, { mint, receiver, wallet });
}

module.exports = {
  QUOTE_TTL_MS, WINDOW_LEAD_MS, WINDOW_GRACE_MS, TOKEN_CLASSIC, TOKEN_2022, TOKEN_PROGRAMS,
  skrAmountRaw, rawToUi, issueSkrQuote, verifySkrQuote, checkPaymentWindow,
  receiverAta, evaluateSkrPayment, verifySkrPaymentTx,
};
