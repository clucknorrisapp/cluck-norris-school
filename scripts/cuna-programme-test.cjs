"use strict";
// Tests for lib/cuna-programme.js — the arm gate, the config guard, and the once-per-day ledger.
//
// The owner's instruction is the top requirement here: "no one earns until I make the
// announcements." Disarmed must be a wall, not a default someone can drift past.

const assert = require("assert");
const p = require("../lib/cuna-programme");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const NOW = 1_800_000_000;
const TREASURY = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

section("armed is OFF until the owner says otherwise");

t("THE ONE THAT MATTERS: nothing accrues while disarmed", () => {
  for (const stored of [undefined, null, {}, { armed: false }, { startedAt: NOW }]) {
    const g = p.accrualGate({ programme: stored, paidDays: {}, nowUnix: NOW });
    assert.strictEqual(g.ok, false, `${JSON.stringify(stored)} let accrual through`);
    assert.ok(/not armed|no start date/.test(g.reason), g.reason);
  }
});

t("ONLY the boolean true arms it — a truthy value is not consent", () => {
  // Every fixture here carries a valid startedAt, so the ONLY thing that can refuse it is the
  // armed check itself. Without that, a `!!armed` bug is caught by the missing-start-date branch
  // instead and the test passes while the gate is open.
  for (const armed of ["yes", "true", "false", 1, -1, [], {}, "0", " "]) {
    const g = p.accrualGate({ programme: { armed, startedAt: NOW - p.DAY }, paidDays: {}, nowUnix: NOW });
    assert.strictEqual(g.ok, false, `armed=${JSON.stringify(armed)} started the emission`);
    assert.ok(/not armed/.test(g.reason), g.reason);
  }
  // and the real thing still works
  assert.strictEqual(p.accrualGate({ programme: { armed: true, startedAt: NOW - p.DAY },
                                     paidDays: {}, nowUnix: NOW }).ok, true);
});

t("a fresh programme reads as disarmed with no start date", () => {
  const r = p.readProgramme(undefined);
  assert.strictEqual(r.armed, false);
  assert.strictEqual(r.startedAt, null);
});

t("arming opens the gate and records the start", () => {
  const armed = p.arm({}, NOW);
  assert.strictEqual(armed.armed, true);
  assert.strictEqual(armed.startedAt, NOW);
  assert.strictEqual(p.accrualGate({ programme: armed, paidDays: {}, nowUnix: NOW }).ok, true);
});

t("THE START DATE NEVER MOVES — pause and resume must not re-cut anyone's terms", () => {
  // Terms are measured forward from firstSeenAt against this date. A start that slid on every
  // resume would let a pause quietly re-qualify or disqualify every lock in the programme.
  let s = p.arm({}, NOW);
  s = p.disarm(s);
  assert.strictEqual(s.startedAt, NOW, "disarming dropped the start date");
  s = p.arm(s, NOW + 400 * p.DAY);
  assert.strictEqual(s.startedAt, NOW, "re-arming moved the start date");
  assert.strictEqual(s.armed, true);
});

t("re-arming an already armed programme changes nothing", () => {
  const a = p.arm({}, NOW);
  assert.deepStrictEqual(p.arm(a, NOW + p.DAY), a);
});

t("arming with a broken clock throws rather than storing a bad start", () => {
  for (const bad of [0, -1, NaN, null, undefined, "later"]) {
    assert.throws(() => p.arm({}, bad), /nowUnix/);
  }
});

section("the config guard");

t("the defaults are the owner's numbers", () => {
  assert.strictEqual(p.DEFAULTS.sharePct, 5);
  // 345,000/day flat — half the 690,000 burn, 5x the 69,000 floor
  assert.strictEqual(BigInt(p.DEFAULTS.poolDailyRaw) / 10n ** 9n, 345000n);
  assert.strictEqual(p.DEFAULTS.maxSharePct, 25);
  assert.strictEqual(p.DEFAULTS.minDurationDays, 90);      // 3 months (owner, 2026-09-05)
  assert.strictEqual(p.DEFAULTS.minCliffDays, undefined);  // there is no cliff any more
  assert.deepStrictEqual(p.DEFAULTS.excludeWallets, [TREASURY]);
});

