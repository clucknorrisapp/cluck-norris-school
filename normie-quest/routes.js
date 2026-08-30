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
const burn = require('./normie-burn');   // burn-to-buy backend for the Item Reserve shop (dormant until NQ_SHOP is armed)
const feedback = require('./nq-feedback');   // playtester comment store (test dashboard)
const telemetry = require('./nq-telemetry'); // difficulty telemetry (deaths + clears)
const journey = require('./nq-journey');     // per-player session journey: funnel + drop-off
const leaderboard = require('./nq-leaderboard');   // Phase 2 leaderboards (per-world + weekly)
const wallet = require('./nq-wallet');   // Phase 2 wallet ownership + tier gate (sign-message, read-only)
const rewards = require('./nq-rewards'); // wallet-bound game-boost reward queue + daily VIP wheel
const ledger = require('./nq-ledger');   // off-chain per-wallet points ledger (Normie Cash economy)
const pair = require('./nq-pair');       // TV pairing — carry a proven wallet session to a wallet-less screen
const claims = require('./nq-claims');   // weekly physical-prize claims (sign-to-claim, encrypted addresses)
const cloudsave = require('./nq-save');  // cross-device cloud save, keyed by verified wallet (2026-08-27)
const promo = require('./nq-promo');     // weekly prize card + between-level promo feed (2026-08-30)

// Admin key for reading feedback / the comments dashboard (low-sensitivity playtest comments,
// no funds/PII). Env keys ONLY — a dedicated NQ_FEEDBACK_KEY, else the site's PREMIUM_ACCESS_KEY.
// The old hardcoded shared password was removed (owner, end of beta — playtesting moved to another
// platform): a committed password in a public repo is needless exposure, and nothing depends on it.
function adminOK(req) {
  const k = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const want = process.env.NQ_FEEDBACK_KEY || process.env.PREMIUM_ACCESS_KEY || '';
  return !!want && k === want;
}
// MASTER KEY ONLY (security review 2026-08-30): adminOK's own header says the feedback key is
// "no funds/PII" trust — but adminOK was gating the prizes console (DECRYPTED shipping
// addresses), the board wipe, and the paywall gate. Latent today (feedback key unset collapses
// to the master key) but a set NQ_FEEDBACK_KEY would hand playtest-tier trust all three. Use
// this for anything touching PII, the live contest, or money-adjacent switches.
function masterOK(req) {
  const k = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const want = process.env.PREMIUM_ACCESS_KEY || '';
  return !!want && k === want;
}
// Coarse device class from the request UA — 'mobile' or 'desktop', nothing finer. The journey
// store keeps only this word, never the raw user-agent, so "were those players on phones?" is
// answerable without collecting PII. Known blind spot: iPadOS in desktop mode reports itself
// as Macintosh and reads as desktop.
function uaDevice(ua) {
  ua = String(ua || '');
  if (!ua) return '';
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini/i.test(ua) ? 'mobile' : 'desktop';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Serves the side-scrolling platformer (real Normie character + JEET enemy).
// The original coin-grabber prototype (normie-quest.html) is kept in the repo
// but no longer served. Still hidden: unguessable URL, noindex, linked nowhere.
// Cache posture for the game DOCUMENT (an ~11MB single-file build), split by audience:
//   browsers  — `max-age=0, must-revalidate`: revalidate on every load, exactly the behavior
//               the old `no-cache` gave us (mobile Safari's stale cache once made shipped fixes
//               look unlanded — that guarantee stays).
//   Cloudflare — `CDN-Cache-Control: max-age=300`: the edge may hold a copy for 5 minutes, so a
//               wave of new players streams the 11MB from Cloudflare instead of through Node.
//               CF consumes/strips this header; browsers never see it. Deploys are visible
//               within 5 minutes (or instantly with a CF cache purge).
// ⚠️ Cloudflare does NOT cache HTML by default regardless of headers (cf-cache-status stays
// DYNAMIC) — these headers only take effect once a scoped Cache Rule marks these two paths
// "eligible for cache" with Origin Cache Control ON (one-time dashboard step, owner).
function gameCacheHeaders(res) {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.set('CDN-Cache-Control', 'max-age=300');
}
router.get('/normie-quest-x7', (req, res) => {
  gameCacheHeaders(res);
  res.sendFile(path.join(__dirname, 'public', 'normie-quest-platformer.html'));
});

// Launch-day front door (owner ask, 2026-08-22): a memorable alias for the same game. The x7
// URL stays live — this adds a name you can say out loud. Same headers, same file.
router.get('/normiequest-go-live', (req, res) => {
  gameCacheHeaders(res);
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
  // On the dedicated game domain (normiequest.app) the game lives at "/", which is OUTSIDE this
  // manifest's /normie-quest-x7 scope — browsers then ignore the whole manifest, including its
  // orientation:landscape hint, and a home-screen install misbehaves. Rewrite the identity
  // fields to the domain's root for those hosts; everyone else gets the file untouched.
  const gameHosts = String(process.env.NQ_GAME_HOSTS || 'normiequest.app,www.normiequest.app')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (gameHosts.includes(String(req.hostname || '').toLowerCase())) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'pwa', 'manifest.webmanifest'), 'utf8'));
      m.id = '/'; m.start_url = '/'; m.scope = '/';
      return res.send(JSON.stringify(m));
    } catch (e) { /* fall through to the file */ }
  }
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

// ---- /api/nq/* : the BURN SHOP (buy an Item Reserve boost by burning $NORMIE) --------------
// Safe while dormant: with NQ_SHOP unarmed every route below reports "not configured" and the
// client never renders a shop. No operator funds are ever touched — the player signs their own
// burn; the server only issues a session, builds an UNSIGNED tx, broadcasts exactly that tx back,
// and reads the chain to verify. Errors are swallowed to a JSON shape, never a 500 leak.
//
// Every route that can cost the player money or cost US paid RPC quota is BOTH throttled per IP
// and bound to a proven wallet session. `throttled` is declared further down (hoisted function).
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
};

// public, secret-free — the client reads this to decide whether to show the shop at all
router.get('/api/nq/config', (req, res) => res.json(burn.publicConfig()));

// Issue a shop session: bound to a PROVEN wallet and ONE item, with a unique on-chain reference
// and a unique amount. The item is validated against the reward store's own list, so a catalogue
// that has drifted from the game fails HERE — before anybody burns anything for an id the client
// would silently drop.
router.post('/api/nq/shop/session', wrap(async (req) => {
  if (throttled(req, 'shopsess', 10)) return { ok: false, status: 'slow_down' };
  const b = req.body || {};
  const pk = String(b.wallet || ''), token = String(b.token || '');
  if (!wallet.checkSession(pk, token)) return { ok: false, status: 'bad_session' };
  const item = String(b.item || '');
  if (!rewards.ITEMS[item]) return { ok: false, status: 'bad_item' };
  // pay rail is chosen by the player but VALIDATED server-side (newSession rejects 'sol' when
  // the SOL rail is off, and prices each rail itself — the client never sets a price).
  const s = burn.newSession({ item, wallet: pk, pay: String(b.pay || 'normie') });
  return s.error ? { ok: false, status: s.error } : { ok: true, ...s };
}));

// Build the unsigned burn transaction for the session's wallet to sign. Two RPC reads per call
// (getMint + getLatestBlockhash) come out of paid Helius quota, hence the tight cap.
router.get('/api/nq/burn-tx', wrap(async (req) => {
  if (throttled(req, 'burntx', 10)) return { ok: false, status: 'slow_down' };
  const { session, payer } = req.query;
  if (!session || !payer) return { ok: false, status: 'missing_params' };
  const r = await burn.buildBurnTx(String(session), String(payer));
  return r.error ? { ok: false, status: r.error } : { ok: true, ...r };
}));

// Broadcast the wallet-signed transaction. normie-burn refuses anything whose message is not
// byte-for-byte the one it built for this session, so this is not a general-purpose relay.
router.post('/api/nq/burn-send', wrap(async (req) => {
  if (throttled(req, 'burnsend', 10)) return { ok: false, status: 'slow_down' };
  const b = req.body || {};
  if (!b.session || !b.tx) return { ok: false, status: 'missing_params' };
  const r = await burn.sendSigned(String(b.session), String(b.tx));
  return r.error ? { ok: false, status: r.error } : { ok: true, ...r };
}));

// Poll after signing: verify the burn on-chain (durable replay guard) and queue the item to the
// wallet's reward queue EXACTLY ONCE. The game claims it into the Item Reserve via the existing
// /api/nq/rewards/claim path, so a purchase behaves like every other grant and follows the
// player across devices.
router.post('/api/nq/shop/claim', wrap(async (req) => {
  if (throttled(req, 'shopclaim', 40)) return { ok: false, status: 'slow_down' };
  const b = req.body || {};
  const pk = String(b.wallet || ''), token = String(b.token || '');
  if (!wallet.checkSession(pk, token)) return { ok: false, status: 'bad_session' };
  const sid = String(b.session || '');
  if (!sid) return { ok: false, status: 'missing_params' };
  const v = await burn.verifyBurn(sid);
  if (!v.ok) return v;
  // The session already carries the wallet it was issued to; re-check it against the caller so a
  // leaked session id cannot be redeemed into somebody else's queue.
  if (v.wallet && v.wallet !== pk) return { ok: false, status: 'wrong_wallet' };
  const once = burn.claimOnce(sid);
  if (!once) return { ok: true, item: v.item, already: true, pending: rewards.pendingCount(pk) };
  const g = rewards.grant(pk, once.item);
  // The burn is already on-chain and irreversible. If the hand-over failed (full queue, disk
  // write), release the once-only latch so a retry — after the player spends a banked item — can
  // still deliver what they paid for.
  if (!g.ok) { burn.unclaim(sid); return { ok: false, status: g.error, item: once.item }; }
  return { ok: true, item: once.item, pending: g.pending, signature: v.signature };
}));

