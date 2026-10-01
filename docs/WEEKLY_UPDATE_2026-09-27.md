# Colosseum weekly update #2 — Sunday 2026-09-27 (W10) — DRAFT, filled to-date

Covers **Sep 20 → Sep 27**. **That window has not happened yet** — this draft is written
2026-09-18, before it starts. There is therefore nothing yet that truthfully belongs in a "shipped
this week" list for Sep 20 → Sep 27: everything on record so far (batches 2–12, PRs #339–#350,
including the newest batches 9–12 merged today) carries a commit date before Sep 20 13:00 UTC, so
by the same rule this doc's own checklist states ("a PR merged before Sep 20 13:00 UTC belongs to
LAST week's update, not this one"), all of it belongs to update #1
(`docs/WEEKLY_UPDATE_2026-09-27.md`'s sibling, `docs/WEEKLY_UPDATE_2026-09-20.md`), not here.
`CLAUDE.md` "Tell the truth about what you did" governs this file as much as any other — so rather
than invent a Sep 20–27 shipped item that does not exist, this draft is filled with the record
**through Sep 18** (the same window update #1 uses), clearly labelled as provisional, so the doc
is reconciled from a real run instead of sitting as hand-typed placeholders. **Re-run for the
real Sep 20 → 27 window on Sep 26** and replace every section below with that week's actual
result — do not record from this draft as-is.

Generated with:
```
node scripts/weekly-update-draft.cjs --from 2026-09-14 --to 2026-09-18 --develop-ref origin/develop --main-ref origin/main --no-fetch
```
Raw output committed beside this draft: `docs/weekly-update-raw-2026-09-18.md`. **On Sep 26,
re-run with `--from 2026-09-20 --to 2026-09-27`** (or the actual recording day) and rebuild every
section from that output, not this one.

Format matches update #1 exactly: three bullets (~55 seconds spoken total), a paste-ready
"Shipped this week" list with links, a "Where to post" line, and a same-day-before-recording
refresh checklist. Rules for the recording are unchanged from update #1: phone, one take, no
slides; "Earn" is capability, never a promise; nothing about Normie Quest prize terms; nothing
about Wallet Watch; no APR/APY figures anywhere.

## The three bullets (≈55 seconds spoken) — [OWNER TO EDIT — provisional, based on the record through Sep 18]

Drafted from the most recent work on record as of this draft (batches 9–12), since the real Sep
20–27 shipped list does not exist yet. **Replace all three on Sep 26** with that week's actual
merged work — do not read these on camera as-is.

1. **What shipped.** [owner to edit] Provisional, from the record through Sep 18: the newest
   layer on the reproduce story — a holder can now download a whole batch's evidence as one file
   and check it offline (the evidence bundle), diff two program versions to see exactly what
   changed, see a project's reproduce ratio as a trend line instead of a single number, and run
   the same reproduction as a one-line, no-clone command once it's published. `/hub/verify` now
   speaks all seven languages, and a real bug in its bundle check — a correct receipt printing a
   false mismatch — was found and fixed the same week it shipped. All of it is still on `develop`,
   not `main`.
2. **What was hard.** [owner to edit] Provisional: a genuinely correct evidence bundle could print
   a false "does not match" on its program-version check, because the bundle's embedded copy of
   the version was missing fields the hash needs — found by the same tool that was supposed to
   prove correctness, not by a reviewer catching it after the fact. Also: our own curriculum
   generator had been silently dropping two whole courses since an earlier refactor and kept
   reporting success the entire time.
3. **What's next.** [owner to edit] Check `docs/COLOSSEUM_ROADMAP.md` §14 for the next unstarted
   item in sequence and `docs/VALIDATION_2026-09.md` §(a) for whether the independent column is
   still empty — if an operator interview or the POKEAHOE terms conversation happens before
   recording, that is this update's headline, not a footnote. As of this draft, the standing next
   step is unchanged from update #1: getting the reproducibility work off staging (the owner's
   explicit promote, never automatic), the first real on-chain commitment, and POKEAHOE as the
   second project.

## Shipped this week (paste-ready, with links) — [OWNER TO EDIT on Sep 26 with the real window]

**As of 2026-09-18, the real "Sep 20 → Sep 27" shipped list is empty because that week has not
started.** What follows is the record **through Sep 18** (same window as update #1, same script
run), included only so this doc is built from a real run rather than left blank — **it duplicates
update #1's own list and none of it should be re-announced as new in update #2's actual post.**
Cross-reference `docs/PRE_EVENT_STATE.md`'s "Built inside the window" and confirm on Sep 26 that
whatever is listed there for Sep 20–27 is genuinely dated after Sep 20 13:00 UTC before using it.

- **Hub (production on `main`):** #299 roadmap revision 3 + Educate/Build/Earn; #307 Hub W1 core;
  #308 Addendum C; #311 buy-comp server payout; #313 payout hardening; #315 the public Hub +
  server-signed lock-to-earn send; #319 one program per page, honest "owed".
- **Hub (staging only, `develop`):** #321–#325 the Lock to Earn engine generalised + platform
  access + self-serve onboarding + the operator desk; #331 whole-repo simplification; #340/#341
  Colosseum batches 3–4 (seven-language lessons, engine evidence classes, reproduce-a-receipt,
  `/hub/demo`, Hub schemas, the school→Hub bridge, the on-chain hash commitment dry run); #345
  batch 7 (school/homepage doors to the Hub); #347 batch 9 (`/hub/verify`, the receipt lesson,
  share cards, the weekly-update generator, `/hub/status` + `/api/build`, route hygiene); #349
  batch 11 (`/receipt` in Telegram, the receipt lesson measured, the holders a11y gate); #350
  batch 12 (`/hub/verify` in seven languages, program-version compare, reproducibility history,
  the evidence-bundle hash fix, the standalone `npx` verifier package, not yet published to npm).
