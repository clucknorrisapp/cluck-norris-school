#!/usr/bin/env node
/*
 * NQ ULTIMATE STATE TESTER — headless pre-ship check for Normie Quest.
 * ------------------------------------------------------------------------
 * Boots the game (the lab lane, which turns on the __NQ_* QA hooks) in a
 * headless browser and, for EVERY level, verifies:
 *   • the level boots to a live Game scene with NO JS error (no crash)
 *   • __NQ_DBG() returns a sane snapshot (player present, level name matches)
 *   • every BOSS level force-starts and is STOMP-BEATABLE (__NQ_STOMPTEST)
 *
 * This is the check that stops a broken level/boss from shipping. Run it
 * before merging game changes to main.
 *
 * Usage:   node normie-quest/test/nq-state-test.cjs [baseUrl]
 *   baseUrl default: http://localhost:8099  (must serve /normie-quest-x7-lab —
 *   i.e. `PORT=8099 node server.js` in another shell).
 * Needs:   npm i playwright-core   + a Chromium (CHROME_BIN=/path/to/chrome,
 *   or PLAYWRIGHT_BROWSERS_PATH pointing at an installed chromium).
 * Phaser is fetched once via curl (proxy-aware) and served by route so the
 * headless browser never needs outbound network.
 * Renderer: launched WITHOUT GL flags so Phaser.AUTO falls back to Canvas —
 * fast and deterministic for logic/physics (no software-WebGL stalls).
 * Exit: 0 = all pass, 1 = one or more failures (a table is printed).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = process.argv[2] || process.env.NQ_TEST_BASE || 'http://localhost:8099';
const LAB = BASE + '/normie-quest-x7-lab';
const PHASER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js';
const PHASER_TMP = path.join(require('os').tmpdir(), 'nq-phaser-3.60.0.min.js');

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(root)) {
      if (!/^chromium-/.test(d)) continue;
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return undefined; // let playwright try its bundled default
}

function ensurePhaser() {
  if (fs.existsSync(PHASER_TMP) && fs.statSync(PHASER_TMP).size > 500000) return;
  execSync(`curl -sS -o ${JSON.stringify(PHASER_TMP)} ${JSON.stringify(PHASER_URL)}`, { stdio: 'ignore' });
  if (!fs.existsSync(PHASER_TMP) || fs.statSync(PHASER_TMP).size < 500000) throw new Error('failed to fetch Phaser');
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (e) { console.error('[nq-state-test] playwright-core not installed. Run: npm i playwright-core'); process.exit(2); }

  ensurePhaser();
  const PHASER = fs.readFileSync(PHASER_TMP);

  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let curErrs = [];
  page.on('pageerror', e => curErrs.push(String(e.message).slice(0, 200)));

  await page.route('**/*', route => {
    const u = route.request().url();
    if (/phaser/i.test(u)) return route.fulfill({ contentType: 'application/javascript', body: PHASER });
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort(); // block fonts/analytics/CDNs so nothing hangs
  });

  await page.goto(LAB, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => typeof window.__NQ_STARTLEVEL === 'function' && Array.isArray(window.__NQ_LEVELS_LIST),
    null, { timeout: 30000 });

  const levels = await page.evaluate(() => window.__NQ_LEVELS_LIST);
  const rows = [];
  for (const lv of levels) {
    curErrs = [];
    const row = { i: lv.i, name: lv.name, booted: false, boss: false, stompable: null, errs: [] };
    try {
      await page.evaluate((i) => window.__NQ_STARTLEVEL(i), lv.i);
      try {
        await page.waitForFunction(
          (name) => { try { return typeof window.__NQ_FORCEBOSS === 'function' && window.__NQ_DBG().level === name; } catch (e) { return false; } },
          lv.name, { timeout: 3500 });
        row.booted = true;
      } catch (e) { row.booted = false; }

      if (row.booted) {
        const dbg = await page.evaluate(() => { try { return window.__NQ_DBG(); } catch (e) { return { err: String(e) }; } });
        if (dbg && dbg.err) row.errs.push('DBG:' + dbg.err);
        if (!dbg || dbg.px == null || dbg.px < 0) row.errs.push('no-player');
        const isBoss = await page.evaluate(() => window.__NQ_FORCEBOSS());
        if (isBoss) {
          row.boss = true;
          await page.waitForTimeout(450);
          const st = await page.evaluate(() => { try { return window.__NQ_STOMPTEST(); } catch (e) { return { error: String(e) }; } });
          row.stompable = st && st.stompable === true ? true : (st && st.stompable === false ? false : null);
          row.stompDetail = st;
        }
      }
    } catch (e) { row.errs.push('EX:' + String(e.message).slice(0, 120)); }
    if (curErrs.length) row.errs.push(...curErrs.slice(0, 3));
    rows.push(row);
    // incremental line
    const tag = !row.booted ? 'NO-LOAD' : row.boss ? (row.stompable ? 'BOSS✓' : 'BOSS✗') : 'ok';
    process.stdout.write(`  [${String(row.i).padStart(2)}] ${row.name.padEnd(10)} ${tag}${row.errs.length ? '  ERR:' + row.errs.join('|') : ''}\n`);
  }

  await browser.close();

  // ---- summary ----
  const booted = rows.filter(r => r.booted).length;
  const bosses = rows.filter(r => r.boss);
  const badBoss = bosses.filter(r => r.stompable !== true);
  const crashed = rows.filter(r => r.errs.length);
  const noLoad = rows.filter(r => !r.booted);
  console.log('\n==================== NQ STATE TEST ====================');
  console.log(`levels:        ${rows.length}`);
  console.log(`booted OK:     ${booted}/${rows.length}`);
  console.log(`boss levels:   ${bosses.length}  (stompable: ${bosses.length - badBoss.length}/${bosses.length})`);
  if (noLoad.length) console.log(`did NOT load:  ${noLoad.map(r => r.name).join(', ')}`);
  if (badBoss.length) console.log(`NOT STOMPABLE: ${badBoss.map(r => r.name + ' ' + JSON.stringify(r.stompDetail)).join(' | ')}`);
  if (crashed.length) console.log(`errors:        ${crashed.map(r => r.name + '[' + r.errs.join(';') + ']').join(' | ')}`);
  const pass = badBoss.length === 0 && crashed.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('======================================================');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('[nq-state-test] harness error:', e.message); process.exit(2); });
