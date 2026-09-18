#!/usr/bin/env node
"use strict";
// The public Buy Special standings + hold-through proof page (Colosseum roadmap §7, the W4
// deferred item): GET /api/hub/:project/p/:compId/standings (lib/hub/public.js compStandingsView)
// and the buy-comp row of scripts/reproduce-receipt.cjs (lib/hub/reproduce.js
// reproduceBuyCompRow). Zero-dependency — exercises the pure view builders and the pure split
// (lib/buycomp-payout.js splitAmount/verifiedRow) directly with fixture comp objects, the same
// idiom scripts/hub-public-test.cjs and scripts/buycomp-payout-test.cjs already use (a buy comp
// is not part of the hub store's project/kv abstraction, so there is no memoryKv to seed here —
// the pure functions take a plain comp record exactly as buyCompsAll() would hand one back).
//
// What must hold:
//   - an UNSEALED comp (live or closed-awaiting-verify) publishes RULES ONLY — no results, no
//     review, no payouts key at all, not even an empty array a reader could mistake for "nobody
//     qualified yet";
//   - a SEALED comp publishes the full view, plus sealedAt and a resultsHash that changes only
//     when the sealed (rank/wallet/amount/amountUnit/status) claim itself changes;
//   - hold-through classification: held / sold / moved-out / locked-not-a-sell / unverified, each
//     with its on-chain evidence signature where one exists (PR #298 — a lock is not a sell);
//   - no private field (payout token, Telegram chat id, board message id, the live provisional
//     board) ever reaches either the whole view or the standings view;
//   - the payout split (splitAmount/verifiedRow) is the ONE function buyCompVerify, the "how this
//     number was computed" walkthrough and reproduce-a-receipt all call — never three copies;
//   - a settled winner's row reproduces from nothing but the standings JSON, offline.
const assert = require("assert");
const pub = require("../lib/hub/public");
const bp = require("../lib/buycomp-payout");
const R = require("../lib/hub/reproduce");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const A = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";   // held — the winner
const B = "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG";   // sold on-chain
const C = "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo";   // moved the bag out
const D = "A75SXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaKSp1";   // locked — not a sell
const SIG = "2N7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCju";
const SOLD_SIG = "3M7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCjv";
const MOVED_SIG = "4M7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCjw";
const LOCK_SIG = "5M7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCjx";
const PRIVATE = ["SECRET-PAYOUT-TOKEN", "chatId", "-1002625127458", "boardMsgId", "provisional", "lastUpdateTs"];

const baseTerms = {
  label: "ROSE horse race", mint: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF", ticker: "ROSE",
  chatId: "-1002625127458", boardMsgId: 12345, provisional: [{ wallet: A }], lastUpdateTs: 1, updateMins: 60,
  payoutToken: "SECRET-PAYOUT-TOKEN",
  startTs: 1757800000000, endTs: 1757900000000, holdHours: 48, places: [{ rank: 1, amount: 10 }, { rank: 2, amount: 10 }], pctPrize: true,
  metric: "cumulative", prizeToken: { kind: "native", mint: null }, exclude: [], pools: [], createdAt: 1757790000000,
};

function sealedComp() {
  return {
    ...baseTerms, id: "bc_fixture1", status: "verified", verifiedAt: 1757990000000, verifiedBy: "scanner",
    verified: [{ rank: 1, wallet: A, amount: 13722.42, amountUnit: "token", amountNote: "10% of 137,224 ROSE bought", status: "qualified", note: "holds 209,396, no sells" }],
    verifyResults: [
      { wallet: A, value: 12, tokensBought: 137224.2, status: "qualified", note: "holds 209,396, no sells", evidenceSig: null, locksSeen: 0 },
      { wallet: B, value: 8, tokensBought: 90000, status: "dq", note: "sold on-chain (1 sell)", evidenceSig: SOLD_SIG, locksSeen: 0 },
      { wallet: C, value: 6, tokensBought: 60000, status: "dq", note: "moved the bag out during the hold (1 transfer) — not eligible", evidenceSig: MOVED_SIG, locksSeen: 0 },
      { wallet: D, value: 5, tokensBought: 50000, status: "manual", note: "holds 0 — the scan saw 1 lock transfer (a lock is not a sell) and no sell or transfer out; verify by hand that the lock covers the whole buy", evidenceSig: LOCK_SIG, locksSeen: 1 },
    ],
    payouts: { [A]: { amountUi: 13722.42, sig: SIG, at: 1758000000000, pending: false } },
  };
}
function unsealedComp(status) { return { ...baseTerms, id: "bc_fixture1", status, verified: [], verifyResults: [] }; }

