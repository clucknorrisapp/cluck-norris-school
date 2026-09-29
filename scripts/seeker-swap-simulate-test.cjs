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

// Round 34: every token account carries its LAMPORTS — rent, plus the wrapped amount for a wSOL
// account — because the gate now reasons about the wallet's whole SOL position (native + every
// token account's lamports). `tokenEntry` is the post-simulation shape, `tokenLabel` the inventory
// label; an `expected` label is an account the wallet does not hold yet (0 tokens, 0 lamports).
const RENT = 2039280n;
const BASE_FEE = 5000n;                       // lamports per signature; the verifier pins one signer
const FEE_TOTAL = FEE_LAMPORTS + BASE_FEE;    // what an honest transaction actually pays
function tokenEntry(mint, amount, lamports) {
  const lam = lamports != null ? BigInt(lamports) : RENT + (mint === IN_MINT ? BigInt(amount) : 0n);
  return { lamports: String(lam), data: { program: "spl-token", parsed: { type: "account", info: { mint, tokenAmount: { amount: String(amount) } } } } };
}
function tokenLabel(mint, before, expected) {
  const b = String(before);
  if (expected) return { kind: "token", mint, before: b, lamports: "0", expected: true };
  return { kind: "token", mint, before: b, lamports: String(RENT + (mint === IN_MINT ? BigInt(b) : 0n)) };
}
function solEntry(lamports) { return { lamports: String(lamports) }; }

