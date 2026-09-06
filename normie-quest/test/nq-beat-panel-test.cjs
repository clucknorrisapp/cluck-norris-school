"use strict";
// The between-level beat and the buy/wallet panel. Owner, 2026-09-05: "between a level i hit the
// grab normie, then it would never let me keep going on the game, like the screen locked with
// music in background and I clicked everywhere and wouldn't work". Cause: GRAB $NORMIE opened the
// DOM panel, the LevelClear beat's auto-advance kept ticking underneath (the Game scene is not live
// on a beat, so __NQ_PAUSE could freeze nothing) and the NEXT LEVEL STARTED BEHIND THE PANEL.
//
// Drives the lab lane's QA hooks in a headless Chromium: force a clear → LevelClear; open the panel;
// the beat must hold; Escape closes it; a tap continues; and with no panel the beat still
// auto-advances after its (now longer) hold. Needs playwright(-core) + a Chromium.
//
// ⚠️ HOW THE BEAT IS REACHED (found 2026-09-06, cost two runs): NOT through __NQ_FORCECLEAR. That
// path waits on Game's 1.5s delayedCall, which counts Phaser DELTA — and Phaser 3.60 pins delta at
// the 60fps target while frames overrun (smoothDelta copies the history entry back), so on a
// headless box rendering at 1-4 fps the hand-off took 22-60s of wall time or never came, and every
// later assertion cascaded. The lab hook __NQ_BEAT() stops every scene and starts LevelClear
// directly, exactly as a real clear leaves it. The beat's hold is wall-clock (time.now - t0), so
// the timing assertions below hold on any machine; only the "tap → Game" waits are generous,
// because BUILDING a level at 1 fps is slow.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };
const PORT = Number(process.env.NQ_BEAT_PORT || 3123);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nq-beat-"));
function findChromium() {
  const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (e2) { console.error("needs playwright(-core)"); process.exit(1); } }
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, "..", ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR }, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }

  console.log("\nNormie Quest: between-level beat vs the buy/wallet panel\n");
  const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.addInitScript(() => { window.__NQ_RENDER = "canvas"; });   // headless WebGL is 0.5 fps on SwiftShader; the canvas renderer runs the same logic at 60 fps
  await page.goto(`${BASE}/normie-quest-x7-lab`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof window.__NQ_STARTLEVEL === "function" && Array.isArray(window.__NQ_LEVELS_LIST) && typeof window.__NQ_BEAT === "function", null, { timeout: 40000 });
  // Which scenes are live, through the lab hook (NQGAME itself is not a window global).
  const active = (key) => page.evaluate((k) => { try { const l = window.__NQ_SCENES() || []; return l.some((s) => (s && (s.key === k || s.k === k)) || (typeof s === "string" && s === k) || JSON.stringify(s).indexOf('"' + k + '"') !== -1); } catch (e) { return false; } }, key);
  const panelOpen = () => page.evaluate(() => !!window.__NQ_PANEL_OPEN);

  async function toLevelClear() {
    const started = await page.evaluate(() => window.__NQ_BEAT(1, "1-1"));
    await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"LevelClear"') !== -1); } catch (e) { return false; } }, null, { timeout: 20000 }).catch(() => {});
    return started;
  }

  // 1. Panel open on the beat: the level must NOT start underneath.
  const f1 = await toLevelClear();
  ok("the beat comes up (LevelClear alone)", f1 && (await active("LevelClear")) && !(await active("Game")));
  await page.evaluate(() => window.__NQ_OPENPREMIUM());
  await sleep(300);
  ok("the buy/wallet panel reports open", await panelOpen());
  await sleep(9500);   // old code auto-advanced after 3s; the new hold is 6-8s and must not run while the panel is open
  ok("after 9.5s with the panel open the beat is STILL showing — no level started behind it", (await active("LevelClear")) && !(await active("Game")),
     `LevelClear=${await active("LevelClear")} Game=${await active("Game")}`);
  // keyboard / pad advance must also be inert while the panel is open
  await page.keyboard.press("Space");
  await sleep(400);
  ok("a key press while the panel is open does not advance the beat", (await active("LevelClear")) && !(await active("Game")));

  // 2. Escape closes the panel; the beat is readable again; a tap continues.
  await page.keyboard.press("Escape");
  await sleep(300);
  ok("Escape closes the panel", !(await panelOpen()));
  await sleep(400);
  ok("the beat is still up right after closing (hold restarted, not expired)", await active("LevelClear"));
  await page.mouse.click(480, 300);
  await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"Game"') !== -1); } catch (e) { return false; } }, null, { timeout: 45000 }).catch(() => {});   // building a level at 1 fps is slow
  ok("a tap after closing continues to the next level", await active("Game"), `LevelClear=${await active("LevelClear")} Game=${await active("Game")}`);

  // 3. No panel: the beat still auto-advances on its own (a between-level beat, not a toll gate).
  const f3 = await toLevelClear();
  ok("the beat comes up again", f3 && (await active("LevelClear")));
  await sleep(2500);
  ok("2.5s in, the beat is still readable (hold is longer than the old 3s)", await active("LevelClear"));
  // The hold is 6-8s wall-clock; the wait is dominated by BUILDING the next level (10-25s at the
  // 1 fps this box manages), so the bound is generous. The hold values themselves are asserted
  // from the built shell below, where a clock cannot blur them.
  await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"Game"') !== -1); } catch (e) { return false; } }, null, { timeout: 45000 }).catch(() => {});
  ok("with no panel it auto-advances on its own (no tap, no key)", await active("Game"), `LevelClear=${await active("LevelClear")} Game=${await active("Game")}`);
  const shell = fs.readFileSync(path.join(__dirname, "..", "public", "normie-quest-platformer.html"), "utf8");
  ok("the shipped hold is 8s for info beats / 6s for plain beats (owner: 'a little longer')", /this\._hold=\(beat==='board'\|\|beat==='card'\|\|beat==='fact'\|\|beat==='perks'\)\?8000:6000;/.test(shell));

  await browser.close();
  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
