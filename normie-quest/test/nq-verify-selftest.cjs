#!/usr/bin/env node
/**
 * nq-verify-selftest — proves nq-verify.cjs's own REGION_BOUNDS still find their markers, and
 * find them IN THE RIGHT ORDER, inside game_logic.js.
 *
 * WHY THIS EXISTS (deep dive §9.3): nq-verify.cjs splits game_logic.js into named regions by
 * matching each REGION_BOUNDS regex against a banner comment or a top-level declaration, in file
 * order — see regionsOf() in nq-verify.cjs. If a banner comment is ever reworded (or a scene is
 * renamed) so that ONE boundary regex stops matching, that region silently MERGES into the
 * region before it: nothing errors, nq-verify just reports fewer regions than really exist. The
 * dangerous direction is when the swallowed region is classified 'engine' or 'dom' and the
 * region it merges into is classified something weaker (e.g. 'interstitial' or 'menu') — a change
 * to real engine code would then plan only a smoke level instead of the full state test, with no
 * signal that anything was missed. Concretely: the 'Game' boundary anchors `nqWorldAllowed` and
 * the tier-gate helpers; if that regex ever stopped matching, gate code would silently downgrade
 * from full-state coverage to a between-level "interstitial" plan.
 *
 * This does NOT require('./nq-verify.cjs') — that file is a runnable script with no
 * `require.main` guard (unlike nq-boss-ground.cjs), so requiring it would execute its entire
 * plan-and-run flow, including possibly spawning the state test / visual gate / browser tests.
 * Instead it reads nq-verify.cjs as TEXT and evaluates just the REGION_BOUNDS array literal out
 * of it, so this file and nq-verify.cjs cannot drift apart, and it can never trigger a run.
 *
 *   node normie-quest/test/nq-verify-selftest.cjs
 *
 * Zero deps, no server, no browser — safe for the node-check / nq-state-plan CI jobs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const VERIFY_PATH = path.join(__dirname, 'nq-verify.cjs');
const GL_PATH = path.join(ROOT, 'normie-quest', 'src', 'game_logic.js');

function extractRegionBounds(src) {
  // The array literal in nq-verify.cjs: `const REGION_BOUNDS = [ [...], ... ];`. Matched
  // non-greedily up to the FIRST top-level `];` that closes it — the literal contains no nested
  // `];` sequences (each entry is `[/regex/m, 'Name'],`), so this is safe without a bracket-depth
  // walk like nq-geometry-check.cjs needs for LEVELS (which nests arrays).
  const m = /const REGION_BOUNDS = (\[[\s\S]*?\n\];)/.exec(src);
  if (!m) return null;
  // Evaluated, not JSON-parsed: the entries are `[regExpLiteral, 'string']` pairs, which JSON
  // cannot represent. There is nothing here but literals — no function calls, no I/O — so a plain
  // eval of the extracted text is safe.
  try { return new Function('return ' + m[1])(); }
  catch (e) { console.error('[nq-verify-selftest] REGION_BOUNDS in nq-verify.cjs failed to evaluate: ' + e.message); return null; }
}

const verifySrc = fs.readFileSync(VERIFY_PATH, 'utf8');
const glSrc = fs.readFileSync(GL_PATH, 'utf8');
const REGION_BOUNDS = extractRegionBounds(verifySrc);

if (!Array.isArray(REGION_BOUNDS) || !REGION_BOUNDS.length) {
  console.error('[nq-verify-selftest] could not find a non-empty REGION_BOUNDS array in nq-verify.cjs — did it move, get renamed, or change shape?');
  process.exit(1);
}

let pass = 0, fail = 0;
console.log('\nnq-verify-selftest — ' + REGION_BOUNDS.length + ' REGION_BOUNDS markers vs game_logic.js\n');

let lastIndex = -1, lastName = '(start of file)';
for (const entry of REGION_BOUNDS) {
  if (!Array.isArray(entry) || entry.length !== 2 || !(entry[0] instanceof RegExp) || typeof entry[1] !== 'string') {
    console.log('  FAIL  malformed REGION_BOUNDS entry: ' + JSON.stringify(entry));
    fail++;
    continue;
  }
  const [re, name] = entry;
  const m = re.exec(glSrc);
  if (!m) {
    console.log(`  FAIL  ${name}: ${re} does not match game_logic.js AT ALL — this region would silently vanish into the previous one`);
    fail++;
    continue;
  }
  if (m.index <= lastIndex) {
    console.log(`  FAIL  ${name}: matched at offset ${m.index}, which is not AFTER '${lastName}' (offset ${lastIndex}) — boundaries out of order silently merge the region in between`);
    fail++;
    continue;
  }
  console.log(`  ok    ${name.padEnd(16)} @ offset ${m.index}`);
  pass++;
  lastIndex = m.index; lastName = name;
}

console.log('');
console.log(fail === 0
  ? `[nq-verify-selftest] all ${pass} region markers match game_logic.js, in order ✓`
  : `[nq-verify-selftest] ${fail} FAILED, ${pass} ok`);
process.exit(fail === 0 ? 0 : 1);
