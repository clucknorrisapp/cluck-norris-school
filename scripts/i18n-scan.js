#!/usr/bin/env node
/* i18n scan — find user-facing strings in the app that are NOT in the curated dicts
 * (es/zh/it union), i.e. strings that fall back to the live MT layer for every language.
 *   node scripts/i18n-scan.js
 * Heuristic (no DOM): extracts JSX/HTML text runs + visible attributes and mirrors the
 * runtime's norm()/translatable() rules. "Uncurated" ≠ broken — those still translate via
 * MT at view time — but they can flash English on first load and depend on the MT layer,
 * so high-traffic ones are worth curating. Writes the full list to $TMPDIR/i18n-uncurated.txt.
 */
const fs = require("fs"), path = require("path"), os = require("os");
const ROOT = path.join(__dirname, "..");
const DICTDIR = path.join(ROOT, "public", "i18n");

const TICKER = new Set("CLKN SOL USDC USDT JUP cbBTC BTC ETH SOLUSD NFT LP AMM DeFi MEV APR APY TVL IL DEX CEX SPL DAO USD".split(" "));
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
function translatable(k) {
  if (!k || k.length < 2) return false;
  if (!/[A-Za-z]/.test(k)) return false;
  if (TICKER.has(k) || TICKER.has(k.replace(/^\$/, ""))) return false;
  if (/^https?:\/\//i.test(k) || /^www\./i.test(k)) return false;
  if (/^[1-9A-HJ-NP-Za-km-z]{25,60}$/.test(k)) return false;
  if (/^[\d.,%\s$+\-x/:#×•·()]+$/.test(k)) return false;
  // heuristic noise filters (not in runtime, but cut obvious code/identifiers):
  if (!/\s/.test(k) && /[_{}()=;<>/\\]/.test(k)) return false;   // single token with code punctuation
  if (/^[a-z][a-zA-Z]+$/.test(k) && k.length < 4) return false;  // tiny camel/ident
  return true;
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&hellip;/g, "…");

const union = new Set();
for (const f of ["es.json", "es.school.json", "zh.json", "zh.school.json", "it.json", "it.school.json"]) {
  try { const d = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), "utf8")); Object.keys(d).forEach((k) => union.add(norm(k))); } catch (_) {}
}

function walkFiles(dir, exts, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === "i18n" || e.name === "vendor") continue; walkFiles(p, exts, acc); }
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

const candidates = new Map(); // key -> Set(files)
function add(raw, file) { const k = norm(decode(raw)); if (translatable(k)) { if (!candidates.has(k)) candidates.set(k, new Set()); candidates.get(k).add(file); } }

for (const f of walkFiles(path.join(ROOT, "public"), [".html"], [])) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|svg|noscript|textarea|pre|code|kbd|samp)\b[\s\S]*?<\/\1>/gi, " ");
  const rel = path.relative(ROOT, f);
  let m, attrRe = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]+)"/gi;
  while ((m = attrRe.exec(s))) add(m[2], rel);
  s = s.replace(/<[^>]+>/g, "\n");
  for (const run of s.split("\n")) add(run, rel);
}
for (const f of walkFiles(path.join(ROOT, "src"), [".jsx", ".js"], [])) {
  const s = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, f);
  let m, txtRe = />\s*([^<>{}\n][^<>{}]*?)\s*</g;
  while ((m = txtRe.exec(s))) add(m[1], rel);
  let aRe = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]+)"/gi;
  while ((m = aRe.exec(s))) add(m[2], rel);
}

const uncovered = [...candidates.keys()].filter((k) => !union.has(k));
console.log(`Dict union (es+zh+it): ${union.size} keys`);
console.log(`Candidate user-facing strings: ${candidates.size}`);
console.log(`Covered by a curated dict:    ${candidates.size - uncovered.length}`);
console.log(`NOT curated (live-MT only):   ${uncovered.length}`);
const byFile = {};
for (const k of uncovered) for (const f of candidates.get(k)) byFile[f] = (byFile[f] || 0) + 1;
console.log("\nUncurated by file (top 30):");
Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([f, n]) => console.log(`  ${String(n).padStart(5)}  ${f}`));
const out = path.join(os.tmpdir(), "i18n-uncurated.txt");
fs.writeFileSync(out, uncovered.sort().join("\n"));
console.log(`\nFull list -> ${out}`);
console.log("\nSample uncurated strings:");
uncovered.slice(0, 30).forEach((k) => console.log("  " + JSON.stringify(k.slice(0, 80))));
