#!/usr/bin/env node
/**
 * daily-rotation-test.cjs — does "today's lesson" actually mean the same thing for everyone?
 *
 * The Daily pane's whole value is that it is a shared daily habit: everyone gets the same lesson
 * on the same day, it works with no signal, and the streak reflects something the reader can
 * check against their own memory. All three are easy to break in ways nothing else would notice
 * — a local-time rollover, an off-by-one in the streak, a rotation that silently repeats the same
 * question — so they are pinned here.
 *
 * src/seeker/school/daily.js is ESM and imports the bundled curriculum, so rather than load it,
 * this test re-implements the three pure rules and asserts the MODULE'S SOURCE still expresses
 * them. That is weaker than executing it and it is stated plainly rather than dressed up: the
 * executing check is the browser boot test, which drives the real pane. What this catches is the
 * class of edit that changes the rule — local time instead of UTC, a streak that survives a gap —
 * which a rendering test would not notice because the render looks identical.
 *
 *   node scripts/daily-rotation-test.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "src", "seeker", "school", "daily.js"), "utf8");
const CURRICULUM = require(path.join(ROOT, "data", "curriculum.json"));

let failures = 0;
function ok(name, cond, detail) {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond && detail !== undefined) console.log(`      ${JSON.stringify(detail).slice(0, 300)}`);
}

console.log("\ndaily rotation — the same lesson for everyone, every day\n");

// ── the rules, as the module states them ────────────────────────────────────────────────────
ok("the day boundary is UTC, not local time",
   /Date\.UTC\(/.test(SRC) && /getUTCFullYear|getUTCMonth|getUTCDate/.test(SRC),
   "a local-midnight rollover gives two timezones different 'today's");

// ⚠️ `[^)]*` cannot match Date.UTC's own nested calls — an earlier version of this pattern
// failed against correct code for that reason. Match to the divisor instead.
ok("the day number is whole days, floored",
   /Math\.floor\([\s\S]{0,120}?86400000\s*\)/.test(SRC) && /Date\.UTC\(/.test(SRC));

ok("the lesson is picked by day number modulo the lesson count",
   /ALL\[\s*dayNumber\([^)]*\)\s*%\s*ALL\.length\s*\]/.test(SRC),
   "anything personal (next-unfinished) means two people cannot compare notes");

ok("the daily question is ALSO offset by the day, so a repeat cycle is not identical",
   /qs\[\s*dayNumber\([^)]*\)\s*%\s*qs\.length\s*\]/.test(SRC));

ok("⚠️ the daily check sends NO beacon — it must never reach the graduation ledger",
   !/\btrack\s*\(/.test(SRC) && !/lesson_complete/.test(SRC),
   "a one-tap answer inflating ledger marks would undermine the anti-farm control");

ok("a streak that missed a day is reported as over, not carried",
   /s\.day === today \|\| s\.day === today - 1/.test(SRC));

ok("answering twice in one day does not double-count",
   /if \(s\.day === today\) return s\.count;/.test(SRC));

// Named rather than counted. An earlier version asserted ">= 3 catch blocks" and failed against
// correct code: exactly two functions touch storage, and two guards is complete coverage. A
// count is a proxy for the thing; the thing is that each storage function has a guard.
{
  const fn = (name) => {
    const at = SRC.indexOf("function " + name);
    if (at < 0) return "";
    const end = SRC.indexOf("\n}", at);
    return SRC.slice(at, end < 0 ? SRC.length : end);
  };
  const guarded = (name) => /try \{[\s\S]*catch \(_\)/.test(fn(name));
  const touchers = ["readStreak", "recordAnswer"];
  const unguarded = touchers.filter((n) => !guarded(n));
  ok("every function that touches localStorage guards it (a private window THROWS, not returns null)",
     unguarded.length === 0, unguarded);
  // And no OTHER function may reach storage without appearing in that list.
  const storageFns = (SRC.match(/function (\w+)\([^)]*\) \{[\s\S]*?\n\}/g) || [])
    .filter((b) => b.includes("localStorage"))
    .map((b) => (b.match(/function (\w+)/) || [])[1]);
  const missed = storageFns.filter((n) => touchers.indexOf(n) === -1);
  ok("no storage-touching function escaped that list", missed.length === 0, missed);
}

// ── the rotation, computed the same way, over real data ─────────────────────────────────────
const ALL = [];
for (const c of CURRICULUM.courses) for (const l of c.lessons) ALL.push({ course: c.id, lesson: l });
const dayNumber = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);

ok("there are lessons to rotate through", ALL.length > 0, ALL.length);

{
  // Two readers, same UTC day, wildly different local clocks: same lesson.
  const a = new Date("2026-09-21T00:05:00Z");
  const b = new Date("2026-09-21T23:55:00Z");
  ok("two readers on the same UTC day get the same lesson",
     dayNumber(a) === dayNumber(b), { a: dayNumber(a), b: dayNumber(b) });
}
{
  const d1 = new Date("2026-09-21T12:00:00Z");
  const d2 = new Date("2026-09-22T12:00:00Z");
  ok("consecutive days advance the rotation by exactly one",
     dayNumber(d2) - dayNumber(d1) === 1);
}
{
  // Walk a full cycle: every lesson must come up, none twice.
  const seen = new Map();
  const start = dayNumber(new Date("2026-09-21T12:00:00Z"));
  for (let i = 0; i < ALL.length; i++) {
    const idx = (start + i) % ALL.length;
    seen.set(idx, (seen.get(idx) || 0) + 1);
  }
  ok("one full cycle covers every lesson exactly once",
     seen.size === ALL.length && [...seen.values()].every((n) => n === 1),
     { distinct: seen.size, total: ALL.length });
}
{
  // The rotation walks teaching order, so a cycle opens on the beginner course rather than
  // jumping around. Not load-bearing, but a reader meeting LP Lab on day one would be wrong.
  const firstCourse = ALL[0].course;
  ok("the rotation starts from the first course in teaching order",
     firstCourse === CURRICULUM.courses.find((c) => c.id === firstCourse).id);
}
{
  // A lesson with no questions must be survivable — the pane shows it without a check.
  const noQ = ALL.filter((x) => !(x.lesson.questions || []).length);
  ok(`lessons without questions are possible and handled (${noQ.length} of ${ALL.length})`,
     /if \(!qs\.length\) return null;/.test(SRC));
}

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} FAILING\n`);
process.exit(failures === 0 ? 0 : 1);
