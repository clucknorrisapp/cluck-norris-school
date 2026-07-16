// Normie Quest — leaderboard store + score-submission anti-tamper floor.
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Durable JSON on the Railway volume (DATA_DIR), same pattern as nq-feedback / the burn guard.
// Nothing here touches funds, secrets of the main app, or private keys.
//
// Boards supported (computed at query time from the raw run list):
//   - top players per WORLD (all-time)         topByWorld(world)
//   - top players this WEEK (global)           topWeekly()
//   - top players all-time (global)            topAllTime()
//
// Identity today = a typed handle. The schema ALSO carries an optional `wallet` +
// `walletVerified` so, once we settle the wallet-ownership method (sign-message read-only
// connect, or the randomized-send proof like the CLKN gate), verified runs slot in with no
// migration. Giveaway draws can then filter to walletVerified === true.
//
// Anti-tamper (a floor, not a wall — deliberately layered so we can harden later):
//   - startRun(level) issues a short-lived HMAC-signed run token.
//   - submit() requires a valid, unexpired, single-use token, and stamps the real elapsed
//     wall-time. Runs that submit implausibly fast, or score faster than a points/second
//     ceiling, are STORED but flagged `suspect:true` (never silently dropped) so the owner /
//     giveaway logic can exclude them. A future phase can add deterministic re-simulation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'nq-leaderboard.json');
const MAX = 6000;                         // hard cap on stored runs (prune oldest beyond this)
const RUN_TTL_MS = 2 * 60 * 60 * 1000;    // a run token is valid for 2h after issue
const MAX_PTS_PER_SEC = 400;              // plausibility ceiling: above this rate a run is flagged suspect
const MIN_RUN_MS = 3000;                  // token issued at run START, so a real submit is never this fast

// Secret for signing run tokens. Prefer an explicit env; fall back to the site key; last resort a
// per-boot random (tokens simply don't survive a restart, which is fine for minutes-long runs).
const SECRET = process.env.NQ_LB_SECRET || process.env.PREMIUM_ACCESS_KEY || crypto.randomBytes(24).toString('hex');

function load() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }                // first run: no file yet
}
function save(arr) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}

function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
function cleanName(v) {
  // handle: alphanumerics + space / underscore / hyphen / dot only (strips control chars, angle
  // brackets, quotes — the store never trusts input for HTML). Collapses runs of whitespace.
  return clip(v, 16).replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim();
}
function intIn(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

// ---- run tokens (HMAC) --------------------------------------------------
function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32); }
function safeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
const usedNonces = new Map();             // nonce -> expiry ms (single-use guard, time-pruned)
function pruneNonces() { const now = Date.now(); for (const [k, exp] of usedNonces) if (exp < now) usedNonces.delete(k); }

// Issue a run token at level start. `level` is a free-form id like "3-2".
function startRun(level) {
  const lvl = clip(level, 24);
  const nonce = crypto.randomBytes(12).toString('hex');
  const issuedAt = Date.now();
  const sig = sign(nonce + '.' + lvl + '.' + issuedAt);
  return { nonce, level: lvl, issuedAt, sig };
}
// Validate a token presented at submit time. Returns { ok, elapsedMs } or { ok:false, status }.
function checkRun(tok) {
  tok = tok || {};
  const nonce = tok.nonce, level = tok.level, issuedAt = tok.issuedAt, sig = tok.sig;
  if (!nonce || !sig || !issuedAt) return { ok: false, status: 'no_token' };
  if (!safeEq(sig, sign(nonce + '.' + clip(level, 24) + '.' + issuedAt))) return { ok: false, status: 'bad_token' };
  const age = Date.now() - Number(issuedAt);
  if (age < 0 || age > RUN_TTL_MS) return { ok: false, status: 'expired' };
  pruneNonces();
  if (usedNonces.has(nonce)) return { ok: false, status: 'replay' };
  usedNonces.set(nonce, Date.now() + RUN_TTL_MS);
  return { ok: true, elapsedMs: age };
}

