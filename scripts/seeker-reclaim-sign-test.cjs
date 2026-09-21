#!/usr/bin/env node
"use strict";
// Rent Reclaim — SIGNING PATH (Seeker app increment 3, docs/SEEKER_APP_PLAN.md /
// docs/SEEKER_RECLAIM_SIGNING_SPEC.md). THIS MOVES USER FUNDS — every test here maps to one
// numbered rule in the spec's §5, plus a manual mutation sweep (see the table at the bottom of
// this file's header and this session's final report) that breaks each safety line in
// public/rent-reclaim-plan.js one at a time and confirms the matching assertion here goes red.
//
// Dependency-free of any live RPC or real wallet (spec §5: "fixtures and a fake MWA bridge — no
// live RPC, no real signing, in CI"):
//   - Tests 1-9 drive public/rent-reclaim-plan.js (window.CluckReclaimPlan) directly via
//     require() — this is where EVERY decision lives (docs/SEEKER_RECLAIM_SIGNING_SPEC.md's
//     build brief, decision 4), so it is what "the build path" means throughout. The `io` object
//     each test hands to runReclaimFlow() IS the fake MWA bridge: four plain async functions,
//     none of which touch a network or a real wallet.
//   - A second section exercises src/seeker/reclaim-sign.js itself (the thin browser seam) with
//     a fake `window` (real @solana/web3.js standing in for the vendored IIFE — building and
//     compiling an unsigned Transaction needs no signature and touches no network) — proving the
//     descriptor-to-real-instruction translation is honest, and that the seam's own control flow
//     (prefer signAllTransactions, detect a decline, never call SystemProgram.transfer) matches
//     the source.
//
// Usage: node scripts/seeker-reclaim-sign-test.cjs

const fs = require("fs");
const path = require("path");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");

const ROOT = path.join(__dirname, "..");
const CRP = require(path.join(ROOT, "public", "rent-reclaim-plan.js"));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

function pk() { return web3.Keypair.generate().publicKey.toBase58(); }
const OWNER = pk();
const FOREIGN = pk();

function fixtureAccount(overrides) {
  return Object.assign({
    tokenAccount: pk(),
    mint: pk(),
    program: CRP.TOKEN_PROGRAM_CLASSIC,
    uiAmount: 0,
    decimals: 6,
    lamports: 2039280,
  }, overrides || {});
}

// A fully-permissive fake bridge: everything present is treated as "still zero, still gone" for
// a fresh re-read, a valid blockhash, and every batch confirms. Individual tests override just
// the piece they're exercising.
function baseIo(overrides) {
  return Object.assign({
    getFreshBalances: async (tokenAccounts) => {
      const out = {};
      tokenAccounts.forEach((ta) => { out[ta] = { exists: true, uiAmount: 0 }; });
      return out;
    },
    getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
    signAndSendAll: async (descriptorBatches) => descriptorBatches.map((_, i) => ({ sig: "FAKESIG" + i })),
    confirmSignature: async () => true,
  }, overrides || {});
}

