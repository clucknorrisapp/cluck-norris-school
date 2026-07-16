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
//   NQ_TIER1_NORMIE  hold >= this NORMIE  -> tier 1 (worlds 3-7)     default 100000
//   NQ_TIER2_NORMIE  hold >= this NORMIE  -> tier 2 (all worlds)     default 500000
//   NQ_CLKN_ACCESS   hold >= this CLKN    -> full access (our-production perk)  default 2000000
//   HELIUS_API_KEY   RPC (else public mainnet)

const crypto = require('crypto');
let _web3 = null, _nacl = null, _bs58 = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function nacl() { return (_nacl = _nacl || require('tweetnacl')); }
function bs58() { return (_bs58 = _bs58 || require('bs58')); }

const CLKN_MINT_DEFAULT = 'DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Ownership is "remembered until the player disconnects / clears storage" (owner's call): the
// session token is effectively non-expiring. Tier is NOT frozen — the client re-reads live balance
// via /refresh every launch, so access always tracks current holdings. Giveaways re-check at draw time.
const SESSION_TTL_MS = 3650 * 24 * 60 * 60 * 1000;   // ~10 years ≈ "until cleared"
const SECRET = process.env.NQ_LB_SECRET || process.env.PREMIUM_ACCESS_KEY || crypto.randomBytes(24).toString('hex');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function cfg() {
  return {
    normieMint: (process.env.NQ_NORMIE_MINT || '').trim(),
    clknMint: (process.env.NQ_CLKN_MINT || CLKN_MINT_DEFAULT).trim(),
    tier1Normie: num(process.env.NQ_TIER1_NORMIE, 100000),
    tier2Normie: num(process.env.NQ_TIER2_NORMIE, 500000),
    clknAccess: num(process.env.NQ_CLKN_ACCESS, 2000000),
  };
}
// Public, secret-free view for the client (what to show on the gate).
function publicConfig() {
  const c = cfg();
  return {
    normieConfigured: !!c.normieMint,
    normieMint: c.normieMint || null,
    clknMint: c.clknMint,
    thresholds: { tier1Normie: c.tier1Normie, tier2Normie: c.tier2Normie, clknAccess: c.clknAccess },
    // world access per tier (worlds are 1-indexed; hidden bonus levels aren't gated here)
    tiers: { 0: [1, 2], 1: [1, 7], 2: 'all' },
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

  const grant = tierForBalances(balances);
  const issuedAt = Date.now();
  const token = sign(pk + '.' + issuedAt) + '.' + issuedAt;   // "<hmac>.<issuedAt>"
  return { ok: true, wallet: pk, tier: grant.tier, worlds: grant.worlds, balances, token };
}

// Re-read live balance for an already-proven wallet (no re-signing) and return the CURRENT tier.
// Called on every game launch so a remembered wallet's access tracks its holdings. The stored
// token is the ownership proof — an invalid/forged one is rejected so nobody can claim a pubkey
// they never proved.
async function refresh(pubkeyStr, token) {
  const pk = String(pubkeyStr || '').trim();
  if (!checkSession(pk, token)) return { ok: false, status: 'bad_session' };
  let balances;
  try { balances = await readBalancesCached(pk); } catch (e) { return { ok: false, status: 'rpc_error' }; }
  const grant = tierForBalances(balances);
  return { ok: true, wallet: pk, tier: grant.tier, worlds: grant.worlds, balances };
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
async function readBalancesCached(owner) {
  const now = Date.now();
  const hit = balCache.get(owner);
  if (hit && (now - hit.at) < BAL_TTL_MS) return hit.balances;
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
function tierForBalances(b) {
  const c = cfg();
  const normie = Number(b && b.normie || 0), clkn = Number(b && b.clkn || 0);
  if (normie >= c.tier2Normie || clkn >= c.clknAccess) return { tier: 2, worlds: 'all' };
  if (normie >= c.tier1Normie) return { tier: 1, worlds: [1, 7] };
  return { tier: 0, worlds: [1, 2] };
}

module.exports = { cfg, publicConfig, challenge, verify, refresh, checkSession, tierForBalances, readBalances, CLKN_MINT_DEFAULT };
