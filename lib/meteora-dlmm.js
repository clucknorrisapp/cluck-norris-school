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
const kv = require("./kvstore");

// The treasury's Meteora pool (cbBTC/SOL, top turnover) — default for opening positions.
const METEORA_POOL = process.env.METEORA_POOL || "Hz1EtXTGaFEtAWRgRNpDMFV6vnSZtQUY9UqmdM6vfKSS";

// Persisted management config (re-center behavior). autoRecenter ships OFF — the loop
// only acts once it's explicitly enabled, so deploys never auto-move funds untested.
const MET_CFG_KEY = "meteoraCfg";
// Lifetime-fee ledger (token amounts) banked whenever a position is CLOSED — the on-chain
// claimed-fee history dies with the closed position account, so we persist it here.
const FEE_LEDGER_KEY = "meteoraFeeLedger";
const MET_DEFAULTS = { halfWidthPct: 0.6, distribution: "curve", edgeFrac: 0.12, minRecenterSec: 1800, autoRecenter: false };
const MET_BOUNDS = { halfWidthPct: [0.1, 5], edgeFrac: [0.02, 0.45], minRecenterSec: [300, 86400] };
function getCfg() { return { ...MET_DEFAULTS, ...(kv.get(MET_CFG_KEY, {}) || {}) }; }
function setCfg(patch = {}) {
  const cur = getCfg(); const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in MET_DEFAULTS)) continue;
    if (k === "distribution") { const s = String(v).toLowerCase(); if (["spot", "curve", "bidask"].includes(s)) next[k] = s; }
    else if (k === "autoRecenter") next[k] = (v === true || v === "true" || v === "1");
    else { let n = Number(v); if (Number.isFinite(n)) { const b = MET_BOUNDS[k]; if (b) n = Math.max(b[0], Math.min(b[1], n)); next[k] = n; } }
  }
  kv.set(MET_CFG_KEY, next); return next;
}

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
  let totalUsd = 0, totalFeeUsd = 0, totalClaimedUsd = 0, feeTokCbbtc = 0, feeTokSol = 0;
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
      // Fees already claimed on THIS position (the Meteora UI's "claimed" figure).
      const cfx = uiAmt(d.totalClaimedFeeXAmount && d.totalClaimedFeeXAmount.toString ? d.totalClaimedFeeXAmount.toString() : d.totalClaimedFeeXAmount, X.dec);
      const cfy = uiAmt(d.totalClaimedFeeYAmount && d.totalClaimedFeeYAmount.toString ? d.totalClaimedFeeYAmount.toString() : d.totalClaimedFeeYAmount, Y.dec);
      const inRange = activeId != null && d.lowerBinId <= activeId && activeId <= d.upperBinId;
      const valueUsd = usdOf(x, X.mint) + usdOf(y, Y.mint);
      const feeUsd = usdOf(fx, X.mint) + usdOf(fy, Y.mint);
      const claimedUsd = usdOf(cfx, X.mint) + usdOf(cfy, Y.mint);
      totalUsd += valueUsd; totalFeeUsd += feeUsd; totalClaimedUsd += claimedUsd;
      // B2: accumulate lifetime fees in TOKEN terms (pending + claimed on live positions), so a
      // 24h delta reflects fees EARNED, not price moves on the existing balance.
      for (const [amt, mint] of [[fx, X.mint], [cfx, X.mint]]) { if (mint === CBBTC_MINT) feeTokCbbtc += amt; else if (mint === WSOL_MINT) feeTokSol += amt; }
      for (const [amt, mint] of [[fy, Y.mint], [cfy, Y.mint]]) { if (mint === CBBTC_MINT) feeTokCbbtc += amt; else if (mint === WSOL_MINT) feeTokSol += amt; }
      out.push({
        pool: pool.slice(0, 8) + "…", position: (p.publicKey ? p.publicKey.toBase58() : "?").slice(0, 8) + "…",
        positionPubkey: p.publicKey ? p.publicKey.toBase58() : null, // full key — needed to target ops at ONE of several positions
        pair: `${symX}/${symY}`, inRange,
        lowerBinId: d.lowerBinId, upperBinId: d.upperBinId, activeBinId: activeId,
        lowerPrice: priceOf(d.lowerBinId), upperPrice: priceOf(d.upperBinId), currentPrice: priceOf(activeId),
        amountX: x, amountY: y, symX, symY,
        pendingFeeX: fx, pendingFeeY: fy, pendingFeeUsd: Number(feeUsd.toFixed(4)),
        claimedFeeX: cfx, claimedFeeY: cfy, claimedFeeUsd: Number(claimedUsd.toFixed(4)),
        valueUsd: Number(valueUsd.toFixed(2)),
      });
    }
  }
  // Commit any pending fee-bank whose position is no longer on-chain (a close that landed
  // despite a confirm timeout/crash before commit) — keeps lifetime fees accurate.
  try { reconcilePending(new Set(out.map((p) => p.positionPubkey).filter(Boolean))); } catch (_) {}
  // Lifetime fees. Preferred source: Meteora's own wallet-earning API — the authoritative
  // claimed history for this wallet+pool (incl. positions closed before we ran), the same
  // figure the app shows as "Fees Claimed". Fallback: our kv ledger, banked at each close
  // (a close claims fees, then the position account — and its claimed history — is gone).
  const led = kv.get(FEE_LEDGER_KEY, { cbbtc: 0, sol: 0 }) || { cbbtc: 0, sol: 0 };
  const ledgerUsd = (led.cbbtc || 0) * btcUsd + (led.sol || 0) * solUsd;
  let apiClaimedUsd = null;
  try { apiClaimedUsd = await fetchClaimedFromApi(user.toBase58(), [...map.keys()], { solUsd, btcUsd }); } catch (_) {}
  // The API total covers claims on live positions too — don't double-count those.
  const lifetime = apiClaimedUsd != null ? totalFeeUsd + apiClaimedUsd
                                         : totalFeeUsd + totalClaimedUsd + ledgerUsd;
  // Lifetime fees in TOKEN terms (live pending+claimed + the closed-position ledger) — the
  // recap diffs THESE so a 24h "fees earned" delta isn't contaminated by price moves.
  const lifetimeFeeTokens = { cbbtc: feeTokCbbtc + (led.cbbtc || 0), sol: feeTokSol + (led.sol || 0) };
  return {
    enabled: true, operator: user.toBase58(), count: out.length, totalUsd: Number(totalUsd.toFixed(2)),
    pendingFeeUsd: Number(totalFeeUsd.toFixed(4)), claimedFeeUsd: Number(totalClaimedUsd.toFixed(4)),
    apiClaimedUsd: apiClaimedUsd != null ? Number(apiClaimedUsd.toFixed(4)) : null,
    lifetimeFeeTokens,
    closedLedger: { cbbtc: led.cbbtc || 0, sol: led.sol || 0, usd: Number(ledgerUsd.toFixed(4)) },
    feeSource: apiClaimedUsd != null ? "meteora-api" : "local-ledger",
    lifetimeFeeUsd: Number(lifetime.toFixed(4)),
    positions: out,
  };
}

