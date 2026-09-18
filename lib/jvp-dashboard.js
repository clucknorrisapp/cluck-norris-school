"use strict";
const { SOL_ADDR_RE } = require("./solana-addr");   // one address shape (simplifier pass, 2026-09-17)
// JVP engine dashboard — the READ-ONLY data layer behind /liquidity-engine.
//
// Everything here is a view. It never arms, pauses, rolls or signs; it holds no key; the only
// vault calls are status()/publicPositions()/dislocation(), which are the same reads the
// Telegram /liquidity command and the client portal already make. Public responses are
// SANITIZED here (never in the page): no operator pubkey, no float balances, no P&L — the
// /vault wrapper injects `operator` into every body and that must not reach a public page.
//
// Why history-first: all engines are paused by the owner (2026-09-05). A "live" gauge would
// render a stopped fleet and be found out in thirty seconds; the story is the recorded organic
// score trajectory (which decays to zero without runtime — the stop levers proven on live data),
// the organic-vs-router volume split (the anti-wash proof), and the pure decision engine
// replayed on live inputs. External data comes from two free, keyless sources and is cached
// hard with serve-last-good on failure: Jupiter tokens/v2 (organic score, holders, liquidity,
// organic vs total buy volume) and GeckoTerminal (per-pool volume, hourly OHLCV) — the latter
// 429s after a handful of calls per minute, so nothing here fetches it on a hot path.
const { rollGate, buybackDecision } = require("./engine-decisions");
const engineSimScenarios = require("./engine-sim-scenarios");

const TTL = { status: 120e3, market: 120e3, gecko: 600e3, ohlcv: 900e3, log: 60e3, transfers: 900e3 };
// A project's own token + the handful of quotes the engine trades against — enough to label a
// transfer's symbol without a network call or exposing the mint address itself. Not exhaustive;
// an unrecognized mint reads as "TOKEN" rather than leaking its address.
const KNOWN_QUOTE_SYMBOLS = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "So11111111111111111111111111111111111111112": "SOL",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "JUP",
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij": "BTC",
};
const TRANSFER_CAP = 50;
const JUP_TOKENS = "https://lite-api.jup.ag/tokens/v2/search?query=";
const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana/pools";
const UA = { accept: "application/json", "user-agent": "clucknorris.app engine dashboard" };

// ── memo with serve-last-good ──────────────────────────────────────────────────
// A failed refresh (429, timeout) returns the previous value flagged stale rather than an
// error, so the page never blanks a panel because a free API had a bad minute.
// The cache entry carries its freshness: `observedAt` is when the value was actually fetched,
// `stale` is set the first time a refresh fails and STAYS set on every later read until a refresh
// succeeds (a second reviewer caught the first version dropping the label on the next hit).
const cache = new Map();
function withFreshness(entry) {
  const v = entry.value;
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") return v;
  return entry.stale ? { ...v, stale: true, observedAt: entry.observedAt, staleError: entry.staleError || null } : { ...v, observedAt: entry.observedAt };
}
async function memo(key, ttl, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.inflight) return hit.inflight;
  if (hit && now - hit.at < ttl) return withFreshness(hit);
  const inflight = (async () => {
    try {
      const value = await fn();
      const entry = { at: Date.now(), observedAt: Date.now(), value, stale: false };
      cache.set(key, entry);
      return withFreshness(entry);
    } catch (e) {
      const err = String(e.message || e).slice(0, 120);
      if (hit && hit.value !== undefined && hit.value !== null) {
        const entry = { at: now - ttl + 60e3, observedAt: hit.observedAt, value: hit.value, stale: true, staleError: err };   // retry in a minute, serve the old one meanwhile
        cache.set(key, entry);
        return withFreshness(entry);
      }
      cache.set(key, { at: now - ttl + 60e3, observedAt: null, value: null, stale: true, staleError: err });
      return null;
    }
  })();
  cache.set(key, { ...(hit || { at: 0, value: null }), inflight });
  const out = await inflight;
  const cur = cache.get(key); if (cur && cur.inflight === inflight) delete cur.inflight;
  return out;
}
function _resetCache() { cache.clear(); }
// Test hook: age every cache entry past any TTL so the next read refreshes (and may fail).
function _expireForTests() { for (const [k, e] of cache) cache.set(k, { ...e, at: 0 }); }

