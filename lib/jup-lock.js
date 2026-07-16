// Jupiter Lock — build an unsigned "create vesting escrow" transaction server-side.
//
// Non-custodial: we NEVER hold the user's keys. The server builds the transaction and pre-signs
// only with an EPHEMERAL `base` keypair (used solely to derive the escrow PDA, then discarded) —
// the user's wallet adds the paying signature and sends. The tokens move into a program-owned
// vault on a fixed on-chain schedule; nobody (not us, not Jupiter) can pull them early.
//
// Uses the AUTHORITATIVE on-chain IDL (fetched from the deployed program) so the instruction can
// never drift from what's live. Validated by mainnet SIMULATION before returning, so a doomed tx
// (insufficient balance, wrong mint, etc.) is caught before the user signs.

const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const BN = require('bn.js');

const LOCK_PROGRAM = new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const DAY = 86400, WEEK = 604800, MONTH = 2592000;

function rpcUrl() {
  const k = process.env.HELIUS_API_KEY;
  return k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : 'https://api.mainnet-beta.solana.com';
}
let _conn = null;
function conn() { return (_conn = _conn || new Connection(rpcUrl(), 'confirmed')); }

let _program = null;
async function program() {
  if (_program) return _program;
  const wallet = { publicKey: PublicKey.default, signTransaction: async (t) => t, signAllTransactions: async (t) => t };
  const provider = new anchor.AnchorProvider(conn(), wallet, { commitment: 'confirmed' });
  const idl = await anchor.Program.fetchIdl(LOCK_PROGRAM, provider);
  if (!idl) throw new Error('Jupiter Lock IDL is unavailable right now — try again shortly.');
  if (!idl.address) idl.address = LOCK_PROGRAM.toBase58();
  _program = new anchor.Program(idl, provider);
  return _program;
}

// decimal string (e.g. "10000000" or "1234.5") -> raw base-unit BigInt, no float precision loss.
function toRaw(amountStr, dec) {
  const s = String(amountStr == null ? '' : amountStr).trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Enter a valid amount.');
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(dec)).slice(0, dec);
  const raw = BigInt((i || '0') + frac);
  if (raw <= 0n) throw new Error('Amount must be greater than 0.');
  return raw;
}
function freqOf(interval) { return interval === 'day' ? DAY : interval === 'week' ? WEEK : MONTH; }

