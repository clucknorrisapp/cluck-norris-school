"use strict";
// The lock-and-earn page's "announce on X" card only ever appears after a REAL signature, which no
// test can produce. So the page exposes window.__cunaShare and this drives it: the post must be
// built from the plan the wallet signed and the program config (never invented numbers), stay
// under X's 280, hide dollars when the price is unknown, say "once the program opens" while the
// program is disarmed, and hand the text to X's own compose window — we post nothing ourselves.
//
// Boots the real server (the page reads /api/cuna-stake/config on load) and a headless Chromium.
// Needs playwright / playwright-core — the smoke-test job has them; node-check does not.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };

const PORT = 3879;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-share-"));

function findChromium() {
  const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return undefined;
}

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (e2) { console.error("needs playwright(-core)"); process.exit(1); } }

  const srv = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR },
    stdio: "ignore",
  });
  let browser = null;
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) { console.error("  server did not come up"); process.exit(1); }

  console.log("\nLock-and-earn: announce-on-X card\n");
  browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const opened = [];
  await page.exposeFunction("__recordOpen", (u) => opened.push(u));
  await page.addInitScript(() => { window.open = (u) => { window.__recordOpen(String(u)); return null; }; });
  const resp = await page.goto(`${BASE}/cuna-staking`, { waitUntil: "domcontentloaded" });
  ok("page serves", resp && resp.status() === 200, "status " + (resp && resp.status()));
  await page.waitForFunction(() => !!(window.__cunaShare && window.CluckUtil), null, { timeout: 15000 }).catch(() => {});
  ok("test hook present", await page.evaluate(() => !!(window.__cunaShare && window.__cunaShare.build)));

  const CFG = { ok: true, armed: true, mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", decimals: 9,
    terms: { minDurationDays: 90, maxTermDays: 540, minLockRaw: "69000000000000" },
    priceUsd: 2.35e-5, poolTodayRaw: "345000000000000", scanError: null };
  const END = 1796503569; // 2026-12-05
  const build = (plan, cfg) => page.evaluate(([p, c]) => { window.__cunaShare.cfg(c); return window.__cunaShare.build(p); }, [plan, cfg]);
  const len = (t) => page.evaluate((s) => window.__cunaShare.len(s), t);

  const t1 = await build({ amt: "4003211", dur: 90, endUnix: END }, CFG);
  ok("3-month lock: amount, term, unlock date, 1x, pool, ceiling, link", /4,003,211 \$CUNA/.test(t1) && /for 3 months/.test(t1) &&
     /nothing unlocks before 2026-12-05/.test(t1) && /1× the entry rate/.test(t1) && /345,000 CUNA a day, paid hourly/.test(t1) &&
     /up to 6×/.test(t1) && /lock\.cunatoken\.com/.test(t1), t1);
  ok("dollar value shown when the price is known", /\(~\$94\.08\)/.test(t1), t1);
  ok("under 280 as X counts it", (await len(t1)) <= 280, "len " + (await len(t1)));

  const t2 = await build({ amt: "226000000", dur: 540, endUnix: END + 450 * 86400 }, CFG);
  ok("18-month lock says 6x and 18 months", /6× the entry rate/.test(t2) && /for 18 months/.test(t2), t2);
  ok("biggest realistic lock still under 280", (await len(t2)) <= 280, "len " + (await len(t2)));

  const t3 = await build({ amt: "4003211", dur: 90, endUnix: END }, { ...CFG, priceUsd: null });
  ok("no dollar figure when the price lookup failed (never $0.00)", !/\$\d|\(~/.test(t3.replace("$CUNA", "")), t3);

  const t4 = await build({ amt: "4003211", dur: 180, endUnix: END }, { ...CFG, armed: false });
  ok("disarmed program: 'once the program opens', no pool figure, 2x for 6 months",
     /once the CUNA lock-to-earn program opens/.test(t4) && !/CUNA a day/.test(t4) && /2× the entry rate/.test(t4), t4);

  const t5 = await build({ amt: "4003211", dur: 90, endUnix: END }, { ...CFG, scanError: "rpc down", poolTodayRaw: "0" });
  ok("stale/failed pool read: pool figure omitted rather than '0 CUNA'", !/CUNA a day/.test(t5), t5);

  ok("no financial promises in the copy", !/apy|guarantee|profit|return/i.test(t1 + t2 + t4), "");

  // Render the card the way the LOCKED step does and drive the buttons.
  await page.evaluate((c) => { window.__cunaShare.cfg(c); document.getElementById("plan").hidden = false;
    document.getElementById("plan").innerHTML = '<div class="note"><b class="disp">LOCKED 🔒</b></div>'; }, CFG);
  await page.evaluate((p) => window.__cunaShare.show(p), { amt: "4003211", dur: 90, endUnix: END });
  const card = await page.$("#shareCard");
  ok("card renders under the LOCKED note", !!card);
  const ta = await page.$eval("#shareTxt", (el) => el.value).catch(() => "");
  ok("textarea carries the built post", ta === t1, ta);
  const cnt = await page.$eval("#shareCnt", (el) => el.textContent + (el.classList.contains("over") ? " OVER" : "")).catch(() => "");
  ok("counter shows n/280 and is not over", /^\d+\/280$/.test(cnt), cnt);
  await page.fill("#shareTxt", "x".repeat(281));
  const over = await page.$eval("#shareCnt", (el) => el.classList.contains("over"));
  ok("editing past 280 flags the counter", over);
  await page.fill("#shareTxt", t1);
  await page.click("#shareX");
  const u = opened[0] || "";
  ok("POST ON X opens X's own compose window with the text", u.startsWith("https://twitter.com/intent/tweet?text=") &&
     decodeURIComponent(u.slice("https://twitter.com/intent/tweet?text=".length)) === t1, u.slice(0, 120));
  ok("COPY button present", !!(await page.$("#shareCopy")));
  // Re-rendering replaces the card rather than stacking a second one.
  await page.evaluate((p) => window.__cunaShare.show(p), { amt: "1000000", dur: 90, endUnix: END });
  ok("a second render replaces the card", (await page.$$("#shareCard")).length === 1);
  // Nothing user-controlled reaches the card as HTML: the text lives in textarea.value only.
  await page.evaluate((p) => window.__cunaShare.show(p), { amt: "<img src=x onerror=window.__pwned=1>", dur: 90, endUnix: END });
  ok("hostile amount cannot inject markup", !(await page.evaluate(() => window.__pwned)) && (await page.$$("#shareCard img")).length === 0);

  await browser.close();
  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
