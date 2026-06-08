# Ops / decisions — to-do

## CLKN liquidity — RELAUNCHED 2026-06-08 ✅
- Staged redeploy complete after the holder sell. Final live positions:
  - base CLKN/USDC ~\$848 (in-range) · SOL vault CLKN/SOL ~\$952 (in-range) · ask wall ~\$450 (asks above price).
  - Two-sided pools quote-balanced (~\$446 USDC ≈ ~\$442 SOL); totals ~12% apart by choice (SOL keeps wider width 15) — user accepted as-is.
  - Engine ticks ~+2% off the Meteora main LP (arb-proof floor for this quiet token). Market ~\$0.0001492, MC ~\$149K.
  - Dry powder reserve in wallet: ~\$204 USDC + ~2.18 SOL + ~296K CLKN.
  - Config now: maxUsd 440, solMaxSol 6.5, widthPct 10, solWidthPct 15, swapSolFloor 2, minRebalanceIntervalSec 1800, askWallClknFraction 0.9, maxActionsPerDay 40. Vault RUNNING (unpaused). Raise maxUsd/solMaxSol to grow later.
  - Lesson: the autonomous scheduler (10-min) races manual multi-step staging — set final config in ONE shot then tick immediately, or expect mid-stage rolls.

## CLKN liquidity — pulled for a holder sell (2026-06-08)  [HISTORY]
- **State:** CLKN vault is **PAUSED** and **all 3 positions are CLOSED** (base CLKN/USDC,
  ask wall, SOL vault) — liquidity sitting in the operator wallet `4Ws6jX…`. Pulled so the
  vault isn't the counterparty while a large holder sells. Stays pulled until "redeploy CLKN".
- **Diagnostic:** `node scripts/clkn-pool-spread.js` — anchors on the MAIN LP (deepest pool,
  on **Meteora** for CLKN) and shows the engine Orca pools' on-chain tick vs that market.
  Jupiter is a flagged cross-check (it goes stale when the Orca pools it leans on are drained).
- **Post-sell read (2026-06-08, after the sell):** main LP $0.0001476, MC ~$147.7K (−13% 24h).
  Engine Orca pools are STALE-HIGH at ~$0.0001671 ($1 liq) = **+13% above market** (Jupiter
  was stale too, ~+13%). The empty Orca ticks WON'T self-correct — nothing to arb.
- ⚠️ **CLMM active-tick quirk (must account for on redeploy):** an Orca position only goes
  live (earns/trades) when the pool's CURRENT tick is inside [lower, upper]. An empty pool's
  tick is frozen at the last trade (~$0.0001671). A tight range placed at the true market
  ($0.0001476) sits BELOW the active tick → 100% one-sided, inert. **The new range MUST
  straddle the stale tick to activate.** You also can't pre-move the tick with a swap (empty
  pool = nothing to swap against); adding straddling liquidity + letting it trade is the only
  way the tick walks down.
- **Redeploy plan (staged — engine pools ~13% stale-HIGH vs market):**
  1. ✅ **Stage 1 — small seed, WIDE range. DONE.** Set `maxUsd` 80, `widthPct` 15,
     `solMaxSol` 0.3, `askWallEnabled` false, `maxActionsPerDay` 40 (daily cap was hit by the
     close ops). Seeded base CLKN/USDC (pos `8EAUnnNs…`) + SOL CLKN/SOL (pos `HRATM6iy…`),
     both straddling the stale $0.0001671 tick and reaching down to market — ~$200 total,
     so arbs walk the ticks to ~$0.0001476.
  2. **Wait ~10 min**, `node scripts/clkn-pool-spread.js`; want the engine ticks <1% off the
     main LP before Stage 2. (Quiet token ~1 trade/hr — if the tick hasn't moved, the arb
     hasn't fired yet; don't force Stage 2 onto a still-dislocated pool.)
  3. **Stage 2 — full, balanced, tight.** "Balanced" = the two TWO-SIDED pools equal in
     value (base CLKN/USDC ≈ SOL CLKN/SOL); the ask wall is SEPARATE and NOT counted.
     - Equalize: deployable ~$700 USDC vs ~$473 SOL → swap ~$113 USDC→SOL so each side ≈ $586
       (or cap base down to ~$473 to match SOL, no swap). Set `maxUsd` + `solMaxSol` so base
       and SOL deploy equal value.
     - Deploy base + SOL FIRST (`widthPct` 10, tight, re-centered on the corrected price) so
       they claim their CLKN before the wall does.
     - THEN re-enable the ask wall at the original `askWallClknFraction` 0.9 separately.
  - Price-gap guard is 25%; the ~13% gap won't trip it. If a bigger gap appears, widen
    `priceGapGuardPct` for the redeploy or the vault sits out.

## RPC / infra
- [x] **Upgrade the Helius plan.** ✅ Done 2026-06-08 (≈10× usage). On-chain reads verified
      working again (CLKN 3 positions/$2.4k, ROSE 3 positions/$140; fresh, no 429). Was
      exhausted earlier same day (`-32429 "max usage reached"`), which had degraded **all
      on-chain reads sitewide** — `/liquidity`, the engine dashboard, the client portal, the
      vault's rebalance tick, plus autopsy/score/trace/holders.
      - Mitigation already shipped: `publicPositions` caches 30s and **serves the last good
        snapshot on a 429** (so `/liquidity` shows real depth through blips instead of a false
        "no positions"); `/liquidity` now says "rate-limited, try again" instead of "no positions".
      - Diagnostic added: `GET /api/tg-webhook-info?key=…` (Telegram webhook health; `&reset=1`).
- [x] _(complements the upgrade)_ **Fallback RPC** ✅ Done 2026-06-08. `lib/rpc.js`: one ordered
      endpoint list (primary Helius → `FALLBACK_RPC_URL` backups → `HELIUS_API_KEY_2` → public node)
      + a failover `fetch`/`connection()` that rolls to the next endpoint on 429/5xx/network error.
      Wired through the engine (orca/raydium/vault/securitycoop via custom-fetch Connections) +
      server.js `heliusRpcCall` + the `/api/helius-rpc` client proxy. All endpoints unset =
      primary-only (safe no-op). **To activate: set `FALLBACK_RPC_URL` (QuickNode/Triton/Alchemy)
      or `HELIUS_API_KEY_2` on Railway; `RPC_DEBUG=1` logs failover events.**
- [ ] _(Optional)_ **Reduce RPC burn** — lengthen dashboard/portal poll intervals + the trade
      poller cadence if normal usage keeps outrunning the plan.

## Product decision
- [ ] **BAGS graduation feature — keep or cut?** Increasing the monitoring window hasn't improved
      results; it hasn't driven meaningful traffic/recognition (a couple of decent exposures only).
      - NOTE: this runs on **Solana Tracker** (`gradWatcherTick` ~5min + `gradHotTick` ~1min +
        `bagsLaunchesTick`), **not Helius** — so cutting it frees Solana-Tracker quota and
        simplifies the scheduler block, but does **not** fix the Helius quota above.
      - **DECISION (2026-06-08): KEEP all BAGS features as-is until the hackathon outcome is
        known**, then revisit keep/cut. Do not remove without explicit go-ahead — it touches the
        boot scheduler block and several endpoints (`/api/bags-near-grad`, `/api/grad-watch-status`,
        the public `/bags` board).
