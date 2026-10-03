# iOS: a real app, not a webpage — plan (written 2026-09-22, for after the Seeker submission)

> **Owner, 2026-09-22:** *"we could make it so much more for the iphone duo! lets think outside
> the box on how we make the ios version a real app and not a webpage"* — and, on scope: *"i just
> said more like an app not that we add wallet features."*
>
> So: the **education-only posture stays** (no wallet, no payments, no address — see
> `docs/STORE_EDITION.md`). This plan is about what the phone can do that a webpage cannot, on the
> bundle that already exists. The Apple developer account is not set up yet, so nothing here has a
> date; **nothing starts before the Seeker submission closes (2026-10-09 06:59 UTC).**

## What exists to build on

- The iOS edition is the Seeker shell (`src/seeker`) with the wallet half compiled out:
  `vite.config.js` aliases `@seeker-edition` to `src/seeker/edition/edu.jsx`. School, Ask Cluck,
  Wallet Checkup (scan only), Listing Checkup, Daily, the certificate of completion. Seven languages.
- It is a Capacitor bundle in the wrapper repo (`clucknorrisapp/CLKN-SEEKER`, target `ios`, appId
  `app.clucknorris.edu`), pinned by sha256 to a `store-google-v*` / `store-ios-v*` release.
- The store-edition contract (`STORE_API_RE` in `server.js`) is versioned; every feature below
  either uses those endpoints unchanged or works offline.
- Tests: `scripts/store-edition-test.cjs`, `scripts/store-shell-boot-test.cjs` (boots the bundle
  in a phone-sized Chromium), `seeker-build-test.cjs` (c) proves no wallet code leaks in.

## The list

Ordered by what it gives a learner per unit of work. Each row says what it is, the native
mechanism, what it reuses, and **how it is verified without a human eye** — the overnight rule.

