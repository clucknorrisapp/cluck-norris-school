"use strict";
// Project Hub — W1 pure gate. Each section is one acceptance test from
// docs/DESIGN_PROJECT_HUB_2026-09-10.md §7 as restated by Addendum B. Zero-dependency: runs in the
// CI node-check job without npm install.
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const elig = require("../lib/hub/eligibility");
const L = require("../lib/hub/ledger");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8", C: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");   // base58-safe, unique per n < 23
const NOW = 1_800_000_000;
const mkProject = (id, mint, over = {}) => proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, { decimals: over.decimals == null ? 9 : over.decimals, tokenProgram: TOK, extensions: [] });
const mkState = (project, day = "2026-09-17") => proj.createVersion({}, project, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: day, todayKey: day });
const days = (credits) => ({ "2026-09-17T00": { credits } });

section("1. isolation — five cases (§3)");

t("store refuses a missing or default project id", () => {
  const kv = store.memoryKv();
  assert.throws(() => store.read(kv, undefined, "days", {}), /projectId is required/);
  assert.throws(() => store.read(kv, "", "days", {}), /projectId is required/);
  assert.throws(() => store.write(kv, "clkn!", "days", {}), /projectId is required/);
});

t("two projects with the same escrow set never share a ledger; cuna aliases the seven legacy keys", () => {
  const kv = store.memoryKv();
  store.write(kv, "alpha", "ledger", { E1: { firstSeenAt: 1 } });
  store.write(kv, "beta", "ledger", { E1: { firstSeenAt: 2 } });
  assert.strictEqual(store.read(kv, "alpha", "ledger").E1.firstSeenAt, 1);
  assert.strictEqual(store.read(kv, "beta", "ledger").E1.firstSeenAt, 2);
  assert.strictEqual(store.keyFor("cuna", "days"), "cunaStakeDays");
  assert.strictEqual(store.keyFor("rose", "days"), "program:rose:days");
});

t("identical wallets in two projects accrue independently", () => {
  const journal = {};
  const pa = L.partition({ projectId: "alpha", days: days({ [W.A]: "100" }), batches: {}, journal });
  const pb = L.partition({ projectId: "beta", days: days({ [W.A]: "7" }), batches: {}, journal });
  assert.strictEqual(pa[W.A].accruedRaw, "100");
  assert.strictEqual(pb[W.A].accruedRaw, "7");
});

t("a batch id from project A is refused by project B's settle; a receipt for A is not served under B", () => {
  const A = mkProject("alpha", W.MINT1); const sA = mkState(A);
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "100" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: sA.versions[0], periods: ["2026-09-17T00"], part, batchId: "b1", nowUnix: NOW });
  const r = L.settle({ journal: {}, projectId: "beta", batch, wallet: W.A, transfer: { sig: SIG(1), instructionIndex: 0, amountRaw: "100", slot: 1 }, nowUnix: NOW });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, "batch_not_in_project");
  assert.strictEqual(L.receipt({ projectId: "beta", batch, wallet: W.A, journal: {} }), null);
});

t("a mint registered twice is refused", () => {
  const A = mkProject("alpha", W.MINT1), B = mkProject("beta", W.MINT1);
  const reg = proj.approveProject({}, A, { nowUnix: NOW });
  assert.throws(() => proj.approveProject(reg, B, { nowUnix: NOW }), /already registered as project "alpha"/);
});

section("2. decimals");

t("decimals come from the mint read, never typed; 6- and 9-decimal projects carry their own", () => {
  const six = mkProject("six", W.MINT1, { decimals: 6 }), nine = mkProject("nine", W.MINT2, { decimals: 9 });
  assert.strictEqual(six.decimals, 6); assert.strictEqual(nine.decimals, 9);
  assert.strictEqual(six.rewardDecimals, 6);
  assert.throws(() => proj.validateProject({ id: "xx", label: "X", symbol: "X", mint: W.MINT1, fundingWallet: W.FUND }, { decimals: "9", tokenProgram: TOK }), /decimals must come from the mint/);
});

