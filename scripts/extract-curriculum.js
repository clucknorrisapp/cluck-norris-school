// Extract the school's curriculum content into data/curriculum.json so the server-side Live
// Classroom teaches the REAL lesson material (intros, concepts, prose, quiz Q&A) — not just quiz
// explanations. Re-run after editing lessons:
//   node scripts/extract-curriculum.js
//   node scripts/extract-curriculum.js --check   (exit non-zero if the committed file is stale)
//
// HOW THIS WORKS (rewritten 2026-09-18 — see docs/COLOSSEUM_ROADMAP.md §12 BB1):
// The old version string-sliced each named array out of src/App.jsx with a hand-rolled
// bracket/quote scanner and `eval`'d the slice. It only ever looked at App.jsx, so when the LP
// Lab and Deep Dive lessons moved into src/sections/LPLab.jsx and src/sections/Library.jsx (as
// part of the lazy-loaded section split), a re-run silently dropped both courses — nobody
// noticed because the script "succeeded". The scanner was also not comment-safe: a `//` comment
// containing an apostrophe (or an unpaired quote) desynced its quote-tracking and corrupted the
// slice (real incident, 2026-09-18).
//
// Rather than patch the scanner to be comment-safe (still fragile — JSX text, template literals,
// and regex literals all have their own quoting rules a hand scanner has to special-case), this
// loads each source file as real code: esbuild bundles it (resolving its actual relative imports
// and compiling JSX) to a self-contained CommonJS blob, we append a marker line that copies the
// named top-level `const` arrays onto `globalThis` (they're plain data — a chosen course's array
// literal never depends on component render logic), and execute that with a real `require` so
// `react/jsx-runtime` resolves for real. `import.meta.env.VITE_STORE_EDITION` is defined to `""`
// (the website edition, not the app-store bundle) so STORE-gated ternaries in the lesson prose
// resolve to the richer website copy, matching what the Live Classroom actually teaches from.
// This is robust to comments, template literals, JSX, and str-concatenation the old scanner could
// never survive, because it's not scanning text — it's running the real module.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ESBUILD = path.join(ROOT, "node_modules", ".bin", "esbuild");
const OUT_PATH = path.join(ROOT, "data", "curriculum.json");

// Runs `relFile` (a real source file, e.g. "src/App.jsx") through esbuild and returns the named
// top-level `const` values as an object. Fails loudly (throws) rather than returning partial data
// — a course silently going missing is exactly the bug this rewrite exists to stop.
// `edition` is what `import.meta.env.VITE_STORE_EDITION` folds to while the lesson modules run:
// "" for the website copy, "google" for the education-only store copy (the STORE branches in
// src/App.jsx and src/sections/Library.jsx resolve the other way — no venue names, no CLKN mint,
// worked examples that do not name the token). Same modules, same extractor, two outputs.
function extractVars(relFile, varNames, edition) {
  const abs = path.join(ROOT, relFile);
  const dir = path.dirname(abs);
  const orig = fs.readFileSync(abs, "utf8");
  const marker =
    "\n;globalThis.__CURRICULUM_EXTRACT__ = {" +
    varNames.map((v) => `${JSON.stringify(v)}: (typeof ${v} !== "undefined" ? ${v} : undefined)`).join(",") +
    "};\n";
  const tmpPath = path.join(dir, ".__extract_tmp_" + path.basename(abs));
  fs.writeFileSync(tmpPath, orig + marker);
  let bundled;
  try {
    bundled = execFileSync(ESBUILD, [
      tmpPath,
      "--bundle",
      "--format=cjs",
      "--platform=node",
      "--jsx=automatic",
      // The website edition, not the app-store bundle — see the header comment.
      `--define:import.meta.env.VITE_STORE_EDITION=${JSON.stringify(edition || "")}`,
      "--log-level=warning",
    ], { cwd: dir, maxBuffer: 1024 * 1024 * 64 }).toString();
  } finally {
    fs.unlinkSync(tmpPath);
  }
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", "global", "globalThis", bundled);
  const prevGlobal = global.__CURRICULUM_EXTRACT__;
  global.__CURRICULUM_EXTRACT__ = undefined;
  fn(mod, mod.exports, require, global, global);
  const result = global.__CURRICULUM_EXTRACT__;
  global.__CURRICULUM_EXTRACT__ = prevGlobal;
  if (!result) throw new Error(`[extract] ${relFile}: esbuild produced no output`);
  for (const v of varNames) {
    if (result[v] === undefined) throw new Error(`[extract] ${relFile}: "${v}" not found — did it get renamed or moved?`);
  }
  return result;
}

