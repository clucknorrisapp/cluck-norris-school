#!/usr/bin/env node
/**
 * nq-pause-touch — does PAUSE actually work with a FINGER, on a tablet-shaped screen?
 *
 * Two defects this guards, both found in the 2026-09-03 pre-play review and both invisible to
 * every other harness (the state test drives the scene directly; the visual gate only looks at
 * pixels; neither one taps anything):
 *
 * 1. THE PAUSE THAT WOULDN'T STICK. The floating-joystick module skips touches in the "top band"
 *    so the ⏸ / ? / gear row stays tappable — but it measured that band against
 *    `window.innerHeight`, while the ⏸ hotspot is defined in CANVAS coordinates. The game is 16:9
 *    and Phaser.Scale.FIT letterboxes it inside a 4:3 tablet screen, so the canvas starts ~100px
 *    down and the hotspot sits BELOW the viewport-relative band. The joystick therefore grabbed
 *    the pause tap; a thumb that rolled a few px while tapping set PAD.left/right/down, and the
 *    "any held pad button resumes" rule then un-paused the game on the very next frame. Reads as
 *    "pause is broken on the iPad".
 *
 * 2. THE RESUME THAT SPENT A DISC. update() early-returns while paused, so prevThrow/prevJump keep
 *    their pre-pause values and the button that DISMISSED the card read as a fresh press. Resuming
 *    by tapping THROW hurled a counted Solana disc (10 per level) with no player intent.
 *
 * Deliberately shaped like a real tablet: 4:3 viewport so the letterboxing is present (a 16:9
 * viewport has no gutter and cannot reproduce #1 at all), hasTouch so the joystick module arms.
 *
 *   node normie-quest/test/nq-pause-touch.cjs [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const BASE = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:3111';
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

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

// Dispatch a REAL touch sequence. Playwright's touchscreen.tap() sends a clean tap with no
// movement, which is precisely the case that did NOT reproduce #1 — the thumb roll is the trigger,
// so the drift has to be expressible.
async function touchTap(page, x, y, driftX, driftY) {
  await page.evaluate(({ x, y, dx, dy }) => {
    const el = document.elementFromPoint(x, y) || document.body;
    const mk = (type, cx, cy) => {
      const t = new Touch({ identifier: 77, target: el, clientX: cx, clientY: cy });
      return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t],
        targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t],
        bubbles: true, cancelable: true });
    };
    el.dispatchEvent(mk('touchstart', x, y));
    if (dx || dy) el.dispatchEvent(mk('touchmove', x + dx, y + dy));
    el.dispatchEvent(mk('touchend', x + dx, y + dy));
  }, { x, y, dx: driftX || 0, dy: driftY || 0 });
}

// Where is the ⏸ hotspot in VIEWPORT coordinates? The game polls it in canvas space
// (fy<0.085, fx 0.215-0.285), so translate through the canvas's real on-screen rect — the whole
// point of the bug is that those two coordinate spaces are not the same on a letterboxed screen.
async function pauseHotspot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#screen canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.25, y: r.top + r.height * 0.05,
             canvasTop: r.top, viewportH: window.innerHeight, topBandCut: window.innerHeight * 0.13 };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
  // 1080x810 = 4:3, a 10.2" iPad in landscape. MUST stay 4:3 — a 16:9 viewport has no letterbox
  // gutter and silently makes this whole file a no-op.
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  console.log('\nnq-pause-touch — pause/resume with a finger on a 4:3 tablet screen\n');
  await page.goto(BASE + '/normie-quest-x7-lab', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__NQ_STARTLEVEL', { timeout: 30000 });
  await sleep(900);
  await page.evaluate(() => window.__NQ_STARTLEVEL(0, 0));
  await sleep(1800);

  const hs = await pauseHotspot(page);
  const dbg0 = await page.evaluate(() => window.__NQ_DBG());
  ok('the level is running and not paused', dbg0 && dbg0.paused === false, JSON.stringify(dbg0 && dbg0.paused));

  // Sanity: this viewport really does letterbox, and the hotspot really does fall below the
  // viewport-relative top band. If this stops being true the rest of the file proves nothing.
  console.log('        canvas top=' + hs.canvasTop.toFixed(0) + 'px, hotspot y=' + hs.y.toFixed(0)
    + 'px, topBand cutoff=' + hs.topBandCut.toFixed(0) + 'px');
  ok('the tablet viewport letterboxes the 16:9 canvas (precondition)', hs.canvasTop > 20,
     'canvasTop=' + hs.canvasTop);

  // ---- 1. tap ⏸ with a small thumb roll, the way a finger actually lands -------------------
  await touchTap(page, hs.x, hs.y, 14, 6);
  await sleep(120);
  const afterTap = await page.evaluate(() => window.__NQ_DBG());
  ok('a finger tap on ⏸ pauses the game', afterTap && afterTap.paused === true,
     'paused=' + (afterTap && afterTap.paused));

  // ...and it has to STAY paused. This is the actual defect: the joystick grab set a pad
  // direction, and "any held pad button resumes" fired on the next frame.
  await sleep(700);
  const stillPaused = await page.evaluate(() => window.__NQ_DBG());
  ok('the pause STAYS paused (a joystick grab must not un-pause it)',
     stillPaused && stillPaused.paused === true, 'paused=' + (stillPaused && stillPaused.paused));
  ok('the game clock is genuinely frozen while paused',
     stillPaused && stillPaused.clockPaused === true, 'clockPaused=' + (stillPaused && stillPaused.clockPaused));

  // ---- 2. resume by tapping THROW — it must not spend a disc -------------------------------
  const ammoBefore = stillPaused ? stillPaused.throwAmmo : null;
  const threw = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#nqpad button')].find(e => e.textContent === 'THROW');
    if (!b) return false;
    const mk = (type) => {
      const t = new Touch({ identifier: 91, target: b, clientX: 10, clientY: 10 });
      return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t],
        targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
    };
    b.dispatchEvent(mk('touchstart'));           // held — this is what resumes
    return true;
  });
  if (!threw) {
    console.log('  SKIP  THROW button not present in this layout — resume-press case not exercised');
  } else {
    await sleep(400);                            // let several frames run while it is held
    const afterResume = await page.evaluate(() => window.__NQ_DBG());
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#nqpad button')].find(e => e.textContent === 'THROW');
      const t = new Touch({ identifier: 91, target: b, clientX: 10, clientY: 10 });
      b.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
    });
    ok('holding THROW resumes the game', afterResume && afterResume.paused === false,
       'paused=' + (afterResume && afterResume.paused));
    ok('resuming on THROW does NOT spend a Solana disc',
       afterResume && afterResume.throwAmmo === ammoBefore,
       'ammo ' + ammoBefore + ' -> ' + (afterResume && afterResume.throwAmmo));
  }

  await browser.close();
  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