// opts: { mint, sender, recipient?, amount, cliffUnix?, cliffPct?, periods, interval, cancelable? }
async function buildCreateLockTx(opts) {
  opts = opts || {};
  const P = await program();
  let mint, sender, recipient;
  try { mint = new PublicKey(opts.mint); } catch (e) { throw new Error('Invalid token mint.'); }
  try { sender = new PublicKey(opts.sender); } catch (e) { throw new Error('Connect a wallet first.'); }
  try { recipient = new PublicKey(opts.recipient || opts.sender); } catch (e) { throw new Error('Invalid recipient wallet.'); }

  const info = await conn().getAccountInfo(mint);
  if (!info) throw new Error('That mint was not found on-chain.');
  const tokenProgram = info.owner;   // legacy SPL or Token-2022 — v2 supports both
  const mintInfo = await spl.getMint(conn(), mint, 'confirmed', tokenProgram);
  const dec = mintInfo.decimals;

  // ── Extension guard — keep the "lock your Solana tokens" promise airtight.
  // Almost every Solana token locks fine (legacy SPL + Token-2022, transfer-FEE tokens included).
  // The two exceptions are baked into a token's own design and would otherwise surface as a
  // cryptic simulation failure — so we detect them up front and say plainly it can't be locked:
  //   • NonTransferable (soulbound) — the token can never leave the wallet, so it can't move to escrow.
  //   • TransferHook — every transfer runs custom on-chain code the escrow can't safely honor.
  if (tokenProgram.equals(spl.TOKEN_2022_PROGRAM_ID)) {
    let exts = [];
    try { exts = spl.getExtensionTypes(mintInfo.tlvData || Buffer.alloc(0)); } catch (_) {}
    const ET = spl.ExtensionType || {};
    if (exts.includes(ET.NonTransferable)) {
      throw new Error('This token is non-transferable (soulbound) — by its own design it can never leave your wallet, so there’s nothing a lock could hold. That’s the token, not the locker.');
    }
    if (exts.includes(ET.TransferHook)) {
      throw new Error('This token uses a transfer-hook — every transfer runs custom on-chain code, which Jupiter Lock’s escrow can’t safely honor. Tokens built this way can’t be locked here.');
    }
  }

  const total = toRaw(opts.amount, dec);
  const periods = Math.max(1, Math.min(1000, parseInt(opts.periods, 10) || 1));
  const cliffPct = Math.max(0, Math.min(100, Number(opts.cliffPct) || 0));
  const cliffBps = BigInt(Math.round(cliffPct * 100));                 // basis points (supports fractional %)
  const cliff0 = total * cliffBps / 10000n;
  const rest = total - cliff0;
  const N = BigInt(periods);
  const per = rest / N;
  const cliff = cliff0 + (rest - per * N);                             // fold rounding remainder into the cliff → exact total

  const now = Math.floor(Date.now() / 1000);
  const cliffTime = Math.max(now, Math.floor(Number(opts.cliffUnix) || now));
  const freq = freqOf(opts.interval);
  // Jupiter Lock modes (u8): 0 = neither creator nor recipient, 1 = OnlyCreator, 2 = OnlyRecipient, 3 = either.
  const cancelMode = opts.cancelable ? 1 : 0;                          // 1 = the creator can cancel; 0 = nobody (strongest lock)
  const updateRecipientMode = opts.recipientChangeable ? 1 : 0;        // 1 = the creator can redirect the recipient; 0 = immutable

  const params = {
    vestingStartTime: new BN(cliffTime), cliffTime: new BN(cliffTime), frequency: new BN(freq),
    cliffUnlockAmount: new BN(cliff.toString()), amountPerPeriod: new BN(per.toString()),
    numberOfPeriod: new BN(N.toString()), updateRecipientMode, cancelMode,
  };

  const base = Keypair.generate();
  const senderToken = spl.getAssociatedTokenAddressSync(mint, sender, false, tokenProgram);
  const builder = P.methods.createVestingEscrowV2(params, null)
    .accounts({ base: base.publicKey, tokenMint: mint, sender, senderToken, recipient, tokenProgram });
  const resolved = await builder.pubkeys();
  const ix = await builder.instruction();
  // The program does NOT init the escrow vault — pre-create the escrow's ATA in the same tx.
  const preIx = spl.createAssociatedTokenAccountIdempotentInstruction(sender, resolved.escrowToken, resolved.escrow, mint, tokenProgram);

  // Optional on-chain name (matches Jupiter's UI): a second instruction that writes an
  // escrow_metadata PDA. Only added when a name is supplied — a nameless lock stays cheaper.
  let nameIx = null;
  const lockName = String(opts.name == null ? '' : opts.name).trim().slice(0, 200);
  if (lockName) {
    const [escrowMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow_metadata'), resolved.escrow.toBuffer()], LOCK_PROGRAM);
    nameIx = await P.methods
      .createVestingEscrowMetadata({ name: lockName, description: '', creatorEmail: '', recipientEmail: '' })
      .accounts({ escrow: resolved.escrow, creator: sender, escrowMetadata, payer: sender, systemProgram: anchor.web3.SystemProgram.programId })
      .instruction();
  }

  const { blockhash, lastValidBlockHeight } = await conn().getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: sender, recentBlockhash: blockhash }).add(preIx).add(ix);
  if (nameIx) tx.add(nameIx);

  // ⚠️ SIGNING ORDER — Phantom's Lighthouse security system (per Phantom Support, 2026-05):
  // a multi-signer tx must have the CONNECTED WALLET sign FIRST, then any additional signers.
  // If the ephemeral `base` signs before the wallet, Phantom flags the tx as "may be malicious".
  // So we DON'T pre-sign here — the client calls provider.signTransaction() (wallet first), then
  // partialSign(base) (ephemeral after), then submits. We hand the client the ephemeral base
  // secret to sign with. That's SAFE: `base` is a throwaway keypair used only to derive the
  // escrow PDA (it never holds funds and has no authority after creation), so exposing it to the
  // same user who's creating the lock creates zero risk.
  const baseSecretB64 = Buffer.from(base.secretKey).toString('base64');

  // Pre-flight simulate so a doomed tx (insufficient balance, wrong mint, …) is caught before the
  // user signs. We simulate a v0 copy with replaceRecentBlockhash so the sim can NEVER fail on a
  // stale/unknown blockhash (that would be an infra hiccup, not a problem with the lock) and
  // sigVerify:false since the fee-payer signature is added on the client. The returned tx stays
  // an UNSIGNED legacy tx — the client refreshes the blockhash right before the wallet signs.
  let simError = null;
  try {
    const simMsg = new TransactionMessage({
      payerKey: sender, recentBlockhash: blockhash,
      instructions: nameIx ? [preIx, ix, nameIx] : [preIx, ix],
    }).compileToV0Message();
    const sim = await conn().simulateTransaction(new VersionedTransaction(simMsg), { replaceRecentBlockhash: true, sigVerify: false, commitment: 'confirmed' });
    if (sim.value.err) {
      const log = (sim.value.logs || []).find((l) => /insufficient|NotInitialized|Error Message:/i.test(l));
      simError = log ? log.replace(/^Program log:\s*/, '') : ('Simulation failed: ' + JSON.stringify(sim.value.err));
      // Translate the common developer-jargon errors into something a user can act on.
      if (/sender_token|AccountNotInitialized|AccountNotFound|find account/i.test(simError)) {
        simError = 'You don’t hold this token in the connected wallet yet — buy a little of it first, then lock.';
      } else if (/lamports/i.test(simError)) {
        // "insufficient lamports" = not enough SOL for the escrow's one-time rent, NOT a token shortfall.
        simError = 'This wallet needs a little more SOL to cover the lock’s one-time escrow rent (~0.02 SOL). Top up some SOL and try again.';
      } else if (/insufficient/i.test(simError)) {
        simError = 'Not enough funds to complete the lock. If you hold plenty of the token, the wallet is most likely low on SOL for the escrow rent (~0.02 SOL) — top up SOL. Otherwise lower the amount.';
      }
    }
  } catch (e) { /* non-fatal: let the client try */ }

  return {
    ok: true,
    txBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),  // UNSIGNED — wallet signs first, client-side
    baseSecret: baseSecretB64,   // ephemeral throwaway signer; client signs it AFTER the wallet
    escrow: resolved.escrow.toBase58(), escrowToken: resolved.escrowToken.toBase58(),
    decimals: dec, tokenProgram: tokenProgram.toBase58(),
    schedule: { totalRaw: total.toString(), cliffRaw: cliff.toString(), perPeriodRaw: per.toString(), periods, freqSec: freq, cliffTime },
    lastValidBlockHeight, simError,
  };
}

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const U64_MAX = new BN('18446744073709551615');