t("the per-wallet cap ships OFF", () => {
  assert.strictEqual(p.DEFAULTS.maxWalletSharePct, 0);
  assert.strictEqual(p.validateConfig({}).maxWalletSharePct, 0);
  assert.strictEqual(p.validateConfig({ maxWalletSharePct: 33 }).maxWalletSharePct, 33);
  for (const bad of [100, 101, -1, "a third", NaN, null]) {
    assert.throws(() => p.validateConfig({ maxWalletSharePct: bad }), /maxWalletSharePct/, `${bad} accepted`);
  }
});

t("the dust floor survives as a string — a JS number would lose it", () => {
  assert.strictEqual(typeof p.DEFAULTS.minLockRaw, "string");
  assert.strictEqual(BigInt(p.DEFAULTS.minLockRaw) / 10n ** 9n, 69000n);
  assert.strictEqual(p.validateConfig({ minLockRaw: "250000000000000" }).minLockRaw, "250000000000000");
  assert.strictEqual(p.validateConfig({ minLockRaw: 0 }).minLockRaw, "0");     // off is allowed
  for (const bad of ["-1", "lots", "1.5", {}]) {
    assert.throws(() => p.validateConfig({ minLockRaw: bad }), /minLockRaw/, `${bad} accepted`);
  }
});

t("THE OTHER ONE: the treasury cannot be dropped from the exclude list", () => {
  // Rule B is the only thing keeping 7.1B of treasury vesting out of the pool — nothing about
  // those locks' terms disqualifies them. Removing it would read as a tidy-up in a diff.
  assert.throws(() => p.validateConfig({ excludeWallets: [] }), /refusing to drop/);
  assert.throws(() => p.validateConfig({ excludeWallets: ["6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh"] }),
    /refusing to drop/);
  // Adding wallets alongside it is fine — that is the normal edit.
  const ok = p.validateConfig({ excludeWallets: [TREASURY, "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh"] });
  assert.strictEqual(ok.excludeWallets.length, 2);
});

t("the fixed pool can be cleared to fall back to the percentage, but not corrupted", () => {
  assert.strictEqual(p.validateConfig({ poolDailyRaw: "0" }).poolDailyRaw, "0");
  assert.strictEqual(p.validateConfig({ poolDailyRaw: "" }).poolDailyRaw, "0");
  assert.strictEqual(p.validateConfig({ poolDailyRaw: "500000000000000" }).poolDailyRaw, "500000000000000");
  for (const bad of ["lots", "-1", "1.5", {}]) {
    assert.throws(() => p.validateConfig({ poolDailyRaw: bad }), /poolDailyRaw/, `${JSON.stringify(bad)} accepted`);
  }
});

t("a nonsense share is refused, not clamped", () => {
  for (const bad of [0, -5, 101, NaN, null, "twenty", Infinity]) {
    assert.throws(() => p.validateConfig({ sharePct: bad }), /sharePct/, `sharePct=${bad} was accepted`);
  }
  assert.strictEqual(p.validateConfig({ sharePct: 35 }).sharePct, 35);
  assert.strictEqual(p.validateConfig({ sharePct: 0.5 }).sharePct, 0.5);
});

t("a typo'd address is refused rather than silently excluding nobody", () => {
  assert.throws(() => p.validateConfig({ excludeWallets: [TREASURY, "not-an-address"] }), /not an address/);
  assert.throws(() => p.validateConfig({ mint: "CUNA" }), /mint is not an address/);
});

t("a stored config survives a round trip, and unknown keys do not break it", () => {
  const c = p.validateConfig({ sharePct: 25, minDurationDays: 180, weird: true });
  assert.strictEqual(p.readProgramme({ config: c }).config.sharePct, 25);
  assert.strictEqual(p.readProgramme({ config: c }).config.minDurationDays, 180);
});

section("one day, once");

t("a day is keyed by UTC calendar date", () => {
  assert.strictEqual(p.dayKey(1800000000), new Date(1800000000000).toISOString().slice(0, 10));
  // Same day either side of a local-midnight boundary, because it is UTC.
  assert.strictEqual(p.dayKey(1800000000), p.dayKey(1800000000 + 3600));
  assert.throws(() => p.dayKey("today"), /real unix time/);
});

