// lib/rent-surplus.js — pure decision logic for Firepit's "reclaim surplus rent — keep the
// account open" job (owner ask, 2026-09-25). Kept separate from server.js's /api/burn-scan route
// (which does the RPC calls) so the DECISION here has its own unit test with no network, the
// same split lib/rent-reclaim.js already uses for the close-account job.
//
// WithdrawExcessLamports (SPL Token + Token-2022, instruction opcode 38 — verified by a real
// mainnet simulation, not guessed) lets the account's OWNER pull the lamports it holds ABOVE
// today's rent-exempt minimum, without closing the account or touching its token balance. It
// exists because a rent-parameter cut (most recently the p-token/SIMD-0266 rollout) lowers the
// minimum going forward without touching what an account already deposited when it was opened.
//
// Facts this module encodes, each one a reason an account is excluded rather than offered:
//   · Wrapped SOL (`isNative`) is refused ON-CHAIN (Custom error NativeNotSupported) — excluded
//     here rather than let a doomed transaction reach the wallet.
//   · The signer must be the account's OWNER. A delegate or close-authority has no standing
//     (Custom(4) OwnerMismatch). The caller (getTokenAccountsByOwner filtered by the connected
//     wallet) should never hand this module an account owned by someone else, but this is the
//     defense-in-depth half of that rule, not the only one.
//   · Surplus is per-account: it is only ever positive when the account's OWN byte length's
//     rent-exempt minimum (read live, never hardcoded — more rent cuts are coming) is less than
//     what the account already holds. A minimum that could not be read produces `null`, never a
//     fabricated `0` that would misreport a real surplus as "nothing to reclaim".
"use strict";

// `rentLamports` — the account's current lamport balance. `rentExemptMinimum` — the live-read
// minimum for this account's own byte length, or null/undefined when it could not be read.
// Returns { rentExemptLamports, surplusLamports }, both null when the minimum is unknown.
function computeSurplus(rentLamports, rentExemptMinimum) {
  const rl = Number(rentLamports) || 0;
  const min = Number(rentExemptMinimum);
  if (rentExemptMinimum == null || !Number.isFinite(min) || min <= 0) {
    return { rentExemptLamports: null, surplusLamports: null };
  }
  return { rentExemptLamports: min, surplusLamports: Math.max(0, rl - min) };
}

// Is `account` a candidate for the surplus job at all? `account` shape: { isNative, owner,
// surplusLamports }. `wallet` is the connected wallet address the caller scanned for — when
// provided, an account whose own `owner` field disagrees is excluded (defense-in-depth; see
// header). Never true for a surplus that is null (unknown) or <= 0.
function isEligibleForSurplus(account, wallet) {
  if (!account) return false;
  if (account.isNative) return false;
  if (wallet && account.owner && account.owner !== wallet) return false;
  const surplus = Number(account.surplusLamports);
  return Number.isFinite(surplus) && surplus > 0;
}

// Default cap on distinct byte lengths looked up per call — see the header note above
// computeSurplusForAccounts for why this exists and why it must stay small.
const DEFAULT_MAX_LOOKUPS = 8;

// The whole "read side" of the surplus job, with the network pulled out. `accounts` is the raw
// list from getTokenAccountsByOwner (each needs `space`, `isNative`, `rentLamports`, `owner`);
// `wallet` is the address that was scanned (for the owner-mismatch check); `lookupMin(space)` is
// an async function resolving the live rent-exempt minimum for that byte length, or
// rejecting/throwing when it couldn't be read — server.js injects the real RPC-backed lookup,
// a test injects a fake one. Kept here, not in server.js, so this whole decision — including the
// "surplusAvailable" flag adversarial review found missing cases in — has a unit test with no
// network and no spawned server (Codex round on PR #443, findings 3/8/9).
//
// Adversarial-review findings this encodes:
//   · P2-3: `surplusAvailable` is false — never a silent "everything's fine" that a client could
//     read as "nothing to reclaim" — when ANY non-native account's byte length is missing/
//     unreadable (`space` <= 0), not just when an RPC call outright fails. A missing field for
//     even one account must not let a wallet-wide flag imply data the client can trust.
//   · P3-8: `lookupMin` calls run CONCURRENTLY (Promise.all), and `maxLookups` bounds how many
//     DISTINCT lengths are looked up per call (default 8) — a pathological wallet with many
//     different Token-2022 extension combinations must not turn one scan into a slow serial chain
//     of RPC round trips, or into an unbounded one. Lengths beyond the cap are treated exactly
//     like a lookup that failed: `surplusAvailable` goes false and those accounts' surplus reads
//     null, never a request that hangs the ordinary burn/reclaim scan this same route also serves.
//
// Returns { surplusAvailable, surplusLamportsTotal, accounts }, where `accounts` is `accounts`
// with `rentExemptLamports`/`surplusLamports`/`surplusEligible` merged in, same order, same length.
async function computeSurplusForAccounts(accounts, wallet, lookupMin, opts) {
  const maxLookups = (opts && Number.isFinite(opts.maxLookups) && opts.maxLookups > 0) ? opts.maxLookups : DEFAULT_MAX_LOOKUPS;
  const list = Array.isArray(accounts) ? accounts : [];
  // Only NON-native accounts ever need a minimum looked up — a native (wrapped SOL) account's
  // surplus is always null regardless, so a space occupied only by native accounts must never
  // cost a lookup (or count against the distinct-length cap below).
  const spaces = [...new Set(list.filter((a) => !a.isNative).map((a) => a.space).filter((s) => Number(s) > 0))];
  const spacesToLookup = spaces.slice(0, maxLookups);
  const spacesSkipped = spaces.length > spacesToLookup.length;

  // Start optimistic, then let either condition below flip it to false — never the other way:
  // a real per-space success must never overwrite an already-known "no, something is missing".
  let surplusAvailable = !list.some((a) => !a.isNative && !(Number(a.space) > 0)) && !spacesSkipped;

  const rentMinBySpace = new Map();
  await Promise.all(spacesToLookup.map(async (sp) => {
    try {
      rentMinBySpace.set(sp, await lookupMin(sp));
    } catch (_e) {
      surplusAvailable = false;
    }
  }));

  let surplusLamportsTotal = 0;
  const out = list.map((a) => {
    const { rentExemptLamports, surplusLamports } = a.isNative
      ? { rentExemptLamports: null, surplusLamports: null }
      : computeSurplus(a.rentLamports, rentMinBySpace.get(a.space));
    if (surplusLamports != null) surplusLamportsTotal += surplusLamports;
    const surplusEligible = isEligibleForSurplus({ isNative: a.isNative, owner: a.owner, surplusLamports }, wallet);
    return Object.assign({}, a, { rentExemptLamports, surplusLamports, surplusEligible });
  });

  return { surplusAvailable, surplusLamportsTotal, accounts: out };
}

module.exports = { computeSurplus, isEligibleForSurplus, computeSurplusForAccounts, DEFAULT_MAX_LOOKUPS };
