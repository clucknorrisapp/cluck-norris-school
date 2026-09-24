// Cluck Norris — Seeker app, Swap pane. Fix round (PR #420, P2-1): "the transaction is never
// checked against the quote." This module is the client-side half of the fix — a pure, framework-
// free STRUCTURAL check run on the deserialized VersionedTransaction Jupiter built, immediately
// before it is handed to the wallet to sign. It never fetches, never builds, never signs; it only
// reads fields already present on an in-memory web3.js VersionedTransaction and compares them
// against the quote the person was shown.
//
// Plain browser primitives only (DataView) — no Buffer, no STATIC web3.js import of its own (this
// file never constructs a transaction, only reads one). AGENTS.md: no layout encoder in a browser
// page that needs Node's Buffer; DataView needs nothing.
//
// ⚠️ Codex round 30, P1 — "the verifier checks program ids, not instruction semantics." Round 29
// only checked that every instruction's PROGRAM was on an allowlist; it never looked at what the
// instruction actually DID. Codex appended a 1 SOL `SystemProgram.transfer` to a new recipient
// (System is allowlisted — it's needed for the SOL-wrap step) and `verify` still said ok, because
// nothing read the instruction's own data or accounts. Every instruction is now decoded by its
// OWN LAYOUT and matched against exactly the shapes a real Jupiter swap can contain (recorded
// fixture: scripts/fixtures/seeker-swap/swap.json, decoded by hand — see the account map in
// scripts/seeker-swap-verify-test.cjs and the comments below); anything else refuses by name.
// `PublicKeyClass` (round 30) is dependency-injected rather than read off `window.solanaWeb3` —
// this file still performs no STATIC import, but the ATA math needs a `PublicKey` and a Node test
// has no `window`, so the caller passes its own (`Swap.jsx` passes `web3.PublicKey`, the `web3`
// argument `signSendConfirm`'s `build()` already receives).
//
// The checks, each refusing (never signing) on failure:
//   1. FEE PAYER IS THE PERSON — message.staticAccountKeys[0] must equal the live connected
//      address. A transaction that debits someone else's account is not one they should sign.
//   2. EXACTLY ONE REQUIRED SIGNER — message.header.numRequiredSignatures === 1. A second
//      required signer means this transaction expects an approval beyond the one wallet prompt
//      the person is about to see.
//   3. EVERY TOP-LEVEL INSTRUCTION IS ONE OF THE SHAPES A JUPITER SWAP ACTUALLY EMITS, decoded by
//      program (round 30):
//        - ComputeBudget: SetComputeUnitLimit (tag 2, u32) and SetComputeUnitPrice (tag 3, u64)
//          only — decoded and returned as {cuLimit, cuPriceMicroLamports} so the caller can
//          enforce a priority-fee ceiling (round 30 fix 6) without decoding a second time.
//        - System: ONLY Transfer (tag 2, u64 lamports) whose `from` is the live wallet and whose
//          `to` is the live wallet's OWN wSOL associated token account, for no more than the
//          quote's inAmount (and only when the quote's input actually is SOL — otherwise the
//          allowed amount is zero). This is exactly Codex's exploit path, closed: a transfer to
//          any other account, or of any other amount, refuses by name.
//        - Associated Token program: ONLY Create/CreateIdempotent (empty data, or a single byte
//          1), whose funding payer and wallet/owner are both live, and whose ATA is the live
//          wallet's derived account for either the input or the output mint.
//        - Token / Token-2022: ONLY SyncNative (tag 17) on the live wallet's wSOL ATA, and
//          CloseAccount (tag 9) on that same ATA with both destination and owner live. Any
//          Transfer/TransferChecked/Approve/SetAuthority/Burn at top level refuses by name —
//          none of those belong in a swap the connected wallet is only wrapping/unwrapping SOL
//          and receiving a route's own output through.
//        - Memo: any (never moves value).
//        - Jupiter: ONLY the ExactIn shapes `route` and `shared_accounts_route` (round 30 fix 4 —
//          `exact_out_route`/`shared_accounts_exact_out_route` refuse by name; the pane never
//          requests ExactOut). Accounts are bound by the IDL's own account order
//          (https://github.com/jup-ag/instruction-parser "jupiter.ts") and checked against the
//          live address / derived ATAs — see the per-kind bindings below for exactly which slots.
//        - Any other program id -> refused (unchanged from round 29).
//   4. THE JUPITER ROUTE INSTRUCTION'S OWN ARGS MATCH THE QUOTE — the route/shared_accounts_route
//      instructions both end with the same 19-byte tail: in_amount (u64 LE), quoted_out_amount
//      (u64 LE), slippage_bps (u16 LE), platform_fee_bps (u8). This is the ONLY thing a validator
//      actually enforces — the JSON quote and the confirm-sheet numbers are cosmetic unless the
//      bytes agree with them. Confirmed against the real recorded fixture (decoded in
//      scripts/seeker-swap-verify-test.cjs): its instruction carries the shared_accounts_route
//      discriminator, and its trailing 19 bytes decode to exactly that fixture's own quote.json
//      amounts.
//   5. (round 30 fix 6) THE COMPUTE BUDGET'S OWN PRIORITY FEE NEVER EXCEEDS WHAT THE SHEET SHOWED
//      — cuLimit × cuPriceMicroLamports / 1e6 must be <= the `maxPriorityFeeLamports` the caller
//      passes in (the number the confirm sheet actually rendered). Omit the argument to skip this
//      check (used only by legacy call sites/tests that don't carry a displayed ceiling).
//
// ⚠️ Codex round 31, P1 — "repeated instructions exceed the approved amount." Round 30 checked
// each instruction's OWN fields but never a transaction's total effect: TWO wSOL-wrap System
// transfers, each individually under the quote's inAmount, summed to MORE than the person ever
// approved (routeTail was also simply overwritten by whichever route instruction came last, so a
// second Jupiter call could ride alongside the real one unnoticed). Fixed by making every one of
// these a TRANSACTION-WIDE limit, enforced once after the per-instruction loop, never per
// instruction:
//   6. EXACTLY ONE Jupiter route instruction (route/shared_accounts_route/either ExactOut kind —
//      a second one of ANY kind refuses by name, before its shape is even decoded).
//   7. THE SUM of every System Transfer's lamports refuses if it exceeds the quote's inAmount
//      when the input is SOL, and refuses on ANY System Transfer at all when the input is not SOL
//      (there is nothing for a non-SOL swap to wrap).
//   8. AT MOST ONE wSOL SyncNative and AT MOST ONE CloseAccount.
//   9. AT MOST ONE Associated-Token-Account create per target ATA address (i.e. per mint this
//      swap actually touches).
//
//   10. (round 31, P1) A MISSING SetComputeUnitLimit IS NOT A ZERO-CU TRANSACTION — Solana applies
//      a runtime default when a transaction carries none: 200,000 CU per instruction (excluding
//      ComputeBudget instructions themselves), capped at 1,400,000 CU total per transaction
//      (solana.com/docs/core/fees/fee-structure, "Compute Budget"). Omitting the limit instruction
//      used to skip the priority-fee ceiling check entirely — Codex's exploit: drop
//      SetComputeUnitLimit, set SetComputeUnitPrice to 1,000,000,000 micro-lamports/CU, and the fee
//      ceiling never even ran. Now: no SetComputeUnitLimit -> the default above is computed and
//      used for the ceiling math; no SetComputeUnitPrice -> price is 0. The fee is
//      ceil(cuLimit × cuPriceMicroLamports / 1e6) lamports — CEILING, not truncating division,
//      computed with BigInt (`(a*b + 999_999n) / 1_000_000n`) so a fee that rounds up past the
//      ceiling by even one lamport still refuses. More than one SetComputeUnitLimit or
//      SetComputeUnitPrice in the same transaction refuses outright (there is exactly one honest
//      value for each).
//
// ⚠️ Frontier adversarial review, round 31b — a second, harder look past round 31, found two more
// fail-open cases plus three P2s:
//   11. (P0) THE NON-SHARED `route` KIND'S OPTIONAL `destination_token_account` (account slot 4)
//      WAS NEVER CHECKED. `route`'s account order is [tokenProgram, userTransferAuthority,
//      userSourceTokenAccount, userDestinationTokenAccount, destinationTokenAccount(optional),
//      destinationMint, platformFeeAccount(optional)] — round 30 bound and checked slot 3
//      (`user_destination_token_account`, the one the sheet's numbers are about) but never touched
//      slot 4. Anchor's own sentinel for "this optional account is absent" is the executing
//      program's own id (confirmed against the recorded fixture's `platform_fee_account`/
//      `token2022Program` slots, which use the identical sentinel convention — see check 3 above).
//      A compromised response can set slot 3 to the user's own real ATA (passing every check that
//      existed) while setting slot 4 — an account Jupiter's on-chain program may actually route the
//      output through — to an attacker's ATA. Slot 4 is now REQUIRED to equal the Jupiter program
//      id (the absent sentinel) or the instruction refuses; unlike the mint slots, this is never
//      "skip when unverifiable" — an ALT-resolved slot 4 refuses too, since there is no legitimate
//      reason for it to be anything but the literal sentinel.
//   12. (P1) THE PRIORITY-FEE CEILING CHECK USED TO BE SKIPPED ENTIRELY WHEN THE CALLER PASSED NO
//      `maxPriorityFeeLamports` — which is exactly what the app's own call sites did whenever
//      upstream's `prioritizationFeeLamports` field was absent (Codex's round-30/31 exploit: drop
//      the limit instruction, and if the caller also forgot to pass a ceiling, checked NOTHING).
//      `feeLamports` (the actual computed, ceiling-divided fee — see check 10) is now ALWAYS
//      computed and returned on every `ok:true` result, whether or not the caller passed a
//      ceiling — so a caller can always display the true fee, never upstream's unenforced number.
//      `Swap.jsx` now passes the exported `MAX_PRIORITY_FEE_LAMPORTS` hard constant as the ceiling
//      on every call (see that file), so this file's own "skip when omitted" contract stays for
//      test/legacy callers but the one call site that matters — the swap pane — can never omit it.
//   13. (P2) ATA `Create`/`CreateIdempotent` used to CHECK the target ATA only "when static", and
//      SKIP (never refuse) an ALT-resolved one — the exact opposite of every other unique-per-user
//      account in this file (per `pubkeyAt`'s own note: a user's own ATA is never legitimately
//      ALT-resolved). An ALT-resolved ATA index now REFUSES outright, closing both the
//      right-account check and the one-per-ATA duplicate count that an unresolved index used to
//      slip past uncounted.
export const MAX_PRIORITY_FEE_LAMPORTS = 1000000; // 0.001 SOL — see Swap.jsx's use of this constant