t("a Token-2022 mint with a transfer-fee or transfer-hook extension is refused at approval with the reason", () => {
  assert.throws(() => proj.validateProject({ id: "fee", label: "Fee", symbol: "FEE", mint: W.MINT1, fundingWallet: W.FUND }, { decimals: 9, tokenProgram: T22, extensions: ["transferFeeConfig"] }), /transferFeeConfig/);
  assert.throws(() => proj.validateProject({ id: "hook", label: "Hook", symbol: "HOOK", mint: W.MINT1, fundingWallet: W.FUND }, { decimals: 9, tokenProgram: T22, extensions: ["transferHook"] }), /transferHook/);
  const ok = proj.validateProject({ id: "plain22", label: "P", symbol: "P22", mint: W.MINT1, fundingWallet: W.FUND }, { decimals: 9, tokenProgram: T22, extensions: ["metadataPointer"] });
  assert.strictEqual(ok.tokenProgram, T22);
});

section("2b. terms: payout cadence and vesting shape (owner, 2026-09-16: weekly / monthly / at the end of a lock; vesting vs no vesting)");

t("cadence defaults to weekly and accepts daily, monthly, at-unlock and manual; anything else is refused", () => {
  const A = mkProject("alpha", W.MINT1);
  const base = { poolDailyRaw: "1000", fundedBy: [W.FUND] };
  assert.strictEqual(proj.validateTerms(base, A).payoutSchedule, "weekly");
  for (const s of ["daily", "weekly", "monthly", "at-unlock", "manual"]) assert.strictEqual(proj.validateTerms({ ...base, payoutSchedule: s }, A).payoutSchedule, s);
  assert.throws(() => proj.validateTerms({ ...base, payoutSchedule: "yearly" }, A), /payoutSchedule must be/);
  assert.throws(() => proj.validateTerms({ ...base, payoutSchedule: "at_unlock" }, A), /payoutSchedule must be/);
});

t("vesting shape defaults to any and accepts cliff-only / vesting-only; anything else is refused", () => {
  const A = mkProject("alpha", W.MINT1);
  const base = { poolDailyRaw: "1000", fundedBy: [W.FUND] };
  assert.strictEqual(proj.validateTerms(base, A).vesting, "any");
  assert.strictEqual(proj.validateTerms({ ...base, vesting: "cliff-only" }, A).vesting, "cliff-only");
  assert.strictEqual(proj.validateTerms({ ...base, vesting: "vesting-only" }, A).vesting, "vesting-only");
  assert.throws(() => proj.validateTerms({ ...base, vesting: "sometimes" }, A), /vesting must be/);
});

