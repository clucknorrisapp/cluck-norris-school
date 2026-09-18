"use strict";
// Project Hub — roadmap extension E5 ("the receipt teaches"). What must hold:
//   - a settled receipt's walkthrough sums to the receipt's own amount, computed by calling
//     accruedByWallet — the SAME function the ledger itself uses — so it cannot silently drift;
//   - a partial payment (Addendum B paidApplied) is explained as partial, not as paid in full;
//   - missing inputs (no periods, no ledger, no program version, a tampered fixture whose periods
//     do not land on a boundary) produce NO steps and a named reason — never a fabricated one;
//   - no APR/APY/per-year language and no "owed" (the lock-to-earn public-view rule) anywhere the
//     walkthrough can appear, including the rendered page source;
//   - wired into lib/hub/public.js's stakeView, a receipt's `explanation` carries none of the
//     forbidden fields hub-public-test.cjs already guards (no operator secrets) and the numbers
//     match the payout exactly.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const store = require("../lib/hub/store");
const E = require("../lib/hub/explain");
const T = require("../lib/hub/teach");
const pub = require("../lib/hub/public");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");
const project = { id: "alpha", label: "Alpha", symbol: "ALPHA", mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", decimals: 9, rewardMint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", rewardDecimals: 9 };
const programVersion = { projectId: "alpha", version: 1, hash: "deadbeef", terms: { minDurationDays: 90, maxTermDays: 540 } };
const W = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const days3 = {
  "2026-09-17T00": { credits: { [W]: "1000000000" }, distributedRaw: "5000000000", poolRaw: "5000000000" },
  "2026-09-17T01": { credits: { [W]: "1200000000" }, distributedRaw: "6000000000", poolRaw: "6000000000" },
  "2026-09-17T02": { credits: { [W]: "800000000" }, distributedRaw: "4000000000", poolRaw: "4000000000" },
};

section("attributePeriods — read-side replay of the accrual ledger, never a money decision");

t("captures the exact contiguous run of periods whose credits sum to the amount", () => {
  const r = E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "0", amountRaw: "3000000000" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.periods, ["2026-09-17T00", "2026-09-17T01", "2026-09-17T02"]);
});

t("skips periods already consumed by an earlier batch", () => {
  const r = E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "1000000000", amountRaw: "2000000000" });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.periods, ["2026-09-17T01", "2026-09-17T02"]);
});

t("fails closed when the target does not land on a period boundary (never guesses which part of an hour was whose)", () => {
  const r = E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "500000000", amountRaw: "2000000000" });
  assert.strictEqual(r.ok, false);
  assert.ok(/period boundary/.test(r.reason));
});

t("fails closed when the amount overshoots every period it can find", () => {
  const r = E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "0", amountRaw: "999999999999" });
  assert.strictEqual(r.ok, false);
  assert.ok(/ran out of accrual history/.test(r.reason));
});

t("a wallet with no credits, or a zero/negative amount, is refused rather than guessed", () => {
  assert.strictEqual(E.attributePeriods({ days: days3, wallet: "nobody", alreadyConsumedRaw: "0", amountRaw: "1" }).ok, false);
  assert.strictEqual(E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "0", amountRaw: "0" }).ok, false);
  assert.strictEqual(E.attributePeriods({ days: days3, wallet: W, alreadyConsumedRaw: "0", amountRaw: "-5" }).ok, false);
});

section("explainReceipt — settled, matches by construction");

t("every step names a rule, and total is computed by accruedByWallet — it equals the receipt's own amount", () => {
  const receipt = { wallet: W, periods: ["2026-09-17T00", "2026-09-17T01", "2026-09-17T02"], totals: { owedRaw: "3000000000", appliedRaw: "3000000000", excessRaw: "0", remainingRaw: "0", waivedRaw: "0" } };
  const out = E.explainReceipt({ project, programVersion, receipt, ledgerRows: days3 });
  assert.strictEqual(out.missing.length, 0);
  assert.ok(out.steps.length >= 4, "expected at least the four core steps");
  for (const s of out.steps) {
    assert.ok(s.key && s.label && s.rule, JSON.stringify(s));
    assert.ok(s.rule.length > 20, `rule too thin for ${s.key}`);
    assert.ok(s.lesson && s.lesson.id && s.lesson.href.startsWith("/school#lesson="), s.key);
  }
  assert.strictEqual(out.total, "3000000000");
  assert.strictEqual(out.total, receipt.totals.owedRaw, "total must equal receipt.amount");
  assert.strictEqual(out.matchesReceipt, true);
  // no prior-payment step when the row is paid in full
  assert.ok(!out.steps.some((s) => s.key === "prior_payments"));
});

t("a tampered receipt (claims periods it did not draw on) fails matchesReceipt rather than lying", () => {
  const receipt = { wallet: W, periods: ["2026-09-17T00", "2026-09-17T01", "2026-09-17T02"], totals: { owedRaw: "999999999", appliedRaw: "999999999", excessRaw: "0", remainingRaw: "0", waivedRaw: "0" } };
  const out = E.explainReceipt({ project, programVersion, receipt, ledgerRows: days3 });
  assert.strictEqual(out.matchesReceipt, false);
  assert.strictEqual(out.total, "3000000000");   // the derivation itself is honest even though it disagrees with the claim
});

