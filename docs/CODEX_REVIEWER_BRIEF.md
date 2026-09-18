# Codex reviewer brief — Cluck Norris / School of Crypto Hard Knocks (2026-09-10)

You are the second reviewer on this repo. Claude (a Claude Code session driven by the owner) builds;
you review, verify and give second opinions; the owner decides. Nobody merges to `main` but the owner.

## Read first, in this order
0. `docs/COLOSSEUM_ROADMAP.md` (PR #295, 2026-09-13) — the operating plan for the window: what is
   done, the eight workstreams, the calendar, the owner's open decisions. **Your first job in the
   window is to review this plan, not code**: post findings on PR #295 (see "Round 0" below).
1. `CLAUDE.md` — the owner's decisions and the traps that already cost days. **New 2026-09-14:
   the company theme, Educate → Build → Earn**, in the mission section, with the rule that "Earn"
   describes capability and never a promise. The school does not pause for the hackathon; the Hub
   sits on top of a live school. A reviewer without it
   flags intentional things as bugs. The rules that matter most for you: docs must match the code;
   the chain shows *what*, never *why*; Wallet Watch is private (never mention it); no Normie Quest
   reward promises; admin routes that act are POST-only; `develop` is staging, `main` is production.
2. `docs/COLOSSEUM_THINK_TANK_2026-09-10.md` — the hackathon plan: eight-lens findings, the fix
   list, the two build tracks, the owner decisions still open.
3. `docs/COLOSSEUM_2026_SUBMISSION.md` — what we will tell the judges. Anything it claims must be
   true in the code.

## Where things are (updated 2026-09-13; the roadmap §0 is the live version of this list)
- **Merged to develop (staging):** PR #282 (dashboard, Lock of Fame index, syllabus, navigation),
  PR #283 (tools pass as a signed session), the store-edition batch (#288–#292), CUNA drawing
  (#286, #287). **Open:** #284 (tools pass rounds 1–3 fixes — your round-4 re-review never
  arrived; say "reviewed, no issue" or post findings), #293 (CI diff-gated on pushes), #294 (buy
  comps: transfer out during the hold = DQ; % prizes = % of tokens bought), #295 (the roadmap).
- Earlier state, kept for context:
- **Merged to develop (staging):** PR #281 — tools pass enforced server-side on the heavy APIs
  (`toolPassGate` in `server.js`, proof carried by `public/cluck-gate.js`), operator consoles no
  longer served raw, `/about` replaces the investors page, diploma NFT persisted on the credential,
  two lessons translated into six languages, copy drift fixed.
- **Open, green, awaiting the owner's merge call:** PR #282 — the Liquidity Engine dashboard
  (`public/liquidity-engine.html`, data layer `lib/jvp-dashboard.js`, routes `/api/jvp/*`), the
  Lock of Fame index (`public/lock-of-fame.html`), the quiz-free syllabus generator
  (`scripts/build-curriculum.cjs`), and project-team navigation (`public/home.html`,
  `public/tools.html`, `public/cluck-nav.js`, `src/App.jsx`).
- **Not started:** the For Projects hub, public Buy Special standings and hold-through proof,
  the lock-to-earn intake form, the airdrop receipt page, the dashboard's P1 timeline and
  simulator replay, and multi-mint lock-to-earn (design below).

## 2026-09-17 — the platform deep-dive PRs: review these FIRST, in this order

