#!/usr/bin/env node
"use strict";
// Colosseum roadmap §10 Z3 — public-route hygiene: the Hub's newer public read routes get an
// ETag + a Cache-Control tier consistent with the neighbouring Hub reads, the ones that do real
// work per request (reproducibility, batch/inputs, standings, the JVP timeline, the holders
// snapshots series) get a dedicated per-IP rate limit that never touches the light per-page reads
// or the store-edition contract routes, and wallet/sig/mint params are shape-checked BEFORE any
// store read (400, never a 500 or a full scan). Boots the real server with a throwaway key and no
// secrets — the same posture as scripts/mutating-get-guard-test.cjs — so nothing here can reach a
// chain, a wallet, X or Telegram.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.HYGIENE_TEST_PORT || 3225);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hygiene-test-"));
const SERVER_PATH = path.join(__dirname, "..", "server.js");
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real CLKN-mint-shaped base58 address and a well-formed-but-fake 88-char signature — neither
// needs to exist on chain, they only need to pass the SHAPE checks the routes run before a store
// read (the store reads themselves come back empty/404 in this throwaway kv, which is fine; this
// file is about headers/limits/shape, not about the numbers).
const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const GOOD_SIG = "2N7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCju";
const GOOD_WALLET = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const BAD_SHAPE = "not-a-real-shape";

async function req(method, p, { ip, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (ip) h["x-forwarded-for"] = ip;
  // Node's own fetch (undici) sends "Cache-Control: no-cache" on every request unless the caller
  // sets its own — and the `fresh` module Express uses treats a REQUEST Cache-Control:no-cache as
  // an unconditional cache-buster, always answering 200 even on a matching If-None-Match. That is
  // correct per RFC 7234 §5.2.1.4 (end-to-end reload), not a bug in the route: overriding it here
  // is what a real conditional revalidation (a browser's normal cache replay, curl without
  // --no-cache) looks like on the wire.
  if (h["If-None-Match"] && !("Cache-Control" in h)) h["Cache-Control"] = "max-age=0";
  const r = await fetch(BASE + p, { method, headers: h });
  let body = null; try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, headers: r.headers, body };
}

// Every listed route, tagged with the Cache-Control tier Z3 assigns it: 60s per-project reads,
// 300s the reproducibility-class computations/receipts, 3600s schemas + the built bundle.
const ROUTES = [
  { name: "hub reproducibility", path: `/api/hub/clkn/reproducibility`, cache: "public, max-age=300" },
  { name: "hub reproducibility history", path: `/api/hub/clkn/reproducibility/history`, cache: "public, max-age=300" },
  { name: "hub batch/inputs", path: `/api/hub/clkn/batch/nope/inputs`, cache: "public, max-age=60", cors: true },
  { name: "hub buy-comp standings", path: `/api/hub/clkn/p/nope/standings`, cache: "public, max-age=60", cors: true },
  { name: "hub receipt (r/:sig)", path: `/api/hub/clkn/r/${GOOD_SIG}`, cache: "public, max-age=300", cors: true },
  { name: "holders snapshots series", path: `/api/holders/snapshots?mint=${MINT}`, cache: "public, max-age=60" },
  { name: "holders one snapshot", path: `/api/holders/snapshots/nope?mint=${MINT}`, cache: "public, max-age=60" },
  { name: "airdrop drop receipt", path: `/api/airdrop/r/nope`, cache: "public, max-age=60" },
  { name: "airdrop recipient row", path: `/api/airdrop/r/nope/${GOOD_WALLET}`, cache: "public, max-age=60" },
  { name: "jvp project timeline", path: `/api/jvp/project/clkn/timeline`, cache: "public, max-age=60" },
  { name: "hub schema (program-version)", path: `/hub/schema/program-version.json`, cache: "public, max-age=3600" },
  { name: "hub badge.json", path: `/api/hub/badge.json`, cache: "public, max-age=300" },
  { name: "hub badge.svg", path: `/hub/badge.svg`, cache: "public, max-age=300" },
  { name: "hub-demo overview", path: `/api/hub-demo`, cache: "public, max-age=60" },
  { name: "hub-demo project", path: `/api/hub-demo/demo`, cache: "public, max-age=60" },
  // DD2 (Colosseum roadmap §14): the project feed, JSON Feed + RSS — same 300s tier as the
  // reproducibility-class reads above, since a feed walks the same per-batch computation.
  { name: "hub feed.json", path: `/api/hub/clkn/feed.json`, cache: "public, max-age=300" },
  { name: "hub feed.xml", path: `/hub/clkn/feed.xml`, cache: "public, max-age=300" },
];

