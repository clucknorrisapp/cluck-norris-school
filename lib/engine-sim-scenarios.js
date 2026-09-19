"use strict";
// Illustrative simulator scenarios for the public engine dashboard (W5, docs/COLOSSEUM_ROADMAP.md).
//
// These are a SMALL, DELIBERATELY DUPLICATED subset of the single-call scenarios already
// exercised in scripts/engine-sim-test.cjs — chosen because the dashboard needs one input ->
// one decision per named incident, and every entry below is a single call to the SAME pure
// gates that test drives (lib/engine-decisions.js), so the decision shown is always freshly
// recomputed, never a hardcoded string that could drift from the real logic.
//
// Why duplicated rather than shared: several of that test's scenarios (the decay-loop pacing
// check, the OOR-wick suppression check, the 5,000-tick fuzz) assert an AGGREGATE over many
// sequential calls — "rolls stay under N across 400 ticks" — which has no single input/output
// pair to show. Refactoring the test to import from here would mean either forcing those
// aggregate checks into a shape they don't have, or leaving them behind and quietly weakening
// the CI regression coverage. Neither is worth the risk to a green, unchanged test for a
// dashboard table. scripts/engine-sim-test.cjs does NOT import this file and is untouched.
//
// Incident dating: every scenario below reproduces a snapshot from the "2026-08-27/28" incident
// window named at the top of scripts/engine-sim-test.cjs and in the "owner, 2026-08-28" comments
// inside lib/engine-decisions.js — that is as precise as the record gets, so scenarios are dated
// to that window rather than inventing a false precision.
const { buybackDecision, rollGate } = require("./engine-decisions");

const INCIDENT_WINDOW = "2026-08-27/28";
// Baseline config mirroring the live DNC posture — same values as scripts/engine-sim-test.cjs's
// CFG, duplicated deliberately (see header comment above).
const CFG = {
  buybackEnabled: true, usdcFloor: 20, buybackReserveUsd: 0,
  maxBuybackUsdPerCycle: 50, minBuybackUsd: 5, maxBuybacksPerDay: 12, buybackMinIntervalSec: 900,
  swapSolFloor: 0.4, solGasReserve: 0.35, baseDeployThresholdUsd: 40,
  oorDwellSec: 300, minRebalanceIntervalSec: 1800, maxActionsPerDay: 36,
};
const PRICES = { solUsd: 110, jupUsd: 0.24 };
const DAY = "2026-08-28";

