// ── Liquidity Engine router ──────────────────────────────────────────────────
// HTTP surface for the Orca Whirlpools market-maker tool (lib/orca-whirlpools.js).
// Mounted by server.js at /api/whirlpool. Non-custodial throughout: the only
// mutating endpoints (/open, /close) return UNSIGNED transactions for the
// operator's wallet to sign in the browser — no keys live here.
//
// Honest-by-design: this provides real two-sided depth that fills real traders.
// It is not a self-trading volume bot. See lib/orca-whirlpools.js for the why.
const express = require("express");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
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

// ── Client portal auth (wallet-signature) ────────────────────────────────────
// A project owner proves control of their wallet by signing a fresh message; we then
// issue a short-lived HMAC session token that scopes them to THEIR project only. No
// admin key needed. The HMAC key is the server secret (PREMIUM_ACCESS_KEY).
function clientMsg(wallet, ts) {
  return `Cluck Norris Liquidity Engine\nSign in to manage your project's liquidity.\n\nWallet: ${wallet}\nTime: ${ts}`;
}
function verifyWalletSig(message, signatureB64, walletB58) {
  try {
    const msg = new TextEncoder().encode(message);
    const sig = Uint8Array.from(Buffer.from(String(signatureB64), "base64"));
    const pub = bs58.decode(walletB58);
    return sig.length === 64 && nacl.sign.detached.verify(msg, sig, pub);
  } catch { return false; }
}
// HMAC secret for the operator-portal client tokens. NO fallback constant: if the
// admin key isn't configured we refuse to issue OR verify tokens (fail closed),
// rather than signing with a guessable value that would let anyone forge a session.
const TOKEN_SECRET = () => process.env.PREMIUM_ACCESS_KEY || null;
function issueClientToken(pid, wallet, ttlMs = 12 * 3600 * 1000) {
  const secret = TOKEN_SECRET();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ pid, w: wallet, exp: Date.now() + ttlMs })).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${mac}`;
}
function clientAuth(req) {
  try {
    const secret = TOKEN_SECRET();
    if (!secret) return null;
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.token || (req.body && req.body.token) || "");
    const [payload, mac] = String(token).split(".");
    if (!payload || !mac) return null;
    const expect = crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
    const a = Buffer.from(mac), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!p.exp || Date.now() > p.exp) return null;
    return p; // { pid, w, exp }
  } catch { return null; }
}
// Find the project a wallet owns (ownerWallet may be a comma-separated list).
function projectOwnedBy(wallet) {
  const projs = vault.listProjects();
  return Object.keys(projs).find((id) => {
    const ow = projs[id] && projs[id].ownerWallet;
    return ow && String(ow).split(",").map((s) => s.trim()).includes(wallet);
  }) || null;
}

const router = express.Router();
router.use(express.json());

// ── Public engine LOCK (owner's call) ────────────────────────────────────────
// The Liquidity Engine is in private testing — the public, non-custodial build/use
// path is disabled so no one can run it right now. The owner's autonomous vault
// (server-side schedulers + the key-gated /vault/* endpoints) is unaffected; only
// the user-facing build endpoints are blocked. Flip ENGINE_PUBLIC_LOCKED=false to
// reopen. Interested users are routed to Telegram / X for access.
const ENGINE_PUBLIC_LOCKED = true;
function engineLock(req, res) {
  return res.status(403).json({
    locked: true,
    error: "The Cluck Norris Liquidity Engine is in private testing right now. Want details or access? Ask in our Telegram (https://t.me/FireChicken007) or DM @firechicken007 on X.",
  });
}
if (ENGINE_PUBLIC_LOCKED) {
  ["/quote", "/open", "/close"].forEach((p) => router.all(p, engineLock));
}

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

// GET /api/whirlpool/vault/dislocation?key=&project=… — how far each engine pool's
// on-chain tick sits from the true market (the deepest "main LP", e.g. Meteora), with
// a convergence verdict. The redeploy gate + a quick post-trade dislocation check.
router.get("/vault/dislocation", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.dislocation(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "dislocation failed" }); }
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

// GET /api/whirlpool/vault/btc-tick?key=…[&run=1] — run one CLKN/cbBTC cycle.
// DRY RUN unless run=1.
router.get("/vault/btc-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickBtc({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "btc tick failed" }); }
});

// GET /api/whirlpool/vault/jup-tick?key=…[&run=1] — run one CLKN/JUP cycle.
// DRY RUN unless run=1.
router.get("/vault/jup-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickJup({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "jup tick failed" }); }
});

// GET /api/whirlpool/vault/treasury-tick?key=…[&run=1] — run one dual-sleeve cycle
// (wide + tight, cbBTC/SOL). DRY RUN unless run=1. Needs dualSleeveEnabled on the project.
router.get("/vault/treasury-tick", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.tickTreasury({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "treasury tick failed" }); }
});

// GET /api/whirlpool/vault/rebalance?key=…[&run=1] — run one inventory rebalance
// (swap SOL→USDC toward target). DRY RUN unless run=1.
router.get("/vault/rebalance", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.rebalancePools({ dryRun: req.query.run !== "1", projectId: proj(req) })); }
  catch (e) { res.status(500).json({ error: e.message || "rebalance failed" }); }
});

// GET /api/whirlpool/vault/transfer?key=…&project=<from>&toProject=<to>&sym=SOL|USDC|CLKN&amount=<n|all>[&run=1]
// Moves funds between OUR OWN project operator wallets (allow-listed destinations only).
router.get("/vault/transfer", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.transferToProject({
      projectId: proj(req),
      toProjectId: String(req.query.toProject || ""),
      sym: String(req.query.sym || "SOL"),
      amountUi: req.query.amount === "all" ? "all" : Number(req.query.amount),
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "transfer failed" }); }
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

// GET /api/whirlpool/vault/positions?key=&project=<id> — per-position depth (the same
// sanitized shape the /liquidity command uses: pair, role, $depth, amounts, in-range).
router.get("/vault/positions", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.publicPositions(proj(req))); }
  catch (e) { res.status(500).json({ error: e.message || "positions failed" }); }
});

// GET /api/whirlpool/vault/buyback?key=&project=<id>[&run=1] — flywheel buyback.
// DRY RUN unless run=1. Spends only USDC above floor+reserve; needs buybackEnabled.
router.get("/vault/buyback", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(await vault.buyback({ projectId: proj(req), dryRun: req.query.run !== "1" })); }
  catch (e) { res.status(500).json({ error: e.message || "buyback failed" }); }
});

// ── Client portal (wallet-auth; no admin key) ────────────────────────────────
// POST /vault/client/login  { wallet, signature(base64), ts } → { token, project }
router.post("/vault/client/login", (req, res) => {
  const { wallet, signature, ts } = req.body || {};
  if (!wallet || !signature || !ts) return res.status(400).json({ error: "wallet, signature, ts required" });
  if (!isPubkey(wallet)) return res.status(400).json({ error: "invalid wallet" });
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return res.status(400).json({ error: "stale timestamp — please retry" });
  if (!verifyWalletSig(clientMsg(wallet, ts), signature, wallet)) return res.status(401).json({ error: "signature did not verify" });
  const pid = projectOwnedBy(wallet);
  if (!pid) return res.status(403).json({ error: "this wallet isn't registered as a project owner" });
  const p = vault.listProjects()[pid];
  const token = issueClientToken(pid, wallet);
  if (!token) return res.status(503).json({ error: "operator portal unavailable — server admin key not configured" });
  res.json({ token, project: { id: pid, symbol: p.symbol, label: p.label }, expiresInSec: 12 * 3600 });
});
// The signing message the client must produce (handy for the frontend / debugging).
router.get("/vault/client/message", (req, res) => {
  const wallet = String(req.query.wallet || ""), ts = Date.now();
  if (!isPubkey(wallet)) return res.status(400).json({ error: "invalid wallet" });
  res.json({ ts, message: clientMsg(wallet, ts) });
});
// Authenticated, project-scoped (read + safe controls). Token in Authorization: Bearer.
function clientRoute(handler) {
  return async (req, res) => {
    const a = clientAuth(req);
    if (!a) return res.status(401).json({ error: "not authenticated" });
    try { res.json(await handler(a.pid, req)); } catch (e) { res.status(500).json({ error: e.message || "error" }); }
  };
}
router.get("/vault/client/status", clientRoute((pid) => vault.status(pid)));
router.get("/vault/client/positions", clientRoute((pid) => vault.publicPositions(pid)));
router.get("/vault/client/costs", clientRoute((pid) => vault.costs(pid)));
router.get("/vault/client/earnings", clientRoute((pid) => vault.earnings(pid)));
router.post("/vault/client/pause", clientRoute((pid) => vault.pause(pid)));
router.post("/vault/client/resume", clientRoute((pid) => vault.resume(pid)));
// Strategy controls (owner self-serve). Mode switch is preview-first + reversible; it never
// touches reserves / fee tier / trading pair (same guarantees as the admin mode endpoint).
router.get("/vault/client/modes", clientRoute((pid) => vault.listModes(pid)));
router.post("/vault/client/mode", (req, res) => {
  const a = clientAuth(req);
  if (!a) return res.status(401).json({ error: "not authenticated" });
  const name = String((req.body && req.body.name) || req.query.name || "").toLowerCase();
  const tiltRaw = (req.body && req.body.tilt) || req.query.tilt;
  const tilt = tiltRaw ? String(tiltRaw).toLowerCase() : null;
  const run = (req.body && req.body.run) || req.query.run;
  if (!name) return res.status(400).json({ error: "name required (active|steady|foundation|custom)" });
  try {
    if (String(run) === "1") return res.json({ applied: true, ...vault.applyMode(name, tilt, a.pid) });
    return res.json({ applied: false, preview: vault.previewMode(name, tilt, a.pid) });
  } catch (e) { res.status(400).json({ error: e.message || "mode failed" }); }
});

// GET /api/whirlpool/vault/create-pool?key=&project=rose&quote=SOL&feeTier=0.05[&run=1]
// Onboarding: create a NEW Orca pool for the project's token at the live market price.
// DRY RUN unless run=1. Costs ~0.03 SOL (rent) from the project's operator wallet.
router.get("/vault/create-pool", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.createPool({
      projectId: proj(req),
      quoteSym: String(req.query.quote || "SOL").toUpperCase(),
      feeTierPct: Number(req.query.feeTier ?? req.query.fee ?? 0.05),
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "create-pool failed" }); }
});

// GET /api/whirlpool/vault/close-position?key=&project=&mint=…[&run=1]
// Close a specific position (orphan cleanup / wind-down). DRY unless run=1.
router.get("/vault/close-position", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  const mint = String(req.query.mint || "");
  if (!mint) return res.status(400).json({ error: "mint required" });
  if (req.query.run !== "1") return res.json({ action: "would-close", mint, note: "add &run=1 to execute" });
  try { res.json(await vault.closePosition({ projectId: proj(req), mint })); }
  catch (e) { res.status(500).json({ error: e.message || "close failed" }); }
});

// GET /api/whirlpool/vault/add-liquidity?key=&project=&mint=&from=SOL&amount=…[&run=1]
// Top up an EXISTING position (no close/reopen) — deposit `amount` of `from` into its
// range; the SDK pulls the matching other side. DRY RUN unless run=1.
router.get("/vault/add-liquidity", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.addLiquidity({
      projectId: proj(req),
      mint: String(req.query.mint || ""),
      fromSym: String(req.query.from || "").toUpperCase(),
      amountUi: req.query.amount,
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "add-liquidity failed" }); }
});

// GET /api/whirlpool/vault/remove-liquidity?key=&project=&mint=&pct=0.5[&run=1]
// Withdraw pct (0..1) of a position's liquidity back to the wallet (no close). DRY unless run=1.
router.get("/vault/remove-liquidity", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.removeLiquidity({
      projectId: proj(req),
      mint: String(req.query.mint || ""),
      pct: req.query.pct,
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "remove-liquidity failed" }); }
});

// GET /api/whirlpool/vault/concentration?key=&project=&mode=wide|tight|mega[&run=1]
// Switch the treasury's concentration mode on command. DRY RUN unless run=1 (shows the plan).
router.get("/vault/concentration", async (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(await vault.concentrate({
      projectId: proj(req),
      mode: String(req.query.mode || "").toLowerCase(),
      dryRun: req.query.run !== "1",
    }));
  } catch (e) { res.status(500).json({ error: e.message || "concentration switch failed" }); }
});

// GET /api/whirlpool/vault/alerts-to-main?key=…&hours=24 — temporarily route ALL
// engine alerts to the main community chat (transparency/test window). hours=0 cancels.
router.get("/vault/alerts-to-main", (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ error: "Not found" });
  try { res.json(vault.routeAlertsToMain(req.query.hours != null ? req.query.hours : 24)); }
  catch (e) { res.status(500).json({ error: e.message || "failed" }); }
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
