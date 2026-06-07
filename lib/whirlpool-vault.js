// ── Liquidity Engine: autonomous vault ───────────────────────────────────────
// The hands-off layer on top of lib/orca-whirlpools.js. You fund ONE dedicated
// wallet with the market-making float (e.g. $1k USDC + $1k CLKN); this keeps a
// centered, balanced concentrated-liquidity position in the CLKN/USDC Whirlpool
// and RE-CENTERS it automatically as price moves up and down — collecting fees
// each time it rolls the range.
//
// ⚠ CUSTODY: unlike the rest of the tool, the vault SIGNS ON ITS OWN, so it needs
// a hot key. It is loaded from MM_OPERATOR_SECRET (Railway env, never committed).
// Use a DEDICATED wallet that holds ONLY the float — never the treasury and never
// any mint/authority. If MM_OPERATOR_SECRET is unset, the vault is fully disabled
// (the scheduler never starts), so deploying without the key is a safe no-op.
//
// It re-uses the SAME verified transaction builders as the non-custodial tool —
// it just adds the operator signature and submits — so the autonomous path runs
// on already-proven construction code.
//
// HONEST SCOPE: this manages REAL depth that fills REAL traders. It never trades
// against itself. Re-centering uses whatever inventory the wallet holds; it does
// not (yet) swap to restore a strict 50/50 — idle inventory accrues on the
// trending side and is redeployed on the next roll. (Swap-based ratio restoration
// via Jupiter is the planned next layer.)
const { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const engine = require("./orca-whirlpools");
const kv = require("./kvstore");

const STATE_KEY = "wpVaultState";
const CONFIG_KEY = "wpVaultConfig";

const DEFAULT_CONFIG = {
  pair: "CLKN/USDC",
  feeTierPct: 0.3,          // the 0.30% tier — competitive routing + real fees
  widthPct: 10,             // ±10% each side — tighter = deeper at price = lower impact (re-centers more often)
  edgeTriggerFrac: 0.15,    // re-center when price is within 15% of a range edge
  deployFrac: 0.95,         // deploy up to 95% of the binding side
  maxUsd: 1000,             // hard cap on USDC deployed per position
  minRebalanceIntervalSec: 1800,  // ≥30 min between rolls — anti-thrash
  maxActionsPerDay: 12,     // daily cap on opens+closes
  priceGapGuardPct: 25,     // skip a tick if price gapped >25% (anomaly guard)
  slippageBps: 100,
  // Upside ask-wall — an OPTIONAL second position: single-sided CLKN in a tight
  // band just above price (deep asks = smooth buys / upside depth). Funded from the
  // operator wallet's free CLKN, separately from the balanced base. OFF by default.
  askWallEnabled: false,
  askWallUpPct: 12,            // wall spans from just above price up to +12% (tight = deep)
  askWallClknFraction: 0.5,    // share of FREE CLKN committed to the wall on each (re)open
  askWallPullDropPct: 10,      // pull the wall down if price falls >10% below its lower edge
  askWallFeeTierPct: 0.65,     // the ask-wall lives in its OWN (higher-fee) pool — premium on pumps
  // CLKN/SOL vault — an OPTIONAL separate balanced position in the CLKN/SOL pool, to
  // sit directly on the SOL-driven arbitrage between pools. Own state namespace (sol_*),
  // funded from SOL (beyond a gas reserve) + CLKN. OFF by default.
  solEnabled: false,
  solFeeTierPct: 0.02,         // CLKN/SOL only exists at 0.01% / 0.02% on Orca — use the wider
  solWidthPct: 10,             // ±10% balanced range
  solMaxSol: 1.0,              // hard cap on SOL deployed into the position
  solGasReserve: 0.05,         // keep this much native SOL untouched for gas + rent
  solDeployThreshold: 0.5,     // re-center the SOL pool to absorb this much+ of newly-available SOL
  // Auto-rebalance (swap layer) — keeps the wallet's inventory in the shape the
  // pools need so positions can always fund themselves. By default it only tops up
  // USDC by swapping SOL→USDC (it NEVER sells CLKN). OFF by default.
  swapEnabled: false,
  targetUsdc: 500,             // keep ~this much free USDC available for the CLKN/USDC base
  swapSolFloor: 2,             // never swap SOL below this (gas + SOL-pool reserve)
  maxSwapSolPerCycle: 5,       // cap SOL converted per cycle
  swapSlippageBps: 100,
  maxSwapsPerDay: 8,
};

function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}
function connection() { return new Connection(rpcUrl(), "confirmed"); }

