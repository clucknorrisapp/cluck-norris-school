#!/usr/bin/env node
/**
 * Locker Room claim cards — token identity + USD values.
 *
 * Owner ask (2026-09-03): "on the locker room can we add usd values when unstaking, the claim
 * section says tokens but not logo or value". Claiming IS the unstake here — there is no separate
 * staking surface — so this covers the claim cards.
 *
 * Drives the real page with the two upstream calls stubbed, because the live path needs a wallet
 * that is the RECIPIENT of a real lock, which a CI container does not have. Everything below the
 * stub — parsing, formatting, pricing, escaping, DOM fill — is the shipped code.
 *
 * Cases are chosen so a wrong dollar figure cannot pass: a priced token, an UNPRICED token (must
 * show no dollar line at all rather than "$0.00"), a sub-cent total, and a hostile symbol.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const BASE = process.argv[2] || 'http://127.0.0.1:3111';
const WALLET = '2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8';
const MINT_A = 'RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF';   // priced
const MINT_B = 'DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS';   // UNPRICED in this fixture
const MINT_C = '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';   // sub-cent + hostile symbol

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
function chromePath() {
  const root = '/opt/pw-browsers';
  for (const d of fs.readdirSync(root)) {
    if (!/^chromium-/.test(d)) continue;
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const LOCKS = [
  { escrow: 'Esc1111111111111111111111111111111111111111', mint: MINT_A, decimals: 6,
    claimableRaw: '1500000000', totalRaw: '5000000000', claimedRaw: '0',
    fullyVested: false, startsClaimingAt: 1 },
  { escrow: 'Esc2222222222222222222222222222222222222222', mint: MINT_B, decimals: 6,
    claimableRaw: '2000000000', totalRaw: '2000000000', claimedRaw: '0',
    fullyVested: true, startsClaimingAt: 1 },
  { escrow: 'Esc3333333333333333333333333333333333333333', mint: MINT_C, decimals: 9,
    claimableRaw: '1000', totalRaw: '1000', claimedRaw: '0',
    fullyVested: true, startsClaimingAt: 1 },
];
// priceUsd deliberately absent for MINT_B; MINT_C is hostile-named and worth a fraction of a cent.
const OVERVIEW = {
  [MINT_A]: { success: true, symbol: 'ROSE', priceUsd: 0.0004 },
  [MINT_B]: { success: true, symbol: 'CLKN' },
  [MINT_C]: { success: true, symbol: '<img src=x onerror=alert(1)>CUNA', priceUsd: 0.000002 },
};

(async () => {
  console.log('\nlocker claim cards — identity + USD\n');
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  await page.route('**/api/lock/claimable*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, locks: LOCKS }) }));
  await page.route('**/api/token-overview*', (r) => {
    const mint = new URL(r.request().url()).searchParams.get('mint');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OVERVIEW[mint] || { success: false }) });
  });
  await page.route('**/api/token-icon*', (r) => r.fulfill({ status: 404, body: '' }));   // force the letter fallback

  // The page's JS is an IIFE, so nothing is reachable from the outside — which is correct, and
  // means the test has to drive the real UI. Inject a Phantom-shaped provider the shared
  // cluck-wallet registry will detect, then click through exactly as a user does.
  await page.addInitScript((w) => {
    const provider = {
      isPhantom: true,
      publicKey: { toString: () => w },
      connect: () => Promise.resolve({ publicKey: { toString: () => w } }),
      disconnect: () => Promise.resolve(),
      signTransaction: (t) => Promise.resolve(t),
      on: () => {}, removeListener: () => {},
    };
    window.phantom = { solana: provider };
    window.solana = provider;
  }, WALLET);

  await page.goto(BASE + '/locker-room', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tab[data-tab="claim"]', { timeout: 20000 });
  await page.click('.tab[data-tab="claim"]');
  await page.waitForTimeout(300);
  // One detected wallet connects straight through; more than one shows a picker first.
  const connectBtn = await page.$('#clConnect');
  if (connectBtn) await connectBtn.click();
  await page.waitForFunction('document.querySelectorAll(".claimcard").length === 3', null, { timeout: 20000 });
  await page.waitForTimeout(1200);   // let the per-mint overview fills land

  const cards = await page.evaluate(() => [...document.querySelectorAll('.claimcard')].map((c) => ({
    sym: (c.querySelector('.cltsym') || {}).textContent || '',
    amt: (c.querySelector('.clamt .n') || {}).textContent || '',
    usdBig: (c.querySelector('.clusd.big') || {}).textContent || '',
    usdMeta: [...c.querySelectorAll('.clusd')].filter((e) => !e.classList.contains('big')).map((e) => e.textContent).join('|'),
    avatarText: (c.querySelector('.clavatar') || {}).textContent || '',
    html: c.innerHTML,
  })));

  // 1. priced token
  ok('a priced lock shows the token amount', cards[0].amt === '1,500', 'got ' + cards[0].amt);
  ok('a priced lock shows a USD estimate on the claimable amount',
     /≈ \$0\.60$/.test(cards[0].usdBig.trim()), 'got "' + cards[0].usdBig + '" (1500 x $0.0004 = $0.60)');
  ok('a priced lock shows a USD estimate for the total',
     /total ≈ \$2\.00$/.test(cards[0].usdMeta.trim()), 'got "' + cards[0].usdMeta + '" (5000 x $0.0004 = $2.00)');
  ok('the symbol replaces the bare mint', cards[0].sym === 'ROSE', 'got ' + cards[0].sym);

  // 2. UNPRICED token — the case that must NOT invent a number
  ok('an UNPRICED lock shows NO dollar line (never "$0.00")',
     cards[1].usdBig.trim() === '' && cards[1].usdMeta.trim() === '',
     'big="' + cards[1].usdBig + '" meta="' + cards[1].usdMeta + '"');
  ok('an unpriced lock still shows its amount and symbol',
     cards[1].amt === '2,000' && cards[1].sym === 'CLKN', cards[1].amt + ' / ' + cards[1].sym);

  // 3. sub-cent + hostile symbol
  ok('a sub-cent value reads "<$0.01" rather than rounding to $0.00',
     cards[2].usdBig.indexOf('<$0.01') !== -1, 'got "' + cards[2].usdBig + '"');
  ok('a hostile token symbol is stripped, not rendered',
     cards[2].sym.indexOf('<img') === -1 && cards[2].html.indexOf('onerror=alert') === -1,
     'sym=' + cards[2].sym);

  // 4. a non-zero amount must never render as zero next to an enabled Claim button
  ok('a tiny non-zero amount reads "<0.0001", not "0.0000"',
     cards[2].amt.trim() === '<0.0001', 'got "' + cards[2].amt + '"');

  // 5. the logo fallback still identifies the token when the icon 404s
  ok('a failed token icon falls back to the symbol initial, not a blank circle',
     cards[0].avatarText.trim().length > 0, 'avatar="' + cards[0].avatarText + '"');

  // LOCKER_SHOT=<path> captures the rendered cards — the owner's review surface for a UI change.
  if (process.env.LOCKER_SHOT) {
    const el = await page.$('#clList');
    if (el) await el.screenshot({ path: process.env.LOCKER_SHOT });
    console.log('  (screenshot -> ' + process.env.LOCKER_SHOT + ')');
  }
  await browser.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
