#!/usr/bin/env node
// Seeker app ↔ backend: CORS for every endpoint the app actually calls.
//
// The Seeker bundle runs from a webview origin (https://localhost on Android, capacitor://localhost
// on iOS) and calls the live backend cross-origin. A browser test of the same code proves NOTHING
// about that: CORS is enforced by the webview, and a missing Access-Control-Allow-Origin turns a
// perfectly good 200 into "Could not reach the pass service" (owner's phone, 2026-09-22 — the pass
// sheet; 15 of the 23 endpoints the app calls had no CORS for its origin, every POST and every
// x-clkn-pass GET would have failed the same way).
//
// Two halves, both needed:
//   (1) STATIC — derive the app's endpoint inventory from src/seeker (every "/api/…" literal a
//       fetch is built from) and refuse any path that neither STORE_API_RE nor SEEKER_API_RE in
//       server.js covers. A new pane that calls a new endpoint fails HERE, not on the phone.
//   (2) LIVE — boot server.js and, for every inventoried path, send the preflight the webview
//       sends (OPTIONS from the app origin with content-type + x-clkn-pass) and a plain GET with
//       the origin: 204 + the origin echoed + x-clkn-pass allowed where the app sends it. Also:
//       a foreign origin is never echoed; the store-edition UA is still refused on a Seeker-only
//       endpoint (403) WITH the CORS headers, so that app reads the refusal.
//
// Usage: node scripts/seeker-cors-test.cjs     (boots its own server on 4491)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

// ---- (1) static -----------------------------------------------------------------------------
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
}
function seekerInventory() {
  const files = walk(path.join(ROOT, "src", "seeker")).filter((f) => /\.(js|jsx)$/.test(f));
  const out = new Map(); // path -> [file:line]
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments name endpoints too; those are not calls
      const re = /["'`](\/api\/[A-Za-z0-9_./-]+)/g;
      let m;
      while ((m = re.exec(line))) {
        const p = m[1].replace(/\/$/, "");
        if (!out.has(p)) out.set(p, []);
        out.get(p).push(path.relative(ROOT, f) + ":" + (i + 1));
      }
    });
  }
  return out;
}
function regexFromServer(name) {
  const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const m = src.match(new RegExp("const " + name + " = /(.*)/;"));
  if (!m) throw new Error(name + " not found in server.js");
  return new RegExp(m[1]);
}
// Endpoints the app sends x-clkn-pass to (pass.js gated fetch + the receipt sign-in). Their
// preflight must allow the header; the education-contract endpoints never carry it.
const PASS_HEADER_PATHS = new Set(["/api/wallet-xray", "/api/snapshot", "/api/trace", "/api/airdrop/record"]);