// List every Jupiter Lock escrow where `recipientStr` is the recipient (memcmp on offset 8),
// with a computed claimable estimate. The claim itself is program-enforced (claim_v2 caps to the
// real vested amount), so this estimate is display-only and can never over-claim.
async function listClaimable(recipientStr, mintFilter) {
  const P = await program();
  let recipient;
  try { recipient = new PublicKey(recipientStr); } catch (e) { throw new Error('Connect a wallet first.'); }
  const now = Math.floor(Date.now() / 1000);
  const all = await P.account.vestingEscrow.all([{ memcmp: { offset: 8, bytes: recipient.toBase58() } }]);
  const decCache = new Map();
  const out = [];
  for (const { publicKey, account } of all) {
    const mint = account.tokenMint;
    const mintStr = mint.toBase58();
    if (mintFilter && mintStr !== mintFilter) continue;
    let dec = 0, tokenProgram = null;
    if (decCache.has(mintStr)) { ({ dec, tokenProgram } = decCache.get(mintStr)); }
    else {
      try { const info = await conn().getAccountInfo(mint); tokenProgram = info.owner; const mi = await spl.getMint(conn(), mint, 'confirmed', tokenProgram); dec = mi.decimals; } catch (_) {}
      decCache.set(mintStr, { dec, tokenProgram });
    }
    const cliffTime = Number(account.cliffTime), freq = Number(account.frequency) || 1, n = Number(account.numberOfPeriod);
    const cliffUnlock = BigInt(account.cliffUnlockAmount.toString()), perPeriod = BigInt(account.amountPerPeriod.toString());
    const claimed = BigInt(account.totalClaimedAmount.toString());
    const total = cliffUnlock + perPeriod * BigInt(n);
    let unlocked = 0n;
    if (now >= cliffTime) { const periods = Math.min(n, Math.floor((now - cliffTime) / freq)); unlocked = cliffUnlock + perPeriod * BigInt(periods); }
    const claimable = unlocked > claimed ? unlocked - claimed : 0n;
    const endTime = cliffTime + freq * n;
    out.push({
      escrow: publicKey.toBase58(), mint: mintStr, decimals: dec,
      tokenProgram: tokenProgram ? tokenProgram.toBase58() : null,
      totalRaw: total.toString(), claimedRaw: claimed.toString(), claimableRaw: claimable.toString(),
      cliffTime, frequency: freq, numberOfPeriod: n,
      startsClaimingAt: cliffTime, fullyVestedAt: endTime, fullyVested: now >= endTime,
      cancelMode: Number(account.cancelMode),
    });
  }
  // most claimable first
  out.sort((a, b) => (BigInt(b.claimableRaw) > BigInt(a.claimableRaw) ? 1 : -1));
  return out;
}

