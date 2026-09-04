"use strict";
// Tests for lib/token-authority.js — revoking mint and freeze authority.
//
// The instruction is hand-built, so per CLAUDE.md the bytes are diffed against the real
// @solana/spl-token serializer rather than against my own understanding of the layout. The rest of
// the suite is about the ways this tool could ruin somebody's token permanently.
//
// Runs in the smoke-test CI job: it needs @solana/web3.js and @solana/spl-token, which the
// dependency-free node-check job does not install.

const assert = require("assert");
const { PublicKey } = require("@solana/web3.js");
const { createSetAuthorityInstruction, AuthorityType, TOKEN_PROGRAM_ID: LIB_TOKEN,
        TOKEN_2022_PROGRAM_ID: LIB_2022 } = require("@solana/spl-token");
const ta = require("../lib/token-authority");

let pass = 0, fail = 0;
// Every test is awaited in order. The first version of this harness called fn() and printed a
// pass immediately, so an async test's assertions ran AFTER its own tick — both async tests
// reported ✓ and then one crashed the process on a failure it had already claimed to survive.
// A harness that can print a pass for a failing test is worse than no harness.
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function section(s) { queue.push([s, null]); }
async function run() {
  for (const [name, fn] of queue) {
    if (!fn) { console.log("\n" + name); continue; }
    try { await fn(); console.log("  ✓ " + name); pass++; }
    catch (e) { console.log("  ✗ " + name + "\n      " + e.message); fail++; }
  }
}

const MINT = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";
const AUTH = "RosepN6TnevxxgnL9qFXqhRz6s8tELJDP6r953AMFvX";
const OTHER = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

const legacyMint = {
  mint: MINT, symbol: "ROSE", tokenProgram: LIB_TOKEN.toBase58(),
  mintAuthority: AUTH, freezeAuthority: AUTH, defaultAccountStateFrozen: false,
};

section("byte-for-byte against the real SPL Token serializer");

t("mint revocation is byte-identical to the library's", () => {
  const mine = ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_TOKEN.toBase58(),
    currentAuthority: AUTH, authorityType: ta.AUTHORITY_TYPE.MintTokens });
  const theirs = createSetAuthorityInstruction(new PublicKey(MINT), new PublicKey(AUTH),
    AuthorityType.MintTokens, null, [], LIB_TOKEN);
  assert.strictEqual(Buffer.from(mine.data).toString("hex"), Buffer.from(theirs.data).toString("hex"));
});

t("freeze revocation is byte-identical to the library's", () => {
  const mine = ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_TOKEN.toBase58(),
    currentAuthority: AUTH, authorityType: ta.AUTHORITY_TYPE.FreezeAccount });
  const theirs = createSetAuthorityInstruction(new PublicKey(MINT), new PublicKey(AUTH),
    AuthorityType.FreezeAccount, null, [], LIB_TOKEN);
  assert.strictEqual(Buffer.from(mine.data).toString("hex"), Buffer.from(theirs.data).toString("hex"));
});

