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
    "atRiskRaw", "cancelMode", "cancelledAt", "claimedRaw", "cliffTime", "cliffUnlockRaw",
    "creator", "declaredEndAt", "escrow", "firstSeenAt", "frequency", "fullyVestedAt", "mint",
    "perDayRaw", "perPeriodRaw", "periods", "recipient", "totalRaw", "vestingStartTime",
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
  assert.ok(why.some((r) => /no tokens locked for 90 days or more/.test(r)), why.join("; "));
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
  // 3/6/9/12/15/18 months must pay 1x..6x per token purely from amount x days, for the SINGLE-CLIFF
  // shape the page builds. (A linear drip is judged tranche by tranche and is deliberately NOT on
  // this ladder — see the per-release tests below.)
  const bn = (n) => ({ toString: () => String(n) });
  const tiers = [90, 180, 270, 360, 450, 540];
  const locks = tiers.map((d, i) => s.normalizeEscrow("T" + i, {
    recipient: "T" + i, tokenMint: "CUNA", creator: "T" + i, cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + d * DAY), frequency: bn(DAY), numberOfPeriod: bn(1),
    cliffUnlockAmount: bn("1000000000000"), amountPerPeriod: bn(0), totalClaimedAmount: bn(0),
  }, NOW));
  // Compare WEIGHTS, which are exact; a pool split carries largest-remainder dust of a base unit.
  const base = s.weightOf(locks[0], NOW, CFG);
  tiers.forEach((d, i) => {
    assert.strictEqual(s.weightOf(locks[i], NOW, CFG), base * BigInt(d / 90), `${d}d must weigh exactly ${d / 90}x`);
  });
  const r = s.accrueDay({ locks, poolRaw: "100000000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(Object.values(r.credits).reduce((a, v) => a + v, 0n), 100000000000n, "pool fully distributed");
});

t("another token, an excluded wallet, and a fully-claimed lock are all refused", () => {
  assert.strictEqual(s.qualifies(lock({ mint: "OTHER" }), CFG), false);
  assert.strictEqual(s.qualifies(lock(), { ...CFG, excludeWallets: ["Alice"] }), false);
  // Nothing left at risk: the end date alone must not keep drawing a share of the pool.
  const drained = lock({ totalRaw: "1000000000000", claimedRaw: "1000000000000" });
  assert.ok(s.disqualify(drained, CFG).some((r) => /nothing still locked/.test(r)));
});

section("what is actually still locked");

// Two locks holding the same amount, both finishing at the same moment, shaped differently.
const scheduled = (id, { cliffDays, periods, cliffAmt, per, seen = NOW }) =>
  s.normalizeEscrow(id, {
    recipient: id, tokenMint: "CUNA", creator: "C", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: seen, cliffTime: seen + cliffDays * DAY, frequency: DAY,
    numberOfPeriod: periods, cliffUnlockAmount: cliffAmt, amountPerPeriod: per,
    totalClaimedAmount: 0n,
  }, seen);

t("THE ONE THAT MATTERS: a drip lock is not worth a cliff lock", () => {
  // A 1-day cliff vesting over 18 months lets someone withdraw a growing share from day two.
  // Valuing it on total-minus-claimed would pay them FULL weight for eighteen months simply for
  // not pressing claim — the cancelable-lock problem wearing a different hat.
  const TOTAL = 1000000n * 10n ** 9n;
  const drip = scheduled("Drip", { cliffDays: 1, periods: 547, cliffAmt: 0n, per: TOTAL / 547n });
  const cliff = scheduled("Cliff", { cliffDays: 548, periods: 1, cliffAmt: TOTAL, per: 0n });
  assert.strictEqual(s.unvestedRaw(drip, NOW), BigInt(drip.totalRaw), "nothing has vested on day zero");
  assert.strictEqual(s.unvestedRaw(cliff, NOW), BigInt(cliff.totalRaw));
  // ...but a year in they are nothing alike
  const later = NOW + 365 * DAY;
  assert.ok(s.unvestedRaw(drip, later) < TOTAL / 2n, "the drip lock should be mostly withdrawable");
  assert.strictEqual(s.unvestedRaw(cliff, later), BigInt(cliff.totalRaw), "the cliff lock is untouched until the end");
  assert.ok(s.weightOf(cliff, later) > s.weightOf(drip, later) * 2n,
    "the real commitment must out-earn the nominal one");
});

