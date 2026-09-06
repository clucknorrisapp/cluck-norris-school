# The CLKN Productions Jup Verification Protocol
### Jupiter organic-score & verification service — the named, repeatable procedure

*(Official name set by the owner, 2026-09-01: **CLKN Productions Jup Verification Protocol** — "JVP" for short in this doc and in code identifiers. A CLKN Productions LLC product.)*

This is the codified version of the play we have now run on **POKE, CUNA, DNC and ROSE** (ROSE most recently: score 0 → 34+ in one day, 2026-08-31). It exists because every un-written run re-learned the same traps at live-money prices. Follow it in order; the Traps appendix at the bottom is the tuition already paid — read it before improvising.

**What the protocol is, in one line:** run tight, even, cheap-tier Orca pools on the client token so aggregator routing + arb flow generates continuous on-chain volume; keep the pools balanced and the wallet weighted toward quote; grow holders with real-buyer campaigns; and let Jupiter's trailing organic score climb from sustained runtime. The score decays to 0 when the engine stops — runtime *is* the product.

---

## Phase 0 — Intake (before anything trades)

1. **The deal:** client sends the token float (+ ideally some USDC/SOL for quote side) to a designated **operator wallet**. Record which env var holds that wallet's key.
2. **One armed engine per wallet.** CUNA, DNC and ROSE all sign with `MM_OPERATOR_SECRET_CUNA` (wallet `5WUjH…ZRZQ`). Arm exactly ONE engine per wallet at a time — two armed engines double-count the same float and fight over it. Check `/api/cuna-engine`, `/api/dnc-engine`, `/api/rose-engine` armed flags AND the vault `paused` flags (the two-flags trap) before arming a new one.
3. **Never the treasury.** POKE runs on the treasury key (owner carve-out) with `usdcFloor 0 / maxUsd 99999` — it absorbs any quote parked there. Client engines get their own wallet.
4. **Read balances on-chain** (`getTokenAccountsByOwner`, both token programs, + `getBalance` via `/api/helius-rpc`) — never from product tools.

## Phase 1 — Pools

1. **Enumerate existing pools first** (Helius DAS `getTokenAccounts` over the mint — the definitive method; DexScreener alone under-counts). Decode any Orca pool found: tickSpacing @41, feeRate @45, liquidity @49 (u128), tickCurrentIndex @81 (i32); price = 1.0001^tick × 10^(decA−decB).
2. **Stale empty pools are landmines, not assets.** A pool created at launch price with zero liquidity sits far off market; the engine's `priceGapGuardPct` will skip it forever, and depositing into it at its own tick gifts the gap to arbs. The vault only manages **canonical PDAs** (`poolAddressFor`: config + mint order + tickSpacing) — a pool on another config lineage is invisible to us; ignore it.
3. **Create fresh pools at the live market tick** (dry run as GET; execute as `curl -X POST … &run=1`, key in the `x-premium-key` header — armed vault calls are POST-only and must name `project=` since 2026-09-05): `/api/whirlpool/vault/create-pool?project=<id>&quote=USDC|SOL|JUP&feeTier=…&price=<live USD>&run=1` (~0.03 SOL rent each). **Always pass `&price=` from the live venue (Raydium/DexScreener)** — Jupiter serves a *frozen* price for unverified tokens, and an off-market initial tick is free money for arbs the moment liquidity lands.
4. **Standard shape: three pools — token/USDC, token/SOL, token/JUP — on the cheapest FREE tiers** (0.01%/0.02% mix; the PDA for a tier may already be occupied by a stale pool — pick the next free tier; the vault tier map is 0.01, 0.02, 0.05, 0.08, 0.16, 0.3, 0.65, 1). 1–2bp routing undercuts the typical 25bp launch pool, so aggregators route third-party flow through us — **that flow is the product**.
5. If a stale pool must be reused (no free tier), `/api/whirlpool/vault/reprice-pool` walks an EMPTY pool's tick to market with price-limited dust swaps (refuses pools with liquidity).

## Phase 2 — Engine configuration (the JVP profile)

The per-token engine follows the CUNA/DNC scoped pattern in server.js (KV-armed, `<X>_ENGINE_OFF=1` hard kill, config ratchet each tick, ratchet **merges `ratchetOverrides:<project>` over its code defaults** so `&durable=1` tuning sticks). Canonical config:

