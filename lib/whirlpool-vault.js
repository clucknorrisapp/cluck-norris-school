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
const { PublicKey, Keypair, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const engine = require("./orca-whirlpools"); // also the source of venue-independent constants (mints, DEFAULT_TOKEN)
// ── Multi-venue engine selection ─────────────────────────────────────────────
// Both adapters expose the SAME interface (discoverPools/getPoolState/suggestRanges/
// quote/listPositions/buildOpenPosition/buildClosePosition), so a project on EITHER
// venue is managed by identical vault logic. The active venue is carried in the ALS
// scope (project.venue) and resolved per-call by eng(). CLKN/everything defaults to
// orca, so this is byte-for-byte unchanged for existing projects.
const ENGINES = { orca: engine, raydium: require("./raydium-clmm") };
// The active venue's adapter, resolved ONCE per project scope and stashed in the ALS
// store by withProject(). Outside any scope (or if unset) it defaults to orca.
function eng() { const s = als.getStore(); return (s && s.eng) || engine; }
const kv = require("./kvstore");
const { buybackDecision } = require("./engine-decisions"); // pure gate logic, replayable by scripts/engine-sim-test.cjs
const { AsyncLocalStorage } = require("async_hooks");

// Multi-tenant scope: the active project for the current async call tree. The public
// functions run inside als.run({ projectId, tok }), and every resolver below defaults
// to this scope — so the existing bare getConfig()/getState()/operator() calls become
// project-scoped with no edits, and it's concurrency-safe (each call tree has its own
// store). Outside any scope it defaults to "clkn", so nothing is changed by default.
const als = new AsyncLocalStorage();
function pid() { const s = als.getStore(); return (s && s.projectId) || "clkn"; }
function tok() { const s = als.getStore(); return (s && s.tok) || engine.DEFAULT_TOKEN; }
function venue() { const s = als.getStore(); return (s && s.venue) || "orca"; }

const STATE_KEY = "wpVaultState";
const CONFIG_KEY = "wpVaultConfig";

const DEFAULT_CONFIG = {
  pair: "CLKN/USDC",
  baseEnabled: true,        // run the dual-sided balanced BASE position. Set false for a
                            // single-sided-only project (ask wall only — e.g. ROSE on Raydium,
                            // whose two-sided depth is the locked Burn & Earn base).
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
  // CLKN/cbBTC vault — an OPTIONAL separate balanced position in the CLKN/cbBTC pool, to
  // sit on the BTC-driven arbitrage between pools. Own state namespace (btc_*), funded from
  // cbBTC + CLKN. OFF by default. cbBTC = Coinbase wrapped BTC (8 decimals).
  btcEnabled: false,
  btcFeeTierPct: 0.3,          // the 0.30% tier
  btcWidthPct: 10,             // ±10% balanced range
  btcMaxBtc: 0.02,             // hard cap on cbBTC deployed into the position (~$1.2k at $60k)
  btcDeployThreshold: 0.0005,  // re-center the cbBTC pool to absorb this much+ of newly-available cbBTC
  btcMaxDevPct: 8,             // external-market guard: skip acting if the pool's implied CLKN/USD
                               // deviates >this% from the true market price (the pool is thin/self-seeded
                               // → cheap to push, so never re-center liquidity at a manipulated price)
  // CLKN/JUP vault — an OPTIONAL separate balanced position in the CLKN/JUP pool, to
  // sit on the JUP-driven arbitrage between pools. Own state namespace (jup_*), funded from
  // JUP + CLKN. OFF by default. JUP = Jupiter governance token (6 decimals).
  jupEnabled: false,
  jupFeeTierPct: 0.3,          // the 0.30% tier
  jupWidthPct: 10,             // ±10% balanced range
  jupMaxJup: 1500,             // hard cap on JUP deployed into the position
  jupDeployThreshold: 30,      // re-center the JUP pool to absorb this much+ of newly-available JUP
  notifyRolls: true,           // false = routine open/re-center events DON'T post to Telegram
                               // (console-logged only). Funding/error alerts always post.
  clknFeeTierPct: 0.05,        // fee tier for a <token>/CLKN pool (non-CLKN projects pairing
                               // against the brand token; used by create-pool + anchors)
  jupMaxDevPct: 8,             // external-market guard: skip acting if the pool's implied CLKN/USD
                               // deviates >this% from the true market price (the pool is thin/self-seeded
                               // → cheap to push, so never re-center liquidity at a manipulated price)
  // Pool scale-up trickle (evenPools; owner, 2026-08-31): while the three pools are
  // BALANCED, convert a small clip of idle project-token inventory into USDC each
  // cycle — grows the quote base so the balance-driven sizing scales all pools up.
  // Impact-guarded so it never dumps into thin books. 0 = off (the default; requires
  // tokenSellOk on the project — never applicable to the CLKN brand bag).
  scaleUpUsdPerCycle: 0,
  scaleUpDailyCapUsd: 150,
  // Recoup carve-out (owner, 2026-08-31, revising the blanket never-sell rule): when a
  // tight-quoting engine ABSORBS someone's sell, it may sell that absorbed inventory
  // back to rebuild quote funds — "those sells would show up on the chart anyway."
  // Scope: sells are allowed only ABOVE state.tokenBaselineUi (a snapshot of holdings
  // taken when the carve-out is armed via /vault/recoup-baseline); the pre-existing
  // bag below the baseline stays unsellable. OFF by default — with it off (or no
  // baseline recorded) the historic never-sell behavior is byte-identical.
  tokenRecoupEnabled: false,
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
  oorDwellSec: 300,             // OOR dwell (owner, 2026-08-28: "out of range, wait 5 mins, fix it"):
                                // a wick recrossing inside the dwell never rolls; staying out past it
                                // rolls IMMEDIATELY, bypassing anti-thrash.
  poolBalanceTolPct: 15,        // only rebalance when the two pools differ by more than this %
  maxSwapUsdPerCycle: 250,      // cap the value moved per cycle
  minSwapUsd: 15,               // don't bother with swaps smaller than this
  usdcFloor: 20,                // keep at least this much free USDC (don't drain it all to SOL)
  baseDeployThresholdUsd: 40,   // base re-centers to absorb free USDC above this
  // Buyback (the flywheel): use accumulated QUOTE (USDC the ask wall earned selling token
  // into demand) to buy the project token back — refilling token inventory / ask-wall ammo
  // and printing visible green. NEVER sells the token. OFF by default; supervised/dry-run.
  buybackEnabled: false,
  buybackReserveUsd: 0,         // dry powder kept BEYOND usdcFloor — never spent on buyback
  maxBuybackUsdPerCycle: 25,    // cap quote spent per buyback
  minBuybackUsd: 5,             // don't bother below this
  maxBuybacksPerDay: 4,
  buybackMinIntervalSec: 3600,  // ≥1h between buybacks — anti-thrash
  buybackSlippageBps: 200,      // token buys can be thinner — a touch more slippage room
  // Safe redeploy (staged relaunch after liquidity was pulled / pool went stale):
  redeployConvergePct: 1,       // engine pools must be within this % of the main LP before the full add
  redeploySeedWidthPct: 15,     // Stage-1 seed width — wide enough to straddle a stale tick AND reach market
  redeploySeedUsd: 80,          // Stage-1 base seed size (small — it absorbs the arb correction)
  redeploySeedSol: 0.3,         // Stage-1 SOL seed size
  redeployMaxWaitMin: 20,       // give up waiting for convergence after this; deploy anyway with a flag
  // Treasury DUAL-SLEEVE (cbBTC/SOL): a WIDE backbone (±solWidthPct) + a TIGHT aggressive
  // sleeve (±tightWidthPct) in the SAME pool, 50/50 by SOL budget. The tight sleeve uses a
  // volatility-aware, debounced re-center (only redeploys after sustained OOR AND cooled
  // vol, with a hard max-wait cap) so it never whipsaws during a trend. OFF by default;
  // only the treasury project turns it on (it replaces that project's single sol sleeve).
  dualSleeveEnabled: false,
  tightWidthPct: 0.6,           // the aggressive sleeve's half-width (wide uses solWidthPct)
  tightOorWaitSec: 3600,        // tight must be out-of-range this long before a vol-gated re-center
  tightVolCoolPct: 0.4,         // ...AND the recent (~1h) price range must be under this % to redeploy
  tightMaxWaitSec: 21600,       // hard cap: re-center the tight sleeve after this long OOR regardless
  // Concentration MODE (operator-switchable on command via concentrate()): controls the
  // concentrated sleeve's WIDTH and how much of the treasury sits in it vs the wide backbone.
  //   tight = ±tightWidthPct, concentrated = concTightFrac of capital
  //   mega  = ±megaWidthPct,  concentrated = concMegaFrac of capital (aggressive scalp)
  //   wide  = no concentrated sleeve; everything in the ±solWidthPct backbone (safe / step aside)
  // A wide floor (concWideFloorFrac) always stays in the backbone as the shock absorber.
  concMode: "tight",
  megaWidthPct: 0.2,            // mega sleeve half-width (±0.2%)
  concTightFrac: 0.5,           // concentrated allocation in "tight" mode
  concMegaFrac: 0.7,            // concentrated allocation in "mega" mode (capped by the wide floor)
  concWideFloorFrac: 0.3,       // minimum fraction kept in the wide backbone, always
};

// Resilient RPC with automatic failover (lib/rpc.js): a primary Helius 429 /
// outage rolls to a backup RPC instead of stalling the autonomous vault.
const { connection: rpcConnection } = require("./rpc");
function connection() { return rpcConnection("confirmed"); }

// ── Multi-tenant project registry ────────────────────────────────────────────
// Each project = one token + its quotes + a dedicated operator key + its own
// config/state. The built-in "clkn" project is special: it uses the LEGACY kv keys
// and MM_OPERATOR_SECRET, so CLKN is byte-for-byte unchanged by multi-tenancy
// (zero migration, zero risk). Additional projects get namespaced keys
// (wpVaultConfig:<id> / wpVaultState:<id>) and their own operator env var.
const PROJECTS_KEY = "wpProjects";
const DEFAULT_PROJECT = {
  id: "clkn", label: "Cluck Norris (CLKN)", symbol: "CLKN",
  tokenMint: engine.CLKN_MINT, quoteMints: [engine.USDC_MINT, engine.WSOL_MINT, engine.CBBTC_MINT, engine.JUP_MINT],
  operatorEnv: "MM_OPERATOR_SECRET", venue: "orca", active: true, builtin: true,
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
  // Preserve the existing venue on a partial update (this endpoint is register AND update),
  // matching how telegramChatId/ownerWallet fall back to prev.* below — otherwise omitting
  // venue on an unrelated update would silently flip the project back to orca.
  const venue = (rec.venue || prev.venue || "orca").toLowerCase();
  if (!ENGINES[venue]) throw new Error(`venue must be one of: ${Object.keys(ENGINES).join(", ")}`);
  all[rec.id] = {
    id: rec.id, label: rec.label || rec.id,
    symbol: (rec.symbol || rec.id).toUpperCase().slice(0, 10),
    tokenMint: rec.tokenMint,
    // Which DEX adapter manages this project (orca | raydium). Both expose the same
    // interface; the vault routes every engine call through the project's venue.
    venue,
    quoteMints: Array.isArray(rec.quoteMints) && rec.quoteMints.length ? rec.quoteMints : [engine.USDC_MINT, engine.WSOL_MINT],
    // Token decimals (default 9 = CLKN/SPL norm; pump.fun mints are 6). Preserved on
    // partial updates like venue/telegramChatId above.
    decimals: Number(rec.decimals) || Number(prev.decimals) || 9,
    operatorEnv: rec.operatorEnv || `MM_OPERATOR_SECRET_${rec.id.toUpperCase().replace(/-/g, "_")}`,
    // Optional per-project Telegram room (same bot, different chat). Falls back to the
    // main TELEGRAM_CHAT_ID. Lets each project's alerts post to its own community.
    telegramChatId: rec.telegramChatId != null ? String(rec.telegramChatId) : (prev.telegramChatId || null),
    // Wallet(s) that own this project — for the client portal's wallet-signature login
    // (comma-separated allowed). Read-only/control of THIS project only. Distinct from the
    // operator hot wallet (which holds the float). Set by admin.
    ownerWallet: rec.ownerWallet != null ? String(rec.ownerWallet) : (prev.ownerWallet || null),
    // Client/job tokens (owner, 2026-08-28): true = the engine may SELL this project's token
    // (manualSwap without the code-only override) — pool-balancing inventory, not a brand bag.
    // The built-in CLKN project can never carry this flag, so the brand stays unsellable.
    tokenSellOk: rec.tokenSellOk != null ? !!rec.tokenSellOk : !!prev.tokenSellOk,
    active: rec.active !== false,
  };
  kv.set(PROJECTS_KEY, all);
  // operatorEnv may have just changed — drop the cached keypair or operator() keeps
  // signing with the OLD wallet until the process restarts (bit the ROSE go-live:
  // the rebind onto the CUNA env looked applied while every tx still signed 7W3t…).
  _operators.delete(rec.id);
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

// Hard bounds for the safety-critical numerics. A config patch (admin-only, but the
// admin key is shared widely) must never be able to disable the guards that keep the
// autonomous vault from self-harming: slippage wide enough to invite a sandwich,
// deploying ~100% of the float, or neutering the anomaly / anti-thrash guards.
const CONFIG_BOUNDS = {
  slippageBps:             [1, 500],
  swapSlippageBps:         [1, 500],
  buybackSlippageBps:      [1, 500],
  oorDwellSec:             [0, 3600],
  deployFrac:              [0.01, 0.97],
  askWallClknFraction:     [0.01, 1],
  priceGapGuardPct:        [1, 50],
  btcMaxDevPct:            [1, 50],
  btcWidthPct:             [0.5, 90],
  jupMaxDevPct:            [1, 50],
  jupWidthPct:             [0.5, 90],
  minRebalanceIntervalSec: [300, 86400],
  buybackMinIntervalSec:   [300, 86400],
  maxActionsPerDay:        [1, 100000],   // effectively no daily cap (owner standing rule: no daily limits on the volume engines)
  scaleUpUsdPerCycle:      [0, 200],
  scaleUpDailyCapUsd:      [0, 1000],
  maxBuybacksPerDay:       [0, 100],
  maxSwapsPerDay:          [0, 100000],   // owner standing rule: no daily limits on volume engines (cap hit live 2026-09-01 with the balancer mid-convergence)
  tightWidthPct:           [0.05, 50],
  tightOorWaitSec:         [60, 86400],
  tightVolCoolPct:         [0.05, 20],
  tightMaxWaitSec:         [600, 172800],
  megaWidthPct:            [0.05, 50],
  concTightFrac:           [0, 0.95],
  concMegaFrac:            [0, 0.95],
  concWideFloorFrac:       [0.05, 1],
};
function clampConfigNum(k, v, fallback) {
  let n = Number(v);
  if (!Number.isFinite(n)) return fallback;      // reject NaN / Infinity — keep prior value
  const b = CONFIG_BOUNDS[k];
  if (b) n = Math.min(b[1], Math.max(b[0], n));
  else if (n < 0) n = 0;                          // no negative numerics anywhere
  return n;
}
function setConfig(patch, projectId = pid()) {
  const prev = getConfig(projectId);
  const next = { ...prev, ...(patch || {}) };
  // Keep only known keys, and coerce/clamp by the DEFAULT_CONFIG type so a malformed
  // or hostile patch can't inject junk or push a safety bound out of range.
  const clean = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (!(k in next)) continue;
    // null/undefined = "leave this key alone", NEVER a value. Coercing it wrote 0 into
    // usdcFloor/maxUsd, false into the enable flags and the string "null" into pair — which
    // is what the documented "write the key as null to drop a durable override" did to the
    // LIVE config (the override was dropped and the live value corrupted in the same call).
    if (next[k] === null || next[k] === undefined) { clean[k] = prev[k]; continue; }
    const t = typeof DEFAULT_CONFIG[k];
    if (t === "number")       clean[k] = clampConfigNum(k, next[k], prev[k]);
    else if (t === "boolean") clean[k] = (next[k] === true || next[k] === "true" || next[k] === 1 || next[k] === "1");
    else                      clean[k] = String(next[k]);
  }
  kv.set(cfgKey(projectId), clean);
  return clean;
}
function getState(projectId = pid()) { return kv.get(stateKey(projectId), {}) || {}; }
function setState(patch, projectId = pid()) { kv.set(stateKey(projectId), { ...getState(projectId), ...patch }); }

// Build the engine token context for a project, and run a function scoped to it.
function projectTok(id) {
  const p = getProject(id);
  if (!p) return engine.DEFAULT_TOKEN;
  // decimals: the PROJECT token's on-chain decimals. CLKN is 9, but pump.fun mints
  // (e.g. POKEAHOE) are 6 — a hardcoded 9 made manualSwap display/account the project
  // token 1000x off (chain-verified 2026-08-20: "362.5199 CLKN" vs 362,502 POKE).
  return { mint: p.tokenMint, symbol: p.symbol || (id === "clkn" ? "CLKN" : id.toUpperCase()), quoteMints: p.quoteMints, decimals: Number(p.decimals) || 9 };
}
function withProject(projectId, fn) {
  const id = projectId || "clkn";
  const p = getProject(id);
  const v = (p && p.venue) || "orca";
  return als.run({ projectId: id, tok: projectTok(id), venue: v, eng: ENGINES[v] || engine }, fn);
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
    willRecenter: changes.some((c) => ["widthPct", "askWallEnabled", "solEnabled", "askWallUpPct", "solWidthPct", "askWallClknFraction", "feeTierPct", "solFeeTierPct", "jupWidthPct", "jupFeeTierPct"].includes(c.key)),   // fee-tier changes force migration rolls — omitting them made the preview lie
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
  // telegramChatId "off" = explicit per-project MUTE (owner ask 2026-08-24: CUNA engine posts
  // in NO room). Checked before every fallback — including the alerts-to-main test window —
  // because the fallbacks are what re-routed muted posts into the wrong room twice.
  if (p && p.telegramChatId === "off") return null;
  // Temporary "route engine alerts to MAIN" test window: while the kv timestamp is in
  // the future, ALL engine alerts post to the main community chat instead of the
  // project's operator room. Self-reverts when the window passes — no restore needed,
  // and the kv flag persists across restarts.
  try { const until = Number(kv.get("engineAlertsToMainUntil", 0)) || 0; if (until > Date.now()) return process.env.TELEGRAM_CHAT_ID; } catch (_) {}
  return (p && p.telegramChatId) || process.env.TELEGRAM_CHAT_ID;
}
// DIGEST lane (owner retro item 4, 2026-08-28): routine flow — rolls, buybacks, rebalances —
// buffers here and flushes as ONE summary DM per project per hour (a quiet hour sends
// nothing). Funding problems, errors, and owner-invoked ops keep calling notify() directly
// and stay instant. The split is by call site, deliberately: no config knob to misconfigure.
async function notifyDigest(text) {
  const key = `notifyDigestBuf:${pid()}`;
  const buf = kv.get(key, []) || [];
  buf.push({ ts: Date.now(), text });
  kv.set(key, buf.slice(-80));
}
async function flushNotifyDigest({ force = false } = {}) {
  const key = `notifyDigestBuf:${pid()}`;
  const buf = kv.get(key, []) || [];
  if (!buf.length) return { flushed: 0 };
  const oldest = buf[0].ts;
  if (!force && Date.now() - oldest < 55 * 60 * 1000 && buf.length < 40) return { flushed: 0, pending: buf.length };
  const lines = buf.slice(-25).map((e) => e.text.replace(/\n/g, " · "));
  const text = `🧾 <b>${tok().symbol} engine — last hour</b> (${buf.length} event${buf.length === 1 ? "" : "s"})\n` + lines.join("\n");
  kv.set(key, []);
  await notify(text.slice(0, 3500));
  return { flushed: buf.length };
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

// ── Robust transaction confirmation [security review M3] ─────────────────────
// Poll signature status (searching tx history, so a tx that lands slightly late isn't
// missed) and distinguish CONFIRMED / FAILED / still-pending. A bare timeout is NOT
// reported as failure — the tx may still land — so it throws a DISTINCT error telling the
// caller to verify on-chain before retrying. This prevents double-acting on a tx that
// actually landed (the swap double-spend we hit). Confirming by signature status (not a
// post-fetched blockhash) also fixes the false-negative confirms.
async function confirmSig(conn, sig, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let s = null;
    try { s = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; } catch { /* transient RPC — keep polling */ }
    if (s) {
      if (s.err) throw new Error(`tx failed on-chain: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const timedOut = new Error(`confirm timeout — tx ${sig.slice(0, 8)}… may still land; VERIFY on-chain before retrying`);
  timedOut.confirmTimeout = true;   // TAGGED: callers must verify on-chain, never assume "failed"
  throw timedOut;
}

// ── Sign + submit a base64 transaction the engine built (owner = operator) ───
// The engine already partial-signed any ephemeral signers (e.g. the position NFT
// mint); we just add the operator's fee-payer/authority signature and send.
async function signSend(conn, txBase64) {
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(operator());
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSig(conn, sig);
  await recordTxFee(conn, sig);
  // signSend only carries position open/close/create txs — a position just changed, so bust
  // the engine's position cache; the next routine in this tick re-reads fresh, never stale.
  try { eng().invalidatePositions?.(operator().publicKey.toBase58()); } catch (_) {}
  return sig;
}

// ── Did a send fail because CONFIRMATION timed out (vs. failing on-chain)? ───
// confirmSig tags that one case: the tx MAY STILL LAND, so a caller must verify on-chain
// rather than assume "failed" and act again (the duplicate-open / double-spend class).
// Message-matched as a fallback for an error that crossed a module boundary.
function isConfirmTimeout(e) {
  return !!(e && (e.confirmTimeout === true || /confirm timeout/i.test(String((e && e.message) || ""))));
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
      const txi = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
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
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); } catch { /* best effort */ }
  // CLKN/USD from any CLKN/USDC position; SOL/USD from the CLKN/SOL position (fallback: Jupiter).
  const usdcPos = positions.find((p) => p.quoteSymbol === "USDC");
  let clknUsd = usdcPos ? usdcPos.currentPriceClkn : 0;
  const solPos = positions.find((p) => p.quoteSymbol === "SOL");
  let solUsd = (solPos && solPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / solPos.currentPriceClkn : 0;
  if (!solUsd) solUsd = (await solPriceUsd()) || 0;
  // Fallback: a project with no USDC pool (treasury cbBTC/SOL) has clknUsd=0 from pools —
  // price the token via Jupiter so earned fees don't read $0. (Here "token" may be cbBTC.)
  if (clknUsd <= 0) {
    try { const px = await jupPriceUsdMap([tok().mint, engine.WSOL_MINT]); clknUsd = Number(px[tok().mint] && px[tok().mint].usdPrice) || 0; if (!solUsd) solUsd = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice) || 0; } catch { /* */ }
  }
  // JUP/USD — for the CLKN/JUP pool's current-price + dashboard range gauge.
  const jupPos = positions.find((p) => p.quoteSymbol === "JUP");
  let jupUsd = (jupPos && jupPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / jupPos.currentPriceClkn : 0;
  if (!jupUsd) { try { const px = await jupPriceUsdMap([engine.JUP_MINT]); jupUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice) || 0; } catch { /* */ } }

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
    prices: { clknUsd, solUsd, jupUsd },
    pending: { clkn: pClkn, usdc: pUsdc, sol: pSol, usd: pendingUsd },
    realized: { clkn: rClkn, usdc: rUsdc, sol: rSol, usd: realizedUsd },
    totalEarnedUsd: pendingUsd + realizedUsd,
  };
}

// ── LP-vs-HODL telemetry (read-only) ─────────────────────────────────────────
// The one honest "is the engine winning?" number for the Orca/Raydium vault —
// earnings() counts fees and netPnlUsd nets tx costs, but NEITHER sees impermanent
// loss (the dominant cost in practice: the Meteora JUP/USDC run earned ~$400 in
// fees but only grew ~$150). This ports the proven Meteora pattern (server.js
// jupLpVsHodl) per project: snapshot the wallet's TOTAL token basket (positions +
// pending fees + free float) as the baseline, then compare "basket now, priced
// now" vs "baseline basket, priced now". The gap = fees − IL − tx costs, all in.
// Because the basket spans positions AND float, the vault's own opens/closes/swaps
// don't jump the number (they're value-preserving at the moment they happen) —
// only IL drift, fee income, and EXTERNAL deposits/withdrawals move it. External
// step-changes are caught by the daily check below and trigger a re-baseline.
// Never touches funds; pure accounting.
async function lpVsHodl({ reset = false, record = false } = {}) {
  if (!operator()) return { project: pid(), skipped: "no operator key for this project" };
  const conn = connection();
  const st = getState();
  let positions = [];
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); } catch { /* best effort */ }
  const float = await getFloat(conn);

  // Prices — same resolution order as earnings(): pool-implied first, Jupiter fallback.
  const usdcPos = positions.find((p) => p.quoteSymbol === "USDC");
  let tokUsd = usdcPos ? usdcPos.currentPriceClkn : 0;
  const solPos = positions.find((p) => p.quoteSymbol === "SOL");
  let solUsd = (solPos && solPos.currentPriceClkn > 0 && tokUsd > 0) ? tokUsd / solPos.currentPriceClkn : 0;
  if (!solUsd) solUsd = (await solPriceUsd()) || 0;
  if (tokUsd <= 0) {
    try { const px = await jupPriceUsdMap([tok().mint]); tokUsd = Number(px[tok().mint] && px[tok().mint].usdPrice) || 0; } catch { /* */ }
  }
  const jupPos = positions.find((p) => p.quoteSymbol === "JUP");
  let jupUsd = (jupPos && jupPos.currentPriceClkn > 0 && tokUsd > 0) ? tokUsd / jupPos.currentPriceClkn : 0;
  const needBtc = (float.btc || 0) > 0.000001 || positions.some((p) => p.quoteSymbol === "cbBTC");
  let btcUsd = 0;
  if (!jupUsd || needBtc) {
    try {
      const px = await jupPriceUsdMap([engine.JUP_MINT, engine.CBBTC_MINT]);
      if (!jupUsd) jupUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice) || 0;
      btcUsd = Number(px[engine.CBBTC_MINT] && px[engine.CBBTC_MINT].usdPrice) || 0;
    } catch { /* */ }
  }
  const prices = { tokUsd, solUsd, jupUsd, btcUsd };

  // Current basket = free float + every position's token amounts + pending fees.
  const totals = { token: float.clkn, sol: float.sol, usdc: float.usdc, jup: float.jup, btc: float.btc };
  for (const p of positions) {
    totals.token += (Number(p.tokenAmount) || 0) + (Number(p.pendingFeeClkn) || 0);
    const q = (Number(p.quoteAmount) || 0) + (Number(p.pendingFeeQuote) || 0);
    if (p.quoteSymbol === "USDC") totals.usdc += q;
    else if (p.quoteSymbol === "SOL") totals.sol += q;
    else if (p.quoteSymbol === "JUP") totals.jup += q;
    else if (p.quoteSymbol === "cbBTC") totals.btc += q;
  }
  for (const k of Object.keys(totals)) totals[k] = Number(totals[k].toFixed(6));
  const value = (b) => (b.token || 0) * tokUsd + (b.sol || 0) * solUsd + (b.usdc || 0) + (b.jup || 0) * jupUsd + (b.btc || 0) * btcUsd;
  const lpNowUsd = value(totals);

  let base = st.hodlBase || null;
  if (reset || !base) {
    base = { ...totals, ts: Date.now(), prices, valueUsd: Number(lpNowUsd.toFixed(2)) };
    setState({ hodlBase: base, hodlLastDiff: 0, hodlLastDiffTs: Date.now() });
    return {
      project: pid(), baselineSet: true, baseline: base, totals, prices,
      lpNowUsd: Number(lpNowUsd.toFixed(2)), hodlNowUsd: Number(lpNowUsd.toFixed(2)),
      lpVsHodlUsd: 0, pct: 0, sinceTs: base.ts, ageH: 0, positions: positions.length,
    };
  }
  const hodlNowUsd = value(base);
  const diff = lpNowUsd - hodlNowUsd;
  const out = {
    project: pid(), baseline: base, totals, prices,
    lpNowUsd: Number(lpNowUsd.toFixed(2)), hodlNowUsd: Number(hodlNowUsd.toFixed(2)),
    lpVsHodlUsd: Number(diff.toFixed(2)),
    pct: hodlNowUsd > 0 ? Number(((diff / hodlNowUsd) * 100).toFixed(3)) : 0,
    sinceTs: base.ts, ageH: Number(((Date.now() - base.ts) / 3600000).toFixed(1)),
    lastDiff: st.hodlLastDiff != null ? st.hodlLastDiff : null,   // previous recorded diff (for the step-change guard)
    positions: positions.length,
  };
  if (record) setState({ hodlLastDiff: out.lpVsHodlUsd, hodlLastDiffTs: Date.now() });
  return out;
}

// Daily LP-vs-HODL verdict — DMs the project's own chat once per 24h (checked hourly
// from server.js). Auto-seeds the baseline on first run; a step-change in the diff
// bigger than HODL_JUMP_USD between checks means an external deposit/withdrawal
// (the vault's own ops can't move the diff that fast) → re-baseline with a note
// instead of reporting a lie. Read-only: config/state writes only, never positions.
const HODL_JUMP_USD = 250;   // override via kv wpLpHodlJumpUsd
async function lpVsHodlDaily({ extras = "" } = {}) {
  const now = Date.now();
  const st0 = getState();
  if (now - (st0.hodlCheckAt || 0) < 24 * 3600 * 1000) return { skipped: "checked <24h ago" };
  const r = await lpVsHodl({ record: true });
  if (r.skipped) return r;
  if (r.baselineSet) {
    setState({ hodlCheckAt: now });
    if (r.lpNowUsd >= 50) await notify(`📊 <b>LP-vs-HODL telemetry armed</b> (${pid()}) — baseline basket $${r.lpNowUsd.toFixed(0)}. First verdict after 24h of data.`);
    return { seeded: true, ...r };
  }
  if (r.lpNowUsd < 50 && r.hodlNowUsd < 50) { setState({ hodlCheckAt: now }); return { skipped: "basket too small" }; }
  if (r.ageH < 24) return { skipped: "baseline <24h old" };      // no hodlCheckAt → retries hourly, first verdict lands on time
  const jumpLimit = Number(kv.get("wpLpHodlJumpUsd", 0)) || HODL_JUMP_USD;
  if (r.lastDiff != null && Math.abs(r.lpVsHodlUsd - r.lastDiff) > jumpLimit) {
    const jump = r.lpVsHodlUsd - r.lastDiff;
    await lpVsHodl({ reset: true });
    setState({ hodlCheckAt: now });
    await notify(
      `📊 <b>Engine LP-vs-HODL (${pid()})</b> — basket step-change of ${jump >= 0 ? "+" : "−"}$${Math.abs(jump).toFixed(0)} since the last check (deposit/withdrawal likely). ` +
      `Re-baselined — verdicts resume after 24h of fresh data. Last clean reading: ${r.lastDiff >= 0 ? "+" : "−"}$${Math.abs(r.lastDiff).toFixed(2)}.`
    );
    return { rebaselined: true, jump: Number(jump.toFixed(2)) };
  }
  setState({ hodlCheckAt: now });
  const win = r.lpVsHodlUsd >= 0;
  await notify(
    `📊 <b>Engine vs HODL — daily verdict (${pid()})</b>\n` +
    `${win ? "✅" : "⚠️"} <b>${win ? "+" : "−"}$${Math.abs(r.lpVsHodlUsd).toFixed(2)}</b> (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%) over ${r.ageH.toFixed(0)}h · ${r.positions} position(s)\n` +
    `basket now $${r.lpNowUsd.toFixed(0)} vs if-held $${r.hodlNowUsd.toFixed(0)}` +
    (extras ? `\n${extras}` : "") + `\n` +
    (win ? "Fees are beating impermanent loss. 👍" : "IL is eating fees — wider bands / fewer recenters is the lever.") +
    `\n<i>after any manual deposit/withdrawal: &reset=1 on /api/whirlpool/vault/lp-vs-hodl</i>`
  );
  return { dmed: true, ...r };
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
  let clkn = 0, usdc = 0, btc = 0, jup = 0;
  // BOTH token programs (CLAUDE.md balance rule; audit F9): a Token-2022 project token
  // read only through the legacy program silently shows a zero float and the engine
  // refuses to deploy a wallet that is actually funded.
  const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  for (const programId of PROGRAMS) {
    let resp;
    try { resp = await conn.getParsedTokenAccountsByOwner(op, { programId: new PublicKey(programId) }); }
    catch (e) { if (programId === PROGRAMS[0]) throw e; continue; /* 2022 read best-effort */ }
    for (const { account } of resp.value) {
      const info = account.data?.parsed?.info;
      if (!info) continue;
      const ui = Number(info.tokenAmount?.uiAmount || 0);
      if (info.mint === tok().mint) clkn += ui;
      else if (info.mint === engine.USDC_MINT) usdc += ui;
      else if (info.mint === engine.CBBTC_MINT) btc += ui;
      else if (info.mint === engine.JUP_MINT) jup += ui;
    }
  }
  return { sol, clkn, usdc, btc, jup };
}

async function resolvePoolAddress(cfg) {
  const t = tok();
  // Derive the pool address directly (works for brand-new pools the Orca API hasn't
  // indexed yet). Quote is read off the pair label; fall back to API discovery.
  const quoteSym = String(cfg.pair || "").split("/")[1] || "USDC";
  const quoteMint = quoteSym === "SOL" ? engine.WSOL_MINT : quoteSym === "BTC" ? engine.CBBTC_MINT : quoteSym === "JUP" ? engine.JUP_MINT : quoteSym === "CLKN" ? engine.CLKN_MINT : engine.USDC_MINT;
  try {
    const addr = eng().poolAddressFor({ tokenMint: t.mint, quoteMint, feeTierPct: cfg.feeTierPct });
    await eng().getPoolState(addr, null, t); // verify it exists on-chain
    return addr;
  } catch (_) {
    const pools = await eng().discoverPools(t);
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
  // Single-sided mode: skip the dual-sided balanced base entirely so the engine only
  // runs the ask wall (e.g. a single-sided position on a pool whose two-sided depth is
  // already provided elsewhere — like ROSE's permanently-locked Burn & Earn base).
  if (cfg.baseEnabled === false) {
    // Single-sided mode: the dual-sided base is off. If a base position is still open from
    // before it was disabled, close it ONCE (withdraw + collect fees) so capital isn't left
    // stranded in an unmanaged range; then no-op.
    if (st.positionMint) {
      if (dryRun) return { enabled: true, action: "would-close-base", reason: "base disabled — would close the stranded base position" };
      try {
        const conn = connection();
        const positions = await eng().listPositions(operator().publicKey.toBase58(), tok());
        const managed = positions.find((p) => p.positionMint === st.positionMint);
        if (managed) {
          accrueRealizedFees(managed); // bank the fees the close collects
          const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.positionMint, slippageBps: cfg.slippageBps });
          const sigs = [];
          for (const t of txs) sigs.push(await signSend(conn, t));
          setState({ positionMint: null, lastTickTs: Date.now() });
          return { enabled: true, action: "closed-base", reason: "base disabled — closed stranded base position", sigs };
        }
        setState({ positionMint: null }); // already gone on-chain — just clear the pointer
      } catch (e) {
        // RPC cold / rate-limited — keep positionMint and retry the close next tick.
        setState({ lastTickTs: Date.now() });
        return { enabled: true, action: "skip", reason: `base disabled; close deferred (${e.message})` };
      }
    }
    // Stamp lastTickTs — tick() is the sole writer, and the boot-tick redeploy guard
    // (server.js) keys off it. Without this a single-sided project fires a full cold
    // cycle on every redeploy.
    setState({ lastTickTs: Date.now() });
    return { enabled: true, action: "none", reason: "base position disabled (single-sided mode)" };
  }

  const conn = connection();
  const address = await resolvePoolAddress(cfg);
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
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
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) { setState({ lastTickTs: Date.now() }); return { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, action: "skip", reason: "position lookup failed — retrying next tick" }; }
  const managed = positions.find((p) => p.positionMint === st.positionMint);
  // Free USDC the swap layer has staged — used to auto-absorb new capital into the base.
  let preFloat = { usdc: 0 };
  try { preFloat = await getFloat(conn); } catch { /* best effort */ }

  let needRoll = false, reason = "", forceRoll = false;
  if (!managed) {
    if (st.positionMint && await positionStillOpen(conn, st.positionMint)) return MISSED_LISTING("managed position");
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
    if (frac < 0 || frac > 1) {
      // OOR DWELL — owner's standing order 2026-08-28: "out of range, wait 5 mins, fix it".
      const dwell = (cfg.oorDwellSec != null ? cfg.oorDwellSec : 300);
      if (!st.oorSince) { setState({ oorSince: Date.now() }); reason = `out of range — dwell ${dwell}s started`; }
      else if ((Date.now() - st.oorSince) / 1000 < dwell) { reason = `out of range — dwelling ${Math.round((Date.now() - st.oorSince) / 1000)}/${dwell}s`; }
      else { needRoll = true; forceRoll = true; reason = "out of range (dwell passed)"; }
    }
    else if (widthOff > 0.2) { needRoll = true; forceRoll = true; reason = `width reconfig → ±${cfg.widthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across range)`; }
    else if (cfg.swapEnabled && preFloat.usdc >= cfg.usdcFloor + cfg.baseDeployThresholdUsd) {
      // Staged quote only justifies a roll when there's idle CLKN to PAIR it — the open
      // binds to the smaller side, so unpaired quote would roll forever (the close releases
      // it straight back to the wallet). min(sides) is what actually deploys.
      const stagedUsd = preFloat.usdc - cfg.usdcFloor;
      const pairUsd = (preFloat.clkn || 0) * price;
      // Meaningful-refill gate (2026-08-28): every deploy leaves ~5% leftovers (deployFrac), and
      // leftovers above the bare threshold plus a pacing bypass = a roll-every-tick decay loop
      // (burned 30 dayActions in 20 min tonight). Only a refill ≥2× threshold — which leftovers
      // can never reach — skips the anti-thrash clock; dribbles roll on the normal pacing.
      // ROOM gate (2026-09-02): a roll only helps if the reopen can take MORE quote than the
      // position already holds. Quote at/above the cap re-fired "deploying staged USDC" every
      // tick with nothing to gain — the reopen landed at the same cap and the float stayed.
      const roomUsd = Math.max(0, (cfg.maxUsd || 0) - (managed.quoteAmount || 0));
      if (deployBlockedFat("base")) { reason = `in range; $${stagedUsd.toFixed(0)} staged but base is the FAT pool — float reserved for the lean pool (evenness gate)`; }
      else if (roomUsd < cfg.baseDeployThresholdUsd) { reason = `in range; $${stagedUsd.toFixed(0)} staged but the position is at its cap ($${Math.round(cfg.maxUsd)}) — waiting for the cap to grow`; }
      else if (Math.min(stagedUsd, pairUsd) >= cfg.baseDeployThresholdUsd) { needRoll = true; forceRoll = Math.min(stagedUsd, pairUsd) >= 2 * cfg.baseDeployThresholdUsd; reason = `deploying staged USDC ($${stagedUsd.toFixed(0)} above reserve)`; }
      else { reason = `in range; $${stagedUsd.toFixed(0)} staged USDC unpaired (only $${pairUsd.toFixed(0)} CLKN idle) — holding`; }
    }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, price, pair: cfg.pair, feeTierPct: cfg.feeTierPct, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };

  if (!needRoll) { setState({ lastPrice: price, lastTickTs: Date.now(), ...(st.oorSince && base.inRange ? { oorSince: null } : {}) }); return { ...base, action: "hold", reason }; }

  // Anti-thrash + daily cap. Gate ROLLS and REOPENS (anything where we already
  // believe a position exists, via st.positionMint) — only a genuine first-ever
  // open (no positionMint on record) skips the timer. This stops a restart from
  // "reopening" a position that was actually rolled moments ago.
  const sinceLast = st.lastRebalanceTs ? (Date.now() - st.lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.positionMint) && !forceRoll && sinceLast < cfg.minRebalanceIntervalSec) {
    setState({ lastPrice: price, lastTickTs: Date.now() });
    return { ...base, action: "deferred", reason: `${reason}, but only ${Math.round(sinceLast)}s since last roll (min ${cfg.minRebalanceIntervalSec}s)` };
  }
  // URGENT rolls (OOR-past-dwell / meaningful refills — forceRoll) get a bounded 2× emergency
  // ceiling instead of a hard freeze (owner's standing order 2026-08-28: an out-of-range pool
  // must be fixable even after routine rolls spent the day budget). Routine rolls stop at 1×.
  if (dayActions >= (forceRoll ? 2 * cfg.maxActionsPerDay : cfg.maxActionsPerDay)) {
    setState({ lastPrice: price, lastTickTs: Date.now() });
    return { ...base, action: "capped", reason: `daily action cap (${cfg.maxActionsPerDay}${forceRoll ? " ×2 emergency" : ""}) reached` };
  }

  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  // 1) Close the existing position (withdraw + collect fees) if present.
  if (managed) {
    accrueRealizedFees(managed); // the close collects these fees → bank them as realized
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    // VERIFY THE CLOSE LANDED before clearing the pointer (audit F1): a confirmed-looking
    // close that didn't actually remove the position (duplicate-sig aliasing, state race)
    // is how the $355 orphan was minted — state moved on while the old NFT stayed live.
    // One fresh read (signSend just busted the cache); on ANY doubt, abort the roll —
    // the pointer stays valid and the next tick retries cleanly.
    const still = await eng().listPositions(operator().publicKey.toBase58(), tok());
    if (still.some((q) => q.positionMint === st.positionMint)) {
      setState({ lastPrice: price, lastTickTs: Date.now(), dayActions, dayStamp: today });
      throw new Error(`close did not land — position ${st.positionMint.slice(0, 8)}… still on-chain; roll aborted, will retry`);
    }
    setState({ positionMint: null });
  }

  // 2) Open a fresh balanced position centered on current price.
  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const ranges = eng().suggestRanges(fresh, cfg.widthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Size: deploy up to deployFrac of USDC (capped at maxUsd); if that needs more
  // CLKN than we hold, fall back to sizing by our CLKN balance.
  const usdcDeploy = Math.min(Math.max(0, float.usdc - cfg.usdcFloor) * cfg.deployFrac, cfg.maxUsd);
  let inputMint = engine.USDC_MINT, inputAmount = usdcDeploy;
  if (usdcDeploy > 0) {
    const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.USDC_MINT, inputAmount: String(usdcDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
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

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let openSig; for (const t of built.txs) openSig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: openSig, positionMint: built.positionMint });
  setState({
    positionMint: built.positionMint, poolAddress: address,
    lowerPriceClkn: balanced.lowerPriceClkn, upperPriceClkn: balanced.upperPriceClkn,
    lastRebalanceTs: Date.now(), lastPrice: price, lastTickTs: Date.now(),
    dayActions, dayStamp: today, rebalanceCount: (st.rebalanceCount || 0) + 1,
  });

  if (cfg.notifyRolls !== false) await notifyDigest(
    `📊 <b>Liquidity vault — ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.pair} @ ${cfg.feeTierPct}% · price ${price.toPrecision(5)}\n` +
    `New range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\n` +
    `Reason: ${reason}\nPosition: <code>${built.positionMint.slice(0, 8)}…</code>`
  );
  return report;
}

// ── Anchor position (manual, owner-invoked): a tiny, ultra-wide, NEVER-auto-closed
// position that keeps a pool continuously quotable. When we pull the tight positions
// (and we own ~100% of these Orca pools), the pool would otherwise go empty/stale and
// a single trade could shove the price far off market — forcing a recenter-around-a-
// dislocated-price + settle wait on redeploy. A permanent wide anchor keeps an
// arbitrageable quote so price always tracks market; on restart it's already in-range.
// Pinned in st.anchorMints and excluded from autonomous adoption (see ask-wall stray
// filter). Orca-only (cheap wide single-position ranges). Ignores pause (manual op).
const ANCHOR_QUOTE_POOL = {
  USDC: (cfg) => ({ pair: cfg.pair, feeTierPct: cfg.feeTierPct }),
  SOL:  (cfg) => ({ pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct }),
  JUP:  (cfg) => ({ pair: `${tok().symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct }),
  CLKN: (cfg) => ({ pair: `${tok().symbol}/CLKN`, feeTierPct: cfg.clknFeeTierPct }),
};
async function openAnchor({ quoteSym, usd = 10, downPct = 85, upPct = 400, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const q = String(quoteSym || "").toUpperCase();
  const poolCfgFn = ANCHOR_QUOTE_POOL[q];
  if (!poolCfgFn) return { enabled: true, action: "error", reason: `unknown quote "${q}" — use USDC, SOL, JUP, or CLKN` };
  if (q === "CLKN" && tok().mint === engine.CLKN_MINT) return { enabled: true, action: "error", reason: "CLKN cannot quote itself" };
  const cfg = getConfig();
  const pc = poolCfgFn(cfg);
  const conn = connection();
  const address = await resolvePoolAddress(pc);
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;                 // CLKN price in quote units
  const rng = eng().suggestAnchorRange(pool, downPct, upPct);

  // Value CLKN in USD to size a ~$usd deposit. quoteUsd = USD per quote unit (1 for USDC).
  let quoteUsd = 1;
  if (q === "SOL") quoteUsd = (await solPriceUsd()) || 0;
  else if (q === "JUP") { try { const px = await jupPriceUsdMap([engine.JUP_MINT]); quoteUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice) || 0; } catch { quoteUsd = 0; } }
  else if (q === "CLKN") { try { const px = await jupPriceUsdMap([engine.CLKN_MINT]); quoteUsd = Number(px[engine.CLKN_MINT] && px[engine.CLKN_MINT].usdPrice) || 0; } catch { quoteUsd = 0; } }
  const clknUsd = price * quoteUsd;
  if (!(clknUsd > 0)) return { enabled: true, action: "error", reason: "could not price CLKN in USD (quote price unavailable)" };
  const clknInput = (Number(usd) || 10) / clknUsd;     // deposit ~$usd of CLKN; SDK pulls the matching quote

  const base = {
    enabled: true, quote: q, pair: pc.pair, feeTierPct: pc.feeTierPct, price,
    downPct: Number(downPct), upPct: Number(upPct), usdTarget: Number(usd) || 10,
    clknInput, range: { lowerPriceClkn: rng.lowerPriceClkn, upperPriceClkn: rng.upperPriceClkn },
  };

  // Pre-flight quote so the dry run shows both legs the open would actually pull.
  let est = null;
  try {
    const qte = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: tok().mint, inputAmount: String(clknInput), lowerTick: rng.lowerTick, upperTick: rng.upperTick, slippageBps: cfg.slippageBps });
    est = { maxClkn: Number(pool.clknIsA ? qte.maxA : qte.maxB), maxQuote: Number(pool.clknIsA ? qte.maxB : qte.maxA) };
  } catch (e) { est = { error: e.message }; }

  if (dryRun) return { ...base, action: "would-open-anchor", est };

  const float = await getFloat(conn);
  if (float.clkn < clknInput) return { ...base, action: "error", reason: `need ~${Math.round(clknInput).toLocaleString()} CLKN, wallet holds ${Math.round(float.clkn).toLocaleString()}` };

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: rng.lowerTick, upperTick: rng.upperTick, inputMint: tok().mint, inputAmount: String(clknInput), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);

  const st = getState();
  const anchorMints = Array.from(new Set([...(st.anchorMints || []), built.positionMint]));
  setState({ anchorMints });

  await notify(
    `⚓ <b>Anchor opened</b> — ${pc.pair} @ ${pc.feeTierPct}%\n` +
    `Ultra-wide −${Number(downPct)}% / +${Number(upPct)}% (${rng.lowerPriceClkn.toPrecision(3)} → ${rng.upperPriceClkn.toPrecision(3)})\n` +
    `~$${Number(usd) || 10} · NEVER auto-closed · keeps the pool quotable.\n` +
    `Position: <code>${built.positionMint.slice(0, 8)}…</code>`
  );
  return { ...base, action: "anchor-opened", sig, positionMint: built.positionMint, anchorMints };
}

