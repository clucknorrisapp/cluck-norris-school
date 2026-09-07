#!/usr/bin/env node
/**
 * nq-world-art-check — WORLD_ART integrity, pure node, no browser, no server.
 *
 * WHY (deep dive §9.5): every level's painted backdrop is loaded lazily by KEY through the
 * `WORLD_ART` map (`def.bgArt` -> `WORLD_ART[def.bgArt]` -> a static file URL), specifically so
 * boot stays light. Nothing proves that chain end to end today: a typo in a level's `bgArt`, or a
 * WORLD_ART entry pointing at a filename that was renamed/deleted, ships GREEN — the level still
 * parses and boots, and the missing backdrop only shows up as a blank/black level in front of a
 * real player (or a Phaser texture-load error nobody is watching for). This closes that hole with
 * two static checks:
 *
 *   1. every LEVELS[].bgArt names a real key in WORLD_ART.
 *   2. every WORLD_ART value resolves to a file that actually exists under
 *      normie-quest/public/worlds/.
 *
 * "any world→plate map" from the task: WORLD_ART is the only such map in game_logic.js today
 * (grepped — every backdrop load, including the mid-run world-clear prefetch at ~:6776, indexes
 * the SAME object). If a second one is ever added, extend MAPS below.
 *
 *   node normie-quest/test/nq-world-art-check.cjs [--json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GL = path.join(ROOT, 'normie-quest', 'src', 'game_logic.js');
const WORLDS_DIR = path.join(ROOT, 'normie-quest', 'public', 'worlds');
const JSON_OUT = process.argv.includes('--json');

const src = fs.readFileSync(GL, 'utf8');

// ---- LEVELS (mirrors nq-geometry-check.cjs's bracket-depth extraction) -------------------------
function loadLevels() {
  const start = src.indexOf('var LEVELS=[');
  if (start < 0) return null;
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const H = 270, TILE = 24, W = 480, GY = H - TILE;
  try { return new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(open, end + 1) + ';')(H, TILE, W, GY); }
  catch (e) { console.error('[nq-world-art-check] LEVELS parse failed: ' + e.message); return null; }
}

// ---- WORLD_ART (a flat { key: '/normie-quest/worlds/file.webp' } object literal) ---------------
function loadWorldArt() {
  const m = /var WORLD_ART=(\{[\s\S]*?\});/.exec(src);
  if (!m) return null;
  try { return new Function('return ' + m[1])(); }
  catch (e) { console.error('[nq-world-art-check] WORLD_ART parse failed: ' + e.message); return null; }
}

const levels = loadLevels();
const worldArt = loadWorldArt();
if (!levels) { console.error('[nq-world-art-check] could not parse LEVELS — check the extraction against game_logic.js'); process.exit(2); }
if (!worldArt) { console.error('[nq-world-art-check] could not parse WORLD_ART — check the extraction against game_logic.js'); process.exit(2); }

const fails = [];

// 1. every level's bgArt key must exist in WORLD_ART
for (const lv of levels) {
  if (!lv || typeof lv.name !== 'string') continue;
  if (lv.bgArt == null) continue;   // a level with no painted backdrop (solid-colour theme) is fine
  if (!Object.prototype.hasOwnProperty.call(worldArt, lv.bgArt)) {
    fails.push(`level '${lv.name}' has bgArt:'${lv.bgArt}' — no such key in WORLD_ART`);
  }
}

// 2. every WORLD_ART value must resolve to a real file under normie-quest/public/worlds/
// WORLD_ART values are '/normie-quest/worlds/<file>' — that URL prefix is the static mount
// (server.js), and the on-disk plates live one level down at normie-quest/public/worlds/<file>.
const URL_PREFIX = '/normie-quest/worlds/';
for (const [key, url] of Object.entries(worldArt)) {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) {
    fails.push(`WORLD_ART.${key} = ${JSON.stringify(url)} does not start with '${URL_PREFIX}' — cannot resolve it under public/worlds/`);
    continue;
  }
  const file = url.slice(URL_PREFIX.length);
  const full = path.join(WORLDS_DIR, file);
  if (!fs.existsSync(full)) {
    fails.push(`WORLD_ART.${key} -> ${url} — no file at normie-quest/public/worlds/${file}`);
  }
}

// Reverse sanity, reported as a warning rather than a failure: a WORLD_ART key no level currently
// references. Not wrong (art can be staged ahead of the level that will use it, or shared/kept for
// a hidden room), so this never fails the build — just surfaced for a human to notice drift.
const referenced = new Set(levels.filter(l => l && l.bgArt).map(l => l.bgArt));
const unreferenced = Object.keys(worldArt).filter(k => !referenced.has(k));

if (JSON_OUT) {
  console.log(JSON.stringify({ levels: levels.length, worldArtKeys: Object.keys(worldArt).length, fails, unreferenced }, null, 1));
} else {
  console.log(`[nq-world-art-check] ${levels.length} levels, ${Object.keys(worldArt).length} WORLD_ART keys, ${Object.keys(worldArt).length - unreferenced.length}/${Object.keys(worldArt).length} referenced`);
  for (const f of fails) console.log('  ✗ ' + f);
  if (unreferenced.length) console.log(`  (info) ${unreferenced.length} WORLD_ART key(s) not referenced by any level: ${unreferenced.join(', ')}`);
  console.log(`RESULT: ${fails.length ? 'FAIL ✗ (' + fails.length + ' broken art reference(s))' : 'PASS ✓'}`);
}
process.exit(fails.length ? 1 : 0);
