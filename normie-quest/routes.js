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
const fs = require('fs');
const express = require('express');
const router = express.Router();
const burn = require('./normie-burn');   // Phase 1 burn-to-play backend (dormant until env-configured)
const feedback = require('./nq-feedback');   // playtester comment store (test dashboard)
const telemetry = require('./nq-telemetry'); // difficulty telemetry (deaths + clears)
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
    const out = await wallet.verify(String(b.pubkey || ''), String(b.signature || ''));
    // which wallet apps testers actually connect with (aggregate counts only, no pubkeys) —
    // feeds the rollout decisions ("is everyone on Jupiter?"). Durable next to the telemetry.
    if (out && out.ok && b.walletName) {
      try {
        const f = path.join(process.env.DATA_DIR || '/data', 'nq-wallet-usage.json');
        let m = {}; try { m = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (e) {}
        const k = String(b.walletName).replace(/[^\w .-]/g, '').slice(0, 24) || 'unknown';
        m[k] = (m[k] || 0) + 1;
        fs.writeFileSync(f, JSON.stringify(m));
      } catch (e) { /* counting is best-effort */ }
    }
    res.json(out);
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

// ---- shared per-IP throttle for the PUBLIC endpoints -----------------------
// IP = the LAST x-forwarded-for hop (appended by Railway's edge, so a client can't spoof its
// way into a fresh bucket by inventing XFF entries — taking the FIRST entry was bypassable).
const pubRate = new Map();   // key -> {n, resetAt}
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : String(req.ip || '?');
}
function throttled(req, bucket, max) {
  const key = bucket + ':' + clientIp(req);
  const now = Date.now();
  const r = pubRate.get(key);
  if (!r || now > r.resetAt) { pubRate.set(key, { n: 1, resetAt: now + 60000 }); }
  else if (++r.n > max) return true;
  if (pubRate.size > 5000) pubRate.clear();   // bounded memory, worst case a briefly looser throttle
  return false;
}