// A well-formed, HONEST simulation: SOL falls by inAmount + fee (input is SOL, no new ATA), the
// output mint rises by exactly the minimum, the unrelated mint is untouched. This is the shape a
// genuine swap of this pane's own recorded fixture would produce.
function honestLabelsAndResult() {
  const addressLabels = [
    { kind: "sol", before: String(SOL_BEFORE) },
    tokenLabel(OUT_MINT, String(OUT_BEFORE)),
    tokenLabel(OTHER_MINT, String(OTHER_BEFORE)),
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
      tokenLabel(IN_MINT === OUT_MINT ? OTHER_MINT : "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", String(IN_AMOUNT)),
      tokenLabel(OUT_MINT, String(OUT_BEFORE)),
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
    const tampered = Object.assign({}, simResult, { accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_TOTAL - 1n), simResult.accounts[1], simResult.accounts[2]] });
    const r = verifySimulationResult({ simResult: tampered, addressLabels, ...baseArgs() });
    ok("SOL fell by ONE lamport more than inAmount + priority fee + base fee allows -> refused", r.ok === false && /more sol/i.test(r.reason), r);

    const withAta = Object.assign({}, simResult, { accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_TOTAL - BigInt(ATA_RENT_LAMPORTS)), simResult.accounts[1], simResult.accounts[2]] });
    // Rent to a created account the checked set does NOT contain is tolerated (outflow side only);
    // a create the inventory tracks earns nothing — its rent is inside the position (round 35).
    const rOk = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), createdAtas: ["UNTRACKEData111111111111111111111111111111"], trackedAddresses: [SOL_ADDR] });
    ok("SOL falling by inAmount + full fee + ONE ATA's rent, the create UNTRACKED by the inventory -> passes", rOk.ok === true, rOk);
    const rTooMany = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), createdAtas: [], trackedAddresses: [SOL_ADDR] });
    ok("the SAME outflow with no create at all -> refused", rTooMany.ok === false, rTooMany);
    const rTrackedNoRoom = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), createdAtas: ["TRACKEData1111111111111111111111111111111"], trackedAddresses: [SOL_ADDR, "TRACKEData1111111111111111111111111111111"] });
    ok("the SAME outflow where the created account IS tracked but holds no rent in the result -> refused (no second allowance for a tracked create)", rTrackedNoRoom.ok === false, rTrackedNoRoom);
    const rNoArg = verifySimulationResult({ simResult: withAta, addressLabels, ...baseArgs(), allowedNewAtaCount: 1 });
    ok("the old allowedNewAtaCount alone grants NOTHING any more", rNoArg.ok === false, rNoArg);
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
      tokenLabel(IN_MINT, String(WSOL_ATA_BEFORE)), // the pre-existing wSOL ATA
      tokenLabel(OUT_MINT, String(OUT_BEFORE)),
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
    const goodLegacy = { context: { slot: 1 }, value: [{ pubkey: "LEGACYacct1111111111111111111111111111111", account: { lamports: 2039280, data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: "500" } } } } } }] };
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
      && rGood.labels[1].kind === "token" && rGood.labels[1].mint === OTHER_MINT && rGood.labels[1].before === "500" && rGood.labels[1].lamports === "2039280", rGood.labels);
    // Round 34: an entry with no readable lamports is dropped like any unreadable entry — the
    // position can never carry a guessed 0 for an account that exists.
    const noLamports = { context: { slot: 1 }, value: [{ pubkey: "LEGACYacct1111111111111111111111111111111", account: { data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: "500" } } } } } }] };
    const rNoLam = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: noLamports, token22Accts: goodToken22 });
    ok("an entry with no readable lamports is dropped from the checked set (never a guessed 0)", rNoLam.ok === true && rNoLam.labels.length === 1, rNoLam.labels);

    // An unreadable INDIVIDUAL entry (not the whole `.value`) is dropped from the label set rather
    // than refusing the whole inventory — unchanged behaviour from before this fix, re-pinned here.
    const oneBadEntry = { context: { slot: 1 }, value: [{ pubkey: "X", account: { data: { parsed: { info: {} } } } }, { pubkey: "LEGACYacct1111111111111111111111111111111", account: { lamports: 2039280, data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: "500" } } } } } }] };
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
      tokenLabel(OTHER_MINT, String(OTHER_BEFORE)),
    ];
    const zeroOutput = { err: null, accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_LAMPORTS), tokenEntry(OTHER_MINT, OTHER_BEFORE)] };
    const r0 = verifySimulationResult({ simResult: zeroOutput, addressLabels: noOutputLabels, ...baseArgs() });
    ok("no output-mint account in the checked set (zero output delivered) -> REFUSED, not passed", r0.ok === false && /no account for the token you're buying/i.test(r0.reason), r0);

    // buildInventory appends the verifier's output ATA candidates when the wallet has none, with
    // before = 0 — so the account this swap creates is read after simulation like any other.
    const goodSol = { context: { slot: 1 }, value: Number(SOL_BEFORE) };
    const legacyOnlyOther = { context: { slot: 1 }, value: [{ pubkey: "OTHERacct11111111111111111111111111111111", account: { lamports: 2039280, data: { parsed: { info: { mint: OTHER_MINT, tokenAmount: { amount: String(OTHER_BEFORE) } } } } } }] };
    const empty22 = { context: { slot: 1 }, value: [] };
    const OUT_ATA_LEGACY = "OUTata1legacy111111111111111111111111111111";
    const OUT_ATA_2022 = "OUTata2token2022111111111111111111111111111";
    const inv = buildInventory({ live: SOL_ADDR, solRes: goodSol, legacyAccts: legacyOnlyOther, token22Accts: empty22, outputMint: OUT_MINT, outputAtas: [OUT_ATA_LEGACY, OUT_ATA_2022] });
    ok("buildInventory appends BOTH output ATA candidates (before=0, expected) when the wallet holds neither",
      inv.ok === true && inv.addresses.length === 4 && inv.addresses[2] === OUT_ATA_LEGACY && inv.addresses[3] === OUT_ATA_2022
      && inv.labels[2].mint === OUT_MINT && inv.labels[2].before === "0" && inv.labels[2].lamports === "0" && inv.labels[2].expected === true
      && inv.labels[3].mint === OUT_MINT && inv.labels[3].before === "0", inv);
    // The created (legacy) ATA reads the minimum after simulation; the unused Token-2022
    // derivation reads null (a real 0) -> passes.
    const created = { err: null, accounts: [solEntry(SOL_BEFORE - IN_AMOUNT - FEE_TOTAL - BigInt(ATA_RENT_LAMPORTS)), tokenEntry(OTHER_MINT, OTHER_BEFORE), tokenEntry(OUT_MINT, MIN_RECEIVED), null] };
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
    const legacyWithOut = { context: { slot: 1 }, value: [{ pubkey: OUT_ATA_LEGACY, account: { lamports: 2039280, data: { parsed: { info: { mint: OUT_MINT, tokenAmount: { amount: String(OUT_BEFORE) } } } } } }] };
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
      tokenLabel(OUT_MINT, String(OUT_BEFORE)),
      tokenLabel(OUT_MINT, "7"),
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
      tokenLabel(IN_TOKEN, String(IN_AMOUNT * 2n)),
      tokenLabel(IN_TOKEN, String(IN_AMOUNT * 2n)),
      tokenLabel(OUT_MINT, String(OUT_BEFORE)),
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
      tokenLabel(IN_TOKEN, String(IN_AMOUNT * 2n)),
      tokenLabel(OTHER_MINT, String(OTHER_BEFORE)),
      tokenLabel(IN_MINT, "0", true),   // IN_MINT is the wSOL mint id
    ];
    const args = { ...baseArgs(), inputMint: IN_TOKEN, outputMint: IN_MINT, inputIsSol: false, allowedNewAtaCount: 1 };
    const sim = (solAfter, wsolAfter) => ({ err: null, accounts: [solEntry(solAfter), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OTHER_MINT, OTHER_BEFORE), wsolAfter == null ? null : tokenEntry(IN_MINT, wsolAfter)] });

    // Honest unwrap: the wSOL account was created, paid, and closed in the same transaction (reads
    // null); native SOL rose by the minimum less the fee (the temp account's rent came back).
    const rHonest = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL, null), addressLabels: labels, ...args });
    ok("SOL output, honest unwrap (wSOL account closed, native SOL up by minimum − full fee) -> passes", rHonest.ok === true, rHonest);
    // The same with the temp account left OPEN holding its rent (Jupiter always closes it, but
    // the gate must not depend on that): native SOL up by minimum − fee − rent, wSOL account
    // exists with 0 tokens -> passes (rent credited for the one allowed create).
    const rOpen = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL - rent, 0n), addressLabels: labels, ...args });
    ok("…temp wSOL account left open (its rent sits in the account, 0 tokens) -> passes: rent MOVED inside the position, not spent", rOpen.ok === true, rOpen);
    // Insufficient: one lamport under the minimum, with every credit already granted -> refused.
    const rShort = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL - rent - 1n, 0n), addressLabels: labels, ...args });
    ok("…one lamport under the minimum with the account open -> refused", rShort.ok === false && /less than the minimum/i.test(rShort.reason), rShort);
    // No create allowed at all (allowedNewAtaCount 0): the only credit is the fee.
    const args0 = { ...args, allowedNewAtaCount: 0 };
    const rExact0 = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL, null), addressLabels: labels, ...args0 });
    ok("no create allowed: native SOL up by exactly minimum − full fee -> passes", rExact0.ok === true, rExact0);
    const rShort0 = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL - 1n, null), addressLabels: labels, ...args0 });
    ok("no create allowed: one lamport under minimum − full fee -> refused", rShort0.ok === false && /less than the minimum/i.test(rShort0.reason), rShort0);
    // allowedNewAtaCount is NEVER a credit on the received side (round 34, finding 2's cousin):
    // the same one-lamport-under fixture with 3 allowed creates is still refused.
    const rNoCredit = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL - 1n, null), addressLabels: labels, ...args, allowedNewAtaCount: 3 });
    ok("allowed creates are never credited as proceeds: one lamport under with 3 allowed creates -> still refused", rNoCredit.ok === false && /less than the minimum/i.test(rNoCredit.reason), rNoCredit);
    // Nothing received: SOL only fell by the fee, wSOL never existed -> refused.
    const rNothing = verifySimulationResult({ simResult: sim(SOL_BEFORE - FEE_LAMPORTS, null), addressLabels: labels, ...args });
    ok("SOL output but native SOL only fell by the fee (nothing received) -> refused", rNothing.ok === false && /less than the minimum/i.test(rNothing.reason), rNothing);
    // Paid into a PRE-EXISTING wSOL account instead of unwrapping (no native change but the fee):
    // the wSOL account rises by the minimum -> the SOL position gained the minimum -> passes.
    const labelsHeld = [labels[0], labels[1], labels[2], tokenLabel(IN_MINT, "1000")];
    const rHeld = verifySimulationResult({ simResult: sim(SOL_BEFORE - FEE_TOTAL, 1000n + MIN_RECEIVED), addressLabels: labelsHeld, ...args0 });
    ok("output paid into a pre-existing wSOL account (no unwrap) -> passes (native + wrapped is one position)", rHeld.ok === true, rHeld);
    // …and a pre-existing wSOL account DRAINED to fake a native rise is caught: native up by the
    // minimum − fee but the wSOL account fell by the same amount — net zero received.
    const rShuffle = verifySimulationResult({ simResult: sim(SOL_BEFORE + MIN_RECEIVED - FEE_LAMPORTS, 1000n - MIN_RECEIVED > 0n ? 1000n - MIN_RECEIVED : 0n), addressLabels: [labels[0], labels[1], labels[2], tokenLabel(IN_MINT, String(MIN_RECEIVED + 1000n))], ...args0 });
    ok("native SOL up by the minimum but a pre-existing wSOL account drained by the same amount (net 0) -> refused", rShuffle.ok === false && /less than the minimum/i.test(rShuffle.reason), rShuffle);
    // ⚠️ Codex round 34, finding 2 — the wallet held an (empty) wSOL account; the route closes it,
    // its 2,039,280 lamports of the wallet's OWN rent come back to native, and the swap delivers
    // NOTHING. Native SOL rose by more than a 1,000,000-lamport minimum; counted as proceeds it
    // passed. It is the wallet's own money moving inside its position: refused.
    const labelsEmptyWsol = [labels[0], labels[1], labels[2], tokenLabel(IN_MINT, 0)];   // held, 0 tokens, RENT lamports
    const rRentBack = verifySimulationResult({ simResult: sim(SOL_BEFORE + rent - FEE_TOTAL, null), addressLabels: labelsEmptyWsol, ...args0, minReceived: "1000000" });
    ok("Codex's fixture: zero output, but the wallet's own 2,039,280 lamports of rent returned from a closed wSOL account, 1,000,000 minimum -> refused", rRentBack.ok === false && /less than the minimum/i.test(rRentBack.reason), rRentBack);
    // …and the honest version of the same shape: rent back AND the minimum delivered -> passes.
    const rRentBackHonest = verifySimulationResult({ simResult: sim(SOL_BEFORE + rent + MIN_RECEIVED - FEE_TOTAL, null), addressLabels: labelsEmptyWsol, ...args0 });
    ok("…the same closed account with the minimum actually delivered on top of the rent -> passes", rRentBackHonest.ok === true, rRentBackHonest);
    // Input SOL AND output SOL is not a swap the gate can reason about -> refused, never passed.
    const rSame = verifySimulationResult({ simResult: sim(SOL_BEFORE, null), addressLabels: labels, ...args, inputMint: IN_MINT, inputIsSol: true });
    ok("input SOL and output SOL (same asset both sides) -> refused", rSame.ok === false && /same asset/i.test(rSame.reason), rSame);
    // Missing SOL entry with SOL output: refused as malformed, never read as "received 0" or skipped.
    const missingSol = { err: null, accounts: [null, tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OTHER_MINT, OTHER_BEFORE), null] };
    const rMissing = verifySimulationResult({ simResult: missingSol, addressLabels: labels, ...args });
    ok("SOL output with the SOL entry missing from the simulation -> refused as malformed, never skipped", rMissing.ok === false && /sol balance was missing/i.test(rMissing.reason), rMissing);
    // The input side is still bounded on a SOL-output swap: the input token falling by inAmount+1 -> refused.
    const overIn = { err: null, accounts: [solEntry(SOL_BEFORE + MIN_RECEIVED - FEE_TOTAL), tokenEntry(IN_TOKEN, IN_AMOUNT - 1n), tokenEntry(OTHER_MINT, OTHER_BEFORE), null] };
    const rOverIn = verifySimulationResult({ simResult: overIn, addressLabels: labels, ...args });
    ok("SOL output: the input token falling by inAmount+1 -> still refused", rOverIn.ok === false && /more of the token you're paying with/i.test(rOverIn.reason), rOverIn);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(13) Codex round 34, finding 3 — the BASE fee (5,000 lamports per signer) is part of what a swap may spend\n");
  {
    // Token -> token, no account create: SOL falls by priority + base only. This exact honest
    // shape was refused when only the priority fee was allowed.
    const IN_TOKEN = "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const labels = [{ kind: "sol", before: String(SOL_BEFORE) }, tokenLabel(IN_TOKEN, IN_AMOUNT * 2n), tokenLabel(OUT_MINT, OUT_BEFORE)];
    const args = { ...baseArgs(), inputMint: IN_TOKEN, inputIsSol: false, allowedNewAtaCount: 0 };
    const at = (solAfter) => ({ err: null, accounts: [solEntry(solAfter), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED)] });
    const rHonest = verifySimulationResult({ simResult: at(SOL_BEFORE - FEE_LAMPORTS - BASE_FEE), addressLabels: labels, ...args });
    ok("honest token->token swap, SOL falls by priority fee + 5,000 base fee, no create -> passes", rHonest.ok === true, rHonest);
    const rOver = verifySimulationResult({ simResult: at(SOL_BEFORE - FEE_LAMPORTS - BASE_FEE - 1n), addressLabels: labels, ...args });
    ok("…one lamport beyond priority + base -> refused", rOver.ok === false && /spend more sol/i.test(rOver.reason), rOver);
    const rTwo = verifySimulationResult({ simResult: at(SOL_BEFORE - FEE_LAMPORTS - 2n * BASE_FEE), addressLabels: labels, ...args, signatureCount: 2 });
    ok("signatureCount 2 allows two base fees", rTwo.ok === true, rTwo);
    const rZero = verifySimulationResult({ simResult: at(SOL_BEFORE - FEE_LAMPORTS - BASE_FEE), addressLabels: labels, ...args, signatureCount: 0 });
    ok("signatureCount 0 is malformed -> refused (never 'no base fee')", rZero.ok === false && /incomplete/i.test(rZero.reason), rZero);
    ok("BASE_FEE_LAMPORTS_PER_SIGNATURE is exported as 5000", mod.BASE_FEE_LAMPORTS_PER_SIGNATURE === 5000);
    // Input SOL: the allowance is inAmount + priority + base.
    const solLabels = [{ kind: "sol", before: String(SOL_BEFORE) }, tokenLabel(OUT_MINT, OUT_BEFORE), tokenLabel(OTHER_MINT, OTHER_BEFORE)];
    const solAt = (solAfter) => ({ err: null, accounts: [solEntry(solAfter), tokenEntry(OUT_MINT, OUT_BEFORE + MIN_RECEIVED), tokenEntry(OTHER_MINT, OTHER_BEFORE)] });
    const rSolOk = verifySimulationResult({ simResult: solAt(SOL_BEFORE - IN_AMOUNT - FEE_TOTAL), addressLabels: solLabels, ...baseArgs() });
    ok("input SOL: falls by exactly inAmount + priority + base -> passes", rSolOk.ok === true, rSolOk);
    const rSolOver = verifySimulationResult({ simResult: solAt(SOL_BEFORE - IN_AMOUNT - FEE_TOTAL - 1n), addressLabels: solLabels, ...baseArgs() });
    ok("input SOL: one lamport beyond that -> refused", rSolOver.ok === false && /more sol/i.test(rSolOver.reason), rSolOver);
    // ⚠️ Codex round 35 — approved input 1,000,000 lamports of SOL, full fee 6,000 (1,000 priority
    // + 5,000 base), the swap CREATES the output account and every lamport of its rent is retained
    // there (tracked). Position accounting already has that rent inside the position; the old
    // ataCreateCount × rent allowance let a total loss of 1,006,001 pass. All rent accounted for,
    // one extra lamport lost -> refused; exactly fee + inAmount lost -> passes.
    const OUT_ATA = "OUTata1legacy111111111111111111111111111111";
    const pinLabels = [{ kind: "sol", before: String(SOL_BEFORE) }, tokenLabel(OUT_MINT, 0, true)];
    const pinArgs = { ...baseArgs(), inAmount: "1000000", feeLamports: "1000", signatureCount: 1, minReceived: "1", createdAtas: [OUT_ATA], trackedAddresses: [SOL_ADDR, OUT_ATA] };
    const pinAt = (loss) => ({ err: null, accounts: [solEntry(SOL_BEFORE - loss - RENT), tokenEntry(OUT_MINT, 1n)] });   // rent sits in the created, tracked account
    const rPinOk = verifySimulationResult({ simResult: pinAt(1006000n), addressLabels: pinLabels, ...pinArgs });
    ok("Codex's pin: input 1,000,000 + fee 6,000, rent retained in the tracked created account, total loss 1,006,000 -> passes", rPinOk.ok === true, rPinOk);
    const rPinOver = verifySimulationResult({ simResult: pinAt(1006001n), addressLabels: pinLabels, ...pinArgs });
    ok("…all rent accounted for, ONE extra lamport lost (1,006,001) -> refused", rPinOver.ok === false && /more sol/i.test(rPinOver.reason), rPinOver);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(14) Codex round 34, finding 1 (P1) — the CALLER, driven with the documented simulateTransaction response\n");
  {
    const { preSignSimulation } = mod;
    const IN_TOKEN = "TokenINxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const IN_ACCT = "INacct1111111111111111111111111111111111111";
    const OUT_ATA_LEGACY = "OUTata1legacy111111111111111111111111111111";
    const OUT_ATA_2022 = "OUTata2token2022111111111111111111111111111";
    const WSOL_ATA = "WSOLata11111111111111111111111111111111111";
    const quote = { inputMint: IN_TOKEN, outputMint: OUT_MINT, inAmount: String(IN_AMOUNT), outAmount: String(MIN_RECEIVED), slippageBps: 0 };
    const trackedAtas = [{ mint: IN_TOKEN, addresses: [IN_ACCT] }, { mint: OUT_MINT, addresses: [OUT_ATA_LEGACY, OUT_ATA_2022] }, { mint: IN_MINT, addresses: [WSOL_ATA] }];
    // The wallet: 2 SOL, one input-token account. No output account yet (created by the swap).
    const reads = {
      getBalance: { context: { slot: 100 }, value: Number(SOL_BEFORE) },
      legacy: { context: { slot: 100 }, value: [{ pubkey: IN_ACCT, account: { lamports: 2039280, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { program: "spl-token", parsed: { type: "account", info: { mint: IN_TOKEN, tokenAmount: { amount: String(IN_AMOUNT * 2n) } } } } } }] },
      token22: { context: { slot: 100 }, value: [] },
    };
    // The DOCUMENTED shape (solana.com/docs/rpc/http/simulatetransaction): { context, value: { err,
    // accounts, logs, unitsConsumed, returnData } } — accounts in the order requested:
    // [live, IN_ACCT, OUT_ATA_LEGACY, OUT_ATA_2022, WSOL_ATA].
    const documented = (accounts) => ({ context: { slot: 101, apiVersion: "2.0.0" }, value: { err: null, logs: ["Program log: ok"], unitsConsumed: 120000, returnData: null, accounts } });
    let sentAddresses = null, simCalls = 0;
    const fakeRpc = (simAnswer) => async (method, params) => {
      if (method === "getBalance") return reads.getBalance;
      if (method === "getTokenAccountsByOwner") return params[1].programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ? reads.legacy : reads.token22;
      if (method === "simulateTransaction") { simCalls++; sentAddresses = params[1].accounts.addresses; return typeof simAnswer === "function" ? simAnswer() : simAnswer; }
      throw new Error("unexpected " + method);
    };
    const honestAccounts = [
      solEntry(SOL_BEFORE - FEE_TOTAL - RENT),                 // fee paid, rent moved into the new output account
      tokenEntry(IN_TOKEN, IN_AMOUNT),                         // input fell by inAmount
      tokenEntry(OUT_MINT, MIN_RECEIVED),                      // the created output ATA holds the minimum
      null,                                                    // the other program's derivation: does not exist
      null,                                                    // no wSOL account
    ];
    const common = { live: SOL_ADDR, swapTransactionB64: "AAAA", quote, minReceived: String(MIN_RECEIVED), feeLamports: String(FEE_LAMPORTS), signatureCount: 1, createdAtas: [OUT_ATA_LEGACY], inputIsSol: false, trackedAtas };
    const rOk = await preSignSimulation({ rpc: fakeRpc(documented(honestAccounts)), ...common });
    ok("the pure caller, fed the DOCUMENTED { context, value } envelope, PASSES an honest swap (this exact shape refused before the fix)", rOk.ok === true, rOk);
    ok("…it asked the node for exactly [live, held account, every tracked own-ATA], in that order", JSON.stringify(sentAddresses) === JSON.stringify([SOL_ADDR, IN_ACCT, OUT_ATA_LEGACY, OUT_ATA_2022, WSOL_ATA]), sentAddresses);
    const rZero = await preSignSimulation({ rpc: fakeRpc(documented([solEntry(SOL_BEFORE - FEE_TOTAL), tokenEntry(IN_TOKEN, IN_AMOUNT), null, null, null])), ...common });
    ok("…the same caller with zero output delivered (no output account created) -> refused under the minimum", rZero.ok === false && /less than the minimum/i.test(rZero.reason), rZero);
    // Malformed envelopes: no value, null value, a bare value-less object, a non-object.
    for (const [label, bad] of [["{ context } with no value", { context: { slot: 1 } }], ["value: null", { context: { slot: 1 }, value: null }], ["the bare value object with no envelope", { err: null, accounts: honestAccounts }], ["a string", "ok"], ["undefined", undefined]]) {
      const r = await preSignSimulation({ rpc: fakeRpc(bad), ...common });
      ok(`a simulate answer shaped as ${label} -> refused (incomplete), never unwrapped by guesswork`, r.ok === false && /incomplete|could not simulate/i.test(r.reason), r);
    }
    const rThrow = await preSignSimulation({ rpc: fakeRpc(() => { throw new Error("502"); }), ...common });
    ok("the simulate call throwing -> refused, never skipped", rThrow.ok === false && /could not simulate/i.test(rThrow.reason), rThrow);
    const rReadFail = await preSignSimulation({ rpc: async (m) => { if (m === "getBalance") throw new Error("down"); return reads.legacy; }, ...common });
    ok("a balance read throwing -> refused before any simulate call", rReadFail.ok === false && /reach the network/i.test(rReadFail.reason), rReadFail);
    const rErr = await preSignSimulation({ rpc: fakeRpc({ context: { slot: 1 }, value: { err: { InstructionError: [2, "Custom"] }, accounts: null } }), ...common });
    ok("a documented failure answer (value.err set) -> refused, quoting the error", rErr.ok === false && /would fail on-chain/i.test(rErr.reason), rErr);
    // The pane calls THIS function and no longer builds the inventory / simulate call itself.
    const paneSrc = require("fs").readFileSync(path.join(ROOT, "src", "seeker", "tools", "Swap.jsx"), "utf8");
    ok("Swap.jsx imports preSignSimulation from swap-simulate.js and calls it", /import \{ preSignSimulation \} from "\.\.\/swap-simulate\.js"/.test(paneSrc) && /await preSignSimulation\(\{/.test(paneSrc));
    ok("Swap.jsx no longer calls simulateTransaction, buildInventory or verifySimulationResult itself", !/simulateTransaction|buildInventory\(|verifySimulationResult\(/.test(paneSrc));
    ok("Swap.jsx threads signatureCount, createdAtas and trackedAtas from the verifier into the gate", /signatureCount: cd\.signatureCount/.test(paneSrc) && /createdAtas: cd\.createdAtas/.test(paneSrc) && /trackedAtas: cd\.trackedAtas/.test(paneSrc) && /signatureCount: check\.signatureCount/.test(paneSrc) && /createdAtas: check\.createdAtas/.test(paneSrc) && /trackedAtas: check\.trackedAtas/.test(paneSrc));
    // The caller's own untracked-create case: a create the inventory does not contain, rent gone to it.
    const rUntracked = await preSignSimulation({ rpc: fakeRpc(documented([solEntry(SOL_BEFORE - FEE_TOTAL - RENT), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OUT_MINT, MIN_RECEIVED), null, null])), ...common, createdAtas: [OUT_ATA_LEGACY, "SOMEotherATA1111111111111111111111111111111"] });
    ok("caller: rent to an UNTRACKED created account plus the tracked one -> tolerated once, passes", rUntracked.ok === true, rUntracked);
    const rUntrackedOver = await preSignSimulation({ rpc: fakeRpc(documented([solEntry(SOL_BEFORE - FEE_TOTAL - RENT - RENT - 1n), tokenEntry(IN_TOKEN, IN_AMOUNT), tokenEntry(OUT_MINT, MIN_RECEIVED), null, null])), ...common, createdAtas: [OUT_ATA_LEGACY, "SOMEotherATA1111111111111111111111111111111"] });
    ok("caller: …one lamport beyond fee + the one untracked rent -> refused", rUntrackedOver.ok === false && /spend more sol/i.test(rUntrackedOver.reason), rUntrackedOver);
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
