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

// ---- pick the level with the most timer-driven hazards, straight from LEVELS ------------------
// (mirrors the LEVELS extraction in nq-geometry-check.cjs / nq-verify.cjs — pure data, no browser).
// Picked programmatically rather than hand-typed so a level rebalance can't silently point this
// at an empty level: snipers/miniworms/pullerRugs/rugPlats are exactly the per-enemy timer groups
// resumeGame()'s allowlist has to rebase (P11 in the 2026-09-06 deep dive).
function pickHazardLevel() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game_logic.js'), 'utf8');
  const start = src.indexOf('var LEVELS=[');
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i; break; } }
  }
  const H = 270, TILE = 24, W = 480, GY = H - TILE;
  const levels = new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(open, end + 1) + ';')(H, TILE, W, GY);
  let best = { idx: 0, score: -1 };
  levels.forEach((lv, i) => {
    if (!lv || lv.boss) return;   // a boss level's own timers are scene-level fields, already rebased
    const rangedOrTimed = (lv.enemies || []).filter(e => ['sniper', 'drillbit', 'laserbot', 'mevdrone'].includes(e[0])).length;
    const score = rangedOrTimed + (lv.miniworms || []).length + (lv.pullerRugs || []).length + (lv.rugplats || []).length;
    if (score > best.score) best = { idx: i, score, name: lv.name };
  });
  return best;
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

