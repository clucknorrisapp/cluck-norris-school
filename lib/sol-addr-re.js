"use strict";
// The base58 Solana address shape — split out of lib/solana-addr.js (which requires Node's
// `crypto` and `Buffer` at module load, for the PDA/address math nothing here needs) so a
// dependency chain that only wants the REGEX can stay Node-free. lib/buycomp-payout.js requires
// this instead of the full solana-addr module so lib/hub/reproduce.js's browser bundle
// (public/hub-verify.bundle.js, Y1) never drags Node builtins in with it — see that file's header.
// lib/solana-addr.js itself re-exports this SAME constant (never a second, hand-typed copy —
// CLAUDE.md "Verification: check every form, not one form").
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 mint/wallet shape
module.exports = { SOL_ADDR_RE };
