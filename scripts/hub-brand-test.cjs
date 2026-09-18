#!/usr/bin/env node
"use strict";
// Project branding (lib/hub/brand.js) and the dryRun placeholder (Colosseum E10 — POKEAHOE, the
// second Lock to Earn project). Every case is a way branding could leak something we did not mean
// to serve, or a dry run could accrue/pay before its terms are real:
//   - brand validation rejects a remote logo URL, a non-hex colour, an off-list social host and an
//     over-long tagline, and accepts a valid block that round-trips through the public bodies;
//   - a dryRun project cannot be armed — the pure engine refuses it even if something upstream
//     forgets the route-level check — and runAll() skips it so the scheduler never scans it;
//   - dryRun projects are excluded from the traction counters (lib/traction.js).
const assert = require("assert");
const store = require("../lib/hub/store");
const proj = require("../lib/hub/project");
const brand = require("../lib/hub/brand");
const eng = require("../lib/hub/engine");
const pub = require("../lib/hub/public");
const routes = require("../lib/hub/routes");
const traction = require("../lib/traction");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const W = { FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", OP: "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ", MINT: "HRvw81mktEraX9gZLTHKeYGaFygCSNKuAwNLVE6Tpump" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DAY = 86400;
const NOW = Math.floor(Date.parse("2026-09-18T12:00:00Z") / 1000);
const mintInfo = { decimals: 6, tokenProgram: TOK, extensions: [] };

const goodBrand = { logo: "/brand/poke/logo.jpg", accent: "#F5A623", accent2: "#171923", tagline: "The second Lock to Earn project.", socials: { x: "https://x.com/pokeahoesol", telegram: "https://t.me/pokeahoecommunity", website: "https://pkhoe.com" } };

section("1. brand validation — rejects");

t("rejects a remote logo URL (never rendered, even from an https host)", () => {
  assert.throws(() => brand.validateBrand({ ...goodBrand, logo: "https://cdn.dexscreener.com/cms/images/x.png" }), /repo-local path/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, logo: "http://public/brand/poke/logo.jpg" }), /repo-local path/);
});

t("rejects a non-hex colour", () => {
  assert.throws(() => brand.validateBrand({ ...goodBrand, accent: "orange" }), /hex colour/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, accent: "#GGGGGG" }), /hex colour/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, accent2: "rgb(1,2,3)" }), /hex colour/);
  assert.strictEqual(brand.validateBrand({ ...goodBrand, accent2: "#abc" }).accent2, "#abc", "3-digit hex is accepted");
});

t("rejects an off-list social host", () => {
  assert.throws(() => brand.validateBrand({ ...goodBrand, socials: { x: "https://facebook.com/pokeahoe" } }), /socials\.x must be on/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, socials: { telegram: "https://telegram.me/pokeahoe" } }), /socials\.telegram must be on/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, socials: { website: "http://pkhoe.com" } }), /must be an https URL/, "website still must be https");
  assert.throws(() => brand.validateBrand({ ...goodBrand, socials: { discord: "https://discord.gg/x" } }), /not a recognised platform/);
});

t("rejects an over-long tagline", () => {
  assert.throws(() => brand.validateBrand({ ...goodBrand, tagline: "x".repeat(121) }), /120 characters or fewer/);
  assert.throws(() => brand.validateBrand({ ...goodBrand, tagline: "a <script>tag" }), /plain text/);
  assert.strictEqual(brand.validateBrand({ ...goodBrand, tagline: "x".repeat(120) }).tagline.length, 120, "exactly 120 is fine");
});

t("P3-09 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): a Unicode bidi override in a tagline is stripped, not just C0 controls", () => {
  const rlo = "‮"; // RIGHT-TO-LEFT OVERRIDE
  const cleaned = brand.validateBrand({ ...goodBrand, tagline: rlo + "evil visible text" }).tagline;
  assert.strictEqual(cleaned, "evil visible text");
  assert.ok(!cleaned.includes(rlo), "the override character must not survive");
});

