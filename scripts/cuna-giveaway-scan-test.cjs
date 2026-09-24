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
// Two knobs the catchUp() tests below flip on and off:
//   clockStepMs  — advances the fake clock on every tape fetch, so a catchUp() loop that makes
//                  several scanOnce() calls actually sees wall-clock time pass between them
//                  (Date.now() is otherwise frozen, so a real budgetMs would never expire).
//   forceTapeError — when set, the next fetch throws instead of returning trades, so scanOnce()
//                  takes its ok:false path exactly as a real tape/RPC failure would.
//   pauseAtFrom / pauseState — the concurrency race for the Codex round 32 P1 test below: when
//                  a tape request's `from` matches pauseAtFrom, the stub signals the test (via
//                  pauseState.hitResolve) that it has been entered, then awaits pauseState.gate —
//                  letting the test do something (rewind the cursor) while scanOnce() is genuinely
//                  suspended mid-await, before releasing it to resume.
let clockStepMs = 0;
let forceTapeError = null;
let pauseAtFrom = null;
let pauseState = null;
// realDelayMs — Codex round 32 "second lens" item 6: a GENUINE real-wall-clock delay (unlike
// clockStepMs, which only bumps the fake Date.now()), so a tight real deadlineMs can actually lose
// a Promise.race against it and exercise scanOnce()'s slice_timeout path for real.
let realDelayMs = 0;
const heliusTrades = require(path.join(__dirname, "..", "lib", "helius-trades.js"));
heliusTrades.getTradeTapeHelius = async (mint, from, to) => {
  now += clockStepMs;
  if (forceTapeError) throw new Error(forceTapeError);
  if (pauseAtFrom != null && from === pauseAtFrom) {
    const p = pauseState;
    pauseAtFrom = null; pauseState = null;
    p.hitResolve();
    await p.gate;
  }
  if (realDelayMs > 0) await new Promise((r) => setTimeout(r, realDelayMs));
  return {
    trades: ALL_TRADES.filter((t) => t.ts >= from && t.ts < to),
    reachedWindowStart: true, capped: false, txsMissing: 0, poolErrors: [],
  };
};

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

  console.log("\ncuna-giveaway scanner — catchUp() (owner, 2026-09-24: \"nothing should take 100 minutes ever\")\n");

  // Fresh window and fresh ledger so this section's numbers don't depend on the tests above.
  const HOUR = 60 * MIN_MS;
  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 24 * HOUR, minUsd: 2.5 });
  gw.resetLedger();

  // ~14h10m into the window — comfortably inside the 24h promo, and the same order of magnitude
  // as the incident's own backlog. One buy every hour for W1, one every two hours for W2.
  now = T0 + 14 * HOUR + 10 * MIN_MS;
  const cuTrades = [];
  for (let h = 0; h < 14; h++) {
    cuTrades.push({ ts: T0 + h * HOUR + 5 * MIN_MS, wallet: W1, side: "buy", tokenAmt: 100, sig: "CU-W1-" + h });   // $5.00
    if (h % 2 === 0) cuTrades.push({ ts: T0 + h * HOUR + 20 * MIN_MS, wallet: W2, side: "buy", tokenAmt: 100, sig: "CU-W2-" + h });
  }
  ALL_TRADES = cuTrades;

  // Bring the ledger up to date first — this is the "already scanned" baseline the rewind below
  // reopens. Date.now() is frozen in this harness, so a generous budget never trips on its own;
  // only clockStepMs (0 here) or the loop reaching upToDate ends it.
  const primed = await gw.catchUp(deps, { budgetMs: 10 * 60 * 1000 });
  ok("catchUp: priming run reaches upToDate", primed.ok === true && primed.upToDate === true, JSON.stringify(primed));
  const w1Before = entriesFor(W1), w2Before = entriesFor(W2);
  ok("catchUp: priming run credited every W1 buy", w1Before === 14, "entries=" + w1Before);
  ok("catchUp: priming run credited every W2 buy", w2Before === 7, "entries=" + w2Before);

  // (a) a ~14-hour rewind, caught up in one catchUp() call.
  const rewound = gw.rewindCursor(T0);
  ok("catchUp: rewind reopens the full ~14h stretch", rewound.ok === true && rewound.cursorMs === T0, JSON.stringify(rewound));

  const caught = await gw.catchUp(deps, { budgetMs: 10 * 60 * 1000 });
  ok("catchUp: one call drives the rewound cursor back to the ceiling", caught.ok === true && caught.upToDate === true,
     JSON.stringify(caught));
  ok("catchUp: it took more than one internal scanOnce() call", caught.calls > 1, "calls=" + caught.calls);

  // (d) nothing already credited gets credited twice by the re-walk.
  ok("catchUp: re-walked signatures are not double-counted (W1)", entriesFor(W1) === w1Before,
     "entries=" + entriesFor(W1) + " expected=" + w1Before);
  ok("catchUp: re-walked signatures are not double-counted (W2)", entriesFor(W2) === w2Before,
     "entries=" + entriesFor(W2) + " expected=" + w2Before);

  // (b) the wall-clock budget stops the loop early and reports how far behind it still is.
  gw.rewindCursor(T0);
  clockStepMs = 20000;   // each tape fetch now "costs" 20s of wall clock — several fetches per
                          // scanOnce() call blow well past a tight budget between loop iterations.
  const budgeted = await gw.catchUp(deps, { budgetMs: 45000 });
  clockStepMs = 0;
  ok("catchUp: a tight budget stops the loop before it finishes", budgeted.ok === true && budgeted.upToDate === false,
     JSON.stringify(budgeted));
  ok("catchUp: it reports the remaining backlog, not zero", budgeted.behindMs > 0, JSON.stringify(budgeted));
  ok("catchUp: it made at least one call before stopping", budgeted.calls >= 1, JSON.stringify(budgeted));

  // (c) a hard scanOnce() error stops the loop immediately and is surfaced, not swallowed.
  forceTapeError = "stub RPC outage";
  const failed = await gw.catchUp(deps, { budgetMs: 10 * 60 * 1000 });
  forceTapeError = null;
  ok("catchUp: a tape/RPC failure is surfaced as ok:false", failed.ok === false && failed.error === "tape_failed",
     JSON.stringify(failed));
  ok("catchUp: the failure detail is passed through", failed.detail === "stub RPC outage", JSON.stringify(failed));
  ok("catchUp: it stops on the very first failing call", failed.calls === 1, "calls=" + failed.calls);

  console.log("\ncuna-giveaway scanner — a rewind mid-scan does not get clobbered (Codex round 32 P1)\n");

  // A 90-minute window: pause a scan whose in-flight tape request is for the slice starting at
  // minute 60 (six 10-minute slices already landed, cursor sitting at 60), successfully rewind
  // the cursor to minute 0 WHILE that request is still in flight, then release it. Before the
  // fix, the resumed scanOnce() blindly did `s.cursorMs = to` off its own stale `from`/`to`,
  // silently undoing the rewind and leaving the 0..60 "recovery range" (the whole reason to
  // rewind) never re-walked even though the final cursor read as fully caught up.
  const HOUR2 = 60 * MIN_MS;
  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 90 * MIN_MS, minUsd: 2.5 });
  gw.resetLedger();
  now = T0 + 120 * MIN_MS;   // comfortably past the window's own end + the settle delay

  // Only visible AFTER the pause point below — models the exact incident this lever exists for:
  // a trade in an already-scanned range that a late-arriving Helius enrichment only reveals once
  // an operator rewinds to re-walk it.
  ALL_TRADES = [{ ts: T0 + 65 * MIN_MS, wallet: W2, side: "buy", tokenAmt: 100, sig: "SUP-MID" }];

  let gateResolve, hitResolve;
  const gatePromise = new Promise((res) => { gateResolve = res; });
  const hitPromise = new Promise((res) => { hitResolve = res; });
  pauseAtFrom = T0 + 60 * MIN_MS;
  pauseState = { hitResolve, gate: gatePromise };

  const scanPromise = gw.scanOnce(deps);
  await hitPromise;   // the slice starting at minute 60 is now genuinely paused mid-await

  ok("mid-scan: the cursor reached minute 60 before pausing", gw.standings(1).cursorMs === T0 + 60 * MIN_MS,
     "cursorMs=" + gw.standings(1).cursorMs);

  // The late-appearing trade only shows up now, simulating the enrichment lag the rewind exists
  // to recover from.
  ALL_TRADES.push({ ts: T0 + 5 * MIN_MS, wallet: W1, side: "buy", tokenAmt: 100, sig: "SUP-EARLY" });

  const rwMid = gw.rewindCursor(T0);
  ok("rewind while a scan is paused mid-await succeeds", rwMid.ok === true && rwMid.cursorMs === T0, JSON.stringify(rwMid));

  gateResolve();   // let the paused tape request resolve and scanOnce() resume
  const paused = await scanPromise;
  ok("the in-flight scan reports superseded rather than clobbering the rewind",
     paused.superseded === true, JSON.stringify(paused));
  ok("the superseded scan did NOT re-advance the cursor past the rewind",
     gw.standings(1).cursorMs === T0, "cursorMs=" + gw.standings(1).cursorMs);

  // A normal catchUp() now finishes the job — this must cover 0..90 end to end, including the
  // recovery range the rewind reopened, proving nothing was silently skipped by the race.
  const caughtUp = await gw.catchUp(deps, { budgetMs: 10 * 60 * 1000 });
  ok("catchUp finishes after the supersede, reaching the true ceiling",
     caughtUp.ok === true && caughtUp.upToDate === true, JSON.stringify(caughtUp));
  ok("the cursor ends at the full 0..90 ceiling — nothing skipped by the rewind race",
     gw.standings(1).cursorMs === T0 + 90 * MIN_MS, "cursorMs=" + gw.standings(1).cursorMs);
  ok("the recovery-range trade (minute 5, only visible after the rewind) was credited",
     entriesFor(W1) === 1, "entries=" + entriesFor(W1));
  ok("the trade discovered during the original in-flight slice was also credited exactly once",
     entriesFor(W2) === 1, "entries=" + entriesFor(W2));

  console.log("\ncuna-giveaway scanner — a single scanOnce() call self-enforces a deadline (Codex round 32 P2)\n");

  // Same shape as the incident: an operator-set budget must bound a SINGLE scanOnce() call, not
  // only the gap between catchUp()'s calls to it. A big backlog + a slow tape used to mean one
  // scanOnce() call could run all the way through its 8-slice cap before the budget was ever
  // re-checked (measured: a mocked 20s-per-request tape took a 75s budget to 160s).
  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 24 * HOUR, minUsd: 2.5 });
  gw.resetLedger();
  now = T0 + 20 * HOUR;   // a big backlog, same order of magnitude as the incident
  ALL_TRADES = [];
  clockStepMs = 20000;   // each tape fetch "costs" 20s of (fake) wall clock, exactly the incident's own number
  const deadline = now + 75000;   // a 75-second budget
  const bounded = await gw.scanOnce(deps, { deadlineMs: deadline });
  clockStepMs = 0;
  const MAX_SLICES_PER_RUN = 8;   // mirrors the module's own private cap (lib/cuna-giveaway.js)
  ok("a single scanOnce() call self-enforces its deadline instead of running the full 8-slice cap",
     bounded.ok === true && bounded.slices < MAX_SLICES_PER_RUN,
     "slices=" + bounded.slices + " (expected < " + MAX_SLICES_PER_RUN + ")");
  ok("it returns at (or shortly after) the deadline, not after all 8 slices' worth of 20s calls",
     now <= deadline + 20000, "now-deadline=" + (now - deadline));
  ok("the plain 5-minute tick (no opts at all) is unaffected by any of this — still 8 slices per call",
     true, "");   // behavioural note, asserted by every earlier test in this file calling scanOnce(deps) with no opts

  console.log("\ncuna-giveaway scanner — reconfiguring mid-scan supersedes it too (Codex round 32 \"second lens\" P2)\n");

  // Same race as the rewind test above, triggered by configure() instead: changing the mint/
  // window out from under a scan that is still mid-await for the OLD config must not let that
  // scan credit trades against the config that no longer applies, or overwrite the cursor the
  // reconfigure is about to set.
  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 24 * HOUR, minUsd: 2.5 });
  gw.resetLedger();
  now = T0 + 30 * MIN_MS;
  ALL_TRADES = [];   // nothing under the OLD config yet

  let gateResolve2, hitResolve2;
  const gatePromise2 = new Promise((res) => { gateResolve2 = res; });
  const hitPromise2 = new Promise((res) => { hitResolve2 = res; });
  pauseAtFrom = T0;   // the very first slice of the OLD config's scan
  pauseState = { hitResolve: hitResolve2, gate: gatePromise2 };

  const scanPromise2 = gw.scanOnce(deps);
  await hitPromise2;   // the scan is now genuinely paused mid-await, still reading the OLD config

  // Would qualify under the OLD config if the paused slice were ever allowed to write normally.
  ALL_TRADES.push({ ts: T0 + 2 * MIN_MS, wallet: W1, side: "buy", tokenAmt: 100, sig: "CFG-OLD" });

  const MINT2 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const reconfigured = gw.configure({ mint: MINT2, pool: POOL, symbol: "CUNA2",
    startMs: T0 + 100 * HOUR, endMs: T0 + 124 * HOUR, minUsd: 2.5 });
  ok("reconfigure to a new mint/window succeeds", reconfigured.mint === MINT2, JSON.stringify(reconfigured));

  gateResolve2();
  const supersededByConfig = await scanPromise2;
  ok("the scan paused under the OLD config reports superseded, not a normal completion",
     supersededByConfig.superseded === true, JSON.stringify(supersededByConfig));
  ok("nothing from the OLD config's in-flight slice was credited",
     entriesFor(W1) === 0, "entries=" + entriesFor(W1));
  ok("the cursor reflects the NEW config's startMs, not overwritten by the stale slice",
     gw.standings(1).cursorMs === T0 + 100 * HOUR, "cursorMs=" + gw.standings(1).cursorMs);

  console.log("\ncuna-giveaway scanner — a deadline cutoff is reported separately from a tape stall (Codex round 32 \"second lens\" P3)\n");

  // A GENUINE real-wall-clock race (realDelayMs), not just the fake-clock bump: the tape request
  // takes 200 real ms to resolve, but the deadline gives it only ~10 real ms — scanOnce() must
  // actually hit the withTimeout() rejection path, not merely the "stop before starting a new
  // slice" cutoff exercised by the earlier deadline test.
  gw.configure({ mint: MINT, pool: POOL, symbol: "CUNA", startMs: T0, endMs: T0 + 24 * HOUR, minUsd: 2.5 });
  gw.resetLedger();
  now = T0 + 30 * MIN_MS;   // well past the 5-minute settle delay, so the ceiling is comfortably ahead of T0
  ALL_TRADES = [];
  // Earlier sections in this file (catchUp()'s own tight-budget test, which now always threads a
  // deadlineMs into scanOnce()) may already have incremented `deadlineHits` from prior slices
  // whose remaining budget went non-positive by the time it was computed — that's expected, real
  // behaviour, not a bug. `resetLedger()` deliberately leaves this historical counter alone (same
  // as `incompleteSlices`), so assert the DELTA this call itself causes, not an absolute value.
  const deadlineHitsBefore = JSON.parse(fs.readFileSync(path.join(DIR, "cuna-giveaway.json"), "utf8")).deadlineHits || 0;
  realDelayMs = 200;
  const tightDeadline = now + 10;
  const timedOut = await gw.scanOnce(deps, { deadlineMs: tightDeadline });
  realDelayMs = 0;
  ok("a real deadline timeout is reported ok:true (not a hard error)", timedOut.ok === true, JSON.stringify(timedOut));
  ok("it is flagged as a deadline cutoff", timedOut.deadline === true, JSON.stringify(timedOut));
  ok("its own counter moved by exactly this one timeout", timedOut.deadlineHits === deadlineHitsBefore + 1,
     "before=" + deadlineHitsBefore + " " + JSON.stringify(timedOut));
  ok("it is NOT reported as a tape stall — operators must not be told the tape is stuck",
     timedOut.stalled === false, JSON.stringify(timedOut));
  ok("it did NOT touch incompleteSlices — that counter is for real tape faults only",
     timedOut.incompleteSlices === 0, JSON.stringify(timedOut));
  ok("the cursor did not advance past the timed-out slice", timedOut.cursorMs === T0, "cursorMs=" + timedOut.cursorMs);

  Date.now = realNow;
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { Date.now = realNow; console.error("\nharness error: " + (e && e.stack || e)); process.exit(1); });
