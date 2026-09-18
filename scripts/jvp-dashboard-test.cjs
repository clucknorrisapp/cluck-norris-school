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
  // The assembled response keeps freshness: a paused status read once, then a failed refresh, must
  // still say "paused" AND "stale" with the original observation time — through sanitisation.
  d._resetCache();
  let n = 0;
  const flaky = { listProjects: () => ({ cuna: { id: "cuna", label: "CUNA", symbol: "CUNA", tokenMint: "M2" } }),
    status: async () => { n++; if (n === 1) return { project: "cuna", enabled: true, paused: true, config: {}, state: {} }; throw new Error("rpc down"); },
    publicPositions: async () => ({ enabled: true, positions: [], totalUsd: 0 }), dislocation: async () => ({ pools: [] }) };
  const first = await d.projectSnapshot({ vault: flaky, kv: { get: () => [] }, id: "cuna", project: flaky.listProjects().cuna, clknMint: "M1" });
  ok("first snapshot: paused, fresh", first.status.paused === true && first.status.freshness.state === "fresh" && typeof first.status.freshness.observedAt === "number");
  // force the memo past its ttl so the next snapshot refreshes and fails
  d._expireForTests && d._expireForTests();
  const second = await d.projectSnapshot({ vault: flaky, kv: { get: () => [] }, id: "cuna", project: flaky.listProjects().cuna, clknMint: "M1" });
  ok("second snapshot: still paused, marked stale with the original observation time", second.status && second.status.paused === true && second.status.freshness.state === "stale" && second.status.freshness.observedAt === first.status.freshness.observedAt, JSON.stringify(second.status && second.status.freshness));
  ok("project-level freshness names the stale status (market for a fake mint is unavailable, so the summary is partial)", second.freshness && second.freshness.status.state === "stale" && ["stale", "partial"].includes(second.freshness.summary), JSON.stringify(second.freshness));
  d._resetCache();
  let m = 0;
  const flaky2 = { ...flaky, status: async () => { m++; if (m === 1) return { project: "cuna", enabled: true, paused: true, config: {}, state: {} }; throw new Error("rpc down"); } };
  const ov2 = await d.overview({ vault: flaky2, kv: { get: () => [] }, clknMint: "M1" });
  d._expireForTests();
  const ov3 = await d.overview({ vault: flaky2, kv: { get: () => [] }, clknMint: "M1" });
  ok("fleet aggregate carries staleness", ov3.fleetState === "paused" && ov3.fleetFreshness.state === "stale" && ov3.fleetFreshness.staleStatuses === 1 && ov3.fleetFreshness.oldestObservedAt === ov2.fleetFreshness.oldestObservedAt, JSON.stringify(ov3.fleetFreshness));

  console.log("\nW5 — retained decision events: the ring buffer, and the paused no-op exclusion\n");
  {
    // lib/whirlpool-vault.js's recordDecision is the ONE choke point that writes engineLog:<id>
    // (wired from the module.exports `tick` wrapper). It uses the real, shared kvstore, so this
    // test scopes itself to a clearly test-only project id and restores whatever was there.
    const vault = require("../lib/whirlpool-vault.js");
    const kvReal = require("../lib/kvstore.js");
    const TESTKEY = "engineLog:__w5test__";
    const prior = kvReal.get(TESTKEY, undefined);
    try {
      kvReal.set(TESTKEY, []);
      for (let i = 0; i < 250; i++) vault.recordDecision("__w5test__", { action: "roll", reason: "test " + i, price: 1 });
      const log = kvReal.get(TESTKEY, []);
      ok("ring buffer is bounded at 200 entries", log.length === 200, "len=" + log.length);
      ok("the buffer keeps the newest entries, not the oldest", log[log.length - 1].reason === "test 249" && log[0].reason === "test 50");

      kvReal.set(TESTKEY, []);
      vault.recordDecision("__w5test__", { action: "none", reason: "paused" });
      ok("a paused no-op tick is never recorded", kvReal.get(TESTKEY, []).length === 0);
      vault.recordDecision("__w5test__", { action: "roll", reason: "deploying staged", price: 0.00035, operator: "SHOULD-NOT-APPEAR", floatUsdc: 999999 });
      const rec = kvReal.get(TESTKEY, [])[0];
      ok("a real decision is recorded as {t,action,reason,price} only — nothing else passed through", rec && rec.action === "roll" && rec.reason === "deploying staged" && rec.price === 0.00035 && typeof rec.t === "number" && !("operator" in rec) && !("floatUsdc" in rec), JSON.stringify(rec));
    } finally {
      kvReal.set(TESTKEY, prior === undefined ? [] : prior); // leave the store as found (or a harmless empty ring)
    }
  }

  console.log("\nW5 — decisionLog(): the paused-vs-empty note, and row shape\n");
  {
    const emptyKv = { get: (k, d) => (k === "engineLog:cuna" ? [] : d) };
    const paused = d.decisionLog(emptyKv, "cuna", true);
    ok("empty log + paused → retained 0, names the pause", paused.retained === 0 && paused.rows.length === 0 && /engine is paused/.test(paused.note));
    const notPaused = d.decisionLog(emptyKv, "cuna", false);
    ok("empty log + not paused → the generic missing-data note, not the pause note", notPaused.retained === 0 && /no data retained/.test(notPaused.note) && !/paused/.test(notPaused.note));
    const withRows = { get: (k, d) => (k === "engineLog:cuna" ? [{ t: 1700000000000, action: "roll", reason: "x", price: 2 }, { score: 1 }, { t: 2 }] : d) };
    const dl = d.decisionLog(withRows, "cuna", true);
    ok("rows missing t/action are dropped; a real row survives", dl.retained === 1 && dl.rows[0].action === "roll" && dl.rows[0].price === 2);
  }

  console.log("\nW5 — historical transfers: sanitized shape, no wallet addresses, symbol resolution\n");
  {
    const project = { tokenMint: "PROJECTMINT111", symbol: "CUNA" };
    ok("known quote mint resolves to its symbol", d.symbolForMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", project) === "USDC");
    ok("the project's own mint resolves to its own symbol", d.symbolForMint("PROJECTMINT111", project) === "CUNA");
    ok("an unrecognized mint reads as TOKEN, never the mint address itself", d.symbolForMint("SOMERANDOMMINT999", project) === "TOKEN");
    const txs = [
      { signature: "SIGOUT1", timestamp: 1700000000, nativeTransfers: [{ amount: 2_000_000_000, fromUserAccount: "OPWALLET", toUserAccount: "COUNTERPARTYA" }], tokenTransfers: [] },
      { signature: "SIGIN1", timestamp: 1700000100, nativeTransfers: [], tokenTransfers: [{ tokenAmount: 100, mint: "PROJECTMINT111", fromUserAccount: "COUNTERPARTYB", toUserAccount: "OPWALLET" }] },
      { signature: "SIGZERO", timestamp: 1700000200, nativeTransfers: [{ amount: 0, fromUserAccount: "OPWALLET", toUserAccount: "COUNTERPARTYC" }], tokenTransfers: [] },
    ];
    const rows = d.slimTransfers(txs, "OPWALLET", project);
    const rowsJson = JSON.stringify(rows);
    ok("no wallet address (ours or a counterparty's) reaches the row shape", !rowsJson.includes("OPWALLET") && !rowsJson.includes("COUNTERPARTYA") && !rowsJson.includes("COUNTERPARTYB"));
    ok("zero-amount transfers are dropped", rows.length === 2);
    ok("direction, symbol, amount, signature computed for both legs", rows.some((r) => r.direction === "out" && r.symbol === "SOL" && r.amount === 2 && r.signature === "SIGOUT1") && rows.some((r) => r.direction === "in" && r.symbol === "CUNA" && r.amount === 100 && r.signature === "SIGIN1"));
    ok("rows come back newest-first", rows[0].signature === "SIGIN1");
  }

  console.log("\nW5 — operatorHistory(): 15-min cache, serve-last-good stale on a failed refresh\n");
  d._resetCache();
  {
    let calls = 0;
    const fakeVault = { operatorPubkey: () => "OPWALLET2" };
    const project = { tokenMint: "M", symbol: "X" };
    const fakeHelius = { fetchAddressHistory: async () => { calls++; if (calls === 1) return [{ signature: "S1", timestamp: 1700000000, nativeTransfers: [{ amount: 1_000_000_000, fromUserAccount: "OTHERPARTY", toUserAccount: "OPWALLET2" }] }]; throw new Error("429"); } };
    const first = await d.operatorHistory({ helius: fakeHelius, vault: fakeVault, id: "cuna-xfer-test", project });
    ok("first fetch succeeds, one sanitized row, not stale", first && first.rows.length === 1 && !first.stale);
    d._expireForTests();
    const second = await d.operatorHistory({ helius: fakeHelius, vault: fakeVault, id: "cuna-xfer-test", project });
    ok("a failed refresh serves the last-good transfers, flagged stale", second && second.rows.length === 1 && second.stale === true);
    const noHelius = await d.operatorHistory({ helius: null, vault: fakeVault, id: "cuna-xfer-test", project });
    ok("no helius dependency injected → unavailable, never throws", noHelius === null);
    const noWallet = await d.operatorHistory({ helius: fakeHelius, vault: { operatorPubkey: () => null }, id: "cuna-xfer-test", project });
    ok("no operator key configured for the project → unavailable, never throws", noWallet === null);
  }

  console.log("\nW5 — earningsSuspect(): the honesty flag, never the poisoned number\n");
  {
    const suspectVault = { earnings: async () => ({ totalEarnedUsd: 123456, realized: { usd: 99999 }, realizedSuspect: ["realizedFeeUsdc=1e30"] }) };
    const cleanVault = { earnings: async () => ({ totalEarnedUsd: 12, realized: { usd: 5 } }) };
    d._resetCache();
    const flagOn = await d.earningsSuspect({ vault: suspectVault, id: "rose-earn-test" });
    ok("a discarded counter surfaces as a plain boolean", flagOn === true);
    d._resetCache();
    const flagOff = await d.earningsSuspect({ vault: cleanVault, id: "rose-earn-test2" });
    ok("a healthy counter reports false", flagOff === false);
    const noVault = await d.earningsSuspect({ vault: {}, id: "x" });
    ok("no earnings() on the vault → false, never throws", noVault === false);
  }

  console.log("\nW5 — projectDetail assembly: all three evidence classes, still sanitized\n");
  d._resetCache();
  {
    const fakeVault = {
      listProjects: () => ({ rose: { id: "rose", label: "ROSE", symbol: "ROSE", tokenMint: "MROSE", venue: "orca" } }),
      status: async () => ({ project: "rose", enabled: true, paused: true, config: {}, state: {} }),
      publicPositions: async () => ({ positions: [], totalUsd: 0 }),
      dislocation: async () => ({ pools: [] }),
      operatorPubkey: () => "OPWALLETROSE",
      earnings: async () => ({ totalEarnedUsd: 123456, realized: { usd: 99999 }, realizedSuspect: ["realizedFeeUsdc=1e30"] }),
    };
    const fakeHelius = { fetchAddressHistory: async () => [{ signature: "SIGX", timestamp: 1700000000, nativeTransfers: [{ amount: 5_000_000_000, fromUserAccount: "SOMECOUNTERPARTY", toUserAccount: "OPWALLETROSE" }] }] };
    const kvFake = { get: (k, def) => (k === "engineLog:rose" ? [] : def) };
    const detail = await d.projectDetail({ vault: fakeVault, kv: kvFake, clknMint: "MCLKN", id: "rose", hours: 168, helius: fakeHelius });
    const json = JSON.stringify(detail);
    ok("transfers: available, sanitized, no wallet address", detail.transfers.available === true && detail.transfers.rows.length === 1 && !json.includes("OPWALLETROSE") && !json.includes("SOMECOUNTERPARTY"));
    ok("decision log: empty + paused → the pause note", detail.decisionLog.retained === 0 && /engine is paused/.test(detail.decisionLog.note));
    ok("earnings suspect flag surfaces, poisoned figures never do", detail.earningsSuspect === true && !json.includes("123456") && !json.includes("99999") && !json.includes("realizedFeeUsdc"));
    ok("illustrative simulator scenarios attached and freshly computed", Array.isArray(detail.simulatorScenarios) && detail.simulatorScenarios.length >= 5 && detail.simulatorScenarios.every((s) => s.decision && s.decision.action));
    const missing = await d.projectDetail({ vault: fakeVault, kv: kvFake, clknMint: "MCLKN", id: "rose", hours: 168, helius: null });
    ok("no helius dependency → transfers unavailable, not a fake row", missing.transfers.available === false && missing.transfers.rows.length === 0);
  }

  console.log("\nX5 — replayDecisions(): the real gates, matching by construction, honest about the ceiling\n");
  {
    const engineSimScenarios = require("../lib/engine-sim-scenarios.js");
    // Same CFG values engine-sim-scenarios.js documents as "mirroring the live DNC posture" —
    // duplicated deliberately (that file's own header explains why), so this test can build a
    // FULLY-SPECIFIED input row for the "decay-loop-leftovers" scenario and expect a match.
    const CFG = { buybackEnabled: true, usdcFloor: 20, buybackReserveUsd: 0, maxBuybackUsdPerCycle: 50, minBuybackUsd: 5, maxBuybacksPerDay: 12,
      buybackMinIntervalSec: 900, swapSolFloor: 0.4, solGasReserve: 0.35, baseDeployThresholdUsd: 40, oorDwellSec: 300, minRebalanceIntervalSec: 1800, maxActionsPerDay: 36 };
    const scenario = engineSimScenarios.list().find((s) => s.id === "decay-loop-leftovers");
    ok("the scenario exists in lib/engine-sim-scenarios.js", !!scenario && scenario.decision && scenario.decision.action === "hold");
    const fullRow = { t: Date.now(), action: scenario.decision.action, reason: scenario.decision.reason, price: null,
      gate: "rollGate", cfg: CFG, nowMs: 90_000, frac: 0.5, oorSince: null, sinceLastRollSec: 90, dayActions: 0, deployStagedUsd: 10, idlePairUsd: 10, widthOffPct: 0 };
    const [replayedFull] = d.replayDecisions([fullRow]);
    ok("a row with the full input set replays the SAME gate and matches by construction",
      replayedFull.gate === "rollGate" && replayedFull.replayed && replayedFull.replayed.action === "hold" && replayedFull.matches === true, JSON.stringify(replayedFull));

    // The real production shape — {t,action,reason,price} only (recordDecision's allow-list) —
    // never carries enough to replay. This is the honest common case, not an edge case.
    const thinRow = { t: Date.now(), action: "roll", reason: "deploying staged", price: 0.00035 };
    const [replayedThin] = d.replayDecisions([thinRow]);
    ok("a real (thin) retained row can never be replayed — inputs not retained, no fabricated match",
      replayedThin.replayed === null && replayedThin.note === "inputs not retained" && replayedThin.matches === undefined, JSON.stringify(replayedThin));

    // A buyback-shaped full row also replays correctly (both gates are covered, not just rollGate).
    const buybackRow = { t: Date.now(), action: "none", reason: "no spendable quote", gate: "buybackDecision",
      cfg: CFG, st: { paused: false, lastPrice: 0.0001, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: "2026-08-28" },
      float: { usdc: 0, sol: 0, jup: 0, clkn: 0 }, prices: null, nowMs: 10_000_000, todayStamp: "2026-08-28" };
    const [replayedBB] = d.replayDecisions([buybackRow]);
    ok("buybackDecision replays too, not only rollGate", replayedBB.gate === "buybackDecision" && replayedBB.matches === true, JSON.stringify(replayedBB));
  }

  console.log("\nX5 — timeline(): the merged array, class counts, the hours window, and no forbidden fields\n");
  d._resetCache();
  {
    const now = Date.now();
    const fakeVault = {
      listProjects: () => ({ dnc: { id: "dnc", label: "DNC", symbol: "DNC", tokenMint: "MDNC", venue: "orca" } }),
      status: async () => ({ project: "dnc", enabled: true, paused: false, config: {}, state: {} }),
      operatorPubkey: () => "OPWALLETDNC",
    };
    const fakeHelius = { fetchAddressHistory: async () => [
      { signature: "SIGRECENT", timestamp: Math.floor((now - 3600_000) / 1000), nativeTransfers: [{ amount: 1_000_000_000, fromUserAccount: "X", toUserAccount: "OPWALLETDNC" }], tokenTransfers: [] },
      { signature: "SIGOLD", timestamp: Math.floor((now - 200 * 3600_000) / 1000), nativeTransfers: [{ amount: 2_000_000_000, fromUserAccount: "Y", toUserAccount: "OPWALLETDNC" }], tokenTransfers: [] },
    ] };
    const decisionRows = [{ t: now - 7200_000, action: "roll", reason: "deploying staged", price: 0.002 }];
    const kvFake = { get: (k, def) => (k === "engineLog:dnc" ? decisionRows : def) };
    const tl = await d.timeline({ vault: fakeVault, kv: kvFake, clknMint: "MCLKN", id: "dnc", hours: 168, helius: fakeHelius });
    const tlJson = JSON.stringify(tl);
    ok("timeline() assembles all three classes", !!tl && Array.isArray(tl.rows) && tl.rows.length > 0, tlJson.slice(0, 200));
    ok("newest-first: the transfer (1h ago) leads the decision (2h ago)", tl.rows[0].cls === "transfer" && tl.rows[1].cls === "decision");
    ok("class counts reflect the merge", tl.classes.transfer === 1 && tl.classes.decision === 1 && tl.classes.illustrative >= 5, JSON.stringify(tl.classes));
    ok("the 200h-old transfer is outside the 168h window and dropped", !tl.rows.some((r) => r.cls === "transfer" && r.signature === "SIGOLD"));
    ok("every illustrative row keeps the exact replay label", tl.rows.filter((r) => r.cls === "illustrative").every((r) => r.label === "illustrative — replayed from a recorded incident, not live"));
    ok("the retained decision row carries a replay verdict (honestly null — thin production shape)", tl.rows[1].replayed === null && tl.rows[1].note === "inputs not retained");
    ok("no wallet address reaches a timeline row", !tlJson.includes("OPWALLETDNC"));
    for (const field of ["operator", "floatUsdc", "pnl"]) ok(`no forbidden field '${field}' in any timeline row`, !new RegExp(`"${field}"`).test(tlJson));

    // Cap: 350 retained rows, all more recent than every illustrative incident date (2026-08-27/28)
    // → the top 300 by time are exactly the 300 newest decisions; the older illustrative rows and
    // the tail of the decision log are the ones cut, proving the cap operates on the MERGED order.
    const manyRows = Array.from({ length: 350 }, (_, i) => ({ t: now - i * 1000, action: "hold", reason: "in range", price: 1 }));
    const kvMany = { get: (k, def) => (k === "engineLog:dnc" ? manyRows : def) };
    d._resetCache();
    const tlCap = await d.timeline({ vault: fakeVault, kv: kvMany, clknMint: "MCLKN", id: "dnc", hours: 720, helius: null });
    ok("capped at 300", tlCap.rows.length === 300, "len=" + tlCap.rows.length);
    ok("the cap dropped the oldest (illustrative) rows first, in time order", tlCap.classes.decision === 300 && tlCap.classes.illustrative === 0, JSON.stringify(tlCap.classes));

    const missingProject = await d.timeline({ vault: fakeVault, kv: kvFake, clknMint: "MCLKN", id: "nope", hours: 168, helius: null });
    ok("unknown project id → null, not a throw", missingProject === null);
  }

  console.log("\nengine-sim-test.cjs is untouched by any of this\n");
  {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath, [require("path").join(__dirname, "engine-sim-test.cjs")], { encoding: "utf8" });
    ok("scripts/engine-sim-test.cjs still passes unchanged", r.status === 0, (r.stdout || "").slice(-400) + (r.stderr || "").slice(-400));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
