# The Store edition — the education-only bundle for Google Play (and later iOS)

Built 2026-09-11 against the wrapper repo's contract (`DELIVERY-CONTRACT.md`,
`STORE-EDITION-MANIFEST.md` in CLKN-SEEKER). This is the main-repo side: what the bundle is, what
is in it, how it is built, published and verified, and what the backend does for it.

## What it is

A **separately built, allow-listed frontend** of the school: education + free read-only research,
with **no wallet, no holder gate, no payments, no on-chain transactions and no token promotion** —
the excluded flows are **compiled out**, not hidden. It is bundled INTO the app by the wrapper
(Capacitor `webDir`), so it runs from a webview origin (`capacitor://localhost` on iOS,
`https://localhost` on Android) and calls the live backend at an absolute `https://clucknorris.app`.

- FULL = the website + the Solana Seeker dApp Store wrapper (which loads the live site). Untouched.
- STORE-google and STORE-ios are feature-identical in v1 and built from the same code; they are
  versioned separately for future divergence.

## In / out, reconciled against the code on 2026-09-11

| Surface | Store v1 | Note |
|---|---|---|
| Incubator, the class course, Library, LP Lab, 7 languages, read-aloud, Ask Cluck | IN | Ask Cluck gains a **Report this answer** control (Google generative-AI policy). |
| Graduation | ADAPT | A **certificate of completion** with a verification code, issued by `POST /api/claim/certificate` against the same server-side progression ledger the wallet claim uses. No wallet, no address collection; the name on the certificate stays on the device. Verify at `/certificate/<id>`. |
| Wallet Checkup | ADAPT | **Scan only.** The revoke flow (a signed transaction), wallet connect and the wallet bundle are compiled out. |
| Listing Checkup | ADAPT | Free, no pass: its gate was client-side only. |
| Wallet X-Ray, Cluck Trace, Holders | OUT v1 | Their backends enforce the unified tools pass server-side (since 2026-09-10); "removing the paywall" would mean a backend bypass keyed to something the app carries. The manifest left this decision open; v1 leaves them out. |
| Owners Snapshot | OUT v1 | The crawl is holder-gated server-side (a wallet is needed to start one). |
| Ultimate Challenge, Survival Simulator, Cluck Score | n/a | Removed from the product before this manifest (CLAUDE.md "Removed"); nothing to ship. |
| `/learn` chain pages, Classroom, Transcript lookup | OUT v1 | Server-rendered or wallet-address based; not in the bundle. |
| Hatchery, Firepit, Project Burn, Token Lock, Locker Room, LP Rescue, Airdrop, Buy Special, Liquidity Engine, Buy CLKN / Jupiter widget, token price + reinvestment feed, Bags feed, Investors | OUT | Compiled out; the concierge only links to what the bundle carries. |
| Google Analytics, the Jupiter plugin script, the site-wide nav pill | OUT | Stripped from the store `index.html`. |

## How it is built

- `src/edition.js` — `STORE` folds to a constant from `VITE_STORE_EDITION` (pinned via `define`
  in `vite.config.js`, compared as a literal — a `String(x).toLowerCase()` there would be a runtime
  call rollup cannot fold, and nothing would be eliminated); every `STORE ? … : …` branch is
  dead-code-eliminated and the components only reachable from removed branches are tree-shaken.
  `api()` marks every API call site; the absolute prefix is applied at BUILD time (below), not at
  runtime, so the live site is byte-for-byte unaffected.
- `vite.config.js` — with `STORE_EDITION` set: `publicDir` off (nothing from `public/` is copied
  blindly) and `<!-- STORE:OUT --> … <!-- /STORE:OUT -->` blocks stripped from `index.html`.
- `store-edition/store-edition.json` — version, API base, the allow-list of pages/files/dirs
  copied from `public/`, the remotes the bundle may use, and the forbidden strings.