// ── Sell-wall (manual, owner-invoked): a single-sided CLKN position placed at a CUSTOM
// band ABOVE the current pool (e.g. starting 8% above the base position's top). It holds
// CLKN only and sells it into the quote as price RUNS UP through the band — laddered
// take-profit / distribution that also cushions price impact on big buys. NOT dumping:
// a bounded, owner-sized amount, placed high. Pinned in st.anchorMints so the autonomous
// loop never adopts/closes it, and tracked in st.sellWalls. Ignores pause (manual op).
async function openWall({ quoteSym, usd = 500, lowerPriceClkn, upperPriceClkn, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const q = String(quoteSym || "USDC").toUpperCase();
  const poolCfgFn = ANCHOR_QUOTE_POOL[q];
  if (!poolCfgFn) return { enabled: true, action: "error", reason: `unknown quote "${q}" — use USDC, SOL, JUP, or CLKN` };
  const lo = Number(lowerPriceClkn), hi = Number(upperPriceClkn);
  if (!(lo > 0) || !(hi > lo)) return { enabled: true, action: "error", reason: "need lowerPriceClkn < upperPriceClkn (both > 0)" };
  const cfg = getConfig();
  const pc = poolCfgFn(cfg);
  const conn = connection();
  const address = await resolvePoolAddress(pc);
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;
  // Single-sided CLKN sell wall ⇒ the WHOLE band must sit above the current price.
  if (!(lo > price)) return { enabled: true, action: "error", reason: `sell wall must be ABOVE spot — lower ${lo} <= price ${price}` };
  const rng = eng().ticksForClknRange(pool, lo, hi);

  let quoteUsd = 1;
  if (q === "SOL") quoteUsd = (await solPriceUsd()) || 0;
  else if (q === "JUP") { try { const px = await jupPriceUsdMap([engine.JUP_MINT]); quoteUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice) || 0; } catch { quoteUsd = 0; } }
  else if (q === "CLKN") { try { const px = await jupPriceUsdMap([engine.CLKN_MINT]); quoteUsd = Number(px[engine.CLKN_MINT] && px[engine.CLKN_MINT].usdPrice) || 0; } catch { quoteUsd = 0; } }
  const clknUsd = price * quoteUsd;
  if (!(clknUsd > 0)) return { enabled: true, action: "error", reason: "could not price CLKN in USD" };
  const clknInput = (Number(usd) || 500) / clknUsd;

  const base = {
    enabled: true, quote: q, pair: pc.pair, feeTierPct: pc.feeTierPct, price, side: "clkn-sell-wall",
    usdTarget: Number(usd) || 500, clknInput,
    range: { lowerPriceClkn: rng.lowerPriceClkn, upperPriceClkn: rng.upperPriceClkn },
    vsSpot: { lowerPct: ((rng.lowerPriceClkn / price - 1) * 100), upperPct: ((rng.upperPriceClkn / price - 1) * 100) },
  };
  if (dryRun) return { ...base, action: "would-open-wall" };

  const float = await getFloat(conn);
  if (float.clkn < clknInput) return { ...base, action: "error", reason: `need ~${Math.round(clknInput).toLocaleString()} CLKN, wallet holds ${Math.round(float.clkn).toLocaleString()}` };

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: rng.lowerTick, upperTick: rng.upperTick, inputMint: tok().mint, inputAmount: String(clknInput), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);

  const st = getState();
  const anchorMints = Array.from(new Set([...(st.anchorMints || []), built.positionMint]));   // exclude from autonomous adoption/close
  const sellWalls = Array.from(new Set([...(st.sellWalls || []), built.positionMint]));
  setState({ anchorMints, sellWalls });

  await notify(
    `🧱 <b>Sell-wall opened</b> — ${pc.pair} @ ${pc.feeTierPct}%\n` +
    `CLKN-only ${rng.lowerPriceClkn.toPrecision(3)} → ${rng.upperPriceClkn.toPrecision(3)} (+${base.vsSpot.lowerPct.toFixed(0)}% to +${base.vsSpot.upperPct.toFixed(0)}% vs spot)\n` +
    `~$${Number(usd) || 500} (${Math.round(clknInput).toLocaleString()} CLKN) · sells into a run-up, cushions big-buy impact.\n` +
    `Position: <code>${built.positionMint.slice(0, 8)}…</code>`
  );
  return { ...base, action: "wall-opened", sig, positionMint: built.positionMint };
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
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;

  let positions = [], fetchOk = true;
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, wall: true, price, pair: cfg.pair, action: "skip", reason: "position lookup failed — retrying next tick" };
  let wall = positions.find((p) => p.positionMint === st.wallMint);
  if (!wall) {
    // Self-heal: if state lost track of the wall (e.g. a manual run racing the scheduler),
    // adopt the existing wall in THIS pool instead of stacking a duplicate. The wall may
    // share the base pool, so identify it by EXCLUDING the tracked base + SOL positions;
    // among any leftovers prefer the most ask-like (highest lower edge / above market).
    const stray = positions
      .filter((p) => p.pool === address && p.positionMint !== st.positionMint && p.positionMint !== st.sol_positionMint && !(st.anchorMints || []).includes(p.positionMint) && p.tokenAmount > 0)
      .sort((a, b) => b.lowerPriceClkn - a.lowerPriceClkn)[0];
    if (stray) {
      wall = stray;
      setState({ wallMint: stray.positionMint, wallLowerPrice: stray.lowerPriceClkn, wallUpperPrice: stray.upperPriceClkn });
    }
  }

  let needRoll = false, reason = "", forceRoll = false;
  if (!wall) {
    if (st.wallMint && await positionStillOpen(conn, st.wallMint)) return MISSED_LISTING("ask wall");
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
    // Use the resolved wall's mint (st.wallMint may be stale right after an adoption).
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: wall.positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    wallDayActions++;
    setState({ wallMint: null });
  }

  // Open a fresh tight single-sided CLKN ask band just above price.
  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const ranges = eng().suggestRanges(fresh, cfg.askWallUpPct);
  const askOpt = ranges.options.find((o) => o.id === "clkn");
  const float = await getFloat(conn);
  const clknDeploy = float.clkn * cfg.askWallClknFraction;
  if (!(clknDeploy > 0)) {
    setState({ wallLastRebalanceTs: Date.now(), wallDayActions, wallDayStamp: today });
    report.action = "no-clkn"; report.reason = "no free CLKN to deploy into the wall";
    await notify("📊 <b>Liquidity vault</b>: ask-wall wanted to (re)open but the wallet has no free CLKN. Add CLKN to fund it.");
    return report;
  }

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: askOpt.lowerTick, upperTick: askOpt.upperTick, inputMint: tok().mint, inputAmount: String(clknDeploy), slippageBps: cfg.slippageBps });
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

