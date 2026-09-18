# Validation — 2026-09 (W6b)

The deliverable `docs/COLOSSEUM_ROADMAP.md` §W6b names: *"Which independent project operator
will pay you, for which repeated job, and what becomes easier enough that they return?"* Four
partner-token names and visitor-days do not answer that question — this document tries to,
honestly, whether the answer turns out strong or weak. **Owner-led**: the interviews themselves
need the owner's existing relationships (`docs/COLOSSEUM_ROADMAP.md` §W6b, §4 item 3 — "operator
drafts default owner-only in the first cohort"); this skeleton is what an agent session can
prepare in advance so the owner only has to show up and talk.

**Status of this document: skeleton.** Every number and every quote below is marked
`[to be filled]`. Nothing here is invented — see `CLAUDE.md` "Tell the truth about what you did"
and the "Verification: check every form" section. A blank cell is filled only from a real
interview, a real script run, or a real timestamp in the store; it is never estimated or
back-filled from memory.

**How to fill this document:**
1. Run `node scripts/traction-report.cjs` (from wherever `DATA_DIR` points at the real Railway
   volume) — the "Operator onboarding clock" section prints `apply→approve`, `approve→v1`,
   `v1→armed`, `armed→batch` per project. Paste those durations into §(b) "observed setup time."
   A fresh clone or a box with no volume prints all zeros/`—`, honestly — that is not a number to
   quote.
2. Read `docs/OPERATOR_INTERVIEW_SCRIPT.md` to each operator (POKE, CUNA, DNC, ROSE) and record
   the answers verbatim in §(b), with consent noted per the script's consent line.
3. Fill §(c) from the POKEAHOE Hub dry run's actual dates as they happen (E10,
   `docs/COLOSSEUM_ROADMAP.md` §7).
4. Write §(d) last, after (a)-(c) are as filled as they're going to get before the submission
   deadline (Oct 1) — the headline must describe what the table actually shows, not what the
   plan hoped it would show.

---

## (a) The three-column rule

Every claim of "adoption" on this Hub gets sorted into exactly one of three columns before it is
allowed near the submission. **Founder-operated** means CLKN Productions (the owner, an agent
under his direction, or the founder's own script) performed the setup, arming, or payout action
on the project's behalf — the project supplied the token/wallet, we ran the mechanism. **Dry
run** means the project or a fixture is wired up but `dryRun: true` — nothing accrues, nothing
pays, and it is labelled as such on every screen it appears (`lib/hub/project.js`, E2/E10 in
`docs/COLOSSEUM_ROADMAP.md` §7). **Independent** means a project operator, using their own
signed-nonce session on the Hub operator desk (`lib/hub/operator.js`, `/hub/:project/desk`), took
the setup or payout action themselves, without the founder driving it.

As of 2026-09-18 (the day this skeleton was written), the honest read of the code and the
runbooks is:

| Project | Job(s) run for them | Founder-operated | Dry run | Independent |
|---|---|---|---|---|
| CUNA | Lock-to-earn payouts (`docs/CUNA_STAKING_RUNBOOK.md` — armed on production since 2026-09-05, accruing hourly, paid weekly from `/cuna-payout`); JVP liquidity-engine service (`docs/CLKN_JUP_VERIFICATION_PROTOCOL.md` — score 0→verified) | **Yes** — the dedicated `/cuna-payout` handler is founder-run; `lib/traction.js` confirms every live Hub payout, including CUNA's, still goes through the founder-operated `lib/cuna-payout.js` batch mechanism, not a project-run desk session | No | **No** — not yet observed |
| POKE (POKEAHOE) | JVP liquidity-engine service, treasury-key carve-out (`docs/CLKN_JUP_VERIFICATION_PROTOCOL.md` Phase 0 item 3); designated 2026-09-18 as the Hub's second project (`docs/COLOSSEUM_ROADMAP.md` §4 item 1, item **E10**) | **Yes**, for the JVP work to date (engine is currently paused fleet-wide, `CLAUDE.md` "Money") | **Yes** — E10: seeded as `dryRun: true` at `/hub/poke`, "terms to be agreed with the POKEAHOE team", excluded from every count | No |
| DNC | JVP liquidity-engine service (`docs/DNC_ENGINE_ONBOARDING.md`, `docs/CLKN_JUP_VERIFICATION_PROTOCOL.md`) | **Yes** | No | **No** |
| ROSE | JVP liquidity-engine service (0→34+ organic score in a day, 2026-08-31); buy-bot alerts and giveaways (`docs/CLKN_JUP_VERIFICATION_PROTOCOL.md`). Buy-bot **disarmed** since 2026-09-17 (owner: "we only use the rose buy bot when needed") | **Yes** | No | **No** |
| `/hub/demo` fixture | The single-holder walkthrough (E2) | n/a — it is a fixture, not a project | **Yes** — always, by design; never flips to any other column | n/a |

**Reading this table honestly:** as of today, every real job this platform has done for a
partner project was founder-operated. The Independent column is empty for all four named
projects. That is the finding W6b exists to surface, not a gap to paper over before the
submission — see §(d).

`[to be filled]` — re-run this classification the week of Oct 1 in case POKE's terms are agreed
and a funding wallet exists by then (§(c)), or in case any operator has taken a desk session of
their own by then (`lib/hub/operator.js` issues a session per signed nonce; a durable per-project
"has an operator ever signed their own desk session" flag would be the cleanest way to check this
without re-reading logs by hand — `[to be filled: does one exist, or was this checked by hand on
what date]`).

---

## (b) Per-operator interview record

One row's worth of columns is a full interview. Fill one block per project. Quotes are verbatim
transcriptions with the operator's consent noted (see the interview script's consent line) —
never paraphrased into something more flattering, never combined across two answers.

