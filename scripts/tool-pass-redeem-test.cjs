#!/usr/bin/env node
"use strict";
// Second reviewer, 2026-09-11 (two rounds): "redemption and entitlement persistence are not
// atomic" and then "a missing block time reintroduces the audit-write dependency" / "changing the
// configured pass length changes existing entitlements". The redemption is now a pure function
// of chain facts: the verified payer, the payment's block time, and an immutable terms schedule
// resolved AT that block time. Consumption is the single durable write; recovery is the same
// payer presenting the same signature. This drives lib/tool-pass-redeem.js with fake stores and
// injected faults so every one of those claims is checked rather than asserted.
const { redeemPaidPass, DAY_MS } = require("../lib/tool-pass-redeem");
const TERMS = require("../lib/tool-pass-terms");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };

// Fake sig store with the real semantics: add() is test-and-set; when `failing` it behaves like
// the production fail-closed path (refuses AND leaves nothing consumed).
function fakeSigStore() {
  const set = new Set(); let failing = false;
  return { add: (s) => { if (!s || set.has(s)) return false; if (failing) return false; set.add(s); return true; }, has: (s) => set.has(s), size: () => set.size, fail: (v) => { failing = v; } };
}
function fakeKv({ throwOnSet } = {}) { const m = new Map(); let sets = 0; return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => { sets++; if (throwOnSet) throw new Error("disk full"); m.set(k, v); }, sets: () => sets, raw: m }; }

const PAYER = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv";
const OTHER = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const SIG = "5".repeat(88);
const NOW = Date.UTC(2026, 8, 11, 1, 0, 0);
const T0 = NOW - 90_000;   // payment landed 90 s ago
const CUR = TERMS.current(NOW);
const v = (over = {}) => ({ ok: true, lamports: CUR.lamports, payer: PAYER, blockTimeMs: T0, ...over });
const run = (a) => redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), now: NOW, ...a });

console.log("the schedule itself");
{
  ok("current terms are the launch terms (0.05 SOL → 7 days) until an entry is appended", CUR.days === 7 && CUR.lamports === 50_000_000, CUR);
  ok("a payment before the first entry resolves to the first entry", TERMS.termsAt(0) === TERMS.SCHEDULE[0]);
  const sched = [{ from: 0, days: 7, lamports: 100 }, { from: 1000, days: 14, lamports: 200 }];
  ok("termsAt picks the last entry at or before the instant", TERMS.termsAt(999, sched).days === 7 && TERMS.termsAt(1000, sched).days === 14 && TERMS.termsAt(5000, sched).days === 14);
}

console.log("first redemption, then recovery by the same payer");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const a = run({ sigStore, kv });
  ok("first redemption issues a pass", a.ok && a.recovered === false, a);
  ok("expiry is the term from the payment's block time, not from now", a.expiresAt === T0 + CUR.days * DAY_MS && a.termDays === CUR.days, a);
  ok("ttl is expiry minus now", a.ttlMs === a.expiresAt - NOW, a);
  ok("the signature is consumed exactly once", sigStore.size() === 1 && sigStore.has("sol:" + SIG));
  ok("audit record written", kv.raw.has("toolPassPaid:" + SIG));
  const b = run({ sigStore, kv, now: NOW + 3600e3 });
  ok("same payer an hour later (lost response / closed tab / other device) recovers", b.ok && b.recovered === true, b);
  ok("recovered pass has the SAME expiry — a retry never extends it", b.expiresAt === a.expiresAt, { a: a.expiresAt, b: b.expiresAt });
  ok("recovery shortens the ttl accordingly", b.ttlMs === a.ttlMs - 3600e3, b);
  const c = run({ sigStore, kv, now: NOW + 2 * 3600e3 });
  ok("recovery works any number of times", c.ok && c.recovered === true && c.expiresAt === a.expiresAt, c);
  ok("still exactly one consumed signature", sigStore.size() === 1);
}

