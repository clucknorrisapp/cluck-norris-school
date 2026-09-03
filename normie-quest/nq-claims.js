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
// non-suspect only, ranked by score (ties: earliest).
//
// The leaderboard store is CAPPED (newest 6000 rows on the JSON backend, newest 5000 on Postgres —
// see nq-leaderboard.js), so recomputing a past week live on every call can silently lose it: once
// enough runs land in later weeks, a completed week's rows age out of the capped store while its
// 14-day claim window is still open, and a real winner starts reading back as "not a winner." Once
// a week has ENDED, its winner set can never legitimately change (no more runs can land inside it),
// so the first time a completed week is evaluated, the result is snapshotted to disk and every
// later call for that week reads the snapshot instead of recomputing from the (by-then-pruned)
// live store. The in-progress current week is never snapshotted — it's still live/changing — and a
// season reset (resetBoard) also wipes this file via clearWinnersSnapshot(), preserving "a reset
// resets pending winners."
const WINNERS_FILE = path.join(process.env.DATA_DIR || '/data', 'nq-claim-winners.json');
// Fail-closed on corruption (same pattern as lib/sigstore.js / lib/credentials.js): these
// snapshots are the ONLY surviving record of a completed week's winners once its leaderboard rows
// age out of the capped store, so a torn/unreadable file must never be silently treated as "no
// snapshots yet" — that would let saveWinnersSnapshot() below overwrite it with just the current
// week, permanently erasing every other week's winners. Once set, blocks further writes until an
// operator restores the file (or the owner resets the season) and the process restarts.
let winnersQuarantined = false;
function loadWinnersSnapshot() {
  if (!fs.existsSync(WINNERS_FILE)) return {};
  try {
    const o = JSON.parse(fs.readFileSync(WINNERS_FILE, 'utf8'));
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    throw new Error('not a JSON object');
  } catch (e) {
    winnersQuarantined = true;
    try { fs.copyFileSync(WINNERS_FILE, `${WINNERS_FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[nq-claims] WINNERS SNAPSHOT FILE CORRUPT (${e.message}) — snapshotting disabled (fail-closed) until ${WINNERS_FILE} is restored (or the season reset) and the process restarted.`);
    return {};
  }
}
function saveWinnersSnapshot(store) {
  if (winnersQuarantined) throw new Error('winners snapshot quarantined after a corrupt read — refusing to write until restored/restarted');
  fs.mkdirSync(path.dirname(WINNERS_FILE), { recursive: true });
  require('../lib/atomic-write').atomicWriteFileSync(WINNERS_FILE, JSON.stringify(store));
}
// Owner season reset also clears the persisted winner snapshots, so a reset still resets pending
// winners exactly as before this cache existed. Also lifts a quarantine — deleting the file is
// itself the operator remediation the quarantine was waiting for.
function clearWinnersSnapshot() { try { fs.unlinkSync(WINNERS_FILE); } catch (e) {} winnersQuarantined = false; }

function isWeekStart(ms) { return Number.isFinite(ms) && leaderboard.weekStartMs(ms) === ms; }
function lastCompletedWeek(now) { return leaderboard.weekStartMs((now == null ? Date.now() : now) - WEEK_MS); }
async function winnersForWeek(weekStart, n) {
  const ended = Number.isFinite(weekStart) && weekStart + WEEK_MS <= Date.now();
  if (ended) {
    const snap = loadWinnersSnapshot()[String(weekStart)];
    if (Array.isArray(snap) && snap.length) return snap.slice(0, n || prizeRanks());
  }
  const allRows = await leaderboard.list();
  const rows = allRows.filter((r) =>
    r.at >= weekStart && r.at < weekStart + WEEK_MS && r.walletVerified && r.wallet && !r.suspect);
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.wallet);
    if (!cur || r.score > cur.score || (r.score === cur.score && r.at < cur.at)) best.set(r.wallet, r);
  }
  // Rank up to the max possible prizeRanks() (10) once, so the snapshot serves any n <= 10 without
  // recomputing; callers still get exactly n (or the current prizeRanks()) back below.
  const winners = [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 10)
    .map((r, i) => ({ rank: i + 1, wallet: r.wallet, name: r.name, world: r.world, score: r.score, at: r.at }));
  // Both backends CAP list() to the newest N rows overall (JSON: MAX=6000 total; Postgres: LIMIT
  // 5000), pruning oldest-first. A snapshot taken while the store has already pruned past
  // weekStart could freeze a partial winner set forever (no more runs will ever "complete" it).
  // Coverage is provable two ways, neither needing to know which backend is live:
  //   - the store hasn't even reached the SMALLER of the two caps yet, so nothing has ever been
  //     pruned from it (a fresh board, or simply not enough runs yet); or
  //   - pruning always removes the globally oldest rows first, so if the oldest row STILL in the
  //     store is at/before weekStart, nothing from weekStart onward could have been pruned —
  //     the week's rows are all still present.
  // Refuse to snapshot (recompute live every call, same as an un-ended week) until either holds.
  const LEADERBOARD_MIN_CAP = 5000;   // Postgres LIMIT — the smaller of the two backend caps
  const oldestAt = allRows.length ? Math.min(...allRows.map((r) => r.at)) : -Infinity;
  const coverageProven = allRows.length < LEADERBOARD_MIN_CAP || oldestAt <= weekStart;
  if (ended && winners.length && coverageProven) {
    const store = loadWinnersSnapshot();
    store[String(weekStart)] = winners;
    try { saveWinnersSnapshot(store); } catch (e) { console.error('[nq-claims] winners snapshot write failed:', e && e.message); }
  }
  return winners.slice(0, n || prizeRanks());
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
                   clearWinnersSnapshot,
                   _addrHash: addrHash, _cleanAddress: cleanAddress };
