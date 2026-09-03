// Regression test: /api/verify-sol-payment made its `wallet` query param MANDATORY server-side
// (server.js: "`wallet` is REQUIRED — it binds the redemption to the wallet that actually PAID"
// / `if (!SOL_ADDR_RE.test(wallet)) return res.status(400)...`), but three client callers were
// never updated to send it — public/cluck-gate.js, public/buyspecial-pro.html and
// public/airdrop.html all built the poll URL as `?sig=...&min=...` only. Left unfixed, EVERY
// SOL-unlock payment on all three pages would 400 on every one of its 24 polls: a payer signs
// and sends real SOL and never gets unlocked (audit Batch B / moneyReview).
//
// This test extracts the real `payWith` function out of cluck-gate.js and runs it end-to-end
// against mocked wallet/RPC/fetch stand-ins (no network, no keys), then asserts the ACTUAL URL
// fetch() was called with carries a `wallet=` matching the connected pubkey — exercising the real
// code path rather than grepping the source text for the string "wallet=".
//
// Run: node scripts/test-verify-sol-payment-callers.cjs
"use strict";

const fs = require("fs");
const path = require("path");

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

function extractFunction(src, signatureRe, label) {
  const m = src.match(signatureRe);
  if (!m) { console.error(`FAIL: could not find ${label}`); process.exit(1); }
  const start = m.index;
  const braceStart = src.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ── 1. cluck-gate.js payWith() ──────────────────────────────────────────────
(async () => {
  const gateSrc = fs.readFileSync(path.join(__dirname, "..", "public", "cluck-gate.js"), "utf8");
  const payWithSrc = extractFunction(gateSrc, /async function payWith\(c, btn\)\s*\{/, "payWith() in cluck-gate.js");

  const calls = [];
  const fakeGlobal = {
    fetch: (url) => { calls.push(url); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); },
    CluckUtil: { rpc: async () => ({ value: { blockhash: "fakehash" } }) },
    solanaWeb3: {
      Transaction: function () { this.add = () => {}; },
      PublicKey: function (v) { this.v = v; },
    },
    splToken: { createSolTransferInstruction: () => ({}) },
  };
  const PUBKEY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const state = {
    paying: false,
    provider: { signAndSendTransaction: async () => ({ signature: "fakesig1234567890" }) },
    pubkey: PUBKEY,
  };
  const btn = { disabled: false };
  const c = { lamports: 50000000, days: 7, receiver: "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H" };

  const runner = new Function(
    "global", "fetch", "CluckUtil", "solanaWeb3", "splToken", "state", "say", "grant", "finish", "connect", "ensurePayLibs", "c", "btn",
    `${payWithSrc}\nreturn payWith(c, btn);`
  );
  await runner(
    fakeGlobal, fakeGlobal.fetch, fakeGlobal.CluckUtil, fakeGlobal.solanaWeb3, fakeGlobal.splToken,
    state, () => {}, () => {}, () => {}, () => {}, async () => {}, c, btn
  );

  check("cluck-gate.js payWith() called fetch at least once", calls.length >= 1);
  check(
    "cluck-gate.js payWith() sends wallet=<connected pubkey> on /api/verify-sol-payment",
    calls.length > 0 && calls[0].includes("/api/verify-sol-payment") &&
    calls[0].includes("wallet=" + encodeURIComponent(PUBKEY))
  );
})().then(() => {
  // ── 2 & 3. buyspecial-pro.html / airdrop.html: same shape, verified by direct source
  // extraction of the fetch template (no DOM/browser available to run these standalone pages
  // headlessly here, but the exact string template actually executed is evaluated, not merely
  // grepped for a substring).
  function checkPageSendsWallet(file, fetchLineRe, walletVarName) {
    const src = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    const m = src.match(fetchLineRe);
    if (!m) { failures++; console.error(`FAIL: could not find the verify-sol-payment fetch call in ${file}`); return; }
    const template = m[0];
    // Evaluate the actual URL-building expression the page runs, with a mock wallet var, and
    // check the real output string rather than the source text.
    const urlExprMatch = template.match(/fetch\((.+?)\)\.then/);
    if (!urlExprMatch) { failures++; console.error(`FAIL: could not isolate the fetch() URL expression in ${file}`); return; }
    const fn = new Function(walletVarName, "sig", "lamports", "SOL_LAMPORTS", `return ${urlExprMatch[1]};`);
    const PUBKEY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const url = fn(PUBKEY, "fakesig", 50000000, 50000000);
    check(`${file} builds a verify-sol-payment URL carrying wallet=<connected pubkey>`, url.includes("wallet=" + encodeURIComponent(PUBKEY)) || url.includes("wallet=" + PUBKEY));
  }

  checkPageSendsWallet("buyspecial-pro.html", /fetch\('\/api\/verify-sol-payment\?sig='\+sig\+'&min='\+lamports\+'&wallet='\+encodeURIComponent\(wPubkey\)\)\.then\(r=>r\.json\(\)\)/, "wPubkey");
  checkPageSendsWallet("airdrop.html", /fetch\('\/api\/verify-sol-payment\?sig=' \+ sig \+ '&min=' \+ SOL_LAMPORTS \+ '&wallet=' \+ encodeURIComponent\(wPubkey\)\)\.then\(r => r\.json\(\)\)/, "wPubkey");

  if (failures) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll verify-sol-payment caller checks passed.");
}).catch((e) => {
  console.error("FAIL (unexpected exception):", e.stack || e);
  process.exit(1);
});
