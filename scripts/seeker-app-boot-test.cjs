"use strict";
// The Seeker app, actually booted — the check nothing else in this repo performs.
//
// seeker-build-test.cjs proves the TARBALL is well formed (self-contained, hash-routed, no
// seeker content leaking into the google/ios bundles). It never opens the thing. So an app that
// builds clean and renders a blank screen — the exact class of break the Normie Quest visual gate
// exists for on the game side — would ship green. This boots the SHIPPED artifact (the extracted
// store-edition-seeker tarball, not a dev server) in headless Chromium and drives it.
//
// What it pins, and why each one:
//
//   A. It renders at all, with no console error and no unhandled rejection. The bundle loads four
//      plain <script>s before the module mounts; any one of them failing leaves a blank root.
//   B. The three tabs exist and hash routing moves between them. HashRouter is load-bearing —
//      there is no server inside the Capacitor app to rewrite a deep path (CLKN-SEEKER's
//      DELIVERY-CONTRACT.md), so a BrowserRouter regression bricks every route but "/".
//   C. Connect and disconnect both work, through the real shared registry (public/cluck-wallet.js)
//      driven by a FAKE Wallet Standard wallet — the same harness wallet-standard-test.cjs uses.
//      CLAUDE.md: anywhere a user can connect, they must be able to disconnect.
//   D. ⚠️ THE ONE THAT MATTERS: a FAILED chain read renders "unavailable" and NEVER a zero total.
//      This app's whole job is telling someone how much SOL they can get back. "0 SOL to reclaim"
//      off a 503 is a lie about the user's money, and it is the failure CLAUDE.md names by hand
//      ("RPC outage is unavailable, never a zero balance"). Asserted as a negative too: no zero
//      total may appear anywhere on that screen.
//   E. A good read renders the real numbers: the total, and each account in the right group.
//
// No live RPC and no real signing: /api/seeker/reclaimable is intercepted per test. The bundle
// rewrites its own API calls to absolute https://clucknorris.app/... (store-edition builder), so
// the route pattern matches on the path, not the origin.
const { execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };

const ROOT = path.join(__dirname, "..");
const PORT = 3894;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-seeker-boot-"));

function findChromium() {
  const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return undefined;
}

// A fake Wallet Standard wallet, installed before any page script runs — the same shape
// scripts/wallet-standard-test.cjs uses, trimmed to what this app exercises.
const ADDR = "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh";
const FAKE = `(() => {
  const account = { address: ${JSON.stringify(ADDR)}, publicKey: new Uint8Array(32).fill(7),
    chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
  const wallet = {
    version: "1.0.0", name: "Jupiter", icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:mainnet"], accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...i) => i.map((x) => ({ signedTransaction: x.transaction })) },
    },
  };
  const cb = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
})();`;

