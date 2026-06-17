// ── Cluck Order Book — multi-venue resting-order / wall scanner ───────────────
// Reads where real buy/sell pressure rests around a token's spot price across
// every venue that keeps order/liquidity state we can read on-chain:
//   • Jupiter Limit Orders (v1 + v2)  — true limit orders, any token        [DONE]
//   • AMM depth (Jupiter route sim)   — Orca/Meteora/Raydium resistance      [next]
//   • Phoenix / OpenBook CLOBs        — real order books where they exist    [next]
// Read-only, zero-custody. Every external string is normalized; nothing signs.
//
// Output is a normalized ladder: asks (sells above spot) + bids (buys below),
// each { side, priceUsd, sizeToken, sizeUsd, distPct, venue }, then bucketed by
// distance-from-spot with cumulative USD depth — i.e. "what fills as price moves".

const { PublicKey } = require("@solana/web3.js");
const rpc = require("./rpc");

// Jupiter Limit Order programs (both live; v2 carries most current orders).
const JUP_LIMIT_PROGRAMS = [
  { ver: "v1", id: "jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu" },
  { ver: "v2", id: "j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X" },
];
// Order account layout (reverse-engineered + validated against live WIF orders):
//   maker @8 · inputMint @40 · outputMint @72 · makingAmount @208 · takingAmount @216
const OFF = { INPUT_MINT: 40, OUTPUT_MINT: 72, MAKING: 208, TAKING: 216 };
const ACCT_SLICE = 360; // covers every field we read

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// ── tiny TTL caches (decimals are immutable; prices ~30s; full scans ~30s) ────
const _decCache = new Map();      // mint -> decimals
const _priceCache = new Map();    // mint -> { usd, at }
const _scanCache = new Map();     // mint -> { data, at }
const PRICE_TTL = 30_000, SCAN_TTL = 30_000;

async function getDecimals(mint) {
  if (_decCache.has(mint)) return _decCache.get(mint);
  if (mint === WSOL_MINT) { _decCache.set(mint, 9); return 9; }
  if (mint === USDC_MINT || mint === USDT_MINT) { _decCache.set(mint, 6); return 6; }
  try {
    const info = await rpc.connection("confirmed").getParsedAccountInfo(new PublicKey(mint));
    const d = info?.value?.data?.parsed?.info?.decimals;
    if (Number.isFinite(d)) { _decCache.set(mint, d); return d; }
  } catch (_) {}
  return 9; // safe default; callers tolerate it
}

// USD price via GeckoTerminal (keyless, indexes every Solana token + pool).
async function getUsdPrice(mint) {
  const hit = _priceCache.get(mint);
  if (hit && Date.now() - hit.at < PRICE_TTL) return hit.usd;
  let usd = null;
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000),
    });
    if (r.ok) {
      const j = await r.json();
      const p = parseFloat(j?.data?.attributes?.price_usd);
      if (Number.isFinite(p) && p > 0) usd = p;
    }
  } catch (_) {}
  _priceCache.set(mint, { usd, at: Date.now() });
  return usd;
}

function _readPk(buf, off) { return new PublicKey(buf.subarray(off, off + 32)).toBase58(); }
function _readU64(buf, off) { return off + 8 <= buf.length ? buf.readBigUInt64LE(off) : 0n; }

