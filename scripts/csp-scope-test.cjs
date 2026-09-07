#!/usr/bin/env node
"use strict";
// CSP scoping guard: the site-wide Content-Security-Policy used to grant 'unsafe-eval'
// everywhere because Phaser (Normie Quest's game engine) needs it. That's a needless XSS
// widening on every other page. Now only the game shell (which actually loads Phaser) gets
// 'unsafe-eval' — everything else, including the clucknorris.app root, gets the tighter default.
// Boots the real server offline (no secrets) on a throwaway port, same pattern as
// mutating-get-guard-test.cjs. Uses raw http.request so the Host header can be set directly
// (fetch() drops a client-set Host header), matching how the isGameHost() check works.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.CSP_TEST_PORT || 3181);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "csp-scope-"));
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function raw(method, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: headers || {} }, (res) => {
      let data = ""; res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, csp: res.headers["content-security-policy"] || "" }));
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const srv = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HELIUS_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" },
    stdio: "ignore",
  });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/healthz")).ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  console.log("\nCSP scoping (offline)\n");

  let r = await raw("GET", "/", { host: "clucknorris.app" });
  ok("clucknorris.app '/' has no unsafe-eval", r.status === 200 && r.csp.includes("script-src") && !r.csp.includes("unsafe-eval"), r.csp);

  r = await raw("GET", "/normie-quest-x7", { host: "clucknorris.app" });
  ok("/normie-quest-x7 gets unsafe-eval", r.status === 200 && r.csp.includes("unsafe-eval"), r.csp);

  r = await raw("GET", "/normie-quest-x7-lab", { host: "clucknorris.app" });
  ok("/normie-quest-x7-lab gets unsafe-eval", r.status === 200 && r.csp.includes("unsafe-eval"), r.csp);

  r = await raw("GET", "/", { host: "normiequest.app" });
  ok("normiequest.app root (host-aware game shell) gets unsafe-eval", r.status === 200 && r.csp.includes("unsafe-eval"), r.csp);

  r = await raw("GET", "/education", { host: "clucknorris.app" });
  ok("an unrelated page (/education) has no unsafe-eval", r.status === 200 && !r.csp.includes("unsafe-eval"), r.csp);

  // A spoofed X-Forwarded-Host must NOT grant the eval CSP — isGameHost reads the raw Host header
  // only (same anti-spoof reasoning as the origin-lockdown / stake-host checks elsewhere).
  r = await raw("GET", "/", { host: "clucknorris.app", "x-forwarded-host": "normiequest.app" });
  ok("a forged X-Forwarded-Host cannot widen the CSP", r.status === 200 && !r.csp.includes("unsafe-eval"), r.csp);

  // Every other CSP directive must be identical between the two variants — only script-src differs.
  const base = (await raw("GET", "/", { host: "clucknorris.app" })).csp.split("; ").filter((d) => !d.startsWith("script-src"));
  const nq = (await raw("GET", "/normie-quest-x7", { host: "clucknorris.app" })).csp.split("; ").filter((d) => !d.startsWith("script-src"));
  ok("non-script-src directives are unchanged between the two CSP variants", JSON.stringify(base) === JSON.stringify(nq), JSON.stringify({ base, nq }));

  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
