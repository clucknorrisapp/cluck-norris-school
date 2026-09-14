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
const crypto = require("crypto");
const { PublicKey } = require("@solana/web3.js");
const KEY = "toolpass-test-key";
// An ed25519 keypair standing in for a wallet: node's crypto signs exactly what a Solana wallet's
// signMessage produces, so the session endpoint can be driven end to end without a wallet.
function makeWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { pub: new PublicKey(raw).toBase58(), sign: (msg) => crypto.sign(null, Buffer.from(msg, "utf8"), privateKey).toString("base64") };
}
// The message must come from the server: GET /api/tool-gate/challenge issues a single-use nonce.
async function challenge(base, wallet) { const r = await fetch(`${base}/api/tool-gate/challenge?wallet=${wallet}`); const j = await r.json(); return j.message; }
function fakeMsg(wallet, nonce) { return `Cluck Norris — unlock the tools pass\nwallet: ${wallet}\nnonce: ${nonce}\nThis only proves you own this wallet. It is NOT a transaction and grants no spending approval.`; }
function forgeToken(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", key).update("tools." + body).digest("base64url");
}
async function post(base, p, body) {
  const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.clone().json(); } catch (_) {}
  return { status: r.status, body: j };
}

const W = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv";
const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, extraEnv) {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "toolpass-test-"));
  const env = { ...process.env, PORT: String(port), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY,
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
    // /api/wallet-xray, /api/snapshot, /api/trace and /api/wallet-checkup share ONE "forensic"
    // rate bucket of 15/min, so the full matrix runs on X-Ray and the other routes get one probe each.
    const XR = `/api/wallet-xray?wallet=${W}`;
    let r = await get(A.base, XR);
    ok("wallet-xray: no proof → 402 pass_required", r.status === 402 && r.body && r.body.error === "pass_required", JSON.stringify(r.body));
    r = await get(A.base, XR, { "x-clkn-pass": "hello" });
    ok("wallet-xray: malformed proof → 403 bad_pass", r.status === 403 && r.body && r.body.error === "bad_pass", JSON.stringify(r.body));
    // The two bypasses a second reviewer found on the first version: a copied holder address and
    // a public payment signature are NOT credentials any more.
    r = await get(A.base, XR, { "x-clkn-pass": "w:" + W });
    ok("wallet-xray: a pasted wallet address is refused (bad_pass)", r.status === 403 && r.body && r.body.error === "bad_pass", JSON.stringify(r.body));
    r = await get(A.base, XR, { "x-clkn-pass": "s:5Kd3NBzz8aYCMcgHrZfYDaKXfF1x2yv1rM4xQe9v7pQnQhY3wA8u2LxgC2DqYFBHwXk1mZ9cN5b6T8K7pR4sV3wJ" });
    ok("wallet-xray: a payment signature is refused (bad_pass)", r.status === 403 && r.body && r.body.error === "bad_pass", JSON.stringify(r.body));
    r = await get(A.base, XR, { "x-clkn-pass": "t:" + forgeToken({ t: "tools", w: W, v: "paid", exp: Date.now() - 1000 }, KEY) });
    ok("wallet-xray: an expired token → 403 pass_expired", r.status === 403 && r.body && r.body.error === "pass_expired", JSON.stringify(r.body));
    r = await get(A.base, XR, { "x-clkn-pass": "t:" + forgeToken({ t: "tools", w: W, v: "paid", exp: Date.now() + 1e7 }, "wrong-key") });
    ok("wallet-xray: a token signed with the wrong key → 403", r.status === 403, "status " + r.status);
    r = await get(A.base, XR, { "x-clkn-pass": "t:" + forgeToken({ w: W, exp: Date.now() + 1e7 }, KEY) });
    ok("wallet-xray: a premium-shaped proof is not a tools pass", r.status === 403, "status " + r.status);
    r = await get(A.base, `/api/snapshot?mint=${MINT}`);
    ok("snapshot: no proof → 402 pass_required", r.status === 402 && r.body && r.body.error === "pass_required", JSON.stringify(r.body));
    r = await get(A.base, `/api/trace?wallet=${W}&mint=${MINT}`);
    ok("trace: no proof → 402 pass_required", r.status === 402 && r.body && r.body.error === "pass_required", JSON.stringify(r.body));
    ok("?pass= query form is honoured too", (await get(A.base, `/api/trace?wallet=${W}&mint=${MINT}&pass=t:abc.def`)).status === 403);

    console.log("\nSession issuance — the wallet must prove itself, once per challenge\n");
    const wal = makeWallet(), other = makeWallet();
    let msg = await challenge(A.base, wal.pub);
    ok("challenge carries the wallet and a 32-hex nonce", /wallet: /.test(msg) && /nonce: [0-9a-f]{32}\n/.test(msg));
    let s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: msg, signature: other.sign(msg) });
    ok("signature from a different key → 401 (and the challenge is spent)", s.status === 401, JSON.stringify(s.body));
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: msg, signature: wal.sign(msg) });
    ok("the same challenge cannot be reused after a failed attempt", s.status === 400 && /already used|missing|expired/.test(s.body && s.body.error || ""), JSON.stringify(s.body));
    msg = await challenge(A.base, other.pub);
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: msg, signature: wal.sign(msg) });
    ok("a challenge issued to another wallet → 400", s.status === 400, JSON.stringify(s.body));
    const forged = fakeMsg(wal.pub, "00112233445566778899aabbccddeeff");
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: forged, signature: wal.sign(forged) });
    ok("a client-invented nonce → 400", s.status === 400, JSON.stringify(s.body));
    const premiumMsg = "Cluck Norris — verify wallet for premium access\nwallet: " + wal.pub + "\nnonce: " + Date.now() + "\n";
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: premiumMsg, signature: wal.sign(premiumMsg) });
    ok("a premium-purpose signature is not accepted here", s.status === 400, JSON.stringify(s.body));
    const good = await challenge(A.base, wal.pub);
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: good, signature: wal.sign(good) });
    // No CLKN price is loaded in this environment → the outage policy issues a short grace pass.
    ok("valid signature, no price → grace pass issued", s.status === 200 && s.body && s.body.success && /^t:/.test(s.body.pass) && /grace/.test(s.body.via), JSON.stringify(s.body));
    const tok = s.body && s.body.pass;
    const replay = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: good, signature: wal.sign(good) });
    ok("REPLAY of the same signed message issues nothing (single-use challenge)", replay.status === 400 && !(replay.body && replay.body.success), JSON.stringify(replay.body));
    let g = await get(A.base, `/api/wallet-xray?wallet=${W}`, { "x-clkn-pass": tok });
    ok("that pass opens the gate (reaches the tool: 500 here, no Helius key)", g.status !== 402 && g.status !== 403, "status " + g.status);
    g = await get(A.base, `/api/wallet-xray?wallet=${W}`, { "x-clkn-pass": tok + "x" });
    ok("a tampered pass is refused", g.status === 403, "status " + g.status);
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, payIntent: "bogus.token", paySig: "5Kd3NBzz8aYCMcgHrZfYDaKXfF1x2yv1rM4xQe9v7pQnQhY3wA8u2LxgC2DqYFBHwXk1mZ9cN5b6T8K7pR4sV3wJ" });
    ok("a forged pay intent → 401", s.status === 401, JSON.stringify(s.body));
    const good2 = await challenge(A.base, wal.pub);
    s = await post(A.base, "/api/tool-gate/session", { wallet: wal.pub, message: good2, signature: wal.sign(good2), paySig: "5Kd3NBzz8aYCMcgHrZfYDaKXfF1x2yv1rM4xQe9v7pQnQhY3wA8u2LxgC2DqYFBHwXk1mZ9cN5b6T8K7pR4sV3wJ" });
    ok("paid path with an unverifiable signature does not issue a pass", !(s.body && s.body.success), JSON.stringify(s.body));
    const wc = await get(A.base, `/api/wallet-checkup?wallet=${W}`);
    ok("Wallet Checkup stays free (no gate)", wc.status !== 402 && wc.status !== 403, "status " + wc.status);
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
