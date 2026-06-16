# CLAUDE.md — Cluck Norris (CLKN)

Operating notes for any Claude Code session — **especially cloud/web sessions, which
start from a fresh clone with no local files.** Read this first.

## What this is
School of Crypto Hard Knocks — a free Solana crypto school + free token-research tools,
wrapped around premium operator tools paid for in CLKN micropayments (no wallet-connect
to pay). Live at **clucknorris.app**. This repo (`clucknorrisapp/cluck-norris-school`) is
the **canonical source** and the **hackathon + Solana Foundation grant** entry — so
accuracy in the public docs (`README.md`, `public/investors.html`, `public/grant.html`)
matters, and claims should match the code.

CLKN mint: `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`

> 🛑 **ENGINE STATUS (2026-06-12, owner's call): NO CLKN pools at all — full-earner
> strategy.** The clkn Orca vault is PAUSED with zero positions; CLKN trades only on the
> community Meteora pool (64WXkH…, 2% fee). The operator wallet holds ~10.6M CLKN (brand
> bag — NEVER sold) + ~1.1 SOL gas + ~$30 USDC. The 1%-tier CLKN/USDC Orca pool
> (EnTZxY…) and the CLKN/JUP pool (5AvtoSvf…) exist on-chain but are EMPTY — harmless
> shells. Do NOT redeploy CLKN liquidity or buy/sell CLKN without the owner asking.
>
> ⏸️ **THE EARNER — PAUSED (owner's call, 2026-06-16): funds PULLED from the pool.** With high
> market volatility the close→swap→reopen rebalancing was crystallizing too much IL (fees beaten
> by impermanent loss), so the owner withdrew all JUP/USDC liquidity to the treasury wallet and is
> stepping away to work on other things. **Will REDEPLOY when the market calms to fine chop** (the
> regime this DLMM strategy actually wins in). DO NOT re-open a position or re-enable the rebalancer
> without the owner's explicit ask. With no position, all the JUP/USDC schedulers (recap, pool-monitor,
> OOR alerts, daily LP-vs-HODL check) self-silence. To fully stop the loop too:
> `/api/meteora/config?which=jup&enabled=0&key=…` (re-enable later with `enabled=1`). Everything
> below is kept intact for the redeploy. ⬇️
>
> 💰 **THE EARNER (the main money-maker when live): JUP/USDC Meteora DLMM** pool
> `HfgjZDmexhFVD28Vkb1NbQwWeXP3uDcVTLPjSGHmRHhL` (~6x/day turnover) under the TREASURY
> wallet (`MM_OPERATOR_SECRET_TREASURY`, pubkey 2zMCU…). **~$4K, ±4% SPOT distribution**
> (switched curve→spot 2026-06-15; **WIDENED ±3%→±4% on 2026-06-16, owner's call** — fewer recenters =
> less impermanent-loss crystallization, after the owner flagged fees being eaten by rebalance swaps;
> autonomous reopens spread liquidity EVENLY across the band; growing toward ~$5K with manual adds).
> `cfg.halfWidthPct=4` is the new default; the LIVE position only adopts ±4% on its next reopen — to widen
> NOW: `/api/meteora/config?which=jup&halfWidthPct=4&key=…` then `/api/meteora/recenter?which=jup&run=1&force=1`.
> Strategy: fees COMPOUND in-position; CLKN buybacks MANUAL-ONLY on the owner's explicit ask.
> **WHERE THE FEES GO (owner's 2026-06-16 question — "made ~$400 fees, position only grew ~$150"):** the gap is
> mostly IMPERMANENT LOSS, not swap fees. Each recenter swaps the freed funds to 50/50 at the current
> (post-move) price — when OOR it's sold the dumped side low — crystallizing IL. The swap *fee* itself is tiny
> (price-impact-capped 0.2%). The fix is FEWER recenters (the ±4% widen), not cheaper swaps — you can't route
> around IL. LP-vs-HODL (below) now makes this measurable.
>
> ⏸️ **AUTONOMOUS REBALANCING = PAUSED (2026-06-16, funds pulled — see banner above).** When live it
> was the `jupUsdcRecenter` close→swap→reopen loop ("Option B"), owner-authorized 2026-06-13 and
> VERIFIED LIVE (recentered 58%→50% across, rebalanced to 50/50, **$0 wallet residue**, value intact).
> The mechanics below stay valid for the redeploy. DON'T rip it out or re-enable without the owner's say-so.
> WHAT FINALLY WORKED, and WHY earlier attempts failed (so the next session doesn't undo it):
> the UI "Rebalance" = a Jupiter swap (heavy side → ~50/50, e.g. "Swaps Required: 6.93K
> JUP → 1.17K USDC via Jupiter") **+** a DLMM redeposit, fired as a Jito bundle. The bare
> SDK `rebalancePosition`/in-place tool does the recenter but **NOT the swap**, so it
> strands the unfittable side ($145–$478 left in wallet) — that's the in-place path, still
> NOT what we use. `getAutoFillAmountByRebalancedPosition` mislead​s (returns "USDC to ADD",
> not the 50/50 swap) — do NOT trust it. The WORKING recipe (`jupUsdcRecenter`): close (rent
> ~fully refunded) → swap the freed funds to **50/50 by value at the current price** (simple
> value math, NOT the autofill — validated against the owner's UI numbers) → **reopen a
> FRESH position via `openPosition`** (deposits everything → $0 residue, unlike the in-place
> redeposit). New NFT each time (cosmetic; owner OK'd it). Safety rails: **0.2% Jupiter
> price-impact ceiling** (`cfg.maxImpactPct`; a costlier route SKIPS the swap and reopens
> centered-but-unbalanced, funds intact — never eats >a sliver, since ~1% would wipe a day's
> fees), **±3% width** (`cfg.halfWidthPct`), **SPOT distribution** (`cfg.distribution`, was curve
> until 2026-06-15), **SPLIT anti-thrash** — OOR (earning $0) reacts
> on the next check (`minRecenterSecOor` 120s), near-edge-but-earning waits (`minRecenterSec`
> 1800s) so it can't churn IL on chop — edge trigger `edgeFrac 0.12`. Loop:
> `jupUsdcRecenterTick` (server.js, 5-min) gated on
> `jupUsdcCfg().enabled`; turn off via `kv jupUsdcCfg {enabled:false}` or
> `/api/meteora/config?which=jup&enabled=0`. DMs the treasury chat on each rebalance (owner
> wants these notifications ON). Manual lever: `/api/meteora/recenter?which=jup&run=1&force=1`.
> **Also built (complementary, read-only):** `meteoraOorTick` (server.js ~7877, 5-min) now
> DMs on NEAR-EDGE (>88% across) and OUT-of-range transitions.
>
> 📊 **Private recap (DONE):** `sendJupUsdcRecap` DMs the TREASURY chat (operator-only, NOT
> community) every 6h with liquidity + claimable/claimed fees + a fees-vs-cost delta;
> `/api/jup-recap-test` (&send=1/&reset=1). The old cbBTC/SOL 6h treasury report is DISABLED.
> NOTE: the treasury wallet now holds ONLY the JUP/USDC position — no cbBTC/SOL backbone.
> **LP-vs-HODL (added 2026-06-16, the only honest "are we winning?" number):** recap + `/api/pool-monitor` +
> the `/pool-monitor` page now show LP value vs. what the BASELINE token basket (JUP+USDC) would be worth now
> (`jupLpVsHodl`/`ensureJupHodlBaseline`, baseline in kv `jupUsdcLedger`). Positive = fees beat IL; negative =
> IL+swap cost eating fees. Swap cost is no longer a flat $1/recenter — `jupUsdcRecenter` now logs the REAL
> impact (`|diff|·impactPct`) into `rebalanceCostUsd`. **⚠️ LIMITATION: manual adds/removes aren't tracked —
> re-baseline with `&reset=1` right after any add/remove or the comparison skews.** (The recap `reset` also
> re-baselines the HODL basket.) Pool-monitor `PACE` is now a trailing-30-min window (was a noisy 2-min delta).
> **Daily LP-vs-HODL check-in (`jupLpVsHodlDailyCheck`, server.js — hourly tick, DMs once per 24h):** the durable
> "review it once data accumulates" hook the owner asked for (2026-06-16). Fires only after the baseline is ≥24h
> old; DMs the treasury chat a focused verdict (fees beating IL ✅ / IL eating fees ⚠️ + the action: widen further
> or slow `minRecenterSecOor`). Lives in the always-on server so it survives container/session resets. kv
> `jupLpHodlCheckAt`. (A cloud session can't self-schedule days out — the container is ephemeral — so the check-in
> is server-side by design.)
>
> ⏰ **ACTIVE WATCH (updated 2026-06-12): CoinGecko REJECTED the reapplication**
> (req `CL1106260002`; owner reported the rejection 2026-06-12 — stated reason not yet
> in the session, ask for the email text). Strategy: build a visibly better tape and
> REAPPLY in ~2-4 weeks. Levers: volume mode is LIVE (±5%/±8% engine widths since
> 06-12); JUP sleeve code SHIPPED (jupEnabled, default off) — plan is ADD CLKN/JUP as a
> 4th market, do NOT close CLKN/SOL for it (SOL is the routing artery; JUP vol is 1.75x
> SOL daily but an extra arb hop widens the no-arb band — replacing loses routed flow);
> a CLKN buy comp is the strongest real-volume lever (owner decides prizes). Original
> owner's call 2026-06-12 still stands:
> the organic-score recovery test is DEPRIORITIZED (the 2026-06-11 change freeze is
> LIFTED) — optimize 24h volume and number/diversity of live markets instead. Context
> kept for later: the score sat at 0 because pulling the engine killed Orca routability
> (`orcaRoutable:false`); engine was redeployed 06-11 via staged seed, both Orca pools
> live at settled config, dislocation pinned at the ~2% Meteora-fee arb floor. If/when
> the score matters again, the untested thesis is deep+passive+zero-operator-churn over
> ~72h. VOLUME levers ranked (real third-party volume only — CoinGecko actively detects
> wash/self volume, so NO operator wash, NO self-buyback pumping for numbers): tighter
> engine ranges → more tax-floor arb flow; more markets (cbBTC sleeve is code-ready,
> `btcEnabled` — a JUP sleeve would be NEW code); a CLKN buy comp (real wallets, real
> volume — infra ready). Public "0→32+" organic copy still unverified — keep it off new
> material until retested. Remove this note when CoinGecko decides.

## Working agreement
- **Always commit AND push to the active working branch** — hackathon pace, standing
  permission to push. Give a heads-up before anything touching `main` (merge/PR) or
  destructive (force-push, `reset --hard`, branch delete).
- Railway **auto-deploys from `main`**, so branch work must reach `main` to go live.
- **Never commit secrets.** Don't put a model identifier in committed files.

## Repo layout
- `server.js` — the monolith (~9k lines): every API endpoint, the Wallet X-Ray, CLKN
  payment verification, Telegram/X automation, the trade poller, all schedulers, and
  static file serving. (The Token Autopsy engine was extracted to `lib/autopsy.js`.)
- `lib/` — `bags-context`, `solana-tracker`, `solscan`, `premium-forensics`, `analytics`,
  plus volume-backed stores: `kvstore`, `sigstore`, `recap`, `grad-tracker`, `credentials`.
  `helius-trades` — Helius-based buy tracking: `getTokenBuyersInWindowHelius` (who bought
  token X in a window — pool sigs + batched enhanced-tx parse) and
  `getWalletTokenPositionHelius` (balance + sells/transfers, the 48h hold check). The
  buy comp + Buy Special route through server.js's `buyersInWindowMulti` /
  `walletPositionMulti` helpers: **Helius primary → GeckoTerminal (free) → Solana
  Tracker (quota-billed, last resort)**. Don't re-point buy tracking at ST directly.
  `solana-addr` — pure address primitives (base58 codec, ed25519 on-curve check, ATA
  derivation) + the DEX/locker/token-program, program-label, service-wallet and CEX-wallet
  tables; one source of truth for trace/snapshot/autopsy/wallet-xray classification.
  `autopsy` — the Token Autopsy engine: `runAutopsy(mint, {nocache}) → {status, body}`;
  the `/api/autopsy` route in server.js is a thin wrapper (validation + 3-min cache +
  headers). It also exports `bagsFetch`/`heliusEnhancedBatched`/`BAGS_BASE`, which
  server.js re-imports (shared with /api/fees, /api/reinvestment, premium forensics).
  `rpc` — resilient RPC: one endpoint list (primary Helius + optional backups + public
  node) and a failover `fetch`/`connection()`; the engine libs + server RPC proxies route
  through it, so a primary 429/outage rolls to a backup instead of going blind.
  Liquidity Engine: `orca-whirlpools` (Orca Whirlpools concentrated-LP market maker —
  non-custodial tx builders) + `whirlpool-vault` (the autonomous LP manager).
- `data/question-bank.json` — the Ultimate Challenge question pool (server-owned; the
  client never ships the answer key). See the credentials note below.
- `hatchery.js` (guided token creator), `securitycoop.js` (approval revoker), and
  `whirlpool-mm.js` (Liquidity Engine — Orca Whirlpools market maker + autonomous vault) —
  Express routers mounted by `server.js`.
- `public/*.html` — standalone vanilla-HTML tool pages: autopsy, wallet-xray, trace, snapshot,
  holders, airdrop, buyspecial, rose, hatchery, security-coop, wallet-checkup, liquidity, premium,
  slots, bags, tools, investors, grant, stats, transcript, pool-monitor.
  ⛔ **Cluck Score was REMOVED (2026-06-15, owner's call): it gave good scores to tokens that
  then rugged — misleading, not worth it. Do NOT rebuild it.** Gone: `/score` page + `score.html`,
  `/api/cluck-score`, `/api/cluck-card`, `renderScoreCard`, the `/score` Telegram command, and all
  links. The replacement free flagship is **Wallet X-Ray** (`/wallet-xray`, `/api/wallet-xray`).
- `src/` — the React/Vite school (landing app).

## Credentials / transcripts (the school's permanent output)
- A learner earns a permanent, shareable transcript by **passing the Ultimate Challenge**
  (a *verified* diploma) **or** finishing the full curriculum (graduation). Both doors
  collect a Solana address via `/api/claim`, which still appends the airdrop list to the
  Google Sheet AND writes a per-wallet record to `lib/credentials.js` (`/data/credentials.json`).
- **The exam is scored server-side.** `/api/exam/questions` draws 50 from `data/question-bank.json`,
  shuffles each question's options, and returns them WITHOUT the correct index. `/api/exam/submit`
  scores the choices; a pass (≥94%) mints a one-time token that `/api/claim` requires to record a
  diploma as `verified: "server-scored"` (otherwise `self-reported`). Don't reintroduce client-side
  scoring or ship the answer key to the browser.
- ⚠️ **Question-bank drift:** the quiz questions live in BOTH `src/App.jsx` and `data/question-bank.json`
  (the exam pool), and they are NOT auto-synced — edit a quiz in one place, mirror it in the other (the
  bank has no live regenerator anymore). The bank's `source` field tags origin: `CURRICULUM` (70, from
  `LESSONS[].questions`) + `ULTIMATE` (59, exam-only) + `LPLAB` (81, ported from `LP_LESSONS[].sections[].quiz`)
  = 210 total. So both `LESSONS[].questions` AND `LP_LESSONS` quizzes feed the exam — if you materially edit
  either, re-port into the bank (match the `source` tag). The exam draw is STRATIFIED by source —
  `EXAM_SOURCE_MIX` in server.js pins 20 CURRICULUM / 20 ULTIMATE / 10 LPLAB per exam (backfills from
  the leftover pool if a source runs short), so adding questions to one source no longer skews the exam.
  Remaining structural gap: the App.jsx↔bank sync is still manual (no CI drift check yet).
- Public surfaces: `/transcript/:slug` (page, with OG card), `/api/credential/:slug` (JSON — exposes
  holder *status* only, never balance), `/api/credential-card?slug=` (PNG), `/api/school-stats`
  (aggregate verified-graduate metrics, shown on the grant + investor pages).

## Secrets live on Railway, NOT in the repo
The repo ships zero secrets; a fresh clone (every cloud session) has none. Runtime secrets
live in **Railway** (the app) and the **Claude-web environment** config (so sessions can
run things). Var names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HELIUS_API_KEY`,
`BAGS_API_KEY`, `ANTHROPIC_API_KEY`, `SOLANA_TRACKER_API_KEY`, `SOLSCAN_API_KEY`,
`PREMIUM_ACCESS_KEY`, `BUYCOMP_KEY` (scoped password for the buy-comp portal `/buycomp-admin` + `/api/buycomp/*`; master key also works), `X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET`,
`GOOGLE_SHEET_ID/GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY`, `HATCHERY_TURBO_KEY`,
`COINGECKO_API_KEY`, `DATA_DIR`, `MM_OPERATOR_SECRET` (the Liquidity Vault's dedicated
hot wallet — base58 or JSON secret key; UNSET = the autonomous vault is fully off, a safe
no-op. Use a wallet holding ONLY the MM float, never the treasury or any mint authority).
Optional RPC resilience (all unset = primary-only, fine): `FALLBACK_RPC_URL` (one or more
full backup RPC URLs, comma-separated — e.g. a QuickNode/Triton/Alchemy endpoint),
`HELIUS_API_KEY_2` (a second Helius key on a separate quota), `RPC_DEBUG` (=1 logs failover).
Gitignored & local-only (do **not** expect these in a cloud session): `.env`, `.claude/`,
`STRATEGY.md`.

## Critical runtime facts
- **The entire scheduler block** (buy/sell alerts, Cluck's Lesson, Launch Radar, Market
  Check, daily recap, graduation watcher, the webhook setup) **only starts if
  `TELEGRAM_BOT_TOKEN` AND `TELEGRAM_CHAT_ID` are set at boot.** Missing either → none of
  it runs. This is the #1 thing to check when "the bot isn't doing X."
- **Buy-comp/Buy-Special data is multi-source:** Helius primary → GeckoTerminal → ST last
  resort (see `lib/helius-trades`). ST quota exhaustion no longer darkens a live comp.
  ST remains REQUIRED for launchpad-specialty reads only: token creator, bonding-curve %,
  deployer history — i.e. the Bags monitoring below + parts of autopsy/premium forensics.
- **Bags monitoring (near-grad + graduation alerts) depends on `SOLANA_TRACKER_API_KEY`.**
  Fast health check (no key needed): `GET /api/bags-near-grad` — returns `tokens:[…]` =
  pipeline alive; empty/`success:false` = ST key or quota.
- X cross-post needs all four `X_*` keys, else silent no-op. A raw contract address in a
  tweet 403s for ~7 days after auth, so lesson tweets link a DexScreener URL instead.
- **The X account is PREMIUM — long-form posts are allowed (up to ~25k chars). DO NOT truncate
  tweets to 280; that limit does not apply to us.** Post the full content (e.g. the whole Daily
  Alpha brief) rather than a teaser. (Owner correction, set 2026-06-14.)
- **Always tag `@JupiterExchange` (routing artery + our JUP/USDC earner's venue) and `@BagsApp`
  (launchpad + hackathon host) in X posts**, plus the relevant projects' own handles
  (CoinGecko `links.twitter_screen_name`) for engagement. (Owner ask, 2026-06-14.)
- Persistence: Railway volume at `/data` (consumed payment signatures, graduation tracker,
  scheduler timestamps, analytics, transcripts/credentials) — survives redeploys.

## Gated admin / test endpoints (require `?key=PREMIUM_ACCESS_KEY`)
- `/api/tg-test?text=…[&loud=1]` — post a custom one-off message to the Telegram chat
  (silent by default; `&loud=1` pings). Use this to send a "we're testing" notice.
- `/api/bags-radar-test`, `/api/market-check-test`, `/api/recap-test`, `/api/edu-post-test`,
  `/api/x-post-test` — dry-run the scheduled posts; add `&post=1` to actually fire.
- `/api/grad-watch-status[&run=1]` — graduation watchlist + the 48h graduated record.
- `/api/stats` — traffic dashboard data. `/api/autopsy-premium` — gated deep forensics.
- `/api/claims` — the full airdrop list (wallets + balances) from the Google Sheet.
  Gated on `PREMIUM_ACCESS_KEY`; returns 404 (not 401) when the key is wrong/absent.
- `/api/whirlpool/vault/status|tick|pause|resume|config` — the autonomous Liquidity Vault
  (Orca Whirlpool LP manager). 404 without the key. `tick` is a DRY RUN unless `&run=1`;
  it only acts when `MM_OPERATOR_SECRET` is set. The public `/liquidity` tool and the
  `/api/whirlpool/*` read/quote/build endpoints are non-custodial and ungated.

## Liquidity ops — durable session memory (read this; don't rediscover it)
Live money is managed across two systems. Facts here survive container resets/compaction.
- **Treasury** (wallet env `MM_OPERATOR_SECRET_TREASURY`, pubkey `2zMCU…`): lives on
  **Meteora DLMM cbBTC/SOL** pool `Hz1EtXTGaFEtAWRgRNpDMFV6vnSZtQUY9UqmdM6vfKSS` (picked for
  ~10–19x vol/TVL turnover vs Orca's crowded $5M pool, where our ~$1.2k was ~0.02% of depth).
  One position, **±0.6% Curve** (center-weighted), **autoRecenter ON** (kv `meteoraCfg`:
  edgeFrac 0.12, minRecenterSec 1800; 5-min loop closes→rebalances 50/50→reopens centered and
  DMs). OOR monitor DMs on out-of-range/back-in-range. The **Orca treasury dual-sleeve is
  EMPTY/paused** — don't resume or "re-seed" it; funds are on Meteora deliberately.
- **Goal:** grow the **BTC+SOL stack >0.5%/day in ASSET terms, not USD** (LP-vs-HODL edge).
  Daily recap DM is token-denominated (kv `treasuryRecapSnaps`; `&reset=1` re-baselines after
  restructuring). 6h treasury report folds Meteora value+fees in.
- **CLKN engine** (env `MM_OPERATOR_SECRET`): normal = `widthPct 10 / solWidthPct 15 /
  deployFrac 0.95`; both pools on the fine **0.02% tier** (spacing 2) and we ARE ~100% of
  their depth. **CLKN Blitz** = timed tight-range burst tool, reset-proof auto-revert
  (kv `clknBlitzUntil`/`clknBlitzRestore`).
- **Hard conventions:** "auto-balance" = swap **SOL↔USDC only — NEVER sell CLKN** (the brand
  bag is never sold). **And NEVER BUY CLKN with operator funds without asking the owner in
  that moment either** (owner rule, set 2026-06-12 after unwanted inventory buys — the owner
  holds plenty of CLKN; fix inventory imbalances with thresholds/holding quote idle, not buys). Gas floor `swapSolFloor 0.2` on treasury + clkn. `suggestRanges` min
  width is 0.05% (was 0.5% — that floor once silently clamped ±0.2% asks to ±0.5%).
  Meteora rent is ~fully refunded on close (bins pre-initialized) — re-centers cost ≈ tx fees.
- **Gated endpoints** (all `?key=PREMIUM_ACCESS_KEY`, dry-run unless `&run=1`):
  `/api/meteora/status|remove-liquidity|add-liquidity|open-position|recenter|config`,
  `/api/clkn-blitz` (`&abort=1` reverts now), `/api/treasury-recap-test` (`&send=1`).
  Meteora SDK `@meteora-ag/dlmm` is lazy-loaded; `removeLiquidity` takes `close=1` to
  claim+close; `open-position` takes `half=` + `dist=spot|curve|bidask`.
- **Cloud session recovery:** containers reset mid-session. If files look stale:
  `git fetch origin --prune && git checkout claude/<branch> && git reset --hard origin/claude/<branch> && npm install`.
  GitHub is always the truth; nothing committed is ever lost. `MIN_BUY_USD` default is 15.

## Venue decision (settled — don't re-debate)
**CLKN stays on Orca; treasury stays on Meteora.** Different reasons per asset:
- **CLKN/USDC + CLKN/SOL = Orca ADAPTIVE-fee pools** (dynamic fees that rise with volatility —
  captures memecoin pump/dump upside) + cheap rent (~0.006 SOL/position, vs Meteora's
  width-scaled bin-array rent) + **we own ~100% of the liquidity** (so we already capture ~all
  fees — no crowding to escape) + organic-score-safe + the full engine (Blitz/ask-wall/sol-vault).
  No benefit to moving CLKN to Meteora; do NOT.
- **Treasury cbBTC/SOL = Meteora** specifically because the Orca cbBTC pool was a crowded $5M
  pool where our ~$1k was ~0.1% of depth; Meteora is thin + high-turnover so our size is a real
  fee share. (That crowding rationale is unique to the treasury — it does NOT generalize to CLKN.)

## Meteora ops learnings (hard-won; don't repeat the mistakes)
- **Wide opens = MANY txs.** This pool's bin step is ~1 (0.01%/bin), so width→bins is huge:
  ±0.6%≈121 bins (~5 txs), ±1.5%≈300 (~12), ±2.75%≈540 (~21). The narrow chaser re-center is
  reliable; very wide opens are slow and can partially land. `signSendTx` now REBROADCASTS the
  signed tx every 3s until confirmed (≤150s) instead of a single 90s wait that aborted whole
  opens (the txs were landing — the confirm just timed out → orphan partials). `_openPosition`
  attaches `err.partial = {positions,sigs}` so a mid-sequence failure surfaces the orphan.
- **±2.75% is too wide/thin/expensive here** (540 bins, far-bin init rent ~$25-30, thin
  density). Sweet-spot backbone on this fine-tick pool is **±1% to ±1.5%**.
- **Layout NOW (settled 2026-06-10, owner's call): ONE wide "always-on" position.** ~±2%
  CURVE (center-weighted density, wings keep it in range), full stack, autoRecenter OFF —
  alerts only; any re-center is a deliberate manual decision. The owner explicitly prefers
  "always earning at a lower rate" over tight chasers that whip out (tight ±0.34-0.6% chasers
  died in hours on volatile days; every churn event crystallizes IL). Don't re-introduce a
  chaser without an explicit ask. cfg pinned: halfWidthPct=2, distribution=curve.
- **⚠️ "another fund-moving op is in flight" = the FIRST call is probably EXECUTING. CHECK
  `/api/meteora/status` BEFORE retrying.** Twice now an open "failed" with lock-busy or
  insufficient-funds errors while the original call had actually LANDED the position — the
  retries were trying to deploy already-deployed funds. Status first, always.
- **Rent is paid in NATIVE lamports.** open/add now auto-unwrap stranded wSOL
  (`/api/meteora/unwrap` is the manual lever) — but "insufficient lamports" right after ops
  usually means the funds are already IN a position (see the rule above), not missing.
- **autoRecenter:** keep OFF under the wide-position layout; if ever re-enabled, pause it
  (`/api/meteora/config?autoRecenter=0`) before any manual position surgery so the loop
  can't contend for the wallet.

## Audit status (full-app review done — don't re-litigate the clean parts)
A whole-codebase security review (2026-06-10) found **zero critical/theft-class bugs**. Sound &
reviewed: payment/replay path (sigstore is atomic test-and-set + now fails CLOSED on a durability
fault), RPC proxy (default-deny allow-list, no SSRF), exam/credentials (server-scored, single-use
tokens), secrets/PII, auth (every fund/secret route key-gated, fail-closed, 404-not-401), slots,
buyback. All session-built liquidity findings were FIXED & shipped: re-center never strands funds
(try/catch → meteoraReopenPending retry + DM), fee-bank durable across confirm-timeouts
(meteoraFeePendingBank + reconcile), confirmSig tolerates RPC blips, in-process mutex on
meteora fund-moving calls, blitz revert work-then-clear + double-start guard, pinned managed
chaser pubkey (meteoraManagedPubkey), token-denominated 24h fee delta, Raydium range guard,
trace.html/autopsy.html XSS escaped. The LOW hygiene backlog is now CLEARED except one item:
`source` whitelist DONE (prettySource only renders Helius-enum-shaped strings, else generic
"DEX"), header-vs-`?key=` admin auth DONE (adminAuthOK prefers x-premium-key header; `?key=`
is a deprecated fallback), generic RPC error passthrough DONE (publicErrMsg strips
credential-bearing URLs + bounds length on every 500). Remaining: range-label honesty on the
public endpoint — still open, still not a vuln.

## Conventions
- Tool pages are vanilla HTML + inline JS; the school is React. **Escape any API/token-
  supplied string before `innerHTML`** — token names/symbols are attacker-controlled.
- Forensic rule everywhere: **state what's on-chain, never assert intent** ("the chain
  shows *what*, not *why*"). Only call a wallet "creator/team" when a launchpad API
  (Bags/Pump) confirms it.
- Payment model: a unique-decimal CLKN transfer, verified on-chain and replay-guarded;
  holders of ≥2M CLKN get a 5× unlock bonus read straight from the payment tx.
- **Telegram posts are SILENT by default — NEVER `&loud=1` unless the owner explicitly
  says so in that moment.** (Owner rule, set 2026-06-10 after an unwanted ping.)
- **Community-post accuracy:** the engine/Blitz trades happen on the TWO Orca pools —
  CLKN/USDC `H1r9ut25xAU1B1AbZRhvSJjShd4Q3mtmysYHBisFES7H` and CLKN/SOL
  `EL1ZDnuTE4J4LZJLP76VapFSDiM7Xt18ZsnzVeqNvaPr` — NOT the main Meteora pool
  (`64WXkH…`, the canonical chart). Link the Orca pair pages when posting about
  engine/Blitz activity. And don't claim superlatives ("tightest ever") without
  checking history — ±0.2 Blitzes have been run.

## Build / check
- Run: `npm start` (= `node server.js`). React dev/build: `npm run dev` / `npm run build`.
- After editing backend JS, sanity-check syntax: `node --check server.js` (and any lib you touched).
- CI: `.github/workflows/syntax-check.yml` runs `node --check` on every backend entrypoint +
  `lib/*.js` on each push — the minimal tripwire for the no-staging auto-deploy.
- No automated test suite beyond that.

## Deferred / check later
- **CoinGecko listing — REAPPLIED 2026-06-11 (awaiting decision).** Request ID
  `CL1106260002`, submitted via partner.coingecko.com; CoinGecko said ~5 business days.
  Public verification post is LIVE on X (@firechicken007):
  `https://x.com/firechicken007/status/2064885046708683046` (contains the request ID +
  GeckoTerminal URL — the anti-fraud step they require; no email reply needed, their team
  finds the post). The confirmation email is no-reply. Already on GeckoTerminal as "Cluck
  Norris (CLKN)". Application facts used (all verified on-chain): total supply 999,998,515,
  circulating 808,589,941, ~191,408,574 (~19.14%) locked across 28 Jupiter Lock escrows,
  mint+freeze renounced, ~2.5mo trading, 3 pools (Meteora 64WXkH… + Orca H1r9ut… USDC +
  Orca EL1ZDnu… SOL). If CoinGecko replies with questions, answer from these. Prior
  rejection reason was "need real volume + time in market" — both now satisfied.
- **`/api/helius-rpc` is now a true allow-list** (default-deny). It permits only the
  lightweight read + tx-build/send methods the client tools use (see `ALLOWED_RPC`
  in the handler) and handles JSON-RPC batch bodies; everything else
  (`getProgramAccounts*`, all `*Subscribe`, block/supply/cluster scans, etc.) is
  rejected. Matches the README's "allow-listing" claim. If a tool ever needs a new
  RPC method, add it to `ALLOWED_RPC` — a missing method returns 403.
- **Slots: provably-fair — DONE (both RNG paths).** Spins use commit‑reveal: the
  server commits `sha256(serverSeed)` before each spin (`fairCommit` in `/state`,
  `nextCommit` on every spin), derives the outcome from
  `sha256(serverSeed:clientSeed:nonce)`, reveals the seed after, and rotates it
  EVERY spin (a revealed seed must never predict a future spin). The weekly wheel
  draw uses a per‑week committed seed (`weekFairCommit`, public in `/state` all
  week) — wild‑card shuffle and winner pick both derive from it + the published
  entrant composition, so the whole draw is recomputable from the draw record.
  `Math.random()` is gone from every slots outcome path; real prizes are no
  longer blocked on this. Odds remain published via `slotOdds()`.
  Daily spins (banded 5/10/15/20 by balance) refresh at the next UTC midnight via
  `slotDayEndsAt()`; the page shows a live "next free spins in …" countdown
  (`spinsResetAt` is returned from `/api/slots/state`, the spin response, and the
  `no_spins_left` 429). The points-week board reset is the separate `weekEndsAt`.
- **Autopsy: latent `excludeSet` bug (pre-existing, NOT yet fixed — needs a decision).**
  In `lib/autopsy.js`, the Phase 2G‑bis sub‑distributor filter references `excludeSet`,
  which is defined NOWHERE (entered dangling in the Wallet‑Safety‑Checkup commit). Any
  time sub‑distributor candidates exist it throws inside the phase's try/catch, silently
  disabling the team‑network multi‑hop trace — so that path has never run in production.
  Fixing it (e.g. `const excludeSet = new Set(Object.keys(KNOWN_CEX_WALLETS))` per the
  neighboring exclusion‑set comment) would ENABLE a never‑exercised code path — do it
  deliberately and verify the report output on a few mints, don't drive‑by it.
- **Autopsy premium styling — design decision (not yet made).** The premium
  forensic sections render in a different color scheme that doesn't match the
  site's dark/orange theme. Open question: leave it visually distinct so the
  premium tier *stands out*, or restyle it on-brand for consistency? Decide
  intentionally before touching it.
