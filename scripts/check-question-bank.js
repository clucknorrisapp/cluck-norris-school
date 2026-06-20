#!/usr/bin/env node
/* Question-bank drift guard.
 *
 * The exam pool (data/question-bank.json) is hand-mirrored from the quizzes in
 * src/App.jsx (LESSONS[].questions → source "CURRICULUM") and
 * src/sections/LPLab.jsx (LP_LESSONS quizzes → source "LPLAB"). They are NOT
 * auto-synced, so a quiz edited in one place but not the other silently drifts:
 * learners study one wording and the exam tests another.
 *
 * This is the CI tripwire. For every CURRICULUM/LPLAB bank question it checks the
 * question TEXT still appears in the matching source file. A miss = the source was
 * reworded/removed without updating the bank (or vice-versa). ULTIMATE questions
 * are exam-only (no source file), so they're skipped.
 *
 * Limitation: it matches on question text only — a changed answer/options under an
 * unchanged question still needs human review. It catches the common case (reworded
 * or deleted questions), which is the drift that's bitten us before.
 *
 * Exit 1 (CI fail) on any drift; exit 0 when clean.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function norm(s) {
  return String(s || "")
    .replace(/\\(.)/g, "$1")               // unescape \" \\ etc.
    .replace(/[‘’']/g, "'")      // curly/straight apostrophes
    .replace(/[“”"]/g, '"')      // curly/straight quotes
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "data/question-bank.json"), "utf8"));
const appSrc = norm(fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8"));
const lpSrc = norm(fs.readFileSync(path.join(ROOT, "src/sections/LPLab.jsx"), "utf8"));

const SOURCE_FILE = { CURRICULUM: appSrc, LPLAB: lpSrc }; // ULTIMATE = exam-only, skipped
const drift = [];
let checked = 0;

for (const q of bank) {
  const hay = SOURCE_FILE[q.source];
  if (!hay) continue;                       // ULTIMATE or unknown source — not source-backed
  checked++;
  if (!hay.includes(norm(q.q))) {
    drift.push(`  [${q.source}] ${q.id}: "${q.q}"`);
  }
}

if (drift.length) {
  console.error(`✗ question-bank drift: ${drift.length}/${checked} source-backed questions no longer match their source file.`);
  console.error("  Mirror the edit between src/App.jsx / src/sections/LPLab.jsx and data/question-bank.json.\n");
  console.error(drift.join("\n"));
  process.exit(1);
}
console.log(`✓ question-bank in sync — ${checked} source-backed questions all present in their source files (${bank.length} total in bank).`);
