// The Seeker app's ONE signing seam — the four protections every tool that touches a wallet
// needs, in one place.
//
// ⚠️ THIS FILE EXISTS BECAUSE ITS CONTENTS WERE ALREADY WRONG ONCE, IN TWO COPIES.
// The confirmation check below shipped as a P0 in BOTH public/airdrop-engine.js and
// src/seeker/reclaim-sign.js: the same bug, copy-pasted, found by two independent reviewers on
// the same day, telling people money had moved when it had not. Everything here was proven in
// one of those files and is now shared rather than copied a third, fourth and fifth time as
// Firepit, Project Burn and the Locker Room grew signing legs. AGENTS.md: `function esc(` was
// migrated everywhere while six copies written a different way survived, one carrying an XSS gap.
//
// The four, and what each one costs when it is missing:
//
//   1. CONFIRMATION, err FIRST. getSignatureStatuses returns BOTH fields for a transaction that
//      landed and then FAILED: {err:{...}, confirmationStatus:"confirmed"}. Testing the status
//      first returns true for a failure. `err` is only ever set once a tx has landed, and a
//      landed tx always carries a status, so the err check must come first or it is dead code.
//      And an RPC READ failure is not an on-chain failure: the transaction may already have
//      landed, so a blip keeps polling instead of reporting a loss that did not happen.
//
//   2. THREE OUTCOMES, NEVER TWO. true = landed. throw = failed on-chain, nobody was paid.
//      false = 30s with no status, AMBIGUOUS: it may still land. "Sent" makes unpaid people look
//      paid; "failed" invites a resend that double-pays. The caller must keep all three.
//
//   3. THE LIVE PUBLIC KEY, RE-READ IMMEDIATELY BEFORE SIGNING. An address captured at connect
//      time goes stale if the person switches accounts in their wallet, or another tab drives
//      the same provider. A transaction built for the old account and signed by the new one is
//      the single most dangerous moment in any of these tools. Refuse on mismatch.
//
//   5. A FAILED SUBMISSION IS NOT A FAILED TRANSACTION. The signature is determined when the
//      wallet signs, not when a node accepts. A dropped connection or a 502 from the edge after
//      the request left the device leaves a signed, valid transaction that may already be on
//      chain — reporting that as "nothing happened", with a retry button, burns, closes or locks
//      the same tokens twice. Only a JSON-RPC error FROM the node proves it did not land.
//
//   4. THE MESSAGE BYTES, DIFFED AGAINST WHAT WE BUILT. A wallet that returns its results
//      reordered or substituted was proved to send successfully — rows silently carrying each
//      other's signatures. Never trust that what came back is what was approved: compare the
//      compiled message bytes before submitting.
//
// No Node Buffer anywhere in this file, and no layout encoders: AGENTS.md forbids calling
// SystemProgram.transfer() or any web3.js encoder in a browser page (they encode u64 through
// toBufferLE(), which needs a global browsers don't have and we ship no polyfill — it silently
// killed three money paths at once). Instructions come from window.splToken, the byte-verified
// shim public/airdrop-engine.js installs.

// Plain browser primitives only — see the note above about Buffer.
export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// A signed transaction's own signature, base58, read straight off the transaction. Uses
// cluck-wallet.js's one base58 implementation rather than a copy (see its export note).
// Returns null when the transaction is not signed — never a fabricated string.
//
// v0 (VersionedTransaction) note (docs/SEEKER_SWAP_DESIGN.md, "the one technical gap"): a legacy
// Transaction's signatures are `{publicKey, signature}` objects, one per signer slot, empty until
// a slot is filled. A VersionedTransaction's `signatures` is instead an array of raw Uint8Array
// signatures, one per required signer, PRE-ALLOCATED as 64 zero bytes before signing — so
// `signatures[0]` always exists on a v0 tx, signed or not, and the only way to tell them apart is
// to check whether it's still all zero. Getting this wrong silently drops protection (5) — a
// transport failure on a swap would report "nothing happened" instead of "may have landed".
export function signatureOf(tx) {
  try {
    const CW = typeof window !== "undefined" ? window.CluckWallet : null;
    if (!CW || typeof CW.b58encode !== "function") return null;
    if (tx && tx.version !== undefined) {
      const s = tx.signatures && tx.signatures[0];
      if (!s || typeof s.length !== "number" || s.length !== 64) return null;
      let allZero = true;
      for (let i = 0; i < s.length; i++) { if (s[i] !== 0) { allZero = false; break; } }
      if (allZero) return null;
      return CW.b58encode(s) || null;
    }
    const s = tx && tx.signatures && tx.signatures[0] && tx.signatures[0].signature;
    if (!s) return null;
    return CW.b58encode(s) || null;
  } catch (_) { return null; }
}

