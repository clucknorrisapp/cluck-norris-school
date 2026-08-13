// Byte-diff my hand-built Burn/Close instructions vs @solana/spl-token (CLAUDE.md rule).
const web3 = require('@solana/web3.js');
const spl  = require('@solana/spl-token');
const { PublicKey, TransactionInstruction } = web3;

const TOKEN_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022    = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// ---- my Buffer-free implementations (mirror the shim style) ----
function myBurnChecked(account, mint, owner, amount, decimals, tokenProgram) {
  const TP = new PublicKey(tokenProgram || TOKEN_CLASSIC);
  const data = new Uint8Array(10);
  data[0] = 15;
  new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
  data[9] = decimals & 0xff;
  return new TransactionInstruction({
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint,    isSigner: false, isWritable: true },
      { pubkey: owner,   isSigner: true,  isWritable: false },
    ],
    programId: TP, data,
  });
}
function myCloseAccount(account, destination, owner, tokenProgram) {
  const TP = new PublicKey(tokenProgram || TOKEN_CLASSIC);
  return new TransactionInstruction({
    keys: [
      { pubkey: account,     isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner,       isSigner: true,  isWritable: false },
    ],
    programId: TP, data: new Uint8Array([9]),
  });
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
for (const prog of [TOKEN_CLASSIC, TOKEN_2022]) {
  const pk = new PublicKey(prog);
  const bMine = norm(myBurnChecked(acct, mint, owner, amount, decimals, prog));
  const bLib  = norm(spl.createBurnCheckedInstruction(acct, mint, owner, amount, decimals, [], pk));
  const cMine = norm(myCloseAccount(acct, dest, owner, prog));
  const cLib  = norm(spl.createCloseAccountInstruction(acct, dest, owner, [], pk));
  const bOK = bMine === bLib, cOK = cMine === cLib;
  console.log(`[${prog.slice(0,4)}..] BurnChecked ${bOK?'MATCH':'MISMATCH'} | CloseAccount ${cOK?'MATCH':'MISMATCH'}`);
  if(!bOK){ pass=false; console.log('  mine:',bMine,'\n  lib :',bLib); }
  if(!cOK){ pass=false; console.log('  mine:',cMine,'\n  lib :',cLib); }
}
console.log(pass ? '\n✅ ALL MATCH — byte-identical to @solana/spl-token' : '\n❌ MISMATCH — do not ship');
process.exit(pass?0:1);
