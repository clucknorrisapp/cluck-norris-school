// LP Rescue — Meteora DLMM adapter (read + withdrawal builder).
//
// The blockchain is the source of truth: nothing here depends on Meteora's
// website or indexer to decide whether liquidity exists. The indexer is probed
// only as SUPPLEMENTAL context (to tell the user "your position is real but
// Meteora's frontend can't see it" — the product's whole reason to exist).
//
// Non-custodial by construction: this module only ever handles PUBLIC keys and
// returns UNSIGNED transactions. No secret material exists anywhere in the flow.
//
// ⚠ SDK interop: require("@meteora-ag/dlmm") returns the DLMM class ITSELF
// (the package ships a CJS shim that replaces module.exports with the default
// export). `.default` is undefined — do not "fix" this back.
const DLMM = require("@meteora-ag/dlmm");
const BN = require("bn.js");
const { PublicKey } = require("@solana/web3.js");
const rpc = require("../rpc");

const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const METEORA_INDEXER = "https://dlmm-api.meteora.ag";

// Typed failure so the API layer can distinguish "scan failed" from "nothing found".
class RescueError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function conn() { return rpc.connection("confirmed"); }

// ---- helpers ---------------------------------------------------------------

function pk(s, what) {
  try { return new PublicKey(String(s).trim()); }
  catch { throw new RescueError("BAD_ADDRESS", `${what || "address"} is not a valid Solana address`); }
}

// Raw base-unit string → ui string, without float precision loss.
function uiAmount(raw, decimals) {
  const s = String(raw ?? "0").split(".")[0].replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(s)) return "0";
  const d = Number(decimals) || 0;
  if (d === 0) return s; // .slice(-0) is .slice(0): the whole number would become the "fraction"
  const whole = s.length > d ? s.slice(0, s.length - d) : "0";
  const frac = s.padStart(d + 1, "0").slice(-d).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function tokenDecimals(t) {
  return t?.mint?.decimals ?? t?.decimal ?? t?.decimals ?? 0;
}