// Build an UNSIGNED claim transaction for one escrow. Single signer = the recipient (no ephemeral
// co-signer), so the client just refreshes the blockhash and signs. max_amount = u64::MAX → the
// program releases exactly what's vested-and-unclaimed.
async function buildClaimTx(opts) {
  opts = opts || {};
  const P = await program();
  let recipient, escrow;
  try { recipient = new PublicKey(opts.recipient); } catch (e) { throw new Error('Connect a wallet first.'); }
  try { escrow = new PublicKey(opts.escrow); } catch (e) { throw new Error('Invalid lock.'); }
  const esc = await P.account.vestingEscrow.fetch(escrow);
  if (esc.recipient.toBase58() !== recipient.toBase58()) throw new Error('This lock can only be claimed by its recipient wallet.');
  const mint = esc.tokenMint;
  const info = await conn().getAccountInfo(mint);
  if (!info) throw new Error('That token mint was not found on-chain.');
  const tokenProgram = info.owner;
  const recipientToken = spl.getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram);
  const escrowToken = spl.getAssociatedTokenAddressSync(mint, escrow, true, tokenProgram);
  // ensure the recipient's ATA exists (idempotent) so the claim has somewhere to land
  const preIx = spl.createAssociatedTokenAccountIdempotentInstruction(recipient, recipientToken, recipient, mint, tokenProgram);
  const ix = await P.methods.claimV2(U64_MAX, null)
    .accounts({ escrow, tokenMint: mint, escrowToken, recipient, recipientToken, memoProgram: MEMO_PROGRAM, tokenProgram })
    .instruction();

  const { blockhash, lastValidBlockHeight } = await conn().getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: recipient, recentBlockhash: blockhash }).add(preIx).add(ix);

  let simError = null;
  try {
    const msg = new TransactionMessage({ payerKey: recipient, recentBlockhash: blockhash, instructions: [preIx, ix] }).compileToV0Message();
    const sim = await conn().simulateTransaction(new VersionedTransaction(msg), { replaceRecentBlockhash: true, sigVerify: false, commitment: 'confirmed' });
    if (sim.value.err) {
      const log = (sim.value.logs || []).find((l) => /insufficient|Error Message:|claim|vest/i.test(l));
      simError = log ? log.replace(/^Program log:\s*/, '') : ('Simulation failed: ' + JSON.stringify(sim.value.err));
      if (/lamports/i.test(simError)) simError = 'This wallet needs a little SOL to cover the claim’s network fee. Top up a bit of SOL and try again.';
      else if (/NothingToClaim|nothing to claim|zero|amount is 0|0 token/i.test(simError)) simError = 'Nothing is claimable yet — none of this lock has vested. Check back after the next unlock.';
    }
  } catch (e) { /* non-fatal */ }

  return {
    ok: true,
    txBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    escrow: escrow.toBase58(), mint: mint.toBase58(), decimals: (await spl.getMint(conn(), mint, 'confirmed', tokenProgram)).decimals,
    lastValidBlockHeight, simError,
  };
}