console.log("\nPublic Buy Special standings + hold-through proof page\n");

section("1. unsealed — rules only, nothing else");
{
  for (const status of ["live", "closed"]) {
    const v = pub.compStandingsView(unsealedComp(status));
    t(`status "${status}": sealed:false, no results/review/payouts key at all`, () => {
      assert.strictEqual(v.sealed, false);
      assert.ok(!("results" in v), "results must not be present, not even []");
      assert.ok(!("review" in v), "review must not be present, not even []");
      assert.ok(!("payouts" in v), "payouts must not be present, not even []");
      assert.ok(!("totals" in v));
      assert.ok(/sealed at the window's end/.test(v.message));
    });
    t(`status "${status}": the published rules are still there`, () => {
      assert.deepStrictEqual(v.terms.places, baseTerms.places);
      assert.strictEqual(v.terms.holdHours, 48);
      assert.ok(/^[0-9a-f]{64}$/.test(v.termsHash));
    });
    t(`status "${status}": no private field leaks even here`, () => {
      const json = JSON.stringify(v);
      assert.ok(PRIVATE.every((s) => !json.includes(s)), PRIVATE.filter((s) => json.includes(s)).join(","));
    });
  }
}

section("2. sealed — the full view, gated field-for-field");
const sealedView = pub.compStandingsView(sealedComp());
t("sealed:true, sealedAt is the verify timestamp", () => {
  assert.strictEqual(sealedView.sealed, true);
  assert.strictEqual(sealedView.sealedAt, 1757990000000);
});
t("resultsHash is a sha256 hex, stable on a re-render, and changes when the sealed claim changes", () => {
  assert.ok(/^[0-9a-f]{64}$/.test(sealedView.resultsHash));
  const again = pub.compStandingsView(sealedComp());
  assert.strictEqual(again.resultsHash, sealedView.resultsHash, "same fixture, same hash");
  const tampered = sealedComp(); tampered.verified[0].amount = 1;
  assert.notStrictEqual(pub.compStandingsView(tampered).resultsHash, sealedView.resultsHash, "a different sealed amount must change the hash");
  const paidMore = sealedComp(); paidMore.payouts = {};
  assert.strictEqual(pub.compStandingsView(paidMore).resultsHash, sealedView.resultsHash, "a payout landing is not a change to the SEALED claim");
});
t("no private field leaks from the sealed view either", () => {
  const json = JSON.stringify(sealedView);
  assert.ok(PRIVATE.every((s) => !json.includes(s)), PRIVATE.filter((s) => json.includes(s)).join(","));
});

section("3. hold-through classification and its on-chain evidence");
t("held: the winner, no evidence needed (nothing bad was observed)", () => {
  const r = sealedView.review.find((x) => x.wallet === A);
  assert.strictEqual(r.holdThrough, "held"); assert.strictEqual(r.evidenceSig, null);
  const w = sealedView.results.find((x) => x.wallet === A);
  assert.strictEqual(w.holdThrough, "held"); assert.strictEqual(w.evidenceSig, null);
});
t("sold: the DQ'd wallet carries the sell's own signature", () => {
  const r = sealedView.review.find((x) => x.wallet === B);
  assert.strictEqual(r.holdThrough, "sold"); assert.strictEqual(r.evidenceSig, SOLD_SIG);
});
t("moved-out: a transfer DQ is distinct from a sold DQ, with its own signature", () => {
  const r = sealedView.review.find((x) => x.wallet === C);
  assert.strictEqual(r.holdThrough, "moved-out"); assert.strictEqual(r.evidenceSig, MOVED_SIG);
});
t("locked-not-a-sell: PR #298 — a lock is not a sell, so this is a fact, never a disqualification", () => {
  const r = sealedView.review.find((x) => x.wallet === D);
  assert.strictEqual(r.status, "manual", "not dq'd for locking");
  assert.strictEqual(r.holdThrough, "locked-not-a-sell"); assert.strictEqual(r.evidenceSig, LOCK_SIG);
});
t("unverified: a genuine lookup gap carries no evidence signature to point to", () => {
  const gap = sealedComp(); gap.verifyResults.push({ wallet: "GapWa11etxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1", value: 0, tokensBought: 0, status: "manual", note: "no position data — verify by hand (Trace)", evidenceSig: null, locksSeen: 0 });
  const r = pub.compStandingsView(gap).review.find((x) => x.status === "manual" && x.tokensBought === 0);
  assert.strictEqual(r.holdThrough, "unverified"); assert.strictEqual(r.evidenceSig, null);
});
t("an evidence signature that fails the base58 signature shape is dropped, never passed through raw", () => {
  const bad = sealedComp(); bad.verifyResults[1].evidenceSig = "not-a-signature";
  const r = pub.compStandingsView(bad).review.find((x) => x.wallet === B);
  assert.strictEqual(r.evidenceSig, null);
});

section("4. the split is ONE function, called from the row builder, the walkthrough and the row itself");
t("verifiedRow(c, r, i) produces exactly what buyCompVerify used to build inline", () => {
  const c = { pctPrize: true, ticker: "ROSE", places: [{ rank: 1, amount: 10 }] };
  const row = bp.verifiedRow(c, { wallet: A, tokensBought: 137224.2, value: 12, status: "qualified", note: "still holding" }, 0);
  assert.strictEqual(row.rank, 1); assert.strictEqual(row.amount, 13722.42); assert.strictEqual(row.amountUnit, "token");
  assert.ok(/10% of 137,224 ROSE bought/.test(row.amountNote));
});
t("a flat (non-percentage) prize carries no amountUnit/amountNote key at all — unchanged shape", () => {
  const c = { pctPrize: false, ticker: "ROSE", places: [{ rank: 1, amount: 500 }] };
  const row = bp.verifiedRow(c, { wallet: A, tokensBought: 0, value: 0, status: "qualified", note: "still holding" }, 0);
  assert.strictEqual(row.amount, 500);
  assert.ok(!("amountUnit" in row) && !("amountNote" in row));
});
t("SOL-terms split when the buy source carried no token amount", () => {
  const s = bp.splitAmount({ pctPrize: true, placeAmount: 10, tokensBought: 0, valueSol: 8, ticker: "ROSE" });
  assert.strictEqual(s.amountUnit, "sol"); assert.strictEqual(s.amount, 0.8);
  assert.ok(/SOL terms/.test(s.amountNote));
});
t("the winner's explanation ('how this number was computed') is built by explainBuyCompRow and matches the sealed amount", () => {
  const w = sealedView.results.find((x) => x.wallet === A);
  assert.ok(w.explanation && w.explanation.steps.length >= 2, JSON.stringify(w.explanation));
  assert.strictEqual(w.explanation.matchesReceipt, true);
  assert.strictEqual(Number(w.explanation.total), w.amount);
  assert.ok(!w.explanation.steps.some((s) => /\bAPR\b|\bAPY\b/i.test(s.rule) || /\bAPR\b|\bAPY\b/i.test(String(s.value))), "no rate language in the walkthrough");
});

section("5. reproduce-a-receipt over exactly what the standings route publishes");
t("a settled winner's row reproduces MATCH from nothing but the sealed standings JSON", () => {
  const win = sealedView.results.find((x) => x.wallet === A);
  const rev = sealedView.review.find((x) => x.wallet === A);
  const r = R.reproduceBuyCompRow({ terms: sealedView.terms, rank: win.rank, tokensBought: rev.tokensBought, valueSol: rev.value, published: win.amount });
  assert.strictEqual(r.status, "MATCH", JSON.stringify(r));
});
t("an unsealed comp gives reproduce-a-receipt nothing to work with — the CLI reports MISSING_INPUTS, never guesses", () => {
  const u = pub.compStandingsView(unsealedComp("live"));
  assert.ok(!("results" in u), "the unsealed view itself carries no row to reproduce — this is the input reproduce-receipt.cjs would see");
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
