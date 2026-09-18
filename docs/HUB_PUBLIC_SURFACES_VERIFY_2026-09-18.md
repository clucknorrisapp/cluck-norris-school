# Hub public surfaces — adversarial read-only pass (roadmap §14 DD5)

**Date:** 2026-09-18 · **Branch:** `develop` at `4a1475b` (batch 12, #350) · **Scope:** read-only.
No code was changed. This document is the only file this pass commits.

**Method.** Booted the real `server.js` on port 3380 against a throwaway `DATA_DIR` seeded
directly into `app-state.json` (the same technique `scripts/hub-og-test.cjs` uses for its hostile
label), carrying:

* `xtest` — 9 decimals, label/tagline/brand fields set to
  `<script>alert(1)</script>"'&$&% ‮evil`, plus `operatorWallets`, an `access` block with
  `paidThroughUnix`, a `payoutSourcesHistory` and a `desk.sessionSecret` — all fields that must
  never reach a public body. Two published program versions, one settled batch, two receipts.
* `sixdec` — 6 decimals, one settled receipt worth `1234567` raw (= `1.234567` UI).
* `bigproj` — 300 wallets × 3000 hourly accrual slices × 30 batches (≈4 months of hourly
  accrual), for the load measurements.
* Two holder snapshots for `xtest`'s mint, in the exact shape `lib/owners-snapshot.js` writes.

Driven with `curl` and Playwright (Chromium). The `/hub/verify` cross-origin case was reproduced
with Playwright route interception so the fetch was a real `https:` response (the site's CSP is
`connect-src 'self' https: wss:`, so any https host is permitted).

---

## Verdict table

| Surface | Verdict |
|---|---|
| `/hub/verify` + `hub-verify.bundle.js` + bundle drop + URL path | **FINDINGS (2)** — P1-01, P1-02 |
| `/hub/status` + `/api/build` + sparkline + badge embed | CLEAN |
| `/hub/wallet`, `/hub/wallet/:wallet`, `GET /api/hub/wallet/:wallet` | **FINDINGS (1)** — P1-03 |
| `/hub/trust` | CLEAN |
| `/hub/judge` (generated from markdown) | **FINDINGS (1)** — P2-07 |
| `/hub/:project/programs/compare` + `versions[]` on `/api/hub/:project` | CLEAN |
| Holders history + Compare panels (`/holders?mint=`, `/api/holders/snapshots*`) | **FINDINGS (1)** — P2-06 |
| `GET /api/hub/badge.json` + `/hub/badge.svg` | CLEAN |
| `GET /api/hub/:project/reproducibility/history` | CLEAN |
| Evidence bundle routes (+ demo twin) | CLEAN |
| `GET /api/hub/:project/batch/:batchId/inputs` (full program version) | CLEAN |
| i18n dictionary route (`/i18n/<lang>[.school\|.locker].json`) | CLEAN |
| `/og/hub-card.png` + per-request OG meta swap | **FINDINGS (1)** — P3-09 |
| `/receipt` in Telegram (`lib/hub/receipt-command.js`) | **FINDINGS (1)** — P3-10 |
| `/api/track` `hub_bridge_click` + `hub_lesson_read` | **FINDINGS (1)** — P1-04 |
| Route/project-id shadowing (`RESERVED_PROJECT_IDS` vs. develop) | **FINDINGS (1)** — P2-05 |
| Generic: `/api/hub`, `/api/hub/:project`, `/hub/:project` page | **FINDINGS (1)** — P1-03 |

**P0: 0 · P1: 4 · P2: 3 · P3: 3** (10 findings).

The P1 ranking follows the brief's rubric where it fits (P1-02 is a wrong money figure on a public
page; P1-01 is trust-surface spoofing on our own origin). The two availability findings (P1-03,
P1-04) are ranked P1 on measured impact — both are unauthenticated and one writes durable state —
rather than because the rubric names a DoS tier.

---

## P1 — trust surface and availability

### P1-01 · `/hub/verify?receipt=` fetches and renders a verdict from any origin the link names

`public/hub-verify.html:216` (`return { host: url.origin, … }`) and `public/hub-verify.html:348`
(`var preUrl = …get('receipt'); if (preUrl) { … reproduceFromUrl(preUrl); }`).