// A realistic body for the good-read case: one closable account, one holding tokens, one wrapped
// SOL. Shaped exactly like server.js's /api/seeker/reclaimable success envelope.
const GOOD = {
  success: true, status: "ok", wallet: ADDR,
  accountsExamined: 3, accountsTotal: 3, truncated: false,
  totalReclaimableLamports: 2039280, totalReclaimableSol: 0.00203928,
  accounts: [
    { tokenAccount: "TokAcct1111111111111111111111111111111111111", mint: "MintAAA1111111111111111111111111111111111111", uiAmount: 0, decimals: 6, lamports: 2039280, status: "reclaimable", reason: null },
    { tokenAccount: "TokAcct2222222222222222222222222222222222222", mint: "MintBBB2222222222222222222222222222222222222", uiAmount: 12.5, decimals: 6, lamports: 2039280, status: "holds_balance", reason: "Still holds a token balance — closing it would lose that balance." },
    { tokenAccount: "TokAcct3333333333333333333333333333333333333", mint: "So11111111111111111111111111111111111111112", uiAmount: 0, decimals: 9, lamports: 2039280, status: "refused", reason: "Wrapped SOL — closing it is not offered here." },
  ],
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".jpg": "image/jpeg" };

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("needs playwright(-core)"); process.exit(1); } }

  // 1. Build the artifact that actually ships, and unpack it. Not a dev server: a dev server has
  //    vite's own module graph and a live /api behind it, so it can pass while the bundle fails.
  const out = execFileSync(process.execPath, ["scripts/build-store-edition.mjs", "seeker"], { cwd: ROOT, encoding: "utf8" });
  const line = out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
  const manifest = JSON.parse(line);
  const tgz = path.join(ROOT, "release", manifest.file);
  const app = path.join(TMP, "app");
  fs.mkdirSync(app, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", app, "--strip-components=1"]);
  const entry = fs.existsSync(path.join(app, "index.html"));

  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(app, rel);
    if (!file.startsWith(app) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

  const cleanup = () => {
    try { srv.close(); } catch (_) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(tgz, { force: true }); } catch (_) {}
    try { fs.rmSync(path.join(ROOT, "dist-store-seeker"), { recursive: true, force: true }); } catch (_) {}
  };
  process.on("exit", cleanup);

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });

  // Every page opens as a PHONE. A desktop viewport would hide exactly the layout breaks this
  // app has to survive (the hackathon scores mobile-specific work, and a Seeker is a phone).
  async function open(reclaimable) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];      // uncaught exceptions only — the strict signal
    const offsite = new Set(); // every request that left the bundle's own origin
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) offsite.add(u.split("?")[0]); });
    await page.addInitScript(FAKE);
    // Match on the PATH — the shipped bundle calls the absolute production origin.
    await page.route("**/api/seeker/reclaimable*", (route) => reclaimable(route));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    return { ctx, page, errors, offsite };
  }
  const text = (page) => page.evaluate(() => document.body.innerText);

  console.log("\nSeeker app — the shipped bundle, booted\n");
  ok("the store-edition seeker tarball unpacks to an index.html at its root", entry);

  // ---- A + B + C: shell, routing, wallet -------------------------------------------------
  {
    const { ctx, page, errors, offsite } = await open((r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, status: "unavailable" }) }));
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 }).catch(() => {});
    const mounted = await page.evaluate(() => !!document.querySelector(".seeker-shell") && document.querySelector("#root").children.length > 0);
    ok("A · it mounts — #root is not an empty div", mounted);
    ok("A · the four shared scripts all loaded", await page.evaluate(() => !!(window.CluckUtil && window.CluckWallet && window.CluckRentMath && window.CLKN_I18N)));

    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-navbtn")).map((a) => a.getAttribute("href")));
    ok("B · four bottom-nav tabs, all hash routes", tabs.length === 4 && tabs.every((h) => String(h).startsWith("#/")), JSON.stringify(tabs));
    ok("B · it lands on the Toolkit, not a blank route", /Toolkit/i.test(await text(page)), (await text(page)).slice(0, 160));

    for (const [hash, want] of [["#/ask", /Ask Cluck/i], ["#/checkup", /Wallet Checkup/i], ["#/rent", /Rent Reclaim/i],
                                ["#/tools/listing", /Listing Checkup/i], ["#/tools/bags", /Launches/i],
                                ["#/tools/alpha", /Daily Brief/i], ["#/tools", /Toolkit/i]]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(250);
      ok(`B · ${hash} renders its own pane`, want.test(await text(page)));
    }

    // Every tap target big enough for a thumb. The hackathon's own rule is that a port with
    // little mobile optimisation scores poorly; 44px is the floor this app was built to.
    const small = await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-navbtn, .seeker-walletbtn"))
      .map((el) => ({ t: (el.innerText || "").trim().slice(0, 18), h: Math.round(el.getBoundingClientRect().height) })).filter((x) => x.h < 44));
    ok("B · every nav and wallet control is >= 44px tall on a phone", small.length === 0, JSON.stringify(small));

    // The grid's own honesty rule (ToolsHome.jsx): a tool that is not built yet renders as a
    // dead card, never a link. With fifteen tools landing across several batches, the failure
    // this catches is a `ready` flag flipped ahead of its pane — which routes a judge into a
    // blank screen, the exact thing the flag exists to prevent.
    await page.evaluate(() => { window.location.hash = "#/tools"; });
    await page.waitForTimeout(300);
    const grid = await page.evaluate(() => ({
      cards: document.querySelectorAll(".seeker-toolcard").length,
      links: document.querySelectorAll("a.seeker-toolcard").length,
      soonAreLinks: document.querySelectorAll("a.seeker-toolcard.seeker-toolcard-soon").length,
      smallCards: Array.from(document.querySelectorAll(".seeker-toolcard"))
        .filter((el) => el.getBoundingClientRect().height < 44).length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    ok("B · the toolkit grid renders every tool in the registry", grid.cards >= 15, JSON.stringify(grid));
    ok("B · ⚠️ an unbuilt tool is NEVER a link — no routing to a blank pane", grid.soonAreLinks === 0, JSON.stringify(grid));
    ok("B · built tools are links, so the grid actually navigates", grid.links >= 6, JSON.stringify(grid));
    ok("B · every card clears 44px and nothing overflows at 390px", grid.smallCards === 0 && !grid.overflow, JSON.stringify(grid));

    ok("C · starts disconnected", /Not connected/i.test(await text(page)));
    await page.click(".seeker-walletbtn");
    await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const after = await text(page);
    ok("C · connect goes through the shared registry and shows the address", /Disconnect/i.test(after) && after.includes("6A5u"), after.slice(0, 200));
    await page.click(".seeker-walletbtn");
    await page.waitForTimeout(400);
    ok("C · disconnect clears it again", /Not connected/i.test(await text(page)));

    ok("A · no uncaught exception during any of that", errors.length === 0, errors.join(" | ").slice(0, 400));

    // The bundle is now SELF-CONTAINED for typography. It used to @import Anton + Chakra Petch
    // from Google Fonts through theme.css, which meant the brand type vanished the moment the
    // phone lost signal and a store app phoned a third party on every cold start — found by an
    // earlier version of this very test. scripts/vendor-fonts.mjs vendored all 19 faces into
    // public/vendor/fonts/, so the ONLY thing that may now leave the bundle is our own API.
    //
    // The build refuses a new host too (store-edition's `allowedHosts`, which no longer lists
    // either font domain). This is the RUNTIME half of that pair: build-time config and actual
    // runtime requests have complementary blind spots, which is the point of AGENTS.md's "check
    // every form, not one form". A host that is allow-listed but should not be hit at boot only
    // shows up here.
    const ALLOWED_OFFSITE = ["https://clucknorris.app/api/"];
    const unexpected = [...offsite].filter((u) => !ALLOWED_OFFSITE.some((a) => u.startsWith(a)));
    ok("A · the bundle reaches NOTHING off-device but our own API — no fonts, no CDN, no beacon",
       unexpected.length === 0, JSON.stringify(unexpected));
    ok("A · the brand fonts really loaded, from inside the bundle",
       await page.evaluate(() => document.fonts.check("700 16px 'Chakra Petch'") && document.fonts.check("400 16px 'Anton'")),
       "a face did not load — check vendor/fonts shipped and theme.css points at it");
    await ctx.close();
  }

  // ---- D: a failed read must never read as zero ------------------------------------------
  {
    const { ctx, page } = await open((r) => r.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ success: false, status: "unavailable", error: "Could not read the chain right now — try again shortly." }) }));
    await page.waitForFunction(() => !!document.querySelector(".seeker-walletbtn"), null, { timeout: 20000 });
    await page.evaluate(() => { window.location.hash = "#/rent"; });
    await page.waitForTimeout(300);
    await page.click(".seeker-walletbtn");
    await page.waitForTimeout(1500);
    const t = await text(page);
    ok("D · a 503 renders as unavailable, in an alert", /could not read the chain/i.test(t) && await page.evaluate(() => !!document.querySelector('[role="alert"]')), t.slice(0, 240));
    ok("D · ⚠️ and NOT as a zero total — no '0 SOL' anywhere on a failed read",
       !/\b0(\.0+)?\s*SOL\b/i.test(t) && !/Total reclaimable/i.test(t), t.slice(0, 240));
    ok("D · it offers a retry rather than a dead end", /try again/i.test(t));
    await ctx.close();
  }

  // ---- E: a good read renders the real numbers -------------------------------------------
  {
    const { ctx, page, errors, offsite } = await open((r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GOOD) }));
    await page.waitForFunction(() => !!document.querySelector(".seeker-walletbtn"), null, { timeout: 20000 });
    await page.evaluate(() => { window.location.hash = "#/rent"; });
    await page.waitForTimeout(300);
    await page.click(".seeker-walletbtn");
    await page.waitForFunction(() => /Total reclaimable/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    const t = await text(page);
    ok("E · the total renders from the response, formatted by the shared rent math",
       /Total reclaimable/i.test(t) && t.includes("0.00203928"), t.slice(0, 300));
    ok("E · the closable account is listed as reclaimable", /reclaimable/i.test(t) && /No balance/i.test(t), t.slice(0, 300));
    ok("E · an account holding tokens is shown as kept, not closable", /Holds a balance/i.test(t) && /won't be closed/i.test(t));
    ok("E · wrapped SOL is shown as refused, with the reason", /Refused/i.test(t) && /Wrapped SOL/i.test(t));
    ok("E · no uncaught exception rendering a real result", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  await browser.close();
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
