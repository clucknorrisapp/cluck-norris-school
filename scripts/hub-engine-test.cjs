#!/usr/bin/env node
"use strict";
// The per-project Lock to Earn engine (lib/hub/engine.js) — Phase 1a of the platform. Every case
// is a way a project's programme pays the wrong hour, the wrong wallet, or the wrong amount:
//   - the rules config comes from the project's version IN FORCE, and carries the new terms
//     (cancelable allowed, vesting shape) — and is null before the first version is effective;
//   - the two new rules admit and refuse the right lock shapes; the CUNA defaults are unchanged;
//   - one hour credits exactly the slice pool, the last slice carries the remainder, a disarmed
//     or already-accrued hour refuses, an implausible scan refuses, an empty first scan writes a
//     zero row (so it is not "missed");
//   - the tick writes days and the firstSeenAt ledger under the PROJECT's keys, never CUNA's, and
//     the second tick in the same hour is a no-op; a disarmed project never writes its ledger;
//   - the holder view says locked / how long / earned / paid with signatures / owed.
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const eng = require("../lib/hub/engine");
const prog = require("../lib/cuna-programme");
const s = require("../lib/cuna-staking");
const elig = require("../lib/hub/eligibility");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", OP: "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ", MINT: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DAY = 86400;
// 2026-09-17T12:00:00Z — a Thursday, mid-day, slice 12
const NOW = Math.floor(Date.parse("2026-09-17T12:00:00Z") / 1000);
const TOKENS = (n) => (BigInt(n) * 10n ** 9n).toString();

const mkProject = (id = "rose", over = {}) => proj.validateProject({ id, label: "OnlyRose", symbol: "ROSE", mint: W.MINT, fundingWallet: W.FUND, operatorWallets: [W.OP], ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });
const mkState = (project, terms = {}, day = "2026-09-17") => proj.createVersion({}, project, { poolDailyRaw: TOKENS(2400), fundedBy: [W.FUND], minLockRaw: TOKENS(10), minDurationDays: 90, maxTermDays: 540, ...terms }, { effectiveFrom: day, todayKey: day });
// A fake Jupiter Lock escrow account: one cliff release `cliffDays` out, optional periodic tail.
const escrow = (n, { recipient = W.A, creator = W.A, amount = TOKENS(100), cliffDays = 180, periods = 0, perPeriod = "0", cancelMode = 0, cancelledAt = 0, freqDays = 30 } = {}) => ({
  escrow: "Esc" + String(n).padStart(29, "1") + "1111111111111",
  account: { tokenMint: W.MINT, recipient, creator, cancelMode, cancelledAt, vestingStartTime: NOW - 30 * DAY,
    cliffTime: NOW + cliffDays * DAY, frequency: freqDays * DAY, numberOfPeriod: periods, cliffUnlockAmount: amount, amountPerPeriod: perPeriod, totalClaimedAmount: "0" },
});
const normalized = (e, firstSeenAt = NOW - 10 * DAY) => s.normalizeEscrow(e.escrow, e.account, firstSeenAt);
// deps that never touch a chain
const depsFor = (scanned, created = {}) => ({ scan: async () => scanned, creationTimes: async () => created });

section("1. config from the version in force");

t("configFor maps the terms to the rules config and carries the new fields; null before effectiveFrom", () => {
  const P = mkProject();
  const st = { ...mkState(P, { cancelableAllowed: true, vesting: "cliff-only", payoutSchedule: "monthly" }), armed: true, startedAt: NOW - DAY };
  const cfg = eng.configFor({ project: P, state: st, nowUnix: NOW });
  assert.strictEqual(cfg.mint, W.MINT);
  assert.strictEqual(cfg.startAfterUnix, NOW - DAY);
  assert.strictEqual(cfg.minDurationDays, 90); assert.strictEqual(cfg.maxTermDays, 540); assert.strictEqual(cfg.minLockRaw, TOKENS(10));
  assert.ok(cfg.excludeWallets.includes(W.FUND), "the funding wallet is always excluded (Rule B per project)");
  assert.deepStrictEqual(cfg.fundedBy, [W.FUND]);
  assert.strictEqual(cfg.cancelableAllowed, true); assert.strictEqual(cfg.vesting, "cliff-only"); assert.strictEqual(cfg.payoutSchedule, "monthly");
  assert.strictEqual(cfg.programVersion, 1); assert.ok(/^[0-9a-f]{64}$/.test(cfg.programHash));
  assert.strictEqual(eng.configFor({ project: P, state: st, nowUnix: NOW - 2 * DAY }), null, "before the version is effective there is no config");
});