// ── Venue 1: Jupiter Limit Orders ─────────────────────────────────────────────
// Returns normalized resting orders for `mint` across both programs. `inputMint
// == mint` is a SELL of the token (maker gives token, wants quote); `outputMint
// == mint` is a BUY. Price is derived from making/taking amounts + counter USD.
async function scanJupiterLimitOrders(mint, decimals, spotUsd) {
  const conn = rpc.connection("confirmed");
  const orders = [];
  let raw = 0;
  for (const prog of JUP_LIMIT_PROGRAMS) {
    const pid = new PublicKey(prog.id);
    // sells: token at INPUT_MINT offset · buys: token at OUTPUT_MINT offset
    for (const [side, off] of [["sell", OFF.INPUT_MINT], ["buy", OFF.OUTPUT_MINT]]) {
      let accts;
      try {
        accts = await conn.getProgramAccounts(pid, {
          commitment: "confirmed",
          dataSlice: { offset: 0, length: ACCT_SLICE },
          filters: [{ memcmp: { offset: off, bytes: mint } }],
        });
      } catch (_) { continue; }
      for (const a of accts) {
        const buf = a.account.data; // Buffer (dataSlice)
        if (!buf || buf.length < OFF.TAKING + 8) continue;
        raw++;
        const inputMint = _readPk(buf, OFF.INPUT_MINT);
        const outputMint = _readPk(buf, OFF.OUTPUT_MINT);
        const making = _readU64(buf, OFF.MAKING);
        const taking = _readU64(buf, OFF.TAKING);
        if (making === 0n || taking === 0n) continue; // filled / invalid
        const counter = side === "sell" ? outputMint : inputMint;
        const counterDec = await getDecimals(counter);
        const counterUsd = await getUsdPrice(counter);
        // token side amount + the quote (counter) side amount, in UI units
        const tokenAmt = Number(side === "sell" ? making : taking) / 10 ** decimals;
        const quoteAmt = Number(side === "sell" ? taking : making) / 10 ** counterDec;
        if (!(tokenAmt > 0)) continue;
        const priceUsd = counterUsd != null ? (quoteAmt * counterUsd) / tokenAmt : null;
        orders.push({
          venue: `jupiter-lo-${prog.ver}`,
          side,
          sizeToken: tokenAmt,
          sizeUsd: priceUsd != null ? tokenAmt * priceUsd : null,
          priceUsd,
          counterMint: counter,
          distPct: (priceUsd != null && spotUsd) ? (priceUsd / spotUsd - 1) * 100 : null,
          orderPubkey: a.pubkey.toBase58(),
        });
      }
    }
  }
  return { source: "jupiter-lo", rawAccounts: raw, orders };
}

// ── Aggregation: split asks/bids, bucket by distance-from-spot, cumulative depth ─
function summarize(orders, spotUsd) {
  const priced = orders.filter(o => o.priceUsd != null && o.distPct != null);
  const asks = priced.filter(o => o.side === "sell" && o.distPct >= -0.5).sort((a, b) => a.priceUsd - b.priceUsd);
  const bids = priced.filter(o => o.side === "buy" && o.distPct <= 0.5).sort((a, b) => b.priceUsd - a.priceUsd);
  // Buckets at ±1,2,5,10,25,50,100% from spot (cumulative USD that fills moving that far).
  const bands = [1, 2, 5, 10, 25, 50, 100];
  const cum = (list, dir) => bands.map(b => {
    const within = list.filter(o => dir > 0 ? (o.distPct > 0 && o.distPct <= b) : (o.distPct < 0 && o.distPct >= -b));
    return { withinPct: b, orders: within.length, usd: within.reduce((s, o) => s + (o.sizeUsd || 0), 0), token: within.reduce((s, o) => s + (o.sizeToken || 0), 0) };
  });
  return {
    spotUsd,
    asks: { count: asks.length, usd: asks.reduce((s, o) => s + (o.sizeUsd || 0), 0), top: asks.slice(0, 15), cumulative: cum(asks, +1) },
    bids: { count: bids.length, usd: bids.reduce((s, o) => s + (o.sizeUsd || 0), 0), top: bids.slice(0, 15), cumulative: cum(bids, -1) },
  };
}

// ── Public entrypoint ─────────────────────────────────────────────────────────
async function scan(mint, { nocache = false } = {}) {
  const hit = _scanCache.get(mint);
  if (!nocache && hit && Date.now() - hit.at < SCAN_TTL) return { ...hit.data, cached: true };

  const [decimals, spotUsd] = await Promise.all([getDecimals(mint), getUsdPrice(mint)]);
  const venueTasks = [
    scanJupiterLimitOrders(mint, decimals, spotUsd),
    // AMM depth + CLOB venues plug in here next.
  ];
  const settled = await Promise.allSettled(venueTasks);
  const sources = {}; let orders = [];
  for (const s of settled) {
    if (s.status === "fulfilled") { sources[s.value.source] = { rawAccounts: s.value.rawAccounts, orders: s.value.orders.length }; orders = orders.concat(s.value.orders); }
    else sources[`err`] = String(s.reason && s.reason.message || s.reason);
  }
  const data = {
    mint, decimals, spotUsd,
    scannedAt: new Date().toISOString(),
    sources,
    ...summarize(orders, spotUsd),
  };
  _scanCache.set(mint, { data, at: Date.now() });
  return data;
}

module.exports = { scan, scanJupiterLimitOrders, getDecimals, getUsdPrice, JUP_LIMIT_PROGRAMS };
