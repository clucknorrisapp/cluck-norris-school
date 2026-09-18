#!/usr/bin/env node
"use strict";
// Colosseum roadmap E3 / design Addendum B5 — the independent on-chain commitment of a program
// version's hash (lib/hub/commit.js), plus the two places it changes: project.js's
// verifyVersionHash (commitment must never affect a version's own hash, exactly like effectiveTo)
// and public.js's projection (only sig/slot/observedAt ever reach a public body — never the memo
// text). No HTTP server here: routes.js's two new routes are thin wiring over these pure functions
// (the established pattern for this module — see hub-engine-test.cjs "the routes' pure helpers"),
// so the money-relevant logic is fully covered without booting Express; the two routes' existence,
// method discipline and 404 behaviour are pinned in scripts/mutating-get-guard-test.cjs.
const assert = require("assert");
const bs58 = require("bs58");

const commit = require("../lib/hub/commit");
const proj = require("../lib/hub/project");
const pub = require("../lib/hub/public");
const teach = require("../lib/hub/teach");
const demoFixture = require("../lib/hub/demo-fixture");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const W = { FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", MINT: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const mintInfo = { decimals: 9, tokenProgram: TOK, extensions: [] };
const mkProject = (over = {}) => proj.validateProject({ id: "alpha", label: "Alpha", symbol: "ALPHA", mint: W.MINT, fundingWallet: W.FUND, operatorWallets: [W.A], ...over }, mintInfo);
const NOW_UNIX = 1_800_000_000;

section("1. memoText / memoBytes — the exact bytes a hand-built Uint8Array must match");
{
  t("builds the documented format", () => {
    const P = mkProject();
    const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
    const v1 = s1.versions[0];
    const text = commit.memoText("alpha", 1, v1.hash);
    assert.strictEqual(text, `clkn-hub:v1:alpha:1:${v1.hash}`);
  });
  t("memoBytes is byte-identical to a hand-built Uint8Array — CLAUDE.md's diff-before-shipping rule", () => {
    const hash = "a".repeat(64);
    const hand = new Uint8Array(Buffer.from(`clkn-hub:v1:demo-project:7:${hash}`, "utf8"));
    const got = new Uint8Array(commit.memoBytes("demo-project", 7, hash));
    assert.deepStrictEqual(got, hand);
    assert.strictEqual(Buffer.from(got).toString("utf8"), `clkn-hub:v1:demo-project:7:${hash}`);
  });
  t("refuses a malformed projectId, version or hash rather than building a bad memo", () => {
    const hash = "b".repeat(64);
    assert.throws(() => commit.memoText("Not_Valid", 1, hash), /bad projectId/);
    assert.throws(() => commit.memoText("alpha", 0, hash), /bad version/);
    assert.throws(() => commit.memoText("alpha", 1, "not-hex"), /bad hash/);
  });
}

section("2. assertCanCommit — the precondition a build response implies is meaningful");
{
  t("an ordinary approved project may commit", () => {
    assert.doesNotThrow(() => commit.assertCanCommit({ ...mkProject(), fundingWallet: W.FUND }));
  });
  t("a dry-run project (a demo fixture, or a future E10 pre-terms project) refuses", () => {
    assert.throws(() => commit.assertCanCommit({ ...mkProject(), dryRun: true }), /dry-run projects cannot commit/);
  });
  t("a project with no funding wallet on file refuses", () => {
    const p = mkProject(); delete p.fundingWallet;
    assert.throws(() => commit.assertCanCommit(p), /no funding wallet/);
  });
  t("no project at all refuses", () => { assert.throws(() => commit.assertCanCommit(null), /no such project/); });
}

section("3. resolveVersion — targets an explicit version or defaults to the latest");
{
  const P = mkProject();
  const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const s2 = proj.createVersion(s1, P, { poolDailyRaw: "2000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-20", todayKey: "2026-09-18" });
  t("no `wanted` resolves to the LATEST version", () => {
    const found = commit.resolveVersion(s2.versions, null);
    assert.strictEqual(found.version.version, 2); assert.strictEqual(found.index, 1);
  });
  t("an explicit version number resolves to that one, even an earlier one", () => {
    const found = commit.resolveVersion(s2.versions, "1");
    assert.strictEqual(found.version.version, 1); assert.strictEqual(found.index, 0);
  });
  t("an unknown version number resolves to null, not a throw", () => {
    assert.strictEqual(commit.resolveVersion(s2.versions, 99), null);
  });
  t("no versions at all resolves to null", () => { assert.strictEqual(commit.resolveVersion([], null), null); });
}

// A fake jsonParsed getTransaction result. `memoShape` picks how the memo instruction is encoded:
// "parsed" (a native spl-memo decoder) or "data" (base58 PartiallyDecodedInstruction) — both
// occur on real RPCs depending on the node, and verifyCommitTx must accept either.
function fakeTx({ payer = W.FUND, memoTexts = [], err = null, slot = 555, blockTime = NOW_UNIX, memoShape = "parsed", extraKeys = [] } = {}) {
  const instructions = memoTexts.map((text) => memoShape === "parsed"
    ? { programId: commit.MEMO_PROGRAM_ID, program: "spl-memo", parsed: text }
    : { programId: commit.MEMO_PROGRAM_ID, accounts: [], data: bs58.encode(Buffer.from(text, "utf8")) });
  return {
    slot, blockTime, meta: { err },
    transaction: { message: { accountKeys: [payer, ...extraKeys], instructions } },
  };
}

section("4. verifyCommitTx — never trusts the client's claim, only what actually landed");
{
  const memo = "clkn-hub:v1:alpha:1:" + "c".repeat(64);
  t("null tx (not found / not confirmed yet) is a retryable refusal", () => {
    const r = commit.verifyCommitTx(null, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retry, true); assert.match(r.reason, /not confirmed yet/);
  });
  t("a failed transaction never counts, whatever it logged", () => {
    const tx = fakeTx({ memoTexts: [memo], err: { InstructionError: [0, "Custom"] } });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /failed on-chain/);
  });
  t("wrong fee payer is refused — a project cannot commit paid for by someone else's wallet", () => {
    const tx = fakeTx({ payer: W.A, memoTexts: [memo] });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /fee payer/); assert.strictEqual(r.payer, W.A);
  });
  t("no memo instruction at all is refused", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: [] });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /no memo instruction/); assert.strictEqual(r.count, 0);
  });
  t("more than one memo instruction is refused — exactly one was asked for", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: [memo, memo] });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /more than one/); assert.strictEqual(r.count, 2);
  });
  t("a memo that does not match this version's text is refused", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: ["clkn-hub:v1:alpha:1:" + "d".repeat(64)] });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /memo text does not match/);
  });
  t("the right payer + exactly one matching memo (native `parsed` shape) verifies", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: [memo], memoShape: "parsed", slot: 12345 });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.slot, 12345); assert.strictEqual(r.payer, W.FUND);
  });
  t("the right payer + exactly one matching memo (base58 `data` shape) also verifies", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: [memo], memoShape: "data", slot: 777 });
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.slot, 777);
  });
  t("an inner (CPI-nested) memo does not count — only top-level instructions are read", () => {
    const tx = fakeTx({ payer: W.FUND, memoTexts: [] });
    tx.meta.innerInstructions = [{ index: 0, instructions: [{ programId: commit.MEMO_PROGRAM_ID, program: "spl-memo", parsed: memo }] }];
    const r = commit.verifyCommitTx(tx, { expectedPayer: W.FUND, expectedMemo: memo });
    assert.strictEqual(r.ok, false); assert.match(r.reason, /no memo instruction/);
  });
}

