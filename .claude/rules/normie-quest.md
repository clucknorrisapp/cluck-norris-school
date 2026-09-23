---
paths:
  - "normie-quest/**"
---

# Normie Quest traps

Moved verbatim from `AGENTS.md` (2026-09-23 split). Loads automatically for any session touching
`normie-quest/**`. Text below is unedited — see `AGENTS.md` for the sections that stayed there.

> 🎮 **Working on Normie Quest? Read `docs/NQ_TESTING_RULES.md` and `docs/HANDOFF_2026-07-27.md`
> first.** The testing rules (owner, 2026-09-06) are mechanised: `node normie-quest/test/nq-verify.cjs
> <baseUrl>` reads the diff, classifies it by REGION (an icon, a backdrop, a between-level card, a
> menu or a DOM control never buys a level run; only ENGINE code or a level's own data does) and
> picks the checks. A FULL run is **sharded across CI runners** (`nq-state` matrix, advisory until
> 2026-09-13) or across machines with `NQ_SHARD=i/n` — never N agents on one box, they starve
> each other. Don't run the full state test (every level — 90 today) by reflex — a day went to
> running it for icon swaps it could never have validated, and a 90-level run for a LevelClear card
> timed out under load on 2026-09-05. ⚠️ Headless Chromium renders the game's WebGL at ~0.5 fps
> (SwiftShader, no flag fixes it) and Phaser pins DELTA at the 60fps target while frames overrun,
> so a `delayedCall` crawls or never fires. Logic tests set `window.__NQ_RENDER='canvas'` in an
> init script (60 fps, same logic; the state and beat tests do) and drive the target scene with a
> lab hook (`__NQ_BEAT`, `__NQ_SCENE_START`, `__NQ_STARTLEVEL`); the visual gate stays on WebGL.

> 🩹 **Boss "sunk in the floor", character speed, or the 2×-resolution question? Read
> `docs/HANDOFF_2026-08-16.md` first.** The boss "waist-deep" look was an ART crop — the boss cutouts
> had no feet — NOT a position or resolution bug (that finding cost ~24h).
> **RESOLVED 2026-08-16:** the KOL and Custodian plates were replaced with full-body art, and the
> grounding-shadow mitigation was deleted. There WAS also a small real position bug underneath it:
> the boss body box ended at 96% of the texture while every plate is trimmed to 100% content, so
> every gravity boss sank by 4% of its display height. Body bottoms are now 1.00 and all six ground
> bosses measure feet exactly on `GY`. Regression guard: `node normie-quest/test/nq-boss-ground.cjs
> <baseUrl>`. The speed tuning landed 2026-08-16 (owner's numbers: base 192, boost 225 — see the
> retune commit); the moon world's two 280px showpiece gaps were trimmed to 240px to stay makeable.
> ⚠️ iOS audio has FOUR dead states, not two: 'suspended', WebKit's 'interrupted', 'closed' (memory
> pressure — terminal, needs a NEW context), and the ZOMBIE (state says 'running', currentTime
> frozen, zero output — the state field LIES; only the clock is honest). The rebuild machinery in
> game_logic.js handles all four; don't simplify it back to a state check. The pause card shows a
> live `audio:` line for field diagnosis on iPads.
> ⚠️ Bosses are scaled by HEIGHT, so **swapping in a plate with different bottom margin silently
> re-breaks this.** A floating boss must declare `bossBodyBot` on its level def (the GHOST GALLEON
> does); anything that stands on the ground leaves it at the 1.00 default.

- 🎮 **Phaser: `setScrollFactor(0)` does NOT take an object out of the camera transform.** It stops it
  scrolling; a zoomed camera still scales it about the viewport centre
  (`screen = half + zoom*(p - half)`, `half = cam.width/2`). So "place at (0,0), size it
  `cam.width × cam.height`" draws RES times too big and off-screen. That is what cropped every world
  backdrop to the middle `1/RES` (the "backgrounds are zoomed in" report — 1/4 of the plate at 2×, 1/9
  at 3×) and what slid the HUD off at 3×. Use `SCREEN_RECT(cam)` in `game_logic.js` for **any**
  screen-pinned object; never hardcode the anchor. Fixed 2026-08-16 — and note it survived a whole
  session of being argued away as "no regression found", so trust the screenshot over the reasoning:
  compare the level against `normie-quest/public/worlds/<plate>.webp`.