(async () => {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, ANTHROPIC_API_KEY: "test-not-a-key",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, [SERVER_PATH], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }

  console.log("\nPublic-route hygiene (Colosseum roadmap §10 Z3)\n");

  // ── 1) headers: Cache-Control tier + an ETag on every listed route, and — where the fixture
  // path actually resolves (2xx) — a matching If-None-Match answers a bare 304 that still
  // carries the same Cache-Control. Express's own freshness check (lib/request.js `fresh`) only
  // ever fires for a 2xx (or already-304) response, per RFC 7232 — a 404 legitimately never
  // conditional-GETs to 304, so a route exercised here at its "not found" shape (this is a fresh
  // throwaway kv with nothing seeded) is asserted on headers only, not on the 304 round-trip;
  // the mechanism itself is Express-wide and is proven end to end on every route below that DOES
  // come back 200 in this environment. ───────────────────────────────────────────────────────
  console.log("Cache-Control + ETag + conditional 304\n");
  for (const r of ROUTES) {
    const first = await req("GET", r.path, { ip: "10.0.1.1" });
    ok(`${r.name}: Cache-Control is "${r.cache}"`, first.headers.get("cache-control") === r.cache,
      `got "${first.headers.get("cache-control")}" (status ${first.status})`);
    const etag = first.headers.get("etag");
    ok(`${r.name}: carries an ETag`, !!etag, `status ${first.status}, headers: ${JSON.stringify([...first.headers.keys()])}`);
    if (r.cors) ok(`${r.name}: carries Access-Control-Allow-Origin: *`, first.headers.get("access-control-allow-origin") === "*", String(first.headers.get("access-control-allow-origin")));
    if (etag && first.status >= 200 && first.status < 300) {
      const second = await req("GET", r.path, { ip: "10.0.1.1", headers: { "If-None-Match": etag } });
      ok(`${r.name}: a matching If-None-Match answers 304`, second.status === 304, String(second.status));
      ok(`${r.name}: the 304 still carries Cache-Control`, second.headers.get("cache-control") === r.cache, String(second.headers.get("cache-control")));
    } else if (etag) {
      console.log(`  · ${r.name}: fixture path is ${first.status} in a fresh store — 304 round-trip not exercised here (see comment above)`);
    }
  }

  // The built hub-verify bundle only exists after `npm run build:hubverify` — the workflow step
  // running this test builds it first (same idiom as scripts/hub-verify-page-test.cjs). Skip
  // cleanly rather than fail if a local run hasn't built it.
  {
    const r = await req("GET", "/hub-verify.bundle.js", { ip: "10.0.1.1" });
    if (r.status === 404) {
      console.log("  · hub-verify.bundle.js not built locally — run `npm run build:hubverify` first (skipped, CI builds it)");
    } else {
      ok("hub-verify.bundle.js: Cache-Control is \"public, max-age=3600\"", (await fetch(BASE + "/hub-verify.bundle.js")).headers.get("cache-control") === "public, max-age=3600");
      const first = await fetch(BASE + "/hub-verify.bundle.js");
      const etag = first.headers.get("etag");
      ok("hub-verify.bundle.js: carries an ETag (sendFile's own)", !!etag);
      if (etag) {
        const second = await fetch(BASE + "/hub-verify.bundle.js", { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } });
        ok("hub-verify.bundle.js: a matching If-None-Match answers 304", second.status === 304, String(second.status));
      }
    }
  }

  // ── 2) shape validation: wallet/sig/mint 400 BEFORE any store read, never a 500 or a scan. ────
  console.log("\nParam shape validation (400, never a 500 or a full scan)\n");
  {
    let r = await req("GET", `/api/hub/clkn/r/${BAD_SHAPE}`, { ip: "10.0.2.1" });
    ok("bad-shape sig on r/:sig is 400 (never handed to a scan)", r.status === 400 && /bad sig/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
    r = await req("GET", `/api/hub/clkn/batch/nope/inputs?wallet=${BAD_SHAPE}`, { ip: "10.0.2.1" });
    ok("bad-shape ?wallet= on batch/inputs is 400 (before the batch lookup)", r.status === 400 && /bad wallet/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
    r = await req("GET", `/api/airdrop/r/nope/${BAD_SHAPE}`, { ip: "10.0.2.1" });
    ok("bad-shape :wallet on airdrop recipient row is 400 (before loading the drop)", r.status === 400 && /bad wallet/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
    r = await req("GET", `/api/holders/snapshots?mint=${BAD_SHAPE}`, { ip: "10.0.2.1" });
    ok("bad-shape ?mint= on holders/snapshots is 400", r.status === 400 && /bad mint/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
    r = await req("GET", `/api/holders/snapshots/nope?mint=${BAD_SHAPE}`, { ip: "10.0.2.1" });
    ok("bad-shape ?mint= on holders/snapshots/:id is 400", r.status === 400 && /bad mint/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
    // A well-formed sig/wallet/mint that simply doesn't exist is a 404, never a 400 or a 500 —
    // the shape check is a gate, not a stand-in for the real lookup.
    r = await req("GET", `/api/hub/clkn/r/${GOOD_SIG}`, { ip: "10.0.2.1" });
    ok("well-formed but unknown sig is 404, not 400/500", r.status === 404, String(r.status));
    // DD2: a demo project (never actually registered) 404s on both feed routes, same as every
    // other real Hub read.
    r = await req("GET", `/api/hub/demo/feed.json`, { ip: "10.0.2.1" });
    ok("demo project 404s on feed.json", r.status === 404, String(r.status));
    r = await req("GET", `/hub/demo/feed.xml`, { ip: "10.0.2.1" });
    ok("demo project 404s on feed.xml", r.status === 404, String(r.status));
  }

  // ── 3) hours cap (jvp timeline): already 1..720 in code — pin it so it can't regress. ─────────
  console.log("\nParam caps\n");
  {
    let r = await req("GET", `/api/jvp/project/clkn/timeline?hours=999999`, { ip: "10.0.2.2" });
    ok("hours= is clamped to 720", r.status === 200 && r.body && r.body.hours === 720, JSON.stringify(r.body).slice(0, 160));
    r = await req("GET", `/api/jvp/project/clkn/timeline?hours=-5`, { ip: "10.0.2.2" });
    ok("hours= is floored to 1", r.status === 200 && r.body && r.body.hours === 1, JSON.stringify(r.body).slice(0, 160));
  }

  // ── 4) rate limiting: a burst on a heavy route 429s, the bucket is shared across the heavy
  // routes (one dedicated bucket — P1-03 (2026-09-18) folded /api/hub, /api/hub/:project and
  // /api/hub/wallet/:wallet into it too, since each did the same unbounded per-project walk with
  // no limiter), a genuinely light read (a single receipt) on the SAME ip is unaffected, the
  // `/hub/:project` HTML share page is unaffected (cached, not limited — see below), and a heavy
  // route from a DIFFERENT ip is unaffected (per-IP, not global). ───────────────────────────────
  console.log("\nRate limiting (heavy routes only, per-IP, never the light reads)\n");
  {
    const BURST_IP = "10.0.9.9";
    const OTHER_IP = "10.0.9.10";
    let last = null;
    for (let i = 0; i < 60; i++) last = await req("GET", `/api/hub/clkn/reproducibility`, { ip: BURST_IP });
    ok("60 requests to a heavy route all go through", last.status !== 429, `last status ${last.status}`);
    const over = await req("GET", `/api/hub/clkn/reproducibility`, { ip: BURST_IP });
    ok("the 61st request from the same IP is 429", over.status === 429, JSON.stringify(over.body));
    ok("the 429 body carries retryAfter", Number(over.body && over.body.retryAfter) > 0, JSON.stringify(over.body));
    ok("the 429 carries a Retry-After header", Number(over.headers.get("retry-after")) > 0, String(over.headers.get("retry-after")));

    // Shared bucket: the same IP is already over budget on a DIFFERENT heavy route.
    const otherHeavy = await req("GET", `/api/hub/clkn/p/nope/standings`, { ip: BURST_IP });
    ok("the same IP is also refused on a different heavy route (one shared bucket)", otherHeavy.status === 429, String(otherHeavy.status));
    ok("…and a route that answers with CORS still carries it on the 429", otherHeavy.headers.get("access-control-allow-origin") === "*", String(otherHeavy.headers.get("access-control-allow-origin")));
    // CC4's history route shares the same bucket as its sibling reproducibility route.
    const historyHeavy = await req("GET", `/api/hub/clkn/reproducibility/history`, { ip: BURST_IP });
    ok("the reproducibility history route is on the same shared bucket too", historyHeavy.status === 429, String(historyHeavy.status));
    // DD2's two feed routes share the same bucket too.
    const feedJsonHeavy = await req("GET", `/api/hub/clkn/feed.json`, { ip: BURST_IP });
    ok("feed.json is on the same shared bucket too", feedJsonHeavy.status === 429, String(feedJsonHeavy.status));
    const feedXmlHeavy = await req("GET", `/hub/clkn/feed.xml`, { ip: BURST_IP });
    ok("feed.xml is on the same shared bucket too", feedXmlHeavy.status === 429, String(feedXmlHeavy.status));

    // P1-03 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): /api/hub, /api/hub/:project and
    // /api/hub/wallet/:wallet each call hubProjectView() once per registered project with no
    // limiter of their own — ten concurrent hits measured the event loop pinned for ~10s. They
    // now share the SAME "hubheavy" bucket as the routes above, so the IP already exhausted above
    // is refused on these too — they are no longer "light".
    const hubIndexHeavy = await req("GET", `/api/hub`, { ip: BURST_IP });
    ok("P1-03: /api/hub now shares the heavy bucket too (was unlimited)", hubIndexHeavy.status === 429, String(hubIndexHeavy.status));
    const hubProjectHeavy = await req("GET", `/api/hub/clkn`, { ip: BURST_IP });
    ok("P1-03: /api/hub/:project now shares the heavy bucket too (was unlimited)", hubProjectHeavy.status === 429, String(hubProjectHeavy.status));
    const hubWalletHeavy = await req("GET", `/api/hub/wallet/${GOOD_WALLET}`, { ip: BURST_IP });
    ok("P1-03: /api/hub/wallet/:wallet now shares the heavy bucket too (was unlimited)", hubWalletHeavy.status === 429, String(hubWalletHeavy.status));

    // A single receipt lookup (r/:sig) stays genuinely light — never folded into this bucket.
    const lightReceipt = await req("GET", `/api/hub/clkn/r/${GOOD_SIG}`, { ip: BURST_IP });
    ok("…and a single receipt (r/:sig) is unaffected — never rate-limited", lightReceipt.status !== 429, String(lightReceipt.status));

    // P1-03: the `/hub/:project` HTML share page runs the SAME hubOgFor()->hubProjectView() walk
    // on every hit purely to fill in <meta> tags for a link-unfurl crawler, but it must always
    // render 200 for a person clicking a shared link — never 429 them — so it got a 60s per-project
    // cache (hubOgForCached) instead of a limiter. Confirm it stays unaffected even on the IP
    // that just exhausted the API-side bucket above, and still returns real HTML.
    const sharePage = await req("GET", `/hub/clkn`, { ip: BURST_IP });
    ok("P1-03: the /hub/:project share page is cached, not limited — still 200 on the exhausted IP", sharePage.status === 200, String(sharePage.status));

    // Per-IP, not global: a DIFFERENT ip on the exhausted heavy route still goes through.
    const otherIp = await req("GET", `/api/hub/clkn/reproducibility`, { ip: OTHER_IP });
    ok("a different IP on the same heavy route is unaffected (per-IP, not global)", otherIp.status !== 429, String(otherIp.status));
    // ...and the newly-limited routes are equally per-IP, not global.
    const otherIpHubIndex = await req("GET", `/api/hub`, { ip: OTHER_IP });
    ok("P1-03: a different IP on /api/hub is unaffected too (per-IP, not global)", otherIpHubIndex.status !== 429, String(otherIpHubIndex.status));
  }

  // ── 5) no store-edition contract route was ever wired into the heavy limiter. ──────────────────
  console.log("\nStore-edition contract routes never gained a limiter\n");
  {
    const src = fs.readFileSync(SERVER_PATH, "utf8");
    const storeMatch = src.match(/const STORE_API_RE = (\/\^[^\n]*\$\/);/);
    ok("STORE_API_RE is still findable in server.js (keep this test in sync if it moves)", !!storeMatch);
    const STORE_API_RE = storeMatch ? eval(storeMatch[1]) : /$^/;   // eslint-disable-line no-eval -- test-only, source-scanned right above
    const heavyPaths = [...src.matchAll(/app\.get\("([^"]+)",\s*rateLimit\("hubheavy"/g)].map((m) => m[1]);
    // AA2 (docs/COLOSSEUM_ROADMAP.md §11) added the evidence-bundle route to this same bucket —
    // it walks the same batch the /inputs route above it does, so it belongs on the same limiter.
    // BB3 added the two badge routes (they walk every ledger). CC4 added the reproducibility
    // history route (§13) — a read of stored rows, cheap, but the same class as its sibling on
    // the line right above it, and there is no established light tier to break new ground with.
    // DD2 (§14) added the two feed routes (feed.json + feed.xml) — each walks the same per-batch
    // reproducibility computation the badge/reproducibility routes already share this bucket for.
    // P1-03 (2026-09-18 fix round) added /api/hub, /api/hub/:project and /api/hub/wallet/:wallet —
    // each called hubProjectView() once per registered project with no limiter at all. The
    // `/hub/:project` HTML share page is NOT in this list on purpose — it got a 60s OG-meta cache
    // instead (hubOgForCached), so a person clicking a shared link is never 429'd; see the
    // dedicated assertions in section 4 above.
    // 5 original + bundle + 2 badges + 1 history + 2 feed + 3 (P1-03) = 14.
    ok("found the 14 heavy routes wired to the dedicated limiter", heavyPaths.length === 14, JSON.stringify(heavyPaths));
    for (const p of heavyPaths) ok(`${p} is not a store-edition contract route`, !STORE_API_RE.test(p), p);

    // Live confirmation for one representative store-edition route: a burst well under its own
    // per-route cap (POST /api/track is 120/min) is never touched by the "hubheavy" bucket even
    // from the same IP that just got 429'd above.
    const BURST_IP = "10.0.9.9";
    let allOk = true;
    for (let i = 0; i < 20; i++) {
      const r = await req("GET", "/api/track", { ip: BURST_IP });
      if (r.status === 429) { allOk = false; break; }
    }
    ok("a store-edition route (/api/track) on the exhausted heavy-bucket IP is untouched", allOk);
  }

  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
