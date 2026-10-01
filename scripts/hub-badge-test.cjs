#!/usr/bin/env node
"use strict";
// BB3 (docs/COLOSSEUM_ROADMAP.md §12) — the shields.io-shaped reproducibility badge, computed
// (never typed) by summing the SAME hubReproducibilityFor()/lib/hub/reproduce.js
// projectReproducibility the /api/hub/:project/reproducibility route and hub-status.html already
// use. Two routes: `GET /api/hub/badge.json` (the shields "endpoint badge" schema) and
// `GET /hub/badge.svg` (a small server-rendered flat badge, same numbers). What must hold:
//   - a fresh install (no receipts anywhere) answers {message:"no receipts yet", color:"lightgrey"}
//     — never "0 of 0" — even though clkn/cuna/rose (built-ins) and poke (seeded dryRun:true at
//     boot, CLAUDE.md "Money") are all registered projects with zero receipts;
//   - a real project with one sent batch answers "1 of 1 across 1 project" (singular — the
//     pluralisation this task fixes) and color:"green", while the dry-run/zero-receipt projects
//     never inflate the "K projects" count;
//   - a demo project (reserved, never actually registrable — see hubProjects()/reservedMints in
//     server.js) never counts, and `?project=demo` 404s on both routes;
//   - the JSON body has EXACTLY the shields endpoint-badge keys, with the right types;
//   - the SVG is well-formed XML (balanced tags, one root <svg>) and contains no `<script`;
//   - both routes carry the Cache-Control + ETag public-route-hygiene-test.cjs pins for the
//     other Hub reads at this tier (300s).
//
// Usage: node scripts/hub-badge-test.cjs
// Env:   HUB_BADGE_TEST_PORT (default 3276)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.HUB_BADGE_TEST_PORT || 3276);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

// ── fixture (own to this script, same idiom as scripts/hub-status-test.cjs) ────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const HST_MINT = fakeAddr(2);
const WALLET = fakeAddr(3);
const SIG = fakeSig(1);
const T0 = 1_800_000_000; // fixed, arbitrary unix seconds — a fixture, not a live clock

function seededFixtureState() {
  const days = { "2027-02-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 } };
  const batches = {
    "hb-batch-1": {
      id: "hb-batch-1", state: "sent", at: T0 + 3600, count: 1, totalRaw: "1000000000",
      amounts: { [WALLET]: "1000000000" }, sent: { [WALLET]: { sig: SIG, at: T0 + 3660 } },
    },
  };
  return {
    "hub:projects": {
      hbtest: { id: "hbtest", label: "Hub Badge Test", symbol: "HBT", mint: HST_MINT, decimals: 9, rewardMint: HST_MINT, rewardDecimals: 9 },
    },
    "program:hbtest:days": days,
    "program:hbtest:batches": batches,
    "program:hbtest:paid": {},
  };
}

async function bootServer(dir) {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, TOOLGATE_OFF: "1",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { try { srv.kill("SIGKILL"); } catch (_) {} throw new Error("server did not come up"); }
  return srv;
}
function killServer(srv) { try { srv.kill("SIGKILL"); } catch (_) {} }

// ── a minimal, dependency-free well-formedness check (fast-xml-parser is not a project dep) ────
// Balanced open/close/self-closing tags, exactly one root element, and (the honesty rule this
// route promises in its own source comment) no <script anywhere in the body.
function xmlIsWellFormed(svg) {
  if (!/^\s*<svg[\s>]/.test(svg)) return { ok: false, why: "does not start with <svg" };
  if (/<script/i.test(svg)) return { ok: false, why: "contains <script" };
  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/)?>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(svg))) {
    const [full, name, selfClose] = m;
    if (full.startsWith("<?") || full.startsWith("<!")) continue;
    if (selfClose) continue;
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) return { ok: false, why: `mismatched close </${name}> (expected </${top}>)` };
    } else {
      stack.push(name);
    }
  }
  if (stack.length) return { ok: false, why: `unclosed tag(s): ${stack.join(",")}` };
  return { ok: true };
}