`parseReceiptUrl()` accepts any absolute URL whose *path* matches `/hub/<project>/r/<sig>` and
keeps `url.origin` verbatim; `reproduceFromUrl()` then fetches the receipt, the batch inputs and
(via `schemaLine`) the `$schema` URL from that origin. The `?receipt=` query parameter auto-runs
it on page load, so the whole flow is reachable from a single shared link.

**Reproduction** (`.scratch/verify-spoof.cjs`, Playwright intercepting `https://evil.example/**`):

```
GET /hub/verify?receipt=https%3A%2F%2Fevil.example%2Fhub%2Fcuna%2Fr%2FMYjv…HUf
page fetched: https://evil.example/api/hub/cuna/r/MYjv…HUf
              https://evil.example/api/hub/cuna/batch/evil-batch/inputs?wallet=DSft…BQdr
rendered on the clucknorris origin:
   MATCH
   cuna · DSft7…BQdr
   This amount is exactly reproducible from the inputs the server published.
   PUBLISHED AMOUNT   999999500000000 CUNA
   REPRODUCED AMOUNT  999999500000000 CUNA
```

The attacker supplies both the "published" amount and the inputs, so `reproduce()` agrees with
itself and prints MATCH. The project name beside the badge is taken from the pasted path, so the
card reads `cuna`. This is the one page the pitch sends judges and holders to in order to
*disbelieve* us; a `clucknorris.app/hub/verify?receipt=…` link that shows a green MATCH for a
payment that never happened inverts exactly that.

**Fix:** resolve the receipt URL against an allowlist of Hub origins (this origin plus the known
staging host, from a constant), and show the host it fetched from beside the verdict for anything
that is not this origin.

### P1-02 · `/hub/verify` prints the published and reproduced amounts in raw base units

`public/hub-verify.html:279` (URL + files tabs, `renderVerdict`) and `public/hub-verify.html:486`
(bundle tab, `renderBundleResults`): both emit `esc(r.published)` / `esc(r.reproduced)` — the raw
base-unit strings `HubVerify.reproduce()` returns — and append the token symbol. The per-hour step
rows immediately above run `fmtAmount(raw, decimals)` and are correct, so one card shows the same
payout in two different units.

**Reproduction** (`.scratch/verify-real.cjs`, real fixture receipts, same-origin):

```
xtest (9 decimals)
  API  /api/hub/xtest/r/<sig>   receipt.amountUi = "1.5"
  page /hub/verify              steps: + 1 , + 0.5
                                PUBLISHED AMOUNT   1500000000 XTE
                                REPRODUCED AMOUNT  1500000000 XTE

sixdec (6 decimals)
  API  /api/hub/sixdec/r/<sig>  receipt.amountUi = "1.234567"
  page /hub/verify              steps: + 1.234567
                                PUBLISHED AMOUNT   1234567 SIX
                                REPRODUCED AMOUNT  1234567 SIX
```

The Hub page, `/api/hub/:project` and the receipt route all say `1.5 XTE`; `/hub/verify` says
`1500000000 XTE`. It is also inconsistent *within* the page: the `buy-comp` branches pass
`receiptBody.receipt.amountUi` (already UI units) into the same two fields, so "published amount"
means base units for lock-to-earn and whole tokens for a buy competition.

**Fix:** run both values through the existing `fmtAmount(raw, decimals)` with the decimals the
page already has in hand (`inputsBody.decimals`, already passed to `stepsForLockToEarn`), and
normalise the buy-comp branches onto the same unit.

### P1-03 · The heaviest Hub reads are the ones with no rate limiter; ten concurrent hits stall the whole server

`server.js:8127` (`/api/hub`), `server.js:8159` (`/api/hub/wallet/:wallet`), `server.js:8191`
(`/api/hub/:project`), `server.js:8822` (the `/hub/:project` share page) — none carries
`rateLimit("hubheavy", …)`, while `/api/hub/badge.json`, `/api/hub/:project/reproducibility`,
`…/batch/:id/inputs`, `…/bundle` and `/api/holders/snapshots` all do. Every one of the four
unlimited routes calls `hubProjectView()`, which builds the full `stakeView` including the
per-receipt `explanation` attribution (`lib/hub/public.js` `stakeView` → `lib/hub/explain.js`),
replaying every batch over every accrual slice. `/api/hub` and `/api/hub/wallet/:wallet` do it
once **per registered project**. `/api/hub/wallet/:wallet` is additionally `no-store`, and its
wallet segment is attacker-chosen, so no cache tier can ever absorb a repeat.