- `scripts/build-store-edition.mjs [google|ios]` — builds, rewrites every `"/api/` literal in the
  vite chunks to the absolute `apiBase`, copies + transforms the allow-list
  (`STORE:OUT` blocks removed, `STORE:IN` blocks revealed, `/api/` made absolute), **verifies**
  (forbidden strings, relative `/api`, unresolved local links, required files), and writes
  `release/store-edition-<variant>-<version>.tgz` + `.sha256` + `.json` (sourceCommit inside).
  One top-level directory; the wrapper extracts with `--strip-components=1`.
- `scripts/store-edition-test.cjs` (CI) — independent re-check of the tarball plus a booted
  server for CORS, UA defense, the certificate and the report. The forbidden-string checks cover
  code and markup, not the i18n dictionaries: those are the whole site's translation tables, and
  keys for compiled-out copy are dead data there (the JSX that would read them is gone).

Markers in shared pages: `<!-- STORE:OUT … --> … <!-- /STORE:OUT -->` and `/* STORE:OUT */ …
/* /STORE:OUT */` are removed from the store build; `<!-- STORE:IN … /STORE:IN -->` and
`/* STORE:IN … /STORE:IN */` are revealed. On the live site they are comments.

## v1.0.1 (2026-09-12) — the leaks the owner found on-device

v1.0.0 passed its verifier and still carried three things the manifest forbids, all INSIDE allowed
pages: the LP Lab's "See CLKN's live price impact on Jupiter" link (a `jup.ag/swap/…` buy funnel
carrying the CLKN mint), the Library's Meteora / Bags.fm (referral) / Jupiter venue links plus
three sentences naming CLKN's pool and creator fee, and inert residue of the wallet checkup's
connect/revoke flow (CSS rules, a comment, a try/catch call to a compiled-out function — no
signing code shipped; `signAndSend` was absent). All are now compiled out for the store
(`STORE ? … : …` in the JSX, `STORE:OUT` in the page). The verifier gained
`forbiddenPatterns` (regexes): any `jup.ag` route, any referral parameter on any URL except
RootCrak's `?ref=clucknorris` credit, `app.meteora.ag`, `https://bags.fm`; plus the plain strings
for the mint, `CLKN trade`, `wallet-btn`, `syncRevokeUi`, `connectWallet`, `revokeCard`. The CI
test pins the exact v1.0.0 leaks by name. Lesson: an allow-list of PAGES is not an allow-list of
LINKS — every outbound `href` in an allowed page needs the same scrutiny as a page.

## v1.0.2 (2026-09-12) — the dictionaries are pruned, not copied

The wrapper's guard caught the CLKN mint in six `*.school.json` files: an orphaned Survival-Simulator
line ("The official CLKN contract is …") whose English text no longer exists anywhere in `src/`,
so it never rendered — but it shipped. The v1.0.1 verifier exempted `.json` from the forbidden
scan on the theory that dictionaries are inert; that exemption is gone. The build now drops any
dictionary entry whose key or value trips a forbidden string or pattern (logged as a count), then
scans the copied JSON with the same rules as code. A pruned entry can only cost a translation
falling back to English. The six stale entries were also deleted at the source.

Also in 1.0.2, from Codex's audit of the published 1.0.1 tarball (owner's third reviewer):
- **The Ask Cluck report control was broken on-device**: it was rendered INSIDE the "ASK ANOTHER"
  button, whose click clears the answer. It is a sibling control now.
- The Library's worked examples that named CLKN ("CLKN EXAMPLE…", "CLKN graduated to…", "CLKN
  completed this journey…") read as neutral examples in the store variant.
- The footer links `/privacy/store` and `/terms/store` (the website's legal links live in the nav
  pill, which the store strips), and the RootCrak credit carries no referral parameter in the store.
- **Backend-provided links pass a render-time host allow-list** in the store's Listing Checkup
  (`STORE_HOSTS` + `safeUrl()`, revealed by `STORE:IN`): a static verifier cannot see dynamic
  links, so the page enforces the same policy when it renders. Off-list URLs show as text.
