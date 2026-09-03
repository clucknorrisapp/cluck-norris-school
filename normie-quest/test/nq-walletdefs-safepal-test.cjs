// Regression test: the game's own wallet registry (WALLET_DEFS in game_logic.js) had drifted
// from public/cluck-wallet.js — missing the SafePal-first entry and Coin98 (audit Batch B).
//
// SafePal's in-app browser injects one window.solana object that ALSO sets other wallets'
// compat flags (isPhantom, isGlow) so Phantom-only dapps still work. Without a dedicated SafePal
// detector checked BEFORE phantom/glow, a SafePal user was shown as "Phantom" AND "Glow" in the
// game's wallet picker (two wrong wallets for one real one) — a bug already fixed once in
// public/cluck-wallet.js but never ported into the game's hand-copied table.
//
// This test extracts the real WALLET_DEFS array literal out of normie-quest/src/game_logic.js (a
// browser-only file that is not standalone-parseable JS as a whole — see the "NOT
// normie-quest/src/*.js" note in .github/workflows/syntax-check.yml) and evaluates it against a
// synthetic `window`, so identity confusion is caught without booting a real browser or wallet.
//
// Run: node normie-quest/test/nq-walletdefs-safepal-test.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "game_logic.js"), "utf8");

const START = "var WALLET_DEFS = [";
const startIdx = SRC.indexOf(START);
if (startIdx < 0) { console.error("FAIL: WALLET_DEFS not found in game_logic.js"); process.exit(1); }
const endIdx = SRC.indexOf("];", startIdx);
if (endIdx < 0) { console.error("FAIL: could not find the end of the WALLET_DEFS array"); process.exit(1); }
const arrayLiteral = SRC.slice(startIdx, endIdx + 2); // include the trailing "];"

function buildDefs(win) {
  // `window` is referenced free-standing inside each detect() closure in the real source, exactly
  // as it would be in a browser. Evaluate with a real local named `window` in scope.
  const fn = new Function("window", `${arrayLiteral}\nreturn WALLET_DEFS;`);
  return fn(win);
}

function detectAll(defs, win) {
  const found = [];
  const seen = [];
  for (const d of defs) {
    let p = null;
    try { p = d.detect(); } catch (e) {}
    if (p && seen.indexOf(p) < 0) { seen.push(p); found.push(d.id); }
  }
  return found;
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

// 1. SafePal must be the FIRST entry (order matters: it must be checked before phantom/glow,
// which it impersonates).
{
  const defs = buildDefs({});
  check("WALLET_DEFS carries a 'safepal' entry", defs.some((d) => d.id === "safepal"));
  check("safepal is the FIRST entry (must run before phantom/glow)", defs[0] && defs[0].id === "safepal");
  check("WALLET_DEFS carries a 'coin98' entry", defs.some((d) => d.id === "coin98"));
}

// 2. The actual impersonation bug: SafePal's in-app browser sets ONE window.solana object with
// isPhantom, isGlow AND isSafePal all true. Before the fix this showed as "Phantom" + "Glow" (two
// wallets, both wrong). With SafePal detected and de-duped first, only 'safepal' should appear.
{
  const solana = { isPhantom: true, isGlow: true, isSafePal: true };
  const win = { solana };
  const defs = buildDefs(win);
  const found = detectAll(defs, win);
  check("a SafePal impersonation object resolves to ONLY 'safepal'", found.length === 1 && found[0] === "safepal");
  check("...specifically NOT also matched as phantom", found.indexOf("phantom") === -1);
  check("...specifically NOT also matched as glow", found.indexOf("glow") === -1);
}

// 3. A genuine Phantom wallet (no SafePal flags at all) is unaffected by the new entry.
{
  const win = { solana: { isPhantom: true } };
  const defs = buildDefs(win);
  const found = detectAll(defs, win);
  check("a real Phantom wallet still detects as 'phantom' only", found.length === 1 && found[0] === "phantom");
}

// 4. A genuine Coin98 wallet is now detected (previously invisible to the game's picker).
{
  const win = { coin98: { sol: {} } };
  const defs = buildDefs(win);
  const found = detectAll(defs, win);
  check("a real Coin98 wallet is detected", found.indexOf("coin98") !== -1);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll WALLET_DEFS / SafePal checks passed.");
