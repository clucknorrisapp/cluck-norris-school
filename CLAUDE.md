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
- `data/question-bank.json` — the Ultimate Challenge question pool (server-owned; the
  client never ships the answer key). See the credentials note below.
- `hatchery.js` (guided token creator) and `securitycoop.js` (approval revoker) — Express
  routers mounted by `server.js`.
- `public/*.html` — standalone vanilla-HTML tool pages: score, autopsy, trace, snapshot,
  holders, airdrop, buyspecial, rose, hatchery, security-coop, premium, slots, bags,
  tools, investors, grant, stats, transcript.
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
- ⚠️ **Question-bank drift:** the curriculum questions live in BOTH `src/App.jsx` (`LESSONS[].questions`,
  for the per-lesson quizzes) and `data/question-bank.json` (for the exam). They are NOT auto-synced —
  if you materially edit a lesson's quiz, update the exam bank too (it has no live regenerator anymore).
- Public surfaces: `/transcript/:slug` (page, with OG card), `/api/credential/:slug` (JSON — exposes
  holder *status* only, never balance), `/api/credential-card?slug=` (PNG), `/api/school-stats`
  (aggregate verified-graduate metrics, shown on the grant + investor pages).

## Secrets live on Railway, NOT in the repo
The repo ships zero secrets; a fresh clone (every cloud session) has none. Runtime secrets
live in **Railway** (the app) and the **Claude-web environment** config (so sessions can
run things). Var names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HELIUS_API_KEY`,
`BAGS_API_KEY`, `ANTHROPIC_API_KEY`, `SOLANA_TRACKER_API_KEY`, `SOLSCAN_API_KEY`,
`PREMIUM_ACCESS_KEY`, `X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET`,
`GOOGLE_SHEET_ID/GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY`, `HATCHERY_TURBO_KEY`,
`COINGECKO_API_KEY`, `DATA_DIR`.
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
- **`/api/helius-rpc` is a deny-list, not an allow-list** (the README says
  "allow-listing"). It blocks `getProgramAccounts`/subscribes and is rate-limited,
  so the risk is low (quota abuse, no key leak). Convert to a true allow-list of
  the methods the client tools actually call — but enumerate every method first
  (rose/airdrop/buyspecial route real RPC, incl. possibly `sendTransaction` /
  `getLatestBlockhash`), and don't do it mid-event since an incomplete list breaks
  those tools. Then make the README wording match.
- **Autopsy premium styling — design decision (not yet made).** The premium
  forensic sections render in a different color scheme that doesn't match the
  site's dark/orange theme. Open question: leave it visually distinct so the
  premium tier *stands out*, or restyle it on-brand for consistency? Decide
  intentionally before touching it.
