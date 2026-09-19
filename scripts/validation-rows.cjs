#!/usr/bin/env node
"use strict";
// scripts/validation-rows.cjs — Colosseum roadmap EE5.
//
// Prints the "onboarding clock, from the record" table docs/VALIDATION_2026-09.md quotes: one
// Markdown row per REGISTERED, non-demo Hub project (lib/hub/store.js's registry — "demo"/"demo-b"
// are the Colosseum fixture ids and are never written there, see lib/hub/demo-fixture.js and
// server.js's own "hubProjects() never contains demo/demo-b" comment, so no demo filter is even
// needed here in practice; this script still skips them defensively, once, rather than relying on
// that always staying true), reading ONLY the milestone timestamps lib/hub/project.js's
// milestonesInit() defines and lib/hub/apply.js / lib/hub/routes.js set once each via
// setMilestoneOnce:
//
//   appliedAt                 — the project's own /hub-apply submission (absent for a project the
//                                owner seeded directly, e.g. server.js's seedPokeDryRun)
//   approvedAt                — owner approval. This is what this script calls "registered."
//   firstPaidAt                — first platform-access payment verified (not shown here — it is
//                                about paying US for access, not about paying a project's holders,
//                                which is what this table is trying to measure)
//   firstVersionPublishedAt   — the project's first program version (terms) published
//   firstArmedAt              — lock-to-earn armed for the first time (not shown here either — see
//                                the caveat below on why the table skips straight from terms to a
//                                payout event)
//   firstBatchSignedAt        — the first payout batch row recorded sent (chain-verified for the
//                                self-sign / `&sent=` path; possibly still pending confirmation for
//                                the managed-payer `&send=` path — lib/hub/routes.js)
//
// Honesty note on the columns this prints, read this before trusting the numbers:
// The record has ONE milestone for "a payout actually happened" — firstBatchSignedAt. There is no
// separate milestone for "the batch was signed" versus "the payout was independently observed /
// confirmed on-chain" — lib/hub/store.js's settlement journal (JOURNAL_KEY, "hub:settle") exists in
// code but nothing ever calls writeJournal() on it today (grep the repo — readJournal has readers,
// writeJournal has none), so it cannot back a distinct "payout observed" timestamp either. This
// script therefore prints "first batch signed" and "first payout observed" from the SAME
// firstBatchSignedAt field, honestly, rather than inventing a second timestamp that does not exist
// in the store. If a later change adds a real, distinct "confirmed on-chain" milestone, split these
// two columns then — not before.
//
// Usage:
//   node scripts/validation-rows.cjs [--data-dir <dir>] [--json]
//
// Local only, no network: reads a DATA_DIR the same way lib/kvstore.js does (default /data, same
// env var the server reads). A DATA_DIR with no `hub:projects` key at all (a fresh clone, an empty
// volume) prints an empty TEMPLATE — the column headers and an honest note, never a guessed row.
//
// Read-only. Sends nothing, signs nothing, changes nothing.

function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("usage: node scripts/validation-rows.cjs [--data-dir <dir>] [--json]");
  process.exit(0);
}
// lib/kvstore.js reads process.env.DATA_DIR exactly once, at require time (it is a singleton) — so
// --data-dir must be applied to the env BEFORE that first require, same idiom every other script
// in this repo that takes --data-dir/DATA_DIR uses.
const dataDirArg = argVal("--data-dir");
if (dataDirArg) process.env.DATA_DIR = dataDirArg;
const asJson = process.argv.includes("--json");

const kv = require("../lib/kvstore");
const hubStore = require("../lib/hub/store");

function fmtDate(unixSec) {
  if (!Number.isFinite(unixSec)) return null;
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}
// Same shape as scripts/traction-report.cjs's fmtDur — reused deliberately so the same duration
// reads the same way in both places.
function fmtDur(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const sign = sec < 0 ? "-" : "+";
  const a = Math.abs(Math.round(sec));
  if (a < 60) return `${sign}${a}s`;
  if (a < 3600) return `${sign}${Math.round(a / 60)}m`;
  if (a < 86400) return `${sign}${(a / 3600).toFixed(1)}h`;
  return `${sign}${(a / 86400).toFixed(1)}d`;
}
function cell(unixSec, deltaSec) {
  if (!Number.isFinite(unixSec)) return "—"; // — never reached: never a guessed value
  const d = fmtDur(deltaSec);
  return d ? `${fmtDate(unixSec)} (${d})` : fmtDate(unixSec);
}