t("a tagline that is ONLY bidi/format characters validates to no tagline (null-ish empty), not a hidden one", () => {
  const b = brand.validateBrand({ ...goodBrand, tagline: "​‮⁩﻿" });
  // goodBrand carries other fields too, so the whole block isn't null — just this one field.
  assert.strictEqual(b.tagline, null);
});

t("no brand at all validates to null, not an object of empty fields", () => {
  assert.strictEqual(brand.validateBrand(null), null);
  assert.strictEqual(brand.validateBrand({}), null);
  assert.strictEqual(brand.validateBrand(""), null);
});

section("2. a valid brand round-trips through the public bodies");

t("validateProject stores it; routes.publicProject and public.projectView both carry it, whitelisted", () => {
  const project = proj.validateProject({ id: "poke", label: "POKEAHOE", symbol: "POKE", mint: W.MINT, dryRun: true, brand: { ...goodBrand, evil: "<img onerror=x>", chatId: "-100999" } }, mintInfo);
  assert.deepStrictEqual(project.brand, goodBrand, "unrecognised keys on the input never reach the stored record");
  const pp = routes.publicProject({ ...project, status: "approved" });
  assert.deepStrictEqual(pp.brand, goodBrand);
  assert.strictEqual(pp.dryRun, true);
  const view = pub.projectView({ project: { ...project, decimals: 6, rewardMint: project.mint, rewardDecimals: 6 } });
  assert.deepStrictEqual(view.brand, goodBrand);
  assert.strictEqual(view.dryRun, true);
  // Whitelist discipline: an accidental extra key on the stored brand object must never reach the
  // public view either (project.js already strips it, but public.js re-shapes independently).
  const withExtra = { ...project, brand: { ...goodBrand, secretKey: "nope" } };
  const view2 = pub.projectView({ project: { ...withExtra, decimals: 6, rewardMint: project.mint, rewardDecimals: 6 } });
  assert.ok(!("secretKey" in view2.brand));
});

t("a project with no brand stores and reports brand: null", () => {
  const project = proj.validateProject({ id: "plain", label: "Plain", symbol: "PLN", mint: W.MINT, fundingWallet: W.FUND, operatorWallets: [W.OP] }, mintInfo);
  assert.strictEqual(project.brand, null);
  assert.strictEqual(project.dryRun, false);
  assert.strictEqual(routes.publicProject({ ...project, status: "approved" }).brand, null);
});

section("3. dryRun — no funding wallet required, and it can never be armed");

t("validateProject allows a dryRun project to omit fundingWallet; a non-dryRun project still requires one", () => {
  const p = proj.validateProject({ id: "poke", label: "POKEAHOE", symbol: "POKE", mint: W.MINT, dryRun: true }, mintInfo);
  assert.strictEqual(p.fundingWallet, null);
  assert.strictEqual(p.dryRun, true);
  assert.throws(() => proj.validateProject({ id: "real", label: "Real", symbol: "RL", mint: W.MINT }, mintInfo), /fundingWallet is not an address/);
});

