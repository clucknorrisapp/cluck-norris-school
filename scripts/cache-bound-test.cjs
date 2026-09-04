#!/usr/bin/env node
/**
 * The creator-trace cache is fed by /api/autopsy, which is PUBLIC. Entries were added and never
 * removed — an expired one was only overwritten if that exact (wallet, mint) pair came back — so
 * a stream of different mints grew the Map without limit, each entry holding a full trace with
 * its teamNetwork. On a memory-capped Railway container that is a slow OOM anyone can drive from
 * outside. This pins the bound and the eviction order.
 */
const path = require('path');
let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const { _creatorTraceCache: C } = require(path.join(__dirname, '..', 'lib', 'autopsy.js'));

console.log('\ncreator-trace cache is bounded\n');

const trace = (n) => ({ buyCount: n, sellCount: 0, lockCount: 0, boughtUsd: 0, soldUsd: 0,
  boughtSol: 0, soldSol: 0, sigsScanned: 1 });

// Ten times the cap, all distinct — the public-traffic shape.
for (let i = 0; i < C.MAX * 10; i++) C.bestObservedTrace('W' + i, 'M' + i, trace(1));
ok(`stays at or under its cap after ${C.MAX * 10} distinct mints`, C.map.size <= C.MAX,
   'grew to ' + C.map.size + ' (cap ' + C.MAX + ')');
ok('and it did not just empty itself — the cache is still useful', C.map.size > C.MAX / 2, 'size ' + C.map.size);

// A HOT key must survive a flood of cold ones. Under plain FIFO it would not: Map.set on an
// existing key does not move it, so re-use would never refresh its position.
C.map.clear();
C.bestObservedTrace('HOT', 'HOT', trace(5));
for (let i = 0; i < C.MAX - 1; i++) {
  C.bestObservedTrace('cold' + i, 'cold' + i, trace(1));
  if (i % 50 === 0) C.bestObservedTrace('HOT', 'HOT', trace(5));   // keep touching it
}
for (let i = 0; i < 200; i++) C.bestObservedTrace('flood' + i, 'flood' + i, trace(1));
ok('a repeatedly-used entry survives a flood of one-off mints (LRU, not FIFO)',
   C.map.has('HOT:HOT'), 'evicted; size ' + C.map.size);

// The merge behaviour the cache exists for must still work — it keeps the MAX of each counter so
// a rate-limited re-run cannot make a creator's numbers appear to shrink.
C.map.clear();
C.bestObservedTrace('A', 'B', trace(9));
const merged = C.bestObservedTrace('A', 'B', trace(2));
ok('a regressed re-run still reports the best figure seen', merged.trace.buyCount === 9,
   'got ' + merged.trace.buyCount);
ok('and flags that it fell back to the cache', merged.usedCache === true);

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
process.exit(failures ? 1 : 0);