t("cadence and vesting shape are part of the hashed terms — changing either is a new version with a new hash", () => {
  const A = mkProject("alpha", W.MINT1);
  const s1 = proj.createVersion({}, A, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const s2 = proj.createVersion(s1, A, { poolDailyRaw: "1000", fundedBy: [W.FUND], payoutSchedule: "monthly" }, { effectiveFrom: "2026-09-20", todayKey: "2026-09-18" });
  const s3 = proj.createVersion(s2, A, { poolDailyRaw: "1000", fundedBy: [W.FUND], payoutSchedule: "monthly", vesting: "cliff-only" }, { effectiveFrom: "2026-09-25", todayKey: "2026-09-21" });
  const h = s3.versions.map((v) => v.hash);
  assert.strictEqual(new Set(h).size, 3);
  assert.strictEqual(s3.versions[1].terms.payoutSchedule, "monthly");
  assert.strictEqual(s3.versions[2].terms.vesting, "cliff-only");
  assert.ok(s3.versions.every((v) => proj.verifyVersionHash(v)));
});

section("3. program versioning");

t("editing terms creates v2 with a new hash; v1 keeps its hash and gains effectiveTo; periods under v1 keep v1", () => {
  const A = mkProject("alpha", W.MINT1);
  const s1 = mkState(A, "2026-09-17");
  const v1 = s1.versions[0];
  assert.strictEqual(v1.version, 1); assert.strictEqual(v1.effectiveTo, null); assert.ok(proj.verifyVersionHash(v1));
  const s2 = proj.createVersion(s1, A, { poolDailyRaw: "2000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-20", todayKey: "2026-09-18" });
  assert.strictEqual(s2.versions.length, 2);
  assert.notStrictEqual(s2.versions[1].hash, v1.hash);
  assert.strictEqual(s2.versions[0].hash, v1.hash);
  assert.strictEqual(s2.versions[0].effectiveTo, "2026-09-20");
  assert.strictEqual(proj.versionFor(s2, "2026-09-19T23").version, 1);
  assert.strictEqual(proj.versionFor(s2, "2026-09-20T00").version, 2);
  assert.strictEqual(proj.versionFor(s2, "2026-09-16"), null);
});

t("a version cannot start in the past or before the current version; the record is byte-stable", () => {
  const A = mkProject("alpha", W.MINT1);
  const s1 = mkState(A, "2026-09-17");
  assert.throws(() => proj.createVersion(s1, A, {}, { effectiveFrom: "2026-09-10", todayKey: "2026-09-18" }), /in the past/);
  assert.throws(() => proj.createVersion(s1, A, {}, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" }), /must be after v1/);
  const again = mkState(A, "2026-09-17").versions[0];
  assert.strictEqual(again.hash, s1.versions[0].hash);
  assert.strictEqual(proj.canonicalJson({ b: 1n, a: [{ z: 1, y: 2 }] }), '{"a":[{"y":2,"z":1}],"b":"1"}');
});

t("Rule B per project: the funding wallet and every funder are always excluded; a tampered hash fails verification", () => {
  const A = mkProject("alpha", W.MINT1);
  const v = mkState(A).versions[0];
  assert.ok(v.terms.excludeWallets.includes(W.FUND));
  assert.ok(!proj.verifyVersionHash({ ...v, terms: { ...v.terms, poolDailyRaw: "999999" } }));
});

section("4. eligibility reasons — every disqualify() branch has a code");

const lock = (over = {}) => ({ escrow: "E1", mint: W.MINT1, recipient: W.A, creator: W.A, cancelMode: 0, cancelledAt: 0, firstSeenAt: NOW - 10, cliffTime: NOW + 200 * 86400, frequency: 86400, periods: 1, totalRaw: "1000000000000000", cliffUnlockRaw: "0", perPeriodRaw: "1000000000000000", atRiskRaw: "1000000000000000", ...over });
const cfg = { mint: W.MINT1, startAfterUnix: NOW - 100, minDurationDays: 90, minLockRaw: "69000000000000", excludeWallets: [W.B] };

t("a qualifying lock has no reasons and carries the deciding numbers", () => {
  const r = elig.eligibilityRecord(lock(), cfg, NOW);
  assert.strictEqual(r.qualifies, true); assert.deepStrictEqual(r.reasons, []);
  assert.strictEqual(r.numbers.minDurationDays, 90); assert.strictEqual(r.numbers.minLockRaw, "69000000000000");
});

t("each branch surfaces its code; none falls to `other`", () => {
  const cases = [
    [lock({ mint: W.MINT2 }), "different_token"],
    [lock({ cancelMode: 1 }), "cancelable"],
    [lock({ cancelledAt: 5 }), "cancelled"],
    [lock({ firstSeenAt: 0 }), "not_indexed"],
    [lock({ firstSeenAt: NOW - 1000 }), "seen_before_program"],
    [lock({ cliffTime: 0 }), "no_schedule"],
    [lock({ cliffTime: NOW + 10 * 86400 }), "term_too_short"],
    [lock({ atRiskRaw: "0" }), "nothing_locked"],
    [lock({ atRiskRaw: "5" }), "below_min_lock"],
    [lock({ recipient: "" }), "no_recipient"],
    [lock({ recipient: W.B }), "excluded_recipient"],
    [lock({ creator: W.B }), "excluded_creator"],
  ];
  for (const [l, code] of cases) {
    const r = elig.eligibilityRecord(l, cfg, NOW);
    assert.ok(r.reasons.some((x) => x.code === code), `expected ${code}, got ${JSON.stringify(r.reasons)}`);
    assert.ok(!r.reasons.some((x) => x.code === "other"), `an uncoded reason leaked: ${JSON.stringify(r.reasons)}`);
  }
  assert.strictEqual(elig.eligibilityRecord(null, cfg, NOW).reasons[0].code, "not_a_lock");
});

section("5. balance states — the partition (Addendum B2)");

const A = mkProject("alpha", W.MINT1); const SA = mkState(A); const V1 = SA.versions[0];
const xfer = (n, amountRaw, over = {}) => ({ sig: SIG(n), instructionIndex: 0, amountRaw, slot: 100 + n, ...over });
const holds = (part) => assert.deepStrictEqual(L.checkInvariant(part), []);

t("accrue → reserve → settle in full: partition holds at every step", () => {
  const d = days({ [W.A]: "100", [W.B]: "50" });
  let journal = {};
  let part = L.partition({ projectId: "alpha", days: d, batches: {}, journal }); holds(part);
  assert.strictEqual(part[W.A].availableRaw, "100");
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: ["2026-09-17T00"], part, batchId: "b1", nowUnix: NOW });
  assert.deepStrictEqual(b.amounts, { [W.B]: "50", [W.A]: "100" });
  let batches = { b1: b };
  part = L.partition({ projectId: "alpha", days: d, batches, journal }); holds(part);
  assert.strictEqual(part[W.A].reservedRaw, "100"); assert.strictEqual(part[W.A].availableRaw, "0");
  const s = L.settle({ journal, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(1, "100"), nowUnix: NOW });
  assert.ok(s.ok); journal = s.journal;
  part = L.partition({ projectId: "alpha", days: d, batches, journal }); holds(part);
  assert.strictEqual(part[W.A].paidAppliedRaw, "100"); assert.strictEqual(part[W.A].reservedRaw, "0"); assert.strictEqual(part[W.A].availableRaw, "0");
  assert.strictEqual(L.batchView(b, journal).rows[W.A].state, "paid");
  assert.strictEqual(L.batchView(b, journal).state, "pending");   // B still unpaid
});

t("overpayment: accrued 100, a verified 110 → applied 100, excess 10, available 0, obligations 0; the next 10 of accrual clears the excess", () => {
  const d = days({ [W.A]: "100" });
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: part0, batchId: "b2", nowUnix: NOW });
  const s = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(2, "110"), nowUnix: NOW });
  assert.strictEqual(s.entry.appliedRaw, "100"); assert.strictEqual(s.entry.excessRaw, "10");
  let part = L.partition({ projectId: "alpha", days: d, batches: { b2: b }, journal: s.journal }); holds(part);
  assert.strictEqual(part[W.A].paidTotalRaw, "110"); assert.strictEqual(part[W.A].paidAppliedRaw, "100");
  assert.strictEqual(part[W.A].excessRaw, "10"); assert.strictEqual(part[W.A].availableRaw, "0"); assert.strictEqual(part[W.A].obligationRaw, "0");
  const d2 = { ...d, "2026-09-18T00": { credits: { [W.A]: "10" } } };
  part = L.partition({ projectId: "alpha", days: d2, batches: { b2: b }, journal: s.journal }); holds(part);
  assert.strictEqual(part[W.A].paidAppliedRaw, "110"); assert.strictEqual(part[W.A].excessRaw, "0"); assert.strictEqual(part[W.A].availableRaw, "0");
});