t("arm is one-way for the start date; a project with no version cannot be armed", () => {
  const P = mkProject();
  assert.throws(() => eng.arm({}, NOW), /no program version/);
  const a = eng.arm(mkState(P), NOW);
  assert.strictEqual(a.armed, true); assert.strictEqual(a.startedAt, NOW);
  const b = eng.arm(eng.disarm(a), NOW + 5 * DAY);
  assert.strictEqual(b.startedAt, NOW, "re-arming keeps the original start");
  assert.strictEqual(eng.disarm(a).armed, false);
});

section("2. the two new rules (rules engine)");

t("a cancelable lock is refused by default and admitted when the program allows it; unreadable cancel mode always fails closed", () => {
  const base = { mint: W.MINT, minDurationDays: 90, minLockRaw: 0, excludeWallets: [] };
  const l = normalized(escrow(1, { cancelMode: 1 }));
  assert.ok(s.disqualify(l, base).some((r) => /cancelable/.test(r)));
  assert.ok(!s.disqualify(l, { ...base, cancelableAllowed: true }).some((r) => /cancelable/.test(r)));
  const bad = normalized({ ...escrow(2), account: { ...escrow(2).account, cancelMode: null } });
  assert.ok(s.disqualify(bad, { ...base, cancelableAllowed: true }).some((r) => /cancelable/.test(r)), "a missing cancel mode is never trusted, even when cancelable is allowed");
  assert.ok(s.disqualify(normalized(escrow(3, { cancelMode: 1, cancelledAt: NOW - DAY })), { ...base, cancelableAllowed: true }).some((r) => /already cancelled/.test(r)));
});

t("vesting shape: cliff-only refuses a periodic schedule, vesting-only refuses a single release, any takes both; both reasons have codes", () => {
  const base = { mint: W.MINT, minDurationDays: 90, minLockRaw: 0, excludeWallets: [] };
  const single = normalized(escrow(4));
  const periodic = normalized(escrow(5, { periods: 6, perPeriod: TOKENS(10), cliffDays: 120 }));
  assert.ok(s.qualifies(single, base) && s.qualifies(periodic, base), "any (default) admits both");
  assert.ok(s.disqualify(periodic, { ...base, vesting: "cliff-only" }).some((r) => /vesting schedule not allowed/.test(r)));
  assert.ok(s.qualifies(single, { ...base, vesting: "cliff-only" }));
  assert.ok(s.disqualify(single, { ...base, vesting: "vesting-only" }).some((r) => /single-release lock not allowed/.test(r)));
  assert.ok(s.qualifies(periodic, { ...base, vesting: "vesting-only" }));
  assert.strictEqual(elig.codeFor("vesting schedule not allowed — x"), "vesting_not_allowed");
  assert.strictEqual(elig.codeFor("single-release lock not allowed — x"), "cliff_not_allowed");
});

section("3. one hour of accrual, pure");