| # | Feature | Native mechanism | Reuses | Verified by |
|---|---|---|---|---|
| 1 | **Two-pane school on the fold.** Unfolded: the lesson left, the tool it teaches right (rent lesson beside Wallet Checkup, LP Lab beside its calculator). Folded outer screen: a glance surface — today's lesson, streak. Fold/unfold mid-lesson keeps the place. | CSS container queries + a `foldState` from the WebView's viewport; no plugin needed for layout. Outer-screen glance = the same route at the narrow width. | Every pane already renders at 390px; `Pane` wrapper; the lesson↔tool links in the school. | Boot test gains a second viewport pair (narrow, wide) and a resize between them asserting route + scroll + form state survive. **Device dimensions unknown until the phone ships — the widths are parameters, not guesses.** |
| 2 | **Diploma in Apple Wallet.** The certificate of completion as a Wallet pass; its QR is the public verify URL. | `.pkpass` generated server-side (signed with the pass-type certificate, needs the Apple account), added via `PKAddPassesViewController` through a small Capacitor plugin. | `POST /api/claim/certificate`, `/api/certificate/:id`, the verify page. | Server test: a pass bundle validates (manifest, signature, `serialNumber` = certificate id, barcode = verify URL). Boot test: the "Add to Apple Wallet" control appears only after a certificate exists. |
| 3 | **Share extension.** Highlight an address or token link in Telegram, X or Safari → Share → Wallet Checkup / Listing Checkup sheet, without leaving the other app. | iOS Share Extension (Swift) that hands the text to the app via an app group + URL scheme; the app opens the checkup pane with the address filled. | `addr.js` (address parsing), the Wallet Checkup pane's paste path (`#397`). | Unit test on the address extractor with the messy inputs a share sheet delivers (URLs, `@handles`, mixed text). Boot test: the deep link `#/checkup?address=…` opens the pane filled and scanned. |
| 4 | **App Clip.** A QR at an event or a pinned Telegram message opens an instant Wallet Checkup with no install. | App Clip target in the wrapper (≤ 10 MB), a stripped bundle: the checkup pane + the school's front door. | The `edu` edition's build (`build-store-edition.mjs` gains a `clip` variant with a smaller allow-list). | `seeker-build-test` gains the clip variant: size cap, allow-list, no wallet leakage, the same content guards. |
| 5 | **On-device scam screenshot reader.** Paste a screenshot of a DM or a site; the app flags the patterns the school teaches (seed-phrase asks, urgency, fake support handles, look-alike URLs). Private, offline. | Vision framework OCR (native) → a rule set written from the lessons, in JS. No model download, no network. | The scam lessons' own rule list; `CluckUtil.esc`. | A fixture set of screenshots (synthetic, no real people) with expected flags; the OCR step is mocked in CI, the rule set is unit-tested. ⚠️ Never a verdict, always "this matches N patterns we teach" — the forensic-honesty rule. |
| 6 | **Widgets + Live Activities.** Home-screen widget: today's lesson and the streak. Live Activity while a lesson streak is at risk (last hours of the day). | WidgetKit + ActivityKit; data via an app group written by the app on each lesson mark. | `/api/track` marks (already sent), the daily lesson feed. | Snapshot test of the widget's timeline entries from a fixture ledger. Not a rendered-pixel test. |
| 7 | **Siri + Shortcuts.** "Check this wallet" with the clipboard; "Today's lesson". | App Intents (Swift) opening the matching route. | Routes exist. | Boot test of the routes the intents open; the intents themselves are a device check written down in `docs/SEEKER_DEVICE_TEST.md` style. |
| 8 | **Offline lessons.** Every lesson readable with no signal; marks queue and send on reconnect. | Lessons are already in the bundle (curriculum is static). Add: a queued-marks store (the school already re-sends failed beacons on the website). | `lib/school-progress` retry path; `public/i18n/*.json` ship in the bundle. | Boot test with network blocked: every lesson renders, a mark queues, it sends after unblock. |
| 9 | **Native read-aloud.** `AVSpeechSynthesizer` instead of the paid TTS in the app; free, offline, seven languages. | Capacitor TTS plugin. | The read-aloud control and its per-language voice map. | Unit test on the language → voice mapping; the fallback order (native → browser voice) pinned. |
| 10 | **Accessibility that Apple actually checks.** Dynamic Type, VoiceOver labels on every control, reduced motion. | CSS `font: -apple-system-body` scaling + `prefers-reduced-motion`; aria labels. | `theme.css` type scale. | The existing a11y gate (`hub-a11y-test.cjs` pattern) run against the store bundle at two text sizes. |
| 11 | **Haptics + pull-to-refresh + native sheets.** The small things that make a webview feel like an app: haptic on lesson complete, native share sheet for the certificate, rubber-band scrolling that doesn't fight the layout. | Capacitor Haptics/Share plugins; `-webkit-overflow-scrolling`. | — | Boot test: no horizontal overflow, sheet controls present. Feel is a human check, written down. |

Not in this list, by the owner's word: anything that connects a wallet, signs, pays, or shows a
holder gate. The full toolkit stays on the Seeker and the website.

## Apple Watch (owner, 2026-09-24: "could be a way to send daily update or some other type of integration")

Added the day the Apple developer account was paid for and the watchOS toolchain installed. Same
posture as everything above: education only — nothing on the wrist ever shows a wallet, a
balance or an address. Three tiers, cheapest first; each is its own increment with its own test.

| Tier | Feature | Mechanism | Reuses | Verified by |
|---|---|---|---|---|
| W1 | **Daily lesson push, mirrored to the watch.** One notification a day at an owner-set time: today's lesson title + its one question, deep-linking to the Daily pane. iOS mirrors iPhone notifications to a paired watch when the phone is locked, so no watch target is needed. **Lesson only — never the market closes** (Codex round 28: a price line in a notification reads as a trading alert without the school around it). | APNs (a key from the developer account) via the Capacitor push plugin in the wrapper; a server-side sender (`lib/push-daily.js`) with a device-token registry; opt-in on first launch, unsubscribe in settings. Android gets the same sender through Firebase. | **The bundled curriculum's own date-based selection (`src/seeker/school/daily.js`)** — the same lesson and question the Daily pane shows that day — NOT `/api/alpha`, which supplies the market content. The server runs the same selection over the same curriculum JSON so phone and push agree. | Unit tests on the sender: lesson/question ids match `daily.js` for a set of dates including the UTC rollover; payload shape; one send per day per token, idempotent across restart/retry; a dead token is dropped; a token never appears in any public response, analytics event or log line. The device receipt is the owner's. |
| W2 | **Complication on the watch face.** Today's lesson title (or the streak) on the face; tap opens the WATCH app's lesson screen (a complication opens its own watch app, not the phone — Codex round 28). | WidgetKit on watchOS in a Swift target in the wrapper. The phone app **transfers** the daily brief to the watch over WatchConnectivity (`transferUserInfo` / application context); the watch app writes it to its OWN app-group container, which the complication reads. The watch never reads the phone's storage directly. | Same lesson selection. | Wrapper-side test that the phone sends the brief on launch and on date change, and that the watch extension stores what it receives; the face itself is the owner's screenshot. Depends on a minimal W3 shell existing, so W2 ships with or after W3's first cut. |
| W3 | **A watch app.** Lesson of the day, its question answered by tap, the streak, the certificate's verify QR. | SwiftUI + WatchConnectivity (a webview cannot run on the watch, so this is native). | Curriculum JSON (static, bundled), the progress marks queue. | Unit tests on the Swift view model in the wrapper; marks land in the same ledger as the phone's. |

