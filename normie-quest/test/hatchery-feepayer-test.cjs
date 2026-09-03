// Regression test for the Hatchery /submit fee-payer bypass (audit Batch B).
//
// /build grants a fee waiver based on the caller-supplied `creator` address alone. If /submit
// co-signed ANY client transaction whenever the built tx happened to carry no fee instruction,
// an attacker could pass creator=<treasury or any CLKN whale> to /build (fee-free built tx),
// then submit a totally different, self-built, self-signed transaction (their own wallet as fee
// payer) for the same pending mint — getting a free Hatchery mint. feePayerMatches() closes this
// by requiring the client's signed tx to share the exact fee payer the tx was built for.
//
// Run: node normie-quest/test/hatchery-feepayer-test.cjs
"use strict";

const path = require("path");
const assert = require("assert");
const { Keypair, Transaction, SystemProgram, PublicKey } = require("@solana/web3.js");

const { feePayerMatches, builtIxsPreserved } = require(path.join(__dirname, "..", "..", "hatchery.js"));

function txWithFeePayer(feePayer, extra) {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = "11111111111111111111111111111111111111111111"; // dummy, never broadcast
  tx.add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  if (extra) tx.add(extra);
  return tx;
}

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

// 1. Same fee payer (the legitimate flow: the wallet signs the exact tx the server built) matches.
{
  const wallet = Keypair.generate().publicKey;
  const built = txWithFeePayer(wallet);
  const client = txWithFeePayer(wallet);
  check("identical fee payer matches", feePayerMatches(built, client) === true);
}

// 2. Forged-creator bypass: /build was called with creator=<treasury/whale>, producing a
// fee-waived built tx with that address as fee payer. The attacker then submits their OWN
// self-built, self-signed tx with their own wallet as fee payer. Must be rejected.
{
  const forgedCreator = Keypair.generate().publicKey; // stands in for the treasury/whale address
  const attacker = Keypair.generate().publicKey;
  const built = txWithFeePayer(forgedCreator);
  const client = txWithFeePayer(attacker);
  check("mismatched fee payer (forged-creator bypass) is rejected", feePayerMatches(built, client) === false);
}

// 3. Missing feePayer on either side must fail closed, not throw / pass.
{
  const wallet = Keypair.generate().publicKey;
  const built = txWithFeePayer(wallet);
  const client = txWithFeePayer(wallet);
  client.feePayer = null;
  check("missing client feePayer fails closed", feePayerMatches(built, client) === false);
}

// 4. Sanity: builtIxsPreserved still export/works (untouched behaviour) — same instructions in
// order pass.
{
  const wallet = Keypair.generate().publicKey;
  const dest = Keypair.generate().publicKey;
  const built = new Transaction();
  built.feePayer = wallet;
  built.recentBlockhash = "11111111111111111111111111111111111111111111";
  built.add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: dest, lamports: 5 }));
  const client = new Transaction();
  client.feePayer = wallet;
  client.recentBlockhash = "11111111111111111111111111111111111111111111";
  client.add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: dest, lamports: 5 }));
  check("builtIxsPreserved still true for identical core ixs", builtIxsPreserved(built, client) === true);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll hatchery fee-payer checks passed.");
