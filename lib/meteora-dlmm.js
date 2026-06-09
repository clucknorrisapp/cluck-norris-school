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
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const { connection } = require("./rpc");

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

module.exports = { status, isEnabled, operatorPubkey, OPERATOR_ENV, CBBTC_MINT, WSOL_MINT };