// Load the operator keypair from env. Supports base58 (Phantom export) or a JSON
// byte array (solana-keygen). Returns null if unset/invalid — vault stays off.
let _operator = null, _operatorTried = false;
function operator() {
  if (_operatorTried) return _operator;
  _operatorTried = true;
  const raw = process.env.MM_OPERATOR_SECRET;
  if (!raw) return (_operator = null);
  try {
    const trimmed = raw.trim();
    const bytes = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed))
      : bs58.decode(trimmed);
    _operator = Keypair.fromSecretKey(bytes);
    console.log(`[vault] operator wallet loaded: ${_operator.publicKey.toBase58()}`);
  } catch (e) {
    console.error("[vault] MM_OPERATOR_SECRET present but could not be parsed — vault disabled");
    _operator = null;
  }
  return _operator;
}
function isEnabled() { return !!operator(); }

function getConfig() { return { ...DEFAULT_CONFIG, ...(kv.get(CONFIG_KEY, {}) || {}) }; }
function setConfig(patch) {
  const next = { ...getConfig(), ...(patch || {}) };
  // keep only known keys, coerce numerics
  const clean = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) if (k in next) clean[k] = next[k];
  kv.set(CONFIG_KEY, clean);
  return clean;
}
function getState() { return kv.get(STATE_KEY, {}) || {}; }
function setState(patch) { kv.set(STATE_KEY, { ...getState(), ...patch }); }

// ── Telegram (self-contained; no coupling to server.js) ──────────────────────
async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch { /* notification is best-effort */ }
}

// ── Sign + submit a base64 transaction the engine built (owner = operator) ───
// The engine already partial-signed any ephemeral signers (e.g. the position NFT
// mint); we just add the operator's fee-payer/authority signature and send.
async function signSend(conn, txBase64) {
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(operator());
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

// ── Wallet float (what the operator wallet holds) ────────────────────────────
async function getFloat(conn) {
  const op = operator().publicKey;
  const sol = (await conn.getBalance(op)) / 1e9;
  let clkn = 0, usdc = 0;
  const resp = await conn.getParsedTokenAccountsByOwner(op, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });
  for (const { account } of resp.value) {
    const info = account.data?.parsed?.info;
    if (!info) continue;
    const ui = Number(info.tokenAmount?.uiAmount || 0);
    if (info.mint === engine.CLKN_MINT) clkn += ui;
    else if (info.mint === engine.USDC_MINT) usdc += ui;
  }
  return { sol, clkn, usdc };
}

async function resolvePoolAddress(cfg) {
  const pools = await engine.discoverPools();
  const match = pools.find((p) => p.pair === cfg.pair && Math.abs(p.feeTierPct - cfg.feeTierPct) < 1e-9);
  if (!match) throw new Error(`No ${cfg.pair} pool at the ${cfg.feeTierPct}% tier`);
  return match.address;
}

// Where the current price sits inside [lower, upper], as a 0..1 fraction. <0 or
// >1 means out of range.
function rangeFraction(price, lower, upper) {
  if (upper <= lower) return 0.5;
  return (price - lower) / (upper - lower);
}

