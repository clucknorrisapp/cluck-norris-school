#!/usr/bin/env node
"use strict";
// E1 (docs/COLOSSEUM_ROADMAP.md §1 "the number") — lib/hub/reproduce.js and
// scripts/reproduce-receipt.cjs. Zero-dependency: seeds an in-memory kv the way
// scripts/hub-core-test.cjs does, exercises the pure core directly, then spawns the real CLI
// script in --offline mode (no network) to prove the two agree.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const store = require("../lib/hub/store");
const R = require("../lib/hub/reproduce");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8" };
const SIG = "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7) % 23]).join("");

// A batch built the way lib/cuna-payout.js's buildBatch actually shapes one, with a `sent` row
// already recorded — the only state buildInputsForWallet will ever publish (public/private line).
function mkBatch({ id, at, amounts, sentAt, cancelledAt } = {}) {
  const sent = {};
  for (const w of Object.keys(amounts)) if (sentAt) sent[w] = { sig: SIG, at: sentAt };
  const b = { id, state: "sent", at, amounts, sent };
  if (cancelledAt != null) b.cancelledAt = cancelledAt;
  return b;
}

section("1. buildInputsForWallet — the periods, prior paid, prior reserved a real batch used");

t("a wallet's own two periods, both at or before the batch's own creation time, are the whole input", () => {
  const kv = store.memoryKv();
  store.write(kv, "alpha", "days", { "2026-09-17T00": { at: 1000, credits: { [W.A]: "60" } }, "2026-09-17T01": { at: 2000, credits: { [W.A]: "40" } } });
  const batch = mkBatch({ id: "b1", at: 3000, amounts: { [W.A]: "100" }, sentAt: 3100 });
  store.write(kv, "alpha", "batches", { b1: batch });
  const inputs = R.buildInputsForWallet({ batch, wallet: W.A, days: store.read(kv, "alpha", "days", {}), batches: store.read(kv, "alpha", "batches", {}) });
  assert.strictEqual(inputs.periods.length, 2);
  assert.strictEqual(inputs.priorPaidRaw, "0"); assert.strictEqual(inputs.priorReservedRaw, "0");
  assert.strictEqual(inputs.amountRaw, "100");
});

t("a period accrued AFTER the batch was built is excluded — it could not have fed this batch", () => {
  const days = { "2026-09-17T00": { at: 1000, credits: { [W.A]: "60" } }, "2026-09-17T05": { at: 9999, credits: { [W.A]: "999" } } };
  const batch = mkBatch({ id: "b1", at: 3000, amounts: { [W.A]: "60" }, sentAt: 3100 });
  const inputs = R.buildInputsForWallet({ batch, wallet: W.A, days, batches: { b1: batch } });
  assert.strictEqual(inputs.periods.length, 1); assert.strictEqual(inputs.periods[0].creditRaw, "60");
});

t("a wallet with no `sent` row is never built — the same public/private line lib/hub/public.js draws", () => {
  const batch = { id: "b1", state: "pending", at: 3000, amounts: { [W.A]: "100" }, sent: {} };
  assert.strictEqual(R.buildInputsForWallet({ batch, wallet: W.A, days: {}, batches: { b1: batch } }), null);
  assert.deepStrictEqual(R.buildBatchInputs({ batch, days: {}, batches: { b1: batch } }), {});
});

t("an earlier batch still pending at T is held (reserved); one already paid before T counts as prior paid; one cancelled before T is released", () => {
  const T = 5000;
  const heldBatch = { id: "held", state: "pending", at: 1000, amounts: { [W.A]: "10" }, sent: {} };
  const paidBatch = { id: "paid", state: "sent", at: 1000, amounts: { [W.A]: "20" }, sent: { [W.A]: { sig: SIG, at: 2000 } } };
  const cancelledBatch = { id: "cancelled", state: "cancelled", at: 1000, amounts: { [W.A]: "30" }, sent: {}, cancelledAt: 4000 };
  const paidAfterT = { id: "later", state: "sent", at: 1000, amounts: { [W.A]: "40" }, sent: { [W.A]: { sig: SIG, at: T + 1 } } };
  const batches = { held: heldBatch, paid: paidBatch, cancelled: cancelledBatch, later: paidAfterT };
  const p = R.priorState(batches, W.A, "excluded-id", T);
  assert.strictEqual(p.paidRaw, "20", "only the one settled before T");
  assert.strictEqual(p.reservedRaw, "50", "the still-pending 10 plus the one paid AFTER T, still held at T");
});

section("2. reproduce() — MATCH, MISMATCH, MISSING_INPUTS");

