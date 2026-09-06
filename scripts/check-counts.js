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
  // Match a literal number sitting next to the label with ANY separator between them.
  // The first version required whitespace (/(\d+)\s+EXAMS/) and so sailed straight past
  // the JSX tuple form `["72","EXAMS"]` on the graduation screen — which meant the same
  // page rendered 70 (derived) and 72 (hardcoded) at the same time, for months.
  [/(\d+)"?\s*,?\s*"?CLASSES/, "CLASSES"],
  [/(\d+)"?\s*,?\s*"?EXAMS/, "EXAMS"],
  [/(\d+)"?\s*,?\s*"?BEGINNER LESSONS/, "BEGINNER LESSONS"],
  [/Finish all (\d+) classes/, "Finish all N classes"],
  // The CTA read "Start the 12-Class Course" three lines above a strapline already rendering
  // LESSONS.length — so adding one lesson would have shown two different totals on one screen.
  [/(\d+)-Class Course/, "N-Class Course"],
]) {
  const m = re.exec(appCode);
  if (m) {
    problems.push(
      `src/App.jsx — "${m[0].trim()}" hardcodes a curriculum count. Render it from ` +
      `LESSONS.length / INCUBATOR_LESSONS.length / QUIZ_QUESTION_COUNT instead, so it cannot drift.`
    );
  }
}

// 3. server.js tells the AI tutor how many lessons the school has. It cannot import App.jsx
//    (JSX, and the school is a separate bundle), so the number is typed by hand there — and
//    nothing could see it drift. A tutor confidently telling learners to "complete all 12
//    lessons" when there are 13 is exactly the quiet-rot failure this guard exists for.
//    Comments are stripped first, for the same reason as the App.jsx scan above.
const serverCode = read("server.js").replace(/^\s*\/\/.*$/gm, "");
for (const m of serverCode.matchAll(/(?:all\s+)?(\d+)\s+lessons\b/gi)) {
  const n = Number(m[1]);
  // Only judge numbers that are plausibly THIS count — the file also talks about the Incubator
  // and the LP Lab, and flagging every "N lessons" in a 15k-line file would make this noisy
  // enough to be ignored, which is worse than not checking.
  if (n === counts.LESSONS || n === counts.INCUBATOR_LESSONS || n === counts.LP_LESSONS) continue;
  problems.push(
    `server.js — "${m[0]}" does not match any curriculum: ${counts.LESSONS} classes, ` +
    `${counts.INCUBATOR_LESSONS} beginner lessons, ${counts.LP_LESSONS} LP Lab lessons. ` +
    `This copy goes to learners through the AI tutor.`
  );
}

// 4. THE i18n DICTIONARIES ARE KEYED BY THE ENGLISH SOURCE STRING. So a rendered string that
//    embeds a curriculum count has its curated translation keyed to THAT count — change the
//    count and the key no longer matches, the curated phrase is bypassed in all six languages,
//    and the machine-translation fallback quietly fills in instead. Not a blank page, but a
//    quality drop nobody would notice, in the exact place CLAUDE.md warns about.
//
//    The landing CTA is the live case: "🏫 Start the 12-Class Course" is a key in es/hi/it/pt/
//    vi/zh.json. Rendering the number from LESSONS.length (which it now does, so the button and
//    the strapline beneath it can never disagree) means adding a lesson silently orphans those
//    six entries. This checks the keys still match, so that becomes a CI failure with
//    instructions rather than a silent regression.
const I18N_DIR = path.join(ROOT, "public", "i18n");
const CTA_KEY = (n) => `🏫 Start the ${n}-Class Course`;
if (fs.existsSync(I18N_DIR)) {
  const expected = CTA_KEY(counts.LESSONS);
  const stale = [];
  for (const f of fs.readdirSync(I18N_DIR)) {
    if (!/^[a-z]{2}\.json$/.test(f)) continue;              // the general dictionary only
    let dict;
    try { dict = JSON.parse(read(path.join("public", "i18n", f))); } catch (_) { continue; }
    const keys = Object.keys(dict).filter((k) => /Start the \d+-Class Course/.test(k));
    if (!keys.length) continue;                             // this language never had the phrase
    if (!keys.includes(expected)) stale.push(`${f} (has "${keys[0]}")`);
  }
  if (stale.length) {
    problems.push(
      `public/i18n — the landing CTA is keyed to the OLD class count. Expected the key ` +
      `"${expected}". Stale: ${stale.join(", ")}. The dictionaries are keyed by the English ` +
      `source string, so these entries no longer match what renders and the curated translation ` +
      `is silently replaced by machine translation. Update the key (and its translation) in each.`
    );
  }
}

// 5. README.md quotes two of these numbers by hand for human readers (the table row for the
//    core course, and the CI section describing the render smoke test's total lesson count).
//    Neither is derived — they're prose — so they rot exactly like the landing-page strings in
//    #2 did. Caught 2026-09-05 audit: README said "12 lessons" / "all 33 lessons" while the
//    real counts were 14 / 35.
const readme = read("README.md");
const totalLessons = counts.LESSONS + counts.INCUBATOR_LESSONS + counts.LP_LESSONS;
const coreCourseMatch = /School of Hard Knocks\*\*\s*\|\s*(\d+) lessons/.exec(readme);
if (!coreCourseMatch) {
  problems.push('README.md — could not find the "School of Hard Knocks" lesson-count row to check.');
} else if (Number(coreCourseMatch[1]) !== counts.LESSONS) {
  problems.push(
    `README.md — the "School of Hard Knocks" row says ${coreCourseMatch[1]} lessons but ` +
    `LESSONS has ${counts.LESSONS}. Update the table row.`
  );
}
const smokeTestMatch = /all (\d+) lessons in headless Chromium/.exec(readme);
if (!smokeTestMatch) {
  problems.push('README.md — could not find the "all N lessons in headless Chromium" sentence to check.');
} else if (Number(smokeTestMatch[1]) !== totalLessons) {
  problems.push(
    `README.md — "all ${smokeTestMatch[1]} lessons in headless Chromium" does not match the ` +
    `real total (${counts.LESSONS} + ${counts.INCUBATOR_LESSONS} + ${counts.LP_LESSONS} = ` +
    `${totalLessons}). Update the sentence.`
  );
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
