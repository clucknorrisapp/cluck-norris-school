#!/usr/bin/env node
"use strict";
// lib/payout-verify — a payout journal row is recorded only when the named transaction actually
// moved the batch's token to the row's wallet for at least the amount owed (deep dive 2026-09-17,
// P1-048 / P1-035: a confirmed-but-unrelated signature used to mark every row paid).
const assert = require("assert");
const V = require("../lib/payout-verify");
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", OTHER = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const A = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv", B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", PAYER = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const bal = (owner, mint, amount) => ({ owner, mint, uiTokenAmount: { amount: String(amount) } });
const tx = ({ err = null, pre = [], post = [] } = {}) => ({ meta: { err, preTokenBalances: pre, postTokenBalances: post } });
// payer sends 3.5 to A and 1 to B in one transaction
const batchTx = tx({ pre: [bal(PAYER, MINT, 10_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 5_500_000_000n), bal(A, MINT, 3_500_000_000n), bal(B, MINT, 1_000_000_000n)] });

t("tokenDeltas: per-owner net delta for the mint, new accounts counted, payer negative", () => {
  const d = V.tokenDeltas(batchTx, MINT);
  assert.strictEqual(d.get(A), 3_500_000_000n); assert.strictEqual(d.get(B), 1_000_000_000n); assert.strictEqual(d.get(PAYER), -4_500_000_000n);
  assert.strictEqual(V.tokenDeltas(batchTx, OTHER).size, 0, "another mint shows nothing");
});
t("rowPaidBy: the exact amount, and up to 0.1% under, is paid", () => {
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: MINT, wallet: A, minRaw: "3500000000" }).ok, true);
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: MINT, wallet: A, minRaw: "3503000000" }).ok, true, "0.086% under the owed amount still settles");
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: MINT, wallet: B, minRaw: "1000000000" }).ok, true, "the second wallet in the same transaction");
});
t("rowPaidBy: a shortfall is refused so an underpaid wallet stays owed", () => {
  const r = V.rowPaidBy(batchTx, { mint: MINT, wallet: A, minRaw: "4000000000" });
  assert.strictEqual(r.ok, false); assert.match(r.why, /smaller than the amount owed/);
});
t("rowPaidBy: a wallet the transaction never paid is refused (the P1-048 case — one sig for every row)", () => {
  const r = V.rowPaidBy(batchTx, { mint: MINT, wallet: PAYER, minRaw: "1" });
  assert.strictEqual(r.ok, false); assert.match(r.why, /reached this wallet/);
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: MINT, wallet: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4", minRaw: "1" }).ok, false);
});
t("rowPaidBy: wrong mint, failed transaction, missing transaction all refuse", () => {
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: OTHER, wallet: A, minRaw: "1" }).ok, false);
  assert.match(V.rowPaidBy(tx({ err: { InstructionError: [0, "Custom"] }, pre: [], post: [bal(A, MINT, 1n)] }), { mint: MINT, wallet: A }).why, /failed on chain/);
  assert.match(V.rowPaidBy(null, { mint: MINT, wallet: A }).why, /not found/);
});
t("rowPaidBy: a transfer that moved the token OUT of the wallet is not a payment", () => {
  const out = tx({ pre: [bal(A, MINT, 5n)], post: [bal(A, MINT, 1n)] });
  assert.strictEqual(V.rowPaidBy(out, { mint: MINT, wallet: A, minRaw: "1" }).ok, false);
});
t("rowPaidBy: no minimum → any positive delta of the mint counts", () => {
  assert.strictEqual(V.rowPaidBy(batchTx, { mint: MINT, wallet: B }).ok, true);
});
console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
