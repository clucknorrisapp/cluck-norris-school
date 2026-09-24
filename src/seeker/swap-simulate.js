// Cluck Norris — Seeker app, Swap pane. Frontier adversarial review, round 31b, item 4:
// "the route plan / remaining accounts are never checked and ALTs can contain any address, so
// 'moves nothing but in/out, at most inAmount' is not proven by instruction decoding alone."
//
// `swap-verify.js` proves the TOP-LEVEL instructions are exactly the shapes a real Jupiter swap
// emits, with every account it names bound to the live wallet where that account is STATIC. But
// Jupiter's actual route-hop accounts (the AMM pool accounts, intermediate mints, program
// authorities for each hop) live almost entirely in an address lookup table — the review's own
// point: an ALT can resolve to ANY address, and nothing about decoding the instruction's fixed
// account slots proves what those hop accounts actually do on-chain. Decoding alone cannot prove
// "this transaction moves nothing but the input mint out and the output mint in, bounded by the
// numbers on screen." Only running the transaction (a dry-run, no state actually committed) and
// reading what ACTUALLY changed can prove that.
//
// This module is the PURE, framework-free half of that check: given a `simulateTransaction` RPC
// result and the numbers the person was shown, it decides whether the simulated balance deltas
// are consistent with an honest swap. It never fetches, never builds a transaction, never signs —
// `Swap.jsx` is the caller that fetches the wallet's own current token-account inventory, calls
// `/api/helius-rpc` with `simulateTransaction`, and refuses to ever call the wallet to sign when
// this module refuses (or when the RPC itself could not be reached — "unreachable" is a refusal,
// never a skip; AGENTS.md's own rule for RPC failures elsewhere in this app).
//
// TRUST BOUNDARY, STATED HONESTLY (docs/SEEKER_SWAP_DESIGN.md carries the same paragraph): this
// gate proves the SIMULATED outcome matches what was shown. It does not, and cannot, prove the
// REAL execution will match the simulation — a transaction can behave differently between
// simulation and landing (a pool's state moved in between, for instance; that risk is exactly what
// `slippageBps` and the route instruction's own `quoted_out_amount`/`slippage_bps` bytes, checked
// in `swap-verify.js`, already bound on-chain). What this gate adds is specifically the thing
// instruction decoding cannot see: the hop accounts an ALT can point anywhere.

// The rent-exempt minimum for a classic (165-byte) SPL Token account, Solana mainnet — read via
// `getMinimumBalanceForRentExemption(165)` at the time this was written. This is an ESTIMATE, not
// a live chain read: rent parameters could change, and a Token-2022 account with extensions can be
// larger. It only bounds how much SOL an ALLOWED new token-account create may cost — the gate is a
// structural check against manipulation, not a precise fee estimator, and a real create costing
// slightly more than this estimate would simply be caught by the SOL-outflow check below (a
// legitimate reason to widen this constant later, never a reason to drop the check).
export const ATA_RENT_LAMPORTS = 2039280;

function toBigIntOrNull(v) {
  if (v == null) return null;
  try { return BigInt(String(v)); } catch (_) { return null; }
}

// Reads the post-simulation balance for one labelled address. Returns `{ ok:true, amount:BigInt }`
// or `{ ok:false, reason }` — NEVER guesses a balance from a malformed/missing entry.
function readSimBalance(entry, label) {
  if (label.kind === "sol") {
    // A missing/null SOL account entry is never valid — the fee payer always exists.
    if (!entry || typeof entry !== "object") return { ok: false, reason: "Could not read the simulated result — the wallet's SOL balance was missing." };
    const lamports = toBigIntOrNull(entry.lamports);
    if (lamports == null) return { ok: false, reason: "Could not read the simulated result — the wallet's SOL balance could not be understood." };
    return { ok: true, amount: lamports };
  }
  // Token account. `null` is a valid, well-formed answer meaning "does not exist after
  // simulation" (e.g. an ephemeral wSOL ATA that got closed within the same transaction) — that is
  // a real balance of 0, not a missing/malformed response.
  if (entry === null) return { ok: true, amount: 0n };
  if (!entry || typeof entry !== "object") return { ok: false, reason: "Could not read the simulated result — a token account's simulated state was missing." };
  const info = entry.data && entry.data.parsed && entry.data.parsed.info;
  const amount = info && info.tokenAmount && toBigIntOrNull(info.tokenAmount.amount);
  if (amount == null) return { ok: false, reason: "Could not read the simulated result — a token account's simulated balance could not be understood." };
  return { ok: true, amount };
}

