// Regression test: weekly winners must survive the leaderboard's row cap for the whole 14-day
// claim window (audit Batch B).
//
// winnersForWeek() used to recompute a week's winners LIVE from leaderboard.list() on every call.
// The JSON backend hard-prunes to the newest 6000 rows on every insert (and Postgres's list()
// caps at 5000), so once enough runs land in later weeks, a completed week's winning run can age
// out of the store while its claim window (weekStart + 7d + 14d) is still open — the winner then
// reads back as "not a winner" and an in-flight claim is silently voided.
//
// Fix: once a week has ENDED (its winner set can never legitimately change), the first
// winnersForWeek() call for it snapshots the result to disk; later calls read the snapshot even
// if the live store has since evicted the rows. A season reset (resetBoard) clears the snapshot
// too, preserving "a reset resets pending winners."
//
// This test seeds a real winning run through the actual leaderboard token flow, snapshots it,
// then SIMULATES row-cap eviction by stubbing leaderboard.list() to return nothing (equivalent to
// the winning run having aged out) and checks the winner is still found.
//
// Needs tweetnacl / bs58 / @solana/web3.js — same dependency posture as nq-claims-test.cjs: skips
// cleanly if they're not installed, unless NQ_CLAIMS_REQUIRE_DEPS=1.
// Run: node normie-quest/test/nq-claims-winners-snapshot-test.cjs
"use strict";

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

try { require('tweetnacl'); require('bs58'); require('@solana/web3.js'); }
catch (e) {
  if (process.env.NQ_CLAIMS_REQUIRE_DEPS) { console.log('FAIL  signature deps missing but NQ_CLAIMS_REQUIRE_DEPS is set'); process.exit(1); }
  console.log('SKIP  nq-claims winners-snapshot test (tweetnacl/bs58/web3.js not installed — dependency-free run)');
  process.exit(0);
}

process.env.NQ_LB_SECRET = 'test-secret-snapshot-0123456789';
process.env.NQ_CLAIM_SECRET = 'test-claim-secret-snapshot';
process.env.NQ_PRIZE_RANKS = '1';
const DATA_DIR = path.join(os.tmpdir(), 'nqwinsnap-' + crypto.randomBytes(4).toString('hex'));
process.env.DATA_DIR = DATA_DIR;

// Virtual clock — same pattern as nq-claims-test.cjs (pinned to a stable mid-week point so a real
// Monday-00:00-UTC rollover during the run can't move the goalposts).
const realNow = Date.now;
const _d0 = new Date(realNow());
const BASE = Date.UTC(_d0.getUTCFullYear(), _d0.getUTCMonth(), _d0.getUTCDate() - ((_d0.getUTCDay() + 6) % 7), 0, 0, 0, 0) + 3.5 * 24 * 60 * 60 * 1000;
let clockOffset = 0;
Date.now = function () { return BASE + clockOffset; };
function playFor(ms) { clockOffset += ms; }

