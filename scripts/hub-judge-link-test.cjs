#!/usr/bin/env node
/*
 * HUB JUDGE — link check (AA4, docs/COLOSSEUM_ROADMAP.md §11). Every URL docs/JUDGE_GUIDE.md
 * tells a judge to open has to actually answer 200 on the exact boot a judge will hit: a
 * no-build checkout (CI's own no-build boot, same as hub-status-test.cjs's page-load check).
 * scripts/hub-judge-doc-test.cjs already proves each URL matches a route SHAPE server.js
 * registers (static, no boot); this script is the live half — it boots the real server with a
 * throwaway DATA_DIR and actually requests every one of them.
 *
 * Usage: node scripts/hub-judge-link-test.cjs [baseUrl]
 * Env:   HUB_JUDGE_LINK_TEST_PORT (default 3268) — used only when baseUrl is omitted (a server
 *        is booted). Ports 3268-3270 are this batch's reserved range (AA4).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "JUDGE_GUIDE.md");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_JUDGE_LINK_TEST_PORT || 3268);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same extraction as scripts/hub-judge-doc-test.cjs's §6 — markdown links and bare inline-code
// paths, kept in sync deliberately (both read the same doc; a change to one URL style should
// still be caught by both the static route-shape check and this live 200 check).
function extractRelativeUrls(doc) {
  const linkTargets = [...doc.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  const inlinePaths = [...doc.matchAll(/`(\/[a-zA-Z0-9_\/:.\-]+)`/g)].map((m) => m[1]);
  return [...new Set([...linkTargets, ...inlinePaths])]
    .filter((p) => p.startsWith("/") && !p.startsWith("//"))
    .map((p) => p.split("#")[0]) // a hash fragment is client-side routing, not part of the request
    .filter(Boolean);
}

async function checkLinks() {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  const urls = extractRelativeUrls(doc);
  console.log(`\nGET every relative URL docs/JUDGE_GUIDE.md names (${urls.length} found), expecting 200\n`);
  ok("at least one relative URL was found", urls.length > 0);
  for (const u of urls) {
    try {
      const r = await fetch(BASE + u);
      ok(`${u} -> 200`, r.status === 200, `got ${r.status}`);
    } catch (e) {
      ok(`${u} -> 200`, false, e.message);
    }
  }
}

(async () => {
  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-judge-link-"));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    // No `npm run build` before this — the whole point is a no-build boot (CLAUDE.md: a file
    // with no app.get route 404s without a build, but every route docs/JUDGE_GUIDE.md names has
    // an explicit route reading public/ or lib/hub/schema/ directly, per server.js).
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  console.log(`\nHub judge guide — link check (AA4) — ${BASE}\n`);
  try {
    await checkLinks();
  } finally {
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
