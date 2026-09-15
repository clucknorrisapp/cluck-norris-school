"use strict";
// lib/analytics.js — the engaged-visitor signal and the host split (2026-09-15).
// Why: since 2026-08-16 the site records ~4,500 one-page, no-referrer "visitors" a day — automated
// traffic with browser user agents that BOT_RE cannot see. A visitor counts as engaged only after a
// second page in the day or a funnel event; views are keyed by the real Host header.
const assert = require("assert");
const fs = require("fs"); const os = require("os"); const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-test-"));
const A = require("../lib/analytics");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ✓ " + n); pass++; } catch (e) { console.log("  ✗ " + n + "\n      " + e.message); fail++; } };
const req = (over = {}) => ({ method: "GET", path: "/", ip: "203.0.113.5", headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari", host: "clucknorris.app", ...(over.headers || {}) }, ...over });

t("a bot user agent records nothing", () => {
  A.trackView(req({ headers: { "user-agent": "Googlebot/2.1", host: "clucknorris.app" } }));
  assert.strictEqual(A.summary(1).totals.views, 0);
});

t("one page from one visitor: a view and a visitor-day, but NOT engaged", () => {
  A.trackView(req());
  const s = A.summary(1);
  assert.strictEqual(s.totals.views, 1); assert.strictEqual(s.totals.visitorDays, 1); assert.strictEqual(s.totals.engagedVisitorDays, 0);
  assert.strictEqual(s.series[0].engaged, 0);
});

t("a second page from the same visitor makes it engaged, once", () => {
  A.trackView(req({ path: "/school" })); A.trackView(req({ path: "/tools" }));
  const s = A.summary(1);
  assert.strictEqual(s.totals.views, 3); assert.strictEqual(s.totals.visitorDays, 1); assert.strictEqual(s.totals.engagedVisitorDays, 1);
});

t("4,500 one-page visitors add 4,500 visitor-days and zero engaged", () => {
  for (let i = 0; i < 4500; i++) A.trackView(req({ ip: `198.51.${(i >> 8) & 255}.${i & 255}`, headers: { "user-agent": "Mozilla/5.0 (X11; Linux) Chrome/1" + i, host: "clucknorris.app" } }));
  const s = A.summary(1);
  assert.strictEqual(s.totals.visitorDays, 4501); assert.strictEqual(s.totals.engagedVisitorDays, 1);
});

t("a funnel event with a request marks that visitor engaged even on a single page", () => {
  const r = req({ ip: "192.0.2.9", headers: { "user-agent": "Mozilla/5.0 (Android) Chrome/9", host: "clucknorris.app" } });
  A.trackView(r);
  assert.strictEqual(A.summary(1).totals.engagedVisitorDays, 1);
  A.trackFunnel("lesson_start:lp", r);
  const s = A.summary(1);
  assert.strictEqual(s.totals.engagedVisitorDays, 2); assert.strictEqual(s.funnel["lesson_start:lp"], 1);
});

t("a funnel event without a request still counts the event and marks nobody", () => {
  A.trackFunnel("school_start");
  assert.strictEqual(A.summary(1).funnel.school_start, 1);
  assert.strictEqual(A.summary(1).totals.engagedVisitorDays, 2);
});

t("views are keyed by the raw Host header — the game domain's / is not the homepage's /", () => {
  A.trackView(req({ headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari", host: "normiequest.app" } }));
  A.trackView(req({ headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari", host: "www.staking.cunatoken.com:443" } }));
  const hosts = Object.fromEntries(A.summary(1).topHosts.map((x) => [x.k, x.v]));
  assert.strictEqual(hosts["normiequest.app"], 1); assert.strictEqual(hosts["staking.cunatoken.com"], 1);
  assert.ok(hosts["clucknorris.app"] >= 4500);
  assert.strictEqual(A.hostOf({ headers: { host: "WWW.Example.com:8080" } }), "example.com");
  assert.strictEqual(A.hostOf({ headers: {} }), "-");
});

t("engaged and hosts survive a flush and reload; old buckets without them still load", () => {
  A.flush();
  const kv = require("../lib/kvstore");
  const saved = kv.get("analytics_v1");
  const day = Object.keys(saved.days)[0];
  assert.ok(Array.isArray(saved.days[day].engaged) && saved.days[day].engaged.length === 2);
  assert.ok(saved.days[day].hosts["clucknorris.app"] > 0);
  // an old-shape bucket
  saved.days["2026-01-01"] = { views: 3, paths: { "/": 3 }, tools: {}, refs: {}, visitors: ["a", "b"] };
  kv.set("analytics_v1", saved);
  delete require.cache[require.resolve("../lib/analytics")];
  const B = require("../lib/analytics");
  const s = B.summary(400);
  const old = s.series.find((x) => x.date === "2026-01-01");
  assert.deepStrictEqual({ views: old.views, visitors: old.visitors, engaged: old.engaged }, { views: 3, visitors: 2, engaged: 0 });
  assert.strictEqual(B.summary(1).totals.engagedVisitorDays, 2);
});

console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
process.exit(fail ? 1 : 0);
