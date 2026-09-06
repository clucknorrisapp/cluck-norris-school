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
// What getSignatureStatuses reports for the pending sigs under test — set per case below.
let sigStatus = [];

// Stub the RPC the module calls via global fetch. GeckoTerminal (the price bars) is deliberately
// failed, which is exactly the cold-cache state that caused the incident.
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('geckoterminal')) throw new Error('price feed unavailable (simulating the cold cache)');
  const body = JSON.parse((opts && opts.body) || '{}');
  if (body.method === 'getSignatureStatuses') {
    return { json: async () => ({ result: { value: sigStatus } }) };
  }
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

  // ---- payout idempotency ----------------------------------------------------------------------
  // The defect this pins, found by audit on 2026-09-04 in code shipped hours earlier: a transfer
  // that was SENT but whose confirmation timed out was recorded as `failed` with no signature, so
  // payoutOwed put the wallet straight back in `owed` and the documented retry paid them AGAIN.
  console.log('\npayout idempotency\n');
  {
    const W1 = 'BtrxmsfE3XTwvJaJ9q4u4dpdrykMDaVavwbnRRAizdCE';
    const W2 = '4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz';
    const st2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st2.payouts = {};
    st2.draw = { at: Date.now(), seedHash: 'ROUND_A', mint: MINT, winners: [
      { place: 1, wallet: W1, prize: 4000000, entries: 3 },
      { place: 2, wallet: W2, prize: 3000000, entries: 3 },
    ] };
    fs.writeFileSync(file, JSON.stringify(st2));

    const o1 = gw.payoutOwed();
    ok('both winners are owed before any payment', o1.owed.length === 2, JSON.stringify(o1.owed));

    // W1 confirms; W2 is SENT but its confirm times out — the exact incident shape.
    gw.recordPayout([{ wallet: W1, amountUi: 4000000, sig: 'SIG_CONFIRMED' }], 'ROUND_A');
    gw.recordPayout([{ wallet: W2, amountUi: 3000000, sig: 'SIG_TIMED_OUT', pending: true }], 'ROUND_A');

    const o2 = gw.payoutOwed();
    ok('a SENT-but-unconfirmed transfer is NOT re-owed (the double-pay)',
       o2.owed.length === 0, 'still owed: ' + JSON.stringify(o2.owed));
    ok('the unconfirmed payment is recorded as pending, not lost',
       (o2.alreadyPaid.find((p) => p.wallet === W2) || {}).pending === true,
       JSON.stringify(o2.alreadyPaid));

    // a later confirm resolves pending without creating a second record
    gw.recordPayout([{ wallet: W2, amountUi: 3000000, sig: 'SIG_TIMED_OUT' }], 'ROUND_A');
    const o3 = gw.payoutOwed();
    ok('a later confirmation clears pending and still owes nothing',
       o3.owed.length === 0 && (o3.alreadyPaid.find((p) => p.wallet === W2) || {}).pending === false);

    // A winner DQ'd after the draw must not be paid. The flag is set through manualDq — the real
    // &dq= flow — rather than hand-written, because the shape matters now: only a HUMAN
    // disqualification withholds a sealed prize, and manualDq is what stamps `manual: true`.
    // Hand-writing `{reason}` here previously documented the over-broad behaviour as correct.
    const st3 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st3.payouts = {}; st3.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    fs.writeFileSync(file, JSON.stringify(st3));
    const dqres = gw.manualDq(W1, 'sold_before_payout');
    ok('the documented &dq= flow stamps the flag as manual', dqres.ok && dqres.dq.manual === true, JSON.stringify(dqres));
    const o4 = gw.payoutOwed();
    ok('a winner disqualified AFTER the draw is not paid',
       !o4.owed.some((r) => r.wallet === W1) && o4.disqualified.some((d) => d.wallet === W1),
       'owed=' + JSON.stringify(o4.owed) + ' dq=' + JSON.stringify(o4.disqualified));

    // Payouts are scoped per round, so a repeat winner in a NEW promo is still owed.
    //
    // The record is written through gw.recordPayout, NOT by hand-writing `{ROUND_A:{...}}` into
    // the file. The earlier version did the latter and passed against the old wallet-keyed reader
    // too — it asserted against a shape the test itself invented, so it could not fail. Writing
    // through the module means the record lands in whatever shape the implementation actually
    // uses, and only genuine round-scoping makes this pass.
    const st4 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st4.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    st4.payouts = {};
    st4.draw = { at: 1000, seedHash: 'ROUND_A', mint: MINT, winners: [{ place: 1, wallet: W1, prize: 4000000, entries: 3 }] };
    fs.writeFileSync(file, JSON.stringify(st4));
    gw.recordPayout([{ wallet: W1, amountUi: 4000000, sig: 'ROUND_A_SIG' }], 'ROUND_A');
    ok('round A shows the winner paid', gw.payoutOwed().owed.length === 0);
    // Now the promo moves on. resetLedger is the documented way to start the next one.
    gw.resetLedger();
    const st4b = JSON.parse(fs.readFileSync(file, 'utf8'));
    st4b.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    st4b.draw = { at: Date.now(), seedHash: 'ROUND_B', mint: MINT, winners: [{ place: 1, wallet: W1, prize: 1000000, entries: 3 }] };
    fs.writeFileSync(file, JSON.stringify(st4b));
    const o5 = gw.payoutOwed();
    ok('a repeat winner in a NEW round is still owed (payouts are round-scoped)',
       o5.owed.length === 1 && o5.owed[0].amountUi === 1000000, JSON.stringify(o5.owed));
    ok('the finished round\'s payouts are archived by the reset, not left loose in the live map',
       (JSON.parse(fs.readFileSync(file, 'utf8')).payoutsArchive || []).length === 1);

    // THE MIGRATION. Records written by the first (wallet-keyed) shape must still count, or the
    // round-scoped reader sees an empty round and re-pays everyone. This is the exact live state
    // left by the 2026-09-04 payout.
    const st5 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st5.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    // ONE clock for both stamps. Two Date.now() calls straddled a millisecond on a slow CI runner
    // (2026-09-06 00:02 UTC), so the payout read as OLDER than the draw and was filed as an
    // earlier promo's record instead of migrated — a flake, not a regression. A real payout is
    // always after its draw, so stamp it a millisecond later.
    const t5 = Date.now();
    st5.payouts = { [W1]: { amountUi: 4000000, sig: 'LEGACY_FLAT', at: t5 + 1 } };   // OLD shape
    st5.draw = { at: t5, seedHash: 'ROUND_LIVE', mint: MINT, winners: [
      { place: 1, wallet: W1, prize: 4000000, entries: 3 },
    ] };
    fs.writeFileSync(file, JSON.stringify(st5));
    const o7 = gw.payoutOwed();
    ok('a payout recorded in the OLD wallet-keyed shape is NOT re-owed',
       o7.owed.length === 0, 'would have re-paid: ' + JSON.stringify(o7.owed));
    const migrated = gw.payoutState();
    ok('the legacy record is migrated under the current round, not duplicated',
       migrated.ROUND_LIVE && migrated.ROUND_LIVE[W1] && migrated.ROUND_LIVE[W1].sig === 'LEGACY_FLAT'
       && migrated[W1] === undefined, JSON.stringify(migrated));

    // THE MIGRATION MUST NOT ADOPT AN OLD PROMO'S RECORDS.
    //
    // migratePayouts runs on every read, forever — not once. Folding every flat record into
    // "whatever draw is current" meant that after the next promo was drawn, promo 1's payment was
    // read as promo 2's, and a repeat winner was reported already-paid and silently never got
    // their new prize. The discriminator is time: a record written BEFORE the current draw was
    // sealed cannot be a payment for it.
    const st8 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st8.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    st8.payouts = { [W1]: { amountUi: 4000000, sig: 'PROMO1_FLAT', at: 1000 } };   // OLD promo, OLD shape
    st8.draw = { at: 9999999, seedHash: 'PROMO2', mint: MINT, winners: [
      { place: 1, wallet: W1, prize: 1000000, entries: 3 },
    ] };
    fs.writeFileSync(file, JSON.stringify(st8));
    const o8 = gw.payoutOwed();
    ok('a flat record from an EARLIER promo does not cancel this promo\'s prize',
       o8.owed.length === 1 && o8.owed[0].amountUi === 1000000,
       'winner stranded — owed: ' + JSON.stringify(o8.owed));
    const st8after = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok('the old record is parked under legacy, not destroyed',
       st8after.payouts.legacy && st8after.payouts.legacy[W1] &&
       st8after.payouts.legacy[W1].sig === 'PROMO1_FLAT' && !st8after.payouts[W1],
       JSON.stringify(st8after.payouts));

    // A PENDING RECORD MUST NOT BLOCK FOREVER. confirmSig gives up around blockhash expiry, so
    // most pending rows are transactions that were dropped and will never land — and with no way
    // to clear one, that winner could never be paid again through this endpoint.
    const st9 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st9.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    st9.payouts = {}; st9.payoutsVoid = [];
    st9.draw = { at: 1, seedHash: 'SWEEP', mint: MINT, winners: [{ place: 1, wallet: W1, prize: 4000000, entries: 3 }] };
    fs.writeFileSync(file, JSON.stringify(st9));
    gw.recordPayout([{ wallet: W1, amountUi: 4000000, sig: 'DROPPED_SIG', pending: true }], 'SWEEP');
    // age it past expiry
    const st9b = JSON.parse(fs.readFileSync(file, 'utf8'));
    st9b.payouts.SWEEP[W1].at = Date.now() - 3600000;
    fs.writeFileSync(file, JSON.stringify(st9b));
    ok('a pending record blocks a retry while it is unresolved', gw.payoutOwed().owed.length === 0);
    ok('the pending transfer is surfaced with its signature, not hidden',
       (gw.payoutOwed().pending || []).some((r) => r.sig === 'DROPPED_SIG'));
    sigStatus = [null];                       // the chain has never heard of it
    const sw = await gw.payoutSweepPending({ rpcUrl: 'http://stub' });
    ok('the sweep clears a transaction the chain never saw', sw.ok && sw.cleared.length === 1, JSON.stringify(sw));
    ok('and that winner becomes payable again', gw.payoutOwed().owed.length === 1, JSON.stringify(gw.payoutOwed().owed));
    ok('the cleared record is archived, not silently dropped',
       (JSON.parse(fs.readFileSync(file, 'utf8')).payoutsVoid || []).some((v) => v.sig === 'DROPPED_SIG'));

    // ...but a transaction the chain DOES know must stay paid. Clearing that one re-pays a winner.
    gw.recordPayout([{ wallet: W1, amountUi: 4000000, sig: 'LANDED_SIG', pending: true }], 'SWEEP');
    sigStatus = [{ confirmationStatus: 'finalized', err: null }];
    const sw2 = await gw.payoutSweepPending({ rpcUrl: 'http://stub' });
    ok('the sweep settles a transfer that DID land instead of clearing it',
       sw2.confirmed.length === 1 && sw2.cleared.length === 0, JSON.stringify(sw2));
    ok('a settled winner stays paid', gw.payoutOwed().owed.length === 0);

    // A SEALED PRIZE IS VACATED ONLY BY A HUMAN. traceOutbound sets rec.dq from transfer
    // heuristics with no `manual` flag, and undoDq refuses to lift those — so honouring them here
    // meant one false positive on a routine post-draw &trace=1 made a winner permanently unpayable.
    const st10 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st10.payouts = {};
    st10.wallets[W1] = { entries: 3, usd: 30, tokens: 1000, dq: { reason: 'sent_to_exchange' } };  // scanner, not manual
    st10.draw = { at: 1, seedHash: 'DQTEST', mint: MINT, winners: [{ place: 1, wallet: W1, prize: 4000000, entries: 3 }] };
    fs.writeFileSync(file, JSON.stringify(st10));
    const od1 = gw.payoutOwed();
    ok('a SCANNER flag does not withhold a sealed prize — it is surfaced for the owner to judge',
       od1.owed.length === 1 && (od1.flagged || []).some((f) => f.wallet === W1),
       'owed=' + JSON.stringify(od1.owed) + ' flagged=' + JSON.stringify(od1.flagged));
    const st11 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st11.wallets[W1].dq = { reason: 'sold_before_payout', manual: true };
    fs.writeFileSync(file, JSON.stringify(st11));
    const od2 = gw.payoutOwed();
    ok('a MANUAL disqualification does withhold it',
       od2.owed.length === 0 && od2.disqualified.some((d) => d.wallet === W1), JSON.stringify(od2));

    // An already-paid winner marked afterwards must not read as "prize vacated, unpaid".
    const st12 = JSON.parse(fs.readFileSync(file, 'utf8'));
    st12.payouts = {}; fs.writeFileSync(file, JSON.stringify(st12));
    gw.recordPayout([{ wallet: W1, amountUi: 4000000, sig: 'PAID_THEN_DQ' }], 'DQTEST');
    const od3 = gw.payoutOwed();
    ok('a winner who was PAID and later disqualified is not listed as disqualified',
       !od3.disqualified.some((d) => d.wallet === W1) && od3.owed.length === 0, JSON.stringify(od3.disqualified));

    // the draw pins its mint — a config pointed at the next promo must refuse
    gw.configure({ mint: 'So11111111111111111111111111111111111111112' });
    const o6 = gw.payoutOwed();
    ok('a payout refuses when the config mint no longer matches the sealed draw',
       o6.ok === false && o6.error === 'mint_changed', JSON.stringify(o6));
    gw.configure({ mint: MINT });
  }

  // ---- the send/record/confirm loop --------------------------------------------------------
  // THE PART THAT WAS NEVER TESTED, AND GOT IT WRONG TWICE.
  //
  // Both double-pay bugs lived in whirlpool-vault.js's payout loop, and every test above ran
  // against cuna-giveaway.js only. That is why the previous "a SENT-but-unconfirmed transfer is
  // NOT re-owed" test passed on the broken code: it hand-fed recordPayout a row carrying
  // `{sig, pending:true}` — the very thing the bug threw away — so the defect was invisible to it.
  // The loop is now exported pure and driven here with stubs.
  console.log('\npayout loop — send / record / confirm ordering\n');
  {
    // whirlpool-vault pulls in @solana/web3.js, which the dependency-free node-check job does not
    // install — so these cases SKIP there and run strict in smoke-test (after npm ci) with
    // GIVEAWAY_REQUIRE_VAULT=1, where a skip is a hard failure. Same arrangement as the Normie
    // Quest leaderboard's telemetry-router cases. They still gate every push; they just gate it
    // from the job that has the dependencies.
    let runPayoutLoop = null;
    try { ({ runPayoutLoop } = require(path.join(__dirname, '..', 'lib', 'whirlpool-vault.js'))); }
    catch (e) {
      if (process.env.GIVEAWAY_REQUIRE_VAULT) {
        failures++; console.log('  ✗ whirlpool-vault missing but GIVEAWAY_REQUIRE_VAULT is set: ' + e.message);
      } else {
        console.log('  SKIP  payout-loop cases (@solana/web3.js not installed — dependency-free run)');
      }
    }
    if (runPayoutLoop) {
    const R = [{ wallet: W.held, amountUi: 100 }, { wallet: W.exact, amountUi: 200 }];

    // THE INVARIANT: the signature is durably recorded BEFORE the confirm is awaited. A Railway
    // redeploy or an OOM inside the ~90s confirm window is what turns a gap here into a winner
    // being paid twice.
    {
      const events = [];
      await runPayoutLoop({
        list: R,
        sendOne: async (r) => { events.push('send:' + r.wallet); return 'SIG_' + r.wallet.slice(0, 4); },
        confirmOne: async (sig) => { events.push('confirm:' + sig); },
        onPaid: (row) => { events.push('record:' + row.sig + (row.pending ? ':pending' : ':final')); },
      });
      const i1 = events.indexOf('record:SIG_Btrx:pending');
      const i2 = events.indexOf('confirm:SIG_Btrx');
      ok('the signature is recorded BEFORE the confirm is awaited', i1 !== -1 && i2 !== -1 && i1 < i2,
         events.join(' -> '));
      ok('the confirmation then settles the same record, it does not add a second one',
         events.filter((e) => e.startsWith('record:SIG_Btrx')).join(',') ===
         'record:SIG_Btrx:pending,record:SIG_Btrx:final', events.join(' -> '));
    }

    // A CONFIRM TIMEOUT MUST KEEP THE SIGNATURE. This is the original incident: the sig was lost,
    // the row was recorded as failed with no sig, and payoutOwed put the wallet back in `owed`.
    {
      const recorded = [];
      const r = await runPayoutLoop({
        list: [R[0]],
        sendOne: async () => 'SIG_TIMEOUT',
        confirmOne: async () => { throw new Error('Transaction was not confirmed in 90.00 seconds'); },
        onPaid: (row) => recorded.push(row),
      });
      ok('a confirm timeout still records the signature (the original double-pay)',
         recorded.length >= 1 && recorded[0].sig === 'SIG_TIMEOUT' && recorded[0].pending === true,
         JSON.stringify(recorded));
      ok('and reports it as pending, never as paid', r.action === 'partial' && r.pending.length === 1 && !r.paid.length,
         JSON.stringify({ action: r.action, paid: r.paid.length, pending: r.pending.length }));
    }

    // A SEND FAILURE IS CLEAN. Nothing left the wallet, so it must be retryable — and must NOT be
    // recorded, or the winner is marked paid having received nothing.
    {
      const recorded = [];
      const r = await runPayoutLoop({
        list: [R[0]],
        sendOne: async () => { throw new Error('blockhash not found'); },
        confirmOne: async () => {},
        onPaid: (row) => recorded.push(row),
      });
      ok('a transfer that never left the wallet is failed, not recorded',
         r.failed.length === 1 && r.failed[0].sig === null && recorded.length === 0, JSON.stringify(r.failed));
      ok('a run where everything failed does not report success', r.action === 'failed', r.action);
    }

    // A LEDGER WRITE FAILURE STOPS THE BATCH. If /data is unwritable — exactly the state in which
    // a payout gets retried — sending the next recipient means money out with nothing recorded.
    {
      const sent = [];
      const r = await runPayoutLoop({
        list: R,
        sendOne: async (r2) => { sent.push(r2.wallet); return 'SIG_' + sent.length; },
        confirmOne: async () => {},
        onPaid: () => { throw new Error('EROFS: read-only file system'); },
      });
      ok('a ledger write failure stops the run instead of sending the next recipient',
         sent.length === 1, 'sent ' + sent.length + ': ' + sent.join(','));
      ok('and it says so loudly, naming who was NOT paid',
         r.recordFailed === true && r.unsent.length === 1 && r.unsent[0].wallet === W.exact,
         JSON.stringify({ recordFailed: r.recordFailed, unsent: r.unsent }));
    }
    }
  }

  // ---- the payout lock lives in the store ---------------------------------------------------
  // A module-scope boolean guards one process; Railway runs more than one, and the 524-then-retry
  // path can land on a different instance — or on a fresh one after a redeploy where the boolean
  // is false again. Both would read the same `owed` and send the full set.
  console.log('\npayout lock\n');
  {
    gw.payoutLockRelease();
    const a = gw.payoutLockAcquire('ROUND_X');
    ok('the first caller takes the lock', a.ok === true, JSON.stringify(a));
    const b = gw.payoutLockAcquire('ROUND_X');
    ok('a second caller is refused while it is held', b.ok === false && b.held === true, JSON.stringify(b));
    ok('the lock survives a process restart (it is on disk, not in a variable)',
       (JSON.parse(fs.readFileSync(file, 'utf8')).payoutLock || {}).round === 'ROUND_X');
    gw.payoutLockRelease(a.token);
    ok('releasing it lets the next run proceed', gw.payoutLockAcquire('ROUND_X').ok === true);
    // A crash must not wedge the endpoint shut forever.
    const stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    stale.payoutLock.at = Date.now() - 3600000;
    fs.writeFileSync(file, JSON.stringify(stale));
    ok('a stale lock from a crashed run expires instead of needing a human',
       gw.payoutLockAcquire('ROUND_X').ok === true);
    gw.payoutLockRelease();
  }

  // ---- clearing a payment record requires the signature ---------------------------------------
  console.log('\nunpay lever\n');
  {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    st.payouts = {}; st.wallets[W.held] = { entries: 3, usd: 30, tokens: 1000, dq: null };
    st.draw = { at: 1, seedHash: 'UNPAY', mint: MINT, winners: [{ place: 1, wallet: W.held, prize: 500, entries: 3 }] };
    fs.writeFileSync(file, JSON.stringify(st));
    gw.recordPayout([{ wallet: W.held, amountUi: 500, sig: 'REAL_SIG' }], 'UNPAY');
    ok('clearing a record without the signature is refused',
       gw.payoutUnpay(W.held, '').error === 'sig_mismatch');
    ok('clearing it with the WRONG signature is refused',
       gw.payoutUnpay(W.held, 'GUESS').error === 'sig_mismatch');
    ok('the record is still there after both refusals', gw.payoutOwed().owed.length === 0);
    ok('the exact signature clears it', gw.payoutUnpay(W.held, 'REAL_SIG').ok === true);
    ok('and the winner becomes payable again', gw.payoutOwed().owed.length === 1);
  }

  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