- **The verifier is an ALLOW-list of outbound hosts now** (`allowedHosts` in `store-edition.json`,
  checked in every copied file, JS/HTML/CSS/JSON): a new host fails the build until it is added
  deliberately. The deny-list strings and patterns stay as a second layer.

## v1.0.3 (2026-09-13) — the AI-correct edition: Concierge as the landing, Ask Cluck first

Owner's call, relayed through the wrapper session on 2026-09-13: build it right, submit once.
Scope for this submission is "AI done right + graceful web pointers"; Token Autopsy (read-only,
not pass-gated) is the next update; Wallet X-Ray / Holders / Trace stay out (pass-gated
server-side, no honest store-only bypass — the owner leans "no" on freeing them for the store);
Cluck Score never (retired, CLAUDE.md "Removed").

- **The Concierge is the landing screen** (`screen` defaults to `start` in the store build; the
  website keeps the school landing). It is the "Where do I start?" panel: journey cards that
  route into the app plus the app-aware Ask Cluck box — the same thing the Telegram bot's `/start`
  opens. Not a separate bot.
- **Ask Cluck is first**: expanded at the top of the Concierge under "ASK CLUCK — YOUR AI TUTOR";
  a permanent **🐔 ASK** tab in the header on every screen; a prominent Ask Cluck door on the
  school screen. Every answer carries the Report control (`ReportAnswer`, store only).
- **Excluded tools get a pointer, never a dead end**: the research and explore cards and a new
  "More on the web" card carry ONE outbound anchor, `https://clucknorris.app` — the site ROOT,
  never a deep link into a tool the edition does not carry (Apple 3.1.1 / Google review line) —
  with neutral wording ("the full toolkit lives on clucknorris.app"). The research card is titled
  "Token research tools" in the store (no token name in a title).
- Concierge cards still route only to `STORE_PAGES` surfaces; policy unchanged: no wallet, no
  address, no referral, no CLKN promotion; `scripts/store-edition-test.cjs` unchanged and passing.

## v1.1.0 (2026-09-21) — the Seeker shell, in its education edition

Owner, the same day the Seeker app ran on his phone: *"maybe we should rebuild our stuff for google
play and IOS to look similar and real app feel"*, then *"start on the play store version of the
shell"*. So v1.1.0 is a **format change, same contract**: the bundle is the phone-native shell
(`seeker.html`, `src/seeker/*`) built in an **education edition**, instead of the reflowed website.
Every rule the reviewer and the wrapper rely on still holds — no wallet, no payments, no address
collection, compiled out rather than hidden — and every v1.0.x contract item is still in the
bundle. It is a **routine app update**, not a resubmission: same package, same signing key, same
data-safety declarations; the listing needs new screenshots.

**How the edition is chosen.** `store-edition.json` says `"entry": "seeker"`; the builder passes
`STORE_ENTRY=seeker` and `vite.config.js` (a) builds `seeker.html`, (b) strips the
`<!-- EDU:OUT --> … <!-- /EDU:OUT -->` block from it (the wallet scripts: `cluck-wallet.js`,
`cluck-gate.js`, the vendored web3, the reclaim and airdrop helpers) and every remaining HTML
comment, and (c) aliases `@seeker-edition` to **`src/seeker/edition/edu.jsx`** instead of
`edition/full.jsx`. **That module's import list is the safety argument:** it never imports a
wallet pane, the wallet gate (`needswallet.jsx`, moved out of the shared `pane.jsx` for exactly
this reason), the tools registry, the pass client or the signing helpers, so none of them can
reach the bundle. The forbidden-string scan is the second lock, and it now also refuses the
wallet scripts by filename in `index.html` and any wallet-pane import in `edu.jsx`.

**What the education edition carries** (tabs: School · Daily · Ask · Checkup · Listing):

