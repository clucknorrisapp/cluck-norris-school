// lib/analytics.js — first-party, privacy-respecting traffic analytics.
//
// No cookies, no third-party scripts, no PII stored, no vendor cost. Visitor
// uniqueness is a daily SALTED hash of IP+UA (one-way; can't be reversed to an
// identity and rotates every day), kept only as a per-day set of opaque hashes
// for de-duping. Persisted to the kvstore (/data volume) so a restart doesn't
// lose history. Flushed on a timer (not per-request) so we don't hammer disk.
const crypto = require("crypto");
const kv = require("./kvstore");

const KV_KEY = "analytics_v1";
const KEEP_DAYS = 90;
// Salt the visitor hash so the stored hashes aren't a reversible IP list. With neither env var
// set, the old fallback was a hardcoded literal string, identical in every checkout — reversible
// against a public IP/UA guess the same way lib/traction.js's fallback was (Codex brief, Round 2,
// batch 8, finding #3; same stored-salt fix, same kv key convention as that file). A fresh
// install with no env var generates its own random salt ONCE (crypto.randomBytes(32), hex) and
// persists it under kv `traction:salt_v1` — never logged, read back on every later call. No
// persistent kv volume falls back to a per-process random salt: never the literal string, just
// not stable across a restart.
const STORED_SALT_KEY = "traction:salt_v1";
let _procSalt = null;
function persistedSalt() {
  let existing = null;
  try { existing = kv.get(STORED_SALT_KEY, null); } catch (_) { existing = null; }
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const fresh = crypto.randomBytes(32).toString("hex");
  try {
    const ok = typeof kv.setVerified === "function" ? kv.setVerified(STORED_SALT_KEY, fresh) === true : (kv.set(STORED_SALT_KEY, fresh), true);
    if (ok) return fresh;
  } catch (_) { /* fall through to the process-local salt below */ }
  return null;
}
function resolveSalt() {
  if (process.env.ANALYTICS_SALT) return process.env.ANALYTICS_SALT;
  if (process.env.PREMIUM_ACCESS_KEY) return process.env.PREMIUM_ACCESS_KEY;
  const stored = persistedSalt();
  if (stored) return stored;
  if (!_procSalt) _procSalt = crypto.randomBytes(32).toString("hex");
  return _procSalt;
}
const SALT = resolveSalt();

// In-memory working state. visitors is a Set per day (O(1) de-dup); serialized
// to/from an array when persisting.
let days = {}; // 'YYYY-MM-DD' -> { views, paths:{}, hosts:{}, tools:{}, refs:{}, funnel:{}, visitors:Set, engaged:Set }
// WHY "ENGAGED" EXISTS (2026-09-15). From 2026-08-16 the site recorded ~5,000 views a day from
// ~4,500 distinct visitor hashes — one page each, under 1% carrying a referrer — where the earlier
// baseline was ~300 visitors at three pages each. That is automated traffic wearing a browser
// user agent, and BOT_RE cannot see it. So a visitor is counted as ENGAGED only after a second
// page view in the day or a learning-funnel event. Raw views and visitor-days are still kept
// (they are what they always were), but any public claim about people should quote `engaged`.
// Views are also keyed by HOST, because the game domain and the CUNA staking domain land on
// this same server and their "/" used to be indistinguishable from the homepage.
// In-memory per-day view counts per visitor hash, for the second-view test. Not persisted: a
// restart loses at most one partial day's "second view" detection, never the sets themselves.
const viewCounts = {}; // day -> { hash: n }
let dirty = false;

function load() {
  const saved = kv.get(KV_KEY, null);
  if (saved && saved.days) {
    for (const [d, b] of Object.entries(saved.days)) {
      days[d] = {
        views: b.views || 0, paths: b.paths || {}, hosts: b.hosts || {}, tools: b.tools || {},
        refs: b.refs || {}, funnel: b.funnel || {}, visitors: new Set(b.visitors || []),
        engaged: new Set(b.engaged || []),
      };
    }
  }
}
load();

const dayId = () => new Date().toISOString().slice(0, 10);
function bucket(d) {
  if (!days[d]) days[d] = { views: 0, paths: {}, hosts: {}, tools: {}, refs: {}, funnel: {}, visitors: new Set(), engaged: new Set() };
  if (!days[d].funnel) days[d].funnel = {};       // back-compat for buckets saved before funnel existed
  if (!days[d].hosts) days[d].hosts = {};         // …and before hosts / engaged existed
  if (!days[d].engaged) days[d].engaged = new Set();
  return days[d];
}
function visitorId(ip, ua, d) {
  return crypto.createHash("sha256").update(`${ip}|${ua}|${d}|${SALT}`).digest("hex").slice(0, 16);
}
function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < cutoff) { delete days[d]; delete viewCounts[d]; }
}
// The TCP-level Host header, never req.hostname (see rawHost in server.js: with trust proxy on,
// req.hostname prefers a client-supplied X-Forwarded-Host). Lowercased, port and www. stripped.
function hostOf(req) {
  return String((req.headers && req.headers.host) || "").toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "").slice(0, 64) || "-";
}
function markEngaged(b, hash) { if (hash && !b.engaged.has(hash)) { b.engaged.add(hash); dirty = true; } }

// Filter out the obvious non-humans so the counts mean something.
const BOT_RE = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternal|headless|phantomjs|preview|uptime|monitor|pingdom|curl|wget|python-requests|axios|node-fetch|go-http|libwww|okhttp/i;

