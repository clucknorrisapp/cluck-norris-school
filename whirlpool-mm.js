// ── Liquidity Engine router ──────────────────────────────────────────────────
// HTTP surface for the Orca Whirlpools market-maker tool (lib/orca-whirlpools.js).
// Mounted by server.js at /api/whirlpool. Non-custodial throughout: the only
// mutating endpoints (/open, /close) return UNSIGNED transactions for the
// operator's wallet to sign in the browser — no keys live here.
//
// Honest-by-design: this provides real two-sided depth that fills real traders.
// It is not a self-trading volume bot. See lib/orca-whirlpools.js for the why.
const express = require("express");
const { PublicKey } = require("@solana/web3.js");
const wp = require("./lib/orca-whirlpools");
const vault = require("./lib/whirlpool-vault");

function isPubkey(s) {
  try { new PublicKey(s); return true; } catch { return false; }
}

// Admin gate for the autonomous-vault endpoints. Same convention as /api/claims:
// a wrong/absent key returns 404 (not 401), so the endpoints are invisible without it.
function adminOK(req) {
  const k = process.env.PREMIUM_ACCESS_KEY;
  return !!k && req.query.key === k;
}

const router = express.Router();
router.use(express.json());

// GET /api/whirlpool/pools — every CLKN/USDC + CLKN/SOL Whirlpool, with fee tier,
// tick spacing, current CLKN price, and whether the pool is empty (no depth).
router.get("/pools", async (req, res) => {
  try {
    res.json({ pools: await wp.discoverPools() });
  } catch (e) {
    console.error("[whirlpool] pools failed:", e);
    res.status(502).json({ error: e.message || "Could not load pools" });
  }
});

// GET /api/whirlpool/pool/:address — live on-chain state for one pool.
router.get("/pool/:address", async (req, res) => {
  try {
    if (!isPubkey(req.params.address)) return res.status(400).json({ error: "Invalid pool address" });
    res.json({ pool: await wp.getPoolState(req.params.address) });
  } catch (e) {
    console.error("[whirlpool] pool state failed:", e);
    res.status(502).json({ error: e.message || "Could not read pool" });
  }
});

// GET /api/whirlpool/ranges/:address?widthPct=15 — suggested single-sided and
// balanced ranges (tick bounds + human CLKN-price bounds) for the pool.
router.get("/ranges/:address", async (req, res) => {
  try {
    if (!isPubkey(req.params.address)) return res.status(400).json({ error: "Invalid pool address" });
    const st = await wp.getPoolState(req.params.address);
    res.json({ ranges: wp.suggestRanges(st, req.query.widthPct), state: st });
  } catch (e) {
    console.error("[whirlpool] ranges failed:", e);
    res.status(502).json({ error: e.message || "Could not build ranges" });
  }
});

// POST /api/whirlpool/quote — how much of each token a deposit needs for a range.
// Body: { address, inputMint, inputAmount, lowerTick, upperTick, slippageBps? }
router.post("/quote", async (req, res) => {
  try {
    const { address, inputMint, inputAmount, lowerTick, upperTick, slippageBps } = req.body || {};
    if (!isPubkey(address)) return res.status(400).json({ error: "Invalid pool address" });
    if (!isPubkey(inputMint)) return res.status(400).json({ error: "Invalid input token" });
    if (!(Number(inputAmount) > 0)) return res.status(400).json({ error: "Enter a deposit amount" });
    if (!Number.isFinite(Number(lowerTick)) || !Number.isFinite(Number(upperTick)))
      return res.status(400).json({ error: "Missing tick range" });
    res.json({ quote: await wp.quote({ address, inputMint, inputAmount, lowerTick, upperTick, slippageBps }) });
  } catch (e) {
    console.error("[whirlpool] quote failed:", e);
    res.status(502).json({ error: e.message || "Quote failed" });
  }
});

// POST /api/whirlpool/open — build an UNSIGNED open-position transaction.
// Body: { owner, address, lowerTick, upperTick, inputMint, inputAmount, slippageBps? }
router.post("/open", async (req, res) => {
  try {
    const { owner, address, lowerTick, upperTick, inputMint, inputAmount, slippageBps } = req.body || {};
    if (!isPubkey(owner)) return res.status(400).json({ error: "Connect a wallet first" });
    if (!isPubkey(address)) return res.status(400).json({ error: "Invalid pool address" });
    if (!isPubkey(inputMint)) return res.status(400).json({ error: "Invalid input token" });
    if (!(Number(inputAmount) > 0)) return res.status(400).json({ error: "Enter a deposit amount" });
    if (!Number.isFinite(Number(lowerTick)) || !Number.isFinite(Number(upperTick)))
      return res.status(400).json({ error: "Missing tick range" });
    const built = await wp.buildOpenPosition({ owner, address, lowerTick, upperTick, inputMint, inputAmount, slippageBps });
    res.json(built);
  } catch (e) {
    console.error("[whirlpool] open build failed:", e);
    res.status(502).json({ error: e.message || "Could not build the open-position transaction" });
  }
});