**Reproduction** (`.scratch/load.sh`, against the 300-wallet × 3000-slice fixture):

```
serial:   /api/hub/wallet/<addr>   1.02s, 1.00s, 1.00s      (no limiter)
          /api/hub/bigproj         1.06s / 1.31 MB          (no limiter)
          /api/hub                 1.05s                    (no limiter)

80 rapid GET /api/hub/wallet/<addr>   ->  80 × 200   (never limited)
80 rapid GET /api/hub/badge.json      ->  60 × 200, 20 × 429

10 concurrent GET /api/hub/wallet/<addr>:
          GET /healthz under load ->  9.83 s
          GET /healthz idle       ->  0.0008 s
```

Ten unauthenticated requests from one client take `/healthz` from sub-millisecond to ten seconds:
the Node event loop is fully occupied, so *every* route on the site — the school, the tools, the
store-edition contract endpoints — stalls behind them. Cost scales with the ledger
(200 wallets × 1000 slices measured 0.19 s; 300 × 3000 measured 1.0 s ≈ 1.1 µs per credit entry),
so today's live CUNA ledger is far smaller than the fixture and the present-day cost is closer to
0.1 s — this grows linearly with every hour the programme accrues.

**Fix:** put `rateLimit("hubheavy", …)` on all four (the `/hub/:project` page included), and
memoise `hubProjectView(p)` per project for a few seconds the way `HUB_REPRO_CACHE` already does
for the reproducibility computation.

### P1-04 · `POST /api/track` lets anyone mint unbounded `hub_lesson_read` project keys and move the traction number

`server.js:18333` (route, no rate limiter), `server.js:18350`
(`/^hub_lesson_read:([a-z0-9-]{1,48})$/` — the captured project id is never checked against the
registry), `lib/traction.js:161` (`recordHubLessonRead`).

The same function bounds every *other* free-text dimension on purpose — `lesson` against
`KNOWN_LOCK_LESSON_IDS` ("so a script can't grow that key space"), `from`/`to` against
`HUB_BRIDGE_FROM`/`HUB_BRIDGE_TO`, `source` against `school|home` — but `project` has no such
bound. It also never calls `pruneByDay()` before writing (unlike `recordReceiptOpen` and
`recordWalletConnect`), so `KEEP_DAYS = 400` is not applied to this key at all; the same is true
of `HUB_DOOR_CLICKS_KEY` and `HUB_BRIDGE_CLICKS_KEY`.

**Reproduction** (60 unauthenticated POSTs, no key, no pass):

```
for i in $(seq 1 60); do
  curl -s -X POST http://127.0.0.1:3380/api/track -H 'content-type: application/json' \
    -d "{\"event\":\"hub_lesson_read:zzattack$i\",\"sid\":\"s$i\",\"lesson\":\"receipt\"}"
done
# kv traction:hub_lesson_reads_v1 -> 2026-09-18: 60 keys, all zzattack*
```

Two consequences. (a) Storage: each distinct id is a new key holding up to `MAX_PER_BUCKET = 5000`
hashes per day, in the single `app-state.json` that is rewritten on every `kv.set` and parsed whole
at boot — unbounded growth plus write amplification. (b) Integrity: `lib/traction.js:446-460` sums
`hubLessonReads` across *every* project key, so the platform-wide "school → Hub lesson reads"
figure can be inflated at will, and `labelFor(hlrIds)` (line 274) flips its provenance word from
`founder-operated` to `independent`/`mixed` because the fabricated ids are not in `FOUNDER_IDS`.
That is precisely the honesty claim the traction report exists to make.

**Fix:** drop a `hub_lesson_read:<id>` whose id is not a registered Hub project (the same check
`lesson`/`from`/`to` already get), prune by day on write, and rate-limit `/api/track`.

---

## P2

### P2-05 · Five page ids on `develop` are approvable as project ids and would take a project's page away