t("two qualifying locks share the slice pool by weight; credits sum to the slice; the last slice of the day carries the remainder", () => {
  const P = mkProject();
  const st = { ...mkState(P, { poolDailyRaw: "2400000000007" }), armed: true, startedAt: NOW - 20 * DAY };   // not divisible by 24 on purpose
  const locks = [normalized(escrow(1, { recipient: W.A, amount: TOKENS(100) })), normalized(escrow(2, { recipient: W.B, amount: TOKENS(300) }))];
  const r = eng.accrueSlice({ project: P, state: st, days: {}, locks, ledgerKnown: 2, nowUnix: NOW });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.key, "2026-09-17T12");
  const sum = Object.values(r.row.credits).reduce((a, v) => a + BigInt(v), 0n) + BigInt(r.row.undistributedRaw);
  assert.strictEqual(sum.toString(), r.row.poolRaw, "every base unit of the slice is accounted for");
  assert.strictEqual(r.row.poolRaw, prog.slicePoolRaw("2400000000007", 12).toString());
  assert.ok(BigInt(r.row.credits[W.B]) > BigInt(r.row.credits[W.A]), "the bigger lock earns more");
  assert.strictEqual(r.row.eligible, 2);
  assert.strictEqual(r.row.programVersion, 1);
  const last = eng.accrueSlice({ project: P, state: st, days: {}, locks, ledgerKnown: 2, nowUnix: NOW + 11 * 3600 });   // slice 23
  assert.strictEqual(last.row.poolRaw, prog.slicePoolRaw("2400000000007", 23).toString());
  const daily = BigInt(prog.slicePoolRaw("2400000000007", 23)) + 23n * BigInt(prog.slicePoolRaw("2400000000007", 0));
  assert.strictEqual(daily.toString(), "2400000000007", "24 slices sum to exactly the daily pool");
});

t("the pool: a fixed daily pool with no vesting stream is honoured as-is; with a funder stream it is capped at maxSharePct of the stream (the CUNA guarantee)", () => {
  const P = mkProject();
  const st = { ...mkState(P, { poolDailyRaw: TOKENS(2400), maxSharePct: 25 }), armed: true, startedAt: NOW - 20 * DAY };
  const holder = normalized(escrow(1, { recipient: W.A, amount: TOKENS(100) }));
  const noStream = eng.accrueSlice({ project: P, state: st, days: {}, locks: [holder], ledgerKnown: 1, nowUnix: NOW });
  assert.strictEqual(noStream.row.dailyUnlockRaw, "0");
  assert.strictEqual(noStream.row.dailyPoolRaw, TOKENS(2400), "no stream to cap against: the fixed pool stands; funding status is the guard");
  // A funder lock past its cliff, releasing 100 tokens a day: the stream is 100/day, so the pool
  // is capped at 25 of it — not the 2,400 the fixed number asks for.
  const funder = normalized(escrow(9, { recipient: W.FUND, creator: W.FUND, amount: "0", cliffDays: -10, periods: 100, perPeriod: TOKENS(100), freqDays: 1 }), NOW - 60 * DAY);
  const capped = eng.accrueSlice({ project: P, state: st, days: {}, locks: [holder, funder], ledgerKnown: 2, nowUnix: NOW });
  assert.strictEqual(capped.row.dailyUnlockRaw, TOKENS(100));
  assert.strictEqual(capped.row.dailyPoolRaw, TOKENS(25), "capped by the stream, the CUNA rule");
  assert.strictEqual(capped.row.eligible, 1, "the funder never earns from its own stream (Rule B)");
});

t("refuses: disarmed, before start, already accrued, no version in force, implausible scan", () => {
  const P = mkProject();
  const locks = [normalized(escrow(1))];
  const armed = { ...mkState(P), armed: true, startedAt: NOW - DAY };
  assert.ok(/not armed/.test(eng.accrueSlice({ project: P, state: { ...armed, armed: false }, days: {}, locks, nowUnix: NOW }).reason));
  assert.ok(/before the programme start/.test(eng.accrueSlice({ project: P, state: { ...armed, startedAt: NOW + DAY }, days: {}, locks, nowUnix: NOW }).reason));
  assert.ok(/already accrued/.test(eng.accrueSlice({ project: P, state: armed, days: { "2026-09-17T12": {} }, locks, nowUnix: NOW }).reason));
  assert.ok(/no program version/.test(eng.accrueSlice({ project: P, state: { ...armed, versions: [] }, days: {}, locks, nowUnix: NOW }).reason));
  assert.ok(/zero escrows but the ledger knows 3/.test(eng.accrueSlice({ project: P, state: armed, days: {}, locks: [], ledgerKnown: 3, nowUnix: NOW }).reason));
  assert.ok(/index lag/.test(eng.accrueSlice({ project: P, state: armed, days: {}, locks: [locks[0], locks[0], locks[0]], ledgerKnown: 12, nowUnix: NOW }).reason));
});

