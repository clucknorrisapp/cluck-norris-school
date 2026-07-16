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
const feedback = require('./nq-feedback');   // playtester comment store (test dashboard)
const leaderboard = require('./nq-leaderboard');   // Phase 2 leaderboards (per-world + weekly)
const wallet = require('./nq-wallet');   // Phase 2 wallet ownership + tier gate (sign-message, read-only)

// Admin key for reading feedback / the comments dashboard. Accepts a simple shared password
// (owner's choice — this gate only guards low-sensitivity playtest comments, no funds/PII), plus
// a dedicated NQ_FEEDBACK_KEY env override and the site's PREMIUM_ACCESS_KEY, whichever the owner
// uses. NOT a security-critical gate — just keeps the comments page from being casually stumbled on.
const FEEDBACK_PW = 'normiequesttest';
function adminOK(req) {
  const k = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  if (k && k === FEEDBACK_PW) return true;
  const want = process.env.NQ_FEEDBACK_KEY || process.env.PREMIUM_ACCESS_KEY || '';
  return !!want && k === want;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Serves the side-scrolling platformer (real Normie character + JEET enemy).
// The original coin-grabber prototype (normie-quest.html) is kept in the repo
// but no longer served. Still hidden: unguessable URL, noindex, linked nowhere.
router.get('/normie-quest-x7', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  // no-cache so mobile Safari always revalidates and picks up new builds (stale cache was
  // making shipped fixes look like they hadn't landed).
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'normie-quest-platformer.html'));
});

// Dev / "setup lane": the SAME game file with the premium flow forced ON (the page detects the
// -lab path and sets window.__NQ_SETUP). Lets us build & test the wallet gate / leaderboards /
// giveaways without touching the stable tester build at /normie-quest-x7. noindex + no-cache.
router.get('/normie-quest-x7-lab', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'normie-quest-platformer.html'));
});

// ---- PWA: manifest, service worker, icons --------------------------------
// Makes the game installable ("Add to Home Screen" on iOS/Android, and a TWA-wrappable
// PWA for the Solana dApp Store). Kept noindex like the rest of this hidden feature.
// The service worker is served from the site ROOT so its scope can cover /normie-quest-x7.
router.get('/normie-quest-x7.webmanifest', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'pwa', 'manifest.webmanifest'));
});
router.get('/nq-sw.js', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Service-Worker-Allowed', '/');            // allow the SW to claim the root scope
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'nq-sw.js'));
});
router.use('/nq-assets', express.static(path.join(__dirname, 'public', 'pwa'), {
  maxAge: '7d',
  fallthrough: false,
  setHeaders: (res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); },
}));

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

