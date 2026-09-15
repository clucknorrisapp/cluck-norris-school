"use strict";
// Project Hub — the §4 signing and reconcile fault cases (rev 4), pure half. Each case is a way
// for a payout to land twice, land unrecorded, or free a reservation for money that then lands.
const assert = require("assert");
const proj = require("../lib/hub/project");
const L = require("../lib/hub/ledger");
const A = require("../lib/hub/attempts");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");
const NOW = 1_800_000_000;
const mk = (id, mint) => { const p = proj.validateProject({ id, label: id, symbol: id.slice(0, 6).toUpperCase(), mint, fundingWallet: W.FUND }, { decimals: 9, tokenProgram: TOK, extensions: [] }); return { p, v: proj.createVersion({}, p, { poolDailyRaw: "1000" }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" }).versions[0] }; };
const days = (credits) => ({ "2026-09-17T00": { credits } });
const fresh = (id, mint, credits, batchId) => {
  const { p, v } = mk(id, mint);
  const d = days(credits);
  const part = L.partition({ projectId: id, days: d, batches: {}, journal: {} });
  const b = L.buildBatch({ projectId: id, programVersion: v, periods: ["2026-09-17T00"], part, batchId, nowUnix: NOW });
  return { p, v, d, b };
};
const holds = (id, d, batches, journal) => assert.deepStrictEqual(L.checkInvariant(L.partition({ projectId: id, days: d, batches, journal })), []);
const BH = { recentBlockhash: "Hash1111111111111111111111111111111111111111", lastValidBlockHeight: 1000 };

section("(1) tab lost immediately after broadcast, before any callback");

t("row is submitted with its signature; cancel refused; reconcile finds it → paid; rebuild refused", () => {
  const { d, b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b1");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  assert.strictEqual(r.attempt.state, "signing"); assert.strictEqual(r.attempt.amountRaw, "100");
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(1), nowUnix: NOW + 1 });
  assert.strictEqual(r.attempt.state, "submitted");
  assert.throws(() => A.cancelBatch({ batch: r.batch, journal: {} }), /signing or submitted/);
  holds("alpha", d, { b1: r.batch }, {});   // reservation intact while submitted
  const rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "100", slot: 5 } }, nowUnix: NOW + 30 });
  assert.strictEqual(rc.outcome, "settled");
  assert.strictEqual(A.rowView(rc.batch, W.A, rc.journal).state, "paid");
  holds("alpha", d, { b1: rc.batch }, rc.journal);
  assert.throws(() => A.registerAttempt({ batch: rc.batch, wallet: W.A, journal: rc.journal, attemptId: "att2", ...BH, nowUnix: NOW + 40 }), /nothing remaining/);
});

section("(2) tab lost after the wallet signed but before the signature was registered");

t("nothing was broadcast; row stays signing while the blockhash is valid, returns to pending after expiry, rebuild allowed", () => {
  const { d, b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b2");
  const r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  let rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 999 }, nowUnix: NOW + 60 });
  assert.strictEqual(rc.outcome, "kept"); assert.strictEqual(A.rowView(rc.batch, W.A, {}).state, "signing");
  assert.throws(() => A.registerAttempt({ batch: rc.batch, wallet: W.A, journal: {}, attemptId: "att2", ...BH, nowUnix: NOW + 61 }), /live attempt/);
  rc = A.reconcile({ batch: rc.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 1001 }, nowUnix: NOW + 120 });
  assert.strictEqual(rc.outcome, "returned_to_pending");
  assert.strictEqual(A.rowView(rc.batch, W.A, {}).state, "pending");
  holds("alpha", d, { b2: rc.batch }, {});
  const again = A.registerAttempt({ batch: rc.batch, wallet: W.A, journal: {}, attemptId: "att2", recentBlockhash: "Hash2", lastValidBlockHeight: 2000, nowUnix: NOW + 130 });
  assert.strictEqual(again.attempt.state, "signing"); assert.strictEqual(again.attempt.failed.length, 1);
});

section("(3) reconcile while the blockhash is still valid finds nothing → KEEPS the state");

t("a submitted row with a complete not-found but an unexpired blockhash is never released", () => {
  const { b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b3");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(3), nowUnix: NOW + 1 });
  let rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 500 }, nowUnix: NOW + 100 });
  assert.strictEqual(rc.outcome, "kept");
  rc = A.reconcile({ batch: rc.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 900 }, nowUnix: NOW + 200 });
  assert.strictEqual(rc.outcome, "kept"); assert.strictEqual(A.rowView(rc.batch, W.A, {}).state, "submitted");
});

