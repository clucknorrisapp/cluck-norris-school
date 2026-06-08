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
// Custody model: NON-CUSTODIAL, exactly like the Orca adapter and lib/securitycoop.js.
// The server only ever BUILDS unsigned transactions; the operator's own wallet signs and
// submits them. No private key for project funds touches the server. Opening a position
// mints a position-NFT whose ephemeral mint keypair is generated and partial-signed
// server-side (it controls no funds, only the NFT created in the same tx); the owner adds
// the fee-payer/authority signature in their wallet.
//
// BUILD STATUS:
//   ✅ read-side: discoverPools (Raydium API v3) — VERIFIED live on ROSE.
//   ✅ getPoolState / suggestRanges / quote / listPositions — Raydium SDK v2, read-only,
//      live-tested against the ROSE/SOL CLMM pool.
//   ✅ buildOpenPosition / buildClosePosition — build UNSIGNED only (never sent). Mirror
//      Orca's serializeUnsigned: partial-sign ephemeral signers, leave fee payer for the
//      browser/operator wallet.
//
// SDK NOTES (@raydium-io/raydium-sdk-v2 0.2.50-alpha):
//   • Raydium.load({ connection, owner }) boots the SDK; clmm module hangs off it.
//   • clmm.getPoolInfoFromRpc(poolId) → { poolInfo (API shape), poolKeys, rpcPoolInfo,
//     computePoolInfo }. poolInfo is the ApiV3PoolInfoConcentratedItem the tx + quote
//     helpers want; rpcPoolInfo is the fresh on-chain PoolInfoLayout decode (sqrtPriceX64,
//     tickCurrent, tickSpacing, mintDecimalsA/B, liquidity).
//   • TickUtil.getPriceAndTick / tickToPrice / sqrtPriceX64ToPrice — price<->tick math.
//   • PoolUtils.getLiquidityAmountOutFromAmountIn — the increase-liquidity quote (amount
//     of the OTHER token + liquidity), Raydium's analogue to Orca's increaseLiquidityQuote.
//   • clmm.openPositionFromBase — open from a base-token amount (auto-derives liquidity).
//   • clmm.getOwnerPositionInfo — owner's CLMM positions (PersonalPositionLayout decode[]).
//   • clmm.closePosition — withdraw-all + collect-fees + close (uses an ownerPosition decode).
const { Connection, PublicKey } = require("@solana/web3.js");
const {
  Raydium,
  TxVersion,
  PoolUtils,
  TickUtil,
} = require("@raydium-io/raydium-sdk-v2");
const Decimal = require("decimal.js");
const BN = require("bn.js");

// ── Constants ────────────────────────────────────────────────────────────────
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const RAYDIUM_API = "https://api-v3.raydium.io";

// No built-in default token for Raydium (CLKN is an Orca project). Kept for interface
// parity; callers always pass an explicit token context { mint, symbol, quoteMints }.
const DEFAULT_TOKEN = { mint: null, symbol: "TOKEN", quoteMints: [USDC_MINT, WSOL_MINT] };

const QUOTE_SYMBOLS = { [USDC_MINT]: "USDC", [WSOL_MINT]: "SOL" };
function quoteSymbolFor(mint, fallback) {
  return QUOTE_SYMBOLS[mint] || fallback || (mint ? mint.slice(0, 4) + "…" : "?");
}

// A placeholder owner for read-only RPC (reads never sign). The system program
// address is a safe stand-in pubkey, same trick the Orca adapter uses.
const READONLY_OWNER = new PublicKey("11111111111111111111111111111111");

// Mainnet RPC — resilient with automatic failover (lib/rpc.js): a primary 429 /
// outage rolls to a backup RPC and the public node instead of failing the call.
const { connection: rpcConnection, primaryRpcUrl } = require("./rpc");
function rpcUrl() { return primaryRpcUrl(); }
function connection() { return rpcConnection("confirmed"); }

