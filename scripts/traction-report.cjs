#!/usr/bin/env node
"use strict";
// Prints the Colosseum W9 traction table, computed by lib/traction.js straight from the stores on
// this box's DATA_DIR volume (lib/kvstore.js — the same env var the server reads, default /data).
// Every number here is what docs/TRACTION_2026-09.md should quote, because every number here is
// reproducible: re-run this script and get the same figures from the same stored events, never a
// number typed into a doc by hand.
//
//   node scripts/traction-report.cjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// Defaults to the trailing 30 days when --from is omitted. Run it wherever DATA_DIR points at the
// real volume (on Railway, or locally with DATA_DIR set to a copy) — a fresh clone with no volume
// prints all zeros, honestly, because there is nothing to read yet.
//
// Read-only. Sends nothing, signs nothing, changes nothing.

function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("usage: node scripts/traction-report.cjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  process.exit(0);
}
const from = argVal("--from");
const to = argVal("--to");

const kv = require("../lib/kvstore");
const traction = require("../lib/traction");

const out = traction.compute({ kv, from, to });

console.log(`\nTraction — ${out.period.from} → ${out.period.to} (UTC days)\n`);
console.log(`kv persistent: ${typeof kv.isPersistent === "function" ? kv.isPersistent() : "unknown"}${kv.loadError && kv.loadError() ? "  ⚠ " + kv.loadError() : ""}\n`);

const rows = Object.entries(out.counters).map(([name, c]) => ({
  counter: name,
  value: String(c.value),
  denominator: c.denominator == null ? "—" : String(c.denominator),
  label: c.label,
}));

// A dependency-free table — this script runs in CI-equivalent environments with no npm install.
const cols = ["counter", "value", "denominator", "label"];
const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w - String(s).length));
console.log(cols.map((c, i) => pad(c, widths[i])).join("  "));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(cols.map((c, i) => pad(r[c], widths[i])).join("  "));

console.log("\nSource + notes per counter:\n");
for (const [name, c] of Object.entries(out.counters)) {
  console.log(`  ${name}`);
  console.log(`    source: ${c.source}`);
  if (c.note) console.log(`    note:   ${c.note}`);
  if (c.bySource) console.log(`    by source: ${JSON.stringify(c.bySource)}`);
}

// ── operator onboarding clock (Colosseum E7 / W6b "observed setup time") ──────────────────────
function fmtDur(sec) {
  if (sec == null) return "—";
  const s = Number(sec);
  if (!Number.isFinite(s)) return "—";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(Math.round(s));
  if (a < 3600) return `${sign}${Math.round(a / 60)}m`;
  if (a < 86400) return `${sign}${(a / 3600).toFixed(1)}h`;
  return `${sign}${(a / 86400).toFixed(1)}d`;
}
if (out.onboarding && out.onboarding.length) {
  console.log("\nOperator onboarding clock — observed setup time (W6b):\n");
  const obRows = out.onboarding.map((o) => ({
    project: o.project,
    "apply→approve": fmtDur(o.deltas.applyToApprove),
    "approve→v1": fmtDur(o.deltas.approveToFirstVersion),
    "v1→armed": fmtDur(o.deltas.firstVersionToFirstArm),
    "armed→batch": fmtDur(o.deltas.firstArmToFirstBatch),
    label: o.label,
  }));
  const obCols = ["project", "apply→approve", "approve→v1", "v1→armed", "armed→batch", "label"];
  const obWidths = obCols.map((c) => Math.max(c.length, ...obRows.map((r) => String(r[c]).length)));
  console.log(obCols.map((c, i) => pad(c, obWidths[i])).join("  "));
  console.log(obWidths.map((w) => "-".repeat(w)).join("  "));
  for (const r of obRows) console.log(obCols.map((c, i) => pad(r[c], obWidths[i])).join("  "));
}

if (out.caveats && out.caveats.length) {
  console.log("\nCaveats (say these out loud before quoting a number above):\n");
  for (const c of out.caveats) console.log("  - " + c);
}
console.log("");
