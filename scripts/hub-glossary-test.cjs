#!/usr/bin/env node
"use strict";
// Colosseum roadmap EE2 — lib/hub/glossary.js is the one source of truth for every term and
// reason code a public Hub surface renders. This pins three things:
//
//   (a) DRIFT: every reason code emitted by the modules that actually produce them
//       (lib/hub/eligibility.js's REASON_CODES + its "other"/no_program literals,
//       lib/hub/access.js + lib/hub/access-pay.js's access-gate reasons, lib/buycomp-payout.js's
//       settlement-void reasons, lib/hub/public.js's hold-through/review-status literals) has a
//       glossary entry — and every entry's optional lessonId resolves against the real
//       curriculum (same C4 discipline as scripts/hub-teach-test.cjs).
//   (b) ROUTE: GET /api/hub/glossary serves the entries with a long public cache, and
//       GET /hub/glossary serves the page — both registered ahead of the generic
//       /api/hub/:project and /hub/:project catch-alls.
//   (c) RENDER (Chromium, skipped gracefully when playwright-core is not resolvable — same
//       posture as scripts/reproducibility-history-test.cjs): the page renders its entries, an
//       anchor scrolls to its section, the search box filters, and none of the forbidden words
//       (verified/safe/guaranteed/APR/APY/yield, Normie Quest, Wallet Watch) ever appear.
//
// Usage: node scripts/hub-glossary-test.cjs [baseUrl]
// Env:   HUB_GLOSSARY_TEST_PORT (default 3226) — used only when baseUrl is omitted.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, "..");

// ════════════════════════════════════════════════════════════════════════════════════════════
// (a) drift — every reason code a source module emits has a glossary entry
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n(a) drift — every emitted reason code has a glossary entry\n");

const glossary = require(path.join(ROOT, "lib", "hub", "glossary"));
const { REASON_CODES } = require(path.join(ROOT, "lib", "hub", "eligibility"));
const curriculum = require(path.join(ROOT, "lib", "curriculum"));

const entries = glossary.entries();
const byId = new Map(entries.map((e) => [e.id, e]));
const reasonIds = new Set(glossary.reasonIds());

ok("glossary has entries at all", entries.length > 30, String(entries.length));
ok("every entry id is unique", entries.length === new Set(entries.map((e) => e.id)).size);
for (const e of entries) {
  ok(`entry "${e.id}" has a kind of "term" or "reason"`, e.kind === "term" || e.kind === "reason");
  ok(`entry "${e.id}" has a non-empty definition`, typeof e.definition === "string" && e.definition.length > 10);
  ok(`entry "${e.id}" has a usedOn array`, Array.isArray(e.usedOn));
}

// eligibility.js's own codes — the primary "wallet exclusion reason" vocabulary.
for (const [, code] of REASON_CODES) {
  ok(`eligibility.js REASON_CODES code "${code}" has a glossary entry`, reasonIds.has(code));
}
ok('codeFor()\'s fallback "other" has a glossary entry', reasonIds.has("other"));
// lib/hub/routes.js's own literal, used when no program version is in force at all.
const routesSrc = fs.readFileSync(path.join(ROOT, "lib", "hub", "routes.js"), "utf8");
ok('routes.js\'s literal code: "no_program" has a glossary entry', /code:\s*"no_program"/.test(routesSrc) && reasonIds.has("no_program"));

// lib/hub/access.js + lib/hub/access-pay.js — every `reason: "snake_case"` literal (the pattern
// the public surfaces use: a lowercase-with-underscores identifier, never a free-text sentence).
const REASON_LITERAL_RE = /\breason:\s*"([a-z][a-z0-9_]*)"/g;
for (const rel of ["lib/hub/access.js", "lib/hub/access-pay.js"]) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const found = new Set();
  let m; while ((m = REASON_LITERAL_RE.exec(src))) found.add(m[1]);
  ok(`${rel} has at least one reason literal (the scan itself is alive)`, found.size > 0, [...found].join(", "));
  for (const code of found) ok(`${rel}'s reason "${code}" has a glossary entry`, reasonIds.has(code), `found in ${rel}, not in glossary`);
}

