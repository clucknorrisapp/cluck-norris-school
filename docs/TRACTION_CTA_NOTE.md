# The daily lesson tweet's CTA — the one-line change, and why it isn't made here

W9 part 2 (`docs/COLOSSEUM_ROADMAP.md`) asks for this note instead of the change itself: the
lesson tweet is a public X post, and touching what it says or where it points is a brand action
the owner signs off on, not something a build session decides on its own initiative. This file
describes the change precisely enough that the owner (or a session he explicitly asks) can make
it in one edit when he wants the CTA line to point at the Hub during the hackathon window.

## How the CTA is actually composed today

`server.js`'s `notifyEduPost()` posts the full lesson to X first (`postToX`, the `force: true`
lesson carve-out — CLAUDE.md, "X_AUTOPOST_PAUSED hard-gates postToX"), then posts a **separate
self-reply** underneath it carrying the links, so the links never throttle the lesson tweet's own
reach:

```js
try { await postToX(route ? `🛠 ${route.label} → ${route.url}\n\n${X_LESSON_REPLY}` : X_LESSON_REPLY, { replyToId: r.id, force: true }); } catch (_) {}
```

Two pieces decide what that reply says:

1. **`route`** — `eduToolRoute(topic)` keyword-matches today's lesson topic against
   `EDU_TOOL_ROUTES` (`server.js`, just above `eduToolRoute`) and returns the first tool whose
   `match` regex hits, e.g. a lesson on locked liquidity currently routes to the Locker Room
   (`clucknorris.app/locker-room`). Most of the ~30 `EDU_TOPICS` don't match any entry, so `route`
   is `null` on most days.
2. **`X_LESSON_REPLY`** — the fixed fallback line every reply carries, used alone whenever `route`
   is `null`:
   ```js
   const X_LESSON_REPLY = "📚 Full school + free token tools → clucknorris.app\n📊 CLKN chart: " + CLKN_DEXSCREENER + "\n💬 t.me/FireChicken007";
   ```
   This is the "fixed site link" — it always points at the bare homepage, never at any specific
   page, regardless of the day's topic.

## The one-line change

Swap the bare homepage link in `X_LESSON_REPLY` for the Hub's no-wallet demo:

```js
const X_LESSON_REPLY = "📚 Full school + free token tools → clucknorris.app\n🎓 See a project's rewards actually paid → clucknorris.app/hub/demo\n📊 CLKN chart: " + CLKN_DEXSCREENER + "\n💬 t.me/FireChicken007";
```

(Or, more conservatively, replace the first line's link outright rather than adding a second
line, if the owner wants to keep the reply from getting longer — either is a one-line diff to
this single constant.) Nothing else needs to change: every lesson whose topic doesn't match a
specific `EDU_TOOL_ROUTES` entry would carry the Hub link from the next post onward, and the
`route`-matched days are unaffected since those already override `X_LESSON_REPLY`'s first line
with a more specific tool.

A second, narrower option that touches even less: add one entry near the top of
`EDU_TOOL_ROUTES` matching lock/vesting/staking-flavored topics (`staking`, `lock-up period`,
`vesting schedule` already exist as `EDU_TOPICS`) and pointing at `/hub/demo` — this only changes
the CTA on days the lesson is actually about locking, leaving the general fallback alone. Either
approach is additive and reversible (delete the line, or move it back) — nothing about the
posting mechanism, the pause gate, or the force carve-out changes.

## Why this is the owner's call, not a build session's

- **X posting is a brand action.** `CLAUDE.md`'s working agreement draws the line at anything
  "visual or product-facing" needing the owner's eyeball before it ships, and a public tweet is
  the most visible surface this repo has — more so than a staging page. The lesson tweet already
  carries a scoped `force: true` carve-out through the master X pause specifically because the
  owner asked for it (2026-07-08); widening what that carve-out *says* is the same category of
  decision, not a smaller one.
- **It's an every-day, automatic change, not a one-off post.** Unlike a single Arena/X draft the
  owner reviews and sends by hand (`docs/ARENA_POSTS.md`), this constant is read by the scheduler
  on every future lesson post with no human in the loop per-post. Changing it changes what gets
  said publicly, unattended, for as long as it stays changed.
- **"No public post about hackathon work before kickoff" and the disclosure line are owner-owned
  decisions already** (`CLAUDE.md` hackathon section) — routing existing automated reach at new,
  in-window work is exactly the kind of timing call that section says is his, not inferred.
- **Reverting it is also his call.** If he wants the CTA back to the homepage after the window,
  that is the same one-line edit in reverse — this file is written so either direction is a
  five-minute change once he says go, not a re-investigation.

Nothing here touches `server.js` — this is documentation only, per the task's own instruction not
to change the tweet code.