async function getJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ── Jupiter: organic score, holders, liquidity, and the organic-vs-router split ───
function pickJupiter(list, mint) {
  const arr = Array.isArray(list) ? list : [];
  // Exact identifier match ONLY — a search that returns some other token must not be labelled
  // with the requested mint (second-reviewer finding).
  const t = arr.find((x) => x && x.id === mint);
  if (!t) return null;
  const s = t.stats24h || {};
  const buy = Number(s.buyVolume) || 0, sell = Number(s.sellVolume) || 0;
  const buyOrg = Number(s.buyOrganicVolume) || 0, sellOrg = Number(s.sellOrganicVolume) || 0;
  const total = buy + sell, organic = buyOrg + sellOrg;
  const liq = Number(t.liquidity) || 0, mcap = Number(t.mcap) || 0;
  return {
    mint, symbol: t.symbol || null, name: t.name || null,
    organicScore: Number.isFinite(Number(t.organicScore)) ? Number(t.organicScore) : null,
    organicLabel: t.organicScoreLabel || null,
    holderCount: Number.isFinite(Number(t.holderCount)) ? Number(t.holderCount) : null,
    liquidityUsd: liq, mcapUsd: mcap, fdvUsd: Number(t.fdv) || null, usdPrice: Number(t.usdPrice) || null,
    // Jupiter's own "verified" bar is ~10% liquidity-to-market-cap; show the ratio, never a verdict.
    liqToMcapPct: mcap > 0 ? Number(((liq / mcap) * 100).toFixed(2)) : null,
    vol24h: { total, organic, router: Math.max(0, total - organic), buy, sell, buyOrganic: buyOrg, sellOrganic: sellOrg,
      organicPct: total > 0 ? Number(((organic / total) * 100).toFixed(1)) : null,
      numBuys: Number(s.numBuys) || 0, numSells: Number(s.numSells) || 0, numTraders: Number(s.numTraders) || 0 },
  };
}
function marketFacts(mint) {
  return memo("jup:" + mint, TTL.market, async () => pickJupiter(await getJson(JUP_TOKENS + encodeURIComponent(mint)), mint));
}

// ── GeckoTerminal: per-pool 24h volume (one multi call per fleet) and hourly OHLCV ──
function slimGeckoPool(d) {
  const a = (d && d.attributes) || {};
  const v = a.volume_usd || {}, tx = (a.transactions || {}).h24 || {};
  return {
    address: a.address || (d && d.id && String(d.id).replace(/^solana_/, "")) || null,
    name: a.name || null, feePct: a.pool_fee_percentage != null ? Number(a.pool_fee_percentage) : null,
    reserveUsd: Number(a.reserve_in_usd) || 0,
    volumeUsd: { h1: Number(v.h1) || 0, h6: Number(v.h6) || 0, h24: Number(v.h24) || 0 },
    tx24h: { buys: Number(tx.buys) || 0, sells: Number(tx.sells) || 0, buyers: Number(tx.buyers) || 0, sellers: Number(tx.sellers) || 0 },
  };
}
function poolsVolume(addresses) {
  const list = [...new Set((addresses || []).filter((a) => SOL_ADDR_RE.test(String(a))))].slice(0, 30);
  if (!list.length) return Promise.resolve({ pools: {} });
  return memo("gecko:multi:" + list.join(","), TTL.gecko, async () => {
    const d = await getJson(`${GECKO}/multi/${list.join(",")}`);
    const pools = {};
    for (const row of (d && d.data) || []) { const s = slimGeckoPool(row); if (s.address) pools[s.address] = s; }
    return { pools, at: Date.now() };
  });
}
// [[ts, o, h, l, c, vol], …] → [{t, c, v}] oldest → newest. Kept small: the page draws it.
function slimOhlcv(d) {
  const rows = (((d || {}).data || {}).attributes || {}).ohlcv_list || [];
  return rows.map((r) => ({ t: Number(r[0]) * 1000, c: Number(r[4]) || 0, v: Number(r[5]) || 0 }))
    .filter((r) => r.t > 0).sort((a, b) => a.t - b.t);
}
function poolOhlcv(address, hours = 168) {
  if (!SOL_ADDR_RE.test(String(address))) return Promise.resolve(null);
  const limit = Math.max(24, Math.min(1000, Number(hours) || 168));
  return memo(`gecko:ohlcv:${address}:${limit}`, TTL.ohlcv, async () =>
    ({ address, points: slimOhlcv(await getJson(`${GECKO}/${address}/ohlcv/hour?limit=${limit}`)), at: Date.now() }));
}

