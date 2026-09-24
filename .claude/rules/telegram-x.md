---
paths:
  - "server.js"
  - "lib/telegram-*.js"
  - "lib/cuna-giveaway.js"
---

# Telegram / X posting traps

Moved verbatim from `AGENTS.md` (2026-09-23 split). Loads automatically for any session touching
the Telegram/X posting surface or the CUNA giveaway (which posts its own board through it). Text
below is unedited — see `AGENTS.md` for the sections that stayed there.

- **`X_AUTOPOST_PAUSED=true` hard-gates `postToX`.** A new auto-poster that doesn't pass
  `{force:true}` posts nothing and reports `{ok:false,paused:true}`. Carve-outs need an owner ask,
  and must alert the operator chat on failure rather than failing silently. ⚠️ **This list said
  "two carve-outs" and was WRONG** (corrected 2026-09-04 — `force:true` is passed from ELEVEN call
  sites). Autonomous posters that still reach X while paused: **lock announcements**
  (`postLockToX`), **project-burn celebrations** (`broadcastBurnCelebration`,
  owner 2026-08-20 — every verified burn auto-posts X-then-Telegram), the **daily lesson
  tweet and its reply**, the **lesson bump replies**, **chain spotlights**, and **approved queued
  content**. The operator-triggered admin post/meme endpoints also pass `force`, which is no
  surprise — a human just asked for that post. `postToX` now LOGS a line every time the carve-out
  fires, so the real scope is visible rather than inferred. **Keep this list in step with the
  call sites.** ⚠️ The burn broadcaster posts
  **attacker-supplied token metadata** to the brand channels, so it hard-sanitizes the symbol to
  `[A-Za-z0-9]` (never the free-form name) and rate-limits itself (per-wallet/mint cooldown + hourly
  cap) so a griefer can't spam our X into a suspension. Don't loosen either without thinking it through.

- **OnlyRose posting — the owner's rule itself is in `AGENTS.md`** (it is a session-wide policy,
  not a path-scoped trap, so it lives where every session reads it). Enforced in code here, not by
  call-site discipline: `lib/telegram-rooms.js` is consulted by `tgApi()` (the one send choke
  point since the 09-17 consolidation) and by the three direct senders (`/api/tg-test`, the meme
  uploaders, the vault and swap-desk notifiers); a send whose chat is the OnlyRose room is refused
  and logged (`[TG] refused: …`). Deletes and button acks are not posts and still work.
  `scripts/telegram-rooms-test.cjs` pins the policy and that no direct Telegram send exists
  outside the audited functions. History: CLKN welcomes leaked in (09-02), vault alerts (08-31), a
  replayed window of buy alerts (09-17, `docs/INCIDENT_2026-09-17_ROSE_BUYBOT_REPLAY.md`).

- **A Telegram post with an image gets 1024 characters, not 4096** — and our own code silently
  truncates at 1024 while returning success. Count the caption; put load-bearing lines (the X
  link, a CTA) where truncation can't eat them. Recover with `&replaceMsg=<oldId>`.

- ⚠️ **`tgSend` and `postToX` SWALLOW their own errors and return null / `{ok:false}` — they never
  throw.** So `await tgSend(...)` followed by a `kv.set` watermark is a silent-loss bug, not a
  send: an outage looks exactly like success. Three schedulers had it (fixed 2026-09-04) — the
  worst marked new graduates "seen" after a DM that never arrived, so no later tick resurfaced
  them and their airdrop prompt never registered. **Check the return value, and never advance
  durable state on a send that did not land.** `scripts/broadcast-integrity-test.cjs` guards it.