| Surface | v1.1.0 | Note |
|---|---|---|
| The school | IN | 58 lessons / 4 courses / 200 questions, **bundled and offline**, in seven languages. **The STORE copy of the curriculum**: `scripts/extract-curriculum.js` now resolves the lesson sources' `STORE ? … : …` branches per edition and writes `data/curriculum.store.json` beside `data/curriculum.json`; `@seeker-curriculum` aliases the shell to the right one, so the venue names, the CLKN mint and the token-naming worked examples are physically absent. `--check` covers both files. |
| Certificate of completion | IN | `src/seeker/school/Certificate.jsx`, route `#/school/certificate`, offered from the school's finished state. `POST /api/claim/certificate` with **this device's own session id** — the same anonymous sid every lesson beacon carries — so nothing is transferred and nothing is a bearer credential (this is design 4 in `docs/SEEKER_TRANSCRIPT_HANDOFF.md`, for the certificate only; the wallet-signed diploma cNFT stays on the website). The gate's `not_yet` renders as the record's own sentence, never as an app error. Name stays on the device. |
| Ask Cluck | IN | The **Report this answer** control (`ReportAnswer` in `AskCluck.jsx`, rendered only when the edition passes `report`), a sibling of the answer bubble — `reason`, `question`, `answer` to `/api/ask-cluck/report`, nothing else. |
| Wallet Checkup | ADAPT | **Paste an address.** `WalletCheckup.jsx` takes `address` + `gate`; the full app passes the connect gate, this edition passes an address form (base58 checked on the device before any request). Scan only — no revoke, no connect, no signing. |
| Listing Checkup | IN | Free, no gate. Backend-provided links pass the same render-time host allow-list the v1.0.2 page enforced (`linkHosts` from `edu.jsx`; off-list URLs render as text). |
| Daily | IN | Today's lesson + the daily check (bundled) and the majors from `GET /api/alpha` (**added to `STORE_API_RE`** in this version — read-only, cached). No brief, no picks, no yield figure. |
| Legal | IN | `Footer` in `edu.jsx` links `/privacy/store`, `/terms/store` and the site root ("the full toolkit lives on clucknorris.app" — the root, never a deep link into a tool the edition lacks). |
| Rent Reclaim, Firepit, Locker Room, Project Burn, X-Ray, Holders, Trace, Airdropper, Hatchery, Buy Special, the tools pass | OUT | Not imported by the edition. A stale deep link to any of them lands on the school. |

**Dictionaries.** The old rule excluded *every* seeker string from the google/ios dictionaries;
under it this bundle would have shipped an English app to a Spanish learner. `scripts/seeker-i18n-keys.cjs
--sync-exclude` now computes `excludeKeys` = (existing ∪ every seeker key) − the education
edition's own keys (walked from `edu.jsx`'s import graph), and `seeker-build-test` section (c)
asserts both directions on the artifact: no wallet-only key in a bundled dictionary, and the
shell's own strings still present.

**Tests.** `scripts/store-edition-test.cjs` (contract, restated for the shell — the page-by-page
assertions became chunk assertions; every contract item kept), `scripts/seeker-build-test.cjs` §(c)
(no wallet half, in files, globals, markers or dictionary keys), and the new
**`scripts/store-shell-boot-test.cjs`** (CI): boots the shipped google tarball in headless
Chromium at phone size with every `/api/**` refused — mounts on the school, no wallet layer or
control exists, stale wallet-tool deep links land on the school, all five tabs mount offline,
the address form refuses a bad address before any request, an answer carries the report control
and the report posts exactly `{reason, question, answer}`, the certificate route asks with the
device's sid and renders "not yet" truthfully, the footer links the store legal pages, and
nothing left the bundle's origin but `clucknorris.app`.

**Not in this version, deliberately:** read-aloud (`read-aloud.js`) — the shell has no reader
yet; it comes back when the shell grows one. iOS is built from the identical config
(`variants: ["google","ios"]`) and needs its own TestFlight pass.

