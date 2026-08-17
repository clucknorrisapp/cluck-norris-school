// Normie Quest — weekly prize claims (physical giveaways, e.g. graded Pokemon cards).
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
//
// The weekly leaderboard is a SKILL contest: the week's top wallet-verified, non-suspect run wins.
// The winner proves they own the winning wallet by signing a consent message with it (signature
// only — no transaction, no funds), and that message BINDS the shipping address they entered
// (its hash is inside the signed text), so a captured signature can never be replayed to redirect
// a prize to someone else's mailbox.
//
// PII posture — the game stores none, and this module keeps the blast radius minimal:
//   - an address is collected ONLY from a winner, at claim time, never from entrants;
//   - it is encrypted at rest (AES-256-GCM, per-purpose key — see SECRET note below);
//   - it is decrypted ONLY for the owner's keyed prizes panel;
//   - markShipped() permanently wipes the ciphertext, keeping just {week, wallet, shippedAt}.
// If no stable secret is configured, claims REFUSE loudly ('not_configured') rather than persist
// PII that a restart would make undecryptable.
//
// Config (env):
//   NQ_CLAIM_SECRET   dedicated encryption/signing secret (else derived from PREMIUM_ACCESS_KEY)
//   NQ_PRIZE_RANKS    how many weekly ranks win a prize (default 1)
//   NQ_CLAIM_DAYS     claim window after the week ends, in days (default 14)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const leaderboard = require('./nq-leaderboard');

let _web3 = null, _nacl = null, _bs58 = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function nacl() { return (_nacl = _nacl || require('tweetnacl')); }
function bs58() { return (_bs58 = _bs58 || require('bs58')); }

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-claims.json');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
function claimDays() { const n = Number(process.env.NQ_CLAIM_DAYS); return Number.isFinite(n) && n > 0 ? n : 14; }
function prizeRanks() { const n = Number(process.env.NQ_PRIZE_RANKS); return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1; }

// Key separation (audit #32 pattern): PII encryption gets its OWN derived secret — distinct label
// from 'nq-lb-v1' / 'nq-wallet-v1' so no token family doubles as a decryption oracle. NO random
// fallback here on purpose: a random key would silently make every stored address unrecoverable
// after a restart, which for PII is worse than refusing to store it at all.
const RAW_SECRET = process.env.NQ_CLAIM_SECRET
  || (process.env.PREMIUM_ACCESS_KEY
      && crypto.createHmac('sha256', process.env.PREMIUM_ACCESS_KEY).update('nq-claims-v1').digest('hex'))
  || null;
function enabled() { return !!RAW_SECRET; }
function encKey() { return crypto.createHash('sha256').update(String(RAW_SECRET)).digest(); }   // 32 bytes

function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
function isPubkey(s) { try { new (web3().PublicKey)(s); return true; } catch (e) { return false; } }

// ---- store (volume JSON, atomic writes) ----------------------------------
function load() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function save(arr) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  require('../lib/atomic-write').atomicWriteFileSync(FILE, JSON.stringify(arr));
}

// ---- address handling ----------------------------------------------------
// Free-text postal fields, clipped hard. The NORMALIZED form feeds the dedupe hash; the hash is a
// REVIEW FLAG for the owner, never a hard block — hash-blocking free text just punishes honest
// households while a cheater adds a comma.
const ADDR_FIELDS = [['name', 64], ['line1', 96], ['line2', 96], ['city', 64], ['region', 64], ['postal', 24], ['country', 56]];
function cleanAddress(a) {
  a = a && typeof a === 'object' ? a : {};
  const out = {};
  for (const [k, n] of ADDR_FIELDS) out[k] = clip(a[k], n).replace(/[\r\n\t]/g, ' ').trim();
  if (!out.name || !out.line1 || !out.city || !out.country) return null;
  return out;
}
function addrHash(a) {
  const norm = ADDR_FIELDS.map(([k]) => String(a[k] || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 24);
}
function encryptAddress(a) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(a), 'utf8'), c.final()]);
  return { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: data.toString('base64') };
}
function decryptAddress(enc) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(enc.iv, 'hex'));
    d.setAuthTag(Buffer.from(enc.tag, 'hex'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8'));
  } catch (e) { return null; }
}

// ---- weekly winners ------------------------------------------------------
// A week is CLAIMABLE once it has ENDED. Winners = best run per verified wallet inside the week,
// non-suspect only, ranked by score (ties: earliest). Computed from the live store — a season
// reset therefore also resets pending winners, which is the point of a reset.
function isWeekStart(ms) { return Number.isFinite(ms) && leaderboard.weekStartMs(ms) === ms; }
function lastCompletedWeek(now) { return leaderboard.weekStartMs((now == null ? Date.now() : now) - WEEK_MS); }
async function winnersForWeek(weekStart, n) {
  const rows = (await leaderboard.list()).filter((r) =>
    r.at >= weekStart && r.at < weekStart + WEEK_MS && r.walletVerified && r.wallet && !r.suspect);
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.wallet);
    if (!cur || r.score > cur.score || (r.score === cur.score && r.at < cur.at)) best.set(r.wallet, r);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, n || prizeRanks())
    .map((r, i) => ({ rank: i + 1, wallet: r.wallet, name: r.name, world: r.world, score: r.score, at: r.at }));
}
function windowEndsAt(weekStart) { return weekStart + WEEK_MS + claimDays() * 24 * 60 * 60 * 1000; }

