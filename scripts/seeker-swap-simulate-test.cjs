#!/usr/bin/env node
"use strict";
// Seeker app in-app swap — the PRE-SIGN SIMULATION GATE (docs/SEEKER_SWAP_DESIGN.md, frontier
// adversarial review round 31b, item 4: "the route plan / remaining accounts are never checked and
// ALTs can contain any address, so 'moves nothing but in/out, at most inAmount' is not proven by
// instruction decoding alone").
//
// src/seeker/swap-simulate.js is pure (no window, no fetch, no RPC call of its own) — this drives
// it directly with hand-built `simulateTransaction`-shaped results.
//
// Usage: node scripts/seeker-swap-simulate-test.cjs

const path = require("path");
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

const SOL_ADDR = "8yLXmZbFRRjMv4pW6dS4Bqf3xmH8N1nq9GVU3QbdxwXk";
const IN_MINT = "So11111111111111111111111111111111111111112"; // native SOL, wrapped
const OUT_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const OTHER_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"; // CLKN — an unrelated mint

const SOL_BEFORE = 2_000_000_000n; // 2 SOL
const IN_AMOUNT = 10_000_000n; // 0.01 SOL
const MIN_RECEIVED = 54_682_758n; // floor-computed minimum, matches the real fixture's window
const FEE_LAMPORTS = 441362n;
const OUT_BEFORE = 100_000_000n; // some pre-existing SKR balance
const OTHER_BEFORE = 5_000_000n; // some pre-existing CLKN balance, must stay untouched

function tokenEntry(mint, amount) {
  return { data: { program: "spl-token", parsed: { type: "account", info: { mint, tokenAmount: { amount: String(amount) } } } } };
}
function solEntry(lamports) { return { lamports: String(lamports) }; }

// A well-formed, HONEST simulation: SOL falls by inAmount + fee (input is SOL, no new ATA), the
// output mint rises by exactly the minimum, the unrelated mint is untouched. This is the shape a
// genuine swap of this pane's own recorded fixture would produce.
function honestLabelsAndResult() {
  const addressLabels = [
    { kind: "sol", before: String(SOL_BEFORE) },
    { kind: "token", mint: OUT_MINT, before: String(OUT_BEFORE) },
    { kind: "token", mint: OTHER_MINT, before: String(OTHER_BEFORE) },
  ];
  const simResult = {
    err: null,
    accounts: [
      solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS),
      tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED),
      tokenEntry(OTHER_MINT, OTHER_BEFORE),
    ],
  };
  return { addressLabels, simResult };
}
const baseArgs = () => ({
  inputMint: IN_MINT, outputMint: OUT_MINT, inAmount: String(IN_AMOUNT), minReceived: String(MIN_RECEIVED),
  feeLamports: String(FEE_LAMPORTS), inputIsSol: true, allowedNewAtaCount: 0,
});

