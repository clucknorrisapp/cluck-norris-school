#!/usr/bin/env node
"use strict";
// adv P1-4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): public/hub.html's renderReceipt() used to
// assume the legacy single-transfer receipt shape unconditionally (`var p = r.program` — undefined
// once findReceipt started serving the Addendum-B3 shape for a journal-backed row) and threw,
// caught by the page's own outer try/catch, rendering an error card instead of the receipt.
//
// This runs the REAL inline script from public/hub.html — extracted verbatim, not reimplemented —
// in a Node vm context with a minimal DOM/fetch stub, against both response shapes findReceipt can
// now return (lib/hub/public.js), and asserts it renders (no thrown-error card) with every value
// the markup reads actually present.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const htmlSrc = fs.readFileSync(path.join(__dirname, "..", "public", "hub.html"), "utf8");
const cluckUtilSrc = fs.readFileSync(path.join(__dirname, "..", "public", "cluck-util.js"), "utf8");

// The main inline script sits right after the cluck-util.js <script src> tag — extract it
// verbatim so a future edit to renderReceipt is what this test actually exercises.
// The main inline script is the first src-less <script> after the cluck-util.js tag (other
// shared modules — hub-sparkline.js, hub-qr.js — may sit between them).
const utilIdx = htmlSrc.indexOf('<script src="/cluck-util.js"></script>');
const MARKER = '<script>';
const startIdx = utilIdx === -1 ? -1 : htmlSrc.indexOf(MARKER, utilIdx);
if (startIdx === -1) throw new Error("could not find the main inline <script> in public/hub.html — has the marker text changed?");
const bodyStart = startIdx + MARKER.length;
const endIdx = htmlSrc.indexOf("</script>", bodyStart);
if (endIdx === -1) throw new Error("unterminated <script> in public/hub.html");
const pageScript = htmlSrc.slice(bodyStart, endIdx);

function makeDom() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, textContent: "", innerHTML: "", value: "", style: { setProperty: () => {} }, addEventListener: () => {} });
    return els.get(id);
  };
  return {
    getElementById: (id) => el(id),
    querySelector: () => ({ style: { setProperty: () => {} } }),
    els,
  };
}

