// Normie Quest — TV pairing: carry a PROVEN wallet session onto a device that has no wallet.
//
// A smart-TV / console / set-top browser cannot run a Solana wallet extension, and there is no
// deep-link to open one there. So a player on a TV has no way to reach anything gated by holdings
// — worlds 3+, the VIP wing, the Lounge — even though they own the tokens.
//
// The TV therefore never touches a wallet at all. It shows a short code; the player types that
// code on the PHONE where their wallet already lives; the phone hands over the session it has
// ALREADY proven. No new trust is created: the phone must present a valid session token, which is
// exactly the proof /api/nq/score already demands before it will stamp a score walletVerified.
//
// TWO secrets, deliberately:
//   code   6 chars — shown on the TV, typed on the phone. Identifies the pairing.
//   claim  32 hex  — generated with the code and NEVER leaves the TV. Redeems it.
// The split matters because a TV screen is a public surface: it gets streamed, photographed and
// stood in front of. If the code alone could fetch the session, anyone who read it off the screen
// could walk away with the player's wallet session. It cannot — polling requires the claim secret,
// which only the browser that created the code has ever held.
//
// The residual risk is the one every TV-pairing flow carries: someone talks a player into typing
// the ATTACKER's code, handing their session to the attacker's device. That is why the phone side
// spells out what it is about to do and requires a second, explicit confirmation. The session
// grants read-level identity (tier, leaderboard attribution, Lounge access) — it can never move
// funds or sign anything, because it is not a key.
//
// In-memory by design. A pairing lives ~10 minutes and is consumed once; there is nothing here
// worth surviving a redeploy, and keeping it off disk means a stale file can never leak a session.

const crypto = require('crypto');

// No 0/O/1/I/5/S lookalikes — this gets read off a television across a room and typed on a phone.
const ALPHABET = '234679ACDEFGHJKLMNPQRTUVWXYZ';
const CODE_LEN = 6;
const TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 500;          // memory bound; oldest expired entries are pruned first
const MAX_ATTEMPTS = 12;          // per code — kills blind enumeration without hurting a typo

const pending = new Map();        // code -> { claim, createdAt, expiresAt, wallet, token, attempts }

function prune(now) {
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
}

function newCode() {
  let out = '';
  const bytes = crypto.randomBytes(CODE_LEN * 2);
  for (let i = 0; out.length < CODE_LEN && i < bytes.length; i++) {
    // Reject bytes that would bias the modulo. With a 28-char alphabet the usable range is 0..251.
    const limit = 256 - (256 % ALPHABET.length);
    if (bytes[i] >= limit) continue;
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  while (out.length < CODE_LEN) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function normalize(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

// ---- TV side: ask for a code -------------------------------------------------
function create() {
  const now = Date.now();
  prune(now);
  if (pending.size >= MAX_PENDING) return { ok: false, status: 'busy' };
  let code = newCode(), guard = 0;
  while (pending.has(code) && guard++ < 20) code = newCode();
  if (pending.has(code)) return { ok: false, status: 'busy' };
  const claim = crypto.randomBytes(16).toString('hex');
  pending.set(code, { claim, createdAt: now, expiresAt: now + TTL_MS, wallet: null, token: null, attempts: 0 });
  return { ok: true, code, claim, expiresIn: TTL_MS };
}

// ---- phone side: hand the proven session over --------------------------------
// `wallet` / `token` MUST already have been validated by the caller (routes.js checks them with
// nq-wallet's checkSession). This module never decides who owns a pubkey.
function bind(code, wallet, token) {
  const now = Date.now();
  prune(now);
  const c = normalize(code);
  if (c.length !== CODE_LEN) return { ok: false, status: 'bad_code' };
  const e = pending.get(c);
  if (!e) return { ok: false, status: 'unknown_code' };       // also covers "expired" — same message to the user
  if (e.attempts++ >= MAX_ATTEMPTS) { pending.delete(c); return { ok: false, status: 'unknown_code' }; }
  if (e.wallet) return { ok: false, status: 'already_paired' };
  e.wallet = String(wallet);
  e.token = String(token);
  e.pairedAt = now;
  return { ok: true, wallet: e.wallet };
}

// ---- TV side: poll until the phone answers -----------------------------------
// Single-use: a successful poll consumes the pairing, so a replayed request returns nothing.
function poll(code, claim) {
  const now = Date.now();
  prune(now);
  const c = normalize(code);
  const e = pending.get(c);
  if (!e) return { ok: false, status: 'expired' };
  if (!safeEq(claim, e.claim)) return { ok: false, status: 'bad_claim' };
  if (!e.wallet) return { ok: true, paired: false, expiresIn: Math.max(0, e.expiresAt - now) };
  pending.delete(c);
  return { ok: true, paired: true, wallet: e.wallet, token: e.token };
}

// Small operational view (no secrets) so a health check can see the flow is alive.
function stats() {
  prune(Date.now());
  let paired = 0;
  for (const v of pending.values()) if (v.wallet) paired++;
  return { pending: pending.size, awaitingPickup: paired, ttlSec: TTL_MS / 1000 };
}

module.exports = { create, bind, poll, stats, CODE_LEN, TTL_MS };
