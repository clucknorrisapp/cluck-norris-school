"use strict";
// Who qualifies for CUNA lock-to-earn TODAY, read straight off the chain.
//
// Run it before changing any config number, and after: it answers "who does this actually pay?"
// with real escrows rather than reasoning. Read-only — it never writes the ledger it builds.
//
//   node scripts/cuna-lock-scan-live.cjs
//   PROBE_RPC=https://... node scripts/cuna-lock-scan-live.cjs     (any RPC allowing getProgramAccounts)
//
// getProgramAccounts is NOT in the /api/helius-rpc allowlist and must stay out of it, so this
// points at an RPC directly.

const anchor = require('@coral-xyz/anchor');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const scan = require('../lib/cuna-lock-scan');
const s = require('../lib/cuna-staking');
const CUNA = '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';
const TREASURY = '2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8';
const CFG = { mint: CUNA, minDurationDays: 365, minCliffDays: 180, excludeWallets: [TREASURY] };
(async () => {
  const conn = new Connection(process.env.PROBE_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(Keypair.generate()), {});
  const idl = await anchor.Program.fetchIdl(new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn'), provider);
  idl.address = idl.address || 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
  const P = new anchor.Program(idl, provider);

  const scanned = await scan.scanEscrowsByMint(P, CUNA);
  const now = Math.floor(Date.now() / 1000);
  const r1 = scan.mergeLedger({ scanned, ledger: {}, nowUnix: now });
  console.log(`scanned ${scanned.length} escrows, ${r1.added.length} new to the ledger\n`);

  const q = [], no = [];
  for (const l of r1.locks) (s.qualifies(l, CFG) ? q : no).push(l);
  const cuna = (raw) => (Number(raw) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 0 });

  console.log(`QUALIFYING (${q.length}):`);
  const unlock = s.dailyUnlockRaw(r1.locks, now);
  const pool = s.poolForDay({ dailyUnlockRaw: unlock.toString(), sharePct: 20 });
  console.log(`daily unlock stream (computed live from the schedules): ${cuna(unlock)} CUNA/day`);
  const day = s.accrueDay({ locks: r1.locks, poolRaw: pool.toString(), nowUnix: now, cfg: CFG });
  for (const l of q) console.log(`  ${l.escrow.slice(0,8)}… ${l.recipient.slice(0,8)}…  ${cuna(l.atRiskRaw).padStart(13)} CUNA` +
    `  cliff +${((l.cliffTime-now)/86400).toFixed(0)}d  ends +${((l.fullyVestedAt-now)/86400).toFixed(0)}d` +
    `  -> ${cuna(day.credits[l.recipient] || 0n)} CUNA/day`);

  console.log(`\nREFUSED (${no.length}) — reason tally:`);
  const tally = {};
  for (const l of no) for (const why of s.disqualify(l, CFG)) tally[why] = (tally[why] || 0) + 1;
  for (const [k, v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(3)}x ${k}`);

  console.log(`\ndaily pool at 20%: ${cuna(pool)} CUNA`);
  console.log(`distributed: ${cuna(day.distributed)}   undistributed: ${cuna(day.undistributed)}`);
  console.log(`eligible: ${day.eligible}   skipped: ${day.skipped.length}`);

  // re-scan proves the clock does not move
  const r2 = scan.mergeLedger({ scanned, ledger: r1.ledger, nowUnix: now + 86400 });
  const moved = r2.locks.filter(l => l.firstSeenAt !== r1.ledger[l.escrow].firstSeenAt);
  console.log(`\nre-scan a day later: ${r2.added.length} added, ${r2.reset.length} reset, ${moved.length} clocks moved`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