// Meteora's wallet-earning API — the app's "Fees Claimed" figure. Returns total claimed
// USD across the given pools, or null when unreachable/unrecognized (callers fall back to
// the local ledger). Best-effort by design: never throws, short timeout.
async function fetchClaimedFromApi(wallet, poolKeys, { solUsd = 0, btcUsd = 0 } = {}) {
  let sum = 0, got = false;
  for (const pool of poolKeys) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`https://dlmm-api.meteora.ag/wallet/${wallet}/${pool}/earning`, { headers: { accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (j == null || typeof j !== "object") continue;
      if (j.total_fee_usd_claimed != null) { sum += Number(j.total_fee_usd_claimed) || 0; got = true; continue; }
      // Fallback: raw token amounts (X=cbBTC 8dp, Y=SOL 9dp on our pool).
      if (j.total_fee_x_claimed != null || j.total_fee_y_claimed != null) {
        sum += (Number(j.total_fee_x_claimed) || 0) / 1e8 * btcUsd + (Number(j.total_fee_y_claimed) || 0) / 1e9 * solUsd;
        got = true;
      }
    } catch (_) { /* unreachable/changed API → fall back to the local ledger */ }
  }
  return got ? sum : null;
}

// ── Phase 2: manage (write) ──────────────────────────────────────────────────
function sdkMod() { return require("@meteora-ag/dlmm"); }

