# Ops / decisions — to-do

## CLKN liquidity — pulled for a holder sell (2026-06-08)
- **State:** CLKN vault is **PAUSED** and **all 3 positions are CLOSED** (base CLKN/USDC,
  ask wall, SOL vault) — liquidity sitting in the operator wallet `4Ws6jX…`. Pulled so the
  vault isn't the counterparty while a large holder sells. Stays pulled until "redeploy CLKN".
- **Diagnostic:** `node scripts/clkn-pool-spread.js` — shows each Orca CLKN pool's on-chain
  price vs the Jupiter market ref + a convergence verdict on FUNDED pools. Use it to watch
  the pools realign after the sell. (Note: with liquidity pulled, all tiers read "stale".)
- **Redeploy plan (staged — price will be ~7-8% off after the sell):**
  1. **Stage 1 — small seed.** Dial caps down (`maxUsd`≈80, `askWallClknFraction`≈0.05,
     `solMaxSol`≈0.1), resume, tick → small position in each pool so arbs realign the tiers.
  2. **Wait ~10 min**, re-run the spread script; want FUNDED pools <1% off market.
  3. **Stage 2 — full.** Restore caps to normal (`maxUsd` 1000, `solMaxSol` 1.0, etc.),
     force a roll → scale up to full size at the corrected price.
  - Price-gap guard is 25%; a 7-8% move won't trip it. If the sell is bigger and the gap
    exceeds 25%, widen `priceGapGuardPct` for the redeploy or the vault sits out.

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