section("explainReceipt — Addendum B paidApplied, a prior partial payment");

t("a row with less applied than owed is explained as partial, with the remainder named", () => {
  const receipt = { wallet: W, periods: ["2026-09-17T00", "2026-09-17T01"], totals: { owedRaw: "2200000000", appliedRaw: "1500000000", excessRaw: "0", remainingRaw: "700000000", waivedRaw: "0" } };
  const out = E.explainReceipt({ project, programVersion, receipt, ledgerRows: days3 });
  assert.strictEqual(out.missing.length, 0);
  const pp = out.steps.find((s) => s.key === "prior_payments");
  assert.ok(pp, "expected a prior_payments step");
  assert.ok(/1\.5/.test(pp.value) && /2\.2/.test(pp.value) && /0\.7/.test(pp.value), pp.value);
  assert.strictEqual(out.total, "2200000000");
  assert.strictEqual(out.matchesReceipt, true);   // the derived total is what was OWED, not what was applied — a partial payment is a fact about settlement, not about accrual
});

t("a waived remainder is named too", () => {
  const receipt = { wallet: W, periods: ["2026-09-17T00"], totals: { owedRaw: "1000000000", appliedRaw: "600000000", excessRaw: "0", remainingRaw: "0", waivedRaw: "400000000" } };
  const out = E.explainReceipt({ project, programVersion, receipt, ledgerRows: days3 });
  const pp = out.steps.find((s) => s.key === "prior_payments");
  assert.ok(pp && /waived/.test(pp.value));
});

section("explainReceipt — missing inputs never produce a fabricated walkthrough");

t("no periods on the receipt → no steps, a named reason", () => {
  const out = E.explainReceipt({ project, programVersion, receipt: { wallet: W, totals: { owedRaw: "1" } }, ledgerRows: days3 });
  assert.deepStrictEqual(out.steps, []);
  assert.ok(out.missing.length > 0);
  assert.strictEqual(out.total, null);
  assert.strictEqual(out.matchesReceipt, false);
});

t("no ledger rows → no steps", () => {
  const out = E.explainReceipt({ project, programVersion, receipt: { wallet: W, periods: ["2026-09-17T00"], totals: { owedRaw: "1" } }, ledgerRows: null });
  assert.deepStrictEqual(out.steps, []);
  assert.ok(out.missing.some((m) => /ledger/.test(m)));
});

t("no program version → no steps", () => {
  const out = E.explainReceipt({ project, programVersion: null, receipt: { wallet: W, periods: ["2026-09-17T00"], totals: { owedRaw: "1" } }, ledgerRows: days3 });
  assert.deepStrictEqual(out.steps, []);
  assert.ok(out.missing.some((m) => /program version/.test(m)));
});

t("a period the receipt names but the ledger no longer holds → no steps", () => {
  const out = E.explainReceipt({ project, programVersion, receipt: { wallet: W, periods: ["2026-09-17T00", "2099-01-01T00"], totals: { owedRaw: "1" } }, ledgerRows: days3 });
  assert.deepStrictEqual(out.steps, []);
  assert.ok(out.missing.some((m) => /no longer in the ledger/.test(m)));
});

t("no project or no receipt at all", () => {
  assert.deepStrictEqual(E.explainReceipt({ project: null, programVersion, receipt: {}, ledgerRows: days3 }).steps, []);
  assert.deepStrictEqual(E.explainReceipt({ project, programVersion, receipt: null, ledgerRows: days3 }).steps, []);
});

section("17-style guard — no APR/APY/per-year language, and never the word 'owed', anywhere this module can emit text");

t("across settled, partial and mixed fixtures, no string this module emits carries rate language or the word owed", () => {
  const fixtures = [];
  const mk = (owedRaw, appliedRaw, periods) => E.explainReceipt({ project, programVersion, receipt: { wallet: W, periods, totals: { owedRaw, appliedRaw, excessRaw: "0", remainingRaw: String(BigInt(owedRaw) - BigInt(appliedRaw)), waivedRaw: "0" } }, ledgerRows: days3 });
  fixtures.push(mk("3000000000", "3000000000", ["2026-09-17T00", "2026-09-17T01", "2026-09-17T02"]));
  fixtures.push(mk("2200000000", "1500000000", ["2026-09-17T00", "2026-09-17T01"]));
  fixtures.push(mk("1000000000", "0", ["2026-09-17T00"]));
  fixtures.push(E.explainReceipt({ project, programVersion, receipt: {}, ledgerRows: null }));   // the missing-input case too
  assert.ok(fixtures.length >= 4);
  for (const out of fixtures) {
    for (const s of E.allText(out)) {
      assert.ok(!T.containsRateLanguage(s), "rate language leaked: " + s);
      assert.ok(!/\bowed\b/i.test(s), "the word 'owed' leaked: " + s);
      assert.ok(!/\b(safe (project|token)|verified project|independently verified|endorsed)\b/i.test(s), "badge language leaked: " + s);
    }
    // the JSON body itself (as it would leave the server) carries none of these either, including
    // as a bare field name (an "owedRaw" key would fail this the same as a sentence would)
    const json = JSON.stringify(out);
    assert.ok(!/owed/i.test(json), "the word 'owed' leaked into the JSON body: " + json);
    assert.ok(!T.RATE_LANGUAGE.test(json), "rate language leaked into the JSON body");
  }
});

