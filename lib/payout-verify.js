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

function big(v) { try { return BigInt(String(v)); } catch (_) { return null; } }

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

// Verdict for one journal row. `minRaw` is the amount the batch owes the wallet (raw units); a
// transfer within 0.1% under it still counts (UI ↔ raw rounding on the airdropper side), anything
// smaller is refused so an underpaid wallet is not marked settled.
function rowPaidBy(tx, { mint, wallet, minRaw } = {}) {
  if (!tx) return { ok: false, why: "transaction not found on chain" };
  if (tx.meta && tx.meta.err) return { ok: false, why: "transaction failed on chain" };
  if (!mint || !wallet) return { ok: false, why: "no mint or wallet to check against" };
  const delta = tokenDeltas(tx, mint).get(wallet) || 0n;
  if (delta <= 0n) return { ok: false, why: "no " + mint.slice(0, 6) + "… reached this wallet in that transaction", deltaRaw: delta.toString() };
  const need = big(minRaw);
  if (need !== null && need > 0n) {
    const floor = need - need / 1000n;
    if (delta < floor) return { ok: false, why: "transfer smaller than the amount owed (" + delta.toString() + " < " + need.toString() + ")", deltaRaw: delta.toString() };
  }
  return { ok: true, deltaRaw: delta.toString() };
}

module.exports = { tokenDeltas, rowPaidBy };