// Runs the real page script against a fetch response, returns the DOM once every microtask the
// script kicked off (the async renderReceipt + its fetch) has settled.
async function runPage({ pathname, apiResponse }) {
  const dom = makeDom();
  let fetchCalls = 0;
  const sandbox = {
    document: dom,
    location: { pathname, search: "" },
    fetch: async () => { fetchCalls++; return { json: async () => apiResponse }; },
    console,
    URLSearchParams,
    setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(cluckUtilSrc, sandbox, { filename: "cluck-util.js" });
  vm.runInContext(pageScript, sandbox, { filename: "hub.html inline script" });
  // Flush the microtask queue a few times — the page's IIFE is `async`, awaits `fetch`, and the
  // fetch mock itself resolves via a real Promise; a couple of ticks is enough for both awaits.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { dom, fetchCalls };
}

const W_A = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const SIG_A = "5" + "a".repeat(87);
const SIG_B = "5" + "b".repeat(87);
const TERMS_HASH = "f".repeat(64);

section("public/hub.html renderReceipt — both shapes findReceipt can return");

t("legacy shape (buy-comp / draw / giveaway / pre-journal lock-to-earn row) renders with no error card", async () => {
  const apiResponse = {
    ok: true, projectId: "alpha", symbol: "ALPHA", dryRun: false, brand: null,
    program: { kind: "buy-comp", id: "comp1", label: "September Comp", ticker: "ALPHA", mint: "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", prizeMint: "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", termsHash: TERMS_HASH },
    receipt: { wallet: W_A, amountUi: 12.5, sig: SIG_A, at: 1_758_000_000_000, state: "settled", confirmedAt: 1_758_000_000_000 },
  };
  const { dom, fetchCalls } = await runPage({ pathname: "/hub/alpha/r/" + SIG_A, apiResponse });
  assert.strictEqual(fetchCalls, 1);
  const html = dom.els.get("app").innerHTML;
  assert.ok(html, "the app div was actually filled in");
  assert.ok(!/class="err"/.test(html), "no error card: " + html.slice(0, 300));
  assert.ok(html.includes(SIG_A), "the transaction signature is on the page");
  assert.ok(html.includes(W_A.slice(0, 5)), "the recipient wallet (shortened) is on the page");
  assert.ok(html.includes("12.5"), "the legacy amountUi is on the page");
});

t("Addendum-B3 (journal-backed) shape renders with no error card — the exact bug this closes", async () => {
  const apiResponse = {
    ok: true, projectId: "delta", symbol: "DELTA", dryRun: false, brand: null,
    program: { kind: "lock-to-earn", id: "lock-to-earn", label: "Lock to Earn", ticker: "DELTA", mint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", prizeMint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", termsHash: TERMS_HASH },
    receipt: {
      $schema: "https://clucknorris.app/hub/schema/receipt.json",
      projectId: "delta", batchId: "hb_1", programVersion: 1, programHash: TERMS_HASH,
      rewardMint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", rewardDecimals: 9, periods: ["2026-09-17T00"],
      wallet: W_A, state: "paid",
      totals: { owedRaw: "1000000000", appliedRaw: "1000000000", excessRaw: "0", remainingRaw: "0", waivedRaw: "0" },
      settlements: [{ xferKey: "settle:" + SIG_A + ":0", sig: SIG_A, instructionIndex: 0, innerIndex: null, slot: 1, at: 1_758_000_000, amountRaw: "1000000000", appliedRaw: "1000000000", excessRaw: "0", verifiedBy: "getTransaction" }],
      claims: { paymentVerified: true, calculationReproducible: null },
      fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    },
  };
  const { dom, fetchCalls } = await runPage({ pathname: "/hub/delta/r/" + SIG_A, apiResponse });
  assert.strictEqual(fetchCalls, 1);
  const html = dom.els.get("app").innerHTML;
  assert.ok(html, "the app div was actually filled in");
  assert.ok(!/class="err"/.test(html), "no error card — this is the exact TypeError the finding reported: " + html.slice(0, 400));
  assert.ok(html.includes(SIG_A), "the settlement's transaction signature is on the page");
  assert.ok(html.includes(W_A.slice(0, 5)), "the recipient wallet (shortened) is on the page");
  assert.ok(html.includes("paid"), "the row's own state is shown");
  assert.ok(html.includes("1") && !html.includes("NaN"), "the converted amount rendered a real number, not NaN");
});

t("a MULTI-settlement B3 receipt (40 + 40 + 20) lists every settlement and totals the applied amount", async () => {
  const mkS = (sig, amt, at) => ({ xferKey: "settle:" + sig + ":0", sig, instructionIndex: 0, innerIndex: null, slot: 1, at, amountRaw: amt, appliedRaw: amt, excessRaw: "0", verifiedBy: "getTransaction" });
  const apiResponse = {
    ok: true, projectId: "delta", symbol: "DELTA", dryRun: false, brand: null,
    program: { kind: "lock-to-earn", id: "lock-to-earn", label: "Lock to Earn", ticker: "DELTA", mint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", prizeMint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", termsHash: TERMS_HASH },
    receipt: {
      projectId: "delta", batchId: "hb_1", programVersion: 1, programHash: TERMS_HASH,
      rewardMint: "MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", rewardDecimals: 9, periods: [],
      wallet: W_A, state: "paid",
      totals: { owedRaw: "100000000000", appliedRaw: "100000000000", excessRaw: "0", remainingRaw: "0", waivedRaw: "0" },
      settlements: [mkS(SIG_A, "40000000000", 1_758_000_000), mkS(SIG_B, "40000000000", 1_758_000_100), mkS("5" + "c".repeat(87), "20000000000", 1_758_000_200)],
      claims: { paymentVerified: true, calculationReproducible: null }, fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    },
  };
  const { dom } = await runPage({ pathname: "/hub/delta/r/" + SIG_A, apiResponse });
  const html = dom.els.get("app").innerHTML;
  assert.ok(!/class="err"/.test(html), html.slice(0, 400));
  assert.ok(html.includes("Every settlement (3)"), "lists all three settlements");
  assert.ok(html.includes(SIG_A) && html.includes(SIG_B), "both earlier settlements are linked, not just the last");
  assert.ok(html.includes("100"), "the top tile shows the row's TOTAL (100), not any single settlement's amount");
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 8).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
