#!/usr/bin/env node
"use strict";
// scripts/hub-journal-backfill-preview.cjs — W3, item 4 (docs/COLOSSEUM_ROADMAP.md §W3): a
// READ-ONLY preview of what a settlement-journal backfill for one project WOULD derive from its
// existing `batches[].sent` rows. It never writes anything, to the journal or anywhere else.
// Applying a backfill is a separate, OWNER-RUN step this script does not build — see
// lib/hub/README.md's "receipt gap" section for why a legacy row without a journal event stays
// legacy until one is applied.
//
// Usage:
//   node scripts/hub-journal-backfill-preview.cjs --project <id>
//   DATA_DIR=/path/to/data node scripts/hub-journal-backfill-preview.cjs --project cuna
//
// What it prints, per row already recorded `sent` with no matching journal entry (a journal entry
// is matched by (batchId, wallet) — the real key is the chain identity `settle:<sig>:
// <instructionIndex>[:<innerIndex>]`, which this script CANNOT derive without reading the
// transaction on-chain; see "What this does NOT do" below):
//   signature, wallet, amountRaw, at (unix seconds the row was recorded sent), batchId.
//
// What this does NOT do (by design, not an oversight):
//   - It never reads the chain, so it cannot locate the SPECIFIC transfer instruction a real
//     journal entry needs (lib/payout-verify.js locateTransferInstruction) — the real backfill
//     step (not built here) would need `getTx(sig)` for each row, exactly as
//     lib/hub/settle.js settleAndPersist does for a live payout.
//   - It never writes to the journal, the registry, or any project store. Nothing here is a
//     kv.set of any kind.
//   - It does not decide policy for a row that could not be attributed (skip it forever? re-try
//     later?) — that is the owner's call when the real backfill ships.

const path = require("path");

function parseArgs(argv) {
  const out = { project: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) { out.project = String(argv[++i]); }
  }
  return out;
}

function main() {
  const { project } = parseArgs(process.argv.slice(2));
  if (!project) {
    console.error("usage: node scripts/hub-journal-backfill-preview.cjs --project <id>");
    process.exit(1);
  }
  const hubStore = require(path.join(__dirname, "..", "lib", "hub", "store"));
  const kv = require(path.join(__dirname, "..", "lib", "kvstore"));

  let batches, journal;
  try { batches = hubStore.read(kv, project, "batches", {}) || {}; }
  catch (e) { console.error(`not a valid project id: ${project} (${e.message})`); process.exit(1); }
  try { journal = hubStore.readJournal(kv) || {}; } catch (_) { journal = {}; }

  const alreadyJournaled = new Set();
  for (const e of Object.values(journal)) {
    if (e && e.projectId === project) alreadyJournaled.add(`${e.batchId}:${e.wallet}`);
  }

  const rows = [];
  for (const [batchId, b] of Object.entries(batches)) {
    if (!b || !b.sent) continue;
    for (const [wallet, s] of Object.entries(b.sent)) {
      if (!s || !s.sig) continue;                                  // manual/no-signature rows have nothing to derive
      if (alreadyJournaled.has(`${batchId}:${wallet}`)) continue;   // already dual-written — nothing to backfill
      rows.push({ batchId, wallet, sig: s.sig, amountRaw: String((b.amounts || {})[wallet] || "0"), at: Number(s.at) || null, pending: !!s.pending });
    }
  }
  rows.sort((a, b2) => (a.at || 0) - (b2.at || 0) || a.batchId.localeCompare(b2.batchId));

  console.log(`\nproject: ${project}`);
  console.log(`batches inspected: ${Object.keys(batches).length}`);
  console.log(`rows already in the journal: ${alreadyJournaled.size}`);
  console.log(`rows that WOULD be previewed for backfill: ${rows.length}\n`);
  if (!rows.length) {
    console.log("nothing to preview — every sent row already has a journal event, or this project has no sent rows.\n");
    process.exit(0);
  }
  for (const r of rows) {
    const when = r.at ? new Date(r.at * 1000).toISOString() : "(unknown)";
    console.log(`  batch=${r.batchId}  wallet=${r.wallet}  amountRaw=${r.amountRaw}  sig=${r.sig}  at=${when}${r.pending ? "  [still pending]" : ""}`);
  }
  console.log(
    "\nThis is a PREVIEW ONLY — nothing was written. A real backfill for these rows still needs a\n" +
    "chain read per signature (getTx) to locate the specific transfer instruction, exactly as\n" +
    "lib/hub/settle.js settleAndPersist does for a live payout — that step, and the decision of how\n" +
    "to handle a row whose transfer cannot be attributed, is the owner's to run separately.\n"
  );
}

main();
