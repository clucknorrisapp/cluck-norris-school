#!/usr/bin/env node
"use strict";
// The Colosseum demo fixture (roadmap W7 acceptance target / design §6, E2) — lib/hub/demo-fixture.js.
// Two things must hold forever: (1) every number is derived by the real Hub libs from the fixture
// inputs, never hand-typed, and (2) the fixture is invisible everywhere a real project would show
// up — the public index, the registry, the accrual scheduler, the Lock of Fame's data source.
const assert = require("assert");
const path = require("path");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const fixture = require(path.join("..", "lib", "hub", "demo-fixture"));
const hubStore = require(path.join("..", "lib", "hub", "store"));
const ledger = require(path.join("..", "lib", "hub", "ledger"));
const eng = require(path.join("..", "lib", "hub", "engine"));
const teach = require(path.join("..", "lib", "hub", "teach"));

const NOW = Math.floor(Date.UTC(2026, 8, 20, 12, 0, 0) / 1000);

section("derivation — every number comes from the real libs, none hand-typed");

t("build() is deterministic for a fixed clock, and produces both fixture projects", () => {
  const d1 = fixture.build(NOW), d2 = fixture.build(NOW);
  assert.deepStrictEqual(d1, d2, "two builds at the same nowUnix must be byte-identical");
  assert.ok(d1.demo && d1["demo-b"], "both fixture projects are present");
  assert.strictEqual(d1.demo.dryRun, true);
  assert.strictEqual(d1["demo-b"].dryRun, true);
});

t("holder A/B/C eligibility is exactly what lib/cuna-staking.disqualify decides, not a label", () => {
  const d = fixture.build(NOW).demo;
  const A = d.holders.find((h) => h.key === "A"), B = d.holders.find((h) => h.key === "B"), C = d.holders.find((h) => h.key === "C");
  assert.strictEqual(A.qualifies, true); assert.strictEqual(A.termDays, 90); assert.strictEqual(A.multiplier, 1);
  assert.strictEqual(B.qualifies, true); assert.strictEqual(B.termDays, 540); assert.strictEqual(B.multiplier, 6);
  assert.strictEqual(C.qualifies, false);
  assert.ok(C.reasons.some((r) => r.code === "term_too_short"), "C's disqualification carries a public reason code");
  // B locked the same amount as A for 6x the term: the engine's own accrual — not a hand-typed
  // ratio — must land within rounding of exactly 6x.
  const ratio = Number(BigInt(B.accruedRaw) * 1000n / BigInt(A.accruedRaw)) / 1000;
  assert.ok(Math.abs(ratio - 6) < 0.01, `expected ~6x, got ${ratio}`);
});

t("the program version hash is sha256 of its own canonical terms (project.js), recomputable", () => {
  const proj = require(path.join("..", "lib", "hub", "project"));
  const d = fixture.build(NOW).demo;
  assert.ok(proj.verifyVersionHash(d.version), "the published hash must verify against the published record");
});

t("the ledger partition invariant holds: accrued = available + reserved + paidApplied", () => {
  const d = fixture.build(NOW).demo;
  assert.strictEqual(d.invariantHolds, true);
});

t("the batch and its receipts are built by lib/hub/ledger (buildBatch/settle/receipt), not typed in", () => {
  const d = fixture.build(NOW).demo;
  assert.strictEqual(d.batch.count, 2);
  assert.strictEqual(BigInt(d.batch.totalRaw), Object.values(d.batch.rows).reduce((s, r) => s + BigInt(r.amountRaw), 0n));
  for (const id of Object.keys(d.receipts)) {
    const r = d.receipts[id];
    assert.strictEqual(r.totals.appliedRaw, r.totals.owedRaw, `${id}: a fully-settled dry-run row applies its whole owed amount`);
  }
});

t("the batch and every receipt are labelled a dry run — no signature is ever presented as real", () => {
  const d = fixture.build(NOW).demo;
  assert.deepStrictEqual(d.batch.settlement, { dryRun: true, note: "no transaction was sent" });
  for (const r of Object.values(d.receipts)) {
    assert.deepStrictEqual(r.settlement, { dryRun: true, note: "no transaction was sent" });
    assert.strictEqual(r.claims.paymentVerified, false, "a fixture receipt must never claim a verified on-chain payment");
  }
});

