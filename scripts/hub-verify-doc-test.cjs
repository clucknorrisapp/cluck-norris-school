#!/usr/bin/env node
"use strict";
// X2 (docs/HUB_VERIFY.md): a STATIC check that the doc cannot drift from the code — it never
// hits the network, it only asserts that every script, file and route the doc tells a judge to
// run actually exists in this repo, the same day the doc changes. A doc that describes a route
// that got renamed, or a script that got moved, fails CI instead of quietly misleading a judge.
//
// What it checks:
//   1. Every `scripts/<name>.cjs` mentioned anywhere in the doc exists on disk.
//   2. Every `lib/...` file mentioned (inline code or a markdown link) exists on disk.
//   3. Every relative markdown link `[text](path)` resolves to a real file.
//   4. Every URL path pulled out of a fenced ```bash block (the `$HOST/...` commands a judge
//      actually pastes) matches a route this repo's server.js registers — comparing by segment
//      count, where either side's segment being an Express `:param` (or the doc's own `<placeholder>`)
//      counts as a match. This is deliberately NOT a live boot: a registered route can still 404 for
//      other reasons (auth, a missing project) — this only pins "the path exists at all".
//
// Not a general Markdown-command runner: it does not execute anything the doc says to run.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "HUB_VERIFY.md");
const doc = fs.readFileSync(DOC_PATH, "utf8");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

console.log("\nHUB_VERIFY.md — the doc cannot drift from the code (X2)\n");

// ── 1. scripts/*.cjs mentioned anywhere ─────────────────────────────────────────────────────
console.log("1. scripts/*.cjs referenced in the doc\n");
const scriptRefs = [...new Set((doc.match(/scripts\/[a-zA-Z0-9_-]+\.cjs/g) || []))];
ok("at least one script is referenced", scriptRefs.length > 0);
for (const rel of scriptRefs) ok(rel + " exists", fs.existsSync(path.join(ROOT, rel)));

// ── 2. lib/... files mentioned (inline code, e.g. `lib/hub/project.js`) ─────────────────────
console.log("\n2. lib/*.js files referenced in the doc\n");
const libRefs = [...new Set((doc.match(/lib\/[a-zA-Z0-9_\/-]+\.js/g) || []))];
ok("at least one lib file is referenced", libRefs.length > 0);
for (const rel of libRefs) ok(rel + " exists", fs.existsSync(path.join(ROOT, rel)));

// ── 3. relative markdown links [text](path) resolve ─────────────────────────────────────────
console.log("\n3. relative markdown links resolve to real files\n");
const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
let m, linkCount = 0;
while ((m = linkRe.exec(doc))) {
  const target = m[1];
  if (/^https?:\/\//.test(target)) continue; // external — nothing to check statically
  linkCount++;
  const resolved = path.join(path.dirname(DOC_PATH), target);
  ok(target + " resolves", fs.existsSync(resolved), resolved);
}
ok("at least one relative link was checked", linkCount > 0);

// ── 4. routes pulled out of fenced bash blocks match a registered Express route ─────────────
console.log("\n4. $HOST paths in the doc's runnable commands match a real server.js route\n");
const bashBlocks = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((x) => x[1]);
ok("at least one bash block was found", bashBlocks.length > 0);
const docPaths = new Set();
for (const block of bashBlocks) {
  for (const hm of block.matchAll(/\$HOST([^"'\s]*)/g)) {
    const p = hm[1].split("?")[0]; // drop query string — routes are matched on path only
    if (p) docPaths.add(p);
  }
}
ok("at least one $HOST path was extracted", docPaths.size > 0);

const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
function serverRoutePaths() {
  const routes = [];
  for (const m of serverSrc.matchAll(/app\.(?:get|post|all|use)\(\s*"([^"]+)"/g)) routes.push(m[1]);
  for (const m of serverSrc.matchAll(/app\.(?:get|post|all)\(\s*\[([^\]]+)\]/g)) {
    for (const item of m[1].matchAll(/"([^"]+)"/g)) routes.push(item[1]);
  }
  return routes;
}
const routes = serverRoutePaths();
ok("server.js has routes registered at all", routes.length > 50);

function segMatch(docPath, routePath) {
  const d = docPath.split("/").filter(Boolean);
  const r = routePath.split("/").filter(Boolean);
  if (d.length !== r.length) return false;
  return d.every((seg, i) => {
    const rs = r[i];
    if (rs.startsWith(":")) return true;               // server route has a param here — any doc value matches
    if (/^<[^>]+>$/.test(seg)) return true;             // doc uses its own <placeholder> — matches a literal segment too
    return seg === rs;
  });
}
for (const dp of docPaths) {
  const hit = routes.some((rp) => segMatch(dp, rp));
  ok(dp + " matches a registered route", hit, hit ? "" : "no server.js route has the same segment shape");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