t("NOT CLAIMING does not preserve weight", () => {
  // The whole exploit is declining to claim so the balance looks locked. Unvested does not care.
  const TOTAL = 1000000n * 10n ** 9n;
  const drip = scheduled("D", { cliffDays: 1, periods: 547, cliffAmt: 0n, per: TOTAL / 547n });
  const later = NOW + 365 * DAY;
  const unclaimed = s.unvestedRaw(drip, later);
  const claimedSome = s.unvestedRaw({ ...drip, claimedRaw: (TOTAL / 4n).toString() }, later);
  assert.strictEqual(unclaimed, claimedSome, "claiming or not must not change what is LOCKED");
});

t("a lock outside our tool with any cliff shape is valued the same way", () => {
  // Nothing here reads where a lock was made. A 6-month cliff then a 12-month drip is worth full
  // weight for six months and then declines — which is exactly what is true of it.
  const TOTAL = 1000000n * 10n ** 9n;
  const jup = scheduled("J", { cliffDays: 180, periods: 365, cliffAmt: 0n, per: TOTAL / 365n });
  assert.strictEqual(s.unvestedRaw(jup, NOW + 179 * DAY), BigInt(jup.totalRaw), "nothing before the cliff");
  assert.strictEqual(s.unvestedRaw(jup, NOW + 180 * DAY), BigInt(jup.totalRaw), "still nothing AT the cliff");
  assert.ok(s.unvestedRaw(jup, NOW + 300 * DAY) < BigInt(jup.totalRaw), "declining after it");
  assert.strictEqual(s.unvestedRaw(jup, NOW + 600 * DAY), 0n, "nothing left once fully vested");
});

t("a front-loaded cliff lump is counted the moment it unlocks", () => {
  // 50% at the cliff, 50% dripping. At the cliff, half is gone from the commitment immediately.
  const TOTAL = 1000000n * 10n ** 9n;
  const half = scheduled("H", { cliffDays: 90, periods: 90, cliffAmt: TOTAL / 2n, per: TOTAL / 2n / 90n });
  assert.strictEqual(s.unvestedRaw(half, NOW + 89 * DAY), BigInt(half.totalRaw));
  assert.strictEqual(s.unvestedRaw(half, NOW + 90 * DAY), BigInt(half.totalRaw) - TOTAL / 2n);
});

section("weight");

t("weight is the sum over UNVESTED releases of amount x that release's own days", () => {
  // Brute force the definition and compare with the day-bucketed implementation, on the drip
  // fixture and on a hostile one-second schedule. If the bucketing ever drifts by a base unit,
  // this is where it shows.
  const brute = (l, now, cfg) => {
    const seen = l.firstSeenAt, cliff = l.cliffTime, freq = l.frequency;
    const minD = cfg.minDurationDays, maxD = s.maxTermDaysOf(cfg);
    const clamp = (d) => (d < minD ? 0 : Math.min(d, maxD));
    let w = 0n;
    if (cliff > now) w += BigInt(l.cliffUnlockRaw) * BigInt(clamp(Math.floor((cliff - seen) / DAY)));
    for (let j = 1; j <= l.periods; j++) {
      const at = cliff + j * freq;
      if (at <= now) continue;
      w += BigInt(l.perPeriodRaw) * BigInt(clamp(Math.floor((at - seen) / DAY)));
    }
    return w;
  };
  const cases = [
    lock({ durationDays: 301 }),
    lock({ cliffDays: 45, durationDays: 400 }),
    lock({ cliffDays: 10, durationDays: 95, totalRaw: "7777777777777" }),
  ];
  const bn = (n) => ({ toString: () => String(n) });
  // one-second frequency, 2 million periods: bucketing must give the brute-force answer
  cases.push(s.normalizeEscrow("SEC", {
    recipient: "S", tokenMint: "CUNA", creator: "S", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 3 * DAY), frequency: bn(1), numberOfPeriod: bn(2000000),
    cliffUnlockAmount: bn(0), amountPerPeriod: bn(3), totalClaimedAmount: bn(0),
  }, NOW));
  for (const l of cases) {
    for (const t of [NOW, NOW + 20 * DAY, NOW + 200 * DAY, NOW + 600 * DAY]) {
      assert.strictEqual(s.weightOf(l, t, CFG), brute(l, t, CFG), `${l.escrow} at +${(t - NOW) / DAY}d`);
    }
  }
});

t("claiming changes NOTHING, because vested tokens already stopped counting", () => {
  // This replaced an earlier test that measured weight on total-minus-claimed. That framing was
  // wrong in a way that mattered: it made "have you pressed claim yet?" part of the payout, when
  // the honest question is "how much of this can you take out at all?" You can only ever claim
  // what has already vested, and vested tokens have already left the weight — so claiming or not
  // is invisible here, which is exactly right.
  const full = lock({ cliffDays: 10, durationDays: 100 });
  const half = lock({ cliffDays: 10, durationDays: 100, claimedRaw: "500000000000" });
  assert.strictEqual(s.weightOf(half, NOW), s.weightOf(full, NOW));
  assert.strictEqual(s.unvestedRaw(half, NOW), s.unvestedRaw(full, NOW));
});