// Confirm a sig by polling status (avoids the confirmTransaction false-timeout that
// can make a landed tx look failed → double-action). Mirrors the Orca vault's fix.
async function confirmSig(conn, sig, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let st;
    // A3: a transient RPC blip on the status read must NOT be read as tx-failure — keep
    // polling until the deadline; only a real on-chain err or the timeout is terminal.
    try { st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; }
    catch (_) { st = null; }
    if (st) {
      if (st.err) throw new Error(`tx failed on-chain: ${sig}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`confirm timeout — VERIFY on-chain before retrying: ${sig}`);
}

// A6: in-process mutex — the live 5-min auto loop, the manual endpoints, and the recenter
// orchestrator all mutate the same wallet/positions. Serialize every fund-moving call so two
// can never double-deposit from one float snapshot or interleave a ledger read-modify-write.
let _busy = false;
async function withLock(fn) {
  if (_busy) throw new Error("meteora: another fund-moving op is in flight — try again shortly");
  _busy = true;
  try { return await fn(); } finally { _busy = false; }
}

async function signSendTx(conn, tx, extraSigners = []) {
  const op = operator();
  tx.feePayer = op.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(op, ...extraSigners);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
  // Robust confirm: under load a tx can be slow to confirm or silently dropped by the RPC.
  // The old single 90s wait aborted whole multi-tx opens even though the tx usually landed.
  // Instead, REBROADCAST the same signed tx every few seconds until it confirms (the blockhash
  // stays valid ~60-90s, so a dropped tx gets re-sent; a landed one is an idempotent no-op).
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    let st = null;
    try { st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; }
    catch (_) { /* transient RPC blip — keep trying */ }
    if (st) {
      if (st.err) throw new Error(`tx failed on-chain: ${sig}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sig;
    }
    try { await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 }); } catch (_) { /* dup/expired — fine */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`confirm timeout after rebroadcast — VERIFY on-chain before retrying: ${sig}`);
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

// A2 — fee-bank durability. A close claims fees and destroys the position account (its only
// on-chain fee record). We record the to-be-banked fees as PENDING *before* sending the close,
// then commit to the ledger after confirm; if confirm times out on a tx that actually landed,
// the pending entry survives and reconcilePending() commits it once the position is gone.
const FEE_PENDING_KEY = "meteoraFeePendingBank";
function pendingBankPush(entry) { const a = kv.get(FEE_PENDING_KEY, []) || []; a.push(entry); kv.set(FEE_PENDING_KEY, a); }
function pendingBankCommit(position) {
  const a = kv.get(FEE_PENDING_KEY, []) || []; const keep = []; let committed = false;
  const led = kv.get(FEE_LEDGER_KEY, { cbbtc: 0, sol: 0 }) || { cbbtc: 0, sol: 0 };
  for (const e of a) {
    if (e.position === position && !committed) { led.cbbtc = (led.cbbtc || 0) + (e.cbbtc || 0); led.sol = (led.sol || 0) + (e.sol || 0); committed = true; }
    else keep.push(e);
  }
  if (committed) { kv.set(FEE_LEDGER_KEY, led); kv.set(FEE_PENDING_KEY, keep); }
  return committed;
}
// Commit any pending bank whose position is no longer on-chain (close landed despite a
// timeout/crash before commit). `liveSet` = Set of live position pubkeys from status().
function reconcilePending(liveSet) {
  const a = kv.get(FEE_PENDING_KEY, []) || []; if (!a.length) return;
  for (const e of a.slice()) if (e.position && !liveSet.has(e.position)) pendingBankCommit(e.position);
}

