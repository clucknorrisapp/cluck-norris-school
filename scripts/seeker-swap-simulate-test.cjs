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
  const { verifySimulationResult, ATA_RENT_LAMPORTS } = mod;

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
    ok("SOL fell by ONE lamport more than inAmount+fee allows -> refused", r.ok === false && /more sol than the quote/i.test(r.reason), r);

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

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
