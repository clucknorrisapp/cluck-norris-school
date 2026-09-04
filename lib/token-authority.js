"use strict";
// Revoking a token's mint and freeze authority — the other two flags a scanner warns about.
//
// This is a bigger deal than the metadata lock. Revoking the mint authority permanently caps
// supply: nobody can ever mint another unit of that token, including the person clicking the
// button. There is no undo and no recovery path, so every guard here exists to stop a specific
// way of ruining a token forever, not to be thorough for its own sake.
//
// The instruction is SetAuthority (SPL Token #6), hand-built for the same reason the metadata one
// is — and, per CLAUDE.md, byte-diffed against @solana/spl-token's own serializer in the tests.
//
//   layout: u8 instruction(6) | u8 authorityType | COption<Pubkey> newAuthority
//   revoke:   06 <type> 00                         (3 bytes — None)
//   reassign: 06 <type> 01 <32-byte pubkey>        (35 bytes — Some)
//
// THIS MODULE ONLY EVER EMITS THE 3-BYTE FORM. See buildRevokeIx.

const { PublicKey, TransactionInstruction, Transaction } = require("@solana/web3.js");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const IX_SET_AUTHORITY = 6;

// Deliberately NOT the library's full enum. AccountOwner(2) and CloseAccount(3) act on token
// ACCOUNTS, not mints, and the Token-2022 types (4..16) reach config a token creator has not asked
// us to touch. Narrowing the vocabulary means a caller cannot ask for them at all.
const AUTHORITY_TYPE = { MintTokens: 0, FreezeAccount: 1 };
const AUTHORITY_LABEL = { 0: "mint authority", 1: "freeze authority" };

function encodeRevoke(authorityType) {
  if (authorityType !== 0 && authorityType !== 1) {
    throw new Error(`refusing authority type ${authorityType} — this tool revokes mint(0) and freeze(1) only`);
  }
  // COption::None is the trailing 0. There is no branch that writes a pubkey here, so no amount of
  // caller input can turn a revoke into a hand-over of the token to someone else.
  return Uint8Array.from([IX_SET_AUTHORITY, authorityType, 0]);
}

function tokenProgramFor(owner) {
  const s = String(owner || "");
  if (s === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (s === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`not an SPL token mint (owner ${s || "unknown"})`);
}

// `current` is the shape /api/token-metadata/read already returns for authorities, plus the mint
// address and the owning program, so callers do not need a second decoder.
function buildRevokeIx({ mint, tokenProgram, currentAuthority, authorityType }) {
  const type = Number(authorityType);
  if (type !== 0 && type !== 1) throw new Error(`refusing authority type ${authorityType}`);
  if (!currentAuthority) {
    throw new Error(`${AUTHORITY_LABEL[type]} is already revoked — there is nothing to revoke`);
  }
  const programId = tokenProgram instanceof PublicKey ? tokenProgram : tokenProgramFor(tokenProgram);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(currentAuthority), isSigner: true, isWritable: false },
    ],
    data: Buffer.from(encodeRevoke(type)),
  });
}

// Why a freeze revocation can be catastrophic, and the only case where we refuse outright:
// a Token-2022 mint carrying the DefaultAccountState extension set to Frozen creates every new
// token account frozen, and only the freeze authority can thaw one. Revoke that authority and no
// account can ever be thawed again — the token becomes permanently untradeable, holders included.
// Nothing about the scanner warning tells its owner this. So we check, and we say no.
function freezeRevocationHazard(mintInfo) {
  if (!mintInfo) return null;
  if (mintInfo.defaultAccountStateFrozen) {
    return "this mint sets new accounts to FROZEN by default (Token-2022 DefaultAccountState). "
      + "Revoking the freeze authority would leave every new holder permanently frozen with no way "
      + "to thaw them — the token would be unusable. Change the default account state first.";
  }
  return null;
}

function assertRevocable({ mintInfo, authorityType }) {
  const type = Number(authorityType);
  if (type !== 0 && type !== 1) throw new Error(`refusing authority type ${authorityType}`);
  const held = type === 0 ? mintInfo.mintAuthority : mintInfo.freezeAuthority;
  if (!held) throw new Error(`${AUTHORITY_LABEL[type]} is already revoked — there is nothing to revoke`);
  if (type === 1) {
    const hazard = freezeRevocationHazard(mintInfo);
    if (hazard) throw new Error(hazard);
  }
  return held;
}

async function buildRevokeTx({ connection, mintInfo, authorityType }) {
  const held = assertRevocable({ mintInfo, authorityType });
  const ix = buildRevokeIx({
    mint: mintInfo.mint,
    tokenProgram: mintInfo.tokenProgram,
    currentAuthority: held,
    authorityType,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = new PublicKey(held);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const type = Number(authorityType);
  return {
    unsignedBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    lastValidBlockHeight,
    signer: String(held),
    authorityType: type,
    label: AUTHORITY_LABEL[type],
    // What the user is actually giving up, in their words not ours. The page renders this; it is
    // here so the warning cannot drift away from the instruction it describes.
    consequence: type === 0
      ? "Supply is capped forever. No one can ever mint another " + (mintInfo.symbol || "token") + ", including you."
      : "No one can ever freeze a holder's account again, including you.",
    irreversible: true,
  };
}

module.exports = {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, IX_SET_AUTHORITY, AUTHORITY_TYPE, AUTHORITY_LABEL,
  encodeRevoke, tokenProgramFor, buildRevokeIx, freezeRevocationHazard, assertRevocable, buildRevokeTx,
};