// Pull `pct` (0..1) of a position's liquidity back to the wallet (no close).
async function removeLiquidity(a = {}) { return a.dryRun ? _removeLiquidity(a) : withLock(() => _removeLiquidity(a)); }
async function _removeLiquidity({ positionPubkey, pct, close = false, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  if (!(p > 0)) throw new Error("pct must be between 0 and 1");
  const conn = connection();
  const DLMM = sdk();
  const found = await findPosition(conn, positionPubkey);
  if (!found) throw new Error("position not found");
  const d = found.lbPos.positionData;
  const shouldClaimAndClose = !!close && p >= 0.999;
  const posKey = found.lbPos.publicKey.toBase58();
  const out = { enabled: true, action: dryRun ? "would-remove" : "remove", position: posKey, pct: p, fromBin: d.lowerBinId, toBin: d.upperBinId, close: shouldClaimAndClose };
  if (dryRun) return out;
  const dlmm = await DLMM.create(conn, new PublicKey(found.poolPk));
  // Record the bank as PENDING before the close lands (see FEE_PENDING_KEY note).
  if (shouldClaimAndClose) {
    try {
      const X = tokenInfo(found.info.tokenX || {}), Y = tokenInfo(found.info.tokenY || {});
      const tot = (v, dec) => uiAmt(v && v.toString ? v.toString() : v, dec);
      const fx = tot(d.feeX, X.dec) + tot(d.totalClaimedFeeXAmount, X.dec);
      const fy = tot(d.feeY, Y.dec) + tot(d.totalClaimedFeeYAmount, Y.dec);
      let cbbtc = 0, sol = 0;
      if (X.mint === CBBTC_MINT) cbbtc += fx; else if (X.mint === WSOL_MINT) sol += fx;
      if (Y.mint === CBBTC_MINT) cbbtc += fy; else if (Y.mint === WSOL_MINT) sol += fy;
      pendingBankPush({ position: posKey, cbbtc, sol, ts: Date.now() });
    } catch (e) { console.warn("[meteora] pending-bank record failed:", e.message); }
  }
  const txs = await dlmm.removeLiquidity({
    user: operator().publicKey, position: found.lbPos.publicKey,
    fromBinId: d.lowerBinId, toBinId: d.upperBinId,
    bps: new BN(Math.round(p * 10000)), shouldClaimAndClose,
  });
  const arr = Array.isArray(txs) ? txs : [txs];
  const sigs = [];
  for (const tx of arr) sigs.push(await signSendTx(conn, tx));
  // All txs confirmed → commit the pending bank to the ledger now.
  if (shouldClaimAndClose) { try { pendingBankCommit(posKey); } catch (e) { console.warn("[meteora] bank commit failed (will reconcile):", e.message); } }
  return { ...out, sigs };
}

// Unwrap any wSOL sitting in the operator's ATA back to native lamports. Meteora
// closes and Jupiter swaps can leave the wallet's SOL WRAPPED — but position/bin
// rent must be paid from NATIVE lamports, so an open right after a close can fail
// "insufficient lamports" while the float looks fully funded. Closing the wSOL ATA
// returns its whole balance (+ ATA rent) as native; the SDK re-wraps what it needs
// on the next deposit. Idempotent: no ATA or zero balance = no-op.
async function unwrapWsol(conn, { dryRun = false } = {}) {
  const { createCloseAccountInstruction, getAssociatedTokenAddressSync } = require("@solana/spl-token");
  const owner = operator().publicKey;
  const ata = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), owner);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  const ui = bal ? Number(bal.value.uiAmount) || 0 : 0;
  if (!bal) return { action: "none", reason: "no wSOL ATA" };
  if (dryRun) return { action: "would-unwrap", wsol: ui };
  const tx = new Transaction().add(createCloseAccountInstruction(ata, owner, owner));
  const sig = await signSendTx(conn, tx);
  return { action: "unwrap", wsol: ui, sig };
}