(async () => {
  console.log("\nSeeker swap — pre-sign simulation gate (swap-simulate.js)\n");

  const mod = await import(path.join(ROOT, "src", "seeker", "swap-simulate.js") + "?t=" + Date.now());
  const { verifySimulationResult, ATA_RENT_LAMPORTS, buildInventory } = mod;

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("(1) exact expected — a genuine, honest simulation passes\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    const r = verifySimulationResult({ simResult, addressLabels, ...baseArgs() });
    ok("the honest simulation (SOL falls by inAmount+fee, output rises by exactly the minimum, unrelated mint untouched) -> passes", r.ok === true, r);

    // Output rising by MORE than the minimum is also fine (favourable to the person).
    const generous = { addressLabels, simResult: Object.assign({}, simResult, { accounts: [simResult.accounts[0], tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED + 1000n), simResult.accounts[2]] }) };
    const r2 = verifySimulationResult({ simResult: generous.simResult, addressLabels, ...baseArgs() });
    ok("output rising by MORE than the computed minimum -> still passes", r2.ok === true, r2);

    // SOL rising (e.g. an existing wSOL ATA's rent refunded) is fine too — only an EXCESS outflow refuses.
    const solRose = Object.assign({}, simResult, { accounts: [solEntry(SOL_BEFORE + 1000n), simResult.accounts[1], simResult.accounts[2]] });
    const r3 = verifySimulationResult({ simResult: solRose, addressLabels, ...baseArgs() });
    ok("SOL balance RISING overall -> still passes (only excess outflow refuses)", r3.ok === true, r3);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(2) extra mint moved — refused, never passed\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    const tampered = Object.assign({}, simResult, { accounts: [simResult.accounts[0], simResult.accounts[1], tokenEntry(OTHER_MINT, OTHER_BEFORE - 1n)] });
    const r = verifySimulationResult({ simResult: tampered, addressLabels, ...baseArgs() });
    ok("an unrelated mint's balance changed by even 1 base unit -> refused", r.ok === false && /never mentioned/i.test(r.reason), r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(3) input over-drawn — refused, never passed\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    // SOL falls by inAmount+fee+1 extra lamport of INPUT drawdown beyond what's allowed — model
    // this as the input mint being a real token (non-SOL input) so the token-delta path is hit
    // directly, independent of the SOL-outflow check.
    const nonSolLabels = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: IN_MINT === OUT_MINT ? OTHER_MINT : "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", before: String(IN_AMOUNT) },
      { kind: "token", mint: OUT_MINT, before: String(OUT_BEFORE) },
    ];
    const inputMintHere = nonSolLabels[1].mint;
    // Give the input token a starting balance well above inAmount, then have it fall by
    // (inAmount + 1) — one base unit more than the quote's own inAmount allows.
    const beforeBig = IN_AMOUNT * 2n;
    nonSolLabels[1].before = String(beforeBig);
    const nonSolResult = {
      err: null,
      accounts: [
        solEntry(SOL_BEFORE - FEE_LAMPORTS), // input isn't SOL, so only the fee leaves
        tokenEntry(inputMintHere, beforeBig - IN_AMOUNT - 1n), // fell by inAmount+1 -> over the cap
        tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED),
      ],
    };
    const r = verifySimulationResult({
      simResult: nonSolResult, addressLabels: nonSolLabels,
      inputMint: inputMintHere, outputMint: OUT_MINT, inAmount: String(IN_AMOUNT), minReceived: String(MIN_RECEIVED),
      feeLamports: String(FEE_LAMPORTS), inputIsSol: false, allowedNewAtaCount: 0,
    });
    ok("the input token fell by MORE than the quote's inAmount -> refused", r.ok === false && /more of the token you're paying with/i.test(r.reason), r);

    // Sanity: the input token RISING is refused outright, regardless of amount.
    const rose = Object.assign({}, nonSolResult, { accounts: [nonSolResult.accounts[0], tokenEntry(inputMintHere, beforeBig + 1n), nonSolResult.accounts[2]] });
    const r2 = verifySimulationResult({
      simResult: rose, addressLabels: nonSolLabels,
      inputMint: inputMintHere, outputMint: OUT_MINT, inAmount: String(IN_AMOUNT), minReceived: String(MIN_RECEIVED),
      feeLamports: String(FEE_LAMPORTS), inputIsSol: false, allowedNewAtaCount: 0,
    });
    ok("the input token balance RISING -> refused outright", r2.ok === false && /increase the token you're paying with/i.test(r2.reason), r2);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(4) SOL over-drawn — refused, never passed\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    const tampered = Object.assign({}, simResult, { accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS - 1n), simResult.accounts[1], simResult.accounts[2]] });
    const r = verifySimulationResult({ simResult: tampered, addressLabels, ...baseArgs() });
    ok("SOL fell by ONE lamport more than inAmount+fee allows -> refused", r.ok === false && /more sol/i.test(r.reason), r);

    // A legitimately allowed ATA-create rent cost is accepted when allowedNewAtaCount reflects it.
    const withAta = Object.assign({}, simResult, { accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS - BigInt(ATA_RENT_LAMPORTS)), simResult.accounts[1], simResult.accounts[2]] });
    const rOk = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), allowedNewAtaCount: 1 });
    ok("SOL falling by inAmount+fee+ONE ATA's rent, with allowedNewAtaCount:1 -> passes", rOk.ok === true, rOk);
    const rTooMany = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), allowedNewAtaCount: 0 });
    ok("the SAME outflow with allowedNewAtaCount:0 (no create was actually permitted) -> refused", rTooMany.ok === false, rTooMany);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(5) simulation error — refused, never passed\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    const errored = Object.assign({}, simResult, { err: { InstructionError: [3, "Custom"] } });
    const r = verifySimulationResult({ simResult: errored, addressLabels, ...baseArgs() });
    ok("simResult.err set -> refused, quoting the error", r.ok === false && /would fail on-chain/i.test(r.reason), r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(6) missing account in response — refused, NEVER passed\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();

    // Fewer entries than requested addresses — the response is simply incomplete.
    const short = Object.assign({}, simResult, { accounts: simResult.accounts.slice(0, 2) });
    const r1 = verifySimulationResult({ simResult: short, addressLabels, ...baseArgs() });
    ok("accounts array shorter than addressLabels -> refused (incomplete)", r1.ok === false && /incomplete/i.test(r1.reason), r1);

    // accounts not an array at all.
    const notArray = Object.assign({}, simResult, { accounts: null });
    const r2 = verifySimulationResult({ simResult: notArray, addressLabels, ...baseArgs() });
    ok("accounts missing entirely -> refused (incomplete)", r2.ok === false && /incomplete/i.test(r2.reason), r2);

    // The SOL entry (index 0) itself missing/null — never valid, the fee payer always exists.
    const noSol = Object.assign({}, simResult, { accounts: [null, simResult.accounts[1], simResult.accounts[2]] });
    const r3 = verifySimulationResult({ simResult: noSol, addressLabels, ...baseArgs() });
    ok("the SOL account entry is null -> refused, never treated as a zero balance", r3.ok === false && /sol balance was missing/i.test(r3.reason), r3);

    // A token entry whose parsed shape is malformed (no tokenAmount) — refused, never guessed as 0.
    const malformed = Object.assign({}, simResult, { accounts: [simResult.accounts[0], { data: { parsed: { info: {} } } }, simResult.accounts[2]] });
    const r4 = verifySimulationResult({ simResult: malformed, addressLabels, ...baseArgs() });
    ok("a token entry with no readable tokenAmount -> refused, never guessed", r4.ok === false && /could not be understood/i.test(r4.reason), r4);

    // A token entry that is explicitly `null` (account closed/doesn't exist) IS valid and reads as
    // zero — proving the module distinguishes "legitimately absent" from "malformed".
    const closedOutput = Object.assign({}, simResult, { accounts: [simResult.accounts[0], null, simResult.accounts[2]] });
    const r5 = verifySimulationResult({ simResult: closedOutput, addressLabels, ...baseArgs() });
    ok("output account entry explicitly null (reads as 0, a real balance) -> refused because 0 < the minimum (not because it's malformed)",
      r5.ok === false && /less than the minimum/i.test(r5.reason), r5);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(7) output under the minimum — refused\n");
  {
    const { addressLabels, simResult } = honestLabelsAndResult();
    const under = Object.assign({}, simResult, { accounts: [simResult.accounts[0], tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED - 1n), simResult.accounts[2]] });
    const r = verifySimulationResult({ simResult: under, addressLabels, ...baseArgs() });
    ok("output balance rose by ONE base unit less than the computed minimum -> refused", r.ok === false && /less than the minimum/i.test(r.reason), r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(8) verifier follow-up 2 — a pre-existing wSOL ATA must SHARE the inAmount bound with native SOL, never add to it\n");
  {
    // A pre-existing wSOL ATA (before this swap even runs) that falls by the FULL inAmount, WHILE
    // native SOL ALSO falls by inAmount+fee (the "normal" allowance on its own) — bounding each
    // independently would let 2x inAmount leave the wallet. The combined bound must catch it.
    const WSOL_ATA_BEFORE = 500_000_000n; // the wallet already held some wSOL before this swap
    const addressLabelsWithWsol = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: IN_MINT, before: String(WSOL_ATA_BEFORE) }, // the pre-existing wSOL ATA
      { kind: "token", mint: OUT_MINT, before: String(OUT_BEFORE) },
    ];
    const doubleSpendResult = {
      err: null,
      accounts: [
        solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS), // native SOL falls by inAmount+fee, on its own "allowed"
        tokenEntry(IN_MINT, WSOL_ATA_BEFORE - IN_AMOUNT), // the pre-existing wSOL ATA ALSO falls by inAmount
        tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED),
      ],
    };
    const r = verifySimulationResult({ simResult: doubleSpendResult, addressLabels: addressLabelsWithWsol, ...baseArgs() });
    ok("the double-accounting case — native SOL falls by inAmount+fee AND a pre-existing wSOL ATA ALSO falls by inAmount -> refused (combined, not independent, bound)",
      r.ok === false && /native and wrapped combined/i.test(r.reason), r);

    // The normal case: no pre-existing wSOL ATA in the inventory at all (created and closed
    // WITHIN this same transaction, so it never appears in the wallet's pre-tx inventory), native
    // SOL falls by exactly inAmount+fee -> still passes exactly as section (1) already proved.
    const { addressLabels: normalLabels, simResult: normalResult } = honestLabelsAndResult();
    const rNormal = verifySimulationResult({ simResult: normalResult, addressLabels: normalLabels, ...baseArgs() });
    ok("the normal case — no pre-existing wSOL ATA, native SOL falls by inAmount+fee -> still passes", rNormal.ok === true, rNormal);

    // A pre-existing wSOL ATA that DOESN'T move at all (this swap ignores it entirely) must not
    // be penalised — zero contribution to the combined bound.
    const untouchedWsol = Object.assign({}, doubleSpendResult, { accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS), tokenEntry(IN_MINT, WSOL_ATA_BEFORE), doubleSpendResult.accounts[2]] });
    const rUntouched = verifySimulationResult({ simResult: untouchedWsol, addressLabels: addressLabelsWithWsol, ...baseArgs() });
    ok("a pre-existing wSOL ATA that does not move at all -> passes (native SOL alone still within inAmount+fee)", rUntouched.ok === true, rUntouched);

    // Split exactly at the boundary: native SOL contributes NOTHING beyond fee (no inAmount drawn
    // from native SOL), and the wSOL ATA falls by exactly inAmount — the combined total is exactly
    // inAmount, which must still pass (the ceiling is inclusive).
    const splitExact = Object.assign({}, doubleSpendResult, { accounts: [solEntry(SOL_BEFORE - FEE_LAMPORTS), tokenEntry(IN_MINT, WSOL_ATA_BEFORE - IN_AMOUNT), doubleSpendResult.accounts[2]] });
    const rSplit = verifySimulationResult({ simResult: splitExact, addressLabels: addressLabelsWithWsol, ...baseArgs() });
    ok("all of inAmount drawn from the pre-existing wSOL ATA, none from native SOL beyond the fee -> passes (combined == inAmount, inclusive)", rSplit.ok === true, rSplit);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(9) verifier follow-up 1 — buildInventory() refuses on a malformed getTokenAccountsByOwner result, never silently []\n");
  {
    const goodSol = { context: { slot: 1 }, value: 1_000_000_000 };
    const goodLegacy = { context: { slot: 1 }, value: [{ pubkey: "LEGACYacct1111111111111111111111111111111", account: { data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: "500" } } } } } }] };
    const goodToken22 = { context: { slot: 1 }, value: [] };

    // Each of the four malformed shapes the reviewer named, on EITHER token-program result —
    // never silently treated as "holds nothing" (which is what `.value || []` used to do).
    const malformedShapes = [
      { label: "{}", value: {} },
      { label: "undefined", value: undefined },
      { label: "{value:null}", value: { value: null } },
      { label: "{value:\"x\"}", value: { value: "x" } },
    ];
    for (const shape of malformedShapes) {
      const rLegacy = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: shape.value, token22Accts: goodToken22 });
      ok(`legacy token accounts malformed as ${shape.label} -> refused, never silently []`,
        rLegacy.ok === false && /token accounts/i.test(rLegacy.reason), rLegacy);

      const rToken22 = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: goodLegacy, token22Accts: shape.value });
      ok(`Token-2022 accounts malformed as ${shape.label} -> refused, never silently []`,
        rToken22.ok === false && /token accounts/i.test(rToken22.reason), rToken22);
    }

    // The SOL balance read is held to the same standard (already true before this fix, re-pinned
    // here alongside the token-account cases for a single source of truth on buildInventory).
    for (const shape of malformedShapes) {
      const rSol = buildInventory({ live: SOL_ADDR, solRes: shape.value, legacyAccts: goodLegacy, token22Accts: goodToken22 });
      ok(`SOL balance malformed as ${shape.label} -> refused, never treated as a zero balance`,
        rSol.ok === false && /sol balance/i.test(rSol.reason), rSol);
    }

    // A REAL, well-formed shape (both programs, one holding, one empty) -> ok, with the addresses
    // and labels shaped exactly as verifySimulationResult expects.
    const rGood = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: goodLegacy, token22Accts: goodToken22 });
    ok("a real, well-formed inventory -> ok", rGood.ok === true, rGood);
    ok("…addresses = [live, the one legacy token account's pubkey]", JSON.stringify(rGood.addresses) === JSON.stringify([SOL_ADDR, "LEGACYacct1111111111111111111111111111111"]), rGood.addresses);
    ok("…labels = [sol, the one token label with its mint/before]",
      rGood.labels.length === 2 && rGood.labels[0].kind === "sol" && rGood.labels[0].before === "1000000000"
      && rGood.labels[1].kind === "token" && rGood.labels[1].mint === OTHER_MINT && rGood.labels[1].before === "500", rGood.labels);

    // An unreadable INDIVIDUAL entry (not the whole `.value`) is dropped from the label set rather
    // than refusing the whole inventory — unchanged behaviour from before this fix, re-pinned here.
    const oneBadEntry = { context: { slot: 1 }, value: [{ pubkey: "X", account: { data: { parsed: { info: {} } } } }, { pubkey: "LEGACYacct1111111111111111111111111111111", account: { data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: "500" } } } } } }] };
    const rMixed = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: oneBadEntry, token22Accts: goodToken22 });
    ok("one unreadable entry among several -> that entry dropped, the rest kept, still ok",
      rMixed.ok === true && rMixed.labels.length === 2 && rMixed.addresses.length === 2, rMixed);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(10) Codex round 33 on #420 — finding 1: a wallet with NO output account yet must still be held to the minimum\n");
  {
    // The wallet holds no account for the output mint (it will be created by this swap). Before
    // the fix the inventory had no output label, nothing was compared, and a ZERO-output
    // simulation passed. Now: no output label at all -> refusal, never a pass.
    const noOutputLabels = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: OTHER_MINT, before: String(OTHER_BEFORE) },
    ];
    const zeroOutput = { err: null, accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS), tokenEntry(OTHER_MINT, OTHER_BEFORE)] };
    const r0 = verifySimulationResult({ simResult: zeroOutput, addressLabels: noOutputLabels, ...baseArgs() });
    ok("no output-mint account in the checked set (zero output delivered) -> REFUSED, not passed", r0.ok === false && /no account for the token you're buying/i.test(r0.reason), r0);

    // buildInventory appends the verifier's output ATA candidates when the wallet has none, with
    // before = 0 — so the account this swap creates is read after simulation like any other.
    const goodSol = { context: { slot: 1 }, value: Number(SOL_BEFORE) };
    const legacyOnlyOther = { context: { slot: 1 }, value: [{ pubkey: "OTHERacct11111111111111111111111111111111", account: { data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: String(OTHER_BEFORE) } } } } } }] };
    const empty22 = { context: { slot: 1 }, value: [] };
    const OUT_ATA_LEGACY = "OUTata1legacy111111111111111111111111111111";
    const OUT_ATA_2022 = "OUTata2token2022111111111111111111111111111";
    const inv = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: legacyOnlyOther, token22Accts: empty22, outputMint: OUT_MINT, outputAtas: [OUT_ATA_LEGACY, OUT_ATA_2022] });
    ok("buildInventory appends BOTH output ATA candidates (before=0, expected) when the wallet holds neither",
      inv.ok === true && inv.addresses.length === 4 && inv.addresses[2] === OUT_ATA_LEGACY && inv.addresses[3] === OUT_ATA_2022
      && inv.labels[2].mint === OUT_MINT && inv.labels[2].before === "0" && inv.labels[2].expected === true
      && inv.labels[3].mint === OUT_MINT && inv.labels[3].before === "0", inv);
    // The created (legacy) ATA reads the minimum after simulation; the unused Token-2022
    // derivation reads null (a real 0) -> passes.
    const created = { err: null, accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS - BigInt(ATA_RENT_LAMPORTS)), tokenEntry(OTHER_MINT, OTHER_BEFORE), tokenEntry(OUT_MINT, MIN_RECEIVED), null] };
    const rCreated = verifySimulationResult({ simResult: created, addressLabels: inv.labels, ...baseArgs(), allowedNewAtaCount: 1 });
    ok("the swap creates the output ATA and pays exactly the minimum into it (other derivation null) -> passes", rCreated.ok === true, rCreated);
    // Same shape but the created account holds ONE base unit less than the minimum -> refused.
    const short = Object.assign({}, created, { accounts: [created.accounts[0], created.accounts[1], tokenEntry(OUT_MINT, MIN_RECEIVED - 1n), null] });
    const rShort = verifySimulationResult({ simResult: short, addressLabels: inv.labels, ...baseArgs(), allowedNewAtaCount: 1 });
    ok("…one base unit under the minimum into the created account -> refused", rShort.ok === false && /less than the minimum/i.test(rShort.reason), rShort);
    // Both output candidates null after simulation (nothing was delivered anywhere) -> refused.
    const nothing = Object.assign({}, created, { accounts: [created.accounts[0], created.accounts[1], null, null] });
    const rNothing = verifySimulationResult({ simResult: nothing, addressLabels: inv.labels, ...baseArgs(), allowedNewAtaCount: 1 });
    ok("…neither output candidate exists after simulation (zero delivered) -> refused", rNothing.ok === false && /less than the minimum/i.test(rNothing.reason), rNothing);
    // An output ATA the wallet ALREADY holds is not duplicated by the candidates list.
    const legacyWithOut = { context: { slot: 1 }, value: [{ pubkey: OUT_ATA_LEGACY, account: { data: { parsed: { info: { mint: OUT_MINT, tokenAmount: { amount: String(OUT_BEFORE) } } } } } }] };
    const inv2 = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: legacyWithOut, token22Accts: empty22, outputMint: OUT_MINT, outputAtas: [OUT_ATA_LEGACY, OUT_ATA_2022] });
    ok("an output ATA already in the inventory is not listed twice; only the missing derivation is appended",
      inv2.ok === true && inv2.addresses.length === 3 && inv2.addresses.filter((a) => a === OUT_ATA_LEGACY).length === 1 && inv2.addresses[2] === OUT_ATA_2022, inv2.addresses);
    ok("with no outputMint/outputAtas passed, buildInventory is byte-for-byte what it was (every existing caller unchanged)",
      JSON.stringify(buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: legacyOnlyOther, token22Accts: empty22 }).addresses) === JSON.stringify([SOL_ADDR, "OTHERacct11111111111111111111111111111111"]));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(11) Codex round 33 on #420 — finding 2: several accounts for one mint are SUMMED, on both sides\n");
  {
    // Two output accounts (an ATA plus an auxiliary account). The swap pays the full minimum into
    // ONE and leaves the other untouched — a valid swap that the per-account rule used to refuse.
    const twoOutLabels = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: OUT_MINT, before: String(OUT_BEFORE) },
      { kind: "token", mint: OUT_MINT, before: "7" },
    ];
    const oneGets = { err: null, accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS), tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED), tokenEntry(OUT_MINT, 7n)] };
    const rOne = verifySimulationResult({ simResult: oneGets, addressLabels: twoOutLabels, ...baseArgs() });
    ok("two output accounts, the full minimum into one and the other unchanged -> passes", rOne.ok === true, rOne);
    const half = MIN_RECEIVED / 2n;
    const split = Object.assign({}, oneGets, { accounts: [oneGets.accounts[0], tokenEntry(OUT_MINT, OUT_BEFORE + half), tokenEntry(OUT_MINT, 7n + (MIN_RECEIVED - half))] });
    const rSplit = verifySimulationResult({ simResult: split, addressLabels: twoOutLabels, ...baseArgs() });
    ok("the minimum split across the two accounts (sum == minimum) -> passes", rSplit.ok === true, rSplit);
    const under = Object.assign({}, oneGets, { accounts: [oneGets.accounts[0], tokenEntry(OUT_MINT, OUT_BEFORE + half), tokenEntry(OUT_MINT, 7n + (MIN_RECEIVED - half) - 1n)] });
    const rUnder = verifySimulationResult({ simResult: under, addressLabels: twoOutLabels, ...baseArgs() });
    ok("…the sum one base unit under the minimum -> refused", rUnder.ok === false && /less than the minimum/i.test(rUnder.reason), rUnder);
    // One output account RISES by the minimum while the other FALLS — the net is what the person
    // actually receives, and the net is under the minimum.
    const drained = Object.assign({}, oneGets, { accounts: [oneGets.accounts[0], tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED), tokenEntry(OUT_MINT, 0n)] });
    const rDrained = verifySimulationResult({ simResult: drained, addressLabels: twoOutLabels, ...baseArgs() });
    ok("one output account gains the minimum while another output account is drained -> refused (net, not per-account)", rDrained.ok === false && /less than the minimum/i.test(rDrained.reason), rDrained);

    // The INPUT side has the same shape in reverse: two input accounts (non-SOL input), each
    // falling by the full inAmount, used to pass each check on its own — 2x inAmount leaving.
    const IN_TOKEN = "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const twoInLabels = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: IN_TOKEN, before: String(IN_AMOUNT * 2n) },
      { kind: "token", mint: IN_TOKEN, before: String(IN_AMOUNT * 2n) },
      { kind: "token", mint: OUT_MINT, before: String(OUT_BEFORE) },
    ];
    const inArgs = { ...baseArgs(), inputMint: IN_TOKEN, inputIsSol: false };
    const doubleIn = { err: null, accounts: [solEntry(SOL_BEFORE - FEE_LAMPORTS), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED)] };
    const rDouble = verifySimulationResult({ simResult: doubleIn, addressLabels: twoInLabels, ...inArgs });
    ok("two input accounts EACH falling by inAmount (2x leaving) -> refused (summed, not per-account)", rDouble.ok === false && /more of the token you're paying with/i.test(rDouble.reason), rDouble);
    const halfIn = IN_AMOUNT / 2n;
    const splitIn = Object.assign({}, doubleIn, { accounts: [doubleIn.accounts[0], tokenEntry(IN_TOKEN, IN_AMOUNT * 2n - halfIn), tokenEntry(IN_TOKEN, IN_AMOUNT * 2n - (IN_AMOUNT - halfIn)), doubleIn.accounts[3]] });
    const rSplitIn = verifySimulationResult({ simResult: splitIn, addressLabels: twoInLabels, ...inArgs });
    ok("inAmount drawn half from each input account (sum == inAmount) -> passes", rSplitIn.ok === true, rSplitIn);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(12) Codex round 33 on #420 — NATIVE SOL OUTPUT: the minimum is checked on the SOL position, fee and rent accounted for\n");
  {
    const IN_TOKEN = "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const WSOL_ATA = "WSOLata11111111111111111111111111111111111";
    const rent = BigInt(ATA_RENT_LAMPORTS);
    // Selling a token for SOL: the wallet holds the input token and (before the swap) no wSOL
    // account — the inventory appends the wSOL ATA candidate at before=0 (finding 1's mechanism).
    const labels = [
      { kind: "sol", before: String(SOL_BEFORE) },
      { kind: "token", mint: IN_TOKEN, before: String(IN_AMOUNT * 2n) },
      { kind: "token", mint: OTHER_MINT, before: String(OTHER_BEFORE) },
      { kind: "token", mint: IN_MINT, before: "0", expected: true },   // IN_MINT is the wSOL mint id
    ];
    const args = { ...baseArgs(), inputMint: IN_TOKEN, outputMint: IN_MINT, inputIsSol: false, allowedNewAtaCount: 1 };
    const sim = (solAfter, wsolAfter) => ({ err: null, accounts: [solEntry(solAfter), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OTHER_MINT, OTHER_BEFORE), wsolAfter == null ? null : tokenEntry(IN_MINT, wsolAfter)] });

    // Honest unwrap: the wSOL account was created, paid, and closed in the same transaction (reads
    // null); native SOL rose by the minimum less the fee (the temp account's rent came back).
    const rHonest = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS, null), addressLabels: labels, ...args });
    ok("SOL output, honest unwrap (wSOL account closed, native SOL up by minimum − fee) -> passes", rHonest.ok === true, rHonest);
    // The same with the temp account left OPEN holding its rent (Jupiter always closes it, but
    // the gate must not depend on that): native SOL up by minimum − fee − rent, wSOL account
    // exists with 0 tokens -> passes (rent credited for the one allowed create).
    const rOpen = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS - rent, 0n), addressLabels: labels, ...args });
    ok("…temp wSOL account left open (rent retained, 0 tokens) -> passes, rent credited once", rOpen.ok === true, rOpen);
    // Insufficient: one lamport under the minimum, with every credit already granted -> refused.
    const rShort = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS - rent - 1n, 0n), addressLabels: labels, ...args });
    ok("…one lamport under the minimum after fee and rent are credited -> refused", rShort.ok === false && /less than the minimum/i.test(rShort.reason), rShort);
    // No create allowed at all (allowedNewAtaCount 0): the only credit is the fee.
    const args0 = { ...args, allowedNewAtaCount: 0 };
    const rExact0 = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS, null), addressLabels: labels, ...args0 });
    ok("no create allowed: native SOL up by exactly minimum − fee -> passes", rExact0.ok === true, rExact0);
    const rShort0 = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS - 1n, null), addressLabels: labels, ...args0 });
    ok("no create allowed: one lamport under minimum − fee -> refused (no rent slack without an allowed create)", rShort0.ok === false && /less than the minimum/i.test(rShort0.reason), rShort0);
    // Nothing received: SOL only fell by the fee, wSOL never existed -> refused.
    const rNothing = verifySimulationResult({ simResult: sim(SOL_BEFORE - FEE_LAMPORTS, null), addressLabels: labels, ...args });
    ok("SOL output but native SOL only fell by the fee (nothing received) -> refused", rNothing.ok === false && /less than the minimum/i.test(rNothing.reason), rNothing);
    // Paid into a PRE-EXISTING wSOL account instead of unwrapping (no native change but the fee):
    // the wSOL account rises by the minimum -> the SOL position gained the minimum -> passes.
    const labelsHeld = [labels[0], labels[1], labels[2], { kind: "token", mint: IN_MINT, before: "1000" }];
    const rHeld = verifySimulationResult({ simResult: sim(SOL_BEFORE - FEE_LAMPORTS, 1000n + MIN_RECEIVED), addressLabels: labelsHeld, ...args0 });
    ok("output paid into a pre-existing wSOL account (no unwrap) -> passes (native + wrapped is one position)", rHeld.ok === true, rHeld);
    // …and a pre-existing wSOL account DRAINED to fake a native rise is caught: native up by the
    // minimum − fee but the wSOL account fell by the same amount — net zero received.
    const rShuffle = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS, 1000n - MIN_RECEIVED > 0n ? 1000n - MIN_RECEIVED : 0n), addressLabels: [labels[0], labels[1], labels[2], { kind: "token", mint: IN_MINT, before: String(MIN_RECEIVED + 1000n) }], ...args0 });
    ok("native SOL up by the minimum but a pre-existing wSOL account drained by the same amount (net 0) -> refused", rShuffle.ok === false && /less than the minimum/i.test(rShuffle.reason), rShuffle);
    // Input SOL AND output SOL is not a swap the gate can reason about -> refused, never passed.
    const rSame = verifySimulationResult({ simResult: sim(SOL_BEFORE, null), addressLabels: labels, ...args, inputMint: IN_MINT, inputIsSol: true });
    ok("input SOL and output SOL (same asset both sides) -> refused", rSame.ok === false && /same asset/i.test(rSame.reason), rSame);
    // Missing SOL entry with SOL output: refused as malformed, never read as "received 0" or skipped.
    const missingSol = { err: null, accounts: [null, tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OTHER_MINT, OTHER_BEFORE), null] };
    const rMissing = verifySimulationResult({ simResult: missingSol, addressLabels: labels, ...args });
    ok("SOL output with the SOL entry missing from the simulation -> refused as malformed, never skipped", rMissing.ok === false && /sol balance was missing/i.test(rMissing.reason), rMissing);
    // The input side is still bounded on a SOL-output swap: the input token falling by inAmount+1 -> refused.
    const overIn = { err: null, accounts: [solEntry(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS), tokenEntry(IN_TOKEN, IN_AMOUNT - 1n), tokenEntry(OTHER_MINT, OTHER_BEFORE), null] };
    const rOverIn = verifySimulationResult({ simResult: overIn, addressLabels: labels, ...args });
    ok("SOL output: the input token falling by inAmount+1 -> still refused", rOverIn.ok === false && /more of the token you're paying with/i.test(rOverIn.reason), rOverIn);
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
