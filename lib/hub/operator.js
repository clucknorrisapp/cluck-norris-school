"use strict";
// The project desk's operator session (Phase 2, owner 2026-09-16). An operator proves a wallet
// listed on the project record by signing a one-line nonce message — nothing typed, no key — and
// gets an HMAC token bound to that project and wallet. The tools pass pattern (server.js
// toolPassChallenge / issueToolPass): the challenge is single-use and short-lived, the token is
// short-lived, and every request re-checks that the wallet is STILL an operator of the project
// (removing a wallet from the record revokes its desk on the next request).
//
// Pure: the store for open challenges is passed in (a Map), the secret is passed in, the clock
// is passed in. The ed25519 check is the caller's (server.js verifySolanaSignature).
const { createHmac, randomBytes, timingSafeEqual } = require("crypto");

const CHALLENGE_TTL_MS = 10 * 60e3;
const SESSION_TTL_MS = 12 * 3600e3;
const MAX_OPEN = 5000;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function message(projectId, symbol, wallet, nonce) {
  return `Cluck Norris — Lock to Earn desk for ${symbol} (${projectId})\nwallet: ${wallet}\nnonce: ${nonce}\nThis only proves you operate this wallet. It is NOT a transaction and grants no spending approval.`;
}
const MSG_RE = /^Cluck Norris — Lock to Earn desk for [A-Za-z0-9]{1,12} \(([a-z0-9][a-z0-9-]{1,31})\)\nwallet: ([1-9A-HJ-NP-Za-km-z]{32,44})\nnonce: ([0-9a-f]{32})\n/;

function issueChallenge(store, { projectId, symbol, wallet, nowMs = Date.now(), nonce = randomBytes(16).toString("hex") }) {
  if (!B58.test(String(wallet || ""))) throw new Error("need a wallet address");
  for (const [n, c] of store) if (c.exp < nowMs) store.delete(n);
  if (store.size >= MAX_OPEN) throw new Error("too many open challenges — try again in a minute");
  store.set(nonce, { projectId, wallet, exp: nowMs + CHALLENGE_TTL_MS });
  return { nonce, message: message(projectId, symbol, wallet, nonce), expiresAt: nowMs + CHALLENGE_TTL_MS };
}
// Consumed on ANY attempt; true only when it exists, is unexpired and matches project + wallet.
function consumeChallenge(store, { nonce, projectId, wallet, nowMs = Date.now() }) {
  const c = store.get(nonce);
  if (c) store.delete(nonce);
  return !!(c && c.projectId === projectId && c.wallet === wallet && c.exp >= nowMs);
}
function parseMessage(msg) {
  const m = MSG_RE.exec(String(msg || ""));
  return m ? { projectId: m[1], wallet: m[2], nonce: m[3] } : null;
}

function issueToken(secret, { projectId, wallet, nowMs = Date.now(), ttlMs = SESSION_TTL_MS }) {
  if (!secret) throw new Error("desk sessions need a server secret");
  const body = Buffer.from(JSON.stringify({ t: "hub-op", p: projectId, w: wallet, exp: nowMs + ttlMs })).toString("base64url");
  return body + "." + createHmac("sha256", secret).update("hub-op." + body).digest("base64url");
}
function verifyToken(secret, token, { nowMs = Date.now() } = {}) {
  if (!secret || !token) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update("hub-op." + body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_) { return null; }
  if (!p || p.t !== "hub-op" || !p.p || !B58.test(String(p.w || "")) || !p.exp || nowMs > p.exp) return null;
  return { projectId: String(p.p), wallet: String(p.w), exp: Number(p.exp) };
}

// Is this token an operator of THIS project right now? The record is re-read by the caller.
function operatorOf(secret, token, project, { nowMs = Date.now() } = {}) {
  const t = verifyToken(secret, token, { nowMs });
  if (!t || !project || t.projectId !== project.id) return null;
  if (!(project.operatorWallets || []).includes(t.wallet)) return null;
  return t.wallet;
}

module.exports = { CHALLENGE_TTL_MS, SESSION_TTL_MS, message, parseMessage, issueChallenge, consumeChallenge, issueToken, verifyToken, operatorOf };