// ── CLKN/cbBTC balanced vault (optional) — sits on the BTC arbitrage ─────────
// A separate balanced position in the CLKN/cbBTC Whirlpool. As BTC/USD moves, CLKN/cbBTC
// misprices vs the CLKN/USDC + CLKN/SOL pools and arbitrageurs realign them — trading
// against this depth and paying us fees. Own state namespace ("btc_*"). Funded from cbBTC
// (the quote side) + CLKN. OFF by default. Because this pool is thin and self-seeded, it
// carries an EXTERNAL-market guard: it refuses to act when the pool's implied CLKN/USD has
// been pushed far from the true market price (so a manipulated tick can't get us to
// re-center liquidity at a bad price).
async function tickBtc({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.btcEnabled) return { enabled: true, action: "none", reason: "CLKN/cbBTC vault disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/BTC`, feeTierPct: cfg.btcFeeTierPct });
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote; // CLKN price in cbBTC

  // External-market guard (the thin-pool protection): compare the pool's implied CLKN/USD
  // to the true market. If it's been pushed beyond the tolerance, sit out — don't deploy.
  let btcUsd = 0;
  try { const px = await jupPriceUsdMap([engine.CBBTC_MINT]); btcUsd = Number(px[engine.CBBTC_MINT]?.usdPrice) || 0; } catch { /* */ }
  if (btcUsd > 0) {
    const impliedUsd = price * btcUsd;
    let mkt = 0; try { mkt = (await marketPriceUsd()).usd || 0; } catch { /* */ }
    if (mkt > 0) {
      const dev = Math.abs(impliedUsd - mkt) / mkt;
      if (dev > cfg.btcMaxDevPct / 100) {
        setState({ btc_lastPrice: price });
        return { enabled: true, pair: `${tok().symbol}/BTC`, feeTierPct: cfg.btcFeeTierPct, price, action: "none", reason: `pool ${(dev * 100).toFixed(1)}% off market (>${cfg.btcMaxDevPct}% guard) — skipping`, impliedUsd, marketUsd: mkt };
      }
    }
  }

  if (st.btc_lastPrice && st.btc_lastPrice > 0) {
    const gap = Math.abs(price - st.btc_lastPrice) / st.btc_lastPrice;
    if (gap > cfg.priceGapGuardPct / 100) {
      setState({ btc_lastPrice: price });
      return { enabled: true, action: "none", reason: `price gap ${(gap * 100).toFixed(1)}% > guard — skipping`, price };
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let dayActions = st.btc_dayStamp === today ? (st.btc_dayActions || 0) : 0;

  let positions = [], fetchOk = true;
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, pair: `${tok().symbol}/BTC`, feeTierPct: cfg.btcFeeTierPct, price, action: "skip", reason: "position lookup failed — retrying next tick" };
  const managed = positions.find((p) => p.positionMint === st.btc_positionMint);
  // Available cbBTC (no gas reserve — gas is SOL) — used to grow the pool when cbBTC is added.
  let preBtcFree = 0, preClknForBtc = 0;
  try { const f = await getFloat(conn); preBtcFree = f.btc; preClknForBtc = f.clkn || 0; } catch { /* best effort */ }

  let needRoll = false, reason = "", widthDriven = false, deployDriven = false;
  if (!managed) {
    if (st.btc_positionMint && await positionStillOpen(conn, st.btc_positionMint)) return MISSED_LISTING("cbBTC position");
    needRoll = true; reason = st.btc_positionMint ? "position gone — reopening" : "no CLKN/cbBTC position yet — opening";
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    const w = cfg.btcWidthPct / 100;
    const expRatio = (1 + w) / (1 - w);
    const posRatio = managed.lowerPriceClkn > 0 ? managed.upperPriceClkn / managed.lowerPriceClkn : expRatio;
    const widthOff = Math.abs(posRatio - expRatio) / expRatio;
    if (frac < 0 || frac > 1) { needRoll = true; reason = "out of range"; }
    else if (widthOff > 0.2) { needRoll = true; widthDriven = true; reason = `width reconfig → ±${cfg.btcWidthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across)`; }
    else if (preBtcFree > cfg.btcDeployThreshold) {
      // Pairing gate: unpaired quote must not trigger rolls (see base sleeve comment).
      if (preClknForBtc * price >= cfg.btcDeployThreshold) { needRoll = true; reason = `deploying available cbBTC (${preBtcFree})`; }
      else { reason = `in range; ${preBtcFree} cbBTC staged unpaired (CLKN idle too small) — holding`; }
    }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, pair: `${tok().symbol}/BTC`, feeTierPct: cfg.btcFeeTierPct, price, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };
  if (!needRoll) { setState({ btc_lastPrice: price }); return { ...base, action: "hold", reason }; }

  const sinceLast = st.btc_lastRebalanceTs ? (Date.now() - st.btc_lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.btc_positionMint) && !widthDriven && sinceLast < cfg.minRebalanceIntervalSec) { setState({ btc_lastPrice: price }); return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` }; }
  if (dayActions >= cfg.maxActionsPerDay) { setState({ btc_lastPrice: price }); return { ...base, action: "capped", reason: "daily cap reached" }; }
  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  if (managed) {
    accrueRealizedFees(managed); // bank the CLKN/cbBTC position's collected fees as realized
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.btc_positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ btc_positionMint: null });
  }

  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const ranges = eng().suggestRanges(fresh, cfg.btcWidthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Deploy from cbBTC (the quote side); fall back to CLKN if the cbBTC-sized position needs
  // more CLKN than we hold.
  const btcAvail = Math.max(0, float.btc);
  const btcDeploy = Math.min(btcAvail * cfg.deployFrac, cfg.btcMaxBtc);
  let inputMint = engine.CBBTC_MINT, inputAmount = btcDeploy;
  if (btcDeploy > 0) {
    const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.CBBTC_MINT, inputAmount: String(btcDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
    if (clknNeeded > float.clkn * cfg.deployFrac) { inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac; }
  } else if (float.clkn > 0) {
    inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac;
  } else {
    setState({ btc_lastPrice: price, btc_dayActions: dayActions, btc_dayStamp: today });
    report.action = "no-float"; report.reason = "no deployable cbBTC/CLKN";
    await notify(`📊 <b>Liquidity vault (${tok().symbol}/cbBTC)</b>: no deployable cbBTC/${tok().symbol} — fund cbBTC + ${tok().symbol}.`);
    return report;
  }

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: sig, positionMint: built.positionMint });
  setState({
    btc_positionMint: built.positionMint,
    btc_lowerPriceClkn: balanced.lowerPriceClkn, btc_upperPriceClkn: balanced.upperPriceClkn,
    btc_lastRebalanceTs: Date.now(), btc_lastPrice: price, btc_dayActions: dayActions, btc_dayStamp: today,
  });
  if (cfg.notifyRolls !== false) await notifyDigest(
    `📊 <b>Liquidity vault — ${tok().symbol}/cbBTC ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.btcFeeTierPct}% · price ${price.toPrecision(5)} cbBTC\n` +
    `Range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\nReason: ${reason}`
  );
  return report;
}

// ── CLKN/JUP balanced vault (optional) — sits on the JUP arbitrage ───────────
// A separate balanced position in the CLKN/JUP Whirlpool. As JUP/USD moves, CLKN/JUP
// misprices vs the CLKN/USDC + CLKN/SOL pools and arbitrageurs realign them — trading
// against this depth and paying us fees. Own state namespace ("jup_*"). Funded from JUP
// (the quote side) + CLKN. OFF by default. Because this pool is thin and self-seeded, it
// carries an EXTERNAL-market guard: it refuses to act when the pool's implied CLKN/USD has
// been pushed far from the true market price (so a manipulated tick can't get us to
// re-center liquidity at a bad price).
async function tickJup({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.jupEnabled) return { enabled: true, action: "none", reason: "CLKN/JUP vault disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct });
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote; // CLKN price in JUP

  // External-market guard (the thin-pool protection): compare the pool's implied CLKN/USD
  // to the true market. If it's been pushed beyond the tolerance, sit out — don't deploy.
  let jupUsd = 0;
  try { const px = await jupPriceUsdMap([engine.JUP_MINT]); jupUsd = Number(px[engine.JUP_MINT]?.usdPrice) || 0; } catch { /* */ }
  if (jupUsd > 0) {
    const impliedUsd = price * jupUsd;
    let mkt = 0; try { mkt = (await marketPriceUsd()).usd || 0; } catch { /* */ }
    if (mkt > 0) {
      const dev = Math.abs(impliedUsd - mkt) / mkt;
      if (dev > cfg.jupMaxDevPct / 100) {
        setState({ jup_lastPrice: price });
        return { enabled: true, pair: `${tok().symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct, price, action: "none", reason: `pool ${(dev * 100).toFixed(1)}% off market (>${cfg.jupMaxDevPct}% guard) — skipping`, impliedUsd, marketUsd: mkt };
      }
    }
  }

  if (st.jup_lastPrice && st.jup_lastPrice > 0) {
    const gap = Math.abs(price - st.jup_lastPrice) / st.jup_lastPrice;
    if (gap > cfg.priceGapGuardPct / 100) {
      setState({ jup_lastPrice: price });
      return { enabled: true, action: "none", reason: `price gap ${(gap * 100).toFixed(1)}% > guard — skipping`, price };
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let dayActions = st.jup_dayStamp === today ? (st.jup_dayActions || 0) : 0;

  let positions = [], fetchOk = true;
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, pair: `${tok().symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct, price, action: "skip", reason: "position lookup failed — retrying next tick" };
  const managed = positions.find((p) => p.positionMint === st.jup_positionMint);
  // Available JUP (no gas reserve — gas is SOL) — used to grow the pool when JUP is added.
  let preJupFree = 0, preClknForJup = 0;
  try { const f = await getFloat(conn); preJupFree = f.jup; preClknForJup = f.clkn || 0; } catch { /* best effort */ }

  let needRoll = false, reason = "", widthDriven = false, deployDriven = false;
  if (!managed) {
    if (st.jup_positionMint && await positionStillOpen(conn, st.jup_positionMint)) return MISSED_LISTING("JUP position");
    needRoll = true; reason = st.jup_positionMint ? "position gone — reopening" : "no CLKN/JUP position yet — opening";
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    const w = cfg.jupWidthPct / 100;
    const expRatio = (1 + w) / (1 - w);
    const posRatio = managed.lowerPriceClkn > 0 ? managed.upperPriceClkn / managed.lowerPriceClkn : expRatio;
    const widthOff = Math.abs(posRatio - expRatio) / expRatio;
    if (frac < 0 || frac > 1) {
      // OOR DWELL (owner 2026-08-28) — deployDriven doubles as the anti-thrash bypass here.
      const dwell = (cfg.oorDwellSec != null ? cfg.oorDwellSec : 300);
      if (!st.jup_oorSince) { setState({ jup_oorSince: Date.now() }); reason = `out of range — dwell ${dwell}s started`; }
      else if ((Date.now() - st.jup_oorSince) / 1000 < dwell) { reason = `out of range — dwelling ${Math.round((Date.now() - st.jup_oorSince) / 1000)}/${dwell}s`; }
      else { needRoll = true; deployDriven = true; reason = "out of range (dwell passed)"; }
    }
    else if (widthOff > 0.2) { needRoll = true; widthDriven = true; reason = `width reconfig → ±${cfg.jupWidthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across)`; }
    else if (preJupFree > cfg.jupDeployThreshold) {
      // Pairing gate: unpaired quote must not trigger rolls (see base sleeve comment).
      // deployDriven bypasses anti-thrash (owner, 2026-08-28): a deploy CONSUMES the idle
      // token that triggered it, so this branch can't re-fire until fresh inventory arrives —
      // making the timer pure delay here. dayActions still caps the worst case.
      if (deployBlockedFat("jup")) { reason = `in range; ${preJupFree} JUP staged but the JUP pool is FAT — float reserved for the lean pool (evenness gate)`; }
      else if (Math.max(0, (cfg.jupMaxJup || 0) - (managed.quoteAmount || 0)) < cfg.jupDeployThreshold) { reason = `in range; ${preJupFree} JUP staged but the position is at its cap (${Math.round(cfg.jupMaxJup)} JUP) — waiting for the cap to grow`; }   // ROOM gate, see base
      else if (preClknForJup * price >= cfg.jupDeployThreshold) { needRoll = true; deployDriven = (preClknForJup * price >= 2 * cfg.jupDeployThreshold); reason = `deploying available JUP (${preJupFree})`; }   // ≥2× = meaningful refill skips pacing; leftovers stay paced (see base decay-loop note)
      else { reason = `in range; ${preJupFree} JUP staged unpaired (CLKN idle too small) — holding`; }
    }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, pair: `${tok().symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct, price, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };
  if (!needRoll) { setState({ jup_lastPrice: price, ...(st.jup_oorSince && base.inRange ? { jup_oorSince: null } : {}) }); return { ...base, action: "hold", reason }; }

  const sinceLast = st.jup_lastRebalanceTs ? (Date.now() - st.jup_lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.jup_positionMint) && !widthDriven && !deployDriven && sinceLast < cfg.minRebalanceIntervalSec) { setState({ jup_lastPrice: price }); return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` }; }
  if (dayActions >= ((deployDriven || widthDriven) ? 2 * cfg.maxActionsPerDay : cfg.maxActionsPerDay)) { setState({ jup_lastPrice: price }); return { ...base, action: "capped", reason: "daily cap reached" }; }   // urgent rolls get 2× (see base note)
  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  if (managed) {
    accrueRealizedFees(managed); // bank the CLKN/JUP position's collected fees as realized
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.jup_positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ jup_positionMint: null });
  }

  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const ranges = eng().suggestRanges(fresh, cfg.jupWidthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Deploy from JUP (the quote side); fall back to CLKN if the JUP-sized position needs
  // more CLKN than we hold.
  const jupAvail = Math.max(0, float.jup);
  const jupDeploy = Math.min(jupAvail * cfg.deployFrac, cfg.jupMaxJup);
  let inputMint = engine.JUP_MINT, inputAmount = jupDeploy;
  if (jupDeploy > 0) {
    const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.JUP_MINT, inputAmount: String(jupDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
    const clknNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
    if (clknNeeded > float.clkn * cfg.deployFrac) { inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac; }
  } else if (float.clkn > 0) {
    inputMint = tok().mint; inputAmount = float.clkn * cfg.deployFrac;
  } else {
    setState({ jup_lastPrice: price, jup_dayActions: dayActions, jup_dayStamp: today });
    report.action = "no-float"; report.reason = "no deployable JUP/CLKN";
    await notify(`📊 <b>Liquidity vault (${tok().symbol}/JUP)</b>: no deployable JUP/${tok().symbol} — fund JUP + ${tok().symbol}.`);
    return report;
  }

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: sig, positionMint: built.positionMint });
  setState({
    jup_positionMint: built.positionMint,
    jup_lowerPriceClkn: balanced.lowerPriceClkn, jup_upperPriceClkn: balanced.upperPriceClkn,
    jup_lastRebalanceTs: Date.now(), jup_lastPrice: price, jup_dayActions: dayActions, jup_dayStamp: today,
  });
  if (cfg.notifyRolls !== false) await notifyDigest(
    `📊 <b>Liquidity vault — ${tok().symbol}/JUP ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.jupFeeTierPct}% · price ${price.toPrecision(5)} JUP\n` +
    `Range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\nReason: ${reason}`
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
  if (cfg.dualSleeveEnabled) return { enabled: true, action: "none", reason: "dual-sleeve mode — tickTreasury manages this pool" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct });
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
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
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch { fetchOk = false; }
  if (!fetchOk) return { enabled: true, pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct, price, action: "skip", reason: "position lookup failed — retrying next tick" };
  const managed = positions.find((p) => p.positionMint === st.sol_positionMint);
  // Available SOL above the gas reserve — used to grow the pool when SOL is added.
  let preSolFree = 0, preClknForSol = 0;
  try { const f = await getFloat(conn); preSolFree = f.sol - cfg.swapSolFloor - (cfg.solGasReserve || 0); preClknForSol = f.clkn || 0; } catch { /* best effort */ }   // BOTH guards — solGasReserve was declared-but-never-read (audit)

  let needRoll = false, reason = "", widthDriven = false, deployDriven = false;
  if (!managed) {
    if (st.sol_positionMint && await positionStillOpen(conn, st.sol_positionMint)) return MISSED_LISTING("SOL position");
    needRoll = true; reason = st.sol_positionMint ? "position gone — reopening" : "no CLKN/SOL position yet — opening";
  } else {
    const frac = rangeFraction(price, managed.lowerPriceClkn, managed.upperPriceClkn);
    const w = cfg.solWidthPct / 100;
    const expRatio = (1 + w) / (1 - w);
    const posRatio = managed.lowerPriceClkn > 0 ? managed.upperPriceClkn / managed.lowerPriceClkn : expRatio;
    const widthOff = Math.abs(posRatio - expRatio) / expRatio;
    if (frac < 0 || frac > 1) {
      // OOR DWELL (owner 2026-08-28) — deployDriven doubles as the anti-thrash bypass here.
      const dwell = (cfg.oorDwellSec != null ? cfg.oorDwellSec : 300);
      if (!st.sol_oorSince) { setState({ sol_oorSince: Date.now() }); reason = `out of range — dwell ${dwell}s started`; }
      else if ((Date.now() - st.sol_oorSince) / 1000 < dwell) { reason = `out of range — dwelling ${Math.round((Date.now() - st.sol_oorSince) / 1000)}/${dwell}s`; }
      else { needRoll = true; deployDriven = true; reason = "out of range (dwell passed)"; }
    }
    else if (widthOff > 0.2) { needRoll = true; widthDriven = true; reason = `width reconfig → ±${cfg.solWidthPct}%`; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { needRoll = true; reason = `near edge (${(frac * 100).toFixed(0)}% across)`; }
    else if (preSolFree > cfg.solDeployThreshold) {
      // Pairing gate: unpaired quote must not trigger rolls (see base sleeve comment).
      if (deployBlockedFat("sol")) { reason = `in range; ${preSolFree.toFixed(2)} SOL staged but the SOL pool is FAT — float reserved for the lean pool (evenness gate)`; }
      else if (Math.max(0, (cfg.solMaxSol || 0) - (managed.quoteAmount || 0)) < cfg.solDeployThreshold) { reason = `in range; ${preSolFree.toFixed(2)} SOL staged but the position is at its cap (${cfg.solMaxSol} SOL) — waiting for the cap to grow`; }   // ROOM gate, see base
      else if (preClknForSol * price >= cfg.solDeployThreshold) { needRoll = true; deployDriven = (preClknForSol * price >= 2 * cfg.solDeployThreshold); reason = `deploying available SOL (${preSolFree.toFixed(2)})`; }   // ≥2× = meaningful refill skips pacing; leftovers stay paced (see base decay-loop note)
      else { reason = `in range; ${preSolFree.toFixed(2)} SOL staged unpaired (CLKN idle too small) — holding`; }
    }
    else { reason = `in range (${(frac * 100).toFixed(0)}% across)`; }
  }

  const base = { enabled: true, pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct, price, inRange: managed ? (price >= managed.lowerPriceClkn && price <= managed.upperPriceClkn) : false };
  if (!needRoll) { setState({ sol_lastPrice: price, ...(st.sol_oorSince && base.inRange ? { sol_oorSince: null } : {}) }); return { ...base, action: "hold", reason }; }

  const sinceLast = st.sol_lastRebalanceTs ? (Date.now() - st.sol_lastRebalanceTs) / 1000 : Infinity;
  if ((managed || st.sol_positionMint) && !widthDriven && !deployDriven && sinceLast < cfg.minRebalanceIntervalSec) { setState({ sol_lastPrice: price }); return { ...base, action: "deferred", reason: `${reason} (anti-thrash)` }; }
  if (dayActions >= ((deployDriven || widthDriven) ? 2 * cfg.maxActionsPerDay : cfg.maxActionsPerDay)) { setState({ sol_lastPrice: price }); return { ...base, action: "capped", reason: "daily cap reached" }; }   // urgent rolls get 2× (see base note)
  if (dryRun) return { ...base, action: managed ? "would-roll" : "would-open", reason };

  const report = { ...base, action: managed ? "roll" : "open", reason, steps: [] };

  if (managed) {
    accrueRealizedFees(managed); // bank the CLKN/SOL position's collected fees as realized
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: st.sol_positionMint, slippageBps: cfg.slippageBps });
    for (const t of txs) report.steps.push({ close: await signSend(conn, t) });
    dayActions++;
    setState({ sol_positionMint: null });
  }

  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const ranges = eng().suggestRanges(fresh, cfg.solWidthPct);
  const balanced = ranges.options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);

  // Deploy from SOL (the quote side), keeping a gas/rent reserve; fall back to CLKN
  // if the SOL-sized position needs more CLKN than we hold.
  const solAvail = Math.max(0, float.sol - cfg.swapSolFloor);
  const solDeploy = Math.min(solAvail * cfg.deployFrac, cfg.solMaxSol);
  let inputMint = engine.WSOL_MINT, inputAmount = solDeploy;
  if (solDeploy > 0) {
    const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.WSOL_MINT, inputAmount: String(solDeploy), lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, slippageBps: cfg.slippageBps });
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

  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: balanced.lowerTick, upperTick: balanced.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  dayActions++;
  report.steps.push({ open: sig, positionMint: built.positionMint });
  setState({
    sol_positionMint: built.positionMint,
    sol_lowerPriceClkn: balanced.lowerPriceClkn, sol_upperPriceClkn: balanced.upperPriceClkn,
    sol_lastRebalanceTs: Date.now(), sol_lastPrice: price, sol_dayActions: dayActions, sol_dayStamp: today,
  });
  if (cfg.notifyRolls !== false) await notifyDigest(
    `📊 <b>Liquidity vault — ${tok().symbol}/SOL ${report.action === "roll" ? "re-centered" : "opened"}</b>\n` +
    `${cfg.solFeeTierPct}% · price ${price.toPrecision(5)} SOL\n` +
    `Range: ${balanced.lowerPriceClkn.toPrecision(4)} → ${balanced.upperPriceClkn.toPrecision(4)}\nReason: ${reason}`
  );
  return report;
}

// ── Treasury dual-sleeve (cbBTC/SOL): wide backbone + tight aggressive sleeve ──
// Runs TWO balanced positions in ONE pool: a WIDE sleeve (±solWidthPct, the always-on
// backbone) and a TIGHT sleeve (±tightWidthPct, max fee capture), split 50/50 by SOL
// budget. The wide sleeve re-centers on the standard out-of-range/edge rules; the TIGHT
// sleeve uses a volatility-aware debounced re-center — it only redeploys after it's been
// out of range for tightOorWaitSec AND recent (~1h) price range has cooled below
// tightVolCoolPct, with a tightMaxWaitSec hard cap so it never strands. Alerts route to
// the project's chat (notifyChatId — the treasury's private DM). Only acts when
// dualSleeveEnabled; replaces the project's single tickSol sleeve.
// Per-project in-flight lock so overlapping ticks (boot vs interval, manual vs scheduler)
// can't both act and double-deploy the float. Dry-runs don't lock (they never mutate).
const _treasuryBusy = new Set();
async function withTickLock(key, dryRun, fn) {
  if (dryRun) return fn();
  if (_treasuryBusy.has(key)) return { enabled: true, action: "busy", reason: "another treasury tick already running" };
  _treasuryBusy.add(key);
  try { return await fn(); } finally { _treasuryBusy.delete(key); }
}
// Concentrated-sleeve width + allocation for the active concentration mode.
function concWidthOf(cfg) { return cfg.concMode === "mega" ? cfg.megaWidthPct : cfg.tightWidthPct; }
function concFracOf(cfg) {
  if (cfg.concMode === "wide") return 0;
  const f = cfg.concMode === "mega" ? cfg.concMegaFrac : cfg.concTightFrac;
  return Math.max(0, Math.min(1 - (cfg.concWideFloorFrac || 0.3), f)); // never below the wide floor
}
// The per-width state slot that remembers a concentration sleeve's NFT, so a mode switch
// can REUSE an emptied position (same immutable range) instead of minting a new one.
function concSlot(cfg) { return cfg.concMode === "mega" ? "tg_megaMint" : "tg_tightMint"; }
// Open a balanced `widthPct` concentrated sleeve from a SOL budget (pulls the matching base;
// falls back to base-input if base-limited). Standalone twin of tickTreasury's openSleeve so
// concentrate() can mint a fresh sleeve. Returns {mint,lower,upper,sig} or null.
async function openTreasurySleeve(conn, address, cfg, widthPct, solBudget, clknBudget) {
  const fresh = await eng().getPoolState(address, operator().publicKey, tok());
  const bal = eng().suggestRanges(fresh, widthPct).options.find((o) => o.id === "balanced");
  const float = await getFloat(conn);
  const clknCap = (clknBudget != null) ? Math.min(clknBudget, float.clkn) : float.clkn;
  const solDep = Math.min(Math.max(0, solBudget), Math.max(0, float.sol - cfg.swapSolFloor));
  let inputMint = engine.WSOL_MINT, inputAmount = solDep;
  if (solDep > 0) {
    const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.WSOL_MINT, inputAmount: String(solDep), lowerTick: bal.lowerTick, upperTick: bal.upperTick, slippageBps: cfg.slippageBps });
    const tokNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
    if (tokNeeded > clknCap) { inputMint = tok().mint; inputAmount = clknCap; }
  } else if (clknCap > 0) { inputMint = tok().mint; inputAmount = clknCap; }
  else return null;
  if (!(Number(inputAmount) > 0)) return null;
  const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: bal.lowerTick, upperTick: bal.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
  let sig; for (const t of built.txs) sig = await signSend(conn, t);
  return { mint: built.positionMint, lower: bal.lowerPriceClkn, upper: bal.upperPriceClkn, sig };
}
async function tickTreasury({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.dualSleeveEnabled) return { enabled: true, action: "none", reason: "dual-sleeve disabled" };
  const concW = concWidthOf(cfg);   // concentrated sleeve width for the active mode
  const concF = concFracOf(cfg);    // concentrated allocation fraction (0 in "wide" mode)
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };

  const conn = connection();
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct });
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;
  const pair = `${tok().symbol}/SOL`;
  const base = { enabled: true, pair, feeTierPct: cfg.solFeeTierPct, price };

  // Rolling price history (persisted) → recent volatility for the tight sleeve's gate.
  let hist = Array.isArray(st.tw_priceHist) ? st.tw_priceHist.slice(-23) : [];
  hist.push(price);
  const recent = hist.slice(-6); // ~1h at 10-min ticks
  const rmid = recent.length ? (Math.max(...recent) + Math.min(...recent)) / 2 : price;
  const recentVolPct = recent.length >= 3 && rmid > 0 ? (Math.max(...recent) - Math.min(...recent)) / rmid * 100 : 999;

  // Shared anomaly guard: sit out a violent gap.
  if (st.tw_lastPrice && st.tw_lastPrice > 0) {
    const gap = Math.abs(price - st.tw_lastPrice) / st.tw_lastPrice;
    if (gap > cfg.priceGapGuardPct / 100) {
      if (!dryRun) setState({ tw_priceHist: hist, tw_lastPrice: price });
      return { ...base, action: "none", reason: `price gap ${(gap * 100).toFixed(1)}% > guard` };
    }
  }

  let positions = [], ok = true;
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); } catch { ok = false; }
  if (!ok) { if (!dryRun) setState({ tw_priceHist: hist, tw_lastPrice: price }); return { ...base, action: "skip", reason: "position lookup failed — retry next tick" }; }
  let wide = positions.find((p) => p.positionMint === st.tw_wideMint);
  let tight = positions.find((p) => p.positionMint === st.tg_mint);
  // Reconcile orphans: a confirm-timeout can leave a position ON-CHAIN whose mint we never
  // recorded. Before treating a sleeve as "missing" (which would open a DUPLICATE and strand
  // the orphan), adopt any unmanaged position in this pool, classified by range width
  // (the wide sleeve is far wider than the tight one).
  {
    const managed = new Set([st.tw_wideMint, st.tg_mint].filter(Boolean));
    const wpct = (p) => { const lo = p.lowerPriceClkn, hi = p.upperPriceClkn; return (lo > 0 && hi > lo) ? (hi - lo) / ((hi + lo) / 2) * 100 : 0; };
    // Never adopt an owner anchor or sell wall (audit: this path was 1 of 3 adoption sites
    // and the only one missing the exclusion — an anchor "adopted" here would get rolled).
    const orphans = positions.filter((p) => !managed.has(p.positionMint) && !(st.anchorMints || []).includes(p.positionMint));
    if (!wide) { const o = orphans.find((p) => wpct(p) >= cfg.solWidthPct); if (o) { wide = o; managed.add(o.positionMint); if (!dryRun) setState({ tw_wideMint: o.positionMint, tw_wideLower: o.lowerPriceClkn, tw_wideUpper: o.upperPriceClkn }); } }
    if (!tight) { const o = orphans.find((p) => !managed.has(p.positionMint) && wpct(p) < cfg.solWidthPct); if (o) { tight = o; if (!dryRun) setState({ tg_mint: o.positionMint, tg_lower: o.lowerPriceClkn, tg_upper: o.upperPriceClkn }); } }
  }

  const today = new Date().toISOString().slice(0, 10);
  let dayActions = st.tw_dayStamp === today ? (st.tw_dayActions || 0) : 0;
  const steps = [];
  const deployableSol = Math.max(0, (await getFloat(conn)).sol - cfg.swapSolFloor - (cfg.solGasReserve || 0));

  // Open a balanced position of `widthPct` using a SOL budget (pulls matching token; falls
  // back to token-input if token-limited). Returns {mint,lower,upper,sig} or null.
  async function openSleeve(widthPct, solBudget, clknBudget) {
    const fresh = await eng().getPoolState(address, operator().publicKey, tok());
    const bal = eng().suggestRanges(fresh, widthPct).options.find((o) => o.id === "balanced");
    const float = await getFloat(conn);
    const clknCap = (clknBudget != null) ? Math.min(clknBudget, float.clkn) : float.clkn;
    const solDep = Math.min(Math.max(0, solBudget), Math.max(0, float.sol - cfg.swapSolFloor - (cfg.solGasReserve || 0)));
    let inputMint = engine.WSOL_MINT, inputAmount = solDep;
    if (solDep > 0) {
      const q = await eng().quote({ address, owner: operator().publicKey.toBase58(), inputMint: engine.WSOL_MINT, inputAmount: String(solDep), lowerTick: bal.lowerTick, upperTick: bal.upperTick, slippageBps: cfg.slippageBps });
      const tokNeeded = Number(fresh.clknIsA ? q.maxA : q.maxB);
      if (tokNeeded > clknCap) { inputMint = tok().mint; inputAmount = clknCap; }
    } else if (clknCap > 0) { inputMint = tok().mint; inputAmount = clknCap; }
    else return null;
    if (!(Number(inputAmount) > 0)) return null;
    const built = await eng().buildOpenPosition({ owner: operator().publicKey.toBase58(), address, lowerTick: bal.lowerTick, upperTick: bal.upperTick, inputMint, inputAmount: String(inputAmount), slippageBps: cfg.slippageBps });
    let sig; for (const t of built.txs) sig = await signSend(conn, t);
    return { mint: built.positionMint, lower: bal.lowerPriceClkn, upper: bal.upperPriceClkn, sig };
  }
  async function closeOne(mint) {
    const m = positions.find((p) => p.positionMint === mint);
    if (m) accrueRealizedFees(m);
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: mint, slippageBps: cfg.slippageBps });
    for (const t of txs) await signSend(conn, t);
  }

  // ── decide each sleeve's action ──
  let wideAction = "hold", wideReason = "";
  if (!wide) { wideAction = "open"; wideReason = st.tw_wideMint ? "wide gone — reopening" : "no wide sleeve yet"; }
  else {
    const frac = rangeFraction(price, wide.lowerPriceClkn, wide.upperPriceClkn);
    if (frac < 0 || frac > 1) { wideAction = "roll"; wideReason = "wide out of range"; }
    else if (frac < cfg.edgeTriggerFrac || frac > 1 - cfg.edgeTriggerFrac) { wideAction = "roll"; wideReason = `wide near edge (${(frac * 100).toFixed(0)}%)`; }
    else wideReason = `wide in range (${(frac * 100).toFixed(0)}%)`;
  }

  let tightAction = "hold", tightReason = "", tgOorSince = st.tg_oorSince || null, parkedAlert = false;
  if (concF <= 0) { tightReason = "wide mode — no concentrated sleeve"; }
  else if (!tight) { tightAction = "open"; tightReason = st.tg_mint ? "tight gone — reopening" : "no concentrated sleeve yet"; tgOorSince = null; }
  else {
    const frac = rangeFraction(price, tight.lowerPriceClkn, tight.upperPriceClkn);
    if (frac >= 0 && frac <= 1) {
      // Only reset the OOR clock when COMFORTABLY centered — so chop straddling the edge
      // doesn't keep restarting it and defeating the max-wait cap.
      if (frac >= 0.25 && frac <= 0.75) tgOorSince = null;
      tightReason = `tight in range (${(frac * 100).toFixed(0)}%)`;
    }
    else {
      if (!tgOorSince) { tgOorSince = Date.now(); parkedAlert = true; }
      const oorSec = (Date.now() - tgOorSince) / 1000;
      if (oorSec >= cfg.tightMaxWaitSec) { tightAction = "roll"; tightReason = `tight OOR ${Math.round(oorSec / 60)}m — max-wait cap`; }
      else if (oorSec >= cfg.tightOorWaitSec && recentVolPct < cfg.tightVolCoolPct) { tightAction = "roll"; tightReason = `tight OOR ${Math.round(oorSec / 60)}m + vol cooled (${recentVolPct.toFixed(2)}%)`; }
      else tightReason = `tight parked (OOR ${Math.round(oorSec / 60)}m, vol ${recentVolPct.toFixed(2)}%)`;
    }
  }
  const anyAction = wideAction !== "hold" || tightAction !== "hold";

  if (dryRun) {
    return { ...base, action: anyAction ? "would-act" : "hold", recentVolPct: Number(recentVolPct.toFixed(3)),
      wide: { action: wideAction, reason: wideReason }, tight: { action: tightAction, reason: tightReason } };
  }

  setState({ tw_priceHist: hist, tw_lastPrice: price, tg_oorSince: tgOorSince });
  if (parkedAlert) await notify(`🟡 <b>Treasury — tight sleeve parked</b>\n${pair} out of range — holding off redeploy until vol cools (recent ${recentVolPct.toFixed(2)}%).`);
  if (!anyAction) return { ...base, action: "hold", wideReason, tightReason };
  if (dayActions >= cfg.maxActionsPerDay) return { ...base, action: "capped", reason: "daily cap reached" };
  const sinceLast = st.tw_lastRebalanceTs ? (Date.now() - st.tw_lastRebalanceTs) / 1000 : Infinity;

  // FRESH SPLIT — neither sleeve exists → open both 50/50.
  if (!wide && !tight) {
    const f0 = await getFloat(conn);
    const eff = Math.max(0, f0.sol - cfg.swapSolFloor) * cfg.deployFrac;
    // Split by the active mode's allocation: wide gets (1-concF), concentrated gets concF.
    // From a ~50/50 float each sleeve is internally ~50/50, so this lands at the target split.
    const w = await openSleeve(cfg.solWidthPct, eff * (1 - concF), f0.clkn * (1 - concF));
    if (w) { dayActions++; steps.push({ wideOpen: w.sig }); setState({ tw_wideMint: w.mint, tw_wideLower: w.lower, tw_wideUpper: w.upper }); }
    if (concF > 0) {
      const t = await openSleeve(concW, eff * concF, f0.clkn * concF);
      if (t) { dayActions++; steps.push({ tightOpen: t.sig }); setState({ tg_mint: t.mint, tg_lower: t.lower, tg_upper: t.upper, tg_oorSince: null, [concSlot(cfg)]: t.mint }); }
    }
    setState({ tw_lastRebalanceTs: Date.now(), tw_dayActions: dayActions, tw_dayStamp: today });
    await notify(`🏦 <b>Treasury seeded</b> — ${pair} @ ${cfg.solFeeTierPct}% · <b>${cfg.concMode}</b> mode\nWide ±${cfg.solWidthPct}%${concF > 0 ? ` + ±${concW}% (${Math.round(concF * 100)}% concentrated)` : " only"}\nprice ${price.toPrecision(5)}`);
    return { ...base, action: "seeded", steps };
  }
  // One sleeve missing → (re)open it with recycled float.
  if (!wide) {
    const w = await openSleeve(cfg.solWidthPct, deployableSol * cfg.deployFrac);
    if (w) { dayActions++; steps.push({ wideOpen: w.sig }); setState({ tw_wideMint: w.mint, tw_wideLower: w.lower, tw_wideUpper: w.upper, tw_lastRebalanceTs: Date.now(), tw_dayActions: dayActions, tw_dayStamp: today }); await notify(`🏦 <b>Treasury — wide sleeve opened</b>\n${pair} ±${cfg.solWidthPct}% · ${w.lower.toPrecision(4)}→${w.upper.toPrecision(4)}`); }
    return { ...base, action: "wide-opened", steps };
  }
  if (!tight && concF > 0) {
    const t = await openSleeve(concW, deployableSol * cfg.deployFrac);
    if (t) { dayActions++; steps.push({ tightOpen: t.sig }); setState({ tg_mint: t.mint, tg_lower: t.lower, tg_upper: t.upper, tg_oorSince: null, tw_dayActions: dayActions, tw_dayStamp: today, [concSlot(cfg)]: t.mint }); await notify(`🟢 <b>Treasury — concentrated sleeve opened</b>\n${pair} ±${concW}% · ${t.lower.toPrecision(4)}→${t.upper.toPrecision(4)}`); }
    return { ...base, action: "tight-opened", steps };
  }
  // Both exist — re-center (one per tick; wide first). Anti-thrash applies.
  if (wideAction === "roll") {
    if (sinceLast < cfg.minRebalanceIntervalSec) return { ...base, action: "deferred", reason: `${wideReason} (anti-thrash)` };
    await closeOne(wide.positionMint); dayActions++; setState({ tw_wideMint: null });
    const w = await openSleeve(cfg.solWidthPct, ((await getFloat(conn)).sol - cfg.swapSolFloor) * cfg.deployFrac);
    if (w) { dayActions++; steps.push({ wideRoll: w.sig }); setState({ tw_wideMint: w.mint, tw_wideLower: w.lower, tw_wideUpper: w.upper, tw_lastRebalanceTs: Date.now(), tw_dayActions: dayActions, tw_dayStamp: today }); }
    await notify(`⚠️ <b>Treasury — wide sleeve re-centered</b>\n${pair} ±${cfg.solWidthPct}% · ${wideReason}`);
    return { ...base, action: "wide-recentered", steps };
  }
  if (tightAction === "roll") {
    await closeOne(tight.positionMint); dayActions++; setState({ tg_mint: null });
    const t = await openSleeve(concW, ((await getFloat(conn)).sol - cfg.swapSolFloor) * cfg.deployFrac);
    if (t) { dayActions++; steps.push({ tightRoll: t.sig }); setState({ tg_mint: t.mint, tg_lower: t.lower, tg_upper: t.upper, tg_oorSince: null, tw_dayActions: dayActions, tw_dayStamp: today, [concSlot(cfg)]: t.mint }); }
    await notify(`🟢 <b>Treasury — concentrated sleeve re-centered</b>\n${pair} ±${concW}% · ${tightReason}`);
    return { ...base, action: "tight-recentered", steps };
  }
  return { ...base, action: "hold", wideReason, tightReason };
}

// ── Jupiter swap layer ───────────────────────────────────────────────────────
// Quote + build helpers shared by the equal-pools rebalancer (rebalancePools), the
// Meteora keepalive, buyback, and manualSwap. Signs a Jupiter v0 tx with the operator
// and submits. Callers carry the guards: SOL floor, per-cycle cap, daily cap, slippage
// cap. (The legacy USDC top-up rebalanceInventory() was removed — it had no callers.)
async function jupQuote(inMint, outMint, amount, mode, slippageBps, dexes) {
  // Clamp slippage at the boundary too (defense-in-depth beyond setConfig): a swap
  // must never go out with sandwich-wide slippage even if a bad value slips through.
  const sb = Math.min(500, Math.max(1, Number(slippageBps) || 100));
  let u = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&swapMode=${mode}&slippageBps=${sb}`;
  if (dexes) u += `&dexes=${encodeURIComponent(dexes)}`;  // restrict routing (e.g. force the Meteora canonical pool)
  return (await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) })).json();
}
async function jupSwapTx(quote, userPubkey) {
  const r = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: userPubkey, wrapAndUnwrapSol: true }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (j.error) throw new Error("Jupiter swap build: " + j.error);
  return j.swapTransaction;
}
async function signSendVersioned(conn, txBase64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  tx.sign([operator()]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSig(conn, sig);
  await recordTxFee(conn, sig);
  return sig;
}

// One-shot Meteora canonical-pool keepalive: a tiny SOL->CLKN BUY forced through the 64WXkH
// DAMM V2 pool (the canonical chart) so it stays on watchlists when the Orca engine pools are
// catching all the real flow. BUY-ONLY (never sells the bag); VERIFIES the route actually hits
// 64WXkH before sending (a normal buy would route through the cheaper Orca pools); SOL gas-floor
// guarded. The caller caps it to 1x/24h. Deliberately minimal — one tiny real trade, not a wash loop.
const METEORA_CANON_POOL = "64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd";
async function meteoraKeepalive({ usd = 10, dryRun = false } = {}) {
  if (!isEnabled()) return { ok: false, reason: "operator not set" };
  const conn = connection();
  let solUsd = 0;
  try { const px = await jupPriceUsdMap([engine.WSOL_MINT]); solUsd = Number(px[engine.WSOL_MINT]?.usdPrice) || 0; } catch { /* */ }
  if (!(solUsd > 0)) return { ok: false, reason: "no SOL price" };
  const solIn = (Math.max(1, Number(usd) || 10)) / solUsd;
  const float = await getFloat(conn);
  if ((float.sol || 0) - solIn < (getConfig().swapSolFloor || 0.2)) return { ok: false, reason: "SOL below gas floor — skipping" };
  const lamports = Math.max(1, Math.round(solIn * 1e9));
  const quote = await jupQuote(engine.WSOL_MINT, tok().mint, lamports, "ExactIn", 300, "Meteora DAMM v2");  // exact Jupiter label for the 64WXkH DAMM v2 pool
  if (!quote || quote.error || !Array.isArray(quote.routePlan)) return { ok: false, reason: "no Meteora route", err: quote && quote.error };
  const hits = quote.routePlan.some((r) => r.swapInfo && r.swapInfo.ammKey === METEORA_CANON_POOL);
  const labels = quote.routePlan.map((r) => r.swapInfo && r.swapInfo.label);
  if (!hits) return { ok: false, reason: "route did not include the canonical pool (64WXkH)", labels };
  if (dryRun) return { ok: true, dryRun: true, usd: Number(usd) || 10, solIn: Number(solIn.toFixed(4)), pool: METEORA_CANON_POOL, labels };
  const txb = await jupSwapTx(quote, operator().publicKey.toBase58());
  const sig = await signSendVersioned(conn, txb);
  return { ok: true, sig, usd: Number(usd) || 10, solIn: Number(solIn.toFixed(4)) };
}

// ── Manual / ad-hoc swap (any direction) via Jupiter ─────────────────────────
// Admin-triggered conversion between SOL / USDC / CLKN, signed by the operator.
// Used for one-off corrections and inventory moves the auto-rebalancer doesn't
// cover yet. dryRun=true just quotes.
// ── Transfer funds between OUR OWN vault wallets (gated, allow-listed) ───────
// Destination is restricted to another registered project's operator wallet —
// this can rebalance capital between engines but can NEVER send to an arbitrary
// address. sym: SOL | USDC | CLKN (the source project's token). amountUi: number
// or "all" (SOL keeps a small gas reserve behind).
// Which decimals a TRANSFER may scale an amount by. Two trusted sources only: the chain read,
// and the static table for the two quote mints whose decimals are constants. `null` = UNKNOWN
// and the caller MUST refuse — scaling a 6-decimal project token by 9 sends 1000x.
// The project RECORD is deliberately NOT a source: registerProject stores decimals 9 whenever
// none was supplied, so "the record says 9" is indistinguishable from "nobody ever told us".
// That is exactly what made the first version of this guard dead code (it could never fire).
// Exported for the engine simulator — this decision is only worth having if it is tested.
function transferDecimals(sym, chainDecimals) {
  const n = Number(chainDecimals);
  if (chainDecimals != null && Number.isFinite(n) && n >= 0) return n;
  const KNOWN = { USDC: 6, JUP: 6 };
  const k = KNOWN[String(sym || "").toUpperCase()];
  return k != null ? k : null;
}
async function transferToProject({ toProjectId, sym, amountUi, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const destPk = operatorPubkey(toProjectId);
  if (!destPk) throw new Error(`destination project '${toProjectId}' has no loaded operator wallet`);
  const from = operator();
  if (destPk === from.publicKey.toBase58()) throw new Error("source and destination are the same wallet");
  const conn = connection();
  const S = String(sym || "").toUpperCase();
  const out = { enabled: true, from: from.publicKey.toBase58(), to: destPk, toProject: toProjectId, sym: S };
  if (S === "SOL") {
    const bal = (await conn.getBalance(from.publicKey)) / 1e9;
    const amt = amountUi === "all" ? Math.max(0, bal - 0.02) : Number(amountUi);
    if (!(amt > 0)) return { ...out, action: "none", reason: `nothing to send (balance ${bal.toFixed(4)})` };
    if (dryRun) return { ...out, action: "would-transfer", amount: amt, balance: bal };
    const { SystemProgram } = require("@solana/web3.js");
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(destPk), lamports: Math.floor(amt * 1e9) }));
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(from);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await confirmSig(conn, sig);
    return { ...out, action: "transfer", amount: amt, sig };
  }
  // SPL path: USDC, JUP, or the source project's token
  const mint = S === "USDC" ? engine.USDC_MINT : S === "JUP" ? engine.JUP_MINT : tok().mint;
  const spl = require("@solana/spl-token");
  const fromAta = spl.getAssociatedTokenAddressSync(new PublicKey(mint), from.publicKey);
  // Decimals are NEVER guessed on a transfer (audit) — see transferDecimals for why the
  // project record is not a trusted source. A failed read now REFUSES instead of scaling by 9.
  let bal = 0, balOk = false, chainDec = null;
  try {
    const tb = (await conn.getTokenAccountBalance(fromAta)).value;
    bal = Number(tb.uiAmount) || 0;
    balOk = true;
    chainDec = tb.decimals;   // authoritative on-chain decimals (cbBTC=8, pump.fun mints 6)
  } catch (_) {}
  const dec = transferDecimals(S, chainDec);
  const amt = amountUi === "all" ? bal : Number(amountUi);
  if (!(amt > 0)) return { ...out, action: "none", reason: `nothing to send (balance ${bal})` };
  // Fail CLOSED on BOTH unknowns. Unknown decimals = an amount scaled by a guess (the 1000x
  // overpay). Unknown balance = signing a transfer with no idea what the wallet holds — "all"
  // is already bounded by bal, so it can only be 0 here and has returned above.
  if (!balOk) throw new Error(`refusing to transfer ${S}: could not read the source token balance (RPC read failed) — retry when RPC is healthy`);
  if (dec == null) throw new Error(`refusing to transfer ${S}: token decimals unknown — the on-chain read carried none, and the project record's decimals is a DEFAULT (registerProject stamps 9 when none was supplied), not a verified figure. Retry when RPC is healthy.`);
  if (dryRun) return { ...out, action: "would-transfer", amount: amt, balance: bal, mint };
  const destAta = spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(destPk));
  const tx = new Transaction()
    .add(spl.createAssociatedTokenAccountIdempotentInstruction(from.publicKey, destAta, new PublicKey(destPk), new PublicKey(mint)))
    .add(spl.createTransferInstruction(fromAta, destAta, from.publicKey, BigInt(Math.round(amt * 10 ** dec))));
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(from);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSig(conn, sig);
  return { ...out, action: "transfer", amount: amt, mint, sig };
}

