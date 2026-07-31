# CLAUDE.md — Cluck Norris (CLKN)

Operating notes for any session, **especially cloud/web ones that start from a fresh clone with
no local files.** Read this first.

This file is deliberately short. It carries the **mission**, the **owner's decisions**, and the
**traps that already cost someone a day** — things you can't derive from reading the code. It
does not tell you how to write software; use your judgement for that.

> Detailed operational history — engine states, position sizes, past comps, superseded
> strategies — lives in `git log` and `docs/`. It was trimmed out of here on 2026-07-30 because
> a stale instruction stated with authority is worse than no instruction, and several were.

> 🎮 **Working on Normie Quest? Read `docs/HANDOFF_2026-07-27.md` first.** It carries the branch
> state, the open decisions, and how to verify a change: `node normie-quest/test/nq-verify.cjs
> <baseUrl>` reads the diff and picks the right checks. Don't run the full 82-level state test by
> reflex — a day went to running it for icon swaps it could never have validated.

---

## The mission

**School of Crypto Hard Knocks** — a free Solana crypto school and free token-research tools,
wrapped around a few operator tools that CLKN holders get free. Live at **clucknorris.app**.

The point is that people lose money in crypto because nobody told them the truth plainly, and
this teaches them before they get hurt. Design calls should serve that:

- **Free is the funnel, and it stays genuinely free.** The school, the forensics, the safety
  scan, the locker — no wallet, no signup, no catch.
- **Say what's on-chain, never why.** The chain shows *what*, not *why*. Only call a wallet
  "creator" or "team" when a launchpad API confirms it. That forensic honesty is the brand.
- **Guardrails before power.** First-timers get warned before they can hurt themselves. That's
  rare in crypto — a differentiator, not friction to optimise away.
- **Public docs must match the code.** This repo is the hackathon entry and the canonical source;
  `README.md` and `public/investors.html` are read by people evaluating the project. A claim
  that isn't true in the code is a real problem, not a copy nit.

**Current strategic priority (owner, 2026-07-19):** the **Locker Room** is the flagship story —
helping communities lock tokens on Jupiter Lock and broadcast it. Autopsy stays but isn't the
lead ("so many rugs and nobody cares").

**Normie Quest** runs under Cluck Norris production for the NORMIE community. The game URL stays
unlinked, and **all token-gating in it is TESTING ONLY** — there's no agreement with the NORMIE
team on access or rewards, so never promise gating terms on any public surface. In-game $NORMIE
copy lives in `NORMIE_NATION` (game_logic.js): identity and where-to-buy only, no perks, no
thresholds.

CLKN mint: `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`

---

## Working agreement

- **Push freely.** Standing permission to push to the working branch **and to `main`** (owner,
  2026-07-24: "you always have permission to push to main"). Railway auto-deploys `main`, so that
  IS production: land it green and say what went live. **Ask first for anything destructive** —
  force-push, `reset --hard`, branch delete. That was never granted.
- ⛔ **PLAN ≠ EXECUTE for money.** For anything that moves funds, opens or closes positions, or
  resumes an engine: state the exact plan and STOP. Execute only on an explicit go. An owner
  message describing intent ("thinking we should Y") opens a discussion, not authorisation —
  parameters like fee tiers are his to pick. Reads are always fine.
- ⛔ **STOP MEANS STAY STOPPED.** When the owner says stop/pull/close, it stays stopped until he
  says restart. Before executing, disarm *every* automation that could undo it; after, re-verify
  a full tick-cycle later that it stayed done. (A session pulled treasury positions but checked
  the wrong project's paused flag — the live vault redeployed everything two minutes later.
  `/api/whirlpool/vault/status` without `project=` returns the CLKN project, NOT treasury.)
- **Telegram posts are SILENT by default.** Never `&loud=1` unless the owner says so in the
  moment.
- **Never commit secrets**, and don't put a model identifier in committed files.
- **Tell the truth about what you did.** If a check didn't run, say so. Most of the worst bugs
  here survived because something reported green on the wrong thing.

---

## Money: what you may and may not touch

The owner manages all liquidity positions **manually**. Read freely; touch nothing.

- ⛔ **WATCH-ONLY.** Don't rebalance, recenter, close, redeploy, add/remove liquidity, or
  buy/sell CLKN. Don't "take over." Observe and log.