Two stacked PRs from a 32-finder / 79-verifier audit (`docs/PLATFORM_DEEP_DIVE_2026-09-17.md` — every
finding, the lens votes, and which PR fixed what). **Both merged and promoted to `main` on
2026-09-17 (#332), with your round-1 findings folded in.** A third PR, #333, followed the same
day and is **merged to `develop`, NOT yet promoted — the owner asked for your review of it after
the merge** (below, after the #330 list). Findings, not rewrites; cite file:line; say "reviewed,
no issue" when that is the answer.

**PR #329 (P0 batch, `claude/hub-public-page` → `develop`)**
1. `lib/kvstore.js` `load()` — a corrupt `app-state.json` now boots in-memory with the file preserved.
   Is there any path where a bad volume still reads as persistent? Is `setVerified` still honest?
2. `lib/hub/routes.js` `/api/hub/:project/access` POST — payer bound to `operatorWallets`
   (`access.payerAllowed`), registry-wide sig dedupe, `hub-access:` namespace checked against the
   tools-pass `sol:` namespace both ways, a store-backed per-signature lock across the chain read.
   Can one payment still buy two things, or two projects, or nothing (a stranded payment)?
3. `server.js` `/api/cuna-stake/payout` — every ledger write is `kv.setVerified` with a 500 on
   failure. Is any write site left on plain `kv.set`? (Grep `CUNA_BATCH_KV` / `CUNA_PAID_KV`.)
4. `public/cluck-gate.js` `guard()` now requires a server-issued token (`proof()`), and
   `public/buyspecial-pro.html` mounts the shared card instead of its private connect/pay flow.
   Does any tool page still grant a local pass without a token? Any page that breaks because
   `guard()` got stricter?
5. `mutatingGetRefused` coverage — `scripts/mutating-get-guard-test.cjs` pins 125 routes/flags. Name
   an admin route that still acts on a GET.
6. `lib/school-progress.js` — the backfill waiver closed two days early. Does anything else depend
   on `BACKFILL_SUNSET`?

**PR #330 (P1 batch, `claude/p1-fixes`, stacked on #329)**
1. `lib/payout-verify.js` + both `sent=` paths (`server.js` CUNA payout, `lib/hub/routes.js` hub
   payout) — a row is recorded only when the transaction's per-owner token delta for the batch mint
   covers the amount owed (0.1% slack). Attack it: a transaction that pays the wallet in a different
   mint, a Token-2022 transfer fee, a wallet paid through a non-ATA account, a batch transaction
   that pays several rows, a self-transfer. Is the slack right?
2. `server.js` `cunaArmed` / `dncArmed` / `roseEngineArmed` — the env fallback is gone; an absent kv
   key is OFF. Is there any other reader of `*_ENGINE_ON` that still arms something?
3. `/api/wallet-xray/ask` behind `requireToolPass` + the AI daily cap. Any other paid-model route
   without the pass? (`/api/ask-cluck` is deliberately free — the school.)
4. `lib/hub/project.js` `approveProject` reserved mints/ids, `lib/hub/routes.js` intake checks —
   can a second programme still land on CUNA / CLKN / ROSE by any route?
5. `/api/hub/:project/payout` `confirm=` owner-only; `/api/hub/:project/admin` `terms=` gated by
   `access.mayOperate` unless owner. Is any other operator-reachable action missing the same gate?
6. The lock-watch fallback (`server.js`, search `fallbackTries`) — `announced` only on a landed
   send, six retries, then an ops alert. Is the retry bounded correctly across restarts?
7. Sequencing trap to confirm, not fix: `/api/x-announce?post=1` is POST-only in #330; the hourly
   lock-celebration routine still GETs it and is switched to POST at promotion time. Say if you see
   another caller.

**PR #333 (owner decisions batch, squash `1c4220f` on `develop` — review the merged diff)**
1. `server.js` graduation gate — `gradGateLogBlock` journals every block to kv `gradGateBlockLog`
   (bounded 50); `gradGateLearnerMessage` picks copy per gate code; `/api/claim` returns
   `gate {code, detail}` when the mint is withheld. `src/App.jsx` — failed `lesson_complete`
   beacons are queued in localStorage (`clkn_track_q`) and re-sent on load / `online` / before a
   claim; a claim withheld for a short ledger re-sends every locally completed lesson. The server
   keeps the FIRST sighting per lesson (`lib/school-progress.js` `mark`). Attack it: can the
   re-send path, or a crafted `clkn_track_q`, weaken the anti-farm timing checks (min age, live
   marks across three 5-minute windows)? Can the journal leak anything a learner did not consent to?
2. `/api/tg-test` — one `app.all` dispatcher: key → 404, non-POST → 405, ≥100 body bytes → raw
   upload else query send. The meme routine and lock-celebration watcher POST it with a transition
   fallback (GET only on the OLD build's exact "empty body" 400). Is there any caller still GETting
   it, and can the dispatcher misroute a query send that happens to carry a body?
3. `adminGuarded(shape, { noStore })` middleware over 75 routes, six named 404 bodies. Did any route
   change its 404 body, lose a `Cache-Control: no-store`, or gain the guard on a path that used to
   run something before the key check? The seven sites left alone are listed in commit `ebe8a96`.
4. `ENGINE_ARM_TABLE` / `registerEngineArmRoute` (cuna/dnc/rose). `operatorPubkey` is now read
   after the arm branch rather than before — the agent argues the memo cache makes that identical;
   check `lib/whirlpool-vault.js` `_operators` eviction in `registerProject` (ROSE's ratchet
   re-registers before the operator check).
5. `tgApi()` — 27 hand-rolled Telegram sends collapsed onto one never-throw helper; `tgSendKb` gained
   the staging prefix it always lacked. Two sites (`notifyTelegramPhoto`, the ops-report chart) now
   treat a Telegram-level `ok:false` as failure where they only checked HTTP before. Any caller whose
   return-type contract changed (message_id vs boolean vs result)?
6. `lib/engine-ratchet.js` `ratchetPatch` + `lib/sig-cursor.js` `freshSince` — pure extractions
   with tests written first. The ratchet report documents that cuna re-applies overrides over its
   floor while rose does not (pre-existing, preserved). Is that rose gap worth fixing, and did the
   POKE rewiring (its monotonic bumps fed in as `want`) change anything observable?
7. `scripts/engine-arm-gate-test.cjs` — three real boots. Does scenario A's "every *_ENGINE_ON=1
   arms nothing" actually exercise the code path you would attack, or is there an arm reader it
   misses (`dedicatedActive`, the vault router's own `ARMED_FLAGS`)?
8. Page pass: quiz pass mark is now `ceil(questions × 2/3)` (`src/App.jsx`); deep-link unlock order;
   `CluckUtil.rawAmount` BigInt formatting on the hub desk; `CluckGate.denied/message` re-opening the
   gate card on `token-holders`, `wallet-xray`, `trace`; new `GET /api/hub-pricing`. Anything that
   regresses a learner or a paying operator?
9. `package.json` `overrides`: `elliptic` 6.6.1, `secp256k1` 5.0.2 under `@dha-team/arbundles`
   (its newest release is 1.0.4). Does the Hatchery's Arweave upload path (`hatchery.js`
   `SolanaSigner`) touch either override at runtime?

## What to review first (ranked)
1. **The server-side tools pass (PR #281, money path).** `toolPassGate` / `requireToolPass` in
   `server.js`; the proof format `w:<wallet>` (live CLKN balance at the tool-gate price, or a
   comped wallet) and `s:<sig>` (a SOL payment signature redeemed by `/api/verify-sol-payment`,
   recorded as `toolPass:<sig>` in kv). Questions: can a proof be forged, replayed across users,
   or kept alive past expiry? Is the fail-open on missing price / RPC failure abusable? Does the
   5-minute holder cache create a window worth caring about? `scripts/tool-pass-gate-test.cjs`
   pins the current behaviour; say if the pins are the wrong ones.
2. **Dashboard sanitisation (PR #282).** `lib/jvp-dashboard.js` is the only thing between the
   vault's `status()` (which carries the operator pubkey, float balances, P&L, chat ids) and a
   public page. Read `sanitizeStatus`, `sanitizePositions`, `sanitizeDislocation` and the two
   routes. Does anything leak, directly or through error strings? Are the GET routes truly
   read-only (`scripts/mutating-get-guard-test.cjs` is the CI pin)?
3. **The decision replay.** `deriveDecisions` in the same file feeds live inputs to
   `lib/engine-decisions.js`, the pure gates the vault actually calls. Are the derived inputs
   (`frac`, staged quote, idle token, dwell/last-buyback assumptions) honest, and is anything
   presented as a decision that the code would not actually make?
4. **Multi-mint lock-to-earn, design only, no code yet.** The math in `lib/cuna-staking.js`,
   `lib/cuna-programme.js`, `lib/cuna-payout.js` is already pure and mint-agnostic; the CUNA
   wiring is seven kv keys, one singleton and branded pages. Owner's design: owner-whitelisted
   mints (config, not self-serve); **the project's own funding wallet signs its own payout batch**
   from its own payout page, so no second key is ever held by us. Poke holes in that before it is
   built: sybil, term gaming, Rule B (exclude by recipient and creator) generalised, payout
   double-count across projects, what a hostile project could do to its own holders.

## How to deliver findings
- Post them as review comments on the PR (Claude is subscribed and acts on them), or hand them to
  the owner. Findings, not rewrites: two agents editing one branch is how files get clobbered.
- Rank by severity, cite `file:line`, give the failing input. A finding on a money path with a
  reproduction is worth more than ten style notes. P2/P3 polish gets no verifier here.
- Say when something is fine. "Reviewed, no issue" on a money path is a real result.
- Never run anything that arms, pauses, rolls, pays or posts. Reads are always fine. All
  liquidity engines are paused by the owner; leave them so. Never `&loud=1`; never print or commit
  a secret; the admin key travels only in an `x-premium-key` header.

## Round 0 — DELIVERED (2026-09-13). Folded into roadmap revision 2.

Your Round 0 findings were adopted: the centerpiece confirmed, settlement rules tightened into
Addendum B, every promised test assigned or deferred, W4/W5 cut, the demo retargeted at the Hub
story, a validation deliverable added, the concurrency claim corrected, and a feature freeze plus
a phone rehearsal put before the recording slot. Two of your corrections are now load-bearing:
prior multi-tool entries *have* placed, so the single-mechanism lead is a positioning judgement
rather than a law; and a program hash served by the same server that computes the payout is
reproducible, not independently verified, so the public wording stays "reproducible from the
published inputs" until Addendum B §B5's witness exists.

## Round 1 — the window is open (from 2026-09-14 13:00 UTC, 06:00 PT — Official Rules §5)

**State as of 2026-09-14.** The window opened; the pre-event snapshot is recorded (`main` at
`75b69cc`, `develop` at `41d0a6a`, marker branches `snapshot/pre-colosseum-2026-09-14-*`) and
`docs/PRE_EVENT_STATE.md` is the disclosure. Open PRs:

- **#298 — buy-comp hold check: a lock is not a sell.** CI green. A Jupiter Lock escrow is a PDA
  and therefore off-curve, so the hold check scored every lock as a pool sale and would have
  disqualified anyone who locked during a competition window. Destinations are now resolved to
  their owning program and split three ways.
- **#299 — roadmap revision 3, the company theme, and Hub design Addendum C.**

**What we want reviewed now, ranked:**

1. **#298 is a money path** — it decides who is eligible for a prize. Is the three-way
   classification right? The conservative fallback treats an *unresolved* off-curve destination as
   a pool sale; is that the correct default, or does it hide a different false positive? Is one
   batched `getMultipleAccounts` per call the right cost/correctness trade?
2. **Addendum C (design doc).** The claim is that it needs **no schema change** a day before the
   Sep 16 freeze. Check that: is every one of the six answers genuinely derivable from §2
   entities, or does one of them smuggle in a field? The APR refusal in C3 is deliberate — argue
   it if you disagree.
3. **Roadmap revision 3's four gaps** — traction (W9), weekly updates (W10), the dry-run project
   promoted to a dated blocker, and the real-wallet smoke pulled forward. Is W9 part 2
   ("create some usage") realistic in the time, or is it a wish?
4. **The traction instrumentation itself.** Personal earn (fewer losses because you learned) is
   not honestly measurable; program earn (receipts) is. Is that split right, and is there a
   defensible metric for the first that we are missing?
5. **Anything in `PRE_EVENT_STATE.md` that reads as a claim on pre-window work.** This is the
   failure mode with the worst penalty. Be pedantic here.

Findings, not rewrites. "Reviewed, no issue" on a money path is a real answer.

## Round 2 — 2026-09-18 evening (X1, roadmap §8): caught up through batch 8

Batches 2–8 (#339–#346) plus the money-path settlement-journal PR (#342) all landed the same day
under the owner's "build non-stop, merge to `develop` on green, `main` only on promote" policy —
this is the list your terminal pass starts from instead of a raw diff, ranked money-first. Every
question below was written from the actual diff (`git show`/`git log` on each PR's commits), not
a template; where a lens has already run, its own findings doc is cited directly rather than
repeated.

**#342 — Hub W3 integration gate: the settlement journal becomes the payout system of record
(money path, open, blocked).** `lib/hub/settle.js` (new), `lib/hub/attempts.js`, `lib/hub/store.js`
`writeManyVerifiedMixed`, `lib/hub/routes.js` (`&sent=`/`&send=`/`&sweep=`), `lib/cuna-payout.js`
`owedNow`. Two lenses already ran on commit `332a79c` and wrote up 21 findings in
`docs/HUB_JOURNAL_VERIFY_2026-09-18.md` on branch `claude/hub-settlement-journal` (not yet on
`develop`) — **read that file first**, it has exact line numbers and reproduced attacks. **Your
question:** the PR body claims the P0/P1 items from that doc are fixed on top of `332a79c` before
merge — verify the two headline crash windows are actually closed, not just narrowed: (1) **the
idempotency key** — is the journal now one kv key per `xferKey` (`settle:<sig>:<instructionIndex>`)
as Addendum B1 names it, or still the single whole-object `hub:settle` blob that made two
concurrent `&sent=`/`&send=` requests overwrite each other's entries (lens 2's P0-1/P1-1, the one
that let a landed, verified payment be re-offered by `owedNow` after a cancel)? (2) **the crash
windows** — with whatever the fix is, replay lens 2's probe (or an equivalent): two payout requests
for different wallets in the same batch, one stalling inside `getTx()` while the other completes
and journals — does the second survive the first's write? And separately, does a transfer's
**source** now get checked against the project's funding wallet (lens 1's P0-1 — as shipped, ANY
inbound transfer of the reward mint to a wallet, from anywhere, settles that wallet's row)?

**#346 — a11y pass, demo storyboard, Launch Readiness, airdrop receipts, Buy Special standings +
hold-through proof, roadmap extension 2 (open, on this branch).** Three separate money-adjacent
surfaces in one PR — each gets its own question:
- **Airdrop receipts** (`lib/airdrop-receipt.js`, `POST /api/airdrop/record`, public `GET
  /api/airdrop/r/:dropId`). `recordDrop` verifies each row with `payoutVerify.rowPaidBy(tx, {mint,
  wallet, minRaw, notBefore})` — the same function `lib/hub/settle.js`/`locateTransferInstruction`
  wraps for the Hub journal, but here called directly with **no per-instruction location and no
  source check** (it only asserts the named wallet's own net token-balance delta for the mint
  increased by the amount, after `createdAt`). Given #342's P0-1 finding that this exact check
  lets ANY inbound transfer settle a row: can an operator submit `{wallet, sig}` for a real
  transaction where `wallet` received the mint from something with nothing to do with this drop —
  a DEX buy, another operator's airdrop, another project's payout — and have the public receipt at
  `/airdrop/r/<dropId>` show `verified:true` next to a signature that was never this drop's
  payment to that wallet?
- **Buy Special public standings** (`GET /api/hub/:project/p/:compId/standings`,
  `lib/hub/public.js compStandingsView`). Gated on `c.status === "verified"` only — anything else
  (`open`/`closed`/`closed-awaiting-verify`) returns terms only, no results, not even an empty
  array (server.js ~8017–8046 states why: a live board would let a whale time the last buy).
  `buyCompVerify` (server.js ~2280–2307) builds `c.verified`/`c.verifyResults`/`c.verifiedAt` on
  the in-memory object and sets `c.status = "verified"` last, before one `buyCompSave(c)` call.
  Can an unsealed board still leak through this or another route before that single save lands —
  the hourly `buyCompUpdate()` autosave's `c.provisional` field, a read hitting the object between
  `c.verified` being set and `c.status` flipping if `buyCompVerify` is ever made non-atomic later,
  or a second in-flight request reading a partially-built `c` — and if not today, what would make
  it true after the next edit to this function?
- **Launch Readiness** (`lib/hub/readiness.js`, the `&arm=1&confirm=go-live` refusal in
  `lib/hub/routes.js` ~260–284). `computeReadiness()` reads a **live** RPC balance
  (`getParsedTokenAccountsByOwner` on the funding wallet) at the moment of arming and blocks on
  `coverage < 1`; once armed, nothing re-checks it. Can a shortfall be armed around — e.g. a
  funding wallet topped up just long enough to pass the one-time check and drained immediately
  after, or terms edited (`&terms=1`, which does not re-run readiness) after arming to raise the
  obligation past what was funded? Readiness is a `block`-classified read at arm time only, never
  an ongoing invariant — is that gap acceptable given the accrual engine has no independent
  "am I still funded" check of its own?

**#341 — school→Hub bridge (E6), on-chain hash commitment dry-run (E3), Hub pages in seven
languages (E8).** `lib/hub/commit.js`, `POST /api/hub/:project/commit/build` +
`…/commit/observe`, `docs/hub/commitments.md`. **Your question (as scoped by the roadmap item
itself):** `commit/build` returns an unsigned Memo transaction with the funding wallet as fee
payer for the desk to sign and broadcast; `commit/observe?sig=` then fetches that signature and
writes `commitment` only after verifying confirmation, fee payer, and exactly one memo matching
`clkn-hub:v1:<project>:<version>:<hash>`. Can `commit/observe` be fed a memo the funding wallet
did NOT sign — e.g. a signature for a transaction some other wallet paid the fee on that happens
to carry a matching-looking memo string, a transaction with the right memo but a different fee
payer, or a memo that matches by prefix/substring rather than exact text? And separately: is the
30-case byte-diff in `scripts/hub-commit-test.cjs` actually pinning the built instruction against
`@solana/spl-memo` (or an equivalent library encoder), or only against a hand-built expectation
that could drift from what the library would produce?

**#340 — engine evidence classes (W5), seven-language lessons (F4), POKEAHOE decided (E10).**
`lib/whirlpool-vault.js recordDecision` / the `engineLog:<project>` ring buffer, read by
`/liquidity-engine` (`lib/jvp-dashboard.js`). The header comment claims this is "written from ONE
choke point... every caller of `vault.tick()`... goes through here". **Your question:** the
module also exports `tickAskWall` (`lib/whirlpool-vault.js` ~1302, wrapped separately at the
bottom of the file as `tickAskWall: (o) => withProject(o.projectId, () => tickAskWall(o))`, with
**no** `recordDecision` call) — it returns its own `action`/`reason` shape (`"skip"`, presumably
others) and clearly makes a real decision about the ask-wall position. Is a decision `tickAskWall`
makes while an engine is armed silently absent from the "decision log (retained events)" evidence
class the dashboard presents as the complete record of what the engine decided, and if so, is that
an intentional scope cut (ask-wall isn't "the base tick") or a real gap in the choke point?

**#339 — disclosure caught up, traction counters (W9 part 1), `/for-projects` front door.**
`lib/traction.js` `recordWalletConnect`/`recordReceiptOpen`, described as "PII-free by
construction" because only a salted hash is stored, never the wallet. **Your question:** the salt
is `process.env.ANALYTICS_SALT || process.env.PREMIUM_ACCESS_KEY || "clkn-traction-salt"` — a
literal string committed to the repo as the fallback. Is `ANALYTICS_SALT` actually set in the
production environment? If not (and `PREMIUM_ACCESS_KEY` is also unset, or ever gets rotated to a
value that leaks the same way), the hash is `sha256("wallet|<source>|<wallet>|clkn-traction-salt")`
with every input but the wallet address public — and CLKN/CUNA/ROSE holder addresses are
themselves public on-chain. Does that make "which wallets connected to the tools pass / Hub
desk" reversible by brute-forcing the known holder list against the committed salt, contradicting
the "PII-free by construction" claim in the file's own header?

**#345 — W9 part 2: school and homepage doors to the Hub, door counters, disclosure for batch 6.**
`lib/traction.js` `recordHubDoorClick`, fired over the existing `POST /api/track` beacon
(rate-limited 120/min per IP, `server.js:3823`) with an anonymous per-browser `sid` the client
controls and a source of `"school"` or `"home"`. Dedup is per (day, source, sid-hash) — there is
no proof the `sid` corresponds to a real page load. **Your question:** can a script inflate the
`hub_door_click` counters (and therefore the "N visitors saw the door" numbers this doc's own
traction table and the submission may cite) by POSTing distinct fabricated `sid` values from
rotating IPs, and if so, is 120/min/IP a meaningful ceiling on that at hackathon-judging traffic
volumes, or effectively no ceiling at all?

**#343 — truth pass: README, `/about`, submission match `develop` (batch 4).** Docs only. Four
more batches (5–8) have shipped since this "truth pass" ran, adding Launch Readiness, airdrop
receipts, and Buy Special standings — grepping `README.md` and `public/investors.html` for those
terms today finds nothing. **Your question:** is the truth pass stale again (i.e., does the code
now do things the docs don't mention — an omission, not an overclaim, so lower severity but the
same "docs must match the code" rule), and separately, does anything either doc says today
overstate what's actually live (in particular any phrase implying independent verification, given
§6/§g of `docs/HUB_VERIFY.md` — this batch — says plainly that no program hash has been
independently committed yet)?

**#344 — W6b validation kit + interview script, `.claude/settings.json` allowlist.** Mostly docs
(`docs/VALIDATION_2026-09.md`, `docs/OPERATOR_INTERVIEW_SCRIPT.md`); the one code-adjacent change
is the settings allowlist addition (`Bash(node scripts/<name>-test.cjs)` entries plus
`Bash(git fetch *)`, `Bash(git worktree list)`, `Bash(git worktree prune)`). **Your question:**
`scripts/engine-arm-gate-test.cjs` and `scripts/mutating-get-guard-test.cjs` are both described
elsewhere as doing "real boots" of the server — does allowlisting them without a permission prompt
risk a cloud session starting a real process that reads a live secret or reaches a scheduler,
in an environment where `.env`/Railway variables are present, or are they confirmed hermetic
(their own `DATA_DIR`/port, no real API keys) regardless of what's in the ambient environment?

Findings, not rewrites, same as every other round. Money paths first if your time is short: #342,
then #346's three sub-questions, then #341.

## Round 2 — Codex brief reading pass, batch 8

Three findings from a source read of the batch-8 diff (airdrop receipts, the engine decision log,
and the traction/analytics salt), each fixed the same day it was found, on the
`claude/colosseum-batch-8` branch. Findings, not rewrites, still applies below.

1. **`lib/airdrop-receipt.js` — the transfer's source was never checked.** `rowPaidBy` only
   matched mint + destination owner + amount, so a stranger's unrelated transfer of the same mint
   to the recipient, or a DEX-routed inner-CPI transfer, would record as this operator's airdrop
   with `verified:true`. **Fixed on batch 8 (commit `ee8e679, cherry-picked onto batch 8`):** `sourceIsOperator()`
   now additionally requires the funding wallet — read from the pre/postTokenBalances decrease, or
   a parsed `transfer`/`transferChecked` instruction's `authority`/`source` owner — to equal the
   drop's own operator wallet before a row can verify; a mismatch records
   `verified:false, reason:"transfer_not_from_operator"`. Lives entirely in
   `lib/airdrop-receipt.js`, never `lib/payout-verify.js` (PR #342's own funding-wallet check for
   the CUNA/Hub settlement journal is a separate, non-overlapping change). Test:
   `scripts/airdrop-receipt-test.cjs` (the three "finding #1" cases).
2. **`lib/whirlpool-vault.js` — the engine decision log was incomplete.** Only the base `tick`
   wrapper called `recordDecision`; `tickAskWall`, `tickSol`, `tickBtc`, `tickJup`, `tickTreasury`
   and `concentrate` all make `{action, reason}` decisions that never reached the public "Decision
   log (retained events)" on `/liquidity-engine`, so it understated what the engine actually
   decided. **Fixed on batch 8 (commit `ee8e679, cherry-picked onto batch 8`):** every per-project tick wrapper now
   records its own decision, tagged with a new `source` field
   (`"base"|"askWall"|"sol"|"btc"|"jup"|"treasury"|"concentrate"`) added to `recordDecision`'s
   allow-list and to the sanitised public row shape in `lib/jvp-dashboard.js`. Test:
   `scripts/jvp-dashboard-test.cjs` (the per-sleeve `source` cases); `scripts/engine-sim-test.cjs`
   passes unchanged — no engine started.
3. **`lib/traction.js` (and the same shape in `lib/analytics.js`) — the salt fallback was a
   hardcoded literal.** With `ANALYTICS_SALT`/`PREMIUM_ACCESS_KEY` both unset, the salt fell back
   to a fixed string baked into the repo, making the "PII-free" per-day wallet/visitor hash
   reversible against a public holder list. **Fixed on batch 8 (commit `ee8e679, cherry-picked onto batch 8`):** a
   fresh install with no env var mints its own `crypto.randomBytes(32)` salt once and persists it
   under the shared kv key `traction:salt_v1` (both files read the same stored salt), read back on
   every later call, never logged. Test: `scripts/traction-test.cjs` (the "salt (finding #3, batch
   8)" section) and `scripts/analytics-engaged-test.cjs` (the "salt: with no env var…" test).

## Round 3 — 2026-09-18 (BB2, roadmap §12): caught up through batch 10, plus #342's status

Docs-drift pass, not a code review — written from `git log --oneline origin/develop -20` and the
actual diffs of #347/#348 on the merged tree (`claude/colosseum-batch-10`, which carries batch 9 +
AA1–AA5 + BB1 + BB3). The coordinator notes a follow-on branch `claude/colosseum-batch-11` (PR
#349) already carries BB4 on top of this — not reviewed here, out of this pass's scope.

### PR #347 — batch 9 (Y1 `/hub/verify`, Y2 receipt lesson, Y4 OG cards, Z1 weekly-update
generator, Z2 `/hub/status` + `/api/build`, Z3 route hygiene)

**Y1 — `/hub/verify`'s browser bundle.** Read `hub-verify-src/entry.js` (the ESM entry vite bundles
into `public/hub-verify.bundle.js`), `lib/hub/reproduce.js`, `lib/hub/schema-validate.js`,
`lib/hub/canonical.js`, `lib/hub/bundle.js`, and `public/hub-verify.html`'s two flows (paste-a-URL,
drop-files/bundle). Pinned by `scripts/hub-verify-page-test.cjs` and `scripts/hub-bundle-test.cjs`
(item 4 in its header: "Chromium drops the bundle file … every fixture receipt shows MATCH").
Questions:
1. **A confirmed drift, not hypothetical — the bundle's embedded program version can never pass
   its own hash check.** `server.js`'s `/api/hub/:project/batch/:batchId/bundle` (and its demo
   **Fixed on batch 12 (commit d77729c):** the bundle routes, `/api/hub/:project/program/:version` and the batch-inputs route now serve the full hashed record (`programVersionView(v, {full:true})`), and `versionHashInput()` strips the served `$schema` (a second hash-input bug found on the way); `hub-bundle-test` and `hub-verify-page-test` assert the recompute matches in Node and Chromium. The note below is kept as the record of the finding.
   twin) builds `program` as `{ ...hubPublic.programVersionView(p.version), $schema }`.
   `programVersionView()` (`lib/hub/public.js` ~289) returns only
   `{version, effectiveFrom, effectiveTo, hash, terms, commitment}` — it drops `projectId, mint,
   rewardMint, rewardDecimals, rewardTokenProgram, fundingResponsibility, signer, exclusions`,
   every one of which `versionRecord()` (`lib/hub/project.js` ~181) hashed. Reproduced directly:
   `proj.verifyVersionHash(fullInternalVersion)` → `true`; `proj.verifyVersionHash(pub.programVersionView(fullInternalVersion))`
   → `false`, on the SAME untampered version. `public/hub-verify.html`'s `reproduceFromBundle()`
   (~424–433) feeds exactly `split.programVersion` — the bundle's reshaped field — into
   `HubVerify.verifyVersionHash`, so every bundle drop, for every project, prints "Program-version
   hash recompute: does not match — computed …" even when nothing is wrong. Captured live in
   `docs/demo/2026-09-18/hub-verify-bundle.desktop.png` (this batch). `scripts/hub-bundle-test.cjs`
   asserts the bundle's OWN top-level hash round-trips (it does) but never asserts on this
   embedded line, so it's a real gap, not a regression from a passing test. Is this shape
   (`programVersionView` inside the bundle) intentional — should the bundle instead embed the
   fields `versionHashInput` needs, or should the page stop attempting this specific check when a
   bundle (rather than a raw `/api/hub/:project` fetch) is the source? Either fix is small; flagging
   because it silently prints a scary-looking false negative on the doc's own recommended
   fast-path ("Save the evidence bundle first").
2. Does `verifyVersionHash`'s comparison ever produce a false MATCH — i.e., can two different
   `terms` bodies canonicalize to strings that hash the same after `programVersionView`'s field
   drop, given the drop is lossy in one direction only (fields removed, never added)? (Reasoning
   only — no attack found; asking because the finding above shows the shape is under-specified.)

**Y2 — the receipt lesson.** Read `src/App.jsx`'s `LESSONS` entry for "Read a payout receipt" and
`lib/hub/teach.js` (six-question, no-copy-from-project derivation the lesson links to). No
dedicated lesson test file exists; coverage is indirect — the CI language-coverage guard
(`.github/workflows/syntax-check.yml`, every lesson in all seven languages) and
`scripts/analytics-engaged-test.cjs` (the `hub_lesson_read` event name). Questions: does the
lesson's report card link land on a live route in all seven languages (the `#lesson=` /
`#library=` deep-link pattern CLAUDE.md's i18n trap warns about)? Is `hub_lesson_read` actually
fired once per learner reaching the finish card, not once per render (a re-render inflating the
BB5 breakdown roadmap item AA1's sibling section plans to build on this same counter)?

**Y4 — server-rendered OG cards.** Read the OG route in `server.js` and `scripts/hub-og-test.cjs`.
Questions: does every card correctly say DRY RUN in its description for `/hub/demo`, `/hub/demo-b`
and `/hub/poke` (CLAUDE.md: dry-run labelling must be visible everywhere it applies, and an OG
card is exactly the kind of surface that gets forgotten because nobody looks at it directly)? Is
any attacker-controlled string (a project label, symbol) reaching the rendered image without the
same escaping `CluckUtil.esc` enforces on the HTML pages?

**Z1 — the weekly-update generator.** Read `scripts/weekly-update-draft.cjs` (pure `git log`
classification, no memory-authored claims) and its test, `scripts/weekly-update-draft-test.cjs`
(13 passing as of this branch — re-ran it, see below). Questions: does `classify()`'s
security-over-hub-over-school priority ever misfile a genuinely Hub-money-path commit under
"Operations" because its subject line also contains a security keyword, understating what a
weekly update should lead with? Does the promoted/staging-only split correctly re-derive from
`git log origin/main`/`origin/develop` rather than trusting a commit's own claimed branch?

**Z2 — `/hub/status` + `GET /api/build`.** Read `public/hub-status.html` and the two routes in
`server.js`. Pinned by `scripts/hub-status-test.cjs`. Questions: does `projectReproducibility`
(the same figure BB3's badge reads) exclude demo/dry-run projects consistently with every other
public count (CLAUDE.md, "(f) dry-run caveats" in `HUB_VERIFY.md`)? Does `/api/build` ever leak
anything beyond `sha`/`branch`/`builtAt`/`env` — in particular, could `branch` on a real deploy
name a feature branch in a way that discloses unshipped work?

**Z3 — route hygiene.** Read `scripts/public-route-hygiene-test.cjs`'s own header (ETag + cache
tier parity, per-IP rate limits on the routes that do real work per request, param shape checks
before any store read). Question: does the per-IP rate limit on the holder-snapshot series route
(shared with AA3's new diff route) actually cover the diff route too, or only the route it was
written against before AA3 added a sibling on the same prefix?

### PR #348 — batch 10 (AA1 `/hub/wallet`, AA2 evidence bundle, AA3 snapshot diff, AA4 judge
guide, AA5 `/hub/trust`, BB1 classroom curriculum, BB3 badge)

**AA1 — `/hub/wallet/<address>`.** Read `public/hub-wallet.html`, the
`GET /api/hub/wallet/:wallet` route composing only `hubPublic.walletLookup` per project.
Pinned by `scripts/hub-wallet-test.cjs`. Questions: can any private field (a chat id, an internal
note, a comp's `payoutToken`) reach this roll-up through a project whose `walletLookup` shape
changes later without this route's own allow-list being updated in step? Confirmed live:
`GET /api/hub/wallet/<CLKN mint>` → `{"projects":[],"seenIn":0}` — an honest empty, not an error —
captured in `docs/demo/2026-09-18/hub-wallet-clkn.desktop.png` (this batch). Second question: the
roadmap's own DoD says "a test drives a fixture wallet across two projects" — that fixture only
exists inside `scripts/hub-wallet-test.cjs`'s own throwaway registry, never in the real
`/hub-demo` fixture (by design — a demo project must never leak into the real registry). Is there
any path, now or after a future change, where a project seeded for a test or a demo could land in
the real registry this route reads?

**AA2 — the evidence bundle.** Read `lib/hub/bundle.js`, the two bundle routes in `server.js`
(`/api/hub/:project/batch/:batchId/bundle` and its `/api/hub-demo/...` twin), and
`public/hub-verify.html`'s bundle-drop tab. Pinned by `scripts/hub-bundle-test.cjs`. **Does the
bundle hash survive a JSON round trip?** Yes for the bundle's own top-level hash (confirmed:
`BUNDLE_HASH: MATCHES` on a real drop, `docs/demo/2026-09-18/hub-verify-bundle.desktop.png`) — but
see Y1 finding 1 above: the EMBEDDED program-version hash does not, for a structural reason
(`programVersionView`'s field drop) that has nothing to do with tampering. Second question: the
bundle's `note` field for an unsettled/model-mismatched batch (the demo fixture's own receipts,
which are honestly `MISSING_INPUTS` per `HUB_VERIFY.md` §g) is free text built server-side from a
string literal — never project-authored — so no escaping question there; confirm that stays true
if a real (non-demo) project's batch ever needs a similar note.

**AA3 — snapshot diff over the recorded top-25.** Read `lib/holders-snapshot.js`
(`diffSnapshots`, the honest-limit header comment) and the Compare panel in
`public/token-holders.html`. Pinned by `scripts/holders-snapshot-diff-test.cjs`. Captured live
with two seeded snapshots (no live RPC — see `docs/DEMO_STORYBOARD.md`'s honesty note on how
`docs/demo/2026-09-18/holders-compare.*.png` was produced). Questions: is the diff labelled
"top-25" (or the recorded-scope language) everywhere it renders, not just in the one `view-note`
line — in particular, does the exported/copied hash on the history table make clear it covers the
FULL list while the diff table two cards down covers only the top 25, so a reader skimming both
tables in sequence doesn't conflate the two scopes? Does `renderCompare()` ever let a
attacker-influenced wallet string (from a mint whose holder set includes an oddly-named contract
label) reach `innerHTML` unescaped — the same class of bug CLAUDE.md's "Verification" section
already found five times elsewhere?

**AA4 — the judge's fifteen minutes.** Read `docs/JUDGE_GUIDE.md` and
`scripts/build-judge-page.cjs`'s `renderPage()` (the doc is the single source; the HTML page is a
byte-identical rebuild — asserted by `scripts/hub-judge-doc-test.cjs`, re-ran green, see below).
Questions: does every URL the guide names actually 200 on a NO-BUILD boot (the CI link-check step
the roadmap DoD requires), not just on a built server — `CLAUDE.md`'s own "public/ is not mounted
directly" trap is exactly the failure mode a judge would hit if this guide is only ever tested
post-build? Is `scripts/hub-judge-link-test.cjs` that link-check, or a different check — confirm
which file actually boots a no-build server and hits every named URL.

**AA5 — `/hub/trust`.** Read `public/hub-trust.html` and `docs/HUB_VERIFY.md` §(g)'s four
boundary bullets. Pinned by `scripts/hub-trust-doc-test.cjs` (boundary-marker parity both
directions, forbidden-word scan, link-to-route check — all re-ran green, see below). Question:
the doc-test only checks that every `<!-- boundary: … -->` in §(g) has a matching
`data-boundary="…"` on the page and vice versa — it does not diff the WORDING on each side. If a
future edit to §(g)'s bullet text changes what it claims (e.g., loosens "does not prove... fair"
to something softer) while the page's copy is untouched, would anything catch the two saying
different things under the same boundary id?

**BB1 — the Live Classroom reads the real curriculum again.** Read `scripts/extract-curriculum.js`
(now reading `src/App.jsx`, `src/sections/LPLab.jsx`, `src/sections/Library.jsx` per the fixed
scanner) and `scripts/check-counts.js` (the pinned per-course counts). Re-ran live on this branch:
`✓ curriculum counts consistent — 15 classes, 7 beginner lessons, 14 LP Lab lessons`. Questions:
the roadmap item names "LP Lab (22)" and "deep-dive (11)" courses as what the old extractor
silently dropped — `check-counts.js`'s pinned figure for LP Lab is 14, not 22; is "22" the
roadmap's own shorthand for something else (e.g., a raw lesson-plus-quiz-item count before
dedup), or is a course class still missing from the regenerated `data/curriculum.json` that
`check-counts.js` doesn't cover because it was never told to count it? Second: is the
apostrophe-in-comment bracket-scanner fix (the roadmap's stated second bug) covered by its own
regression case, or only implicitly exercised by the current file's own comments happening to
contain one?

**BB3 — the reproducibility badge.** Read the `GET /api/hub/badge.json` and `GET /hub/badge.svg`
routes and `scripts/hub-badge-test.cjs`. Re-ran live on this branch (below). Questions: does the
README's badge row point at production (`clucknorris.app`) or could it point at a staging host by
accident, given `develop`/`main` are not always in step (`HUB_VERIFY.md`'s own "what's live where"
table already tracks this same divergence risk for other routes)? Does the badge's "no receipts
yet" fresh-install case ever get reached in CI where a persisted `DATA_DIR` from an earlier test
run could leave a stale count behind?

### #342 status (the settlement journal) — summary, not a new review

Three verification rounds have now run on `claude/hub-settlement-journal` (commit `332a79c` plus
two fix rounds), documented in `docs/HUB_JOURNAL_VERIFY_2026-09-18.md` on that branch (not yet
merged to `develop`). Summarising only — this pass did not re-verify anything itself:

- **Round 1 (two lenses, pre-fix):** an adversarial lens found the transfer source was never
  checked (any inbound transfer of the reward mint settled a row) and that a journal refusal still
  let the legacy ledger record the row as paid anyway; a durability lens independently found the
  journal is one whole-object kv blob, so two overlapping payout requests — or two different
  projects' requests — can clobber each other's entries under a stalled RPC read, silently
  defeating the cross-project reuse guard the journal exists to provide.
- **Round 2 (one lens, re-verification):** most P0/P1s closed (source check, cross-project reuse,
  the per-row union in `owedNow`, the receipt page's new body shape, the amount source). Two items
  stayed open: the phantom-excess finding reproduced in a new shape (stapling a second, larger
  transfer to an already-settled row in the SAME request still inflates the receipt's `excess`
  even though the fix closed the two-request version), and the money-path diff for `owedNow`'s fix
  had briefly gone out as three raw NUL-byte separators in `lib/cuna-payout.js`, making that
  specific diff unreviewable on GitHub (unrelated to correctness — `node --check` passed — but a
  process blocker for a second reviewer).
- **Round 3 (one lens, re-verification of round 2's fixes):** the NUL-byte issue and the
  `payoutSources` allowlist design are CLOSED. **Item 1, the phantom-excess receipt forgery, is
  still OPEN as P1** — the round-2 fix only closed the ordering where the genuine transfer is
  submitted first; swapping the order in the same `&sent=` array (or submitting one oversized
  genuine transfer alone) reproduces the original outcome verbatim, and the fix round now on the
  branch is applying an EXACT-AMOUNT rule (a settlement must consume the row's full remaining
  balance or be refused, never partially apply-and-staple) rather than an ordering-dependent guard.
  Five new lower-severity findings came out of round 3 (N1–N5): unbounded per-row fraud alerts on
  one request (N1), an application-approval path that can take over an existing project and reset
  its payout-source allowlist (N2), the allowlist itself being invisible on every public/operator
  read (N3), `&sweep=` accepting any vault project's operator wallet rather than just the one
  broadcasting (N4), and an orphan-journal key-parsing asymmetry that mirrors the earlier NUL-byte
  shape (N5). None of these are money-loss paths as scoped; the journal is still not wired into
  any live payout route (`HUB_VERIFY.md` §g's `journal-not-live` boundary), so nothing above
  affects any receipt a reader can fetch today. See the journal doc itself for exact repro steps
  and line numbers — findings, not rewrites, same rule as every other round.

### Drift tests re-run on this branch (verbatim last line of each)

- `node scripts/hub-verify-doc-test.cjs` → all passed
- `node scripts/hub-trust-doc-test.cjs` → all passed
- `node scripts/hub-judge-doc-test.cjs` → all passed
- `node scripts/weekly-update-draft-test.cjs` → all passed (13 passed)
- `node scripts/check-counts.js` → curriculum counts consistent — 15 classes, 7 beginner lessons, 14 LP Lab lessons

## Open questions the owner would like your opinion on
- Is lock-to-earn on Jupiter Lock the right headline mechanism for a Consumer Apps entry, or is
  the read-only engine dashboard a stronger single story?
- Server-side pass enforcement versus the previous client-only gate: is the fail-open rule the
  right default for a product that promises "learning and safety stay free"?
- The traction table now leads with visitors and learners and labels CLKN's own locks as ours.
  What would you cut or add before a judge reads it?