`server.js:8903` — `reservedMints: () => ({ clkn, cuna, rose, demo: null, "demo-b": null, wallet: null })`
is the whole reserved set on `develop`; there is no `RESERVED_PROJECT_IDS` in this tree (the
journal branch's list, `git show origin/claude/hub-settlement-journal:lib/hub/project.js`, has
thirteen entries: `apply, verify, status, wallet, trust, judge, schema, registry, hub, demo,
demo-b, settle, badge`). `lib/hub/store.js` `ID_RE` accepts all of them, and
`lib/hub/routes.js:579` only refuses ids present in `reserved()`.

**Reproduction** — which `/hub/<id>` paths are literal pages registered ahead of the
`/hub/:project` catch-all at `server.js:8822`:

```
verify   -> <title>Reproduce a Hub receipt</title>              (server.js:8644)
status   -> <title>Hub Status — what is live, where</title>     (server.js:8808)
trust    -> <title>What The Hub Doesn't Prove</title>           (server.js:8655)
judge    -> <title>The Judge's Fifteen Minutes …</title>        (server.js:8664)
apply    -> <title>Run Lock to Earn for your token …</title>    (server.js:8613)
wallet   -> (already reserved)      demo / demo-b -> (already reserved)
schema, settle, badge, registry, hub, programs, pay, desk -> the real Hub page (not shadowed)
```

A project approved as `verify`/`status`/`trust`/`judge`/`apply` would have a working
`/api/hub/<id>` and working `/hub/<id>/p/:program` and `/hub/<id>/r/:sig` pages, but its own front
page would serve a different tool entirely. Not a data leak — the ordering means the page always
wins — but a live project with a broken canonical URL. `lib/hub/routes.js:550` already notes the
same hazard for the API side ("the public `/api/hub/:project` would read `apply` as a project")
and dodged it with `/api/hub-apply`; the page side was never given the matching list.

**Fix:** port the journal branch's `RESERVED_PROJECT_IDS` into `lib/hub/project.js` and consult it
from `approveProject` and `server.js`'s `reserved()`, with a test that greps `server.js` for the
literal `/hub/<segment>` routes it must cover.

### P2-06 · The holders Compare panel mixes whole-token and base-unit values in one card

`public/token-holders.html:681` (`const dec = lastSnapshot ? lastSnapshot.decimals : undefined`),
`:690`/`:697` (supply delta), `:705`/`:707`/`:711` (`fmtNum(Number(r.amountRaw), dec)`),
`lib/holders-snapshot.js:181/187/201` (the `amountRaw`/`fromRaw`/`toRaw`/`deltaRaw` names).

`lib/owners-snapshot.js:530-535` stores `top[].amount` as `p.balance`, which is **UI whole
tokens** (`lib/owners-snapshot.js:273` divides by `10 ** decimals`). `diffSnapshots` then re-labels
those values `amountRaw`/`fromRaw`/`toRaw`/`deltaRaw` — names that mean base units everywhere else
in this repo — while `supplyDelta` really is base units (`totalSupplyRaw` from `getTokenSupply`).
The page renders both unconverted.

**Reproduction** (`/holders?mint=3GViwAPcq4HWjxBQdr5JXkyCRes6KYmzDSft7LZn1ETg`, 9-decimal mint,
two seeded snapshots; supply moved by exactly 1,000,000 whole tokens, one holder by 500,000):

```
API  /api/holders/snapshots/1000_aaaaaa/diff/2000_bbbbbb
       "supplyDelta": "1000000000000000"          <- base units
       "held":[{"fromRaw":"1000000","toRaw":"1500000","deltaRaw":"500000"}]   <- whole tokens

page COMPARE panel
       Holder count: 2 → 2 (0) · Total supply change: +1000000000000000
       HELD  Res6KY…Pcq4   1.00M → 1.50M   GREW (500000)
```

Same card, same token: the holder moved "500000", supply moved "1000000000000000". Separately,
`dec` is *always* `undefined` on a `?mint=` deep link — `lastSnapshot` is only assigned at line 551
after a live `/api/snapshot` crawl, which is tools-pass gated, while the history and Compare panels
load ungated from the mint alone. `fmtNum` never divides by decimals, so today the holder columns
happen to read correctly only because the stored values are already whole tokens.

Also worth recording under the same cause: `canonicalHolderList` (`lib/holders-snapshot.js:38`)
does `Math.round(Number(...))` over those whole-token values, so the `listHash` the page tells a
reader to "recompute it yourself" over is taken across **rounded whole tokens** — every holder
under 0.5 tokens hashes as `0`, and sub-token differences are invisible to it.

