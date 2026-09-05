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

t("THE THIRD ONE: two ceilings, and the tighter one binds", () => {
  // HARD_DAILY_CAP (5M) is the typo guard — 690000 and 690000000 are three keystrokes apart, and
  // one of them is a tenth of the supply. AUTO_DAILY_CAP (2M) is the owner's chosen limit for
  // automatic burns and is stricter, so in practice it is what refuses first. Both are asserted
  // because the hard cap is the one that still holds if the auto cap is ever raised.
  assert.ok(b.AUTO_DAILY_CAP_RAW < b.HARD_DAILY_CAP_RAW, "the auto cap should be the tighter of the two");
  assert.throws(() => b.validateBurnConfig({ amountRaw: "690000000000000000" }), /hard daily cap/);
  assert.throws(() => b.validateBurnConfig({ amountRaw: (b.HARD_DAILY_CAP_RAW + 1n).toString() }), /hard daily cap/);
  // between the two caps: refused by the auto cap, not the hard one
  assert.throws(() => b.validateBurnConfig({ amountRaw: (3000000n * 10n ** 9n).toString(), bonusMaxRaw: "0" }),
    /auto daily cap/);
  // and the owner's real numbers are comfortably inside both
  assert.doesNotThrow(() => b.validateBurnConfig({ bonusEnabled: true }));
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

section("claim-first: topping the wallet up before burning");

const esc = (id, cuna) => ({ escrow: id, claimableRaw: (BigInt(cuna) * 10n ** 9n).toString() });

t("it claims the fewest escrows that cover the need, biggest first", () => {
  // One transaction per escrow. Claiming all thirty treasury locks daily would be thirty
  // signatures and thirty fees for a shortfall one lock usually covers.
  const r = b.planClaims([esc("a", 100000), esc("b", 900000), esc("c", 50000), esc("d", 400000)],
    { needRaw: (690000n * 10n ** 9n).toString() });
  assert.deepStrictEqual(r.claims.map((c) => c.escrow), ["b"]);
  assert.strictEqual(r.shortfallRaw, "0");
});

t("it keeps going until the need is met", () => {
  const r = b.planClaims([esc("a", 300000), esc("b", 300000), esc("c", 300000)],
    { needRaw: (690000n * 10n ** 9n).toString() });
  assert.strictEqual(r.claims.length, 3);
  assert.strictEqual(BigInt(r.totalRaw), 900000n * 10n ** 9n);
});

t("a shortfall is REPORTED, not hidden", () => {
  // "We will top up" and "the schedules cannot cover this today" are different facts.
  const r = b.planClaims([esc("a", 1000)], { needRaw: (690000n * 10n ** 9n).toString() });
  assert.strictEqual(r.claims.length, 1);
  assert.strictEqual(BigInt(r.shortfallRaw), 689000n * 10n ** 9n);
});

t("headroom claims extra so this is not signing transactions every single day", () => {
  const need = (100000n * 10n ** 9n).toString();
  const bare = b.planClaims([esc("a", 100000), esc("b", 100000), esc("c", 100000)], { needRaw: need });
  const roomy = b.planClaims([esc("a", 100000), esc("b", 100000), esc("c", 100000)],
    { needRaw: need, headroomRaw: (150000n * 10n ** 9n).toString() });
  assert.strictEqual(bare.claims.length, 1);
  assert.strictEqual(roomy.claims.length, 3);
  assert.strictEqual(roomy.shortfallRaw, "0", "headroom must not manufacture a shortfall");
});

t("escrows with nothing claimable are skipped, not signed for", () => {
  const r = b.planClaims([esc("a", 0), { escrow: "b", claimableRaw: "junk" }, { claimableRaw: "5" },
                          esc("c", 700000)], { needRaw: (690000n * 10n ** 9n).toString() });
  assert.deepStrictEqual(r.claims.map((c) => c.escrow), ["c"]);
});

t("nothing needed means nothing signed", () => {
  for (const n of ["0", "-1"]) {
    assert.deepStrictEqual(b.planClaims([esc("a", 999999)], { needRaw: n }).claims, []);
  }
});

t("the plan is deterministic — same inputs, same transactions", () => {
  const set = [esc("a", 300000), esc("b", 300000), esc("c", 300000), esc("d", 300000)];
  const need = (690000n * 10n ** 9n).toString();
  const one = b.planClaims(set, { needRaw: need }).claims.map((c) => c.escrow);
  const two = b.planClaims([...set].reverse(), { needRaw: need }).claims.map((c) => c.escrow);
  assert.deepStrictEqual(one, two);
});

t("nonsense input throws rather than planning a wrong claim", () => {
  assert.throws(() => b.planClaims([], { needRaw: "lots" }), /whole base units/);
  assert.throws(() => b.planClaims([], { needRaw: "1", headroomRaw: "1.5" }), /whole base units/);
});

section("bonus burns — random size, knowable worst day");

t("bonus is OFF by default: the burn is exactly the base", () => {
  const p = b.amountForDay("2026-09-05", {});
  assert.strictEqual(p.amountRaw, b.DEFAULTS.amountRaw);
  assert.strictEqual(p.bonusRaw, "0");
});

t("only the boolean enables it — a truthy value is not consent for an extra million a day", () => {
  for (const v of ["yes", "true", 1, 0, "", null, undefined, []]) {
    assert.throws(() => b.validateBurnConfig({ bonusEnabled: v }), /bonusEnabled/, `${JSON.stringify(v)} accepted`);
  }
  assert.doesNotThrow(() => b.validateBurnConfig({ bonusEnabled: true }));
});

t("THE ONE THAT MATTERS: base + max bonus can never exceed the auto daily cap", () => {
  // The cap is what makes the worst possible day a number the owner picked, rather than whatever
  // the roll and the retry logic produce together.
  assert.strictEqual(b.AUTO_DAILY_CAP_RAW, 2000000n * 10n ** 9n);
  assert.throws(() => b.validateBurnConfig({ bonusMaxRaw: (2000000n * 10n ** 9n).toString() }), /auto daily cap/);
  assert.throws(() => b.validateBurnConfig({ amountRaw: (1500000n * 10n ** 9n).toString(),
                                             bonusMaxRaw: (900000n * 10n ** 9n).toString() }), /auto daily cap/);
  // and no day's roll can ever land above it
  const cfg = { bonusEnabled: true };
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    assert.ok(BigInt(b.amountForDay(d, cfg).amountRaw) <= b.AUTO_DAILY_CAP_RAW, `${d} exceeded the cap`);
  }
});

t("THE OTHER ONE: the same day always rolls the same number", () => {
  // Seeded from the DATE, never Math.random(). A retry must not roll a DIFFERENT amount and burn
  // twice for two different figures.
  const cfg = { bonusEnabled: true };
  for (const d of ["2026-09-05", "2027-01-01", "2026-12-31"]) {
    const first = b.amountForDay(d, cfg).amountRaw;
    for (let i = 0; i < 20; i++) assert.strictEqual(b.amountForDay(d, cfg).amountRaw, first, `${d} drifted`);
  }
});

t("different days roll genuinely different numbers", () => {
  // The first version used a bare FNV-1a hash and produced 30,000 three days running and exactly
  // 1,000,000 twice in a row — consecutive date strings stayed correlated once scaled down.
  const cfg = { bonusEnabled: true };
  const vals = [];
  for (let i = 0; i < 365; i++) {
    vals.push(b.amountForDay(new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10), cfg).bonusRaw);
  }
  let repeats = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) repeats++;
  assert.ok(repeats <= 10, `${repeats} days matched the day before — the roll is not avalanching`);
  assert.ok(new Set(vals).size > 50, `only ${new Set(vals).size} distinct values in a year`);
  // and it should actually use the range, not hug the middle
  const nums = vals.map(Number).sort((x, y) => x - y);
  assert.ok(nums[0] < 200000 * 1e9, "never rolls low");
  assert.ok(nums[nums.length - 1] > 800000 * 1e9, "never rolls high");
});

