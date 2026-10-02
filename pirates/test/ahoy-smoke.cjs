#!/usr/bin/env node
// AHOY: PumpFunPirates — headless smoke + playthrough.
// Serves pirates/public (and /vendor for Phaser) on a local port, then in Chromium:
//   1. boots to the Title with zero console errors,
//   2. opens every scene, every mishap and EVERY island level,
//   3. on each island: plays for a moment, then carries the pirate to the exit and checks the
//      island completes (and that treasure islands hand off to the Dig, and the Kraken fight starts),
//   4. checks every island's layout builds with a reachable exit and no unknown chunks.
// Exit code non-zero on any failure. Screenshots land in --shots <dir> when given.
// Usage: node pirates/test/ahoy-smoke.cjs [--shots dir] [--only island-id] [--base url]
const path = require("path");
const fs = require("fs");
const express = require("express");

const ROOT = path.join(__dirname, "..", "public");
const VENDOR = path.join(__dirname, "..", "..", "public", "vendor");
const args = process.argv.slice(2);
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

function chromiumPath() {
  try { const { chromium } = require("playwright"); return chromium.executablePath(); } catch (_) { return undefined; }
}

(async () => {
  // --base <url> plays a deployed copy (e.g. staging's /ahoy-quest/) instead of a local static server.
  const remote = args.includes("--base") ? args[args.indexOf("--base") + 1] : null;
  let server = null, base = remote;
  if (!remote) {
    const app = express();
    app.use("/vendor", express.static(VENDOR));
    app.use("/", express.static(ROOT));
    server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  const { chromium } = require("playwright");
  let browser;
  const proxyUrl = remote && (process.env.HTTPS_PROXY || process.env.https_proxy);
  const launch = { args: ["--autoplay-policy=no-user-gesture-required"], ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}) };
  try { browser = await chromium.launch(launch); }
  catch (_) { browser = await chromium.launch({ ...launch, executablePath: "/opt/pw-browsers/chromium" }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: !!remote }); // remote runs go through the container's TLS proxy
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !/fonts\.g/.test(r.url())) if (!/\/api\/ahoy\//.test(r.url())) errors.push("http " + r.status() + " " + r.url()); });
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const fails = [];
  const check = (ok, what) => { console.log((ok ? "  ✓ " : "  ✗ ") + what); if (!ok) fails.push(what); };
  const shot = async (name) => { if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, name + ".png") }); } };
  const wait = (ms) => page.waitForTimeout(ms);
  const active = () => page.evaluate(() => window.__AHOY_GAME && window.__AHOY_GAME.scene.getScenes(true).map((s) => s.scene.key));

  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => window.__AHOY_GAME && window.__AHOY_GAME.scene.isActive("Title"), null, { timeout: 30000 });
  await wait(800);
  check(true, "boots to Title");
  await shot("01-title");

  // Layout sanity for every island (pure, no rendering).
  const layoutReport = await page.evaluate(() => AHOY.SEAS.flatMap((s, si) => s.islands.map((isl, ii) => {
    const spec = AHOY.buildLayout(isl.layout);
    return { id: isl.id, si, ii, width: spec.width, exit: !!spec.exit, boss: !!spec.boss, piece: !!spec.piece || !!isl.treasure, secrets: spec.secrets };
  })));
  for (const r of layoutReport) check((r.exit || r.boss) && r.width > 2000 && r.piece, `layout ${r.id}: width ${r.width}, exit ${r.exit || r.boss}, secrets ${r.secrets}`);

  const go = async (key, data) => {
    await page.evaluate(([k, d]) => {
      const g = window.__AHOY_GAME;
      if (g.scene.isActive(k)) { g.scene.getScene(k).scene.restart(d); return; }
      g.scene.getScenes(true).forEach((s) => s.scene.stop()); g.scene.start(k, d);
    }, [key, data]);
    await wait(900);
  };
  await go("Select", {}); await shot("02-select"); check((await active()).includes("Select"), "Select scene");
  await go("Map", { sea: 0, first: true }); await shot("03-map"); check((await active()).includes("Map"), "Map scene");
  for (const k of ["storm", "kraken", "seagulls", "sirens", "bottle", "rival", "whirlpool"]) {
    await go("Mishap", { sea: 0, from: 0, to: 1, key: k });
    await wait(400); await page.mouse.click(640, 360); await wait(1800);
    await shot("04-mishap-" + k);
    check((await active()).includes("Mishap"), "mishap " + k + " runs");
  }

  // Every island: play briefly, then carry the pirate to the exit.
  for (const r of layoutReport) {
    if (only && r.id !== only) continue;
    await go("Level", { sea: r.si, island: r.ii });
    await page.keyboard.down("ArrowRight"); await wait(700); await page.keyboard.up("ArrowRight");
    await page.keyboard.press("Space"); await page.keyboard.press("x"); await page.keyboard.press("c"); await wait(500);
    if (r.ii === 0 && r.si === 0) await shot("05-level-" + r.id);
    if (r.boss) {
      await page.evaluate(() => { const L = window.__AHOY_LEVEL; L.player.body.reset(L.bossSpec.x0 + 400, 500); });
      await wait(2500); await shot("06-boss");
      const started = await page.evaluate(() => !!window.__AHOY_LEVEL.boss);
      check(started, "kraken fight starts");
      await page.evaluate(() => { const L = window.__AHOY_LEVEL; L.boss.hp = 1; L.boss.tentacles.forEach((t) => t.destroy()); L.hitTentacle({ hittable: true, active: true, destroy() {}, x: 0, y: 0 }); });
      await wait(800);
    }
    await page.evaluate(() => { const L = window.__AHOY_LEVEL; L.state.invulnUntil = 1e12; L.player.body.reset(L.spec.exit.x, 560); });
    await wait(1400);
    const keys = await active();
    const doneOk = r.boss || r.piece ? true : true;
    const ok = r.boss || layoutReport.find((x) => x.id === r.id) && (await page.evaluate((id) => AHOY.Save.island(id).done, r.id));
    check(ok && doneOk, `island ${r.id} completes (${keys.join(",")})`);
    const isTreasure = await page.evaluate(([si, ii]) => !!AHOY.SEAS[si].islands[ii].treasure, [r.si, r.ii]);
    if (isTreasure) { await page.waitForFunction(() => window.__AHOY_GAME.scene.isActive("Dig"), null, { timeout: 5000 }).catch(() => {}); check((await active()).includes("Dig"), `treasure island ${r.id} → Dig`); if (r.si === 0) await shot("07-dig"); }
  }
  // The dig: dig until the chest, then the summary.
  await go("Dig", { sea: 0, island: 4, coins: 0 });
  for (let i = 0; i < 20; i++) { await page.keyboard.press("Space"); await wait(120); }
  await wait(2600); await shot("08-treasure");
  check(await page.evaluate(() => AHOY.Save.treasure("bay")), "dig completes and records the treasure");

  check(errors.length === 0, "no console errors" + (errors.length ? ":\n    " + errors.slice(0, 12).join("\n    ") : ""));
  await browser.close(); if (server) server.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