const SCENARIOS = [
  {
    id: "decay-loop-leftovers",
    name: "Decay loop — sub-threshold leftovers never roll",
    incidentWindow: INCIDENT_WINDOW,
    description: "A deploy leaves ~5% leftovers on both sides of a sleeve. Below the deploy threshold, the gate holds instead of rolling every tick.",
    inputs: { frac: 0.5, deployStagedUsd: 10, idlePairUsd: 10, dayActions: 0 },
    run: () => rollGate({ cfg: CFG, nowMs: 90_000, frac: 0.5, oorSince: null, sinceLastRollSec: 90, dayActions: 0, deployStagedUsd: 10, idlePairUsd: 10, widthOffPct: 0 }),
  },
  {
    id: "decay-loop-refill",
    name: "Decay loop — a genuine ≥2x refill bypasses pacing",
    incidentWindow: INCIDENT_WINDOW,
    description: "A fresh buyback leaves a refill worth at least 2x the deploy threshold on both sides — that is real, so it deploys immediately instead of waiting on the anti-thrash clock.",
    inputs: { frac: 0.5, deployStagedUsd: 100, idlePairUsd: 90, sinceLastRollSec: 60, dayActions: 5 },
    run: () => rollGate({ cfg: CFG, nowMs: 1_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 60, dayActions: 5, deployStagedUsd: 100, idlePairUsd: 90, widthOffPct: 0 }),
  },
  {
    id: "width-reconfig-urgent",
    name: "Width reconfig — an owner width change is urgent",
    incidentWindow: INCIDENT_WINDOW,
    description: "The owner changes a sleeve's configured width. That is treated as urgent — it rolls past the anti-thrash timer and the routine 1x day cap.",
    inputs: { widthOffPct: 0.3, dayActions: CFG.maxActionsPerDay },
    run: () => rollGate({ cfg: CFG, nowMs: 1_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 60, deployStagedUsd: 0, idlePairUsd: 0, dayActions: CFG.maxActionsPerDay, widthOffPct: 0.3 }),
  },
  {
    id: "width-reconfig-ceiling",
    name: "Width reconfig — still stops at the 2x emergency ceiling",
    incidentWindow: INCIDENT_WINDOW,
    description: "Even an urgent width reconfig has a hard stop: twice the routine daily action cap, never unbounded.",
    inputs: { widthOffPct: 0.3, dayActions: 2 * CFG.maxActionsPerDay },
    run: () => rollGate({ cfg: CFG, nowMs: 1_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 60, deployStagedUsd: 0, idlePairUsd: 0, dayActions: 2 * CFG.maxActionsPerDay, widthOffPct: 0.3 }),
  },
  {
    id: "oor-dwell-fix",
    name: "Out-of-range dwell — fixed the moment the dwell passes",
    incidentWindow: INCIDENT_WINDOW,
    description: "\"Out of range, wait 5 minutes, fix it\" (owner spec). A price wick that recrosses inside the dwell never rolls; sustained out-of-range rolls right after the dwell passes, bypassing the anti-thrash timer.",
    inputs: { frac: -0.1, oorSinceSecAgo: 360, sinceLastRollSec: 60, dayActions: 30 },
    run: () => rollGate({ cfg: CFG, nowMs: 450_000, frac: -0.1, oorSince: 90_000, sinceLastRollSec: 60, dayActions: 30, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 }),
  },
  {
    id: "day-cap-routine",
    name: "Day cap — a routine roll stops at the 1x ceiling",
    incidentWindow: INCIDENT_WINDOW,
    description: "A non-urgent roll (a routine deploy, not an emergency) is capped once the day's action count hits the configured maximum.",
    inputs: { frac: 0.5, deployStagedUsd: 60, idlePairUsd: 60, dayActions: CFG.maxActionsPerDay },
    run: () => rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 9999, dayActions: CFG.maxActionsPerDay, deployStagedUsd: 60, idlePairUsd: 60, widthOffPct: 0 }),
  },
  {
    id: "day-cap-emergency-admit",
    name: "Day cap — an out-of-range fix is admitted under the 2x emergency ceiling",
    incidentWindow: INCIDENT_WINDOW,
    description: "Urgent rolls (out-of-range past its dwell, a meaningful refill, a width reconfig) get a bounded 2x emergency ceiling instead of the routine 1x freeze.",
    inputs: { frac: 1.5, oorSinceSecAgo: 1000, dayActions: CFG.maxActionsPerDay },
    run: () => rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 1.5, oorSince: 9_000_000, sinceLastRollSec: 9999, dayActions: CFG.maxActionsPerDay, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 }),
  },
  {
    id: "buyback-usdc-dry-spends-sol",
    name: "Buyback — \"the stall\": USDC dry, spends free SOL instead",
    incidentWindow: INCIDENT_WINDOW,
    description: "Multi-quote buyback (owner, 2026-08-28): when USDC is under its floor, the gate reaches for free SOL above both gas guards rather than stalling.",
    inputs: { usdc: 23, sol: 2.0, jup: 100 },
    run: () => buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 23, sol: 2.0, jup: 100, clkn: 100 }, prices: PRICES, nowMs: 10_000_000, todayStamp: DAY }),
  },
  {
    id: "buyback-drain-loop-ample-idle",
    name: "Buyback drain loop — ample idle token skips the buy",
    incidentWindow: INCIDENT_WINDOW,
    description: "Live incident, 2026-08-28 evening: with floors near zero, the buyback converted every idle quote dollar to the project token each cycle and a pool bled $325→$183 in 40 minutes. Fix: skip the buyback while idle token is already ample — a deploy consumes it and the gate reopens on its own.",
    inputs: { usdc: 600, sol: 2, jup: 2000, clkn: 800_000 },
    run: () => buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 600, sol: 2, jup: 2000, clkn: 800_000 }, prices: PRICES, nowMs: 99_999_999, todayStamp: DAY }),
  },
];

// Public, read-only: recomputes every decision from the real pure gates on each call (cheap —
// no I/O) so the numbers shown can never fall out of step with lib/engine-decisions.js.
function list() {
  return SCENARIOS.map((s) => {
    let decision;
    try { decision = s.run(); } catch (e) { decision = { action: "error", reason: String(e.message || e).slice(0, 120) }; }
    return { id: s.id, name: s.name, incidentWindow: s.incidentWindow, description: s.description, inputs: s.inputs, decision };
  });
}

module.exports = { list };
