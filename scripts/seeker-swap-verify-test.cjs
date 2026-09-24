#!/usr/bin/env node
"use strict";
// Seeker app in-app swap — CLIENT-SIDE structural verifier (docs/SEEKER_SWAP_DESIGN.md, PR #420
// fix round P2-1: "the transaction is never checked against the quote").
//
// src/seeker/swap-verify.js is pure (no window, no fetch, no signing) — this drives it directly
// against the REAL recorded fixture (scripts/fixtures/seeker-swap/swap.json), decoded with the
// real @solana/web3.js VersionedTransaction.deserialize, and then against mutated copies of the
// same bytes to prove every refusal path actually refuses.
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
function bytesToB64(bytes) { return Buffer.from(bytes).toString("base64"); }

(async () => {
  console.log("\nSeeker swap — client-side structural verifier (swap-verify.js)\n");

  const mod = await import(path.join(ROOT, "src", "seeker", "swap-verify.js") + "?t=" + Date.now());
  const { verifySwapTransaction, ROUTE_DISCRIMINATORS, SWAP_PROGRAM_ALLOWLIST } = mod;

  const realBytes = b64ToBytes(FIXTURE_SWAP.swapTransaction);
  const realTx = web3.VersionedTransaction.deserialize(realBytes);
  const liveAddress = realTx.message.staticAccountKeys[0].toBase58();

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

    const check = verifySwapTransaction({ tx: realTx, liveAddress, quote: FIXTURE_QUOTE });
    ok("verifySwapTransaction PASSES the real, untouched fixture against its own quote", check.ok === true, check);
    ok("…and reports the route kind it found", check.routeKind === "shared_accounts_route", check);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(2) refusals — each mutation must be caught, never signed\n");
  {
    const wrongLive = "11111111111111111111111111111112"; // real-shaped, not the actual fee payer
    const r1 = verifySwapTransaction({ tx: realTx, liveAddress: wrongLive, quote: FIXTURE_QUOTE });
    ok("wrong fee payer (stale/switched account) -> refused", r1.ok === false && /different account/i.test(r1.reason), r1);

    const badQuoteIn = Object.assign({}, FIXTURE_QUOTE, { inAmount: "1" });
    const r2 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteIn });
    ok("altered quote.inAmount vs the tx's own bytes -> refused", r2.ok === false && /amount in this transaction/i.test(r2.reason), r2);

    const badQuoteOut = Object.assign({}, FIXTURE_QUOTE, { outAmount: "999999999" });
    const r3 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteOut });
    ok("altered quote.outAmount -> refused", r3.ok === false && /you'd receive/i.test(r3.reason), r3);

    const badQuoteSlip = Object.assign({}, FIXTURE_QUOTE, { slippageBps: 300 });
    const r4 = verifySwapTransaction({ tx: realTx, liveAddress, quote: badQuoteSlip });
    ok("altered quote.slippageBps -> refused", r4.ok === false && /slippage/i.test(r4.reason), r4);

    // Extra program: insert an unknown instruction (a bogus program id appended as a new static
    // key) into a copy of the message, re-serialize, re-deserialize, and verify it is refused.
    {
      const payer = new web3.PublicKey(liveAddress);
      const evilProgram = web3.Keypair.generate().publicKey; // not on any allowlist
      const ixs = realTx.message.compiledInstructions.map((ix) => new web3.TransactionInstruction({
        programId: realTx.message.staticAccountKeys[ix.programIdIndex],
        keys: ix.accountKeyIndexes.map((idx) => ({
          pubkey: realTx.message.staticAccountKeys[idx] || payer, // ALT-resolved keys aren't needed for this shape test
          isSigner: idx === 0, isWritable: true,
        })),
        data: Buffer.from(ix.data),
      }));
      ixs.push(new web3.TransactionInstruction({ programId: evilProgram, keys: [], data: Buffer.from([1, 2, 3]) }));
      const msgV0 = new web3.TransactionMessage({
        payerKey: payer,
        recentBlockhash: realTx.message.recentBlockhash,
        instructions: ixs,
      }).compileToV0Message(); // no lookup tables — simplest shape that still exercises the allowlist check
      const mutated = new web3.VersionedTransaction(msgV0);
      const r5 = verifySwapTransaction({ tx: mutated, liveAddress, quote: FIXTURE_QUOTE });
      ok("an extra instruction calling an unrecognised program -> refused", r5.ok === false && /program the app does not recognise/i.test(r5.reason), r5);
    }

    // Non-zero platform fee in the route instruction's own trailing byte.
    {
      const routeIdx = realTx.message.compiledInstructions.findIndex((ix) => {
        const pid = realTx.message.staticAccountKeys[ix.programIdIndex];
        return pid && pid.toBase58() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
      });
      const clone = web3.VersionedTransaction.deserialize(realBytes);
      const data = Buffer.from(clone.message.compiledInstructions[routeIdx].data);
      data[data.length - 1] = 5; // platform_fee_bps -> 5
      clone.message.compiledInstructions[routeIdx].data = new Uint8Array(data);
      const r6 = verifySwapTransaction({ tx: clone, liveAddress, quote: FIXTURE_QUOTE });
      ok("a non-zero platform_fee_bps encoded in the instruction -> refused", r6.ok === false && /fee we do not expect/i.test(r6.reason), r6);
    }

    const r7 = verifySwapTransaction({ tx: null, liveAddress, quote: FIXTURE_QUOTE });
    ok("no transaction -> refused, never throws", r7.ok === false);
    const r8 = verifySwapTransaction({ tx: realTx, liveAddress, quote: null });
    ok("no quote to check against -> refused, never throws", r8.ok === false);
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
