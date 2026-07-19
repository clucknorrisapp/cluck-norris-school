// ── Crawlable curriculum page (SEO for non-JS crawlers) ──────────────────────
// The React school is a client-rendered SPA: without executing JavaScript a
// crawler sees an empty <div id="root"> — Googlebot renders JS (slowly), but
// Bing, AI crawlers (GPTBot etc.), and social scrapers do not. This module
// extracts the SAME lesson data the app ships to every browser (LESSONS +
// INCUBATOR_LESSONS in src/App.jsx, LP_LESSONS in src/sections/LPLab.jsx) and
// renders it as ONE static HTML page served at /curriculum.
//
// DELIBERATELY EXCLUDED: quiz answer options, correct indexes, and explanations.
// The Ultimate Challenge exam draws from these same question texts (see
// data/question-bank.json + EXAM_SOURCE_MIX) — the crawlable page must not make
// exam answers googleable. Question TEXTS alone are included (they're already
// in the public JS bundle, and they're good search surface).
//
// SAFETY: extraction is text-based (a string-aware bracket scan over the source
// file, then evaluation of the pure-data array literal — the arrays contain only
// string/number literals, verified). It runs lazily on first request and the
// result (success OR failure) is cached. If ANYTHING fails, render() returns
// null and the /curriculum route 404s — the React school and every other route
// are completely unaffected. This module never mutates anything.
const fs = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");

// Extract the array literal assigned to `const <name> = [ ... ];` from source
// text. String-aware scan: handles ' " ` strings, escapes, ${…} interpolation
// inside template literals, and // + /* */ comments in code positions.
function extractArrayLiteral(src, name) {
  const marker = new RegExp("const\\s+" + name + "\\s*=\\s*\\[");
  const m = marker.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // index of the opening [
  let depth = 0, str = null, esc = false, tmplCode = 0, lineC = false, blockC = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineC) { if (c === "\n") lineC = false; continue; }
    if (blockC) { if (c === "*" && n === "/") { blockC = false; i++; } continue; }
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (str === "`" && c === "$" && n === "{") { tmplCode++; str = null; i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (tmplCode > 0 && c === "}") { tmplCode--; if (tmplCode === 0) str = "`"; continue; }
    if (c === "'" || c === '"' || c === "`") { str = c; continue; }
    if (c === "/" && n === "/") { lineC = true; i++; continue; }
    if (c === "/" && n === "*") { blockC = true; i++; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") {
      depth--;
      if (depth === 0 && c === "]") return src.slice(start, i + 1);
    }
  }
  return null;
}

