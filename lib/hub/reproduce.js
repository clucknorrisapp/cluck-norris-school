"use strict";
// lib/hub/reproduce.js — E1 (docs/COLOSSEUM_ROADMAP.md §1 "The number"): the pure core a reader's
// own machine and the server share to check whether a Hub receipt can be RE-DERIVED from published
// inputs, not merely re-displayed. No I/O — every input here is already-loaded data (a batch, the
// accrual `days`, the project's other batches); the caller (scripts/reproduce-receipt.cjs, or the
// /api/hub/:project/... routes in server.js) does the fetching or the kv reads.
//
// Today this covers ONE kind: "lock-to-earn" (which CUNA is aliased onto — lib/hub/store.js). The
// live payout that produces a lock-to-earn receipt is lib/cuna-payout.js's buildBatch/recordSent,
// shared by both /cuna-payout and /api/hub/:project/payout (lib/hub/routes.js) — NOT the
// hashed-program-version settlement journal in lib/hub/ledger.js (Addendum B), which is pure and
// tested (scripts/hub-core-test.cjs) but not yet wired to any live route. So a lock-to-earn batch
// carries no program-version hash of its own today; `reproduce()` reports that honestly (hash:
// null) rather than inventing one. Buy competitions, Buy Special draws and the CUNA giveaway are
// each their own kind on the Hub page (lib/hub/public.js) and are NOT reproduced here yet —
// `reproduce()` and `projectReproducibility()` say so as MISSING_INPUTS, naming the kind, rather
// than silently reporting them as reproducible or dropping them from the ratio.
//
// THE ARITHMETIC (mirrors lib/cuna-payout.js exactly, reconstructed from durable, timestamped
// data instead of live state):
//
//   owed(wallet) at the moment a batch was built = every earlier period's credit for that wallet
//                                                   − whatever was already PAID by then
//                                                   − whatever another batch was still HOLDING then
//
// A period's credit is "earlier" if its accrual tick's own timestamp (`days[key].at`) is at or
// before the batch's own creation time (`batch.at`) — periods are never re-accrued once written,
// so this is exact. "Paid by then" and "held by then" are reconstructed from every OTHER batch's
// own timestamps (`at`, `sent[wallet].at`, `cancelledAt`) — batches are never deleted, so nothing
// here needs a separate historical snapshot; the batch store already retains it. This is only ever
// computed for a wallet whose row in this batch is already SENT (a receipt exists) — the same
// public/private line lib/hub/public.js draws: an unsent row is never made public here either.

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };
const nz = (v) => (v < 0n ? 0n : v);

