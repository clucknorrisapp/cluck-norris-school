"use strict";
// The Hub ledger — the partition, the settlement journal, batches, receipts and funding status.
// Pure: state in, state out; the caller persists. Nothing here signs or sends.
//
// THE PARTITION (design §2 as restated in Addendum B2), per wallet per project:
//
//   accrued = available + reserved + paidApplied
//
//   accrued       Σ credits written by the accrual tick — the total earned, ever
//   paidTotal     Σ every verified transfer settled to this wallet (journal entries)
//   paidApplied   min(paidTotal, accrued) — the ONLY `paid` term of the partition
//   excess        paidTotal − paidApplied — never negative, never credited as accrual, never
//                 nets against another wallet; future accrual is applied against it first
//   reserved      rows sitting in a batch that are not yet settled or waived
//   available     accrued − paidApplied − reserved — the only number a new batch may draw on
//
// THE JOURNAL (Addendum B1): settlement is ONE durable write, keyed by the chain's own identity of
// the transfer, `settle:<sig>:<instructionIndex>[:<innerIndex>]`. "This identity is consumed" and
// "this row received this transfer" are both READ FROM the journal; the row's paid state and the
// consumed set are derived indexes, recomputed from the journal every time. There is no unconsume.

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };
const nz = (v) => (v < 0n ? 0n : v);
const str = (v) => v.toString();

function xferKeyOf({ sig, instructionIndex, innerIndex }) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(String(sig || ""))) throw new Error("a settlement needs the transaction signature");
  if (!Number.isInteger(instructionIndex) || instructionIndex < 0) throw new Error("a settlement needs the instruction index of the transfer");
  const inner = Number.isInteger(innerIndex) && innerIndex >= 0 ? `:${innerIndex}` : "";
  return `settle:${sig}:${instructionIndex}${inner}`;
}

// Σ credits per wallet across every period. Same shape lib/cuna-payout.totalCredits reads.
function accruedByWallet(days) {
  const out = {};
  for (const d of Object.values(days || {})) {
    if (!d || !d.credits) continue;
    for (const [w, raw] of Object.entries(d.credits)) {
      const v = big(raw);
      if (v === null || v <= 0n) continue;
      out[w] = (out[w] || 0n) + v;
    }
  }
  return out;
}

// Journal entries that belong to one project (the journal is global; the project is metadata).
function journalFor(journal, projectId) {
  return Object.values(journal || {}).filter((e) => e && e.projectId === projectId);
}

// Row projection, derived from the journal: what a (batch, wallet) row has received.
function rowState(batch, wallet, entries) {
  const amount = big(batch && batch.amounts && batch.amounts[wallet]);
  if (amount === null || amount <= 0n) return null;
  const mine = entries.filter((e) => e.batchId === batch.id && e.wallet === wallet).sort((a, b) => (a.at - b.at) || (a.slot - b.slot));
  let applied = 0n, total = 0n, excess = 0n;
  for (const e of mine) { applied += big(e.appliedRaw) || 0n; total += big(e.amountRaw) || 0n; excess += big(e.excessRaw) || 0n; }
  const waived = big(batch.waived && batch.waived[wallet] && batch.waived[wallet].amountRaw) || 0n;
  const remaining = nz(amount - applied - waived);
  const state = remaining === 0n ? (applied > 0n ? "paid" : "waived") : applied > 0n ? "partial" : "pending";
  return { wallet, amountRaw: str(amount), appliedRaw: str(applied), paidTotalRaw: str(total), excessRaw: str(excess), waivedRaw: str(waived), remainingRaw: str(remaining), state, settlements: mine };
}

// Everything reserved: pending batches hold every unsettled remainder; a closed batch (cancelled
// after some rows settled) still holds the remainder of its PARTIAL rows — a partial row's
// remainder never returns to available except by an owner waive (test 5, rev 4).
function reservedByWallet(batches, entries) {
  const out = {};
  for (const b of Object.values(batches || {})) {
    if (!b || !b.amounts) continue;
    if (b.state !== "pending" && b.state !== "closed") continue;
    for (const w of Object.keys(b.amounts)) {
      const r = rowState(b, w, entries);
      if (!r) continue;
      const rem = big(r.remainingRaw) || 0n;
      if (rem === 0n) continue;
      if (b.state === "closed" && r.state !== "partial") continue;   // cancelled-untouched rows went back
      out[w] = (out[w] || 0n) + rem;
    }
  }
  return out;
}

