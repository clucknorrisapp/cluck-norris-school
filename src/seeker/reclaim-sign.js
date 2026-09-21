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

// No Node Buffer here either — same rule as above, plain browser primitives only.
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Re-reads the CURRENT on-chain state of exactly the candidate token accounts, immediately
// before building (spec Rule 6: smallest possible window between the read and the signature).
// Uses getMultipleAccounts (one RPC call for the whole candidate set, like public/airdrop-
// engine.js's checkRecipientAtas) rather than re-walking the owner's whole token-account list.
// Returns the shape CluckReclaimPlan.reverifyBalances expects: { [tokenAccount]: {exists,
// uiAmount} }. On ANY failure returns null — "could not read the chain", never an empty object
// (an empty object would read as "every account vanished", which is not the same claim as "we
// don't know" and must not be treated as safe to proceed).
export async function getFreshBalances(rpc, tokenAccounts) {
  if (!tokenAccounts.length) return {};
  try {
    const res = await rpc("getMultipleAccounts", [tokenAccounts, { encoding: "jsonParsed" }]);
    const list = (res && res.value) || [];
    const out = {};
    tokenAccounts.forEach((ta, i) => {
      const acc = list[i];
      if (!acc) { out[ta] = { exists: false, uiAmount: null }; return; }
      const info = acc.data && acc.data.parsed && acc.data.parsed.info;
      const ui = info && info.tokenAmount && info.tokenAmount.uiAmount;
      out[ta] = { exists: true, uiAmount: typeof ui === "number" ? ui : Number(ui) };
    });
    return out;
  } catch (_) {
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

// Polls up to 30s, same posture as public/airdrop-engine.js's confirmTransaction: true = landed,
// throw = failed on-chain, false = timed out (ambiguous — CluckReclaimPlan reports that as
// "failed" with the signature attached rather than ever claiming success from a submission alone).
export async function confirmSignature(rpc, signature) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const result = await rpc("getSignatureStatuses", [[signature]]);
    const st = result && result.value && result.value[0];
    // ⚠️ ORDER IS LOAD-BEARING — same note as public/airdrop-engine.js, where this bug was
    // LIVE. getSignatureStatuses returns BOTH fields for a transaction that landed and then
    // failed: {err:{InstructionError:[...]}, confirmationStatus:"confirmed"}. Testing the
    // status first returned true for a failed close, which marked every account in that batch
    // "Closed", added its rent to the reclaimed total, and recorded it as done so the pane
    // never offered it again — the user was told they got money they did not get. err is only
    // ever set once a tx has LANDED, and a landed tx always carries a confirmationStatus, so
    // the err check must come first or it is dead code.
    // The cause is carried through too: the pane used to render the tautology "closing
    // transaction failed on-chain: failed on-chain" on all 26 rows, with no cause and no
    // next step — a blanket error, which the spec forbids.
    if (st && st.err) throw new Error("failed on-chain: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return true;
  }
  return false;
}

// A user-rejected wallet prompt is not shaped the same way by every provider — normalize to a
// single `.rejected` flag CluckReclaimPlan.runReclaimFlow checks for. Every wallet in
// public/cluck-wallet.js's registry (Phantom-shaped or Wallet-Standard-shimmed) throws with one
// of these two vocabularies on a decline; anything else is a genuine failure, not a decline.
export function isUserRejection(e) {
  const msg = String((e && e.message) || e || "").toLowerCase();
  return msg.includes("user rejected") || msg.includes("declined") || (e && (e.code === 4001 || e.code === "4001"));
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
