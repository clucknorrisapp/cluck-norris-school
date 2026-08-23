// Normie Quest — per-player journey tracking (sessions, funnel, drop-off).
//
// Sits ALONGSIDE nq-telemetry rather than inside it. That store answers "how hard is this
// level" from a per-world ring of the newest 120 events; this one answers "what did one
// player actually do, and where did we lose them", which needs a different shape and a
// different retention policy. Keeping them separate means journey volume can never evict the
// difficulty data the tuning dashboard reads.
//
// TWO TIERS, because literal per-step tracking does not fit in a JSON file. At real traffic
// a single player clearing ten levels emits a few hundred events; a few hundred players a day
// is tens of thousands. So:
//
//   1. AGGREGATES — tiny, permanent, never evicted. Per level: starts, clears, deaths, quits,
//      powerups, and summed time. This is the funnel, and it stays honest forever because it
//      is counters, not rows.
//   2. SESSIONS — a rolling window of the newest SESSION_MAX sessions, each holding its newest
//      EVENTS_PER_SESSION events. This is the deep-dive: one player's actual path, in order.
//      Old sessions fall off; the aggregates they contributed to do not.
//
// No PII: `sid` is a random per-browser id the client mints, never a wallet, name, or IP. It
// exists so two events can be known to be the same person, and nothing else.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-journey.json');
const SESSION_MAX = 400;          // rolling detailed sessions (newest wins)
const EVENTS_PER_SESSION = 150;   // per-session ring — a long grinding run can't crowd others out
const FLUSH_MS = 2000;            // see the write-batching note on save() below
const IDLE_GAP_MS = 30 * 60 * 1000;  // a >30min gap starts a new "visit" for counting purposes

// Real level names, same source and same posture as nq-telemetry: unknown names are rejected so
// fabricated strings can't paint phantom funnel rows. Missing graph => fail open.
let LEVEL_SET = null, LEVEL_ORDER = [];
try {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'nq-level-graph.json'), 'utf8'));
  if (g && Array.isArray(g.levels) && g.levels.length) { LEVEL_SET = new Set(g.levels); LEVEL_ORDER = g.levels.slice(); }
} catch (e) { LEVEL_SET = null; }

const EVENTS = new Set(['start', 'death', 'clear', 'quit', 'powerup', 'ping']);

function blank() { return { agg: {}, sessions: {}, order: [] }; }

// IN-MEMORY STATE + DEBOUNCED FLUSH. The first cut of this store re-read and re-serialised the
// whole file on every single event, the way nq-telemetry does. That is fine for a store capped
// at a few thousand rows; here it is not. Measured on a realistic fill (600 sessions x 40
// events) a single track() took long enough that 200 sequential events did not finish in two
// minutes — the parse+stringify is O(file) and the file grows with traffic, so cost per event
// rises exactly when traffic does. Holding state in memory and flushing at most every FLUSH_MS
// makes track() O(1) and bounds disk writes to one every couple of seconds no matter the rate.
// Tradeoff: a hard crash loses up to FLUSH_MS of events. That is the right trade for telemetry.
let _mem = null;
let _dirty = false;
let _timer = null;

function load() {
  if (_mem) return _mem;
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _mem = (d && typeof d === 'object') ? d : blank();
  } catch (e) { _mem = blank(); }
  if (!_mem.agg) _mem.agg = {};
  if (!_mem.sessions) _mem.sessions = {};
  if (!Array.isArray(_mem.order)) _mem.order = [];
  return _mem;
}
function flush() {
  if (!_dirty || !_mem) return true;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    require('../lib/atomic-write').atomicWriteFileSync(FILE, JSON.stringify(_mem));
    _dirty = false;
    return true;
  } catch (e) { return false; }
}
function save() {
  _dirty = true;
  if (_timer) return true;               // a flush is already pending — coalesce into it
  _timer = setTimeout(() => { _timer = null; flush(); }, FLUSH_MS);
  if (_timer.unref) _timer.unref();      // never hold the process open for a telemetry write
  return true;
}
// Don't lose the tail of a window on a normal shutdown/redeploy.
process.on('beforeExit', flush);
process.on('SIGTERM', flush);
process.on('SIGINT', flush);
function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
function int(v, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; }
function sidOK(s) { return /^[A-Za-z0-9_-]{6,32}$/.test(s); }

