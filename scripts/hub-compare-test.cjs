#!/usr/bin/env node
"use strict";
// Colosseum roadmap CC1 (docs/COLOSSEUM_ROADMAP.md §13) — "what changed in the rules":
// GET /hub/:project/programs/compare, a field-by-field diff of two published program versions
// computed IN THE BROWSER from the two public GET /api/hub/:project/program/:version documents
// (nothing new is served for the terms themselves — only the small `versions[]` index this
// change adds to GET /api/hub/:project so the page can find "the two most recent" on its own).
//
// Boots the real server with a throwaway DATA_DIR seeded with ONE registry project carrying TWO
// program versions (built directly through lib/hub/project.js, the same way the admin route
// itself creates one) that differ in exactly two term fields — minDurationDays and
// payoutSchedule — everything else (poolDailyRaw, sharePct, maxSharePct, maxTermDays,
// minLockRaw, maxWalletSharePct, cancelableAllowed, fundedBy, excludeWallets, backdateCapDays,
// backdateNotBefore, vesting) held identical on purpose, so "exactly two changed rows" is an
// exact, checkable assertion rather than an approximation.
//
// Asserts:
//   1. GET /api/hub/:project carries a public `versions[]` (whitelisted to {version, hash,
//      publishedAt} — never `terms`), and it validates against project-public.schema.json.
//   2. /hub/<project>/programs/compare resolves to the LITERAL compare page — never the
//      /hub/:project/programs index and never the /hub/:project catch-all (a 3-segment pattern
//      cannot match a 4-segment path, but this proves it against the real, running route table,
//      not by reading server.js top to bottom) — while /hub/<project>/programs still serves the
//      ordinary programs index (a regression control).
//   3. A real Chromium render shows exactly two changed rows and the rest collapsed as unchanged
//      under the toggle; expanding it reveals every one of them.
//   4. Comparing a version with itself (?a=1&b=1) shows no changed rows.
//   5. Both versions' hash (short-form, on the page) match the public program-version API's own
//      hash.
//   6. An unknown version (?a=1&b=99) is an honest not-found state, not a crash or a silent
//      empty diff.
//   7. No forbidden word reaches the rendered page (CLAUDE.md: no verified/safe/guaranteed, no
//      APR/APY/yield, nothing about Normie Quest or Wallet Watch).
//
// Usage: node scripts/hub-compare-test.cjs [baseUrl]
// Env:   HUB_COMPARE_TEST_PORT (default 3310) — used only when baseUrl is omitted.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
const PORT = Number(process.env.HUB_COMPARE_TEST_PORT || 3310);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fixture: a real project with two published program versions (differ in exactly 2 fields) ───
const proj = require(path.join(ROOT, "lib", "hub", "project"));
const PROJECT = "cmptest";
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function buildFixtureState() {
  const project = proj.validateProject(
    { id: PROJECT, label: "Compare Test Co", symbol: "CMPT", mint: MINT, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const termsBase = { poolDailyRaw: "1000000000000", sharePct: 5, maxSharePct: 25, maxTermDays: 540, payoutSchedule: "weekly", minDurationDays: 90, fundedBy: [FUND] };
  let state = proj.createVersion({}, project, termsBase, { effectiveFrom: "2026-01-01", todayKey: "2026-01-01" });
  // v2 changes exactly two fields — minDurationDays and payoutSchedule — nothing else.
  const termsV2 = { ...termsBase, minDurationDays: 60, payoutSchedule: "monthly" };
  state = proj.createVersion(state, project, termsV2, { effectiveFrom: "2026-02-01", todayKey: "2026-01-01" });
  const v1 = state.versions[0], v2 = state.versions[1];
  ok("fixture: v1 and v2 differ in exactly minDurationDays and payoutSchedule", (() => {
    const diffKeys = Object.keys(v2.terms).filter((k) => JSON.stringify(v1.terms[k]) !== JSON.stringify(v2.terms[k]));
    return diffKeys.length === 2 && diffKeys.includes("minDurationDays") && diffKeys.includes("payoutSchedule");
  })());
  return {
    v1, v2,
    fixture: {
      "hub:projects": {
        // status:"approved" is required by lib/hub/routes.js's own projectOf() lookup (the
        // GET /api/hub/:project/program/:version route this test drives lives there, not in
        // server.js's looser hubProjects() built object) — an unapproved row is invisible to it.
        [PROJECT]: { id: PROJECT, label: "Compare Test Co", symbol: "CMPT", mint: MINT, decimals: 9, rewardMint: MINT, rewardDecimals: 9, status: "approved" },
      },
      [`program:${PROJECT}:state`]: state,
    },
  };
}

async function main() {
  const { v1, v2, fixture } = buildFixtureState();

  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-compare-test-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(fixture));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }

  console.log(`\nHub compare — what changed between two program versions (CC1) — ${BASE}\n`);
  try {
    console.log("1. GET /api/hub/:project — public versions[] index\n");
    const pv = await fetch(`${BASE}/api/hub/${PROJECT}`).then((r) => r.json());
    ok("200 ok:true", pv.ok === true);
    ok("versions[] has exactly the two published versions, oldest first", Array.isArray(pv.project.versions) && pv.project.versions.length === 2
      && pv.project.versions[0].version === 1 && pv.project.versions[1].version === 2, JSON.stringify(pv.project.versions));
    ok("versions[] never carries `terms` (whitelisted to version/hash/publishedAt)", pv.project.versions.every((v) => !("terms" in v) && !("effectiveTo" in v) && !("commitment" in v)));
    ok("publishedAt is each version's own effectiveFrom", pv.project.versions[0].publishedAt === "2026-01-01" && pv.project.versions[1].publishedAt === "2026-02-01");
    ok("hash matches the version records this test built", pv.project.versions[0].hash === v1.hash && pv.project.versions[1].hash === v2.hash);

    // Cross-check against the schema this repo actually ships.
    const { validate } = require(path.join(ROOT, "lib", "hub", "schema-validate"));
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "hub", "schema", "project-public.schema.json"), "utf8"));
    const errs = validate(schema, pv.project);
    ok("the live body still validates against project-public.schema.json", errs.length === 0, errs.join("; "));

    console.log("\n2. route resolution — the literal path, not a shorter pattern\n");
    const cmpPage = await fetch(`${BASE}/hub/${PROJECT}/programs/compare`);
    const cmpHtml = await cmpPage.text();
    ok("GET /hub/<project>/programs/compare is 200", cmpPage.status === 200, String(cmpPage.status));
    ok("...and serves hub-compare.html, not hub.html (a title only the compare page has)", /Compare program versions/.test(cmpHtml));
    const progPage = await fetch(`${BASE}/hub/${PROJECT}/programs`);
    const progHtml = await progPage.text();
    ok("regression control: GET /hub/<project>/programs (3 segments) still serves the ordinary programs index", progPage.status === 200 && !/Compare program versions/.test(progHtml));

    console.log("\n3-7. rendered page (Playwright)\n");
    const { chromium } = resolvePlaywright();
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(`${BASE}/hub/${PROJECT}/programs/compare`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(400);
      let text = await page.locator("#app").innerText();

      ok("shows both version hashes, matching the API's own hashes", text.includes(v1.hash.slice(0, 16)) && text.includes(v2.hash.slice(0, 16)));
      ok("shows both published dates", text.includes("2026-01-01") && text.includes("2026-02-01"));

      const changedRows = await page.locator("tr.changedRow").count();
      ok("exactly two changed rows render (minDurationDays, payoutSchedule)", changedRows === 2, `got ${changedRows}`);
      ok("the changed rows name the two fields that actually changed", /shortest lock term admitted/i.test(text) && /payout cadence/i.test(text));
      // Collapsed-by-default is checked on the native <details> element's own `open` property
      // (the actual mechanism the page uses), not on rendered geometry: this headless Chromium
      // build does not hide a closed <details>'s content from getBoundingClientRect (verified —
      // it lays it out regardless of `open`), so a pixel-box check would pass even if the
      // collapsing markup were removed entirely. `open` is the real, checkable signal.
      const detailsOpen = () => page.evaluate(() => { const d = document.querySelector("details"); return d ? d.open : null; });
      ok("the unchanged rows are collapsed by default (<details> starts closed)", /unchanged field/i.test(text) && (await detailsOpen()) === false);

      await page.locator("details summary").click();
      await sleep(150);
      ok("clicking the summary opens it", (await detailsOpen()) === true);
      const allRows = await page.locator("table tbody tr").count();
      ok("expanding the toggle reveals every unchanged field too (12 unchanged + 2 changed = 14 term fields total)", allRows === 14, `got ${allRows}`);

      // 4. self-compare is empty
      await page.goto(`${BASE}/hub/${PROJECT}/programs/compare?a=1&b=1`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(400);
      text = await page.locator("#app").innerText();
      ok("comparing v1 with itself: zero changed rows", (await page.locator("tr.changedRow").count()) === 0);
      ok("...and says so in plain words", /no changes between these two versions/i.test(text) || /nothing changed/i.test(text));

      // 6. unknown version is an honest not-found, never a crash or a silent empty diff
      await page.goto(`${BASE}/hub/${PROJECT}/programs/compare?a=1&b=99`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(400);
      text = await page.locator("#app").innerText();
      ok("an unknown version is reported honestly, not silently empty", /no such program version/i.test(text));
      ok("...and never claims 'no changes' for a version it could not load", !/no changes between these two versions/i.test(text));

      // 7. no forbidden word, on the real (2-version) render
      await page.goto(`${BASE}/hub/${PROJECT}/programs/compare`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(400);
      const full = (await page.locator("body").innerText()).toLowerCase();
      ok("no 'verified'/'safe'/'guaranteed' overclaim", !full.includes("verified project") && !/\bsafe\b/.test(full) && !/\bguarantee/.test(full));
      ok("no APR/APY/yield-rate language", !/\bapr\b/.test(full) && !/\bapy\b/.test(full) && !/\byield\b/.test(full));
      ok("no mention of Normie Quest", !full.includes("normie quest"));
      ok("no mention of Wallet Watch", !full.includes("wallet watch"));
      ok("carries the honesty caveat, linking /hub/trust", full.includes("a hash commits to the published terms, not to intent") && (await page.locator("a[href='/hub/trust']").count()) > 0);
    } finally {
      await browser.close();
    }
  } finally {
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
