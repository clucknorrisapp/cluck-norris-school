"use strict";
// Colosseum W9 part 1 — unit gate for lib/traction.js. Each counter gets a small fixture built the
// same way scripts/hub-core-test.cjs does (lib/hub/store.js memoryKv + lib/hub/project.js), so a
// change to the Hub's real schema breaks this test the same way it would break that one.
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const traction = require("../lib/traction");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT_A = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const MINT_B = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";
const OP1 = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const WALLET_1 = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const NOW = Date.UTC(2026, 8, 17); // 2026-09-17
const dayMs = (s) => Date.parse(s + "T00:00:00Z");

// Approve a project (registry row) with a v1 program version dated `effectiveFrom`, and persist
// its "state" part — the two things hubProgramsCreated/hubProgramVersionsPublished read.
function approve(kv, id, mint, effectiveFrom) {
  let reg = store.readRegistry(kv) || {};
  const draft = proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: FUND, operatorWallets: [OP1] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  reg = proj.approveProject(reg, draft, { nowUnix: Math.floor(NOW / 1000) });
  store.writeRegistry(kv, reg);
  const state = proj.createVersion({}, reg[id], { poolDailyRaw: "1000", fundedBy: [FUND] }, { effectiveFrom, todayKey: effectiveFrom });
  store.write(kv, id, "state", state);
  return reg[id];
}
function addSentRow(kv, projectId, batchId, wallet, sig, atUnix) {
  const batches = store.read(kv, projectId, "batches", {}) || {};
  const b = batches[batchId] || { id: batchId, sent: {} };
  b.sent = { ...(b.sent || {}), [wallet]: { sig, at: atUnix } };
  store.write(kv, projectId, "batches", { ...batches, [batchId]: b });
}
function addAttempt(kv, projectId, batchId, wallet, sig, sigAtUnix, state = "submitted") {
  const batches = store.read(kv, projectId, "batches", {}) || {};
  const b = batches[batchId] || { id: batchId, attempts: {} };
  b.attempts = { ...(b.attempts || {}), [wallet]: { attemptId: "a1", state, sig, sigAt: sigAtUnix } };
  store.write(kv, projectId, "batches", { ...batches, [batchId]: b });
}
function addJournalEntry(kv, key, projectId, atUnix) {
  const j = store.readJournal(kv) || {};
  store.writeJournal(kv, { ...j, [key]: { projectId, at: atUnix } });
}
function addDaySlice(kv, projectId, sliceKey) {
  const days = store.read(kv, projectId, "days", {}) || {};
  store.write(kv, projectId, "days", { ...days, [sliceKey]: { credits: { [WALLET_1]: "1" } } });
}

section("labelFor / the founder / dry-run / independent split");

t("no contributions defaults to independent — the honest floor", () => {
  assert.strictEqual(traction.labelFor([]), "independent");
});
t("only clkn/cuna is founder-operated", () => {
  assert.strictEqual(traction.labelFor(["clkn"]), "founder-operated");
  assert.strictEqual(traction.labelFor(["cuna", "clkn"]), "founder-operated");
});
t("only rose is dry-run", () => {
  assert.strictEqual(traction.labelFor(["rose"]), "dry-run");
});
t("only a registered non-built-in project is independent", () => {
  assert.strictEqual(traction.labelFor(["acme"]), "independent");
});
t("a founder id alongside an independent one is mixed", () => {
  assert.strictEqual(traction.labelFor(["clkn", "acme"]), "mixed");
  assert.strictEqual(traction.labelFor(["rose", "acme"]), "mixed");
});

section("wallets connected — durable, salted, deduped, PII-free");

