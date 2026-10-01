#!/usr/bin/env node
"use strict";
// Project Hub — GG3 fix 1 (docs/COLOSSEUM_ROADMAP.md §17, docs/POKEAHOE_REHEARSAL_2026-09.md §4):
// POST /api/hub-registry read the outward concept "access tier" off the body as `tier=` only — a
// caller sending `accessTier=` (the rehearsal's first attempt) silently changed nothing and still
// got back `ok: true`. This pins both halves of the fix: `accessTier` now works as an alias for
// `tier`, and any field name this route does not read is refused with 400 and the accepted list,
// instead of being silently ignored.
//
// No HTTP, no network — the same in-process fake-Express harness scripts/hub-settle-route-test.cjs
// uses, so this exercises the REAL route closure in lib/hub/routes.js, not a re-implementation.
const assert = require("assert");
const store = require("../lib/hub/store");
const routes = require("../lib/hub/routes");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT1 = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const MINT2 = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";

// ── the same minimal fake-app / fake-res / call() shape as scripts/hub-settle-route-test.cjs ─────
function fakeApp() {
  const handlers = new Map();
  const register = (p, ...fns) => handlers.set(p, fns);
  return { get: register, all: register, handlers };
}
function fakeRes() {
  const r = { statusCode: 200 };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
async function call(app, path, { method = "GET", params = {}, query = {}, body = {}, headers = {} } = {}) {
  const fns = app.handlers.get(path);
  if (!fns) throw new Error(`no handler mounted for ${path}`);
  const req = { method, params, query, body, headers, cluckDirect: false };
  const res = fakeRes();
  for (const fn of fns) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) break;
  }
  return res;
}
function mountRegistry({ kv, adminAuthOK = () => true } = {}) {
  const app = fakeApp();
  routes.mount(app, {
    kv, adminAuthOK, publicErrMsg: (e) => (e && e.message) || String(e),
    connection: () => ({
      // /api/hub-registry's readMint reads this — a fixed valid mint account for any pubkey asked.
      getParsedAccountInfo: async () => ({ value: { owner: TOK, data: { parsed: { type: "mint", info: { decimals: 9, extensions: [] } } } } }),
    }),
    scanDeps: async () => ({ scan: async () => [] }),
    vault: null, getTx: null, alert: () => {}, nowUnix: () => 1_800_000_000, rateLimit: null, reservedMints: null,
  });
  return app;
}

section("1. accessTier — accepted as an alias for tier (the rehearsal's first attempt)");

t("POST ?accessTier=comped sets the SAME field a plain ?tier=comped would — never silently ignored", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "poke", label: "POKEAHOE", symbol: "POKE", mint: MINT1, fundingWallet: FUND, accessTier: "comped", accessNote: "hackathon rehearsal" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).poke.access.tier, "comped", "accessTier= must reach the same place tier= does");
});

t("an explicit tier= still wins if somehow both are sent (tier is the field this route has always read)", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "both", label: "Both", symbol: "BOTH", mint: MINT1, fundingWallet: FUND, tier: "small", accessTier: "comped" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).both.access.tier, "small");
});

section("2. an unrecognized field name is refused with 400, not silently absorbed");

t("a typo'd field alongside a valid id= is refused BEFORE anything is written — no ok:true, no silent no-op", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "typo1", label: "Typo", symbol: "TYPO", mint: MINT1, fundingWallet: FUND, acessTier: "comped" } });
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.strictEqual(r.body.ok, false);
  assert.ok(/unrecognized field/.test(r.body.error), r.body.error);
  assert.ok(r.body.error.includes("acessTier"), r.body.error);
  assert.deepStrictEqual(store.readRegistry(kv), {}, "nothing was registered — the whole request was refused, not partially applied");
});

t("the 400 body names every accepted field, including the accessTier alias, so a caller can self-correct", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST", query: { nonsense: "1" } });
  assert.strictEqual(r.statusCode, 400, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.acceptedFields) && r.body.acceptedFields.length > 5, JSON.stringify(r.body.acceptedFields));
  assert.ok(r.body.acceptedFields.includes("tier") && r.body.acceptedFields.includes("accessTier"), JSON.stringify(r.body.acceptedFields));
  assert.ok(!r.body.acceptedFields.includes("key"), "the deprecated ?key= auth fallback is accepted but not advertised as a body field");
});

t("a bare GET with no fields at all (the plain list) is unaffected — nothing to reject", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "GET", query: {} });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.projects, []);
});

section("3. the deprecated ?key= admin-auth fallback never trips the unknown-field refusal");

t("?key=... alongside real fields is accepted — key is read by adminAuthOK, not by this handler's body, but it must not 400", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST",
    query: { key: "whatever-the-bookmark-has", id: "keyed", label: "Keyed", symbol: "KEYD", mint: MINT2, fundingWallet: FUND } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(store.readRegistry(kv).keyed, "the project was registered — key= did not derail the request");
});

section("4. every field this route has always accepted still works exactly as before (no regression)");

t("applications=1 (a read) still lists, with no other fields required", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "GET", query: { applications: "1" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.applications, []);
});

t("suspend= alone still works, and reject= + reason= still works, with no unrelated field required", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const created = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "susp1", label: "Susp", symbol: "SUSP", mint: MINT1, fundingWallet: FUND } });
  assert.strictEqual(created.statusCode, 200, JSON.stringify(created.body));
  const suspended = await call(app, "/api/hub-registry", { method: "POST", query: { suspend: "susp1" } });
  assert.strictEqual(suspended.statusCode, 200, JSON.stringify(suspended.body));
  assert.strictEqual(store.readRegistry(kv).susp1.status, "suspended");
  const rejected = await call(app, "/api/hub-registry", { method: "POST", query: { reject: "no-such-app", reason: "not real" } });
  // A nonexistent application id fails inside apply.reject (a real "no such application" 400 from
  // the outer try/catch) — the point here is only that reject=/reason= themselves are ACCEPTED
  // field names, i.e. this never gets refused with the unrelated "unrecognized field" error.
  assert.ok(!/unrecognized field/.test(String(rejected.body && rejected.body.error)), JSON.stringify(rejected.body));
});

t("dryRun=, brand=, rewardMint=, payoutSources= and vaultProject= are all still accepted together", async () => {
  const kv = store.memoryKv();
  const app = mountRegistry({ kv });
  const r = await call(app, "/api/hub-registry", { method: "POST",
    query: { id: "many", label: "Many", symbol: "MANY", mint: MINT1, fundingWallet: FUND, dryRun: "1", payoutSources: FUND, vaultProject: "treasury" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(store.readRegistry(kv).many.dryRun, true);
  assert.strictEqual(store.readRegistry(kv).many.vaultProject, "treasury");
});

// ── (Y) the CI wiring itself: this file's own step exists in the always-run node-check job ───────
section("5. this test's own CI wiring");

t(".github/workflows/syntax-check.yml runs this file in the always-run node-check job", () => {
  const fs = require("fs");
  const path = require("path");
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "syntax-check.yml"), "utf8");
  assert.ok(yml.includes("node scripts/hub-registry-test.cjs"), "add a step running scripts/hub-registry-test.cjs to the node-check job");
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
