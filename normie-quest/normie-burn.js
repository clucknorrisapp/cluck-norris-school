// Normie Quest — burn-to-play backend (Phase 1, DORMANT by default).
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Everything is env-driven and a NO-OP until configured, so shipping this changes nothing
// about the free game until we deliberately "put it together".
//
// It never holds a private key. It only:
//   1. issues a play SESSION with a unique on-chain `reference` key + a unique amount,
//   2. BUILDS an unsigned burn transaction for the player's own wallet to sign,
//   3. VERIFIES a burn on-chain by that reference, with a durable replay guard.
//
// Config (all via env; unset mint => dormant):
//   NQ_NORMIE_MINT   the NORMIE SPL mint address        (required to arm)
//   NQ_BURN_AMOUNT   whole-token amount to burn          (default 1000)
//   NQ_BURN_GATE     "1"/"true" to enforce the gate      (default off)
//   NQ_BURN_DEST     incinerator address for the plain-send fallback
//                    (default the canonical burn address; supply is not reduced by a send)
//   HELIUS_API_KEY   used for RPC if present, else public mainnet RPC
//   DATA_DIR         where the durable replay-guard file lives (default ./data)

const fs = require('fs');
const path = require('path');
// Solana libs are lazy-loaded: this router mounts at server boot for the whole site, so a
// dependency hiccup must only ever break the (dormant) burn endpoints, never the main app.
let _web3 = null, _spl = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function splToken() { return (_spl = _spl || require('@solana/spl-token')); }

const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
const SESSION_TTL_MS = 15 * 60 * 1000;   // a play session's burn window
const CONSUMED_FILE = path.join(process.env.DATA_DIR || '/data', 'nq-consumed.json');

// ---- config -------------------------------------------------------------
function cfg() {
  const mint = (process.env.NQ_NORMIE_MINT || '').trim();
  return {
    mint,
    configured: !!mint,
    gateEnabled: /^(1|true|yes|on)$/i.test(process.env.NQ_BURN_GATE || ''),
    amount: Number(process.env.NQ_BURN_AMOUNT || 1000),
    dest: (process.env.NQ_BURN_DEST || INCINERATOR).trim(),
  };
}
// Public, secret-free view for the client (decides whether to show the gate).
function publicConfig() {
  const c = cfg();
  return { gateEnabled: c.gateEnabled && c.configured, configured: c.configured, amount: c.amount };
}

function rpcUrl() {
  const k = process.env.HELIUS_API_KEY;
  return k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : 'https://api.mainnet-beta.solana.com';
}
let _conn = null;
function conn() { return (_conn = _conn || new (web3().Connection)(rpcUrl(), 'confirmed')); }

// ---- durable replay guard (consumed burn signatures) --------------------
let _consumed = null;
function consumed() {
  if (_consumed) return _consumed;
  _consumed = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(CONSUMED_FILE, 'utf8'));
    if (Array.isArray(raw)) raw.forEach(s => _consumed.add(s));
  } catch (e) { /* first run: no file yet */ }
  return _consumed;
}
function consume(sig) {
  const set = consumed();
  if (set.has(sig)) return false;         // already used — replay blocked
  set.add(sig);
  try {
    fs.mkdirSync(path.dirname(CONSUMED_FILE), { recursive: true });
    fs.writeFileSync(CONSUMED_FILE, JSON.stringify([...set]));
  } catch (e) {
    // Persist failed → fail closed, but ALSO roll back the in-memory add: leaving the sig in
    // the set made every retry of a legitimate burn read as "replay" until process restart.
    set.delete(sig);
    return false;
  }
  return true;
}

// ---- sessions (in-memory; a restart just means re-issue) -----------------
const sessions = new Map();
function unique() { return Math.random().toString(36).slice(2, 10); }   // non-crypto id is fine; the reference key is the real anchor
function newSession() {
  const c = cfg();
  if (!c.configured) return { error: 'not_configured' };
  const ref = web3().Keypair.generate().publicKey.toBase58();   // unique per session; anchors on-chain matching
  // unique amount suffix so even a plain send is unambiguous (e.g. 1000.0731)
  const amount = Number((c.amount + Math.floor(Math.random() * 9000 + 1000) / 1e6).toFixed(6));
  const id = unique();
  const s = { id, reference: ref, amount, mint: c.mint, dest: c.dest, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, verified: false };
  sessions.set(id, s);
  // opportunistic sweep of expired sessions
  for (const [k, v] of sessions) if (v.expiresAt < Date.now() && !v.verified) sessions.delete(k);
  return { id, reference: ref, amount, mint: c.mint, dest: c.dest, expiresAt: s.expiresAt };
}