t("recordWalletConnect dedups the same wallet within a day and counts it once", () => {
  const kv = store.memoryKv();
  traction.recordWalletConnect(kv, { source: "toolpass", wallet: WALLET_1, nowMs: dayMs("2026-09-16") });
  traction.recordWalletConnect(kv, { source: "toolpass", wallet: WALLET_1, nowMs: dayMs("2026-09-16") + 3600e3 });
  const raw = traction.readWalletConnects(kv);
  assert.strictEqual(raw.toolpass["2026-09-16"].length, 1);
});
t("the stored hash is never the raw wallet address, and differs by source", () => {
  const kv = store.memoryKv();
  traction.recordWalletConnect(kv, { source: "toolpass", wallet: WALLET_1, nowMs: dayMs("2026-09-16") });
  traction.recordWalletConnect(kv, { source: "hub-operator", wallet: WALLET_1, nowMs: dayMs("2026-09-16") });
  const raw = traction.readWalletConnects(kv);
  const hA = raw.toolpass["2026-09-16"][0], hB = raw["hub-operator"]["2026-09-16"][0];
  assert.ok(/^[0-9a-f]{24}$/.test(hA), "hash looks like a hex digest, not an address");
  assert.notStrictEqual(hA, WALLET_1);
  assert.notStrictEqual(hA, hB, "the same wallet at two sources must not produce the same hash (source is salted in)");
});
t("compute() counts distinct wallets in-period per source and reports the lifetime denominator", () => {
  const kv = store.memoryKv();
  traction.recordWalletConnect(kv, { source: "toolpass", wallet: "W1", nowMs: dayMs("2026-08-01") }); // outside the period
  traction.recordWalletConnect(kv, { source: "toolpass", wallet: "W2", nowMs: dayMs("2026-09-16") });
  traction.recordWalletConnect(kv, { source: "hub-operator", wallet: "W3", nowMs: dayMs("2026-09-17") });
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.walletsConnected.value, 2);
  assert.strictEqual(out.counters.walletsConnected.denominator, 3);
  assert.deepStrictEqual(out.counters.walletsConnected.bySource, { toolpass: 1, "hub-operator": 1 });
});
t("the per-day bucket is bounded (an abuse guard, not a real cap on legitimate traffic)", () => {
  const kv = store.memoryKv();
  for (let i = 0; i < 5005; i++) traction.recordWalletConnect(kv, { source: "toolpass", wallet: "wallet-" + i, nowMs: dayMs("2026-09-16") });
  const raw = traction.readWalletConnects(kv);
  assert.strictEqual(raw.toolpass["2026-09-16"].length, 5000);
});

section("receipts opened — same durable-event shape, PII-free, dedup per (project, sig, day)");

t("opening the same receipt twice in a day counts once; a different day counts again", () => {
  const kv = store.memoryKv();
  const sig = "5" + "a".repeat(87);
  traction.recordReceiptOpen(kv, { project: "cuna", sig, nowMs: dayMs("2026-09-16") });
  traction.recordReceiptOpen(kv, { project: "cuna", sig, nowMs: dayMs("2026-09-16") + 1000 });
  traction.recordReceiptOpen(kv, { project: "cuna", sig, nowMs: dayMs("2026-09-17") });
  const raw = traction.readReceiptOpens(kv);
  assert.strictEqual(raw["2026-09-16"].cuna.length, 1);
  assert.strictEqual(raw["2026-09-17"].cuna.length, 1);
  assert.ok(!JSON.stringify(raw).includes(sig), "the raw signature must never be stored");
});

section("Hub programs created / versions published — registry-scoped, dated by effectiveFrom");

t("a project's v1 counts as a program created on its effectiveFrom day; a v2 counts as another version", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-15");
  const p = store.readRegistry(kv).acme;
  const state1 = store.read(kv, "acme", "state", {});
  const state2 = proj.createVersion(state1, p, { poolDailyRaw: "2000", fundedBy: [FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-16" });
  store.write(kv, "acme", "state", state2);
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubProgramsCreated.value, 1, "one project created its FIRST version in the window");
  assert.strictEqual(out.counters.hubProgramsCreated.denominator, 1);
  assert.strictEqual(out.counters.hubProgramVersionsPublished.value, 2, "both v1 and v2 fall inside the window");
  assert.strictEqual(out.counters.hubProgramVersionsPublished.denominator, 2);
  assert.strictEqual(out.counters.hubProgramsCreated.label, "independent");
});
t("a program created before the window is not counted, but still in the lifetime denominator", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-08-01");
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubProgramsCreated.value, 0);
  assert.strictEqual(out.counters.hubProgramsCreated.denominator, 1);
});