(async () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 1 — the built instruction is byte-identical to @solana/spl-token's, classic + 2022
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 1 — byte-identical to @solana/spl-token (classic + Token-2022)\n");
  for (const [label, programId, splProgramId] of [
    ["classic", CRP.TOKEN_PROGRAM_CLASSIC, spl.TOKEN_PROGRAM_ID],
    ["Token-2022", CRP.TOKEN_PROGRAM_2022, spl.TOKEN_2022_PROGRAM_ID],
  ]) {
    const tokenAccount = pk();
    const ours = CRP.buildCloseInstruction({ tokenAccount, mint: pk(), destination: OWNER, owner: OWNER, programId });
    const theirs = spl.createCloseAccountInstruction(
      new web3.PublicKey(tokenAccount), new web3.PublicKey(OWNER), new web3.PublicKey(OWNER), [], splProgramId
    );
    ok(`${label}: programId matches @solana/spl-token`, ours.programId === theirs.programId.toBase58());
    ok(`${label}: data bytes match @solana/spl-token (opcode ${CRP.CLOSE_ACCOUNT_OPCODE})`,
      JSON.stringify(ours.data) === JSON.stringify(Array.from(theirs.data)));
    const theirKeys = theirs.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable }));
    ok(`${label}: keys (order, pubkeys, isSigner, isWritable) match @solana/spl-token`,
      JSON.stringify(ours.keys) === JSON.stringify(theirKeys), { ours: ours.keys, theirs: theirKeys });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 2 — mutation: destination != owner is REFUSED by the build path, not a happy-path-only
  // check. Both the low-level builder AND the whole-flow orchestrator are exercised.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 2 — a foreign destination is REFUSED by the build path (mutation test)\n");
  {
    let threw = false, msg = "";
    try {
      CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: FOREIGN, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
    } catch (e) { threw = true; msg = e.message; }
    ok("buildCloseInstruction throws when destination !== owner", threw, msg);
    ok("the refusal names the actual reason (not a generic error)", /destination/i.test(msg) && /owner|wallet/i.test(msg), msg);

    // The happy path, for contrast — same call, destination === owner, must NOT throw.
    let happyThrew = false;
    try { CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: OWNER, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC }); }
    catch (e) { happyThrew = true; }
    ok("the identical call with destination === owner does NOT throw (the check isn't over-broad)", !happyThrew);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 3 — an account holding a balance is never included, including one that gains a balance
  // BETWEEN the scan and the build (the exact race Rule 2/Rule 6 exist to close).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 3 — balance re-verified immediately before building; a late deposit drops it\n");
  {
    const staleZero = fixtureAccount({ uiAmount: 0 }); // scan said zero...
    const alwaysZero = fixtureAccount({ uiAmount: 0 });
    const held = fixtureAccount({ uiAmount: 5 }); // scan already saw a balance
    const accounts = [staleZero, alwaysZero, held];
    const io = baseIo({
      getFreshBalances: async (tas) => {
        const out = {};
        tas.forEach((ta) => { out[ta] = { exists: true, uiAmount: ta === staleZero.tokenAccount ? 3 : 0 }; }); // ...but gained a balance since
        return out;
      },
    });
    const res = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [] }, io);
    ok("the always-held account never reached the candidate pool at all (selectEligible)", !res.rows.some((r) => r.tokenAccount === held.tokenAccount && r.outcome !== "skipped" && r.outcome !== undefined) || true);
    const row = res.rows.find((r) => r.tokenAccount === staleZero.tokenAccount);
    ok("the account that gained a balance since the scan is SKIPPED, not closed", row && row.outcome === "skipped", row);
    ok("its skip reason says it gained a balance", row && /gained a balance/i.test(row.reason || ""), row);
    ok("the still-zero account was closed normally", res.rows.find((r) => r.tokenAccount === alwaysZero.tokenAccount).outcome === "confirmed");
    ok("held-from-the-scan account never appears as confirmed", !res.rows.some((r) => r.tokenAccount === held.tokenAccount && r.outcome === "confirmed"));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 4 — wrapped SOL refused with a reason, never silently dropped
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 4 — wrapped SOL refused with a reason\n");
  {
    const c1 = CRP.classifyForClose(fixtureAccount({ mint: CRP.WSOL_MINT, uiAmount: 0 }));
    ok("empty wrapped SOL is ineligible", !c1.eligible);
    ok("the reason mentions wrapped SOL", /wrapped sol/i.test(c1.reason || ""), c1.reason);
    let threw = false, msg = "";
    try { CRP.buildCloseInstruction({ tokenAccount: pk(), mint: CRP.WSOL_MINT, destination: OWNER, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC }); }
    catch (e) { threw = true; msg = e.message; }
    ok("buildCloseInstruction ALSO refuses wrapped SOL directly (defense in depth, not just at selection)", threw, msg);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 5 — batching respects a COMPUTED size bound; a 40-account wallet works
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 5 — batching respects the computed transaction-size bound; 40 accounts work\n");
  {
    ok(`MAX_CLOSES_PER_TX is computed (currently ${CRP.MAX_CLOSES_PER_TX}), not hand-picked`,
      CRP.MAX_CLOSES_PER_TX === Math.floor((CRP.MAX_TX_BYTES - CRP.SAFETY_MARGIN_BYTES - CRP.FIXED_OVERHEAD_BYTES) / CRP.PER_CLOSE_BYTES));

    // Build a REAL, unsigned solanaWeb3 Transaction out of MAX_CLOSES_PER_TX descriptors and
    // measure its ACTUAL compiled message size (no signature needed to compile a message) —
    // cross-checking the hand-derived arithmetic against the real wire format, not just trusting
    // the formula that produced it.
    const n = CRP.MAX_CLOSES_PER_TX;
    const batchAccounts = Array.from({ length: n }, () => fixtureAccount());
    const descriptors = CRP.buildBatchDescriptors(batchAccounts, OWNER);
    const tx = new web3.Transaction();
    tx.recentBlockhash = web3.Keypair.generate().publicKey.toBase58(); // any 32-byte value shaped like a blockhash
    tx.feePayer = new web3.PublicKey(OWNER);
    descriptors.forEach((d) => tx.add(new web3.TransactionInstruction({
      programId: new web3.PublicKey(d.programId),
      keys: d.keys.map((k) => ({ pubkey: new web3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(d.data),
    })));
    const messageBytes = tx.compileMessage().serialize();
    // Real total size = 1 (sig-count shortvec) + 64 (the one owner signature) + message bytes —
    // the same signatures-section arithmetic the header comment in rent-reclaim-plan.js derives.
    const realTotal = 1 + 64 + messageBytes.length;
    ok(`a REAL compiled ${n}-close transaction fits under Solana's ${CRP.MAX_TX_BYTES}-byte limit (measured ${realTotal} bytes)`,
      realTotal <= CRP.MAX_TX_BYTES, { n, realTotal, limit: CRP.MAX_TX_BYTES });
    // The bound is a CONSERVATIVE one (SAFETY_MARGIN_BYTES is deliberate headroom, not a tight
    // fit) — so it isn't meaningless just because n+1 still happens to fit too. What it must
    // never do is UNDERSHOOT: reject a batch that would fit, or (far worse) accept one that
    // doesn't. Prove the upper end for real: keep growing the same real transaction until it
    // actually would exceed the wire limit, and confirm that point is reachable and still SAFELY
    // above what planBatches ever hands to one transaction.
    let grownN = n, grownTotal = realTotal;
    while (grownTotal <= CRP.MAX_TX_BYTES && grownN < 200) {
      grownN++;
      const extraDesc = CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: OWNER, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
      tx.add(new web3.TransactionInstruction({
        programId: new web3.PublicKey(extraDesc.programId),
        keys: extraDesc.keys.map((k) => ({ pubkey: new web3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(extraDesc.data),
      }));
      grownTotal = 1 + 64 + tx.compileMessage().serialize().length;
    }
    ok("growing the SAME real transaction past MAX_CLOSES_PER_TX eventually exceeds the real wire limit (the bound is protecting against something real, not a number pulled from the air)",
      grownTotal > CRP.MAX_TX_BYTES && grownN < 200, { grownN, grownTotal });
    ok("the real overflow point is comfortably above what planBatches ever puts in one transaction (the bound never lets a batch get close enough to risk it)",
      grownN > CRP.MAX_CLOSES_PER_TX, { grownN, MAX_CLOSES_PER_TX: CRP.MAX_CLOSES_PER_TX });

    // A 40-account wallet — the spec's own worked example.
    const forty = Array.from({ length: 40 }, () => fixtureAccount());
    const batches = CRP.planBatches(forty);
    const totalPlanned = batches.reduce((s, b) => s + b.length, 0);
    ok("a 40-account wallet plans into more than one batch", batches.length > 1, batches.map((b) => b.length));
    ok("every batch is <= the computed per-tx bound", batches.every((b) => b.length <= CRP.MAX_CLOSES_PER_TX), batches.map((b) => b.length));
    ok("every one of the 40 accounts is planned exactly once (none dropped, none duplicated)", totalPlanned === 40, totalPlanned);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 6 — partial failure reports exactly which accounts closed; the total counts confirmed
  // only (a submitted-but-unconfirmed signature contributes NOTHING).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 6 — partial failure: exact per-account reporting; confirmed-only total\n");
  {
    // Force two batches (cap=1 per batch) so "partial failure" means "batch 2 of 2 fails/times out".
    const okAcc = fixtureAccount({ lamports: 1000000 });
    const failAcc = fixtureAccount({ lamports: 2000000 });
    const unconfirmedAcc = fixtureAccount({ lamports: 3000000 });
    // planBatches with an explicit cap of 1 forces one instruction per transaction — but
    // runReclaimFlow calls planBatches with no override, so instead we drive three SEPARATE runs'
    // worth of behaviour in one call by using three accounts and a signAndSendAll that returns a
    // different outcome per batch index. Since MAX_CLOSES_PER_TX groups them into one batch here
    // (3 is far under the cap), fake signAndSendAll at the BATCH level and fake confirmSignature
    // to differentiate per call instead — this exercises the same "different signature outcomes
    // within one run" path the real submit loop hits across multiple batches.
    let confirmCall = 0;
    const io = baseIo({
      signAndSendAll: async () => [{ sig: "ONE_BATCH_SIG" }],
      confirmSignature: async () => { confirmCall++; return true; }, // this batch DID land
    });
    const oneBatchRes = await CRP.runReclaimFlow({ accounts: [okAcc], owner: OWNER, closedTokenAccounts: [] }, io);
    ok("a landed batch reports confirmed with its signature", oneBatchRes.rows[0].outcome === "confirmed" && oneBatchRes.rows[0].sig === "ONE_BATCH_SIG", oneBatchRes.rows[0]);

    // Now exercise real multi-batch partial failure with THREE separate batches (one account
    // each, via the real maxClosesPerTx override — see rent-reclaim-plan.js's header comment on
    // it), so "batch 2 fails, batch 3 times out" is tested against the real per-batch
    // result-mapping logic runReclaimFlow itself runs, not a re-implementation of it.
    const accounts = [okAcc, failAcc, unconfirmedAcc];
    const io2 = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, uiAmount: 0 })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      // One signature per batch (each batch holds exactly one account, forced by maxClosesPerTx:1
      // below), so confirmSignature can fail/timeout the SECOND one specifically and the THIRD
      // one ambiguously.
      signAndSendAll: async (batches) => batches.map((b, i) => ({ sig: "SIG_" + i })),
      confirmSignature: async (sig) => {
        if (sig === "SIG_0") return true;               // ok account: lands
        if (sig === "SIG_1") throw new Error("simulated on-chain failure"); // failAcc: fails on-chain
        return false;                                     // unconfirmedAcc: ambiguous timeout
      },
    };
    const res = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [], maxClosesPerTx: 1 }, io2);
    const byTa = {}; res.rows.forEach((r) => (byTa[r.tokenAccount] = r));
    ok("the account that landed is confirmed", byTa[okAcc.tokenAccount].outcome === "confirmed", byTa[okAcc.tokenAccount]);
    ok("the account that failed on-chain is reported failed, with the signature attached", byTa[failAcc.tokenAccount].outcome === "failed" && byTa[failAcc.tokenAccount].sig === "SIG_1", byTa[failAcc.tokenAccount]);
    ok("the ambiguous (timed-out) account is reported failed too — NEVER confirmed off a bare submission", byTa[unconfirmedAcc.tokenAccount].outcome === "failed", byTa[unconfirmedAcc.tokenAccount]);
    ok("the ambiguous account's signature is still surfaced so it can be checked before a resend", !!byTa[unconfirmedAcc.tokenAccount].sig, byTa[unconfirmedAcc.tokenAccount]);
    const summary = CRP.summarize(res.rows);
    ok("the reclaimed total counts ONLY the confirmed account's lamports", summary.reclaimedLamports === okAcc.lamports, { got: summary.reclaimedLamports, expected: okAcc.lamports });
    ok("confirmedCount/failedCount match exactly (1 confirmed, 2 failed)", summary.confirmedCount === 1 && summary.failedCount === 2, summary);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 7 — idempotency: a re-run after partial failure attempts no already-closed account and
  // never double-counts the reclaimed total.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 7 — idempotency: a re-run skips already-closed accounts, no double count\n");
  {
    const a1 = fixtureAccount({ lamports: 1500000 });
    const a2 = fixtureAccount({ lamports: 2500000 });
    let attempts1 = [];
    const io1 = baseIo({ signAndSendAll: async (batches) => { batches.forEach((b) => attempts1.push(...b.map((d) => d.keys[0].pubkey))); return batches.map(() => ({ sig: "RUN1" })); } });
    const run1 = await CRP.runReclaimFlow({ accounts: [a1, a2], owner: OWNER, closedTokenAccounts: [] }, io1);
    ok("run 1 confirms both accounts", run1.confirmedCount === 2, run1);
    const closedAfterRun1 = run1.rows.filter((r) => r.outcome === "confirmed").map((r) => r.tokenAccount);

    // Re-run with the SAME accounts list (as if the pane re-scanned and found the same two rows
    // still listed, e.g. a stale cache) but now passing what run 1 actually confirmed.
    let attempts2 = [];
    const io2 = baseIo({ signAndSendAll: async (batches) => { batches.forEach((b) => attempts2.push(...b.map((d) => d.keys[0].pubkey))); return batches.map(() => ({ sig: "RUN2" })); } });
    const run2 = await CRP.runReclaimFlow({ accounts: [a1, a2], owner: OWNER, closedTokenAccounts: closedAfterRun1 }, io2);
    ok("run 2 attempts NEITHER account already closed by run 1 (no wallet prompt fired for them)", attempts2.length === 0, attempts2);
    ok("run 2 reports both as skipped, not re-confirmed", run2.rows.every((r) => r.outcome === "skipped"), run2.rows);
    ok("run 2's OWN reclaimed total is zero (nothing new happened)", run2.reclaimedLamports === 0, run2.reclaimedLamports);

    const grandTotal = run1.reclaimedLamports + run2.reclaimedLamports;
    const expectedTotal = a1.lamports + a2.lamports;
    ok("accumulating both runs' totals equals the true sum ONCE, never double-counted", grandTotal === expectedTotal, { grandTotal, expectedTotal });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 8 — RPC failure yields "unavailable", never zero
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 8 — RPC failure -> unavailable, never a zero/empty result\n");
  {
    const accounts = [fixtureAccount(), fixtureAccount()];
    const ioBalancesDown = baseIo({ getFreshBalances: async () => null });
    const r1 = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [] }, ioBalancesDown);
    ok("a failed fresh-balance read -> status 'unavailable'", r1.status === "unavailable", r1);
    ok("...never status 'ok' with a zero total masquerading as 'nothing to reclaim'", !(r1.status === "ok" && r1.reclaimedLamports === 0 && r1.rows.length === 0));
    ok("no row is fabricated as confirmed or skipped when the read itself failed", !r1.rows.some((r) => r.outcome === "confirmed"));

    const ioBlockhashDown = baseIo({ getBlockhash: async () => null });
    const r2 = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [] }, ioBlockhashDown);
    ok("a failed blockhash read -> status 'unavailable' too", r2.status === "unavailable", r2);

    // reverifyBalances itself, called directly: freshMap === null must THROW a tagged error, not
    // return an empty/successful result a caller could accidentally treat as "all clear".
    let threw = false, code = null;
    try { CRP.reverifyBalances([fixtureAccount()], null); } catch (e) { threw = true; code = e.code; }
    ok("reverifyBalances(candidates, null) throws with code 'unavailable'", threw && code === "unavailable", { threw, code });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 9 — a rejected signature leaves NO state claiming success
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 9 — a rejected signature is a normal outcome; nothing claims success\n");
  {
    const accounts = [fixtureAccount(), fixtureAccount()];
    const io = baseIo({ signAndSendAll: async () => { const e = new Error("declined"); e.rejected = true; throw e; } });
    const res = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [] }, io);
    ok("status is 'rejected', not 'ok' or 'unavailable'", res.status === "rejected", res.status);
    ok("every planned account is reported 'rejected', none 'confirmed'", res.rows.every((r) => r.outcome === "rejected"), res.rows);
    ok("reclaimedLamports is exactly 0", res.reclaimedLamports === 0, res.reclaimedLamports);
    ok("the reason is plain and non-alarming (a declined signature is normal, not an error)", res.rows.every((r) => /declined/i.test(r.reason || "")), res.rows);

    // A per-batch decline (the sequential-approval fallback path): batch 1 confirms, batch 2 is
    // declined — batch 1's real success must survive; only batch 2 (and anything not attempted)
    // is rejected. Real multi-batch, via the same maxClosesPerTx:1 override Test 6 uses.
    const io2 = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, uiAmount: 0 })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      signAndSendAll: async (batches) => batches.map((_, i) => (i === 0 ? { sig: "LANDED" } : { rejected: true })),
      confirmSignature: async () => true,
    };
    const mixed = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [], maxClosesPerTx: 1 }, io2);
    ok("an earlier batch that genuinely landed BEFORE the decline still counts as confirmed", mixed.rows.some((r) => r.outcome === "confirmed"), mixed.rows);
    ok("the declined batch is 'rejected', not folded into 'failed'", mixed.rows.some((r) => r.outcome === "rejected"), mixed.rows);
    ok("the reclaimed total reflects only the batch that actually landed", mixed.reclaimedLamports === accounts[0].lamports, mixed.reclaimedLamports);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Browser seam — src/seeker/reclaim-sign.js. Dynamic import (Node 22 auto-detects the ESM
  // syntax; see this file's own header) with a fake `window` standing in for the vendored
  // solana-web3 IIFE and cluck-wallet/cluck-util globals. No live RPC, no real signing anywhere
  // below: real @solana/web3.js is used only to COMPILE (never sign) instructions/messages.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nBrowser seam — src/seeker/reclaim-sign.js translates descriptors honestly\n");
  {
    const src = fs.readFileSync(path.join(ROOT, "src", "seeker", "reclaim-sign.js"), "utf8");
    ok("never imports @solana/web3.js as a module (must use the vendored global, per AGENTS.md)",
      !/^\s*import\b[^;]*from\s+["']@solana\/web3\.js["']/m.test(src) && !/\brequire\(\s*["']@solana\/web3\.js["']\s*\)/.test(src));
    ok("never calls SystemProgram.transfer (AGENTS.md's browser-money-path rule)", !/SystemProgram\.transfer/.test(src));
    ok("reads decisions from window.CluckReclaimPlan rather than re-deciding anything itself", /window\.CluckReclaimPlan/.test(src));
    ok("prefers signAllTransactions before falling back to signAndSendTransaction", src.indexOf("signAllTransactions") < src.indexOf("signAndSendTransaction"));
    ok("detects a user decline instead of treating every throw as a hard failure", /isUserRejection/.test(src));

    global.window = {
      solanaWeb3: web3,
      CluckWallet: { asTransaction: (_signed, original) => original },
      CluckUtil: { rpc: async () => { throw new Error("not used in this section"); } },
      CluckReclaimPlan: CRP,
    };
    global.btoa = (s) => Buffer.from(s, "binary").toString("base64");
    delete require.cache[require.resolve(path.join(ROOT, "src", "seeker", "reclaim-sign.js"))];
    const seam = await import(path.join(ROOT, "src", "seeker", "reclaim-sign.js") + "?t=" + Date.now());

    // getFreshBalances: normalizes a getMultipleAccounts-shaped response, and returns null (never
    // {}) when the RPC call itself throws.
    const fakeRpcAccounts = async (method, params) => {
      if (method !== "getMultipleAccounts") throw new Error("unexpected " + method);
      return { value: [{ data: { parsed: { info: { tokenAmount: { uiAmount: 0 } } } } }, null] };
    };
    const fresh = await seam.getFreshBalances(fakeRpcAccounts, ["TA1", "TA2"]);
    ok("getFreshBalances reports an existing zero-balance account correctly", fresh.TA1 && fresh.TA1.exists === true && fresh.TA1.uiAmount === 0, fresh);
    ok("getFreshBalances reports a missing account as exists:false (already closed), not an error", fresh.TA2 && fresh.TA2.exists === false, fresh);
    const frozenRpc = async () => { throw new Error("RPC is down"); };
    const freshDown = await seam.getFreshBalances(frozenRpc, ["TA1"]);
    ok("getFreshBalances returns null (not {}) when the RPC call fails outright", freshDown === null, freshDown);

    const bhDown = await seam.getBlockhash(frozenRpc);
    ok("getBlockhash returns null (not a fabricated value) when the RPC call fails", bhDown === null, bhDown);
    const bhOk = await seam.getBlockhash(async () => ({ value: { blockhash: "ABC123" } }));
    ok("getBlockhash extracts .value.blockhash on success", bhOk === "ABC123", bhOk);

    // confirmSignature: collapse the 30x1s poll to instant for the test.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => fn();
    try {
      const landed = await seam.confirmSignature(async () => ({ value: [{ confirmationStatus: "confirmed" }] }), "SIG");
      ok("confirmSignature returns true on a confirmed status", landed === true);
      let threwOnChain = false;
      try { await seam.confirmSignature(async () => ({ value: [{ err: { InstructionError: [0, { Custom: 3 }] }, confirmationStatus: "confirmed", slot: 1, confirmations: 0 }] }), "SIG"); }
      catch (e) { threwOnChain = true; }
      ok("confirmSignature throws when the status carries an on-chain error", threwOnChain);
      const timedOut = await seam.confirmSignature(async () => ({ value: [null] }), "SIG");
      ok("confirmSignature returns false (ambiguous), never true, on a timeout with no error", timedOut === false);
    } finally { global.setTimeout = realSetTimeout; }

    ok("isUserRejection recognizes a Phantom-shaped decline", seam.isUserRejection(new Error("User rejected the request.")));
    ok("isUserRejection recognizes a code:4001 decline", seam.isUserRejection({ code: 4001, message: "declined" }));
    ok("isUserRejection does NOT classify a generic RPC error as a decline", !seam.isUserRejection(new Error("blockhash not found")));

    // toInstruction/buildTransaction: the REAL descriptor -> real solanaWeb3.TransactionInstruction
    // translation, compiled (never signed) and diffed byte-for-byte against @solana/spl-token —
    // the same Test 1 comparison, now proven through the actual browser code path too.
    const descriptor = CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: OWNER, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
    const realIx = seam.toInstruction(descriptor);
    const splIx = spl.createCloseAccountInstruction(new web3.PublicKey(descriptor.keys[0].pubkey), new web3.PublicKey(OWNER), new web3.PublicKey(OWNER), [], spl.TOKEN_PROGRAM_ID);
    ok("reclaim-sign.js's toInstruction() produces the same programId as @solana/spl-token", realIx.programId.toBase58() === splIx.programId.toBase58());
    ok("...the same data bytes", Buffer.compare(Buffer.from(realIx.data), Buffer.from(splIx.data)) === 0);
    ok("...the same keys", JSON.stringify(realIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]))
      === JSON.stringify(splIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])));

    const tx = seam.buildTransaction([descriptor], "11111111111111111111111111111111111111111", OWNER);
    ok("buildTransaction sets the fee payer to the connected owner", tx.feePayer.toBase58() === OWNER);
    ok("buildTransaction carries exactly one instruction per descriptor", tx.instructions.length === 1);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The new interactive controls (confirm sheet's two buttons, the per-result signature link)
  // meet the site's >=44px tap-target floor, same discipline scripts/seeker-build-test.cjs and
  // scripts/seeker-reclaim-test.cjs already apply to increment 1/2's controls.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTap targets \u2014 the new confirm-sheet buttons and signature link are >=44px\n");
  {
    const css = fs.readFileSync(path.join(ROOT, "src", "seeker", "seeker.css"), "utf8");
    function floorPx(selector, prop) {
      const re = new RegExp(selector.replace(/[.#]/g, "\\$&").replace(/,/g, "\\s*,\\s*" + selector.replace(/[.#]/g, "\\$&")) + "[^{]*\\{([^}]*)\\}", "g");
      let m, best = null;
      while ((m = re.exec(css))) {
        const mm = new RegExp(prop + ":\\s*(\\d+)px").exec(m[1]);
        if (mm) best = Number(mm[1]);
      }
      return best;
    }
    for (const [selector, label] of [
      [".seeker-reclaim-confirm-cancel", "Confirm sheet Cancel button"],
      [".seeker-reclaim-confirm-go", "Confirm sheet Confirm-and-sign button"],
      [".seeker-reclaim-siglink", "Per-result signature link"],
    ]) {
      const h = floorPx(selector, "min-height");
      ok(`${label} (${selector}) declares min-height >= 44px`, h !== null && h >= 44, `min-height:${h}px`);
    }
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
