#!/usr/bin/env node
"use strict";
// lib/tool-pass-qualify.js — every branch of the free-tier decision, with the reads injected.
// The SKR door (Seeker app, 2026-09-22) doubled the branches; this is what keeps "CLKN first,
// SKR only when asked, fail open on OUR outages, never on a verified zero" true by construction.
const { qualify, normalizeDoors, doorsForVia, SKR_MINT } = require("../lib/tool-pass-qualify");

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
  ok("skr door with no SKR price → grace-price (same fail-open the CLKN price gets), SKR never read", r.ok && r.via === "grace-price" && r.door === "skr");
  r = await qualify({ ...BASE, prices: { clkn: 0.0005, skr: null }, readClkn: bal(0), readSkr: never });
  ok("no skr door with no SKR price → still a plain CLKN denial (the missing SKR price is irrelevant)", !r.ok && r.skr === null);
  r = await qualify({ ...BASE, doors: ["skr"], readClkn: bal(0), readSkr: down });
  ok("skr door, SKR read unavailable → grace-rpc", r.ok && r.via === "grace-rpc" && r.door === "skr");
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
  ok("all four grace paths say why (a silent grace hid a two-week pricing outage once)", lines.length === 4 && lines.every((l) => /failing open/.test(l)), lines);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