async function raydiumApi(path) {
  const r = await fetch(RAYDIUM_API + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Raydium API ${r.status}`);
  return r.json();
}

// Boot the Raydium SDK against our RPC for a given owner (defaults to the read-only
// placeholder). `disableLoadToken` skips the heavy token-list fetch we don't need for
// pool/position work — keeps the call fast and offline-friendly.
async function loadSdk(ownerPubkey) {
  const owner = ownerPubkey || READONLY_OWNER;
  return Raydium.load({
    connection: connection(),
    owner,                       // PublicKey only — the SDK never signs here
    disableLoadToken: true,
    disableFeatureCheck: true,
    blockhashCommitment: "confirmed",
  });
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

// ── Fetch full SDK pool bundle (cached per call) ─────────────────────────────
// getPoolInfoFromRpc returns the API-shaped poolInfo (needed by the quote + tx
// builders), the on-chain rpc decode (fresh sqrtPrice/tick/liquidity), and poolKeys.
async function fetchPoolBundle(raydium, address) {
  const bundle = await raydium.clmm.getPoolInfoFromRpc(address);
  // { poolInfo, poolKeys, rpcPoolInfo (a.k.a. computePoolInfo), tickData... }
  return bundle;
}

// ── Live pool state (on-chain, fresh) ────────────────────────────────────────
async function getPoolState(address, ownerPubkey, tok = DEFAULT_TOKEN) {
  const raydium = await loadSdk(ownerPubkey);
  const { poolInfo, rpcPoolInfo } = await fetchPoolBundle(raydium, address);

  const decA = poolInfo.mintA.decimals;
  const decB = poolInfo.mintB.decimals;
  const mintA = poolInfo.mintA.address;
  const mintB = poolInfo.mintB.address;
  const tickSpacing = poolInfo.config ? poolInfo.config.tickSpacing : rpcPoolInfo.tickSpacing;
  const sqrtPriceX64 = rpcPoolInfo.sqrtPriceX64;
  const tickCurrentIndex = rpcPoolInfo.tickCurrent;
  const liquidity = rpcPoolInfo.liquidity;

  const tokenIsA = mintA === (tok.mint || mintA);
  const quoteMint = tokenIsA ? mintB : mintA;
  const quoteSymbol = quoteSymbolFor(quoteMint, tokenIsA ? poolInfo.mintB.symbol : poolInfo.mintA.symbol);

  // price = tokenB per tokenA, derived from the live sqrtPrice.
  const priceBPerA = Number(TickUtil.sqrtPriceX64ToPrice(sqrtPriceX64, decA, decB).toString());
  const tokenPriceInQuote = tokenIsA ? priceBPerA : (priceBPerA > 0 ? 1 / priceBPerA : 0);

  // Fee tier as a percent. From RPC, config.tradeFeeRate is in millionths of the
  // notional (2500 = 0.25%), so /10000 → percent. (NB: the discover API endpoint
  // returns feeRate as a fraction instead — different unit, handled there.)
  const tradeFeeRate = poolInfo.config ? poolInfo.config.tradeFeeRate : null;
  const feeTierPct = tradeFeeRate != null ? tradeFeeRate / 10000 : undefined;

  return {
    venue: "raydium",
    address,
    programId: poolInfo.programId,
    tickSpacing,
    tickCurrentIndex,
    sqrtPrice: sqrtPriceX64.toString(),
    liquidity: liquidity.toString(),
    empty: liquidity.isZero(),
    feeTierPct,
    decimalsA: decA,
    decimalsB: decB,
    mintA,
    mintB,
    tokenMint: tok.mint || mintA,
    tokenSymbol: tok.symbol,
    tokenIsA,
    clknIsA: tokenIsA,                    // legacy alias
    quoteMint,
    quoteSymbol,
    priceBPerA,
    tokenPriceInQuote,
    clknPriceInQuote: tokenPriceInQuote,  // legacy alias
    // stash the SDK bundle so downstream calls (suggestRanges/quote) needn't refetch.
    _poolInfo: poolInfo,
  };
}

// ── Range math (single-sided & balanced) ─────────────────────────────────────
// Concentrated-liquidity mechanics (price = tokenB per tokenA):
//   • A range entirely ABOVE the current price holds 100% tokenA (deposit tokenA only).
//   • A range entirely BELOW the current price holds 100% tokenB (deposit tokenB only).
//   • A range straddling the current price holds BOTH (a balanced position).
// "single-sided token" = a sell-wall above price; "single-sided quote" = a buy-wall
// (bid support) below price. We compute tick bounds aligned to the pool tick spacing
// using the SDK's getPriceAndTick (which snaps a price to an initializable tick).
function alignTick(priceBPerA, decA, decB, spacing) {
  // priceToTick gives the (unsnapped, correctly-signed) tick for a B-per-A price.
  // getPriceAndTick's zeroForOne rounding flips the sign on some inputs, so we snap
  // to the spacing ourselves to stay on the correct side of zero.
  const raw = TickUtil.priceToTick(new Decimal(priceBPerA > 0 ? priceBPerA : 1e-12), decA, decB);
  return Math.round(raw / spacing) * spacing;
}

// Convert a tick index to "token price in quote", honouring orientation.
function tickToTokenPrice(tick, st) {
  const bPerA = Number(TickUtil.tickToPrice(tick, st.decimalsA, st.decimalsB).toString());
  return st.clknIsA ? bPerA : (bPerA > 0 ? 1 / bPerA : 0);
}

// Build the suggested ranges for a pool given a width (% around current price).
// Returns one option per deposit choice: deposit-token-only, deposit-quote-only,
// and balanced (both). Each option carries the tick bounds the quote/open calls
// need, plus human token-price bounds for display. Same shape Orca returns.
function suggestRanges(st, widthPct) {
  const w = Math.max(0.5, Math.min(95, Number(widthPct) || 15)) / 100;
  const cur = st.priceBPerA;
  const { decimalsA: dA, decimalsB: dB, tickSpacing: sp, tickCurrentIndex: curTick } = st;

  const lowerWide = alignTick(cur * (1 - w), dA, dB, sp);
  const upperWide = alignTick(cur * (1 + w), dA, dB, sp);

  // tokenA-only: strictly above current tick.
  let aLower = alignTick(cur, dA, dB, sp);
  if (aLower <= curTick) aLower += sp;
  let aUpper = upperWide;
  if (aUpper <= aLower) aUpper = aLower + sp;

  // tokenB-only: strictly below current tick.
  let bUpper = alignTick(cur, dA, dB, sp);
  if (bUpper >= curTick) bUpper -= sp;
  let bLower = lowerWide;
  if (bLower >= bUpper) bLower = bUpper - sp;

  // Map A/B-only to token/quote-only based on which side the token sits on.
  const sym = st.tokenSymbol || "TOKEN";
  const tokMint = st.tokenMint;
  const tokenOnly = st.clknIsA
    ? { lowerTick: aLower, upperTick: aUpper, depositMint: tokMint, depositSymbol: sym }
    : { lowerTick: bLower, upperTick: bUpper, depositMint: tokMint, depositSymbol: sym };
  const quoteOnly = st.clknIsA
    ? { lowerTick: bLower, upperTick: bUpper, depositMint: st.quoteMint, depositSymbol: st.quoteSymbol }
    : { lowerTick: aLower, upperTick: aUpper, depositMint: st.quoteMint, depositSymbol: st.quoteSymbol };
  const balanced = { lowerTick: lowerWide, upperTick: upperWide, depositMint: null, depositSymbol: sym + " + " + st.quoteSymbol };

  const decorate = (o, id, label) => {
    const p1 = tickToTokenPrice(o.lowerTick, st);
    const p2 = tickToTokenPrice(o.upperTick, st);
    return {
      id, label,
      depositMint: o.depositMint,
      depositSymbol: o.depositSymbol,
      lowerTick: o.lowerTick,
      upperTick: o.upperTick,
      lowerPriceClkn: Math.min(p1, p2),
      upperPriceClkn: Math.max(p1, p2),
    };
  };

  return {
    currentPriceClkn: st.clknPriceInQuote,
    quoteSymbol: st.quoteSymbol,
    widthPct: w * 100,
    options: [
      decorate(tokenOnly, "clkn", `Sell-side wall — deposit ${sym} only (asks above ${fmt(st.clknPriceInQuote)})`),
      decorate(quoteOnly, "quote", `Buy-side support — deposit ${st.quoteSymbol} only (bids below ${fmt(st.clknPriceInQuote)})`),
      decorate(balanced, "balanced", `Balanced — both sides, ±${(w * 100).toFixed(1)}% around price`),
    ],
  };
}

function fmt(n) {
  if (!isFinite(n)) return "?";
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(3);
  return n.toPrecision(5);
}

// ── Liquidity quote ──────────────────────────────────────────────────────────
// Given a deposit (input token + amount) and a tick range, work out how much
// liquidity it buys and how much of EACH token the position will actually use.
// Raydium's PoolUtils.getLiquidityAmountOutFromAmountIn is the analogue of Orca's
// increaseLiquidityQuote: feed it the base side + amount, get the other side + liquidity.
async function quote({ address, owner, inputMint, inputAmount, lowerTick, upperTick, slippageBps }) {
  const raydium = await loadSdk(owner ? new PublicKey(owner) : null);
  const { poolInfo, rpcPoolInfo } = await fetchPoolBundle(raydium, address);
  const epochInfo = await raydium.fetchEpochInfo();

  const decA = poolInfo.mintA.decimals;
  const decB = poolInfo.mintB.decimals;
  const inputIsA = poolInfo.mintA.address === inputMint;
  const inputDecimals = inputIsA ? decA : decB;
  const slippage = clampSlippage(slippageBps);

  const amount = uiToBN(inputAmount, inputDecimals);
  const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    inputA: inputIsA,
    tickLower: Math.min(Number(lowerTick), Number(upperTick)),
    tickUpper: Math.max(Number(lowerTick), Number(upperTick)),
    amount,
    slippage,         // fraction, e.g. 0.01 for 1%
    add: true,        // adding liquidity
    epochInfo,
    amountHasFee: true,
  });

  // res.amountA / amountB are { amount, fee, ... } GetTransferAmountFee; res.liquidity is BN.
  const estA = inputIsA ? amount : res.amountA.amount;
  const estB = inputIsA ? res.amountB.amount : amount;
  // amountSlippageA/B carry the slippage-adjusted maxima when present.
  const maxA = res.amountSlippageA ? res.amountSlippageA.amount : estA;
  const maxB = res.amountSlippageB ? res.amountSlippageB.amount : estB;

  return {
    liquidity: res.liquidity.toString(),
    estA: bnToUi(estA, decA),
    estB: bnToUi(estB, decB),
    maxA: bnToUi(maxA, decA),
    maxB: bnToUi(maxB, decB),
    decimalsA: decA,
    decimalsB: decB,
    inputDecimals,
    tickCurrentIndex: rpcPoolInfo.tickCurrent,
  };
}

// ── Build an OPEN-POSITION transaction (unsigned, for the browser to sign) ────
// openPositionFromBase takes a base side + amount and auto-derives liquidity. We size
// the OTHER side cap from the quote (otherAmountMax) using slippage. The position-NFT
// mint is an ephemeral signer the SDK generates; we partial-sign it (it controls no
// funds) and leave the fee-payer/authority signature to the owner's wallet.
async function buildOpenPosition({ owner, address, lowerTick, upperTick, inputMint, inputAmount, slippageBps }) {
  const ownerPk = new PublicKey(owner);
  const raydium = await loadSdk(ownerPk);
  const { poolInfo, poolKeys } = await fetchPoolBundle(raydium, address);
  const epochInfo = await raydium.fetchEpochInfo();

  const decA = poolInfo.mintA.decimals;
  const decB = poolInfo.mintB.decimals;
  const inputIsA = poolInfo.mintA.address === inputMint;
  const inputDecimals = inputIsA ? decA : decB;
  const slippage = clampSlippage(slippageBps);
  const tickLower = Math.min(Number(lowerTick), Number(upperTick));
  const tickUpper = Math.max(Number(lowerTick), Number(upperTick));

  const baseAmount = uiToBN(inputAmount, inputDecimals);
  const q = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    inputA: inputIsA,
    tickLower,
    tickUpper,
    amount: baseAmount,
    slippage,
    add: true,
    epochInfo,
    amountHasFee: true,
  });

  // The cap on the OTHER side (the non-base token) at the chosen slippage.
  const otherMax = inputIsA
    ? (q.amountSlippageB ? q.amountSlippageB.amount : q.amountB.amount)
    : (q.amountSlippageA ? q.amountSlippageA.amount : q.amountA.amount);

  const built = await raydium.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    tickLower,
    tickUpper,
    base: inputIsA ? "MintA" : "MintB",
    baseAmount,
    otherAmountMax: otherMax,
    ownerInfo: { useSOLBalance: true },
    withMetadata: "no-create",   // no metadata NFT — smaller tx, matches Orca's openPosition
    txVersion: TxVersion.LEGACY, // legacy Transaction, browser-deserializable
    computeBudgetConfig: { units: 600000, microLamports: 100000 },
  });

  const estA = inputIsA ? baseAmount : q.amountA.amount;
  const estB = inputIsA ? q.amountB.amount : baseAmount;
  const maxA = inputIsA ? baseAmount : otherMax;
  const maxB = inputIsA ? otherMax : baseAmount;

  const txs = [await serializeUnsigned(raydium, built, ownerPk)];
  const positionMint = (built.extInfo && built.extInfo.nftMint)
    ? built.extInfo.nftMint.toBase58()
    : null;

  return {
    txBase64: txs[0],   // single open tx (Raydium initializes tick arrays in the same tx)
    txs,                // ordered list, for interface parity with Orca
    positionMint,
    estA: bnToUi(estA, decA),
    estB: bnToUi(estB, decB),
    maxA: bnToUi(maxA, decA),
    maxB: bnToUi(maxB, decB),
  };
}

// ── Build a CLOSE-POSITION transaction set (withdraw all + collect fees + close) ──
// Raydium's closePosition wraps decrease-to-zero + fee collect + close in one builder.
// We look up the owner's on-chain position record by NFT mint, then build it unsigned.
async function buildClosePosition({ owner, positionMint, slippageBps }) {
  const ownerPk = new PublicKey(owner);
  const raydium = await loadSdk(ownerPk);

  const ownerPosition = await fetchOwnerPosition(raydium, positionMint);
  if (!ownerPosition) throw new Error(`No CLMM position found for NFT ${positionMint} owned by ${owner}`);
  const poolId = ownerPosition.poolId.toBase58();
  const { poolInfo, poolKeys } = await fetchPoolBundle(raydium, poolId);

  const built = await raydium.clmm.closePosition({
    poolInfo,
    poolKeys,
    ownerPosition,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: { units: 600000, microLamports: 100000 },
  });

  const txs = [await serializeUnsigned(raydium, built, ownerPk)];
  return { txs };
}

// Look up a single owner CLMM position by its NFT mint. getOwnerPositionInfo scans the
// owner's token accounts for position NFTs and decodes each personal-position account.
async function fetchOwnerPosition(raydium, positionMint, programId) {
  const all = await raydium.clmm.getOwnerPositionInfo({ programId });
  const want = positionMint.toString();
  return all.find((p) => p.nftMint.toBase58() === want) || null;
}

// Serialize a built SDK transaction into an unsigned, base64 legacy Transaction the
// browser wallet can deserialize. We partial-sign only the ephemeral signers the SDK
// generated (e.g. the position-NFT mint keypair) — they control no funds — and leave
// the fee-payer/authority signature to the owner's wallet. Mirrors Orca's serializeUnsigned.
async function serializeUnsigned(raydium, built, ownerPk) {
  const transaction = built.transaction; // legacy Transaction (txVersion: LEGACY)
  transaction.feePayer = ownerPk;
  const { blockhash } = await raydium.connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  const ephemeral = (built.signers || []).filter((s) => s && s.secretKey);
  if (ephemeral.length) transaction.partialSign(...ephemeral);
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

// ── List a wallet's open Raydium CLMM positions ──────────────────────────────
// getOwnerPositionInfo gives every CLMM personal-position the owner holds. We keep the
// ones whose pool belongs to the token (paired with a supported quote), then normalise
// each to the Orca listPositions item shape (clkn*/token* aliases, prices, amounts).
async function listPositions(owner, tok = DEFAULT_TOKEN) {
  const ownerPk = new PublicKey(owner);
  const raydium = await loadSdk(ownerPk);

  // Map of this token's pools so we only surface relevant positions, plus orientation.
  const pools = await discoverPools(tok);
  const poolMeta = new Map(pools.map((p) => [p.address, p]));

  let allPos = [];
  try {
    allPos = await raydium.clmm.getOwnerPositionInfo({});
  } catch {
    allPos = [];
  }

  const stateCache = new Map();
  const positions = [];
  for (const pos of allPos) {
    const poolAddr = pos.poolId.toBase58();
    if (!poolMeta.has(poolAddr)) continue;          // not one of this token's pools
    if (pos.liquidity.isZero()) continue;           // skip empty/closed positions

    let st = stateCache.get(poolAddr);
    if (!st) { st = await getPoolState(poolAddr, ownerPk, tok); stateCache.set(poolAddr, st); }

    const inRange = pos.tickLower <= st.tickCurrentIndex && st.tickCurrentIndex < pos.tickUpper;
    const lowP = tickToTokenPrice(pos.tickLower, st);
    const highP = tickToTokenPrice(pos.tickUpper, st);

    // Current token composition of the position from its liquidity + the live price.
    let tokenAmount = 0, quoteAmount = 0;
    try {
      const amts = liquidityToAmounts(pos.liquidity, new BN(st.sqrtPrice), pos.tickLower, pos.tickUpper);
      const aUi = Number(bnToUi(amts.amountA, st.decimalsA));
      const bUi = Number(bnToUi(amts.amountB, st.decimalsB));
      tokenAmount = st.clknIsA ? aUi : bUi;
      quoteAmount = st.clknIsA ? bUi : aUi;
    } catch { /* leave amounts at 0 if math fails */ }

    // On-chain fee-owed checkpoint (stale until the position is next touched, like Orca's
    // feeOwed*). A precise live quote would need the tick-array fee growth; we report the
    // checkpoint for parity and leave the live pending fields at the checkpoint value.
    const feeOwedA = bnToUi(pos.tokenFeesOwedA, st.decimalsA);
    const feeOwedB = bnToUi(pos.tokenFeesOwedB, st.decimalsB);
    const pendingFeeToken = Number(st.clknIsA ? feeOwedA : feeOwedB);
    const pendingFeeQuote = Number(st.clknIsA ? feeOwedB : feeOwedA);

    positions.push({
      venue: "raydium",
      positionMint: pos.nftMint.toBase58(),
      pool: poolAddr,
      pair: `${st.tokenSymbol || "TOKEN"}/${st.quoteSymbol}`,
      tokenSymbol: st.tokenSymbol,
      tokenMint: st.tokenMint,
      quoteSymbol: st.quoteSymbol,
      quoteMint: st.quoteMint,
      liquidity: pos.liquidity.toString(),
      tickLowerIndex: pos.tickLower,
      tickUpperIndex: pos.tickUpper,
      lowerPriceClkn: Math.min(lowP, highP),
      upperPriceClkn: Math.max(lowP, highP),
      currentPriceClkn: st.clknPriceInQuote,
      clknAmount: tokenAmount,
      tokenAmount,                     // generic alias
      quoteAmount,
      inRange,
      feeOwedA,
      feeOwedB,
      pendingFeeClkn: pendingFeeToken,
      pendingFeeToken,                 // generic alias
      pendingFeeQuote,
    });
  }
  return positions;
}

// ── Small math helpers (BN <-> UI decimal) ───────────────────────────────────
function clampSlippage(slippageBps) {
  return Math.max(0, Math.min(5000, Number(slippageBps) || 100)) / 10000; // fraction
}
function uiToBN(amountUi, decimals) {
  const d = new Decimal(String(amountUi)).mul(new Decimal(10).pow(decimals));
  return new BN(d.toFixed(0));
}
function bnToUi(bnVal, decimals) {
  const b = BN.isBN(bnVal) ? bnVal : new BN(String(bnVal));
  return new Decimal(b.toString()).div(new Decimal(10).pow(decimals)).toString();
}

// Token amounts a liquidity L holds at the current sqrtPrice for a [lower,upper] tick
// range. Standard concentrated-liquidity formula (X64 sqrt-price fixed point):
//   below range  → all token A;  above range → all token B;  in range → both.
const Q64 = new BN(1).shln(64);
function liquidityToAmounts(liquidity, sqrtPriceX64, tickLower, tickUpper) {
  const L = BN.isBN(liquidity) ? liquidity : new BN(String(liquidity));
  const sLow = sqrtPriceFromTick(tickLower);
  const sUp = sqrtPriceFromTick(tickUpper);
  let amountA = new BN(0), amountB = new BN(0);
  if (sqrtPriceX64.lte(sLow)) {
    amountA = amountAForLiquidity(sLow, sUp, L);
  } else if (sqrtPriceX64.lt(sUp)) {
    amountA = amountAForLiquidity(sqrtPriceX64, sUp, L);
    amountB = amountBForLiquidity(sLow, sqrtPriceX64, L);
  } else {
    amountB = amountBForLiquidity(sLow, sUp, L);
  }
  return { amountA, amountB };
}
// amountA = L * (sUp - sLow) / (sUp * sLow) * Q64
function amountAForLiquidity(sA, sB, L) {
  const [lo, hi] = sA.lt(sB) ? [sA, sB] : [sB, sA];
  if (lo.isZero()) return new BN(0);
  return L.mul(Q64).mul(hi.sub(lo)).div(hi).div(lo);
}
// amountB = L * (sUp - sLow) / Q64
function amountBForLiquidity(sA, sB, L) {
  const [lo, hi] = sA.lt(sB) ? [sA, sB] : [sB, sA];
  return L.mul(hi.sub(lo)).div(Q64);
}
// sqrt(1.0001^tick) in Q64.64 — the SDK's exact fixed-point implementation.
function sqrtPriceFromTick(tick) {
  return TickUtil.getSqrtPriceAtTick(tick);
}

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