// ── The core tick: decide and (optionally) act ───────────────────────────────
// Returns a structured report. dryRun=true plans without signing anything.
async function tick({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "MM_OPERATOR_SECRET not set" };
  const cfg = getConfig();
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress(cfg);
  const pool = await engine.getPoolState(address, operator().publicKey);
  const price = pool.clknPriceInQuote;

  // Anomaly guard: if price gapped hard since last tick, sit out one round.
  if (st.lastPrice && st.lastPrice > 0) {
    const gap = Math.abs(price - st.lastPrice) / st.lastPrice;
    if (gap > cfg.priceGapGuardPct / 100) {
      setState({ lastPrice: price, lastTickTs: Date.now() });
      return { enabled: true, action: "none", reason: `price gap ${(gap * 100).toFixed(1)}% > guard — skipping`, price };
    }
  }

  // Daily action accounting.
  const today = new Date().toISOString().slice(0, 10);
  let dayActions = st.dayStamp === today ? (st.dayActions || 0) : 0;

  // Inspect the live managed position (if any).
  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58()); } catch { /* best effort */ }
  const managed = positions.find((p) => p.positionMint === st.positionMint);
  // Free USDC the swap layer has staged — used to auto-absorb new capital into the base.
  let preFloat = { usdc: 0 };
  try { preFloat = await getFloat(conn); } catch { /* best effort */ }

  let needRoll = false, reason = "", forceRoll = false;
  if (!managed) {
    needRoll = true; reason = st.positionMint ? "managed position no longer found — reopening" : "no position yet — opening";
  } else if (managed.pool !== address) {
    // Fee-tier migration: the configured pool changed (different fee tier), so move
    // the position into the new pool. Bypasses the anti-thrash timer.
    needRoll = true; forceRoll = true; reason = `fee-tier migration → ${cfg.feeTierPct}% pool`;
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    // Width reconfig: if the live position's width no longer matches the configured
    // widthPct, re-center into the new width. This is how a widthPct change is applied
    // to an already-open position (compared via the fixed upper/lower price ratio, which
    // doesn't move as price travels through the range).
    const w = cfg.widthPct / 100;
    const expRatio = (1 + w) / (1 - w);
    const posRatio = managed.lowerPriceClkn > 0 ? managed.upperPriceClkn / managed.lowerPriceClkn : expRatio;
    const widthOff = Math.abs(posRatio - expRatio) / expRatio;
    if (frac < 0 || frac > 1) { needRoll = true; reason = "out of range"; }
    else if (widthOff > 0.2) { needRoll = true; forceRoll = true; reason = `width reconfig → ±${cfg.widthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across range)`; }
    else if (cfg.swapEnabled && preFloat.usdc >= cfg.targetUsdc * 0.9) { needRoll = true; forceRoll = true; reason = `deploying staged USDC ($${preFloat.usdc.toFixed(0)})`; }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };

  if (!needRoll) { setState({ lastPrice: price, lastTickTs: Date.now() }); return { ...base, action: "hold", reason }; }

  // Anti-thrash + daily cap (only gate ROLLS, not the first open).
  const sinceLast = st.lastRebalanceTs ? (Date.now() - st.lastRebalanceTs) / 1000 : Infinity;
  if (managed && !forceRoll && sinceLast < cfg.minRebalanceIntervalSec) {
    setState({ lastPrice: price, lastTickTs: Date.now() });
    return { ...base, action: "deferred", reason: `${reason}, but only ${Math.round(sinceLast)}s since last roll (min ${cfg.minRebalanceIntervalSec}s)` };
  }
  if (dayActions >= cfg.maxActionsPerDay) {
    setState({ lastPrice: price, lastTickTs: Date.now() });
    return { ...base, action: "capped", reason: `daily action cap (${cfg.maxActionsPerDay}) reached` };
  }

  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  // 1) Close the existing position (withdraw + collect fees) if present.
  if (managed) {
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ positionMint: null });
  }

  // 2) Open a fresh balanced position centered on current price.
  const fresh = await engine.getPoolState(address, operator().publicKey);
  const ranges = engine.suggestRanges(fresh, cfg.widthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Size: deploy up to deployFrac of USDC (capped at maxUsd); if that needs more
  // CLKN than we hold, fall back to sizing by our CLKN balance.
  const usdcDeploy = Math.min(float.usdc * cfg.deployFrac, cfg.maxUsd);
  let inputMint = engine.USDC_MINT, inputAmount = usdcDeploy;
  if (usdcDeploy > 0) {
    const q = await engine.quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.USDC_MINT, inputAmount: String(usdcDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
    if (clknNeeded > float.clkn * cfg.deployFrac) {
      inputMint = engine.CLKN_MINT;
      inputAmount = float.clkn * cfg.deployFrac;
    }
  } else if (float.clkn > 0) {
    inputMint = engine.CLKN_MINT;
    inputAmount = float.clkn * cfg.deployFrac;
  } else {
    setState({ lastPrice: price, lastTickTs: Date.now(), dayActions, dayStamp: today });
    report.action = "no-float"; report.reason = "wallet holds no deployable CLKN/USDC";
    await notify(`📊 <b>Liquidity vault</b>: closed position but wallet has no float to redeploy. Fund the operator wallet.`);
    return report;
  }

  const built = await engine.buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let openSig; for (const t of built.txs) openSig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: openSig, positionMint: built.positionMint });
  setState({
    positionMint: built.positionMint, poolAddress: address,
    lowerPriceClkn: balanced.lowerPriceClkn, upperPriceClkn: balanced.upperPriceClkn,
    lastRebalanceTs: Date.now(), lastPrice: price, lastTickTs: Date.now(),
    dayActions, dayStamp: today, rebalanceCount: (st.rebalanceCount || 0) + 1,
  });

  await notify(
    `📊 <b>Liquidity vault — ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.pair} @ ${cfg.feeTierPct}% · price ${price.toPrecision(5)}\n` +
    `New range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\n` +
    `Reason: ${reason}\nPosition: <code>${built.positionMint.slice(0, 8)}…</code>`
  );
  return report;
}