t("a second wallet with accrued 100 and paid 90 keeps obligations 10 regardless of the first wallet's excess", () => {
  const d = days({ [W.A]: "100", [W.B]: "100" });
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: part0, batchId: "b3", nowUnix: NOW });
  let j = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(3, "150"), nowUnix: NOW }).journal;
  j = L.settle({ journal: j, projectId: "alpha", batch: b, wallet: W.B, transfer: xfer(4, "90"), nowUnix: NOW }).journal;
  const part = L.partition({ projectId: "alpha", days: d, batches: { b3: b }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].excessRaw, "50"); assert.strictEqual(part[W.A].obligationRaw, "0");
  assert.strictEqual(part[W.B].obligationRaw, "10"); assert.strictEqual(part[W.B].reservedRaw, "10"); assert.strictEqual(part[W.B].availableRaw, "0");
  const f = L.fundingStatus({ part, batches: { b3: b }, journal: j, projectId: "alpha", observed: null });
  assert.strictEqual(f.obligationsRaw, "10");
});

t("partial: a 100 row receives 40 → 60 stays reserved on that row, nothing returns to available; then 40 → 20; paid never exceeds accrued", () => {
  const d = days({ [W.A]: "100" });
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: part0, batchId: "b4", nowUnix: NOW });
  let j = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(5, "40"), nowUnix: NOW }).journal;
  let v = L.batchView(b, j); assert.strictEqual(v.rows[W.A].state, "partial"); assert.strictEqual(v.rows[W.A].remainingRaw, "60");
  let part = L.partition({ projectId: "alpha", days: d, batches: { b4: b }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].reservedRaw, "60"); assert.strictEqual(part[W.A].availableRaw, "0"); assert.strictEqual(part[W.A].paidAppliedRaw, "40");
  j = L.settle({ journal: j, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(6, "40"), nowUnix: NOW + 1 }).journal;
  v = L.batchView(b, j); assert.strictEqual(v.rows[W.A].remainingRaw, "20");
  part = L.partition({ projectId: "alpha", days: d, batches: { b4: b }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].reservedRaw, "20"); assert.ok(BigInt(part[W.A].paidAppliedRaw) <= BigInt(part[W.A].accruedRaw));
  // cancelling now keeps the partial remainder reserved (closed, not cancelled)
  const closed = L.cancelBatch({ batch: b, journal: j });
  assert.strictEqual(closed.state, "closed");
  part = L.partition({ projectId: "alpha", days: d, batches: { b4: closed }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].reservedRaw, "20"); assert.strictEqual(part[W.A].availableRaw, "0");
  // only the owner may waive it, and the waive releases it to available (still owed)
  assert.throws(() => L.waiveRemainder({ batch: closed, journal: j, wallet: W.A, by: "operator", nowUnix: NOW }), /only the owner/);
  const waived = L.waiveRemainder({ batch: closed, journal: j, wallet: W.A, by: "owner", nowUnix: NOW, reason: "test" });
  part = L.partition({ projectId: "alpha", days: d, batches: { b4: waived }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].reservedRaw, "0"); assert.strictEqual(part[W.A].availableRaw, "20");
});