- ⛔ **Admin routes that ACT are POST-only, and armed vault calls must name `project=`** (audit
  2026-09-05, shipped in the code batch): `run=1` / `arm=1` / `disarm=1` / `set=` on any
  `/api/whirlpool/vault/*` route, `clear=1`/`run=1`/`probe=` on `/api/lock-celebration`, `run=1` on
  `/api/x-delete`, any field or flag on `/api/buybot`, `arm/disarm/setmin/test/announce/backfill`
  on `/api/rose-buybot`, `post=1` on the two Telegram test routes, and arming
  `/api/treasury-engine-window` all answer **405 on a GET** — the same request as a POST goes
  through, and a flag-less GET is still the dry run / read. A POST with `run=1` and no
  `project=` is refused with 400 rather than defaulting to `clkn`, and every vault response
  echoes `project` + `operator`. The hourly lock-celebration routine, the two skills and the
  runbooks were switched to POST in the same change; `scripts/mutating-get-guard-test.cjs` (CI)
  pins all of it. **Extended 2026-09-17 (platform deep dive P0-002 / P0-008 — the routes the first
  audit missed):** `/api/cuna-giveaway/admin` (every configuring, scanning, drawing, paying or
  reconciling flag — `&draw=1` and `&payout=1&run=1` sent real prize tokens on a GET), the Meteora
  levers (`remove-liquidity`, `add-liquidity`, `open-position`, `unwrap`, `rebalance-inplace`,
  `recenter`, and `config` writes), `/api/clkn-blitz`, the three `*-engine?on=1|off=1` arms,
  `/api/diploma-mint …&run=1` and `/api/school-airdrop` writes. Same rule: the flag-less GET is still
  the read or dry run. Buy Special's three data endpoints (`/api/buyspecial-crosscheck`,
  `-holdcheck`, `-trace`) check the tools pass server-side now — the page's gate was theatre before.
  **P1 batch (same day):** `/api/x-announce?post=1`, `/api/x-post-test?post=1` and
  `/api/classroom/graduates?action=` joined the list (dry runs and the list stay GETs). ⚠️ The hourly
  lock-celebration routine posts through `x-announce?post=1` — its prompt was switched to
  `curl -X POST` with this change; if you ever recreate that routine, keep it a POST. **`/api/tg-test`
  is POST-only too (owner, 2026-09-17: "convert tg-test too, routine first")** — every form of it
  sends, so the whole GET method answers 405 after the key's 404; the query send and the raw
  file-body upload share one dispatcher; a body under 100 bytes is refused rather than re-read as
  the text send (Codex on #333). The meme routine and the lock-celebration watcher were switched
  to `curl -X POST` BEFORE the server change, carried a transition GET fallback while the old build
  was live, and had it **removed on 2026-09-17 once #335 was verified on production** — both prompts
  now say "never fall back to a GET". **`/api/meme-queue` `&done=`/`&art=`/`&clear=1` are POST-only
  too (owner, 2026-09-17, same routine-first sequencing; live on production via #337 the same
  day)** — the meme routine POSTs its `done=` write, carried a transition GET fallback while the old
  build was live, and had it removed once #337 was verified; the list, `history=1` and `all=1`
  stay GETs. With this, **no admin route on the surface writes or sends on a GET** — the guard test
  is the inventory; add a new admin flag there before you add it to a route. ⚠️ **The IN-PROCESS
  caller that got missed (found 2026-09-22, the birthday special's board never appeared):
  `lib/cuna-giveaway.js` `postBoard()` — the 15-minute room leaderboard — sends itself through the
  public edge to `/api/tg-test` and was still a GET, so every drop since #335 answered 405 →
  `send_failed` on the 5-minute tick, silently. When a route goes POST-only, grep the LIB code for
  `fetch(` to it too, not only the routines and skills;** `scripts/cuna-board-post-test.cjs` (CI)
  stubs the route the way production behaves (405 to a GET) and pins the method. ⚠️ **The one that got
  through (incident, 2026-09-17 16:11 UTC): `/api/rose-buybot`'s FLAG-LESS GET ran a full poll
  "even while disarmed"** — the 09-05 audit read it as the harmless read. A status check on a bot
  disarmed for days walked its whole 100-signature window and posted every buy above the floor
  into the OnlyRose room, in a row. Fixed the same day: the plain GET is the status read, the poll
  is `POST ?run=1`, and BOTH buy bots step over anything older than `BUYBOT_REPLAY_MAX_AGE_S`
  (default 15 min) after any pause — a resume never narrates history. **A "read" that calls the
  poller is not a read; check what the flag-less path actually does before calling an admin
  route on production.** **The burn celebration also has a value floor now**: a verified burn Jupiter
  prices under `BURN_BROADCAST_MIN_USD` (default $10; unpriced = skipped) gets its receipt page
  but no auto-post — a stranger's one-unit mint could otherwise force a brand tweet.
