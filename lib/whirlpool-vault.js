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
const { AsyncLocalStorage } = require("async_hooks");

// Multi-tenant scope: the active project for the current async call tree. The public
// functions run inside als.run({ projectId, tok }), and every resolver below defaults
// to this scope — so the existing bare getConfig()/getState()/operator() calls become
// project-scoped with no edits, and it's concurrency-safe (each call tree has its own
// store). Outside any scope it defaults to "clkn", so nothing is changed by default.
const als = new AsyncLocalStorage();
function pid() { const s = als.getStore(); return (s && s.projectId) || "clkn"; }
function tok() { const s = als.getStore(); return (s && s.tok) || engine.DEFAULT_TOKEN; }

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
  targetUsdc: 500,             // (legacy top-up target; superseded by the equal-pools rebalancer)
  swapSolFloor: 2,             // never swap SOL below this (gas + reserve)
  maxSwapSolPerCycle: 5,
  swapSlippageBps: 100,
  maxSwapsPerDay: 8,
  // Equal-pools rebalancer: keep the CLKN/USDC base ≈ CLKN/SOL pool in USD value by
  // swapping free SOL↔USDC both ways. The underweight pool's deploy trigger then
  // absorbs the freed-up token. Keeps the two pools "bouncing off each other."
  poolBalanceTolPct: 15,        // only rebalance when the two pools differ by more than this %
  maxSwapUsdPerCycle: 250,      // cap the value moved per cycle
  minSwapUsd: 15,               // don't bother with swaps smaller than this
  usdcFloor: 20,                // keep at least this much free USDC (don't drain it all to SOL)
  baseDeployThresholdUsd: 40,   // base re-centers to absorb free USDC above this
};

function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}
function connection() { return new Connection(rpcUrl(), "confirmed"); }

// ── Multi-tenant project registry ────────────────────────────────────────────
// Each project = one token + its quotes + a dedicated operator key + its own
// config/state. The built-in "clkn" project is special: it uses the LEGACY kv keys
// and MM_OPERATOR_SECRET, so CLKN is byte-for-byte unchanged by multi-tenancy
// (zero migration, zero risk). Additional projects get namespaced keys
// (wpVaultConfig:<id> / wpVaultState:<id>) and their own operator env var.
const PROJECTS_KEY = "wpProjects";
const DEFAULT_PROJECT = {
  id: "clkn", label: "Cluck Norris (CLKN)", symbol: "CLKN",
  tokenMint: engine.CLKN_MINT, quoteMints: [engine.USDC_MINT, engine.WSOL_MINT],
  operatorEnv: "MM_OPERATOR_SECRET", active: true, builtin: true,
};
function listProjects() {
  const extra = kv.get(PROJECTS_KEY, {}) || {};
  return { clkn: { ...DEFAULT_PROJECT }, ...extra };
}
function getProject(id = "clkn") {
  if (id === "clkn") return { ...DEFAULT_PROJECT };
  const p = (kv.get(PROJECTS_KEY, {}) || {})[id];
  return p ? { ...p } : null;
}
function registerProject(rec) {
  if (!rec || !rec.id) throw new Error("project id required");
  if (rec.id === "clkn") throw new Error("'clkn' is the built-in default project");
  if (!/^[a-z0-9_-]{2,24}$/.test(rec.id)) throw new Error("id must be 2-24 chars [a-z0-9_-]");
  if (!rec.tokenMint) throw new Error("tokenMint required");
  const all = kv.get(PROJECTS_KEY, {}) || {};
  const prev = all[rec.id] || {};
  all[rec.id] = {
    id: rec.id, label: rec.label || rec.id,
    symbol: (rec.symbol || rec.id).toUpperCase().slice(0, 10),
    tokenMint: rec.tokenMint,
    quoteMints: Array.isArray(rec.quoteMints) && rec.quoteMints.length ? rec.quoteMints : [engine.USDC_MINT, engine.WSOL_MINT],
    operatorEnv: rec.operatorEnv || `MM_OPERATOR_SECRET_${rec.id.toUpperCase().replace(/-/g, "_")}`,
    // Optional per-project Telegram room (same bot, different chat). Falls back to the
    // main TELEGRAM_CHAT_ID. Lets each project's alerts post to its own community.
    telegramChatId: rec.telegramChatId != null ? String(rec.telegramChatId) : (prev.telegramChatId || null),
    active: rec.active !== false,
  };
  kv.set(PROJECTS_KEY, all);
  return all[rec.id];
}
function removeProject(id) {
  if (id === "clkn") throw new Error("cannot remove the built-in default project");
  const all = kv.get(PROJECTS_KEY, {}) || {};
  if (!all[id]) return false;
  delete all[id]; kv.set(PROJECTS_KEY, all); return true;
}

// Per-project kv keys. "clkn" → the original keys (untouched); others → namespaced.
function cfgKey(id = "clkn") { return id === "clkn" ? CONFIG_KEY : `${CONFIG_KEY}:${id}`; }
function stateKey(id = "clkn") { return id === "clkn" ? STATE_KEY : `${STATE_KEY}:${id}`; }

