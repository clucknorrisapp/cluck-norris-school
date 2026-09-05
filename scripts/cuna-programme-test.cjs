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
  assert.strictEqual(p.DEFAULTS.sharePct, 20);
  assert.strictEqual(p.DEFAULTS.minDurationDays, 365);
  assert.strictEqual(p.DEFAULTS.minCliffDays, 180);
  assert.deepStrictEqual(p.DEFAULTS.excludeWallets, [TREASURY]);
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

t("a nonsense share is refused, not clamped", () => {
  for (const bad of [0, -5, 101, NaN, null, "twenty", Infinity]) {
    assert.throws(() => p.validateConfig({ sharePct: bad }), /sharePct/, `sharePct=${bad} was accepted`);
  }
  assert.strictEqual(p.validateConfig({ sharePct: 35 }).sharePct, 35);
  assert.strictEqual(p.validateConfig({ sharePct: 0.5 }).sharePct, 0.5);
});

t("a cliff longer than the term is refused — it could never be met", () => {
  assert.throws(() => p.validateConfig({ minCliffDays: 400, minDurationDays: 365 }), /cannot exceed/);
});

t("a typo'd address is refused rather than silently excluding nobody", () => {
  assert.throws(() => p.validateConfig({ excludeWallets: [TREASURY, "not-an-address"] }), /not an address/);
  assert.throws(() => p.validateConfig({ mint: "CUNA" }), /mint is not an address/);
});

t("a stored config survives a round trip, and unknown keys do not break it", () => {
  const c = p.validateConfig({ sharePct: 25, minCliffDays: 90, weird: true });
  assert.strictEqual(p.readProgramme({ config: c }).config.sharePct, 25);
  assert.strictEqual(p.readProgramme({ config: c }).config.minCliffDays, 90);
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
  const key = p.dayKey(NOW);
  const g = p.accrualGate({ programme: armed, paidDays: { [key]: { distributed: "1" } }, nowUnix: NOW });
  assert.strictEqual(g.ok, false);
  assert.ok(/already accrued/.test(g.reason), g.reason);
  assert.strictEqual(g.day, key);
});

t("a day recorded as paying nothing still counts as paid", () => {
  // Nobody qualified that day. It must not be retried later and paid at a different rate.
  const armed = p.arm({}, NOW - 10 * p.DAY);
  const g = p.accrualGate({ programme: armed, paidDays: { [p.dayKey(NOW)]: null }, nowUnix: NOW });
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
  assert.strictEqual(g.day, p.dayKey(NOW));
  assert.strictEqual(g.config.sharePct, 20);
  assert.deepStrictEqual(g.config.excludeWallets, [TREASURY]);
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
