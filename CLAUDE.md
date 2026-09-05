# CLAUDE.md — Cluck Norris (CLKN)

Operating notes for any session, **especially cloud/web ones that start from a fresh clone with
no local files.** Read this first.

This file is deliberately short. It carries the **mission**, the **owner's decisions**, and the
**traps that already cost someone a day** — things you can't derive from reading the code. It
does not tell you how to write software; use your judgement for that.

> Detailed operational history — engine states, position sizes, past comps, superseded
> strategies — lives in `git log` and `docs/`. It was trimmed out of here on 2026-07-30 because
> a stale instruction stated with authority is worse than no instruction, and several were.

> 📋 **Starting a session? Read `docs/HANDOFF_2026-08-02.md` first** — the permissions answer that
> cost an afternoon (and why it is NOT fixable from this repo), the RPC method name that fails only
> in production, and the i18n keys that silently drop six languages if you edit English copy.
> Nothing in it is blocking: §0 is resolved.
> `docs/HANDOFF_2026-08-01.md` is still current for the security follow-ups and the unplayed boss
> fixes.

> 💼 **Running the Jup-verification service on a client token? Read
> `docs/CLKN_JUP_VERIFICATION_PROTOCOL.md` first** — the **CLKN Productions Jup Verification
> Protocol** ("JVP", owner-named 2026-09-01) is the codified engine playbook proven on
> POKE/CUNA/DNC/ROSE: intake → pools → engine profile → score/holders → ops, plus a traps
> appendix where every entry cost real money once. Don't improvise a go-live; the sequencing
> traps in there (arm-first, two-flags, stale PDAs, orphaned positions) all bit within one week.

> 🪙 **Touching CUNA staking or the daily burn? Read `docs/CUNA_STAKING_RUNBOOK.md` first.** Both
> ship DISARMED and each needs two flags to arm; the burner additionally needs its own
> `CUNA_BURN_SECRET`. The four things that hold the money are listed there — chief among them that
> **Rule B (exclude-by-recipient-and-creator) is the ONLY thing keeping 2.285B of treasury locks out
> of the pool**, since nothing about their terms disqualifies them. Lock terms are measured FORWARD
> from our own `firstSeenAt`, never from `vesting_start_time` (Jupiter sets that equal to the cliff,
> and it is creator-set — live CUNA escrows declare 2069 and 2077).

> 🎮 **Working on Normie Quest? Read `docs/HANDOFF_2026-07-27.md` first.** It carries the branch
> state, the open decisions, and how to verify a change: `node normie-quest/test/nq-verify.cjs
> <baseUrl>` reads the diff and picks the right checks. Don't run the full state test (every level —
> 90 today) by reflex — a day went to running it for icon swaps it could never have validated.

> 🩹 **Boss "sunk in the floor", character speed, or the 2×-resolution question? Read
> `docs/HANDOFF_2026-08-16.md` first.** The boss "waist-deep" look was an ART crop — the boss cutouts
> had no feet — NOT a position or resolution bug (that finding cost ~24h).
> **RESOLVED 2026-08-16:** the KOL and Custodian plates were replaced with full-body art, and the
> grounding-shadow mitigation was deleted. There WAS also a small real position bug underneath it:
> the boss body box ended at 96% of the texture while every plate is trimmed to 100% content, so
> every gravity boss sank by 4% of its display height. Body bottoms are now 1.00 and all six ground
> bosses measure feet exactly on `GY`. Regression guard: `node normie-quest/test/nq-boss-ground.cjs
> <baseUrl>`. The speed tuning landed 2026-08-16 (owner's numbers: base 192, boost 225 — see the
> retune commit); the moon world's two 280px showpiece gaps were trimmed to 240px to stay makeable.
> ⚠️ iOS audio has FOUR dead states, not two: 'suspended', WebKit's 'interrupted', 'closed' (memory
> pressure — terminal, needs a NEW context), and the ZOMBIE (state says 'running', currentTime
> frozen, zero output — the state field LIES; only the clock is honest). The rebuild machinery in
> game_logic.js handles all four; don't simplify it back to a state check. The pause card shows a
> live `audio:` line for field diagnosis on iPads.
> ⚠️ Bosses are scaled by HEIGHT, so **swapping in a plate with different bottom margin silently
> re-breaks this.** A floating boss must declare `bossBodyBot` on its level def (the GHOST GALLEON
> does); anything that stands on the ground leaves it at the 1.00 default.

