#!/usr/bin/env node
"use strict";
// lib/jvp-dashboard.js is the public data layer behind /liquidity-engine. Two things are
// pinned here offline: (1) sanitisation — a public response NEVER carries the operator pubkey,
// float balances, P&L, telegram ids or env names (the /vault wrapper injects `operator` into
// every body, found live 2026-09-10); (2) the decision replay uses the real pure gates and
// classifies price position correctly. Plus the slimming of the two free external feeds.
const d = require("../lib/jvp-dashboard.js");
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

console.log("\nJVP dashboard — sanitisation\n");
const rawStatus = {
  project: "cuna", enabled: true, operator: "5WUjHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxZRZQ", venue: "orca", paused: true, mode: "custom",
  config: { pair: "CUNA/USDC", feeTierPct: 0.01, widthPct: 1, solEnabled: true, solWidthPct: 1, jupEnabled: true, jupWidthPct: 1,
    maxActionsPerDay: 100000, minRebalanceIntervalSec: 1800, oorDwellSec: 300, baseDeployThresholdUsd: 25, usdcFloor: 0,
    telegramChatId: "-1001", operatorEnv: "MM_OPERATOR_SECRET_CUNA", buybackEnabled: false, swapEnabled: true,
    maxBuybackUsdPerCycle: 50, minBuybackUsd: 5, maxBuybacksPerDay: 12, buybackMinIntervalSec: 900, swapSolFloor: 0.4, solGasReserve: 0.35 },
  state: { lastTickTs: 1757000000000, lastRebalanceTs: 1756990000000, rebalanceCount: 412, dayActions: 3, lastPrice: 0.00001,
    evenLast: { ts: 1757000000000, action: "hold", reason: "balanced", pools: [{ secret: "x" }] } },
  float: { usdc: 123.45, sol: 1.2, jup: 30, clkn: 5000000 }, costs: { lifetime: { usd: 12 } }, earnings: { totalEarnedUsd: 40 }, netPnlUsd: 28,
  poolValues: { USDC: 100 }, totalDeployedUsd: 250.123,
};
const pub = d.sanitizeStatus(rawStatus);
const json = JSON.stringify(pub);
ok("operator pubkey never leaves", !json.includes("5WUjH"));
for (const k of ["float", "costs", "earnings", "netPnlUsd", "telegramChatId", "operatorEnv", "usdc", "poolValues"]) ok(`no '${k}' in public status`, !json.includes(`"${k}"`));
ok("profile keeps the published JVP knobs", pub.profile.widthPct === 1 && pub.profile.maxActionsPerDay === 100000 && pub.profile.solEnabled === true);
ok("paused/enabled/counters survive", pub.paused === true && pub.enabled === true && pub.rebalanceCount === 412 && pub.dayActions === 3);
ok("totalDeployedUsd rounded", pub.totalDeployedUsd === 250.12);
ok("evenLast keeps action+reason, drops pools", pub.evenLast.action === "hold" && !JSON.stringify(pub.evenLast).includes("secret"));

const rawPos = { enabled: true, totalUsd: 99.999, solUsd: 100, jupUsd: 0.3, positions: [
  { pair: "CUNA/USDC", quoteSymbol: "USDC", role: "base", positionMint: "MINT111", lower: 1, upper: 2, current: 1.5, clknAmount: 5, quoteAmount: 6, valueUsd: 10.554, inRange: true },
] };
const sp = d.sanitizePositions(rawPos);
ok("positions drop positionMint and amounts", !JSON.stringify(sp).includes("MINT111") && !JSON.stringify(sp).includes("clknAmount"));
ok("positions keep range and value", sp.positions[0].lower === 1 && sp.positions[0].valueUsd === 10.55 && sp.totalUsd === 100);
ok("null positions → empty", d.sanitizePositions(null).positions.length === 0);

console.log("\nJVP dashboard — decision replay on the real gates\n");
const dec = d.deriveDecisions({ status: rawStatus, positions: { ...rawPos, positions: [
  { pair: "CUNA/USDC", role: "base", lower: 1, upper: 2, current: 1.5, inRange: true },
  { pair: "CUNA/SOL", role: "sol", lower: 1, upper: 2, current: 2.5, inRange: false },
] }, nowMs: 1757000100000 });
ok("in-range sleeve reads frac 0.5", dec.sleeves[0].frac === 0.5 && dec.sleeves[0].inRange === true);
ok("out-of-range sleeve starts the dwell (roll spec)", dec.sleeves[1].inRange === false && dec.sleeves[1].action === "dwell" && dec.sleeves[1].reasonCode === "oor_dwell_started");
ok("buyback disabled → none, coded", dec.buyback && dec.buyback.action === "none" && dec.buyback.reasonCode === "buyback_disabled");
ok("labelled illustrative with assumptions", dec.illustrative === true && Array.isArray(dec.assumptions) && dec.assumptions.length >= 3);
ok("no status → empty, no throw", d.deriveDecisions({ status: null, positions: null }).sleeves.length === 0);
// The disclosure a second reviewer reproduced: 1,234 USDC float, $20 floor, 5,678 tokens at $2
// used to leak 1,214 and 11,356 through the decision panel. Now: buckets only, no numbers.
const leaky = d.deriveDecisions({ status: { ...rawStatus, config: { ...rawStatus.config, usdcFloor: 20, buybackEnabled: true }, state: { ...rawStatus.state, lastPrice: 2 }, float: { usdc: 1234, sol: 0, jup: 0, clkn: 5678 } },
  positions: { ...rawPos, positions: [{ pair: "CUNA/USDC", role: "base", lower: 1, upper: 2, current: 1.5, inRange: true }] } });
