"use strict";
// Turning the accrual ledger into a payout, exactly once.
//
// Accrual writes what each wallet is OWED. Getting tokens to them is an owner-signed airdrop, and
// the gap between those two facts is where a payout system pays somebody twice. This module is the
// bookkeeping across that gap; it signs nothing and sends nothing.
//
// The shape:
//   credits   what accrual says each wallet has earned, ever            (grows daily)
//   paid      what has actually been sent, confirmed                    (only grows on confirmation)
//   pending   a batch exported for sending but not yet confirmed        (held aside meanwhile)
//
//   owed = credits - paid - pending
//
// The `pending` third of that is the whole point. Export a batch, get distracted, export again, and
// without it the same money appears in two batches and goes out twice. A pending batch is held
// aside the moment it is created and only becomes `paid` when the owner confirms it landed — or is
// released back to owed if it never went.

// NO MINIMUM PAYOUT (owner, 2026-09-05). Every recipient already holds CUNA and has a lock, so
// their token account exists — there is no rent to create one, just a per-transfer fee that is
// fractions of a cent inside a batch. A floor would also get MORE exclusionary as the price rises,
// which is backwards: it would quietly stop paying the smallest holders exactly as their rewards
// became worth something.
//
// The knob stays, defaulted off, because the floor is the right tool if fees ever change.
const DEFAULT_MIN_PAYOUT_RAW = 0n;

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };

