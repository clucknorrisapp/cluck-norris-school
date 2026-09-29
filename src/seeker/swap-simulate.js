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
// Native SOL's mint id in a Jupiter quote (the wrapped-SOL mint). A quote whose OUTPUT is this
// mint pays out as native SOL — Jupiter's build wraps into a wSOL account and CLOSES it in the
// same transaction — so what the person receives shows up on the SOL label, not on a token label.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

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

// ⚠️ Frontier review round 31b, verifier follow-up 1 — "a getTokenAccountsByOwner result that
// resolves but lacks .value (or is not an array) silently becomes []." The inventory-shaping this
// used to do inline in `Swap.jsx` treated `legacyAccts`/`token22Accts` far more leniently than the
// `solRes` read right next to it: `solRes` already refused unless `.value` was a real number, but
// `(legacyAccts && legacyAccts.value) || []` turned ANY malformed response — `{}`, `undefined`,
// `{value:null}`, `{value:"x"}` — into an empty list, silently treating the wallet as holding NO
// token accounts in that program. An account this read failed to enumerate is then completely
// invisible to `verifySimulationResult`'s "no other mint may move" check — it could be drained
// past the gate as if it had never existed. Moved here, pure and unit-testable on its own: every
// one of the three raw RPC results (`getBalance`, `getTokenAccountsByOwner` × 2) is held to the
// SAME standard — anything other than the well-formed shape REFUSES, never quietly becomes "no
// holdings". Returns `{ok:true, addresses, labels}` (ready for `simulateTransaction`'s own
// `accounts.addresses` and `verifySimulationResult`'s own `addressLabels`) or `{ok:false, reason}`
// — the reason strings match the app's own translated dictionary entries; callers pass them
// through their own `t()`.
// The base fee every Solana transaction pays per required signature (lamports_per_signature,
// 5,000 today — solana.com/docs/core/fees). The verifier's `feeLamports` is the PRIORITY fee only
// (compute units × price); the full fee is priority + base × signers, and the SOL checks below
// use the full fee (Codex round 34: an honest swap with no account create was refused by exactly
// these 5,000 lamports).
export const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5000;

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// ⚠️ Codex rounds 33/34 on #420 — what the inventory has to carry for the SOL accounting below
// to be honest:
//   · `lamports` on every token label. A token account's lamports (its rent-exempt balance, and
//     for a wSOL account the wrapped SOL on top) are the WALLET'S SOL — closing the account
//     returns them to native. The wallet's real SOL position is therefore native lamports PLUS
//     the lamports of every token account it owns, and a swap's SOL proceeds/cost is the change
//     in THAT position. Counting native alone credited a closed pre-existing wSOL account's own
//     rent (2,039,280 lamports) as swap output: a zero-output route passed a 1,000,000-lamport
//     minimum (round 34, finding 2). An inventory entry without a readable lamports figure is
//     dropped like any other unreadable entry — never carried with a guessed 0.
//   · `trackedAtas` — the wallet's OWN associated token accounts for the mints this swap can
//     touch (input, output, wSOL; both token programs; swap-verify.js derives them). Any not
//     already held is appended at before = 0 tokens / 0 lamports so an account this transaction
//     CREATES is inside the position — its rent then reads as moved, not spent, and a not-yet-
//     created output account is held to the minimum (round 33, finding 1: without it a first-
//     time buyer had no output account in the checked set and a zero-output simulation passed).
//     `outputMint` + `outputAtas` remain as the older spelling of the same thing.
// Both optional, so every existing caller/test is unchanged.
export function buildInventory({ live, solRes, legacyAccts, token22Accts, outputMint, outputAtas, trackedAtas }) {
  const solBefore = solRes && typeof solRes.value === "number" ? solRes.value : null;
  if (solBefore == null) {
    return { ok: false, reason: "Could not read your SOL balance to check this transaction before signing. Try again." };
  }
  const legacyList = legacyAccts && Array.isArray(legacyAccts.value) ? legacyAccts.value : null;
  const token22List = token22Accts && Array.isArray(token22Accts.value) ? token22Accts.value : null;
  if (legacyList == null || token22List == null) {
    return { ok: false, reason: "Could not read your wallet's token accounts to check this transaction before signing. Try again." };
  }

  // The FULL current inventory, both token programs — never filtered to just the two mints this
  // swap expects, so the simulation gate can catch a balance change on a mint nobody asked about.
  const addresses = [live];
  const labels = [{ kind: "sol", before: String(solBefore) }];
  for (const entry of [...legacyList, ...token22List]) {
    const acct = entry && entry.account;
    const info = acct && acct.data && acct.data.parsed && acct.data.parsed.info;
    const mint = info && info.mint;
    const amount = info && info.tokenAmount && info.tokenAmount.amount;
    const lamports = acct && (typeof acct.lamports === "number" || typeof acct.lamports === "string") ? toBigIntOrNull(acct.lamports) : null;
    // An unreadable inventory entry is left OUT of the checked set rather than guessed — this
    // only affects an entry this client itself could not parse from its own read (never happens
    // for a real getTokenAccountsByOwner(jsonParsed) response), unlike the wholesale-missing
    // `.value` case above, which is refused outright rather than silently dropped.
    if (!mint || amount == null || lamports == null || !entry.pubkey) continue;
    labels.push({ kind: "token", mint, before: String(amount), lamports: lamports.toString() });
    addresses.push(entry.pubkey);
  }
  const tracked = [];
  if (outputMint && Array.isArray(outputAtas)) tracked.push({ mint: outputMint, addresses: outputAtas });
  if (Array.isArray(trackedAtas)) for (const t of trackedAtas) if (t && t.mint && Array.isArray(t.addresses)) tracked.push(t);
  for (const t of tracked) {
    for (const ata of t.addresses) {
      if (typeof ata !== "string" || !ata || addresses.includes(ata)) continue;
      labels.push({ kind: "token", mint: t.mint, before: "0", lamports: "0", expected: true });
      addresses.push(ata);
    }
  }
  return { ok: true, addresses, labels };
}

