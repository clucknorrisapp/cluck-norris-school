"use strict";
// Payout attempts — every send identified by its own signature BEFORE broadcast (design §4, rev 4).
//
// The payout page never uses signAndSendTransaction. It asks the wallet to SIGN, reads the
// signature off the signed bytes, registers it here, and only a 2xx from that registration permits
// the broadcast. So nothing can land that the server has not recorded, and a lost tab at any point
// is recoverable from what is on disk:
//
//   pending ──attempt──▶ signing ──signature──▶ submitted ──reconcile: found+verified──▶ settled
//                          │                        │
//                          │ blockhash expired      │ blockhash expired AND a complete "not found"
//                          │ (nothing could land)   │ AND two reconciles >= 60 s apart agreed
//                          ▼                        ▼
//                       pending                  pending   (the attempt is kept as `failed[]`)
//
// Reconcile is by THAT signature only. No matching by payer / recipient / mint / amount, ever: a
// shared funding wallet or a second project paying the same person the same amount can never be
// mistaken for this attempt. A row in `signing` or `submitted` cannot be cancelled and its
// reservation cannot be released. A rebuild is only possible from `pending`. An RPC error, a
// timeout, `unavailable`, or a node that is behind keeps the row and the reservation exactly as
// they are — only a COMPLETE "not found" counts, and only with the blockhash provably expired.
//
// Pure. The attempt record lives on the batch (`batch.attempts[wallet]`); settlement goes through
// lib/hub/ledger.settle so the journal stays the single source of truth.

const L = require("./ledger");

const RECONCILE_AGREE_GAP_S = 60;
const LIVE = new Set(["signing", "submitted"]);

function attemptOf(batch, wallet) { return (batch && batch.attempts && batch.attempts[wallet]) || null; }
function isLive(batch, wallet) { const a = attemptOf(batch, wallet); return !!(a && LIVE.has(a.state)); }
function anyLive(batch) { return Object.keys((batch && batch.attempts) || {}).some((w) => isLive(batch, w)); }

function withAttempt(batch, wallet, attempt) {
  return { ...batch, attempts: { ...(batch.attempts || {}), [wallet]: attempt } };
}

// Step 1. Register an attempt: the row moves to `signing`, the transaction is built with exactly
// this blockhash, for exactly the row's remaining amount (a partial row narrows it).
function registerAttempt({ batch, wallet, journal, attemptId, recentBlockhash, lastValidBlockHeight, nowUnix }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch accepts attempts");
  if (!attemptId || typeof attemptId !== "string") throw new Error("attemptId is required (client random)");
  if (!recentBlockhash || !Number.isInteger(lastValidBlockHeight)) throw new Error("recentBlockhash and lastValidBlockHeight are required");
  const row = L.rowState(batch, wallet, L.journalFor(journal, batch.projectId));
  if (!row) throw new Error("row_not_in_batch");
  if (row.remainingRaw === "0") throw new Error("nothing remaining on this row");
  if (isLive(batch, wallet)) throw new Error(`row has a live attempt (${attemptOf(batch, wallet).state}) — reconcile it first`);
  const attempt = {
    attemptId, state: "signing", amountRaw: row.remainingRaw,
    recentBlockhash, lastValidBlockHeight, startedAt: Number(nowUnix) || 0,
    sig: null, sigAt: null, reconciles: [],
  };
  const prior = attemptOf(batch, wallet);
  if (prior) attempt.failed = [...(prior.failed || []), ...(prior.state === "failed" ? [strip(prior)] : [])];
  return { batch: withAttempt(batch, wallet, attempt), attempt };
}
function strip(a) { const { failed, ...rest } = a || {}; return rest; }

// Step 2. The signature, read off the signed transaction. Only after this returns may the client
// broadcast. The row is `submitted` from here: the server holds the exact signature, so a tab
// lost at any later moment reconciles from it.
function recordSignature({ batch, wallet, attemptId, sig, nowUnix }) {
  const a = attemptOf(batch, wallet);
  if (!a || a.attemptId !== attemptId) throw new Error("no such attempt on this row");
  if (a.state !== "signing") throw new Error(`attempt is ${a.state}, not signing`);
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(String(sig || ""))) throw new Error("a transaction signature is required");
  const next = { ...a, state: "submitted", sig: String(sig), sigAt: Number(nowUnix) || 0 };
  return { batch: withAttempt(batch, wallet, next), attempt: next };
}

