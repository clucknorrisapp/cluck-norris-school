#!/usr/bin/env node
"use strict";
// The 5-minute settle delay and the &rewind= admin lever (2026-09-24).
//
// THE INCIDENT: wallet 8w3JXv…HCuNt made 35 qualifying CUNA buys on 2026-09-23; the scanner
// credited only 20. The 15 missed were exactly the buys that landed SECONDS before a scan tick
// ran (12:31:17–12:31:26 UTC, scanned by the 12:31:30 tick) plus a whole burst at
// 21:21:38–21:22:35. getTradeTapeHelius only flags `reachedWindowStart:false` when a signature is
// MISSING from its batch — not when a signature is present but Helius's enhanced parse hasn't
// caught up yet and returns it with no usable tokenTransfers. That reads as a fully-covered,
// empty slice, and the incremental scanner (never looks back) retired it — the buys inside it were
// gone forever.
//
// THE FIX, two parts, both exercised here against the REAL module:
//   1. scanOnce() never scans a slice whose end is within SETTLE_MS (5 min) of "now" — by the time
//      a slice is scanned, Helius's enhanced parse has had time to catch up.
//   2. rewindCursor() is the auditable escape hatch for tape that was ALREADY retired before the
//      fix shipped: it moves cursorMs backward so the next scan re-walks that stretch. Safe by
//      construction — credits are deduped by signature and dq marks are never touched.
//
// Dependency-free: stubs getTradeTapeHelius directly (not fetch) and drives a fake clock, exactly
// as the task specifies. GeckoTerminal (the price bars) is stubbed too, flat, so every buy in this
// file prices at the same $0.05 and only the SCANNER's own behaviour is under test.
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-giveaway-scan-"));
process.env.DATA_DIR = DIR;

const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const POOL = "PooLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const W1 = "BtrxmsfE3XTwvJaJ9q4u4dpdrykMDaVavwbnRRAizdCE";
const W2 = "4f2gAxUftav2zLYFiouwGf7SwtHyazBDy72feEu3eAHz";

const MIN_MS = 60 * 1000;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);   // window open — the incident's own date

// ---- fake clock ------------------------------------------------------------------------------
let now = T0 + 20 * MIN_MS;
const realNow = Date.now;
Date.now = () => now;

// ---- fake price bars (GeckoTerminal) — flat $0.05 across the whole window + buffer -----------
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("geckoterminal")) {
    const bars = [];
    for (let t = T0 - 3600000; t <= T0 + 25 * 3600000; t += 300000) bars.push([Math.floor(t / 1000), 0, 0, 0, 0.05, 0]);
    return { json: async () => ({ data: { attributes: { ohlcv_list: bars.reverse() } } }) };
  }
  return { json: async () => ({ result: null }) };
};

// ---- fake getTradeTapeHelius — patched on the module BEFORE cuna-giveaway.js is first required,
// so its top-level `const { getTradeTapeHelius } = require('./helius-trades')` destructures OUR
// stub, not the real network-calling one. Mirrors real semantics: a call only ever returns trades
// whose ts falls inside [from, to) — exactly what querying signatures in that window would.
let ALL_TRADES = [];
const heliusTrades = require(path.join(__dirname, "..", "lib", "helius-trades.js"));
heliusTrades.getTradeTapeHelius = async (mint, from, to) => ({
  trades: ALL_TRADES.filter((t) => t.ts >= from && t.ts < to),
  reachedWindowStart: true, capped: false, txsMissing: 0, poolErrors: [],
});

const gw = require(path.join(__dirname, "..", "lib", "cuna-giveaway.js"));
const deps = { heliusKey: "stub", heliusEnhancedBatched: async () => ({ txs: [] }) };

function entriesFor(w) {
  const st = gw.standings(100);
  const row = st.top.find((r) => r.wallet === w) || (st.disqualifiedList || []).find((r) => r.wallet === w);
  return row ? row.entries : 0;
}

