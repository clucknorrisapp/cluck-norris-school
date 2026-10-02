// Cluck Norris — Seeker app, REVOKE seam: clear token delegate approvals from the connected wallet.
//
// The one thing the website's /wallet-checkup could do that this app could not: an open delegate
// approval is the #1 way a wallet gets drained on Solana, and until 2026-09-29 the app could only
// SHOW one and send the person to the website to sign the revoke. Owner, 2026-09-29, after nearly
// connecting the treasury to a lookalike Meteora: "I need something on my app to help people
// disconnect from things." This is the signing half of that; Disconnect.jsx is the other half.
//
// Three rules, each of which has already cost real money somewhere in this repo:
//
//   1. THE INSTRUCTION IS BUILT HERE, IN BYTES, AND DIFFED AGAINST THE LIBRARY IN CI. AGENTS.md:
//      never call a web3.js layout encoder in a browser page (toBufferLE needs the Node Buffer
//      global, we ship no polyfill, and it silently killed three money paths at once). A Revoke
//      is the simplest SPL instruction there is — one byte of data, two accounts — so it is a
//      plain descriptor below and scripts/seeker-revoke-test.cjs asserts it byte-for-byte against
//      @solana/spl-token's createRevokeInstruction for BOTH token programs. No server round trip:
//      the website's flow asks /api/security-coop/revoke for a pre-built transaction and signs
//      whatever comes back, which is a transaction the person never read. Building it on the
//      device means what is signed is exactly the list on the confirm sheet.
//
//   2. THE SIGNING PATH IS sign.js's, NOT A COPY. signSendConfirm() carries the five protections
//      (err before status, three outcomes, live-account re-read, byte diff, transport-failure is
//      not on-chain failure). This file only builds and only reports.
//
//   3. "REVOKED" IS A CLAIM ABOUT THE CHAIN, SO IT IS RE-READ FROM THE CHAIN. A confirmed
//      transaction is proof the instructions ran, not proof of the state a person now cares about.
//      verifyRevoked() re-reads every account it touched and reports per account: cleared,
//      still delegated, or unreadable — and unreadable is NEVER counted as cleared (pane.jsx's
//      rule: a failed read is not an empty result). The owner's own words for this feature:
//      "empirically make sure all approvals are removed."
//
// No wallet, no network and no window at module load — scripts/seeker-revoke-test.cjs imports
// this under Node with a fake rpc and never signs anything.
import { signSendConfirm } from "./sign.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
// spl-token's TokenInstruction.Revoke. The whole instruction data is this one byte.
export const REVOKE_TAG = 5;
// Per transaction. Matches the website's own cap (public/wallet-checkup.html revokeAllFound: 8),
// well under the server builder's 20 and far inside the packet limit — a Revoke is ~40 bytes of
// message. Small on purpose: a phone wallet lists every instruction on its approve screen, and
// eight is the most anyone reads.
export const MAX_REVOKE_PER_TX = 8;

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A scan row (WalletCheckup's `approvals`: { tokenAccount, mint, delegate, program, … }) → what a
// revoke needs, or null when the row cannot be acted on. `program` from the server is the token
// program id string; anything else is refused rather than guessed — a Revoke sent to the wrong
// program is a failed transaction at best.
export function revocable(row) {
  if (!row || !ADDR_RE.test(String(row.tokenAccount || ""))) return null;
  const program = row.program === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM
    : row.program === TOKEN_PROGRAM || !row.program ? TOKEN_PROGRAM : null;
  if (!program) return null;
  return { tokenAccount: row.tokenAccount, program, mint: row.mint || null, delegate: row.delegate || null };
}

// The first batch and what it leaves for a second pass. Rows are de-duplicated by token account:
// two approval rows can never be one account (an account has one delegate slot), but a re-scan
// racing a stale list could hand the same account twice, and a transaction with the same Revoke
// twice fails.
export function planRevoke(approvals, max) {
  const cap = max > 0 ? max : MAX_REVOKE_PER_TX;
  const seen = new Set();
  const usable = [];
  const skipped = [];
  for (const row of approvals || []) {
    const r = revocable(row);
    if (!r) { skipped.push(row); continue; }
    if (seen.has(r.tokenAccount)) continue;
    seen.add(r.tokenAccount);
    usable.push(r);
  }
  return { batch: usable.slice(0, cap), remaining: usable.slice(cap), skipped };
}

// The instruction, as a plain descriptor ({programId, keys, data}) — no web3 objects, so it can
// be asserted in Node and turned into a TransactionInstruction only inside build().
//   accounts: [token account (writable), owner (signer)]   data: [Revoke]
// (spl-token's createRevokeInstruction with no multisig signers — exactly this shape.)
export function revokeDescriptor(tokenAccount, owner, program) {
  return {
    programId: program,
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: [REVOKE_TAG],
  };
}

function toInstruction(web3, d) {
  const { PublicKey, TransactionInstruction } = web3;
  return new TransactionInstruction({
    programId: new PublicKey(d.programId),
    keys: d.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    data: new Uint8Array(d.data),
  });
}

// Build + sign + submit + confirm ONE batch through the shared seam. Returns signSendConfirm's
// own result ({status: sent|failed|unconfirmed|declined, sig?, error?}) plus the accounts it
// was built for, so the caller can re-read exactly those.
//
// `owner` is the address the LIST was scanned for. sign.js re-reads the wallet's live account
// right before building and hands build() that live address; if it is not the scanned owner the
// build refuses — a Revoke signed by a different account than the one that owns the token
// accounts fails on-chain anyway, but refusing here means the person is told why instead of
// reading a raw program error.
export async function runRevoke({ provider, owner, batch }) {
  const accounts = (batch || []).map((r) => revocable(r)).filter(Boolean);
  if (!accounts.length) return { status: "failed", error: "Nothing to revoke.", accounts: [] };
  const res = await signSendConfirm({
    provider,
    owner,
    build: (web3, blockhash, live) => {
      if (live !== owner) throw new Error("Your wallet switched accounts — reconnect and rescan.");
      const { Transaction, PublicKey } = web3;
      const tx = new Transaction();
      accounts.forEach((a) => tx.add(toInstruction(web3, revokeDescriptor(a.tokenAccount, live, a.program))));
      tx.feePayer = new PublicKey(live);
      tx.recentBlockhash = blockhash;
      return tx;
    },
  });
  return { ...res, accounts };
}

// The empirical half. Re-reads each token account and reports, per account, what the chain says
// NOW. Never a single boolean: `unreadable` is its own bucket and never folded into `cleared`.
//   { cleared: [tokenAccount…], still: [{tokenAccount, delegate}…], unreadable: [tokenAccount…] }
// A token account that no longer exists has no delegate — that is `cleared`, and honestly so
// (the approval cannot be exercised on an account that is gone). A whole-call failure marks
// every account unreadable rather than throwing: the caller has already put a transaction on
// chain and needs an answer shaped for a screen, not an exception.
export async function verifyRevoked(rpc, tokenAccounts) {
  const list = (tokenAccounts || []).filter((a) => ADDR_RE.test(String(a || "")));
  const out = { cleared: [], still: [], unreadable: [] };
  if (!list.length) return out;
  let res;
  try {
    res = await rpc("getMultipleAccounts", [list, { encoding: "jsonParsed", commitment: "confirmed" }]);
  } catch (_) {
    out.unreadable = list.slice();
    return out;
  }
  const value = res && Array.isArray(res.value) ? res.value : null;
  if (!value) { out.unreadable = list.slice(); return out; }
  list.forEach((ta, i) => {
    const acc = value[i];
    if (acc === null) { out.cleared.push(ta); return; }            // closed: nothing to delegate
    const info = acc && acc.data && acc.data.parsed && acc.data.parsed.info;
    if (!info || typeof info !== "object") { out.unreadable.push(ta); return; }   // not parsed: unknown
    if (info.delegate) out.still.push({ tokenAccount: ta, delegate: String(info.delegate) });
    else out.cleared.push(ta);
  });
  return out;
}
