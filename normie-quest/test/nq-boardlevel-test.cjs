// Regression test: game-over inside a hidden/private room must not corrupt the leaderboard
// (audit Batch B).
//
// Before this fix, Over.create always submitted `window.NQLB.worldOf(this.level)`, where
// `this.level` was the level NAME the player died on. worldOf() returns 0 for any non-numeric
// name, so EVERY speakeasy/bonus room (VAULT, TRENCHES, ...) and every private room (MYSPACE,
// SCARY, BEACH, ...) submitted as world 0 — dropping a legitimate main-run death off every
// per-world board (world filters are `world >= w`, w >= 1) while a private-room death still
// reached the public weekly/all-time board (Win.create already guarded private rooms; Over did
// not).
//
// The fix computes a `boardLevel` in Game.gameOver(): null for a private room (Over then skips
// submission entirely, mirroring Win's `!this.private` guard), or the FURTHEST NUMBERED campaign
// world reached (via `effIdx`, the same value already used for the checkpoint logic) for a
// non-private hidden bonus/speakeasy room, instead of that room's own non-numeric name.
//
// This test extracts the actual `boardLevel` computation verbatim out of
// normie-quest/src/game_logic.js (a browser-only file that is not standalone-parseable JS — see
// the "NOT normie-quest/src/*.js" note in .github/workflows/syntax-check.yml) and evaluates it
// against synthetic scene state, so a regression in the real source is caught without booting a
// browser.
//
// Run: node normie-quest/test/nq-boardlevel-test.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "game_logic.js"), "utf8");

const START = "var boardLevel = null;";
const END = "this.time.delayedCall(600,function(){ this.scene.start('Over'";
const startIdx = SRC.indexOf(START);
const endIdx = SRC.indexOf(END, startIdx);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error("FAIL: could not locate the boardLevel computation block in game_logic.js — has it moved or been rewritten?");
  process.exit(1);
}
const snippet = SRC.slice(startIdx, endIdx);

// Sanity: the extracted snippet must actually be the block we think it is (both branches present).
if (!/def\s*&&\s*this\.def\.private/.test(snippet) || !/def\s*&&\s*this\.def\.hidden/.test(snippet)) {
  console.error("FAIL: extracted snippet is missing an expected branch — game_logic.js may have changed shape");
  process.exit(1);
}

function computeBoardLevel(def, effIdx, LEVELS) {
  const fn = new Function("LEVELS", "effIdx", `
    return (function () {
      ${snippet}
      return boardLevel;
    }).call({ def: ${JSON.stringify(def)} });
  `);
  return fn(LEVELS, effIdx);
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

// 1. A PRIVATE room (e.g. dying inside MYSPACE/SCARY/BEACH) must resolve to null — Over then
// skips the leaderboard submission entirely.
{
  const LEVELS = [{ name: "3-1" }, { name: "MYSPACE" }];
  const bl = computeBoardLevel({ name: "MYSPACE", hidden: true, private: true }, 1, LEVELS);
  check("a private room's boardLevel is null (never touches the board)", bl === null);
}

// 2. A non-private HIDDEN speakeasy room (e.g. VAULT, entered via an in-campaign duck-warp from
// world 3-2) must resolve to the campaign level's NUMERIC name via effIdx — not the room's own
// non-numeric name, and not world 0.
{
  const LEVELS = [];
  LEVELS[5] = { name: "3-2" };
  LEVELS[27] = { name: "VAULT", hidden: true };
  const bl = computeBoardLevel({ name: "VAULT", hidden: true }, 5, LEVELS);
  check("a hidden (non-private) speakeasy room credits the furthest numbered world reached", bl === "3-2");
  check("...and specifically NOT the room's own non-numeric name", bl !== "VAULT");
}

// 3. An ordinary numbered campaign level is unaffected — reports its own (already numeric) name.
{
  const LEVELS = [{ name: "2-3" }];
  const bl = computeBoardLevel({ name: "2-3" }, 0, LEVELS);
  check("an ordinary campaign level still reports its own name", bl === "2-3");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll boardLevel checks passed.");
