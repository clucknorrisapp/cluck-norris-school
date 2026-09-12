#!/usr/bin/env node
// Builds the public, crawlable, QUIZ-FREE syllabus page at public/curriculum.html.
//
// WHY: the old /curriculum page was removed (see CLAUDE.md "Removed") because it laid out
// every lesson body AND every quiz question + answer on one screen — the assessment was
// public. This generator shows only what is TAUGHT: track, belt/level, icon, title, a
// one-line tagline/quote, the concept TERMS (never definitions), and a short learning
// objective paraphrased from the intro. No quiz text, no answer options, no explanations,
// no full lesson body ever reaches the output.
//
// Extraction is programmatic — the same balanced-bracket, string-aware array-literal slicer
// scripts/extract-curriculum.js and scripts/check-counts.js already use — so this regenerates
// straight from src/App.jsx and src/sections/LPLab.jsx, never by hand-copying content.
//
// Regenerate after editing lesson data:
//   node scripts/build-curriculum.cjs
// Same input -> byte-identical output (no timestamps, no random ordering).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── Balanced-bracket, string-aware array-literal extractor ──────────────────────────────
// Identical approach to scripts/extract-curriculum.js: find `const NAME = [`, walk forward
// tracking bracket depth and string state (so a "]" or "//" inside a string/template literal
// doesn't end the scan early), then eval the isolated literal. These are pure-data arrays —
// no JSX, no function calls — so eval is safe and deterministic.
function extractArray(src, name) {
  const decl = `const ${name} = [`;
  const start = src.indexOf(decl);
  if (start < 0) return null;
  let i = start + decl.length - 1; // sitting on the '['
  let depth = 0, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  const slice = src.slice(start + decl.length - 1, i);
  return eval("(" + slice + ")");
}

const appSrc = read("src/App.jsx");
const lpSrc = read("src/sections/LPLab.jsx");

const LESSONS = extractArray(appSrc, "LESSONS") || [];
const INCUBATOR_LESSONS = extractArray(appSrc, "INCUBATOR_LESSONS") || [];
const LP_LESSONS = extractArray(lpSrc, "LP_LESSONS") || [];

// ── Count-drift guard (mirrors scripts/check-counts.js's philosophy: fail loud, never
// silently render a wrong number on public-facing copy) ────────────────────────────────
const EXPECTED = { LESSONS: 14, INCUBATOR_LESSONS: 7, LP_LESSONS: 14 };
const actual = { LESSONS: LESSONS.length, INCUBATOR_LESSONS: INCUBATOR_LESSONS.length, LP_LESSONS: LP_LESSONS.length };
const drift = Object.keys(EXPECTED).filter((k) => actual[k] !== EXPECTED[k]);
if (drift.length) {
  console.error("✗ curriculum page count drift — the source data no longer matches the canonical counts:");
  for (const k of drift) console.error(`   • ${k}: expected ${EXPECTED[k]}, found ${actual[k]}`);
  console.error(
    "\nIf this is a deliberate curriculum change, update EXPECTED in scripts/build-curriculum.cjs " +
    "(and scripts/check-counts.js's canonical counts) in the same change — never let this page " +
    "silently render a stale total."
  );
  process.exit(1);
}
if (!LESSONS.length || !INCUBATOR_LESSONS.length || !LP_LESSONS.length) {
  console.error("✗ parsed zero lessons from one or more arrays — extraction likely broke.");
  process.exit(1);
}

