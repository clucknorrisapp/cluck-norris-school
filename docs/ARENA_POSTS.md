# Arena + X post drafts (Colosseum roadmap extension, E9)

Paste-ready drafts for the Colosseum Arena project-update thread and the CLKN X account (X
Premium — no 280-character limit, but kept short anyway; plain words, one idea per sentence, no
hype adjectives). One post per shipped item, plus a kickoff post stating the thesis.

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
