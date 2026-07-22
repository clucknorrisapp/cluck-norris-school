# Normie Quest — Dev Notes

Side-scrolling Phaser 3.60 platformer for NORMIE/CLKN. Lives at **clucknorris.app/normie-quest-x7**.
This file is the single source of truth for how the game is built and the design decisions behind it,
so any fresh session (or a human/external auditor) can pick up cleanly.

## Source of truth & build pipeline
The game is authored as ONE readable source file and assembled into a self-contained HTML:

```
normie-quest/src/game_logic.js   ← THE source (~3.1k lines). Edit this, never the built HTML.
normie-quest/src/assets/*.b64    ← 58 cut-out sprite/audio assets (raw base64), inlined at build.
normie-quest/src/phaser.min.js   ← Phaser 3.60, inlined for the CSP-free standalone build.
normie-quest/src/build.js        ← assembler.  Run:  node normie-quest/src/build.js
```

`build.js` swaps `__MARKER__` tokens in `game_logic.js` for `data:` URIs from `assets/`, then writes:
- `normie-quest/public/normie-quest-platformer.html` — CDN Phaser, **the deployed game**
- `normie-quest/public/normie-quest-play.html` — inlined Phaser, standalone
- `.nq_test.html` (repo root) only with `node normie-quest/src/build.js --test` — instrumented
  build that exposes `window.__PG` for headless Playwright testing.

**Adding an asset:** drop the raw base64 in `src/assets/`, add its `__MARKER__ → file.b64` entry to
`FILE_MARKERS` in `build.js`, reference the marker in `game_logic.js`.

**Deploy:** Railway auto-deploys from `main`. Workflow: edit `src/game_logic.js` → `node
normie-quest/src/build.js` → commit the built `public/*.html` (+ the `src/` change) → merge to `main`.

## Level model (`LEVELS[]` in game_logic.js)
- 24 normal levels = **8 worlds × 3** (indices 0–23). Level def fields: `gaps, walls, plats, spikes,
  powerups:[[type,x,y]], coins, enemies:[[kind,x,y,range]], bonusblocks, caches, warps, key, door,
  boss, bossType, yields/pegs/planks (world mechanics), theme, width, time`.
- **Hidden bonus levels (idx 24+)** have `hidden:true` (excluded from world-count + level-select) and
  `bonus:true`. Their `door` RETURNS you to the surface (registry `nqRetLvl`/`nqRetX`).
- Reach a hidden room via a **speakeasy warp**: `warps:[[x, targetIdx, hint?]]`. `hint:1` = a glint
  flash draws the eye; omitted = fully secret. **You must DUCK/crouch on the warp to enter.**

## Key design decisions (chronological, current as of last session)
- **Freemium demo = Worlds 1 & 2.** Kept payout-free of *real* rewards. In-game economy (casino,
  slots, coins, jackpots) is fine here and is a deliberate TEASER — the owner likes the casino free.
- **"Payouts" means REAL rewards/giveaways** (a future premium feature), NOT in-game coins/slot wins.
- **Hidden rooms: exactly ONE per world, no two in the same world**, spread across paid Worlds 3–8.
  More worlds are coming; each new world gets at most one. Current entrances:
  - 3-1 → **Crypto Trenches** (idx 25, hidden WORLD + Troll boss) — secret
  - 4-2 → **Speakeasy Vault** (idx 24, jackpot slots) — hinted
  - 5-2 → **The Money Printer** (idx 26, coin flood) — secret
  - 6-2 → **The Diamond Vault** (idx 27, Diamond Hands + gems) — hinted
  - 7-2 → **The Airdrop Bunker** (idx 28, heart airdrops) — secret
  - 8-2 → **The Degen Den** (idx 29, multi-slot casino) — hinted
  - **Launch Pad** (idx 30) is BUILT but UNWIRED — parked for a future World 9 (one-line warp to add).
- **Worlds 5–8 extended** ~30% longer + more enemies/hazards; power-up count held ~4/level.
- **Bull Market** = green tint + mega-jump only. The green-candle "ride" and the bull HORNS were
  both removed (owner disliked them). Don't reintroduce.
- **Manual throw:** 10 Solana discs/level, thrown with F/X or the on-pad THROW button; HUD ammo
  counter (top-right); a SOLANA pickup refills to 10 (its auto-fire doesn't consume the counted ammo).
- **Mega Whale** (`megawhale` power-up): rare timed INVINCIBLE flying ride (~10s, 13s premium). Piggybacks
  `whaleUntil` to inherit all immunity/enemy-crush; flight + ride sprite keyed on `megaWhaleUntil`.
  One guarded whale per world W5–W8 (the X-2 levels), ringed by aerial danger. Currently a procedural
  blue-whale sprite (could be upgraded to generated art).
- **Premium** (`PREMIUM` flag / `?premium=1`): Whale Mode + Cold Wallet last longer; Mega Whale 13s.
- **Troll boss** (Crypto Trenches): **3 stomps** to kill. Teleport blink is NON-damaging + keeps ≥150px
  from the player; won't throw point-blank candles when you're about to stomp. (Fixed a "stomp = death" bug.)
- **Slot win popup** holds ~1s at full opacity, then floats up & fades (was fading instantly).
- **Pause:** ⏸ hotspot / P / Esc; 10s idle auto-pause.
- **Crouch/duck** shrinks the hitbox to slip under fireballs.
- **Normie blocks** (multi-hit `?` blocks) values show longer.

## Testing (headless)
Playwright + the pre-installed Chromium (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`).
Build with `--test`, load `.nq_test.html`, drive `window.__PG.scene`.
**Caveat:** headless `game.loop.delta ≈ 0`, so physics/tweens/timers are frozen — step manually with
`g.physics.world.step(dt)` / `g.update()` and reason about motion; you can't observe live animation.

## Open / parked threads
- **Real giveaway/rewards system** (premium) — not yet designed. Would tie into `/api/claim` +
  `lib/credentials.js` (verified transcripts already exist): track achievements → giveaway entries → draw.
- **Mega Whale art** — swap procedural sprite for a generated blue whale if desired.
- Optional: add a teaser hidden room to the free demo (Worlds 1–2) — allowed since hidden rooms only
  pay IN-GAME coins, not real rewards.

## Active dev branch
`claude/normie-quest-phase-0-lsa4dt` → merged to `main` (Railway auto-deploys `main`).
