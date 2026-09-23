---
paths:
  - "src/seeker/**"
  - "seeker.html"
  - "store-edition/**"
  - "scripts/seeker-*.cjs"
  - "scripts/store-*.cjs"
  - "docs/SEEKER_*.md"
  - "docs/STORE_EDITION.md"
---

# Store edition + Seeker app traps

Moved verbatim from `AGENTS.md` (2026-09-23 split). Loads automatically for any session touching
the Seeker app or the pinned store-edition bundles. Text below is unedited — see `AGENTS.md` for
the sections that stayed there.

> 📱 **The Google Play app is a PINNED, education-only bundle — read `docs/STORE_EDITION.md`
> before touching any endpoint it calls.** Shipped 2026-09-11 as release `store-google-v1.0.0`
> (built from main `dc8652a`; the wrapper repo `clucknorrisapp/CLKN-SEEKER` pins the tarball by
> sha256). A website deploy never changes the installed app, so **the endpoints in `STORE_API_RE`
> (`server.js`) are a versioned contract**: `/api/ask-cluck` + `/report`, `/api/track`,
> `/api/claim/certificate`, `/api/certificate/:id`, `/api/i18n/translate`, `/api/tts`,
> `/api/helius-rpc`, `/api/wallet-checkup`, `/api/listing-checkup/*` — don't rename them or change
> their response shapes without cutting a new `store-google-v*` release (the workflow has a manual
> run; a cloud session cannot push tags). The store's legal pages are `/privacy/store` and
> `/terms/store` and must stay true to that bundle (no wallet, no payments, no address). The
> `ClucknorrisPlay` / `ClucknorrisIOS` user-agent marker is refused on excluded endpoints as
> defense-in-depth only — never treat it as authorisation.

- 📱 **The Seeker app calls production CROSS-ORIGIN, from `https://localhost` — every endpoint it
  uses needs CORS for that origin (`SEEKER_API_RE` in `server.js`), and a browser test proves
  nothing about it.** On 2026-09-22 the owner's pass sheet said "Could not reach the pass service":
  the tool-gate endpoints answered 200 to curl and a 404 to the webview's preflight, because only
  the education edition's contract (`STORE_API_RE`) had CORS and it deliberately excludes
  everything that pays, signs, mints, locks or sends. 15 of the 23 endpoints the app calls were in
  that state — every POST and every `x-clkn-pass` GET. `scripts/seeker-cors-test.cjs` (CI) derives
  the app's endpoint inventory from `src/seeker` and boots the server to send the real preflight
  per endpoint; **a new pane that calls a new endpoint must add it to `SEEKER_API_RE` or that test
  fails.** The Origin still grants nothing (every endpoint keeps its own gate) and the store UA is
  still refused on these — now WITH the CORS headers, so the education app reads the 403.

## Buy Special is not in Seeker

Extracted from the "Buy Special / buy comp is OFF the main webpage" decision in AGENTS.md's "Open decisions" section (that section otherwise stays in AGENTS.md).

- **And NOT in the Seeker app at all (owner, 2026-09-22: "buy special is in the tools list and
  shouldn't be in here at all on seeker")** — the `buyspecial` registry entry, route, pane and
  CSS were deleted; the wrapper's listing no longer names it. Don't re-add it to the app.
