#!/usr/bin/env node
/*
 * NQ MUSIC ROUTING CHECK — which loop every level scores, with no browser.
 * ------------------------------------------------------------------------
 * Guards F7. The router used to read `def.name.charAt(0)`, so:
 *   • every 10-x .. 19-x level answered '1' and played the WORLD 1 tutorial theme (36 levels)
 *   • worlds 20 and 21 fell through the same chain to that default
 *   • world 9 (The Mines) never matched its own track
 *   • world 8 sent 8-1 and 8-2 into the BOSS theme before there was a boss
 * The fix parses the world NUMBER. This check replays the real routing function against the real
 * LEVELS array — both lifted straight out of game_logic.js, no Phaser, no DOM — so the bug class
 * cannot come back silently.
 *
 * Rules (any FAIL -> exit 1):
 *   R1  no level in world 3 or above routes to the world-1 theme
 *   R2  8-1 and 8-2 do not route to the boss track (only a level with a bossType may)
 *   R3  every routed track name actually exists in the MUSIC track table (TR)
 *   R4  every numbered world resolves to exactly ONE non-boss track (no split identity)
 *
 * Usage: node normie-quest/test/nq-music-routing.cjs [--json]
 * Zero deps, no browser, no server — safe for CI.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'game_logic.js');
const src = fs.readFileSync(SRC, 'utf8');

// --- lift a balanced [...] / {...} / function body out of the source ------------------------
function balanced(from, openCh, closeCh) {
  const open = src.indexOf(openCh, from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

// LEVELS: pure data plus the geometry constants (same trick nq-geometry-check.cjs uses).
function loadLevels() {
  const start = src.indexOf('var LEVELS=[');
  if (start < 0) { console.error('[nq-music-routing] LEVELS not found'); process.exit(1); }
  const body = balanced(start, '[', ']');
  const H = 270, TILE = 24, W = 480, GY = H - TILE;   // mirrors game_logic.js line 4
  try { return new Function('H', 'TILE', 'W', 'GY', 'return ' + body + ';')(H, TILE, W, GY); }
  catch (e) { console.error('[nq-music-routing] LEVELS parse failed:', e.message); process.exit(1); }
}

// nqTrackFor: the routing function itself, evaluated as-is. If it is renamed or inlined again,
// this check fails loudly rather than testing a stale copy of the logic.
function loadRouter() {
  const start = src.indexOf('function nqTrackFor(def){');
  if (start < 0) { console.error('[nq-music-routing] nqTrackFor() not found — did the router get inlined again?'); process.exit(1); }
  const body = balanced(start, '{', '}');
  try { return new Function('return function nqTrackFor(def)' + body + ';')(); }
  catch (e) { console.error('[nq-music-routing] nqTrackFor parse failed:', e.message); process.exit(1); }
}

// The MUSIC track table (var TR={...}) — names only, so a typo'd track can't silently play nothing.
function loadTrackNames() {
  const start = src.indexOf('  var TR={');
  if (start < 0) return null;
  const body = balanced(start, '{', '}');
  const names = new Set();
  const re = /\n\s{4}([a-zA-Z0-9_]+)\s*:\s*\{/g;
  let m;
  while ((m = re.exec(body))) names.add(m[1]);
  return names.size ? names : null;
}

const LEVELS = loadLevels();
const trackFor = loadRouter();
const TRACKS = loadTrackNames();

const rows = [];
const fails = [];
const perWorld = {};

for (const lv of LEVELS) {
  const name = (lv && lv.name) || '';
  const track = trackFor(lv);
  const m = /^(\d+)-(\d+)$/.exec(name);
  const world = m ? parseInt(m[1], 10) : 0;
  rows.push({ name, world, track, boss: lv && lv.bossType ? lv.bossType : null });

  // R1 — worlds 3+ must never fall back to the tutorial theme
  if (world >= 3 && track === 'world1') fails.push(`R1 ${name} routes to the WORLD 1 theme`);
  // R2 — the boss track belongs to boss arenas only
  if (track === 'boss' && !(lv && lv.bossType)) fails.push(`R2 ${name} routes to the BOSS track with no boss`);
  // R3 — the track has to exist
  if (TRACKS && !TRACKS.has(track)) fails.push(`R3 ${name} routes to '${track}', which is not in the MUSIC table`);
  // R4 — collect the non-boss track per world. 2-1 (Sand Lands) and 2-2 (the Casino) are the
  // router's two deliberate per-LEVEL cases, so world 2 is exempt from the one-identity rule.
  if (world && world !== 2 && !(lv && lv.bossType) && !(lv && lv.music)) {
    (perWorld[world] = perWorld[world] || new Set()).add(track);
  }
}

// R2, named explicitly: the two levels the old charAt(0) chain sent to the boss theme.
for (const n of ['8-1', '8-2']) {
  const r = rows.find((x) => x.name === n);
  if (r && r.track === 'boss') fails.push(`R2 ${n} routes to the BOSS track`);
}

// R4 — one identity per world
for (const w of Object.keys(perWorld)) {
  if (perWorld[w].size > 1) fails.push(`R4 world ${w} splits across tracks: ${[...perWorld[w]].join(', ')}`);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: !fails.length, fails, rows }, null, 2));
} else {
  const worlds = Object.keys(perWorld).map(Number).sort((a, b) => a - b);
  console.log('[nq-music-routing] per-world track (non-boss levels):');
  for (const w of worlds) console.log('  world ' + String(w).padStart(2) + ' -> ' + [...perWorld[w]].join(', '));
  console.log('  (world 2 is omitted — split by design: 2-1 desert / 2-2 casino)');
  console.log('[nq-music-routing] ' + rows.length + ' levels routed, ' + worlds.length + ' numbered worlds');
  if (fails.length) { console.error('\nFAIL (' + fails.length + '):'); fails.forEach((f) => console.error('  ' + f)); }
  else console.log('PASS');
}

process.exit(fails.length ? 1 : 0);