t("an empty first scan (nothing locked yet, empty ledger) writes a zero row instead of a missed hour", () => {
  const P = mkProject();
  const armed = { ...mkState(P), armed: true, startedAt: NOW - DAY };
  const r = eng.accrueSlice({ project: P, state: armed, days: {}, locks: [], ledgerKnown: 0, nowUnix: NOW });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.row.eligible, 0); assert.strictEqual(r.row.distributedRaw, "0"); assert.strictEqual(r.row.scanned, 0);
});

t("missedSlices lists the hours since arming that never ran, oldest first", () => {
  const P = mkProject();
  const armed = { ...mkState(P), armed: true, startedAt: NOW - 3 * 3600 - 60 };   // armed at 08:59 — the arm hour itself counts
  const days = { "2026-09-17T10": {} };
  assert.deepStrictEqual(eng.missedSlices({ state: armed, days, nowUnix: NOW }), ["2026-09-17T08", "2026-09-17T09", "2026-09-17T11"]);
  assert.deepStrictEqual(eng.missedSlices({ state: { ...armed, startedAt: null }, days, nowUnix: NOW }), []);
});

section("4. the tick over a store — the project's keys, never CUNA's");

t("accrualTick writes days and the firstSeenAt ledger under program:<id>:*, credits the hour, and is a no-op on the second tick of the same hour", async () => {
  eng.resetCaches();
  const kv = store.memoryKv();
  const P = mkProject("rose");
  const registry = { rose: P };
  store.writeRegistry(kv, registry);
  // The programme started 30 days ago; the locks were made 15 days ago — INSIDE the programme (a
  // lock indexed before the start is disqualified, the CUNA rule) and inside the 30-day backdate cap.
  store.write(kv, "rose", "state", { ...mkState(P), armed: true, startedAt: NOW - 30 * DAY });
  const scanned = [escrow(1, { recipient: W.A, amount: TOKENS(100) }), escrow(2, { recipient: W.B, amount: TOKENS(300) })];
  const created = Object.fromEntries(scanned.map((e) => [e.escrow, NOW - 15 * DAY]));   // both made 15 days ago
  const r1 = await eng.accrualTick({ kv, projectId: "rose", project: P, nowUnix: NOW, deps: depsFor(scanned, created) });
  assert.ok(r1.ok, r1.reason);
  assert.strictEqual(r1.key, "2026-09-17T12"); assert.strictEqual(r1.eligible, 2);
  const days = store.read(kv, "rose", "days", {});
  assert.ok(days["2026-09-17T12"] && BigInt(days["2026-09-17T12"].distributedRaw) > 0n);
  const ledger = store.read(kv, "rose", "ledger", {});
  assert.strictEqual(Object.keys(ledger).length, 2);
  assert.strictEqual(ledger[scanned[0].escrow].firstSeenAt, NOW - 15 * DAY, "backdated to its on-chain creation");
  const dump = kv.dump();
  assert.ok(Object.keys(dump).every((k) => !/^cunaStake/.test(k)), "nothing under CUNA's legacy keys");
  const r2 = await eng.accrualTick({ kv, projectId: "rose", project: P, nowUnix: NOW + 60, deps: depsFor(scanned, created) });
  assert.strictEqual(r2.ok, false); assert.ok(/already accrued/.test(r2.reason));
  assert.strictEqual(Object.keys(store.read(kv, "rose", "days", {})).length, 1);
  const r3 = await eng.accrualTick({ kv, projectId: "rose", project: P, nowUnix: NOW + 3600, deps: depsFor(scanned, created) });
  assert.ok(r3.ok); assert.strictEqual(Object.keys(store.read(kv, "rose", "days", {})).length, 2);
});