| Knob | Value | Why |
|---|---|---|
| bands (`widthPct`/`solWidthPct`/`jupWidthPct`) | **±1% uniform, all pools** | every 1% move = recenter = fresh arb trade; a wider band on one pool just idles it (the ±3% JUP band produced nothing) |
| `maxActionsPerDay` | **100000 (uncapped)** | owner standing rule: no daily limits on volume engines; rolls cost ~$0.002 |
| deploy thresholds (`baseDeployThresholdUsd`/`solDeployThreshold`/`jupDeployThreshold`) | **≈ half a typical trim (~$25 / 0.12 SOL / 70 JUP)** | the calibration band: BELOW idle-dust level → roll treadmill (burns actions on nothing); ABOVE trim size → trims strand in float and pools bleed. Both failure modes happened on 2026-08-31 |
| `buybackEnabled` | **false when inventory-rich** | wallet already stocked with the token; buyback would eat the scarce quote side |
| `scaleUpUsdPerCycle`/`scaleUpDailyCapUsd` | **$50 / $500** | sell-into-strength: converts idle token → USDC continuously while pools are balanced (owner rule: as token/SOL appreciate, hold quote, don't pile idle token) |
| `swapEnabled` + `maxSwapUsdPerCycle`/`maxSwapsPerDay` | **on, $150 / 48** | the balancer may buy/sell USDC/SOL/JUP freely |
| `notifyRolls` **and** project `telegramChatId` | **false / `"off"`** | client chat rooms are PUBLIC; ops noise never goes there (the buy bot posts through its own path and is unaffected) |
| `slippageBps` / `priceGapGuardPct` | 250 / 10 | thin-book numbers |

**Balance is the law, not caps.** `evenPools` recomputes every pool's share each cycle from live capital (total ÷ enabled pools), keeps them even with a **damped direct fat→lean shift** (⅓ of the gap per move, 5-min settle cooldown, add capped to the shift size — see Traps for why each damping term exists), and runs two- or three-pool mode automatically.

**Sequencing at go-live:** arm FIRST (the ratchet rebinds the operator env and stamps config — pool creation signs with whatever operator is bound), then create pools, then verify the first deploys. Confirm `operator` in the status reply is the FUNDED wallet.

## Phase 3 — Score & holders

- **Jupiter reads the chain, not our APIs.** Trades appear in their 5-minute bucket within minutes; the organic score is a **trailing average** that climbs with sustained runtime and **decays to 0 when the engine stops** (all four dormant tokens read 0; ROSE recovered 0→34 in ~12h of relight). Verification (`isVerified`) is separate from the score — DNC is verified with a 0 score.
- On Jupiter's UI: **grey "router"-tagged** trades = our engine + arbs (counts as volume, filtered from organic); **bright green/red** = real user swaps (organic). Both matter: grey buys routing dominance, green moves the score.
- **Holders ≥ ~250** and **liquidity ≥ ~$25k registered** matched the DNC verification profile. Grow holders with REAL buyers: buy specials ($3+ buy = entry; count from ~$2.80 for slippage), the giveaway machine (`lib/cuna-giveaway.js` + `/prize-wheel` — provably-fair, sell-voids, hold-through-draw), claim campaigns via the airdrop-intake page. *(Dusting strangers is detectable holder-farming; the tools this brand ships flag it in other projects. Not part of the protocol.)*
- **Serve the supply API** (`SUPPLY_FEEDS` in server.js → `/api/<id>/supply`, the JSON form not `?plain=1`), host the icon permanently (Arweave), and make sure metadata carries socials/website. Then submit for verification.

### VRFD reviewer feedback — ROSE, 2026-09-01 (first-party ground truth, supersedes guesses)

An actual Jupiter reviewer response on the ROSE application. These are the real bars, use them at intake:

- **Liq/MC ratio: ≥10% of market cap in QUOTE-SIDE liquidity** is "generally considered healthy" at small-cap size. **Jupiter's `liquidity` field (tokens/v2) IS the quote-side figure** — verified on ROSE 2026-09-01: registered $16,610 vs $16,711 measured on-chain quote-side across all pools (Raydium ROSE/SOL held $16.5k of it; the engine pools a few hundred). So the readiness check is simply `liquidity ≥ 0.10 × mcap`, both from the same API row (ROSE at ~$243k MC ⇒ ~$24.3k needed, had ~$16.6k ⇒ ~$7.7k gap). Budget at intake: a client at $X MC needs ~$X/10 on the quote side, or a smaller-MC story. Never derive quote-side by halving anything — measure it, and don't accuse their indexer of undercounting (it wasn't; a 2026-09-01 session misread their number as both-sides).
- **Social Support is manually reviewed for authenticity.** They inspected the accounts that used the Like function and called out "patterns not typically associated with active, organic users." Buying/farming likes is DETECTED and counts against you. Also explicit: support from OTHER PROJECTS' official accounts does NOT count — the metric wants genuine, independent community engagement on the project's own X. Intake rule: never run or tolerate a like-farm on a client we're submitting; channel the real-buyer campaign entrants (verified humans with wallets) toward organic engagement instead.
- **Cluster Supply is its own scored metric** and can read far worse than the public `audit.topHoldersPercentage` (ROSE: 26.7% public top-10 vs **56.54% cluster supply** in review) — it links wallets by funding lineage, so a fair self-mint + team distribution is structurally clustered forever. Honest mitigations only: lock clustered supply (Jupiter Lock — reads as can't-dump), burn surplus distribution wallets (Project Burn receipts), and grow real holders (unrelated lineages dilute the cluster). ⛔ Never break lineage through intermediaries/CEX hops — it's the obfuscation our own tools flag, it's what killed V3 scoring, and it would burn the JVP's submitter standing for every client.
- Assessment is holistic ("age, theme, utility, and strength of the other metrics") — one strong metric can carry a weaker one, so present the strongest honest story across all six: MC, volume/organic score, holders, social, ticker, liquidity.

## Phase 4 — Running it

- 2-hourly health checks: armed / not paused / correct operator, pools even (<12% spread) and in range near the live price, total deployed not shrinking, idle token not piling up (harvest running), organic score trend logged from `lite-api.jup.ag/tokens/v2/search?query=<mint>`.
- Stop levers: `/api/<x>-engine?key&off=1` (instant), `<X>_ENGINE_OFF=1` (durable). Wind-down: disarm, close positions, convert per client instructions.

---

## Appendix — Traps (each of these cost real time or money on 2026-08-31)

1. **Operator cache**: `registerProject` rebinds `operatorEnv` but the cached keypair survived until restart — the armed engine signed with an empty legacy wallet. Fixed in code (cache invalidated on rebind); still: always verify the `operator` field post-arm.
2. **Ratchet revert**: the want-shape stamped live config back every tick until the ratchet learned to merge `ratchetOverrides`. Any new engine ratchet MUST merge overrides.
3. **Threshold calibration band** (Phase 2 table): too low = treadmill (~200 wasted actions in hours), too high = pools bleed to float ($899→$651 in 4h). Set between idle-dust and trim size.
4. **Daily action caps**: bounded at 200 in code until 2026-09-01; a churny day exhausted per-leg counters and left the JUP pool unopenable until midnight. Ceiling now 100000.
5. **Evenness v1 round-trip**: trimming fat → wallet let the fat pool's own tick re-grab the float (never converged). v2 direct shift fixed it — then **overshot** without damping (no cooldown + swept ALL idle float into the lean pool, 46% spread). Both damping terms are load-bearing; do not remove.
6. **Stale-PDA tier collisions**: 0.01% and 0.02% token/USDC PDAs were both occupied by dead launch-price pools. Always check the canonical PDA on-chain before promising a tier.
7. **Public-room leak**: `notifyRolls:false` only gates recenters — funding/rebalance/buyback/create/close alerts flowed to the client's public room until `telegramChatId:"off"`.
8. **Jupiter's frozen price** for unverified tokens (create-pool `&price=` is mandatory) and **its per-window stats lag** — judge era changes on the 5m/1h buckets, not 24h.
9. **Engine off = score decay.** Don't pause a client engine casually; the score is rented with runtime.
10. **Orphaned positions poison every balance read** (2026-09-01, the worst of the set): a roll whose close tx silently failed left the old $355 position live but untracked. State pointed at the new position, so evenness read the base pool at half size, called the actually-fattest pool "lean", and **shifted capital INTO it** — spread went 13%→53% in an hour while every status read looked healthy. Paired trap: the deploy ticks re-absorbed the float each shift freed from the fat pool (thresholds don't know about evenness), so shifts round-tripped. Fixes now in the vault: an **orphan sweep** in `evenPools` (any untracked position is closed back to float every cycle) and a **deploy-evenness gate** (`deployBlockedFat` — the fat pool's deploy branch holds while pools are outside tolerance, so float only lands lean). If pools diverge while all the machinery reports green, **count the positions on-chain first** (`/api/whirlpool/vault/positions`) — the state's picture of the pools, not the logic, may be the lie.
11. **Where orphans actually come from — TWO schedulers, one position (audit F1, fixed 2026-09-01).** The generic 10-min vault loop ticked every enabled project — including ones with their own 90s engine loops — with no per-project lock, and `setState` is a read-modify-write over a last-write-wins kv blob. Two concurrent rolls of the same position can alias to one signature (same-slot builds) or resurrect a stale `positionMint` (state clobber): both book a successful close that left the old NFT live. Fixes: dedicated-loop projects are now EXCLUDED from the generic loop while armed; rolls verify on-chain that the closed position is actually gone before clearing the pointer (one RPC read — abort and retry beats minting an orphan). Still open for the multi-tenant build: per-project mutex on all mutating entrypoints and an atomic kv `update()`.
12. **The orphan sweep itself must not over-sweep (audit F2, fixed same day).** v1 tracked only the three pool mints — it would have liquidated owner anchors, sell walls, the ask wall, BTC/treasury sleeves, and kept-empty reuse NFTs on sight, and could close a just-opened position mid-roll race. Now: the tracked set includes every deliberate holding, zero-liquidity NFTs are skipped, and a candidate must be observed untracked on TWO consecutive cycles before it's closed.
13. **Slippage headroom on adds and removes** (audit F3/F4, fixed): `addLiquidity` sized at the full free balance fails on-chain — the builder's max = amount × (1+slippage), and the WSOL path pre-funds the max, so it's deterministic there. The vault wrapper now clamps input to balance/(1+slippage) minus the gas reserve. Symmetric on the way out: a decrease's token-min guard on an actively-arbed tight pool can fail faster than a 90s retry loop re-quotes (the silent every-cycle shift failure) — removes now run at 2× slippage (capped 10%), and a failed shift logs its stage + error instead of burying it in a discarded return value.

---

## Product build plan (7-agent review, 2026-09-01 — index)

The full reports live in the session record; this is the decision index. **Before the JVP takes its first paying client:** (1) split the overloaded admin key into three secrets (vault admin / client-token HMAC / premium) — today one leaked string unlocks every client's money ops; (2) hard price-impact ceiling inside `manualSwap` for project-token sells (the manual route can currently dump a client float in one call); (3) automated pre-engagement forensic screen using our own autopsy/holders/lock tools (mint+freeze authority, concentration, LP locks) — a `screenPassed` flag the arm path enforces; (4) per-client operator wallets via an encrypted key store (`OPERATOR_KEK` + `/data/operators/*.enc`) so onboarding needs NO Railway edit and NO redeploy — a restart per onboarding across live client engines is the single most dangerous thing in the current shape. **The build**: registry-driven generic engine (zero-deploy onboarding; existing kv keys become registry data), master scheduler with jitter + concurrency cap + circuit breaker, one-call `/api/jupverify/bootstrap` encoding every Phase 0-2 trap as a precondition, 2-hourly fleet sweep (edge-triggered paging), wind-down endpoint (PLAN≠EXECUTE, no external-transfer primitive in v1 — final send stays manual), and the `/jupverify` intake dashboard + `/jupverify-admin` queue (one PR, spec in the session record). **Jupiter reality (2026)**: verification = Jupiter VRFD (verified.jup.ag); free standard lane or Express at 1,000 JUP (~$420, non-refundable) with a programmatic API whose schema is the intake field list; judging = mcap, organic score, holder distribution, ticker uniqueness, **social support (their #1 criterion — the client's real X community, not purchasable by us)**, liquidity (only USDC/USDT/SOL-quoted counts toward Liq/MC); verification is revocable on inactivity. **Offer honesty floor**: custody named as custody, "the engine sells your token by design" signed before engagement, grey router volume shown grey, score sold as rented runtime, verification sold as Jupiter's decision. `/liquidity-engine` still says "not yet offered to other projects" — updating it is part of launch.
