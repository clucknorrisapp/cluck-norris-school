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
const web3 = require("@solana/web3.js");
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
  async function open(reclaimable, extraRoutes, fakeScript) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];      // uncaught exceptions only — the strict signal
    const offsite = new Set(); // every request that left the bundle's own origin
    const calls = [];       // every /api path the bundle actually requested, in order
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("request", (r) => {
      const u = r.url();
      const i = u.indexOf("/api/");
      if (i >= 0) calls.push(u.slice(i).split("?")[0]);
      if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) offsite.add(u.split("?")[0]);
    });
    await page.addInitScript(fakeScript || FAKE);
    // Match on the PATH — the shipped bundle calls the absolute production origin.
    await page.route("**/api/seeker/reclaimable*", (route) => reclaimable(route));
    if (extraRoutes) await extraRoutes(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    return { ctx, page, errors, offsite, calls };
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

    // ⚠️ AND NOTHING IS SITTING ON TOP OF THEM. The size check above passed while the shared
    // language pill (public/i18n.js injects it fixed at bottom-right, z-index 2147483600) covered
    // the FOURTH nav tab on every screen of the app — Wallet Checkup was untappable, and nothing
    // caught it: the tab was the right size, it mounted, its route worked. It was visible only in
    // a screenshot. A tap target can be exactly 44px and still be unreachable, so this asks the
    // browser the question a thumb asks: what is actually at that point?
    const covered = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".seeker-navbtn, .seeker-walletbtn")) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) {
          out.push({ t: (el.innerText || "").trim().slice(0, 14), by: hit ? (hit.id || hit.className || hit.tagName) : "nothing" });
        }
      }
      return out;
    });
    ok("B · ⚠️ and nothing is covering them — the thumb reaches the control, not an overlay",
       covered.length === 0, JSON.stringify(covered));

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

    // EVERY built tool must actually mount. Driven from the rendered grid's own hrefs rather
    // than a list in this file: a list would have to be remembered, and the failure it is meant
    // to catch — a `ready` flag flipped ahead of a pane that throws on mount — arrives precisely
    // when someone forgets. The Hatchery reached this test having never been rendered in a
    // browser by anyone, which is exactly the gap.
    {
      // ⚠️ NOTHING IN THIS LOOP MAY REACH PRODUCTION. Every pane fetches on mount, and the first
      // version of this loop stubbed only /api/seeker/reclaimable — so CI navigated to fifteen
      // tools and hit the LIVE api for the rest, which is both flaky and rude, and which is how
      // the off-device assertion below started failing on real ipfs.io URLs served by the live
      // launches feed. A test that reaches the internet is not testing the bundle.
      await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, status: "unavailable" }) }));
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("a.seeker-toolcard")).map((a) => a.getAttribute("href")));
      const dead = [];
      for (const href of links) {
        const before = errors.length;
        await page.evaluate((h) => { window.location.hash = String(h).replace(/^#/, ""); }, href);
        await page.waitForTimeout(350);
        const body = await page.evaluate(() => ({
          // Three pane roots, because three surfaces predate the shared Pane wrapper and none of
          // them is wrong: .seeker-tool is Pane (every tool built since), .seeker-ask is Ask
          // Cluck (a chat surface, not a form-and-result pane), .seeker-pane is the original
          // two bottom-nav panes. Listing all three rather than loosening to "something
          // rendered" keeps the assertion about MOUNTING, not about the body having text in it.
          pane: !!document.querySelector(".seeker-tool, .seeker-ask, .seeker-pane"),
          len: (document.body.innerText || "").trim().length,
        }));
        if (!body.pane || body.len < 80 || errors.length > before) dead.push(`${href} (pane=${body.pane} len=${body.len} threw=${errors.length > before})`);
      }
      ok(`B · every built tool in the grid actually mounts (${links.length} of them)`, dead.length === 0, dead.join(" | "));
      await page.unroute("**/api/**");
      await page.evaluate(() => { window.location.hash = "#/tools"; });
      await page.waitForTimeout(250);
    }

    // ⚠️ A PANE THAT ASKS FOR A WALLET MUST OFFER ONE. Rent Reclaim — the second bottom-nav tab,
    // and the free tool that literally hands people money back — showed a title and the sentence
    // "Connect your wallet to scan for reclaimable rent." and nothing else. The only way forward
    // was to notice the small button in the header. Wallet Checkup had the same gap. Both use the
    // shared NeedsWallet now, which offers the button, or says plainly that the device has no
    // wallet app rather than offering one that cannot work. This asserts the rule for every tool
    // at once, so the next pane to be written cannot quietly reintroduce the dead end.
    {
      const deadEnds = [];
      await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, status: "unavailable" }) }));
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("a.seeker-toolcard")).map((a) => a.getAttribute("href")));
      for (const href of ["#/rent", "#/checkup", ...links]) {
        await page.evaluate((h) => { window.location.hash = String(h).replace(/^#/, ""); }, href);
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const body = document.body.innerText || "";
          // Only the PANE, never the shell — the header's own wallet button is not an answer.
          const pane = document.querySelector(".seeker-tool, .seeker-pane, .seeker-ask");
          const asks = /connect (your |the )?wallet/i.test(pane ? (pane.innerText || "") : "");
          const offers = !!(pane && (pane.querySelector("button, a[href]") || /no wallet app was found/i.test(pane.innerText || "")));
          return { asks, offers, body: body.slice(0, 60) };
        });
        if (r.asks && !r.offers) deadEnds.push(href);
      }
      ok("B · ⚠️ no pane asks for a wallet without offering a way to connect one", deadEnds.length === 0, deadEnds.join(", "));
      await page.unroute("**/api/**");
      await page.evaluate(() => { window.location.hash = "#/tools"; });
      await page.waitForTimeout(250);
    }

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
    // P1-C (adversarial review, 2026-09-21): renamed from "No balance — safe to close." — never
    // call a token "safe" or "verified" (spec / SEEKER_TOOLS_BUILD.md §3.3), and it was untrue
    // too (a Token-2022 account with withheld transfer fees can read zero and not be closable).
    ok("E · the closable account is listed as reclaimable", /reclaimable/i.test(t) && /No token balance/i.test(t), t.slice(0, 300));
    // P1-C mutation guard: the rendered pane text must never claim a token is "safe" or
    // "verified" — the exact vocabulary the spec forbids.
    ok("E · the rendered pane never calls a token \"safe\" or \"verified\"", !/\bsafe\b|\bverified\b/i.test(t), t.slice(0, 300));
    // P2-G (adversarial review, 2026-09-21): the row now shows the SERVER's own per-account
    // reason (GOOD fixture's own text) rather than a hardcoded client string that used to discard
    // it — "closing it would lose that balance" is that server text, not a client re-derivation.
    ok("E · an account holding tokens is shown as kept, not closable, with the SERVER's own reason", /Holds a balance/i.test(t) && /would lose that balance/i.test(t));
    ok("E · wrapped SOL is shown as refused, with the reason", /Refused/i.test(t) && /Wrapped SOL/i.test(t));
    ok("E · no uncaught exception rendering a real result", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  // ---- F: the tools pass is actually ENFORCED in the shipped bundle ----------------------
  //
  // ⚠️ THIS SECTION EXISTS BECAUSE THE PASS WAS UNENFORCEABLE AND EVERYTHING ELSE WAS GREEN.
  // src/seeker/pass.js reads window.CluckGate, which public/cluck-gate.js installs. That file
  // was never listed in seeker.html's <script> tags or in store-edition/seeker-edition.json's
  // `files`, so in the SHIPPED tarball window.CluckGate did not exist, usePass() took its
  // documented fail-open branch ("off"), and every pass-tier pane ran ungated. Nothing caught
  // it: the source builds, the panes render, the tarball verifies, and fail-open is correct
  // behaviour for a real outage — it is only wrong when the client was never shipped at all.
  //
  // So the assertion is deliberately made against the BUNDLE, not the source: the file is
  // present, the global exists, and — the part that actually matters — a RUN with no pass
  // opens the gate instead of calling the gated API. The last one is a negative assertion over
  // observed network calls, which is the only form that distinguishes "gated" from "fails open".
  {
    const CFG = { success: true, enabled: true, holdUsd: 50, clknNeeded: 1234567, lamports: 50000000, days: 7 };
    const { ctx, page, errors, calls } = await open(
      (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GOOD) }),
      async (pg) => {
        await pg.route("**/api/tool-gate/config*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CFG) }));
        // If the pane ever called a gated endpoint without a pass, this would answer 200 and the
        // tool would render a result — so the failure shows up as data on screen, not just a count.
        for (const p of ["wallet-xray", "snapshot", "trace"]) {
          await pg.route(`**/api/${p}*`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, wallet: ADDR, labels: [], transactions: [], holders: [], hops: [] }) }));
        }
      });
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });

    ok("F · public/cluck-gate.js is IN the shipped bundle", fs.existsSync(path.join(app, "cluck-gate.js")),
       "cluck-gate.js missing from the tarball — add it to seeker-edition.json's files");
    ok("F · window.CluckGate exists at runtime, so the pass client is really loaded",
       await page.evaluate(() => !!(window.CluckGate && typeof window.CluckGate.config === "function" && typeof window.CluckGate.proof === "function" && typeof window.CluckGate.fetch === "function")),
       "the <script src=\"/cluck-gate.js\"> tag is missing from seeker.html, or the file failed to parse");

    // The three pass-tier panes, each driven the way a person would: type an address, hit RUN.
    const CLKN = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    for (const [hash, runSel, fills] of [
      ["#/tools/xray", ".seeker-listing-runbtn", [ADDR]],
      ["#/tools/holders", ".seeker-listing-runbtn", [CLKN]],
      ["#/tools/trace", ".seeker-listing-runbtn", [ADDR, CLKN]],   // two fields: wallet AND mint
    ]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(400);
      const before = calls.length;
      // ⚠️ EVERY field, not just the first. Trace takes a wallet AND a mint, and a half-filled
      // form fails validation BEFORE the pass is ever consulted — so "the gated API was not
      // called" would have been true for the wrong reason and the check would have proved
      // nothing (AGENTS.md: a probe that produces no output is not a pass). The form-valid
      // assertion below is what keeps this honest: if validation stopped the run, the pass
      // sheet is absent and the section fails.
      const inputs = await page.$$(".seeker-listing-input");
      for (let i = 0; i < fills.length && i < inputs.length; i++) await inputs[i].fill(fills[i]);
      const btn = await page.$(runSel);
      if (btn) await btn.click();
      await page.waitForTimeout(900);
      const gated = calls.slice(before).filter((u) => /\/api\/(wallet-xray|snapshot|trace)\b/.test(u));
      const body = await text(page);
      ok(`F · ${hash} — the form was VALID, so the run really reached the gate`,
         !/Enter a valid/i.test(body), body.slice(0, 200));
      ok(`F · ${hash} — RUN with no pass NEVER calls the gated API`, gated.length === 0, JSON.stringify(gated));
      ok(`F · ${hash} — it opens the pass sheet instead, with the LIVE terms`,
         /Unlock the tools pass/i.test(body) && body.includes("1,234,567"), body.slice(0, 400));
      // Never a hardcoded amount: the numbers on screen came from CFG, so changing the server's
      // figure changes the sheet. Pinning the literal above is what makes that true, not assumed.
      const close = await page.$(".seeker-confirm-actions .seeker-btn-quiet");
      if (close) await close.click();
      await page.waitForTimeout(200);
    }
    ok("F · no uncaught exception driving the pass tier", errors.length === 0, errors.join(" | ").slice(0, 400));
    await ctx.close();
  }

  // ---- G: the Airdropper — three outcomes, kept apart -------------------------------------
  //
  // ⚠️ THE MOST CONSEQUENTIAL SCREEN IN THIS APP. It moves someone else's money out of the
  // user's wallet in bulk, and the way it goes wrong is not a crash: it is a batch reported as
  // "sent" that was not. A batch has THREE outcomes and collapsing any two of them is a
  // specific lie to the operator —
  //     sent        confirmed on-chain.
  //     failed      landed and failed, or never went. Nobody was paid. Retry it.
  //     unconfirmed submitted, no status after 30s. It MAY still land. Called "sent", unpaid
  //                 people look paid; called "failed", the operator resends and DOUBLE-PAYS.
  // The engine (public/airdrop-engine.js) distinguishes all three and its own comment records
  // the day it did not. This drives the SHIPPED bundle through one real run of all three, with
  // a fake wallet and a fake chain, and checks what the screen actually says.
  //
  // Slow on purpose: the unconfirmed case is a real 30-second poll, because shortening it would
  // mean testing something other than the code that ships.
  {
    // A pass already held, written the way cluck-gate.js writes it — this section is about the
    // send, not the gate (section F owns that), and a gate sheet in the way would prove nothing.
    const PASS = { unlockedAt: 1, expiresAt: 4102444800000, why: "holder", proof: "t:faketoken" };
    const SIG_OK = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCFFzVkbqDHHcgkTMZLFBgrPtrTKJqXNJ2kFfPjRnLXGRCGXBLjF";
    const SIG_BAD = "3nVfYQMJMyXjWJvUXkTWSLZfqNqTtjqKRy1vFgvvfsnFvyqMdSHJzqKLXaTVmcXyJDsBaMvVnKkYaWQxjqRLbNnG";
    const SIG_SILENT = "4hXTJHFoFvPZs1e4z1Q1vMWgkgi3zVJMhVQcHX7FmKjzKPPRcy6HmQ9cQ4B8dkcbSmvKJgVRC1L3H7gK2vNrWqMT";
    const sigs = [SIG_OK, SIG_BAD, SIG_SILENT];
    // ⚠️ A REAL key here too. "SenderTokAcct111…" matched the eye but not ed25519, and every row
    // came back "Invalid public key input" — the same broken-fixture failure as the recipients,
    // one layer down, and it looked identical to a real regression in the pane.
    const SENDER_TOKEN_ACCOUNT = web3.Keypair.generate().publicKey.toBase58();

    // ⚠️ A wallet that REALLY SIGNS. The shell's fake (FAKE, above) hands back the unsigned bytes
    // it was given, which is fine for "does connect work" but not here: cluck-wallet.js's
    // sign-only path calls .serialize() on what comes back, and an unsigned transaction throws
    // "Missing signature for public key" — 34 rows failed for that reason alone and the
    // three-outcome assertions were, again, measuring the fixture. Sections C/D/E keep the simple
    // fake and its fixed address; this one carries its own keypair.
    const SIGNER = web3.Keypair.generate();
    const SIGNER_ADDR = SIGNER.publicKey.toBase58();
    const FAKE_SIGNING = `(() => {
      const SECRET = ${JSON.stringify(Array.from(SIGNER.secretKey))};
      const account = { address: ${JSON.stringify(SIGNER.publicKey.toBase58())}, publicKey: new Uint8Array(32).fill(7),
        chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
      const wallet = {
        version: "1.0.0", name: "Jupiter", icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:mainnet"], accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) => inputs.map((x) => {
              const tx = solanaWeb3.Transaction.from(x.transaction);
              tx.sign(solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(SECRET)));
              return { signedTransaction: tx.serialize() };
            }) },
        },
      };
      const cb = ({ register }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
    })();`;
    let sendCount = 0;
    const recorded = [];

    const { ctx, page, errors } = await open(
      (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GOOD) }),
      async (pg) => {
        await pg.addInitScript((p) => { try { localStorage.setItem("clkn_tools_unlock", JSON.stringify(p)); } catch (_) {} }, PASS);
        await pg.route("**/api/tool-gate/config*", (r) => r.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ success: true, enabled: true, holdUsd: 50, clknNeeded: 1000, lamports: 50000000, days: 7 }) }));
        await pg.route("**/api/airdrop/record*", async (r) => {
          try { recorded.push(JSON.parse(r.request().postData() || "{}")); } catch (_) {}
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, dropId: "testdrop", url: "/airdrop/r/testdrop" }) });
        });
        // A fake chain. Three batches: the first confirms, the second lands and FAILS, the third
        // never answers at all (the engine's 30s poll runs out — the ambiguous case).
        await pg.route("**/api/helius-rpc", async (r) => {
          const body = JSON.parse(r.request().postData() || "{}");
          const m = body.method;
          let result;
          if (m === "getTokenAccountsByOwner") {
            result = { value: [{ pubkey: SENDER_TOKEN_ACCOUNT,
              account: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                data: { parsed: { info: { tokenAmount: { decimals: 6 } } } } } }] };
          } else if (m === "getMultipleAccounts") {
            // Everyone already holds the token: no ATA rent, weight 1 each, so the batch
            // boundaries are the plain ones the cost preview showed.
            result = { value: (body.params[0] || []).map(() => ({ lamports: 1 })) };
          } else if (m === "getMinimumBalanceForRentExemption") { result = 2039280; }
          else if (m === "getBalance") { result = { value: 1000000000 }; }
          else if (m === "getLatestBlockhash") { result = { value: { blockhash: "11111111111111111111111111111111" } }; }
          else if (m === "sendTransaction") { result = sigs[Math.min(sendCount++, sigs.length - 1)]; }
          else if (m === "getSignatureStatuses") {
            const sig = (body.params[0] || [])[0];
            if (sig === SIG_OK) result = { value: [{ err: null, confirmationStatus: "confirmed" }] };
            // ⚠️ BOTH fields set. This is the shape that made "confirmed" read as success for a
            // transaction that FAILED — the P0 this repo shipped twice. err must win.
            else if (sig === SIG_BAD) result = { value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] };
            else result = { value: [null] };   // never answers — the 30s timeout
          } else { result = null; }
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
        });
      }, FAKE_SIGNING);
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
    await page.evaluate(() => { window.location.hash = "#/tools/airdrop"; });
    await page.waitForTimeout(400);

    ok("G · the airdrop engine and the plan module are both in the bundle",
       await page.evaluate(() => !!(window.CluckAirdrop && window.CluckAirdrop.send && window.CluckAirdropPlan && window.CluckAirdropPlan.parseRecipients)),
       "airdrop-engine.js / airdrop-plan.js did not load — check seeker.html and seeker-edition.json");

    await page.click(".seeker-walletbtn");
    await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 });

    // 34 recipients at weight 1 = three batches at the engine's budget of 16. One per outcome.
    // ⚠️ REAL keypairs, not strings that merely match the base58 shape. The first version of this
    // synthesized addresses by editing one character of a known key: they passed the pane's
    // ADDR_RE and then every single one failed inside the engine with "Invalid public key input",
    // so the run produced 34 failures and the three-outcome assertions were measuring a broken
    // fixture rather than the thing under test. A probe that fails for its own reasons proves
    // nothing about the code.
    const R = Array.from({ length: 34 }, () => web3.Keypair.generate().publicKey.toBase58());
    await page.fill("#drop-mint", "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS");
    await page.fill("#drop-list", R.join("\n"));
    await page.fill("#drop-amt", "1.5");
    await page.click(".seeker-listing-runbtn");
    await page.waitForFunction(() => /Transactions to sign|Could not read the network cost/i.test(document.body.innerText), null, { timeout: 20000 });

    const review = await text(page);
    ok("G · the review shows the transaction count the ENGINE will actually produce",
       /Transactions to sign[\s\S]{0,40}\b3\b/i.test(review), review.slice(0, 600));
    ok("G · and the network cost, before anything is signed", /Network cost/i.test(review) && /SOL/.test(review));
    ok("G · the total is computed from the list, not typed by hand", /\b51\b/.test(review), review.slice(0, 600));

    await page.click(".seeker-drop-send");
    await page.waitForFunction(() => /Send this drop\?/i.test(document.body.innerText), null, { timeout: 10000 });
    const confirm = await text(page);
    ok("G · the confirmation names the amount, the wallet count and that it cannot be undone",
       /51/.test(confirm) && /34/.test(confirm) && /cannot be reversed/i.test(confirm), confirm.slice(0, 500));

    await page.click(".seeker-confirm .seeker-btn:not(.seeker-btn-quiet)");
    // Three batches; the third burns the engine's full 30s poll. Generous, then assert.
    await page.waitForFunction(() => /Start another drop/i.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
    const done = await text(page);

    ok("G · the run finishes and reports", /Start another drop/i.test(done), done.slice(0, 400));
    // The whole point. Sixteen paid, sixteen not, two ambiguous — and nothing rounded together.
    const counts = await page.evaluate(() => ({
      sent: document.querySelectorAll(".seeker-drop-row-sent").length,
      failed: document.querySelectorAll(".seeker-drop-row-failed").length,
      unconfirmed: document.querySelectorAll(".seeker-drop-row-unconfirmed").length,
    }));
    ok("G · ⚠️ the batch that CONFIRMED is the only one reported sent", counts.sent === 16, JSON.stringify(counts));
    ok("G · ⚠️ the batch that landed and FAILED is reported failed, not sent — err beats confirmationStatus",
       counts.failed === 16, JSON.stringify(counts));
    ok("G · ⚠️ the batch with no status is UNCONFIRMED — not sent, and not failed",
       counts.unconfirmed === 2, JSON.stringify(counts));
    ok("G · the unconfirmed rows get their own warning, naming the double-pay risk",
       /unconfirmed/i.test(done) && /twice/i.test(done), done.slice(0, 900));
    ok("G · every row carries a signature to check", await page.evaluate(() =>
       document.querySelectorAll('a[href^="https://solscan.io/tx/"]').length >= 3));

    // ⚠️ Only CONFIRMED rows may reach the public receipt. An unconfirmed row has no on-chain
    // truth yet and a failed one has none at all — publishing either is a claim the chain does
    // not support, which is the one thing the receipt exists to avoid.
    const rows = recorded.flatMap((b) => b.rows || []);
    ok("G · ⚠️ the public receipt records ONLY the confirmed rows", rows.length === 16, `recorded ${rows.length}`);
    ok("G · and only with the confirming signature", rows.length > 0 && rows.every((r) => r.sig === SIG_OK));
    ok("G · the receipt link is offered once it exists", /Public receipt/i.test(done));
    ok("G · no uncaught exception through the whole send", errors.length === 0, errors.join(" | ").slice(0, 400));
    await ctx.close();
  }

  // ---- H: the Locker Room — two signers, in the order that matters ------------------------
  //
  // The flagship tool, and the only transaction in this app with a SECOND signer. CLAUDE.md
  // states the rule by name: the CONNECTED WALLET SIGNS FIRST, then extra signers; pre-signing
  // server-side, or reaching for signAndSendTransaction when a non-wallet signer exists, is what
  // makes Phantom warn "this transaction may be malicious". A rule stated in a comment is not a
  // rule, so this section takes the bytes the app actually submits, deserializes them, and reads
  // the signatures back out.
  //
  // The transaction is a stand-in, not a real Jupiter Lock instruction: a memo whose one account
  // is the ephemeral base key as a required signer, fee-paid by the wallet. What is under test is
  // the pane's signing ORDER and its four outcomes, not the lock program — /api/lock/create-tx
  // builds and mainnet-simulates the real one server-side, and this test replaces that endpoint.
  {
    const MEMO = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    const SIG_OK = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCFFzVkbqDHHcgkTMZLFBgrPtrTKJqXNJ2kFfPjRnLXGRCGXBLjF";

    // Four runs, one per outcome. Each gets a fresh page so state can't leak between them.
    for (const [label, statusResult, wantText, wantNoText] of [
      ["sent", { err: null, confirmationStatus: "confirmed" }, /Locked\./i, null],
      ["failed on-chain", { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }, /did not go through/i, /Locked\./i],
      ["unconfirmed", null, /not confirmed/i, /Locked\./i],
    ]) {
      const SIGNER = web3.Keypair.generate();
      const BASE = web3.Keypair.generate();
      const recorded = [];
      let submitted = null;
      const FAKE_SIGNING = `(() => {
        const SECRET = ${JSON.stringify(Array.from(SIGNER.secretKey))};
        const account = { address: ${JSON.stringify(SIGNER.publicKey.toBase58())}, publicKey: new Uint8Array(32).fill(7),
          chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
        const wallet = {
          version: "1.0.0", name: "Jupiter", icon: "data:image/svg+xml;base64,PHN2Zy8+",
          chains: ["solana:mainnet"], accounts: [],
          features: {
            "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
            "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
              signTransaction: async (...inputs) => inputs.map((x) => {
                const tx = solanaWeb3.Transaction.from(x.transaction);
                tx.partialSign(solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(SECRET)));
                return { signedTransaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }) };
              }) },
          },
        };
        const cb = ({ register }) => register(wallet);
        window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
      })();`;

      const unsigned = new web3.Transaction({ feePayer: SIGNER.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() })
        .add(new web3.TransactionInstruction({ keys: [{ pubkey: BASE.publicKey, isSigner: true, isWritable: true }], programId: MEMO, data: Buffer.from("clucknorris") }));
      const CREATE = {
        ok: true,
        txBase64: unsigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        baseSecret: Buffer.from(BASE.secretKey).toString("base64"),
        escrow: web3.Keypair.generate().publicKey.toBase58(), escrowToken: web3.Keypair.generate().publicKey.toBase58(),
        decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        schedule: { totalRaw: "1000000000", cliffRaw: "1000000000", perPeriodRaw: "0", periods: 0, freqSec: 2592000, cliffTime: 1790000000 },
        simError: null, tokenSymbol: "CLKN",
      };

      const { ctx, page, errors } = await open(
        (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GOOD) }),
        async (pg) => {
          await pg.route("**/api/lock/create-tx*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CREATE) }));
          await pg.route("**/api/lock/record*", (r) => { recorded.push(1); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
          await pg.route("**/api/locks*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, mint: MINT, decimals: 6, supply: 1e9, totalLocked: 0, pctOfSupply: 0, lockCount: 0, breakdown: [], topLocks: [] }) }));
          await pg.route("**/api/helius-rpc", async (r) => {
            const body = JSON.parse(r.request().postData() || "{}");
            let result = null;
            if (body.method === "sendTransaction") { submitted = body.params[0]; result = SIG_OK; }
            else if (body.method === "getSignatureStatuses") { result = { value: [statusResult] }; }
            else if (body.method === "getLatestBlockhash") { result = { value: { blockhash: "11111111111111111111111111111111" } }; }
            r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
          });
        }, FAKE_SIGNING);

      await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
      // Connect from the shell FIRST, then navigate. The Locker Room's create tab renders its own
      // NeedsWallet connect button when disconnected, so clicking ".seeker-walletbtn" on that
      // screen is ambiguous — the header control is the one that drives the shared registry.
      await page.waitForTimeout(400);
      await page.click(".seeker-walletbtn");
      const connected = await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
      if (!connected) {
        ok(`H · ${label} — the fake wallet connects`, false,
           JSON.stringify(await page.evaluate(() => ({ wallets: (window.CluckWallet && window.CluckWallet.available() || []).map((w) => w.name), err: (document.querySelector(".seeker-walleterr") || {}).innerText || null, btn: (document.querySelector(".seeker-walletbtn") || {}).innerText }))));
        await ctx.close();
        continue;
      }
      await page.evaluate(() => { window.location.hash = "#/tools/lock"; });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".seeker-launch-tabbtn")).find((x) => /create/i.test(x.innerText)); b && b.click(); });
      await page.waitForTimeout(300);
      await page.fill("#lr-c-mint", MINT);
      await page.fill("#lr-c-amount", "1000");
      await page.click(".seeker-listing-runbtn");
      await page.waitForFunction(() => /Lock tokens/i.test(document.body.innerText), null, { timeout: 20000 });
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /^lock tokens$/i.test(x.innerText.trim())); b && b.click(); });
      await page.waitForFunction(() => /Confirm lock/i.test(document.body.innerText), null, { timeout: 10000 });
      await page.click(".seeker-confirm .seeker-btn:not(.seeker-btn-quiet)");
      await page.waitForFunction(() => /Locked\.|did not go through|not confirmed/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
      const body = await text(page);

      if (label === "sent") {
        // ⚠️ THE ASSERTION THIS SECTION EXISTS FOR. Read the bytes the app actually submitted.
        ok("H · the submitted transaction really carries BOTH signatures", (() => {
          if (!submitted) return false;
          const tx = web3.Transaction.from(Buffer.from(submitted, "base64"));
          return tx.signatures.length === 2 && tx.signatures.every((s) => !!s.signature) && tx.verifySignatures();
        })(), submitted ? "submitted, but the signatures did not verify" : "nothing was submitted");
        ok("H · and the CONNECTED WALLET signed FIRST, the escrow key second", (() => {
          if (!submitted) return false;
          const tx = web3.Transaction.from(Buffer.from(submitted, "base64"));
          // signatures[] is ordered by the compiled message's signer list, and the fee payer is
          // always index 0 — so "the wallet is the fee payer and index 0" IS the order rule.
          return tx.signatures[0].publicKey.toBase58() === SIGNER.publicKey.toBase58()
              && tx.signatures[1].publicKey.toBase58() === BASE.publicKey.toBase58();
        })());
      }
      ok(`H · ${label} — the screen says so`, wantText.test(body), body.slice(0, 400));
      if (wantNoText) ok(`H · ${label} — and never claims the lock succeeded`, !wantNoText.test(body), body.slice(0, 400));
      // ⚠️ Only a CONFIRMED lock may enter the public "made right here" feed.
      ok(`H · ${label} — the public feed is told ${label === "sent" ? "once" : "nothing"}`,
         recorded.length === (label === "sent" ? 1 : 0), `recorded ${recorded.length}`);
      if (label === "unconfirmed") {
        // ⚠️ NO RETRY on the ambiguous outcome: the lock may already exist, and locking again
        // would commit the tokens twice with no way back.
        ok("H · ⚠️ unconfirmed offers NO way to lock again", await page.evaluate(() =>
          !Array.from(document.querySelectorAll("button")).some((b) => /^lock tokens$/i.test(b.innerText.trim()))));
      }
      ok(`H · ${label} — no uncaught exception`, errors.length === 0, errors.join(" | ").slice(0, 300));
      await ctx.close();
    }
  }

  // ---- J: a submit that THREW is not proof that nothing landed ----------------------------
  //
  // ⚠️ THE P0 TWO INDEPENDENT REVIEWS FOUND SEPARATELY. `CluckUtil.rpc` throws in two situations
  // that mean opposite things on a send: the node answered with a JSON-RPC error (it refused the
  // transaction — nothing landed), or the request never completed (a dropped mobile connection,
  // a 502 from the edge — the transaction may be on chain right now). Collapsing them into one
  // "failed" told people "Nothing was burned" / "your tokens are where they were" and put a
  // retry button under it, which burns, closes or locks the same tokens a second time.
  //
  // Driven through the Locker Room because it is the app's most irreversible single transaction.
  // Both branches are asserted: a transport throw must NOT read as failure, and a node refusal
  // must, because retrying that one is safe and correct.
  {
    const MEMO = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    for (const [label, sendFails, wantUnconfirmed] of [
      ["transport failure (connection dropped)", "transport", true],
      ["the node refused it (JSON-RPC error)", "rpc", false],
    ]) {
      const SIGNER = web3.Keypair.generate();
      const BASE = web3.Keypair.generate();
      let recorded = 0;
      const FAKE_SIGNING = `(() => {
        const SECRET = ${JSON.stringify(Array.from(SIGNER.secretKey))};
        const account = { address: ${JSON.stringify(SIGNER.publicKey.toBase58())}, publicKey: new Uint8Array(32).fill(7),
          chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
        const wallet = {
          version: "1.0.0", name: "Jupiter", icon: "data:image/svg+xml;base64,PHN2Zy8+",
          chains: ["solana:mainnet"], accounts: [],
          features: {
            "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
            "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
              signTransaction: async (...inputs) => inputs.map((x) => {
                const tx = solanaWeb3.Transaction.from(x.transaction);
                tx.partialSign(solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(SECRET)));
                return { signedTransaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }) };
              }) },
          },
        };
        const cb = ({ register }) => register(wallet);
        window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
      })();`;
      const unsigned = new web3.Transaction({ feePayer: SIGNER.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() })
        .add(new web3.TransactionInstruction({ keys: [{ pubkey: BASE.publicKey, isSigner: true, isWritable: true }], programId: MEMO, data: Buffer.from("clucknorris") }));
      const CREATE = {
        ok: true,
        txBase64: unsigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        baseSecret: Buffer.from(BASE.secretKey).toString("base64"),
        escrow: web3.Keypair.generate().publicKey.toBase58(), escrowToken: web3.Keypair.generate().publicKey.toBase58(),
        decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        schedule: { totalRaw: "1000000000", cliffRaw: "1000000000", perPeriodRaw: "0", periods: 0, freqSec: 2592000, cliffTime: 1790000000 },
        simError: null, tokenSymbol: "CLKN",
      };

      const { ctx, page, errors } = await open(
        (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GOOD) }),
        async (pg) => {
          await pg.route("**/api/lock/create-tx*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CREATE) }));
          await pg.route("**/api/lock/record*", (r) => { recorded++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
          await pg.route("**/api/locks*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, mint: MINT, decimals: 6, supply: 1e9, totalLocked: 0, pctOfSupply: 0, lockCount: 0, breakdown: [], topLocks: [] }) }));
          await pg.route("**/api/helius-rpc", async (r) => {
            const body = JSON.parse(r.request().postData() || "{}");
            if (body.method === "sendTransaction") {
              // "transport": the edge answers with an HTML error page, so r.json() throws inside
              // CluckUtil.rpc and nothing tags the error — exactly a 502/524 on a phone.
              // "rpc": a well-formed JSON-RPC error, which is the node saying it refused it.
              if (sendFails === "transport") return r.fulfill({ status: 502, contentType: "text/html", body: "<html>bad gateway</html>" });
              return r.fulfill({ status: 200, contentType: "application/json",
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Transaction simulation failed: Blockhash not found" } }) });
            }
            let result = null;
            if (body.method === "getSignatureStatuses") result = { value: [null] };   // never resolves
            else if (body.method === "getLatestBlockhash") result = { value: { blockhash: "11111111111111111111111111111111" } };
            r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
          });
        }, FAKE_SIGNING);

      await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
      await page.waitForTimeout(400);
      await page.click(".seeker-walletbtn");
      await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 });
      await page.evaluate(() => { window.location.hash = "#/tools/lock"; });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".seeker-launch-tabbtn")).find((x) => /create/i.test(x.innerText)); b && b.click(); });
      await page.waitForTimeout(300);
      await page.fill("#lr-c-mint", MINT);
      await page.fill("#lr-c-amount", "1000");
      await page.click(".seeker-listing-runbtn");
      await page.waitForFunction(() => /Lock tokens/i.test(document.body.innerText), null, { timeout: 20000 });
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /^lock tokens$/i.test(x.innerText.trim())); b && b.click(); });
      await page.waitForFunction(() => /Confirm lock|Confirmar|确认|Xác nhận/i.test(document.body.innerText), null, { timeout: 10000 });
      await page.click(".seeker-confirm .seeker-btn:not(.seeker-btn-quiet)");
      await page.waitForFunction(() => /did not go through|not confirmed/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
      const body = await text(page);

      if (wantUnconfirmed) {
        ok(`J · ⚠️ ${label} — reported UNCONFIRMED, never "nothing was locked"`,
           /not confirmed/i.test(body) && !/did not go through/i.test(body) && !/tokens are where they were/i.test(body), body.slice(0, 400));
        ok(`J · ${label} — and it hands over the signature to check`,
           await page.evaluate(() => !!document.querySelector('a[href^="https://solscan.io/tx/"]')));
        // ⚠️ The whole point: no second lock from a screen that cannot know the first one failed.
        ok(`J · ⚠️ ${label} — offers NO way to lock again`, await page.evaluate(() =>
          !Array.from(document.querySelectorAll("button")).some((b) => /^lock tokens$/i.test(b.innerText.trim()))));
      } else {
        ok(`J · ${label} — reported FAILED, because the node said it refused it`,
           /did not go through/i.test(body) && !/not confirmed/i.test(body), body.slice(0, 400));
        // Retrying a node refusal is correct — nothing landed and nothing was charged.
        ok(`J · ${label} — and retrying IS offered, because nothing landed`, await page.evaluate(() =>
          Array.from(document.querySelectorAll("button")).some((b) => /^lock tokens$/i.test(b.innerText.trim()))));
      }
      ok(`J · ${label} — the public feed is told nothing either way`, recorded === 0, `recorded ${recorded}`);
      ok(`J · ${label} — no uncaught exception`, errors.length === 0, errors.join(" | ").slice(0, 300));
      await ctx.close();
    }
  }

  // ---- K: the amount someone typed is the amount that gets locked ------------------------
  //
  // Adversarial review P2-8, 2026-09-21. The Locker Room read its amount with parseFloat, which
  // does not fail — it truncates and moves on:
  //
  //     parseFloat("1,234.56")  === 1        parseFloat("1 000 000") === 1
  //     parseFloat("1.234,56")  === 1.234
  //
  // No error, no warning, and the result is a lock this pane's own copy describes as impossible
  // to undo "by anyone, including us". public/airdrop-plan.js exists specifically to refuse
  // these rather than guess at them, was already in this bundle, and was not being used here.
  //
  // This section drives the REAL form in the REAL bundle and reads the amount that reaches the
  // wire, because a unit test of parseAmount() would pass whether or not the pane calls it — the
  // bug was never in the parser, it was in which function the pane reached for.
  {
    const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    // Each row: what someone types, and what must happen. `sends` is the exact string that must
    // arrive at /api/lock/create-tx — null means the request must never be made at all.
    const CASES = [
      { typed: "1,234.56",  sends: "1234.56", why: "unambiguous English grouping is normalised, not truncated to 1" },
      { typed: "1000",      sends: "1000",    why: "a plain number still works" },
      { typed: "0.000001",  sends: "0.000001", why: "a small decimal keeps every digit" },
      { typed: "1.234,56",  sends: null,      why: "a European decimal is REFUSED, never read as 1.234" },
      { typed: "1 000 000", sends: null,      why: "space grouping is REFUSED, never read as 1" },
      { typed: "1,5",       sends: null,      why: "an ambiguous comma is REFUSED, never read as 1" },
      { typed: "1e6",       sends: null,      why: "scientific notation is REFUSED rather than expanded for them" },
    ];

    for (const c of CASES) {
      let sentAmount = "___NEVER_SENT___";
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api/locks*", (r) => r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, mint: MINT, decimals: 6, supply: 1e9, totalLocked: 0, pctOfSupply: 0, lockCount: 0, breakdown: [], topLocks: [] }) }));
      await page.route("**/api/lock/create-tx*", (r) => {
        try { sentAmount = JSON.parse(r.request().postData() || "{}").amount; } catch (_) { sentAmount = "___UNPARSEABLE___"; }
        // Refuse it — this section is about what left the device, not about signing.
        r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not part of this test" }) });
      });
      // The module-level FAKE already registers a connect-capable Wallet Standard wallet.
      // Its signTransaction returns the transaction unsigned, which is fine: this section
      // asserts on what leaves the device BEFORE any wallet prompt and must never reach one.
      await page.addInitScript(FAKE);
      // ⚠️ /index.html, not /seeker.html — the shipped bundle IS the index. Getting this
      // wrong produced a blank page and a 20s waitForFunction timeout, not a failed
      // assertion, which is why the whole run died instead of reporting.
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
      await page.waitForTimeout(400);
      await page.click(".seeker-walletbtn");
      await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { window.location.hash = "#/tools/lock"; });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".seeker-launch-tabbtn")).find((x) => /create/i.test(x.innerText)); b && b.click(); });
      await page.waitForTimeout(300);
      await page.fill("#lr-c-mint", MINT);
      await page.fill("#lr-c-amount", c.typed);
      await page.click(".seeker-listing-runbtn");
      await page.waitForTimeout(1200);

      if (c.sends === null) {
        ok(`K · ⚠️ "${c.typed}" — ${c.why}`, sentAmount === "___NEVER_SENT___",
           `the app sent amount=${JSON.stringify(sentAmount)} to the chain instead of refusing it`);
        // A silent refusal is its own bug: the person retypes the same thing forever.
        const shown = await text(page);
        ok(`K · "${c.typed}" — and it says why, rather than doing nothing`,
           /could not be read|unclear format|scientific notation/i.test(shown), shown.slice(0, 300));
      } else {
        ok(`K · ⚠️ "${c.typed}" — ${c.why}`, sentAmount === c.sends,
           `sent ${JSON.stringify(sentAmount)}, expected ${JSON.stringify(c.sends)}`);
      }
      ok(`K · "${c.typed}" — no uncaught exception`, errors.length === 0, errors.join(" | ").slice(0, 300));
      await ctx.close();
    }
  }

  // ---- L: the Firepit burn sheet tells the truth about what it is about to do -------------
  //
  // P2-9 of the adversarial review: three of the four irreversible tools had NO behavioural test
  // at all — Firepit, Project Burn and the Hatchery were covered only by section B, "it mounts".
  // Every P1 in the burn lens lived in code no test exercised, including the confirm sheet, which
  // is the exact surface docs/SEEKER_TOOLS_BUILD.md §3.4 stakes the guardrails promise on.
  //
  // The fixture is built to trip all three of the sheet's old lies at once:
  //   · an ordinary token with a known value          → must be listed, and IS really burned
  //   · 5 wrapped SOL                                 → unwrapped, not burned; its whole balance
  //                                                     comes back and must be in the SOL total
  //   · an account whose amountRaw the node could not scale (uiAmount null → the server's old
  //     `empty` rule said EMPTY)                      → must never be pre-selected as empty
  {
    const W = "So11111111111111111111111111111111111111112";
    const SCAN = {
      success: true,
      wallet: ADDR,
      rentLamportsTotal: 6117840,
      accounts: [
        // A real empty account: pre-selected, safe, nothing destroyed.
        { tokenAccount: "Emp1111111111111111111111111111111111111111", mint: "Mnt111111111111111111111111111111111111111",
          program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", amountRaw: "0", decimals: 6, uiAmount: 0,
          rentLamports: 2039280, frozen: false, delegated: false, symbol: "EMPTY", name: "Empty", logo: null,
          priceUsd: 0, valueUsd: 0, priceKnown: true, empty: true, isNft: false },
        // A token genuinely worth money: 1.5 tokens at $4 = $6.00.
        { tokenAccount: "Val1111111111111111111111111111111111111111", mint: "Mnt222222222222222222222222222222222222222",
          program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", amountRaw: "1500000", decimals: 6, uiAmount: 1.5,
          rentLamports: 2039280, frozen: false, delegated: false, symbol: "WORTH", name: "Worth", logo: null,
          priceUsd: 4, valueUsd: 6, priceKnown: true, empty: false, isNft: false },
        // 5 wrapped SOL. amountRaw is lamports (wSOL has 9 decimals).
        { tokenAccount: "Wso1111111111111111111111111111111111111111", mint: W,
          program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", amountRaw: "5000000000", decimals: 9, uiAmount: 5,
          rentLamports: 2039280, frozen: false, delegated: false, symbol: "wSOL", name: "Wrapped SOL", logo: null,
          priceUsd: 0, valueUsd: 0, priceKnown: true, empty: false, isNft: false },
        // ⚠️ The trap. A node that would not ui-scale this account: uiAmount null. The server's
        // OLD rule (`Number(ta.uiAmount) || 0` === 0) called this EMPTY while it holds 1000 units.
        // Sent here with empty:true ON PURPOSE — the client must not believe it.
        { tokenAccount: "Poi1111111111111111111111111111111111111111", mint: "Mnt333333333333333333333333333333333333333",
          program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", amountRaw: "1000000", decimals: 6, uiAmount: null,
          rentLamports: 2039280, frozen: false, delegated: false, symbol: "POISON", name: "Withheld fees", logo: null,
          priceUsd: 0, valueUsd: 0, priceKnown: false, empty: true, isNft: false },
      ],
    };

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/api/burn-scan*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCAN) }));
    await page.addInitScript(FAKE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.click(".seeker-walletbtn");
    await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { window.location.hash = "#/tools/firepit"; });
    await page.waitForTimeout(1200);

    // ── the poisoned row is not treated as empty ────────────────────────────────────────────
    // Firepit pre-selects every empty row — the only place in the app that pre-selects anything.
    const preselected = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).length);
    ok("L · ⚠️ an account whose amount the node could not read is NOT pre-selected as empty",
       preselected === 1, `${preselected} rows were pre-ticked; only the one genuinely empty row should be`);

    // ── the burn sheet ──────────────────────────────────────────────────────────────────────
    // Tick everything in the Burn group, then open the sheet.
    const clickedAll = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter((b) => /select all/i.test(b.innerText.trim()));
      if (btns.length < 2) return btns.length;
      btns[btns.length - 1].click();      // the Burn group's own Select all
      return btns.length;
    });
    ok("L · the Burn group has its own Select all", clickedAll >= 2, `found ${clickedAll}`);
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /^burn$/i.test(x.innerText.trim()));
      b && b.click();
    });
    const opened = await page.waitForFunction(() => !!document.querySelector(".seeker-confirm"), null, { timeout: 10000 })
      .then(() => true).catch(() => false);
    ok("L · the burn sheet opens", opened, await text(page).then((b) => b.slice(0, 300)));

    if (opened) {
      const sheet = await page.evaluate(() => document.querySelector(".seeker-confirm").innerText);

      // P1-3: a count is not an account of what is about to happen.
      ok("L · ⚠️ the sheet NAMES each row, not just a count",
         /WORTH/.test(sheet) && /wSOL/.test(sheet), sheet.slice(0, 500));
      ok("L · and gives each row its own action and amount",
         /burn/i.test(sheet) && /unwrap/i.test(sheet), sheet.slice(0, 500));

      // P1-4: wSOL unwraps. Both numbers and the sentence used to say otherwise.
      ok("L · ⚠️ wrapped SOL is described as an unwrap, not a burn",
         /unwrapped, not burned|unwrap/i.test(sheet), sheet.slice(0, 500));
      ok("L · ⚠️ the SOL returning includes the whole wrapped balance, not just the rent",
         /5\.00/.test(sheet), `sheet never showed ~5.006 SOL returning:\n${sheet.slice(0, 500)}`);

      // P1-3: the typed gate. Value is being destroyed AND a row is unpriced, so it must be armed.
      const before = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll(".seeker-confirm button")).find((x) => /confirm and sign/i.test(x.innerText));
        return b ? b.disabled : null;
      });
      ok("L · ⚠️ the confirm button starts DISABLED behind the typed gate", before === true, `disabled=${before}`);
      ok("L · and the sheet says what to type", /BURN/.test(sheet), sheet.slice(0, 500));

      // Typing the wrong thing must not arm it.
      await page.fill(".seeker-confirm-type input", "burnn");
      const wrong = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll(".seeker-confirm button")).find((x) => /confirm and sign/i.test(x.innerText));
        return b ? b.disabled : null;
      });
      ok("L · a near-miss does not arm it", wrong === true, `disabled=${wrong}`);
      await page.fill(".seeker-confirm-type input", "burn");
      const right = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll(".seeker-confirm button")).find((x) => /confirm and sign/i.test(x.innerText));
        return b ? b.disabled : null;
      });
      ok("L · typing the word (any case) arms it", right === false, `disabled=${right}`);
    }
    ok("L · no uncaught exception", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  // ---- M: Project Burn never arms on a number it could not read --------------------------
  //
  // The other half of P2-9: Project Burn signs, and had no behavioural test beyond "it mounts".
  //
  // `/api/burn-token-info` swallows a failed getTokenAccountsByOwner and answers 200 with
  // `walletBalance: null`. The pane's `overBalance` is guarded on `balance != null`, so it was
  // false; `canBurn` never required a known balance; and the card showed "Your balance: Unknown"
  // above a live amount field and a live, armed Burn button. Tapping it re-read, got null again,
  // and printed "Your balance changed since this page loaded" — a claim about someone's wallet
  // the app has no basis for. Two separate facts, and the app asserted the wrong one.
  {
    const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    const INFO = (walletBalance) => ({
      success: true, mint: MINT, name: "Cluck Norris", symbol: "CLKN", decimals: 6,
      supply: "1000000000000000", walletBalance,
      walletBalanceRaw: walletBalance == null ? null : String(Math.round(walletBalance * 1e6)),
      mintAuthority: null, freezeAuthority: null, priceUsd: null,
    });

    for (const [label, balance, wantArmed] of [
      ["an UNREADABLE balance", null, false],
      ["a readable balance", 1000, true],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api/burn-token-info*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INFO(balance)) }));
      await page.addInitScript(FAKE);
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
      await page.waitForTimeout(400);
      await page.click(".seeker-walletbtn");
      await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { window.location.hash = "#/tools/burn"; });
      await page.waitForTimeout(400);
      await page.fill("#pb-mint", MINT);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((x) => /load token/i.test(x.innerText.trim()));
        b && b.click();
      });
      const loaded = await page.waitForFunction(() => !!document.querySelector("#pb-amount"), null, { timeout: 15000 })
        .then(() => true).catch(() => false);
      ok(`M · ${label} — the token card loads`, loaded, await text(page).then((b) => b.slice(0, 300)));

      if (loaded) {
        await page.fill("#pb-amount", "1");
        await page.waitForTimeout(200);
        const armed = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find((x) => /^burn$/i.test(x.innerText.trim()));
          return b ? !b.disabled : null;
        });
        ok(`M · ⚠️ ${label} — the Burn button is ${wantArmed ? "armed" : "NOT armed"}`,
           armed === wantArmed, `armed=${armed}`);

        if (!wantArmed) {
          // And the screen must not blame them for it. "Unknown" is honest; "your balance
          // changed" is a claim about their wallet we cannot support.
          const body = await text(page);
          ok("M · ⚠️ and it never says their balance CHANGED — only that it could not be read",
             !/balance changed/i.test(body), body.slice(0, 400));
        }
      }
      ok(`M · ${label} — no uncaught exception`, errors.length === 0, errors.join(" | ").slice(0, 300));
      await ctx.close();
    }
  }

  // ---- N: the Hatchery says the upload is permanent BEFORE it happens --------------------
  //
  // The last of P2-9, and the one with the least forgiving consequence. "Review mint" sounds like
  // a preview, and the screen it leads to has a "Start over" button — so everything about the
  // step said nothing had happened yet. It is not a preview: /api/hatchery/build uploads the logo
  // AND the name, symbol and description to Arweave as the FIRST thing it does, before it builds
  // anything. That upload is permanent and public, and backing out does not remove it. The pane's
  // own header recorded that /build is "a REAL, permanent action" and the UI never passed it on.
  //
  // Two assertions, and the second is the one that matters: the warning is on screen BEFORE the
  // button, and /build is not called until the button is tapped. A warning that appears in the
  // spinner afterwards is not a guardrail.
  {
    let buildCalls = 0;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/api/hatchery/config*", (r) => r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, feeWaived: false, solEnabled: true, clknEnabled: false, feeLamports: 50000000, feeSol: 0.05 }) }));
    await page.route("**/api/hatchery/build*", (r) => { buildCalls++; r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not part of this test" }) }); });
    await page.addInitScript(FAKE);
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.click(".seeker-walletbtn");
    await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { window.location.hash = "#/tools/hatchery"; });
    await page.waitForTimeout(600);

    const onForm = await page.waitForFunction(() => !!document.querySelector("#hatch-name"), null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    ok("N · the mint form renders", onForm, await text(page).then((b) => b.slice(0, 300)));

    if (onForm) {
      const body = await text(page);
      ok("N · ⚠️ the form says the upload is permanent and public, in plain words",
         /permanently and publicly/i.test(body), body.slice(0, 600));
      ok("N · ⚠️ and that backing out afterwards does not undo it",
         /can't be deleted|cannot be deleted/i.test(body), body.slice(0, 600));
      // The warning has to be ABOVE the button, not below it — on a phone, below the fold is the
      // same as absent.
      const order = await page.evaluate(() => {
        const note = document.querySelector(".seeker-hatch-permanentnote");
        const btn = Array.from(document.querySelectorAll("button")).find((x) => /review mint/i.test(x.innerText.trim()));
        if (!note || !btn) return null;
        return note.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING ? "warning-first" : "button-first";
      });
      ok("N · ⚠️ the warning comes BEFORE the button, not after it", order === "warning-first", `order=${order}`);
      ok("N · ⚠️ and NOTHING has been uploaded just by opening the form", buildCalls === 0, `build called ${buildCalls}x`);
    }
    ok("N · no uncaught exception", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  // ---- O: the Hatchery's image pipeline actually RUNS ------------------------------------
  //
  // `docs/HANDOFF_2026-09-21_SEEKER.md` §4 names this as never verified: "the Hatchery's image
  // path has never run in a browser at all". The adversarial-review fix made that worse, not
  // better — it changed prepareLogo so EVERY image is re-encoded through a canvas (previously a
  // small png/jpeg/webp was passed through byte-for-byte), added a PNG branch and a server-cap
  // check, and none of it had ever executed. Code that moves someone's photo into permanent
  // public storage should not ship on a reading of the source.
  //
  // So this drives the real file input in the real bundle with real image bytes, and reads what
  // the pane would POST to /api/hatchery/build — `imageBase64` and `imageMime` are exactly what
  // reaches Arweave. The request is refused, so nothing is uploaded; only the bytes are examined.
  {
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hatch-img-"));

    // Build real, decodable images with the browser itself, then (for the JPEG) splice in an
    // APP1 Exif segment right after SOI — a valid, browser-decodable JPEG that carries EXIF,
    // which is what a phone's camera roll hands over. Hand-writing a JPEG encoder here would be
    // its own source of bugs; the browser's encoder is the one real photos come through anyway.
    const genCtx = await browser.newContext();
    const genPage = await genCtx.newPage();
    await genPage.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    const made = await genPage.evaluate(() => {
      function draw(w, h, alpha) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const x = c.getContext("2d");
        if (!alpha) { x.fillStyle = "#123456"; x.fillRect(0, 0, w, h); }
        // Enough detail that a JPEG of it is not trivially tiny.
        for (let i = 0; i < 400; i++) {
          x.fillStyle = `rgb(${(i * 7) % 256},${(i * 13) % 256},${(i * 29) % 256})`;
          x.fillRect((i * 37) % w, (i * 53) % h, w / 12, h / 12);
        }
        return c;
      }
      return {
        // Big enough that the old fast path would NOT have applied to it anyway…
        bigJpeg: draw(1600, 1600, false).toDataURL("image/jpeg", 0.95),
        // …and one small enough that it WOULD have been passed through byte-for-byte before.
        smallJpeg: draw(160, 160, false).toDataURL("image/jpeg", 0.7),
        // A PNG with transparency, to prove the PNG branch keeps it PNG.
        smallPng: draw(120, 120, true).toDataURL("image/png"),
      };
    });
    await genCtx.close();

    const b64ToBuf = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64");
    // APP1 Exif segment: marker FFE1, length, "Exif\0\0", then a minimal little-endian TIFF
    // header. Decoders skip a segment they cannot parse, so the image still renders — which is
    // the point: the bytes ride along invisibly, exactly as a camera's GPS tags do.
    function withExif(jpeg) {
      const payload = Buffer.concat([
        Buffer.from("Exif\0\0", "latin1"),
        Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
        Buffer.from("GPSLatitude 51.5074 GPSLongitude -0.1278 CLUCK-EXIF-CANARY", "latin1"),
      ]);
      const len = payload.length + 2;
      return Buffer.concat([
        jpeg.subarray(0, 2),                            // SOI
        Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]),
        payload,
        jpeg.subarray(2),
      ]);
    }

    const files = {
      // name              bytes                                        what it proves
      bigJpeg:   { buf: withExif(b64ToBuf(made.bigJpeg)),   mime: "image/jpeg", ext: "jpg" },
      smallJpeg: { buf: withExif(b64ToBuf(made.smallJpeg)), mime: "image/jpeg", ext: "jpg" },
      smallPng:  { buf: b64ToBuf(made.smallPng),            mime: "image/png",  ext: "png" },
    };
    for (const [k, f] of Object.entries(files)) {
      f.path = path.join(tmp, `${k}.${f.ext}`);
      fs.writeFileSync(f.path, f.buf);
    }
    ok("O · the EXIF canary really is in the source files (or the test below proves nothing)",
       files.bigJpeg.buf.includes("CLUCK-EXIF-CANARY") && files.smallJpeg.buf.includes("CLUCK-EXIF-CANARY"),
       "the spliced APP1 segment is missing from the fixtures");

    const MAX_LOGO_BYTES = 100 * 1024;   // mirrors hatchery.js, same as the pane
    for (const [label, f, wantMime] of [
      ["a 1600px camera JPEG with EXIF", files.bigJpeg, "image/jpeg"],
      ["⚠️ a SMALL JPEG with EXIF (the old fast path passed these through untouched)", files.smallJpeg, "image/jpeg"],
      ["a small PNG", files.smallPng, "image/png"],
    ]) {
      let posted = null;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api/hatchery/config*", (r) => r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, feeWaived: true, solEnabled: true, clknEnabled: false, feeLamports: 0, feeSol: 0 }) }));
      await page.route("**/api/hatchery/build*", (r) => {
        try { posted = JSON.parse(r.request().postData() || "{}"); } catch (_) { posted = { parseError: true }; }
        // Refuse it. Nothing is uploaded anywhere; we only want the bytes it was going to send.
        r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not part of this test" }) });
      });
      await page.addInitScript(FAKE);
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
      await page.waitForTimeout(400);
      await page.click(".seeker-walletbtn");
      await page.waitForFunction(() => /Disconnect/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { window.location.hash = "#/tools/hatchery"; });
      await page.waitForFunction(() => !!document.querySelector("#hatch-name"), null, { timeout: 15000 }).catch(() => {});

      await page.fill("#hatch-name", "Cluck Coin");
      await page.fill("#hatch-symbol", "CLUCK");
      await page.fill("#hatch-supply", "1000000000");
      await page.setInputFiles("#hatch-logo", f.path);
      // prepareLogo decodes and re-encodes; give it room on a slow box.
      await page.waitForTimeout(2500);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((x) => /review mint/i.test(x.innerText.trim()));
        b && b.click();
      });
      await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(2500);

      ok(`O · ${label} — the pane got as far as posting a logo`,
         !!(posted && typeof posted.imageBase64 === "string" && posted.imageBase64.length > 0),
         `posted=${JSON.stringify(posted && Object.keys(posted))}`);

      if (posted && typeof posted.imageBase64 === "string" && posted.imageBase64.length) {
        const out = Buffer.from(posted.imageBase64, "base64");

        // ⚠️ THE ONE THIS SECTION EXISTS FOR. A canvas re-encode reads PIXELS; every EXIF, XMP
        // and ICC block is left behind. If the canary survives, someone's GPS coordinates just
        // went to permanent public storage.
        ok(`O · ⚠️ ${label} — NO EXIF survives into what would be uploaded`,
           !out.includes("CLUCK-EXIF-CANARY") && !out.includes("GPSLatitude"),
           `the EXIF canary is still in the ${out.length}-byte payload`);

        ok(`O · ${label} — it is a real ${wantMime} and the declared mime matches the bytes`,
           posted.imageMime === wantMime && (wantMime === "image/png"
             ? (out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4e && out[3] === 0x47)
             : (out[0] === 0xff && out[1] === 0xd8)),
           `mime=${posted.imageMime} magic=${out.subarray(0, 4).toString("hex")}`);

        ok(`O · ${label} — under the server's own cap (${MAX_LOGO_BYTES} bytes)`,
           out.length <= MAX_LOGO_BYTES, `${out.length} bytes`);

        ok(`O · ${label} — and not empty or truncated`, out.length > 200, `${out.length} bytes`);
      }
      ok(`O · ${label} — no uncaught exception`, errors.length === 0, errors.join(" | ").slice(0, 300));
      await ctx.close();
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  // ---- I: it is not an English-only app -------------------------------------------------
  //
  // The school ships in SEVEN languages (AGENTS.md), and this app is part of the school. An
  // English-only app beside a seven-language school is not a smaller version of the same product
  // — it is a different one for everybody who does not read English.
  //
  // seeker-build-test (f) asserts every string the app renders is present in all six curated
  // dictionaries. That is the SOURCE half, and it has a blind spot: a key can be in the file and
  // still never reach the screen (the dictionary never loads in the bundle, the app reads it
  // before it is ready, a key does not match byte for byte). This is the RENDERED half — the
  // pair AGENTS.md's "check every form, not one form" asks for. Both, or neither means much.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("clkn_lang", "es"); } catch (_) {} });
    await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector(".seeker-shell"), null, { timeout: 20000 });
    await page.waitForTimeout(1200);   // i18n.js fetches its dictionary, then the app re-reads it

    ok("I · the Spanish dictionary actually loads inside the bundle",
       await page.evaluate(() => !!(window.CLKN_I18N && window.CLKN_I18N.lang === "es" && window.CLKN_I18N.dict && Object.keys(window.CLKN_I18N.dict).length > 100)));

    // Sampled from what is ON SCREEN, not from the file: three strings the toolkit renders, each
    // of which must differ from its English source. Nothing is asserted about the translation's
    // quality — only that Spanish is what a Spanish speaker gets.
    const shots = [];
    for (const hash of ["#/tools", "#/rent", "#/tools/lock"]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(400);
      shots.push(await page.evaluate(() => document.body.innerText));
    }
    const body = shots.join("\n");
    const englishLeftOver = [
      "Everything the school gives you, built for this phone.",
      "Dead token accounts are holding your SOL.",
      "Lock tokens on Jupiter Lock, non-custodially, and get public proof you did.",
    ].filter((phrase) => body.includes(phrase));
    ok("I · ⚠️ the toolkit, Rent Reclaim and the Locker Room all render in Spanish, not English",
       englishLeftOver.length === 0, `still English on screen: ${JSON.stringify(englishLeftOver)}`);
    ok("I · the nav labels are translated too", !/\bToolkit\b/.test(body), body.slice(0, 200));
    ok("I · and nothing throws in a non-English locale", errors.length === 0, errors.join(" | ").slice(0, 300));
    await ctx.close();
  }

  await browser.close();
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
