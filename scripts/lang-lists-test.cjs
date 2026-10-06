#!/usr/bin/env node
// Every language the picker offers must be in every server-side list that serves a learner in
// it. A new language is wired into many lists, not one (AGENTS.md), and the lists drift
// silently: Italian shipped in the picker on day one but was missing from AI_LANGS, so an
// Italian learner's Ask Cluck question went out with no reply-language instruction at all.
//
// Source-level, zero deps: reads public/i18n.js (the picker), server.js and lib/learn-pages.js.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const i18n = read("public/i18n.js");
const server = read("server.js");
const learnPages = read("lib/learn-pages.js");

let failed = 0;
const check = (ok, msg) => { if (ok) console.log("  ok  " + msg); else { failed++; console.log("  FAIL " + msg); } };

// The picker: { code: "xx", ... } entries inside the LANGS array.
const pickerBlock = i18n.slice(i18n.indexOf("var LANGS = ["), i18n.indexOf("];", i18n.indexOf("var LANGS = [")));
const picker = [...pickerBlock.matchAll(/code:\s*"([a-z]{2})"/g)].map((m) => m[1]);
check(picker.length >= 10, `picker offers ${picker.length} languages (${picker.join(", ")})`);
const translated = picker.filter((l) => l !== "en");

function objectKeys(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  let depth = 0, end = open;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}" && --depth === 0) break;
  }
  const body = src.slice(open + 1, end);
  // Top-level keys only: `xx:` at depth 0 of the body.
  const keys = [];
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "(" || c === "[") d++;
    else if (c === "}" || c === ")" || c === "]") d--;
    else if (d === 0) {
      const m = /^\s*([a-z]{2})\s*:/.exec(body.slice(i));
      if (m && (i === 0 || /[\s,{]/.test(body[i - 1]))) { keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}
function arrayValues(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return [...src.slice(open, close).matchAll(/"([a-z]{2})"/g)].map((m) => m[1]);
}
function covers(name, have, need) {
  if (!have) return check(false, `${name}: declaration not found`);
  const missing = need.filter((l) => !have.includes(l));
  check(missing.length === 0, `${name} covers every picker language` + (missing.length ? ` — missing ${missing.join(", ")}` : ""));
}

console.log("server.js");
covers("AI_LANGS (Ask Cluck / tutor reply language)", objectKeys(server, "const AI_LANGS = {"), picker);
covers("I18N_MT_LANGNAMES (machine-translation fallback)", objectKeys(server, "const I18N_MT_LANGNAMES = {"), translated);
covers("ttsLangCode (read-aloud voice)", arrayValues(server, "function ttsLangCode("), translated);
covers("LEARN_TR_LANGS (/learn asset pages)", arrayValues(server, "const LEARN_TR_LANGS = ["), translated);

console.log("lib/learn-pages.js");
covers("LANG_LABELS", objectKeys(learnPages, "const LANG_LABELS = {"), picker);
covers("LANG_FULL", objectKeys(learnPages, "const LANG_FULL = {"), picker);
covers("L (UI chrome dictionary)", objectKeys(learnPages, "const L = {"), picker);

console.log("data/learn-assets.<lang>.json");
const base = JSON.parse(read("data/learn-assets.json"));
const slugs = (Array.isArray(base) ? base : base.assets || []).map((a) => a.slug);
for (const l of translated) {
  const p = path.join(root, "data", `learn-assets.${l}.json`);
  if (!fs.existsSync(p)) { check(false, `${l}: data/learn-assets.${l}.json missing`); continue; }
  let arr;
  try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { check(false, `${l}: not valid JSON (${e.message})`); continue; }
  const have = new Set((Array.isArray(arr) ? arr : []).map((o) => o && o.slug));
  const gap = slugs.filter((s) => !have.has(s));
  check(gap.length === 0, `${l}: ${have.size} of ${slugs.length} assets` + (gap.length ? ` — missing ${gap.join(", ")}` : ""));
}

console.log(failed ? `\n${failed} FAILED` : "\nall language lists cover the picker");
process.exit(failed ? 1 : 0);