// Reconcile ONE row from a lookup the caller did for the attempt's own signature.
//   lookup = { status: "found" | "not_found" | "unavailable", finalizedBlockHeight,
//              transfer: { instructionIndex, innerIndex, amountRaw, slot } | null }
// `transfer` is present only when the caller VERIFIED the transaction against this row (token
// program, mint, source = fundingWallet, destination owner). "unavailable" covers an RPC error, a
// timeout, or a node behind the tip — the row and its reservation stay exactly as they are.
function reconcile({ batch, wallet, journal, lookup, nowUnix }) {
  const a = attemptOf(batch, wallet);
  if (!a || !LIVE.has(a.state)) return { batch, journal, outcome: "no_live_attempt" };
  const now = Number(nowUnix) || 0;
  const expired = Number.isInteger(lookup && lookup.finalizedBlockHeight) && lookup.finalizedBlockHeight > a.lastValidBlockHeight;

  if (a.state === "signing") {
    // Nothing was broadcast by us and the wallet did not send it; once the blockhash has provably
    // expired a signed-but-unregistered transaction can no longer land.
    if (!expired) return { batch, journal, outcome: "kept" };
    const failed = { ...a, state: "failed", failedAt: now, why: "blockhash expired before a signature was registered" };
    return { batch: withAttempt(batch, wallet, failed), journal, outcome: "returned_to_pending" };
  }

  // submitted
  if (!lookup || lookup.status === "unavailable") return { batch, journal, outcome: "kept" };
  if (lookup.status === "found") {
    if (!lookup.transfer) return { batch, journal, outcome: "kept", note: "found but not verified against this row" };
    const r = L.settle({ journal, projectId: batch.projectId, batch, wallet, transfer: { sig: a.sig, ...lookup.transfer }, nowUnix: now });
    if (!r.ok) return { batch, journal, outcome: "refused", error: r.error, owner: r.owner };
    const done = { ...a, state: "settled", settledAt: now, xferKey: r.entry.xferKey };
    return { batch: withAttempt(batch, wallet, done), journal: r.journal, outcome: r.idempotent ? "already_settled" : "settled", entry: r.entry };
  }
  // not_found — a COMPLETE not-found. Requires blockhash expiry AND two consecutive agreeing
  // reconciles at least 60 s apart before the reservation is released.
  const recs = [...(a.reconciles || []), { at: now, status: "not_found", expired }];
  const agreed = expired && recs.length >= 2 && recs.slice(-2).every((r) => r.status === "not_found" && r.expired)
    && (recs[recs.length - 1].at - recs[recs.length - 2].at) >= RECONCILE_AGREE_GAP_S;
  if (!agreed) return { batch: withAttempt(batch, wallet, { ...a, reconciles: recs }), journal, outcome: "kept" };
  const failed = { ...a, reconciles: recs, state: "failed", failedAt: now, why: "blockhash expired and the transaction was never found" };
  return { batch: withAttempt(batch, wallet, failed), journal, outcome: "returned_to_pending" };
}

// Cancel refuses while any row is signing or submitted — its reservation cannot be released.
function cancelBatch({ batch, journal }) {
  if (anyLive(batch)) throw new Error("a row is signing or submitted — reconcile before cancelling");
  return L.cancelBatch({ batch, journal });
}

// The row's effective state for the page: the ledger's view plus the live attempt.
function rowView(batch, wallet, journal) {
  const row = L.rowState(batch, wallet, L.journalFor(journal, batch.projectId));
  if (!row) return null;
  const a = attemptOf(batch, wallet);
  const state = a && LIVE.has(a.state) ? a.state : row.state;
  return { ...row, state, attempt: a ? { attemptId: a.attemptId, state: a.state, sig: a.sig, amountRaw: a.amountRaw, lastValidBlockHeight: a.lastValidBlockHeight } : null, canRebuild: state === "pending" || state === "partial" };
}

module.exports = { RECONCILE_AGREE_GAP_S, attemptOf, isLive, anyLive, registerAttempt, recordSignature, reconcile, cancelBatch, rowView };
