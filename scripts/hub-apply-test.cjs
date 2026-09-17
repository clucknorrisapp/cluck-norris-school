"use strict";
// Self-serve onboarding (Phase 3): an application grants nothing, is validated like approval,
// previews the version hash + teach block, and turns into a registry project with v1 on approve.
const assert = require("assert");
const A = require("../lib/hub/apply");
const access = require("../lib/hub/access");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B: "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF" };
const NOW = 1_800_000_000;
const MI = { decimals: 9, tokenProgram: TOK, extensions: [] };
const base = (over = {}) => ({ id: "alpha", label: "Alpha", symbol: "ALPHA", mint: W.MINT1, fundingWallet: W.FUND, operatorWallets: [W.A], contact: "@alpha_tg", tierRequested: "small",
  terms: { poolDailyRaw: "1000000000000", minDurationDays: 30, maxTermDays: 365, payoutSchedule: "monthly", vesting: "cliff-only", cancelableAllowed: "0" }, ...over });
let seq = 0; const id = () => "app_" + (++seq);

console.log("1. validate");
t("a valid application: project validated (draft), terms validated, tier requested, contact kept", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  assert.strictEqual(a.status, "pending"); assert.strictEqual(a.project.status, "draft");
  assert.strictEqual(a.terms.payoutSchedule, "monthly"); assert.strictEqual(a.terms.vesting, "cliff-only"); assert.strictEqual(a.terms.cancelableAllowed, false);
  assert.strictEqual(a.tierRequested, "small"); assert.strictEqual(a.contact, "@alpha_tg");
  assert.deepStrictEqual(a.terms.excludeWallets, [W.FUND]);
});
t("comped cannot be requested; a contact is required; unsupported Token-2022 mint refused", () => {
  assert.throws(() => A.validateApplication(base({ tierRequested: "comped" }), MI, { nowUnix: NOW, id }), /granted by the owner/);
  assert.throws(() => A.validateApplication(base({ contact: "" }), MI, { nowUnix: NOW, id }), /contact is required/);
  assert.throws(() => A.validateApplication(base(), { decimals: 9, tokenProgram: T22, extensions: ["transferFeeConfig"] }, { nowUnix: NOW, id }), /transferFeeConfig/);
});
t("a broken terms draft is refused at apply, not at approve", () => {
  assert.throws(() => A.validateApplication(base({ terms: { poolDailyRaw: "0", sharePct: 0 } }), MI, { nowUnix: NOW, id }), /must fund the pool|sharePct/);
  assert.throws(() => A.validateApplication(base({ terms: { poolDailyRaw: "1", minDurationDays: 100, maxTermDays: 30 } }), MI, { nowUnix: NOW, id }), /maxTermDays/);
});
t("the connected wallet must be an operator wallet", () => {
  assert.throws(() => A.validateApplication(base({ applicantWallet: W.B }), MI, { nowUnix: NOW, id }), /operator wallets/);
  assert.strictEqual(A.validateApplication(base({ applicantWallet: W.A }), MI, { nowUnix: NOW, id }).applicantWallet, W.A);
});

console.log("2. preview");
t("preview: v1 effective tomorrow with a hash, teach block present, no rate language", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const p = A.preview(a, { nowUnix: NOW });
  assert.strictEqual(p.version.version, 1); assert.strictEqual(p.version.effectiveFrom, A.tomorrowKey(NOW)); assert.match(p.version.hash, /^[0-9a-f]{64}$/);
  assert.ok(p.teach && p.teach.answers && p.teach.answers.length >= 4);
  const txt = JSON.stringify(p.teach).toLowerCase();
  assert.ok(!/\bapr\b|\bapy\b/.test(txt), "no APR/APY in the teach block");
});

console.log("3. the book");
t("one pending per mint and per id; cap enforced", () => {
  const a1 = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  let book = A.addToBook({}, a1);
  assert.throws(() => A.addToBook(book, A.validateApplication(base({ id: "beta" }), MI, { nowUnix: NOW, id })), /this mint is already waiting/);
  assert.throws(() => A.addToBook(book, A.validateApplication(base({ mint: W.MINT2 }), MI, { nowUnix: NOW, id })), /already waiting for approval/);
  const full = {}; for (let i = 0; i < A.MAX_PENDING; i++) full["x" + i] = { status: "pending", project: { mint: "m" + i }, projectId: "p" + i };
  assert.throws(() => A.addToBook(full, A.validateApplication(base({ id: "gamma", mint: W.MINT2 }), MI, { nowUnix: NOW, id })), /queue is full/);
});