section("receipts issued — journal vs. the live `batch.sent` mechanism vs. CUNA, kept separate");

t("a settlement-journal entry is counted under hubReceiptsIssuedJournal only", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addJournalEntry(kv, "settle:sig1:0", "acme", Math.floor(dayMs("2026-09-16") / 1000));
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubReceiptsIssuedJournal.value, 1);
  assert.strictEqual(out.counters.hubReceiptsIssuedJournal.label, "independent");
  assert.strictEqual(out.counters.hubReceiptsIssuedSent.value, 0);
});
t("a `batch.sent` row on a registered project counts under hubReceiptsIssuedSent, never cunaReceiptsIssued", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addSentRow(kv, "acme", "b1", WALLET_1, "5" + "b".repeat(87), Math.floor(dayMs("2026-09-16") / 1000));
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubReceiptsIssuedSent.value, 1);
  assert.strictEqual(out.counters.cunaReceiptsIssued.value, 0);
});
t("a `batch.sent` row under the cuna alias counts ONLY under cunaReceiptsIssued, labelled founder-operated", () => {
  const kv = store.memoryKv();
  addSentRow(kv, "cuna", "b1", WALLET_1, "5" + "c".repeat(87), Math.floor(dayMs("2026-09-16") / 1000));
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.cunaReceiptsIssued.value, 1);
  assert.strictEqual(out.counters.cunaReceiptsIssued.label, "founder-operated");
  assert.strictEqual(out.counters.hubReceiptsIssuedSent.value, 0);
  // the cuna alias resolves to the legacy key, exactly like scripts/hub-core-test.cjs section 10
  assert.deepStrictEqual(Object.keys(kv.get("cunaStakeBatches")), ["b1"]);
});
t("hubReceiptsOpened denominator is every receipt issued to date, across all three sources", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addJournalEntry(kv, "settle:sig1:0", "acme", Math.floor(dayMs("2026-09-10") / 1000));
  addSentRow(kv, "acme", "b1", WALLET_1, "5" + "d".repeat(87), Math.floor(dayMs("2026-09-10") / 1000));
  addSentRow(kv, "cuna", "b1", WALLET_1, "5" + "e".repeat(87), Math.floor(dayMs("2026-09-10") / 1000));
  traction.recordReceiptOpen(kv, { project: "acme", sig: "5" + "f".repeat(87), nowMs: dayMs("2026-09-16") });
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubReceiptsOpened.value, 1);
  assert.strictEqual(out.counters.hubReceiptsOpened.denominator, 3);
});

section("hub lesson reads — E6, the school → Hub bridge, same durable-event shape as receipt opens");