**Fix:** convert `supplyDelta` with the snapshot's own decimals before display (and record
`decimals` on the snapshot record so the panel does not depend on a gated crawl), and rename the
diff's `*Raw` fields to say what they hold.

### P2-07 · The generated judge page has no URL-scheme allowlist

`scripts/build-judge-page.cjs:51` —
`s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${url}">${text}</a>`)`.

`escapeHtml()` runs first, so attribute breakout is genuinely blocked, but nothing checks the
scheme. A markdown link in `docs/JUDGE_GUIDE.md` therefore becomes a live `javascript:` or `data:`
href on the committed, publicly served `public/hub-judge.html`.

**Reproduction** (`node -e` against the module's own export):

```
renderInline('[open](javascript:alert(document.domain))')
  -> <a href="javascript:alert(document.domain">open</a>)
renderInline('[x](" onmouseover=alert(1) x=")')
  -> <a href="&quot; onmouseover=alert(1">x</a> x=&quot;)      (breakout blocked — good)
```

A paren-free payload (`[go](javascript:location='https://…')`) survives intact: `'` is escaped to
`&#39;`, which the HTML parser decodes back inside the attribute.

**Fix:** in `renderInline`, keep the link only when the URL starts with `/`, `#`, `https://` or
`mailto:`; otherwise render the text and drop the anchor.

---

## P3

### P3-08 · `HubSparkline.render()` falls back to an identity escaper

`public/hub-sparkline.js:29` — `var esc = opts.esc || function (s) { return String(s); };`. Both
current callers (`public/hub.html:380`, `public/hub-status.html:141`) pass `CluckUtil.esc`, and the
only value that reaches the `<title>`/`aria-label` is a server-generated `YYYY-MM-DD` day key, so
nothing is exploitable today. But a shared renderer whose default is "do not escape" is one
forgetful call site away from an SVG injection, and the file's own header says it exists so the
render logic lives in exactly one place. **Fix:** make the fallback escape, or throw when `opts.esc`
is missing.

### P3-09 · Bidi control characters survive into `<title>`, OG meta and rendered text

`lib/hub/project.js:50` bounds a project `label` by length only — no character class — while
`lib/hub/brand.js:34` strips C0 controls from a tagline and refuses `<`/`>`. Neither touches the
Unicode bidi overrides (U+202A–U+202E, U+2066–U+2069). `escHtml` and `ogClamp`
(`server.js:8684`, which normalises whitespace) pass them through unchanged.

**Reproduction** — a label ending `‮evil`:

```
GET /hub/xtest
<title>&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;$&amp;% ‮evil ($XTE) — Project Hub</title>
<meta property="og:description" content="…&#39;&amp;$&amp;% ‮evil: 2 receipts across 1 program …">
```

Playwright confirms the RLO reaches rendered body text on `/hub`, `/hub/:project`, `/hub/status`
and `/hub/wallet/:wallet`. The label is owner-approved, but the character is invisible in the
approval UI, so the string the owner reads is not the string a share card renders. **Fix:** strip
`[‪-‮⁦-⁩‎‏]` in `validateProject`'s label (and `brand.tagline`).

### P3-10 · The `/receipt` cooldown map is unbounded, and each lookup does the P1-03 walk

`lib/hub/receipt-command.js:159` — `handleReceiptCommand._defaultCooldown` is a process-lifetime
`Map` keyed by `chatId` with no eviction; every chat that ever runs the command holds an entry
forever. More materially, `findHubReceiptBySig` (line 63) calls `hubProjectView(project)` for
**every registered project** until it finds the signature — the same full-ledger walk measured at
~1.0 s per project in P1-03 — behind only a 10-second per-chat cooldown, so N rooms give N/10
walks per second. **Fix:** bound the map (or key the cooldown off a small LRU), and reuse the same
memoised project view P1-03's fix introduces.

Everything else asked for on this surface held: the reply escapes `project.label` and `symbol`
with the shared `escHtml`, the module passes no `roseRoomOk` so an OnlyRose reply is refused at
`tgApi()` (`lib/telegram-rooms.js`), the cooldown is charged only for a well-shaped signature
(a usage reply is free and touches no store), and `server.js:2657` wires it with the plain
`tgSend`.

