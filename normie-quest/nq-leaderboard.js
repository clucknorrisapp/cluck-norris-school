// Normie Quest — leaderboard store + score-submission anti-tamper floor.
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
//
// STORAGE IS PLUGGABLE so this scales past the JSON file when player counts grow:
//   - default: a JSON file on the Railway volume (great for tens–hundreds of players).
//   - flip to Postgres by setting NQ_LEADERBOARD_PG=1 and DATABASE_URL (+ `npm i pg`): atomic
//     INSERT per run, indexed ranked queries, no 6k cap, no lost-write races. Nothing else in the
//     game changes — the public API is identical (only its internals swap). If NQ_LEADERBOARD_PG
//     is set but `pg` isn't installed, it logs and safely falls back to the JSON store.
// The public storage methods are ASYNC (Postgres is async); the token logic stays sync.
//
// Boards (best run per distinct player; "per world" = reached world N or beyond):
//   topByWorld(world), topWeekly(), topAllTime(), boards({worlds,n}) — all async.
//
// Identity today = a typed handle; the schema also carries wallet + walletVerified so a verified
// wallet's runs are marked (giveaway draws filter to walletVerified). Anti-tamper: a short-lived
// HMAC run token issued at run start; presented-but-invalid = reject, implausibly fast/high = stored
// but flagged suspect (excluded from boards + draws), never silently dropped.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-leaderboard.json');
const MAX = 6000;                         // JSON backend only: hard cap on stored runs (prune oldest)
const RUN_TTL_MS = 2 * 60 * 60 * 1000;    // a run token is valid for 2h after issue
const MAX_PTS_PER_SEC = 600;              // plausibility ceiling on TOTAL score / TOTAL run time
const MIN_RUN_MS = 3000;                  // token issued at run START, so a real submit is never this fast

const SECRET = process.env.NQ_LB_SECRET || process.env.PREMIUM_ACCESS_KEY || crypto.randomBytes(24).toString('hex');

function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
function cleanName(v) {
  return clip(v, 16).replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim();
}
function intIn(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function weekStartMs(now) {
  const d = new Date(now == null ? Date.now() : now);
  const day = (d.getUTCDay() + 6) % 7;    // Mon=0 … Sun=6
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day, 0, 0, 0, 0);
}
const notSuspect = (r) => !r.suspect;

// Best run per distinct player (verified wallet if present, else lowercased name), ranked by score.
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

// ---- run tokens (HMAC) — storage-independent -----------------------------
function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const usedNonces = new Map();
function pruneNonces() { const now = Date.now(); for (const [k, exp] of usedNonces) if (exp < now) usedNonces.delete(k); }

function startRun(level) {
  const lvl = clip(level, 24);
  const nonce = crypto.randomBytes(12).toString('hex');
  const issuedAt = Date.now();
  const sig = sign(nonce + '.' + lvl + '.' + issuedAt);
  return { nonce, level: lvl, issuedAt, sig };
}
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

// ---- JSON file backend (default) -----------------------------------------
function jsonLoad() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function jsonSave(arr) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}
const jsonBackend = {
  insert(e) { let arr = jsonLoad(); arr.push(e); if (arr.length > MAX) arr = arr.slice(-MAX); return jsonSave(arr); },
  worldTop(w, n) { return rankDistinct(jsonLoad().filter((r) => r.world >= w && notSuspect(r)), n); },
  weeklyTop(n) { const ws = weekStartMs(); return rankDistinct(jsonLoad().filter((r) => r.at >= ws && notSuspect(r)), n); },
  allTimeTop(n) { return rankDistinct(jsonLoad().filter(notSuspect), n); },
  count() { return jsonLoad().length; },
  list() { return jsonLoad(); },
};

// ---- Postgres backend (opt-in) -------------------------------------------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nq_scores (
  id text PRIMARY KEY, at bigint NOT NULL, name text NOT NULL, world int NOT NULL, level text,
  score bigint NOT NULL, lives int, time_ms bigint, wallet text, wallet_verified boolean DEFAULT false,
  mode text, verified boolean DEFAULT false, suspect boolean DEFAULT false, ua text );
