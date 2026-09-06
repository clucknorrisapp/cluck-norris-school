#!/usr/bin/env node
/*
 * NQ VERIFY — pick the RIGHT checks for the change you actually made, and run only those.
 * ---------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The full state test boots EVERY level in a headless browser. It is the right gate for a
 * change to the game ENGINE, and it is completely wasted on a copy tweak, a new sprite or a
 * between-level card — a text layout change cannot break level 40. On 2026-07-27 a whole day
 * went into running the full suite for targeted edits: an icon swap, an item removal, a banner
 * layout. Hours, for coverage that could not have caught anything. On 2026-09-05 it happened
 * again: a change to the LevelClear beat planned a 90-level run, which then timed out under load.
 *
 * The rule was agreed and then not followed, because "is this change risky enough?" is a
 * judgement call made in the moment by someone who wants to get on with it. So this removes
 * the judgement: it reads the diff and decides.
 *
 * WHAT IT DECIDES  (conservative — when in doubt it runs MORE, and always says why)
 *   nothing changed ......................... syntax only
 *   comments / whitespace only .............. syntax + build (nothing shipped changed)
 *   art / sfx / music only .................. syntax + build + ONE smoke level + VISUAL gate
 *                                             (+ boss-ground if a boss plate changed)
 *   LEVELS data only ........................ syntax + build + geometry + state test on the CHANGED LEVELS
 *   game_logic.js — interstitial scenes ..... build + ONE smoke level + the beat/panel test
 *     (LevelClear, WorldClear, VipPitch, Briefing, Win, Over, Controls + their helpers)
 *   game_logic.js — menus (Boot/Title) ...... build + ONE smoke level + VISUAL gate
 *   game_logic.js — DOM layer ............... build + ONE smoke level + beat/panel test + VISUAL gate
 *     (wallet panel, settings, D-pad, joystick, gamepad, fullscreen, lab bench)
 *   game_logic.js — lab hooks only .......... build + ONE smoke level
 *   game_logic.js — ENGINE .................. build + geometry + FULL state test (sharded in CI)
 *     (constants, SFX/music, Game scene + its helpers, the Phaser config)
 *   other normie-quest code ................. FULL state test (unknown = worst case)
 *   server/lib only ......................... node --check on the touched files (no browser at all)
 *   normie-quest/*.js server modules ........ node --check + the two unit suites (no browser at all)
 *
 * "Structural" means the ENGINE or a level's DATA. An icon, a backdrop, a card between levels, a
 * menu, a DOM control — none of those can change whether level 40 loads or its boss can be
 * stomped, so none of them buy a full run. (Owner, 2026-09-06: "only need to do full reviews of
 * levels if something structurally changed to the levels, not like an icon change or background
 * change".)
 *
 * The precise bits: it parses the LEVELS array from git and from the working tree and diffs them
 * per level, so editing 3-3's pits tests 3-3 — not every level. And it splits the REST of
 * game_logic.js into named regions (the scene classes, the DOM blocks, the lab hooks) and diffs
 * each region with comments stripped, so a change to the LevelClear card is "interstitial", not
 * "game code changed — run everything".
 *
 * The built shells (normie-quest/public/normie-quest-*.html) are DERIVED from game_logic.js +
 * assets by src/build.js and are ignored here — they used to count as "other normie-quest code"
 * and dragged every rebuilt commit into a full run.
 *
 * A FULL run is sharded across machines with NQ_SHARD=i/n (see nq-state-test.cjs); CI does that
 * with a matrix (the nq-state job). Locally, one box gets no faster by adding agents — NQ_WORKERS
 * already uses half the cores.
 *
 * Usage:  node normie-quest/test/nq-verify.cjs [baseUrl] [--against <ref>] [--dry] [--json]
 *                                              [--shard i/n] [--no-visual]
 *   --against <ref>  compare to this git ref instead of HEAD (e.g. origin/main for a whole branch)
 *   --dry            print the plan and exit without running anything
 *   --json           print the plan as JSON (for CI) and exit
 *   --shard i/n      run only shard i of n of the planned state test (cross-machine split)
 *   --no-visual      skip the visual gate step even when planned (CI runs it in its own job)
 */
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GL = 'normie-quest/src/game_logic.js';
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const DRY = argv.includes('--dry') || JSON_OUT;
const NO_VISUAL = argv.includes('--no-visual');
const ai = argv.indexOf('--against');
const REF = ai >= 0 ? argv[ai + 1] : 'HEAD';
const si = argv.indexOf('--shard');
const SHARD = si >= 0 ? argv[si + 1] : (process.env.NQ_SHARD || '');
const BASE = argv.find(a => /^https?:\/\//.test(a)) || process.env.NQ_TEST_BASE || 'http://localhost:8099';

const sh = (cmd, opts) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const say = (s) => { if (!JSON_OUT) console.log(s); };

// ---- what changed -----------------------------------------------------------------------------
let changed = [];
try {
  changed = sh(`git diff --name-only ${REF} -- . && git ls-files --others --exclude-standard`)
    .split('\n').map(s => s.trim()).filter(Boolean);
  changed = [...new Set(changed)];
} catch (e) { console.error('git diff failed: ' + e.message); process.exit(2); }

const plan = { syntax: true, build: false, geometry: false, state: null, smoke: false, beat: false, visual: false, bossGround: false, reason: [] };
const finish = () => {
  if (JSON_OUT) { console.log(JSON.stringify({ ref: REF, changed, plan }, null, 2)); }
};
if (!changed.length) { say('[nq-verify] no changes vs ' + REF + ' — nothing to check.'); plan.syntax = false; finish(); process.exit(0); }

// ---- split game_logic.js into LEVELS data vs everything else -----------------------------------
// A change confined to the LEVELS literal can only affect the levels it touched. A change ANYWHERE
// else in the file is classified by REGION below.
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

// ---- regions of the non-LEVELS code, and what each one can break ---------------------------------
// Boundaries are the top-level constructs of game_logic.js in file order. A region runs from its
// boundary to the next one; 'pre' is everything before the first (constants, SFX, music, helpers).
// If the file gains a new scene class, add a boundary here — an unknown construct simply lands in
// the preceding region, which is the conservative direction only when that region is ENGINE.
const REGION_BOUNDS = [
  [/^\/\* ---------- Boot ---------- \*\//m, 'Boot'],
  [/^var LevelSelect=new Phaser\.Class/m, 'LevelSelect'],
  [/^var Title=new Phaser\.Class/m, 'Title'],
  [/^\/\* ---------- Game \(data-driven, multi-level\) ---------- \*\//m, 'GameHelpers'],
  [/^var Game=new Phaser\.Class/m, 'Game'],
  [/^\/\* ---------- Over ---------- \*\//m, 'Over'],
  [/^\/\* ---------- Win ---------- \*\//m, 'Win'],
  [/^\/\* ---------- WorldClear/m, 'WorldClear'],
  [/^\/\* ---------- Controls/m, 'Controls'],
  [/^\/\* ---------- Briefing/m, 'Briefing'],
  [/^\/\* ---------- NORMIE NATION/m, 'BetweenHelpers'],
  [/^\/\* ---------- LevelClear/m, 'LevelClear'],
  [/^\/\* ---------- VipPitch/m, 'VipPitch'],
  [/^var NQGAME=new Phaser\.Game/m, 'config'],
  [/^try\{ if\(typeof window!=='undefined'\) window\.__NQ_TOLEVELS=/m, 'labHooks'],
  [/^\/\* ---------- ⛶ Fullscreen/m, 'dom'],
];
// engine: can change how ANY level builds or plays → full state test.
// interstitial: the screens between levels → beat/panel test + one smoke level.
// menu: title/boot → smoke level + visual gate.  dom: overlays + controls → beat + smoke + visual.
// harness: the lab hooks the tests themselves use → smoke level proves they still work.
const REGION_CLASS = {
  pre: 'engine', Boot: 'menu', LevelSelect: 'menu', Title: 'menu', GameHelpers: 'engine', Game: 'engine', config: 'engine',
  Over: 'interstitial', Win: 'interstitial', WorldClear: 'interstitial', Controls: 'interstitial', Briefing: 'interstitial',
  BetweenHelpers: 'interstitial', LevelClear: 'interstitial', VipPitch: 'interstitial',
  labHooks: 'harness', dom: 'dom',
};
function regionsOf(rest) {
  const cuts = [];
  for (const [re, name] of REGION_BOUNDS) { const m = re.exec(rest); if (m) cuts.push([m.index, name]); }
  cuts.sort((a, b) => a[0] - b[0]);
  const out = {};
  let prev = ['pre', 0];
  for (const [at, name] of cuts) { out[prev[0]] = rest.slice(prev[1], at); prev = [name, at]; }
  out[prev[0]] = rest.slice(prev[1]);
  return out;
}
// Comments and blank lines are not shipped behaviour. Strip whole-line `//` and `/* */` blocks that
// start a line, plus trailing `// ` remarks (the space keeps `http://` intact). A `// ` inside a
// string literal is also stripped — that is the one under-test this accepts; it is rare here.
function stripComments(s) {
  return s
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(\s)\/\/ .*$/gm, '$1')
    .split('\n').map(l => l.trimEnd()).filter(l => l.trim()).join('\n');
}

// The level count is DERIVED from the working tree (it was hand-typed as 82 while the graph had 90).
const LEVEL_COUNT = (() => { try { const p = splitGameLogic(fs.readFileSync(path.join(ROOT, GL), 'utf8')); return p && p.levels ? p.levels.length : null; } catch (e) { return null; } })();
const NLEV = LEVEL_COUNT ? `${LEVEL_COUNT} levels` : 'all levels';

const touched = f => changed.includes(f);
let regionClasses = [];   // the classes of the game_logic.js regions that actually changed

if (touched(GL)) {
  const cur = fs.readFileSync(path.join(ROOT, GL), 'utf8');
  let old = null;
  try { old = execFileSync('git', ['show', `${REF}:${GL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { old = null; }
  const A = old && splitGameLogic(old), B = splitGameLogic(cur);
  plan.build = true;

  if (!A || !B || !A.levels || !B.levels) {
    plan.geometry = true; plan.state = 'ALL';
    plan.reason.push('could not parse LEVELS on both sides — assuming the worst and running everything');
  } else {
    // 1. the LEVELS data, per level
    const key = l => JSON.stringify(l);
    const oldByName = new Map(A.levels.map(l => [l.name, key(l)]));
    const newByName = new Map(B.levels.map(l => [l.name, key(l)]));
    const names = new Set([...oldByName.keys(), ...newByName.keys()]);
    const diffLevels = [...names].filter(n => oldByName.get(n) !== newByName.get(n));

    // 2. everything else, per region, comments ignored
    const RA = regionsOf(A.rest), RB = regionsOf(B.rest);
    const regionNames = [...new Set([...Object.keys(RA), ...Object.keys(RB)])];
    const changedRegions = regionNames.filter(r => stripComments(RA[r] || '') !== stripComments(RB[r] || ''));
    regionClasses = [...new Set(changedRegions.map(r => REGION_CLASS[r] || 'engine'))];

    if (regionClasses.includes('engine')) {
      plan.geometry = true; plan.state = 'ALL';
      plan.reason.push(`ENGINE code changed (${changedRegions.filter(r => (REGION_CLASS[r] || 'engine') === 'engine').join(', ')}) — every level can be affected: full state test`);
    } else {
      if (changedRegions.length) {
        plan.smoke = true;
        plan.reason.push(`game_logic.js changed only in ${changedRegions.join(', ')} (${regionClasses.join(' + ')}) — no level can be affected; one smoke level`);
        if (regionClasses.includes('interstitial') || regionClasses.includes('dom')) { plan.beat = true; plan.reason.push('between-level screens / DOM layer changed — the beat-vs-panel test'); }
        if (regionClasses.includes('menu') || regionClasses.includes('dom')) { plan.visual = true; plan.reason.push('menus / DOM layer changed — the visual gate'); }
      }
      if (diffLevels.length) {
        plan.geometry = true; plan.state = diffLevels; plan.smoke = false;   // the level run proves the boot too
        plan.reason.push(`LEVELS data changed — testing the ${diffLevels.length} changed level(s), not all ${B.levels.length}`);
      } else if (A.rest !== B.rest && !changedRegions.length) {
        plan.reason.push('game_logic.js differs only in comments / whitespace — build proves it still assembles');
      } else if (!changedRegions.length && key(A.levels) !== key(B.levels)) {
        plan.geometry = true;
        plan.reason.push('LEVELS array reformatted but no level actually differs — geometry only');
      }
    }
  }
}

// Test harnesses and docs cannot affect the shipped game, so they must not drag in a full run --
// otherwise the tool that exists to stop over-testing becomes a reason to over-test. The same goes
// for the top-level server modules (routes.js, nq-*.js): they are backend, checked below, and a
// browser run of every level cannot see a change in them. The built shells are derived output.
const isNqServer = f => /^normie-quest\/[^/]+\.js$/.test(f);
const isBuiltShell = f => /^normie-quest\/public\/normie-quest-(platformer|play)\.html$/.test(f);
const isAsset = f => /^normie-quest\/(src\/assets\/|public\/(worlds|sfx|music|pwa)\/)/.test(f);
// The plates nq-boss-ground.cjs measures (its BOSSES table). A swapped plate with a different bottom
// margin silently re-sinks or floats a boss — CLAUDE.md, 2026-08-16.
const isBossPlate = f => /(rugking|scammykol|ceoboss|cut_tom|shark|sandlord|ghostship)/.test(f);
const otherNq = changed.filter(f => f.startsWith('normie-quest/') && f !== GL
  && !f.startsWith('normie-quest/test/') && !/\.md$/.test(f) && !isNqServer(f) && !isBuiltShell(f) && f !== 'normie-quest/src/build.js');
const assets = otherNq.filter(isAsset);
const otherCode = otherNq.filter(f => !isAsset(f) && f !== 'normie-quest/public/lounge.html');
if (assets.length) {
  plan.build = true;
  if (plan.state === null) plan.smoke = true;
  if (!NO_VISUAL) plan.visual = true;
  plan.reason.push(`${assets.length} art/sfx asset(s) changed — build + one smoke level + the visual gate (an icon or backdrop cannot break a level)`);
  if (assets.some(isBossPlate)) { plan.bossGround = true; plan.reason.push('a BOSS PLATE changed — bosses scale by height, so nq-boss-ground measures feet on GY'); }
}
if (changed.some(isBuiltShell)) plan.reason.push('built shells (normie-quest/public/normie-quest-*.html) are derived output — classified through their sources, not on their own');
if (touched('normie-quest/src/build.js')) { plan.build = true; if (plan.state === null) plan.smoke = true; plan.reason.push('build.js changed — build + one smoke level'); }
if (otherCode.length) {
  plan.build = true;
  if (plan.state === null) { plan.state = 'ALL'; plan.geometry = true; }
  plan.reason.push(`normie-quest code changed outside game_logic.js (${otherCode.join(', ')}) — unknown reach, full run`);
}
if (plan.smoke && plan.state === null) plan.state = ['1-1'];
if (plan.state === 'ALL') plan.smoke = false;

const backend = changed.filter(f => /^(server\.js|lib\/|.*\/routes\.js|.*\.js)$/.test(f) && (!f.startsWith('normie-quest/') || isNqServer(f)));
const nqServer = changed.filter(isNqServer);

// ---- report -----------------------------------------------------------------------------------
if (JSON_OUT) { finish(); process.exit(0); }
say('[nq-verify] vs ' + REF + ' — ' + changed.length + ' changed file(s)');
changed.slice(0, 12).forEach(f => say('    ' + f));
if (changed.length > 12) say('    … and ' + (changed.length - 12) + ' more');
say('');
plan.reason.forEach(r => say('  · ' + r));
if (nqServer.length) say('  · normie-quest server module(s) changed — node --check + unit suites, no browser run');
if (!plan.reason.length && !nqServer.length) say('  · no game changes — backend/docs only');
say('');
const stateLabel = plan.state === 'ALL' ? ' + FULL state test (' + NLEV + (SHARD ? `, shard ${SHARD}` : '') + ')'
  : Array.isArray(plan.state) && plan.state.length ? (plan.smoke ? ' + smoke level ' + plan.state.join(', ') : ` + state test on: ${plan.state.join(', ')}`) : '';
say('  PLAN: syntax' + (plan.build ? ' + build' : '') + (plan.geometry ? ' + geometry' : '') + stateLabel
  + (plan.beat ? ' + beat/panel test' : '') + (plan.visual && !NO_VISUAL ? ' + visual gate' : '') + (plan.bossGround ? ' + boss-ground' : ''));
if (plan.state === 'ALL' && !SHARD) {
  say('');
  say('  A full run is the one that takes long. Split it across MACHINES, not agents on this box:');
  say('    CI runs it as a 6-shard matrix (the nq-state job) when the plan says FULL;');
  say('    by hand: NQ_SHARD=1/3, 2/3, 3/3 on three boxes/sessions (or --shard i/n here).');
}
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
if (nqServer.length) {
  step('nq-leaderboard-test', () => sh('node normie-quest/test/nq-leaderboard-test.cjs').trim().split('\n').slice(-2).join('\n'));
  step('nq-claims-test', () => sh('node normie-quest/test/nq-claims-test.cjs').trim().split('\n').slice(-2).join('\n'));
}
if (plan.geometry) step('geometry (' + NLEV + ')', () => sh('node normie-quest/test/nq-geometry-check.cjs').trim().split('\n').slice(-3).join('\n'));

if (plan.state === 'ALL' || (Array.isArray(plan.state) && plan.state.length)) {
  const only = plan.state === 'ALL' ? '' : plan.state.join(',');
  const label = plan.state === 'ALL' ? 'state test — ALL ' + NLEV + (SHARD ? ` (shard ${SHARD})` : '')
    : plan.smoke ? 'smoke level ' + plan.state.join(', ') : `state test — ${plan.state.length} level(s)`;
  step(label, () => sh(`node normie-quest/test/nq-state-test.cjs ${JSON.stringify(BASE)}`, {
    env: { ...process.env, NQ_ONLY: only, NQ_SHARD: plan.state === 'ALL' ? SHARD : '', NODE_PATH: path.join(ROOT, 'node_modules') },
    maxBuffer: 1 << 26,
  }).trim().split('\n').slice(-6).join('\n'));
}
if (plan.beat) step('beat vs wallet panel (boots its own server)', () => sh('node normie-quest/test/nq-beat-panel-test.cjs', { maxBuffer: 1 << 24 }).trim().split('\n').slice(-3).join('\n'));
if (plan.bossGround) step('boss ground', () => sh(`node normie-quest/test/nq-boss-ground.cjs ${JSON.stringify(BASE)}`, { maxBuffer: 1 << 24 }).trim().split('\n').slice(-4).join('\n'));
if (plan.visual && !NO_VISUAL) step('visual gate (regression detector, not a judge of taste)', () => sh(`node normie-quest/test/nq-visual.cjs ${JSON.stringify(BASE)}`, { maxBuffer: 1 << 24 }).trim().split('\n').slice(-8).join('\n'));

say('');
say(failed ? `[nq-verify] ${failed} step(s) FAILED` : '[nq-verify] all checks passed ✓');
process.exit(failed ? 1 : 0);
