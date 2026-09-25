# CLOCK IN hackathon — submission package (DRAFT)

**Status: DRAFT.** Nothing here is submitted. Full rules and the two contradictory scoring
schemes: `docs/CLOCK_IN_HACKATHON_2026.md`. Submissions close **2026-10-09 06:59 UTC**
(Oct 8, 23:59 PT). This package is assembled from the code on `develop` as of 2026-09-24 —
every claim below is true in the code today unless marked **in flight** or **planned**.

---

## 1. Pitch

Cluck Norris is a free Solana crypto school wrapped around real tools, rebuilt from the ground up
for the Seeker — not a webpage in a wrapper, a mobile-native app with Mobile Wallet Adapter wired
into a shared signing seam, an AI tutor in seven languages, thirteen phone-native tools (four of
them the project's own flagships: the Locker Room, Firepit, Project Burn, the Airdropper), and a
second door into the tools pass that anyone can open by holding SKR instead of CLKN — the app that
teaches people not to get hurt in crypto, then hands them the tools to act safely on their own
wallet, signed on their own phone.

## 2. What was built, in-window (PRs since 2026-09-14 13:00 UTC)

⚠️ In-window per the hackathon's own rule: *"Teams may begin development before the hackathon, but
products are judged only on the work completed between the competition's start and end dates."*
Every PR below merged to `develop` after **2026-09-14 13:00 UTC**; each number verified present in
`git log origin/develop` with a real merge commit — none invented.

| PR | One line |
|---|---|
| #365 | Seeker app increment 1: `store-seeker` build variant, mobile shell, MWA-aware wallet layer |
| #367 | Seeker increment 2: Rent Reclaim, read side |
| #387 | The whole toolkit rebuilt for a phone — 15 tools, 6 signing, 7 languages |
| #390 | Seeker school: claims truth pass, translations for every pane, direct-lesson i18n race fixed |
| #391 | Store edition v1.1.0: the Play/iOS shell with a rendered-content scan |
| #395 | Tools pass: $10 of CLKN or $20 of SKR, the Airdropper free for everyone, receipt hardened through Codex rounds 14–20 |
| #396 | Pane states — refused / unavailable / offline / empty on every pane, signing-pane guards, device test script |
| #397 | Wallet Checkup takes any pasted address in the full edition too |
| #398 | Hatchery: an in-flight mint survives leaving the screen; string-aware i18n extractor |
| #401 | Buy Special leaves the app entirely |
| #402 | Buy Special stays out — negative test for the tile, link, old deep link, bundle-text guards |
| #408 | store edition: floater dock helper so the language pill stops sitting on school cards |
| #409 | Bump store-edition version to 1.1.1 |

Two adjacent in-window PRs (#371, #373 — "Solana Room" education pages) landed in the same window
and touched the store-edition manifest but are website/school content, not Seeker-app-specific;
not claimed as hackathon-built Seeker work here. #349 (Colosseum batch work) is excluded outright
— Colosseum is off (AGENTS.md).

Wrapper-repo work (`clucknorrisapp/CLKN-SEEKER`, packaging-only, separate repo) added the fourth
`seeker` Capacitor target (`capacitor.config.ts`, `npm run build:seeker`, appId
`app.clucknorris.seeker`) and the native `CluckMWA` plugin — see §3.

## 3. Solana Mobile Stack usage

- **Mobile Wallet Adapter (MWA)** — real, compiled into a real APK. `docs/MWA_PLUGIN.md` (wrapper
  repo, `clucknorrisapp/CLKN-SEEKER`) records a verified `assembleDebug` build
  (2026-09-21) whose dex contains `CluckMWAPlugin` and all five bridged methods
  (`connectOrReauthorize`, `signMessages`, `signTransactions`, `signAndSendTransactions`,
  `deauthorize`), plus 213 references into the MWA client library. **What that build does NOT
  prove: a wallet connecting or anything actually signing on a real device.** No session container
  has an Android SDK with a real wallet to test against — this is an explicit, unexercised gate in
  both `docs/SEEKER_APP_PLAN.md` and `docs/MWA_PLUGIN.md`. Client side, `public/cluck-wallet.js`
  looks for `Capacitor.Plugins.CluckMWA` and every signing pane routes through one shared seam
  (`src/seeker/sign.js` `signSendConfirm`, `src/seeker/reclaim-sign.js` `runFullReclaim`) rather
  than each tool rolling its own submit path — the seam is what a post-launch money-path review
  (§ below) exists to protect.
- **Seed Vault** — not integrated. No code in this repo or the wrapper repo calls it. Not claimed.
- **dApp Store listing** — a DRAFT config exists in the wrapper repo
  (`dapp-store/config.seeker.yaml`, written 2026-09-22, on its own `android_package`
  `app.clucknorris.seeker` so it cannot disturb the already-approved `app.clucknorris.school`
  listing). It is explicit that publishing is **not** a hackathon requirement — only winners must
  publish, within 30 days of the announcement — and the file says not to submit it before the
  owner says so. Screenshots referenced in the draft are still to be captured from a real build;
  the `privacy_policy_url` needs `/privacy` to exist before this is submitted anywhere.
- **The fourth Capacitor target (`seeker`)** exists in the wrapper repo — `capacitor.config.ts`
  has a `seeker` block (appId `app.clucknorris.seeker`), and `npm run build:seeker` / `build:seeker-dev`
  scripts are in `package.json`. This is what makes the app a *bundled* Solana Mobile Stack app
  rather than a Capacitor shell pointed at the live website — the FAQ language that scores a
  remote-loading wrapper poorly.

## 4. SKR integration

- **The SKR door on the tools pass** (shipped #395, 2026-09-22): holding SKR worth **the door's
  own dollar figure, served live from `GET /api/tool-gate/config`** (`skr.holdUsd`) — never a
  hardcoded number in this doc or in the app — opens the same free tier as holding CLKN. Only the
  Seeker app sends `doors:["skr"]`; the website and the store editions never grow the door. SKR
  only ever *adds* a grant on a verified qualifying balance — a missing or stale SKR price is a
  denial, never a free pass (Codex round 13, `lib/tool-pass-qualify.js`,
  `scripts/tool-pass-qualify-test.cjs`).
- **In-app SKR/CLKN/SOL/USDC swap — IN FLIGHT, PR #420, in review, not merged.** Design of record:
  `docs/SEEKER_SWAP_DESIGN.md`. A server-mediated Jupiter proxy (`server.js`, two new endpoints
  wired into `SEEKER_API_RE`) so the app never talks to Jupiter directly, plus versioned-
  (`VersionedTransaction`) support added to the one shared signing seam so a multi-hop SKR route
  (which needs address lookup tables) can sign through the same path every other tool uses rather
  than beside it. Round-of-fixes commits on the branch (verify against quote, lock the form during
  an unconfirmed swap, fix confirm-sheet figures) show active adversarial review; **not merged to
  `develop` as of this doc.**
- **A $1-of-SKR, 7-day tools pass — PLANNED, design only, PR #421.** Design of record:
  `docs/SEEKER_SKR_PASS_DESIGN.md`. A server-signed SKR quote (HMAC token pinning
  `{wallet, amountRaw, expiresAt}`, priced off the same sanity-banded SKR price the holdings door
  uses) so the app can pay the existing 7-day pass in SKR instead of only SOL. Explicitly scoped
  to start **after** #420 merges (both touch the tool-gate block). **No code has been written for
  this yet** — it is a design document only.

## 5. AI

**Ask Cluck** is a first-class pane in the Seeker app (`/ask`, free tier, no wallet needed) — the
same AI tutor product as the website, present in **every course/lesson pane** of the bundled
school (`src/seeker/school/*`) and in the standalone `/ask` route, in the same **seven languages**
the rest of the school ships in (en / es / hi / it / pt / vi / zh — AGENTS.md). The school itself
is bundled and works offline (`src/seeker/school/curriculum.js`); only the AI call and the
completion beacon need a connection, and the completion beacon is fire-and-forget with a durable
retry queue.

## 6. Mobile-native UX — with evidence

- **One shared signing seam, not per-tool submit code.** `src/seeker/sign.js`'s `signSendConfirm`
  is used by Firepit, Project Burn and the Locker Room; `src/seeker/reclaim-sign.js`'s
  `runFullReclaim` by Rent Reclaim. Both distinguish "the node refused it" (safe to retry) from
  "the request never completed" (the transaction may already be signed and in the cluster —
  reported as `unconfirmed`, never silently retried). Written up finding-by-finding, with what
  pins each fix, in `docs/HANDOFF_2026-09-21_SEEKER.md` and
  `docs/SEEKER_MONEY_REVIEW_burn.md` / `docs/SEEKER_MONEY_REVIEW_send.md`.
- **Explicit states on every pane** — refused / unavailable / offline / empty — not a blank screen
  or an infinite spinner (PR #396, `src/seeker/pane.jsx`'s `useOnline()`/`toolFetch()`).
- **Locker Room is the app's only two-signer transaction** and follows the repo-wide rule: the
  connected wallet signs first, then the ephemeral escrow key co-signs — never the reverse
  (AGENTS.md's Phantom "may be malicious" trap; `src/seeker/tools/LockerRoom` panes).
  `src/seeker/edition/full.jsx` route table records this per-route in
  `docs/SEEKER_DEMO_INVENTORY.md` §1.
- **Two editions from one shell, selected at build time** (`vite.config.js`'s `@seeker-edition`
  alias): the full Seeker edition carries a wallet; the Play/iOS education edition compiles the
  wallet out entirely (`HAS_WALLET = false`) rather than hiding it behind a flag —
  `docs/SEEKER_DEMO_INVENTORY.md` §2.
- **Seven-language i18n, extractor-checked.** PR #398 added a string-aware i18n extractor so new
  panes cannot ship English-only strings unnoticed.
- **Tests that exist and were run**, not asserted: `seeker-build-test.cjs`, `seeker-reclaim-sign-
  test.cjs`, `seeker-airdrop-test.cjs`, `seeker-demo-inventory-test.cjs` (pins the route tables
  above against the files on disk), `seeker-cors-test.cjs`, `tool-pass-qualify-test.cjs`,
  `tool-pass-gate-test.cjs`.

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
- No claim that wallet connect/sign has been exercised on a real device — it has not (§3).
- No claim that the SKR swap or the SKR-priced pass are shipped — both are explicitly in-flight or
  planned (§4), not built.
- No claim about Seed Vault integration — none exists.

## 8. Submission checklist

| Item | Status |
|---|---|
| Functional Android APK, direct download link | Produced by the wrapper repo's `android-build.yml` from `npm run build:seeker`; **link is a placeholder** until a real signed build is produced and hosted |
| Public GitHub repo with source | This repo, `clucknorrisapp/cluck-norris-school` — already public |
| Demo video (≤ shows functionality) | **TODO.** `docs/DEMO_STORYBOARD.md` is a Colosseum-specific storyboard (different rules, different format) — **not** directly reusable; a Seeker-specific storyboard needs to be written. Owner records the video. |
| Pitch deck / brief presentation | Owner's to build; this document is the factual source material |
| Judge GitHub access | **Must be granted BEFORE submitting** — judging happens weeks after the close date, so access set up after submission is too late. Not yet granted as of this draft. |
| Team funding declaration | Open question — see §9 |
| Submit | **Do not submit.** This package stays in draft; the final submission is the owner's explicit go, and the entry agreement is not signed until he says so. |

## 9. Open questions for the owner

1. **VC/angel funding eligibility.** The rules state *"only teams without VC/angel funding are
   eligible for USDC prizes."* Needs an explicit owner statement before submitting.
2. **Which scoring scheme governs** — the platform's own weighted config (AI 20% / SKR 20% / UX
   15% / UI 15% / Innovation 15% / Ecosystem Impact 15%) or the published FAQ's four-equal-25%
   scheme. `docs/CLOCK_IN_HACKATHON_2026.md` flags this is unresolved; **ask in office hours,
   Discord Wed 18:30 UTC**, before finalizing what the deck emphasizes.
3. **appId decision** — ship the hackathon build under its own appId (`app.clucknorris.seeker`,
   zero risk to the live `app.clucknorris.school` listing) or fold it into the existing listing.
   `docs/SEEKER_APP_PLAN.md` §"Ship it under its own appId" recommends the former; needs an
   explicit owner call before the dApp Store draft is finalized.
4. **Whether to wait for #420/#421 (SKR swap + SKR pass) to merge before freezing this package** —
   given SKR Integration may be worth 20% of the main score, or a separate $10k prize, whichever
   scoring scheme applies.
