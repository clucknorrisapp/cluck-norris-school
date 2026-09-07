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
const fs = require('fs');
// playwright-core is required LAZILY (only inside the require.main guard below), not at module
// top level. nq-verify.cjs requires THIS FILE just for its BOSSES export (so the two lists cannot
// drift — F22), and nq-verify's own planning step (the nq-state-plan CI job) deliberately runs
// with no `npm ci` ("the planner is plain node + git"), so playwright-core is not on disk there.
// A top-level require used to make every plan (including one that touches no boss plate at all)
// throw MODULE_NOT_FOUND in that job. require.main===module is true only when this file is run
// directly (`node nq-boss-ground.cjs …`), which is the one path that actually launches a browser.

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

// ---- 9.2 (2026-09-06 deep dive): the 10 bosses missing above, all looked up PROGRAMMATICALLY
// from LEVELS so a level reorder/insert cannot silently point an entry at the wrong boss. -------
function loadLevels() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game_logic.js'), 'utf8');
  const start = src.indexOf('var LEVELS=[');
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i; break; } }
  }
  const H = 270, TILE = 24, W = 480, GY2 = H - TILE;
  return new Function('H', 'TILE', 'W', 'GY', 'return ' + src.slice(open, end + 1) + ';')(H, TILE, W, GY2);
}
const LEVELS = loadLevels();
const idxOfName = (name) => LEVELS.findIndex((l) => l && l.name === name);

// 9-3's SECOND golem. 6-3 (idx 17, 'Hash Lord') already covers the `golem` texture above; the two
// bosses sharing one plate is fine — nq-verify.cjs's isBossPlate Set-dedupes by `tex`, so this adds
// grounding COVERAGE for the second placement without adding a second regex alternative.
{
  const idx = idxOfName('9-3');
  if (idx >= 0 && LEVELS[idx].bossType) BOSSES.push({ idx, label: 'Hash Lord II (9-3)', tex: LEVELS[idx].bossType });
}

// The 8 untested VIP TEMPLATE bosses. All 9 VIP_BOSSES entries share the generic startVipBoss()
// engine (`k=this.physics.add.sprite(dx-64,GY-58,cfg.sprite)`, and VIP_BOSSES[type].sprite===type
// by construction — verified against game_logic.js); 13-3/leviathan is the one already covered
// above. Storm Herald is a VIP_BOSSES entry too but sits at 20-2 (mid-world), not 20-3 — Saylor
// owns 20-3 and is bespoke (its own startSaylorBoss, not this shared engine), already covered.
[
  ['14-3', 'Burn Lord'], ['15-3', 'Diamond Titan'], ['16-3', 'Core Sentinel'],
  ['17-3', 'Market Maker'], ['18-3', 'Chairman'], ['19-3', 'Sat Warden'],
  ['20-2', 'Storm Herald'], ['21-3', 'Wen Moon'],
].forEach(([name, title]) => {
  const idx = idxOfName(name);
  if (idx >= 0 && LEVELS[idx].bossType) BOSSES.push({ idx, label: title + ' (' + name + ')', tex: LEVELS[idx].bossType });
});

// Dirty Whale (12-3): the one boss whose body box deliberately deviates from the 1.00 standard —
// startWhaleBoss() raises the body's TOP only (offset 0.14, height 0.78 → bottom stays 0.92) so it
// still rests on the floor while leaving the charge jumpable. Per the task: assert the ACTUAL
// value startWhaleBoss() declares, not a bare "0.92" typed into this file — read straight from
// game_logic.js so a future re-tune of that line updates the expected slack instead of going
// stale. Fails LOUD (throws at require-time) rather than silently skipping the boss or falling
// back to a guessed number if that function's shape ever changes underneath this.
function deriveWhaleSlack() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game_logic.js'), 'utf8');
  const s = src.indexOf('startWhaleBoss:function');
  const e = s >= 0 ? src.indexOf('whaleBossTick:function', s) : -1;
  if (s < 0 || e < 0) return null;
  const body = src.slice(s, e);
  const scaleM = /k\.setScale\((\d+(?:\.\d+)?)\s*\/\s*k\.height\)/.exec(body);
  const sizeM = /k\.body\.setSize\(k\.width\*[\d.]+,\s*k\.height\*([\d.]+)\)\.setOffset\(k\.width\*[\d.]+,\s*k\.height\*([\d.]+)\)/.exec(body);
  if (!scaleM || !sizeM) return null;
  const dispH = parseFloat(scaleM[1]);
  const heightFrac = parseFloat(sizeM[1]), offsetFrac = parseFloat(sizeM[2]);
  const bodyBot = heightFrac + offsetFrac;                       // fraction of the plate the body's bottom sits at
  const sinkPx = (1 - bodyBot) * dispH;                          // px the body bottom sits ABOVE the plate's drawn bottom
  return { bodyBot, dispH, sinkPx, slack: Math.max(0, +(sinkPx - TOLERANCE + 0.3).toFixed(2)) };
}
{
  const idx = idxOfName('12-3');
  if (idx >= 0) {
    const whale = deriveWhaleSlack();
    if (!whale) {
      throw new Error("[nq-boss-ground] could not derive the Dirty Whale's body-bottom fraction from "
        + 'startWhaleBoss() in game_logic.js — its setScale/setSize/setOffset lines changed shape; '
        + 'update deriveWhaleSlack() (see the 9.2 comment above) rather than hardcoding a number.');
    }
    // bodyBot/sinkPx logged only via the harness's own printed columns (botFrac/bodyBot) when run —
    // nothing here re-asserts bodyBot===0.92 as a magic constant; the DERIVED slack is what gates.
    BOSSES.push({ idx, label: 'Dirty Whale (12-3)', tex: 'dirtywhale', slack: whale.slack });
  }
}

// This is the source of truth for "which asset is a boss plate" (nq-verify.cjs requires this file
// for BOSSES rather than keeping its own copy — F22: a hand-maintained regex there missed 5 of 13
// bosses). Exporting is safe: requiring this module must NOT launch a browser or exit the process,
// which is why the runner below is gated on require.main.
module.exports = { BOSSES };

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

if (require.main === module) (async () => {
  const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));
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
