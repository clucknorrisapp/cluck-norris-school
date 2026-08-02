/* CLKN <-> NORMIE swap desk — HTTP surface.
 *
 * Mounted at /api/swap by server.js. See docs/SWAP_DESIGN.md for the design and lib/swap-desk.js
 * for the logic; this file is transport only and holds no business rules of its own.
 *
 * ⚠️ This router is mounted ABOVE the global express.json() in server.js, so it installs its own
 * body parser. Without that, req.body is undefined and every POST here 400s silently — the same
 * trap hatchery.js, securitycoop.js and whirlpool-mm.js each handle locally.
 *
 * Every endpoint is a structured no-op when SWAP_OPERATOR_SECRET is unset. Unset == disabled.
 */
const express = require("express");
const desk = require("./lib/swap-desk");

const router = express.Router();
router.use(express.json({ limit: "64kb" }));

// Errors from here can carry a Helius URL with an embedded API key. server.js has publicErrMsg
// for exactly this; lib/ can't reach it, so scrub locally to the same standard.
function safeErr(e) {
  const m = String((e && e.message) || e || "something went wrong");
  return m.replace(/https?:\/\/\S+/g, "[url]").replace(/api[-_]?key=\S+/gi, "api-key=[redacted]");
}
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error("[swap]", req.path, e && e.message);
  res.status(500).json({ ok: false, error: safeErr(e) });
});

/* What the page needs to render before a wallet is connected. Deliberately public: the spread and
 * the caps are terms of the trade, and hiding them would make the desk less honest, not safer. */
router.get("/config", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const c = desk._internal.cfg();
  res.json({
    ok: true,
    enabled: desk.isEnabled(),
    desk: desk.deskPubkey(),
    clknMint: desk.CLKN_MINT,
    normieMint: desk.NORMIE_MINT,
    spreadBps: c.spreadBps,
    minUsd: c.minUsd,
    walletDailyUsd: c.walletDailyUsd,
    quoteTtlSec: Math.round(c.quoteTtlMs / 1000),
  });
}));

router.get("/inventory", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await desk.inventory());
}));

router.post("/quote", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const b = req.body || {};
  res.json(await desk.quote({
    inMint: String(b.inMint || ""), outMint: String(b.outMint || ""),
    amountUi: String(b.amount || ""), wallet: String(b.wallet || ""),
  }));
}));

router.post("/build", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await desk.build({ quote: String((req.body || {}).quote || "") }));
}));

router.post("/submit", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const b = req.body || {};
  res.json(await desk.verifyAndSign({
    buildToken: String(b.buildToken || ""),
    signedTxBase64: String(b.signedTx || ""),
  }));
}));

module.exports = { router };
