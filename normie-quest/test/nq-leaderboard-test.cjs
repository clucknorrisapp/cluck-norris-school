// Leaderboard anti-forgery test: proves the v2 points-budget + checkpoint scheme accepts a
// legitimate run and rejects (flags suspect) forged / over-budget / skip-ahead scores — including
// the audit-#6 forgery (checkpoint any level name rapid-fire) via the adjacency + dwell checks,
// and the audit-#29 telemetry hardening (clear needs a run token, world must be a real level).
// Run: node normie-quest/test/nq-leaderboard-test.cjs
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.NQ_LB_SECRET = 'test-secret-fixed-0123456789';
process.env.DATA_DIR = path.join(os.tmpdir(), 'nqlbtest-' + crypto.randomBytes(4).toString('hex'));

// Virtual clock: checkpoint() enforces an 8s minimum dwell between credited levels, so the legit
// paths must simulate real play time. All modules read Date.now() live — offsetting it here moves
// their clock forward without any real waiting.
const realNow = Date.now;
let clockOffset = 0;
Date.now = function () { return realNow() + clockOffset; };
function playFor(ms) { clockOffset += ms; }

const lb = require('../nq-leaderboard.js');
const GRAPH = require('../nq-level-graph.json');
const SECRET = process.env.NQ_LB_SECRET;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

// Build a legit token chain: startRun(level0) then checkpoint the rest at a realistic pace
// (~45s a level — the fastest expert clears), returning the final token.
function reach(levels, dwellMs) {
  if (dwellMs == null) dwellMs = 45000;
  let tok = lb.startRun(levels[0]);
  for (let i = 1; i < levels.length; i++) {
    playFor(dwellMs);
    const r = lb.checkpoint(tok, levels[i]);
    if (!r.ok) throw new Error('checkpoint failed at ' + levels[i] + ': ' + r.status);
    tok = r.token;
  }
  return tok;
}
function budgetOf(levels) { return [...new Set(levels)].reduce((s, n) => s + lb.levelBudget(n), 0); }
// v2 token in the LEGACY (pre-dwell) shape: signed WITHOUT lastCpAt, exactly what a token minted
// before this deploy — or a fresh run-start token — looks like.
function legacyV2(names, ageMs) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const issuedAt = Date.now() - (ageMs || 0);
  const max = budgetOf(names);
  const sig = crypto.createHmac('sha256', SECRET)
    .update('v2|' + names.join('␟') + '|' + max + '|' + nonce + '|' + issuedAt)
    .digest('hex').slice(0, 32);
  return { v: 2, lv: names, max, nonce, issuedAt, sig };
}

