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
ok("out-of-range sleeve starts the dwell (real rollGate)", dec.sleeves[1].inRange === false && dec.sleeves[1].action === "dwell");
ok("buyback disabled → none", dec.buyback && dec.buyback.action === "none" && /disabled/.test(dec.buyback.reason));
ok("assumptions are stated", Array.isArray(dec.assumptions) && dec.assumptions.length >= 2);
ok("no status → empty, no throw", d.deriveDecisions({ status: null, positions: null }).sleeves.length === 0);

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
