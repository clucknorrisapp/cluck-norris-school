# CLOCK IN hackathon — submission package (DRAFT)

**Status: DRAFT.** Nothing here is submitted. Full rules and the two contradictory scoring
schemes: `docs/CLOCK_IN_HACKATHON_2026.md`. Submissions close **2026-10-09 06:59 UTC**
(Oct 8, 23:59 PT). Last truth pass **2026-10-03** against `origin/develop` @ `479f1ed1`
(production `main` @ `b35b95ba`). Every claim below is true in the code at that commit unless
it is marked **develop only** (not on production yet) or **planned** (no code). Where a claim
rests on something outside this repo, the source is named.

⚠️ **Read §8 first if you are about to record or submit.** The app calls the *production*
backend (`https://clucknorris.app` = `main`). `develop` is 86 commits ahead of `main`
(`git rev-list --count origin/main..origin/develop`), so a feature that exists only on `develop`
shows in an APK but its server half does not exist yet — the in-app swap is the one that matters.

---

## 1. Pitch

Cluck Norris is a free Solana crypto school wrapped around real tools, rebuilt from the ground up
for the Seeker — not a webpage in a wrapper, a mobile-native app with Mobile Wallet Adapter wired
into a shared signing seam. The school leads: **64 lessons in four courses, bundled on the phone
and readable offline**, in **ten languages**, with the Ask Cluck AI tutor one tab away. Behind it, a
fifteen-entry toolkit (four of the project's six flagships — the Locker Room, Firepit, Project
Burn, the Airdropper — plus Rent Reclaim, Wallet Checkup with in-app revoke, and an in-app swap),
and a second door into the tools pass that anyone can open by holding SKR instead of CLKN. The app
teaches people not to get hurt in crypto, then hands them the tools to act safely on their own
wallet, signed on their own phone.

## 2. What was built, in-window (PRs since 2026-09-14 13:00 UTC)

⚠️ In-window per the hackathon's own rule: *"Teams may begin development before the hackathon, but
products are judged only on the work completed between the competition's start and end dates."*
Every number below was read from the repo's PR list (`GET /repos/…/pulls`, `merged_at` after
2026-09-14T13:00:00Z, base `develop`) and checked to touch the Seeker app, its bundled school or
its server contract — none invented. Several were squash-merged, so a `git log --merges` listing
alone misses them; use the PR numbers.

**Build-out of the app**

| PR | One line |
|---|---|
| #364 | `docs/SEEKER_APP_PLAN.md` — the decision of record for the CLOCK IN build |
| #365 | Seeker app increment 1: `store-seeker` build variant, mobile shell, MWA-aware wallet layer |
| #367 | Seeker increment 2: Rent Reclaim, read side |
| #387 | The whole toolkit rebuilt for a phone (as merged: 15 tools, 6 signing, 7 languages — today's counts are below) |
| #388 | The Hatchery's image pipeline run in a real browser |
| #390 | Seeker school: claims truth pass, translations for every pane, direct-lesson i18n race fixed |
| #391 | Store edition v1.1.0: the Play/iOS shell, in an education edition, with a rendered-content scan |
| #395 | Tools pass: the SKR door for the Seeker app (live-priced), the Airdropper free for everyone, receipt hardened through Codex rounds 14–20 |
| #396 | Pane states — refused / unavailable / offline / empty on every pane, signing-pane guards, device test script |
| #397 | Wallet Checkup takes any pasted address in the full edition too |
| #398 | Hatchery: an in-flight mint survives leaving the screen; string-aware i18n extractor |
| #399 | Demo inventory: routes, tiers, captures and fixed facts, with a drift test |
| #401, #402 | Buy Special leaves the app entirely, and a negative test keeps it out |
| #405 | CORS for every endpoint the app calls — the pass sheet could not reach the pass service |
| #408, #409 | Store edition: floater dock helper so the language pill stops sitting on school cards; version 1.1.1 |
| #412 | MWA address arrives base64 from the native plugin — shown and sent as base58 |

**School, language and polish**