// Operator keypair per project, loaded from that project's env var (base58 or JSON
// byte array). Cached. Returns null if unset/invalid — that project stays a no-op.
const _operators = new Map(); // projectId -> { keypair, tried }
function operator(projectId = pid()) {
  const cached = _operators.get(projectId);
  if (cached && cached.tried) return cached.keypair;
  const proj = getProject(projectId);
  const envName = proj ? proj.operatorEnv : null;
  const raw = envName ? process.env[envName] : null;
  let kp = null;
  if (raw) {
    try {
      const trimmed = raw.trim();
      const bytes = trimmed.startsWith("[") ? Uint8Array.from(JSON.parse(trimmed)) : bs58.decode(trimmed);
      kp = Keypair.fromSecretKey(bytes);
      console.log(`[vault] operator loaded for "${projectId}": ${kp.publicKey.toBase58()}`);
    } catch (e) {
      console.error(`[vault] ${envName} present but could not be parsed — project "${projectId}" disabled`);
      kp = null;
    }
  }
  _operators.set(projectId, { keypair: kp, tried: true });
  return kp;
}
function isEnabled(projectId = pid()) { return !!operator(projectId); }
// Operator wallet pubkey (or null). Used by the buy poller to skip the vault's own
// ops. Returns ALL configured operator pubkeys when called with no project, so the
// poller can skip every managed wallet, not just CLKN's.
function operatorPubkey(projectId = pid()) { const o = operator(projectId); return o ? o.publicKey.toBase58() : null; }
function operatorPubkeys() {
  const set = new Set();
  for (const id of Object.keys(listProjects())) { const pk = operatorPubkey(id); if (pk) set.add(pk); }
  return [...set];
}

function getConfig(projectId = pid()) { return { ...DEFAULT_CONFIG, ...(kv.get(cfgKey(projectId), {}) || {}) }; }
function setConfig(patch, projectId = pid()) {
  const next = { ...getConfig(projectId), ...(patch || {}) };
  // keep only known keys, coerce numerics
  const clean = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) if (k in next) clean[k] = next[k];
  kv.set(cfgKey(projectId), clean);
  return clean;
}
function getState(projectId = pid()) { return kv.get(stateKey(projectId), {}) || {}; }
function setState(patch, projectId = pid()) { kv.set(stateKey(projectId), { ...getState(projectId), ...patch }); }

// Build the engine token context for a project, and run a function scoped to it.
function projectTok(id) {
  const p = getProject(id);
  if (!p) return engine.DEFAULT_TOKEN;
  return { mint: p.tokenMint, symbol: p.symbol || (id === "clkn" ? "CLKN" : id.toUpperCase()), quoteMints: p.quoteMints };
}
function withProject(projectId, fn) {
  const id = projectId || "clkn";
  return als.run({ projectId: id, tok: projectTok(id) }, fn);
}

// ── Engine Modes ─────────────────────────────────────────────────────────────
// Named presets over the "shape" knobs. A mode changes STRATEGY SHAPE only — it
// deliberately does NOT touch risk (usdcFloor/swapSolFloor reserves), venue
// (feeTierPct), or the pair, so custody/risk/routing stay where you set them.
// Non-destructive by design: the live default is "custom" (whatever config you've
// tuned). Applying a mode is always explicit; previewMode() shows the exact diff
// first, and the pre-mode config is snapshotted so "custom" can restore it.
const MODES = {
  active: {
    label: "Active (Tight & Busy)",
    blurb: "Tight ranges, frequent re-centering — max real volume + fee capture + arb. Most fees, but most IL/gas; wants monitoring.",
    config: { widthPct: 4, edgeTriggerFrac: 0.25, minRebalanceIntervalSec: 900, maxActionsPerDay: 24, askWallEnabled: true, askWallUpPct: 8, solEnabled: true, solWidthPct: 6, swapEnabled: true, poolBalanceTolPct: 10 },
  },
  steady: {
    label: "Steady (Balanced)",
    blurb: "Medium ranges, moderate cadence — healthy two-sided depth, slow-steady drift. The low-touch default.",
    config: { widthPct: 10, edgeTriggerFrac: 0.15, minRebalanceIntervalSec: 1800, maxActionsPerDay: 12, askWallEnabled: true, askWallUpPct: 12, solEnabled: true, solWidthPct: 15, swapEnabled: true, poolBalanceTolPct: 15 },
  },
  foundation: {
    label: "Foundation (Wide & Passive)",
    blurb: "Wide ranges, rare re-centering — deep stable floor, set-and-forget. Lowest fees/volume, lowest IL/gas/maintenance.",
    config: { widthPct: 35, edgeTriggerFrac: 0.08, minRebalanceIntervalSec: 21600, maxActionsPerDay: 3, askWallEnabled: false, solEnabled: true, solWidthPct: 40, swapEnabled: false, poolBalanceTolPct: 30 },
  },
};
// Tilt overlay (orthogonal) — controls the upside-ask weighting (where depth leans).
// Layers on top of a mode; tilt wins on shared keys. Deeper bid-side accumulation
// is pending the catch-ladder build, so Accumulation today = lighter asks.
const TILTS = {
  balanced: { label: "Balanced", config: { askWallClknFraction: 0.5 } },
  distribution: { label: "Distribution (ask-heavy — sell into strength)", config: { askWallEnabled: true, askWallClknFraction: 0.9 } },
  accumulation: { label: "Accumulation (bid-heavy — lighter asks)", config: { askWallClknFraction: 0.2 } },
};

