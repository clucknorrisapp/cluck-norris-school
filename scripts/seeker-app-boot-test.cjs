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

  await browser.close();
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
