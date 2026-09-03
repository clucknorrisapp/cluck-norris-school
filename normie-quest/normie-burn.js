// Normie Quest — pay-to-buy backend (the Item Reserve shop). DORMANT by default.
//
// ⚠️ MECHANISM CHANGE (owner ask, 2026-08-02): this WAS a burn shop — tokens destroyed on-chain,
// supply reduced, nobody receives anything. It is now a PAYMENT shop with two rails:
//   · send $NORMIE to the shop wallet (NQ_PAY_DEST) — the owner LOCKS what arrives, on-chain,
//     rather than holding it loose (his call; the lock is the whole defence for collecting
//     another project's token with no agreement in place), or
//   · send SOL to the same wallet — it funds community giveaways.
// The file and route names still say "burn" to avoid churning every reference; the header and
// the client copy tell the truth. Rename later if it grates.
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Everything is env-driven and a NO-OP until `NQ_SHOP` is armed, so shipping this changes
// nothing about the free game until we deliberately "put it together".
//
// It never holds a private key. It only:
//   1. issues a shop SESSION bound to a proven wallet + a chosen item + a payment rail, with a
//      unique on-chain `reference` key and a unique amount,
//   2. BUILDS an unsigned payment transaction for that wallet to sign,
//   3. BROADCASTS the signed bytes — but ONLY if they are byte-for-byte the transaction we
//      built (so this can never be used as a general-purpose relay),
//   4. VERIFIES the payment on-chain by that reference, with a durable replay guard, and hands
//      the item over EXACTLY ONCE per session.
//
// ⚠️ Every NORMIE term in Normie Quest is TESTING-ONLY (nothing is agreed with the NORMIE team),
// which is why the shop is off unless an operator sets NQ_SHOP and why the price is read live
// from here rather than hardcoded anywhere in the client.
//
// Config (all via env):
//   NQ_SHOP          "1"/"true" to ARM the shop                 (default OFF — everything 404s)
//   NQ_PAY_DEST      the shop wallet that RECEIVES payments.    ⚠️ REQUIRED to arm — there is no
//                    default on purpose. The old incinerator default would silently turn "we
//                    lock what you send" back into a burn, i.e. make the new copy a lie the
//                    other way round. No dest, no shop.
//   NQ_NORMIE_MINT   the NORMIE SPL mint address                (default = the known NORMIE mint,
//                    same default nq-wallet.js uses, so arming stays a two-flag job: NQ_SHOP + dest)
//   NQ_NORMIE_PRICE  base whole-token NORMIE price              (default 1000; falls back to the
//                    legacy NQ_BURN_AMOUNT name; per-item multiplier below)
//   NQ_SOL_PRICE     base SOL price (e.g. 0.01). Unset or 0 = the SOL rail is OFF and the shop
//                    is NORMIE-only. Flat SOL amounts on purpose — no price oracle in the game.
//   HELIUS_API_KEY   used for RPC if present, else public mainnet RPC
//   DATA_DIR         where the durable replay-guard file lives (default /data)

const fs = require('fs');
const path = require('path');
// Solana libs are lazy-loaded: this router mounts at server boot for the whole site, so a
// dependency hiccup must only ever break the (dormant) burn endpoints, never the main app.
let _web3 = null, _spl = null;
function web3() { return (_web3 = _web3 || require('@solana/web3.js')); }
function splToken() { return (_spl = _spl || require('@solana/spl-token')); }