function modePatch(name, tilt) {
  const m = MODES[name];
  if (!m) throw new Error(`Unknown mode "${name}" — options: ${Object.keys(MODES).join(", ")}, custom`);
  let patch = { ...m.config };
  if (tilt) {
    const t = TILTS[tilt];
    if (!t) throw new Error(`Unknown tilt "${tilt}" — options: ${Object.keys(TILTS).join(", ")}`);
    patch = { ...patch, ...t.config };
  }
  return patch;
}
function diffConfig(patch, current) {
  const changes = [];
  for (const [k, v] of Object.entries(patch)) if (current[k] !== v) changes.push({ key: k, from: current[k], to: v });
  return changes;
}
function previewMode(name, tilt) {
  const cur = getConfig();
  if (name === "custom") {
    const snap = getState().customConfigSnapshot;
    if (!snap) return { mode: "custom", note: "No saved custom snapshot to restore.", changes: [] };
    return { mode: "custom", tilt: null, label: "Custom (restore your pre-mode config)", changes: diffConfig(snap, cur), willRecenter: true };
  }
  const patch = modePatch(name, tilt);
  const changes = diffConfig(patch, cur);
  return {
    mode: name, tilt: tilt || null,
    label: MODES[name].label + (tilt ? ` · ${TILTS[tilt].label}` : ""),
    blurb: MODES[name].blurb,
    changes,
    willRecenter: changes.some((c) => ["widthPct", "askWallEnabled", "solEnabled", "askWallUpPct", "solWidthPct", "askWallClknFraction"].includes(c.key)),
    note: "Preview only — nothing applied. Re-send with run=1 to apply. Reserves, fee tier, and pair are left untouched.",
  };
}
function applyMode(name, tilt) {
  const cur = getConfig();
  const st = getState();
  if (name === "custom") {
    const snap = st.customConfigSnapshot;
    if (!snap) throw new Error("No saved custom snapshot to restore.");
    const config = setConfig(snap);
    setState({ mode: "custom", tilt: null });
    return { applied: "custom", config, changes: diffConfig(snap, cur) };
  }
  const patch = modePatch(name, tilt);
  // Snapshot the current config the first time we leave "custom", so it's restorable.
  if ((st.mode || "custom") === "custom" && !st.customConfigSnapshot) setState({ customConfigSnapshot: cur });
  const config = setConfig(patch);
  setState({ mode: name, tilt: tilt || null });
  return { applied: name, tilt: tilt || null, label: MODES[name].label + (tilt ? ` · ${TILTS[tilt].label}` : ""), config, changes: diffConfig(patch, cur), note: "Applied. The engine re-centers to the new shape on the next tick. Reserves, fee tier, and pair were not changed." };
}
function listModes() {
  const st = getState();
  return {
    current: { mode: st.mode || "custom", tilt: st.tilt || null },
    hasCustomSnapshot: !!st.customConfigSnapshot,
    modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, { label: v.label, blurb: v.blurb, config: v.config }])),
    tilts: Object.fromEntries(Object.entries(TILTS).map(([k, v]) => [k, { label: v.label, config: v.config }])),
  };
}

// ── Telegram (self-contained; no coupling to server.js) ──────────────────────
// Dedup window: an IDENTICAL message won't be re-sent within this many seconds.
// Persisted in the kvstore so it survives process restarts/redeploys — this is
// what stops a relaunch (or a spurious reopen) from re-posting the same
// "Liquidity vault — re-centered" message. Distinct messages (different price,
// range, or position) are unaffected.
const NOTIFY_DEDUP_KEY = "vaultNotifySent";
const NOTIFY_DEDUP_SEC = 45 * 60;
function notifyHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
// The Telegram room for the scoped project (same bot, per-project chat) — falls back
// to the main TELEGRAM_CHAT_ID. So ROSE alerts post in the ROSE room, CLKN in CLKN's.
function notifyChatId() {
  const p = getProject(pid());
  return (p && p.telegramChatId) || process.env.TELEGRAM_CHAT_ID;
}
async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = notifyChatId();
  if (!token || !chat) return;
  // Suppress an exact-duplicate message sent within the dedup window (persisted).
  try {
    const now = Date.now();
    const sent = kv.get(NOTIFY_DEDUP_KEY, {}) || {};
    const key = notifyHash(chat + "|" + text);
    if (sent[key] && now - sent[key] < NOTIFY_DEDUP_SEC * 1000) {
      console.log("[vault] notify suppressed (duplicate within window)");
      return;
    }
    // Record + prune anything older than the window so the map can't grow unbounded.
    const pruned = { [key]: now };
    for (const [k, ts] of Object.entries(sent)) if (now - ts < NOTIFY_DEDUP_SEC * 1000) pruned[k] = ts;
    kv.set(NOTIFY_DEDUP_KEY, pruned);
  } catch { /* dedup is best-effort; fall through and send */ }
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
  await recordTxFee(conn, sig);
  return sig;
}

