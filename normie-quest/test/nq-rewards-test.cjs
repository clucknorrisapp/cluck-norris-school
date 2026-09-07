// Rewards/wheel store tests (pure node, no deps): the F13 read-memoization, and the F15 wheel
// dead-end at a full pending queue (queue_full must still be reported distinctly AND consume the
// spin exactly once, closing the VIP free-re-roll loophole).
// Run: node normie-quest/test/nq-rewards-test.cjs
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

process.env.DATA_DIR = path.join(os.tmpdir(), 'nqrewardstest-' + crypto.randomBytes(4).toString('hex'));

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

// F13: count real disk reads of the rewards store so we can prove several status-style calls in
// the same tick cost ONE readFileSync, not one each. fs is the shared cached module object, so
// patching it here is visible inside nq-rewards.js too.
let storeReads = 0;
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  if (String(p).indexOf('nq-rewards.json') !== -1) storeReads++;
  return origReadFileSync.call(fs, p, ...rest);
};

const rewards = require('../nq-rewards.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 5, 3, 0, 0, 0);   // 03:00 UTC — outside BONUS_SPIN_HOURS [12,18,22]
function day(n) { return BASE + n * DAY_MS; }
function pk(seed) { return 'W' + seed + 'x'.repeat(40); }   // fake pubkey, good enough — this module never validates the shape

// ---- F13: memoized read ---------------------------------------------------
{
  storeReads = 0;
  const w = pk('memo');
  // Five reads a real /api/nq/wheel/status handler does today (canSpin, bonusAvailable,
  // pendingCount, odds, activePass) — all inside the 2s cache window, so this must cost ONE read.
  rewards.canSpin(w, day(0));
  rewards.bonusAvailable(w, day(0));
  rewards.pendingCount(w);
  rewards.odds(false);
  rewards.activePass(w, day(0));
  ok('F13: five store reads in one tick collapse to a single readFileSync', storeReads === 1);

  const before = storeReads;
  rewards.grant(w, 'disc', day(0));   // a write — must invalidate the cache without a fresh disk read
  ok('F13: a write (save) does not itself cost a disk read', storeReads === before);
  const after = storeReads;
  ok('F13: a read right after the write sees the new data without re-reading disk',
     rewards.pendingCount(w) === 1 && storeReads === after);
}

// ---- F15: free wallet — queue fills, then dead-ends -----------------------
{
  const w = pk('free');
  let i = 0;
  for (; i < 20; i++) {
    const r = rewards.spin(w, day(i), { vip: false });
    if (!r.ok) { ok('F15: filling the free queue (day ' + i + ')', false); break; }
  }
  ok('F15: 20 daily spins fill the queue to the cap', rewards.pendingCount(w) === 20);

  // The 21st day: the free table is 100% queue items, so this MUST hit the full queue.
  const full = rewards.spin(w, day(20), { vip: false });
  ok('F15: a spin against a full queue reports a distinct queue_full reason (and keeps `error`)',
     full.ok === false && full.reason === 'queue_full' && full.error === 'queue_full');

  // The spin must still be CONSUMED — this is the actual bug: it used to return before the
  // daily flag was ever written, so canSpin stayed true and the player saw "Spin failed" forever.
  ok('F15: queue_full still consumes the daily spin', rewards.canSpin(w, day(20)) === false);
  const again = rewards.spin(w, day(20), { vip: false });
  ok('F15: a second spin the same day is a normal already_spun, not another queue_full free try',
     again.ok === false && again.error === 'already_spun');

  // Next day: back to normal (still full, still queue_full, but a NEW day's spin, not a re-roll).
  const next = rewards.spin(w, day(21), { vip: false });
  ok('F15: the day after, the wallet gets a fresh (still queue_full) spin, not a stuck state',
     next.ok === false && next.reason === 'queue_full' && rewards.canSpin(w, day(21)) === false);
}

// ---- F15: VIP path — consumption is exactly-once regardless of outcome ----
{
  const w = pk('vip');
  rewards.grant(w, 'disc', day(0)); rewards.grant(w, 'disc', day(0));
  for (let i = 0; i < 18; i++) rewards.grant(w, 'vial', day(0));   // queue now full (20) up front
  ok('F15 setup: VIP wallet queue pre-filled to the cap', rewards.pendingCount(w) === 20);

  // Whatever the wheel draws — a queue item (now full) or a non-queue prize (preview/raffle/
  // heart) — a single spin() call must consume exactly one day's spin, never zero and never two.
  let sawQueueFull = false, sawOk = false, allSingleConsumed = true;
  for (let i = 0; i < 25; i++) {
    const t = day(30 + i);
    const before = rewards.canSpin(w, t);
    const r = rewards.spin(w, t, { vip: true });
    const afterSameCall = rewards.canSpin(w, t);
    if (!before) { allSingleConsumed = false; continue; }   // (shouldn't happen — fresh day each loop)
    if (afterSameCall !== false) allSingleConsumed = false;   // must be consumed immediately
    const retry = rewards.spin(w, t, { vip: true });
    if (retry.ok !== false || retry.error !== 'already_spun') allSingleConsumed = false;   // no free re-roll
    if (r.ok === false && r.reason === 'queue_full') sawQueueFull = true;
    if (r.ok === true) sawOk = true;
  }
  ok('F15: VIP spins observed both a queue_full draw and a normal win across the run', sawQueueFull && sawOk);
  ok('F15: every VIP spin — win or queue_full — consumes exactly one spin, no free re-roll', allSingleConsumed);
}

fs.readFileSync = origReadFileSync;
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