(async () => {
  console.log("\nSeeker app — CORS for every endpoint it calls\n");
  console.log("(1) static — the app's inventory vs the two allow-lists in server.js\n");
  const STORE_API_RE = regexFromServer("STORE_API_RE");
  const SEEKER_API_RE = regexFromServer("SEEKER_API_RE");
  const inv = seekerInventory();
  ok("the inventory is not empty (the extractor found the app's fetches)", inv.size >= 20, inv.size);
  const uncovered = [];
  for (const [p, where] of inv) {
    if (!STORE_API_RE.test(p) && !SEEKER_API_RE.test(p)) uncovered.push(p + " ← " + where.join(", "));
  }
  ok(`every one of the ${inv.size} endpoints the app calls is in STORE_API_RE or SEEKER_API_RE`, uncovered.length === 0, uncovered.join("\n      "));
  for (const p of PASS_HEADER_PATHS) ok(`${p} (sends x-clkn-pass) is on the SEEKER list, not the education contract`, SEEKER_API_RE.test(p) && !STORE_API_RE.test(p));
  ok("the SEEKER list never grants the education contract's own paths twice (one middleware answers each)",
     [...inv.keys()].every((p) => !(STORE_API_RE.test(p) && SEEKER_API_RE.test(p))));

  // ---- (2) live -----------------------------------------------------------------------------
  console.log("\n(2) live — server.js booted, the webview's own preflight per endpoint\n");
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-cors-"));
  const PORT = 4491;
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: "seeker-cors-test-key", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "", FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  const base = `http://127.0.0.1:${PORT}`;
  const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { stop(); console.log("  ✗ server did not come up"); process.exit(1); }
  function req(p, { method = "GET", headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(base + p);
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
        let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; });
        res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, json: j, h: (k) => res.headers[k.toLowerCase()] }); });
      });
      r.on("error", reject); r.end();
    });
  }
  try {
    const ORIGINS = ["https://localhost", "capacitor://localhost"];
    for (const origin of ORIGINS) {
      const bad = [];
      for (const p of inv.keys()) {
        const pre = await req(p, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": PASS_HEADER_PATHS.has(p) ? "content-type,x-clkn-pass" : "content-type" } });
        const allowHdrs = String(pre.h("access-control-allow-headers") || "").toLowerCase();
        const good = pre.status === 204 && pre.h("access-control-allow-origin") === origin
          && /post/i.test(pre.h("access-control-allow-methods") || "")
          && allowHdrs.includes("content-type")
          && (!PASS_HEADER_PATHS.has(p) || allowHdrs.includes("x-clkn-pass"));
        if (!good) bad.push(`${p} → ${pre.status} acao=${pre.h("access-control-allow-origin")} hdrs=${pre.h("access-control-allow-headers")}`);
      }
      ok(`${origin}: the preflight of all ${inv.size} endpoints answers 204 with the origin echoed (+ x-clkn-pass where sent)`, bad.length === 0, bad.join("\n      "));
    }
    // A plain GET from the app carries the origin too; the echo must be on the real answer, not
    // just the preflight (a 429 from the limiter included — the middleware runs before it).
    const g = await req("/api/tool-gate/config", { headers: { origin: "https://localhost" } });
    ok("GET /api/tool-gate/config from the app origin → the origin echoed on the real answer", g.h("access-control-allow-origin") === "https://localhost" && /\borigin\b/i.test(g.h("vary") || ""), { status: g.status, acao: g.h("access-control-allow-origin") });
    const foreign = await req("/api/tool-gate/challenge?wallet=x", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    ok("a foreign origin gets no echo on a Seeker endpoint", foreign.h("access-control-allow-origin") !== "https://evil.example", foreign.h("access-control-allow-origin"));
    const noOrigin = await req("/api/tool-gate/config");
    ok("no Origin header → no CORS header at all (same-origin website traffic is untouched)", !noOrigin.h("access-control-allow-origin"));
    // The education editions (Play / iOS) carry a UA marker and are refused on the Seeker-only
    // endpoints — now WITH the CORS headers, so their webview reads the 403 instead of an opaque
    // network error. The marker still grants nothing; it only ever loses access.
    const UA = "Mozilla/5.0 (Linux; Android 14) ClucknorrisPlay/1.0";
    const ref = await req("/api/tool-gate/config", { headers: { origin: "https://localhost", "user-agent": UA } });
    ok("store UA on a Seeker-only endpoint → 403 not_available_in_this_edition, WITH the origin echoed", ref.status === 403 && ref.json && ref.json.error === "not_available_in_this_edition" && ref.h("access-control-allow-origin") === "https://localhost", { status: ref.status, acao: ref.h("access-control-allow-origin") });
    const seekerUa = await req("/api/tool-gate/config", { headers: { origin: "https://localhost", "user-agent": "Mozilla/5.0 (Linux; Android 14; Seeker) wv" } });
    ok("the Seeker app (no marker) gets the real answer", seekerUa.status === 200 && seekerUa.json && seekerUa.json.success !== false, seekerUa.status);
  } finally { stop(); }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