// ── Text helpers: derive a short objective from the intro, never the full body ─────────
// Split on sentence-ending punctuation followed by a space + capital/quote, keep the first
// `n` sentences, joined back with a single space. Deterministic — no rewriting model.
function firstSentences(text, n) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  const parts = clean.match(/[^.!?]+[.!?]+(?:["')]+)?/g) || [clean];
  return parts.slice(0, n).join(" ").trim();
}
// HTML-escape — every string below originates from source data (attacker-controlled in
// spirit even if not in practice here) so it goes through this before reaching the page.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ── Normalize the three sources into one shape: {id, level, icon, title, tagline, objective, terms} ──
function normLessons() {
  const belt = LESSONS.map((l) => ({
    id: String(l.id),
    level: l.belt || "",
    icon: l.icon || "📘",
    title: l.title || "",
    tagline: l.quote || "",
    objective: firstSentences(l.intro || "", 2),
    terms: (l.concepts || []).map((c) => c.term).filter(Boolean),
  }));

  // No quote/tagline field exists on these in the source — only "objective" (a clean,
  // untruncated 1-2 sentence pull from the intro) is shown, rather than a synthetic
  // tagline built by truncating a sentence mid-clause.
  const incubator = INCUBATOR_LESSONS.map((l, idx) => ({
    id: String(l.id || idx),
    level: `BEGINNER · LESSON ${idx + 1}`,
    icon: l.icon || "🐣",
    title: l.title || "",
    tagline: "",
    objective: firstSentences(l.intro || "", 2),
    terms: (l.concepts || []).map((c) => c.term).filter(Boolean),
  }));

  // LP Lab lessons have no {term, def} concept pairs — they teach through headed sections
  // instead. Section HEADINGS are the topic-label analog (never the section body/quiz).
  const lp = LP_LESSONS.map((l) => ({
    id: String(l.id),
    level: `LP LAB · CLASS ${l.id}`,
    icon: l.icon || "💧",
    title: l.title || "",
    tagline: l.tagline || "",
    objective: firstSentences(l.cluckHook || l.tagline || "", 2),
    terms: (l.sections || []).map((s) => s.heading || s.title).filter(Boolean),
  }));

  return { belt, incubator, lp };
}

const { belt, incubator, lp } = normLessons();
const TOTAL = belt.length + incubator.length + lp.length;

// ── Verify no quiz/answer text leaked into the normalized shape (belt-and-suspenders; the
// normalizer above never reads .questions/.quiz/.sections[].body/.content, but assert it) ──
for (const set of [belt, incubator, lp]) {
  for (const l of set) {
    if ("questions" in l || "quiz" in l || "content" in l || "sections" in l) {
      console.error("✗ internal error — a raw quiz/body field survived normalization.");
      process.exit(1);
    }
  }
}

// ── Render ────────────────────────────────────────────────────────────────────────────
const LANGS = [
  { code: "en", flag: "🇺🇸", name: "English" },
  { code: "es", flag: "🇪🇸", name: "Español" },
  { code: "hi", flag: "🇮🇳", name: "हिन्दी" },
  { code: "it", flag: "🇮🇹", name: "Italiano" },
  { code: "pt", flag: "🇵🇹", name: "Português" },
  { code: "vi", flag: "🇻🇳", name: "Tiếng Việt" },
  { code: "zh", flag: "🇨🇳", name: "中文" },
];

function lessonCard(l) {
  const terms = l.terms.length
    ? `<div class="terms">${l.terms.map((t) => `<span class="term">${esc(t)}</span>`).join("")}</div>`
    : "";
  return `<article class="lesson">
      <div class="lesson-top"><span class="icon" aria-hidden="true">${esc(l.icon)}</span><span class="level">${esc(l.level)}</span></div>
      <h3 class="ltitle">${esc(l.title)}</h3>
      ${l.tagline ? `<p class="tagline">“${esc(l.tagline)}”</p>` : ""}
      ${l.objective ? `<p class="objective">${esc(l.objective)}</p>` : ""}
      ${terms}
    </article>`;
}

function trackSection(id, icon, title, blurb, lessons) {
  return `<section class="track" id="${id}">
    <div class="track-head">
      <h2><span aria-hidden="true">${icon}</span> ${esc(title)} <span class="count">${lessons.length}</span></h2>
      <p class="track-blurb">${esc(blurb)}</p>
    </div>
    <div class="lesson-grid">
      ${lessons.map(lessonCard).join("\n      ")}
    </div>
  </section>`;
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "School of Crypto Hard Knocks — Curriculum",
  itemListElement: [
    { "@type": "Course", position: 1, name: "Belt Course", description: "14 belt-ranked lessons on wallets, tokens, DEXs, rugs, market cap and on-chain basics.", provider: { "@type": "Organization", name: "Cluck Norris" } },
    { "@type": "Course", position: 2, name: "Crypto 101 (Incubator)", description: "7 absolute-beginner lessons on wallets, tokens, on-ramps, DEXs and liquidity.", provider: { "@type": "Organization", name: "Cluck Norris" } },
    { "@type": "Course", position: 3, name: "LP Lab", description: "14 lessons on AMMs, impermanent loss, concentrated liquidity and LP strategy.", provider: { "@type": "Organization", name: "Cluck Norris" } },
  ],
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="/theme.css">
<title>Curriculum — School of Crypto Hard Knocks</title>
<meta name="description" content="The full syllabus of the School of Crypto Hard Knocks: ${TOTAL} free lessons across the Belt Course, Crypto 101 and the LP Lab, in 7 languages. What's taught, not the quiz."/>
<meta property="og:title" content="Curriculum — School of Crypto Hard Knocks"/>
<meta property="og:description" content="${TOTAL} free lessons on wallets, rugs, DEXs and liquidity — the syllabus, no signup, no quiz spoilers."/>
<meta property="og:type" content="website"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: var(--body); }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 80px; }
  .back { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--orange); text-decoration: none; margin-bottom: 16px; }
  header.page-head { text-align: center; margin: 8px 0 22px; }
  h1.title { font-family: var(--disp); font-size: 30px; margin: 0 0 6px; }
  h1.title .c { color: var(--orange); }
  .stat-line { font-family: var(--mono); font-size: 13px; color: var(--sub); letter-spacing: 0.5px; }
  .langs { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 16px auto 4px; max-width: 720px; }
  .lang-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--sub); background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 999px; padding: 5px 11px; }
  .lang-note { font-size: 12px; color: var(--muted); margin: 8px 0 0; }
  .cta-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 20px 0 6px; }
  .cta { font-family: var(--disp); letter-spacing: 1px; color: #fff; background: linear-gradient(135deg, var(--orange), var(--red)); border: none; border-radius: 12px; padding: 11px 20px; font-size: 14px; text-decoration: none; display: inline-block; }
  .cta.alt { background: rgba(255,255,255,0.05); color: var(--text); border: 1px solid var(--border); }
  .track { margin-top: 34px; }
  .track-head h2 { font-family: var(--disp); font-size: 20px; margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
  .track-head .count { font-family: var(--mono); font-size: 13px; color: var(--gold); background: rgba(255,182,39,0.1); border: 1px solid rgba(255,182,39,0.3); border-radius: 999px; padding: 1px 9px; margin-left: 2px; }
  .track-blurb { color: var(--sub); font-size: 14px; margin: 0 0 16px; max-width: 720px; }
  .lesson-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .lesson { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
  .lesson-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .lesson .icon { font-size: 22px; line-height: 1; }
  .lesson .level { font-family: var(--mono); font-size: 10px; letter-spacing: 1px; color: var(--muted); text-align: right; }
  .ltitle { font-family: var(--disp); font-size: 16px; margin: 0 0 6px; }
  .tagline { font-size: 13px; color: var(--sub); font-style: italic; margin: 0 0 8px; line-height: 1.5; }
  .objective { font-size: 13.5px; color: var(--body-text); margin: 0 0 10px; line-height: 1.55; }
  .terms { display: flex; flex-wrap: wrap; gap: 6px; }
  .term { font-size: 11px; font-weight: 600; color: #FFD9A0; background: rgba(255,122,24,0.08); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; }
  footer.page-foot { margin-top: 44px; text-align: center; color: var(--muted); font-size: 12px; }
  @media (max-width: 480px) { .lesson-grid { grid-template-columns: 1fr; } h1.title { font-size: 24px; } }
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/">← HOME</a>
  <header class="page-head">
    <h1 class="title">Curriculum — <span class="c">School of Crypto Hard Knocks</span></h1>
    <p class="stat-line">${TOTAL} lessons · 7 languages · free · no signup</p>
    <div class="langs">
      ${LANGS.map((l) => `<span class="lang-chip">${l.flag} ${esc(l.name)}</span>`).join("\n      ")}
    </div>
    <p class="lang-note">Every lesson below renders in all seven languages inside the school — pick yours from the language toggle once you start.</p>
    <div class="cta-row">
      <a class="cta" href="/school">Start the Belt Course</a>
      <a class="cta alt" href="/school#incubator">Start with Crypto 101</a>
      <a class="cta alt" href="/lp-lab">Open the LP Lab</a>
    </div>
  </header>

  ${trackSection("belt-course", "🥋", "Belt Course", "Wallets, tokens, DEXs, rugs, market cap and on-chain basics — the bedrock every survivor needs, ranked belt by belt.", belt)}

  ${trackSection("crypto-101", "🐣", "Crypto 101 (Incubator)", "Brand new? Start here — wallets, tokens, on-ramps, what a DEX even is, and staying safe.", incubator)}

  ${trackSection("lp-lab", "💧", "LP Lab", "AMMs, impermanent loss, concentrated liquidity, fees and LP strategy — the real money mechanics.", lp)}

  <footer class="page-foot">
    This page lists what's taught, not the assessment — no quiz questions, answers, or full lesson text. Take the real lessons (with the quizzes) inside the school.
  </footer>
</div>
<script defer src="/cluck-nav.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "public", "curriculum.html"), html);
console.log(
  `✓ wrote public/curriculum.html — ${TOTAL} lessons (belt course: ${belt.length}, crypto 101: ${incubator.length}, lp lab: ${lp.length})`
);
