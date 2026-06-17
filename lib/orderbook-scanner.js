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
// Mints sit at @40 / @72 in BOTH programs (confirmed by count probes); the
// making/taking AMOUNT offsets differ by version. v2 validated against live WIF
// orders; v1's amount layout differs — `amt:null` skips its decode until known
// (use debugJupSample to discover it), so v1 garbage never reaches output.
const JUP_LIMIT_PROGRAMS = [
  { ver: "v1", id: "jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu", amt: { making: 104, taking: 112 } }, // 315-byte accts; older program (often stale orders)
  { ver: "v2", id: "j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X", amt: { making: 208, taking: 216 } },
];
const OFF = { INPUT_MINT: 40, OUTPUT_MINT: 72 };
const ACCT_SLICE = 360; // covers every field we read
const MAX_SANE_TOKEN = 1e15; // defensive: no real UI-unit order exceeds this

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
    if (!prog.amt) continue; // amount layout not yet known for this version → skip decode
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
        if (!buf || buf.length < prog.amt.taking + 8) continue;
        raw++;
        const inputMint = _readPk(buf, OFF.INPUT_MINT);
        const outputMint = _readPk(buf, OFF.OUTPUT_MINT);
        const making = _readU64(buf, prog.amt.making);
        const taking = _readU64(buf, prog.amt.taking);
        if (making === 0n || taking === 0n) continue; // filled / invalid
        const counter = side === "sell" ? outputMint : inputMint;
        const counterDec = await getDecimals(counter);
        const counterUsd = await getUsdPrice(counter);
        // token side amount + the quote (counter) side amount, in UI units
        const tokenAmt = Number(side === "sell" ? making : taking) / 10 ** decimals;
        const quoteAmt = Number(side === "sell" ? taking : making) / 10 ** counterDec;
        if (!(tokenAmt > 0) || tokenAmt > MAX_SANE_TOKEN) continue; // defensive vs misdecode
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

// ── Venue 2: AMM depth (Jupiter route simulation across all pools) ────────────
// AMMs have no discrete orders, but the resistance is real: simulate buying /
// selling increasing USD sizes via Jupiter (which routes across EVERY pool —
// Orca, Meteora, Raydium, …) and read the average fill price + price impact at
// each size. That's the "what fills as price moves ±X%" curve for the token.
const DEPTH_SIZES_USD = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const JUP_QUOTE_HOSTS = ["https://lite-api.jup.ag/swap/v1/quote", "https://quote-api.jup.ag/v6/quote"];
async function jupQuote(inputMint, outputMint, amountRaw) {
  let lastErr = "no host";
  for (const host of JUP_QUOTE_HOSTS) {
    const u = `${host}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=3000`;
    try {
      const r = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { let t = ""; try { t = (await r.text()).slice(0, 80); } catch {} lastErr = `http ${r.status} ${t}`; continue; }
      const j = await r.json().catch(() => null);
      if (!j || !j.outAmount) { lastErr = "no outAmount"; continue; }
      return { outAmount: Number(j.outAmount), impactPct: (parseFloat(j.priceImpactPct) || 0) * 100 };
    } catch (e) { lastErr = "fetch:" + (e.message || e.name); }
  }
  return { error: lastErr };
}
async function scanAmmDepth(mint, decimals, spotUsd) {
  if (!spotUsd) return { source: "amm-depth", skipped: "no spot price", ask: [], bid: [] };
  const ask = [], bid = []; let diag = null;
  for (const usd of DEPTH_SIZES_USD) {
    // ASK side — buy `mint` with USDC (pushes price UP): avg fill price + impact.
    const ra = await jupQuote(USDC_MINT, mint, Math.round(usd * 1e6));
    if (ra.outAmount > 0) {
      const tokens = ra.outAmount / 10 ** decimals;
      const avg = usd / tokens;
      ask.push({ usd, tokens, avgPriceUsd: avg, distPct: (avg / spotUsd - 1) * 100, impactPct: ra.impactPct });
    } else if (!diag) diag = "ask:" + ra.error;
    // BID side — sell `usd`-worth of `mint` for USDC (pushes price DOWN).
    const tokRaw = Math.round((usd / spotUsd) * 10 ** decimals);
    const rb = await jupQuote(mint, USDC_MINT, tokRaw);
    if (rb.outAmount > 0) {
      const tokens = tokRaw / 10 ** decimals;
      const avg = (rb.outAmount / 1e6) / tokens;
      bid.push({ usd, tokens, avgPriceUsd: avg, distPct: (avg / spotUsd - 1) * 100, impactPct: rb.impactPct });
    } else if (!diag) diag = "bid:" + rb.error;
  }
  return { source: "amm-depth", quote: "USDC", ask, bid, diag };
}

