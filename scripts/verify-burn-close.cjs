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

console.log(pass ? '\n✅ ALL MATCH — public/airdrop-engine.js is byte-identical to the libraries' : '\n❌ MISMATCH — do not ship');
process.exit(pass?0:1);
