// ── Lesson counts, read straight from the app's own arrays ──────────────────
// This module USED to also render /curriculum — a static-HTML mirror of every lesson,
// for crawlers that don't execute JS. That page was REMOVED on 2026-07-29 (owner: "it
// gives out too much on one screen and the questions. Not cool"): it laid out every
// lesson body and every quiz question text on one flat page, which is both a giveaway
// and a way to skip the thinking the lessons exist to provoke. /curriculum now 301s to
// /education. Do NOT rebuild the mirror without an explicit ask — and if some future SEO
// need brings it back, it must not include question texts.
//
// What remains is the extraction machinery, which /education uses for its lesson counts
// (see the /education route in server.js). Public counts are rendered from the REAL
// arrays rather than typed by hand, because hand-typed counts rot: the landing page once
// advertised 72 exams against a 70-question curriculum for months.
//
// SAFETY: extraction is text-based (a string-aware bracket scan over the source file,
// then evaluation of the pure-data array literal — the arrays contain only string/number
// literals, verified). It runs lazily, the result is cached, and every failure degrades
// to null so a caller simply omits the number. This module never mutates anything.
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

// Cached on first call; any extraction failure yields null for that count.
let _counts;
function counts() {
  if (_counts !== undefined) return _counts;
  const one = (file, name) => { try { return loadArray(file, name).length; } catch (_) { return null; } };
  _counts = {
    lessons: one("src/App.jsx", "LESSONS"),
    incubator: one("src/App.jsx", "INCUBATOR_LESSONS"),
    lp: one("src/sections/LPLab.jsx", "LP_LESSONS"),
  };
  return _counts;
}

module.exports = { counts };
