// ── Meteora DLMM adapter (read layer) ────────────────────────────────────────
// Visibility + (later) management for positions on Meteora's DLMM, a *different*
// venue from our Orca/Raydium tick-based engines (DLMM = discrete price "bins", not
// tick ranges). Phase 1 is READ-ONLY: list the operator's DLMM positions, their
// range, token amounts, pending fees, and in-range status, so the treasury's
// Meteora cbBTC/SOL position can be tracked alongside the Orca vault.
//
// Safety: the @meteora-ag/dlmm SDK is loaded LAZILY inside calls (never at module
// top-level), so a missing/broken dep can never crash app boot — a failed load just
// surfaces as an error on the (gated) endpoint. Reuses the treasury hot wallet
// (MM_OPERATOR_SECRET_TREASURY) — the same wallet that holds the live positions.
const { Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { BN } = require("@coral-xyz/anchor");
const bs58 = require("bs58");
const { connection } = require("./rpc");

// The treasury's Meteora pool (cbBTC/SOL, top turnover) — default for opening positions.
const METEORA_POOL = process.env.METEORA_POOL || "Hz1EtXTGaFEtAWRgRNpDMFV6vnSZtQUY9UqmdM6vfKSS";

const CBBTC_MINT = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYM = { [CBBTC_MINT]: "cbBTC", [WSOL_MINT]: "SOL", [USDC_MINT]: "USDC" };
const DEC = { [CBBTC_MINT]: 8, [WSOL_MINT]: 9, [USDC_MINT]: 6 };

// Which env var holds the wallet that owns the Meteora positions (the treasury wallet).
const OPERATOR_ENV = process.env.METEORA_OPERATOR_ENV || "MM_OPERATOR_SECRET_TREASURY";

let _kp, _tried = false;
function operator() {
  if (_tried) return _kp;
  _tried = true;
  const raw = process.env[OPERATOR_ENV];
  if (raw) {
    try {
      const t = raw.trim();
      const bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t)) : bs58.decode(t);
      _kp = Keypair.fromSecretKey(bytes);
      console.log(`[meteora] operator loaded: ${_kp.publicKey.toBase58()}`);
    } catch (e) {
      console.error(`[meteora] ${OPERATOR_ENV} present but unparseable — disabled (${e.message})`);
      _kp = null;
    }
  }
  return _kp;
}
function isEnabled() { return !!operator(); }
function operatorPubkey() { const k = operator(); return k ? k.publicKey.toBase58() : null; }

// Lazy SDK load — default export is the DLMM class.
function sdk() {
  const m = require("@meteora-ag/dlmm");
  return m.default || m.DLMM || m;
}

const toNum = (v) => { try { return typeof v === "number" ? v : (v && v.toNumber ? v.toNumber() : Number(v)); } catch { return Number(v) || 0; } };
const uiAmt = (lamports, decimals) => Number(lamports || 0) / Math.pow(10, decimals);

// Resolve a TokenReserve → { mint, dec } defensively across SDK shapes.
function tokenInfo(t) {
  let mint = null;
  try { mint = t && t.mint && t.mint.address ? t.mint.address.toBase58() : (t && t.publicKey && t.mint ? null : null); } catch (_) {}
  if (!mint) { try { mint = t.mint.toBase58 ? t.mint.toBase58() : String(t.mint); } catch (_) {} }
  let dec = null;
  try { dec = (t && t.mint && typeof t.mint.decimals === "number") ? t.mint.decimals : (typeof t.decimal === "number" ? t.decimal : null); } catch (_) {}
  if (dec == null) dec = DEC[mint] != null ? DEC[mint] : 9;
  return { mint, dec };
}

