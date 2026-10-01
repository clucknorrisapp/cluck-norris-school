# Demo storyboard — W7 (docs/COLOSSEUM_ROADMAP.md §W7)

Two separate deliverables, per `docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md`'s submission form: a
**demo video (≤3 minutes)** showing the product, and a **presentation/pitch video (≤2–3 minutes,
target 2:30)** that is never screen-recorded. Captures for the demo live in
`docs/demo/2026-09-18/` — real screenshots of the real, running app (`npm run build` then
`node server.js`), captured with Playwright at phone width (390×844) and desktop (1280×800). File
sizes: 42–295 KB each, all under the 300 KB target; the full set (Part 1's 25 files, Part 3's 14
reference captures (BB2), and Part 4's 14 further reference captures (FF2)) totals 53 files, under
6 MB.

**Every screen in this storyboard carries a visible DRY RUN badge, and every reference to the
demo project or to POKEAHOE says "dry run" — neither ships a program version a real fund could be
armed against.** Nothing here uses "verified" or "safe" to describe a token or a project — the
verify affordance is a button a viewer can press themselves ("VERIFY ON-CHAIN"), not a claim we
make on their behalf. No yield, APR or APY figure appears anywhere in the product, matching the
`RATE_LANGUAGE` guard in `lib/hub/teach.js` / `lib/hub/explain.js`.

---

## Part 1 — the demo video (≤3:00), shot by shot

**The spoken track for this section, extracted as a standalone teleprompter script (one line per
shot, same timestamps): `docs/DEMO_NARRATION.md`.**

The founder is on camera or voicing over a screen recording of these exact pages, live at
`clucknorris.app` (or staging, if not yet promoted — see `docs/WEEKLY_UPDATE_2026-09-20.md`'s
refresh checklist). The sequence follows the roadmap's acceptance target word for word: program
version and hash → a holder qualifies with the rule that decided it → another does not with its
reason code → funding coverage vs shortfall, labelled → the batch → the receipt and its
explanation → reproduce it on the reader's machine → the second project proves isolation → a
30-second aside on the school/tools → close on Educate → Build → Earn.

### 0:00–0:15 — The program version, and its hash
**Screen:** `/hub/demo/p/lock-to-earn` — the "PROGRAM VERSION 1" card.
**Capture:** `hub-demo-program.desktop.png` (top third), `hub-demo-program.mobile.png`.
**Says:** *"This is Demo Community's Lock to Earn program — version 1, effective the day it went
live, and this hash is a sha256 of the terms above it. Anyone can recompute that hash from the
JSON this page links to."*
**Judge should notice:** the hash sits next to the terms it was computed from — nothing is
asserted, it's checkable on the spot. The `DRY RUN` pill is visible in the header the whole time.

### 0:15–0:35 — A holder qualifies, with the rule that decided it
**Screen:** same page, the "Lockers and eligibility" card, Holder A.
**Capture:** `hub-demo-program.desktop.png` (Holder A block) / `hub-demo-1-top.*.png` (step B on
the walkthrough, same fact).
**Says:** *"Holder A locked 50,000 DEMO for the 90-day minimum. QUALIFIES, 1× the base rate — the
program's own term rule decided that, not an operator's judgement call."*
**Judge should notice:** the multiplier (1×) is printed next to the term that earned it, and
Holder B — same amount, an 18-month commitment — sits right below at 6×: the ceiling is a real
computed ratio, not a typed-in number.

### 0:35–0:55 — Another holder does not qualify, with its reason code
**Screen:** same card, Holder C.
**Capture:** `hub-demo-program.desktop.png` (Holder C block, red border) /
`hub-demo-1-top.*.png`.
**Says:** *"Holder C locked real tokens, but only for 30 days against a 90-day minimum. DOES NOT
QUALIFY, reason code `term_too_short` — printed in the open, not hidden in an operator's notes."*
**Judge should notice:** the rejection has a machine-checkable code, not a paragraph of excuses.

### 0:55–1:15 — Funding: coverage vs shortfall, labelled
**Screen:** same page, the "Funding" card.
**Capture:** `hub-demo-program.desktop.png` (Funding block) / `hub-demo-2-funding-batch.*.png`
(step C on the walkthrough).
**Says:** *"Three numbers, never one green checkmark: 104,166 DEMO obligated, zero reserved in
batches, and the funding wallet observed holding 41,666 — short by 62,500. An observed balance
isn't reserved funding; it can be spent on anything else tomorrow."*
**Judge should notice:** the page is willing to show a real shortfall on its own centerpiece demo
— this is not staged to always look funded.

### 1:15–1:35 — The batch
**Screen:** same page, "Batch DEMO-BATCH-1" table.
**Capture:** `hub-demo-program.desktop.png` (Batch table) / `hub-demo-2-funding-batch.*.png`.
**Says:** *"A batch draws only on what's available — accrued minus anything already reserved or
paid — never on an estimate. Holder A and Holder B are both PAID here, each with a link to their
own receipt."*
**Judge should notice:** the batch total is smaller than "obligations" from the funding card one
scroll up — the batch never claims more than the ledger says is actually available.

### 1:35–2:00 — The receipt, and its explanation
**Screen:** `/hub/demo/r/rcpt-a` for the fixture's own labelled dry run, **and** the real
"How this number was computed" panel expanded on a live-code (non-fixture) receipt.
**Captures:** `hub-demo-receipt-a.desktop.png` / `.mobile.png` (the fixture receipt — dry run, "no
transaction was sent"); `hub-real-explain-block.desktop.png` / `.mobile.png` (the real `<details>`
element from `public/hub.html`, expanded, showing the actual computed steps: the term rule, the 73
hourly slices it drew on, the per-hour share, and the sum).
**Says:** *"Every real receipt on the Hub carries a 'How this number was computed' panel — not a
sales pitch, the actual hourly slices this payment drew on, computed by the same function the
ledger itself uses. This one shows 73 hours, each one's share, added up to the exact amount paid."*
**Judge should notice:** the explanation is generated from stored accrual data, not authored copy
— the demo fixture's own receipt page is intentionally simpler (a labelled dry run with nothing to
verify on-chain), so this second capture is what a **real, non-fixture** receipt shows once a
project is armed. **Honesty note for whoever narrates this:** say plainly that the second capture
comes from an internal, unlisted project seeded only to show this UI element — never present it as
a live customer.

