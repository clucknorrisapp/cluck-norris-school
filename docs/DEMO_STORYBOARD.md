# Demo storyboard — W7 (docs/COLOSSEUM_ROADMAP.md §W7)

Two separate deliverables, per `docs/COLOSSEUM_OFFICIAL_RULES_NOTES.md`'s submission form: a
**demo video (≤3 minutes)** showing the product, and a **presentation/pitch video (≤2–3 minutes,
target 2:30)** that is never screen-recorded. Captures for the demo live in
`docs/demo/2026-09-18/` — real screenshots of the real, running app (`npm run build` then
`node server.js`), captured with Playwright at phone width (390×844) and desktop (1280×800). File
sizes: 42–295 KB each, all under the 300 KB target; the full set totals under 3 MB.

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

## Capture inventory

All files in `docs/demo/2026-09-18/` (22 PNGs + 1 terminal PNG = 23 files, 42–295 KB each):

| File | Viewport | What it shows |
|---|---|---|
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
