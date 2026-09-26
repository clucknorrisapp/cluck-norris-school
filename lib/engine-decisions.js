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

// ── Roll rebalance: how much of a fresh close's freed float to swap to ~50/50 ──────
// BULLEN production incident, 2026-09-26: tick()/tickSol()/tickJup() close a position then
// size the REOPEN by the scarce side (inputMint falls back to whichever asset is short). After
// a one-way move the close is ~100% one asset, so the reopen is tiny and the rest sits idle in
// the wallet — the SOL pool went $167→$109 and the JUP pool never reopened. Fix: rebalance
// what THIS close just freed to ~50/50 VALUE (in quote-asset units) before sizing the reopen.
// Pure sizing only — the caller (bullen-scoped) measures freed = postCloseFloat − preCloseFloat,
// clamped to the closed position's own reported amounts (clampFreedToPosition below) so it
// never reaches into another pool's idle float, the SOL gas reserve, or a stray deposit — and
// calls manualSwap with the direction/amount below.
//
// Review round 2026-09-26 (adversarial pass, DEPLOY AFTER FIXES) added a HARD daily USD budget
// and folded in the SAME swapsToday/maxSwapsPerDay counter every other swap path in this file
// respects — both default OFF (budget 0 / no swapsToday cap passed) so a project that doesn't
// wire them up gets the historic no-rebalance behavior, not a silent unlimited one.
//   clknUi     — the project token freed by the close (ui units, ≥0, already clamped by the caller)
//   quoteUi    — the quote asset freed by the close (ui units, ≥0; USDC/SOL/JUP depending on pool)
//   price      — CLKN price in quote units (pool.clknPriceInQuote — same figure the tick already has)
//   quoteUsd   — USD value of 1 unit of quote (1 for USDC; the live SOL/JUP price otherwise)
//   minUsd     — skip below this imbalance (default $5)
//   maxSwapUsdPerCycle — hard per-swap cap, in USD (cfg.maxSwapUsdPerCycle)
//   dayBudgetUsd    — cfg.rollRebalanceUsdPerDay; ≤0 means the WHOLE feature is off (the default)
//   usedTodayUsd    — st.rollRebalanceUsdToday (ui USD spent so far on the budget's own day-stamp)
//   budgetDayStamp  — st.rollRebalanceDay ("YYYY-MM-DD" the usedTodayUsd figure belongs to)
//   swapsToday      — the shared swap-day counter (st.swapsToday), already resolved against
//                      its OWN day-stamp by the caller (matches evenPools' own convention)
//   maxSwapsPerDay  — cfg.maxSwapsPerDay; omit/non-finite = no cap (matches historic behavior)
//   todayStamp      — "YYYY-MM-DD" (UTC) for both day-stamp comparisons above
// Returns { action: "none"|"swap", dir: "sellClkn"|"buyClkn", amountUi, swapUsd, diffUsd, clamped, reason }.
// amountUi is in CLKN units for "sellClkn", quote units for "buyClkn".
function rollRebalanceDecision({
  clknUi, quoteUi, price, quoteUsd, minUsd = 5, maxSwapUsdPerCycle,
  dayBudgetUsd, usedTodayUsd, budgetDayStamp, swapsToday, maxSwapsPerDay, todayStamp,
}) {
  // OFF BY DEFAULT: no positive daily budget configured = the feature does not run at all,
  // regardless of imbalance. This is the project-level kill switch (DEFAULT_CONFIG ships 0).
  const dayBudget = Number(dayBudgetUsd);
  if (!(dayBudget > 0)) return { action: "none", reason: "roll-rebalance daily budget is 0 — feature off" };

  // Shared swap-day cap — the SAME swapsToday/maxSwapsPerDay counter every other swap path
  // (evenPools, buyback) respects, so this can't quietly run past the project's own daily limit.
  if (Number.isFinite(maxSwapsPerDay) && Number(swapsToday || 0) >= maxSwapsPerDay) {
    return { action: "none", reason: `daily swap cap (${maxSwapsPerDay}) reached — skipping rebalance` };
  }

  const usedToday = budgetDayStamp === todayStamp ? (Number(usedTodayUsd) || 0) : 0;
  const budgetRemainingUsd = Math.max(0, dayBudget - usedToday);
  if (budgetRemainingUsd <= 0) {
    return { action: "none", reason: `daily roll-rebalance budget ($${dayBudget}) exhausted ($${usedToday.toFixed(2)} used today)` };
  }

  const qUsd = Number(quoteUsd);
  if (!(qUsd > 0)) return { action: "none", reason: "no live quote-asset price — skipping rebalance" };
  const clknVal = Math.max(0, Number(clknUi) || 0) * Math.max(0, Number(price) || 0); // quote-unit value
  const quoteVal = Math.max(0, Number(quoteUi) || 0);                                  // quote-unit value
  const diff = clknVal - quoteVal;              // >0 → the freed CLKN side is fat
  const diffUsd = Math.abs(diff) * qUsd;
  if (!(diffUsd >= minUsd)) return { action: "none", diffUsd, reason: `freed imbalance $${diffUsd.toFixed(2)} under $${minUsd} min — skipping rebalance` };

  const cycleCapQuote = (Number.isFinite(maxSwapUsdPerCycle) && maxSwapUsdPerCycle > 0) ? maxSwapUsdPerCycle / qUsd : Infinity;
  const budgetCapQuote = budgetRemainingUsd / qUsd;
  const rawHalfQuote = Math.abs(diff) / 2;
  const halfQuote = Math.min(rawHalfQuote, cycleCapQuote, budgetCapQuote);
  const clamped = halfQuote < rawHalfQuote;
  if (diff > 0) {
    if (!(Number(price) > 0)) return { action: "none", reason: "no live pool price — can't size the CLKN sell" };
    const amountUi = halfQuote / Number(price);
    return { action: "swap", dir: "sellClkn", amountUi, swapUsd: halfQuote * qUsd, diffUsd, clamped, reason: `freed close was CLKN-heavy — selling ~$${(halfQuote * qUsd).toFixed(2)} of the token to reach 50/50 before reopening` };
  }
  return { action: "swap", dir: "buyClkn", amountUi: halfQuote, swapUsd: halfQuote * qUsd, diffUsd, clamped, reason: `freed close was quote-heavy — buying ~$${(halfQuote * qUsd).toFixed(2)} of the token to reach 50/50 before reopening` };
}

