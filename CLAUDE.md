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

> 🟢 **ENGINE STATUS (2026-06-17, owner's call — SUPERSEDES the old "no CLKN pools / full-earner"
> note): CLKN is actively LP'd across THREE Orca pairs as a MULTI-QUOTE ARBITRAGE STRATEGY,
> owner-managed MANUALLY.** Live two-sided positions under the **TREASURY wallet
> `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`**: **CLKN/USDC** (`H1r9ut25xAU1B1AbZRhvSJjShd4Q3mtmysYHBisFES7H`),
> **CLKN/SOL** (`EL1ZDnuTE4J4LZJLP76VapFSDiM7Xt18ZsnzVeqNvaPr`), **CLKN/JUP**
> (`5AvtoSvfKFscxoB9uuEG2UNf25REkzgr9Ue9RHnJWMdb`, 0.02% — moved here from the old 0.05%
> `7eVP5Jqe…` on 2026-06-17) — ~9.9M CLKN in layered tight-inner/wide-outer
> bands, all in-range. **Thesis (now PROVEN, not theoretical): pairing CLKN against multiple
> volatile quote assets (SOL + JUP, anchored by stable USDC) means each quote's OWN volatility
> dislocates CLKN's cross-pool price → third-party arbitrageurs trade it back into line → real,
> organic two-way volume the project doesn't generate itself.** JUP (~1.75× SOL daily vol) added an
> independent SECOND dislocation engine → volume jumped and **Jupiter organic score climbed to 33.0**.
> (Each arb is a small IL bite on the LP; net-positive while fees + organic standing outrun it.)
> ⛔ **AGENT IS WATCH-ONLY. The owner controls these positions MANUALLY. Do NOT rebalance, recenter,
> close, redeploy, add/remove liquidity, or buy/sell CLKN — and do NOT "take over" — until the owner
> explicitly says so.** We are in a strategy-BUILDING phase: observe how the structure moves, log it,
> don't touch it. The brand bag (~10.6M CLKN) is still NEVER sold. Public organic-score copy stays
> OFF the site until the 33 holds longer (owner's call). The community Meteora pool (64WXkH…, 2% fee)
> remains the canonical chart.
>
> ⛔ **THE EARNER — AUTONOMOUS REBALANCER HARD-KILLED IN CODE (owner's call, 2026-06-16:
> "stop rebalancing period, don't touch it").** Background: the owner pulled all JUP/USDC liquidity
> in high vol (close→swap→reopen was crystallizing too much IL), then opened a NEW position MANUALLY —
> and the still-`enabled` autonomous loop AUTO-ADOPTED it (`jupUsdcRecenterTick` pins any JUP/USDC
> position it finds) and recentered it to ±4% spot, changing the owner's manual setup. Funds were
> intact (recenter preserves value), but it touched a position it shouldn't have. **FIX SHIPPED:**
> `JUP_AUTO_REBALANCE_KILLED = true` in server.js hard-gates the tick so it NEVER calls
> `jupUsdcRecenter` — independent of `jupUsdcCfg.enabled`, so no kv flag can revive it by accident.
> **DO NOT re-enable** (set the const false AND `jupUsdcCfg.enabled`) without the owner's explicit ask —
> this is a deliberate two-step opt-in by design. The owner manages positions MANUALLY now; the loop
> must not adopt them. The manual lever (`/api/meteora/recenter?which=jup&force=1`, key-gated) is left
> available but only ever runs when the owner explicitly calls it. Read-only schedulers (recap,
> pool-monitor, OOR alerts, daily LP-vs-HODL) don't touch positions; they self-silence with no position.
> Everything below is kept intact for an eventual deliberate redeploy. ⬇️
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
> **🆕 VAULT LP-vs-HODL (2026-07-05 — the same honest number, ported to the Orca/Raydium vault, PER PROJECT):**
> `lpVsHodl`/`lpVsHodlDaily` in `lib/whirlpool-vault.js` + gated `/api/whirlpool/vault/lp-vs-hodl?project=…[&reset=1]`
> + hourly `wpLpVsHodlDailyCheck` in server.js (DMs each project's own chat once/24h; CLKN projects get the
> organic-score + real-24h-volume line appended — the "what did the IL buy?" readout). Baseline = the wallet's
> TOTAL basket (positions + pending fees + free float), so the vault's own opens/closes/swaps DON'T skew it
> (value-preserving) — this FIXES the Meteora limitation: external deposits/withdrawals show up as a diff
> step-change >$250 (kv `wpLpHodlJumpUsd`) between daily checks and trigger an AUTO re-baseline with a DM note.
> First read/check auto-seeds the baseline. READ-ONLY — it never touches positions.
> **🆕 CURRENT STRUCTURE — ±1.75% TRIO (owner's GO, 2026-07-08; supersedes everything below in
> this block):** after the ±10% era produced too little volume/organic score ("not working"), the
> owner pulled back to tight pools. LIVE under treasury `2zMCU…`, all opened via openAnchor at
> `down=1.75&up=1.75` so they're PINNED (vault stays **PAUSED**; positions are owner-managed via
> sessions): CLKN/SOL ±1.75% (`5vNLFy…`, ~$2.5K), CLKN/USDC ±1.75% (`5hcqAN…`, ~$2.4K), CLKN/JUP
> ±1.75% (`6Bj3cJ…`, ~$3.4K) ≈ **$8.3K deployed**, all verified in-range + centered at open. The
> three ±150–178% permanent anchors (`9piTqV…`/`DEzSNM…`/`GG6RGB…`, ~$190) sit underneath — NEVER
> touch them. Float kept lean: ~0.4 SOL / ~0.4M CLKN / ~$12 USDC / ~99 JUP. LP-vs-HODL re-baselined
> at $8,720 (2026-07-08). ±1.75% goes OOR on small moves: `wpTightOorTick` (server.js) DMs the
> PRIVATE operator chat LOUD on out-of-range — recenters are a manual owner decision, use the
> `pool-ops` skill (.claude/skills/pool-ops) for the full verified ritual. Historical context ⬇️
> **REIMAGINED ENGINE STRUCTURE — DEPLOYED 2026-07-06 (superseded 2026-07-08): "same depth-at-touch,
> ±10% width, ~5× capital" replaced the ±2% trio.** Thesis: depth-at-touch = capital ÷ width, so ~$1.8K/pool
> at ±10% matches the old ~$350/pool at ±2% → same arb volume feeding the organic score, but recenters
> ~never fire (price must move 10%) → the recenter IL-crystallization leak (the dominant cost, proven on
> Meteora) is gone. LIVE under treasury `2zMCU…`, all opened via openAnchor/openWall so they're PINNED
> (st.anchorMints — no automation can adopt/close them; **vault stays PAUSED**): CLKN/SOL ±10%
> (`J1NPf2S8…`, 2.48M CLKN + 12.3 SOL), CLKN/JUP ±10% (`B9KG81gu…`, 2.50M CLKN + 4,103 JUP), CLKN/USDC
> ±10% (`DNAr1hyp…`, 450K CLKN + 173 USDC — bid side deliberately SHALLOW, owner's call: no USDC left after
> his manual DCA buys and never sell SOL/JUP to top up) + a single-sided CLKN ask wall +1%→+10%
> (`D5CNjiVw…`, 2.08M CLKN) bringing the USDC pool's upside to par ("OUT of range" on the wall is CORRECT —
> it's an ask above spot). The three ±94% anchors remain underneath. ~$5K deployed; ~20.5 SOL / ~3.4K JUP /
> ~8.3M CLKN / ~$26 USDC left free as dry powder. LP-vs-HODL re-baselined at deploy ($10,442 basket) —
> judge the structure by the daily verdicts (volume + organic score line), not vibes. If volume/score sags
> vs the ±2% era, tightening is a config discussion with the owner, not an automatic action.
> ⏰ **UPDATE 2026-07-03: CoinGecko REJECTED AGAIN (3rd time) — boilerplate reasons: liquidity
> (they read TOTAL TVL, ~$39K now — concentration doesn't move that number), life of token, and
> team presence. The MIGRATION route was already used (owner applied as a migration from the
> previously-listed predecessor token + sent multiple emails) — so "apply as migration instead"
> is NOT an unexplored fix; don't re-suggest it. CONSEQUENCE (owner's call, same day): the
> $129/mo CoinGecko Analyst API sub is being CANCELLED ("I will not support them if they don't
> support us") — **sub runs until JULY 13; everything must be off the Analyst API by then.
> STATUS: DONE &amp; VERIFIED IN PROD 2026-07-04** — full divorce shipped: bot price getters
> (SOL/cbBTC/JUP) = Jupiter Price v3 (lite-api, keyless) with DexScreener fallback; Daily Alpha
> majors = Jupiter Price v3 (BTC via cbBTC mint, ETH via wormhole WETH); trending +
> gainers/losers = GeckoTerminal Solana trending_pools; X-handle tagging = GT token-info
> twitter_handle (mintTwitter, was coinTwitter); /api/token-overview = onchain-only (same
> response shape, aggregated fields null). Verified live: token-overview source:"onchain",
> alpha-test majors/trending on new sources. Remaining cgPro refs are gated DEBUG probes only;
> `cgPro` itself falls back to the free api.coingecko.com host if ever invoked, so a dead key
> can't break anything. `COINGECKO_API_KEY` on Railway is now UNUSED by runtime paths — safe
> (and recommended) to delete before the 13th. ACTIONABLE listing fix
> found the same day: the GeckoTerminal token profile's WEBSITE field points to the Bags
> launchpad page (bags.fm/dw6df2…) not clucknorris.app, and the description says
> "clucknorris.vip" (half-dead domain) with stale stats (12 lessons/72 questions) — a reviewer
> sees "no real website" → the team-presence boilerplate. Submit a GT/CG token-info update
> (website → clucknorris.app, socials, refreshed description) before any reapply.** Older
> context below ⬇️
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
- ⛔ **STOP MEANS STAY STOPPED (owner rule, 2026-07-04).** When the owner says stop/pull/close
  something, it stays stopped until HE says restart — which means: before executing, find and
  disarm EVERY automation that could undo it, and AFTER executing, re-verify one full tick-cycle
  later that it stayed done. Set after a session pulled the treasury's tight Orca positions but
  only checked the DEFAULT project's paused flag — `/api/whirlpool/vault/status` without
  `project=` returns the CLKN engine project, NOT treasury — and the live treasury vault
  redeployed everything 2 minutes later. ⚠️ ALWAYS pass `project=treasury` when checking/pausing
  treasury automation. **UPDATE (2026-07-04, later): the owner explicitly RESTARTED the treasury
  engine** — vault RESUMED and running autonomously at **±2% width** (widthPct/solWidthPct/
  jupWidthPct=2) with deploy caps cut 30% (maxUsd 350 / solMaxSol 4.2 / jupMaxJup 1400). Three
  tight ±2% CLKN positions (USDC/SOL/JUP) + the three ±94% anchors are live under treasury
  `2zMCU…`. (Seeded the USDC pool with a 6.5 SOL→USDC swap since the wallet had 0 USDC.) So the
  vault is intentionally RUNNING now — do NOT pause it without an owner ask.
- ⛔ **PLAN ≠ EXECUTE for money (owner rule, 2026-07-02).** For ANY action that moves funds,
  opens/closes positions or pools, or resumes an engine: state the exact plan (amounts, tiers,
  pools) and STOP — execute only after the owner replies with an explicit go. Plan and execution
  never share a turn. An owner message describing intent ("want to reset X", "thinking we should Y")
  opens a DISCUSSION, not authorization — parameters like fee tiers are the owner's to pick.
  (Set after a session executed a full pool reset at a self-chosen fee tier from "want to reset
  them with slightly higher fee ratings".) Reads/status checks are always fine.
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
  ⛔ **LP Scanner is OPERATOR-ONLY (2026-07-04, owner's call — off public, kept for CLKN ops):**
  all seven `/api/lp-*` endpoints are adminAuthOK-gated (404 without key); `/lp-scanner` page
  still exists but needs `?key=PREMIUM_ACCESS_KEY` once (remembered in localStorage); public
  links removed from tools.html, cluck-nav.js and the LP Lab lesson. The hourly `warmTopPools`
  timers were removed with it (no idle GeckoTerminal polling). Don't re-publicize without the
  owner's ask.
  ⛔ **Cluck Score was REMOVED (2026-06-15, owner's call): it gave good scores to tokens that
  then rugged — misleading, not worth it. Do NOT rebuild it.** Gone: `/score` page + `score.html`,
  `/api/cluck-score`, `/api/cluck-card`, `renderScoreCard`, the `/score` Telegram command, and all
  links. The replacement free flagship is **Wallet X-Ray** (`/wallet-xray`, `/api/wallet-xray`).
- `src/` — the React/Vite school (landing app). **SEO note (2026-07-06):** the school is a
  client-rendered SPA, so `/curriculum` (server route + `lib/curriculum.js`) serves a static-HTML
  mirror of the lesson content for non-JS crawlers — it text-extracts LESSONS/INCUBATOR_LESSONS
  (App.jsx) + LP_LESSONS (LPLab.jsx) at first request, deliberately WITHOUT quiz answers (the
  exam draws the same questions — don't make the key googleable). `robots.txt` + `sitemap.xml`
  are explicit server routes (the SPA catch-all would otherwise answer them with the React shell).
  If you materially restructure those lesson arrays, sanity-check `/curriculum` still renders
  (a failed extraction 404s that route only — nothing else is affected).

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
  The App.jsx↔bank sync is still MANUAL, but a CI drift guard now catches the common case:
  `scripts/check-question-bank.js` (wired into `.github/workflows/syntax-check.yml`) fails the
  build if any CURRICULUM/LPLAB bank question's TEXT no longer appears in its source file
  (caught: reworded/removed questions). Limitation: it matches question text only — a changed
  answer/options under an unchanged question still needs human review.
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
Optional `JUPITER_API_KEY` (unset = the FREE `lite-api.jup.ag` Tokens V2 endpoint, fine for our
cached low-volume use): when set, every `tokens/v2` call (CLKN organic score + REAL 24h volume in
server.js, autopsy cross-verify, bags-context, lp-scanner) auto-switches to the keyed `api.jup.ag`
host with an `x-api-key` header for higher rate limits — same response schema, so it's a pure
no-op until the key exists. Drop the key in env, redeploy, done.
Optional **TTS / "real Cluck voice"** (all unset = read-aloud uses the FREE browser Web Speech
voice everywhere, a safe no-op): `ELEVENLABS_API_KEY` (enables `/api/tts`; ElevenLabs is the
same engine Anthropic's own voice mode uses), `ELEVENLABS_VOICE_ID` (the branded Cluck voice;
per-lang override `ELEVENLABS_VOICE_ID_ZH` / `_ES` / `_EN`), `ELEVENLABS_MODEL` (default
`eleven_flash_v2_5` — HALF-price credits, multilingual), `TTS_DAILY_CHAR_CAP` (NEW-synthesis
budget/day, default 40000). Synthesized mp3 is cached on the `/data` volume keyed by
model+voice+lang+text → each lesson chunk is paid ONCE then served free forever; uncached text
with no key/over budget returns 503 and the client falls back to the browser voice. 🟢 **LIVE
(owner added `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` on Railway).** The flash model is
MULTILINGUAL — the ONE Cluck voice speaks every language (EN/中文/ES/IT verified synthesizing real
audio); we pass `language_code` per request, so adding a new language needs NOTHING in ElevenLabs.
**⚠️ LANGUAGE COUNT: the school ships in SIX languages — `en` / `es` / `it` / `pt` / `vi` / `zh`
(English, Español, Italiano, Português, Tiếng Việt, 中文)** — full UI + curriculum translations live
in `public/i18n/*.json` + `public/i18n/*.school.json`. That 6 is the real count to quote (e.g. grants);
the `EN/中文/ES/IT` above is only the narrower subset with *TTS audio verified* (4), NOT the language total.
Per-language voice overrides (`ELEVENLABS_VOICE_ID_IT`/`_ES`/`_ZH`/`_EN`) are OPTIONAL — only if the
owner wants a distinct natively-accented voice; unset = the main voice handles all langs.
Gitignored & local-only (do **not** expect these in a cloud session): `.env`, `.claude/`,
`STRATEGY.md`.

## Critical runtime facts
- **The entire scheduler block** (buy/sell alerts, Cluck's Lesson, Launch Radar, Market
  Check, daily recap, graduation watcher, the webhook setup) **only starts if
  `TELEGRAM_BOT_TOKEN` AND `TELEGRAM_CHAT_ID` are set at boot.** Missing either → none of
  it runs. This is the #1 thing to check when "the bot isn't doing X."
- 🔒 **Lock-celebration flow (owner standing approval 2026-07-01; ONE-POST redesign 2026-07-03 —
  "text and image go out TOGETHER, that was the whole point"):** when a new lock fires,
  `lockWatchTick` posts NOTHING. It composes the announcement copy for both channels and stores
  it in kv `lockCelebrationPending` (delta/total/pct/newLocks/lockCount + `tgText`/`xText` +
  `announced:false`), readable via gated `/api/lock-celebration` (`?clear=1` when handled,
  `?probe=` for observability). A **Claude session** (60s watcher when live + the hourly cron)
  picks it up, generates the image, and posts ONE combined post per channel — **X FIRST, then
  Telegram with the X link (owner ask 2026-07-03)**:
  **1. X** = `/api/x-announce` `post=1` + `text={pending.xText}` + `image={rawUrl}` (standalone,
  no replyTo) → capture the returned post id; **2. Telegram** = `/api/tg-test` `photo={rawUrl}` +
  `text={pending.tgText}` + a trailing "🐦 On X — like &amp; repost:
  https://x.com/FireChicken007/status/{id}" line (silent). Then `?clear=1`. **FALLBACK:** if no session picks it up within `LOCK_ANNOUNCE_FALLBACK_MS`
  (6h, server.js), the tick posts the stored text-only copy itself (a lock never goes silent)
  and marks `announced:true` + records `xPostId`/`tgMessageIds`; a session that arrives LATER
  then degrades to the old two-step: X image reply under `xPostId` with a SHORT punchline only
  (never restate the numbers), TG photo with self-sufficient caption + `replaceMsg=` (comma-join
  `tgMessageIds`) which deletes the fallback text(s). **TWO-VAULT IMAGE SPEC (owner ask
  2026-07-04, all mandatory):** the scene shows **TWO vault doors** — one labeled "JUPITER LOCK"
  (engraved with `pending.jupLockedShort` CLKN), one labeled "STREAMFLOW" (engraved with
  `pending.strmLockedShort` CLKN). Cluck hauls **exactly `pending.newLocks` bag(s)** (main bag
  "+{deltaShort} CLKN") **toward the vault named in `pending.platform`** — that's the platform
  this lock used (its door glows/is emphasized). A banner spanning both reads "{pct} OF SUPPLY
  LOCKED" (the combined total). Dark + orange palette, crisp legible typography. VIEW the render
  and verify: two doors with the right platform labels + subtotals, bag heading to the correct
  vault, all text correct — before posting. Announcement floor is 10K CLKN (`LOCK_WATCH_MIN_DELTA`,
  was 500K — owner's call 2026-07-03). Images via the **Higgsfield MCP (owner's Plus plan — owner
  explicitly does NOT want a separate paid Higgsfield Cloud API key)**.
  🟢 **STREAMFLOW LOCKS: SHIPPED &amp; VERIFIED 2026-07-04.** `getLockedSupply` counts Streamflow
  (self-owned escrows) and `attributeLockPlatform` relabels them "Streamflow" via a cached
  creation-tx trace (Streamflow program `strmRqU…`); the watcher tracks per-platform subtotals
  and which vault grew. So both platforms are fully automatic now — no more manual runs. ⚠️ **CronCreate jobs are session-only and expire in ≤7 days — every
  new long-lived session should RE-ARM the hourly celebration cron** (poll the endpoint →
  if pending, generate → post → clear; never post when pending is null).
  **Model note (owner, 2026-07-02): use SONNET 5 (`claude-sonnet-5`) for Higgsfield prompt
  crafting** — noticeably better image prompts; the Mac runner passes `--model claude-sonnet-5`,
  and in-session celebrations should spawn a sonnet subagent to write the Higgsfield prompt.
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
- **X→TG mirror + bump rule (owner, 2026-07-08): every X post gets (a) a SILENT Telegram
  companion in the community chat with a "🐦 On X — like & repost" link, and (b) a follow-up
  self-reply under the original X post a few hours later to bump engagement.** The Chain
  Spotlight implements the pattern (TG mirror in `postChainSpotlight`, 3.5h question-bump in
  `chainSpotlightTick`, observability kv `chainSpotLast`/`chainSpotBump`); new X surfaces should copy it.
- ⚠️ **Master X pause (`X_AUTOPOST_PAUSED=true`, server.js ~643, owner's call 2026-06-24) hard-gates
  `postToX` — a new X feature that doesn't pass `{force:true}` posts NOTHING and reports
  `{ok:false,paused:true}`.** Scoped carve-outs so far: lock announcements + the twice-daily
  Chain Spotlight (owner ask 2026-07-08). Any new auto-poster needs an explicit owner ask for its
  own carve-out — and must alert the operator chat on failure, never fail silently (the spotlight
  posted into the pause for a full day before anyone noticed).
- **Media/brand generations: `docs/MEDIA_LIBRARY.md` is the manifest.** Every KEPT Higgsfield
  render gets a row (job ID, CDN URL, verdict); check it BEFORE regenerating; confirm the exact
  job ID with the owner before overlay/edit work. Hard rules: AI never draws real coin/brand
  logos (overlay/end-card them from `docs/brand/`), branded mascot always needs a reference image,
  NSFW false-flags auto-refund.
- Persistence: Railway volume at `/data` (consumed payment signatures, graduation tracker,
  scheduler timestamps, analytics, transcripts/credentials) — survives redeploys.

## Gated admin / test endpoints (require `?key=PREMIUM_ACCESS_KEY`)
- `/api/tg-test?text=…[&loud=1]` — post a custom one-off message to the Telegram chat
  (silent by default; `&loud=1` pings). Use this to send a "we're testing" notice.
- `/api/bags-radar-test`, `/api/market-check-test`, `/api/recap-test`, `/api/edu-post-test`,
  `/api/x-post-test`, `/api/outreach-test`, `/api/tool-spotlight-test` — dry-run the scheduled
  posts; add `&post=1` to actually fire. `tool-spotlight` = the DAILY tool feature on X +
  (silent) Telegram, rotating `TOOL_SPOTLIGHTS` (kv `toolSpotPos`/`toolSpotDate`, hour kv
  `toolSpotHour` default 17 UTC); X posts tag @BagsApp + @JupiterExchange.
- `/api/buy-replay?sig=…[&run=1]` — manually (re)fire a buy/sell alert the live poller
  dropped; dry-run unless `&run=1`; remembers the sig so the poller won't double-post.
- `/api/reconcile-test[&run=1]` — preview/run the RECONCILIATION BACKSTOP: a 12-min sweep
  (`reconcileMissedTrades`) that recovers any buy/sell the 30s poller dropped (transient
  error, restart gap, RPC quirk). Settled-window + durably-deduped (`handledSigAt`/kv
  `buyHandledSigAt`, 2h time-pruned, so it can NEVER double-post) and uses the same raw
  (authoritative) detection + suppression rules. Tunables: kv `reconcileLookbackMin` (45),
  `reconcileSettleSec` (240). The poller itself also now re-checks dropped trades against
  raw `getTransaction` before suppressing (the enhanced Helius format misreads Jupiter-
  routed swaps as false-arb / false-below-floor — this ate a real ~$700 buy on 2026-06-19).
- `/api/health-check[&run=1]` — data-source health (Solana Tracker / Helius / Bags / Telegram).
  Dry returns live status JSON; `&run=1` also DMs the operator (treasury) chat. A 10-min
  `sourceHealthTick` alerts the operator chat ONLY on a source's state change (down/up) +
  a once-daily all-green heartbeat (kv `sourceHealth`/`sourceHealthHeartbeatDate`). So a
  feed going dark (e.g. ST out of credits) pings you instead of being found by a user.
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
- **⚠️ OUR wallet balances are an OPS concern — NEVER read them with the product tools. Before
  ANY treasury/engine decision or transaction (sizing a position, a swap, a buyback, quoting
  "what's available"), read balances DIRECTLY ON-CHAIN.** The public forensic tools
  (`/api/wallet-xray`, autopsy) are *activity scanners*, not balance snapshots — they undercount
  and miss holdings (missed live USDC and Token-2022 LP positions, 2026-06-27, which led to two
  wrong balance reports in one session). Do NOT size a trade off them, ever. Authoritative read =
  `getTokenAccountsByOwner` (encoding `jsonParsed`) for BOTH token programs — legacy
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` **and** Token-2022
  `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` — plus `getBalance` for native SOL, POSTed to the
  `/api/helius-rpc` proxy (it holds the key and these methods are on its allow-list; works
  headless in a fresh cloud session). Sum `tokenAmount.uiAmount` per mint. On-chain is the ONLY
  source of truth for our funds. (Same rule for LP positions: the Token-2022-aware
  `listPositions`/`/api/whirlpool/positions` read, never a forensic endpoint.)
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
  GitHub is always the truth; nothing committed is ever lost. `MIN_BUY_USD` default is 5 (buy-alert floor; owner's call 2026-06-27, lowered from 35 — arb dust is now muted separately via `suppressArbAlerts`, so the floor can be low to surface small real buys).
- **Arb-bot filter (behavioral, 2026-06-27):** a size-independent denylist that catches the MULTI-tx round-trip churners the single-tx `crossPoolArb` detector misses. `noteTradeForArb` records each trade in a short per-wallet memory and `flagArbBot`s any wallet that round-trips CLKN (buy↔sell, same wallet) within `arbRoundtripSec` (kv, default 180s); flagged wallets (kv `arbBotWallets`) have BOTH buys and sells suppressed in the poller + reconcile, like operator wallets. Seeded with two confirmed bots (`ESuvjvsQ…`, `o721mrtt…`). Manage via gated `/api/arb-bots` (`?add=`/`?remove=`). False positives (a real wallet that happened to flip fast) are removable there.
- 💡 **IDEA — PERMANENT WIDE "ANCHOR" POSITIONS (filed 2026-06-23, owner's idea; NOT yet
  implemented).** Problem: because we own ~100% of the Orca CLKN pools, fully pulling our
  concentrated positions leaves the pool EMPTY → price goes stale / a tiny trade shoves it far
  off market → on redeploy we must recenter around a dislocated price and wait for arb to settle
  (the "front-end work"). Fix to consider: leave a TINY (~$10) ultra-wide position per pool that
  we NEVER close — e.g. ±80%, or asymmetric −50%/+200% (more headroom up for a memecoin). It keeps
  a continuous, arbitrageable quote so the pool price always tracks the real market (arbs align it
  even against thin liquidity), and being ultra-wide it never goes out-of-range / never needs
  touching. Then restarting the tight positions finds price already live + in-range → no settle
  wait. Cheap + correct ONLY on Orca (one position spans the whole band for ~0.006 SOL rent, $10
  capital, negligible IL); do NOT do this on Meteora (width-scaled bin-array rent makes a band that
  wide very expensive). Sound CL technique — revisit when the engine is un-paused.
- 💡 **PLANNED — generalize the Meteora keepalive to the multi-project liq engine (owner's
  call 2026-06-27).** Built for CLKN now (`vault.meteoraKeepalive` + the `meteoraCanonKeepaliveTick`
  scheduler + `/api/meteora-keepalive`): when the canonical pool goes quiet ≥23h it fires ONE
  ~$10 SOL→CLKN BUY forced through `64WXkH` (Jupiter `dexes="Meteora DAMM v2"` + ammKey route-verify;
  buy-only; 1×/24h max; kv `meteoraKeepalive{Enabled,Hours,Usd}`) so the pool doesn't drop off
  watchlists (24h-no-trade cutoff). Currently HARDCODED to the `treasury` project + the `64WXkH`
  address — to productize for client projects, make the canonical-pool address + params per-project
  config (the vault is already multi-project). It's **volume-triggered, so it self-scales**: a client
  with a healthy LOW-fee main pool gets organic arb → never trips it; only starved pools fire it.
  **Fee-structure lever (why CLKN needs it and most clients won't):** CLKN's canonical pool is Meteora
  **2%** (high) while the engine pools are Orca **0.02%** (cheap), so arb routes AROUND the main pool
  and starves it. Clients with a low-fee main/canonical pool get arb flowing there naturally. **When
  onboarding clients, steer them to a LOW-fee main pool** — keepalive becomes a rare backstop, not a
  daily cost.

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
credential-bearing URLs + bounds length on every 500). Range-label honesty on the public
endpoint DONE (2026-06-20): `suggestRanges` now returns `realizedWidthPct` (the band after
tick-alignment + tight-width guards) and the balanced label + the /liquidity "±X%" headline
render the realized width, not the requested slider value. LOW backlog now fully cleared.

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
- **Autopsy `excludeSet` bug — FIXED (2026-06-20).** The Phase 2G‑bis sub‑distributor
  filter in `lib/autopsy.js` referenced `excludeSet`, which was defined NOWHERE — so it
  threw inside the phase's try/catch and silently disabled the team‑network multi‑hop
  trace (that path had never run in production). Now defined as a Set of CEX wallets +
  DEX/LP programs + token programs + labeled programs (lockers stay covered by
  `traceLockerSet`). The phase still degrades gracefully (try/catch) if a sub-trace fails.
  This ENABLED a previously‑dead path — spot‑check autopsy reports on a few mints after deploy.
- **Autopsy premium styling — design decision (not yet made).** The premium
  forensic sections render in a different color scheme that doesn't match the
  site's dark/orange theme. Open question: leave it visually distinct so the
  premium tier *stands out*, or restyle it on-brand for consistency? Decide
  intentionally before touching it.
