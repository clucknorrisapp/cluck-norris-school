# Demo video narration — the spoken track (Y3, `docs/COLOSSEUM_ROADMAP.md` §9; re-timed FF3,
`docs/COLOSSEUM_ROADMAP.md` §16)

**Re-timed 2026-09-18 against the final surface set** — the ten-stop click order the roadmap's FF3
item names: project page → receipt → "how this number was computed" → `/hub/verify` (reproduce in
the browser) → compare → wallet roll-up → feeds → glossary → status/badge → trust page. This
supersedes the previous ten-shot script (program version → two holders → funding → batch →
receipt → reproduce → isolation → school aside → close, kept in git history, not below), which
predates batches 9–14's verify, wallet, compare, feed and glossary pages and never showed them.
Every claim was checked against
the merged tree at commit `818557b` (`claude/colosseum-batch-15`, batches 9–15). Two beats from the
old cut — the second-project isolation proof and the school/tools aside — are not in the new
ten-stop order the roadmap specifies; their captures (`hub-demo-b.*`, `hub-poke.*`,
`for-projects.*`, `school-report-card.*`, `hub-index.*`) stay in the storyboard's inventory for a
different cut, unused here.

**377 words, 2:31 spoken at 150 wpm — under the 3:00 budget with ~29 seconds of headroom** for the
nine page-loads and one file-drop this order actually needs between stops (unlike the old cut,
which stayed on one page for most of its first 95 seconds, this one visits nine distinct URLs).
Use this page as the teleprompter/read-through script; `DEMO_STORYBOARD.md`'s Capture inventory
names every file's viewport and fixture. This narration draws only on captures already in
`docs/demo/2026-09-18/` — no new capture was added or removed, so
`scripts/demo-storyboard-inventory-test.cjs` stays green against the unchanged folder.

Every screen behind this narration carries a visible **DRY RUN** badge wherever it applies (the
demo fixture and POKEAHOE), and the receipt/verify beats **say "dry run" or "fixture" out loud**
rather than relying on the badge alone. No yield/APR/APY figure, no "guaranteed," no "verified
project" or "safe," and no mention of Normie Quest prize terms or Wallet Watch — same rules as the
storyboard and the pitch script (`docs/PITCH_SCRIPT.md`).

| Time | Stop | Screen | Capture (`docs/demo/2026-09-18/`) | Narration (word-for-word) |
|---|---|---|---|---|
| 0:00–0:18 | Project page | `/hub/demo/p/lock-to-earn` — version, hash, eligibility. | `hub-demo-program.{mobile,desktop}.png` | *"This is Demo Community's Lock to Earn program, version one — this hash is a sha256 of the terms above it, and anyone can recompute it. Holder A qualifies under the program's own term rule; Holder C doesn't, reason code term-too-short, printed in the open."* |
| 0:18–0:31 | Receipt | `/hub/demo/r/rcpt-a` — the fixture receipt. | `hub-demo-receipt-a.{mobile,desktop}.png` | *"This dry-run receipt names the wallet, the amount, and the transaction — a labelled fixture, nothing sent. A real receipt looks the same, with a live signature where this one says dry run."* |
| 0:31–0:48 | "How this number was computed" | The real, expanded explain panel on a live-code (non-fixture) receipt. | `hub-real-explain-block.{mobile,desktop}.png` | *"Every real receipt carries a 'How this number was computed' panel — not sales copy, the actual hourly slices this payment drew on, computed by the same function the ledger itself uses. This one shows seventy-three hours, summed to the exact amount paid."* |
| 0:48–1:06 | `/hub/verify` (reproduce in the browser) | The demo batch's evidence bundle dropped on the "From saved files (offline)" tab. | `hub-verify-bundle.{mobile,desktop}.png` | *"Drop this batch's evidence bundle onto the verify page: the bundle's own hash still matches, so the file was never altered. These two receipts report Missing Inputs, honestly, because this fixture predates the newer ledger model — not a failure dressed up as a pass."* |
| 1:06–1:23 | Compare | `/hub/<project>/programs/compare` — two versions, two changed fields. | `hub-compare.{mobile,desktop}.png` | *"Two program versions, side by side — their hashes, their published dates, and exactly what changed between them in plain words. A holder paid under the old one can see what the new one changes before deciding whether to stay locked."* |
| 1:23–1:35 | Wallet roll-up | `/hub/wallet/<address>` — qualified and paid in one project, excluded in another. | `hub-wallet-two-projects.{mobile,desktop}.png` | *"One wallet, checked against every project on the platform at once — qualified and paid in one, excluded with a reason in another. Nothing here needed the wallet to connect."* |
| 1:35–1:49 | Feeds | `/api/hub/<project>/feed.json`, then `/hub/<project>/feed.xml`. | `hub-feed-json.{mobile,desktop}.png`, `hub-feed-rss.{mobile,desktop}.png` | *"A JSON feed and its RSS twin — every version published, batch settled, and snapshot recorded, so a project can be followed with an ordinary feed reader, no wallet, no visit to the site at all."* |
| 1:49–2:00 | Glossary | `/hub/glossary`. | `hub-glossary.{mobile,desktop}.png` | *"Every term and reason code the receipts, the compare page and the wallet view use, defined once, in plain words, and linked from wherever the code actually appears."* |
| 2:00–2:16 | Status / badge | `/hub/status` — every project, its reproducibility ratio, the commit, and the badge. | `hub-status-badge.{mobile,desktop}.png` (the fuller per-project list is the same page, `hub-status.{mobile,desktop}.png`) | *"Every project this platform runs today, its programs, its reproducibility ratio over time, and the exact commit the running server was built from — plus the badge, computed live, that any project can embed in its own README."* |
| 2:16–2:31 | Trust page | `/hub/trust` — what none of the above proves. | `hub-trust.{mobile,desktop}.png` | *"And here's what none of that proves — in plain words, so nobody reads more into a hash or a receipt than it's earned. Educate, build, earn: the strongest version of earn is the one we can prove."* |

