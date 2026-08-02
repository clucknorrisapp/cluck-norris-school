// Normie Quest — burn-to-buy backend (the Item Reserve shop). DORMANT by default.
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Everything is env-driven and a NO-OP until `NQ_SHOP` is armed, so shipping this changes
// nothing about the free game until we deliberately "put it together".
//
// It never holds a private key. It only:
//   1. issues a shop SESSION bound to a proven wallet + a chosen item, with a unique on-chain
//      `reference` key and a unique amount,
//   2. BUILDS an unsigned burn transaction for that wallet to sign,
//   3. BROADCASTS the signed bytes — but ONLY if they are byte-for-byte the transaction we
//      built (so this can never be used as a general-purpose relay),
//   4. VERIFIES the burn on-chain by that reference, with a durable replay guard, and hands the
//      item over EXACTLY ONCE per session.
//
// ⚠️ Every NORMIE term in Normie Quest is TESTING-ONLY (nothing is agreed with the NORMIE team),
// which is why the shop is off unless an operator sets NQ_SHOP and why the price is read live
// from here rather than hardcoded anywhere in the client.
//
// Config (all via env):
//   NQ_SHOP          "1"/"true" to ARM the burn shop            (default OFF — everything 404s)
//   NQ_NORMIE_MINT   the NORMIE SPL mint address                (default = the known NORMIE mint,
//                    same default nq-wallet.js uses, so arming is one flag not two)
//   NQ_BURN_AMOUNT   base whole-token burn price                (default 1000; per-item multiplier below)
//   NQ_BURN_DEST     incinerator address for the plain-send fallback
//                    (default the canonical burn address; supply is not reduced by a send)
//   HELIUS_API_KEY   used for RPC if present, else public mainnet RPC
//   DATA_DIR         where the durable replay-guard file lives (default /data)

const fs = require('fs');
const path = require('path');
// Solana libs are lazy-loaded: this router mounts at server boot for the whole site, so a
// dependency hiccup must only ever break the (dormant) burn endpoints, never the main app.
let _web3 = null, _spl = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function splToken() { return (_spl = _spl || require('@solana/spl-token')); }

const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
// Same default as nq-wallet.js NORMIE_MINT_DEFAULT — keep the two in step. Both are the public
// mint address, not a secret.
const NORMIE_MINT_DEFAULT = 'FrSFwE2BxWADEyUWFXDMAeomzuB4r83ZvzdG9sevpump';
const SESSION_TTL_MS = 15 * 60 * 1000;   // a shop session's burn window
const MAX_SESSIONS = 500;                // hard bound: /shop/session is public, memory is not
const CONSUMED_FILE = path.join(process.env.DATA_DIR || '/data', 'nq-consumed.json');

// ---- the shop catalogue --------------------------------------------------
// ⚠️ These ids MUST exist in nq-rewards.js ITEMS *and* in RESERVE_ITEMS in the game — an id the
// game does not know is burned for, granted, delivered, and then silently dropped by the client's
// unknown-id filter. routes.js validates every id here against nq-rewards before issuing a
// session, so a drift fails loudly at request time instead of eating someone's tokens.
// `mult` prices each item off NQ_BURN_AMOUNT: the two strong items cost 2x, the two premium
// boosts 3x. Prices live here and nowhere else; the client reads them from /api/nq/config.
const CATALOGUE = [
  { id: 'disc', mult: 1 },
  { id: 'vial', mult: 2 },
  { id: 'shield', mult: 2 },
  { id: 'star', mult: 3 },
  { id: 'bomb', mult: 3 },
];

