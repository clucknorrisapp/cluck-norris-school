# Pre-event state — what existed before the Colosseum window

Colosseum's rule: pre-existing code is allowed, all prior development must be disclosed, and only
work completed between 2026-09-14 and 2026-10-12 is judged. This file is that disclosure.

**Finalised 2026-09-14 09:00 UTC**, four hours before the Contest Period opens at **13:00 UTC**
(06:00 PT, per §5 of the Official Rules). Everything reachable from the two commits below predates the window and is **not**
claimed as hackathon work.

## The snapshot commits

| Branch | Commit | Head at snapshot |
|---|---|---|
| `main` (production) | `75b69cc64a8f87a65482dc7673590c6d0b0a8bbd` | Retired-feature sweep on main (#297) |
| `develop` (staging) | `41d0a6a2a590fb5b32b6b634419ff0e19917f552` | Merge `origin/main` into develop |

Durable markers pushed at those SHAs:

- `snapshot/pre-colosseum-2026-09-14-main`
- `snapshot/pre-colosseum-2026-09-14-develop`

These are **branches, not tags**. The cloud session's push credential is branch-scoped and
cannot create tags, which was proven on 2026-09-11 with `store-google-v1.0.0` and confirmed again
here. The branches pin the same commits and serve the same disclosure purpose. To add the real
annotated tags from a machine with tag push rights:

```
git fetch origin
git tag -a pre-colosseum-2026-09-14 origin/main -m "pre-Colosseum snapshot"
git push origin pre-colosseum-2026-09-14
git tag -a pre-colosseum-2026-09-14-develop origin/develop -m "pre-Colosseum snapshot (develop)"
git push origin pre-colosseum-2026-09-14-develop
```

## Platform that existed before Sep 14 (baseline, disclosed, not claimed as hackathon work)

- The school: 35 lessons in three tracks, seven languages, read-aloud, Ask Cluck tutor,
  server-gated graduation credential and on-chain NFT, quiz-free public syllabus.
- The tools: Wallet X-Ray, Holders, Trace, Wallet Checkup (free), Listing Checkup, Owners
  Snapshot, LP Rescue (Meteora recovery; Orca/Raydium diagnosis), Firepit, Project Burn, Token
  Metadata Lock, the Hatchery, the batch airdropper, Buy Special, the unified tools pass (signed
  session, server-enforced).
- The Locker Room on Jupiter Lock (free, Token-2022), Lock of Fame pages and index, lock
  celebrations to X and Telegram.
- CUNA lock-to-earn (single mint): hourly accrual, weekly owner-signed payouts, first payout
  2026-09-09.
- The Liquidity Engine (JVP): operator-run for four partner tokens, paused since 2026-09-05; the
  public read-only dashboard at `/liquidity-engine`.
- Telegram and X automation, Normie Quest (separate product, not part of the entry), the Seeker
  dApp Store wrapper, CI with the visual gate and the decision simulator.

## Shipped between the first draft of this file and the snapshot

All of the following are **pre-window** and covered by the baseline above. Listed separately
because they landed after this file was first drafted and must not be mistaken for in-window work.

On `main`:

- Store edition, the education-only Google Play / iOS bundle: #288, then 1.0.1 #291,
  1.0.2 #292, 1.0.3 #296 (Concierge landing, Ask Cluck first, graceful web pointers).
- Store edition legal pages `/privacy/store` and `/terms/store`: #290.
- Store edition release workflow, a manual `workflow_dispatch` run that creates the release tag
  at a named `main` commit: #289.
- CUNA drawing entry registry on the lock host, and its owner-only delete: #286, #287.
- Buy competitions: pinned pools and sell detection across any pool vault #280; transfer-out
  during the hold disqualifies, and percentage prizes are a percentage of tokens bought #294.
- Buy bot: split routes summed across pools, Meteora DAMM v2 vault authority #285.
- Retired-feature sweep: prize wheel page and route deleted, historical diploma relabelled #297.

On `develop`, merged before the window and **not yet promoted to `main`**:

- Hackathon batch 2: Liquidity Engine dashboard, Lock of Fame index, quiz-free syllabus,
  project-team navigation: #282.
- Tools pass hardening, Codex rounds 1 to 4: single-use server challenges, pay intent, paid-pass
  recovery, attempt made durable before broadcast: #284.
- CI: push runs gated by the pushed diff: #293.
- Docs: Colosseum window roadmap revision 2, Project Hub design Addendum B: #295.

**On #282 specifically.** It was merged to `develop` on 2026-09-12 as pre-window work and is
disclosed as such here. Promoting it to `main` after 13:00 UTC is a deployment of pre-window
code, not the creation of new work, and it is not claimed as in-window.

## Built inside the window (filled in as it ships; each line links a PR merged after Sep 14)

Grouped by area; every promotion of `develop` → `main` (owner's explicit go, per CLAUDE.md) is the
release mechanism for the feature/fix PRs below it and is not listed as a separate line.

### Project Hub / Lock to Earn — the entry

- **Colosseum roadmap revision 3, and the entry stated publicly** — judging criteria read
  directly from Colosseum rather than from a summary; traction (W9) and weekly updates (W10)
  added as workstreams; the dry-run project decision promoted to a dated blocker; a real-wallet
  smoke pulled forward out of the rehearsal; README and `/about` updated to state the entry and
  link this disclosure. PR #299.
- **Official Rules PDF read in full** — the contest window corrected by two hours (opens 13:00
  UTC, not 11:00; no in-window PR is affected — the earliest, #298, still lands after 13:00), and
  the six real judging criteria recorded from §8 (open-source and composability are scored; the
  "Traction" language the team had been optimising for is website-only, not in the contract). PR #302.
- **Submission copy as entered** — the Colosseum form's fields captured verbatim in
  `docs/COLOSSEUM_2026_SUBMISSION.md`, and README + `/about` updated to the final project name and
  description. PR #303.
- **CUNA lock-scan reliability** — Helius began refusing a plain `getProgramAccounts` on the
  Jupiter Lock program as CUNA's escrow count grew, silently skipping an hour of lock-to-earn
  accrual; the scanner now walks `getProgramAccountsV2` pages first and never writes a partial
  day. Fixes a reliability gap in the **pre-window CUNA lock-to-earn handler** that the Hub's
  engine (below) later generalises. PR #306.
- **Project Hub W1 core** — the pure settlement library the Hub is built on: project records,
  program versions with hashes, the ledger partition (accrued/available/reserved/paid), public
  eligibility reason codes, and the payout attempt state machine. No routes yet; **CUNA migrates
  onto the store by aliasing its existing kv keys**, so the pre-window CUNA ledger becomes the
  first Hub-shaped ledger. PR #307.
- **Hub Addendum C — teach the button before you offer it** — derives the six answers a holder
  should have before locking (what happens to my tokens, can I sell, where the reward comes from,
  the risks) purely from the program's own data; no project-authored copy can reach the page and
  no APR/APY figure can ever be produced. Adds a `#lesson=` deep link to the school. PR #308.
- **The public Project Hub, and lock-to-earn pays itself** — `/hub`, `/hub/:project` and receipt
  pages render what a project promised, who qualified, and the transaction that paid each winner,
  with no wallet needed; and the **pre-window CUNA lock-to-earn payout** gains a server-signed
  send that journals every row pending before broadcast and verifies the write to disk before it
  counts. PR #315.
- **Vault dry-run serialisation fix** — the first lock-to-earn server-send dry run on production
  crashed trying to serialise a BigInt to JSON; nothing moved. PR #317.
- **Hub page scoping + honest "owed"** — a project's Hub page had mixed every program together and
  listed 21 buy-comp winners settled before the Hub existed as "owed" with no real debt behind it;
  now one program renders per page, and the CUNA lock site (holder-facing) shows every payment
  received and days left on each lock. PR #319.
- **Lock to Earn engine, generalised** — lifts the machinery that has run **the pre-window CUNA
  lock-to-earn program** since launch (accrual, arm/disarm, lock scanning, holder view) into a
  project-agnostic library any Hub project can use; CUNA's own 68 rule tests pass unchanged
  against the generalised version. PR #321.
- **Per-project Lock to Earn routes + platform access tiers** — the generalised engine (#321) gets
  an HTTP surface (admin, holder view, payout, a 10-minute scheduler) so a second project can be
  armed and paid without touching CUNA's legacy loop; access tiers (standard / small / comped)
  priced live in SOL or CLKN. PR #322.
- **Platform access payments** — a project pays its monthly access tier in SOL or in CLKN priced
  at the instant of payment, verified on-chain before the paid period extends. PR #323.
- **Self-serve onboarding** — `/hub/apply` lets a project submit its mint and terms for owner
  approval (validated exactly as approval validates, so a broken draft is refused up front), and
  `/hub/:project/pay` lets it pay its first month from its own wallet. PR #324.
- **The project desk** — an operator wallet listed on the project record signs a one-line nonce to
  get a scoped session and runs its own Lock to Earn program (terms, arm/disarm, batches signed in
  its own wallet) without the owner in the loop; editing the operator list revokes the session
  immediately. PR #325.
- **CUNA-onto-the-engine migration held** — the dedicated pre-window CUNA payout handler stays as
  the live path for now; owner decision 2026-09-16 to defer folding CUNA onto the new engine
  (Phase 1b). Docs only, no code change. PR #326.

### Payouts and money-path hardening

- **Buy-comp hold check: a lock is not a sell** — a Jupiter Lock escrow is a PDA and therefore
  off-curve, so the hold check scored every lock as a pool sale and would have disqualified any
  entrant who locked their bag during a competition window. Destinations are now resolved to
  their owning program and classified three ways. PR #298.
- **`/api/buycomp/send` — server-signed payout** — a verified buy-competition winner list can now
  be paid directly from the operator's own key on Railway instead of pasted into the browser
  airdropper; recipients can only come from the comp's own sealed list, and every transfer is
  journalled before it counts. PR #311.
- **Payout hardening** — four blockers a second reviewer found before the first live server-signed
  send: the cap check now replays the sender's own arithmetic instead of a rounded total (the
  rounded total had refused a real payout that was actually under cap), a row is journalled
  pending before broadcast instead of after (closing a double-pay window on a timeout), "not found
  after 5 minutes" no longer voids a row that may have actually landed on a lagging RPC, and a
  journal write is verified on disk before the batch continues. PR #313.

### School and education

- **Report card links to a real tool and a Library piece** — every core lesson's report card now
  points at the tool that shows its concept live and the Library piece that goes deeper, plus a
  `/school#library=` deep link and a `quiz_start` event to see where lesson 1 loses people. PR #309.
- **Honest visitor counting** — the school's page-view figure had been counting roughly 4,500/day
  of one-page, no-referrer automated traffic since 2026-08-16 that was about to be quoted to
  judges; analytics now report "engaged" visitors (a second page or a learning-funnel event)
  alongside the raw counts, and split views by host so the game's and staking site's traffic stop
  landing in the homepage's numbers. PR #310.
- **School Q&A + LP Lab audit** — all 189 quiz questions and the 14 LP Lab lessons checked against
  how Orca, Raydium CLMM, Meteora DLMM and DAMM v2 actually work; fixed a ticks-vs-bins confusion,
  a DAMM v2 mislabel (called concentrated liquidity; it is the dynamic-fee constant-product AMM),
  an MEV understatement, and a tick-spacing mismatch, with the corrected strings re-keyed in all
  seven languages. PR #328.

### Security deep dive (2026-09-17)

- **Platform deep dive, P0 batch** — a 32-finder review surfaced 152 unverified findings; the 12
  P0s were hand-verified and nine confirmed. Closed: mutating admin GETs that could draw a
  giveaway, send prize tokens, move Meteora liquidity or arm an engine from a pasted link; the
  tools pass enforced server-side on Buy Special's data endpoints (the page's own gate had been
  theatre); a corrupt kv file no longer boots as an empty, healthy-looking store; and Hub access
  payments bound to the paying wallet. PR #329.
- **Platform deep dive, P1 batch + Codex round 1** — eleven more confirmed findings plus nine
  issues Codex found in #329 itself, fixed together: engines can no longer re-arm themselves from
  an environment variable after a bad kv mount (the kv arm key is now the only switch for
  cuna/dnc/rose); a payout row is only recorded against a real, matching on-chain transfer; the
  same payment signature could no longer unlock both a Hub month and a tools pass; and more admin
  GETs (`x-announce`, `x-post-test`, classroom actions) became POST-only. PR #330.
- **Owner decisions, 2026-09-17** — every graduation-gate block is now journalled with a reason a
  learner can act on instead of one generic message; `/api/tg-test` made POST-only; a new test
  boots the real server three times to prove no engine re-arms from an environment variable; and
  several behaviour-preserving refactors (one admin-guard middleware, one Telegram send helper,
  shared ratchet/cursor logic). PR #333.
- **Codex round 2 on #333** — four more fixes before promotion: a learner could get stuck because
  only a lesson's *first* pass counted toward the anti-farm timing check (a genuine later re-pass
  now counts too); the offline beacon retry queue could drop entries before they were confirmed
  sent; a failed Telegram treasury recap was silently reporting success and advancing its
  snapshot; and a short Telegram upload was misrouted to the wrong send path. PR #334.
- **OnlyRose room lockdown** — a disarmed buy bot's plain status-check GET had been running a full
  poll and replayed a backlog of old buys into the room in a row; the flag-less GET is now a pure
  status read (the poll needs an explicit `POST ?run=1`) and both buy bots skip anything older
  than 15 minutes after a pause. Separately, every Telegram send in the app now passes through one
  policy point that refuses any post to the OnlyRose room by default, closing a class of leaks
  patched individually three times this month. PR #338.

### Operations / hygiene

- **Colosseum batch 14** — the four P1s from the public-surfaces lens closed with regression tests
  (`/hub/verify` refuses receipt URLs from any origin but our own; amounts in token units; the
  heaviest Hub reads rate-limited with a bounded wallet-lookup cache; `/api/track` no longer mints
  per-project keys for unknown ids); `/hub/glossary` — every term and reason code from one source
  in seven languages, with a drift test; a load proof for the public reads (fixture generator,
  `scripts/hub-load-smoke.cjs`, before/after numbers in `docs/HUB_LOAD_2026-09-18.md`, a reduced
  run in CI); the validation doc filled from milestone timestamps; and preview-before-publish on
  the operator desk — a draft's terms run through the same validate/version/accrue code the real
  publish uses, showing who would qualify today, with nothing written. PR #352.
- **The settlement journal as the live payout path (#342, the W3 integration gate)** — on its
  own PR because it is a money path: journal-first settlement with exact-amount matching (a
  transfer settles a row only when its amount equals what the row is owed), the transfer source
  bound to the funding wallet or an owner-set allowlist, cross-project reuse and future block
  times refused, per-project locks and per-transfer keys, one summary alert per request, the
  holder view and the desk reading the same journal, "paid from" on receipts, reserved project
  ids in one list, an owner-only waive for partial rows. Five read-only verification rounds
  (`docs/HUB_JOURNAL_VERIFY_2026-09-18.md`) and five fix rounds before it merged; 84 route
  cases. PR #342.
- **Colosseum batch 13** — follow a project without a wallet (a JSON Feed and an RSS feed per
  project: versions published, batches settled with their reproducibility ratio, holder snapshots,
  observed commitments, from the public view only); Arena drafts round 3 and weekly update #2
  filled from the record; a receipt you can print, with a QR of its public URL from a
  from-scratch encoder; a read-only adversarial pass over every public surface added since batch 9
  (no P0, four P1 — the fixes follow on batch 14); roadmap Extension 9. PR #351.
- **Colosseum batch 12** — `/hub/verify` in seven languages (and the dictionaries served on a
  no-build boot, which had silently left every Hub page in English there); the evidence bundle's
  program version made recomputable (the public view had dropped eight hashed fields, and a served
  `$schema` was being hashed — both found by the docs pass and the new tests); what changed between
  two program versions at `/hub/<project>/programs/compare`, computed in the browser from the two
  public documents; reproducibility over time as a daily append-only hashed record with a
  sparkline; the receipt verifier as a standalone `npx` package built deterministically from the
  repo's own libraries (publishing pending the owner); roadmap Extension 8. PR #350.
- **Colosseum batch 11** — `/receipt <signature>` in Telegram: the reproduce verdict for a Hub
  settlement, composed from the same public receipt view, silent, with the OnlyRose refusal pinned
  by a test that calls the real room policy; the receipt lesson measured (per-lesson reads and the
  finish card's click-throughs counted per day, nothing identifying a learner) and, found on the
  way, the Google Play bundle stripped of Hub strings that had ridden in through the shared
  dictionaries; the holders page in the accessibility gate, with the history and compare panels
  unhidden on a shared snapshot link; the Codex reviewer brief through batch 10, the reviewer's
  path in `HUB_VERIFY.md`, fourteen reference captures of the new pages; roadmap Extension 7.
  PR #349.
- **Colosseum batch 10** — one wallet across every project (`/hub/wallet/<address>`: what each
  program qualified or excluded it for, each receipt with its settlement signature, owed against
  arrived); the evidence bundle (one downloadable JSON per settled batch with a canonical hash, and
  `/hub/verify` accepts it in one move — a hash-stability bug found and fixed on the way); the holder
  snapshot diff over the recorded top holders, labelled as such; the judge's fifteen minutes
  (`docs/JUDGE_GUIDE.md` rendered into `/hub/judge`, every URL link-checked on a no-build boot);
  `/hub/trust`, what the Hub does not prove, in seven languages with a doc-drift test; the Live
  Classroom's curriculum regenerated from the real sources after three months stale, with a
  freshness check in CI; a reproducibility badge computed from the record; roadmap Extension 6.
  PR #348.
- **Colosseum batch 9** — `/hub/verify`: the pure reproduce + schema-validate core bundled for
  the browser, so a holder re-derives a receipt's amount on their own machine, offline once loaded,
  with a test that the browser bundle and the Node script agree on every fixture; the 15th school
  lesson, "Read a payout receipt", in seven languages, ending on the demo receipt; server-rendered
  Open Graph cards on every Hub page (one static image, DRY RUN named in the description where it
  applies); the weekly update built from `git log` rather than memory, update #1 regenerated and
  Arena drafts round 2 (all held until promoted); `/hub/status` with `GET /api/build` (what is
  live, where, how reproducible, which commit); ETags, cache tiers, rate limits and parameter shape
  checks on the new public reads; roadmap Extension 5. PR #347.
- **Colosseum batch 8** — the phone and accessibility pass on the public Hub pages with a CI gate
  (and the no-build-boot fix it exposed: the sitewide nav, i18n, read-aloud and theme files now have
  explicit routes); the demo storyboard with 22 real captures (`docs/DEMO_STORYBOARD.md`'s own
  inventory count, grown since first written — see that doc's "Capture inventory" table);
  Launch Readiness (Addendum A: a
  derived checklist and reward-budget planner, and a known funding shortfall can no longer be armed);
  airdrop per-drop receipts with every row verified against the chain, including the transfer's
  source; the public Buy Special standings and hold-through proof (sealed lists hashed, unsealed
  boards never exposed, the payout split extracted to one pure function); the Codex reviewer brief
  caught up and `docs/HUB_VERIFY.md` for judges with a doc-drift test; buy-comp rows counted in the
  reproducibility ratio; the new surfaces in seven languages; the engine timeline with decision
  replay against the pure gate; append-only hashed holder snapshots; a per-install analytics salt;
  the pitch and demo scripts to the second. PR #346.
- **Colosseum batch 7** — W9 part 2, real usage without a single automated post: a "see how a
  project's rewards are actually paid" door on the school landing and every lesson's finish
  screen → `/hub/demo` (folded out of the store edition), a second line under the homepage's
  project tile → `/hub`, both counted per day with their own page views as the denominator in the
  traction report; Telegram invitation drafts for the four partner projects the owner sends by
  hand; a note on the one-line lesson-tweet CTA change that stays the owner's call. PR #345.
- **Colosseum batch 6** — the W6b validation kit: `docs/VALIDATION_2026-09.md` (the
  founder-operated / dry-run / independent rule applied per partner project, interview records,
  the consented POKEAHOE dry-run pilot timeline, every number and quote left to be filled) and the
  20-minute operator interview script; the submission's traction section cites it. Docs only. PR #344.
- **Colosseum batch 5** — the truth pass: README, `/about` and the submission document brought back
  in step with the code after batches 2–4 (the Hub's live surfaces listed as they are; what is not
  yet true stated plainly — the program hash is server-served until a program is committed
  on-chain, and the settlement journal is on its own money-path pull request). PR #343.
- **Colosseum batch 4** — the school → Hub bridge (the six lock lessons end on a "Ready to lock?"
  card that carries the project the learner came from; an anonymous, deduplicated
  lesson-read counter shows on a project page only when it is above zero); the independent
  on-chain commitment of a program-version hash (Addendum B §B5: the desk builds an unsigned
  memo transaction, the funding wallet signs it, the server observes the memo on-chain before it
  writes the commitment — shipped dry-run until the owner signs the first one, and the public
  wording only upgrades on observation); Hub pages in all seven languages with a CI coverage
  gate, plus the floating-pill overlap fix on the Hub pages. PR #341.
- **Colosseum batch 3** — the school is genuinely seven languages (the two lessons missing from
  six dictionaries translated, and CI now fails on any lesson missing from any language); the
  public engine dashboard separates three evidence classes that never mix (historical transfers,
  retained decision events, illustrative simulator runs) and surfaces the discarded-counter flag;
  reproduce-a-receipt (`scripts/reproduce-receipt.cjs` re-derives a payout from the published
  inputs on the reader's machine; every program page states "N of M receipts reproduce"); the
  `/hub/demo` no-wallet walkthrough on a labelled dry-run fixture derived by the real libs; the
  settlement library's public contract (`lib/hub/README.md` + JSON Schemas served at
  `/hub/schema/*.json`); receipts that explain their own number with the ledger's own functions;
  the operator onboarding clock; POKEAHOE seeded as a labelled dry-run second project with
  project-provided branding; Arena and X post drafts. PR #340.
- **Colosseum batch 2** — the disclosure file caught up to every in-window PR; the roadmap
  extension §7 (E1–E9: reproduce-a-receipt, the no-wallet `/hub/demo` walkthrough, on-chain
  commitment of the program hash dry-run first, the settlement library as a schema'd public module,
  receipts that teach, the school→Hub bridge, the operator onboarding clock, Hub pages in seven
  languages, Arena cadence); the `/for-projects` guided front door with a per-mint checklist over
  the public feeds; `lib/traction.js` outcome counters derived from durable stores with an
  owner-only read endpoint and a reproducible report script (honest zeros: Hatchery fee revenue is
  not reproducible, and the journal/attempt counters read 0 until the settlement journal is wired
  into the live payout route); the Sep 20 weekly-update script. PR #339.
- **Whole-repo simplification pass** — consolidated the address regex, the Node-side HTML escaper
  (fixing a missing single-quote escape on token-metadata-derived HTML the same drift class
  CLAUDE.md already documents), and the RPC client to one memoised instance per endpoint;
  behaviour-preserving only, with money-path and owner-call items explicitly left for separate
  review. PR #331.
- **`/api/meme-queue` made POST-only** — the last GET-only admin mutation on the surface; the meme
  routine now POSTs its write. PR #336.
- **Traction claim corrected to on-chain-only numbers** — the submission's judges note and
  traction table stopped citing the 161k-page-view figure once it was traced to the same automated
  one-page traffic PR #310 later fixed in the analytics, and now cite on-chain graduate counts and
  the 90-day funnel instead. Commits `a28a471` and `f9ee792`, both 2026-09-15 — docs only, no PR
  number, reviewed like code because the claim was public.

**On the Store edition iOS release specifically.** `store-ios-v1.0.3` was published 2026-09-18,
inside the window, but points at the exact same commit (`dd115d2`, PR #296, 2026-09-13) as
`store-google-v1.0.3`, published pre-window on 2026-09-13. It is a re-publication of pre-window
code to a second distribution channel, not new work, and is **not** claimed as hackathon work
despite its publish timestamp falling inside the window.

## How to read the delta

The scored delta is everything after the two snapshot commits above.

```
git log 75b69cc..origin/main
git log 41d0a6a..origin/develop
```

Nothing in the pitch, the demo or the submission that predates those commits is presented as
hackathon work. Where an in-window feature builds on a pre-window component, the pre-window part
is named in the disclosure line for that feature.
