# Incident 2026-09-17 — the ROSE buy bot replayed a window of old buys into the OnlyRose room

**Owner report (evening, 2026-09-17):** "when we were reworking the Cluck Norris buy bot in ROSE,
there ended up being a whole bunch of messages posted in ROSE, and there should have been none."

## What happened

- The ROSE buy bot had been **disarmed** (owner decision earlier the same day, and dormant before
  that), so its durable cursor `roseBuyLastSig` sat far behind the pool head.
- `GET /api/rose-buybot` with **no flags** did not report status — it **ran a full poll cycle**,
  by design ("manual; works even while disarmed"). The 2026-09-05 mutating-GET audit guarded the
  explicit flags (`arm/disarm/setmin/test/announce/backfill`) and treated the flag-less GET as the
  harmless read. It was not.
- At **16:11:23 UTC** a flag-less call ran the poll: the cursor was outside the 100-signature
  window (the bot's own gap marker recorded it: `lastGapAt` = 16:11:23, `gapCount` 2), every
  non-err signature in the window came back as "fresh", and **every buy above the $10 floor was
  posted to the OnlyRose room**, one after another, 450 ms apart, silently (no notification).
- Which client made the 16:11 call is not recoverable from this side (Railway logs were not
  pulled at the time). Both the terminal session that was reworking the bot and this cloud
  session had reason to check the bot's status; the cloud session's own recorded calls to the
  route were at ~17:0x and 20:11 UTC and both returned `scanned: 0, posted: 0` because the cursor
  had already advanced. Attribution does not change the fix.

## Why it was possible

1. A status-shaped admin GET performed the posting action.
2. Neither buy bot had any notion of "this transaction is old": after any pause (disarm, outage,
   redeploy with a lost cursor) the first poll narrated the whole window as if it just happened.

## Fix (same day)

- `/api/rose-buybot`: the flag-less GET is the read-only status probe (what `?status=1` returned);
  running a poll is `POST ?run=1`, refused on a GET with 405 like every other action flag.
- `lib/sig-cursor.js` `freshSince(sigs, lastSig, { maxAgeS })`: signatures older than the horizon
  come back as `stale`; both the ROSE bot and the generic per-project bot mark them seen, step the
  cursor over them, log the count, and post nothing. `BUYBOT_REPLAY_MAX_AGE_S` defaults to 900 s
  (15 min): longer than any poll interval or indexing lag, shorter than any pause. A signature with
  no `blockTime` is treated as fresh — losing a real buy is the worse failure.
- Tests: `scripts/sig-cursor-test.cjs` (+6 horizon cases), `scripts/mutating-get-guard-test.cjs`
  (flag-less GET is the status shape and never polls; `?run=1` 405 on GET; POST reaches the poll).
- CLAUDE.md: the incident and the rule — a "read" that calls the poller is not a read.

## Not changed

- The burn watcher keeps its hourly cap and supply-drop trigger; it was not involved.
- The room messages already posted were not deleted from here (deleting needs the message ids;
  `/api/tg-test?editText=` / `replaceMsg=` can remove them if the owner wants that done).

## Follow-up the same evening — the room is closed to the Cluck bot by policy, not by call sites

Owner: "make sure it is not posting anything in rose." Rather than patching the next leak at its
call site (the third such patch this month), `lib/telegram-rooms.js` now holds the rule and every
Telegram sender consults it: `tgApi()` (all of server.js's sends since the 09-17 consolidation),
the `/api/tg-test` query and raw-upload paths, the meme-art uploaders, and the two library
notifiers (`lib/whirlpool-vault.js`, `lib/swap-desk.js`). A send to the OnlyRose room is refused
and logged unless the caller passes the explicit allow, which only the ROSE bot's own path, an
operator's explicit `chat=`/`project=` on tg-test, and an owner-configured buy comp do. The bot's
scoped command menu in that room is deleted at boot so it no longer advertises replies that will
not come. `scripts/telegram-rooms-test.cjs` pins the policy and fails on any new direct send
outside the audited functions.
