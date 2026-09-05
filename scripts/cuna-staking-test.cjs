"use strict";
// Tests for lib/cuna-staking.js. Zero dependencies, so this runs in the node-check CI job.
//
// The cases here are the ways this programme could quietly pay out wrongly: a cancelable lock
// earning on tokens it can withdraw, the treasury's own vesting farming its own emission, a
// matured lock going negative, and integer division destroying tokens a hundred base units a day.
//
// ⚠️ FIXTURES ARE BUILT FROM ESCROW ACCOUNTS, NOT FROM LOCK OBJECTS. The first version of this
// file handed `disqualify()` hand-written objects carrying `createdAt` and `cancelable` — two
// fields that do not exist on a Jupiter Lock escrow. Every test passed while the real guard read
// `undefined === true` and would have let EVERY cancelable lock earn. Fixtures now go through
// normalizeEscrow() using the on-chain field names, so a rule that reads a field production does
// not have fails here instead of in production.

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

// An escrow account exactly as the chain hands it over (field names from the deployed IDL).
const escrowAccount = ({
  recipient = "Alice", mint = "CUNA", creator = "Creator", cancelMode = 0, cancelledAt = 0,
  start = NOW - DAY, cliffDays = 180, durationDays = 365,
  totalRaw = "1000000000000", claimedRaw = "0",
} = {}) => {
  const cliffTime = start + cliffDays * DAY;
  const periods = Math.max(1, durationDays - cliffDays);
  const total = BigInt(totalRaw);
  const per = total / BigInt(periods + 1);
  return {
    recipient, tokenMint: mint, creator, cancelMode, cancelledAt,
    vestingStartTime: start, cliffTime, frequency: DAY, numberOfPeriod: periods,
    cliffUnlockAmount: total - per * BigInt(periods), amountPerPeriod: per,
    totalClaimedAmount: BigInt(claimedRaw),
  };
};
// A qualifying lock: started after launch, 1 year, 6 month cliff, non-cancelable.
const lock = (over = {}) => s.normalizeEscrow(over.escrow || "E1", escrowAccount(over));

section("the field contract — the check that would have caught the Phase 1 bug");

t("normalizeEscrow produces exactly the fields the rules read, and no invented ones", () => {
  const l = lock();
  assert.deepStrictEqual(Object.keys(l).sort(), [
    "atRiskRaw", "cancelMode", "cancelledAt", "claimedRaw", "cliffTime", "creator",
    "escrow", "fullyVestedAt", "mint", "recipient", "totalRaw", "vestingStartTime",
  ]);
  for (const [k, v] of Object.entries(l)) assert.ok(v !== undefined && v !== null, `${k} is ${v}`);
  // The two fields Phase 1 invented must NOT come back to life.
  assert.strictEqual(l.createdAt, undefined);
  assert.strictEqual(l.cancelable, undefined);
});

t("anchor's BN and PublicKey wrappers are unwrapped, not stringified into garbage", () => {
  const bn = (n) => ({ toString: () => String(n) });
  const pk = (k) => ({ toBase58: () => k });
  const l = s.normalizeEscrow(pk("ESC"), {
    recipient: pk("Bob"), tokenMint: pk("CUNA"), creator: pk("C"), cancelMode: 0, cancelledAt: bn(0),
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 180 * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(185), cliffUnlockAmount: bn(100), amountPerPeriod: bn(2),
    totalClaimedAmount: bn(30),
  });
  assert.strictEqual(l.escrow, "ESC");
  assert.strictEqual(l.recipient, "Bob");
  assert.strictEqual(l.totalRaw, "470");          // 100 + 2*185
  assert.strictEqual(l.atRiskRaw, "440");         // minus 30 already claimed
  assert.strictEqual(l.fullyVestedAt, NOW + 180 * DAY + 185 * DAY);
});

t("the end date is derived, never trusted from a caller", () => {
  const l = lock({ start: NOW, cliffDays: 180, durationDays: 400 });
  assert.strictEqual(l.fullyVestedAt, NOW + 400 * DAY);
});

section("qualification — the rules that keep the pool honest");

t("a compliant lock qualifies", () => {
  assert.deepStrictEqual(s.disqualify(lock(), CFG), []);
  assert.strictEqual(s.qualifies(lock(), CFG), true);
});

t("THE ONE THAT MATTERS: a cancelable lock never qualifies", () => {
  // Otherwise you earn yield on tokens the creator can pull back whenever they like.
  // cancelMode is a NUMBER: 0 = nobody can cancel, 1 = the creator can (lib/jup-lock.js:104).
  const why = s.disqualify(lock({ cancelMode: 1 }), CFG);
  assert.ok(why.some((r) => /cancelable/.test(r)), why.join("; "));
});

