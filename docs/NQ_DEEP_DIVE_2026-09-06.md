<!-- Synthesis of the 2026-09-06 multi-agent deep dive (18 finders, 201 findings, P0/P1 adversarially
verified; P2/P3 carry the finder's confidence). Read with docs/NQ_DEEP_DIVE_POSTMORTEM_2026-09-06.md —
the run took 18 hours for reasons that are now rules in CLAUDE.md. Findings cite develop as of 04:05 UTC;
the LevelClear freeze (PR #242) landed after the finders ran and is not in this list. -->

# Normie Quest — deep dive, final report
**2026-09-06T04:05Z · read-only pass · branch `develop`**

---

## 1 Bottom line

Two P0s: **the entire VIP wing (worlds 13–21, 27 levels, 9 bosses) has no in-game door** — the World-12 boss kill jumps straight to the Win screen, so a top-tier holder pays for content the build will not let them enter (`game_logic.js:5004-5010`); and the owner's "blurry when running" is now **root-caused, not guessed** — `cut_normie_run1` and `cut_normie_run2` are the *same pose* (meanAbsDiff 8.9/255 vs 80.9 for the moon pair), so the default character's run "cycle" is texture boil, compounded by a rotation+squash wobble that was carved out for skins and left on base Normie only. Behind those sit a leaderboard that discards every legitimate full clear as `suspect`, a game-over screen that silently parks and loses most scores, 36 levels scoring the World-1 tutorial theme because the music router reads `charAt(0)` of a two-digit world, and an origin-lockdown bypass that makes every `/api/nq/*` rate limit forgeable. The Lounge is not a small thing to polish — it ignores `theme.css` entirely, stacks two fighting palettes behind 13 `!important`s, knows 4 wallets where the shared registry knows 18, and promises a real-$NORMIE payout the terms do not permit. Nothing here is a money-path exploit; the damage is reachability, honesty, and first-session survival, and most of the top items are S-effort.

---

## 2 Fix now — P0/P1

| # | sev | area | what breaks | file:line | fix | eff |
|---|---|---|---|---|---|---|
| F1 | P0 | progression | Worlds 13–21 unreachable for every tier | `game_logic.js:5004-5010` | route dirtywhale kill through `nqWorldAllowed(LEVELS[nx])` → `bankCheckpoint()` + `advanceLevel()`; keep Win for tier-1 | S |
| F2 | P0 | rendering | run frames are duplicates → boil | `game_logic.js:6188` | hold `nrun1` unless `(!charPrefix && moonSuit)`; fix stale comment `:6185` | S |
| F3 | P1 | rendering | base-Normie-only wobble drifts NEAREST sampling | `game_logic.js:6228-6231` | `p.setRotation(0); p.setScale(bs);` unconditionally | S |
| F4 | P1 | leaderboard | a real 1‑1→12‑3 clear submits world=21 → `suspect`, filtered from every board **and prize draws** | `game_logic.js:6530`, `nq-leaderboard.js:469` | thread reached world through `winData()`; submit that | S |
| F5 | P1 | copy/truth | Win says "ALL 21 WORLDS CLEARED" to a 12-world finisher | `game_logic.js:6565-6568` | same `worldsCleared` field; keep `worldCount()` for Over's total | S |
| F6 | P1 | retention | game-over score parked in a variable, dies with the tab | `game_logic.js:8727` | Over/Win line "NAME YOURSELF TO SAVE THIS SCORE →" opening the panel when `parkedRun()` non-null | S |
| F7 | P1 | audio | 36 levels (all of worlds 9–21) play the World-1 theme; 8‑1/8‑2 play the boss track | `game_logic.js:2501` | parse the world number, not `charAt(0)`; map 9–21 deliberately | S |
| F8 | P1 | input | How‑To‑Play overlay never pauses the run | `game_logic.js:8535-8536` | mirror `openM/closeM`: `__NQ_KBGAME(false)` + `__NQ_PAUSE()`, resume on close | S |
| F9 | P1 | input | joystick reads touches on that open overlay as gameplay | `game_logic.js:8015-8032` | `if(!gameActive() \|\| nqModalUp()) return;` | S |
| F10 | P1 | fairness | sniper: no telegraph, stale cooldown, fires from 330px when ~240px is visible; #1 killer (650 deaths) | `game_logic.js:6358, 5387-5395` | ~280ms tint wind-up + engage range inside the frame; restore per-kind tint; shim `aimUntil` into resume rebase | S |
| F11 | P1 | fairness | ground-worm: 230ms rise then a 165° 7-stick fan; #2 killer (438) | `game_logic.js:5303, 5314-5323` | rise 400ms + 200ms hold before `fireMiniBurst`; spread → ~110° | S |
| F12 | P1 | security | `trust proxy:true` + host-derived exemption lets any direct caller skip the CF lockdown for `/normie-quest*`, incl. the PII console | `server.js:3512, 3379/3384/3427` | match `req.headers.host` not `req.hostname`; make `NQ_GAME_PATH` exhaustive; gate `cf-connecting-ip` on the verified edge header | M |
| F13 | P1 | security | `/api/nq/lounge` + `/api/nq/wheel/status` have no throttle, ~7 sync file reads each | `routes.js:383-390, 460-479` | `throttled(req,'lounge',60)` / `'wheelstatus',30`; memoize the rewards store | S |
| F14 | P1 | prizes | anyone can clobber the winner's pending claim → permanent `bad_signature` | `nq-claims.js:114,150`; `routes.js:568-574` | keep a bounded list per pubkey (or key by nonce); accept the signature that verifies | S |
| F15 | P1 | lounge | wheel dead-ends at 20 pending: spin not consumed, wrong message, free players locked out forever | `nq-rewards.js:134,232-237`; `lounge.html:634` | branch on `queue_full` client-side; close the VIP re-roll loophole server-side | S |
| F16 | P1 | lounge | wallet detector knows 4 wallets; `cluck-wallet.js` knows 18 | `lounge.html:347-357,364` | load the shared modules, drive buttons off `CluckWallet.available()` | M |
| F17 | P1 | copy/terms | "MEGA JACKPOT — real $NORMIE … pays out real tokens" | `lounge.html:568-571` | replace with THE VAULT / SEALED; no token name, no mechanism | S |
| F18 | P1 | lounge gate | `isVip(pk,null)` disables both balance paths on all three lounge routes | `routes.js:387,434,464` | `isVipAsync` reading the cached balances | M |
| F19 | P1 | mobile | Lounge shows a dead-end "no wallet" paragraph; mobile browsers can't inject | `lounge.html:364` | port the game's deep-link branch (`game_logic.js:9619-9637`) | S |
| F20 | P1 | perf | Boot decodes ~92 textures (18.9 MB VRAM) before Title, regardless of tier | `game_logic.js:1839,1854` | gate by reachability; reuse the `nqLoadSkin` pattern | M |
| F21 | P1 | perf | backdrops are never released — up to ~237 MB VRAM in a long session | `game_logic.js:2543-2564` (zero `textures.remove`) | evict the departed world's plate once arrival completes; respect `__NQ_ARTPENDING` | M |
| F22 | P1 | test debt | `nq-boss-ground.cjs` never runs in CI; its trigger regex misses 5 of 13 bosses | `.github/workflows/syntax-check.yml` (no match); `nq-verify.cjs:232` | surface `plan.bossGround`; derive the regex from the harness's own BOSSES list | S |

**F1** — `12-3` is the only level with `final:true` and it is checked *before* the normal routing, so `bossDefeat` never calls `bankCheckpoint()` or `advanceLevel()`; no checkpoint at idx 43 is ever banked, so resume can't reach the wing either. Use the predicate `advanceLevel` already uses (`nqWorldAllowed`, `:2062`) — *not* `nqIsVipOrAll()`, which ignores the launch cap — so a tier-1 player keeps today's finale and Win submit. `BRIEFINGS[43]` already exists; `WORLD_CLEARS[43]` does not (see F-flow-2 in §5).

**F2/F3** — see §3.

**F4/F5** — `worldCount()` returns 21 for every non-private win. A replayed 36-level run submitting world=12 ranks #1 with `suspect:false`; the same run submitting 21 is silently filtered from every board. Do **not** "fix" this by relaxing `nq-leaderboard.js:469` — that clause is the anti-forgery bound.

**F6** — `handle` is empty for a first-timer, so `submitRun` parks the body; the only surface that ever reveals a parked run is inside the 🎮 panel's Leaderboard tab, which nothing points at. 4 board rows against 62 runs is consistent with this being the whole story. Do not auto-assign a default handle without owner sign-off — that writes a synthetic identity to a public board.

**F7** — `w0==='1'` swallows 10‑x…19‑x; 20/21 fall to the default; world 9 (the Mines) never matches its own track. Parse `parseInt(name,10)`; keep the `2-1`/`2-2` name cases. A node script iterating LEVELS and printing computed `mt` is a sufficient regression check — no browser.

**F8/F9** — same root cause. The `?` button is live during gameplay; the card is `z-index:100002` over a running scene, and `#nqhow-wrap` is not a `[data-nq-ui]` target, so left-half touches spring the joystick behind the card. Fix the pause primarily and add the `nqModalUp()` bail-out as the belt.

**F10** — the only ranged threat with no wind-up, and `nextFire` stays in the past while the player is out of range, so the first bolt lands on the frame they cross the line, aimed. Note the sniper's base tint is `0xff6b6b` (`:6268`) — `clearTint()` leaves it white. Narrowing 330→~230 changes difficulty across 163 placements; if the owner won't take that, gate `sniperFire` on the shooter being inside `camera.worldView` instead.

**F11** — every other threat telegraphs 360–780ms. A near-hemispherical fan means "dodge" is "already be elsewhere". Guard the delayed call against a worm killed mid-hold.

**F12** — Express with `trust proxy:true` always honours `X-Forwarded-Host`; `trust proxy:1` does **not** fix it (verified in-harness). The `^\/normie-quest` prefix also exempts `/normie-quest-x7/{prizes,vip,reward,lounge-admin,dashboard}` — the PII console — from the WAF, and the same spoof defeats every per-IP throttle in `routes.js:771-773`.

**F13** — every sibling route carries `throttled(...)`; these two don't, and each does 5–7 `readFileSync` + `JSON.parse` of the whole rewards store on the single event loop. Measured: at 28.8k wallets one status call blocks 124.6 ms.

**F14** — `pending` is keyed by pubkey, last write wins, and winner wallets are public in full on the leaderboard. Reproduced locally: attacker prepare → winner's own signature returns `bad_signature`, permanently, inside the 14-day window. Do not make the wallet session token a hard requirement on `prepare` — a winner on a cleared browser has none.

**F15** — the free table is 100% queue items, so a free wallet at 20 pending is told only "Spin failed — try again", forever. The VIP path re-rolls without consuming the spin, which distorts the odds on the one surface whose stated virtue is that slice size = real odds.

**F16–F19** — the Lounge is the flagship perk and its front door is the weakest code on the page: a private 4-wallet detector (this file already shipped a Wallet-Standard bug the game's copy didn't have), no mobile deep-link, `isVip(pk,null)` that silently disables the holder path the moment the owner turns it on, and a hero card promising unagreed token payouts.

**F20/F21** — measured by decoding every asset: 92 images = 7.54 MB decoded / 9.92 MB base64 / 18.89 MB at W×H×4, all loaded before Title; 59 backdrops = 237 MB if all resident, and `textures.remove` appears zero times in 9,817 lines. The second one hits your *best* players on the memory-constrained devices this repo already has eviction history with.

**F22** — `grep boss` on the workflow returns nothing; `plan.bossGround` is computed and discarded. And `isBossPlate` (`nq-verify.cjs:232`) misses golem, reaper, greatbear, saylor, troll — so even a local run gives the all-clear on 5 of 13.

---

## 3 P0-B "blurry run" — root cause and port plan

**Cause 1 (the owner's literal words).** `game_logic.js:6188` alternates `nrun1`/`nrun2` every 200 ms. Both PNGs are 144×216; over the union opaque region their meanAbsDiff is **8.9/255**, p50 = 4, only 1.1% of pixels differ by >64, opaque area identical to the pixel, alpha centroid 0.10 px apart. Reference values on the same metric: idle↔run1 52.9, **moon run1↔run2 80.9**, princess 63.7, lil-normie 40.2. The diff map is a pure edge-outline glow tracing every contour — two generative renders of *one* pose. So the run "animation" is sub-pixel outline jitter at 5 Hz.

**Cause 2.** `6228-6231`: skins got `setRotation(0); setScale(bs)` in the 2026‑08‑15 "steady run" fix, gated on `this.charPrefix` — falsy for base Normie. He alone still runs at ±0.05 rad (≈515 ms period) plus non-uniform scale X 0.98–1.00 / Y 1.00–1.035 (≈257 ms), on top of the 200 ms frame swap. Three incommensurate periods. Under `pixelArt:true` (`:7552`, NEAREST, no mipmaps) his 144×216 art at `heroPx 36` is an **exact 2:1** minification at RES=3 — that exactness is why he's crisp standing still, and `scaleY*1.035` turns it into 2.070:1, drifting which texels are dropped every frame; rotation additionally defeats `roundPixels` (Phaser rounds translation only).

**Cause 3 (the same boil, secondary surface).** LevelClear `:7411-7412` and WorldClear `:6829` cycle the same duplicate pair at 110 ms — the literal "between two run pictures" screen.

**Cause 4 (whole-screen, separate change).** `image-rendering:pixelated` on a fixed 1440×810 buffer upscaled to an arbitrary viewport gives a fixed irregular duplicated-pixel grid that sprite content slides across as the camera scrolls (`normie-quest-platformer.html:37`). Do not fold this into the P0-B fix.

**Port plan — the unmerged branch `claude/normie-2-hidden-level-odzbkv` contributes ONE SENTENCE, no code.**
- `7804af6` (skins steady run) — **already in develop verbatim** at `:6188` and `:6229-6231`. It is the change that is backwards for base Normie.
- `c90e62c` LINEAR filter for characters — **obsolete**, deliberately reverted by `8dcabf6` after an owner side-by-side. Do not re-port to the player. The same technique *is* right for the painted backdrops and the torch gradient (§4).
- `c90e62c` lazy skin loading / `__NQ_LOADSKIN` / Boot `_bootPfx` / height-locked skins — **already merged**.
- `500b6c0` (3× everywhere + `?res=` override) — **must not be ported**; develop deliberately has no `?res=` (`:16-18`) and the touch=2× split exists because of a real iPad eviction.
- `bcacf34` (revert to RES=2) — code obsolete, **diagnosis live and unfixed**: "skins stored at 72×108 … at 3× they upscale and shimmer … needs skins re-stored at ~144px". RES went back to 3 on 2026‑08‑16 and the skins were never re-cut. That is the port.

**What today's code needs.** (1) `:6188` → `((!this.charPrefix && this.moonSuit) ? cycle : 'nrun1')` — behaviour-preserving for skins and for the real moon cycle. (2) fix the now-false comment at `:6185`. (3) `:6228-6231` → `p.setRotation(0); p.setScale(bs);` (keeps `bs`'s powerup grow; leaves crouch/air/idle alone). (4) `:6829` and `:7412` → delete the swap lines; both runners are already created as `nrun1` at the right scale. (5) proper fix, separately: re-cut `cut_normie_run2.b64` as a genuine opposite-leg pose — frames are already vertically registered (run1/run2 top=11 bottom=213), moon pair is the reference — then revert (1).

**Baseline re-approval.** *None needed* for any of (1)–(5): the three committed character baselines capture the player **mid-air** (the `!onGround` branch, untouched), and hud/title are text surfaces. Re-approval *is* required for the skin re-cut to 96×144 (`char-princess.png`, `char-lilnormie.png` — both advisory, so CI will not catch a bad re-baseline; eyeball them). Never edit the shells; rebuild via `src/build.js`. Ship on `develop`.

---

## 4 Perfect — polish, ranked

| # | sev | item | file:line | fix |
|---|---|---|---|---|
| P1 | P1 | No camera look-ahead: ~1.0–1.25 s of visible level at speed 192 | `game_logic.js:3222` | lerp `followOffset.x` toward `-sign(vx)*70` while `\|vx\|>40`; lerp back, don't snap; check level edges vs `setBounds` |
| P2 | P1 | Three text screens + four taps before the first frame | `:8565`, `:1923-2029`, `:6993-7079` | stop auto-opening How-To-Play over Title (keep the `?`); don't restate controls on Controls page 0 when it was just dismissed |
| P3 | P1 | No mid-level checkpoint: 3 deaths on a 5,200 px level → x=60, score 0 | `:5878-5880`, `:6497-6500` | bank `nqMidCp` at key pickup (registry, cleared on fresh run); use only when `cont===0` |
| P4 | P2 | 1‑1's key sits 3,500 px before the door, elevated, no cue | `:753-754` | move key to the critical path, or a HUD arrow while `!hasKey`; pull real quit x-positions first |
| P5 | P2 | Skins still 72×108 while RES=3 → 1.333× NEAREST magnification crawl | `:2944`; `char_pr_*`, `char_kd_*` | re-cut all five frames per skin at 96×144 (1:1 at RES 3); **kd_duck must be re-rendered from the 2026‑08‑16 crouch, not pulled from `234d610`**; all-five-or-none |
| P6 | P2 | Painted 1376×768 mattes NEAREST-sampled (1.047× up at RES3, 0.698× down at RES2) on 42 levels | `:2552-2553` | one line in `_renderArt`: `textures.get(_key).setFilter(LINEAR)` after the exists-guard. Do **not** touch global `pixelArt` |
| P7 | P2 | Torch gradient magnified RES× with NEAREST → banding on every dark level | `:3412-3423` | LINEAR on `nqdark`, or build at `DW*RES` and `setScale(1/RES)` |
| P8 | P2 | 96 Phaser Texts name Press Start 2P with no fallback, Google-only, no local copy | `normie-quest-platformer.html:19-20` | self-host under `/vendor/fonts` (explicit mount, CSP already allows `'self'`), **gate the Phaser boot on `document.fonts.load` with a timeout** (a fallback alone can't fix the rasterise-once latch), add `, monospace` to all 96 |
| P9 | P2 | 10 s idle auto-pause fires while a new player reads the screen; shows a dev `audio:` line | `:6033`, `:5905-5912` | ~30 s, or skip on level 0 until first input; hide `audio:` outside TEST_MODE |
| P10 | P2 | A "GRAB $NORMIE" button on every clear card, now held 6–8 s | `:7373-7380`, `:7305` | suppress on the first three clears and on `fact`/`board`; swap for a board CTA there |
| P11 | P2 | Pause/resume rebases scene fields only — every per-enemy deadline fires at once on resume | `:5915-5933` vs `:6279,3270,6299,5425,5441,5282` | named allowlist per group (incl. `waterMonsters`, `rugPlats`, `_rkNext`, `_dnNext`); the regex needs a capital N so it matches almost none of these |
| P12 | P2 | Stomp during damage i-frames cuts 1800 ms → 140 ms while the sprite still flashes | `:3577-3580, 3584, 3589` | make invuln a deadline (`invulnUntil = max(...)`), not a boolean owned by the last timer |
| P13 | P2 | Enemies on floating platforms walk off (ledge probe only knows ground-row gaps) — ~53 placements | `:6350-6353`, `:5537` | when `\|body.bottom-GY\|>8`, probe `footingUnder(ahead, bottom)` |
| P14 | P2 | Yield lift's "one-time" HARVEST re-arms every de-compound step → ~+12 score/s farm | `:5484, 5491` | drop the re-arm; latch `harvested` for the level |
| P15 | P2 | Enemy shots pass through walls and floors | `:2785, 3080-3090` | collider vs `platforms`, excluding the dump candle (`_dump`) |
| P16 | P2 | Discs pass through all 15 bosses with no feedback | `:3086-3090, 3678+` | clang-and-destroy overlap in `penBoss` (damage is an owner call) |
| P17 | P2 | Run wobble oscillates the **physics body** ±1.13 px at 3.9 Hz — free character only | `:6231` (Phaser `updateBounds`) | fixed free by F3; also note the air stretch (±5.5 px) and idle breathe do the same to every character — document in DEV_NOTES |
| P18 | P2 | Storm Herald (20‑2) banner says "NEXT WORLD" — it's mid-world | `:5000` | special-case to "THE SUMMIT AWAITS" |
| P19 | P2 | Two snipers 50 px apart, appended out of x-order, in both 6‑2 and 7‑2 | `:992, 1042` | confirm intent; space or comment |
| P20 | P3 | COLD WALLET freeze + torch widen leak into the next level | `:5522, 5996, 2919-2922` | add `frozenUntil/candleUntil/prevUse` to the reset block; better, one `_resetTimers()` |
| P21 | P3 | Discs kill burrowed/phasing enemies; `coinHitEnemy` lacks `touchEnemy`'s guards | `:3542-3546` | mirror the `phasing`/`drillImmune` guard |
| P22 | P3 | Wall-hit disc hovers, still lethal, up to 1.1 s | `:3087, 3441-3447` | destroy with a puff in the collider callback |
| P23 | P3 | Vertical movers don't carry the rider (`prevY` tracked, never used) | `:6252-6260` | `if(onIt && axis==='y' && dy>0) p.y+=dy` |
| P24 | P3 | Three smoothing constants are per-frame → ~2× faster at 120 Hz (one carries the player) | `:6202, 5998, 5496` | delta-aware lerp, identical at 60 fps |
| P25 | P3 | Mobile: no `safe-area-inset` despite `viewport-fit=cover` + landscape; 34 px chrome buttons; joystick buttons `aria-hidden` | `platformer.html:5`; `:7714,7731,9191,7883,7848` | `max(Npx, env(...))` with a plain-px fallback; 40–44 px targets; real `aria-label`s |

---

## 5 Bigger — content, ranked

1. **Open the VIP wing (F1)** — 27 built levels, 9 template bosses + a bespoke Saylor, 9 hidden rooms, all dark today.
2. **Worlds 16–21 have no Briefing and no WorldClear** (`:6848-6990`, `:6598-6660`; keys stop at 49). Six of the top tier's nine worlds cut straight from a generic clear card into the next level. **`WORLD_CLEARS[43]` is also missing** and key 46 holds dirtywhale art under "THE WHALE POD, CONQUERED!" — relocate it to 43 and give 46 a leviathan identity, or F1 lands with the wrong art on the campaign's biggest beat (`:6649-6654`). Data only.
3. **Un-hide the boss-preview beat** — `nqPreviewPick` returns null unless `__NQ_SETUP` (`:7253`), justified by a stale comment; `__NQ_ACCESS` has been published on every build since launch (`:8592-8599`). The card already carries a safe, amount-free hedge.
4. **Free-tier secrets** — the only warp in worlds 1–8 is unmarked, needs an undocumented duck-to-enter, and opens into a dark 1.5× troll boss (`:837`, `:2736-2748`, `:3290`); all six *hinted* doors are behind the paywall. Add two hinted warps to enemy-free rooms in worlds 1–2 and hint 3‑1. Wire LAUNCHPAD's second entrance (it already warps from 12‑2 — the backlog line calling it unwired is stale).
5. **Time Attack** — every clear already reports its duration (`:5827`); nothing reads it back. Per-level bests turn 90 built levels into repeatable content at near-zero content cost.
6. **Enemy composition in worlds 9–21 is formulaic** — ghost:9 / drillbit:5 repeats across four consecutive worlds where worlds 1–8 swing 43→70 spawns and 4→8 types. Lean on laserbot/mevdrone/flashbot to differentiate the back half.
7. **Boss-arena run-ups** — five VIP boss levels run the full 8400 px world max vs ≤6700 for every base-game boss level. Confirm that's pacing, not a copied `-2` template.

---

## 6 Better — retention / social / rewards without promises

1. **Live leaderboard on the death screen** (`:6463-6505`). `nqLbTease()` already fetches the weekly top three and LevelClear already renders it. Three medal lines + "you'd be #4 this week" + the F6 handle CTA. ~30 lines, no new endpoints, aimed straight at 0 returning players.
2. **Public world map / level select** (`nqHasPicker`, `:2061` — TEST_MODE only; the VipPitch code itself calls this out at `:7539-7541`). A tier-1 holder cannot revisit what they bought. Reuse LevelSelect filtered by `nqWorldAllowed`, render locked worlds as upsell cards, reskin the "TEST BUILD" copy, start a fresh run token on replay.
3. **Shareable run card** on Over/Win — plain text + link, states a score, promises nothing. No share affordance exists anywhere today.
4. **Normie Cash is fully built server-side with zero client** — store, caps, idempotency, history, `pointsEarned`/`pointsBalance` returned by every spin and thrown away (`routes.js:440-446, 451-458`). A visible balance and a members' statement is *state*, not a prize. Keep dark until `NQ_WHEEL_POINTS>0`.
5. **Journey-verified difficulty** — split `clears`/`secs` into verified/unverified in `nq-journey.js:117` rather than rejecting unproven clears, so the funnel stays symmetric and the dashboard can say "unproven" instead of quietly averaging forgeries.
6. **11‑3 / 12‑3 wall** (119:1, 59:1). Both bosses are already at the owner's 5-heart cap and the short-window timing bug was fixed *before* the only recorded telemetry — so don't re-cut HP. Pull per-death x-positions and bucket before/after the boss door; 11‑3's own top killer is GROUND-WORM SPIT, a pre-boss hazard.

---

## 7 The Lounge — luxury spec, builder-ready

**Diagnosis.** No `theme.css` link (every other tool page has one); a page-local `:root`; two stacked palettes (warm speakeasy → "cool high-tech" v2) fighting through 13 `!important`s, with ~60 dead lines including the palette the file's own header still describes; seven functional accent hues; the OS UI font throughout at 11–15 px; headings rendered as gradient-clipped text over their own 22 px gold blur (`:83` vs `:190-192` — `text-shadow` never cancelled under `-webkit-text-fill-color:transparent`); a lock scrim defeated by the artwork's own `z-index` (`:94-96`); a 540 px JPEG wordmark blown to 420 CSS px and `mix-blend-mode:screen`d (~100 KB of the page's 142 KB is inline base64); eight unsynchronised idle animations plus a 190%-viewport blurred rotating layer; no `h1`, no live region on the wheel result, no route back to the game; timestamps that format correctly one time in sixty (`:489`).

**Materials.** Obsidian and brass, not glass. Flat `var(--bg)`; one static warm elliptical glow behind the wheel only. Panels `var(--card)` + `var(--border)`, 18 px radius, one inset hairline, soft large shadow. `backdrop-filter` on exactly two elements: the wheel plinth and the status bar. Delete the aurora, grid, starfield and all `!important`.

**Palette.** Brass `var(--gold)` as the *only* accent; bone `var(--text)` / `var(--body-text)` / `var(--sub)` / `var(--muted)`; `var(--green)` for "held/active", `var(--red)` for errors. Delete cyan, violet, mint, pink, salmon, slate-lilac. Wheel wedges are the one exception (below). Note: linking `theme.css` pulls Google Fonts via `@import` — that trades the page's current offline-first stance for the shared brand system; tokens fall back to `system-ui`, and other tool pages already do it. Call it out rather than dropping it silently.

**Typography.** `var(--disp)` (Anton) for exactly three things — the wordmark fallback, section eyebrows, and the prize name on a win — uppercase, 2.5–3 px tracking, never below 13 px. `var(--body)` 15px/1.6 prose, 12.5 px floor. `var(--mono)` for every number: wallet, countdown, odds, balance. Fix the five sub-floor prose surfaces (`:45,101,136,145,476`). Swap the remaining literal `ui-monospace` declarations (`:75,121`) too.

**The wheel is the centrepiece.** `min(340px,78vw)` on its own plinth containing *nothing but* pointer, rim, hub and button — today nine elements share that card. Two lacquer wedge tones (`#171310`/`#221a12`) with prize colour in the emoji and a 2 px inner arc, brass rim + studs (keep the stroke consistent with the new rim, not the old bright gold at `:526`), machined hub. Wedge span still equals real odds — and send raw `weight` alongside `pct` so that stays true by construction, not by both tables happening to sum to 100 (`nq-rewards.js:246-250`). Three explicit button states: READY (one 6 s specular sweep), SPINNING, SPENT (bordered ghost, live `var(--mono)` countdown — the state most members see most of the time, and today a grey disabled block). Motion: keep the 4.2 s curve, add a 120 ms wind-back and a settle wobble; under `prefers-reduced-motion` cross-fade the pointer in 400 ms **and shorten the 4300 ms result timer** (`:645`) or the prize message lags a snap pointer.

**The Vault** (replaces the jackpot strip): a full fixture, brass-edged, CSS vault door, `SEALED` etched across it, one line — "Members will be the first to know what's inside." No token name, no payout, no mechanism. Same VIP-only gating as today (`jackpotSoon`), client copy only. Flag to whoever ships it that removing "MEGA JACKPOT — real $NORMIE" is a **compliance fix riding on a redesign**, not cosmetics.

**The Rooms** (replaces the rail): 2-up grid (1-up <480 px), 16:10 art, locked = `grayscale(.8) brightness(.55)` + brass hairline + a `var(--mono)` LOCKED label — not a padlock emoji over sharp art. Room ids come from the authenticated status response. Replace the other ~20 functional emoji with 16 px inline SVG in `currentColor`; that single substitution changes the register more than any colour choice.

**Layout.** Wordmark (SVG, from `/nq-assets/`, real dimensions, no `mix-blend-mode`) → sticky status bar (crown, wallet in mono, wallet **provider name**, one brass MEMBER/GUEST pill, three always-present counters ITEMS / ENTRIES / CASH, ghost Disconnect ≥44 px) → wheel → active-perk strip → Vault → Rooms → feed → footer with a **persistent** `▶ Play Normie Quest` (same tab — the game opened this one with `_blank`). Max width 640 px, 28 px panel padding, 32 px between fixtures.

**Three states, designed.** *Already spun*: wheel at rest, countdown as content. *Empty feed*: a brass rule, `THE FLOOR IS QUIET`, "Nothing posted this week." *Guest*: one card, not three paragraphs — heading, three verifiable lines (better odds, extra spins, members' feed, members' rooms), no amounts. **Pre-connect**: render the wheel statically from a wallet-less `?public=1` odds read plus the featured room teaser, so the signature request follows a reason instead of preceding one. Keep that endpoint strictly read-only with no per-user fields.

**Copy.** Declarative, no exclamation marks. Never a token amount, a payout, "prizes", or "winners will be drawn" — perks are *access and state*. If a holding sentence is wanted, render it from `/api/nq/wallet/config` (`usdPriced` decides which form) and omit it entirely on fetch failure. Seat qualification stays terms-neutral.

**Mobile-first** (this page is opened from a phone game): `min-height:100dvh`, safe-area bottom padding, `theme-color`, touch icons, no horizontal scroller, SPIN thumb-reachable, everything ≥44 px, verified at 320 px.

**Sound**, optional and last: reuse `window.__NQ_SFX` (`game_logic.js:434`, four iOS dead-states already handled) — do not hand-roll a second stack. Four cues, all behind the SPIN gesture, off by default with a persistent mute, silent under reduced-motion: per-wedge detent tick (the one that makes a wheel feel physical), settle thunk, win chime, connect latch. No background music.

**Also in the Lounge batch:** F13/F15/F16/F17/F18/F19 above, plus — disconnect never calls `provider.disconnect()` on the remembered path (`:372,399,690-698`); `nqHeartBuffUntil` survives disconnect so the next wallet on the device inherits a 24 h perk (`:401-403,665`); a spin against an expired session says "try again" forever (`:630-636`); the private `esc()` doesn't escape quotes and is used in an attribute (`:319,487`); the preview rail renders twice on load; the countdown interval leaks past disconnect.

---

## 8 Performance plan

| Change | Expected win | Where |
|---|---|---|
| Lazy sprite decode by reachability (F20) | ~18.9 MB VRAM at boot → world-1 subset; shorter time-to-Title on phones | `:1839,1854` |
| Backdrop eviction (F21) | caps a long session near ~2–3 plates instead of up to 237 MB | `:2543-2564` + prefetch at `:6706-6716` |
| Lossless WebP re-encode of the 92 inlined PNGs | **−34.1% decoded bytes (7.54→4.97 MB)**, ~2.5 MB off the shell, byte-identical pixels; PNG re-optimise alone is only −8.8% | `src/build.js:26-31` |
| Move sprites to real files like WORLD_ART already does | removes ~2.4 MB of pure base64 overhead and makes sprites separately cacheable by the SW | `build.js` + `this.load.image` |
| Re-encode `world1.mp3` (5.59 MB, 192 kbps), `boss.mp3` (3.73 MB) — and check `exchange.mp3` (6.38 MB) — to AAC | ~1.5 MB each, matching the five existing m4a tracks; world1 and boss are on every session | `public/music/` |
| Rewards store: TTL sweep + single memoised load; LRU for `balCache` | measured 124.6 ms of sync block per status call at 28.8k wallets → sub-ms | `nq-rewards.js:120-124,237`; `nq-wallet.js:259` |
| Terser pass on the emitted script | ~876 KB unminified logic; low tens of ms of parse | `build.js:43` |
| Drop the 190%-viewport blurred rotating layer + 4 backdrop-filters (Lounge) | the wheel's 4.2 s spin stops stuttering on mid-range Android | `lounge.html:226-231,249-252` |

Shell today: 11.4 MB raw / **8.21 MB gzip** (reproduced; matches the tracked 8.15 MB). Also: `normie-quest-play.html` (12.5 MB, inlines Phaser) has no route but is raw-reachable via the `dist/` fallback — delete from the shipped build.

---

## 9 Tests / CI guards to add

1. **Wire `nq-boss-ground.cjs` into CI** — surface `plan.bossGround` from `/tmp/nq-plan.json` as a job output and gate a step in the existing `visual-regression` job (it already has a server + chromium). Real gate, not advisory. (F22)
2. **Derive `isBossPlate` from the harness's BOSSES list**, and *add the 10 missing bosses* to that list: the 8 untested VIP template plates (14‑3…21‑3), Dirty Whale (idx 42 — and it deviates from the 1.00 body-bottom standard at `0.14+0.78=0.92`, asserted in prose only), and 9‑3's second golem. Look each `idx` up programmatically.
3. **`nq-verify` self-test** — assert every `REGION_BOUNDS` regex matches `game_logic.js` at least once **and in order**. A reworded banner comment silently merges the following region into the previous one; the region that would be swallowed contains `nqWorldAllowed` and the gate helpers, i.e. it would downgrade tier-gate code from full-state to menu with no signal.
4. **Run `nq-pause-touch.cjs`** — fully written, real exit code, never invoked. Its two deterministic assertions (joystick guard band; resume doesn't spend a disc) both guard bugs that already shipped once. Add `plan.touchPause` and a CI step.
5. **WORLD_ART integrity** (pure node): every LEVELS `bgArt` resolves to a key, every key resolves to a file in `public/worlds/`. A typo outside world 1 ships green today.
6. **Music routing** (pure node): iterate LEVELS, print computed track, assert no world >8 falls back to `world1`.
7. **Pause-rebase regression** in `nq-pause-touch.cjs`: synthetic pause + forced clock delta + resume → assert no enemy/hazard changes state on frame 1.
8. **`nq-rewards-test.cjs`** (pure node, temp `DATA_DIR`) — odds sum, weight↔span, one spin per UTC day, bonus refused to non-VIP, `queue_full` does not consume the spin, pass TTL, `claimOne` drains retired ids. The module has *no* test today.
9. **`nq-claims-test.cjs`**: add the F14 repro — winner prepare → attacker prepare → winner's original signature must return `ok:true`.
10. **`nq-leaderboard-test.cjs`**: pin "a 12-world clear is not suspect" *and* "world=21 on a 12-world token is suspect"; plus a source guard that Win's `submitRun` doesn't pass `worldCount()`.
11. **Extend `scripts/mutating-get-guard-test.cjs`** to the six NQ admin routes (prizes/vip/lounge-admin/reward/leaderboard-reset/gate) once they're POST — flag-less GET = read, GET-with-flag = 405, POST = through. **Update the callers in the same commit** or the console breaks. `/api/nq/gate` is the owner's phone panic lever — ask before making it POST-only.
12. **Docs guards**: `NQ_TESTING_RULES.md:70` says "seven ground bosses" (actually 13 of 27); `DEV_NOTES.md:42` says 24 levels / 8 worlds (actually 90 / 21) and `:23` says ~3.1k lines (9,824); `NQ_VIP_WORLDS.md` says worlds 13–15 / 9 levels / no bosses (actually 13–21, 27 levels, every world has a boss, plus a *separate* 9 grant-only hidden rooms) and documents GET admin calls and a key that `masterOK` doesn't accept; the LAUNCHPAD backlog line is done. Reconcile in one docs pass.

---

## 10 Owner decisions

- **Sniper range 330→~230** is a real difficulty change across 163 sniper + 29 laserbot placements and moves the telemetry baseline. Alternative: keep 330 but gate the shot on the shooter being on-camera.
- **Camera look-ahead** and the ground-worm fan narrowing change feel on every level. Frozen numbers (speed 192 / boost 225 / jump −430) are untouched by all of the above; the variable-jump *cut* floor (−120, 28% of impulse) is not one of the frozen three but is still a feel change.
- **Two advertised holder perks are free to everyone today** — level-resume and MEGA WHALE both return `true` unconditionally in production (`:2108-2115`), and the Over-screen upsell for the first is dead code. Either drop the claims from the pitch or gate on live tier. Monetization call, not ours.
- **Tap-to-continue vs auto-advance**: LevelClear now holds 6–8 s after *every* level and carries a buy button; the ask was reading time, not ad time.
- **Keep the World-12 ending for tier-1?** The F1 fix preserves it deliberately; confirm that's wanted rather than routing everyone to a VipPitch.
- **VIP seat terms** remain allowlist-only in code (`vipNormie`/`vipClkn` default 0) while the module header documents concrete token numbers. Which is intended?
- **`/api/nq/gate` POST-only** removes the documented phone-address-bar panic lever (`&on=0`). Keep the workflow with a small keyed form, or accept the change?
- **Removing the run bob** reverses an accepted 2026‑08‑15 look; **LINEAR on backdrops** changes every painted level; **`image-rendering:pixelated`** changes every surface at once. All three need a staging eyeball on desktop *and* a touch device.
- **Wheel `queue_full`**: consume the spin, or re-pick from non-queue prizes? Odds honesty argues for the former.

---

## 11 Refuted

None. Every finding brought forward survived verification; several had their **severity or their proposed fix corrected** — notably: the pause-rebase regex fix (would have missed most of the timers it targeted), `nqIsVipOrAll()` as the F1 predicate (ignores the launch cap), `trust proxy:1` as the F12 fix (tested: still exempt), a hard `world ∈ token.names` rule on clears (would drop legitimate fast/in-flight checkpoints), evicting `pending`/`raffle` rows under a ceiling (destroys earned prizes), POST-ing the prizes console's own links (`masterOK` never reads the body), and moving the continue-cap into the token (defeated by replay, already covered by a test).

---

## 12 Checked and clean

Level geometry: `nq-geometry-check.cjs` **PASS, 90 levels, 14 warnings, 0 failures** — no unjumpable gap, no fixture over a pit, no spike buried in a wall, no enemy stuck in geometry, spawn-runway rule holds everywhere. `nq-leaderboard-test.cjs` 49/49, `nq-claims-test.cjs` 15/15, `nq-tier-gate-test.cjs` all pass. Source is **in sync with both built shells** (rebuild produced a zero diff), so the standing staleness warning doesn't apply to anything here. Run-token forgery, checkpoint adjacency + 8 s dwell, durable nonce replay, tiered MAX-cap eviction that protects a claimable winner, per-purpose key derivation, `masterOK`/`adminOK` separation, PII encryption + shipped-wipe, the crypto-strong server-authoritative wheel, ledger idempotency, cloud-save furthest-wins clamping, TV-pair two-secret design, the dormant burn shop's byte-identical-message refusal, no CORS on `/api/nq/*`, no IPs or wallets in the telemetry stores, and full `esc()` coverage on every server-rendered admin page — all verified correct. Also clean: every scene's RES-invariant camera and `SCREEN_RECT` discipline (the 2026‑08‑16 anchor fix is complete), pit-respawn `_lastSafe` banking, boss-arena containment across all 15 start functions, the moon run cycle (a *real* two-pose animation), the backdrop double-fetch guard, iOS four-dead-state audio, gamepad/POV-hat handling, the keyboard-capture-vs-text-field guard, the topBand canvas-relative fix, the service worker's network-first navigations, and the visual gate's honestly-documented advisory split.

---

## 13 Coverage and gaps

Ten dimensions: engine, levels 1–8, levels 9–21, bosses, flow, rendering, wallet/money, leaderboard/telemetry, routes/stores, performance, lounge, copy, tests/CI, docs, mobile, security, playtest.

**Not run, per the hard rules:** the 90-level state test, the visual gate, `nq-boss-ground.cjs`, `nq-pause-touch.cjs`, and any headless browser. So **nothing visual here is confirmed by a rendered frame** — the P0-B analysis is pixel-measured from the assets and read from source, not seen on screen; the camera, telegraph and mobile-feel findings are reasoned, not played. Never exercised: connect-and-sign with a real wallet, a real spin, a rendered autopsy, the prizes/admin consoles (out of bounds — PII). All telemetry figures are quoted from `NQ_STATE_OF_THE_GAME_2026-09-05.md`, not read live (the public board did show 62 runs vs the doc's 61, so it's roughly current). Production was not diffed against the repo. `nq-verify.cjs`'s own classifier, `nq-ledger.js`, and the React school were not audited in depth. The "unverified" findings in §4–§6 are single-pass reads without an adversarial second look; the ones in §2–§3 are all confirmed.

---

## 14 Recommended batches

### Batch 1 — this week (`develop` → staging → owner go)
**F1, F2, F3, F4, F5, F6, F7, F8, F9, F13, F14, F15, F17, F19, F22** + the `WORLD_CLEARS[43]/[46]` relocation + docs reconciliation (§9.12).

*Test plan.* F1/F2/F3/F7 touch the **Game/GameHelpers regions → ENGINE** per `NQ_TESTING_RULES`, so `nq-verify.cjs` will plan a **FULL sharded state run** (`nq-state` matrix, advisory until 2026‑09‑13) plus build + smoke + visual gate. F6/F8/F9 are **DOM** → beat/panel test + visual + (once wired) `nq-pause-touch.cjs`. F5 and the WORLD_CLEARS edit are **interstitial** → beat test + one smoke level, explicitly *not* the 90-level run. F4/F13/F14/F15/F17/F19 are server/client-page → pure node: `nq-leaderboard-test`, `nq-claims-test` (with the new repro), `nq-tier-gate-test`, `node --check`. Always: `nq-geometry-check` + the new music-routing script. Baselines: **no re-approval** (see §3). Never edit the shells; rebuild with `src/build.js`.

### Batch 2 — security, perf, boss coverage
**F12, F18, F20, F21, F10, F11, P11, P12** + §9 items 1–7 and 11 + the WebP re-encode + the music re-encode + delete `normie-quest-play.html`.

*Test plan.* F12/F18 + the mutating-GET migration: `scripts/mutating-get-guard-test.cjs` (extended), `node --check server.js normie-quest/*.js`, and a manual GET/POST matrix against a local boot — **no browser needed**. F10/F11/P11/P12/F20/F21 are ENGINE → full sharded state run + boss-ground (now in CI) + visual gate. The WebP swap is an asset-format change → visual gate on a machine that is not the shared box, plus confirm the minimum supported iOS. F21 specifically needs a multi-world play-through on a memory-constrained device — that is an owner/staging job.

### Batch 3 — the Lounge, and the bigger content
**F16 + the full §7 spec** (LNG‑07/13/14/15/16/18/19/21/22/24/25/26 folded in), **§5 items 2–7**, **§6 items 1–4**, **P1–P10** from §4.

*Test plan.* The Lounge is served by an explicit `res.sendFile` route, so it needs no build step and no game test — `node --check` on the extracted script, the new `nq-rewards-test.cjs`, and a staging eyeball on desktop + phone (a pixel diff cannot answer "does this feel luxurious"). §5 items 2 and 4 are **level/interstitial data** → geometry check + beat test + the smoke level; §5 item 3 and §6 items 1–2 are ENGINE/menu → full state run + visual gate. P6/P8 change how every level and every text surface renders — those two go to staging alone, with deliberate baseline re-approval and the new PNGs committed as the owner's review surface.