section("5. applyCommitment — written ONCE, never overwritten");
{
  const P = mkProject();
  const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const s2 = proj.createVersion(s1, P, { poolDailyRaw: "2000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-20", todayKey: "2026-09-18" });
  t("commits index 0 without touching index 1", () => {
    const c1 = { sig: "sig-one", slot: 1, observedAt: NOW_UNIX, memo: "m1" };
    const out = commit.applyCommitment(s2, 0, c1);
    assert.strictEqual(out.already, false);
    assert.deepStrictEqual(out.state.versions[0].commitment, c1);
    assert.strictEqual(out.state.versions[1].commitment, undefined);
    assert.strictEqual(s2.versions[0].commitment, undefined, "the input state is never mutated");
  });
  t("a second, different-looking observation of an already-committed version is refused as already:true, unchanged", () => {
    const c1 = { sig: "sig-one", slot: 1, observedAt: NOW_UNIX, memo: "m1" };
    const once = commit.applyCommitment(s2, 0, c1).state;
    const c2 = { sig: "sig-DIFFERENT", slot: 999, observedAt: NOW_UNIX + 100, memo: "m1" };
    const twice = commit.applyCommitment(once, 0, c2);
    assert.strictEqual(twice.already, true);
    assert.deepStrictEqual(twice.commitment, c1, "the ORIGINAL commitment survives — never overwritten");
    assert.deepStrictEqual(twice.state.versions[0].commitment, c1);
  });
  t("an out-of-range index throws rather than silently writing nowhere", () => {
    assert.throws(() => commit.applyCommitment(s2, 5, { sig: "x", slot: 1, observedAt: NOW_UNIX }), /no such program version/);
    assert.throws(() => commit.applyCommitment(s2, -1, { sig: "x", slot: 1, observedAt: NOW_UNIX }), /no such program version/);
  });
}

