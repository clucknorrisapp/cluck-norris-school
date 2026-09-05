"use strict";
// Tests for lib/cuna-burn.js — the decisions in front of an irreversible action.
//
// Burning cannot be undone, cannot be partially retried, and destroys supply. Every case here is a
// way the burner could fire when it should not, or fire for the wrong amount.

const assert = require("assert");
const b = require("../lib/cuna-burn");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const WALLET = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const AMOUNT = 690000n * 10n ** 9n;
const PLENTY = (AMOUNT * 10n).toString();
// 15:00 UTC on a real day, so the hour gate is satisfiable.
const NOW = Math.floor(Date.parse("2026-09-05T15:30:00Z") / 1000);
const armed = (over = {}) => b.arm({ config: b.validateBurnConfig({ wallet: WALLET, ...over }) }, NOW);
// A sentinel, because `undefined` is itself one of the values under test: using it to mean "give
// me the default" made two tests silently exercise a healthy burner instead of a broken one.
const D = Symbol("default");
const pick = (v, dflt) => (v === D ? dflt : v);
const gate = (o = {}) => b.burnGate({
  burn: pick("burn" in o ? o.burn : D, armed()),
  burnedDays: o.burnedDays || {},
  nowUnix: pick("nowUnix" in o ? o.nowUnix : D, NOW),
  balanceRaw: pick("balanceRaw" in o ? o.balanceRaw : D, PLENTY),
  hasSigner: pick("hasSigner" in o ? o.hasSigner : D, true),
});

section("it ships disarmed, and arming alone is not enough");

t("THE ONE THAT MATTERS: nothing burns while disarmed", () => {
  for (const stored of [undefined, null, {}, { armed: false }, { config: { wallet: WALLET } }]) {
    const g = gate({ burn: stored });
    assert.strictEqual(g.ok, false, `${JSON.stringify(stored)} armed the burner`);
    assert.ok(/not armed/.test(g.reason), g.reason);
  }
});

t("ONLY the boolean true arms it — a truthy value is not consent", () => {
  // Every fixture here is otherwise complete, so the arm check is the ONLY thing that can refuse.
  for (const v of ["yes", "true", "false", 1, -1, [], {}, "0", " "]) {
    const g = gate({ burn: { armed: v, config: { wallet: WALLET } } });
    assert.strictEqual(g.ok, false, `armed=${JSON.stringify(v)} started burning`);
    assert.ok(/not armed/.test(g.reason), g.reason);
  }
});

t("armed but with no signing key burns nothing", () => {
  const g = gate({ hasSigner: false });
  assert.strictEqual(g.ok, false);
  assert.ok(/CUNA_BURN_SECRET/.test(g.reason), g.reason);
});

t("armed but with no dev wallet burns nothing", () => {
  const g = gate({ burn: b.arm({ config: b.validateBurnConfig({}) }, NOW) });
  assert.strictEqual(g.ok, false);
  assert.ok(/no dev wallet/.test(g.reason), g.reason);
});

t("a fully configured, armed burner does fire", () => {
  const g = gate();
  assert.strictEqual(g.ok, true, g.reason);
  assert.strictEqual(g.amountRaw, AMOUNT.toString());
});

section("the amount");

t("THE OTHER ONE: a short balance burns NOTHING, never a partial", () => {
  // A partial burn cannot be undone and cannot be topped up later without double-counting. A day
  // that burned 40,000 instead of 690,000 would look successful forever after.
  const g = gate({ balanceRaw: (AMOUNT - 1n).toString() });
  assert.strictEqual(g.ok, false);
  assert.ok(/SHORT/.test(g.reason), g.reason);
  assert.strictEqual(g.short, true);
  assert.strictEqual(g.amountRaw, undefined, "a short day must not hand back an amount to burn");
});

