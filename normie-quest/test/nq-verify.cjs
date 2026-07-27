#!/usr/bin/env node
/*
 * NQ VERIFY — pick the RIGHT checks for the change you actually made, and run only those.
 * ---------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The full state test boots all 82 levels in a headless browser. It is the right gate for a
 * change to shared game code, and it is completely wasted on a copy tweak or a new sprite —
 * a text layout change cannot break level 40. On 2026-07-27 a whole day went into running the
 * full suite for targeted edits: an icon swap, an item removal, a banner layout. Hours, for
 * coverage that could not have caught anything.
 *
 * The rule was agreed and then not followed, because "is this change risky enough?" is a
 * judgement call made in the moment by someone who wants to get on with it. So this removes
 * the judgement: it reads the diff and decides.
 *
 * WHAT IT DECIDES  (conservative — when in doubt it runs MORE, and always says why)
 *   nothing changed .................. syntax only
 *   assets / build.js only ........... syntax + build + ONE smoke level
 *   LEVELS data only ................. syntax + build + geometry + state test on the CHANGED LEVELS
 *   game code (non-LEVELS) ........... syntax + build + geometry + FULL state test
 *   server/lib only .................. node --check on the touched files (no browser at all)
 *
 * The precise bit is "the CHANGED LEVELS": it parses the LEVELS array from git HEAD and from the
 * working tree and diffs them per level, so editing 3-3's pits tests 3-3 — not 82 levels.
 *
 * Usage:  node normie-quest/test/nq-verify.cjs [baseUrl] [--against <ref>] [--dry]
 *   --against <ref>  compare to this git ref instead of HEAD (e.g. origin/main for a whole branch)
 *   --dry            print the plan and exit without running anything
 */
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GL = 'normie-quest/src/game_logic.js';
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ai = argv.indexOf('--against');
const REF = ai >= 0 ? argv[ai + 1] : 'HEAD';
const BASE = argv.find(a => /^https?:\/\//.test(a)) || process.env.NQ_TEST_BASE || 'http://localhost:8099';

const sh = (cmd, opts) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const say = (s) => console.log(s);

// ---- what changed -----------------------------------------------------------------------------
let changed = [];
try {
  changed = sh(`git diff --name-only ${REF} -- . && git ls-files --others --exclude-standard`)
    .split('\n').map(s => s.trim()).filter(Boolean);
  changed = [...new Set(changed)];
} catch (e) { console.error('git diff failed: ' + e.message); process.exit(2); }

if (!changed.length) { say('[nq-verify] no changes vs ' + REF + ' — nothing to check.'); process.exit(0); }

// ---- split game_logic.js into LEVELS data vs everything else -----------------------------------
// A change confined to the LEVELS literal can only affect the levels it touched. A change ANYWHERE
// else in the file is shared machinery (physics, boss code, HUD, scenes) and can affect all 82.
function splitGameLogic(src) {
  const st = src.indexOf('var LEVELS=');
  if (st < 0) return null;
  const op = src.indexOf('[', st);
  let d = 0, en = -1;
  for (let i = op; i < src.length; i++) {
    const c = src[i];
    if (c === '[') d++; else if (c === ']') { d--; if (!d) { en = i; break; } }
  }
  if (en < 0) return null;
  const H = 270, TILE = 24, W = 480, GY = H - TILE;
  let levels = null;
  try { levels = new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(op, en + 1) + ';')(H, TILE, W, GY); } catch (e) { /* unparseable */ }
  return { rest: src.slice(0, st) + src.slice(en + 1), levels };
}

let plan = { syntax: true, build: false, geometry: false, state: null, reason: [] };
const touched = f => changed.includes(f);