t("a fully vested lock weighs nothing, however little was claimed", () => {
  const done = lock({ seen: NOW - 400 * DAY, cliffDays: 10, durationDays: 300 });
  assert.strictEqual(s.unvestedRaw(done, NOW), 0n);
  assert.strictEqual(s.weightOf(done, NOW), 0n);
});

t("a matured lock weighs ZERO, never negative", () => {
  // A negative weight would subtract from the total and hand everyone else more than the pool.
  const l = lock({ seen: NOW - 400 * DAY, cliffDays: 180, durationDays: 350 });
  assert.strictEqual(s.weightOf(l, NOW), 0n);
});

t("THE RATE YOU COMMITTED TO IS THE RATE YOU ARE PAID — it does not decay", () => {
  // A single-cliff lock releases nothing until the end, so its weight must be identical on day 1
  // and on its last day. This used to count days REMAINING, which quietly cut a locker's rate
  // every day and left an 18-month lock finishing on the entry-tier rate.
  const bn = (n) => ({ toString: () => String(n) });
  const l = s.normalizeEscrow("FLAT", {
    recipient: "Ann", tokenMint: "CUNA", creator: "Ann", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 540 * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(1), cliffUnlockAmount: bn("1000000000000000"), amountPerPeriod: bn(0),
    totalClaimedAmount: bn(0),
  }, NOW);
  const day1 = s.weightOf(l, NOW);
  assert.ok(day1 > 0n);
  assert.strictEqual(s.weightOf(l, NOW + 200 * DAY), day1, "the rate moved a third of the way in");
  assert.strictEqual(s.weightOf(l, NOW + 539 * DAY), day1, "the rate moved on the final day");
  assert.strictEqual(s.weightOf(l, NOW + 540 * DAY), 0n, "a finished lock must weigh nothing");
});

t("an 18-month lock never falls to the rate of a fresh 3-month one", () => {
  // The owner's case, and the reason the decay went: under days-remaining, an 18-month lock with
  // 3 months left weighed EXACTLY the same as a brand-new 3-month lock of the same size.
  const bn = (n) => ({ toString: () => String(n) });
  const mk = (who, days, seenAt) => s.normalizeEscrow(who, {
    recipient: who, tokenMint: "CUNA", creator: who, cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(seenAt), cliffTime: bn(seenAt + days * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(1), cliffUnlockAmount: bn("1000000000000000"), amountPerPeriod: bn(0),
    totalClaimedAmount: bn(0),
  }, seenAt);
  const eighteen = mk("long", 540, NOW - 450 * DAY);   // locked 15 months ago, 90 days left
  const three = mk("short", 90, NOW);                  // locked today
  assert.strictEqual(s.weightOf(three, NOW) * 6n, s.weightOf(eighteen, NOW),
    "the 18-month lock must still be worth 6x the entry tier in its final quarter");
});

t("the amount side still moves: a drip lock loses weight as it releases", () => {
  // Only the RATE is fixed. Tokens that have vested are no longer locked up, so a schedule that is
  // paying out must weigh less over time — otherwise a lock could be emptied and still draw a full
  // share on the strength of its start date.
  const l = lock({ durationDays: 301 });
  assert.ok(s.weightOf(l, NOW) > s.weightOf(l, NOW + 200 * DAY),
    "a vesting lock that has released tokens must weigh less");
});

t("a lock we have never indexed weighs nothing — it must fail closed", () => {
  // Without the firstSeenAt guard, (end - 0) reads as a term running since 1970.
  const l = lock({ durationDays: 301 });
  assert.strictEqual(s.weightOf({ ...l, firstSeenAt: null }, NOW), 0n);
  assert.strictEqual(s.weightOf({ ...l, cliffTime: 0 }, NOW), 0n);
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

t("FLASH LOCK: a near cliff with a padded tail weighs almost nothing", () => {
  // The hole the verifier reproduced: 99.99% released one hour out, one base unit per period for
  // 1000 months. Under a per-lock term it weighed as a full 18-month lock; per release it weighs
  // 99.99% x nothing plus dust on the dust.
  const bn = (n) => ({ toString: () => String(n) });
  const total = 10_000_000n * 10n ** 9n;
  const tail = 1n, periods = 1000n;
  const flash = s.normalizeEscrow("FLASH", {
    recipient: "M", tokenMint: "CUNA", creator: "M", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 3600), frequency: bn(2628000), numberOfPeriod: bn(periods),
    cliffUnlockAmount: bn(total - tail * periods), amountPerPeriod: bn(tail), totalClaimedAmount: bn(0),
  }, NOW);
  const honest90 = s.normalizeEscrow("H90", {
    recipient: "H", tokenMint: "CUNA", creator: "H", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 90 * DAY), frequency: bn(DAY), numberOfPeriod: bn(1),
    cliffUnlockAmount: bn(total), amountPerPeriod: bn(0), totalClaimedAmount: bn(0),
  }, NOW);
  const wf = s.weightOf(flash, NOW, CFG), wh = s.weightOf(honest90, NOW, CFG);
  assert.ok(wf * 1000000n < wh, `flash lock weighs ${wf} vs honest 90-day ${wh}`);
  // and a 90-day cliff with the same padded tail is exactly a 90-day lock plus dust
  const padded90 = s.normalizeEscrow("P90", { ...flash.__raw || {}, recipient: "P", tokenMint: "CUNA", creator: "P", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 90 * DAY), frequency: bn(2628000), numberOfPeriod: bn(periods),
    cliffUnlockAmount: bn(total - tail * periods), amountPerPeriod: bn(tail), totalClaimedAmount: bn(0) }, NOW);
  const wp = s.weightOf(padded90, NOW, CFG);
  assert.ok(wp >= (total - tail * periods) * 90n && wp < wh + 540n * periods, "padded 90-day lock is not ~1x");
});