**377 words / 150.8s ≈ 2:31.** See "Per-stop word counts" below for the breakdown; totals are computed, not eyeballed.

---

## Full read-through (no table, for teleprompter use)

*"This is Demo Community's Lock to Earn program, version one — this hash is a sha256 of the terms
above it, and anyone can recompute it. Holder A qualifies under the program's own term rule;
Holder C doesn't, reason code term-too-short, printed in the open.*

*This dry-run receipt names the wallet, the amount, and the transaction — a labelled fixture,
nothing sent. A real receipt looks the same, with a live signature where this one says dry run.*

*Every real receipt carries a 'How this number was computed' panel — not sales copy, the actual
hourly slices this payment drew on, computed by the same function the ledger itself uses. This one
shows seventy-three hours, summed to the exact amount paid.*

*Drop this batch's evidence bundle onto the verify page: the bundle's own hash still matches, so
the file was never altered. These two receipts report Missing Inputs, honestly, because this
fixture predates the newer ledger model — not a failure dressed up as a pass.*

*Two program versions, side by side — their hashes, their published dates, and exactly what
changed between them in plain words. A holder paid under the old one can see what the new one
changes before deciding whether to stay locked.*

*One wallet, checked against every project on the platform at once — qualified and paid in one,
excluded with a reason in another. Nothing here needed the wallet to connect.*

*A JSON feed and its RSS twin — every version published, batch settled, and snapshot recorded, so
a project can be followed with an ordinary feed reader, no wallet, no visit to the site at all.*

*Every term and reason code the receipts, the compare page and the wallet view use, defined once,
in plain words, and linked from wherever the code actually appears.*

*Every project this platform runs today, its programs, its reproducibility ratio over time, and
the exact commit the running server was built from — plus the badge, computed live, that any
project can embed in its own README.*

*And here's what none of that proves — in plain words, so nobody reads more into a hash or a
receipt than it's earned. Educate, build, earn: the strongest version of earn is the one we can
prove."*

## Per-stop word counts (150 wpm)

| Stop | Words | Seconds |
|---|---:|---:|
| Project page | 45 | 18.0 |
| Receipt | 33 | 13.2 |
| How this number was computed | 43 | 17.2 |
| Verify | 45 | 18.0 |
| Compare | 41 | 16.4 |
| Wallet roll-up | 30 | 12.0 |
| Feeds | 36 | 14.4 |
| Glossary | 28 | 11.2 |
| Status / badge | 38 | 15.2 |
| Trust page | 38 | 15.2 |
| **Total** | **377** | **150.8 (2:31)** |

## Honesty notes behind two of these stops

