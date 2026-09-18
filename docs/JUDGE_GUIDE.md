# The judge's fifteen minutes

This is the shortest honest path through the Project Hub, organised by the six criteria
Colosseum's Official Rules §8 actually score (`docs/COLOSSEUM_2026_SUBMISSION.md`), not the
website's seven guidance headings. Every URL below is relative to `clucknorris.app` (or
`staging.clucknorris.app` — `docs/HUB_VERIFY.md` states which host has which route live today)
and needs no wallet, no login, and no key. Each step names a `scripts/` test file that pins the
exact thing it shows, so a judge (or a future session) can check the claim never quietly stopped
being true.

## Functionality (including code quality)

1. `/hub/demo/p/lock-to-earn` — a program version's terms and the sha256 hash computed from
   them sit on the same screen, so the hash is checkable on the spot rather than asserted.
   Pinned by `scripts/hub-demo-fixture-test.cjs` and `scripts/hub-core-test.cjs`.
2. `/hub/demo` — a holder qualifies under the program's own term rule, and another is refused
   with a machine-checkable reason code instead of a paragraph of excuses. Pinned by
   `scripts/hub-demo-fixture-test.cjs`.
3. `/hub/verify` — paste a receipt link and the browser re-derives the payout from the published
   inputs, with no server call once the page has loaded. Pinned by `scripts/hub-verify-page-test.cjs`.
4. `/hub/schema/receipt.json` — the exact JSON Schema a receipt's own wire shape validates
   against, served byte-identical to the file in this repo. Pinned by `scripts/hub-schema-test.cjs`.
5. `/hub/cuna/programs/compare` — two program versions diffed field by field (term, multiplier,
   eligibility rule, period, budget) in plain words, computed in the browser from the same public
   JSON the pages above already serve — nothing new on the wire. Pinned by
   `scripts/hub-compare-test.cjs`.

## Potential Impact

1. `/for-projects` — the guided front door a project team opens first: lock, apply for
   lock-to-earn, run a buy competition, airdrop, get listed right, snapshot holders, burn with a
   receipt. Pinned by `scripts/hub-apply-test.cjs`.
2. `/hub/poke` — a second, real, branded project already on the same settlement library while its
   own terms are still being agreed, labelled DRY RUN rather than hidden until it is ready. Pinned
   by `scripts/hub-brand-test.cjs`.
3. `/api/hub` — the plain JSON index of every program this platform runs today, one call, nothing
   gated behind a key. Pinned by `scripts/hub-public-test.cjs`.
4. `/hub/status` — every project's programs, receipts and reproducibility ratio in one place, next
   to the exact git commit the running server was built from. Pinned by `scripts/hub-status-test.cjs`.
5. `/api/hub/cuna/feed.json` and `/hub/cuna/feed.xml` — every program version published, batch
   settled, holder snapshot taken and commitment observed, newest first, so a project's own
   community can follow the record with an RSS/JSON-Feed reader instead of a wallet. Pinned by
   `scripts/hub-feed-test.cjs`.

## Novelty

1. `/hub/trust` — the trust boundary stated in plain words: what a hash and a receipt prove, and
   what they don't, so nobody reads more into a number than it earns. Pinned by
   `scripts/hub-trust-doc-test.cjs`.
2. `/hub/verify` — the claim other reward programs don't make: reproduce the payout yourself,
   offline once the page has loaded, from data anyone can fetch on their own. Pinned by
   `scripts/hub-verify-page-test.cjs`.
3. `/hub/demo/r/rcpt-a` — a receipt that names the rule it was paid under, not just a number.
   Pinned by `scripts/hub-demo-fixture-test.cjs`.
4. `/hub/schema/program-version.json` — a program's terms are a versioned, hashed, schema'd
   record, not a pinned message a team could edit quietly later. Pinned by
   `scripts/hub-schema-test.cjs`.

## UX for downstream users

1. `/hub/wallet/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS` — one address, every project's
   eligibility, no wallet connect and no hunting project by project. Pinned by
   `scripts/hub-wallet-test.cjs`.
2. `/hub/demo` — the whole loop end to end — program, eligibility, funding, batch, receipt,
   reproduction — walked with no wallet at all. Pinned by `scripts/hub-demo-fixture-test.cjs`.
3. `/for-projects` — a project operator's own path onto the platform, in plain language, before a
   wallet or a payment is ever asked for. Pinned by `scripts/hub-apply-test.cjs`.