t("THE THIRD ONE: an already-accrued day is refused", () => {
  // A redeploy mid-run, a retry, or two schedulers racing would otherwise pay the day twice.
  const armed = p.arm({}, NOW - 10 * p.DAY);
  const key = p.sliceKey(NOW);
  const g = p.accrualGate({ programme: armed, paidDays: { [key]: { distributed: "1" } }, nowUnix: NOW });
  assert.strictEqual(g.ok, false);
  assert.ok(/already accrued/.test(g.reason), g.reason);
  assert.strictEqual(g.day, key);
});

t("a day recorded as paying nothing still counts as paid", () => {
  // Nobody qualified that day. It must not be retried later and paid at a different rate.
  const armed = p.arm({}, NOW - 10 * p.DAY);
  const g = p.accrualGate({ programme: armed, paidDays: { [p.sliceKey(NOW)]: null }, nowUnix: NOW });
  assert.strictEqual(g.ok, false);
  assert.ok(/already accrued/.test(g.reason));
});

t("a clock before the start is refused", () => {
  const armed = p.arm({}, NOW);
  const g = p.accrualGate({ programme: armed, paidDays: {}, nowUnix: NOW - p.DAY });
  assert.strictEqual(g.ok, false);
  assert.ok(/before the programme start/.test(g.reason), g.reason);
});

t("a bad clock is refused without throwing — a scheduler should log, not crash", () => {
  const armed = p.arm({}, NOW);
  for (const bad of [0, -1, NaN, null, "now"]) {
    const g = p.accrualGate({ programme: armed, paidDays: {}, nowUnix: bad });
    assert.strictEqual(g.ok, false);
    assert.ok(/bad clock/.test(g.reason), `${bad}: ${g.reason}`);
  }
});

t("an open gate hands back the day and the config to accrue with", () => {
  const armed = p.arm({ config: p.validateConfig({ sharePct: 20 }) }, NOW - p.DAY);
  const g = p.accrualGate({ programme: armed, paidDays: {}, nowUnix: NOW });
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.day, p.sliceKey(NOW));
  assert.strictEqual(g.sliceIndex, new Date(NOW * 1000).getUTCHours());
  assert.strictEqual(g.config.sharePct, 20);
  assert.strictEqual(g.config.minDurationDays, 90);
  assert.deepStrictEqual(g.config.excludeWallets, [TREASURY]);
});

section("days the app was down for");

t("a day with no ledger entry between the start and yesterday is reported missed", () => {
  const armed = p.arm({}, NOW - 5 * p.DAY);
  const paid = {};
  // armed 5 hours ago; hours -1, -2 and -4 ran; -5 (the arm hour) and -3 did not
  const HOUR = 3600;
  const armed5 = { armed: true, startedAt: NOW - 5 * HOUR };
  for (const i of [1, 2, 4]) paid[p.sliceKey(NOW - i * HOUR)] = { distributed: "1" };
  const missed = p.missedSlices({ programme: armed5, paidDays: paid, nowUnix: NOW });
  assert.deepStrictEqual(missed, [p.sliceKey(NOW - 5 * HOUR), p.sliceKey(NOW - 3 * HOUR)]);
});

t("TODAY is never 'missed' — it has not finished yet", () => {
  const armed = p.arm({}, NOW - 3 * p.DAY);
  const missed = p.missedSlices({ programme: armed, paidDays: {}, nowUnix: NOW });
  assert.ok(!missed.includes(p.sliceKey(NOW)), "the current hour was reported as missed");
});

t("nothing before the programme started counts as missed", () => {
  // armed exactly 48 hours ago and never accrued: 48 missed hours — the arm hour through the
  // previous full hour — and not one earlier
  const armed = p.arm({}, NOW - 2 * p.DAY);
  const missed = p.missedSlices({ programme: armed, paidDays: {}, nowUnix: NOW });
  assert.strictEqual(missed.length, 48);
  for (const d of missed) assert.ok(d >= p.sliceKey(NOW - 2 * p.DAY));
  assert.strictEqual(missed[0], p.sliceKey(NOW - 2 * p.DAY), "the arm hour itself is first");
});