t("a failed chain read skips the hour and writes nothing; a disarmed project never writes its ledger", async () => {
  eng.resetCaches();
  const kv = store.memoryKv();
  const P = mkProject("rose");
  store.write(kv, "rose", "state", { ...mkState(P), armed: true, startedAt: NOW - DAY });
  const r = await eng.accrualTick({ kv, projectId: "rose", project: P, nowUnix: NOW, deps: { scan: async () => { throw new Error("rpc down"); } } });
  assert.strictEqual(r.ok, false); assert.ok(/chain read failed: rpc down/.test(r.reason));
  assert.deepStrictEqual(store.read(kv, "rose", "days", {}), {});
  eng.resetCaches();
  const kv2 = store.memoryKv();
  store.write(kv2, "rose", "state", { ...mkState(P), armed: false });
  const snap = await eng.scanLocks({ kv: kv2, projectId: "rose", project: P, state: store.read(kv2, "rose", "state", {}), nowUnix: NOW, force: true, deps: depsFor([escrow(1)]) });
  assert.strictEqual(snap.locks.length, 1);
  assert.deepStrictEqual(store.read(kv2, "rose", "ledger", {}), {}, "disarmed: the chain is read, the ledger is not written");
});

t("a days write that does not persist is refused and reported, never counted", async () => {
  eng.resetCaches();
  const kv = store.memoryKv();
  kv.setVerified = () => false;                       // a broken volume
  const P = mkProject("rose");
  store.write(kv, "rose", "state", { ...mkState(P), armed: true, startedAt: NOW - DAY });
  const alerts = [];
  const r = await eng.accrualTick({ kv, projectId: "rose", project: P, nowUnix: NOW, deps: depsFor([escrow(1)], { [escrow(1).escrow]: NOW - 15 * DAY }), onAlert: (m) => alerts.push(m) });
  assert.strictEqual(r.ok, false); assert.ok(/did not persist/.test(r.reason));
  assert.ok(alerts.some((m) => /did NOT reach the volume/.test(m)));
});