// ── Operational-cost tracking (PRIVATE — gated status/dashboard only) ─────────
// Every roll opens/closes positions and pays a Solana tx fee. This accumulates
// what the engine spends moving its own liquidity around, persisted (lifetime +
// today + tx count). Best-effort: never blocks or fails a send. On Orca this is
// a few cents per roll; the readout makes that visible (and would flag if we ever
// ran on a pricier venue). NOT exposed on the public /liquidity post.
async function recordTxFee(conn, sig) {
  try {
    let fee = null;
    for (let i = 0; i < 5; i++) {
      const txi = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (txi && txi.meta && typeof txi.meta.fee === "number") { fee = txi.meta.fee; break; }
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (fee == null) fee = 5000; // fallback to the base fee so a known tx is never uncounted
    const st = getState();
    const today = new Date().toISOString().slice(0, 10);
    const sameDay = st.feeDayStamp === today;
    setState({
      feeLamportsTotal: (st.feeLamportsTotal || 0) + fee,
      txCountTotal: (st.txCountTotal || 0) + 1,
      feeLamportsToday: (sameDay ? (st.feeLamportsToday || 0) : 0) + fee,
      txCountToday: (sameDay ? (st.txCountToday || 0) : 0) + 1,
      feeDayStamp: today,
      feeTrackingSince: st.feeTrackingSince || Date.now(),
    });
  } catch { /* cost tracking is best-effort */ }
}

// SOL/USD, cached 5 min — used only to express tracked fees in dollars.
let _solPxUsd = null, _solPxAt = 0;
async function solPriceUsd() {
  const now = Date.now();
  if (_solPxUsd && now - _solPxAt < 5 * 60 * 1000) return _solPxUsd;
  try {
    const r = await fetch("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      const p = Number(d?.["So11111111111111111111111111111111111111112"]?.usdPrice);
      if (p > 0) { _solPxUsd = p; _solPxAt = now; }
    }
  } catch { /* best effort */ }
  return _solPxUsd;
}

// Record a closing position's just-collected LP fees into the realized (lifetime)
// earnings counters. Kept in native tokens (CLKN / USDC / SOL); USD is applied at
// read time. Call right BEFORE closing a position (the close collects these fees).
// `pos` is a listPositions entry (has pendingFeeClkn/pendingFeeQuote + quoteSymbol).
function accrueRealizedFees(pos) {
  if (!pos) return;
  const st = getState();
  const clkn = Number(pos.pendingFeeClkn) || 0;
  const quote = Number(pos.pendingFeeQuote) || 0;
  const patch = {
    realizedFeeClkn: (st.realizedFeeClkn || 0) + clkn,
    feeEarnSince: st.feeEarnSince || Date.now(),
  };
  if (pos.quoteSymbol === "USDC") patch.realizedFeeUsdc = (st.realizedFeeUsdc || 0) + quote;
  else if (pos.quoteSymbol === "SOL") patch.realizedFeeSol = (st.realizedFeeSol || 0) + quote;
  setState(patch);
}

// LP fees the engine has EARNED — pending (uncollected, on open positions, real-time)
// + realized (collected on past rolls, accumulated). Valued at current prices.
// Gated/private; pairs with costs() for a live net-P&L picture.
async function earnings() {
  const st = getState();
  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); } catch { /* best effort */ }
  // CLKN/USD from any CLKN/USDC position; SOL/USD from the CLKN/SOL position (fallback: Jupiter).
  const usdcPos = positions.find((p) => p.quoteSymbol === "USDC");
  const clknUsd = usdcPos ? usdcPos.currentPriceClkn : 0;
  const solPos = positions.find((p) => p.quoteSymbol === "SOL");
  let solUsd = (solPos && solPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / solPos.currentPriceClkn : 0;
  if (!solUsd) solUsd = (await solPriceUsd()) || 0;

  let pClkn = 0, pUsdc = 0, pSol = 0;
  for (const p of positions) {
    pClkn += Number(p.pendingFeeClkn) || 0;
    if (p.quoteSymbol === "USDC") pUsdc += Number(p.pendingFeeQuote) || 0;
    else if (p.quoteSymbol === "SOL") pSol += Number(p.pendingFeeQuote) || 0;
  }
  const pendingUsd = pClkn * clknUsd + pUsdc + pSol * solUsd;

  const rClkn = st.realizedFeeClkn || 0, rUsdc = st.realizedFeeUsdc || 0, rSol = st.realizedFeeSol || 0;
  const realizedUsd = rClkn * clknUsd + rUsdc + rSol * solUsd;

  return {
    since: st.feeEarnSince || null,
    prices: { clknUsd, solUsd },
    pending: { clkn: pClkn, usdc: pUsdc, sol: pSol, usd: pendingUsd },
    realized: { clkn: rClkn, usdc: rUsdc, sol: rSol, usd: realizedUsd },
    totalEarnedUsd: pendingUsd + realizedUsd,
  };
}

