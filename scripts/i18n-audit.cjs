#!/usr/bin/env node
/**
 * i18n audit — catches missing keys, stale keys, untranslated copy, and placeholder
 * drift across all seven languages. Pure Node, no deps. Read-only: it never edits a
 * dictionary. See CLAUDE.md — the school ships in seven languages; this is the guard
 * for that promise.
 *
 * HOW THE THREE DICTIONARY FAMILIES ARE ACTUALLY LOADED AND KEYED (public/i18n.js)
 * ---------------------------------------------------------------------------------
 * There is no en.json anywhere in public/i18n/ — English is not a translated file, it
 * is the literal rendered page/component text, and THAT TEXT IS THE DICTIONARY KEY.
 * `public/i18n.js` walks the live DOM (a MutationObserver keeps re-walking it), takes
 * every visible text node / `placeholder` / `title` / `aria-label` / button value,
 * normalizes whitespace, and looks the normalized string up as a key:
 *   1. curated dict (public/i18n/<lang>.json, + <lang>.school.json, + <lang>.locker.json)
 *   2. machine-translation cache (`/api/i18n/translate`, Claude + localStorage cache)
 *   3. otherwise the raw English text stays on screen.
 * So a MISS AT RUNTIME IS NEVER A VISIBLE "[missing key]" OR A HARD FAILURE — it falls
 * through to on-demand machine translation (which costs a live API call the first time
 * any visitor sees that string in that language, and shows English for a beat while it
 * resolves) and only shows raw English forever if the string fails `translatable()`
 * (no Latin letter, a ticker, a URL, a base58 address, or pure numbers/symbols) or if
 * the translate endpoint is down. This is why editing English copy without touching the
 * dictionary is silent — nothing errors, the page just quietly stops using the curated
 * translation for that sentence in six languages (docs/HANDOFF_2026-08-02.md: the Locker
 * Room FAQ headers, 10 of 14, are exactly this — verified again below, 2026-09-08).
 *
 * The three families and when each loads (public/i18n.js:229-241):
 *   - base:   /i18n/<lang>.json         — loaded on EVERY page that runs cluck-nav.js
 *             (public/cluck-nav.js injects i18n.js sitewide, including index.html, so
 *             this covers the whole React school shell + every vanilla tool page).
 *   - school: /i18n/<lang>.school.json  — loaded only when the pathname starts with
 *             /school, /lp-lab, or /lplab (the React SPA renders Library/LPLab/etc.
 *             under those paths from the same bundle — App.jsx, shared.jsx,
 *             src/sections/*.jsx).
 *   - locker: /i18n/<lang>.locker.json  — loaded only under /locker-room
 *             (public/locker-room.html, a single vanilla page).
 * Seven languages are promised (en/es/hi/it/pt/vi/zh); en needs no file, so six
 * dictionary files exist per family.
 *
 * WHAT "MISSING VS EN" MEANS WITHOUT AN en.json
 * ----------------------------------------------
 * Two independent techniques, because they catch different failures:
 *   (A) CROSS-LANGUAGE KEY DIFF — deterministic, zero false positives. Since the key IS
 *       the English string, any key present in ANY language's file is a real, once-used
 *       English source string. REFERENCE(family) = union of keys across all 6 language
 *       files. missing(lang) = REFERENCE − keys(lang); extra/stale(lang) = keys unique
 *       to that one language (present in neither any other language's file nor the
 *       source scan below) — usually a leftover from deleted/edited copy.
 *   (B) SOURCE-CODE SCAN — heuristic, best-effort, regex-based (no HTML/JSX parser
 *       dependency allowed). Extracts candidate English strings straight out of
 *       public/*.html and src/*.jsx (recursively) the same way i18n.js finds them at runtime
 *       (inter-tag text, placeholder/title/aria-label attributes), then reports which
 *       of those strings have NO entry in ANY of the six language files for that
 *       family — the exact "used in code but never added to the dictionary" trap.
 *       This is the only technique that can catch a gap present in every language at
 *       once, which (A) structurally cannot see.
 *   Base and school intentionally rely on machine-translation for most of their surface
 *   (i18n.js's own header calls curated dicts "priority", not exhaustive) — hundreds of
 *   files/components were never meant to be hand-curated, so (B) is reported there as
 *   INFORMATIONAL ONLY (counts + samples, never gates). Locker is one small, deliberately-
 *   curated page ("a language mode is COMPLETE, not piecemeal" — i18n.js's own comment),
 *   so (B) gaps there are real product bugs and ARE included in the gating "missing" set.
 *
 * OTHER CHECKS
 * ------------
 *   (C) IDENTICAL-VALUE HEURISTIC — a translation whose value is byte-identical (after
 *       whitespace normalization) to its English key, where the key "looks like real
 *       interface text" (>=2 words, or >=12 chars, containing a letter), and is not on
 *       the explicit brand/ticker allowlist below. Warning by default (a lot of these
 *       are legitimate — short labels, mixed-language product names); `--strict` fails
 *       the run on any hit.
 *   (D) PLACEHOLDER MISMATCH — `{n}`, `{{name}}`, `%s`, `%d`, `$1`-style tokens present
 *       in the key but absent from the value, or vice versa. As of 2026-09-08 NONE of
 *       the eighteen dictionary files contain any such token (grep-verified) — these
 *       are flat phrase maps, not an interpolating i18n framework — so this check is
 *       future-proofing and will currently always report zero. It still gates like (A).
 *
 * USAGE
 *   node scripts/i18n-audit.cjs                 human report, exit 1 if (A) or (D) found
 *   node scripts/i18n-audit.cjs --strict         also fail on (C)
 *   node scripts/i18n-audit.cjs --json           machine-readable dump on stdout, same exit code
 *   node scripts/i18n-audit.cjs --warn-only      print everything, always exit 0 (CI wiring)
 *
 * LESSON COVERAGE BY ID (school family only)
 * -------------------------------------------
 * The cross-language key diff above (A) only catches a string missing from SOME language
 * while present in at least one other — it structurally cannot see a lesson added to
 * src/App.jsx's LESSONS array whose translatable strings never made it into ANY of the six
 * dictionaries (this happened for real: `seedphrase` and `inheritance` shipped with zero
 * entries in all six .school.json files). This check extracts the LESSONS array straight out
 * of src/App.jsx (same balanced-bracket-slice-and-eval technique as
 * scripts/extract-curriculum.js — it is pure data, no JSX/functions inside) and, for every
 * lesson's title/quote/intro/concept terms+defs/question q+options+explanations, confirms the
 * string exists as a key in EVERY language's school dictionary. A missing lesson fails the
 * audit (gating) and names the lesson id, the language, and the missing strings — so this
 * exact class of gap cannot recur silently.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'public', 'i18n');
const LANGS = ['es', 'hi', 'it', 'pt', 'vi', 'zh'];
const FAMILIES = [
  { name: 'base', suffix: '' },
  { name: 'school', suffix: '.school' },
  { name: 'locker', suffix: '.locker' },
];

const args = process.argv.slice(2);
const OPT = {
  strict: args.includes('--strict'),
  json: args.includes('--json'),
  warnOnly: args.includes('--warn-only'),
};

// ---------------------------------------------------------------------------
// shared string helpers (mirrors public/i18n.js's own normalize/translatable
// logic where it matters, so this audit's idea of "real text" matches runtime)
// ---------------------------------------------------------------------------
function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)));
}

// The app's own ticker/brand-word allowlist (public/i18n.js TICKER, verbatim) plus the
// handful of proper-noun brand phrases the task calls out. Deliberately does NOT include
// feature/product names (Buy Special, Autopsy, The Hatchery, ...) — whether those should
// ever be translated is a product call for the lead, not something this script should
// silently decide by omission.
const TICKER_WORDS = 'CLKN SOL USDC USDT JUP cbBTC BTC ETH SOLUSD NFT LP AMM DeFi MEV APR APY TVL IL DEX CEX SPL DAO USD'.split(' ');
const BRAND_WORDS = ['Cluck', 'Norris', 'Solana', 'Jupiter', 'Telegram', 'X'];
const WORD_ALLOWLIST = new Set([...TICKER_WORDS, ...BRAND_WORDS].map((w) => w.toUpperCase()));
const PHRASE_ALLOWLIST = new Set(['Cluck Norris', 'CLKN', 'Solana', 'Jupiter', 'Telegram', 'X'].map((w) => w.toLowerCase()));

function isUrlLike(s) { return /^https?:\/\//i.test(s) || /^www\./i.test(s); }
function isBase58AddressLike(s) { return /^[1-9A-HJ-NP-Za-km-z]{25,60}$/.test(s); }
function isNumericSymbolOnly(s) { return /^[\d.,%\s$+\-x/:#×•·()]+$/i.test(s); }
function hasLetter(s) { return /[A-Za-z]/.test(s); }

function looksLikeInterfaceText(key) {
  if (!key || !hasLetter(key)) return false;
  if (isUrlLike(key) || isBase58AddressLike(key) || isNumericSymbolOnly(key)) return false;
  const words = key.split(/\s+/).filter(Boolean);
  if (!(words.length >= 2 || key.length >= 12)) return false;
  return true;
}

// True when every alphabetic token in the string is a ticker/brand word (or too short
// to be a real word) — i.e. the string is noise for translation purposes even though it
// passed the length/word-count gate (e.g. "SOL / CLKN").
function isAllowlistNoise(key) {
  const tokens = key.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const realWords = tokens.filter((t) => t.length >= 3);
  if (realWords.length === 0) return true;
  return realWords.every((t) => WORD_ALLOWLIST.has(t.toUpperCase()));
}

function identicalCandidate(key, value) {
  if (norm(value) !== norm(key)) return false;
  if (PHRASE_ALLOWLIST.has(key.trim().toLowerCase())) return false;
  if (!looksLikeInterfaceText(key)) return false;
  if (isAllowlistNoise(key)) return false;
  return true;
}

// Deliberately excludes a `$1`/`$2`-style pattern: this content is full of literal dollar
// amounts ("$50 buy", "$1,000 simulated"), which would false-positive constantly against a
// sed/regex-backreference-shaped placeholder that these flat phrase-map dicts don't use anyway
// (verified 2026-09-08: zero `%s`/`%d`/`{n}`-style tokens exist in any of the 18 dict files).
const PLACEHOLDER_RE = /\{\{[^{}]+\}\}|\{[^{}]+\}|%[sd]/g;
function placeholders(s) {
  const m = (s || '').match(PLACEHOLDER_RE) || [];
  return new Set(m.map((x) => x.trim()));
}
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// A cheap "does this look like leaked JS/code, not prose" filter for the regex-based
// source scans below (they have no real HTML/JSX parser to lean on).
const CODE_SMELL_RE = /[(){};]|=>|&&|\|\||===|!==|\bfunction\b|\breturn\b/;

// ---------------------------------------------------------------------------
// source-code scanners (best-effort, regex based — see header for why)
// ---------------------------------------------------------------------------
function extractMarkupText(raw, { bodyOnly } = {}) {
  let s = raw;
  if (bodyOnly) {
    const i = s.search(/<body[\s>]/i);
    if (i >= 0) s = s.slice(i);
  }
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  const keys = new Set();
  const attrRe = /\b(?:placeholder|title|aria-label)=(["'])([\s\S]*?)\1/gi;
  let m;
  while ((m = attrRe.exec(s))) {
    const v = norm(decodeEntities(m[2]));
    if (v && !CODE_SMELL_RE.test(v)) keys.add(v);
  }
  const textRe = />([^<>{}]+)</g;
  while ((m = textRe.exec(s))) {
    const v = norm(decodeEntities(m[1]));
    if (v && hasLetter(v) && !CODE_SMELL_RE.test(v)) keys.add(v);
  }
  return keys;
}

function extractJsxText(raw) {
  const s = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return extractMarkupText(s, { bodyOnly: false });
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

function scanHtmlDir(dir) {
  const keys = new Set();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')); } catch (_) { /* ignore */ }
  for (const f of files) {
    const raw = safeRead(path.join(dir, f));
    if (raw == null) continue;
    for (const k of extractMarkupText(raw, { bodyOnly: true })) keys.add(k);
  }
  return { keys, files };
}

