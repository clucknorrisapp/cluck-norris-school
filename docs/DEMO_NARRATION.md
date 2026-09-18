# Demo video narration — the spoken track (Y3, `docs/COLOSSEUM_ROADMAP.md` §9)

The ≤3:00 product demo's voiceover, one line per shot, aligned to `docs/DEMO_STORYBOARD.md`
Part 1's timestamps and screens exactly (same ten shots, same order, same durations). Use this
page as the teleprompter/read-through script; use `DEMO_STORYBOARD.md` for the capture filenames,
the "judge should notice" cues and the honesty notes behind each shot. **347 words across 3:00** —
naturally slower than spoken-word pace (≈116 wpm average) because a demo video's narration has to
leave room for cursor movement, scrolling and a panel expanding on screen; nothing here needs to
be rushed to fit.

Every screen behind this narration carries a visible **DRY RUN** badge throughout (per the
storyboard's header note), and the two beats where the recording specifically turns to a
second/fixture project **say "dry run" or "fixture" out loud** (shots 1 and 8) rather than relying
on the badge alone. No yield/APR/APY figure, no "guaranteed," no "verified project" or "safe," and
no mention of Normie Quest prize terms or Wallet Watch — same rules as the storyboard and the
pitch script (`docs/PITCH_SCRIPT.md`).

| Time | Screen | Narration (word-for-word) |
|---|---|---|
| 0:00–0:15 | `/hub/demo/p/lock-to-earn` — the "PROGRAM VERSION 1" card. | *"This is a dry run — Demo Community's Lock to Earn program, version one. This hash is a sha256 of the terms above it, and anyone can recompute it from the JSON this page links to."* |
| 0:15–0:35 | Same page, "Lockers and eligibility" card, Holder A. | *"Holder A locked 50,000 DEMO for the 90-day minimum. Qualifies, one times the base rate — the program's own term rule decided that, not an operator's judgement call."* |
| 0:35–0:55 | Same card, Holder C. | *"Holder C locked real tokens, but only for 30 days against a 90-day minimum. Does not qualify — reason code term-too-short, printed in the open, not hidden in an operator's notes."* |
| 0:55–1:15 | Same page, "Funding" card. | *"Three numbers, never one green checkmark: obligated, reserved in batches, and the funding wallet's observed balance. Here it's short by 62,500 — an observed balance isn't reserved funding, it can be spent on anything else tomorrow."* |
| 1:15–1:35 | Same page, "Batch DEMO-BATCH-1" table. | *"A batch draws only on what's available — accrued, minus anything already reserved or paid — never an estimate. Holder A and Holder B are both paid here, each with a link to their own receipt."* |
| 1:35–2:00 | `/hub/demo/r/rcpt-a` (fixture receipt), then the real "How this number was computed" panel expanded on a live-code receipt. | *"Every real receipt on the Hub carries a 'how this number was computed' panel — the actual hourly slices this payment drew on, computed by the same function the ledger itself uses. This one shows seventy-three hours, each one's share, summed to the exact amount paid."* |
| 2:00–2:20 | Terminal running `scripts/reproduce-receipt.cjs --offline`. | *"Save the two small JSON files this page links to, run this script with no wallet, no key, no network — and it re-derives the exact same amount, independently, on your own machine. Match."* |
| 2:20–2:40 | `/hub/demo-b` (fixture isolation proof), then `/hub/poke` (real, unarmed second project). | *"This fixture project has its own store, its own ledger, its own holder — nothing shared with the first. And POKEAHOE is the Hub's real second project today, a labelled dry run while terms are still being agreed — no program, no funding wallet, nothing armed."* |
| 2:40–2:55 | `/for-projects` and the school's lesson report card. | *"Everything above sits on the same free school and tool set we've run since before this window — locking, holder analysis, buy competitions, wallet forensics. One guided front door links all of it."* |
| 2:55–3:00 | `/hub` (index), held on screen. | *"Educate, build, earn. The strongest version of earn is the one we can prove."* |

---

## Full read-through (no table, for teleprompter use)

*"This is a dry run — Demo Community's Lock to Earn program, version one. This hash is a sha256 of
the terms above it, and anyone can recompute it from the JSON this page links to.*

*Holder A locked 50,000 DEMO for the 90-day minimum. Qualifies, one times the base rate — the
program's own term rule decided that, not an operator's judgement call.*

*Holder C locked real tokens, but only for 30 days against a 90-day minimum. Does not qualify —
reason code term-too-short, printed in the open, not hidden in an operator's notes.*

*Three numbers, never one green checkmark: obligated, reserved in batches, and the funding
wallet's observed balance. Here it's short by 62,500 — an observed balance isn't reserved funding,
it can be spent on anything else tomorrow.*

*A batch draws only on what's available — accrued, minus anything already reserved or paid —
never an estimate. Holder A and Holder B are both paid here, each with a link to their own
receipt.*

*Every real receipt on the Hub carries a 'how this number was computed' panel — the actual hourly
slices this payment drew on, computed by the same function the ledger itself uses. This one shows
seventy-three hours, each one's share, summed to the exact amount paid.*

*Save the two small JSON files this page links to, run this script with no wallet, no key, no
network — and it re-derives the exact same amount, independently, on your own machine. Match.*

*This fixture project has its own store, its own ledger, its own holder — nothing shared with the
first. And POKEAHOE is the Hub's real second project today, a labelled dry run while terms are
still being agreed — no program, no funding wallet, nothing armed.*

*Everything above sits on the same free school and tool set we've run since before this window —
locking, holder analysis, buy competitions, wallet forensics. One guided front door links all of
it.*

*Educate, build, earn. The strongest version of earn is the one we can prove."*

---

## Related

- Shot list, capture filenames, and the honesty notes behind each line: `docs/DEMO_STORYBOARD.md`
  Part 1.
- The separate, never-screen-recorded presentation video: `docs/PITCH_SCRIPT.md`.
- The 73-hour figure and the 62,500 shortfall are the fixture's own numbers (`lib/hub/demo-fixture.js`),
  computed by the real libraries, not typed in — re-check them against the fixture before recording
  in case a future change to `demo-fixture.js` moves them.
