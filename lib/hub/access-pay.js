"use strict";
// Platform access — the payment leg, pure. A project pays its month in SOL or in CLKN "priced
// at the moment they pay": we issue a QUOTE (the CLKN amount computed from the live CLKN/SOL
// price right then, good for QUOTE_TTL_MIN minutes), the project pays, and the payment is
// verified against THAT quote — amount and block time — never against today's price. A SOL
// payment needs no price and is checked against the schedule at its block time.
//
// This module never touches the chain or the kv: `parsePayment` reads a jsonParsed
// getTransaction result, `verifyPayment` compares it to a quote. The route owns the reads and
// the durable writes (registry access block + the signature store).
const access = require("./access");

const QUOTE_TTL_MIN = 30;
// A payment may land a little before the quote's clock (RPC clock skew) or after its TTL ran
// out while the wallet was confirming; both windows are short and one-sided on purpose.
const QUOTE_EARLY_MS = 2 * 60e3;
const QUOTE_LATE_MS = 10 * 60e3;

function newQuoteId() { return "q_" + require("crypto").randomBytes(6).toString("hex"); }

// A quote for one month of `tier` at `atMs`, priced in SOL and, when a price is known, in CLKN.
function makeQuote({ tier, atMs, solPerClkn, clknDecimals, nowId = newQuoteId }) {
  const t = access.assertTier(tier);
  if (t === "comped") throw new Error("a comped project has nothing to pay");
  const lamports = access.priceLamports(t, atMs);
  const q = { id: nowId(), tier: t, atMs: Number(atMs), expiresMs: Number(atMs) + QUOTE_TTL_MIN * 60e3, lamports, clknRaw: null, solPerClkn: null, clknDecimals: Number(clknDecimals) };
  if (Number.isFinite(solPerClkn) && solPerClkn > 0) {
    q.solPerClkn = solPerClkn;
    q.clknRaw = access.clknRawFor(lamports, solPerClkn, Number(clknDecimals)).toString();
  }
  return q;
}

// Read a jsonParsed transaction: what did `payTo.sol` gain in lamports, what did `payTo.clkn`'s
// token account for `clknMint` gain in raw units, who paid (fee payer), when. A transaction that
// moved both is reported as both; the verifier picks the leg that covers the quote.
function parsePayment(tx, { payTo, clknMint }) {
  if (!tx || (tx.meta && tx.meta.err)) return { ok: false, error: "tx not found or failed" };
  const keys = (((tx.transaction || {}).message || {}).accountKeys || []).map((k) => (typeof k === "string" ? k : k && k.pubkey));
  const meta = tx.meta || {};
  const out = { ok: true, payer: keys[0] || null, blockTimeMs: tx.blockTime ? Number(tx.blockTime) * 1000 : 0, lamports: 0, clknRaw: 0n };
  const si = keys.indexOf(payTo.sol);
  if (si >= 0) out.lamports = Math.max(0, Number((meta.postBalances || [])[si] || 0) - Number((meta.preBalances || [])[si] || 0));
  const sum = (rows) => (rows || []).filter((r) => r && r.mint === clknMint && r.owner === payTo.clkn).reduce((t, r) => t + BigInt((r.uiTokenAmount && r.uiTokenAmount.amount) || "0"), 0n);
  const post = sum(meta.postTokenBalances), pre = sum(meta.preTokenBalances);
  out.clknRaw = post > pre ? post - pre : 0n;
  if (out.lamports === 0 && out.clknRaw === 0n) return { ok: false, error: "payment not addressed to the platform wallet", payer: out.payer, blockTimeMs: out.blockTimeMs };
  return out;
}

// Compare a parsed payment to the quote it was made against.
//   - no block time yet            → retry (nothing to consume)
//   - landed outside the quote's window → refused: a stale quote must not price a later payment
//   - SOL leg covers the lamports  → ok kind sol
//   - CLKN leg covers the quoted raw (2% slack) → ok kind clkn
//   - otherwise short
function verifyPayment({ quote, payment, slackPct = 2 }) {
  if (!payment || !payment.ok) return { ok: false, reason: payment && payment.error || "unreadable" };
  if (!payment.blockTimeMs) return { ok: false, reason: "not_final_yet", retry: true };
  if (!quote || !quote.id) return { ok: false, reason: "no_quote" };
  if (payment.blockTimeMs < quote.atMs - QUOTE_EARLY_MS || payment.blockTimeMs > quote.expiresMs + QUOTE_LATE_MS) {
    return { ok: false, reason: "outside_quote_window", quotedAtMs: quote.atMs, expiresMs: quote.expiresMs, blockTimeMs: payment.blockTimeMs };
  }
  const slack = Math.max(0, Math.min(10, Number(slackPct) || 0));
  if (payment.lamports > 0) {
    const min = Math.ceil(quote.lamports * (100 - slack) / 100);
    if (payment.lamports >= min) return { ok: true, kind: "sol", lamports: payment.lamports, payer: payment.payer, blockTimeMs: payment.blockTimeMs };
  }
  if (payment.clknRaw > 0n && quote.clknRaw) {
    const need = BigInt(quote.clknRaw);
    const min = (need * BigInt(100 - slack) + 99n) / 100n;
    if (payment.clknRaw >= min) return { ok: true, kind: "clkn", clknRaw: payment.clknRaw.toString(), payer: payment.payer, blockTimeMs: payment.blockTimeMs };
  }
  return { ok: false, reason: "short", lamports: payment.lamports, clknRaw: payment.clknRaw.toString(), needLamports: quote.lamports, needClknRaw: quote.clknRaw };
}

// Keep the quote book small: drop quotes older than a day.
function pruneQuotes(book, nowMs) {
  const out = {};
  for (const [id, q] of Object.entries(book || {})) if (q && q.expiresMs + 24 * 3600e3 > nowMs) out[id] = q;
  return out;
}

module.exports = { QUOTE_TTL_MIN, QUOTE_EARLY_MS, QUOTE_LATE_MS, makeQuote, parsePayment, verifyPayment, pruneQuotes };
