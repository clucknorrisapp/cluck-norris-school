#!/usr/bin/env node
/*
 * NQ INTERSTITIAL COVERAGE — pure node, no browser.
 * ------------------------------------------------
 * Worlds 16-21 shipped with no Briefing and no WorldClear card: six of the top tier's nine
 * worlds cut from a generic clear straight into the next level, and nothing could see it
 * because both tables are plain data keyed by a LEVEL INDEX. Rekey a level, insert a world,
 * or add world 22 and the gap comes back silently. So assert the invariant directly:
 *
 *   1. every world boundary (the FIRST level index of worlds 2..N) has a BRIEFINGS entry
 *   2. ...and a WORLD_CLEARS entry, whose `world` is the world you just CLEARED (boundary-1)
 *   3. every WORLD_CLEARS `theme` is a real THEMES index and matches the arriving world's theme
 *   4. every WORLD_CLEARS boss image key is a texture the game actually loads
 *   5. every BRIEFINGS `tex` key is a texture the game actually loads
 *   6. no reward / prize / payout language in either table (NQ's terms with the NORMIE team
 *      are unagreed — these cards are public copy on every build)
 *
 * Usage: node normie-quest/test/nq-interstitial-coverage.cjs
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'game_logic.js');
const src = fs.readFileSync(SRC, 'utf8');

// Pull one top-level `var NAME=<literal>` out of the source by balanced-delimiter scan and eval it.
function literal(name, open, close) {
  const st = src.search(new RegExp('^var ' + name + '\\s*=', 'm'));
  if (st < 0) throw new Error('cannot find var ' + name);
  const op = src.indexOf(open, st);
  let d = 0, en = -1;
  for (let i = op; i < src.length; i++) {
    const c = src[i];
    if (c === open) d++;
    else if (c === close) { d--; if (!d) { en = i; break; } }
  }
  if (en < 0) throw new Error('unbalanced ' + name);
  const H = 270, TILE = 24, W = 480, GY = H - TILE;
  return new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(op, en + 1) + ';')(H, TILE, W, GY);
}

const LEVELS = literal('LEVELS', '[', ']');
const THEMES = literal('THEMES', '[', ']');
const BRIEFINGS = literal('BRIEFINGS', '{', '}');
const WORLD_CLEARS = literal('WORLD_CLEARS', '{', '}');

// Texture keys the game really has: the base64 sprite tables + everything drawn in Boot.
const TEX = new Set();
for (const line of src.split('\n')) {
  if (/^var (SPRITES|POWERUPS|EXTRA|SCARY_ART|CHAR_ART)=/.test(line) || /^\s{2}[a-z]+:'__[A-Z]+__'/.test(line)) {
    for (const m of line.matchAll(/([A-Za-z0-9_]+)\s*:\s*'(?:data:image|__[A-Z0-9_]+__)/g)) TEX.add(m[1]);
  }
}
for (const m of src.matchAll(/generateTexture\('([A-Za-z0-9_]+)'/g)) TEX.add(m[1]);
TEX.add('princess');   // composited at runtime by makePrincessTex

// Only PROMISE words. "reward token" and "the tower rewards momentum" are honest crypto/level
// copy; what must never appear on these cards is a prize, a payout or a guarantee, because NQ's
// reward terms with the NORMIE team are unagreed and these cards render on every build.
const BANNED = /\b(prizes?|payouts?|jackpot|winnings|guaranteed)\b|\byou (?:will|'ll) (?:receive|get|win|earn)\b/i;

let fails = [], checked = 0;
const F = m => fails.push(m);

// world boundaries, derived from the level names (never hand-typed)
const firstOf = new Map();
LEVELS.forEach((l, i) => {
  const m = /^(\d+)-\d+$/.exec(l.name || '');
  if (m && !firstOf.has(+m[1])) firstOf.set(+m[1], i);
});
const worlds = [...firstOf.keys()].sort((a, b) => a - b);

for (const w of worlds) {
  if (w === 1) continue;                       // world 1 is entered from Controls, not a clear card
  const idx = firstOf.get(w);
  checked++;
  const b = BRIEFINGS[idx], c = WORLD_CLEARS[idx];
  if (!b) F(`world ${w} (level ${LEVELS[idx].name}, idx ${idx}) has NO BRIEFINGS entry`);
  if (!c) F(`world ${w} (level ${LEVELS[idx].name}, idx ${idx}) has NO WORLD_CLEARS entry`);
  if (c) {
    if (c.world !== w - 1) F(`WORLD_CLEARS[${idx}].world is ${c.world}; entering world ${w} means world ${w - 1} was cleared`);
    if (!THEMES[c.theme]) F(`WORLD_CLEARS[${idx}].theme ${c.theme} is not a THEMES index`);
    else if (LEVELS[idx].theme !== c.theme) F(`WORLD_CLEARS[${idx}].theme ${c.theme} != arriving level ${LEVELS[idx].name}'s theme ${LEVELS[idx].theme}`);
    if (!c.boss || !TEX.has(c.boss.img)) F(`WORLD_CLEARS[${idx}].boss.img '${c.boss && c.boss.img}' is not a loaded texture`);
    for (const f of ['title', 'dest', 'story', 'color']) if (!c[f]) F(`WORLD_CLEARS[${idx}] is missing ${f}`);
    if (!c.term || !c.term.name || !c.term.def) F(`WORLD_CLEARS[${idx}] has no crypto term`);
  }
  if (b) {
    for (const grp of ['powers', 'threats']) {
      const rows = b[grp] || [];
      if (rows.length < 2) F(`BRIEFINGS[${idx}].${grp} has ${rows.length} entries (expected 2)`);
      rows.forEach(r => { if (!TEX.has(r.tex)) F(`BRIEFINGS[${idx}].${grp}: tex '${r.tex}' is not a loaded texture`); });
    }
    if (!b.title || !b.tip) F(`BRIEFINGS[${idx}] is missing title/tip`);
  }
}

// copy discipline — these cards render on every build, and NQ's reward terms are unagreed
const scanCopy = (tag, obj) => {
  JSON.stringify(obj, (k, v) => { if (typeof v === 'string' && BANNED.test(v)) F(`${tag} copy uses reward/prize language: "${v.slice(0, 70)}"`); return v; });
};
scanCopy('WORLD_CLEARS', WORLD_CLEARS);
scanCopy('BRIEFINGS', BRIEFINGS);

// hinted speakeasies in the free worlds must not open onto a fight the player cannot see coming
LEVELS.forEach((l, i) => {
  const wm = /^(\d+)-/.exec(l.name || '');
  if (!wm || +wm[1] > 2) return;
  (l.warps || []).forEach(wp => {
    const t = LEVELS[wp[1]];
    if (!t) return F(`${l.name} warps to idx ${wp[1]}, which is not a level`);
    if ((t.enemies || []).length) F(`${l.name}'s bonus room ${t.name} has ${t.enemies.length} enemies — worlds 1-2 secrets are meant to be safe rooms`);
    if (!wp[2]) F(`${l.name}'s warp at x=${wp[0]} is unhinted — a free-tier secret nobody can find is not a secret`);
  });
});

console.log(`[nq-interstitial-coverage] ${checked} world boundaries checked, ${Object.keys(WORLD_CLEARS).length} clear cards, ${Object.keys(BRIEFINGS).length} briefings`);
if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); console.log(`RESULT: FAIL (${fails.length})`); process.exit(1); }
console.log('RESULT: PASS ✓');
