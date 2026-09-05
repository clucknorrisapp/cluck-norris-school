"use strict";
// Tests for lib/cuna-payout.js — the bookkeeping between "what is owed" and "what was sent".
//
// Every case here is a way to pay somebody twice, pay them nothing, or pay them the wrong amount.

const assert = require("assert");
const p = require("../lib/cuna-payout");
const pay = p;
const SIG = "5" + "a".repeat(70);

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const CUNA = (n) => (BigInt(n) * 10n ** 9n).toString();
const day = (credits) => ({ credits });

section("what each wallet has earned");

t("credits add up across every accrued day", () => {
  const days = { "2026-09-01": day({ A: CUNA(100), B: CUNA(50) }),
                 "2026-09-02": day({ A: CUNA(200) }) };
  assert.deepStrictEqual(p.totalCredits(days), { A: BigInt(CUNA(300)), B: BigInt(CUNA(50)) });
});

t("a day that paid nobody, or is malformed, does not break the total", () => {
  const days = { a: day({}), b: null, c: { credits: null }, d: day({ A: CUNA(10) }),
                 e: day({ A: "junk" }), f: day({ B: "-5" }) };
  assert.deepStrictEqual(p.totalCredits(days), { A: BigInt(CUNA(10)) });
});

section("what is owed right now");

t("owed is earned minus paid", () => {
  const owed = p.owedNow({ days: { d: day({ A: CUNA(100) }) }, paid: { A: CUNA(30) }, pending: {} });
  assert.strictEqual(owed.A, BigInt(CUNA(70)));
});

t("THE ONE THAT MATTERS: a pending batch is held aside, so exporting twice cannot double-pay", () => {
  // Export a batch, get distracted, export again. Without the pending hold the same money lands
  // in two batches and goes out twice.
  const days = { d: day({ A: CUNA(100000) }) };
  const first = p.buildBatch({ owed: p.owedNow({ days, paid: {}, pending: {} }), batchId: "b1", nowUnix: 1 });
  assert.strictEqual(first.amounts.A, CUNA(100000));
  const owedAfter = p.owedNow({ days, paid: {}, pending: { b1: first } });
  assert.strictEqual(owedAfter.A, 0n, "the same money was offered up twice");
  const second = p.buildBatch({ owed: owedAfter, batchId: "b2", nowUnix: 2 });
  assert.strictEqual(second.count, 0);
});

t("a cancelled or sent batch stops being held", () => {
  const days = { d: day({ A: CUNA(100000) }) };
  const b = p.buildBatch({ owed: p.owedNow({ days, paid: {}, pending: {} }), batchId: "b1", nowUnix: 1 });
  const cancelled = p.cancelBatch({ batch: b });
  assert.strictEqual(p.owedNow({ days, paid: {}, pending: { b1: cancelled } }).A, BigInt(CUNA(100000)));
  const { paid, batch: sent } = p.confirmBatch({ batch: b, paid: {} });
  assert.strictEqual(p.owedNow({ days, paid, pending: { b1: sent } }).A, 0n);
});

t("accrual DURING a pending batch is still owed afterwards", () => {
  // The classic off-by-a-batch: confirming must credit only what the batch contained, not
  // everything the wallet had earned by the time it landed.
  const days = { d1: day({ A: CUNA(100000) }) };
  const b = p.buildBatch({ owed: p.owedNow({ days, paid: {}, pending: {} }), batchId: "b1", nowUnix: 1 });
  days.d2 = day({ A: CUNA(40000) });                    // earned while the batch was in flight
  const { paid } = p.confirmBatch({ batch: b, paid: {} });
  assert.strictEqual(paid.A, CUNA(100000));
  assert.strictEqual(p.owedNow({ days, paid, pending: {} }).A, BigInt(CUNA(40000)));
});

t("an over-payment shows as zero owed, never as a debt", () => {
  // A manual send outside this system must not make the next batch try to claw money back.
  const owed = p.owedNow({ days: { d: day({ A: CUNA(10) }) }, paid: { A: CUNA(999) }, pending: {} });
  assert.strictEqual(owed.A, 0n);
});

section("building the batch");

t("THERE IS NO MINIMUM PAYOUT — the smallest earner is paid", () => {
  // Owner, 2026-09-05: recipients already hold CUNA and have a lock, so their token account
  // exists — no rent, just a per-transfer fee worth fractions of a cent in a batch. A floor would
  // also get MORE exclusionary as the price rose, which is backwards.
  assert.strictEqual(p.DEFAULT_MIN_PAYOUT_RAW, 0n);
  const b = p.buildBatch({ owed: { A: CUNA(5000), B: "1", C: CUNA(3) }, batchId: "b1", nowUnix: 1 });
  assert.deepStrictEqual(Object.keys(b.amounts).sort(), ["A", "B", "C"]);
  assert.strictEqual(b.amounts.B, "1", "one base unit is still owed and still paid");
  assert.deepStrictEqual(b.skippedBelowFloor, {});
});