- **School:** #309 report card links to a real tool (production); #328 Q&A + LP Lab audit,
  re-keyed in seven languages (staging); #336 the last GET-only admin mutation made POST-only
  (staging); #348 batch 10 (`/hub/wallet`, the evidence bundle, snapshot diff, the judge guide,
  `/hub/trust`, the classroom curriculum generator fix, the computed reproducibility badge) —
  staging.
- **Security:** #329/#330 the platform deep-dive P0/P1 batches + Codex round 1 (staging); #333/
  #334 the owner-decisions batch + Codex round 2 (staging); #338 the OnlyRose room lockdown
  (staging); #346 batch 8 — a11y pass, Launch Readiness, airdrop receipts, Buy Special standings,
  the engine timeline, holder snapshots (staging).
- **Operations:** #298 a lock is not a sell (production); #302/#303 the Official Rules correction
  and the submission copy as entered (production); #306 the CUNA lock-scan reliability fix
  (production); #310 the engaged-visitor analytics fix (production); #317 the vault BigInt
  serialisation fix (production); #339/#343/#344 Colosseum batches 2/5/6 (staging).

**Promotions in this to-date window (develop → main):** #300, #301, #304, #312, #314, #316, #318,
#320, #327, #332, #335, #337 — the release mechanism for every "production" line above, not
separate features. `main` is currently at PR #337; nothing from batch 2 onward (#339 and later)
has been promoted.

## Where to post

Same as update #1: Colosseum Arena (the project's update thread) and X from the CLKN account (X
Premium, no 280 limit). The pre-window disclosure line, if asked: "everything before Sep 14 13:00
UTC is listed in docs/PRE_EVENT_STATE.md in the repo."

## Refresh on Sep 26 checklist (before recording)

Confirm these before finalizing the script and picking the demo URL to show on camera, the same
way update #1's "Refresh on Sep 19" checklist worked. Don't assume from this file — re-check on
the day.

- [ ] Re-run `node scripts/weekly-update-draft.cjs --from 2026-09-20 --to 2026-09-27` (adjust `--to`
      to the actual recording day) and rebuild every section above from that output, not this
      draft's to-date placeholder — list every PR merged between the two Sundays (Sep 20 13:00 UTC
      → Sep 27) and confirm none of them were already cited in update #1.
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
- The script's raw output this to-date draft is built from: `docs/weekly-update-raw-2026-09-18.md`.
- The disclosure this update's "shipped" list draws from: `docs/PRE_EVENT_STATE.md`.
- The honesty rule behind the traction bullet: `docs/VALIDATION_2026-09.md`.
- Roadmap cadence (four updates: Sep 20, Sep 27, Oct 4, Oct 11): `docs/COLOSSEUM_ROADMAP.md` §W10.