---

## The mission

**School of Crypto Hard Knocks** — a free Solana crypto school wrapped around real tools:
the heavy tools are free to anyone holding ~$50 of CLKN (else a small SOL pass), the safety
basics stay free for everyone. Live at **clucknorris.app**.

The point is that people lose money in crypto because nobody told them the truth plainly, and
this teaches them before they get hurt. Design calls should serve that:

- **Learning and safety stay genuinely free.** The school, the AI tutor, Wallet Checkup,
  Firepit, the Locker Room — no wallet, no signup, no catch. The **heavy tools** (X-Ray,
  Holders, Trace, Airdrop, Buy Special) moved behind the **unified tools pass on 2026-08-18**
  (owner's call, for the app-store transition): hold **$50 worth of CLKN** (live-priced,
  `/api/tool-gate/config`, never hardcode the amount) = all free; else **0.05 SOL for a 7-day
  all-tools pass**. Client: `cluck-gate.js` — pages preview free, RUN/SEND needs the pass.
  Kill switch: `TOOLGATE_OFF=1`. Planned: lifetime-pass NFTs hook into the comp check.
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

**Normie Quest** runs under Cluck Norris production for the NORMIE community, and went public
on **2026-08-22** at `/normie-quest-x7` with owner-set holder terms: free worlds 1-3, **$5 of
NORMIE → worlds 4-12, $50 → everything** (live-priced — `docs/NQ_LAUNCH_GATE.md` is the
runbook; never hardcode an amount, all copy renders from `/api/nq/wallet/config`). This
supersedes the old "gating is testing-only, promise nothing" rule for ACCESS TIERS specifically;
**rewards/prize terms with the NORMIE team remain unagreed** — don't promise those. VIP-wing
terms are still owner-to-confirm.

**Wallet Watch is PRIVATE** (owner ask, 2026-07-10) — **no public surface: never link or mention
it on the app or socials.** Its scheduler is hard-killed (`WALLET_WATCH_KILLED`) and the manual
`/api/wallet-watch?run=1&key=…` lever is left working on purpose for one-off owner use. Public
exposure is currently zero, so nothing will stop you adding some: don't put it in a tools roundup,
an investor page, or promo copy assembled from the endpoint list. (Restored 2026-08-01 — this
constraint was dropped by the 07-30 trim; see `docs/CLAUDE_MD_TRIM_2026-07-30.md`.)

CLKN mint: `DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`

---

## Working agreement

- **Shipping cadence (retro, 2026-08-28): open the PR on the FIRST commit of a batch** — a
  push made before its PR opens never fires CI (GitHub quirk) and stalls the cycle. Batch
  related changes into one PR; ship solo only for live incidents. **Backend/engine changes go
  direct to `main` after CI + the engine simulator; anything visual or product-facing goes
  through staging for the owner's eyeball first** — the visual gate catches regressions, not
  taste. Squash-merges make the long-lived session branch conflict with `main` on the next
  PR: resolve by merging `origin/main` and keeping the branch side (it is the superset).
