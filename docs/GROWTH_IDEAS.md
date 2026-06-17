# Growth & Product Ideas

External growth/product strategy input, reconciled against what the project **already ships**
(the reviewer had no repo access). Same convention as CODE_REVIEW_NOTES.md:
✅ already shipped · 🟡 partially there / formalize · 🆕 genuinely net-new · ❌ off-strategy.
Nothing here is implemented — it's a prioritized opportunity backlog.

## Round 1 — "Big things to improve: user growth + learning community" (logged 2026-06-16)

### ✅ Already shipped (don't rebuild — point people at these)
- **"New to Solana?" guided onboarding / "Start Here."** The **"Where do I start?" concierge** already
  lives on the landing AND greets every Telegram join — journey buttons (brand new · basics · liquidity ·
  token research · about/buy CLKN · exploring) route to the right lesson/tool, and replying hands off to an
  app-aware guide AI (`/guide`, `/start`). (README:44/179, server.js:1211+.)
- **Belt / visible-progress system.** 12 progressive lessons, **belts Freshman → Emeritus**, pass-to-promote,
  plus the **Incubator** tiny-beginner track (wallets/tokens/safety). (server.js:1231/1274.)
- **Viral diploma/transcript.** Server-scored Ultimate Challenge → permanent shareable `/transcript` + OG
  share card + on-chain **cNFT diploma**. Already "progress export," already shareable.
- **Caching** (autopsy 3-min, pool scanner 60s, bags 5-min) and **dark mode** — both already done.
- **Some leaderboards exist:** buy-competition "The Siren" + slots board (server.js:682/5583).

### 🟡 Partially there — formalize or extend (medium effort, high payoff)
- **Named structured tracks.** The *content* for Newbie / LP-Master / Token-Creator already exists
  (Incubator, 12-lesson course, LP Lab, Hatchery) — but it isn't packaged as explicit, pickable "tracks"
  with their own progress bars. Formalizing the concierge routes into named tracks is mostly UI/packaging.
- **Content machine.** Cluck's Lesson already auto-posts to Telegram **and** X several times/day; the net-new
  is a repeatable **"we autopsied the top N new tokens this week" thread/Short** format off existing
  Autopsy/X-Ray output (the data + tools are there; it's a templating + cadence job).
- **Learning leaderboards.** Code literally says "the leaderboard is coming — top scorers will be recognized"
  (server.js:5819). Graduation count / Survival-Simulator high score / "most helpful" (reputation, **no
  tokens**) is a natural, already-anticipated add on top of the existing slots/buy-comp board machinery.
- **Mobile.** App is wrapped natively for the Seeker dApp Store, but the React UI is flagged desktop-heavy
  (CODE_REVIEW_NOTES Review 10). Mobile-responsive Survival Simulator = real retention win.

### 🆕 Genuinely net-new (highest *new* opportunity — nothing in the repo does these)
- **Weekly/daily learning challenges** ("this week: revoke all approvals on your wallet"). The *tools* exist
  (Security Coop, X-Ray); the challenge framing + tracking is new. (Distinct from the daily slots spins.)
- **Streaks** — no streak mechanic exists today; classic retention lever, zero token involvement.
- **Referral / invite recognition (non-token)** — none in the repo. Reward invites with recognition or
  better tool access, not tokens (fits the no-pump ethos).
- **User-generated Survival scenarios** (student submits → you approve) — strong ownership/moat play; not built.
- **Email or personalized Telegram digest** ("what you missed in the Schoolyard"). NOTE: there is **no email
  system** today (only a Google-Sheets service account; no nodemailer/SendGrid). A *personalized* TG digest
  is also new (current TG posts are broadcast, not per-learner). New plumbing either way.
- **Lesson-level drop-off / funnel analytics.** `lib/analytics.js` tracks paths/tools/referrers, NOT
  per-lesson completion/abandon. Knowing *which lesson people quit* is new instrumentation — and arguably the
  highest-ROI item here, because it tells you where to spend the rest of this list.
- **Community cohort features** (Discord/TG channels by belt, live "office hours" w/ archive, study-buddy
  pairing) — all new; the deepest "learning community" moat but also the most ops-heavy.
- **Video walkthroughs** (3-min explainers; beginner-proof Hatchery/Security Coop) — none today (text + AI tutor).
- **SEO** — tool pages are vanilla HTML; targeting "is X Solana token a rug / Solana token autopsy / safe
  Raydium LP" is mostly meta/title/content work on pages that already have the best underlying content.

### Suggested sequencing (my read, not the reviewer's)
1. **Lesson funnel analytics first** — cheap, and it makes every other decision data-driven (which lessons to
   fix, where onboarding leaks).
2. **Formalize named tracks + learning leaderboard + streaks** — high retention, builds on shipped pieces.
3. **Weekly challenges + UGC scenarios** — community ownership, leans on existing tools.
4. **Digest + referral + SEO** — organic growth engines once retention is solid.
5. **Cohort/office-hours/video** — biggest moat, most ops; do when there's a community to serve.

### ❌ Stay-the-course guardrail
- Every item above is reputation/recognition-based. Keep it **zero token-pumping** — consistent with the
  no-wash-volume, "facts not hype" stance already baked into the project (and the recent Cluck Score / organic-
  score-claim removals). Don't let any "referral" or "leaderboard" idea drift into token incentives.

<!-- Append future growth/product rounds below as ## Round 2, ... -->