t("a cancelled batch returns its unsent rows to available and its sent rows stay paid", () => {
  const d = days({ [W.A]: "100", [W.B]: "50" });
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: part0, batchId: "b5", nowUnix: NOW });
  const j = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(7, "100"), nowUnix: NOW }).journal;
  const closed = L.cancelBatch({ batch: b, journal: j });
  assert.strictEqual(closed.state, "closed");
  const part = L.partition({ projectId: "alpha", days: d, batches: { b5: closed }, journal: j }); holds(part);
  assert.strictEqual(part[W.A].paidAppliedRaw, "100"); assert.strictEqual(part[W.B].availableRaw, "50"); assert.strictEqual(part[W.B].reservedRaw, "0");
  const b6 = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b6", nowUnix: NOW });
  assert.strictEqual(L.cancelBatch({ batch: b6, journal: {} }).state, "cancelled");
});

t("`estimated` is never a ledger field", () => {
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "1" }), batches: {}, journal: {} });
  assert.ok(!("estimatedRaw" in part[W.A]) && !("estimated" in part[W.A]));
});

section("6. funding — three different fields, never a boolean");

t("obligations, reserved and observed balance are distinct; a failed read is null, never zero; shortfall computed only from an observation", () => {
  const d = days({ [W.A]: "100" });
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: part0, batchId: "b7", nowUnix: NOW });
  const part = L.partition({ projectId: "alpha", days: d, batches: { b7: b }, journal: {} });
  const none = L.fundingStatus({ part, batches: { b7: b }, journal: {}, projectId: "alpha", observed: null });
  assert.strictEqual(none.obligationsRaw, "100"); assert.strictEqual(none.reservedRaw, "100");
  assert.strictEqual(none.observedBalanceRaw, null); assert.strictEqual(none.shortfallRaw, null);
  const some = L.fundingStatus({ part, batches: { b7: b }, journal: {}, projectId: "alpha", observed: { balanceRaw: "30", at: NOW }, sharedWith: ["beta"] });
  assert.strictEqual(some.shortfallRaw, "70"); assert.strictEqual(some.sharedFunding, true);
  assert.ok(!("funded" in some));
});

