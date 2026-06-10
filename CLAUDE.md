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

## Working agreement
- **Always commit AND push to the active working branch** — hackathon pace, standing
  permission to push. Give a heads-up before anything touching `main` (merge/PR) or
  destructive (force-push, `reset --hard`, branch delete).
- Railway **auto-deploys from `main`**, so branch work must reach `main` to go live.
- **Never commit secrets.** Don't put a model identifier in committed files.

## Repo layout
- `server.js` — the monolith (~9.3k lines): every API endpoint, the Cluck Score, the
  Token Autopsy engine, CLKN payment verification, Telegram/X automation, the trade
  poller, all schedulers, and static file serving.
- `lib/` — `bags-context`, `solana-tracker`, `solscan`, `premium-forensics`, `analytics`,
  plus volume-backed stores: `kvstore`, `sigstore`, `recap`, `grad-tracker`, `credentials`.
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
- `public/*.html` — standalone vanilla-HTML tool pages: score, autopsy, trace, snapshot,
  holders, airdrop, buyspecial, rose, hatchery, security-coop, liquidity, premium, slots,
  bags, tools, investors, grant, stats, transcript.
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
  either, re-port into the bank (match the `source` tag). Note: the exam draws 50 at random with no per-source
  cap, so the pool is LP-heavy by count; balance the draw in `/api/exam/questions` if that becomes a problem.
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
- **Bags monitoring (near-grad + graduation alerts) depends on `SOLANA_TRACKER_API_KEY`.**
  Fast health check (no key needed): `GET /api/bags-near-grad` — returns `tokens:[…]` =
  pipeline alive; empty/`success:false` = ST key or quota.
- X cross-post needs all four `X_*` keys, else silent no-op. A raw contract address in a
  tweet 403s for ~7 days after auth, so lesson tweets link a DexScreener URL instead.
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
  bag is never sold). Gas floor `swapSolFloor 0.2` on treasury + clkn. `suggestRanges` min
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
trace.html/autopsy.html XSS escaped. Remaining = LOW hygiene backlog only (range-label honesty,
`source` whitelist, header-vs-`?key=` admin auth, generic RPC error passthrough) — not vulns.

## Conventions
- Tool pages are vanilla HTML + inline JS; the school is React. **Escape any API/token-
  supplied string before `innerHTML`** — token names/symbols are attacker-controlled.
- Forensic rule everywhere: **state what's on-chain, never assert intent** ("the chain
  shows *what*, not *why*"). Only call a wallet "creator/team" when a launchpad API
  (Bags/Pump) confirms it.
- Payment model: a unique-decimal CLKN transfer, verified on-chain and replay-guarded;
  holders of ≥2M CLKN get a 5× unlock bonus read straight from the payment tx.

## Build / check
- Run: `npm start` (= `node server.js`). React dev/build: `npm run dev` / `npm run build`.
- After editing backend JS, sanity-check syntax: `node --check server.js`.
- No automated test suite.

## Deferred / check later
- **`/api/helius-rpc` is now a true allow-list** (default-deny). It permits only the
  lightweight read + tx-build/send methods the client tools use (see `ALLOWED_RPC`
  in the handler) and handles JSON-RPC batch bodies; everything else
  (`getProgramAccounts*`, all `*Subscribe`, block/supply/cluster scans, etc.) is
  rejected. Matches the README's "allow-listing" claim. If a tool ever needs a new
  RPC method, add it to `ALLOWED_RPC` — a missing method returns 403.
- **Slots: provably-fair before real prizes.** `/api/slots/spin` outcomes use
  `Math.random()` server-side — fine while it's a no-stakes beta, but before any
  real CLKN payout goes live, add commit‑reveal (publish a hashed server seed, mix
  in a client seed, reveal after) so spins are independently verifiable and you
  can defend against "rigged" accusations. The real odds are already published on
  the page (`slotOdds()`), and outcomes are server‑authoritative (players can't
  cheat); commit‑reveal is specifically about proving the *server* isn't.
  Daily spins (banded 5/10/15/20 by balance) refresh at the next UTC midnight via
  `slotDayEndsAt()`; the page shows a live "next free spins in …" countdown
  (`spinsResetAt` is returned from `/api/slots/state`, the spin response, and the
  `no_spins_left` 429). The points-week board reset is the separate `weekEndsAt`.
- **Autopsy premium styling — design decision (not yet made).** The premium
  forensic sections render in a different color scheme that doesn't match the
  site's dark/orange theme. Open question: leave it visually distinct so the
  premium tier *stands out*, or restyle it on-brand for consistency? Decide
  intentionally before touching it.
