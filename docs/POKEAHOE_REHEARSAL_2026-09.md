# The POKEAHOE rehearsal — end to end, dry run throughout (Colosseum FF4)

Written 2026-09-18. This is the rehearsal `docs/COLOSSEUM_ROADMAP.md` §16 (FF4) asks for: walk the
whole Hub loop for POKEAHOE — publish terms, preview, Launch Readiness, accrual, a batch attempt,
and the public pages a holder or judge would land on — with `dryRun` kept `true` throughout, so the
night this happens for real is not the first time anyone on this side of it has seen the screens.

**Nothing here moved money, and nothing here armed anything.** Every write happened against a
throwaway, local `DATA_DIR` this session created and deleted; the `poke` project's `dryRun` flag
was asserted `true` before the first write and re-asserted `true` after the last one (both
printed, below). No arm flag (`&arm=1&confirm=go-live`) was ever sent — not even to watch it get
refused — because the working rule for this session is "never touch the arm flags," full stop; the
refusal text below is quoted from `lib/hub/routes.js` by reading the source, not by calling the
route.

## 0. The constraint that shaped this rehearsal

**`https://staging.clucknorris.app` is behind Cloudflare Access and this container cannot reach
it.** No amount of retrying fixes that — it's an auth wall in front of the whole staging host, not
a flaky request. So this rehearsal runs against **a local boot of the same merged tree**:

- Branch: `worktree-agent-a2414da353cd29be1`, after `git merge --no-edit claude/colosseum-batch-15`
  (develop + batch 14: the settlement journal, preview-before-publish, the glossary, feeds,
  compare, the wallet roll-up — everything this rehearsal exercises).
- `npm run build` first, so `public/*.html` pages serve without the no-build-boot 404 trap
  (`CLAUDE.md`, "`public/` is NOT mounted directly").
- `node server.js` on port **3492** (in the assigned 3490–3499 range), with a **throwaway
  `DATA_DIR`** under this session's scratchpad — never the real Railway volume.
- `PREMIUM_ACCESS_KEY` set to a session-local test string (used as the owner/admin key on this
  local boot only — it is not a real secret and grants nothing outside this throwaway server).
- `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` left **unset**, which — per `CLAUDE.md` — turns the
  entire scheduler block off (no alerts, no posts, nothing tries to reach a real chat).
- `dryRun` kept `true` for `poke` throughout — see §2's assertions.

**Every URL below is given as the staging URL an owner would actually click**, with the local
equivalent (`http://127.0.0.1:3492/...`) noted once per section rather than repeated on every line.
Where the real chain was reached (this container does have outbound HTTPS to the public Solana RPC
— confirmed with a plain `getHealth` call before relying on it), the numbers below are **real,
on-chain POKEAHOE lock data**, not a synthetic fixture; that's called out explicitly wherever it
applies.

## 1. Seeding `poke` — how this session got a project row to rehearse against

The project id is **`poke`** (`/hub/poke`), not `pokeahoe` — confirmed against
`docs/VALIDATION_2026-09.md` §(c) and the E10 seed in `server.js`. On a **fresh, empty**
`DATA_DIR`, `server.js`'s boot-time `seedPokeDryRun()` (an IIFE right after the Hub routes mount,
`server.js` ~15383) checks the registry for a `poke` row and, finding none, writes one itself:
`dryRun: true`, no funding wallet, no program version, the real POKEAHOE brand fields (logo,
accent colors, tagline, socials) committed to the repo. This is idempotent — it only ever writes
once, and never overwrites an existing `poke` row — so this session did **not** hand-author the
seed; it booted the server against an empty directory and let the code do exactly what it does on
any fresh clone. The boot log confirms it:

```
[hub] seeded POKEAHOE as a DRY RUN project (dryRun:true, no funding wallet, no program version)
```

**Assertion before any write** — `GET /api/hub/poke` (staging:
`https://staging.clucknorris.app/api/hub/poke`; local: `http://127.0.0.1:3492/api/hub/poke`):

```
ASSERT dryRun == True
fundingWallet: None
programs: []
```

## 2. Step by step

### (1) The POKEAHOE project page as shipped

**Staging:** `https://staging.clucknorris.app/hub/poke` · **Local:** `http://127.0.0.1:3492/hub/poke`

**Capture:** `docs/demo/2026-09-18-pokeahoe-rehearsal/01-hub-poke-dryrun-project-page.png`