- ⛔ **The brand bag is NEVER sold.** And **never buy CLKN with operator funds** without asking in
  that moment (owner rule, after unwanted inventory buys).
- ⛔ **The autonomous rebalancer is hard-killed in code** (`JUP_AUTO_REBALANCE_KILLED = true`).
  Re-enabling is a deliberate two-step opt-in. Don't, without an explicit ask.
- **Read balances ON-CHAIN, never with the product tools.** `/api/wallet-xray` and autopsy are
  *activity scanners* — they undercount and miss holdings, and two wrong balance reports came from
  trusting them. Use `getTokenAccountsByOwner` (jsonParsed) for **both** token programs — legacy
  and Token-2022 — plus `getBalance`, POSTed to `/api/helius-rpc`.

Treasury wallet `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`. Canonical chart is the community
Meteora pool `64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd`; engine pools are Orca. The venue
split is settled — don't re-debate it.

---

## How access works (payment model, changed 2026-07-30)

Every gate resolves through the **connected wallet**: hold a CLKN threshold (free), pay a small
SOL price in one click, or sign a message where the gate is *ownership* rather than payment.

- airdropper — free at **50,000 CLKN** held, else 0.05 SOL
- Buy Special — free at **2,000,000 CLKN**, else 0.05 SOL
- premium forensics — holder-gated at 2M, re-checked live on every run
- transcript Tier-2 — connect & sign with `minHold: 0` (a graduate may hold no CLKN)
- The Hatchery is the one place you can still **pay** in CLKN, ~30% cheaper than the SOL price.
  Probe `/api/hatchery/config` for today's figure — it's computed live, so never hardcode it.

⛔ **Send-to-unlock is retired and its endpoint deleted.** Don't reintroduce a "send a unique
decimal and poll" gate without the owner asking. The public framing is his own: *we tried it, it
wasn't used, we can turn it back on any time, but for now we're simplifying to find out whether
that was the limiting step.*

---

## What's where

- `server.js` — the monolith (~11k lines): every endpoint, payment verification, Telegram/X
  automation, the trade poller, schedulers, static serving.
- `lib/` — `autopsy` (forensics engine), `helius-trades` (buy tracking: Helius → GeckoTerminal →
  Solana Tracker, in that order), `solana-addr` (address primitives + DEX/locker/CEX tables),
  `rpc` (failover), `orca-whirlpools` + `whirlpool-vault` (liquidity engine), kv/sig/recap stores.
- `hatchery.js`, `securitycoop.js`, `whirlpool-mm.js` — Express routers mounted by server.js.
- `public/*.html` — vanilla tool pages. `src/` — the React school.
- Shared browser modules: **`cluck-wallet.js`** (the 11-wallet registry + connect/disconnect) and
  **`cluck-util.js`** (`esc` / `rpc` / `shortAddr` / `fmt` / `copyText`). Don't re-type these into
  a page — private copies drifted badly enough to cause real bugs.

⚠️ **The file a route serves is often NOT the file named after it.** Tool merges left old pages
behind: `/holders` + `/snapshot` → `token-holders.html`; `/buyspecial` + `/rose` →
`buyspecial-pro.html`; `/security-coop` + `/wallet-checkup` → `wallet-checkup.html`; `/liquidity`
+ `/liquidity-engine` → `liquidity-locked.html`. **Grep server.js for the route before editing a
page** — a session lost a whole polish pass to this.

⚠️ **`public/` is NOT statically mounted.** New assets need an explicit `app.get` route. The
catch-all returns real 404s for `/api/*` (JSON, any method) and for static-asset extensions, so a
missing file now fails loudly instead of being served the React shell at 200.

---

## Things that will bite you

- **The whole scheduler block only starts if `TELEGRAM_BOT_TOKEN` AND `TELEGRAM_CHAT_ID` are set
  at boot.** Missing either → no alerts, lessons, radar, recap, graduation watcher. First thing to
  check when "the bot isn't doing X."
- **`X_AUTOPOST_PAUSED=true` hard-gates `postToX`.** A new auto-poster that doesn't pass
  `{force:true}` posts nothing and reports `{ok:false,paused:true}`. Carve-outs need an owner ask,
  and must alert the operator chat on failure rather than failing silently.