// Tracked operational costs (fees the engine paid moving positions). Gated/private.
async function costs() {
  const st = getState();
  const today = new Date().toISOString().slice(0, 10);
  const lamportsTotal = st.feeLamportsTotal || 0;
  const lamportsToday = st.feeDayStamp === today ? (st.feeLamportsToday || 0) : 0;
  const solTotal = lamportsTotal / 1e9;
  const solToday = lamportsToday / 1e9;
  const px = await solPriceUsd();
  const txTotal = st.txCountTotal || 0;
  return {
    trackingSince: st.feeTrackingSince || null,
    solPriceUsd: px || null,
    today: { sol: solToday, usd: px ? solToday * px : null, txCount: st.feeDayStamp === today ? (st.txCountToday || 0) : 0 },
    lifetime: { sol: solTotal, usd: px ? solTotal * px : null, txCount: txTotal },
    avgPerTxSol: txTotal ? solTotal / txTotal : 0,
    avgPerTxUsd: txTotal && px ? (solTotal / txTotal) * px : null,
  };
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
    if (info.mint === tok().mint) clkn += ui;
    else if (info.mint === engine.USDC_MINT) usdc += ui;
  }
  return { sol, clkn, usdc };
}

async function resolvePoolAddress(cfg) {
  const t = tok();
  // Derive the pool address directly (works for brand-new pools the Orca API hasn't
  // indexed yet). Quote is read off the pair label; fall back to API discovery.
  const quoteSym = String(cfg.pair || "").split("/")[1] || "USDC";
  const quoteMint = quoteSym === "SOL" ? engine.WSOL_MINT : engine.USDC_MINT;
  try {
    const addr = engine.poolAddressFor({ tokenMint: t.mint, quoteMint, feeTierPct: cfg.feeTierPct });
    await engine.getPoolState(addr, null, t); // verify it exists on-chain
    return addr;
  } catch (_) {
    const pools = await engine.discoverPools(t);
    const match = pools.find((p) => p.pair === cfg.pair && Math.abs(p.feeTierPct - cfg.feeTierPct) < 1e-9);
    if (!match) throw new Error(`No ${cfg.pair} pool at the ${cfg.feeTierPct}% tier`);
    return match.address;
  }
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
  const pool = await engine.getPoolState(address, operator().publicKey, tok());
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

  // Inspect the live managed position (if any). If the lookup FAILS (RPC cold/
  // rate-limited, common right after a restart), do NOT conclude the position is
  // gone — that would trigger a spurious "reopening" + duplicate alert. Skip the
  // round instead and try again next tick.
  let positions = [], fetchOk = true;
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) { setState({ lastTickTs: Date.now() }); return { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, action: "skip", reason: "position lookup failed — retrying next tick" }; }
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
    else if (cfg.swapEnabled && preFloat.usdc >= cfg.usdcFloor + cfg.baseDeployThresholdUsd) { needRoll = true; forceRoll = true; reason = `deploying staged USDC ($${(preFloat.usdc - cfg.usdcFloor).toFixed(0)} above reserve)`; }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };

  if (!needRoll) { setState({ lastPrice: price, lastTickTs: Date.now() }); return { ...base, action: "hold", reason }; }

  // Anti-thrash + daily cap. Gate ROLLS and REOPENS (anything where we already
  // believe a position exists, via st.positionMint) — only a genuine first-ever
  // open (no positionMint on record) skips the timer. This stops a restart from
  // "reopening" a position that was actually rolled moments ago.
  const sinceLast = st.lastRebalanceTs ? (Date.now() - st.lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.positionMint) && !forceRoll && sinceLast < cfg.minRebalanceIntervalSec) {
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
    accrueRealizedFees(managed); // the close collects these fees → bank them as realized
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ positionMint: null });
  }

  // 2) Open a fresh balanced position centered on current price.
  const fresh = await engine.getPoolState(address, operator().publicKey, tok());
  const ranges = engine.suggestRanges(fresh, cfg.widthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Size: deploy up to deployFrac of USDC (capped at maxUsd); if that needs more
  // CLKN than we hold, fall back to sizing by our CLKN balance.
  const usdcDeploy = Math.min(Math.max(0, float.usdc - cfg.usdcFloor) * cfg.deployFrac, cfg.maxUsd);
  let inputMint = engine.USDC_MINT, inputAmount = usdcDeploy;
  if (usdcDeploy > 0) {
    const q = await engine.quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.USDC_MINT, inputAmount: String(usdcDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
    if (clknNeeded > float.clkn * cfg.deployFrac) {
      inputMint = tok().mint;
      inputAmount = float.clkn * cfg.deployFrac;
    }
  } else if (float.clkn > 0) {
    inputMint = tok().mint;
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
  const pool = await engine.getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;

  let positions = [], fetchOk = true;
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, wall: true, price, pair: cfg.pair, action: "skip", reason: "position lookup failed — retrying next tick" };
  let wall = positions.find((p) => p.positionMint === st.wallMint);
  if (!wall) {
    // Self-heal: if state lost track of the wall (e.g. a manual run racing the scheduler),
    // adopt the existing wall in THIS pool instead of stacking a duplicate. The wall may
    // share the base pool, so identify it by EXCLUDING the tracked base + SOL positions;
    // among any leftovers prefer the most ask-like (highest lower edge / above market).
    const stray = positions
      .filter((p) => p.pool === address && p.positionMint !== st.positionMint && p.positionMint !== st.sol_positionMint && p.tokenAmount > 0)
      .sort((a, b) => b.lowerPriceClkn - a.lowerPriceClkn)[0];
    if (stray) {
      wall = stray;
      setState({ wallMint: stray.positionMint, wallLowerPrice: stray.lowerPriceClkn, wallUpperPrice: stray.upperPriceClkn });
    }
  }

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
  if ((wall || st.wallMint) && !forceRoll && sinceLast < cfg.minRebalanceIntervalSec) return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` };
  if (wallDayActions >= cfg.maxActionsPerDay) return { ...base, action: "capped", reason: "ask-wall daily cap reached" };
  if (dryRun) return { ...base, action: wall ? "would-roll" : "would-open", reason };

  const report = { ...base, action: wall ? "roll" : "open", reason, steps: [] };

  // Close the existing wall first (frees its CLKN/USDC back to the wallet).
  if (wall) {
    accrueRealizedFees(wall); // bank the wall's collected fees as realized
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.wallMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    wallDayActions++;
    setState({ wallMint: null });
  }

  // Open a fresh tight single-sided CLKN ask band just above price.
  const fresh = await engine.getPoolState(address, operator().publicKey, tok());
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

  const built = await engine.buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: askOpt.lowerTick, upperTick: askOpt.upperTick, inputMint: tok().mint, inputAmount: String(clknDeploy), slippageBps: cfg.slippageBps });
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
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct });
  const pool = await engine.getPoolState(address, operator().publicKey, tok());
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

  let positions = [], fetchOk = true;
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct, price, action: "skip", reason: "position lookup failed — retrying next tick" };
  const managed = positions.find((p) => p.positionMint === st.sol_positionMint);
  // Available SOL above the gas reserve — used to grow the pool when SOL is added.
  let preSolFree = 0;
  try { preSolFree = (await getFloat(conn)).sol - cfg.swapSolFloor; } catch { /* best effort */ }

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

  const base = { enabled: true, pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct, price, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };
  if (!needRoll) { setState({ sol_lastPrice: price }); return { ...base, action: "hold", reason }; }

  const sinceLast = st.sol_lastRebalanceTs ? (Date.now() - st.sol_lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.sol_positionMint) && !widthDriven && sinceLast < cfg.minRebalanceIntervalSec) { setState({ sol_lastPrice: price }); return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` }; }
  if (dayActions >= cfg.maxActionsPerDay) { setState({ sol_lastPrice: price }); return { ...base, action: "capped", reason: "daily cap reached" }; }
  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  if (managed) {
    accrueRealizedFees(managed); // bank the CLKN/SOL position's collected fees as realized
    const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.sol_positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ sol_positionMint: null });
  }

  const fresh = await engine.getPoolState(address, operator().publicKey, tok());
  const ranges = engine.suggestRanges(fresh, cfg.solWidthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Deploy from SOL (the quote side), keeping a gas/rent reserve; fall back to CLKN
  // if the SOL-sized position needs more CLKN than we hold.
  const solAvail = Math.max(0, float.sol - cfg.swapSolFloor);
  const solDeploy = Math.min(solAvail * cfg.deployFrac, cfg.solMaxSol);
  let inputMint = engine.WSOL_MINT, inputAmount = solDeploy;
  if (solDeploy > 0) {
    const q = await engine.quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.WSOL_MINT, inputAmount: String(solDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB); // CLKN is tokenB in CLKN/SOL
    if (clknNeeded > float.clkn * cfg.deployFrac) { inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac; }
  } else if (float.clkn > 0) {
    inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac;
  } else {
    setState({ sol_lastPrice: price, sol_dayActions: dayActions, sol_dayStamp: today });
    report.action = "no-float"; report.reason = "no deployable SOL/CLKN after gas reserve";
    await notify(`📊 <b>Liquidity vault (${tok().symbol}/SOL)</b>: no deployable SOL/${tok().symbol} after the gas reserve — fund SOL + ${tok().symbol}.`);
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
    `📊 <b>Liquidity vault — ${tok().symbol}/SOL ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
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
    if (s) { if (s.err) throw new Error("swap tx failed on-chain"); if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") { await recordTxFee(conn, sig); return sig; } }
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
  const M = { SOL: engine.WSOL_MINT, USDC: engine.USDC_MINT, CLKN: tok().mint };
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

// ── Equal-pools rebalancer ───────────────────────────────────────────────────
// Keeps the two-sided CLKN/USDC base ≈ the CLKN/SOL pool in USD value. When they
// drift apart (a big buy banks USDC, an arb shifts the SOL pool, etc.), it swaps
// free SOL↔USDC toward the underweight pool — and that pool's deploy trigger
// (staged-USDC for the base, deploy-idle for SOL) then absorbs it on the next tick.
// Only uses FREE inventory (never withdraws from a pool); never sells CLKN.
async function rebalancePools({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.swapEnabled) return { enabled: true, action: "none", reason: "auto-swap disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };
  const conn = connection();

  let positions = [];
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); }
  catch (e) { return { enabled: true, action: "none", reason: "positions read failed: " + e.message }; }
  const base = positions.find((p) => p.positionMint === st.positionMint);   // two-sided CLKN/USDC
  const sol = positions.find((p) => p.positionMint === st.sol_positionMint); // CLKN/SOL
  if (!base || !sol) return { enabled: true, action: "none", reason: "need both base + SOL positions live to balance" };

  const clknUsd = base.currentPriceClkn;                                  // CLKN price in USDC = USD
  const solUsd = sol.currentPriceClkn > 0 ? clknUsd / sol.currentPriceClkn : 0;
  if (!(clknUsd > 0) || !(solUsd > 0)) return { enabled: true, action: "none", reason: "price read incomplete" };
  const vBase = base.clknAmount * clknUsd + base.quoteAmount;             // base quote = USDC
  const vSol = sol.clknAmount * clknUsd + sol.quoteAmount * solUsd;       // SOL quote = SOL
  const bigger = Math.max(vBase, vSol), gap = Math.abs(vBase - vSol);
  const out = { enabled: true, vBase: Math.round(vBase), vSol: Math.round(vSol) };
  if (bigger <= 0 || gap < (cfg.poolBalanceTolPct / 100) * bigger) {
    return { ...out, action: "balanced", reason: `pools within ${cfg.poolBalanceTolPct}% ($${Math.round(vBase)} base vs $${Math.round(vSol)} SOL)` };
  }

  const today = new Date().toISOString().slice(0, 10);
  let swapsToday = st.swapDayStamp === today ? (st.swapsToday || 0) : 0;
  if (swapsToday >= cfg.maxSwapsPerDay) return { ...out, action: "capped", reason: "daily swap cap reached" };

  const float = await getFloat(conn);
  const moveUsd = Math.min(gap / 2, cfg.maxSwapUsdPerCycle); // move half the gap, capped — converges over cycles

  let fromSym, toSym, inAmtUi;
  if (vBase > vSol) {
    // SOL pool underweight → feed it: USDC → SOL (SOL deploy-idle then grows the pool)
    const usableUsdc = Math.max(0, float.usdc - cfg.usdcFloor);
    const usd = Math.min(moveUsd, usableUsdc);
    if (usd < cfg.minSwapUsd) return { ...out, action: "none", reason: `SOL pool underweight by $${Math.round(gap)} but only $${float.usdc.toFixed(0)} free USDC` };
    fromSym = "USDC"; toSym = "SOL"; inAmtUi = usd;
  } else {
    // base underweight → feed it: SOL → USDC (staged-USDC then grows the base)
    const usableSol = Math.max(0, float.sol - cfg.swapSolFloor);
    const solUi = Math.min(moveUsd / solUsd, usableSol);
    if (solUi * solUsd < cfg.minSwapUsd) return { ...out, action: "none", reason: `base underweight by $${Math.round(gap)} but only ${float.sol.toFixed(2)} free SOL above floor` };
    fromSym = "SOL"; toSym = "USDC"; inAmtUi = solUi;
  }

  const r = { ...out, action: dryRun ? "would-rebalance" : "rebalance", reason: `${fromSym}→${toSym} to balance pools (gap $${Math.round(gap)})`, fromSym, toSym, inAmtUi };
  if (dryRun) return r;
  const res = await manualSwap({ fromSym, toSym, amountUi: inAmtUi, slippageBps: cfg.swapSlippageBps, dryRun: false });
  setState({ swapsToday: swapsToday + 1, swapDayStamp: today });
  r.sig = res.sig;
  await notify(`⚖️ <b>Liquidity vault — pool rebalance</b>\nBase $${Math.round(vBase)} vs SOL $${Math.round(vSol)} (gap $${Math.round(gap)})\nSwapped ${res.reason} to even them up.`);
  return r;
}

// ── Pool bootstrap: create a new pool for this project at market price ────────
// Onboarding helper. Creates a fresh Orca pool for the scoped project's token at a
// chosen quote + fee tier, initialized to the live market price (from Jupiter), so
// the first liquidity isn't arbitraged away. dryRun builds without signing. After it
// lands, set the project's config (pair + feeTierPct) and the normal tick() seeds it.
async function jupPriceUsdMap(mints) {
  try {
    const ids = mints.join(",");
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids}`, { signal: AbortSignal.timeout(7000) });
    if (r.ok) return await r.json();
  } catch { /* best effort */ }
  return {};
}
async function createPool({ quoteSym = "SOL", feeTierPct = 0.02, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set for this project" };
  const t = tok();
  if (!t.mint) throw new Error("project has no token mint");
  const quote = String(quoteSym).toUpperCase();
  const quoteMint = quote === "USDC" ? engine.USDC_MINT : engine.WSOL_MINT;
  // Live market price of the token in the quote, via Jupiter (venue-agnostic).
  const px = await jupPriceUsdMap([t.mint, engine.WSOL_MINT]);
  const tokenUsd = Number(px[t.mint] && px[t.mint].usdPrice);
  const solUsd = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice);
  if (!(tokenUsd > 0)) throw new Error("no live market price for the token (Jupiter)");
  const tokenPriceInQuote = quote === "USDC" ? tokenUsd : (solUsd > 0 ? tokenUsd / solUsd : 0);
  if (!(tokenPriceInQuote > 0)) throw new Error("could not derive token price in quote");

  const conn = connection();
  const built = await engine.buildCreatePool({
    owner: operator().publicKey.toBase58(),
    tokenMint: t.mint, quoteMint, feeTierPct, tokenPriceInQuote,
  });
  const out = { enabled: true, pair: `${t.symbol}/${quote}`, feeTierPct: Number(feeTierPct), poolAddress: built.poolAddress, initialTick: built.initialTick, tickSpacing: built.tickSpacing, tokenPriceInQuote };
  if (dryRun) return { ...out, action: "would-create" };
  const sig = await signSend(conn, built.txBase64);
  await notify(`🆕 <b>Liquidity vault — pool created</b>\n${t.symbol}/${quote} @ ${feeTierPct}% · price ${tokenPriceInQuote.toPrecision(5)}\nPool: <code>${built.poolAddress.slice(0, 8)}…</code>`);
  return { ...out, action: "created", sig };
}

