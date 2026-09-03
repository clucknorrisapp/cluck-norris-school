// Regression test for the Normie Quest shop crediting a self-transfer as a "payment" (audit Batch B).
//
// verifyBurn() used to credit `Math.max(burnedAmount(tx, mint), transferredToDest(tx, mint, dest))`
// on the NORMIE rail. burnedAmount() sums every pre>post balance decrease on ANY account of the
// mint in the tx, with no netting against the matching increase and no destination check — so a
// player could move tokens from their own ATA to another ATA they also own, tag the tx with the
// session's public `reference` key, and have it counted as a full payment even though the shop
// wallet received nothing. The fix requires a real transfer of the expected amount landing at the
// expected destination (transferredToDest only).
//
// This test exercises the two pure helpers directly against synthetic getParsedTransaction-shaped
// objects — no RPC, no wallet, no network.
//
// Run: node normie-quest/test/normie-burn-selftransfer-test.cjs
"use strict";

const path = require("path");
const { transferredToDest, burnedAmount } = require(path.join(__dirname, "..", "normie-burn.js"));

const MINT = "NORMiEMint11111111111111111111111111111111";
const SHOP_DEST = "ShopWa11et1111111111111111111111111111111";
const ATTACKER = "Attacker1111111111111111111111111111111111";

function balEntry(accountIndex, owner, mint, uiAmount) {
  return { accountIndex, owner, mint, uiTokenAmount: { uiAmount } };
}

// A self-transfer: 1000.0731 moves from the attacker's ATA A (idx 0) to their OWN ATA B (idx 1).
// Neither account is owned by the shop. This is the exact exploit tx shape from the finding.
const selfTransferTx = {
  meta: {
    preTokenBalances: [
      balEntry(0, ATTACKER, MINT, 5000),
      balEntry(1, ATTACKER, MINT, 0),
    ],
    postTokenBalances: [
      balEntry(0, ATTACKER, MINT, 3999.9269),
      balEntry(1, ATTACKER, MINT, 1000.0731),
    ],
  },
};

// A real payment: the same amount moves from the attacker's ATA to the SHOP's ATA.
const realPaymentTx = {
  meta: {
    preTokenBalances: [
      balEntry(0, ATTACKER, MINT, 5000),
      balEntry(1, SHOP_DEST, MINT, 0),
    ],
    postTokenBalances: [
      balEntry(0, ATTACKER, MINT, 3999.9269),
      balEntry(1, SHOP_DEST, MINT, 1000.0731),
    ],
  },
};

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

// 1. The vulnerable behaviour, demonstrated: burnedAmount() alone WOULD have credited the
// self-transfer (this is exactly why it can no longer be the (sole/max) input to verifyBurn).
check(
  "burnedAmount() still (mis)credits a self-transfer as a drop — the reason it's no longer used for verification",
  Math.abs(burnedAmount(selfTransferTx, MINT) - 1000.0731) < 1e-9
);

// 2. The fix: transferredToDest() — what verifyBurn now uses on the NORMIE rail — must NOT
// credit the self-transfer, because nothing landed at the shop wallet.
check(
  "transferredToDest() credits nothing for a self-transfer (owner never becomes the shop dest)",
  transferredToDest(selfTransferTx, MINT, SHOP_DEST) === 0
);

// 3. transferredToDest() must still credit a genuine payment to the shop wallet, so real buyers
// are unaffected by the fix.
check(
  "transferredToDest() credits a real transfer to the shop wallet",
  Math.abs(transferredToDest(realPaymentTx, MINT, SHOP_DEST) - 1000.0731) < 1e-9
);

// 4. A transfer to some OTHER destination (not this session's dest) must not count either.
check(
  "transferredToDest() ignores a transfer to an unrelated destination",
  transferredToDest(realPaymentTx, MINT, "SomeOtherWallet11111111111111111111111111") === 0
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll normie-burn self-transfer checks passed.");
