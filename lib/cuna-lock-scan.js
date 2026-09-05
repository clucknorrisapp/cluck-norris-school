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
// NO top-level require of @solana/web3.js: the CI node-check job runs these suites without
// npm install, on purpose — the decision logic here is zero-dependency and must stay loadable
// that way. The network half requires it lazily.

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
//
// BACKDATING (owner, 2026-09-05: "I don't want someone that locked before today to be paid at a
// lower rate, they locked early"). Until the programme is armed the ledger is not written, so
// every existing lock would otherwise be stamped at the moment we arm — charging people for the
// gap between locking and launch. `createdAt` maps escrow -> the account's own creation time, read
// from the chain, so an early locker is credited from when they actually locked.
//
// ⚠️ THE ANCHOR HAS TO BE UNFORGEABLE, and only one candidate is. vesting_start_time, cliff_time
// and the rest are creator-set (live CUNA escrows declare 2069 and 2077); the account's creation
// slot is the chain's own record and nobody can create an account in the past. Anything derived
// from escrow FIELDS must never reach this.
//
// ⚠️ AND A RESET IS NEVER BACKDATED. Same address with different terms means a rebuilt lock, and
// the whole point of the reset is that it starts a fresh clock — handing it the original account's
// creation date would restore exactly the PDA-reuse hole the fingerprint closes. Resets take `now`,
// always. An unknown or future creation time also falls back to `now`, which is the strict
// direction: a later start means a shorter term, never a longer one.
// BOUNDED. Two reasons a raw "oldest signature" cannot be trusted as far back as it reaches:
//   - the address, not the account: a Jupiter escrow PDA is derived from a creator-chosen base, so
//     a closed escrow (any mint) at the same address leaves its history behind, and a new lock
//     there would read as months old — 5.44x on a 90-day commitment in the round-two audit;
//   - the token is days old: nothing that holds CUNA can predate the mint.
// So a start is never earlier than `notBefore` (the mint's birth, config) and never more than
// `backdateCapDays` before now. For a genuine early locker the cap is a no-op — the window between
// announcing and arming is days — and for a reused address it bounds the gain to the cap.
function mergeLedger({ scanned, ledger, nowUnix, createdAt, backdateCapDays = 30, notBefore = 0 }) {
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
      const born = Number((createdAt || {})[key]);
      // Only ever EARLIER than now, never later, never zero/NaN — and never past the bounds above.
      const floor = Math.max(Number(notBefore) || 0, now - Math.max(0, Number(backdateCapDays) || 0) * 86400);
      let start = Number.isFinite(born) && born > 0 && born < now ? Math.floor(born) : now;
      if (start < floor) start = floor;
      if (start > now) start = now;
      next[key] = { firstSeenAt: start, fingerprint: fp, lastSeenAt: now, backdated: start !== now };
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

// When each account was created, from the chain's own signature history — the oldest signature on
// the address is the transaction that made it. Thin and dumb on purpose; the decision about what to
// do with these lives in mergeLedger.
//
// Returns a plain escrow -> unix map, and simply omits anything it cannot determine. Omission is
// safe: mergeLedger falls back to `now`, which shortens the term rather than lengthening it. Only
// ever called for escrows that are NOT yet in the ledger, so it costs nothing on a steady state.
async function creationTimes(conn, escrows, { maxPages = 5, pageSize = 1000 } = {}) {
  // Lazy, and tolerant of the package being absent: the CI suites hand in a mock connection with
  // no web3 installed. A real Connection always has it.
  let PublicKey = null;
  try { PublicKey = require("@solana/web3.js").PublicKey; } catch (_) {}
  const out = {};
  for (const escrow of escrows || []) {
    try {
      let before, oldest = null, reachedStart = false;
      for (let page = 0; page < maxPages; page++) {
        const opts = before ? { limit: pageSize, before } : { limit: pageSize };
        const sigs = await conn.getSignaturesForAddress(PublicKey ? new PublicKey(escrow) : escrow, opts);
        if (!sigs || !sigs.length) { reachedStart = true; break; }
        oldest = sigs[sigs.length - 1];
        if (sigs.length < pageSize) { reachedStart = true; break; }
        before = oldest.signature;
      }
      // Only a walk that reached the FIRST signature knows the creation time. Falling out of the
      // page limit with `oldest` still set would report the 5,000th-newest transaction as the
      // creation — a confidently wrong, too-late answer that anyone can manufacture for ~$5 of
      // memo transactions referencing the address. Omit instead; mergeLedger then uses `now`.
      if (!reachedStart) { console.warn(`[cuna-stake] creation lookup for ${escrow} exceeded ${maxPages} pages — not backdating it`); continue; }
      const t = oldest && Number(oldest.blockTime);
      if (Number.isFinite(t) && t > 0) out[String(escrow)] = t;
    } catch (_) { /* omitted -> mergeLedger uses now, the strict direction */ }
  }
  return out;
}

// The network half. Thin on purpose.
async function scanEscrowsByMint(program, mint) {
  const all = await program.account.vestingEscrow.all([
    { memcmp: { offset: TOKEN_MINT_OFFSET, bytes: String(mint) } },
  ]);
  return all.map(({ publicKey, account }) => ({ escrow: publicKey.toBase58(), account }));
}

module.exports = { TOKEN_MINT_OFFSET, fingerprintOf, mergeLedger, creationTimes, scanEscrowsByMint };