// ── Sanitized project view ─────────────────────────────────────────────────────
// What a public page may know about a tenant: identity, venue, the JVP profile knobs the
// protocol doc already publishes, paused/armed state, tick counters, pools, and ranges.
// Never: operator pubkey, float balances, costs/earnings/P&L, telegram chat ids, env names.
const PROFILE_KEYS = ["pair", "feeTierPct", "widthPct", "solEnabled", "solFeeTierPct", "solWidthPct", "jupEnabled", "jupFeeTierPct", "jupWidthPct",
  "btcEnabled", "maxActionsPerDay", "minRebalanceIntervalSec", "oorDwellSec", "baseDeployThresholdUsd", "priceGapGuardPct", "slippageBps",
  "redeployConvergePct", "buybackEnabled", "swapEnabled"];
// Freshness travels with every sanitized object: the memo layer marks a value stale when its
// refresh failed (and keeps marking it until a refresh succeeds); the sanitizers must carry that
// through, or a paused status observed an hour ago reads as a live fact (second-reviewer finding).
function freshnessOf(v) {
  if (!v || typeof v !== "object") return { observedAt: null, stale: true, state: "unavailable" };
  return { observedAt: v.observedAt || null, stale: !!v.stale, state: v.stale ? "stale" : "fresh", error: v.staleError || null };
}
function sanitizeStatus(st) {
  if (!st) return null;
  const cfg = st.config || {};
  const profile = {};
  for (const k of PROFILE_KEYS) if (cfg[k] !== undefined) profile[k] = cfg[k];
  const s = st.state || {};
  return {
    project: st.project, enabled: !!st.enabled, venue: st.venue || null, paused: !!st.paused, mode: st.mode || null,
    lastTickTs: s.lastTickTs || null, lastRebalanceTs: s.lastRebalanceTs || null,
    rebalanceCount: s.rebalanceCount || 0, dayActions: s.dayActions || 0,
    evenLast: s.evenLast ? { ts: s.evenLast.ts || null, action: s.evenLast.action || null, reason: String(s.evenLast.reason || "").slice(0, 200) } : null,
    profile, totalDeployedUsd: typeof st.totalDeployedUsd === "number" ? Number(st.totalDeployedUsd.toFixed(2)) : null,
    freshness: freshnessOf(st),
  };
}
function sanitizePositions(pp) {
  if (!pp || !Array.isArray(pp.positions)) return { positions: [], totalUsd: null };
  return {
    positions: pp.positions.map((p) => ({
      pair: p.pair, quoteSymbol: p.quoteSymbol, role: p.role,
      lower: p.lower, upper: p.upper, current: p.current, inRange: !!p.inRange,
      valueUsd: typeof p.valueUsd === "number" ? Number(p.valueUsd.toFixed(2)) : null,
    })),
    totalUsd: typeof pp.totalUsd === "number" ? Number(pp.totalUsd.toFixed(2)) : null,
    stale: !!pp.stale, cached: !!pp.cached, freshness: freshnessOf(pp),
  };
}
function sanitizeDislocation(d) {
  if (!d) return null;
  return {
    marketUsd: d.marketUsd ?? null, marketSource: d.marketSource || null, marketLiqUsd: d.marketLiqUsd ?? null,
    maxDevPct: d.maxDevPct ?? null, convergeTolPct: d.convergeTolPct ?? null,
    pools: (d.pools || []).map((p) => ({ pair: p.pair, feeTierPct: p.feeTierPct, address: p.address || null,
      tickUsd: p.tickUsd ?? null, devPct: typeof p.devPct === "number" ? Number(p.devPct.toFixed(3)) : null, error: p.error ? "unreadable" : null })),
    freshness: freshnessOf(d),
  };
}