// Add cbBTC (X) + SOL (Y) into an existing position across its bin range, preserving the
// chosen distribution (spot/curve/bidask) so a top-up doesn't flatten a Curve position.
async function addLiquidity(a = {}) { return a.dryRun ? _addLiquidity(a) : withLock(() => _addLiquidity(a)); }
async function _addLiquidity({ positionPubkey, cbbtcUi = 0, solUi = 0, distribution = "spot", dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, reason: `${OPERATOR_ENV} not set` };
  const conn = connection();
  const DLMM = sdk();
  const found = await findPosition(conn, positionPubkey);
  if (!found) throw new Error("position not found");
  const d = found.lbPos.positionData;
  const X = tokenInfo(found.info.tokenX || {}), Y = tokenInfo(found.info.tokenY || {});
  // X is cbBTC, Y is SOL for this pool — but map by mint to be safe.
  const xUi = X.mint === CBBTC_MINT ? cbbtcUi : X.mint === WSOL_MINT ? solUi : 0;
  const yUi = Y.mint === CBBTC_MINT ? cbbtcUi : Y.mint === WSOL_MINT ? solUi : 0;
  const totalX = new BN(Math.round(Number(xUi || 0) * Math.pow(10, X.dec)));
  const totalY = new BN(Math.round(Number(yUi || 0) * Math.pow(10, Y.dec)));
  const out = { enabled: true, action: dryRun ? "would-add" : "add", position: found.lbPos.publicKey.toBase58(), cbbtc: Number(cbbtcUi) || 0, sol: Number(solUi) || 0, distribution: String(distribution).toLowerCase() };
  if (dryRun) return out;
  // native lamports pay deposit rent — recover any SOL stuck wrapped first
  try { const u = await unwrapWsol(conn); if (u.action === "unwrap") out.unwrapped = u.wsol; } catch (e) { console.warn("[meteora] unwrap failed:", e.message); }
  const dlmm = await DLMM.create(conn, new PublicKey(found.poolPk));
  const lowerBin = toNum(d.lowerBinId), upperBin = toNum(d.upperBinId);
  const totalBins = upperBin - lowerBin + 1;
  const sigs = [];
  // A single AddLiquidityByStrategy across a very wide bin span panics the DLMM program
  // ("memory allocation failed"). Wide adds are chunked into ≤MAX_ADD_BINS strategy
  // sub-ranges within the position: Y (SOL) lives at/below the active bin and X (cbBTC)
  // at/above it, so each chunk receives each side pro-rata to its bin overlap, with the
  // final chunk of each side taking the remainder (no dust stranded by rounding).
  const MAX_ADD_BINS = 60;
  if (totalBins <= MAX_ADD_BINS) {
    const tx = await dlmm.addLiquidityByStrategy({
      positionPubKey: found.lbPos.publicKey, user: operator().publicKey,
      totalXAmount: totalX, totalYAmount: totalY, slippage: 1,
      strategy: { minBinId: lowerBin, maxBinId: upperBin, strategyType: strategyTypeOf(distribution) },
    });
    const arr = Array.isArray(tx) ? tx : [tx];
    for (const t of arr) sigs.push(await signSendTx(conn, t));
    return { ...out, sigs };
  }
  const activeId = toNum((await dlmm.getActiveBin()).binId);
  const yTop = Math.min(upperBin, activeId); // highest bin that takes Y
  const xBot = Math.max(lowerBin, activeId); // lowest bin that takes X
  const yBinsTotal = Math.max(0, yTop - lowerBin + 1);
  const xBinsTotal = Math.max(0, upperBin - xBot + 1);
  let remX = totalX.clone(), remY = totalY.clone();
  const chunks = [];
  for (let a = lowerBin; a <= upperBin; a += MAX_ADD_BINS) chunks.push([a, Math.min(a + MAX_ADD_BINS - 1, upperBin)]);
  out.chunks = chunks.length;
  for (const [a, b] of chunks) {
    const yBins = (yBinsTotal && a <= yTop) ? Math.min(b, yTop) - a + 1 : 0;
    const xBins = (xBinsTotal && b >= xBot) ? b - Math.max(a, xBot) + 1 : 0;
    const chunkY = !yBins ? new BN(0) : (Math.min(b, yTop) === yTop ? remY.clone() : totalY.muln(yBins).divn(yBinsTotal));
    const chunkX = !xBins ? new BN(0) : (b === upperBin ? remX.clone() : totalX.muln(xBins).divn(xBinsTotal));
    if (chunkX.isZero() && chunkY.isZero()) continue;
    remY = remY.sub(chunkY); remX = remX.sub(chunkX);
    const tx = await dlmm.addLiquidityByStrategy({
      positionPubKey: found.lbPos.publicKey, user: operator().publicKey,
      totalXAmount: chunkX, totalYAmount: chunkY, slippage: 1,
      strategy: { minBinId: a, maxBinId: b, strategyType: strategyTypeOf(distribution) },
    });
    const arr = Array.isArray(tx) ? tx : [tx];
    for (const t of arr) sigs.push(await signSendTx(conn, t));
  }
  return { ...out, sigs };
}

