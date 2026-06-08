// ── Liquidity Engine: Orca Whirlpools adapter ────────────────────────────────
// The backend for Cluck Norris's market-maker / liquidity tool. It manages
// CONCENTRATED LIQUIDITY positions on Orca Whirlpools (CLKN/USDC and CLKN/SOL)
// so the project can put real depth into the book — tighter spreads, less
// slippage, and fees earned on every REAL swap that trades through the range.
//
// What this is NOT: it is not a wash-trading / self-trading "volume" bot. It
// never trades against itself to print a number. It provides genuine two-sided
// depth that fills *other people's* orders; the volume it produces is real
// because the counterparties are real. That's the whole point — and it keeps the
// tool consistent with the Autopsy engine, which exists to catch fake volume.
//
// Custody model: NON-CUSTODIAL, exactly like lib/securitycoop.js. The server
// only ever BUILDS unsigned transactions; the operator's own wallet signs and
// submits them in the browser. No private key for project funds ever touches
// the server. (Opening a position mints a position-NFT whose ephemeral mint
// keypair is generated and partial-signed server-side — that key controls no
// funds, only the NFT being created in the same tx — then the owner adds the
// fee-payer/authority signature in their wallet.)
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  PoolUtil,
  PDAUtil,
  TickArrayUtil,
  collectFeesQuote,
  ORCA_WHIRLPOOLS_CONFIG,
  IGNORE_CACHE,
  // NOTE: use the "PriceDeviation" quote, NOT the default increaseLiquidityQuoteByInputToken
  // ("PriceSlippage"). openPosition builds an increase_liquidity_V2 ix that requires
  // minSqrtPrice/maxSqrtPrice price-guard bounds — and only the PriceDeviation variant
  // populates them. The default leaves them undefined → on-chain error 0x17b5
  // (PriceSlippageOutOfBounds). Same token amounts either way; this just fills the bounds.
  increaseLiquidityQuoteByInputTokenUsingPriceDeviation: increaseLiquidityQuote,
  NO_TOKEN_EXTENSION_CONTEXT,
} = require("@orca-so/whirlpools-sdk");
const { Percentage, DecimalUtil } = require("@orca-so/common-sdk");
const Decimal = require("decimal.js");
const { BN } = require("@coral-xyz/anchor");

// ── Constants ────────────────────────────────────────────────────────────────
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const ORCA_API = "https://api.orca.so/v2/solana";

// The quote tokens we surface for the CLKN market maker. The user picked
// CLKN/USDC and CLKN/SOL; everything else (XPX/FCKN pairs) is hidden by default.
const QUOTE_TOKENS = {
  [USDC_MINT]: "USDC",
  [WSOL_MINT]: "SOL",
};

// ── Token context (multi-tenant) ─────────────────────────────────────────────
// Every position function works against a token context = { mint, symbol, quoteMints }.
// It DEFAULTS to CLKN, so every existing call is byte-for-byte unchanged. Multi-tenant
// callers pass their project's own context. NOTE: result objects keep the legacy
// `clkn*` field names (clknIsA / clknPriceInQuote / clknAmount / lowerPriceClkn …) as
// backward-compatible aliases for "the project token", and ALSO expose generic
// `token*` names — so existing consumers (vault, /liquidity) need no changes.
const DEFAULT_TOKEN = { mint: CLKN_MINT, symbol: "CLKN", quoteMints: [USDC_MINT, WSOL_MINT] };
function quoteSymbolFor(mint, fallback) {
  return QUOTE_TOKENS[mint] || fallback || (mint ? mint.slice(0, 4) + "…" : "?");
}

// A placeholder owner for read-only RPC (reads never sign). The system program
// address is fine as a stand-in pubkey.
const READONLY_OWNER = new PublicKey("11111111111111111111111111111111");

// Mainnet RPC — the project's Helius key with a public fallback (same pattern as
// securitycoop.js so a fresh cloud clone without the key still does reads).
function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}

// An Anchor-compatible wallet that holds only a public key and refuses to sign.
// The Whirlpool SDK reads ctx.wallet.publicKey to place the funder/authority in
// the instructions it builds; we never let it sign — the browser wallet does.
function readonlyWallet(pubkey) {
  return {
    publicKey: pubkey,
    signTransaction: async () => { throw new Error("read-only wallet cannot sign"); },
    signAllTransactions: async () => { throw new Error("read-only wallet cannot sign"); },
  };
}