// GET /api/whirlpool/positions?owner=<addr> — the wallet's open CLKN positions.
router.get("/positions", async (req, res) => {
  try {
    if (!isPubkey(req.query.owner || "")) return res.status(400).json({ error: "Invalid wallet address" });
    res.json({ positions: await wp.listPositions(req.query.owner) });
  } catch (e) {
    console.error("[whirlpool] positions failed:", e);
    res.status(502).json({ error: e.message || "Could not load positions" });
  }
});

// POST /api/whirlpool/close — build UNSIGNED close-position transaction(s).
// Body: { owner, positionMint, slippageBps? } → { txs: [base64, ...] }
router.post("/close", async (req, res) => {
  try {
    const { owner, positionMint, slippageBps } = req.body || {};
    if (!isPubkey(owner)) return res.status(400).json({ error: "Connect a wallet first" });
    if (!isPubkey(positionMint)) return res.status(400).json({ error: "Invalid position" });
    res.json(await wp.buildClosePosition({ owner, positionMint, slippageBps }));
  } catch (e) {
    console.error("[whirlpool] close build failed:", e);
    res.status(502).json({ error: e.message || "Could not build the close transaction" });
  }
});

// ── Autonomous vault admin (gated on PREMIUM_ACCESS_KEY) ─────────────────────
// GET /api/whirlpool/vault/status?key=… — operator wallet, float, config, position.
router.get("/vault/status", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.status()); }
  catch (e) { res.status(500).json({ error: e.message || "status failed" }); }
});

// GET /api/whirlpool/vault/costs?key=… — PRIVATE operational-cost readout: tx
// fees the engine has paid moving its own positions (today + lifetime, SOL + USD).
// Gated like the rest of the vault admin (404 without the key); never public.
router.get("/vault/costs", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.costs()); }
  catch (e) { res.status(500).json({ error: e.message || "costs failed" }); }
});

// GET /api/whirlpool/vault/earnings?key=… — PRIVATE earnings readout: LP fees the
// engine has EARNED — pending (uncollected, real-time) + realized (collected on
// past rolls), valued in USD. Gated; never public. Pair with /costs for net P&L.
router.get("/vault/earnings", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.earnings()); }
  catch (e) { res.status(500).json({ error: e.message || "earnings failed" }); }
});

// GET /api/whirlpool/vault/tick?key=…[&run=1] — run one cycle. Without run=1 it's
// a DRY RUN (plans, signs nothing). With run=1 it may actually roll the position.
router.get("/vault/tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tick({ dryRun: req.query.run !== "1" })); }
  catch (e) { res.status(500).json({ error: e.message || "tick failed" }); }
});

// GET /api/whirlpool/vault/wall-tick?key=…[&run=1] — run one ask-wall cycle.
// DRY RUN unless run=1.
router.get("/vault/wall-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickAskWall({ dryRun: req.query.run !== "1" })); }
  catch (e) { res.status(500).json({ error: e.message || "wall tick failed" }); }
});

// GET /api/whirlpool/vault/sol-tick?key=…[&run=1] — run one CLKN/SOL cycle.
// DRY RUN unless run=1.
router.get("/vault/sol-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickSol({ dryRun: req.query.run !== "1" })); }
  catch (e) { res.status(500).json({ error: e.message || "sol tick failed" }); }
});

// GET /api/whirlpool/vault/rebalance?key=…[&run=1] — run one inventory rebalance
// (swap SOL→USDC toward target). DRY RUN unless run=1.
router.get("/vault/rebalance", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.rebalancePools({ dryRun: req.query.run !== "1" })); }
  catch (e) { res.status(500).json({ error: e.message || "rebalance failed" }); }
});

// GET /api/whirlpool/vault/swap?key=…&from=SOL&to=USDC&amount=315[&slippage=100][&run=1]
// Ad-hoc swap between SOL/USDC/CLKN via Jupiter. DRY RUN unless run=1.
router.get("/vault/swap", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.manualSwap({
      fromSym: String(req.query.from || "").toUpperCase(),
      toSym: String(req.query.to || "").toUpperCase(),
      amountUi: req.query.amount,
      slippageBps: Number(req.query.slippage) || 100,
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "swap failed" }); }
});

// POST /api/whirlpool/vault/pause?key=… and /resume?key=… — kill switch.
router.post("/vault/pause", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  res.json(vault.pause());
});
router.post("/vault/resume", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  res.json(vault.resume());
});

// POST /api/whirlpool/vault/config?key=… — patch config (body = partial config).
router.post("/vault/config", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json({ config: vault.setConfig(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message || "config failed" }); }
});

module.exports = { router, vault };
