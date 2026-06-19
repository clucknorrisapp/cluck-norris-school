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
// Salt the visitor hash so the stored hashes aren't a reversible IP list.
const SALT = process.env.ANALYTICS_SALT || process.env.PREMIUM_ACCESS_KEY || "clkn-analytics-salt";

// In-memory working state. visitors is a Set per day (O(1) de-dup); serialized
// to/from an array when persisting.
let days = {}; // 'YYYY-MM-DD' -> { views, paths:{}, tools:{}, refs:{}, visitors:Set }
let dirty = false;

function load() {
  const saved = kv.get(KV_KEY, null);
  if (saved && saved.days) {
    for (const [d, b] of Object.entries(saved.days)) {
      days[d] = {
        views: b.views || 0, paths: b.paths || {}, tools: b.tools || {},
        refs: b.refs || {}, funnel: b.funnel || {}, visitors: new Set(b.visitors || []),
      };
    }
  }
}
load();

const dayId = () => new Date().toISOString().slice(0, 10);
function bucket(d) {
  if (!days[d]) days[d] = { views: 0, paths: {}, tools: {}, refs: {}, funnel: {}, visitors: new Set() };
  if (!days[d].funnel) days[d].funnel = {}; // back-compat for buckets saved before funnel existed
  return days[d];
}
function visitorId(ip, ua, d) {
  return crypto.createHash("sha256").update(`${ip}|${ua}|${d}|${SALT}`).digest("hex").slice(0, 16);
}
function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
}

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
  b.paths[path] = (b.paths[path] || 0) + 1;
  b.visitors.add(visitorId(ip, ua, d));
  try {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) {
      const h = new URL(ref).hostname.replace(/^www\./, "");
      if (h && !/clucknorris/i.test(h)) b.refs[h] = (b.refs[h] || 0) + 1;
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
function trackFunnel(event) {
  event = String(event || "").toLowerCase().slice(0, 64);
  if (!FUNNEL_RE.test(event)) return;
  const f = bucket(dayId()).funnel;
  if (!f[event] && Object.keys(f).length > 600) return; // abuse guard
  f[event] = (f[event] || 0) + 1;
  dirty = true;
}

function serialize() {
  const out = { days: {} };
  for (const [d, b] of Object.entries(days)) {
    out.days[d] = { views: b.views, paths: b.paths, tools: b.tools, refs: b.refs, funnel: b.funnel || {}, visitors: [...b.visitors] };
  }
  return out;
}
function flush() { if (!dirty) return; prune(); kv.set(KV_KEY, serialize()); dirty = false; }
setInterval(flush, 30000).unref();   // persist at most every 30s (not per request)

function summary(nDays = 30) {
  const dates = Object.keys(days).sort().slice(-nDays);
  const series = dates.map(d => ({ date: d, views: days[d].views, visitors: days[d].visitors.size }));
  const totals = { views: 0, visitorDays: 0 };
  const paths = {}, tools = {}, refs = {}, funnel = {};
  for (const d of dates) {
    const b = days[d];
    totals.views += b.views; totals.visitorDays += b.visitors.size;
    for (const [k, v] of Object.entries(b.paths)) paths[k] = (paths[k] || 0) + v;
    for (const [k, v] of Object.entries(b.tools)) tools[k] = (tools[k] || 0) + v;
    for (const [k, v] of Object.entries(b.refs)) refs[k] = (refs[k] || 0) + v;
    for (const [k, v] of Object.entries(b.funnel || {})) funnel[k] = (funnel[k] || 0) + v;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
  const td = days[dayId()];
  return {
    rangeDays: nDays,
    today: { views: td ? td.views : 0, visitors: td ? td.visitors.size : 0 },
    totals,                       // views = total pageviews; visitorDays = unique visitors summed per day
    series,                       // daily { date, views, visitors }
    topPaths: top(paths, 15),
    topTools: top(tools, 12),
    topReferrers: top(refs, 12),
    funnel,                       // learning funnel: { 'lesson_start:x': n, 'lesson_complete:x': n, ... }
  };
}

module.exports = { trackView, trackTool, trackFunnel, summary, flush };