const lb = require('../nq-leaderboard.js');
const claims = require('../nq-claims.js');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

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
async function scoreRun(name, walletPk, score) {
  const tok = reach(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3']);
  const entry = { name, world: 2, level: 'run', score, wallet: walletPk, walletVerified: true };
  return lb.add(entry, tok);
}

(async () => {
  const WINNER = 'WinnerWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';

  // ---- seed LAST week's board (clock rewound one week), then return to "now" -------------------
  clockOffset = -WEEK_MS;
  const runResult = await scoreRun('champ', WINNER, 9000);
  clockOffset = 0;
  const week = claims.lastCompletedWeek();
  ok('seeded run was accepted (not suspect)', runResult && runResult.ok !== false && !runResult.suspect);

  // 1. Live computation (store intact) finds the winner and, as a side effect, snapshots it.
  const live = await claims.winnersForWeek(week);
  ok('live lookup finds the seeded winner', live.length === 1 && live[0].wallet === WINNER);

  const snapFile = path.join(DATA_DIR, 'nq-claim-winners.json');
  const snapExists = fs.existsSync(snapFile);
  ok('winners for the completed week were persisted to disk', snapExists);
  if (snapExists) {
    const stored = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    ok('the persisted snapshot carries the right winner for the right week',
      Array.isArray(stored[String(week)]) && stored[String(week)][0] && stored[String(week)][0].wallet === WINNER);
  }

  // 2. Simulate the leaderboard row-cap evicting the week's rows: stub list() to return nothing,
  // exactly what happens once enough later-week traffic prunes this run out of the capped store.
  const realList = lb.list;
  lb.list = async () => [];
  try {
    const afterEviction = await claims.winnersForWeek(week);
    ok('winner still found after the underlying leaderboard store no longer has the row (snapshot survives eviction)',
      afterEviction.length === 1 && afterEviction[0].wallet === WINNER);

    const elig = await claims.eligibility(week, WINNER);
    ok('the winner is still eligible to claim after eviction', elig.ok === true && elig.rank === 1);

    // 3. A season reset must still reset pending winners: clearing the snapshot with the
    // (still-stubbed, now-empty) live store behind it must make the week un-winnable again.
    claims.clearWinnersSnapshot();
    const afterReset = await claims.winnersForWeek(week);
    ok('clearWinnersSnapshot() (called by the owner season reset) makes the week recompute live again',
      afterReset.length === 0);
  } finally {
    lb.list = realList;
  }

  // 4. The CURRENT (not-yet-ended) week is never snapshotted, even if evaluated.
  {
    const realList2 = lb.list;
    let calls = 0;
    lb.list = async (...args) => { calls++; return realList2(...args); };
    await claims.winnersForWeek(lb.weekStartMs());
    lb.list = realList2;
    ok('the in-progress current week is evaluated live (not served from a stale snapshot)', calls === 1);
  }

  // 5. Coverage guard (audit follow-up): a completed week must NOT be snapshotted while the
  // store can't prove it still reaches back to weekStart — otherwise a truncated winner set
  // freezes forever. Simulate a store that has hit the smaller (Postgres, 5000-row) cap with
  // every surviving row newer than weekStart, i.e. exactly what "the week already partially aged
  // out" looks like from winnersForWeek's point of view.
  {
    const week5 = week - 2 * WEEK_MS;
    const rows5 = [];
    for (let i = 0; i < 5000; i++) {
      rows5.push({ at: week5 + 1000 + i, wallet: 'Filler5-' + i, walletVerified: true, suspect: false, name: 'f', world: 1, score: 1 });
    }
    rows5.push({ at: week5 + 500, wallet: 'CoverageWinnerAAAAAAAAAAAAAAAAAAAAAAAAAAAA', walletVerified: true, suspect: false, name: 'w', world: 2, score: 99999 });
    const realList3 = lb.list;
    lb.list = async () => rows5;
    try {
      const res5 = await claims.winnersForWeek(week5);
      ok('an uncovered week still returns the correct live winner', res5.length === 1 && res5[0].wallet.indexOf('CoverageWinner') === 0);
      const snapAfter5 = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : {};
      ok('an uncovered week is NOT persisted to the snapshot file (coverage unproven)', !snapAfter5[String(week5)]);
    } finally {
      lb.list = realList3;
    }
  }

  // 6. Corrupt snapshot file (audit follow-up): must fail CLOSED — never silently treated as "no
  // snapshots yet" and overwritten with just the new week, which would permanently erase every
  // other week's winners (the only surviving record once their leaderboard rows age out).
  {
    const week6 = week - 3 * WEEK_MS;
    const rows6 = [
      { at: week6, wallet: 'Filler6', walletVerified: true, suspect: false, name: 'f', world: 1, score: 1 },
      { at: week6 + 500, wallet: 'CorruptWinnerAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', walletVerified: true, suspect: false, name: 'w', world: 2, score: 5000 },
    ];
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(snapFile, '{not valid json,,,');
    const beforeCorrupt = fs.readFileSync(snapFile, 'utf8');

    const realList4 = lb.list;
    lb.list = async () => rows6;
    try {
      const res6 = await claims.winnersForWeek(week6);
      ok('live winners are still computed for the week despite a corrupt snapshot file',
        res6.length === 1 && res6[0].wallet.indexOf('CorruptWinner') === 0);

      const afterCorrupt = fs.readFileSync(snapFile, 'utf8');
      ok('the corrupt snapshot file is left untouched (never silently overwritten with just this week)',
        afterCorrupt === beforeCorrupt);

      const quarantineFiles = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('nq-claim-winners.json.corrupt-'));
      ok('a quarantine copy of the corrupt file was made', quarantineFiles.length >= 1);

      // Still quarantined on a second call in the same process — never "self-heals" into a fresh {}.
      const res6b = await claims.winnersForWeek(week6);
      ok('a second evaluation still recomputes live (quarantine persists within the process)',
        res6b.length === 1 && res6b[0].wallet.indexOf('CorruptWinner') === 0);
      const afterSecondCall = fs.readFileSync(snapFile, 'utf8');
      ok('the corrupt file is still untouched after a second evaluation', afterSecondCall === beforeCorrupt);
    } finally {
      lb.list = realList4;
    }

    // Recovery: the owner's season reset deletes the file AND lifts the quarantine, so a fresh
    // snapshot can be written again afterward.
    claims.clearWinnersSnapshot();
    lb.list = async () => rows6;
    try {
      const res6c = await claims.winnersForWeek(week6);
      ok('after a season reset, the (previously quarantined) week recomputes correctly', res6c.length === 1);
      const recovered = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : {};
      ok('a fresh snapshot is written again post-recovery',
        Array.isArray(recovered[String(week6)]) && recovered[String(week6)][0].wallet.indexOf('CorruptWinner') === 0);
    } finally {
      lb.list = realList4;
    }
  }

  Date.now = realNow;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