// ── Read all of the operator's Meteora DLMM positions ────────────────────────
// Pass current solUsd + btcUsd (cbBTC USD) to value the positions; otherwise
// values come back 0 but amounts/fees/in-range are still accurate.
async function status({ solUsd = 0, btcUsd = 0 } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  let DLMM;
  try { DLMM = sdk(); } catch (e) { return { enabled: true, error: `SDK load failed: ${e.message}` }; }
  const conn = connection();
  const user = operator().publicKey;
  let map;
  try { map = await DLMM.getAllLbPairPositionsByUser(conn, user); }
  catch (e) { return { enabled: true, operator: user.toBase58(), error: e.message, positions: [] }; }

  const usdOf = (amt, mint) => mint === CBBTC_MINT ? amt * btcUsd : mint === WSOL_MINT ? amt * solUsd : mint === USDC_MINT ? amt : 0;
  const out = [];
  let totalUsd = 0, totalFeeUsd = 0;
  for (const [pool, info] of map.entries()) {
    const lb = info.lbPair || {};
    const activeId = lb.activeId != null ? toNum(lb.activeId) : null;
    const binStep = lb.binStep != null ? toNum(lb.binStep) : null;
    const X = tokenInfo(info.tokenX || {}), Y = tokenInfo(info.tokenY || {});
    const symX = SYM[X.mint] || (X.mint || "?").slice(0, 4);
    const symY = SYM[Y.mint] || (Y.mint || "?").slice(0, 4);
    // DLMM price-per-bin: (1 + binStep/1e4)^binId, scaled by token decimals → tokenY per tokenX.
    const priceOf = (binId) => (binStep != null && binId != null) ? Math.pow(1 + binStep / 1e4, binId) * Math.pow(10, X.dec - Y.dec) : null;
    for (const p of (info.lbPairPositionsData || [])) {
      const d = p.positionData || {};
      const x = uiAmt(d.totalXAmount, X.dec), y = uiAmt(d.totalYAmount, Y.dec);
      const fx = uiAmt(d.feeX && d.feeX.toString ? d.feeX.toString() : d.feeX, X.dec);
      const fy = uiAmt(d.feeY && d.feeY.toString ? d.feeY.toString() : d.feeY, Y.dec);
      const inRange = activeId != null && d.lowerBinId <= activeId && activeId <= d.upperBinId;
      const valueUsd = usdOf(x, X.mint) + usdOf(y, Y.mint);
      const feeUsd = usdOf(fx, X.mint) + usdOf(fy, Y.mint);
      totalUsd += valueUsd; totalFeeUsd += feeUsd;
      out.push({
        pool: pool.slice(0, 8) + "…", position: (p.publicKey ? p.publicKey.toBase58() : "?").slice(0, 8) + "…",
        pair: `${symX}/${symY}`, inRange,
        lowerBinId: d.lowerBinId, upperBinId: d.upperBinId, activeBinId: activeId,
        lowerPrice: priceOf(d.lowerBinId), upperPrice: priceOf(d.upperBinId), currentPrice: priceOf(activeId),
        amountX: x, amountY: y, symX, symY,
        pendingFeeX: fx, pendingFeeY: fy, pendingFeeUsd: Number(feeUsd.toFixed(4)),
        valueUsd: Number(valueUsd.toFixed(2)),
      });
    }
  }
  return { enabled: true, operator: user.toBase58(), count: out.length, totalUsd: Number(totalUsd.toFixed(2)), pendingFeeUsd: Number(totalFeeUsd.toFixed(4)), positions: out };
}

// ── Phase 2: manage (write) ──────────────────────────────────────────────────
function sdkMod() { return require("@meteora-ag/dlmm"); }