t("eng.arm refuses a dryRun project even with a program version in force", () => {
  const p = proj.validateProject({ id: "poke", label: "POKEAHOE", symbol: "POKE", mint: W.MINT, dryRun: true, fundingWallet: W.FUND }, mintInfo);
  const state = proj.createVersion({}, p, { poolDailyRaw: "0", sharePct: 5, fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-18", todayKey: "2026-09-18" });
  assert.throws(() => eng.arm(state, NOW, { dryRun: true }), /DRY RUN/);
  // A real project with the same shape arms fine — the refusal is the flag, not something else.
  assert.ok(eng.arm(state, NOW, { dryRun: false }).armed);
  assert.ok(eng.arm(state, NOW).armed, "dryRun defaults to false — existing callers are unaffected");
});

t("runAll skips a dryRun project even if it somehow got armed, and never scans it", async () => {
  eng.resetCaches();
  const kv = store.memoryKv();
  const P = proj.validateProject({ id: "poke", label: "POKEAHOE", symbol: "POKE", mint: W.MINT, dryRun: true, fundingWallet: W.FUND }, mintInfo);
  const st0 = proj.createVersion({}, P, { poolDailyRaw: "0", sharePct: 5, fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" });
  store.writeRegistry(kv, { poke: P });
  // Bypass the route/engine guard on purpose (a raw kv write, as if something else armed it) to
  // prove runAll's OWN check is what protects the scheduler, not just the arm() gate upstream.
  store.write(kv, "poke", "state", { ...st0, armed: true, startedAt: NOW - DAY });
  let scanned = false;
  const out = await eng.runAll({ kv, nowUnix: NOW, deps: { scan: async () => { scanned = true; return []; }, creationTimes: async () => ({}) } });
  assert.strictEqual(out.poke, undefined, "dryRun projects never appear in runAll's output");
  assert.strictEqual(scanned, false, "the chain was never touched for a dryRun project");
  assert.deepStrictEqual(store.read(kv, "poke", "days", {}), {}, "nothing accrued");
});

section("4. traction — dryRun projects are excluded from every counter");

t("a dryRun project's program version, sent batch and access payment count nowhere", () => {
  const kv = store.memoryKv();
  const real = proj.validateProject({ id: "real", label: "Real", symbol: "RL", mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", fundingWallet: W.FUND, operatorWallets: [W.OP] }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  const dry = proj.validateProject({ id: "poke", label: "POKEAHOE", symbol: "POKE", mint: W.MINT, dryRun: true, fundingWallet: W.FUND }, mintInfo);
  store.writeRegistry(kv, {
    real: { ...proj.approveProject({}, real, { nowUnix: NOW }).real, access: { tier: "standard", paidThroughUnix: NOW + 30 * DAY, payments: [{ sig: "realsig" + "1".repeat(70), atUnix: NOW - DAY, kind: "sol", lamports: 500000000 }] } },
    poke: { ...proj.approveProject({}, dry, { nowUnix: NOW }).poke, access: { tier: "comped", paidThroughUnix: null, payments: [{ sig: "pokesig" + "1".repeat(70), atUnix: NOW - DAY, kind: "sol", lamports: 500000000 }] } },
  });
  const stReal = proj.createVersion({}, real, { poolDailyRaw: "0", sharePct: 5, fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-18", todayKey: "2026-09-18" });
  const stPoke = proj.createVersion({}, dry, { poolDailyRaw: "0", sharePct: 5, fundedBy: [W.FUND] }, { effectiveFrom: "2026-09-18", todayKey: "2026-09-18" });
  store.write(kv, "real", "state", stReal);
  store.write(kv, "poke", "state", stPoke);
  const SIG = "9" + "z".repeat(70);
  store.write(kv, "real", "batches", { b1: { id: "b1", amounts: { [W.OP]: "1" }, sent: { [W.OP]: { sig: SIG, at: NOW - 3600 } } } });
  store.write(kv, "poke", "batches", { b1: { id: "b1", amounts: { [W.OP]: "1" }, sent: { [W.OP]: { sig: "8" + "z".repeat(70), at: NOW - 3600 } } } });
  const out = traction.compute({ kv, from: "2026-09-11", to: "2026-09-19" });
  assert.strictEqual(out.counters.hubProgramsCreated.label, "independent");
  assert.strictEqual(out.counters.hubProgramsCreated.value, 1, "only the real project's version counts");
  assert.strictEqual(out.counters.hubProgramVersionsPublished.value, 1);
  assert.strictEqual(out.counters.hubReceiptsIssuedSent.value, 1, "only the real project's sent row counts");
  assert.strictEqual(out.counters.revenueHubAccessSolCount.value, 1, "only the real project's access payment counts");
});

(async () => {
  for (const [n, f] of queue) {
    if (!f) { console.log("\n" + n); continue; }
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e && e.stack || e)); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