t("finishing the same locking lesson twice in a day for the same sid counts once; a different day counts again", () => {
  const kv = store.memoryKv();
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-16") + 1000 });
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-17") });
  const raw = traction.readHubLessonReads(kv);
  assert.strictEqual(raw["2026-09-16"].acme.length, 1);
  assert.strictEqual(raw["2026-09-17"].acme.length, 1);
  assert.ok(!JSON.stringify(raw).includes("sid-1"), "the raw sid must never be stored");
});
t("a different sid the same day is counted separately", () => {
  const kv = store.memoryKv();
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-2", nowMs: dayMs("2026-09-16") });
  const raw = traction.readHubLessonReads(kv);
  assert.strictEqual(raw["2026-09-16"].acme.length, 2);
});
t("compute()'s hubLessonReads counts in-period reads and reports the lifetime total as the denominator", () => {
  const kv = store.memoryKv();
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-2", nowMs: dayMs("2026-09-01") }); // outside the window
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubLessonReads.value, 1);
  assert.strictEqual(out.counters.hubLessonReads.denominator, 2);
  assert.strictEqual(out.counters.hubLessonReads.label, "independent");
});
t("lessonReadsForProject counts only the named project, defaults to the trailing 30 days, and denominator is null when analytics has no bucket for that path", () => {
  const kv = store.memoryKv();
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: Date.now() });
  traction.recordHubLessonRead(kv, { project: "other", sid: "sid-1", nowMs: Date.now() });
  const r = traction.lessonReadsForProject(kv, "acme");
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.denominator, null);
  assert.ok(r.period && r.period.from && r.period.to);
});
t("lessonReadsForProject's denominator is that project's own /hub/<id> page views from the analytics store, never another project's or another path's", () => {
  const kv = store.memoryKv();
  const day = traction.dayKeyOf(dayMs("2026-09-16"));
  kv.set("analytics_v1", { days: { [day]: { paths: { "/hub/acme": 42, "/hub/other": 999, "/hub": 5 } } } });
  traction.recordHubLessonRead(kv, { project: "acme", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  const r = traction.lessonReadsForProject(kv, "acme", { from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.denominator, 42);
});
t("lib/hub/public.js projectView surfaces lessonReads only when count > 0 — never a zero brag", () => {
  const pub = require("../lib/hub/public");
  const p = { id: "acme", label: "ACME", symbol: "ACME", mint: MINT_A };
  const zero = pub.projectView({ project: p, lessonReads: { count: 0, period: { from: "a", to: "b" } } });
  assert.strictEqual(zero.lessonReads, null);
  const none = pub.projectView({ project: p });
  assert.strictEqual(none.lessonReads, null);
  const some = pub.projectView({ project: p, lessonReads: { count: 3, period: { from: "2026-09-14", to: "2026-09-18" }, denominator: 42 } });
  assert.deepStrictEqual(some.lessonReads, { count: 3, period: { from: "2026-09-14", to: "2026-09-18" } });
  assert.ok(!("denominator" in some.lessonReads), "the internal denominator never reaches the public view");
});

section("batches signed — lib/hub/attempts.js's self-sign state machine");

t("a recorded attempt signature in-period is counted; one outside is not", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addAttempt(kv, "acme", "b1", WALLET_1, "5" + "g".repeat(87), Math.floor(dayMs("2026-09-16") / 1000));
  addAttempt(kv, "acme", "b2", OP1, "5" + "h".repeat(87), Math.floor(dayMs("2026-08-01") / 1000));
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubBatchesSigned.value, 1);
  assert.strictEqual(out.counters.hubBatchesSigned.denominator, 2);
});
t("the journal and attempts counters read 0 with a caveat when nothing has used them yet", () => {
  const kv = store.memoryKv();
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubReceiptsIssuedJournal.value, 0);
  assert.strictEqual(out.counters.hubBatchesSigned.value, 0);
  assert.ok(out.caveats.some((c) => /not yet (mounted|wired)/.test(c)));
});

section("repeat operators — activity in two or more distinct ISO weeks");

t("a project active in only one week is not a repeat operator", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addDaySlice(kv, "acme", "2026-09-14T00"); // Mon of one ISO week
  addDaySlice(kv, "acme", "2026-09-15T00"); // Tue, same week
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-20" });
  assert.strictEqual(out.counters.repeatOperators.value, 0);
});
t("a project active across two ISO weeks in the period IS a repeat operator", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-01");
  addDaySlice(kv, "acme", "2026-09-14T00"); // week of Sep 14
  addDaySlice(kv, "acme", "2026-09-21T00"); // the following ISO week
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-25" });
  assert.strictEqual(out.counters.repeatOperators.value, 1);
  assert.deepStrictEqual(out.counters.repeatOperators.label, "independent");
});
t("cuna is never counted as a Hub repeat operator — it predates the onboarding flow", () => {
  const kv = store.memoryKv();
  addDaySlice(kv, "cuna", "2026-09-14T00");
  addDaySlice(kv, "cuna", "2026-09-21T00");
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-25" });
  assert.strictEqual(out.counters.repeatOperators.value, 0);
  assert.strictEqual(out.counters.repeatOperators.denominator, 0);
});

