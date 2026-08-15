#!/usr/bin/env node
/*
 * NQ VISUAL — visual-regression gate for Normie Quest.
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The static guards (syntax/geometry/state) and the React smoke test cannot SEE the game. Every
 * costly regression this year was visual and rendered fine: the HUD slid off-screen at 3x, a
 * creature shipped with a black box baked around it, a character was the wrong size, a run
 * animation bounced. All passed every existing check. This renders the game's key surfaces in a
 * real browser and pixel-diffs each against a committed baseline, so a structural visual change
 * fails the build and lands in front of a human instead of on production.
 *
 * It is a REGRESSION gate, not a judge of taste: it says "this looks different from the approved
 * baseline", not "this looks good". When a change is intentional, re-approve with --update and
 * commit the new baselines (that diff is then reviewable in the PR).
 *
 * Usage:
 *   node normie-quest/test/nq-visual.cjs [baseUrl]            compare vs baselines (CI mode; exit 1 on regression)
 *   node normie-quest/test/nq-visual.cjs [baseUrl] --update   (re)generate baselines from the current build
 * baseUrl defaults to http://localhost:3111. The CALLER provides a running server (server.js), the
 * same contract as nq-verify — CI starts one, locally you already have one.
 *
 * Determinism: fixed viewport + DPR, seeded nothing (the game's background stars are random), so the
 * diff uses a per-pixel colour tolerance and a per-surface AREA threshold tuned above the animation/
 * star self-noise. Surfaces are captured at spawn (no enemies on screen yet) and cropped to the
 * region under test where possible, to keep the signal about the thing we're guarding.
 */
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const BASE = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:3111';
const UPDATE = process.argv.includes('--update');
// NQ_RES=<n> forces the game's render-resolution knob (?res=n) on every surface. Left unset for
// normal runs. Set it to reproduce a resolution regression against the res=2 baselines — e.g.
// `NQ_RES=3 node nq-visual.cjs <url>` re-renders the exact 3x zoom that slid the HUD off-screen in
// production, and the hud/char surfaces then fail the diff. That is the proof this gate works.
const NQ_RES = process.env.NQ_RES;
const withRes = u => NQ_RES ? u + (u.includes('?') ? '&' : '?') + 'res=' + NQ_RES : u;
const BASE_DIR = path.join(__dirname, 'visual-baselines');
const DIFF_DIR = path.join(__dirname, 'visual-diffs');           // gitignored; only written on failure
const VIEW = { width: 1194, height: 834, dpr: 2 };
const TOL = 32;                                                  // per-channel delta to count a pixel "changed"
// Hardened for containers/CI: --disable-dev-shm-usage routes shared memory to /tmp (the default
// /dev/shm is tiny in Docker and causes "Failed to open a new tab" crashes under the game's heavy
// base64 texture loads). GPU is left ON — Phaser renders through WebGL.
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function chromePath() {
  const root = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(root) && fs.statSync(root).isFile()) return root;
  try { for (const d of fs.readdirSync(root)) { if (!/^chromium-/.test(d)) continue; const p = path.join(root, d, 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } } catch (e) {}
  return undefined;   // let playwright resolve its own (CI installs one)
}