section("7. receipts (Addendum B3)");

t("40 + 40 + 20: each settlement equals its transfer, Σ applied = totals.applied, entries append-only in order", () => {
  const d = days({ [W.A]: "100" });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: ["2026-09-17T00"], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b8", nowUnix: NOW });
  let j = {};
  for (const [n, amt] of [[8, "40"], [9, "40"], [10, "20"]]) j = L.settle({ journal: j, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(n, amt), nowUnix: NOW + n }).journal;
  const r = L.receipt({ projectId: "alpha", batch: b, wallet: W.A, journal: j, project: A });
  assert.strictEqual(r.settlements.length, 3);
  assert.deepStrictEqual(r.settlements.map((s) => s.amountRaw), ["40", "40", "20"]);
  assert.strictEqual(r.settlements.reduce((a, s) => a + BigInt(s.appliedRaw), 0n).toString(), r.totals.appliedRaw);
  assert.strictEqual(r.totals.owedRaw, "100"); assert.strictEqual(r.totals.remainingRaw, "0"); assert.strictEqual(r.state, "paid");
  assert.strictEqual(r.claims.paymentVerified, true); assert.strictEqual(r.claims.calculationReproducible, null);
  assert.strictEqual(r.programHash, V1.hash);
});

t("a 120 transfer on a 100 row → applied 100, excess 20 on the receipt; an unrecorded row is null (404)", () => {
  const d = days({ [W.A]: "100" });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b9", nowUnix: NOW });
  const j = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(11, "120"), nowUnix: NOW }).journal;
  const r = L.receipt({ projectId: "alpha", batch: b, wallet: W.A, journal: j, project: A });
  assert.strictEqual(r.totals.appliedRaw, "100"); assert.strictEqual(r.totals.excessRaw, "20");
  assert.strictEqual(L.receipt({ projectId: "alpha", batch: b, wallet: W.C, journal: j, project: A }), null);
});

t("a multi-transfer transaction: inner index distinguishes two transfers in one signature", () => {
  const d = days({ [W.A]: "50", [W.B]: "50" });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b10", nowUnix: NOW });
  let j = L.settle({ journal: {}, projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(12, "50", { innerIndex: 0 }), nowUnix: NOW }).journal;
  const s2 = L.settle({ journal: j, projectId: "alpha", batch: b, wallet: W.B, transfer: xfer(12, "50", { innerIndex: 1 }), nowUnix: NOW });
  assert.ok(s2.ok); j = s2.journal;
  assert.strictEqual(Object.keys(j).length, 2);
  assert.strictEqual(L.batchView(b, j).state, "sent");
});

section("B1. one idempotent settlement event — fault injection");

t("crash BEFORE the journal write consumed nothing: the retry re-verifies and writes", () => {
  const kv = store.memoryKv({}, { failOn: (k) => k === store.JOURNAL_KEY });
  const d = days({ [W.A]: "100" });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b11", nowUnix: NOW });
  const s = L.settle({ journal: store.readJournal(kv), projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(13, "100"), nowUnix: NOW });
  assert.throws(() => store.writeJournal(kv, s.journal), /injected fault/);
  assert.deepStrictEqual(store.readJournal(kv), {});
  assert.strictEqual(L.consumedSet(store.readJournal(kv)).size, 0);
  const ok = store.memoryKv(kv.dump());
  const s2 = L.settle({ journal: store.readJournal(ok), projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(13, "100"), nowUnix: NOW });
  store.writeJournal(ok, s2.journal);
  assert.strictEqual(L.consumedSet(store.readJournal(ok)).size, 1);
});

