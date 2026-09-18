#!/usr/bin/env node
"use strict";
// AA4 (docs/COLOSSEUM_ROADMAP.md §11): a STATIC check (no network, no server boot) that
// public/hub-judge.html cannot silently drift from docs/JUDGE_GUIDE.md, that the doc never uses a
// word this project has promised never to use in its own copy, and that every scripts/*.cjs,
// docs/*.md and relative URL it names actually exists / resolves to a registered route.
// Modelled on scripts/hub-verify-doc-test.cjs and scripts/hub-trust-doc-test.cjs.
//
// What it checks:
//   1. Regenerating public/hub-judge.html from docs/JUDGE_GUIDE.md (via
//      scripts/build-judge-page.cjs's renderPage()) produces BYTE-IDENTICAL output to what is
//      committed — a hand-edit of the page, or an edit to the doc with no rebuild, fails here.
//   2. docs/JUDGE_GUIDE.md's visible text contains none of the forbidden words (verified, safe,
//      guaranteed, apr, apy, yield), matched whole-word and case-insensitively. "Verify" and
//      "trust" are NOT forbidden — only the exact banned words (same rule as hub-trust-doc-test).
//   3. It never mentions Normie Quest or Wallet Watch (CLAUDE.md: nothing about Normie Quest
//      prize terms in submission material; never mention Wallet Watch anywhere).
//   4. Every `scripts/<name>.cjs` the doc names exists on disk.
//   5. Every `docs/<NAME>.md` the doc names exists on disk.
//   6. Every relative URL (a markdown link target, or a bare `/...` path inside inline code)
//      matches a route server.js registers, by the same segment-count comparison
//      scripts/hub-verify-doc-test.cjs and scripts/hub-trust-doc-test.cjs use. An absolute
//      http(s) link is not checked — nothing here can confirm an external URL stays live.
//
// Usage: node scripts/hub-judge-doc-test.cjs

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOC_PATH = path.join(ROOT, "docs", "JUDGE_GUIDE.md");
const PAGE_PATH = path.join(ROOT, "public", "hub-judge.html");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

console.log("\nhub-judge.html matches docs/JUDGE_GUIDE.md (AA4)\n");

ok("docs/JUDGE_GUIDE.md exists", fs.existsSync(DOC_PATH));
ok("public/hub-judge.html exists", fs.existsSync(PAGE_PATH));
ok("scripts/build-judge-page.cjs exists", fs.existsSync(path.join(ROOT, "scripts", "build-judge-page.cjs")));
if (!fs.existsSync(DOC_PATH) || !fs.existsSync(PAGE_PATH)) { console.log(`\n${failures} FAILED\n`); process.exit(1); }

const doc = fs.readFileSync(DOC_PATH, "utf8");
const committedPage = fs.readFileSync(PAGE_PATH, "utf8");

// ── 1. drift: regenerate and compare byte-for-byte ──────────────────────────────────────────────
console.log("\n1. public/hub-judge.html is a fresh build of docs/JUDGE_GUIDE.md (no drift)\n");
let freshPage = null;
try {
  delete require.cache[require.resolve("./build-judge-page.cjs")];
  freshPage = require("./build-judge-page.cjs").renderPage();
  ok("scripts/build-judge-page.cjs renderPage() ran without throwing", true);
} catch (e) {
  ok("scripts/build-judge-page.cjs renderPage() ran without throwing", false, e.message);
}
if (freshPage !== null) {
  ok("committed page is byte-identical to a fresh regeneration", freshPage === committedPage,
    freshPage === committedPage ? "" : `lengths differ: committed=${committedPage.length} fresh=${freshPage.length} — run 'node scripts/build-judge-page.cjs' and commit the result`);
}