(async () => {
  console.log("\nHub reproducibility badge (Colosseum roadmap §12 BB3)\n");

  // ── Phase 1: fresh install — no receipts anywhere ─────────────────────────────────────────────
  console.log("1. Fresh install\n");
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-badge-fresh-"));
  let srv = await bootServer(dir);
  try {
    const r = await fetch(`${BASE}/api/hub/badge.json`);
    const body = await r.json();
    ok("200", r.status === 200, String(r.status));
    ok("schemaVersion is the number 1", body.schemaVersion === 1, JSON.stringify(body));
    ok("label is 'receipts reproducible'", body.label === "receipts reproducible", JSON.stringify(body));
    ok("message is 'no receipts yet' on a fresh install (built-ins + the seeded poke dry-run all have 0 receipts)", body.message === "no receipts yet", JSON.stringify(body));
    ok("color is lightgrey", body.color === "lightgrey", JSON.stringify(body));
    ok("cacheSeconds is the number 300", body.cacheSeconds === 300, JSON.stringify(body));
    ok("Cache-Control is public, max-age=300", r.headers.get("cache-control") === "public, max-age=300", r.headers.get("cache-control"));
    ok("carries an ETag", !!r.headers.get("etag"));

    // exact-keys check — the shields endpoint-badge schema, nothing extra
    const keys = Object.keys(body).sort();
    ok("JSON has exactly the shields keys", JSON.stringify(keys) === JSON.stringify(["cacheSeconds", "color", "label", "message", "schemaVersion"].sort()), JSON.stringify(keys));

    // ?project=demo — reserved, never a real registered project → 404
    const rDemo = await fetch(`${BASE}/api/hub/badge.json?project=demo`);
    ok("?project=demo is 404 on badge.json", rDemo.status === 404, String(rDemo.status));
    const rDemoSvg = await fetch(`${BASE}/hub/badge.svg?project=demo`);
    ok("?project=demo is 404 on badge.svg too", rDemoSvg.status === 404, String(rDemoSvg.status));

    // a known, real, but zero-receipt project (poke, seeded dryRun:true at boot) — a single project's
    // badge should never error, and reports "no receipts yet" for itself.
    const rPoke = await fetch(`${BASE}/api/hub/badge.json?project=poke`);
    const pokeBody = await rPoke.json();
    ok("?project=poke (dry run, zero receipts) is 200 with its own 'no receipts yet'", rPoke.status === 200 && pokeBody.message === "no receipts yet", JSON.stringify(pokeBody));

    // an unknown, never-registered id — also 404
    const rUnknown = await fetch(`${BASE}/api/hub/badge.json?project=not-a-real-project-xyz`);
    ok("?project=<unknown> is 404", rUnknown.status === 404, String(rUnknown.status));

    // ── SVG ──
    console.log("\n1b. GET /hub/badge.svg (fresh install)\n");
    const rSvg = await fetch(`${BASE}/hub/badge.svg`);
    const svg = await rSvg.text();
    ok("200", rSvg.status === 200, String(rSvg.status));
    ok("Content-Type is image/svg+xml", (rSvg.headers.get("content-type") || "").includes("image/svg+xml"), rSvg.headers.get("content-type"));
    ok("Cache-Control is public, max-age=300", rSvg.headers.get("cache-control") === "public, max-age=300", rSvg.headers.get("cache-control"));
    ok("carries an ETag", !!rSvg.headers.get("etag"));
    ok("shows 'no receipts yet' in the rendered text", /no receipts yet/.test(svg), svg);
    const wf = xmlIsWellFormed(svg);
    ok("parses as well-formed XML", wf.ok, wf.why);
    ok("contains no <script", !/<script/i.test(svg));

    // conditional revalidation, same pattern the hygiene test pins for the other Hub reads
    const etag = r.headers.get("etag");
    if (etag) {
      const second = await fetch(`${BASE}/api/hub/badge.json`, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } });
      ok("a matching If-None-Match answers 304", second.status === 304, String(second.status));
    }
  } finally {
    killServer(srv);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // ── Phase 2: a real project with one sent batch ───────────────────────────────────────────────
  console.log("\n2. One registered project, one sent batch\n");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-badge-seeded-"));
  fs.writeFileSync(path.join(dir, "app-state.json"), JSON.stringify(seededFixtureState()));
  srv = await bootServer(dir);
  try {
    const r = await fetch(`${BASE}/api/hub/badge.json`);
    const body = await r.json();
    ok("message is '1 of 1 across 1 project' (singular — the pluralisation fix)", body.message === "1 of 1 across 1 project", JSON.stringify(body));
    ok("color is green (N === M)", body.color === "green", JSON.stringify(body));

    // the single-project badge for the seeded project itself
    const rOwn = await fetch(`${BASE}/api/hub/badge.json?project=hbtest`);
    const ownBody = await rOwn.json();
    ok("?project=hbtest reports '1 of 1' for itself (no 'across' clause on a single project)", ownBody.message === "1 of 1" && ownBody.color === "green", JSON.stringify(ownBody));

    // poke (dry run, still zero receipts) never gets pulled into the aggregate's K
    const rPoke = await fetch(`${BASE}/api/hub/badge.json?project=poke`);
    const pokeBody = await rPoke.json();
    ok("poke, alongside a real seeded project, still reports 'no receipts yet' for itself", pokeBody.message === "no receipts yet", JSON.stringify(pokeBody));

    const rSvg = await fetch(`${BASE}/hub/badge.svg`);
    const svg = await rSvg.text();
    ok("SVG shows the same '1 of 1 across 1 project' text", /1 of 1 across 1 project/.test(svg), svg);
    const wf = xmlIsWellFormed(svg);
    ok("SVG still parses as well-formed XML", wf.ok, wf.why);
  } finally {
    killServer(srv);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
