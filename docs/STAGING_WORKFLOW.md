# Staging workflow — test before production

**Why this exists:** `main` auto-deploys to production (Railway → clucknorris.app) with nothing in
between. On 2026-08-13 a 3×-zoom change slid the game HUD off-screen and shipped straight to live
because there was no place to catch it and no render check that could see it. As the app goes
public and beta testing ends, the owner's rule is explicit (2026-08-15): *"once we go fully live …
I don't want to automatically submit changes to the live product."*

This doc is the whole workflow: the branch model, the automated visual gate, and the **one-time
owner setup** in Railway and Cloudflare that stands up a real staging environment. The owner is the
sole sign-off.

---

## The branch model

| Branch | Deploys to | Who promotes | Gate |
|---|---|---|---|
| `develop` | **staging** (staging.clucknorris.app) | push freely | CI + visual gate on every push |
| `main` | **production** (clucknorris.app) | **owner go only, once public** | same CI, plus owner sign-off |

- Day-to-day work lands on `develop` (or a feature branch merged into it). Railway's staging
  service auto-deploys it.
- Promoting `develop` → `main` **is the production release**. Post-launch, that step happens only
  on an explicit owner "go" in the moment — never automatically, never inferred.
- Destructive git ops (force-push, `reset --hard`, branch delete) still need a per-time ask.

---

## The visual gate (automated)

`normie-quest/test/nq-visual.cjs` renders the game's key surfaces in a real browser and pixel-diffs
each against a committed baseline in `normie-quest/test/visual-baselines/`. It catches the class of
regression that builds and deploys clean but looks broken: the HUD moving, a character resized or
blurred, a creature shipping with a box baked around it.

```
# boot a server first (CI does this; locally you already have one), then:
node normie-quest/test/nq-visual.cjs http://localhost:3111            # compare vs baselines (exit 1 on regression)
node normie-quest/test/nq-visual.cjs http://localhost:3111 --update   # re-approve: regenerate baselines
NQ_RES=3 node normie-quest/test/nq-visual.cjs http://localhost:3111   # reproduce the 3x HUD break on demand
```

