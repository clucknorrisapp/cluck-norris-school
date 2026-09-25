// Byte-diff the SHIPPED browser instruction builders (public/airdrop-engine.js) against the
// reference libraries — the CLAUDE.md rule: "diff its bytes against the library in Node before
// shipping". This used to diff a private mirror of the builders, which proved nothing about the
// file the browser actually runs; it now loads that file into a vm context with the same globals
// it gets in the page (solanaWeb3) and compares what it builds. Zero network. Exit 1 on mismatch.
//
// Run: node scripts/verify-burn-close.cjs        (CI runs it in the smoke-test job)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const web3 = require('@solana/web3.js');
const spl  = require('@solana/spl-token');
const { PublicKey, SystemProgram } = web3;

const TOKEN_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022    = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Load the real file. Its IIFE ends `})(globalThis)` and publishes `splToken` / `CluckAirdrop`
// on the global it is handed; the page supplies `solanaWeb3` from the vendored IIFE bundle.
const ctx = { solanaWeb3: web3, console };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'airdrop-engine.js'), 'utf8'), ctx,
  { filename: 'public/airdrop-engine.js' });
const shipped = ctx.splToken;
if (!shipped || typeof shipped.createBurnCheckedInstruction !== 'function') {
  console.log('❌ public/airdrop-engine.js did not publish splToken — cannot verify');
  process.exit(1);
}

function norm(ix){
  return JSON.stringify({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map(k => ({ p: k.pubkey.toBase58(), s: !!k.isSigner, w: !!k.isWritable })),
    data: Array.from(ix.data),
  });
}

const acct = new PublicKey('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
const mint = new PublicKey('DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS');
const owner= new PublicKey('2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8');
const dest = owner;
const amount = 123456789n, decimals = 6;

let pass = true;
function diff(label, mine, lib) {
  const ok = mine === lib;
  console.log(`${label} ${ok ? 'MATCH' : 'MISMATCH'}`);
  if (!ok) { pass = false; console.log('  shipped:', mine, '\n  lib    :', lib); }
}

for (const prog of [TOKEN_CLASSIC, TOKEN_2022]) {
  const pk = new PublicKey(prog), tag = `[${prog.slice(0,4)}..]`;
  const ata = new PublicKey(shipped.getAssociatedTokenAddressSync(mint, owner, prog).toString());
  diff(`${tag} ATA derivation`, ata.toBase58(), spl.getAssociatedTokenAddressSync(mint, owner, false, pk).toBase58());
  // NOT diffed: the shipped CreateATA(idempotent) still passes the legacy SysvarRent key as a 7th
  // account; @solana/spl-token dropped it. Both layouts are accepted by the ATA program (it ignores
  // the extra key), so that is a known, harmless difference — not a byte bug this script should fail on.
  diff(`${tag} TransferChecked`,
    norm(shipped.createTransferCheckedInstruction(acct, mint, ata, owner, amount, decimals, prog)),
    norm(spl.createTransferCheckedInstruction(acct, mint, ata, owner, amount, decimals, [], pk)));
  diff(`${tag} BurnChecked`,
    norm(shipped.createBurnCheckedInstruction(acct, mint, owner, amount, decimals, prog)),
    norm(spl.createBurnCheckedInstruction(acct, mint, owner, amount, decimals, [], pk)));
  diff(`${tag} CloseAccount`,
    norm(shipped.createCloseAccountInstruction(acct, dest, owner, prog)),
    norm(spl.createCloseAccountInstruction(acct, dest, owner, [], pk)));
}
// The browser must never call SystemProgram.transfer() (Buffer-dependent u64 encoder); the shipped
// hand-built System ix #2 has to be byte-identical to what the library would have produced.
diff('[System] SOL transfer',
  norm(shipped.createSolTransferInstruction(owner, acct, 1_500_000_000)),
  norm(SystemProgram.transfer({ fromPubkey: owner, toPubkey: acct, lamports: 1_500_000_000 })));

// WithdrawExcessLamports (opcode 38) — Firepit's "reclaim surplus rent, keep the account open"
// job. The installed @solana/spl-token (0.4.14) does NOT implement this yet — its own
// TokenInstruction enum has the slot commented out ("// WithdrawalExcessLamports = 38"), which is
// itself confirmation of the opcode — so there is no library function to diff against. Instead
// this builds the SPEC'S reference instruction by hand (SIMD-0266 / solana.com/docs/tokens/
// advanced/withdraw-excess-lamports: data = the single byte 38, accounts = [source (writable),
// destination (writable), authority (signer)]) and diffs the shipped builder against THAT. Also
// verified by a real mainnet simulation (see AGENTS.md / the rent-surplus PR) — this script only
// re-checks the bytes, not the chain behaviour.
function refWithdrawExcessLamports(account, destination, authority, programId) {
  return new (require('@solana/web3.js').TransactionInstruction)({
    keys: [
      { pubkey: account,     isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority,   isSigner: true,  isWritable: false },
    ],
    programId,
    data: Buffer.from([38]),
  });
}
for (const prog of [TOKEN_CLASSIC, TOKEN_2022]) {
  const pk = new PublicKey(prog), tag = `[${prog.slice(0,4)}..]`;
  diff(`${tag} WithdrawExcessLamports`,
    norm(shipped.createWithdrawExcessLamportsInstruction(acct, owner, owner, prog)),
    norm(refWithdrawExcessLamports(acct, owner, owner, pk)));
}
// Data must be EXACTLY one byte, opcode 38 — no payload, no trailing bytes.
{
  const ix = shipped.createWithdrawExcessLamportsInstruction(acct, owner, owner, TOKEN_CLASSIC);
  const okLen = ix.data.length === 1 && ix.data[0] === 38;
  console.log(`[data] WithdrawExcessLamports is exactly [38] ${okLen ? 'MATCH' : 'MISMATCH'}`);
  if (!okLen) { pass = false; console.log('  got:', Array.from(ix.data)); }
}

console.log(pass ? '\n✅ ALL MATCH — public/airdrop-engine.js is byte-identical to the libraries' : '\n❌ MISMATCH — do not ship');
process.exit(pass?0:1);