t("runAll ticks every armed project in the registry and skips the ones a legacy loop owns", async () => {
  eng.resetCaches();
  const kv = store.memoryKv();
  const R = mkProject("rose"), C = mkProject("cuna", { mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", label: "CUNA", symbol: "CUNA" });
  store.writeRegistry(kv, { rose: R, cuna: C });
  store.write(kv, "rose", "state", { ...mkState(R), armed: true, startedAt: NOW - DAY });
  store.write(kv, "cuna", "state", { ...mkState(C), armed: true, startedAt: NOW - DAY });
  const out = await eng.runAll({ kv, nowUnix: NOW, deps: depsFor([escrow(1)], { [escrow(1).escrow]: NOW - 15 * DAY }) });
  assert.ok(out.rose && out.rose.ok, JSON.stringify(out));
  assert.strictEqual(out.cuna, undefined, "cuna is skipped while the legacy loop owns it");
  assert.deepStrictEqual(store.read(kv, "cuna", "days", {}), {});
});

section("5. what one holder sees");

t("walletView: locked / how long / earned / paid with signatures / owed", () => {
  const P = mkProject();
  const st = { ...mkState(P), armed: true, startedAt: NOW - 10 * DAY };
  const locks = [normalized(escrow(1, { recipient: W.A, amount: TOKENS(100), cliffDays: 200 }), NOW - 10 * DAY), normalized(escrow(2, { recipient: W.B }), NOW - 10 * DAY)];
  const days = { "2026-09-16T10": { credits: { [W.A]: TOKENS(4), [W.B]: TOKENS(6) } }, "2026-09-16T11": { credits: { [W.A]: TOKENS(4) } } };
  const SIG = "3" + "z".repeat(70);
  const batches = { cb_1: { id: "cb_1", state: "sent", at: NOW - DAY, amounts: { [W.A]: TOKENS(5) }, sent: { [W.A]: { sig: SIG, at: NOW - DAY } } } };
  const v = eng.walletView({ project: P, state: st, addr: W.A, locks, days, paid: { [W.A]: TOKENS(5) }, batches, nowUnix: NOW });
  assert.ok(v.ok);
  assert.strictEqual(v.locks.length, 1);
  assert.strictEqual(v.locks[0].earning, true);
  assert.strictEqual(v.locks[0].daysLeft, 200);
  assert.strictEqual(v.accruedRaw, TOKENS(8)); assert.strictEqual(v.paidRaw, TOKENS(5)); assert.strictEqual(v.owedRaw, TOKENS(3));
  assert.strictEqual(v.payouts.length, 1); assert.strictEqual(v.payouts[0].sig, SIG); assert.strictEqual(v.payouts[0].confirmed, true);
  assert.strictEqual(v.programVersion, 1);
  assert.strictEqual(eng.walletView({ project: P, state: st, addr: "nope", locks, days, paid: {}, batches: {}, nowUnix: NOW }).ok, false);
  const stranger = eng.walletView({ project: P, state: st, addr: W.FUND, locks, days, paid: {}, batches: {}, nowUnix: NOW });
  assert.strictEqual(stranger.locks.length, 0); assert.strictEqual(stranger.accruedRaw, "0"); assert.strictEqual(stranger.payouts.length, 0);
});

section("6. the routes' pure helpers (lib/hub/routes.js)");

t("mintInfoFromParsed reads decimals, the token program and Token-2022 extensions from a parsed mint account; refuses anything else", () => {
  const routes = require("../lib/hub/routes");
  const v = { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: { parsed: { type: "mint", info: { decimals: 6, extensions: [{ extension: "transferFeeConfig", state: {} }, { extension: "metadataPointer" }] } } } };
  assert.deepStrictEqual(routes.mintInfoFromParsed(v), { decimals: 6, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", extensions: ["transferFeeConfig", "metadataPointer"] });
  assert.throws(() => proj.validateProject({ id: "fee", label: "Fee", symbol: "FEE", mint: W.MINT, fundingWallet: W.FUND, operatorWallets: [] }, routes.mintInfoFromParsed(v)), /transferFeeConfig/);
  assert.deepStrictEqual(routes.mintInfoFromParsed({ owner: TOK, data: { parsed: { type: "mint", info: { decimals: 9 } } } }), { decimals: 9, tokenProgram: TOK, extensions: [] });
  assert.throws(() => routes.mintInfoFromParsed({ owner: TOK, data: { parsed: { type: "account", info: {} } } }), /did not parse as a mint/);
  assert.throws(() => routes.mintInfoFromParsed(null), /did not parse as a mint/);
});

t("defaultEffectiveFrom: the first version starts today, an edit starts tomorrow; termsPatchFromQuery parses lists and the boolean", () => {
  const routes = require("../lib/hub/routes");
  const P = mkProject();
  assert.strictEqual(routes.defaultEffectiveFrom({}, NOW), "2026-09-17");
  assert.strictEqual(routes.defaultEffectiveFrom(mkState(P), NOW), "2026-09-18");
  const patch = routes.termsPatchFromQuery({ poolDailyRaw: "5", vesting: "cliff-only", cancelableAllowed: "1", fundedBy: `${W.FUND}, ${W.OP}`, excludeWallets: [W.A], ignored: "x", minLockRaw: "" });
  assert.deepStrictEqual(patch, { poolDailyRaw: "5", vesting: "cliff-only", cancelableAllowed: true, fundedBy: [W.FUND, W.OP], excludeWallets: [W.A] });
  assert.strictEqual(routes.termsPatchFromQuery({ cancelableAllowed: "0" }).cancelableAllowed, false);
  // An edit merges over the version in force and creates the next version with a new hash.
  const s1 = mkState(P);
  const merged = { ...s1.versions[0].terms, ...routes.termsPatchFromQuery({ payoutSchedule: "monthly" }) };
  const s2 = proj.createVersion(s1, P, merged, { effectiveFrom: routes.defaultEffectiveFrom(s1, NOW), todayKey: "2026-09-17" });
  assert.strictEqual(s2.versions.length, 2);
  assert.strictEqual(s2.versions[1].terms.payoutSchedule, "monthly");
  assert.strictEqual(s2.versions[1].terms.minLockRaw, s1.versions[0].terms.minLockRaw, "untouched fields carry over");
});

t("publicProject never carries anything but the public record", () => {
  const routes = require("../lib/hub/routes");
  const p = { ...mkProject(), status: "approved", approvedAt: 1, secretNote: "x", rewardMintInfo: { decimals: 9 } };
  const out = routes.publicProject(p);
  assert.ok(!("secretNote" in out) && !("rewardMintInfo" in out));
  assert.strictEqual(out.id, "rose"); assert.strictEqual(out.status, "approved");
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e && e.message)); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
