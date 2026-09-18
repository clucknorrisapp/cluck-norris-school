#!/usr/bin/env node
"use strict";
// Item 6 page-shadowing / Round 3 item 5 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): a project id that
// is ALSO a literal page or API segment registered ahead of the generic `/hub/:project` /
// `/api/hub/:project` patterns in server.js gets no public page — its receipts and program page
// 200 with whatever static route sits in front of it instead. lib/hub/project.js
// RESERVED_PROJECT_IDS is the one place that list lives; proj.approveProject refuses any of these
// ids outright regardless of caller.
//
// Two checks:
//   1. the exact union list the round-3 verifier curated across `origin/develop` and this branch
//      (apply/verify/status/wallet/trust/judge/schema/registry/hub/demo/demo-b/settle/badge) is
//      present in RESERVED_PROJECT_IDS — some of these (verify/status/trust/judge/badge) are not
//      literal routes on THIS branch yet, so a grep of this branch's server.js alone could never
//      find them; they are asserted directly instead.
//   2. a REGRESSION GUARD: every literal `/hub/<segment>` or `/api/hub/<segment>` registration
//      THIS branch's server.js actually has ahead of the generic `/hub/:project` /
//      `/api/hub/:project` catch-alls — the true collision shape (a project id resolves to
//      `/hub/<id>`, never `/hub-<id>`, so a hyphenated root like `/api/hub-registry` or
//      `/api/hub-apply` does not itself collide; it is reserved anyway, per the union list above,
//      because the corresponding PAGE route `/hub/apply` does) — must have its segment already in
//      the list, so a future PR that adds a new literal `/hub/<word>` page cannot silently
//      reopen this hole.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const proj = require("../lib/hub/project");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };

console.log("\nHub reserved project ids — page/API shadowing guard (Round 3 item 5)\n");

const REQUIRED = ["apply", "verify", "status", "wallet", "trust", "judge", "schema", "registry", "hub", "demo", "demo-b", "settle", "badge"];

t("proj.RESERVED_PROJECT_IDS contains the full union list curated across origin/develop and this branch", () => {
  const missing = REQUIRED.filter((id) => !proj.RESERVED_PROJECT_IDS.has(id));
  assert.deepStrictEqual(missing, [], `missing from RESERVED_PROJECT_IDS: ${missing.join(", ")}`);
});

t("approveProject refuses every id in the union list, not just 'settle'", () => {
  const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  for (const id of REQUIRED) {
    let threw = false;
    try {
      const p = proj.validateProject({ id, label: id.toUpperCase(), symbol: "X", mint: "So11111111111111111111111111111111111111112", fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", operatorWallets: [] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
      proj.approveProject({}, p, { nowUnix: 1 });
    } catch (e) { threw = /reserved/.test(e.message); }
    assert.ok(threw, `approveProject should refuse reserved id "${id}"`);
  }
});

t("REGRESSION GUARD: every literal /hub/<segment> or /api/hub/<segment> route in server.js (this branch) is in the reserved list", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const found = new Set();
  // One call per line in this codebase's style (server.js's route registrations are one-liners,
  // including the array-of-paths form) — matching each quoted string argument to app.get/app.all.
  const callRe = /app\.(?:get|all)\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = callRe.exec(src))) {
    const raw = m[1];
    const paths = raw.startsWith("[")
      ? (raw.match(/"[^"]*"|'[^']*'/g) || []).map((s) => s.slice(1, -1))
      : [raw.slice(1, -1)];
    for (const p of paths) {
      let mm;
      if ((mm = /^\/hub\/([A-Za-z0-9][A-Za-z0-9-]*)/.exec(p))) found.add(mm[1]);
      else if ((mm = /^\/api\/hub\/([A-Za-z0-9][A-Za-z0-9-]*)/.exec(p))) found.add(mm[1]);
    }
  }
  assert.ok(found.size > 0, "the scan found no literal /hub/<x> or /api/hub/<x> routes at all — the grep pattern likely broke");
  const uncovered = [...found].filter((id) => !proj.RESERVED_PROJECT_IDS.has(id));
  assert.deepStrictEqual(uncovered, [], `literal route segment(s) not in RESERVED_PROJECT_IDS: ${uncovered.join(", ")} — add them to lib/hub/project.js RESERVED_PROJECT_IDS`);
});

t("the hyphenated roots (/api/hub-registry, /api/hub-apply) are a DIFFERENT namespace from /api/hub/:project and never collide by path shape, but their ids are still reserved defensively", () => {
  // /api/hub-registry and /api/hub/registry are different Express routes — this documents why
  // 'registry'/'apply' are on the list even though grepping /api/hub-X finds no direct collision:
  // the collision is with the PAGE route /hub/apply (a static form), which IS slash-separated.
  assert.ok(proj.RESERVED_PROJECT_IDS.has("registry") && proj.RESERVED_PROJECT_IDS.has("apply"));
});

console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
process.exit(fail ? 1 : 0);