- **A Telegram post with an image gets 1024 characters, not 4096** — and our own code silently
  truncates at 1024 while returning success. Count the caption; put load-bearing lines (the X
  link, a CTA) where truncation can't eat them. Recover with `&replaceMsg=<oldId>`.
- ⛔ **Never call `SystemProgram.transfer()` — or any web3.js layout encoder — in a browser page.**
  It encodes u64 through `toBufferLE()`, which needs the Node `Buffer` global browsers don't have,
  and we ship no polyfill. This silently killed three money paths at once. Use
  `splToken.createSolTransferInstruction()` in `public/airdrop-engine.js`; if you add a new
  instruction type, build it with `Uint8Array`/`DataView` and **diff its bytes against the library
  in Node before shipping.**
- 🛡️ **Phantom "may be malicious" on multi-signer txs:** the **connected wallet must sign FIRST**,
  then extra signers. Build unsigned server-side → `provider.signTransaction(tx)` →
  `signed.partialSign(base)` → submit raw. Never pre-sign server-side, and never
  `signAndSendTransaction` when a non-wallet signer exists. `/locker-room` is the reference impl.
- **Escape anything from an API, URL or chain metadata before `innerHTML`** — token names and
  symbols are attacker-controlled. Use `CluckUtil.esc`; five hand-rolled copies were missing the
  single-quote escape.

---

## Conventions

- **Typography:** `var(--body)` (Chakra Petch) for body copy, `var(--disp)` (Anton) for headings
  and chips only, `var(--mono)` for data. **The type scale lives in `theme.css`** — prose 15px in
  `--body-text`, small print floored at 12.5px. Change it there, once. Never write literal
  `'Anton', sans-serif` or `system-ui` in a page.
- **Never redefine a theme token inside a page.** A page-local `:root` shadows `theme.css`, and
  aliasing a name to itself (`--disp: var(--disp)`) is discarded by CSS — silently dropping every
  heading to the inherited font.
- ⚠️ **CSS specificity compares class count before element selectors.** `html body .foo` (0-1-2)
  LOSES to a page's `.card .foo` (0-2-0). Match the class depth; piling on `html body` never
  helps. This bit twice in one day.
- **Disabled CTAs go neutral grey**, not dimmed orange — a faded gradient on dark reads as broken
  rather than inactive.
- **Anywhere a user can connect a wallet, they must be able to disconnect** — show which wallet is
  connected, call the provider's own `disconnect()` *and* clear local state.
- Tool pages are vanilla HTML + inline JS; the school is React.

---

## Verification: check every form, not one form

This cost a full day. Four times in one session a "done" was wrong because one spelling of a
thing was checked and the whole class assumed clear:

1. `function esc(` was migrated everywhere — six copies written `var esc = function` /
   `const esc = s =>` survived, one carrying an XSS gap.
2. Seven `const WALLETS = {` literals were consolidated — three more detectors named
   `adDetect()`, `getProvider()` and an in-IIFE `detectWallets()` survived.
3. Rendered-page measurement said "all clean" while text built in JS template strings was still
   tiny — the pages were measured **idle**, and these tools are renderers.
4. A source scan said "zero remaining" while CSS class rules were still small — there the size is
   in the sheet and the sentence is in the markup.

**Rendered measurement and source scanning have complementary blind spots. Run both.** Read a
harness's own status flag before believing its numbers — an autopsy that never ran
(`REPORT RENDERED: false`) silently re-measured the idle page and got reported as a result.

An audit that finds "109 rules under 12.5px" is a **map of where a trap can recur, not a to-do
list** — only two carried prose; the rest were labels doing their job.

---

## Secrets & environment

