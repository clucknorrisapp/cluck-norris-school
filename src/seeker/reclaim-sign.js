// Cluck Norris — Seeker app, Rent Reclaim SIGNING seam (increment 3, docs/SEEKER_APP_PLAN.md /
// docs/SEEKER_RECLAIM_SIGNING_SPEC.md).
//
// Deliberately thin (spec's build brief, decision 4): every DECISION — who is eligible, what a
// fresh re-read means, how many closes fit in one transaction, what counts as confirmed — lives
// in public/rent-reclaim-plan.js (loaded as window.CluckReclaimPlan, same global-script pattern
// as window.CluckRentMath — see that file's header). This file only:
//   1. turns a plain instruction DESCRIPTOR ({programId, keys, data}, no web3 objects) into a
//      real solanaWeb3.TransactionInstruction, and a batch of them into a Transaction;
//   2. reads fresh balances and confirms signatures over the shared RPC proxy (CluckUtil.rpc,
//      the same /api/helius-rpc every other page uses);
//   3. talks to the CONNECTED wallet (window.CluckWallet) to sign and submit.
// runFullReclaim() below is the only thing the pane calls; it wires those three jobs into the
// `io` shape CluckReclaimPlan.runReclaimFlow() expects and hands the result straight back.
//
// ⛔ web3.js is NOT bundled by vite here (docs/SEEKER_RECLAIM_SIGNING_SPEC.md §1 / decision 2):
// importing @solana/web3.js through vite needs the Node `Buffer` global browsers don't have, and
// this repo ships no polyfill — that silently killed three money paths at once (AGENTS.md). This
// file reads `window.solanaWeb3`, populated by seeker.html's
// <script src="/vendor/solana-web3-1.95.8.iife.min.js"> tag, exactly like public/airdrop-
// engine.js does. Never `import { ... } from "@solana/web3.js"` here.

function web3() {
  const w = typeof window !== "undefined" ? window.solanaWeb3 : null;
  if (!w) throw new Error("Solana web3 did not load on this page.");
  return w;
}

// Exported (beyond the one call the pane makes, runFullReclaim) so
// scripts/seeker-reclaim-sign-test.cjs can drive each translation/IO function directly with a
// fake `window` and fake RPC responses — no live RPC, no real signing, same posture as the pure
// module's own tests, just proving THIS file's actual code rather than a re-implementation of it.
export function toInstruction(descriptor) {
  const { PublicKey, TransactionInstruction } = web3();
  return new TransactionInstruction({
    programId: new PublicKey(descriptor.programId),
    keys: descriptor.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    data: new Uint8Array(descriptor.data),
  });
}

export function buildTransaction(descriptors, blockhash, feePayer) {
  const { Transaction, PublicKey } = web3();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = new PublicKey(feePayer);
  descriptors.forEach((d) => tx.add(toInstruction(d)));
  return tx;
}


// getMultipleAccounts' documented max is 100 pubkeys per call (⚠️ P1-A, adversarial review,
// 2026-09-21: lib/rent-reclaim.js allows up to 300 candidate accounts through, but this file sent
// the WHOLE set in one call — a wallet with 101+ dead accounts got a JSON-RPC error back, which
// this function correctly turned into `null` ["unavailable", never zero], but the pane then told
// exactly the wallets this feature is worth most to "Could not read the chain right now" forever.
// public/airdrop-engine.js's checkRecipientAtas — the file this seam's header says it copied —
// chunks at `var BATCH = 100;`; that chunking was dropped when this file was written. Restored
// here, same constant name, same behaviour: ANY chunk throwing fails the WHOLE read (never a
// partial result masquerading as complete).
const GET_MULTIPLE_ACCOUNTS_BATCH = 100;

