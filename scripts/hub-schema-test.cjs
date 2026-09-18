#!/usr/bin/env node
"use strict";
// Project Hub — E4: the settlement library's public JSON Schemas (lib/hub/schema/*.json,
// lib/hub/README.md). Two halves:
//   1. pure — every schema validates a real fixture built the same way the library itself builds
//      one (lib/hub/project.js, lib/hub/ledger.js, lib/hub/public.js), including the exact wire
//      SUBSET routes.js puts on the wire for a program version (not the full canonical record);
//   2. live — boots the real server and asserts GET /hub/schema/:name.json serves each file
//      byte-identical to disk, with a cache header and a 404 for an unknown name, and that a real
//      public route (GET /api/hub/clkn) validates against project-public.schema.json end to end.
// The validator below is intentionally minimal — the subset of JSON Schema this repo's schemas
// actually use (type, required, properties, additionalProperties, enum, items, pattern) — rather
// than an npm dependency, per CLAUDE.md's model-tiering spirit ("lower models/less machinery for
// most things"): this is a CI assertion, not a general-purpose validator.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const proj = require("../lib/hub/project");
const L = require("../lib/hub/ledger");
const pub = require("../lib/hub/public");
const store = require("../lib/hub/store");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

console.log("\nProject Hub — settlement library JSON Schemas (E4)\n");

