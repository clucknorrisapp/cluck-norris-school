// Cluck Norris — Seeker app, Swap pane. Fix round (PR #420, P2-1): "the transaction is never
// checked against the quote." This module is the client-side half of the fix — a pure, framework-
// free STRUCTURAL check run on the deserialized VersionedTransaction Jupiter built, immediately
// before it is handed to the wallet to sign. It never fetches, never builds, never signs; it only
// reads fields already present on an in-memory web3.js VersionedTransaction and compares them
// against the quote the person was shown.
//
// Plain browser primitives only (DataView) — no Buffer, no web3.js import of its own (this file
// never constructs a transaction, only reads one). AGENTS.md: no layout encoder in a browser page
// that needs Node's Buffer; DataView needs nothing.
//
// The four checks, each refusing (never signing) on failure:
//   1. FEE PAYER IS THE PERSON — message.staticAccountKeys[0] must equal the live connected
//      address. A transaction that debits someone else's account is not one they should sign.
//   2. EXACTLY ONE REQUIRED SIGNER — message.header.numRequiredSignatures === 1. A second
//      required signer means this transaction expects an approval beyond the one wallet prompt
//      the person is about to see.
//   3. EVERY INSTRUCTION'S PROGRAM ID IS ON THE ALLOWLIST — program ids are STATIC keys on a v0
//      transaction (docs/SEEKER_SWAP_DESIGN.md "the one technical gap"), so an instruction whose
//      program can only be resolved through an address lookup table is refused outright, never
//      trusted. The allowlist is exactly what a Jupiter swap legitimately touches: the Jupiter
//      aggregator itself, ComputeBudget, the ATA program, both SPL token programs, System, Memo.
//   4. THE JUPITER ROUTE INSTRUCTION'S OWN ARGS MATCH THE QUOTE — Jupiter's route / exact-out-
//      route / shared-accounts-route / shared-accounts-exact-out-route instructions all end with
//      the same 19-byte tail: in_amount (u64 LE), quoted_out_amount (u64 LE), slippage_bps
//      (u16 LE), platform_fee_bps (u8). This is the ONLY thing a validator actually enforces —
//      the JSON quote and the confirm-sheet numbers are cosmetic unless the bytes agree with them.
//      Confirmed against a REAL recorded swap (scripts/fixtures/seeker-swap/swap.json, decoded in
//      scripts/seeker-swap-verify-test.cjs): its instruction carries the
//      shared_accounts_route discriminator (Anchor sighash of "global:shared_accounts_route"),
//      and its trailing 19 bytes decode to exactly that fixture's own quote.json amounts.

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

// DataView over a plain, zero-offset copy (tail is already a fresh slice) — never touches Buffer.
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

// `tx` — a deserialized web3.js VersionedTransaction (message.staticAccountKeys,
//        message.header.numRequiredSignatures, message.compiledInstructions).
// `liveAddress` — the LIVE connected address, re-read immediately before this call
//        (assertSameAccount()'s return value) — never a cached/quote-time address.
// `quote` — the Jupiter quote object the person was actually shown (inAmount, outAmount,
//        slippageBps — the same object the confirm sheet's numbers come from).
// Returns { ok:true, routeKind } or { ok:false, reason:<user-facing sentence> }. Never throws —
// every failure mode returns a refusal instead, so a caller can safely do
// `if (!check.ok) throw new Error(check.reason)` right before signing.
export function verifySwapTransaction({ tx, liveAddress, quote }) {
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

  let routeTail = null, routeKind = null;
  for (const ix of instructions) {
    // Program ids are STATIC keys on a v0 transaction — an instruction whose program can only be
    // resolved through an address lookup table is refused outright, never trusted.
    if (ix.programIdIndex == null || ix.programIdIndex >= keys.length) {
      return { ok: false, reason: "This transaction calls a program the app does not recognise." };
    }
    let pid;
    try { pid = keys[ix.programIdIndex].toBase58 ? keys[ix.programIdIndex].toBase58() : String(keys[ix.programIdIndex]); }
    catch (_) { return { ok: false, reason: "This transaction calls a program the app does not recognise." }; }
    if (!SWAP_PROGRAM_ALLOWLIST.has(pid)) {
      return { ok: false, reason: "This transaction calls a program the app does not recognise." };
    }
    if (pid === JUP_PROGRAM_ID) {
      const data = asU8(ix.data);
      const disc = bytesToHex(data.slice(0, 8));
      const kind = ROUTE_DISCRIMINATORS[disc];
      if (kind && data.length >= ROUTE_TAIL_LEN) {
        routeTail = data.slice(data.length - ROUTE_TAIL_LEN);
        routeKind = kind;
      }
    }
  }

  if (!routeTail) return { ok: false, reason: "Could not find the swap instruction to verify." };
  if (!quote) return { ok: false, reason: "No quote to verify this transaction against." };

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

  return { ok: true, routeKind };
}
