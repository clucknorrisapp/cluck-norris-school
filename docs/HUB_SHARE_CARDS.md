# Hub share cards — Open Graph / Twitter Card meta (Colosseum roadmap §9, Y4)

What ships: every Hub project, program and receipt page (`/hub/:project`,
`/hub/:project/p/:program`, `/hub/:project/r/:sig`, the demo fixture at `/hub/demo…`, and
`/for-projects`) is served with server-rendered `<meta>` tags in its `<head>` — so a holder who
pastes a receipt link into X or Telegram gets a card that says what it is, instead of the bare
URL or a stale generic title. **No dynamic image generation** (the roadmap line): every page
points at the same one static, branded PNG — `public/og/hub-card.png` (1200×630, committed to the
repo, generated once by a throwaway script the same way `public/lp-lab-card.jpg` was, never
regenerated per request).

## What's in the `<head>`

```html
<title>…</title>
<meta name="description" content="…">
<meta property="og:title" content="…">
<meta property="og:description" content="…">
<meta property="og:type" content="website">
<meta property="og:url" content="https://clucknorris.app/hub/…">
<meta property="og:image" content="https://clucknorris.app/og/hub-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="…">
<meta name="twitter:description" content="…">
<meta name="twitter:image" content="https://clucknorris.app/og/hub-card.png">
```

The title and description are the only per-request values. They are built **only** from the same
public view functions the JSON routes already call — `hubProjectView()` (wraps
`lib/hub/public.js`'s `projectView`) and `hubPublic.findReceipt()` — never from a private field,
and every value is HTML-escaped with the shared Node-side escaper (`lib/html-escape.js`) before it
reaches the page. Title is clamped to 70 characters, description to 200. A receipt page's
description names the amount, the symbol and the line **"reproducible from the published
inputs"** (upgrading to "independently committed on-chain" only once a program version carries an
observed on-chain commitment — roadmap E3, not live for any real program yet, so this branch is
currently inert). A `dryRun` project (POKEAHOE) or the Colosseum demo fixture gets a plain DRY RUN
label appended — "DRY RUN — fixture data." for the demo, since there is no project team to name.

A missing project, program or receipt still serves the page at **200** with the **generic** Hub
meta (`"Project Hub — receipts you can verify"` / the standing description) — the client renders
its own not-found state; the share card itself never looks broken to an unfurler just because the
thing it pointed at was removed or mistyped.

Implementation: `server.js` (search for "Y4: shareable Hub pages") reads `public/hub.html` and
`public/hub-demo.html` once, caches the raw file, and on each request replaces a `<!-- OG -->`
placeholder (plus the static `<title>`/`<meta name="description">` tags) with the computed block —
the same pattern the Lock of Fame and LP Lab share cards already use elsewhere in this file. The
image is served from an explicit route (`GET /og/hub-card.png`, `Cache-Control: public,
max-age=31536000, immutable`) rather than relying on the vite-built `dist/` static mount, so it
also works on a no-build boot (CI, a fresh clone).

## Checking a real unfurl

The commands below inspect the meta tags directly — the fastest way to see exactly what ships,
with no dependency on a third party's cache:

```bash
curl -s https://clucknorris.app/hub/cuna | grep -oE '<meta[^>]+(og|twitter)[^>]+>'
curl -sI https://clucknorris.app/og/hub-card.png | grep -iE '^(HTTP|content-type|cache-control)'
```

To see how X and Telegram actually render the card (both cache by URL, so a first-time check
against a URL you have not shared before is the honest test):

- **X**: paste the link into a new post's compose box (do not send it) — X shows the card
  preview inline before the post goes out. X no longer runs a public card-validator tool outside
  the composer, so the compose-box preview is the check.
- **Telegram**: message the link to **`@WebpageBot`** (Telegram's own link-preview debugging bot)
  — send it the URL and it returns the exact title/description/image it would show, plus a
  "refresh" option if it has a stale copy cached from before this shipped.
- **Generic OG debugging**: `https://www.opengraph.xyz/` or `https://cards-dev.twitter.com/`
  (twitter's legacy validator, sometimes still reachable) — both re-fetch and render a card from a
  URL's live meta tags, useful for a quick visual check without posting anything.

Whichever tool you use, expect: the branded PNG (checkmark + "PROJECT HUB — Receipts you can
verify"), a title naming the specific project/receipt, and — for POKEAHOE or the demo fixture — a
visible DRY RUN mention in the description.

## Automated coverage

`scripts/hub-og-test.cjs` (wired into the CI smoke job, diff-gated the same way
`hub-a11y-test.cjs` is) boots the real server with one hostile-label project pre-seeded into a
throwaway `DATA_DIR` and asserts, over real HTTP:

- the image route is `200 image/png` with a long cache header and a non-trivial body;
- the Hub index and an unknown project both carry the generic meta;
- a real project's `<`/`&`-bearing label reaches the page **escaped**, never raw;
- title/description stay under the 70/200 char caps and the description names the
  reproducibility line;
- the demo project, demo-b, a demo program and a demo receipt all carry "DRY RUN — fixture
  data" and the same one static card;
- a missing demo receipt still serves 200 with the generic meta;
- `/for-projects` carries the static generic card.

Run it locally with `OG_TEST_PORT=3222 node scripts/hub-og-test.cjs` (or pass a running base URL
as the first argument to test staging/production directly).
