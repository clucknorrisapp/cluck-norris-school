#!/usr/bin/env node
/**
 * A RUN CANNOT CLAIM A WORLD THE WALLET WAS NEVER ENTITLED TO PLAY.
 *
 * Nothing checked this. /api/nq/run-start and /api/nq/run-checkpoint take no session token at all,
 * and /api/nq/wallet/verify hands a valid session to ANY signature-valid keypair — tier 0, zero
 * holdings, a freshly generated keypair with no funds. checkpoint() enforces level-graph adjacency
 * and an 8s dwell, both calibrated against "90 level names in a minute", not against a patient
 * script. So a throwaway wallet could walk the graph to world 21 over ~15 minutes of scripted
 * calls, submit a score kept just under the budget ceiling, and land on the board as verified and
 * NOT suspect — invisible to the "☠ SUSPECT RUNS" list the owner reviews before handing out the
 * weekly physical prize. The one human check was defeated by construction.
 *
 * The access tiers are already the product's rule (free 1-3 · $5 → 4-12 · $50 → all). This asserts
 * the rule is enforced where the prize is decided.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// ISOLATE THE STORE. The leaderboard persists, so without this the run inherits rows from every
// previous run — including the deliberately-forged rows a mutation run leaves behind as NOT
// suspect, which then fail the board-exclusion check on the very next (correct) run. A test whose
// result depends on what earlier runs wrote is not a test.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nq-tiergate-'));

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const gate = require(path.join(__dirname, '..', 'nq-gate.js'));

console.log('\ngate.allowsWorld\n');
ok('exists', typeof gate.allowsWorld === 'function');
// Stub rather than exit, so a mutation run still reaches the leaderboard half. Bailing on the
// first missing export hides everything after it, which is how a test ends up proving less than
// it looks like it does.
if (typeof gate.allowsWorld !== 'function') gate.allowsWorld = () => true;

ok('"all" covers every real world', gate.allowsWorld('all', 1) && gate.allowsWorld('all', 21));
ok('a free tier [1,3] covers world 3', gate.allowsWorld([1, 3], 3) === true);
ok('a free tier [1,3] does NOT cover world 4', gate.allowsWorld([1, 3], 4) === false);
ok('THE ATTACK: tier 0 [1,3] does NOT cover world 21', gate.allowsWorld([1, 3], 21) === false);
ok('a $5 tier [1,12] does NOT cover world 13', gate.allowsWorld([1, 12], 13) === false);
ok('a $5 tier [1,12] covers world 12', gate.allowsWorld([1, 12], 12) === true);
ok('a world below the range is refused', gate.allowsWorld([4, 12], 2) === false);
for (const bad of [null, undefined, 0, -1, NaN, 'x', {}])
  ok(`a nonsense world (${JSON.stringify(bad)}) is refused`, gate.allowsWorld('all', bad) === false);
for (const bad of [null, undefined, 'everything', [1], [1, 2, 3], {}])
  ok(`an unknown worlds shape (${JSON.stringify(bad)}) is refused, not waved through`,
     gate.allowsWorld(bad, 5) === false);

console.log('\nleaderboard honours a forced suspect flag\n');
process.env.NQ_LB_SECRET = process.env.NQ_LB_SECRET || 'test-secret-for-tier-gate';
const lb = require(path.join(__dirname, '..', 'nq-leaderboard.js'));

(async () => {
  // A legitimate short run: start at 1-1, submit a modest score. Not forced -> not suspect.
  const start = lb.startRun('1-1');
  const clean = await lb.add({ name: 'legit', world: 1, level: '1-1', score: 10, lives: 3,
                               wallet: null, walletVerified: false, mode: 'test' }, start);          // startRun returns the token object itself
  ok('an ordinary run is accepted and not suspect', clean.ok === true && clean.suspect === false,
     JSON.stringify(clean));

  // The same run, but the route determined the wallet's tier never reached that world.
  const start2 = lb.startRun('1-1');
  const forced = await lb.add({ name: 'forged', world: 1, level: '1-1', score: 10, lives: 3,
                                wallet: null, walletVerified: false, mode: 'test',
                                forceSuspect: 'world_above_wallet_tier' }, start2);
  ok('a run the route flags is stored as SUSPECT', forced.ok === true && forced.suspect === true,
     JSON.stringify(forced));
  ok('and it carries the reason, so the review list says WHY',
     forced.suspectReason === 'world_above_wallet_tier', String(forced.suspectReason));

  // Suspect entries must stay off the public board — that is what "flagged" has to mean.
  const rows = await Promise.resolve(lb.topByWorld(1, 50)).catch(() => null);
  if (Array.isArray(rows)) {
    ok('a suspect run does not appear on the public board',
       !rows.some((r) => r.name === 'forged'), JSON.stringify(rows.map((r) => r.name)));
    ok('while the ordinary run does', rows.some((r) => r.name === 'legit'),
       JSON.stringify(rows.map((r) => r.name)));
  } else {
    console.log('  – board read unavailable in this harness, skipping board-exclusion check');
  }

  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