// ── Venue 3: Orca Whirlpool single-sided positions ("Orca limit orders") ──────
const _orcaPoolsCache = new Map();
async function getOrcaPoolsFor(mint) {
  const hit = _orcaPoolsCache.get(mint);
  if (hit && Date.now() - hit.at < 300_000) return hit.pools;
  let pools = [];
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (r.ok) { const j = await r.json(); pools = (j?.data || []).filter(p => p?.relationships?.dex?.data?.id === "orca").map(p => p?.attributes?.address).filter(Boolean); }
  } catch (_) {}
  _orcaPoolsCache.set(mint, { pools, at: Date.now() });
  return pools;
}
async function scanOrcaWalls(mint, spotUsd) {
  const pools = await getOrcaPoolsFor(mint);
  if (!pools.length) return { source: "orca-walls", pools: 0, walls: [] };
  const orca = require("./orca-whirlpools");
  const walls = [];
  for (const pool of pools.slice(0, 6)) {
    let res; try { res = await orca.poolWalls(pool, mint, spotUsd); } catch (_) { continue; }
    const poolSpotQ = res.tokenPriceInQuote;
    for (const w of res.walls) {
      const midQ = ((w.priceLow || 0) + (w.priceHigh || 0)) / 2;
      const distPct = poolSpotQ > 0 ? (midQ / poolSpotQ - 1) * 100 : null;
      const priceUsd = (spotUsd && poolSpotQ > 0) ? spotUsd * (midQ / poolSpotQ) : null;
      walls.push({
        venue: "orca", pool, side: w.side, single: w.side === "sell" || w.side === "buy",
        sizeToken: w.side === "buy" ? w.quoteAmount : w.tokenAmount, sizeUsd: w.sizeUsd,
        priceUsd, distPct, orderPubkey: w.positionPubkey, quoteSymbol: res.quoteSymbol, inRange: w.inRange,
      });
    }
  }
  return { source: "orca-walls", pools: pools.length, walls };
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
    asks: { count: asks.length, usd: asks.reduce((s, o) => s + (o.sizeUsd || 0), 0), top: asks.slice(0, 15), cumulative: cum(asks, +1) },
    bids: { count: bids.length, usd: bids.reduce((s, o) => s + (o.sizeUsd || 0), 0), top: bids.slice(0, 15), cumulative: cum(bids, -1) },
  };
}

// ── Public entrypoint ─────────────────────────────────────────────────────────
async function scan(mint, { nocache = false } = {}) {
  const hit = _scanCache.get(mint);
  if (!nocache && hit && Date.now() - hit.at < SCAN_TTL) return { ...hit.data, cached: true };

  const [decimals, spotUsd] = await Promise.all([getDecimals(mint), getUsdPrice(mint)]);
  const [loRes, ammRes, orcaRes] = await Promise.allSettled([
    scanJupiterLimitOrders(mint, decimals, spotUsd),
    scanAmmDepth(mint, decimals, spotUsd),
    scanOrcaWalls(mint, spotUsd),
  ]);
  const sources = {};
  let orders = [];
  if (loRes.status === "fulfilled") { sources["jupiter-lo"] = { rawAccounts: loRes.value.rawAccounts, orders: loRes.value.orders.length }; orders = loRes.value.orders; }
  else sources["jupiter-lo"] = { error: String(loRes.reason && loRes.reason.message || loRes.reason) };
  let ammDepth = null;
  if (ammRes.status === "fulfilled") { ammDepth = ammRes.value; sources["amm-depth"] = { askPts: (ammRes.value.ask || []).length, bidPts: (ammRes.value.bid || []).length, skipped: ammRes.value.skipped, diag: ammRes.value.diag }; }
  else sources["amm-depth"] = { error: String(ammRes.reason && ammRes.reason.message || ammRes.reason) };
  let orcaWalls = null;
  if (orcaRes.status === "fulfilled") {
    const w = orcaRes.value.walls || [];
    const sells = w.filter(x => x.side === "sell").sort((a, b) => (a.distPct ?? 0) - (b.distPct ?? 0));
    const buys = w.filter(x => x.side === "buy").sort((a, b) => (b.distPct ?? 0) - (a.distPct ?? 0));
    orcaWalls = { pools: orcaRes.value.pools, sells, buys, twoSided: w.filter(x => x.side === "two-sided").length };
    sources["orca-walls"] = { pools: orcaRes.value.pools, sells: sells.length, buys: buys.length, twoSided: orcaWalls.twoSided };
  } else sources["orca-walls"] = { error: String(orcaRes.reason && orcaRes.reason.message || orcaRes.reason) };

  const data = {
    mint, decimals, spotUsd,
    scannedAt: new Date().toISOString(),
    sources,
    limitOrders: summarize(orders, spotUsd),
    ammDepth,
    orcaWalls,
  };
  _scanCache.set(mint, { data, at: Date.now() });
  return data;
}

