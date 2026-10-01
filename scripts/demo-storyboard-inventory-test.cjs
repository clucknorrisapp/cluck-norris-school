#!/usr/bin/env node
"use strict";
// DEMO STORYBOARD INVENTORY — a dependency-free, no-server, no-browser drift guard.
//
// docs/DEMO_STORYBOARD.md's "Capture inventory" table is a claim about what's in
// docs/demo/2026-09-18/ — a filename, a viewport, a one-line description, per capture. That claim
// has drifted from the folder before (this task itself found and fixed a stale "23 files" count in
// the doc's own intro paragraph while the table underneath already said 25). This test makes the
// claim mechanically checkable instead of eyeballed:
//
//   1. every `{mobile,desktop}` pattern in the table expands to the two files it names, and every
//      literal filename is taken as-is;
//   2. the expanded set from the doc equals — not just overlaps — the real directory listing (a
//      file the doc doesn't mention, and a row naming a file that isn't there, both fail);
//   3. every real file is at or under the stated 300 KB per-file budget;
//   4. the doc's own stated file COUNT (the bold number in the intro paragraph) matches the real
//      count, so a future addition that updates the table but not the prose sentence — or vice
//      versa — fails here instead of shipping silently wrong.
//
// Usage: node scripts/demo-storyboard-inventory-test.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "DEMO_STORYBOARD.md");
const CAPTURE_DIR = path.join(ROOT, "docs", "demo", "2026-09-18");
const MAX_BYTES = 300 * 1024;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};

function expandBraces(name) {
  // "foo.{mobile,desktop}.png" -> ["foo.mobile.png", "foo.desktop.png"]; a plain name is returned
  // as a single-element array unchanged.
  const m = name.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!m) return [name];
  const [, pre, opts, post] = m;
  return opts.split(",").map((o) => pre + o.trim() + post);
}

function filenamesFromInventoryTable(md) {
  const marker = "## Capture inventory";
  const start = md.indexOf(marker);
  if (start === -1) throw new Error(`"${marker}" section not found in ${DOC_PATH}`);
  const section = md.slice(start);
  // Table rows: "| `name.png` | viewport | description |" — the filename is the first backticked
  // token in the first column. Stop at the next "---" (a following prose section) so we don't
  // pick up unrelated backticked strings later in the file.
  const lines = section.split("\n");
  const names = [];
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cellMatch = line.match(/^\|\s*`([^`]+\.(?:png|xml|json))`\s*\|/);
    if (cellMatch) names.push(cellMatch[1]);
  }
  return names;
}

function main() {
  console.log("\nDemo storyboard inventory — the doc's claim vs. the real folder\n");
  const md = fs.readFileSync(DOC_PATH, "utf8");

  const rawNames = filenamesFromInventoryTable(md);
  ok("the inventory table has rows", rawNames.length > 0, "found 0 `*.png`-cell rows under ## Capture inventory");

  const expected = new Set();
  for (const n of rawNames) for (const f of expandBraces(n)) expected.add(f);

  const actualFiles = fs.readdirSync(CAPTURE_DIR).filter((f) => !f.startsWith("."));
  const actual = new Set(actualFiles);

  const missingFromFolder = [...expected].filter((f) => !actual.has(f)).sort();
  const undocumented = [...actual].filter((f) => !expected.has(f)).sort();

  ok(
    "every file the doc's table names actually exists in docs/demo/2026-09-18/",
    missingFromFolder.length === 0,
    missingFromFolder.join(", "),
  );
  ok(
    "every file in docs/demo/2026-09-18/ is named in the doc's table (no undocumented capture)",
    undocumented.length === 0,
    undocumented.join(", "),
  );
  ok(
    "expanded table count equals the real folder count",
    expected.size === actual.size,
    `table expands to ${expected.size}, folder has ${actual.size}`,
  );

  // Per-file size budget.
  const oversize = [];
  for (const f of actualFiles) {
    const size = fs.statSync(path.join(CAPTURE_DIR, f)).size;
    if (size > MAX_BYTES) oversize.push(`${f} (${size} bytes)`);
  }
  ok(`every capture is at or under the ${MAX_BYTES / 1024} KB budget`, oversize.length === 0, oversize.join(", "));

  // The doc's own stated total count (intro paragraph: "**53 files total**" or similar bold
  // integer immediately followed by "file" — read generously so future prose rewording doesn't
  // need this test rewritten, but still catches a stale number).
  const totalClaim = md.match(/\*\*(\d+)\s+files?\s+total[^*]*\*\*/i);
  ok(
    "the doc states its own total file count in bold, once",
    !!totalClaim,
    "expected a \"**N files total**\"-shaped sentence near the Capture inventory intro",
  );
  if (totalClaim) {
    const claimed = parseInt(totalClaim[1], 10);
    ok(
      "the doc's stated total count matches the real folder count",
      claimed === actual.size,
      `doc says ${claimed}, folder has ${actual.size}`,
    );
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
