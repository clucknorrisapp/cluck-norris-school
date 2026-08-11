// Generate the per-level MAXIMUM-POINTS budget table for the leaderboard's anti-forgery
// checkpoint system, straight from the real LEVELS data in src/game_logic.js so it can never
// drift. Emits normie-quest/nq-budgets.json ({ "<level name>": maxPoints, ... }).
//
// The budget is a deliberate OVER-ESTIMATE — it must never be below what a legitimate player can
// score in a level, or real players get flagged. Where a value is RNG (bonus blocks 3-5 hits,
// slots) we take the ceiling; where a mechanic is farmable (World-7 yield lifts) we add a generous
// time-bounded allowance. Forgery is still bounded because the total is the sum of real levels'
// ceilings, and the server only credits a level's budget once the player proves sequential reach.
//
// Run:  node normie-quest/tools/gen-budgets.cjs
const fs = require('path') && require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'game_logic.js');
const OUT = path.join(__dirname, '..', 'nq-budgets.json');

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
  // The array references game constants (H, W, ground Y, …) for coordinates. Budgets only use
  // array LENGTHS and literal reward/cache numbers — never coordinates — so stub every free
  // identifier as the number 0; the structure (counts, string vs number rewards) is preserved.
  const stub = new Proxy({}, { has: () => true, get: (_, k) => (k === Symbol.unscopables ? undefined : 0) });
  LEVELS = Function('S', 'with(S){ return (' + lit + '); }')(stub);
} catch (e) { console.error('LEVELS eval failed:', e.message); process.exit(1); }

// --- boss reward table (per §4 of the scoring map; bossHP taken at its max of 5 = over-estimate) ---
const BOSS_HP_MAX = 5;
function bossBudget(l) {
  const wormhole = l.name === '2-3';
  const perHit = wormhole ? 150 : 100;
  const defeatBase = wormhole ? 800 : 500;
  // type bonus keyed by level name (the finales / special rooms)
  const TYPE_BONUS = {
    'TRENCHES': 2000, 'TOMSTURF': 1000, 'BEACH': 1000, 'SANDCASTLE': 1000,
    'MYSPACE': 2000, '20-3': 2500, '21-3': 5000,
  };
  const typeBonus = TYPE_BONUS[l.name] || 0;
  return BOSS_HP_MAX * perHit + defeatBase + typeBonus;
}

function n(arr) { return Array.isArray(arr) ? arr.length : 0; }

function levelMax(l) {
  let m = 0;
  m += n(l.coins) * 10;
  if (l.key) m += 50;
  // powerups: +30 each, candle +100 more. Type is powerup[0].
  for (const p of (l.powerups || [])) m += (String(p && p[0]) === 'candle') ? 130 : 30;
  m += n(l.airdrops) * 150;                       // worst case: grabbed at full hearts
  // bonus blocks: numeric reward => reward*5 (max multi hits); string reward => a powerup (130 = candle worst case)
  for (const b of (l.bonusblocks || [])) {
    const reward = b && b[1];
    if (typeof reward === 'number') m += reward * 5;
    else m += 130;
  }
  for (const c of (l.caches || [])) m += Number(c && c[2]) || 0;
  // enemies: +20 each, rugpuller +50
  for (const e of (l.enemies || [])) m += (String(e && e[0]) === 'rugpuller') ? 50 : 20;
  m += n(l.miniworms) * 20;
  // slots: spinsLeft * 150 * mult ; mult/spins per theme (game_logic lines 420-427)
  const THEME = { jackpot: { mult: 7, spins: 5 }, trench: { mult: 11, spins: 6 } };
  for (const s of (l.slots || [])) {
    const theme = String(s && s[1] || '');
    const t = THEME[theme] || { mult: 1, spins: 3 };
    const spins = (s && s[2] != null) ? Number(s[2]) : t.spins;
    m += spins * 150 * t.mult;
  }
  // World-7 farmable yield lift: generous time-bounded allowance (up to ~1 harvest/sec * 15).
  if (n(l.yields) > 0) m += (Number(l.time) || 120) * 15;
  if (l.boss) m += bossBudget(l);
  else m += (Number(l.time) || 0) * 10;           // non-boss clear bonus = full clock * 10
  return Math.round(m);
}

const table = {};
let total = 0;
for (const l of LEVELS) {
  if (!l || !l.name) continue;
  const v = levelMax(l);
  table[l.name] = v;
  total += v;
}
fs.writeFileSync(OUT, JSON.stringify(table, null, 0) + '\n');
console.log('wrote', path.relative(path.join(__dirname, '..', '..'), OUT), '—', Object.keys(table).length, 'levels, sum', total);
// spot-check a few
for (const nm of ['1-1', '2-3', '7-1', '7-2', '7-3', '21-3', 'MYSPACE']) {
  if (table[nm] != null) console.log('  ', nm.padEnd(10), table[nm]);
}
