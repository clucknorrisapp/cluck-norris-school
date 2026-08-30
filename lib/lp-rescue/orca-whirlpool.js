// LP Rescue — Orca Whirlpools adapter (read-only wallet scan).
//
// Finds EVERY Whirlpool position a wallet owns, across all pools: position
// NFTs (legacy Token AND Token-2022) → position PDA → on-chain position +
// pool state → live token amounts from liquidity math. Unlike the engine's
// lib/orca-whirlpools.listPositions (which is deliberately scoped to one
// project token), this scan is unscoped — "I forgot where my LP is" is the
// whole use case. Orca's frontend is generally healthy, so v1 is detect +
// diagnose; withdrawal links out to Orca itself.
const {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  PoolUtil,
  PDAUtil,
  TickArrayUtil,
  collectFeesQuote,
  IGNORE_CACHE,
  NO_TOKEN_EXTENSION_CONTEXT,
} = require("@orca-so/whirlpools-sdk");
const { DecimalUtil } = require("@orca-so/common-sdk");
const { PublicKey } = require("@solana/web3.js");
const rpc = require("../rpc");

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

function readonlyCtx(ownerPk) {
  const conn = rpc.connection("confirmed");
  const wallet = {
    publicKey: ownerPk,
    signTransaction: async () => { throw new Error("read-only"); },
    signAllTransactions: async () => { throw new Error("read-only"); },
  };
  // NOTE: .from(connection, wallet, fetcher?) — the 3rd arg is the account
  // FETCHER, not the program id (mainnet program id is the default). Passing
  // the program id there silently breaks every ctx.fetcher call.
  return WhirlpoolContext.from(conn, wallet);
}

function uiFromBN(bn, decimals) {
  try { return DecimalUtil.fromBN(bn, decimals).toString(); } catch { return "0"; }
}

