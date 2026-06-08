# Ops / decisions — to-do

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
