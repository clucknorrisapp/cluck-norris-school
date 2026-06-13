// LP Pair Scanner — see docs/LP_SCANNER.md. Multi-DEX liquidity intelligence for the
// Liquidity Lab. PHASE 1: given a token PAIR (symbol or mint), find EVERY open pool for
// it across every Solana DEX (via GeckoTerminal, which indexes them all), ranked by
// turnover, with full market metrics. Fee-tier/yield (phase 2) + liquidity concentration
// (phase 3) layer in on top. Informational only — NOT financial advice.
//
// No Solana Tracker dependency — GeckoTerminal + (later) on-chain reads only.

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const { connection } = require("./rpc"); // failover-aware (Helius) connection for on-chain fee reads
const _scanCache = new Map(); // pair+amount -> { data, ts }; sequential fee reads only run on a miss
const SCAN_TTL = 60000;

// Majors fast-path; everything else resolves via the Jupiter verified token list (cached).
const KNOWN = {
  SOL: "So11111111111111111111111111111111111111112", WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", JLP: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  CBBTC: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", CLKN: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS",
};

let _jup = null, _jupAt = 0;
async function jupList() {
  const now = Date.now();
  if (_jup && now - _jupAt < 3600e3) return _jup;
  try {
    const r = await fetch("https://lite-api.jup.ag/tokens/v2/tag?query=verified", { signal: AbortSignal.timeout(15000) });
    if (r.ok) { const j = await r.json(); _jup = Array.isArray(j) ? j : (j.tokens || j.data || []); _jupAt = now; } // v2: mint=`id`, logo=`icon`
  } catch (_) { /* fall back to KNOWN + mint passthrough */ }
  return _jup || [];
}

// Symbol or mint -> mint. Mints pass through; symbols hit the majors map, then the
// Jupiter verified list (most-liquid match wins on ambiguous symbols).
async function resolveMint(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("empty token");
  if (BASE58.test(s)) return s;
  const up = s.toUpperCase();
  if (KNOWN[up]) return KNOWN[up];
  const list = await jupList();
  const hits = (Array.isArray(list) ? list : []).filter((t) => (t.symbol || "").toUpperCase() === up);
  if (hits.length) return (hits.sort((a, b) => (b.dailyVolume || b.daily_volume || 0) - (a.dailyVolume || a.daily_volume || 0))[0]).id || hits[0].address;
  throw new Error(`unknown token "${s}" — paste its mint address`);
}

// GeckoTerminal-shaped fetch. Auto-upgrades to CoinGecko's Pro "onchain" API when
// COINGECKO_API_KEY is set (higher rate limits + fuller coverage + history), and falls
// back to the free GeckoTerminal tier if the key is missing or rejected (e.g. Demo tier).
// The path suffix is identical on both — only the base + auth header change.
// Token search for the UI — match by symbol/name against the Jupiter verified list,
// rank exact-symbol first then by daily volume. Returns up to 8 {symbol,name,mint,logo}.
async function searchTokens(q) {
  const s = String(q || "").trim().toLowerCase();
  if (s.length < 1) return [];
  const list = await jupList();
  const arr = Array.isArray(list) ? list : [];
  const hits = arr.filter((t) => (t.symbol || "").toLowerCase().includes(s) || (t.name || "").toLowerCase().includes(s));
  hits.sort((a, b) => {
    const ax = (a.symbol || "").toLowerCase() === s ? 0 : 1, bx = (b.symbol || "").toLowerCase() === s ? 0 : 1;
    if (ax !== bx) return ax - bx;
    const as = (a.symbol || "").toLowerCase().startsWith(s) ? 0 : 1, bs = (b.symbol || "").toLowerCase().startsWith(s) ? 0 : 1;
    if (as !== bs) return as - bs;
    return (b.daily_volume || 0) - (a.daily_volume || 0);
  });
  return hits.slice(0, 8).map((t) => ({ symbol: t.symbol, name: t.name, mint: t.id || t.address, logo: t.icon || t.logoURI || null }));
}

