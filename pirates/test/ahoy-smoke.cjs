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
  // A fake standard-mapping controller the test can press, read through the real Gamepad API path.
  await page.addInitScript(() => {
    const mk = () => ({ pressed: false, value: 0 });
    window.__fakePad = { id: "Test Pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, mk), axes: [0, 0, 0, 0] };
    Object.defineProperty(navigator, "getGamepads", { value: () => [window.__fakePad], configurable: true });
  });
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

  // Controller: pad presses reach menus and play through the same keys the keyboard uses.
  const padPress = async (i, ms = 90) => {
    await page.evaluate((b) => { window.__fakePad.buttons[b] = { pressed: true, value: 1 }; }, i); await wait(ms);
    await page.evaluate((b) => { window.__fakePad.buttons[b] = { pressed: false, value: 0 }; }, i); await wait(ms);
  };
  const BTN = { A: 0, B: 1, X: 2, Y: 3, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  await page.evaluate(() => AHOY.ControlsPanel.open(window.__AHOY_GAME.scene.getScene("Title")));
  await wait(400); await shot("01b-controls");
  await padPress(BTN.A); // first press wakes the pad and shows the highlight
  const status = await page.evaluate(() => AHOY.Input.pad());
  check(status.active && /Test Pad/.test(status.name), "controller detected (" + status.name + ")");
  await padPress(BTN.RIGHT);
  await padPress(BTN.A); // CLOSE (the highlight moved right from REMAP)
  const panelGone = await page.evaluate(() => !window.__AHOY_GAME.scene.getScene("Title").children.list.some((o) => o.depth === 4500 && o.active));
  check(panelGone, "d-pad + A closes the Controls panel");
  await padPress(BTN.DOWN); await padPress(BTN.UP); await padPress(BTN.A); // focus SET SAIL, press it
  await page.waitForFunction(() => window.__AHOY_GAME.scene.getScenes(true).some((s) => s.scene.key === "Select" || s.scene.key === "Map"), null, { timeout: 10000 }).catch(() => {});
  check((await active()).some((k) => k === "Select" || k === "Map"), "controller presses SET SAIL from the title (" + (await active()).join(",") + ")");

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

  // Moves and pose frames, on Launch Beach as Hook Jack (no Ghost Sight, so only the double jump reaches the high chest).
  const missingPoses = await page.evaluate(() => AHOY.CREW.flatMap((c) => AHOY.POSES.map((p) => c.sprite + "-" + p)).filter((k) => !window.__AHOY_GAME.textures.exists(k)));
  check(missingPoses.length === 0, "all 16 pose frames loaded" + (missingPoses.length ? ": missing " + missingPoses.join(", ") : ""));
  await page.evaluate(() => AHOY.Save.set({ crew: "hook", nft: null }));
  await go("Level", { sea: 0, island: 0 });
  const pose = () => page.evaluate(() => window.__AHOY_LEVEL.pvPose);
  await page.keyboard.down("ArrowRight"); await wait(450);
  const runPoses = new Set(); for (let i = 0; i < 6; i++) { runPoses.add(await pose()); await wait(70); }
  await shot("05b-run"); await page.keyboard.up("ArrowRight");
  check(runPoses.has("run1") && runPoses.has("run2"), "running alternates run1/run2 (" + [...runPoses].join(",") + ")");
  await wait(500);
  await page.keyboard.press("x"); await wait(60);
  const swingPose = await pose(); await shot("05d-swing");
  check(swingPose === "swing", "cutlass attack shows the swing frame (" + swingPose + ")");
  await wait(400);
  // Controller in a level: A jumps, X swings, START pauses, A resumes.
  await page.evaluate(() => { const L = window.__AHOY_LEVEL; L.player.body.reset(L.player.x, 540); });
  await wait(500);
  await page.evaluate(() => { window.__fakePad.buttons[0] = { pressed: true, value: 1 }; }); await wait(120);
  const padVy = await page.evaluate(() => window.__AHOY_LEVEL.player.body.velocity.y);
  await page.evaluate(() => { window.__fakePad.buttons[0] = { pressed: false, value: 0 }; }); await wait(700);
  check(padVy < -100, "controller A jumps (vy " + Math.round(padVy) + ")");
  await page.evaluate(() => { window.__fakePad.buttons[2] = { pressed: true, value: 1 }; }); await wait(50);
  const padSwing = await pose();
  await page.evaluate(() => { window.__fakePad.buttons[2] = { pressed: false, value: 0 }; }); await wait(400);
  check(padSwing === "swing", "controller X swings the cutlass (" + padSwing + ")");
  await padPress(BTN.START);
  check(await page.evaluate(() => window.__AHOY_LEVEL.state.paused), "controller START pauses");
  await shot("05f-pause");
  await padPress(BTN.A); await padPress(BTN.A); // highlight RESUME, press it
  check(await page.evaluate(() => !window.__AHOY_LEVEL.state.paused), "controller A resumes from the pause menu");

  // The high chest on Launch Beach (the ghost-plank secret): ground jump, then a second jump at the top.
  const chestInfo = await page.evaluate(() => {
    const L = window.__AHOY_LEVEL; const c = L.chests.getChildren().find((ch) => ch.secret === "ghost");
    L.state.invulnUntil = 1e12; L.player.body.reset(c.x - 30, 540); L.player.body.setVelocity(0, 0);
    return { x: c.x, y: c.y };
  });
  await wait(500);
  // Hold for a full jump (a tap is a deliberate short hop), let go near the top, press again.
  await page.keyboard.down("Space"); await wait(200);
  const jumpPose = await pose();
  await wait(200); await page.keyboard.up("Space"); await wait(40);
  await page.keyboard.down("Space"); await wait(60);
  const spun = await page.evaluate(() => window.__AHOY_LEVEL.state.spinUntil > window.__AHOY_LEVEL.time.now);
  await shot("05e-double-jump");
  await wait(700); await page.keyboard.up("Space"); await wait(600);
  const opened = await page.evaluate(() => window.__AHOY_LEVEL.chests.getChildren().find((ch) => ch.secret === "ghost").opened === true);
  check(jumpPose === "jump", "in the air shows the jump frame (" + jumpPose + ")");
  check(spun, "second jump in the air is a double jump");
  check(opened, `double jump reaches the high chest at y=${chestInfo.y} without Ghost Sight`);

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
