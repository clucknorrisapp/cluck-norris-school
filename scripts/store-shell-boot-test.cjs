"use strict";
// The Google Play / iOS edition of the Seeker shell, actually booted (store-edition v1.1.0).
//
// seeker-app-boot-test.cjs boots the FULL seeker tarball. store-edition-test.cjs re-checks the
// education tarball's CONTENTS. Neither opens the education bundle in a browser, and the whole
// point of the v1.1.0 change is what a person sees: the phone shell, with the school leading and
// no wallet anywhere. So this boots the shipped google tarball in headless Chromium at phone
// size, with every /api/** refused (the school is bundled; nothing needs the network to render),
// and asserts what a store reviewer and a learner would both notice.
//
//   A. It mounts, lands on the school, and NOTHING wallet-shaped exists — no connect button, no
//      CluckWallet / CluckGate global, no route to a wallet tool (a stale deep link to one lands
//      on the school, not a blank pane).
//   B. The five education tabs render and each one mounts a real pane offline.
//   C. Wallet Checkup takes a PASTED address and refuses a bad one before any request.
//   D. Ask Cluck carries the Report control under an answer (Google generative-AI policy), and
//      the report posts the reason with the question and answer.
//   E. The school's certificate route mounts, asks the server with the device's own sid, and
//      renders the gate's "not yet" as a true statement, never as an app error.
//   F. The legal footer links the store's own privacy and terms pages, and NOTHING the app
//      requested left the bundle's origin except calls to clucknorris.app.
const { execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };

const ROOT = path.join(__dirname, "..");
const PORT = 3896;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-store-shell-"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

