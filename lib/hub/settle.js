"use strict";
// lib/hub/settle.js — the journal-first half of a Hub payout row, shared by the self-signed
// (`&sent=`) and managed-payer (`&send=`) branches of POST /api/hub/:project/payout (lib/hub/
// routes.js), and by scripts/hub-settle-route-test.cjs directly.
//
// The LEGACY write (pay.recordSent updating `batches[id].sent[wallet]` + `paid[wallet]`) is what
// actually pays today and is untouched by this file — it happens first, exactly as before this
// change (lib/hub/README.md "the receipt gap"). This module adds the Addendum-B1 settlement journal
// and the lib/hub/attempts.js attempt-state stamp ON TOP of an already-legacy-updated batch, and
// hands back everything the caller needs to land ALL of it — the journal event, the attempt
// transition, and the legacy sent/paid row — in ONE `hubStore.writeManyVerifiedMixed` persist
// (CLAUDE.md: a money journal spanning two kv keys is one persist; the journal is a THIRD key,
// global rather than per-project, so this never uses the plain two-key writeManyVerified).
//
// Pure except for the one thing it cannot avoid needing: `tx` (a jsonParsed getTransaction result)
// is fetched by the CALLER — this file does no RPC. That keeps it trivially testable with a fake
// transaction fixture, the same DI style as the other hub tests.

const L = require("./ledger");
const A = require("./attempts");
const payoutVerify = require("../payout-verify");

// Verify (via payoutVerify.locateTransferInstruction — Addendum B1: the chain's own identity, never
// a fabricated instruction index), settle the journal, and stamp the attempt as `settled`, for ONE
// already-legacy-recorded row. Never mutates its inputs; returns the values the caller persists.
//
//   { journaled: true,  xferKey, journal, batches }   settled — batches[batchId] now also carries
//                                                      attempts[wallet] = {state:"settled", ...}
//   { journaled: false, why, journal, batches }       nothing new was written (batches/journal come
//                                                      back UNCHANGED) — the transfer could not be
//                                                      attributed to one instruction, or the journal
//                                                      already names a different row/project (a
//                                                      transfer_already_consumed race — surfaced,
//                                                      never silently accepted or retried blind).
//                                                      The legacy sent/paid row the caller already
//                                                      wrote is NOT reverted by this: it did land.
//
// `journal` is the CURRENT full journal object (as lib/hub/store.js readJournal returns); `batches`
// is the project's current {id: batch} map — only `batches[batchId]` is read or changed.
function settleAndPersist({ projectId, journal, batches, batchId, wallet, sig, tx, mint, nowUnix }) {
  const batch = batches && batches[batchId];
  if (!batch) return { journaled: false, why: "no_such_batch", journal, batches };
  const located = payoutVerify.locateTransferInstruction(tx, { mint, wallet });
  if (!located) return { journaled: false, why: "could not attribute the transfer to one specific instruction (not found, or more than one transfer to this wallet in the same signature)", journal, batches };
  const s = L.settle({
    journal, projectId, batch: { ...batch, projectId },
    wallet, transfer: { sig, instructionIndex: located.instructionIndex, innerIndex: located.innerIndex, amountRaw: located.amountRaw, slot: located.slot },
    nowUnix,
  });
  if (!s.ok) return { journaled: false, why: s.error, owner: s.owner || null, journal, batches };
  const stamped = A.stampSettled(batch, wallet, { sig, xferKey: s.entry.xferKey, amountRaw: s.entry.appliedRaw, nowUnix });
  return { journaled: true, xferKey: s.entry.xferKey, idempotent: !!s.idempotent, journal: s.journal, batches: { ...batches, [batchId]: stamped } };
}

module.exports = { settleAndPersist };