// Anchor instruction discriminators — sha256("global:<name>").slice(0, 8), the first 8 bytes of
// every one of Jupiter's route-shaped instructions. Verified against the real recorded fixture:
// scripts/seeker-swap-verify-test.cjs decodes scripts/fixtures/seeker-swap/swap.json and asserts
// its instruction's first 8 bytes equal ROUTE_DISCRIMINATORS["c1209b3341d69c81"] (shared_accounts_route).
export const ROUTE_DISCRIMINATORS = {
  e517cb977ae3ad2a: "route",
  d033ef977b2bed5c: "exact_out_route",
  c1209b3341d69c81: "shared_accounts_route",
  b0d169a89a7d453e: "shared_accounts_exact_out_route",
};
// Round 30 fix 4 — ExactOut is not supported by this pane (it only ever requests ExactIn); these
// two discriminators refuse outright rather than being decoded as if they were ExactIn.
const EXACT_OUT_KINDS = new Set(["exact_out_route", "shared_accounts_exact_out_route"]);

export const SWAP_PROGRAM_ALLOWLIST = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter aggregator v6
  "ComputeBudget111111111111111111111111111111", // compute unit limit/price
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token (classic)
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  // SPL Token-2022
  "11111111111111111111111111111111",            // System program
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",  // SPL Memo
]);

