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
const { Connection, PublicKey, Keypair, Transaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const engine = require("./orca-whirlpools");
const kv = require("./kvstore");

const STATE_KEY = "wpVaultState";
const CONFIG_KEY = "wpVaultConfig";

const DEFAULT_CONFIG = {
  pair: "CLKN/USDC",
  feeTierPct: 0.3,          // the 0.30% tier — competitive routing + real fees
  widthPct: 30,             // wide range = rarely out of range = low maintenance/bleed
  edgeTriggerFrac: 0.15,    // re-center when price is within 15% of a range edge
  deployFrac: 0.95,         // deploy up to 95% of the binding side
  maxUsd: 1000,             // hard cap on USDC deployed per position
  minRebalanceIntervalSec: 1800,  // ≥30 min between rolls — anti-thrash
  maxActionsPerDay: 12,     // daily cap on opens+closes
  priceGapGuardPct: 25,     // skip a tick if price gapped >25% (anomaly guard)
  slippageBps: 100,
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

  let needRoll = false, reason = "";
  if (!managed) {
    needRoll = true; reason = st.positionMint ? "managed position no longer found — reopening" : "no position yet — opening";
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    if (frac < 0 || frac > 1) { needRoll = true; reason = "out of range"; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across range)`; }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };

  if (!needRoll) { setState({ lastPrice: price, lastTickTs: Date.now() }); return { ...base, action: "hold", reason }; }

  // Anti-thrash + daily cap (only gate ROLLS, not the first open).
  const sinceLast = st.lastRebalanceTs ? (Date.now() - st.lastRebalanceTs) / 1000 : Infinity;
  if (managed && sinceLast < cfg.minRebalanceIntervalSec) {
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
  const openSig = await signSend(conn, built.txBase64);
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

module.exports = { isEnabled, tick, status, getConfig, setConfig, pause, resume, DEFAULT_CONFIG };
