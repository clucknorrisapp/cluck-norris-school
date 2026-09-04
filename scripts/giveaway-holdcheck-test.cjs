#!/usr/bin/env node
/**
 * checkWinnersStillHolding — the check that decides whether a winner gets paid.
 *
 * It fired a FALSE POSITIVE on 2026-09-04: all four winners plus the alternate were flagged as
 * having dumped, minutes after their prizes landed and while every balance was UP. Cause: the
 * verdict was computed in USD, and priceAt() reads a bar cache that only scanOnce() fills — so
 * after the window closes (scanner no-ops) any process restart leaves it empty, every price
 * returns 0, and every winner looks worthless.
 *
 * Both of that bug's failure modes point at disqualifying innocent winners, so the cases below
 * are written from the payer's side: the ONLY thing that may flag a wallet is actually having
 * fewer tokens than it bought.
 *
 * Dependency-free: stubs the RPC and drives the real module against a temp DATA_DIR.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clkn-holdcheck-'));
process.env.DATA_DIR = DIR;

const MINT = '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';
const W = {
  held:    'BtrxmsfE3XTwvJaJ9q4u4dpdrykMDaVavwbnRRAizdCE',   // bought 1000, holds 5000 (won a prize)
  exact:   '4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz',   // bought 1000, holds 1000
  dumped:  '2QaW5oDwXdnhiLbuZRbGkKFrxXSZWwB741Nfgb3Ktb5j',   // bought 1000, holds 100  → MUST flag
  emptied: '9jSRcv5D6NKYRVoVu8vT9vKLNwcJXneVwsHw2R1nkXHf',   // bought 1000, holds 0    → MUST flag
};
const BAL = { [W.held]: 5000, [W.exact]: 1000, [W.dumped]: 100, [W.emptied]: 0 };

// Stub the RPC the module calls via global fetch. GeckoTerminal (the price bars) is deliberately
// failed, which is exactly the cold-cache state that caused the incident.
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('geckoterminal')) throw new Error('price feed unavailable (simulating the cold cache)');
  const body = JSON.parse((opts && opts.body) || '{}');
  if (body.method === 'getTokenAccountsByOwner') {
    const owner = body.params[0];
    const amt = BAL[owner];
    if (amt == null) return { json: async () => ({ result: { value: [] } }) };
    return { json: async () => ({ result: { value: [{ account: { data: { parsed: { info: {
      mint: MINT, tokenAmount: { uiAmount: amt, decimals: 9 } } } } } }] } }) };
  }
  return { json: async () => ({ result: null }) };
};

const gw = require(path.join(__dirname, '..', 'lib', 'cuna-giveaway.js'));

(async () => {
  console.log('\ncheckWinnersStillHolding — token-based verdict\n');

  gw.configure({ mint: MINT, pool: 'FAKEPOOL', symbol: 'CUNA', startMs: 1, endMs: 2, minUsd: 2.8 });

  // Seed a ledger + draw directly: the scanner is not what is under test here.
  const file = path.join(DIR, 'cuna-giveaway.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.wallets = {};
  for (const w of Object.values(W)) state.wallets[w] = { entries: 3, usd: 30, tokens: 1000, buys: [], dq: null };
  state.draw = { at: Date.now(), winners: [
    { place: 1, wallet: W.held,    prize: 4000000, entries: 3 },
    { place: 2, wallet: W.exact,   prize: 3000000, entries: 3 },
    { place: 3, wallet: W.dumped,  prize: 2000000, entries: 3 },
    { place: 4, wallet: W.emptied, prize: 1000000, entries: 3 },
  ] };
  fs.writeFileSync(file, JSON.stringify(state));

  const res = await gw.checkWinnersStillHolding({ rpcUrl: 'http://stub' });
  const by = {}; for (const r of res.rows) by[r.wallet] = r;

  ok('runs with a COLD price cache instead of erroring', res.ok === true, JSON.stringify(res).slice(0, 160));
  ok('reports the verdict basis as tokens, not dollars', res.basis === 'tokens-held-vs-tokens-bought', String(res.basis));
  ok('admits the price is unknown rather than treating it as $0',
     res.priceKnown === false && by[W.held].holdUsd === null && by[W.held].heldPct === null,
     'priceKnown=' + res.priceKnown + ' holdUsd=' + by[W.held].holdUsd + ' heldPct=' + by[W.held].heldPct);

  // THE REGRESSION. Every one of these was flagged by the old USD logic.
  ok('a winner holding MORE than they bought is NOT flagged',
     res.flaggedWallets.indexOf(W.held) === -1, 'keptPct=' + by[W.held].keptPct);
  ok('a winner holding exactly what they bought is NOT flagged',
     res.flaggedWallets.indexOf(W.exact) === -1, 'keptPct=' + by[W.exact].keptPct);

  // and it must still catch real sells
  ok('a wallet down to 10% of what it bought IS flagged',
     res.flaggedWallets.indexOf(W.dumped) !== -1, 'keptPct=' + by[W.dumped].keptPct);
  ok('an emptied wallet IS flagged',
     res.flaggedWallets.indexOf(W.emptied) !== -1 && by[W.emptied].emptied === true);
  ok('exactly the two real sellers are flagged', res.flagged === 2, 'flagged=' + res.flagged + ' ' + JSON.stringify(res.flaggedWallets));

  ok('keptPct is measured against tokens bought', by[W.held].keptPct === 500 && by[W.dumped].keptPct === 10,
     'held=' + by[W.held].keptPct + ' dumped=' + by[W.dumped].keptPct);

  // board copy must carry dollars, not entries alone
  const board = gw.boardText();
  ok('the board shows dollars beside entry counts', /\$\d/.test(board), board.split('\n').slice(0, 8).join(' | '));

  // ---- entry mode -----------------------------------------------------------------------------
  // per-buy stays the DEFAULT: a promo's counting rule is the owner's product decision and must
  // never change just because this option exists.
  console.log('\nentry mode\n');
  ok('default entry mode is per-buy (unchanged behaviour)', gw.config().entryMode === 'per-buy', String(gw.config().entryMode));
  ok('an unrecognised entry mode falls back to per-buy, it does not throw',
     gw.configure({ entryMode: 'nonsense' }).entryMode === 'per-buy');
  ok('per-dollar is selectable', gw.configure({ entryMode: 'per-dollar' }).entryMode === 'per-dollar');

  // The rule line only renders while the window is OPEN — a closed board prints "Scoring is
  // final" instead. Open it so the copy under test is actually reachable.
  gw.configure({ endMs: Date.now() + 3600000 });
  const perDollarBoard = gw.boardText();
  ok('the board copy follows per-dollar when per-dollar is set',
     /bought = 1 entry/.test(perDollarBoard), perDollarBoard.split('\n').pop());
  gw.configure({ entryMode: 'per-buy' });
  ok('the board copy follows per-buy when per-buy is set',
     /\+ buy = 1 entry/.test(gw.boardText()));

  // The counterfactual, using the REAL numbers from the 2026-09-04 draw. minUsd there was 2.8.
  const entriesFor = (usd, mode, minUsd) => mode === 'per-dollar' ? Math.max(1, Math.floor(usd / minUsd)) : 1;
  ok('per-buy gives the $198.45 buyer 2 entries across 2 buys',
     entriesFor(99.2, 'per-buy', 2.8) * 2 === 2);
  ok('per-dollar gives that same buyer 70 entries',
     entriesFor(99.2, 'per-dollar', 2.8) * 2 === 70,
     'got ' + entriesFor(99.2, 'per-dollar', 2.8) * 2);
  ok('per-dollar makes splitting a buy pointless (1x$99 == 33x$3)',
     entriesFor(99, 'per-dollar', 2.8) === 35 && 33 * entriesFor(3, 'per-dollar', 2.8) === 33,
     'one-go=' + entriesFor(99, 'per-dollar', 2.8) + ' split=' + (33 * entriesFor(3, 'per-dollar', 2.8)));
  ok('a qualifying buy always earns at least one entry',
     entriesFor(2.9, 'per-dollar', 2.8) === 1);

  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
