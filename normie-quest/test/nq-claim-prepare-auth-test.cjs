// Regression test for /api/nq/claim/prepare being unauthenticated (audit Batch B).
//
// prepare() used to take only {pubkey, week, address} with no proof the caller controls that
// wallet. Since nq-claims.js keys the pending consent message by pubkey alone and unconditionally
// replaces any earlier entry, anyone who read a winner's public wallet (off /api/nq/claim/status
// or the public leaderboard) could call prepare with that pubkey and block the real winner's
// claim: their later signature would fail as bad_signature against the clobbered message.
//
// Fix: /api/nq/claim/prepare now requires a live wallet session (wallet.checkSession(pubkey,
// token)) — exactly the "who is entitled to be here" check the finding asked for.
//
// Boots the real Express router in-process (127.0.0.1, ephemeral port) and drives it over HTTP —
// no external network, no real Solana RPC, no secrets.
//
// Run: node normie-quest/test/nq-claim-prepare-auth-test.cjs
"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

let web3;
try { web3 = require("@solana/web3.js"); }
catch (e) {
  console.log("SKIP  nq-claim-prepare-auth test (@solana/web3.js not installed — dependency-free run)");
  process.exit(0);
}

const SECRET = "test-nq-lb-secret-0123456789abcdef";
process.env.NQ_LB_SECRET = SECRET;
process.env.NQ_CLAIM_SECRET = "test-claim-secret-abcdef";
process.env.DATA_DIR = path.join(os.tmpdir(), "nqclaimprepauth-" + crypto.randomBytes(4).toString("hex"));

const express = require("express");
const routes = require("../routes.js"); // the real router, real checkSession, real claims.prepare

const app = express();
app.use(express.json());
app.use(routes);

function sessionToken(pk) {
  const issuedAt = Date.now();
  const mac = crypto.createHmac("sha256", SECRET).update(pk + "." + issuedAt).digest("hex").slice(0, 32);
  return mac + "." + issuedAt;
}

function post(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "POST", headers: { "content-type": "application/json", "content-length": data.length } },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const winner = web3.Keypair.generate().publicKey.toBase58();
  const attacker = web3.Keypair.generate().publicKey.toBase58();
  const week = Date.UTC(2026, 0, 5); // an arbitrary Monday 00:00 UTC

  try {
    // 1. No session at all -> rejected before ever touching claims.prepare().
    const r1 = await post(port, "/api/nq/claim/prepare", { pubkey: winner, week, address: { name: "a", line1: "b", city: "c", country: "d" } });
    check("no token at all is rejected (not 200, marked bad_session)", r1.status !== 200 && r1.body && r1.body.ok === false && r1.body.error === "bad_session");

    // 2. Attacker holds a VALID session — but for THEIR OWN wallet, not the winner's — and tries
    // to prepare (and thereby clobber) a claim for the winner's pubkey. Must still be rejected.
    const attackerToken = sessionToken(attacker);
    const r2 = await post(port, "/api/nq/claim/prepare", { pubkey: winner, week, address: { name: "a", line1: "b", city: "c", country: "d" }, token: attackerToken });
    check("a session for a DIFFERENT wallet cannot prepare the winner's claim", r2.status !== 200 && r2.body && r2.body.ok === false && r2.body.error === "bad_session");

    // 3. A garbage/forged token for the right-looking pubkey is rejected too.
    const r3 = await post(port, "/api/nq/claim/prepare", { pubkey: winner, week, address: { name: "a", line1: "b", city: "c", country: "d" }, token: "not.avalidtoken" });
    check("a forged token is rejected", r3.status !== 200 && r3.body && r3.body.ok === false && r3.body.error === "bad_session");

    // 4. The winner's OWN valid session for their OWN wallet passes the auth gate (it may still
    // fail downstream in claims.prepare() — not_a_winner / week_not_ended, since we seeded no
    // leaderboard data — but it must get PAST the session check, i.e. never come back bad_session).
    const winnerToken = sessionToken(winner);
    const r4 = await post(port, "/api/nq/claim/prepare", { pubkey: winner, week, address: { name: "a", line1: "b", city: "c", country: "d" }, token: winnerToken });
    check("the winner's own session is accepted past the auth gate", !(r4.body && r4.body.error === "bad_session"));
  } finally {
    server.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll /api/nq/claim/prepare auth checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
