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

## Pre-flight flags (token risk + pool risk) — added 2026-09-30
Owner ask after an LP session where these traps cost time: Token-2022 transfer fees (1% SPACEX
PreStocks; 3% on ANTHROPIC PreStocks, GP, ZCAT, NEARKAT, KNOTS, PURR), a 5x scaled-UI multiplier that
broke Meteora's add-liquidity screen, issuer pause/clawback keys, pre-IPO wrappers, one LP holding
99% of a pool, copycat mints. **No scan ranks a trap token without saying so.** Code:
`lib/token-risk.js` (pure classifier `classifyMint` + fetcher `tokenRisk`/`poolRisk`), test
`scripts/token-risk-test.cjs` (CI, offline). Still operator-only like every `/api/lp-*` route.

**Where it shows.** Every pool row from `scanPair` / `scanToken` / `topPools` gets
`risk: { tokenA, tokenB, pool }` (tokenA = the pool's base mint, tokenB = quote) and a merged `flags`
array (`{code, level, text, scope, symbol, mint}`, block first). `poolDeepDive` returns the same
`risk`/`flags` at the top level. The page renders them as badges (red = block, amber = warn, grey =
info; hover for the full text) on each row, the top-pool chips (block/warn only) and the pool detail.

**Levels.**
- **block** — `transfer_fee` (Token-2022 fee > 0: LPs pay it on deposit, withdraw AND every rebalance,
  so the yield maths is wrong) and `paused` (issuer has halted transfers right now).
- **warn** — `display_multiplier` (scaled-UI multiplier >= 1% away from 1; UIs may show prices off by
  N x), `permanent_delegate` (issuer can move tokens out of any account), `pausable` (issuer can pause
  all transfers), `transfer_hook` (a hook program is active), `default_frozen`, `temporary` (Jupiter
  tag `prestocks` or a "PreStocks" name — a pre-IPO wrapper that may convert or expire; we never claim
  a date we cannot read on-chain), `unverified` (not Jupiter-verified — copycat check),
  `jupiter_unknown` (Jupiter lookup failed), `epoch_unknown`, `unknown` (see below).
- **info** — `freeze_authority` (routine for issued assets like USDC), `mint_authority` (on
  non-stables; suppressed for USDC/USDT/USDS/PYUSD/cbBTC), `hook_authority` (authority set, no hook
  program), a sub-1% multiplier drift (xStocks accrue ~1.0017x), and pool flags `fee_mode_quote` /
  `fee_mode_input` (Meteora DLMM `pool_config.collect_fee_mode` 1 = fees paid in the quote token only,
  0 = in the token sold in).

**Ranking and `includeRisky`.** A row with any `block` flag is left OUT of the ranked list by default
and returned in a separate `excluded` array (the row plus `excludedReason`), with `excludedCount`;
`count`/`pools` (and `activeCount` in token mode) describe the ranked list. `?includeRisky=1` on
`/api/lp-scan`, `/api/lp-token` and `/api/lp-top` puts those rows back in ranked position (the page's
"RANK THEM ANYWAY" button). Warn/info rows are never excluded. The full result is cached and the
partition applied per request, so the flag costs no extra scan. Everything else in the responses is
unchanged (additive only). `/api/lp-ask` gets the non-info flags in its data block and is told to lead
with them.

**How the numbers are read.** Transfer fee: `transferFeeConfig.newerTransferFee` once the current epoch
>= its `epoch`, else `olderTransferFee` (bps / 100 = %). Multiplier: `scaledUiAmountConfig.newMultiplier`
once `now >= newMultiplierEffectiveTimestamp`, else `multiplier`. A transfer hook only counts as active
with a non-null `programId`.

**Sources and caching.** Mint account: `connection.getParsedAccountInfo` (lib/rpc, failover);
epoch: `getEpochInfo` (cached 10 min); Jupiter `tokens/v2/search?query=<mint>` (first row whose `id`
equals the mint; `JUPITER_API_KEY` switches to the keyed host like `jupList`); Meteora
`dlmm.datapi.meteora.ag/pools/<address>`. Per-mint risk cached 1 h, per-pool 1 h; failures 60 s.

**Unknown is not safe.** If the RPC read fails, or the mint is not a readable mint, `tokenRisk` returns
`{unknown:true, flags:[{code:'unknown', level:'warn', text:'could not read token risk'}]}` — never
thrown, never treated as safe, never as blocked (so it stays in the ranking, with the warning). If only
the Jupiter lookup fails, the on-chain flags still apply and `jupiter_unknown` is added.

**Not built: LP concentration** ("one LP holds 99% of a pool"). It needs position-account scans
(`getProgramAccounts` on the public proxy) or a per-DEX indexer; not done cheaply, so skipped rather
than faked. Add it as a `pool` flag in `poolRisk()` when a cheap source exists.

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
