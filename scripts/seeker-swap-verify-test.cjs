#!/usr/bin/env node
"use strict";
// Seeker app in-app swap — CLIENT-SIDE structural verifier (docs/SEEKER_SWAP_DESIGN.md, PR #420
// fix round P2-1 "the transaction is never checked against the quote", and Codex round 30 P1
// "the verifier checks program ids, not instruction semantics").
//
// src/seeker/swap-verify.js is pure (no window, no fetch, no signing) — this drives it directly
// against the REAL recorded fixture (scripts/fixtures/seeker-swap/swap.json), decoded with the
// real @solana/web3.js VersionedTransaction.deserialize, and then against mutated copies of the
// same bytes to prove every refusal path actually refuses. Mutations are done by editing the
// deserialized message's own `staticAccountKeys`/`compiledInstructions` arrays directly (append a
// key, append or edit an instruction) rather than recompiling through `TransactionMessage` — a
// recompile with no address lookup tables would force every originally ALT-resolved account
// (the fixture's own source/destination mints — see swap-verify.js's note on that) to become a
// NEW static key pointing at a filler value, which would trip the mint-mismatch check for a
// reason unrelated to whatever the test is actually trying to isolate.
//
// Usage: node scripts/seeker-swap-verify-test.cjs

const fs = require("fs");
const path = require("path");
const web3 = require("@solana/web3.js");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

const FIXTURE_SWAP = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "swap.json"), "utf8"));
const FIXTURE_QUOTE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "quote.json"), "utf8"));

function b64ToBytes(b64) { return new Uint8Array(Buffer.from(b64, "base64")); }

// Static account indices in the recorded fixture (scripts/fixtures/seeker-swap/swap.json), read
// by hand once and pinned here — see the account dump in this PR's comment.
const SYSTEM_IDX = 9, JUP_IDX = 11, TOKEN_IDX = 12;

function cloneMsg() { return web3.VersionedTransaction.deserialize(b64ToBytes(FIXTURE_SWAP.swapTransaction)); }
function pushKey(msg, pubkey) { msg.staticAccountKeys.push(pubkey); return msg.staticAccountKeys.length - 1; }
function systemTransferData(lamports) {
  const d = new Uint8Array(12);
  new DataView(d.buffer).setUint32(0, 2, true);
  new DataView(d.buffer).setBigUint64(4, BigInt(lamports), true);
  return d;
}
function tokenTransferData(amount) {
  const d = new Uint8Array(9);
  d[0] = 3; // Transfer
  new DataView(d.buffer).setBigUint64(1, BigInt(amount), true);
  return d;
}

