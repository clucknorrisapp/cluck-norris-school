// Pure engine decision logic — NO requires, NO chain, NO clock. Every input is passed in,
// so scripts/engine-sim-test.cjs can replay thousands of ticks against the REAL production
// decision code (not a re-implementation) before a behavior change ships. Born from the
// 2026-08-28 retro: the decay loop, the buyback stall, and the sleeve starvation were all
// pure decision bugs — each would have shown up in a 200-tick replay that takes milliseconds.
// If you change a gate here, the simulator's scenario suite is the contract you're editing.

// ── Buyback: what (if anything) to spend this cycle ─────────────────────────────
// Mirrors lib/whirlpool-vault.js buyback() gate-for-gate; buyback() calls THIS so the two
// can never drift. Inputs:
//   cfg    — getConfig() (buybackEnabled, usdcFloor, buybackReserveUsd, maxBuybackUsdPerCycle,
//            minBuybackUsd, maxBuybacksPerDay, buybackMinIntervalSec, swapSolFloor,
//            solGasReserve, baseDeployThresholdUsd)
//   st     — { paused, lastPrice, lastBuybackTs, buybacksToday, buybackDayStamp }
//   float  — { usdc, sol, jup, clkn } wallet balances (ui units)
//   prices — { solUsd, jupUsd } or null (price feed down → USDC-only, the pre-multi-quote shape)
//   nowMs, todayStamp ("YYYY-MM-DD", UTC)
// Returns { action: "none"|"capped"|"deferred"|"buy", fromSym, spendUi, spendUsd, starved, reason }.
function buybackDecision({ cfg, st, float, prices, nowMs, todayStamp }) {
  if (!cfg.buybackEnabled) return { action: "none", reason: "buyback disabled" };
  if (st.paused) return { action: "none", reason: "paused" };

  // IDLE-TOKEN GATE (2026-08-28, "the buyback drain loop"): buyback exists to REPLENISH
  // pairing inventory, not to run a conversion treadmill. With floors near zero it would
  // convert every idle quote dollar to the project token each interval — so each sleeve
  // roll's freed quote got eaten before the reopen, pools shrank ($325→$183 in 40 min live)
  // while idle token piled up unpaired. Skip while ample idle token is already staged;
  // deploys consume it and the gate reopens by itself.
  const idleTokUsdPre = (float.clkn || 0) * (st.lastPrice || 0);
  const ampleUsd = 2 * (cfg.baseDeployThresholdUsd || 40);
  if (idleTokUsdPre >= ampleUsd) {
    return { action: "none", reason: `idle token ample ($${idleTokUsdPre.toFixed(0)} staged ≥ $${ampleUsd}) — buyback not needed` };
  }

  const usable = Math.max(0, (float.usdc || 0) - cfg.usdcFloor - (cfg.buybackReserveUsd || 0));
  // MULTI-QUOTE (owner, 2026-08-28): USDC first (already USD, no price needed); else free SOL
  // above BOTH gas guards; else JUP above a dust reserve. Never touches the project token.
  let fromSym = "USDC", spendUi = Math.min(usable, cfg.maxBuybackUsdPerCycle), spendUsd = spendUi;
  if (spendUsd < cfg.minBuybackUsd && prices) {
    const solUsd = Number(prices.solUsd) || 0;
    const jupUsd = Number(prices.jupUsd) || 0;
    const freeSol = Math.max(0, (float.sol || 0) - (cfg.swapSolFloor || 0) - (cfg.solGasReserve || 0));
    const freeJup = Math.max(0, (float.jup || 0) - 50); // dust stays so sleeve thresholds keep meaning
    if (solUsd > 0 && freeSol * solUsd >= cfg.minBuybackUsd) {
      fromSym = "SOL"; spendUi = Math.min(freeSol, cfg.maxBuybackUsdPerCycle / solUsd); spendUsd = spendUi * solUsd;
    } else if (jupUsd > 0 && freeJup * jupUsd >= cfg.minBuybackUsd) {
      fromSym = "JUP"; spendUi = Math.min(freeJup, cfg.maxBuybackUsdPerCycle / jupUsd); spendUsd = spendUi * jupUsd;
    }
  }
  if (spendUsd < cfg.minBuybackUsd) {
    return { action: "none", fromSym, spendUi: 0, spendUsd: 0, reason: `no spendable quote (USDC $${usable.toFixed(2)} above floor; free SOL/JUP under guards or < $${cfg.minBuybackUsd} min)` };
  }

  const buybacksToday = st.buybackDayStamp === todayStamp ? (st.buybacksToday || 0) : 0;
  if (buybacksToday >= cfg.maxBuybacksPerDay) return { action: "capped", fromSym, spendUi: 0, spendUsd: 0, reason: "daily buyback cap reached" };

  const sinceLast = st.lastBuybackTs ? (nowMs - st.lastBuybackTs) / 1000 : Infinity;
  // DEMAND OVERRIDE (owner, 2026-08-28): the interval is an anti-thrash guard, not a metronome.
  // Starved = staged quote worth deploying while (nearly) no idle token exists. A fresh unspent
  // buyback kills the demand signal until a sleeve deploys it AND the market strips it again;
  // the daily count + per-cycle caps bound total spend either way.
  const idleTokUsd = (float.clkn || 0) * (st.lastPrice || 0);
  const starved = idleTokUsd < Math.max(10, cfg.minBuybackUsd) && spendUsd >= Math.min(cfg.maxBuybackUsdPerCycle, cfg.baseDeployThresholdUsd || 40);
  if (sinceLast < cfg.buybackMinIntervalSec && !starved) {
    return { action: "deferred", fromSym, spendUi: 0, spendUsd: 0, starved, reason: `buyback anti-thrash (${Math.round(sinceLast)}s < ${cfg.buybackMinIntervalSec}s)` };
  }
  return { action: "buy", fromSym, spendUi, spendUsd, starved, reason: `buy with $${spendUsd.toFixed(2)} of ${fromSym}` };
}