// A surface is a deterministic game state + a crop. `thresh` is the max % of pixels allowed to differ
// before it's a regression — set per surface, a hair above that surface's measured self-noise.
// Two ways to frame a surface, both in canvas fractions (0..1 across the game canvas):
//   rect: '<target>' + pad{x,y}  — POSITION-AWARE. Ask the game (window.__NQ_RECT) where the thing
//         actually is right now and crop a pad-sized box around its centre. This tracks the player /
//         a floating creature wherever it sits, so the baseline can never silently frame empty
//         background (the trap that made the first cut of this file worthless), and a moving enemy
//         stays centred instead of adding motion noise. 'player'/'boss' resolve directly; any other
//         string is a texture-key regex and the nearest match to the player wins.
//   clip: {x,y,w,h}                — FIXED rectangle. For things pinned to the screen (the HUD is
//         scrollFactor 0) or things that don't move (a ground turret), or the whole title frame.
const SURFACES = [
  { name: 'title',           char: 'normie',    url: '/normie-quest-x7',                    titleScreen: true, clip: null,                        thresh: 3.0 },
  // The persistent top HUD (score / hearts / world / timer / key). This is the strip that slid off
  // at 3x zoom and shipped to production unseen — the regression this whole harness exists for.
  { name: 'hud',             char: 'normie',    url: '/normie-quest-x7?room=scary&at=200',  clip: { x: 0, y: 0, w: 1, h: 0.24 },                 thresh: 2.0 },
  { name: 'char-normie',     char: 'normie',    url: '/normie-quest-x7?room=scary&at=200',  rect: 'player', pad: { x: 0.10, y: 0.13 },           thresh: 4.0 },
  { name: 'char-princess',   char: 'princess',  url: '/normie-quest-x7?room=scary&at=200',  rect: 'player', pad: { x: 0.10, y: 0.13 },           thresh: 4.0 },
  { name: 'char-lilnormie',  char: 'lilnormie', url: '/normie-quest-x7?room=scary&at=200',  rect: 'player', pad: { x: 0.10, y: 0.13 },           thresh: 4.0 },
  // The gravemite turret — the creature that shipped with a black box baked around it. Stationary,
  // sits low with a tall mostly-transparent frame, so a fixed clip on the visible burst frames it
  // better than its padded bounding box would.
  { name: 'scary-gravemite', char: 'normie',    url: '/normie-quest-x7?room=scary&at=1040', clip: { x: 0.52, y: 0.78, w: 0.20, h: 0.21 },         thresh: 3.0 },
];

async function capture(ctx, s) {
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await ctx.route('**/*', r => { const u = r.request().url(); return /\/music\/|\.(mp3|ogg|wav|mp4|m4a)(\?|$)/i.test(u) ? r.abort() : r.continue(); });
  await page.addInitScript(cid => { try { localStorage.setItem('nqHowTo1', '1'); localStorage.setItem('nqChar', cid);
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); } catch (e) {} }, s.char);
  await page.goto(BASE + withRes(s.url), { waitUntil: 'domcontentloaded' });
  // Converge font state: the game's arcade font (Press Start 2P) loads from Google Fonts, and Phaser
  // rasterises HUD text once — if we shoot before it settles, text can differ run to run. Bounded so
  // a fontless environment can't hang the capture.
  await Promise.race([page.evaluate(() => document.fonts && document.fonts.ready), sleep(3000)]).catch(() => {});
  await sleep(2600);
  if (s.titleScreen) {
    // stay on the title; dismiss the how-to overlay if present
    await page.evaluate(() => { const w = document.getElementById('nqhow-wrap'); if (w) w.classList.remove('on'); }).catch(() => {});
  } else {
    // room=* auto-boots into the level; let the intro banner settle so it isn't mid-fade
    await sleep(1600);
  }
  const canvas = await page.$('canvas'); const box = canvas ? await canvas.boundingBox() : null;
  let clip;
  if (box && s.rect) {
    // Position-aware: ask the running game where the target is, then crop a pad-box around its centre.
    const r = await page.evaluate(t => { try { return window.__NQ_RECT ? window.__NQ_RECT(t) : null; } catch (e) { return null; } }, s.rect);
    const c = r && (r.cx != null ? r : (r.hits && r.hits[0]));   // 'player'/'boss' → frac; regex → {player,hits}
    if (!c || c.cx == null) throw new Error(`__NQ_RECT(${s.rect}) found no target (game not in a level?)`);
    const fx = Math.max(0, Math.min(1 - 2 * s.pad.x, c.cx - s.pad.x));
    const fy = Math.max(0, Math.min(1 - 2 * s.pad.y, c.cy - s.pad.y));
    clip = { x: box.x + fx * box.width, y: box.y + fy * box.height, width: Math.min(2 * s.pad.x, 1 - fx) * box.width, height: Math.min(2 * s.pad.y, 1 - fy) * box.height };
  } else if (box && s.clip) {
    clip = { x: box.x + s.clip.x * box.width, y: box.y + s.clip.y * box.height, width: s.clip.w * box.width, height: s.clip.h * box.height };
  } else if (box) {
    clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const shot = await client.send('Page.captureScreenshot', { format: 'png', clip: clip ? { ...clip, scale: 1 } : undefined, captureBeyondViewport: false });
  await page.close();
  return Buffer.from(shot.data, 'base64');
}

