# Colosseum weekly update #1 — Sunday 2026-09-20 (W10)

Colosseum strongly recommends a ~1-minute video each week on what shipped and what was hard.
This is the founder's script for update #1, covering **Sep 14 13:00 UTC → Sep 20**.

Refreshed again 2026-09-20 with `node scripts/weekly-update-draft.cjs --from 2026-09-14 --to
2026-09-20` (raw: `docs/weekly-update-raw-2026-09-20.md`) after the overnight promote. Previously
refreshed 2026-09-19 with `--to 2026-09-19` (Colosseum roadmap §10 Z1 — the shipped list is a run, not a rewrite) and reconciled
by hand for prose and grouping; the script's own labels (production vs. staging, PR numbers) were
kept as-is, not retyped. Raw output: `docs/weekly-update-raw-2026-09-19.md`. This is the
night-before refresh the roadmap calls for, so the list below is complete through PR #357. **If
anything merges between now and the recording, re-run with `--to` set to that day** — the shipped
list is only as current as its last run.

Rules for the recording (from `docs/COLOSSEUM_ROADMAP.md` §W10 and CLAUDE.md): phone, one take,
no slides needed; name what shipped with a link; "Earn" is capability, never a promise; nothing
about Normie Quest prize terms; nothing about Wallet Watch; no APR/APY figures anywhere.

✅ **What you can show on camera — re-checked against production 2026-09-20 06:5x UTC, by
content and not by status code.** The owner said "send it all live" overnight, so `main` is now at
**PR #381** and **everything below is on production**. Each of these was fetched and its real
`<title>` confirmed, not just its HTTP status (the catch-all serves the React shell at 200 for an
unknown path, which is why a status check is not a check here):

| URL | serves |
|---|---|
| `/hub` | Project Hub — receipts you can verify |
| `/hub/demo` | Demo Community — Hub demo walkthrough |
| `/hub/glossary` | The Hub Glossary |
| `/hub/verify` | Reproduce a Hub receipt |
| `/hub/status` | Hub Status — what is live, where |
| `/hub/trust` | What The Hub Doesn't Prove |
| `/hub/judge` | The Judge's Fifteen Minutes |
| `/hub/apply` | Run Lock to Earn for your token |
| `/solana` | The Solana Room (all ten pages) |
| `/for-projects` | For Projects |

So the two options the earlier draft laid out — record against staging, or promote first — are
**settled**: you promoted, and every URL on camera is one a judge can open.

Do not point the camera at a production URL for a page that is not there.

## The three bullets (≈55 seconds spoken)

1. **What shipped.** "Week one of the Project Hub is live at clucknorris.app/hub. A token project
   can now publish a lock-to-earn program with versioned terms, holders can see exactly why they
   qualify or don't, and every payout is a receipt with the transaction that paid it — no wallet
   needed to check. Projects onboard themselves at /hub/apply, pay their month from their own
   wallet, and run their own program from a desk their operator wallet signs into. On staging, not
   live yet: a holder can now reproduce their own receipt from the published numbers — on their own
   machine, or right in the browser — a no-wallet walkthrough of the whole flow, an on-chain
   witness for a program's terms (dry run until the owner signs the first real one), the Hub in
   all seven languages, a launch-readiness checklist before a project can arm, public receipts for
   airdrops and Buy Special standings with hold-through proof, a history of holder-count
   snapshots a reader can re-hash themselves, and a plain-language Solana reference room that
   starts with what rent actually is and why the "free SOL" posts going around are wrong."
⚠️ **Bullet 1 above still says "On staging, not live yet" — that clause is now FALSE and needs
one edit before you speak it.** Everything it lists (reproduce-your-own-receipt, the no-wallet
walkthrough, the on-chain witness, the Hub in seven languages, the readiness checklist, airdrop
and Buy Special receipts, the snapshot history, and the Solana reference room) shipped to
production overnight. The fix is to drop "On staging, not live yet:" and say it all as live. Left
for you to reword rather than rewritten here — it is your script and your voice, and this is the
one sentence on the page a rewrite could put words in your mouth.

