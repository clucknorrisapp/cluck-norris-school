#!/usr/bin/env node
/* i18n sweep — REQUIRED whenever a new language is added.
 * Ensures a language's curated dicts cover the FULL reference (Spanish) key set, so the
 * whole app renders in that language instead of leaning on the runtime MT fallback.
 *
 *   node scripts/i18n-sweep.js <lang>            # translate gaps + write dicts + report
 *   node scripts/i18n-sweep.js <lang> --check    # report coverage only (no writes/calls)
 *
 * Spanish (es.json + es.school.json) is the reference "complete" English key set — any
 * string es covers, the new language should too. Missing keys are translated via the live
 * MT endpoint (Claude, server-side key + durable cache); residual untranslated keys are
 * almost always brand/proper terms that legitimately stay as-is. Exit code 1 if gaps remain.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "public", "i18n");
const URL = process.env.I18N_URL || "https://clucknorris.app/api/i18n/translate";
const REF = "es";
const LANG = (process.argv[2] || "it").toLowerCase();
const CHECK_ONLY = process.argv.includes("--check");

function load(f) { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch (_) { return {}; } }
function translate(texts) {
  const body = JSON.stringify({ lang: LANG, texts });
  try {
    const out = execFileSync("curl", ["-s", "--max-time", "120", "-X", "POST", URL,
      "-H", "Content-Type: application/json", "-d", body], { maxBuffer: 64 * 1024 * 1024 }).toString();
    return JSON.parse(out).map || {};
  } catch (_) { return {}; }
}

function sweepFile(refFile, outFile) {
  const ref = load(refFile);
  const cur = load(outFile);
  const keys = Object.keys(ref).filter((k) => k.length <= 2500);
  let added = 0;
  if (!CHECK_ONLY) {
    for (let pass = 0; pass < 4; pass++) {
      const todo = keys.filter((k) => !cur[k]);
      if (!todo.length) break;
      console.log(`  [${outFile}] pass ${pass}: ${todo.length} missing`);
      for (let i = 0; i < todo.length; i += 20) {
        const batch = todo.slice(i, i + 20);
        const map = translate(batch);
        for (const k of batch) if (typeof map[k] === "string" && map[k]) { cur[k] = map[k]; added++; }
        try { execFileSync("sleep", ["0.7"]); } catch (_) {}
      }
    }
    fs.writeFileSync(path.join(DIR, outFile), JSON.stringify(cur));
  }
  const covered = keys.filter((k) => cur[k]).length;
  const missing = keys.filter((k) => !cur[k]);
  console.log(`  [${outFile}] ${covered}/${keys.length} (${Math.round((covered / keys.length) * 100)}%)${added ? ` +${added} this run` : ""}${missing.length ? ` — ${missing.length} gap(s)` : ""}`);
  if (missing.length && missing.length <= 12) console.log("    gaps:", missing.map((s) => JSON.stringify(s.slice(0, 40))).join(", "));
  return { covered, total: keys.length, missing: missing.length };
}

console.log(`i18n sweep: ${LANG} vs ${REF}${CHECK_ONLY ? " (check only)" : ""}`);
const a = sweepFile(`${REF}.json`, `${LANG}.json`);
const b = sweepFile(`${REF}.school.json`, `${LANG}.school.json`);
const cov = a.covered + b.covered, all = a.total + b.total, gaps = a.missing + b.missing;
console.log(`\nTOTAL ${LANG}: ${cov}/${all} (${Math.round((cov / all) * 100)}%), ${gaps} gap(s)`);
if (gaps) { console.log("Gaps remain — re-run to retry, or residual are untranslatable brand terms."); process.exit(1); }
console.log("FULL COVERAGE ✓");