// v0 messages are compiled at construction time (`message`), never lazily like a legacy
// Transaction's `compileMessage()` — calling `.compileMessage()` on a VersionedTransaction throws
// (it has no such method), which used to make this return null for every v0 tx and FAIL the byte
// diff in signSendConfirm as "the wallet returned a different transaction" (protection 4).
export function messageBytes(tx) {
  try { return tx.version !== undefined ? tx.message.serialize() : tx.compileMessage().serialize(); } catch (_) { return null; }
}
export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// (1) and (2). Polls up to 30s.
//   true  — landed and succeeded.
//   throw — landed and FAILED. The cause is carried in the message, never a bare "failed".
//   false — no status after 30s. AMBIGUOUS. The caller reports "unconfirmed" with the signature,
//           never "sent" and never "failed".
// `opts.searchHistory` — for a MANUAL recheck of an older signature, minutes or hours after the
// fact. getSignatureStatuses only looks at the validator's recent-status cache by default, so a
// transaction that genuinely landed long ago falls out of it and comes back `null`, which this
// function correctly reports as ambiguous — and a person clicking "Check status" on yesterday's
// unconfirmed burn would get "still unconfirmed" forever, with no way to ever resolve it.
// Flagged while Firepit and Project Burn were being built on this seam. Off by default: the
// search is expensive and pointless during the 30-second poll right after submitting, when the
// transaction cannot possibly have aged out yet.
//
// `opts.attempts` — 1 for a manual recheck (answer now), the default 30 for the post-submit poll.
export async function confirmSignature(rpc, signature, opts) {
  const attempts = (opts && opts.attempts) || 30;
  const cfg = (opts && opts.searchHistory) ? { searchTransactionHistory: true } : {};
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let result;
    try {
      result = await rpc("getSignatureStatuses", [[signature], cfg]);
    } catch (_) {
      // (1), second half: a network blip while polling is NOT an on-chain failure. Keep going.
      // Failing every attempt still ends in `false` (ambiguous), never a fabricated failure.
      continue;
    }
    const st = result && result.value && result.value[0];
    // ⚠️ ORDER IS LOAD-BEARING — see (1). Do not reorder these two lines.
    if (st && st.err) throw new Error("failed on-chain: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return true;
  }
  return false;
}

