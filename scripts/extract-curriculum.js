// Extract the school's curriculum content from src/App.jsx into data/curriculum.json so the
// server-side Live Classroom can teach the REAL lesson material (intros, concepts, prose,
// quiz Q&A) — not just quiz explanations. Re-run after editing lessons in App.jsx:
//   node scripts/extract-curriculum.js
// It string-slices each named array (balanced brackets, string-aware) and evals the literal
// (these are pure-data arrays — no JSX/functions inside).
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

function extractArray(name) {
  const decl = `const ${name} = [`;
  const start = src.indexOf(decl);
  if (start < 0) return null;
  let i = start + decl.length - 1; // at the '['
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
  try { return eval("(" + slice + ")"); }
  catch (e) { console.warn(`[extract] ${name} eval failed:`, e.message); return null; }
}

const out = { generatedAt: new Date().toISOString(), courses: [] };

// 1) Core curriculum (belts) — concepts + questions
const LESSONS = extractArray("LESSONS") || [];
out.courses.push({
  id: "fundamentals", title: "Crypto Fundamentals", icon: "📚",
  blurb: "Wallets, tokens, DEXs, rugs, market cap, on-chain basics — the bedrock every survivor needs.",
  lessons: LESSONS.map((l) => ({
    id: String(l.id), title: l.title, icon: l.icon || "📘", belt: l.belt || null,
    intro: l.intro || "",
    concepts: (l.concepts || []).map((c) => ({ term: c.term, def: c.def })),
    questions: (l.questions || []).map((q) => ({ q: q.q, answer: (q.options || [])[q.correct], why: q.explanation || "" })),
  })),
});

// 2) Beginner incubator lessons (What is a Wallet, Token, DEX, …)
const INCUBATOR = extractArray("INCUBATOR_LESSONS") || [];
if (INCUBATOR.length) out.courses.push({
  id: "basics", title: "Crypto 101 (Absolute Basics)", icon: "🐣",
  blurb: "Brand new? Start here — wallets, tokens, on-ramps, what a DEX even is, staying safe.",
  lessons: INCUBATOR.map((l) => ({
    id: String(l.id || (l.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")), title: l.title, icon: l.icon || "🐣",
    intro: l.summary || l.intro || "",
    concepts: (l.concepts || []).map((c) => ({ term: c.term, def: c.def })),
    content: l.content || "",
    questions: (l.questions || []).map((q) => ({ q: q.q, answer: (q.options || [])[q.correct], why: q.explanation || "" })),
  })),
});

// 3) LP Lab structured lessons (sections + quizzes)
const LP_LESSONS = extractArray("LP_LESSONS") || [];
if (LP_LESSONS.length) out.courses.push({
  id: "lp", title: "Liquidity & LP Mastery", icon: "💧",
  blurb: "AMMs, impermanent loss, concentrated liquidity, fees & LP earnings — the real money mechanics.",
  lessons: LP_LESSONS.map((l) => ({
    id: String(l.id), title: l.title, icon: l.icon || "💧", tagline: l.tagline || "",
    intro: l.tagline || "",
    sections: (l.sections || []).map((s) => ({
      heading: s.heading || s.title || "",
      body: s.body || s.content || "",
      quiz: (s.quiz || []).map((q) => ({ q: q.q, answer: (q.options || [])[q.correct], why: q.explanation || "" })),
    })),
    cluckVerdict: l.cluckVerdict || "",
  })),
});

// 4) Liquidity library (rich prose) — folded into the LP course as extra reference lessons
const LIB_LIQ = extractArray("LIBRARY_LIQUIDITY") || [];
const lpCourse = out.courses.find((c) => c.id === "lp");
if (LIB_LIQ.length && lpCourse) {
  for (const t of LIB_LIQ) lpCourse.lessons.push({ id: "lib-" + t.id, title: t.title, icon: t.icon || "📖", intro: t.summary || "", content: t.content || "", reference: true });
}

// 5) Deep-dive library topics (Research a Token, Reading Solscan, Tax, Psychology, …)
const LIB_TOPICS = extractArray("LIBRARY_TOPICS") || [];
if (LIB_TOPICS.length) out.courses.push({
  id: "deepdive", title: "Deep Dives", icon: "🔍",
  blurb: "How to research a token, read Solscan, trading psychology, tax basics, finding alpha, and more.",
  lessons: LIB_TOPICS.map((t) => ({
    id: String(t.id || (t.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")), title: t.title, icon: t.icon || "🔍",
    intro: t.summary || "",
    content: t.content || "",
    sections: (t.sections || []).map((s) => ({ heading: s.heading || s.title || "", body: s.body || s.content || "" })),
  })),
});

fs.writeFileSync(path.join(__dirname, "..", "data", "curriculum.json"), JSON.stringify(out, null, 2));
const counts = out.courses.map((c) => `${c.id}:${c.lessons.length}`).join("  ");
console.log(`[extract] wrote data/curriculum.json — ${out.courses.length} courses · ${counts}`);