// ── "What the engine would do now" — an ILLUSTRATIVE replay on public inputs ─────────
// Honest scope (second reviewer, 2026-09-10): buybackDecision IS the function the vault calls;
// rollGate is the pinned SPECIFICATION the sleeve ticks implement inline (lib/engine-decisions.js
// header), so the sleeve rows are the spec applied to the public range position, not a trace of
// the running loop. Inputs the public status does not carry are stated as assumptions, and the
// output is an APPROVED SCHEMA: action codes and coarse buckets only — never the float or
// inventory values (a first version leaked staged-quote and idle-token dollar figures through
// this panel and through the gates' own reason strings).
const REASON_CODES = [
  [/idle token ample/i, "idle_token_ample"], [/no spendable quote/i, "no_spendable_quote"], [/daily buyback cap/i, "buyback_day_cap"],
  [/anti-thrash/i, "anti_thrash"], [/^buy with/i, "would_buy"], [/buyback disabled/i, "buyback_disabled"], [/^paused/i, "paused"],
  [/dwell .*started/i, "oor_dwell_started"], [/dwelling/i, "oor_dwelling"], [/out of range \(dwell passed\)/i, "oor_roll"],
  [/width reconfig/i, "width_reconfig"], [/deploying staged/i, "deploy_staged"], [/daily cap reached/i, "day_cap"], [/in range/i, "in_range"],
];
function reasonCode(reason) {
  const r = String(reason || "");
  for (const [re, code] of REASON_CODES) if (re.test(r)) return code;
  return "other";
}
function bucketUsd(v, thr) {
  const n = Number(v) || 0, t = Number(thr) || 40;
  if (n <= 0) return "none";
  if (n < t) return "under_threshold";
  if (n < 2 * t) return "at_threshold";
  return "above_threshold";
}
function deriveDecisions({ status, positions, nowMs = Date.now() }) {
  const empty = { illustrative: true, sleeves: [], buyback: null, assumptions: ["no status"] };
  if (!status || !status.config) return empty;
  const cfg = status.config, st = status.state || {}, fl = status.float || {};
  const todayStamp = new Date(nowMs).toISOString().slice(0, 10);
  const staged = Math.max(0, (Number(fl.usdc) || 0) - (Number(cfg.usdcFloor) || 0));
  const idlePairUsd = (Number(fl.clkn) || 0) * (Number(st.lastPrice) || 0);
  const sinceLastRollSec = st.lastRebalanceTs ? (nowMs - st.lastRebalanceTs) / 1000 : null;
  const sleeves = [];
  for (const p of (positions && positions.positions) || []) {
    if (!(p.upper > p.lower)) continue;
    const frac = (p.current - p.lower) / (p.upper - p.lower);
    const g = rollGate({ cfg, nowMs, frac, oorSince: null, sinceLastRollSec: sinceLastRollSec == null ? 1e9 : sinceLastRollSec,
      dayActions: st.dayActions || 0, deployStagedUsd: staged, idlePairUsd, widthOffPct: 0 });
    sleeves.push({ pair: p.pair, role: p.role, frac: Number(frac.toFixed(3)), inRange: frac >= 0 && frac <= 1,
      action: g.action, urgent: !!g.urgent, reasonCode: reasonCode(g.reason) });
  }
  let buyback = null;
  try {
    const b = buybackDecision({ cfg, st: { paused: !!status.paused, lastPrice: st.lastPrice || 0, lastBuybackTs: null,
      buybacksToday: (st.buyback && st.buyback.buybacksToday) || 0, buybackDayStamp: todayStamp },
      float: { usdc: Number(fl.usdc) || 0, sol: Number(fl.sol) || 0, jup: Number(fl.jup) || 0, clkn: Number(fl.clkn) || 0 },
      prices: positions && positions.solUsd ? { solUsd: positions.solUsd, jupUsd: positions.jupUsd || 0 } : null, nowMs, todayStamp });
    buyback = { action: b.action, fromSym: b.fromSym || null, reasonCode: reasonCode(b.reason) };
  } catch (e) { buyback = { action: "error", reasonCode: "error" }; }
  return {
    illustrative: true,
    paused: !!status.paused,
    sleeves, buyback,
    // Coarse buckets relative to the published deploy threshold — never the amounts.
    inputs: { sinceLastRollSec: sinceLastRollSec == null ? null : Math.round(sinceLastRollSec), dayActions: st.dayActions || 0,
      stagedQuote: bucketUsd(staged, cfg.baseDeployThresholdUsd), idleToken: bucketUsd(idlePairUsd, cfg.baseDeployThresholdUsd) },
    assumptions: ["rollGate is the pinned specification of the sleeve ticks, not a trace of the running loop",
      "out-of-range dwell start is not public: every out-of-range sleeve reads as freshly out of range",
      "last buyback time is not public: treated as long ago", "width reconfig assumed 0", "one wallet-wide staged/idle figure applied to every sleeve"],
  };
}

