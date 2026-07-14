// lib/helius-usage.js — first-party Helius call attribution.
//
// Answers the question "what is burning our Helius credits?" precisely, instead
// of guessing from the vendor dashboard (which shows method + IP but not WHICH
// of our subsystems made the call). Every JSON-RPC call flows through
// rpc.rpcFetch (our rpcCall wrappers, the /api/helius-rpc proxy, AND the
// Orca/Meteora SDK Connections, which are built with fetch: rpcFetch), so
// instrumenting that one chokepoint captures the bulk of the standard-RPC load.
// The Enhanced-Transactions REST calls (wallet-watch, wallet-xray, /api/helius-tx)
// bypass JSON-RPC, so those note() directly.
//
// Attribution comes from the JSON-RPC `id` label our callers already pass
// (e.g. "autopsy-sigs-3" -> caller "autopsy-sigs", "reconcile", "wo"). SDK calls
// carry a numeric id and bucket as "sdk" — which is itself the tell: a big "sdk"
// getAccountInfo count == the liquidity-engine read layer, not the public tools.
//
// Public proxy calls also record the CLIENT IP so external farming of the raw
// proxy is visible with actionable addresses. Everything is best-effort and
// wrapped so telemetry can NEVER break an RPC call. Persisted to the kvstore
// (/data) so a restart doesn't lose the picture.

const kv = require("./kvstore");

const KV_KEY = "helius_usage_v1";
const KEEP_DAYS = 14;
const MAX_PROXY_IPS = 400; // bound the per-day proxy-IP map; keep the heaviest

// day -> { methods:{m:n}, callers:{c:n}, endpoints:{host:n}, proxyIps:{ip:{n,eps:{}}}, total:n }
let days = {};
let dirty = false;

function load() {
  try {
    const s = kv.get(KV_KEY, null);
    if (s && s.days) days = s.days;
  } catch (_) {}
}
load();

const dayId = () => new Date().toISOString().slice(0, 10);
function bucket(d) {
  if (!days[d]) days[d] = { methods: {}, callers: {}, endpoints: {}, proxyIps: {}, total: 0 };
  return days[d];
}
function prune() {
  const cut = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(days)) if (d < cut) delete days[d];
}

// "autopsy-sigs-3" -> "autopsy-sigs"; pure-numeric SDK ids -> "sdk".
function callerFromId(id) {
  if (id == null) return "sdk";
  let s = String(id);
  if (/^\d+$/.test(s)) return "sdk"; // web3.js / SDK Connections use numeric ids
  s = s.replace(/-\d+$/, "");                 // strip trailing page/index (-3)
  s = s.replace(/-[0-9a-zA-Z]{6,}$/, "");     // strip trailing address/hex shard
  return s.slice(0, 48) || "sdk";
}

function bump(obj, key, by) { if (key) obj[key] = (obj[key] || 0) + (by || 1); }

// Record one logical JSON-RPC call (method + caller). host is optional (served endpoint).
function note(method, caller, host) {
  try {
    const b = bucket(dayId());
    b.total++;
    bump(b.methods, method || "unknown", 1);
    bump(b.callers, caller || "sdk", 1);
    if (host) bump(b.endpoints, host, 1);
    dirty = true;
  } catch (_) {}
}

// Record a JSON-RPC request body (object or batch array) seen at rpc.rpcFetch.
function noteBody(body, host) {
  try {
    let parsed = body;
    if (typeof body === "string") parsed = JSON.parse(body);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      if (!it || typeof it.method !== "string") continue;
      note(it.method, Array.isArray(parsed) ? "batch" : callerFromId(it.id), host);
    }
  } catch (_) {}
}

// Record a public-proxy hit with the client IP so farming is traceable.
// endpoint is a label ("helius-rpc" / "helius-tx"); count is the fan-out size
// (batch length / signature count) so one IP can't hide amplification.
function noteProxy(ip, endpoint, count) {
  try {
    ip = String(ip || "unknown").slice(0, 60);
    count = Math.max(1, Number(count) || 1);
    const b = bucket(dayId());
    let rec = b.proxyIps[ip];
    if (!rec) {
      if (Object.keys(b.proxyIps).length >= MAX_PROXY_IPS) {
        // evict the lightest IP to bound storage
        let minIp = null, min = Infinity;
        for (const [k, v] of Object.entries(b.proxyIps)) if (v.n < min) { min = v.n; minIp = k; }
        if (minIp && min <= count) delete b.proxyIps[minIp]; else { dirty = true; return; }
      }
      rec = b.proxyIps[ip] = { n: 0, eps: {} };
    }
    rec.n += count;
    bump(rec.eps, endpoint, count);
    dirty = true;
  } catch (_) {}
}

function flush() { if (!dirty) return; try { prune(); kv.set(KV_KEY, { days }); } catch (_) {} dirty = false; }
setInterval(flush, 30000).unref();

function topOf(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
}

function summary(nDays = 7, topN = 25) {
  const dates = Object.keys(days).sort().slice(-nDays);
  const methods = {}, callers = {}, endpoints = {}, proxyIps = {};
  let total = 0;
  const series = [];
  for (const d of dates) {
    const b = days[d];
    series.push({ date: d, total: b.total });
    total += b.total;
    for (const [k, v] of Object.entries(b.methods)) bump(methods, k, v);
    for (const [k, v] of Object.entries(b.callers)) bump(callers, k, v);
    for (const [k, v] of Object.entries(b.endpoints || {})) bump(endpoints, k, v);
    for (const [ip, v] of Object.entries(b.proxyIps || {})) {
      const t = proxyIps[ip] || (proxyIps[ip] = { n: 0, eps: {} });
      t.n += v.n; for (const [e, c] of Object.entries(v.eps || {})) bump(t.eps, e, c);
    }
  }
  const proxyList = Object.entries(proxyIps).sort((a, b) => b[1].n - a[1].n).slice(0, topN)
    .map(([ip, v]) => ({ ip, n: v.n, endpoints: topOf(v.eps, 4) }));
  const proxyTotal = Object.values(proxyIps).reduce((s, v) => s + v.n, 0);
  const proxyIpVals = Object.values(proxyIps).map(v => v.n).sort((a, b) => b - a);
  const share = (n) => proxyTotal ? +(proxyIpVals.slice(0, n).reduce((s, x) => s + x, 0) / proxyTotal * 100).toFixed(1) : 0;
  return {
    rangeDays: nDays,
    note: "Attributes Helius calls by our subsystem. caller 'sdk' = Orca/Meteora SDK + web3.js Connection reads (the liquidity engine). 'batch' = /api/helius-rpc batched calls. proxyIps covers ONLY the public raw proxies (helius-rpc / helius-tx) — that's where external farming would show.",
    total,
    series,
    topMethods: topOf(methods, 20),
    topCallers: topOf(callers, 25),
    endpointsServed: endpoints,               // failover visibility (primary vs backup vs public node)
    proxy: {
      totalCalls: proxyTotal,
      distinctIps: Object.keys(proxyIps).length,
      concentration: { topIpPct: share(1), top5IpPct: share(5) },
      topIps: proxyList,
    },
  };
}

module.exports = { note, noteBody, noteProxy, summary, flush, callerFromId };
