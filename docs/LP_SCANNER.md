# LP Pair Scanner — flagship Liquidity Lab tool

**Status:** LIVE & shipped (2026-06-13). Page `/lp-scanner`, listed on the tools hub, cross-linked
both ways with the LP Lab (`/#lplab`). Owner-driven flagship. Goal: a pro-grade,
multi-DEX LP intelligence tool that experienced LPs bookmark and share — brand recognition
beyond the education funnel. Our edge: **we run a live autonomous LP** (the JUP/USDC earner),
so the earnings model is **calibrated against real on-chain results**, not theory.

## What it does (the product)
A user names a **pair** (two assets, by symbol or mint) — or pastes a pool address — and
optionally **how much they'd deploy** and their **range width**. The tool scans **every
Solana DEX** (Meteora DLMM/DAMM, Orca Whirlpools, Raydium CLMM/CPMM, + whatever GeckoTerminal
indexes) and returns **every open pool for that pair**, with the metrics that actually decide
an LP's outcome — ranked so they can compare ALL their options.

**Framing (hard rule): informational, NOT financial advice.** Never "put your money here."
It's "you're going to LP this pair anyway — here's the full landscape so you choose with eyes
open." Every output carries an explicit not-advice + IL-risk disclaimer.

## Metrics per pool
- DEX + pool type (DLMM / CLMM / CPMM / DAMM) · pool address · age
- **Fee tier** (read on-chain per DEX — the number GeckoTerminal omits)
- TVL (reserve) · multi-window volume (5m/15m/30m/1h/6h/24h) · **turnover (vol/TVL)**
- **24h fees** (= volume × fee tier) and **fee/TVL yield** (the real money metric)
- Liquidity **concentration** around the active price (DLMM/CLMM) — answers "are others tight,
  so I'd be diluted?" (the question that started this build)
- **Volatility proxy** (price-change windows) + txn/buyer counts (real activity vs wash)
- For a user's deposit + range: **estimated $/day, APR, pool share** (CALIBRATED), break-even

## Data sources
- **GeckoTerminal** (free, indexes every DEX): prices, TVL, multi-window volume, txns,
  price-change, age, FDV. The multi-DEX backbone.
- **On-chain per DEX** (fee tiers + concentration): Meteora via `@meteora-ag/dlmm` SDK;
  Orca Whirlpool fee/tick; Raydium CLMM/CPMM fee. Helius RPC.
- **Calibration:** the earnings model is anchored to the live JUP/USDC position
  (~$20–25/day on ~$4–5K ≈ 0.5%/day) so estimates match reality, not the ~2.4x-optimistic
  raw active-bin-share model.

## Build phases
1. **Engine v1 (this phase):** `/api/lp-scan` — pair → all pools across DEXs via GeckoTerminal,
   ranked by turnover, with full GT metrics. Symbol→mint resolution. (`lib/lp-scanner.js`)
2. **Fee + yield layer:** read fee tier on-chain per DEX → 24h fees, fee/TVL, calibrated
   per-deposit earnings estimate.
3. **Depth layer:** liquidity concentration around active (dilution analysis), volatility-aware
   suggested range, fee-vs-IL projection.
4. **Frontend:** LP Lab "Pool Scanner" UI — pair input, comparison table, per-pool deep-dive
   cards, history charts. Shareable result cards (virality, like the Score/transcript cards).
5. **Polish + brand:** "calibrated by a real autonomous LP" badge, multi-protocol coverage.

## What's SHIPPED (endpoints in server.js, engine in lib/lp-scanner.js)
- **`/api/lp-token?token=&amount=`** — SINGLE-TOKEN MODE (`scanToken`): paste one token →
  EVERY pair/pool it trades in across all DEXs, each row labeled with its pair + per-pair IL +
  active/idle flag. UI: leave Token B blank. "PEPE → boom."
- **`/api/lp-top`** — TOP POOLS (`topPools`): the busiest Solana pools across every DEX by 24h
  volume, enriched + ranked by real fee yield (which of the busiest actually pay). Warmed 12s
  after boot then refreshed hourly by a background timer in server.js (independent of the
  Telegram scheduler block); 55-min internal cache. UI: "🔥 Top Pools Right Now" loads on open.
- **`/api/lp-scan?a=&b=&amount=`** — pair → every pool across DEXs (GeckoTerminal), enriched
  with on-chain fee tier → 24h fees, fee/TVL yield, 7d-avg yield + volTrend (spiking/cooling/
  steady), calibrated per-deposit `estDailyUsd`. `scanPair()`. Fee reads run SEQUENTIAL (RPC
  saturation fix) + 60s cache; OHLCV history is concurrency-capped at 4 (free GeckoTerminal ~30 req/min; cgFetch retries once on 429).
- **`/api/lp-token-search?q=`** — typeahead over the Jupiter verified list (`searchTokens`),
  endpoint `lite-api.jup.ag/tokens/v2/tag?query=verified` (fields: mint=`id`, logo=`icon`).
- **`/api/lp-pool?pool=&amount=&width=`** — POOL DEEP-DIVE + RANGE/EARNINGS SIMULATOR
  (`poolDeepDive`). Models the concentrated-liquidity tradeoff against the pool's REAL 7d
  realized volatility (OHLCV high/low): for a sweep of widths it returns the capital-efficiency
  multiplier (Uniswap-v3/DLMM math vs a ±2.56% reference = our live position), in-range $/day,
  **time-in-range** + **rebalances/day** (from the daily swing), blended $/day + APR. Key emergent
  result: blended $/day is ~FLAT while you're tighter than the daily swing (concentration gain ≈
  offset by less time-in-range), then declines — so over-tightening just multiplies churn/IL.
  Reference at ±2.56% blends to ~$20/day on $4K, matching our live JUP/USDC earner.
- **`/api/lp-ask`** (POST) — Ask Cluck about the live pools (Sonnet 4.6, grounded in the scan;
  teaches fee-yield≠turnover, flags IL, never says where to put money).
- **`/api/lp-card?a=&b=&amount=`** — shareable 1200×630 PNG (`renderLpCard`): top pool's
  fee + 7d yield, est $/day, 3-pool ranking, IL badge, logo + footer. "Share this scan" button
  opens it + copies a tweet caption.

## Fee-reader coverage (real yield vs honest "—")
Read on-chain/API: **Meteora DLMM** (SDK), **Orca Whirlpool** (u16 @ offset 45 / 10000),
**Raydium** (AMM/CLMM/CPMM via api-v3.raydium.io). On SOL/USDC that's 5/7 pools; the only "—"
are smaller venues (humidifi, pancakeswap-v3-solana) whose on-chain layout isn't read yet —
they show "—" honestly, never a guessed yield. Add new readers in `feePctForPool()`.

## Hard rules
- Informational only; never financial advice; always show the IL-risk + not-advice disclaimer.
- Honest numbers: estimates calibrated to live results; label every estimate as an estimate.
  Time-in-range / rebalances-per-day are ROUGH (single-day band-hold proxy) — labeled as such.
- ST is NOT a dependency here — GeckoTerminal (free; the CoinGecko Pro upgrade slot is unused since the 2026-07-03 CG-API divorce) +
  on-chain + Helius only.