// Recent lock CREATIONS across ALL tokens (for the "recently locked" feed). We scan the lock
// program's recent signatures and keep the ones whose logs show a CreateVestingEscrow instruction,
// reading the deposited amount from the freshly-funded escrow token account (an account that goes
// from 0 → positive in the tx). Returns [{mint, amount, creator, sig, ts}] newest-first.
const LOCK_LOG_CREATE = /Instruction: CreateVestingEscrow(V2|V3)?\b/;
async function recentLocks(limit = 12, scan = 60) {
  const c = conn();
  const sigs = await c.getSignaturesForAddress(LOCK_PROGRAM, { limit: Math.max(limit, Math.min(200, scan)) });
  const out = [];
  const CHUNK = 8;
  for (let i = 0; i < sigs.length && out.length < limit; i += CHUNK) {
    const batch = sigs.slice(i, i + CHUNK);
    const txs = await Promise.all(batch.map((s) =>
      c.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null)));
    for (let j = 0; j < txs.length; j++) {
      if (out.length >= limit) break;
      const tx = txs[j], si = batch[j];
      if (!tx || !tx.meta || tx.meta.err) continue;
      const logs = tx.meta.logMessages || [];
      if (!logs.some((l) => LOCK_LOG_CREATE.test(l))) continue;
      // deposited amount = a token account that went 0 → positive (the fresh escrow vault)
      const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
      const preMap = new Map(pre.map((b) => [b.accountIndex, Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0]));
      let best = null;
      for (const b of post) {
        const before = preMap.has(b.accountIndex) ? preMap.get(b.accountIndex) : 0;
        const after = Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0;
        if (before === 0 && after > 0 && (!best || after > best.amount)) best = { mint: b.mint, amount: after };
      }
      if (!best) continue;
      const keys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
      const creator = keys.length ? (typeof keys[0] === "string" ? keys[0] : keys[0].pubkey) : null;
      out.push({ mint: best.mint, amount: best.amount, creator, sig: si.signature, ts: (tx.blockTime || si.blockTime || 0) * 1000 });
    }
  }
  return out;
}

// Verify ONE signature is a genuine Jupiter Lock creation and extract its details.
// Used to record our-UI locks into the recent feed instantly (and anti-spam: a sig that
// isn't a real lock creation returns null, so no one can inject fake entries).
async function verifyLockSig(sig) {
  const c = conn();
  const tx = await c.getParsedTransaction(String(sig), { maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx || !tx.meta || tx.meta.err) return null;
  const logs = tx.meta.logMessages || [];
  if (!logs.some((l) => LOCK_LOG_CREATE.test(l))) return null;
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const preMap = new Map(pre.map((b) => [b.accountIndex, Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0]));
  let best = null;
  for (const b of post) {
    const before = preMap.has(b.accountIndex) ? preMap.get(b.accountIndex) : 0;
    const after = Number(b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0;
    if (before === 0 && after > 0 && (!best || after > best.amount)) best = { mint: b.mint, amount: after };
  }
  if (!best) return null;
  const keys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  const creator = keys.length ? (typeof keys[0] === "string" ? keys[0] : keys[0].pubkey) : null;
  return { mint: best.mint, amount: best.amount, creator, sig: String(sig), ts: (tx.blockTime || 0) * 1000 };
}

module.exports = { buildCreateLockTx, listClaimable, buildClaimTx, recentLocks, verifyLockSig, LOCK_PROGRAM };