function scanJsxDir(dir) {
  const keys = new Set();
  let files = [];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? fs.readdirSync(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name]))
      .filter((f) => f.endsWith('.jsx'));
  } catch (_) { /* ignore */ }
  for (const f of files) {
    const raw = safeRead(path.join(dir, f));
    if (raw == null) continue;
    for (const k of extractJsxText(raw)) keys.add(k);
  }
  return { keys, files };
}

function isCandidateGap(key) { return looksLikeInterfaceText(key) && !isAllowlistNoise(key); }

// ---------------------------------------------------------------------------
// LESSON array extraction (src/App.jsx) — same technique as extract-curriculum.js:
// string-slice the balanced-bracket array literal, then eval it (pure data, no JSX/fns).
// ---------------------------------------------------------------------------
function extractArrayLiteral(src, name) {
  const decl = `const ${name} = [`;
  const start = src.indexOf(decl);
  if (start < 0) return { error: `"${decl}" not found in src/App.jsx` };
  let i = start + decl.length - 1; // at the '['
  let depth = 0, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const slice = src.slice(start + decl.length - 1, i);
  try {
    // eslint-disable-next-line no-eval
    return eval('(' + slice + ')');
  } catch (e) {
    return { error: `eval of ${name} failed: ${e.message}` };
  }
}

