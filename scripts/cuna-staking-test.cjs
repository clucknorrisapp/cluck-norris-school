"use strict";
// Tests for lib/cuna-staking.js. Zero dependencies, so this runs in the node-check CI job.
//
// The cases here are the ways this programme could quietly pay out wrongly: a cancelable lock
// earning on tokens it can withdraw, the treasury's own vesting farming its own emission, a
// matured lock going negative, and integer division destroying tokens a hundred base units a day.
//
// ⚠️ TERMS ARE MEASURED FORWARD FROM firstSeenAt, never backward from vesting_start_time. That is
// not a stylistic choice: a scan of the live chain found Jupiter sets vesting_start_time equal to
// the cliff, so the real 226M CUNA community lock (471 days still to run) reads as a 244-day lock
// and would have been thrown out. It is creator-set too — there are live escrows declaring 2069
// and 2077. There is a fixture below taken from that real lock; it must always qualify.
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
const CFG = { mint: "CUNA", startAfterUnix: START, minDurationDays: 90, minLockRaw: 0 };

// An escrow account exactly as the chain hands it over (field names from the deployed IDL).
const escrowAccount = ({
  recipient = "Alice", mint = "CUNA", creator = "Creator", cancelMode = 0, cancelledAt = 0,
  start = NOW - DAY, cliffDays = 0, durationDays = 365,   // both measured AHEAD of `seen`
  totalRaw = "1000000000000", claimedRaw = "0",
  seen = NOW,
} = {}) => {
  const cliffTime = seen + cliffDays * DAY;
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
const lock = (over = {}) =>
  s.normalizeEscrow(over.escrow || "E1", escrowAccount(over),
                    over.seen === undefined ? NOW : over.seen);

// Straight from the chain: escrow BAC7TQrZ…, 226M CUNA to AZHiexsg…, scanned 2026-09-05.
// vesting_start_time == cliff_time == 2027-04-20, fully vested 2027-12-20. Measured backward it
// is a 244-day lock and fails; measured forward it has 227 days to its cliff and 471 to run.
const REAL_226M = () => s.normalizeEscrow("BAC7TQrZ", {
  recipient: "AZHiexsg", tokenMint: "CUNA", creator: "C", cancelMode: 0, cancelledAt: 0,
  vestingStartTime: 1808179200, cliffTime: 1808179200, frequency: DAY, numberOfPeriod: 244,
  cliffUnlockAmount: 0n, amountPerPeriod: 926229508196721n, totalClaimedAmount: 0n,
}, 1788566400);   // firstSeenAt = 2026-09-05

section("the field contract — the check that would have caught the Phase 1 bug");

t("normalizeEscrow produces exactly the fields the rules read, and no invented ones", () => {
  const l = lock();
  assert.deepStrictEqual(Object.keys(l).sort(), [
    "atRiskRaw", "cancelMode", "cancelledAt", "claimedRaw", "cliffTime", "creator",
    "escrow", "firstSeenAt", "fullyVestedAt", "mint", "perDayRaw", "recipient", "totalRaw",
    "vestingStartTime",
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

t("a lock not yet indexed cannot qualify — no firstSeenAt, no earnings", () => {
  const orphan = s.normalizeEscrow("O", escrowAccount());          // no firstSeenAt passed
  assert.strictEqual(orphan.firstSeenAt, null);
  assert.ok(s.disqualify(orphan, CFG).some((r) => /not yet indexed/.test(r)));
});

t("THE OTHER ONE: the treasury's own vesting never earns, by RECIPIENT", () => {
  // 7.1B of CUNA is already in escrow to the treasury on terms that pass every shape check —
  // 1000-day locks, non-cancelable. Nothing about their SHAPE can keep them out. Only the
  // recipient list can, which is why the owner picked exclude-by-recipient (Rule B).
  const treasury = lock({ escrow: "T", recipient: "Treasury", totalRaw: "175000000000000000",
    cliffDays: 200, durationDays: 1000 });
  assert.deepStrictEqual(s.disqualify(treasury, CFG), [], "shape checks alone do NOT stop it");
  const why = s.disqualify(treasury, { ...CFG, excludeWallets: ["Treasury"] });
  assert.ok(why.some((r) => /excluded wallet/.test(r)), why.join("; "));
});

t("a lock indexed before the programme launched is out", () => {
  const why = s.disqualify(lock({ seen: START - DAY }), CFG);
  assert.ok(why.some((r) => /indexed before the programme began/.test(r)), why.join("; "));
});

t("a lock shorter than the minimum term is refused", () => {
  const why = s.disqualify(lock({ cliffDays: 10, durationDays: 60 }), CFG);
  assert.ok(why.some((r) => /less than 90 days left to run/.test(r)), why.join("; "));
});

t("THERE IS NO CLIFF REQUIREMENT — a cliff already in the past does not disqualify", () => {
  // This is a real shape: the 50M community lock (64C6Wee7…) had its cliff three days BEFORE the
  // programme would launch while still having 177 days to run. Under the old rule it was refused
  // on a technicality despite being a genuine commitment.
  const past = lock({ seen: NOW, cliffDays: -30, durationDays: 200 });
  assert.ok(past.cliffTime < past.firstSeenAt, "fixture should have a cliff in the past");
  assert.deepStrictEqual(s.disqualify(past, CFG), []);
});

t("every failing rule is reported, not just the first", () => {
  const why = s.disqualify(lock({ mint: "OTHER", durationDays: 30, totalRaw: "0" }), CFG);
  assert.ok(why.length >= 2, why.join("; "));
});

t("the dust floor keeps spam locks out without gating real ones", () => {
  // At a 3-month minimum, spamming locks is cheap and each one is a permanent ledger row.
  const cfg = { ...CFG, minLockRaw: "100000000000000" };          // 100,000 CUNA
  const dust = lock({ totalRaw: "1000000000" });                   // 1 CUNA
  assert.ok(s.disqualify(dust, cfg).some((r) => /below the minimum lock size/.test(r)));
  assert.deepStrictEqual(s.disqualify(lock({ totalRaw: "100000000000000" }), cfg), []);   // exactly at it
  assert.deepStrictEqual(s.disqualify(dust, { ...CFG, minLockRaw: 0 }), []);              // floor off
});

t("the tiers price themselves — no multiplier table anywhere", () => {
  // 3/6/9/12/15/18 months must pay 1x..6x per token purely from amount x days remaining. If a
  // bonus table is ever added on top, these ratios break and this test says so.
  const tiers = [90, 180, 270, 365, 456, 547];
  const locks = tiers.map((d, i) => lock({ escrow: "T" + i, recipient: "T" + i, durationDays: d }));
  const r = s.accrueDay({ locks, poolRaw: "100000000000", nowUnix: NOW, cfg: CFG });
  const base = Number(r.credits.T0);
  tiers.forEach((d, i) => {
    const ratio = Number(r.credits["T" + i]) / base;
    assert.ok(Math.abs(ratio - d / 90) < 0.02, `${d}d paid ${ratio.toFixed(2)}x, expected ${(d / 90).toFixed(2)}x`);
  });
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
  const l = lock({ cliffDays: 10, durationDays: 100 });
  assert.strictEqual(s.weightOf(l, NOW), BigInt(l.atRiskRaw) * 100n);
});

t("already-claimed tokens stop earning", () => {
  const full = lock({ cliffDays: 10, durationDays: 100 });
  const half = lock({ cliffDays: 10, durationDays: 100, claimedRaw: "500000000000" });
  assert.strictEqual(s.weightOf(half, NOW), s.weightOf(full, NOW) / 2n);
});

t("a matured lock weighs ZERO, never negative", () => {
  // A negative weight would subtract from the total and hand everyone else more than the pool.
  const l = lock({ seen: NOW - 400 * DAY, cliffDays: 180, durationDays: 350 });
  assert.strictEqual(s.weightOf(l, NOW), 0n);
});

t("weight decays as the lock matures", () => {
  const l = lock({ durationDays: 301 });
  assert.ok(s.weightOf(l, NOW) > s.weightOf(l, NOW + 200 * DAY));
});

t("THE REAL 226M COMMUNITY LOCK QUALIFIES — the case the backward rule threw out", () => {
  // vesting_start_time == cliff_time on this lock, so "end minus start" calls it 244 days and
  // fails the 1-year rule. It has 471 days left to run. If this test ever goes red, the rule has
  // drifted back to measuring the wrong direction.
  const real = REAL_226M();
  assert.deepStrictEqual(s.disqualify(real, { ...CFG, startAfterUnix: 1788566400 }), []);
  assert.strictEqual(Math.round((real.fullyVestedAt - real.firstSeenAt) / DAY), 471);
  // The number the backward rule saw: 244 days of "linear tail", when the lock really has 471
  // still to run. Under the old 365-day minimum that threw the lock out entirely.
  assert.strictEqual(Math.round((real.fullyVestedAt - real.vestingStartTime) / DAY), 244);
});

t("vesting_start_time is INFORMATIONAL — no rule and no weight may read it", () => {
  // Live CUNA escrows declare start dates of 2069 and 2077. If any of that reached the money
  // logic it would be a free hand on the terms; the ONLY timestamp that decides anything is
  // firstSeenAt, which is ours.
  const base = lock({ escrow: "A", recipient: "A" });
  for (const absurd of [0, 1, NOW - 20000 * DAY, NOW + 20000 * DAY]) {
    const twisted = { ...base, vestingStartTime: absurd };
    assert.deepStrictEqual(s.disqualify(twisted, CFG), s.disqualify(base, CFG),
      `vestingStartTime=${absurd} changed the verdict`);
    assert.strictEqual(s.weightOf(twisted, NOW), s.weightOf(base, NOW));
  }
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

section("claiming — there is no cliff");

t("everything accrued is claimable, whatever the lock looks like", () => {
  // Owner, 2026-09-05: "remove the cliff part, that isn't necessary." Safe because a qualifying
  // lock is non-cancelable — the principal is stuck regardless, so early claiming was never the
  // risk. If a gate is ever wanted back, claimableFor is the one place it goes.
  const r = s.claimableFor({ accruedRaw: "5000" });
  assert.strictEqual(r.claimable, 5000n);
  assert.strictEqual(r.locked, 0n);
  assert.strictEqual(r.cliffPassed, true);
  assert.strictEqual(r.unlocksAt, null);
});

t("nothing accrued means nothing claimable, and it does not throw", () => {
  for (const v of [undefined, null, 0, "0"]) {
    assert.strictEqual(s.claimableFor({ accruedRaw: v }).claimable, 0n);
  }
});

section("the unlock stream the pool is drawn from");

t("only locks past their cliff and still running are releasing anything", () => {
  const inCliff = lock({ escrow: "A", cliffDays: 180, durationDays: 365 });   // cliff ahead
  const running = lock({ escrow: "B", seen: NOW - 200 * DAY, cliffDays: 180, durationDays: 400 });
  const done    = lock({ escrow: "C", seen: NOW - 500 * DAY, cliffDays: 180, durationDays: 365 });
  assert.strictEqual(s.dailyUnlockRaw([inCliff], NOW), 0n, "a lock inside its cliff releases nothing");
  assert.strictEqual(s.dailyUnlockRaw([done], NOW), 0n, "a finished lock releases nothing");
  assert.ok(s.dailyUnlockRaw([running], NOW) > 0n);
  // and the total is just the sum of the ones actually running
  assert.strictEqual(s.dailyUnlockRaw([inCliff, running, done], NOW), s.dailyUnlockRaw([running], NOW));
});

t("the rate is per DAY whatever the schedule's period is", () => {
  // 100 per period, one period a day vs one every six hours = 4x the daily rate.
  const daily = s.normalizeEscrow("D", { ...escrowAccount(), frequency: DAY,
    amountPerPeriod: 100n, cliffUnlockAmount: 0n, numberOfPeriod: 400 }, NOW);
  const fast = s.normalizeEscrow("F", { ...escrowAccount(), frequency: DAY / 4,
    amountPerPeriod: 100n, cliffUnlockAmount: 0n, numberOfPeriod: 1600 }, NOW);
  assert.strictEqual(daily.perDayRaw, "100");
  assert.strictEqual(fast.perDayRaw, "400");
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
  const big = lock({ totalRaw: "175000000000000000", cliffDays: 180, durationDays: 400 });
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
