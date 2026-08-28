// Engine decision simulator — replays thousands of ticks against the REAL production gate
// logic in lib/engine-decisions.js (zero deps, runs in the dependency-free CI job). Every
// scenario here is a regression that actually happened live on 2026-08-27/28, plus a fuzz
// that pins the global invariants. If a behavior change breaks a scenario, that is the
// simulator doing its job: change the spec test AND the code together, deliberately.
//
// Run: node scripts/engine-sim-test.cjs   (exit 0 = pass, 1 = fail)
const { buybackDecision, rollGate } = require("../lib/engine-decisions.js");

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

// Baseline config mirroring the live DNC posture (values from the deploy ratchet + defaults).
const CFG = {
  buybackEnabled: true, usdcFloor: 20, buybackReserveUsd: 0,
  maxBuybackUsdPerCycle: 50, minBuybackUsd: 5, maxBuybacksPerDay: 12, buybackMinIntervalSec: 900,
  swapSolFloor: 0.4, solGasReserve: 0.35, baseDeployThresholdUsd: 40,
  oorDwellSec: 300, minRebalanceIntervalSec: 1800, maxActionsPerDay: 36,
};
const PRICES = { solUsd: 110, jupUsd: 0.24 };
const TICK_MS = 90_000;
const DAY = "2026-08-28";

// ── Scenario 1: THE DECAY LOOP (live incident, ~30 wasted rolls in 20 min) ──────
// A deploy leaves ~5% leftovers on both sides. Leftovers above the bare threshold with
// pacing bypassed = roll every tick. The fix: only refills ≥2× threshold skip pacing.
{
  // Leftovers from a $200-per-side deploy: ~$10 staged + ~$10 pair — under threshold, never rolls.
  let rolls = 0, now = 0, lastRoll = 0;
  for (let t = 0; t < 200; t++) {
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 0.5, oorSince: null, sinceLastRollSec: (now - lastRoll) / 1000, dayActions: rolls, deployStagedUsd: 10, idlePairUsd: 10, widthOffPct: 0 });
    if (g.action === "roll") { rolls++; lastRoll = now; }
  }
  check("decay-loop: 5% leftovers never trigger a roll", rolls === 0, `${rolls} rolls`);

  // Leftovers between 1× and 2× threshold: allowed to deploy, but PACED — max 1 per interval.
  rolls = 0; now = 0; lastRoll = -CFG.minRebalanceIntervalSec * 1000;
  for (let t = 0; t < 400; t++) { // 10 hours of ticks
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 0.5, oorSince: null, sinceLastRollSec: (now - lastRoll) / 1000, dayActions: rolls, deployStagedUsd: 60, idlePairUsd: 60, widthOffPct: 0 });
    if (g.action === "roll") { rolls++; lastRoll = now; }
  }
  const maxPaced = Math.ceil((400 * TICK_MS) / (CFG.minRebalanceIntervalSec * 1000)) + 1;
  check("decay-loop: dribble refills are paced by anti-thrash", rolls <= maxPaced, `${rolls} rolls > ${maxPaced}`);

  // A genuine ≥2× refill (fresh buyback) deploys immediately despite the clock.
  const g = rollGate({ cfg: CFG, nowMs: 1_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 60, dayActions: 5, deployStagedUsd: 100, idlePairUsd: 90, widthOffPct: 0 });
  check("meaningful refill (≥2×) bypasses pacing", g.action === "roll" && g.urgent === true, g.action);
}

