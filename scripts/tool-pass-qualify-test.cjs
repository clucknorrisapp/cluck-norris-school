#!/usr/bin/env node
"use strict";
// lib/tool-pass-qualify.js — every branch of the free-tier decision, with the reads injected.
// The SKR door (Seeker app, 2026-09-22) doubled the branches; this is what keeps "CLKN first,
// SKR only when asked, fail open on OUR outages, never on a verified zero" true by construction.
const { qualify, normalizeDoors, doorsForVia, acceptPrice, SKR_MINT } = require("../lib/tool-pass-qualify");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };
const bal = (n) => async () => ({ balance: n });
const down = async () => ({ unavailable: true, error: "rpc down" });
const boom = async () => { throw new Error("fetch failed"); };
const never = async () => { throw new Error("this read must not happen"); };
const BASE = { wallet: "W", usd: 50, prices: { clkn: 0.0005, skr: 0.5 }, terms: { lamports: 50000000, days: 7 }, comped: false };

(async () => {
  console.log("\nlib/tool-pass-qualify\n");

  // doors
  ok("doors: unknown and non-string entries are dropped, duplicates collapse, order is stable", JSON.stringify(normalizeDoors(["skr", "vip", 7, "skr", null])) === '["skr"]');
  ok("doors: anything that is not an array means no extra door", normalizeDoors("skr").length === 0 && normalizeDoors(undefined).length === 0);
  ok("doorsForVia: a holder-skr token re-checks with the skr door, everything else with none", JSON.stringify(doorsForVia("holder-skr")) === '["skr"]' && doorsForVia("holder").length === 0 && doorsForVia("paid").length === 0);
  ok("the SKR mint is the verified one, not the look-alike", SKR_MINT === "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");

  // 1. comp
  let r = await qualify({ ...BASE, comped: true, readClkn: never, readSkr: never });
  ok("comp wins before any read", r.ok && r.via === "comp");

  // 1b. Two figures, one per door (owner, 2026-09-22: "$20 of SKR or $10 of CLKN"). skrUsd is
  // the SKR door's own threshold; when a caller omits it the SKR door falls back to the CLKN figure.
  r = await qualify({ ...BASE, usd: 10, skrUsd: 20, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(0), readSkr: bal(40) });
  ok("skrUsd: 0 CLKN, 40 SKR at $0.50 ($20) → holder-skr against the SKR figure, needed 40", r.ok && r.via === "holder-skr" && r.needed === 40 && r.holdUsd === 20, r);
  r = await qualify({ ...BASE, usd: 10, skrUsd: 20, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(0), readSkr: bal(39) });
  ok("skrUsd: 39 SKR is one short of the $20 door → denied, and the sentence names $10 of CLKN and $20 of SKR", !r.ok && r.skr && r.skr.needed === 40 && r.skr.holdUsd === 20 && r.needed === 20000 && /\$10 of CLKN/.test(r.detail) && /\$20 of SKR \(~40\)/.test(r.detail), r);
  r = await qualify({ ...BASE, usd: 10, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(0), readSkr: bal(20) });
  ok("skrUsd omitted: the SKR door uses the CLKN figure ($10 → 20 SKR)", r.ok && r.via === "holder-skr" && r.needed === 20 && r.holdUsd === 10, r);
  r = await qualify({ ...BASE, usd: 10, skrUsd: -5, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(0), readSkr: bal(20) });
  ok("skrUsd that is not a positive number falls back to the CLKN figure, never to zero", r.ok && r.via === "holder-skr" && r.needed === 20, r);
  r = await qualify({ ...BASE, usd: 10, skrUsd: 20, prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(20000), readSkr: never });
  ok("the CLKN door is $10 on its own: 20,000 CLKN at $0.0005 → holder, SKR never read", r.ok && r.via === "holder" && r.needed === 20000, r);

  // 2. CLKN first
  r = await qualify({ ...BASE, readClkn: bal(100000), readSkr: never });
  ok("100,000 CLKN at $0.0005 ($50) → holder; SKR is never read when CLKN qualifies", r.ok && r.via === "holder" && r.needed === 100000 && r.balance === 100000);
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(100000), readSkr: never });
  ok("the same with the skr door requested: CLKN still decides first, SKR still never read", r.ok && r.via === "holder");
  r = await qualify({ ...BASE, readClkn: bal(99999), readSkr: never });
  ok("99,999 CLKN, no skr door → denied with the CLKN figures and no SKR block", !r.ok && r.error === "insufficient_holdings" && r.balance === 99999 && r.needed === 100000 && r.skr === null && /100,000/.test(r.detail) && !/SKR/.test(r.detail) && /0\.05 SOL/.test(r.detail));
  r = await qualify({ ...BASE, prices: { clkn: null, skr: 0.5 }, readClkn: never, readSkr: never });
  ok("no CLKN price → grace-price, nothing read", r.ok && r.via === "grace-price");
  r = await qualify({ ...BASE, prices: { clkn: 0, skr: 0.5 }, readClkn: never, readSkr: never });
  ok("a zero CLKN price is 'no price', not a free threshold of zero", r.ok && r.via === "grace-price");
  r = await qualify({ ...BASE, readClkn: down, readSkr: never });
  ok("CLKN read unavailable → grace-rpc (an outage is not a zero balance)", r.ok && r.via === "grace-rpc");
  r = await qualify({ ...BASE, readClkn: boom, readSkr: never });
  ok("CLKN read THROWS → grace-rpc, same policy", r.ok && r.via === "grace-rpc");
  r = await qualify({ ...BASE, readClkn: bal(0), readSkr: never });
  ok("a VERIFIED zero CLKN balance is denied, not graced", !r.ok && r.balance === 0);

  // 3. SKR door
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: bal(100) });
  ok("skr door: 0 CLKN but 100 SKR at $0.50 ($50) → holder-skr with the SKR figures", r.ok && r.via === "holder-skr" && r.needed === 100 && r.balance === 100);
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: bal(99) });
  ok("skr door: 99 SKR → denied, and the detail names BOTH doors with both holdings", !r.ok && r.skr && r.skr.balance === 99 && r.skr.needed === 100 && /SKR/.test(r.detail) && /99 SKR/.test(r.detail) && /100,000/.test(r.detail));
  r = await qualify({ ...BASE, readClkn: bal(0), readSkr: bal(1000000) });
  ok("NO skr door: a million SKR does nothing — the website never grows the door on its own", !r.ok && r.skr === null);
  r = await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: null }, readClkn: bal(0), readSkr: never });
  ok("⚠️ skr door with no SKR price → DENIED (never graced — Codex round 13 P1), SKR not read, the denial says why", !r.ok && r.skr && r.skr.unavailable === "price" && /SKR could not be checked/.test(r.detail));
  r = await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: -1 }, readClkn: bal(0), readSkr: never });
  ok("a negative SKR price is 'no price', and still a denial", !r.ok && r.skr && r.skr.unavailable === "price");
  r = await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: NaN }, readClkn: bal(0), readSkr: never });
  ok("a NaN SKR price is 'no price', and still a denial", !r.ok && r.skr && r.skr.unavailable === "price");
  r = await qualify({ ...BASE, prices: { clkn: -0.0005, skr: 0.5 }, readClkn: never, readSkr: never });
  ok("a negative CLKN price is 'no price' → grace-price (the pre-existing CLKN rule, unchanged)", r.ok && r.via === "grace-price");
  r = await qualify({ ...BASE, prices: { clkn: 0.0005, skr: null }, readClkn: bal(0), readSkr: never });
  ok("no skr door with no SKR price → still a plain CLKN denial (the missing SKR price is irrelevant)", !r.ok && r.skr === null);
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: down });
  ok("⚠️ skr door, SKR read unavailable → DENIED (never graced), the denial says the read failed", !r.ok && r.skr && r.skr.unavailable === "rpc" && /balance read failed/.test(r.detail));
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: boom });
  ok("skr door, SKR read throws → same denial", !r.ok && r.skr && r.skr.unavailable === "rpc");
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(100000), readSkr: never });
  ok("a CLKN holder with the skr door is a holder whatever SKR pricing is doing", r.ok && r.via === "holder");
  // The population claim, stated as a test: for every (price, read) state, a wallet that the
  // website would deny is denied with the skr door too unless it holds a VERIFIED qualifying SKR balance.
  let widened = 0;
  for (const skrPrice of [null, 0, -1, 0.5]) for (const readSkr of [down, boom, bal(0), bal(99)]) {
    const web = await qualify({ ...BASE, prices: { clkn: 0.0005, skr: skrPrice }, readClkn: bal(0), readSkr: never });
    const app = await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: skrPrice }, readClkn: bal(0), readSkr });
    if (!web.ok && app.ok) widened++;
  }
  ok("⚠️ across 16 SKR price × read states, the skr door never admits a wallet the website denies (only a verified ≥ threshold SKR balance does)", widened === 0, { widened });
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: bal(0) });
  ok("skr door, verified zero SKR and zero CLKN → denied", !r.ok && r.skr.balance === 0);
  r = await qualify({ ...BASE, doors: ["skr", "skr", "vip"], readClkn: bal(0), readSkr: bal(100) });
  ok("a noisy door list still resolves to the one known door", r.ok && r.via === "holder-skr" && JSON.stringify(r.doors) === '["skr"]');

  // 4. thresholds are live-priced, never a fixed amount
  r = await qualify({ ...BASE, prices: { clkn: 0.001, skr: 0.5 }, readClkn: bal(50000), readSkr: never });
  ok("price doubles → the CLKN needed halves (50,000 at $0.001)", r.ok && r.via === "holder" && r.needed === 50000);
  r = await qualify({ ...BASE, usd: 100, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.5 }, readClkn: bal(0), readSkr: bal(150) });
  ok("a $100 tier needs 200 SKR at $0.50: 150 is denied", !r.ok && r.skr.needed === 200);
  r = await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: 0.37 }, readClkn: bal(0), readSkr: bal(136) });
  ok("fractional price rounds the threshold UP (50/0.37 → 136), and 136 clears it", r.ok && r.via === "holder-skr" && r.needed === 136);

  // 5. every fail-open path logs why
  const lines = [];
  await qualify({ ...BASE, prices: { clkn: null }, readClkn: never, readSkr: never, log: (m) => lines.push(m) });
  await qualify({ ...BASE, readClkn: down, readSkr: never, log: (m) => lines.push(m) });
  await qualify({ ...BASE, doors: ["skr"], prices: { clkn: 0.0005, skr: null }, readClkn: bal(0), readSkr: never, log: (m) => lines.push(m) });
  await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: boom, log: (m) => lines.push(m) });
  ok("every fail-open and every not-checked path says why (a silent grace hid a two-week pricing outage once)", lines.length === 4 && lines.slice(0, 2).every((l) => /failing open/.test(l)) && lines.slice(2).every((l) => /SKR not checked/.test(l)), lines);

  // 6. the cache sits AFTER comp and caches only real answers (Codex round 13 P2)
  console.log("\ncache + comp ordering\n");
  const mk = () => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }; };
  let cache = mk(); let t = 1000;
  const C = { ...BASE, cache, now: () => t };
  r = await qualify({ ...C, readClkn: bal(0), readSkr: never });
  ok("a verified denial is cached under wallet|", !r.ok && cache.m.has("W|") && cache.m.get("W|").ok === false);
  r = await qualify({ ...C, readClkn: never, readSkr: never });
  ok("…and answers the next website request without a read", !r.ok && r.cached === true);
  r = await qualify({ ...C, comped: true, readClkn: never, readSkr: never });
  ok("⚠️ a comp granted AFTER the cached denial wins immediately (comp before cache)", r.ok && r.via === "comp");
  r = await qualify({ ...C, doors: ["skr"], readClkn: bal(0), readSkr: bal(100) });
  ok("the website's cached denial does NOT answer a Seeker request (different key): SKR is read and qualifies", r.ok && r.via === "holder-skr" && cache.m.has("W|skr"));
  r = await qualify({ ...C, readClkn: never, readSkr: never });
  ok("…and the Seeker grant does NOT answer a website request (still the cached denial)", !r.ok && r.cached === true);
  t += 5 * 60e3 + 1;
  r = await qualify({ ...C, readClkn: bal(100000), readSkr: never });
  ok("after the TTL the cache is re-evaluated (now a holder)", r.ok && r.via === "holder" && !r.cached);
  cache = mk(); t = 2000;
  r = await qualify({ ...BASE, cache, now: () => t, prices: { clkn: null, skr: 0.5 }, readClkn: never, readSkr: never });
  ok("a grace answer is never cached", r.ok && r.via === "grace-price" && cache.m.size === 0);
  r = await qualify({ ...BASE, cache, now: () => t, doors: ["skr"], prices: { clkn: 0.0005, skr: null }, readClkn: bal(0), readSkr: never });
  ok("a denial that could not check SKR is never cached (the next request may find the price)", !r.ok && cache.m.size === 0);
  r = await qualify({ ...BASE, cache, now: () => t, doors: ["skr"], readClkn: bal(0), readSkr: bal(99) });
  ok("a fully verified two-door denial IS cached under wallet|skr", !r.ok && cache.m.has("W|skr"));

  // 7. acceptPrice — one rule for what may be persisted (Codex round 13 P2)
  console.log("\nacceptPrice\n");
  const NOW = 1e12;
  ok("finite positive, no history → accepted", acceptPrice({ fresh: 0.5, last: 0, lastAt: 0, now: NOW }).ok);
  ok("-1 with no history → rejected (never persisted)", !acceptPrice({ fresh: -1, last: 0, lastAt: 0, now: NOW }).ok);
  ok("0 → rejected", !acceptPrice({ fresh: 0, last: 0, lastAt: 0, now: NOW }).ok);
  ok("NaN / undefined / 'abc' → rejected", !acceptPrice({ fresh: NaN, last: 0, lastAt: 0, now: NOW }).ok && !acceptPrice({ fresh: undefined, last: 0, lastAt: 0, now: NOW }).ok && !acceptPrice({ fresh: "abc", last: 0, lastAt: 0, now: NOW }).ok);
  ok("Infinity → rejected", !acceptPrice({ fresh: Infinity, last: 0, lastAt: 0, now: NOW }).ok);
  ok("a string number is accepted as its number", acceptPrice({ fresh: "0.52", last: 0, lastAt: 0, now: NOW }).price === 0.52);
  ok("10× a recent last-good → rejected", !acceptPrice({ fresh: 6, last: 0.5, lastAt: NOW - 60e3, now: NOW }).ok);
  ok("1/10 of a recent last-good → rejected", !acceptPrice({ fresh: 0.04, last: 0.5, lastAt: NOW - 60e3, now: NOW }).ok);
  ok("9× a recent last-good → accepted", acceptPrice({ fresh: 4.5, last: 0.5, lastAt: NOW - 60e3, now: NOW }).ok);
  ok("10× a STALE last-good (7h) → accepted (the market may have moved)", acceptPrice({ fresh: 6, last: 0.5, lastAt: NOW - 7 * 3600e3, now: NOW }).ok);
  ok("a poisoned last-good of -1 never blocks a valid tick (the band ignores a non-positive last)", acceptPrice({ fresh: 0.5, last: -1, lastAt: NOW - 60e3, now: NOW }).ok);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