t("a Jupiter-default monthly drip earns on the tranches 90+ days out and nothing on the rest", () => {
  // Shaped like the real 50M community lock: cliff today releasing 0, then 6 monthly tranches.
  const bn = (n) => ({ toString: () => String(n) });
  const per = 8_333_333n * 10n ** 9n;
  const l = s.normalizeEscrow("DRIP", {
    recipient: "D", tokenMint: "CUNA", creator: "D", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW), frequency: bn(30 * DAY), numberOfPeriod: bn(6),
    cliffUnlockAmount: bn(0), amountPerPeriod: bn(per), totalClaimedAmount: bn(0),
  }, NOW);
  assert.deepStrictEqual(s.disqualify(l, CFG), [], "it qualifies — four tranches are 90+ days out");
  // tranches at 30 and 60 days weigh 0; 90, 120, 150, 180 weigh their own days
  const expect = per * (90n + 120n + 150n + 180n);
  assert.strictEqual(s.weightOf(l, NOW, CFG), expect);
  // once the day-90 tranche has vested, it drops out
  assert.strictEqual(s.weightOf(l, NOW + 90 * DAY, CFG), per * (120n + 150n + 180n));
});

t("a lock with NO tranche 90+ days out does not qualify, whatever its declared end", () => {
  const bn = (n) => ({ toString: () => String(n) });
  const l = s.normalizeEscrow("SHORT", {
    recipient: "S", tokenMint: "CUNA", creator: "S", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 30 * DAY), frequency: bn(DAY), numberOfPeriod: bn(50),
    cliffUnlockAmount: bn(1000), amountPerPeriod: bn(10), totalClaimedAmount: bn(0),
  }, NOW);
  assert.deepStrictEqual(s.disqualify(l, CFG), ["no tokens locked for 90 days or more"]);
  assert.strictEqual(s.weightOf(l, NOW, CFG), 0n);
});

t("earningRawOf is exactly the tokens weightOf gives weight to", () => {
  const bn = (n) => ({ toString: () => String(n) });
  // single cliff: everything unvested earns
  const single = s.normalizeEscrow("S", { recipient: "a", tokenMint: "CUNA", creator: "a", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 200 * DAY), frequency: bn(DAY), numberOfPeriod: bn(1),
    cliffUnlockAmount: bn("5000000000"), amountPerPeriod: bn(0), totalClaimedAmount: bn(0) }, NOW);
  assert.strictEqual(s.earningRawOf(single, NOW, CFG), 5000000000n);
  assert.strictEqual(s.earningRawOf(single, NOW + 200 * DAY, CFG), 0n, "vested -> nothing earns");
  // monthly drip from today: tranches at 30/60 days earn nothing, 90..180 earn
  const per = 8_333_333n * 10n ** 9n;
  const drip = s.normalizeEscrow("D", { recipient: "b", tokenMint: "CUNA", creator: "b", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW), frequency: bn(30 * DAY), numberOfPeriod: bn(6),
    cliffUnlockAmount: bn(0), amountPerPeriod: bn(per), totalClaimedAmount: bn(0) }, NOW);
  assert.strictEqual(s.earningRawOf(drip, NOW, CFG), per * 4n);
  assert.strictEqual(s.earningRawOf(drip, NOW + 90 * DAY, CFG), per * 3n, "the day-90 tranche has vested");
  // brute-force cross-check on a hostile one-second schedule
  const sec = s.normalizeEscrow("SEC", { recipient: "c", tokenMint: "CUNA", creator: "c", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 3 * DAY), frequency: bn(1), numberOfPeriod: bn(500000),
    cliffUnlockAmount: bn(0), amountPerPeriod: bn(3), totalClaimedAmount: bn(0) }, NOW);
  let brute = 0n;
  for (let j = 1; j <= 500000; j++) { const at = sec.cliffTime + j; if (at <= NOW) continue; const d = Math.floor((at - NOW) / DAY); if (d >= 90) brute += 3n; }
  assert.strictEqual(s.earningRawOf(sec, NOW, CFG), brute);
});