// `simResult` — the raw `simulateTransaction` RPC result's `.value` object:
//   { err, accounts: [...], unitsConsumed, logs }
//   `accounts` MUST be in the SAME ORDER as `addressLabels` below (the same order the caller sent
//   as the `addresses` array to `simulateTransaction`'s `accounts` config).
// `addressLabels` — array describing what each `accounts[i]` entry IS and what it held BEFORE the
// simulated transaction ran (read fresh, on-chain, by the caller — never cached):
//   { kind: "sol", before: "<lamports as a string>" }                          — exactly one, index 0
//   { kind: "token", mint: "<base58>", before: "<base-unit amount as a string>" } — zero or more
// `inputMint`, `outputMint` — the quote's own mints (never confused with each other).
// `inAmount` — the quote's own inAmount, base-unit string.
// `minReceived` — the COMPUTED minimum (never upstream's own otherAmountThreshold — see swap-
//   verify.js/Swap.jsx's own notes on that), base-unit string.
// `feeLamports` — the verified, ceiling-rounded priority fee (swap-verify.js's own `feeLamports`).
// `inputIsSol` — whether the quote's input mint IS native SOL (WSOL_MINT).
// `allowedNewAtaCount` — how many NEW token accounts this swap's own instructions are allowed to
//   create (swap-verify.js already counted and bounded this — pass that same count here, never a
//   larger one).
// `ataRentLamportsOverride` — optional, for tests; defaults to ATA_RENT_LAMPORTS.
//
// Returns `{ ok:true }` or `{ ok:false, reason:<user-facing sentence> }`. Never throws.
export function verifySimulationResult({
  simResult, addressLabels, inputMint, outputMint, inAmount, minReceived, feeLamports,
  inputIsSol, allowedNewAtaCount, ataRentLamportsOverride,
}) {
  if (!simResult || typeof simResult !== "object") {
    return { ok: false, reason: "Could not simulate this transaction before signing." };
  }
  // A `simulateTransaction` failure (err set) means the transaction itself would fail on-chain —
  // never let a person sign something the node already says won't work.
  if (simResult.err != null) {
    return { ok: false, reason: "This transaction would fail on-chain: " + JSON.stringify(simResult.err) };
  }
  if (!Array.isArray(addressLabels) || !addressLabels.length || addressLabels[0].kind !== "sol") {
    return { ok: false, reason: "Could not check the simulated result." };
  }
  const accounts = simResult.accounts;
  // ⚠️ "missing account in response" — a response whose `accounts` array is absent, not an array,
  // or shorter than what was asked for is malformed and REFUSES, never silently treated as "no
  // change" for the accounts it's missing.
  if (!Array.isArray(accounts) || accounts.length !== addressLabels.length) {
    return { ok: false, reason: "Could not simulate this transaction before signing — the result was incomplete." };
  }

  const inAmountBig = toBigIntOrNull(inAmount);
  const minReceivedBig = toBigIntOrNull(minReceived);
  const feeLamportsBig = toBigIntOrNull(feeLamports);
  const ataCountBig = toBigIntOrNull(allowedNewAtaCount);
  const rentPer = toBigIntOrNull(ataRentLamportsOverride) != null ? toBigIntOrNull(ataRentLamportsOverride) : BigInt(ATA_RENT_LAMPORTS);
  if (inAmountBig == null || minReceivedBig == null || feeLamportsBig == null || ataCountBig == null) {
    return { ok: false, reason: "Could not check the simulated result — the expected amounts were incomplete." };
  }

  let solBefore = null, solAfter = null;
  for (let i = 0; i < addressLabels.length; i++) {
    const label = addressLabels[i];
    const read = readSimBalance(accounts[i], label);
    if (!read.ok) return read;
    const before = toBigIntOrNull(label.before);
    if (before == null) return { ok: false, reason: "Could not check the simulated result — a starting balance was missing." };
    const after = read.amount;

    if (label.kind === "sol") {
      solBefore = before; solAfter = after;
      continue;
    }

    const delta = after - before;
    if (label.mint === inputMint) {
      if (delta > 0n) return { ok: false, reason: "This transaction would increase the token you're paying with — that should never happen." };
      if (-delta > inAmountBig) return { ok: false, reason: "This transaction would move more of the token you're paying with than the quote showed." };
      continue;
    }
    if (label.mint === outputMint) {
      if (delta < minReceivedBig) return { ok: false, reason: "This transaction would give you less than the minimum you were shown." };
      continue;
    }
    if (delta !== 0n) {
      return { ok: false, reason: "This transaction would move a token balance the quote never mentioned." };
    }
  }

  if (solBefore == null || solAfter == null) {
    return { ok: false, reason: "Could not check the simulated result — the wallet's SOL balance was missing." };
  }
  // How much SOL is allowed to leave the wallet: the input amount (only if the input IS SOL —
  // wrapped into wSOL by this same transaction), plus the priority fee, plus rent for however many
  // NEW token accounts this swap's own (already-counted, already-bounded) instructions may create.
  // SOL is free to RISE (a closed wSOL ATA refunds its own rent) — only an outflow larger than this
  // ceiling is refused.
  const maxOutflow = (inputIsSol ? inAmountBig : 0n) + feeLamportsBig + ataCountBig * rentPer;
  const solOutflow = solBefore - solAfter; // positive = SOL fell
  if (solOutflow > maxOutflow) {
    return { ok: false, reason: "This transaction would spend more SOL than the quote and fee shown." };
  }

  return { ok: true };
}