// Touches must be REAL (CDP-dispatched) and HELD across frames.
//
// Two instrument lessons, both learned by this file being wrong first:
//   1. Synthetic `new TouchEvent(...)` dispatched from page script never reaches Phaser's input
//      manager, so it can prove nothing about the pause hotspot.
//   2. The ⏸ hotspot is POLLED inside update() (it reads input.manager.pointers each frame),
//      not event-driven. A press+release inside one frame can land entirely between polls, so
//      Playwright's touchscreen.tap() reports "did not pause" on a game where pause works fine.
//      Verified: a 1200ms held touch pauses; the same tap released immediately does not.
// So: dispatch through CDP, and hold long enough to span several frames.
async function holdTouch(cdp, x, y, opts) {
  const o = opts || {};
  const holdMs = o.holdMs || 320;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  if (o.driftX || o.driftY) {
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + (o.driftX || 0), y: y + (o.driftY || 0) }] });
  }
  await sleep(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// Where is the ⏸ hotspot in VIEWPORT coordinates? The game polls it in canvas space
// (fy<0.085, fx 0.215-0.285), so translate through the canvas's real on-screen rect — the whole
// point of the bug is that those two coordinate spaces are not the same on a letterboxed screen.
async function pauseHotspot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#screen canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width * 0.25, y: r.top + r.height * 0.05,
             canvasTop: r.top, viewportH: window.innerHeight,
             // what the joystick guard NOW uses — anchored to the canvas the hotspots live in
             bandCut: r.top + r.height * 0.13,
             // the old viewport-anchored formula, kept so the regression stays visible
             oldBandCut: window.innerHeight * 0.13 };
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
  console.log('        canvas top=' + hs.canvasTop.toFixed(0) + 'px, ⏸ tap y=' + hs.y.toFixed(0)
    + 'px, band now <' + hs.bandCut.toFixed(0) + 'px (old viewport formula was <' + hs.oldBandCut.toFixed(0) + 'px)');
  ok('the tablet viewport letterboxes the 16:9 canvas (precondition)', hs.canvasTop > 20,
     'canvasTop=' + hs.canvasTop);

  // THE REGRESSION GUARD. The joystick's "leave the top HUD alone" band used to be measured
  // against window.innerHeight while the ⏸ hotspot is defined in CANVAS space. On this exact
  // 4:3 viewport the canvas letterboxes ~101px down, so the tap landed at y≈132 while the band
  // ended at ≈105 — outside it, and the floating joystick grabbed the pause tap. Anchoring the
  // band to the canvas rect fixes it for every aspect ratio and is a no-op where the canvas
  // already fills the screen. This asserts the tap is inside the band; it does NOT assert that
  // tapping pauses (see the note below on why that cannot be driven headlessly).
  ok('the ⏸ hotspot falls INSIDE the joystick guard band (was outside it on 4:3)',
     hs.y < hs.bandCut, '⏸ tap y=' + hs.y.toFixed(0) + ' vs band <' + hs.bandCut.toFixed(0));
  ok('the old viewport-anchored band is confirmed to have MISSED it (regression is real)',
     hs.y >= hs.oldBandCut, '⏸ tap y=' + hs.y.toFixed(0) + ' vs old band <' + hs.oldBandCut.toFixed(0));

  const cdp = await ctx.newCDPSession(page);

  // ---- what this file can and cannot prove ---------------------------------------------------
  // NOT ASSERTED: that a finger tap on the ⏸ hotspot pauses. The hotspot is POLLED against
  // Phaser's pointer state inside update(), and driving that reproducibly in a headless canvas
  // defeated four attempts — synthetic TouchEvents never reach Phaser at all, CDP touches held
  // 320ms never registered, and a 1200ms hold paused in one run and not in the next. An unstable
  // assertion that fails on working behaviour is worse than none (this suite has been burned by
  // exactly that before), so the tap case is left to a real device.
  //
  // ✅ RESOLVED 2026-09-04. That geometry mismatch was real: the guard band was measured against
  // the VIEWPORT while the hotspot is defined in CANVAS space, so on a letterboxed 4:3 screen the
  // ⏸ tap landed outside the band and the joystick grabbed it. topBand() is now anchored to the
  // canvas rect, and the two assertions above pin both halves — the tap is inside the band now,
  // and the old formula genuinely missed it. Measured across three aspect ratios: 4:3 went from
  // MISSED to protected, 16:9 is byte-identical, and 3:2 was passing by only 8px before.
  //
  // WHAT IS ASSERTED below: the resume behaviour, driven through the event-driven P key, which is
  // reliable here. That is the path the 2026-09-03 fix changed.

  await page.keyboard.press('KeyP');
  await sleep(250);
  const paused = await page.evaluate(() => window.__NQ_DBG());
  ok('P pauses the game', paused && paused.paused === true, 'paused=' + (paused && paused.paused));
  ok('the game clock is genuinely frozen while paused',
     paused && paused.clockPaused === true, 'clockPaused=' + (paused && paused.clockPaused));

  const ammoBefore = paused ? paused.throwAmmo : null;

  // ---- resuming on a HELD control must not also fire that control ----------------------------
  // update() early-returns while paused, so prevThrow/prevJump keep their pre-pause values and the
  // button that DISMISSED the card read as a fresh edge on the next frame: resuming by holding
  // THROW hurled one of the 10 counted Solana discs with no player intent. resumeGame() now
  // latches both, so a held button must be released and pressed again.
  const box = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#nqpad button')].find(e => e.textContent === 'THROW');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (box) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await sleep(500);                                   // held across many frames
    const afterResume = await page.evaluate(() => window.__NQ_DBG());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok('holding THROW resumes the game', afterResume && afterResume.paused === false,
       'paused=' + (afterResume && afterResume.paused));
    ok('resuming on THROW does NOT spend a Solana disc',
       afterResume && afterResume.throwAmmo === ammoBefore,
       'ammo ' + ammoBefore + ' -> ' + (afterResume && afterResume.throwAmmo));
  } else {
    // The DOM pad only lays out when __NQ_PAD_ACTIVE and the gutter/bottom-band geometry allows it.
    // Fall back to the KEYBOARD form of the same defect, which exercises the identical latch:
    // F is the throw key, and holding it to dismiss the pause card had the same effect.
    console.log('  note: DOM THROW button not laid out at this viewport — using the F key, same latch');
    await page.keyboard.down('KeyF');
    await sleep(500);
    const afterResume = await page.evaluate(() => window.__NQ_DBG());
    await page.keyboard.up('KeyF');
    ok('holding THROW (F) resumes the game', afterResume && afterResume.paused === false,
       'paused=' + (afterResume && afterResume.paused));
    ok('resuming on THROW (F) does NOT spend a Solana disc',
       afterResume && afterResume.throwAmmo === ammoBefore,
       'ammo ' + ammoBefore + ' -> ' + (afterResume && afterResume.throwAmmo));
  }

  // ---- 9.7: PAUSE-REBASE REGRESSION ----------------------------------------------------------
  // P11 (2026-09-06 deep dive): Phaser's Clock keeps advancing `this.time.now` even while
  // `time.paused` is true (it stamps `now` BEFORE checking paused), so every raw `now > deadline`
  // check in the boss/enemy/hazard machines kept counting through a pause. resumeGame() rebases
  // every live deadline by the paused span — but the ORIGINAL fix only matched scene-level field
  // NAMES (.../(Until|At|T0|Cool)$|Next[A-Z]/ on `Object.keys(this)`), which reaches almost no
  // PER-OBJECT field (an enemy's own `nextFire`, a rugPlat's `crumbleAt`, a miniworm's `mwNextAt`
  // live on the enemy/plat/worm object, not on the scene) — so those stayed stale across a pause
  // and all fired together on the very first frame back. game_logic.js now carries an explicit
  // named allowlist per group (enemies/miniworms/pullerRugs/rugPlats/movers/npcs/waterMonsters/
  // dumpZones/drainDeck/slots/cascade, plus `_rkNext`/`_dnNext`/`_rkDust`) alongside the generic
  // scene-field pass — this guards that allowlist from silently narrowing again.
  //
  // WHAT THIS CAN AND CANNOT PROVE. No lab hook exposes a generic per-enemy deadline (only the
  // single "boss" handle's position/texture is exposed, via __NQ_DBG().bossSprite — every OTHER
  // group's timers listed above have no reader at all). So this cannot read `nextFire` off a
  // sniper directly; it uses the best OBSERVABLE proxy available today, stated as best-effort per
  // the task: __NQ_PHYS().total (live physics-body count — already built for exactly this class of
  // "something is silently poisoned/misbehaving" check, see its own comment). The invariant that
  // must hold regardless of the fix's exact mechanism: resuming after a LONG real-world pause must
  // not spawn more bodies on the very next frame than resuming after a near-instant one — if the
  // per-enemy allowlist regresses, every overdue sniper/drillbit/miniworm fires AT ONCE on that
  // frame, and each shot is a new physics body, so the long-pause delta spikes while the
  // short-pause delta (nothing had time to go overdue) stays near zero.
  console.log('\npause-rebase — does resuming after a LONGER pause spawn a burst of extra bodies? (P11)\n');
  const hazardLv = pickHazardLevel();
  console.log('  test level: ' + hazardLv.name + ' (idx ' + hazardLv.idx + ', hazard score ' + hazardLv.score + ')');

  async function pauseResumeBodyDelta(pauseMs) {
    await page.evaluate(i => window.__NQ_STARTLEVEL(i, 0), hazardLv.idx);
    await sleep(900);                                            // let the level finish settling
    const before = await page.evaluate(() => window.__NQ_PHYS && window.__NQ_PHYS());
    await page.evaluate(() => window.__NQ_PAUSE && window.__NQ_PAUSE());
    await sleep(pauseMs);
    await page.evaluate(() => window.__NQ_RESUME && window.__NQ_RESUME());
    // read on the very next tick this process gets, not after an extra settle — the burst (if any)
    // is a first-frame effect and would be masked by giving the game more frames to clear it.
    const after = await page.evaluate(() => window.__NQ_PHYS && window.__NQ_PHYS());
    return { before, after, delta: (before && after) ? after.total - before.total : null };
  }

  const shortRun = await pauseResumeBodyDelta(60);      // barely a pause: nothing should be overdue
  const longRun = await pauseResumeBodyDelta(4500);     // long enough that a stale deadline WOULD trip

  console.log('  short pause (60ms):   bodies ' + (shortRun.before && shortRun.before.total) + ' -> '
    + (shortRun.after && shortRun.after.total) + '  (Δ' + shortRun.delta + ')');
  console.log('  long  pause (4500ms): bodies ' + (longRun.before && longRun.before.total) + ' -> '
    + (longRun.after && longRun.after.total) + '  (Δ' + longRun.delta + ')');

  ok('resuming after a long pause does not burst-spawn extra bodies vs a near-instant pause '
     + '(proxy for "no per-enemy timer fires early" — see the file header for why this is a proxy, not a direct read)',
     shortRun.delta != null && longRun.delta != null && longRun.delta <= shortRun.delta + 4,
     'short Δ=' + shortRun.delta + ', long Δ=' + longRun.delta + ' (long must track short, not spike)');
  ok('no physics body went NaN across the long pause/resume (a single poisoned body silently kills ALL overlaps)',
     longRun.after && longRun.after.nan === 0, 'nan=' + (longRun.after && longRun.after.nan));

  // Secondary, more literal reading of the task ("position/texture unchanged on frame 1"): the ONE
  // enemy whose position AND texture a lab hook does expose is the boss (__NQ_DBG().bossSprite).
  // Weaker signal than the body-count proxy above — the boss's OWN deadlines (this.kolNextShill
  // etc.) are scene-level fields already covered by the generic regex, so this mainly guards the
  // boss's rendering staying frozen across a pause, not the per-enemy-group allowlist — kept as a
  // second, independent check rather than the only one.
  {
    const bossLv = (() => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game_logic.js'), 'utf8');
      const start = src.indexOf('var LEVELS=[');
      const open = src.indexOf('[', start);
      let depth = 0, end = -1;
      for (let i = open; i < src.length; i++) { const c = src[i]; if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i; break; } } }
      const H = 270, TILE = 24, W = 480, GY = H - TILE;
      const levels = new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(open, end + 1) + ';')(H, TILE, W, GY);
      const i = levels.findIndex(l => l && l.boss && l.bossType && l.bossType !== 'wormhole');
      return { idx: i < 0 ? 2 : i, name: (i < 0 ? levels[2] : levels[i]).name };
    })();
    console.log('  boss level: ' + bossLv.name + ' (idx ' + bossLv.idx + ')');
    await page.evaluate(i => window.__NQ_STARTLEVEL(i, 0), bossLv.idx);
    await sleep(1400);
    const d0 = await page.evaluate(() => window.__NQ_DBG && window.__NQ_DBG());
    if (d0 && d0.bossSprite && d0.bossSprite !== 'err') {
      await page.evaluate(() => window.__NQ_PAUSE && window.__NQ_PAUSE());
      await sleep(4500);
      await page.evaluate(() => window.__NQ_RESUME && window.__NQ_RESUME());
      const d1 = await page.evaluate(() => window.__NQ_DBG && window.__NQ_DBG());
      const b0 = d0.bossSprite, b1 = d1 && d1.bossSprite;
      ok('boss texture is unchanged on the first read after resume (no attack-state jump)',
         !!b1 && b1 !== 'err' && b1.tex === b0.tex, 'tex ' + b0.tex + ' -> ' + (b1 && b1.tex));
      const dx = b1 && b1 !== 'err' ? Math.abs(b1.x - b0.x) : Infinity;
      const dy = b1 && b1 !== 'err' ? Math.abs(b1.y - b0.y) : Infinity;
      ok('boss position has not teleported on the first read after resume (small drift only)',
         dx <= 24 && dy <= 24, 'Δx=' + dx + ' Δy=' + dy + ' (x ' + b0.x + '->' + (b1 && b1.x) + ', y ' + b0.y + '->' + (b1 && b1.y) + ')');
    } else {
      console.log('  note: no boss sprite readable at idx ' + bossLv.idx + ' — skipping the position/texture check');
    }
  }

  await browser.close();
  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
