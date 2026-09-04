"use strict";
// Tests for lib/cuna-staking.js. Zero dependencies, so this runs in the node-check CI job.
//
// The cases here are the ways this programme could quietly pay out wrongly: a cancelable lock
// earning on tokens it can withdraw, the treasury's own vesting farming its own emission, a
// matured lock going negative, and integer division destroying tokens a hundred base units a day.

const assert = require("assert");
const s = require("../lib/cuna-staking");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const DAY = 86400;
const NOW = 1_800_000_000;
const START = NOW - 30 * DAY;            // programme launched 30 days ago
const CFG = { mint: "CUNA", startAfterUnix: START, minDurationDays: 365, minCliffDays: 180 };

// A lock that qualifies: created after launch, 1 year, 6 month cliff, non-cancelable.
// NOTE the shape: duration and cliff are measured from the lock's OWN createdAt, so a fixture
// must move both together. Overriding fullyVestedAt alone produces a 210-day lock that is
// correctly rejected — which is how the first version of these tests fooled itself.
const good = (over = {}) => ({
  escrow: "E1", mint: "CUNA", recipient: "Alice", amountRaw: "1000000000000",   // 1,000 CUNA @ 9dp
  cancelable: false, createdAt: NOW - 10 * DAY,
  cliffTime: NOW - 10 * DAY + 180 * DAY, fullyVestedAt: NOW - 10 * DAY + 365 * DAY, ...over,
});
// A qualifying lock of a chosen DURATION, created `agoDays` ago. Because the minimum is a year,
// every live qualifying lock has at least ~355 days left — the weight spread comes from people
// choosing longer terms, not from maturity.
const lockFor = (durationDays, { agoDays = 1, ...over } = {}) => {
  const created = NOW - agoDays * DAY;
  return good({ createdAt: created, cliffTime: created + 180 * DAY,
                fullyVestedAt: created + durationDays * DAY, ...over });
};

section("qualification — the rules that keep the pool honest");

t("a compliant lock qualifies", () => {
  assert.deepStrictEqual(s.disqualify(good(), CFG), []);
  assert.strictEqual(s.qualifies(good(), CFG), true);
});

t("THE ONE THAT MATTERS: a cancelable lock never qualifies", () => {
  // Otherwise you earn yield on tokens you can pull back whenever you like.
  const why = s.disqualify(good({ cancelable: true }), CFG);
  assert.ok(why.some((r) => /cancelable/.test(r)), why.join("; "));
});

t("THE OTHER ONE: pre-launch locks are excluded, which is what stops the treasury paying itself", () => {
  const why = s.disqualify(good({ createdAt: START - DAY }), CFG);
  assert.ok(why.some((r) => /before the programme started/.test(r)), why.join("; "));
});

t("a real treasury vesting lock (huge, old, long) is refused on the cutoff alone", () => {
  // Shaped like the 7.1B of CUNA already in escrow: it would otherwise eat the entire pool.
  const treasury = good({ escrow: "T", recipient: "Treasury", amountRaw: "175000000000000000",
    createdAt: START - 200 * DAY, cliffTime: START - 200 * DAY + 200 * DAY,
    fullyVestedAt: START - 200 * DAY + 900 * DAY });
  assert.strictEqual(s.qualifies(treasury, CFG), false);
});

t("a short lock and a short cliff are both refused, and both reported", () => {
  const c = good({ createdAt: NOW, cliffTime: NOW + 30 * DAY, fullyVestedAt: NOW + 90 * DAY });
  const why = s.disqualify(c, CFG);
  assert.ok(why.some((r) => /cliff shorter/.test(r)), why.join("; "));
  assert.ok(why.some((r) => /less than 365 days/.test(r)), why.join("; "));
  assert.ok(why.length >= 2, "every failing rule should be reported, not just the first");
});

t("another token, a zero amount, and an excluded wallet are all refused", () => {
  assert.strictEqual(s.qualifies(good({ mint: "OTHER" }), CFG), false);
  assert.strictEqual(s.qualifies(good({ amountRaw: "0" }), CFG), false);
  assert.strictEqual(s.qualifies(good(), { ...CFG, excludeWallets: ["Alice"] }), false);
});

section("weight");

t("weight is amount x whole days remaining", () => {
  const l = good({ fullyVestedAt: NOW + 100 * DAY });
  assert.strictEqual(s.weightOf(l, NOW), BigInt("1000000000000") * 100n);
});

t("a matured lock weighs ZERO, never negative", () => {
  // A negative weight would subtract from the total and hand everyone else more than the pool.
  const l = good({ fullyVestedAt: NOW - 50 * DAY });
  assert.strictEqual(s.weightOf(l, NOW), 0n);
});

t("weight decays as the lock matures", () => {
  const l = good({ fullyVestedAt: NOW + 300 * DAY });
  assert.ok(s.weightOf(l, NOW) > s.weightOf(l, NOW + 200 * DAY));
});

section("splitting a day's pool");