// ---- config -------------------------------------------------------------
function cfg() {
  const mint = (process.env.NQ_NORMIE_MINT || NORMIE_MINT_DEFAULT).trim();
  return {
    mint,
    // The shop is the ONLY consumer of this module and it is OFF unless explicitly armed.
    // Everything downstream checks this, so an unarmed deploy cannot burn anyone's tokens.
    shopEnabled: /^(1|true|yes|on)$/i.test(process.env.NQ_SHOP || '') && !!mint,
    amount: Number(process.env.NQ_BURN_AMOUNT || 1000),
    dest: (process.env.NQ_BURN_DEST || INCINERATOR).trim(),
  };
}
function priceFor(itemId) {
  const c = cfg();
  const row = CATALOGUE.filter((r) => r.id === itemId)[0];
  if (!row) return null;
  return Math.round(c.amount * row.mult);
}
// Public, secret-free view for the client (decides whether to show the shop at all).
function publicConfig() {
  const c = cfg();
  return {
    shopEnabled: c.shopEnabled,
    mint: c.shopEnabled ? c.mint : null,
    // Prices only ship when the shop is armed — an unarmed build must not advertise a price for
    // something it cannot sell.
    items: c.shopEnabled ? CATALOGUE.map((r) => ({ id: r.id, price: priceFor(r.id) })) : [],
  };
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

// ---- sessions (DURABLE) --------------------------------------------------
// These were in-memory only, on the reasoning that "a restart just means re-issue". That holds
// right up until the player has actually burned. After that the session is the ONLY record of
// what they paid for, and losing it means tokens destroyed on-chain, irreversibly, for nothing —
// the same outcome `unclaim()` below exists to prevent. It stopped being hypothetical when main
// started auto-deploying: every push to main restarts the process, and the burn->claim window is
// a live player polling for a few seconds. So sessions persist next to the replay guard.
//
// Retention is deliberately asymmetric: an UNVERIFIED session is disposable (nothing has been
// signed, re-issue costs the player nothing), but a VERIFIED, ungranted one is a debt we owe and
// survives its TTL until it is either granted or ages out at VERIFIED_KEEP_MS.
const SESSIONS_FILE = path.join(process.env.DATA_DIR || '/data', 'nq-shop-sessions.json');
const VERIFIED_KEEP_MS = 30 * 24 * 3600 * 1000;
let _sessions = null;
function sessionMap() {
  if (_sessions) return _sessions;
  _sessions = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    if (Array.isArray(raw)) {
      for (const s of raw) {
        if (!s || !s.id) continue;
        // Drop what was disposable anyway; keep every unpaid debt.
        if (!s.verified && s.expiresAt < now) continue;
        if (s.verified && s.granted && (now - (s.createdAt || 0)) > VERIFIED_KEEP_MS) continue;
        _sessions.set(s.id, s);
      }
    }
  } catch (e) { /* first run: no file yet */ }
  return _sessions;
}
// Best-effort. A failed write must NOT fail the caller: the burn either happened on-chain or it
// did not, and refusing to serve a player because a disk write blipped would be the wrong trade.
// It is logged loudly because a persistently unwritable volume silently reintroduces the exact
// bug this block fixes.
function persistSessions() {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessionMap().values()]));
  } catch (e) {
    console.error('[nq-shop] could not persist sessions —', e.message,
      '— a restart now would strand a paid burn');
  }
}
const sessions = {
  get: (k) => sessionMap().get(k),
  set: (k, v) => { sessionMap().set(k, v); persistSessions(); return sessions; },
  delete: (k) => { const r = sessionMap().delete(k); persistSessions(); return r; },
  get size() { return sessionMap().size; },
  entries: () => sessionMap().entries(),
  values: () => sessionMap().values(),
  [Symbol.iterator]: () => sessionMap()[Symbol.iterator](),
};
// Call after mutating a session object in place (verified / granted flags).
function touchSession() { persistSessions(); }
function unique() { return Math.random().toString(36).slice(2, 10); }   // non-crypto id is fine; the reference key is the real anchor
function sweep() {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) if (v.expiresAt < now && !v.verified) sessions.delete(k);
  // Still over the bound (a burst inside one TTL window): drop the oldest unverified ones. A
  // dropped session costs the player nothing — they have not signed anything yet.
  if (sessions.size > MAX_SESSIONS) {
    const old = [...sessions.entries()].filter(([, v]) => !v.verified).sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < old.length && sessions.size > MAX_SESSIONS; i++) sessions.delete(old[i][0]);
  }
}
// A shop session is bound to ONE proven wallet and ONE item. Both are decided here, server-side:
// the client can pick, but it can never talk us into granting something it did not pay for.
function newSession(opts) {
  const c = cfg();
  if (!c.shopEnabled) return { error: 'not_configured' };
  const item = String((opts && opts.item) || '');
  const wallet = String((opts && opts.wallet) || '');
  const price = priceFor(item);
  if (price == null) return { error: 'bad_item' };
  if (!wallet) return { error: 'no_wallet' };
  sweep();
  const ref = web3().Keypair.generate().publicKey.toBase58();   // unique per session; anchors on-chain matching
  // unique amount suffix so even a plain send is unambiguous (e.g. 1000.0731)
  const amount = Number((price + Math.floor(Math.random() * 9000 + 1000) / 1e6).toFixed(6));
  const id = unique() + unique();
  const s = { id, reference: ref, amount, item, wallet, mint: c.mint, dest: c.dest,
    createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, verified: false, granted: false };
  sessions.set(id, s);
  return { id, reference: ref, amount, item, price, mint: c.mint, dest: c.dest, expiresAt: s.expiresAt };
}

