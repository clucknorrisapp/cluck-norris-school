// Regression test: normie-quest/public/lounge.html carries its OWN small wallet-detector copy
// (the "fourth copy" named in the audit finding alongside WALLET_DEFS and cluck-wallet.js). Its
// window.solana.isPhantom fallback ran with no SafePal check ahead of it, so — same bug class as
// WALLET_DEFS — a SafePal in-app browser (which sets isPhantom on its own window.solana) was
// mislabeled "Phantom" here too.
//
// This extracts the real detect() function out of lounge.html and evaluates it against a
// synthetic `window`, so the fix is checked without a browser.
//
// Run: node normie-quest/test/nq-lounge-safepal-test.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "lounge.html"), "utf8");

const START = "function detect() {";
const startIdx = SRC.indexOf(START);
if (startIdx < 0) { console.error("FAIL: detect() not found in lounge.html"); process.exit(1); }
// detect() is a short, flat function — its closing brace is the first "  }" at the start of a
// line after START (matches the file's 4-space-inside-2-space-indent style).
const endIdx = SRC.indexOf("\n  }", startIdx);
if (endIdx < 0) { console.error("FAIL: could not find the end of detect() in lounge.html"); process.exit(1); }
const fnSrc = SRC.slice(startIdx, endIdx + 4);

// detect() references window.dispatchEvent/CustomEvent (wallet-standard re-announce) and a
// module-level `stdWallets` array — stub both so evaluation doesn't throw for reasons unrelated
// to what this test checks.
function buildDetect(win) {
  const fn = new Function("window", "stdWallets", `
    ${fnSrc}
    return detect;
  `);
  return fn(win, []);
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

// 1. SafePal's in-app browser: one window.solana with isPhantom, isGlow AND isSafePal all true.
// Must resolve to SafePal only, not Phantom.
{
  const win = { solana: { isPhantom: true, isGlow: true, isSafePal: true } };
  const found = buildDetect(win)().map((w) => w.name);
  check("a SafePal impersonation object is labeled 'SafePal'", found.indexOf("SafePal") !== -1);
  check("...and NOT labeled 'Phantom'", found.indexOf("Phantom") === -1);
}

// 2. A dedicated window.safepal.solana object (no window.solana at all) is also recognized.
{
  const win = { safepal: { solana: {} } };
  const found = buildDetect(win)().map((w) => w.name);
  check("a dedicated window.safepal.solana object is labeled 'SafePal'", found.indexOf("SafePal") !== -1);
}

// 3. A genuine Phantom wallet (dedicated namespace, no SafePal flags) is unaffected.
{
  const win = { phantom: { solana: { isPhantom: true } } };
  const found = buildDetect(win)().map((w) => w.name);
  check("a real Phantom wallet still detects as 'Phantom'", found.indexOf("Phantom") !== -1 && found.indexOf("SafePal") === -1);
}

// 4. A genuine Coin98 wallet is now detected.
{
  const win = { coin98: { sol: {} } };
  const found = buildDetect(win)().map((w) => w.name);
  check("a real Coin98 wallet is detected", found.indexOf("Coin98") !== -1);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll lounge.html SafePal checks passed.");
