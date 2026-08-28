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
  // Coarse device class ('mobile'|'desktop'), derived server-side from the UA by the route —
  // one word per SESSION, never the raw user-agent (the no-PII posture above holds). Last
  // write wins; a sid is per-browser so it can't genuinely flip anyway.
  const dev = clip(o.dev, 8).trim();
  if (dev === 'mobile' || dev === 'desktop') s.dev = dev;
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

// Per-level funnel. TWO SOURCES, and the choice matters:
//
//   sinceMs = 0  -> the PERMANENT aggregate counters. Complete and all-time, but they are
//                   counters with no timestamps, so they cannot be sliced by time at all.
//   sinceMs > 0  -> recomputed from the timestamped SESSION EVENTS. Sliceable to any window,
//                   but only sees what is still inside the rolling retention (SESSION_MAX
//                   sessions x EVENTS_PER_SESSION events each).
//
// So a windowed view can UNDERCOUNT relative to all-time once retention starts biting — the
// caller gets `partial: true` and the retention numbers so the dashboard can say so out loud
// rather than quietly showing a smaller number as if it were the whole truth.
function emptyRow(world) {
  return { world, starts: 0, clears: 0, deaths: 0, quits: 0, powerups: 0, secs: 0 };
}
function shape(world, a) {
  const starts = a.starts || 0, clears = a.clears || 0, quits = a.quits || 0;
  return {
    world, starts, clears, deaths: a.deaths || 0, quits, powerups: a.powerups || 0,
    avgClearSec: clears ? Math.round((a.secs || 0) / clears) : 0,
    clearRate: starts ? Math.round((clears / starts) * 1000) / 10 : null,
    quitRate: starts ? Math.round((quits / starts) * 1000) / 10 : null,
  };
}
function funnel(sinceMs) {
  const d = load();
  const since = Number(sinceMs) || 0;
  let src;
  if (!since) {
    src = d.agg;
  } else {
    src = {};
    for (const sid of Object.keys(d.sessions)) {
      for (const e of (d.sessions[sid].events || [])) {
        if ((e.at || 0) <= since) continue;
        const a = (src[e.world] = src[e.world] || emptyRow(e.world));
        if (e.ev === 'start') a.starts++;
        else if (e.ev === 'clear') { a.clears++; a.secs += (e.t || 0); }
        else if (e.ev === 'death') a.deaths++;
        else if (e.ev === 'quit') a.quits++;
        else if (e.ev === 'powerup') a.powerups++;
      }
    }
  }
  const known = LEVEL_ORDER.length ? LEVEL_ORDER : Object.keys(src).sort();
  const rows = [];
  for (const world of known) {
    const a = src[world];
    if (!a || (!a.starts && !a.deaths && !a.clears && !a.quits)) continue;
    rows.push(shape(world, a));
  }
  return rows;
}

// Levels ranked by where players actually give up (most quits first, then quit rate).
function dropOff(n, sinceMs) {
  return funnel(sinceMs)
    .filter((r) => r.quits > 0)
    .sort((a, b) => b.quits - a.quits || (b.quitRate || 0) - (a.quitRate || 0))
    .slice(0, Math.max(1, Math.min(100, n || 15)));
}

// Hardest levels in a window, by deaths per clear. Same shape as the difficulty dashboard's
// ranking but sliceable, and it counts a quit as a failed attempt — a level people flee from
// is hard even when nobody stuck around long enough to die on it.
function hardest(n, sinceMs) {
  return funnel(sinceMs)
    .filter((r) => r.deaths > 0 || r.quits > 0)
    .map((r) => Object.assign({}, r, {
      deathsPerClear: r.clears ? Math.round((r.deaths / r.clears) * 10) / 10 : (r.deaths ? null : 0),
      failRate: r.starts ? Math.round(((r.starts - r.clears) / r.starts) * 1000) / 10 : null,
    }))
    .sort((a, b) => {
      if (a.deathsPerClear === null && b.deathsPerClear !== null) return -1;   // never-cleared first
      if (b.deathsPerClear === null && a.deathsPerClear !== null) return 1;
      return (b.deathsPerClear || 0) - (a.deathsPerClear || 0) || b.deaths - a.deaths;
    })
    .slice(0, Math.max(1, Math.min(100, n || 15)));
}

