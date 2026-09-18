# Pitch script — the 2–3 minute presentation video (Y3, `docs/COLOSSEUM_ROADMAP.md` §9)

Word-for-word, timed to the second. This is the **founder-on-camera** video
(`docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md`'s submission form: a separate 2–3 minute presentation
video, distinct from the ≤3 minute product demo) — per `docs/DEMO_STORYBOARD.md` Part 2, **never
a screen recording**. The founder talks; any on-screen element is a lower-third caption or a still
graphic, not a captured browser session (that's the demo video's job).

**Read this against the actual page before every recording**, not just on the day this was
re-timed (2026-09-18) — a line that was true on `develop` today can drift if the underlying route
changes. Every claim below was checked against the merged tree at commit `818557b` (the
`claude/colosseum-batch-15` branch, carrying Colosseum batches 9–15 into this session's working
branch): the Hub settlement library (`lib/hub/`), the settlement journal as the live payout path
(`lib/hub/settle.js`, PR #342), the browser verifier and its script/package twins
(`public/hub-verify.html`, `scripts/reproduce-receipt.cjs`, `packages/hub-verify`), the wallet
roll-up, compare, print, feed and glossary routes (`lib/hub/public.js`, `lib/hub/feed.js`,
`lib/hub/glossary.js`, `server.js`'s `/hub/*` routes), `lib/hub/readiness.js` (Launch Readiness),
the POKEAHOE dry-run project (E10), and `docs/VALIDATION_2026-09.md`'s three-column table. None of
it depends on `develop` having been promoted to `main` — a line that *would* depend on that is
marked **[if promoted]**; there are none in this cut because the script never tells a viewer to go
open a specific URL (the demo video does that).

**The disclosure this rests on.** `docs/PRE_EVENT_STATE.md` finalised its pre-Colosseum snapshot at
**2026-09-14 09:00 UTC**, four hours before the Contest Period opened at 13:00 UTC the same day.
**Fourteen Colosseum batches** (numbered 2 through 15) have merged since that snapshot, the most
recent — batch 15 — landing the docs-drift round and the storyboard captures this script is itself
checked against; nothing in this script is claimed as pre-window work. Re-run `git log
origin/main..origin/develop --oneline | grep "^Colosseum batch"` before recording to confirm the
count hasn't moved.

**Pacing:** ~150 words/minute, spoken-word register, short sentences. **436 words, 2:54 total** —
inside the 2–3 minute window, with room to breathe on delivery.

**Rules honored throughout:** no yield/APR/APY figure, no "guaranteed," nothing implying CLKN is
an investment, nothing about Normie Quest reward or prize terms, nothing about Wallet Watch, no
"verified project" or "safe" language, no prize claim in the ask. Every "dry run" reference below
is spoken aloud, not just implied.

---

## (0) The thesis — 0:00–0:12

| | |
|---|---|
| **On screen** | Cold open. Founder to camera. Lower-third: **clucknorris.app**. |
| **Script** | *"Cluck Norris is a free Solana crypto school wrapped around real tools. This window we built the Project Hub — a rewards program a holder can check without trusting us."* |

## (1) The insight — 0:12–0:47

| | |
|---|---|
| **On screen** | Founder to camera. Lower-third, timed to the matching sentence: **"published, not promised"** → **"Educate → Build → Earn."** |
| **Script** | *"Here's the insight. Every project says 'trust our rewards program.' We built the one case where a stranger doesn't have to: a hashed program version, every wallet's eligibility with a reason code, every payment as a receipt — and a script that re-derives the amount on the reader's own machine, offline, no trust required. The school is the front door, teaching what a lock and a multiplier even mean before anyone reads a receipt. That's Educate. The Hub is Build. The strongest Earn we can offer is proof."* |

## (2) What shipped in-window — 0:47–1:54

| | |
|---|---|
| **On screen** | Founder to camera. Lower-third call-outs, one per beat: **program version + hash** → **settlement journal — live** → **verify: reproduce it yourself** → **one wallet, every project** → **compare · print · follow** → **glossary** → **Launch Readiness** → **POKEAHOE — DRY RUN**. |
| **Script** | *"In this window we built the Hub's settlement library: program versions with a hash anyone can recompute, an accrual ledger, and eligibility reason codes instead of yes or no. Every receipt paid through the Hub's own route now settles through one append-only journal, the live payout path, not a plan. Paste a receipt into our verify page and your browser re-derives the amount offline, no server call; the same check also runs as a script and a standalone command. Check one wallet against every project we run, on one page, no wallet connect. See what changed between two program versions from the same public data, print a receipt to keep on paper, or follow a project with a feed reader instead of a login. Every reason code is defined once, in plain words, in our glossary. Launch Readiness blocks a program from arming until its funding wallet actually covers what's owed. And POKEAHOE is the Hub's second project, branded, honestly labelled dry run while we finish agreeing terms."* |

**Source check for this section:** `lib/hub/project.js` (`canonicalJson`/`sha256`), `lib/hub/eligibility.js`
(reason codes like `term_too_short`), `lib/hub/settle.js` + `docs/HUB_VERIFY.md` §(g) "journal-not-live"
boundary marker (the journal is the live path for the Hub's own payout route — CUNA's own payouts still
run through the separate, older handler, not named here), `public/hub-verify.html` + `scripts/reproduce-receipt.cjs`
+ `packages/hub-verify` (three surfaces, one set of pure functions per `lib/hub/reproduce.js`),
`public/hub-wallet.html` + `GET /api/hub/wallet/:wallet` (one wallet, every project), `public/hub-compare.html`
(`/hub/:project/programs/compare`), `?print=1` on any receipt page, `GET /api/hub/:project/feed.json`
+ `/hub/:project/feed.xml`, `public/hub-glossary.html` + `lib/hub/glossary.js`, `lib/hub/readiness.js`
(`computeReadiness`, blocks arm on `coverage < 1`), and `docs/VALIDATION_2026-09.md` §(a)/§(c) for
POKEAHOE's dry-run status.

## (3) Traction as a mechanism, and the honesty rule — 1:54–2:18

| | |
|---|---|
| **On screen** | Founder to camera. Lower-third: **founder-operated · dry run · independent**. |
| **Script** | *"On traction we measure ourselves with a script, not a claim. Every real job sorts into one of three columns — founder-operated, dry run, or independent, meaning a project ran it themselves with nobody from us in the loop. Today, the independent column is empty. That's the honest state of the platform, and the gap our self-serve desk exists to close."* |

**Source check:** `docs/VALIDATION_2026-09.md` §(a) — as of 2026-09-18, every job run for CUNA,
POKE, DNC and ROSE is classified founder-operated or dry-run; the independent column reads "No —
not yet observed" for all four. `scripts/traction-report.cjs` is the script that measures the
counters this section refers to. **If this changes before recording** (an operator takes a desk
session of their own, per `lib/hub/operator.js`), re-check §(a) and rewrite this beat — don't
recite "empty" once it no longer is.

## (4) The team — 2:18–2:42

| | |
|---|---|
| **On screen** | Founder to camera, no lower-third — this beat is the founder alone. |
| **Script** | *"I'm the sole founder of CLKN Productions. I own the product decisions and every release. I use AI coding agents to build, and a separate AI reviewer to challenge every change. Money paths get targeted tests, and I approve every release myself after staging review. The pitch is that I've been accountable for every release this project has ever made."* |

**Source check:** `docs/COLOSSEUM_ROADMAP.md` §6, the adopted framing, put in first person; no
agent count or commit count offered as a substitute for ownership, per that section's own warning.

## (5) The ask — 2:42–2:54

| | |
|---|---|
| **On screen** | Founder to camera. Hold on **clucknorris.app** for the close. |
| **Script** | *"This hackathon gives us exposure to the projects the Hub is built for, and judges willing to check our receipt themselves. Learn fast. Avoid rugs. Survive the schoolyard. clucknorris.app."* |

No prize is named or implied as a claim — the ask is exposure and scrutiny, not a payout.

---

## Full script, read-through only (no tables, for teleprompter use)

*"Cluck Norris is a free Solana crypto school wrapped around real tools. This window we built the
Project Hub — a rewards program a holder can check without trusting us.*

*Here's the insight. Every project says 'trust our rewards program.' We built the one case where a
stranger doesn't have to: a hashed program version, every wallet's eligibility with a reason code,
every payment as a receipt — and a script that re-derives the amount on the reader's own machine,
offline, no trust required. The school is the front door, teaching what a lock and a multiplier
even mean before anyone reads a receipt. That's Educate. The Hub is Build. The strongest Earn we
can offer is proof.*

*In this window we built the Hub's settlement library: program versions with a hash anyone can
recompute, an accrual ledger, and eligibility reason codes instead of yes or no. Every receipt paid
through the Hub's own route now settles through one append-only journal, the live payout path, not
a plan. Paste a receipt into our verify page and your browser re-derives the amount offline, no
server call; the same check also runs as a script and a standalone command. Check one wallet
against every project we run, on one page, no wallet connect. See what changed between two program
versions from the same public data, print a receipt to keep on paper, or follow a project with a
feed reader instead of a login. Every reason code is defined once, in plain words, in our glossary.
Launch Readiness blocks a program from arming until its funding wallet actually covers what's owed.
And POKEAHOE is the Hub's second project, branded, honestly labelled dry run while we finish
agreeing terms.*

*On traction we measure ourselves with a script, not a claim. Every real job sorts into one of
three columns — founder-operated, dry run, or independent, meaning a project ran it themselves
with nobody from us in the loop. Today, the independent column is empty. That's the honest state
of the platform, and the gap our self-serve desk exists to close.*

*I'm the sole founder of CLKN Productions. I own the product decisions and every release. I use AI
coding agents to build, and a separate AI reviewer to challenge every change. Money paths get
targeted tests, and I approve every release myself after staging review. The pitch is that I've
been accountable for every release this project has ever made.*

*This hackathon gives us exposure to the projects the Hub is built for, and judges willing to
check our receipt themselves. Learn fast. Avoid rugs. Survive the schoolyard. clucknorris.app."*

---

## Related

- Demo video's shot-by-shot storyboard: `docs/DEMO_STORYBOARD.md` (Part 1). Its own narration
  track is `docs/DEMO_NARRATION.md`.
- Traction honesty source: `docs/VALIDATION_2026-09.md`.
- The team framing this section paraphrases: `docs/COLOSSEUM_ROADMAP.md` §6.
- The disclosure the batch count and snapshot line rest on: `docs/PRE_EVENT_STATE.md`'s "Built
  inside the window" and its 2026-09-14 09:00 UTC snapshot commits.
- The reviewer's click-through path behind section (2)'s verify/wallet/compare/print/feed/glossary
  beat: `docs/HUB_VERIFY.md`'s "reviewer's path" paragraph.