Surfaces guarded: **title**, the **top HUD** strip, **all three characters** (Normie, Princess,
Lil' Normie), and the **gravemite** creature. Character and creature crops are *position-aware* —
the harness asks the running game where the sprite is (`window.__NQ_RECT`) and frames it, so a
baseline can never silently capture empty background.

**It is a regression detector, not a judge of taste.** It says "different from what was approved",
not "good". When a visual change is intentional, re-run with `--update`, **look at the new baseline
PNGs**, and commit them — that PNG diff is the owner's review surface in the pull request.

**Two tiers (this is why CI stays green and still means something):**

- **Hard gate — the gravemite.** A stationary turret with no physics on the shot, stable to ~1.9%
  across machines. A regression here **fails the build** — this is the live "is the creature
  de-boxed / did a sprite break" coverage.
- **Advisory — everything else** (title, HUD, and the three characters). Reported with a diff image
  but **never fails the build**. Two different reasons:
  - *title / HUD*: dominated by the arcade webfont (Press Start 2P from Google Fonts), which
    rasterises a few % differently per machine (CI vs dev: 6.8% / 4.7%).
  - *characters*: the player spawns mid-air and physics-settles, so a shot at a fixed time catches a
    slightly different pose depending on the machine's timing — in CI the **same unchanged game**
    swung a character surface **0 % → 4.4 %** between runs, tripping a hard gate on nothing. They're
    advisory until the determinism fix lands.

**Follow-ups to promote surfaces back to hard gates** (both good first changes to dogfood through
this very staging flow):

1. *Characters* — settle-and-freeze the player before the shot (poll `__NQ_DBG` until grounded,
   then `__NQ_PAUSE`), regenerate baselines, re-tighten the threshold. Removes the pose variance so
   the character hard gate is reliable.
2. *title / HUD* — **self-host the arcade font** (base64 `@font-face`, drop the Google Fonts
   `<link>`); text then renders identically everywhere, and as a bonus the serif-fallback flash on a
   slow first load goes away.

A res=3-class break still can't slip silently even while these are advisory — it lights up title,
HUD, and all three character surfaces at once, every one of them imaged for review.

CI runs the gate on `develop`, `main`, and PRs (`.github/workflows/syntax-check.yml`,
`visual-regression` job). On a failure it uploads the diff images as a build artifact for the owner
to look at.

---

## The five-minute version (start here)

The full setup below is the hardened version. It sat undone for days because it reads like a
project, and a staging box you never build protects nothing. This is the minimum that actually
works, and it is all dashboard clicking — **no terminal, no Cloudflare** (owner's call, 2026-09-05).

1. Railway → **New service** → same GitHub repo → **deploy branch `develop`** → auto-deploy on.
2. Add a **new volume** at `/data`. ⚠️ Not production's — staging must not touch the real
   transcripts, graduation tracker or analytics.
3. Set **four** variables:

   ```
   DATA_DIR=/data
   STAGING=1
   SCHEDULERS_OFF=1
   PREMIUM_ACCESS_KEY=<a NEW random string, NOT production's>
   ```

4. Use the Railway-generated URL. Done.

**Why those four.** `STAGING=1` puts an unmissable banner on every page, sets `X-Robots-Tag:
noindex`, **refuses `postToX` outright**, and prefixes every Telegram message with `[STAGING]`.
`SCHEDULERS_OFF=1` keeps the daily automation from starting even if a bot token appears later.
A **different** `PREMIUM_ACCESS_KEY` is the one that matters most: staging's admin key must not
unlock production, because a key that leaks from a staging log or screenshot is a production key.

**On API keys:** reuse the read-only ones (`HELIUS_API_KEY`, `SOLANA_TRACKER_API_KEY`,
`SOLSCAN_API_KEY`, `BAGS_API_KEY`, `ANTHROPIC_API_KEY`) — staging just shares your quota. Generate
NEW values for `PREMIUM_ACCESS_KEY` and `BUYCOMP_KEY`. Without a Helius key chain reads fall back
to the public Solana RPC, which is slower and rate-limited but works fine for looking at pages.

**Never set on staging:** `MM_OPERATOR_SECRET`, `MM_OPERATOR_SECRET_TREASURY`, `CUNA_BURN_SECRET`,
the four `X_*` keys. A missing secret degrades to a safe no-op here, never a crash — when in doubt,
leave it out.

### Posting to a test Telegram room

Setting `TELEGRAM_CHAT_ID` is what boots the **entire** scheduler block — lessons, radar, recap,
graduation watcher, trade poller. Pointing staging at a test room without thinking turns it into a
second bot running a full daily schedule, not just somewhere to try one post.

So: set `TELEGRAM_BOT_TOKEN` + a **test room's** `TELEGRAM_CHAT_ID`, and keep `SCHEDULERS_OFF=1`.
Bot commands and manual posts (`/api/tg-test`) work; nothing fires on a timer. Every message is
prefixed `🚧 [STAGING]`, so if a copied env var ever points it at the real community room, what
lands is obviously a test rather than an announcement people act on.

---

## One-time owner setup

Everything below is done **once**, from the Railway and Cloudflare dashboards — it cannot be done
from this repo or the container. Do it in this order.

### 1. Railway: a staging service

The goal is a second service that deploys `develop` and is a **safe, side-effect-free clone** —
it must never touch Telegram, X, money, or the production data volume.

1. In the Railway project, **New → Empty Service** (or duplicate the production service). Name it
   `clkn-staging`.
2. **Source:** connect the same GitHub repo, but set the **deploy branch to `develop`** (production
   stays on `main`). Enable auto-deploy.
3. **Volume:** add a **new** volume mounted at `/data`. ⚠️ Do **not** share production's volume —
   staging must not read or write the real consumed-signatures / graduation / analytics stores. Set
   `DATA_DIR=/data` on staging (its own).
4. **Environment variables — copy the *read* keys, leave every *side-effect* key UNSET:**

   | Set on staging | Leave UNSET on staging (this is what makes it safe) |
   |---|---|
   | `HELIUS_API_KEY`, `HELIUS_API_KEY_2` (chain reads) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — **unset kills the entire scheduler block**: no alerts, lessons, radar, recap, graduation watcher, no bot posts. Exactly what we want on staging. |
   | `SOLANA_TRACKER_API_KEY`, `SOLSCAN_API_KEY`, `BAGS_API_KEY` (reads) | all four `X_*` keys — no tweets from staging (and `X_AUTOPOST_PAUSED=true` as belt-and-braces) |
   | `ANTHROPIC_API_KEY` (lessons/copy render) | `MM_OPERATOR_SECRET` — **unset = the autonomous vault is fully off**, a safe no-op. Never put a funded key on staging. |
   | `PREMIUM_ACCESS_KEY`, `BUYCOMP_KEY` (gate checks) | `HATCHERY_TURBO_KEY`, `HATCHERY_FEE_LAMPORTS` (no live hatchery fees) |
   | the three `GOOGLE_*` keys if you want TTS/sheets reads | `CF_ORIGIN_SECRET` — see step 3 of Cloudflare; set it only *after* the staging edge rule exists |

   When in doubt, leave it unset: this app is built so that a missing secret degrades to a safe
   no-op (scheduler off, vault off, posting off), never a crash.
5. Deploy. Confirm the staging service boots (`/healthz` returns 200) and that **no Telegram/X
   traffic** originates from it (the scheduler log line should say the bot block did not start).

### 2. Cloudflare: a staging subdomain, locked down

Staging must exist on the internet (Railway needs a public URL and you'll test on a phone) but must
**not** be publicly discoverable or indexed, and must not be mistaken for production.

1. **DNS:** add a CNAME `staging` → the Railway staging service's public domain. Proxy it (orange
   cloud) so it sits behind the same WAF/CDN as production.
2. **Lock it to you — Cloudflare Access:** put `staging.clucknorris.app` behind a **Cloudflare
   Access** self-hosted application with a policy allowing only the owner's email (one-time PIN or
   Google). This keeps testers and crawlers out without any app-side auth.
3. **Origin lockdown parity:** production uses `CF_ORIGIN_SECRET` → an injected `X-Cluck-Edge-Auth`
   header the origin requires (see `CLOUDFLARE_WAF_RUNBOOK.md`). If you want the same on staging,
   create the staging edge **Request-Header Transform rule FIRST**, *then* set `CF_ORIGIN_SECRET` on
   the staging service — **never the env var before the rule**, or the header check 403s the whole
   staging site (this ordering trap bit production twice on 2026-08-04). A distinct staging secret
   is fine; it does not need to match production's.
4. **Keep it private on our own surfaces too:** `staging.clucknorris.app` is never linked from the
   app, socials, investor/grant copy, or a tools roundup — same discipline as Wallet Watch.
   `noindex` it.

### 3. `robots` / no crawl

Staging returns the same app as production; make sure search engines don't index it. Cloudflare
Access (step 2) already blocks crawlers, but add a `X-Robots-Tag: noindex` at the staging edge as
defense in depth.

---

## The promotion, click by click (post-launch)

1. Work merged and green on `develop`; CI + visual gate pass; staging looks right on desktop and a
   phone; dashboard feedback reviewed.
2. Owner says **go**.
3. Promote: fast-forward `main` to `develop` (`git checkout main && git merge --ff-only develop &&
   git push`) — or merge the PR into `main`. Railway auto-deploys production.
4. Watch production `/healthz` and the surface you changed. Say what went live.

If anything looks wrong on production, the last-known-good `main` commit is the rollback target —
Railway can redeploy a previous deployment from its dashboard.