// `simResult` — the `.value` OBJECT of a `simulateTransaction` RPC result:
//   { err, accounts: [...], unitsConsumed, logs }
//   (the RPC answers `{ context, value }` — preSignSimulation() below unwraps it; Codex round 34
//   finding 1: the pane used to pass the whole envelope in here and every honest swap refused as
//   "incomplete" before the wallet was ever asked.)
//   `accounts` MUST be in the SAME ORDER as `addressLabels` below (the same order the caller sent
//   as the `addresses` array to `simulateTransaction`'s `accounts` config).
// `addressLabels` — array describing what each `accounts[i]` entry IS and what it held BEFORE the
// simulated transaction ran (read fresh, on-chain, by the caller — never cached):
//   { kind: "sol", before: "<lamports as a string>" }                          — exactly one, index 0
//   { kind: "token", mint, before: "<base units>", lamports: "<lamports>" }     — zero or more
// `inputMint`, `outputMint` — the quote's own mints (never confused with each other).
// `inAmount` — the quote's own inAmount, base-unit string.
// `minReceived` — the COMPUTED minimum (never upstream's own otherAmountThreshold — see swap-
//   verify.js/Swap.jsx's own notes on that), base-unit string.
// `feeLamports` — the verified, ceiling-rounded PRIORITY fee (swap-verify.js's own `feeLamports`).
// `signatureCount` — required signers (swap-verify.js pins exactly 1); defaults to 1. The full
//   transaction fee is feeLamports + BASE_FEE_LAMPORTS_PER_SIGNATURE × signatureCount.
// `inputIsSol` — whether the quote's input mint IS native SOL (WSOL_MINT).
// `allowedNewAtaCount` — how many NEW token accounts this swap's own instructions are allowed to
//   create (swap-verify.js already counted and bounded this — pass that same count here, never a
//   larger one). With every own-ATA tracked in the position (buildInventory's `trackedAtas`) a
//   create's rent is a MOVE inside the position, not a cost; this count only tolerates rent to an
//   account the inventory could not track, and only ever on the OUTFLOW side — it is never
//   credited as proceeds.
// `ataRentLamportsOverride` — optional, for tests; defaults to ATA_RENT_LAMPORTS.
//
// Returns `{ ok:true }` or `{ ok:false, reason:<user-facing sentence> }`. Never throws.
export function verifySimulationResult({
  simResult, addressLabels, inputMint, outputMint, inAmount, minReceived, feeLamports, signatureCount,
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
  const signers = signatureCount == null ? 1n : toBigIntOrNull(signatureCount);
  const rentPer = toBigIntOrNull(ataRentLamportsOverride) != null ? toBigIntOrNull(ataRentLamportsOverride) : BigInt(ATA_RENT_LAMPORTS);
  if (inAmountBig == null || minReceivedBig == null || feeLamportsBig == null || ataCountBig == null || signers == null || signers < 1n) {
    return { ok: false, reason: "Could not check the simulated result — the expected amounts were incomplete." };
  }
  const txFee = feeLamportsBig + BigInt(BASE_FEE_LAMPORTS_PER_SIGNATURE) * signers;

  // ⚠️ Codex round 33 on #420 — NATIVE SOL OUTPUT. When the output mint is wSOL, the value
  // arrives as native SOL: the route pays into a wSOL account that the same transaction closes,
  // so after simulation that account reads `null` and a token-side minimum check would REFUSE
  // every honest SOL-output swap. The received amount is the change of the SOL POSITION (below)
  // with the transaction fee added back, held to the same minimum as a token output.
  const outputIsSol = outputMint === WSOL_MINT;
  if (inputIsSol && outputIsSol) {
    return { ok: false, reason: "Could not check the simulated result — the quote pays with and receives the same asset." };
  }

  // ⚠️ THE SOL POSITION (Codex round 34, finding 2). Native lamports PLUS the lamports of every
  // token account in the checked set — a token account's lamports are the wallet's own SOL
  // (rent, and for wSOL the wrapped amount too). Rent moving INTO an account this transaction
  // creates, or OUT of one it closes, is a move inside the position and never reads as a cost or
  // as proceeds. This replaces three separate bounds (native SOL, wSOL token decrease, rent
  // estimate) that each had a way to be wrong on their own: 31b's SOL/wSOL double-accounting and
  // round 34's closed-account rent counted as output were both the same mistake, seen twice.
  // ⚠️ Codex round 33 on #420, finding 2 — a wallet can hold MORE THAN ONE token account for a
  // mint. Token-side deltas are SUMMED across every account of that mint and bounded once, after
  // the loop; with no output-mint label at all there is nothing to compare, and "nothing to
  // compare" is a refusal, never a pass.
  let solBefore = null, solAfter = null;
  let positionBefore = 0n, positionAfter = 0n;
  let inputTokenDecrease = 0n;
  let outputGain = 0n, outputSeen = 0;
  for (let i = 0; i < addressLabels.length; i++) {
    const label = addressLabels[i];
    const read = readSimBalance(accounts[i], label);
    if (!read.ok) return read;
    const before = toBigIntOrNull(label.before);
    if (before == null) return { ok: false, reason: "Could not check the simulated result — a starting balance was missing." };
    const after = read.amount;

    if (label.kind === "sol") {
      solBefore = before; solAfter = after;
      positionBefore += before; positionAfter += after;
      continue;
    }

    // The account's own lamports, before (from the inventory) and after (from the simulation).
    // A closed account reads `null` = 0 lamports: everything it held went back to native.
    const lamportsBefore = toBigIntOrNull(label.lamports);
    if (lamportsBefore == null) return { ok: false, reason: "Could not check the simulated result — a token account's starting lamports were missing." };
    let lamportsAfter = 0n;
    if (accounts[i] !== null) {
      lamportsAfter = toBigIntOrNull(accounts[i] && accounts[i].lamports);
      if (lamportsAfter == null) return { ok: false, reason: "Could not read the simulated result — a token account's simulated lamports could not be understood." };
    }
    positionBefore += lamportsBefore; positionAfter += lamportsAfter;

    const delta = after - before;
    if (label.mint === inputMint) {
      if (delta > 0n) return { ok: false, reason: "This transaction would increase the token you're paying with — that should never happen." };
      // A wSOL input account's token decrease is already inside the position (its lamports fell
      // with it) — bounded once below with native SOL, never on its own (31b's double-accounting).
      if (!inputIsSol) inputTokenDecrease += -delta;
      continue;
    }
    if (label.mint === outputMint) {
      if (outputIsSol) continue;        // inside the position; held to the minimum below
      outputGain += delta;              // summed across every output account; bounded below
      outputSeen++;
      continue;
    }
    if (delta !== 0n) {
      return { ok: false, reason: "This transaction would move a token balance the quote never mentioned." };
    }
  }

  if (solBefore == null || solAfter == null) {
    return { ok: false, reason: "Could not check the simulated result — the wallet's SOL balance was missing." };
  }
  const positionDelta = positionAfter - positionBefore;   // positive = the wallet's SOL grew
  // Rent to an account the inventory could NOT track (none, for a normal Jupiter build — every
  // own-ATA is tracked) — tolerated on the outflow side only, never credited as proceeds.
  const untrackedRentTolerance = ataCountBig * rentPer;

  if (outputIsSol) {
    const received = positionDelta + txFee;
    if (received < minReceivedBig) {
      return { ok: false, reason: "This transaction would give you less than the minimum you were shown." };
    }
  } else {
    if (outputSeen === 0) {
      return { ok: false, reason: "Could not check the minimum you were shown — no account for the token you're buying was in the simulation." };
    }
    if (outputGain < minReceivedBig) {
      return { ok: false, reason: "This transaction would give you less than the minimum you were shown." };
    }
  }
  if (!inputIsSol && inputTokenDecrease > inAmountBig) {
    return { ok: false, reason: "This transaction would move more of the token you're paying with than the quote showed." };
  }

  // What the SOL position may lose: the transaction fee, plus (input-is-SOL) the quote's own
  // inAmount, plus rent to an untracked account. SOL is free to RISE.
  const solLost = -positionDelta;   // positive = the position shrank
  const allowed = txFee + untrackedRentTolerance + (inputIsSol ? inAmountBig : 0n);
  if (solLost > allowed) {
    return inputIsSol
      ? { ok: false, reason: "This transaction would move more SOL (native and wrapped combined) than the quote showed." }
      : { ok: false, reason: "This transaction would spend more SOL than the quote and fee shown." };
  }

  return { ok: true };
}

// ⚠️ Codex round 34 on #420, finding 1 (P1) — THE CALLER, in the pure module, so it can be driven
// with the documented RPC response shape. Swap.jsx used to do this inline and handed the whole
// `{ context, value }` envelope of `simulateTransaction` to verifySimulationResult, which expects
// the `value` object — so every honest swap refused as "the result was incomplete" before the
// wallet was ever asked to sign, and no test caught it because none exercised the caller.
//
// `rpc(method, params)` — the app's own JSON-RPC function (CluckUtil.rpc: resolves to the RESULT,
// throws on a JSON-RPC error). Reason strings are the untranslated English keys; Swap.jsx passes
// them through its own t(). An unreachable RPC — any of the reads OR the simulate call — is a
// REFUSAL, never a skip.
export async function preSignSimulation({
  rpc, live, swapTransactionB64, quote, minReceived, feeLamports, signatureCount, ataCreateCount,
  inputIsSol, outputAtas, trackedAtas,
}) {
  let solRes, legacyAccts, token22Accts;
  try {
    [solRes, legacyAccts, token22Accts] = await Promise.all([
      rpc("getBalance", [live, { commitment: "confirmed" }]),
      rpc("getTokenAccountsByOwner", [live, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }]),
      rpc("getTokenAccountsByOwner", [live, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed" }]),
    ]);
  } catch (_) {
    return { ok: false, reason: "Could not reach the network to check this transaction before signing. Try again." };
  }
  const inv = buildInventory({ live, solRes, legacyAccts, token22Accts, outputMint: quote && quote.outputMint, outputAtas, trackedAtas });
  if (!inv.ok) return inv;

  let simRes;
  try {
    simRes = await rpc("simulateTransaction", [swapTransactionB64, {
      encoding: "base64", sigVerify: false, replaceRecentBlockhash: true,
      accounts: { encoding: "jsonParsed", addresses: inv.addresses },
    }]);
  } catch (_) {
    return { ok: false, reason: "Could not simulate this transaction before signing. Try again." };
  }
  // The documented shape is { context: { slot }, value: { err, accounts, logs, unitsConsumed } }.
  // Anything else — no envelope, no value, a value that is not an object — is malformed and
  // refuses; it is never unwrapped by guesswork and never handed down as-is.
  const value = simRes && typeof simRes === "object" && simRes.value && typeof simRes.value === "object" ? simRes.value : null;
  if (!value) return { ok: false, reason: "Could not simulate this transaction before signing — the result was incomplete." };

  return verifySimulationResult({
    simResult: value, addressLabels: inv.labels,
    inputMint: quote.inputMint, outputMint: quote.outputMint, inAmount: quote.inAmount,
    minReceived, feeLamports, signatureCount, inputIsSol, allowedNewAtaCount: ataCreateCount,
  });
}