// ── Organic history (kv rings written hourly by recordOrganicSnapshot in server.js) ──
function slimLog(log, limit = 336) {
  return (log || []).slice(-limit).map((e) => ({ t: e.ts, s: e.score ?? null, h: e.holders ?? null, l: e.liqUsd ?? null, v: e.vol24h ?? null,
    o: e.organicVol ?? null, tv: e.totalVol ?? null })).filter((e) => e.t);
}

// ── Evidence class 1: historical transfers — "what moved, not why" ──────────────
// Backfilled from Helius for the project's OPERATOR WALLET (never a client's own wallet), via
// `helius.fetchAddressHistory(wallet, {limit})` injected from server.js exactly like `vault`/
// `kv` — this file makes no network call it cannot cache. Public shape carries no wallet
// addresses (not the operator's, not a counterparty's — the signature alone lets a reader look
// it up on Solscan), no mint addresses, and a token symbol resolved only against the project's
// own token + a short list of known quotes (see KNOWN_QUOTE_SYMBOLS). Cached 15 min, serving
// last-good on a failed refresh the same way marketFacts()/poolsVolume() already do.
function symbolForMint(mint, project) {
  if (!mint) return "TOKEN";
  if (project && mint === project.tokenMint) return project.symbol || "TOKEN";
  return KNOWN_QUOTE_SYMBOLS[mint] || "TOKEN";
}
function slimTransfers(txs, wallet, project, cap = TRANSFER_CAP) {
  const rows = [];
  for (const tx of Array.isArray(txs) ? txs : []) {
    if (!tx || !tx.signature) continue;
    const t = Number(tx.timestamp) > 0 ? Number(tx.timestamp) * 1000 : null;
    for (const n of tx.nativeTransfers || []) {
      const amount = (Number(n.amount) || 0) / 1e9;
      if (amount <= 0) continue;
      if (n.toUserAccount === wallet) rows.push({ t, direction: "in", symbol: "SOL", amount, signature: tx.signature });
      else if (n.fromUserAccount === wallet) rows.push({ t, direction: "out", symbol: "SOL", amount, signature: tx.signature });
    }
    for (const tt of tx.tokenTransfers || []) {
      const amount = Number(tt.tokenAmount) || 0;
      if (amount <= 0) continue;
      const symbol = symbolForMint(tt.mint, project);
      if (tt.toUserAccount === wallet) rows.push({ t, direction: "in", symbol, amount, signature: tx.signature });
      else if (tt.fromUserAccount === wallet) rows.push({ t, direction: "out", symbol, amount, signature: tx.signature });
    }
  }
  rows.sort((a, b) => (b.t || 0) - (a.t || 0));
  return rows.slice(0, cap);
}
function operatorHistory({ helius, vault, id, project }) {
  if (!helius || typeof helius.fetchAddressHistory !== "function") return Promise.resolve(null);
  let wallet = null;
  try { wallet = typeof vault.operatorPubkey === "function" ? vault.operatorPubkey(id) : null; } catch (_) { wallet = null; }
  if (!wallet) return Promise.resolve(null); // no operator key configured for this project — nothing to fetch
  return memo("xfer:" + id, TTL.transfers, async () => {
    const txs = await helius.fetchAddressHistory(wallet, { limit: TRANSFER_CAP });
    return { rows: slimTransfers(txs, wallet, project) };
  });
}

// ── Evidence class 2: retained decision events ("decision log") ─────────────────
// Reads the kv ring `engineLog:<project>` written by ONE choke point in lib/whirlpool-vault.js
// (the `tick` wrapper — see recordDecision there). A local kv read, no network, no memo needed.
// While an engine is paused, tick() returns { action: "none", reason: "paused" } BEFORE doing
// anything and recordDecision() deliberately never logs that — so an empty log on a paused
// project means exactly what it looks like, and says so instead of reading as missing data.
function decisionLog(kv, id, paused) {
  const raw = kv.get(`engineLog:${id}`, []) || [];
  const rows = raw.filter((e) => e && e.t && e.action).map((e) => ({
    t: e.t, action: e.action, reason: e.reason || "", price: typeof e.price === "number" ? e.price : null,
  }));
  if (!rows.length) {
    return { retained: 0, rows: [], note: paused ? "the engine is paused; no decisions are being made or recorded" : "no data retained for this period" };
  }
  return { retained: rows.length, rows };
}