// A MANUAL RECHECK helper for a pane whose transaction carries its OWN upstream-issued expiry
// (`lastValidBlockHeight`, e.g. Jupiter's swap build — docs/SEEKER_SWAP_DESIGN.md, fix round
// P2-2) rather than a locally-fetched blockhash this seam tracked itself. Same err-before-
// confirmationStatus rule as confirmSignature() above, PLUS an expiry check: once the chain's
// current block height passes what the transaction was built against, it can no longer land —
// but that only proves nothing NEW can execute, never that this transaction didn't already land.
// An RPC READ failure is not an on-chain answer either way — it reports "pending" so a caller's
// poll loop just tries again. Exists here, not duplicated in a pane, so this is the ONE place
// that owns the err-before-confirmationStatus rule and the ONE place callers of
// getSignatureStatuses live (scripts/seeker-build-test.cjs pins that no pane calls
// getSignatureStatuses/sendTransaction directly).
//
// ⚠️ Codex round 30, P1 — "a PROCESSED transaction was declared expired." `processed` (or
// `confirmed`) with no `err` IS a landed transaction; block-height expiry only proves nothing NEW
// can execute against that blockhash — it says nothing about whether THIS signature already
// landed. The previous version fell straight into the height check for any non-confirmed status,
// including `processed`, and reported a transaction that was actively landing as "expired — safe
// to retry", which is exactly the double-spend risk this whole seam exists to prevent. `processed`
// now short-circuits to "pending" (keep polling) before the height is ever consulted. And once
// the height genuinely has passed with NO status at all, this does one FINAL
// `getSignatureStatuses` with `searchTransactionHistory: true` (broader than the recent-status
// cache the first call already used) before calling it "expired" — ambiguous results after that
// (an RPC error on the final check, or a status that's neither err nor confirmed/finalized/
// processed) stay "pending", never "safe to try again".
function statusOutcome(st) {
  // ⚠️ ORDER IS LOAD-BEARING — same as confirmSignature() above: err is only ever set once a
  // transaction has landed, so it must be checked before confirmationStatus.
  if (st && st.err) return { status: "failed", error: "failed on-chain: " + JSON.stringify(st.err) };
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { status: "sent" };
  if (st && st.confirmationStatus === "processed") return { status: "pending" }; // landed, not yet confirmed — never expired
  return null; // no status yet — caller decides what "no status" means in its own context
}
// ⚠️ Codex round 31, P2 — "malformed status responses become expired." The FINAL check below used
// to call anything falsy `finalSt` (a missing/malformed response, an RPC shape change, a proxy
// returning `{}` or `{value:[]}`) the SAME as an explicit, well-formed "nothing here" — and
// treated BOTH as "expired — safe to retry". A malformed response is not an answer; it is the
// absence of one, and the only honest reading of "no status" that may ever become "expired" is a
// RESPONSE THE NODE ACTUALLY SHAPED THAT WAY: `result.value` an array with an entry at index 0
// that is EXACTLY `null`. `{}`, `{value:[]}`, `null`, `undefined`, a non-array `value`, or a
// thrown RPC error must all stay `pending` — never `expired`, and (via statusOutcome's own null
// return for anything that isn't a well-formed status object) never `sent`/`failed` either.
function isWellFormedNullStatus(result) {
  return !!result && Array.isArray(result.value) && result.value.length > 0 && result.value[0] === null;
}
// A response's status entry, or `undefined` for anything not shaped like a well-formed
// `{value:[...]}` array — never assume a malformed shape's "missing" entry means the same thing
// as an explicit `null` at index 0 (see isWellFormedNullStatus above).
function statusEntry(result) {
  return result && Array.isArray(result.value) ? result.value[0] : undefined;
}
export async function checkPendingSwap(rpc, { signature, lastValidBlockHeight }) {
  try {
    const [stRes, height] = await Promise.all([
      rpc("getSignatureStatuses", [[signature], {}]),
      rpc("getBlockHeight", [{ commitment: "confirmed" }]),
    ]);
    const outcome = statusOutcome(statusEntry(stRes));
    if (outcome) return outcome;

    const h = typeof height === "number" ? height : null;
    if (h == null || lastValidBlockHeight == null || h <= lastValidBlockHeight) return { status: "pending" };

    // The height has passed with no status from the recent-status cache. One FINAL check with
    // searchTransactionHistory before calling it expired — the recent-status cache the call above
    // used can already have aged the signature out even though it landed.
    let finalRes;
    try {
      finalRes = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    } catch (_) {
      return { status: "pending" }; // an RPC read failure is not an on-chain answer either way
    }
    const finalOutcome = statusOutcome(statusEntry(finalRes));
    if (finalOutcome) return finalOutcome;
    // ONLY a well-formed explicit null counts as "truly nothing, ever" — a malformed response
    // (missing/empty `value`, non-array, etc.) is not proof of anything and stays pending.
    if (isWellFormedNullStatus(finalRes)) return { status: "expired" };
    return { status: "pending" }; // some other ambiguous shape — never guess "safe to retry"
  } catch (_) {
    return { status: "pending" };
  }
}

