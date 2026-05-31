// Solana Tracker Data API integration — independent forensic data source.
//
// Why this matters: the autopsy's Phase 2F (P&L ledger), Phase 2G (creator
// buy-back trace), and holder behavior labels are all things we currently
// reconstruct from Helius signature scans. Solana Tracker computes them
// server-side from their indexer, so we get audited cross-verification
// numbers without hitting Helius rate limits.
//
// Used by:
//  • Autopsy Phase 2G — creator buy-back cross-verification (primary use)
//  • Autopsy Phase 2F — P&L ledger second-opinion (future)
//  • Holders tool — identity tags (pool/dev/arbitrage/exchange) (future)
//
// Reference: https://docs.solanatracker.io/llms.txt
//
// Free tier: limited monthly credits. We cache aggressively (15 min for
// position data, 1 hr for identity), and degrade gracefully (return null
// instead of throwing) when the key is missing, quota is hit, or any other
// error occurs. The autopsy renderers always have fallback paths.

const ST_BASE = "https://data.solanatracker.io";

// Cache buckets keyed by endpoint+params. Position/trader data can move when
// new fills land, so 15 min is conservative but still saves a lot of calls
// when the same mint is hit repeatedly.
const POSITION_CACHE = new Map();   // `${wallet}:${mint}` → { data, fetchedAt }
const TRADERS_CACHE = new Map();    // `${mint}:${sort}` → { data, fetchedAt }
const HOLDERS_CACHE = new Map();    // `${mint}:${enrich}` → { data, fetchedAt }

const POSITION_TTL_MS  = 15 * 60 * 1000; // 15 min
const TRADERS_TTL_MS   = 15 * 60 * 1000; // 15 min
const HOLDERS_TTL_MS   = 10 * 60 * 1000; // 10 min — holders churn faster

// Negative cache so quota-exhausted / 401 responses don't immediately retry.
const NULL_CACHE_TTL_MS = 5 * 60 * 1000;

