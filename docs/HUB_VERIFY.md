# Verify the Project Hub yourself — a two-minute checklist for judges

**Don't run Node? Paste a receipt link into [`/hub/verify`](https://clucknorris.app/hub/verify)
instead** — the exact same reproduction (§b below), run in your own browser with no terminal and
no server call once the page has loaded. Every receipt page links to it. The checklist below is
for judges who want to run the commands themselves.

This is the reproduction the pitch is built on: *"lock with a project that published its terms,
and get a receipt you can reproduce yourself — from the published inputs, offline, without
trusting us."* Every command below runs on your own machine against real, public JSON. None of
it needs a wallet, a login, or anything from us beyond an HTTP request.

Written 2026-09-18. Re-read the note below before you start — some of these commands run against
production today, and some still run only on staging, honestly labelled either way.

**The reviewer's path, in order.** If you have fifteen minutes rather than two, this is the
sequence a judge or a second reviewer should actually click through, each stop building on the
last: [`/hub/judge`](https://clucknorris.app/hub/judge) (the map — which URL answers which
judging criterion, and the test that pins each claim) → [`/hub/status`](https://clucknorris.app/hub/status)
(what is live, on which host, at which commit, and how reproducible today) →
[`/hub/demo`](https://clucknorris.app/hub/demo) (the whole loop once, no wallet, on a labelled
dry-run fixture) → [`/hub/verify`](https://clucknorris.app/hub/verify) (reproduce one receipt
yourself) → **the evidence bundle** (§ below — the same reproduction, saved once, checked
offline forever) → [`/hub/wallet`](https://clucknorris.app/hub/wallet) (the same public record,
read by address instead of by project) → [`/hub/trust`](https://clucknorris.app/hub/trust) (what
none of the above proves, stated plainly). Everything after this paragraph is the detailed,
runnable version of the middle two stops (`/hub/verify` and the bundle) for a reader who wants to
run the commands themselves rather than click through the pages.

## What's live where, as of today (2026-09-18)

Railway auto-deploys both branches; the owner promotes `develop` → `main` by hand
(`CLAUDE.md`, "Branching"), so the two are not always in step. Checked directly against
`git log origin/main` vs `origin/develop`:

| On **production** (`https://clucknorris.app`) today | Staging-only (`https://staging.clucknorris.app`) today, awaiting promotion |
|---|---|
| `GET /api/hub`, `GET /api/hub/:project`, `GET /api/hub/:project/wallet/:wallet` — but **without** the `$schema` field this doc's `hub-validate.cjs` reads (that landed with the schemas themselves) | `GET /hub/schema/:name.json` (the JSON Schemas), and the `$schema` field stamped onto the project/receipt bodies above |
| `GET /api/hub/:project/r/:sig` (the legacy receipt shape — see §g) | `GET /api/hub/:project/batch/:batchId/inputs`, `GET /api/hub/:project/reproducibility` |
| `GET /api/hub-pricing` | `GET /hub/demo`, `GET /api/hub-demo*` (the no-wallet fixture walkthrough) |
| `/hub`, `/hub/:project` pages | `GET /api/hub/:project/p/:compId/standings` (Buy Special), `GET /api/airdrop/r/:dropId` |
| | `GET /api/hub/:project/readiness` (Launch Readiness), on-chain commit routes, the POKEAHOE branded page |
| | `GET /api/hub/:project/batch/:batchId/bundle` and `GET /api/hub-demo/:project/batch/:batchId/bundle` (AA2, the evidence bundle above) |

**Practically: every step below needs `staging.clucknorris.app` today.** Production has real Hub
data you can browse (`GET /api/hub/:project`, receipts by signature), but the schema, the
reproduction inputs and the `$schema` field all shipped together in one later batch that hasn't
been promoted yet — so a schema-validation or reproduction command pointed at production today
runs honestly into a 404 or a `MISSING_INPUTS`, not a fabricated pass. The commands below take
either host as `$HOST` so they start working against production the moment the owner promotes,
with no edits needed.

```bash
export HOST=https://staging.clucknorris.app   # or https://clucknorris.app once promoted
```

## Save the evidence bundle first

The fastest way to check a settlement, and what every batch/receipt page now links to
("download the evidence bundle"): one JSON download that carries the program version, the
batch's published inputs, and every settled receipt in it — save it once, verify it forever, with
no further `curl`s needed for this batch (AA2, `docs/COLOSSEUM_ROADMAP.md` §11).

```bash
curl -s "$HOST/api/hub/cuna/batch/<batchId>/bundle" > bundle.json
```

Verify it two ways, both fully offline once you have the file:

- **The script:** `node scripts/reproduce-receipt.cjs --bundle bundle.json` — prints whether the
  file's own hash still matches what is printed inside it (a mismatch means the file was altered
  or truncated after it was built — the script still reproduces every receipt in it regardless),
  then one MATCH / MISMATCH / MISSING_INPUTS line per receipt in the batch, and a batch-level
  count at the end.
