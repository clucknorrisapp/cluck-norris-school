# Seeker demo inventory

**This is an inventory, not a pitch.** No slogans, no brand claims, no framing — every line below
is a fact read directly out of the code as of this branch, with the file it came from named next
to it. It exists so the owner can build the demo shot list and the deck from facts rather than
from memory. Pinned by `scripts/seeker-demo-inventory-test.cjs` (route tables and capture list
checked against the actual files on disk, every run).

Two Seeker editions ship from one shell (`src/seeker/App.jsx`), selected at build time by
`vite.config.js`'s `@seeker-edition` alias:

- **Full edition** — the Solana Seeker dApp Store app, wallet included. `src/seeker/edition/full.jsx`.
- **Education edition** — the Google Play / iOS bundle, no wallet at all (`docs/STORE_EDITION.md`).
  `src/seeker/edition/edu.jsx`.

---

## 1. Full (Seeker) edition — routes (`src/seeker/edition/full.jsx`)

Tier and flagship flag are read from `src/seeker/tools/registry.js` (14 `TOOLS` entries today).
"Signs" is what the pane itself does when a wallet is connected, found by grepping the pane file
for `signTransaction` / `signAndSendTransaction` / `runFullReclaim` / `signSendConfirm`. "Works
offline" means the pane can render its own screen with zero network call — only the school
qualifies; every tool pane needs a live fetch and shows an explicit offline state
(`useOnline()`/`toolFetch()` in `src/seeker/pane.jsx`, or `navigator.onLine` inline) when there
is none.

