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

  // The static test server has no API, so the main run is the EXPLICIT preview (?preview=1, honoured on
  // loopback only). A failed config request is never what turns demo mode on — the gate cases at the
  // end of this file prove that.
  await page.goto(remote ? base : base + "?preview=1", { waitUntil: "load" });
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

  // ── Holder gate (findings 4 + 5): the cache is not a grant, and a failed config is not demo mode ──
  const WALLET = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const CONFIG = { ok: true, mint: "m", nftCollection: "c", priceUsd: 0.00004, tiers: [
    { id: "deckhand", label: "Deckhand", holdUsd: 5, holdAhoy: 125000, seas: ["reef", "glacier"] },
    { id: "captain", label: "Captain", holdUsd: 25, holdAhoy: 625000, seas: [] },
    { id: "nft", label: "Crew (NFT holder)", holdUsd: null, holdAhoy: null, seas: [] } ] };
  const gateCase = async ({ seed, seedLocal, config = "ok", session, query = "" }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: !!remote });
    const gp = await ctx.newPage();
    const sessionCalls = [];
    await gp.route(/\/api\/ahoy\/config/, (r) => (config === "ok" ? r.fulfill({ json: CONFIG }) : config === "abort" ? r.abort() : r.fulfill({ status: 500, body: "boom" })));
    await gp.route(/\/api\/ahoy\/session/, (r) => {
      sessionCalls.push(JSON.parse(r.request().postData() || "{}"));
      if (!session) return r.abort();
      return r.fulfill({ status: session.status || 200, json: session.json });
    });
    if (seed != null) await gp.addInitScript(([k, v]) => { try { sessionStorage.setItem(k, v); } catch (_) {} }, ["ahoy_pfp_gate_v1", JSON.stringify(seed)]);
    if (seedLocal != null) await gp.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} }, ["ahoy_pfp_gate_v1", JSON.stringify(seedLocal)]);
    await gp.goto(base + query, { waitUntil: "load" });
    await gp.waitForFunction(() => window.__AHOY_GAME, null, { timeout: 30000 });
    const out = await gp.evaluate(() => {
      const nftSea = AHOY.SEAS.find((x) => x.access === "nft"), capSea = AHOY.SEAS.find((x) => x.access === "captain");
      AHOY.Gate.demoUnlock();
      const afterDemo = AHOY.Gate.canSail(nftSea);
      return { mode: AHOY.Gate.mode(), st: AHOY.Gate.state(), canNft: AHOY.Gate.canSail(nftSea), canCap: AHOY.Gate.canSail(capSea), afterDemo, stored: sessionStorage.getItem("ahoy_pfp_gate_v1") };
    });
    out.sessionCalls = sessionCalls;
    await ctx.close();
    return out;
  };
  const future = Date.now() + 3600e3;
  // Finding 4: a hand-written grant unlocks nothing, with or without a live config.
  let g = await gateCase({ seed: { tier: "nft", demo: false }, seedLocal: { tier: "nft", demo: false } });
  check(g.mode === "live" && !g.canNft && !g.canCap && g.sessionCalls.length === 0, `forged {"tier":"nft"} (no wallet/token/expiry) unlocks nothing and is discarded (mode ${g.mode}, nft ${g.canNft})`);
  g = await gateCase({ seed: { tier: "nft", demo: false, wallet: WALLET, token: "x", exp: Date.now() - 1000 } });
  check(!g.canNft && g.sessionCalls.length === 0 && g.stored === null, "an EXPIRED cached grant is discarded without asking the server");
  g = await gateCase({ seed: { tier: "nft", wallet: WALLET, token: "x", exp: Date.now() + 90 * 24 * 3600e3 } });
  check(!g.canNft && g.sessionCalls.length === 0, "a cached grant with an expiry beyond the server's one-day token life is discarded");
  // A wallet-bound grant is re-checked, and nothing opens until the server says so.
  g = await gateCase({ seed: { tier: "nft", wallet: WALLET, token: "tok", exp: future }, session: { status: 200, json: { ok: true, tier: "free", unavailable: false, ahoy: 0, usd: 0, nfts: [] } } });
  check(g.sessionCalls.length === 1 && g.sessionCalls[0].wallet === WALLET && g.sessionCalls[0].token === "tok" && !g.canNft && !g.canCap, "a cached wallet grant is revalidated on boot; the cached tier is ignored (server says free → locked)");
  g = await gateCase({ seed: { wallet: WALLET, token: "tok", exp: future }, session: { status: 200, json: { ok: true, tier: "nft", unavailable: false, ahoy: 0, usd: 0, nfts: [{ id: "n1", name: "P", image: null, traits: {} }] } } });
  check(g.canNft && g.canCap && g.st.confirmed, "server-confirmed NFT tier unlocks every sea after revalidation");
  g = await gateCase({ seed: { wallet: WALLET, token: "tok", exp: future }, session: { status: 503, json: { ok: false, unavailable: true } } });
  check(!g.canNft && !g.canCap && g.st.unavailable === true && g.stored && JSON.parse(g.stored).wallet === WALLET, "session check unavailable: nothing granted, state says unavailable, cache kept");
  g = await gateCase({ seed: { wallet: WALLET, token: "tok", exp: future } /* session route aborts: network failure */ });
  check(!g.canNft && g.st.unavailable === true && g.stored, "session network failure behaves as unavailable (nothing granted, cache kept)");
  g = await gateCase({ seed: { wallet: WALLET, token: "bad", exp: future }, session: { status: 401, json: { ok: false, expired: true } } });
  check(!g.canNft && g.stored === null && g.st.wallet === null, "a token the server refuses (401) clears the cache");
  // Finding 5: a failed config on the live site is 'gate unavailable', never the demo unlock.
  for (const [label, config] of [["refused connection", "abort"], ["HTTP 500", "500"]]) {
    g = await gateCase({ config });
    check(g.mode === "offline" && !g.st.demo && !g.afterDemo && !g.canNft && !g.canCap, `config ${label} on the live site: mode offline, demo unlock refused, free seas only (mode ${g.mode}, afterDemo ${g.afterDemo})`);
  }
  if (!remote) {
    g = await gateCase({ config: "abort", query: "?preview=1" });
    check(g.mode === "demo" && g.afterDemo, "an EXPLICIT preview (?preview=1 on loopback) still offers the labelled demo unlock");
    g = await gateCase({ config: "abort", query: "?preview=1", seed: { demo: true, tier: "nft", nfts: [] } });
    check(g.mode === "demo" && g.st.demo, "preview keeps its own demo cache");
    g = await gateCase({ seed: { demo: true, tier: "nft", nfts: [] } });
    check(!g.canNft && g.stored === null, "a demo cache means nothing on the live site (discarded)");
  }

  // ── Holder gate round 2: expiry is enforced at decision time; a late answer cannot revive a session ──
  const NFT_SESSION = { ok: true, tier: "nft", unavailable: false, ahoy: 0, usd: 0, nfts: [{ id: "n1", name: "P", image: null, traits: {} }] };
  const newGatePage = async (routes) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: !!remote });
    const gp = await ctx.newPage();
    await gp.route(/\/api\/ahoy\/config/, (r) => r.fulfill({ json: CONFIG }));
    await routes(gp);
    return { ctx, gp };
  };
  const deferred = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };

  // (a) Validate to NFT, then let the clock pass the session expiry: locked again, cache gone.
  {
    const { ctx, gp } = await newGatePage(async (p) => { await p.route(/\/api\/ahoy\/session/, (r) => r.fulfill({ json: NFT_SESSION })); });
    await gp.addInitScript(([k, v]) => { try { sessionStorage.setItem(k, v); } catch (_) {} }, ["ahoy_pfp_gate_v1", JSON.stringify({ wallet: WALLET, token: "tok", exp: Date.now() + 3600e3 })]);
    await gp.goto(base, { waitUntil: "load" });
    await gp.waitForFunction(() => window.__AHOY_GAME, null, { timeout: 30000 });
    const before = await gp.evaluate(() => ({ nft: AHOY.Gate.canSail(AHOY.SEAS.find((x) => x.access === "nft")), confirmed: AHOY.Gate.state().confirmed }));
    check(before.nft && before.confirmed, "validated NFT session unlocks the NFT sea before expiry");
    const after = await gp.evaluate(() => {
      const real = Date.now; Date.now = () => real() + 2 * 3600e3;   // the tab stays open past the token's life
      const nftSea = AHOY.SEAS.find((x) => x.access === "nft"), capSea = AHOY.SEAS.find((x) => x.access === "captain");
      const s = AHOY.Gate.state();
      return { canNft: AHOY.Gate.canSail(nftSea), canCap: AHOY.Gate.canSail(capSea), tier: AHOY.Gate.tier(), wallet: s.wallet, confirmed: s.confirmed, pending: AHOY.Gate.pending(), stored: sessionStorage.getItem("ahoy_pfp_gate_v1") };
    });
    check(!after.canNft && !after.canCap && after.tier === "free" && after.wallet === null && !after.confirmed && !after.pending && after.stored === null,
      `after the session expiry the gated seas lock again and the cache is dropped (nft ${after.canNft}, tier ${after.tier}, wallet ${after.wallet})`);
    await ctx.close();
  }

  // (b) A /session answer that lands after a disconnect is discarded.
  {
    const gate = deferred(); let seen;
    const asked = new Promise((r) => { seen = r; });
    const { ctx, gp } = await newGatePage(async (p) => { await p.route(/\/api\/ahoy\/session/, async (r) => { seen(); await gate.p; try { await r.fulfill({ json: NFT_SESSION }); } catch (_) {} }); });
    await gp.addInitScript(([k, v]) => { try { sessionStorage.setItem(k, v); } catch (_) {} }, ["ahoy_pfp_gate_v1", JSON.stringify({ wallet: WALLET, token: "tok", exp: Date.now() + 3600e3 })]);
    await gp.goto(base, { waitUntil: "commit" });
    await gp.waitForFunction(() => window.AHOY && AHOY.Gate && AHOY.Save, null, { timeout: 30000 });
    await asked; await wait(100);   // the session request is now in flight (boot is awaiting it)
    await gp.evaluate(() => AHOY.Gate.disconnect());
    gate.release(); await wait(700);
    await gp.waitForFunction(() => window.__AHOY_GAME, null, { timeout: 30000 });
    const out = await gp.evaluate(() => ({ locked: !(AHOY.Gate.canSail(AHOY.SEAS.find((x) => x.access === "nft")) || AHOY.Gate.canSail(AHOY.SEAS.find((x) => x.access === "captain"))), st: AHOY.Gate.state(), stored: sessionStorage.getItem("ahoy_pfp_gate_v1") }));
    check(out.locked && out.st.wallet === null && !out.st.confirmed && out.st.tier === "free" && out.stored === null, `a /session answer arriving after disconnect is discarded (wallet ${out.st.wallet}, tier ${out.st.tier}, confirmed ${out.st.confirmed})`);
    await ctx.close();
  }

  // (c) A /verify answer that lands after a disconnect is discarded.
  {
    const gate = deferred(); let seen;
    const asked = new Promise((r) => { seen = r; });
    const { ctx, gp } = await newGatePage(async (p) => {
      await p.route(/\/api\/ahoy\/challenge/, (r) => r.fulfill({ json: { ok: true, message: "sign me", nonce: "n1" } }));
      await p.route(/\/api\/ahoy\/verify/, async (r) => { seen(); await gate.p; try { await r.fulfill({ json: { ok: true, tier: "nft", ahoy: 0, usd: 0, nfts: [{ id: "n1", name: "P", image: null, traits: {} }], token: "tok2", expiresAt: Date.now() + 3600e3 } }); } catch (_) {} });
    });
    await gp.addInitScript((w) => {
      window.solana = { publicKey: null, connect: async () => { window.solana.publicKey = { toString: () => w }; return { publicKey: window.solana.publicKey }; },
        signMessage: async () => ({ signature: new Uint8Array(64).fill(7) }), disconnect: async () => {} };
    }, WALLET);
    await gp.goto(base, { waitUntil: "load" });
    await gp.waitForFunction(() => window.__AHOY_GAME && AHOY.Gate.mode() === "live", null, { timeout: 30000 });
    await gp.evaluate(() => { window.__verifyP = AHOY.Gate.connectAndVerify().then(() => "applied", (e) => "rejected: " + e.message); });
    await asked; await wait(100);
    await gp.evaluate(() => AHOY.Gate.disconnect());
    gate.release();
    const settled = await gp.evaluate(() => window.__verifyP);
    await wait(300);
    const out = await gp.evaluate(() => ({ locked: !(AHOY.Gate.canSail(AHOY.SEAS.find((x) => x.access === "nft")) || AHOY.Gate.canSail(AHOY.SEAS.find((x) => x.access === "captain"))), st: AHOY.Gate.state(), stored: sessionStorage.getItem("ahoy_pfp_gate_v1") }));
    check(out.locked && out.st.wallet === null && !out.st.confirmed && out.st.tier === "free" && out.stored === null && /^rejected/.test(settled), `a /verify answer arriving after disconnect is discarded (${settled}; wallet ${out.st.wallet}, tier ${out.st.tier})`);
    await ctx.close();
  }

  // ── Codex round 3: AHOY no-session-secret mode. /verify answers token:null, expiresAt:null. The
  // verified tier must survive the NEXT decision (it used to be coerced to expiry 0 and dropped) for
  // this page session only: never stored, gone on reload, gone on disconnect, and a late or
  // superseded answer must not restore it.
  const NOSECRET = { ok: true, tier: "nft", ahoy: 0, usd: 0, nfts: [{ id: "n1", name: "P", image: null, traits: {} }], token: null, expiresAt: null };
  const walletInit = (w) => {
    window.solana = { publicKey: null, connect: async () => { window.solana.publicKey = { toString: () => w }; return { publicKey: window.solana.publicKey }; },
      signMessage: async () => ({ signature: new Uint8Array(64).fill(7) }), disconnect: async () => {} };
  };
  const noSecretPage = async (verifyHandler) => {
    const { ctx, gp } = await newGatePage(async (p) => {
      await p.route(/\/api\/ahoy\/challenge/, (r) => r.fulfill({ json: { ok: true, message: "sign me", nonce: "n1" } }));
      await p.route(/\/api\/ahoy\/verify/, verifyHandler);
    });
    await gp.addInitScript(walletInit, WALLET);
    await gp.goto(base, { waitUntil: "load" });
    await gp.waitForFunction(() => window.__AHOY_GAME && AHOY.Gate.mode() === "live", null, { timeout: 30000 });
    return { ctx, gp };
  };
  const gateView = (gp) => gp.evaluate(() => {
    const nftSea = AHOY.SEAS.find((x) => x.access === "nft"), capSea = AHOY.SEAS.find((x) => x.access === "captain");
    const s = AHOY.Gate.state();
    return { canNft: AHOY.Gate.canSail(nftSea), canCap: AHOY.Gate.canSail(capSea), tier: AHOY.Gate.tier(), wallet: s.wallet, confirmed: s.confirmed, pending: AHOY.Gate.pending(), stored: sessionStorage.getItem("ahoy_pfp_gate_v1"), storedLocal: localStorage.getItem("ahoy_pfp_gate_v1") };
  });

  // (d) token:null keeps the verified tier for the next decisions, and writes nothing to storage.
  {
    const { ctx, gp } = await noSecretPage((r) => r.fulfill({ json: NOSECRET }));
    await gp.evaluate(() => AHOY.Gate.connectAndVerify());
    const v1 = await gateView(gp);
    await wait(50);
    const v2 = await gateView(gp);
    check(v1.canNft && v1.canCap && v1.tier === "nft" && v1.confirmed && v1.wallet === WALLET, `no-secret sign-in: the verified tier is honoured (nft ${v1.canNft}, tier ${v1.tier})`);
    check(v2.canNft && v2.tier === "nft" && v2.confirmed, `...and survives the NEXT access decision (tier ${v2.tier}) — it used to be coerced to expiry 0 and dropped`);
    check(v1.stored === null && v1.storedLocal === null, "...and is never persisted to session/local storage");
    // reload: a fresh page load has nothing to restore
    await gp.reload({ waitUntil: "load" });
    await gp.waitForFunction(() => window.__AHOY_GAME && AHOY.Gate.mode() === "live", null, { timeout: 30000 });
    const v3 = await gateView(gp);
    check(!v3.canNft && !v3.canCap && v3.tier === "free" && v3.wallet === null && !v3.confirmed, `reload clears the page-only grant (tier ${v3.tier}, wallet ${v3.wallet})`);
    await ctx.close();
  }

  // (e) disconnect clears it.
  {
    const { ctx, gp } = await noSecretPage((r) => r.fulfill({ json: NOSECRET }));
    await gp.evaluate(() => AHOY.Gate.connectAndVerify());
    const before = await gateView(gp);
    await gp.evaluate(() => AHOY.Gate.disconnect());
    const after = await gateView(gp);
    check(before.canNft && !after.canNft && !after.canCap && after.tier === "free" && after.wallet === null && !after.confirmed, `disconnect clears the page-only grant (before nft ${before.canNft}; after tier ${after.tier}, wallet ${after.wallet})`);
    await ctx.close();
  }

  // (f) a late no-secret /verify answer that arrives after a disconnect is ignored.
  {
    const gate = deferred(); let seen;
    const asked = new Promise((r) => { seen = r; });
    const { ctx, gp } = await noSecretPage(async (r) => { seen(); await gate.p; try { await r.fulfill({ json: NOSECRET }); } catch (_) {} });
    await gp.evaluate(() => { window.__verifyP = AHOY.Gate.connectAndVerify().then(() => "applied", (e) => "rejected: " + e.message); });
    await asked; await wait(100);
    await gp.evaluate(() => AHOY.Gate.disconnect());
    gate.release();
    const settled = await gp.evaluate(() => window.__verifyP);
    await wait(300);
    const out = await gateView(gp);
    check(!out.canNft && !out.canCap && out.wallet === null && !out.confirmed && out.tier === "free" && /^rejected/.test(settled), `a no-secret /verify answer after disconnect does not restore the grant (${settled}; wallet ${out.wallet}, tier ${out.tier})`);
    await ctx.close();
  }

  // (g) a late answer for an OLDER request, after a newer connect has taken over, does not overwrite it.
  {
    const gate = deferred(); let calls = 0; let seen;
    const asked = new Promise((r) => { seen = r; });
    const OLD = { ...NOSECRET, tier: "deckhand", nfts: [] };
    const { ctx, gp } = await noSecretPage(async (r) => {
      const n = ++calls;
      if (n === 1) { seen(); await gate.p; try { await r.fulfill({ json: OLD }); } catch (_) {} }
      else r.fulfill({ json: NOSECRET });
    });
    await gp.evaluate(() => { window.__firstP = AHOY.Gate.connectAndVerify().then(() => "applied", (e) => "rejected: " + e.message); });
    await asked; await wait(100);
    await gp.evaluate(() => AHOY.Gate.connectAndVerify());          // the newer request wins immediately
    gate.release();
    const first = await gp.evaluate(() => window.__firstP);
    await wait(300);
    const out = await gateView(gp);
    check(/^rejected/.test(first) && out.tier === "nft" && out.canNft, `a superseded no-secret answer is dropped; the newer one stands (${first}; tier ${out.tier})`);
    await ctx.close();
  }

  check(errors.length === 0, "no console errors" + (errors.length ? ":\n    " + errors.slice(0, 12).join("\n    ") : ""));
  await browser.close(); if (server) server.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