t("PADDING: empty trailing periods cannot buy a longer term", () => {
  const bn = (n) => ({ toString: () => String(n) });
  // number_of_period is creator-chosen and a period releasing ZERO tokens costs nothing, so the
  // declared end can sit far past the moment the tokens are already free. Weight is amount x days
  // remaining, so trusting it pays an 18-month reward for a 3-month commitment.
  const padded = s.normalizeEscrow("PAD", {
    recipient: "Mallory", tokenMint: "CUNA", creator: "Mallory", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 90 * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(100000), cliffUnlockAmount: bn(1000000), amountPerPeriod: bn(0),
    totalClaimedAmount: bn(0),
  }, NOW);
  assert.strictEqual(padded.declaredEndAt, NOW + 90 * DAY + 100000 * DAY, "the declared end is still reported");
  assert.strictEqual(padded.fullyVestedAt, NOW + 90 * DAY, "the REAL end is the cliff — nothing releases after it");

  // and the weight that falls out of it is a 90-day weight, not a 100,090-day one
  const honest = s.normalizeEscrow("HON", {
    recipient: "Alice", tokenMint: "CUNA", creator: "Alice", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 547 * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(1), cliffUnlockAmount: bn(1000000), amountPerPeriod: bn(0),
    totalClaimedAmount: bn(0),
  }, NOW);
  assert.ok(s.weightOf(honest, NOW) > s.weightOf(padded, NOW),
    "an honest 18-month lock must outweigh a padded 3-month lock of the same size");
});

t("PADDING: a real drip schedule keeps its full term", () => {
  const bn = (n) => ({ toString: () => String(n) });
  // The fix must only bite on periods that release nothing. A lock that actually pays out every
  // period is unchanged — otherwise it would quietly shorten every honest vesting lock.
  const drip = s.normalizeEscrow("DRIP", {
    recipient: "Bob", tokenMint: "CUNA", creator: "Bob", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 30 * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(300), cliffUnlockAmount: bn(0), amountPerPeriod: bn(5),
    totalClaimedAmount: bn(0),
  }, NOW);
  assert.strictEqual(drip.fullyVestedAt, NOW + 330 * DAY);
  assert.strictEqual(drip.fullyVestedAt, drip.declaredEndAt);
});