// ── Ask-wall tick: maintain the optional upside single-sided CLKN position ───
// A tight band of CLKN asks just above price. Re-centers when price rises through
// it (asks filled → reopen above the new price; this is intentional distribution)
// or when price falls well below it (pull the wall back down toward price). Funded
// from FREE CLKN only, so it never touches the balanced base's locked liquidity.
// Run BEFORE the balanced tick() each cycle so it reserves its CLKN first.
async function tickAskWall({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.askWallEnabled) return { enabled: true, action: "none", reason: "ask-wall disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: cfg.pair, feeTierPct: cfg.askWallFeeTierPct });
  const pool = await engine.getPoolState(address, operator().publicKey);
  const price = pool.clknPriceInQuote;

  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58()); } catch { /* best effort */ }
  const wall = positions.find((p) => p.positionMint === st.wallMint);

  let needRoll = false, reason = "", forceRoll = false;
  if (!wall) {
    needRoll = true; reason = st.wallMint ? "wall position gone — reopening" : "no wall yet — opening";
  } else if (wall.pool !== address) {
    needRoll = true; forceRoll = true; reason = `fee-tier migration → ${cfg.askWallFeeTierPct}% pool`;
  } else if (price > wall.upperPriceClkn) {
    needRoll = true; reason = "asks filled (price above wall) — reopening above";
  } else if (price < wall.lowerPriceClkn * (1 - cfg.askWallPullDropPct / 100)) {
    needRoll = true; reason = "price dropped below wall — pulling it down";
  } else {
    reason = `wall in place (${wall.lowerPriceClkn.toPrecision(4)} → ${wall.upperPriceClkn.toPrecision(4)})`;
  }

  const base = { enabled: true, wall: true, price, pair: cfg.pair };
  if (!needRoll) return { ...base, action: "hold", reason };

  const today = new Date().toISOString().slice(0, 10);
  let wallDayActions = st.wallDayStamp === today ? (st.wallDayActions || 0) : 0;
  const sinceLast = st.wallLastRebalanceTs ? (Date.now() - st.wallLastRebalanceTs) / 1000 : Infinity;
  if (wall && !forceRoll && sinceLast < cfg.minRebalanceIntervalSec) return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` };
  if (wallDayActions >= cfg.maxActionsPerDay) return { ...base, action: "capped", reason: "ask-wall daily cap reached" };
  if (dryRun) return { ...base, action: wall ? "would-roll" : "would-open", reason };

  const report = { ...base, action: wall ? "roll" : "open", reason, steps: [] };

  // Close the existing wall first (frees its CLKN/USDC back to the wallet).
  if (wall) {
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.wallMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    wallDayActions++;
    setState({ wallMint: null });
  }

  // Open a fresh tight single-sided CLKN ask band just above price.
  const fresh = await engine.getPoolState(address, operator().publicKey);
  const ranges = engine.suggestRanges(fresh, cfg.askWallUpPct);
  const askOpt = ranges.options.find((o) => o.id === "clkn");
  const float = await getFloat(conn);
  const clknDeploy = float.clkn * cfg.askWallClknFraction;
  if (!(clknDeploy > 0)) {
    setState({ wallLastRebalanceTs: Date.now(), wallDayActions, wallDayStamp: today });
    report.action = "no-clkn"; report.reason = "no free CLKN to deploy into the wall";
    await notify("📊 <b>Liquidity vault</b>: ask-wall wanted to (re)open but the wallet has no free CLKN. Add CLKN to fund it.");
    return report;
  }

  const built = await engine.buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: askOpt.lowerTick, upperTick: askOpt.upperTick, inputMint: engine.CLKN_MINT, inputAmount: String(clknDeploy), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  wallDayActions++;
  report.steps.push({ open: sig, positionMint: built.positionMint });
  setState({
    wallMint: built.positionMint,
    wallLowerPrice: askOpt.lowerPriceClkn, wallUpperPrice: askOpt.upperPriceClkn,
    wallLastRebalanceTs: Date.now(), wallDayActions, wallDayStamp: today,
  });
  await notify(
    `📊 <b>Liquidity vault — ask-wall ${report.action === "roll" ? "refreshed" : "opened"}</b>\n` +
    `${cfg.pair} · price ${price.toPrecision(5)}\n` +
    `Asks: ${askOpt.lowerPriceClkn.toPrecision(4)} → ${askOpt.upperPriceClkn.toPrecision(4)}\n` +
    `Reason: ${reason}\nWall: <code>${built.positionMint.slice(0, 8)}…</code>`
  );
  return report;
}

// ── CLKN/SOL balanced vault (optional) — sits on the SOL arbitrage ───────────
// A separate balanced position in the CLKN/SOL Whirlpool. As SOL/USD moves, CLKN/SOL
// misprices vs CLKN/USDC and arbitrageurs realign the pools — trading against this
// depth and paying us fees. Own state namespace ("sol_*") so it never touches the
// USDC vault's state. Funded from SOL (beyond a gas reserve) + CLKN. OFF by default.
async function tickSol({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.solEnabled) return { enabled: true, action: "none", reason: "CLKN/SOL vault disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: "CLKN/SOL", feeTierPct: cfg.solFeeTierPct });
  const pool = await engine.getPoolState(address, operator().publicKey);
  const price = pool.clknPriceInQuote; // CLKN price in SOL

  if (st.sol_lastPrice && st.sol_lastPrice > 0) {
    const gap = Math.abs(price - st.sol_lastPrice) / st.sol_lastPrice;
    if (gap > cfg.priceGapGuardPct / 100) {
      setState({ sol_lastPrice: price });
      return { enabled: true, action: "none", reason: `price gap ${(gap * 100).toFixed(1)}% > guard — skipping`, price };
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let dayActions = st.sol_dayStamp === today ? (st.sol_dayActions || 0) : 0;

  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58()); } catch { /* best effort */ }
  const managed = positions.find((p) => p.positionMint === st.sol_positionMint);
  // Available SOL above the gas reserve — used to grow the pool when SOL is added.
  let preSolFree = 0;
  try { preSolFree = (await getFloat(conn)).sol - cfg.solGasReserve; } catch { /* best effort */ }

  let needRoll = false, reason = "", widthDriven = false;
  if (!managed) {
    needRoll = true; reason = st.sol_positionMint ? "position gone — reopening" : "no CLKN/SOL position yet — opening";
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    const w = cfg.solWidthPct / 100;
    const expRatio = (1 + w) / (1 - w);
    const posRatio = managed.lowerPriceClkn > 0 ? managed.upperPriceClkn / managed.lowerPriceClkn : expRatio;
    const widthOff = Math.abs(posRatio - expRatio) / expRatio;
    if (frac < 0 || frac > 1) { needRoll = true; reason = "out of range"; }
    else if (widthOff > 0.2) { needRoll = true; widthDriven = true; reason = `width reconfig → ±${cfg.solWidthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across)`; }
    else if (preSolFree > cfg.solDeployThreshold) { needRoll = true; reason = `deploying available SOL (${preSolFree.toFixed(2)})`; }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, pair: "CLKN/SOL", feeTierPct: cfg.solFeeTierPct, price, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };
  if (!needRoll) { setState({ sol_lastPrice: price }); return { ...base, action: "hold", reason }; }

  const sinceLast = st.sol_lastRebalanceTs ? (Date.now() - st.sol_lastRebalanceTs) / 1000 : Infinity;
  if (managed && !widthDriven && sinceLast < cfg.minRebalanceIntervalSec) { setState({ sol_lastPrice: price }); return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` }; }
  if (dayActions >= cfg.maxActionsPerDay) { setState({ sol_lastPrice: price }); return { ...base, action: "capped", reason: "daily cap reached" }; }
  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  if (managed) {
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.sol_positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ sol_positionMint: null });
  }

  const fresh = await engine.getPoolState(address, operator().publicKey);
  const ranges = engine.suggestRanges(fresh, cfg.solWidthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Deploy from SOL (the quote side), keeping a gas/rent reserve; fall back to CLKN
  // if the SOL-sized position needs more CLKN than we hold.
  const solAvail = Math.max(0, float.sol - cfg.solGasReserve);
  const solDeploy = Math.min(solAvail * cfg.deployFrac, cfg.solMaxSol);
  let inputMint = engine.WSOL_MINT, inputAmount = solDeploy;
  if (solDeploy > 0) {
    const q = await engine.quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.WSOL_MINT, inputAmount: String(solDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB); // CLKN is tokenB in CLKN/SOL
    if (clknNeeded > float.clkn * cfg.deployFrac) { inputMint = engine.CLKN_MINT; inputAmount = float.clkn * cfg.deployFrac; }
  } else if (float.clkn > 0) {
    inputMint = engine.CLKN_MINT; inputAmount = float.clkn * cfg.deployFrac;
  } else {
    setState({ sol_lastPrice: price, sol_dayActions: dayActions, sol_dayStamp: today });
    report.action = "no-float"; report.reason = "no deployable SOL/CLKN after gas reserve";
    await notify("📊 <b>Liquidity vault (CLKN/SOL)</b>: no deployable SOL/CLKN after the gas reserve — fund SOL + CLKN.");
    return report;
  }

  const built = await engine.buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: sig, positionMint: built.positionMint });
  setState({
    sol_positionMint: built.positionMint,
    sol_lowerPriceClkn: balanced.lowerPriceClkn, sol_upperPriceClkn: balanced.upperPriceClkn,
    sol_lastRebalanceTs: Date.now(), sol_lastPrice: price, sol_dayActions: dayActions, sol_dayStamp: today,
  });
  await notify(
    `📊 <b>Liquidity vault — CLKN/SOL ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.solFeeTierPct}% · price ${price.toPrecision(5)} SOL\n` +
    `Range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\nReason: ${reason}`
  );
  return report;
}

