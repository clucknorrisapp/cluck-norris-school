"use strict";
// Did THIS transaction actually pay THIS wallet THIS much of THIS token?
//
// Both payout journals (/api/cuna-stake/payout and /api/hub/:project/payout, the `sent=` rows the
// airdropper hands back) used to accept a row on getSignatureStatuses alone: confirmed + no error.
// Nothing looked at the mint, the destination or the amount, so one unrelated confirmed signature
// could mark every row in a batch paid — and the public "VERIFY ON-CHAIN" then printed ✓ beside
// a wallet and an amount the chain never carried (deep dive 2026-09-17, P1-048 / P1-035).
//
// This reads the parsed transaction (getTransaction, jsonParsed) and computes the per-OWNER token
// deltas for the mint from meta.pre/postTokenBalances — the same technique lib/hub/access-pay.js
// uses for platform payments. Pure: no RPC here, the caller fetches. BigInt throughout.

// Whole raw units only. BigInt("") is 0n and BigInt(" 12 ") parses, so the shape is checked first —
// an empty or decimal ledger amount is a repair job, never zero owed.
function big(v) { const s = String(v == null ? "" : v).trim(); if (!/^\d+$/.test(s)) return null; try { return BigInt(s); } catch (_) { return null; } }

// Map of token-account OWNER → net delta (post − pre) of `mint` in this transaction, raw units.
// A batch transaction that pays several wallets shows each of them here.
function tokenDeltas(tx, mint) {
  const out = new Map();
  const meta = (tx && tx.meta) || {};
  const add = (rows, sign) => {
    for (const r of rows || []) {
      if (!r || r.mint !== mint || !r.owner) continue;
      const amt = big(r.uiTokenAmount && r.uiTokenAmount.amount);
      if (amt === null) continue;
      out.set(r.owner, (out.get(r.owner) || 0n) + sign * amt);
    }
  };
  add(meta.preTokenBalances, -1n);
  add(meta.postTokenBalances, 1n);
  return out;
}

// Verdict for one journal row. `minRaw` is the amount the batch owes the wallet (raw units) and
// the transfer must cover it EXACTLY or more — the airdropper sends whole raw units from the
// batch's own lines, so there is nothing to round (a 0.1% slack used to mark a short transfer
// fully paid — Codex 2026-09-17). A ledger amount that does not parse is refused, never waved
// through. `notBefore` (unix seconds, the batch's creation time) refuses a transaction that
// landed before the batch existed: it cannot be that batch's payment.
const NOT_BEFORE_SKEW_S = 600;
function rowPaidBy(tx, { mint, wallet, minRaw, notBefore } = {}) {
  if (!tx) return { ok: false, why: "transaction not found on chain" };
  if (tx.meta && tx.meta.err) return { ok: false, why: "transaction failed on chain" };
  if (!mint || !wallet) return { ok: false, why: "no mint or wallet to check against" };
  if (minRaw !== undefined && minRaw !== null) {
    const need = big(minRaw);
    if (need === null || need < 0n) return { ok: false, why: "the batch's amount for this wallet is not a whole raw number — ledger needs repair" };
  }
  if (notBefore) {
    const bt = Number(tx.blockTime);
    if (!(bt > 0)) return { ok: false, why: "the chain has not timestamped this transaction yet — try again" };
    if (bt < Number(notBefore) - NOT_BEFORE_SKEW_S) return { ok: false, why: "this transaction landed before the batch was exported — it cannot be this batch's payment" };
  }
  const delta = tokenDeltas(tx, mint).get(wallet) || 0n;
  if (delta <= 0n) return { ok: false, why: "no " + mint.slice(0, 6) + "… reached this wallet in that transaction", deltaRaw: delta.toString() };
  const need = big(minRaw);
  if (need !== null && need > 0n && delta < need) return { ok: false, why: "transfer smaller than the amount owed (" + delta.toString() + " < " + need.toString() + ")", deltaRaw: delta.toString() };
  return { ok: true, deltaRaw: delta.toString() };
}

// Has this (wallet, signature) pair already been recorded as a sent row in ANOTHER batch? One
// transaction can pay several wallets (a batch transfer), so the key is the pair, not the
// signature alone; the current batch is excluded because recordSent resolves its own pending row
// by the same signature. Returns the batch id that holds it, or null. (Codex 2026-09-17,
// finding 3: an earlier payout's signature settled the next batch without a new transfer.)
function sigAlreadyUsed(batches, wallet, sig, currentBatchId) {
  if (!wallet || !sig) return null;
  for (const [id, b] of Object.entries(batches || {})) {
    if (id === currentBatchId || !b || !b.sent) continue;
    const row = b.sent[wallet];
    if (row && row.sig && String(row.sig) === String(sig)) return id;
  }
  return null;
}

// The whole `sent=` row check both payout desks run: for each {wallet, sig} row, the transaction
// must be known, must not have already settled that wallet in another batch, and must have paid
// the wallet the batch's amount after the batch was exported. `txBySig` is the caller's fetched
// map (sig → parsed tx | null). Returns the rows to record and the rows to report back with why.
function verifyBatchRows({ results, txBySig, batches, batchId, mint, amounts, notBefore } = {}) {
  const accepted = [], rejected = [];
  for (const r of results || []) {
    const sg = String((r && r.sig) || "").trim();
    const w = String((r && r.wallet) || "");
    let v;
    if (!txBySig || typeof txBySig.has !== "function" || !txBySig.has(sg)) v = { ok: false, why: "no transaction signature" };
    else {
      const prior = sigAlreadyUsed(batches, w, sg, batchId);
      v = prior ? { ok: false, why: "this signature already paid " + w.slice(0, 6) + "… in batch " + prior }
                : rowPaidBy(txBySig.get(sg), { mint, wallet: w, minRaw: (amounts || {})[w], notBefore });
    }
    if (v.ok) accepted.push(r); else rejected.push({ wallet: r && r.wallet, sig: r && r.sig, why: v.why });
  }
  return { accepted, rejected };
}

module.exports = { tokenDeltas, rowPaidBy, sigAlreadyUsed, verifyBatchRows, NOT_BEFORE_SKEW_S };