// ── Scenario 2: OOR DWELL — "out of range, wait 5 mins, fix it" ─────────────────
{
  // A wick that recrosses inside the dwell never rolls.
  let now = 0, oorSince = null, rolled = false;
  for (let t = 0; t < 3; t++) { // 3 ticks OOR = 270s < 300s dwell
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: 1.2, oorSince, sinceLastRollSec: 9999, dayActions: 0, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
    oorSince = g.oorSinceNext; if (g.action === "roll") rolled = true;
  }
  // back in range
  const back = rollGate({ cfg: CFG, nowMs: now + TICK_MS, frac: 0.5, oorSince, sinceLastRollSec: 9999, dayActions: 0, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("OOR wick inside dwell never rolls", !rolled && back.action === "hold" && back.oorSinceNext === null, `rolled=${rolled}`);

  // Sustained OOR rolls exactly once the dwell passes — even 60s after a previous roll.
  now = 0; oorSince = null; let rollAt = null;
  for (let t = 0; t < 10; t++) {
    now += TICK_MS;
    const g = rollGate({ cfg: CFG, nowMs: now, frac: -0.1, oorSince, sinceLastRollSec: 60, dayActions: 30, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
    oorSince = g.oorSinceNext;
    if (g.action === "roll") { rollAt = now; break; }
  }
  check("sustained OOR fixes right after dwell, bypassing anti-thrash", rollAt !== null && (rollAt - TICK_MS) / 1000 >= CFG.oorDwellSec, `rollAt=${rollAt}`);
}

// ── Scenario 3: day-cap emergency ceiling ───────────────────────────────────────
{
  const routine = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 0.5, oorSince: null, sinceLastRollSec: 9999, dayActions: 36, deployStagedUsd: 60, idlePairUsd: 60, widthOffPct: 0 });
  check("routine roll stops at 1× day cap", routine.action === "capped", routine.action);
  const urgent = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 1.5, oorSince: 9_000_000, sinceLastRollSec: 9999, dayActions: 36, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("OOR fix admitted under 2× emergency ceiling", urgent.action === "roll", urgent.action);
  const beyond = rollGate({ cfg: CFG, nowMs: 10_000_000, frac: 1.5, oorSince: 9_000_000, sinceLastRollSec: 9999, dayActions: 72, deployStagedUsd: 0, idlePairUsd: 0, widthOffPct: 0 });
  check("nothing passes 2× ceiling", beyond.action === "capped", beyond.action);
}

// ── Scenario 4: buyback — demand override + multi-quote + caps (live incidents) ──
{
  // Starved (no idle token, staged quote) fires immediately inside the interval.
  const starved = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 1_000_000, buybacksToday: 2, buybackDayStamp: DAY }, float: { usdc: 600, sol: 1, jup: 100, clkn: 100 }, prices: PRICES, nowMs: 1_000_000 + 120_000, todayStamp: DAY });
  check("starved buyback fires inside the interval", starved.action === "buy" && starved.starved === true, starved.action);

  // A fresh unspent buyback (idle token now large) defers until deployed + stripped.
  const fresh = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 1_000_000, buybacksToday: 3, buybackDayStamp: DAY }, float: { usdc: 600, sol: 1, jup: 100, clkn: 150_000 }, prices: PRICES, nowMs: 1_000_000 + 120_000, todayStamp: DAY });
  check("unspent buyback kills the demand signal", fresh.action === "deferred", fresh.action);

  // THE STALL (live incident): USDC under floor+min, free SOL available → buys with SOL.
  const solBuy = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 23, sol: 2.0, jup: 100, clkn: 100 }, prices: PRICES, nowMs: 10_000_000, todayStamp: DAY });
  check("multi-quote: USDC dry → spends free SOL", solBuy.action === "buy" && solBuy.fromSym === "SOL", `${solBuy.action}/${solBuy.fromSym}`);
  check("SOL spend respects BOTH gas guards", solBuy.spendUi <= 2.0 - CFG.swapSolFloor - CFG.solGasReserve + 1e-9, String(solBuy.spendUi));

  // USDC and SOL dry → JUP above dust reserve.
  const jupBuy = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 22, sol: 0.7, jup: 1900, clkn: 0 }, prices: PRICES, nowMs: 10_000_000, todayStamp: DAY });
  check("multi-quote: SOL under guards → spends JUP", jupBuy.action === "buy" && jupBuy.fromSym === "JUP", `${jupBuy.action}/${jupBuy.fromSym}`);
  check("JUP spend leaves the dust reserve", jupBuy.spendUi <= 1900 - 50 + 1e-9, String(jupBuy.spendUi));
  check("per-cycle USD cap holds on non-USDC quotes", jupBuy.spendUsd <= CFG.maxBuybackUsdPerCycle + 1e-9, String(jupBuy.spendUsd));

  // Price feed down → USDC-only (never guesses units).
  const noPx = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY }, float: { usdc: 22, sol: 5, jup: 5000, clkn: 0 }, prices: null, nowMs: 10_000_000, todayStamp: DAY });
  check("price feed down degrades to USDC-only", noPx.action === "none", noPx.action);

  // Day cap is absolute.
  const capped = buybackDecision({ cfg: CFG, st: { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 12, buybackDayStamp: DAY }, float: { usdc: 600, sol: 2, jup: 2000, clkn: 0 }, prices: PRICES, nowMs: 99_999_999, todayStamp: DAY });
  check("daily buyback cap is absolute", capped.action === "capped", capped.action);
}

