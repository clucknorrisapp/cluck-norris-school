// AHOY: PumpFunPirates — game router.
//
// A self-contained section, like normie-quest/: the game is static files under pirates/public,
// served at /ahoy-quest/ (unlisted, noindex), plus a small read-only holder API:
//   GET  /api/ahoy/config     tiers with LIVE AHOY prices (USD amounts are config; AHOY amounts
//                             are computed from the price at request time, never hardcoded)
//   POST /api/ahoy/challenge  { wallet } → a one-line message with a single-use nonce
//   POST /api/ahoy/verify     { wallet, nonce, signature } → checks the ed25519 signature, then
//                             reads AHOY and Pump Fun Pirates NFTs ON-CHAIN, returns the tier
// Nothing here moves funds, asks for a transaction, or writes to the chain. A price outage is
// "unavailable" (retry later), never a zero balance.
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

function makeRouter({ getUsdPrice, rpcUrl } = {}) {
  const router = express.Router();
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
    if (priceCache.usd && Date.now() - priceCache.at < 60_000) return priceCache.usd;
    let usd = null;
    try { usd = getUsdPrice ? await getUsdPrice(AHOY_MINT) : null; } catch (_) {}
    if (!(usd > 0)) {
      try { const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${AHOY_MINT}`, { signal: AbortSignal.timeout(8000) }); const j = await r.json(); const p = j && j[AHOY_MINT] && Number(j[AHOY_MINT].usdPrice); if (p > 0) usd = p; } catch (_) {}
    }
    if (usd > 0) priceCache = { usd, at: Date.now() };
    return usd > 0 ? usd : (priceCache.usd || null);
  }

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
    let ahoy = 0, nfts = [];
    try {
      const accts = await rpc("getTokenAccountsByOwner", [wallet, { mint: AHOY_MINT }, { encoding: "jsonParsed" }]);
      for (const a of (accts && accts.value) || []) ahoy += Number(a.account.data.parsed.info.tokenAmount.uiAmountString || 0);
    } catch (e) { return res.status(503).json({ ok: false, error: "Couldn't read the chain right now — try again shortly.", unavailable: true }); }
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
    res.json({ ok: true, wallet, tier: d.tier, unavailable: d.unavailable, ahoy, usd: p ? ahoy * p : null, priceUsd: p || null, nfts: nfts.slice(0, 24) });
  });

  return router;
}

module.exports = makeRouter;
module.exports.decideTier = decideTier;
module.exports.challengeMessage = challengeMessage;
module.exports.tiers = tiers;
module.exports.AHOY_MINT = AHOY_MINT;
module.exports.NFT_COLLECTION = NFT_COLLECTION;
