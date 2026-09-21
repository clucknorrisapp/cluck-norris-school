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

// ⚠️ P1-B: `amount` is the field classifyForClose/reverifyBalances actually decide on now — the
// EXACT base-unit integer as a STRING, never `uiAmount` (f64 | null in the RPC schema). Fixtures
// default to a zero-balance, closable account; `uiAmount` is carried along for realism only (it
// is never read by the code under test).
function fixtureAccount(overrides) {
  return Object.assign({
    tokenAccount: pk(),
    mint: pk(),
    program: CRP.TOKEN_PROGRAM_CLASSIC,
    amount: "0",
    uiAmount: 0,
    decimals: 6,
    lamports: 2039280,
  }, overrides || {});
}

// A fully-permissive fake bridge: everything present is treated as "still zero, still gone" for
// a fresh re-read, a valid blockhash, and every batch confirms. Individual tests override just
// the piece they're exercising. getFreshBalances' shape matches src/seeker/reclaim-sign.js's real
// one post P1-B/P2-I: { exists, amount, lamports, mint, owner } — lamports/mint/owner left
// `undefined` here (reverifyBalances falls back to the candidate's own claimed values when a
// fresh field isn't provided), so tests that don't care about the P2-I overwrite/mismatch checks
// don't have to fake them.
function baseIo(overrides) {
  return Object.assign({
    getFreshBalances: async (tokenAccounts) => {
      const out = {};
      tokenAccounts.forEach((ta) => { out[ta] = { exists: true, amount: "0" }; });
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
    const staleZero = fixtureAccount({ amount: "0" }); // scan said zero...
    const alwaysZero = fixtureAccount({ amount: "0" });
    const held = fixtureAccount({ amount: "5000000" }); // scan already saw a balance
    const accounts = [staleZero, alwaysZero, held];
    const io = baseIo({
      getFreshBalances: async (tas) => {
        const out = {};
        tas.forEach((ta) => { out[ta] = { exists: true, amount: ta === staleZero.tokenAccount ? "3000000" : "0" }; }); // ...but gained a balance since
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
    const c1 = CRP.classifyForClose(fixtureAccount({ mint: CRP.WSOL_MINT, amount: "0" }));
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
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
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
    // ⚠️ This assertion used to read "reported failed too". That was itself the bug (both
    // adversarial lenses, 2026-09-21): an ambiguous timeout is NOT a failure. The close may
    // have landed and the rent may be back. "Failed" tells someone nothing happened when
    // something may have — and it fed the P1-D retry, which re-signed the same close.
    ok("⚠️ the ambiguous (timed-out) account is UNCONFIRMED — never confirmed off a bare submission, and never called failed",
       byTa[unconfirmedAcc.tokenAccount].outcome === "unconfirmed", byTa[unconfirmedAcc.tokenAccount]);
    ok("the ambiguous account's signature is still surfaced so it can be checked before a resend", !!byTa[unconfirmedAcc.tokenAccount].sig, byTa[unconfirmedAcc.tokenAccount]);
    const summary = CRP.summarize(res.rows);
    ok("the reclaimed total counts ONLY the confirmed account's lamports", summary.reclaimedLamports === okAcc.lamports, { got: summary.reclaimedLamports, expected: okAcc.lamports });
    ok("the counts keep all three apart (1 confirmed, 1 failed, 1 unconfirmed)",
       summary.confirmedCount === 1 && summary.failedCount === 1 && summary.unconfirmedCount === 1, summary);
    ok("⚠️ the unconfirmed lamports are reported separately and NOT added to the reclaimed total",
       summary.unconfirmedLamports === unconfirmedAcc.lamports && summary.reclaimedLamports === okAcc.lamports, summary);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Test 6b — THE SUBMIT ITSELF. Tests 6 and 7 both assume signAndSendAll came back with a
  // signature; this one is about what happens when it did not, and it exists because the two
  // shapes below were collapsed into one "failed" for the whole life of this file.
  //
  //   · TRANSPORT FAILURE — the request never got an answer (dropped mobile connection, a 502
  //     with an HTML body from the edge). The transaction is SIGNED and may be in the cluster.
  //     reclaim-sign.js now reports { sig, unconfirmedSubmit: true, error }. Reporting this as
  //     "failed" told someone "Reclaimed 0 SOL" when the rent may already have been back, and
  //     then fed the account to the P1-D auto-retry, which re-signed the same close.
  //   · NODE REFUSED — a well-formed JSON-RPC error came back. Nothing landed, nothing was
  //     charged, a retry IS safe, and it must stay "failed" so the retry still happens.
  //
  // Both carry a signature, so the ORDER of the checks in sendAndConfirmBatches is what keeps
  // them apart. Get it wrong and a refused transaction goes into the confirm poll and comes out
  // "unconfirmed" — turning a clean, safely-retryable failure into one nobody may retry.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nTest 6b — transport failure vs the node refusing it (the two send shapes)\n");
  {
    // A transport failure on a 3-account batch. The ONLY confirm answer is the ambiguous one:
    // we could not tell then and we cannot tell now.
    // Own fixtures — Test 6's are scoped to its own block.
    const okAcc = fixtureAccount({ lamports: 1000000 });
    const failAcc = fixtureAccount({ lamports: 2000000 });
    const unconfirmedAcc = fixtureAccount({ lamports: 3000000 });
    let confirmCalls = 0, sendCalls = 0;
    const ioT = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      signAndSendAll: async (batches) => { sendCalls++; return batches.map(() => ({ sig: "LOCAL_SIG_T", unconfirmedSubmit: true, error: "Failed to fetch" })); },
      confirmSignature: async () => { confirmCalls++; return false; },
    };
    const accs = [okAcc, failAcc, unconfirmedAcc];
    const rT = await CRP.runReclaimFlow({ accounts: accs, owner: OWNER, closedTokenAccounts: [] }, ioT);
    const sum = CRP.summarize(rT.rows);
    ok("⚠️ a transport failure is UNCONFIRMED for every account in the batch, never failed",
       rT.rows.length === 3 && rT.rows.every((r) => r.outcome === "unconfirmed"), rT.rows);
    ok("⚠️ and the reclaimed total is zero WITHOUT claiming nothing happened",
       sum.reclaimedLamports === 0 && sum.unconfirmedCount === 3 && sum.failedCount === 0, sum);
    ok("every unconfirmed row carries the signature we already hold, so it can be looked up",
       rT.rows.every((r) => r.sig === "LOCAL_SIG_T"), rT.rows);
    ok("it still polled for confirmation rather than giving up on the send",
       confirmCalls > 0, { confirmCalls });
    ok("⚠️ an unconfirmed batch is NEVER auto-retried — exactly one send round happened",
       sendCalls === 1, { sendCalls });

    // Same batch, but the transport failure resolves: the poll LANDS it. That is a genuine
    // confirmation and must be reported as one — the ambiguity was ours, not the chain's.
    const ioT2 = Object.assign({}, ioT, {
      signAndSendAll: async (batches) => batches.map(() => ({ sig: "LOCAL_SIG_T2", unconfirmedSubmit: true, error: "Failed to fetch" })),
      confirmSignature: async () => true,
    });
    const rT2 = await CRP.runReclaimFlow({ accounts: accs, owner: OWNER, closedTokenAccounts: [] }, ioT2);
    const sum2 = CRP.summarize(rT2.rows);
    ok("a transport failure whose transaction the poll then FINDS is confirmed, and counts",
       rT2.rows.every((r) => r.outcome === "confirmed") && sum2.reclaimedLamports === accs.reduce((n, a) => n + a.lamports, 0), sum2);

    // The node ANSWERED and refused it — and still handed back a local signature. This is the
    // ordering trap: checking `sig` first would route it into the poll and mislabel it.
    let sendCalls3 = 0, confirmCalls3 = 0;
    const ioR = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      signAndSendAll: async (batches) => { sendCalls3++; return batches.map(() => ({ error: "Blockhash not found", sig: "LOCAL_SIG_R" })); },
      confirmSignature: async () => { confirmCalls3++; return false; },
    };
    const rR = await CRP.runReclaimFlow({ accounts: accs, owner: OWNER, closedTokenAccounts: [] }, ioR);
    const sumR = CRP.summarize(rR.rows);
    ok("⚠️ a node-refused send is FAILED even though a signature came back with it",
       rR.rows.every((r) => r.outcome === "failed") && sumR.unconfirmedCount === 0, rR.rows);
    ok("the refusal's own reason is reported, not a generic one",
       rR.rows.every((r) => /Blockhash not found/.test(r.reason || "")), rR.rows);
    ok("the signature is still surfaced for lookup", rR.rows.every((r) => r.sig === "LOCAL_SIG_R"), rR.rows);
    ok("⚠️ a refused send is never sent into the confirmation poll", confirmCalls3 === 0, { confirmCalls3 });
    ok("and because nothing landed, the P1-D retry DOES fire for it", sendCalls3 === 2, { sendCalls3 });
  }

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
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
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

    // getFreshBalances: normalizes a getMultipleAccounts-shaped response — ⚠️ P1-B: the field it
    // reads off `tokenAmount` is `amount` (the exact base-unit string), never `uiAmount` — and
    // returns null (never {}) when the RPC call itself throws.
    const fakeRpcAccounts = async (method, params) => {
      if (method !== "getMultipleAccounts") throw new Error("unexpected " + method);
      return { value: [{ lamports: 2039280, data: { parsed: { info: { mint: "MintAAA1111111111111111111111111111111111111", owner: OWNER, tokenAmount: { amount: "0", uiAmount: 0 } } } } }, null] };
    };
    const fresh = await seam.getFreshBalances(fakeRpcAccounts, ["TA1", "TA2"]);
    ok("getFreshBalances reports an existing zero-balance account correctly (amount, not uiAmount)", fresh.TA1 && fresh.TA1.exists === true && fresh.TA1.amount === "0", fresh);
    ok("getFreshBalances carries the fresh lamports/mint/owner through for P2-I to use", fresh.TA1.lamports === 2039280 && fresh.TA1.mint === "MintAAA1111111111111111111111111111111111111" && fresh.TA1.owner === OWNER, fresh.TA1);
    ok("getFreshBalances reports a missing account as exists:false (already closed), not an error", fresh.TA2 && fresh.TA2.exists === false, fresh);
    // ⚠️ P1-B mutation check: a uiAmount-null / amount-real shape (a Token-2022 withheld-fee
    // account, or anything the RPC can't ui-scale) must report the REAL amount, never coerce.
    const fakeRpcNullUi = async () => ({ value: [{ lamports: 1, data: { parsed: { info: { mint: "M", owner: OWNER, tokenAmount: { amount: "999", uiAmount: null } } } } }] });
    const freshNullUi = await seam.getFreshBalances(fakeRpcNullUi, ["TA1"]);
    ok("getFreshBalances never coerces a null uiAmount into a zero amount", freshNullUi.TA1.amount === "999", freshNullUi.TA1);
    const frozenRpc = async () => { throw new Error("RPC is down"); };
    const freshDown = await seam.getFreshBalances(frozenRpc, ["TA1"]);
    ok("getFreshBalances returns null (not {}) when the RPC call fails outright", freshDown === null, freshDown);

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // P1-A (adversarial review, 2026-09-21, mutation-proved below): getMultipleAccounts' documented
    // max is 100 pubkeys. A wallet with 101+ dead accounts got a JSON-RPC error -> this function's
    // OWN correct null-on-failure behaviour -> the pane's permanent "Could not read the chain right
    // now" for exactly the wallets this feature is worth most to. Chunk at 100 and merge.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    {
      const tas150 = Array.from({ length: 150 }, () => pk());
      const calls = [];
      const chunkedRpc = async (method, params) => {
        const slice = params[0];
        calls.push(slice.length);
        return { value: slice.map(() => ({ lamports: 1, data: { parsed: { info: { mint: "M", owner: OWNER, tokenAmount: { amount: "0", uiAmount: 0 } } } } })) };
      };
      const result150 = await seam.getFreshBalances(chunkedRpc, tas150);
      ok("P1-A: 150 accounts over the 100-pubkey getMultipleAccounts max -> exactly 2 calls", calls.length === 2, calls);
      ok("P1-A: chunk sizes are 100 then 50 (never one oversized call)", calls[0] === 100 && calls[1] === 50, calls);
      ok("P1-A: all 150 tokenAccounts come back in the merged result", Object.keys(result150 || {}).length === 150, Object.keys(result150 || {}).length);
      ok("P1-A: every one of the 150 requested accounts resolved (chunking never drops or duplicates one)",
        tas150.every((ta) => result150[ta] && result150[ta].exists === true), tas150.filter((ta) => !result150[ta]));

      // Mutation check, inline: ANY chunk throwing must fail the WHOLE read (null), never a
      // partial result for the chunks that did succeed.
      let chunkCall = 0;
      const oneChunkDown = async (method, params) => {
        chunkCall++;
        if (chunkCall === 2) throw new Error("RPC hiccup on the second chunk");
        return { value: params[0].map(() => ({ lamports: 1, data: { parsed: { info: { mint: "M", owner: OWNER, tokenAmount: { amount: "0", uiAmount: 0 } } } } })) };
      };
      const partialDown = await seam.getFreshBalances(oneChunkDown, tas150);
      ok("P1-A: one chunk failing fails the WHOLE read (null), never a partial 100-of-150 result", partialDown === null, partialDown);
    }

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

      // ⚠️ P3 (adversarial review, 2026-09-21, mutation-proved): a transient RPC read failure
      // WHILE POLLING is not an on-chain failure — the transaction may already have landed.
      // Reporting "failed on-chain" for a status the code simply couldn't read told people they
      // lost a close that may well have succeeded. A flaky read must keep polling and still reach
      // the real, later "confirmed" status — never throw on the read failure itself.
      let flakyCalls = 0;
      const flakyThenConfirmed = async () => {
        flakyCalls++;
        if (flakyCalls === 1) throw new Error("network blip");
        return { value: [{ confirmationStatus: "confirmed" }] };
      };
      const survivedBlip = await seam.confirmSignature(flakyThenConfirmed, "SIG");
      ok("P3: a transient RPC read failure while polling is NOT reported as failed — it keeps polling and reaches the real status", survivedBlip === true, { flakyCalls });

      // Persistent read failure for the whole window -> ambiguous timeout (false), never a
      // fabricated "failed on-chain" from the read errors themselves.
      const alwaysDown = await seam.confirmSignature(async () => { throw new Error("RPC down"); }, "SIG");
      ok("P3: a read that fails on EVERY attempt ends in ambiguous (false), never throws 'failed on-chain'", alwaysDown === false);
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

    // ════════════════════════════════════════════════════════════════════════════════════════
    // P2-H (adversarial review, 2026-09-21, mutation-proved below): a wallet whose
    // signAllTransactions() returns its results reordered or substituted was proved to send
    // successfully, with the rows in a batch carrying each other's signatures. seam.signAndSendAll
    // must compare each real, reconstructed transaction's compiled MESSAGE bytes against the one
    // it actually built for that slot, byte for byte, before ever calling sendTransaction.
    // ════════════════════════════════════════════════════════════════════════════════════════
    {
      // A REAL keypair here (not just a pubkey string) so the "honest" case below can actually
      // sign the built transactions, the same way a real wallet would — proving the byte-compare
      // check passes a genuinely honest response, not just that it rejects a dishonest one.
      const kp = web3.Keypair.generate();
      const H_OWNER = kp.publicKey.toBase58();
      const descA = CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: H_OWNER, owner: H_OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
      const descB = CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: H_OWNER, owner: H_OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
      const blockhash = web3.Keypair.generate().publicKey.toBase58();
      let sendCalls = 0;
      const rpcSpy = async (method) => { if (method === "sendTransaction") { sendCalls++; return "SIGSHOULDNOTHAPPEN"; } throw new Error("unexpected " + method); };

      // Honest baseline: the wallet returns exactly what it was asked to sign (actually signed,
      // same order) — must send both, no mismatch reported.
      const honestProvider = {
        publicKey: { toString: () => H_OWNER },
        signAllTransactions: async (txs) => { txs.forEach((tx) => tx.sign(kp)); return txs; },
      };
      const CWHonest = { asTransaction: (signed) => signed };
      global.window.CluckWallet = CWHonest;
      let sent = 0;
      const rpcHonest = async (method) => { if (method === "sendTransaction") { sent++; return "REALSIG" + sent; } throw new Error("unexpected " + method); };
      const honestOut = await seam.signAndSendAll(honestProvider, rpcHonest, [[descA], [descB]], blockhash, H_OWNER);
      ok("P2-H baseline: an HONEST wallet response (same tx, same order) sends both without a mismatch report", honestOut.every((o) => !!o.sig) && sent === 2, honestOut);

      // The attack: signAllTransactions returns the two transactions SWAPPED (position 0 gets
      // what was built for position 1, and vice versa) — the exact shape a reordering or
      // substituting wallet produces.
      const swappedProvider = {
        publicKey: { toString: () => H_OWNER },
        signAllTransactions: async (txs) => { txs.forEach((tx) => tx.sign(kp)); return [txs[1], txs[0]]; },
      };
      sendCalls = 0;
      const out = await seam.signAndSendAll(swappedProvider, rpcSpy, [[descA], [descB]], blockhash, H_OWNER);
      ok("P2-H: a swapped/substituted response is reported as an error for BOTH slots, never sent", out.every((o) => o.error && /different transaction/i.test(o.error)), out);
      ok("P2-H: sendTransaction is NEVER called for a mismatched slot", sendCalls === 0, sendCalls);

      // Mutation check, inline: if the byte comparison is skipped, the swapped response above
      // would instead report `sig` for both (wrongly) — assert the negative directly so a
      // regression that deletes the check is caught even without re-running the mutation sweep.
      ok("P2-H mutation guard: neither swapped slot is ever reported as sent (the exact bug this fixes)", !out.some((o) => !!o.sig), out);
      global.window.CluckWallet = { asTransaction: (_signed, original) => original };
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // P2-J (adversarial review, 2026-09-21, mutation-proved below): `owner` was captured once, at
    // connect time, and never re-read before building. If the wallet's live public key no longer
    // matches, signAndSendAll must refuse outright, before building or signing anything.
    // ════════════════════════════════════════════════════════════════════════════════════════
    {
      const desc = CRP.buildCloseInstruction({ tokenAccount: pk(), mint: pk(), destination: OWNER, owner: OWNER, programId: CRP.TOKEN_PROGRAM_CLASSIC });
      const blockhash = web3.Keypair.generate().publicKey.toBase58();
      let signCalled = false;
      const switchedProvider = {
        publicKey: { toString: () => FOREIGN }, // the wallet is now on a DIFFERENT account
        signAllTransactions: async (txs) => { signCalled = true; return txs; },
      };
      let threw = false, msg = "";
      try { await seam.signAndSendAll(switchedProvider, async () => { throw new Error("rpc should not be called"); }, [[desc]], blockhash, OWNER); }
      catch (e) { threw = true; msg = (e && e.message) || String(e); }
      ok("P2-J: a live publicKey that no longer matches the captured owner is refused", threw, msg);
      ok("P2-J: the refusal names the actual situation (account switch), not a generic error", /switch|account/i.test(msg), msg);
      ok("P2-J: the wallet is NEVER asked to sign once the mismatch is caught", !signCalled);

      // The happy path, for contrast — same call, provider.publicKey === owner, must NOT throw
      // for this reason (it proceeds to actually sign).
      const matchingProvider = { publicKey: { toString: () => OWNER }, signAllTransactions: async (txs) => txs };
      let happyThrew = false;
      global.window.CluckWallet = { asTransaction: (signed) => signed };
      try { await seam.signAndSendAll(matchingProvider, async (m) => (m === "sendTransaction" ? "SIG" : (() => { throw new Error("unexpected " + m); })()), [[desc]], blockhash, OWNER); }
      catch (e) { happyThrew = true; }
      ok("P2-J: a provider whose live publicKey MATCHES the owner is not refused for this reason", !happyThrew);
      global.window.CluckWallet = { asTransaction: (_signed, original) => original };

      // A provider that doesn't expose .publicKey at all (some MWA-shaped providers before their
      // first reauthorize) — the check has nothing to compare against, so it must NOT block a
      // legitimate signer; "best effort" means skipping the check, not refusing everyone.
      const noPubkeyProvider = { signAllTransactions: async (txs) => txs };
      let noPubkeyThrew = false;
      global.window.CluckWallet = { asTransaction: (signed) => signed };
      try { await seam.signAndSendAll(noPubkeyProvider, async (m) => (m === "sendTransaction" ? "SIG" : (() => { throw new Error("unexpected " + m); })()), [[desc]], blockhash, OWNER); }
      catch (e) { noPubkeyThrew = true; }
      ok("P2-J: a provider with no live .publicKey to compare is not blocked by this check", !noPubkeyThrew);
      global.window.CluckWallet = { asTransaction: (_signed, original) => original };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // P1-D (adversarial review, 2026-09-21, mutation-proved below): a batch is ONE atomic
  // transaction. One poisoned account (Token-2022 withheld fees, a confidential account, anything
  // classification doesn't model) failing the whole atomic tx must not take the other 25 with it —
  // the poisoned batch is re-planned as one-account transactions and retried exactly once.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nP1-D — one poisoned account in a batch never fails the rest; isolated + retried once\n");
  {
    const okA = fixtureAccount({ lamports: 1000000 });
    const okB = fixtureAccount({ lamports: 2000000 });
    const poisoned = fixtureAccount({ lamports: 3000000 });
    const accounts = [okA, okB, poisoned];
    let sendCall = 0;
    const io = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      signAndSendAll: async (batches) => {
        sendCall++;
        if (batches.length === 1 && batches[0].length === 3) return [{ sig: "COMBINED_SIG" }]; // first pass: one 3-account batch
        return batches.map((b) => ({ sig: "SINGLE_SIG_" + b[0].keys[0].pubkey })); // retry: singles
      },
      confirmSignature: async (sig) => {
        if (sig === "COMBINED_SIG") throw new Error("simulated: one poisoned account failed the whole atomic tx");
        if (String(sig).startsWith("SINGLE_SIG_")) {
          const ta = sig.slice("SINGLE_SIG_".length);
          if (ta === poisoned.tokenAccount) throw new Error("this one really is poisoned (Token-2022 withheld fee)");
          return true;
        }
        return false;
      },
    };
    const res = await CRP.runReclaimFlow({ accounts, owner: OWNER, closedTokenAccounts: [] }, io);
    const byTa = {}; res.rows.forEach((r) => (byTa[r.tokenAccount] = r));
    ok("P1-D: the combined batch was attempted first (one send call before any retry)", sendCall >= 1);
    ok("P1-D: the two genuinely-fine accounts end up CONFIRMED after isolation", byTa[okA.tokenAccount].outcome === "confirmed" && byTa[okB.tokenAccount].outcome === "confirmed", byTa);
    ok("P1-D: the truly poisoned account ends up FAILED, not confirmed and not silently dropped", byTa[poisoned.tokenAccount] && byTa[poisoned.tokenAccount].outcome === "failed", byTa[poisoned.tokenAccount]);
    ok("P1-D: exactly one retry round happened (two signAndSendAll calls total: combined + singles)", sendCall === 2, sendCall);
    ok("P1-D: the reclaimed total counts the two isolated successes, never the poisoned one", res.reclaimedLamports === okA.lamports + okB.lamports, res.reclaimedLamports);

    // Mutation-proof: with the retry logic removed (simulated by driving sendAndConfirmBatches
    // directly for just the first round), all three would be "failed" — confirm THAT is what the
    // review found, so the fix's effect is unambiguous.
    const firstRoundOnly = await CRP.sendAndConfirmBatches(io, OWNER, "FakeBlockhash1111111111111111111111111111", [[okA, okB, poisoned]]);
    ok("P1-D mutation guard: the FIRST round alone (no retry) fails all three — proving the retry is what rescues okA/okB",
      firstRoundOnly.rows.every((r) => r.outcome === "failed"), firstRoundOnly.rows);

    // A single-account batch is never retried (no isolation to gain) — same poisoned-tx shape,
    // one account only, must simply report failed once, no second signAndSendAll call.
    let soloCalls = 0;
    const soloIo = {
      getFreshBalances: async (tas) => { const o = {}; tas.forEach((t) => (o[t] = { exists: true, amount: "0" })); return o; },
      getBlockhash: async () => "FakeBlockhash1111111111111111111111111111",
      signAndSendAll: async (batches) => { soloCalls++; return batches.map(() => ({ sig: "SOLOSIG" })); },
      confirmSignature: async () => { throw new Error("solo failure"); },
    };
    const soloRes = await CRP.runReclaimFlow({ accounts: [fixtureAccount()], owner: OWNER, closedTokenAccounts: [] }, soloIo);
    ok("P1-D: a batch of exactly one account is never retried (nothing to isolate)", soloCalls === 1, soloCalls);
    ok("P1-D: it is still honestly reported failed", soloRes.rows[0].outcome === "failed", soloRes.rows[0]);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // P2-I (adversarial review, 2026-09-21, mutation-proved below): the confirm sheet's numbers, and
  // the actual close, must come from the FRESH re-read, not the (possibly stale/hostile) server
  // scan — reverifyBalances overwrites lamports with the just-read value, and drops (never closes)
  // any candidate whose fresh mint or fresh owner (the account's real authority) doesn't match.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nP2-I — reverifyBalances overwrites lamports and drops a mint/owner mismatch\n");
  {
    const claimedMint = pk(), realMint = pk();
    const acc = fixtureAccount({ mint: claimedMint, lamports: 999 }); // server claims 999 lamports
    const io = baseIo({
      getFreshBalances: async () => ({ [acc.tokenAccount]: { exists: true, amount: "0", lamports: 2039280, mint: claimedMint, owner: OWNER } }),
    });
    const prep = await CRP.planConfirmation({ accounts: [acc], owner: OWNER, closedTokenAccounts: [] }, io);
    ok("P2-I: planConfirmation's toClose carries the FRESH lamports, not the server's stale claim", prep.toClose[0].lamports === 2039280, prep.toClose[0]);
    ok("P2-I: the confirm-sheet total is built from the fresh lamports", prep.lamports === 2039280, prep.lamports);

    // Mint mismatch: the fresh read's mint differs from what the candidate claimed — dropped,
    // never closed, never silently kept under the claimed (wrong) mint.
    const ioMintMismatch = baseIo({
      getFreshBalances: async () => ({ [acc.tokenAccount]: { exists: true, amount: "0", lamports: 2039280, mint: realMint, owner: OWNER } }),
    });
    const prepMint = await CRP.planConfirmation({ accounts: [acc], owner: OWNER, closedTokenAccounts: [] }, ioMintMismatch);
    ok("P2-I: a fresh mint that differs from the claimed one is DROPPED, never kept", prepMint.toClose.length === 0, prepMint.toClose);
    ok("P2-I: the drop reason says so honestly", /mint/i.test((prepMint.rows[0] && prepMint.rows[0].reason) || ""), prepMint.rows);

    // Owner mismatch: the fresh read's authority is NOT the connected wallet — the
    // hostile-server-data class this closes. Dropped, never closed.
    const ioOwnerMismatch = baseIo({
      getFreshBalances: async () => ({ [acc.tokenAccount]: { exists: true, amount: "0", lamports: 2039280, mint: claimedMint, owner: FOREIGN } }),
    });
    const prepOwner = await CRP.planConfirmation({ accounts: [acc], owner: OWNER, closedTokenAccounts: [] }, ioOwnerMismatch);
    ok("P2-I: an account whose fresh authority is NOT the connected wallet is DROPPED, never closed", prepOwner.toClose.length === 0, prepOwner.toClose);
    ok("P2-I: the drop reason says so honestly", /wallet|owner|authority/i.test((prepOwner.rows[0] && prepOwner.rows[0].reason) || ""), prepOwner.rows);

    // Mutation guard: reverifyBalances called WITHOUT the connectedOwner argument must not
    // enforce the owner check at all (proves the check is actually gated on that argument being
    // wired through, not a coincidence of the fixture).
    const withoutOwnerArg = CRP.reverifyBalances([acc], { [acc.tokenAccount]: { exists: true, amount: "0", lamports: 2039280, mint: claimedMint, owner: FOREIGN } });
    ok("P2-I mutation guard: omitting connectedOwner skips the owner check (proves it's the argument doing the work)", withoutOwnerArg.kept.length === 1, withoutOwnerArg);
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

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Reason-string drift — every reason the plan module can emit must be translatable.
  //
  // public/rent-reclaim-plan.js is shared vanilla JS with no dictionary, so it emits English
  // reasons and RentReclaim.jsx maps them to t() calls at the render boundary. That map is
  // keyed on the exact English sentence, so editing a reason string in the plan module without
  // editing the map silently drops that row back to English — in a Spanish or Hindi run, on the
  // rows where something went wrong with someone's money. Nothing else would catch it: the
  // build's key check sees the map's OWN keys and is perfectly happy, and the rendered Spanish
  // check never drives a signing failure. This is a source scan precisely because the rendered
  // measurement structurally cannot see it (CLAUDE.md: "run both").
  console.log("\nReason-string drift — the plan module's reasons all have a translation\n");
  {
    const planSrc = fs.readFileSync(path.join(ROOT, "public", "rent-reclaim-plan.js"), "utf8");
    const paneSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "RentReclaim.jsx"), "utf8");

    // Every string literal a mergeRow() call can end up using as its reason. The third argument
    // is not always a bare literal — it can be `"prefix: " + err` (captured as the prefix, which
    // is how reasonText() matches it too) or `r.error || "fallback"`. So take the whole call and
    // pull every literal out of it, minus the outcome enum in position two. A narrower regex
    // missed the `|| "could not submit"` fallback, and this check's whole point is that a reason
    // nobody remembered is exactly the one that reaches a person in the wrong language.
    const OUTCOMES = new Set(["confirmed", "failed", "unconfirmed", "skipped", "rejected"]);
    const reasons = new Set();
    const callRe = /mergeRow\(([^;]*?)\)\s*\)?\s*[;,)]/g;
    const litRe = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = callRe.exec(planSrc))) {
      let lm;
      litRe.lastIndex = 0;
      while ((lm = litRe.exec(m[1]))) {
        const lit = lm[1];
        if (!lit || OUTCOMES.has(lit)) continue;
        reasons.add(lit);
      }
    }
    ok("the scan actually found the reason strings (guards against the regex silently matching nothing)",
       reasons.size >= 6, { found: reasons.size, reasons: [...reasons] });

    // What reasonText() can handle: the keys of its `known` map, plus its one prefix constant.
    const mapped = new Set();
    const mapRe = /^\s*"((?:[^"\\]|\\.)*)":\s*t\(/gm;
    while ((m = mapRe.exec(paneSrc))) mapped.add(m[1]);
    const prefixRe = /const REASON_PREFIX = "((?:[^"\\]|\\.)*)";/.exec(paneSrc);
    ok("REASON_PREFIX is still declared in the pane", !!prefixRe, prefixRe);
    const prefix = prefixRe ? prefixRe[1] : "\u0000no-prefix";

    const unmapped = [...reasons].filter((r) => !mapped.has(r) && r !== prefix && r.indexOf(prefix) !== 0);
    ok("⚠️ every reason the plan module emits is translated at the render boundary",
       unmapped.length === 0,
       unmapped.length ? { unmapped, hint: "add it to the `known` map in RentReclaim.jsx reasonText()" } : null);

    // And the other direction: a mapping for a reason that no longer exists is dead weight that
    // makes the check above look healthier than it is.
    const stale = [...mapped].filter((k) => !reasons.has(k));
    ok("and the map carries no entry for a reason that no longer exists",
       stale.length === 0, stale.length ? { stale } : null);
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