t("account metas match the library exactly (mint writable, authority signer)", () => {
  const mine = ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_TOKEN.toBase58(),
    currentAuthority: AUTH, authorityType: 0 });
  const theirs = createSetAuthorityInstruction(new PublicKey(MINT), new PublicKey(AUTH),
    AuthorityType.MintTokens, null, [], LIB_TOKEN);
  const shape = (ix) => ix.keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? "S" : "-"}${k.isWritable ? "W" : "-"}`);
  assert.deepStrictEqual(shape(mine), shape(theirs));
  assert.strictEqual(mine.programId.toBase58(), theirs.programId.toBase58());
});

t("Token-2022 mints get the Token-2022 program id", () => {
  const ix = ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_2022.toBase58(),
    currentAuthority: AUTH, authorityType: 0 });
  assert.strictEqual(ix.programId.toBase58(), LIB_2022.toBase58());
});

section("the encoding can only ever revoke, never hand the token to someone else");

t("revoke encodes as exactly 3 bytes ending in COption::None", () => {
  assert.deepStrictEqual(Array.from(ta.encodeRevoke(0)), [6, 0, 0]);
  assert.deepStrictEqual(Array.from(ta.encodeRevoke(1)), [6, 1, 0]);
});

t("a reassignment is 35 bytes — ours is never that length", () => {
  const reassign = createSetAuthorityInstruction(new PublicKey(MINT), new PublicKey(AUTH),
    AuthorityType.MintTokens, new PublicKey(OTHER), [], LIB_TOKEN);
  assert.strictEqual(reassign.data.length, 35);
  for (const type of [0, 1]) assert.strictEqual(ta.encodeRevoke(type).length, 3);
});

t("no caller input can inject a new authority into the payload", () => {
  // Even asked in every shape a caller could reach, the bytes stay [6, type, 0].
  const ix = ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_TOKEN.toBase58(),
    currentAuthority: AUTH, authorityType: 0, newAuthority: OTHER, authority: OTHER });
  assert.deepStrictEqual(Array.from(ix.data), [6, 0, 0]);
});

section("authority types outside mint/freeze are refused");

t("AccountOwner(2) and CloseAccount(3) are refused", () => {
  for (const bad of [2, 3]) {
    assert.throws(() => ta.encodeRevoke(bad), /revokes mint\(0\) and freeze\(1\) only/);
    assert.throws(() => ta.buildRevokeIx({ mint: MINT, tokenProgram: LIB_TOKEN.toBase58(),
      currentAuthority: AUTH, authorityType: bad }), /refusing authority type/);
  }
});

t("Token-2022 config authorities (4..16) are refused", () => {
  for (const bad of [4, 8, 10, 16]) {
    assert.throws(() => ta.encodeRevoke(bad), /refusing authority type/);
  }
});

t("garbage authority types are refused, not coerced", () => {
  for (const bad of [null, undefined, "0", -1, 1.5, NaN, {}]) {
    assert.throws(() => ta.encodeRevoke(bad), /refusing authority type/);
  }
});

section("already-revoked authorities");

t("revoking an absent mint authority is refused, not a no-op transaction", () => {
  assert.throws(() => ta.assertRevocable({
    mintInfo: { ...legacyMint, mintAuthority: null }, authorityType: 0,
  }), /already revoked/);
});

t("revoking an absent freeze authority is refused", () => {
  assert.throws(() => ta.assertRevocable({
    mintInfo: { ...legacyMint, freezeAuthority: null }, authorityType: 1,
  }), /already revoked/);
});

section("the freeze hazard that would brick a token");

t("DefaultAccountState=Frozen blocks freeze revocation", () => {
  const hazard = ta.freezeRevocationHazard({ ...legacyMint, defaultAccountStateFrozen: true });
  assert.ok(hazard && /permanently frozen/.test(hazard), "expected a hazard explaining the freeze trap");
  assert.throws(() => ta.assertRevocable({
    mintInfo: { ...legacyMint, defaultAccountStateFrozen: true }, authorityType: 1,
  }), /permanently frozen/);
});

t("...but MINT revocation on the same token is still allowed", () => {
  // The hazard is specific to freeze. Blocking mint revocation too would be a different bug:
  // refusing a safe action because an unrelated one is unsafe.
  assert.doesNotThrow(() => ta.assertRevocable({
    mintInfo: { ...legacyMint, defaultAccountStateFrozen: true }, authorityType: 0,
  }));
});

t("a normal mint has no freeze hazard", () => {
  assert.strictEqual(ta.freezeRevocationHazard(legacyMint), null);
});

section("program ownership");

t("a non-token program owner is refused", () => {
  assert.throws(() => ta.tokenProgramFor("11111111111111111111111111111111"), /not an SPL token mint/);
  assert.throws(() => ta.tokenProgramFor(""), /not an SPL token mint/);
  assert.throws(() => ta.tokenProgramFor(null), /not an SPL token mint/);
});

t("both token programs are accepted", () => {
  assert.strictEqual(ta.tokenProgramFor(LIB_TOKEN.toBase58()).toBase58(), LIB_TOKEN.toBase58());
  assert.strictEqual(ta.tokenProgramFor(LIB_2022.toBase58()).toBase58(), LIB_2022.toBase58());
});

section("the transaction handed to a wallet");

t("built tx is unsigned, pays from the authority, and says what it costs", async () => {
  const fakeConn = { getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 123 }) };
  const out = await ta.buildRevokeTx({ connection: fakeConn, mintInfo: legacyMint, authorityType: 0 });
  assert.strictEqual(out.signer, AUTH);
  assert.strictEqual(out.irreversible, true);
  assert.strictEqual(out.label, "mint authority");
  assert.ok(/Supply is capped forever/.test(out.consequence), "consequence must state the permanence");
  assert.ok(/ROSE/.test(out.consequence), "consequence should name the token");
  const raw = Buffer.from(out.unsignedBase64, "base64");
  assert.ok(raw.length > 0);
  // Byte 0 is the compact-u16 signature COUNT, and web3.js reserves one slot for the fee payer
  // even when serialising unsigned — so 1 is correct here. What must be true is that the slot is
  // EMPTY: 64 zero bytes, i.e. nothing was signed server-side. The server holds no key and this
  // is what proves it stayed that way.
  assert.strictEqual(raw[0], 1, "expected exactly one reserved signature slot");
  const sig = raw.subarray(1, 65);
  assert.strictEqual(sig.length, 64);
  assert.ok(sig.every((b) => b === 0), "the signature slot must be all zeros — nothing signed server-side");
});

t("freeze revocation states its own, different consequence", async () => {
  const fakeConn = { getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }) };
  const out = await ta.buildRevokeTx({ connection: fakeConn, mintInfo: legacyMint, authorityType: 1 });
  assert.strictEqual(out.label, "freeze authority");
  assert.ok(/freeze a holder's account/.test(out.consequence));
  assert.ok(!/Supply is capped/.test(out.consequence), "must not reuse the mint wording");
});

run().then(() => {
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail === 0 ? 0 : 1);
});