**The wrapper side (CLKN-SEEKER), found on the first Play-dev APK.** The web bundle has no wallet,
but the Android wrapper had grown the native Mobile Wallet Adapter bridge (`CluckMWAPlugin`, for
the Seeker edition) in `src/main`, registered for every target — so the education APK carried the
whole MWA client library and a merged `<queries>` entry for the `solana-wallet` scheme, in an app
whose store pages promise no wallet. Inert is not absent: a reviewer sees the library, not our
intent. Since 2026-09-21 the wallet layer is a Gradle property there: `build:play` and
`build:play-dev` pass `-PclknWallet=false`, which compiles an education `MainActivity` that
registers nothing and drops the dependency, and the wrapper's CI reads the produced APK (no
`MobileWalletAdapter` class, no `solana-wallet` query) with the Seeker build as the positive
control. The approved v1.0.0 Play release predates the plugin and never carried it.

## Publishing

```
# bump store-edition/store-edition.json → version, commit, then
git tag store-google-v1.0.0 && git push origin store-google-v1.0.0
```
`.github/workflows/store-edition-release.yml` builds, re-checks and attaches the `.tgz`, its
`.sha256` and the manifest JSON to a GitHub Release. Hand the wrapper the asset URL, the sha256
and the sourceCommit; it pins them in `store-edition.lock` and verifies the digest before bundling.
Bumping the lock is the only way the installed app's frontend changes.

## What the backend does for it (server.js)

- **CORS** for `capacitor://localhost`, `https://localhost`, `http://localhost`, `ionic://localhost`
  (env `STORE_APP_ORIGINS`) on exactly the endpoints the edition calls: `/api/ask-cluck`,
  `/api/ask-cluck/report`, `/api/track`, `/api/claim/certificate`, `/api/certificate/:id`,
  `/api/i18n/translate`, `/api/tts`, `/api/helius-rpc`, `/api/wallet-checkup`,
  `/api/listing-checkup/{config,run,report}`. OPTIONS answers 204. Nothing that pays, signs,
  mints, locks or sends is on that list, and the Origin header grants nothing by itself. Both
  middlewares are mounted before the rate limiters and the sub-routers, so a 429 still carries
  CORS headers (the webview would otherwise read it as a network error) and the UA refusal sees
  the router paths (hatchery, security-coop, whirlpool, swap) too.
- **Defense-in-depth on the UA marker** (`ClucknorrisPlay` / `ClucknorrisIOS`): refused with 403 on
  every excluded endpoint. It is a hint, never an authorisation — spoofing it only loses access.
- **Back-compat policy:** a pinned frontend keeps calling these endpoints; do not rename them or
  change their response shapes without a new store release.

## Legal pages for the store listing

`/privacy/store` and `/terms/store` (`public/privacy-store.html`, `public/terms-store.html`) describe
the stripped app, not the full site: no wallet address, no payments, no token, the anonymous lesson
session id (120-day idle expiry), the certificate record, Ask Cluck + report, read-aloud, and the
providers each feature actually calls. The Play listing's privacy-policy URL and the in-app footer
point here; both load without login and are `noindex`. The live `/privacy` and `/terms` still describe
the website. `scripts/store-edition-test.cjs` checks both pages load and carry no full-site phrases.

## Remotes the bundle uses

`https://clucknorris.app` (API), `https://fonts.googleapis.com` + `https://fonts.gstatic.com`
(theme fonts). External links in content open the system browser.

## Data-collection inventory (for the store privacy forms)

- An anonymous per-install session id (`clkn_sid`, random, stored locally) sent with lesson
  progress events to `/api/track` and with the certificate request — no account, no email, no
  wallet, no device identifiers.
- Ask Cluck: the question text (and lesson context) is sent to the backend, which calls the AI
  provider; a report sends the question, the answer and a reason. Not linked to an identity.
- Wallet Checkup / Listing Checkup: the address or mint the user types is sent for the scan.
- Read-aloud: the lesson text is sent to `/api/tts` when the user taps play.
- Local storage only: progress, bookmarks, language, the certificate name. No analytics SDK.