async function manualSwap({ fromSym, toSym, amountUi, slippageBps = 100, maxImpactPct = null, dryRun = false, silent = false, allowTokenSell = false }) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const M = { SOL: engine.WSOL_MINT, USDC: engine.USDC_MINT, CLKN: tok().mint, BTC: engine.CBBTC_MINT, JUP: engine.JUP_MINT };
  // "CLKN" = the PROJECT token; its decimals come from the project record (CLKN 9,
  // pump.fun mints 6). The hardcoded 9 made poke buys display/account 1000x low — and
  // would have made a project-token SELL request 1000x TOO LARGE had one ever run.
  const D = { SOL: 9, USDC: 6, CLKN: tok().decimals || 9, BTC: 8, JUP: 6 }; // cbBTC is 8 decimals; JUP is 6
  const from = M[fromSym], to = M[toSym];
  if (!from || !to || from === to) throw new Error("from/to must be SOL, USDC, CLKN, BTC, or JUP (and differ)");
  // BRAND-BAG INVARIANT, per-project (owner, 2026-08-28): CLKN is the brand — NEVER sold, no
  // flag can change that (the built-in project record can't carry tokenSellOk). Client/job
  // tokens (DNC, CUNA) are inventory: their project records set tokenSellOk:true and both
  // directions trade freely for pool balancing. allowTokenSell stays a code-only override for
  // internal engine paths — it is never read from a request param.
  if (from === tok().mint && !allowTokenSell) {
    const p = getProject(pid());
    if (!p || !p.tokenSellOk) {
      // RECOUP carve-out (owner, 2026-08-31): a tight-quoting engine that absorbed
      // someone's sell may sell that ABSORBED inventory back — but only what sits
      // above the armed baseline. The bag below the baseline stays unsellable, and
      // with the flag off or no baseline armed this path throws exactly as before.
      const rc = getConfig();
      const baseline = Number(getState().tokenBaselineUi);
      if (!(rc.tokenRecoupEnabled && Number.isFinite(baseline))) {
        throw new Error("refusing to sell the project token (brand bag) — quote↔quote only");
      }
      const bal = (await getFloat(connection())).clkn;
      if (bal - Number(amountUi) < baseline) {
        throw new Error(`recoup limit: selling ${amountUi} would dig below the protected baseline (${baseline.toFixed(0)} ${tok().symbol}, current ${bal.toFixed(0)}) — only absorbed inventory above it may be sold`);
      }
    }
  }
  const inDec = D[fromSym], outDec = D[toSym];
  const amount = Math.round(Number(amountUi) * 10 ** inDec);
  if (!(amount > 0)) throw new Error("amount must be > 0");
  const q = await jupQuote(from, to, amount, "ExactIn", slippageBps);
  if (!q || q.error) return { enabled: true, action: "none", reason: "no Jupiter route: " + (q && q.error) };
  const inAmt = Number(q.inAmount) / 10 ** inDec, out = Number(q.outAmount) / 10 ** outDec;
  // Jupiter returns priceImpactPct as a decimal fraction (e.g. "0.0012" = 0.12%).
  const impactPct = Math.abs(Number(q.priceImpactPct) || 0) * 100;
  const base = { enabled: true, reason: `${inAmt.toFixed(4)} ${fromSym} → ${out.toFixed(4)} ${toSym} (impact ${impactPct.toFixed(3)}%)`, inAmt, out, impactPct: Number(impactPct.toFixed(4)) };
  // Price-impact ceiling: refuse a costly swap BEFORE it signs. A rebalance must never eat
  // more than a sliver — losing ~1% on a swap would wipe a day of fees. Caller passes the cap.
  if (maxImpactPct != null && impactPct > Number(maxImpactPct)) {
    return { ...base, action: "none", reason: `price impact ${impactPct.toFixed(3)}% > ${maxImpactPct}% ceiling — skipped` };
  }
  if (dryRun) return { ...base, action: "would-swap" };
  const tx = await jupSwapTx(q, operator().publicKey.toBase58());
  const sig = await signSendVersioned(connection(), tx);
  // Swap posts to Telegram are OFF (owner rule, 2026-06-12) — log only.
  console.log(`[VAULT] swap: ${inAmt.toFixed(3)} ${fromSym} → ${out.toFixed(2)} ${toSym} · ${sig.slice(0, 8)}…`);
  return { ...base, action: "swap", sig };
}