t("the floor still works if it is ever switched back on", () => {
  // Kept as a knob because a floor is the right tool if fees ever change.
  const b = p.buildBatch({ owed: { A: CUNA(5000), B: CUNA(3) }, minPayoutRaw: CUNA(1000),
                           batchId: "b1", nowUnix: 1 });
  assert.deepStrictEqual(Object.keys(b.amounts), ["A"]);
  assert.strictEqual(b.skippedBelowFloor.B, CUNA(3));
  // and skipped dust is still owed, because nothing was written to paid
  const { paid } = p.confirmBatch({ batch: b, paid: {} });
  assert.strictEqual(paid.B, undefined);
});

t("the total is the sum of what is actually being sent", () => {
  const b = p.buildBatch({ owed: { A: CUNA(5000), B: CUNA(3), C: CUNA(2000) }, minPayoutRaw: CUNA(1000),
                           batchId: "b1", nowUnix: 1 });
  assert.strictEqual(b.totalRaw, CUNA(7000), "skipped dust must not be counted in the total");
  assert.strictEqual(b.count, 2);
});

t("the batch is deterministic — same owed, same batch", () => {
  const owed = { Zed: CUNA(5000), Al: CUNA(3000), Mid: CUNA(4000) };
  const one = p.buildBatch({ owed, batchId: "b1", nowUnix: 1 });
  const two = p.buildBatch({ owed: { Mid: CUNA(4000), Zed: CUNA(5000), Al: CUNA(3000) }, batchId: "b1", nowUnix: 1 });
  assert.deepStrictEqual(one, two);
});

t("a batch without an id is refused", () => {
  assert.throws(() => p.buildBatch({ owed: { A: CUNA(5000) }, nowUnix: 1 }), /needs an id/);
});

section("the airdropper file");

t("raw amounts become whole tokens by STRING surgery, never division", () => {
  // 1,276,382.123456789 CUNA does not survive a JS number, and the number that comes out of that
  // division is what somebody actually receives.
  const lines = p.toAirdropLines({ A: "1276382123456789", B: CUNA(1000) });
  assert.strictEqual(lines.split("\n")[0], "A, 1276382.123456789");
  assert.strictEqual(lines.split("\n")[1], "B, 1000");
});

t("a u64-scale payout survives exactly", () => {
  assert.strictEqual(p.toAirdropLines({ A: "175000000000000000" }), "A, 175000000");
});

t("sub-token amounts do not become zero or NaN", () => {
  assert.strictEqual(p.toAirdropLines({ A: "1" }), "A, 0.000000001");
  assert.strictEqual(p.toAirdropLines({ A: "500000000" }), "A, 0.5");
});

t("the file matches the airdropper's manual format: wallet, amount per line", () => {
  const lines = p.toAirdropLines({ W1: CUNA(1000), W2: CUNA(2500) }).split("\n");
  for (const l of lines) assert.ok(/^[^,]+, \d+(\.\d+)?$/.test(l), `bad line: ${l}`);
});

section("confirming");

t("only a pending batch can be confirmed or cancelled", () => {
  const b = p.buildBatch({ owed: { A: CUNA(5000) }, batchId: "b1", nowUnix: 1 });
  const { batch: sent } = p.confirmBatch({ batch: b, paid: {} });
  assert.throws(() => p.confirmBatch({ batch: sent, paid: {} }), /only a pending batch/);
  assert.throws(() => p.cancelBatch({ batch: sent }), /only a pending batch/);
  assert.throws(() => p.confirmBatch({ batch: p.cancelBatch({ batch: b }), paid: {} }), /only a pending batch/);
});

t("confirming twice is impossible, so nobody is paid twice", () => {
  const b = p.buildBatch({ owed: { A: CUNA(5000) }, batchId: "b1", nowUnix: 1 });
  const first = p.confirmBatch({ batch: b, paid: {} });
  assert.strictEqual(first.paid.A, CUNA(5000));
  assert.throws(() => p.confirmBatch({ batch: first.batch, paid: first.paid }), /only a pending batch/);
});

t("paid accumulates across batches", () => {
  let paid = {};
  for (const id of ["b1", "b2", "b3"]) {
    const b = p.buildBatch({ owed: { A: CUNA(1000) }, batchId: id, nowUnix: 1 });
    ({ paid } = p.confirmBatch({ batch: b, paid }));
  }
  assert.strictEqual(paid.A, CUNA(3000));
});