| PR | One line |
|---|---|
| #374 | School lesson 16, "The Deposit You Didn't Know You Made" (bundled in the app's curriculum) |
| #426, #432 | Language pill kept off the progress card and the checkup issue lines; the Solana Room's pill no longer leaves the screen at 360×800 |
| #428, #429 | Drawn shield icon replaces the bare glyph; Cluck Norris logo in the header and school home |
| #430 | The Solana Room, bundled offline in the Seeker and store editions |
| #431 | The Solana Room's Seeker wing — SKR, the phone, Seed Vault, MWA, the dApp Store (reading pages; see §3 on Seed Vault) |
| #433 | Play/iOS education edition: new tab bar — School, LP Lab, Ask, Solana, Daily |
| #434, #435, #438 | Quiz result and explanation scroll into view; "Correct!" no longer opens an explanation under a wrong verdict; the app half of the scroll fix |
| #437 | Every lesson reads one screen at a time (lesson stepper, all courses) |
| #440, #442 | App school polish (logo on course pages, balanced cards); the Library keeps the English name under a translated term |
| #459 | Five new safety lessons — address poisoning, read before you sign, Token-2022 extensions, SIM swap, fake Seeker offers — **develop only** |
| #462 | Korean, Turkish and Indonesian: the school and the app ship in ten languages — **develop only** |
| #464 | LP Lab lesson 15, "Check the Token Before You LP It" — **develop only** |

**Tools**

| PR | One line |
|---|---|
| #420 | In-app swap — SOL / SKR / CLKN / USDC through a server-mediated Jupiter proxy, signed through the shared seam — **develop only** (merge `ec977c0f`, 2026-09-29) |
| #443 | Firepit: reclaim surplus rent without closing the account (reached production with #457) |
| #458 | Seeker Checkup: revoke token approvals in the app, plus a "Disconnect & clean up" card — **develop only** (merge `d71940dc`, 2026-09-29) |
| #471 | Firepit: reclaims stop saying "Burn"; Rescan stops bringing closed accounts back (reached production as #472, then refined in #474 and #475) |
| #473 | Codex review fixes: Firepit Rescan hides a row only on chain proof, Revoke strict expiry and no second revoke while a send is unresolved, two lesson fact fixes — the Revoke and lesson fixes are **develop only**; the Firepit part is on production as #474/#475 |

Not claimed as hackathon-built Seeker work: the "Solana Room" website pages (#362, #371, #373,
#375, #384 — website content that #430 later ported into the app), Colosseum work (#349 and the
other batches — Colosseum is off, AGENTS.md), the AHOY, Normie Quest and CUNA work, and the
develop→main promotion PRs themselves (#400, #403, #407, #410, #417, #436, #441, #457).

Wrapper-repo work (`clucknorrisapp/CLKN-SEEKER`, packaging-only, separate repo — **on its branch
`claude/seeker-integration`, not on its `main`**, see §8) added the fourth `seeker` Capacitor
target (`capacitor.config.ts`, `npm run build:seeker`, appId `app.clucknorris.seeker`) and the
native `CluckMWA` plugin — see §3.

### What the app is today (counted from the code, not from any doc)

- **Bottom bar (bundle 1.0.2, owner 2026-10-04): School · Toolkit · Daily · Swap · Ask** — "the
  bar is for places you go every day"; Rent Reclaim and Wallet Checkup are Toolkit cards, LP Lab a
  course inside the school.
- **Tools: 15** registry entries (`src/seeker/tools/registry.js`): Rent Reclaim, The Solana Room,
  Ask Cluck, Wallet Checkup, Firepit, Locker Room, Project Burn, Listing Checkup, Daily, Wallet
  X-Ray, Holders, Trace, Airdropper, Hatchery, Swap. Tiers: 5 free, 6 wallet, 3 tools-pass, 1 paid.
  Four are flagged flagships and lead the grid under "Start here": Firepit, Locker Room, Project
  Burn, Airdropper. **Buy Special is not in the app** (#401/#402; no registry row, no route, and
  the built bundle contains no `buyspecial` string — checked 2026-10-03).
- **Panes that sign: 7** — Rent Reclaim, Firepit, Project Burn, Locker Room, Airdropper,
  Hatchery, Swap (`docs/SEEKER_DEMO_INVENTORY.md` §1) — **plus one signing surface that is not a
  registry row**: the Revoke control inside Wallet Checkup (`src/seeker/CheckupRevoke.jsx`, via
  `src/seeker/revoke.js` → `signSendConfirm`; **develop only**). Five go through the shared seam
  (`sign.js` `signSendConfirm`, `reclaim-sign.js` `runFullReclaim`); Airdropper signs through the
  shared `public/airdrop-engine.js`; Hatchery calls the wallet provider directly because the mint
  keypair is the second signer.
- **School: 64 lessons, 4 courses, 235 quiz questions** — `data/curriculum.json`
  (`node scripts/extract-curriculum.js --check` passes: it matches `src/App.jsx` `LESSONS` = 21,
  `INCUBATOR_LESSONS` = 7, `src/sections/LPLab.jsx` `LP_LESSONS` = 15 and the Library pieces).
  Per course: Crypto Fundamentals 21, Crypto 101 (Incubator) 7, Liquidity & LP Mastery 25 (the 15
  LP Lab lessons plus 10 Library reading pieces), Deep Dives 11. The 235 questions sit in the 43
  lessons that carry a quiz; the Library pieces have none. History, from the committed curriculum
  file at each commit: 58 lessons / 200 questions before #459 → 63 / 230 after #459 (+5 safety
  lessons) → 64 / 235 after #464 (+1 LP Lab lesson). **On production since 2026-10-04.**