// ── Cautious sell clip (owner carve-out, 2026-08-26, CUNA only) ──────────────
// Convert a SMALL, code-capped amount of the project token to USDC to rebuild
// quote-side depth in a downdraft (owner: "market moves down → cautiously sell
// slowly, then re-arm"). The brand-bag invariant stands: allowTokenSell is set
// HERE in code for an allowlisted project only, behind per-clip / per-day /
// cooldown / impact ceilings that no request parameter can raise.
const SELL_CLIP = {
  projects: new Set(["cuna"]),
  maxUsdPerClip: 100,
  maxUsdPerDay: 600,
  cooldownMs: 10 * 60 * 1000,
  impactCeilingPct: 1.5,
};
async function sellClip({ usd, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  if (!SELL_CLIP.projects.has(pid())) return { enabled: true, action: "refused", reason: `sell-clip not enabled for project "${pid()}"` };
  const spend = Math.min(Number(usd) || 0, SELL_CLIP.maxUsdPerClip);
  if (!(spend > 0)) throw new Error("usd must be > 0");
  const st = getState();
  const today = new Date().toISOString().slice(0, 10);
  const sc = st.sellClips && st.sellClips.dayStamp === today ? st.sellClips : { dayStamp: today, dayUsd: 0, lastTs: 0 };
  if (sc.dayUsd + spend > SELL_CLIP.maxUsdPerDay) return { enabled: true, action: "refused", reason: `daily sell-clip cap $${SELL_CLIP.maxUsdPerDay} would be exceeded ($${sc.dayUsd.toFixed(0)} spent)` };
  if (!dryRun && Date.now() - sc.lastTs < SELL_CLIP.cooldownMs) return { enabled: true, action: "refused", reason: `cooldown — last clip ${Math.round((Date.now() - sc.lastTs) / 60000)}m ago (min ${SELL_CLIP.cooldownMs / 60000}m)` };
  const px = await jupPriceUsdMap([tok().mint]);
  const tokUsd = Number(px[tok().mint] && px[tok().mint].usdPrice);
  if (!(tokUsd > 0)) return { enabled: true, action: "refused", reason: "no live token price" };
  const amountUi = spend / tokUsd;
  const res = await manualSwap({ fromSym: "CLKN", toSym: "USDC", amountUi, slippageBps: 150, maxImpactPct: SELL_CLIP.impactCeilingPct, dryRun, silent: true, allowTokenSell: true });
  if (!dryRun && res && res.action === "swap") {
    const soldUsd = res.inAmt * tokUsd;
    setState({ sellClips: { dayStamp: today, dayUsd: sc.dayUsd + soldUsd, lastTs: Date.now() } });
    await notify(`⚖️ <b>${tok().symbol} sell clip</b> — ${Math.round(res.inAmt).toLocaleString()} ${tok().symbol} → $${res.out.toFixed(2)} USDC (impact ${res.impactPct}%)\n<i>owner-authorized quote-side restock · $${(sc.dayUsd + soldUsd).toFixed(0)}/$${SELL_CLIP.maxUsdPerDay} today</i>`);
  }
  return { ...res, clipUsd: spend, dayUsdBefore: sc.dayUsd };
}

// ── Buyback (flywheel) — convert accumulated quote → the project token ────────
// The ask wall sells token into demand and accrues USDC; this reinvests that USDC by
// buying the token back (refilling token inventory the wall redeploys on its next roll)
// and prints a visible green "bought" event. NEVER sells the token. Spends only USDC
// above usdcFloor + buybackReserveUsd, capped per cycle + per day. OFF by default.
async function buyback({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.buybackEnabled) return { enabled: true, action: "none", reason: "buyback disabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };
  const conn = connection();
  const float = await getFloat(conn);
  // The full gate (multi-quote selection, caps, interval, demand override) lives in
  // lib/engine-decisions.js as a PURE function so the simulator replays the exact
  // production logic. This function only fetches inputs and executes the verdict.
  let prices = null;
  try {
    const px = await jupPriceUsdMap([engine.WSOL_MINT, engine.JUP_MINT]);
    prices = { solUsd: Number((px[engine.WSOL_MINT] || {}).usdPrice) || 0, jupUsd: Number((px[engine.JUP_MINT] || {}).usdPrice) || 0 };
  } catch (_) { /* price feed down → decision degrades to USDC-only */ }
  const today = new Date().toISOString().slice(0, 10);
  const d = buybackDecision({ cfg, st, float, prices, nowMs: Date.now(), todayStamp: today });
  const usable = Math.max(0, float.usdc - cfg.usdcFloor - (cfg.buybackReserveUsd || 0));
  const out = { enabled: true, sym: tok().symbol, fromSym: d.fromSym, usableUsdc: Math.round(usable * 100) / 100 };
  if (d.action !== "buy") return { ...out, action: d.action, reason: d.reason };   // none | capped | deferred
  const fromSym = d.fromSym, spendUi = d.spendUi, spendUsd = d.spendUsd;
  let buybacksToday = st.buybackDayStamp === today ? (st.buybacksToday || 0) : 0;

  if (dryRun) {
    const preview = await manualSwap({ fromSym, toSym: "CLKN", amountUi: spendUi, slippageBps: cfg.buybackSlippageBps, dryRun: true });
    return { ...out, action: "would-buyback", spendUsd: Math.round(spendUsd * 100) / 100, reason: `buy ${tok().symbol} with $${spendUsd.toFixed(2)} of ${fromSym} (${preview.reason || preview.reason})`, preview };
  }
  let res;
  try {
    res = await manualSwap({ fromSym, toSym: "CLKN", amountUi: spendUi, slippageBps: cfg.buybackSlippageBps, dryRun: false, silent: true });
  } catch (e) {
    if (!isConfirmTimeout(e)) throw e;
    // The swap MAY HAVE LANDED (only the confirm timed out). Count it against the daily cap
    // and the interval — an uncounted landed buyback is spent again next cycle, and the
    // starved override bypasses the interval, so maxBuybacksPerDay stops being a bound.
    setState({ buybacksToday: buybacksToday + 1, buybackDayStamp: today, lastBuybackTs: Date.now() });
    console.warn(`[vault] buyback swap unconfirmed (${e.message}) — counted against today's cap; VERIFY on-chain`);
    return { ...out, action: "unconfirmed", reason: `buyback sent but confirmation timed out — counted against today's cap; verify on-chain (${e.message})` };
  }
  if (res.action !== "swap") return { ...out, action: "none", reason: res.reason || "swap failed" };
  buybacksToday++;
  // lifetime tracking is in USD: res.inAmt is from-token UNITS (0.6 SOL, 200 JUP) — for
  // non-USDC quotes use the USD estimate from the price feed, not the raw unit count.
  const spentUsdActual = fromSym === "USDC" ? res.inAmt : Math.round(spendUsd * 100) / 100;
  setState({
    buybacksToday, buybackDayStamp: today, lastBuybackTs: Date.now(),
    buybackLifetimeUsd: (st.buybackLifetimeUsd || 0) + spentUsdActual,
    buybackLifetimeToken: (st.buybackLifetimeToken || 0) + res.out,
  });
  await notifyDigest(`🟢 <b>${tok().symbol} Liquidity Engine — bought back</b>\n$${spentUsdActual.toFixed(2)} of ${fromSym} → ${Math.round(res.out).toLocaleString()} ${tok().symbol}\n<i>quote earned from asks, reinvested into the token.</i>\n<code>${(res.sig || "").slice(0, 8)}…</code>`);
  return { ...out, action: "buyback", spendUsd: spentUsdActual, gotToken: Math.round(res.out), sig: res.sig };
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
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
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
  let res;
  try {
    res = await manualSwap({ fromSym, toSym, amountUi: inAmtUi, slippageBps: cfg.swapSlippageBps, dryRun: false });
  } catch (e) {
    if (!isConfirmTimeout(e)) throw e;
    // May have landed — count it, or the next cycle sees the same gap and swaps again.
    setState({ swapsToday: swapsToday + 1, swapDayStamp: today });
    console.warn(`[vault] rebalance swap unconfirmed (${e.message}) — counted against today's swap cap; VERIFY on-chain`);
    return { ...r, action: "unconfirmed", reason: `${fromSym}→${toSym} sent but confirmation timed out — counted against today's swap cap; verify on-chain` };
  }
  setState({ swapsToday: swapsToday + 1, swapDayStamp: today });
  r.sig = res.sig;
  await notifyDigest(`⚖️ <b>Liquidity vault — pool rebalance</b>\nBase $${Math.round(vBase)} vs SOL $${Math.round(vSol)} (gap $${Math.round(gap)})\nSwapped ${res.reason} to even them up.`);
  return r;
}

// Deploy-evenness gate (2026-09-01): is `key` the FAT pool right now? The deploy
// branches in tick/tickSol/tickJup call this before absorbing float — a shift frees
// the fat pool's token side into the wallet, and without this gate the fat pool's
// OWN deploy tick re-grabbed it within 90s (inside the 5-min settle cooldown), so
// every shift round-tripped and the pools diverged while everything reported green.
// Uses the values evenPools stashed (≤10 min old); fails open when there's no stash
// or the pools are inside tolerance — deploys must never stall on missing data.
function deployBlockedFat(key) {
  const st = getState();
  // While an untracked position is suspected, EVERY balance number is unreliable
  // (that's how the $355 orphan got fed) — hold all deploys until the sweep resolves it.
  if (st.orphanCandidate) return true;
  const ev = st.evenVals;
  if (!ev || !ev.vals || Date.now() - ev.ts > 10 * 60 * 1000) return false;
  const entries = Object.entries(ev.vals);
  if (entries.length < 2) return false;
  const vals = entries.map(([, v]) => Number(v));
  const max = Math.max(...vals), min = Math.min(...vals);
  const tol = (getConfig().poolBalanceTolPct || 10) / 100;
  if (max - min < tol * Math.max(max, 1)) return false;
  // Block every ABOVE-MEAN pool, not just the single fattest — with three pools the
  // second-fattest also absorbing float starves the lean one just the same (audit F5).
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number(ev.vals[key] ?? 0) > mean;
}

// The mirror image of the ghost filter: a TRACKED position missing from the listing is either
// really closed, or the RPC's token-account index simply missed it (the same Helius overload
// that served ghosts also dropped live positions — 2026-09-02, ROSE). The NFT mint's supply
// settles it: 1 = still open on-chain. Reopening on a missed read opened a duplicate SOL
// position which the orphan sweep then closed — a full close+open churn for nothing.
// Unreadable → false (the old "gone" behaviour), so a real outage can't wedge a sleeve.
async function positionStillOpen(conn, mint) {
  if (!mint) return false;
  try {
    const s = await conn.getTokenSupply(new PublicKey(mint));
    return !!(s && s.value && s.value.amount === "1");
  } catch (_) { return false; }
}
const MISSED_LISTING = (what) => ({ enabled: true, action: "none", reason: `${what} missing from the listing but its NFT is still on-chain (RPC index degraded) — holding, not reopening` });

// Drop positions whose NFT mint has supply 0 — a closed position the RPC's token-account
// index is still (wrongly) listing. Tracked mints are never checked (the sleeves own them);
// a failed read keeps the position (the orphan debounce still guards the close).
async function dropGhostPositions(conn, positions, trackedMints) {
  const out = [];
  for (const p of positions) {
    if (trackedMints.has(p.positionMint)) { out.push(p); continue; }
    let ghost = false;
    try {
      const sup = await conn.getTokenSupply(new PublicKey(p.positionMint));
      ghost = !!(sup && sup.value && sup.value.amount === "0");
    } catch (_) { /* unreadable — keep it, the debounce decides */ }
    if (ghost) { console.warn(`[vault] ghost position ${p.positionMint.slice(0, 8)}… listed by RPC but its NFT supply is 0 — ignoring stale listing`); continue; }
    out.push(p);
  }
  return out;
}

// ── Three-way pool evenness (owner, 2026-08-31: "We need 3 even pools. So you need
// to keep them even") ─────────────────────────────────────────────────────────
// ACTIVE enforcement every cycle, not passive cap convergence: measures the USD value
// deployed in the base/SOL/JUP pools, TRIMS the fattest by rolling it (closePosition
// is withdraw-only — no market trade — and the very next tick redeploys it at cap),
// and FEEDS the leanest by converting free float toward its quote. Repeats for as
// long as the engine runs, so drift gets corrected again and again. Bounded by the
// existing swap caps plus a 10-minute close cooldown so it converges, never thrashes.
// Requires all three pools live (jupEnabled) — projects without a JUP leg keep using
// the two-way rebalancePools above.
async function evenPools({ dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const cfg = getConfig();
  if (!cfg.swapEnabled) return { enabled: true, action: "none", reason: "needs swapEnabled" };
  const st = getState();
  if (st.paused) return { enabled: true, action: "none", reason: "paused" };
  const conn = connection();
  let positions = [];
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch (e) { return { enabled: true, action: "none", reason: "positions read failed: " + e.message }; }
  // ORPHAN SWEEP (2026-09-01): a roll whose close tx silently failed leaves the old
  // position live-but-UNTRACKED — state points at the new one, so every value read
  // sees the pool at a fraction of its real size. Evenness then calls the fattest
  // pool "lean" and shifts capital INTO it (a $355 orphan sent the base-pool spread
  // 13%→53% in an hour this way). Close anything we don't track back to float; the
  // deploy ticks re-place it where the (now truthful) balance says it belongs.
  // The tracked set is EVERYTHING the vault knowingly holds — not just the three pool
  // positions. Anchors, sell walls, the ask wall, the BTC leg, and the dual-sleeve
  // slots (including kept-empty NFTs reused on mode switches) are all deliberate;
  // sweeping any of them liquidates an owner decision (audit F2, 2026-09-01).
  const trackedMints = new Set([
    st.positionMint, st.sol_positionMint, st.jup_positionMint, st.btc_positionMint,
    st.wallMint, st.tw_wideMint, st.tg_mint, st.tg_tightMint, st.tg_megaMint,
    ...(st.anchorMints || []),
    ...(st.sellWalls || []),
  ].filter(Boolean));
  // A zero-liquidity NFT is a kept slot (dual-sleeve reuse), not stranded funds — skip.
  // GHOST FILTER (2026-09-02): the RPC's token-account index served a position NFT as still
  // held 35+ minutes after CLOSE_POSITION burned it (the mint's supply read 0 and the public
  // RPC showed no account, yet getTokenAccountsByOwner kept returning it). The sweep saw an
  // "orphan", parked every deploy and shift behind deployBlockedFat, and was one debounce
  // away from trying to close a position that no longer exists. The NFT mint's supply is the
  // truth — a position whose mint supply is 0 is a stale listing, not money. Only untracked
  // positions are checked (one read each), so the normal path costs nothing.
  positions = await dropGhostPositions(conn, positions, trackedMints);
  const orphan = positions.find((p) => !trackedMints.has(p.positionMint) && ((p.clknAmount || 0) > 0 || (p.quoteAmount || 0) > 0));
  if (orphan) {
    // TWO-CYCLE DEBOUNCE: a position seen mid-roll (opened, state write not yet landed —
    // the race that manufactured tonight's orphan in the first place) looks identical to
    // a real orphan for one cycle. Only close a candidate that is STILL untracked a full
    // cycle later; anything the racing tick legitimately owns gets tracked by then.
    const cand = st.orphanCandidate;
    if (!cand || cand.mint !== orphan.positionMint) {
      setState({ orphanCandidate: { mint: orphan.positionMint, ts: Date.now() } });
      return { enabled: true, action: "orphan-candidate", positionMint: orphan.positionMint, reason: "untracked position observed — confirming next cycle before closing" };
    }
    if (Date.now() - cand.ts < 60 * 1000) return { enabled: true, action: "orphan-candidate", positionMint: orphan.positionMint, reason: "confirming untracked position (debounce)" };
    if (dryRun) return { enabled: true, action: "would-sweep-orphan", positionMint: orphan.positionMint };
    accrueRealizedFees(orphan); // the close collects its pending fees — bank them
    const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: orphan.positionMint, slippageBps: cfg.slippageBps });
    const sigs = []; for (const t of txs) sigs.push(await signSend(conn, t));
    setState({ orphanCandidate: null });
    await notifyDigest(`🧹 <b>Liquidity vault — orphan position closed</b>\nUntracked <code>${orphan.positionMint.slice(0, 8)}…</code> (a failed close left it behind) returned to float for redeploy.`);
    return { enabled: true, action: "orphan-sweep", positionMint: orphan.positionMint, sigs };
  }
  if (st.orphanCandidate) setState({ orphanCandidate: null });
  const base = positions.find((p) => p.positionMint === st.positionMint);
  const sol = positions.find((p) => p.positionMint === st.sol_positionMint);
  const jup = cfg.jupEnabled ? positions.find((p) => p.positionMint === st.jup_positionMint) : null;
  // base + SOL are the core pair; the JUP pool joins the evenness set only while
  // jupEnabled (owner pulled the JUP pool 2026-08-31 — two-pool mode is first-class).
  if (!base || !sol || (cfg.jupEnabled && !jup)) return { enabled: true, action: "none", reason: "need all enabled pools live to even (deploy ticks fill the gap first)" };
  const px = await jupPriceUsdMap([engine.WSOL_MINT, engine.JUP_MINT]);
  const solUsd = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice);
  const jupUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice);
  const clknUsd = base.currentPriceClkn;   // token price in USDC = USD (base pool quote)
  if (!(clknUsd > 0) || !(solUsd > 0) || !(jupUsd > 0)) return { enabled: true, action: "none", reason: "price read incomplete" };
  const pools = [
    { key: "base", quote: "USDC", v: base.clknAmount * clknUsd + base.quoteAmount, mint: st.positionMint, quoteUsd: 1 },
    { key: "sol", quote: "SOL", v: sol.clknAmount * clknUsd + sol.quoteAmount * solUsd, mint: st.sol_positionMint, quoteUsd: solUsd },
  ];
  if (jup) pools.push({ key: "jup", quote: "JUP", v: jup.clknAmount * clknUsd + jup.quoteAmount * jupUsd, mint: st.jup_positionMint, quoteUsd: jupUsd });
  pools.sort((a, b) => a.v - b.v);
  const lean = pools[0], fat = pools[pools.length - 1];
  // Stash the measured per-pool values so the deploy ticks can consult evenness
  // (deployBlockedFat below) — without this, a deploy tick happily re-feeds the
  // fat pool with the very float a shift just freed from it.
  if (!dryRun) setState({ evenVals: { ts: Date.now(), vals: Object.fromEntries(pools.map((p) => [p.key, Math.round(p.v)])) } });
  const sumV = pools.reduce((a, p) => a + p.v, 0);
  const mean = sumV / pools.length;
  const tol = cfg.poolBalanceTolPct / 100;

  // BALANCE drives SIZE (owner, 2026-08-31: "We don't need to look at caps, we need
  // to look at balance"): the per-pool deploy caps are recomputed EVERY cycle from
  // the capital that actually exists — deployed value plus free quote — split evenly
  // across the ENABLED pools. Caps stop being a hand-tuned input; they are just how
  // the deploy ticks are told each pool's share. Quote side ≈ half a pool's share.
  const float = await getFloat(conn);
  const freeQuoteUsd = Math.max(0, float.usdc - cfg.usdcFloor)
    + Math.max(0, float.sol - cfg.swapSolFloor) * solUsd
    + Math.max(0, float.jup) * jupUsd;
  // Idle quote only deploys PAIRED with the project token, so count the pair it can form
  // (quote + the matching token value), not the quote alone. Counting quote alone left the
  // caps too small to absorb the float: the deploy roll reopened at cap, left the rest in the
  // wallet, and fired again next tick — 164 close+open cycles in a day on ROSE (2026-09-02)
  // while $450 USDC and 1.9M ROSE sat idle side by side.
  const idleTokUsd = Math.max(0, float.clkn || 0) * clknUsd;
  const pairableUsd = Math.min(freeQuoteUsd, idleTokUsd);
  const totalUsd = sumV + freeQuoteUsd + pairableUsd;
  const sideTarget = Math.max(20, totalUsd / pools.length / 2);
  const wantCaps = {
    maxUsd: Math.round(sideTarget),
    solMaxSol: Number((sideTarget / solUsd).toFixed(3)),
  };
  if (jup) wantCaps.jupMaxJup = Math.round(sideTarget / jupUsd);
  const drifted = (a, b) => Math.abs(a - b) > 0.05 * Math.max(Math.abs(a), Math.abs(b), 1);
  if (!dryRun && (drifted(cfg.maxUsd, wantCaps.maxUsd) || drifted(cfg.solMaxSol, wantCaps.solMaxSol) || (jup && drifted(cfg.jupMaxJup, wantCaps.jupMaxJup)))) {
    setConfig(wantCaps);
  }
  const out = { enabled: true, pools: Object.fromEntries(pools.map((p) => [p.key, Math.round(p.v)])), mean: Math.round(mean), shareTargetUsd: Math.round(sideTarget * 2) };
  if (fat.v - lean.v < tol * Math.max(fat.v, 1)) {
    // SCALE-UP trickle (owner, 2026-08-31: as we're able, convert funds + project
    // token over to USDC and scale the pools up — "same net effect as selling").
    // Only while balanced, small clips, impact-guarded, daily-capped: the fresh USDC
    // raises the per-pool share above, and the deploy ticks grow all three into it.
    // Brand-bag invariant IN CODE (audit F8): the scale-up clip sells the project token,
    // so it requires the project's explicit tokenSellOk — never rely on scheduler topology
    // to keep this path away from CLKN.
    const scaleProj = getProject(pid());
    if (cfg.scaleUpUsdPerCycle > 0 && scaleProj && scaleProj.tokenSellOk === true && !dryRun) {
      const today = new Date().toISOString().slice(0, 10);
      const sc = st.evenScale && st.evenScale.dayStamp === today ? st.evenScale : { dayStamp: today, usd: 0 };
      const clip = Math.min(cfg.scaleUpUsdPerCycle, cfg.scaleUpDailyCapUsd - sc.usd);
      const idleTokUsd = float.clkn * clknUsd;
      if (clip >= 5 && idleTokUsd > 100) {
        try {
          const res = await manualSwap({ fromSym: "CLKN", toSym: "USDC", amountUi: clip / clknUsd, slippageBps: cfg.swapSlippageBps, maxImpactPct: 1, allowTokenSell: true, silent: true, dryRun: false });
          if (res && res.action === "swap") {
            setState({ evenScale: { dayStamp: today, usd: sc.usd + clip } });
            return { ...out, action: "scale-up", reason: `balanced — converted ~$${Math.round(clip)} idle ${tok().symbol} → USDC ($${Math.round(sc.usd + clip)}/$${cfg.scaleUpDailyCapUsd} today)`, sig: res.sig };
          }
        } catch (e) {
          if (isConfirmTimeout(e)) {
            // May have landed — count the clip against the daily cap instead of re-selling it.
            setState({ evenScale: { dayStamp: today, usd: sc.usd + clip } });
            console.warn(`[vault] scale-up clip unconfirmed (${e.message}) — counted against the daily cap; VERIFY on-chain`);
            return { ...out, action: "scale-up-unconfirmed", reason: `scale-up clip of ~$${Math.round(clip)} sent but unconfirmed — counted against today's cap; verify on-chain` };
          }
          // NEVER silent (the shift path's rule, two lines up): a refused/failed sell is reported.
          console.warn(`[vault] scale-up clip failed (${e.message}) — retrying next cycle`);
        }
      }
    }
    return { ...out, action: "even", reason: `pools within ${cfg.poolBalanceTolPct}% of each other` };
  }

  // DIRECT SHIFT (owner, 2026-09-01: "ship the convergence fix"). The old logic trimmed the
  // fat pool to the WALLET and left a later deploy tick to redeploy it — but the fat pool's
  // OWN tick re-grabbed it first, so trims never net-shrank the fat pool and the pools kept
  // drifting. Now we move value STRAIGHT from fat → lean in one cycle: remove the excess from
  // the fat pool, convert its freed quote to the lean pool's quote, and add it to the lean
  // pool (the SDK pairs the token from wallet inventory). No float round-trip, so nothing can
  // re-absorb the trim and the pools converge geometrically (~half the gap per cycle).
  const floorFor = { USDC: cfg.usdcFloor, SOL: cfg.swapSolFloor, JUP: 0 };
  const usdOf = { USDC: 1, SOL: solUsd, JUP: jupUsd };
  const today = new Date().toISOString().slice(0, 10);
  const swapsToday = st.swapDayStamp === today ? (st.swapsToday || 0) : 0;
  if (swapsToday >= cfg.maxSwapsPerDay) return { ...out, action: "capped", reason: "daily swap cap reached" };
  // SETTLE COOLDOWN: one shift then wait, so each move lands on-chain before the next cycle
  // recomputes — without it the loop over-shifts every 90s and oscillates (the v1 bug).
  if (Date.now() - (st.evenShiftTs || 0) < 5 * 60 * 1000) {
    return { ...out, action: "settling", reason: `shifted ${Math.round((Date.now() - (st.evenShiftTs || 0)) / 60000)}m ago — letting it settle` };
  }
  // DAMPED shift: a THIRD of the gap per move (geometric, no overshoot), hard-capped.
  const shiftUsd = Math.min((fat.v - lean.v) / 3, cfg.maxSwapUsdPerCycle);
  if (shiftUsd < cfg.minSwapUsd) return { ...out, action: "even", reason: `fat/lean gap $${Math.round(fat.v - lean.v)} below min shift` };
  if (dryRun) return { ...out, action: "would-shift", from: fat.key, to: lean.key, shiftUsd: Math.round(shiftUsd) };

  const steps = {};
  try {
    // 1. Remove exactly the shift amount from the fat pool → frees ROSE + fat-quote.
    steps.stage = "remove";
    const removePct = Math.max(0.02, Math.min(0.9, shiftUsd / fat.v));
    // Arm the settle cooldown BEFORE signing: it is a "we TOUCHED the pools" marker, not a
    // "we succeeded" one. removeLiquidity signs through signSend, so a confirm timeout throws
    // AFTER the withdrawal may already have landed — and with no marker the next 90s cycle
    // re-measures a fat pool that is no longer fat and shifts a second time (the over-shift
    // oscillation the cooldown exists to prevent).
    setState({ evenShiftTs: Date.now() });
    const rem = await removeLiquidity({ mint: fat.mint, pct: removePct, dryRun: false });
    steps.removed = { pool: fat.key, pct: Number(removePct.toFixed(3)), sigs: rem.sigs };
    // 2. Convert the freed fat-quote → lean-quote (skip if the two pools share a quote).
    //    Capped at the shift size so we never convert unrelated idle float.
    steps.stage = "convert";
    if (fat.quote !== lean.quote) {
      const afterRem = await getFloat(conn);
      const fatFree = Math.max(0, afterRem[fat.quote.toLowerCase()] - (floorFor[fat.quote] || 0));
      const convUi = Math.min(fatFree, (shiftUsd / 2) / usdOf[fat.quote]);   // ~half the removed value is fat-quote
      if (convUi * usdOf[fat.quote] >= cfg.minSwapUsd) {
        const sw = await manualSwap({ fromSym: fat.quote, toSym: lean.quote, amountUi: convUi, slippageBps: cfg.swapSlippageBps, dryRun: false });
        steps.converted = { from: fat.quote, to: lean.quote, sig: sw && sw.sig };
      }
    }
    // 3. Add ONLY the shift's worth of lean-quote into the lean pool (NOT all idle float —
    //    the v1 bug swept unrelated USDC in and over-inflated whatever pool was lean). Cap
    //    the add to shiftUsd, and never below the quote's floor.
    steps.stage = "add";
    const post = await getFloat(conn);
    const leanFree = Math.max(0, post[lean.quote.toLowerCase()] - (floorFor[lean.quote] || 0));
    const addAmt = Math.min(leanFree, shiftUsd / usdOf[lean.quote]);
    if (addAmt * usdOf[lean.quote] >= cfg.minSwapUsd) {
      const add = await addLiquidity({ mint: lean.mint, fromSym: lean.quote, amountUi: addAmt, dryRun: false });
      steps.added = { pool: lean.key, amount: Number(addAmt.toFixed(4)), sigs: add.sigs };
    }
    setState({ swapsToday: swapsToday + 1, swapDayStamp: today, evenShiftTs: Date.now() });
    await notifyDigest(`⚖️ <b>Pool evenness — shift</b>\n$${Math.round(shiftUsd)} moved ${fat.key}→${lean.key} (direct, no float round-trip).`);
    return { ...out, action: "shift", from: fat.key, to: lean.key, shiftUsd: Math.round(shiftUsd), steps };
  } catch (e) {
    // Any failure just leaves the removed liquidity in float — the deploy ticks reabsorb it,
    // so a mid-shift error is safe (no funds lost, worst case a one-cycle imbalance).
    // But NEVER silent: the 2026-09-01 incident was this exact failure repeating every
    // cycle for 20+ minutes with the message buried in a discarded return value.
    // A timed-out step MAY HAVE LANDED. Count it against the daily swap cap the way
    // rebalancePools does, or a landed-but-unconfirmed shift leaves the cap unbounded.
    if (isConfirmTimeout(e)) setState({ swapsToday: swapsToday + 1, swapDayStamp: today });
    console.warn(`[vault:${pid()}] evenPools shift FAILED at '${steps.stage}': ${e.message}`);
    return { ...out, action: "shift-partial", reason: `${steps.stage}: ${e.message}`, steps };
  }
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