// lib/buycomp-payout.js — voidSent's own reasons, rendered verbatim as the void pill on
// public/hub.html (v.reason).
{
  const src = fs.readFileSync(path.join(ROOT, "lib", "buycomp-payout.js"), "utf8");
  const found = new Set();
  let m; const re = /\breason:\s*"([a-z][a-z0-9_]*)"/g;
  while ((m = re.exec(src))) found.add(m[1]);
  ok("lib/buycomp-payout.js has at least one void reason literal", found.size > 0, [...found].join(", "));
  for (const code of found) ok(`lib/buycomp-payout.js's reason "${code}" has a glossary entry`, reasonIds.has(code));
}

// lib/hub/public.js — holdThroughOf()'s own literals + the two raw review statuses it falls back
// to (dq/manual), matched narrowly (this function's own return-value shape) so an unrelated
// quoted string elsewhere in the file can't false-positive this check.
{
  const src = fs.readFileSync(path.join(ROOT, "lib", "hub", "public.js"), "utf8");
  const fnMatch = src.match(/function holdThroughOf\(r\) \{([\s\S]*?)\n\}/);
  ok("public.js still defines holdThroughOf() (the scan itself is alive)", !!fnMatch);
  const holdThroughCodes = ["sold", "moved-out", "locked-not-a-sell", "unverified"];
  for (const code of holdThroughCodes) {
    ok(`public.js's holdThroughOf() literal "${code}" is still there`, fnMatch && fnMatch[1].includes(`"${code}"`));
    ok(`holdThroughOf() code "${code}" has a glossary entry`, reasonIds.has(code));
  }
  for (const code of ["dq", "manual"]) ok(`the raw review status "${code}" has a glossary entry`, reasonIds.has(code));
}

// lessonId discipline — same C4 guard as scripts/hub-teach-test.cjs's lesson-map check.
{
  const lessonIds = curriculum.lessonIds();
  ok("could not extract LESSONS ids", Array.isArray(lessonIds) && lessonIds.length > 10);
  for (const e of entries) {
    if (e.lessonId) ok(`entry "${e.id}"'s lessonId "${e.lessonId}" is a real lesson`, lessonIds.includes(e.lessonId));
    if (e.lesson) ok(`entry "${e.id}"'s lesson.href starts with /school#lesson=`, typeof e.lesson.href === "string" && e.lesson.href.startsWith("/school#lesson="));
  }
}

// honesty rules — no rate language, no forbidden words, nothing about Normie Quest or Wallet
// Watch, anywhere in the module's own output (mirrors lib/hub/teach.js's allText() guard).
{
  const T = require(path.join(ROOT, "lib", "hub", "teach"));
  const FORBIDDEN = /\b(verified|safe|guaranteed|apr|apy|yield)\b/i;
  for (const e of entries) {
    const all = e.term + " " + e.definition;
    ok(`entry "${e.id}" carries no rate language`, !T.containsRateLanguage(all));
    ok(`entry "${e.id}" carries no forbidden word`, !FORBIDDEN.test(all), all);
    ok(`entry "${e.id}" never mentions Normie Quest or Wallet Watch`, !/normie quest|wallet watch/i.test(all));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (b) route — a real server, both routes, ahead of their catch-alls
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n(b) route — GET /api/hub/glossary and GET /hub/glossary\n");

const PORT = Number(process.env.HUB_GLOSSARY_TEST_PORT || 3226);
const BASE = process.argv[2] || `http://127.0.0.1:${PORT}`;
const bootedHere = !process.argv[2];
const DIR = bootedHere ? fs.mkdtempSync(path.join(os.tmpdir(), "hub-glossary-test-")) : null;
let srv = null;
const cleanup = () => { if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} } if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} } };
process.on("exit", cleanup);