console.log("terms are pinned at payment time (round-2 finding: config change moved entitlements)");
{
  // A schedule that changes AFTER the payment: 7 days when paid, 14 days from tomorrow.
  const changed = [{ from: 0, days: 7, lamports: 50_000_000 }, { from: NOW + DAY_MS, days: 14, lamports: 80_000_000 }];
  const termsAt = (t) => TERMS.termsAt(t, changed);
  const sigStore = fakeSigStore();
  const a = run({ sigStore, termsAt });
  ok("bought under 7-day terms", a.ok && a.termDays === 7 && a.expiresAt === T0 + 7 * DAY_MS, a);
  const b = run({ sigStore, termsAt, now: NOW + 2 * DAY_MS });
  ok("recovered after the offer became 14 days: still 7, same expiry", b.ok && b.recovered && b.termDays === 7 && b.expiresAt === a.expiresAt, b);
  // A payment made AFTER the change resolves to the new entry, and its old-price amount is short.
  const late = redeemPaidPass({ paySig: "6".repeat(88), wallet: PAYER, verified: v({ blockTimeMs: NOW + 2 * DAY_MS }), sigStore, termsAt, now: NOW + 2 * DAY_MS + 60e3 });
  ok("a payment after the change at the OLD price is 'amount too low' against the NEW minimum", !late.ok && late.error === "amount too low" && late.needed === 80_000_000, late);
  ok("…and consumes nothing", sigStore.size() === 1);
  const late2 = redeemPaidPass({ paySig: "6".repeat(88), wallet: PAYER, verified: v({ blockTimeMs: NOW + 2 * DAY_MS, lamports: 80_000_000 }), sigStore, termsAt, now: NOW + 2 * DAY_MS + 60e3 });
  ok("a payment after the change at the new price buys 14 days", late2.ok && late2.termDays === 14, late2);
  // The reverse: the offer gets SHORTER later; a pass bought before keeps its full term.
  const shorter = (t) => TERMS.termsAt(t, [{ from: 0, days: 7, lamports: 50_000_000 }, { from: NOW + DAY_MS, days: 3, lamports: 50_000_000 }]);
  const s2 = fakeSigStore();
  const c = run({ sigStore: s2, termsAt: shorter });
  const d = run({ sigStore: s2, termsAt: shorter, now: NOW + 5 * DAY_MS });
  ok("offer cut to 3 days later: a 7-day pass bought before is still valid on day 5", c.ok && d.ok && d.recovered && d.expiresAt === c.expiresAt && d.ttlMs > 0, { c, d });
  // An underpayment against the terms at payment time, under the default schedule.
  const s3 = fakeSigStore();
  const u = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ lamports: CUR.lamports - 1 }), sigStore: s3, now: NOW });
  ok("one lamport short of the minimum in force at payment time is refused, nothing consumed", !u.ok && u.error === "amount too low" && s3.size() === 0, u);
  const o = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ lamports: CUR.lamports * 3 }), sigStore: s3, now: NOW });
  ok("overpaying buys exactly one term, not more", o.ok && o.termDays === CUR.days, o);
}

console.log("missing block time is 'not verifiable yet', never guessed (round-2 finding)");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  for (const bt of [0, null, undefined, -5, "x"]) {
    const r = run({ sigStore, kv, verified: v({ blockTimeMs: bt }) });
    ok(`blockTimeMs=${String(bt)} → refused as retryable`, !r.ok && r.retry === true && /not timestamped/.test(r.error), r);
  }
  ok("nothing consumed, no audit line, so a later retry with a block time is a normal first redemption", sigStore.size() === 0 && kv.sets() === 0);
  const a = run({ sigStore, kv });
  ok("…which it is", a.ok && a.recovered === false && a.expiresAt === T0 + CUR.days * DAY_MS, a);
  // The reproduced case: retry cannot extend expiry by a day, because there is no fallback clock.
  const b = run({ sigStore, kv, now: NOW + DAY_MS });
  ok("a retry a day later cannot move the expiry", b.ok && b.expiresAt === a.expiresAt, { a: a.expiresAt, b: b.expiresAt });
}