| Path | Component | Registry id / tier | Signs a transaction | Works offline | Flagship |
|---|---|---|---|---|---|
| `/` | `Navigate` → `/school` | — | no | n/a (redirect) | — |
| `/school` | `SchoolHome` | — (School) | no | **yes** — curriculum is bundled (`src/seeker/school/curriculum.js`); only the completion beacon needs a connection, and it is fire-and-forget with a durable queue | yes |
| `/school/:courseId` | `SchoolCourse` | — (School / LP Lab, course id `lp`) | no | **yes**, same as above | yes |
| `/school/:courseId/:lessonId` | `SchoolLesson` | — (School / LP Lab) | no | **yes**, same as above | yes |
| `/library` | `Library` | — (School home card) | no | **yes** — the glossary ships in the bundle (`data/curriculum.json` `glossary` + every lesson's key terms) | yes |
| `/solana` | `SolanaRoomIndex` | `solana` / free | no | **yes** — the room's own content is bundled (`src/seeker/solana/content.js`) | no |
| `/solana/:pageId` | `SolanaRoomPage` | `solana` / free | no | **yes**, same as above; the rent page's numbers come from bundled `rent-math.js`, not a fetch | no |
| `/solana/seeker/:pageId` | `SeekerWingPage` | `solana` / free | no | **yes** — the Seeker wing's own bundled content (`src/seeker/solana/wing-content.js`); its SKR page fetches `/api/tool-gate/config` for the live door figure only, showing no number rather than a stale/guessed one when that call fails — **Seeker-edition-only, not in `edu.jsx`** | no |
| `/tools` | `ToolsHome` | — (grid page, not itself gated) | no | no | — |
| `/rent` | `RentReclaimPane` | `rent` / wallet | **yes** — `runFullReclaim()` (`src/seeker/reclaim-sign.js`), connected wallet signs first | no | no |
| `/ask` | `AskCluckPane` | `ask` / free | no | no | no |
| `/checkup` | `FullCheckup` → `WalletCheckupPane` | `checkup` / free | no | no | no |
| `/tools/listing` | `ListingCheckup` | `listing` / free | no | no | no |
| `/tools/alpha` | `DailyBrief` | `alpha` / free | no | no | no |
| `/tools/firepit` | `Firepit` | `firepit` / wallet | **yes** — `signSendConfirm()` (`src/seeker/sign.js`) | no | **yes** |
| `/tools/burn` | `ProjectBurn` | `burn` / wallet | **yes** — `signSendConfirm()` (`src/seeker/sign.js`) | no | **yes** |
| `/tools/lock` | `LockerRoom` | `lock` / wallet | **yes** — `signSendConfirm()` (`src/seeker/sign.js`); wallet signs first, then the ephemeral escrow key co-signs | no | **yes** |
| `/tools/xray` | `WalletXray` | `xray` / pass | no | no | no |
| `/tools/holders` | `Holders` | `holders` / pass | no | no | no |
| `/tools/trace` | `Trace` | `trace` / pass | no | no | no |
| `/tools/airdrop` | `Airdropper` | `airdrop` / pass | **yes** — `CluckAirdrop.send()` → `provider.signAndSendTransaction()` (`public/airdrop-engine.js`, shared with the website's own airdropper) | no | **yes** |
| `/tools/hatchery` | `Hatchery` | `hatchery` / paid | **yes** — `wallet.provider.signTransaction()` directly (mint keypair is server-held and co-signs in `/api/hatchery/submit`) | no | no |
| `*` | `Navigate` → `/tools` | — | no | n/a (redirect) | — |

22 routes (Buy Special left the app on 2026-09-22 — owner: not in the Seeker app at all; the Solana Room, `/solana` + `/solana/:pageId`, added since, then the Seeker-only wing route `/solana/seeker/:pageId`). 6 panes sign: Rent Reclaim, Firepit, Project Burn, Locker Room, Airdropper, Hatchery —
of those, Firepit/Project Burn/Locker Room/Rent Reclaim go through the two shared signing seams
(`sign.js`'s `signSendConfirm`, `reclaim-sign.js`'s `runFullReclaim`); Airdropper signs through the
separate, shared `public/airdrop-engine.js`; Hatchery calls the wallet provider directly because
the mint keypair (not an escrow) is the second signer.

## 2. Education (Play/iOS) edition — routes (`src/seeker/edition/edu.jsx`)

This edition has **no wallet at all** (`HAS_WALLET = false`, `useWallet()` returns `null`) — every
"tier" concept from the registry collapses to "free" here because there is nothing to hold or pay
with. It is a strict subset of the four free full-edition tools plus its own certificate route.

| Path | Component | Tier | Signs | Works offline | Flagship |
|---|---|---|---|---|---|
| `/` | `Navigate` → `/school` | — | no | n/a (redirect) | — |
| `/school` | `SchoolHome` (custom `finished`/`progressNote` for this edition) | free, no wallet | no | **yes**, same as full edition | yes |
| `/school/certificate` | `Certificate` | free, no wallet | no — `POST /api/claim/certificate`, no wallet, no signing; explicitly **not** the treasury-paid diploma cNFT (`src/seeker/school/Certificate.jsx` header) | no (the claim call needs a connection) | no |
| `/school/:courseId` | `SchoolCourse` | free | no | **yes** | yes |
| `/school/:courseId/:lessonId` | `SchoolLesson` | free | no | **yes** | yes |
| `/library` | `Library` | free | no | **yes** — bundled glossary (`data/curriculum.store.json` `glossary`) | yes |
| `/solana` | `SolanaRoomIndex` | free | no | **yes** — bundled content, same as the full edition | no |
| `/solana/:pageId` | `SolanaRoomPage` | free | no | **yes**, same as above; `rent-math.js` loads outside `EDU:OUT` so the rent page's numbers are real here too | no |
| `/ask` | `AskCluckPane report` | `ask` / free | no | no | no |
| `/checkup` | `EduCheckup` → `WalletCheckupPane` (paste-address only) | `checkup` / free | no | no | no |
| `/tools/listing` | `ListingCheckup linkHosts={LINK_HOSTS}` | `listing` / free | no | no | no |
| `/tools/alpha` | `DailyBrief` | `alpha` / free | no | no | no |
| `*` | `Navigate` → `/school` | — | no | n/a (redirect) | — |

12 routes (the Solana Room, `/solana` + `/solana/:pageId`, added since). None of the four flagship tools (Firepit, Locker Room, Project Burn, Airdropper) exist
in this edition — the shell's import list never pulls a wallet pane in
(`src/seeker/edition/edu.jsx` header). School is the only flagship present, and it leads (first
tab in both editions' `TABS`).

---

## 3. Existing captures (`docs/seeker/`, `docs/demo/`, recursive)

### 3a. `docs/seeker/` — Seeker app screenshots (4 files)

Taken from the real shipped bundle at a 390×844 viewport, 2x device pixel ratio, per
`docs/HANDOFF_2026-09-21_SEEKER.md` — **the backend was returning 503 when these were taken, so
every one of them shows the pane's honest "unavailable" state, not live data.** New captures with
a live backend are needed before any of these ship in a deck.

| File | Size | Dimensions | Referenced in | Maps to route |
|---|---|---|---|---|
| `docs/seeker/toolkit.png` | 392,595 B | 780×5210 (full-page scroll) | `docs/HANDOFF_2026-09-21_SEEKER.md` | `/tools` (`ToolsHome`) |
| `docs/seeker/airdropper.png` | 109,286 B | 780×1688 | `docs/HANDOFF_2026-09-21_SEEKER.md` | `/tools/airdrop` (`Airdropper`) |
| `docs/seeker/locker-room.png` | 94,804 B | 780×1688 | `docs/HANDOFF_2026-09-21_SEEKER.md` | `/tools/lock` (`LockerRoom`) |
| `docs/seeker/rent-vietnamese.png` | 60,640 B | 780×1688 | `docs/HANDOFF_2026-09-21_SEEKER.md` | `/rent` (`RentReclaimPane`), Vietnamese locale |

### 3b. `docs/demo/` — website / Project Hub captures (68 files, NOT the Seeker app)

Every file under `docs/demo/` is a capture of the **website** (`/hub`, `/for-projects`, `/holders`,
the desktop-web school report card, and the POKEAHOE Hub rehearsal's API/CLI output) taken for the
Colosseum/Hub demo material, at desktop (1280×800-class) and mobile-web-reflow (390×844) viewports.
None of them are captures of the Seeker app bundle — the Seeker shell is a separate, hash-routed
build (`seeker.html`) that these sessions never opened. Grepping `src/seeker/` for `bags`, `hub`,
`cuna`/lock-to-earn, `normie-quest`, `diploma`/`certificate` (§5 below) confirms none of the
Hub/website surfaces these captures show exist inside the Seeker bundle at all.

**`docs/demo/2026-09-18-pokeahoe-rehearsal/`** (15 files — the POKEAHOE Hub project rehearsal,
referenced throughout `docs/POKEAHOE_REHEARSAL_2026-09.md`):

| File | Size | Dimensions |
|---|---|---|
| `docs/demo/2026-09-18-pokeahoe-rehearsal/01-hub-poke-dryrun-project-page.png` | 126,904 B | 1280×800 |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/02-desk-preview-draft-response.json` | 5,077 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/03-admin-terms-publish-v1-response.json` | 3,473 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/04-launch-readiness-response.json` | 3,388 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/05a-payout-export-dryrun-refusal.txt` | 1,084 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/05b-payout-send-operator-ownerOnly-refusal.txt` | 1,060 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/05c-payout-send-owner-dryrun-refusal.txt` | 1,084 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/06-hub-poke-project-page-after-v1-v2.png` | 129,636 B | 1280×800 |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/06b-api-hub-poke-after-v1-v2.json` | 974 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/07-hub-poke-compare-v1-v2.png` | 87,177 B | 1280×800 |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/08-hub-wallet-holder.png` | 88,849 B | 1280×800 |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/09-hub-poke-feed.json` | 777 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/10-hub-glossary-term-too-short.png` | 105,618 B | 1280×800 |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/11-hub-poke-desk-no-batch-possible.json` | 12,104 B | — |
| `docs/demo/2026-09-18-pokeahoe-rehearsal/12-admin-accrue-not-armed-refusal.json` | 2,949 B | — |

**`docs/demo/2026-09-18/`** (53 files — mostly desktop/mobile pairs, referenced throughout
`docs/DEMO_STORYBOARD.md` and `docs/DEMO_NARRATION.md`; several also appear in
`docs/CODEX_REVIEWER_BRIEF.md`, `docs/JUDGE_GUIDE.md`, `docs/HUB_VERIFY.md`, `docs/ARENA_POSTS.md`,
`docs/COLOSSEUM_ROADMAP.md`, `docs/PITCH_SCRIPT.md`, `docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md`
and `docs/POKEAHOE_REHEARSAL_2026-09.md` — `docs/DEMO_STORYBOARD.md` is the primary index):

| File pair (desktop / mobile) | Desktop size | Desktop dims | Mobile size | Mobile dims |
|---|---|---|---|---|
| `docs/demo/2026-09-18/for-projects.desktop.png` / `docs/demo/2026-09-18/for-projects.mobile.png` | 215,513 B | 1280×1606 | 202,556 B | 390×2260 |
| `docs/demo/2026-09-18/holders-a11y-before.png` / `docs/demo/2026-09-18/holders-a11y-after.png` | 68,218 B | 390×844 | 69,390 B | 390×844 |
| `docs/demo/2026-09-18/holders-compare.desktop.png` / `docs/demo/2026-09-18/holders-compare.mobile.png` | 71,744 B | 1008×762 | 80,838 B | 358×959 |
| `docs/demo/2026-09-18/hub-compare.desktop.png` / `docs/demo/2026-09-18/hub-compare.mobile.png` | 83,448 B | 1280×800 | 68,942 B | 390×844 |
| `docs/demo/2026-09-18/hub-demo-1-top.desktop.png` / `docs/demo/2026-09-18/hub-demo-1-top.mobile.png` | 135,982 B | 1280×800 | 100,195 B | 390×844 |
| `docs/demo/2026-09-18/hub-demo-2-funding-batch.desktop.png` / `docs/demo/2026-09-18/hub-demo-2-funding-batch.mobile.png` | 112,988 B | 1280×800 | 89,597 B | 390×844 |
| `docs/demo/2026-09-18/hub-demo-3-reproduce-isolation.desktop.png` / `docs/demo/2026-09-18/hub-demo-3-reproduce-isolation.mobile.png` | 120,552 B | 1280×800 | 96,577 B | 390×844 |
| `docs/demo/2026-09-18/hub-demo-b.desktop.png` / `docs/demo/2026-09-18/hub-demo-b.mobile.png` | 79,488 B | 1280×800 | 71,456 B | 390×844 |
| `docs/demo/2026-09-18/hub-demo-program.desktop.png` / `docs/demo/2026-09-18/hub-demo-program.mobile.png` | 294,749 B | 1280×2022 | 279,077 B | 390×2924 |
| `docs/demo/2026-09-18/hub-demo-receipt-a.desktop.png` / `docs/demo/2026-09-18/hub-demo-receipt-a.mobile.png` | 69,843 B | 1280×800 | 62,945 B | 390×844 |
| `docs/demo/2026-09-18/hub-feed-json.desktop.png` / `docs/demo/2026-09-18/hub-feed-json.mobile.png` | 137,251 B | 1280×800 | 125,748 B | 390×844 |
| `docs/demo/2026-09-18/hub-feed-rss.desktop.png` / `docs/demo/2026-09-18/hub-feed-rss.mobile.png` | 170,430 B | 1280×800 | 126,780 B | 390×844 |
| `docs/demo/2026-09-18/hub-glossary.desktop.png` / `docs/demo/2026-09-18/hub-glossary.mobile.png` | 111,127 B | 1280×800 | 81,000 B | 390×844 |
| `docs/demo/2026-09-18/hub-index.desktop.png` / `docs/demo/2026-09-18/hub-index.mobile.png` | 114,672 B | 1280×800 | 82,236 B | 390×844 |
| `docs/demo/2026-09-18/hub-judge.desktop.png` / `docs/demo/2026-09-18/hub-judge.mobile.png` | 168,812 B | 1280×800 | 99,227 B | 390×844 |
| `docs/demo/2026-09-18/hub-poke.desktop.png` / `docs/demo/2026-09-18/hub-poke.mobile.png` | 123,586 B | 1280×800 | 94,018 B | 390×844 |
| `docs/demo/2026-09-18/hub-print-sheet.desktop.png` / `docs/demo/2026-09-18/hub-print-sheet.mobile.png` | 64,085 B | 1280×800 | 57,417 B | 390×844 |
| `docs/demo/2026-09-18/hub-real-explain-block.desktop.png` / `docs/demo/2026-09-18/hub-real-explain-block.mobile.png` | 213,740 B | 1280×1472 | 192,535 B | 390×2162 |
| `docs/demo/2026-09-18/hub-status-badge.desktop.png` / `docs/demo/2026-09-18/hub-status-badge.mobile.png` | 121,907 B | 1280×800 | 96,746 B | 390×844 |
| `docs/demo/2026-09-18/hub-status.desktop.png` / `docs/demo/2026-09-18/hub-status.mobile.png` | 132,055 B | 1280×800 | 96,660 B | 390×844 |
| `docs/demo/2026-09-18/hub-trust.desktop.png` / `docs/demo/2026-09-18/hub-trust.mobile.png` | 152,231 B | 1280×800 | 92,633 B | 390×844 |
| `docs/demo/2026-09-18/hub-verify-bundle.desktop.png` / `docs/demo/2026-09-18/hub-verify-bundle.mobile.png` | 87,648 B | 1280×800 | 73,956 B | 390×844 |
| `docs/demo/2026-09-18/hub-wallet-clkn.desktop.png` / `docs/demo/2026-09-18/hub-wallet-clkn.mobile.png` | 89,130 B | 1280×800 | 80,976 B | 390×844 |
| `docs/demo/2026-09-18/hub-wallet-empty.desktop.png` / `docs/demo/2026-09-18/hub-wallet-empty.mobile.png` | 75,571 B | 1280×800 | 69,764 B | 390×844 |
| `docs/demo/2026-09-18/hub-wallet-two-projects.desktop.png` / `docs/demo/2026-09-18/hub-wallet-two-projects.mobile.png` | 116,227 B | 1280×987 | 108,520 B | 390×1291 |
| `docs/demo/2026-09-18/school-report-card.desktop.png` / `docs/demo/2026-09-18/school-report-card.mobile.png` | 72,365 B | 1280×800 | 70,998 B | 390×844 |

Two files in this set have no desktop/mobile pair and are viewport-agnostic captures:

| File | Size | Dimensions |
|---|---|---|
| `docs/demo/2026-09-18/reproduce-receipt-terminal.png` | 42,492 B | 802×281 (a terminal window, not a browser) |

### 3c. Seeker routes with NO capture yet

Everything in §1 and §2 **except** `/tools`, `/tools/airdrop`, `/tools/lock` and `/rent` (the four
`docs/seeker/` captures) has never been screenshotted in the Seeker bundle. That is every one of:

- `/school`, `/school/:courseId`, `/school/:courseId/:lessonId` (both editions) — **the school
  itself, the flagship that leads, has zero captures**
- `/school/certificate` (education edition only)
- `/library` (both editions — the searchable glossary, 2026-09-25)
- `/ask`, `/checkup`, `/tools/listing`, `/tools/alpha` (both editions)
- `/tools/firepit`, `/tools/burn` (full edition — two of the six flagships)
- `/tools/xray`, `/tools/holders`, `/tools/trace`, `/tools/hatchery` (full edition)

And the four existing captures were taken against a 503'd backend (§3a), so even those four need a
retake against a live server before they are demo-ready.

---

## 4. The submission's fixed facts

- **Hackathon deadline and requirements** — `docs/CLOCK_IN_HACKATHON_2026.md`. Submissions close
  `2026-10-09T06:59:00Z` (Oct 8, 23:59 PT). Pre-existing products are allowed only if the
  submission "shows significant new mobile development during the hackathon" — a pre-existing
  project with no new work is not eligible. The doc also flags an unresolved conflict between the
  hackathon record's own scoring weights (AI 20%, SKR Integration 20%, UX 15%, UI 15%, Innovation
  15%, Ecosystem Impact 15%) and the published FAQ's four-equal-25%-criteria scheme — not settled
  with the organisers as of that doc.
- **The six flagships** — AGENTS.md, owner 2026-09-21: "the school, the LP lab, the airdropper,
  the locker room, the fire pit, project burn." The school leads; any surface that ranks, groups
  or leads with a subset must lead with it. In the code, four of the six are `registry.js` tools
  with `flagship: true` (`firepit`, `lock`, `burn`, `airdrop`); the school and the LP Lab are
  course content inside `/school`, not registry tools.
- **The tools-pass terms as served** — live from `/api/tool-gate/config` (`server.js` ~line
  10099): `holdUsd` (CLKN threshold, currently sourced from `TOOLGATE.usd`, itself
  `process.env.TOOLGATE_USD` or a code default), `priceUsd`, `clknNeeded`, `lamports`, `days`
  (both resolved live from `lib/tool-pass-terms.js`'s append-only schedule), `receiver`, `mint`.
  Never hardcode `holdUsd` or the SOL price/day terms in a demo script — read them from this
  endpoint at record time. **Shape on `develop` as of this commit:** a single CLKN-denominated
  `holdUsd`. The SKR door (`skr: { mint, holdUsd, priceUsd, skrNeeded, door }`, its own figure,
  sent only by the Seeker app's pass sheet) is on PR #395, held for Codex's re-review; once that
  merges the demo reads `skr.holdUsd` / `skr.skrNeeded` from the same endpoint — still never a
  literal.
- **Seven languages** — AGENTS.md: en / es / hi / it / pt / vi / zh. Confirmed on disk:
  `public/i18n/{es,hi,it,pt,vi,zh}.json` (English is the source keys, uncatalogued as its own
  file).
- **`docs/SEEKER_DEVICE_TEST.md`** (this repo) — the owner's on-device product walk: what to tap,
  in what order, what the screen must say. Written 2026-09-22; explicitly says no cloud session
  can run any of it, and the wallet-bridge connect/cancel/sign walk is a separate document.
- **`docs/MWA_PLUGIN.md`** — lives in the **apps repo** (`clucknorrisapp/CLKN-SEEKER`), not this
  one; referenced from here only by name (`docs/SEEKER_DEVICE_TEST.md`,
  `docs/HANDOFF_2026-09-21_SEEKER.md`, `docs/SEEKER_APP_PLAN.md`). Its "Device checklist" §
  (10 steps) is the Mobile Wallet Adapter connect/cancel/sign walk that must run before the
  product walk above, per `docs/SEEKER_DEVICE_TEST.md`'s own instruction.

---

## 5. Not in the Seeker app (present on the website)

Each item below was verified by grepping `src/seeker/` — anything not listed as a hit either does
not exist in the Seeker bundle at all, or (where noted) exists only as a code comment referencing
shared logic, not a feature.

- **The wallet-paid diploma cNFT.** The full edition explicitly does not claim it — `SchoolHome`'s
  finished state says "the diploma is claimed on clucknorris.app" (`src/seeker/school/School.jsx`).
  The education edition ships a *different* artifact, a no-wallet "certificate of completion"
  (`src/seeker/school/Certificate.jsx`, `POST /api/claim/certificate`) whose own header says
  explicitly "THIS IS NOT THE DIPLOMA cNFT, and it must not be described as one." Neither edition
  runs the website's wallet-signed, treasury-paid mint flow.
- **Bags.fm Live Launches tracker** (`public/bags.html`). No reference anywhere in `src/seeker/` —
  the only `bags`/`Bags` hits in the Seeker sources (`Holders.jsx`, `WalletXray.jsx`, `Trace.jsx`,
  `tools.css`) are the launchpad-provenance labelling those tools already do (calling a wallet
  "creator"/"team" only when the Bags API confirms it), not the tracker page itself.
- **The Project Hub** (`/hub`, `/for-projects`, partner project pages, glossary, verify bundle,
  etc.). No route, component or link to any Hub surface exists in `src/seeker/`; the one `/hub`
  hit in the tree is a code comment in `src/seeker/i18n.js` about a shared i18n-lookup pattern,
  not a page.
- **The premium forensics tier** (holder-gated at a fixed threshold, separate from the unified
  tools pass). No reference in `src/seeker/`; the Seeker `xray`/`holders`/`trace` panes gate
  exclusively on the `pass` tier from `registry.js`.
- **The CUNA lock-to-earn dashboard / daily burn.** No feature exists in `src/seeker/` — the two
  `cuna`/`lock-to-earn` hits in `src/seeker/tools/LockerRoom.jsx` are code comments citing
  `lib/cuna-staking.js`'s escrow-date derivation as the reference logic Locker Room's own
  vesting-date math follows, not a CUNA-specific screen or dashboard.
