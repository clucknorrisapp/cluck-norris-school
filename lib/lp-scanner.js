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
    const r = await fetch("https://tokens.jup.ag/tokens?tags=verified", { signal: AbortSignal.timeout(12000) });
    if (r.ok) { _jup = await r.json(); _jupAt = now; }
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
  if (hits.length) return hits.sort((a, b) => (b.daily_volume || 0) - (a.daily_volume || 0))[0].address;
  throw new Error(`unknown token "${s}" — paste its mint address`);
}

// GeckoTerminal-shaped fetch. Auto-upgrades to CoinGecko's Pro "onchain" API when
// COINGECKO_API_KEY is set (higher rate limits + fuller coverage + history), and falls
// back to the free GeckoTerminal tier if the key is missing or rejected (e.g. Demo tier).
// The path suffix is identical on both — only the base + auth header change.
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

// Scan every open pool for a pair across all DEXs. Phase-1 metrics from GeckoTerminal +
// Phase-2 on-chain fee tier → real fees/yield + CALIBRATED per-deposit earnings (TVL-share
// model, anchored to our live JUP/USDC results so it doesn't overstate). amountUsd optional.
async function scanPair(tokenA, tokenB, opts = {}) {
  const amountUsd = Math.max(0, Number(opts.amountUsd) || 0);
  const mintA = await resolveMint(tokenA);
  const mintB = await resolveMint(tokenB);
  if (mintA === mintB) throw new Error("tokenA and tokenB are the same mint");
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
    await Promise.all(pools.map(async (p) => {
      const fee = p.dex === "meteora" ? await meteoraFeePct(p.address, conn) : null; // Orca/Raydium next phase
      if (fee == null) return;
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
    }));
  }
  // Rank by fee yield where we have it (the money metric), else by turnover.
  pools.sort((x, y) => (y.feeYieldPctDay ?? -1) - (x.feeYieldPctDay ?? -1) || y.turnover24h - x.turnover24h);
  return {
    pair: `${tokenA}/${tokenB}`.toUpperCase(),
    mintA, mintB, amountUsd: amountUsd || null, count: pools.length, pools,
    note: "Ranked by 24h fee yield (fees ÷ TVL) where the on-chain fee tier is known (Meteora live; Orca/Raydium next). Per-deposit earnings use a TVL-share model calibrated to our live position — turnover alone overstates low-fee/high-volume pools.",
    disclaimer: "Informational only — NOT financial advice. Providing liquidity carries impermanent-loss and smart-contract risk.",
  };
}

module.exports = { scanPair, resolveMint };