section("wired into lib/hub/public.js's stakeView — a real payout, explained from nothing but the stores");

t("on memoryKv, a settled batch's receipt explanation matches the payout exactly", () => {
  const kv = store.memoryKv();
  const proj = require("../lib/hub/project");
  const p = proj.validateProject({ id: "alpha", label: "Alpha", symbol: "ALPHA", mint: project.mint, fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, { decimals: 9, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", extensions: [] });
  const state = proj.createVersion({}, p, { poolDailyRaw: "1000000000", minDurationDays: 90, maxTermDays: 540 }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const days = days3;
  const batches = { b1: { id: "b1", state: "sent", at: 100, count: 1, totalRaw: "3000000000", amounts: { [W]: "3000000000" }, sent: { [W]: { sig: SIG(1), at: 101 } } } };
  const view = pub.stakeView({ days, paid: { [W]: "3000000000" }, batches, decimals: 9, project: p, programState: state });
  const row = view.payouts.find((r) => r.wallet === W);
  assert.ok(row, "expected a receipted row");
  assert.ok(row.explanation, "expected an explanation on the wire");
  assert.strictEqual(row.explanation.matchesReceipt, true);
  assert.strictEqual(row.explanation.total, "3000000000");
  assert.deepStrictEqual(row.explanation.missing, []);
  assert.ok(row.explanation.steps.length >= 4);
  // findReceipt exposes the same object under receipt.explanation
  const pv = pub.projectView({ project: p, stake: view });
  const found = pub.findReceipt(pv, SIG(1));
  assert.ok(found && found.receipt.explanation && found.receipt.explanation.matchesReceipt === true);
});

t("without project/programState (a caller that has not opted in) every row degrades to 'not retained', never a wrong number", () => {
  const days = days3;
  const batches = { b1: { id: "b1", state: "sent", at: 100, count: 1, totalRaw: "3000000000", amounts: { [W]: "3000000000" }, sent: { [W]: { sig: SIG(2), at: 101 } } } };
  const view = pub.stakeView({ days, paid: { [W]: "3000000000" }, batches, decimals: 9 });
  const row = view.payouts.find((r) => r.wallet === W);
  assert.deepStrictEqual(row.explanation.steps, []);
  assert.ok(row.explanation.missing.length > 0);
});

t("two batches, oldest-first: the second receipt's periods pick up exactly where the first left off", () => {
  const proj = require("../lib/hub/project");
  const p = proj.validateProject({ id: "alpha", label: "Alpha", symbol: "ALPHA", mint: project.mint, fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, { decimals: 9, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", extensions: [] });
  const state = proj.createVersion({}, p, { poolDailyRaw: "1000000000", minDurationDays: 90, maxTermDays: 540 }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const batches = {
    b1: { id: "b1", state: "sent", at: 100, count: 1, totalRaw: "1000000000", amounts: { [W]: "1000000000" }, sent: { [W]: { sig: SIG(3), at: 101 } } },
    b2: { id: "b2", state: "sent", at: 200, count: 1, totalRaw: "2000000000", amounts: { [W]: "2000000000" }, sent: { [W]: { sig: SIG(4), at: 201 } } },
  };
  const view = pub.stakeView({ days: days3, paid: { [W]: "3000000000" }, batches, decimals: 9, project: p, programState: state });
  const r1 = view.payouts.find((r) => r.sig === SIG(3)), r2 = view.payouts.find((r) => r.sig === SIG(4));
  assert.deepStrictEqual(r1.explanation.steps.find((s) => s.key === "accrual_window").value.split(" → "), ["2026-09-17T00", "2026-09-17T00"]);
  assert.strictEqual(r1.explanation.total, "1000000000");
  assert.strictEqual(r2.explanation.total, "2000000000");
  // together they cover every period exactly once — nothing double-counted, nothing skipped
  assert.strictEqual(BigInt(r1.explanation.total) + BigInt(r2.explanation.total), 3000000000n);
});

section("no forbidden language reaches the rendered page");

t("public/hub.html carries no APR/APY/per-year pattern and never pairs 'owed' with a wallet", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "hub.html"), "utf8");
  assert.ok(!/\bAPR\b|\bAPY\b/i.test(html), "APR/APY literal found in hub.html");
  assert.ok(!/per[- ]?(year|annum|yr)\b/i.test(html), "per-year language found in hub.html");
  assert.ok(!/%\s*(?:\/|per|a|an)\s*(?:year|yr|annum)\b/i.test(html), "a %/yr pattern found in hub.html");
  assert.ok(/How this number was computed/.test(html), "the E5 receipt block did not land in hub.html");
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