// ── Open a fresh position centered on price, ±halfWidthPct, with a chosen distribution ──
// distribution: "spot" (uniform) | "curve" (center-weighted) | "bidask" (edge-weighted).
// Handles wide ranges that exceed one tx by assembling the SDK's multi-position
// instruction set (init + ata + chunked add-liquidity), each tx signed in order.
async function openPosition(a = {}) { return a.dryRun ? _openPosition(a) : withLock(() => _openPosition(a)); }
async function _openPosition({ poolAddress = METEORA_POOL, cbbtcUi = 0, solUi = 0, halfWidthPct = 0.6, distribution = "spot", dryRun = false } = {}) {
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
  // position/bin-array rent is paid from NATIVE lamports — unwrap stranded wSOL first
  try { const u = await unwrapWsol(conn); if (u.action === "unwrap") out.unwrapped = u.wsol; } catch (e) { console.warn("[meteora] unwrap failed:", e.message); }
  const resp = await dlmm.initializeMultiplePositionAndAddLiquidityByStrategy(
    async (count) => Array.from({ length: count }, () => Keypair.generate()),
    totalX, totalY,
    { minBinId, maxBinId, strategyType: strategyTypeOf(distribution) },
    operator().publicKey, operator().publicKey, 1,
  );
  const sigs = [], positions = [];
  try {
    for (const grp of (resp.instructionsByPositions || [])) {
      positions.push(grp.positionKeypair.publicKey.toBase58()); // record BEFORE init so a
      // mid-sequence failure still surfaces the orphan position pubkey to the caller.
      const initTx = new Transaction();
      if (grp.initializeAtaIxs && grp.initializeAtaIxs.length) initTx.add(...grp.initializeAtaIxs);
      initTx.add(grp.initializePositionIx);
      sigs.push(await signSendTx(conn, initTx, [grp.positionKeypair]));
      for (const ixGroup of (grp.addLiquidityIxs || [])) {
        if (!ixGroup || !ixGroup.length) continue;
        sigs.push(await signSendTx(conn, new Transaction().add(...ixGroup)));
      }
    }
  } catch (e) {
    // Attach partial state so a caller can see/repair what landed (no silent orphans).
    e.partial = { ...out, positions, sigs, completedTxs: sigs.length };
    throw e;
  }
  return { ...out, positions, sigs };
}

// Fee-ledger access — `set` exists so the ledger can be SEEDED to match Meteora's true
// "Fees Claimed" figure for history that predates the ledger (the API being unreachable).
function getLedger() { return kv.get(FEE_LEDGER_KEY, { cbbtc: 0, sol: 0 }) || { cbbtc: 0, sol: 0 }; }
function setLedger({ cbbtc, sol } = {}) {
  const cur = getLedger();
  const next = { cbbtc: cbbtc != null && Number.isFinite(Number(cbbtc)) ? Math.max(0, Number(cbbtc)) : cur.cbbtc, sol: sol != null && Number.isFinite(Number(sol)) ? Math.max(0, Number(sol)) : cur.sol };
  kv.set(FEE_LEDGER_KEY, next); return next;
}

module.exports = { status, isEnabled, operatorPubkey, removeLiquidity, addLiquidity, openPosition, unwrapWsol, getCfg, setCfg, getLedger, setLedger, OPERATOR_ENV, CBBTC_MINT, WSOL_MINT, METEORA_POOL };
