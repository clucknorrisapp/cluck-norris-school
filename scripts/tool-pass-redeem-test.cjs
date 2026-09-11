#!/usr/bin/env node
"use strict";
// Second reviewer, 2026-09-11: "Redemption and entitlement persistence are not atomic — a crash
// between sigStore.add() and kv.set() leaves a consumed payment with no recoverable pass." The
// fix removes the second write from the money path: the pass is a chain fact (payer + block
// time + pass length), consumption is the single durable write, and recovery is "the same payer
// presents the same signature again". This drives lib/tool-pass-redeem.js with fake stores and
// injected faults so every one of those claims is checked rather than asserted.
const { redeemPaidPass, DAY_MS } = require("../lib/tool-pass-redeem");

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
const NOW = 1_800_000_000_000;
const T0 = NOW - 90_000;   // payment landed 90 s ago
const DAYS = 7;
const v = (over = {}) => ({ ok: true, lamports: 50_000_000, payer: PAYER, blockTimeMs: T0, ...over });

console.log("first redemption, then recovery by the same payer");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("first redemption issues a pass", a.ok && a.recovered === false, a);
  ok("expiry is DAYS from the payment's block time, not from now", a.expiresAt === T0 + DAYS * DAY_MS, a);
  ok("ttl is expiry minus now", a.ttlMs === a.expiresAt - NOW, a);
  ok("the signature is consumed exactly once", sigStore.size() === 1 && sigStore.has("sol:" + SIG));
  ok("audit record written", kv.raw.has("toolPassPaid:" + SIG));
  const b = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW + 3600e3 });
  ok("same payer an hour later (lost response / closed tab / other device) recovers", b.ok && b.recovered === true, b);
  ok("recovered pass has the SAME expiry — a retry never extends it", b.expiresAt === a.expiresAt, { a: a.expiresAt, b: b.expiresAt });
  ok("recovery shortens the ttl accordingly", b.ttlMs === a.ttlMs - 3600e3, b);
  const c = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW + 2 * 3600e3 });
  ok("recovery works any number of times", c.ok && c.recovered === true && c.expiresAt === a.expiresAt, c);
  ok("still exactly one consumed signature", sigStore.size() === 1);
}

console.log("a different wallet consumes nothing");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const r = redeemPaidPass({ paySig: SIG, wallet: OTHER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("refused with 403", !r.ok && r.status === 403 && /different wallet/.test(r.error), r);
  ok("NOTHING consumed by the refusal", sigStore.size() === 0 && kv.sets() === 0);
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("the real payer still redeems first-time afterwards", a.ok && a.recovered === false, a);
  const r2 = redeemPaidPass({ paySig: SIG, wallet: OTHER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("a different wallet cannot 'recover' a consumed payment either", !r2.ok && r2.status === 403, r2);
  ok("a missing payer field is refused, not treated as a match", !redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ payer: null }), days: DAYS, sigStore: fakeSigStore(), now: NOW }).ok);
}

console.log("crash / fault between the two writes (the reported finding)");
{
  // The audit write throws — exactly the "kv persist failure / crash after consumption" case.
  const sigStore = fakeSigStore(), kv = fakeKv({ throwOnSet: true });
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("the pass is issued even though the audit write threw", a.ok && a.recovered === false, a);
  ok("consumption happened", sigStore.has("sol:" + SIG));
  const b = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW + 60e3 });
  ok("retry after the fault recovers with the same expiry — recovery does not depend on kv", b.ok && b.recovered === true && b.expiresAt === a.expiresAt, b);
  // No kv at all (restart with an empty/unmounted kv, consumption file intact).
  const c = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv: null, now: NOW + 120e3 });
  ok("recovery with NO kv store at all", c.ok && c.recovered === true && c.expiresAt === a.expiresAt, c);
}

console.log("the sig store cannot record durably (fail-closed add)");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  sigStore.fail(true);
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("answers 503, no pass", !a.ok && a.status === 503, a);
  ok("nothing consumed, no audit line", sigStore.size() === 0 && kv.sets() === 0);
  sigStore.fail(false);
  const b = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW + 30e3 });
  ok("retry once the store is healthy is a normal FIRST redemption", b.ok && b.recovered === false && b.expiresAt === T0 + DAYS * DAY_MS, b);
}

console.log("stale payments and missing block time");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const old = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ blockTimeMs: NOW - (DAYS + 1) * DAY_MS }), days: DAYS, sigStore, kv, now: NOW });
  ok("a payment older than the pass length is refused", !old.ok && /already expired/.test(old.error), old);
  ok("…and consumes nothing", sigStore.size() === 0);
  const edge = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ blockTimeMs: NOW - DAYS * DAY_MS + 60e3 }), days: DAYS, sigStore, kv, now: NOW });
  ok("a payment with one minute of pass left still redeems, for that minute (days rounds up to 1)", edge.ok && edge.ttlMs === 60e3 && edge.days === 1, edge);
  // No block time: falls back to now on the first call and to the audit record's startAt on a
  // retry, so a retry cannot extend the pass.
  const s2 = fakeSigStore(), k2 = fakeKv();
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ blockTimeMs: 0 }), days: DAYS, sigStore: s2, kv: k2, now: NOW });
  ok("no block time → pass starts now", a.ok && a.expiresAt === NOW + DAYS * DAY_MS, a);
  const b = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v({ blockTimeMs: 0 }), days: DAYS, sigStore: s2, kv: k2, now: NOW + 5 * 3600e3 });
  ok("no block time, retry → same expiry via the audit record", b.ok && b.recovered && b.expiresAt === a.expiresAt, b);
}

console.log("unverified payments never reach the store");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const r = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: { ok: false, error: "amount too low", lamports: 1 }, days: DAYS, sigStore, kv, now: NOW });
  ok("verification failure is passed through with its reason", !r.ok && r.error === "amount too low" && r.lamports === 1, r);
  ok("nothing consumed", sigStore.size() === 0 && kv.sets() === 0);
}

console.log("two tabs redeem the same payment back to back");
{
  const sigStore = fakeSigStore(), kv = fakeKv();
  const a = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  const b = redeemPaidPass({ paySig: SIG, wallet: PAYER, verified: v(), days: DAYS, sigStore, kv, now: NOW });
  ok("first wins as a redemption, second is a recovery, both hold the same pass", a.ok && !a.recovered && b.ok && b.recovered && a.expiresAt === b.expiresAt, { a, b });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
