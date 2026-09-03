#!/usr/bin/env node
/* Dependency-free regression test for scripts/i18n-sweep.js's isTranslated() coverage logic.
 * An identity entry (cur[k] === k) must count as MISSING, not covered — the runtime's
 * public/i18n.js curated() treats v === key as no curated entry and falls through to live
 * MT, so a sweep that counts identity echoes as coverage silently under-reports gaps.
 *
 * Run: node scripts/i18n-sweep-test.cjs
 */
const assert = require("assert");
const { isTranslated } = require("./i18n-sweep.js");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { failures++; console.error(`  FAIL — ${name}: ${e.message}`); }
}

check("a real translation counts as translated", () => {
  const cur = { hello: "hola" };
  assert.strictEqual(isTranslated(cur, "hello"), true);
});

check("an identity echo (value === key) counts as MISSING, not covered", () => {
  const cur = { "Rug Pull": "Rug Pull" };
  assert.strictEqual(isTranslated(cur, "Rug Pull"), false);
});

check("a missing key counts as missing", () => {
  const cur = {};
  assert.strictEqual(isTranslated(cur, "anything"), false);
});

check("an empty-string value counts as missing", () => {
  const cur = { k: "" };
  assert.strictEqual(isTranslated(cur, "k"), false);
});

check("coverage filter over a mixed dict excludes identity entries", () => {
  const ref = { a: 1, b: 1, c: 1 };
  const cur = { a: "translated-a", b: "b", c: "translated-c" }; // b is an identity echo
  const keys = Object.keys(ref);
  const covered = keys.filter((k) => isTranslated(cur, k));
  const missing = keys.filter((k) => !isTranslated(cur, k));
  assert.deepStrictEqual(covered.sort(), ["a", "c"]);
  assert.deepStrictEqual(missing, ["b"]);
});

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll i18n-sweep isTranslated() checks passed.");