t("MATCH: the published amount equals periods minus prior paid/reserved", () => {
  const r = R.reproduce({ programVersion: null, inputs: { periods: [{ key: "p1", at: 1, creditRaw: "60" }, { key: "p2", at: 2, creditRaw: "40" }], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: { amountRaw: "100" } });
  assert.strictEqual(r.status, "MATCH"); assert.strictEqual(r.reproduced, "100"); assert.strictEqual(r.published, "100"); assert.strictEqual(r.hash, null); assert.deepStrictEqual(r.missing, []);
});

t("MISMATCH: a receipt tampered by one unit does not reproduce", () => {
  const inputs = { periods: [{ key: "p1", at: 1, creditRaw: "100" }], priorPaidRaw: "0", priorReservedRaw: "0" };
  const good = R.reproduce({ inputs, receipt: { amountRaw: "100" } });
  const tampered = R.reproduce({ inputs, receipt: { amountRaw: "101" } });
  assert.strictEqual(good.status, "MATCH");
  assert.strictEqual(tampered.status, "MISMATCH");
  assert.strictEqual(tampered.published, "101"); assert.strictEqual(tampered.reproduced, "100");
});

t("prior paid and reserved are subtracted before comparing", () => {
  const r = R.reproduce({ inputs: { periods: [{ key: "p1", at: 1, creditRaw: "100" }], priorPaidRaw: "30", priorReservedRaw: "20" }, receipt: { amountRaw: "50" } });
  assert.strictEqual(r.status, "MATCH"); assert.strictEqual(r.reproduced, "50");
});

t("MISSING_INPUTS when the batch's inputs were never published at all — names it", () => {
  const r = R.reproduce({ inputs: null, receipt: { amountRaw: "100" } });
  assert.strictEqual(r.status, "MISSING_INPUTS"); assert.strictEqual(r.published, "100"); assert.strictEqual(r.reproduced, null);
  assert.ok(r.missing.some((m) => /batch's published inputs/.test(m)));
});

t("MISSING_INPUTS names the SPECIFIC missing field, not just \"something\"", () => {
  const r = R.reproduce({ inputs: { periods: [{ key: "p1", at: 1, creditRaw: "100" }], priorReservedRaw: "0" }, receipt: { amountRaw: "100" } });
  assert.strictEqual(r.status, "MISSING_INPUTS");
  assert.ok(r.missing.some((m) => m.startsWith("inputs.priorPaidRaw")), JSON.stringify(r.missing));
});

t("MISSING_INPUTS when the receipt itself carries no amount", () => {
  const r = R.reproduce({ inputs: { periods: [], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: {} });
  assert.strictEqual(r.status, "MISSING_INPUTS");
  assert.ok(r.missing.some((m) => /receipt.amountRaw/.test(m)));
});

t("a program-version hash, when one exists, is carried through untouched", () => {
  const r = R.reproduce({ programVersion: { hash: "deadbeef" }, inputs: { periods: [], priorPaidRaw: "0", priorReservedRaw: "0" }, receipt: { amountRaw: "0" } });
  assert.strictEqual(r.hash, "deadbeef"); assert.strictEqual(r.status, "MATCH");
});

section("3. projectReproducibility — the ratio, batch by batch");

t("counts MATCH/MISMATCH/MISSING_INPUTS across every lock-to-earn batch plus every other program's payouts", () => {
  const days = { "2026-09-17T00": { at: 1000, credits: { [W.A]: "60", [W.B]: "60" } } };
  const good = mkBatch({ id: "good", at: 3000, amounts: { [W.A]: "60", [W.B]: "60" }, sentAt: 3100 });
  // batch2's recorded amount does not match what the periods actually add up to — a real bug this
  // ratio exists to catch, not a fixture bug: the amount is deliberately wrong.
  const bad = mkBatch({ id: "bad", at: 4000, amounts: { [W.A]: "999" }, sentAt: 4100 });
  const batches = { good, bad };
  const otherPrograms = [{ id: "bc_1", kind: "buy-comp", payouts: [{ wallet: W.A, sig: SIG }, { wallet: W.B, sig: SIG }] }, { id: "bc_2", kind: "buy-comp", payouts: [{ wallet: W.A, sig: null }] }];
  const rep = R.projectReproducibility({ batches, days, otherPrograms });
  const good1 = rep.batches.find((b) => b.batchId === "good"), bad1 = rep.batches.find((b) => b.batchId === "bad"), other = rep.batches.find((b) => b.batchId === "bc_1");
  assert.strictEqual(good1.total, 2); assert.strictEqual(good1.reproduced, 2); assert.strictEqual(good1.mismatched, 0);
  assert.strictEqual(bad1.total, 1); assert.strictEqual(bad1.reproduced, 0); assert.strictEqual(bad1.mismatched, 1);
  assert.strictEqual(other.total, 2); assert.strictEqual(other.missingInputs, 2); assert.ok(/not implemented/.test(other.note));
  assert.strictEqual(rep.batches.find((b) => b.batchId === "bc_2"), undefined, "an unsigned row is not a receipt and is not counted");
  assert.strictEqual(rep.overall.total, 5); assert.strictEqual(rep.overall.reproduced, 2);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(good1.period));
});

t("zero receipts is reported as zero, never fabricated", () => {
  const rep = R.projectReproducibility({ batches: {}, days: {}, otherPrograms: [] });
  assert.deepStrictEqual(rep, { batches: [], overall: { total: 0, reproduced: 0 } });
});

section("4. the CUNA alias — the same reconstruction over the live legacy keys");

t("a batch built under the cuna alias reproduces identically to one under a plain project id", () => {
  const kv = store.memoryKv({ cunaStakeDays: { "2026-09-14T19": { at: 5000, credits: { [W.A]: "14375000000000" } } }, cunaStakePaid: {}, cunaStakeBatches: {} });
  const batch = mkBatch({ id: "cb_test", at: 6000, amounts: { [W.A]: "14375000000000" }, sentAt: 6100 });
  store.write(kv, "cuna", "batches", { cb_test: batch });
  const inputs = R.buildInputsForWallet({ batch, wallet: W.A, days: store.read(kv, "cuna", "days", {}), batches: store.read(kv, "cuna", "batches", {}) });
  const r = R.reproduce({ inputs, receipt: { amountRaw: batch.amounts[W.A] } });
  assert.strictEqual(r.status, "MATCH");
});

section("5. the CLI script — network form parsing and --offline, no server required");

const CLI = path.join(__dirname, "reproduce-receipt.cjs");
function run(args) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { status: 0, out };
  } catch (e) { return { status: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

t("usage error on the wrong number of args exits 1", () => {
  const r = run([]);
  assert.strictEqual(r.status, 1);
});

t("a non-receipt URL is refused before any fetch is attempted", () => {
  const r = run(["https://clucknorris.app/not-a-receipt"]);
  assert.strictEqual(r.status, 1);
});

t("--offline, project/batch/wallet form: MATCH against saved batch-inputs.json, no network", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reproduce-test-"));
  try {
    const entry = { amountRaw: "100", periods: [{ key: "2026-09-17T00", at: 1000, creditRaw: "60" }, { key: "2026-09-17T01", at: 2000, creditRaw: "40" }], priorPaidRaw: "0", priorReservedRaw: "0" };
    fs.writeFileSync(path.join(dir, "batch-inputs.json"), JSON.stringify({ ok: true, projectId: "cuna", batchId: "cb_1", wallets: { [W.A]: entry } }));
    const r = run(["--offline", dir, "cuna", "cb_1", W.A]);
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(/status:\s*MATCH/.test(r.out), r.out);
    assert.ok(/published amount:\s*100 raw/.test(r.out), r.out);
    // the same amount, run straight through the pure core, agrees with the script's own count
    const direct = R.reproduce({ inputs: { periods: entry.periods, priorPaidRaw: entry.priorPaidRaw, priorReservedRaw: entry.priorReservedRaw }, receipt: { amountRaw: entry.amountRaw } });
    assert.strictEqual(direct.status, "MATCH");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t("--offline, receipt-url form: reads receipt.json for the batch/wallet, then batch-inputs.json; a tampered amount MISMATCHES", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reproduce-test-"));
  try {
    const entry = { amountRaw: "100", periods: [{ key: "p1", at: 1, creditRaw: "100" }], priorPaidRaw: "0", priorReservedRaw: "0" };
    fs.writeFileSync(path.join(dir, "receipt.json"), JSON.stringify({ ok: true, projectId: "cuna", program: { kind: "lock-to-earn" }, receipt: { wallet: W.A, batchId: "cb_1", amountUi: "0.0000001" } }));
    // Tamper: the batch's own published amount disagrees with the receipt.
    fs.writeFileSync(path.join(dir, "batch-inputs.json"), JSON.stringify({ ok: true, wallets: { [W.A]: { ...entry, amountRaw: "101" } } }));
    const url = `https://clucknorris.app/hub/cuna/r/${SIG}`;
    const r = run(["--offline", dir, url]);
    assert.strictEqual(r.status, 2, r.out);
    assert.ok(/status:\s*MISMATCH/.test(r.out), r.out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t("--offline: missing batch-inputs.json is MISSING_INPUTS, exit 3, and names what is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reproduce-test-"));
  try {
    const r = run(["--offline", dir, "cuna", "cb_1", W.A]);
    assert.strictEqual(r.status, 3, r.out);
    assert.ok(/MISSING_INPUTS/.test(r.out), r.out);
    assert.ok(/missing inputs:/.test(r.out), r.out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t("--offline, receipt-url form: an unsupported program kind is MISSING_INPUTS naming the kind, not silently skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reproduce-test-"));
  try {
    fs.writeFileSync(path.join(dir, "receipt.json"), JSON.stringify({ ok: true, program: { kind: "buy-comp" }, receipt: { wallet: W.A, amountUi: "10" } }));
    const url = `https://clucknorris.app/hub/rose/r/${SIG}`;
    const r = run(["--offline", dir, url]);
    assert.strictEqual(r.status, 3, r.out);
    assert.ok(/not implemented yet for kind "buy-comp"/.test(r.out), r.out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
