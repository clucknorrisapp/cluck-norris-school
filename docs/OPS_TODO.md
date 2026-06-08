# Ops / decisions — to-do

## RPC / infra
- [ ] **Upgrade the Helius plan.** On 2026-06-08 the Helius RPC returned `-32429 "max usage
      reached"` (quota exhausted). This degrades **all on-chain reads sitewide** — `/liquidity`,
      the engine dashboard, the client portal, the vault's rebalance tick, plus
      autopsy/score/trace/holders. Same `HELIUS_API_KEY`, just more credits; until then it
      recovers only at the plan's cycle reset.
      - Mitigation already shipped: `publicPositions` caches 30s and **serves the last good
        snapshot on a 429** (so `/liquidity` shows real depth through blips instead of a false
        "no positions"); `/liquidity` now says "rate-limited, try again" instead of "no positions".
      - Diagnostic added: `GET /api/tg-webhook-info?key=…` (Telegram webhook health; `&reset=1`).
- [ ] _(Optional, complements the upgrade)_ **Fallback RPC** — switch reads to a backup when
      Helius 429s. Needs a 2nd RPC URL/key (another Helius key, or QuickNode/Triton). Resilient
      to future caps.
- [ ] _(Optional)_ **Reduce RPC burn** — lengthen dashboard/portal poll intervals + the trade
      poller cadence if normal usage keeps outrunning the plan.

## Product decision
- [ ] **BAGS graduation feature — keep or cut?** Increasing the monitoring window hasn't improved
      results; it hasn't driven meaningful traffic/recognition (a couple of decent exposures only).
      - NOTE: this runs on **Solana Tracker** (`gradWatcherTick` ~5min + `gradHotTick` ~1min +
        `bagsLaunchesTick`), **not Helius** — so cutting it frees Solana-Tracker quota and
        simplifies the scheduler block, but does **not** fix the Helius quota above.
      - Decision pending (user debating removal). **Do not remove without explicit go-ahead** —
        it touches the boot scheduler block and several endpoints (`/api/bags-near-grad`,
        `/api/grad-watch-status`, the public `/bags` board).
