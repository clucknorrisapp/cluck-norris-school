// Regression test for normie-quest/routes.js's per-IP throttle trusting cf-connecting-ip
// unconditionally (audit Batch B follow-up).
//
// server.js only sets req.cfVerified when the X-Cluck-Edge-Auth hash proves the request actually
// came through the Cloudflare Transform Rule. Every /api/nq/* route (this whole router) falls
// inside NQ_GAME_PATH, which the origin lockdown EXEMPTS for the game-host domain WITHOUT setting
// req.cfVerified — so on that host cf-connecting-ip is just another client-supplied header, and
// routes.js's clientIp() used to trust it anyway. A client could send a fresh random
// cf-connecting-ip on every request and reset any throttled() bucket at will.
//
// Fix: clientIp() here now trusts cf-connecting-ip only when req.cfVerified is true (set by a
// preceding middleware — server.js's real one, or this test's stand-in), exactly mirroring
// server.js's own clientIp().
//
// Boots the real Express router in-process (127.0.0.1, ephemeral port) and drives it over HTTP —
// no external network, no real Solana RPC, no secrets.
//
// Run: node normie-quest/test/nq-clientip-cfverified-test.cjs
"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

process.env.NQ_LB_SECRET = "test-nq-lb-secret-clientip-0123456789";
process.env.DATA_DIR = path.join(os.tmpdir(), "nqclientip-" + crypto.randomBytes(4).toString("hex"));

const express = require("express");

function get(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST", headers: Object.assign({ "content-length": 0 }, headers || {}) },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

async function withServer(cfVerified, run) {
  // Fresh router instance per scenario so the two scenarios don't share pubRate buckets.
  delete require.cache[require.resolve("../routes.js")];
  const routes = require("../routes.js");
  const app = express();
  // Stand-in for server.js's origin-lockdown middleware: sets req.cfVerified exactly the way the
  // real one does (based on whether the request proved it came through Cloudflare), BEFORE the
  // game router — same relative order as server.js's real mount (line ~14752, well after the
  // lockdown middleware at ~3349).
  app.use((req, res, next) => { if (cfVerified) req.cfVerified = true; next(); });
  app.use(routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try { await run(port); } finally { server.close(); }
}

async function main() {
  // Scenario A: req.cfVerified is FALSE (the game-host exemption path — no Cloudflare Transform
  // Rule proof). An attacker sends a fresh forged cf-connecting-ip on every request. Since the
  // header must be ignored here, every request should fall back to the same loopback address and
  // land in the SAME throttle bucket — the 13th call (max is 12) must be rejected.
  await withServer(false, async (port) => {
    let sawThrottled = false;
    for (let i = 0; i < 13; i++) {
      const r = await get(port, "/api/nq/pair/new", { "cf-connecting-ip": `10.0.0.${i}` });
      if (r.status === 429) sawThrottled = true;
    }
    check("unverified cf-connecting-ip is ignored: a forged-per-request IP still hits the shared bucket cap", sawThrottled);
  });

  // Scenario B: req.cfVerified is TRUE (a real Cloudflare-fronted request). Each of 13 requests
  // carries a DIFFERENT real visitor IP. Since the header is trusted once verified, each IP gets
  // its own bucket, so none of these 13 (all under the per-IP cap of 12) should be throttled —
  // proving the fix doesn't break legitimate per-visitor throttling on the verified path.
  await withServer(true, async (port) => {
    let sawThrottled = false;
    for (let i = 0; i < 13; i++) {
      const r = await get(port, "/api/nq/pair/new", { "cf-connecting-ip": `203.0.113.${i}` });
      if (r.status === 429) sawThrottled = true;
    }
    check("verified cf-connecting-ip IS trusted: 13 distinct real visitor IPs each get their own bucket, none throttled", !sawThrottled);
  });

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll cf-connecting-ip / req.cfVerified checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