// ---- /api/nq/feedback : playtester comment store (test dashboard) ---------
// POST is PUBLIC (testers on the ?test=1 build submit here); size-capped, sanitized in the
// store. GET is gated (owner reads the raw list). Both never throw a 500 leak.
router.post('/api/nq/feedback', (req, res) => {
  try {
    if (throttled(req, 'fb', 10)) return res.status(429).json({ ok: false, error: 'slow_down' });
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

// ---- /api/nq/telemetry : difficulty telemetry (deaths + clears) -----------
// POST is PUBLIC (the game fire-and-forgets tiny events; sendBeacon can't set custom
// headers, so no key). Size-capped + type-validated in the store, no PII, and a light
// per-IP throttle so a hostile client can only churn its own bucket. GET is gated
// (per-world difficulty summary: hotspots, causes, clear rates).
router.post('/api/nq/telemetry', (req, res) => {
  try {
    if (throttled(req, 'tele', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const r = telemetry.add({ ev: b.ev, world: b.world, x: b.x, cause: b.cause, t: b.t, deaths: b.deaths, score: b.score });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// per-world difficulty summary (gated). ?since=<ms> to scope; default = everything.
router.get('/api/nq/telemetry', (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  try { res.json({ ok: true, total: telemetry.count(), ...telemetry.summary(Number(req.query.since) || 0) }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// ONE world's full death-bucket detail — feeds the lab build's in-level heatmap overlay.
// UNGATED on purpose (the lab page can't carry an admin key): aggregate difficulty numbers
// only, no PII. 30s in-process cache per level keeps a refresh-spammer off the disk.
const hotspotCache = new Map();   // level -> {at, body}
router.get('/api/nq/hotspots', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (throttled(req, 'hot', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const level = String((req.query && req.query.level) || '').slice(0, 24).trim();
    if (!level) return res.status(400).json({ ok: false, error: 'level required' });
    const now = Date.now();
    const hit = hotspotCache.get(level);
    if (hit && now - hit.at < 30000) return res.json(hit.body);
    const body = { ok: true, ...telemetry.worldDetail(level) };
    hotspotCache.set(level, { at: now, body });
    if (hotspotCache.size > 200) hotspotCache.clear();
    res.json(body);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
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

// ---- /normie-quest-x7/dashboard : the operator's everything-view -----------------------------
// One gated page with ALL of it: per-level difficulty (all-time, every level, death-map strips),
// leaderboards, latest comments, store health. Server-rendered like the feedback page; everything
// tester-supplied is escaped. The digest links here.
router.get('/normie-quest-x7/dashboard', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!adminOK(req)) return res.status(404).send('Not found');
  const key = esc(String((req.query && req.query.key) || ''));
  let d = { events: 0, deaths: 0, clears: 0, firstAt: 0, lastAt: 0, worlds: [] };
  try { d = telemetry.detailAll(); } catch (e) { /* render empty */ }
  let comments = [];
  try { comments = (feedback.list() || []).slice().reverse(); } catch (e) { comments = []; }
  let lb = null;
  try { lb = await leaderboard.boards({ n: 10 }); } catch (e) { lb = null; }
  let walletUse = {};
  try { walletUse = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || '/data', 'nq-wallet-usage.json'), 'utf8')) || {}; } catch (e) {}

  // natural level order: 1-1 … 10-3 first, hidden/bonus names after (alphabetical)
  const rows = d.worlds.slice().sort(function (a, b) {
    const pa = /^(\d+)-(\d+)$/.exec(a.world), pb = /^(\d+)-(\d+)$/.exec(b.world);
    if (pa && pb) return (+pa[1] - +pb[1]) || (+pa[2] - +pb[2]);
    if (pa) return -1; if (pb) return 1;
    return String(a.world).localeCompare(String(b.world));
  });
  const ago = function (ts) {
    if (!ts) return '—';
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
  };
  const flag = function (w) { return ((w.clears === 0 && w.deaths >= 8) || (w.deathsPerClear !== null && w.deathsPerClear >= 6)); };
  const heat = function (w) {   // death-map strip: buckets positioned along the level span
    if (!w.buckets.length) return '<span class="dim">—</span>';
    const maxX = Math.max.apply(null, w.buckets.map(function (b) { return b.xTo; }));
    const maxN = Math.max.apply(null, w.buckets.map(function (b) { return b.n; }));
    return '<div class="strip">' + w.buckets.map(function (b) {
      const l = (b.xFrom / maxX * 100).toFixed(1), wd = Math.max(1.5, (b.xTo - b.xFrom) / maxX * 100).toFixed(1);
      const op = (0.25 + 0.75 * (b.n / maxN)).toFixed(2);
      return '<i style="left:' + l + '%;width:' + wd + '%;opacity:' + op + '" title="x' + b.xFrom + '–' + b.xTo + ': ' + b.n + ' deaths"></i>';
    }).join('') + '</div>';
  };
  const tableRows = rows.map(function (w) {
    const dpc = w.deathsPerClear === null ? '<span class="bad">∞</span>' : String(w.deathsPerClear);
    const cause = w.topCauses[0] ? esc(w.topCauses[0].cause) + ' ×' + w.topCauses[0].n : '<span class="dim">—</span>';
    return '<tr' + (flag(w) ? ' class="warn"' : '') + '><td class="lvl">' + esc(w.world) + (flag(w) ? ' ⚠' : '') + '</td>'
      + '<td>' + w.deaths + '</td><td>' + w.clears + '</td><td>' + dpc + '</td>'
      + '<td>' + (w.clears ? w.avgClearSec + 's' : '<span class="dim">—</span>') + '</td>'
      + '<td class="cause">' + cause + '</td><td class="map">' + heat(w) + '</td>'
      + '<td class="dim">' + ago(w.lastAt) + '</td></tr>';
  }).join('');
  const lbRows = function (list) {
    return (list || []).map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name || 'anon') + '</td><td>W' + esc(String(r.world != null ? r.world : '?')) + '</td><td>' + Number(r.score || 0).toLocaleString() + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="dim">no runs yet</td></tr>';
  };
  const commentCards = comments.slice(0, 10).map(function (c) {
    const when = new Date(c.at || 0).toISOString().replace('T', ' ').slice(5, 16);
    return '<div class="c"><b>' + esc(c.name || 'anon') + '</b> <span class="lvl2">' + esc(c.level || '') + '</span> <span class="k">' + esc(c.kind || '') + '</span> <span class="dim">' + when + '</span><div>' + esc(c.text || '') + '</div></div>';
  }).join('') || '<div class="dim">No comments yet — testers need the ?test=1 build for the feedback widget.</div>';
  const overall = d.clears ? Math.round(d.deaths / d.clears * 10) / 10 : null;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>Normie Quest — Operator Dashboard</title><style>'
    + 'body{margin:0;background:#0e0a1e;color:#eee;font-family:system-ui,Segoe UI,Roboto,sans-serif;padding:16px 14px 40px}'
    + 'h1{color:#ffd23f;font-size:20px;margin:0 0 3px}h2{color:#c9a7ff;font-size:14px;margin:26px 0 8px;letter-spacing:1px}'
    + '.sub{color:#8f89b0;font-size:12.5px;margin-bottom:14px}.sub a{color:#66ccff}'
    + '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:6px}'
    + '.tile{background:#161228;border:1px solid #2a2450;border-radius:10px;padding:9px 12px}'
    + '.tile .n{font-size:21px;font-weight:700;color:#fff}.tile .l{font-size:10.5px;color:#8f89b0;letter-spacing:1px}'
    + 'table{border-collapse:collapse;width:100%;font-size:13px}'
    + 'th{color:#8f89b0;font-size:10.5px;letter-spacing:1px;text-align:left;padding:5px 8px;border-bottom:1px solid #33305a}'
    + 'td{padding:5px 8px;border-bottom:1px solid #201a3a;vertical-align:middle}'
    + 'tr.warn td{background:rgba(255,56,96,0.07)}.lvl{font-weight:700;color:#bfe0ff;white-space:nowrap}'
    + '.bad{color:#ff6a99;font-weight:700}.dim{color:#6a6590}.cause{max-width:180px}'
    + '.map{min-width:140px}.strip{position:relative;height:12px;background:#1a1630;border-radius:3px;overflow:hidden;min-width:130px}'
    + '.strip i{position:absolute;top:0;bottom:0;background:#ff3860;border-radius:1px}'
    + '.c{background:#161228;border:1px solid #2a2450;border-radius:9px;padding:8px 11px;margin-bottom:7px;font-size:13.5px}'
    + '.c b{color:#66ccff}.lvl2{background:#22406a;color:#bfe0ff;border-radius:4px;padding:0 6px;font-size:11px}'
    + '.k{color:#8dffc0;font-size:11px;text-transform:uppercase}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}'
    + '@media(max-width:720px){.cols{grid-template-columns:1fr}}'
    + '</style></head><body>'
    + '<h1>🎮 Normie Quest — Operator Dashboard</h1>'
    + '<div class="sub">all-time playtest data · <a href="/normie-quest-x7/feedback?key=' + key + '">all comments</a> · '
    + '<a href="/api/nq/telemetry?key=' + key + '">raw telemetry</a> · <a href="/api/nq/feedback?key=' + key + '">raw feedback</a> · refresh for live numbers</div>'
    + '<div class="tiles">'
    + '<div class="tile"><div class="n">' + d.events + '</div><div class="l">EVENTS</div></div>'
    + '<div class="tile"><div class="n">' + d.deaths + '</div><div class="l">DEATHS ☠</div></div>'
    + '<div class="tile"><div class="n">' + d.clears + '</div><div class="l">CLEARS ✓</div></div>'
    + '<div class="tile"><div class="n">' + (overall === null ? '—' : overall) + '</div><div class="l">DEATHS / CLEAR</div></div>'
    + '<div class="tile"><div class="n">' + d.worlds.length + '</div><div class="l">LEVELS PLAYED</div></div>'
    + '<div class="tile"><div class="n">' + comments.length + '</div><div class="l">COMMENTS</div></div>'
    + '<div class="tile"><div class="n">' + ((lb && lb.totalRuns) || 0) + '</div><div class="l">SCORED RUNS</div></div>'
    + '<div class="tile"><div class="n">' + ago(d.lastAt) + '</div><div class="l">LAST EVENT</div></div>'
    + '</div>'
    + '<h2>📊 DIFFICULTY BY LEVEL <span class="dim" style="font-weight:400">(⚠ = ≥6 deaths/clear or ≥8 deaths with no clear · red strip = where testers die)</span></h2>'
    + '<div style="overflow-x:auto"><table><tr><th>LEVEL</th><th>☠</th><th>✓</th><th>☠/✓</th><th>AVG CLEAR</th><th>TOP CAUSE</th><th>DEATH MAP</th><th>LAST</th></tr>'
    + (tableRows || '<tr><td colspan="8" class="dim">No telemetry yet — it records automatically as testers play.</td></tr>') + '</table></div>'
    + '<div class="cols"><div>'
    + '<h2>🏆 LEADERBOARD — ALL TIME</h2><table><tr><th>#</th><th>NAME</th><th>WORLD</th><th>SCORE</th></tr>' + lbRows(lb && lb.allTime) + '</table>'
    + '</div><div>'
    + '<h2>📅 LEADERBOARD — THIS WEEK</h2><table><tr><th>#</th><th>NAME</th><th>WORLD</th><th>SCORE</th></tr>' + lbRows(lb && lb.weekly) + '</table>'
    + '</div></div>'
    + '<h2>👛 WALLET CONNECTS BY APP</h2>'
    + (Object.keys(walletUse).length
      ? '<table><tr><th>WALLET</th><th>CONNECTS</th></tr>' + Object.entries(walletUse).sort((a, b) => b[1] - a[1])
          .map(([k, n]) => '<tr><td>' + esc(k) + '</td><td>' + n + '</td></tr>').join('') + '</table>'
      : '<div class="dim">No wallet connects recorded yet (counting started 2026-07-20).</div>')
    + '<h2>💬 LATEST COMMENTS (' + comments.length + ' total)</h2>' + commentCards
    + '</body></html>');
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

// ---- produced sfx samples (optional) — same drop-in pattern as the music -----
// Drop owned files at normie-quest/public/sfx/<name>.mp3 (or .wav/.m4a/.ogg) for a key the
// game's _SFX_FILES table knows (currently: coin). Present → the real sample plays; missing →
// clean 404 and the built-in synth tone keeps working.
router.use('/normie-quest/sfx', express.static(path.join(__dirname, 'public', 'sfx'), {
  maxAge: '7d',
  fallthrough: false,
  setHeaders: (res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); },
}));

module.exports = router;