4. `/hub/trust` on a phone — tap targets, heading order and no horizontal scroll on the page a
   judge is most likely to open on a phone first. Pinned by `scripts/hub-a11y-test.cjs`.
5. `/hub/demo/r/rcpt-a?print=1` — the same receipt rendered as one printable page: the amount, the
   rule, the settlement signature as text and as a QR code, and the trust-boundary line, so a
   holder can keep a paper copy without needing this site again. Pinned by
   `scripts/hub-print-test.cjs`.

## Open-source and composability

1. `/hub/schema/project-public.json` — the settlement library's public wire shapes, served at
   stable URLs a second product could validate against without reading this repo. Pinned by
   `scripts/hub-schema-test.cjs`.
2. `/api/hub/cuna/reproducibility` — a public, key-free JSON route the reproduction script and
   this page both call — one algorithm, not two that could quietly drift apart. Pinned by
   `scripts/reproduce-receipt-test.cjs`.
3. `/hub/verify` — the browser bundle is built straight from the same pure functions
   (`lib/hub/reproduce.js`, `lib/hub/schema-validate.js`) the CLI script and the server route
   share. Pinned by `scripts/hub-verify-page-test.cjs`.
4. `/hub/demo-b` — a second fixture project proves data never leaks between projects: the same
   library, fully isolated. Pinned by `scripts/hub-demo-fixture-test.cjs`.
5. `npx @clkn/hub-verify <receipt-url>` — the reproduction script packaged as a standalone command
   (`packages/hub-verify`), no clone and no build required. Built from, and byte-checked in CI
   against, the same repo script and browser bundle above — one verifier, shipped three ways, not
   three that could quietly drift apart. Publishing to the npm registry is pending the project
   owner's own go; until then it runs the same way from a git ref. Pinned by
   `scripts/hub-verify-package-test.cjs`.

## Business Plan

1. `/api/hub-pricing` — the live SOL/CLKN price a project pays for platform access, computed at
   request time rather than hardcoded into a pitch deck. Pinned by `scripts/hub-access-test.cjs`.
2. `/hub/apply` — a project can register, agree terms and pay its first month without the founder
   in the loop. Pinned by `scripts/hub-apply-test.cjs`.
3. `/hub/status` — the reproducibility ratio stated as a measured number with its denominator
   named, never polished to look complete. Pinned by `scripts/hub-status-test.cjs`.
4. `/api/build` — the exact git commit and branch behind everything above, so nothing here is a
   mockup a judge is being asked to take on faith. Pinned by `scripts/hub-status-test.cjs`.
5. `/api/hub/cuna/reproducibility/history` — the reproducibility ratio recorded daily, not just
   read fresh today, so a regression would be visible the day it happened rather than smoothed
   into a single current number. The same public reads were driven at a 50-project x 200-receipt
   load and measured against a stated latency budget (`docs/HUB_LOAD_2026-09-18.md`) rather than
   asserted to scale. Pinned by `scripts/reproducibility-history-test.cjs` and
   `scripts/hub-load-smoke.cjs`.

## What was here before the window

The school, the forensic and locking tools, and CUNA's lock-to-earn program all predate this
window and are disclosed, not claimed, as hackathon work — `docs/PRE_EVENT_STATE.md` names the two
snapshot commits (`snapshot/pre-colosseum-2026-09-14-main` and `-develop`) everything above them
was built on. The Project Hub — the settlement library, the public pages, the reproduction tooling
and the self-serve onboarding above — is what was built inside the window, on top of that platform.

## What is dry run today

Two things on the Hub are always a rehearsal, clearly labelled, and excluded from every count:
`/hub/demo` (and `/hub/demo-b`), a fixture project over made-up addresses, and `/hub/poke`
(POKEAHOE), a real branded page seeded `dryRun: true` while terms are still being agreed with that
team. Neither can be armed or paid, and neither adds to any number this guide or the submission
cites — `docs/HUB_VERIFY.md` §(f) states the rule.

## The second reviewer

Codex reviews every pull request against `docs/CODEX_REVIEWER_BRIEF.md` before it merges — a
second, independent set of eyes on the money paths and the claims above, not a rewrite.

## The glossary

`/hub/glossary` — every term and reason code the pages above use (a program's own fields, a
disqualify code, a settlement status), defined in plain English, anchorable, and linked from
wherever the code itself appears. Pinned by `scripts/hub-glossary-test.cjs`.