// ── Auto-rebalance (swap layer) ──────────────────────────────────────────────
// Keeps the wallet's inventory in the shape the pools need. Today: when free USDC
// is below target, swap a bounded amount of SOL → USDC via Jupiter so the balanced
// CLKN/USDC base can fund itself. NEVER sells CLKN. Signs a Jupiter v0 tx with the
// operator and submits. Guarded: SOL floor, per-cycle cap, daily cap, slippage cap.
async function jupQuote(inMint, outMint, amount, mode, slippageBps) {
  const u = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&swapMode=${mode}&slippageBps=${slippageBps}`;
  return (await fetch(u, { headers: { accept: "application/json" } })).json();
}
async function jupSwapTx(quote, userPubkey) {
  const r = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: userPubkey, wrapAndUnwrapSol: true }),
  });
  const j = await r.json();
  if (j.error) throw new Error("Jupiter swap build: " + j.error);
  return j.swapTransaction;
}
async function signSendVersioned(conn, txBase64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  tx.sign([operator()]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  for (let i = 0; i < 40; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s) { if (s.err) throw new Error("swap tx failed on-chain"); if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return sig; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("swap confirm timeout");
}

async function rebalanceInventory({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.swapEnabled) return { enabled: true, action: "none", reason: "auto-swap disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const float = await getFloat(conn);
  if (float.usdc >= cfg.targetUsdc) return { enabled: true, action: "none", reason: `USDC ok ($${float.usdc.toFixed(0)} ≥ target $${cfg.targetUsdc})` };
  const spareSol = float.sol - cfg.swapSolFloor;
  if (spareSol <= 0.05) return { enabled: true, action: "none", reason: `no spare SOL above floor (${cfg.swapSolFloor})` };

  const today = new Date().toISOString().slice(0, 10);
  let swapsToday = st.swapDayStamp === today ? (st.swapsToday || 0) : 0;
  if (swapsToday >= cfg.maxSwapsPerDay) return { enabled: true, action: "capped", reason: `daily swap cap (${cfg.maxSwapsPerDay})` };

  const maxSol = Math.min(spareSol, cfg.maxSwapSolPerCycle);
  const shortfallUsdc = cfg.targetUsdc - float.usdc;

  // Prefer ExactOut for the exact shortfall; if it needs more SOL than we can spend
  // this cycle, fall back to spending maxSol exact-in (partial top-up, more next cycle).
  let quote, mode = "ExactOut";
  const exactOut = await jupQuote(engine.WSOL_MINT, engine.USDC_MINT, Math.round(shortfallUsdc * 1e6), "ExactOut", cfg.swapSlippageBps);
  if (exactOut && !exactOut.error && Number(exactOut.inAmount) / 1e9 <= maxSol) {
    quote = exactOut;
  } else {
    mode = "ExactIn";
    quote = await jupQuote(engine.WSOL_MINT, engine.USDC_MINT, Math.round(maxSol * 1e9), "ExactIn", cfg.swapSlippageBps);
  }
  if (!quote || quote.error) return { enabled: true, action: "none", reason: `no Jupiter route (${quote && quote.error})` };

  const solIn = Number(quote.inAmount) / 1e9, usdcOut = Number(quote.outAmount) / 1e6;
  const base = { enabled: true, action: "swap", reason: `${mode}: ${solIn.toFixed(3)} SOL → ${usdcOut.toFixed(2)} USDC`, solIn, usdcOut };
  if (dryRun) return { ...base, action: "would-swap" };

  const swapTx = await jupSwapTx(quote, operator().publicKey.toBase58());
  const sig = await signSendVersioned(conn, swapTx);
  setState({ swapsToday: swapsToday + 1, swapDayStamp: today });
  await notify(`🔁 <b>Liquidity vault — rebalanced inventory</b>\nSwapped ${solIn.toFixed(3)} SOL → ${usdcOut.toFixed(2)} USDC (top up base liquidity)\n<code>${sig.slice(0, 8)}…</code>`);
  return { ...base, sig };
}

// ── Manual / ad-hoc swap (any direction) via Jupiter ─────────────────────────
// Admin-triggered conversion between SOL / USDC / CLKN, signed by the operator.
// Used for one-off corrections and inventory moves the auto-rebalancer doesn't
// cover yet. dryRun=true just quotes.
async function manualSwap({ fromSym, toSym, amountUi, slippageBps = 100, dryRun = false }) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const M = { SOL: engine.WSOL_MINT, USDC: engine.USDC_MINT, CLKN: engine.CLKN_MINT };
  const from = M[fromSym], to = M[toSym];
  if (!from || !to || from === to) throw new Error("from/to must be SOL, USDC, or CLKN (and differ)");
  const inDec = fromSym === "USDC" ? 6 : 9;
  const outDec = toSym === "USDC" ? 6 : 9;
  const amount = Math.round(Number(amountUi) * 10 ** inDec);
  if (!(amount > 0)) throw new Error("amount must be > 0");
  const q = await jupQuote(from, to, amount, "ExactIn", slippageBps);
  if (!q || q.error) return { enabled: true, action: "none", reason: "no Jupiter route: " + (q && q.error) };
  const inAmt = Number(q.inAmount) / 10 ** inDec, out = Number(q.outAmount) / 10 ** outDec;
  const base = { enabled: true, reason: `${inAmt.toFixed(4)} ${fromSym} → ${out.toFixed(4)} ${toSym}`, inAmt, out };
  if (dryRun) return { ...base, action: "would-swap" };
  const tx = await jupSwapTx(q, operator().publicKey.toBase58());
  const sig = await signSendVersioned(connection(), tx);
  await notify(`🔁 <b>Vault swap</b>: ${inAmt.toFixed(3)} ${fromSym} → ${out.toFixed(2)} ${toSym}\n<code>${sig.slice(0, 8)}…</code>`);
  return { ...base, action: "swap", sig };
}

// ── Status (for the gated admin endpoint) ────────────────────────────────────
async function status() {
  const cfg = getConfig();
  const st = getState();
  const out = {
    enabled: isEnabled(),
    operator: isEnabled() ? operator().publicKey.toBase58() : null,
    paused: !!st.paused,
    config: cfg,
    state: {
      positionMint: st.positionMint || null,
      range: st.positionMint ? { lower: st.lowerPriceClkn, upper: st.upperPriceClkn } : null,
      askWall: cfg.askWallEnabled
        ? (st.wallMint ? { mint: st.wallMint, lower: st.wallLowerPrice, upper: st.wallUpperPrice } : { mint: null })
        : "disabled",
      solVault: cfg.solEnabled
        ? (st.sol_positionMint ? { mint: st.sol_positionMint, lower: st.sol_lowerPriceClkn, upper: st.sol_upperPriceClkn, feeTierPct: cfg.solFeeTierPct } : { mint: null })
        : "disabled",
      autoSwap: cfg.swapEnabled
        ? { targetUsdc: cfg.targetUsdc, swapsToday: st.swapDayStamp === new Date().toISOString().slice(0, 10) ? (st.swapsToday || 0) : 0 }
        : "disabled",
      lastPrice: st.lastPrice || null,
      lastRebalanceTs: st.lastRebalanceTs || null,
      lastTickTs: st.lastTickTs || null,
      rebalanceCount: st.rebalanceCount || 0,
      dayActions: st.dayStamp === new Date().toISOString().slice(0, 10) ? (st.dayActions || 0) : 0,
    },
  };
  if (isEnabled()) {
    try { out.float = await getFloat(connection()); } catch (e) { out.float = { error: e.message }; }
  }
  return out;
}

function pause() { setState({ paused: true }); return { paused: true }; }
function resume() { setState({ paused: false }); return { paused: false }; }

// ── Public, sanitized positions view (safe to show in the group chat) ─────────
// Returns ONLY pair / range / in-range — never the wallet address, balances, or
// position sizes. Used by the public /liquidity Telegram command.
async function publicPositions() {
  if (!isEnabled()) return { enabled: false, positions: [] };
  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58()); }
  catch (e) { return { enabled: true, error: e.message, positions: [] }; }
  // CLKN price in USD = its price in USDC (from any CLKN/USDC position).
  const usdcPos = positions.find((p) => p.quoteSymbol === "USDC");
  const clknUsd = usdcPos ? usdcPos.currentPriceClkn : 0;
  // SOL price in USD = clknUsd ÷ (CLKN price in SOL).
  const solPos = positions.find((p) => p.quoteSymbol === "SOL");
  const solUsd = (solPos && solPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / solPos.currentPriceClkn : 0;
  let totalUsd = 0;
  const out = positions.map((p) => {
    const quoteUsd = p.quoteSymbol === "USDC" ? p.quoteAmount : p.quoteAmount * solUsd;
    const valueUsd = (p.clknAmount * clknUsd) + quoteUsd;
    totalUsd += valueUsd;
    return {
      pair: p.pair, quoteSymbol: p.quoteSymbol,
      lower: p.lowerPriceClkn, upper: p.upperPriceClkn, current: p.currentPriceClkn,
      clknAmount: p.clknAmount, quoteAmount: p.quoteAmount,
      valueUsd, inRange: p.inRange,
    };
  });
  return { enabled: true, positions: out, totalUsd, clknUsd, solUsd };
}

module.exports = { isEnabled, tick, tickAskWall, tickSol, rebalanceInventory, manualSwap, status, publicPositions, getConfig, setConfig, pause, resume, DEFAULT_CONFIG };