if (touched(GL)) {
  const cur = fs.readFileSync(path.join(ROOT, GL), 'utf8');
  let old = null;
  try { old = execFileSync('git', ['show', `${REF}:${GL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { old = null; }
  const A = old && splitGameLogic(old), B = splitGameLogic(cur);
  plan.build = true;

  if (!A || !B || !A.levels || !B.levels) {
    plan.geometry = true; plan.state = 'ALL';
    plan.reason.push('could not parse LEVELS on both sides — assuming the worst and running everything');
  } else if (A.rest !== B.rest) {
    plan.geometry = true; plan.state = 'ALL';
    plan.reason.push('game_logic.js changed OUTSIDE the LEVELS array (shared code) — every level can be affected');
  } else {
    // only level data moved — find exactly which levels
    const key = l => JSON.stringify(l);
    const oldByName = new Map(A.levels.map(l => [l.name, key(l)]));
    const newByName = new Map(B.levels.map(l => [l.name, key(l)]));
    const names = new Set([...oldByName.keys(), ...newByName.keys()]);
    const diff = [...names].filter(n => oldByName.get(n) !== newByName.get(n));
    plan.geometry = true;
    plan.state = diff.length ? diff : [];
    plan.reason.push(diff.length
      ? `only LEVELS data changed — testing the ${diff.length} changed level(s), not all ${B.levels.length}`
      : 'LEVELS array reformatted but no level actually differs — geometry only');
  }
}

// Test harnesses and docs cannot affect the shipped game, so they must not drag in a full run --
// otherwise the tool that exists to stop over-testing becomes a reason to over-test.
const otherNq = changed.filter(f => f.startsWith('normie-quest/') && f !== GL
  && !f.startsWith('normie-quest/test/') && !/\.md$/.test(f));
if (otherNq.length) {
  plan.build = true;
  const assetsOnly = otherNq.every(f => /\/src\/assets\/|\/public\/worlds\/|\/public\/sfx\//.test(f));
  if (assetsOnly && plan.state === null) {
    plan.state = ['1-1'];
    plan.reason.push('assets only — one smoke level proves the build still boots');
  } else if (!assetsOnly && plan.state === null) {
    plan.state = 'ALL';
    plan.reason.push('normie-quest code changed outside game_logic.js — full run');
  }
}

const backend = changed.filter(f => /^(server\.js|lib\/|.*\/routes\.js|.*\.js)$/.test(f) && !f.startsWith('normie-quest/'));

// ---- report -----------------------------------------------------------------------------------
say('[nq-verify] vs ' + REF + ' — ' + changed.length + ' changed file(s)');
changed.slice(0, 12).forEach(f => say('    ' + f));
if (changed.length > 12) say('    … and ' + (changed.length - 12) + ' more');
say('');
plan.reason.forEach(r => say('  · ' + r));
if (!plan.reason.length) say('  · no game changes — backend/docs only');
say('');
say('  PLAN: syntax' + (plan.build ? ' + build' : '') + (plan.geometry ? ' + geometry' : '') +
    (plan.state === 'ALL' ? ' + FULL state test (82 levels)'
      : Array.isArray(plan.state) && plan.state.length ? ` + state test on: ${plan.state.join(', ')}`
      : ''));
say('');
if (DRY) process.exit(0);

// ---- run --------------------------------------------------------------------------------------
let failed = 0;
const step = (name, fn) => {
  process.stdout.write('  → ' + name + ' … ');
  try { const out = fn(); say('ok'); if (out) say(out.split('\n').filter(Boolean).map(l => '      ' + l).join('\n')); }
  catch (e) { failed++; say('FAIL'); say((e.stdout || e.message || '').toString().split('\n').slice(-25).map(l => '      ' + l).join('\n')); }
};

step('syntax (all script blocks)', () => {
  const src = fs.readFileSync(path.join(ROOT, GL), 'utf8');
  const parts = src.split(/<\/?script[^>]*>/);
  let bad = [];
  parts.forEach((p, i) => { if (!p.trim()) return; try { new Function(p); } catch (e) { bad.push('block ' + i + ': ' + e.message); } });
  if (bad.length) throw new Error(bad.join('\n'));
  return '';
});
backend.forEach(f => step('node --check ' + f, () => { sh(`node --check ${JSON.stringify(f)}`); return ''; }));
if (plan.build) step('build', () => sh('node normie-quest/src/build.js').trim());
if (plan.geometry) step('geometry (82 levels)', () => sh('node normie-quest/test/nq-geometry-check.cjs').trim().split('\n').slice(-3).join('\n'));

if (plan.state === 'ALL' || (Array.isArray(plan.state) && plan.state.length)) {
  const only = plan.state === 'ALL' ? '' : plan.state.join(',');
  const label = plan.state === 'ALL' ? 'state test — ALL 82 levels' : `state test — ${plan.state.length} level(s)`;
  step(label, () => sh(`node normie-quest/test/nq-state-test.cjs ${JSON.stringify(BASE)}`, {
    env: { ...process.env, NQ_ONLY: only, NODE_PATH: path.join(ROOT, 'node_modules') },
    maxBuffer: 1 << 26,
  }).trim().split('\n').slice(-6).join('\n'));
}

say('');
say(failed ? `[nq-verify] ${failed} step(s) FAILED` : '[nq-verify] all checks passed ✓');
process.exit(failed ? 1 : 0);