### 2:00–2:20 — Reproduce it yourself
**Screen:** a terminal running `scripts/reproduce-receipt.cjs --offline`.
**Capture:** `reproduce-receipt-terminal.png` — a real, unedited run of the actual script against
saved JSON, zero network calls.
**Says:** *"Save the two small JSON files this page links to, run this script with no wallet, no
key, no network — and it re-derives the exact same amount, independently, on your own machine.
MATCH."*
**Judge should notice:** exit code 0 / status MATCH is the whole claim — nothing here asks the
viewer to trust the server that also produced the number.

### 2:20–2:40 — A second project proves isolation
**Screen:** `/hub/demo-b` (the fixture's own isolation proof) **and** `/hub/poke` (the real,
unarmed second Hub project).
**Captures:** `hub-demo-b.desktop.png` / `.mobile.png`; `hub-poke.desktop.png` / `.mobile.png`.
**Says:** *"Demo Community B has its own store, its own ledger, its own holder — nothing shared
with the first project. And this generalizes past the fixture: POKEAHOE is the Hub's real second
project today, a labelled **dry run** while terms are still being agreed with the team — no
program, no funding wallet, nothing armed."*
**Judge should notice:** POKEAHOE's page says "No programs on record for this project yet" in
plain text — the isolation claim is backed by an empty state, not a hidden filter.

### 2:40–2:55 — 30-second aside: the school and the tools
**Screen:** `/for-projects` (the guided front door) and the school's report card at the end of a
lesson.
**Captures:** `for-projects.desktop.png` / `.mobile.png`; `school-report-card.desktop.png` /
`.mobile.png` (captured by actually taking the "Liquidity Pools" lesson's exam through its own UI
and passing 5/5 — see the note below on what this screen literally is).
**Says:** *"Everything above sits on top of the same free school and the same tool set we've run
since before this window — locking, holder analysis, buy competitions, wallet forensics. One
guided front door links all of it."*
**Judge should notice:** this is explicitly the "also live, same stack" wall from the roadmap —
one aside, not the pitch.