(async () => {
  console.log("\ncuna-giveaway scanner — the 5-minute settle delay\n");

  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 24 * 3600000, minUsd: 2.5 });
  gw.resetLedger();

  // A buy landing 2 minutes before "now" — the exact shape of the incident (12:31:17–26 UTC,
  // scanned by the 12:31:30 tick nine seconds later).
  const buyTs = now - 2 * MIN_MS;
  ALL_TRADES = [{ ts: buyTs, wallet: W1, side: "buy", tokenAmt: 100, sig: "SIG1" }];   // $5.00

  const r1 = await gw.scanOnce(deps);
  ok("tick 1: scan succeeds", r1.ok === true, JSON.stringify(r1));
  ok("tick 1: cursor stops at now − 5 min, not at now", r1.cursorMs === now - 5 * 60000,
     "cursor=" + r1.cursorMs + " expected=" + (now - 5 * 60000));
  ok("tick 1: the too-fresh buy is NOT credited yet", entriesFor(W1) === 0, "entries=" + entriesFor(W1));

  // Ten minutes later the same buy is well past the settle delay.
  now += 10 * MIN_MS;
  const r2 = await gw.scanOnce(deps);
  ok("tick 2: cursor advances to the new now − 5 min", r2.cursorMs === now - 5 * 60000,
     "cursor=" + r2.cursorMs + " expected=" + (now - 5 * 60000));
  ok("tick 2: the buy is credited once it has settled", entriesFor(W1) === 1, "entries=" + entriesFor(W1));
  ok("tick 2: newEntries reports exactly the one buy", r2.newEntries === 1, JSON.stringify(r2));

  console.log("\ncuna-giveaway scanner — rewindCursor re-opens retired tape\n");

  // Simulate the bug this replaces: a signature that landed in an ALREADY-SCANNED slice but that
  // Helius did not surface until later — exactly SIG2 here, timestamped inside the very first
  // slice the scanner already retired.
  const missedTs = T0 + 5 * MIN_MS;
  ALL_TRADES.push({ ts: missedTs, wallet: W2, side: "buy", tokenAmt: 200, sig: "SIG2" });   // $10.00

  const cursorBeforeRewind = gw.standings(1).cursorMs;
  const rw = gw.rewindCursor(new Date(T0).toISOString());
  ok("rewind reports ok and the new cursor", rw.ok === true && rw.cursorMs === T0, JSON.stringify(rw));
  ok("rewind reports how far it moved", rw.rewoundMs === cursorBeforeRewind - T0, JSON.stringify(rw));
  ok("rewind does NOT touch existing wallet records", entriesFor(W1) === 1, "entries=" + entriesFor(W1));

  const r3 = await gw.scanOnce(deps);
  ok("re-scan does not double-credit the already-credited signature", entriesFor(W1) === 1, "entries=" + entriesFor(W1));
  ok("re-scan DOES credit the signature the first pass never saw", entriesFor(W2) === 1, "entries=" + entriesFor(W2));
  ok("re-scan's newEntries counts only the one new credit", r3.newEntries === 1, JSON.stringify(r3));

  console.log("\ncuna-giveaway scanner — rewindCursor clamps\n");

  const cursorNow = gw.standings(1).cursorMs;
  const forward = gw.rewindCursor(cursorNow + 999 * MIN_MS);
  ok("rewind refuses to move the cursor FORWARD", forward.ok === true && forward.cursorMs === cursorNow,
     JSON.stringify(forward));
  ok("a forward attempt reports zero rewound", forward.rewoundMs === 0, JSON.stringify(forward));

  const tooEarly = gw.rewindCursor(T0 - 1000000);
  ok("rewind clamps to the promo's startMs, never earlier", tooEarly.ok === true && tooEarly.cursorMs === T0,
     JSON.stringify(tooEarly));

  const bad = gw.rewindCursor("not-a-real-timestamp");
  ok("an unparseable rewind target is refused, not silently clamped", bad.ok === false && bad.error === "bad_time",
     JSON.stringify(bad));
  ok("…and the cursor is untouched by the refused call", gw.standings(1).cursorMs === T0,
     "cursor=" + gw.standings(1).cursorMs);

  Date.now = realNow;
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { Date.now = realNow; console.error("\nharness error: " + (e && e.stack || e)); process.exit(1); });