function findChromium() {
  for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) if (fs.existsSync(p)) return p;
  return undefined;
}

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("needs playwright(-core)"); process.exit(1); } }

  const out = execFileSync(process.execPath, ["scripts/build-store-edition.mjs", "google"], { cwd: ROOT, encoding: "utf8" });
  const manifest = JSON.parse(out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop());
  const tgz = path.join(ROOT, "release", manifest.file);
  const app = path.join(TMP, "app");
  fs.mkdirSync(app, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", app, "--strip-components=1"]);

  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(app, rel);
    if (!file.startsWith(app) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  process.on("exit", () => { try { srv.close(); } catch (_) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} try { fs.rmSync(path.join(ROOT, "dist-store-google"), { recursive: true, force: true }); } catch (_) {} });

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], offsite = new Set(), posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) offsite.add(u.split("?")[0]);
    if (r.method() === "POST") { try { posts.push({ url: u.split("?")[0], body: JSON.parse(r.postData() || "{}") }); } catch (_) { posts.push({ url: u.split("?")[0], body: null }); } }
  });
  // Every API call is answered here, never by the live backend: refused by default, with the
  // three the assertions below need shaped like the real server's responses.
  await page.route("**/api/**", (route) => {
    const u = route.request().url();
    if (/\/api\/ask-cluck$/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, answer: "A liquidity pool is a pot of two tokens that traders swap against." }) });
    if (/\/api\/ask-cluck\/report$/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (/\/api\/claim\/certificate$/.test(u)) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_yet", code: "too-few", detail: "The school's record does not show the full curriculum for this device yet." }) });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, status: "unavailable" }) });
  });
  await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 }).catch(() => {});
  const text = () => page.evaluate(() => document.body.innerText || "");
  const go = async (h) => { await page.evaluate((x) => { window.location.hash = x; }, h); await page.waitForTimeout(350); };

  console.log("\nGoogle Play / iOS edition of the shell — the shipped bundle, booted\n");

  // ---- A -----------------------------------------------------------------------------------
  ok("A · it mounts — #root is not an empty div", await page.evaluate(() => !!document.querySelector(".seeker-shell") && document.querySelector("#root").children.length > 0));
  ok("A · it lands on the School", /School of Crypto Hard Knocks/i.test(await text()), (await text()).slice(0, 120));
  const globals = await page.evaluate(() => ({ wallet: typeof window.CluckWallet, gate: typeof window.CluckGate, web3: typeof window.solanaWeb3, util: typeof window.CluckUtil, i18n: typeof window.CLKN_I18N }));
  ok("A · ⚠️ no wallet layer exists in the page (CluckWallet, CluckGate, web3 all undefined)", globals.wallet === "undefined" && globals.gate === "undefined" && globals.web3 === "undefined", globals);
  ok("A · the two shared scripts it DOES need loaded (cluck-util, i18n)", globals.util === "object" && globals.i18n === "object", globals);
  ok("A · ⚠️ no connect-wallet control anywhere in the shell", await page.evaluate(() => !document.querySelector(".seeker-walletbtn, .seeker-walletzone") && !/Connect Wallet/i.test(document.body.innerText)));
  for (const stale of ["#/rent", "#/tools", "#/tools/firepit", "#/tools/lock", "#/tools/airdrop"]) {
    await go(stale);
    ok(`A · a stale deep link to a wallet tool (${stale}) lands on the school, not a blank pane`, /School of Crypto Hard Knocks/i.test(await text()) && /#\/school$/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
  }

  // ---- B -----------------------------------------------------------------------------------
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-navbtn")).map((a) => a.getAttribute("href")));
  ok("B · five education tabs, School first, all hash routes", tabs.length === 5 && /#\/school$/.test(tabs[0]) && tabs.every((h) => String(h).startsWith("#/")), tabs);
  ok("B · no tab points at the toolkit or a wallet tool", !tabs.some((h) => /#\/(tools$|rent|tools\/(firepit|lock|burn|xray|holders|trace|airdrop|hatchery|buyspecial))/.test(h)), tabs);
  for (const [hash, want] of [["#/tools/alpha", /Today's lesson|Daily/i], ["#/ask", /Ask Cluck/i], ["#/checkup", /Wallet Checkup/i], ["#/tools/listing", /Listing Checkup/i], ["#/school", /School of Crypto Hard Knocks/i]]) {
    await go(hash);
    ok(`B · ${hash} mounts its pane offline`, want.test(await text()), (await text()).slice(0, 100));
  }
  const small = await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-navbtn")).map((el) => Math.round(el.getBoundingClientRect().height)).filter((h) => h < 44));
  ok("B · every tab is >= 44px tall", small.length === 0, small);

  // ---- C -----------------------------------------------------------------------------------
  await go("#/checkup");
  ok("C · Wallet Checkup asks for a PASTED address (no wallet to connect)", await page.evaluate(() => !!document.querySelector(".seeker-edu-addrinput")));
  const before = offsite.size;
  await page.fill(".seeker-edu-addrinput", "not-an-address");
  await page.click(".seeker-edu-addrbtn");
  await page.waitForTimeout(200);
  ok("C · a bad address is refused on the device, before any request", /doesn't look like a Solana address/i.test(await text()) && offsite.size === before, (await text()).slice(0, 160));
  await page.fill(".seeker-edu-addrinput", "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh");
  await page.click(".seeker-edu-addrbtn");
  await page.waitForTimeout(500);
  ok("C · a good address runs the scan, and a refused read renders as unavailable — never as a clean wallet", /unavailable|could not|try again/i.test(await text()) && !/no issues found/i.test(await text()), (await text()).slice(0, 200));

  // ---- D -----------------------------------------------------------------------------------
  await go("#/ask");
  await page.fill(".seeker-ask-input", "What is a liquidity pool?");
  await page.click(".seeker-ask-sendbtn");
  await page.waitForFunction(() => !!document.querySelector(".seeker-ask-reportbtn"), null, { timeout: 8000 }).catch(() => {});
  ok("D · ⚠️ an answer carries the Report control", await page.evaluate(() => !!document.querySelector(".seeker-ask-reportbtn")));
  await page.click(".seeker-ask-reportbtn");
  await page.waitForTimeout(150);
  await page.click(".seeker-ask-report-pick button >> nth=0");
  await page.waitForTimeout(400);
  const rep = posts.find((p) => /\/api\/ask-cluck\/report$/.test(p.url));
  ok("D · the report posts the reason with the question and the answer, nothing else", !!rep && rep.body && rep.body.reason === "inaccurate" && /liquidity pool/i.test(rep.body.question) && /liquidity pool/i.test(rep.body.answer) && Object.keys(rep.body).sort().join() === "answer,question,reason", rep);
  ok("D · and says so on screen", /reported/i.test(await text()));

  // ---- E -----------------------------------------------------------------------------------
  await go("#/school/certificate");
  await page.waitForTimeout(600);
  const cert = posts.find((p) => /\/api\/claim\/certificate$/.test(p.url));
  ok("E · the certificate route asks the server with THIS device's sid and its coursework", !!cert && cert.body && /^[a-z0-9-]{8,64}$/.test(String(cert.body.sid)) && cert.body.coursework && typeof cert.body.coursework.lpLab === "number", cert);
  ok("E · ⚠️ 'not yet' renders as the record's own sentence, not as an app error", /record does not show the full curriculum/i.test(await text()) && !/could not be issued/i.test(await text()), (await text()).slice(0, 240));
  ok("E · and it never calls the WALLET claim", !posts.some((p) => /\/api\/claim$/.test(p.url)));

  // ---- F -----------------------------------------------------------------------------------
  const legal = await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-edu-footer a")).map((a) => a.getAttribute("href")));
  ok("F · the footer links the store's own privacy and terms pages", legal.includes("https://clucknorris.app/privacy/store") && legal.includes("https://clucknorris.app/terms/store"), legal);
  const strangers = [...offsite].filter((u) => !/^https:\/\/clucknorris\.app\//.test(u));
  ok("F · ⚠️ nothing left the bundle's origin except calls to clucknorris.app", strangers.length === 0, strangers);
  ok("F · no uncaught exception anywhere in the run", errors.length === 0, errors.join(" | ").slice(0, 400));

  await ctx.close();

  // ---- G: a lesson opened DIRECTLY in Spanish, with the dictionaries held back ---------------
  // Same race as seeker-app-boot-test P9, on THIS bundle: the school is where a store user lands,
  // a reload or a deep link renders the lesson before the dictionary, and it must update itself
  // when the dictionary arrives — including after the readiness hook's old 1.5 s give-up.
  {
    const ES = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", "es.school.json"), "utf8"));
    const CUR = require(path.join(ROOT, "data", "curriculum.store.json"));
    const norm = (x) => String(x || "").replace(/\s+/g, " ").trim();
    const lp = CUR.courses.find((c) => c.id === "lp").lessons
      .map((l) => ({ l, chars: (l.sections || []).reduce((a, s) => a + (s.body || "").length, 0) }))
      .sort((a, b) => b.chars - a.chars)[0].l;
    const sec0 = lp.sections[0];
    const curated = ES[norm(sec0.body)];
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p2 = await ctx2.newPage();
    const errs = [];
    p2.on("pageerror", (e) => errs.push(e.message));
    await p2.addInitScript(() => { try { localStorage.setItem("clkn_lang", "es"); } catch (_) {} });
    await p2.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await p2.route("**/i18n/es*.json", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
    await p2.goto(`${BASE}/index.html#/school/lp/${lp.id}`, { waitUntil: "domcontentloaded" });
    await p2.waitForFunction(() => !!document.querySelector(".seeker-school-section-body"), null, { timeout: 20000 });
    const early = await p2.evaluate(() => ({ dict: !!window.CLKN_I18N, body: (document.querySelector(".seeker-school-section-body") || {}).innerText || "" }));
    ok("G · the store copy of the lesson renders before the dictionary (English first — the race is real)", !early.dict && norm(early.body) === norm(sec0.body), { dict: early.dict, body: early.body.slice(0, 80) });
    ok("G · the store copy of this section HAS a curated Spanish translation (else the next check proves nothing)", !!curated && curated.length > 200);
    await p2.waitForFunction(() => !!window.CLKN_I18N, null, { timeout: 20000 });
    await p2.waitForFunction((want) => { const w = document.querySelector(".seeker-school-section-body"); return !!w && w.innerText.replace(/\s+/g, " ").trim() === want; }, norm(curated), { timeout: 5000 }).catch(() => {});
    const late = await p2.evaluate(() => { const w = document.querySelector(".seeker-school-section-body"); return { body: w ? w.innerText : "", skipped: w ? w.getAttribute("data-i18n-skip") : null }; });
    ok("G · ⚠️ and becomes the curated Spanish on its own once the dictionary lands", norm(late.body) === norm(curated) && late.skipped === "1", { got: late.body.slice(0, 120), skipped: late.skipped });
    ok("G · nothing threw", errs.length === 0, errs.join(" | ").slice(0, 300));
    await ctx2.close();
  }

  await browser.close();
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
