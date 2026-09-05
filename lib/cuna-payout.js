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

// Sending someone 3 CUNA costs more in fees and rent than the 3 CUNA is worth, and it clutters the
// batch. Dust stays owed and rolls into the next payout rather than being dropped.
const DEFAULT_MIN_PAYOUT_RAW = 1000n * 10n ** 9n;   // 1,000 CUNA

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

// The batch landed. Its amounts move from pending to paid — and ONLY its amounts, so an accrual
// that happened while it was in flight is untouched and still owed.
function confirmBatch({ batch, paid }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be confirmed");
  const next = { ...(paid || {}) };
  for (const [w, raw] of Object.entries(batch.amounts || {})) {
    const v = big(raw);
    if (v === null || v <= 0n) continue;
    next[w] = ((big(next[w]) || 0n) + v).toString();
  }
  return { paid: next, batch: { ...batch, state: "sent" } };
}

// The batch never went. Its amounts go straight back to owed — nothing is written to paid.
function cancelBatch({ batch }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be cancelled");
  return { ...batch, state: "cancelled" };
}

module.exports = {
  DEFAULT_MIN_PAYOUT_RAW, totalCredits, owedNow, buildBatch, toAirdropLines, confirmBatch, cancelBatch,
};