The dry-run badge is the first thing on the page — "DRY RUN — TERMS NOT YET AGREED, NOTHING
ACCRUES OR PAYS" — above the brand card, and the page ends with "No programs on record for this
project yet. This is a dry run — see the note above." Nothing to confuse here; this page is exactly
what a first-time visitor would see today, on production, right now (POKEAHOE is real and already
seeded; only the *rehearsal actions* below are local-only).

### Setting up an operator desk session (needed before step 2)

The real Hub desk flow is: an operator wallet signs a one-line nonce, gets a 12-hour HMAC token,
and uses it as `x-clkn-operator` on every desk/admin call. This rehearsal did the **real** flow,
not a shortcut — because the point of FF4 is rehearsing exactly this:

1. Generated two throwaway Solana keypairs locally (`@solana/web3.js` `Keypair.generate()`) —
   never funded, never used for anything but this rehearsal, deleted afterward:
   - a **funding wallet placeholder**, `HLPXmFGi2WjZaSmM2pjzV9vMZTZCuim8wxSKSdSDJURc`
   - an **operator wallet**, `35qfLLSKC1XE9uejUCVnAyr5jAR3L62KCc2XmWXuVCHP`
2. As owner (`x-premium-key`), `POST /api/hub-registry?id=poke` with these two addresses set as
   `fundingWallet` / `operatorWallets`, `dryRun` left `true`, `tier` left `comped`, and the access
   note updated to say plainly these are rehearsal placeholders. **This is the one deliberate
   deviation from "leave the project alone"** — publishing *any* program version requires a
   funding wallet (`validateTerms` excludes it by address; `addr()` throws on `null`), and a desk
   session requires an operator wallet on the record. Both fields are project-record metadata, not
   an arm flag — `dryRun` was unaffected, and the log line reads `[hub] project APPROVED: poke
   (POKE HRvw8…)`, not anything that touches money.
