#!/usr/bin/env node
/*
 * HUB LOAD SMOKE — Colosseum roadmap §15 EE3 ("Load proof for the public reads").
 *
 * Boots the real server.js against a fixture built by scripts/hub-load-fixture.cjs, then drives
 * every "heavy" Hub public read named in the roadmap item — reproducibility, reproducibility
 * history, buy-comp standings, the evidence bundle, the badge, the JSON/RSS feeds, and the
 * cross-project wallet roll-up, plus the three plain reads P1-03 flagged as carrying NO rate
 * limiter today (`/api/hub`, `/api/hub/:project`, the `/hub/:project` share page) — and reports,
 * per route:
 *   - a COLD request (first ever hit for that route+IP in this run)
 *   - a WARM request (repeat, right after) — cold-vs-warm ratio is the "served from cache?" signal
 *   - a BURST of `--burst` (default 70) parallel requests from one synthetic IP, at/over the
 *     `hubheavy` ceiling (60/min) — p50/p95 latency over the successful responses, and the count
 *     of 429s (a 429 is "the limiter refused it", never a failure of this script)
 * Each route is driven from its OWN synthetic `CF-Connecting-IP` (server.js's `clientIp()` reads
 * that header first — the same header Cloudflare injects in production) so eleven routes' worth
 * of cold+warm+burst traffic against the SAME box does not exhaust the generic 150/min `/api/`
 * cap for each other and confound the per-route measurement with an unrelated global 429.
 *
 * Concurrently, for the WHOLE run, this polls `/healthz` every 100ms and reports the worst
 * latency observed — the exact P1-03 number (`/healthz` 0.8ms idle -> 9.8s under 10 concurrent
 * wallet look-ups on the adversarial fixture). A route with no rate limiter and O(registry) cost
 * per call is expected to move this number; a limited/cached one should not.
 *
 * This script does not change, and must not assume anything about, whether any route carries a
 * rate limiter or a cache today — a concurrent fix round (DD5/P1-03) may add `rateLimit("hubheavy",
 * …)` and a per-project memoisation to the three unlimited routes while this exists; the script
 * reports whatever it measures either way.
 *
 * Usage: node scripts/hub-load-smoke.cjs [baseUrl] [--budget-ms N] [--healthz-ms N] [--burst N]
 *                                        [--fixture-dir DIR] [--out FILE]
 * Env:   HUB_LOAD_TEST_PORT (default 3420) — used only when baseUrl is omitted (a server is
 *        booted). HUB_LOAD_FIXTURE_DIR overrides --fixture-dir's default, which is the same
 *        fixed path scripts/hub-load-fixture.cjs defaults its own --out to.
 * Exit:  non-zero if any route's burst p95 exceeds --budget-ms, or the /healthz max exceeds
 *        --healthz-ms.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return def;
  return process.argv[i + 1];
}
const ROOT = path.join(__dirname, "..");
const ARG_BASE = process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_LOAD_TEST_PORT || 3420);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;
const BUDGET_MS = Number(arg("budget-ms", "500"));
const HEALTHZ_BUDGET_MS = Number(arg("healthz-ms", "250"));
const BURST_N = Math.max(1, parseInt(arg("burst", "70"), 10) || 70);
const FIXTURE_DIR = arg("fixture-dir", process.env.HUB_LOAD_FIXTURE_DIR || path.join(os.tmpdir(), "hub-load-fixture"));
const OUT_FILE = arg("out", null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

async function timedFetch(url, { headers } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers });
    // Drain the body — a route's real cost includes serialising it, and an undrained body can
    // leave the connection half-read under Node's fetch, skewing later requests on the same run.
    await r.arrayBuffer().catch(() => {});
    return { status: r.status, ms: Date.now() - t0, error: null };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String((e && e.message) || e) };
  }
}

// ── /healthz prober — runs for the whole test, independent of any one route's burst ────────────
function startHealthzProber(base) {
  let max = 0, samples = 0, failures = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const r = await timedFetch(`${base}/healthz`);
    samples++;
    if (r.error || r.status !== 200) failures++;
    else if (r.ms > max) max = r.ms;
    if (!stopped) setTimeout(tick, 100);
  };
  tick();
  return { stop: () => { stopped = true; }, max: () => max, samples: () => samples, failures: () => failures };
}

async function driveRoute(base, route) {
  const headers = { "cf-connecting-ip": route.ip };
  const cold = await timedFetch(`${base}${route.path}`, { headers });
  const warm = await timedFetch(`${base}${route.path}`, { headers });
  const burstResults = await Promise.all(
    Array.from({ length: BURST_N }, () => timedFetch(`${base}${route.path}`, { headers }))
  );
  const count429 = burstResults.filter((r) => r.status === 429).length;
  const errors = burstResults.filter((r) => r.error).length;
  const successMs = burstResults.filter((r) => r.status !== 429 && !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const p50 = percentile(successMs, 0.5);
  const p95 = percentile(successMs, 0.95);
  const cacheRatio = cold.ms > 0 ? warm.ms / cold.ms : null;
  return {
    name: route.name, path: route.path,
    coldMs: cold.ms, coldStatus: cold.status,
    warmMs: warm.ms, warmStatus: warm.status,
    cacheRatio, servedFromCache: cacheRatio != null && cacheRatio < 0.5,
    p50, p95, count429, errors, burstN: BURST_N,
    successCount: successMs.length,
  };
}

function fmtMs(v) { return v == null ? "n/a" : `${v}`; }

function buildRoutes(manifest) {
  const p = manifest.projects[0];
  const wallet = manifest.crossWallet;
  const batchId = p.batchIds[0];
  let ipCounter = 1;
  const nextIp = () => `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  return [
    // The three routes P1-03 names as carrying NO rate limiter today, plus the share page.
    { name: "GET /api/hub (list)", path: `/api/hub`, ip: nextIp() },
    { name: "GET /api/hub/wallet/:wallet", path: `/api/hub/wallet/${wallet}`, ip: nextIp() },
    { name: "GET /api/hub/:project", path: `/api/hub/${p.id}`, ip: nextIp() },
    { name: "GET /hub/:project (share page)", path: `/hub/${p.id}`, ip: nextIp() },
    // Already `rateLimit("hubheavy", …)`-gated as of the DD5 batch this fixture was built next to.
    { name: "GET /api/hub/:project/reproducibility", path: `/api/hub/${p.id}/reproducibility`, ip: nextIp() },
    { name: "GET /api/hub/:project/reproducibility/history", path: `/api/hub/${p.id}/reproducibility/history`, ip: nextIp() },
    { name: "GET /api/hub/:project/p/:compId/standings", path: `/api/hub/${p.id}/p/no-such-comp/standings`, ip: nextIp() },
    { name: "GET /api/hub/:project/batch/:batchId/bundle", path: `/api/hub/${p.id}/batch/${batchId}/bundle`, ip: nextIp() },
    { name: "GET /api/hub/badge.json", path: `/api/hub/badge.json?project=${p.id}`, ip: nextIp() },
    { name: "GET /api/hub/:project/feed.json", path: `/api/hub/${p.id}/feed.json`, ip: nextIp() },
    { name: "GET /hub/:project/feed.xml", path: `/hub/${p.id}/feed.xml`, ip: nextIp() },
  ];
}

function toMarkdown(rows, meta) {
  const lines = [];
  lines.push(`# Hub load smoke — ${meta.when}`);
  lines.push("");
  lines.push(`Fixture: ${meta.fixtureSummary}`);
  lines.push(`Burst size: ${BURST_N} parallel requests/route, one synthetic IP per route.`);
  lines.push(`Budgets: warm-burst p95 <= ${BUDGET_MS}ms, /healthz max <= ${HEALTHZ_BUDGET_MS}ms.`);
  lines.push("");
  lines.push("| Route | Cold (ms) | Warm (ms) | Cache? | Burst p50 (ms) | Burst p95 (ms) | 429s | Errors | Over budget? |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const over = r.p95 != null && r.p95 > BUDGET_MS;
    lines.push(`| ${r.name} | ${fmtMs(r.coldMs)} (${r.coldStatus}) | ${fmtMs(r.warmMs)} (${r.warmStatus}) | ${r.servedFromCache ? "yes" : "no"} | ${fmtMs(r.p50)} | ${fmtMs(r.p95)} | ${r.count429} | ${r.errors} | ${over ? "**YES**" : "no"} |`);
  }
  lines.push("");
  lines.push(`\`/healthz\` max latency observed during the run: **${meta.healthzMax}ms** (${meta.healthzSamples} samples, ${meta.healthzFailures} failed) — budget ${HEALTHZ_BUDGET_MS}ms.`);
  lines.push("");
  lines.push(meta.verdict);
  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(path.join(FIXTURE_DIR, "manifest.json"))) {
    console.error(`no fixture at ${FIXTURE_DIR} — run: node scripts/hub-load-fixture.cjs --out ${FIXTURE_DIR}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8"));

  let srv = null;
  if (!ARG_BASE) {
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: FIXTURE_DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }

  const prober = startHealthzProber(BASE);
  const routes = buildRoutes(manifest);
  const rows = [];
  for (const route of routes) {
    console.log(`driving ${route.name} ...`);
    rows.push(await driveRoute(BASE, route));
  }
  await sleep(150); // let the last burst's healthz probes land
  prober.stop();

  if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }

  const healthzMax = prober.max();
  const budgetFails = rows.filter((r) => r.p95 != null && r.p95 > BUDGET_MS);
  const healthzFail = healthzMax > HEALTHZ_BUDGET_MS;
  const verdict = (budgetFails.length === 0 && !healthzFail)
    ? "**PASS** — every route's warm-burst p95 is within budget and /healthz stayed responsive throughout."
    : `**FAIL** — ${budgetFails.length} route(s) over the ${BUDGET_MS}ms p95 budget${healthzFail ? `, and /healthz exceeded its ${HEALTHZ_BUDGET_MS}ms budget` : ""}.`;

  const md = toMarkdown(rows, {
    when: new Date().toISOString(),
    fixtureSummary: `${manifest.projectsRequested} projects requested, ${manifest.totalReceipts} receipts, seed ${manifest.seed} (${FIXTURE_DIR})`,
    healthzMax, healthzSamples: prober.samples(), healthzFailures: prober.failures(),
    verdict,
  });
  console.log("\n" + md + "\n");
  if (OUT_FILE) fs.writeFileSync(OUT_FILE, md + "\n");

  process.exit(budgetFails.length === 0 && !healthzFail ? 0 : 1);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