async function gt(path) {
  const key = process.env.COINGECKO_API_KEY;
  if (key) {
    try {
      const r = await fetch(`https://pro-api.coingecko.com/api/v3/onchain/networks/solana${path}`,
        { headers: { Accept: "application/json", "x-cg-pro-api-key": key }, signal: AbortSignal.timeout(12000) });
      if (r.ok) return r.json();
    } catch (_) { /* fall through to the free tier */ }
  }
  const r = await fetch(`${GT}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  return r.json();
}

// PHASE 2 — on-chain fee tier. Meteora DLMM via the SDK (exact, our home turf); Orca +
// Raydium land next phase. Returns base fee % (e.g. 0.1) or null if unreadable.
async function meteoraFeePct(poolAddress, conn) {
  try {
    const mod = require("@meteora-ag/dlmm"); const DLMM = mod.default || mod.DLMM || mod;
    const { PublicKey } = require("@solana/web3.js");
    const dlmm = await DLMM.create(conn, new PublicKey(poolAddress));
    return Number(dlmm.getFeeInfo().baseFeeRatePercentage.toString());
  } catch (_) { return null; }
}

// Orca Whirlpool fee: u16 feeRate at byte offset 45 (8 disc + 32 config + 1 bump + 2
// tickSpacing + 2 seed), in hundredths of a bp → % = feeRate / 10000. (validated on-chain)
async function orcaFeePct(poolAddress, conn) {
  try {
    const { PublicKey } = require("@solana/web3.js");
    const info = await conn.getAccountInfo(new PublicKey(poolAddress));
    if (!info || !info.data || info.data.length < 47) return null;
    return Number((info.data.readUInt16LE(45) / 10000).toFixed(4));
  } catch (_) { return null; }
}

// Raydium (AMM v4 / CLMM / CPMM) fee via the Raydium API — feeRate is a fraction (0.0004) → %.
async function raydiumFeePct(poolAddress) {
  try {
    const r = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolAddress}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const d = j && j.data && j.data[0];
    if (!d || d.feeRate == null) return null;
    return Number((Number(d.feeRate) * 100).toFixed(4));
  } catch (_) { return null; }
}

// PHASE 5 — 7-day volume history via OHLCV (CoinGecko Pro). Lets us flag whether a pool's
// turnover is sustained vs a one-day spike, and compute a steadier 7d-average fee yield.
async function poolHistory(poolAddress) {
  try {
    const j = await gt(`/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=7`);
    const ol = (((j || {}).data || {}).attributes || {}).ohlcv_list || [];
    const vols = ol.map((r) => Number(r[5]) || 0).filter((v) => v >= 0);
    if (!vols.length) return null;
    return { vol7dAvgUsd: Math.round(vols.reduce((a, b) => a + b, 0) / vols.length), days: vols.length };
  } catch (_) { return null; }
}

// Fee-tier dispatcher by DEX. Meteora DLMM (SDK), Orca (on-chain), Raydium (API). Others
// (humidifi, pancakeswap-v3, meteora-damm-v2…) return null = "not read yet" (honest).
async function feePctForPool(pool, conn) {
  const dex = pool.dex || "";
  if (dex === "meteora") return meteoraFeePct(pool.address, conn);
  if (dex === "orca") return orcaFeePct(pool.address, conn);
  if (dex.startsWith("raydium")) return raydiumFeePct(pool.address);
  return null;
}

// Impermanent-loss risk is a PAIR property (how far the two assets can diverge), not a
// per-pool one. Classify from token identity: stables don't move, SOL-LSTs track SOL.
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",  // USDS
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
]);
const SOL_FAMILY = new Set([
  "So11111111111111111111111111111111111111112",  // SOL/WSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",  // bSOL
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",  // JupSOL
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", // INF
]);
function ilRiskForPair(a, b) {
  const aS = STABLES.has(a), bS = STABLES.has(b), aL = SOL_FAMILY.has(a), bL = SOL_FAMILY.has(b);
  if (aS && bS) return { level: "minimal", note: "Both stablecoins — near-zero impermanent loss." };
  if (aL && bL) return { level: "low", note: "Both SOL-correlated (LSTs) — they move together, so little divergence/IL." };
  if (aS || bS) return { level: "moderate", note: "One stable + one volatile — classic single-sided IL when the volatile asset moves." };
  return { level: "high", note: "Two volatile, uncorrelated assets — highest IL risk; fees have to beat divergence." };
}

// Scan every open pool for a pair across all DEXs. Phase-1 metrics from GeckoTerminal +
// Phase-2 on-chain fee tier → real fees/yield + CALIBRATED per-deposit earnings (TVL-share
// model, anchored to our live JUP/USDC results so it doesn't overstate). amountUsd optional.
async function scanPair(tokenA, tokenB, opts = {}) {
  const amountUsd = Math.max(0, Number(opts.amountUsd) || 0);
  const mintA = await resolveMint(tokenA);
  const mintB = await resolveMint(tokenB);
  if (mintA === mintB) throw new Error("tokenA and tokenB are the same mint");
  const ckey = `${mintA}-${mintB}-${amountUsd}`;
  const cached = _scanCache.get(ckey);
  if (cached && Date.now() - cached.ts < SCAN_TTL) return cached.data;
  // GeckoTerminal returns a token's top pools (by liquidity) across every DEX.
  const j = await gt(`/tokens/${mintA}/pools?include=base_token,quote_token&page=1`);
  const pools = [];
  for (const p of (j.data || [])) {
    const a = p.attributes || {}, rel = p.relationships || {};
    const baseMint = (rel.base_token?.data?.id || "").replace("solana_", "");
    const quoteMint = (rel.quote_token?.data?.id || "").replace("solana_", "");
    if (baseMint !== mintB && quoteMint !== mintB) continue; // only the requested pair
    const tvl = Number(a.reserve_in_usd) || 0;
    const v = a.volume_usd || {};
    const vol24 = Number(v.h24) || 0;
    const tx = a.transactions || {};
    pools.push({
      dex: rel.dex?.data?.id || "?",
      address: a.address,
      name: a.name,
      ageDays: a.pool_created_at ? Math.round((Date.now() - new Date(a.pool_created_at).getTime()) / 86400e3) : null,
      tvlUsd: Math.round(tvl),
      volume: { h1: Number(v.h1) || 0, h6: Number(v.h6) || 0, h24: vol24 },
      turnover24h: tvl > 0 ? Number((vol24 / tvl).toFixed(2)) : 0,
      priceChangePct: a.price_change_percentage || {},
      txns24h: tx.h24 || tx.h6 || null,
      // Phase 2/3 (on-chain per DEX): exact fee tier, 24h fees, fee/TVL yield, concentration.
      feeTier: null, fees24hUsd: null, feeYieldPctDay: null, concentration: null,
    });
  }
  // Phase 2: enrich with on-chain fee tier → real fees/yield + calibrated per-deposit earnings.
  if (pools.length) {
    const conn = connection();
    // SEQUENTIAL on purpose: firing all fee reads at once (heavy Meteora SDK calls +
    // Orca account reads + Raydium API) saturates the shared RPC and the lighter reads
    // fail. One at a time is reliable; the result is cached so repeat loads are instant.
    for (const p of pools) {
      const fee = await feePctForPool(p, conn); // Meteora (SDK) + Orca (on-chain) + Raydium (API)
      if (fee == null) continue;
      p.feeTier = fee;
      p.fees24hUsd = Math.round(p.volume.h24 * fee / 100);
      p.feeYieldPctDay = p.tvlUsd > 0 ? Number((p.fees24hUsd / p.tvlUsd * 100).toFixed(3)) : 0;
      if (amountUsd > 0 && p.tvlUsd > 0) {
        // Calibrated TVL-share model (matches our live JUP/USDC ~0.5%/day, not the ~2.4x-
        // optimistic active-bin share): your share of fees ≈ deposit / (TVL + deposit).
        const est = p.volume.h24 * (fee / 100) * (amountUsd / (p.tvlUsd + amountUsd));
        p.estDailyUsd = Number(est.toFixed(2));
        p.estYieldPctDay = Number((est / amountUsd * 100).toFixed(3));
      }
    }
  }
  // Phase 5: 7-day volume history per pool (CoinGecko Pro OHLCV) → sustainability flag +
  // steadier 7d-avg fee yield. Parallel on purpose — these hit CoinGecko (not RPC), so no
  // saturation, and the Pro tier handles the burst (this is what the upgrade buys us).
  await Promise.all(pools.map(async (p) => {
    const h = await poolHistory(p.address);
    if (!h || !h.vol7dAvgUsd) return;
    p.vol7dAvgUsd = h.vol7dAvgUsd;
    const ratio = p.vol7dAvgUsd > 0 ? p.volume.h24 / p.vol7dAvgUsd : 1;
    p.volTrend = ratio > 1.8 ? "spiking" : ratio < 0.6 ? "cooling" : "steady"; // is today representative?
    if (p.feeTier != null && p.tvlUsd > 0) {
      p.feeYield7dPctDay = Number(((p.vol7dAvgUsd * (p.feeTier / 100)) / p.tvlUsd * 100).toFixed(3));
    }
  }));
  // Rank by 7d-avg fee yield where we have it (steadier than a 1-day snapshot), else 24h yield, else turnover.
  pools.sort((x, y) => (y.feeYield7dPctDay ?? y.feeYieldPctDay ?? -1) - (x.feeYield7dPctDay ?? x.feeYieldPctDay ?? -1) || y.turnover24h - x.turnover24h);
  const result = {
    pair: `${tokenA}/${tokenB}`.toUpperCase(),
    mintA, mintB, amountUsd: amountUsd || null, ilRisk: ilRiskForPair(mintA, mintB), count: pools.length, pools,
    note: "Ranked by 7-day-average fee yield (steadier than a 1-day snapshot) where the on-chain fee tier is known. volTrend flags whether today's volume is steady / spiking / cooling vs the 7d average, so a one-day pump doesn't fool you. Per-deposit earnings use a TVL-share model calibrated to our live position.",
    disclaimer: "Informational only — NOT financial advice. Providing liquidity carries impermanent-loss and smart-contract risk.",
  };
  _scanCache.set(ckey, { data: result, ts: Date.now() });
  return result;
}

// ── POOL DEEP-DIVE + RANGE/EARNINGS SIMULATOR ───────────────────────────────────────
// The flagship LP feature. For ONE pool, model the core concentrated-liquidity tradeoff:
// a tighter range concentrates capital → more fees per dollar WHILE IN RANGE, but the
// price exits the band more often → less time earning + more rebalances. We ground the
// time-in-range estimate in the pool's REAL 7-day realized volatility (OHLCV high/low),
// and anchor the $/day to the same calibrated TVL-share model the scanner uses.

// Uniswap-v3 / DLMM capital-efficiency factor for a symmetric ±w price range vs full
// range (w as a fraction; 0.01 = ±1%). A ±1% position is ~100× more capital-efficient
// than full-range — this is the standard CL concentration math, not a heuristic.
function concFactor(w) {
  if (!(w > 0)) return 1;
  const ww = Math.min(w, 0.99);
  const denom = 2 - Math.sqrt(1 - ww) - 1 / Math.sqrt(1 + ww);
  return denom > 0 ? 1 / denom : 1;
}
const REF_W = 0.0256; // our live JUP/USDC ±2.56% — the width the TVL-share $/day is calibrated to

// Richer 7d OHLCV: per-day open/high/low/close/volume (volatility + time-in-range model).
async function poolOhlcv(poolAddress, days = 7) {
  try {
    const j = await gt(`/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=${days}`);
    const ol = (((j || {}).data || {}).attributes || {}).ohlcv_list || []; // [ts,o,h,l,c,v]
    return ol.map((r) => ({ ts: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], vol: +r[5] || 0 }))
      .filter((d) => d.close > 0);
  } catch (_) { return []; }
}

const _ddCache = new Map(); // poolAddr+amount+width -> { data, ts }
// Deep-dive one pool + simulate earnings across a sweep of range widths. amountUsd and
// halfWidthPct optional; the sweep always runs so the UI can draw the tradeoff curve.
async function poolDeepDive(poolAddress, opts = {}) {
  const amountUsd = Math.max(0, Number(opts.amountUsd) || 0);
  const reqW = opts.halfWidthPct != null && Number(opts.halfWidthPct) > 0 ? Math.max(0.05, Number(opts.halfWidthPct)) : null;
  const ckey = `${poolAddress}-${amountUsd}-${reqW || 0}`;
  const cached = _ddCache.get(ckey);
  if (cached && Date.now() - cached.ts < SCAN_TTL) return cached.data;

  const j = await gt(`/pools/${poolAddress}?include=base_token,quote_token,dex`);
  const d0 = j.data || {};
  const a = d0.attributes || {}, rel = d0.relationships || {};
  const dex = rel.dex?.data?.id || "?";
  const tvl = Math.round(Number(a.reserve_in_usd) || 0);
  const vol = a.volume_usd || {};
  const vol24 = Number(vol.h24) || 0;
  const baseMint = (rel.base_token?.data?.id || "").replace("solana_", "");
  const quoteMint = (rel.quote_token?.data?.id || "").replace("solana_", "");

  const conn = connection();
  const fee = await feePctForPool({ dex, address: poolAddress }, conn);
  const ohlcv = await poolOhlcv(poolAddress, 7);
  const vol7dAvg = ohlcv.length ? Math.round(ohlcv.reduce((s, x) => s + x.vol, 0) / ohlcv.length) : vol24;
  // Realized daily volatility = avg of (high-low)/close per day. The typical ONE-SIDED
  // daily excursion is ~half of that — the number that decides if a ±w band holds.
  const ranges = ohlcv.map((x) => (x.high > 0 && x.low > 0 ? (x.high - x.low) / x.close : 0)).filter((x) => x > 0);
  const dailyRangePct = ranges.length ? Number((ranges.reduce((s, x) => s + x, 0) / ranges.length * 100).toFixed(2)) : null;
  const oneSidedPct = dailyRangePct != null ? dailyRangePct / 2 : null;

  // Base $/day at the REFERENCE width (±2.56%), from the calibrated TVL-share model.
  // We use the steadier 7d-avg volume so the simulator isn't fooled by a one-day spike.
  const volUsed = vol7dAvg || vol24;
  const baseRefDaily = (fee != null && amountUsd > 0 && tvl > 0)
    ? volUsed * (fee / 100) * (amountUsd / (tvl + amountUsd))
    : null;

  // Estimated fraction of the day a centered ±w% position stays in range, from realized
  // vol. Rough by design (a single-day band-hold proxy), and labeled as such in the UI.
  function timeInRange(w) {
    if (oneSidedPct == null || oneSidedPct <= 0) return null;
    return Number(Math.min(1, Math.max(0.02, w / oneSidedPct)).toFixed(2));
  }
  // Rough rebalances/day if you re-center on every exit: how many times the typical daily
  // swing sweeps a ±w band. <1 ⇒ usually holds the day.
  function exitsPerDay(w) {
    if (oneSidedPct == null || oneSidedPct <= 0) return null;
    return Number(Math.max(0, oneSidedPct / w).toFixed(1));
  }

  function simAt(halfWidthPct) {
    const w = halfWidthPct / 100;
    const mult = concFactor(w) / concFactor(REF_W); // vs the calibrated ±2.56% reference
    const inRangeDaily = baseRefDaily != null ? Number((baseRefDaily * mult).toFixed(2)) : null;
    const tir = timeInRange(w);
    const blendedDaily = inRangeDaily != null && tir != null ? Number((inRangeDaily * tir).toFixed(2)) : inRangeDaily;
    const apr = blendedDaily != null && amountUsd > 0 ? Number((blendedDaily / amountUsd * 365 * 100).toFixed(1)) : null;
    return {
      halfWidthPct, concMult: Number(mult.toFixed(2)),
      inRangeDailyUsd: inRangeDaily, timeInRange: tir,
      blendedDailyUsd: blendedDaily, blendedApr: apr, exitsPerDay: exitsPerDay(w),
    };
  }

  const widths = [0.25, 0.5, 1, 2, 3, 5, 10];
  if (reqW && !widths.includes(reqW)) { widths.push(reqW); widths.sort((x, y) => x - y); }
  const sweep = widths.map(simAt);
  const requested = reqW ? simAt(reqW) : null;

  const result = {
    pool: {
      address: poolAddress, name: a.name, dex, baseMint, quoteMint,
      tvlUsd: tvl, vol24hUsd: Math.round(vol24), vol7dAvgUsd: vol7dAvg,
      feeTier: fee, priceUsd: Number(a.base_token_price_usd) || null,
      ageDays: a.pool_created_at ? Math.round((Date.now() - new Date(a.pool_created_at).getTime()) / 86400e3) : null,
    },
    volatility: { dailyRangePct, oneSidedDailyPct: oneSidedPct != null ? Number(oneSidedPct.toFixed(2)) : null, days: ranges.length },
    ilRisk: ilRiskForPair(baseMint, quoteMint),
    amountUsd: amountUsd || null,
    requested, sweep,
    model: "In-range $/day uses the calibrated TVL-share model scaled by concentrated-liquidity capital efficiency vs a ±2.56% reference (our live position). Time-in-range and rebalances/day are ROUGH estimates from the pool's 7-day realized volatility — real results depend on how price actually moves. Tighter ranges earn more per dollar while in range but exit more often.",
    disclaimer: "Informational only — NOT financial advice. Estimates, not guarantees.",
  };
  _ddCache.set(ckey, { data: result, ts: Date.now() });
  return result;
}

// Debug helper — runs a single Meteora fee read WITHOUT swallowing the error, so we can
// see why prod returns null (used by /api/lp-scan?debug=1). Safe/read-only.
async function debugFee(poolAddress) {
  const conn = connection();
  const mod = require("@meteora-ag/dlmm"); const DLMM = mod.default || mod.DLMM || mod;
  const { PublicKey } = require("@solana/web3.js");
  const dlmm = await DLMM.create(conn, new PublicKey(poolAddress));
  const fi = dlmm.getFeeInfo();
  return { ok: true, dlmmType: typeof DLMM, baseFeeRatePercentage: String(fi.baseFeeRatePercentage), feeInfoKeys: Object.keys(fi) };
}

// Debug: confirm the CoinGecko Pro onchain endpoint authenticates with our key
// (used by /api/lp-scan?debug=cg). 200 = Pro live; 401/403 = key/tier issue (we'd fall back).
async function debugCg() {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return { keySet: false, using: "free GeckoTerminal" };
  try {
    const url = "https://pro-api.coingecko.com/api/v3/onchain/networks/solana/tokens/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN/pools";
    const r = await fetch(url, { headers: { Accept: "application/json", "x-cg-pro-api-key": key }, signal: AbortSignal.timeout(12000) });
    return { keySet: true, proStatus: r.status, proOk: r.ok, using: r.ok ? "CoinGecko Pro onchain" : "free fallback (Pro rejected)" };
  } catch (e) { return { keySet: true, error: e.message, using: "free fallback" }; }
}

// Debug: run the Orca (on-chain) + Raydium (API) readers raw, surfacing errors so we can
// see why they return null in prod (used by /api/lp-scan?debug=readers).
async function debugReaders() {
  const out = {};
  const { PublicKey } = require("@solana/web3.js");
  const conn = connection();
  try {
    const info = await conn.getAccountInfo(new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"));
    out.orca = { hasInfo: !!info, dataType: info && info.data ? info.data.constructor.name : null, len: info && info.data ? info.data.length : 0,
      feeRate: info && info.data && info.data.readUInt16LE ? info.data.readUInt16LE(45) : "no readUInt16LE" };
  } catch (e) { out.orcaErr = e.message; }
  try {
    const r = await fetch("https://api-v3.raydium.io/pools/info/ids?ids=3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    out.raydium = { status: r.status, body: (await r.text()).slice(0, 160) };
  } catch (e) { out.raydiumErr = e.message; }
  return out;
}

module.exports = { scanPair, poolDeepDive, resolveMint, searchTokens, debugFee, debugCg, debugReaders };
