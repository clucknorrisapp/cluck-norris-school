#!/usr/bin/env node
/**
 * TWO RAILWAY PROCESSES SHARING ONE VOLUME.
 *
 * lib/school-progress.js and lib/credentials.js each read their file ONCE at boot and then
 * rewrote it wholesale from an in-memory map. That does not merely miss the other process's
 * work — it DELETES it. Instance B's write is a snapshot that never saw what instance A
 * recorded, so A's lesson marks and A's issued transcripts vanish.
 *
 * The visible symptoms are the two worst outcomes the school has:
 *   - a learner who finished the course is told by the graduation gate that they did not;
 *   - a diploma that was issued 404s, because the process serving it has never heard of it.
 *
 * kvstore.js already grew an mtime `refresh()` for exactly this reason; these two never did.
 *
 * Each "process" here is a real child node process sharing one DATA_DIR — the only honest way
 * to test this, since two requires in one process share the same module instance.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const ROOT = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clkn-store-mp-'));

// Run one line of code in a FRESH node process against the shared volume.
const proc = (code) => execFileSync(process.execPath, ['-e', code], {
  cwd: ROOT, env: { ...process.env, DATA_DIR: DIR }, encoding: 'utf8',
}).trim().split('\n').pop().trim();   // modules log a boot line — the result is the last line

const LESSONS = ['lp', 'rugs', 'volatility', 'wallets', 'slippage', 'tokenomics',
                 'marketcap', 'dex', 'onchain', 'staking', 'bags', 'memecoins'];
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

console.log('\nschool-progress — two processes, one volume\n');

// THE INTERLEAVING THAT LOSES DATA — and it has to be built carefully, or the test proves
// nothing. Spawning two processes in sequence does NOT reproduce it: the second boots after the
// first has written, so it loads the first's work and cannot clobber it. (An earlier version of
// this test did exactly that and passed against the unfixed code.)
//
// The real shape is a LONG-LIVED process holding a snapshot that has gone stale:
//   1. instance B boots and loads the file (empty);
//   2. instance A, still running, records six lessons and flushes them to the volume;
//   3. B — which has never seen them — records six of its own and flushes.
// Step 3 is a wholesale rewrite from B's stale map. Without a merge, A's six are gone.
//
// Step 2 is written to the volume directly from inside B's process, which is exactly what
// another instance's atomic write looks like from B's point of view.
const A_MARKS = {};
for (const l of LESSONS.slice(0, 6)) A_MARKS[l] = { t: Date.now(), bf: 0 };
const A_STATE = JSON.stringify({ [SID]: { createdAt: Date.now(), lastAt: Date.now(), wallet: null, marks: A_MARKS } });

const bScript = `
  const fs=require('fs'), path=require('path');
  const p = require('./lib/school-progress');            // 1. B boots, file is empty
  fs.writeFileSync(path.join(${JSON.stringify(DIR)},'school-progress.json'), ${JSON.stringify(A_STATE)});  // 2. instance A writes
  ${LESSONS.slice(6).map((l) => `p.mark('${SID}','${l}');`).join('')}                                       // 3. B records its own
  p.flush();
`;
proc(bScript);
const finalMarks = Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'school-progress.json'), 'utf8'))[SID].marks);
ok('a stale process does NOT erase the lessons another instance recorded',
   finalMarks.length === 12, 'only ' + finalMarks.length + ' of 12 survived: ' + finalMarks.sort().join(','));
ok('and the six it never saw are among the survivors',
   LESSONS.slice(0, 6).every((l) => finalMarks.includes(l)),
   'missing: ' + LESSONS.slice(0, 6).filter((l) => !finalMarks.includes(l)).join(','));

// THE POINT: the graduation gate reads this file. A learner who finished must not be told they
// did not, because whichever instance happened to flush last had never seen half their work.
const verdict = proc(`const p=require('./lib/school-progress');console.log(JSON.stringify(p.statusFor('${SID}')));`);
ok('a fresh process sees all twelve lessons on disk', /"lessons":12/.test(verdict), verdict);

console.log('\ncredentials — two processes, one volume\n');
const W1 = 'BtrxmsfE3XTwvJaJ9q4u4dpdrykMDaVavwbnRRAizdCE';
const W2 = '4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz';
const slugFor = (w) => 'clkn-' + require('crypto').createHash('sha256').update('transcript:' + w).digest('hex').slice(0, 10);
const A_CREDS = JSON.stringify({ [W1]: { wallet: W1, slug: slugFor(W1), createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), diploma: null, graduation: { completed: true, at: new Date().toISOString() },
  holder: null, coursework: null, ownership: null } });

// Same shape: B boots empty, instance A issues W1's transcript, then B issues W2's and writes.
proc(`
  const fs=require('fs'), path=require('path');
  const c = require('./lib/credentials');
  fs.writeFileSync(path.join(${JSON.stringify(DIR)},'credentials.json'), ${JSON.stringify(A_CREDS)});
  c.record('${W2}',{kind:'graduation'});
`);
const wallets = Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'credentials.json'), 'utf8')));
ok('a transcript issued by another instance is not deleted by a stale write',
   wallets.includes(W1) && wallets.includes(W2), 'on disk: ' + wallets.join(','));

// And a running process that has never seen a transcript must still serve it, not 404.
const found = proc(`
  const fs=require('fs'), path=require('path');
  const c = require('./lib/credentials');
  fs.writeFileSync(path.join(${JSON.stringify(DIR)},'credentials.json'), ${JSON.stringify(A_CREDS)});
  console.log(c.resolve('${slugFor(W1)}') ? 'FOUND' : 'MISSING');
`);
ok('a diploma issued elsewhere resolves instead of 404ing', found === 'FOUND', found);

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
process.exit(failures ? 1 : 0);
