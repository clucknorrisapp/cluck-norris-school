#!/usr/bin/env node
"use strict";
// Every user-visible string the Seeker app renders, extracted from the source.
//
// The app's t() (src/seeker/i18n.js) takes the ENGLISH TEXT as the key and looks it up in
// window.CLKN_I18N.dict, falling back to the literal on a miss. So "which strings need
// translating" is answerable exactly, from the code, and does not need a list anyone maintains
// by hand — which is the point: a hand-kept list is how a pane ships with half its copy in
// English and nothing notices.
//
// ⚠️ public/i18n/en.json DOES NOT EXIST AND MUST NOT BE CREATED. English is the key text; the six
// translated dictionaries (es/hi/it/pt/vi/zh) are the only files. Creating an en.json would make
// every key look translated and silently break the audit that checks the other six.
//
// Usage:
//   node scripts/seeker-i18n-keys.cjs            # print the keys, one JSON string per line
//   node scripts/seeker-i18n-keys.cjs --json     # print them as a JSON array
//   node scripts/seeker-i18n-keys.cjs --missing es   # only those absent from that dictionary
//   node scripts/seeker-i18n-keys.cjs --sync-exclude # fold them into store-edition.json excludeKeys
//
// ⚠️ WHY --sync-exclude EXISTS. The Google Play / iOS bundles are a PINNED, EDUCATION-ONLY
// edition (docs/STORE_EDITION.md): no wallet, no payments, no address. Their dictionaries are
// copied from the same six files the website uses, so every string this app adds — almost all of
// it wallet, signing and payment copy — would otherwise ride along into an education-only store
// build. store-edition.json's `excludeKeys` prunes them by EXACT key. That list was maintained by
// hand at 147 entries; this app has 644 strings, and a hand-kept list of 644 rots the first time
// someone adds a pane. It is generated from the source now. The sync only ever ADDS: an existing
// exclusion is never dropped, because some of them are older keys this extractor cannot see.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src", "seeker");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(fp);
  }
  return out;
}

// Literals passed straight to t(). A template literal or a variable cannot be a key — t() looks
// up the exact runtime string — so anything else is either interpolated copy, which the panes
// are written to avoid (pane.jsx's STRING RULE), or already a literal somewhere else.
// Matches t("…") and tf("…", {…}) alike — tf is the placeholder form (src/seeker/i18n.js), and a
// sentence with a value in it is still a string that needs translating. The `[,)]` tail is what
// lets tf's second argument through; an earlier `\)`-only version silently skipped every one.
const CALL = /\btf?\(\s*("(?:[^"\\]|\\.)*")\s*[,)]/g;

// ⚠️ EXCEPT THE TABLES. Some user-visible text is DATA, not a literal at a t() call site:
// registry.js holds every tool's title and blurb and ToolsHome.jsx renders them as t(tool.title)
// and t(tool.blurb), and passgate.jsx's TOOL_LINE holds one sentence per tool. A scan for
// t("...") cannot see any of it, so the first version of this extractor returned 644 keys and
// the app still rendered 30 strings of English in a Spanish locale — caught by the RENDERED half
// (seeker-app-boot-test section I), not by this file. Source scanning and rendered measurement
// have complementary blind spots and AGENTS.md says to run both; this is that lesson costing a
// round trip. A new table of display strings has to be added here too — which the rendered check
// will tell you about if you forget.
const TABLES = [
  { file: path.join(SRC, "tools", "registry.js"), re: /\b(?:title|blurb):\s*("(?:[^"\\]|\\.)*")/g },
  { file: path.join(SRC, "passgate.jsx"), re: /^\s{2}[a-z]+:\s*("(?:[^"\\]|\\.)*"),?$/gm },
];

function keys() {
  const out = new Set();
  for (const fp of walk(SRC, [])) {
    const src = fs.readFileSync(fp, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")      // block comments
      .replace(/^\s*\/\/.*$/gm, "");         // line comments
    let m;
    while ((m = CALL.exec(src))) {
      let v;
      try { v = JSON.parse(m[1]); } catch (_) { continue; }
      if (v && v.trim()) out.add(v);
    }
  }
  for (const { file, re } of TABLES) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
    let m;
    while ((m = re.exec(src))) {
      let v;
      try { v = JSON.parse(m[1]); } catch (_) { continue; }
      if (v && v.trim()) out.add(v);
    }
  }
  return [...out].sort();
}

module.exports = { keys };

if (require.main === module) {
  const all = keys();
  const i = process.argv.indexOf("--missing");
  if (i > 0 && process.argv[i + 1]) {
    const lang = process.argv[i + 1];
    const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${lang}.json`), "utf8"));
    const missing = all.filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    console.log(JSON.stringify(missing, null, 1));
    process.exit(0);
  }
  if (process.argv.includes("--sync-exclude")) {
    const fp = path.join(ROOT, "store-edition", "store-edition.json");
    const cfg = JSON.parse(fs.readFileSync(fp, "utf8"));
    const before = (cfg.excludeKeys || []).length;
    const merged = [...new Set([...(cfg.excludeKeys || []), ...all])].sort();
    cfg.excludeKeys = merged;
    fs.writeFileSync(fp, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`excludeKeys ${before} -> ${merged.length} (+${merged.length - before})`);
    process.exit(0);
  }
  if (process.argv.includes("--json")) { console.log(JSON.stringify(all, null, 1)); process.exit(0); }
  for (const k of all) console.log(JSON.stringify(k));
}