// Confirm a sig by polling status (avoids the confirmTransaction false-timeout that
// can make a landed tx look failed → double-action). Mirrors the Orca vault's fix.
async function confirmSig(conn, sig, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    if (st) {
      if (st.err) throw new Error(`tx failed on-chain: ${sig}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`confirm timeout — VERIFY on-chain before retrying: ${sig}`);
}

async function signSendTx(conn, tx, extraSigners = []) {
  const op = operator();
  tx.feePayer = op.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(op, ...extraSigners);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSig(conn, sig);
  return sig;
}

// Map a friendly strategy name → SDK StrategyType. spot=uniform, curve=center-weighted,
// bidask=edge-weighted. Defaults to spot.
function strategyTypeOf(name) {
  const m = sdkMod();
  const s = String(name || "spot").toLowerCase();
  if (s === "curve") return m.StrategyType.Curve;
  if (s === "bidask" || s === "bid-ask" || s === "bid_ask") return m.StrategyType.BidAsk;
  return m.StrategyType.Spot;
}

// Find a position (by pubkey, or the first one if omitted) → { poolPk, info, lbPos }.
async function findPosition(conn, positionPubkey) {
  const DLMM = sdk();
  const map = await DLMM.getAllLbPairPositionsByUser(conn, operator().publicKey);
  for (const [pool, info] of map.entries()) {
    for (const lbPos of (info.lbPairPositionsData || [])) {
      const pk = lbPos.publicKey ? lbPos.publicKey.toBase58() : null;
      if (!positionPubkey || pk === positionPubkey) return { poolPk: pool, info, lbPos };
    }
  }
  return null;
}

// Pull `pct` (0..1) of a position's liquidity back to the wallet (no close).
async function removeLiquidity({ positionPubkey, pct, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  if (!(p > 0)) throw new Error("pct must be between 0 and 1");
  const conn = connection();
  const DLMM = sdk();
  const found = await findPosition(conn, positionPubkey);
  if (!found) throw new Error("position not found");
  const d = found.lbPos.positionData;
  const out = { enabled: true, action: dryRun ? "would-remove" : "remove", position: found.lbPos.publicKey.toBase58(), pct: p, fromBin: d.lowerBinId, toBin: d.upperBinId };
  if (dryRun) return out;
  const dlmm = await DLMM.create(conn, new PublicKey(found.poolPk));
  const txs = await dlmm.removeLiquidity({
    user: operator().publicKey, position: found.lbPos.publicKey,
    fromBinId: d.lowerBinId, toBinId: d.upperBinId,
    bps: new BN(Math.round(p * 10000)), shouldClaimAndClose: false,
  });
  const arr = Array.isArray(txs) ? txs : [txs];
  const sigs = [];
  for (const tx of arr) sigs.push(await signSendTx(conn, tx));
  return { ...out, sigs };
}

// Add cbBTC (X) + SOL (Y) back into an existing position, Spot across its bin range.
async function addLiquidity({ positionPubkey, cbbtcUi = 0, solUi = 0, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  const conn = connection();
  const DLMM = sdk();
  const mod = sdkMod();
  const found = await findPosition(conn, positionPubkey);
  if (!found) throw new Error("position not found");
  const d = found.lbPos.positionData;
  const X = tokenInfo(found.info.tokenX || {}), Y = tokenInfo(found.info.tokenY || {});
  // X is cbBTC, Y is SOL for this pool — but map by mint to be safe.
  const xUi = X.mint === CBBTC_MINT ? cbbtcUi : X.mint === WSOL_MINT ? solUi : 0;
  const yUi = Y.mint === CBBTC_MINT ? cbbtcUi : Y.mint === WSOL_MINT ? solUi : 0;
  const totalX = new BN(Math.round(Number(xUi || 0) * Math.pow(10, X.dec)));
  const totalY = new BN(Math.round(Number(yUi || 0) * Math.pow(10, Y.dec)));
  const out = { enabled: true, action: dryRun ? "would-add" : "add", position: found.lbPos.publicKey.toBase58(), cbbtc: Number(cbbtcUi) || 0, sol: Number(solUi) || 0 };
  if (dryRun) return out;
  const dlmm = await DLMM.create(conn, new PublicKey(found.poolPk));
  const tx = await dlmm.addLiquidityByStrategy({
    positionPubKey: found.lbPos.publicKey, user: operator().publicKey,
    totalXAmount: totalX, totalYAmount: totalY, slippage: 1,
    strategy: { minBinId: d.lowerBinId, maxBinId: d.upperBinId, strategyType: mod.StrategyType.Spot },
  });
  const arr = Array.isArray(tx) ? tx : [tx];
  const sigs = [];
  for (const t of arr) sigs.push(await signSendTx(conn, t));
  return { ...out, sigs };
}

// ── Open a fresh position centered on price, ±halfWidthPct, with a chosen distribution ──
// distribution: "spot" (uniform) | "curve" (center-weighted) | "bidask" (edge-weighted).
// Handles wide ranges that exceed one tx by assembling the SDK's multi-position
// instruction set (init + ata + chunked add-liquidity), each tx signed in order.
async function openPosition({ poolAddress = METEORA_POOL, cbbtcUi = 0, solUi = 0, halfWidthPct = 0.6, distribution = "spot", dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  const conn = connection();
  const DLMM = sdk();
  const dlmm = await DLMM.create(conn, new PublicKey(poolAddress));
  const binStep = toNum(dlmm.lbPair.binStep);
  const active = await dlmm.getActiveBin();
  const activeId = toNum(active.binId);
  // bins per side for ±halfWidthPct: (1+binStep/1e4)^N = 1 + halfWidthPct/100
  const N = Math.max(1, Math.round(Math.log(1 + halfWidthPct / 100) / Math.log(1 + binStep / 1e4)));
  const minBinId = activeId - N, maxBinId = activeId + N;
  const binCount = maxBinId - minBinId + 1;
  let positionsNeeded = 1;
  try { positionsNeeded = sdkMod().getPositionCountByBinCount(binCount); } catch (_) {}
  // token order + decimals from the pool's mints
  const decX = DEC[(dlmm.lbPair.tokenXMint || "").toString && dlmm.lbPair.tokenXMint.toString()] ?? 8;
  const decY = DEC[(dlmm.lbPair.tokenYMint || "").toString && dlmm.lbPair.tokenYMint.toString()] ?? 9;
  const mintX = dlmm.lbPair.tokenXMint ? dlmm.lbPair.tokenXMint.toString() : null;
  const xIsBtc = mintX === CBBTC_MINT;
  const totalX = new BN(Math.round((xIsBtc ? cbbtcUi : solUi) * Math.pow(10, decX)));
  const totalY = new BN(Math.round((xIsBtc ? solUi : cbbtcUi) * Math.pow(10, decY)));
  const out = {
    enabled: true, action: dryRun ? "would-open" : "open", pool: poolAddress.slice(0, 8) + "…",
    distribution: String(distribution).toLowerCase(), halfWidthPct, binStep,
    activeBinId: activeId, minBinId, maxBinId, binCount, positionsNeeded,
    cbbtc: Number(cbbtcUi) || 0, sol: Number(solUi) || 0,
  };
  if (dryRun) return out;
  const resp = await dlmm.initializeMultiplePositionAndAddLiquidityByStrategy(
    async (count) => Array.from({ length: count }, () => Keypair.generate()),
    totalX, totalY,
    { minBinId, maxBinId, strategyType: strategyTypeOf(distribution) },
    operator().publicKey, operator().publicKey, 1,
  );
  const sigs = [], positions = [];
  for (const grp of (resp.instructionsByPositions || [])) {
    positions.push(grp.positionKeypair.publicKey.toBase58());
    const initTx = new Transaction();
    if (grp.initializeAtaIxs && grp.initializeAtaIxs.length) initTx.add(...grp.initializeAtaIxs);
    initTx.add(grp.initializePositionIx);
    sigs.push(await signSendTx(conn, initTx, [grp.positionKeypair]));
    for (const ixGroup of (grp.addLiquidityIxs || [])) {
      if (!ixGroup || !ixGroup.length) continue;
      sigs.push(await signSendTx(conn, new Transaction().add(...ixGroup)));
    }
  }
  return { ...out, positions, sigs };
}

module.exports = { status, isEnabled, operatorPubkey, removeLiquidity, addLiquidity, openPosition, OPERATOR_ENV, CBBTC_MINT, WSOL_MINT, METEORA_POOL };
