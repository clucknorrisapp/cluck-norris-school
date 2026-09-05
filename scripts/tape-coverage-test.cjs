#!/usr/bin/env node
/**
 * COVERAGE HONESTY on the trade tape, and what the giveaway scanner does with it.
 *
 * getTradeTapeHelius can miss trades three ways: the maxSigs ceiling, an RPC error mid-paging
 * (including a 200 carrying {error} — a throttle, which is NOT an empty page), and running out of
 * its per-pool page budget before reaching the window start. Only the first one used to be
 * reported. The other two returned a SHORT tape that looked complete.
 *
 * That matters because the giveaway scanner is INCREMENTAL and never looks back: it advances a
 * cursor past each slice it scans. A throttled minute silently retired is a minute of trades gone
 * forever — and a missed SELL leaves a wallet holding entries it should have lost, which decides
 * who wins a prize.
 *
 * Dependency-free: stubs fetch and the enhanced-tx fetcher, drives the real modules.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clkn-tape-'));
process.env.DATA_DIR = DIR;

const MINT = '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';
const POOL = 'PooLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// What getSignaturesForAddress should do on each call — set per case.
let sigsBehaviour = 'ok';
let sigPagesServed = 0;

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('dexscreener')) return { json: async () => ([{ pairAddress: POOL }]) };
  if (u.includes('geckoterminal')) {
    // 5-minute close bars covering the window, flat at $0.05 — the scanner needs a priceable
    // moment or it bails before it ever reaches the tape, which would make the coverage
    // assertions below pass vacuously.
    const bars = [];
    for (let t = WIN_FROM - 600000; t <= WIN_TO + 600000; t += 300000) bars.push([Math.floor(t / 1000), 0, 0, 0, 0.05, 0]);
    return { json: async () => ({ data: { attributes: { ohlcv_list: bars.reverse() } } }) };
  }
  const body = JSON.parse((opts && opts.body) || '{}');
  if (body.method === 'getTokenLargestAccounts') return { json: async () => ({ result: { value: [] } }) };
  if (body.method === 'getSignaturesForAddress') {
    sigPagesServed++;
    if (sigsBehaviour === 'throw') throw new Error('socket hang up');
    if (sigsBehaviour === 'rpc-error-200') {
      // THE SUBTLE ONE: HTTP 200, JSON-RPC error body. Rate limits look exactly like this, and
      // reading `r.result || []` off it yields an empty array — indistinguishable from "no more
      // history" unless you check r.error.
      return { json: async () => ({ error: { code: 429, message: 'Too many requests' } }) };
    }
    if (sigsBehaviour === 'endless') {
      // A full page every time, all newer than the window start: the pager can never reach the
      // start and runs out of its page budget.
      return { json: async () => ({ result: Array.from({ length: 1000 }, (_, i) => ({
        signature: 'S' + sigPagesServed + '_' + i, blockTime: Math.floor(Date.now() / 1000), err: null })) }) };
    }
    // 'ok': one short page inside the window, then end of history.
    return { json: async () => ({ result: [
      { signature: 'SIG_IN_WINDOW', blockTime: Math.floor(WIN_FROM / 1000) + 60, err: null },
    ] }) };
  }
  return { json: async () => ({ result: null }) };
};

const WIN_FROM = Date.now() - 3600000;
const WIN_TO = Date.now();

const heliusEnhancedBatched = async (sigList) => ({ txs: sigList.map((sig) => ({
  signature: sig, timestamp: Math.floor((WIN_FROM + 60000) / 1000),
  tokenTransfers: [
    { mint: MINT, tokenAmount: 100, toUserAccount: '4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz' },
    { mint: 'So11111111111111111111111111111111111111112', tokenAmount: 1, fromUserAccount: '4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz' },
  ],
  nativeTransfers: [],
})) });

const { getTradeTapeHelius } = require(path.join(__dirname, '..', 'lib', 'helius-trades.js'));

(async () => {
  console.log('\ntrade tape — does it admit what it missed?\n');
  const call = () => getTradeTapeHelius(MINT, WIN_FROM, WIN_TO, {
    heliusKey: 'stub', heliusEnhancedBatched, maxSigs: 900, maxSigPagesPerPool: 3 });

  sigsBehaviour = 'ok'; sigPagesServed = 0;
  const clean = await call();
  ok('a fully-scanned window reports complete coverage',
     clean && clean.reachedWindowStart === true && clean.capped === false, JSON.stringify(clean && { r: clean.reachedWindowStart, c: clean.capped }));
  ok('and it still returns the trades it found', clean.trades.length === 1, JSON.stringify(clean.trades));

  sigsBehaviour = 'throw'; sigPagesServed = 0;
  const thrown = await call();
  ok('a thrown RPC error is reported as incomplete coverage, not as an empty window',
     thrown && thrown.reachedWindowStart === false, JSON.stringify(thrown));
  ok('and it names the pool and the error rather than shrugging',
     (thrown.poolErrors || []).length === 1 && /socket hang up/.test(thrown.poolErrors[0].error),
     JSON.stringify(thrown.poolErrors));

  // THE REGRESSION THAT MATTERED MOST: this used to be read as "no more signatures".
  sigsBehaviour = 'rpc-error-200'; sigPagesServed = 0;
  const throttled = await call();
  ok('a 200-with-{error} throttle is NOT mistaken for the end of history',
     throttled && throttled.reachedWindowStart === false, JSON.stringify(throttled));
  ok('the throttle is surfaced with its message',
     (throttled.poolErrors || []).some((e) => /Too many requests/.test(e.error)), JSON.stringify(throttled.poolErrors));

  sigsBehaviour = 'endless'; sigPagesServed = 0;
  const budget = await call();
  ok('running out of the page budget before the window start reports incomplete',
     budget && budget.reachedWindowStart === false, JSON.stringify({ r: budget.reachedWindowStart, c: budget.capped }));

  // ---- what the SCANNER does with it --------------------------------------------------------
  console.log('\ngiveaway scanner — a slice it could not cover is not retired\n');
  const gw = require(path.join(__dirname, '..', 'lib', 'cuna-giveaway.js'));
  gw.configure({ mint: MINT, pool: POOL, symbol: 'CUNA', startMs: WIN_FROM, endMs: WIN_TO, minUsd: 2.8 });
  gw.resetLedger();
  const deps = { heliusKey: 'stub', heliusEnhancedBatched };

  sigsBehaviour = 'rpc-error-200'; sigPagesServed = 0;
  const before = JSON.parse(fs.readFileSync(path.join(DIR, 'cuna-giveaway.json'), 'utf8')).cursorMs;
  const r1 = await gw.scanOnce(deps);
  const after = JSON.parse(fs.readFileSync(path.join(DIR, 'cuna-giveaway.json'), 'utf8')).cursorMs;
  ok('a throttled slice does NOT advance the cursor past itself', after === before,
     'cursor ' + before + ' -> ' + after);
  ok('the run says it is stalled instead of reporting a clean pass', r1.stalled === true, JSON.stringify(r1));
  ok('and it counts the incomplete slice for the operator', (r1.incompleteSlices || 0) >= 1, JSON.stringify(r1));

  // once the RPC recovers, the same slice is re-scanned and the cursor moves on
  sigsBehaviour = 'ok'; sigPagesServed = 0;
  const r2 = await gw.scanOnce(deps);
  const after2 = JSON.parse(fs.readFileSync(path.join(DIR, 'cuna-giveaway.json'), 'utf8')).cursorMs;
  ok('when the RPC recovers the same slice is retried and the cursor advances', after2 > before,
     'cursor ' + before + ' -> ' + after2);
  ok('and the scanner reports healthy again', r2.stalled !== true, JSON.stringify(r2));

  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