t("an unreadable cancelMode fails CLOSED, it does not default to the safe-looking zero", () => {
  for (const bad of [undefined, null, "", "yes", NaN, 2, 255]) {
    const l = { ...lock(), cancelMode: bad };
    assert.strictEqual(s.qualifies(l, CFG), false, `cancelMode=${String(bad)} slipped through`);
  }
});

t("a cancelled lock stops qualifying the moment it is cancelled", () => {
  const why = s.disqualify(lock({ cancelledAt: NOW - 100 }), CFG);
  assert.ok(why.some((r) => /already cancelled/.test(r)), why.join("; "));
});

t("THE OTHER ONE: pre-launch locks are excluded, which is what stops the treasury paying itself", () => {
  const why = s.disqualify(lock({ start: START - DAY }), CFG);
  assert.ok(why.some((r) => /before the programme began/.test(r)), why.join("; "));
});

t("a real treasury vesting lock (huge, old, long) is refused on the cutoff alone", () => {
  // Shaped like the 7.1B of CUNA already in escrow: it would otherwise eat the entire pool.
  const treasury = lock({ escrow: "T", recipient: "Treasury", totalRaw: "175000000000000000",
    start: START - 200 * DAY, cliffDays: 200, durationDays: 900 });
  assert.strictEqual(s.qualifies(treasury, CFG), false);
});

t("a short lock and a short cliff are both refused, and both reported", () => {
  const why = s.disqualify(lock({ start: NOW, cliffDays: 30, durationDays: 90 }), CFG);
  assert.ok(why.some((r) => /cliff shorter/.test(r)), why.join("; "));
  assert.ok(why.some((r) => /less than 365 days/.test(r)), why.join("; "));
  assert.ok(why.length >= 2, "every failing rule should be reported, not just the first");
});

t("another token, an excluded wallet, and a fully-claimed lock are all refused", () => {
  assert.strictEqual(s.qualifies(lock({ mint: "OTHER" }), CFG), false);
  assert.strictEqual(s.qualifies(lock(), { ...CFG, excludeWallets: ["Alice"] }), false);
  // Nothing left at risk: the end date alone must not keep drawing a share of the pool.
  const drained = lock({ totalRaw: "1000000000000", claimedRaw: "1000000000000" });
  assert.ok(s.disqualify(drained, CFG).some((r) => /nothing still locked/.test(r)));
});

section("weight");

t("weight is the amount STILL LOCKED x whole days remaining", () => {
  const l = lock({ start: NOW - DAY, cliffDays: 10, durationDays: 101 });
  assert.strictEqual(s.weightOf(l, NOW), BigInt(l.atRiskRaw) * 100n);
});

t("already-claimed tokens stop earning", () => {
  const full = lock({ start: NOW - DAY, cliffDays: 10, durationDays: 101 });
  const half = lock({ start: NOW - DAY, cliffDays: 10, durationDays: 101, claimedRaw: "500000000000" });
  assert.strictEqual(s.weightOf(half, NOW), s.weightOf(full, NOW) / 2n);
});

t("a matured lock weighs ZERO, never negative", () => {
  // A negative weight would subtract from the total and hand everyone else more than the pool.
  const l = lock({ start: NOW - 400 * DAY, cliffDays: 180, durationDays: 350 });
  assert.strictEqual(s.weightOf(l, NOW), 0n);
});

t("weight decays as the lock matures", () => {
  const l = lock({ durationDays: 301 });
  assert.ok(s.weightOf(l, NOW) > s.weightOf(l, NOW + 200 * DAY));
});

t("backdating past the programme start is refused outright", () => {
  // vesting_start_time is CREATOR-SET, so a lock can claim any shape it likes. While the
  // programme is young the launch cutoff alone makes a fake 1-year lock impossible: to have a
  // year of shape AND be nearly over, it must have started before we launched.
  const faked = lock({ start: NOW - 400 * DAY, cliffDays: 355, durationDays: 370 });
  assert.ok(s.disqualify(faked, CFG).some((r) => /before the programme began/.test(r)));
});