// ---- build an unsigned burn tx for the player to sign -------------------
// payer MUST be the wallet the session was issued to. Returns base64 of an unsigned tx that
// BURNS `amount` NORMIE from the payer's ATA (true supply reduction) and tags the tx with the
// session `reference` key so verify() can find it. The player signs it; sendSigned broadcasts it.
async function buildBurnTx(sessionId, payerStr) {
  const s = sessions.get(sessionId);
  if (!s) return { error: 'no_session' };
  if (s.expiresAt < Date.now()) return { error: 'expired' };
  if (s.wallet && String(payerStr) !== s.wallet) return { error: 'wrong_wallet' };
  const W3 = web3(), SPL = splToken();
  let payer, mint, reference;
  try { payer = new W3.PublicKey(payerStr); mint = new W3.PublicKey(s.mint); reference = new W3.PublicKey(s.reference); }
  catch (e) { return { error: 'bad_pubkey' }; }

  const mintInfo = await SPL.getMint(conn(), mint);
  const rawAmount = BigInt(Math.round(s.amount * 10 ** mintInfo.decimals));
  // What the chain will ACTUALLY move after the mint's decimals round our unique suffix. verify()
  // compares against this, not the pre-rounding figure — on a mint with fewer than 6 decimals the
  // suffix rounds away and a burn for the advertised price would otherwise never verify.
  s.exactAmount = Number(rawAmount) / 10 ** mintInfo.decimals;
  const ata = SPL.getAssociatedTokenAddressSync(mint, payer);
  const ix = SPL.createBurnCheckedInstruction(ata, mint, payer, rawAmount, mintInfo.decimals);
  // Solana-Pay convention: attach the reference as a read-only non-signer key so the tx is
  // discoverable via getSignaturesForAddress(reference) without a memo.
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });

  const { blockhash } = await conn().getLatestBlockhash();
  const tx = new W3.Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(ix);
  // Remember the exact message we built. sendSigned refuses anything whose message differs by a
  // single byte, which is what stops this endpoint being a relay for arbitrary transactions.
  s.msgB64 = tx.serializeMessage().toString('base64');
  return { tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), amount: s.amount, mint: s.mint };
}