section("revenue — reproducible in lamports/count, never a USD figure that was not stored");

t("tools-pass revenue is derived from the redemption audit record, enumerated by kv.entriesWithPrefix", () => {
  const kv = store.memoryKv();
  kv.set("toolPassPaid:sigA", { wallet: WALLET_1, startAt: dayMs("2026-09-16"), lamports: 50_000_000, days: 7 });
  kv.set("toolPassPaid:sigB", { wallet: WALLET_1, startAt: dayMs("2026-08-01"), lamports: 50_000_000, days: 7 }); // outside period
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.revenueToolsPassCount.value, 1);
  assert.strictEqual(out.counters.revenueToolsPassLamports.value, 50_000_000);
  assert.strictEqual(out.counters.revenueToolsPassCount.denominator, 2);
  assert.strictEqual(out.counters.revenueToolsPassLamports.denominator, 100_000_000);
});
t("a kv with no entriesWithPrefix() reports zero and says so in the caveats, never guesses", () => {
  const barekv = { get: (k, d) => d, set: () => {} };
  const out = traction.compute({ kv: barekv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.revenueToolsPassCount.value, 0);
  assert.ok(out.caveats.some((c) => /entriesWithPrefix/.test(c)));
});
t("hub platform-access SOL and CLKN payments are counted separately, never converted to one figure", () => {
  const kv = store.memoryKv();
  const access = require("../lib/hub/access");
  let reg = store.readRegistry(kv) || {};
  const draft = proj.validateProject({ id: "acme", label: "ACME", symbol: "ACME", mint: MINT_A, fundingWallet: FUND, operatorWallets: [OP1] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  reg = proj.approveProject(reg, draft, { nowUnix: Math.floor(NOW / 1000) });
  reg.acme.access = access.applyPayment(reg.acme.access, { sig: "5" + "i".repeat(87), atUnix: Math.floor(dayMs("2026-09-16") / 1000), kind: "sol", lamports: 500_000_000 });
  reg.acme.access = access.applyPayment(reg.acme.access, { sig: "5" + "j".repeat(87), atUnix: Math.floor(dayMs("2026-09-16") / 1000), kind: "clkn", clknRaw: "123456789000" });
  store.writeRegistry(kv, reg);
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.revenueHubAccessSolLamports.value, 500_000_000);
  assert.strictEqual(out.counters.revenueHubAccessSolCount.value, 1);
  assert.strictEqual(out.counters.revenueHubAccessClknRaw.value, "123456789000");
  assert.strictEqual(out.counters.revenueHubAccessClknCount.value, 1);
  assert.strictEqual(out.counters.revenueHubAccessSolLamports.label, "independent");
});
t("Hatchery revenue is reported as NOT reproducible, never guessed from the lifetime mint set", () => {
  const kv = store.memoryKv({ hatchery_mints_v1: { built: ["m1", "m2", "m3"], announced: [] } });
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.revenueHatchery.value, null);
  assert.strictEqual(out.counters.revenueHatchery.denominator, 3);
  assert.ok(/NOT REPRODUCIBLE/.test(out.counters.revenueHatchery.note));
  assert.ok(out.caveats.some((c) => /not reproducible/.test(c)));
});

section("operator onboarding clock (Colosseum E7) — observed setup time");

function withMilestones(kv, id, milestones) {
  const reg = store.readRegistry(kv) || {};
  store.writeRegistry(kv, { ...reg, [id]: { ...reg[id], milestones } });
}

t("a full apply→approve→version→arm→batch sequence produces all four deltas, in seconds", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-10");
  withMilestones(kv, "acme", {
    appliedAt: dayMs("2026-09-01") / 1000,
    approvedAt: dayMs("2026-09-03") / 1000,
    firstPaidAt: dayMs("2026-09-03") / 1000,
    firstVersionPublishedAt: dayMs("2026-09-05") / 1000,
    firstArmedAt: dayMs("2026-09-08") / 1000,
    firstBatchSignedAt: dayMs("2026-09-15") / 1000,
  });
  const out = traction.compute({ kv, from: "2026-09-01", to: "2026-09-18" });
  const row = out.onboarding.find((o) => o.project === "acme");
  assert.ok(row, "acme appears in onboarding");
  assert.strictEqual(row.deltas.applyToApprove, 2 * 86400);
  assert.strictEqual(row.deltas.approveToFirstVersion, 2 * 86400);
  assert.strictEqual(row.deltas.firstVersionToFirstArm, 3 * 86400);
  assert.strictEqual(row.deltas.firstArmToFirstBatch, 7 * 86400);
  assert.strictEqual(row.label, "independent");
});