const JUP_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const ROUTE_TAIL_LEN = 19; // in_amount(8) + quoted_out_amount(8) + slippage_bps(2) + platform_fee_bps(1)

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function asU8(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data || []);
}

// DataView over a plain copy at an arbitrary offset — never touches Buffer.
function readU32LE(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return dv.getUint32(0, true);
}
function readU64LE(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  const lo = BigInt(dv.getUint32(0, true));
  const hi = BigInt(dv.getUint32(4, true));
  return (hi << 32n) | lo;
}
function readU16LE(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
  return dv.getUint16(0, true);
}

function pubkeyAt(keys, idx) {
  if (idx == null || idx < 0) return { addr: null, isStatic: false };
  // ⚠️ round 30: Program ids and a wallet's OWN unique accounts (its wSOL ATA, its input/output
  // ATA, the transfer authority) are always STATIC keys on a real Jupiter v0 build — they can't
  // live in a SHARED address lookup table because they're unique per user. Jupiter's SOURCE and
  // DESTINATION MINT accounts (see the per-kind bindings below) are the one exception: mints are
  // common, widely-reused addresses, and the recorded fixture shows Jupiter resolving BOTH of
  // them through an address lookup table even for a two-hop SOL->SKR trade — so an index in ALT
  // range is expected there and is handled by the caller as "unverifiable, not refused" rather
  // than by this helper.
  if (idx >= keys.length) return { addr: null, isStatic: false };
  let addr = null;
  try { addr = keys[idx].toBase58 ? keys[idx].toBase58() : String(keys[idx]); } catch (_) { addr = null; }
  return { addr, isStatic: true };
}