### 2:55–3:00 — Close
**Screen:** `/hub` (the index) or `/for-projects`, held on screen.
**Capture:** `hub-index.desktop.png` / `.mobile.png`.
**Says:** *"Educate, build, earn — and the strongest version of earn is the one we can prove: a
holder who can check what they were owed and what arrived."*

---

## A literal-text note on the report-card capture

The task brief for this storyboard called this beat "the school's 'READY TO LOCK?' card." That
exact string does not exist in the code. What's actually there, driven through the lesson's own
controls (`/school#lesson=lp` → "TAKE THE EXAM" → five real answers → "SEE REPORT CARD"), is the
**post-quiz report card**: a pass/fail screen ("CLASS PASSED", 5/5) with "PROFESSOR NORRIS
REMARKS" and a `LessonLinks` block reading *"NOW GO LOOK AT A REAL ONE"* — for the "lp" (Liquidity
Pools) lesson specifically, that links to **"Go deeper in the LP Lab →"** and the Library's
"Impermanent loss, with the numbers," not to a lock action (`src/App.jsx`'s `LESSON_TOOLS` maps
`lp` → `/lp-lab`; it's the `staking` lesson that links to `/locker-room`, "See real locks on
Jupiter Lock"). This is the closest real screen to the brief's description and is captured as
specified (`/school#lesson=lp`, driven by the lesson's own buttons — no test hooks), with this
note so nobody goes looking for a card that isn't there.

## An incidental finding, out of this task's scope

While seeding a real (non-fixture) receipt to capture the explain panel, the receipt page's
"Submitted" timestamp rendered as `1970-01-21`. Tracing it: `lib/cuna-payout.js`'s real call site
passes `Math.floor(Date.now()/1000)` (unix **seconds**) into the `at` field of a sent row, but
`public/hub.html`'s receipt renderer calls `ts(x.at)` — which expects **milliseconds** — instead of
the `tsUnix(x.at)` helper already defined two lines above it in the same file. This looks like a
real, live display bug (every Hub receipt's "Submitted" line would show a 1970 date), not an
artifact of the seeded data. Not fixed here — flagged for whoever owns `lib/hub/public.js` /
`public/hub.html` next, since fixing product code wasn't in scope for this storyboard task.

---

## Part 2 — the presentation / pitch video (≤2:30), outline only

This is **never a screen recording** — the founder talking, per the Official Rules' separate
2–3 minute presentation video (`docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md`).

**0:00–0:20 — Thesis.** "Cluck Norris is a free Solana crypto school wrapped around the tools a
project needs after launch. The newest piece is the Project Hub: a rewards program whose terms,
eligibility and payments a holder can check without trusting us."

**0:20–0:45 — The insight** (roadmap §1). "Every project says 'trust our rewards program.' We
built the one case where a stranger doesn't have to: publish the program version's hash, publish
every holder's eligibility with a reason code, publish every payment as a receipt with the
transaction — and hand the reader a script that re-derives the amount on their own machine, no
wallet, no network. That's the difference between 'we say it's fair' and 'here's the math, check
it yourself.'"

**0:45–1:20 — What shipped in-window** (from `docs/PRE_EVENT_STATE.md`'s "Built inside the
window" section — cite the actual merged PRs, not aspirational language). "In this four-week
window we built the Hub's settlement library — program versions with hashes, an accrual ledger
that never double-counts, public eligibility reason codes — then the public pages, the operator
console, and a project's own self-serve onboarding and pay flow. The pre-window CUNA lock-to-earn
program was migrated onto the same ledger rather than rebuilt, so week one of production usage
came from day one of the Hub's existence, not from a demo fixture."

**1:20–1:50 — Traction, as mechanism and honesty** (cite `docs/TRACTION_2026-09.md` when it
exists, and always with the period and denominator stated — never a target presented as
achieved). "We report reproducible receipts over total receipts, with the date range named, not a
polished-to-100% number. Where a receipt's inputs weren't retained, the page says so instead of
faking a walkthrough. That includes real production receipts. This dry run — POKEAHOE — is
included as the second Hub project explicitly to prove the platform's isolation guarantee, not as
a live customer."

**1:50–2:10 — The team** (§6 framing, in the founder's own words — never a headcount, never an
agent count offered as a substitute for ownership). "I'm the sole founder. I use AI coding agents
for implementation and a separate AI reviewer to challenge every change before it ships; money
paths get targeted tests and I review every release before it reaches production. The commit
history is provenance, not the pitch — the pitch is that I've been accountable for every release
this project has ever made."

**2:10–2:30 — The ask.** State plainly what Colosseum's judging or prize track would let us do
next (owner fills in the specific ask at recording time — funding, distribution, an accelerator
seat, or simply visibility to the projects the Hub is built for); close on the line from Part 1:
"the strongest version of earn is the one we can prove."

---

## Part 3 — reference captures for the reviewer's path (BB2, `docs/COLOSSEUM_ROADMAP.md` §12)

Not part of either video — these are the pages `docs/HUB_VERIFY.md`'s "reviewer's path" paragraph
now names in order, captured so a second reviewer or a judge can see what each stop actually
renders before clicking through themselves. Same rules as Part 1: real, running app
(`npm run build` then `node server.js`, port 3297, a fresh temp `DATA_DIR`), Playwright at
390×844 and 1280×800, `type: 'png'`, clipped to the viewport (not full-page) to stay under the
size budget on pages with a lot of content. Continuing the shot numbering after Part 1's ten.

**Shot 11 — `/hub/status`.** Captures: `hub-status.desktop.png` / `.mobile.png`. What it shows:
every registered project, its programs and reproducibility ratio, next to the exact git commit
and branch the running server was built from (`GET /api/build`) — a DRY RUN badge on the demo and
POKEAHOE rows.

**Shot 12 — `/hub/judge`.** Captures: `hub-judge.desktop.png` / `.mobile.png`. What it shows: the
six Colosseum judging criteria, each mapped to the exact URL to open and the test file that pins
the claim — this page is a byte-identical render of `docs/JUDGE_GUIDE.md` (`scripts/build-judge-page.cjs`).

**Shot 13 — `/hub/trust`.** Captures: `hub-trust.desktop.png` / `.mobile.png`. What it shows: the
trust-boundary page in plain words — what a hash and a receipt prove, and what they don't — kept
in step with `docs/HUB_VERIFY.md` §(g) by `scripts/hub-trust-doc-test.cjs`'s boundary-marker check.

**Shot 14 — `/hub/wallet`, empty.** Captures: `hub-wallet-empty.desktop.png` / `.mobile.png`.
What it shows: the bare lookup page before any address is entered — the honest starting state,
no wallet connect.

**Shot 15 — `/hub/wallet/<address>`, the "no program has seen this wallet" example.** Captures:
`hub-wallet-clkn.desktop.png` / `.mobile.png`. The roadmap's own demo/fixture wallet
(`scripts/hub-wallet-test.cjs`'s "seen in both projects" address) lives only inside that test's
own throwaway registry — by design, a fixture project can never leak into the real `/hub/wallet`
roll-up (AA1's own contract). So the honest example on the real, running app is the **CLKN mint
address** itself, which the real registry has never seen: `GET /api/hub/wallet/DW6DF2mjtyx67…3CBAGS`
returns `{"projects":[],"seenIn":0}` — confirmed live, and captured exactly as returned, not staged.

**Shot 16 — `/hub/verify`, a dropped evidence bundle.** Captures: `hub-verify-bundle.desktop.png`
/ `.mobile.png`. The bundle downloaded live from `GET /api/hub-demo/demo/batch/demo-batch-1/bundle`
(project id `demo`, batch id `demo-batch-1` — `lib/hub/demo-fixture.js`'s own ids), dropped onto
the "From saved files (offline)" tab's file input. What it shows, both true and both worth
narrating out loud rather than cropping around: **BUNDLE HASH: MATCHES** (the file is intact), and
the batch's two receipts reporting **MISSING_INPUTS** — expected, `HUB_VERIFY.md` §(g)'s
`journal-not-live` boundary already states the demo fixture's batch runs on the not-yet-live
Addendum-B ledger model that `lib/hub/reproduce.js` doesn't read from. See the incidental finding
below for a THIRD thing this capture shows that is not yet documented anywhere.

**Shot 17 — `/holders`, the Compare panel (AA3).** Captures: `holders-compare.desktop.png` /
`.mobile.png`, clipped to the `#compareCard` element only (not the whole page). Two snapshots for
a clearly-fabricated demo mint (never a real token; see the production note below) were seeded
directly via `lib/holders-snapshot.js`'s real `appendSnapshot()` — one wallet held with a growing
balance, one unchanged, one exiting, two new entrants — so `runCompare()` renders real ENTERED /
EXITED / HELD rows from real (if synthetic) data, not a mock-up. **Why this needed a workaround,
stated plainly:** the top half of `/holders` (the live holder breakdown) needs a real RPC call
this environment cannot make (`Wallet X-Ray`/`Holders`-class tools are excluded from the no-network
rule for exactly this reason), but the Compare panel two cards below it is pure `kv` reads
(`GET /api/holders/snapshots`, `GET /api/holders/snapshots/:a/diff/:b` — no RPC at all) gated only
by its parent `.result` container's `show` class, which the RUN button normally sets after a live
snapshot completes. The capture script set that one class directly and called the page's own
`loadHolderHistory()` function — the same code path the RUN button calls, minus the RPC-backed
top section — rather than fabricate the panel's HTML by hand. Production note: the seeded mint is
a fabricated address (`Df8RdWTsNxXvJFwWfCDMfjygfgZLPL4ZRqTuuyDpy5o9`, derived from a
`clkn-storyboard-holders:` seed string, never a real token) written only to this capture's throwaway
`DATA_DIR`, discarded after the shot — no real mint's holder-snapshot history was touched.

---

## An incidental finding, out of this task's scope (BB2)

Dropping the demo evidence bundle onto `/hub/verify` (Shot 16 above) surfaces a line neither
`HUB_VERIFY.md` nor any existing test documents: **"Program-version hash recompute: does not
match — computed …"**, on an untampered, honestly-built bundle. Traced it: the bundle route
(`server.js`, both `/api/hub/:project/batch/:batchId/bundle` and its demo twin) builds the
**Fixed on batch 12 (commit d77729c)** — the served program version now carries every hashed field and the recompute line reads "matches"; the capture below predates the fix and is kept as the record.

bundle's `program` field as `{ ...hubPublic.programVersionView(p.version), $schema }`.
`programVersionView()` (`lib/hub/public.js` ~289) keeps only
`{version, effectiveFrom, effectiveTo, hash, terms, commitment}` — it drops `projectId, mint,
rewardMint, rewardDecimals, rewardTokenProgram, fundingResponsibility, signer, exclusions`, every
one of which `versionRecord()` (`lib/hub/project.js` ~181) hashed when the version was created.
Confirmed directly in Node: `verifyVersionHash(fullInternalVersion)` → `true`;
`verifyVersionHash(programVersionView(fullInternalVersion))` → `false`, on the exact same,
never-edited version. `public/hub-verify.html`'s `reproduceFromBundle()` feeds precisely that
reshaped field into the same check the page runs for a plain URL-paste, so **every bundle drop,
for every project, will print this false "does not match" line** — not a sign of tampering, a
structural gap between what the bundle route embeds and what the hash-check function needs. This
is a real, live, reproducible finding (screenshotted, not staged), flagged in
`docs/CODEX_REVIEWER_BRIEF.md`'s Round 3 (Y1/AA2) for whoever owns `lib/hub/bundle.js` /
`server.js`'s bundle routes next — not fixed here, since fixing product code wasn't in scope for
this docs/capture task, matching the precedent set by the 1970-timestamp finding above.

---

## Part 4 — reference captures, the second batch of reviewer-path pages (FF2, `docs/COLOSSEUM_ROADMAP.md` §§13–15)

Not part of either video — like Part 3, these are pages a second reviewer or a judge would open
next: what changed between two program versions, a receipt kept on paper, the shared vocabulary
behind every reason code, following a project without a wallet, and one wallet checked across
every project it has ever touched. Same rules as Parts 1 and 3: real, running app (`npm run build`
then `node server.js`, a fresh temp `DATA_DIR` on a port in 3480–3489), Playwright at 390×844 and
1280×800, `type: 'png'`, clipped or full-page where noted to stay under the size budget. Every
fixture below is built through the repo's own real Hub libraries (`lib/hub/project.js`,
`lib/hub/commit.js`, `lib/holders-snapshot.js`) with the exact same construction the matching
committed test already uses (named per shot) — nothing on any of these screens is hand-typed.
Continuing the shot numbering after Part 3's seventeen.

**Shot 18 — `/hub/<project>/programs/compare`, two versions (CC1).** Captures:
`hub-compare.desktop.png` / `.mobile.png`. Fixture: a throwaway `cmptest` project with two
published program versions differing in exactly two fields (shortest lock term admitted, payout
cadence), built the same way `scripts/hub-compare-test.cjs` seeds it. What it shows: both
versions' hash and published date, a two-row "what changed" table, and the unchanged-fields
toggle collapsed by default — the trust-boundary line ("a hash commits to the published terms, not
to intent") at the bottom of the page.

**Shot 19 — the print sheet, `?print=1` on a receipt (DD4).** Captures:
`hub-print-sheet.desktop.png` / `.mobile.png`. Fixture: a throwaway `hbprint` project with a real
program version and two hours of accrual settled into one sent batch, the same shape
`scripts/hub-print-test.cjs` seeds. What it shows: the amount that arrived next to the amount the
rule computed, the program-version hash, the settlement signature in full (as text and as a QR
code encoding the public receipt URL), and the trust-boundary line — nav, pills and buttons hidden
by the print stylesheet, exactly what a holder would see on a printed page.

**Shot 20 — `/hub/glossary` (EE2).** Captures: `hub-glossary.desktop.png` / `.mobile.png`. No
fixture needed — the glossary is static content served straight from `lib/hub/glossary.js`. What
it shows: the search box and the first terms, each with its field-name/reason-code label and a
"Learn this →" link back to the page that uses it.

**Shot 21 — the JSON feed, `/api/hub/<project>/feed.json` (DD2).** Captures:
`hub-feed-json.desktop.png` / `.mobile.png`, rendered exactly as Chromium's own JSON viewer shows
a `feed+json` response — no page chrome, because there is none to capture; this is the raw
response a "Follow" link opens. Fixture: a throwaway `feedtest` project with two program versions
(one carrying an applied on-chain commitment), a sent batch and two holder snapshots, the same
shape `scripts/hub-feed-test.cjs` seeds. What it shows: one JSON Feed 1.1 item per version
published, batch settled, snapshot recorded and commitment observed, newest first, each linking
its own public page.

**Shot 22 — the RSS feed, `/hub/<project>/feed.xml` (DD2).** Captures:
`hub-feed-rss.desktop.png` / `.mobile.png`, the same `feedtest` fixture and the same events as
Shot 21, rendered as RSS 2.0 — proof the two feeds carry identical items in identical order, just
two formats of the same append-only record.

**Shot 23 — `/hub/wallet/<address>`, a wallet seen in two real projects (AA1).** Captures:
`hub-wallet-two-projects.desktop.png` / `.mobile.png`, full page (not clipped to the viewport) so
both project cards render completely rather than being cut mid-card. Fixture: two throwaway
projects, `walltest1` and `walltest2`, each running a buy competition, with the SAME wallet
qualifying and paid in one and disqualified with a reason code in the other — the identical
fixture `scripts/hub-wallet-test.cjs` drives (`4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs`, its
own comment calls out as "seen in BOTH projects"). What it shows: "Seen in 2 projects," Wall Test
One's owed/arrived pair with a settlement signature, and Wall Test Two's exclusion with its reason
in plain words ("moved the bag out during the hold (2 transfers) — not eligible") — composed
entirely from `GET /api/hub/wallet/:wallet`, no wallet connect.

**Shot 24 — the reproducibility badge on `/hub/status` (BB3).** Captures:
`hub-status-badge.desktop.png` / `.mobile.png`, a normal viewport capture of the page's header and
badge card (the per-project DRY RUN pills further down the same page were already captured in
Part 3's `hub-status.*.png` — this shot is the badge specifically). Fixture: a real,
non-dry-run `hstest` project with one sent batch, the same shape `scripts/hub-status-test.cjs`
seeds — captured on the same server boot as Shots 18–23 above, so the badge honestly aggregates
every real (non-dry-run, non-buy-comp-excluded) sent batch already on the box: `hbprint` (1),
`feedtest` (2), `hstest` (1) and `walltest1`'s buy competition (1), confirmed against
`GET /api/hub/:project/reproducibility` for each. What it shows: the `GET /hub/badge.svg` image
reading **"5 of 5 across 4 projects"** — computed live by the same `projectReproducibility`
function the status page itself calls, next to the Markdown snippet a project would embed in its
own README, with the number never typed in by hand.

---

## Capture inventory

All files in `docs/demo/2026-09-18/`: Part 1's 24 PNGs + 1 terminal PNG = 25 files, plus 14
reference captures for BB2's reviewer-path shots (Shots 11–17), plus 14 further reference captures
for FF2's second reviewer-path batch (Shots 18–24) — **53 files total, 42–295 KB each, all under
the 300 KB target:**

| File | Viewport | What it shows |
|---|---|---|
| `holders-a11y-before.png` | 390×844 | `/holders?mint=<seeded>` before CC3 — two snapshots recorded, but the X7 history and AA3 Compare panels never render (both lived inside `#result`, which stays `display:none` until a live crawl runs) |
| `holders-a11y-after.png` | 390×844 | the same URL after CC3 — history table + Compare panel render straight from the seeded snapshots (no live crawl needed), with 44×44 tap targets on the hash-copy buttons |
| `hub-demo-1-top.{mobile,desktop}.png` | both | `/hub/demo` scrolled to top — intro, Step A (program version), Step B (eligibility) |
| `hub-demo-2-funding-batch.{mobile,desktop}.png` | both | `/hub/demo` scrolled to Step C (funding) / Step D (batch) |
| `hub-demo-3-reproduce-isolation.{mobile,desktop}.png` | both | `/hub/demo` scrolled to Step F (reproduce) / Step G (isolation) |
| `hub-demo-program.{mobile,desktop}.png` | both, full page | `/hub/demo/p/lock-to-earn` — the complete program record: version+hash, all three holders' eligibility, funding, batch, the six-question teaching block |
| `hub-demo-receipt-a.{mobile,desktop}.png` | both | `/hub/demo/r/rcpt-a` — Holder A's labelled dry-run fixture receipt |
| `hub-demo-b.{mobile,desktop}.png` | both | `/hub/demo-b` — the fixture's own isolated second project |
| `hub-poke.{mobile,desktop}.png` | both | `/hub/poke` — the real, unarmed, labelled-dry-run second Hub project |
| `hub-index.{mobile,desktop}.png` | both | `/hub` — the project index (clkn, cuna, rose, poke) |
| `for-projects.{mobile,desktop}.png` | both, full page | `/for-projects` — the guided front door |
| `school-report-card.{mobile,desktop}.png` | both | `/school#lesson=lp` after passing the exam 5/5 — the real post-quiz report card |
| `hub-real-explain-block.{mobile,desktop}.png` | both, full page | a real (non-fixture) receipt's "How this number was computed" panel, expanded — see the honesty note above about what this project is |
| `reproduce-receipt-terminal.png` | one, terminal-width | a real, unedited run of `scripts/reproduce-receipt.cjs --offline`, MATCH |
| `hub-status.{mobile,desktop}.png` | both, viewport | `/hub/status` (Shot 11) |
| `hub-judge.{mobile,desktop}.png` | both, viewport | `/hub/judge` (Shot 12) |
| `hub-trust.{mobile,desktop}.png` | both, viewport | `/hub/trust` (Shot 13) |
| `hub-wallet-empty.{mobile,desktop}.png` | both, viewport | `/hub/wallet`, no address entered (Shot 14) |
| `hub-wallet-clkn.{mobile,desktop}.png` | both, viewport | `/hub/wallet/<CLKN mint>` — the honest "no program has seen this wallet" example (Shot 15) |
| `hub-verify-bundle.{mobile,desktop}.png` | both, viewport, scrolled to the result | `/hub/verify` with the demo evidence bundle dropped (Shot 16) — see the incidental finding above |
| `holders-compare.{mobile,desktop}.png` | both, clipped to `#compareCard` | `/holders` Compare panel over two seeded snapshots (Shot 17) |
| `hub-compare.{mobile,desktop}.png` | both, viewport | `/hub/cmptest/programs/compare` — two program versions, exactly two changed fields (Shot 18) |
| `hub-print-sheet.{mobile,desktop}.png` | both, viewport | `/hub/hbprint/r/<sig>?print=1` — the printable receipt sheet with its QR code (Shot 19) |
| `hub-glossary.{mobile,desktop}.png` | both, viewport | `/hub/glossary` (Shot 20) |
| `hub-feed-json.{mobile,desktop}.png` | both, viewport | `/api/hub/feedtest/feed.json`, rendered as Chromium's own JSON viewer shows it (Shot 21) |
| `hub-feed-rss.{mobile,desktop}.png` | both, viewport | `/hub/feedtest/feed.xml`, rendered as Chromium shows raw XML (Shot 22) |
| `hub-wallet-two-projects.{mobile,desktop}.png` | both, full page | `/hub/wallet/<seen-in-both address>` — qualifies+paid in one project, disqualified in the other (Shot 23) |
| `hub-status-badge.{mobile,desktop}.png` | both, viewport | `/hub/status`'s live-computed reproducibility badge, "5 of 5 across 4 projects" (Shot 24) |

**How the extra receipt was produced (for the record).** `/hub/demo`'s own fixture receipt page
(`public/hub-demo.html`) does not implement the "How this number was computed" `<details>` element
— that lives only on the real `public/hub.html` receipt page, which needs real accrual/batch data
in the kv store to render anything. To capture it truthfully rather than hand-writing the HTML, a
throwaway project (`storyboard-capture`, id never reused, `dryRun:true`, labelled "internal —
never a real or listed Hub project") was seeded directly into a scratch `DATA_DIR` using the real
`lib/hub/project.js` / `lib/hub/engine.js` / `lib/hub/ledger.js` functions — the same functions
`lib/hub/demo-fixture.js` itself calls to build the judges' walkthrough — so every number on that
screen is genuinely computed, not typed in. It was captured in a **separate server boot** from
every other screenshot specifically so it never appears in the `/hub` or `/for-projects` listings
(confirmed: `hub-index.*.png` lists only clkn/cuna/rose/poke). Nothing from this seed was committed
to the real app; the scratch `DATA_DIR` was discarded after the capture.

**How Part 4's fixtures were produced (for the record).** Shots 18–24 were captured on ONE server
boot against ONE throwaway `DATA_DIR`, seeded with six small, independent throwaway projects
(`cmptest`, `hbprint`, `feedtest`, `hstest`, `walltest1`, `walltest2`, plus a `demo-status-row`
dry-run row) — each built by copying the exact fixture-construction code its matching committed
test already uses (`scripts/hub-compare-test.cjs`, `-print-test.cjs`, `-feed-test.cjs`,
`-status-test.cjs`, `-wallet-test.cjs`), never hand-typed data. Sharing one boot is why Shot 24's
badge honestly reports every real batch already on the box rather than a single isolated number
(see Shot 24's note). None of these ids are real or reused; the `DATA_DIR` was discarded after the
capture, and nothing from it reached the real app.
