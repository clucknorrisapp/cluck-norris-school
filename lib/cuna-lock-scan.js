"use strict";
// Finding the locks. Enumerates every Jupiter Lock escrow holding a given mint, and maintains the
// `firstSeenAt` ledger the qualification rules measure terms against.
//
// Split the way lib/cuna-staking.js is: the network call is thin and dumb, and everything that
// DECIDES anything is pure and tested. mergeLedger() is where the attacks live.
//
// ⚠️ getProgramAccounts is deliberately NOT in the /api/helius-rpc allowlist (server.js ~9426) and
// must stay out of it — it is an unbounded, expensive scan and that proxy is public. This module
// runs server-side against our own RPC.

const { normalizeEscrow } = require("./cuna-staking");

// VestingEscrow layout: 8-byte anchor discriminator, then recipient (32), then token_mint.
// If the account layout ever changes this offset silently starts matching nothing — the scan
// returns zero locks and every earner quietly stops earning. A test pins it.
const TOKEN_MINT_OFFSET = 40;

// The terms that cannot change on a live escrow. An escrow address is a PDA derived from a `base`
// keypair the creator chooses, so a creator can close a lock and recreate one at the SAME address.
// Without this, the new lock would inherit the old lock's firstSeenAt — and since the horizon is
// measured forward from firstSeenAt, an older one makes the terms EASIER to pass. Index a throwaway
// lock, close it, recreate something short at the same address, and it reads as long. Binding the
// ledger entry to the terms closes that: different terms, different lock, new clock.
function fingerprintOf(account) {
  const v = (x) => (x == null ? "" : x.toBase58 ? x.toBase58() : x.toString());
  return [
    v(account.tokenMint), v(account.creator), v(account.cliffTime), v(account.frequency),
    v(account.numberOfPeriod), v(account.cliffUnlockAmount), v(account.amountPerPeriod),
  ].join("|");
}

// Fold a fresh scan into the ledger. PURE: hand it the scan and the stored ledger, get back the
// normalized locks and the ledger to persist. `ledger` is not mutated.
//
// firstSeenAt is WRITE-ONCE per set of terms. It never moves forward and never moves back on a
// re-scan, because every day it slipped later would be a day of horizon handed to the lock.
function mergeLedger({ scanned, ledger, nowUnix }) {
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`mergeLedger needs a real nowUnix: ${nowUnix}`);
  const next = { ...(ledger || {}) };
  const locks = [];
  const added = [], reset = [];

  for (const { escrow, account } of scanned || []) {
    const key = String(escrow && escrow.toBase58 ? escrow.toBase58() : escrow);
    const fp = fingerprintOf(account);
    const prev = next[key];
    if (!prev) {
      next[key] = { firstSeenAt: now, fingerprint: fp, lastSeenAt: now };
      added.push(key);
    } else if (prev.fingerprint !== fp) {
      // Same address, different terms: a different lock wearing the old one's clothes.
      next[key] = { firstSeenAt: now, fingerprint: fp, lastSeenAt: now };
      reset.push(key);
    } else {
      next[key] = { ...prev, lastSeenAt: now };
    }
    locks.push(normalizeEscrow(key, account, next[key].firstSeenAt));
  }

  // Entries we no longer see. Kept, never deleted: an escrow can drop out of an RPC index for a
  // moment (it has happened to the liquidity vault), and deleting would restart the clock in the
  // lock holder's favour on the next scan. Out of the scan means out of the day's accrual anyway,
  // because accrual only ever iterates what the scan returned.
  const seen = new Set(locks.map((l) => l.escrow));
  const vanished = Object.keys(next).filter((k) => !seen.has(k));

  return { locks, ledger: next, added, reset, vanished };
}

// The network half. Thin on purpose.
async function scanEscrowsByMint(program, mint) {
  const all = await program.account.vestingEscrow.all([
    { memcmp: { offset: TOKEN_MINT_OFFSET, bytes: String(mint) } },
  ]);
  return all.map(({ publicKey, account }) => ({ escrow: publicKey.toBase58(), account }));
}

module.exports = { TOKEN_MINT_OFFSET, fingerprintOf, mergeLedger, scanEscrowsByMint };