// ── Scenario 5: fuzz — 5,000 random ticks, global invariants ────────────────────
// Random walk of balances/price; assert bounded behavior no matter the sequence:
// buyback spend/day ≤ cap×perCycle, spends never breach floors/guards, rolls/day ≤ 2× cap.
{
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let now = 0, st = { lastPrice: 0.00035, lastBuybackTs: 0, buybacksToday: 0, buybackDayStamp: DAY, paused: false };
  let float = { usdc: 400, sol: 2, jup: 1500, clkn: 50_000 };
  let spentToday = 0, buys = 0, violations = [];
  let rollState = { oorSince: null, lastRoll: 0, dayActions: 0 };
  for (let t = 0; t < 5000; t++) {
    now += TICK_MS;
    // market noise
    float.usdc = Math.max(0, float.usdc + (rnd() - 0.5) * 30);
    float.clkn = Math.max(0, float.clkn + (rnd() - 0.5) * 100_000);
    float.sol = Math.max(0, float.sol + (rnd() - 0.5) * 0.2);
    float.jup = Math.max(0, float.jup + (rnd() - 0.5) * 100);
    const d = buybackDecision({ cfg: CFG, st, float, prices: PRICES, nowMs: now, todayStamp: DAY });
    if (d.action === "buy") {
      buys++; spentToday += d.spendUsd;
      if (d.spendUsd > CFG.maxBuybackUsdPerCycle + 1e-6) violations.push(`cycle overspend ${d.spendUsd}`);
      if (d.fromSym === "USDC" && float.usdc - d.spendUi < CFG.usdcFloor - 1e-6) violations.push("usdcFloor breach");
      if (d.fromSym === "SOL" && float.sol - d.spendUi < CFG.swapSolFloor + CFG.solGasReserve - 1e-6) violations.push("gas guard breach");
      float[d.fromSym === "USDC" ? "usdc" : d.fromSym === "SOL" ? "sol" : "jup"] -= d.spendUi;
      float.clkn += d.spendUsd / st.lastPrice;
      st = { ...st, lastBuybackTs: now, buybacksToday: (st.buybackDayStamp === DAY ? st.buybacksToday : 0) + 1, buybackDayStamp: DAY };
    }
    const frac = rnd() < 0.05 ? 1.3 : rnd(); // 5% of ticks OOR
    const g = rollGate({ cfg: CFG, nowMs: now, frac, oorSince: rollState.oorSince, sinceLastRollSec: (now - rollState.lastRoll) / 1000, dayActions: rollState.dayActions, deployStagedUsd: float.usdc, idlePairUsd: float.clkn * st.lastPrice, widthOffPct: 0 });
    rollState.oorSince = g.oorSinceNext;
    if (g.action === "roll") { rollState.dayActions++; rollState.lastRoll = now; }
  }
  check("fuzz: no floor/guard/cap violations in 5,000 ticks", violations.length === 0, violations.slice(0, 3).join("; "));
  check("fuzz: daily buyback count bounded", st.buybacksToday <= CFG.maxBuybacksPerDay, String(st.buybacksToday));
  check("fuzz: rolls bounded by 2× day cap", rollState.dayActions <= 2 * CFG.maxActionsPerDay, String(rollState.dayActions));
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log("\nengine-sim: all scenarios pass");