function loadArray(file, name) {
  const src = fs.readFileSync(join(ROOT, file), "utf8");
  const lit = extractArrayLiteral(src, name);
  if (!lit) throw new Error(`${name} not found in ${file}`);
  const arr = new Function("return (" + lit + ")")(); // pure data literal — no outer refs
  if (!Array.isArray(arr) || !arr.length) throw new Error(`${name} parsed empty`);
  return arr;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Multi-line lesson body → paragraphs (blank-line separated), single \n → <br>.
function paras(s) {
  return String(s || "").split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

function lessonBlock(l) {
  const concepts = (l.concepts || []).map((c) => `<dt>${esc(c.term)}</dt><dd>${esc(c.def)}</dd>`).join("");
  const qs = (l.questions || []).map((q) => `<li>${esc(q.q)}</li>`).join("");
  return `<section class="lesson" id="${esc(l.id)}">
<h3>${esc(l.icon || "")} ${esc(l.title)}${l.belt ? ` <span class="belt">${esc(l.belt)}</span>` : ""}</h3>
${l.quote ? `<blockquote>${esc(l.quote)}</blockquote>` : ""}
${l.intro ? paras(l.intro) : ""}
${concepts ? `<h4>Key concepts</h4><dl>${concepts}</dl>` : ""}
${qs ? `<h4>Quiz questions (answers in the interactive school)</h4><ul class="quiz">${qs}</ul>` : ""}
</section>`;
}

function lpLessonBlock(l) {
  const sections = (l.sections || []).map((s) =>
    `${s.heading ? `<h4>${esc(s.heading)}</h4>` : ""}${paras(s.body)}` +
    (s.quiz && s.quiz.q ? `<p class="quiz"><em>Quiz: ${esc(s.quiz.q)}</em></p>` : "")
  ).join("");
  return `<section class="lesson" id="lp-${esc(l.id)}">
<h3>${esc(l.icon || "")} ${esc(l.title)}</h3>
${l.tagline ? `<blockquote>${esc(l.tagline)}</blockquote>` : ""}
${l.cluckHook ? paras(l.cluckHook) : ""}
${sections}
</section>`;
}

let _cached; // undefined = not tried; null = failed (cached); string = html
function render() {
  if (_cached !== undefined) return _cached;
  try {
    const lessons = loadArray("src/App.jsx", "LESSONS");
    const incubator = loadArray("src/App.jsx", "INCUBATOR_LESSONS");
    let lp = [];
    try { lp = loadArray("src/sections/LPLab.jsx", "LP_LESSONS"); } catch (e) { console.warn("[curriculum] LP_LESSONS skipped:", e.message); }
    const total = lessons.length + incubator.length + lp.length;
    _cached = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crypto School Curriculum — ${total} Free Lessons | Cluck Norris</title>
<meta name="description" content="The full Cluck Norris School of Crypto Hard Knocks curriculum: wallets, rugs &amp; scams, liquidity pools, impermanent loss, tokenomics and more — ${total} free lessons from beginner to advanced, on Solana.">
<link rel="canonical" href="https://clucknorris.app/curriculum">
<meta property="og:title" content="Crypto School Curriculum — ${total} Free Lessons">
<meta property="og:description" content="Learn crypto from your first wallet to advanced LP strategy, without losing your shirt. Free, in seven languages.">
<meta property="og:image" content="https://clucknorris.app/cluck-norris.png">
<link rel="stylesheet" href="/theme.css">
<style>
  main{max-width:860px;margin:0 auto;padding:28px 18px 60px;line-height:1.65;}
  h1{font-size:30px;} h2{margin-top:44px;border-bottom:1px solid rgba(255,140,40,.25);padding-bottom:6px;}
  .lesson{margin:26px 0;padding:18px;border:1px solid rgba(255,140,40,.18);border-radius:12px;background:rgba(0,0,0,.25);}
  .belt{font-size:11px;letter-spacing:1px;opacity:.7;} blockquote{opacity:.85;font-style:italic;margin:8px 0;}
  dt{font-weight:700;margin-top:8px;} dd{margin:0 0 4px 0;opacity:.9;}
  ul.quiz li{opacity:.85;} .cta{display:inline-block;margin:14px 0;padding:10px 18px;border:1px solid #ff8c28;border-radius:10px;}
  a{color:#ffa64d;}
</style>
</head>
<body>
<main>
<h1>🐔 School of Crypto Hard Knocks — Full Curriculum</h1>
<p>Every lesson below is free at <a href="/school">the interactive school</a> — with quizzes, read-aloud audio, and translations in English, Español, Italiano, Português, Tiếng Việt and 中文. Pass the Ultimate Challenge and earn a <a href="/school">verified on-chain diploma</a>. This page is the plain-text course outline.</p>
<a class="cta" href="/school">Start learning free →</a>

<h2>🥚 The Incubator — absolute-beginner track (${incubator.length} lessons)</h2>
${incubator.map(lessonBlock).join("\n")}

<h2>🎓 Core curriculum (${lessons.length} lessons)</h2>
${lessons.map(lessonBlock).join("\n")}

${lp.length ? `<h2>💧 The LP Lab — liquidity-provider deep dives (${lp.length} lessons)</h2>\n${lp.map(lpLessonBlock).join("\n")}` : ""}

<p><a class="cta" href="/school">Take the interactive course →</a> · <a href="/tools">Free token-research tools</a> · <a href="/">Home</a></p>
<footer><p>Educational content only — the chain shows <em>what</em>, never <em>why</em>. Nothing here is financial advice.</p></footer>
</main>
</body>
</html>`;
  } catch (e) {
    console.warn("[curriculum] render failed (route will 404):", e.message);
    _cached = null;
  }
  return _cached;
}

module.exports = { render };
