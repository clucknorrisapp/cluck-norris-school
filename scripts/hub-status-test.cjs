#!/usr/bin/env node
/*
 * HUB STATUS — Colosseum roadmap §10 Z2: `GET /api/build` (the git sha/branch this container is
 * actually running) and `/hub/status` (public/hub-status.html), the page that renders it next to
 * every project's own public numbers — programs, receipts, the reproducibility ratio, the latest
 * holder snapshot — fed ONLY by routes already public before this change (`/api/hub`,
 * `/api/hub/:project/reproducibility`, `/api/holders/snapshots`).
 *
 * Three layers:
 *   1. `/api/build` shape — sha/branch/builtAt/env, no server boot needed beyond the one below.
 *   2. The page's raw HTML loads (a no-build boot smoke check — this route must not depend on
 *      `dist/`, CLAUDE.md's public/-is-not-mounted-directly trap).
 *   3. Playwright drives the real page against a throwaway DATA_DIR seeded with:
 *        - "poke" — already seeded dryRun:true by server.js itself at boot (the real carve-out
 *          project, CLAUDE.md "Money"), so a fresh box always has at least one real dry-run row
 *          with no fixture needed here.
 *        - "demo" — a project THIS TEST registers directly in the hub kv registry (a fixture for
 *          this script only — distinct from the isolated /hub-demo dryRun walkthrough module,
 *          which never appears in /api/hub at all), dryRun:true, zero programs, so it exercises
 *          both the dry-run badge and the "no receipts yet" line on the same row.
 *        - "hstest" — a REAL (non-dryRun) registered project with one sent lock-to-earn batch, so
 *          a row with actual receipts renders the reproducibility ratio text instead.
 *      Asserts one row per public project, the two dry-run badges, the ratio text for hstest, the
 *      "no receipts yet" line for demo, and that no forbidden judgement/APR language reaches the
 *      rendered page.
 *
 * Usage: node scripts/hub-status-test.cjs [baseUrl]
 * Env:   HUB_STATUS_TEST_PORT (default 3225) — used only when baseUrl is omitted (a server is booted).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

function resolvePlaywright() {
  const candidates = [
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(__dirname, "..", "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  throw new Error("could not resolve playwright-core from any known location");
}

const ROOT = path.join(__dirname, "..");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_STATUS_TEST_PORT || 3225);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fixture data (own to this script — see the header) ─────────────────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const DEMO_MINT = fakeAddr(1);
const HST_MINT = fakeAddr(2);
const WALLET = fakeAddr(3);
const SIG = fakeSig(1);
const T0 = 1_800_000_000; // fixed, arbitrary unix seconds — a fixture, not a live clock

function buildFixtureState() {
  const days = { "2027-02-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 } };
  const batches = {
    "hs-batch-1": {
      id: "hs-batch-1", state: "sent", at: T0 + 3600, count: 1, totalRaw: "1000000000",
      amounts: { [WALLET]: "1000000000" }, sent: { [WALLET]: { sig: SIG, at: T0 + 3660 } },
    },
  };
  return {
    "hub:projects": {
      demo: { id: "demo", label: "Demo Co", symbol: "DEMO", mint: DEMO_MINT, decimals: 9, rewardMint: DEMO_MINT, rewardDecimals: 9, dryRun: true },
      hstest: { id: "hstest", label: "Hub Status Test", symbol: "HST", mint: HST_MINT, decimals: 9, rewardMint: HST_MINT, rewardDecimals: 9 },
    },
    "program:hstest:days": days,
    "program:hstest:batches": batches,
    "program:hstest:paid": {},
  };
}

// ── 1. /api/build shape ─────────────────────────────────────────────────────────────────────────
async function checkBuild() {
  console.log("\n1. GET /api/build\n");
  const r = await fetch(BASE + "/api/build");
  ok("200", r.status === 200, String(r.status));
  const j = await r.json();
  ok("ok:true", j.ok === true);
  ok("sha is a 40-hex string or null", j.sha === null || /^[0-9a-f]{40}$/i.test(j.sha), JSON.stringify(j.sha));
  ok("branch is a string or null", j.branch === null || typeof j.branch === "string", JSON.stringify(j.branch));
  ok("builtAt is a number", Number.isFinite(j.builtAt));
  ok("env is production/staging/local", ["production", "staging", "local"].includes(j.env), JSON.stringify(j.env));
  ok("Cache-Control caches for 5 minutes", /max-age=300/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
  return j;
}

// ── 2. the page's raw HTML loads (no-build boot) ────────────────────────────────────────────────
async function checkPageLoads() {
  console.log("\n2. GET /hub/status (raw HTML, no build needed)\n");
  const r = await fetch(BASE + "/hub/status");
  ok("200", r.status === 200, String(r.status));
  const html = await r.text();
  ok("serves hub-status.html, not a 404 fallback", /Hub Status/.test(html));
  ok("does not read a project id out of 'status' — no generic /hub/:project handler shadowed it", !/no such project/i.test(html));
}

// ── 3. the rendered page (Playwright) ───────────────────────────────────────────────────────────
async function checkRendered() {
  console.log("\n3. rendered page — one row per public project\n");
  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE + "/hub/status", { waitUntil: "networkidle", timeout: 20000 });
    await sleep(400); // let the fetch()-driven render settle

    const apiProjects = await (await fetch(BASE + "/api/hub")).json();
    const ids = (apiProjects.projects || []).map((p) => p.id);
    ok("the API lists poke, demo and hstest (the fixtures actually registered)", ["poke", "demo", "hstest"].every((id) => ids.includes(id)), JSON.stringify(ids));

    const rowCount = await page.locator("#app .card[id^='proj-']").count();
    ok("one row per public project", rowCount === ids.length, `rows=${rowCount} projects=${ids.length}`);

    const bodyText = await page.locator("#app").innerText();
    ok('the build line renders ("This build: <sha> on <branch> (<env>)")', /This build:/.test(bodyText));

    const demoCard = page.locator("#proj-demo");
    ok("demo's row shows the DRY RUN badge", /DRY RUN/.test(await demoCard.innerText()));
    ok("demo's row shows 'no receipts yet', not a percentage", /no receipts yet/i.test(await demoCard.innerText()));

    const pokeCard = page.locator("#proj-poke");
    ok("poke's row shows the DRY RUN badge too (seeded dryRun:true by server.js itself)", /DRY RUN/.test(await pokeCard.innerText()));

    const hstestCard = page.locator("#proj-hstest");
    const hstestText = await hstestCard.innerText();
    ok("hstest's row (real receipts) shows the reproducibility ratio, not 'no receipts yet'", /reproduce/i.test(hstestText) && !/no receipts yet/i.test(hstestText), hstestText.slice(0, 200));
    ok("hstest's row links to its own project page", (await hstestCard.locator("a[href='/hub/hstest']").count()) > 0);

    ok("links to /hub/verify", (await page.locator("a[href='/hub/verify']").count()) > 0);
    ok("links to HUB_VERIFY.md on GitHub", (await page.locator("a[href*='HUB_VERIFY.md']").count()) > 0);

    // ── no forbidden judgement/APR language (CLAUDE.md: say what's on-chain, never why) ──────────
    const lower = bodyText.toLowerCase();
    ok("no 'healthy'/'growing' judgement language", !/\bhealthy\b/.test(lower) && !/\bgrowing\b/.test(lower));
    ok("no 'verified'/'safe' overclaim", !lower.includes("verified project") && !/\bsafe\b/.test(lower));
    ok("no APR/APY/yield-rate language", !/\bapr\b/.test(lower) && !/\bapy\b/.test(lower));
    ok("no guaranteed-return language", !/\bguarantee/.test(lower));
  } finally {
    await browser.close();
  }
}

(async () => {
  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-status-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(buildFixtureState()));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  console.log(`\nHub Status (Colosseum roadmap §10 Z2) — ${BASE}\n`);
  try {
    await checkBuild();
    await checkPageLoads();
    await checkRendered();
  } finally {
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
