# Operating model — who does what, and when

> **Decision of record, 2026-09-21 (owner):** Colosseum is off — no time or ability to meet its
> commitments. The only tracks are the Seeker app for the Solana Mobile CLOCK IN hackathon
> (`docs/SEEKER_APP_PLAN.md`, submissions close 2026-10-09 06:59 UTC), the live product, and the
> partner projects. The hourly build loop was retargeted the same day; its prompt carries the rule.

Owner, 2026-09-19: *"Fable has so much usage per week… I just feel like we can orchestrate better
especially overnight and utilize all our assets and codex more efficiently."*

The constraint this is designed around: **the frontier model is metered weekly, not per task.** So
the question is never "can we afford it here" — it is **where in a week does its judgment change an
outcome.** Two places: deciding *what* to build, and deciding *what to accept*. In between,
supervision is mostly watching.

---

## The seats

| Seat | Who | What it is for |
|---|---|---|
| **Reserve** | Fable | The hardest calls only: architecture, money-path adversarial review, submission and product strategy. Not orchestration. |
| **Orchestrator** | Opus | Scoping increments, writing specs, verifying claims that cost money or credibility if wrong, deciding what merges. |
| **Builders** | Sonnet | The workhorse: implement a described change, write a page or a test, apply a fix, most find-and-fix passes. |
| **Mechanical** | Haiku (`effort: 'low'`) | Verifiable work with a right answer: greps, inventories, "is this referenced anywhere", running a test and reporting output. |
| **Second reviewer** | Codex | Reviews everything. **Builds nothing.** |

⚠️ **Codex reviews, never builds.** Its whole value is being a different model family with different
blind spots. The moment it produces the work it cannot review it, and we lose the only genuinely
independent opinion we have. `docs/CODEX_REVIEWER_BRIEF.md` is its standing brief: findings, not
rewrites.

**Pass `model:` explicitly on every `Agent` call and every `agent()` in a Workflow script.** The
default is to inherit the session model, and that default is the single biggest source of waste in
this repo.

---

## The night shape

1. **Evening — orchestrator, bounded.** Pick the night's 2–4 increments. Write each as a spec with
   explicit done-criteria *and the tests that prove them*. This is the highest-leverage spend in the
   cycle: most waste is a cheap model doing the wrong thing **well**, and a precise spec is what
   prevents it.
2. **Night — Sonnet builders, one or two at a time.** Each increment gets its own git worktree,
   commits early and often, and ends as a PR with CI green. **No frontier model in the loop.**
3. **Codex reviews the PRs as they open.** A separate budget, doing the verification work that
   would otherwise cost frontier tokens.
4. **Morning — orchestrator, bounded.** Read Codex's findings and CI rather than re-deriving them.
   Verify the claims that cost money if wrong. Merge or send back. Set the next night.

## The three rules that protect the budget

1. ⛔ **The overnight loop never escalates on its own.** A stuck builder **stops and writes the
   question to a file** in `docs/` or its PR. It does not wake the frontier model at 3am to unblock
   itself. This rule is worth more than any tiering table.
2. ⛔ **Overnight work must be test-verifiable.** Endpoints, tests, i18n, migrations, docs drift,
   inventories — things a machine can check. **Never overnight:** visual design, brand copy,
   anything whose verifier is a human eye. There isn't one at 3am, and the visual gate exists
   because a render broke and shipped.
3. ⛔ **Every increment ends as a mergeable unit.** The morning should find PRs with green CI, not
   half-finished work to reconstruct.

## Budget guardrails (from `docs/NQ_DEEP_DIVE_POSTMORTEM_2026-09-06.md`)

The 18-hour run that made the owner say *"this is unacceptable"* was not a model-tier problem — it
was 592 agents through a box that runs **2–3 at a time**, three verifiers on every P2/P3 polish
item, and no output until the last vote. So:

- A workflow **computes its agent count and prints the ETA** (`agents × 2.5 min ÷ 2.5 concurrent`)
  **before running anything**. Over **60 agents or 90 minutes** → stop and ask the owner, with the
  number.
- **P0/P1 get ONE verifier**; money / PII / engine paths get two more lenses; **P2/P3 never get a
  verifier.**
- A finder returns **at most 10 ranked findings**.
- Findings are **written to `docs/` and shown the moment the find phase ends** — verification
  refines the list, it never gates it.
- Report at every phase boundary with the ETA; cut the plan when the ETA passes the budget.
- **Never resume a workflow twice** — one resume, or finish, or kill and synthesize from the journal
  on disk.
- Plan for **2–3 concurrent agents on this box**, not N.

## Scheduled routines

Same rule: a poller that usually does nothing does not need a frontier model. Fresh-session routines
(`create_new_session_on_fire`) take a `model` — **set it.** Self-bound routines inherit the calling
session's model and cannot be tiered, so for those cut **frequency** instead, and prefer a
fresh-session routine when the job needs no conversation context.