2. **What was hard.** "Money paths and their own review. A second AI reviewer found four blockers
   before our first server-signed payout — a rounded total that refused a real payout, a
   double-pay window on a timeout — and a platform-wide security pass closed nine P0s, including
   admin links that could have moved liquidity or paid a giveaway from a pasted URL. A day later a
   disarmed buy bot's own status check turned out to still run a full poll and replayed a backlog
   of buys into a partner's Telegram room in a row — fixed the same day, and every Telegram send in
   the app now goes through one policy point instead of relying on each call site getting it right.
   None of that is visible on a demo, all of it is the reason a holder can trust the receipt."
3. **What's next.** "Getting the reproducibility work off staging: the owner's explicit promote
   is still the gate, never automatic. Then the first real on-chain commitment (the owner's
   signature), POKEAHOE's terms as our second project, and the operator console end to end on a
   phone with a real wallet."

## Shipped this week (paste-ready, with links)

**Production today (`main`, PR #381 — refreshed 2026-09-20):** Hub W1 core — project records, program versions with
hashes, ledger partition, settlement journal (#307); Addendum C, the six answers a holder needs
before locking (#308); public Hub pages + receipts, lock-to-earn pays itself, server-signed and
journalled before broadcast (#315, #319); buy-comp server payout (#311) and four reviewer
blockers fixed before it shipped (#313); a lock is not a sell (#298); report cards link to a real
tool (#309); honest visitor counting (#310); the CUNA lock-scan reliability fix (#306); the vault
BigInt serialisation fix (#317); the Colosseum entry stated publicly and the Official Rules
correction (#299, #302, #303).

> ⚠️ **This partition was rewritten on 2026-09-20.** When this doc was drafted, `main` sat at PR
> #337 and everything below the line was staging-only. The owner promoted overnight, so the list
> that follows is now **on production** — every URL in it was re-checked by content, not by status
> code. Only two things remain on staging and they are named at the end.

**Promoted to production overnight (was "staging only" when this was drafted):**
- **Project Hub, generalised:** the Lock to Earn engine lifted to any project, per-project routes
  and a 10-minute scheduler, platform access tiers priced live in SOL or CLKN, self-serve
  `/hub/apply` and pay page, the operator desk with a wallet-signed session — #321, #322, #323,
  #324, #325 (CUNA-onto-the-engine migration held by owner decision — #326).
- **Colosseum roadmap extension, batches 2–8** (#339, #340, #341, #343, #344, #345, #346):
  `/for-projects` front door and traction outcome counters; reproduce-a-receipt on the reader's
  own machine and the live "N of M receipts reproduce" line (now covering buy-comp rows too); the
  no-wallet `/hub/demo` walkthrough on a labelled dry-run fixture; the settlement library
  published as a schema'd public contract; receipts that explain their own number; the operator
  onboarding clock; Hub pages in all seven languages; the school→Hub bridge and lesson-read
  funnel; the on-chain program-hash commitment (Addendum B §B5, dry run until the owner signs the
  first real one); the public engine dashboard's three separated evidence classes, now with a
  merged, replayable timeline; Launch Readiness (Addendum A) before a program can arm; per-drop
  airdrop receipts checked against the chain; the public Buy Special standings + hold-through
  proof page; append-only hashed holder-count snapshots; the W6b validation kit and operator
  interview script; an accessibility pass on the public Hub pages with a CI gate; `HUB_VERIFY.md`
  for judges.
- **Colosseum roadmap extension, batches 9–12** (#347, #348, #349, #350 — merged 2026-09-18, after
  this file's first draft): reproducing a receipt directly in the browser at `/hub/verify`,
  offline-capable once loaded; a seventh school lesson, "Read a Payout Receipt"; server-rendered
  share cards on every Hub page; this weekly-update script; `/hub/status` + `GET /api/build`;
  route hygiene on the new public reads; `/hub/wallet` (one address, every project it's touched);
  a downloadable evidence bundle for offline reproduction; a diff between two holder snapshots;
  `/hub/judge`, generated from `docs/JUDGE_GUIDE.md`; `/hub/trust`, the plain-words trust boundary,
  now in seven languages; a real bug fixed in the Live Classroom's curriculum generator (it had
  been silently dropping two whole courses since an earlier refactor); an embeddable
  reproducibility badge; a `/receipt <signature>` Telegram command; the receipt lesson's own
  read/click counts; an accessibility gate on five public Hub pages (and a real hidden-panels bug
  it caught on the holders tool); `/hub/verify` in all seven languages, plus a real bug fixed in
  the evidence bundle's program-version hash check that made a correct bundle print a false
  mismatch; a field-by-field compare between two program versions; a daily hashed history of the
  reproduce ratio; and the reproducer packaged as a standalone `npx` command — not yet published
  to the npm registry, which is the owner's own act. Arena/X drafts for all of the above:
  `docs/ARENA_POSTS.md` round 3.
- **Colosseum roadmap extension, batches 13–18** (#351, #352, #353, #355, #356, #357 — merged
  2026-09-18, after the previous refresh): following a project without a wallet, as a JSON Feed
  and an RSS feed of versions published, batches settled, holder snapshots and observed
  commitments; a receipt you can print, carrying a QR of its own public URL; a read-only
  adversarial pass over every public Hub surface built since batch 9, and the same-day fix round
  that closed all four of its P1 findings with regression tests; `/hub/glossary`, every term and
  reason code the receipts and the wallet view use, from one source, in seven languages, with a
  test that fails if a code exists without an entry; a load proof for the public reads, with
  before-and-after numbers and a reduced run in CI; preview-before-publish on the operator desk,
  so an operator can see who a draft's terms would pay today before anything is written; docs
  drift round 4 and the second half of the demo storyboard with fourteen fresh captures; the
  POKEAHOE dry run walked end to end with the dry-run flag kept on, written up with what confused
  and the exact sequence for a real go; the pitch and demo scripts re-timed to the final surface
  set with a one-page click sheet for the recording; and the desk fixes that rehearsal turned up.
  Arena/X drafts through batch 12 are in `docs/ARENA_POSTS.md` round 3; batches 13–18 are not
  drafted yet.
- **School:** the Q&A + LP Lab audit against how Orca, Raydium CLMM, Meteora DLMM and DAMM v2
  actually work, with the corrections re-keyed in all seven languages — #328; the last GET-only
  admin mutation (`/api/meme-queue`) made POST-only — #336.
- **Security:** the platform deep dive — 9 confirmed P0s (mutating admin GETs that could draw a
  giveaway, move liquidity or arm an engine from a pasted link) and 11 more P1s plus a Codex round
  — #329, #330; the owner-decisions batch (graduation-gate blocks now journalled with a reason a
  learner can act on, `/api/tg-test` made POST-only) and a second Codex round — #333, #334; the
  **OnlyRose room lockdown** — a disarmed buy bot's plain status GET turned out to still run a full
  poll and replayed old buys into the room; every Telegram send in the app now passes through one
  refusal point for that room by default — #338.
- **Whole-repo simplification pass** (one address regex, one HTML escaper, one memoised RPC
  client) — #331.

**Open, not yet merged, as of this refresh (2026-09-19):** one pull request — #354, the
browser-signed payout. It is a money path, so it is held to the two-lens rule: three review rounds
and three fix rounds so far, CI green, and it does not merge while a lens still reports an open
finding. It is deliberately absent from the shipped list above, because it has not shipped.

Everything else in this window is merged **and, since the overnight promote, on production**:
`main` is at PR #381 and `/api/build` reports `eef0f11`. The only exceptions are the two staging
items named further down (#376, #382).

- **Batches 19–21 (#358, #360, #361, #362, #363, #364, #365 — merged 2026-09-19, after this
  file's night-before refresh):** the Solana Room — `/solana` and `/solana/rent`, a plain-language
  explainer of Solana's rent-exempt deposit that says plainly it is **not** an airdrop, separates
  closing an account from withdrawing the surplus, and carries a scam warning because "claim your
  free SOL" sites are already appearing; `ARCHITECTURE.md`, which writes down the platform/apps
  repo boundary; and the first two increments of a **native Solana Mobile app** — a fourth store
  build variant, a phone-first shell, a Mobile Wallet Adapter-aware wallet layer, and the read side
  of Rent Reclaim (#367, open). Research and decision docs for that track: #360, #361, #364.

**Still on staging only (`develop`), not promoted:**
- **Follow a wallet** — `GET /api/hub/wallet/:wallet/feed.json` (JSON Feed) and
  `GET /hub/wallet/:wallet/feed.xml` (RSS) across every project a wallet appears in, plus the
  follow link on `/hub/wallet/<address>` (#376).
- **The homepage in six languages** — twenty of the front door's visible strings were in no
  dictionary at all; now curated and gated so they cannot drift back (#382).

**Also shipped overnight, after the promote, and worth a sentence if you want one:** the whole
Solana Room went live — ten plain-words pages on how the chain actually works, free and with no
wallet (#362, #371, #373, #375) — the school gained a sixteenth lesson on the rent deposit (#374),
the room got its own tile on the homepage (#378), and a nav rule that had been hiding **every
section back link on the site**, including on all nine Project Hub pages, was found and fixed
(#380). That last one is the honest "what was hard" material: the links were present, correct and
rendering at zero height, so a source scan said the markup was perfect and only measuring the
rendered page showed it.

## Where to post
Colosseum Arena (the project's update thread) and X from the CLKN account (X Premium, no 280 limit).
The pre-window disclosure line, if asked: "everything before Sep 14 13:00 UTC is listed in
docs/PRE_EVENT_STATE.md in the repo."

## Refresh on Sep 19 checklist (before recording)

Confirm these before finalizing the script and picking the demo URL to show on camera. Don't
assume from this file — re-check on the day.

- [x] **Done 2026-09-19.** Re-ran `node scripts/weekly-update-draft.cjs --from 2026-09-14 --to
      2026-09-19` and diffed it against "Shipped this week": batches 13–18 (#351–#357) were
      missing and are now listed.
- [x] **Done 2026-09-19.** `git log origin/develop` confirms every PR named above is merged;
      `develop` is at #357. The re-run surfaced #351–#357.
- [x] **SUPERSEDED 2026-09-20.** The 09-19 entry said "`main` is still at PR #337 … every
      Colosseum roadmap extension item is on staging only." **That is no longer true.** The owner
      promoted overnight ("send it all live", then two more gos), `main` is at **PR #381**, and
      `/api/build` reports `eef0f11` on `main` in production. Verified by content, route by route
      — see the table at the top of this file.
- [x] **Demo URL settled by the promote.** Show `clucknorris.app/hub/demo` (the no-wallet,
      DRY-RUN-labelled single-holder walkthrough) and `/hub/verify` — the cleaner demo surface,
      neither needs a wallet on camera, and both are now live. `clucknorris.app/solana` is also
      available if you want a second, purely-educational surface with nothing to connect.
      Never show a `develop`/staging URL as if it were the live product — the only two things
      still on staging are the wallet feeds (#376) and the homepage translations (#382).
- [ ] Re-read `docs/ARENA_POSTS.md`'s status table immediately before posting anything from it —
      it is a snapshot from 2026-09-18 and is now well behind: it stops at batch 12, and
      everything through #382 has since merged, most of it to production. **Do not paste from it
      without re-checking each line against production first.**
- [ ] **Demo captures:** `docs/DEMO_STORYBOARD.md` is the shot-by-shot demo script and the pitch
      outline, with real screenshots (phone + desktop) in `docs/demo/2026-09-18/`. Re-screenshot
      before the actual recording if the Hub pages have changed since 2026-09-18 — the storyboard
      links each shot to a specific file, so a stale capture is easy to spot.