// ── Bound a measured "freed by the close" amount to what the position itself reported ──
// A close's freed amount is measured as a wallet-float DELTA (postCloseFloat − preCloseFloat) —
// review round 2026-09-26 flagged that a delta can be inflated by anything else that touched the
// wallet in the same window (a stray deposit landing, or RPC lag reporting a balance that hasn't
// caught up yet), which would size a rebalance swap off money that was never actually freed by
// THIS close. Clamp to the closed position's own pre-close reported amount (+ its pending fees,
// which the close also collects) — the true ceiling of what this specific close could free.
function clampFreedToPosition(measuredUi, positionAmountUi, pendingFeeUi) {
  const bound = Math.max(0, (Number(positionAmountUi) || 0) + (Number(pendingFeeUi) || 0));
  return Math.max(0, Math.min(Number(measuredUi) || 0, bound));
}

// ── Spendable input after slippage headroom + a reserve (mirrors addLiquidity's clamp) ──
// The builder's tokenMax = amount × (1 + slippage), and the WSOL path pre-funds the temp
// account with the FULL max up front, so an input sized at the raw free balance fails
// "insufficient funds" deterministically (audit F3, addLiquidity ~line 3405). Pulled out of
// addLiquidity's inline calc so this specific arithmetic is pinned by the simulator once,
// the same way spendableSol was extracted after tickSol's own copy of ITS formula went out
// of sync — addLiquidity() calls this now; behavior is unchanged.
function spendableForAdd(balanceUi, reserveUi, slippageBps) {
  const free = Math.max(0, (Number(balanceUi) || 0) - (Number(reserveUi) || 0));
  return free / (1 + (Number(slippageBps) || 0) / 10000);
}

// ── Spendable SOL: BOTH guards, always ─────────────────────────────────────────
// The shared "how much SOL is actually free to deploy" formula — swapSolFloor (the caller's
// never-touch reserve) AND solGasReserve (rent/fees) both subtracted, floored at 0. Extracted
// (Codex review on #444, BULLEN production incident) after tickSol's own inline copy of this
// was found MISSING the solGasReserve term (buybackDecision's `freeSol` above already had both
// — see the "SOL spend respects BOTH gas guards" scenario below); pin it here once so every
// caller (buyback, the base/SOL/JUP sleeve ticks) draws from the same tested arithmetic instead
// of each carrying its own copy that can silently drift out of sync with this one.
function spendableSol(cfg, float) {
  return Math.max(0, (float.sol || 0) - (cfg.swapSolFloor || 0) - (cfg.solGasReserve || 0));
}

module.exports = { buybackDecision, rollGate, spendableSol, rollRebalanceDecision, clampFreedToPosition, spendableForAdd };
