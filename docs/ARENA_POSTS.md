# Arena + X post drafts (Colosseum roadmap extension, E9)

Paste-ready drafts for the Colosseum Arena project-update thread and the CLKN X account (X
Premium — no 280-character limit, but kept short anyway; plain words, one idea per sentence, no
hype adjectives). One post per shipped item, plus a kickoff post stating the thesis.

**File status — updated 2026-09-19, after round 4.** Four rounds of drafts exist in this file,
covering everything merged from the kickoff through batch 18 (PR #357): round 1 (kickoff +
W1–W3/W5 + E1/E2/E4/E5/E7), round 2 (E3/E6/E8, Launch Readiness, airdrop receipts, Buy Special
standings, the merged engine timeline, holder snapshots, `/hub/verify`), round 3 (batches 9–12,
`#347`–`#350`), and round 4, appended below round 3 (batches 13–18, `#351`–`#357`). **Every draft
in every round is still HOLD — none of them has been posted anywhere yet.** `main` is still at
`cfb2ce0` (PR #337, the Hub W1–W3 core only); `develop` is at PR #357/#358. Re-check
`git log origin/main` yourself immediately before posting anything from any round — this
paragraph goes stale the moment the owner promotes, and each round's own status table below is a
snapshot from the day it was drafted, not a live read. Once a draft is actually posted, log it
under "Posting history" at the very end of this file (append, don't edit this paragraph).

**Read this before posting anything.** As of 2026-09-18, the status is:

| Item | Where the code lives | Live on `clucknorris.app` (production/`main`)? |
|---|---|---|
| Hub core, public pages, apply/pay/desk, generalised Lock to Earn (W1–W3) | `main` | **Yes** — this is why the kickoff post can go out now. |
| `/for-projects` front door, Hub traction counters | `develop` (PR #339) | No — owner has not promoted. |
| Seven-language parity fix (seedphrase/inheritance lessons) | not yet on `develop` (PR #340) | No |
| W5 engine dashboard evidence classes | not yet on `develop` (PR #340) | No |
| E1 reproduce-a-receipt, E2 `/hub/demo`, E4 schemas, E5 receipt-teaches, E7 onboarding clock | not yet on `develop` (PR #340) | No |

**Do not post a HOLD item until both of these are true:** (1) PR #340 is merged (to `develop` for
the batch-3 items; the front-door/traction items are already on `develop`), and (2) the owner has
explicitly promoted `develop` → `main` (CLAUDE.md: never automatic, never inferred — his call in
the moment). A post that names a URL only reachable on staging, presented as live, is not true in
the sense the hard rules require. Where a post's Arena/X text below says "once promoted" or "on
production", replace that with the real `clucknorris.app` link only after confirming the promotion
actually happened — don't assume it from this doc.

Every draft below was checked against the code on this branch before writing (`lib/hub/*.js`,
`lib/jvp-dashboard.js`, `server.js` routes, `scripts/reproduce-receipt.cjs`). None claims a yield
figure, an APR/APY, a guarantee, anything about Normie Quest reward terms, or anything about
Wallet Watch. None calls a project "verified" or "safe". The demo project and POKEAHOE (where
mentioned) are always labelled a dry run.

---

## 0. Kickoff — the thesis (post now; the core Hub is already live)

**Status: LIVE NOW.** W1–W3 (project records, program versions, ledger, public Hub pages,
self-serve apply/pay, the operator desk, the generalised Lock to Earn engine) are on `main` today.
This is the one post in this file carrying the pre-window disclosure line — it appears here only.

### Arena

> We're building the Project Hub for this hackathon: a place any Solana token project can publish
> a lock-to-earn program with versioned terms, and every holder gets a receipt they can check
> without trusting us. Our theme is Educate → Build → Earn. Educate: free lessons, in seven
> languages, no wallet needed to learn. Build: tools for other communities, not only our own —
> the Hub, the Locker Room, and the partner-token work we do with other projects. Earn: a
> capability, never a promise — better crypto choices, more exposure for good projects, and a
> receipt a holder can reproduce themselves, which is the part we can actually prove.
>
> I'm the sole founder. AI coding agents implement; a separate AI review pass challenges every
> change; money paths get targeted tests; I approve every release after it sits on staging first.
> Live today: clucknorris.app/hub. Everything before Sep 14, 13:00 UTC is prior work, disclosed in
> full in `docs/PRE_EVENT_STATE.md` in the repo.

### X

> Building the Project Hub this hackathon: any Solana project can publish a lock-to-earn program
> with versioned terms, and holders get a receipt they can check without trusting us.
> Educate → Build → Earn: free lessons in 7 languages, tools we build with other communities, and
> "earn" as capability — never a promise. One founder, AI agents build it, a second AI pass
> reviews every change, I approve releases after staging. Live: clucknorris.app/hub. Everything
> before Sep 14 13:00 UTC is disclosed in docs/PRE_EVENT_STATE.md in the repo.

---

## 1. Front door + traction counters + the seven-language fix (batch 2/3)

**Status: HOLD.** `/for-projects` and the traction counters are on `develop` (PR #339); the
seven-language parity fix is on PR #340, not yet merged. Post only once PR #340 is in and the
owner has promoted. The traction endpoint (`/api/traction`) is owner-only by design — don't link
it; describe the capability instead.

### Arena

> Two things for project teams and learners. `/for-projects` is a guided front door: lock your
> tokens, run a lock-to-earn program, run a buy competition, airdrop, get a listing check,
> snapshot your holders, burn supply with a receipt — laid out in the order teams actually use
> them, with a per-mint checklist read from our existing public feeds.
>
> Separately, we found our own "seven languages" claim wasn't fully true: two lessons — seed
> phrase security and inheritance planning — had zero translated strings in six of our seven
> languages. They're translated now, and we added a CI check that fails the build if a lesson
> ever ships in English only again. And we started counting Hub outcomes as first-class numbers
> (programs published, receipts issued, batches signed) instead of page views, so our own
> traction claims are things we can reproduce, not things we assert.

### X

> Shipped: /for-projects, a guided front door for token teams (lock → lock-to-earn → buy comp →
> airdrop → listing check → holder snapshot → burn receipt, one checklist). Also closed a real
> gap — 2 school lessons (seed phrase, inheritance) were untranslated in 6 of our 7 languages;
> fixed, and CI now catches it if it happens again. And we started counting real Hub outcomes
> instead of page views.

---

## 2. Engine dashboard: evidence boundaries (W5)

**Status: HOLD.** On PR #340, not yet on `develop`/`main`. The page is `/liquidity-engine`
(`clucknorris.app/liquidity-engine`), backed by `/api/jvp/overview` and `/api/jvp/project/:id`.

### Arena

> Our public engine dashboard (clucknorris.app/liquidity-engine) now separates three kinds of
> evidence and never mixes them: historical transactions (what actually moved on-chain — labelled
> as transfers, not motive), retained decision events (a real log of what the code decided,
> reading empty and saying so while an engine is paused — every liquidity engine is paused today),
> and illustrative simulator runs (past incidents replayed through our gate logic, clearly marked
> illustrative — never a real trade). Missing history stays missing rather than being papered
> over. No engine was started to build this page.

### X

> Our engine dashboard now shows three kinds of evidence, clearly separated and labelled:
> real on-chain history, a real decision log (empty + labelled while paused — everything is
> paused today), and illustrative simulator replays of past incidents. Nothing invented, nothing
> mixed together. clucknorris.app/liquidity-engine

---

## 3. Reproduce a receipt yourself (E1)

**Status: HOLD.** On PR #340. Page: `clucknorris.app/hub/<project>` (e.g. `/hub/cuna`) will show
the line once promoted; the tool is `scripts/reproduce-receipt.cjs` in the repo.

### Arena

> The number we think matters most for a rewards program: receipts that reproduce ÷ receipts
> issued — measured, not asserted. We shipped the tool to check it yourself:
> `scripts/reproduce-receipt.cjs` takes a public receipt link, fetches only the published JSON
> (the program terms, the batch's inputs, the receipt), and re-derives the payout amount on your
> own machine — no call to us to "verify" anything, no wallet, nothing to trust but arithmetic
> you can read.
>
> Every Hub project page now prints the line itself — "N of M receipts in this batch reproduce; K
> have missing inputs" — computed by the same code the script runs, not typed in by us. We built
> a CI test that feeds it a tampered fixture and requires it to fail, so the check can't quietly
> stop meaning anything.

### X

> The number that matters for a rewards program: receipts that reproduce ÷ receipts issued.
> Measured, not claimed. New tool: scripts/reproduce-receipt.cjs re-derives a Hub payout from the
> published JSON, on your own machine, no wallet, no trust required. Every Hub page now shows the
> live ratio.

---

## 4. `/hub/demo` — the no-wallet walkthrough (E2)

**Status: HOLD.** On PR #340. URL once promoted: `clucknorris.app/hub/demo`.

### Arena

> Judges shouldn't need a wallet, SOL, or a locked token just to see how the Project Hub works.
> clucknorris.app/hub/demo walks the whole single-holder story end to end on a fixture project
> that's labelled DRY RUN on every screen: a program version → a holder's lock, "qualifies,
> 3-month term, 1x", with the rule that decided it → funding coverage vs. shortfall → a signed
> batch → the receipt → reproducing that receipt yourself → a second project proving the two
> stay isolated. Every number on the page is derived by the real settlement code from fixture
> inputs — nothing on the page is hand-typed — and the fixture is excluded from every real count
> and from the Lock of Fame.

### X

> New: clucknorris.app/hub/demo — the whole Project Hub story, no wallet needed. Clearly labelled
> DRY RUN. Program terms → a holder's lock and why it qualifies → funding coverage → a paid batch
> → a receipt → reproducing it yourself. Every number is real code running on fixture data.

---

## 5. The settlement library, published as a public contract (E4)

**Status: HOLD.** On PR #340. Files: `lib/hub/README.md`, `lib/hub/schema/*.schema.json`, served
at `clucknorris.app/hub/schema/<name>.json` once promoted.

### Arena

> The settlement code behind the Project Hub is now a documented, public contract, not just an
> internal library. `lib/hub/README.md` explains the model in plain words — projects, program
> versions, the ledger, batches, receipts — and JSON Schemas for a program version, a batch, and
> a receipt are served at clucknorris.app/hub/schema/*.json. Every public Hub JSON body that has
> a settled shape validates against them, and a receipt carries a `$schema` link to the exact
> schema it follows. A second product can consume a Hub receipt without reading our server code:
> fetch it, validate it against the published schema, re-derive the numbers yourself. Open-source
> and composable by design.

### X

> Published: the Project Hub's settlement contract. Plain-English README + JSON Schemas for a
> program version, a batch, and a receipt, served at clucknorris.app/hub/schema/*.json. Any
> product can consume a Hub receipt and check it, without reading our code.

---

## 6. The receipt teaches (E5)

**Status: HOLD.** On PR #340. Surfaces on the lock-to-earn holder view (`lib/hub/public.js`
`stakeView`), which the CUNA lock site and Hub project pages render.

### Arena

> Every settled lock-to-earn payment now gets a "how this number was computed" walkthrough — the
> holder's own lock term, and the exact hourly accrual periods the payment drew on, in their own
> numbers. Nothing here is written copy: every step comes from the same function that calculated
> the payout, so the walkthrough's total always equals the receipt's amount, by construction. No
> APR, no APY, no per-year rate — that kind of language can't appear here at all. Educate, inside
> Earn, with the holder's own data instead of a generic explainer.

### X

> Every settled lock-to-earn receipt now shows "how this number was computed" — your own lock
> term and the exact accrual periods it drew from. Derived from the same code that paid you, not
> written copy. No APR, no APY, ever.

---

## 7. Operator onboarding clock (E7)

**Status: HOLD.** On PR #340. Feeds `scripts/traction-report.cjs`'s onboarding table; owner-only
today (no public page). Post describes the capability, not a public link.

### Arena

> We now time how long it actually takes a project to go from applying to the Hub to a real
> payout: apply → approved → first program version published → first batch signed. Each
> timestamp is set once, stored on the project record, and printed in our onboarding-time report
> — so "onboarding is fast" becomes a number we measure, not a line we write. CUNA predates the
> Hub, so its clock reads n/a rather than being backfilled to look good.

### X

> New: we measure real onboarding time for every Hub project — apply → approved → first program
> published → first payout — instead of claiming it's fast. CUNA predates the Hub and is marked
> n/a, not backfilled.

---

## Posting checklist

1. Confirm the item's PR merged (see the status table above and `docs/PRE_EVENT_STATE.md`).
2. Confirm the owner has promoted `develop` → `main` for that PR, if the draft says "once
   promoted" — check `git log origin/main` or ask, don't assume.
3. Swap any "once promoted" phrasing for the real `clucknorris.app` link.
4. Post the Arena draft to the Colosseum project-update thread, and the X draft from the CLKN
   account.
5. Add the post's date/link to this file's history (append, don't overwrite) so E9's own
   "drafts exist as each merges" done-condition stays checkable.

---

# Round 2 — everything shipped since round 1 (Colosseum roadmap §10 Z1)

Drafted 2026-09-18. Round 1 (above) covers the kickoff plus E1/E2/E4/E5/E7 and the front-door/W5
items. This round covers the roadmap extension items merged since (batches 4–9): the school→Hub
bridge, the on-chain commitment dry run, Hub in seven languages, Launch Readiness, airdrop
receipts, Buy Special standings + hold-through proof, the merged engine timeline, holder
snapshots, `/hub/verify`, and the demo storyboard. The receipt lesson (Y2) has not been built as
of this draft and is marked pending below, not drafted.

**Status as of 2026-09-18 — read this before posting anything:**

| Item | Where the code lives | Live on `clucknorris.app` (production/`main`)? |
|---|---|---|
| School→Hub bridge (E6) | `develop` (PR #341, batch 4) | No |
| On-chain program-hash commitment, dry run (E3) | `develop` (PR #341, batch 4) | No |
| Hub in seven languages (E8, extended by X4) | `develop` (PR #341 + #346, batches 4 & 8) | No |
| Launch Readiness (Addendum A) | `develop` (PR #346, batch 8) | No |
| Airdrop per-drop receipts | `develop` (PR #346, batch 8) | No |
| Buy Special standings + hold-through proof | `develop` (PR #346, batch 8) | No |
| Engine timeline, merged + replayable (X5) | `develop` (PR #346, batch 8) | No |
| Holder snapshots, hashed history (X7) | `develop` (PR #346, batch 8) | No |
| `/hub/verify` — reproduce in the browser (Y1) | on this branch, **not yet opened as a PR** (batch 9, in flight) | No |
| The receipt lesson (Y2) | **not built** | — |
| The demo storyboard + narration | `develop` (PR #346, batch 8; docs only) | n/a — it's a script and a folder of screenshots, not a live page |

**Do not post any of these until the owner has promoted `develop` → `main` for the PR it lives
on** (CLAUDE.md: never automatic, never inferred — his call in the moment) — every draft below is
**HOLD**. Re-check `git log origin/main` immediately before posting; this table is a snapshot from
2026-09-18. Every draft was checked against the code on this branch before writing (`lib/hub/*.js`,
`lib/airdrop-receipt.js`, `lib/holders-snapshot.js`, `lib/jvp-dashboard.js`, `public/hub-verify.html`,
`docs/DEMO_STORYBOARD.md`). None claims a yield figure, an APR/APY, a guarantee, anything about
Normie Quest reward terms, or anything about Wallet Watch. None calls a project or a wallet
"verified" or "safe". The demo project and POKEAHOE are always labelled a dry run.

---

## 8. The school teaches you into the Hub (E6)

**Status: HOLD.** On PR #341 (batch 4). Surfaces at the end of the six Lock to Earn lessons in
`src/App.jsx`, and as a lesson-read count on a Hub project page.

### Arena

> The six lessons that teach locking now end on a "Ready to lock?" card — it deep-links to the
> Hub, and to the specific project's page if that's where the learner came from. A Hub project
> page now also shows, anonymously and in aggregate, how many visitors read those lessons before
> anyone even reached the lock action. No wallet involved on either side, just an honest count of
> Educate turning into Earn on one traceable path instead of an assumed one.

### X

> The school's lock-to-earn lessons now end on a "Ready to lock?" card that deep-links straight to
> the Hub project a learner came from. Project pages show, anonymously, how many people read the
> lessons before locking. Educate → Earn, one number we can actually show.

---

## 9. An on-chain witness for a program's terms, dry run first (E3)

**Status: HOLD.** On PR #341 (batch 4). `lib/hub/commit.js` builds the memo; the desk shows the
resulting signature once the server has itself observed the memo land — never on the desk's own
say-so. Dry-run projects (the demo fixture, POKEAHOE) cannot build one at all.

### Arena

> A program's terms hash, served by our own server, only lets you re-check arithmetic — that's
> reproducible, not independently checked. So we added a second, harder thing: the project's own
> funding wallet can sign a one-line on-chain memo carrying that hash, and anyone with an explorer
> can read it without trusting us at all. Our page only upgrades its wording — from "reproducible
> from published inputs" to "independently committed" — once our own server has watched that memo
> land on-chain, never on a browser's say-so. It ships dry-run: no memo has been signed for real
> yet, and a dry-run project (our demo, POKEAHOE) can't build one at all — there's nothing real
> behind it to commit.
> Repo mirror of every commitment, signed or not: `docs/hub/commitments.md`.

### X

> New: a project's funding wallet can sign an on-chain memo carrying its program's terms hash —
> checkable on any explorer, independent of us. Our claim only upgrades to "independently
> committed" once our own server watches it land, never before. Ships dry-run — no real signature
> yet.

---

## 10. The Hub, in all seven languages (E8 + X4)

**Status: HOLD.** On PR #341 (batch 4) for the core Hub pages, extended by PR #346 (batch 8) to
the airdrop receipt page, standings table, readiness desk section and door lines. CI (the i18n
audit) fails the build on any missing key.

### Arena

> The Project Hub — the project list, a project's page, a program version, a receipt, apply, pay —
> now speaks all seven languages the school does, through the same dictionary pattern as the rest
> of the site, not a bolt-on translation layer. The airdrop receipt page and the public Buy Special
> standings joined the same coverage gate this batch. It's checked by CI now, not by memory: the
> build fails if a Hub page ever ships a key in English only.
> Owner reviews the Spanish and Chinese renders on a phone before this posts as fact — that check
> hasn't happened yet as of this draft.

### X

> The Project Hub now reads in all 7 languages the school does — project pages, programs, receipts,
> apply, pay, the airdrop receipt and Buy Special standings pages too. A CI check now fails the
> build if any Hub page ships English-only again.

---

## 11. Launch Readiness — a checklist before a program can arm (Addendum A)

**Status: HOLD.** On PR #346 (batch 8). `lib/hub/readiness.js`; the desk section is holder-facing
too. A `block` item — including a known reward-budget shortfall — refuses the arm route itself,
not just a warning on a page.

### Arena

> Before a project can arm a Lock to Earn program, our desk now runs a Launch Readiness checklist —
> every item is ok / warn / block, and every item is DERIVED from the project's own data: is the
> funding wallet actually funded for what the terms promise over the next few periods, using the
> exact same accrual function the live scheduler runs every hour (not a second, hand-written
> estimate)? A known funding shortfall is a `block`, and `block` actually refuses the arm — it's
> not a badge, it's a gate. No item here ever rolls up into a "safe" or "verified" score; each one
> keeps its own sentence and the rule that produced it.

### X

> New: Launch Readiness — before a program can arm, we check (ok/warn/block, every item derived,
> nothing hand-typed) whether the funding wallet can actually cover the terms over the next few
> periods, using the SAME math the live engine runs. A real shortfall blocks the arm. No "safe"
> score, ever — just labelled items and the rule behind each one.

---

## 12. Airdrop receipts — verified against the chain, per drop (§Extension)

**Status: HOLD.** On PR #346 (batch 8). `lib/airdrop-receipt.js`; rows post from the existing
`public/airdrop.html` flow and are checked against the chain before they ever render as paid.

### Arena

> Airdrops used to end with a one-time, copy-only text block in the operator's browser — nothing
> durable. Now every drop is a small public record: mint, when it started, and every row keyed by
> its own transaction signature. Each row is checked against the chain before it's ever shown as
> paid — the wallet's own token balance has to actually go up by at least that amount, and a row
> that doesn't check out is marked unverified with the reason, never silently dropped and never
> marked paid on faith. "A holder who can check what they were owed and what arrived" — the same
> line the Hub receipts are built on, now for airdrops too.

### X

> Airdrops now get a durable, public per-drop receipt: every row keyed by its own tx signature,
> checked against the chain (the wallet's balance actually has to rise) before it's ever shown as
> paid. Unverified rows say so, out loud, never hidden.

---

## 13. Buy Special standings, and proof a winner actually held (§Extension)

**Status: HOLD.** On PR #346 (batch 8). Public route: `/api/hub/:project/p/:compId/standings`; a
comp only publishes the sealed view (results, hold-through, the payout split) once it's actually
sealed — an unsealed comp publishes rules only.

### Arena

> The Buy Special standings are now a public page: rank, wallet, qualifying volume, and — once a
> comp is sealed — a hold-through check for every winner, with the on-chain evidence: held, sold,
> moved out, or "locked, and a lock is not a sell" (the PDA check we shipped after almost
> disqualifying real lockers). Every signature is the first transaction of its class, so a reader
> can open it on an explorer themselves. An unsealed comp only ever publishes its rules, never a
> results board someone could game by watching it.

### X

> New public page: Buy Special standings + hold-through proof. Rank, wallet, qualifying volume,
> and — once sealed — held/sold/moved-out/locked-not-a-sell for every winner, each with its own
> on-chain signature to check yourself. Unsealed comps show rules only, never results.

---

## 14. The engine dashboard, now one timeline you can replay (X5)

**Status: HOLD.** On PR #346 (batch 8), extending the evidence-boundaries page from round 1 (item
2, PR #340/W5). Page: `/liquidity-engine`.

### Arena

> Our engine dashboard's three evidence classes — real transfers, a real (currently empty) decision
> log, and illustrative simulator replays — are now one time-ordered timeline instead of three
> separate lists, and each row still keeps its own label; nothing is re-classified to make the
> timeline read cleaner. A replay control steps through the retained decision events against the
> same pure gate logic that would have produced them (`lib/engine-decisions.js`), so a reader sees
> what the code actually decided and why — never a live engine, and no engine was started to build
> this.

### X

> Our engine dashboard's three evidence classes (real transfers, a real decision log, illustrative
> replays) are now one time-ordered timeline you can step through — each row keeps its own label.
> A replay control shows what the gate logic actually decided, against real recorded inputs. No
> engine running. clucknorris.app/liquidity-engine

---

## 15. Holder-count history, hashed so you can check it (X7)

**Status: HOLD.** On PR #346 (batch 8). `lib/holders-snapshot.js`; append-only, 90 kept per mint,
served read-only, linked from a Hub project page once a snapshot exists.

### Arena

> Holder counts now have history: every snapshot our tool takes is stored, append-only, with a
> hash computed over the wallet→amount list in a fixed, canonical order — so if you crawl the same
> holder list yourself, independently, you get the same hash, regardless of what order your own
> tool happened to produce it in. Nothing here is gated further than the crawl already was; it's
> read-only history of a public on-chain fact, linked from a Hub project page once a snapshot
> exists.

### X

> New: holder-count history, append-only and hashed. Crawl the same holder list yourself and you
> get the same hash — the ordering is canonicalised so independent crawls agree. Linked from a Hub
> project page once a snapshot exists.

---

## 16. Reproduce a receipt in your own browser, no download required (Y1)

**Status: HOLD — and not yet a PR.** Built on this branch (batch 9, in flight as of 2026-09-18);
`/hub/verify`, backed by the same pure `lib/hub/reproduce.js` + `lib/hub/schema-validate.js` this
round's other CLI tool (E1) uses, bundled for the browser. Do not post until it has actually
merged — check `git log origin/develop` for the PR number before using this draft.

### Arena

> `scripts/reproduce-receipt.cjs` (round 1) needed Node and a terminal. `/hub/verify` is the same
> exact re-derivation, in your browser: paste a receipt link or drop the saved JSON files, it
> fetches the public inputs, checks them against our published schema, and re-derives the payout
> amount on YOUR machine — MATCH, MISMATCH, or an honest MISSING_INPUTS naming what's absent. No
> wallet, no server call to "verify" anything, and it keeps working offline once the page has
> loaded. Every receipt page links to it.

### X

> `/hub/verify` — reproduce any Hub receipt right in your browser. Paste the link, it fetches the
> public inputs, checks them against our schema, and re-derives the payout on your own machine:
> MATCH / MISMATCH / MISSING INPUTS. No wallet, no "trust us," works offline once loaded.

---

## 17. The demo, shot by shot, before a single wallet is ever on screen (§W7)

**Status: docs only — nothing to "go live."** On PR #346 (batch 8). `docs/DEMO_STORYBOARD.md` +
`docs/DEMO_NARRATION.md`, with real captures (desktop and phone) in `docs/demo/2026-09-18/`. This
post is about the artifact itself, not a product surface — fine to post once the PR is on
`develop` (no promotion needed, it changes nothing live), but hold until confirmed merged.

### Arena

> Our demo video isn't going to be a live screen recording improvised on the day — it's scripted
> shot by shot, timestamp by timestamp, against pages that are actually running (`docs/
> DEMO_STORYBOARD.md`, with real captures already taken). Every shot carries a visible DRY RUN
> badge where it applies, and the only verification language on screen is a button a viewer can
> press themselves — never a claim we make on their behalf. If you want to see exactly what the
> judges will see before we record it, the storyboard and its screenshots are in the repo.

### X

> Our demo video is scripted shot by shot against the real, running product — not improvised on
> the day. Every screen that needs it carries a visible DRY RUN badge; the only "verify" on screen
> is a button you press yourself. Storyboard + real screenshots are in the repo.

---

**Y2 — the receipt lesson: not drafted.** As of 2026-09-18 it has not been built (no lesson content
exists yet under this name). Draft an Arena/X post for it only once it merges — don't get ahead of
the code.

## Posting checklist (round 2)

Same five steps as round 1's checklist above, plus: for item 16 (`/hub/verify`), confirm it has an
actual PR number before treating any "HOLD" language here as ready — as of this draft it is
unmerged code on a session branch, not yet a pull request.

---

# Round 3 — batches 9–12 (#347–#350), everything without a draft yet

Drafted 2026-09-18. Rounds 1–2 (above) covered the kickoff, W1–W3, W5, E1/E2/E4/E5/E7, E3/E6/E8,
Launch Readiness, airdrop receipts, Buy Special standings, the merged engine timeline, holder
snapshots, and `/hub/verify` (Y1, item 16). This round drafts everything else merged in batches
9–12 that had no draft yet: the receipt lesson (Y2, flagged "not drafted" at the end of round 2 —
it has since been built), share cards (Y4), the weekly-update generator (Z1), `/hub/status` +
`/api/build` (Z2), route hygiene (Z3), `/hub/wallet` (AA1), the evidence bundle (AA2), snapshot
diff (AA3), `/hub/judge` (AA4), `/hub/trust` (AA5), the classroom curriculum fix (BB1), the
computed badge (BB3), `/receipt` in Telegram (BB4), the receipt lesson measured (BB5), the holders
a11y gate (CC3), `/hub/verify` in all seven languages (CC2), the compare page (CC1),
reproducibility history (CC4), and the `npx` verifier package (DD1).

**Status check before writing this round:** the repo's own history (`origin/main`, five most
recent commits) shows `main` at `cfb2ce0` (PR #337, "meme-queue POST-only + LP Lab CI step
self-build") — the same commit rounds 1–2 found. **Nothing from batches 2–12 (PRs #339–#350) is on
production.** Everything in this round is code on `develop` only, merged via #347 (batch 9), #348
(batch 10), #349 (batch 11) or #350 (batch 12). **Every draft below is HOLD** — do not post any of
it until the owner has explicitly promoted `develop` → `main` for the PR it names (CLAUDE.md
"Branching": never automatic, never inferred) — re-check the actual state of `main` immediately
before posting, not this table.

None of the 19 items below is a security-messaging post in the CLAUDE.md sense (a RootCrak
finding we acted on) — so none carries the RootCrak credit + referral. If a future draft ever
does describe a RootCrak-sourced finding, add both per that rule; none of the round-3 items are
that kind of post, so none is added here. Every draft was checked against the code on this branch
before writing — the "source:" line under each names the exact file(s). None claims a yield
figure, an APR/APY, a guarantee, anything about Normie Quest reward terms, or anything about
Wallet Watch. None calls a project, a wallet, or a number "verified" or "safe" — verbs like
"reproduce" / "check" / "recompute" are used instead, on purpose. The demo project and POKEAHOE
are labelled a dry run wherever mentioned.

---

## 18. The receipt lesson — "Read a Payout Receipt" (Y2)

**Status: HOLD.** On PR #347 (batch 9). Round 2 flagged this item "not built" and left it
undrafted; it has since shipped. Seventh lesson on the Lock to Earn track (`src/App.jsx`, belt
BURSAR), with its own finish-card that links to a real dry-run receipt, `/hub/verify`, and
`/hub/trust`.

source: `src/App.jsx` (the `receipt` lesson entry and `ReceiptLessonBridge`)

### Arena

> A new lesson closes the loop the other six open: "Read a Payout Receipt" teaches what a program
> version and its hash actually mean, what a settlement entry is (and why a partial payment's
> remainder carries forward instead of being written off), and how to reproduce the arithmetic
> yourself from the published inputs. The finish card doesn't just say "go try it" — it links to
> an actual receipt on our labelled dry-run fixture, the browser tool that reproduces it, and the
> page that states plainly what none of this proves. Educate feeding directly into the part of
> Earn we can actually show.

### X

> New lesson: "Read a Payout Receipt" — what a program version's hash means, what a settlement
> entry is, how a partial payment's remainder carries forward instead of vanishing, and how to
> reproduce the number yourself. Finish card links to a real dry-run receipt, the reproduce tool,
> and what none of it proves.

---

## 19. Share cards for every Hub page (Y4)

**Status: HOLD.** On PR #347 (batch 9). One static branded image, server-rendered per-page title
and description built only from the same public view functions the JSON routes already call.

source: `docs/HUB_SHARE_CARDS.md`

### Arena

> Paste a Hub link into X or Telegram now and you get a real card — the project or receipt it
> points to, not a bare URL or a stale generic title. One static branded image, one implementation
> path: the title and description come from the exact same public functions the JSON routes
> already serve, HTML-escaped before they reach the page, so a hostile project label can't break
> the card. A dry-run project or the demo fixture gets a plain DRY RUN mention in the description,
> and a missing or mistyped link still serves a working generic card instead of looking broken.

### X

> Hub links now unfurl properly on X and Telegram: a real title and description per project or
> receipt, built from the same public data the page itself shows, escaped so a hostile label can't
> break it. Dry-run pages say so right in the card.

---

## 20. Weekly updates, built from `git log` instead of memory (Z1)

**Status: HOLD.** On PR #347 (batch 9). Meta: this is the tool this file's companion doc,
`docs/WEEKLY_UPDATE_2026-09-20.md`, is generated with.

source: `scripts/weekly-update-draft.cjs`

### Arena

> Colosseum asks for a weekly video on what shipped and what was hard. Ours starts from a script,
> not a memory: `scripts/weekly-update-draft.cjs` reads the commit record on our own `develop` and
> `main` branches for the week's window, keeps only real squash-merged PRs, checks each one
> against the full history of `main` to say whether it's actually live or still on staging, and
> writes a draft — reconciled by hand afterward, same as every other draft here, but never
> starting from a blank page or a guess.

### X

> Our weekly Colosseum update script pulls straight from the commit record — real merged PRs,
> checked against main to say what's actually live vs. staging — instead of writing from memory.
> Reconciled by hand, but nothing in the first draft is invented.

---

## 21. `/hub/status` — every project's public numbers on one page (Z2)

**Status: HOLD.** On PR #347 (batch 9). `public/hub-status.html`, fed only by routes already
public (`/api/hub`, the reproducibility route, the holder-snapshot series); `GET /api/build`
answers with this container's own git sha/branch/build time.

source: `scripts/hub-status-test.cjs` (page and route contract; the page's own file is
`public/hub-status.html`)

### Arena

> One page now lists every registered Hub project next to its own public numbers — programs
> published, receipts issued, the reproduce ratio, the latest holder snapshot — pulled from
> routes that were already public, not new ones. A dry-run project shows its badge instead of a
> ratio it hasn't earned, and one that hasn't issued a receipt yet says exactly that instead of
> printing "0 of 0". A small companion route, `GET /api/build`, answers with the exact commit
> and branch this server is actually running — so "what's live" stops being a question anyone has
> to ask us.

### X

> New: `/hub/status` — every Hub project's public numbers (programs, receipts, reproduce ratio,
> latest holder snapshot) on one page, fed by routes that were already public. Plus `GET
> /api/build`, which answers with the exact commit this server is running.

---

## 22. Route hygiene on every new public read (Z3)

**Status: HOLD.** On PR #347 (batch 9). Internal hardening, not a feature to demo — one line, no
Arena/X draft.

source: `scripts/public-route-hygiene-test.cjs`

Every public Hub read route added this batch gets a matching ETag/cache tier, the routes that do
real per-request work get a dedicated rate limit, and wallet/signature/mint parameters are shape-
checked before any store lookup so a malformed one 400s instead of triggering a full scan.

---

## 23. `/hub/wallet` — one wallet, every project (AA1)

**Status: HOLD.** On PR #348 (batch 10). `public/hub-wallet.html` + `GET
/api/hub/wallet/:wallet`, composed only from each project's own public `walletLookup`.

source: `public/hub-wallet.html`

### Arena

> Paste a wallet address and see every Hub program it has been part of, across every registered
> project, on one page — what it qualified for, what excluded it, and what actually arrived on
> chain. No wallet connect needed, and a clean wallet with nothing recorded gets an honest empty
> result, not an error. The strongest honest version of "Earn" we have: not a promise, a lookup
> you can run on yourself.

### X

> New: `/hub/wallet` — paste any address, see every Hub program it's been part of across every
> project, what it qualified for, what excluded it, and what arrived. No wallet connect needed.
> An honest empty result for a clean wallet, not an error.

---

## 24. Download the evidence, check it later (AA2)

**Status: HOLD.** On PR #348 (batch 10). `lib/hub/bundle.js`; a downloadable JSON bundle carrying
everything the reproduce tools need, plus a `/hub/verify` tab that accepts a dropped bundle
instead of a live URL.

source: `lib/hub/bundle.js`

### Arena

> Reproducing a receipt today means fetching a few small JSON files from our server, live. Now you
> can download all of them at once as one evidence bundle and check it later — offline, or after
> we've gone quiet, or a year from now. The bundle carries its own hash so you can confirm the file
> you saved is the one you downloaded, and `/hub/verify` now has a second tab that accepts a
> dropped bundle file instead of a URL. Same arithmetic, same code, just decoupled from us still
> being reachable at the moment you check it.

### X

> New: download a Hub batch's whole evidence set as one file — everything `/hub/verify` needs to
> reproduce every receipt in it, checkable offline, later, without us. The bundle carries its own
> hash so you know the file wasn't altered after you saved it.

---

## 25. Holder-count history, now with a diff (AA3)

**Status: HOLD.** On PR #348 (batch 10). Extends the append-only hashed holder snapshots (round 2,
item 15) with a route that diffs two of them.

source: `scripts/holders-snapshot-diff-test.cjs`

### Arena

> Last round we shipped append-only, hashed holder-count history. Now you can diff two snapshots
> of the same project and see exactly who entered, who exited, who grew and who shrank — the
> numbers reconcile exactly (the totals moving between the two snapshots equal the sum of every
> individual change), and the result always names its own scope honestly: this is a diff of the
> recorded top-25, not a claim about every holder. Read-only, no gate beyond the crawl the
> snapshot itself already runs.

### X

> New: diff two holder snapshots and see exactly who entered, exited, grew or shrank — the numbers
> reconcile exactly. Always labelled for what it is: a diff of the recorded top-25, not every
> holder.

---

## 26. A judge's fifteen minutes, generated from one doc (AA4)

**Status: HOLD.** On PR #348 (batch 10). `/hub/judge`, built byte-for-byte from
`docs/JUDGE_GUIDE.md` so the page and the repo doc can't drift.

source: `docs/JUDGE_GUIDE.md` and `scripts/build-judge-page.cjs`

### Arena

> We wrote the shortest honest path through the Project Hub, organised by Colosseum's own six
> judging criteria rather than our own site headings, and it's the same text whether you read it
> in the repo (`docs/JUDGE_GUIDE.md`) or on the live page (`/hub/judge`) — the page is generated
> from the doc, not a second copy someone could forget to update, and a build step checks they
> stay byte-identical. Every step names a URL that needs no wallet and no login, and the test file
> that pins the exact claim it makes.

### X

> New: `/hub/judge` — the shortest honest path through the Project Hub, organised by Colosseum's
> actual judging criteria. Generated straight from the repo doc so the page and the doc can never
> drift apart. No wallet, no login, every step names its own test.

---

## 27. `/hub/trust` — what none of this proves (AA5)

**Status: HOLD.** On PR #348 (batch 10). A dedicated page stating the trust boundary in plain
words, now in all seven languages.

source: `public/hub-trust.html`

### Arena

> Every other Hub page shows what you CAN check yourself. This one names what you still can't: a
> receipt checks that the arithmetic matched published inputs, not that those inputs were honest
> in the first place; a hash checks a document wasn't altered, not that it was ever independently
> witnessed; a dry run is fixture data, never a real payment. We'd rather a reader find this page
> and know exactly where our claims stop than assume we're claiming more than we are.

### X

> New: `/hub/trust` — what the Project Hub does NOT prove, in plain words. A receipt checks
> arithmetic, not honesty of inputs. A hash checks a document wasn't altered, not that anyone
> independently witnessed it. Dry runs are fixture data. We'd rather say this than let you assume it.

---

## 28. Fixing our own curriculum-generation blind spot (BB1)

**Status: HOLD.** On PR #348 (batch 10). Internal tooling fix — the Live Classroom's server-side
curriculum extractor had been silently dropping two whole courses.

source: `scripts/extract-curriculum.js`

### Arena

> We found a real gap in our own tooling: the script that feeds the server-side Live Classroom its
> lesson content only ever looked at one source file, so when two courses (LP Lab, Deep Dive) moved
> into their own files during a refactor, the script kept "succeeding" while silently teaching from
> nothing for those two courses. Rewritten to actually load and run each real source file instead
> of pattern-matching one file's text, and a `--check` mode now fails the build if the generated
> file ever goes stale again.

### X

> Found and fixed: our Live Classroom curriculum generator was silently dropping two whole courses
> after a refactor moved their source files — it kept reporting success. Rewritten to run the real
> source instead of pattern-matching one file, with a CI check against ever going stale again.

---

## 29. A reproducibility badge you can embed (BB3)

**Status: HOLD.** On PR #348 (batch 10). `GET /api/hub/badge.json` (shields.io endpoint-badge
shape) and `GET /hub/badge.svg`, both computed from the same function the reproduce ratio and
`/hub/status` already use.

source: `scripts/hub-badge-test.cjs`

### Arena

> A small badge, computed rather than typed: "N of M receipts reproduce across K projects," or an
> honest "no receipts yet" on a fresh install, from the exact same function every other reproduce
> number on the site already runs. Two routes — a shields.io-shaped JSON endpoint and a small
> server-rendered SVG — so a partner project or a judge's own README can embed the live number
> instead of a screenshot of one.

### X

> New: an embeddable reproducibility badge (JSON + SVG), computed from the same function every
> other reproduce number on the site uses — "no receipts yet" on a fresh install, never a fake
> "0 of 0."

---

## 30. `/receipt <signature>` — check a payout from Telegram (BB4)

**Status: HOLD.** On PR #349 (batch 11). A bot command that composes its reply from the same
public receipt view the web route already reads; follows the same room policy as every other
message the bot sends.

source: `lib/hub/receipt-command.js`

### Arena

> You can now ask our Telegram bot directly: `/receipt <signature>` and it replies with what the
> record shows — the amount, the program version, a shortened signature, and links to check it
> further — built from the exact same public function the receipt page itself calls, nothing typed
> by hand. Same honesty rules as everywhere else: it states what the record shows, never why, and
> it follows the same per-room sending policy every other message from the bot already does.

### X

> New Telegram command: `/receipt <signature>` — replies with what the record shows (amount,
> program version, links to check it) from the same public data the receipt page reads. No
> guesswork, no private data.

---

## 31. The receipt lesson, measured (BB5)

**Status: HOLD.** On PR #349 (batch 11). `hub_lesson_read` and `hub_bridge_click` now break out
per-lesson in the traction report; the store-edition build separately refuses to ship any Hub
string into the education-only app bundle.

source: `scripts/analytics-engaged-test.cjs` (the "engaged visitor" definition this figure builds
on) and the batch-11 commit message for the `hub_lesson_read`/`hub_bridge_click` breakdown

### Arena

> Last batch's "school teaches you into the Hub" bridge (E6) now has its own numbers instead of one
> combined count: how many people actually finished the receipt lesson, and, separately, how many
> clicked through to the Hub from it — anonymous, aggregate, no wallet involved. And because our
> Google Play app is a pinned, education-only bundle, its build now refuses outright to ship any
> Hub-related string into that package — a mistake there can't happen quietly.

### X

> The receipt lesson now has its own numbers: how many finished it, and how many clicked through
> to the Hub, separately and anonymously. Also: our education-only app build now refuses to ship
> any Hub string at all — enforced at build time, not by memory.

---

## 32. Phones and screen readers on the public Hub pages (CC3)

**Status: HOLD.** On PR #349 (batch 11). `scripts/hub-a11y-test.cjs` gates five public pages
(`/hub`, `/hub/demo`, `/for-projects`, `/hub/apply`, a project's pay page) at two phone widths; a
real hidden-panels bug on the holders tool was found and fixed in the same batch.

source: `scripts/hub-a11y-test.cjs`

### Arena

> Judges click these pages on their phones, so we now gate five of the public Hub pages against a
> real accessibility check on every push: no page can scroll sideways, every real tap target is at
> least 44×44 pixels, every image has alt text, every icon-only button has a name a screen reader
> can announce, and heading order never skips a level. Building this surfaced a real bug on the
> holders tool — a set of panels that were supposed to be hidden weren't — and that's fixed now too.

### X

> New CI gate: five public Hub pages checked on real phone widths for tap-target size, alt text,
> icon-button names and heading order, on every push. Building it caught and fixed a real bug on
> the holders page — some panels weren't actually hidden.

---

## 33. `/hub/verify`, now in all seven languages (CC2)

**Status: HOLD.** On PR #350 (batch 12). Extends item 16's `/hub/verify` (round 2) with the same
seven-language dictionary pattern the rest of the site uses, served on a no-build boot; also fixes
a real bug in the evidence bundle's program-version hash check that this same tool surfaced.

source: `scripts/hub-verify-page-test.cjs`, `scripts/i18n-audit.cjs` (the `HUB_FILES` gate list)

### Arena

> `/hub/verify` (round 2) now speaks all seven languages the school does, through the same
> dictionary pattern and the same CI check that fails the build if a key is ever missed. Along the
> way we found and fixed a real bug: the evidence bundle's embedded program version was missing
> several fields the hash is actually computed over, so a completely correct, untouched bundle
> could print a false "does not match" on that one line. Fixed at the source — the bundle now
> carries every field the hash needs — and the check that would have caught this earlier is now
> part of the test.

### X

> `/hub/verify` now works in all 7 languages. Also: found and fixed a real bug where a correct,
> untouched evidence bundle could print a false "doesn't match" on the program-version check —
> the bundle was missing fields the hash needed. Fixed at the source.

---

## 34. See exactly what changed between two program versions (CC1)

**Status: HOLD.** On PR #350 (batch 12). `/hub/:project/programs/compare`, a field-by-field diff
computed in the browser from the two public program-version documents already served.

source: `scripts/hub-compare-test.cjs`

### Arena

> When a project publishes a new program version, you shouldn't have to read two hash-stamped
> documents side by side yourself to know what changed. `/hub/<project>/programs/compare` diffs the
> two most recent versions field by field, right in the browser, from the same public documents the
> site already serves — nothing new is computed server-side, and every unchanged field collapses so
> the two or three that actually moved stand out.

### X

> New: `/hub/<project>/programs/compare` — a field-by-field diff between a project's two most
> recent program versions, computed in your browser from the public documents already served.
> Nothing hidden, nothing new server-side.

---

## 35. A trend line for the reproduce ratio (CC4)

**Status: HOLD.** On PR #350 (batch 12). `lib/reproducibility-history.js`, a daily, append-only,
hashed record per project, same shape as the holder snapshots.

source: `lib/reproducibility-history.js`

### Arena

> The reproduce ratio on a project's badge is a snapshot of right now. We now also keep a daily,
> append-only, hashed history of it per project — so a regression is visible the day it happens
> instead of being invisible until someone happens to check, and a day's number, once written,
> never moves. Same append-only, hashed pattern as the holder-count history we shipped earlier —
> the second table in the codebase built this way, on purpose, not a new idea each time.

### X

> New: a daily, hashed, append-only history of each project's reproduce ratio — so a regression
> shows up the day it happens, not whenever someone checks. Once written, a day's number never
> moves.

---

## 36. One command to reproduce a receipt (DD1)

**Status: HOLD, and the package is NOT yet published to the npm registry.** On PR #350 (batch 12).
Built and tested in this repo on every commit that touches it; publishing it to the npm registry
is pending the owner's own act. **Do not post the plain `npx @clkn/hub-verify` line until that
publish has actually happened** — until then, the honest form of this post uses the git-ref
command or points at the repo script directly, exactly as the drafts below do.

source: `packages/hub-verify/README.md`

### Arena

> `scripts/reproduce-receipt.cjs` needed a clone of our repo. The exact same code — copied
> byte-for-byte by our own build script, not retyped — is now a small, dependency-free package
> meant to run with one command, no clone, no build. It isn't on the npm registry yet — that
> publish is the owner's call, still pending — so for now the honest way to run it is straight
> from the repo: a git-ref `npx` command against this repository, or `node
> scripts/reproduce-receipt.cjs` in a clone. Same arithmetic, same result, either way. The full
> command forms are in `packages/hub-verify/README.md`.

### X

> New: the receipt reproducer as a standalone package, `@clkn/hub-verify` — one command, no clone,
> no build, same code the browser tool and the repo script already run. Not on the npm registry
> yet (owner's call, pending); today it runs straight from a git ref or the repo script — see
> packages/hub-verify/README.md.

---

## Posting checklist (round 3)

Same five steps as round 1's checklist above, plus:
1. Re-check the actual current tip of `main` immediately before posting anything from this round —
   this whole round was drafted against `main` at `cfb2ce0` (PR #337); a promotion after this
   draft changes the status line for every item here at once.
2. For item 36 (the `npx` verifier), confirm the package has actually been published to the npm
   registry before using the plain `npx @clkn/hub-verify` line — if it hasn't, use the git-ref
   form or point at the repo script instead, exactly as the draft above does.

---

# Round 4 — batches 13–18 (#351–#357), everything without a draft yet

Drafted 2026-09-19. Rounds 1–3 (above) covered the kickoff through batch 12 (`#347`–`#350`). This
round drafts what merged since: following a project without a wallet (DD2), a printable receipt
with a QR of its own URL (DD4), a read-only adversarial pass over the public Hub surfaces and the
fix round that closed its four P1 findings (DD5), preview-before-publish on the operator desk
(EE1), the Hub glossary in seven languages (EE2), a load proof for the public reads with
before/after numbers (EE3), docs drift round 4 and the operator-interview validation rows (FF1,
EE5 — hygiene, no Arena/X draft), the demo storyboard's second half with fourteen fresh captures
(FF2), the POKEAHOE dry-run rehearsal walked end to end (FF4), the pitch and demo scripts re-timed
with a one-page click sheet (FF3), and the desk fixes that rehearsal produced (GG3). Batch 18
(`#357`) is a disclosure-line and handoff-doc update only — no product surface, so it gets no
Arena/X draft either.

**Status check before writing this round:** `git log origin/main` still shows `main` at `cfb2ce0`
(PR #337) — unchanged since round 3. `git log origin/develop` shows `develop` at PR #357 (batch
18; PR #358 on top of it is this file's own round-4 status note and the weekly-update refresh,
not a product change). **Nothing from batches 2–18 (PRs #339–#357) is on production.** Everything
in this round is code on `develop` only, merged via #351 (batch 13), #352 (batch 14), #353 (batch
15), #355 (batch 16), or #356 (batch 17). **Every draft below is HOLD** — do not post any of it
until the owner has explicitly promoted `develop` → `main` for the PR it names (CLAUDE.md
"Branching": never automatic, never inferred) — re-check the actual state of `main` immediately
before posting, not this table.

None of the items below is a security-messaging post in the CLAUDE.md sense (a RootCrak finding
we acted on) — DD5's adversarial pass is our own internal review, not a RootCrak-sourced finding —
so none carries the RootCrak credit + referral.

> ⚠️ **OPEN — the owner's ruling, raised 2026-09-19, not yet given.** That is the narrow reading.
> CLAUDE.md's rule is written broadly: *"Whenever we talk about security publicly — X, Telegram,
> the site, investor/grant copy — credit RootCrak and include our referral link."* It does not say
> "only a RootCrak-sourced finding". Item 39 below announces a security review of our own public
> surfaces, which is talking about security publicly on the broad reading. **If the owner reads it
> broadly, item 39 — and any future draft describing a review, an audit or a security fix — gets
> `@ro0TCr4k` credited and `https://rootcrak.com/?ref=clucknorris` appended before it is posted.**
> Every draft here is HOLD anyway, so nothing ships on the wrong reading; do not post item 39 until
> this is settled.

Every draft was checked against the code on
`develop` before writing — the "source:" line under each names the exact file(s). None claims a
yield figure, an APR/APY, a guarantee, anything about Normie Quest reward or prize terms, or
anything about Wallet Watch. None calls a project, a wallet, or a number "verified" or "safe" —
"reproduce" / "check" / "recompute" are used instead, on purpose. The demo project and POKEAHOE
are labelled a dry run wherever mentioned; POKEAHOE has not been armed and no arm flag has ever
been sent.

---

## 37. Follow a project without a wallet (DD2)

**Status: HOLD.** On PR #351 (batch 13). `GET /api/hub/:project/feed.json` (JSON Feed) and
`GET /hub/:project/feed.xml` (RSS), both on the `hubheavy` limiter with a 300s cache; the demo
fixture is never registered in `hubProjects()` so it can't appear in either feed.

source: `lib/hub/feed.js`, `scripts/hub-feed-test.cjs`

### Arena

> You don't need a wallet, or us, to follow what a Hub project does. `/api/hub/:project/feed.json`
> (JSON Feed) and `/hub/:project/feed.xml` (RSS) list, newest first: every program version
> published (with its hash), every on-chain terms commitment observed, every batch settled (with
> that batch's own receipt count and reproduce ratio), and every holder snapshot taken — each item
> linking to its own public page. Read-only, cached like every other public read, built only from
> views the site already serves; the demo fixture is excluded. Every project page now has a
> "Follow this project" line with both links.

### X

> New: follow any Hub project without a wallet. `/api/hub/:project/feed.json` (JSON Feed) and
> `/hub/:project/feed.xml` (RSS) — program versions, on-chain commitments, settled batches with
> their reproduce ratio, holder snapshots. Read-only, built from data the site already shows.

---

## 38. A receipt you can print (DD4)

**Status: HOLD.** On PR #351 (batch 13). `/hub/<project>/r/<sig>?print=1`; the QR is generated by
`public/hub-qr.js`, a pure, dependency-free, no-network encoder served on its own explicit route
(the no-build-boot trap CLAUDE.md warns about).

source: `public/hub-qr.js`, `scripts/hub-print-test.cjs`

### Arena

> Every Hub receipt now has a print view: `/hub/<project>/r/<sig>?print=1` lays out the amount,
> the rule that computed it, the settlement signature as text AND as a QR code, the program-version
> hash, the reproduce steps, and our own trust-boundary line, on one page with nav and buttons
> hidden. The QR encodes nothing but the receipt's own public URL — generated by a small,
> dependency-free encoder we wrote ourselves, no network call, no third-party library. Seven
> languages, same as the rest of the Hub. A holder can keep a paper copy of exactly what the
> record says.

### X

> New: a printable Hub receipt. `?print=1` on any receipt URL — amount, the rule, the settlement
> signature as text and QR, the program hash, reproduce steps. QR encodes only the receipt's own
> URL, made with our own no-network encoder. Seven languages.

---

## 39. A second lens on the public surfaces, and the fix round it produced (DD5)

**Status: HOLD.** The read-only pass is on PR #351 (batch 13); its four P1 fixes are on PR #352
(batch 14). Report: `docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md` — **P0: 0 · P1: 4** across the
nine surfaces added since batch 9.

source: `docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md`

### Arena

> We ran a read-only adversarial pass over every public Hub page and route added since batch 9 —
> `/hub/verify`, `/hub/status`, `/hub/wallet`, `/hub/trust`, `/hub/judge`, the compare page, the
> holders Compare panel, the badge routes, and the new feeds — looking for a private field on the
> wire, a spoofable trust surface, a route with no limit on it. Zero P0s, four P1s, and all four
> closed the same week with regression tests: `/hub/verify` no longer fetches or renders a verdict
> from an origin other than our own; it prints amounts in token units instead of raw base units;
> the heaviest reads (a wallet lookup, the project list, a project page) got a rate limiter and a
> cache instead of none at all; and `POST /api/track` can no longer mint unbounded tracking keys
> that move a real traction number. Full report in the repo.

### X

> Ran a read-only adversarial pass over every new public Hub surface: /hub/verify, /hub/status,
> /hub/wallet, /hub/trust, /hub/judge, compare, badges, feeds. Zero P0, four P1 — all four fixed
> the same week with regression tests (a trust-surface spoof, raw units on screen, unlimited
> reads, an unbounded tracking key). Report's in the repo.

---

## 40. Preview before publish (EE1)

**Status: HOLD.** On PR #352 (batch 14). `POST /api/hub/:project/desk/preview`, gated the same as
the terms write itself; `previewTerms()` writes nothing.

source: `lib/hub/preview.js`, `scripts/hub-preview-test.cjs`

### Arena

> Before an operator publishes new terms, our desk now shows "who would this pay today?" for the
> draft — a read, nothing written, nothing sent. It runs the exact same eligibility and accrual
> functions the live scheduler runs, against the current locks, and shows per wallet
> qualified/excluded with the reason code, plus the funding-budget line from Launch Readiness. A
> test proves the preview for an already-published version equals what the live route actually
> computes on the same data — so the number an operator sees before publishing is never a second,
> hand-written estimate.

### X

> New on the operator desk: preview draft terms before publishing. Same eligibility and accrual
> code the live engine runs, applied to today's real locks — who'd qualify, who's excluded, the
> budget line. Read-only, nothing written. A test proves it matches the live route exactly.

---

## 41. The Hub glossary (EE2)

**Status: HOLD.** On PR #352 (batch 14). `/hub/glossary`, seven languages, each entry anchorable
and linked from the receipt, compare, wallet and lesson pages that use the term.

source: `lib/hub/glossary.js`, `scripts/hub-glossary-test.cjs`

### Arena

> `/hub/glossary` — every term and reason code our receipts, the compare page, the wallet lookup
> and the pre-lock lesson use, defined once in plain words, in all seven languages, each one
> anchorable and linked from wherever it appears. A drift test fails the build the moment a reason
> code ships in the actual settlement code with no glossary entry, so the definitions can't
> quietly fall behind what the code does.

### X

> New: /hub/glossary — every term and reason code the receipts, compare page, wallet lookup and
> lesson use, in one place, in all 7 languages. A CI test fails the build if a code ever ships
> with no glossary entry.

---

## 42. A load proof for the public reads (EE3)

**Status: HOLD.** On PR #352 (batch 14). Fixture + smoke: `scripts/hub-load-fixture.cjs` +
`scripts/hub-load-smoke.cjs`; before/after numbers in `docs/HUB_LOAD_2026-09-18.md`; a reduced run
is in CI.

source: `docs/HUB_LOAD_2026-09-18.md`

### Arena

> We load-tested our own public Hub reads against a 50-project, ~9,800-receipt fixture and found a
> real problem: four routes — the project list, a wallet lookup, a project page, and the share
> page — had no rate limiter and no cache, and a 70-request burst against them pushed our own
> `/healthz` from sub-millisecond to 52 seconds. Fixed the same week: a rate limiter plus a short
> per-project cache on all four. On the CI-scale fixture, `/healthz`'s worst latency under the same
> burst went from 1,273–1,400ms before the fix to 402–422ms after, and every one of the eleven
> public routes we measure now lands inside its 500ms budget. Before-and-after numbers, the box's
> specs, and the exact commands are all in the repo.

### X

> Load-tested our public Hub reads and found a real gap: 4 routes with no rate limit or cache let
> a burst push /healthz to 52 seconds. Fixed the same week. On the CI fixture, worst /healthz
> latency under the same burst: 1,273–1,400ms before the fix, 402–422ms after. All 11 measured
> routes now land inside budget.

---

## 43. Validation rows from the record (EE5)

**Status: HOLD.** On PR #352 (batch 14). Internal, owner-facing document, not a public surface —
`docs/VALIDATION_2026-09.md` gains onboarding-clock rows fed by real milestone timestamps; the
operator-interview rows themselves stay marked `[to be filled]` until the owner actually runs
those interviews.

source: `scripts/validation-rows.cjs`, `docs/VALIDATION_2026-09.md`

No Arena/X draft — this is the founder's own working document for the judges' "who pays you and
why do they come back" question, not a product to demo, and it names its own unfilled cells
rather than a claim that's ready to post.

---

## 44. Docs drift round 4 (FF1)

**Status: HOLD.** On PR #353 (batch 15). Internal documentation hygiene, not a feature —
`docs/CODEX_REVIEWER_BRIEF.md` Round 4 for #351–#352 and the settlement journal's own verification
rounds 3–5; `docs/HUB_VERIFY.md` and the regenerated `/hub/judge` extended to name the feeds, the
glossary, the print sheet and the compare page in the reviewer's own reading path.

source: `docs/CODEX_REVIEWER_BRIEF.md` Round 4, `docs/HUB_VERIFY.md`, `docs/JUDGE_GUIDE.md`

No Arena/X draft — this keeps the reviewer's reading path in sync with what actually shipped;
nothing here is a claim worth posting on its own.

---

## 45. The demo storyboard, second half (FF2)

**Status: HOLD.** On PR #353 (batch 15). Fourteen further captures (Shots 18–24, desktop +
mobile) in `docs/demo/2026-09-18/`; `scripts/demo-storyboard-inventory-test.cjs` checks the
storyboard's own inventory count against the folder on disk.

source: `docs/DEMO_STORYBOARD.md` (Part 4), `scripts/demo-storyboard-inventory-test.cjs`

### Arena

> Fourteen more real screen captures — desktop and phone — added to our demo storyboard: the
> compare page, the print sheet, the glossary, a feed rendered in an actual reader, the wallet
> roll-up across two projects, and the reproducibility badge on `/hub/status`. Same rule as every
> earlier batch: real running app, real fixtures built the same way the matching test seeds them,
> DRY RUN visible wherever it applies, and a CI test that checks the storyboard's own inventory
> count against the folder on disk so the list can't silently drift from what's actually there.

### X

> 14 more real captures (desktop + phone) in our demo storyboard: compare page, print sheet,
> glossary, a feed in an actual reader, the wallet roll-up, the /hub/status badge. Real app, real
> fixtures, DRY RUN visible where it applies. A CI test checks the inventory matches the folder.

---

## 46. The POKEAHOE rehearsal, dry run throughout (FF4)

**Status: HOLD.** On PR #355 (batch 16). `docs/POKEAHOE_REHEARSAL_2026-09.md`; run against a
throwaway local `DATA_DIR`, never the real one; `dryRun` asserted `true` before the first write
and re-asserted `true` after the last one; no arm flag (`&arm=1&confirm=go-live`) was ever sent.

source: `docs/POKEAHOE_REHEARSAL_2026-09.md`

### Arena

> We rehearsed onboarding a second real project, POKEAHOE, end to end — publishing terms from the
> desk, previewing them, Launch Readiness, letting accrual run, attempting a batch — with the
> dry-run flag kept on throughout and no arm flag ever sent. Every write happened against a
> throwaway local database, never the real one. The write-up names what actually confused a
> first-time operator and the exact sequence for the real go, so the night we actually onboard a
> second project isn't the first time anyone has seen these screens.

### X

> Rehearsed onboarding a second project (POKEAHOE) end to end — terms, preview, Launch Readiness,
> accrual, a batch attempt — dry-run flag on throughout, no arm flag ever sent, against a
> throwaway database. Write-up names what confused a first-timer and the exact steps for the real
> go.

---

## 47. The pitch and demo scripts, re-timed to what actually exists (FF3)

**Status: HOLD.** On PR #356 (batch 17). `docs/PITCH_SCRIPT.md`, `docs/DEMO_NARRATION.md`, and the
new `docs/DEMO_CLICK_SHEET.md`; every claim in both scripts re-checked against `develop` before
the re-time.

source: `docs/PITCH_SCRIPT.md`, `docs/DEMO_NARRATION.md`, `docs/DEMO_CLICK_SHEET.md`

### Arena

> Re-timed our pitch script and demo narration to the surfaces that actually exist today — the
> settlement journal as the live payout path, `/hub/verify`, the wallet roll-up, compare, print,
> feeds, the glossary — and re-checked every claim in both against the actual code first. We also
> corrected a couple of our own stale lines in the process: a claim that something had taken "four
> weeks" when it had actually been about four days, and a bug we'd still called "not yet fixed"
> after it had shipped a batch earlier. A new one-page click sheet lists exactly what to open, in
> order, for the recording session.

### X

> Re-timed our pitch and demo scripts to what actually exists on develop today, re-checking every
> claim against the code. Fixed two of our own stale lines along the way (an overstated timeframe,
> a bug we still called "not fixed" after it had shipped). New one-page click sheet for the
> recording.

---

## 48. Desk fixes from the rehearsal (GG3)

**Status: HOLD.** On PR #356 (batch 17). Every "what confused" line in
`docs/POKEAHOE_REHEARSAL_2026-09.md` §4 resolved with a fix or a recorded reason it stays; seven
languages where the copy changed.

source: `lib/hub/project.js`, `lib/hub/routes.js`, `scripts/hub-registry-test.cjs`

### Arena

> Rehearsing POKEAHOE's onboarding turned up four real rough edges on the operator desk, and we
> fixed all four the same day: the registry endpoint now accepts the field name the desk actually
> sends and refuses any other unrecognized field with a clear error instead of silently doing
> nothing; the wallet lookup's empty state now says plainly it shows past records, not live
> eligibility; the project page spells out "program" versus "program version" in one line; and
> publishing terms with no funding wallet on file now names the exact next step instead of
> surfacing a raw internal error. All in seven languages where the copy changed.

### X

> POKEAHOE's rehearsal found 4 real rough edges on the operator desk — fixed same day: a registry
> endpoint that silently no-op'd on a wrong field name, an ambiguous "past records vs live
> eligibility" label, unclear program vs program-version wording, and a raw internal error when no
> funding wallet is set. All 7 languages where copy changed.

---

**Batch 18 (`#357`) — nothing to draft.** It is a disclosure-line and handoff-document update only
(`docs/PRE_EVENT_STATE.md`, `docs/HANDOFF_2026-09-18.md`) — no product surface shipped, so no
Arena/X item is drafted for it.

## Posting checklist (round 4)

Same five steps as round 1's checklist above, plus:
1. Re-check the actual current tip of `main` immediately before posting anything from this round —
   this whole round was drafted against `main` at `cfb2ce0` (PR #337), the same tip round 3 saw; a
   promotion after this draft changes the status line for every item here at once.
2. Items 43 and 44 (EE5, FF1) and the batch-18 note above are internal hygiene with no Arena/X
   draft — don't invent one; there is nothing product-facing there to post.

---

## Posting history

Nothing from this file has been posted yet, in any round, as of 2026-09-19. When the owner
actually posts a draft, append a line here — date, round + item number, Arena and/or X, and the
live link — rather than editing any status line above. An empty section below this point means
exactly that: no draft in this file has gone out the door.