// A declined prompt is not shaped the same way by every provider. Every wallet in
// public/cluck-wallet.js's registry (Phantom-shaped or Wallet-Standard-shimmed) throws with one
// of these two vocabularies on a decline; anything else is a genuine failure, not a decline —
// and a decline must never be reported as an error the person did not cause.
export function isUserRejection(e) {
  const msg = String((e && e.message) || e || "").toLowerCase();
  return msg.includes("user rejected") || msg.includes("declined") || (e && (e.code === 4001 || e.code === "4001"));
}

// (3). Call this immediately before building anything the wallet will sign — not at connect
// time, and not from cached state. Returns the live address; throws if it moved.
export function assertSameAccount(provider, expected) {
  const live = provider && provider.publicKey && typeof provider.publicKey.toString === "function"
    ? provider.publicKey.toString() : null;
  if (live && expected && live !== expected) {
    throw new Error("Your wallet switched accounts — reconnect and try again.");
  }
  return live || expected;
}

export function rpcFn() {
  const CU = typeof window !== "undefined" ? window.CluckUtil : null;
  if (!CU || typeof CU.rpc !== "function") throw new Error("RPC layer did not load.");
  return (method, params) => CU.rpc(method, params);
}

export function splTokenShim() {
  const s = typeof window !== "undefined" ? window.splToken : null;
  if (!s || typeof s.createBurnCheckedInstruction !== "function") {
    throw new Error("The token instruction layer did not load. Reopen the app and try again.");
  }
  return s;
}

export async function latestBlockhash(rpc) {
  const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const h = bh && bh.value && bh.value.blockhash;
  if (!h) throw new Error("Could not fetch a recent blockhash.");
  return h;
}

