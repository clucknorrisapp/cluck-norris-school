// Leaderboard anti-forgery test: proves the v2 points-budget + checkpoint scheme accepts a
// legitimate run and rejects (flags suspect) forged / over-budget / skip-ahead scores.
// Run: node normie-quest/test/nq-leaderboard-test.cjs
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.NQ_LB_SECRET = 'test-secret-fixed-0123456789';
process.env.DATA_DIR = path.join(os.tmpdir(), 'nqlbtest-' + crypto.randomBytes(4).toString('hex'));

const lb = require('../nq-leaderboard.js');
const SECRET = process.env.NQ_LB_SECRET;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

// Build a legit token chain: startRun(level0) then checkpoint the rest, returning the final token.
function reach(levels) {
  let tok = lb.startRun(levels[0]);
  for (let i = 1; i < levels.length; i++) {
    const r = lb.checkpoint(tok, levels[i]);
    if (!r.ok) throw new Error('checkpoint failed at ' + levels[i] + ': ' + r.status);
    tok = r.token;
  }
  return tok;
}
function budgetOf(levels) { return [...new Set(levels)].reduce((s, n) => s + lb.levelBudget(n), 0); }

(async () => {
  const mainStart = ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3'];

  // 1. Legit run within budget → accepted, NOT suspect.
  {
    const tok = reach(mainStart);
    const cap = budgetOf(mainStart);
    const r = await lb.add({ name: 'legit', world: 2, level: 'run', score: Math.max(1, cap - 200) }, tok);
    ok('legit run within budget is accepted + not suspect', r.ok === true && r.suspect === false);
  }

  // 2. Over-budget score on the SAME proven levels → suspect.
  {
    const tok = reach(mainStart);
    const cap = budgetOf(mainStart);
    const r = await lb.add({ name: 'cheat', world: 2, level: 'run', score: cap + 500000 }, tok);
    ok('over-budget score is flagged suspect', r.ok === true && r.suspect === true);
  }

  // 3. Claiming a world beyond what was checkpointed (reached world 1 only, claim world 21) → suspect.
  {
    const tok = reach(['1-1', '1-2', '1-3']);
    const r = await lb.add({ name: 'skip', world: 21, level: 'run', score: 100 }, tok);
    ok('skip-ahead world claim is flagged suspect', r.ok === true && r.suspect === true);
  }

  // 4. Impossible world (>21) → suspect even with a valid token.
  {
    const tok = reach(mainStart);
    const r = await lb.add({ name: 'world99', world: 99, level: 'run', score: 100 }, tok);
    ok('impossible world (>21) is flagged suspect', r.ok === true && r.suspect === true);
  }

  // 5. No token at all → rejected outright.
  {
    const r = await lb.add({ name: 'notoken', world: 1, level: 'run', score: 100 }, null);
    ok('tokenless submit is rejected', r.ok === false);
  }

  // 6. Tampered token (inflate max by hand) → rejected as bad_token.
  {
    const tok = reach(mainStart);
    const forged = { ...tok, max: tok.max + 1000000 };
    const r = await lb.add({ name: 'tamper', world: 2, level: 'run', score: tok.max + 500000 }, forged);
    ok('tampered max in token is rejected (bad signature)', r.ok === false && r.status === 'bad_token');
  }

  // 7. Replay: the same token can only submit once.
  {
    const tok = reach(mainStart);
    const cap = budgetOf(mainStart);
    const r1 = await lb.add({ name: 'once', world: 2, level: 'run', score: Math.max(1, cap - 200) }, tok);
    const r2 = await lb.add({ name: 'twice', world: 2, level: 'run', score: Math.max(1, cap - 200) }, tok);
    ok('first submit accepted, replay of same token rejected', r1.ok === true && r2.ok === false && r2.status === 'replay');
  }

  // 8. Checkpoint dedupe: re-reaching the same level does not double-credit its budget.
  {
    const tokA = reach(['3-1', '3-1', '3-1']);
    const tokB = reach(['3-1']);
    ok('duplicate checkpoints do not inflate the ceiling', tokA.max === tokB.max && tokA.max === lb.levelBudget('3-1'));
  }

  // 9. Legacy v1 token (pre-checkpoint client during rollout) still works via the time fallback.
  {
    const nonce = crypto.randomBytes(12).toString('hex');
    const issuedAt = Date.now() - 60000;   // 60s ago → passes MIN_RUN_MS
    const sig = crypto.createHmac('sha256', SECRET).update(nonce + '.1-1.' + issuedAt).digest('hex').slice(0, 32);
    const v1 = { nonce, level: '1-1', issuedAt, sig };
    const r = await lb.add({ name: 'legacy', world: 1, level: 'run', score: 500 }, v1);   // 500 over 60s = 8.3/s, fine
    ok('legacy v1 token still accepted (rollout compat)', r.ok === true && r.suspect === false);
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