// ── True market price (the "main LP") ─────────────────────────────────────────
// The deepest-liquidity pool on DexScreener — where real price discovery happens,
// often a NON-engine venue (e.g. Meteora for CLKN). This is the reference the engine
// pools must converge to before a full redeploy. Jupiter's price API is the fallback,
// but it lags when the Orca pools it leans on are drained, so DexScreener wins.
async function dexMarketUsd(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { usd: 0, source: null, liqUsd: 0 };
    const j = await r.json();
    const pairs = (j.pairs || []).slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const top = pairs[0];
    if (!top || !(Number(top.priceUsd) > 0)) return { usd: 0, source: null, liqUsd: 0 };
    return { usd: Number(top.priceUsd), source: `${top.dexId} ${top.baseToken?.symbol}/${top.quoteToken?.symbol}`, liqUsd: Math.round(top.liquidity?.usd || 0) };
  } catch { return { usd: 0, source: null, liqUsd: 0 }; }
}
async function marketPriceUsd(t = tok()) {
  // Jupiter is the TRUSTED price source (owner's call 2026-06-27). DexScreener's top-pair
  // priceUsd gets poisoned by mispriced pools — the recurring CLKN/JUP ~$1.19 artifact vs the
  // real ~$0.0002 — so we do NOT use it for the market reference. Jupiter only; DexScreener is
  // a last resort ONLY if Jupiter is unavailable.
  let jupU = 0;
  try { const px = await jupPriceUsdMap([t.mint]); jupU = Number(px[t.mint]?.usdPrice) || 0; } catch { /* */ }
  if (jupU > 0) return { usd: jupU, source: "jupiter", liqUsd: 0 };
  const dex = await dexMarketUsd(t.mint);
  if (dex.usd > 0) return { usd: dex.usd, source: (dex.source || "dex") + " (jupiter unavailable)", liqUsd: dex.liqUsd };
  return { usd: 0, source: null, liqUsd: 0 };
}

