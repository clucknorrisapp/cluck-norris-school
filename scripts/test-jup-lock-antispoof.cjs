#!/usr/bin/env node
/* Tests for the Batch B anti-spoofing fix in lib/jup-lock.js (verifyLockSig / recentLocks).
 * No network, no wallet, no keys — pure functions over hand-built parsed-tx shapes.
 *
 * The bug: LOCK_LOG_CREATE tested the log text ANYWHERE in a line, and the deposited amount
 * was read from ANY token account that went 0 -> positive. A crafted tx (two Memo instructions:
 * one containing the literal text "Instruction: CreateVestingEscrowV2", one the attribution
 * memo, plus a self-transfer into a fresh ATA the attacker's own wallet owns) could plant a
 * fake mint/amount in the public "recently locked" feed without ever invoking the Lock program.
 *
 * The fix adds two independent checks:
 *  - invokesLockProgram(tx): the Lock program's address must actually appear as an invoked
 *    instruction (top-level or CPI) — log text alone is not proof.
 *  - bestDepositedAccount(pre, post): only a 0->positive account OWNED by an off-curve address
 *    (a program-derived escrow vault) counts — an attacker's own on-curve wallet never does.
 *
 * Run: node scripts/test-jup-lock-antispoof.cjs
 */
const assert = require("assert");
const { PublicKey, Keypair } = require("@solana/web3.js");
const { LOCK_PROGRAM, _internal } = require("../lib/jup-lock");
const { invokesLockProgram, bestDepositedAccount } = _internal;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.stack || e.message}`); fail++; }
}

const OTHER_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// A real on-curve wallet (attacker's own) vs an off-curve PDA-style address (escrow vault).
const attackerWallet = Keypair.generate().publicKey.toBase58();
// PublicKey.findProgramAddressSync always returns an off-curve address by construction.
const [pdaLikeVault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], LOCK_PROGRAM);
const escrowVaultOwner = pdaLikeVault.toBase58();

console.log("\ninvokesLockProgram()");
t("false when the Lock program is never invoked (top-level or CPI)", () => {
  const tx = { transaction: { message: { instructions: [{ programId: OTHER_PROGRAM }] } }, meta: { innerInstructions: [] } };
  assert.strictEqual(invokesLockProgram(tx), false);
});
t("true when the Lock program appears as a top-level instruction", () => {
  const tx = { transaction: { message: { instructions: [{ programId: OTHER_PROGRAM }, { programId: LOCK_PROGRAM }] } }, meta: { innerInstructions: [] } };
  assert.strictEqual(invokesLockProgram(tx), true);
});
t("true when the Lock program appears only as a CPI (inner instruction)", () => {
  const tx = {
    transaction: { message: { instructions: [{ programId: OTHER_PROGRAM }] } },
    meta: { innerInstructions: [{ index: 0, instructions: [{ programId: LOCK_PROGRAM }] }] },
  };
  assert.strictEqual(invokesLockProgram(tx), true);
});

console.log("\nbestDepositedAccount()");
t("ignores a 0->positive account owned by an on-curve wallet (the spoof)", () => {
  const pre = [];
  const post = [{ accountIndex: 0, mint: "FakeMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", owner: attackerWallet, uiTokenAmount: { uiAmount: 1000000000 } }];
  assert.strictEqual(bestDepositedAccount(pre, post), null);
});
t("picks a 0->positive account owned by an off-curve escrow vault", () => {
  const pre = [];
  const post = [{ accountIndex: 0, mint: "RealMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", owner: escrowVaultOwner, uiTokenAmount: { uiAmount: 42 } }];
  const best = bestDepositedAccount(pre, post);
  assert.ok(best);
  assert.strictEqual(best.amount, 42);
});
t("between a spoofed on-curve account and a real off-curve vault, only the vault counts", () => {
  const pre = [];
  const post = [
    { accountIndex: 0, mint: "FakeMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", owner: attackerWallet, uiTokenAmount: { uiAmount: 1000000000 } },
    { accountIndex: 1, mint: "RealMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", owner: escrowVaultOwner, uiTokenAmount: { uiAmount: 42 } },
  ];
  const best = bestDepositedAccount(pre, post);
  assert.ok(best);
  assert.strictEqual(best.mint, "RealMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  assert.strictEqual(best.amount, 42);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