CREATE INDEX IF NOT EXISTS nq_scores_world_score ON nq_scores (world, score DESC) WHERE NOT suspect;
CREATE INDEX IF NOT EXISTS nq_scores_at ON nq_scores (at) WHERE NOT suspect;`;
const PK_EXPR = "(CASE WHEN wallet_verified AND wallet IS NOT NULL THEN 'w:'||wallet ELSE 'n:'||lower(name) END)";

function makePgBackend() {
  let pg; try { pg = require('pg'); } catch (e) { return null; }   // driver not installed → caller falls back
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.NQ_PG_POOL || 8),
    ssl: /^(1|true|yes|on)$/i.test(process.env.NQ_PG_SSL || '') ? { rejectUnauthorized: false } : false,
  });
  let schemaReady = null;
  function ensureSchema() { if (!schemaReady) schemaReady = pool.query(SCHEMA_SQL); return schemaReady; }
  function mapRow(r) {
    return { rank: 0, name: r.name, world: r.world, level: r.level, score: Number(r.score),
             wallet: r.wallet, walletVerified: r.wallet_verified, at: Number(r.at) };
  }
  // best-per-player (DISTINCT ON), then top-N by score; rank added in JS to match the JSON shape.
  async function ranked(where, params, n) {
    await ensureSchema();
    const sql =
      'SELECT name, world, level, score, wallet, wallet_verified, at FROM ('
      + '  SELECT DISTINCT ON ' + PK_EXPR + ' name, world, level, score, wallet, wallet_verified, at'
      + '  FROM nq_scores WHERE NOT suspect AND ' + where
      + '  ORDER BY ' + PK_EXPR + ', score DESC, at ASC'
      + ') t ORDER BY score DESC, at ASC LIMIT $' + (params.length + 1);
    const res = await pool.query(sql, [...params, n]);
    return res.rows.map((r, i) => { const o = mapRow(r); o.rank = i + 1; return o; });
  }
  return {
    async insert(e) {
      await ensureSchema();
      await pool.query(
        'INSERT INTO nq_scores(id,at,name,world,level,score,lives,time_ms,wallet,wallet_verified,mode,verified,suspect,ua)'
        + ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING',
        [e.id, e.at, e.name, e.world, e.level, e.score, e.lives, e.timeMs, e.wallet, e.walletVerified, e.mode, e.verified, e.suspect, e.ua]);
      return true;
    },
    worldTop(w, n) { return ranked('world >= $1', [w], n); },
    weeklyTop(n) { return ranked('at >= $1', [weekStartMs()], n); },
    allTimeTop(n) { return ranked('TRUE', [], n); },
    async count() { await ensureSchema(); const r = await pool.query('SELECT count(*)::int AS c FROM nq_scores'); return r.rows[0].c; },
    async list() { await ensureSchema(); const r = await pool.query('SELECT * FROM nq_scores ORDER BY at DESC LIMIT 5000'); return r.rows.map((x) => ({ ...x, walletVerified: x.wallet_verified, timeMs: Number(x.time_ms), score: Number(x.score), at: Number(x.at) })); },
    _pool: pool,   // exposed for tests / graceful shutdown
  };
}

// ---- backend selection ---------------------------------------------------
let backend = jsonBackend;
if (/^(1|true|yes|on)$/i.test(process.env.NQ_LEADERBOARD_PG || '') && process.env.DATABASE_URL) {
  const pgb = makePgBackend();
  if (pgb) { backend = pgb; }
  else { try { console.warn('[nq-leaderboard] NQ_LEADERBOARD_PG set but "pg" is not installed — using the JSON file store. Run `npm i pg`.'); } catch (e) {} }
}
function usingPg() { return backend !== jsonBackend; }

// ---- public API (async: storage may be Postgres) -------------------------
async function add(entry, token) {
  entry = entry || {};
  const score = intIn(entry.score, 0, 50000000, NaN);
  if (!Number.isFinite(score)) return { ok: false, status: 'bad_score' };
  const world = intIn(entry.world, 1, 99, 0);

  // A valid run token is MANDATORY. It used to be checked only when present, which made the
  // whole anti-tamper layer optional: omit the token field and a forged score landed with
  // suspect:false (suspect required tokenOK) and showed on every board. Reject tokenless submits.
  let elapsedMs = 0, tokenOK = false, status = 'no_token';
  if (token && (token.sig || token.nonce)) { const r = checkRun(token); tokenOK = r.ok; status = r.ok ? 'ok' : r.status; elapsedMs = r.elapsedMs || 0; }
  if (!tokenOK) return { ok: false, status };

  const secs = Math.max(elapsedMs, 1) / 1000;
  const suspect = tokenOK && score > 0 && (elapsedMs < MIN_RUN_MS || (score / secs) > MAX_PTS_PER_SEC);

  const e = {
    id: crypto.randomBytes(5).toString('hex'), at: Date.now(),
    name: cleanName(entry.name) || 'anon', world, level: clip(entry.level, 24).trim(), score,
    lives: intIn(entry.lives, 0, 99, 0), timeMs: elapsedMs,
    wallet: entry.walletVerified ? clip(entry.wallet, 64).trim() : null,
    walletVerified: !!entry.walletVerified, mode: clip(entry.mode, 24).trim(),
    verified: tokenOK, suspect, ua: clip(entry.ua, 200),
  };
  let ok; try { ok = await backend.insert(e); } catch (err) { return { ok: false, status: 'persist_failed' }; }
  if (ok === false) return { ok: false, status: 'persist_failed' };
  return { ok: true, id: e.id, suspect, verified: tokenOK };
}

async function topByWorld(world, n) { return backend.worldTop(intIn(world, 1, 99, 0), n || 10); }
async function topWeekly(n) { return backend.weeklyTop(n || 10); }
async function topAllTime(n) { return backend.allTimeTop(n || 10); }
async function boards(opts) {
  opts = opts || {};
  const worlds = opts.worlds || [], n = opts.n || 10;
  const [allTime, weekly, totalRuns] = await Promise.all([backend.allTimeTop(n), backend.weeklyTop(n), backend.count()]);
  const perWorld = {};
  await Promise.all(worlds.map(async (w) => { perWorld[w] = await backend.worldTop(w, n); }));
  return { weekStart: weekStartMs(), allTime, weekly, byWorld: perWorld, totalRuns };
}
async function list() { return backend.list(); }

module.exports = { startRun, checkRun, add, topByWorld, topWeekly, topAllTime, boards, list, weekStartMs, usingPg, _makePgBackend: makePgBackend };