t("two equal locks split it evenly", () => {
  const a = lockFor(365, { escrow: "A", recipient: "A" });
  const b = lockFor(365, { escrow: "B", recipient: "B" });
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.A, 500000n);
  assert.strictEqual(r.credits.B, 500000n);
});

t("longer remaining time earns more per token", () => {
  const a = lockFor(1095, { escrow: "A", recipient: "A" });   // 3-year lock
  const b = lockFor(365,  { escrow: "B", recipient: "B" });   // 1-year lock
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.ok(r.credits.A > r.credits.B * 2n, "a 3-year lock should out-earn a 1-year one threefold");
});

t("NO TOKENS ARE CREATED OR DESTROYED, even on awkward splits", () => {
  // Plain integer division loses the remainder on every single day, forever.
  for (const n of [3, 7, 11, 97]) {
    const locks = Array.from({ length: n }, (_, i) =>
      lockFor(365 + i, { escrow: "E" + i, recipient: "W" + i, amountRaw: String(1000000 + i * 7) }));
    const r = s.accrueDay({ locks, poolRaw: "1000001", nowUnix: NOW, cfg: CFG });
    const sum = Object.values(r.credits).reduce((a, b) => a + b, 0n);
    assert.strictEqual(sum, 1000001n, `${n} lockers: distributed ${sum} of 1000001`);
    assert.strictEqual(r.undistributed, 0n);
  }
});

t("the split is deterministic — same inputs, same ledger", () => {
  const locks = Array.from({ length: 9 }, (_, i) =>
    lockFor(365 + i, { escrow: "E" + i, recipient: "W" + i, amountRaw: String(500 + i) }));
  const a = s.accrueDay({ locks, poolRaw: "12345", nowUnix: NOW, cfg: CFG });
  const b = s.accrueDay({ locks: [...locks].reverse(), poolRaw: "12345", nowUnix: NOW, cfg: CFG });
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(a.credits).map(([k, v]) => [k, String(v)])),
    Object.fromEntries(Object.entries(b.credits).map(([k, v]) => [k, String(v)])));
});

t("one wallet with several locks gets them summed, not overwritten", () => {
  const a = lockFor(365, { escrow: "A", recipient: "Same" });
  const b = lockFor(365, { escrow: "B", recipient: "Same" });
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.Same, 1000000n);
});

t("disqualified locks are reported with reasons, not silently dropped", () => {
  const r = s.accrueDay({ locks: [good(), good({ escrow: "X", cancelable: true })],
    poolRaw: "1000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.eligible, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.ok(/cancelable/.test(r.skipped[0].reasons.join(" ")));
});

t("nobody locked: the pool is reported undistributed, not quietly burned", () => {
  const r = s.accrueDay({ locks: [], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.deepStrictEqual(r.credits, {});
  assert.strictEqual(r.undistributed, 1000000n);
});

section("claiming — earned from creation, released after the cliff");

t("before the cliff: accrued but NOT claimable", () => {
  const r = s.claimableFor({ accruedRaw: "5000", locks: [good({ cliffTime: NOW + 10 * DAY })], nowUnix: NOW });
  assert.strictEqual(r.claimable, 0n);
  assert.strictEqual(r.locked, 5000n);
  assert.strictEqual(r.cliffPassed, false);
  assert.strictEqual(r.unlocksAt, NOW + 10 * DAY);
});

t("after the cliff: the whole accrued balance is claimable", () => {
  const r = s.claimableFor({ accruedRaw: "5000", locks: [good({ cliffTime: NOW - DAY })], nowUnix: NOW });
  assert.strictEqual(r.claimable, 5000n);
  assert.strictEqual(r.cliffPassed, true);
});

section("pool sizing and display");

t("pool is the configured share of the day's unlock", () => {
  assert.strictEqual(s.poolForDay({ dailyUnlockRaw: "6632857000000000", sharePct: 20 }), 1326571400000000n);
});

t("a nonsense share is refused rather than silently treated as zero", () => {
  for (const bad of [0, -5, 101, NaN, null]) {
    assert.throws(() => s.poolForDay({ dailyUnlockRaw: "1000", sharePct: bad }), /sharePct/);
  }
});

t("yield is derived for display and says so when nothing is locked", () => {
  assert.strictEqual(s.yieldSnapshot({ poolRaw: "100", totalLockedRaw: "0" }).annualPct, null);
  const y = s.yieldSnapshot({ poolRaw: "1326571", totalLockedRaw: "500000000" });
  assert.ok(y.annualPct > 96 && y.annualPct < 98, `expected ~97%, got ${y.annualPct}`);
});

t("u64 amounts survive: a 175M-token lock does not lose precision", () => {
  // 175,000,000 CUNA at 9dp is 1.75e17 — past what a JS number holds exactly.
  const big = lockFor(401, { amountRaw: "175000000000000000" });   // 401d term, created 1d ago
  assert.strictEqual(s.weightOf(big, NOW), BigInt("175000000000000000") * 400n);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + e.message); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