t("THE 90-DAY BOUNDARY: the entry tier still qualifies once the padding is gone", () => {
  const bn = (n) => ({ toString: () => String(n) });
  // The page sells a 90-day tier and firstSeenAt is stamped minutes LATER, when the scanner next
  // runs. The accidental 1-day padding used to cover that gap; with it removed the page has to add
  // a day of grace or every 3-month lock it sells is rejected by our own minimum.
  const signed = NOW, seen = NOW + 300;          // indexed 5 minutes after signing
  const mk = (days) => s.normalizeEscrow("TIER", {
    recipient: "Carol", tokenMint: "CUNA", creator: "Carol", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(signed), cliffTime: bn(signed + days * DAY), frequency: bn(DAY),
    numberOfPeriod: bn(1), cliffUnlockAmount: bn("69000000000000"), amountPerPeriod: bn(0),
    totalClaimedAmount: bn(0),
  }, seen);
  const cfg = { mint: "CUNA", minDurationDays: 90, minLockRaw: "69000000000000", excludeWallets: [] };
  assert.deepStrictEqual(s.disqualify(mk(90), cfg), ["no tokens locked for 90 days or more"],
    "a bare 90-day cliff misses by the indexing lag — this is why the page adds grace");
  assert.deepStrictEqual(s.disqualify(mk(91), cfg), [],
    "with one day of grace the entry tier qualifies");
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

// A single-cliff lock, exactly what the page builds: everything releases at the end, so the
// arithmetic is exact and a ratio means what it says.
const tierLock = (who, days) => s.normalizeEscrow(who, {
  recipient: who, tokenMint: "CUNA", creator: who, cancelMode: 0, cancelledAt: 0,
  vestingStartTime: NOW, cliffTime: NOW + days * DAY, frequency: DAY, numberOfPeriod: 1,
  cliffUnlockAmount: 1000000n, amountPerPeriod: 0n, totalClaimedAmount: 0n,
}, NOW);

t("a longer term earns more per token — up to the top tier", () => {
  const a = tierLock("A", 360);    // 12 months
  const b = tierLock("B", 90);     // 3 months
  const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.A, r.credits.B * 4n, "12 months must pay exactly 4x the entry tier");
});

t("THE CEILING: past 18 months a longer term buys nothing", () => {
  // Weight is amount x committed days with nothing else bounding it, so without this a five-year
  // lock built straight on Jupiter would earn 20x — a rate the page says is not on offer. Locking
  // longer is allowed and costs nothing; it simply earns the top-tier rate.
  const top = tierLock("T", 540);      // 18 months
  const huge = tierLock("H", 1825);    // five years
  const r = s.accrueDay({ locks: [top, huge], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  assert.strictEqual(r.credits.H, r.credits.T, "a five-year lock out-earned the top tier");
  assert.strictEqual(s.weightOf(huge, NOW, CFG), s.weightOf(top, NOW, CFG));
});

t("the ceiling CANNOT be switched off by a cleared or nonsense config value", () => {
  // Number(null) is 0, so a bare `cfg.maxTermDays || DEFAULT` would read a config typo as "no cap".
  // Every unusable value must fall back to the 540-day default, never to unbounded.
  const huge = tierLock("H", 1825);
  const capped = s.weightOf(huge, NOW, { maxTermDays: 540 });
  for (const bad of [null, 0, "", undefined, NaN, -1, "lots", 1.5, Infinity]) {
    assert.strictEqual(s.weightOf(huge, NOW, { maxTermDays: bad }), capped,
      `maxTermDays=${String(bad)} removed the ceiling`);
  }
  assert.strictEqual(s.weightOf(huge, NOW, undefined), capped, "no cfg at all removed the ceiling");
  assert.strictEqual(s.maxTermDaysOf({}), s.DEFAULT_MAX_TERM_DAYS);
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

section("the per-wallet cap (OFF by default)");

t("with no cap set, nothing changes", () => {
  const a = lock({ escrow: "A", recipient: "A", durationDays: 1095 });
  const b = lock({ escrow: "B", recipient: "B", durationDays: 90 });
  const plain = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: CFG });
  for (const off of [undefined, 0, null, "", 100, -5, NaN]) {
    const r = s.accrueDay({ locks: [a, b], poolRaw: "1000000", nowUnix: NOW, cfg: { ...CFG, maxWalletSharePct: off } });
    assert.deepStrictEqual(r.credits, plain.credits, `maxWalletSharePct=${off} changed the split`);
    assert.deepStrictEqual(r.capped, []);
  }
});

t("THE ONE THAT MATTERS: a dominant wallet is held to the cap", () => {
  // On the day this was written ONE wallet took 92% of the pool.
  const whale = lock({ escrow: "W", recipient: "Whale", totalRaw: "226000000000000000", durationDays: 471 });
  const small = lock({ escrow: "S", recipient: "Small", totalRaw: "50000000000000000", durationDays: 177 });
  const cfg = { ...CFG, maxWalletSharePct: 33 };
  const r = s.accrueDay({ locks: [whale, small], poolRaw: "1000000", nowUnix: NOW, cfg });
  // The whale drops from ~92% to 33%. The freed share then makes the OTHER wallet dominant, so it
  // is capped too — with two lockers and a 33% ceiling, neither can exceed 33% and 34% simply is
  // not emitted. That is the cap doing exactly what it says, not a bug.
  assert.deepStrictEqual(r.capped.sort(), ["Small", "Whale"]);
  assert.strictEqual(r.credits.Whale, 330000n);
  assert.strictEqual(r.credits.Small, 330000n);
  assert.strictEqual(r.undistributed, 340000n);
});

t("the cap ties total emission to PARTICIPATION — the full pool needs enough lockers", () => {
  // A 33% ceiling means at most 33% x (lockers) can ever go out: two lockers cap the day at 66%,
  // three unlock the whole pool. That is a real consequence of setting a cap and worth knowing
  // before switching one on — it throttles the emission early, when few people have joined.
  const cfg = { ...CFG, maxWalletSharePct: 33 };
  const mk = (i) => lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 });
  for (const [n, expected] of [[1, 330000n], [2, 660000n], [3, 990000n], [4, 1000000n]]) {
    const r = s.accrueDay({ locks: Array.from({ length: n }, (_, i) => mk(i)),
                            poolRaw: "1000000", nowUnix: NOW, cfg });
    assert.strictEqual(r.distributed, expected, `${n} locker(s) should emit ${expected}`);
  }
});

t("what a capped wallet cannot take is NOT emitted", () => {
  // Fewer tokens released when few people are locked is the conservative outcome, and the one the
  // owner asked for. It is reported as undistributed, never carried forward as a debt.
  const only = lock({ escrow: "W", recipient: "Whale", durationDays: 365 });
  const r = s.accrueDay({ locks: [only], poolRaw: "1000000", nowUnix: NOW, cfg: { ...CFG, maxWalletSharePct: 33 } });
  assert.strictEqual(r.credits.Whale, 330000n);
  assert.strictEqual(r.undistributed, 670000n);
  assert.strictEqual(r.distributed + r.undistributed, 1000000n, "the pool must still add up");
});

t("SPLITTING ONE POSITION ACROSS LOCKS DOES NOT BUY MORE CAP", () => {
  // The cap is per WALLET but weight is per LOCK. Without folding locks together first, three
  // locks to one wallet would take three times the ceiling.
  const one = lock({ escrow: "A", recipient: "Same", totalRaw: "30000000000000000", durationDays: 365 });
  const two = lock({ escrow: "B", recipient: "Same", totalRaw: "30000000000000000", durationDays: 365 });
  const three = lock({ escrow: "C", recipient: "Same", totalRaw: "30000000000000000", durationDays: 365 });
  const other = lock({ escrow: "D", recipient: "Other", totalRaw: "1000000000000000", durationDays: 365 });
  const r = s.accrueDay({ locks: [one, two, three, other], poolRaw: "1000000", nowUnix: NOW,
                          cfg: { ...CFG, maxWalletSharePct: 33 } });
  assert.strictEqual(r.credits.Same, 330000n, "three locks took more than one wallet's cap");
});

t("under the cap, everyone is paid normally and nothing is stranded", () => {
  const locks = Array.from({ length: 5 }, (_, i) =>
    lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 }));
  const r = s.accrueDay({ locks, poolRaw: "1000001", nowUnix: NOW, cfg: { ...CFG, maxWalletSharePct: 33 } });
  assert.deepStrictEqual(r.capped, []);
  assert.strictEqual(r.distributed, 1000001n);
  assert.strictEqual(r.undistributed, 0n);
});