// Reads the registry the way a project actually gets registered — lib/hub/project.js's
// approveProject() sets status:"approved" and a milestones object; anything else (a "draft" that
// never got approved, or a malformed row) is not a registered project and does not get a row.
function approvedNonDemoRows(registry) {
  const rows = [];
  for (const [id, p] of Object.entries(registry || {})) {
    if (!p || p.status !== "approved") continue;
    if (id === "demo" || id === "demo-b") continue; // defensive only — see header comment
    const ms = (p.milestones) || {};
    const registeredAt = Number.isFinite(ms.approvedAt) ? Number(ms.approvedAt) : null;
    const deltaFromRegistered = (key) => {
      const v = ms[key];
      return registeredAt != null && Number.isFinite(v) ? Number(v) - registeredAt : null;
    };
    rows.push({
      id,
      label: String(p.label || id),
      dryRun: p.dryRun === true,
      registeredAt,
      firstVersionPublishedAt: Number.isFinite(ms.firstVersionPublishedAt) ? Number(ms.firstVersionPublishedAt) : null,
      firstVersionDelta: deltaFromRegistered("firstVersionPublishedAt"),
      firstBatchSignedAt: Number.isFinite(ms.firstBatchSignedAt) ? Number(ms.firstBatchSignedAt) : null,
      firstBatchDelta: deltaFromRegistered("firstBatchSignedAt"),
    });
  }
  rows.sort((a, b) => (a.registeredAt || 0) - (b.registeredAt || 0));
  return rows;
}

function main() {
  const dataDir = process.env.DATA_DIR || "/data";
  const raw = kv.get(hubStore.REGISTRY_KEY, undefined);
  const registry = raw && typeof raw === "object" ? raw : {};
  const rows = raw === undefined ? [] : approvedNonDemoRows(registry);
  const persistent = typeof kv.isPersistent === "function" ? kv.isPersistent() : "unknown";
  const loadError = typeof kv.loadError === "function" ? kv.loadError() : null;

  if (asJson) {
    console.log(JSON.stringify({
      dataDir, persistent, loadError,
      hasRegistry: raw !== undefined,
      generatedAtUnix: Math.floor(Date.now() / 1000),
      rows: rows.map((r) => ({
        id: r.id, label: r.label, dryRun: r.dryRun,
        registeredAt: r.registeredAt,
        firstVersionPublishedAt: r.firstVersionPublishedAt, firstVersionDelta: r.firstVersionDelta,
        firstBatchSignedAt: r.firstBatchSignedAt, firstBatchDelta: r.firstBatchDelta,
        // Same field as firstBatchSignedAt/firstBatchDelta — see the header's honesty note.
        firstPayoutObservedAt: r.firstBatchSignedAt, firstPayoutDelta: r.firstBatchDelta,
      })),
    }, null, 2));
    return;
  }

  console.log(`\nValidation rows — DATA_DIR=${dataDir}\n`);
  console.log(`kv persistent: ${persistent}${loadError ? "  ⚠ " + loadError : ""}`);
  if (raw === undefined) {
    console.log(`no \`${hubStore.REGISTRY_KEY}\` key found at this DATA_DIR — this is the empty template, not a result:\n`);
  } else if (!rows.length) {
    console.log("registry present but no approved, non-demo project has a row yet:\n");
  } else {
    console.log("");
  }

  const header = ["Project", "Registered", "First terms published (Δ)", "First batch signed (Δ)", "First payout observed (Δ)", "Dry run"];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const r of rows) {
    console.log(`| ${r.label} (\`${r.id}\`) | ${cell(r.registeredAt, null)} | ${cell(r.firstVersionPublishedAt, r.firstVersionDelta)} | ${cell(r.firstBatchSignedAt, r.firstBatchDelta)} | ${cell(r.firstBatchSignedAt, r.firstBatchDelta)} | ${r.dryRun ? "yes" : "no"} |`);
  }
  if (!rows.length) console.log(`| _(none yet)_ | — | — | — | — | — |`);
  console.log("");
}

main();
