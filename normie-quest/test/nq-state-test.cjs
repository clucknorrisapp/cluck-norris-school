#!/usr/bin/env node
/*
 * NQ ULTIMATE STATE TESTER — headless pre-ship check for Normie Quest.
 * ------------------------------------------------------------------------
 * Boots the game (the lab lane, which turns on the __NQ_* QA hooks) in a
 * headless browser and, for EVERY level, verifies:
 *   • the level boots to a live Game scene with NO JS error (no crash)
 *   • __NQ_DBG() returns a sane snapshot (player present, level name matches)
 *   • every BOSS level force-starts and is STOMP-BEATABLE (__NQ_STOMPTEST)
 *   NOTE: this does NOT verify a boss stays on solid ground once the fight is moving. An
 *   attempt at that was removed: the boss spawns invulnerable through its intro and never walks
 *   far enough in a headless run to reach a pit, so the check could not be made to catch the
 *   real 20-2 case it was written for. F14 in nq-geometry-check.cjs guards the data cause.
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

  const RESTART_EVERY = 12;  // relaunch the browser every N levels so 60+ level loads can't OOM one session
  // WORKERS: the levels are completely independent -- nothing about level 40 depends on level 39 --
  // but this ran strictly sequentially, one browser, one level at a time, for ~11s a level. On 82
  // levels that is ~15 minutes, and it gated every deploy. Sharding across a few browsers cuts it
  // to roughly wall-clock/N with identical coverage.
  // Default leaves a core for the dev server. Override with NQ_WORKERS=1 to get the old serial
  // behaviour back (useful when debugging the harness itself, where interleaved output is noise).
  const CPUS = require('os').cpus().length;
  // Default to HALF the cores, not cores-1. At cores-1 (3 workers on a 4-core box, plus the dev
  // server) each browser gets starved and the 25s level-build timeout trips on perfectly good
  // levels -- the first parallel run reported 2-2, 4-2 and 5-2 as NO-LOAD when all three pass
  // serially. A suite that invents failures is worse than a slow one.
  const WORKERS = Math.max(1, Math.min(6, parseInt(process.env.NQ_WORKERS, 10) || Math.max(1, Math.floor(CPUS / 2))));
  // …and the build genuinely IS slower with less CPU per browser, so the timeout has to scale
  // with contention rather than staying at the single-worker figure.
  const BOOT_MS = Math.round(25000 * (1 + (WORKERS - 1) * 0.6));
  async function openSession() {
    const errs = [];
    const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    // Per-session error sink. This used to push into a single module-level `curErrs`, which is
    // exactly the kind of shared mutable state that would silently misattribute one worker's page
    // errors to another worker's level once this went parallel.
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await page.route('**/*', route => {
      const u = route.request().url();
      if (/phaser/i.test(u)) return route.fulfill({ contentType: 'application/javascript', body: PHASER });
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      return route.abort(); // block fonts/analytics/CDNs so nothing hangs
    });
    await page.goto(LAB, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__NQ_STARTLEVEL === 'function' && Array.isArray(window.__NQ_LEVELS_LIST), null, { timeout: 30000 });
    return { browser, page, errs };
  }

  let sess = await openSession();
  let levels = await sess.page.evaluate(() => window.__NQ_LEVELS_LIST);
  // Optional slice filter so a single world can be verified fast (avoids a 60+ level full run).
  //   NQ_ONLY="20-,21-"  → only levels whose name starts with one of these prefixes
  //   NQ_ONLY="55-66"    → only level indices in [55,66]
  const only = (process.env.NQ_ONLY || '').trim();
  if (only) {
    const rangeM = only.match(/^(\d+)-(\d+)$/);
    if (rangeM) { const a = +rangeM[1], b = +rangeM[2]; levels = levels.filter(l => l.i >= a && l.i <= b); }
    else { const pre = only.split(',').map(s => s.trim()).filter(Boolean); levels = levels.filter(l => pre.some(p => l.name.indexOf(p) === 0)); }
    console.log(`[nq-state-test] NQ_ONLY=${only} → testing ${levels.length} level(s)`);
  }
  // Round-robin the shards rather than handing each worker a contiguous block: the wide VIP
  // levels are clustered at the end of the list, so contiguous slices would dump all the slow
  // ones on the last worker and the run would finish no faster than that worker.
  const shards = Array.from({ length: WORKERS }, () => []);
  levels.forEach((lv, n) => shards[n % WORKERS].push(lv));
  const activeShards = shards.filter(sh => sh.length);
  console.log(`[nq-state-test] ${levels.length} levels across ${activeShards.length} worker(s), ${CPUS} cores, boot timeout ${BOOT_MS}ms`);

  async function runShard(shardLevels) {
    const out = [];
    let sess = await openSession();
    let sinceRestart = 0;
    for (const lv of shardLevels) {
      if (sinceRestart >= RESTART_EVERY) { try { await sess.browser.close(); } catch (_) {} sess = await openSession(); sinceRestart = 0; }
      sinceRestart++;
      const page = sess.page;
      sess.errs.length = 0;
      const row = { i: lv.i, name: lv.name, booted: false, boss: false, stompable: null, errs: [] };
      try {
        await page.evaluate((i) => window.__NQ_STARTLEVEL(i), lv.i);
        try {
          await page.waitForFunction(
            (name) => { try { return typeof window.__NQ_FORCEBOSS === 'function' && window.__NQ_DBG().level === name; } catch (e) { return false; } },
            lv.name, { timeout: BOOT_MS }); // wide VIP levels + drone glows are heavy to build in headless Canvas; scales with worker contention
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
      if (sess.errs.length) row.errs.push(...sess.errs.slice(0, 3));
      out.push(row);
      const tag = !row.booted ? 'NO-LOAD' : row.boss ? (row.stompable ? 'BOSS\u2713' : 'BOSS\u2717') : 'ok';
      process.stdout.write(`  [${String(row.i).padStart(2)}] ${row.name.padEnd(10)} ${tag}${row.errs.length ? '  ERR:' + row.errs.join('|') : ''}\n`);
    }
    try { await sess.browser.close(); } catch (_) {}
    return out;
  }

  const t0 = Date.now();
  // Workers interleave their progress lines, so each line carries its own [index] name -- and the
  // summary table below is sorted by index, which is what anyone actually reads.
  const rows = (await Promise.all(activeShards.map(runShard))).flat().sort((a, b) => a.i - b.i);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  // ---- summary ----
  const booted = rows.filter(r => r.booted).length;
  const bosses = rows.filter(r => r.boss);
  const badBoss = bosses.filter(r => r.stompable !== true);
  const crashed = rows.filter(r => r.errs.length);
  const noLoad = rows.filter(r => !r.booted);
  console.log('\n==================== NQ STATE TEST ====================');
  console.log(`levels:        ${rows.length}   (${elapsed}s across ${activeShards.length} worker(s))`);
  console.log(`booted OK:     ${booted}/${rows.length}`);
  console.log(`boss levels:   ${bosses.length}  (stompable: ${bosses.length - badBoss.length}/${bosses.length})`);
  if (noLoad.length) console.log(`did NOT load:  ${noLoad.map(r => r.name).join(', ')}`);
  if (badBoss.length) console.log(`NOT STOMPABLE: ${badBoss.map(r => r.name + ' ' + JSON.stringify(r.stompDetail)).join(' | ')}`);
  if (crashed.length) console.log(`errors:        ${crashed.map(r => r.name + '[' + r.errs.join(';') + ']').join(' | ')}`);
  // A level that does not LOAD is a failure. It was previously reported and then ignored by the
  // pass criterion, so the tester could print "did NOT load: 20-2" and still say PASS -- the
  // third false green of this shape in this repo, after the geometry loader that skipped worlds
  // 1-8 and the checker that skipped every bonus room.
  const pass = badBoss.length === 0 && crashed.length === 0 && noLoad.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('======================================================');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('[nq-state-test] harness error:', e.message); process.exit(2); });