t("THE FOURTH ONE: a stale config is CLAMPED at burn time, not obeyed and not thrown", () => {
  // A config stored under an older, looser cap must not burn above today's policy — and must not
  // crash the burner either, because a burner that throws is a burner that silently stops burning.
  const stale = { amountRaw: (4000000n * 10n ** 9n).toString(), bonusEnabled: true,
                  bonusMaxRaw: (3000000n * 10n ** 9n).toString() };
  // validateBurnConfig would refuse to WRITE this...
  assert.throws(() => b.validateBurnConfig(stale), /cap/);
  // ...but if it is already stored, the day's amount is clamped rather than honoured or thrown.
  const p = b.amountForDay("2026-09-05", stale);
  assert.strictEqual(p.amountRaw, b.AUTO_DAILY_CAP_RAW.toString());
  assert.strictEqual(p.capped, true);
});

t("a base OVER the cap is clamped even with the bonus switched off", () => {
  // The bonus-disabled path returns early, so the total clamp never runs. Without the base clamp
  // a stale 4M base would burn 4M — twice today's policy — and every other test stayed green.
  const stale = { amountRaw: (4000000n * 10n ** 9n).toString(), bonusEnabled: false };
  const p = b.amountForDay("2026-09-05", stale);
  assert.strictEqual(p.amountRaw, b.AUTO_DAILY_CAP_RAW.toString());
  assert.strictEqual(p.capped, true);
  assert.strictEqual(p.bonusRaw, "0");
});

