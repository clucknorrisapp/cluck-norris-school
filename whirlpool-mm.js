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

// Which project an admin request targets (default the built-in CLKN project).
function proj(req) { return (req.query.project || (req.body && req.body.project) || "clkn"); }

const router = express.Router();
router.use(express.json());

// GET /api/whirlpool/pools[?token=MINT&symbol=SYM] — every USDC/SOL Whirlpool for the
// token (defaults to CLKN), with fee tier, tick spacing, current price, and whether the
// pool is empty. Also a feasibility check for onboarding: an empty list means the token
// has NO Orca pool yet (it must be created before the engine can manage it).
router.get("/pools", async (req, res) => {
  try {
    const tok = req.query.token && isPubkey(req.query.token)
      ? { mint: String(req.query.token), symbol: String(req.query.symbol || "TOKEN").toUpperCase().slice(0, 10), quoteMints: [wp.USDC_MINT, wp.WSOL_MINT] }
      : undefined;
    const pools = await wp.discoverPools(tok);
    res.json({ token: tok ? tok.mint : wp.CLKN_MINT, hasOrcaPools: pools.length > 0, pools });
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
  try { res.json(await vault.status(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "status failed" }); }
});

// GET /api/whirlpool/vault/costs?key=… — PRIVATE operational-cost readout: tx
// fees the engine has paid moving its own positions (today + lifetime, SOL + USD).
// Gated like the rest of the vault admin (404 without the key); never public.
router.get("/vault/costs", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.costs(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "costs failed" }); }
});

// GET /api/whirlpool/vault/earnings?key=… — PRIVATE earnings readout: LP fees the
// engine has EARNED — pending (uncollected, real-time) + realized (collected on
// past rolls), valued in USD. Gated; never public. Pair with /costs for net P&L.
router.get("/vault/earnings", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.earnings(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "earnings failed" }); }
});

// GET /api/whirlpool/vault/tick?key=…[&run=1] — run one cycle. Without run=1 it's
// a DRY RUN (plans, signs nothing). With run=1 it may actually roll the position.
router.get("/vault/tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tick({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "tick failed" }); }
});

// GET /api/whirlpool/vault/wall-tick?key=…[&run=1] — run one ask-wall cycle.
// DRY RUN unless run=1.
router.get("/vault/wall-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickAskWall({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "wall tick failed" }); }
});

// GET /api/whirlpool/vault/sol-tick?key=…[&run=1] — run one CLKN/SOL cycle.
// DRY RUN unless run=1.
router.get("/vault/sol-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickSol({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "sol tick failed" }); }
});

// GET /api/whirlpool/vault/rebalance?key=…[&run=1] — run one inventory rebalance
// (swap SOL→USDC toward target). DRY RUN unless run=1.
router.get("/vault/rebalance", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.rebalancePools({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
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
      projectId: proj(req),
    }));
  } catch (e) { res.status(500).json({ error: e.message || "swap failed" }); }
});

// POST /api/whirlpool/vault/pause?key=… and /resume?key=… — kill switch.
router.post("/vault/pause", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  res.json(vault.pause(proj(req)));
});
router.post("/vault/resume", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  res.json(vault.resume(proj(req)));
});

// GET /api/whirlpool/vault/mode?key=… — list available modes + tilts + the current
// active mode. Non-destructive read.
router.get("/vault/mode", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(vault.listModes(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "mode list failed" }); }
});

// POST /api/whirlpool/vault/mode?key=&name=steady[&tilt=distribution][&run=1]
// DRY RUN by default — returns the exact config diff WITHOUT applying. With run=1 it
// applies the preset (snapshotting the prior config so name=custom can restore it).
// name=custom restores that snapshot. Reserves / fee tier / pair are never touched.
router.post("/vault/mode", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  const name = String(req.query.name || (req.body && req.body.name) || "").toLowerCase();
  const tiltRaw = req.query.tilt || (req.body && req.body.tilt);
  const tilt = tiltRaw ? String(tiltRaw).toLowerCase() : null;
  if (!name) return res.status(400).json({ error: "name required (active|steady|foundation|custom)" });
  try {
    if (req.query.run === "1") return res.json({ applied: true, ...vault.applyMode(name, tilt, proj(req)) });
    return res.json({ applied: false, preview: vault.previewMode(name, tilt, proj(req)) });
  } catch (e) { res.status(400).json({ error: e.message || "mode failed" }); }
});

// GET /api/whirlpool/vault/projects?key=… — list registered projects (multi-tenant).
// "clkn" is the built-in default (legacy keys + MM_OPERATOR_SECRET); others are added.
router.get("/vault/projects", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    const projects = vault.listProjects();
    // Annotate each with whether its operator key is loaded (never expose the key).
    const out = {};
    for (const [id, p] of Object.entries(projects)) out[id] = { ...p, operatorLoaded: !!vault.operatorPubkey(id), operator: vault.operatorPubkey(id) };
    res.json({ projects: out });
  } catch (e) { res.status(500).json({ error: e.message || "projects failed" }); }
});

// POST /api/whirlpool/vault/projects?key=… — register/update a project (body: {id,
// label, tokenMint, quoteMints?, operatorEnv?, active?}). The operator SECRET lives
// in the named env var (operatorEnv), never in this request or the registry.
router.post("/vault/projects", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json({ project: vault.registerProject(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message || "register failed" }); }
});

// DELETE /api/whirlpool/vault/projects/:id?key=… — remove a project (not "clkn").
router.delete("/vault/projects/:id", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json({ removed: vault.removeProject(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message || "remove failed" }); }
});

// POST /api/whirlpool/vault/config?key=… — patch config (body = partial config).
router.post("/vault/config", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json({ config: vault.setConfig(req.body || {}, proj(req)) }); }
  catch (e) { res.status(400).json({ error: e.message || "config failed" }); }
});

module.exports = { router, vault };
