// Weekly prize-claim tests: skill-contest winner selection (verified + non-suspect only), the
// sign-to-claim consent flow (signature binds the address hash), encrypted-at-rest storage, the
// shipped wipe, and the dup-address review flag.
//
// Needs tweetnacl / bs58 / @solana/web3.js (real ed25519 signatures) — CI's node-check job installs
// nothing, so this whole file SKIPS there; the smoke-test job re-runs it after `npm ci` with
// NQ_CLAIMS_REQUIRE_DEPS=1, where a skip is a hard failure.
// Run: node normie-quest/test/nq-claims-test.cjs
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

let nacl, bs58;
try { nacl = require('tweetnacl'); bs58 = require('bs58'); require('@solana/web3.js'); }
catch (e) {
  if (process.env.NQ_CLAIMS_REQUIRE_DEPS) { console.log('FAIL  signature deps missing but NQ_CLAIMS_REQUIRE_DEPS is set'); process.exit(1); }
  console.log('SKIP  nq-claims tests (tweetnacl/bs58/web3.js not installed — dependency-free run)');
  process.exit(0);
}
if (bs58 && bs58.default) bs58 = bs58.default;

process.env.NQ_LB_SECRET = 'test-secret-fixed-0123456789';
process.env.NQ_CLAIM_SECRET = 'test-claim-secret-abcdef';
process.env.NQ_PRIZE_RANKS = '2';
process.env.DATA_DIR = path.join(os.tmpdir(), 'nqclaimtest-' + crypto.randomBytes(4).toString('hex'));

// Virtual clock (same pattern as nq-leaderboard-test): all modules read Date.now() live.
const realNow = Date.now;
let clockOffset = 0;
Date.now = function () { return realNow() + clockOffset; };
function playFor(ms) { clockOffset += ms; }