// Append one journey event. Never throws — the client fire-and-forgets these.
function track(o) {
  o = o || {};
  const ev = clip(o.ev, 12).trim();
  if (!EVENTS.has(ev)) return { ok: false, status: 'bad_ev' };
  const sid = clip(o.sid, 32).trim();
  if (!sidOK(sid)) return { ok: false, status: 'bad_sid' };
  const world = clip(o.world, 24).trim();
  if (!world || (LEVEL_SET && !LEVEL_SET.has(world))) return { ok: false, status: 'bad_world' };

  const now = Date.now();
  const e = {
    ev, world,
    x: int(o.x, 0, 100000),
    t: int(o.t, 0, 36000),
    at: now,
  };
  if (ev === 'death') e.cause = clip(o.cause, 48).trim() || 'UNKNOWN';
  if (ev === 'powerup') e.item = clip(o.item, 32).trim() || 'UNKNOWN';
  if (ev === 'clear' || ev === 'quit') e.score = int(o.score, 0, 100000000);

  const d = load();

  // --- tier 1: permanent aggregates ---
  const a = (d.agg[world] = d.agg[world] || { starts: 0, clears: 0, deaths: 0, quits: 0, powerups: 0, secs: 0 });
  if (ev === 'start') a.starts++;
  else if (ev === 'clear') { a.clears++; a.secs += e.t; }
  else if (ev === 'death') a.deaths++;
  else if (ev === 'quit') a.quits++;
  else if (ev === 'powerup') a.powerups++;

  // --- tier 2: rolling per-session detail ---
  let s = d.sessions[sid];
  if (!s) {
    s = d.sessions[sid] = { first: now, last: now, visits: 1, events: [] };
    d.order.push(sid);
  } else if (now - (s.last || 0) > IDLE_GAP_MS) {
    s.visits = (s.visits || 1) + 1;   // came back later — same browser, new sitting
  }
  s.last = now;
  s.events.push(e);
  if (s.events.length > EVENTS_PER_SESSION) s.events = s.events.slice(-EVENTS_PER_SESSION);

  // rolling session eviction, oldest-first by arrival order
  if (d.order.length > SESSION_MAX) {
    const drop = d.order.splice(0, d.order.length - SESSION_MAX);
    for (const id of drop) delete d.sessions[id];
  }

  save();
  return { ok: true };
}

// Per-level funnel from the PERMANENT aggregates, in natural level order.
// dropRate = the share of players who started this level and neither cleared it nor are still
// in it — i.e. the leak. That is the number worth ranking levels by.
function funnel() {
  const d = load();
  const known = LEVEL_ORDER.length ? LEVEL_ORDER : Object.keys(d.agg).sort();
  const rows = [];
  for (const world of known) {
    const a = d.agg[world];
    if (!a || (!a.starts && !a.deaths && !a.clears)) continue;
    const starts = a.starts || 0, clears = a.clears || 0, quits = a.quits || 0;
    rows.push({
      world, starts, clears, deaths: a.deaths || 0, quits, powerups: a.powerups || 0,
      avgClearSec: clears ? Math.round(a.secs / clears) : 0,
      clearRate: starts ? Math.round((clears / starts) * 1000) / 10 : null,
      quitRate: starts ? Math.round((quits / starts) * 1000) / 10 : null,
    });
  }
  return rows;
}

// Levels ranked by where players actually give up (most quits first, then quit rate).
function dropOff(n) {
  return funnel()
    .filter((r) => r.quits > 0)
    .sort((a, b) => b.quits - a.quits || (b.quitRate || 0) - (a.quitRate || 0))
    .slice(0, Math.max(1, Math.min(100, n || 15)));
}

// Rolling-window session summaries, newest activity first.
function sessions(n) {
  const d = load();
  const out = [];
  for (const sid of Object.keys(d.sessions)) {
    const s = d.sessions[sid];
    const evs = s.events || [];
    const worlds = new Set(evs.map((e) => e.world));
    const cleared = new Set(evs.filter((e) => e.ev === 'clear').map((e) => e.world));
    const last = evs.length ? evs[evs.length - 1] : null;
    out.push({
      sid, first: s.first, last: s.last, visits: s.visits || 1,
      events: evs.length,
      levelsSeen: worlds.size, levelsCleared: cleared.size,
      deaths: evs.filter((e) => e.ev === 'death').length,
      powerups: evs.filter((e) => e.ev === 'powerup').length,
      lastWorld: last ? last.world : '', lastEv: last ? last.ev : '',
      minutes: Math.round(((s.last - s.first) / 60000) * 10) / 10,
    });
  }
  out.sort((a, b) => b.last - a.last);
  return out.slice(0, Math.max(1, Math.min(500, n || 50)));
}

// One session's full ordered path — the "every step" view for a single player.
function sessionDetail(sid) {
  const d = load();
  const s = d.sessions[clip(sid, 32)];
  if (!s) return null;
  return { sid, first: s.first, last: s.last, visits: s.visits || 1, events: s.events || [] };
}

// Headline counts. `sinceMs` scopes the session-derived numbers to the rolling window only —
// the aggregate totals below it are all-time and cannot be scoped, which is the tradeoff for
// them never expiring.
function overview(sinceMs) {
  const d = load();
  const since = Number(sinceMs) || 0;
  const ids = Object.keys(d.sessions);
  let active = 0, totalEvents = 0, returning = 0;
  for (const id of ids) {
    const s = d.sessions[id];
    if ((s.last || 0) > since) active++;
    if ((s.visits || 1) > 1) returning++;
    totalEvents += (s.events || []).length;
  }
  let starts = 0, clears = 0, deaths = 0, quits = 0, powerups = 0;
  for (const w of Object.keys(d.agg)) {
    const a = d.agg[w];
    starts += a.starts || 0; clears += a.clears || 0; deaths += a.deaths || 0;
    quits += a.quits || 0; powerups += a.powerups || 0;
  }
  return {
    sessionsTracked: ids.length, sessionsActive: active, returningSessions: returning,
    sessionEvents: totalEvents, windowCap: SESSION_MAX,
    starts, clears, deaths, quits, powerups,
    overallClearRate: starts ? Math.round((clears / starts) * 1000) / 10 : null,
  };
}

module.exports = { track, funnel, dropOff, sessions, sessionDetail, overview, flush, EVENTS, SESSION_MAX, EVENTS_PER_SESSION };