t("crash AFTER the journal write, before any projection: projections are derived, so they converge on the next read; the retry is idempotent", () => {
  const kv = store.memoryKv();
  const d = days({ [W.A]: "100" });
  const b = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "b12", nowUnix: NOW });
  const s = L.settle({ journal: store.readJournal(kv), projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(14, "100"), nowUnix: NOW });
  store.writeJournal(kv, s.journal);
  // "crash" here: no batch/paid projection was ever written. Everything reads from the journal:
  const view = L.batchView(b, store.readJournal(kv));
  assert.strictEqual(view.rows[W.A].state, "paid"); assert.strictEqual(view.state, "sent");
  const retry = L.settle({ journal: store.readJournal(kv), projectId: "alpha", batch: b, wallet: W.A, transfer: xfer(14, "100"), nowUnix: NOW + 5 });
  assert.ok(retry.ok && retry.idempotent); assert.strictEqual(retry.entry.at, NOW);
  assert.strictEqual(Object.keys(retry.journal).length, 1);
});

t("two projects sharing reward mint, funding wallet, recipient and amount: one transfer settles one row; the other is refused naming the owner", () => {
  const B = mkProject("beta", W.MINT2); const SB = mkState(B);
  const d = days({ [W.A]: "100" });
  const ba = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part: L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} }), batchId: "ba", nowUnix: NOW });
  const bb = L.buildBatch({ projectId: "beta", programVersion: SB.versions[0], periods: [], part: L.partition({ projectId: "beta", days: d, batches: {}, journal: {} }), batchId: "bb", nowUnix: NOW });
  const j = L.settle({ journal: {}, projectId: "alpha", batch: ba, wallet: W.A, transfer: xfer(15, "100"), nowUnix: NOW }).journal;
  const r = L.settle({ journal: j, projectId: "beta", batch: bb, wallet: W.A, transfer: xfer(15, "100"), nowUnix: NOW });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, "transfer_already_consumed");
  assert.deepStrictEqual(r.owner, { projectId: "alpha", batchId: "ba", wallet: W.A });
  assert.strictEqual(L.partition({ projectId: "beta", days: d, batches: { bb }, journal: j })[W.A].paidAppliedRaw, "0");
});

t("the xfer key is the chain identity and nothing else; a malformed signature or index is refused", () => {
  assert.strictEqual(L.xferKeyOf({ sig: SIG(1), instructionIndex: 2 }), `settle:${SIG(1)}:2`);
  assert.strictEqual(L.xferKeyOf({ sig: SIG(1), instructionIndex: 2, innerIndex: 3 }), `settle:${SIG(1)}:2:3`);
  assert.throws(() => L.xferKeyOf({ sig: "nope", instructionIndex: 0 }), /transaction signature/);
  assert.throws(() => L.xferKeyOf({ sig: SIG(1) }), /instruction index/);
});

section("10. migration — CUNA reads identically through the hub keys");

t("the cuna alias resolves to the live legacy keys, so the old routes and the hub read one ledger", () => {
  const kv = store.memoryKv({ cunaStakeDays: { "2026-09-14T19": { credits: { [W.A]: "14375000000000" } } }, cunaStakePaid: {}, cunaStakeBatches: {} });
  assert.deepStrictEqual(store.read(kv, "cuna", "days"), kv.get("cunaStakeDays"));
  const part = L.partition({ projectId: "cuna", days: store.read(kv, "cuna", "days", {}), batches: store.read(kv, "cuna", "batches", {}), journal: {} });
  assert.strictEqual(part[W.A].accruedRaw, "14375000000000");
  store.write(kv, "cuna", "batches", { x: 1 });
  assert.deepStrictEqual(kv.get("cunaStakeBatches"), { x: 1 });
});

t("registering cuna in the hub registry is idempotent and refuses a second project on the CUNA mint", () => {
  const cuna = mkProject("cuna", W.MINT1, { fundingWallet: W.B });
  const once = proj.approveProject({}, cuna, { nowUnix: NOW });
  const twice = proj.approveProject(once, cuna, { nowUnix: NOW });
  assert.deepStrictEqual(twice, once);
  assert.throws(() => proj.approveProject(twice, mkProject("cuna2", W.MINT1), { nowUnix: NOW }), /already registered/);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
