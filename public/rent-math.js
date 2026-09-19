// public/rent-math.js — Solana rent-exempt-deposit maths, ONE source of truth shared by:
//   1. public/solana-rent.html ("The deposit you didn't know you made", /solana/rent) — the
//      general explainer with the reduced-rent rollout schedule (SIMD-0437).
//   2. lib/rent-reclaim.js (the Rent Reclaim read side, /api/seeker/reclaimable) — for the
//      lamports<->SOL conversion the total/per-account numbers go through.
//   3. src/seeker's Rent Reclaim pane (loaded as a plain script, same as cluck-util.js — see the
//      no-cache static route in server.js and the <script src="/rent-math.js"> tag in
//      seeker.html/solana-rent.html) — so the number a phone shows and the number the explainer
//      page shows are, byte for byte, the same computation.
//
// Lives under public/, not lib/, even though it is also require()'d server-side: the seeker
// store-edition bundle (store-edition/seeker-edition.json) only ever copies allow-listed files
// out of public/ (scripts/build-store-edition.mjs's `copy()`), the same way it already does for
// cluck-util.js/cluck-wallet.js/i18n.js — putting the shared module anywhere else would mean
// either a second copy inside the bundle or a special case in that shared build script. Being
// requirable from Node is a property of what this file avoids doing (no browser-only globals), not
// of which folder it sits in.
//
// CLAUDE.md's architecture tripwire: "rent maths ... duplicated implementations drifting apart."
// This file exists so nobody re-types BILLABLE_BYTES, a lamports-per-byte rate, or the SOL
// formatting idiom a second time. Deliberately dependency-free (no Node builtins beyond what a
// browser also has) so the EXACT SAME FILE works as `require("../public/rent-math")` on the
// server and as a plain <script> global (window.CluckRentMath) in the browser — no build step, no
// two copies to keep in step by hand.
(function (global) {
  "use strict";

  // A standard SPL token account holds 165 bytes of data; Solana also charges rent on a fixed
  // 128-byte account-overhead allowance, so the rent-exempt deposit is priced on 293 billable
  // bytes in total (see public/solana-rent.html's "What changed, in lamports" card).
  var BILLABLE_BYTES = 293; // 165 (token account data) + 128 (account overhead)
  var LAMPORTS_PER_SOL = 1e9;

  // The reduced-rent rollout schedule (SIMD-0437). Kept here, not re-typed on the page —
  // scripts/solana-room-test.cjs re-derives these same numbers independently as its own check,
  // which is exactly the point: two independent paths to the same answer, one shared source.
  var STAGES = [
    { name: "Original", lamportsPerByte: 6960 },
    { name: "Step 1 — live on mainnet since Sep 3, 2026", lamportsPerByte: 6333 },
    { name: "Step 2 — mainnet expected mid-September 2026", lamportsPerByte: 5080 },
    { name: "All five steps — expected around November 2026", lamportsPerByte: 696 },
  ];

  // What a FRESH token account would cost to open at a given lamports-per-byte rate. NOTE this is
  // NOT what lib/rent-reclaim.js reports per account — an existing account's actual on-chain
  // lamport balance is the ground truth for what closing it returns (rates only ever fell, and an
  // account keeps the deposit it was opened with until something explicitly withdraws the
  // surplus), so the reclaim scan reads `account.lamports` straight off the RPC response rather
  // than recomputing it from a rate that may not be the one the account was actually opened
  // under. This function is for the explainer page's "what does it cost today" table.
  function minimumLamports(lamportsPerByte, billableBytes) {
    return (billableBytes == null ? BILLABLE_BYTES : billableBytes) * lamportsPerByte;
  }

  function lamportsToSol(lamports) {
    return (Number(lamports) || 0) / LAMPORTS_PER_SOL;
  }

  // Same formatting public/solana-rent.html has always used: 8 decimals, trailing zeros
  // stripped, never a bare "123." — any caller's output stays identical to that page's.
  function fmtSol(lamports) {
    return lamportsToSol(lamports).toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0") + " SOL";
  }

  var CluckRentMath = {
    BILLABLE_BYTES: BILLABLE_BYTES,
    LAMPORTS_PER_SOL: LAMPORTS_PER_SOL,
    STAGES: STAGES,
    minimumLamports: minimumLamports,
    lamportsToSol: lamportsToSol,
    fmtSol: fmtSol,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CluckRentMath;
  if (typeof global !== "undefined") global.CluckRentMath = CluckRentMath;
})(typeof globalThis !== "undefined" ? globalThis : this);
