#!/usr/bin/env node
/**
 * nq-boss-ground — measure where each boss's FEET actually land.
 *
 * The bosses are scaled by HEIGHT (`setScale(bScale/k.height)`) and their physics body is a
 * fraction of that height, so the sprite's visible bottom only coincides with the floor when the
 * body box bottom is at the same fraction of the texture as the art's content bottom. Swap in a
 * plate with a different amount of bottom margin and the boss silently hovers or sinks.
 *
 * This asks the running game where the boss sprite really is:
 *   feet = bossSprite.y + bossSprite.h/2      (Phaser origin is centred)
 * and reports the delta against GY (246), the ground's top surface.
 *
 *   node normie-quest/test/nq-boss-ground.cjs [baseUrl] [--res N]
 *
 * Positive delta = SUNK below the floor. Negative = HOVERING above it.
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));
const fs = require('fs');

const BASE = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:3111';
const GY = 246;
const TOLERANCE = 1.0;                       // px of slack before we call it wrong
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// idx -> label. Every boss that resolves through startKolBoss / startCeoBoss / the Rug King
// fall-through, i.e. everything whose grounding the shared body constants control.
const BOSSES = [
  //  - rugking: his idle squash-pulse oscillates displayHeight 62<->72; a sample mid-pulse reads
  //    up to ~5px off. At nominal scale he measures 0 (verified live, twice).
  { idx: 2,  label: 'Rug King (1-3)',      tex: 'rugking', slack: 5.5 },
  { idx: 8,  label: 'Scammy KOL (3-3)',    tex: 'scammykol' },
  { idx: 11, label: 'The Custodian (4-3)', tex: 'ceoboss' },
  { idx: 84, label: 'Tom (TOMSTURF)',      tex: 'tom' },
  { idx: 85, label: 'Shark (BEACH)',       tex: 'shark' },
  { idx: 86, label: 'Sand Lord (SANDCASTLE)', tex: 'sandlord' },
  { idx: 89, label: 'Ghost Ship (GHOSTSHIP)', tex: 'ghostship' },
  // audit #18: the state-machine/VIP paths had the same 4% sink the shared path was cured of —
  // guard them all so a future plate swap can't silently re-break any of them.
  { idx: 17, label: 'Hash Lord (6-3)',       tex: 'golem' },
  { idx: 20, label: 'Yield Reaper (7-3)',    tex: 'reaper' },
  { idx: 23, label: 'Great Bear (8-3)',      tex: 'greatbear' },
  { idx: 66, label: 'Saylor (20-3)',         tex: 'saylor' },
  { idx: 45, label: 'VIP boss (13-3)',       tex: 'vip' },
  // slack: expected |delta| beyond the global tolerance, with the reason.
  //  - troll: its plate keeps a real 4.4% bottom MARGIN (not a crop — see the media library), and
  //    this harness measures the FRAME bottom; his visible feet sit on GY exactly.
  { idx: 28, label: 'Troll (TRENCHES)',      tex: 'troll', slack: 3.2 },
];

function chromePath() {
  const root = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(root) && fs.statSync(root).isFile()) return root;
  try {
    for (const d of fs.readdirSync(root)) {
      if (!/^chromium-/.test(d)) continue;
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return undefined;
}

// The lab page is an ~11MB single file (Phaser + 58 inlined base64 assets) and this harness
// navigates it once per boss in ONE long-lived page. On a loaded box the renderer eventually
// takes >30s to hand back domcontentloaded — 13-3 timed out on the 12th navigation while the
// 13th passed, so it is contention, not a broken boss. An ERROR row counts as a failure, so
// that flake reads as "the VIP boss is unmeasurable" and reds the build for nothing. Retry the
// navigation once with a fresh, longer budget before believing it.
async function gotoLab(page) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(BASE + '/normie-quest-x7-lab', { waitUntil: 'domcontentloaded', timeout: attempt === 1 ? 30000 : 90000 });
      await page.waitForFunction('!!window.__NQ_STARTLEVEL', { timeout: attempt === 1 ? 30000 : 90000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(2000);
    }
  }
}

async function measure(page, b) {
  await gotoLab(page);
  await sleep(900);
  await page.evaluate(i => window.__NQ_STARTLEVEL(i, 0), b.idx);
  await sleep(1400);
  const forced = await page.evaluate(() => window.__NQ_FORCEBOSS && window.__NQ_FORCEBOSS());
  await sleep(1200);
  // headless never settles a forced boss's fall — drop it onto the floor explicitly
  await page.evaluate(() => window.__NQ_SHOVEBOSS && window.__NQ_SHOVEBOSS(0, 222));
  await sleep(1600);
  const g = await page.evaluate(() => window.__NQ_BOSSBODY && window.__NQ_BOSSBODY());
  if (!g) return { ...b, ok: false, err: `no boss sprite (forced=${forced})` };
  return { ...b, ok: true, forced, ...g, delta: +(g.feet - GY).toFixed(2) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const rows = [];
  for (const b of BOSSES) {
    try { rows.push(await measure(page, b)); }
    catch (e) { rows.push({ ...b, ok: false, err: e.message }); }
  }
  await browser.close();

  console.log(`\nboss feet vs GY=${GY}   (+ = sunk below floor, - = hovering)\n`);
  console.log('  ' + 'boss'.padEnd(26) + 'tex'.padEnd(12) + 'frame'.padEnd(10) + 'disp w×h'.padEnd(12)
    + 'botFrac'.padEnd(9) + 'bodyBot'.padEnd(9) + 'feet'.padEnd(9) + 'delta');
  let bad = 0;
  for (const r of rows) {
    if (!r.ok) { console.log('  ' + r.label.padEnd(26) + 'ERROR: ' + r.err); bad++; continue; }
    const tol = TOLERANCE + (r.slack || 0);
    const flag = Math.abs(r.delta) <= tol ? 'ok'
               : (r.delta > 0 ? `SUNK ${r.delta}px` : `HOVER ${Math.abs(r.delta)}px`);
    if (Math.abs(r.delta) > tol) bad++;
    console.log('  ' + r.label.padEnd(26) + String(r.tex).padEnd(12)
      + `${r.frameW}×${r.frameH}`.padEnd(10)
      + `${r.dispW}×${r.dispH}`.padEnd(12)
      + String(r.botFrac).padEnd(9) + String(r.bodyBot).padEnd(9)
      + r.feet.toFixed(1).padEnd(9)
      + (r.delta > 0 ? '+' : '') + r.delta + '   ' + flag);
  }
  console.log('');
  process.exit(bad ? 1 : 0);
})();