- **The page:** drop `bundle.json` straight onto [`/hub/verify`](https://clucknorris.app/hub/verify)'s
  "From saved files (offline)" tab — the exact same two checks, in your own browser, no terminal.

A batch that has not been settled yet still downloads — the bundle says `settled:false` and gives
a plain-words note (never a fabricated receipt). A bundle's matching hash proves the file is
intact, not that the program itself was fair — that is exactly what (d) and (e) below are for.

## (a) Fetch a project's public JSON and validate it against its own schema

Every schema'd Hub body carries a `$schema` field pointing at exactly the URL that serves its
schema (`lib/hub/README.md` §4) — nothing to look up out of band.

```bash
curl -s "$HOST/api/hub/cuna" | head -c 400
curl -s "$HOST/hub/schema/project-public.json" | head -c 200
```

Validate the two against each other with the repo's own dependency-free validator
(`lib/hub/schema-validate.js` — the exact subset of JSON Schema these schemas use: `type`,
`required`, `properties`, `additionalProperties`, `enum`, `items`, `pattern`; the same code
`scripts/hub-schema-test.cjs` runs in CI, so there is one checker, not two that could drift):

```bash
node scripts/hub-validate.cjs "$HOST/api/hub/cuna"
```

Expect `result: VALID`. A body with nothing to validate against yet (`GET /api/hub`'s thin index,
a `wallet` lookup, a `standings`/`readiness` body — none of those are schema'd, `lib/hub/README.md`
§4/§5 says exactly which are) reports that plainly (exit code 3) rather than a false pass.

## (b) Reproduce a receipt's amount from the published inputs

```bash
curl -s "$HOST/api/hub/cuna" | grep -o '"sig":"[^"]*"' | head -1   # grab a settled signature
node scripts/reproduce-receipt.cjs "$HOST/hub/cuna/r/<sig>"
```

The script fetches only public JSON (the receipt, then the batch's published inputs for that
wallet — `GET /api/hub/:project/batch/:batchId/inputs?wallet=`) and re-derives the amount with
the same pure functions the server runs (`lib/hub/reproduce.js`), on your machine — there is no
"verify with us" call. It prints `MATCH`, `MISMATCH` (the derived amount disagrees — say so, do
not paper over it), or `MISSING_INPUTS` (names exactly which input is absent) and exits `0` / `2`
/ `3` respectively. Pointed at `clucknorris.app` today it will report `MISSING_INPUTS` — not
because anything is wrong, but because the batch-inputs route it needs hasn't been promoted to
production yet (see the table above); that is the honest answer, not a workaround to avoid.

A **Buy Special** receipt reproduces the same way but from the sealed public standings instead of
a raw ledger (there is no batch/wallet ledger for a buy competition the way lock-to-earn has):

```bash
node scripts/reproduce-receipt.cjs "$HOST/hub/rose/r/<sig>"   # auto-detects program.kind === "buy-comp"
```

## (c) The same reproduction with zero network calls

Save the inputs once, then reproduce fully offline — the point of "offline" is that nothing here
requires trusting a live server to answer honestly at the moment you check it:

```bash
curl -s "$HOST/api/hub/cuna/r/<sig>"                                             > receipt.json
curl -s "$HOST/api/hub/cuna/batch/<batchId>/inputs?wallet=<wallet>"              > batch-inputs.json
node scripts/reproduce-receipt.cjs --offline . cuna <batchId> <wallet>
```

(`batchId` and `wallet` come out of `receipt.json` itself.) Same exit codes as (b). This is also
how you would archive a receipt's proof before a route or a server disappears.

## (d) Recompute a program version's hash yourself

A program version's `hash` is `sha256` of the *canonical* JSON of its terms (`lib/hub/project.js`
`canonicalJson`/`sha256`/`verifyVersionHash`): every object's keys sorted, BigInts stringified,
and — because `effectiveTo` is bookkeeping added after a version is superseded, never part of
what was originally signed — forced back to `null` before hashing. **CUNA's lock-to-earn program
predates this versioning** (it still runs on the older `lib/cuna-payout.js` path — CLAUDE.md,
"CUNA on the Hub — HELD" — so its `programs[]` entry above carries no `hash`/`terms` at all); use
a project that actually carries a version, which the always-available no-wallet fixture does:

```bash
curl -s "$HOST/api/hub-demo/demo" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['project']['version']))" > version.json
node -e '
const crypto = require("crypto");
const body = require("./version.json");
const { hash, effectiveTo, commitment, ...rest } = body;
const canon = (v) => (typeof v === "bigint") ? JSON.stringify(v.toString())
  : (v === null || typeof v !== "object") ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const got = crypto.createHash("sha256").update(canon({ ...rest, effectiveTo: null }), "utf8").digest("hex");
console.log(got === hash ? "MATCH: " + got : "MISMATCH: got " + got + ", body says " + hash);
'
```

(The public `GET /api/hub/:project` view does not surface a version's `hash` for any project
today, real or legacy — only the gated operator desk (`GET /api/hub/:project/desk`) and the
self-serve preview (`POST /api/hub-apply?preview=1`) carry the full version shape this algorithm
needs; the demo fixture above is the one place it's public with no key. `lib/hub/README.md` §4
lists exactly which route carries which shape.)