function trackView(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || BOT_RE.test(ua)) return;
  const ip = req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0";
  const d = dayId();
  const b = bucket(d);
  b.views++;
  const path = (req.path || "/").split("?")[0].slice(0, 64);
  // Cap distinct path keys/day (same abuse guard as trackFunnel) — page requests aren't
  // rate-limited, so /aaa1, /aaa2, … could otherwise bloat today's bucket without bound.
  if (b.paths[path] || Object.keys(b.paths).length <= 600) b.paths[path] = (b.paths[path] || 0) + 1;
  const host = hostOf(req);
  if (b.hosts[host] || Object.keys(b.hosts).length <= 50) b.hosts[host] = (b.hosts[host] || 0) + 1;
  const hash = visitorId(ip, ua, d);
  b.visitors.add(hash);
  const vc = viewCounts[d] || (viewCounts[d] = {});
  vc[hash] = (vc[hash] || 0) + 1;
  if (vc[hash] >= 2) markEngaged(b, hash);
  try {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) {
      const h = new URL(ref).hostname.replace(/^www\./, "");
      if (h && !/clucknorris/i.test(h) && (b.refs[h] || Object.keys(b.refs).length <= 600)) b.refs[h] = (b.refs[h] || 0) + 1;   // cap distinct referrers/day (spoofable header)
    }
  } catch (_) {}
  dirty = true;
}

// Tool/engagement counter — e.g. trackTool("autopsy"). Page-view agnostic.
function trackTool(name) {
  bucket(dayId()).tools[name] = (bucket(dayId()).tools[name] || 0) + 1;
  dirty = true;
}

// Learning-funnel counter — e.g. trackFunnel("lesson_complete:liquidity"). Lets us
// see where learners drop off (start -> complete per lesson, school/incubator/challenge/
// graduation steps). Whitelisted shape only; capped key count so it can't be spammed.
const FUNNEL_RE = /^[a-z_]+(:[a-z0-9-]{1,48})?$/;
// `req` is optional: when the caller has one, a funnel event proves a real browser ran the
// school's JS, so that visitor counts as engaged even on a single page.
function trackFunnel(event, req) {
  event = String(event || "").toLowerCase().slice(0, 64);
  if (!FUNNEL_RE.test(event)) return;
  const d = dayId();
  const b = bucket(d);
  const f = b.funnel;
  if (!f[event] && Object.keys(f).length > 600) return; // abuse guard
  f[event] = (f[event] || 0) + 1;
  if (req) {
    const ua = String(req.headers["user-agent"] || "");
    const ip = req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "0";
    if (ua && !BOT_RE.test(ua)) { const hash = visitorId(ip, ua, d); b.visitors.add(hash); markEngaged(b, hash); }
  }
  dirty = true;
}

function serialize() {
  const out = { days: {} };
  for (const [d, b] of Object.entries(days)) {
    out.days[d] = { views: b.views, paths: b.paths, hosts: b.hosts || {}, tools: b.tools, refs: b.refs, funnel: b.funnel || {}, visitors: [...b.visitors], engaged: [...(b.engaged || [])] };
  }
  return out;
}
function flush() { if (!dirty) return; prune(); kv.set(KV_KEY, serialize()); dirty = false; }
setInterval(flush, 30000).unref();   // persist at most every 30s (not per request)

function summary(nDays = 30) {
  const dates = Object.keys(days).sort().slice(-nDays);
  const series = dates.map(d => ({ date: d, views: days[d].views, visitors: days[d].visitors.size, engaged: (days[d].engaged || new Set()).size }));
  const totals = { views: 0, visitorDays: 0, engagedVisitorDays: 0 };
  const paths = {}, hosts = {}, tools = {}, refs = {}, funnel = {};
  for (const d of dates) {
    const b = days[d];
    totals.views += b.views; totals.visitorDays += b.visitors.size; totals.engagedVisitorDays += (b.engaged || new Set()).size;
    for (const [k, v] of Object.entries(b.paths)) paths[k] = (paths[k] || 0) + v;
    for (const [k, v] of Object.entries(b.hosts || {})) hosts[k] = (hosts[k] || 0) + v;
    for (const [k, v] of Object.entries(b.tools)) tools[k] = (tools[k] || 0) + v;
    for (const [k, v] of Object.entries(b.refs)) refs[k] = (refs[k] || 0) + v;
    for (const [k, v] of Object.entries(b.funnel || {})) funnel[k] = (funnel[k] || 0) + v;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  const td = days[dayId()];
  return {
    rangeDays: nDays,
    today: { views: td ? td.views : 0, visitors: td ? td.visitors.size : 0, engaged: td && td.engaged ? td.engaged.size : 0 },
    totals,                       // views = total pageviews; visitorDays = unique visitors summed per day; engagedVisitorDays = visitors with a 2nd page or a funnel event — QUOTE THIS ONE for people
    series,                       // daily { date, views, visitors, engaged }
    topPaths: top(paths, 15),
    topHosts: top(hosts, 10),     // the game and staking domains share this server; their "/" is not the homepage
    topTools: top(tools, 12),
    topReferrers: top(refs, 12),
    funnel,                       // learning funnel: { 'lesson_start:x': n, 'lesson_complete:x': n, ... }
  };
}

module.exports = { trackView, trackTool, trackFunnel, summary, flush, hostOf };