const lb = require('../nq-leaderboard.js');
const claims = require('../nq-claims.js');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function keypair() {
  const kp = nacl.sign.keyPair();
  return { pub: bs58.encode(Buffer.from(kp.publicKey)), sec: kp.secretKey };
}
function signMsg(message, sec) { return bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), sec))); }

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
async function scoreRun(name, wallet, score, opts) {
  const tok = reach(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3']);
  const entry = { name, world: 2, level: 'run', score };
  if (wallet) { entry.wallet = wallet; entry.walletVerified = true; }
  const r = await lb.add(entry, (opts && opts.forgeToken) ? lb.startRun('1-1') : tok);
  return r;
}

const ADDRESS = { name: 'Norm Ie', line1: '123 Chain St', line2: '', city: 'Solville', region: 'CA', postal: '90210', country: 'US' };

(async () => {
  const winner = keypair(), runnerUp = keypair(), stranger = keypair();

  // ---- seed LAST week's board (clock rewound one week) -----------------------------------------
  clockOffset = -WEEK_MS;
  await scoreRun('champ', winner.pub, 9000);
  await scoreRun('second', runnerUp.pub, 7000);
  await scoreRun('nowallet', null, 12000);                       // unverified: never wins a prize
  const sus = await scoreRun('cheater', keypair().pub, 900000, { forgeToken: true });   // over budget -> suspect
  clockOffset = 0;
  const week = claims.lastCompletedWeek();

  // 1. Winner selection: verified + non-suspect only, ranked.
  {
    const w = await claims.winnersForWeek(week);
    ok('winners are verified non-suspect runs, ranked by score',
       sus.suspect === true && w.length === 2 && w[0].wallet === winner.pub && w[0].rank === 1 && w[1].wallet === runnerUp.pub);
  }
  // 2. Non-winner cannot prepare a claim.
  {
    const r = await claims.prepare(stranger.pub, week, ADDRESS);
    ok('non-winner is refused (not_a_winner)', r.ok === false && r.status === 'not_a_winner');
  }
  // 3. The CURRENT (unfinished) week is not claimable.
  {
    const r = await claims.prepare(winner.pub, lb.weekStartMs(), ADDRESS);
    ok('current week is refused (week_not_ended)', r.ok === false && r.status === 'week_not_ended');
  }
  // 4. Happy path: prepare -> sign -> submit; stored encrypted; decrypt round-trips.
  {
    const prep = await claims.prepare(winner.pub, week, ADDRESS);
    ok('prepare returns the consent message with the address fingerprint',
       prep.ok === true && prep.message.indexOf(claims._addrHash(claims._cleanAddress(ADDRESS))) !== -1
       && prep.message.indexOf(winner.pub) !== -1);
    const r = await claims.submit(winner.pub, week, signMsg(prep.message, winner.sec));
    ok('signed claim is accepted', r.ok === true && r.claimed === true && r.rank === 1);
    const rec = claims.claimFor(week, winner.pub);
    const dec = claims.decryptAddress(rec.addrEnc);
    ok('address is stored encrypted and decrypts intact', !!rec.addrEnc && dec && dec.line1 === ADDRESS.line1 && dec.postal === ADDRESS.postal);
    const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'nq-claims.json'), 'utf8');
    ok('plaintext address never touches the disk', raw.indexOf('Chain St') === -1 && raw.indexOf('90210') === -1);
  }
  // 5. A signature from the wrong key is rejected.
  {
    const prep = await claims.prepare(runnerUp.pub, week, ADDRESS);
    const r = await claims.submit(runnerUp.pub, week, signMsg(prep.message, stranger.sec));
    ok('signature from a different key is rejected', r.ok === false && r.status === 'bad_signature');
  }
  // 6. Rank-2 winner claims the SAME address -> stored, flagged for owner review (never hard-blocked).
  {
    const prep = await claims.prepare(runnerUp.pub, week, ADDRESS);
    const r = await claims.submit(runnerUp.pub, week, signMsg(prep.message, runnerUp.sec));
    const rec = claims.claimFor(week, runnerUp.pub);
    ok('duplicate address is accepted but flagged dupAddress', r.ok === true && rec.dupAddress === true);
  }
  // 7. markShipped wipes the ciphertext and blocks re-claims.
  {
    const r = claims.markShipped(week, winner.pub);
    const rec = claims.claimFor(week, winner.pub);
    const again = await claims.prepare(winner.pub, week, ADDRESS);
    ok('shipped: address wiped, audit stub kept, re-claim refused',
       r.ok === true && !rec.addrEnc && rec.shippedAt > 0 && again.ok === false && again.status === 'already_shipped');
  }
  // 8. The claim window closes.
  {
    playFor(claims.claimDays() * 24 * 60 * 60 * 1000 + WEEK_MS);
    const r = await claims.prepare(runnerUp.pub, week, ADDRESS);
    ok('claim window closes after ' + claims.claimDays() + ' days', r.ok === false && r.status === 'window_closed');
    playFor(-(claims.claimDays() * 24 * 60 * 60 * 1000 + WEEK_MS));
  }

  // ---- routes (needs express; same skip rules as the deps above) -------------------------------
  let express = null;
  try { express = require('express'); } catch (e) {
    if (process.env.NQ_CLAIMS_REQUIRE_DEPS) { console.log('  FAIL  express missing but NQ_CLAIMS_REQUIRE_DEPS is set'); fail++; }
    else console.log('  SKIP  claim route cases (express not installed)');
  }
  if (express) {
    const app = express();
    app.use(express.json());
    app.use(require('../routes.js'));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    const base = 'http://127.0.0.1:' + srv.address().port;
    // 9. Public status: winners named, wallets shortened, claim states visible.
    {
      const j = await (await fetch(base + '/api/nq/claim/status?week=' + week + '&pubkey=' + runnerUp.pub)).json();
      ok('status lists winners with shortened wallets + claim state',
         j.ok === true && j.winners.length === 2 && j.winners[0].wallet.indexOf('…') !== -1
         && j.winners.every((w) => w.wallet.length < 12) && j.you && j.you.isWinner === true && j.you.claimed === true);
    }
    // 10. Full claim over the wire for a fresh week (seed this week's run, then jump a week ahead).
    {
      const fresh = keypair();
      await scoreRun('wire', fresh.pub, 8000);
      playFor(WEEK_MS);   // that week is now the last completed one
      const wk2 = claims.lastCompletedWeek();
      const prep = await (await fetch(base + '/api/nq/claim/prepare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pubkey: fresh.pub, week: wk2, address: ADDRESS }) })).json();
      const sub = await (await fetch(base + '/api/nq/claim', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pubkey: fresh.pub, week: wk2, signature: signMsg(prep.message, fresh.sec) }) })).json();
      ok('prepare + submit work over the wire', prep.ok === true && sub.ok === true && sub.claimed === true);
    }
    // 11. Owner prizes panel: 404 without key; decrypted address renders with it.
    {
      const noKey = await fetch(base + '/normie-quest-x7/prizes');
      // MASTER-KEY-ONLY (security review 2026-08-30): the prizes console decrypts shipping PII,
      // so it takes PREMIUM_ACCESS_KEY only; the low-trust feedback key must be refused.
      process.env.NQ_FEEDBACK_KEY = 'low-trust-key';
      const fbKey = await fetch(base + '/normie-quest-x7/prizes?key=low-trust-key');
      process.env.PREMIUM_ACCESS_KEY = 'test-admin-key';
      const html = await (await fetch(base + '/normie-quest-x7/prizes?key=test-admin-key')).text();
      delete process.env.NQ_FEEDBACK_KEY; delete process.env.PREMIUM_ACCESS_KEY;
      ok('prizes panel: 404 without key, decrypted address + dup flag with it',
         noKey.status === 404 && html.indexOf('123 Chain St') !== -1 && html.indexOf('matches another winner') !== -1);
      ok('prizes panel REFUSES the low-trust feedback key', fbKey.status === 404);
    }
    srv.close();
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