---

## Defences that held

* **No private field reached any public body.** With `operatorWallets`, `access.paidThroughUnix`,
  `access.note`, `payoutSourcesHistory` and a `desk.sessionSecret` all seeded onto the project
  record, none appeared in `/api/hub`, `/api/hub/:project`, `/api/hub/wallet/:wallet`,
  `/api/hub/:project/wallet/:wallet`, `/api/hub/:project/r/:sig`, `/api/hub/:project/batch/:b/inputs`,
  `/api/hub/:project/batch/:b/bundle`, `/api/hub/:project/reproducibility[/history]`, the badge
  routes or the OG meta. `lib/hub/public.js`'s whitelist-never-filter discipline is doing its job.
  The funding wallet *does* appear, but only inside `programVersionView(v, {full:true})`
  (`fundedBy`, `excludeWallets`, `fundingResponsibility`, `signer`) — fields the version hash is
  taken over, so they have to be published for "recompute the hash" to be possible at all.
* **XSS.** A hostile label, tagline, brand logo and social URL rendered on `/hub`, `/hub/:project`,
  `/hub/:project/programs`, `/hub/:project/programs/compare`, `/hub/status`,
  `/hub/wallet/:wallet`, `/hub/demo` and `/hub/:project?wallet=` produced **zero** dialogs, zero
  injected `<script>` nodes and zero injected event handlers (Playwright, `window.alert` hooked and
  the DOM inspected). Every Hub page aliases `CluckUtil.esc` — no hand-rolled copy. The OG swap uses
  `escHtml` and, correctly, **function** replacements (`server.js` `renderHubOgHtml`), so a literal
  `$&` in a label is not read as a backreference. `/hub/badge.svg` is built only from integers this
  server computed plus fixed words, and still `escHtml`s every text node. And in production
  `lib/hub/brand.js` would have refused my seeded brand outright (remote logo URL, `<`/`>` in the
  tagline, a non-https/wrong-host social) — the seed bypassed it by writing kv directly.
* **Cache headers.** Nothing that varies per viewer is `public`-cached: both wallet routes and
  `/api/hub-apply` are `no-store`; the `public` responses (`/api/hub` 60s, `/api/hub/:project` 30s,
  receipts/reproducibility/badge 300s, inputs 60s, schemas and the bundle 3600s/300s, the OG card
  `immutable`) depend only on the URL. `Vary: Accept-Encoding` is present throughout, and no route
  reads a cookie, an `Authorization` header or `Accept-Language` into a cached body.
* **i18n route.** `server.js:17579` matches a regex, not a path — `/i18n/../../package.json`,
  `/i18n/%2e%2e%2fpackage.json`, `/i18n/es.school.json/../x`, `/i18n/ES.json`, `/i18n/es.evil.json`
  and `/i18n/ab.json` all 404; `es.json`, `es.school.json` and `es.locker.json` serve. Same for
  `/hub/schema/:name.json`, which is an explicit allowlist.
* **Shape checks before store reads.** `?wallet=__proto__` on `…/batch/:id/inputs` is a 400 from
  `SOL_ADDR_RE` before it can index the built map; `…/r/:sig` shape-checks before `findReceipt`;
  the snapshot routes check the mint first. No regex on this surface takes user input into a
  backtrackable pattern — the base58 and signature patterns are bounded character classes.
* **Decimals on the API.** The 6-decimal fixture reports `1.234567` everywhere on the wire
  (`totals.accruedUi`, `payouts[].amountUi`, the explanation steps) and the 9-decimal one `1.5`;
  `rawToUi` is string surgery, and the reward asset's decimals (not the locked token's) are used
  throughout. The wrong-units problems found are all on the **rendering** side.
* **Bundle/inputs integrity.** The bundle hash recomputes, `verifyVersionHash` passes on both
  fixture projects through all three `/hub/verify` tabs, an unsettled batch says so in words
  instead of serving an empty receipts array, and unknown project/batch ids 404.
* **Badge.** `hubBadgeCompute` builds its message only from integers and fixed words; an unknown or
  non-registered `?project=` (including `<script>`) is a clean 404 on both the JSON and the SVG.
* **`/api/build`** exposes only a commit sha, branch and derived env — all public on GitHub — with
  no path, no env var and no secret.
