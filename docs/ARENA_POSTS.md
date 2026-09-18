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
