#!/usr/bin/env node
/* Test for the Batch B fix in lib/autopsy.js: isPlatformHeldAuthority() must be decided
 * from the update-authority ADDRESS itself (an exact match against known platform service
 * wallets), never from a vanity mint suffix or an authority-string prefix — both are
 * trivially grindable in seconds, which let a hand-rolled, dev-held-authority token wear
 * the "the team can't unilaterally rebrand" verdict. No network, no keys.
 *
 * Run: node scripts/test-autopsy-platform-held.cjs
 */
const assert = require("assert");
const { isPlatformHeldAuthority } = require("../lib/autopsy");
const { KNOWN_SERVICE_WALLETS } = require("../lib/solana-addr");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

const realBagsLauncher = Object.keys(KNOWN_SERVICE_WALLETS).find((k) => KNOWN_SERVICE_WALLETS[k].toLowerCase().includes("bags"));

console.log("\nisPlatformHeldAuthority()");
t("a known platform service wallet is platform-held", () => {
  assert.ok(realBagsLauncher, "test assumes a Bags entry exists in KNOWN_SERVICE_WALLETS");
  assert.strictEqual(isPlatformHeldAuthority(realBagsLauncher), true);
});
t("a ground vanity address merely STARTING WITH 'BAGS' is NOT platform-held", () => {
  // The bug: `(updateAuthority || "").startsWith("BAGS")` — a 4-char vanity prefix is a
  // seconds-long grind, so this must no longer pass.
  const groundVanity = "BAGSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // starts with BAGS, not the real key
  assert.notStrictEqual(groundVanity, realBagsLauncher);
  assert.strictEqual(isPlatformHeldAuthority(groundVanity), false);
});
t("an arbitrary dev-held authority is not platform-held", () => {
  assert.strictEqual(isPlatformHeldAuthority("SomeRandomDevWalletAddress1111111111111111"), false);
});
t("null/empty authority is not platform-held", () => {
  assert.strictEqual(isPlatformHeldAuthority(null), false);
  assert.strictEqual(isPlatformHeldAuthority(""), false);
  assert.strictEqual(isPlatformHeldAuthority(undefined), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
