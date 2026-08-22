// Normie Quest — wallet ownership + tier gate (Phase 2).
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// "Safe wallet connect without permission": the player signs a one-time message with their
// wallet (NO transaction, NO approval to move funds, zero cost). We verify the ed25519
// signature to PROVE they control the pubkey, then read their on-chain NORMIE / CLKN balance
// to grant an access tier. A short-lived HMAC session token is returned; the score route
// verifies it so a leaderboard entry can be marked walletVerified WITHOUT trusting the client.
//
// Nothing here holds a private key or moves funds. It only reads the chain + checks a signature.
//
// Config (env; sensible defaults so it works the moment a NORMIE mint exists):
//   NQ_NORMIE_MINT   the NORMIE SPL mint (shared with the burn module; unset => NORMIE gate off)
//   NQ_CLKN_MINT     CLKN mint (default = the known public CLKN mint)
//   NQ_TIER1_USD     hold this many $ of NORMIE -> tier 1 (worlds 1-12)   default 5   (owner, 2026-08-22)
//   NQ_TIER2_USD     hold this many $ of NORMIE -> tier 2 (all worlds)    default 50  (set either to 0 → token-count mode)
//   NQ_TIER1_NORMIE  token-count fallback for tier 1 when USD pricing is off/down   default 10000
//   NQ_TIER2_NORMIE  token-count fallback for tier 2                                default 50000
//   NQ_CLKN_ACCESS   hold >= this CLKN    -> full access (our-production perk)  default 2000000
//   NQ_VIP_NORMIE    hold >= this NORMIE  -> ULTRA VIP wing (worlds 13+)  default 2000000  ⚠ TESTING
//   NQ_VIP_CLKN      hold >= this CLKN    -> ULTRA VIP wing               default 10000000 ⚠ TESTING
//   (VIP also grants via the manual allowlist /data/nq-vip.json — the owner adds wallets that
//    qualified through big buys / locks / burns / SOL payments until those checks are automated.
//    ALL VIP terms are TESTING-ONLY and owner-to-confirm; never promise them publicly.)
//   HELIUS_API_KEY   RPC (else public mainnet)

const crypto = require('crypto');
const gate = require('./nq-gate');   // launch cap + free tier (owner-flippable, no redeploy)
let _web3 = null, _nacl = null, _bs58 = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function nacl() { return (_nacl = _nacl || require('tweetnacl')); }
function bs58() { return (_bs58 = _bs58 || require('bs58')); }