// ⚠️ (5) A SUBMIT THAT THREW IS NOT PROOF THAT NOTHING LANDED — and this is the ONE place that
// knows it. Every path that puts a signed transaction on chain goes through here.
//
// Found by two independent adversarial reviews, separately, on the same day — the same signal
// that found the original err/confirmationStatus P0. `rpc()` throws in two very different
// situations, and every caller used to collapse them into one "failed":
//
//   · The NODE answered with a JSON-RPC error (`e.rpcError`, tagged by CluckUtil.rpc). It
//     received the transaction and refused it — bad blockhash, preflight/simulation failure, a
//     malformed request. Nothing executed and nothing was charged. Reporting "failed" is
//     correct, and a retry is safe.
//   · The request never completed, or the body was not JSON: a dropped mobile connection, a 502
//     or 524 with an HTML body from the edge, a timeout. The node may have received and
//     forwarded the transaction. It may be on chain right now.
//
// The second reported as "failed" is the exact lie this seam exists to prevent, and it came with
// a retry button: Project Burn said "Nothing was burned", Rent Reclaim said "Reclaimed 0 SOL",
// the Locker Room said "your tokens are where they were" — and the second signature burns,
// closes or locks the same tokens again, irreversibly.
//
// So on a transport failure we return the signature we ALREADY HOLD (an ed25519 signature over a
// fully-built transaction is determined the moment the wallet returns it, not when a node
// accepts it) and let the confirmation poll answer honestly: landed, landed-and-failed, or
// ambiguous.
//
// Returns exactly one of:
//   { sig }                            — the node accepted the submission
//   { sig, transportFailed: true, error }
//                                      — we could not tell. MAY be on chain. Poll `sig`; never
//                                        report "nothing happened" and never retry blind.
//   { error }                          — the node refused it, or we never had a signature.
//                                        Nothing landed; a retry is safe.
// It NEVER throws for a send failure. A user decline is re-thrown untouched so callers keep
// their own decline handling.
export async function submitSigned(rpc, realTx, opts) {
  const skipPreflight = !!(opts && opts.skipPreflight);
  const localSig = signatureOf(realTx);
  let raw;
  try {
    raw = realTx.serialize();
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
  try {
    const sig = await rpc("sendTransaction", [bytesToBase64(raw), { encoding: "base64", skipPreflight: skipPreflight, preflightCommitment: "confirmed" }]);
    if (sig) return { sig: sig };
    // A null/empty return is not a transport failure — the call completed and gave us nothing.
    // The local signature is still the honest answer if we have one.
    return localSig ? { sig: localSig, transportFailed: true, error: "the node returned no signature" }
                    : { error: "wallet/RPC returned no signature" };
  } catch (e) {
    if (isUserRejection(e)) throw e;
    if (localSig && !(e && e.rpcError)) {
      return { sig: localSig, transportFailed: true, error: (e && e.message) || String(e) };
    }
    return localSig ? { error: (e && e.message) || String(e), sig: localSig }
                    : { error: (e && e.message) || String(e) };
  }
}

// The one call a pane makes to put a transaction on chain.
//
// `build(web3, blockhash, owner)` must return an UNSIGNED web3 Transaction. It is called only
// AFTER (3) has passed, and with the LIVE owner — so a pane can never accidentally build against
// a stale address.
//
// Returns exactly one of, and the caller must keep all three apart (2):
//   { status: "sent",        sig }
//   { status: "failed",      sig?, error }      — nobody's tokens moved; retrying is safe
//   { status: "unconfirmed", sig }              — MAY have landed; check the signature, do not retry blind
//   { status: "declined" }                      — the person said no. Not an error.
// `coSign(realTx, web3)` — for the one case with a SECOND signer (the Locker Room's ephemeral
// escrow base key). It runs AFTER the wallet has signed and AFTER the byte diff (4), and before
// serialize. Two rules it exists to enforce, both from CLAUDE.md:
//   · The CONNECTED WALLET SIGNS FIRST, then extra signers. Pre-signing server-side, or reaching
//     for signAndSendTransaction when a non-wallet signer exists, is what makes Phantom show
//     "this transaction may be malicious".
//   · partialSign does not touch the compiled message, so the diff above stays meaningful — the
//     extra signature is added to a transaction whose contents were already checked against the
//     one the person approved.
// ⚠️ Codex round 30, P2 — "the pending record is saved too late." A pane used to persist its
// `{sig, lastValidBlockHeight, wallet}` record only once this function had returned `unconfirmed`
// — but the signature already exists the moment the wallet hands back a validly-diffed signed
// transaction (see the note above `submitSigned`), and `submitSigned`/`rpc("sendTransaction")` can
// throw from a transport failure BEFORE this function ever gets to return anything. A crash right
// there — the exact transport-failure case protection (5) exists for — lost the record entirely
// and left nothing on screen or in storage to resume checking. `onSigned(sig)` fires immediately
// after the wallet returns a validly-diffed signature (both the `signTransaction` path and the
// `signAndSendTransaction` path), BEFORE `submitSigned`/the send is attempted — so the caller can
// persist the record first and have it survive a throw. Errors from the callback itself are
// swallowed BY DEFAULT (this is a signing seam, not a storage layer — a storage failure must
// never silently block a swap that otherwise succeeded) UNLESS the caller opts into
// `requireOnSigned: true` — see the note below.
//
// ⚠️ Codex round 31, P2 — "a failed recovery-record write still allows broadcast." Swallowing
// `onSigned`'s failure unconditionally means a pane whose ONLY way to resume checking an
// in-flight transaction is that record (the Swap pane: `pending` state and the poll that resolves
// it both come from localStorage, nothing else remembers the signature) can broadcast a
// transaction it then has NO way to ever check on again — a full localStorage quota is exactly
// the moment a person is most likely to lose the one receipt of what just happened to their
// money. `requireOnSigned: true` changes the contract for a caller that needs the record to
// exist before it is willing to submit anything: an `onSigned` that THROWS, or explicitly
// `return`s `false`, STOPS the submission before `submitSigned` is ever called (on the
// `signTransaction` path — the one path where nothing has been sent to a node yet) and this
// function returns `{ status: "failed", error: RECOVERY_SAVE_ERROR, sig }` — the signature is
// still reported (it was validly diffed and is real; just never broadcast) so a person could look
// it up if they ever needed to, even though nothing was sent. On the `signAndSendTransaction`
// path the wallet has ALREADY broadcast by the time `onSigned` can run (that provider hands back
// an already-submitted signature, never a transaction to diff-then-send) — `requireOnSigned`
// cannot un-send it, so that path keeps the swallow-and-continue behaviour unchanged; the
// signature is still real and confirmable even without a recovery record.
const RECOVERY_SAVE_ERROR = "Could not save the recovery record — nothing was sent. Free some storage and try again.";
export async function signSendConfirm({ provider, owner, build, coSign, skipPreflight, onSigned, requireOnSigned }) {
  const CW = typeof window !== "undefined" ? window.CluckWallet : null;
  const web3 = typeof window !== "undefined" ? window.solanaWeb3 : null;
  if (!CW || !web3) return { status: "failed", error: "Wallet layer did not load." };
  if (!provider) return { status: "failed", error: "Connect a wallet first." };

  const rpc = rpcFn();
  let tx, live, approved;
  try {
    live = assertSameAccount(provider, owner);          // (3)
    const blockhash = await latestBlockhash(rpc);
    tx = build(web3, blockhash, live);
    if (!tx) return { status: "failed", error: "Nothing to sign." };
    // ⚠️ Codex round 27 P1: this MUST be an independent COPY, taken BEFORE the wallet ever sees
    // `tx`, and never re-read off `tx` after signing. A wallet whose signTransaction() mutates the
    // SAME transaction object in place (rather than returning a distinct signed copy) — legally
    // possible, and reproduced against both the legacy and v0 paths — used to make (4) compare
    // messageBytes(tx) against itself: `tx` was already the mutated object by the time
    // messageBytes(tx) ran below, so an approved amount silently changed to whatever the wallet
    // substituted and the diff passed anyway. `Uint8Array.from()` forces a real copy, not a view
    // over the same buffer the wallet might still be holding a reference to.
    const mb = messageBytes(tx);
    if (!mb) return { status: "failed", error: "Could not read the transaction to sign." };
    approved = Uint8Array.from(mb);
  } catch (e) {
    return { status: "failed", error: (e && e.message) || String(e) };
  }

  // ⚠️ THE SIGNATURE EXISTS BEFORE THE SEND DOES, and that fact is the whole of the fix below.
  // An ed25519 signature over a fully-built transaction is determined the moment the wallet
  // returns it — not when a node accepts it. So a submission that fails in TRANSPORT leaves us
  // holding the exact signature of a transaction that may already be in the cluster.
  let sig = null, localSig = null;
  try {
    if (typeof provider.signTransaction === "function") {
      // Sign-first, then WE submit. This is the order Phantom's "may be malicious" warning
      // depends on when a second signer is involved (CLAUDE.md), and it is also the only order
      // in which (4) is possible at all — signAndSendTransaction gives us back a signature with
      // no transaction to diff.
      const signed = await provider.signTransaction(tx);
      const realTx = CW.asTransaction ? CW.asTransaction(signed, tx) : signed;
      if (!sameBytes(approved, messageBytes(realTx))) {   // (4) — against the PRE-SIGN copy, never messageBytes(tx) here
        return { status: "failed", error: "The wallet returned a different transaction than the one you approved." };
      }
      if (typeof coSign === "function") coSign(realTx, web3);
      // round 30 P2 — persist BEFORE the send is even attempted, so a transport throw doesn't
      // lose the record. `signatureOf` reads the wallet's own signature off `realTx`, the same
      // value `submitSigned` will report as `localSig` if the send throws.
      // round 31 P2 — when the caller passed `requireOnSigned: true`, a failed (throwing or
      // `false`-returning) `onSigned` STOPS here, before submitSigned/the send is ever attempted:
      // nothing has reached a node yet on this path, so refusing to submit is still safe and
      // honest, and it is the only way to guarantee the recovery record exists before anything
      // is broadcast.
      if (typeof onSigned === "function") {
        const localSigForRecord = signatureOf(realTx);
        let onSignedOk = true;
        try {
          const r = onSigned(localSigForRecord);
          if (r === false) onSignedOk = false;
        } catch (_) {
          onSignedOk = false;
        }
        if (!onSignedOk && requireOnSigned) {
          return { status: "failed", error: RECOVERY_SAVE_ERROR, sig: localSigForRecord || undefined };
        }
        // otherwise: never block a swap on a storage failure — same as before round 31.
      }
      // (5) lives in submitSigned — the one place that knows a thrown submit is not proof that
      // nothing landed. Never inline an rpc("sendTransaction") next to this.
      const out = await submitSigned(rpc, realTx, { skipPreflight: !!skipPreflight });
      localSig = out.sig || null;
      if (out.transportFailed) {
        sig = out.sig;                 // MAY have landed — fall through to the poll, which decides
      } else if (out.sig && !out.error) {
        sig = out.sig;                 // the node accepted it
      } else {
        // The node ANSWERED and refused it. Nothing landed, so this is a real "failed" — even
        // though we hold a local signature, which is reported only so it can be looked up.
        return { status: "failed", sig: out.sig || undefined, error: out.error };
      }
    } else if (typeof coSign === "function") {
      // A wallet that can only signAndSendTransaction cannot be used here at all: the extra
      // signer never gets its turn, and the wallet would be asked to broadcast a transaction
      // missing a required signature. Say so rather than producing a confusing chain error.
      return { status: "failed", error: "This wallet can't sign this kind of transaction from here — try Phantom, Solflare, Backpack or Jupiter." };
    } else if (typeof provider.signAndSendTransaction === "function") {
      const res = await provider.signAndSendTransaction(tx);
      sig = (res && res.signature) || (typeof res === "string" ? res : null);
      // round 30 P2 — same persist-before-confirmation rule, for the one path that returns an
      // already-submitted signature instead of a transaction to diff. round 31 P2:
      // `requireOnSigned` is deliberately NOT honoured here — this provider has already
      // broadcast by the time `onSigned` can run, so there is nothing left to stop; the record
      // failing to save is unfortunate but the transaction is real either way, so the swallow
      // stays unconditional on this path.
      if (sig && typeof onSigned === "function") {
        try { onSigned(sig); } catch (_) { /* never block a swap on a storage failure */ }
      }
    } else {
      return { status: "failed", error: "This wallet can't sign from here — try Phantom, Solflare, Backpack or Jupiter." };
    }
  } catch (e) {
    if (isUserRejection(e)) return { status: "declined" };
    // submitSigned() handles protection (5) and does not throw for a send failure, so anything
    // arriving here threw BEFORE the transaction reached a node: the wallet prompt itself, the
    // byte diff, coSign, or a signAndSendTransaction wallet (which never hands us a transaction
    // to take a local signature from, so "failed" is the only honest answer for that branch).
    return { status: "failed", sig: localSig || undefined, error: (e && e.message) || String(e) };
  }
  // ⚠️ Never confirm(undefined): it burns the whole 30s poll and reports a transaction that WAS
  // submitted as if it never got a signature (airdrop-engine.js's own note, same trap).
  if (!sig) return { status: "failed", error: "The wallet returned no signature." };

  try {
    const landed = await confirmSignature(rpc, sig);
    // (2) — three outcomes, and the ambiguous one keeps its signature so a person can check
    // rather than guess.
    return landed ? { status: "sent", sig } : { status: "unconfirmed", sig };
  } catch (e) {
    return { status: "failed", sig, error: (e && e.message) || String(e) };
  }
}