// Every translatable string a lesson contributes to the school dictionaries: title, quote,
// intro, each concept's term+def, each question's q+options+explanation. Mirrors exactly what
// LESSONS objects carry in src/App.jsx (see the id: "seedphrase"/"inheritance" lessons for the
// shape this was built to catch). Filtered through the same isCandidateGap test the rest of
// this script uses to decide what counts as "translatable" — a bare ticker/acronym term
// ("AMM", "MEV", "APY") or a pure number/percent ("0.1%") is deliberately left identical to
// English everywhere in these dicts (see the identical-to-en heuristic's TICKER_WORDS
// allowlist above), so it would never belong in the gating "missing" set here either.
function lessonTranslatableStrings(lesson) {
  const strs = [];
  if (typeof lesson.title === 'string') strs.push(lesson.title);
  if (typeof lesson.quote === 'string') strs.push(lesson.quote);
  if (typeof lesson.intro === 'string') strs.push(lesson.intro);
  for (const c of lesson.concepts || []) {
    if (typeof c.term === 'string') strs.push(c.term);
    if (typeof c.def === 'string') strs.push(c.def);
  }
  for (const q of lesson.questions || []) {
    if (typeof q.q === 'string') strs.push(q.q);
    for (const o of q.options || []) if (typeof o === 'string') strs.push(o);
    if (typeof q.explanation === 'string') strs.push(q.explanation);
  }
  return strs.filter((s) => s.length > 0 && isCandidateGap(s));
}

