#!/usr/bin/env node
"use strict";
// Pins docs/SEEKER_DEMO_INVENTORY.md — an INVENTORY document (facts for the owner's demo shot
// list and deck), not copy, so what it asserts is narrower than a pitch-doc test: that the doc
// stays IN SYNC with the code it claims to describe, rather than that its prose reads a
// particular way. Four things, no deps, plain node:
//
//   (a) ROUTE TABLES, BOTH DIRECTIONS. The doc's "Full (Seeker) edition" table must list exactly
//       the `<Route path="…">` entries in src/seeker/edition/full.jsx — every path the doc claims
//       exists in the file, AND every route in the file is written down (nothing silently added
//       to the shell and never inventoried). Same check for the "Education (Play/iOS) edition"
//       table against src/seeker/edition/edu.jsx. A route renamed, added or removed in either
//       edition file without updating this doc fails here.
//   (b) CAPTURES, BOTH DIRECTIONS. Every `docs/seeker/…` / `docs/demo/…` path written in the doc
//       (as inline code) must exist on disk (catches a typo'd filename), AND every file that
//       actually exists under docs/seeker/ or docs/demo/ must be named somewhere in the doc
//       (catches a new capture landing there that the inventory never picked up).
//   (c) NO LITERAL DOLLAR AMOUNT. The doc explicitly must never hardcode the tools-pass USD
//       threshold (CLAUDE.md: "never hardcode the amount" — it is live-priced) or any other price
//       figure as a literal `$<digit>`.
//   (d) NO FORBIDDEN WORD. Reuses the FORBIDDEN_ALL word list scripts/solana-room-test.cjs
//       already enforces on every public page in the school room (yield/APR/APY framing that
//       reads as a promise, Normie Quest, Wallet Watch — private, CLAUDE.md — Nomadz, and the
//       Solana Foundation, all closed/undiscussable topics per AGENTS.md).
//
// Usage: node scripts/seeker-demo-inventory-test.cjs

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "SEEKER_DEMO_INVENTORY.md");
const FULL_JSX = path.join(ROOT, "src", "seeker", "edition", "full.jsx");
const EDU_JSX = path.join(ROOT, "src", "seeker", "edition", "edu.jsx");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Route paths actually declared in an edition file: <Route path="…" …>
function routesIn(file) {
  const src = fs.readFileSync(file, "utf8");
  const re = /<Route\s+path="([^"]*)"/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

// The doc's route table for one edition: the text between a heading naming `editionFileBase`
// (e.g. "full.jsx") and the next "## " heading, then every table row's FIRST backticked cell
// (the Path column). Table rows look like "| `/tools/xray` | `WalletXray` | … |".
function docRoutesFor(doc, editionFileBase) {
  const headingRe = new RegExp("^##[^\\n]*" + editionFileBase.replace(/\./g, "\\.") + "[^\\n]*$", "m");
  const hm = headingRe.exec(doc);
  if (!hm) return null;
  const start = hm.index + hm[0].length;
  const rest = doc.slice(start);
  const nextHeading = rest.search(/^##\s/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const rowRe = /^\|\s*`([^`]*)`\s*\|/gm;
  const out = new Set();
  let m;
  while ((m = rowRe.exec(section))) out.add(m[1]);
  return out;
}

function setDiff(a, b) { return [...a].filter((x) => !b.has(x)); }

(async () => {
  console.log("\n(setup) reading the doc and the two edition files\n");
  ok("docs/SEEKER_DEMO_INVENTORY.md exists", fs.existsSync(DOC_PATH));
  ok("src/seeker/edition/full.jsx exists", fs.existsSync(FULL_JSX));
  ok("src/seeker/edition/edu.jsx exists", fs.existsSync(EDU_JSX));
  if (fail) { console.log(`\n${fail} FAILED (could not proceed)`); process.exit(1); }

  const doc = fs.readFileSync(DOC_PATH, "utf8");

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (a) route tables, both directions
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(a) route tables match the edition files, both directions\n");

  for (const [label, file, base] of [["full", FULL_JSX, "full.jsx"], ["edu", EDU_JSX, "edu.jsx"]]) {
    const actual = routesIn(file);
    ok(`${base}: at least one <Route path="…"> found in the file (sanity)`, actual.size > 0, "found none — did the file move or the pattern change?");
    const docSet = docRoutesFor(doc, base);
    ok(`doc has a route table under a heading naming "${base}"`, docSet !== null);
    if (docSet === null) continue;
    ok(`doc's ${label}-edition table lists at least one path`, docSet.size > 0);
    const docOnly = setDiff(docSet, actual);
    const fileOnly = setDiff(actual, docSet);
    ok(`every path the doc lists for ${base} is a real Route in that file`, docOnly.length === 0, docOnly);
    ok(`every Route in ${base} is listed in the doc`, fileOnly.length === 0, fileOnly);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (b) captures, both directions
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(b) capture files — doc and disk agree, both directions\n");

  const actualCaptures = new Set();
  for (const dir of ["docs/seeker", "docs/demo"]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) actualCaptures.add(path.relative(ROOT, f).split(path.sep).join("/"));
  }
  ok("found at least one file under docs/seeker/ or docs/demo/ (sanity)", actualCaptures.size > 0);

  const docCaptures = new Set();
  const captureRe = /`(docs\/(?:seeker|demo)\/[^`]+)`/g;
  let cm;
  while ((cm = captureRe.exec(doc))) docCaptures.add(cm[1]);
  ok("doc names at least one docs/seeker or docs/demo path", docCaptures.size > 0);

  const docPathsMissingOnDisk = [...docCaptures].filter((p) => !fs.existsSync(path.join(ROOT, p)));
  ok("every docs/seeker or docs/demo path named in the doc exists on disk", docPathsMissingOnDisk.length === 0, docPathsMissingOnDisk);

  const diskFilesNotInDoc = setDiff(actualCaptures, docCaptures);
  ok("every file under docs/seeker/ and docs/demo/ is named in the doc", diskFilesNotInDoc.length === 0, diskFilesNotInDoc);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (c) no literal dollar amount
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(c) no literal dollar amount ($<digit>)\n");
  const dollarHit = doc.match(/\$\d/);
  ok("no \"$\" followed by a digit anywhere in the doc", !dollarHit, dollarHit ? doc.slice(Math.max(0, dollarHit.index - 40), dollarHit.index + 40) : "");

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (d) forbidden words (FORBIDDEN_ALL from scripts/solana-room-test.cjs)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(d) no forbidden word (FORBIDDEN_ALL, scripts/solana-room-test.cjs)\n");
  const FORBIDDEN_ALL = [
    { name: "yield", re: /\byield\b/i },
    { name: "APR", re: /\bapr\b/i },
    { name: "APY", re: /\bapy\b/i },
    { name: "guaranteed", re: /\bguaranteed\b/i },
    { name: "Normie Quest", re: /normie\s*quest/i },
    { name: "Wallet Watch", re: /wallet\s*watch/i },
    { name: "Nomadz", re: /nomadz/i },
    { name: "Solana Foundation", re: /solana\s*foundation/i },
  ];
  for (const { name, re } of FORBIDDEN_ALL) {
    const m = doc.match(re);
    ok(`no "${name}"`, !m, m ? doc.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
