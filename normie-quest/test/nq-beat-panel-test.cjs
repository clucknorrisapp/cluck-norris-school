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
  await page.goto(`${BASE}/normie-quest-x7-lab`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof window.__NQ_STARTLEVEL === "function" && Array.isArray(window.__NQ_LEVELS_LIST) && typeof window.__NQ_FORCECLEAR === "function", null, { timeout: 40000 });
  // Which scenes are live, through the lab hook (NQGAME itself is not a window global).
  const active = (key) => page.evaluate((k) => { try { const l = window.__NQ_SCENES() || []; return l.some((s) => (s && (s.key === k || s.k === k)) || (typeof s === "string" && s === k) || JSON.stringify(s).indexOf('"' + k + '"') !== -1); } catch (e) { return false; } }, key);
  const panelOpen = () => page.evaluate(() => !!window.__NQ_PANEL_OPEN);

  async function toLevelClear() {
    await page.evaluate(() => window.__NQ_STARTLEVEL(0));
    await page.waitForFunction(() => { try { return typeof window.__NQ_DBG === "function" && !!window.__NQ_DBG() && (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"Game"') !== -1); } catch (e) { return false; } }, null, { timeout: 20000 });
    await sleep(800);
    const forced = await page.evaluate(() => window.__NQ_FORCECLEAR());
    await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"LevelClear"') !== -1); } catch (e) { return false; } }, null, { timeout: 15000 }).catch(() => {});
    return forced;
  }

  // 1. Panel open on the beat: the level must NOT start underneath.
  const f1 = await toLevelClear();
  ok("force-clear lands on the LevelClear beat", f1 && (await active("LevelClear")));
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
  await sleep(1200);
  ok("the beat is still up right after closing (hold restarted, not expired)", await active("LevelClear"));
  await page.mouse.click(480, 300);
  await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"Game"') !== -1); } catch (e) { return false; } }, null, { timeout: 5000 }).catch(() => {});
  ok("a tap after closing continues to the next level", await active("Game"), `LevelClear=${await active("LevelClear")} Game=${await active("Game")}`);

  // 3. No panel: the beat still auto-advances on its own (a between-level beat, not a toll gate).
  const f3 = await toLevelClear();
  ok("second force-clear lands on the beat", f3 && (await active("LevelClear")));
  await sleep(2500);
  ok("2.5s in, the beat is still readable (hold is longer than the old 3s)", await active("LevelClear"));
  await page.waitForFunction(() => { try { return (window.__NQ_SCENES() || []).some((s) => JSON.stringify(s).indexOf('"Game"') !== -1); } catch (e) { return false; } }, null, { timeout: 10000 }).catch(() => {});
  ok("with no panel it auto-advances within the 8s ceiling", await active("Game"));

  await browser.close();
  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