// ---- /api/nq/leaderboard : per-world + weekly boards ----------------------
// run-start issues a short-lived HMAC token at level start; score submits it back so the
// server can stamp real elapsed time + flag implausible runs. Both POST-public (sanitized in
// the store), reads are public. Never throw a 500 leak.
router.get('/api/nq/run-start', (req, res) => {
  try { res.json({ ok: true, ...leaderboard.startRun(String((req.query && req.query.level) || '')) }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/score', async (req, res) => {
  try {
    const b = req.body || {};
    // Wallet verification is server-side: a score counts as walletVerified ONLY if the wallet's
    // session token checks out (never trust a client-supplied walletVerified flag).
    const walletVerified = !!(b.wallet && b.walletToken && wallet.checkSession(b.wallet, b.walletToken));
    const r = await leaderboard.add(
      { name: b.name, world: b.world, level: b.level, score: b.score, lives: b.lives,
        wallet: b.wallet, walletVerified, mode: b.mode, ua: req.get('user-agent') },
      b.token || null,
    );
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// ---- /api/nq/wallet : sign-message ownership + tier gate ------------------
// challenge -> the player signs it in their wallet (no tx) -> verify checks the ed25519 signature
// and reads NORMIE/CLKN balances to grant an access tier + a session token. Reads only; no funds.
router.get('/api/nq/wallet/config', (req, res) => {
  try { res.json({ ok: true, ...wallet.publicConfig() }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.get('/api/nq/wallet/challenge', (req, res) => {
  try { res.json(wallet.challenge(String((req.query && req.query.pubkey) || ''))); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/wallet/verify', async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await wallet.verify(String(b.pubkey || ''), String(b.signature || '')));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// re-read live balance for a remembered wallet (no re-signing) → current tier, every launch
router.post('/api/nq/wallet/refresh', async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await wallet.refresh(String(b.pubkey || ''), String(b.token || ''), { force: b.fresh === true }));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.get('/api/nq/leaderboard', async (req, res) => {
  try {
    const q = req.query || {};
    const worlds = String(q.worlds || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= 99).slice(0, 12);
    const n = Math.max(1, Math.min(50, parseInt(q.n, 10) || 10));
    res.json({ ok: true, ...(await leaderboard.boards({ worlds, n })) });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// ---- /api/nq/feedback : playtester comment store (test dashboard) ---------
// POST is PUBLIC (testers on the ?test=1 build submit here); size-capped, sanitized in the
// store. GET is gated (owner reads the raw list). Both never throw a 500 leak.
router.post('/api/nq/feedback', (req, res) => {
  try {
    const b = req.body || {};
    const r = feedback.add({
      name: b.name, level: b.level, kind: b.kind, text: b.text,
      ua: req.get('user-agent'),
    });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// raw JSON list of comments (gated)
router.get('/api/nq/feedback', (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  try { const items = feedback.list(); res.json({ ok: true, count: items.length, items: items.slice().reverse() }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// human-readable comments dashboard for the owner (gated). Newest first, filter by level.
router.get('/normie-quest-x7/feedback', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!adminOK(req)) return res.status(404).send('Not found');
  let items = [];
  try { items = feedback.list(); } catch (e) { items = []; }
  items = items.slice().reverse();   // newest first
  const key = esc(String((req.query && req.query.key) || ''));
  const rows = items.map(function (c) {
    const when = new Date(c.at || 0).toISOString().replace('T', ' ').slice(0, 16);
    const kind = c.kind ? '<span class="kind k-' + esc(c.kind) + '">' + esc(c.kind) + '</span>' : '';
    return '<div class="c"><div class="meta"><b>' + esc(c.name || 'anon') + '</b>'
      + (c.level ? ' <span class="lvl">' + esc(c.level) + '</span>' : '') + ' ' + kind
      + '<span class="t">' + esc(when) + '</span></div><div class="txt">' + esc(c.text || '') + '</div></div>';
  }).join('');
  const levels = Array.from(new Set(items.map(function (c) { return c.level; }).filter(Boolean))).sort();
  const chips = ['<button class="chip on" data-l="">ALL (' + items.length + ')</button>']
    .concat(levels.map(function (l) { return '<button class="chip" data-l="' + esc(l) + '">' + esc(l) + '</button>'; })).join('');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>Normie Quest — Playtest Feedback</title><style>'
    + 'body{margin:0;background:#0e0a1e;color:#eee;font-family:system-ui,Segoe UI,Roboto,sans-serif;padding:16px}'
    + 'h1{color:#ffd23f;font-size:20px;margin:0 0 4px}.sub{color:#8f89b0;font-size:13px;margin-bottom:14px}'
    + '.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}'
    + '.chip{background:#1a1630;border:1px solid #33305a;color:#cbc6e6;border-radius:14px;padding:4px 11px;font-size:12px;cursor:pointer}'
    + '.chip.on{background:#ffd23f;color:#20142e;border-color:#ffd23f;font-weight:600}'
    + '.c{background:#161228;border:1px solid #2a2450;border-radius:10px;padding:10px 12px;margin-bottom:9px}'
    + '.meta{font-size:12px;color:#9a95bd;margin-bottom:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}'
    + '.meta b{color:#66ccff}.lvl{background:#22406a;color:#bfe0ff;border-radius:4px;padding:1px 6px;font-size:11px}'
    + '.kind{border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase}'
    + '.k-bug{background:#5a1330;color:#ff9db8}.k-idea{background:#134a2e;color:#8dffc0}.k-note{background:#2a2450;color:#cbc6e6}'
    + '.t{margin-left:auto;color:#6a6590;font-size:11px}.txt{font-size:15px;line-height:1.4;white-space:pre-wrap;word-break:break-word}'
    + '.empty{color:#8f89b0;padding:30px 0;text-align:center}</style></head><body>'
    + '<h1>🎮 Normie Quest — Playtest Feedback</h1><div class="sub">' + items.length + ' comment(s) · newest first · '
    + '<a style="color:#66ccff" href="/api/nq/feedback?key=' + key + '">raw JSON</a></div>'
    + '<div class="chips">' + chips + '</div><div id="list">' + (rows || '<div class="empty">No comments yet.</div>') + '</div>'
    + '<script>var cs=document.querySelectorAll(".chip"),cards=document.querySelectorAll(".c");'
    + 'cs.forEach(function(b){b.onclick=function(){cs.forEach(function(x){x.classList.remove("on")});b.classList.add("on");'
    + 'var l=b.getAttribute("data-l");cards.forEach(function(c){var m=c.querySelector(".lvl");var cl=m?m.textContent:"";'
    + 'c.style.display=(!l||cl===l)?"":"none"})}})</script></body></html>');
});

// ---- produced music files (optional) -------------------------------------
// Drop real, OWNED/licensed tracks at normie-quest/public/music/<name>.mp3 (or .ogg / .wav) where
// <name> is a track key the game asks for: world1, desert, casino, skyline, exchange, boss,
// sacred, mines. The game streams the file when present and silently falls back to its built-in
// synth music when absent — so this directory can be empty and everything still works.
// fallthrough:false → a missing file returns a clean 404 (not the SPA shell), which the game's
// <audio> loader reads as "no track, use the synth".
router.use('/normie-quest/music', express.static(path.join(__dirname, 'public', 'music'), {
  maxAge: '7d',
  fallthrough: false,
  setHeaders: (res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); },
}));

module.exports = router;
