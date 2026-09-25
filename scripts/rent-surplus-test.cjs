#!/usr/bin/env node
"use strict";
// lib/rent-surplus.js — the pure decision logic behind Firepit's "reclaim surplus rent — keep
// the account open" job (owner ask, 2026-09-25). No network: every case here is either a real
// mainnet figure (getMinimumBalanceForRentExemption(165) = 1,488,440 lamports today, verified by
// simulation and cited in AGENTS.md) or a boundary the code must get right regardless of what the
// live number happens to be.
const { computeSurplus, isEligibleForSurplus } = require("../lib/rent-surplus");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d !== undefined ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };

const REAL_MIN_165 = 1488440;   // getMinimumBalanceForRentExemption(165), live-verified 2026-09-25
const REAL_MIN_170 = 1513840;   // 170-byte Token-2022 (immutableOwner), same verification

console.log("\nlib/rent-surplus\n");

// ── computeSurplus ────────────────────────────────────────────────────────────────────────────
let r = computeSurplus(1855569, REAL_MIN_165);
ok("real mainnet account: 1,855,569 lamports vs today's 165-byte minimum → surplus 367,129", r.rentExemptLamports === REAL_MIN_165 && r.surplusLamports === 367129, r);

r = computeSurplus(2039280, REAL_MIN_165);
ok("an account still at the OLD 165-byte rent (2,039,280) → surplus is the full drop, 550,840", r.rentExemptLamports === REAL_MIN_165 && r.surplusLamports === 550840, r);

r = computeSurplus(REAL_MIN_165, REAL_MIN_165);
ok("an account already exactly at today's minimum → surplus is 0, not negative", r.surplusLamports === 0, r);

r = computeSurplus(1200000, REAL_MIN_165);
ok("an account BELOW today's minimum (should not happen, but the account is real) → clamps to 0, never negative", r.surplusLamports === 0, r);

r = computeSurplus(REAL_MIN_170 + 25000, REAL_MIN_170);
ok("data length drives the minimum: a 170-byte Token-2022 account uses the 170-byte figure, not the 165-byte one", r.rentExemptLamports === REAL_MIN_170 && r.surplusLamports === 25000, r);

r = computeSurplus(2039280, null);
ok("minimum could not be read (null) → BOTH fields null, never a fabricated 0 (an RPC failure must read as \"couldn't check\", never \"nothing to reclaim\")", r.rentExemptLamports === null && r.surplusLamports === null, r);

r = computeSurplus(2039280, undefined);
ok("same for undefined (a Map.get() miss)", r.rentExemptLamports === null && r.surplusLamports === null, r);

r = computeSurplus(2039280, 0);
ok("a minimum of exactly 0 is treated as unreadable, not as \"nothing required\" (real accounts always cost something)", r.rentExemptLamports === null && r.surplusLamports === null, r);

r = computeSurplus(2039280, NaN);
ok("a non-finite minimum is treated as unreadable", r.rentExemptLamports === null && r.surplusLamports === null, r);

r = computeSurplus("2039280", REAL_MIN_165);
ok("a string lamport figure (defensive — some RPC paths hand back strings) still computes correctly", r.surplusLamports === 550840, r);

// ── isEligibleForSurplus ──────────────────────────────────────────────────────────────────────
const WALLET = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

ok("a normal account with real surplus, owned by the connected wallet → eligible",
  isEligibleForSurplus({ isNative: false, owner: WALLET, surplusLamports: 367129 }, WALLET) === true);

ok("isNative EXCLUDED — wrapped SOL is refused on-chain (NativeNotSupported) regardless of any lamport math",
  isEligibleForSurplus({ isNative: true, owner: WALLET, surplusLamports: 999999999 }, WALLET) === false);

ok("owner mismatch EXCLUDED — a delegate or close-authority has no standing to sign (Custom(4) OwnerMismatch)",
  isEligibleForSurplus({ isNative: false, owner: "SomeoneElse11111111111111111111111111111", surplusLamports: 367129 }, WALLET) === false);

ok("surplus <= 0 EXCLUDED — zero",
  isEligibleForSurplus({ isNative: false, owner: WALLET, surplusLamports: 0 }, WALLET) === false);

ok("surplus <= 0 EXCLUDED — negative (should never happen after computeSurplus's clamp, but the gate holds anyway)",
  isEligibleForSurplus({ isNative: false, owner: WALLET, surplusLamports: -5 }, WALLET) === false);

ok("surplus null (unreadable minimum) EXCLUDED — never treated as eligible just because it isn't explicitly zero",
  isEligibleForSurplus({ isNative: false, owner: WALLET, surplusLamports: null }, WALLET) === false);

ok("no wallet passed in (caller trusts the RPC filter alone) → owner check is skipped, decision falls back to isNative + surplus",
  isEligibleForSurplus({ isNative: false, owner: "Anyone", surplusLamports: 100 }, null) === true);

ok("a missing/undefined account → false, never throws",
  isEligibleForSurplus(undefined, WALLET) === false);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
