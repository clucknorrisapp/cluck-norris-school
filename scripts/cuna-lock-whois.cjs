"use strict";
// Check wallets against every CUNA lock on-chain: which ones actually receive a lock, which
// created one, and whether each lock qualifies. Built for working through the owner's list of
// "wallets I locked from" without either of us guessing.
//
//   node scripts/cuna-lock-whois.cjs <wallet> [<wallet> ...]
//
// Read-only. Points at an RPC directly because getProgramAccounts is not in the /api/helius-rpc
// allowlist and must stay out of it.

const anchor=require('@coral-xyz/anchor');
const {Connection,PublicKey,Keypair}=require('@solana/web3.js');
const scan=require('../lib/cuna-lock-scan'); const s=require('../lib/cuna-staking');
const CUNA='4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';
const ASK=process.argv.slice(2);
if(!ASK.length){console.error('usage: node scripts/cuna-lock-whois.cjs <wallet> [<wallet> ...]');process.exit(1);}
for(const a of ASK) if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)){console.error('not a Solana address: '+a);process.exit(1);}
(async()=>{
  const conn=new Connection(process.env.PROBE_RPC||'https://api.mainnet-beta.solana.com','confirmed');
  const pr=new anchor.AnchorProvider(conn,new anchor.Wallet(Keypair.generate()),{});
  const idl=await anchor.Program.fetchIdl(new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn'),pr);
  idl.address=idl.address||'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
  const P=new anchor.Program(idl,pr);
  const now=Math.floor(Date.now()/1000);
  const locks=scan.mergeLedger({scanned:await scan.scanEscrowsByMint(P,CUNA),ledger:{},nowUnix:now}).locks;
  const cuna=r=>(Number(r)/1e9).toLocaleString(undefined,{maximumFractionDigits:0});
  for(const a of ASK){
    const asRec=locks.filter(l=>l.recipient===a), asCre=locks.filter(l=>l.creator===a);
    console.log('\n'+a);
    console.log('  CUNA locks RECEIVED by it: '+asRec.length);
    for(const l of asRec) console.log(`    ${l.escrow.slice(0,8)}… ${cuna(l.atRiskRaw).padStart(13)} CUNA  cliff +${((l.cliffTime-now)/86400).toFixed(0)}d  ends +${((l.fullyVestedAt-now)/86400).toFixed(0)}d  qualifies:${s.qualifies(l,{mint:CUNA,minDurationDays:365,minCliffDays:180})}`);
    console.log('  CUNA locks CREATED by it:  '+asCre.length);
    for(const l of asCre) console.log(`    ${l.escrow.slice(0,8)}… -> ${l.recipient.slice(0,8)}… ${cuna(l.atRiskRaw)} CUNA`);
  }
  console.log('\n(scanned '+locks.length+' CUNA escrows total)');
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
