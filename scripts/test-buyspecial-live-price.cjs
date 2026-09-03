// Regression test: buyspecial-pro.html's curLamports() must quote exactly what
// /api/tool-gate/config publishes (CLAUDE.md: the amount is live-priced, never
// hardcoded) with no second, page-local floor constant that can drift from the
// server's own SOL_UNLOCK_MIN_LAMPORTS (audit Batch B round 3, r3-public.json).
//
// This extracts the real curLamports() function (and its one fallback constant)
// straight out of public/buyspecial-pro.html and calls it, so the check is
// behaviour, not a source grep.
//
// Run: node scripts/test-buyspecial-live-price.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "buyspecial-pro.html"), "utf8");

function extract(re, label) {
  const m = SRC.match(re);
  if (!m) { console.error(`FAIL: could not find ${label} in buyspecial-pro.html`); process.exit(1); }
  return m[0];
}

const solLamportsLine = extract(/const SOL_LAMPORTS\s*=\s*\d+\s*;/, "SOL_LAMPORTS");
const curLamportsLine = extract(/function curLamports\(\)\s*\{[^}]*\}/, "curLamports()");

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

function curLamportsWith(gateCfgLamports) {
  const fn = new Function(
    "GATE_CFG",
    `${solLamportsLine}\n${curLamportsLine}\nreturn curLamports();`
  );
  const cfg = gateCfgLamports == null ? null : { lamports: gateCfgLamports };
  return fn(cfg);
}

// No live config at all (outage) falls back to the historic 0.05 SOL default.
check("no GATE_CFG falls back to 50_000_000", curLamportsWith(null) === 50_000_000);

// A raised TOOLGATE_LAMPORTS is honored exactly.
check("a raised TOOLGATE_LAMPORTS is honored exactly", curLamportsWith(100_000_000) === 100_000_000);

// A LOWERED TOOLGATE_LAMPORTS must ALSO be honored exactly — this is the behaviour a
// page-local floor constant would have broken (it would have silently overcharged
// instead of tracking the live config down). No such constant exists any more.
check("a lowered TOOLGATE_LAMPORTS is honored exactly (no local floor overrides it)", curLamportsWith(10_000_000) === 10_000_000);

// There must be no second hardcoded copy of the server floor left in the page for a
// future edit to drift out of sync with server.js's SOL_UNLOCK_MIN_LAMPORTS.
check("no leftover SERVER_MIN_LAMPORTS duplicate constant", !/SERVER_MIN_LAMPORTS/.test(SRC));

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll buyspecial live-price checks passed.");