console.log("4. approve / reject");
t("approve: registry project with the OWNER's tier + note, state v1 from the draft, book marked", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const book = A.addToBook({}, a);
  const r = A.approve(book, {}, a.id, { tier: "comped", note: "promo partner", nowUnix: NOW, freshMintInfo: MI });
  assert.strictEqual(r.project.status, "approved"); assert.strictEqual(r.project.access.tier, "comped"); assert.strictEqual(r.project.access.note, "promo partner");
  assert.strictEqual(r.state.versions.length, 1); assert.strictEqual(r.state.versions[0].effectiveFrom, A.tomorrowKey(NOW));
  assert.deepStrictEqual(r.state.versions[0].terms, a.terms);
  assert.strictEqual(r.book[a.id].status, "approved");
  assert.strictEqual(access.mayOperate(r.project.access, NOW), true);
});
t("approve without a tier keeps the requested one (unpaid, cannot arm until paid)", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const r = A.approve(A.addToBook({}, a), {}, a.id, { nowUnix: NOW, freshMintInfo: MI });
  assert.strictEqual(r.project.access.tier, "small"); assert.strictEqual(access.mayOperate(r.project.access, NOW), false);
});
t("approve refuses a mint already registered under another project; fresh mint info is re-checked", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const book = A.addToBook({}, a);
  const reg = { other: { id: "other", mint: W.MINT1, status: "approved" } };
  assert.throws(() => A.approve(book, reg, a.id, { nowUnix: NOW, freshMintInfo: MI }), /already registered/);
  assert.throws(() => A.approve(book, {}, a.id, { nowUnix: NOW, freshMintInfo: { decimals: 9, tokenProgram: T22, extensions: ["transferHook"] } }), /transferHook/);
});
t("reject marks it with a reason; a decided application cannot be decided twice", () => {
  const a = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const book = A.reject(A.addToBook({}, a), a.id, { reason: "not now", nowUnix: NOW });
  assert.strictEqual(book[a.id].status, "rejected"); assert.strictEqual(book[a.id].reason, "not now");
  assert.throws(() => A.approve(book, {}, a.id, { nowUnix: NOW, freshMintInfo: MI }), /is rejected/);
  assert.throws(() => A.reject({}, "nope", { nowUnix: NOW }), /no such application/);
});
t("listView is newest first and carries what the owner needs to decide", () => {
  const a1 = A.validateApplication(base(), MI, { nowUnix: NOW, id });
  const a2 = A.validateApplication(base({ id: "beta", mint: W.MINT2, contact: "beta@x.y" }), MI, { nowUnix: NOW + 10, id });
  const v = A.listView(A.addToBook(A.addToBook({}, a1), a2));
  assert.strictEqual(v[0].projectId, "beta"); assert.strictEqual(v[1].contact, "@alpha_tg"); assert.ok(v[0].terms && v[0].tierRequested);
});

console.log("reserved built-in programmes (deep dive 2026-09-17 P1-030)");
{
  const proj = require("../lib/hub/project");
  const CUNA = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", RESERVED = { cuna: CUNA, clkn: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS" };
  const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const mk = (id, mint) => proj.validateProject({ id, label: id, symbol: id.toUpperCase(), mint, fundingWallet: FUND, accessTier: "standard" }, { decimals: 9, tokenProgram: TOK, extensions: [] });
  t("approveProject refuses a second project on a built-in programme's mint", () => {
    assert.throws(() => proj.approveProject({}, mk("cunav2", CUNA), { nowUnix: 1, reserved: RESERVED }), /built-in "cuna" programme/);
  });
  t("approveProject refuses a built-in id under any mint", () => {
    assert.throws(() => proj.approveProject({}, mk("cuna", "So11111111111111111111111111111111111111112"), { nowUnix: 1, reserved: RESERVED }), /built-in programme id/);
  });
  t("…and still approves an unrelated mint; without a reserved table nothing changes", () => {
    const r = proj.approveProject({}, mk("fresh", "So11111111111111111111111111111111111111112"), { nowUnix: 1, reserved: RESERVED });
    assert.strictEqual(r.fresh.status, "approved");
    assert.strictEqual(proj.approveProject({}, mk("cunav2", CUNA), { nowUnix: 1 })["cunav2"].status, "approved", "legacy call shape unchanged");
  });
}

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