// Pixel-diff two PNGs entirely in the browser (native PNG decode + getImageData) — no node deps.
async function diff(ctx, baseBuf, curBuf) {
  const page = await ctx.newPage();
  const r = await page.evaluate(async ({ a, b, tol }) => {
    const load = u => new Promise((ok, e) => { const i = new Image(); i.onload = () => ok(i); i.onerror = e; i.src = u; });
    const [ia, ib] = await Promise.all([load('data:image/png;base64,' + a), load('data:image/png;base64,' + b)]);
    const dimsMatch = ia.width === ib.width && ia.height === ib.height;
    const W = Math.min(ia.width, ib.width), H = Math.min(ia.height, ib.height);
    const data = img => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H); };
    const A = data(ia).data, B = data(ib).data;
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d'); const oi = ox.createImageData(W, H); const O = oi.data;
    let changed = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > tol) { changed++; O[i] = 255; O[i + 1] = 0; O[i + 2] = 90; O[i + 3] = 255; }         // magenta = changed
      else { O[i] = A[i]; O[i + 1] = A[i + 1]; O[i + 2] = A[i + 2]; O[i + 3] = 60; }                // faded original
    }
    ox.putImageData(oi, 0, 0);
    return { pct: +(100 * changed / (W * H)).toFixed(3), dimsMatch, aDim: ia.width + 'x' + ia.height, bDim: ib.width + 'x' + ib.height, diffUrl: out.toDataURL('image/png') };
  }, { a: baseBuf.toString('base64'), b: curBuf.toString('base64'), tol: TOL });
  await page.close();
  return r;
}

// Run one surface end-to-end (capture + optional diff) inside its OWN fresh browser, so a renderer
// crash on one surface can't poison the rest of the run. Returns a result object; throws on crash.
async function runSurface(s) {
  const browser = await chromium.launch({ executablePath: chromePath(), args: LAUNCH_ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.dpr });
    const cur = await capture(ctx, s);
    const basePath = path.join(BASE_DIR, s.name + '.png');
    if (UPDATE || !fs.existsSync(basePath)) return { kind: 'baseline', cur };
    const d = await diff(ctx, fs.readFileSync(basePath), cur);
    return { kind: 'compare', d, cur };
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  let fails = 0, updated = 0;
  for (const s of SURFACES) {
    const basePath = path.join(BASE_DIR, s.name + '.png');
    let res = null, lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { res = await runSurface(s); break; }
      catch (e) { lastErr = e; if (attempt < 2) await sleep(1000); }   // browser crashed — relaunch once
    }
    if (!res) { console.log(`✗ ${s.name.padEnd(18)} capture error: ${(lastErr && lastErr.message || '').slice(0, 80)}`); fails++; continue; }
    if (res.kind === 'baseline') {
      fs.writeFileSync(basePath, res.cur);
      console.log(`● ${s.name.padEnd(18)} baseline ${UPDATE ? 'updated' : 'created'} (${Math.round(res.cur.length / 1024)}KB)`);
      updated++; continue;
    }
    const { d, cur } = res;
    const bad = !d.dimsMatch || d.pct > s.thresh;
    if (bad) {
      fs.mkdirSync(DIFF_DIR, { recursive: true });
      fs.writeFileSync(path.join(DIFF_DIR, s.name + '.current.png'), cur);
      fs.writeFileSync(path.join(DIFF_DIR, s.name + '.diff.png'), Buffer.from(d.diffUrl.split(',')[1], 'base64'));
      console.log(`✗ ${s.name.padEnd(18)} REGRESSION  diff=${d.pct}% (limit ${s.thresh}%)` + (d.dimsMatch ? '' : `  DIMENSIONS CHANGED ${d.bDim} vs baseline ${d.aDim}`));
      fails++;
    } else {
      console.log(`✓ ${s.name.padEnd(18)} ok  diff=${d.pct}% (limit ${s.thresh}%)`);
    }
  }
  if (UPDATE) { console.log(`\n[nq-visual] ${updated} baseline(s) written to ${path.relative(process.cwd(), BASE_DIR)}. Review + commit them.`); process.exit(0); }
  if (fails) { console.log(`\n[nq-visual] ${fails} surface(s) regressed. Diff images in ${path.relative(process.cwd(), DIFF_DIR)}. If intentional: re-run with --update and commit.`); process.exit(1); }
  console.log(`\n[nq-visual] all ${SURFACES.length} surfaces match baseline ✓`); process.exit(0);
})().catch(e => { console.error('[nq-visual] FATAL', e.message); process.exit(2); });