// The partition for every wallet the project has ever credited or paid.
function partition({ projectId, days, batches, journal }) {
  const entries = journalFor(journal, projectId);
  const accrued = accruedByWallet(days);
  const reserved = reservedByWallet(batches, entries);
  const paidTotal = {};
  for (const e of entries) paidTotal[e.wallet] = (paidTotal[e.wallet] || 0n) + (big(e.amountRaw) || 0n);
  const wallets = new Set([...Object.keys(accrued), ...Object.keys(paidTotal), ...Object.keys(reserved)]);
  const out = {};
  for (const w of [...wallets].sort()) {
    const a = accrued[w] || 0n, pt = paidTotal[w] || 0n, rsv = reserved[w] || 0n;
    const applied = pt < a ? pt : a;
    const excess = pt - applied;
    // availableRaw is SIGNED on purpose: it is non-negative by construction, and if it ever is not,
    // checkInvariant must be able to see it rather than have a floor hide the corruption.
    const available = a - applied - rsv;
    out[w] = {
      accruedRaw: str(a), paidTotalRaw: str(pt), paidAppliedRaw: str(applied), excessRaw: str(excess),
      reservedRaw: str(rsv), availableRaw: str(available),
      obligationRaw: str(a - applied),
    };
  }
  return out;
}

// The CI invariant: for every wallet, accrued == available + reserved + paidApplied, with
// available >= 0. Returns the violations (empty = holds).
function checkInvariant(part) {
  const bad = [];
  for (const [w, p] of Object.entries(part || {})) {
    const a = big(p.accruedRaw), av = big(p.availableRaw), r = big(p.reservedRaw), pa = big(p.paidAppliedRaw);
    if (av < 0n) bad.push({ wallet: w, why: `available is negative (${av})` });
    if (a !== av + r + pa) bad.push({ wallet: w, why: `accrued ${a} != available ${av} + reserved ${r} + paidApplied ${pa}` });
    if (big(p.excessRaw) < 0n) bad.push({ wallet: w, why: "excess is negative" });
  }
  return bad;
}

// A batch draws ONLY on `available`, project-scoped, deterministic for the same inputs.
function buildBatch({ projectId, programVersion, periods, part, batchId, nowUnix, minPayoutRaw = 0n }) {
  if (!batchId) throw new Error("a batch needs an id");
  if (!programVersion || !programVersion.hash) throw new Error("a batch needs the program version it pays under");
  const floor = big(minPayoutRaw);
  const amounts = {}, skipped = {};
  let total = 0n;
  for (const w of Object.keys(part || {}).sort()) {
    const v = big(part[w].availableRaw);
    if (v === null || v <= 0n) continue;
    if (v < floor) { skipped[w] = str(v); continue; }
    amounts[w] = str(v); total += v;
  }
  return {
    id: batchId, projectId, programVersion: programVersion.version, programHash: programVersion.hash,
    rewardMint: programVersion.rewardMint, rewardDecimals: programVersion.rewardDecimals,
    periods: Array.isArray(periods) ? [...periods] : [],
    state: "pending", at: Number(nowUnix) || 0,
    amounts, skippedBelowFloor: skipped, totalRaw: str(total), count: Object.keys(amounts).length,
    reservedFundingRaw: str(total), waived: {},
  };
}

// ONE settlement: verify was done by the caller (token program, mint, source = fundingWallet,
// destination owner, raw amount — against THIS row); this records it, once, or explains why not.
// Returns { ok, journal, entry } or { ok:false, error, owner }. The caller writes `journal` in a
// single kv put; a crash before that write consumed nothing, a crash after it is idempotent.
function settle({ journal, projectId, batch, wallet, transfer, nowUnix }) {
  const { sig, instructionIndex, innerIndex, amountRaw, slot, verifiedBy = "getTransaction" } = transfer || {};
  const key = xferKeyOf({ sig, instructionIndex, innerIndex });
  if (!batch || batch.projectId !== projectId) return { ok: false, error: "batch_not_in_project", owner: batch ? { projectId: batch.projectId, batchId: batch.id } : null };
  const amount = big(amountRaw);
  if (amount === null || amount <= 0n) return { ok: false, error: "transfer_amount_invalid" };
  const existing = (journal || {})[key];
  if (existing) {
    if (existing.projectId === projectId && existing.batchId === batch.id && existing.wallet === wallet) return { ok: true, journal, entry: existing, idempotent: true };
    return { ok: false, error: "transfer_already_consumed", owner: { projectId: existing.projectId, batchId: existing.batchId, wallet: existing.wallet } };
  }
  const row = rowState(batch, wallet, journalFor(journal, projectId));
  if (!row) return { ok: false, error: "row_not_in_batch" };
  const remaining = big(row.remainingRaw);
  // adv P1-3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 2 #1): a row that is already fully
  // settled (remaining === 0) must REFUSE a further transfer, never record it as an applied:0 /
  // excess-only entry. Writing that entry is what let an unrelated genuine transfer be stapled
  // onto an already-paid row and printed as "the project paid this holder N tokens" in the public
  // receipt — a forgery, not a double-pay (owedNow is unaffected), but a real one. A transfer that
  // lands after the row is already fully paid is real money the holder received some other way;
  // it is simply not THIS row's settlement, and nothing here may claim otherwise.
  if (remaining === 0n) return { ok: false, error: "row_already_settled" };
  const applied = amount < remaining ? amount : remaining;
  const entry = {
    xferKey: key, sig, instructionIndex, innerIndex: Number.isInteger(innerIndex) ? innerIndex : null,
    projectId, batchId: batch.id, rowId: wallet, wallet,
    amountRaw: str(amount), appliedRaw: str(applied), excessRaw: str(amount - applied),
    slot: Number(slot) || 0, at: Number(nowUnix) || 0, verifiedBy,
  };
  return { ok: true, journal: { ...(journal || {}), [key]: entry }, entry };
}

