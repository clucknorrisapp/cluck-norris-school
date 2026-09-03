// Regression test: wallet-checkup.html got a pinned, SRI-hashed web3.js bundle, but the three
// pages that actually build and sign transactions — buyspecial-pro.html, hatchery.html and
// airdrop.html — were left on the floating, unpinned /vendor/solana-web3.iife.min.js with no
// integrity attribute (audit Batch B / moneyReview). A swapped vendor bundle on those pages is
// exactly the class of bug CLAUDE.md already records costing three money paths at once.
//
// This test computes the REAL sha384 of the pinned vendor file on disk and checks it against the
// integrity attribute each page actually declares (parsed out of the real <script> tag, not just
// grepped for a filename) — so a hash typo or a reverted pin fails here, not in production.
//
// Run: node scripts/test-pinned-web3-sri.cjs
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PINNED_FILE = path.join(ROOT, "public", "vendor", "solana-web3-1.95.8.iife.min.js");

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

const realHash = "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(PINNED_FILE)).digest("base64");

function findScriptTag(html, srcSubstr) {
  const re = /<script\b[^>]*src="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes(srcSubstr)) return m[0];
  }
  return null;
}

for (const file of ["wallet-checkup.html", "buyspecial-pro.html", "hatchery.html", "airdrop.html"]) {
  const html = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
  const tag = findScriptTag(html, "solana-web3");
  if (!tag) { failures++; console.error(`FAIL: ${file} has no solana-web3 <script> tag`); continue; }
  check(`${file} loads the pinned bundle (solana-web3-1.95.8.iife.min.js), not the floating one`, tag.includes("solana-web3-1.95.8.iife.min.js"));
  const integrityMatch = tag.match(/integrity="([^"]+)"/);
  check(`${file}'s <script> tag declares an integrity attribute`, !!integrityMatch);
  if (integrityMatch) {
    check(`${file}'s integrity hash matches the real sha384 of the pinned file on disk`, integrityMatch[1] === realHash);
  }
  check(`${file}'s <script> tag declares crossorigin (required for SRI to actually be enforced)`, /crossorigin=/.test(tag));
}

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll pinned-web3 SRI checks passed.");