(async () => {
  if (bootedHere) {
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    ok("server came up", up);
    if (!up) { finish(); return; }
  }

  const api = await fetch(`${BASE}/api/hub/glossary`);
  ok("GET /api/hub/glossary is 200", api.status === 200, String(api.status));
  ok("Cache-Control is public, max-age=3600", api.headers.get("cache-control") === "public, max-age=3600", api.headers.get("cache-control"));
  let apiBody = null; try { apiBody = await api.json(); } catch (_) {}
  ok("ok:true", !!(apiBody && apiBody.ok));
  ok("entries is a non-empty array served, not a ledger walk (no project scan)", Array.isArray(apiBody && apiBody.entries) && apiBody.entries.length > 30, JSON.stringify(apiBody && apiBody.entries && apiBody.entries.length));
  ok("a known reason code round-trips (below_min_lock)", !!(apiBody && apiBody.entries.some((e) => e.id === "below_min_lock")));

  const page = await fetch(`${BASE}/hub/glossary`);
  ok("GET /hub/glossary is 200 (registered ahead of /hub/:project)", page.status === 200, String(page.status));
  const pageBody = await page.text();
  ok("the page is the glossary page, not hub.html's generic project shell", /The Hub Glossary/.test(pageBody));

  // route ordering: "glossary" must never be read as a project id by the generic catch-alls.
  const asProject = await fetch(`${BASE}/api/hub/glossary`).then((r) => r.json()).catch(() => null);
  ok('"/api/hub/glossary" never falls through to the :project 404/lookup path', !!(asProject && asProject.ok === true && Array.isArray(asProject.entries)));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (c) render — Chromium, skipped gracefully when playwright-core is not resolvable
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(c) render (Chromium)\n");
  const pw = resolvePlaywright();
  if (!pw) {
    console.log("  · playwright-core not resolvable — skipping the rendered-page check (everything above still ran)");
  } else {
    const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await p.goto(`${BASE}/hub/glossary`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(300);
      const bodyText = await p.locator("body").innerText();
      ok("the page rendered at least one entry", /below_min_lock|Fixed daily pool/i.test(bodyText));
      // A real (non-illustrative) reason id from this build — a hypothetical id (e.g.
      // "amount_mismatch") does not exist in this codebase and would only prove the anchor
      // silently no-ops on an unknown fragment, which is not what this check is for.
      await p.goto(`${BASE}/hub/glossary#below_min_lock`, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(400);
      const target = p.locator("#below_min_lock");
      ok("the deep-linked entry exists in the DOM", (await target.count()) > 0);
      if (await target.count()) {
        const box = await target.boundingBox();
        ok("the deep-linked entry scrolled into (or near) view", !!box && box.y < 900, JSON.stringify(box));
      }
      // search filters
      const search = p.locator("#searchIn");
      await search.fill("below_min_lock");
      await sleep(200);
      const filteredText = await p.locator("#result").innerText();
      ok("searching a known id narrows the list to it", filteredText.includes("below_min_lock"));
      ok("searching a known id filters OUT unrelated entries", !filteredText.includes("Fixed daily pool"), filteredText.slice(0, 200));
      await search.fill("zzzzz-not-a-real-term-zzzzz");
      await sleep(200);
      const emptyText = await p.locator("#result").innerText();
      ok("an unmatched search shows the no-match message", /No terms or reason codes match/i.test(emptyText));
      // forbidden words never render
      await search.fill("");
      await sleep(200);
      const fullText = await p.locator("body").innerText();
      const FORBIDDEN = ["verified", "safe", "guaranteed", "apr", "apy", "yield"];
      for (const w of FORBIDDEN) ok(`rendered page carries no whole-word "${w}"`, !new RegExp("\\b" + w + "\\b", "i").test(fullText));
      ok("rendered page never mentions Normie Quest", !/normie quest/i.test(fullText));
      ok("rendered page never mentions Wallet Watch", !/wallet watch/i.test(fullText));
    } finally {
      await browser.close();
    }
  }

  finish();
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); cleanup(); process.exit(1); });

function resolvePlaywright() {
  const candidates = [
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(__dirname, "..", "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  return null;
}

function finish() {
  cleanup();
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
}