// ── Dislocation read: engine pools vs the main LP ─────────────────────────────
// For each pool the engine manages (base + SOL), compare its on-chain tick price to
// the true market. Powers the redeploy convergence gate and a gated status endpoint.
// Read-only; venue-aware (uses eng()). Empty pools read STALE (their tick is frozen).
async function dislocation() {
  const cfg = getConfig();
  const t = tok();
  const market = await marketPriceUsd(t);
  let solUsd = 0, btcUsd = 0, jupUsd = 0;
  try { const px = await jupPriceUsdMap([engine.WSOL_MINT, engine.CBBTC_MINT, engine.JUP_MINT]); solUsd = Number(px[engine.WSOL_MINT]?.usdPrice) || 0; btcUsd = Number(px[engine.CBBTC_MINT]?.usdPrice) || 0; jupUsd = Number(px[engine.JUP_MINT]?.usdPrice) || 0; } catch { /* */ }
  const venuePools = [{ pair: cfg.pair, feeTierPct: cfg.feeTierPct }];
  if (cfg.solEnabled) venuePools.push({ pair: `${t.symbol}/SOL`, feeTierPct: cfg.solFeeTierPct });
  if (cfg.btcEnabled) venuePools.push({ pair: `${t.symbol}/BTC`, feeTierPct: cfg.btcFeeTierPct });
  if (cfg.jupEnabled) venuePools.push({ pair: `${t.symbol}/JUP`, feeTierPct: cfg.jupFeeTierPct });
  const pools = [];
  for (const vp of venuePools) {
    try {
      const address = await resolvePoolAddress(vp);
      const pool = await eng().getPoolState(address, null, t);
      const tickUsd = vp.pair.endsWith("/SOL") ? pool.clknPriceInQuote * solUsd
                    : vp.pair.endsWith("/BTC") ? pool.clknPriceInQuote * btcUsd
                    : vp.pair.endsWith("/JUP") ? pool.clknPriceInQuote * jupUsd
                    : pool.clknPriceInQuote;
      const devPct = market.usd > 0 ? ((tickUsd - market.usd) / market.usd) * 100 : null;
      pools.push({ pair: vp.pair, feeTierPct: vp.feeTierPct, address, tickUsd, devPct });
    } catch (e) { pools.push({ pair: vp.pair, feeTierPct: vp.feeTierPct, error: e.message }); }
  }
  const devs = pools.filter((p) => typeof p.devPct === "number").map((p) => Math.abs(p.devPct));
  const maxDevPct = devs.length ? Math.max(...devs) : null;
  const tol = cfg.redeployConvergePct || 1;
  return { venue: venue(), marketUsd: market.usd, marketSource: market.source, marketLiqUsd: market.liqUsd, solUsd, pools, maxDevPct, convergeTolPct: tol, converged: maxDevPct != null && maxDevPct <= tol };
}
async function createPool({ quoteSym = "SOL", feeTierPct = 0.02, dryRun = false, priceUsd = undefined } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set for this project" };
  const t = tok();
  if (!t.mint) throw new Error("project has no token mint");
  const quote = String(quoteSym).toUpperCase();
  if (quote === "CLKN" && t.mint === engine.CLKN_MINT) throw new Error("CLKN cannot quote itself");
  const quoteMint = quote === "USDC" ? engine.USDC_MINT : quote === "BTC" ? engine.CBBTC_MINT : quote === "JUP" ? engine.JUP_MINT : quote === "CLKN" ? engine.CLKN_MINT : engine.WSOL_MINT;
  // Live market price of the token in the quote, via Jupiter (venue-agnostic).
  // priceUsd overrides the token leg: Jupiter serves a FROZEN price for tokens it
  // hasn't verified yet, and an initial tick set off-market gets arbed the moment
  // liquidity lands. The quote legs (SOL/BTC/JUP/CLKN) stay on Jupiter — those are fine.
  const px = await jupPriceUsdMap([t.mint, engine.WSOL_MINT, engine.CBBTC_MINT, engine.JUP_MINT, engine.CLKN_MINT]);
  const tokenUsd = Number(priceUsd) > 0 ? Number(priceUsd) : Number(px[t.mint] && px[t.mint].usdPrice);
  const solUsd = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice);
  const btcUsd = Number(px[engine.CBBTC_MINT] && px[engine.CBBTC_MINT].usdPrice);
  const jupUsd = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice);
  const clknUsd = Number(px[engine.CLKN_MINT] && px[engine.CLKN_MINT].usdPrice);
  if (!(tokenUsd > 0)) throw new Error("no live market price for the token (Jupiter)");
  const quoteUsd = quote === "USDC" ? 1 : quote === "BTC" ? btcUsd : quote === "JUP" ? jupUsd : quote === "CLKN" ? clknUsd : solUsd;
  const tokenPriceInQuote = quote === "USDC" ? tokenUsd : (quoteUsd > 0 ? tokenUsd / quoteUsd : 0);
  if (!(tokenPriceInQuote > 0)) throw new Error("could not derive token price in quote");

  const conn = connection();
  if (typeof eng().buildCreatePool !== "function") {
    throw new Error(`pool bootstrap not supported on the ${venue()} venue yet — create the ${t.symbol}/${quote} pool manually, then the vault can manage it`);
  }
  const built = await eng().buildCreatePool({
    owner: operator().publicKey.toBase58(),
    tokenMint: t.mint, quoteMint, feeTierPct, tokenPriceInQuote,
  });
  const out = { enabled: true, pair: `${t.symbol}/${quote}`, feeTierPct: Number(feeTierPct), poolAddress: built.poolAddress, initialTick: built.initialTick, tickSpacing: built.tickSpacing, tokenPriceInQuote };
  if (dryRun) return { ...out, action: "would-create" };
  const sig = await signSend(conn, built.txBase64);
  await notify(`🆕 <b>Liquidity vault — pool created</b>\n${t.symbol}/${quote} @ ${feeTierPct}% · price ${tokenPriceInQuote.toPrecision(5)}\nPool: <code>${built.poolAddress.slice(0, 8)}…</code>`);
  return { ...out, action: "created", sig };
}

// ── Reprice an EMPTY pool to the live market (stale-pool recovery) ────────────
// Walks a zero-liquidity pool's stale tickCurrentIndex to the market price with
// price-limited dust swaps (nothing can fill — there is no liquidity; each step
// costs only a tx fee). Refuses pools with ANY active liquidity. priceUsd is
// REQUIRED: Jupiter serves frozen prices for unverified tokens, and a wrong
// target here would re-anchor the pool off-market.
async function repricePool({ quoteSym = "USDC", feeTierPct = 0.01, priceUsd, dryRun = false, maxSteps = 60 } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set for this project" };
  const t = tok();
  if (!t.mint) throw new Error("project has no token mint");
  const quote = String(quoteSym).toUpperCase();
  const quoteMint = quote === "USDC" ? engine.USDC_MINT : quote === "BTC" ? engine.CBBTC_MINT : quote === "JUP" ? engine.JUP_MINT : engine.WSOL_MINT;
  const tokenUsd = Number(priceUsd);
  if (!(tokenUsd > 0)) throw new Error("priceUsd required (&price=<token USD>) — pass the real market price, not Jupiter's frozen one");
  let quoteUsd = 1;
  if (quote !== "USDC") {
    const px = await jupPriceUsdMap([quoteMint]);
    quoteUsd = Number(px[quoteMint] && px[quoteMint].usdPrice);
    if (!(quoteUsd > 0)) throw new Error("no live price for the quote leg");
  }
  if (typeof eng().buildRepricePlan !== "function") throw new Error(`reprice not supported on the ${venue()} venue`);
  const plan = await eng().buildRepricePlan({ tokenMint: t.mint, quoteMint, feeTierPct, tokenPriceInQuote: tokenUsd / quoteUsd });
  if (!plan.liquidityZero) throw new Error(`pool ${plan.poolAddress.slice(0, 8)}… has ACTIVE liquidity (${plan.liquidity}) — a price-walk would trade against it; this tool is for empty pools only`);
  const out = { enabled: true, pair: `${t.symbol}/${quote}`, feeTierPct: Number(feeTierPct), poolAddress: plan.poolAddress,
    currentTick: plan.currentTick, targetTick: plan.targetTick, estSteps: plan.estSteps };
  if (dryRun) return { ...out, action: "would-walk", note: "add &run=1 to execute; one dust tx per step" };
  const conn = connection();
  const sigs = [];
  let tick = plan.currentTick;
  for (let i = 0; i < maxSteps; i++) {
    const step = await eng().buildRepriceStep({ owner: operator().publicKey.toBase58(), poolAddress: plan.poolAddress, targetTick: plan.targetTick });
    if (step.done) { tick = step.tick; break; }
    sigs.push(await signSend(conn, step.txBase64));
    tick = step.stepTick;
  }
  return { ...out, action: tick === plan.targetTick ? "repriced" : "partial", finalTick: tick, txCount: sigs.length, lastSig: sigs[sigs.length - 1] || null };
}

// ── Recoup baseline admin (owner, 2026-08-31) ─────────────────────────────────
// Arms/disarms the recoup carve-out and records the protected baseline (defaults to
// the CURRENT balance at arm time, so only inventory absorbed AFTER arming is ever
// sellable). Inspect with no flags.
async function recoupBaseline({ arm = false, disarm = false, set = undefined } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  const bal = (await getFloat(connection())).clkn;
  if (arm) {
    const baseline = set != null ? Number(set) : bal;
    if (!Number.isFinite(baseline) || baseline < 0) throw new Error("bad baseline");
    setConfig({ tokenRecoupEnabled: true });
    setState({ tokenBaselineUi: baseline });
  } else if (disarm) {
    setConfig({ tokenRecoupEnabled: false });
  }
  const cfg = getConfig();
  const baseline = Number(getState().tokenBaselineUi);
  return {
    ok: true, symbol: tok().symbol, recoupEnabled: !!cfg.tokenRecoupEnabled,
    baselineUi: Number.isFinite(baseline) ? baseline : null, currentBalanceUi: bal,
    sellableUi: cfg.tokenRecoupEnabled && Number.isFinite(baseline) ? Math.max(0, bal - baseline) : 0,
  };
}

// ── Close a specific position by mint (manual cleanup / orphan removal) ───────
// Withdraws all liquidity + fees and closes the position. Clears any state pointer that
// referenced it. Useful to clear an orphaned wall left by a race, or to wind down.
async function closePosition({ mint } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  if (!mint) throw new Error("mint required");
  const conn = connection();
  const { txs } = await eng().buildClosePosition({ owner: operator().publicKey.toBase58(), positionMint: mint, slippageBps: getConfig().slippageBps });
  const sigs = [];
  for (const t of txs) sigs.push(await signSend(conn, t));
  const st = getState();
  if (st.wallMint === mint) setState({ wallMint: null });
  if (st.positionMint === mint) setState({ positionMint: null });
  if (st.sol_positionMint === mint) setState({ sol_positionMint: null });
  if (st.btc_positionMint === mint) setState({ btc_positionMint: null });
  if (st.jup_positionMint === mint) setState({ jup_positionMint: null });
  if (st.tw_wideMint === mint) setState({ tw_wideMint: null });
  if (st.tg_mint === mint) setState({ tg_mint: null });
  // Prune the closed mint from the pinned-position sets so closed walls/anchors don't linger.
  if ((st.anchorMints || []).includes(mint)) setState({ anchorMints: (getState().anchorMints || []).filter((m) => m !== mint) });
  if ((st.sellWalls || []).includes(mint)) setState({ sellWalls: (getState().sellWalls || []).filter((m) => m !== mint) });
  await notify(`🧹 <b>Liquidity vault — position closed</b>\n${tok().symbol} · <code>${mint.slice(0, 8)}…</code>`);
  return { enabled: true, action: "closed", mint, sigs };
}