// Re-reads the CURRENT on-chain state of exactly the candidate token accounts, immediately
// before building (spec Rule 6: smallest possible window between the read and the signature).
// Uses getMultipleAccounts (chunked at 100 pubkeys per call, its documented max) rather than
// re-walking the owner's whole token-account list. Returns the shape
// CluckReclaimPlan.reverifyBalances expects: { [tokenAccount]: {exists, amount, lamports, mint,
// owner} }.
//   - `amount` is the EXACT base-unit integer as a STRING (⚠️ P1-B: never `uiAmount`, which is
//     `f64 | null` in the RPC schema and coerces a Token-2022 withheld-fee account, or anything
//     the RPC can't ui-scale, to a false zero via `Number(null) === 0`).
//   - `lamports` and `mint` let reverifyBalances overwrite the confirm sheet's numbers with the
//     just-read on-chain truth (P2-I) instead of trusting whatever the server claimed minutes ago.
//   - `owner` here is the account's PARSED AUTHORITY (`data.parsed.info.owner` — the wallet that
//     actually controls the token account), NEVER the top-level `owner` field getMultipleAccounts
//     returns (that one is the OWNING PROGRAM id, i.e. the token program) — conflating the two
//     would silently defeat the P2-I owner-mismatch check this exists to serve.
// On ANY failure returns null — "could not read the chain", never an empty object (an empty
// object would read as "every account vanished", which is not the same claim as "we don't know"
// and must not be treated as safe to proceed).
// ── THE SIGNING SEAM NOW LIVES IN ONE FILE ───────────────────────────────────────────────────
// confirmSignature, isUserRejection and the byte helpers used to be DEFINED here, and the same
// confirmation check was also copy-pasted into public/airdrop-engine.js — where the identical
// P0 (testing confirmationStatus before err, so a transaction that landed and FAILED reported
// as success) was found on the same day, in both copies, by two independent reviewers. They are
// now src/seeker/sign.js's, shared by every tool in this app that touches a wallet, and
// RE-EXPORTED here so this file's own public surface is unchanged. Read sign.js's header for
// what each of its four protections costs when it is missing.
export { confirmSignature, isUserRejection, bytesToBase64, messageBytes, sameBytes } from "./sign.js";
import { confirmSignature, isUserRejection, bytesToBase64, messageBytes, sameBytes } from "./sign.js";

export async function getFreshBalances(rpc, tokenAccounts) {
  if (!tokenAccounts.length) return {};
  const out = {};
  try {
    for (let i = 0; i < tokenAccounts.length; i += GET_MULTIPLE_ACCOUNTS_BATCH) {
      const slice = tokenAccounts.slice(i, i + GET_MULTIPLE_ACCOUNTS_BATCH);
      const res = await rpc("getMultipleAccounts", [slice, { encoding: "jsonParsed" }]);
      const list = (res && res.value) || [];
      slice.forEach((ta, j) => {
        const acc = list[j];
        if (!acc) { out[ta] = { exists: false, amount: null, lamports: 0, mint: null, owner: null }; return; }
        const info = acc.data && acc.data.parsed && acc.data.parsed.info;
        const rawAmount = info && info.tokenAmount && info.tokenAmount.amount;
        out[ta] = {
          exists: true,
          amount: typeof rawAmount === "string" ? rawAmount : null,
          lamports: typeof acc.lamports === "number" ? acc.lamports : Number(acc.lamports) || 0,
          mint: (info && info.mint) || null,
          owner: (info && info.owner) || null,
        };
      });
    }
    return out;
  } catch (_) {
    // Any chunk failing fails the WHOLE read — a partial getFreshBalances result (some accounts
    // re-verified, others not) is exactly the "stale/unknown reads as safe" shape this function
    // must never produce.
    return null;
  }
}

export async function getBlockhash(rpc) {
  try {
    const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    return (bh && bh.value && bh.value.blockhash) || null;
  } catch (_) {
    return null;
  }
}