// Rolling-window session summaries, newest activity first.
function sessions(n, sinceMs) {
  const d = load();
  const since = Number(sinceMs) || 0;
  const out = [];
  for (const sid of Object.keys(d.sessions)) {
    const s = d.sessions[sid];
    if (since && (s.last || 0) <= since) continue;
    const evs = since ? (s.events || []).filter((e) => (e.at || 0) > since) : (s.events || []);
    if (since && !evs.length) continue;
    const worlds = new Set(evs.map((e) => e.world));
    const cleared = new Set(evs.filter((e) => e.ev === 'clear').map((e) => e.world));
    const last = evs.length ? evs[evs.length - 1] : null;
    out.push({
      sid, first: s.first, last: s.last, visits: s.visits || 1, dev: s.dev || '',
      events: evs.length,
      levelsSeen: worlds.size, levelsCleared: cleared.size,
      deaths: evs.filter((e) => e.ev === 'death').length,
      powerups: evs.filter((e) => e.ev === 'powerup').length,
      lastWorld: last ? last.world : '', lastEv: last ? last.ev : '',
      // span of the events actually in view — a windowed row must not report a 3-hour session
      // because the player also played yesterday.
      minutes: Math.round((((evs.length ? evs[evs.length - 1].at : s.last) - (evs.length ? evs[0].at : s.first)) / 60000) * 10) / 10,
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
  return { sid, first: s.first, last: s.last, visits: s.visits || 1, dev: s.dev || '', events: s.events || [] };
}

// Headline counts. `sinceMs` scopes the session-derived numbers to the rolling window only —
// the aggregate totals below it are all-time and cannot be scoped, which is the tradeoff for
// them never expiring.
function overview(sinceMs) {
  const d = load();
  const since = Number(sinceMs) || 0;
  const ids = Object.keys(d.sessions);
  let active = 0, totalEvents = 0, returning = 0;
  const devices = { mobile: 0, desktop: 0, unknown: 0 };   // unknown = sessions from before tagging shipped (or blank UA)
  const spans = [];   // minutes played per session IN WINDOW — the "how long are they playing" answer
  for (const id of ids) {
    const s = d.sessions[id];
    const evs = since ? (s.events || []).filter((e) => (e.at || 0) > since) : (s.events || []);
    if (since && !evs.length) continue;
    active++;
    devices[s.dev === 'mobile' || s.dev === 'desktop' ? s.dev : 'unknown']++;
    if ((s.visits || 1) > 1) returning++;
    totalEvents += evs.length;
    const a = evs.length ? evs[0].at : s.first, b = evs.length ? evs[evs.length - 1].at : s.last;
    spans.push(Math.max(0, (b - a) / 60000));
  }
  // Median as well as mean: one marathon session drags a mean badly on small samples, and on
  // launch day the sample IS small. The median is the honest "typical player" number.
  spans.sort((x, y) => x - y);
  const mean = spans.length ? spans.reduce((t, v) => t + v, 0) / spans.length : 0;
  const median = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2]
    : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : 0;
  const r1 = (v) => Math.round(v * 10) / 10;

  const f = funnel(since);
  let starts = 0, clears = 0, deaths = 0, quits = 0, powerups = 0;
  for (const r of f) { starts += r.starts; clears += r.clears; deaths += r.deaths; quits += r.quits; powerups += r.powerups; }

  return {
    sinceMs: since,
    uniquePlayers: active,              // distinct browsers with activity in the window
    devices,                            // coarse split of those browsers: mobile / desktop / unknown
    sessionsTracked: ids.length, sessionsActive: active, returningSessions: returning,
    sessionEvents: totalEvents, windowCap: SESSION_MAX, eventsPerSessionCap: EVENTS_PER_SESSION,
    avgMinutes: r1(mean), medianMinutes: r1(median), totalMinutes: r1(spans.reduce((t, v) => t + v, 0)),
    longestMinutes: r1(spans.length ? spans[spans.length - 1] : 0),
    starts, clears, deaths, quits, powerups,
    levelsTouched: f.length,
    overallClearRate: starts ? Math.round((clears / starts) * 1000) / 10 : null,
    // A windowed view reads only the rolling retention, so it can undercount once that fills.
    // Surfaced rather than hidden: a smaller number must not be mistaken for less play.
    partial: !!since && ids.length >= SESSION_MAX,
  };
}

module.exports = { track, funnel, dropOff, hardest, sessions, sessionDetail, overview, flush, EVENTS, SESSION_MAX, EVENTS_PER_SESSION };
