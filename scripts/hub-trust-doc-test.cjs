#!/usr/bin/env node
"use strict";
// AA5 (docs/COLOSSEUM_ROADMAP.md §11): a STATIC check (no network, no server boot) that
// public/hub-trust.html — the trust-boundary page — cannot silently drift from
// docs/HUB_VERIFY.md §(g) ("What is honestly NOT verifiable yet"), that it never uses a word this
// project has promised never to use in its own copy, and that every internal link on the page
// actually resolves to a route server.js registers. Modelled on scripts/hub-verify-doc-test.cjs.
//
// What it checks:
//   1. Every `<!-- boundary: <id> -->` marker in docs/HUB_VERIFY.md §(g) has a matching
//      `data-boundary="<id>"` element on public/hub-trust.html, and vice versa — neither side can
//      gain or lose a boundary without the other being updated in the same change.
//   2. public/hub-trust.html's visible body text contains none of the forbidden words
//      (verified, safe, guaranteed, APR, APY, yield), matched whole-word and case-insensitively.
//      "Verify"/"verification" and "trust" are NOT forbidden — only the exact banned words.
//   3. Every relative link (href="/...") on the page matches a route server.js registers, by the
//      same segment-count comparison scripts/hub-og-test.cjs's sibling script (hub-verify-doc-
//      test.cjs) uses. An absolute http(s) link (GitHub, etc.) is not checked — nothing in this
//      repo can confirm an external URL stays live.
//
// Usage: node scripts/hub-trust-doc-test.cjs

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "HUB_VERIFY.md");
const PAGE_PATH = path.join(ROOT, "public", "hub-trust.html");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

console.log("\nhub-trust.html matches docs/HUB_VERIFY.md §(g) (AA5)\n");

ok("docs/HUB_VERIFY.md exists", fs.existsSync(DOC_PATH));
ok("public/hub-trust.html exists", fs.existsSync(PAGE_PATH));
if (!fs.existsSync(DOC_PATH) || !fs.existsSync(PAGE_PATH)) { console.log(`\n${failures} FAILED\n`); process.exit(1); }

const doc = fs.readFileSync(DOC_PATH, "utf8");
const page = fs.readFileSync(PAGE_PATH, "utf8");

// ── 0. §(g) actually exists and this test is reading the right section ─────────────────────────
const gIdx = doc.indexOf("## (g)");
ok("docs/HUB_VERIFY.md has a §(g) section", gIdx >= 0);
const gSection = gIdx >= 0 ? doc.slice(gIdx, doc.indexOf("\n---", gIdx) >= 0 ? doc.indexOf("\n---", gIdx) : doc.length) : "";

// ── 1. boundary markers match, both directions ──────────────────────────────────────────────────
console.log("\n1. boundary markers — doc §(g) <-> page data-boundary\n");
const docBoundaries = [...new Set([...gSection.matchAll(/<!--\s*boundary:\s*([a-z0-9-]+)\s*-->/g)].map((m) => m[1]))];
const pageBoundaries = [...new Set([...page.matchAll(/data-boundary="([a-z0-9-]+)"/g)].map((m) => m[1]))];
ok("§(g) has at least one boundary marker", docBoundaries.length > 0);
ok("hub-trust.html has at least one data-boundary marker", pageBoundaries.length > 0);
// §(g) has exactly four bullets as of this writing — pin the count so a fifth bullet added later
// without a marker (or a marker added without a bullet) is caught, not just a name mismatch.
const gBullets = (gSection.match(/^- \*\*/gm) || []).length;
ok(`§(g) bullet count matches boundary marker count (${gBullets} bullets, ${docBoundaries.length} markers)`, gBullets === docBoundaries.length,
  `${gBullets} bullets vs ${docBoundaries.length} markers — every §(g) bullet must carry its own <!-- boundary: ... --> comment`);
for (const id of docBoundaries) {
  ok(`doc boundary "${id}" has a matching data-boundary on the page`, pageBoundaries.includes(id));
}
for (const id of pageBoundaries) {
  ok(`page data-boundary "${id}" has a matching <!-- boundary: ... --> in doc §(g)`, docBoundaries.includes(id));
}

// ── 2. forbidden words — never on this page ─────────────────────────────────────────────────────
console.log("\n2. forbidden words never appear (verified / safe / guaranteed / APR / APY / yield)\n");
// Strip tags/scripts/comments so an attribute or a code sample can't hide a real hit, and so a
// literal word inside e.g. a URL path segment doesn't false-positive.
const bodyIdx = page.search(/<body[\s>]/i);
let bodyText = bodyIdx >= 0 ? page.slice(bodyIdx) : page;
bodyText = bodyText
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ");
const FORBIDDEN = ["verified", "safe", "guaranteed", "apr", "apy", "yield"];
for (const word of FORBIDDEN) {
  const re = new RegExp("\\b" + word + "\\b", "i");
  const m = bodyText.match(re);
  ok(`no whole-word "${word}"`, !m, m ? "found near: " + bodyText.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
}

// ── 3. every relative link on the page matches a registered server.js route ────────────────────
console.log("\n3. relative links on hub-trust.html match a registered server.js route\n");
const hrefs = [...new Set([...page.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]))];
ok("at least one link found on the page", hrefs.length > 0);
const relLinks = hrefs.filter((h) => h.startsWith("/") && !h.startsWith("//"));
ok("at least one relative link found", relLinks.length > 0);

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

function segMatch(linkPath, routePath) {
  const l = linkPath.split("/").filter(Boolean);
  const r = routePath.split("/").filter(Boolean);
  if (l.length !== r.length) return false;
  return l.every((seg, i) => {
    const rs = r[i];
    if (rs.startsWith(":")) return true; // server route has a param here — any link value matches
    return seg === rs;
  });
}
for (const link of relLinks) {
  const clean = link.split("#")[0].split("?")[0];
  if (!clean) continue;
  const hit = routes.some((rp) => segMatch(clean, rp));
  ok(clean + " matches a registered route", hit, hit ? "" : "no server.js route has the same segment shape");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