t("several whales are each capped, and the loop terminates", () => {
  const locks = Array.from({ length: 4 }, (_, i) =>
    lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 }));
  const r = s.accrueDay({ locks, poolRaw: "1000000", nowUnix: NOW, cfg: { ...CFG, maxWalletSharePct: 20 } });
  assert.strictEqual(r.capped.length, 4, "all four should hit the 20% ceiling");
  assert.strictEqual(r.distributed, 800000n);
  assert.strictEqual(r.undistributed, 200000n);
});

t("no tokens are created or destroyed with a cap in play", () => {
  for (const n of [2, 3, 7, 11]) {
    const locks = Array.from({ length: n }, (_, i) =>
      lock({ escrow: "E" + i, recipient: "W" + i, durationDays: 365 + i * 100,
             totalRaw: String((1000000 + i * 7) * 1000000) }));
    const r = s.accrueDay({ locks, poolRaw: "1000001", nowUnix: NOW, cfg: { ...CFG, maxWalletSharePct: 30 } });
    const sum = Object.values(r.credits).reduce((a, b) => a + b, 0n);
    assert.strictEqual(sum, r.distributed, `${n} lockers: credits do not match distributed`);
    assert.strictEqual(r.distributed + r.undistributed, 1000001n, `${n} lockers: pool does not add up`);
  }
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

const T = ["Treasury"];

t("only locks past their cliff and still running are releasing anything", () => {
  const R = (o) => lock({ recipient: "Treasury", ...o });
  const inCliff = R({ escrow: "A", cliffDays: 180, durationDays: 365 });   // cliff ahead
  const running = R({ escrow: "B", seen: NOW - 200 * DAY, cliffDays: 180, durationDays: 400 });
  const done    = R({ escrow: "C", seen: NOW - 500 * DAY, cliffDays: 180, durationDays: 365 });
  assert.strictEqual(s.dailyUnlockRaw([inCliff], NOW, T), 0n, "a lock inside its cliff releases nothing");
  assert.strictEqual(s.dailyUnlockRaw([done], NOW, T), 0n, "a finished lock releases nothing");
  assert.ok(s.dailyUnlockRaw([running], NOW, T) > 0n);
  assert.strictEqual(s.dailyUnlockRaw([inCliff, running, done], NOW, T), s.dailyUnlockRaw([running], NOW, T));
});

t("THE ONE THAT MATTERS: a community lock's unlock does NOT fund the pool", () => {
  // Their tokens land in THEIR wallet. Counting them publishes a pool the treasury cannot pay.
  const ours   = lock({ escrow: "A", recipient: "Treasury", seen: NOW - 200 * DAY, cliffDays: 180, durationDays: 400 });
  const theirs = lock({ escrow: "B", recipient: "Someone",  seen: NOW - 200 * DAY, cliffDays: 180, durationDays: 400 });
  assert.strictEqual(s.dailyUnlockRaw([ours, theirs], NOW, T), s.dailyUnlockRaw([ours], NOW, T));
  assert.strictEqual(s.dailyUnlockRaw([theirs], NOW, T), 0n);
});

t("forgetting the funding wallets throws rather than quietly counting everything", () => {
  const l = lock({ recipient: "Treasury", seen: NOW - 200 * DAY, cliffDays: 180, durationDays: 400 });
  for (const bad of [undefined, null, []]) {
    assert.throws(() => s.dailyUnlockRaw([l], NOW, bad), /funding wallets/);
  }
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

t("a FIXED pool is a flat number, not arithmetic on a live stream", () => {
  // 345,000/day: exactly half the 690,000 burn and 5x the 69,000 minimum lock. A percentage of
  // the stream gives 331,643, which reads as a calculation rather than a decision.
  const fixed = "345000000000000";
  assert.strictEqual(s.poolForDay({ dailyUnlockRaw: "6632857000000000", fixedRaw: fixed }), BigInt(fixed));
  // and it stays flat as the stream wobbles, which is the whole point
  assert.strictEqual(s.poolForDay({ dailyUnlockRaw: "5000000000000000", fixedRaw: fixed }), BigInt(fixed));
  assert.strictEqual(s.poolForDay({ dailyUnlockRaw: "9000000000000000", fixedRaw: fixed }), BigInt(fixed));
});

t("THE ONE THAT MATTERS: a fixed pool is still capped by the stream it comes from", () => {
  // The guarantee is that this only ever hands out tokens that were unlocking anyway. The
  // treasury's schedules DO finish; a flat 345,000 against a stream that has fallen to 200,000
  // would be a promise the chain cannot keep.
  const fixed = "345000000000000";           // 345,000
  const thin = "200000000000000";            // the stream is down to 200,000/day
  const pool = s.poolForDay({ dailyUnlockRaw: thin, fixedRaw: fixed, maxSharePct: 25 });
  assert.strictEqual(pool, 50000000000000n);  // 25% of 200,000 = 50,000
  assert.ok(pool < BigInt(fixed));
  // never more than the ceiling, whatever the stream
  for (const u of ["6632857000000000", "1000000000000000", "500000000000000", "1000000000"]) {
    const p = s.poolForDay({ dailyUnlockRaw: u, fixedRaw: fixed, maxSharePct: 25 });
    assert.ok(p * 100n <= BigInt(u) * 25n, `pool ${p} exceeded 25% of ${u}`);
  }
});

t("clearing the fixed amount falls back to the percentage", () => {
  for (const empty of [null, undefined, "", "0", 0]) {
    assert.strictEqual(s.poolForDay({ dailyUnlockRaw: "1000000", fixedRaw: empty, sharePct: 5 }), 50000n);
  }
});

t("a nonsense fixed amount or ceiling is refused, not silently treated as zero", () => {
  assert.throws(() => s.poolForDay({ dailyUnlockRaw: "1000000", fixedRaw: "lots" }), /fixedRaw/);
  assert.throws(() => s.poolForDay({ dailyUnlockRaw: "1000000", fixedRaw: "-5" }), /fixedRaw/);
  for (const bad of [0, -1, 101, NaN, null]) {
    assert.throws(() => s.poolForDay({ dailyUnlockRaw: "1000000", fixedRaw: "500", maxSharePct: bad }), /maxSharePct/);
  }
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
  const bn = (n) => ({ toString: () => String(n) });
  const big = s.normalizeEscrow("BIG", {
    recipient: "B", tokenMint: "CUNA", creator: "B", cancelMode: 0, cancelledAt: 0,
    vestingStartTime: bn(NOW), cliffTime: bn(NOW + 400 * DAY), frequency: bn(DAY), numberOfPeriod: bn(1),
    cliffUnlockAmount: bn("175000000000000000"), amountPerPeriod: bn(0), totalClaimedAmount: bn(0),
  }, NOW);
  assert.strictEqual(s.weightOf(big, NOW, CFG), BigInt("175000000000000000") * 400n);
  assert.strictEqual(s.splitOf(big, NOW).unvestedRaw, "175000000000000000");
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
