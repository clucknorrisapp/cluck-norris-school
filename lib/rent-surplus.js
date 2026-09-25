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

module.exports = { computeSurplus, isEligibleForSurplus };