// ---- broadcast the wallet-signed transaction ----------------------------
// The player's wallet is the ONLY signer, so there is no partial-sign ordering problem here (see
// the Phantom multi-signer rule in CLAUDE.md — it does not apply to a single-signer tx). We
// broadcast server-side rather than letting the page do it so the client needs no RPC endpoint,
// and so we can refuse anything that is not the transaction we handed out.
async function sendSigned(sessionId, signedB64) {
  const s = sessions.get(sessionId);
  if (!s) return { error: 'no_session' };
  if (!s.msgB64) return { error: 'no_tx' };
  if (s.expiresAt < Date.now()) return { error: 'expired' };
  const W3 = web3();
  let tx, raw;
  try {
    raw = Buffer.from(String(signedB64 || ''), 'base64');
    if (!raw.length || raw.length > 2000) return { error: 'bad_tx' };
    tx = W3.Transaction.from(raw);
  } catch (e) { return { error: 'bad_tx' }; }
  // byte-for-byte identity with what we built — not "looks similar"
  let msg;
  try { msg = tx.serializeMessage().toString('base64'); } catch (e) { return { error: 'bad_tx' }; }
  if (msg !== s.msgB64) return { error: 'tx_mismatch' };
  try { tx.serialize(); } catch (e) { return { error: 'unsigned' }; }   // throws unless every required signature is present & valid
  let signature;
  try {
    signature = await conn().sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  } catch (e) {
    // Surface the class of failure, never the raw RPC text (it can echo back attacker input).
    const m = String((e && e.message) || '');
    return { error: /insufficient|0x1\b/i.test(m) ? 'insufficient_funds' : 'send_failed' };
  }
  s.sentSig = signature;
  return { signature };
}

// ---- verify a burn happened for this session ----------------------------
// Finds the tx via the session reference, confirms it burned the right mint & amount, is
// finalized, and hasn't been consumed. Idempotent: a second call on a verified session reports
// the same success without re-consuming anything.
async function verifyBurn(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, status: 'no_session' };
  if (s.verified) return { ok: true, item: s.item, wallet: s.wallet, signature: s.signature };
  let reference;
  try { reference = new (web3().PublicKey)(s.reference); } catch (e) { return { ok: false, status: 'bad_session' }; }
  const want = (s.exactAmount != null ? s.exactAmount : s.amount);

  const sigs = await conn().getSignaturesForAddress(reference, { limit: 10 }, 'finalized');
  if (!sigs.length) return { ok: false, status: 'pending' };

  for (const si of sigs) {
    if (si.err) continue;
    const tx = await conn().getParsedTransaction(si.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;
    const burned = burnedAmount(tx, s.mint);          // true burn (supply drop) …
    const sent = transferredToDest(tx, s.mint, s.dest); // … or plain send to the incinerator
    const got = Math.max(burned, sent);
    if (got + 1e-9 < want) continue;                  // not enough for this session
    if (!consume(si.signature)) return { ok: false, status: 'replay' };   // durable dedupe
    s.verified = true;
    s.signature = si.signature;
    touchSession();   // the debt is now real — it must survive a restart
    return { ok: true, item: s.item, wallet: s.wallet, signature: si.signature };
  }
  return { ok: false, status: 'pending' };
}

// Hand the paid-for item over EXACTLY ONCE. verifyBurn is deliberately idempotent so a player can
// poll it; this is the latch that stops a repeated poll queueing a second item off one burn.
function claimOnce(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || !s.verified) return null;
  if (s.granted) return null;
  s.granted = true;
  touchSession();   // persist BEFORE the caller hands the item over, so a crash mid-grant
                    // cannot replay into a second item off one burn
  return { item: s.item, wallet: s.wallet, signature: s.signature };
}
// Release the latch when the hand-over FAILED downstream (a full reward queue, a disk write that
// did not stick). Without this the player has burned tokens, the latch is set, and every retry
// reports "already claimed" — the worst possible outcome on a money path.
function unclaim(sessionId) {
  const s = sessions.get(sessionId);
  if (s) { s.granted = false; touchSession(); }
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

module.exports = { cfg, publicConfig, priceFor, newSession, buildBurnTx, sendSigned, verifyBurn,
  claimOnce, unclaim, CATALOGUE, INCINERATOR, NORMIE_MINT_DEFAULT };