// Everything each wallet has earned across every accrued day.
function totalCredits(days) {
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

// What is owed right now, per wallet. Anything already paid or sitting in a pending batch is
// subtracted. Never negative: an over-payment (a manual send outside this system) shows as zero
// owed, not as a debt the next batch would try to claw back.
function owedNow({ days, paid, pending }) {
  const credits = totalCredits(days);
  const out = {};
  const held = {};
  for (const b of Object.values(pending || {})) {
    if (!b || b.state !== "pending" || !b.amounts) continue;
    for (const [w, raw] of Object.entries(b.amounts)) {
      // A row that has already been SENT inside this batch is in `paid` — holding it here as well
      // would subtract it twice and understate what the wallet is owed.
      if (b.sent && b.sent[w]) continue;
      const v = big(raw);
      if (v && v > 0n) held[w] = (held[w] || 0n) + v;
    }
  }
  for (const [w, earned] of Object.entries(credits)) {
    const already = (big((paid || {})[w]) || 0n) + (held[w] || 0n);
    const left = earned - already;
    out[w] = left > 0n ? left : 0n;
  }
  return out;
}

// A batch to hand to the airdropper. Wallets below the dust floor are left owed, not dropped.
function buildBatch({ owed, minPayoutRaw = DEFAULT_MIN_PAYOUT_RAW, batchId, nowUnix }) {
  const floor = big(minPayoutRaw);
  if (floor === null || floor < 0n) throw new Error(`minPayoutRaw must be whole base units: got ${minPayoutRaw}`);
  if (!batchId) throw new Error("a batch needs an id");
  const amounts = {};
  const skipped = {};
  let totalRaw = 0n;
  // Sorted, so the same owed set always produces the same batch and the same file.
  for (const w of Object.keys(owed || {}).sort()) {
    const v = big(owed[w]);
    if (v === null || v <= 0n) continue;
    if (v < floor) { skipped[w] = v.toString(); continue; }
    amounts[w] = v.toString();
    totalRaw += v;
  }
  return {
    id: batchId, state: "pending", at: Number(nowUnix) || 0,
    amounts, skippedBelowFloor: skipped,
    totalRaw: totalRaw.toString(), count: Object.keys(amounts).length,
  };
}

// The airdropper's manual format: "wallet, amount" per line, in whole tokens.
//
// Whole tokens are produced by STRING surgery on the raw amount, never by dividing. A payout line
// is the last place to introduce a float: 1,276,382.123456789 CUNA does not survive a JS number,
// and the number that comes out of that division is what somebody actually receives.
function toAirdropLines(amounts, decimals = 9) {
  const lines = [];
  for (const w of Object.keys(amounts || {}).sort()) {
    let s = String(amounts[w]);
    if (s.length <= decimals) s = "0".repeat(decimals - s.length + 1) + s;
    const whole = s.slice(0, s.length - decimals);
    const frac = s.slice(s.length - decimals).replace(/0+$/, "");
    lines.push(`${w}, ${whole}${frac ? "." + frac : ""}`);
  }
  return lines.join("\n");
}

// The rows that still have to go: the batch's amounts minus anything already recorded as sent.
function remainingOf(batch) {
  const out = {};
  for (const [w, raw] of Object.entries((batch && batch.amounts) || {})) {
    if (batch.sent && batch.sent[w]) continue;
    out[w] = raw;
  }
  return out;
}

// PER-WALLET confirmation — the fix for the partial send.
//
// The airdrop engine sends a batch as several transactions and routinely comes back with "37
// landed, 15 failed". With only confirm-all and cancel-all, both moves are wrong: confirm marks the
// 15 paid (they never are), cancel returns the 37 to owed (they are paid twice next week). This
// records exactly the rows whose transaction CONFIRMED, each with its signature, the moment it
// did. What is left is exactly what still has to go, and a retry sends only that.
//
// A row is recorded once: a second report for the same wallet is ignored, not summed, so a
// duplicated callback or a replayed request cannot inflate `paid`. The batch stays pending until
// every row is sent, then flips to "sent" on its own.
function recordSent({ batch, paid, results, nowUnix }) {
  // ANY batch state. A transaction that confirmed while the batch was being closed in another tab
  // still moved money; refusing to record it returned the row to owed and paid it again next week.
  // The dedup below is what protects against double counting, not the batch state.
  if (!batch || !batch.amounts) throw new Error("no such batch");
  const nextPaid = { ...(paid || {}) };
  const sent = { ...(batch.sent || {}) };
  const recorded = [], ignored = [];
  for (const r of results || []) {
    const w = r && String(r.wallet || "");
    const sig = r && String(r.sig || "").trim();
    if (!w || !(w in (batch.amounts || {}))) { ignored.push({ wallet: w, why: "not in this batch" }); continue; }
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) { ignored.push({ wallet: w, why: "no transaction signature" }); continue; }
    if (sent[w]) { ignored.push({ wallet: w, why: "already recorded" }); continue; }
    const v = big(batch.amounts[w]);
    if (v === null || v <= 0n) { ignored.push({ wallet: w, why: "zero amount" }); continue; }
    nextPaid[w] = ((big(nextPaid[w]) || 0n) + v).toString();
    sent[w] = { sig, at: Number(nowUnix) || 0 };
    recorded.push(w);
  }
  const allSent = Object.keys(batch.amounts || {}).every((w) => sent[w]);
  // Only a PENDING batch completes itself; a closed or cancelled one keeps its state and just
  // carries the extra recorded rows.
  const state = batch.state === "pending" && allSent ? "sent" : batch.state;
  const next = { ...batch, sent, state };
  if (state === "sent" && !next.completedAt) next.completedAt = Number(nowUnix) || 0;
  return { paid: nextPaid, batch: next, recorded, ignored, remaining: remainingOf(next) };
}

// The batch landed IN FULL, confirmed by hand. Kept for the manual flow; the page records rows
// one at a time through recordSent instead. Rows already recorded are not counted twice.
function confirmBatch({ batch, paid, nowUnix }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be confirmed");
  const next = { ...(paid || {}) };
  const sent = { ...(batch.sent || {}) };
  for (const [w, raw] of Object.entries(batch.amounts || {})) {
    if (sent[w]) continue;
    const v = big(raw);
    if (v === null || v <= 0n) continue;
    next[w] = ((big(next[w]) || 0n) + v).toString();
    sent[w] = { sig: null, at: Number(nowUnix) || 0, manual: true };
  }
  return { paid: next, batch: { ...batch, sent, state: "sent" } };
}

// Stop a batch. Rows already SENT stay paid (they are); rows never sent go straight back to owed —
// nothing is written to paid for them. A batch with no sent rows is "cancelled"; one that went
// partway is "closed", so the history says which.
function cancelBatch({ batch }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be cancelled");
  const anySent = Object.keys(batch.sent || {}).length > 0;
  return { ...batch, state: anySent ? "closed" : "cancelled" };
}

module.exports = {
  DEFAULT_MIN_PAYOUT_RAW, totalCredits, owedNow, buildBatch, toAirdropLines,
  remainingOf, recordSent, confirmBatch, cancelBatch,
};