- **Branching: `develop` → staging, `main` → production (owner, 2026-08-15).** Do day-to-day work
  on **`develop`** (or a feature branch merged into it); Railway's staging service auto-deploys it.
  Railway also auto-deploys **`main`**, so **a push to `main` IS a production release.** As the app
  goes public and beta ends, the owner's rule is explicit — *"once we go fully live … I don't want
  to automatically submit changes to the live product"* — so **promote `develop` → `main` only on an
  explicit owner go in the moment; never automatically, never inferred.** The owner is the sole
  sign-off (he reviews staging + dashboard feedback). Pushing to `develop`/a feature branch is free;
  **`main` is gated.** This supersedes the older "push freely to `main`" grant for the public era,
  which is now. Still **ask first for anything destructive** — force-push, `reset --hard`, branch
  delete. That was never granted. Full flow + the visual gate: `docs/STAGING_WORKFLOW.md`.
- 💸 **Model tiering — match the model to the task (owner, 2026-09-03: "Fable should be about
  hard task ideas and conceptual ideas and lower models using for most things").** The default
  is that a subagent inherits the session model, and that default is the single biggest source
  of waste in this repo. Pass `model:` explicitly on **every** `Agent` call and every `agent()`
  in a Workflow script:
  - **Haiku** — mechanical, verifiable work with a right answer: greps and inventories, "is this
    file referenced anywhere", dead-code confirmation, running a test and reporting output,
    reading an endpoint and reformatting the JSON, docs/link drift, single-file find-and-replace.
    Pair with `effort: 'low'`.
  - **Sonnet** — the workhorse: reading a subsystem and reporting how it works, applying a
    described fix, writing a page or a test, drafting copy, most find-and-fix passes.
  - **Opus / Fable** — reserve for judgement that costs money if wrong: synthesis across many
    agents' findings, adversarial verification on money/auth paths, architecture and product
    decisions, anything touching the engine, payments or the brand bag. A verifier on a
    money-path finding is worth the tier; a verifier on a stale comment is not.
  Same rule for **scheduled routines**: a poller that usually does nothing does not need a
  frontier model. Fresh-session routines (`create_new_session_on_fire`) accept a `model` — set
  it. Self-bound routines inherit this session's model and cannot be tiered, so for those cut
  **frequency** instead, and prefer a fresh-session routine when the job needs no conversation
  context. Applied 2026-09-03: lock-celebration watcher → `claude-sonnet-5`; CUNA meme queue
  hourly → every 3h.
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
- ⚠️ **`tgSend` and `postToX` SWALLOW their own errors and return null / `{ok:false}` — they never
  throw.** So `await tgSend(...)` followed by a `kv.set` watermark is a silent-loss bug, not a
  send: an outage looks exactly like success. Three schedulers had it (fixed 2026-09-04) — the
  worst marked new graduates "seen" after a DM that never arrived, so no later tick resurfaced
  them and their airdrop prompt never registered. **Check the return value, and never advance
  durable state on a send that did not land.** `scripts/broadcast-integrity-test.cjs` guards it.

---

## Shipping: test on staging before production

The reason this exists: on 2026-08-13 a 3×-zoom change slid the game HUD off-screen and shipped
straight to live, because `main` auto-deploys with nothing between it and production and no check
could *see* the render. The fix is a real staging step plus a visual gate.

1. Build on **`develop`** → Railway staging auto-deploys it. Test there (desktop **and** a phone).
2. **Run the visual gate before every push:** boot a server, then
   `node normie-quest/test/nq-visual.cjs <baseUrl>`. It renders the title, the top HUD, all three
   characters, and the gravemite, and pixel-diffs each against `normie-quest/test/visual-baselines/`.
   Character/creature crops are *position-aware* (`window.__NQ_RECT` tells it where the sprite is),
   so a baseline can't silently frame empty background. It's a **regression detector, not a judge of
   taste** — "different from approved", not "good". When a change is intentional, re-approve with
   `--update`, **eyeball the new baseline PNGs**, and commit them (that PNG diff is the owner's review
   surface). CI runs it too and uploads diff images on failure. `NQ_RES=3 node …/nq-visual.cjs`
   reproduces the exact HUD break on demand.
3. Owner reviews staging + dashboard feedback → says go → **only then** promote `develop` → `main`.

⚠️ Two tiers. Right now only the **gravemite** (a stationary sprite) is a **hard gate** (threshold
5.0%, measured ~3.1% cross-machine at RES=3 — see the calibration note in `nq-visual.cjs`; ~1.9% was
the 2× figure). **Advisory** (reported + imaged, never blocks CI): the **text** surfaces (title, HUD — arcade
webfont, CI-measured 6.8% / 4.7% per-machine) and, pending a determinism fix, the **character**
surfaces. The characters flaked — the same unchanged game swung a char surface 0 → 4.4% between CI
runs because the player is still physics-settling when the shot is taken. The fix (tracked
TODO in `nq-visual.cjs`) is to settle + freeze the player before capturing, then restore the chars to
hard gates; likewise self-hosting the arcade font promotes title/HUD. A res=3-class break still can't
slip silently — it lights up every advisory at once. Details + the one-time Railway/Cloudflare staging
setup: `docs/STAGING_WORKFLOW.md`.

---

## Money: what you may and may not touch

The owner manages all liquidity positions **manually**. Read freely; touch nothing.

- ⛔ **WATCH-ONLY.** Don't rebalance, recenter, close, redeploy, add/remove liquidity, or
  buy/sell CLKN. Don't "take over." Observe and log.
- **ONE carve-out (owner, 2026-08-19): POKEAHOE.** The scoped `poke` engine in server.js
  (`POKE_ENGINE_ON=1`) autonomously runs the two Orca 0.01% POKEAHOE pools at ±1% for VOLUME —
  crystallized IL explicitly accepted. It signs with `MM_OPERATOR_SECRET_TREASURY` (owner's
  explicit call, overriding the "operator ≠ treasury" preference for this project) and may touch
  **POKEAHOE, USDC, and SOL only** — the brand bag, ROSE, and everything else in that wallet stay
  under the watch-only rule above. It is deliberately independent of `LIQ_ENGINE_KILLED`; do not
  widen it to other projects or route other projects around the master kill without an owner ask.
  **ON BY DEFAULT** (owner's explicit go, same day) with buyback enabled (excess USDC → POKE);
  the pools' ask side is the sell direction — the swap layer never market-dumps the token.
  Instant stop: `curl -X POST 'https://clucknorris.app/api/whirlpool/vault/pause?project=poke&key=…'`
  — the route is **POST-only**, so a browser hit or a bare `curl` (GET) falls through to the
  `/api/*` catch-all and returns `not_found`, which looks like "endpoint gone" in the middle of a
  stop; durable stop: `POKE_ENGINE_OFF=1`.
- ⛔ **The brand bag is protected — with ONE owner-defined carve-out (2026-08-31).** The original
  bag is never sold. But the owner revised the blanket rule: a tight-quoting engine that ABSORBS
  someone's sell may sell that absorbed inventory back to recoup its quote funds ("those sells
  would show up on the chart anyway — it's only fair we recoup as our base funds for volume").
  Mechanism: `/api/whirlpool/vault/recoup-baseline?project=…&arm=1` snapshots current holdings as
  a protected baseline; `manualSwap` then allows selling ONLY the amount above it. Disarmed +
  baseline-less = the historic never-sell behavior, and that is the default everywhere. Also:
  **never buy CLKN with operator funds** without asking in that moment (owner rule, after
  unwanted inventory buys).
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

## How access works (payment model — UNIFIED 2026-08-18, supersedes the 07-30 per-tool model)

Every gate resolves through the **connected wallet**: hold CLKN (free), pay a small SOL price
in one click, or sign a message where the gate is *ownership* rather than payment.

- **The unified tools pass** (X-Ray, Holders, Trace, airdropper, Buy Special): hold **$50 worth
  of CLKN** → all free; else **0.05 SOL = 7-day pass to all of them**. ONE localStorage pass
  (`clkn_tools_unlock`), one client (`cluck-gate.js`), config at `/api/tool-gate/config`
  ($-amount → CLKN computed from the live price; env knobs `TOOLGATE_USD/LAMPORTS/DAYS/OFF`).
  Pages preview free — the gate fires on RUN/SEND. Fail-open when pricing is down. The old
  per-tool thresholds (50k airdropper / 100k Buy Special) are RETIRED by this.
- premium forensics — holder-gated at 2M, re-checked live on every run (NOT part of the pass)
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

⚠️ **`public/` is NOT mounted directly — it is served only through the vite build's copy in
`dist/`** (vite's default `publicDir` copies `public/` into `dist/`, which `express.static` mounts
after the explicit routes, server.js ~14428). So a file with no `app.get` route works in production
after `npm run build` but **404s on a no-build boot** (the CI visual gate, `node server.js` on a fresh
clone) and gets default cache headers — add an explicit route when you need headers or a no-build
boot. It also means every `public/*.html` is reachable raw at `/<name>.html` (the duplicate-URL path
the deleted-pages comment in server.js describes). The catch-all returns real 404s for `/api/*`
(JSON, any method) and for static-asset extensions, so a missing file fails loudly instead of being
served the React shell at 200.

---

## Things that will bite you

- **The whole scheduler block only starts if `TELEGRAM_BOT_TOKEN` AND `TELEGRAM_CHAT_ID` are set
  at boot.** Missing either → no alerts, lessons, radar, recap, graduation watcher. First thing to
  check when "the bot isn't doing X."
- **`X_AUTOPOST_PAUSED=true` hard-gates `postToX`.** A new auto-poster that doesn't pass
  `{force:true}` posts nothing and reports `{ok:false,paused:true}`. Carve-outs need an owner ask,
  and must alert the operator chat on failure rather than failing silently. ⚠️ **This list said
  "two carve-outs" and was WRONG** (corrected 2026-09-04 — `force:true` is passed from ELEVEN call
  sites). Autonomous posters that still reach X while paused: **lock announcements**
  (`postLockToX`), **project-burn celebrations** (`broadcastBurnCelebration`,
  owner 2026-08-20 — every verified burn auto-posts X-then-Telegram), the **daily lesson
  tweet and its reply**, the **lesson bump replies**, **chain spotlights**, and **approved queued
  content**. The operator-triggered admin post/meme endpoints also pass `force`, which is no
  surprise — a human just asked for that post. `postToX` now LOGS a line every time the carve-out
  fires, so the real scope is visible rather than inferred. **Keep this list in step with the
  call sites.** ⚠️ The burn broadcaster posts
  **attacker-supplied token metadata** to the brand channels, so it hard-sanitizes the symbol to
  `[A-Za-z0-9]` (never the free-form name) and rate-limits itself (per-wallet/mint cooldown + hourly
  cap) so a griefer can't spam our X into a suspension. Don't loosen either without thinking it through.
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
- 🎮 **Phaser: `setScrollFactor(0)` does NOT take an object out of the camera transform.** It stops it
  scrolling; a zoomed camera still scales it about the viewport centre
  (`screen = half + zoom*(p - half)`, `half = cam.width/2`). So "place at (0,0), size it
  `cam.width × cam.height`" draws RES times too big and off-screen. That is what cropped every world
  backdrop to the middle `1/RES` (the "backgrounds are zoomed in" report — 1/4 of the plate at 2×, 1/9
  at 3×) and what slid the HUD off at 3×. Use `SCREEN_RECT(cam)` in `game_logic.js` for **any**
  screen-pinned object; never hardcode the anchor. Fixed 2026-08-16 — and note it survived a whole
  session of being argued away as "no regression found", so trust the screenshot over the reasoning:
  compare the level against `normie-quest/public/worlds/<plate>.webp`.
- **The engine boot ratchets re-assert per-project config on EVERY deploy** — a live config
  write silently reverts on the next push to `main` unless it was made with `&durable=1`
  (stored in kv `ratchetOverrides:<project>`, merged over the code defaults at boot, cleared
  by writing the key as null). This trap cost live tuning twice on 2026-08-28 before the
  override mechanism existed. Engine GATE logic is pure in `lib/engine-decisions.js` —
  changing a gate means updating `scripts/engine-sim-test.cjs` (CI runs it; each scenario is
  a real incident) and replaying it locally BEFORE shipping, not debugging in production.
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

## Security messaging — always credit RootCrak + drop the referral (owner, 2026-08-04)

Whenever we talk about security publicly — X, Telegram, the site, investor/grant copy — **credit
RootCrak** and **include our referral link**. They're the security-scan partner whose findings we
act on (the homepage footer badge is theirs), and the referral is a standing ask.

- RootCrak X handle: **@ro0TCr4k**
- Our referral link: **https://rootcrak.com/?ref=clucknorris** (use this exact URL — the
  `?ref=clucknorris` is what credits us)

Keep the claim honest — only say a finding is *fixed* when it actually is. As of **2026-08-04**
both are LIVE: the Cloudflare WAF/CDN cutover, AND the `CF_ORIGIN_SECRET` origin-lockdown (a
Cloudflare Request-Header Transform Rule injects `X-Cluck-Edge-Auth` on all requests; the origin
403s anything without it, so direct-to-origin-IP access can no longer bypass the WAF; `/healthz`
is exempt). ⚠️ If you ever rotate the secret, change it in BOTH the Cloudflare rule and the Railway
env var, rule first — arming the env var before the rule injects the header 403s the whole site
(it happened twice on 2026-08-04). Full runbook: `docs/CLOUDFLARE_WAF_RUNBOOK.md`.

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

Optional, all safe unset: `POKE_ENGINE_OFF` (=1 disarms the scoped POKEAHOE vault scheduler,
which is ON by default — see the Money section), `FALLBACK_RPC_URL`, `HELIUS_API_KEY_2`,
`RPC_DEBUG`, `JUPITER_API_KEY`,
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
  the Normie Quest geometry check, a headless smoke test that renders every screen and lesson, and
  the **Normie Quest visual-regression gate** (`nq-visual.cjs` — pixel-diffs the game's title, HUD,
  characters, and gravemite against committed baselines; catches the render-broke-but-built-clean
  class the smoke test can't see). **Each exists because something got past the previous set — don't
  remove them casually.**
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
- ✅ **Graduation gate shipped 2026-08-19** (was: pure client assertion → treasury-paid cNFT).
  `/api/claim` now checks a server-side lesson ledger (`lib/school-progress`, fed by `/api/track`
  with an anonymous per-browser sid). Runs in **monitor** (log-only) until **2026-09-02**, then
  auto-enforces; pre-gate learners are grandfathered via localStorage backfill until 2026-09-19.
  Owner controls: `/api/school/grad-gate?key=…` (mode/thresholds/inspection), `GRAD_GATE_OFF=1`
  kill. A blocked claim still saves the transcript — it withholds the badge, sheet row, and mint.
  ⚠️ Before the enforce date, glance at the `[GRAD-GATE] monitor (would block)` log lines /
  `blockedOrWouldBlock` counter — if legit learners are tripping it, tune before it arms.
- **Never verified end-to-end:** no rendered autopsy report, no real lock, and no connect-and-sign
  with a real wallet has ever been exercised by a session — they need keys a cloud container
  doesn't have. They're also where the worst bugs have hidden.

---

## Removed — don't rebuild without an explicit ask

The Ultimate Challenge and Survival Simulator (zero diplomas issued in their entire life, and the
answer key was publicly readable), Cluck Score (gave good scores to tokens that then rugged), the
Coop Spinner slots (nobody played), `/curriculum` (laid out every lesson and quiz question on one
page), and Token Vitals. Git has them all.
