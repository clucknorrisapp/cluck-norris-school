#!/usr/bin/env node
// Screenshots for eyeballing layout: every sea's map and a touch-controls level, at a chosen
// viewport (default iPad landscape 1366x1024, the shape where the 16:9 game letterboxes).
// Usage: node pirates/test/ahoy-shots.cjs <outDir> [width height]
const path = require("path");
const fs = require("fs");
const express = require("express");

const out = process.argv[2];
if (!out) { console.error("usage: ahoy-shots.cjs <outDir> [width height]"); process.exit(1); }
const W = +process.argv[3] || 1366, H = +process.argv[4] || 1024;
const ROOT = path.join(__dirname, "..", "public");
const VENDOR = path.join(__dirname, "..", "..", "public", "vendor");

(async () => {
  const app = express();
  app.use("/vendor", express.static(VENDOR));
  app.use("/", express.static(ROOT));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const { chromium } = require("playwright");
  let browser;
  try { browser = await chromium.launch(); } catch (_) { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__AHOY_GAME && window.__AHOY_GAME.scene.isActive("Title"), null, { timeout: 30000 });
  await page.evaluate(() => { AHOY.Gate.demoUnlock && AHOY.Gate.demoUnlock(); AHOY.Save.set({ seenControls: true }); });
  fs.mkdirSync(out, { recursive: true });
  const go = async (key, data) => {
    await page.evaluate(([k, d]) => {
      const g = window.__AHOY_GAME; // stop + start of the same key in one frame drops the scene; restart it instead
      if (g.scene.isActive(k)) { g.scene.getScene(k).scene.restart(d); return; }
      g.scene.getScenes(true).forEach((s) => s.scene.stop()); g.scene.start(k, d);
    }, [key, data]);
    await page.waitForTimeout(1100);
  };
  await page.screenshot({ path: path.join(out, "title.png") });
  const seas = await page.evaluate(() => AHOY.SEAS.length);
  for (let i = 0; i < seas; i++) { await go("Map", { sea: i }); await page.screenshot({ path: path.join(out, `map-${i}.png`) }); }
  await go("Level", { sea: 0, island: 1 }); await page.screenshot({ path: path.join(out, "level-touch.png") });
  await page.evaluate(() => window.__AHOY_LEVEL.togglePause()); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, "level-pause.png") });
  await browser.close(); server.close();
  console.log(errors.length ? "errors:\n" + errors.join("\n") : "ok, " + (seas + 3) + " shots in " + out);
})().catch((e) => { console.error(e); process.exit(1); });