t("expired + not-found needs TWO consecutive agreeing reconciles at least 60 s apart", () => {
  const { d, b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b3b");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(4), nowUnix: NOW + 1 });
  let rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 1001 }, nowUnix: NOW + 100 });
  assert.strictEqual(rc.outcome, "kept");
  rc = A.reconcile({ batch: rc.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 1001 }, nowUnix: NOW + 130 });   // only 30 s later
  assert.strictEqual(rc.outcome, "kept");
  rc = A.reconcile({ batch: rc.batch, wallet: W.A, journal: {}, lookup: { status: "unavailable" }, nowUnix: NOW + 200 });   // an outage in between does not count
  assert.strictEqual(rc.outcome, "kept");
  rc = A.reconcile({ batch: rc.batch, wallet: W.A, journal: {}, lookup: { status: "not_found", finalizedBlockHeight: 1002 }, nowUnix: NOW + 260 });
  assert.strictEqual(rc.outcome, "returned_to_pending");
  holds("alpha", d, { b3b: rc.batch }, {});
  // back to pending means re-attemptable — the row is still in a pending batch, so it stays
  // reserved; only a cancel (now allowed, nothing is live) releases it to available.
  assert.strictEqual(L.partition({ projectId: "alpha", days: d, batches: { b3b: rc.batch }, journal: {} })[W.A].reservedRaw, "100");
  const cancelled = A.cancelBatch({ batch: rc.batch, journal: {} });
  assert.strictEqual(cancelled.state, "cancelled");
  assert.strictEqual(L.partition({ projectId: "alpha", days: d, batches: { b3b: cancelled }, journal: {} })[W.A].availableRaw, "100");
});

section("(4) restart mid-signing / mid-submitted — the attempt survives on disk");

t("a batch round-tripped through JSON reconciles identically", () => {
  const { b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b4");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(5), nowUnix: NOW + 1 });
  const fromDisk = JSON.parse(JSON.stringify(r.batch));
  assert.deepStrictEqual(A.attemptOf(fromDisk, W.A), A.attemptOf(r.batch, W.A));
  const rc = A.reconcile({ batch: fromDisk, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 2000, transfer: { instructionIndex: 0, amountRaw: "100", slot: 9 } }, nowUnix: NOW + 500 });
  assert.strictEqual(rc.outcome, "settled");
  assert.strictEqual(rc.entry.sig, SIG(5));
});

section("(5) RPC unavailable or erroring during reconcile — state and reservation untouched");

t("unavailable keeps a submitted row submitted, with no reconcile recorded against it", () => {
  const { d, b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b5");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(6), nowUnix: NOW + 1 });
  const before = JSON.stringify(r.batch);
  const rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "unavailable" }, nowUnix: NOW + 1000 });
  assert.strictEqual(rc.outcome, "kept"); assert.strictEqual(JSON.stringify(rc.batch), before);
  assert.strictEqual(L.partition({ projectId: "alpha", days: d, batches: { b5: rc.batch }, journal: {} })[W.A].reservedRaw, "100");
  const rc2 = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: null, nowUnix: NOW + 1000 });
  assert.strictEqual(rc2.outcome, "kept");
});

section("(6) two projects sharing a funding wallet pay the same recipient the same amount in the same minute");

t("each row resolves only by its own signature; neither can claim the other's transfer", () => {
  const a = fresh("alpha", W.MINT1, { [W.A]: "100" }, "ba"), b = fresh("beta", W.MINT2, { [W.A]: "100" }, "bb");
  let ra = A.registerAttempt({ batch: a.b, wallet: W.A, journal: {}, attemptId: "x", ...BH, nowUnix: NOW });
  ra = A.recordSignature({ batch: ra.batch, wallet: W.A, attemptId: "x", sig: SIG(7), nowUnix: NOW + 1 });
  let rb = A.registerAttempt({ batch: b.b, wallet: W.A, journal: {}, attemptId: "y", ...BH, nowUnix: NOW + 2 });
  rb = A.recordSignature({ batch: rb.batch, wallet: W.A, attemptId: "y", sig: SIG(8), nowUnix: NOW + 3 });
  // Only alpha's transfer landed. Beta's reconcile looks up SIG(8) — its own — and finds nothing.
  const rcA = A.reconcile({ batch: ra.batch, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "100", slot: 1 } }, nowUnix: NOW + 30 });
  assert.strictEqual(rcA.outcome, "settled"); assert.strictEqual(rcA.entry.sig, SIG(7));
  const rcB = A.reconcile({ batch: rb.batch, wallet: W.A, journal: rcA.journal, lookup: { status: "not_found", finalizedBlockHeight: 900 }, nowUnix: NOW + 30 });
  assert.strictEqual(rcB.outcome, "kept"); assert.strictEqual(A.rowView(rcB.batch, W.A, rcA.journal).state, "submitted");
  // And if beta's caller wrongly presented alpha's transfer as beta's own, the journal refuses it.
  const forged = { ...A.attemptOf(rb.batch, W.A), sig: SIG(7) };
  const rbForged = { ...rb.batch, attempts: { [W.A]: forged } };
  const rcF = A.reconcile({ batch: rbForged, wallet: W.A, journal: rcA.journal, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "100", slot: 1 } }, nowUnix: NOW + 31 });
  assert.strictEqual(rcF.outcome, "refused"); assert.strictEqual(rcF.error, "transfer_already_consumed"); assert.strictEqual(rcF.owner.projectId, "alpha");
});

