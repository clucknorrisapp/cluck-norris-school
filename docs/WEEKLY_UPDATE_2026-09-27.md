# Colosseum weekly update #2 — Sunday 2026-09-27 (W10) — SKELETON

Covers **Sep 20 → Sep 27**. This is a skeleton, drafted 2026-09-18 before the week it describes
has happened — every bullet below is a placeholder to be filled from that week's actual merged
PRs, the same way `docs/WEEKLY_UPDATE_2026-09-20.md` was filled for update #1. **Do not invent a
shipped item, a blocker, or a next-step to make this look finished before the week is over** —
`CLAUDE.md` "Tell the truth about what you did" applies to this doc as much as to anything else.

Format matches update #1 exactly: three bullets (~55 seconds spoken total), a paste-ready
"Shipped this week" list with links, a "Where to post" line, and a same-day-before-recording
refresh checklist. Rules for the recording are unchanged from update #1: phone, one take, no
slides; "Earn" is capability, never a promise; nothing about Normie Quest prize terms; nothing
about Wallet Watch; no APR/APY figures anywhere.

## The three bullets (≈55 seconds spoken) — [FILL FROM THE WEEK'S ACTUAL PRs]

1. **What shipped.** `[to be filled — one or two sentences naming the week's real, merged
   features with a concrete noun a listener can picture, the way update #1 named "/hub/apply,"
   "operator wallet signs into," and "the two lessons... in all seven languages." Pull the list
   from the "Shipped this week" section below once it is filled, not the other way around.]`
2. **What was hard.** `[to be filled — the real blocker or reviewer finding that cost time this
   week, the way update #1 named "a rounded total that refused a real payout" and "nine P0s." If
   nothing money-adjacent was hard this week, say the actual hard thing instead of manufacturing
   one — a stale i18n key, a flaky test, an owner decision that took longer to land than expected.
   Never leave this bullet generic ("we worked hard") — it exists to be specific.]`
3. **What's next.** `[to be filled — the next concrete milestone, the way update #1 named "the
   dry-run second project and the first real receipts a holder can reproduce." Check
   `docs/COLOSSEUM_ROADMAP.md` §2/§7/§8/§9 for the next unstarted item in sequence, and
   `docs/VALIDATION_2026-09.md` §(a) for whether the independent column is still empty — if an
   operator interview or the POKEAHOE terms conversation happened this week, that belongs here.]`

## Shipped this week (paste-ready, with links) — [FILL FROM `git log`]

**How to fill this section:** run `git log --oneline --merges origin/main..origin/develop` (or,
once promotions have happened, diff against whatever `main` was at last Sunday) filtered to the
week's date range, and cross-reference against `docs/PRE_EVENT_STATE.md`'s "Built inside the
window" — every PR merged since update #1's cutoff (`#339` and later, batch 2 onward, per that
doc) that is **new since 2026-09-20** belongs here with its PR number, in the same grouped format
update #1 used:

- Project Hub — the entry: `[to be filled]`
- Money-path hardening: `[to be filled]`
- School: `[to be filled]`
- Security: `[to be filled]`
- Front door / evidence / traction: `[to be filled]`

`[to be filled: confirm nothing listed here was already cited in update #1 — a PR merged before
Sep 20 13:00 UTC belongs to LAST week's update, not this one, even if it's freshly noticed]`.

## Where to post

Same as update #1: Colosseum Arena (the project's update thread) and X from the CLKN account (X
Premium, no 280 limit). The pre-window disclosure line, if asked: "everything before Sep 14 13:00
UTC is listed in docs/PRE_EVENT_STATE.md in the repo."

## Refresh on Sep 26 checklist (before recording)

Confirm these before finalizing the script and picking the demo URL to show on camera, the same
way update #1's "Refresh on Sep 19" checklist worked. Don't assume from this file — re-check on
the day.

- [ ] `git log origin/develop` — list every PR merged between the two Sundays (Sep 20 13:00 UTC →
      Sep 27) and confirm none of them were already cited in update #1.
- [ ] `git log origin/main` — confirm which of the week's work is actually **promoted** (owner's
      explicit go, per `CLAUDE.md` "Branching"; never assumed). State plainly in the recording
      whether the demo URL shown is production or staging.
- [ ] Re-read `docs/VALIDATION_2026-09.md` §(a) — has the independent column changed from "empty"?
      If an operator ran their own program through the desk this week, or POKEAHOE's terms were
      agreed, that is this update's headline, not a footnote.
- [ ] Re-read `docs/PRE_EVENT_STATE.md`'s "Built inside the window" for the week's entries and
      confirm none of them read as a claim on pre-window work.
- [ ] Pick the demo URL to show on camera based on what's actually promoted at recording time —
      never show a `develop`/staging URL as if it were the live product (same rule as update #1).
- [ ] Re-read `docs/ARENA_POSTS.md`'s status table immediately before posting anything from it —
      confirm it has been kept in step with the week's actual merges.
- [ ] If `docs/PITCH_SCRIPT.md` or `docs/DEMO_NARRATION.md` cite anything that changed this week
      (the traction three-column table, a specific shipped feature), re-check those scripts too —
      they are dated to 2026-09-18 and can drift the same way this file can.

## Related

- Update #1 (the format this file follows): `docs/WEEKLY_UPDATE_2026-09-20.md`.
- The disclosure this update's "shipped" list draws from: `docs/PRE_EVENT_STATE.md`.
- The honesty rule behind the traction bullet: `docs/VALIDATION_2026-09.md`.
- Roadmap cadence (four updates: Sep 20, Sep 27, Oct 4, Oct 11): `docs/COLOSSEUM_ROADMAP.md` §W10.
