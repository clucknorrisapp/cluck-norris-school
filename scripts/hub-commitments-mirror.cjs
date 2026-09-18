#!/usr/bin/env node
"use strict";
// scripts/hub-commitments-mirror.cjs — Addendum B5's repository mirror, step 2. OWNER-RUN, never
// invoked by the server: the server writes an observed commitment to its own kv
// (`versions[i].commitment`, lib/hub/routes.js commit/observe) and never touches this repository;
// this script is what keeps docs/hub/commitments.md in step with it, and only when someone runs
// it by hand (or a scheduled routine, if the owner sets one up later).
//
// Reads the live server over HTTP — the admin registry route to list every approved project
// (including a comped or not-yet-armed one), then this change's own public
// GET /api/hub/:project/program/:version for each version until a 404 — and appends any
// commitment not already in the file. Append-only: an existing row (matched by project+version)
// is never rewritten, so a hand-edited note beside a row survives a re-run.
//
// Usage:
//   HUB_ADMIN_KEY=... node scripts/hub-commitments-mirror.cjs [baseUrl]
// baseUrl defaults to https://clucknorris.app; HUB_ADMIN_KEY falls back to PREMIUM_ACCESS_KEY.

const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || process.env.HUB_BASE_URL || "https://clucknorris.app").replace(/\/$/, "");
const KEY = process.env.HUB_ADMIN_KEY || process.env.PREMIUM_ACCESS_KEY || "";
const OUT = path.join(__dirname, "..", "docs", "hub", "commitments.md");
const MAX_VERSIONS_PER_PROJECT = 200;   // generous ceiling — a real project will not outrun this for years

async function getJSON(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

async function listProjects() {
  if (!KEY) throw new Error("set HUB_ADMIN_KEY (or PREMIUM_ACCESS_KEY) — listing every approved project (including a comped or unlaunched one) needs the owner's admin key");
  const { status, body } = await getJSON(`${BASE}/api/hub-registry`, { "x-premium-key": KEY });
  if (status !== 200 || !body || !body.ok) throw new Error(`could not list projects: ${status} ${JSON.stringify(body)}`);
  return (body.projects || []).map((p) => p.id);
}

// Every version this server currently reports for a project, via the PUBLIC route (E3) — no key
// needed here, matching what a reader validating this mirror against the live site would see.
async function versionsFor(projectId) {
  const out = [];
  for (let v = 1; v <= MAX_VERSIONS_PER_PROJECT; v++) {
    const { status, body } = await getJSON(`${BASE}/api/hub/${projectId}/program/${v}`);
    if (status === 404) break;
    if (status === 200 && body && body.ok && body.version) out.push(body.version);
  }
  return out;
}

// Rows already on file, keyed by "project|version" — a re-run must never duplicate one.
function existingKeys(md) {
  const seen = new Set();
  for (const line of md.split("\n")) {
    const m = /^\|\s*([a-z0-9][a-z0-9-]{1,31})\s*\|\s*(\d+)\s*\|/.exec(line);
    if (m) seen.add(`${m[1]}|${m[2]}`);
  }
  return seen;
}

async function main() {
  const projects = await listProjects();
  const existingMd = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const seen = existingKeys(existingMd);
  const newRows = [];
  for (const id of projects) {
    let versions;
    try { versions = await versionsFor(id); }
    catch (e) { console.warn(`  ! ${id}: could not read versions — ${e.message}`); continue; }
    for (const v of versions) {
      if (!v.commitment || !v.commitment.sig) continue;               // not yet committed — nothing to mirror
      const key = `${id}|${v.version}`;
      if (seen.has(key)) continue;
      const observedIso = v.commitment.observedAt ? new Date(v.commitment.observedAt * 1000).toISOString().replace("T", " ").slice(0, 16) : "?";
      newRows.push(`| ${id} | ${v.version} | \`${v.hash}\` | \`${v.commitment.sig}\` | ${observedIso} |`);
      seen.add(key);
    }
  }
  if (!newRows.length) { console.log("no new commitments to mirror — nothing appended"); return; }
  let md = existingMd || "";
  // The seed file's placeholder row is replaced by the first real one, never left dangling above it.
  md = md.replace(/\|\s*_\(none yet\)_\s*\|[^\n]*\n?/, "");
  md = md.replace(/\n+$/, "") + "\n" + newRows.join("\n") + "\n";
  fs.writeFileSync(OUT, md);
  console.log(`appended ${newRows.length} row(s) to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