**Privacy and registry contract, stated up front for the reviewer (revised after Codex round 28):**
- A push token is a device identifier. It is stored against a **push install id** minted for this
  purpose only — a fresh random id, **separate from analytics; no intentional linkage** (Codex
  round 28: separate identifiers prevent a direct shared-id join, they do not guarantee anonymity,
  so this plan does not claim it).
- **Authorisation:** registration returns a per-install secret (random, stored on the device
  only, hashed at rest server-side). Replacing a token, changing the send time and unsubscribing
  require that secret; an install id alone authorises nothing, so installation A can never modify
  installation B.
- Never a wallet, never an email; deleted on unsubscribe and on an APNs/FCM "unregistered"
  response — but a DELAYED invalid-token response can never delete a NEWER registration (the
  delete is conditional on the token it names still being the current one).
- Unsubscribe cancels any queued send; token rotation retires the old token in the same write.
- The daily payload carries public lesson copy only.
- Tests required before W1 ships (Codex's list): no registration or send without consent; A
  cannot modify B; tokens absent from public responses, analytics and logs; unsubscribe cancels
  queued sends and rotation retires the old token; a delayed invalid-token response cannot
  delete a newer registration; restart/retry cannot duplicate the daily notification.
- The privacy pages (`/privacy/store`) gain one paragraph before W1 ships.

Sequencing: **all three wait for the Seeker submission to close (2026-10-09), like the rest of
this plan.** Codex round 28 recommended it and the owner's reviewer count is the constraint: W1
adds native permissions, two delivery providers, a token lifecycle and privacy work while
money-path reviews are open. The Android reuse is real but does not make it a small server-only
addition.

## Sequencing

1. **After 2026-10-09 only.** The Seeker submission is the track until then.
2. **First the account.** Apple developer enrolment is the owner's; the pass-type certificate (#2)
   and every extension target (#3, #4, #6, #7) need it. Nothing native can be built or tested
   without it. Enrolment as an organization is a one-time choice made at sign-up.
3. **Then the wrapper.** Every extension target lives in `CLKN-SEEKER`; the main repo only ships
   the bundle and the server-side pieces (the pass generator, the clip allow-list).
4. **Order of build:** #8 (offline) and #10 (accessibility) first — pure bundle work, no
   account needed, verifiable today. Then #2, #3, #4 in that order once the account exists. #1
   waits for the device's real dimensions. #5 is its own increment with its own review (it reads
   screenshots — privacy copy and the "never a verdict" rule must be right). #6, #7, #9, #11 fill
   in behind.
5. **Every increment ends as a PR with a test, per `docs/OPERATING_MODEL.md`.** What needs an
   iPhone in hand is written as device-test steps, never claimed.

## The owner's decisions before any of it starts

- Apple developer account: when, and as an organization.
- Replace the education listing when it ships, or version it (`store-ios-v1.2.0` and up).
- The scam screenshot reader (#5): go or no-go on reading users' screenshots at all, even on
  device. It is the strongest "real app" feature and the one with a privacy story to get right.
- Which foldable, once it exists: inner/outer dimensions and whether a glance surface is worth
  building for the outer screen.