// ---- claim flow: prepare (mint the consent message) → submit (verify signature) ---------------
const pending = new Map();   // pubkey -> { week, address, hash, nonce, message, expiresAt }
function prunePending() { const now = Date.now(); for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k); }

async function eligibility(weekStart, pubkey) {
  const now = Date.now();
  if (!isWeekStart(weekStart) || weekStart + WEEK_MS > now) return { ok: false, status: 'week_not_ended' };
  if (now > windowEndsAt(weekStart)) return { ok: false, status: 'window_closed' };
  const winners = await winnersForWeek(weekStart);
  const me = winners.find((w) => w.wallet === pubkey);
  if (!me) return { ok: false, status: 'not_a_winner' };
  return { ok: true, rank: me.rank, winners };
}

async function prepare(pubkeyStr, weekStart, address) {
  if (!enabled()) return { ok: false, status: 'not_configured' };
  const pk = clip(pubkeyStr, 64).trim();
  if (!isPubkey(pk)) return { ok: false, status: 'bad_pubkey' };
  const week = Number(weekStart);
  const addr = cleanAddress(address);
  if (!addr) return { ok: false, status: 'bad_address' };
  const el = await eligibility(week, pk);
  if (!el.ok) return el;
  const already = load().find((c) => c.week === week && c.wallet === pk);
  if (already && already.shippedAt) return { ok: false, status: 'already_shipped' };
  prunePending();
  const nonce = crypto.randomBytes(12).toString('hex');
  const hash = addrHash(addr);
  // Human-readable consent text the wallet popup shows verbatim. The address hash inside the
  // signed text is what binds THIS address to THIS signature.
  const message = 'Normie Quest weekly prize claim\n\n'
    + 'Week starting: ' + new Date(week).toISOString().slice(0, 10) + ' (UTC)\n'
    + 'Winning wallet: ' + pk + '\n'
    + 'Shipping address fingerprint: ' + hash + '\n'
    + 'Nonce: ' + nonce + '\n\n'
    + 'I authorize Cluck Norris to use the shipping address I provided solely to deliver this prize. '
    + 'This is a signature only — it does NOT move any funds or approve any transaction.';
  pending.set(pk, { week, address: addr, hash, nonce, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { ok: true, message, expiresIn: CHALLENGE_TTL_MS, rank: el.rank };
}

async function submit(pubkeyStr, weekStart, signatureB58) {
  if (!enabled()) return { ok: false, status: 'not_configured' };
  const pk = clip(pubkeyStr, 64).trim();
  const week = Number(weekStart);
  const ch = pending.get(pk);
  if (!ch || ch.week !== week) return { ok: false, status: 'no_pending_claim' };
  if (ch.expiresAt < Date.now()) { pending.delete(pk); return { ok: false, status: 'expired' }; }
  let ok = false;
  try {
    const msgBytes = new TextEncoder().encode(ch.message);
    const sigBytes = bs58().decode(String(signatureB58 || ''));
    const pubBytes = new (web3().PublicKey)(pk).toBytes();
    ok = nacl().sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch (e) { return { ok: false, status: 'bad_signature' }; }
  if (!ok) return { ok: false, status: 'bad_signature' };
  const el = await eligibility(week, pk);   // re-check at submit — a reset mid-flow voids the win
  if (!el.ok) return el;
  pending.delete(pk);
  const arr = load().filter((c) => !(c.week === week && c.wallet === pk));   // re-claim = replace (window still open)
  const dup = arr.some((c) => c.addrHash === ch.hash && c.wallet !== pk);
  arr.push({ week, wallet: pk, rank: el.rank, addrHash: ch.hash, addrEnc: encryptAddress(ch.address),
             dupAddress: dup, at: Date.now(), shippedAt: null });
  save(arr);
  return { ok: true, claimed: true, rank: el.rank };
}

// ---- owner-side ----------------------------------------------------------
function listClaims() { return load(); }
function claimFor(week, wallet) { return load().find((c) => c.week === week && c.wallet === wallet) || null; }
// Permanently wipe the address once the prize is shipped; keep the audit stub.
function markShipped(week, wallet) {
  const arr = load();
  const c = arr.find((x) => x.week === Number(week) && x.wallet === wallet);
  if (!c) return { ok: false, status: 'not_found' };
  c.shippedAt = Date.now();
  delete c.addrEnc;
  save(arr);
  return { ok: true };
}

module.exports = { enabled, prizeRanks, claimDays, lastCompletedWeek, winnersForWeek, windowEndsAt,
                   eligibility, prepare, submit, listClaims, claimFor, decryptAddress, markShipped,
                   _addrHash: addrHash, _cleanAddress: cleanAddress };
