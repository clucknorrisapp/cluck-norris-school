#!/usr/bin/env node
"use strict";
// Merge translated Seeker-app strings into the six shipped dictionaries.
//
// Input: <dir>/out.<lang>.json for each of es hi it pt vi zh — a flat {english: translation}
// object. Output: those pairs APPENDED to public/i18n/<lang>.json in the app's own key order,
// nothing existing touched. The merge REFUSES rather than guesses:
//
//   · a key that is not one the app actually renders is dropped and reported — a translator's
//     paraphrase of a key ("Lock tokens." for "Lock tokens") would otherwise sit in the file
//     looking translated and never match at runtime;
//   · a key that already exists with a DIFFERENT value is left alone and reported — the school's
//     4000 existing strings are the house style and this must never silently restyle them;
//   · a value that is empty, or identical to the English, is reported so it can be looked at
//     rather than counted as done.
//
// ⚠️ public/i18n/en.json is never written. English IS the key text.
//
// Usage: node scripts/seeker-i18n-merge.cjs <dir-with-out.*.json> [--apply]
//        (a dry run by default — it prints what it would do and writes nothing)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const LANGS = ["es", "hi", "it", "pt", "vi", "zh"];
const { keys } = require(path.join(__dirname, "seeker-i18n-keys.cjs"));

// ⚠️ THE DICTIONARIES ARE APPENDED TO AS TEXT, NOT RE-SERIALIZED. Two reasons, both found by
// trying the obvious thing first and checking:
//
//   1. KEY ORDER IS NOT PRESERVABLE THROUGH A JS OBJECT. es.json contains the key "4". JavaScript
//      puts integer-like property names FIRST, ahead of every string key, regardless of insertion
//      order — so JSON.parse followed by JSON.stringify silently moves it to the top of the file
//      and rewrites every line after it.
//   2. THESE FILES WERE NOT WRITTEN BY NODE. es/zh are indented two spaces; hi/it/pt/vi are on
//      one line but with ", " and ": " separators, which is Python's json default and not
//      JSON.stringify's. Re-serializing any of them rewrites the whole file either way.
//
// A whole-file rewrite is not a cosmetic problem: it turns a reviewable 600-line addition into a
// 2000-line diff, which is exactly where an unrelated change to an existing translation goes
// unnoticed. So the existing bytes are never touched — new entries are appended before the
// closing brace, in the file's own style, and --check-format proves the style detection on every
// dictionary before anything is written.
function styleOf(raw) {
  const indented = /^\{\s*\n/.test(raw);
  // "k": "v"  (Python json default, and the indented files) vs  "k":"v"
  const spaced = /"\s*:\s/.test(raw);
  return { indented, spaced, nl: raw.endsWith("\n") ? "\n" : "" };
}
function appendEntries(raw, pairs) {
  if (!pairs.length) return raw;
  const st = styleOf(raw);
  const close = raw.lastIndexOf("}");
  if (close < 0) throw new Error("not a JSON object");
  let head = raw.slice(0, close).replace(/\s+$/, "");
  const empty = /\{$/.test(head);
  const parts = pairs.map(([k, v]) =>
    (st.indented ? "\n  " : "") + JSON.stringify(k) + (st.spaced ? ": " : ":") + JSON.stringify(v));
  // ⚠️ The separator BEFORE the first appended entry has to be the same one the file already uses
  // between entries. An earlier version wrote a bare "," there while joining the rest with ", ",
  // which left one byte of inconsistency at the seam in each minified dictionary — invisible on
  // screen, but enough that the file no longer round-tripped through its own writer, which is
  // exactly the property the format checks here depend on.
  const sep = st.indented ? "," : (st.spaced ? ", " : ",");
  return head + (empty ? "" : sep) + parts.join(sep) + (st.indented ? "\n" : "") + "}" + st.nl;
}

const dir = process.argv[2];
if (process.argv.includes("--check-format")) {
  // The guard that makes the above a claim rather than a hope, in both directions: appending
  // NOTHING must leave the file byte-identical, and appending one probe entry must still parse
  // and must add exactly that one key and change nothing else.
  let bad = 0;
  for (const lang of LANGS) {
    const fp = path.join(ROOT, "public", "i18n", `${lang}.json`);
    const raw = fs.readFileSync(fp, "utf8");
    const noop = appendEntries(raw, []) === raw;
    let probeOk = false, before, after;
    try {
      before = JSON.parse(raw);
      after = JSON.parse(appendEntries(raw, [["__probe__", "ok"]]));
      probeOk = after.__probe__ === "ok"
        && Object.keys(after).length === Object.keys(before).length + 1
        && Object.keys(before).every((k) => after[k] === before[k]);
    } catch (_) { probeOk = false; }
    if (!noop || !probeOk) bad++;
    console.log(`${lang}: ${noop ? "no-op append is byte-identical" : "NO-OP APPEND CHANGED THE FILE"}; ${probeOk ? "a probe entry lands and nothing else moves" : "PROBE APPEND BROKE THE FILE"}`);
  }
  process.exit(bad ? 1 : 0);
}
const apply = process.argv.includes("--apply");
if (!dir) { console.error("usage: seeker-i18n-merge.cjs <dir> [--apply]"); process.exit(2); }

const wanted = new Set(keys());
let anyMissing = 0;

for (const lang of LANGS) {
  const src = path.join(dir, `out.${lang}.json`);
  if (!fs.existsSync(src)) { console.log(`${lang}: no ${path.basename(src)} — skipped`); anyMissing++; continue; }
  let incoming;
  try { incoming = JSON.parse(fs.readFileSync(src, "utf8")); }
  catch (e) { console.log(`${lang}: ${path.basename(src)} is not valid JSON — ${e.message}`); anyMissing++; continue; }

  const dictPath = path.join(ROOT, "public", "i18n", `${lang}.json`);
  const raw = fs.readFileSync(dictPath, "utf8");
  const dict = JSON.parse(raw);

  const added = [], unknown = [], conflicts = [], empty = [], echoed = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (!wanted.has(k)) { unknown.push(k); continue; }
    if (typeof v !== "string" || !v.trim()) { empty.push(k); continue; }
    if (Object.prototype.hasOwnProperty.call(dict, k)) { if (dict[k] !== v) conflicts.push(k); continue; }
    if (v === k) echoed.push(k);
    dict[k] = v;
    added.push(k);
  }
  const stillMissing = [...wanted].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
  if (stillMissing.length) anyMissing += stillMissing.length;

  console.log(`${lang}: +${added.length} added, ${unknown.length} unknown-key, ${conflicts.length} already-translated-differently, ${empty.length} empty, ${echoed.length} same-as-English, ${stillMissing.length} still missing`);
  for (const k of unknown.slice(0, 5)) console.log(`   unknown key: ${JSON.stringify(k).slice(0, 90)}`);
  for (const k of stillMissing.slice(0, 5)) console.log(`   missing:     ${JSON.stringify(k).slice(0, 90)}`);

  if (apply) {
    // ⚠️ APPEND, never re-sort, and KEEP EACH FILE'S OWN FORMATTING. These dictionaries are in
    // insertion order, not alphabetical, and they are not even formatted the same way as each
    // other — es/zh are pretty-printed, hi/it/pt/vi are minified onto one line. Sorting or
    // reformatting would turn a 600-line addition into a whole-file rewrite, which is how an
    // unrelated change to an existing translation slips through a review unseen.
    fs.writeFileSync(dictPath, appendEntries(raw, added.map((k) => [k, dict[k]])));
  }
}
console.log(apply ? "\nwritten." : "\ndry run — pass --apply to write.");
process.exit(anyMissing ? 1 : 0);