t("a missing milestone is null, never a made-up number — a project seeded directly has no appliedAt and no later step either", () => {
  const kv = store.memoryKv();
  approve(kv, "beta", MINT_B, "2026-09-10"); // approve() calls proj.approveProject with no appliedAt and never sets a version milestone
  const out = traction.compute({ kv, from: "2026-09-01", to: "2026-09-18" });
  const row = out.onboarding.find((o) => o.project === "beta");
  assert.ok(row);
  assert.strictEqual(row.deltas.applyToApprove, null, "no appliedAt on a directly-approved project");
  assert.strictEqual(row.deltas.approveToFirstVersion, null, "this fixture never wrote firstVersionPublishedAt");
  assert.strictEqual(row.deltas.firstVersionToFirstArm, null);
  assert.strictEqual(row.deltas.firstArmToFirstBatch, null);
});

t("milestones are set once and never overwritten — proj.setMilestoneOnce keeps the first value even if fed a later one", () => {
  const kv = store.memoryKv();
  approve(kv, "gamma", MINT_A, "2026-09-10");
  const reg = store.readRegistry(kv);
  const m1 = proj.setMilestoneOnce(reg.gamma.milestones, "firstArmedAt", dayMs("2026-09-05") / 1000);
  const m2 = proj.setMilestoneOnce(m1, "firstArmedAt", dayMs("2026-09-12") / 1000);
  assert.strictEqual(m2.firstArmedAt, dayMs("2026-09-05") / 1000, "the first value wins, always");
});

t("CUNA is labelled n/a (pre-window), never a false zero — it predates the Hub's onboarding milestones entirely", () => {
  const kv = store.memoryKv();
  const out = traction.compute({ kv, from: "2026-09-01", to: "2026-09-18" });
  const cuna = out.onboarding.find((o) => o.project === "cuna");
  assert.ok(cuna, "cuna is always reported even with an empty registry — it is not a registry row");
  assert.strictEqual(cuna.label, "n/a (pre-window)");
  assert.deepStrictEqual(cuna.deltas, { applyToApprove: null, approveToFirstVersion: null, firstVersionToFirstArm: null, firstArmToFirstBatch: null });
});

t("a project flagged dryRun:true is excluded from onboarding entirely", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-10");
  const reg = store.readRegistry(kv);
  store.writeRegistry(kv, { ...reg, acme: { ...reg.acme, dryRun: true } });
  const out = traction.compute({ kv, from: "2026-09-01", to: "2026-09-18" });
  assert.ok(!out.onboarding.some((o) => o.project === "acme"), "dryRun:true is excluded");
});

t("with no project record carrying dryRun today, the caveat says the filter excluded nothing (never silently drops a real project)", () => {
  const kv = store.memoryKv();
  approve(kv, "acme", MINT_A, "2026-09-10");
  const out = traction.compute({ kv, from: "2026-09-01", to: "2026-09-18" });
  assert.ok(out.onboarding.some((o) => o.project === "acme"));
  assert.ok(out.caveats.some((c) => /dryRun/.test(c) && /no-op/.test(c)));
});