// (INCINERATOR removed 2026-08-06 — the shop migrated burn → send-and-lock on 2026-08-02, so the
// incinerator address is no longer referenced by any path; the constant was dead.)
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
  const dest = (process.env.NQ_PAY_DEST || '').trim();
  const solPrice = Number(process.env.NQ_SOL_PRICE || 0);
  return {
    mint,
    dest,
    // Armed ONLY with an explicit destination. No incinerator fallback: the client tells players
    // "we lock what you send", and a misconfigured deploy that quietly burned instead would make
    // that copy false in the opposite direction from the one we just fixed.
    shopEnabled: /^(1|true|yes|on)$/i.test(process.env.NQ_SHOP || '') && !!mint && !!dest,
    amount: Number(process.env.NQ_NORMIE_PRICE || process.env.NQ_BURN_AMOUNT || 1000),
    // SOL rail: flat, env-set price. 0/unset = rail off. Deliberately NOT pegged to the NORMIE
    // price — flat SOL keeps a price oracle out of the game entirely.
    solPrice: Number.isFinite(solPrice) && solPrice > 0 ? solPrice : 0,
  };
}
function priceFor(itemId, pay) {
  const c = cfg();
  const row = CATALOGUE.filter((r) => r.id === itemId)[0];
  if (!row) return null;
  if (pay === 'sol') return c.solPrice > 0 ? Number((c.solPrice * row.mult).toFixed(4)) : null;
  return Math.round(c.amount * row.mult);
}
// Public, secret-free view for the client (decides whether to show the shop at all).
// `dest` ships on purpose: the shop page SHOWS the receiving address so anyone can watch the
// wallet and check the locks. "We lock what we receive" is only worth saying if it's checkable.
function publicConfig() {
  const c = cfg();
  return {
    shopEnabled: c.shopEnabled,
    mint: c.shopEnabled ? c.mint : null,
    dest: c.shopEnabled ? c.dest : null,
    solEnabled: c.shopEnabled && c.solPrice > 0,
    items: c.shopEnabled ? CATALOGUE.map((r) => ({
      id: r.id,
      price: priceFor(r.id, 'normie'),
      priceSol: c.solPrice > 0 ? priceFor(r.id, 'sol') : null,
    })) : [],
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
let _burnStoreBroken = false;   // corrupt existing consumed-file → fail closed (block redemptions), don't start empty
function consumed() {
  if (_consumed) return _consumed;
  _consumed = new Set();
  if (!fs.existsSync(CONSUMED_FILE)) return _consumed;   // genuine first run — empty is correct
  try {
    const raw = JSON.parse(fs.readFileSync(CONSUMED_FILE, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('not a JSON array');
    raw.forEach(s => _consumed.add(s));
  } catch (e) {
    // Corrupt existing file — do NOT silently start empty (that re-opens replay of historical
    // burns). Quarantine a copy and fail closed until an operator restores it.
    _burnStoreBroken = true;
    try { fs.copyFileSync(CONSUMED_FILE, `${CONSUMED_FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[normie-burn] CONSUMED FILE CORRUPT (${e.message}) — replay guard fail-closed until restored`);
  }
  return _consumed;
}
function consume(sig) {
  const set = consumed();
  if (_burnStoreBroken) return false;     // corrupt store → refuse all redemptions (fail closed)
  if (set.has(sig)) return false;         // already used — replay blocked
  set.add(sig);
  try {
    fs.mkdirSync(path.dirname(CONSUMED_FILE), { recursive: true });
    require("../lib/atomic-write").atomicWriteFileSync(CONSUMED_FILE, JSON.stringify([...set]));
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
    require("../lib/atomic-write").atomicWriteFileSync(SESSIONS_FILE, JSON.stringify([...sessionMap().values()]));
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
// A shop session is bound to ONE proven wallet, ONE item and ONE payment rail. All three are
// decided here, server-side: the client can pick, but it can never talk us into granting
// something it did not pay for, nor into paying a NORMIE price in SOL.
function newSession(opts) {
  const c = cfg();
  if (!c.shopEnabled) return { error: 'not_configured' };
  const item = String((opts && opts.item) || '');
  const wallet = String((opts && opts.wallet) || '');
  const pay = String((opts && opts.pay) || 'normie');
  if (pay !== 'normie' && pay !== 'sol') return { error: 'bad_pay' };
  if (pay === 'sol' && !(c.solPrice > 0)) return { error: 'sol_off' };
  const price = priceFor(item, pay);
  if (price == null) return { error: 'bad_item' };
  if (!wallet) return { error: 'no_wallet' };
  sweep();
  const ref = web3().Keypair.generate().publicKey.toBase58();   // unique per session; anchors on-chain matching
  const id = unique() + unique();
  let s;
  if (pay === 'sol') {
    // Unique LAMPORT suffix (1000-9999 lamports ≈ well under a cent) — same idea as the token
    // suffix: even without the reference key, the exact amount identifies the session.
    const lamports = Math.round(price * 1e9) + Math.floor(Math.random() * 9000 + 1000);
    s = { id, reference: ref, pay, lamports, amount: lamports / 1e9, item, wallet, dest: c.dest,
      createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, verified: false, granted: false };
  } else {
    // unique amount suffix so even a plain send is unambiguous (e.g. 1000.0731)
    const amount = Number((price + Math.floor(Math.random() * 9000 + 1000) / 1e6).toFixed(6));
    s = { id, reference: ref, pay, amount, item, wallet, mint: c.mint, dest: c.dest,
      createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, verified: false, granted: false };
  }
  sessions.set(id, s);
  return { id, reference: ref, pay, amount: s.amount, item, price, mint: s.mint || null,
    dest: c.dest, expiresAt: s.expiresAt };
}

// ---- build an unsigned payment tx for the player to sign ----------------
// payer MUST be the wallet the session was issued to. Returns base64 of an unsigned tx that
// SENDS the session's amount to the shop wallet — NORMIE via transferChecked, or SOL via
// SystemProgram.transfer — tagged with the session `reference` key so verify() can find it.
// The player signs it; sendSigned broadcasts it.
//
// SystemProgram.transfer is fine HERE: the CLAUDE.md prohibition is about the BROWSER, where
// web3.js's u64 encoding needs a Buffer global that doesn't exist. This runs in Node, which is
// exactly where that construction belongs.
async function buildBurnTx(sessionId, payerStr) {
  const s = sessions.get(sessionId);
  if (!s) return { error: 'no_session' };
  if (s.expiresAt < Date.now()) return { error: 'expired' };
  if (s.wallet && String(payerStr) !== s.wallet) return { error: 'wrong_wallet' };
  const W3 = web3(), SPL = splToken();
  let payer, dest, reference;
  try { payer = new W3.PublicKey(payerStr); dest = new W3.PublicKey(s.dest); reference = new W3.PublicKey(s.reference); }
  catch (e) { return { error: 'bad_pubkey' }; }

  const { blockhash } = await conn().getLatestBlockhash();
  const tx = new W3.Transaction({ feePayer: payer, recentBlockhash: blockhash });

  if (s.pay === 'sol') {
    const ix = W3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: s.lamports });
    // Solana-Pay convention: the reference rides as a read-only non-signer key so the tx is
    // discoverable via getSignaturesForAddress(reference) without a memo.
    ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
    tx.add(ix);
    s.exactAmount = s.lamports / 1e9;
  } else {
    let mint;
    try { mint = new W3.PublicKey(s.mint); } catch (e) { return { error: 'bad_pubkey' }; }
    // ⚠️ NORMIE IS A TOKEN-2022 MINT (owner TokenzQdB…, verified on-chain 2026-08-02 — the
    // "pump.fun mints are legacy" assumption is FALSE for this one). Resolve the token program
    // from the mint account's owner, jup-lock.js-style, and thread it through EVERYTHING below:
    // getMint, both ATA derivations, the idempotent create, and the transfer. The old burn code
    // used legacy defaults throughout, which meant getMint threw TokenInvalidAccountOwnerError
    // on the shop's own token — every real purchase would have died at build time.
    const acct = await conn().getAccountInfo(mint);
    if (!acct) return { error: 'bad_pubkey' };
    const tokenProgram = acct.owner;
    const mintInfo = await SPL.getMint(conn(), mint, 'confirmed', tokenProgram);
    // Refuse extension sets that break the shop's math or atomicity. A TransferFee mint delivers
    // LESS than the player sent, so verify() would never match and every purchase would hang at
    // "pending" after payment — the worst outcome on a money path. NORMIE today carries only
    // MetadataPointer + TokenMetadata (checked), but NQ_NORMIE_MINT is an env var and can point
    // anywhere; guard at build time, before anyone signs.
    if (tokenProgram.equals(SPL.TOKEN_2022_PROGRAM_ID)) {
      let exts = [];
      try { exts = SPL.getExtensionTypes(mintInfo.tlvData); } catch (e) {}
      const banned = [SPL.ExtensionType.TransferHook, SPL.ExtensionType.NonTransferable,
        SPL.ExtensionType.TransferFeeConfig];
      if (exts.some((x) => banned.indexOf(x) !== -1)) return { error: 'unsupported_mint' };
    }
    const rawAmount = BigInt(Math.round(s.amount * 10 ** mintInfo.decimals));
    // What the chain will ACTUALLY move after the mint's decimals round our unique suffix.
    // verify() compares against this, not the pre-rounding figure — on a mint with fewer than 6
    // decimals the suffix rounds away and a payment at the advertised price would never verify.
    s.exactAmount = Number(rawAmount) / 10 ** mintInfo.decimals;
    const srcAta = SPL.getAssociatedTokenAddressSync(mint, payer, false, tokenProgram);
    const dstAta = SPL.getAssociatedTokenAddressSync(mint, dest, false, tokenProgram);
    // The shop wallet may never have held NORMIE yet — create its ATA idempotently, rent paid by
    // the payer (~0.002 SOL, once ever). Without this the very first purchase in the shop's life
    // fails with an error no player could act on.
    tx.add(SPL.createAssociatedTokenAccountIdempotentInstruction(payer, dstAta, dest, mint, tokenProgram));
    const ix = SPL.createTransferCheckedInstruction(srcAta, mint, dstAta, payer, rawAmount, mintInfo.decimals, [], tokenProgram);
    ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
    tx.add(ix);
  }

  // Remember the exact message we built. sendSigned refuses anything whose message differs by a
  // single byte, which is what stops this endpoint being a relay for arbitrary transactions.
  s.msgB64 = tx.serializeMessage().toString('base64');
  touchSession();
  return { tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    amount: s.amount, pay: s.pay, mint: s.mint || null, dest: s.dest };
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

// ---- verify a payment happened for this session --------------------------
// Finds the tx via the session reference, confirms the right asset moved to the shop wallet in
// the right amount, is finalized, and hasn't been consumed. Idempotent: a second call on a
// verified session reports the same success without re-consuming anything.
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
    const tx = await conn().getParsedTransaction(si.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 1 });
    if (!tx || !tx.meta) continue;
    // Rail-matched: a NORMIE session verifies NORMIE landing at the shop wallet, a SOL session
    // verifies lamports. This is a PAYMENT shop (2026-08-02, see file header) — only tokens that
    // actually arrived at the shop wallet count. burnedAmount() used to also credit ANY balance
    // decrease on the mint (originally to still honor a hand-crafted burn), but the reference key
    // is handed to the client by design (Solana-Pay convention), so a self-transfer tagged with
    // the session reference summed to a "burn" with nothing paid — a free item. Require the real
    // transfer instead.
    let got = 0;
    if (s.pay === 'sol') {
      got = solToDest(tx, s.dest);
    } else {
      got = transferredToDest(tx, s.mint, s.dest);
    }
    if (got + 1e-9 < want) continue;                  // not enough for this session
    // Namespaced like server.js's "sol:" prefix (and for the same recorded incident): without
    // it, one on-chain signature could in principle be redeemed once per rail.
    if (!consume((s.pay || 'normie') + ':' + si.signature)) return { ok: false, status: 'replay' };
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
// SOL (in whole SOL) that landed in `dest` in this tx — post minus pre on the destination's own
// system account. Fees never touch the destination, so a simple positive delta is the payment.
function solToDest(tx, destStr) {
  try {
    const keys = tx.transaction.message.accountKeys || [];
    const i = keys.findIndex((k) => String(k.pubkey || k) === destStr);
    if (i < 0) return 0;
    const delta = Number(tx.meta.postBalances[i] || 0) - Number(tx.meta.preBalances[i] || 0);
    return delta > 0 ? delta / 1e9 : 0;
  } catch (e) { return 0; }
}

// amount of `mint` that landed in `dest` (the shop wallet's ATA)
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
  claimOnce, unclaim, CATALOGUE, NORMIE_MINT_DEFAULT,
  // exported for tests only:
  transferredToDest, burnedAmount };