- **Languages: the app and the school ship in ten — en / es / hi / it / pt / vi / zh / ko / tr /
  id.** The Seeker bundle (`store-edition/seeker-edition.json`, which has no `excludeLangs`)
  carries `public/i18n.js` with all ten picker entries, nine non-English UI dictionaries and nine
  `*.school.json` lesson dictionaries — checked by building it (`node
  scripts/build-store-edition.mjs seeker`: 10 `code:` entries in the shipped `i18n.js`, 18
  dictionary files). Every one of the app's 1,291 own strings (`scripts/seeker-i18n-keys.cjs`) is
  present in all nine dictionaries. **The Play and iOS education bundles are different: pinned at
  seven** (ko/tr/id are cut by `excludeLangs` in `store-edition/store-edition.json`).
  **Production is ten since 2026-10-04.**

## 3. Solana Mobile Stack usage

- **Mobile Wallet Adapter (MWA)** — real, compiled into a real APK. The wrapper repo's
  `docs/MWA_PLUGIN.md` records a verified `assembleDebug` build (2026-09-21) whose dex contains
  `CluckMWAPlugin` and all five bridged methods (`connectOrReauthorize`, `signMessages`,
  `signTransactions`, `signAndSendTransactions`, `deauthorize`), plus 213 references into the MWA
  client library. The wrapper's `android build` workflow now also builds the Seeker target and
  greps the APK for `CluckMWAPlugin`, `MobileWalletAdapter` and the `solana-wallet` manifest query;
  its latest run, 2026-10-03 12:35 UTC (run 37123392776, `claude/seeker-integration` @
  `c234c1fe`, `workflow_dispatch`), is green on all three jobs. Client side,
  `public/cluck-wallet.js` looks for `Capacitor.Plugins.CluckMWA` and every signing pane routes
  through one shared seam (`src/seeker/sign.js` `signSendConfirm`, `src/seeker/reclaim-sign.js`
  `runFullReclaim`) rather than each tool rolling its own submit path.
  **What the compile and the CI greps do NOT prove: a step-by-step device run.** See §7 for the
  one owner statement the repo does record and what it does not cover.
