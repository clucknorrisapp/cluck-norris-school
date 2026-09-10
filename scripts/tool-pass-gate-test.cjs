#!/usr/bin/env node
"use strict";
// 2026-09-10: the unified tools pass was client-side only — a bare curl pulled a full X-Ray report
// with no wallet, no pass and no signature, so the revenue model was a localStorage.setItem away.
// The heavy APIs now enforce the pass server-side (toolPassGate in server.js). This boots the real
// server with no secrets and pins: no proof → 402; malformed / never-redeemed proof → 403;
// TOOLGATE_OFF=1 disarms it; the free surfaces stay free; and the operator consoles are not
// served raw at /<name>.html (they were, indexable, with none of their routes' headers).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const W = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv";
const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, extraEnv) {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "toolpass-test-"));
  const env = { ...process.env, PORT: String(port), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: "toolpass-test-key",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9", ...extraEnv };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  if (!up) { stop(); throw new Error("server did not come up on " + port); }
  return { base, stop };
}
async function get(base, p, headers) {
  const r = await fetch(base + p, { headers: headers || {}, redirect: "manual" });
  let body = null; try { body = await r.clone().json(); } catch (_) {}
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  const A = await boot(Number(process.env.TOOLPASS_TEST_PORT || 3141), { TOOLGATE_OFF: "" });
  try {
    console.log("\nTools pass — server-side enforcement\n");
    for (const [name, p] of [["wallet-xray", `/api/wallet-xray?wallet=${W}`], ["snapshot", `/api/snapshot?mint=${MINT}`], ["trace", `/api/trace?wallet=${W}&mint=${MINT}`]]) {
      let r = await get(A.base, p);
      ok(`${name}: no proof → 402 pass_required`, r.status === 402 && r.body && r.body.error === "pass_required", JSON.stringify(r.body));
      r = await get(A.base, p, { "x-clkn-pass": "hello" });
      ok(`${name}: malformed proof → 403 bad_pass`, r.status === 403 && r.body && r.body.error === "bad_pass", JSON.stringify(r.body));
      r = await get(A.base, p, { "x-clkn-pass": "s:5Kd3NBzz8aYCMcgHrZfYDaKXfF1x2yv1rM4xQe9v7pQnQhY3wA8u2LxgC2DqYFBHwXk1mZ9cN5b6T8K7pR4sV3wJ" });
      ok(`${name}: never-redeemed payment sig → 403 pass_expired`, r.status === 403 && r.body && r.body.error === "pass_expired", JSON.stringify(r.body));
      // Holder path with no CLKN price loaded fails OPEN (the pass's own rule) — the request then
      // reaches the tool, which has no Helius key here, so the visible answer is its 500, not 402/403.
      r = await get(A.base, p, { "x-clkn-pass": "w:" + W });
      ok(`${name}: wallet proof with no price → passes the gate (fail-open)`, r.status !== 402 && r.status !== 403, "status " + r.status);
    }
    ok("?pass= query form is honoured too", (await get(A.base, `/api/trace?wallet=${W}&mint=${MINT}&pass=s:abc`)).status === 403);
    ok("Wallet Checkup stays free (no gate)", [200, 400, 500, 502, 503].includes((await get(A.base, `/api/wallet-checkup?wallet=${W}`)).status) && (await get(A.base, `/api/wallet-checkup?wallet=${W}`)).status !== 402);
    ok("tool-gate config is public", (await get(A.base, "/api/tool-gate/config")).status === 200);

    console.log("\nOperator consoles are not served raw\n");
    for (const n of ["engine-dashboard", "buycomp-admin", "jupverify-admin", "client-portal", "whale-panel", "cuna-payout", "prize-wheel"]) {
      ok(`/${n}.html → 404`, (await get(A.base, `/${n}.html`)).status === 404);
    }
    for (const n of ["engine-dashboard", "buycomp-admin", "client-portal", "whale-panel", "cuna-payout"]) {
      const r = await get(A.base, `/${n}`);
      ok(`/${n} route answers 200 with noindex`, r.status === 200 && /noindex/.test(r.headers.get("x-robots-tag") || ""), `status ${r.status} robots=${r.headers.get("x-robots-tag")}`);
    }
    const inv = await get(A.base, "/investors");
    ok("/investors → 301 /about", inv.status === 301 && inv.headers.get("location") === "/about", `status ${inv.status} loc=${inv.headers.get("location")}`);
    ok("/about → 200", (await get(A.base, "/about")).status === 200);
  } finally { A.stop(); }

  const B = await boot(Number(process.env.TOOLPASS_TEST_PORT || 3141) + 1, { TOOLGATE_OFF: "1" });
  try {
    console.log("\nTOOLGATE_OFF=1 disarms the server gate\n");
    const r = await get(B.base, `/api/wallet-xray?wallet=${W}`);
    ok("wallet-xray with the gate off is not refused for a pass", r.status !== 402 && r.status !== 403, "status " + r.status);
  } finally { B.stop(); }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