3. `GET /api/hub/poke/desk/challenge?wallet=<operator>` → a nonce + a message to sign.
4. Signed that exact message with the operator keypair (`tweetnacl` `nacl.sign.detached`, the same
   ed25519 scheme `server.js`'s `verifySolanaSignature` checks) and
   `POST /api/hub/poke/desk/session` with `{wallet, message, signature}` → a real, signature-backed
   operator token (not `lib/hub/operator.js`'s `issueToken()` called directly, which is how the
   test scripts shortcut it — this rehearsal exercised the actual challenge/sign/session round
   trip a real operator would do).

### (2) & (3) Preview a draft, then publish it for real, from the operator desk

**Staging:** `https://staging.clucknorris.app/hub/poke/desk` (the desk UI) driving
`POST /api/hub/poke/desk/preview` and `POST /api/hub/poke/admin?terms=1&...` · **Local:** the same
paths against `127.0.0.1:3492`, called directly (this rehearsal drove the API, not the desk HTML,
since the desk page's own JS wiring wasn't in scope here — see "what confused" below).

**⚠️ Placeholder terms — NOT the real POKEAHOE terms.** These numbers are obviously a rehearsal,
chosen only to exercise the code paths: a **30-day minimum lock**, a **1,000 POKE/day fixed pool**,
5% share, 100 POKE minimum lock size, weekly payout schedule. **The real terms are the owner's and
the POKEAHOE team's to agree — see §4's template.**

**Captures:**
- `02-desk-preview-draft-response.json` — `POST /api/hub/poke/desk/preview` with the placeholder
  terms as a draft, **before publishing anything**. This is EE1: "who would this pay today?" for
  terms nobody has committed to yet. The response shows the version hash the draft *would* get,
  and — because the preview mechanism runs the real lock scan — **eight real, on-chain POKEAHOE
  lock escrows**, six qualifying under the draft terms and two refused `term_too_short`. Nothing
  was written; `as` in the response is the operator wallet, not "owner", confirming the operator
  token (not the admin key) drove this call.
- `03-admin-terms-publish-v1-response.json` — the same terms, published for real via
  `POST /api/hub/poke/admin?terms=1&...` with the operator token. The returned hash
  (`c241be90c0fb…`) matches the preview's hash exactly, byte for byte — the preview is not a
  simulation with its own arithmetic, it's the same code path minus the write. `armed: false`,
  `startedAt: null` — publishing terms is not arming.

### (4) Launch Readiness — every check's verdict

**Staging:** `https://staging.clucknorris.app/hub/poke/desk` (the readiness panel) driving
`GET /api/hub/poke/readiness` · **Local:** the same path.

**Capture:** `04-launch-readiness-response.json`

| Item | Status | Why |
|---|---|---|
| `funding_wallet` | ok | the rehearsal placeholder wallet is set and distinct from the operator wallet |
| `program_version` | ok | v1 is in force and its hash verifies against its own record |
| `commitment` | warn | no on-chain memo commitment yet (Addendum B5 — not built for any real program yet) |
| `reward_asset` | ok | reward mint matches the locked mint |
| `term_range` | ok | 30–365 days, within the 1–3650 bound |
| `budget` | **block** | coverage 0.00x — the placeholder funding wallet has never been funded (it's a throwaway keypair) |
| `dry_run` | **block** | "dry run — terms not agreed" — this item **always** blocks for a `dryRun: true` project, unconditionally, by construction (`lib/hub/readiness.js`) |
| **`ready`** | **false** | two blockers is two blockers; the checklist is a read, it doesn't refuse anything itself — the arm route is what turns a block into an actual 403/409 |

The `budget` item's projected obligation — **1,000,000,000 raw (1,000 POKE) for the coming
period, four periods projected to 4,000,000,000 raw** — is computed by `lib/hub/readiness.js`'s
`planBudget()`, which runs the exact same `lib/hub/engine.accrueSlice()` the live accrual
scheduler calls every hour, over the **real** scanned POKEAHOE lock set, held constant for the
projection window. This is the mechanism that satisfies "let the accrual tick create credits from
the dry-run holder set" **without ever setting `armed: true` anywhere** — see the next section for
why that distinction matters and why this is the *only* way this step could honestly be done here.

### (5) Accrual — what the tick actually computes, and why it can't be armed to do it live

**The accrual tick cannot create a real, persisted credit for a `dryRun: true` project, by
construction, and this rehearsal did not try to make it.** Two independent guards stop it, both
verified directly rather than assumed:

- `lib/hub/engine.js` `arm()` throws outright if `dryRun` is true — "this project is a DRY RUN —
  terms are not yet agreed, so arming is refused (nothing may accrue or pay)."
- Even if arming were somehow bypassed, `accrueSlice`'s `gate()` requires `state.armed === true`
  in the **persisted** state, and this rehearsal never wrote that flag — the working rule for this
  session is "never touch the arm flags," and that rule was kept.

**Capture (`12-admin-accrue-not-armed-refusal.json`)** — `POST /api/hub/poke/admin?accrue=1` with
the operator token, against the real (unarmed) `poke` project:

```json
{ "ran": { "ok": false, "reason": "programme is not armed — nobody earns until it is" } }
```

So "let the accrual tick create credits from the dry-run holder set" is satisfied the way the
platform's own design intends it to be satisfiable for a project that must never be armed: through
**Launch Readiness's `budget` check**, which is explicitly built (`lib/hub/readiness.js`'s own
header comment) to project "what one day of live accrual would credit right now" by running the
identical `accrueSlice` function over a **held-constant snapshot** rather than a live, persisted
state. That projection, captured in step (4) above, used the real on-chain POKEAHOE lock set. There
is no other honest way to show "the accrual tick creating credits" for a project design
guarantees can never actually be armed — doing it any other way would have meant writing
`armed: true` to disk, which this session was told not to do and did not do.

### (6) Building a batch — the dry-run refusal, verbatim, at both `&export=` and `&send=`

**Staging:** `https://staging.clucknorris.app/hub/poke/desk` (the "build a batch" button) driving
`POST /api/hub/poke/payout?export=1` and `?send=1` · **Local:** the same paths.

Reading `lib/hub/routes.js` (~line 870) before touching anything showed that the dry-run guard is
stricter than "just `&send=`": **every mutating flag** on the payout route —
`export`/`send`/`sweep`/`void`/`sent`/`confirm`/`cancel`/`waive` — is refused for a `dryRun: true`
project, before any store read. So "build a batch" itself is the first thing refused; there is
never a batch to send in the first place. Captured all three shapes of that refusal:

- **`05a-payout-export-dryrun-refusal.txt`** — `POST ?export=1` (operator token) →
  `403 { "ok": false, "error": "poke is a DRY RUN — nothing accrues, so there is nothing to export, send, confirm, cancel, void or sweep." }`
- **`05b-payout-send-operator-ownerOnly-refusal.txt`** — `POST ?send=1` with the **operator**
  token → `403 { "ok": false, "error": "the managed payer is owner-only — export the batch and sign it in your own wallet" }`. This fires *before* the dry-run check for an operator specifically,
  because the managed payer is gated to the owner regardless of dry-run status — a real, separate
  guard, not a bug.
- **`05c-payout-send-owner-dryrun-refusal.txt`** — the same `POST ?send=1`, this time with the
  **owner** key (so the operator-only guard above doesn't fire first) →
  `403 { "ok": false, "error": "poke is a DRY RUN — nothing accrues, so there is nothing to export, send, confirm, cancel, void or sweep." }` — the exact `&send=` refusal the roadmap item names,
  quoted verbatim.

### (7) The resulting public pages

To exercise `/programs/compare` with two real versions, a second placeholder version (v2,
effective the next day, a wider draft — 14-day minimum, 50 POKE minimum lock, 2,000 POKE/day pool)
was published the same way as v1. **Also a rehearsal placeholder, not real terms.**

- **Program / project page, after two versions —**
  `https://staging.clucknorris.app/hub/poke` (local: `127.0.0.1:3492/hub/poke`) —
  `06-hub-poke-project-page-after-v1-v2.png` + the raw body,
  `06b-api-hub-poke-after-v1-v2.json`. The dry-run badge is unchanged; a new
  "What changed between versions? →" link appears now that two versions exist. **There is no
  separate per-program detail page (`/hub/poke/p/:id`) to show** — that page only exists for a
  completed payout *program* (a batch with receipts), and POKEAHOE can never have one while it's a
  dry run (see step 6). The project root page is the whole story for a dry run, honestly.
- **Compare, two versions —**
  `https://staging.clucknorris.app/hub/poke/programs/compare?a=1&b=2` —
  `07-hub-poke-compare-v1-v2.png`. Shows exactly three changed fields (fixed daily pool, shortest
  lock term, minimum lock) and "11 unchanged fields," with links to each version's raw JSON and a
  reminder that "a hash commits to the published terms, not to intent."
- **`/hub/wallet/<a holder>` —**
  `https://staging.clucknorris.app/hub/wallet/8KBWkLZafQQNwvRCTtryqWX14vfS7UvmhigLuESnmtWg` (one of
  the real qualifying wallets from step 3's preview) — `08-hub-wallet-holder.png`. **Result: "No
  Hub program has seen this wallet yet."** This is correct, not a bug: the wallet roll-up
  (`GET /api/hub/wallet/:wallet`) reads a per-wallet *role* record that only gets written once a
  batch or receipt actually exists for that wallet — it is not a live eligibility check (that's
  what the preview/desk views show instead). Since POKEAHOE can never build a batch, this page is
  honestly empty for every POKEAHOE holder, forever, until the project goes live.
- **`feed.json` —** `https://staging.clucknorris.app/api/hub/poke/feed.json` —
  `09-hub-poke-feed.json`. Both version-publish events appear as feed items ("Program version 1
  published" / "…2 published"), each linking to `/api/hub/poke/program/<n>` and naming the
  version's hash in `content_text`.
- **The batch page without receipts — could not be produced for real POKEAHOE, and here is
  exactly why, not a workaround:** building a batch is refused at `&export=1` before a batch object
  ever exists (step 6). There is no dedicated batch HTML page in this codebase in any case — a
  batch's state is shown inline on the operator desk (`pendingBatches`) and on receipt pages once
  something settles. Captured the honest substitute instead: **`11-hub-poke-desk-no-batch-possible.json`**
  — the desk view for `poke`, showing `pendingBatches: []`, `owed: {}`, `accrual.slices: 0`. The
  closest thing to "a batch page without receipts" that this codebase can actually render is the
  **`/hub/demo` fixture's own Step D**, already captured in the main storyboard as
  `hub-demo-2-funding-batch.{mobile,desktop}.png` (`docs/DEMO_STORYBOARD.md`) — that fixture exists
  specifically because a real batch's "pending, nothing settled yet" state needs somewhere safe to
  be shown, and POKEAHOE is not that somewhere.
- **The glossary entry for the reason code that appeared —** `term_too_short` (from step 3's
  preview, where two real escrows failed to qualify under the 30-day floor) —
  `https://staging.clucknorris.app/hub/glossary#term_too_short` — `10-hub-glossary-term-too-short.png`.
  Definition: "No portion of this lock remains committed for at least the program's minimum term."

**Final assertion, after every write above:**

```
FINAL ASSERT dryRun == True
OK — dryRun still true at the end of the rehearsal
```

## 3. What worked

- **The dry-run guard is genuinely layered, not just a label.** Three independent places refuse to
  let a `dryRun: true` project accrue or pay: `lib/hub/engine.js` `arm()` (throws), the
  `/admin?arm=1` route (403 before the two-flag confirm is even checked), and the `/payout` route
  (403 on *every* mutating flag, not only `send`). A reviewer doesn't have to trust one check —
  three would all have to be wrong at once.
- **Preview and publish share one code path, provably.** The preview's version hash and the
  published version's hash were byte-for-byte identical for the same terms. That's not a claim to
  take on faith — it's the actual returned value, captured in both JSON files.
- **Launch Readiness genuinely projects real numbers from real chain data**, not a canned example —
  the scan found real POKEAHOE lock escrows (some belonging to wallets that look like project or
  treasury-adjacent addresses, which is exactly the kind of thing Rule B exclusions exist for once
  real terms are set).
- **The operator desk's signed-session flow works exactly as designed**, end to end, with a real
  ed25519 keypair signing a real challenge nonce — this wasn't shortcut with the test helper
  (`operator.issueToken()` called directly); it went through the actual challenge → sign → session
  HTTP round trip a real POKEAHOE operator would do.
- **The public pages (compare, wallet, feed, glossary) all read the same underlying state
  consistently** — the compare page's version hashes match the admin route's; the feed's version
  events match the versions actually published; nothing needed a second data path.

## 4. What confused (specific)

- **`accessTier` vs `tier`.** The first attempt to edit the project record via
  `POST /api/hub-registry?id=poke&accessTier=comped` silently did nothing useful — the field is
  read from the body as `b.tier`, not `b.accessTier`, so the access tier quietly fell back to
  `standard`/`unpaid` with no error at all (the request still returned `ok: true`). A field name
  that differs between the *outward* concept ("access tier") and the *query param* the route
  actually reads (`tier=`) is an easy trap for anyone driving this route by hand rather than
  through the desk UI, which presumably always sends the right key.
- **The wallet roll-up's "no program has seen this wallet" reads, on first glance, like the
  preview/scan found nothing** — it doesn't distinguish "this wallet was never eligible" from
  "this wallet is eligible right now but nothing has ever been paid, so nothing was ever
  recorded." A judge clicking straight from the preview's qualifying-wallet list to the wallet
  roll-up page, expecting to see "qualifies for POKEAHOE," would see a blank page instead and could
  reasonably wonder if the two features are connected at all. The distinction ("this page shows
  history, not live eligibility") is not stated anywhere on the page itself.
- **There is no dedicated per-program page for a project with a published version but no completed
  payout program** — `/hub/poke/p/:id` simply doesn't exist yet for POKEAHOE, and nothing on the
  project root page says "programs" here means something narrower than "anything ever configured."
  The copy ("No programs on record for this project yet") is honest but easy to misread as "no
  terms have been set" when in fact two versions of terms *are* set — "program" and "program
  version" are two different nouns in this codebase and the public page doesn't spell out the
  difference.
- **This rehearsal drove the desk's JSON API directly rather than the `/hub/poke/desk` HTML page.**
  The desk page's own client-side JS (how it turns a form submission into these exact query
  params, how it surfaces the readiness checklist visually) was out of scope for this pass — worth
  a follow-up rehearsal that clicks through the actual desk UI rather than curling its endpoints,
  since that is what a real POKEAHOE operator will actually use.
- **An extra click that will matter on the real go:** getting from "seeded dry-run project" to
  "can publish terms at all" required first giving the project a funding wallet and an operator
  wallet through the *owner*-gated registry route (`/api/hub-registry`) — a step that isn't part of
  the normal operator-desk flow and isn't documented anywhere as a prerequisite. On the real go
  this will be one deliberate owner action (setting POKEAHOE's real funding wallet once it's
  agreed), but it's worth naming explicitly in the sequence below so it isn't skipped or assumed
  automatic.

## 5. The exact sequence for the real go

**Everything up to and including "arm" is reversible right up until arming; arming is not.** This
list names the two-flag arming step so the owner recognizes it when the moment comes — it is
**not** performed here, and every step before it is exactly what this rehearsal exercised for
real, minus the placeholder-only fields.

1. **Owner and the POKEAHOE team agree real terms**, using the template in §6 below, in a real
   conversation — not a form filled in by an agent.
2. **Owner sets POKEAHOE's real funding wallet** (a wallet the POKEAHOE team controls and funds,
   never a treasury or mint-authority key — `CLAUDE.md`'s own rule for any operator float) and, if
   POKEAHOE will run its own desk session, a real operator wallet — both via
   `POST https://clucknorris.app/api/hub-registry?id=poke&fundingWallet=<real>&operatorWallets=<real>`
   (owner key required; this is the same call this rehearsal made, with real addresses in place of
   throwaway ones).
3. **The funding wallet is actually funded** with enough reward token to cover Launch Readiness's
   `budget` check — the check will `block` with `coverage <1.0x` otherwise, exactly as it did in
   this rehearsal's placeholder run.
4. **The POKEAHOE operator (or the owner, comping the project) publishes the agreed terms as v1**:
   `POST https://clucknorris.app/api/hub/poke/admin?terms=1&poolDailyRaw=...&sharePct=...&minDurationDays=...&maxTermDays=...&minLockRaw=...&payoutSchedule=...`
   — signed with a real operator desk session (challenge → sign → session, exactly as rehearsed
   above) or the owner's admin key.
5. **Preview the terms before publishing, if there's any doubt** —
   `POST https://clucknorris.app/api/hub/poke/desk/preview` with the same fields, unpublished, to
   see "who would this pay today?" against real holders before committing to the hash. (In practice
   this happens *before* step 4, not after — listed here in the order this rehearsal exercised it,
   which was preview-then-publish.)
6. **Run Launch Readiness and read every item, not just `ready`:**
   `GET https://clucknorris.app/api/hub/poke/readiness`. Every item must read `ok` except
   `commitment` (still `warn` until Addendum B5's on-chain memo exists for any real program) and,
   critically, **`dry_run` must no longer appear as a block** — which only happens once the owner
   flips `poke`'s project record so `dryRun` is no longer `true` (a `/api/hub-registry` edit, the
   owner's own act, done deliberately and separately from arming).
7. **Owner (never an operator) removes the `dryRun` label** on the project record, once terms are
   truly agreed and the funding wallet is truly funded — this is the point of no return for "this
   is a rehearsal," not yet for "money moves."
8. **Arm** — **named here, not performed by this rehearsal or by any agent without an explicit
   owner go in the moment:**
   `POST https://clucknorris.app/api/hub/poke/admin?arm=1&confirm=go-live` — the two flags are
   deliberate (`lib/hub/routes.js`: "arming needs `&arm=1&confirm=go-live` — two flags on
   purpose"), and Launch Readiness's `block` items are what stand between a stray call and a
   started emission: if any item still blocks, this call is refused with a 409 naming which ones.
9. **The accrual scheduler starts crediting hourly**, exactly the mechanism previewed in step (4)
   of this rehearsal, now actually persisted.
10. **The first real batch, export → operator's own signed send (or, if POKEAHOE opts into the
    managed payer, the owner's `&send=`)** — followed on the public side by the project page, the
    compare page (once a second version ever exists), the wallet roll-up (now populated, for real,
    once a batch settles), the feed, and the glossary — the same five surfaces this rehearsal
    walked, now showing real data instead of "dry run" and "no batches yet."

## 6. Terms sheet template — fields only, the owner fills this with the POKEAHOE team

No numbers below are pre-filled, suggested, or implied by anything in this document or in the
rehearsal above. The placeholder values used in §2 (30 days, 1,000 POKE/day, 100 POKE minimum,
etc.) are **not** proposals — they were chosen only to exercise the code paths and are not
repeated here.

| Field | What it decides | Owner + POKEAHOE team fill in |
|---|---|---|
| Funding wallet | The wallet that holds and signs off the reward pool. Must be distinct from any operator/desk wallet. | |
| Reward asset | The token holders are actually paid in — may differ from the locked mint (first release: one immutable reward asset per project). | |
| Fixed daily pool, OR share of a funding stream | Either a flat amount per day, or a percentage of the funding wallet's own vesting unlock that day (Rule B's "never unfundable" design) — pick one mechanism, not both. | |
| Share cap (`maxSharePct`) | The most the pool may ever draw as a percentage of the day's unlock, if using the share mechanism. | |
| Minimum lock duration to qualify | The shortest remaining committed term a lock needs to earn anything. | |
| Maximum term considered | The longest lock duration the program terms account for. | |
| Minimum amount locked to qualify | A floor below which a lock earns nothing, regardless of duration. | |
| Per-wallet share cap (`maxWalletSharePct`), if any | Whether any single wallet is capped from taking too large a share of the daily pool — 0 means off. | |
| Which lock shapes qualify | Any lock, cliff-only ("no vesting"), or vesting-only ("periodic release") — the team's call on what counts. | |
| Cancelable locks allowed? | Whether a lock the creator could still cancel is admitted at all. | |
| Payout cadence | Daily, weekly, monthly, at-unlock (paid when each lock finishes releasing), or manual. | |
| Exclusions beyond Rule B | Rule B (the funding wallet and every wallet that funds the pool) is always excluded automatically — name any additional wallets the team wants excluded, with the reason. | |
| Backdate handling | How far back a lock's first-seen date may be backdated, and the earliest date backdating is allowed from at all. | |
| Effective date | The UTC day the agreed terms take effect — must be today or later, and can't be moved once published. | |
| On-chain commitment (Addendum B5), when it ships | Whether the funding wallet will sign the memo committing this version's hash on-chain once that mechanism exists. | |
| Operator wallet(s) | Which wallet(s) may sign into POKEAHOE's own desk session, if the team wants to run their own payouts rather than have the owner comp/manage it. | |
| Platform access tier | Comped (owner's call) or the standard paid tier — decided separately from the reward terms themselves. | |

**A reminder while filling this in, not a number to fill:** none of these fields describe a yield,
an APR, or a guaranteed return — they describe a mechanism. "Earn potential" is the only honest
frame for anything this produces; what a holder can actually claim later is not what this template
promises, it's what the published terms plus the real chain end up showing, reproducibly, on the
Hub's own public pages once real terms are live.

## 7. On the storyboard inventory

`scripts/demo-storyboard-inventory-test.cjs` reads `docs/demo/2026-09-18/` **non-recursively**
(`fs.readdirSync`, one level) and fails if that directory contains anything — file *or
subdirectory* — that the storyboard doc's table doesn't name. Nesting this rehearsal's captures at
`docs/demo/2026-09-18/rehearsal/`, as first suggested, would have added exactly one such
unaccounted entry (the `rehearsal` directory itself) and broken that test regardless of anything
written into the storyboard doc — a subdirectory can never satisfy a check built around flat
filenames. So this rehearsal's captures live at the sibling path
**`docs/demo/2026-09-18-pokeahoe-rehearsal/`** instead, outside `docs/demo/2026-09-18/` entirely.
`node scripts/demo-storyboard-inventory-test.cjs` was re-run after adding these captures and is
still green, unmodified — no storyboard-doc edits were needed or made.

## 8. What this rehearsal could not do, and why

- **No real staging verification.** Everything above ran on a local boot of the merged tree, not
  `staging.clucknorris.app` — see §0. The URLs above are what an owner would click on staging or
  production; the local port is the actual origin of every capture.
- **No real chain WRITE of any kind** — no transaction was ever built, signed, or broadcast. The
  only chain interaction was read-only `getParsedAccountInfo`/lock-account scanning against public
  Solana RPC, which this container does have outbound access to (confirmed with a plain
  `getHealth` call before relying on it for anything).
- **No real POKEAHOE funding wallet or real terms** — those are the owner's and the POKEAHOE
  team's to agree; this rehearsal used throwaway, unfunded keypairs and placeholder numbers
  explicitly labeled as such everywhere they appear.
- **No per-program page or populated wallet roll-up for POKEAHOE** — both require a completed
  payout program, which a `dryRun: true` project can never have, by design. Documented in §2(7)
  rather than faked.
- **The desk HTML page's own client-side flow was not clicked through** — this rehearsal drove its
  underlying API directly. Named as a follow-up in §4, not silently skipped.
