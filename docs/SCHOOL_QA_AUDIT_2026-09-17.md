# School Q&A and LP Lab audit — 2026-09-17

Owner ask (2026-09-16): *"have we went back through the school to check all questions and answers
and the LP lab?"* Nobody had. This is that pass. Everything below was read question by question
from the source (`src/App.jsx` core + Incubator, `src/sections/LPLab.jsx`), not from a summary.

## What was checked

- **189 quiz questions across 35 lessons**: 101 in the core school and Incubator, 88 in the LP
  Lab. Every question's answer key, its three distractors and its explanation were read for
  factual correctness, internal consistency (question vs. answer vs. explanation) and ambiguity
  (two defensible options). All 189 answer indexes are in range.
- **The 14 LP Lab lesson bodies** (~12,900 words, 75 section bodies, hooks, verdicts, the
  StrategyMatcher helper): a second reviewer recomputed every worked number (constant product,
  the IL table 0.6 / 2.0 / 5.7 / 13.4 / 20.0 / 25.5 / 42.5 %, fee APR = daily fees ÷ TVL × 365,
  the days ÷ 365 proration, the capital-efficiency multiples) and checked the DEX mechanics
  against how Orca, Raydium CLMM, Meteora DLMM and Meteora DAMM v2 actually work. All the
  arithmetic checked out. No sentence promises a yield.

## What was wrong and is now fixed (PR of the same date)

Quizzes:
1. **Ticks vs bins, four questions in Concentrated Liquidity and Price Bins & Ticks** claimed the
   difference between tick-based pools and Meteora DLMM is that "only the active bin earns" while
   "all ticks earn proportionally". Wrong: a tick-range position also earns only while the price
   is inside it. The real difference is discrete bins, zero slippage inside a bin, and the ability
   to shape liquidity (spot / curve / bid-ask). The answers and explanations now say that.
2. **Tick-spacing question** asked about a 0.3% / spacing-60 pool but the answer and explanation
   said 0.25% and 50. Now consistent (0.3%, 60).
3. **"What is Meteora DAMM V2?"** explanation called it concentrated liquidity. It is Meteora's
   dynamic-fee constant-product AMM; concentrated liquidity is DLMM. Fixed.
4. **"On Solana, MEV is…"** answer said "less severe than Ethereum". Sandwich bots on Solana pay
   validators for ordering (Jito bundles) and are common on Jupiter / Raydium routes; speed does
   not remove MEV. Answer and explanation rewritten; distractors unchanged.
5. **Burn mechanism** explanation compared burns to Bitcoin's halving (which slows issuance, it
   does not destroy supply). Replaced with the point that a burn without demand changes nothing.
6. **Liquidity Pools Q5** answer said IL is "vs just holding SOL"; IL is measured against holding
   the two tokens. Wording fixed.

LP Lab prose:
7. **Fee tiers lesson** said "the 0.02% tier is the one CLKN's own Orca pools run on"; only the
   CLKN/SOL pool does, CLKN/BTC and CLKN/JUP run on 0.30% (`lib/whirlpool-vault.js`). Fixed.
8. **Ticks and Bins table**: Raydium CLMM listed 0.05% → spacing 1, same as 0.01%, contradicting
   the rule above it. Now 0.05% → 10.
9. **Same lesson's bullet "all ticks earn fees proportionally"** replaced with "the whole range
   earns while price is inside it — nothing earns once price leaves".
10. **StrategyMatcher** recommended "Meteora DAMM V2" for a moderate concentrated range; DAMM v2
    has no ranges. Now "Meteora DLMM wide bins".

Translations: 15 of these strings are curated keys in all six `*.school.json` dictionaries
(English text is the key). Each was re-keyed with a written translation in es / hi / it / pt /
vi / zh, inserted at the same position, so no language falls back to machine translation for
them. `scripts/i18n-audit.cjs`: missing 0, stale 0. `data/curriculum.json` (the AI classroom's
copy of the core quizzes) was patched in place for the four core-quiz strings; its generator
(`scripts/extract-curriculum.js`) only knows two of its four courses and must not be re-run
blindly.

## Judged fine, on purpose (so nobody re-litigates them)

- **Impermanent Loss Q16** ("120% APR minus 20% IL ≈ 100%") is an additive simplification; the
  compounded figure is 76%. The explanation already stresses proration and calls it approximate.
  Left as a teaching approximation.
- **Bags.fm creator fee = 1%** matches the owner's own copy on `/investors`.
- **"A DEX can't go bankrupt"**, **"CEX requires KYC by law"**, **"DEX is always on"** are stated
  with caveats in their explanations. Left.
- **Q25 in the LP Lab** (DLMM better than Orca for USDC/USDT) is a preference, not a law; the
  explanation now says so instead of asserting it.

## Not covered by this pass

- The Library articles (11) and LP notes (10) have no quizzes and were not re-read.
- Lesson bodies of the 14 core lessons (the ~110–150-word intros) were not fact-checked line by
  line; the deep dive of 2026-09-15 covers their shape and the lesson-1 rewrite is still pending
  the owner's review.
