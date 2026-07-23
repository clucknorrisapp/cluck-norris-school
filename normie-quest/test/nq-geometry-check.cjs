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
  // footing = anything you can land/run on that overlaps the gap span: a platform, a plank run,
  // a pump-dump, a mover, or a peg run (all provide a crossing). A bare wide gap is a leap of faith.
  const footingOver = (g) => {
    if (plats.map(platSpan).some(s => s.x2 > g[0] && s.x1 < g[1] && s.top >= 60 && s.top <= GY - 20)) return true;
    if ((lv.planks || []).some(p => { const x1 = p[0], x2 = p[0] + (p[1] || 3) * TILE; return x2 > g[0] && x1 < g[1]; })) return true;
    if ((lv.pegs || []).some(p => { const x1 = p[0], x2 = p[0] + (p[1] || 3) * TILE; return x2 > g[0] && x1 < g[1]; })) return true;
    if ((lv.pumpdumps || []).some(p => p[0] > g[0] - 24 && p[0] < g[1] + 24)) return true;
    if ((lv.movers || []).some(mv => mv[0] > g[0] - 40 && mv[0] < g[1] + 40)) return true;
    return false;
  };
  gaps.forEach(g => {
    const wpx = g[1] - g[0];
    if (wpx > SAFE_GAP) {
      if (!footingOver(g)) fails.push(`F1 gap ${g[0]}-${g[1]} is ${wpx}px (> ${SAFE_GAP}) with no footing (platform/plank/pumpdump/mover) over it`);
    } else if (wpx > WARN_GAP && !footingOver(g)) {
      // owner rule 2026-07-23: a wide-ish gap with nothing over it is a bare leap — flag it.
      warns.push(`W1 gap ${g[0]}-${g[1]} is ${wpx}px and BARE — add footing over it or narrow it`);
    }
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

  // F5: powerup buried in/behind an obstacle (owner sweep ask 2026-07-23 — the structure
  // generator's avoid-list didn't include powerups, so walls could land on boosts).
  // A powerup is buried if its point sits inside a WALL's tile rect, inside a PLAT's tile
  // rect, or within 24px of a SPIKE (grabbing it would hurt — an unintended trap).
  (lv.powerups || []).forEach(p => {
    const px = p[1], py = p[2];
    (lv.walls || []).forEach(w2 => {
      const x1 = w2[0], x2 = w2[0] + (w2[3] || 1) * TILE, top = GY - w2[1] * TILE;
      if (px >= x1 - 8 && px <= x2 + 8 && py >= top - 10) fails.push(`F5 powerup:${p[0]} at (${px},${py}) buried in wall x${x1}-${x2} (top ${top})`);
    });
    (lv.plats || []).forEach(pl => {
      const x1 = pl[0], x2 = pl[0] + pl[1] * TILE, top = pl[2];
      if (px >= x1 - 8 && px <= x2 + 8 && py >= top - 10 && py <= top + TILE + 10) fails.push(`F5 powerup:${p[0]} at (${px},${py}) inside plat x${x1}-${x2}@${top}`);
    });
    (lv.spikes || []).forEach(s => {
      if (Math.abs(px - (s[0] + TILE / 2)) < 24 && py >= 200) fails.push(`F5 powerup:${p[0]} at (${px},${py}) sits on spikes at x${s[0]}`);
    });
  });

  // F6: a ? bonus-block must not overlap ANY solid/interactive object — walls, platforms,
  // pump-dumps, rug-plats, yield-lifts, gates, honeypots, caches, movers, or another bonusblock
  // (owner sweep 2026-07-23: ? blocks were rendering jammed inside every kind of block).
  const overlap = (ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) => ax2 > bx1 && ax1 < bx2 && ay2 > by1 && ay1 < by2;
  const BB = (lv.bonusblocks || []).map(bb => ({ x: bb[0], y: (bb[2] != null ? bb[2] : (H - 96)) }));
  BB.forEach(bb => {
    const bl = bb.x - 12, bt = bb.y - 12, br = bb.x + 12, bd = bb.y + 12;
    const hit = (what) => fails.push(`F6 bonusblock at (${bb.x},${bb.y}) overlaps ${what}`);
    (lv.walls || []).forEach(w2 => { const x1 = w2[0] - 4, x2 = w2[0] + (w2[3] || 1) * TILE + 4, top = GY - w2[1] * TILE; if (overlap(bl, bt, br, bd, x1, top, x2, GY)) hit(`wall x${w2[0]}`); });
    (lv.plats || []).forEach(p => { const x1 = p[0] - 4, x2 = p[0] + p[1] * TILE + 4; if (overlap(bl, bt, br, bd, x1, p[2] - 14, x2, p[2] + 14)) hit(`plat x${p[0]}`); });
    (lv.pumpdumps || []).forEach(p => { if (overlap(bl, bt, br, bd, p[0] - 16, p[1] - 16, p[0] + 16, p[1] + 16)) hit(`pumpdump x${p[0]}`); });
    (lv.rugplats || []).forEach(p => { const x1 = p[0] - 2, x2 = p[0] + p[1] * TILE + 2; if (overlap(bl, bt, br, bd, x1, p[2] - 2, x2, p[2] + TILE + 2)) hit(`rugplat x${p[0]}`); });
    (lv.yields || []).forEach(p => { const yb = (p[1] != null ? p[1] : H - 96); if (overlap(bl, bt, br, bd, p[0] - 16, yb - 16, p[0] + 16, yb + 16)) hit(`yield x${p[0]}`); });
    (lv.gates || []).forEach(g => { if (overlap(bl, bt, br, bd, g[0] - 8, GY - 84, g[0] + 8, GY)) hit(`gate x${g[0]}`); });
    (lv.honeypots || []).forEach(h2 => { if (overlap(bl, bt, br, bd, h2[0] - 18, h2[1] - 18, h2[0] + 18, h2[1] + 18)) hit(`honeypot x${h2[0]}`); });
    (lv.caches || []).forEach(c => { const cy = (c[1] != null ? c[1] : GY - 18); if (overlap(bl, bt, br, bd, c[0] - 14, cy - 14, c[0] + 14, cy + 14)) hit(`cache x${c[0]}`); });
    (lv.movers || []).forEach(mv => { if (overlap(bl, bt, br, bd, mv[0] - 26, mv[1] - 10, mv[0] + 26, mv[1] + 10)) hit(`mover x${mv[0]}`); });
  });
  for (let a = 0; a < BB.length; a++) for (let b = a + 1; b < BB.length; b++) {
    if (Math.abs(BB[a].x - BB[b].x) < 26 && Math.abs(BB[a].y - BB[b].y) < 26) fails.push(`F6 bonusblocks overlap at x${BB[a].x} / x${BB[b].x}`);
  }

  // W5: MONOTONOUS gaps (owner rule 2026-07-23: 'not all of them should be the same width').
  // With 4+ gaps, if every gap is within 24px of the same width, the level reads as identical
  // hops over and over — vary them (some narrow bare hops, some wide planked crossings).
  if (gaps.length >= 4) {
    const ws = gaps.map(g => g[1] - g[0]);
    const spread = Math.max(...ws) - Math.min(...ws);
    const distinct = new Set(ws.map(w => Math.round(w / 24))).size;
    if (spread <= 24 || distinct <= 2) warns.push(`W5 gaps are monotonous (${gaps.length} gaps, widths ${ws.join('/')}) — vary the widths`);
  }

  // W3/W4: powerup DISTRIBUTION (panel finding on 13-2 — generalized to every level).
  // W3 = cluster: two powerups on ~one screen (<350px). W4 = desert: with 3+ powerups, the
  // first sits past 45% of the level or some stretch longer than half the level has none.
  const pux = (lv.powerups || []).map(p => p[1]).sort((a, b) => a - b);
  for (let i = 1; i < pux.length; i++) {
    if (pux[i] - pux[i - 1] < 350) warns.push(`W3 powerup cluster: x=${pux[i - 1]} and x=${pux[i]} are ${pux[i] - pux[i - 1]}px apart (<350)`);
  }
  if (pux.length >= 3) {
    const wpx = lv.width || 5200;
    if (pux[0] > wpx * 0.45) warns.push(`W4 powerup desert: first powerup at x=${pux[0]} (past 45% of ${wpx})`);
    for (let i = 1; i < pux.length; i++) {
      if (pux[i] - pux[i - 1] > wpx * 0.5) warns.push(`W4 powerup desert: ${pux[i] - pux[i - 1]}px stretch with none (x=${pux[i - 1]}→${pux[i]})`);
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