// Every period whose credit for `wallet` had already been written by `uptoAt` (inclusive) — the
// exact set lib/cuna-payout.js's totalCredits/owedNow summed at the moment the batch was built.
function periodsCreditedTo(days, wallet, uptoAt) {
  const out = [];
  for (const [key, d] of Object.entries(days || {})) {
    if (!d || !d.credits) continue;
    const raw = d.credits[wallet];
    if (raw == null) continue;
    const v = big(raw);
    if (v === null || v <= 0n) continue;
    const at = Number(d.at);
    if (!Number.isFinite(at) || at > Number(uptoAt)) continue;
    out.push({ key, at, creditRaw: v.toString() });
  }
  out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// Was `wallet`'s row in batch `b` already recorded PAID (sent[wallet].at) before `uptoAt`?
function paidBefore(b, wallet, uptoAt) {
  if (!b || !b.amounts || !(wallet in b.amounts)) return 0n;
  const s = b.sent && b.sent[wallet];
  if (!s) return 0n;
  const at = Number(s.at);
  return Number.isFinite(at) && at < Number(uptoAt) ? (big(b.amounts[wallet]) || 0n) : 0n;
}

// Was `wallet`'s row in batch `b` RESERVED — created and not yet paid or released — at `uptoAt`?
function heldAt(b, wallet, uptoAt) {
  if (!b || !b.amounts || !(wallet in b.amounts)) return false;
  const T = Number(uptoAt);
  const at = Number(b.at);
  if (!Number.isFinite(at) || !(at < T)) return false;                 // not created yet
  if (b.cancelledAt != null && Number(b.cancelledAt) < T) return false; // released before T
  const s = b.sent && b.sent[wallet];
  if (s && Number(s.at) < T) return false;                             // already paid before T
  return true;
}

// Reconstructs, purely from the batch store's own timestamps, what `owedNow` actually consumed
// for `wallet` at the instant `batch` (excluded from the scan) was created.
function priorState(batches, wallet, excludeBatchId, uptoAt) {
  let paid = 0n, reserved = 0n;
  for (const [id, b] of Object.entries(batches || {})) {
    if (id === excludeBatchId) continue;
    paid += paidBefore(b, wallet, uptoAt);
    if (heldAt(b, wallet, uptoAt)) reserved += big(b.amounts[wallet]) || 0n;
  }
  return { paidRaw: paid.toString(), reservedRaw: reserved.toString() };
}

// The published inputs for one (batch, wallet) row — what the settlement that produced this
// receipt actually used. Only ever built for a wallet already SENT in this batch.
function buildInputsForWallet({ batch, wallet, days, batches }) {
  if (!batch || !batch.amounts || !(wallet in batch.amounts)) return null;
  if (!batch.sent || !batch.sent[wallet]) return null;   // not yet public — see lib/hub/public.js
  const uptoAt = Number(batch.at);
  const periods = periodsCreditedTo(days, wallet, uptoAt);
  const prior = priorState(batches, wallet, batch.id, uptoAt);
  return {
    kind: "lock-to-earn", batchId: batch.id, batchAt: uptoAt, wallet,
    amountRaw: String(batch.amounts[wallet]),
    periods, priorPaidRaw: prior.paidRaw, priorReservedRaw: prior.reservedRaw,
  };
}

// Every wallet already public through this batch (a sent row) — never an unsent one.
function buildBatchInputs({ batch, days, batches }) {
  const out = {};
  for (const wallet of Object.keys((batch && batch.sent) || {})) {
    const inp = buildInputsForWallet({ batch, wallet, days, batches });
    if (inp) out[wallet] = inp;
  }
  return out;
}

// The pure check. `programVersion` (a { hash, ... } or null) is carried through only for the
// report — the arithmetic is entirely in `inputs`. `receipt` is the published claim: at minimum
// { amountRaw }. `inputs` is what buildInputsForWallet returns (or null/partial when unavailable).
function reproduce({ programVersion, inputs, receipt } = {}) {
  const hash = (programVersion && programVersion.hash) || null;
  const missing = [];
  if (!receipt || receipt.amountRaw == null) missing.push("receipt.amountRaw (the published amount)");
  if (!inputs) {
    missing.push("the batch's published inputs (periods, prior paid, prior reserved)");
  } else {
    if (!Array.isArray(inputs.periods)) missing.push("inputs.periods");
    if (inputs.priorPaidRaw == null) missing.push("inputs.priorPaidRaw");
    if (inputs.priorReservedRaw == null) missing.push("inputs.priorReservedRaw");
  }
  if (missing.length) {
    return { status: "MISSING_INPUTS", published: receipt && receipt.amountRaw != null ? String(receipt.amountRaw) : null, reproduced: null, hash, missing };
  }

  let credited = 0n;
  for (const p of inputs.periods) {
    const v = big(p && p.creditRaw);
    if (v !== null && v > 0n) credited += v;
  }
  const priorPaid = big(inputs.priorPaidRaw), priorReserved = big(inputs.priorReservedRaw);
  if (priorPaid === null || priorReserved === null) {
    return { status: "MISSING_INPUTS", published: String(receipt.amountRaw), reproduced: null, hash, missing: ["inputs.priorPaidRaw / inputs.priorReservedRaw (not whole numbers)"] };
  }
  const reproduced = nz(credited - priorPaid - priorReserved);
  const published = big(receipt.amountRaw);
  if (published === null) {
    return { status: "MISSING_INPUTS", published: null, reproduced: reproduced.toString(), hash, missing: ["receipt.amountRaw (not a whole number)"] };
  }
  return { status: reproduced === published ? "MATCH" : "MISMATCH", published: published.toString(), reproduced: reproduced.toString(), hash, missing: [] };
}

// Runs reproduce() over every settled (sent) row of every lock-to-earn batch in `batches`, plus
// every payout row of every OTHER program kind supplied via `otherPrograms` — those are reported
// as MISSING_INPUTS naming the kind, since this file does not reproduce them (yet), rather than
// silently excluding them from the denominator or, worse, counting them as reproduced.
function projectReproducibility({ batches, days, otherPrograms = [] } = {}) {
  const out = [];
  let totalAll = 0, reproducedAll = 0;
  for (const [id, b] of Object.entries(batches || {})) {
    const wallets = Object.keys((b && b.sent) || {});
    if (!wallets.length) continue;
    let total = 0, reproduced = 0, mismatched = 0, missingInputs = 0;
    for (const wallet of wallets) {
      total++;
      const inputs = buildInputsForWallet({ batch: b, wallet, days, batches });
      const r = reproduce({ programVersion: null, inputs, receipt: { amountRaw: inputs ? inputs.amountRaw : (b.amounts && b.amounts[wallet]) } });
      if (r.status === "MATCH") reproduced++;
      else if (r.status === "MISMATCH") mismatched++;
      else missingInputs++;
    }
    const period = Number.isFinite(Number(b.at)) ? new Date(Number(b.at) * 1000).toISOString().slice(0, 10) : null;
    out.push({ batchId: id, kind: "lock-to-earn", total, reproduced, mismatched, missingInputs, period });
    totalAll += total; reproducedAll += reproduced;
  }
  for (const p of otherPrograms || []) {
    const rows = (p && Array.isArray(p.payouts) ? p.payouts : []).filter((x) => x && x.sig);
    if (!rows.length) continue;
    out.push({ batchId: p.id, kind: p.kind, total: rows.length, reproduced: 0, mismatched: 0, missingInputs: rows.length, period: null, note: `reproduction is not implemented yet for kind "${p.kind}"` });
    totalAll += rows.length;
  }
  out.sort((a, b) => (a.period || "").localeCompare(b.period || "") || String(a.batchId).localeCompare(String(b.batchId)));
  return { batches: out, overall: { total: totalAll, reproduced: reproducedAll } };
}

module.exports = { periodsCreditedTo, paidBefore, heldAt, priorState, buildInputsForWallet, buildBatchInputs, reproduce, projectReproducibility };
