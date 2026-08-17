// Generate the level ADJACENCY GRAPH for the leaderboard's checkpoint anti-forgery check,
// straight from the real LEVELS data in src/game_logic.js so it can never drift (same loader
// approach as gen-budgets.cjs / test/nq-geometry-check.cjs). Emits normie-quest/nq-level-graph.json:
//
//   { "levels": ["1-1", ...],                 // every real level name (telemetry world validation)
//     "next":   { "1-1": ["1-2"], ... } }     // name -> legal successor names (checkpoint adjacency)
//
// Legal successors of a level (a deliberate OVER-approximation — an extra edge only loosens the
// check, a missing edge falsely flags a real player; audit finding #6):
//   - the array successor (levelClear advances to idx+1)
//   - the def.next target (advanceLevel/bankCheckpoint prefer it; private-room chains use it)
//   - every warp target, BOTH directions (speakeasy in via def.warps [x, targetIdx, hint];
//     returnFromHidden / the TRENCHES troll branch send the player back to the source level)
//   - the next NUMBERED level (redundant with idx+1 for the main worlds, kept as insurance
//     against future array reordering like the 27-33 hidden-block insertion)
//
// Run:  node normie-quest/tools/gen-level-graph.cjs
// CI regenerates it next to nq-budgets.json and fails if the committed file is stale.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'game_logic.js');
const OUT = path.join(__dirname, '..', 'nq-level-graph.json');

const src = fs.readFileSync(SRC, 'utf8');

// --- bracket-match extract of  var LEVELS=[ ... ]  (respecting string literals) ---
const startKw = src.indexOf('var LEVELS=[');
if (startKw < 0) { console.error('LEVELS not found'); process.exit(1); }
let i = src.indexOf('[', startKw), depth = 0, inStr = false, q = '', esc = false, end = -1;
for (; i < src.length; i++) {
  const c = src[i], c2 = src[i + 1];
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false; continue; }
  if (c === '/' && c2 === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }         // line comment
  if (c === '/' && c2 === '*') { const ce = src.indexOf('*/', i + 2); i = ce < 0 ? src.length : ce + 1; continue; }  // block comment
  if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
  if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
}
const lit = src.slice(src.indexOf('[', startKw), end + 1);
let LEVELS;
try {
  // The array references game constants (H, W, ground Y, …) for coordinates. The graph only uses
  // level NAMES plus the literal `next` / warp-target INDICES — never coordinates — so stub every
  // free identifier as 0; names, flags and index literals are preserved.
  const stub = new Proxy({}, { has: () => true, get: (_, k) => (k === Symbol.unscopables ? undefined : 0) });
  LEVELS = Function('S', 'with(S){ return (' + lit + '); }')(stub);
} catch (e) { console.error('LEVELS eval failed:', e.message); process.exit(1); }

const names = LEVELS.map((l) => (l && typeof l.name === 'string' ? l.name : null));
const nameSet = new Set(names.filter(Boolean));
const succ = new Map();   // name -> Set of successor names
function edge(from, to) {
  if (!from || !to || from === to) return;
  if (!succ.has(from)) succ.set(from, new Set());
  succ.get(from).add(to);
}

for (let idx = 0; idx < LEVELS.length; idx++) {
  const l = LEVELS[idx], nm = names[idx];
  if (!l || !nm) continue;
  // array successor (levelClear path)
  if (names[idx + 1]) edge(nm, names[idx + 1]);
  // def.next target (advanceLevel path; 9-3 -> 10-1 across the hidden block, private chains)
  if (l.next != null && Number.isInteger(Number(l.next))) edge(nm, names[Number(l.next)]);
  // warps, both directions (duck in / return to the surface)
  for (const w of (Array.isArray(l.warps) ? l.warps : [])) {
    const tgt = names[Number(w && w[1])];
    edge(nm, tgt); edge(tgt, nm);
  }
  // next numbered level (W-L -> W-(L+1), else (W+1)-1)
  const m = /^(\d+)-(\d+)$/.exec(nm);
  if (m) {
    const sameWorld = m[1] + '-' + (Number(m[2]) + 1);
    const nextWorld = (Number(m[1]) + 1) + '-1';
    if (nameSet.has(sameWorld)) edge(nm, sameWorld);
    else if (nameSet.has(nextWorld)) edge(nm, nextWorld);
  }
}

const out = { levels: [...nameSet], next: {} };
let edges = 0;
for (const nm of out.levels) {
  const s = succ.get(nm);
  out.next[nm] = s ? [...s].sort() : [];
  edges += out.next[nm].length;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
console.log('wrote', path.relative(path.join(__dirname, '..', '..'), OUT), '—', out.levels.length, 'levels,', edges, 'edges');
// spot-check a few
for (const nm of ['1-1', '1-3', '9-2', '9-3', 'MYSPACE', 'GHOSTSHIP']) {
  if (out.next[nm]) console.log('  ', nm.padEnd(10), '->', out.next[nm].join(', ') || '(none)');
}