(async () => {
  console.log("\nSeeker swap — client-side structural verifier (swap-verify.js)\n");

  const mod = await import(path.join(ROOT, "src", "seeker", "swap-verify.js") + "?t=" + Date.now());
  const { verifySwapTransaction, ROUTE_DISCRIMINATORS, SWAP_PROGRAM_ALLOWLIST, MAX_PRIORITY_FEE_LAMPORTS } = mod;

  const realBytes = b64ToBytes(FIXTURE_SWAP.swapTransaction);
  const realTx = web3.VersionedTransaction.deserialize(realBytes);
  const liveAddress = realTx.message.staticAccountKeys[0].toBase58();
  ok("fixture's static account map matches the indices this file pins",
    realTx.message.staticAccountKeys[SYSTEM_IDX].toBase58() === "11111111111111111111111111111111"
    && realTx.message.staticAccountKeys[JUP_IDX].toBase58() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
    && realTx.message.staticAccountKeys[TOKEN_IDX].toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("(1) the real recorded fixture — every check must pass\n");
  {
    ok("real tx is version 0", realTx.version === 0);
    ok("real tx has exactly 1 required signature", realTx.message.header.numRequiredSignatures === 1);

    const routeIxs = realTx.message.compiledInstructions.filter((ix) => {
      const pid = realTx.message.staticAccountKeys[ix.programIdIndex];
      return pid && pid.toBase58() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    });
    ok("the fixture's instructions include exactly one Jupiter aggregator call", routeIxs.length === 1, routeIxs.length);
    const discHex = Buffer.from(routeIxs[0].data.slice(0, 8)).toString("hex");
    ok("⚠️ its discriminator is shared_accounts_route (c1209b3341d69c81) — sha256('global:shared_accounts_route')[:8]",
      discHex === "c1209b3341d69c81" && ROUTE_DISCRIMINATORS[discHex] === "shared_accounts_route", discHex);

    const tail = routeIxs[0].data.slice(routeIxs[0].data.length - 19);
    const inAmt = Buffer.from(tail.slice(0, 8)).readBigUInt64LE(0);
    const outAmt = Buffer.from(tail.slice(8, 16)).readBigUInt64LE(0);
    const slip = Buffer.from(tail.slice(16, 18)).readUInt16LE(0);
    const feeBps = tail[18];
    ok("its trailing 19 bytes decode to the fixture quote's own in_amount", String(inAmt) === FIXTURE_QUOTE.inAmount, String(inAmt));
    ok("…and quoted_out_amount", String(outAmt) === FIXTURE_QUOTE.outAmount, String(outAmt));
    ok("…and slippage_bps", slip === FIXTURE_QUOTE.slippageBps, slip);
    ok("…and platform_fee_bps = 0 (no platform fee, owner 2026-09-24)", feeBps === 0, feeBps);

    for (const ix of realTx.message.compiledInstructions) {
      const pid = realTx.message.staticAccountKeys[ix.programIdIndex];
      ok(`every real instruction's program (${pid ? pid.toBase58() : "?"}) is on the allowlist`, !!pid && SWAP_PROGRAM_ALLOWLIST.has(pid.toBase58()));
    }

    // Round 30: the fixture's own top-level shapes — pinned here so a future change to the
    // allowlist/decoder can be checked against what a REAL Jupiter build actually contains,
    // rather than only against invented cases. ComputeBudget×2 (limit, price), ATA
    // CreateIdempotent×2 (wSOL ATA, output ATA), System Transfer×1 (SOL->wSOL wrap), Token
    // SyncNative×1, the Jupiter shared_accounts_route×1, Token CloseAccount×1 (unwrap the
    // leftover wSOL ATA). No Memo, no ATA "Create" (non-idempotent), no `route`/exact-out kind.
    const shapes = realTx.message.compiledInstructions.map((ix) => {
      const pid = realTx.message.staticAccountKeys[ix.programIdIndex].toBase58();
      return pid + ":" + Buffer.from(ix.data.slice(0, Math.min(8, ix.data.length))).toString("hex");
    });
    ok("the fixture contains exactly 8 top-level instructions", shapes.length === 8, shapes);

    const check = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
    ok("verifySwapTransaction PASSES the real, untouched fixture against its own quote", check.ok === true, check);
    ok("…and reports the route kind it found", check.routeKind === "shared_accounts_route", check);
    ok("…and decodes the compute budget instructions", check.cuLimit === 1400000 && check.cuPriceMicroLamports === 315258n, check);

    // Round 30 fix 6 / round 31 fix 10 — a ceiling at or above the real fee passes; below it
    // refuses. The verifier computes the fee with CEILING division (round 31): 1,400,000 *
    // 315,258 / 1e6 = 441,361.2 exactly, which rounds UP to 441,362 lamports — never truncated to
    // 441,361 (that truncation is the exact off-by-one Codex's round-up exploit relies on).
    const realFeeLamports = (BigInt(check.cuLimit) * check.cuPriceMicroLamports + 999999n) / 1000000n; // ceil(441,361.2) = 441,362
    ok("the ceiling-divided real fee is 441362, not the truncated 441361", realFeeLamports === 441362n, realFeeLamports);
    const okCeil = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: String(realFeeLamports) });
    ok("a priority-fee ceiling >= the real (ceiling-divided) fee -> still passes", okCeil.ok === true, okCeil);
    const tooLow = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: String(realFeeLamports - 1n) });
    ok("a priority-fee ceiling 1 lamport below the real fee -> refused", tooLow.ok === false && /priority fee/i.test(tooLow.reason), tooLow);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(2) refusals — each mutation must be caught, never signed\n");
  {
    const wrongLive = "11111111111111111111111111111112"; // real-shaped, not the actual fee payer
    const r1 = verifySwapTransaction({ tx: realTx, liveAddress: wrongLive, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
    ok("wrong fee payer (stale/switched account) -> refused", r1.ok === false && /different account/i.test(r1.reason), r1);

    // Round 30: lowering quote.inAmount now trips the SOL-wrap System-transfer cap (its own
    // instruction, processed earlier in the loop) before the route tail is even reached — a
    // DIFFERENT but equally correct refusal reason than round 29's single check.
    const badQuoteIn = Object.assign({}, FIXTURE_QUOTE, { inAmount: "1" });
    const r2 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteIn, PublicKeyClass: web3.PublicKey });
    ok("altered quote.inAmount vs the tx's own bytes -> refused", r2.ok === false && /(amount in this transaction|more sol than the quote)/i.test(r2.reason), r2);

    const badQuoteOut = Object.assign({}, FIXTURE_QUOTE, { outAmount: "999999999" });
    const r3 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteOut, PublicKeyClass: web3.PublicKey });
    ok("altered quote.outAmount -> refused", r3.ok === false && /you'd receive/i.test(r3.reason), r3);

    const badQuoteSlip = Object.assign({}, FIXTURE_QUOTE, { slippageBps: 300 });
    const r4 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteSlip, PublicKeyClass: web3.PublicKey });
    ok("altered quote.slippageBps -> refused", r4.ok === false && /slippage/i.test(r4.reason), r4);

    // Extra unrecognised program: append a new static key + a new instruction directly onto a
    // clone's message — every original instruction/account stays untouched (see the file header).
    {
      const clone = cloneMsg();
      const evilProgram = web3.Keypair.generate().publicKey;
      const evilIdx = pushKey(clone.message, evilProgram);
      clone.message.compiledInstructions.push({ programIdIndex: evilIdx, accountKeyIndexes: [], data: new Uint8Array([1, 2, 3]) });
      const r5 = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("an extra instruction calling an unrecognised program -> refused", r5.ok === false && /program the app does not recognise/i.test(r5.reason), r5);
    }

    // Non-zero platform fee in the route instruction's own trailing byte.
    {
      const routeIdx = realTx.message.compiledInstructions.findIndex((ix) => ix.programIdIndex === JUP_IDX);
      const clone = cloneMsg();
      const data = Buffer.from(clone.message.compiledInstructions[routeIdx].data);
      data[data.length - 1] = 5; // platform_fee_bps -> 5
      clone.message.compiledInstructions[routeIdx].data = new Uint8Array(data);
      const r6 = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("a non-zero platform_fee_bps encoded in the instruction -> refused", r6.ok === false && /fee we do not expect/i.test(r6.reason), r6);
    }

    const r7 = verifySwapTransaction({ tx: null, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
    ok("no transaction -> refused, never throws", r7.ok === false);
    const r8 = verifySwapTransaction({ tx: realTx, liveAddress, quote: null, PublicKeyClass: web3.PublicKey });
    ok("no quote to check against -> refused, never throws", r8.ok === false);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(3) Codex round 30, P1 — instruction SEMANTICS, not just program ids\n");
  {
    // Codex's exact exploit: append a System transfer of 1 SOL to a brand-new recipient. System
    // is (correctly) allowlisted for the SOL-wrap step — round 29's program-id-only check let
    // this straight through. Round 30 decodes the instruction itself.
    {
      const clone = cloneMsg();
      const strangerIdx = pushKey(clone.message, web3.Keypair.generate().publicKey);
      clone.message.compiledInstructions.push({ programIdIndex: SYSTEM_IDX, accountKeyIndexes: [0, strangerIdx], data: systemTransferData(1_000_000_000) });
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("Codex's exploit — an appended System transfer of 1 SOL to a stranger -> refused, never signed",
        r.ok === false && /not yours/i.test(r.reason), r);
    }

    // A Token `Transfer` appended at top level — never legitimate in a swap this pane builds.
    {
      const clone = cloneMsg();
      const strangerIdx = pushKey(clone.message, web3.Keypair.generate().publicKey);
      clone.message.compiledInstructions.push({ programIdIndex: TOKEN_IDX, accountKeyIndexes: [6, strangerIdx, 0], data: tokenTransferData(1_000_000) });
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("an appended Token `Transfer` -> refused", r.ok === false && /does not recognise/i.test(r.reason), r);
    }

    // The SOL-wrap System transfer redirected to a NON-ATA (a stranger's plain account).
    {
      const clone = cloneMsg();
      const strangerIdx = pushKey(clone.message, web3.Keypair.generate().publicKey);
      const sysIx = clone.message.compiledInstructions.findIndex((ix) => ix.programIdIndex === SYSTEM_IDX);
      clone.message.compiledInstructions[sysIx].accountKeyIndexes = [0, strangerIdx];
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("the wSOL-wrap transfer redirected to a non-ATA stranger -> refused", r.ok === false && /not yours/i.test(r.reason), r);
    }

    // CloseAccount whose destination is a stranger, not the connected wallet.
    {
      const clone = cloneMsg();
      const strangerIdx = pushKey(clone.message, web3.Keypair.generate().publicKey);
      const closeIx = clone.message.compiledInstructions.findIndex((ix) => ix.programIdIndex === TOKEN_IDX && ix.data.length === 1 && ix.data[0] === 9);
      const accts = clone.message.compiledInstructions[closeIx].accountKeyIndexes;
      clone.message.compiledInstructions[closeIx].accountKeyIndexes = [accts[0], strangerIdx, accts[2]];
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("CloseAccount's destination redirected to a stranger -> refused", r.ok === false && /different account/i.test(r.reason), r);
    }

    // The recorded fixture still passes, untouched (also checked in section 1 — restated here
    // next to its exploit siblings so this section stands on its own).
    {
      const r = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("the untouched recorded fixture still passes", r.ok === true, r);
    }

    // The route instruction's own user_destination_token_account swapped to a stranger's ATA.
    {
      const clone = cloneMsg();
      const strangerIdx = pushKey(clone.message, web3.Keypair.generate().publicKey);
      const routeIx = clone.message.compiledInstructions.findIndex((ix) => ix.programIdIndex === JUP_IDX);
      clone.message.compiledInstructions[routeIx].accountKeyIndexes[6] = strangerIdx; // shared_accounts_route's destinationTokenAccount slot
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("the route's user_destination_token_account swapped to a stranger's ATA -> refused", r.ok === false && /not yours/i.test(r.reason), r);
    }

    // Round 30 fix 4 — ExactOut discriminators refuse outright, even with an otherwise-untouched
    // account layout and a tail that would decode cleanly.
    {
      const clone = cloneMsg();
      const routeIx = clone.message.compiledInstructions.findIndex((ix) => ix.programIdIndex === JUP_IDX);
      const data = Buffer.from(clone.message.compiledInstructions[routeIx].data);
      Buffer.from("b0d169a89a7d453e", "hex").copy(data, 0); // shared_accounts_exact_out_route
      clone.message.compiledInstructions[routeIx].data = new Uint8Array(data);
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("an ExactOut discriminator -> refused, never decoded as ExactIn", r.ok === false && /exact-output/i.test(r.reason), r);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(4) Codex round 31, P1 — repeated instructions must not sum past what was approved\n");
  {
    // Codex's exact exploit case #1: duplicate the fixture's Jupiter route instruction. Round 30
    // only overwrote `routeTail` with whichever route instruction came last, so a second swap
    // instruction rode along unnoticed. Round 31 refuses on the SECOND Jupiter-program
    // instruction, before it is even decoded.
    {
      const clone = cloneMsg();
      const routeIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === JUP_IDX);
      clone.message.compiledInstructions.push(Object.assign({}, routeIx, { accountKeyIndexes: routeIx.accountKeyIndexes.slice(), data: Uint8Array.from(routeIx.data) }));
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("Codex's exploit — a duplicated Jupiter route instruction -> refused, never signed",
        r.ok === false && /more than one swap instruction/i.test(r.reason), r);
    }

    // Codex's exact exploit case #2: two wrap transfers, EACH individually at or below the
    // quote's inAmount, but SUMMING above it. The fixture's own real transfer already moves the
    // full 10,000,000-lamport cap, so appending even a 1-lamport second transfer to the same
    // wSOL ATA must refuse on the transaction-wide sum, never pass because each instruction on
    // its own looked fine.
    {
      const clone = cloneMsg();
      const sysIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === SYSTEM_IDX);
      clone.message.compiledInstructions.push({ programIdIndex: SYSTEM_IDX, accountKeyIndexes: sysIx.accountKeyIndexes.slice(), data: systemTransferData(1) });
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("Codex's exploit — two wrap transfers each <= inAmount but SUMMING above it -> refused",
        r.ok === false && /more sol than the quote/i.test(r.reason), r);
    }

    // A System transfer at all, when the quote's input is NOT SOL. The fixture's own FIRST ATA
    // create (the wSOL ATA, ahead of the System transfer in instruction order) is removed so the
    // check under test — the System transfer itself — is the first thing that can disagree with a
    // non-SOL-input quote, rather than the unrelated ATA-mint check firing first.
    {
      const clone = cloneMsg();
      const firstAtaIdx = clone.message.compiledInstructions.findIndex((ix) => clone.message.staticAccountKeys[ix.programIdIndex].toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
      clone.message.compiledInstructions.splice(firstAtaIdx, 1);
      const nonSolQuote = Object.assign({}, FIXTURE_QUOTE, { inputMint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3" });
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: nonSolQuote, PublicKeyClass: web3.PublicKey });
      ok("a System transfer present when the quote's input is not SOL -> refused",
        r.ok === false && /not swap from sol/i.test(r.reason), r);
    }

    // More than one SyncNative.
    {
      const clone = cloneMsg();
      const syncIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === TOKEN_IDX && ix.data.length === 1 && ix.data[0] === 17);
      clone.message.compiledInstructions.push(Object.assign({}, syncIx, { accountKeyIndexes: syncIx.accountKeyIndexes.slice(), data: Uint8Array.from(syncIx.data) }));
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("more than one SyncNative -> refused", r.ok === false && /more than once/i.test(r.reason), r);
    }

    // More than one CloseAccount.
    {
      const clone = cloneMsg();
      const closeIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === TOKEN_IDX && ix.data.length === 1 && ix.data[0] === 9);
      clone.message.compiledInstructions.push(Object.assign({}, closeIx, { accountKeyIndexes: closeIx.accountKeyIndexes.slice(), data: Uint8Array.from(closeIx.data) }));
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("more than one CloseAccount -> refused", r.ok === false && /more than once/i.test(r.reason), r);
    }

    // More than one ATA create for the same target ATA.
    {
      const clone = cloneMsg();
      const ataIx = clone.message.compiledInstructions.find((ix) => clone.message.staticAccountKeys[ix.programIdIndex].toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
      clone.message.compiledInstructions.push(Object.assign({}, ataIx, { accountKeyIndexes: ataIx.accountKeyIndexes.slice(), data: Uint8Array.from(ataIx.data) }));
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("more than one ATA create for the same mint -> refused", r.ok === false && /more than once/i.test(r.reason), r);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(5) Codex round 31, P1 — a missing SetComputeUnitLimit is not a zero-fee transaction\n");
  {
    // Codex's exact exploit: remove SetComputeUnitLimit, set SetComputeUnitPrice to
    // 1,000,000,000 micro-lamports/CU. The OLD code skipped the ceiling check entirely because
    // cuLimit was null. The runtime default (7 instructions remain, 1 is the remaining
    // ComputeBudget instruction -> 6 non-ComputeBudget instructions * 200,000 CU = 1,200,000 CU)
    // makes the ceiling check run: 1,200,000 CU * 1e9 micro-lamports/CU / 1e6 = 1,200,000,000
    // lamports, nowhere near the 1,000,000-lamport ceiling passed below -> refused.
    {
      const clone = cloneMsg();
      const limitIdx = clone.message.compiledInstructions.findIndex((ix) => {
        const pid = clone.message.staticAccountKeys[ix.programIdIndex].toBase58();
        return pid === "ComputeBudget111111111111111111111111111111" && ix.data.length === 5 && ix.data[0] === 2;
      });
      clone.message.compiledInstructions.splice(limitIdx, 1);
      const priceIdx = clone.message.compiledInstructions.findIndex((ix) => {
        const pid = clone.message.staticAccountKeys[ix.programIdIndex].toBase58();
        return pid === "ComputeBudget111111111111111111111111111111" && ix.data.length === 9 && ix.data[0] === 3;
      });
      const priceData = new Uint8Array(9);
      priceData[0] = 3;
      new DataView(priceData.buffer).setBigUint64(1, 1000000000n, true); // 1e9 micro-lamports/CU
      clone.message.compiledInstructions[priceIdx].data = priceData;
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: "1000000" });
      ok("Codex's exploit — dropped compute-unit limit + huge price -> the runtime default still catches it, refused",
        r.ok === false && /priority fee/i.test(r.reason), r);
    }

    // A fee that rounds UP over the ceiling by exactly one lamport, with both instructions
    // present (the recorded fixture's own cuLimit/cuPrice: 1,400,000 * 315,258 / 1e6 =
    // 441,361.2 exactly -> ceils to 441,362, never truncates to 441,361).
    {
      const r = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: "441361" });
      ok("a fee that rounds up past the ceiling by one lamport -> refused", r.ok === false && /priority fee/i.test(r.reason), r);
    }

    // The recorded fixture, exactly as recorded — still passes.
    {
      const r = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: "441362" });
      ok("the untouched recorded fixture at its own ceiling -> passes", r.ok === true, r);
    }

    // More than one SetComputeUnitLimit.
    {
      const clone = cloneMsg();
      const limitIx = clone.message.compiledInstructions.find((ix) => {
        const pid = clone.message.staticAccountKeys[ix.programIdIndex].toBase58();
        return pid === "ComputeBudget111111111111111111111111111111" && ix.data.length === 5 && ix.data[0] === 2;
      });
      clone.message.compiledInstructions.push(Object.assign({}, limitIx, { accountKeyIndexes: limitIx.accountKeyIndexes.slice(), data: Uint8Array.from(limitIx.data) }));
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("more than one SetComputeUnitLimit -> refused", r.ok === false && /more than once/i.test(r.reason), r);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(6) Frontier review round 31b, P0, check 11 — the non-shared `route` kind's slot 4 (destination_token_account)\n");
  {
    // The recorded fixture uses shared_accounts_route, so a `route`-kind happy path and its
    // exploit are both built by hand from it — same technique the file header describes for
    // section (3)'s exploits: edit the deserialized message directly, never recompile through
    // TransactionMessage (that would force the ALT-resolved mint slots to become new static
    // fillers and trip an unrelated check).
    //
    // shared_accounts_route's own account order: [tokenProgram, programAuthority,
    // userTransferAuthority, sourceTokenAccount, programSourceTokenAccount,
    // programDestinationTokenAccount, destinationTokenAccount, sourceMint, destinationMint,
    // platformFeeAccount, token2022Program]. `route`'s account order: [tokenProgram,
    // userTransferAuthority, userSourceTokenAccount, userDestinationTokenAccount,
    // destinationTokenAccount(optional), destinationMint, platformFeeAccount(optional)].
    function buildRouteVariant(slot4Idx) {
      const clone = cloneMsg();
      const routeIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === JUP_IDX);
      const a = routeIx.accountKeyIndexes;
      const rest = a.slice(11); // anything shared_accounts_route carried past its own 11 named slots
      routeIx.accountKeyIndexes = [a[0], a[2], a[3], a[6], slot4Idx, a[8], a[9], ...rest];
      const data = Buffer.from(routeIx.data);
      Buffer.from("e517cb977ae3ad2a", "hex").copy(data, 0); // the `route` discriminator
      routeIx.data = new Uint8Array(data);
      return clone;
    }

    // Happy path: slot 4 = the Jupiter program id's own static index (the Anchor "absent"
    // sentinel) — a well-formed `route` transaction must still pass.
    {
      const clone = buildRouteVariant(JUP_IDX);
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("a well-formed `route`-kind transaction, slot 4 = the absent sentinel -> passes", r.ok === true && r.routeKind === "route", r);
    }

    // Codex's/the frontier review's exact exploit: slot 4 = a stranger's account, while slot 3
    // (the user's real destination ATA — the one every earlier check bound and passed) is
    // untouched. `buildRouteVariant` needs the stranger key pushed onto the SAME clone it edits,
    // so push it first and pass its index in.
    {
      const clone = cloneMsg();
      const stranger = clone.message.staticAccountKeys.length;
      clone.message.staticAccountKeys.push(web3.Keypair.generate().publicKey);
      const routeIx = clone.message.compiledInstructions.find((ix) => ix.programIdIndex === JUP_IDX);
      const a = routeIx.accountKeyIndexes;
      const rest = a.slice(11);
      routeIx.accountKeyIndexes = [a[0], a[2], a[3], a[6], stranger, a[8], a[9], ...rest];
      const data = Buffer.from(routeIx.data);
      Buffer.from("e517cb977ae3ad2a", "hex").copy(data, 0);
      routeIx.data = new Uint8Array(data);
      const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
      ok("the exploit — `route`'s slot 4 (destination_token_account) set to a stranger's account, while slot 3 (the user's real ATA) is untouched -> refused, never signed",
        r.ok === false && /unexpected destination token account/i.test(r.reason), r);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(7) Frontier review round 31b, P2, check 13 — ALT-resolved ATA creates must refuse, never skip\n");
  {
    // The frontier review's exact PoC: 5 extra ATA-create instructions whose ATA slot resolves
    // into ALT range (an index past the end of staticAccountKeys) — the old code SKIPPED both the
    // right-account check and the one-per-ATA count for a non-static ATA; now it refuses outright.
    const clone = cloneMsg();
    const ataIx = clone.message.compiledInstructions.find((ix) => clone.message.staticAccountKeys[ix.programIdIndex].toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const altBase = clone.message.staticAccountKeys.length + 1; // one past the end -> ALT range
    for (let k = 0; k < 5; k++) {
      clone.message.compiledInstructions.unshift({
        programIdIndex: ataIx.programIdIndex,
        accountKeyIndexes: [ataIx.accountKeyIndexes[0], altBase + k, ...ataIx.accountKeyIndexes.slice(2)],
        data: new Uint8Array([1]),
      });
    }
    const r = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey });
    ok("5 extra ALT-resolved ATA creates -> refused, never silently skipped", r.ok === false && /can't be verified/i.test(r.reason), r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(8) Codex round 32 — the pane's OWN path (response -> computed/displayed fee -> verifier), one integration test\n");
  {
    // buildConfirmData()'s step: verify at sheet-open time with the HARD constant ceiling.
    const step1 = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: MAX_PRIORITY_FEE_LAMPORTS });
    ok("step 1 (sheet-open, ceiling = the hard MAX_PRIORITY_FEE_LAMPORTS constant) -> ok, the real fixture is never refused",
      step1.ok === true, step1);
    ok("step 1 returns the CEILING-rounded computed fee (441,362), not upstream's own truncated prioritizationFeeLamports (441,361)",
      step1.feeLamports === "441362" && step1.feeLamports !== String(FIXTURE_SWAP.prioritizationFeeLamports), step1);

    // build()'s step: verify AGAIN, at sign time, using the SAME number step 1 already computed
    // and (per Swap.jsx) displayed on the confirm sheet — the number must never reject itself.
    const step2 = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: step1.feeLamports });
    ok("step 2 (sign time, ceiling = step 1's own displayed feeLamports) -> ok — the pane's real fixture swap succeeds end to end",
      step2.ok === true, step2);

    // Codex round 32's bug, reproduced directly: passing upstream's raw, truncated
    // `prioritizationFeeLamports` (441,361) as the ceiling — what the pane used to do — refuses
    // the verifier's own correctly ceiling-rounded fee (441,362) on this exact real fixture. This
    // is the failure the fix above closes; it must still reproduce here so nobody "fixes" it back.
    const bugRepro = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE, PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: FIXTURE_SWAP.prioritizationFeeLamports });
    ok("Codex round 32's bug, reproduced: upstream's raw truncated fee as the ceiling -> refuses the pane's own real fixture (proves the fix matters)",
      bugRepro.ok === false && /priority fee/i.test(bugRepro.reason), bugRepro);
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
