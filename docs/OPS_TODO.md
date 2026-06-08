# Ops / decisions — to-do

## CLKN liquidity — pulled for a holder sell (2026-06-08)
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
  1. **Stage 1 — small seed, WIDE range.** Dial caps down (`maxUsd`≈80,
     `askWallClknFraction`≈0.05, `solMaxSol`≈0.1) AND widen `widthPct`≈13-15% (so the range
     runs upper ≥ stale tick $0.0001671 → lower ≤ market $0.0001476, covering the whole
     correction zone). Resume + tick → seed straddles the stale tick, arbs sell CLKN in and
     walk the tick down to market. Bounded cost: base seed goes in as USDC, converts to CLKN
     bought avg ~$0.000157 (~6% above final market) — keep it small.
  2. **Wait ~10 min**, re-run the spread script; want the engine pools <1% off the main LP.
  3. **Stage 2 — full, normal width.** Restore caps (`maxUsd` 1000, `solMaxSol` 1.0) and
     `widthPct` back to 10, force a roll → re-center tight at the corrected ~$0.0001476.
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
