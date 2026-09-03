#!/usr/bin/env node
/* Tests for the Batch B store-corruption fixes in lib/kvstore.js and lib/credentials.js.
 * No network, no keys. Each module's load() runs at require-time off process.env.DATA_DIR,
 * so each case gets its own scratch DATA_DIR and a fresh require (cache cleared first).
 *
 * The bug: load() set persistent=true BEFORE parsing an existing file. A corrupt file left
 * persistent true with an EMPTY in-memory state, and the next write (set()/record()) then
 * overwrote the file with just that one new entry — destroying every other key/transcript,
 * with no other copy anywhere for credentials.json. The fix: split reaching-the-volume from
 * parsing; on a parse failure of an EXISTING file, quarantine a copy, disable persistence
 * (fail closed — writes stay in-memory only), and leave the original file untouched.
 *
 * Run: node scripts/test-store-corruption.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "clkn-store-test-")); }

function requireFresh(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

console.log("\nlib/kvstore.js — corrupt file is quarantined, not overwritten");
t("a corrupt app-state.json disables persistence and is left untouched on disk", () => {
  const dir = freshDir();
  const file = path.join(dir, "app-state.json");
  fs.writeFileSync(file, "{not valid json at all");
  process.env.DATA_DIR = dir;
  const kv = requireFresh("../lib/kvstore");

  assert.strictEqual(kv.isPersistent(), false, "must fail closed, not stay persistent on a corrupt file");
  assert.strictEqual(kv.get("anyKey", "fallback"), "fallback", "in-memory state must start empty, not throw");

  kv.set("newKey", 1); // must not throw, and must NOT touch the original corrupt file

  const onDisk = fs.readFileSync(file, "utf8");
  assert.strictEqual(onDisk, "{not valid json at all", "the original corrupt file must be left exactly as found");

  const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith("app-state.json.corrupt-"));
  assert.strictEqual(quarantined.length, 1, "expected exactly one quarantine copy");
});

t("a VALID existing app-state.json still loads and stays persistent (no regression)", () => {
  const dir = freshDir();
  const file = path.join(dir, "app-state.json");
  fs.writeFileSync(file, JSON.stringify({ existingKey: "existingValue" }));
  process.env.DATA_DIR = dir;
  const kv = requireFresh("../lib/kvstore");

  assert.strictEqual(kv.isPersistent(), true);
  assert.strictEqual(kv.get("existingKey"), "existingValue");
  kv.set("newKey", 2);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(onDisk.existingKey, "existingValue", "a legitimate write must preserve prior keys");
  assert.strictEqual(onDisk.newKey, 2);
});

console.log("\nlib/credentials.js — corrupt file is quarantined, not overwritten");
t("a corrupt credentials.json disables persistence and is left untouched on disk", () => {
  const dir = freshDir();
  const file = path.join(dir, "credentials.json");
  fs.writeFileSync(file, "{\"W1\": truncated");
  process.env.DATA_DIR = dir;
  const creds = requireFresh("../lib/credentials");

  assert.strictEqual(creds.isPersistent(), false, "must fail closed, not stay persistent on a corrupt file");
  assert.strictEqual(creds.getByWallet("W1"), null);

  creds.record("W2", { kind: "graduation" }); // must not throw, must NOT touch the original file

  const onDisk = fs.readFileSync(file, "utf8");
  assert.strictEqual(onDisk, "{\"W1\": truncated", "the original corrupt file must be left exactly as found — W1's transcript is not lost on disk");

  const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith("credentials.json.corrupt-"));
  assert.strictEqual(quarantined.length, 1, "expected exactly one quarantine copy");
});

t("a VALID existing credentials.json still loads and a new record preserves it (no regression)", () => {
  const dir = freshDir();
  const file = path.join(dir, "credentials.json");
  fs.writeFileSync(file, JSON.stringify({ W1: { wallet: "W1", slug: "clkn-w1", diploma: { passed: true, pct: 90 } } }));
  process.env.DATA_DIR = dir;
  const creds = requireFresh("../lib/credentials");

  assert.strictEqual(creds.isPersistent(), true);
  assert.ok(creds.getByWallet("W1"));

  creds.record("W2", { kind: "graduation" });
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(onDisk.W1, "W1's transcript must survive a legitimate later write");
  assert.ok(onDisk.W2, "the new transcript must be recorded");
});

console.log("\nlib/kvstore.js — health() surfaces the same degraded state credentials.health() does");
t("a healthy store reports ok:true with no reason", () => {
  const dir = freshDir();
  process.env.DATA_DIR = dir;
  const kv = requireFresh("../lib/kvstore");
  const h = kv.health();
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.persistent, true);
  assert.strictEqual(h.reason, null);
});
t("a corrupt app-state.json makes health() report ok:false, reason 'corrupt'", () => {
  const dir = freshDir();
  const file = path.join(dir, "app-state.json");
  fs.writeFileSync(file, "{not valid json at all");
  process.env.DATA_DIR = dir;
  const kv = requireFresh("../lib/kvstore");
  const h = kv.health();
  assert.strictEqual(h.ok, false, "a corrupt existing file must report unhealthy");
  assert.strictEqual(h.persistent, false);
  assert.strictEqual(h.reason, "corrupt");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