// ── Close a specific position by mint (manual cleanup / orphan removal) ───────
// Withdraws all liquidity + fees and closes the position. Clears any state pointer that
// referenced it. Useful to clear an orphaned wall left by a race, or to wind down.
async function closePosition({ mint } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  if (!mint) throw new Error("mint required");
  const conn = connection();
  const { txs } = await engine.buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: mint, slippageBps: getConfig().slippageBps });
  const sigs = [];
  for (const t of txs) sigs.push(await signSend(conn, t));
  const st = getState();
  if (st.wallMint === mint) setState({ wallMint: null });
  if (st.positionMint === mint) setState({ positionMint: null });
  if (st.sol_positionMint === mint) setState({ sol_positionMint: null });
  await notify(`🧹 <b>Liquidity vault — position closed</b>\n${tok().symbol} · <code>${mint.slice(0, 8)}…</code>`);
  return { enabled: true, action: "closed", mint, sigs };
}

// ── Status (for the gated admin endpoint) ────────────────────────────────────
async function status() {
  const cfg = getConfig();
  const st = getState();
  const out = {
    enabled: isEnabled(),
    operator: isEnabled() ? operator().publicKey.toBase58() : null,
    paused: !!st.paused,
    mode: st.mode || "custom",
    tilt: st.tilt || null,
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
    try { out.costs = await costs(); } catch (e) { out.costs = { error: e.message }; }
    try { out.earnings = await earnings(); } catch (e) { out.earnings = { error: e.message }; }
    // Net P&L = LP fees earned (realized + pending) − tx-fee cost of running it.
    const earned = out.earnings && typeof out.earnings.totalEarnedUsd === "number" ? out.earnings.totalEarnedUsd : null;
    const spent = out.costs && out.costs.lifetime && typeof out.costs.lifetime.usd === "number" ? out.costs.lifetime.usd : null;
    out.netPnlUsd = (earned != null && spent != null) ? earned - spent : null;
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
  try { positions = await engine.listPositions(operator().publicKey.toBase58(), tok()); }
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

module.exports = {
  // Explicit-projectId helpers (default to "clkn" outside a scope).
  isEnabled, operatorPubkey, operatorPubkeys,
  getConfig, setConfig,
  listProjects, getProject, registerProject, removeProject,
  DEFAULT_CONFIG,
  // Project-scoped operations — each runs inside its project's ALS context, so all
  // the internal getConfig()/getState()/operator()/tok() calls resolve to it.
  tick: (o = {}) => withProject(o.projectId, () => tick(o)),
  tickAskWall: (o = {}) => withProject(o.projectId, () => tickAskWall(o)),
  tickSol: (o = {}) => withProject(o.projectId, () => tickSol(o)),
  rebalanceInventory: (o = {}) => withProject(o.projectId, () => rebalanceInventory(o)),
  rebalancePools: (o = {}) => withProject(o.projectId, () => rebalancePools(o)),
  manualSwap: (o = {}) => withProject(o.projectId, () => manualSwap(o)),
  createPool: (o = {}) => withProject(o.projectId, () => createPool(o)),
  closePosition: (o = {}) => withProject(o.projectId, () => closePosition(o)),
  status: (projectId) => withProject(projectId, () => status()),
  costs: (projectId) => withProject(projectId, () => costs()),
  earnings: (projectId) => withProject(projectId, () => earnings()),
  publicPositions: (projectId) => withProject(projectId, () => publicPositions()),
  listModes: (projectId) => withProject(projectId, () => listModes()),
  previewMode: (name, tilt, projectId) => withProject(projectId, () => previewMode(name, tilt)),
  applyMode: (name, tilt, projectId) => withProject(projectId, () => applyMode(name, tilt)),
  pause: (projectId) => withProject(projectId, () => pause()),
  resume: (projectId) => withProject(projectId, () => resume()),
};
