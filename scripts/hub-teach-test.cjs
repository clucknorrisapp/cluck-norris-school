"use strict";
// Project Hub — Addendum C acceptance tests 15, 16, 17 plus the C4 lesson-map guard.
const assert = require("assert");
const proj = require("../lib/hub/project");
const L = require("../lib/hub/ledger");
const T = require("../lib/hub/teach");
const curriculum = require("../lib/curriculum");

let pass = 0, fail = 0;
const queue = [];
const t = (n, f) => queue.push([n, f]);
const section = (n) => queue.push([n, null]);

const W = { A: "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", FUND: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", MINT1: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", MINT2: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF" };
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const NOW = 1_800_000_000, DAY = 86400;
const mkProject = (over = {}) => proj.validateProject({ id: "alpha", label: "Alpha", symbol: "ALPHA", mint: W.MINT1, fundingWallet: W.FUND, ...over }, { decimals: 9, tokenProgram: TOK, extensions: [] });
const version = (p, terms = {}) => proj.createVersion({}, p, { poolDailyRaw: "345000000000000", minDurationDays: 90, maxTermDays: 540, ...terms }, { effectiveFrom: "2026-09-17", todayKey: "2026-09-17" }).versions[0];
const funding = (observed) => L.fundingStatus({ part: { [W.A]: { obligationRaw: "100000000000", reservedRaw: "40000000000" } }, batches: {}, journal: {}, projectId: "alpha", observed });
const lock = { escrow: "Am6kGZnho6YyEv39pbx2a3Kp3EMywGGzHSPLVYcBawSv", recipient: W.A, totalRaw: "8800000000000000", cliffTime: NOW + 180 * DAY, frequency: DAY, periods: 1, firstSeenAt: NOW };

section("15. every answer is derived");

t("all six answers render from a program version alone (no wallet), each with a lesson and its derivation named", () => {
  const p = mkProject(); const v = version(p);
  const b = T.teachBlock({ project: p, version: v, funding: funding(null) });
  assert.strictEqual(b.answers.length, 6);
  assert.deepStrictEqual(b.answers.map((a) => a.key), ["what_happens", "can_i_sell", "where_reward", "how_much", "risks", "why_lock"]);
  for (const a of b.answers) {
    assert.ok(a.text.length > 40, a.key);
    assert.ok(a.lesson && a.lesson.id && a.lesson.href.startsWith("/school#lesson="), a.key);
    assert.ok(Array.isArray(a.derivedFrom), a.key);
  }
  assert.strictEqual(b.programHash, v.hash);
  assert.ok(b.answers.find((a) => a.key === "can_i_sell").alwaysVisible);
  assert.ok(b.answers.find((a) => a.key === "risks").alwaysVisible);
});

t("with a wallet's lock, the escrow, unlock date and firstSeenAt in the copy match the entities exactly", () => {
  const p = mkProject(); const v = version(p);
  const b = T.teachBlock({ project: p, version: v, funding: funding({ balanceRaw: "500000000000", at: NOW }), lock });
  const a = b.answers.find((x) => x.key === "what_happens");
  assert.strictEqual(a.params.escrow, lock.escrow);
  assert.strictEqual(a.params.unlockDate, new Date((NOW + 180 * DAY) * 1000).toISOString().slice(0, 10));
  assert.ok(a.text.includes("Am6k…awSv") && a.text.includes(a.params.unlockDate) && a.text.includes("8,800,000"));
  assert.strictEqual(T.lockEndUnix({ cliffTime: 100, frequency: 10, periods: 4 }), 130);
});

t("the funding answer says which of the three numbers it is showing, and matches the funding status exactly", () => {
  const p = mkProject(); const v = version(p);
  const unavailable = T.teachBlock({ project: p, version: v, funding: funding(null) }).answers.find((x) => x.key === "where_reward");
  assert.strictEqual(unavailable.params.showing, "balance unavailable"); assert.strictEqual(unavailable.params.observedBalanceRaw, null);
  assert.ok(unavailable.text.includes("could not be read"));
  const f = funding({ balanceRaw: "30000000000", at: NOW });
  const short = T.teachBlock({ project: p, version: v, funding: f }).answers.find((x) => x.key === "where_reward");
  assert.strictEqual(short.params.obligationsRaw, f.obligationsRaw); assert.strictEqual(short.params.shortfallRaw, f.shortfallRaw);
  assert.ok(short.text.includes("short of what is owed"));
  assert.ok(short.text.includes("the project controls, not us"));
});

t("no project-authored content can reach the block: it has no free-text input, and an extra field is ignored", () => {
  const p = mkProject(); const v = version(p);
  const b1 = T.teachBlock({ project: p, version: v, funding: funding(null) });
  const b2 = T.teachBlock({ project: { ...p, blurb: "SAFEST TOKEN EVER, 900% APR" }, version: { ...v, marketing: "guaranteed" }, funding: funding(null), operatorText: "buy now" });
  assert.deepStrictEqual(T.allText(b1), T.allText(b2));
});

t("the estimate is labelled an estimate, carries the honesty sentence, and is absent without a wallet", () => {
  const p = mkProject(); const v = version(p);
  const none = T.teachBlock({ project: p, version: v, funding: funding(null) }).answers.find((x) => x.key === "how_much");
  assert.strictEqual(none.params.estimate, false);
  const est = T.teachBlock({ project: p, version: v, funding: funding(null), lock, estimate: { sliceRaw: "14375000000000", dailyRaw: "345000000000000" } }).answers.find((x) => x.key === "how_much");
  assert.strictEqual(est.params.estimate, true);
  assert.ok(est.text.startsWith("Estimate for today only"));
  assert.ok(est.text.includes("It is not a rate anyone promised you."));
  assert.ok(est.text.includes("goes down when more tokens are locked"));
});

section("16. the reward-asset warning is mandatory and derived");

t("rewardMint !== mint → the differing-asset risk line is present; rewardMint === mint → absent; nothing can toggle it", () => {
  const same = mkProject(); const vs = version(same);
  const rs = T.teachBlock({ project: same, version: vs, funding: funding(null) }).answers.find((x) => x.key === "risks");
  assert.strictEqual(rs.params.rewardAssetDiffers, false); assert.ok(!/different token/.test(rs.text));
  const diff = mkProject({ rewardMint: W.MINT2, rewardMintInfo: { decimals: 6, tokenProgram: TOK, extensions: [] } });
  const vd = version(diff);
  const rd = T.teachBlock({ project: diff, version: vd, funding: funding(null) }).answers.find((x) => x.key === "risks");
  assert.strictEqual(rd.params.rewardAssetDiffers, true); assert.ok(/different token/.test(rd.text) && rd.text.includes("moves on its own"));
  // an "operator" trying to suppress it has no lever: the flag is computed from the two mints
  const rd2 = T.teachBlock({ project: { ...diff, rewardAssetDiffers: false, hideRisk: true }, version: vd, funding: funding(null) }).answers.find((x) => x.key === "risks");
  assert.strictEqual(rd2.params.rewardAssetDiffers, true);
});

section("17. no APR, APY or per-year rate anywhere");

t("the guard catches rate language in every spelling", () => {
  for (const s of ["120% APR", "apy 30%", "annualised yield of 12%", "an annual rate", "5% per year", "5%/yr", "12% a year", "yearly return 40%"]) assert.ok(T.containsRateLanguage(s), s);
  for (const s of ["today's share", "1x to 6x by term", "345,000 over the day", "90 to 540 days"]) assert.ok(!T.containsRateLanguage(s), s);
});

t("no string the block emits contains rate language, across every fixture shape", () => {
  const fixtures = [];
  for (const differs of [false, true]) {
    const p = differs ? mkProject({ rewardMint: W.MINT2, rewardMintInfo: { decimals: 6, tokenProgram: TOK, extensions: [] } }) : mkProject();
    for (const cancelable of [false, true]) {
      const v = version(p, { cancelableAllowed: cancelable });
      for (const f of [funding(null), funding({ balanceRaw: "0", at: NOW }), funding({ balanceRaw: "999999999999999", at: NOW })]) {
        for (const l of [null, lock]) for (const e of [null, { sliceRaw: "1", dailyRaw: "24" }]) fixtures.push(T.teachBlock({ project: p, version: v, funding: f, lock: l, estimate: e }));
      }
    }
  }
  assert.ok(fixtures.length >= 48);
  for (const b of fixtures) for (const s of T.allText(b)) assert.ok(!T.containsRateLanguage(s), "rate language leaked: " + s);
  // and the no-badge guard (test 14's pattern) over the same corpus
  for (const b of fixtures) for (const s of T.allText(b)) assert.ok(!/\b(safe (project|token)|verified project|independently verified|endorsed)\b/i.test(s), "badge language leaked: " + s);
});

section("C4. the lesson map resolves against the real curriculum");

t("every concept key maps to a lesson id that exists in src/App.jsx LESSONS", () => {
  const ids = curriculum.lessonIds();
  assert.ok(Array.isArray(ids) && ids.length > 10, "could not extract LESSONS ids");
  for (const [key, id] of Object.entries(T.LESSON_MAP)) assert.ok(ids.includes(id), `${key} → "${id}" is not a lesson id (have: ${ids.join(", ")})`);
  assert.strictEqual(Object.keys(T.LESSON_MAP).length, 6);
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
