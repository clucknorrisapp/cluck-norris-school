// AHOY: PumpFunPirates — game router.
//
// A self-contained section, like normie-quest/: the game is static files under pirates/public,
// served at /ahoy-quest/ (unlisted, noindex), plus a small read-only holder API:
//   GET  /api/ahoy/config     tiers with LIVE AHOY prices (USD amounts are config; AHOY amounts
//                             are computed from the price at request time, never hardcoded)
//   POST /api/ahoy/challenge  { wallet } → a one-line message with a single-use nonce
//   POST /api/ahoy/verify     { wallet, nonce, signature } → checks the ed25519 signature, then
//                             reads AHOY and Pump Fun Pirates NFTs ON-CHAIN, returns the tier plus
//                             a wallet-bound session token (24h) when a session secret is set
//   POST /api/ahoy/session    { wallet, token } → a returning player's re-check: the token proves
//                             an earlier signature for THIS wallet, the holdings are re-read live
// Nothing here moves funds, asks for a transaction, or writes to the chain. A price outage is
// "unavailable" (retry later), never a zero balance — and that includes a price that is too old:
// the last-good price is only reused for PRICE_MAX_AGE_MS, then the answer is "unavailable".
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const nacl = require("tweetnacl");
const bs58 = require("bs58");

const AHOY_MINT = "39eBixffUCh2GqF8sEE9fZ1rqoeP2HxNsstN5X5ppump";
const NFT_COLLECTION = "8k6YzoW4FzMDXqKKBsF52fLvKa95c3U8YnchaZXEewoE";
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUBLIC_DIR = path.join(__dirname, "public");
const VENDOR_DIR = path.join(__dirname, "..", "public", "vendor");
// How long a last-good AHOY price may be reused when both price sources are failing. Past this the
// gate answers "unavailable" instead of computing eligibility from a stale number.
const PRICE_MAX_AGE_MS = 30 * 60_000;
// A session token (and so a client's cached grant) lives one day; after that the wallet signs again.
const SESSION_TTL_MS = 24 * 3600_000;

function tiers() {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  return [
    { id: "deckhand", label: "Deckhand", holdUsd: num(process.env.AHOY_DECKHAND_USD, 5), seas: ["reef", "glacier"] },
    { id: "captain", label: "Captain", holdUsd: num(process.env.AHOY_CAPTAIN_USD, 25), seas: ["reef", "glacier", "deep", "uptober"] },
    { id: "nft", label: "Crew (NFT holder)", holdUsd: null, seas: ["reef", "glacier", "deep", "uptober", "cove"] },
  ];
}

// Pure tier decision (tested in pirates/test/ahoy-gate-test.cjs).
function decideTier({ nftCount, ahoy, priceUsd, tiers: T }) {
  if (nftCount > 0) return { tier: "nft", unavailable: false };
  if (!(priceUsd > 0)) return { tier: "free", unavailable: ahoy > 0 };
  const usd = ahoy * priceUsd;
  const cap = T.find((t) => t.id === "captain"), deck = T.find((t) => t.id === "deckhand");
  if (cap && usd >= cap.holdUsd) return { tier: "captain", unavailable: false };
  if (deck && usd >= deck.holdUsd) return { tier: "deckhand", unavailable: false };
  return { tier: "free", unavailable: false };
}

function challengeMessage(wallet, nonce, issuedIso) {
  return `AHOY: PumpFunPirates — sign in to check your holdings\nWallet: ${wallet}\nNonce: ${nonce}\nIssued: ${issuedIso}\nThis is not a transaction. It costs nothing and moves nothing.`;
}

// Wallet-bound session token: proves a wallet signed in recently. It carries NO tier — the tier is
// always re-read from the chain — so a token can't be edited into a bigger grant.
function issueSession(secret, wallet, now) {
  if (!secret || !wallet) return null;
  const body = Buffer.from(JSON.stringify({ t: "ahoy", w: wallet, exp: now + SESSION_TTL_MS })).toString("base64url");
  return body + "." + crypto.createHmac("sha256", secret).update("ahoy." + body).digest("base64url");
}
function verifySession(secret, token, wallet, now) {
  if (!secret || !token) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", secret).update("ahoy." + body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_) { return null; }
  if (!p || p.t !== "ahoy" || p.w !== wallet || !(p.exp > now)) return null;
  return p;
}

