#!/usr/bin/env node
/* Tests for lib/school-progress.js's graduation-gate ledger. No network, no wallet, no keys.
 *
 * Covers the two Batch B fixes:
 *  1. mark() only counts real curriculum lesson ids (lib/curriculum.js LESSONS), so invented
 *     ids can no longer satisfy the requiredLessons count.
 *  2. prune() evicts sessions with the FEWEST marks first (then oldest), so an sid-flooding
 *     attacker's freshest-but-empty sessions are dropped before a real learner's session that
 *     has actually recorded lesson progress.
 *
 * Run: node scripts/test-school-progress.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-sp-test-"));
process.env.DATA_DIR = DATA_DIR;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

const curriculum = require("../lib/curriculum");
const sp = require("../lib/school-progress");

console.log("\ncurriculum.lessonIds()");
t("returns a non-empty set of real lesson ids", () => {
  const ids = curriculum.lessonIds();
  assert.ok(ids instanceof Set);
  assert.ok(ids.size >= 10, `expected the real curriculum, got ${ids.size} ids`);
  assert.ok(ids.has("lp"), "expected the 'lp' lesson id to be present");
});

console.log("\nmark() rejects invented lesson ids");
t("a real lesson id is accepted", () => {
  const sid = "aaaaaaaa-1111-1111-1111-111111111111";
  assert.strictEqual(sp.mark(sid, "lp"), true);
  const st = sp.statusFor(sid);
  assert.strictEqual(st.lessons, 1);
});
t("an invented id is silently rejected, not counted", () => {
  const sid = "bbbbbbbb-2222-2222-2222-222222222222";
  assert.strictEqual(sp.mark(sid, "zzz-not-a-real-lesson"), false);
  const st = sp.statusFor(sid);
  assert.strictEqual(st, null, "no session should have been created for an all-invented mark");
});
t("12 invented ids no longer satisfy the gate", () => {
  const sid = "cccccccc-3333-3333-3333-333333333333";
  for (let i = 0; i < 12; i++) sp.mark(sid, "fake-lesson-" + i);
  const res = sp.evaluate(sid, "SomeWallet111");
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, "no-progress");
});
t("12 real ids still satisfy the gate (age/spread aside)", () => {
  const ids = Array.from(curriculum.lessonIds()).slice(0, 12);
  assert.strictEqual(ids.length, 12, "test assumes >=12 real lesson ids");
  const sid = "dddddddd-4444-4444-4444-444444444444";
  for (const id of ids) sp.mark(sid, id);
  const st = sp.statusFor(sid);
  assert.strictEqual(st.lessons, 12);
  const res = sp.evaluate(sid, "SomeWallet222", { minAgeMs: 0, minSpreadBuckets: 1 });
  assert.strictEqual(res.ok, true);
});

console.log("\nprune() evicts by value (fewest marks) before recency");
t("a low-mark flood of sids does not evict a real learner's session", () => {
  // Re-require in a fresh module instance so MAX_SIDS-triggering floods in this test
  // don't collide with the sessions created above.
  delete require.cache[require.resolve("../lib/school-progress")];
  const fresh = require("../lib/school-progress");

  const realSid = "eeeeeeee-5555-5555-5555-555555555555";
  const realIds = Array.from(curriculum.lessonIds()).slice(0, 3);
  for (const id of realIds) fresh.mark(realSid, id); // a real learner with recorded progress

  // Flood with fresh, empty (well, single-mark-then-nothing — mark() needs a lesson id to
  // create a session at all, so give each flood sid exactly one real-shaped mark) sids whose
  // lastAt will always be newer than the real learner's.
  const MAX_SIDS = 20000;
  const floodCount = MAX_SIDS + 600; // pushes prune() well past its MAX_SIDS+500 trigger
  for (let i = 0; i < floodCount; i++) {
    const sid = "ffffffff-" + String(i).padStart(4, "0") + "-0000-0000-000000000000";
    fresh.mark(sid, realIds[0]); // one mark each — strictly fewer than the real learner's 3
  }

  const st = fresh.statusFor(realSid);
  assert.ok(st, "the 3-mark real learner session should have survived the flood");
  assert.strictEqual(st.lessons, 3);
});

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(DATA_DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
