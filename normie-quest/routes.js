// Normie Quest — hidden feature router (Phase 0).
//
// A retro web game for a friend's Solana token (NORMIE). This is a SEPARATE,
// self-contained section of the site: it must not touch or share dependencies
// with the Cluck Norris app (Liquidity Engine, School content, send-to-verify,
// Bags). Everything for this feature lives under /normie-quest/ (code) and
// /api/nq/* (future routes). No imports from CLKN code — copy patterns, don't
// couple.
//
// Phase 0 = ship the hidden demo page only. The URL is unguessable and carries
// noindex/nofollow (meta tag in the HTML + the X-Robots-Tag header below); it is
// linked from nowhere and excluded from sitemap.xml (the sitemap is a hardcoded
// page list in server.js — this route is simply not in it).

const path = require('path');
const express = require('express');
const router = express.Router();
const burn = require('./normie-burn');   // Phase 1 burn-to-play backend (dormant until env-configured)

// Serves the side-scrolling platformer (real Normie character + JEET enemy).
// The original coin-grabber prototype (normie-quest.html) is kept in the repo
// but no longer served. Still hidden: unguessable URL, noindex, linked nowhere.
router.get('/normie-quest-x7', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', 'normie-quest-platformer.html'));
});

// ---- /api/nq/* : burn-to-play backend (Phase 1) --------------------------
// All routes are safe while dormant: with NQ_NORMIE_MINT unset they return "not configured"
// and the game (BURN_GATE=false) never calls them. No operator funds are ever touched — the
// player signs their own burn; the server only issues a session, builds an UNSIGNED tx, and
// reads the chain to verify. errors are swallowed to a JSON shape, never a 500 leak.
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
};

// public, secret-free — the client reads this to decide whether to show the gate
router.get('/api/nq/config', (req, res) => res.json(burn.publicConfig()));

// issue a play session (unique on-chain reference + unique amount)
router.post('/api/nq/session', wrap(async () => {
  const s = burn.newSession();
  return s.error ? { ok: false, status: s.error } : { ok: true, ...s };
}));

// build the unsigned burn transaction for the player's wallet to sign
router.get('/api/nq/burn-tx', wrap(async (req) => {
  const { session, payer } = req.query;
  if (!session || !payer) return { ok: false, status: 'missing_params' };
  const r = await burn.buildBurnTx(String(session), String(payer));
  return r.error ? { ok: false, status: r.error } : { ok: true, ...r };
}));

// verify a burn landed for this session (durable replay-guarded); returns a one-time unlock token
router.get('/api/nq/verify', wrap(async (req) => {
  const { session } = req.query;
  if (!session) return { ok: false, status: 'missing_params' };
  return await burn.verifyBurn(String(session));
}));

module.exports = router;