// ---------------------------------------------------------------------------
// load dictionaries
// ---------------------------------------------------------------------------
function loadFamily(suffix) {
  const perLang = {};
  for (const lang of LANGS) {
    const file = path.join(I18N_DIR, `${lang}${suffix}.json`);
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      data = null; // file missing/unparseable — real problem, surfaced below
    }
    perLang[lang] = data;
  }
  return perLang;
}

// ---------------------------------------------------------------------------
// run the audit
// ---------------------------------------------------------------------------
const report = { generatedAt: new Date().toISOString(), options: OPT, families: {} };
let hasGatingFindings = false;
let hasWarnFindings = false;

for (const fam of FAMILIES) {
  const perLang = loadFamily(fam.suffix);
  const loadErrors = LANGS.filter((l) => perLang[l] === null);

  const keySets = {};
  for (const l of LANGS) keySets[l] = new Set(perLang[l] ? Object.keys(perLang[l]) : []);
  const REFERENCE = new Set();
  for (const l of LANGS) for (const k of keySets[l]) REFERENCE.add(k);

  const famReport = { loadErrors, langs: {}, sourceScan: null };

  for (const lang of LANGS) {
    if (perLang[lang] === null) continue;
    const dict = perLang[lang];
    const own = keySets[lang];

    const missing = [...REFERENCE].filter((k) => !own.has(k)).sort();

    const othersUnion = new Set();
    for (const l2 of LANGS) if (l2 !== lang) for (const k of keySets[l2]) othersUnion.add(k);
    const extra = [...own].filter((k) => !othersUnion.has(k)).sort();

    const identical = [];
    for (const [k, v] of Object.entries(dict)) {
      if (identicalCandidate(k, v)) identical.push({ key: k, value: v });
    }

    const placeholderMismatch = [];
    for (const [k, v] of Object.entries(dict)) {
      const pk = placeholders(k), pv = placeholders(v);
      if (pk.size === 0 && pv.size === 0) continue;
      if (!setsEqual(pk, pv)) placeholderMismatch.push({ key: k, value: v, keyPlaceholders: [...pk], valuePlaceholders: [...pv] });
    }

    if (missing.length || placeholderMismatch.length) hasGatingFindings = true;
    if (extra.length || identical.length) {
      hasWarnFindings = true;
      if (OPT.strict && identical.length) hasGatingFindings = true;
    }

    famReport.langs[lang] = {
      keyCount: own.size,
      missing: { count: missing.length, examples: missing.slice(0, 30) },
      extra: { count: extra.length, examples: extra.slice(0, 30) },
      identical: { count: identical.length, examples: identical.slice(0, 30) },
      placeholderMismatch: { count: placeholderMismatch.length, examples: placeholderMismatch.slice(0, 30) },
    };
  }

  // source-code scan (see header: gating for locker, informational for base/school)
  let scanResult;
  if (fam.name === 'locker') {
    const raw = safeRead(path.join(ROOT, 'public', 'locker-room.html'));
    const sourceKeys = raw ? [...extractMarkupText(raw, { bodyOnly: true })].filter(isCandidateGap) : [];
    const usedNotInAnyDict = sourceKeys.filter((k) => !REFERENCE.has(k)).sort();
    scanResult = { files: ['public/locker-room.html'], candidateCount: sourceKeys.length, usedNotInAnyDict, gating: true };
    if (usedNotInAnyDict.length) hasGatingFindings = true;
  } else if (fam.name === 'school') {
    const { keys: sourceKeys, files } = scanJsxDir(path.join(ROOT, 'src'));
    const candidates = [...sourceKeys].filter(isCandidateGap);
    const usedNotInAnyDict = candidates.filter((k) => !REFERENCE.has(k)).sort();
    scanResult = { files: files.map((f) => path.join('src', f)), candidateCount: candidates.length, usedNotInAnyDict, gating: false };
    if (usedNotInAnyDict.length) hasWarnFindings = true;

    // lesson coverage by id — see header. Gating: a lesson missing from a language's school
    // dictionary is exactly the class of bug the cross-language diff above cannot see.
    const appJsxSrc = safeRead(path.join(ROOT, 'src', 'App.jsx'));
    const LESSONS = appJsxSrc ? extractArrayLiteral(appJsxSrc, 'LESSONS') : { error: 'could not read src/App.jsx' };
    let lessonCoverage;
    if (!Array.isArray(LESSONS)) {
      lessonCoverage = { error: LESSONS.error || 'could not extract LESSONS array from src/App.jsx' };
      hasGatingFindings = true;
    } else {
      const perLessonMissing = {}; // lessonId -> lang -> [missing strings]
      for (const lesson of LESSONS) {
        const id = String(lesson.id);
        const strings = lessonTranslatableStrings(lesson);
        for (const lang of LANGS) {
          if (perLang[lang] === null) continue; // load error already reported above
          const dict = perLang[lang];
          const missingStrings = strings.filter((s) => !(s in dict));
          if (missingStrings.length) {
            if (!perLessonMissing[id]) perLessonMissing[id] = {};
            perLessonMissing[id][lang] = missingStrings;
          }
        }
      }
      const failingLessons = Object.keys(perLessonMissing).sort();
      lessonCoverage = { lessonCount: LESSONS.length, failingLessons, details: perLessonMissing };
      if (failingLessons.length) hasGatingFindings = true;
    }
    famReport.lessonCoverage = lessonCoverage;
  } else {
    const { keys: htmlKeys, files: htmlFiles } = scanHtmlDir(path.join(ROOT, 'public'));
    const { keys: jsxKeys, files: jsxFiles } = scanJsxDir(path.join(ROOT, 'src'));
    const allKeys = new Set([...htmlKeys, ...jsxKeys]);
    const candidates = [...allKeys].filter(isCandidateGap);
    const usedNotInAnyDict = candidates.filter((k) => !REFERENCE.has(k)).sort();
    scanResult = {
      files: [...htmlFiles.map((f) => path.join('public', f)), ...jsxFiles.map((f) => path.join('src', f))],
      candidateCount: candidates.length,
      usedNotInAnyDict,
      gating: false,
    };
    if (usedNotInAnyDict.length) hasWarnFindings = true;

    // Hub Colosseum E8 (docs/COLOSSEUM_ROADMAP.md §7): unlike the rest of `base` (informational —
    // most of the site leans on machine translation, per i18n.js's own comment), the five Project
    // Hub pages are held to the same GATING bar as locker-room.html — a static/template string
    // used on one of them with no entry in ANY of the six base dictionaries fails the audit,
    // naming the exact key and every language it is missing from. Scoped to just these five files
    // (not all of `public/`) so this doesn't drag the hundreds of un-curated tool pages into
    // gating — that would make CI red for pages nobody has curated on purpose.
    const HUB_FILES = ['hub.html', 'hub-demo.html', 'hub-apply.html', 'hub-pay.html', 'for-projects.html'];
    const hubKeys = new Set();
    const hubFilesRead = [];
    for (const f of HUB_FILES) {
      const raw = safeRead(path.join(ROOT, 'public', f));
      if (raw == null) continue;
      hubFilesRead.push(path.join('public', f));
      for (const k of extractMarkupText(raw, { bodyOnly: true })) hubKeys.add(k);
    }
    const hubCandidates = [...hubKeys].filter(isCandidateGap);
    const hubUsedNotInAnyDict = hubCandidates.filter((k) => !REFERENCE.has(k)).sort();
    // Per-language view of the same gap: for a key that IS in some language's dict (added for one
    // language but missed for another) the cross-language diff above already gates it — this
    // block additionally names, for each Hub-sourced candidate, which specific languages lack it,
    // so "missing from ANY of the six" reads the same way the task asks for it.
    const hubMissingByLang = {};
    for (const lang of LANGS) {
      if (perLang[lang] === null) continue;
      const own = keySets[lang];
      const missingForLang = hubCandidates.filter((k) => !own.has(k));
      if (missingForLang.length) hubMissingByLang[lang] = missingForLang.sort();
    }
    famReport.hubCoverage = {
      files: hubFilesRead,
      candidateCount: hubCandidates.length,
      usedNotInAnyDict: hubUsedNotInAnyDict,
      missingByLang: hubMissingByLang,
      gating: true,
    };
    if (hubUsedNotInAnyDict.length) hasGatingFindings = true;
  }
  famReport.sourceScan = scanResult;

  report.families[fam.name] = famReport;
}

