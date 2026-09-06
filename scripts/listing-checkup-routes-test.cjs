#!/usr/bin/env node
"use strict";
// Listing Checkup — route-level test on the real server, offline (LISTING_CHECKUP_OFFLINE=1 makes
// every source `unread`, so no aggregator sees CI traffic). Covers validation, the run → cache →
// share-page path with attacker-controlled strings escaped, caps shape, and the unknown-mint page.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PORT = Number(process.env.LC_TEST_PORT || 3153);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lc-routes-"));
const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, LISTING_CHECKUP_OFFLINE: "1", HELIUS_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" }, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/healthz")).ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  console.log("\nListing Checkup routes (offline)\n");

  let r = await fetch(BASE + "/api/listing-checkup/config"); let j = await r.json();
  ok("config lists the sources with tiers and never a hardcoded amount", r.status === 200 && Array.isArray(j.sources) && j.sources.some((s) => s.id === "onchain" && s.tier === "preview") && j.caps && j.caps.fullPerMintPerDay > 0);
  r = await post("/api/listing-checkup/run", { mint: "nope", name: "x", symbol: "x" }); j = await r.json();
  ok("bad mint → 400", r.status === 400 && /Solana address/.test(j.error));
  r = await post("/api/listing-checkup/run", { mint: MINT, name: "", symbol: "X" }); j = await r.json();
  ok("missing name → 400", r.status === 400 && /name/.test(j.error));
  r = await post("/api/listing-checkup/run", { mint: MINT, name: "x", symbol: "x", website: "javascript:alert(1)<" }); j = await r.json();
  ok("a website that cannot be a link → 400", r.status === 400 && /link/.test(j.error));

  const hostile = { mint: MINT, name: "<script>alert(1)</script>", symbol: "X<b>", website: "https://clucknorris.app", logo: "https://clucknorris.app/cluck-norris-logo.jpg", tier: "preview" };
  r = await post("/api/listing-checkup/run", hostile); j = await r.json();
  ok("offline preview still returns a report (every source unread, never a 500)", r.status === 200 && j.ok && j.report && j.report.summary.unread === j.report.checked, JSON.stringify(j).slice(0, 200));
  ok("…and the on-chain row says why it could not read", j.report && j.report.sources.find((s) => s.id === "onchain").error.includes("offline"));
  // Batch A: the checks ride along — offline every network-backed one is unread (never a throw),
  // chainFacts says the on-chain row was unread, and the how-to never appears on an unread row.
  const ch = j.report && j.report.checks;
  ok("preview carries the Batch A checks (chainFacts, impersonators, linkHealth, logoSpec)", ch && ["chainFacts", "impersonators", "linkHealth", "logoSpec"].every((k) => ch[k] && ch[k].id === k), JSON.stringify(ch).slice(0, 200));
  ok("…offline: impersonators + logoSpec are unread with the reason, chainFacts unread (no invented facts)", ch && ch.impersonators.status === "unread" && /offline/.test(ch.impersonators.error) && ch.logoSpec.status === "unread" && ch.chainFacts.status === "unread" && !ch.chainFacts.facts);
  ok("…linkHealth marks every link broken/unverified offline, never ok", ch && ch.linkHealth.status === "ok" && ch.linkHealth.links.length > 0 && ch.linkHealth.links.every((l) => l.status !== "ok"));
  r = await fetch(BASE + "/api/listing-checkup/report?mint=" + MINT); j = await r.json();
  ok("the report endpoint returns the cached run", r.status === 200 && j.runs && j.runs.length === 1 && j.runs[0].canonical.name === hostile.name);
  r = await fetch(BASE + "/listing/" + MINT); const html = await r.text();
  ok("the share page renders the cached run", r.status === 200 && /LISTING CHECKUP/.test(html));
  ok("…with the hostile name ESCAPED (no raw <script>)", !html.includes("<script>alert(1)") && html.includes("&lt;script&gt;alert(1)"));
  ok("…and the symbol escaped", !html.includes("$X<b>") && html.includes("X&lt;b&gt;"));
  ok("…and the unread check sections render escaped (LOGO / IMPERSONATORS blocks present)", /POSSIBLE IMPERSONATORS/.test(html) && /LOGO/.test(html) && !/<script>alert/.test(html));
  r = await fetch(BASE + "/listing/11111111111111111111111111111111"); const h2 = await r.text();
  ok("an unknown mint gets the 'no checkup yet' page, not an error", r.status === 200 && /No checkup yet/.test(h2));
  r = await fetch(BASE + "/listing/not-a-mint");
  ok("a malformed mint on the share page → 404", r.status === 404);
  r = await fetch(BASE + "/listing-checkup");
  ok("the tool page is served", r.status === 200);

  // caps: the 4th full sweep on one mint in a day is refused
  for (let i = 0; i < 3; i++) { r = await post("/api/listing-checkup/run", { ...hostile, tier: "full" }); }
  r = await post("/api/listing-checkup/run", { ...hostile, tier: "full" }); j = await r.json();
  ok("the per-mint daily cap on full sweeps holds (4th → 429)", r.status === 429 && j.error === "daily_cap_mint", JSON.stringify(j).slice(0, 160));
  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
