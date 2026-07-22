// Normie Quest — playtest difficulty telemetry (deaths + level clears).
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Durable JSON on the Railway volume (defaults to /data, matching the main app stores). The game
// fire-and-forgets tiny events (death: world/x/cause, clear: world/time/deaths); the store
// aggregates them into per-world difficulty stats — death hotspots, causes, clear rates —
// so the digest can say "37% of deaths are the World 3 pit at x≈2400" instead of relying
// on remembered feedback. No PII: no wallets, no names, no IPs stored.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-telemetry.json');
const MAX = 8000;            // hard cap so the file can't grow unbounded (events are ~90 bytes)
const HOTSPOT_BUCKET = 160;  // px — one screen-ish slice; wide enough to merge near-identical deaths

function load() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function save(arr) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}
function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
function int(v, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; }

// Append one event. ev: 'death' | 'clear'. Never throws.
function add(o) {
  o = o || {};
  const ev = o.ev === 'clear' ? 'clear' : (o.ev === 'death' ? 'death' : null);
  if (!ev) return { ok: false, status: 'bad_ev' };
  const e = {
    ev,
    world: clip(o.world, 24).trim() || '?',
    x: int(o.x, 0, 100000),               // player x at death (px); 0 for clears
    cause: ev === 'death' ? (clip(o.cause, 48).trim() || 'UNKNOWN') : '',
    t: int(o.t, 0, 36000),                // seconds into the level
    deaths: ev === 'clear' ? int(o.deaths, 0, 999) : 0,   // lives lost in the level before clearing
    score: int(o.score, 0, 100000000),
    // panel-tester code (self-chosen, e.g. "T1" — from a ?tester= link; NOT a wallet/IP/name).
    // Lets the 10-person panel's data separate per tester without collecting PII.
    who: clip(o.who, 16).trim().replace(/[^A-Za-z0-9_-]/g, '') || '',
    at: Date.now(),
  };
  let arr = load();
  arr.push(e);
  if (arr.length > MAX) arr = arr.slice(-MAX);
  if (!save(arr)) return { ok: false, status: 'persist_failed' };
  return { ok: true };
}

// Aggregate events (optionally only those after sinceMs) into per-world difficulty stats.
function summary(sinceMs) {
  const since = Number(sinceMs) || 0;
  const evs = load().filter((e) => Number(e.at || 0) > since);
  const worlds = {};
  for (const e of evs) {
    const w = (worlds[e.world] = worlds[e.world] || { deaths: 0, clears: 0, clearTimes: [], clearDeaths: [], causes: {}, buckets: {} });
    if (e.ev === 'death') {
      w.deaths++;
      w.causes[e.cause] = (w.causes[e.cause] || 0) + 1;
      const b = Math.floor(e.x / HOTSPOT_BUCKET) * HOTSPOT_BUCKET;
      w.buckets[b] = (w.buckets[b] || 0) + 1;
    } else {
      w.clears++;
      w.clearTimes.push(e.t);
      w.clearDeaths.push(e.deaths);
    }
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  const out = Object.entries(worlds).map(([world, w]) => ({
    world,
    deaths: w.deaths,
    clears: w.clears,
    // deaths per clear = the honest difficulty number (Infinity-safe: no clears yet → null)
    deathsPerClear: w.clears ? Math.round((w.deaths / w.clears) * 10) / 10 : (w.deaths ? null : 0),
    avgClearSec: avg(w.clearTimes),
    avgDeathsBeforeClear: w.clearDeaths.length ? Math.round(avg(w.clearDeaths) * 10) / 10 : 0,
    topCauses: top(w.causes, 3).map(([cause, n]) => ({ cause, n })),
    hotspots: top(w.buckets, 3).map(([x, n]) => ({ xFrom: Number(x), xTo: Number(x) + HOTSPOT_BUCKET, n })),
  }));
  out.sort((a, b) => b.deaths - a.deaths);
  // PANEL rollup: per-tester coverage (which worlds each tagged tester played, deaths/clears).
  // Untagged events (who:'') aggregate under '(untagged)' so panel vs drive-by traffic separates.
  const testers = {};
  for (const e of evs) {
    const code = e.who || '(untagged)';
    const t = (testers[code] = testers[code] || { deaths: 0, clears: 0, worlds: {} });
    const tw = (t.worlds[e.world] = t.worlds[e.world] || { d: 0, c: 0 });
    if (e.ev === 'death') { t.deaths++; tw.d++; } else { t.clears++; tw.c++; }
  }
  return { events: evs.length, sinceTs: since, worlds: out, testers };
}

function count() { return load().length; }
function latestAt() { const a = load(); return a.length ? Number(a[a.length - 1].at || 0) : 0; }

// One world's stats with ALL death buckets (not just the top-3 the digest wants) — feeds the
// lab build's in-level death-heatmap overlay. Aggregate difficulty data only, no PII, so it's
// safe behind an ungated (cached) route.
function worldDetail(world) {
  const want = clip(world, 24).trim();
  if (!want) return { world: '', deaths: 0, clears: 0, buckets: [] };
  let deaths = 0, clears = 0;
  const causes = {}, buckets = {}, clearTimes = [], clearDeaths = [];
  for (const e of load()) {
    if (e.world !== want) continue;
    if (e.ev === 'death') {
      deaths++;
      causes[e.cause] = (causes[e.cause] || 0) + 1;
      const b = Math.floor(e.x / HOTSPOT_BUCKET) * HOTSPOT_BUCKET;
      buckets[b] = (buckets[b] || 0) + 1;
    } else { clears++; clearTimes.push(e.t); clearDeaths.push(e.deaths); }
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  return {
    world: want,
    deaths,
    clears,
    deathsPerClear: clears ? Math.round((deaths / clears) * 10) / 10 : (deaths ? null : 0),
    avgClearSec: avg(clearTimes),
    topCauses: Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cause, n]) => ({ cause, n })),
    buckets: Object.entries(buckets).map(([x, n]) => ({ xFrom: Number(x), xTo: Number(x) + HOTSPOT_BUCKET, n }))
      .sort((a, b) => a.xFrom - b.xFrom),
  };
}