### POKE (POKEAHOE)

| Field | Value |
|---|---|
| Who (name/handle, role) | `[to be filled]` |
| Date of interview | `[to be filled]` |
| The job they repeat (their words) | `[to be filled]` |
| Observed setup time | `[to be filled — from `node scripts/traction-report.cjs`, "apply→approve" / "approve→v1" / "v1→armed" / "armed→batch" columns for `poke`, once E10 seeds the project record; n/a until then]` |
| Reconciliation time (their estimate, per period) | `[to be filled]` |
| Support cost (messages/calls needed to keep it running, their estimate or ours) | `[to be filled]` |
| Repeat use (would they run another period without being asked) | `[to be filled]` |
| Stated willingness to pay, and at what price | `[to be filled]` |
| Quote(s), verbatim, consent noted | `[to be filled — "quoted with permission, <date>" or "declined to be quoted"]` |

### CUNA

| Field | Value |
|---|---|
| Who (name/handle, role) | `[to be filled]` |
| Date of interview | `[to be filled]` |
| The job they repeat (their words) | `[to be filled]` |
| Observed setup time | `[to be filled — CUNA's Hub-adjacent onboarding predates the onboarding clock (E7); the report script labels pre-window projects `n/a` rather than a fabricated duration]` |
| Reconciliation time (their estimate, per period) | `[to be filled]` |
| Support cost | `[to be filled]` |
| Repeat use | `[to be filled — CUNA lock-to-earn has paid weekly since 2026-09-09; ask whether the OPERATOR still finds this worth running, not whether the mechanism ran]` |
| Stated willingness to pay, and at what price | `[to be filled]` |
| Quote(s), verbatim, consent noted | `[to be filled]` |

### DNC

| Field | Value |
|---|---|
| Who (name/handle, role) | `[to be filled]` |
| Date of interview | `[to be filled]` |
| The job they repeat (their words) | `[to be filled]` |
| Observed setup time | `[to be filled]` |
| Reconciliation time (their estimate, per period) | `[to be filled]` |
| Support cost | `[to be filled]` |
| Repeat use | `[to be filled]` |
| Stated willingness to pay, and at what price | `[to be filled]` |
| Quote(s), verbatim, consent noted | `[to be filled]` |

### ROSE

| Field | Value |
|---|---|
| Who (name/handle, role) | `[to be filled]` |
| Date of interview | `[to be filled]` |
| The job they repeat (their words) | `[to be filled]` |
| Observed setup time | `[to be filled]` |
| Reconciliation time (their estimate, per period) | `[to be filled]` |
| Support cost | `[to be filled]` |
| Repeat use | `[to be filled — the buy bot is currently disarmed at the operator's own preference ("only when needed"); ask what would bring it back]` |
| Stated willingness to pay, and at what price | `[to be filled]` |
| Quote(s), verbatim, consent noted | `[to be filled]` |

---

## (c) The consented pilot: the Hub dry run (POKEAHOE)

Owner decision, 2026-09-18 (`docs/COLOSSEUM_ROADMAP.md` §4 item 1): *"pokeahoe will be our dry
run or next project to use the lock and earn, we will build them a page just with their logos
and make it special for them."* Ships as a **labelled dry run** (`dryRun: true`, excluded from
every count) until the POKE team agrees terms and a funding wallet exists — nothing accrues or
pays before that. Tracked as item **E10**.

Consent for this pilot itself (being shown a dry run, being asked for feedback, being possibly
quoted) is separate from and prior to consent for any individual quote in §(b) — note both.

| Milestone | Date | Evidence |
|---|---|---|
| POKE consents to the pilot walkthrough | `[to be filled]` | `[to be filled]` |
| `/hub/poke` project record seeded (`dryRun: true`, brand fields) | `[to be filled]` | `[to be filled — commit / PR link]` |
| First program version drafted for POKE | `[to be filled]` | `[to be filled]` |
| POKE team reviews the dry-run page | `[to be filled]` | `[to be filled]` |
| Terms agreed with POKE (converts dry run → live) | `[to be filled — not expected before submission; may remain a dry run through Oct 1]` | `[to be filled]` |
| Funding wallet funded | `[to be filled]` | `[to be filled]` |
| First live program version published | `[to be filled]` | `[to be filled]` |
| First batch signed by POKE's own operator session (this is the "independent" bar, not just "live") | `[to be filled]` | `[to be filled]` |

If terms are not agreed by submission (Oct 1), the honest state to report is: *"a consented dry
run exists at `/hub/poke`; POKE has not yet agreed to run it live."* That is a true, useful
answer and a stronger claim than an unlabelled or rushed live flip — see `CLAUDE.md`'s rule
against presenting a dry run as a live program.

---

## (d) What we learned

`[to be filled after (a)-(c) are as complete as the window allows]`

The headline must be the honest one, stated plainly, even if it is not the one the plan hoped
for. As of 2026-09-18, before any interview has been recorded, the honest draft headline reads:

> **Every job this platform has done for a partner project so far has been founder-operated. No
> project operator has independently run their own program through the Hub's operator desk. The
> one consented pilot (POKEAHOE) is a labelled dry run, not yet a live program with agreed
> terms.**

That sentence is the thing W6b was built to surface, and it belongs in the submission's traction
section exactly as measured — not softened, not implied away by adjacent counters. `[to be
filled: does the interview round change this headline — e.g. a stated willingness to pay, a
repeat-use answer, a specific job an operator names as worth paying for — and if so, what is the
new headline, sourced to which interview row above]`.