// Derived index: the consumed set, rebuilt from the journal (what boot and reconcile do).
function consumedSet(journal) { return new Set(Object.keys(journal || {})); }

// Batch projection: the row states and whether the batch has fully settled.
function batchView(batch, journal) {
  const entries = journalFor(journal, batch.projectId);
  const rows = {};
  let allDone = true;
  for (const w of Object.keys(batch.amounts || {})) {
    const r = rowState(batch, w, entries);
    rows[w] = r;
    if (r && r.remainingRaw !== "0") allDone = false;
  }
  const state = batch.state === "pending" && allDone && Object.keys(rows).length ? "sent" : batch.state;
  return { ...batch, state, rows };
}

// Cancel: rows with NO settlement go back to available; rows with a partial settlement keep
// their remainder reserved (only a new attempt for exactly that remainder, or an owner waive,
// can touch it); fully paid rows stay paid. "cancelled" if nothing settled, else "closed".
function cancelBatch({ batch, journal }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be cancelled");
  const v = batchView(batch, journal);
  const anySettled = Object.values(v.rows).some((r) => r && r.appliedRaw !== "0");
  return { ...batch, state: anySettled ? "closed" : "cancelled" };
}

// Owner-only, logged: release a partial row's remainder back to available. Still owed — the next
// batch draws it. Not an operator action.
function waiveRemainder({ batch, journal, wallet, by, nowUnix, reason }) {
  if (by !== "owner") throw new Error("only the owner may waive a remainder");
  const r = rowState(batch, wallet, journalFor(journal, batch.projectId));
  if (!r) throw new Error("row_not_in_batch");
  if (r.remainingRaw === "0") throw new Error("nothing remaining on this row");
  const waived = { ...(batch.waived || {}), [wallet]: { amountRaw: r.remainingRaw, by, at: Number(nowUnix) || 0, reason: String(reason || "") } };
  return { ...batch, waived };
}

// Receipt (Addendum B3): an aggregate per (batch, wallet) with append-only settlements. Null when
// the row does not exist — the route 404s on null and never invents a receipt.
function receipt({ projectId, batch, wallet, journal, project }) {
  if (!batch || batch.projectId !== projectId) return null;
  const r = rowState(batch, wallet, journalFor(journal, projectId));
  if (!r) return null;
  return {
    projectId, batchId: batch.id, programVersion: batch.programVersion, programHash: batch.programHash,
    rewardMint: batch.rewardMint, rewardDecimals: batch.rewardDecimals, periods: batch.periods || [],
    wallet, state: r.state,
    totals: { owedRaw: r.amountRaw, appliedRaw: r.appliedRaw, excessRaw: r.excessRaw, remainingRaw: r.remainingRaw, waivedRaw: r.waivedRaw },
    settlements: r.settlements.map((e) => ({ xferKey: e.xferKey, sig: e.sig, instructionIndex: e.instructionIndex, innerIndex: e.innerIndex, slot: e.slot, at: e.at, amountRaw: e.amountRaw, appliedRaw: e.appliedRaw, excessRaw: e.excessRaw, verifiedBy: e.verifiedBy })),
    claims: {
      paymentVerified: r.settlements.length > 0,
      calculationReproducible: null,   // set by the reproduce export, never assumed here
    },
    fundingWallet: project ? project.fundingWallet : null,
  };
}

// Funding status (design §2 + Addendum A): three different numbers, never one "funded" boolean.
// `observed` is { balanceRaw, at } from an on-chain read, or null when the read failed — null is
// shown as unavailable, never as zero.
function fundingStatus({ part, batches, journal, projectId, observed, sharedWith = [] }) {
  let obligations = 0n, reserved = 0n;
  for (const p of Object.values(part || {})) { obligations += big(p.obligationRaw) || 0n; reserved += big(p.reservedRaw) || 0n; }
  const obs = observed && observed.balanceRaw != null ? big(observed.balanceRaw) : null;
  return {
    obligationsRaw: str(obligations),
    reservedRaw: str(reserved),
    observedBalanceRaw: obs === null ? null : str(obs),
    observedAt: obs === null ? null : Number(observed.at) || null,
    shortfallRaw: obs === null ? null : str(nz(obligations - obs)),
    sharedFunding: Array.isArray(sharedWith) && sharedWith.length > 0,
    sharedWith: [...(sharedWith || [])],
    note: obs === null ? "funding wallet balance unavailable" : "an observed balance is not reserved funding; a scheduled unlock is not funding",
  };
}

module.exports = { xferKeyOf, accruedByWallet, journalFor, rowState, reservedByWallet, partition, checkInvariant, buildBatch, settle, consumedSet, batchView, cancelBatch, waiveRemainder, receipt, fundingStatus };
