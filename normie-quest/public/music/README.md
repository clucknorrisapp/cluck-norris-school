# Normie Quest — produced music (drop-in)

Drop **real, owned or licensed** audio tracks in this folder and the game streams them
automatically. If a track is missing, the game falls back to its built-in synth music — so
this folder can be empty and everything still works.

## Filename convention

Name each file after the world/track it should play (the game asks for these keys):

This table matches the LIVE world→key mapping in `normie-quest-platformer.html` (~line 1226).
Goal (owner, 2026-07-20): **10 fully custom tracks — one per world** (3 of 10 in as of today:
world1, exchange, boss).

| File            | Where it plays TODAY                     | status |
|-----------------|------------------------------------------|--------|
| `world1.mp3`    | World 1 + title screen (also the 9/10 fallback for now) | ✅ custom |
| `desert.m4a`    | World 2 — The Sand Lands (2-1, 2-3)      | generated loop (to be replaced) |
| `casino.m4a`    | 2-2 — Normie Casino                      | generated loop (to be replaced) |
| `skyline.m4a`   | World 3 — The Skyline                    | generated loop (to be replaced) |
| `exchange.mp3`  | World 4 — The Exchange (World 7 reuses it for now) | ✅ custom |
| `sacred.m4a`    | World 5 — The Bridge                     | generated loop (to be replaced) |
| `mines.m4a`     | World 6 — The Depeg                      | generated loop (to be replaced) |
| `boss.mp3`      | Boss fights (World 8 reuses it as level music for now) | ✅ custom |

**Waiting slots (no key mapped yet — worlds 7–10 currently reuse the tracks noted above).**
When a custom track lands for one of these, drop the file AND flip that world's entry in the
mapping line (one-line change; an unmapped key with no file would mean silence, so the flip
happens together with the file):

| Planned file  | World |
|---------------|-------|
| `farm.mp3`    | World 7 — The Yield Farm |
| `bear.mp3`    | World 8 — The Bear Market |
| `depths.mp3`  | World 9 — The Mines |
| `swan.mp3`    | World 10 — Euphoria / The Black Swan |

Formats accepted (checked in this order): **`.mp3`**, `.m4a`, `.ogg`, `.wav`. mp3 is preferred
(smallest). Tracks loop seamlessly and cross-fade between worlds, so export them as clean
loop-able tracks (~1–3 min is plenty).

## Copyright rule

Only drop tracks you **own or have a license for** — original compositions, tracks you
generated yourself on a paid AI-music plan (Suno/Udio/etc., where the output is yours), or
properly-licensed royalty-free music. **No ripped/derivative tracks** (e.g. Nintendo game
music), even AI-remixed — those are the underlying composition's copyright.