// ---- /api/nq/leaderboard : per-world + weekly boards ----------------------
// run-start issues a short-lived HMAC token at level start; score submits it back so the
// server can stamp real elapsed time + flag implausible runs. Both POST-public (sanitized in
// the store), reads are public. Never throw a 500 leak.
router.get('/api/nq/run-start', (req, res) => {
  if (throttled(req, 'runstart', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try { res.json({ ok: true, ...leaderboard.startRun(String((req.query && req.query.level) || '')) }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// Per-level checkpoint: the game POSTs its current run token + the level it just reached; the
// server credits that level's max-point budget ONCE and re-issues the token. The final /score
// submit is then bounded by the summed budget of the levels actually reached (points, not time).
router.post('/api/nq/run-checkpoint', (req, res) => {
  if (throttled(req, 'runcheckpoint', 200)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    const r = leaderboard.checkpoint(b.token || null, String(b.level || ''));
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// CONTINUE (audit #7): the game-over submit burns the run nonce, so a continued run POSTs its
// ended token here and gets back a fresh-nonce token carrying the same proven level list — the
// banked cumulative score stays inside the ceiling instead of instantly reading as forged.
router.post('/api/nq/run-continue', (req, res) => {
  if (throttled(req, 'runcontinue', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    const r = leaderboard.continueRun(b.token || null);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/score', async (req, res) => {
  if (throttled(req, 'score', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
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
  // Throttle: each challenge grows an in-memory Map (pruned only by TTL), so cap issuance per IP.
  if (throttled(req, 'walletchallenge', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try { res.json(wallet.challenge(String((req.query && req.query.pubkey) || ''))); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/wallet/verify', async (req, res) => {
  // Throttle: verify reads token balances over PAID Helius RPC, and the ed25519 check is
  // self-satisfiable with attacker-generated keypairs — so churning fresh pubkeys would drive
  // uncached RPC reads without a cap. 20/min/IP is far above a real "connect once" flow. (cost)
  if (throttled(req, 'walletverify', 20)) return res.status(429).json({ ok: false, error: 'slow_down' });
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
        require("../lib/atomic-write").atomicWriteFileSync(f, JSON.stringify(m));
      } catch (e) { /* counting is best-effort */ }
    }
    res.json(out);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// ULTRA VIP allowlist admin (owner only): grant/revoke wallets that qualified via big buys,
// token locks, burns, or SOL payments — the paths not yet automated. ?add= / ?remove= / list.
// ⚠ ALL VIP terms are TESTING-ONLY (owner-to-confirm); never publish qualification numbers.
router.get('/normie-quest-x7/vip', (req, res) => {
  // STRICT admin: env keys ONLY — adminOK also accepts the tester-known dashboard password,
  // which must NOT be able to grant ULTRA VIP (owner call 2026-07-21: VIP is owner-only).
  const vk = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const vw = process.env.PREMIUM_ACCESS_KEY || '';   // privileged (VIP grant / lounge post / reward grant): the master key ONLY — the low-trust NQ_FEEDBACK_KEY (playtest comments) must never grant these
  if (!vw || vk !== vw) return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    let list = wallet.vipList();
    const add = String(req.query.add || '').trim(), rem = String(req.query.remove || '').trim();
    if (add && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(add) && list.indexOf(add) === -1) { list.push(add); wallet.vipListWrite(list); }
    if (rem) { const i = list.indexOf(rem); if (i !== -1) { list.splice(i, 1); wallet.vipListWrite(list); } }
    res.json({ ok: true, count: list.length, wallets: list });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// ---- 👑 VIP LOUNGE — a separate wallet-gated page for VIPs: giveaways, alpha, perks ----
// Page: /normie-quest-x7/lounge (noindex). Feed API requires a verified session token AND the
// VIP grant. Posts live at /data/nq-lounge.json, owner-managed via the strict-key admin below.
router.get('/normie-quest-x7/lounge', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'public', 'lounge.html'));
});
function loungePath() { return path.join(process.env.DATA_DIR || '/data', 'nq-lounge.json'); }
function loungePosts() { try { const a = JSON.parse(fs.readFileSync(loungePath(), 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
router.get('/api/nq/lounge', (req, res) => {
  try {
    const pk = String(req.query.wallet || ''), token = String(req.query.token || '');
    const sess = wallet.checkSession(pk, token);
    if (!sess || sess.ok === false) return res.status(401).json({ ok: false, error: 'bad_session' });
    if (!wallet.isVip(pk, null)) return res.status(403).json({ ok: false, error: 'not_vip' });
    res.json({ ok: true, posts: loungePosts() });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// Owner posting (STRICT env key only, same as the VIP allowlist): &title=&body=[&tag=giveaway|alpha|perk]
// to add; &remove=<id> to delete; bare call lists everything.
router.get('/normie-quest-x7/lounge-admin', (req, res) => {
  const vk = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const vw = process.env.PREMIUM_ACCESS_KEY || '';   // privileged (VIP grant / lounge post / reward grant): the master key ONLY — the low-trust NQ_FEEDBACK_KEY (playtest comments) must never grant these
  if (!vw || vk !== vw) return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    let posts = loungePosts();
    const title = String(req.query.title || '').slice(0, 140), body = String(req.query.body || '').slice(0, 4000);
    const tag = ['giveaway', 'alpha', 'perk'].indexOf(String(req.query.tag || '')) !== -1 ? String(req.query.tag) : 'perk';
    const rem = String(req.query.remove || '');
    if (title && body) posts.unshift({ id: Date.now().toString(36), ts: Date.now(), title, body, tag });
    if (rem) posts = posts.filter((x) => x.id !== rem);
    require("../lib/atomic-write").atomicWriteFileSync(loungePath(), JSON.stringify(posts));
    res.json({ ok: true, count: posts.length, posts });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// ---- 🎁 REWARDS: wallet-bound game-boost queue + the daily VIP prize wheel -------------------
// Winnings are IN-GAME items (disc/vial/shield), never tokens — no funds move, nothing to sign.
// Owner/wheel grants queue per wallet; the game claims them into the Item Reserve on next login.
function strictAdmin(req) {
  const vk = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const vw = process.env.PREMIUM_ACCESS_KEY || '';   // privileged (VIP grant / lounge post / reward grant): the master key ONLY — the low-trust NQ_FEEDBACK_KEY (playtest comments) must never grant these
  return !!vw && vk === vw;
}
// Owner grant (STRICT key): &wallet=PUBKEY&item=disc|vial|shield ; bare call shows a wallet's queue.
router.get('/normie-quest-x7/reward', (req, res) => {
  if (!strictAdmin(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    const w = String(req.query.wallet || '').trim(), item = String(req.query.item || '').trim();
    if (w && item) return res.json(rewards.grant(w, item));
    if (w) return res.json({ ok: true, wallet: w, pending: rewards.pendingCount(w) });
    res.json({ ok: true, odds: rewards.odds() });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// Daily VIP wheel — player-triggered, server-authoritative (every spin wins; odds published).
// Gated: valid session token AND VIP; one spin per UTC day per wallet.
router.post('/api/nq/wheel/spin', (req, res) => {
  try {
    if (throttled(req, 'wheelspin', 20)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const pk = String(b.wallet || ''), token = String(b.token || '');
    const sess = wallet.checkSession(pk, token);
    if (!sess || sess.ok === false) return res.status(401).json({ ok: false, error: 'bad_session' });
    // Open to any VERIFIED wallet — the daily spin is the free player's reason to come back.
    // VIP is no longer a gate here, it selects the better prize table and the bonus windows.
    const result = rewards.spin(pk, null, { vip: wallet.isVip(pk, null) });
    // The wheel outcome is decided SERVER-SIDE, so a successful spin is a safe, server-authoritative
    // place to also credit off-chain Normie Cash points. Env-gated (NQ_WHEEL_POINTS, default 0 = OFF)
    // so this changes nothing until the owner sets an amount. Idempotent by a per-spin id; the wheel's
    // own once-per-day guard means a doomed double-tap never reaches here as a second success.
    if (result && result.ok) {
      const pts = parseInt(process.env.NQ_WHEEL_POINTS || '0', 10);
      if (pts > 0) {
        try {
          const c = ledger.credit(pk, { eventId: 'wheel:' + pk + ':' + Date.now(), amount: pts, kind: 'wheel' });
          if (c && c.ok) { result.pointsEarned = c.credited || 0; result.pointsBalance = c.balance; }
        } catch (e) { /* ledger is best-effort — never break a spin */ }
      }
    }
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// Off-chain points balance for the connected wallet (Normie Cash economy). Session-gated read.
router.get('/api/nq/ledger', (req, res) => {
  if (throttled(req, 'ledger', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const pk = String(req.query.wallet || ''), token = String(req.query.token || '');
    const sess = wallet.checkSession(pk, token);
    if (!sess || sess.ok === false) return res.status(401).json({ ok: false, error: 'bad_session' });
    res.json({ ok: true, ...ledger.balance(pk), history: ledger.history(pk, 25) });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.get('/api/nq/wheel/status', (req, res) => {
  try {
    const pk = String(req.query.wallet || ''), token = String(req.query.token || '');
    const sess = wallet.checkSession(pk, token);
    if (!sess || sess.ok === false) return res.status(401).json({ ok: false, error: 'bad_session' });
    const vip = wallet.isVip(pk, null);
    const dailyReady = rewards.canSpin(pk), bonusReady = vip && rewards.bonusAvailable(pk);
    // 🎟️ Preview Pass surface: `preview` = the hidden world featured on the wheel this rotation (shown
    // to everyone, so free players see the perk they'd get); `pass` = the wallet's own active pass or null.
    res.json({ ok: true, vip, canSpin: dailyReady || bonusReady, dailyReady, bonusReady,
      nextSpinAt: rewards.nextSpinAt(), nextBonusAt: vip ? rewards.nextBonusAt() : null,
      pending: rewards.pendingCount(pk), odds: rewards.odds(vip),
      preview: rewards.previewRoom(), pass: rewards.activePass(pk),
      raffle: rewards.raffleEntries(pk),
      heartBuff: rewards.activeHeartBuff(pk),
      // 🪙 A teaser only — real $NORMIE payouts are on hold (owner-signed airdropper + NORMIE deal +
      // an explicit go). NOT a wheel wedge: a wedge nobody can land on would break the wheel's
      // "slice size = real odds" honesty. Rendered as a labeled 'coming soon' banner instead.
      jackpotSoon: vip });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// Claim ONE pending item into the game (any verified wallet — leaderboard/owner grants included).
router.post('/api/nq/rewards/claim', (req, res) => {
  try {
    if (throttled(req, 'rewardclaim', 40)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const pk = String(b.wallet || ''), token = String(b.token || '');
    const sess = wallet.checkSession(pk, token);
    if (!sess || sess.ok === false) return res.status(401).json({ ok: false, error: 'bad_session' });
    res.json(rewards.claimOne(pk));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// re-read live balance for a remembered wallet (no re-signing) → current tier, every launch
router.post('/api/nq/wallet/refresh', async (req, res) => {
  // Throttle: refresh re-reads live balances over PAID Helius RPC. Requires a valid session token,
  // but cap it anyway so a leaked/replayed token can't be looped to drain RPC. (cost)
  if (throttled(req, 'walletrefresh', 20)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    res.json(await wallet.refresh(String(b.pubkey || ''), String(b.token || ''), { force: b.fresh === true }));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// CLOUD SAVE — cross-device game progress, keyed by VERIFIED wallet (nq-save.js). One POST does
// both directions: body {pubkey, token, save?} — a save merges up (furthest-reached wins), and the
// merged result comes back for the client to apply down. Session-token-gated both ways so nobody
// can read or poison another player's save; values are a resume bookmark, never a prize input.
router.post('/api/nq/save', (req, res) => {
  if (throttled(req, 'cloudsave', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    const pk = String(b.pubkey || '');
    if (!wallet.checkSession(pk, String(b.token || ''))) return res.status(401).json({ ok: false, error: 'bad_session' });
    const save = b.save ? cloudsave.put(pk, b.save) : cloudsave.get(pk);
    res.json({ ok: true, save: save || null });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// ---- /api/nq/promo : weekly prize card + between-level promo feed (nq-promo.js) -----------
// Public read = what the interstitials render (card of the week, or nothing). Owner write is
// master-keyed and is how the card changes each week WITHOUT a deploy: host the card photo
// (e.g. /host-image → arweave), then POST { card: { img, name, copy } }; { card: null } clears.
router.get('/api/nq/promo', (req, res) => {
  if (throttled(req, 'promo', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try { res.json({ ok: true, ...promo.publicView() }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/promo', (req, res) => {
  const pk = String((req.query && req.query.key) || req.get('x-nq-key') || '');
  const pw = process.env.PREMIUM_ACCESS_KEY || '';   // master key ONLY — this sets public prize copy
  if (!pw || pk !== pw) return res.status(404).json({ ok: false, error: 'not_found' });
  try { res.json(promo.set(req.body || {})); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

router.get('/api/nq/leaderboard', async (req, res) => {
  if (throttled(req, 'leaderboard', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const q = req.query || {};
    const worlds = String(q.worlds || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= 99).slice(0, 12);
    const n = Math.max(1, Math.min(50, parseInt(q.n, 10) || 10));
    res.json({ ok: true, ...(await leaderboard.boards({ worlds, n })) });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// ---- /api/nq/claim : weekly physical-prize claims --------------------------
// The weekly board is a skill contest; last week's top verified wallet(s) win. The winner signs a
// consent message that BINDS the shipping address (hash inside the signed text) — see nq-claims.js
// for the full PII posture (collected only from winners, encrypted at rest, wiped after shipping).
router.get('/api/nq/claim/status', async (req, res) => {
  if (throttled(req, 'claimstatus', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const q = req.query || {};
    const week = q.week ? Number(q.week) : claims.lastCompletedWeek();
    const winners = await claims.winnersForWeek(week);
    const recs = claims.listClaims();
    const pk = String(q.pubkey || '').trim();
    const body = {
      ok: true, week, windowEndsAt: claims.windowEndsAt(week), ranks: claims.prizeRanks(),
      enabled: claims.enabled(),
      winners: winners.map((w) => ({ rank: w.rank, name: w.name, score: w.score,
        wallet: w.wallet.slice(0, 4) + '…' + w.wallet.slice(-4),
        claimed: recs.some((c) => c.week === week && c.wallet === w.wallet) })),
    };
    if (pk) {
      const me = winners.find((w) => w.wallet === pk);
      body.you = { isWinner: !!me, rank: me ? me.rank : null,
        claimed: !!me && recs.some((c) => c.week === week && c.wallet === pk),
        windowOpen: Date.now() <= claims.windowEndsAt(week) };
    }
    res.json(body);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/claim/prepare', async (req, res) => {
  if (throttled(req, 'claimprep', 10)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    const r = await claims.prepare(b.pubkey, b.week, b.address);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
router.post('/api/nq/claim', async (req, res) => {
  if (throttled(req, 'claimsubmit', 10)) return res.status(429).json({ ok: false, error: 'slow_down' });
  try {
    const b = req.body || {};
    const r = await claims.submit(b.pubkey, b.week, b.signature);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// Owner prizes panel — winners per completed week, claim status, DECRYPTED addresses (keyed page
// only), and the mark-shipped action that permanently wipes an address. PII: this is the single
// surface that ever renders an address.
// ---- /normie-quest-x7/prizes : the GIVEAWAY CONSOLE (owner-keyed) ----------
// One page for running the weekly physical-prize competition: live current-week standings with a
// cutoff countdown, completed weeks with claim state + decrypted addresses (this page is the ONLY
// place they decrypt; “mark shipped” wipes them), the suspect-run review list, and season control —
// the archive-first reset button plus every archive the resets have written.
router.get('/normie-quest-x7/prizes', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!masterOK(req)) return res.status(404).send('Not found');
  const key = esc(String((req.query && req.query.key) || ''));
  const ago = (t) => {
    if (!t) return '—';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
  };
  const until = (t) => {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 0) return 'closed';
    return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd ' + Math.round((m % 1440) / 60) + 'h';
  };
  try {
    // mark-shipped action (confirm-guarded like the season reset)
    const ship = String((req.query && req.query.shipped) || '');
    if (ship && String(req.query.confirm || '') === 'SHIPPED') {
      const m = ship.split(':');
      claims.markShipped(Number(m[0]), String(m[1] || ''));
    }

    const all = await leaderboard.list();
    const weekStart = leaderboard.weekStartMs();
    const cutoffAt = weekStart + 7 * 24 * 60 * 60 * 1000;
    const nRuns = all.length, nSus = all.filter((r) => r.suspect).length;
    const nVer = all.filter((r) => r.walletVerified && !r.suspect).length;
    const nWeek = all.filter((r) => r.at >= weekStart && !r.suspect).length;
    const tiles = [
      [nRuns, 'RUNS ON BOARD'], [nVer, 'VERIFIED'], [nSus, 'SUSPECT ☠'],
      [nWeek, 'THIS WEEK'], [until(cutoffAt), 'CUTOFF IN'],
      [claims.prizeRanks() + ' / wk', 'PRIZES'], [claims.claimDays() + 'd', 'CLAIM WINDOW'],
    ].map((t) => '<div class="tile"><div class="n">' + t[0] + '</div><div class="l">' + t[1] + '</div></div>').join('');

    // — this week, live: who wins if the week ended now (top verified non-suspect ranks) —
    const wkRows = (await leaderboard.topWeekly(10)).map((r) => {
      const winning = r.walletVerified && r.rank <= claims.prizeRanks();
      return '<tr' + (winning ? ' class="win"' : '') + '><td>#' + r.rank + (winning ? ' 🏆' : '') + '</td>'
        + '<td>' + esc(r.name || 'anon') + '</td><td class="mono">' + esc(r.wallet || '') + (r.walletVerified ? ' ✔' : '') + '</td>'
        + '<td>W' + r.world + '</td><td>' + r.score + '</td><td class="dim">' + ago(r.at) + '</td></tr>';
    }).join('');
    const thisWeek = '<h2>📅 THIS WEEK — LIVE STANDINGS <span class="sub">(cutoff ' + new Date(cutoffAt).toISOString().slice(0, 16).replace('T', ' ')
      + ' UTC · unverified wallets can still win by connecting before cutoff)</span></h2>'
      + '<table><tr><th>#</th><th>NAME</th><th>WALLET</th><th>WORLD</th><th>SCORE</th><th>WHEN</th></tr>'
      + (wkRows || '<tr><td colspan="6" class="dim">No scored runs yet this week.</td></tr>') + '</table>';

    // — completed weeks: winners + claim state + addresses —
    const recs = claims.listClaims();
    const weeks = [];
    for (let i = 1; i <= 8; i++) weeks.push(claims.lastCompletedWeek(Date.now() - (i - 1) * 7 * 24 * 60 * 60 * 1000));
    const blocks = [];
    for (const wk of weeks) {
      const winners = await claims.winnersForWeek(wk);
      if (!winners.length) continue;
      const winEnd = claims.windowEndsAt(wk);
      const rows = winners.map((w) => {
        const c = recs.find((x) => x.week === wk && x.wallet === w.wallet);
        let addr = '<span class="dim">unclaimed' + (Date.now() > winEnd ? ' · window closed' : ' · ' + until(winEnd) + ' left') + '</span>', st = '';
        if (c && c.shippedAt) { addr = '<span class="dim">address wiped</span>'; st = '📦 shipped ' + new Date(c.shippedAt).toISOString().slice(0, 10); }
        else if (c) {
          const a = c.addrEnc ? claims.decryptAddress(c.addrEnc) : null;
          addr = a ? esc([a.name, a.line1, a.line2, a.city, a.region, a.postal, a.country].filter(Boolean).join(', '))
                   : '<span class="dim">decrypt failed (secret rotated?)</span>';
          st = '<a href="/normie-quest-x7/prizes?key=' + key + '&shipped=' + wk + ':' + esc(w.wallet) + '&confirm=SHIPPED" '
             + 'onclick="return confirm(\'Mark shipped and permanently wipe the address?\')">mark shipped ✓</a>'
             + (c.dupAddress ? ' <b class="warn">⚠ address matches another winner</b>' : '');
        }
        return '<tr><td>#' + w.rank + '</td><td>' + esc(w.name || 'anon') + '</td><td class="mono">' + esc(w.wallet) + '</td>'
          + '<td>' + w.score + '</td><td>' + addr + '</td><td>' + st + '</td></tr>';
      }).join('');
      blocks.push('<h2>Week of ' + new Date(wk).toISOString().slice(0, 10) + '</h2>'
        + '<table><tr><th>#</th><th>NAME</th><th>WALLET</th><th>SCORE</th><th>SHIPPING ADDRESS</th><th></th></tr>' + rows + '</table>');
    }

    // — suspect runs: what the anti-cheat is excluding (review before shipping a prize) —
    const susRows = all.filter((r) => r.suspect).slice(-15).reverse().map((r) =>
      '<tr><td>' + esc(r.name || 'anon') + '</td><td class="mono">' + esc(r.wallet || '') + '</td>'
      + '<td>W' + r.world + '</td><td>' + r.score + '</td><td class="dim">' + ago(r.at) + '</td></tr>').join('');
    const susBlock = '<h2>☠ SUSPECT RUNS <span class="sub">(latest 15 — excluded from boards and prizes; a winner should never appear here)</span></h2>'
      + '<table><tr><th>NAME</th><th>WALLET</th><th>WORLD</th><th>SCORE</th><th>WHEN</th></tr>'
      + (susRows || '<tr><td colspan="5" class="dim">None flagged. Quiet is good.</td></tr>') + '</table>';

    // — season control: archive-first reset + archive history —
    const archives = await leaderboard.listArchives();
    const archRows = archives.map((a) => '<tr><td class="mono">' + esc(a.name) + '</td><td>' + (a.count == null ? '?' : a.count) + ' runs</td>'
      + '<td class="dim">' + (a.bytes == null ? '' : Math.round(a.bytes / 1024) + ' KB') + '</td></tr>').join('');
    const resetUrl = '/api/nq/leaderboard/reset?key=' + key + '&confirm=RESET';
    const season = '<h2>🗄 SEASON CONTROL</h2>'
      + '<p>The board holds <b>' + nRuns + '</b> runs. Reset archives every entry first (nothing is destroyed), then starts a fresh season — '
      + 'the first full prize week begins the Monday after.</p>'
      + '<button class="danger" onclick="if(confirm(\'Archive all ' + nRuns + ' runs and start a fresh season?\')&&confirm(\'Really reset the live leaderboard NOW?\'))'
      + 'fetch(' + JSON.stringify(resetUrl) + ').then(function(r){return r.json()}).then(function(j){alert(j.ok?(\'Archived \'+j.archived+\' runs to \'+j.to):(\'Failed: \'+(j.error||\'\')));location.reload()})">'
      + 'ARCHIVE + RESET SEASON</button>'
      + '<h3>Past season archives</h3><table><tr><th>ARCHIVE</th><th>RUNS</th><th></th></tr>'
      + (archRows || '<tr><td colspan="3" class="dim">No archives yet — no reset has run.</td></tr>') + '</table>';

    res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>NQ giveaway console</title><style>body{background:#0d0a1f;color:#dfe6ff;font-family:system-ui;padding:18px;max-width:1100px;margin:0 auto}'
      + 'table{border-collapse:collapse;width:100%;margin:8px 0 22px}td,th{border-bottom:1px solid #2a2450;padding:6px 8px;text-align:left;font-size:13px}'
      + 'h1{font-size:20px}h2{font-size:15px;color:#ffd23f;margin-top:26px}h3{font-size:13px;color:#c9c3e8}.sub{font-weight:400;color:#8f89b0;font-size:11px}'
      + 'a{color:#3dff6e}.dim{color:#6a6590}.mono{font-family:monospace;font-size:11px}.warn{color:#ff5a3c}'
      + '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;margin:14px 0}'
      + '.tile{background:#161228;border:1px solid #2a2450;border-radius:12px;padding:10px 12px}'
      + '.tile .n{font-size:19px;font-weight:800;color:#fff}.tile .l{font-size:9.5px;letter-spacing:1px;color:#8f89b0;margin-top:2px}'
      + 'tr.win td{background:#1d1836;color:#ffd23f}'
      + 'button.danger{background:#3a1420;color:#ff8a7a;border:1px solid #ff5a3c;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:13px}'
      + '</style>'
      + '<h1>🏆 Normie Quest — giveaway console</h1>'
      + '<p class="dim">Skill contest: top ' + claims.prizeRanks() + ' verified non-suspect run(s) per completed week (Mon–Sun UTC). '
      + 'Claim window: ' + claims.claimDays() + ' days. Addresses decrypt only on this page and are wiped by “mark shipped”.'
      + (claims.enabled() ? '' : ' <b class="warn">⚠ claims DISABLED — no NQ_CLAIM_SECRET / PREMIUM_ACCESS_KEY configured.</b>') + '</p>'
      + '<div class="tiles">' + tiles + '</div>'
      + thisWeek
      + '<h2>🎁 COMPLETED WEEKS — WINNERS &amp; CLAIMS</h2>'
      + (blocks.join('') || '<p class="dim">No completed week has a verified winner yet.</p>')
      + susBlock
      + season
      + '<p class="dim" style="margin-top:26px"><a href="/normie-quest-x7/dashboard?key=' + key + '">difficulty dashboard</a> · '
      + '<a href="/normie-quest-x7/feedback?key=' + key + '">feedback</a> · '
      + '<a href="/api/nq/claim/status">raw claim status</a></p>');
  } catch (e) { res.status(500).send('server error'); }
});

// Owner season reset — archives every entry (volume file / PG table) THEN clears the board.
// GET on purpose (owner fires it from a phone browser, like the wallet-watch lever); it is 404
// without the admin key and refuses without confirm=RESET, so a crawler or prefetch can't wipe it.
router.get('/api/nq/leaderboard/reset', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!masterOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  if (String((req.query && req.query.confirm) || '') !== 'RESET') {
    return res.status(400).json({ ok: false, error: 'add &confirm=RESET to archive the current board and wipe it' });
  }
  try { res.json({ ok: true, ...(await leaderboard.resetBoard()) }); }
  catch (e) { res.status(500).json({ ok: false, error: 'reset_failed_board_untouched' }); }
});

// ---- /api/nq/gate : the LAUNCH LOCK lever (owner-keyed) --------------------
// The whole "3 worlds now, more worlds later" switch. GET on purpose — the owner fires it from a
// phone browser, same as the leaderboard reset and the wallet-watch lever. 404 without the key.
//
//   read it:                 /api/nq/gate?key=KEY
//   OPEN THE HIGHER WORLDS:  /api/nq/gate?key=KEY&cap=0        <- the "few days are up" flip
//   put the cap back:        /api/nq/gate?key=KEY&cap=3
//   change the free tier:    /api/nq/gate?key=KEY&freeMax=4
//   panic — make it all free:/api/nq/gate?key=KEY&on=0
//   back to the env default: /api/nq/gate?key=KEY&reset=1
//
// Takes effect within ~5s for everyone (the client re-reads /wallet/config each launch, and the
// server caches gate state for 5s). No redeploy, no restart.
router.get('/api/nq/gate', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  if (!masterOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  const q = req.query || {};
  try {
    if (String(q.reset || '') === '1') return res.json({ ok: true, changed: true, gate: wallet.gate.clearOverride() });
    const patch = {};
    if (q.on != null && q.on !== '') patch.on = /^(1|true|yes|on)$/i.test(String(q.on));
    if (q.cap != null && q.cap !== '') patch.cap = q.cap;
    if (q.freeMax != null && q.freeMax !== '') patch.freeMax = q.freeMax;
    const changed = Object.keys(patch).length > 0;
    const gateState = changed ? wallet.gate.setState(patch) : wallet.gate.state(true);
    // Echo what a player would actually get, so the owner can eyeball the effect immediately.
    res.json({
      ok: true, changed, gate: gateState,
      effective: { noWallet: wallet.gate.freeWorlds(), tier1: wallet.gate.clamp([1, 12]), tier2: wallet.gate.clamp('all') },   // tier-1 = worlds 1-12 since the 2026-08-22 launch tiers
    });
  } catch (e) { res.status(500).json({ ok: false, error: 'gate_write_failed' }); }
});

// ---- shared per-IP throttle for the PUBLIC endpoints -----------------------
// IP = CF-Connecting-IP (the real visitor, set by Cloudflare and unforgeable now that the CLKN
// origin lockdown 403s any non-Cloudflare ingress). ⚠️ This used to take the LAST x-forwarded-for
// hop; that was correct pre-Cloudflare but once Cloudflare went in front (2026-08-04) the last hop
// became Cloudflare's SHARED edge IP — so every per-IP cap here collapsed into ONE global bucket
// (all players sharing a single 60/min counter). CF-Connecting-IP restores true per-visitor caps.
// Falls back to the last XFF hop, then req.ip, when the header is absent.
const pubRate = new Map();   // key -> {n, resetAt}
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return String(req.headers['cf-connecting-ip'] || (xff.length ? xff[xff.length - 1] : (req.ip || '?')));
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

// ---- /api/nq/pair : TV pairing --------------------------------------------
// A smart-TV / console browser cannot run a wallet, so it never tries. It asks for a code, the
// player types that code on their phone, and the phone hands over the session it already proved.
// See nq-pair.js for the two-secret design (public code + private claim) and its threat model.
//
// Defined here, below `throttled`, because all three routes are PUBLIC and want the per-IP cap:
// /new is the only one that allocates, and /poll is called on a 2s timer by every waiting TV.
router.post('/api/nq/pair/new', (req, res) => {
  try {
    if (throttled(req, 'pairnew', 12)) return res.status(429).json({ ok: false, error: 'slow_down' });
    res.json(pair.create());
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// The PHONE calls this. The session token is verified here, exactly as /api/nq/score verifies it —
// nq-pair itself never decides who owns a pubkey, it only carries what this route vouched for.
router.post('/api/nq/pair/claim', (req, res) => {
  try {
    if (throttled(req, 'pairclaim', 20)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const pk = String(b.wallet || ''), token = String(b.walletToken || '');
    if (!wallet.checkSession(pk, token)) return res.status(401).json({ ok: false, error: 'bad_session' });
    res.json(pair.bind(b.code, pk, token));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});
// The TV polls this. Needs the claim secret it was handed at /new — the code alone is worthless,
// which is what stops anyone who reads the code off the screen from taking the session.
router.get('/api/nq/pair/poll', (req, res) => {
  try {
    if (throttled(req, 'pairpoll', 90)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const q = req.query || {};
    res.json(pair.poll(String(q.code || ''), String(q.claim || '')));
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// The TV renders this as an <img>. Pairing had a working code exchange and no front door: the
// TV said "on your phone, open this game, tap 🎮 → Wallet → Pair a TV", which means typing an
// unlinked URL on a phone keyboard and then hunting a menu. Nobody did it. The QR carries the
// game URL WITH the code already in it, so a camera does all of that in one step.
//
// The code in the QR is the PUBLIC half of the pairing (see nq-pair.js) — the same string already
// printed in 34px on the screen. The `claim` secret is never encoded here and never leaves the TV,
// so photographing the QR is exactly as harmless as photographing the code.
//
// Rendered as SVG, not PNG: it scales to any TV without resampling, costs no canvas, and is a few
// hundred bytes. Level H so it still scans off a reflective screen at an angle.
router.get('/api/nq/pair/qr', async (req, res) => {
  try {
    if (throttled(req, 'pairqr', 30)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const code = String((req.query || {}).code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== pair.CODE_LEN) return res.status(400).json({ ok: false, error: 'bad_code' });
    // Build the target from OUR config, never from anything the caller sends — a caller-supplied
    // base would turn this into an open redirect painted as a QR on someone's television.
    const origin = (process.env.PUBLIC_ORIGIN || 'https://clucknorris.app').replace(/\/+$/, '');
    const target = origin + '/normie-quest-x7?pair=' + encodeURIComponent(code);
    const svg = await require('qrcode').toString(target, {
      type: 'svg', errorCorrectionLevel: 'H', margin: 1,
      color: { dark: '#12102a', light: '#ffffff' },
    });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');          // a pairing code is single-use and short-lived
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.send(svg);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

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
// headers, so no key). Hardened against fabrication (audit #29): `world` must be a real
// level name (validated in the store against the generated level set), 'clear' events must
// present a valid run token (checked below, non-consuming — deaths stay tokenless: they are
// the cheap high-volume signal and can only ADD difficulty, never fake progress), and
// eviction is per-world ring caps, so a flood can only churn one world's ring — it can no
// longer flush the whole dataset. The per-IP throttle bounds the request rate on top.
// GET is gated (per-world difficulty summary: hotspots, causes, clear rates).
router.post('/api/nq/telemetry', (req, res) => {
  try {
    if (throttled(req, 'tele', 60)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    // JOURNEY FIRST, deliberately ahead of the clear-token gate below. That gate protects the
    // DIFFICULTY store, where a fabricated clear would skew the clear-rate and avg-clear-time
    // numbers the owner tunes levels from. The funnel is a different animal: 'start', 'quit' and
    // 'powerup' carry no token and never could (they are fire-and-forget beacons, and a start has
    // no run to prove yet), so gating only 'clear' would count every start and drop the matching
    // clear — manufacturing phantom drop-off in the exact metric the funnel exists to report.
    // Consistency wins: the journey store takes all event types on the same terms, and its abuse
    // surface is unchanged from what starts/quits already present.
    let j = null;
    if (b.sid) {
      try { j = journey.track({ ev: b.ev, sid: b.sid, world: b.world, x: b.x, t: b.t, cause: b.cause, item: b.item, score: b.score, dev: uaDevice(req.get('user-agent')) }); }
      catch (e) { j = null; }
    }
    // Anything that isn't death/clear is journey-only — the difficulty store doesn't model it,
    // and must not report it as a bad event just because it rejected an unknown type.
    if (b.ev !== 'death' && b.ev !== 'clear') {
      return res.status(j && j.ok ? 200 : 400).json(j || { ok: false, status: 'no_sid' });
    }
    // a 'clear' shifts the difficulty stats the owner tunes from (clear rates, avg clear time),
    // so it must prove a real run: same HMAC token family /api/nq/score verifies, but WITHOUT
    // burning the run nonce (that stays single-use at score submit).
    if (b.ev === 'clear' && !leaderboard.verifyRun(b.token || null).ok) {
      return res.status(400).json({ ok: false, status: 'bad_token', journey: !!(j && j.ok) });
    }
    const r = telemetry.add({ ev: b.ev, world: b.world, x: b.x, cause: b.cause, t: b.t, deaths: b.deaths, score: b.score, who: b.who });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// per-world difficulty summary (gated). ?since=<ms> to scope; default = everything.
router.get('/api/nq/telemetry', (req, res) => {
  if (!adminOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  try { res.json({ ok: true, total: telemetry.count(), ...telemetry.summary(Number(req.query.since) || 0) }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
});

// ---- /api/nq/journey : per-player session data (all gated) ----------------
// funnel = per-level starts/clears/deaths/quits from permanent aggregates;
// drop = levels ranked by where players actually give up;
// sessions = the rolling detail window; ?sid= = one player's full ordered path.
router.get('/api/nq/journey', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!adminOK(req)) return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    const sid = String((req.query && req.query.sid) || '').trim();
    if (sid) {
      const d = journey.sessionDetail(sid);
      return d ? res.json({ ok: true, session: d }) : res.status(404).json({ ok: false, error: 'no_such_session' });
    }
    // ?hours=N is the friendly form of ?since=<ms>; both scope every view to a time window.
    const hrs = Math.max(0, Math.min(720, parseInt(req.query.hours, 10) || 0));
    const since = hrs ? Date.now() - hrs * 3600000 : (Number(req.query.since) || 0);
    const view = String((req.query && req.query.view) || 'overview');
    if (view === 'funnel') return res.json({ ok: true, hours: hrs || null, funnel: journey.funnel(since) });
    if (view === 'drop') return res.json({ ok: true, hours: hrs || null, drop: journey.dropOff(Number(req.query.n) || 15, since) });
    if (view === 'hardest') return res.json({ ok: true, hours: hrs || null, hardest: journey.hardest(Number(req.query.n) || 15, since) });
    if (view === 'sessions') return res.json({ ok: true, hours: hrs || null, sessions: journey.sessions(Number(req.query.n) || 50, since) });
    res.json({ ok: true, hours: hrs || null, ...journey.overview(since) });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
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
    + '.winbar{margin:14px 0 6px;font:600 11px/1.9 ui-monospace,monospace;letter-spacing:.08em;opacity:.9}.winbar .chip{margin-right:6px;text-decoration:none;display:inline-block}.chip{background:#1a1630;border:1px solid #33305a;color:#cbc6e6;border-radius:14px;padding:4px 11px;font-size:12px;cursor:pointer}'
    + '.chip.on{background:#ffd23f;color:#20142e;border-color:#ffd23f;font-weight:600}'
    + '.c{background:#161228;border:1px solid #2a2450;border-radius:10px;padding:10px 12px;margin-bottom:9px}'
    + '.meta{font-size:12px;color:#9a95bd;margin-bottom:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}'
    + '.meta b{color:#66ccff}.lvl{background:#22406a;color:#bfe0ff;border-radius:4px;padding:1px 6px;font-size:11px}'
    + '.kind{border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase}'
    + '.k-bug{background:#5a1330;color:#ff9db8}.k-idea{background:#134a2e;color:#8dffc0}.k-note{background:#2a2450;color:#cbc6e6}'
    + '.t{margin-left:auto;color:#6a6590;font-size:11px}.txt{font-size:15px;line-height:1.4;white-space:pre-wrap;word-break:break-word}'
    + '.empty{color:#8f89b0;padding:30px 0;text-align:center}</style></head><body>'
    + '<h1>🎮 Normie Quest — Playtest Feedback</h1><div class="sub">' + items.length + ' comment(s) · newest first · '
    + '<a class="klink" style="color:#66ccff" href="/api/nq/feedback">raw JSON</a></div>'
    + '<div class="chips">' + chips + '</div><div id="list">' + (rows || '<div class="empty">No comments yet.</div>') + '</div>'
    + '<script>var cs=document.querySelectorAll(".chip"),cards=document.querySelectorAll(".c");'
    + 'cs.forEach(function(b){b.onclick=function(){cs.forEach(function(x){x.classList.remove("on")});b.classList.add("on");'
    + 'var l=b.getAttribute("data-l");cards.forEach(function(c){var m=c.querySelector(".lvl");var cl=m?m.textContent:"";'
    + 'c.style.display=(!l||cl===l)?"":"none"})}});'
    + '(function(){var k=new URLSearchParams(location.search).get("key")||"";if(!k)return;document.querySelectorAll("a.klink").forEach(function(a){try{var u=new URL(a.getAttribute("href"),location.origin);u.searchParams.set("key",k);a.setAttribute("href",u.pathname+u.search);}catch(e){}});})();'
    + '</script></body></html>');
});

// ---- /normie-quest-x7/dashboard : the operator's everything-view -----------------------------
// One gated page with ALL of it: per-level difficulty (all-time, every level, death-map strips),
// leaderboards, latest comments, store health. Server-rendered like the feedback page; everything
// tester-supplied is escaped. The digest links here.
router.get('/normie-quest-x7/dashboard', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (!adminOK(req)) return res.status(404).send('Not found');
  const key = esc(String((req.query && req.query.key) || ''));
  // Granular death causes shipped in commit 3e2db4c (deploy 2026-07-20 15:39 UTC). Every event
  // BEFORE that carries the legacy generic "WRECKED BY FUD" label; everything after is specific.
  // Default view starts at the cutoff so TOP CAUSE reflects what actually kills testers now;
  // ?window=all shows the full history (early levels revert to their legacy-FUD backlog).
  const CAUSES_SHIPPED_AT = 1784561949000;
  // ?window= drives BOTH panels so the whole page always describes one time slice. 'all' is
  // all-time; a bare number is hours. Anything else falls back to the causes cutoff, which is
  // the historical default (deaths before 2026-07-20 carry only the generic legacy label).
  const rawWin = String((req.query && req.query.window) || '').trim();
  const winHours = /^\d+$/.test(rawWin) ? Math.max(1, Math.min(720, parseInt(rawWin, 10))) : 0;
  const showAll = rawWin === 'all';
  const winSince = winHours ? Date.now() - winHours * 3600000 : 0;
  const diffSince = winHours ? winSince : (showAll ? 0 : CAUSES_SHIPPED_AT);
  const winLabel = winHours ? ('LAST ' + winHours + 'H') : (showAll ? 'ALL TIME' : 'SINCE 2026-07-20');
  let d = { events: 0, deaths: 0, clears: 0, firstAt: 0, lastAt: 0, worlds: [] };
  try { d = telemetry.detailAll(diffSince); } catch (e) { /* render empty */ }
  let comments = [];
  try { comments = (feedback.list() || []).slice().reverse(); } catch (e) { comments = []; }
  let lb = null;
  try { lb = await leaderboard.boards({ n: 10 }); } catch (e) { lb = null; }
  let walletUse = {};
  try { walletUse = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || '/data', 'nq-wallet-usage.json'), 'utf8')) || {}; } catch (e) {}
  // Raw score rows (non-suspect) power the per-world / VIP boards + the engagement trend; the VIP
  // allowlist marks which verified wallets are members. Both are cheap local reads.
  let lbRaw = [];
  try { lbRaw = ((await leaderboard.list()) || []).filter(function (r) { return r && !r.suspect; }); } catch (e) { lbRaw = []; }
  let vips = [];
  try { vips = wallet.vipList() || []; } catch (e) { vips = []; }
  const vipSet = new Set(vips.map(String));
  const playerKey = function (r) { return r.walletVerified && r.wallet ? 'w:' + r.wallet : 'n:' + String(r.name || 'anon').toLowerCase(); };
  const rankRows = function (rows, n) {   // best run per distinct player, ranked by score (mirrors nq-leaderboard)
    const best = new Map();
    rows.forEach(function (r) { const k = playerKey(r), c = best.get(k); if (!c || r.score > c.score) best.set(k, r); });
    return [...best.values()].sort(function (a, b) { return b.score - a.score || a.at - b.at; }).slice(0, n);
  };
  const distinctPlayers = new Set(lbRaw.map(playerKey)).size;
  const verifiedRuns = lbRaw.filter(function (r) { return r.walletVerified; }).length;
  const vipRows = rankRows(lbRaw.filter(function (r) { return r.walletVerified && vipSet.has(String(r.wallet)); }), 12);
  // 14-day activity trend from real run timestamps
  const DAY = 86400000, NDAYS = 14, nowMs = Date.now();
  const dayRuns = new Array(NDAYS).fill(0);
  lbRaw.forEach(function (r) { const bk = Math.floor((nowMs - r.at) / DAY); if (bk >= 0 && bk < NDAYS) dayRuns[NDAYS - 1 - bk]++; });
  const runs7 = dayRuns.slice(-7).reduce(function (a, b) { return a + b; }, 0);
  // per-world "depth ladder": best score among players whose FURTHEST world reached == N
  const byExactWorld = {};
  lbRaw.forEach(function (r) { const w = r.world | 0; if (w >= 1) (byExactWorld[w] = byExactWorld[w] || []).push(r); });
  const exactWorlds = Object.keys(byExactWorld).map(Number).sort(function (a, b) { return b - a; });

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
    // Prefer the top REAL cause; "WRECKED BY FUD" is the pre-2026-07-20 legacy generic — show it
    // dimmed as a trailing note so it never masks the specific cause.
    const real = (w.topCauses || []).filter(function (c) { return c.cause !== 'WRECKED BY FUD'; });
    const legacy = (w.topCauses || []).filter(function (c) { return c.cause === 'WRECKED BY FUD'; })[0];
    let cause;
    if (real[0]) {
      cause = esc(real[0].cause) + ' ×' + real[0].n
        + (legacy ? ' <span class="dim">(+' + legacy.n + ' legacy)</span>' : '');
    } else if (legacy) {
      cause = '<span class="dim">' + esc(legacy.cause) + ' ×' + legacy.n + ' (legacy)</span>';
    } else {
      cause = '<span class="dim">—</span>';
    }
    return '<tr id="lvl-' + esc(w.world) + '"' + (flag(w) ? ' class="warn"' : '') + '><td class="lvl">' + esc(w.world) + (flag(w) ? ' ⚠' : '') + '</td>'
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
  // 🎯 TOP KILLERS — aggregate the real per-level causes into a global "what kills players" board.
  const causeTotals = {};
  rows.forEach(function (w) { (w.topCauses || []).forEach(function (c) {
    if (c.cause && c.cause !== 'WRECKED BY FUD') causeTotals[c.cause] = (causeTotals[c.cause] || 0) + c.n; }); });
  const topKillers = Object.entries(causeTotals).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
  const killerMax = topKillers.length ? topKillers[0][1] : 1;
  const killerRows = topKillers.map(function (k) {
    const pct = (k[1] / killerMax * 100).toFixed(1);
    return '<div class="kill"><span class="kn">' + esc(k[0]) + '</span><span class="kbar"><i style="width:' + pct + '%"></i></span><span class="kc">' + k[1] + '</span></div>';
  }).join('') || '<div class="dim">No cause data yet.</div>';
  // ⚠ NEEDS ATTENTION — the flagged (hardest) levels, worst first, surfaced up top.
  const flagged = rows.filter(flag).slice().sort(function (a, b) {
    const av = a.deathsPerClear === null ? 1e9 : a.deathsPerClear, bv = b.deathsPerClear === null ? 1e9 : b.deathsPerClear;
    return bv - av;
  });
  const attentionChips = flagged.slice(0, 12).map(function (w) {
    const dpc = w.deathsPerClear === null ? '∞' : w.deathsPerClear;
    return '<a class="chip" href="#lvl-' + esc(w.world) + '" title="' + w.deaths + ' deaths · ' + w.clears + ' clears">' + esc(w.world) + ' <b>' + dpc + '</b></a>';
  }).join('');

  // 🧪 PANEL COVERAGE — one row per tagged tester (?tester=T1 links), a world-by-world strip:
  // green = cleared a level there, red = deaths only, dark = untouched. Shows at a glance which
  // worlds the 10-person panel has actually covered and who stalled where.
  const NWORLDS = 21;
  const testers = d.testers || {};
  const testerCodes = Object.keys(testers).filter(function (c) { return c !== '(untagged)'; }).sort();
  const panelRows = testerCodes.map(function (code) {
    const t = testers[code];
    const perWorld = {};   // world number -> {c,d}
    Object.keys(t.worlds || {}).forEach(function (lvl) {
      const m = /^(\d+)-/.exec(lvl); if (!m) return;
      const w = +m[1]; const p = (perWorld[w] = perWorld[w] || { c: 0, d: 0 });
      p.c += t.worlds[lvl].c; p.d += t.worlds[lvl].d;
    });
    let best = 0;
    let strip = '';
    for (let w = 1; w <= NWORLDS; w++) {
      const p = perWorld[w];
      const cls = p ? (p.c ? 'pw-c' : 'pw-d') : 'pw-0';
      if (p) best = w;
      strip += '<i class="' + cls + '" title="W' + w + (p ? ': ' + p.c + '✓ ' + p.d + '☠' : ': untouched') + '">' + w + '</i>';
    }
    return '<tr><td><b>' + esc(code) + '</b></td><td>' + t.clears + '</td><td>' + t.deaths + '</td>'
      + '<td>W' + best + '</td><td><div class="pstrip">' + strip + '</div></td><td class="dim">' + ago(t.lastAt || 0) + '</td></tr>';
  }).join('');
  const untagged = testers['(untagged)'];
  const panelSection = '<h2>🧪 PANEL COVERAGE <span class="dim" style="font-weight:400">(tag testers with ?tester=CODE links · green = cleared, red = deaths only, dark = untouched)</span></h2>'
    + '<div style="overflow-x:auto"><table><tr><th>TESTER</th><th>✓</th><th>☠</th><th>BEST</th><th>WORLDS 1–' + NWORLDS + '</th><th>LAST</th></tr>'
    + (panelRows || '<tr><td colspan="6" class="dim">No tagged testers yet — send each panelist their personal link: /normie-quest-x7?test=1&amp;tester=T1 … T10 (the tag sticks after one visit).</td></tr>')
    + '</table></div>'
    + (untagged ? '<div class="dim" style="margin:-6px 0 14px;font-size:12px">+ untagged traffic: ' + untagged.clears + '✓ / ' + untagged.deaths + '☠</div>' : '');

  // 🏆 leaderboard row renderer — verified ✔ + VIP badge, medal-tinted top 3
  const short = function (w) { const s = String(w || ''); return s.length > 12 ? s.slice(0, 4) + '…' + s.slice(-4) : s; };
  const boardRows = function (list) {
    return (list || []).map(function (r, i) {
      const isv = r.walletVerified && vipSet.has(String(r.wallet));
      const marks = (r.walletVerified ? '<span class="ver" title="wallet-verified">✔</span>' : '') + (isv ? '<span class="vip">VIP</span>' : '');
      return '<tr' + (i < 3 ? ' class="m' + (i + 1) + '"' : '') + '><td class="rank">' + (i + 1) + '</td>'
        + '<td class="pl">' + esc(r.name || 'anon') + marks + '</td>'
        + '<td><span class="wtag">W' + esc(String(r.world != null ? r.world : '?')) + '</span></td>'
        + '<td class="sc">' + Number(r.score || 0).toLocaleString() + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="dim">no runs yet</td></tr>';
  };

  // 📈 ENGAGEMENT — real 14-day activity trend from run timestamps + player counts
  const emax = Math.max.apply(null, [1].concat(dayRuns));
  const spark = dayRuns.map(function (n, i) {
    const dback = NDAYS - 1 - i;
    return '<i style="height:' + Math.max(4, (n / emax * 100)).toFixed(0) + '%" title="' + n + ' run' + (n === 1 ? '' : 's') + ' · ' + (dback === 0 ? 'today' : dback + 'd ago') + '"><b>' + (n || '') + '</b></i>';
  }).join('');
  const engagementSection = '<h2>📈 ENGAGEMENT <span class="dim" style="font-weight:400">(scored runs per day · last 14 days)</span></h2>'
    + '<div class="engwrap"><div class="engtiles">'
    + '<div class="et"><div class="n">' + distinctPlayers + '</div><div class="l">DISTINCT PLAYERS</div></div>'
    + '<div class="et"><div class="n">' + runs7 + '</div><div class="l">RUNS · 7 DAYS</div></div>'
    + '<div class="et"><div class="n">' + verifiedRuns + '</div><div class="l">WALLET-VERIFIED RUNS</div></div>'
    + '<div class="et"><div class="n">' + vips.length + '</div><div class="l">VIP MEMBERS 👑</div></div>'
    + '</div><div class="spark">' + spark + '</div></div>';

  // 🗺️ DEPTH LADDER — per-world segmentation the honest way: grouped by the FURTHEST world a
  // player reached (score is a single cumulative number per run, so "score earned in world N" would
  // need a game-side change — flagged in the reply). Top 3 per depth.
  const perWorldSection = '<h2>🗺️ DEPTH LADDER <span class="dim" style="font-weight:400">(top scorers grouped by furthest world reached)</span></h2>'
    + '<div class="ladder">' + (exactWorlds.length ? exactWorlds.map(function (w) {
      const top = rankRows(byExactWorld[w], 3), tot = byExactWorld[w].length;
      return '<div class="rung"><div class="rw">WORLD ' + w + '<span class="rc">' + tot + ' player' + (tot === 1 ? '' : 's') + '</span></div>'
        + top.map(function (r, i) {
          const isv = r.walletVerified && vipSet.has(String(r.wallet));
          return '<div class="re"><span class="rn">' + (i + 1) + '</span><span class="rp">' + esc(r.name || 'anon') + (isv ? ' <span class="vip">VIP</span>' : '') + '</span><span class="rs">' + Number(r.score || 0).toLocaleString() + '</span></div>';
        }).join('') + '</div>';
    }).join('') : '<div class="dim">no scored runs yet</div>') + '</div>';

  // 👑 VIP — the members-only board + the allowlist roster with each member's best run
  const vipMembersRows = vips.length ? vips.map(function (w) {
    const best = rankRows(lbRaw.filter(function (r) { return r.walletVerified && String(r.wallet) === String(w); }), 1)[0];
    return '<tr><td class="mono">' + esc(short(w)) + '</td><td>' + (best ? esc(best.name || 'anon') : '<span class="dim">— not played</span>') + '</td><td class="sc">' + (best ? Number(best.score || 0).toLocaleString() : '<span class="dim">—</span>') + '</td></tr>';
  }).join('') : '<tr><td colspan="3" class="dim">No VIP members yet — add wallets on the lounge-admin allowlist.</td></tr>';
  const vipSection = '<h2>👑 VIP TIER</h2><div class="cols"><div>'
    + '<h3>VIP LEADERBOARD</h3><table><tr><th>#</th><th>NAME</th><th>WORLD</th><th>SCORE</th></tr>'
    + (vipRows.length ? boardRows(vipRows) : '<tr><td colspan="4" class="dim">No VIP runs yet — a VIP-tagged wallet needs one scored run.</td></tr>') + '</table>'
    + '</div><div>'
    + '<h3>MEMBERS <span class="dim" style="font-weight:400">(' + vips.length + ' on the allowlist)</span></h3>'
    + '<table><tr><th>WALLET</th><th>BEST NAME</th><th>BEST SCORE</th></tr>' + vipMembersRows + '</table>'
    + '</div></div>';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  // 🧭 PLAYER JOURNEY — the funnel. Scored runs only count players who FINISH and submit; this
  // counts everyone who pressed start, which is the number that answers "did launch day work".
  // `starts` is the denominator, `quits` is the abandon beacon, and drop-off ranks where we
  // actually lose people. Aggregates are permanent; the session list is a rolling window.
  let jov = null, jdrop = [], jsess = [], jhard = [];
  try { jov = journey.overview(winSince); } catch (e) { jov = null; }
  try { jdrop = journey.dropOff(12, winSince) || []; } catch (e) { jdrop = []; }
  try { jsess = journey.sessions(25, winSince) || []; } catch (e) { jsess = []; }
  try { jhard = journey.hardest(12, winSince) || []; } catch (e) { jhard = []; }
  const pct = function (v) { return v === null || v === undefined ? '<span class="dim">—</span>' : v + '%'; };
  const winChip = function (v, label) {
    const on = (v === 'all' ? showAll : (v === '' ? (!winHours && !showAll) : String(winHours) === v));
    return '<a class="chip' + (on ? ' on' : '') + '" href="?window=' + v + '&key=' + key + '">' + label + '</a>';
  };
  const windowBar = '<div class="winbar">WINDOW: '
    + winChip('4', '4H') + winChip('8', '8H') + winChip('12', '12H') + winChip('24', '24H')
    + winChip('', 'SINCE 07-20') + winChip('all', 'ALL TIME')
    + '<span class="dim"> — applies to the journey panel AND the difficulty table below</span></div>';
  const journeySection = jov
    ? windowBar
      + '<h2>🧭 PLAYER JOURNEY <span class="dim" style="font-weight:400">(' + winLabel
      + ' · anonymous per-browser sessions — counts everyone who played, not just who scored)</span></h2>'
      + (jov.partial ? '<div class="attn"><div class="h">⚠ WINDOWED VIEW IS A SAMPLE</div><div class="dim" style="padding:6px 10px">'
          + 'Session retention is full (' + jov.windowCap + ' sessions × ' + jov.eventsPerSessionCap
          + ' events). Time-sliced numbers read only what is still retained, so they can undercount. '
          + 'The ALL TIME view uses permanent counters and is complete.</div></div>' : '')
      + '<div class="cards">'
      + '<div class="card"><b>' + jov.uniquePlayers + '</b><span>UNIQUE PLAYERS</span></div>'
      + '<div class="card"><b>' + jov.medianMinutes + 'm</b><span>MEDIAN SESSION</span></div>'
      + '<div class="card"><b>' + jov.avgMinutes + 'm</b><span>AVG SESSION</span></div>'
      + '<div class="card"><b>' + jov.longestMinutes + 'm</b><span>LONGEST</span></div>'
      + '<div class="card"><b>' + jov.totalMinutes + 'm</b><span>TOTAL PLAYTIME</span></div>'
      + '<div class="card"><b>' + jov.returningSessions + '</b><span>CAME BACK</span></div>'
      + '<div class="card"><b>' + jov.starts + '</b><span>LEVEL STARTS</span></div>'
      + '<div class="card"><b>' + jov.quits + '</b><span>ABANDONED ⤴</span></div>'
      + '<div class="card"><b>' + jov.deaths + '</b><span>DEATHS ☠</span></div>'
      + '<div class="card"><b>' + jov.powerups + '</b><span>POWERUPS</span></div>'
      + '<div class="card"><b>' + jov.levelsTouched + '</b><span>LEVELS TOUCHED</span></div>'
      + '<div class="card"><b>' + (jov.overallClearRate === null ? '—' : jov.overallClearRate + '%') + '</b><span>CLEAR RATE</span></div>'
      + '</div>'
      + (jhard.length
        ? '<h2>🔥 HARDEST IN WINDOW <span class="dim" style="font-weight:400">(deaths per clear · ∞ = nobody cleared it)</span></h2>'
          + '<div style="overflow-x:auto"><table><tr><th>LEVEL</th><th>☠/✓</th><th>☠</th><th>✓</th><th>STARTED</th><th>FAIL RATE</th><th>QUIT</th></tr>'
          + jhard.map(function (r) {
            return '<tr><td><b>' + esc(r.world) + '</b></td><td class="bad">'
              + (r.deathsPerClear === null ? '∞' : r.deathsPerClear) + '</td><td>' + r.deaths + '</td><td>' + r.clears
              + '</td><td>' + r.starts + '</td><td>' + pct(r.failRate) + '</td><td>' + r.quits + '</td></tr>';
          }).join('') + '</table></div>'
        : '')
      + (jdrop.length
        ? '<h2>🚪 WHERE PLAYERS QUIT <span class="dim" style="font-weight:400">(' + winLabel + ' · abandoned mid-level — closed the tab or switched away)</span></h2>'
          + '<div style="overflow-x:auto"><table><tr><th>LEVEL</th><th>QUIT</th><th>OF STARTS</th><th>STARTED</th><th>CLEARED</th><th>CLEAR RATE</th></tr>'
          + jdrop.map(function (r) {
            return '<tr><td><b>' + esc(r.world) + '</b></td><td class="bad">' + r.quits + '</td><td>' + pct(r.quitRate)
              + '</td><td>' + r.starts + '</td><td>' + r.clears + '</td><td>' + pct(r.clearRate) + '</td></tr>';
          }).join('') + '</table></div>'
        : '<p class="dim">No abandons recorded yet — this fills in as players close the tab mid-level.</p>')
      + (jsess.length
        ? '<h2>👣 RECENT PLAYERS <span class="dim" style="font-weight:400">(' + winLabel + ' · newest first · sid is a random per-browser tag, not a wallet or a name)</span></h2>'
          + '<div style="overflow-x:auto"><table><tr><th>SID</th><th>LEVELS</th><th>CLEARED</th><th>DEATHS</th><th>POWERUPS</th><th>MINS</th><th>VISITS</th><th>LAST SEEN</th></tr>'
          + jsess.map(function (r) {
            return '<tr><td class="mono">' + esc(r.sid) + '</td><td>' + r.levelsSeen + '</td><td>' + r.levelsCleared
              + '</td><td>' + r.deaths + '</td><td>' + r.powerups + '</td><td>' + r.minutes + '</td><td>' + r.visits
              + '</td><td class="dim">' + esc(r.lastEv) + ' @ ' + esc(r.lastWorld) + ' · ' + ago(r.last) + '</td></tr>';
          }).join('') + '</table></div>'
        : '')
      + '<p class="dim">Full funnel JSON: <a href="/api/nq/journey?view=funnel&hours=' + (winHours || '') + '&key=' + key + '">funnel</a> · '
      + '<a href="/api/nq/journey?view=drop&hours=' + (winHours || '') + '&key=' + key + '">drop-off</a> · '
      + '<a href="/api/nq/journey?view=sessions&hours=' + (winHours || '') + '&key=' + key + '">sessions</a> · '
      + 'one player\'s full path: <code>/api/nq/journey?sid=&lt;sid&gt;&amp;key=…</code></p>'
    : '';

  res.send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>Normie Quest — Operator Dashboard</title><style>'
    + 'body{margin:0;background:radial-gradient(120% 80% at 50% -10%,#181033,#0c0818 60%);color:#eee;font-family:system-ui,Segoe UI,Roboto,sans-serif;padding:0 0 48px;-webkit-font-smoothing:antialiased}'
    + '.wrap{max-width:1080px;margin:0 auto;padding:0 14px}'
    + '.topbar{position:sticky;top:0;z-index:9;background:rgba(12,8,24,.82);backdrop-filter:blur(8px);border-bottom:1px solid #2a2450;padding:12px 14px;margin-bottom:16px}'
    + '.topbar .in{max-width:1080px;margin:0 auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap}'
    + 'h1{color:#ffd23f;font-size:19px;margin:0;font-weight:800;letter-spacing:.3px;text-shadow:0 0 18px rgba(255,210,63,.25)}'
    + '.live{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#8dffc0;margin-left:auto}'
    + '.live .dot{width:8px;height:8px;border-radius:50%;background:#3dff8e;box-shadow:0 0 8px #3dff8e;animation:pulse 1.6s infinite}'
    + '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}'
    + '.live b{color:#cfeaff}.live button{background:#20204a;color:#bfd0ff;border:1px solid #3a3a70;border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer}'
    + '.live button:hover{background:#2a2a5c}'
    + 'h2{color:#c9a7ff;font-size:14px;margin:28px 0 9px;letter-spacing:1px}'
    + '.sub{color:#8f89b0;font-size:12.5px;margin-bottom:14px}.sub a{color:#66ccff;text-decoration:none}.sub a:hover{text-decoration:underline}'
    + '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:9px;margin-bottom:6px}'
    + '.tile{background:linear-gradient(160deg,#191330,#130f26);border:1px solid #2a2450;border-radius:12px;padding:11px 13px;position:relative;overflow:hidden}'
    + '.tile::after{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,#ff7a18,#ffd23f)}'
    + '.tile .n{font-size:23px;font-weight:800;color:#fff;line-height:1.1}.tile .l{font-size:10.5px;color:#8f89b0;letter-spacing:1px;margin-top:2px}'
    + '.attn{background:linear-gradient(160deg,rgba(255,56,96,.12),rgba(255,122,24,.06));border:1px solid rgba(255,90,120,.4);border-radius:12px;padding:12px 14px;margin:14px 0 4px}'
    + '.attn .h{font-size:12px;font-weight:800;letter-spacing:1px;color:#ff9db8;margin-bottom:8px}'
    + '.attn .chips{display:flex;flex-wrap:wrap;gap:6px}'
    + '.chip{background:rgba(255,56,96,.14);border:1px solid rgba(255,90,120,.45);color:#ffd0dd;border-radius:99px;padding:3px 10px;font-size:12px;text-decoration:none;white-space:nowrap}'
    + '.chip b{color:#ff6a99}.chip:hover{background:rgba(255,56,96,.26)}'
    + '.kill{display:grid;grid-template-columns:150px 1fr 44px;align-items:center;gap:10px;margin:5px 0;font-size:12.5px}'
    + '.kill .kn{color:#cfe0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.kill .kbar{height:12px;background:#1a1630;border-radius:4px;overflow:hidden}'
    + '.kill .kbar i{display:block;height:100%;background:linear-gradient(90deg,#ff7a18,#ff3860);border-radius:4px}'
    + '.kill .kc{color:#ff9db8;font-weight:700;text-align:right}'
    + '@media(max-width:520px){.kill{grid-template-columns:110px 1fr 38px}}'
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
    + '.pstrip{display:flex;gap:2px}.pstrip i{font-style:normal;font-size:10px;line-height:16px;min-width:16px;text-align:center;border-radius:3px}'
    + '.pw-c{background:#134a2e;color:#8dffc0}.pw-d{background:#5a1330;color:#ff9db8}.pw-0{background:#191533;color:#4a4570}'
    + '@media(max-width:720px){.cols{grid-template-columns:1fr}}'
    + 'h3{color:#bfe0ff;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin:0 0 8px}'
    + '.pl{font-weight:600}.ver{color:#3dff8e;font-size:11px;margin-left:5px}'
    + '.vip{background:linear-gradient(90deg,#ffd23f,#ff9d2e);color:#1a1204;font-size:9px;font-weight:800;letter-spacing:.5px;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:middle}'
    + '.rank{color:#6a6590;width:24px;font-variant-numeric:tabular-nums}.sc{text-align:right;font-weight:700;color:#ffd23f;font-variant-numeric:tabular-nums}'
    + '.wtag{font-size:11px;color:#8fd0ff;background:rgba(103,208,255,.1);border:1px solid rgba(103,208,255,.28);border-radius:5px;padding:1px 6px}'
    + 'tr.m1 td{background:linear-gradient(90deg,rgba(255,210,63,.12),transparent)}tr.m2 td{background:linear-gradient(90deg,rgba(200,210,230,.08),transparent)}tr.m3 td{background:linear-gradient(90deg,rgba(205,127,50,.1),transparent)}'
    + '.mono{font-family:ui-monospace,monospace;font-size:12px;color:#cfe0ff}'
    + '.engwrap{background:#161228;border:1px solid #2a2450;border-radius:14px;padding:14px 16px}'
    + '.engtiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}'
    + '.et{border-left:3px solid #ff9d2e;padding-left:10px}'
    + '.et .n{font-size:22px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}.et .l{font-size:9.5px;letter-spacing:1px;color:#8f89b0;text-transform:uppercase;margin-top:2px}'
    + '.spark{display:flex;align-items:flex-end;gap:5px;height:88px;padding-top:14px;border-top:1px solid #201a3a}'
    + '.spark i{flex:1;min-height:4px;background:linear-gradient(180deg,#ffd23f,#ff5a3c);border-radius:4px 4px 0 0;position:relative;opacity:.9}'
    + '.spark i:hover{opacity:1}.spark i b{position:absolute;top:-14px;left:0;right:0;text-align:center;font-size:9.5px;color:#8f89b0;font-weight:400}'
    + '.ladder{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:10px}'
    + '.rung{background:#161228;border:1px solid #2a2450;border-radius:12px;padding:11px 13px}'
    + '.rung .rw{font-size:11px;font-weight:800;letter-spacing:1px;color:#ffd23f;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #2a2450}'
    + '.rung .rc{font-size:10px;font-weight:400;color:#6a6590;letter-spacing:0}'
    + '.re{display:grid;grid-template-columns:16px 1fr auto;gap:8px;align-items:center;font-size:12.5px;padding:2px 0}'
    + '.re .rn{color:#6a6590;font-variant-numeric:tabular-nums}.re .rp{color:#dfe6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.re .rs{color:#ffd23f;font-weight:700;font-variant-numeric:tabular-nums}'
    + '@media(max-width:520px){.engtiles{grid-template-columns:repeat(2,1fr)}}'
    + '</style></head><body>'
    + '<div class="topbar"><div class="in"><h1>🎮 Normie Quest — Operator Dashboard</h1>'
    + '<span class="live"><span class="dot"></span> LIVE · refresh in <b id="cd">30s</b> '
    + '<button id="pause">⏸ pause</button></span></div></div>'
    + '<div class="wrap">'
    + '<div class="sub">' + (showAll
        ? 'ALL-TIME data (incl. pre-2026-07-20 legacy “FUD” deaths) · <a class="klink" href="/normie-quest-x7/dashboard"><b>show since causes shipped →</b></a>'
        : 'showing deaths SINCE granular causes shipped (2026-07-20) — real causes only · <a class="klink" href="/normie-quest-x7/dashboard?window=all">show all-time (with legacy FUD) →</a>')
    + ' · <a class="klink" href="/normie-quest-x7/feedback">all comments</a> · '
    + '<a class="klink" href="/api/nq/telemetry">raw telemetry</a> · <a class="klink" href="/api/nq/feedback">raw feedback</a> · auto-refreshing live</div>'
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
    + (flagged.length ? '<div class="attn"><div class="h">⚠ NEEDS ATTENTION — ' + flagged.length + ' hard level' + (flagged.length === 1 ? '' : 's') + ' (worst deaths-per-clear first)</div><div class="chips">' + attentionChips + '</div></div>' : '')
    + engagementSection
    + journeySection
    + '<div class="cols"><div>'
    + '<h2>🏆 LEADERBOARD — ALL TIME</h2><table><tr><th>#</th><th>NAME</th><th>WORLD</th><th>SCORE</th></tr>' + boardRows(lb && lb.allTime) + '</table>'
    + '</div><div>'
    + '<h2>📅 LEADERBOARD — THIS WEEK</h2><table><tr><th>#</th><th>NAME</th><th>WORLD</th><th>SCORE</th></tr>' + boardRows(lb && lb.weekly) + '</table>'
    + '</div></div>'
    + vipSection
    + perWorldSection
    + '<h2>🎯 TOP KILLERS <span class="dim" style="font-weight:400">(what actually kills players, all levels combined)</span></h2>' + killerRows
    + panelSection
    + '<h2>📊 DIFFICULTY BY LEVEL <span class="dim" style="font-weight:400">(⚠ = ≥6 deaths/clear or ≥8 deaths with no clear · red strip = where testers die)</span></h2>'
    + '<div style="overflow-x:auto"><table><tr><th>LEVEL</th><th>☠</th><th>✓</th><th>☠/✓</th><th>AVG CLEAR</th><th>TOP CAUSE</th><th>DEATH MAP</th><th>LAST</th></tr>'
    + (tableRows || '<tr><td colspan="8" class="dim">No telemetry yet — it records automatically as testers play.</td></tr>') + '</table></div>'
    + '<h2>👛 WALLET CONNECTS BY APP</h2>'
    + (Object.keys(walletUse).length
      ? '<table><tr><th>WALLET</th><th>CONNECTS</th></tr>' + Object.entries(walletUse).sort((a, b) => b[1] - a[1])
          .map(([k, n]) => '<tr><td>' + esc(k) + '</td><td>' + n + '</td></tr>').join('') + '</table>'
      : '<div class="dim">No wallet connects recorded yet (counting started 2026-07-20).</div>')
    + '<h2>💬 LATEST COMMENTS (' + comments.length + ' total)</h2>' + commentCards
    + '</div>'   // .wrap
    // Live auto-refresh: reload every 30s for fresh server-rendered numbers. Pauses on a hidden tab
    // (no background reloads) and via the button. A full reload is the honest "live" here — the page
    // is server-rendered, so a reload IS the fresh data.
    + '<script>(function(){var s=30,on=true,cd=document.getElementById("cd"),btn=document.getElementById("pause");'
    + 'function paint(){if(cd)cd.textContent=(on?s+"s":"paused");}'
    + 'function tick(){if(!on||document.hidden)return;s--;if(s<=0){location.reload();return;}paint();}'
    + 'if(btn)btn.onclick=function(){on=!on;btn.textContent=on?"⏸ pause":"▶ resume";if(on)s=30;paint();};'
    + 'document.addEventListener("visibilitychange",function(){if(!document.hidden&&on){s=30;paint();}});'
    + 'paint();setInterval(tick,1000);})();'
    + '(function(){var k=new URLSearchParams(location.search).get("key")||"";if(!k)return;document.querySelectorAll("a.klink").forEach(function(a){try{var u=new URL(a.getAttribute("href"),location.origin);u.searchParams.set("key",k);a.setAttribute("href",u.pathname+u.search);}catch(e){}});})();'
    + '</script>'
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

// ---- modern world backdrops (worlds 16+) — hand-painted AI art served as PNGs -----
// Drop files at normie-quest/public/worlds/<key>.webp (WebP q82 since 2026-07-27); the Boot preload loads them as
// textures (bgArt on a level def). Missing → clean 404 and the level uses the procedural sky.
router.use('/normie-quest/worlds', express.static(path.join(__dirname, 'public', 'worlds'), {
  maxAge: '7d',
  fallthrough: false,
  setHeaders: (res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); },
}));

module.exports = router;