// ---- build an unsigned burn tx for the player to sign -------------------
// payer = the player's own wallet pubkey. Returns base64 of an unsigned tx that BURNS
// `amount` NORMIE from the payer's ATA (true supply reduction) and tags the tx with the
// session `reference` key so verify() can find it. The player signs & sends it.
async function buildBurnTx(sessionId, payerStr) {
  const s = sessions.get(sessionId);
  if (!s) return { error: 'no_session' };
  if (s.expiresAt < Date.now()) return { error: 'expired' };
  const W3 = web3(), SPL = splToken();
  let payer, mint, reference;
  try { payer = new W3.PublicKey(payerStr); mint = new W3.PublicKey(s.mint); reference = new W3.PublicKey(s.reference); }
  catch (e) { return { error: 'bad_pubkey' }; }

  const mintInfo = await SPL.getMint(conn(), mint);
  const rawAmount = BigInt(Math.round(s.amount * 10 ** mintInfo.decimals));
  const ata = SPL.getAssociatedTokenAddressSync(mint, payer);
  const ix = SPL.createBurnCheckedInstruction(ata, mint, payer, rawAmount, mintInfo.decimals);
  // Solana-Pay convention: attach the reference as a read-only non-signer key so the tx is
  // discoverable via getSignaturesForAddress(reference) without a memo.
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });

  const { blockhash } = await conn().getLatestBlockhash();
  const tx = new W3.Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(ix);
  return { tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), amount: s.amount, mint: s.mint };
}

// ---- verify a burn happened for this session ----------------------------
// Finds the tx via the session reference, confirms it burned the right mint & amount,
// is finalized, and hasn't been consumed. On success returns a one-time unlock token.
async function verifyBurn(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, status: 'no_session' };
  if (s.verified && s.unlockToken) return { ok: true, unlockToken: s.unlockToken };   // idempotent
  let reference, mint;
  try { const W3 = web3(); reference = new W3.PublicKey(s.reference); mint = new W3.PublicKey(s.mint); } catch (e) { return { ok: false, status: 'bad_session' }; }

  const sigs = await conn().getSignaturesForAddress(reference, { limit: 10 }, 'finalized');
  if (!sigs.length) return { ok: false, status: 'pending' };

  for (const si of sigs) {
    if (si.err) continue;
    const tx = await conn().getParsedTransaction(si.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;
    const burned = burnedAmount(tx, s.mint);          // true burn (supply drop) …
    const sent = transferredToDest(tx, s.mint, s.dest); // … or plain send to the incinerator
    const got = Math.max(burned, sent);
    if (got + 1e-9 < s.amount) continue;              // not enough for this session
    if (!consume(si.signature)) return { ok: false, status: 'replay' };   // durable dedupe
    s.verified = true;
    s.unlockToken = 'nq_' + unique() + unique();
    return { ok: true, unlockToken: s.unlockToken, signature: si.signature };
  }
  return { ok: false, status: 'pending' };
}

// sum of `mint` removed from supply in this tx (pre balance - post balance for burns)
function burnedAmount(tx, mintStr) {
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  let drop = 0;
  for (const p of pre) {
    if (p.mint !== mintStr) continue;
    const q = post.find(x => x.accountIndex === p.accountIndex);
    const preAmt = Number(p.uiTokenAmount.uiAmount || 0);
    const postAmt = q ? Number(q.uiTokenAmount.uiAmount || 0) : 0;
    if (preAmt > postAmt) drop += preAmt - postAmt;
  }
  return drop;
}
// amount of `mint` that landed in `dest` (the incinerator-send fallback)
function transferredToDest(tx, mintStr, destStr) {
  const post = tx.meta.postTokenBalances || [], pre = tx.meta.preTokenBalances || [];
  let gain = 0;
  for (const q of post) {
    if (q.mint !== mintStr || q.owner !== destStr) continue;
    const p = pre.find(x => x.accountIndex === q.accountIndex);
    const postAmt = Number(q.uiTokenAmount.uiAmount || 0);
    const preAmt = p ? Number(p.uiTokenAmount.uiAmount || 0) : 0;
    if (postAmt > preAmt) gain += postAmt - preAmt;
  }
  return gain;
}

module.exports = { cfg, publicConfig, newSession, buildBurnTx, verifyBurn, INCINERATOR };
