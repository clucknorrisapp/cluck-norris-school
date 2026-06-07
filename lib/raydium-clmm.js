// ── Liquidity Engine: Raydium CLMM adapter ───────────────────────────────────
// A second venue adapter alongside lib/orca-whirlpools.js, exposing the SAME interface
// so the multi-tenant vault can manage a project on EITHER venue (project.venue picks
// it). Raydium CLMM is concentrated liquidity (single-sided / balanced positions, cheap
// to manage) — the venue many Solana projects (e.g. ROSE/OnlyRose) actually live on.
//
// Interface parity with the Orca adapter (drop-in for the vault):
//   discoverPools(tok), getPoolState(addr, owner, tok), suggestRanges(st, widthPct),
//   quote(...), buildOpenPosition(...), buildClosePosition(...), listPositions(owner, tok)
//   + constants USDC_MINT / WSOL_MINT / DEFAULT_TOKEN.
// Result objects mirror the Orca shape (legacy clkn* aliases + generic token* names) so
// the vault and /liquidity consume both venues identically.
//
// BUILD STATUS (staged, so we never ship untested money-moving code as "done"):
//   ✅ read-side: discoverPools (Raydium API v3) — VERIFIED live on ROSE.
//   🚧 getPoolState / suggestRanges / quote / listPositions / buildOpenPosition /
//      buildClosePosition — implemented against the Raydium SDK next, then validated
//      with a SMALL live position on a funded operator wallet before going autonomous.
const { Connection, PublicKey } = require("@solana/web3.js");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const RAYDIUM_API = "https://api-v3.raydium.io";

// No built-in default token for Raydium (CLKN is an Orca project). Kept for interface
// parity; callers always pass an explicit token context.
const DEFAULT_TOKEN = { mint: null, symbol: "TOKEN", quoteMints: [USDC_MINT, WSOL_MINT] };

const QUOTE_SYMBOLS = { [USDC_MINT]: "USDC", [WSOL_MINT]: "SOL" };
function quoteSymbolFor(mint, fallback) {
  return QUOTE_SYMBOLS[mint] || fallback || (mint ? mint.slice(0, 4) + "…" : "?");
}

function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
}
function connection() { return new Connection(rpcUrl(), "confirmed"); }

async function raydiumApi(path) {
  const r = await fetch(RAYDIUM_API + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Raydium API ${r.status}`);
  return r.json();
}

// ── Pool discovery ───────────────────────────────────────────────────────────
// Every Raydium CONCENTRATED (CLMM) pool that pairs the token with a supported quote
// (USDC/SOL), normalised so the caller always gets "token price in the quote token"
// regardless of which side the token sits on — identical output shape to the Orca
// adapter's discoverPools(), so the vault treats both venues the same.
async function discoverPools(tok = DEFAULT_TOKEN) {
  if (!tok || !tok.mint) throw new Error("Raydium discoverPools needs a token mint");
  const j = await raydiumApi(`/pools/info/mint?mint1=${tok.mint}&poolType=concentrated&poolSortField=liquidity&sortType=desc&pageSize=50&page=1`);
  const pools = (j && j.data && Array.isArray(j.data.data)) ? j.data.data : [];
  const allow = new Set((tok.quoteMints && tok.quoteMints.length) ? tok.quoteMints : Object.keys(QUOTE_SYMBOLS));
  const out = [];
  for (const p of pools) {
    const a = p.mintA, b = p.mintB;
    if (!a || !b) continue;
    const tokenIsA = a.address === tok.mint;
    const quoteTok = tokenIsA ? b : a;
    if (!allow.has(quoteTok.address)) continue;
    const quoteSymbol = quoteSymbolFor(quoteTok.address, quoteTok.symbol);

    const priceBPerA = Number(p.price); // tokenB per tokenA, from Raydium
    const tokenPriceInQuote = tokenIsA ? priceBPerA : (priceBPerA > 0 ? 1 / priceBPerA : 0);
    const tickSpacing = p.config ? p.config.tickSpacing : undefined;
    const feeTierPct = p.feeRate != null ? p.feeRate * 100 : (p.config ? p.config.tradeFeeRate / 10000 : undefined);

    out.push({
      venue: "raydium",
      address: p.id,
      programId: p.programId,
      configId: p.config ? p.config.id : null,
      pair: `${tok.symbol}/${quoteSymbol}`,
      quoteSymbol,
      quoteMint: quoteTok.address,
      tokenMint: tok.mint,
      tokenSymbol: tok.symbol,
      tokenIsA,
      clknIsA: tokenIsA,                    // legacy alias
      feeTierPct,
      tickSpacing,
      liquidity: p.tvl != null ? String(p.tvl) : "0",
      tvlUsd: p.tvl != null ? Number(p.tvl) : null,
      empty: !(Number(p.tvl) > 0),
      tokenPriceInQuote,
      clknPriceInQuote: tokenPriceInQuote,  // legacy alias
      decimalsA: a.decimals,
      decimalsB: b.decimals,
      symbolA: a.symbol,
      symbolB: b.symbol,
      hasWarning: false,
    });
  }
  out.sort((x, y) => x.pair.localeCompare(y.pair) || (x.feeTierPct - y.feeTierPct));
  return out;
}

// ── Staged (Raydium SDK) — implemented + live-tested next ─────────────────────
const STAGED = "Raydium CLMM venue: this operation is staged for the next build step (SDK tx layer), pending a small live position test.";
async function getPoolState() { throw new Error(STAGED); }
function suggestRanges() { throw new Error(STAGED); }
async function quote() { throw new Error(STAGED); }
async function buildOpenPosition() { throw new Error(STAGED); }
async function buildClosePosition() { throw new Error(STAGED); }
async function listPositions() { throw new Error(STAGED); }

module.exports = {
  USDC_MINT, WSOL_MINT, DEFAULT_TOKEN,
  discoverPools,
  getPoolState,
  suggestRanges,
  quote,
  buildOpenPosition,
  buildClosePosition,
  listPositions,
};