// Wallet-wide scan. Returns RescuePosition-shaped entries (protocol "orca-whirlpool").
async function scanWalletOrca(ownerAddress) {
  const ownerPk = new PublicKey(ownerAddress);
  const ctx = readonlyCtx(ownerPk);
  const client = buildWhirlpoolClient(ctx);

  const [legacy, t22] = await Promise.all([
    ctx.connection.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM }),
    ctx.connection.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM }).catch(() => ({ value: [] })),
  ]);
  const nftMints = [];
  for (const { account } of [...legacy.value, ...t22.value]) {
    const info = account.data?.parsed?.info;
    const amt = info?.tokenAmount;
    if (info && amt && amt.decimals === 0 && amt.amount === "1") nftMints.push(info.mint);
  }

  const positions = [];
  const poolCache = new Map();
  for (const mint of nftMints) {
    let pda, pos, data;
    try {
      pda = PDAUtil.getPosition(ORCA_WHIRLPOOL_PROGRAM_ID, new PublicKey(mint)).publicKey;
      pos = await client.getPosition(pda, IGNORE_CACHE);
      data = pos.getData();
    } catch { continue; } // NFT is not an Orca position — expected for most NFTs
    const poolAddr = data.whirlpool.toBase58();
    let pool = poolCache.get(poolAddr);
    if (!pool) {
      try {
        const wp = await client.getPool(data.whirlpool, IGNORE_CACHE);
        const wd = wp.getData();
        const ta = wp.getTokenAInfo(), tb = wp.getTokenBInfo();
        pool = { wd, mintA: ta.mint.toBase58(), mintB: tb.mint.toBase58(), decA: ta.decimals, decB: tb.decimals };
        poolCache.set(poolAddr, pool);
      } catch { continue; }
    }
    // Live token amounts from liquidity + current/boundary sqrt prices.
    let amtA = "0", amtB = "0";
    try {
      const amounts = PoolUtil.getTokenAmountsFromLiquidity(
        data.liquidity,
        pool.wd.sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(data.tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(data.tickUpperIndex),
        false
      );
      amtA = amounts.tokenA.toString(); amtB = amounts.tokenB.toString();
    } catch {}
    // Up-to-date uncollected fees (feeOwed on the account is a stale checkpoint).
    let feeA = data.feeOwedA?.toString?.() ?? "0", feeB = data.feeOwedB?.toString?.() ?? "0";
    try {
      const ts = pool.wd.tickSpacing;
      const wpPk = data.whirlpool;
      const loPda = PDAUtil.getTickArrayFromTickIndex(data.tickLowerIndex, ts, wpPk, ORCA_WHIRLPOOL_PROGRAM_ID).publicKey;
      const hiPda = PDAUtil.getTickArrayFromTickIndex(data.tickUpperIndex, ts, wpPk, ORCA_WHIRLPOOL_PROGRAM_ID).publicKey;
      const [loArr, hiArr] = await Promise.all([
        ctx.fetcher.getTickArray(loPda, IGNORE_CACHE),
        ctx.fetcher.getTickArray(hiPda, IGNORE_CACHE),
      ]);
      const tickLower = TickArrayUtil.getTickFromArray(loArr, data.tickLowerIndex, ts);
      const tickUpper = TickArrayUtil.getTickFromArray(hiArr, data.tickUpperIndex, ts);
      const fq = collectFeesQuote({ whirlpool: pool.wd, position: data, tickLower, tickUpper, tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT });
      feeA = fq.feeOwedA.toString(); feeB = fq.feeOwedB.toString();
    } catch {}

    const hasLiquidity = amtA !== "0" || amtB !== "0" || String(data.liquidity) !== "0";
    const hasClaims = feeA !== "0" || feeB !== "0";
    const activeTick = pool.wd.tickCurrentIndex;
    const diagnostics = [
      "Position NFT found in the wallet",
      "Orca Whirlpool program recognizes the position",
      "Pool and balances read directly from the chain",
      hasLiquidity ? "Liquidity remains in the position" : "Position holds no liquidity",
    ];
    if (hasClaims) diagnostics.push("Uncollected fees remain");
    diagnostics.push("Manage or withdraw at orca.so — the position shows normally in Orca's app (LP Rescue's in-app withdrawal currently covers Meteora DLMM)");

    positions.push({
      protocol: "orca-whirlpool",
      poolAddress: poolAddr,
      positionAddress: pda.toBase58(),
      positionNftMint: mint,
      ownerAddress: ownerPk.toBase58(),
      tokenX: { mint: pool.mintA, decimals: pool.decA, rawAmount: amtA, uiAmount: uiFromBN(amounts_bn(amtA), pool.decA) },
      tokenY: { mint: pool.mintB, decimals: pool.decB, rawAmount: amtB, uiAmount: uiFromBN(amounts_bn(amtB), pool.decB) },
      lowerBinId: data.tickLowerIndex, upperBinId: data.tickUpperIndex,
      activeBinId: activeTick,
      inRange: data.tickLowerIndex <= activeTick && activeTick < data.tickUpperIndex,
      feeX: feeA, feeY: feeB,
      feeXUi: uiFromBN(amounts_bn(feeA), pool.decA), feeYUi: uiFromBN(amounts_bn(feeB), pool.decB),
      rewards: [],
      lockReleasePoint: 0,
      status: hasLiquidity || hasClaims ? "RECOVERABLE" : "EMPTY",
      withdrawable: false,               // v1: detect + diagnose; withdraw via Orca's frontend
      canClose: false,
      manageUrl: "https://www.orca.so/portfolio",
      diagnostics,
    });
  }
  return positions;
}

// BN-ish from decimal string (amounts already stringified base units).
function amounts_bn(s) {
  const { BN } = require("@coral-xyz/anchor");
  try { return new BN(String(s)); } catch { return new BN(0); }
}

// Pool-mode: a pasted address that turned out to be an Orca Whirlpool.
// Returns pool facts (+ this wallet's positions in it, when a wallet is given).
async function scanPoolOrca(poolAddress, ownerAddress) {
  const ownerPkForCtx = new PublicKey(ownerAddress || "11111111111111111111111111111111");
  const ctx = readonlyCtx(ownerPkForCtx);
  const client = buildWhirlpoolClient(ctx);
  const wp = await client.getPool(new PublicKey(poolAddress), IGNORE_CACHE);
  const wd = wp.getData();
  const ta = wp.getTokenAInfo(), tb = wp.getTokenBInfo();
  const pool = {
    poolAddress: String(poolAddress),
    tokenX: ta.mint.toBase58(), tokenY: tb.mint.toBase58(),
    tokenXDecimals: ta.decimals, tokenYDecimals: tb.decimals,
    activeBinId: wd.tickCurrentIndex, binStep: wd.tickSpacing,
    programOwner: ORCA_WHIRLPOOL_PROGRAM_ID.toBase58(),
  };
  let positions = [];
  if (ownerAddress) {
    positions = (await scanWalletOrca(ownerAddress)).filter((p) => p.poolAddress === String(poolAddress));
  }
  return {
    success: true, poolFound: true, protocol: "orca-whirlpool",
    poolProtocolName: "ORCA WHIRLPOOLS",
    indexerVisibility: "indexed",   // Orca's app lists whirlpools normally
    pool, positions,
  };
}

module.exports = { scanWalletOrca, scanPoolOrca };