t("a short day is NOT marked done — a top-up plus a manual run can still burn it", () => {
  const short = gate({ balanceRaw: "0" });
  assert.strictEqual(short.ok, false);
  // same day, now funded
  assert.strictEqual(gate({ balanceRaw: PLENTY }).ok, true);
});

t("exactly enough is enough", () => {
  assert.strictEqual(gate({ balanceRaw: AMOUNT.toString() }).ok, true);
});

t("an unreadable balance burns nothing", () => {
  for (const bad of [undefined, null, "", "lots", "1.5", {}]) {
    const g = gate({ balanceRaw: bad });
    assert.strictEqual(g.ok, false, `balance ${JSON.stringify(bad)} was accepted`);
  }
});

t("THE THIRD ONE: the hard cap cannot be reached from config", () => {
  // 690000 and 690000000 are three keystrokes apart, and one of them is a tenth of the supply.
  assert.throws(() => b.validateBurnConfig({ amountRaw: "690000000000000000" }), /hard daily cap/);
  assert.throws(() => b.validateBurnConfig({ amountRaw: (b.HARD_DAILY_CAP_RAW + 1n).toString() }), /hard daily cap/);
  assert.doesNotThrow(() => b.validateBurnConfig({ amountRaw: b.HARD_DAILY_CAP_RAW.toString() }));
});

t("a nonsense amount is refused rather than treated as zero", () => {
  for (const bad of ["0", "-1", "lots", "1.5", null, {}]) {
    assert.throws(() => b.validateBurnConfig({ amountRaw: bad }), /amountRaw/, `${JSON.stringify(bad)} accepted`);
  }
});

t("the default is the owner's number: 690,000 CUNA", () => {
  assert.strictEqual(b.DEFAULTS.amountRaw, "690000000000000");
  assert.strictEqual(BigInt(b.DEFAULTS.amountRaw) / 10n ** 9n, 690000n);
});

section("once a day, at the hour");

t("the same day cannot be burned twice", () => {
  const day = b.dayKey(NOW);
  const g = gate({ burnedDays: { [day]: { sig: "abc" } } });
  assert.strictEqual(g.ok, false);
  assert.ok(/already burned/.test(g.reason), g.reason);
});

t("a day recorded with no signature still counts as burned", () => {
  // Presence, not truthiness. Re-burning because a record looked empty would destroy 690k twice.
  const g = gate({ burnedDays: { [b.dayKey(NOW)]: null } });
  assert.strictEqual(g.ok, false);
  assert.ok(/already burned/.test(g.reason), g.reason);
});

t("it waits for the configured hour, then fires at or after it", () => {
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  assert.strictEqual(gate({ nowUnix: at("2026-09-05T00:30:00Z") }).ok, false);
  assert.strictEqual(gate({ nowUnix: at("2026-09-05T14:59:00Z") }).ok, false);
  assert.strictEqual(gate({ nowUnix: at("2026-09-05T15:00:00Z") }).ok, true);
  // and still fires later the same day, so a redeploy across the exact hour does not lose it
  assert.strictEqual(gate({ nowUnix: at("2026-09-05T23:59:00Z") }).ok, true);
});

t("a nonsense hour is refused", () => {
  for (const bad of [-1, 24, 1.5, "noon", null]) {
    assert.throws(() => b.validateBurnConfig({ hourUtc: bad }), /hourUtc/, `${bad} accepted`);
  }
  assert.strictEqual(b.validateBurnConfig({ hourUtc: 0 }).hourUtc, 0);
});

t("a bad clock burns nothing and does not throw", () => {
  for (const bad of [0, -1, NaN, null, "now"]) {
    const g = gate({ nowUnix: bad });
    assert.strictEqual(g.ok, false, `clock ${bad} fired a burn`);
  }
});

t("a typo'd wallet is refused rather than burning from nowhere", () => {
  assert.throws(() => b.validateBurnConfig({ wallet: "not-an-address" }), /wallet is not an address/);
  assert.throws(() => b.validateBurnConfig({ mint: "CUNA" }), /mint is not an address/);
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