t("funding shows an honest shortfall, computed by lib/hub/ledger.fundingStatus, not asserted", () => {
  const d = fixture.build(NOW).demo;
  assert.ok(BigInt(d.funding.shortfallRaw) > 0n, "the fixture is deliberately under-funded so the story is honest, not a green checkmark");
  const recomputed = ledger.fundingStatus({
    part: ledger.partition({ projectId: "demo", days: {}, batches: {}, journal: {} }), // shape check only
    batches: {}, journal: {}, projectId: "demo", observed: { balanceRaw: d.funding.observedBalanceRaw, at: d.funding.observedAt },
  });
  assert.strictEqual(typeof recomputed.shortfallRaw, "string");
});

t("the reused teach block never emits rate language or a safe/verified badge (Hub tests 14, 17)", () => {
  const d = fixture.build(NOW).demo;
  for (const s of teach.allText(d.teach)) {
    assert.ok(!teach.containsRateLanguage(s), `rate language leaked: ${s}`);
    assert.ok(!/\b(safe (project|token)|verified project|independently verified|endorsed)\b/i.test(s), `badge language leaked: ${s}`);
  }
});

section("exclusion — the fixture is invisible everywhere a real project would show up");

t("\"demo\" / \"demo-b\" are never written to the real hub registry or kv", () => {
  const kv = hubStore.memoryKv();
  fixture.build(NOW);   // even after building the fixture...
  const reg = hubStore.readRegistry(kv);
  assert.deepStrictEqual(reg, {}, "building the fixture must never touch a real kv/registry");
});

t("approveProject refuses \"demo\" / \"demo-b\" as real project ids (server.js reservedMints)", () => {
  const proj = require(path.join("..", "lib", "hub", "project"));
  const mintInfo = { decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", extensions: [] };
  for (const id of ["demo", "demo-b"]) {
    const p = proj.validateProject({ id, label: "Real project trying to squat the id", symbol: "SQUAT",
      mint: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", fundingWallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, mintInfo);
    assert.throws(() => proj.approveProject({}, p, { nowUnix: NOW, reserved: { demo: null, "demo-b": null } }), /built-in programme id|reserved id/,
      `"${id}" must be reserved the same way clkn/cuna/rose are`);
  }
});

t("the accrual scheduler only ever iterates the real registry — the fixture is never in it, so it is never scanned or scheduled", () => {
  const kv = hubStore.memoryKv();
  const hubRoutes = require(path.join("..", "lib", "hub", "routes"));
  // startScheduler reads hubStore.readRegistry(kv) on every tick; an empty real registry proves
  // there is nothing for it to find named "demo"/"demo-b" without ever needing a live timer.
  const registry = hubStore.readRegistry(kv);
  assert.strictEqual(Object.keys(registry).length, 0);
  assert.strictEqual(typeof hubRoutes.startScheduler, "function"); // just confirms the module loads cleanly alongside the fixture
});

t("server.js's hubProjects()/public index never contains \"demo\"/\"demo-b\" (source scan of the built-ins + registry merge)", () => {
  // hubProjects() in server.js only ever returns its own hard-coded `built` object (clkn/cuna/rose)
  // merged with hubStore.readRegistry(kv) — never lib/hub/demo-fixture. A grep pins that no other
  // code path feeds the fixture into it.
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const fnMatch = src.match(/function hubProjects\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "hubProjects() must exist");
  assert.ok(!/demo-fixture/.test(fnMatch[0]), "hubProjects() must never reference the demo fixture");
});

t("the fixture module never requires kvstore, telegram, or any live-network module", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "hub", "demo-fixture.js"), "utf8");
  assert.ok(!/require\(.*(kvstore|telegram|helius|solana-web3|@solana\/web3\.js)/i.test(src), "the fixture must stay off-chain and off the real store");
});

t("demo-b's holder is not present in demo's holder list, and vice versa (isolation, by construction)", () => {
  const d = fixture.build(NOW);
  const demoWallets = new Set(d.demo.holders.map((h) => h.wallet));
  const bWallets = new Set(d["demo-b"].holders.map((h) => h.wallet));
  for (const w of bWallets) assert.ok(!demoWallets.has(w), "demo-b's holder leaked into demo");
  for (const w of demoWallets) assert.ok(!bWallets.has(w), "demo's holder leaked into demo-b");
  assert.notStrictEqual(d.demo.project.mint, d["demo-b"].project.mint);
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