section("hub door clicks — W9 part 2, the school landing/lesson doors and the homepage door");

t("recordHubDoorClick dedups the same (source, sid) within a day; a different day counts again", () => {
  const kv = store.memoryKv();
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-16") + 1000 });
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-17") });
  const raw = traction.readHubDoorClicks(kv);
  assert.strictEqual(raw["2026-09-16"].school.length, 1);
  assert.strictEqual(raw["2026-09-17"].school.length, 1);
  assert.ok(!JSON.stringify(raw).includes("sid-1"), "the raw sid must never be stored");
});
t("school and home are independent buckets — a click on one source never counts toward the other", () => {
  const kv = store.memoryKv();
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubDoorClick(kv, { source: "home", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  const raw = traction.readHubDoorClicks(kv);
  assert.strictEqual(raw["2026-09-16"].school.length, 1);
  assert.strictEqual(raw["2026-09-16"].home.length, 1);
});
t("recordHubDoorClick is a no-op without a source or a sid", () => {
  const kv = store.memoryKv();
  traction.recordHubDoorClick(kv, { source: "school", nowMs: dayMs("2026-09-16") });
  traction.recordHubDoorClick(kv, { sid: "sid-1", nowMs: dayMs("2026-09-16") });
  assert.deepStrictEqual(traction.readHubDoorClicks(kv), {});
});
t("compute()'s hubDoorClicksSchool counts in-period clicks; denominator is /school's own analytics_v1 page views, null when no bucket exists", () => {
  const kv = store.memoryKv();
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-2", nowMs: dayMs("2026-09-01") }); // outside the window
  const noDenom = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(noDenom.counters.hubDoorClicksSchool.value, 1);
  assert.strictEqual(noDenom.counters.hubDoorClicksSchool.denominator, null);
  const day = traction.dayKeyOf(dayMs("2026-09-16"));
  kv.set("analytics_v1", { days: { [day]: { paths: { "/school": 200, "/": 50 } } } });
  const withDenom = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(withDenom.counters.hubDoorClicksSchool.value, 1);
  assert.strictEqual(withDenom.counters.hubDoorClicksSchool.denominator, 200);
  assert.strictEqual(withDenom.counters.hubDoorClicksSchool.label, "independent");
});
t("compute()'s hubDoorClicksHome reads the \"home\" bucket only, denominator is / page views", () => {
  const kv = store.memoryKv();
  const day = traction.dayKeyOf(dayMs("2026-09-16"));
  kv.set("analytics_v1", { days: { [day]: { paths: { "/school": 200, "/": 50 } } } });
  traction.recordHubDoorClick(kv, { source: "home", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  traction.recordHubDoorClick(kv, { source: "school", sid: "sid-1", nowMs: dayMs("2026-09-16") });
  const out = traction.compute({ kv, from: "2026-09-14", to: "2026-09-18" });
  assert.strictEqual(out.counters.hubDoorClicksHome.value, 1);
  assert.strictEqual(out.counters.hubDoorClicksHome.denominator, 50);
});
t("pageViewsInPeriod is null (never a guessed zero) when analytics_v1 has no bucket for that path", () => {
  const kv = store.memoryKv();
  kv.set("analytics_v1", { days: { [traction.dayKeyOf(dayMs("2026-09-16"))]: { paths: { "/other": 9 } } } });
  assert.strictEqual(traction.pageViewsInPeriod(kv, "/school", "2026-09-14", "2026-09-18"), null);
});

section("compute() itself");

t("refuses a kv with no get()", () => {
  assert.throws(() => traction.compute({ kv: {} }), /needs a kv/);
});
t("defaults to the trailing 30 days when from/to are omitted", () => {
  const kv = store.memoryKv();
  const out = traction.compute({ kv });
  const days = (Date.parse(out.period.to) - Date.parse(out.period.from)) / 86400000;
  assert.strictEqual(days, 30);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