The repo ships zero secrets; a fresh clone has none. They live in **Railway** (the app) and the
Claude-web environment config. Names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HELIUS_API_KEY`,
`BAGS_API_KEY`, `ANTHROPIC_API_KEY`, `SOLANA_TRACKER_API_KEY`, `SOLSCAN_API_KEY`,
`PREMIUM_ACCESS_KEY`, `BUYCOMP_KEY`, the four `X_*` keys, the three `GOOGLE_*` keys,
`HATCHERY_TURBO_KEY`, `HATCHERY_FEE_LAMPORTS`, `DATA_DIR`, `MM_OPERATOR_SECRET` (unset = the
autonomous vault is fully off, a safe no-op — use a wallet holding only the MM float, never the
treasury or a mint authority).

Optional, all safe unset: `FALLBACK_RPC_URL`, `HELIUS_API_KEY_2`, `RPC_DEBUG`, `JUPITER_API_KEY`,
and the ElevenLabs TTS set (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`,
`TTS_DAILY_CHAR_CAP`) — unset means read-aloud falls back to the free browser voice.

**The school ships in SEVEN languages** — en / es / hi / it / pt / vi / zh. That's the number to
quote in grant material. Translations live in `public/i18n/*.json` (+ `*.school.json`,
`*.locker.json`); keep the count in sync when adding one.

Persistence: a Railway volume at `/data` (consumed signatures, graduation tracker, scheduler
timestamps, analytics, transcripts) survives redeploys.

**The app's own Claude calls:** Sonnet paths use `claude-sonnet-5` and all pass
`thinking: {type:"disabled"}` deliberately — don't remove it. On Sonnet 5, omitting it turns
adaptive thinking on, and `max_tokens` caps thinking + answer together, which truncates
short-form copy going out to X/Telegram. Haiku paths stay on `claude-haiku-4-5-20251001`. No
`temperature`/`top_p`/prefills — all three 400 on Sonnet 5.

---

## Build & check

- Run `npm start`. React: `npm run dev` / `npm run build`.
- After editing backend JS: `node --check server.js`, plus any lib you touched.
- CI (`.github/workflows/syntax-check.yml`) is the tripwire for a no-staging auto-deploy: syntax
  check on every backend file, an undefined-JSX-component guard, a curriculum count-drift guard,
  the Normie Quest geometry check, and a headless smoke test that renders every screen and lesson.
  **Each exists because something got past the previous set — don't remove them casually.**
- Cloud session recovery (containers reset mid-session):
  `git fetch origin --prune && git reset --hard origin/<branch> && npm install`. GitHub is truth.

---

## Open decisions — the owner's call, not yours

- **Buy Special lost its CLKN price.** Retiring send-to-unlock removed the 5,850-CLKN door priced
  on 2026-07-24 to be ~25% cheaper than SOL. Paying in CLKN is no longer possible there, only
  holding. That reversed a deliberate decision — re-raise it rather than assuming it's settled.
- **Nomadz — reopened.** Their CEO replied about featuring their Solana hotel-booking product.
  **Build nothing until the owner says what was agreed** — a reply is not a scope. Then treat it
  as an education section, not an endorsement.
- **Solana Foundation — CLOSED.** Denied again (owner, 2026-07-31), and every mention has been
  stripped: the `@SolanaFndn` tag on the daily lesson tweet and on the 4pm bump, "grant info" in
  the bot's About card, and the two application docs under `docs/`. Don't reapply, don't re-add the
  tag, and don't build work premised on Foundation support. `@solana` stays on the bump — that's
  the ecosystem the school teaches, not a funding claim. README and `/investors` never carried a
  Foundation claim; `/grant` was already retired to a 301.
- **CoinGecko — CLOSED.** Rejected three times; the owner decided against reapplying. Don't
  re-suggest it. The GeckoTerminal listing stays.
- **Autopsy premium styling** — those sections render off-theme. Leave them visually distinct so
  the tier stands out, or restyle on-brand? Decide deliberately before touching.
- ⚠️ **Graduation is a pure client assertion**, and each new graduate spends treasury SOL on a
  cNFT, bounded only by a rate limit and a daily cap. Worth gating before it's promoted anywhere.
- **Never verified end-to-end:** no rendered autopsy report, no real lock, and no connect-and-sign
  with a real wallet has ever been exercised by a session — they need keys a cloud container
  doesn't have. They're also where the worst bugs have hidden.

---

## Removed — don't rebuild without an explicit ask

The Ultimate Challenge and Survival Simulator (zero diplomas issued in their entire life, and the
answer key was publicly readable), Cluck Score (gave good scores to tokens that then rugged), the
Coop Spinner slots (nobody played), `/curriculum` (laid out every lesson and quiz question on one
page), and Token Vitals. Git has them all.