console.log("a different wallet consumes nothing");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const r = redeemPaidPass({ paySig: SIG, wallet: OTHER, verified: v(), sigStore, kv, now: NOW });
  ok("refused with 403", !r.ok && r.status === 403 && /different wallet/.test(r.error), r);
  ok("NOTHING consumed by the refusal", sigStore.size() === 0 && kv.sets() === 0);
  const a = run({ sigStore, kv });
  ok("the real payer still redeems first-time afterwards", a.ok && a.recovered === false, a);
  const r2 = redeemPaidPass({ paySig: SIG, wallet: OTHER, verified: v(), sigStore, kv, now: NOW });
  ok("a different wallet cannot 'recover' a consumed payment either", !r2.ok && r2.status === 403, r2);
  ok("a missing payer field is refused, not treated as a match", !run({ sigStore: fakeSigStore(), verified: v({ payer: null }) }).ok);
}

console.log("crash / fault between the two writes (the round-1 finding)");
{
  const sigStore = fakeSigStore(), kv = fakeKv({ throwOnSet: true });
  const a = run({ sigStore, kv });
  ok("the pass is issued even though the audit write threw", a.ok && a.recovered === false, a);
  ok("consumption happened", sigStore.has("sol:" + SIG));
  const b = run({ sigStore, kv, now: NOW + 60e3 });
  ok("retry after the fault recovers with the same expiry — recovery does not depend on kv", b.ok && b.recovered === true && b.expiresAt === a.expiresAt, b);
  const c = run({ sigStore, kv: null, now: NOW + 120e3 });
  ok("recovery with NO kv store at all", c.ok && c.recovered === true && c.expiresAt === a.expiresAt, c);
  const d = run({ sigStore, kv: { set: () => { throw new Error("nope"); }, get: () => { throw new Error("nope"); } }, now: NOW + 180e3 });
  ok("a kv that throws on every call changes nothing", d.ok && d.recovered && d.expiresAt === a.expiresAt, d);
}

console.log("the sig store cannot record durably (fail-closed add)");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  sigStore.fail(true);
  const a = run({ sigStore, kv });
  ok("answers 503, retryable, no pass", !a.ok && a.status === 503 && a.retry === true, a);
  ok("nothing consumed, no audit line", sigStore.size() === 0 && kv.sets() === 0);
  sigStore.fail(false);
  const b = run({ sigStore, kv, now: NOW + 30e3 });
  ok("retry once the store is healthy is a normal FIRST redemption", b.ok && b.recovered === false && b.expiresAt === T0 + CUR.days * DAY_MS, b);
}

console.log("stale payments");
{
  const sigStore = fakeSigStore();
  const old = run({ sigStore, verified: v({ blockTimeMs: NOW - (CUR.days + 1) * DAY_MS }) });
  ok("a payment older than the pass it bought is refused", !old.ok && /already expired/.test(old.error), old);
  ok("…and consumes nothing", sigStore.size() === 0);
  const edge = run({ sigStore, verified: v({ blockTimeMs: NOW - CUR.days * DAY_MS + 60e3 }) });
  ok("a payment with one minute of pass left still redeems, for that minute (days rounds up to 1)", edge.ok && edge.ttlMs === 60e3 && edge.days === 1, edge);
}

console.log("unverified payments never reach the store");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const r = run({ sigStore, kv, verified: { ok: false, error: "tx not found or failed", lamports: undefined } });
  ok("verification failure is passed through with its reason", !r.ok && r.error === "tx not found or failed", r);
  ok("nothing consumed", sigStore.size() === 0 && kv.sets() === 0);
}

console.log("two tabs redeem the same payment back to back");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const a = run({ sigStore, kv }), b = run({ sigStore, kv });
  ok("first wins as a redemption, second is a recovery, both hold the same pass", a.ok && !a.recovered && b.ok && b.recovered && a.expiresAt === b.expiresAt, { a, b });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