// ── Evidence class 3: illustrative simulator runs ────────────────────────────────
// The real incidents replayed by scripts/engine-sim-test.cjs, exposed as data via
// lib/engine-sim-scenarios.js (a small, pure, duplicated subset — see that file's header for
// why it is not a shared import). Never project-specific: the gate logic is the same for every
// tenant, so the same replayed table is shown on every project detail.
function simulatorScenarios() { return engineSimScenarios.list(); }

// ── ROSE-class honesty flag: a discarded fee counter, never the poisoned number ──
// vault.earnings(id) sanity-checks its own stored realized-fee counters and returns
// `realizedSuspect` (a list of the offending field names) when one failed the check — see
// lib/whirlpool-vault.js earnings(). The dashboard may say a counter was discarded; it must
// never say by how much or repeat the discarded value, and it never surfaces P&L at all.
function earningsSuspect({ vault, id }) {
  if (!vault || typeof vault.earnings !== "function") return Promise.resolve(false);
  return memo("earn:" + id, TTL.status, async () => {
    const e = await vault.earnings(id);
    return { suspect: !!(e && Array.isArray(e.realizedSuspect) && e.realizedSuspect.length > 0) };
  }).then((v) => !!(v && v.suspect));
}

// ── Assembly ────────────────────────────────────────────────────────────────────
// vault: whirlpoolMM.vault (listProjects/status/publicPositions/dislocation); kv: the store;
// clknMint: so the built-in project reads its own ring; extraProjects lets the caller hide
// tenants that are not part of the JVP story (the treasury vault is CLKN's own, not a client).
async function projectSnapshot({ vault, kv, id, project, clknMint }) {
  const [status, positions, disl] = await Promise.all([
    memo("status:" + id, TTL.status, () => vault.status(id)),
    memo("pos:" + id, TTL.status, () => vault.publicPositions(id)),
    memo("disl:" + id, TTL.status, () => vault.dislocation(id)),
  ]);
  const mint = project.tokenMint;
  const market = await marketFacts(mint);
  const logKey = mint === clknMint ? "clknOrganicLog" : `organicLog:${mint}`;
  const log = slimLog(kv.get(logKey, []) || []);
  const fr = { status: freshnessOf(status), positions: freshnessOf(positions), dislocation: freshnessOf(disl), market: freshnessOf(market) };
  const anyStale = Object.values(fr).some((f) => f.state === "stale"), anyUnavailable = Object.values(fr).some((f) => f.state === "unavailable");
  return {
    id, label: project.label || id, symbol: project.symbol || id.toUpperCase(), tokenMint: mint, venue: project.venue || "orca",
    status: sanitizeStatus(status), positions: sanitizePositions(positions), dislocation: sanitizeDislocation(disl),
    market, organicHistory: log,
    decisions: deriveDecisions({ status, positions }),
    // Evidence class 2 (retained decision events) — a local kv read, cheap enough to carry on
    // every snapshot (overview included), unlike the network-backed transfers/earnings checks
    // below which are fetched only for the project detail page.
    decisionLog: decisionLog(kv, id, !!(status && status.paused)),
    freshness: { ...fr, summary: anyUnavailable ? "partial" : anyStale ? "stale" : "fresh" },
  };
}