const leakJson = JSON.stringify(leaky);
ok("no inventory dollar values in the decision panel", !/1214|11356|stagedQuoteUsd|idleTokenUsd/.test(leakJson), leakJson.slice(0, 200));
ok("no raw reason strings (only codes)", !/"reason"/.test(leakJson) && /reasonCode/.test(leakJson));
ok("inputs are coarse buckets", ["none", "under_threshold", "at_threshold", "above_threshold"].includes(leaky.inputs.stagedQuote) && leaky.inputs.stagedQuote === "above_threshold");
ok("reasonCode maps the gates' strings", d.reasonCode("idle token ample ($123 staged ≥ $80) — buyback not needed") === "idle_token_ample" && d.reasonCode("buy with $12.00 of USDC") === "would_buy" && d.reasonCode("weird") === "other");

console.log("\nJVP dashboard — external feed slimming\n");
const jup = d.pickJupiter([{ id: "MINT", symbol: "CUNA", organicScore: 12.5, organicScoreLabel: "low", holderCount: 265, liquidity: 3123, mcap: 22577,
  stats24h: { buyVolume: 841.5, sellVolume: 2.84, buyOrganicVolume: 170.75, sellOrganicVolume: null, numBuys: 128, numSells: 1, numTraders: 14 } }], "MINT");
ok("organic split computed", jup.vol24h.total > 844 && jup.vol24h.organic === 170.75 && jup.vol24h.organicPct === 20.2);
ok("liq/mcap ratio", jup.liqToMcapPct === 13.83);
ok("unknown mint → null", d.pickJupiter([], "X") === null);
const gp = d.slimGeckoPool({ id: "solana_ADDR", attributes: { address: "ADDR", name: "CUNA / SOL", pool_fee_percentage: "0.01", reserve_in_usd: "0.17",
  volume_usd: { h1: "1.5", h6: "2", h24: "3.25" }, transactions: { h24: { buys: 2, sells: 1, buyers: 2, sellers: 1 } } } });
ok("gecko pool slimmed", gp.address === "ADDR" && gp.volumeUsd.h24 === 3.25 && gp.tx24h.buys === 2 && gp.feePct === 0.01);
const oh = d.slimOhlcv({ data: { attributes: { ohlcv_list: [[1757000000, 1, 2, 0.5, 1.5, 10], [1756996400, 1, 1, 1, 1, 5]] } } });
ok("ohlcv sorted oldest→newest with ms ts", oh.length === 2 && oh[0].t === 1756996400000 && oh[1].c === 1.5 && oh[1].v === 10);
const sl = d.slimLog([{ ts: 1, score: 3, holders: 10, liqUsd: 5, vol24h: 7, organicVol: 2, totalVol: 9 }, { score: 1 }]);
ok("organic log slimmed and entries without ts dropped", sl.length === 1 && sl[0].s === 3 && sl[0].h === 10 && sl[0].o === 2);

console.log("\nJVP dashboard — freshness and fleet state\n");
(async () => {
  d._resetCache();
  let calls = 0;
  const fn = async () => { calls++; if (calls === 1) return { score: 7 }; throw new Error("429"); };
  const a = await d.memo("t:x", 1, fn);            // ttl 1 ms so the next call refreshes
  await new Promise((r) => setTimeout(r, 5));
  const b = await d.memo("t:x", 1, fn);            // refresh fails → stale copy
  await new Promise((r) => setTimeout(r, 5));
  const c = await d.memo("t:x", 60000, fn);        // within ttl → must STILL say stale
  ok("first read is fresh", a && a.score === 7 && !a.stale);
  ok("failed refresh serves the old value marked stale", b && b.score === 7 && b.stale === true && typeof b.observedAt === "number");
  ok("the stale label survives the next cached read", c && c.score === 7 && c.stale === true && c.observedAt === b.observedAt, JSON.stringify(c));
  ok("unmatched mint → null, never another token's metrics", d.pickJupiter([{ id: "OTHER", symbol: "OTHER", stats24h: { buyVolume: 9 } }], "REQUESTED") === null);
  // A fleet whose every status read fails is UNKNOWN, not paused.
  const vault = { listProjects: () => ({ clkn: { id: "clkn", label: "CLKN", symbol: "CLKN", tokenMint: "M1" }, cuna: { id: "cuna", label: "CUNA", symbol: "CUNA", tokenMint: "M2" } }),
    status: async () => { throw new Error("rpc down"); }, publicPositions: async () => null, dislocation: async () => null };
  d._resetCache();
  const ov = await d.overview({ vault, kv: { get: () => [] }, clknMint: "M1" });
  ok("all status reads failed → fleetState unknown, not paused", ov.fleetState === "unknown" && ov.fleetPaused === false && ov.fleetCounts.unknown === 2, JSON.stringify({ s: ov.fleetState, c: ov.fleetCounts }));
  ok("owner stop order is shown as a separate historical fact", ov.ownerStopOrder && ov.ownerStopOrder.since === "2026-09-05");
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