section("the earlier set");

t("two operators creating batches concurrently: only one reserves a given credit", () => {
  const { v, d } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "seed");
  const part0 = L.partition({ projectId: "alpha", days: d, batches: {}, journal: {} });
  const b1 = L.buildBatch({ projectId: "alpha", programVersion: v, periods: [], part: part0, batchId: "op1", nowUnix: NOW });
  const part1 = L.partition({ projectId: "alpha", days: d, batches: { op1: b1 }, journal: {} });
  const b2 = L.buildBatch({ projectId: "alpha", programVersion: v, periods: [], part: part1, batchId: "op2", nowUnix: NOW });
  assert.strictEqual(b1.count, 1); assert.strictEqual(b2.count, 0);
});

t("a lost response after a send: the row reconciles to paid from its signature and is never resent", () => {
  const { b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b7");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(9), nowUnix: NOW + 1 });
  const rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "100", slot: 1 } }, nowUnix: NOW + 5 });
  const rc2 = A.reconcile({ batch: rc.batch, wallet: W.A, journal: rc.journal, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "100", slot: 1 } }, nowUnix: NOW + 6 });
  assert.strictEqual(rc2.outcome, "no_live_attempt");
  assert.strictEqual(Object.keys(rc.journal).length, 1);
  assert.throws(() => A.registerAttempt({ batch: rc.batch, wallet: W.A, journal: rc.journal, attemptId: "att2", ...BH, nowUnix: NOW + 7 }), /nothing remaining/);
});

t("cancellation during confirmation is refused; late confirmation after a restart flips the row to paid", () => {
  const { d, b } = fresh("alpha", W.MINT1, { [W.A]: "100", ["2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8"]: "5" }, "b8");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(10), nowUnix: NOW + 1 });
  assert.throws(() => A.cancelBatch({ batch: r.batch, journal: {} }), /reconcile before cancelling/);
  const restarted = JSON.parse(JSON.stringify(r.batch));
  const rc = A.reconcile({ batch: restarted, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 3000, transfer: { instructionIndex: 0, amountRaw: "100", slot: 2 } }, nowUnix: NOW + 900 });
  assert.strictEqual(A.rowView(rc.batch, W.A, rc.journal).state, "paid");
  holds("alpha", d, { b8: rc.batch }, rc.journal);
  // now nothing is live: cancel closes the batch, the unsent 5 returns to available, the 100 stays paid
  const closed = A.cancelBatch({ batch: rc.batch, journal: rc.journal });
  assert.strictEqual(closed.state, "closed");
});

t("a partial row: the next attempt is built for exactly the remainder", () => {
  const { b } = fresh("alpha", W.MINT1, { [W.A]: "100" }, "b9");
  let r = A.registerAttempt({ batch: b, wallet: W.A, journal: {}, attemptId: "att1", ...BH, nowUnix: NOW });
  r = A.recordSignature({ batch: r.batch, wallet: W.A, attemptId: "att1", sig: SIG(11), nowUnix: NOW + 1 });
  const rc = A.reconcile({ batch: r.batch, wallet: W.A, journal: {}, lookup: { status: "found", finalizedBlockHeight: 900, transfer: { instructionIndex: 0, amountRaw: "40", slot: 1 } }, nowUnix: NOW + 5 });
  assert.strictEqual(A.rowView(rc.batch, W.A, rc.journal).state, "partial");
  const next = A.registerAttempt({ batch: rc.batch, wallet: W.A, journal: rc.journal, attemptId: "att2", recentBlockhash: "H2", lastValidBlockHeight: 5000, nowUnix: NOW + 10 });
  assert.strictEqual(next.attempt.amountRaw, "60");
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
