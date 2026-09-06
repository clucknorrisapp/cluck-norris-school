#!/usr/bin/env node
"use strict";
// Audit 2026-09-05 #5-#9: admin routes that ARM, RUN, POST, DELETE or reconfigure must refuse to
// do it on a GET (a pasted link that a chat client unfurls must never move funds or post to the
// brand channels), armed vault calls must name their project, every vault response must echo the
// project it resolved, the Meteora pool lever is allowlisted, and the two Telegram test routes
// answer 404 like every other admin route. Boots the real server with a throwaway key and no
// secrets, so nothing here can reach a chain, a wallet, X or Telegram.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.GUARD_TEST_PORT || 3137);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "guard-test-key-" + Math.random().toString(36).slice(2);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, withKey = true) {
  const r = await fetch(BASE + p, { method, headers: withKey ? { "x-premium-key": KEY } : {} });
  let body = null; try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, body };
}

(async () => {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY,
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  console.log("\nAdmin mutation discipline (audit 2026-09-05 #5-#9)\n");

  // ── #7 vault: armed GET → 405; armed POST without project → 400; dry GET still answers and echoes the project
  let r = await call("GET", "/api/whirlpool/vault/close-position?project=treasury&mint=11111111111111111111111111111111&run=1");
  ok("GET /vault/close-position?run=1 is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("POST", "/api/whirlpool/vault/close-position?mint=11111111111111111111111111111111&run=1");
  ok("POST armed call with no project= is refused with 400 (no silent clkn default)", r.status === 400 && /project/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
  r = await call("GET", "/api/whirlpool/vault/close-position?project=treasury&mint=11111111111111111111111111111111");
  ok("GET dry run still answers and echoes project=treasury", r.status === 200 && r.body && r.body.project === "treasury" && r.body.action === "would-close", JSON.stringify(r.body));
  ok("…and carries an operator field (null here — no secrets loaded)", r.body && "operator" in r.body);
  r = await call("GET", "/api/whirlpool/vault/recoup-baseline?project=cuna&arm=1");
  ok("GET /vault/recoup-baseline?arm=1 is refused with 405", r.status === 405);
  r = await call("POST", "/api/whirlpool/vault/config");
  ok("POST /vault/config without project= is refused with 400", r.status === 400, JSON.stringify(r.body));
  r = await call("GET", "/api/whirlpool/vault/status?project=poke");
  ok("GET /vault/status still reads (and echoes poke)", r.status === 200 && r.body && r.body.project === "poke", JSON.stringify(r.body).slice(0, 160));
  r = await call("GET", "/api/whirlpool/vault/status?project=treasury", false);
  ok("vault routes stay 404 without the key", r.status === 404);

  // ── #8 server admin routes
  r = await call("GET", "/api/x-delete?id=123&run=1");
  ok("GET /api/x-delete?run=1 is refused with 405 (irreversible)", r.status === 405);
  r = await call("GET", "/api/x-delete?id=123");
  ok("GET /api/x-delete without run=1 stays the dry run", r.status === 200 && r.body && r.body.dryRun === true, JSON.stringify(r.body));
  r = await call("GET", "/api/treasury-engine-window");
  ok("bare GET /api/treasury-engine-window no longer ARMS — it reports", r.status === 200 && r.body && r.body.armed === false && r.body.note, JSON.stringify(r.body));
  r = await call("POST", "/api/treasury-engine-window?off=1");
  ok("POST /api/treasury-engine-window?off=1 works", r.status === 200 && r.body && r.body.armed === false);
  r = await call("GET", "/api/lock-celebration?clear=1");
  ok("GET /api/lock-celebration?clear=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/lock-celebration");
  ok("GET /api/lock-celebration still reads pending", r.status === 200 && r.body && "pending" in r.body, JSON.stringify(r.body));
  r = await call("POST", "/api/lock-celebration?clear=1");
  ok("POST /api/lock-celebration?clear=1 clears", r.status === 200 && r.body && r.body.cleared === true, JSON.stringify(r.body));
  r = await call("GET", "/api/buybot?project=cuna&arm=1");
  ok("GET /api/buybot?arm=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/buybot?project=cuna&min=5");
  ok("GET /api/buybot with a config field is refused with 405 (every field upsert saves)", r.status === 405);
  r = await call("GET", "/api/buybot?list=1");
  ok("GET /api/buybot?list=1 still lists", r.status === 200 && r.body && Array.isArray(r.body.bots));
  r = await call("GET", "/api/rose-buybot?arm=1");
  ok("GET /api/rose-buybot?arm=1 is refused with 405", r.status === 405);

  // ── #9 telegram test routes: 404 (not 403) without the key; post=1 needs POST
  r = await call("GET", "/api/bags-radar-test", false);
  ok("GET /api/bags-radar-test without key → 404 (was 403)", r.status === 404, String(r.status));
  r = await call("GET", "/api/market-check-test", false);
  ok("GET /api/market-check-test without key → 404 (was 403)", r.status === 404, String(r.status));
  r = await call("GET", "/api/bags-radar-test?post=1");
  ok("GET /api/bags-radar-test?post=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/market-check-test?post=1");
  ok("GET /api/market-check-test?post=1 is refused with 405", r.status === 405);

  // ── #6 Meteora pool allowlist — refused before anything touches the chain, dry run included
  r = await call("GET", "/api/meteora/open-position?pool=BnGwTFd5rBBVR1EYdEGkbf5c1sNqUqA6hQ2MuT9yrK5v&x=1&y=1");
  ok("open-position on a pool outside the allowlist is refused", r.status >= 400 && /allowlist/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const meteora = require("../lib/meteora-dlmm");
  ok("assertPoolAllowed accepts the canonical pool", (() => { try { meteora.assertPoolAllowed(meteora.METEORA_POOL); return true; } catch (e) { return false; } })());
  ok("assertPoolAllowed rejects any other address", (() => { try { meteora.assertPoolAllowed("BnGwTFd5rBBVR1EYdEGkbf5c1sNqUqA6hQ2MuT9yrK5v"); return false; } catch (e) { return /allowlist/.test(e.message); } })());

  // ── #4 the admin route reports days as DAYS and the payout route reports slices
  r = await call("GET", "/api/cuna-stake/admin");
  ok("cuna admin reports daysAccrued and slicesAccrued as numbers", r.status === 200 && r.body && typeof r.body.daysAccrued === "number" && typeof r.body.slicesAccrued === "number" && r.body.daysAccrued <= r.body.slicesAccrued, JSON.stringify({ d: r.body && r.body.daysAccrued, s: r.body && r.body.slicesAccrued, status: r.status }));

  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