function getCtx(ownerPubkey) {
  const connection = new Connection(rpcUrl(), "confirmed");
  const owner = ownerPubkey || READONLY_OWNER;
  // NOTE: WhirlpoolContext.from(connection, wallet, fetcher?, ...) — the third arg
  // is the account fetcher, NOT the program id (the Orca mainnet program id is the
  // built-in default). Passing only (connection, wallet) gets the default fetcher.
  return WhirlpoolContext.from(connection, readonlyWallet(owner));
}

async function orcaApi(path) {
  const r = await fetch(ORCA_API + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Orca API ${r.status}`);
  return r.json();
}

// ── Pool discovery ───────────────────────────────────────────────────────────
// Pull every Whirlpool that includes CLKN from Orca's API, keep the ones paired
// with a quote token we support (USDC/SOL), and normalise orientation so the
// caller always gets "CLKN price in the quote token" no matter which side of the
// pool CLKN sits on. (In CLKN/USDC, CLKN is tokenA; in SOL/CLKN it's tokenB —
// Orca's `price` field is always tokenB-per-tokenA, so we flip when needed.)
async function discoverPools(tok = DEFAULT_TOKEN) {
  const j = await orcaApi(`/pools?token=${tok.mint}`);
  const pools = Array.isArray(j.data) ? j.data : [];
  const allow = new Set((tok.quoteMints && tok.quoteMints.length) ? tok.quoteMints : Object.keys(QUOTE_TOKENS));
  const out = [];
  for (const p of pools) {
    const a = p.tokenA, b = p.tokenB;
    const tokenIsA = a.address === tok.mint;
    const quoteTok = tokenIsA ? b : a;
    if (!allow.has(quoteTok.address)) continue; // only the project's chosen quotes
    const quoteSymbol = quoteSymbolFor(quoteTok.address, quoteTok.symbol);

    const priceBPerA = Number(p.price); // tokenB per tokenA, straight from Orca
    // Token price expressed in the quote token. If the token is A, that's the raw
    // price (quote per token); if it's B, invert.
    const tokenPriceInQuote = tokenIsA ? priceBPerA : (priceBPerA > 0 ? 1 / priceBPerA : 0);

    out.push({
      address: p.address,
      config: p.whirlpoolsConfig,
      pair: `${tok.symbol}/${quoteSymbol}`,
      quoteSymbol,
      quoteMint: quoteTok.address,
      tokenMint: tok.mint,
      tokenSymbol: tok.symbol,
      tokenIsA,
      clknIsA: tokenIsA,                    // legacy alias
      feeRateBps: p.feeRate / 100,          // Orca feeRate is in hundredths of a bp
      feeTierPct: p.feeRate / 10000,        // e.g. 10000 -> 1.00%
      tickSpacing: p.tickSpacing,
      liquidity: p.liquidity,
      empty: p.liquidity === "0" || p.liquidity === 0,
      tokenPriceInQuote,
      clknPriceInQuote: tokenPriceInQuote,  // legacy alias
      decimalsA: a.decimals,
      decimalsB: b.decimals,
      symbolA: a.symbol,
      symbolB: b.symbol,
      hasWarning: !!p.hasWarning,
    });
  }
  // Stable, useful order: pair, then tightest fee first.
  out.sort((x, y) => x.pair.localeCompare(y.pair) || x.feeTierPct - y.feeTierPct);
  return out;
}

// ── Live pool state (on-chain, fresh) ────────────────────────────────────────
async function getPoolState(address, ownerPubkey, tok = DEFAULT_TOKEN) {
  const ctx = getCtx(ownerPubkey);
  const client = buildWhirlpoolClient(ctx);
  const pool = await client.getPool(new PublicKey(address));
  const data = pool.getData();
  const ta = pool.getTokenAInfo();
  const tb = pool.getTokenBInfo();
  const decA = ta.decimals, decB = tb.decimals;
  const tokenIsA = ta.mint.toBase58() === tok.mint;
  const quoteMint = (tokenIsA ? tb.mint : ta.mint).toBase58();
  const quoteSymbol = quoteSymbolFor(quoteMint);

  const priceBPerA = Number(PriceMath.sqrtPriceX64ToPrice(data.sqrtPrice, decA, decB).toString());
  const tokenPriceInQuote = tokenIsA ? priceBPerA : (priceBPerA > 0 ? 1 / priceBPerA : 0);

  return {
    address,
    tickSpacing: data.tickSpacing,
    tickCurrentIndex: data.tickCurrentIndex,
    sqrtPrice: data.sqrtPrice.toString(),
    liquidity: data.liquidity.toString(),
    empty: data.liquidity.isZero(),
    feeTierPct: data.feeRate / 10000,
    decimalsA: decA,
    decimalsB: decB,
    mintA: ta.mint.toBase58(),
    mintB: tb.mint.toBase58(),
    tokenMint: tok.mint,
    tokenSymbol: tok.symbol,
    tokenIsA,
    clknIsA: tokenIsA,                    // legacy alias
    quoteMint,
    quoteSymbol,
    priceBPerA,
    tokenPriceInQuote,
    clknPriceInQuote: tokenPriceInQuote,  // legacy alias
  };
}

// ── Range math (single-sided & balanced) ─────────────────────────────────────
// Concentrated-liquidity mechanics, in plain terms (price = tokenB per tokenA):
//   • A range entirely ABOVE the current price holds 100% tokenA — you deposit
//     only tokenA, and it's sold into tokenB as price rises through the range.
//   • A range entirely BELOW the current price holds 100% tokenB — you deposit
//     only tokenB, and it's bought back (into tokenA) as price falls.
//   • A range straddling the current price holds BOTH (a balanced position).
// So "single-sided CLKN" = a sell-wall of CLKN above price; "single-sided quote"
// = a buy-wall (bid support) below price. We compute initializable tick bounds
// for each, aligned to the pool's tick spacing.
function alignTick(priceBPerA, decA, decB, spacing) {
  return PriceMath.priceToInitializableTickIndex(new Decimal(priceBPerA), decA, decB, spacing);
}

// Convert a tick index to "CLKN price in quote", honouring orientation.
function tickToClknPrice(tick, st) {
  const bPerA = Number(PriceMath.tickIndexToPrice(tick, st.decimalsA, st.decimalsB).toString());
  return st.clknIsA ? bPerA : (bPerA > 0 ? 1 / bPerA : 0);
}

// Build the suggested ranges for a pool given a width (% around current price).
// Returns one option per deposit choice: deposit-CLKN-only, deposit-quote-only,
// and balanced (both). Each option carries the tick bounds the quote/open calls
// need, plus human CLKN-price bounds for display.
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
  const sym = st.tokenSymbol || "CLKN";
  const tokMint = st.tokenMint || CLKN_MINT;
  const clknOnly = st.clknIsA
    ? { lowerTick: aLower, upperTick: aUpper, depositMint: tokMint, depositSymbol: sym }
    : { lowerTick: bLower, upperTick: bUpper, depositMint: tokMint, depositSymbol: sym };
  const quoteOnly = st.clknIsA
    ? { lowerTick: bLower, upperTick: bUpper, depositMint: st.quoteMint, depositSymbol: st.quoteSymbol }
    : { lowerTick: aLower, upperTick: aUpper, depositMint: st.quoteMint, depositSymbol: st.quoteSymbol };
  const balanced = { lowerTick: lowerWide, upperTick: upperWide, depositMint: null, depositSymbol: sym + " + " + st.quoteSymbol };

  const decorate = (o, id, label) => {
    const p1 = tickToClknPrice(o.lowerTick, st);
    const p2 = tickToClknPrice(o.upperTick, st);
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
      decorate(clknOnly, "clkn", `Sell-side wall — deposit ${sym} only (asks above ${fmt(st.clknPriceInQuote)})`),
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
// liquidity it buys and how much of EACH token the position will actually use
// (a balanced range needs both tokens; a single-sided range needs only one).
async function quote({ address, owner, inputMint, inputAmount, lowerTick, upperTick, slippageBps }) {
  const ctx = getCtx(owner ? new PublicKey(owner) : null);
  const client = buildWhirlpoolClient(ctx);
  const pool = await client.getPool(new PublicKey(address));
  const data = pool.getData();
  const decA = pool.getTokenAInfo().decimals;
  const decB = pool.getTokenBInfo().decimals;
  const inputIsA = pool.getTokenAInfo().mint.toBase58() === inputMint;
  const inputDecimals = inputIsA ? decA : decB;

  const slippage = Percentage.fromFraction(Math.max(0, Math.min(5000, Number(slippageBps) || 100)), 10000);
  const q = increaseLiquidityQuote(
    new PublicKey(inputMint),
    new Decimal(inputAmount),
    Number(lowerTick),
    Number(upperTick),
    slippage,
    pool,
    NO_TOKEN_EXTENSION_CONTEXT,
  );

  return {
    liquidity: q.liquidityAmount.toString(),
    estA: DecimalUtil.fromBN(q.tokenEstA, decA).toString(),
    estB: DecimalUtil.fromBN(q.tokenEstB, decB).toString(),
    maxA: DecimalUtil.fromBN(q.tokenMaxA, decA).toString(),
    maxB: DecimalUtil.fromBN(q.tokenMaxB, decB).toString(),
    decimalsA: decA,
    decimalsB: decB,
    inputDecimals,
    tickCurrentIndex: data.tickCurrentIndex,
  };
}

// ── Build an OPEN-POSITION transaction (unsigned, for the browser to sign) ────
async function buildOpenPosition({ owner, address, lowerTick, upperTick, inputMint, inputAmount, slippageBps }) {
  const ownerPk = new PublicKey(owner);
  const ctx = getCtx(ownerPk);
  const client = buildWhirlpoolClient(ctx);
  const pool = await client.getPool(new PublicKey(address));
  const decA = pool.getTokenAInfo().decimals;
  const decB = pool.getTokenBInfo().decimals;

  const slippage = Percentage.fromFraction(Math.max(0, Math.min(5000, Number(slippageBps) || 100)), 10000);
  const liqInput = increaseLiquidityQuote(
    new PublicKey(inputMint),
    new Decimal(inputAmount),
    Number(lowerTick),
    Number(upperTick),
    slippage,
    pool,
    NO_TOKEN_EXTENSION_CONTEXT,
  );

  // A pristine pool (never traded) has no initialized tick arrays for our range,
  // and openPosition references those accounts — so on such a pool the add-liquidity
  // step fails with AccountOwnedByWrongProgram (0xbbf). initTickArrayForTicks returns
  // a builder that creates any missing arrays, or null if they already exist (so on a
  // traded pool like CLKN/USDC this is a no-op and nothing changes). It must land in
  // its OWN transaction BEFORE the open, so we return an ordered list of txs.
  const txs = [];
  const initBuilder = await pool.initTickArrayForTicks([Number(lowerTick), Number(upperTick)], ownerPk);
  if (initBuilder) txs.push(await serializeUnsigned(ctx, initBuilder, ownerPk));

  // openPosition (no metadata NFT — smaller tx) returns { positionMint, tx }.
  const { positionMint, tx } = await pool.openPosition(
    Number(lowerTick),
    Number(upperTick),
    liqInput,
    ownerPk,   // owner of the position
    ownerPk,   // funder / fee payer
  );

  const txBase64 = await serializeUnsigned(ctx, tx, ownerPk);
  txs.push(txBase64);
  return {
    txBase64,   // the open tx (kept for callers that don't need tick-array init)
    txs,        // ordered: [initTickArray?, open] — sign/submit in sequence
    positionMint: positionMint.toBase58(),
    estA: DecimalUtil.fromBN(liqInput.tokenEstA, decA).toString(),
    estB: DecimalUtil.fromBN(liqInput.tokenEstB, decB).toString(),
    maxA: DecimalUtil.fromBN(liqInput.tokenMaxA, decA).toString(),
    maxB: DecimalUtil.fromBN(liqInput.tokenMaxB, decB).toString(),
  };
}

// ── Create a new Whirlpool (pool bootstrap) ──────────────────────────────────
// Stands up a fresh concentrated-liquidity pool for a token at a chosen fee tier,
// initialized to the CURRENT MARKET PRICE (so the first liquidity isn't arbitraged
// away). Needed to onboard a token that has no Orca pool yet. Returns an unsigned tx
// + the new pool address; the operator (or browser wallet) signs. After this, the
// normal open-position flow adds depth. Orca's fee tier is set by tick spacing.
// Orca mainnet fee tiers (confirmed initializable). Note: tickSpacing 8's CURRENT
// default fee is 0.08% (older pools created under the legacy 0.05% config still read
// 0.05%). The PDA only depends on tickSpacing, so both map to ts 8.
const FEE_TIER_SPACING = { 0.01: 1, 0.02: 2, 0.05: 8, 0.08: 8, 0.3: 64, 0.65: 96, 1: 128 };

// Derive a Whirlpool's address from (config, token, quote, fee tier) WITHOUT the Orca
// API — so the engine finds brand-new pools instantly (the API lags pool creation).
// The address depends only on the canonical mint order + tickSpacing.
function poolAddressFor({ tokenMint, quoteMint, feeTierPct }) {
  const tickSpacing = FEE_TIER_SPACING[Number(feeTierPct)];
  if (!tickSpacing) throw new Error(`Unsupported fee tier ${feeTierPct}% — use one of: ${Object.keys(FEE_TIER_SPACING).join(", ")}`);
  const tokenIsA = PoolUtil.compareMints(new PublicKey(tokenMint), new PublicKey(quoteMint)) < 0;
  const mintA = tokenIsA ? tokenMint : quoteMint;
  const mintB = tokenIsA ? quoteMint : tokenMint;
  return PDAUtil.getWhirlpool(ORCA_WHIRLPOOL_PROGRAM_ID, ORCA_WHIRLPOOLS_CONFIG, new PublicKey(mintA), new PublicKey(mintB), tickSpacing).publicKey.toBase58();
}
async function getMintDecimals(conn, mint) {
  const r = await conn.getParsedAccountInfo(new PublicKey(mint));
  const d = r && r.value && r.value.data && r.value.data.parsed && r.value.data.parsed.info && r.value.data.parsed.info.decimals;
  if (d == null) throw new Error(`Could not read decimals for ${mint}`);
  return d;
}
async function buildCreatePool({ owner, tokenMint, quoteMint, feeTierPct, tokenPriceInQuote }) {
  const ownerPk = new PublicKey(owner);
  const ctx = getCtx(ownerPk);
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = FEE_TIER_SPACING[Number(feeTierPct)];
  if (!tickSpacing) throw new Error(`Unsupported fee tier ${feeTierPct}% — use one of: ${Object.keys(FEE_TIER_SPACING).join(", ")}`);
  if (!(Number(tokenPriceInQuote) > 0)) throw new Error("need a positive market price to initialize the pool");

  // Canonical token ordering (Orca requires tokenA < tokenB by mint bytes).
  const tokenIsA = PoolUtil.compareMints(new PublicKey(tokenMint), new PublicKey(quoteMint)) < 0;
  const mintA = tokenIsA ? tokenMint : quoteMint;
  const mintB = tokenIsA ? quoteMint : tokenMint;
  const decA = await getMintDecimals(ctx.connection, mintA);
  const decB = await getMintDecimals(ctx.connection, mintB);

  // Orca price = tokenB per tokenA. tokenPriceInQuote = quote per token.
  const priceBPerA = tokenIsA ? Number(tokenPriceInQuote) : (1 / Number(tokenPriceInQuote));
  const initialTick = PriceMath.priceToInitializableTickIndex(new Decimal(priceBPerA), decA, decB, tickSpacing);

  const { poolKey, tx } = await client.createPool(
    ORCA_WHIRLPOOLS_CONFIG, new PublicKey(mintA), new PublicKey(mintB), tickSpacing, initialTick, ownerPk,
  );
  const txBase64 = await serializeUnsigned(ctx, tx, ownerPk);
  return {
    poolAddress: poolKey.toBase58(), txBase64,
    feeTierPct: Number(feeTierPct), tickSpacing, initialTick,
    mintA, mintB, decimalsA: decA, decimalsB: decB,
    tokenIsA, priceBPerA, tokenPriceInQuote: Number(tokenPriceInQuote),
  };
}

// ── Build a CLOSE-POSITION transaction set (withdraw all + collect fees + close)
// closePosition can return more than one TransactionBuilder; we serialize each so
// the front-end signs them in order.
async function buildClosePosition({ owner, positionMint, slippageBps }) {
  const ownerPk = new PublicKey(owner);
  const ctx = getCtx(ownerPk);
  const client = buildWhirlpoolClient(ctx);
  const positionPda = PDAUtil.getPosition(ORCA_WHIRLPOOL_PROGRAM_ID, new PublicKey(positionMint)).publicKey;
  const position = await client.getPosition(positionPda, IGNORE_CACHE);
  const pool = await client.getPool(position.getData().whirlpool);

  const slippage = Percentage.fromFraction(Math.max(0, Math.min(5000, Number(slippageBps) || 100)), 10000);
  const builders = await pool.closePosition(positionPda, slippage, ownerPk, ownerPk, ownerPk);

  const txs = [];
  for (const b of builders) txs.push(await serializeUnsigned(ctx, b, ownerPk));
  return { txs };
}

// Build a TransactionBuilder into a legacy, unsigned, base64 transaction the
// browser wallet can deserialize with solanaWeb3.Transaction.from(...). We
// partial-sign only the ephemeral signers the SDK generated (e.g. the position
// NFT mint keypair) — they control no funds — and leave the fee-payer/authority
// signature to the owner's wallet.
async function serializeUnsigned(ctx, txBuilder, ownerPk) {
  const { transaction, signers } = await txBuilder.build({ maxSupportedTransactionVersion: "legacy" });
  // Legacy Transaction path (matches the front-end signer in securitycoop.js).
  transaction.feePayer = ownerPk;
  const { blockhash } = await ctx.connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  const ephemeral = (signers || []).filter((s) => s && s.secretKey);
  if (ephemeral.length) transaction.partialSign(...ephemeral);
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

// ── List a wallet's open CLKN Whirlpool positions ────────────────────────────
// Scans the owner's SPL token accounts for position NFTs (amount 1, decimals 0),
// derives each position PDA, and keeps the ones that belong to a CLKN pool. Best
// effort: anything that doesn't decode as a position is skipped silently.
// Short cache so the vault's per-tick routines (rebalance, ask-wall, base, SOL, buyback)
// share ONE on-chain read instead of each re-fetching — and it dedupes the pool +
// tick-array fetches done inside. TTL covers a single tick's run; invalidatePositions()
// busts it the instant a position is opened/closed, so no routine acts on stale state.
// Deliberately NOT served stale on error — callers should fail/defer, never act on a guess.
const _posCache = new Map(); // `${owner}:${tokenMint}` → { ts, data }
const POS_CACHE_TTL = 30000;
function invalidatePositions(owner) {
  const pre = `${owner}:`;
  for (const k of [..._posCache.keys()]) if (k.startsWith(pre)) _posCache.delete(k);
}
async function listPositions(owner, tok = DEFAULT_TOKEN) {
  const cacheKey = `${owner}:${(tok && (tok.mint || tok.address)) || "default"}`;
  const hit = _posCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < POS_CACHE_TTL) return hit.data;
  const ownerPk = new PublicKey(owner);
  const ctx = getCtx(ownerPk);
  const client = buildWhirlpoolClient(ctx);

  const clknPools = new Set((await discoverPools(tok)).map((p) => p.address));
  const resp = await ctx.connection.getParsedTokenAccountsByOwner(ownerPk, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const poolStateCache = new Map();
  const positions = [];
  for (const { account } of resp.value) {
    const info = account.data?.parsed?.info;
    const amt = info?.tokenAmount;
    if (!info || !amt || amt.decimals !== 0 || amt.amount !== "1") continue; // NFT-shaped only
    let posData;
    try {
      const pda = PDAUtil.getPosition(ORCA_WHIRLPOOL_PROGRAM_ID, new PublicKey(info.mint)).publicKey;
      const pos = await client.getPosition(pda, IGNORE_CACHE);
      posData = pos.getData();
    } catch {
      continue; // not an Orca position NFT
    }
    const poolAddr = posData.whirlpool.toBase58();
    if (!clknPools.has(poolAddr)) continue;

    let st = poolStateCache.get(poolAddr);
    if (!st) { st = await getPoolState(poolAddr, ownerPk, tok); poolStateCache.set(poolAddr, st); }

    // Real-time UNCOLLECTED fees this position has earned. posData.feeOwed* is only
    // the on-chain checkpoint (stale until the position is next touched — a fresh
    // position reads ~0 while still earning), so we compute the up-to-date amount
    // with collectFeesQuote (whirlpool data + the position's lower/upper tick data).
    let pendingFeeClkn = 0, pendingFeeQuote = 0;
    try {
      const wpPk = new PublicKey(poolAddr);
      let wpData = poolStateCache.get(`wp:${poolAddr}`);
      if (!wpData) { wpData = (await client.getPool(wpPk)).getData(); poolStateCache.set(`wp:${poolAddr}`, wpData); }
      const ts = wpData.tickSpacing;
      const loArrPda = PDAUtil.getTickArrayFromTickIndex(posData.tickLowerIndex, ts, wpPk, ORCA_WHIRLPOOL_PROGRAM_ID).publicKey;
      const hiArrPda = PDAUtil.getTickArrayFromTickIndex(posData.tickUpperIndex, ts, wpPk, ORCA_WHIRLPOOL_PROGRAM_ID).publicKey;
      const loArr = await ctx.fetcher.getTickArray(loArrPda, IGNORE_CACHE);
      const hiArr = await ctx.fetcher.getTickArray(hiArrPda, IGNORE_CACHE);
      const tickLower = TickArrayUtil.getTickFromArray(loArr, posData.tickLowerIndex, ts);
      const tickUpper = TickArrayUtil.getTickFromArray(hiArr, posData.tickUpperIndex, ts);
      const fq = collectFeesQuote({ whirlpool: wpData, position: posData, tickLower, tickUpper, tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT });
      const fa = Number(DecimalUtil.fromBN(fq.feeOwedA, st.decimalsA).toString());
      const fb = Number(DecimalUtil.fromBN(fq.feeOwedB, st.decimalsB).toString());
      pendingFeeClkn = st.clknIsA ? fa : fb;
      pendingFeeQuote = st.clknIsA ? fb : fa;
    } catch { /* leave pending fees at 0 if the quote math fails */ }

    const inRange = posData.tickLowerIndex <= st.tickCurrentIndex && st.tickCurrentIndex < posData.tickUpperIndex;
    const lowP = tickToClknPrice(posData.tickLowerIndex, st);
    const highP = tickToClknPrice(posData.tickUpperIndex, st);

    // Current token composition of the position (so we can show $ + token amounts).
    let clknAmount = 0, quoteAmount = 0;
    try {
      const curSqrt = new BN(st.sqrtPrice);
      const loSqrt = PriceMath.tickIndexToSqrtPriceX64(posData.tickLowerIndex);
      const hiSqrt = PriceMath.tickIndexToSqrtPriceX64(posData.tickUpperIndex);
      const amts = PoolUtil.getTokenAmountsFromLiquidity(posData.liquidity, curSqrt, loSqrt, hiSqrt, false);
      const aUi = Number(DecimalUtil.fromBN(amts.tokenA, st.decimalsA).toString());
      const bUi = Number(DecimalUtil.fromBN(amts.tokenB, st.decimalsB).toString());
      clknAmount = st.clknIsA ? aUi : bUi;
      quoteAmount = st.clknIsA ? bUi : aUi;
    } catch { /* leave amounts at 0 if math fails */ }

    positions.push({
      positionMint: info.mint,
      pool: poolAddr,
      pair: `${st.tokenSymbol || "CLKN"}/${st.quoteSymbol}`,
      tokenSymbol: st.tokenSymbol,
      tokenMint: st.tokenMint,
      quoteSymbol: st.quoteSymbol,
      quoteMint: st.quoteMint,
      liquidity: posData.liquidity.toString(),
      tickLowerIndex: posData.tickLowerIndex,
      tickUpperIndex: posData.tickUpperIndex,
      lowerPriceClkn: Math.min(lowP, highP),
      upperPriceClkn: Math.max(lowP, highP),
      currentPriceClkn: st.clknPriceInQuote,
      clknAmount,
      tokenAmount: clknAmount,         // generic alias
      quoteAmount,
      inRange,
      feeOwedA: DecimalUtil.fromBN(posData.feeOwedA, st.decimalsA).toString(),
      feeOwedB: DecimalUtil.fromBN(posData.feeOwedB, st.decimalsB).toString(),
      pendingFeeClkn,
      pendingFeeToken: pendingFeeClkn, // generic alias
      pendingFeeQuote,
    });
  }
  _posCache.set(cacheKey, { ts: Date.now(), data: positions });
  return positions;
}

module.exports = {
  CLKN_MINT, USDC_MINT, WSOL_MINT,
  DEFAULT_TOKEN,
  discoverPools,
  getPoolState,
  suggestRanges,
  quote,
  buildOpenPosition,
  buildClosePosition,
  buildCreatePool,
  poolAddressFor,
  FEE_TIER_SPACING,
  listPositions,
  invalidatePositions,
};