// ── Add liquidity to an existing position (top-up, no close/reopen) ───────────
// Deposit `amountUi` of `fromSym` (SOL/USDC/CLKN/BTC/JUP) into an existing position's range
// via increase_liquidity; the SDK pulls the matching other side. Operator-signed.
async function addLiquidity({ mint, fromSym, amountUi, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  if (!mint) throw new Error("position mint required");
  const M = { SOL: engine.WSOL_MINT, USDC: engine.USDC_MINT, CLKN: tok().mint, BTC: engine.CBBTC_MINT, JUP: engine.JUP_MINT };
  const inputMint = M[String(fromSym).toUpperCase()];
  if (!inputMint) throw new Error("from must be SOL, USDC, CLKN, BTC, or JUP");
  if (!(Number(amountUi) > 0)) throw new Error("amount must be > 0");
  const conn = connection();
  // SLIPPAGE-HEADROOM CLAMP (audit F3): the builder's tokenMax = amount × (1 + slippage),
  // and the WSOL path pre-funds the temp account with the FULL max up front — so an add
  // sized at the whole free balance fails "insufficient funds" deterministically. Clamp
  // the input so max never exceeds what the wallet actually holds (SOL keeps gas reserve).
  const addCfg = getConfig();
  const slip = addCfg.slippageBps || 100;
  const fl = await getFloat(conn);
  const balKey = { SOL: "sol", USDC: "usdc", CLKN: "clkn", BTC: "btc", JUP: "jup" }[String(fromSym).toUpperCase()];
  const reserve = balKey === "sol" ? (addCfg.solGasReserve || 0.05) : 0;
  const maxIn = Math.max(0, ((fl[balKey] || 0) - reserve)) / (1 + slip / 10000);
  if (Number(amountUi) > maxIn) {
    if (!(maxIn > 0)) throw new Error(`no ${fromSym} available after slippage headroom + reserve`);
    amountUi = maxIn;
  }
  const built = await eng().buildIncreaseLiquidity({ owner: operator().publicKey.toBase58(), positionMint: mint, inputMint, inputAmount: String(amountUi), slippageBps: addCfg.slippageBps });
  const out = { enabled: true, action: dryRun ? "would-add" : "add", mint, from: String(fromSym).toUpperCase(), amount: Number(amountUi), estA: built.estA, estB: built.estB, maxA: built.maxA, maxB: built.maxB };
  if (dryRun) return out;
  const sigs = [];
  for (const t of built.txs) sigs.push(await signSend(conn, t));
  await notify(`➕ <b>Liquidity added</b> — ${tok().symbol} pool · ${amountUi} ${String(fromSym).toUpperCase()} into <code>${mint.slice(0, 8)}…</code>`);
  return { ...out, sigs };
}

// ── Remove liquidity from an existing position (partial, no close) ────────────
// Withdraw `pct` (0..1) of a position's liquidity back to the wallet — position stays
// open (same range). Used to shift capital between sleeves and to free reserves.
async function removeLiquidity({ mint, pct, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  if (!mint) throw new Error("position mint required");
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  if (!(p > 0)) throw new Error("pct must be between 0 and 1");
  const conn = connection();
  // Withdrawals get DOUBLE the configured slippage (capped 10%): a decrease isn't
  // sandwich-exposed like an open — the token-min guard only protects the A/B split —
  // and on an actively-arbed tight pool the split moves faster than a 90s retry loop,
  // which made the evenness shift's remove fail every cycle on 2026-09-01 (audit F4).
  const decSlip = Math.min(1000, (getConfig().slippageBps || 100) * 2);
  const built = await eng().buildDecreaseLiquidity({ owner: operator().publicKey.toBase58(), positionMint: mint, liquidityPct: p, slippageBps: decSlip });
  const out = { enabled: true, action: dryRun ? "would-remove" : "remove", mint, pct: p, estA: built.estA, estB: built.estB };
  if (dryRun) return out;
  const sigs = [];
  for (const t of built.txs) sigs.push(await signSend(conn, t));
  await notify(`➖ <b>Liquidity removed</b> — ${tok().symbol} pool · ${(p * 100).toFixed(0)}% of <code>${mint.slice(0, 8)}…</code> → wallet`);
  return { ...out, sigs };
}

// ── Switch concentration mode on command (wide / tight / mega) ────────────────
// Reshapes the two treasury sleeves to the new mode WITHOUT closing positions, so the
// NFTs (and their immutable ranges) survive and can be reused when switching back:
//   • Wide backbone (±solWidthPct) is the SAME range in every mode → never closed, only
//     resized via decrease/increase to hit its new (1-concF) share.
//   • Concentrated sleeve changes WIDTH (tight ±tightWidthPct vs mega ±megaWidthPct = two
//     distinct ranges). On a width change we removeLiquidity (100%) the old one — keeping
//     the empty NFT under its per-width slot — and fund the target width by REUSING its
//     kept NFT if price still brackets it (increase_liquidity), else minting a fresh sleeve
//     (the stale empty NFT is left intact for a later switch-back, rent ~0.002 SOL each).
// wide mode = backbone only (concentrated pulled to 0); tight/mega = backbone + sleeve.
async function concentrate({ mode, dryRun = false } = {}) {
  if (!isEnabled()) return { enabled: false, action: "none", reason: "operator not set" };
  mode = String(mode || "").toLowerCase();
  if (!["wide", "tight", "mega"].includes(mode)) throw new Error("mode must be wide | tight | mega");
  const cfg = getConfig();
  const concW = mode === "mega" ? cfg.megaWidthPct : cfg.tightWidthPct;
  const concF = mode === "wide" ? 0 : Math.max(0, Math.min(1 - cfg.concWideFloorFrac, mode === "mega" ? cfg.concMegaFrac : cfg.concTightFrac));
  const st = getState();
  const conn = connection();
  const owner = operator().publicKey.toBase58();
  const targetSlot = mode === "mega" ? "tg_megaMint" : mode === "tight" ? "tg_tightMint" : null;

  // Live pool + positions so we can value each sleeve and decide reuse vs fresh.
  const address = await resolvePoolAddress({ pair: `${tok().symbol}/SOL`, feeTierPct: cfg.solFeeTierPct });
  const pool = await eng().getPoolState(address, operator().publicKey, tok());
  const price = pool.clknPriceInQuote;
  let positions = [];
  try { positions = await eng().listPositions(owner, tok()); } catch (_) {}
  const byMint = (m) => (m ? positions.find((p) => p.positionMint === m) : null);
  const wpct = (p) => { const lo = p.lowerPriceClkn, hi = p.upperPriceClkn; return (lo > 0 && hi > lo) ? (hi - lo) / ((hi + lo) / 2) * 100 : 0; };

  // USD valuation (the treasury has no USDC pool → use Jupiter prices). For this project the
  // "token" (tok()) is cbBTC and the quote is SOL.
  let pBase = 0, pSol = 0;
  try { const px = await jupPriceUsdMap([tok().mint, engine.WSOL_MINT]); pBase = Number(px[tok().mint] && px[tok().mint].usdPrice) || 0; pSol = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice) || 0; } catch (_) {}
  const valOf = (p) => (p ? (p.clknAmount * pBase + p.quoteAmount * pSol) : 0);

  const notAnchor = (p) => !(st.anchorMints || []).includes(p.positionMint);   // owner anchors are never classified/absorbed
  const wide = byMint(st.tw_wideMint) || positions.find((p) => notAnchor(p) && wpct(p) >= cfg.solWidthPct);
  const active = byMint(st.tg_mint) || positions.find((p) => notAnchor(p) && (!wide || p.positionMint !== wide.positionMint) && wpct(p) > 0 && wpct(p) < cfg.solWidthPct);
  const isWidth = (p, halfPct) => p && Math.abs(wpct(p) / 2 - halfPct) < Math.max(halfPct * 0.5, 0.05);
  const activeIsTarget = !!targetSlot && isWidth(active, concW);
  // The kept NFT for the TARGET width (by slot, else classify any idle concentrated NFT).
  let keptTarget = byMint(st[targetSlot]);
  if (!keptTarget && targetSlot) keptTarget = positions.find((p) => notAnchor(p) && (!wide || p.positionMint !== wide.positionMint) && (!active || p.positionMint !== active.positionMint) && isWidth(p, concW));
  const tf = keptTarget ? rangeFraction(price, keptTarget.lowerPriceClkn, keptTarget.upperPriceClkn) : -1;
  const reuse = !!keptTarget && tf > cfg.edgeTriggerFrac && tf < 1 - cfg.edgeTriggerFrac;

  const wideVal = valOf(wide), activeVal = valOf(active);
  const total = wideVal + activeVal;          // deployed value to redistribute (idle float folds in next tick)
  const desiredWide = (1 - concF) * total, desiredConc = concF * total;

  if (dryRun) {
    const plan = [];
    if (active && !activeIsTarget) plan.push(`empty active ±${(wpct(active) / 2).toFixed(2)}% sleeve ($${activeVal.toFixed(0)}) → keep NFT ${active.positionMint.slice(0, 6)}…`);
    if (wide && wideVal - desiredWide > 1) plan.push(`trim wide $${(wideVal - desiredWide).toFixed(0)} (→ $${desiredWide.toFixed(0)})`);
    else if (wide && desiredWide - wideVal > 1) plan.push(`top up wide $${(desiredWide - wideVal).toFixed(0)} (→ $${desiredWide.toFixed(0)})`);
    if (concF > 0) plan.push(reuse ? `refill kept ±${concW}% NFT ${keptTarget.positionMint.slice(0, 6)}… (in range)` : `open fresh ±${concW}% sleeve ($${desiredConc.toFixed(0)})`);
    if (!plan.length) plan.push("already in target shape — no moves");
    return { enabled: true, action: "would-switch", mode, concWidthPct: concW, concFrac: concF, price,
      wideUsd: Number(wideVal.toFixed(2)), concUsd: Number(activeVal.toFixed(2)), totalUsd: Number(total.toFixed(2)),
      targetWideUsd: Number(desiredWide.toFixed(2)), targetConcUsd: Number(desiredConc.toFixed(2)), reuseTargetNft: reuse, plan };
  }

  setConfig({ concMode: mode });
  const steps = [];

  // 1) Empty the active concentrated sleeve (remove, NOT close) unless it is already the
  //    target width — keep the NFT, remembered under its own width slot, for later reuse.
  if (active && !activeIsTarget) {
    try { const r = await removeLiquidity({ mint: active.positionMint, pct: 1 }); steps.push({ emptied: active.positionMint, sigs: r.sigs }); } catch (e) { steps.push({ emptyError: e.message }); }
    const aSlot = isWidth(active, cfg.megaWidthPct) ? "tg_megaMint" : "tg_tightMint";
    setState({ [aSlot]: active.positionMint, tg_mint: null, tg_oorSince: null });
  } else if (active && activeIsTarget) {
    setState({ tg_mint: active.positionMint, [targetSlot]: active.positionMint });
  }

  // 2) Trim the wide backbone toward its new (1-concF) share (decrease, never close).
  if (wide && wideVal > 0 && wideVal - desiredWide > 1) {
    const pct = Math.max(0, Math.min(0.95, (wideVal - desiredWide) / wideVal));
    if (pct > 0.01) { try { const r = await removeLiquidity({ mint: wide.positionMint, pct }); steps.push({ wideTrim: Number((pct * 100).toFixed(1)), sigs: r.sigs }); } catch (e) { steps.push({ wideTrimError: e.message }); } }
  }

  // 3) Rebalance freed float ~50/50 SOL/base so deposits land cleanly (only if material).
  try {
    const f = await getFloat(conn);
    if (pSol > 0 && pBase > 0) {
      const diffUsd = (f.clkn * pBase) - ((f.sol - cfg.swapSolFloor) * pSol); // >0 = base heavy
      const swapUsd = Math.abs(diffUsd) / 2;
      if (swapUsd > 1) {
        // "CLKN" = the PROJECT token slot (cbBTC on the treasury), not hardcoded BTC — the old
        // literal broke on any other project AND tripped the brand-bag guard on the treasury
        // itself (M.BTC resolves to cbBTC = tok().mint there, so the sell threw). concentrate()
        // is an owner-invoked manual op redistributing its own two-asset pool; that is the
        // documented allowTokenSell carve-out (code-only flag, never reachable from a request).
        if (diffUsd > 0) await manualSwap({ fromSym: "CLKN", toSym: "SOL", amountUi: swapUsd / pBase, silent: true, allowTokenSell: true });
        else await manualSwap({ fromSym: "SOL", toSym: "CLKN", amountUi: swapUsd / pSol, silent: true });
      }
    }
  } catch (_) { /* best effort */ }

  // 4) Fund the concentrated sleeve at the target width — REUSE the kept NFT if in range,
  //    else mint fresh (leaving the stale empty NFT intact for a later switch-back).
  if (concF > 0 && !activeIsTarget) {
    if (reuse) {
      const f = await getFloat(conn);
      const solBudget = Math.max(0, Math.min(f.sol - cfg.swapSolFloor, (desiredConc / 2) / (pSol || 1)));
      try {
        if (solBudget > 0) { const r = await addLiquidity({ mint: keptTarget.positionMint, fromSym: "SOL", amountUi: solBudget }); steps.push({ refill: keptTarget.positionMint, sigs: r.sigs }); }
        setState({ tg_mint: keptTarget.positionMint, tg_lower: keptTarget.lowerPriceClkn, tg_upper: keptTarget.upperPriceClkn, [targetSlot]: keptTarget.positionMint, tg_oorSince: null });
      } catch (e) { steps.push({ refillError: e.message }); }
    } else {
      const f = await getFloat(conn);
      const t = await openTreasurySleeve(conn, address, cfg, concW, Math.max(0, f.sol - cfg.swapSolFloor) * cfg.deployFrac, f.clkn);
      if (t) { steps.push({ concOpen: t.sig, mint: t.mint }); setState({ tg_mint: t.mint, tg_lower: t.lower, tg_upper: t.upper, [targetSlot]: t.mint, tg_oorSince: null }); }
    }
  }

  // 5) If switching TOWARD wide (backbone needs more), top it up from the freed float.
  if (wide && desiredWide - wideVal > 1) {
    const f = await getFloat(conn);
    const solBudget = Math.max(0, Math.min(f.sol - cfg.swapSolFloor, ((desiredWide - wideVal) / 2) / (pSol || 1)));
    if (solBudget > 0) { try { const r = await addLiquidity({ mint: wide.positionMint, fromSym: "SOL", amountUi: solBudget }); steps.push({ wideTopUp: Number(solBudget.toFixed(4)), sigs: r.sigs }); } catch (e) { steps.push({ wideTopUpError: e.message }); } }
  }

  setState({ tw_lastRebalanceTs: Date.now() });
  await notify(`🔧 <b>Treasury → ${mode.toUpperCase()} mode</b>\nWide ±${cfg.solWidthPct}% (${Math.round((1 - concF) * 100)}%)${concF > 0 ? ` + ±${concW}% (${Math.round(concF * 100)}% concentrated · ${reuse ? "reused NFT" : "fresh"})` : " only"}\nRemove-not-close: emptied NFTs kept for reuse.`);
  return { enabled: true, action: "switched", mode, concWidthPct: concW, concFrac: concF, reused: reuse, steps };
}

// ── Status (for the gated admin endpoint) ────────────────────────────────────
async function status() {
  const cfg = getConfig();
  const st = getState();
  const out = {
    project: pid(),   // which tenant this status is for — so 'paused:false' can't be misread as the wrong project
    enabled: isEnabled(),
    operator: isEnabled() ? operator().publicKey.toBase58() : null,
    venue: venue(),
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
      btcVault: cfg.btcEnabled
        ? (st.btc_positionMint ? { mint: st.btc_positionMint, lower: st.btc_lowerPriceClkn, upper: st.btc_upperPriceClkn, feeTierPct: cfg.btcFeeTierPct } : { mint: null })
        : "disabled",
      jupVault: cfg.jupEnabled
        ? (st.jup_positionMint ? { mint: st.jup_positionMint, lower: st.jup_lowerPriceClkn, upper: st.jup_upperPriceClkn, feeTierPct: cfg.jupFeeTierPct } : { mint: null })
        : "disabled",
      dualSleeve: cfg.dualSleeveEnabled
        ? { mode: cfg.concMode, wideMint: st.tw_wideMint || null, activeConcMint: st.tg_mint || null, keptTight: st.tg_tightMint || null, keptMega: st.tg_megaMint || null }
        : "disabled",
      autoSwap: cfg.swapEnabled
        ? { targetUsdc: cfg.targetUsdc, swapsToday: st.swapDayStamp === new Date().toISOString().slice(0, 10) ? (st.swapsToday || 0) : 0 }
        : "disabled",
      buyback: cfg.buybackEnabled
        ? { buybacksToday: st.buybackDayStamp === new Date().toISOString().slice(0, 10) ? (st.buybacksToday || 0) : 0, lifetimeUsd: st.buybackLifetimeUsd || 0, lifetimeToken: st.buybackLifetimeToken || 0, lastBuybackTs: st.lastBuybackTs || null }
        : "disabled",
      anchorMints: st.anchorMints || [],     // permanent anchors — excluded from autonomous adoption/close
      sellWalls: st.sellWalls || [],         // manual single-sided CLKN sell-walls (also pinned)
      evenLast: st.evenLast || null,   // the balancer's most recent decision + reason (diagnosis surface)
      lastPrice: st.lastPrice || null,
      lastRebalanceTs: st.lastRebalanceTs || null,
      lastTickTs: st.lastTickTs || null,
      rebalanceCount: st.rebalanceCount || 0,
      dayActions: st.dayStamp === new Date().toISOString().slice(0, 10) ? (st.dayActions || 0) : 0,
    },
  };
  if (isEnabled()) {
    // Run the on-chain sub-reads CONCURRENTLY (was sequential — the main cause of the
    // dashboard's slow load). Each is independent; failures degrade gracefully.
    const [fl, co, ea, pp] = await Promise.all([
      getFloat(connection()).catch((e) => ({ error: e.message })),
      costs().catch((e) => ({ error: e.message })),
      earnings().catch((e) => ({ error: e.message })),
      publicPositions().catch(() => null),
    ]);
    out.float = fl; out.costs = co; out.earnings = ea;
    // Per-pool deployed $ value (for the dashboard), keyed by quote symbol + total.
    if (pp && Array.isArray(pp.positions)) {
      const pv = {};
      for (const p of pp.positions) { if (p.quoteSymbol) pv[p.quoteSymbol] = (pv[p.quoteSymbol] || 0) + (Number(p.valueUsd) || 0); }
      out.poolValues = pv;
      out.totalDeployedUsd = pp.totalUsd;
    }
    // Net P&L = LP fees earned (realized + pending) − tx-fee cost of running it.
    const earned = out.earnings && typeof out.earnings.totalEarnedUsd === "number" ? out.earnings.totalEarnedUsd : null;
    const spent = out.costs && out.costs.lifetime && typeof out.costs.lifetime.usd === "number" ? out.costs.lifetime.usd : null;
    out.netPnlUsd = (earned != null && spent != null) ? earned - spent : null;
  }
  return out;
}

// Echo the project id so a pause/resume response can NEVER look successful for the
// wrong tenant — the past incident was a bare {paused:true} that hid which project it hit.
function pause() { setState({ paused: true }); return { paused: true, project: pid() }; }
function resume() { setState({ paused: false }); return { paused: false, project: pid() }; }

// ── Public, sanitized positions view (safe to show in the group chat) ─────────
// Returns ONLY pair / range / in-range — never the wallet address, balances, or
// position sizes. Used by the public /liquidity Telegram command.
// Short cache for the public depth view (keyed by token mint). Cuts RPC load from
// /liquidity + dashboards + the portal all polling, and — crucially — serves the last
// good snapshot when the RPC provider rate-limits (429), so we never falsely report
// "no positions" during a quota blip. Read-only view; the tick/rebalance path is separate.
const _posCache = new Map();
const POS_CACHE_TTL = 30000;
async function publicPositions() {
  if (!isEnabled()) return { enabled: false, positions: [] };
  let cacheKey = "default";
  try { cacheKey = tok().mint; } catch (_) {}
  const cached = _posCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < POS_CACHE_TTL) return { ...cached.data, cached: true };
  let positions = [];
  try { positions = await eng().listPositions(operator().publicKey.toBase58(), tok()); }
  catch (e) {
    // RPC failed (e.g. 429 / quota) — serve the last good snapshot if we have one so the
    // public view stays useful instead of falsely showing "no positions".
    if (cached) return { ...cached.data, stale: true, staleSeconds: Math.round((Date.now() - cached.ts) / 1000), error: e.message };
    return { enabled: true, error: e.message, positions: [] };
  }
  // CLKN price in USD = its price in USDC (from any CLKN/USDC position).
  const usdcPos = positions.find((p) => p.quoteSymbol === "USDC");
  let clknUsd = usdcPos ? usdcPos.currentPriceClkn : 0;
  // SOL price in USD = clknUsd ÷ (CLKN price in SOL).
  const solPos = positions.find((p) => p.quoteSymbol === "SOL");
  let solUsd = (solPos && solPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / solPos.currentPriceClkn : 0;
  // cbBTC price in USD = clknUsd ÷ (CLKN price in cbBTC).
  const btcPos = positions.find((p) => p.quoteSymbol === "BTC");
  let btcUsd = (btcPos && btcPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / btcPos.currentPriceClkn : 0;
  // JUP price in USD = clknUsd ÷ (CLKN price in JUP).
  const jupPos = positions.find((p) => p.quoteSymbol === "JUP");
  let jupUsd = (jupPos && jupPos.currentPriceClkn > 0 && clknUsd > 0) ? clknUsd / jupPos.currentPriceClkn : 0;
  // Fallback to Jupiter for any price not derivable from a pool — e.g. a project with NO
  // USDC pool (the treasury cbBTC/SOL vault), where clknUsd would be 0 and every position
  // would mis-value to $0. Here the project "token" may itself be cbBTC.
  if (clknUsd <= 0 || solUsd <= 0 || btcUsd <= 0 || jupUsd <= 0) {
    try {
      const px = await jupPriceUsdMap([tok().mint, engine.WSOL_MINT, engine.CBBTC_MINT, engine.JUP_MINT]);
      if (clknUsd <= 0) clknUsd = Number(px[tok().mint] && px[tok().mint].usdPrice) || 0;
      if (solUsd <= 0)  solUsd  = Number(px[engine.WSOL_MINT] && px[engine.WSOL_MINT].usdPrice) || 0;
      if (btcUsd <= 0)  btcUsd  = Number(px[engine.CBBTC_MINT] && px[engine.CBBTC_MINT].usdPrice) || 0;
      if (jupUsd <= 0)  jupUsd  = Number(px[engine.JUP_MINT] && px[engine.JUP_MINT].usdPrice) || 0;
    } catch { /* leave as derived */ }
  }
  const st = getState();
  let totalUsd = 0;
  const out = positions.map((p) => {
    const quoteUsd = p.quoteSymbol === "USDC" ? p.quoteAmount : p.quoteSymbol === "BTC" ? p.quoteAmount * btcUsd : p.quoteSymbol === "JUP" ? p.quoteAmount * jupUsd : p.quoteAmount * solUsd;
    const valueUsd = (p.clknAmount * clknUsd) + quoteUsd;
    totalUsd += valueUsd;
    // Role so the public view can label the ask wall distinctly (it shares the base pool).
    const role = p.positionMint === st.wallMint ? "askwall"
               : (st.sellWalls || []).includes(p.positionMint) ? "wall"
               : p.positionMint === st.sol_positionMint ? "sol"
               : p.positionMint === st.btc_positionMint ? "btc"
               : p.positionMint === st.jup_positionMint ? "jup"
               : p.positionMint === st.tw_wideMint ? "wide"
               : p.positionMint === st.tg_mint ? "tight"
               : "base";
    return {
      pair: p.pair, quoteSymbol: p.quoteSymbol, role, positionMint: p.positionMint,
      lower: p.lowerPriceClkn, upper: p.upperPriceClkn, current: p.currentPriceClkn,
      clknAmount: p.clknAmount, quoteAmount: p.quoteAmount,
      valueUsd, inRange: p.inRange,
    };
  });
  const data = { enabled: true, positions: out, totalUsd, clknUsd, solUsd, btcUsd, jupUsd };
  _posCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// Temporarily route ALL engine alerts to the main community chat (test/transparency
// window). hours=0 cancels. Self-reverts when the window passes; persisted in kv.
function routeAlertsToMain(hours) {
  const h = Math.max(0, Math.min(168, Number(hours) || 0));
  const until = h > 0 ? Date.now() + h * 3600 * 1000 : 0;
  kv.set("engineAlertsToMainUntil", until);
  return { active: until > Date.now(), until, untilISO: until ? new Date(until).toISOString() : null, hours: h };
}

module.exports = {
  // Explicit-projectId helpers (default to "clkn" outside a scope).
  isEnabled, operatorPubkey, operatorPubkeys, routeAlertsToMain,
  getConfig, setConfig,
  listProjects, getProject, registerProject, removeProject,
  DEFAULT_CONFIG,
  transferDecimals,
  // Internals the engine simulator drives directly (scripts/engine-sim-test.cjs) — the
  // confirm-timeout tagging, which no source grep can check. Not part of the HTTP surface;
  // do not call from server.js.
  _internals: { confirmSig, isConfirmTimeout },
  // Project-scoped operations — each runs inside its project's ALS context, so all
  // the internal getConfig()/getState()/operator()/tok() calls resolve to it.
  tick: (o = {}) => withProject(o.projectId, () => tick(o)),
  tickAskWall: (o = {}) => withProject(o.projectId, () => tickAskWall(o)),
  tickSol: (o = {}) => withProject(o.projectId, () => tickSol(o)),
  tickBtc: (o = {}) => withProject(o.projectId, () => tickBtc(o)),
  tickJup: (o = {}) => withProject(o.projectId, () => tickJup(o)),
  tickTreasury: (o = {}) => withProject(o.projectId, () => withTickLock(o.projectId || "clkn", o.dryRun, () => tickTreasury(o))),
  rebalancePools: (o = {}) => withProject(o.projectId, () => rebalancePools(o)),
  evenPools: (o = {}) => withProject(o.projectId, async () => {
    // Record the outcome in state (surfaced via /vault/status) — the balancer ran dark
    // for hours on 2026-09-01 while its shift silently failed every cycle; never again.
    const r = await evenPools(o);
    try { setState({ evenLast: { ts: Date.now(), action: r && r.action, reason: String((r && r.reason) || "").slice(0, 300), pools: (r && r.pools) || null } }); } catch { }
    return r;
  }),
  manualSwap: (o = {}) => withProject(o.projectId, () => manualSwap(o)),
  sellClip: (o = {}) => withProject(o.projectId, () => sellClip(o)),
  meteoraKeepalive: (o = {}) => withProject(o.projectId, () => meteoraKeepalive(o)),
  transferToProject: (o = {}) => withProject(o.projectId, () => transferToProject(o)),
  buyback: (o = {}) => withProject(o.projectId, () => buyback(o)),
  flushNotifyDigest: (o = {}) => withProject(o.projectId, () => flushNotifyDigest(o)),
  createPool: (o = {}) => withProject(o.projectId, () => createPool(o)),
  repricePool: (o = {}) => withProject(o.projectId, () => repricePool(o)),
  recoupBaseline: (o = {}) => withProject(o.projectId, () => recoupBaseline(o)),
  closePosition: (o = {}) => withProject(o.projectId, () => closePosition(o)),
  openAnchor: (o = {}) => withProject(o.projectId, () => openAnchor(o)),
  openWall: (o = {}) => withProject(o.projectId, () => openWall(o)),
  addLiquidity: (o = {}) => withProject(o.projectId, () => addLiquidity(o)),
  removeLiquidity: (o = {}) => withProject(o.projectId, () => removeLiquidity(o)),
  concentrate: (o = {}) => withProject(o.projectId, () => withTickLock(o.projectId || "clkn", o.dryRun, () => concentrate(o))),
  status: (projectId) => withProject(projectId, () => status()),
  dislocation: (projectId) => withProject(projectId, () => dislocation()),
  costs: (projectId) => withProject(projectId, () => costs()),
  earnings: (projectId) => withProject(projectId, () => earnings()),
  lpVsHodl: (o = {}) => withProject(o.projectId, () => lpVsHodl(o)),
  lpVsHodlDaily: (o = {}) => withProject(o.projectId, () => lpVsHodlDaily(o)),
  publicPositions: (projectId) => withProject(projectId, () => publicPositions()),
  listModes: (projectId) => withProject(projectId, () => listModes()),
  previewMode: (name, tilt, projectId) => withProject(projectId, () => previewMode(name, tilt)),
  applyMode: (name, tilt, projectId) => withProject(projectId, () => applyMode(name, tilt)),
  pause: (projectId) => withProject(projectId, () => pause()),
  resume: (projectId) => withProject(projectId, () => resume()),
  // Persisted timestamp of the last base tick (survives redeploys) — used by the boot-tick
  // guard so frequent redeploys don't fire a redundant cold cycle each time.
  lastTickTs: (projectId) => (getState(projectId) || {}).lastTickTs || null,
};