// Signs and submits every batch. Prefers provider.signAllTransactions (spec decision 5) so a
// multi-batch reclaim needs ONE wallet approval; falls back to signAndSendTransaction per batch
// for a wallet that only implements that. Returns the array CluckReclaimPlan.runReclaimFlow
// expects: one { sig } | { rejected: true } | { error } per batch. Throws { rejected: true } only
// when the ENTIRE run was declined in one prompt (the signAllTransactions path) before any
// signature exists at all.
export async function signAndSendAll(provider, rpc, descriptorBatches, blockhash, owner) {
  const CW = typeof window !== "undefined" ? window.CluckWallet : null;
  if (!CW) throw new Error("Wallet layer did not load.");

  // ⚠️ P2-J (adversarial review, 2026-09-21): `owner` was captured once, at connect time, and
  // never re-read before this — the single most dangerous moment in this feature. If the wallet
  // switched to a different account in the background (the person picked another one in the
  // extension, or another tab drove the same provider) between connect and this signature, every
  // close instruction below would still be built with the STALE owner as both the destination
  // and the closing authority — and the wallet may still happily sign it, because from ITS
  // current account's point of view the tx is asking it to sign as someone else's authority,
  // which real wallets refuse, but a shimmed/lenient one might not. Re-read the LIVE public key
  // right before building and refuse outright on any mismatch, rather than trusting the value
  // this function was handed.
  const livePubkey = provider && provider.publicKey && typeof provider.publicKey.toString === "function"
    ? provider.publicKey.toString() : null;
  if (livePubkey && livePubkey !== owner) {
    throw new Error("Your wallet switched accounts — reconnect and rescan.");
  }

  const txs = descriptorBatches.map((d) => buildTransaction(d, blockhash, owner));

  if (typeof provider.signAllTransactions === "function") {
    let signed;
    try {
      signed = await provider.signAllTransactions(txs);
    } catch (e) {
      if (isUserRejection(e)) { const err = new Error("declined"); err.rejected = true; throw err; }
      throw e;
    }
    const arr = Array.isArray(signed) ? signed : [signed];
    const out = [];
    for (let i = 0; i < txs.length; i++) {
      try {
        const realTx = CW.asTransaction(arr[i], txs[i]);
        // ⚠️ P2-H (adversarial review, 2026-09-21): a wallet whose signAllTransactions() returns
        // its results reordered, substituted, or otherwise different from what it was asked to
        // sign was proved to send successfully here, with the rows in this batch silently
        // carrying each other's signatures. Never trust that array position i in the wallet's
        // response corresponds to descriptorBatches[i] — compare the actual compiled MESSAGE
        // bytes against the transaction WE built, byte for byte, before calling sendTransaction.
        if (!sameBytes(messageBytes(txs[i]), messageBytes(realTx))) {
          out.push({ error: "the wallet returned a different transaction than the one you approved" });
          continue;
        }
        const raw = realTx.serialize();
        const sig = await rpc("sendTransaction", [bytesToBase64(raw), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
        out.push(sig ? { sig } : { error: "wallet/RPC returned no signature" });
      } catch (e) {
        out.push({ error: (e && e.message) || String(e) });
      }
    }
    return out;
  }

  if (typeof provider.signAndSendTransaction !== "function") {
    throw new Error("This wallet can't sign-and-send from the browser — try Phantom, Solflare or Backpack");
  }
  const out = [];
  for (let i = 0; i < txs.length; i++) {
    try {
      const res = await provider.signAndSendTransaction(txs[i]);
      const sig = (res && res.signature) || (typeof res === "string" ? res : null);
      out.push(sig ? { sig } : { error: "wallet returned no signature" });
    } catch (e) {
      out.push(isUserRejection(e) ? { rejected: true } : { error: (e && e.message) || String(e) });
    }
  }
  return out;
}

// The one call the pane makes. `wallet`: { address, provider } — the provider is whatever
// window.CluckWallet.connect() returned (App.jsx's useWallet keeps it, see RentReclaim.jsx).
// `accounts`: the eligible rows the pane is showing. `closedTokenAccounts`: tokenAccounts this
// session has already confirmed closed (idempotency across repeated taps — the pane accumulates
// this in its own state, see RentReclaim.jsx).
export async function runFullReclaim({ wallet, accounts, closedTokenAccounts }) {
  const CRP = typeof window !== "undefined" ? window.CluckReclaimPlan : null;
  if (!CRP) throw new Error("Reclaim plan module did not load.");
  const CU = typeof window !== "undefined" ? window.CluckUtil : null;
  if (!CU || typeof CU.rpc !== "function") throw new Error("RPC layer did not load.");
  const owner = wallet && wallet.address;
  const provider = wallet && wallet.provider;
  if (!owner || !provider) throw new Error("Connect a wallet first.");

  const rpc = (method, params) => CU.rpc(method, params);
  const io = {
    getFreshBalances: (tokenAccounts) => getFreshBalances(rpc, tokenAccounts),
    getBlockhash: () => getBlockhash(rpc),
    signAndSendAll: (descriptorBatches, blockhash, feePayer) => signAndSendAll(provider, rpc, descriptorBatches, blockhash, feePayer),
    confirmSignature: (sig) => confirmSignature(rpc, sig),
  };
  return CRP.runReclaimFlow({ accounts, owner, closedTokenAccounts }, io);
}

// P2-I: what the confirm sheet calls BEFORE showing a signature request, so the count and SOL a
// person is asked to approve come from a fresh chain read, not the (possibly minutes-old) initial
// scan. Never builds, never signs — only getFreshBalances is needed. Same shape contract as
// runFullReclaim: { wallet, accounts, closedTokenAccounts } in, CluckReclaimPlan.planConfirmation's
// result out ({ status, toClose, lamports, rows }).
export async function prepareConfirmation({ wallet, accounts, closedTokenAccounts }) {
  const CRP = typeof window !== "undefined" ? window.CluckReclaimPlan : null;
  if (!CRP) throw new Error("Reclaim plan module did not load.");
  const CU = typeof window !== "undefined" ? window.CluckUtil : null;
  if (!CU || typeof CU.rpc !== "function") throw new Error("RPC layer did not load.");
  const owner = wallet && wallet.address;
  if (!owner) throw new Error("Connect a wallet first.");

  const rpc = (method, params) => CU.rpc(method, params);
  const io = { getFreshBalances: (tokenAccounts) => getFreshBalances(rpc, tokenAccounts) };
  return CRP.planConfirmation({ accounts, owner, closedTokenAccounts }, io);
}