// ── the minimal validator ─────────────────────────────────────────────────────────────────────
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}
function typeOk(t, v) {
  if (t === "integer") return Number.isInteger(v);
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === t || (t === "number" && typeof v === "number");
}
function validate(schema, data, at = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, data))) { errors.push(`${at}: expected ${types.join("|")}, got ${typeOf(data)}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${at}: ${JSON.stringify(data)} not in ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof data === "string" && !new RegExp(schema.pattern).test(data)) errors.push(`${at}: "${data}" fails /${schema.pattern}/`);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const req of schema.required || []) if (!Object.prototype.hasOwnProperty.call(data, req)) errors.push(`${at}: missing required "${req}"`);
    if (schema.properties) {
      for (const [k, v] of Object.entries(data)) {
        if (Object.prototype.hasOwnProperty.call(schema.properties, k)) validate(schema.properties[k], v, `${at}.${k}`, errors);
        else if (schema.additionalProperties === false) errors.push(`${at}.${k}: additional property not allowed`);
      }
    }
  }
  if (Array.isArray(data) && schema.items) data.forEach((item, i) => validate(schema.items, item, `${at}[${i}]`, errors));
  return errors;
}
function validOk(name, schema, data) {
  const errors = validate(schema, data);
  ok(name, errors.length === 0, errors.join("\n      "));
}

// ── load the four schemas ────────────────────────────────────────────────────────────────────
const SCHEMA_DIR = path.join(__dirname, "..", "lib", "hub", "schema");
const NAMES = ["project-public", "program-version", "batch", "receipt"];
const schemas = {};
for (const n of NAMES) {
  const raw = fs.readFileSync(path.join(SCHEMA_DIR, `${n}.schema.json`), "utf8");
  const s = JSON.parse(raw);
  schemas[n] = s;
  ok(`${n}.schema.json parses and self-identifies at its served URL`, s.$id === `https://clucknorris.app/hub/schema/${n}.json`);
}

// ── fixtures, built the same way as scripts/hub-core-test.cjs ───────────────────────────────────
const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const NOW = 1_800_000_000;
const SIG = (n) => "5" + Array.from({ length: 87 }, (_, i) => "abcdefghjkmnpqrstuvwxyz"[(i * 7 + n) % 23]).join("");
const mkProject = (id, mint) => proj.validateProject({ id, label: id.toUpperCase(), symbol: id.toUpperCase().slice(0, 6), mint, fundingWallet: W.FUND, operatorWallets: [W.A] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
const days = (credits) => ({ "2026-09-17T00": { credits } });

console.log("\n1. project-public.schema.json — lib/hub/public.js projectView()\n");
{
  const stake = pub.stakeView({ days: days({ [W.A]: "1000000000" }), paid: {}, batches: {}, decimals: 9 });
  const v = pub.projectView({ project: { id: "rose", label: "OnlyRose", symbol: "ROSE", mint: W.MINT1, decimals: 9, rewardMint: W.MINT1, rewardDecimals: 9 }, comps: [], draws: [], stake });
  validOk("a project view with a lock-to-earn program validates", schemas["project-public"], v);
  const bare = pub.projectView({ project: { id: "clkn", label: "Cluck Norris", symbol: "CLKN", mint: W.MINT1, decimals: 9 } });
  validOk("a project view with zero programs still validates (empty programs[])", schemas["project-public"], bare);
}

console.log("\n2. program-version.schema.json — the wire SUBSET routes.js/apply.js put on the wire\n");
{
  const A = mkProject("alpha", W.MINT1);
  const s1 = proj.createVersion({}, A, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const v1 = s1.versions[0];
  // The admin/desk wire shape (routes.js): version, effectiveFrom, effectiveTo, hash, terms.
  const wire = { version: v1.version, effectiveFrom: v1.effectiveFrom, effectiveTo: v1.effectiveTo, hash: v1.hash, terms: v1.terms };
  validOk("the admin/desk version entry (effectiveTo: null) validates", schemas["program-version"], wire);
  // The self-serve preview shape (lib/hub/apply.js preview()) OMITS effectiveTo entirely — a
  // found inconsistency (lib/hub/README.md §4/§5) — the schema tolerates its absence on purpose.
  const previewWire = { version: v1.version, effectiveFrom: v1.effectiveFrom, hash: v1.hash, terms: v1.terms };
  validOk("the hub-apply preview shape (no effectiveTo key at all) also validates", schemas["program-version"], previewWire);
  // A superseded version: effectiveTo becomes a real day once v2 exists, still validates.
  const s2 = proj.createVersion(s1, A, { poolDailyRaw: "2000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-20", todayKey: "2026-09-18" });
  const closed = s2.versions[0];
  validOk("a superseded version (effectiveTo set) validates", schemas["program-version"], { version: closed.version, effectiveFrom: closed.effectiveFrom, effectiveTo: closed.effectiveTo, hash: closed.hash, terms: closed.terms });
  // A tampered field must not silently validate against a shape it does not have — the schema is
  // about SHAPE, not correctness, so this is a sanity check that additionalProperties:false bites.
  const badShape = { ...wire, extraField: "nope" };
  const errs = validate(schemas["program-version"], badShape);
  ok("additionalProperties:false rejects a field the entity does not have", errs.some((e) => /extraField/.test(e)));
}

console.log("\n3. batch.schema.json — lib/hub/ledger.js buildBatch()\n");
{
  const A = mkProject("alpha", W.MINT1);
  const s1 = proj.createVersion({}, A, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const V1 = s1.versions[0];
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "100" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: ["2026-09-17T00"], part, batchId: "b1", nowUnix: NOW });
  validOk("a freshly built, unsettled batch validates", schemas["batch"], batch);
  const j = L.settle({ journal: {}, projectId: "alpha", batch, wallet: W.A, transfer: { sig: SIG(1), instructionIndex: 0, amountRaw: "40", slot: 1 }, nowUnix: NOW }).journal;
  const closed = L.cancelBatch({ batch, journal: j });
  const waived = L.waiveRemainder({ batch: closed, journal: j, wallet: W.A, by: "owner", nowUnix: NOW, reason: "test" });
  validOk("a closed batch with a waived remainder validates (exercises `waived`)", schemas["batch"], waived);
  ok("the live /api/hub/:project/payout `created` body would NOT validate (documented gap)", (() => {
    const legacy = { id: "hb_x", state: "pending", at: NOW, amounts: { [W.A]: "100" }, skippedBelowFloor: {}, totalRaw: "100", count: 1 };
    return validate(schemas["batch"], legacy).length > 0;
  })());
}

console.log("\n4. receipt.schema.json — lib/hub/ledger.js receipt() (Addendum B3)\n");
{
  const A = mkProject("alpha", W.MINT1);
  const s1 = proj.createVersion({}, A, { poolDailyRaw: "1000", fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  const V1 = s1.versions[0];
  const part = L.partition({ projectId: "alpha", days: days({ [W.A]: "100" }), batches: {}, journal: {} });
  const batch = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: ["2026-09-17T00"], part, batchId: "b8", nowUnix: NOW });
  let j = {};
  for (const [n, amt] of [[8, "40"], [9, "40"], [10, "20"]]) j = L.settle({ journal: j, projectId: "alpha", batch, wallet: W.A, transfer: { sig: SIG(n), instructionIndex: 0, amountRaw: amt, slot: 100 + n }, nowUnix: NOW + n }).journal;
  const r = L.receipt({ projectId: "alpha", batch, wallet: W.A, journal: j, project: A });
  validOk("a fully-settled, three-entry (40+40+20) receipt validates", schemas["receipt"], r);
  const b2 = L.buildBatch({ projectId: "alpha", programVersion: V1, periods: [], part, batchId: "b9", nowUnix: NOW });
  const j2 = L.settle({ journal: {}, projectId: "alpha", batch: b2, wallet: W.A, transfer: { sig: SIG(11), instructionIndex: 0, amountRaw: "120", slot: 200 }, nowUnix: NOW }).journal;
  const over = L.receipt({ projectId: "alpha", batch: b2, wallet: W.A, journal: j2, project: A });
  validOk("an overpaid receipt (excess > 0) validates", schemas["receipt"], over);
  ok("the live /api/hub/:project/r/:sig body would NOT validate (documented gap — a different, older shape)", (() => {
    const legacy = { projectId: "rose", symbol: "ROSE", program: { kind: "buy-comp", id: "x", label: "x", ticker: "x", mint: W.MINT1, prizeMint: W.MINT1, termsHash: "a".repeat(64) }, receipt: { wallet: W.A, amountUi: 1, sig: SIG(1), at: NOW, state: "settled", confirmedAt: NOW } };
    return validate(schemas["receipt"], legacy).length > 0;
  })());
}

// ── live: the schema route + one real public body ────────────────────────────────────────────
console.log("\n5. GET /hub/schema/:name.json — served read-only, and one live public body\n");
const PORT = Number(process.env.HUB_SCHEMA_TEST_PORT || 3183);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-schema-test-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, ANTHROPIC_API_KEY: "test-not-a-key",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); done(); process.exit(1); }

  for (const n of NAMES) {
    const r = await fetch(`${BASE}/hub/schema/${n}.json`);
    let body = null; try { body = await r.json(); } catch (_) {}
    ok(`GET /hub/schema/${n}.json — 200, cached, byte-identical to disk`, r.status === 200 && /public/.test(r.headers.get("cache-control") || "") && JSON.stringify(body) === JSON.stringify(schemas[n]));
  }
  const miss = await fetch(`${BASE}/hub/schema/not-a-real-schema.json`);
  ok("GET /hub/schema/not-a-real-schema.json — 404 for an unknown name", miss.status === 404);
  // No directory listing is structural, not something to probe over HTTP: the route is an
  // explicit HUB_SCHEMA_NAMES allowlist (server.js), never express.static on the schema folder —
  // there is no path that enumerates lib/hub/schema/'s contents.
  const noExt = await fetch(`${BASE}/hub/schema/batch`);
  ok("GET /hub/schema/batch (missing .json) does not match the route", noExt.status !== 200 || !/\$id/.test(await noExt.text()));

  const hp = await fetch(`${BASE}/api/hub/clkn`);
  const hpBody = await hp.json();
  ok("GET /api/hub/clkn is 200 and carries $schema pointing at the served URL", hp.status === 200 && hpBody.ok === true && hpBody.project && hpBody.project.$schema === "https://clucknorris.app/hub/schema/project-public.json");
  validOk("…and the live body validates against project-public.schema.json", schemas["project-public"], hpBody.project);

  done();
  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