// Supplemental only (spec §35/§36): does Meteora's own indexer know this pool?
async function meteoraIndexerSeesPool(poolAddress) {
  try {
    const res = await fetch(`${METEORA_INDEXER}/pair/${poolAddress}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return "indexed";
    if (res.status === 404) return "missing";
    return "unknown";
  } catch { return "unknown"; }
}

// ---- pool inspection -------------------------------------------------------

async function inspectPool(poolAddress) {
  const connection = conn();
  const key = pk(poolAddress, "pool address");
  let raw;
  try { raw = await connection.getAccountInfo(key); }
  catch (e) { throw new RescueError("RPC_SCAN_FAILED", "could not read the pool account: " + (e.message || e)); }
  if (!raw) return { found: false, error: "POOL_ACCOUNT_NOT_FOUND" };

  let pool;
  try { pool = await DLMM.create(connection, key); }
  catch (e) {
    return {
      found: true, recognizedAsDlmm: false,
      rawOwnerProgram: raw.owner.toBase58(),
      error: e && e.message ? e.message : String(e),
    };
  }
  const activeBin = await pool.getActiveBin();
  return {
    found: true, recognizedAsDlmm: true, pool,
    poolAddress: key.toBase58(),
    rawOwnerProgram: raw.owner.toBase58(),
    tokenX: pool.tokenX.publicKey.toBase58(),
    tokenY: pool.tokenY.publicKey.toBase58(),
    tokenXDecimals: tokenDecimals(pool.tokenX),
    tokenYDecimals: tokenDecimals(pool.tokenY),
    activeBinId: activeBin.binId,
    activeBinPrice: activeBin.price,
    binStep: pool.lbPair.binStep,
    pairStatus: pool.lbPair.status,
  };
}

// ---- position → RescuePosition --------------------------------------------

function shapePosition(poolInfo, p, { requestedOwner, indexerVisibility, lockReleasePoint } = {}) {
  const d = p.positionData;
  const ownerStr = d.owner?.toBase58?.() ?? String(d.owner);
  const xDec = poolInfo.tokenXDecimals, yDec = poolInfo.tokenYDecimals;
  const rawX = String(d.totalXAmount ?? "0").split(".")[0];
  const rawY = String(d.totalYAmount ?? "0").split(".")[0];
  const feeX = d.feeX?.toString?.() ?? "0";
  const feeY = d.feeY?.toString?.() ?? "0";
  const rewardOne = d.rewardOne?.toString?.() ?? "0";
  const rewardTwo = d.rewardTwo?.toString?.() ?? "0";

  const hasLiquidity = rawX !== "0" || rawY !== "0";
  const hasClaims = feeX !== "0" || feeY !== "0" || rewardOne !== "0" || rewardTwo !== "0";

  const diagnostics = [];
  diagnostics.push("Pool exists on-chain");
  diagnostics.push("Meteora DLMM program recognizes the pool");
  diagnostics.push("Position account exists and is linked to this pool");

  let status;
  const nowSec = Math.floor(Date.now() / 1000);
  const lock = Number(lockReleasePoint || 0);
  const locked = lock > 0 && lock > nowSec;

  if (requestedOwner && ownerStr !== requestedOwner) {
    status = "WRONG_WALLET";
    diagnostics.push(`Position is owned by a DIFFERENT wallet: ${ownerStr}`);
  } else if (locked) {
    status = "LOCKED";
    diagnostics.push(`Position is locked until release point ${lock} — withdrawal is not currently possible`);
  } else if (!hasLiquidity && !hasClaims) {
    status = "EMPTY";
    diagnostics.push("Position holds no liquidity and no claimable fees or rewards");
  } else if (indexerVisibility === "missing") {
    status = "FRONTEND_ISSUE";
    diagnostics.push("This pool isn't currently listed in the app's index, so it may not appear in the website interface right now — this can happen on any DEX with newer or less-common pools");
    diagnostics.push("Your liquidity is safe on-chain and can be withdrawn directly from here");
  } else {
    status = "RECOVERABLE";
    if (indexerVisibility === "indexed") diagnostics.push("Pool is visible in the app's index");
    else diagnostics.push("App-index visibility could not be confirmed (supplemental check unavailable)");
  }
  if (requestedOwner && ownerStr === requestedOwner) diagnostics.push("Owner verified on-chain");
  if (hasLiquidity) diagnostics.push("Liquidity remains in the position");
  if (hasClaims) diagnostics.push("Unclaimed fees/rewards remain");

  const withdrawable = (status === "RECOVERABLE" || status === "FRONTEND_ISSUE") && (hasLiquidity || hasClaims);
  return {
    protocol: "meteora-dlmm",
    poolAddress: poolInfo.poolAddress,
    positionAddress: p.publicKey.toBase58(),
    ownerAddress: ownerStr,
    version: String(p.version ?? ""),
    tokenX: { mint: poolInfo.tokenX, decimals: xDec, rawAmount: rawX, uiAmount: uiAmount(rawX, xDec) },
    tokenY: { mint: poolInfo.tokenY, decimals: yDec, rawAmount: rawY, uiAmount: uiAmount(rawY, yDec) },
    lowerBinId: d.lowerBinId, upperBinId: d.upperBinId,
    activeBinId: poolInfo.activeBinId,
    inRange: d.lowerBinId <= poolInfo.activeBinId && poolInfo.activeBinId <= d.upperBinId,
    feeX, feeY,
    feeXUi: uiAmount(feeX, xDec), feeYUi: uiAmount(feeY, yDec),
    rewards: [{ amount: rewardOne }, { amount: rewardTwo }].filter(r => r.amount !== "0"),
    lockReleasePoint: lock || 0,
    status, withdrawable,
    canClose: withdrawable,
    diagnostics,
  };
}

// Best-effort lock lookup: map positionAddress → lockReleasePoint (seconds/point units).
async function lockMap(pool) {
  try {
    const info = await pool.getLbPairLockInfo();
    const m = {};
    for (const p of info?.positions || []) m[p.positionAddress?.toBase58?.() ?? String(p.positionAddress)] = p.lockReleasePoint;
    return m;
  } catch { return {}; }
}

// ---- search modes ----------------------------------------------------------

// MODE A — pool + owner. MODE D — pool + position. Pool-only returns pool facts.
async function scanPool({ poolAddress, ownerAddress, positionAddress }) {
  const info = await inspectPool(poolAddress);
  if (!info.found) return { success: true, poolFound: false, positions: [], note: "No account exists at the pool address" };
  if (!info.recognizedAsDlmm) {
    return {
      success: true, poolFound: true, recognizedAsDlmm: false, positions: [],
      rawOwnerProgram: info.rawOwnerProgram,
      note: "Account exists but is not a Meteora DLMM pool (owner program: " + info.rawOwnerProgram + ")",
    };
  }
  const indexerVisibility = await meteoraIndexerSeesPool(info.poolAddress);
  const locks = await lockMap(info.pool);
  const positions = [];

  if (positionAddress) {
    const posKey = pk(positionAddress, "position address");
    let p;
    try { p = await info.pool.getPosition(posKey); }
    catch (e) {
      return {
        success: true, poolFound: true, recognizedAsDlmm: true, indexerVisibility,
        pool: publicPoolFacts(info), positions: [],
        note: "No DLMM position was found at that address in this pool (" + (e.message || e) + ")",
      };
    }
    positions.push(shapePosition(info, p, {
      requestedOwner: ownerAddress ? pk(ownerAddress, "owner address").toBase58() : undefined,
      indexerVisibility,
      lockReleasePoint: locks[posKey.toBase58()],
    }));
  } else if (ownerAddress) {
    const owner = pk(ownerAddress, "owner address");
    let res;
    try { res = await info.pool.getPositionsByUserAndLbPair(owner); }
    catch (e) { throw new RescueError("RPC_SCAN_FAILED", "position scan failed: " + (e.message || e)); }
    for (const p of res.userPositions || []) {
      positions.push(shapePosition(info, p, {
        requestedOwner: owner.toBase58(), indexerVisibility,
        lockReleasePoint: locks[p.publicKey.toBase58()],
      }));
    }
  }
  return { success: true, poolFound: true, recognizedAsDlmm: true, indexerVisibility, pool: publicPoolFacts(info), positions };
}

function publicPoolFacts(info) {
  return {
    poolAddress: info.poolAddress, tokenX: info.tokenX, tokenY: info.tokenY,
    tokenXDecimals: info.tokenXDecimals, tokenYDecimals: info.tokenYDecimals,
    activeBinId: info.activeBinId, activeBinPrice: info.activeBinPrice,
    binStep: info.binStep, pairStatus: info.pairStatus,
    programOwner: info.rawOwnerProgram,
  };
}

// Position-only mode: derive the pool from the position account's own bytes
// (offset 8..40 is the lbPair pubkey — verified against the real fixture),
// after confirming the account is owned by the DLMM program. Never assume an
// address is a position from its shape alone.
async function derivePoolFromPosition(positionAddress) {
  const connection = conn();
  const key = pk(positionAddress, "position address");
  let raw;
  try { raw = await connection.getAccountInfo(key); }
  catch (e) { throw new RescueError("RPC_SCAN_FAILED", "could not read the position account: " + (e.message || e)); }
  if (!raw) return { found: false };
  if (raw.owner.toBase58() !== DLMM_PROGRAM_ID) {
    return { found: true, isDlmmPosition: false, ownerProgram: raw.owner.toBase58() };
  }
  return { found: true, isDlmmPosition: true, poolAddress: new PublicKey(raw.data.slice(8, 40)).toBase58() };
}

// MODE B — wallet only, across all DLMM pools. RPC-heavy; failures are typed,
// never silently returned as "no positions".
async function scanWallet({ ownerAddress }) {
  const connection = conn();
  const owner = pk(ownerAddress, "owner address");
  let map;
  try { map = await DLMM.getAllLbPairPositionsByUser(connection, owner); }
  catch (e) { throw new RescueError("RPC_SCAN_FAILED", "wallet-wide scan failed: " + (e.message || e)); }
  const out = [];
  for (const [poolAddr, poolInfo] of map) {
    const facts = {
      poolAddress: poolAddr,
      tokenX: poolInfo.tokenX.publicKey.toBase58(),
      tokenY: poolInfo.tokenY.publicKey.toBase58(),
      tokenXDecimals: tokenDecimals(poolInfo.tokenX),
      tokenYDecimals: tokenDecimals(poolInfo.tokenY),
      activeBinId: poolInfo.lbPair?.activeId,
    };
    for (const p of poolInfo.lbPairPositionsData || []) {
      out.push(shapePosition(facts, p, { requestedOwner: owner.toBase58(), indexerVisibility: "unknown" }));
    }
  }
  return { success: true, positions: out };
}

// MODE C — wallet + token mint.
async function scanWalletToken({ ownerAddress, tokenMint }) {
  const connection = conn();
  const owner = pk(ownerAddress, "owner address");
  const mint = pk(tokenMint, "token mint");
  let map;
  try { map = await DLMM.getPositionsByUserAndTokenAddress(connection, owner, mint); }
  catch (e) { throw new RescueError("RPC_SCAN_FAILED", "wallet+token scan failed: " + (e.message || e)); }
  const out = [];
  for (const [poolAddr, poolInfo] of map) {
    const facts = {
      poolAddress: poolAddr,
      tokenX: poolInfo.tokenX.publicKey.toBase58(),
      tokenY: poolInfo.tokenY.publicKey.toBase58(),
      tokenXDecimals: tokenDecimals(poolInfo.tokenX),
      tokenYDecimals: tokenDecimals(poolInfo.tokenY),
      activeBinId: poolInfo.lbPair?.activeId,
    };
    for (const p of poolInfo.lbPairPositionsData || []) {
      out.push(shapePosition(facts, p, { requestedOwner: owner.toBase58(), indexerVisibility: "unknown" }));
    }
  }
  return { success: true, positions: out };
}

// ---- dispatcher ------------------------------------------------------------

async function scanRescue({ pool, owner, mint, position }) {
  if (position && !pool) {
    const derived = await derivePoolFromPosition(position);
    if (!derived.found) return { success: true, mode: "position", positions: [], note: "No account exists at the position address" };
    if (!derived.isDlmmPosition) {
      return {
        success: true, mode: "position", positions: [],
        note: "Account exists but is not a Meteora DLMM position (owner program: " + derived.ownerProgram + ")",
      };
    }
    pool = derived.poolAddress;
  }
  if (pool) return { mode: position ? "position" : owner ? "pool+wallet" : "pool", ...(await scanPool({ poolAddress: pool, ownerAddress: owner, positionAddress: position })) };
  if (owner && mint) return { mode: "wallet+token", ...(await scanWalletToken({ ownerAddress: owner, tokenMint: mint })) };
  if (owner) return { mode: "wallet", ...(await scanWallet({ ownerAddress: owner })) };
  throw new RescueError("BAD_REQUEST", "provide at least a pool, wallet, position, or wallet+token to scan");
}

// ---- withdrawal builder (Phase 3 — returns UNSIGNED transactions) ----------

// 100% remove + claim fees + close. Re-verifies ownership against live chain
// state immediately before building; refuses locked positions.
async function buildFullWithdrawal({ pool, position, owner }) {
  const connection = conn();
  const poolKey = pk(pool, "pool address");
  const posKey = pk(position, "position address");
  const ownerKey = pk(owner, "owner address");

  const dlmm = await DLMM.create(connection, poolKey);
  await dlmm.refetchStates();
  const pos = await dlmm.getPosition(posKey);
  const d = pos.positionData;
  const onChainOwner = d.owner?.toBase58?.() ?? String(d.owner);
  if (onChainOwner !== ownerKey.toBase58()) throw new RescueError("NOT_POSITION_OWNER", "connected wallet does not own this position (on-chain owner: " + onChainOwner + ")");

  const locks = await lockMap(dlmm);
  const lock = Number(locks[posKey.toBase58()] || 0);
  if (lock > 0 && lock > Math.floor(Date.now() / 1000)) {
    throw new RescueError("POSITION_LOCKED", "position is locked until release point " + lock);
  }

  const txs = await dlmm.removeLiquidity({
    user: ownerKey,
    position: posKey,
    fromBinId: d.lowerBinId,
    toBinId: d.upperBinId,
    bps: new BN(10000),            // 100%
    shouldClaimAndClose: true,
  });
  const list = Array.isArray(txs) ? txs : [txs];

  const xDec = tokenDecimals(dlmm.tokenX), yDec = tokenDecimals(dlmm.tokenY);
  return {
    transactions: list,
    preview: {
      protocol: "meteora-dlmm",
      pool: poolKey.toBase58(),
      position: posKey.toBase58(),
      owner: ownerKey.toBase58(),
      removingX: uiAmount(String(d.totalXAmount).split(".")[0], xDec),
      removingY: uiAmount(String(d.totalYAmount).split(".")[0], yDec),
      claimingFeeX: uiAmount(d.feeX?.toString?.() ?? "0", xDec),
      claimingFeeY: uiAmount(d.feeY?.toString?.() ?? "0", yDec),
      tokenXMint: dlmm.tokenX.publicKey.toBase58(),
      tokenYMint: dlmm.tokenY.publicKey.toBase58(),
      willClosePosition: true,
      transactionCount: list.length,
    },
  };
}

module.exports = {
  DLMM_PROGRAM_ID,
  RescueError,
  scanRescue,
  buildFullWithdrawal,
};