// ── Discovery helper: dump a program's order account layout for a token ───────
// Used to find the making/taking amount offsets for a given program version
// (mints are at @40/@72). Returns a u64 field map + the two mints per sample.
async function debugJupSample(mint, ver = "v1") {
  const prog = JUP_LIMIT_PROGRAMS.find(p => p.ver === ver) || JUP_LIMIT_PROGRAMS[0];
  const conn = rpc.connection("confirmed");
  const out = { ver: prog.ver, program: prog.id, samples: [] };
  for (const [side, off] of [["sell", OFF.INPUT_MINT], ["buy", OFF.OUTPUT_MINT]]) {
    let accts = [];
    try {
      accts = await conn.getProgramAccounts(new PublicKey(prog.id), {
        commitment: "confirmed", dataSlice: { offset: 0, length: ACCT_SLICE },
        filters: [{ memcmp: { offset: off, bytes: mint } }],
      });
    } catch (e) { out.samples.push({ side, error: e.message }); continue; }
    for (const a of accts.slice(0, 2)) {
      const buf = a.account.data;
      const u64s = {};
      for (let i = 8; i + 8 <= buf.length; i += 8) u64s[i] = _readU64(buf, i).toString();
      out.samples.push({ side, pubkey: a.pubkey.toBase58(), len: buf.length, inputMint: _readPk(buf, OFF.INPUT_MINT), outputMint: _readPk(buf, OFF.OUTPUT_MINT), u64s });
    }
  }
  return out;
}

// ── Venue 3 (discovery): Orca Whirlpool single-sided positions = "Orca limit orders" ─
// Orca's "limit orders" are single-sided Whirlpool positions (range orders). Read
// EVERY position in a pool (any owner) → flag the single-sided ones above/below
// spot as sell/buy walls. First, probe the Position account layout against live data.
const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
async function debugOrcaPositions(pool) {
  const conn = rpc.connection("confirmed");
  const accts = await conn.getProgramAccounts(new PublicKey(ORCA_WHIRLPOOL_PROGRAM), {
    commitment: "confirmed", dataSlice: { offset: 0, length: 216 },
    filters: [{ memcmp: { offset: 8, bytes: pool } }], // whirlpool pubkey expected @8 in Position accts
  });
  const out = { pool, program: ORCA_WHIRLPOOL_PROGRAM, count: accts.length, samples: [] };
  for (const a of accts.slice(0, 4)) {
    const buf = a.account.data;
    out.samples.push({
      pubkey: a.pubkey.toBase58(), len: buf.length,
      whirlpool_at8: _readPk(buf, 8),
      pk_at40: buf.length >= 72 ? _readPk(buf, 40) : null,
      liq_lo_at72: buf.length >= 80 ? _readU64(buf, 72).toString() : null,
      liq_hi_at80: buf.length >= 88 ? _readU64(buf, 80).toString() : null,
      tickLower_at88: buf.length >= 92 ? buf.readInt32LE(88) : null,
      tickUpper_at92: buf.length >= 96 ? buf.readInt32LE(92) : null,
    });
  }
  return out;
}

// Full resting limit-order list for a mint (every order incl. pubkey) — used by
// the day-to-day monitor to diff snapshots and detect orders appearing / filling.
async function monitorScan(mint) {
  const [decimals, spotUsd] = await Promise.all([getDecimals(mint), getUsdPrice(mint)]);
  const [lo, orca] = await Promise.allSettled([
    scanJupiterLimitOrders(mint, decimals, spotUsd),
    scanOrcaWalls(mint, spotUsd),
  ]);
  let orders = [];
  if (lo.status === "fulfilled") orders = orders.concat(lo.value.orders);
  // Orca single-sided positions are limit-order-like — include them so the monitor
  // alerts when one appears/fills (keyed by position pubkey).
  if (orca.status === "fulfilled") orders = orders.concat((orca.value.walls || []).filter(w => w.single).map(w => ({ venue: "orca-" + w.side, side: w.side, orderPubkey: w.orderPubkey, sizeUsd: w.sizeUsd, priceUsd: w.priceUsd, distPct: w.distPct })));
  return { spotUsd, decimals, orders };
}

module.exports = { scan, scanJupiterLimitOrders, scanAmmDepth, monitorScan, getDecimals, getUsdPrice, debugJupSample, debugOrcaPositions, JUP_LIMIT_PROGRAMS };
