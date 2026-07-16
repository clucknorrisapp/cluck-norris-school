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

module.exports = { buildCreateLockTx, LOCK_PROGRAM };
