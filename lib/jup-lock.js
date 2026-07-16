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
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
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
  const cancelMode = opts.cancelable ? 1 : 0;                          // 0 = not cancellable (strongest lock)

  const params = {
    vestingStartTime: new BN(cliffTime), cliffTime: new BN(cliffTime), frequency: new BN(freq),
    cliffUnlockAmount: new BN(cliff.toString()), amountPerPeriod: new BN(per.toString()),
    numberOfPeriod: new BN(N.toString()), updateRecipientMode: 0, cancelMode,   // 0 recipient mode = immutable recipient
  };

  const base = Keypair.generate();
  const senderToken = spl.getAssociatedTokenAddressSync(mint, sender, false, tokenProgram);
  const builder = P.methods.createVestingEscrowV2(params, null)
    .accounts({ base: base.publicKey, tokenMint: mint, sender, senderToken, recipient, tokenProgram });
  const resolved = await builder.pubkeys();
  const ix = await builder.instruction();
  // The program does NOT init the escrow vault — pre-create the escrow's ATA in the same tx.
  const preIx = spl.createAssociatedTokenAccountIdempotentInstruction(sender, resolved.escrowToken, resolved.escrow, mint, tokenProgram);

  const { blockhash, lastValidBlockHeight } = await conn().getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: sender, recentBlockhash: blockhash }).add(preIx).add(ix);
  tx.partialSign(base);   // ephemeral base signs; user's wallet adds the fee-payer signature client-side

  // Pre-flight simulate so a doomed tx is caught before the user signs (sigVerify=false: the
  // fee-payer signature is added on the client).
  let simError = null;
  try {
    const sim = await conn().simulateTransaction(tx, undefined, false);
    if (sim.value.err) {
      const log = (sim.value.logs || []).find((l) => /insufficient|NotInitialized|Error Message:/i.test(l));
      simError = log ? log.replace(/^Program log:\s*/, '') : ('Simulation failed: ' + JSON.stringify(sim.value.err));
    }
  } catch (e) { /* non-fatal: let the client try */ }

  return {
    ok: true,
    txBase64: tx.serialize({ requireAllSignatures: false }).toString('base64'),
    escrow: resolved.escrow.toBase58(), escrowToken: resolved.escrowToken.toBase58(),
    decimals: dec, tokenProgram: tokenProgram.toBase58(),
    schedule: { totalRaw: total.toString(), cliffRaw: cliff.toString(), perPeriodRaw: per.toString(), periods, freqSec: freq, cliffTime },
    lastValidBlockHeight, simError,
  };
}

module.exports = { buildCreateLockTx, LOCK_PROGRAM };