const exitCode = OPT.warnOnly ? 0 : (hasGatingFindings ? 1 : 0);
report.hasGatingFindings = hasGatingFindings;
report.hasWarnFindings = hasWarnFindings;
report.exitCode = exitCode;

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------
if (OPT.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('i18n audit — ' + report.generatedAt);
  console.log('languages: ' + LANGS.join(', ') + '  (en is the source text itself, no en.json)');
  console.log(OPT.warnOnly ? 'mode: WARN-ONLY (always exits 0)' : (OPT.strict ? 'mode: strict' : 'mode: default'));
  console.log('');
  for (const fam of FAMILIES) {
    const f = report.families[fam.name];
    console.log('=== family: ' + fam.name + ' ===');
    if (f.loadErrors.length) console.log('  ! could not load dict for: ' + f.loadErrors.join(', '));
    for (const lang of LANGS) {
      const L = f.langs[lang];
      if (!L) continue;
      console.log(`  ${lang}: ${L.keyCount} keys | missing ${L.missing.count} | extra/stale ${L.extra.count} | identical-to-en ${L.identical.count} | placeholder mismatch ${L.placeholderMismatch.count}`);
      if (L.missing.count) console.log('      missing (up to 10): ' + L.missing.examples.slice(0, 10).map((k) => JSON.stringify(k)).join(', '));
      if (L.placeholderMismatch.count) console.log('      placeholder mismatch (up to 5): ' + L.placeholderMismatch.examples.slice(0, 5).map((e) => JSON.stringify(e.key)).join(', '));
      if (OPT.strict && L.identical.count) console.log('      identical-to-en (up to 10): ' + L.identical.examples.slice(0, 10).map((e) => JSON.stringify(e.key)).join(', '));
    }
    const s = f.sourceScan;
    console.log(`  source-scan (${s.gating ? 'GATING' : 'informational'}): ${s.candidateCount} candidate strings across ${s.files.length} file(s); ${s.usedNotInAnyDict.length} used in code, in NO language's dictionary`);
    if (s.usedNotInAnyDict.length) console.log('      examples (up to 10): ' + s.usedNotInAnyDict.slice(0, 10).map((k) => JSON.stringify(k)).join(', '));
    if (f.lessonCoverage) {
      const lc = f.lessonCoverage;
      if (lc.error) {
        console.log(`  lesson coverage (GATING): could not check — ${lc.error}`);
      } else {
        console.log(`  lesson coverage (GATING): ${lc.lessonCount} lessons in LESSONS × ${LANGS.length} languages; ${lc.failingLessons.length} lesson(s) with a gap`);
        for (const id of lc.failingLessons) {
          for (const lang of LANGS) {
            const miss = lc.details[id][lang];
            if (!miss) continue;
            console.log(`      lesson "${id}" missing ${miss.length} string(s) in ${lang}: ` + miss.slice(0, 3).map((k) => JSON.stringify(k)).join(', ') + (miss.length > 3 ? ', …' : ''));
          }
        }
      }
    }
    if (f.hubCoverage) {
      const hc = f.hubCoverage;
      console.log(`  Hub pages coverage (GATING, ${hc.files.length} file(s)): ${hc.candidateCount} candidate strings; ${hc.usedNotInAnyDict.length} used on a Hub page, in NO language's dictionary`);
      if (hc.usedNotInAnyDict.length) console.log('      examples (up to 10): ' + hc.usedNotInAnyDict.slice(0, 10).map((k) => JSON.stringify(k)).join(', '));
      for (const lang of Object.keys(hc.missingByLang)) {
        const miss = hc.missingByLang[lang];
        console.log(`      missing from ${lang}.json (up to 5): ` + miss.slice(0, 5).map((k) => JSON.stringify(k)).join(', ') + (miss.length > 5 ? ', …' : ''));
      }
    }
    console.log('');
  }
  console.log(`gating findings (missing keys / placeholder mismatch / locker source-gap / school lesson-coverage / Hub page source-gap${OPT.strict ? ' / identical-to-en (strict)' : ''}): ${hasGatingFindings ? 'YES' : 'none'}`);
  console.log(`warning-only findings (extra/stale keys, identical-to-en, base/school source-scan): ${hasWarnFindings ? 'YES' : 'none'}`);
  console.log('exit code: ' + exitCode + (OPT.warnOnly ? ' (--warn-only forces 0)' : ''));
}

process.exit(exitCode);