t("a day that paid NOTHING is not a missed day", () => {
  // Nobody qualified that day. It ran. Re-running it later at a different rate would be wrong.
  const armed = p.arm({}, NOW - 2 * p.DAY);
  const HOUR2 = 3600;
  const armed2 = { armed: true, startedAt: NOW - 2 * HOUR2 };
  const paid = { [p.sliceKey(NOW - 1 * HOUR2)]: { distributed: "0", credits: {} },
                 [p.sliceKey(NOW - 2 * HOUR2)]: null };
  assert.deepStrictEqual(p.missedSlices({ programme: armed2, paidDays: paid, nowUnix: NOW }), []);
});

t("a disarmed or unstarted programme reports nothing rather than a year of gaps", () => {
  assert.deepStrictEqual(p.missedDays({ programme: {}, paidDays: {}, nowUnix: NOW }), []);
  assert.deepStrictEqual(p.missedDays({ programme: p.arm({}, NOW), paidDays: {}, nowUnix: 0 }), []);
});

t("a very long outage is bounded, not an infinite walk", () => {
  const armed = p.arm({}, NOW - 5000 * p.DAY);
  const missed = p.missedSlices({ programme: armed, paidDays: {}, nowUnix: NOW });
  assert.ok(missed.length <= 400 * p.SLICES_PER_DAY, "the walk must be bounded: got " + missed.length);
});

section("the arm day is never lost");

t("the arm HOUR is reported if it never accrued", () => {
  // Armed at 23:30 UTC; nothing ran until the 00:xx tick. The 23:00 slice is missed and listed.
  const armedAt = Date.UTC(2026, 8, 4, 23, 30) / 1000;
  const prog = { armed: true, startedAt: armedAt, config: {} };
  const paid = { "2026-09-05T00": {}, "2026-09-05T01": {} };
  const later = Date.UTC(2026, 8, 5, 2, 30) / 1000;
  assert.deepStrictEqual(p.missedSlices({ programme: prog, paidDays: paid, nowUnix: later }), ["2026-09-04T23"]);
});

t("HOURLY SLICES: twenty-four slices sum to exactly the daily pool, remainder on the last", () => {
  const daily = "345000000000000";
  let sum = 0n;
  for (let h = 0; h < p.SLICES_PER_DAY; h++) sum += p.slicePoolRaw(daily, h);
  assert.strictEqual(sum.toString(), daily);
  assert.strictEqual(p.slicePoolRaw(daily, 0), 345000000000000n / 24n);
  assert.ok(p.slicePoolRaw(daily, 23) >= p.slicePoolRaw(daily, 0));
  // an awkward pool: 7 base units across 24 slices — nothing lost, nothing invented
  let s7 = 0n; for (let h = 0; h < 24; h++) s7 += p.slicePoolRaw("7", h);
  assert.strictEqual(s7, 7n);
});

t("the gate opens once per HOUR: the same hour is refused, the next hour is not", () => {
  const armed = p.arm({}, NOW - 3600);
  const first = p.accrualGate({ programme: armed, paidDays: {}, nowUnix: NOW });
  assert.strictEqual(first.ok, true);
  const again = p.accrualGate({ programme: armed, paidDays: { [first.slice]: {} }, nowUnix: NOW + 600 });
  assert.strictEqual(again.ok, /already accrued/.test(again.reason) ? false : again.ok);
  assert.ok(/already accrued/.test(again.reason));
  const next = p.accrualGate({ programme: armed, paidDays: { [first.slice]: {} }, nowUnix: NOW + 3600 });
  assert.strictEqual(next.ok, true);
  assert.notStrictEqual(next.slice, first.slice);
});

t("fundedBy is required and validated separately from excludeWallets", () => {
  assert.throws(() => p.validateConfig({ fundedBy: [] }), /fundedBy/);
  assert.throws(() => p.validateConfig({ fundedBy: ["not-an-address"] }), /fundedBy/);
  const c = p.validateConfig({ excludeWallets: ["2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8", "5WUjHiUVxmUuBnYZx3b5SyFiR7vW2N19VUhgCr2ZRZQ"] });
  assert.deepStrictEqual(c.fundedBy, ["2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8"], "adding an exclude must not widen the funding set");
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