// ── Sleeve roll gate: dwell / urgency / pacing / day-cap SPEC ───────────────────
// The three sleeve ticks in whirlpool-vault.js implement this shape inline (base uses
// forceRoll where the sleeves use deployDriven — same "urgent" semantics). The simulator
// drives THIS function, so the semantics below are pinned by tests; keep the inline gates
// and this spec in lockstep when either changes.
//   frac            — position of price across the range (0..1), <0 or >1 = out of range
//   oorSince        — ms timestamp when OOR was first seen (null if in range last tick)
//   deployStagedUsd — spare quote available to deploy into this sleeve
//   idlePairUsd     — idle project-token value available to pair with it
//   sinceLastRollSec, dayActions, widthOffPct (fraction, e.g. 0.25 = 25% off)
// Returns { action: "hold"|"dwell"|"roll"|"deferred"|"capped", urgent, oorSinceNext, reason }.
function rollGate({ cfg, nowMs, frac, oorSince, sinceLastRollSec, dayActions, deployStagedUsd, idlePairUsd, widthOffPct }) {
  const dwell = cfg.oorDwellSec != null ? cfg.oorDwellSec : 300;
  const thr = cfg.baseDeployThresholdUsd || 40;
  let needRoll = false, urgent = false, reason = "in range", oorSinceNext = null;

  if (frac < 0 || frac > 1) {
    // OOR DWELL (owner, 2026-08-28: "out of range, wait 5 mins, fix it"): a wick that
    // recrosses inside the dwell never rolls; one that stays out is fixed the moment the
    // dwell passes, bypassing anti-thrash.
    if (!oorSince) return { action: "dwell", urgent: false, oorSinceNext: nowMs, reason: `out of range — dwell ${dwell}s started` };
    if ((nowMs - oorSince) / 1000 < dwell) return { action: "dwell", urgent: false, oorSinceNext: oorSince, reason: "out of range — dwelling" };
    needRoll = true; urgent = true; reason = "out of range (dwell passed)";
  } else if ((widthOffPct || 0) > 0.2) {
    needRoll = true; urgent = true; reason = "width reconfig";
  } else if (Math.min(deployStagedUsd || 0, idlePairUsd || 0) >= thr) {
    // Meaningful-refill gate (decay-loop fix): only a refill ≥2× threshold — which the ~5%
    // deployFrac leftovers can never reach — skips pacing; dribbles roll on the normal clock.
    needRoll = true; urgent = Math.min(deployStagedUsd, idlePairUsd) >= 2 * thr; reason = "deploying staged";
  }
  if (!needRoll) return { action: "hold", urgent: false, oorSinceNext: null, reason };

  if (!urgent && sinceLastRollSec < cfg.minRebalanceIntervalSec) {
    return { action: "deferred", urgent, oorSinceNext: frac < 0 || frac > 1 ? oorSince : null, reason: `${reason} (anti-thrash)` };
  }
  // Urgent rolls (OOR-past-dwell, meaningful refills, width reconfigs) get a bounded 2×
  // emergency ceiling instead of a hard freeze; routine rolls stop at 1×.
  const ceiling = urgent ? 2 * cfg.maxActionsPerDay : cfg.maxActionsPerDay;
  if (dayActions >= ceiling) return { action: "capped", urgent, oorSinceNext: frac < 0 || frac > 1 ? oorSince : null, reason: "daily cap reached" };
  return { action: "roll", urgent, oorSinceNext: null, reason };
}

module.exports = { buybackDecision, rollGate };
