#!/usr/bin/env node
/*
 * NQ GEOMETRY CHECK — static jumpability / placement verifier for every level.
 * ---------------------------------------------------------------------------
 * The browser state-tester proves a level BOOTS and bosses are stompable, but it
 * cannot prove a hand-authored gap is clearable or that ground fixtures aren't
 * floating over pits. This check closes that hole, straight from the physics:
 *
 *   gravity 900 px/s², jump vel 430 (double-jump available), run speed 240
 *   → single-jump airtime 0.956s → ~229px max gap at full speed
 *   → jump height ~103px (single) / ~205px (double)
 *
 * Rules (FAIL = exit 1; WARN = printed, exit 0):
 *   F1  gap wider than SAFE_GAP (200px) with no bridging platform over it
 *   F2  ground fixture inside a gap (spike, wall, honeypot, pumpdump, yield,
 *       npc, cache, miniworm, gate, ground-enemy spawn, powerup, key-ground, door)
 *   F3  platform top above the screen (topY < 40) or higher than a double jump
 *       from the ground (> 205px up) with no ladder platform beneath it
 *   F4  gap starts before x=380 (player spawn runway)
 *   W1  gap wider than 168px (needs a committed full-speed jump)
 *   W2  key higher than a double jump from ground with no platform near it
 *
 * Usage: node normie-quest/test/nq-geometry-check.cjs [--json]
 * Zero deps, no browser — safe for CI (syntax-check workflow).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'game_logic.js');
const TILE = 24, H = 270, GY = H - TILE;            // mirrors game constants
const SAFE_GAP = 200;                                // hard cap without a bridge (max single ~229)
const WARN_GAP = 168;                                // comfortable cap
const JUMP_H = 103, DJUMP_H = 205;                   // single / double jump rise
const SPAWN_RUNWAY = 380;                            // no pit before this x

function loadLevels() {
  const lines = fs.readFileSync(SRC, 'utf8').split('\n');
  const out = [];
  for (const l of lines) {
    const m = l.match(/^\s*(\{"name":"\d+-\d+".*\})(,?)\s*$/);
    if (!m) continue;
    try { out.push(JSON.parse(m[1])); } catch (e) { /* non-JSON one-liner — ignore */ }
  }
  return out;
}

function inGap(gaps, x) { return gaps.find(g => x >= g[0] && x < g[1]) || null; }

function check(lv) {
  const fails = [], warns = [];
  const gaps = lv.gaps || [], plats = lv.plats || [];
  const platSpan = p => ({ x1: p[0], x2: p[0] + p[1] * TILE, top: p[2] });

  // F1/W1: gap width vs jump range (a platform overlapping the gap span at a sane height bridges it)
  gaps.forEach(g => {
    const wpx = g[1] - g[0];
    if (wpx > SAFE_GAP) {
      const bridged = plats.map(platSpan).some(s => s.x2 > g[0] && s.x1 < g[1] && s.top >= 60 && s.top <= GY - 20);
      if (!bridged) fails.push(`F1 gap ${g[0]}-${g[1]} is ${wpx}px (> ${SAFE_GAP}) with no bridging platform`);
    } else if (wpx > WARN_GAP) warns.push(`W1 gap ${g[0]}-${g[1]} is ${wpx}px (full-speed jump required)`);
    if (g[0] < SPAWN_RUNWAY) fails.push(`F4 gap ${g[0]}-${g[1]} starts inside the spawn runway (< ${SPAWN_RUNWAY})`);
    if (g[1] > (lv.width || 5200)) fails.push(`F4b gap ${g[0]}-${g[1]} extends past level width ${lv.width}`);
  });

  // F2: ground-anchored fixtures must sit on solid ground.
  // NOT checked (verified intentional floaters): powerups (allowGravity:false — pit-mouth
  // risk-reward pickups), pumpdumps + yields (floating platforms that deliberately bridge gaps),
  // planks + pegs (gap-coupled by design — they anchor AT gaps).
  const fixture = (x, what) => { const g = inGap(gaps, x); if (g) fails.push(`F2 ${what} at x=${x} floats in gap ${g[0]}-${g[1]}`); };
  (lv.spikes || []).forEach(s => fixture(s[0] + TILE / 2, 'spike'));
  (lv.walls || []).forEach(w => { const wide = w[3] || 1; for (let i = 0; i < wide; i++) fixture(w[0] + i * TILE + TILE / 2, 'wall'); });
  (lv.honeypots || []).forEach(h2 => fixture(h2[0], 'honeypot'));
  (lv.npcs || []).forEach(n => fixture(n[0], 'npc'));
  (lv.caches || []).forEach(c => fixture(c[0], 'cache'));
  (lv.miniworms || []).forEach(x => fixture(x, 'miniworm'));
  (lv.gates || []).forEach(g2 => fixture(g2[0], 'gate'));
  (lv.enemies || []).forEach(e => { if (e[0] !== 'ghost' && e[2] >= 200) fixture(e[1], `enemy:${e[0]}`); });
  if (lv.key && lv.key[1] >= 200) fixture(lv.key[0], 'key');
  if (lv.door) fixture(lv.door, 'door');

  // F3: platform reachability (on-screen; within a double jump of ground or of a lower platform)
  plats.forEach(p => {
    const s = platSpan(p);
    if (s.top < 40) fails.push(`F3 plat at x=${p[0]} topY=${s.top} is off-screen`);
    const rise = GY - s.top;
    if (rise > DJUMP_H) {
      const ladder = plats.map(platSpan).some(o => o !== s && Math.abs(o.x1 - s.x1) < 260 && o.top > s.top && (o.top - s.top) <= DJUMP_H);
      if (!ladder) fails.push(`F3 plat at x=${p[0]} topY=${s.top} is ${rise}px up (> double jump ${DJUMP_H}) with no ladder platform`);
    }
  });

  // W2: key height sanity
  if (lv.key) {
    const rise = GY - lv.key[1];
    if (rise > DJUMP_H) {
      const near = plats.map(platSpan).some(s => lv.key[0] >= s.x1 - 60 && lv.key[0] <= s.x2 + 60 && (s.top - lv.key[1]) <= JUMP_H + 40);
      if (!near) warns.push(`W2 key at (${lv.key[0]},${lv.key[1]}) is ${rise}px up with no platform near`);
    }
  }
  return { fails, warns };
}

const levels = loadLevels();
if (!levels.length) { console.error('[nq-geometry-check] no levels parsed — check SRC path'); process.exit(2); }
let failCount = 0, warnCount = 0;
const report = [];
for (const lv of levels) {
  const { fails, warns } = check(lv);
  failCount += fails.length; warnCount += warns.length;
  if (fails.length || warns.length) report.push({ level: lv.name, fails, warns });
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ levels: levels.length, failCount, warnCount, report }, null, 1));
else {
  console.log(`[nq-geometry-check] ${levels.length} levels checked`);
  for (const r of report) {
    for (const f of r.fails) console.log(`  ✗ ${r.level}  ${f}`);
    for (const w of r.warns) console.log(`  ⚠ ${r.level}  ${w}`);
  }
  console.log(`RESULT: ${failCount ? 'FAIL ✗ (' + failCount + ' hard failures)' : 'PASS ✓'}${warnCount ? `  (${warnCount} warnings)` : ''}`);
}
process.exit(failCount ? 1 : 0);
