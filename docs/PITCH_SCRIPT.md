# Pitch script — the 2–3 minute presentation video (Y3, `docs/COLOSSEUM_ROADMAP.md` §9)

Word-for-word, timed to the second. This is the **founder-on-camera** video
(`docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md`'s submission form: a separate 2–3 minute presentation
video, distinct from the ≤3 minute product demo) — per `docs/DEMO_STORYBOARD.md` Part 2, **never
a screen recording**. The founder talks; any on-screen element is a lower-third caption or a still
graphic, not a captured browser session (that's the demo video's job).

**Read this against the actual page before every recording**, not just on the day this was
written (2026-09-18) — a line that was true on `develop` today can drift if the underlying route
changes. Every claim below was checked against `develop` at that commit: the Hub settlement
library (`lib/hub/`), `scripts/reproduce-receipt.cjs`, `lib/hub/readiness.js` (Launch Readiness),
the POKEAHOE dry-run project (E10), and `docs/VALIDATION_2026-09.md`'s three-column table. None of
it depends on `develop` having been promoted to `main` — a line that *would* depend on that is
marked **[if promoted]**; there are none in this cut because the script never tells a viewer to go
open a specific URL (the demo video does that).

**Pacing:** ~150 words/minute, spoken-word register, short sentences. **415 words, 2:46 total** —
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

## (2) What shipped in-window — 0:47–1:46

| | |
|---|---|
| **On screen** | Founder to camera. Lower-third call-outs, one per beat: **program version + hash** → **reason codes** → **receipt: "how this number was computed"** → **reproduce-receipt.cjs** → **`/hub/demo` — DRY RUN** → **README + JSON Schemas** → **Launch Readiness** → **POKEAHOE — DRY RUN**. |
| **Script** | *"In four weeks we built the Hub's settlement library: program versions with a hash anyone can recompute, an accrual ledger, and eligibility reason codes instead of yes or no. Every receipt carries a 'how this number was computed' panel, walked through with the holder's own numbers, never authored copy. Our reproduce-receipt script re-derives that amount from the published inputs, on your machine, no server call — and every payout page states how many receipts reproduce and how many are missing inputs, measured, never asserted. The demo walkthrough runs the whole loop with no wallet, labelled dry run throughout. It ships as a public contract too — a README and JSON Schemas anyone can validate against. Launch Readiness checks the funding wallet actually covers what's owed before a program can arm. And POKEAHOE is the Hub's second project, branded, honestly labelled dry run while we finish agreeing terms."* |

**Source check for this section:** `lib/hub/project.js` (`canonicalJson`/`sha256`), `lib/hub/eligibility.js`
+ `lib/hub/demo-fixture.js` (reason codes like `term_too_short`), `public/hub.html`'s
`How this number was computed` `<details>` block (`lib/hub/explain.js`), `scripts/reproduce-receipt.cjs`
+ `/api/hub/:project/reproducibility` (the "N of M reproduce; K missing inputs" line, `public/hub.html`
`reproLine()`), `/hub/demo` (`lib/hub/demo-fixture.js`, DRY RUN badge on every screen), `lib/hub/README.md`
+ `lib/hub/schema/*.json`, `lib/hub/readiness.js` (`computeReadiness`, blocks arm on `coverage < 1`), and
`docs/VALIDATION_2026-09.md` §(a)/§(c) for POKEAHOE's dry-run status.

## (3) Traction as a mechanism, and the honesty rule — 1:46–2:10

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

## (4) The team — 2:10–2:34

| | |
|---|---|
| **On screen** | Founder to camera, no lower-third — this beat is the founder alone. |
| **Script** | *"I'm the sole founder of CLKN Productions. I own the product decisions and every release. I use AI coding agents to build, and a separate AI reviewer to challenge every change. Money paths get targeted tests, and I approve every release myself after staging review. The pitch is that I've been accountable for every release this project has ever made."* |

**Source check:** `docs/COLOSSEUM_ROADMAP.md` §6, the adopted framing, put in first person; no
agent count or commit count offered as a substitute for ownership, per that section's own warning.

## (5) The ask — 2:34–2:46

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

*In four weeks we built the Hub's settlement library: program versions with a hash anyone can
recompute, an accrual ledger, and eligibility reason codes instead of yes or no. Every receipt
carries a 'how this number was computed' panel, walked through with the holder's own numbers,
never authored copy. Our reproduce-receipt script re-derives that amount from the published
inputs, on your machine, no server call — and every payout page states how many receipts
reproduce and how many are missing inputs, measured, never asserted. The demo walkthrough runs
the whole loop with no wallet, labelled dry run throughout. It ships as a public contract too — a
README and JSON Schemas anyone can validate against. Launch Readiness checks the funding wallet
actually covers what's owed before a program can arm. And POKEAHOE is the Hub's second project,
branded, honestly labelled dry run while we finish agreeing terms.*

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
- The disclosure this section's "in four weeks" line rests on: `docs/PRE_EVENT_STATE.md`'s "Built
  inside the window."
