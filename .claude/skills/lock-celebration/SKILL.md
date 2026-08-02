---
name: lock-celebration
description: Fire the CLKN lock-celebration one-post flow (X first with image, then Telegram with the X link) from the pending payload. Use when new locks land, when the owner says "fire the lock post", or when re-arming the hourly watcher.
---

# Lock celebration — one-post flow (owner standing approval)

All endpoints are gated: append `&key=$PREMIUM_ACCESS_KEY`. NEVER post when pending is null.

## 1. Read the pending payload
`GET https://clucknorris.app/api/lock-celebration?key=…` → if `pending` is null, STOP (nothing to announce).
Payload fields: `delta/total/pct/newLocks/lockCount`, `tgText`, `xText`, `announced`,
`jupLockedShort`, `strmLockedShort`, `platform`, `deltaShort`.

## 2. Generate the TWO-VAULT image (all elements mandatory)
Spawn a **sonnet subagent** (`claude-sonnet-5`) to craft the Higgsfield prompt, then
`generate_image` (nano_banana_pro, ~2 credits). Scene spec:
- TWO vault doors: "JUPITER LOCK" (engraved `jupLockedShort` CLKN) + "OTHER LOCKS" (engraved `strmLockedShort` CLKN). Never name or tag a non-Jupiter locker in art or copy (owner ask 2026-08-01).
- Cluck hauls exactly `newLocks` bag(s), main bag reads "+{deltaShort} CLKN", walking TOWARD the vault named in `platform` (that door glows).
- Banner across both doors: "{pct} OF SUPPLY LOCKED". Dark + orange palette, crisp legible type.
- Use the branded mascot reference from `docs/MEDIA_LIBRARY.md`; VIEW the render and verify every label before posting.
- Prompt the AI to keep the BOTTOM 15% of frame quiet (plain floor, no text/objects).

## 2b. Composite the "ROAD TO 50%" progress tracker (owner ask 2026-07-10 — the lock-post signature)
`python3 scripts/lockbar.py <render.png> <final.jpg> <pctLocked e.g. 45.211> [target=50]`
(fonts ship in scripts/; needs Pillow — `pip install pillow`). Draws the exact-fill progress bar
on the bottom strip. If the render has a text typo, patch it deterministically with
Pillow (sample brass + redraw glyph) — do NOT re-roll AI edits on tiny plaque text (it makes
new typos; cost us a CCKN on 2026-07-10).

⛔ **HOST THE COMPOSITE ON OUR OWN ORIGIN — do NOT use Higgsfield `media_confirm`.** That tool is
gateway-pinned to `always_ask` (unfixable from any settings page — see HANDOFF_2026-08-02 §1
addendum), so hosting through it stalls the flow on a permission tap the owner has explicitly
refused (2026-08-02: "I shouldn't have to do this"). Instead: `cp` the final composite to
`public/lock-post-<pct>.jpg`, commit, push to main; Railway's build copies `public/` into `dist/`
and the static handler serves it. Poll `https://clucknorris.app/lock-post-<pct>.jpg` until 200
(~2-4 min), then post THAT url. Generation (`generate_image`, `job_display`, `media_upload`) is
still Higgsfield — those are always_allow and never prompt; it is ONLY the confirm step that is
pinned. Post the composite, never the raw render.

⚠️ **The target lives in `lockbar.py`'s DEFAULT — do not just pass it as argv[4].** Three separate
sessions "raised it to 50" by passing 50 on the command line while leaving the default at 40, so the
next session read 40 and drew a full bar on an already-passed goal. Owner, 2026-08-01: *"we have
already made it 50 percent twice, so this keeps reverting."* Current default is **50%** (supply
locked passed 40% long ago; 45.21% as of 2026-08-01). When 50% is passed, edit the default in
`scripts/lockbar.py` AND this line, and commit — a runtime argument is not a decision that sticks.

## 3. Post — X FIRST, then Telegram (if `announced:false`)
1. X: `GET /api/x-announce?key=…&post=1&text={pending.xText}&image={rawUrl}` → capture post id.
2. Telegram (SILENT — never loud): `GET /api/tg-test?key=…&photo={rawUrl}&text={pending.tgText}%0A%0A🐦 On X — like %26 repost: https://x.com/FireChicken007/status/{id}`
3. Clear: `GET /api/lock-celebration?key=…&clear=1`

## 3b. Fallback already fired (`announced:true`)
Degrade to two-step: X image reply under `xPostId` with a SHORT punchline (never restate numbers);
TG photo with self-sufficient caption + `replaceMsg=` (comma-join `tgMessageIds`).

## 4. Re-arm (each long-lived session)
CronCreate jobs expire ≤7 days — re-arm an hourly cron: poll → if pending: generate → post → clear.
Floor is 10K CLKN (`LOCK_WATCH_MIN_DELTA`); server fallback posts text-only after 6h if no session picks it up.