(async () => {
  const mainStart = ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3'];

  // 1. Legit run within budget, realistic dwell → accepted, NOT suspect.  [audit #6 case (c)]
  {
    const tok = reach(mainStart);
    const cap = budgetOf(mainStart);
    const r = await lb.add({ name: 'legit', world: 2, level: 'run', score: Math.max(1, cap - 200) }, tok);
    ok('legit adjacent run with realistic dwell is accepted + not suspect', r.ok === true && r.suspect === false);
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

  // ---- audit #6: checkpoint forgery ----------------------------------------------------------

  // 10. THE AUDIT FORGERY, verbatim: run-start at 1-1, checkpoint EVERY level name rapid-fire
  //     (no dwell, no adjacency), submit the summed-budget max score claiming world 21.
  //     Before the fix this came back {ok:true, suspect:false} at rank #1; now the checkpoints
  //     go uncredited and the submit must be suspect (or rejected).
  {
    let tok = lb.startRun('1-1');
    for (const nm of GRAPH.levels) {
      const r = lb.checkpoint(tok, nm);        // rapid-fire: zero virtual time between calls
      if (r.ok && r.token) tok = r.token;      // fail-soft contract: never a hard error
    }
    const maxScore = GRAPH.levels.reduce((s, n) => s + lb.levelBudget(n), 0);   // 527k-class
    const r = await lb.add({ name: 'forger', world: 21, level: 'run', score: maxScore }, tok);
    ok('audit forgery (90 rapid-fire checkpoints, max score) is suspect or rejected',
       r.ok === false || r.suspect === true);
    ok('rapid-fire forgery credited (almost) nothing: ceiling stayed near the start level',
       tok.max <= lb.levelBudget('1-1') + lb.levelBudget('1-2'));   // ≤1 dwell-free credit by design
  }

  // 11. Non-adjacent checkpoint (1-1 then 9-3), even with honest dwell → uncredited, fail-soft.
  {
    let tok = lb.startRun('1-1');
    playFor(45000);
    const r = lb.checkpoint(tok, '9-3');
    ok('non-adjacent checkpoint is uncredited but fail-soft (ok:true, ceiling unchanged)',
       r.ok === true && r.credited === false && r.token.max === lb.levelBudget('1-1'));
  }

  // 12. Legacy v2 token WITHOUT lastCpAt (minted pre-deploy / by run-start) → still accepted:
  //     adjacency applies, the dwell check does not; the reissued token is upgraded (carries
  //     lastCpAt) so every LATER credit is dwell-bound.
  {
    const legacy = legacyV2(['1-1', '1-2'], 120000);
    const r1 = lb.checkpoint(legacy, '1-3');   // adjacent, instant — legacy shape: credit anyway
    const upgraded = r1.ok ? r1.token : null;
    const r2 = upgraded ? lb.checkpoint(upgraded, '2-1') : null;   // instant again — now dwell-bound
    ok('legacy token without lastCpAt: adjacent checkpoint still credits (no dwell check)',
       r1.ok === true && r1.credited === true && r1.token.max === budgetOf(['1-1', '1-2', '1-3']));
    ok('…and the reissued token is dwell-bound from then on',
       !!r2 && r2.ok === true && r2.credited === false && r2.status === 'too_fast');
    playFor(45000);
    const r3 = lb.checkpoint(upgraded, '2-1');   // same token after honest dwell → credits
    const cap = budgetOf(['1-1', '1-2', '1-3', '2-1']);
    const r4 = await lb.add({ name: 'legacy2', world: 2, level: 'run', score: Math.max(1, cap - 200) }, r3.token);
    ok('legacy-origin run submits cleanly after honest play', r3.credited === true && r4.ok === true && r4.suspect === false);
  }

  // 13. Adjacent but FASTER than the 8s dwell floor → uncredited (the 90-in-a-minute chain breaker).
  {
    let tok = lb.startRun('5-1');
    playFor(45000);
    tok = lb.checkpoint(tok, '5-2').token;     // honest credit → token now carries lastCpAt
    playFor(3000);                             // 3s later — faster than any human clear
    const r = lb.checkpoint(tok, '5-3');
    ok('adjacent checkpoint under the 8s dwell floor is uncredited (too_fast)',
       r.ok === true && r.credited === false && r.status === 'too_fast');
  }

  // 14. Unknown level name is never creditable (it would otherwise fake worldOfName claims).
  {
    let tok = lb.startRun('1-1');
    playFor(45000);
    const r = lb.checkpoint(tok, '21-9');      // not a real level
    ok('unknown level name is uncredited', r.ok === true && r.credited === false && r.token.max === lb.levelBudget('1-1'));
  }

  // ---- audit #7: CONTINUE reissue ------------------------------------------------------------
  {
    const carried = Math.max(1, budgetOf(mainStart) - 200);
    // The bug, kept as a contrast case: after game over (submit burns the nonce) the OLD client
    // minted a fresh one-level token, so the banked cumulative total instantly read as forged.
    {
      const tok = reach(mainStart);
      await lb.add({ name: 'cont-old', world: 2, level: 'run', score: carried }, tok);
      const fresh = lb.startRun('2-3');
      const r = await lb.add({ name: 'cont-old', world: 2, level: 'run', score: carried }, fresh);
      ok('carried total vs a fresh one-level token is still (correctly) suspect', r.ok === true && r.suspect === true);
    }
    // The fix: trade the ended token for a same-list reissue and keep playing.
    const tok = reach(mainStart);
    await lb.add({ name: 'cont-fix', world: 2, level: 'run', score: carried }, tok);   // game over burns the nonce
    const c = lb.continueRun(tok);
    ok('continue reissues the same level list with a fresh nonce (same max, same issuedAt)',
       c.ok === true && c.token.nonce !== tok.nonce && c.token.lv.join() === tok.lv.join()
       && c.token.max === tok.max && c.token.issuedAt === tok.issuedAt);
    const dup = lb.checkpoint(c.token, '2-3');    // resumed level -> dedupe no-op
    const fast = lb.checkpoint(c.token, '3-1');   // instant NEW level -> dwell floor still armed
    ok('continued token: resumed level dedupes, instant new level is dwell-bound',
       dup.ok === true && dup.credited === false && fast.ok === true && fast.credited === false && fast.status === 'too_fast');
    playFor(45000);
    const cp = lb.checkpoint(c.token, '3-1');
    const r2 = await lb.add({ name: 'cont-fix', world: 3, level: 'run',
                              score: Math.max(1, budgetOf([...mainStart, '3-1']) - 300) }, cp.token);
    ok('continued run submits the carried total clean (accepted, not suspect)',
       cp.credited === true && r2.ok === true && r2.suspect === false);
    const r3 = await lb.add({ name: 'cont-fix2', world: 3, level: 'run', score: 100 }, cp.token);
    ok('continuation nonce is still single-use at submit', r3.ok === false && r3.status === 'replay');
    // Continuation keeps the ORIGINAL issuedAt, so the 2h TTL bounds the whole chain.
    const expired = lb.continueRun(legacyV2(['1-1', '1-2'], 3 * 60 * 60 * 1000));
    ok('continue refuses a run token past its 2h TTL', expired.ok === false && expired.status === 'expired');
    ok('continue refuses a tampered token', lb.continueRun({ ...tok, max: tok.max + 99999 }).ok === false);
  }

  // ---- audit #29: telemetry hardening (via the real router) ----------------------------------
  // These four cases need express (routes.js mounts on it). CI's node-check job is deliberately
  // dependency-free, so there they SKIP; the smoke-test job re-runs this file after `npm ci` with
  // NQ_LB_REQUIRE_ROUTER=1, where a skip is a hard failure — the cases still gate every push.
  let express = null;
  try { express = require('express'); }
  catch (e) {
    if (process.env.NQ_LB_REQUIRE_ROUTER) { console.log('  FAIL  express missing but NQ_LB_REQUIRE_ROUTER is set'); fail++; }
    else console.log('  SKIP  telemetry-router cases 15-18 (express not installed — dependency-free run)');
  }
  if (express) {
    const app = express();
    app.use(express.json());
    app.use(require('../routes.js'));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const post = (body) => fetch(base + '/api/nq/telemetry', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    // 15. 'clear' without a run token → rejected.
    {
      const r = await post({ ev: 'clear', world: '1-1', t: 90, deaths: 1, score: 800 });
      ok('telemetry clear without a run token is rejected', r.status === 400);
    }
    // 16. 'clear' with a valid run token → accepted (and the token stays submittable: non-consuming).
    {
      const tok = lb.startRun('1-1');
      const r = await post({ ev: 'clear', world: '1-1', t: 90, deaths: 1, score: 800, token: tok });
      const sub = await lb.add({ name: 'telem', world: 1, level: 'run', score: 100 }, tok);
      ok('telemetry clear with a valid run token is accepted', r.status === 200);
      ok('telemetry verification did not burn the run nonce (score still submits)', sub.ok === true);
    }
    // 17. Bogus world name → rejected (deaths included — no token needed, but the level must be real).
    {
      const r = await post({ ev: 'death', world: 'TOTALLYFAKE', x: 100, cause: 'X', t: 5 });
      ok('telemetry with a bogus world name is rejected', r.status === 400);
    }
    // 18. Honest tokenless death on a real level still lands (the cheap signal stays cheap).
    {
      const r = await post({ ev: 'death', world: '2-1', x: 2400, cause: 'GROUND WORM', t: 40 });
      ok('tokenless death telemetry on a real level is accepted', r.status === 200);
    }
    // audit #7 over the wire: the run-continue route reissues through the real router.
    {
      const tok = lb.startRun('1-1');
      const r = await fetch(base + '/api/nq/run-continue', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok }),
      });
      const j = await r.json();
      ok('run-continue route reissues over the wire', r.status === 200 && j.ok === true
         && j.token && j.token.nonce !== tok.nonce && j.token.max === tok.max);
      const bad = await fetch(base + '/api/nq/run-continue', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: { ...tok, max: 9999999 } }),
      });
      ok('run-continue route rejects a tampered token', bad.status === 400);
    }

    // ---- owner season-reset route: keyed, confirm-guarded ------------------
    {
      const get = (q) => fetch(base + '/api/nq/leaderboard/reset' + q);
      // 19. No admin key configured / wrong key → indistinguishable 404.
      const r404 = await get('?confirm=RESET&key=wrong');
      ok('season reset without the admin key is a 404', r404.status === 404);
      process.env.NQ_FEEDBACK_KEY = 'test-admin-key';
      // 20. Keyed but unconfirmed → refused, board intact.
      const rNo = await get('?key=test-admin-key');
      ok('keyed reset without confirm=RESET refuses', rNo.status === 400);
      // 21. Keyed + confirmed → archives and clears.
      const tok = reach(['1-1', '1-2']);
      await lb.add({ name: 'preseason', world: 1, level: 'run', score: 100 }, tok);
      const before = (await lb.list()).length;
      const rGo = await get('?key=test-admin-key&confirm=RESET');
      const j = await rGo.json();
      const after = (await lb.list()).length;
      const archived = JSON.parse(require('fs').readFileSync(j.to, 'utf8'));
      ok('keyed confirmed reset archives every entry then clears the board',
         rGo.status === 200 && j.ok === true && before > 0 && j.archived === before
         && after === 0 && archived.length === before);
      // The giveaway console: keyed page renders every section; keyless is a 404.
      const pNo = await fetch(base + '/normie-quest-x7/prizes');
      const pYes = await fetch(base + '/normie-quest-x7/prizes?key=test-admin-key');
      const html = await pYes.text();
      ok('giveaway console is a 404 without the admin key', pNo.status === 404);
      ok('giveaway console renders standings, suspects and season control',
         pYes.status === 200 && html.indexOf('LIVE STANDINGS') !== -1
         && html.indexOf('SUSPECT RUNS') !== -1 && html.indexOf('SEASON CONTROL') !== -1
         && html.indexOf('ARCHIVE + RESET SEASON') !== -1);
      delete process.env.NQ_FEEDBACK_KEY;
    }
    srv.close();
  }

  // ---- resetBoard() store-level (dependency-free — also runs when the router cases skip) ------
  {
    const tok = reach(['1-1', '1-2']);
    await lb.add({ name: 'season1', world: 1, level: 'run', score: 100 }, tok);
    const before = (await lb.list()).length;
    const r = await lb.resetBoard();
    const after = (await lb.list()).length;
    const archived = JSON.parse(require('fs').readFileSync(r.to, 'utf8'));
    ok('resetBoard archives all entries to a timestamped file then empties the store',
       before > 0 && r.archived === before && archived.length === before && after === 0);
    const arcs = await lb.listArchives();
    const mine = arcs.find((a) => r.to.endsWith(a.name));
    ok('listArchives surfaces the archive the reset just wrote (with its run count)',
       arcs.length >= 1 && !!mine && mine.count === before);
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
