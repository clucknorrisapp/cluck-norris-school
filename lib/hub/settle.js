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

// The one `why` that means "the transfer DID land, it just cannot be keyed into the journal" —
// never a fraud signal (see the file header above). Every other `why` this module can return is a
// REFUSAL: the caller (lib/hub/routes.js) must not record the row's legacy sent/paid state either
// (adv P0-2, docs/HUB_JOURNAL_VERIFY_2026-09-18.md) — a refused settlement never zeroes what a
// holder is owed.
const ATTRIBUTION_FAILURE_WHY = "could not attribute the transfer to one specific instruction (not found, or more than one transfer to this wallet in the same signature)";

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
function settleAndPersist({ projectId, journal, batches, batchId, wallet, sig, tx, mint, nowUnix, fundingWallet, fundedBy }) {
  const batch = batches && batches[batchId];
  if (!batch) return { journaled: false, why: "no_such_batch", journal, batches };
  const located = payoutVerify.locateTransferInstruction(tx, { mint, wallet, fundingWallet, fundedBy, nowUnix });
  if (!located) return { journaled: false, why: ATTRIBUTION_FAILURE_WHY, journal, batches };
  // adv P0-1: found, but not sourced from the project's funding wallet (or a listed fundedBy
  // wallet) — a hard refusal, distinct from "could not attribute" above.
  if (located.refused) return { journaled: false, why: located.refused, journal, batches };
  const s = L.settle({
    journal, projectId, batch: { ...batch, projectId },
    wallet, transfer: { sig, instructionIndex: located.instructionIndex, innerIndex: located.innerIndex, amountRaw: located.amountRaw, slot: located.slot, sourceWallet: located.sourceWallet || null },
    nowUnix,
    // Round 3 #1 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): every route path settles through THIS
    // function — exactOnly:true is what removes the excess/phantom-overpay arithmetic from the
    // live path entirely. lib/hub/routes.js's PASS 1 is responsible for picking, among a wallet's
    // several candidate transfers in one request, the one whose amount already equals the row's
    // remaining BEFORE calling this — this is the enforcement, that is the selection.
    exactOnly: true,
  });
  // Round 3 #1: an amount_mismatch refusal carries the expected/actual raw amounts through to the
  // caller's alert, same as every other fraud refusal names what it saw.
  if (!s.ok) return { journaled: false, why: s.error, owner: s.owner || null, expectedRaw: s.expectedRaw != null ? s.expectedRaw : null, actualRaw: s.actualRaw != null ? s.actualRaw : null, journal, batches };
  const stamped = A.stampSettled(batch, wallet, { sig, xferKey: s.entry.xferKey, amountRaw: s.entry.appliedRaw, nowUnix });
  return { journaled: true, xferKey: s.entry.xferKey, idempotent: !!s.idempotent, journal: s.journal, batches: { ...batches, [batchId]: stamped } };
}

module.exports = { settleAndPersist, ATTRIBUTION_FAILURE_WHY };