// Options: getUsdPrice (primary price source), jupPrice (secondary; defaults to Jupiter lite),
// rpcUrl, sessionSecret (HMAC key for session tokens; unset → no tokens, every check needs a
// signature), now (clock, for tests).
function makeRouter({ getUsdPrice, jupPrice, rpcUrl, sessionSecret, now: nowFn } = {}) {
  const router = express.Router();
  const clock = typeof nowFn === "function" ? nowFn : Date.now;
  const secret = sessionSecret || process.env.AHOY_SESSION_SECRET || null;
  const nonces = new Map(); // nonce → { wallet, message, exp }
  const hits = new Map();   // ip → { n, t }
  const limited = (req, max) => {
    const ip = String(req.headers["cf-connecting-ip"] || req.ip || "x"), now = Date.now();
    const h = hits.get(ip) || { n: 0, t: now };
    if (now - h.t > 60_000) { h.n = 0; h.t = now; }
    h.n++; hits.set(ip, h);
    if (hits.size > 20000) hits.clear();
    return h.n > max;
  };
  const rpcEndpoint = () => rpcUrl || (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : "https://api.mainnet-beta.solana.com");
  async function rpc(method, params) {
    const r = await fetch(rpcEndpoint(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  }
  let priceCache = { usd: null, at: 0 };
  async function price() {
    if (priceCache.usd && clock() - priceCache.at < 60_000) return priceCache.usd;
    let usd = null;
    try { usd = getUsdPrice ? await getUsdPrice(AHOY_MINT) : null; } catch (_) {}
    if (!(usd > 0)) {
      try {
        const p = jupPrice ? Number(await jupPrice(AHOY_MINT)) : await (async () => {
          const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${AHOY_MINT}`, { signal: AbortSignal.timeout(8000) });
          const j = await r.json(); return j && j[AHOY_MINT] && Number(j[AHOY_MINT].usdPrice);
        })();
        if (p > 0) usd = p;
      } catch (_) {}
    }
    if (usd > 0) { priceCache = { usd, at: clock() }; return usd; }
    // Both sources failed: the last-good price is reusable only while it is young. An old price
    // would quietly decide who qualifies long after the market moved — answer unavailable instead.
    return priceCache.usd && clock() - priceCache.at < PRICE_MAX_AGE_MS ? priceCache.usd : null;
  }

  // Shared by /verify and /session: read the chain, decide the tier.
  async function holdings(wallet) {
    let ahoy = 0, nfts = [];
    try {
      const accts = await rpc("getTokenAccountsByOwner", [wallet, { mint: AHOY_MINT }, { encoding: "jsonParsed" }]);
      for (const a of (accts && accts.value) || []) ahoy += Number(a.account.data.parsed.info.tokenAmount.uiAmountString || 0);
    } catch (e) { return { chainDown: true }; }
    try {
      const r = await rpc("searchAssets", { ownerAddress: wallet, grouping: ["collection", NFT_COLLECTION], page: 1, limit: 100 });
      nfts = ((r && r.items) || []).filter((i) => !i.burnt).map((i) => ({
        id: i.id,
        name: (i.content && i.content.metadata && i.content.metadata.name) || "Pump Fun Pirate",
        image: (i.content && i.content.files && i.content.files[0] && (i.content.files[0].cdn_uri || i.content.files[0].uri)) || (i.content && i.content.links && i.content.links.image) || null,
        traits: Object.fromEntries(((i.content && i.content.metadata && i.content.metadata.attributes) || []).map((a) => [String(a.trait_type), String(a.value)])),
      }));
    } catch (_) { /* DAS down: AHOY tiers still work; NFT perks just don't show this time */ }
    const p = await price().catch(() => null);
    const d = decideTier({ nftCount: nfts.length, ahoy, priceUsd: p, tiers: tiers() });
    return { wallet, tier: d.tier, unavailable: d.unavailable, ahoy, usd: p ? ahoy * p : null, priceUsd: p || null, nfts: nfts.slice(0, 24) };
  }
  const CHAIN_DOWN = { ok: false, error: "Couldn't read the chain right now — try again shortly.", unavailable: true };

  // ── The game itself ──
  const noindex = (res) => res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // Exact-path regexes: Express's non-strict routing would treat "/ahoy-quest" and "/ahoy-quest/"
  // as the same route, and the redirect would loop.
  router.get(/^\/ahoy-quest$/, (req, res, next) => (req.originalUrl.split("?")[0].endsWith("/") ? next() : res.redirect(301, "/ahoy-quest/")));
  router.get(/^\/ahoy-quest\/?$/, (req, res) => { noindex(res); res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(PUBLIC_DIR, "index.html")); });
  router.use("/ahoy-quest/vendor", express.static(VENDOR_DIR, { maxAge: "7d", fallthrough: false }));
  router.use("/ahoy-quest", (req, res, next) => { noindex(res); next(); }, express.static(PUBLIC_DIR, { maxAge: "1h", index: false, fallthrough: false }));

  // ── Holder API ──
  router.get("/api/ahoy/config", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const p = await price().catch(() => null);
    const T = tiers().map((t) => ({ ...t, holdAhoy: t.holdUsd != null && p ? t.holdUsd / p : null }));
    res.json({ ok: true, mint: AHOY_MINT, nftCollection: NFT_COLLECTION, priceUsd: p || null, tiers: T });
  });

  router.post("/api/ahoy/challenge", express.json({ limit: "2kb" }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (limited(req, 30)) return res.status(429).json({ ok: false, error: "Slow down, matey — try again in a minute." });
    const wallet = String((req.body && req.body.wallet) || "");
    if (!SOL_ADDR_RE.test(wallet)) return res.status(400).json({ ok: false, error: "That isn't a Solana address." });
    const nonce = crypto.randomBytes(16).toString("hex");
    const message = challengeMessage(wallet, nonce, new Date().toISOString());
    if (nonces.size > 10000) { const now = Date.now(); for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k); if (nonces.size > 10000) nonces.clear(); }
    nonces.set(nonce, { wallet, message, exp: Date.now() + 5 * 60_000 });
    res.json({ ok: true, nonce, message });
  });

  router.post("/api/ahoy/verify", express.json({ limit: "4kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (limited(req, 30)) return res.status(429).json({ ok: false, error: "Slow down, matey — try again in a minute." });
    const { wallet, nonce, signature } = req.body || {};
    const entry = nonces.get(String(nonce || ""));
    nonces.delete(String(nonce || "")); // single use, whatever happens next
    if (!entry || entry.exp < Date.now() || entry.wallet !== wallet) return res.status(400).json({ ok: false, error: "That sign-in expired — try again." });
    let ok = false;
    try { ok = nacl.sign.detached.verify(new TextEncoder().encode(entry.message), bs58.decode(String(signature || "")), bs58.decode(wallet)); } catch (_) { ok = false; }
    if (!ok) return res.status(401).json({ ok: false, error: "Signature didn't match that wallet." });
    const h = await holdings(wallet);
    if (h.chainDown) return res.status(503).json(CHAIN_DOWN);
    const token = issueSession(secret, wallet, clock());
    res.json({ ok: true, ...h, token, expiresAt: token ? clock() + SESSION_TTL_MS : null });
  });

  // A returning player: the token proves an earlier signature for this wallet; the holdings are
  // re-read live every time, so nothing the client cached can grant a tier by itself.
  router.post("/api/ahoy/session", express.json({ limit: "4kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (limited(req, 60)) return res.status(429).json({ ok: false, error: "Slow down, matey — try again in a minute." });
    const { wallet, token } = req.body || {};
    if (!SOL_ADDR_RE.test(String(wallet || "")) || !verifySession(secret, token, wallet, clock())) return res.status(401).json({ ok: false, error: "That sign-in expired — connect your wallet again.", expired: true });
    const h = await holdings(wallet);
    if (h.chainDown) return res.status(503).json(CHAIN_DOWN);
    res.json({ ok: true, ...h });
  });

  return router;
}

module.exports = makeRouter;
module.exports.decideTier = decideTier;
module.exports.challengeMessage = challengeMessage;
module.exports.tiers = tiers;
module.exports.PRICE_MAX_AGE_MS = PRICE_MAX_AGE_MS;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;
module.exports.AHOY_MINT = AHOY_MINT;
module.exports.NFT_COLLECTION = NFT_COLLECTION;