// ── 2. forbidden words — never in the doc ───────────────────────────────────────────────────────
console.log("\n2. forbidden words never appear (verified / safe / guaranteed / APR / APY / yield)\n");
const FORBIDDEN = ["verified", "safe", "guaranteed", "apr", "apy", "yield"];
for (const word of FORBIDDEN) {
  const re = new RegExp("\\b" + word + "\\b", "i");
  const m = doc.match(re);
  ok(`no whole-word "${word}"`, !m, m ? "found near: " + doc.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
}

// ── 3. never Normie Quest reward/prize terms, never Wallet Watch ────────────────────────────────
console.log("\n3. never mentions Normie Quest or Wallet Watch\n");
ok("no 'normie' anywhere", !/normie/i.test(doc));
ok("no 'wallet watch' anywhere", !/wallet\s*watch/i.test(doc));

// ── 4. scripts/*.cjs mentioned anywhere ─────────────────────────────────────────────────────────
console.log("\n4. scripts/*.cjs referenced in the doc\n");
const scriptRefs = [...new Set((doc.match(/scripts\/[a-zA-Z0-9_-]+\.cjs/g) || []))];
ok("at least one script is referenced", scriptRefs.length > 0);
for (const rel of scriptRefs) ok(rel + " exists", fs.existsSync(path.join(ROOT, rel)));

// ── 5. docs/*.md mentioned anywhere ─────────────────────────────────────────────────────────────
console.log("\n5. docs/*.md referenced in the doc\n");
const docRefs = [...new Set((doc.match(/docs\/[a-zA-Z0-9_-]+\.md/g) || []))];
ok("at least one doc is referenced", docRefs.length > 0);
for (const rel of docRefs) ok(rel + " exists", fs.existsSync(path.join(ROOT, rel)));

// ── 6. relative URLs in the doc match a registered server.js route ─────────────────────────────
console.log("\n6. relative URLs in docs/JUDGE_GUIDE.md match a registered server.js route\n");
// URLs appear two ways in this doc: as markdown links `[text](/path)` (none currently, but
// supported) and as bare inline-code paths `` `/hub/foo` `` — the actual authored style. Pull
// both, then keep only things that look like a site-relative path (starts with "/", not "//").
const linkTargets = [...doc.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
const inlinePaths = [...doc.matchAll(/`(\/[a-zA-Z0-9_\/:.\-]+)`/g)].map((m) => m[1]);
const allPaths = [...new Set([...linkTargets, ...inlinePaths])].filter((p) => p.startsWith("/") && !p.startsWith("//"));
ok("at least one relative URL was found", allPaths.length > 0);

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
    if (rs.startsWith(":")) return true; // server route has a param here — any doc value matches
    return seg === rs;
  });
}
for (const p of allPaths) {
  const clean = p.split("#")[0].split("?")[0];
  if (!clean) continue;
  const hit = routes.some((rp) => segMatch(clean, rp));
  ok(clean + " matches a registered route", hit, hit ? "" : "no server.js route has the same segment shape");
}

// ── 7. P2-07 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): renderInline's link scheme allowlist
console.log("\n7. renderInline() only turns a same-host/relative/anchor URL into a live <a> href\n");
{
  const buildJudge = require("./build-judge-page.cjs");
  const cases = [
    { md: "[go](javascript:alert(document.domain))", why: "javascript: scheme" },
    { md: "[go](data:text/html,<script>alert(1)</script>)", why: "data: scheme" },
    { md: "[go](//evil.example/x)", why: "protocol-relative — resolves to a DIFFERENT host" },
    { md: "[go](http://evil.example/x)", why: "http: to a different host" },
    { md: '[x](" onmouseover=alert(1) x=")', why: "attribute-breakout payload (also not a safe scheme)" },
  ];
  for (const c of cases) {
    const out = buildJudge.renderInline(c.md);
    ok(`${c.why}: no <a href> emitted`, !/<a\s+href=/i.test(out), out);
  }
  const safeCases = [
    { md: "[docs](https://github.com/clucknorrisapp/cluck-norris-school/blob/main/docs/HUB_VERIFY.md)", why: "https:" },
    { md: "[home](/hub)", why: "root-relative path" },
    { md: "[jump](#section)", why: "in-page anchor" },
    { md: "[us](http://clucknorris.app/hub)", why: "http: to our OWN host" },
  ];
  for (const c of safeCases) {
    const out = buildJudge.renderInline(c.md);
    ok(`${c.why}: DOES emit a live <a href>`, /<a\s+href=/i.test(out), out);
  }
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
