"use strict";
// Unit gate for scripts/validation-rows.cjs (Colosseum roadmap EE5). Seeds a temp DATA_DIR with a
// two-project registry built through lib/hub/project.js (validateProject + approveProject +
// setMilestoneOnce — the same functions the real approval/onboarding paths call), then runs the
// actual script as a subprocess against that directory and asserts the printed deltas and the "—"
// dashes for whatever was never reached. Read-only: this test writes only to its own temp dirs.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const proj = require("../lib/hub/project");
const hubStore = require("../lib/hub/store");

const SCRIPT = path.join(__dirname, "validation-rows.cjs");
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT_A = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const MINT_B = "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF";
const MINT_INFO = { decimals: 9, tokenProgram: TOK, extensions: [] };

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);

function run(dataDir, extraArgs) {
  return execFileSync(process.execPath, [SCRIPT, "--data-dir", dataDir, ...(extraArgs || [])], { encoding: "utf8" });
}
// lib/kvstore.js logs a `[kvstore] loaded N keys...` line to stdout at require time (ahead of the
// script's own --json output) — expected, not a bug to work around in the script itself. Parse
// from the first `{` so that boot line never breaks JSON.parse here.
function runJson(dataDir, extraArgs) {
  const out = run(dataDir, [...(extraArgs || []), "--json"]);
  const i = out.indexOf("{");
  assert.ok(i >= 0, `expected a JSON object in output:\n${out}`);
  return JSON.parse(out.slice(i));
}
function writeRegistry(dataDir, registry) {
  fs.writeFileSync(path.join(dataDir, "app-state.json"), JSON.stringify({ [hubStore.REGISTRY_KEY]: registry }));
}

// ── the fixture: two projects, seeded via lib/hub/project.js ────────────────────────────────────
const NOW = Math.floor(Date.UTC(2026, 8, 1) / 1000); // 2026-09-01T00:00:00Z
const DAY = 86400;

// "full-project": every milestone in milestonesInit() reaches a value, on a plausible timeline —
// applied before approval, paid/terms/armed/batch-signed all after, each by a different amount so
// a delta mix-up (e.g. reading the wrong pair) would fail the assertions below.
function seedFull(registry) {
  const draft = proj.validateProject({ id: "full-project", label: "Full Project", symbol: "FULL", mint: MINT_A, fundingWallet: FUND }, MINT_INFO);
  let out = proj.approveProject(registry, draft, { nowUnix: NOW, appliedAt: NOW - 3600 });
  let ms = out["full-project"].milestones;
  ms = proj.setMilestoneOnce(ms, "firstPaidAt", NOW + 1800);
  ms = proj.setMilestoneOnce(ms, "firstVersionPublishedAt", NOW + 3600);
  ms = proj.setMilestoneOnce(ms, "firstArmedAt", NOW + 7200);
  ms = proj.setMilestoneOnce(ms, "firstBatchSignedAt", NOW + 2 * DAY);
  return { ...out, "full-project": { ...out["full-project"], milestones: ms } };
}

// "reg-only": approved (registered) and nothing else — no application, no terms, no arm, no batch.
// Also exercises dryRun:true, since that is the POKEAHOE shape this table exists to show.
function seedRegisteredOnly(registry) {
  const draft = proj.validateProject({ id: "reg-only", label: "Registered Only", symbol: "REGO", mint: MINT_B, dryRun: true }, MINT_INFO);
  return proj.approveProject(registry, draft, { nowUnix: NOW + 500 });
}

let registry = {};
registry = seedFull(registry);
registry = seedRegisteredOnly(registry);

let DIR;
t("setup: temp DATA_DIR with the two-project fixture", () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "validation-rows-"));
  writeRegistry(DIR, registry);
});

t("node --check passes on both files (sanity — the real gate runs this separately too)", () => {
  execFileSync(process.execPath, ["--check", SCRIPT]);
  execFileSync(process.execPath, ["--check", __filename]);
});

t("--json: full-project's registeredAt is approvedAt, not appliedAt or anything else", () => {
  const out = runJson(DIR);
  assert.strictEqual(out.hasRegistry, true);
  const row = out.rows.find((r) => r.id === "full-project");
  assert.ok(row, "full-project row present");
  assert.strictEqual(row.registeredAt, NOW);
  assert.strictEqual(row.dryRun, false);
});

t("--json: full-project's deltas are each measured FROM registered (approvedAt), never chained off each other", () => {
  const out = runJson(DIR);
  const row = out.rows.find((r) => r.id === "full-project");
  assert.strictEqual(row.firstVersionPublishedAt, NOW + 3600);
  assert.strictEqual(row.firstVersionDelta, 3600);
  assert.strictEqual(row.firstBatchSignedAt, NOW + 2 * DAY);
  assert.strictEqual(row.firstBatchDelta, 2 * DAY);
});

t("--json: 'first payout observed' is the SAME field as 'first batch signed' (documented, not a second real milestone)", () => {
  const out = runJson(DIR);
  const row = out.rows.find((r) => r.id === "full-project");
  assert.strictEqual(row.firstPayoutObservedAt, row.firstBatchSignedAt);
  assert.strictEqual(row.firstPayoutDelta, row.firstBatchDelta);
});

t("--json: reg-only has a registered date but every downstream milestone is null — never guessed", () => {
  const out = runJson(DIR);
  const row = out.rows.find((r) => r.id === "reg-only");
  assert.ok(row, "reg-only row present");
  assert.strictEqual(row.registeredAt, NOW + 500);
  assert.strictEqual(row.firstVersionPublishedAt, null);
  assert.strictEqual(row.firstVersionDelta, null);
  assert.strictEqual(row.firstBatchSignedAt, null);
  assert.strictEqual(row.firstBatchDelta, null);
  assert.strictEqual(row.firstPayoutObservedAt, null);
  assert.strictEqual(row.dryRun, true);
});

t("Markdown: reg-only's row shows the — dash for every unreached milestone (terms, batch, payout)", () => {
  const out = run(DIR);
  const line = out.split("\n").find((l) => l.includes("Registered Only"));
  assert.ok(line, `reg-only row missing from:\n${out}`);
  const dashCount = (line.match(/—/g) || []).length;
  assert.strictEqual(dashCount, 3, `expected 3 dashes (terms/batch/payout) in: ${line}`);
  assert.ok(line.trim().endsWith("| yes |"), `expected dry run 'yes' in: ${line}`);
});

t("Markdown: full-project's row has no dash and is marked dry run 'no'", () => {
  const out = run(DIR);
  const line = out.split("\n").find((l) => l.includes("Full Project"));
  assert.ok(line, `full-project row missing from:\n${out}`);
  assert.ok(!line.includes("—"), `expected no dash in: ${line}`);
  assert.ok(line.trim().endsWith("| no |"), `expected dry run 'no' in: ${line}`);
});

t("a DATA_DIR with no registry at all prints the empty template, not a guessed row", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-rows-empty-"));
  try {
    const out = run(emptyDir);
    assert.ok(/no `hub:projects` key found/.test(out), `expected the honest "no registry" note in:\n${out}`);
    const j = runJson(emptyDir);
    assert.strictEqual(j.hasRegistry, false);
    assert.deepStrictEqual(j.rows, []);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

t("teardown", () => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  ok - ${name}`); pass++; }
    catch (e) { console.error(`  FAIL - ${name}\n    ${(e && e.stack) || e}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
