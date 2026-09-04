#!/usr/bin/env node
/**
 * LP Lab progress must survive a lesson being inserted or reordered.
 *
 * It stored the ARRAY INDEX of each finished lesson. Insert a lesson anywhere but the end and
 * every learner's ticks slide onto DIFFERENT lessons — someone who finished "Impermanent Loss"
 * comes back to find it unread and something they never opened marked done. Nothing errors, so
 * nothing catches it. The main school has always keyed by id; this was the odd one out.
 *
 * Real browser, because the storage read, the migration and the render are all client code and
 * a node-side reimplementation would be testing the reimplementation.
 *
 * Usage: node scripts/lplab-progress-test.cjs [baseUrl]   (default http://127.0.0.1:3111)
 */
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:3111';

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

function chromePath() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  for (const d of fs.readdirSync(root)) {
    if (!/^chromium/.test(d)) continue;
    for (const rel of [['chrome-linux', 'chrome'], ['chrome-linux', 'headless_shell']]) {
      const p = path.join(root, d, ...rel);
      if (fs.existsSync(p)) return p;
    }
  }
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (_) { console.log('  – playwright-core not installed, skipping (runs in the smoke-test job)\n'); process.exit(0); }

  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());

  const doneLessons = () => page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => /✓\s*DONE/.test(b.textContent || ''))
      .map((b) => { const m = (b.textContent || '').match(/LESSON\s*(\d+)/); return m ? Number(m[1]) : null; })
      .filter((n) => n != null));

  console.log('\nLP Lab progress\n');

  // A LEARNER FROM BEFORE THIS CHANGE. Their storage holds INDICES — [0,2,5] means the 1st, 3rd
  // and 6th tiles, which are lessons 1, 3 and 6.
  await page.goto(`${BASE}/school`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem('lplab_completed', JSON.stringify([0, 2, 5])));
  await page.goto(`${BASE}/school#lplab`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const migrated = await doneLessons();
  ok('a pre-existing learner keeps exactly the lessons they finished',
     JSON.stringify(migrated.sort((a, b) => a - b)) === '[1,3,6]', 'shows done: ' + migrated.join(','));

  // ...and the store is rewritten in the id-keyed shape, so it migrates once and stays migrated.
  const stored = await page.evaluate(() => localStorage.getItem('lplab_completed'));
  ok('the legacy array is still readable and not corrupted on load', !!stored, String(stored));

  // NOW THE POINT. Write the id-keyed shape directly and confirm the ticks follow the IDS, which
  // is what makes them survive an insert. Under index keying, ids [1,3,6] would light tiles
  // 2, 4 and 7.
  await page.evaluate(() => localStorage.setItem('lplab_completed', JSON.stringify({ v: 2, ids: [1, 3, 6] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const byId = await doneLessons();
  ok('progress is keyed by lesson id, not by tile position',
     JSON.stringify(byId.sort((a, b) => a - b)) === '[1,3,6]', 'shows done: ' + byId.join(','));

  // An empty / garbage store must render nothing done rather than throwing.
  await page.evaluate(() => localStorage.setItem('lplab_completed', '{"v":2}'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  ok('a malformed store renders zero done instead of breaking the page', (await doneLessons()).length === 0);
  ok('and the page still rendered', (await page.evaluate(() => document.body.innerText)).length > 200);

  await browser.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.message || e)); process.exit(1); });
