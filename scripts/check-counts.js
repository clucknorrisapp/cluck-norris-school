#!/usr/bin/env node
// Curriculum count-drift guard.
//
// WHY: the landing page advertised "12 CLASSES • 72 EXAMS" and "6 BEGINNER LESSONS" while the
// real curriculum held 70 questions and 7 beginner lessons. Nothing was wrong with the code —
// the numbers were just typed by hand once and never revisited, so they rotted quietly on the
// most-read page on the site. Most of those are now derived at render; this guard covers the
// two things a render cannot: a hand-maintained mirror in another file, and a regression back
// to hardcoding.
//
// Deliberately narrow. It only fails on things that are definitely wrong, so it stays trustworthy.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Pull `const NAME = [ ... ]` and count the objects in it.
function arrayBlock(src, name) {
  const i = src.search(new RegExp("^const " + name + " = \\[", "m"));
  if (i < 0) return null;
  const after = src.slice(i + name.length);
  const end = after.search(/\n(const|function) [A-Z]/);
  return end < 0 ? after : after.slice(0, end);
}
function countLessons(src, name) {
  const b = arrayBlock(src, name);
  if (b == null) throw new Error(`could not locate ${name}`);
  // Lesson ids are strings in App.jsx ("lp") and numbers in LPLab.jsx (1).
  const n = (b.match(/^ {4}id:\s*(?:"[^"]+"|\d+)/gm) || []).length;
  if (!n) throw new Error(`parsed zero lessons from ${name}`);
  return n;
}

const app = read("src/App.jsx");
const lpLab = read("src/sections/LPLab.jsx");
const shared = read("src/shared.jsx");

const counts = {
  LESSONS: countLessons(app, "LESSONS"),
  INCUBATOR_LESSONS: countLessons(app, "INCUBATOR_LESSONS"),
  LP_LESSONS: countLessons(lpLab, "LP_LESSONS"),
};

const problems = [];

// 1. LP_LESSONS_COUNT lives in shared.jsx because App.jsx cannot see the lazily-loaded LP Lab
//    module. That makes it the one number still mirrored by hand — so check it every build.
const declared = /export const LP_LESSONS_COUNT\s*=\s*(\d+)/.exec(shared);
if (!declared) {
  problems.push("src/shared.jsx — LP_LESSONS_COUNT not found (the progress tracker needs it)");
} else if (Number(declared[1]) !== counts.LP_LESSONS) {
  problems.push(
    `src/shared.jsx — LP_LESSONS_COUNT is ${declared[1]} but LP_LESSONS has ${counts.LP_LESSONS} lessons. ` +
    `Update the constant (it drives the LP Lab progress readout).`
  );
}

// 2. Catch a regression to a hardcoded headline. These strings are rendered from derived values
//    now; a bare digit in front of them means someone typed a number in again.
//    Scan CODE ONLY — the comment explaining this fix quotes the old wrong strings verbatim,
//    and an un-stripped scan flags that comment as if it were the bug.
const appCode = app.replace(/^\s*\/\/.*$/gm, "");
for (const [re, what] of [
  [/>\s*(\d+)\s+CLASSES/, "CLASSES"],
  [/(\d+)\s+EXAMS/, "EXAMS"],
  [/(\d+)\s+BEGINNER LESSONS/, "BEGINNER LESSONS"],
  [/Finish all (\d+) classes/, "Finish all N classes"],
]) {
  const m = re.exec(appCode);
  if (m) {
    problems.push(
      `src/App.jsx — "${m[0].trim()}" hardcodes a curriculum count. Render it from ` +
      `LESSONS.length / INCUBATOR_LESSONS.length / QUIZ_QUESTION_COUNT instead, so it cannot drift.`
    );
  }
}

if (problems.length) {
  console.error("✗ curriculum count drift:");
  for (const p of problems) console.error("   • " + p);
  console.error("\nThese numbers are public-facing copy on the landing page. Wrong ones are a\n" +
    "credibility problem on a grant/hackathon entry, and nothing else in CI can see them.");
  process.exit(1);
}

console.log(
  `✓ curriculum counts consistent — ${counts.LESSONS} classes, ${counts.INCUBATOR_LESSONS} beginner ` +
  `lessons, ${counts.LP_LESSONS} LP Lab lessons; all public counts derived at render`
);
