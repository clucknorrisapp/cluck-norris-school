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
