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

**Determinism note:** the sprite surfaces (characters, gravemite) are stable across machines — same
PNG, same GPU blit. The text surfaces (title, HUD) depend on the arcade webfont and can carry
render noise between environments. If CI's text surfaces go flaky, refresh baselines *in CI* with
the workflow's `update_baselines` dispatch (below) and commit the uploaded artifact, so the
baselines are native to the environment that checks them. The structural breaks this gate exists
for dwarf any font noise.

CI runs the gate on `develop`, `main`, and PRs (`.github/workflows/syntax-check.yml`,
`visual-regression` job). On a failure it uploads the diff images as a build artifact for the owner
to look at.

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