t("a base UNDER the cap with a bonus that pushes over is still clamped", () => {
  // The case only the total clamp can catch: base 1.5M is fine on its own, but a 1M bonus would
  // take the day to 2.5M. Without this the two clamps cover for each other and neither is
  // actually tested — removing either one alone kept every test green.
  const stale = { amountRaw: (1500000n * 10n ** 9n).toString(), bonusEnabled: true,
                  bonusMaxRaw: (1000000n * 10n ** 9n).toString() };
  assert.throws(() => b.validateBurnConfig(stale), /auto daily cap/);   // never writable
  let sawClamp = false;
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const p = b.amountForDay(d, stale);
    assert.ok(BigInt(p.amountRaw) <= b.AUTO_DAILY_CAP_RAW, `${d} burned ${p.amountRaw}`);
    if (p.capped) sawClamp = true;
  }
  assert.ok(sawClamp, "no day in 200 hit the clamp — the fixture is not exercising it");
});

t("garbage in a stored config falls back to the base rather than throwing", () => {
  for (const bad of [{ amountRaw: "lots" }, { amountRaw: "0" }, { amountRaw: null },
                     { bonusEnabled: true, bonusMaxRaw: "junk" }, { bonusEnabled: "yes" }]) {
    const p = b.amountForDay("2026-09-05", bad);
    assert.ok(BigInt(p.amountRaw) > 0n, `${JSON.stringify(bad)} produced ${p.amountRaw}`);
    assert.ok(BigInt(p.amountRaw) <= b.AUTO_DAILY_CAP_RAW);
  }
});

t("bonus lands on clean multiples, so an announcement reads as a decision", () => {
  const cfg = { bonusEnabled: true };
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2026, 3, 1) + i * 86400000).toISOString().slice(0, 10);
    assert.strictEqual(BigInt(b.amountForDay(d, cfg).bonusRaw) % b.BONUS_STEP_RAW, 0n, `${d} is not a clean multiple`);
  }
});

t("the gate burns the DAY's amount, not the flat base", () => {
  const cfg = b.validateBurnConfig({ wallet: WALLET, bonusEnabled: true });
  const armedBonus = b.arm({ config: cfg }, NOW);
  const g = b.burnGate({ burn: armedBonus, burnedDays: {}, nowUnix: NOW, balanceRaw: PLENTY, hasSigner: true });
  assert.strictEqual(g.ok, true, g.reason);
  assert.strictEqual(g.amountRaw, b.amountForDay(b.dayKey(NOW), cfg).amountRaw);
  assert.ok(BigInt(g.amountRaw) >= BigInt(cfg.amountRaw), "the day's burn must include the base");
  assert.ok(g.plan && g.plan.bonusRaw != null, "the gate should report how the amount was made up");
});

t("a short balance still blocks a bonus day — nothing partial", () => {
  const cfg = b.validateBurnConfig({ wallet: WALLET, bonusEnabled: true });
  const armedBonus = b.arm({ config: cfg }, NOW);
  const need = BigInt(b.amountForDay(b.dayKey(NOW), cfg).amountRaw);
  const g = b.burnGate({ burn: armedBonus, burnedDays: {}, nowUnix: NOW,
                         balanceRaw: (need - 1n).toString(), hasSigner: true });
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.short, true);
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
