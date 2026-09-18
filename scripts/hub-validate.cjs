#!/usr/bin/env node
"use strict";
// scripts/hub-validate.cjs — X2 (docs/HUB_VERIFY.md): fetch a public Hub JSON body and validate
// it against the JSON Schema it names, using the exact validator the CI test runs
// (lib/hub/schema-validate.js, extracted from scripts/hub-schema-test.cjs so there is one
// checker, not two that could drift). No wallet, no key, no network beyond the two GETs below.
//
// Usage:
//   node scripts/hub-validate.cjs <url>                 e.g. https://clucknorris.app/api/hub/cuna
//   node scripts/hub-validate.cjs --schema <name> <url>  force a schema name instead of reading
//                                                         the body's own $schema field
//   node scripts/hub-validate.cjs --offline <body.json> <schema.json>   validate two saved files,
//                                                         no network at all
//
// How the schema is found: every Hub route that carries a schema'd entity stamps a `$schema`
// field on it pointing at `https://clucknorris.app/hub/schema/<name>.json` (lib/hub/README.md
// §4) — this script reads THAT URL, exactly as served, rather than guessing a mapping from the
// route. A body with no `$schema` field (the thin `/api/hub` index, a wallet lookup, a
// standings/readiness body — none of those are schema'd, see lib/hub/README.md) is reported as
// such rather than treated as a validation failure.
//
// Exit codes: 0 valid, 2 invalid (lists every mismatch), 1 usage or a fetch that could not be
// completed, 3 the body carries no $schema and none was named with --schema.

const fs = require("fs");
const { validate } = require("../lib/hub/schema-validate");

function usage() {
  console.error([
    "usage: node scripts/hub-validate.cjs <url>",
    "       node scripts/hub-validate.cjs --schema <name> <url>",
    "       node scripts/hub-validate.cjs --offline <body.json> <schema.json>",
  ].join("\n"));
}

async function fetchJson(url) {
  const r = await fetch(url);
  let body = null;
  try { body = await r.json(); } catch (_) { /* leave null */ }
  return { ok: r.ok, status: r.status, body };
}

async function main() {
  const a = process.argv.slice(2);
  if (a[0] === "--offline") {
    if (a.length !== 3) { usage(); process.exit(1); }
    const body = JSON.parse(fs.readFileSync(a[1], "utf8"));
    const schema = JSON.parse(fs.readFileSync(a[2], "utf8"));
    return report(a[1], schema.$id || a[2], body, schema);
  }

  let schemaName = null, url = null;
  if (a[0] === "--schema") { schemaName = a[1]; url = a[2]; } else { url = a[0]; }
  if (!url) { usage(); process.exit(1); }

  const r = await fetchJson(url);
  if (!r.ok || r.body == null) { console.error(`could not fetch ${url} (status ${r.status})`); process.exit(1); }
  const body = r.body;
  // Where the schema'd entity is nested (GET /api/hub/:project returns {ok, project:{...,$schema}},
  // not the $schema at the top level) — check top level first, then the one nesting the live
  // routes actually use (lib/hub/README.md §4: project, receipt).
  const named = body.$schema || (body.project && body.project.$schema) || (body.receipt && body.receipt.$schema);
  const data = body.$schema ? body : (body.project && body.project.$schema ? body.project : (body.receipt && body.receipt.$schema ? body.receipt : body));
  const schemaUrl = schemaName ? new URL(url).origin.replace(/\/$/, "") + `/hub/schema/${schemaName}.json` : named;
  if (!schemaUrl) {
    console.log(`${url} carries no $schema field — this route's body is not schema'd yet (lib/hub/README.md §4/§5 names which ones are). Nothing to validate.`);
    process.exit(3);
  }
  const s = await fetchJson(schemaUrl);
  if (!s.ok || s.body == null) { console.error(`could not fetch the schema at ${schemaUrl} (status ${s.status})`); process.exit(1); }
  return report(url, schemaUrl, data, s.body);
}

function report(sourceLabel, schemaLabel, data, schema) {
  const errors = validate(schema, data);
  console.log(`source:  ${sourceLabel}`);
  console.log(`schema:  ${schemaLabel}`);
  if (!errors.length) { console.log("result:  VALID — the body matches every required field, type and enum in the schema."); process.exit(0); }
  console.log(`result:  INVALID — ${errors.length} mismatch${errors.length === 1 ? "" : "es"}:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(2);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