- **Verify (0:48–1:06).** The only `/hub/verify` capture in inventory (`hub-verify-bundle.*`) is
  from before batch 12's fix to what the evidence-bundle route embeds
  (`docs/DEMO_STORYBOARD.md`'s "incidental finding" note): the same still image also shows a
  "Program-version hash recompute: does not match" line, which **was a real, live finding, fixed on
  batch 12 (commit `d77729c`)** — do not read that line aloud or point to it; it is stale on this
  particular PNG, not a claim this narration makes. What this narration *does* say — the bundle
  hash matching and the two receipts reporting Missing Inputs — is accurate on the capture as shown
  and remains true today (`docs/HUB_VERIFY.md` §(g) "journal-not-live" boundary: the demo fixture's
  batch runs on a ledger model `lib/hub/reproduce.js` doesn't read from yet).
- **"How this number was computed" (0:31–0:48).** `hub-real-explain-block.*` is a real, non-fixture
  receipt from an internal, unlisted project seeded only to show this UI element
  (`docs/DEMO_STORYBOARD.md`'s "How the extra receipt was produced" note) — never present it as a
  live customer. `/hub/demo`'s own fixture receipt page does not implement this panel at all, which
  is why the receipt stop (0:18–0:31) and this stop use two different, real screens.

---

## Reference captures — the reviewer's path (BB2, not part of the ≤3:00 video)

`docs/DEMO_STORYBOARD.md` Part 3's Shots 11–17 aren't in the demo video — they're reference
captures of the pages `docs/HUB_VERIFY.md`'s "reviewer's path" paragraph now names in order, for
whoever walks that path without a screen recording to follow. Shots 13 (`/hub/trust`) and 16
(`/hub/verify`, bundle dropped) are now covered by the re-timed video itself (see the table and the
honesty notes above) and are not repeated here to avoid two narrations for the same screen. One
line per remaining shot, same style as the table above, for whoever narrates a screen-share of the
reviewer's path out loud:

| Shot | Screen | Line |
|---|---|---|
| 11 | `/hub/status` (full per-project list — the video's Status/badge stop crops to the badge card specifically) | *"Every project this platform runs today, its programs, its reproducibility ratio, and the exact commit the running server was built from."* |
| 12 | `/hub/judge` | *"One page mapping each judging criterion to the exact URL to open and the test that pins the claim — built straight from the same markdown file, so the two can't drift."* |
| 14 | `/hub/wallet` | *"One address, every project — starting from nothing entered."* |
| 15 | `/hub/wallet/<CLKN mint>` | *"And here's the honest empty state: no Hub program has ever seen this wallet. Not an error — a real answer."* |
| 17 | `/holders` Compare panel | *"And the same append-only history idea applied to a token's holder list: entered, exited, held — over the top 25 each snapshot recorded, never a claim about the full list."* |

## Reference captures — the second batch (FF2, not part of the ≤3:00 video)

`docs/DEMO_STORYBOARD.md` Part 4's Shots 18–24 aren't in the demo video either — the same
reviewer's-path idea, one line per shot, for whoever narrates a screen-share of this second batch.
Shots 18 (compare), 20 (glossary), 21–22 (feeds) and 23–24 (wallet roll-up, status badge) are now
covered by the re-timed video itself and are not repeated here for the same reason as above. Shot
19 (the print sheet) is the only one from this batch not in the ten-stop order:

| Shot | Screen | Line |
|---|---|---|
| 19 | The print sheet, `?print=1` on a receipt | *"The same receipt, laid out to keep on paper — the amount, the settlement signature as text and as a QR code, the program hash. Nothing here needs a screen to check later."* |

## Related

- Shot list, capture filenames, viewports, fixtures and the honesty notes behind each capture:
  `docs/DEMO_STORYBOARD.md` Parts 1, 3 and 4.
- The separate, never-screen-recorded presentation video, re-timed the same day: `docs/PITCH_SCRIPT.md`.
- The reviewer's click-through order this narration now follows: `docs/HUB_VERIFY.md`'s "reviewer's
  path" paragraph.
- A one-page "what to click, in order" for the recording session itself: `docs/DEMO_CLICK_SHEET.md`.
- The 73-hour figure is the fixture's own number (`lib/hub/demo-fixture.js`), computed by the real
  libraries, not typed in — re-check it against the fixture before recording in case a future
  change to `demo-fixture.js` moves it.