// Both known token programs' ATA(owner, mint) — accepts either, so a Token-2022 output mint (an
// explicit "where to look hardest" item, round 30) derives correctly without an RPC call to learn
// which program actually owns that mint. `PK` is the injected PublicKey class (see file header).
function ataCandidates(ownerB58, mintB58, PK) {
  const out = [];
  if (!PK || !ownerB58 || !mintB58) return out;
  let owner, mint;
  try { owner = new PK(ownerB58); mint = new PK(mintB58); } catch (_) { return out; }
  for (const tpB58 of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const tp = new PK(tpB58);
      const ata = PK.findProgramAddressSync(
        [owner.toBuffer(), tp.toBuffer(), mint.toBuffer()],
        new PK(ATA_PROGRAM_ID)
      )[0];
      out.push(ata.toBase58());
    } catch (_) { /* skip this program */ }
  }
  return out;
}

// `tx` — a deserialized web3.js VersionedTransaction (message.staticAccountKeys,
//        message.header.numRequiredSignatures, message.compiledInstructions).
// `liveAddress` — the LIVE connected address, re-read immediately before this call
//        (assertSameAccount()'s return value) — never a cached/quote-time address.
// `quote` — the Jupiter quote object the person was actually shown (inAmount, outAmount,
//        slippageBps, inputMint, outputMint — the same object the confirm sheet's numbers come
//        from).
// `PublicKeyClass` — round 30: the `PublicKey` constructor to derive ATAs with (Swap.jsx passes
//        `web3.PublicKey`; scripts/seeker-swap-verify-test.cjs passes its own `@solana/web3.js`
//        import). Omitting it when an instruction needs an ATA derivation is a refusal, not a
//        throw — this function never throws.
// `maxPriorityFeeLamports` — round 30 fix 6: the priority-fee ceiling the confirm sheet actually
//        displayed. Optional; when omitted the compute-budget ceiling check is skipped.
// Returns { ok:true, routeKind, cuLimit, cuPriceMicroLamports } or
// { ok:false, reason:<user-facing sentence> }. Never throws — every failure mode returns a
// refusal instead, so a caller can safely do `if (!check.ok) throw new Error(check.reason)`
// right before signing.
export function verifySwapTransaction({ tx, liveAddress, quote, PublicKeyClass, maxPriorityFeeLamports }) {
  if (!tx || !tx.message) return { ok: false, reason: "Could not read the transaction to sign." };
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  if (!keys || !keys.length) return { ok: false, reason: "The transaction has no accounts." };

  let feePayer;
  try { feePayer = keys[0].toBase58 ? keys[0].toBase58() : String(keys[0]); }
  catch (_) { return { ok: false, reason: "Could not read the fee payer." }; }
  if (!liveAddress || feePayer !== liveAddress) {
    return { ok: false, reason: "This transaction pays from a different account than the one connected." };
  }

  if (!msg.header || msg.header.numRequiredSignatures !== 1) {
    return { ok: false, reason: "This transaction expects more than one signature." };
  }

  const instructions = msg.compiledInstructions || [];
  if (!instructions.length) return { ok: false, reason: "The transaction has no instructions." };
  if (!quote) return { ok: false, reason: "No quote to verify this transaction against." };

  // Derived once — every instruction below is checked against these, never a stranger's account.
  const inputMint = quote.inputMint;
  const outputMint = quote.outputMint;
  const inputIsSol = inputMint === WSOL_MINT;
  const wsolAtas = ataCandidates(liveAddress, WSOL_MINT, PublicKeyClass);
  const inAtas = ataCandidates(liveAddress, inputMint, PublicKeyClass);
  const outAtas = ataCandidates(liveAddress, outputMint, PublicKeyClass);
  const ataOk = (addr, list) => !!addr && list.length > 0 && list.includes(addr);

  let routeTail = null, routeKind = null, cuLimit = null, cuPriceMicroLamports = null;
  // Round 31 — transaction-wide counters/accumulators. Every one of these is enforced ONCE, after
  // the per-instruction loop (or the instant a second-of-something is seen), never per instruction
  // — that per-instruction blind spot is exactly what let repeated instructions sum past what was
  // approved. See the file header, fixes 6-10.
  let jupRouteCount = 0;
  let systemTransferSum = 0n;
  let syncNativeCount = 0;
  let closeAccountCount = 0;
  let cuLimitCount = 0, cuPriceCount = 0;
  const createdAtas = new Set();

  for (const ix of instructions) {
    if (ix.programIdIndex == null || ix.programIdIndex >= keys.length) {
      return { ok: false, reason: "This transaction calls a program the app does not recognise." };
    }
    let pid;
    try { pid = keys[ix.programIdIndex].toBase58 ? keys[ix.programIdIndex].toBase58() : String(keys[ix.programIdIndex]); }
    catch (_) { return { ok: false, reason: "This transaction calls a program the app does not recognise." }; }
    if (!SWAP_PROGRAM_ALLOWLIST.has(pid)) {
      return { ok: false, reason: "This transaction calls a program the app does not recognise." };
    }
    const data = asU8(ix.data);
    const accts = ix.accountKeyIndexes || [];

    if (pid === COMPUTE_BUDGET_PROGRAM_ID) {
      if (data.length === 5 && data[0] === 2) {
        cuLimitCount++;
        if (cuLimitCount > 1) return { ok: false, reason: "This transaction sets the compute-unit limit more than once." };
        cuLimit = readU32LE(data, 1);
      } else if (data.length === 9 && data[0] === 3) {
        cuPriceCount++;
        if (cuPriceCount > 1) return { ok: false, reason: "This transaction sets the compute-unit price more than once." };
        cuPriceMicroLamports = readU64LE(data, 1);
      } else {
        return { ok: false, reason: "This transaction sets compute budget in a way the app does not recognise." };
      }
      continue;
    }

    if (pid === SYSTEM_PROGRAM_ID) {
      if (data.length !== 12 || readU32LE(data, 0) !== 2) {
        return { ok: false, reason: "This transaction moves SOL in a way the app does not recognise." };
      }
      const from = pubkeyAt(keys, accts[0]);
      const to = pubkeyAt(keys, accts[1]);
      const lamports = readU64LE(data, 4);
      if (!from.isStatic || from.addr !== liveAddress) {
        return { ok: false, reason: "This transaction moves SOL from a different account than the one connected." };
      }
      if (!to.isStatic || !ataOk(to.addr, wsolAtas)) {
        return { ok: false, reason: "This transaction sends SOL to an account that is not yours." };
      }
      // Round 31 fix 7 — a non-SOL input has nothing to wrap: ANY System transfer at all refuses,
      // not just an over-cap one. A SOL input's transfers are summed and checked ONCE below,
      // never capped per-instruction (that per-instruction cap is exactly what let two
      // under-the-cap transfers sum past the quote's inAmount).
      if (!inputIsSol) {
        return { ok: false, reason: "This transaction moves SOL, but the quote you saw does not swap from SOL." };
      }
      systemTransferSum += lamports;
      continue;
    }

    if (pid === ATA_PROGRAM_ID) {
      const isCreate = data.length === 0 || (data.length === 1 && data[0] === 1);
      if (!isCreate) {
        return { ok: false, reason: "This transaction touches token accounts in a way the app does not recognise." };
      }
      if (accts.length < 3) return { ok: false, reason: "This transaction touches token accounts in a way the app does not recognise." };
      const payer = pubkeyAt(keys, accts[0]);
      const ata = pubkeyAt(keys, accts[1]);
      const owner = pubkeyAt(keys, accts[2]);
      if (!payer.isStatic || payer.addr !== liveAddress) {
        return { ok: false, reason: "This transaction opens a token account funded by a different account than the one connected." };
      }
      if (!owner.isStatic || owner.addr !== liveAddress) {
        return { ok: false, reason: "This transaction opens a token account for a different wallet than the one connected." };
      }
      // The mint (accts[3]) is commonly ALT-resolved (see pubkeyAt's note) — checked when static,
      // skipped (never refused) when not, same as the route instruction's own mint slots below.
      //
      // ⚠️ Frontier review round 31b, P2, check 13 — the ATA ITSELF (accts[1], the account this
      // instruction actually opens) is NOT the mint slot and gets no such leniency: it is unique
      // per user, exactly like the wallet's own wSOL ATA and transfer authority elsewhere in this
      // file (pubkeyAt's own note), so it is never legitimately ALT-resolved on a real Jupiter
      // build. The old "checked when static, skipped when not" treatment let an ALT-resolved ATA
      // dodge BOTH the right-account check below AND the one-per-ATA duplicate count — refusing
      // outright here closes both at once.
      if (!ata.isStatic) {
        return { ok: false, reason: "This transaction opens a token account whose address can't be verified." };
      }
      if (!ataOk(ata.addr, inAtas) && !ataOk(ata.addr, outAtas)) {
        return { ok: false, reason: "This transaction opens a token account that is not the one this swap needs." };
      }
      // Round 31 fix 9 — at most one create per target ATA address (i.e. per mint this swap
      // actually touches).
      if (createdAtas.has(ata.addr)) {
        return { ok: false, reason: "This transaction opens the same token account more than once." };
      }
      createdAtas.add(ata.addr);
      continue;
    }

    if (pid === TOKEN_PROGRAM_ID || pid === TOKEN_2022_PROGRAM_ID) {
      if (data.length === 1 && data[0] === 17) { // SyncNative
        const acct = pubkeyAt(keys, accts[0]);
        if (!acct.isStatic || !ataOk(acct.addr, wsolAtas)) {
          return { ok: false, reason: "This transaction syncs a token account that is not your wrapped-SOL account." };
        }
        syncNativeCount++;
        if (syncNativeCount > 1) return { ok: false, reason: "This transaction syncs your wrapped-SOL account more than once." };
        continue;
      }
      if (data.length === 1 && data[0] === 9) { // CloseAccount
        if (accts.length < 3) return { ok: false, reason: "This transaction closes a token account in a way the app does not recognise." };
        const acct = pubkeyAt(keys, accts[0]);
        const dest = pubkeyAt(keys, accts[1]);
        const owner = pubkeyAt(keys, accts[2]);
        if (!acct.isStatic || !ataOk(acct.addr, wsolAtas)) {
          return { ok: false, reason: "This transaction closes a token account that is not your wrapped-SOL account." };
        }
        if (!dest.isStatic || dest.addr !== liveAddress || !owner.isStatic || owner.addr !== liveAddress) {
          return { ok: false, reason: "This transaction closes a token account to or for a different account than the one connected." };
        }
        closeAccountCount++;
        if (closeAccountCount > 1) return { ok: false, reason: "This transaction closes a token account more than once." };
        continue;
      }
      return { ok: false, reason: "This transaction moves tokens in a way the app does not recognise." };
    }

    if (pid === MEMO_PROGRAM_ID) continue; // never moves value

    if (pid === JUP_PROGRAM_ID) {
      // Round 31 fix 6 — count every Jupiter-program instruction before decoding its shape. A
      // second one of ANY kind (even a duplicate of the real route) refuses outright — routeTail
      // below used to simply be OVERWRITTEN by whichever came last, so a second, unrelated swap
      // instruction rode along unnoticed as long as the last one matched the quote.
      jupRouteCount++;
      if (jupRouteCount > 1) return { ok: false, reason: "This transaction includes more than one swap instruction." };
      const disc = bytesToHex(data.slice(0, 8));
      const kind = ROUTE_DISCRIMINATORS[disc];
      if (!kind) return { ok: false, reason: "This transaction calls the swap program in a way the app does not recognise." };
      if (EXACT_OUT_KINDS.has(kind)) return { ok: false, reason: "This app does not support exact-output swaps." };
      if (data.length < ROUTE_TAIL_LEN) return { ok: false, reason: "Could not read the swap instruction's amounts." };

      // ⚠️ Round 30 — bind each named account by the IDL's own order
      // (github.com/jup-ag/instruction-parser "jupiter.ts"). user_transfer_authority, the user's
      // own source/destination token accounts, and platform_fee_account are all STATIC in every
      // real build (they're unique to this user, per pubkeyAt's note) — refused as "route account
      // not static" if not. sourceMint/destinationMint are commonly ALT-resolved (confirmed
      // against the recorded fixture: BOTH mint slots there point into a lookup table even for a
      // plain SOL->SKR trade) and are only checked when static.
      let authorityIdx, sourceTokenIdx, destTokenIdx, sourceMintIdx, destMintIdx, feeAcctIdx, token2022Idx;
      if (kind === "route") {
        // [tokenProgram, userTransferAuthority, userSourceTokenAccount, userDestinationTokenAccount,
        //  destinationTokenAccount(optional), destinationMint, platformFeeAccount(optional)]
        authorityIdx = accts[1]; sourceTokenIdx = accts[2]; destTokenIdx = accts[3];
        destMintIdx = accts[5]; feeAcctIdx = accts[6];
        // ⚠️ Frontier review round 31b, P0, check 11 — slot 4 (`destinationTokenAccount`,
        // OPTIONAL) was never checked at all: a compromised response could leave slot 3
        // (`userDestinationTokenAccount`) pointing at the user's real ATA — passing every check
        // above — while routing the actual output through slot 4 to an attacker's account. There
        // is exactly one legitimate value here: Anchor's own "absent" sentinel, the executing
        // program's own id (same convention as `platform_fee_account`/`token2022Program` below).
        // Never "skip when unverifiable" like the mint slots — an ALT-resolved slot 4 refuses too.
        const destTokenAccountOpt = pubkeyAt(keys, accts[4]);
        if (!destTokenAccountOpt.isStatic || destTokenAccountOpt.addr !== JUP_PROGRAM_ID) {
          return { ok: false, reason: "This transaction includes an unexpected destination token account." };
        }
      } else { // shared_accounts_route
        // [tokenProgram, programAuthority, userTransferAuthority, sourceTokenAccount,
        //  programSourceTokenAccount, programDestinationTokenAccount, destinationTokenAccount,
        //  sourceMint, destinationMint, platformFeeAccount(optional), token2022Program(optional)]
        authorityIdx = accts[2]; sourceTokenIdx = accts[3]; destTokenIdx = accts[6];
        sourceMintIdx = accts[7]; destMintIdx = accts[8]; feeAcctIdx = accts[9]; token2022Idx = accts[10];
      }

      const authority = pubkeyAt(keys, authorityIdx);
      if (!authority.isStatic) return { ok: false, reason: "route account not static: user_transfer_authority." };
      if (authority.addr !== liveAddress) {
        return { ok: false, reason: "This swap is authorised by a different account than the one connected." };
      }

      const sourceTok = pubkeyAt(keys, sourceTokenIdx);
      if (!sourceTok.isStatic) return { ok: false, reason: "route account not static: user_source_token_account." };
      const sourceExpected = inputIsSol ? wsolAtas : inAtas;
      if (!ataOk(sourceTok.addr, sourceExpected)) {
        return { ok: false, reason: "This swap pays from a token account that is not yours." };
      }

      const destTok = pubkeyAt(keys, destTokenIdx);
      if (!destTok.isStatic) return { ok: false, reason: "route account not static: user_destination_token_account." };
      if (!ataOk(destTok.addr, outAtas)) {
        return { ok: false, reason: "This swap pays out to a token account that is not yours." };
      }

      if (sourceMintIdx != null) {
        const sm = pubkeyAt(keys, sourceMintIdx);
        if (sm.isStatic && sm.addr !== inputMint) {
          return { ok: false, reason: "This swap's source mint does not match the quote you saw." };
        }
      }
      if (destMintIdx != null) {
        const dm = pubkeyAt(keys, destMintIdx);
        if (dm.isStatic && dm.addr !== outputMint) {
          return { ok: false, reason: "This swap's destination mint does not match the quote you saw." };
        }
      }
      // platform_fee_account / token2022Program are optional-with-default: Anchor's own sentinel
      // for "absent" is the executing program's own id (confirmed against the fixture: both
      // slots there equal JUP6Lk…, i.e. the Jupiter program id itself). Any OTHER static value
      // is an unexpected account; an ALT-resolved value can't be confirmed as the sentinel, so it
      // refuses too — round 29 already refuses a non-zero platform_fee_bps in the trailing bytes;
      // this is the account-level half of that same guarantee.
      if (feeAcctIdx != null) {
        const fa = pubkeyAt(keys, feeAcctIdx);
        if (!fa.isStatic || fa.addr !== JUP_PROGRAM_ID) {
          return { ok: false, reason: "This transaction includes a fee account we do not expect." };
        }
      }
      if (token2022Idx != null) {
        const t2 = pubkeyAt(keys, token2022Idx);
        if (!t2.isStatic || t2.addr !== JUP_PROGRAM_ID) {
          return { ok: false, reason: "This transaction routes through a token program we do not expect." };
        }
      }

      routeTail = data.slice(data.length - ROUTE_TAIL_LEN);
      routeKind = kind;
      continue;
    }

    // Unreachable — every allowlisted program id is handled above — but never silently accept.
    return { ok: false, reason: "This transaction calls a program the app does not recognise." };
  }

  // Round 31 fix 7 — enforced ONCE, transaction-wide, against the SUM of every System transfer
  // seen above (each already proven to be live-wallet -> live-wallet's-own-wSOL-ATA, and to only
  // exist at all when the quote's input is SOL). This is Codex's exact exploit: two transfers,
  // each individually under the cap, summing past it.
  {
    const cap = inputIsSol && quote.inAmount != null ? BigInt(String(quote.inAmount)) : 0n;
    if (systemTransferSum > cap) {
      return { ok: false, reason: "This transaction moves more SOL than the quote you saw." };
    }
  }

  if (!routeTail) return { ok: false, reason: "Could not find the swap instruction to verify." };

  const inAmount = readU64LE(routeTail, 0);
  const quotedOutAmount = readU64LE(routeTail, 8);
  const slippageBps = readU16LE(routeTail, 16);
  const platformFeeBps = routeTail[18];

  if (String(inAmount) !== String(quote.inAmount)) {
    return { ok: false, reason: "The amount in this transaction does not match the quote you saw." };
  }
  if (String(quotedOutAmount) !== String(quote.outAmount)) {
    return { ok: false, reason: "The amount you'd receive does not match the quote you saw." };
  }
  if (Number(slippageBps) !== Number(quote.slippageBps)) {
    return { ok: false, reason: "The slippage in this transaction does not match the quote you saw." };
  }
  if (platformFeeBps !== 0) {
    return { ok: false, reason: "This transaction includes a fee we do not expect." };
  }

  // Round 31 fix 10 — a missing SetComputeUnitLimit/Price is NOT a zero-fee transaction; Solana
  // applies a runtime default (solana.com/docs/core/fees/fee-structure, "Compute Budget"): with no
  // SetComputeUnitLimit, each instruction gets 200,000 CU, capped at 1,400,000 CU total for the
  // transaction; with no SetComputeUnitPrice, the price is 0 micro-lamports/CU. Codex's exploit
  // dropped the limit instruction and set an enormous price, which used to skip the ceiling check
  // entirely (it only ran when BOTH decoded values were present) — the default below makes the
  // ceiling check ALWAYS run whenever the caller passed a ceiling to check against, whether or not
  // either ComputeBudget instruction was present.
  const computeBudgetInstructionCount = cuLimitCount + cuPriceCount;
  const nonComputeBudgetInstructionCount = instructions.length - computeBudgetInstructionCount;
  const effectiveCuLimit = cuLimit != null ? cuLimit : Math.min(200000 * nonComputeBudgetInstructionCount, 1400000);
  const effectiveCuPrice = cuPriceMicroLamports != null ? cuPriceMicroLamports : 0n;
  // ⚠️ Frontier review round 31b, P1, check 12 — computed UNCONDITIONALLY now, not only when the
  // caller happens to pass a ceiling. The old code's fee math lived entirely inside the
  // `maxPriorityFeeLamports != null` guard, so a caller with no ceiling to check against (which
  // is exactly what happened whenever upstream's `prioritizationFeeLamports` was absent) got no
  // fee figure at all — nothing to display, nothing enforced. CEILING division, not truncation —
  // a fee that rounds up past the ceiling by even one lamport must still refuse. BigInt
  // throughout; `+ 999_999n` before the `/ 1_000_000n` is the standard integer-ceiling trick.
  const feeLamports = (BigInt(effectiveCuLimit) * effectiveCuPrice + 999999n) / 1000000n;
  if (maxPriorityFeeLamports != null && feeLamports > BigInt(String(maxPriorityFeeLamports))) {
    return { ok: false, reason: "This transaction's priority fee is higher than what you were shown." };
  }

  // `ataCreateCount` — how many NEW token accounts this transaction's own (already-checked,
  // already-bounded-to-one-per-ATA) instructions actually create. Frontier review round 31b item
  // 4's simulation gate (`swap-simulate.js`) uses this as its own `allowedNewAtaCount` — the SOL
  // this transaction is allowed to spend on account-creation rent is bounded by what THIS
  // transaction's instructions actually do, never a guessed or unbounded allowance.
  return { ok: true, routeKind, cuLimit, cuPriceMicroLamports, feeLamports: feeLamports.toString(), ataCreateCount: createdAtas.size };
}