// Core fetch wrapper — swallows errors and returns null so the autopsy never
// breaks if Solana Tracker is down or our key is invalid. Logs enough detail
// to debug from Railway logs without leaking the key.
//
// `retryOn5xx` defaults to true for the higher-level helpers below (the
// callers that actually feed the autopsy/score UI) and false for the raw
// /api/solana-tracker-debug probe (we want to see the real first response
// there, not a retried one). 5xx is transient by definition on this API
// — observed in production where the same URL returned 500 once and 200
// seconds later — so one retry with a short delay turns most hiccups
// invisible without burning quota.
async function stFetch(pathAndQuery, { timeoutMs = 12000, retryOn5xx = false } = {}) {
  const API_KEY = process.env.SOLANA_TRACKER_API_KEY;
  if (!API_KEY) return { ok: false, status: 0, reason: "no-key", data: null };
  const url = `${ST_BASE}${pathAndQuery}`;
  const doOne = async () => {
    try {
      const r = await fetch(url, {
        headers: { "x-api-key": API_KEY, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const bodyText = await r.text();
      let body = null;
      try { body = bodyText ? JSON.parse(bodyText) : null; } catch (_) { /* not JSON */ }
      if (!r.ok) {
        if (r.status === 401) console.warn("[solana-tracker] 401 — SOLANA_TRACKER_API_KEY rejected");
        else if (r.status === 402) console.warn("[solana-tracker] 402 — credits exhausted or plan limit");
        else if (r.status === 429) console.warn("[solana-tracker] 429 — rate limited");
        else if (r.status !== 404) console.warn(`[solana-tracker] ${pathAndQuery} status=${r.status} head=${bodyText.slice(0, 160)}`);
        return { ok: false, status: r.status, reason: `http-${r.status}`, data: body, bodyHead: bodyText.slice(0, 200) };
      }
      return { ok: true, status: r.status, data: body };
    } catch (e) {
      console.warn(`[solana-tracker] ${pathAndQuery} threw: ${e.message}`);
      return { ok: false, status: 0, reason: "exception", data: null, error: e.message };
    }
  };
  let res = await doOne();
  // Single retry on transient 5xx — Solana Tracker has been observed
  // returning 500 then 200 for identical requests seconds apart.
  if (!res.ok && retryOn5xx && res.status >= 500 && res.status < 600) {
    await new Promise(r => setTimeout(r, 800));
    console.warn(`[solana-tracker] retrying after ${res.status} on ${pathAndQuery}`);
    res = await doOne();
  }
  return res;
}

// ── Wallet position on a single token ─────────────────────────────────────
// GET /v2/pnl/wallets/{wallet}/tokens/{token}
//
// This is the headline endpoint for the autopsy's creator buy-back number.
// Returns realized/unrealized PnL, current balance, cost basis, buy/sell
// counts, USD totals bought/sold, ROI, and first/last trade timestamps —
// the exact fields we've been reconstructing by hand in Phase 2G.
async function getWalletTokenPosition(wallet, mint) {
  if (!wallet || !mint) return null;
  const cacheKey = `${wallet}:${mint}`;
  const cached = POSITION_CACHE.get(cacheKey);
  if (cached) {
    const ttl = cached.data ? POSITION_TTL_MS : NULL_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.data;
  }
  const res = await stFetch(`/v2/pnl/wallets/${wallet}/tokens/${mint}`, { retryOn5xx: true });
  const data = res.ok ? res.data : null;
  POSITION_CACHE.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}

// ── All traders on a token (P&L ledger replacement) ───────────────────────
// GET /v2/pnl/tokens/{token}/traders?sort=...&direction=...&limit=...
//
// `sort` options: pnl | realized | unrealized | invested | roi | holding |
//                 value | first_trade | last_trade
// Use this to replace the autopsy's hand-rolled top-buyer / top-seller /
// who-made-money / who-got-rekt lists in Phase 2F.
async function getTokenTraders(mint, { sort = "pnl", direction = "desc", limit = 50 } = {}) {
  if (!mint) return null;
  const cacheKey = `${mint}:${sort}:${direction}:${limit}`;
  const cached = TRADERS_CACHE.get(cacheKey);
  if (cached) {
    const ttl = cached.data ? TRADERS_TTL_MS : NULL_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.data;
  }
  const qs = new URLSearchParams({ sort, direction, limit: String(limit) });
  const res = await stFetch(`/v2/pnl/tokens/${mint}/traders?${qs}`, { retryOn5xx: true });
  const data = res.ok ? res.data : null;
  TRADERS_CACHE.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}

// ── First buyers of a token (sniper detection) ────────────────────────────
// GET /v2/pnl/tokens/{token}/first-buyers?limit=...
//
// Chronological — earliest trade first. Comes with realized PnL + balance,
// so a wallet that bought first and already sold flags itself.
async function getFirstBuyers(mint, { limit = 50 } = {}) {
  if (!mint) return null;
  const res = await stFetch(`/v2/pnl/tokens/${mint}/first-buyers?limit=${limit}`);
  return res.ok ? res.data : null;
}

// ── Holders with identity + PnL enrichment ────────────────────────────────
// GET /tokens/{token}/holders?enrich=identity|walletPnl|all
//
// `identity`  → pool / developer / arbitrage / exchange / kol / bot labels
// `walletPnl` → lifetime wallet PnL + this-token PnL per holder
// `all`       → both (costs more credits — start with `identity` on free tier)
async function getEnrichedHolders(mint, { enrich = "identity" } = {}) {
  if (!mint) return null;
  const cacheKey = `${mint}:${enrich}`;
  const cached = HOLDERS_CACHE.get(cacheKey);
  if (cached) {
    const ttl = cached.data ? HOLDERS_TTL_MS : NULL_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.data;
  }
  const res = await stFetch(`/tokens/${mint}/holders?enrich=${encodeURIComponent(enrich)}`);
  const data = res.ok ? res.data : null;
  HOLDERS_CACHE.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}

// ── Token info — comprehensive token metadata ────────────────────────────
// GET /tokens/{mint}
// Returns the token object including the verified `creator` wallet and a
// `creation` block. This is the reliable creator source for graduated
// Pump.fun / launchpad tokens where the platform's own API no longer serves
// pre-graduation creator data (and where the genesis-tx fee payer is the
// platform wallet, not the team).
const TOKEN_INFO_CACHE = new Map(); // mint → { data, fetchedAt } (1h TTL)
const TOKEN_INFO_TTL_MS = 60 * 60 * 1000;
async function getTokenInfo(mint) {
  if (!mint) return null;
  const cached = TOKEN_INFO_CACHE.get(mint);
  if (cached) {
    const ttl = cached.data ? TOKEN_INFO_TTL_MS : NULL_CACHE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.data;
  }
  const res = await stFetch(`/tokens/${mint}`, { retryOn5xx: true });
  const data = res.ok ? res.data : null;
  TOKEN_INFO_CACHE.set(mint, { data, fetchedAt: Date.now() });
  return data;
}

// Returns the token's market/graduation status, or null. The Pump.fun
// frontend API is effectively dead (404s even for active tokens), so this is
// the reliable on-curve-vs-graduated signal: a pool whose market is "pumpfun"
// (or contains "curve") is still on the bonding curve; anything else
// (pumpfun-amm, raydium, meteora-*, etc.) means it graduated to a DEX pool.
// Also surfaces ST's liquidity, which exists pre-graduation (the bonding-curve
// reserve) even when DexScreener shows $0 because it hasn't indexed the pool.
// Is a pool's `market` a pre-graduation launchpad bonding curve, on ANY
// launchpad? Covers: pumpfun (Pump.fun), *-curve (Bags = meteora-curve),
// *-launchpad (Raydium LaunchLab / LetsBonk = raydium-launchpad), plus known
// curve launchpads. Graduated AMM pools (pumpfun-amm, raydium-cpmm/clmm,
// meteora-dyn-v2/dlmm, orca, …) are NOT curves and return false.
function isLaunchpadCurveMarket(market) {
  if (!market || typeof market !== "string") return false;
  const m = market.toLowerCase();
  return m === "pumpfun" || m.includes("curve") || m.includes("launchpad")
    || m === "moonshot" || m === "boop" || m === "heaven";
}

async function getTokenMarketStatus(mint) {
  const info = await getTokenInfo(mint);
  if (!info) return null;
  const pools = Array.isArray(info.pools) ? info.pools : [];
  if (pools.length === 0) return null;
  // Primary pool = highest liquidity.
  const primary = pools.reduce((best, p) =>
    ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0]);
  const market = primary.market || null;
  const onBondingCurve = isLaunchpadCurveMarket(market);
  return {
    market,
    onBondingCurve,
    graduated: !onBondingCurve,
    curvePercentage: primary.curvePercentage != null ? Number(primary.curvePercentage) : null,
    liquidityUsd: (primary.liquidity || {}).usd != null ? Number(primary.liquidity.usd) : null,
  };
}

// Returns { wallet, createdTx } for the token's verified creator, or null.
// Reads token.creator first, then the creation block (token.creation or
// top-level creation) as fallbacks.
async function getTokenCreator(mint) {
  const info = await getTokenInfo(mint);
  if (!info) return null;
  const tok = info.token || info;
  const creation = tok.creation || info.creation || {};
  const wallet = tok.creator || creation.creator || null;
  if (!wallet) return null;
  return { wallet, createdTx: creation.created_tx || null };
}

// ── Buyers in a time window — independent double-check for Buy Special ────
// GET /trades/{mint} (cursor-paginated). Collects unique BUY wallets whose
// trade timestamp falls in [fromTsSec, toTsSec]. This is a second opinion
// against the Buy Special tool's own Helius value-flow scan — not a
// replacement. For a recent competition window the first page usually covers
// it; older windows paginate (bounded) and report whether the window start
// was reached so the client can be honest about coverage.
async function getTokenBuyersInWindow(mint, fromTsSec, toTsSec, { maxPages = 20 } = {}) {
  if (!mint || !fromTsSec || !toTsSec) return null;
  const fromMs = fromTsSec * 1000;
  const toMs = toTsSec * 1000;
  const buyers = new Map(); // wallet -> { buyCount, volumeSol }
  let cursor = null, pages = 0, tradesScanned = 0, reachedWindowStart = false;
  while (pages < maxPages) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await stFetch(`/trades/${mint}${qs}`, { retryOn5xx: true });
    if (!res.ok || !res.data) break;
    const trades = Array.isArray(res.data.trades) ? res.data.trades
      : (Array.isArray(res.data) ? res.data : []);
    if (trades.length === 0) break;
    let oldestMs = Infinity;
    for (const t of trades) {
      tradesScanned++;
      const tMs = Number(t.time) || 0;
      if (tMs > 0 && tMs < oldestMs) oldestMs = tMs;
      if (tMs < fromMs) continue;       // older than window
      if (tMs > toMs) continue;          // newer than window end (snapshot)
      if (t.type === "buy" && t.wallet) {
        const v = Number(t.volumeSol) || 0;
        const cur = buyers.get(t.wallet) || { buyCount: 0, volumeSol: 0, maxBuySol: 0 };
        cur.buyCount++;
        cur.volumeSol += v;
        if (v > cur.maxBuySol) cur.maxBuySol = v;   // biggest single buy (for the "single" metric)
        buyers.set(t.wallet, cur);
      }
    }
    // Once the oldest trade on the page predates the window start, we've
    // covered the whole window — stop.
    if (oldestMs < fromMs) { reachedWindowStart = true; break; }
    cursor = res.data.nextCursor || res.data.cursor || null;
    if (!cursor) break;
    pages++;
  }
  return {
    buyers: [...buyers.entries()].map(([wallet, v]) => ({ wallet, ...v })),
    tradesScanned,
    pagesUsed: pages + 1,
    reachedWindowStart,
  };
}

// ── Deployer token count — serial-deployer signal ────────────────────────
// GET /deployer/{wallet}
// Returns how many tokens a wallet has created/deployed. A high count is a
// serial-launcher signal: an "established" creator wallet with 50 deployed
// tokens is NOT a reassuring organic operator — it's a token mill. Prefers
// the `total` field (true count); falls back to a page length (which may be
// capped, so treat as a lower bound).
async function getDeployerTokenCount(wallet) {
  if (!wallet) return null;
  const res = await stFetch(`/deployer/${wallet}`, { retryOn5xx: true });
  if (!res.ok || !res.data) return null;
  const data = res.data;
  if (typeof data.total === "number") return { count: data.total, exact: true };
  if (Array.isArray(data.tokens)) return { count: data.tokens.length, exact: false };
  if (Array.isArray(data.data)) return { count: data.data.length, exact: false };
  if (Array.isArray(data)) return { count: data.length, exact: false };
  return null;
}

// ── Deployer's full launch history (for the premium "creator rap sheet") ──
// GET /deployer/{wallet}?page=N — paginated. Each item carries the launched
// token's CURRENT state (liquidityUsd, marketCapUsd, status, volume_24h,
// riskScore, top10, snipers, createdAt) plus the nested real `creator` wallet,
// so a single call yields a full track record with outcomes. NOTE: ST keys
// this off the on-chain DEPLOYER wallet (pool.deployer), which for Bags tokens
// is the platform launcher — the caller must handle that (isPlatformLauncher).
async function getDeployerTokens(wallet, { maxPages = 3 } = {}) {
  if (!wallet) return null;
  const all = [];
  let total = null, totalUnique = null, pages = null;
  for (let p = 1; p <= maxPages; p++) {
    const res = await stFetch(`/deployer/${wallet}?page=${p}`, { retryOn5xx: true });
    if (!res.ok || !res.data) break;
    const d = res.data;
    if (total == null) { total = d.total ?? null; totalUnique = d.totalUniqueTokens ?? null; pages = d.pages ?? null; }
    const arr = Array.isArray(d.data) ? d.data : [];
    all.push(...arr);
    if (arr.length === 0 || (pages != null && p >= pages)) break;
  }
  return { total: total != null ? total : all.length, totalUniqueTokens: totalUnique, tokens: all };
}

// ── Wallet-level summary (lifetime PnL across all tokens) ─────────────────
// GET /v2/pnl/wallets/{wallet}
//
// Useful for context on a single counterparty — is this trader profitable
// overall, or just lucky on this one mint?
async function getWalletSummary(wallet) {
  if (!wallet) return null;
  const res = await stFetch(`/v2/pnl/wallets/${wallet}`);
  return res.ok ? res.data : null;
}

// ── Diagnostics ───────────────────────────────────────────────────────────
function isConfigured() {
  return !!process.env.SOLANA_TRACKER_API_KEY;
}

// Raw probe for the /api/solana-tracker-debug endpoint — same pattern as
// solscan-debug, lets us see exactly what the free tier returns without
// going through the cache layer.
async function probe(pathAndQuery) {
  return await stFetch(pathAndQuery);
}

module.exports = {
  getWalletTokenPosition,
  getTokenTraders,
  getFirstBuyers,
  getEnrichedHolders,
  getWalletSummary,
  getTokenInfo,
  getTokenCreator,
  getTokenMarketStatus,
  getDeployerTokenCount,
  getDeployerTokens,
  getTokenBuyersInWindow,
  isLaunchpadCurveMarket,
  isConfigured,
  probe,
};