const CLKN_MINT_DEFAULT = 'DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS';
const NORMIE_MINT_DEFAULT = 'FrSFwE2BxWADEyUWFXDMAeomzuB4r83ZvzdG9sevpump';   // Normie (PumpSwap); NQ_NORMIE_MINT env overrides
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Ownership is "remembered until the player disconnects / clears storage" (owner's call): the
// session token is effectively non-expiring. Tier is NOT frozen — the client re-reads live balance
// via /refresh every launch, so access always tracks current holdings. Giveaways re-check at draw time.
const SESSION_TTL_MS = 3650 * 24 * 60 * 60 * 1000;   // ~10 years ≈ "until cleared"
// Key separation (audit #32): never sign session tokens with the master PREMIUM_ACCESS_KEY itself —
// derive a per-purpose secret (distinct label from nq-leaderboard's 'nq-lb-v1', so the two token
// families can never be swapped for each other). Deploy note: the first deploy of this derivation
// invalidates existing wallet sessions once — checkSession fails gracefully and the client's normal
// re-connect/re-sign flow issues a fresh session.
const SECRET = process.env.NQ_LB_SECRET
  || (process.env.PREMIUM_ACCESS_KEY
      && crypto.createHmac('sha256', process.env.PREMIUM_ACCESS_KEY).update('nq-wallet-v1').digest('hex'))
  || crypto.randomBytes(24).toString('hex');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function cfg() {
  return {
    normieMint: (process.env.NQ_NORMIE_MINT || NORMIE_MINT_DEFAULT).trim(),
    clknMint: (process.env.NQ_CLKN_MINT || CLKN_MINT_DEFAULT).trim(),
    tier1Normie: num(process.env.NQ_TIER1_NORMIE, 10000),
    tier2Normie: num(process.env.NQ_TIER2_NORMIE, 50000),
    // USD-priced tiers (owner, 2026-08-22): hold $5 of NORMIE → worlds 4-12, $50 → everything.
    // Token amounts are DERIVED from the live price on every read (repo rule: computed live,
    // never hardcoded). Set either to 0 to fall back to the token-count thresholds above.
    tier1Usd: num(process.env.NQ_TIER1_USD, 5),
    tier2Usd: num(process.env.NQ_TIER2_USD, 50),
    clknAccess: num(process.env.NQ_CLKN_ACCESS, 2000000),
    vipNormie: num(process.env.NQ_VIP_NORMIE, 0),   // 0 = balance path OFF (owner call: VIP is
    vipClkn: num(process.env.NQ_VIP_CLKN, 0),       // allowlist-only until terms are locked)
  };
}
// ---- live NORMIE price → USD-priced tiers (owner, 2026-08-22) --------------------------------
// Same posture as the CLKN tool gate: 60s in-memory cache, last-known-good persisted to /data so
// a redeploy doesn't boot blind, a 10x sanity band against a RECENT good price so one thin-pool
// tick can't repin the paywall, and every failure path LOGS (the silent-catch version of this
// pattern hid a two-week outage once). Two independent sources: GeckoTerminal, then DexScreener's
// deepest-liquidity pair. If no price has EVER been seen, thresholds fall back to the token-count
// envs (the pre-USD numbers, chosen for similar dollar values) — a defined, conservative behavior
// that neither gives the game away nor locks holders out because our price feed hiccuped.
const fsv = require('fs'), pathv = require('path');
const PRICE_TTL_MS = 60_000;
function pricePath() { return pathv.join(process.env.DATA_DIR || '/data', 'nq-normie-price.json'); }
let _price = { usd: 0, at: 0, fetching: null };
try { const p0 = JSON.parse(fsv.readFileSync(pricePath(), 'utf8')); if (Number(p0.usd) > 0) _price = { usd: Number(p0.usd), at: Number(p0.at) || 0, fetching: null }; } catch (e) {}

async function fetchNormiePriceOnce(mint) {
  try {
    const r = await fetch('https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/' + mint, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const v = Number(j && j.data && j.data.attributes && j.data.attributes.token_prices && j.data.attributes.token_prices[mint]);
    if (v > 0) return v;
  } catch (e) { console.warn('[nq-wallet] GeckoTerminal price fetch failed:', e.message); }
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const pairs = Array.isArray(j && j.pairs) ? j.pairs.slice() : [];
    pairs.sort((a, b) => Number(b && b.liquidity && b.liquidity.usd || 0) - Number(a && a.liquidity && a.liquidity.usd || 0));
    const v = Number(pairs[0] && pairs[0].priceUsd);
    if (v > 0) return v;
  } catch (e) { console.warn('[nq-wallet] DexScreener price fetch failed:', e.message); }
  return 0;
}

function refreshPrice() {   // single-flight; resolves to the best price we have (never rejects)
  if (_price.fetching) return _price.fetching;
  const now = Date.now();
  if (_price.usd && now - _price.at < PRICE_TTL_MS) return Promise.resolve(_price.usd);
  _price.fetching = (async () => {
    try {
      const fresh = await fetchNormiePriceOnce(cfg().normieMint);
      if (!fresh) { console.warn('[nq-wallet] NORMIE price refresh: no usable price from either source'); return _price.usd; }
      if (_price.usd && now - _price.at < 6 * 3600e3 && (fresh > _price.usd * 10 || fresh < _price.usd / 10)) {
        console.warn('[nq-wallet] rejected implausible NORMIE price ' + fresh + ' (last good ' + _price.usd + ')');
        return _price.usd;
      }
      _price.usd = fresh; _price.at = now;
      try { require('../lib/atomic-write').atomicWriteFileSync(pricePath(), JSON.stringify({ usd: fresh, at: now })); } catch (e) {}
      return fresh;
    } finally { _price.fetching = null; }
  })();
  return _price.fetching;
}
function normiePriceUsd() { return _price.usd || 0; }

// The numbers the gate actually compares against. USD mode needs both USD knobs > 0 AND a price;
// otherwise the token-count envs stand. Math.max(1, …) so a moon-shot price can never make a
// tier free by rounding to zero tokens.
function thresholds() {
  const c = cfg(), p = normiePriceUsd();
  if (c.tier1Usd > 0 && c.tier2Usd > 0 && p > 0) {
    return { tier1Normie: Math.max(1, Math.ceil(c.tier1Usd / p)), tier2Normie: Math.max(1, Math.ceil(c.tier2Usd / p)), priceUsd: p, usdPriced: true };
  }
  return { tier1Normie: c.tier1Normie, tier2Normie: c.tier2Normie, priceUsd: p || null, usdPriced: false };
}

// Manual ULTRA VIP allowlist — owner-managed grants for qualification paths that aren't
// automated yet (big buys, token locks, burns, SOL payments). Simple JSON array of pubkeys.
function vipListPath() { return pathv.join(process.env.DATA_DIR || '/data', 'nq-vip.json'); }
function vipList() { try { const a = JSON.parse(fsv.readFileSync(vipListPath(), 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function vipListWrite(a) { require("../lib/atomic-write").atomicWriteFileSync(vipListPath(), JSON.stringify(a)); }
function isVip(owner, balances) {
  const c = cfg(), b = balances || {};
  if (c.vipNormie > 0 && Number(b.normie || 0) >= c.vipNormie) return true;
  if (c.vipClkn > 0 && Number(b.clkn || 0) >= c.vipClkn) return true;
  return vipList().indexOf(String(owner)) !== -1;
}
// Public, secret-free view for the client (what to show on the gate).
function publicConfig() {
  const c = cfg(), t = thresholds();
  refreshPrice();   // fire-and-forget: this route is polled by every client boot, so it keeps the price warm
  return {
    normieConfigured: !!c.normieMint,
    normieMint: c.normieMint || null,
    clknMint: c.clknMint,
    thresholds: { tier1Normie: t.tier1Normie, tier2Normie: t.tier2Normie, clknAccess: c.clknAccess },
    // The public terms (owner, 2026-08-22): hold tier1Usd of NORMIE → worlds 4-12, tier2Usd →
    // everything. normieNeeded amounts are live-derived from priceUsd; null price = token-count
    // fallback in force (usdPriced:false), and the client should show amounts, not dollars.
    terms: { tier1Usd: c.tier1Usd, tier2Usd: c.tier2Usd, priceUsd: t.priceUsd, usdPriced: t.usdPriced,
             tier1Normie: t.tier1Normie, tier2Normie: t.tier2Normie },
    // world access per tier (worlds are 1-indexed; hidden bonus levels aren't gated here).
    // Tier 0 tracks the gate's freeMax, and every band is clamped by the launch cap, so the
    // front door can never advertise a band the gate won't actually hand out.
    tiers: { 0: gate.freeWorlds(), 1: gate.clamp([1, 12]), 2: gate.clamp('all') },
    // The gate itself: {on, freeMax, cap}. Structure only — terms travel in `terms` above.
    gate: gate.publicState(),
  };
}

function rpcUrl() {
  const k = process.env.HELIUS_API_KEY;
  return k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : 'https://api.mainnet-beta.solana.com';
}
let _conn = null;
function conn() { return (_conn = _conn || new (web3().Connection)(rpcUrl(), 'confirmed')); }

// ---- HMAC helpers -------------------------------------------------------
function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// ---- challenge / verify -------------------------------------------------
const challenges = new Map();   // pubkey -> { nonce, message, expiresAt }
function pruneChallenges() { const now = Date.now(); for (const [k, v] of challenges) if (v.expiresAt < now) challenges.delete(k); }

function isPubkey(s) { try { new (web3().PublicKey)(s); return true; } catch (e) { return false; } }

// Issue a one-time message for the wallet to sign. Human-readable so the wallet popup is clear.
function challenge(pubkeyStr) {
  const pk = String(pubkeyStr || '').trim();
  if (!isPubkey(pk)) return { ok: false, status: 'bad_pubkey' };
  pruneChallenges();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Normie Quest — prove wallet ownership to unlock worlds.\n\nWallet: ${pk}\nNonce: ${nonce}\n\nThis is a signature only — it does NOT move any funds or approve any transaction.`;
  challenges.set(pk, { nonce, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { ok: true, message, nonce, expiresIn: CHALLENGE_TTL_MS };
}

// Verify the signed message, then read balances and grant a tier + a session token.
// signature = base58 (what wallet.signMessage returns, base58-encoded by the client).
async function verify(pubkeyStr, signatureB58) {
  const pk = String(pubkeyStr || '').trim();
  const ch = challenges.get(pk);
  if (!ch) return { ok: false, status: 'no_challenge' };
  if (ch.expiresAt < Date.now()) { challenges.delete(pk); return { ok: false, status: 'expired' }; }
  let ok = false;
  try {
    const msgBytes = new TextEncoder().encode(ch.message);
    const sigBytes = bs58().decode(String(signatureB58 || ''));
    const pubBytes = new (web3().PublicKey)(pk).toBytes();
    ok = nacl().sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch (e) { return { ok: false, status: 'bad_signature' }; }
  if (!ok) return { ok: false, status: 'bad_signature' };
  challenges.delete(pk);   // one-time

  let balances;
  try { balances = await readBalancesCached(pk); }
  catch (e) { return { ok: false, status: 'rpc_error' }; }

  try { await refreshPrice(); } catch (e) {}   // settle the live price so the grant math isn't stale on a cold boot
  const grant = tierForBalances(balances);
  const issuedAt = Date.now();
  const token = sign(pk + '.' + issuedAt) + '.' + issuedAt;   // "<hmac>.<issuedAt>"
  return { ok: true, wallet: pk, tier: grant.tier, worlds: grant.worlds, balances, vip: isVip(pk, balances), token };
}

// Re-read live balance for an already-proven wallet (no re-signing) and return the CURRENT tier.
// Called on every game launch so a remembered wallet's access tracks its holdings. The stored
// token is the ownership proof — an invalid/forged one is rejected so nobody can claim a pubkey
// they never proved.
async function refresh(pubkeyStr, token, opts) {
  const pk = String(pubkeyStr || '').trim();
  if (!checkSession(pk, token)) return { ok: false, status: 'bad_session' };
  let balances;
  try { balances = await readBalancesCached(pk, opts && opts.force); } catch (e) { return { ok: false, status: 'rpc_error' }; }
  try { await refreshPrice(); } catch (e) {}
  const grant = tierForBalances(balances);
  return { ok: true, wallet: pk, tier: grant.tier, worlds: grant.worlds, balances, vip: isVip(pk, balances) };
}

// Verify a session token belongs to this wallet and is unexpired (used by the score route).
function checkSession(pubkeyStr, token) {
  const pk = String(pubkeyStr || '').trim();
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !isPubkey(pk)) return false;
  const [mac, issuedAt] = parts;
  if (!safeEq(mac, sign(pk + '.' + issuedAt))) return false;
  const age = Date.now() - Number(issuedAt);
  return age >= 0 && age <= SESSION_TTL_MS;
}

// ---- balances + tier ----------------------------------------------------
// Balance cache: refresh-on-every-launch would otherwise hit Helius RPC once per player per open.
// A short per-wallet cache collapses those to one read per wallet per window, so RPC load stays flat
// as players scale. Tier still updates within a cache window (default 5 min). kv-free, in-memory.
const BAL_TTL_MS = Number(process.env.NQ_BALANCE_CACHE_SEC || 300) * 1000;
const balCache = new Map();   // pubkey -> { balances, at }
async function readBalancesCached(owner, force) {
  const now = Date.now();
  const hit = balCache.get(owner);
  if (!force && hit && (now - hit.at) < BAL_TTL_MS) return hit.balances;   // force = bypass cache (e.g. right after a buy)
  const balances = await readBalances(owner);
  balCache.set(owner, { balances, at: now });
  if (balCache.size > 5000) { for (const [k, v] of balCache) if (now - v.at > BAL_TTL_MS) balCache.delete(k); }   // prune stale
  return balances;
}

async function mintBalance(owner, mintStr) {
  if (!mintStr) return 0;
  const W3 = web3();
  const res = await conn().getParsedTokenAccountsByOwner(new W3.PublicKey(owner), { mint: new W3.PublicKey(mintStr) });
  let sum = 0;
  for (const a of res.value) {
    const amt = a.account.data.parsed.info.tokenAmount;
    sum += Number(amt.uiAmount || 0);
  }
  return sum;
}
async function readBalances(owner) {
  const c = cfg();
  const [normie, clkn] = await Promise.all([
    c.normieMint ? mintBalance(owner, c.normieMint) : Promise.resolve(0),
    mintBalance(owner, c.clknMint),
  ]);
  return { normie, clkn };
}
// Tier from holdings, THEN clamped by the access gate. The tier a wallet earns never changes
// here — the gate only decides how much of it is currently open (launch cap), so lifting the cap
// with /api/nq/gate?cap=0 instantly widens every holder's access with no re-sign and no redeploy.
function tierForBalances(b) {
  const c = cfg(), t = thresholds();
  const normie = Number(b && b.normie || 0), clkn = Number(b && b.clkn || 0);
  if (normie >= t.tier2Normie || clkn >= c.clknAccess) return { tier: 2, worlds: gate.clamp('all') };
  if (normie >= t.tier1Normie) return { tier: 1, worlds: gate.clamp([1, 12]) };   // owner's structure (2026-08-22): free 1-3 · $5 NORMIE → 4-12 · $50 → 13-21
  return { tier: 0, worlds: gate.freeWorlds() };
}

module.exports = { cfg, publicConfig, challenge, verify, refresh, checkSession, tierForBalances, thresholds, refreshPrice, normiePriceUsd, readBalances, isVip, vipList, vipListWrite, gate, CLKN_MINT_DEFAULT };