section("6. verifyVersionHash — a commitment is bookkeeping, exactly like effectiveTo, never part of the hash");
{
  t("a committed version still verifies against its original hash", () => {
    const P = mkProject();
    const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
    assert.ok(proj.verifyVersionHash(s1.versions[0]));
    const withCommit = commit.applyCommitment(s1, 0, { sig: "sig", slot: 1, observedAt: NOW_UNIX, memo: "m" }).state.versions[0];
    assert.ok(proj.verifyVersionHash(withCommit), "attaching a commitment must not break hash verification");
    // A genuinely tampered term must still fail — stripping commitment must not open a new hole.
    const tampered = { ...withCommit, terms: { ...withCommit.terms, poolDailyRaw: "999999999" } };
    assert.ok(!proj.verifyVersionHash(tampered));
  });
}

section("7. lib/hub/public.js — commitmentView / programVersionView never leak the memo text");
{
  t("no commitment on the version → null", () => {
    assert.strictEqual(pub.commitmentView({ version: 1 }), null);
    assert.strictEqual(pub.commitmentView(null), null);
  });
  t("a real commitment projects to EXACTLY sig/slot/observedAt — memo is dropped", () => {
    const v = { version: 1, commitment: { sig: "sig-abc", slot: 42, observedAt: NOW_UNIX, memo: "clkn-hub:v1:alpha:1:deadbeef" } };
    const view = pub.commitmentView(v);
    assert.deepStrictEqual(view, { sig: "sig-abc", slot: 42, observedAt: NOW_UNIX });
    assert.deepStrictEqual(Object.keys(view).sort(), ["observedAt", "sig", "slot"]);
  });
  t("programVersionView bundles hash/terms/commitment; null in, null out", () => {
    assert.strictEqual(pub.programVersionView(null), null);
    const P = mkProject();
    const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
    const view = pub.programVersionView(s1.versions[0]);
    assert.strictEqual(view.hash, s1.versions[0].hash);
    assert.strictEqual(view.commitment, null);
    const committed = commit.applyCommitment(s1, 0, { sig: "s", slot: 1, observedAt: NOW_UNIX, memo: "m" }).state.versions[0];
    assert.deepStrictEqual(pub.programVersionView(committed).commitment, { sig: "s", slot: 1, observedAt: NOW_UNIX });
  });
}

section("8. lib/hub/teach.js — the two wordings a program page is allowed to show, and only these");
{
  t("REPRODUCIBLE_NOTICE and COMMITTED_NOTICE are distinct, non-empty, and teachBlock uses the exact reproducible string", () => {
    assert.ok(teach.REPRODUCIBLE_NOTICE && teach.COMMITTED_NOTICE && teach.REPRODUCIBLE_NOTICE !== teach.COMMITTED_NOTICE);
    assert.ok(!/independently (verified|committed)/i.test(teach.REPRODUCIBLE_NOTICE), "the un-committed wording must never claim verification");
    const P = mkProject();
    const s1 = proj.createVersion({}, P, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
    const block = teach.teachBlock({ project: P, version: s1.versions[0], funding: { obligationsRaw: "0", reservedRaw: "0", observedBalanceRaw: null, observedAt: null, shortfallRaw: null } });
    assert.strictEqual(block.notices.reproducible, teach.REPRODUCIBLE_NOTICE);
  });
}

section("9. the demo fixture (dry-run, Colosseum judges' walkthrough) shows the un-committed state honestly");
{
  t("neither fixture project's version ever carries a commitment — 'Not yet committed' is the truth, not a default", () => {
    const d = demoFixture.get();
    assert.strictEqual(d.demo.version.commitment, undefined);
    assert.strictEqual(d["demo-b"].version.commitment, undefined);
    assert.strictEqual(d.demo.teach.notices.reproducible, teach.REPRODUCIBLE_NOTICE);
  });
  t("the fixture project itself is marked dryRun — commit/build would refuse it (it is also unreachable: never in the real registry)", () => {
    const d = demoFixture.get();
    assert.strictEqual(d.demo.project.dryRun, true);
    assert.throws(() => commit.assertCanCommit(d.demo.project), /dry-run projects cannot commit/);
  });
}

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e && e.message)); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