// ⚠️ TWO CONSUMERS, TWO SHAPES, ONE OBJECT.
//
// `q` / `answer` / `why` is what the AI classroom and the tutor read (server.js) — a flat Q&A
// grounding, never a quiz. `options` / `correct` / `explanation` is the QUIZ, and it is carried
// through verbatim so a client can actually render one.
//
// The quiz fields were dropped here originally, and on 2026-09-21 the Seeker school was built on
// this file assuming it carried them: every one of the 200 questions rendered with NO ANSWER
// BUTTONS, so no lesson could be finished. Found by Codex on PR #390, not by any test — the
// browser test mounted the pane and never tapped an answer.
//
// Exposure note: this adds nothing new. `answer` already carried the correct option's TEXT, so
// the key was always here. This file is required server-side (server.js ~77) and is not served.
function mapQuestions(qs) {
  return (qs || []).map((q) => ({
    q: q.q,
    answer: (q.options || [])[q.correct],
    why: q.explanation || "",
    // The quiz, for clients that render one.
    options: Array.isArray(q.options) ? q.options.slice() : [],
    correct: Number.isInteger(q.correct) ? q.correct : null,
    explanation: q.explanation || "",
  }));
}

// Build the whole curriculum object for one edition. Called twice: "" → data/curriculum.json
// (the AI classroom's grounding and the website/Seeker school), "google" → data/curriculum.store.json
// (the Google Play / iOS school — store-edition v1.1.0, 2026-09-21). One function so the two files
// can never drift in SHAPE; only the STORE-branched copy differs.
function buildCurriculum(edition) {
const out = { generatedAt: new Date().toISOString(), courses: [] };

// 1) Core curriculum (belts) — concepts + questions. Source: src/App.jsx `LESSONS`.
const { LESSONS, INCUBATOR_LESSONS } = extractVars("src/App.jsx", ["LESSONS", "INCUBATOR_LESSONS"], edition);
out.courses.push({
  id: "fundamentals", title: "Crypto Fundamentals", icon: "📚",
  blurb: "Wallets, tokens, DEXs, rugs, market cap, on-chain basics — the bedrock every survivor needs.",
  lessons: LESSONS.map((l) => ({
    id: String(l.id), title: l.title, icon: l.icon || "📘", belt: l.belt || null,
    intro: l.intro || "",
    concepts: (l.concepts || []).map((c) => ({ term: c.term, def: c.def })),
    questions: mapQuestions(l.questions),
  })),
});

// 2) Beginner incubator lessons (What is a Wallet, Token, DEX, …). Source: src/App.jsx
//    `INCUBATOR_LESSONS`.
out.courses.push({
  id: "basics", title: "Crypto 101 (Absolute Basics)", icon: "🐣",
  blurb: "Brand new? Start here — wallets, tokens, on-ramps, what a DEX even is, staying safe.",
  lessons: INCUBATOR_LESSONS.map((l) => ({
    id: String(l.id || (l.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")), title: l.title, icon: l.icon || "🐣",
    intro: l.summary || l.intro || "",
    concepts: (l.concepts || []).map((c) => ({ term: c.term, def: c.def })),
    content: l.content || "",
    questions: mapQuestions(l.questions),
  })),
});

// 3) LP Lab structured lessons (sections + quiz). Source: src/sections/LPLab.jsx `LP_LESSONS`.
//    The quiz moved from per-section (`section.quiz`) to per-lesson (`lesson.quiz`) since the old
//    extractor was written — mapped here into `questions` at the lesson level (the same field
//    `lessonMaterial()` in server.js already reads for the other courses) so the comprehension
//    answer key keeps reaching the classroom.
const { LP_LESSONS } = extractVars("src/sections/LPLab.jsx", ["LP_LESSONS"], edition);
const lpCourse = {
  id: "lp", title: "Liquidity & LP Mastery", icon: "💧",
  blurb: "AMMs, impermanent loss, concentrated liquidity, fees & LP earnings — the real money mechanics.",
  lessons: LP_LESSONS.map((l) => ({
    id: String(l.id), title: l.title, icon: l.icon || "💧", tagline: l.tagline || "",
    intro: l.tagline || "",
    sections: (l.sections || []).map((s) => ({
      heading: s.heading || s.title || "",
      body: s.body || s.content || "",
    })),
    questions: mapQuestions(l.quiz),
    cluckVerdict: l.cluckVerdict || "",
  })),
};
out.courses.push(lpCourse);

// 4) Liquidity library (short reference prose) — folded into the LP course as extra reference
//    lessons, same as the pre-move extractor did with `LIBRARY_LIQUIDITY`. Source: now
//    src/sections/Library.jsx (moved out of App.jsx with the rest of the Library section).
const { LIBRARY_TOPICS, LIBRARY_LIQUIDITY } = extractVars("src/sections/Library.jsx", ["LIBRARY_TOPICS", "LIBRARY_LIQUIDITY"], edition);
for (const t of LIBRARY_LIQUIDITY) {
  lpCourse.lessons.push({ id: "lib-" + t.id, title: t.title, icon: t.icon || "📖", intro: t.summary || "", content: t.content || "", reference: true });
}

// 5) Deep-dive library topics (Research a Token, Reading Solscan, Tax, Psychology, …). Source:
//    src/sections/Library.jsx `LIBRARY_TOPICS`.
out.courses.push({
  id: "deepdive", title: "Deep Dives", icon: "🔍",
  blurb: "How to research a token, read Solscan, trading psychology, tax basics, finding alpha, and more.",
  lessons: LIBRARY_TOPICS.map((t) => ({
    id: String(t.id || (t.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")), title: t.title, icon: t.icon || "🔍",
    intro: t.summary || "",
    content: t.content || "",
    sections: (t.sections || []).map((s) => ({ heading: s.heading || s.title || "", body: s.body || s.content || "" })),
  })),
});

return out;
}

const OUTPUTS = [
  { edition: "", path: OUT_PATH },
  { edition: "google", path: path.join(ROOT, "data", "curriculum.store.json") },
];

function withoutGeneratedAt(obj) {
  const { generatedAt, ...rest } = obj;
  return rest;
}

if (process.argv.includes("--check")) {
  let stale = 0;
  for (const { edition, path: outPath } of OUTPUTS) {
    const out = buildCurriculum(edition);
    let committed;
    try { committed = JSON.parse(fs.readFileSync(outPath, "utf8")); }
    catch (e) { console.error(`[extract --check] could not read ${outPath}: ${e.message}`); process.exit(1); }
    const freshBody = JSON.stringify(withoutGeneratedAt(out));
    const committedBody = JSON.stringify(withoutGeneratedAt(committed));
    if (freshBody !== committedBody) {
      const freshCounts = out.courses.map((c) => `${c.id}:${c.lessons.length}`).join("  ");
      const committedCounts = (committed.courses || []).map((c) => `${c.id}:${(c.lessons || []).length}`).join("  ");
      console.error(`[extract --check] ${path.relative(ROOT, outPath)} is STALE (edition ${JSON.stringify(edition)}).`);
      console.error(`  committed: ${committedCounts}`);
      console.error(`  fresh:     ${freshCounts}`);
      stale++;
    }
  }
  if (stale) { console.error("  Run: node scripts/extract-curriculum.js"); process.exit(1); }
  console.log("[extract --check] data/curriculum.json and data/curriculum.store.json match the current sources.");
  process.exit(0);
}

for (const { edition, path: outPath } of OUTPUTS) {
  const out = buildCurriculum(edition);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const counts = out.courses.map((c) => `${c.id}:${c.lessons.length}`).join("  ");
  console.log(`[extract] wrote ${path.relative(ROOT, outPath)} (edition ${JSON.stringify(edition)}) — ${out.courses.length} courses · ${counts}`);
}