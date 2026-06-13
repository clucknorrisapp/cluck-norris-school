# LP Pair Scanner — flagship Liquidity Lab tool

**Status:** in build (Phase 1). Owner-driven flagship (2026-06-13). Goal: a pro-grade,
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

## Hard rules
- Informational only; never financial advice; always show the IL-risk + not-advice disclaimer.
- Honest numbers: estimates calibrated to live results; label every estimate as an estimate.
- ST is NOT a dependency here — GeckoTerminal + on-chain + Helius only.
