# Scoping the CSP nonce work

Written 2026-08-01. This is a **plan, not a change** — nothing here is implemented.

`docs/HANDOFF_2026-08-01.md` §1a calls this "the highest-value security work left". That is still
true, and the reason is specific to this codebase: the forensic tools render **attacker-controlled
token names and symbols**, so an injected-markup XSS is the live risk, not a theoretical one.

The shipped CSP (`0ec4bc6`) blocks an injected `<script src="https://evil/…">` because `script-src`
pins four external origins. It does **not** block an injected inline `<script>`, because
`'unsafe-inline'` is present — and it is present because every tool page is vanilla HTML with
inline JS.

**Headline: this is a bigger job than "add a nonce to ~20 pages", and the biggest cost is not the
`<script>` blocks.** Measured below. There is also a cheap, genuinely valuable first step that is
worth doing on its own even if the rest never happens.

---

## 1. The measured surface

Across the 35 files in `public/`:

| Thing | Count | Does a nonce fix it? |
|---|---:|---|
| Inline `<script>` blocks | 35 | ✅ Yes — this is what nonces are for |
| External `<script src>` | 80 | n/a — already pinned by the shipped CSP |
| **Inline event handlers** (`onclick=` …) | **189** | ❌ **No** |
| `style="…"` attributes | 718 | ❌ No |
| `<style>` blocks | 36 | ✅ Yes |
| `javascript:` URLs | 0 | — nothing to fix |

Worst pages by combined inline surface: `airdrop.html` (4 scripts + 34 handlers),
`hatchery.html` (24 handlers), `lp-scanner.html` (21), `wallet-checkup.html` (19),
`buycomp-admin.html` (13), `classroom.html` (12).

### Why the 189 matter more than the 35

A nonce authorises a specific `<script>` element. **It does nothing for `onclick="…"` attributes** —
under a nonce-based policy those simply stop firing, and the only CSP escape hatch
(`'unsafe-hashes'`) is a poor one that reintroduces much of the risk. So going nonce-only means
**rewriting 189 handlers into `addEventListener` calls** across ~20 pages. That is the real work,
it is behaviour-changing, and every one of those handlers is a button a user clicks — several on
money paths.

The 718 `style=` attributes are a separate ceiling: nonces do not cover style *attributes* either,
so **`style-src 'unsafe-inline'` has to stay** regardless. That is an acceptable outcome — inline
style is a far weaker vector than inline script — but it means "CSP with no `unsafe-inline`
anywhere" is not a reachable goal here without a much larger rewrite.

## 2. The architectural blocker: `res.sendFile`

Pages are served by **40 `res.sendFile(...html)` call sites** covering 34 distinct files, with **no
shared helper**. `sendFile` streams bytes from disk — there is no interception point to inject a
per-request nonce.

So nonces require replacing every one of those call sites with a read-template-send path. Done
naively that also throws away `sendFile`'s caching and range handling, and it must not be done
naively for one page in particular:

> `normie-quest/public/normie-quest-platformer.html` is **10,257,104 bytes**. Re-reading and
> string-replacing a 10 MB file on every request would be a serious regression on a route people
> actually play.

## 3. Recommended sequence

### Phase 0 — drop `'unsafe-eval'` from the main site *(cheap, do this first)*

Verified: **nothing in `public/` or `src/` calls `eval()` or `new Function()`.** The only consumer
is vendor Phaser (`public/vendor/phaser-3.60.0.min.js`, also inlined into the standalone build).

So `'unsafe-eval'` — currently granted to every page on the site — is needed by exactly one route.
Giving the game route its own looser policy and removing `'unsafe-eval'` from the global one is a
real reduction in attack surface for **zero page rewrites**.

This is independently worth shipping and does not depend on any of the phases below.

### Phase 1 — a `sendHtml()` helper with per-route CSP

Introduce one helper that reads (and caches in memory, invalidated by mtime), injects a
per-request nonce, and sets the CSP header for *that response*.

The per-route part is the insight that makes the rest tractable: **CSP can then differ per page**,
so pages migrate one at a time and each gets its stricter policy the moment it is ready. Without
it, every page must be finished before a single global flip — which is how a job this size stalls
half-done and delivers no security benefit at all.

Exclude the 10 MB game page from templating; it keeps `sendFile` and its own policy.

### Phase 2 — de-inline the handlers, page by page

For each page: convert `on*=` attributes to `addEventListener`, move the inline `<script>` body to
a nonce'd block, then tighten that route's policy. Order by risk × size — the money paths first
(`airdrop.html`, `hatchery.html`, `buyspecial-pro.html`, `locker-room.html`), the read-only
dashboards last.

Budget honestly: ~20 pages, 189 handlers, and **every page needs clicking afterwards**, because a
handler that silently stops firing looks exactly like a page that loaded fine. Source-scanning
alone will not catch it — this is precisely the failure CLAUDE.md's "check every form" section
describes.

### Phase 3 — flip and verify

Only once a page's handlers are gone does its `script-src` lose `'unsafe-inline'`. `style-src`
keeps it (§1).

## 4. Verification — and the gap that is still open

Per CLAUDE.md, rendered measurement and source scanning have complementary blind spots; both are
required. For this work specifically:

- **Source scan:** zero `on*=` attributes remaining on a migrated page.
- **Rendered:** load the page in a real browser, click every control, and assert **zero CSP
  violations** *and* that the controls still work. A silent no-op is the expected failure mode.
- Read the harness's own status flag before believing a green — an assertion that never ran reports
  the same "0 violations" as one that passed.

⚠️ **Still true from the handoff:** the 20-page browser check has only ever run against a **local**
server. It could not run against production, because this container's browser gets
`net::ERR_CONNECTION_RESET` for every external host — so a "0 violations" result from here is
meaningless, the pages never loaded. `curl` *can* reach production and confirms headers are sent
(verified again today, including the new `Permissions-Policy`), but headers are not the same as
no-violations. **The production browser check still needs to run from somewhere with real network
access.**

## 5. Recommendation

Ship **Phase 0** on its own — it is small, needs no page rewrites, and is a genuine improvement.

Treat **Phases 1–3 as a deliberate project**, not a quick fix, and do not start it in a session
that cannot finish a meaningful slice: a half-migrated page is strictly worse than an unmigrated
one, because the handlers stop working while the policy still allows inline script. Phase 1's
per-route CSP is what makes stopping between pages safe.