// Everything in ONE pass, all-time: per-world full stats (all causes, all buckets, last-seen)
// plus global totals — feeds the operator dashboard. Aggregate difficulty data only, no PII.
function detailAll(sinceMs) {
  const since = Number(sinceMs || 0);
  const evs = since ? load().filter((e) => Number(e.at || 0) >= since) : load();
  const worlds = {}, testers = {};
  let deaths = 0, clears = 0, firstAt = 0, lastAt = 0;
  for (const e of evs) {
    const at = Number(e.at || 0);
    if (!firstAt || (at && at < firstAt)) firstAt = at;
    if (at > lastAt) lastAt = at;
    const w = (worlds[e.world] = worlds[e.world] || { deaths: 0, clears: 0, clearTimes: [], clearDeaths: [], causes: {}, buckets: {}, lastAt: 0 });
    if (at > w.lastAt) w.lastAt = at;
    if (e.ev === 'death') {
      deaths++; w.deaths++;
      w.causes[e.cause] = (w.causes[e.cause] || 0) + 1;
      const b = Math.floor(e.x / HOTSPOT_BUCKET) * HOTSPOT_BUCKET;
      w.buckets[b] = (w.buckets[b] || 0) + 1;
    } else { clears++; w.clears++; w.clearTimes.push(e.t); w.clearDeaths.push(e.deaths); }
    // panel-tester rollup (who tags from ?tester= links; untagged traffic groups separately)
    const code = e.who || '(untagged)';
    const t = (testers[code] = testers[code] || { deaths: 0, clears: 0, worlds: {}, lastAt: 0 });
    if (at > t.lastAt) t.lastAt = at;
    const tw = (t.worlds[e.world] = t.worlds[e.world] || { d: 0, c: 0 });
    if (e.ev === 'death') { t.deaths++; tw.d++; } else { t.clears++; tw.c++; }
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  const rows = Object.entries(worlds).map(([world, w]) => ({
    world,
    deaths: w.deaths,
    clears: w.clears,
    deathsPerClear: w.clears ? Math.round((w.deaths / w.clears) * 10) / 10 : (w.deaths ? null : 0),
    avgClearSec: avg(w.clearTimes),
    avgDeathsBeforeClear: w.clearDeaths.length ? Math.round(avg(w.clearDeaths) * 10) / 10 : 0,
    topCauses: Object.entries(w.causes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cause, n]) => ({ cause, n })),
    buckets: Object.entries(w.buckets).map(([x, n]) => ({ xFrom: Number(x), xTo: Number(x) + HOTSPOT_BUCKET, n })).sort((a, b) => a.xFrom - b.xFrom),
    lastAt: w.lastAt,
  }));
  return { events: evs.length, deaths, clears, firstAt, lastAt, worlds: rows, testers };
}

module.exports = { add, summary, count, latestAt, worldDetail, detailAll };