- **Seed Vault** — not integrated. No code in this repo or the wrapper repo calls it. The Seeker
  wing of the Solana Room (#431) has a reading page about it; that is education content, not an
  integration. Not claimed.
- **dApp Store listing** — a DRAFT config exists in the wrapper repo
  (`dapp-store/config.seeker.yaml`, `claude/seeker-integration`, written 2026-09-22, on its own
  `android_package` `app.clucknorris.seeker` so it cannot disturb the already-approved
  `app.clucknorris.school` listing). Publishing is **not** a hackathon requirement — only winners
  must publish, within 30 days of the announcement — and the file says not to submit it before the
  owner says so. Seven screenshots now exist (`dapp-store/screenshots-seeker/01-home.png` …
  `07-rent-reclaim.png`), captured 2026-09-24 with Playwright from a statically served build of
  the Seeker edition against the live read-only APIs — **not from a device**.
  `privacy_policy_url` (`https://clucknorris.app/privacy`) returns 200 (checked 2026-10-03).
- **The fourth Capacitor target (`seeker`)** exists in the wrapper repo — `capacitor.config.ts`
  has a `seeker` block (appId `app.clucknorris.seeker`, bundled, no `server.url`), and
  `npm run build:seeker` / `build:seeker-dev` are in `package.json`. This is what makes the app a
  *bundled* Solana Mobile Stack app rather than a Capacitor shell pointed at the live website —
  the FAQ language that scores a remote-loading wrapper poorly.

## 4. SKR integration

- **The SKR door on the tools pass** (#395, in production): holding SKR worth **the door's own
  dollar figure, served live from `GET /api/tool-gate/config`** (`skr.holdUsd`, `server.js`
  ~10512; the live endpoint returned the `skr` block on 2026-10-03) — never a hardcoded number in
  this doc or in the app — opens the same free tier as holding CLKN. Only the Seeker app sends
  `doors:["skr"]`; the website and the store editions never grow the door. SKR only ever *adds* a
  grant on a verified qualifying balance — a missing or stale SKR price is a denial, never a free
  pass (Codex round 13, `lib/tool-pass-qualify.js`, `scripts/tool-pass-qualify-test.cjs`).
- **In-app SKR/CLKN/SOL/USDC swap — ON PRODUCTION since 2026-10-04** (PR #420, merge `ec977c0f`
  to `develop` 2026-09-29; promoted with #482, main `1e4b7ac5`; `GET https://clucknorris.app/api/seeker/swap/config`
  answers). It is the **Swap tab** of the bottom bar since bundle 1.0.2. Design of record:
  `docs/SEEKER_SWAP_DESIGN.md`.
  - *Server* (`server.js` ~15483–15700): three public routes, no admin key, nothing server-signed
    — `GET /api/seeker/swap/config` (the four-mint allowlist, slippage options, `platformFeeBps:
    0`), `GET /api/seeker/swap/quote` (validated amount, allowlisted distinct mints, keyed Jupiter
    with fallback, a `quoteId` held 60 s) and `POST /api/seeker/swap/tx` (builds the Jupiter swap
    from the *stored* quote only; an expired or unknown id is a 409). The app never talks to
    Jupiter directly. All three are in `SEEKER_API_RE`; `scripts/seeker-cors-test.cjs` passes (14
    checks). No platform fee (owner, 2026-09-24).
  - *Signing:* versioned (`VersionedTransaction`, v0) support in the one shared signing seam
    (`src/seeker/sign.js`, `public/cluck-wallet.js`), so a multi-hop SKR route (which needs address
    lookup tables) signs through the same path every other tool uses.
  - *Before the wallet is asked:* a structural check of every instruction against the connected
    wallet (`src/seeker/swap-verify.js`), then a **pre-sign simulation gate**
    (`src/seeker/swap-simulate.js`): the transaction is simulated through the app's RPC proxy and
    refused unless the simulated balance deltas match what was shown — the input falls by at most
    the amount, the output rises by at least the computed minimum, no other mint moves, and SOL
    falls by at most the fee plus rent for accounts the swap itself creates. An unreachable RPC is
    a refusal, never a skip. The design states the limit plainly: the gate proves the *simulated*
    outcome, not that the real execution will match it.
  - *Tests that exist and pass today:* `seeker-swap-test` (54), `seeker-swap-verify-test` (60),
    `seeker-swap-simulate-test` (91), `seeker-pending-swap-test` (29), `seeker-sign-versioned-test`
    (50) — all run 2026-10-03.
  - *Production status:* live since the 2026-10-04 promotion. The 2026-10-03 `not_found` is history.
  - *Attempt guard (#479, Codex-cleared `7fa82c47`):* the pending record is written BEFORE the
    wallet is asked, a wallet that broadcasts and then loses the signature never unlocks the form,
    and a dead blockhash releases only after a balance re-read.
- **Paying the 7-day tools pass in SKR — SHIPPED, on production since 2026-10-04** (PR #421,
  Codex-cleared `32b79650`, merged `2709fd7a`, promoted with #482). Seeker app only. The dollar
  price (`TOOLGATE.skrPass.usd`, never stated in copy) is pinned by a **server-signed quote**
  (`GET /api/tool-gate/skr-quote`, HMAC over wallet + amount + validity, ten minutes; answered a
  signed quote on production at 15:11 UTC) priced from the same sanity-banded SKR price the
  holdings door uses, with its own guard (three accepted ticks in 24 h, within 3× of their
  median — no price, no quote, a 503, never a grace). `lib/tool-pass-skr.js` verifies on chain:
  the payer is the wallet whose SKR fell, the SKR rose at the receiver, a parsed SPL transfer is
  the second witness, the payment sits inside the quote's window on chain time. **One payment,
  one pass, one payer:** an atomic leg claim shared with the SOL pass means a signature belongs
  to the first kind + wallet to claim it. Client (`src/seeker/skr-pay.js`, `passgate.jsx`): an
  attempt record before the wallet is asked, recovery by signature, and a refused payment that
  may still be landing is "watching", never a free form. Tests: `scripts/tool-pass-skr-test.cjs`,
  `scripts/seeker-skr-pay-test.cjs` (129).
- **Swap tie-in to the pass sheet:** the sheet links to the swap for SKR (`/tools/swap?out=SKR`,
  `src/seeker/passgate.jsx`), live.

## 5. AI

**Ask Cluck** is a first-class pane in the Seeker app (`/ask`, free tier, no wallet needed) — the
same AI tutor product as the website. It is a bottom-tab destination in both editions (`TABS` in
`src/seeker/edition/full.jsx` and `edu.jsx`) and a button on the Library's empty-search state;
it is **not** embedded inside the lesson screens (an earlier draft of this document said it was —
`src/seeker/school/School.jsx` has no Ask Cluck reference). The app sends the picker's language with every question
(`src/seeker/AskCluck.jsx:231`); the server turns it into a reply-language instruction through
`AI_LANGS` (`server.js:155`), which today has entries for nine of the app's ten languages —
**Italian has no entry there**, so an Italian-language session sends `lang: "it"` and the server
adds no reply-language instruction. The school itself is bundled and works offline
(`src/seeker/school/curriculum.js`); only the AI call and the lesson-completion beacon need a
connection, and the beacon is fire-and-forget with a durable retry queue.

## 6. Mobile-native UX — with evidence

- **One shared signing seam, not per-tool submit code.** `src/seeker/sign.js`'s `signSendConfirm`
  is used by Firepit, Project Burn, the Locker Room, Swap and Revoke; `src/seeker/reclaim-sign.js`'s
  `runFullReclaim` by Rent Reclaim. Both distinguish "the node refused it" (safe to retry) from
  "the request never completed" (the transaction may already be signed and in the cluster —
  reported as `unconfirmed`, never silently retried). Written up finding-by-finding, with what
  pins each fix, in `docs/HANDOFF_2026-09-21_SEEKER.md` and
  `docs/SEEKER_MONEY_REVIEW_burn.md` / `docs/SEEKER_MONEY_REVIEW_send.md`.
- **Revoke, then disconnect, in the app** (#458, **develop only**): Wallet Checkup lists token
  delegate approvals and, for the connected wallet, can revoke them — the instruction is built on
  the device in bytes and diffed against the library in CI (`scripts/seeker-revoke-test.cjs`, 87
  checks), the confirm sheet's list is the list that is signed, and "revoked" is reported only
  after the accounts are re-read from the chain (unreadable is never counted as cleared). An
  unresolved send persists across rescans and blocks a second revoke (#473, develop only). The
  "Disconnect & clean up" card calls the wallet's own `disconnect()`, clears this device's tools
  pass and receipt sign-in, and says plainly that forgetting the site inside the wallet app is
  something only the wallet can do (`src/seeker/Disconnect.jsx`).
- **Firepit is three honest jobs, not one burn button** (#443/#471, in production): reclaim rent
  from empty accounts, reclaim *surplus* rent above today's rent-exempt minimum without closing the
  account (the minimum is read from the chain, never hardcoded), and burn-and-close. The confirm
  button names the job ("Reclaim surplus" / "Reclaim rent" / "Burn", red only for a real burn),
  and Rescan reads at `confirmed` and hides a row only on chain proof from past the transaction's
  own slot (`src/seeker/tools/firepit-recent.js`, `scripts/firepit-recent-test.cjs`).
- **Explicit states on every pane** — refused / unavailable / offline / empty — not a blank screen
  or an infinite spinner (PR #396, `src/seeker/pane.jsx`'s `useOnline()`/`toolFetch()`).
- **Locker Room is the app's only two-signer transaction besides the Hatchery's mint**, and follows
  the repo-wide rule: the connected wallet signs first, then the ephemeral escrow key co-signs —
  never the reverse (AGENTS.md's Phantom "may be malicious" trap;
  `src/seeker/tools/LockerRoom.jsx`). The route table records this in
  `docs/SEEKER_DEMO_INVENTORY.md` §1.
- **Two editions from one shell, selected at build time** (`vite.config.js`'s `@seeker-edition`
  alias): the full Seeker edition carries a wallet; the Play/iOS education edition compiles the
  wallet out entirely (`HAS_WALLET = false`) rather than hiding it behind a flag —
  `docs/SEEKER_DEMO_INVENTORY.md` §2.
- **Ten-language i18n, extractor-checked.** PR #398 added a string-aware i18n extractor so new
  panes cannot ship English-only strings unnoticed; `scripts/seeker-build-test.cjs` section (f)
  asserts all nine non-English dictionaries carry every app string.
- **Tests that exist and were run on 2026-10-03** (all exit 0): `seeker-cors-test` (14),
  `seeker-demo-inventory-test` (26), `tool-pass-qualify-test`, `tool-pass-gate-test`,
  `seeker-reclaim-sign-test` (121), `seeker-airdrop-test`, `seeker-swap-test` (54),
  `seeker-swap-verify-test` (60), `seeker-swap-simulate-test` (91), `seeker-pending-swap-test`
  (29), `seeker-sign-versioned-test` (50), `seeker-revoke-test` (87), `seeker-library-test` (16).
  The browser-driven ones (`seeker-build-test`, `seeker-app-boot-test`) were **not** run for this
  pass; they run in CI.

## 7. What is NOT claimed

- No perpetuals, no derivatives, no leveraged trading of any kind.
- No Apple Watch app — `docs/IOS_NATIVE_APP_PLAN.md` is explicitly post-Seeker-submission
  ("nothing starts before the Seeker submission closes") and does not add wallet features to iOS
  even after that; not part of this entry.
- No Colosseum work claimed here — Colosseum is off (owner, 2026-09-21); this is the CLOCK IN
  track exclusively.
- No Normie Quest reward/prize terms — those remain unagreed with the NORMIE team (AGENTS.md) and
  nothing here implies otherwise.
- No yield, no guaranteed return, no "investment" language anywhere in this package or in the app.
  "Earn potential" describes capability and opportunity only, per AGENTS.md's Educate → Build →
  Earn framing — never a promise, never a figure we do not pay.
- **No claim that a verified, step-by-step on-device run of the wallet flows exists.** What the
  repo records: the owner wrote on 2026-09-21, after installing the app on his Seeker, that wallet
  connect and signing work (`docs/SEEKER_TOOLS_BUILD.md`, "Superseded in part, 2026-09-21"). That
  is his statement, not a session's verification; no result of the 24-step product walk
  (`docs/SEEKER_DEVICE_TEST.md`) or of the 10-step wallet checklist in the wrapper's
  `docs/MWA_PLUGIN.md` is recorded anywhere, and no session has run any of it
  (AGENTS.md: "no connect-and-sign with a real wallet has ever been exercised by a session").
  **Swap, Revoke, surplus reclaim and the SKR-door pass sheet have no recorded on-device run at
  all.** The swap's own design requires the owner's device test before promotion.
- No claim that the SKR-priced 7-day pass exists — it is a design document on an open PR (§4).
- No claim that the in-app swap, revoke, the five safety lessons or the ten-language picker are
  *in production* — they are on `develop` (§8).
- No claim about Seed Vault integration — none exists.
- The Play/iOS education bundles are not the hackathon entry and stay at seven languages; the
  entry is the full Seeker edition.

## 8. Submission checklist

| Item | Status (2026-10-03) |
|---|---|
| Functional Android APK, direct download link | **Release APK buildable since 2026-10-04.** Releases `store-seeker-v1.0.1` (main `3bba62b1`) and, pending, `store-seeker-v1.0.2` (the daily bar) exist; the wrapper's `store-edition.lock` pins the seeker entry. The Mac builds it with `npm run build:seeker-update` — package `app.clucknorris.school`, versionCode 10 / 2.0.0, signed with the ORIGINAL listing key, which the owner recovered on 2026-10-04 (wrapper `docs/CLOCK_IN_MAC_RUNBOOK.md` §2.0) — so it installs over the live 1.0 and ships as that listing's update. **Direct link: TODO** — the owner attaches `cluck-norris-seeker-2.0.0.apk` to a GitHub release on `CLKN-SEEKER`; that asset URL goes here. |
| Public GitHub repo with source | **Both public** (checked 2026-10-03): `https://github.com/clucknorrisapp/cluck-norris-school` (the app: `seeker.html`, `src/seeker/*`) and `https://github.com/clucknorrisapp/CLKN-SEEKER` (packaging + the MWA plugin). For judges, access = the public URLs. ⚠️ **In `CLKN-SEEKER`, the `seeker` target, the `CluckMWA` plugin, `docs/MWA_PLUGIN.md`, the `seeker-dev-apk` job and the dApp Store draft are on the branch `claude/seeker-integration` (42 commits ahead of that repo's `main`), not on its default branch.** A judge opening that repo's front page sees none of it. Merge the branch, or put its URL (`https://github.com/clucknorrisapp/CLKN-SEEKER/tree/claude/seeker-integration`) in the submission — the owner's call. |
| Demo video (≤ shows functionality) | **TODO — recordable now.** Shot list: `docs/SEEKER_DEMO_STORYBOARD.md` (reordered 2026-10-04: the school leads, the swap is the MWA moment, the SKR-paid pass is shot 6, Rent Reclaim is in the extended cut only). Owner records it on his own Seeker; both gates in its §0 are open. |
| Pitch deck / brief presentation | Owner's to build; this document is the factual source material |
| Judge GitHub access | Both repos are public, so no per-judge grant is needed for the code. Re-check that neither is switched to private before 2026-10-09. |
| Team funding declaration | Open question — see §9 |
| Submit | **Do not submit.** This package stays in draft; the final submission is the owner's explicit go, and the entry agreement is not signed until he says so. |

### ✅ The develop/main caveat — RESOLVED 2026-10-04

`develop` was promoted to `main` on the owner's explicit go (PR #482, merge `1e4b7ac5` at 14:49
UTC; the one-line version bump #484, `3bba62b1`, followed). Production serves the swap, the
SKR-paid pass, Revoke and the Disconnect card, the ten languages and the 64 lessons; the seeker
bundle is cut from that same `main`. Everything the 2026-10-03 version of this doc listed as
"develop only" is live. The rule stands for next time: promotion is the owner's go in the moment,
never inferred.

## 9. Open questions for the owner

1. **VC/angel funding eligibility.** The rules state *"only teams without VC/angel funding are
   eligible for USDC prizes."* Needs an explicit owner statement before submitting.
2. **Which scoring scheme governs** — the platform's own weighted config (AI 20% / SKR 20% / UX
   15% / UI 15% / Innovation 15% / Ecosystem Impact 15%) or the published FAQ's four-equal-25%
   scheme. `docs/CLOCK_IN_HACKATHON_2026.md` flags this is unresolved; **ask in office hours,
   Discord Wed 18:30 UTC**, before finalizing what the deck emphasizes.
3. ✅ **appId decision — settled twice on 2026-10-04; final answer: UPDATE the live
   `app.clucknorris.school` listing.** The morning's call was a new listing because the original
   signing key could not be found; the owner then recovered it from the May 2026 session that made
   it (it is on the MacBook; the certificate fingerprint `7A:95:5F:A4…`, read from the live release
   NFT, is the check). The wrapper has both paths — `build:seeker-update` is the live one;
   `build:seeker` and the `app.clucknorris.seeker` portal draft stay unused. Publisher wallet
   `4Ws6jXEGQ7MG61Ke8qiuGrXhdcYX2NNVCtg3xRMsuLs8` is in the owner's Phantom. The listing text was
   rewritten so the school leads (wrapper e5fbefb).
4. ✅ **Promoted 2026-10-04** (#482, #484). The swap is live.
5. ✅ **#421 (pay the pass in SKR) — built, reviewed (four Codex rounds), merged, live.**
6. **The wrapper's default branch** — `store-seeker-v1.0.1` is cut (1.0.2 pending); what remains is
   the owner's call to merge or link `claude/seeker-integration` in `CLKN-SEEKER` (§8), and the
   GitHub release that carries the APK.
7. **Italian Ask Cluck** — `AI_LANGS` has no `it` entry (§5). Add one, or leave §5's wording.