async function overview({ vault, kv, clknMint, include }) {
  const all = vault.listProjects();
  const ids = Object.keys(all).filter((id) => (include ? include.includes(id) : true));
  // Independent reads, so they run together; a failed one is still its own row, never a gap.
  const projects = await Promise.all(ids.map((id) =>
    projectSnapshot({ vault, kv, id, project: all[id], clknMint })
      .catch((e) => ({ id, label: (all[id] && all[id].label) || id, error: String(e.message || e).slice(0, 120) }))));
  // One GeckoTerminal multi call for every engine pool address in the fleet.
  const addrs = [];
  for (const p of projects) for (const pool of ((p.dislocation && p.dislocation.pools) || [])) if (pool.address) addrs.push(pool.address);
  const vol = await poolsVolume(addrs);
  for (const p of projects) for (const pool of ((p.dislocation && p.dislocation.pools) || [])) {
    const g = vol && vol.pools && pool.address ? vol.pools[pool.address] : null;
    if (g) { pool.volume24hUsd = g.volumeUsd.h24; pool.reserveUsd = g.reserveUsd; pool.tx24h = g.tx24h; }
  }
  // Aggregate that keeps uncertainty: a failed read is UNKNOWN, never "paused" (second-reviewer
  // finding). The owner's stop order is a historical fact shown separately from observed state.
  const states = projects.map((p) => p.error || !p.status ? "unknown" : !p.status.enabled ? "disabled" : p.status.paused ? "paused" : "running");
  const counts = states.reduce((a, st) => { a[st] = (a[st] || 0) + 1; return a; }, {});
  const staleStatuses = projects.filter((p) => p.status && p.status.freshness && p.status.freshness.stale).length;
  const observedAts = projects.map((p) => p.status && p.status.freshness && p.status.freshness.observedAt).filter(Boolean);
  const fleetState = counts.running ? "running" : counts.unknown ? "unknown" : (counts.paused || counts.disabled) ? "paused" : "unknown";
  return { updatedAt: Date.now(), fleetState, fleetCounts: counts, fleetPaused: fleetState === "paused",
    // Aggregate freshness: the OLDEST observation behind the fleet verdict, and how many of the
    // statuses are being served from a failed-refresh cache. "paused" with staleStatuses > 0 means
    // "was paused when last read", and the page says so.
    fleetFreshness: { staleStatuses, oldestObservedAt: observedAts.length ? Math.min(...observedAts) : null, state: staleStatuses ? "stale" : counts.unknown ? "partial" : "fresh" },
    ownerStopOrder: { since: "2026-09-05", note: "no liquidity engine runs for any project (owner instruction)" },
    projects, geckoStale: !!(vol && vol.stale) };
}

// helius: optional { fetchAddressHistory(wallet, {limit}) } injected from server.js, the same
// way vault/kv are — this file makes no network call of its own. Absent (or no operator key
// configured), transfers come back unavailable rather than thrown.
async function projectDetail({ vault, kv, clknMint, id, hours, helius }) {
  const all = vault.listProjects();
  const project = all[id];
  if (!project) return null;
  const snap = await projectSnapshot({ vault, kv, id, project, clknMint });
  const pools = (snap.dislocation && snap.dislocation.pools) || [];
  const vol = await poolsVolume(pools.map((p) => p.address).filter(Boolean));
  for (const pool of pools) {
    const g = vol && vol.pools && pool.address ? vol.pools[pool.address] : null;
    if (g) { pool.volume24hUsd = g.volumeUsd.h24; pool.reserveUsd = g.reserveUsd; pool.tx24h = g.tx24h; }
    // Hourly volume per pool — fetched lazily, sequentially, cached 15 min (GeckoTerminal 429s fast).
    const o = pool.address ? await poolOhlcv(pool.address, hours) : null;
    pool.hourly = o && o.points ? o.points : [];
    pool.hourlyStale = !!(o && o.stale);
  }
  // Evidence class 1 (historical transfers) and the ROSE-class honesty flag — network-backed,
  // so only fetched for the single project a viewer opened, never for the whole fleet overview.
  const [xfer, suspect] = await Promise.all([
    operatorHistory({ helius, vault, id, project }).catch(() => null),
    earningsSuspect({ vault, id }).catch(() => false),
  ]);
  snap.transfers = xfer
    ? { available: true, rows: xfer.rows || [], freshness: freshnessOf(xfer) }
    : { available: false, rows: [], freshness: { observedAt: null, stale: true, state: "unavailable" } };
  snap.earningsSuspect = !!suspect;
  // Evidence class 3 (illustrative simulator runs) — static and pure, same table on every project.
  snap.simulatorScenarios = simulatorScenarios();
  return snap;
}

module.exports = {
  overview, projectDetail, marketFacts, poolsVolume, poolOhlcv,
  // pure pieces, exported for the offline test
  pickJupiter, slimGeckoPool, slimOhlcv, sanitizeStatus, sanitizePositions, sanitizeDislocation, deriveDecisions, slimLog, reasonCode, bucketUsd, memo, freshnessOf, projectSnapshot, _resetCache, _expireForTests,
  // W5 evidence boundaries
  symbolForMint, slimTransfers, operatorHistory, decisionLog, simulatorScenarios, earningsSuspect,
};