section("partial sends — rows are confirmed one at a time");

t("recordSent pays exactly the rows that confirmed, and leaves the rest owed", () => {
  const days = { d1: { credits: { A: "100", B: "200", C: "300" } } };
  const b = pay.buildBatch({ owed: pay.owedNow({ days, paid: {}, pending: {} }), batchId: "cb_1", nowUnix: 1 });
  const r = pay.recordSent({ batch: b, paid: {}, results: [{ wallet: "A", sig: SIG }, { wallet: "C", sig: SIG }], nowUnix: 2 });
  assert.deepStrictEqual(r.recorded, ["A", "C"]);
  assert.strictEqual(r.paid.A, "100"); assert.strictEqual(r.paid.C, "300"); assert.strictEqual(r.paid.B, undefined);
  assert.strictEqual(r.batch.state, "pending", "one row is still unsent");
  assert.deepStrictEqual(Object.keys(r.remaining), ["B"]);
  // owed now: A and C are paid, B is still held by the pending batch -> nobody is owed
  const owed = pay.owedNow({ days, paid: r.paid, pending: { cb_1: r.batch } });
  assert.deepStrictEqual(owed, { A: 0n, B: 0n, C: 0n });
  // a NEW accrual after the partial send is owed again, on top
  const days2 = { ...days, d2: { credits: { A: "5" } } };
  assert.strictEqual(pay.owedNow({ days: days2, paid: r.paid, pending: { cb_1: r.batch } }).A, 5n);
});

t("THE ONE THAT MATTERS: a sent row is never counted twice — not by a replay, not by held+paid", () => {
  const days = { d1: { credits: { A: "100", B: "200" } } };
  const b = pay.buildBatch({ owed: pay.owedNow({ days, paid: {}, pending: {} }), batchId: "cb_1", nowUnix: 1 });
  const r1 = pay.recordSent({ batch: b, paid: {}, results: [{ wallet: "A", sig: SIG }], nowUnix: 2 });
  const r2 = pay.recordSent({ batch: r1.batch, paid: r1.paid, results: [{ wallet: "A", sig: SIG }], nowUnix: 3 });
  assert.strictEqual(r2.paid.A, "100", "a replayed row inflated paid");
  assert.deepStrictEqual(r2.recorded, []);
  assert.strictEqual(r2.ignored[0].why, "already recorded");
  // and the sent row is NOT also held as pending (that would double-subtract it from owed)
  const owed = pay.owedNow({ days: { d1: { credits: { A: "150", B: "200" } } }, paid: r2.paid, pending: { cb_1: r2.batch } });
  assert.strictEqual(owed.A, 50n, "the 50 accrued since should be owed; got " + owed.A);
});

t("closing a partly-sent batch keeps the sent rows paid and frees only the rest", () => {
  const days = { d1: { credits: { A: "100", B: "200" } } };
  const b = pay.buildBatch({ owed: pay.owedNow({ days, paid: {}, pending: {} }), batchId: "cb_1", nowUnix: 1 });
  const r = pay.recordSent({ batch: b, paid: {}, results: [{ wallet: "A", sig: SIG }], nowUnix: 2 });
  const closed = pay.cancelBatch({ batch: r.batch });
  assert.strictEqual(closed.state, "closed");
  const owed = pay.owedNow({ days, paid: r.paid, pending: { cb_1: closed } });
  assert.strictEqual(owed.A, 0n, "A was paid and must not be re-offered");
  assert.strictEqual(owed.B, 200n, "B never went and must be owed again");
  assert.strictEqual(pay.cancelBatch({ batch: b }).state, "cancelled", "nothing sent -> cancelled, not closed");
});

t("recordSent refuses rows without a real signature or outside the batch, and completes on the last row", () => {
  const days = { d1: { credits: { A: "100", B: "200" } } };
  const b = pay.buildBatch({ owed: pay.owedNow({ days, paid: {}, pending: {} }), batchId: "cb_1", nowUnix: 1 });
  const r = pay.recordSent({ batch: b, paid: {}, results: [{ wallet: "A", sig: "" }, { wallet: "Z", sig: SIG }, { wallet: "B", sig: SIG }], nowUnix: 2 });
  assert.deepStrictEqual(r.recorded, ["B"]);
  assert.strictEqual(r.ignored.length, 2);
  const r2 = pay.recordSent({ batch: r.batch, paid: r.paid, results: [{ wallet: "A", sig: SIG }], nowUnix: 3 });
  assert.strictEqual(r2.batch.state, "sent", "all rows in -> batch completes by itself");
  assert.throws(() => pay.recordSent({ batch: r2.batch, paid: r2.paid, results: [], nowUnix: 4 }), /pending/);
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