t("BACKDATING BUYS ALMOST NOTHING once the cutoff no longer covers it", () => {
  // A year in, the cutoff is a year back and a faked lock CAN pass every shape check: 370-day
  // term, 355-day cliff, ten days left to run. The rules do let it through — the weight is what
  // makes the attack worthless, because it prices a lock by the days it actually has left.
  const CFG_MATURE = { ...CFG, startAfterUnix: NOW - 500 * DAY };
  const honest = lock({ escrow: "H", recipient: "Honest", start: NOW - DAY, durationDays: 365 });
  const faked = lock({ escrow: "F", recipient: "Faker", start: NOW - 360 * DAY, cliffDays: 355,
                       durationDays: 370 });
  assert.deepStrictEqual(s.disqualify(faked, CFG_MATURE), [], "the shape checks pass — that is the point");
  const r = s.accrueDay({ locks: [honest, faked], poolRaw: "1000000", nowUnix: NOW, cfg: CFG_MATURE });
  assert.ok(r.credits.Faker * 20n < r.credits.Honest,
    `faker got ${r.credits.Faker}, honest got ${r.credits.Honest}`);
});

section("splitting a day's pool");

t("two equal locks split it evenly", () => {
  const a = lock({ escrow: "A", recipient: "A" });
  const b = lock({ escrow: "B", recipient: "B" });
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.A, 500000n);
  assert.strictEqual(r.credits.B, 500000n);
});

t("longer remaining time earns more per token", () => {
  const a = lock({ escrow: "A", recipient: "A", durationDays: 1095 });   // 3-year lock
  const b = lock({ escrow: "B", recipient: "B", durationDays: 365 });    // 1-year lock
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.ok(r.credits.A > r.credits.B * 2n, "a 3-year lock should out-earn a 1-year one threefold");
});

t("NO TOKENS ARE CREATED OR DESTROYED, even on awkward splits", () => {
  // Plain integer division loses the remainder on every single day, forever.
  for (const n of [3, 7, 11, 97]) {
    const locks = Array.from({ length: n }, (_, i) =>
      lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 + i,
             totalRaw: String(1000000 + i * 7) }));
    const r = s.accrueDay({ locks, poolRaw: "1000001", nowUnix: NOW, cfg: CFG });
    const sum = Object.values(r.credits).reduce((a, b) => a + b, 0n);
    assert.strictEqual(sum, 1000001n, `${n} lockers: distributed ${sum} of 1000001`);
    assert.strictEqual(r.undistributed, 0n);
  }
});

t("the split is deterministic — same inputs, same ledger", () => {
  const locks = Array.from({ length: 9 }, (_, i) =>
    lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 + i, totalRaw: String(500 + i) }));
  const a = s.accrueDay({ locks, poolRaw: "12345", nowUnix: NOW, cfg: CFG });
  const b = s.accrueDay({ locks: [...locks].reverse(), poolRaw: "12345", nowUnix: NOW, cfg: CFG });
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(a.credits).map(([k, v]) => [k, String(v)])),
    Object.fromEntries(Object.entries(b.credits).map(([k, v]) => [k, String(v)])));
});

t("one wallet with several locks gets them summed, not overwritten", () => {
  const a = lock({ escrow: "A", recipient: "Same" });
  const b = lock({ escrow: "B", recipient: "Same" });
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.Same, 1000000n);
});

t("disqualified locks are reported with reasons, not silently dropped", () => {
  const r = s.accrueDay({ locks: [lock(), lock({ escrow: "X", cancelMode: 1 })],
    poolRaw: "1000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.eligible, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].escrow, "X");
  assert.ok(/cancelable/.test(r.skipped[0].reasons.join(" ")));
});

t("nobody locked: the pool is reported undistributed, not quietly burned", () => {
  const r = s.accrueDay({ locks: [], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.deepStrictEqual(r.credits, {});
  assert.strictEqual(r.undistributed, 1000000n);
});

section("claiming — earned from creation, released after the cliff");

t("before the cliff: accrued but NOT claimable", () => {
  const l = lock({ start: NOW - 10 * DAY, cliffDays: 190 });        // cliff is 180 days out
  const r = s.claimableFor({ accruedRaw: "5000", locks: [l], nowUnix: NOW });
  assert.strictEqual(r.claimable, 0n);
  assert.strictEqual(r.locked, 5000n);
  assert.strictEqual(r.cliffPassed, false);
  assert.strictEqual(r.unlocksAt, l.cliffTime);
});

t("after the cliff: the whole accrued balance is claimable", () => {
  const l = lock({ start: NOW - 200 * DAY, cliffDays: 180 });
  const r = s.claimableFor({ accruedRaw: "5000", locks: [l], nowUnix: NOW });
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
  const big = lock({ totalRaw: "175000000000000000", start: NOW - DAY, cliffDays: 180,
                     durationDays: 401 });
  assert.strictEqual(big.totalRaw, "175000000000000000", "the amount must round-trip exactly");
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