## (e) Check the on-chain commitment, once one exists

Independent commitment (design Addendum B §B5 / roadmap E3) works like this: the project's
**funding wallet** signs a Memo-program transaction whose text is exactly

```
clkn-hub:v1:<projectId>:<version>:<sha256 hash>
```

(`lib/hub/commit.js`). The server only upgrades a program page's wording from "reproducible from
the published inputs" to "independently committed" after it has *observed* that memo landed
on-chain with the funding wallet as fee payer — never before, and the two routes that do the
signing and observing (`POST /api/hub/:project/commit/build`, `…/commit/observe`) are in the
mutating-GET-guard inventory like every other admin action.

**As of today, none has been signed for real** (E3 ships dry-run first, `docs/hub/commitments.md`
is empty of real entries) — so there is nothing to check on an explorer yet, and that is the
honest state, not a gap in this doc. Once one exists, verify it yourself with no server involved:
open the funding wallet's transaction history on
[Solscan](https://solscan.io) or [Solana Explorer](https://explorer.solana.com), find the
signature the program page names, open its Memo instruction, and read the text — it must match
the string above exactly, character for character, with the fee payer equal to the funding wallet
the project page names.

## (f) Dry-run caveats — read before you go looking for real money

Two things on the Hub are **always** a rehearsal, clearly marked, and excluded from every count:

- **`/hub/demo` and `/hub/demo-b`** — a fixture project, fully derived from the real Hub libraries
  over fabricated addresses. Every JSON body it serves carries `dryRun: true`; nothing here ever
  touches the real registry, the real kv store, or a chain call. Use it to see the whole loop
  (program version → a holder qualifying under a stated rule → funding coverage → a batch → a
  receipt → reproducing it) without needing a real wallet or a real project's numbers.
- **POKEAHOE (`/hub/poke`)** — a real, branded project page seeded as `dryRun: true` while terms
  are still being agreed with the team. Nothing accrues and nothing can be armed for it
  (`lib/hub/readiness.js` blocks arming on the `dry_run` item unconditionally); the page says so.

Neither project ever appears in `GET /api/hub`'s totals, the Lock of Fame, or the traction
counters — a dry run adds nothing to any number this doc or the submission cites.

## (g) What is honestly NOT verifiable yet

Say this plainly rather than let a reader assume more than what's built. The plain-words version
of every bullet below is on the trust-boundary page, `/hub/trust` (AA5) — the `<!-- boundary: … -->`
markers pin that the two never drift apart (`scripts/hub-trust-doc-test.cjs`).

<!-- boundary: hash-served-by-server -->
- **A program-version hash is served by the same server that computes the payout.** Recomputing
  it (§d) proves the server didn't change the terms out from under you after publishing them —
  it does not prove the server omitted no qualifying escrow from the calculation in the first
  place. That second guarantee is exactly what (e)'s on-chain commitment is for, and it isn't live
  for any real program yet.
<!-- boundary: giveaway-not-reproducible -->
- **Giveaway rows (the CUNA sealed-draw giveaway) do not reproduce.** `reproduce-receipt.cjs`
  handles `lock-to-earn` and `buy-comp` receipt kinds only; a giveaway kind reports
  `MISSING_INPUTS` naming that reproduction isn't implemented for it, rather than guessing at a
  number. The legacy Buy Special *draw* (pre-Hub, paid through the airdropper) carries the same
  honest note on its own page: no receipts were journaled for it.
<!-- boundary: journal-not-live -->
- **The Addendum-B settlement journal isn't the live payout path yet.** Every receipt you can
  fetch today (including through this doc) is still the pre-journal shape — a single payout row,
  not the append-only per-transfer ledger `receipt.schema.json` documents. The journal is built
  and unit-tested but sits on its own money-path pull request under two-lens review before it is
  wired into the live route (`lib/hub/README.md` §5, §6); the review found real gaps (a transfer's
  *source* is never checked, and a lost-write race under concurrent requests) that block it from
  merging as-is. Nothing above is affected — none of it depends on that PR.
<!-- boundary: ratio-incomplete -->
- **The reproducibility ratio doesn't yet cover every program kind.** `GET
  /api/hub/:project/reproducibility` counts lock-to-earn and buy-comp rows; giveaway rows are
  named as not implemented rather than silently excluded from the denominator.

---

Related reading: [`lib/hub/README.md`](../lib/hub/README.md) (the entities and invariants in
plain words), [`docs/COLOSSEUM_ROADMAP.md`](COLOSSEUM_ROADMAP.md) §7/§8/§11 (E1–E10, X1–X7, AA5),
[`docs/PRE_EVENT_STATE.md`](PRE_EVENT_STATE.md) (what predates the hackathon window), and
[`/hub/trust`](https://clucknorris.app/hub/trust) — this file's §(g) in plain words, for a holder
rather than a judge running commands.