// ---- submission ---------------------------------------------------------
// entry: { name, world, level, score, lives?, wallet?, walletVerified?, mode?, ua? }
// token: the object returned by startRun. A PRESENTED-but-invalid token is a hard reject; a
// missing token stores the run flagged unverified (verified:false) so we can decide later
// whether tokenless runs count.
function add(entry, token) {
  entry = entry || {};
  const score = intIn(entry.score, 0, 50000000, NaN);
  if (!Number.isFinite(score)) return { ok: false, status: 'bad_score' };
  const world = intIn(entry.world, 1, 99, 0);

  let elapsedMs = 0, tokenOK = false, status = 'no_token';
  if (token && (token.sig || token.nonce)) { const r = checkRun(token); tokenOK = r.ok; status = r.ok ? 'ok' : r.status; elapsedMs = r.elapsedMs || 0; }
  if (token && !tokenOK) return { ok: false, status };     // a presented-but-invalid token = tampering → reject

  // plausibility: flag (don't drop) a run that submits too fast to be real, or scores faster than
  // a generous points/second ceiling. Only meaningful when we actually timed the run (tokenOK).
  const secs = Math.max(elapsedMs, 1) / 1000;
  const suspect = tokenOK && score > 0 && (elapsedMs < MIN_RUN_MS || (score / secs) > MAX_PTS_PER_SEC);

  const e = {
    id: crypto.randomBytes(5).toString('hex'),
    at: Date.now(),
    name: cleanName(entry.name) || 'anon',
    world,
    level: clip(entry.level, 24).trim(),
    score,
    lives: intIn(entry.lives, 0, 99, 0),
    timeMs: elapsedMs,
    wallet: entry.walletVerified ? clip(entry.wallet, 64).trim() : null,   // only keep a wallet we were told is verified
    walletVerified: !!entry.walletVerified,
    mode: clip(entry.mode, 24).trim(),
    verified: tokenOK,                    // had a valid run token
    suspect,                              // implausible — excluded from boards + prize draws
    ua: clip(entry.ua, 200),
  };
  let arr = load();
  arr.push(e);
  if (arr.length > MAX) arr = arr.slice(-MAX);
  if (!save(arr)) return { ok: false, status: 'persist_failed' };
  return { ok: true, id: e.id, suspect, verified: tokenOK };
}

// ---- queries ------------------------------------------------------------
function weekStartMs(now) {
  // UTC week starting Monday 00:00
  const d = new Date(now == null ? Date.now() : now);
  const day = (d.getUTCDay() + 6) % 7;    // Mon=0 … Sun=6
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day, 0, 0, 0, 0);
}

// Best run per distinct player (by verified wallet if present, else lowercased name), ranked by score.
function rankDistinct(rows, n) {
  const best = new Map();
  for (const r of rows) {
    const key = r.walletVerified && r.wallet ? 'w:' + r.wallet : 'n:' + (r.name || 'anon').toLowerCase();
    const cur = best.get(key);
    if (!cur || r.score > cur.score) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, n)
    .map((r, i) => ({ rank: i + 1, name: r.name, world: r.world, level: r.level, score: r.score,
                      wallet: r.wallet, walletVerified: r.walletVerified, at: r.at }));
}

const notSuspect = (r) => !r.suspect;

function topByWorld(world, n) {
  const w = intIn(world, 1, 99, 0);
  return rankDistinct(load().filter((r) => r.world === w && notSuspect(r)), n || 10);
}
function topWeekly(n) {
  const ws = weekStartMs();
  return rankDistinct(load().filter((r) => r.at >= ws && notSuspect(r)), n || 10);
}
function topAllTime(n) {
  return rankDistinct(load().filter(notSuspect), n || 10);
}
// One call for the in-game board: overall + weekly + a map of per-world tops.
function boards(opts) {
  opts = opts || {};
  const worlds = opts.worlds || [];
  const n = opts.n || 10;
  const all = load();
  const ws = weekStartMs();
  const perWorld = {};
  worlds.forEach((w) => { perWorld[w] = rankDistinct(all.filter((r) => r.world === w && notSuspect(r)), n); });
  return {
    weekStart: ws,
    allTime: rankDistinct(all.filter(notSuspect), n),
    weekly: rankDistinct(all.filter((r) => r.at >= ws && notSuspect(r)), n),
    byWorld: perWorld,
    totalRuns: all.length,
  };
}

function list() { return load(); }

module.exports = { startRun, checkRun, add, topByWorld, topWeekly, topAllTime, boards, list, weekStartMs };
