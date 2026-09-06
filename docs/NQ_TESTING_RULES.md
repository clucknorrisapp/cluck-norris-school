# Normie Quest — testing rules (owner, 2026-09-06)

> "Use multiple agents and split the levels up so they don't have to work so long, and only do full
> reviews of levels if something structurally changed to the levels, not like an icon change or
> background change." — this is that, written down and mechanised.

The rule in one line: **the diff decides, not the person.** Run
`node normie-quest/test/nq-verify.cjs <baseUrl>` and do what it says. `--dry` shows the plan without
running; `--against origin/develop` plans a whole branch. CI runs the same planner.

## What each kind of change gets

| change | what it can break | what runs |
|---|---|---|
| comments / whitespace in `game_logic.js` | nothing shipped | syntax + build |
| an icon, sprite, backdrop, sfx, music (`src/assets/`, `public/worlds|sfx|music|pwa/`) | how it LOOKS | build + one smoke level + **visual gate**; a boss plate also runs **boss-ground** |
| one level's data in `LEVELS` | that level | build + geometry + state test on **that level** |
| a between-level screen (LevelClear, WorldClear, VipPitch, Briefing, Win, Over, Controls, their helpers) | the beat flow | build + smoke level + **beat-vs-panel test** |
| a menu (Boot, Title, LevelSelect) | title/boot render | build + smoke level + visual gate |
| the DOM layer (wallet panel, settings, D-pad, joystick, gamepad, fullscreen, lab bench) | overlays + input | build + smoke level + beat test + visual gate |
| the lab hooks only | the tests themselves | build + smoke level |
| **ENGINE**: constants, SFX/music code, the Game scene and its helpers, the Phaser config | **any level** | build + geometry + **FULL state test, sharded** |
| other `normie-quest/` code (nq-sw.js …) | unknown | full state test (worst case, on purpose) |
| `normie-quest/*.js` server modules | backend | `node --check` + the two unit suites, no browser |
| the built shells `public/normie-quest-*.html` | derived output | ignored — classified through their sources |

"Structural" = the engine or a level's data. Nothing in the other rows can change whether level 40
loads or whether its boss can be stomped, so nothing there buys a 90-level run.

The planner finds the region by splitting `game_logic.js` at its top-level constructs (the scene
classes, the Phaser config, the lab hooks, the DOM blocks — `REGION_BOUNDS` in `nq-verify.cjs`) and
diffing each with comments stripped. If a new scene class is ever added, add its boundary there;
an unknown construct falls into the preceding region, which is only the safe direction when that
region is ENGINE.

## Splitting the full run — machines, not agents on one box

The full state test is the only slow check (90 levels, ~11–25 s each). The way to make it short is
**more machines**, each taking a slice:

- **CI does it automatically.** The `nq-state-plan` job runs the planner; when it says FULL, the
  `nq-state` job runs a **6-shard matrix** — six runners, ~15 levels each — instead of one box
  grinding through 90. One level's data → a single runner, that level only. Anything
  non-structural → the job does not run at all.
- **By hand across sessions/agents:** `NQ_SHARD=i/n node normie-quest/test/nq-state-test.cjs <url>`
  (or `nq-verify.cjs --shard i/n`). Shards are round-robin by position, so the wide VIP levels at
  the end of the list are spread, not dumped on the last shard. Give each remote session or cloud
  agent one shard; the union is the full suite.
- ⚠️ **N agents on ONE box are not a split.** They share the same four cores, starve each other's
  browsers, and the 25 s level-build timeout starts inventing `NO-LOAD`s on good levels (it
  happened on 2026-07-27 with three workers). One process with `NQ_WORKERS` (default = half the
  cores) already uses what the box has. Sharding buys time only when each shard has its own CPU.
- **Batch, then run once.** Make every change in the batch, run the planner once, and let the
  matrix carry it. The single biggest waste on record was start-a-run / think-of-another-change /
  kill / repeat: five starts, four kills, forty minutes for a thirteen-minute check.

The `nq-state` CI job is **advisory until 2026-09-13** (`continue-on-error`): the full run had never
executed in CI before, and a 2-vCPU runner has to prove it does not invent NO-LOADs before a red
shard is allowed to block a merge. Delete that line to promote it once a clean week is on record.

## The other gates (unchanged, and where they live)

- **Visual gate** — `node normie-quest/test/nq-visual.cjs <url>`: title, HUD, the three characters,
  the gravemite, pixel-diffed against committed baselines. A regression detector, not a judge of
  taste; re-approve intentional changes with `--update` and commit the PNGs. CI job `visual-regression`.
- **Beat-vs-panel** — `node normie-quest/test/nq-beat-panel-test.cjs` (boots its own server):
  the between-level beat holds while the wallet panel is open, Escape closes it, a tap continues,
  and with no panel it auto-advances. Reaches the beat through the lab hook `__NQ_BEAT()`, never
  by playing to it (see the trap below). CI job `smoke-test`.
- **Boss ground** — `node normie-quest/test/nq-boss-ground.cjs <url>`: the seven ground bosses
  measure feet exactly on GY. Runs when a boss plate changes (bosses scale by height).
- **Geometry** — `node normie-quest/test/nq-geometry-check.cjs`: pure data, no browser; every
  gap makeable, every drop survivable. CI job `node-check`.

## Traps this file exists to keep

- **Headless WebGL is 0.5 fps — use the canvas renderer for logic tests.** Headless Chromium has no
  GPU, so `Phaser.AUTO` picks WebGL on SwiftShader and the game renders at ~0.5 fps in a level
  (measured 2026-09-06: Phaser's own step costs 6 ms, but `requestAnimationFrame` fires once a
  second — the box is not slow, the software GL raster is). No Chromium flag changes it
  (`--disable-gpu`, `--use-angle=swiftshader`, `--disable-frame-rate-limit` all measured the same).
  The 2D **canvas** renderer runs the same game logic at a full 60 fps there. A test opts in with
  `page.addInitScript(() => { window.__NQ_RENDER = 'canvas'; })` before `goto` — the state test and
  the beat test do; the visual gate and boss-ground stay on WebGL because their baselines and
  measurements are WebGL output. Nothing shipped sets the global.
- **Phaser time on a slow frame loop.** Phaser 3.60 pins each frame's delta at the 60 fps target
  while frames overrun (`smoothDelta` copies the history entry back), so anything counted in
  DELTA — `delayedCall`, tweens — crawls whenever frames run slow. Anything read from `time.now`
  is wall-clock and fine. A test that waits for a `delayedCall` to fire will time out or flake on
  a slow loop; drive the target scene directly with a lab hook (`__NQ_BEAT`, `__NQ_SCENE_START`,
  `__NQ_STARTLEVEL`) instead. Cost: two runs on 2026-09-06, plus the beat test flaking red on a PR
  that never touched the game.
- **The built shells are derived.** `src/build.js` writes them from `game_logic.js` + assets. They
  are in git so a no-build boot serves the game, but a rebuilt shell in a commit is not a change of
  its own — the old planner counted it as "other normie-quest code" and pushed every rebuilt commit
  into a full run.
- **Don't run the state test by reflex, and read its own verdict.** `did NOT load` is a failure
  even when the table looks green (the pass criterion ignored it once). A bare `NO-LOAD` that
  survived the 90 s retry is probably real — confirm with `NQ_WORKERS=1`.
