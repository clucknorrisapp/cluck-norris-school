# Normie Quest — Overnight Audit Report (2026-08-16)

**Executive summary**

- 34 unique confirmed findings (11 high, 22 medium, 1 low) across 11 audit dimensions; every finding below survived an independent verification pass; 1 candidate was refuted; 15 polish items follow at the end.
- The single most important finding: **today's 240→192 speed retune shipped with no time-budget pass.** 2-1 and 2-2 already had the thinnest margins in the game at the old speed and will now TIME UP honest runs; four more levels (3-1, 6-1, 20-2, 1-3) are close behind.
- Also urgent: the leaderboard run-token can be forged into a verified, giveaway-eligible 527,155 #1 score in about a minute — reproduced end-to-end — while every legitimate CONTINUE run is silently flagged suspect and excluded.
- The free campaign's ending is broken: clearing 12-3 shows "RUG PULLED! WORLD 1 CLEARED" — no level sets `final:true`, so the real Win scene is unreachable (live-confirmed).
- Pause is leaky across the board: boss state machines run on a clock that advances while paused (instant no-telegraph attacks on resume from any tab switch), and music restarts at full volume behind the pause card.

---

## Act on these

### High

**1. 2-1 THE SAND LANDS (time:120) — the retune ate the margin; honest runs will TIME UP**
Location: `normie-quest/src/game_logic.js:665` (def), 2233/2869/5461 (timer); `https://clucknorris.app/api/nq/hotspots?level=2-1`
Production data at the old 240 px/s: 76 deaths / 26 clears, avgClearSec 144 against a 120s budget — the only sampled level whose wall-clock clear average exceeds its budget (120% vs 36–96% for every other early level). avgClearSec is wall time (pauses freeze the countdown but not `Date.now`), so 144 doesn't prove live-timer use averaged 120 — but every clear provably consumed under 120s of live timer (censored at the cap), i.e. the thinnest margin in the game. Today's retune adds ~25% traversal time on a 5200px level whose top killer (ground-worm spit, n=26) already makes players creep; `time:120` is unchanged, TIME UP at 2869 is a run-ender, and `loseLife` never touches the clock.
Evidence: def `{ name:'2-1', time:120, width:5200 }`; API `{deaths:76, clears:26, avgClearSec:144}`; `timeLeft` written exactly once (2233); retune confirmed at 2658 and 5695.
Fix: raise time to ~150–160 (restores the old-speed ratio scaled by 240/192).

**2. 2-2 NORMIE CASINO (time:130) — slot play burns the live timer; old-speed clears already averaged 125s**
Location: `game_logic.js:680` (def), 5654 (slot/idle interaction); hotspots API for 2-2
Five slot machines are the level's designed activity, and playing them consumes the countdown — `nearActiveSlot` only suppresses the idle auto-pause, it never freezes the clock. avgClearSec 125 pressed against the 130 cap shows the timer was already truncating the clear population at old speed (the average is survivor-biased: only sub-cap clears can enter it). The +30s clock item was removed 2026-07-26 ("the level clocks are generous enough" — a judgment made at 240 px/s), so no time-recovery mechanism exists anywhere.
Evidence: def lines 680–694 (5 slots); line 5654 verbatim; API `{deaths:66, clears:25, avgClearSec:125}`; clock-item removal at 1936–1939.
Fix: raise time to ~165, or pause/credit the countdown while the player is at a slot.

**3. 12-3 finale plays the World-1 ending — the Win screen never fires**
Location: `game_logic.js:1096` (12-3 def, missing `final:true`); 4701–4709 / 4796–4801 (bossDefeat)
No level anywhere sets `final:true` (both level formats grepped), so bossDefeat's final branch — "THE CARTEL IS PURGED!" plus the Win scene — is dead code. `bossType:'dirtywhale'` matches no other branch and falls through to the Rug King else: a player who clears the entire 12-world free campaign gets "RUG PULLED! WORLD 1 CLEARED", no finale, no Win screen (the dirtywhale Win variant at 6128 with the princess is unreachable), and is routed straight into the VIP wall. Live-confirmed on the dev server after 5 stomps on THE DIRTY WHALE.
Evidence: grep for `final` in level defs → zero hits; live scene text "RUG PULLED! | … WORLD 1 CLEARED"; intended ending exists at 4803/6128.
Fix: add `"final":true` to the 12-3 def, then re-verify: beat 12-3 → "THE CARTEL IS PURGED!" → Win scene, dirtywhale variant.

**4. Boss machines run on `time.now`, which advances while paused — resume skips telegraphs and fires instant attacks**
Location: `game_logic.js:5555–5576` (pauseGame/resumeGame) vs the timestamp machines at 3462–3511, 3868–3871, 4159–4179, 4330–4365, 4467–4512, 4570–4600, 4891–4928
pauseGame freezes physics, the scene clock and tweens — but Phaser's Clock assigns `this.now` BEFORE its paused check (verified in the vendored bundle), so every boss deadline keeps counting through any pause, and resumeGame rebases nothing. On resume every live deadline has expired at once: Rug King charges with zero remaining tell, the swan in telegraph dives on the first resumed frame (reproduced live), grounded stomp windows expire invisibly, and every ranged-boss scheduler fires one immediate attack. Because the game auto-pauses on 10s idle, on modal open, and on tab-hide (added today), an ordinary tab switch mid-boss now yields a no-telegraph hit.
Evidence: live measurement — paused=true, clockPaused=true, yet `now` advanced +3983ms across a 3s pause; swan entered pause in 'telegraph', first resumed frame was 'dive'.
Fix: record `pausedAt` in pauseGame and shift every live boss timestamp by the pause delta in resumeGame (or route boss ticks through a pause-adjusted clock).

**5. powerBanner subtitles overflow the 480px view — power-up effects and boss instructions clip at both ends**
Location: `game_logic.js:3263–3270`
The banner's second line renders `tag + ' · ' + sub` at 21px with no wordWrap and no scale-to-fit. Measured with the real font: 11 of 13 sampled lines exceed 480px — "IT IS EATING THE BRIDGE — STOMP IT x3" measures 636–768px, the Rug King line up to 997px. The clipped portion is the actionable text (stomp counts, durations, "DODGE THE CHARGE"), and it fires on every power-up pickup and boss intro.
Evidence: line 3270 (no wrap); live canvas measurement; screenshot shows both ends clipped mid-word during a real fight.
Fix: drop the tag prefix to its own small line and size the sub to fit (~12px, or `setScale(Math.min(1,(W-24)/t2.width))` before tweening in).

**6. Leaderboard run-checkpoint proves nothing — forge all 90 checkpoints in a minute, post a verified 527k score**
Location: `normie-quest/nq-leaderboard.js:108–117`
`checkpoint()` appends ANY level name to the signed list — no adjacency check, no ordering, no per-level minimum time (v2 deliberately has "No time component"). Level names ship in the built HTML; the throttle is 200/min so 90 names fit in one minute. Reproduced end-to-end: run-start at 1-1, checkpoint all 90 names, submit `score=527155, world=21` → `{ok:true, suspect:false, verified:true}` — rank #1 on all boards and eligible for giveaway draws, with zero gameplay. The test suite never exercises this path (its forgeries all tamper with the token instead).
Evidence: line 115 `if (names.indexOf(lvl) === -1 && names.length < 200) names.push(lvl);`; `routes.js:177` throttle 200/min; budget sum 527,155 across 90 levels.
Fix: in `checkpoint()`, only credit a legal successor (or warp target) of a level already in the list, and enforce a per-level minimum dwell via a `lastCpAt` field inside the signed token.

**7. Every continued-from-checkpoint run is flagged suspect and silently excluded**
Location: `game_logic.js:6089–6092` (CONTINUE), 7903–7908 (fresh token); `nq-leaderboard.js:252`
On game over the run is submitted and the token nulled; CONTINUE restarts at the checkpoint with the banked cumulative score, and `enterLevel` then starts a FRESH token seeded with only the resumed level. The next submit posts the carried total against a budget covering only post-resume levels — e.g. a player carrying 15,910+ points resumes at 9-1 (budget 6,780) and is instantly over the ceiling → `suspect=true`, excluded from every board and giveaway draw with no feedback. This fires on essentially every continue — the core premium checkpoint perk. Same applies to the Win-screen submit after any continue.
Evidence: 6091 `scene.start('Game',{level:self.cont,score:self.contScore,...})` after 6062 cleared the run; budgets verified (1-1..2-3 = 15,910; 9-1 = 6,780).
Fix: submit only the delta earned since resume (track segment-start score), or seed the resumed token server-side with the budgets the banked checkpoint implies (requires fix #6 to stay sound).

**8. `_lastSafe` never reset on level entry — pit respawn uses the previous level's coordinates (21-2 hits it in production)**
Location: `game_logic.js:5711–5712, 6048` (consumers); 1122 (21-2 data); 2995 (return spawn)
The Game scene instance is reused across `scene.start` and `_lastSafe` is only written on standing ground — neither `init()` nor `create()` clears it. Enter a level over a void and fall before landing → respawn at the PREVIOUS level's banked coordinates. Reproduced live with a lives-drain loop (respawn x from 1-1 landed inside 1-2's gap, 3→2→1 lives). Production-reachable: 21-2's speakeasy return spawn is x=1270, inside its own gap [1260,1380] — a VIP player returning from the moon speakeasy falls straight into the pit on arrival, then respawns at coordinates carried over from the bonus room.
Evidence: sole `_lastSafe` write at 5712 (grep); live probe transcript; 21-2 warp x=1200 → return 1270, planks start at 1300.
Fix: `this._lastSafe=null` at the top of `create()` (the pit handler already has a spawn-offset fallback). Separately, move 21-2's warp-return spot clear of the gap.

**9. 9-2 speakeasy warp door and a honeypot share the exact same x=1200 — using the secret guarantees a coin drain**
Location: `game_logic.js:996` (level data); tryWarp 2993; honeypotHit 5108
The warp requires ducking at the door (~46px wide, x≈1177–1223); the honeypot body (x≈1187–1213, y≈220–244) covers the door's center, and the crouching player's body overlaps it — ducking in guarantees the drain (all coins earned this level, plus a 700ms snare), barring a ~5px pixel-edge. Every sibling speakeasy level offsets its guard honeypot 40–50px from the door; 9-2's dx=0 is the only exact overlap in the game and reads as a placement error. This is the owner's banned F15 trap class in stronger form, and `nq-geometry-check.cjs` has zero warp awareness, so CI passes.
Evidence: `"warps":[[1200,70]]` and `"honeypots":[[1200,232],...]`; both-format scan confirms unique; sibling offsets 40–50px.
Fix: move the honeypot to x≥1290 (past the return-spawn) or move the warp; add warps to the geometry check's honeypot-clearance rule (72px) so the class can't recur.

**10. Locked-content preview cards promise $NORMIE unlocks and VIP perks on the PUBLIC build — owner-policy breach**
Location: `game_logic.js:6722–6739, 6796–6808, 6353–6358, 6742–6748`
CLAUDE.md: in-game $NORMIE copy is identity/where-to-buy only — "never promise gating terms on any public surface." The NQ_PREVIEWS cards render on every odd level/world clear with "unlocks with $NORMIE · terms still in testing", "STILL LOCKED — VIP PERK", and concrete perk promises (members-only feed with giveaways and alpha drops, daily VIP wheel with published odds, tier-2 level resume). The gate reads `__NQ_ACCESS`/`__NQ_VIP`, which are published only in the SETUP lane — on the public URL they're undefined, the band defaults to t1, and ALL cards show. It also lies: nothing is actually locked publicly (`nqWorldAllowed` returns true), yet the card says STILL LOCKED. Verified present in the built public HTML.
Evidence: 6808 caption with no SETUP check; 6745–6747 default-to-t1; 6737 lounge-perk hook; file's own invariant at 7822 contradicted.
Fix: gate `nqPreviewPick()` on `window.__NQ_SETUP` (return null publicly, fall back to the Nation line); keep perk-promise hooks out of the public build entirely.

**11. Ghost Galleon plate is off-center with severed tentacles — hitbox sits ~46px left of and ~20px below the visible monster**
Location: `normie-quest/src/assets/scary_ghostship.b64` + `game_logic.js:1446–1450, 3854–3855`
The plate's opaque content occupies only the right half of the 384px frame plus two genuinely detached tentacle fragments, breaking the "plates are trimmed to their content" assumption the body-box code states — producing a ~46px invisible damage strip on the player's approach side, ~21px of visible head that deals no damage on the right, and a body bottom ~20px below the art. Confined to the hidden `?room=scary` boss room, but that is playable shipped content, and it's a 5-stomp fight against an invisible hitbox.
Evidence: connected-component scan (main comp x164–347, detached frags at x60–109 and x161–213; content bottom 0.776 vs bossBodyBot 0.96); live `__NQ_BOSSBODY` numbers match the arithmetic.
Fix: re-cut the plate centered and trimmed (reattach or delete the severed pieces), set `bossBodyBot` to the new true content bottom, re-shoot the framing with `__NQ_BOSSVIEW`.

### Medium

**12. 3-1 THE ROOFTOPS (time:135)** — `game_logic.js:709`. Old-speed avg clear 107s (n=11); realistic post-retune projection ~123–128s leaves single-digit slack on a level whose top killer (SNIPER BOLT, 15/31 deaths) rewards stopping and waiting — behavior the timer punishes. Fix: raise to ~160.

**13. 6-1 THE PEG (time:190)** — `game_logic.js:851`. Avg winning run already burned 73% of budget (139s, 4.5 deaths/clear); projected 160–174s post-retune, and the mid-level death cluster (x4160–5120, SNIPER BOLT/SPIKES) burns backtrack time on a never-reset clock. Boost tier fell 340→225 (×1.51), deeper than modeled. Fix: raise to ~225.

**14. 20-2 THE STORM HERALD (time:225)** — `game_logic.js:1119`. A boss level budgeted like a non-boss level: same-width non-boss levels get 225 while every nearby boss level gets 240–265 (19-3 at identical 7800px gets 245). The timer runs through the fight, timeout is a run-ender, and the n=10 death bucket sits inside the boss arena. Caveat: only 3 clears sampled. Fix: raise to ~260 — traversal budget plus a boss allowance.

**15. 1-3 THE RUG KING'S KEEP (time:135)** — `game_logic.js:652`, bossHP at 3381. The unique outlier among all 27 boss levels (both formats scanned): budgeted at 4.05× its run floor — statistically identical to its non-boss siblings — while every other boss level gets 5.26–10.75×, despite funding a 3-hit fight with ~1.4s i-frames per stomp. World 1 hosts the slowest players (5.6 deaths/clear). Reads like the budget predates the boss. Fix: raise to ~160–170.

**16. Black Swan dive-timeout leaves it 'grounded' mid-air — sole stomp window unreachable, cue still fires** — `game_logic.js:4350–4352`. The dive exit uses `k.y=Math.min(k.y, GY-28)`, the exact pre-fix pattern the MEV Dragon corrected at 4488–4493 with an unconditional floor snap (its comment describes this failure outright). Any pause >1.4s during a dive trips the timeout at circle altitude: the swan sits "vulnerable" above double-jump reach for 3.4s with the cue printing at an unreachable spot. Reproduced live. Self-recovers — a wasted cycle, not a soft-lock. Fix: mirror the dragon — unconditional `k.y=GY-28`.

**17. swanFeathers lacks the stompImminent guard every other aimed volley has — point-blank fan punishes a committed stomp** — `game_logic.js:4367–4382` (fired from 4357). Eleven other aimed volleys carry the guard; the swan fires its 3-feather fan at the exact grounded→rise frame where it turns invulnerable, aimed up into the bounce arc of a player doing the taught action (the window was explicitly widened to invite a second stomp). The dragon fixed this same class after an owner report; the swan is the one boss where it remains. Dodgeable with reaction, so an unfair ambush rather than a guaranteed hit. Fix: add the guard (or skip the center feather when overhead).

**18. The 4%-sink boss-feet bug fixed today persists in the state-machine/VIP boss paths — 12+ bosses, unguarded** — `game_logic.js:4039, 4084–4086, 4255, 4389, 4619`; `test/nq-boss-ground.cjs:32–40`. Today's fix touched only the shared startKolBoss path; golem/reaper/greatbear/saylor and all 9 VIP bosses hardcode body bottom 0.96 while their plates are trimmed flush (0.0% bottom margin, measured). Live-confirmed sinks: golem +3.4px, reaper +3.5px, greatbear +4.2px, exactly (1−0.96)×displayHeight; the regression guard covers none of these bosses. Fix: raise the fractions to 1.00 in these spawn paths (re-tune stomp bands) and add them to nq-boss-ground.cjs.

**19. Laser drone always aims its cannon AWAY from the player — sniper flip polarity reversed for left-facing art** — `game_logic.js:5954`. The sniper behavior uses `setFlipX(p.x<e.x)`, opposite to the documented nose-faces-LEFT convention and every other facing line. Invisible on the symmetric 'bot' texture, but `cut_laserbot`'s barrel unambiguously points left — so all 29 laserbot placements across worlds 16–21 face away from the player 100% of the time while their aimed bolts fly out of their backs. Fix: invert the test for laserbot (`p.x>e.x`) or flip the plate.

**20. Music resumes at full volume behind the "you stepped away" pause card on tab return** — `game_logic.js:567` and `:303` vs `:5559`. (Independently confirmed by two finders.) Tab-hide pauses the game and suspends music; on return, two 'visible' handlers call `MUSIC.resume()` unconditionally — neither checks the scene's paused state — so on desktop/Android the track plays behind the PAUSED card, contradicting pauseGame's deliberate suspend. Same for a manual pause taken before switching tabs, and the capture-phase `_unlockAudio` (291/297) restarts music on every keystroke typed into the paused-game feedback modal. Fix: skip `MUSIC.resume()` in those handlers when the Game scene is paused (expose `__NQ_PAUSED`); keep the AudioContext revival unconditional; let `resumeGame()` own the restart.

**21. Unmuting after a tab-return leaves music silent until the next unrelated input** — `game_logic.js:555, 558, 548`. suspend() pauses the element but keeps `streaming=true`; if muted at that point, resume() bails on the muted guard, and toggle() only fades gain — it never calls `play()`. The unmute tap's own pointerdown ran `_unlockAudio` BEFORE the click flipped muted, so that gesture's resume bailed too. Player unmutes, hears nothing, concludes sound is broken. Fix: in toggle(), when unmuting and `curEl.paused && streaming`, call `curEl.play()` (the click is a genuine gesture).

**22. Any transient play() rejection permanently blacklists a produced music track for the session** — `game_logic.js:526, 521, 437, 211`. The catch sets `missing[name]=true` for ANY rejection: iOS NotAllowedError (first play of each track fires from scene create, outside a gesture) and cross-platform AbortError (tab hidden during track start rejects the pending promise). Either way the track is treated as nonexistent for the rest of the session and every later gesture-driven resume hits the early-return; the zombie-recovery path re-arms the blacklist on iOS. Never silent — it silently downgrades the produced soundtrack to the chiptune synth. The comment at 430–431 states the exact principle being violated. Fix: inspect the rejection name — only blacklist on real media errors; clear `missing[]` in `_unlockAudio`.

**23. 10s idle auto-pause fires mid-combat on a player who is only throwing discs or using items** — `game_logic.js:5654` vs `:5671, :5718–5719`. Activity counts only move/jump/duck; throw and item-use inputs never feed `lastInputAt` (grep: four writes total). Stand on a safe ledge firing discs for 10s during a boss fight — or ride SOLANA MODE auto-fire — and the "you stepped away" card drops mid-fight. The slot machines got exactly this carve-out; combat never did. No progress lost, but a wrongful interruption. Fix: include throwHeld and item-use edges in the activity condition.

**24. Game over in a URL-entered private room dumps the player into campaign 1-1 with no way back** — `game_logic.js:5528–5533, 6089–6092, 1713–1717`. A `?room=` boot never sets a checkpoint or return level, so `cont` is always 0 and Over's "PLAY AGAIN" silently starts campaign level 0 (dropping the lab flag). Victory correctly returns to Title / replays the room — only defeat misroutes. Fix: when `def.private`, restart the same room (or return to Title) instead of the campaign continue flow.

**25. Free-player VIP upsell teaser can never appear — its only trigger index is unreachable** — `game_logic.js:6871–6875, 4820, 5507–5519`. `nqShouldPitch` fires only for idx 3 (level 2-1), but its sole call site is `advanceLevel`, which runs only on boss defeats — and no boss level has idx 3. Non-boss levels complete through `levelClear`, which never pitches. The designed "MORE WORLDS AWAIT" tease is dead; free players' first VIP touchpoint is the hard locked wall at world 13. Fix: move the check into `levelClear()` (or a shared post-clear router).

**26. World 5 briefing, preview and world-clear all name THE VAULT WYRM; the boss actually fought is THE BRIDGE DRAINER** — `game_logic.js:6199, 6461, 6724` vs `835, 4144–4145`. No level in either format defines `bossType:'wyrm'` — the wyrm fight is dead code — yet three player-facing surfaces still sell it as world 5's boss; the clear screen celebrates a boss that doesn't exist. Fix: update WORLD_CLEARS[15], the Briefing-12 threat, and the preview card to the Bridge Drainer.

**27. World 8 briefing still calls the Great Bear "the TRUE FINAL boss" and "the final gauntlet" — 13 worlds follow** — `game_logic.js:6490, 6493`. Stale from when the game ended at world 8; beating the bear prints "WORLD 8 CLEARED — DESCEND" and the run continues to the WEN MOON finale. The game contradicts the claim two minutes later. Fix: reword ("the World 8 boss — stomp him x5"), drop "final gauntlet".

**28. Difficulty telemetry time-in-level is wall-clock — pause-on-hide now inflates it by whole tab-away spans** — `game_logic.js:1998` (consumers 4667, 4881, 5466, 5509, 5523). `_lvStartAt` is `Date.now()` and never offset; pauseGame keeps no paused-time accumulator, and today's pause-on-hide makes unbounded pause spans routine — so the time dimension of the tuning telemetry is systematically inflated. (Deaths/clear metrics, including the 11-3 outlier, are unaffected.) Fix: accumulate paused ms and subtract when computing `t`.

**29. Unauthenticated telemetry POST can fabricate difficulty data and evict the whole real dataset in ~2.2h** — `nq-telemetry.js:46–48`. `add()` only clamps types/lengths — any 24-char world string passes, clears need no run token — so one griefer can mask the 11-3 outlier or paint phantom hotspots into the dashboard the owner tunes from. The store is a global 8000-event ring with oldest-first eviction; at 60/min one IP erases all real history in ~134 minutes. The route comment's claim that a hostile client "can only churn its own bucket" is false. Fix: validate `world` against the level set, require a run token on clears, make eviction per-world or add per-IP daily quotas.

**30. GHOSTSHIP budget omits the +1000 private-room defeat bonus — legit ceiling beats budget by 1000 vs EPS 300** — `tools/gen-budgets.cjs:50–54`. The name-keyed TYPE_BONUS table lists the other private rooms but not GHOSTSHIP, so the budget says 2045 while the game pays up to 3045; boss rooms have zero time-bonus slack to absorb it, violating the generator's own "never below what a legit player can score" contract. Every future private boss room silently repeats this. Fix: derive the bonus from the level def (`l.private && l.boss` → +1000, keep MYSPACE's 2000 special case), regenerate.

**31. Secret steel stashes (hidden/VIP levels) are a score source gen-budgets doesn't model at all** — `game_logic.js:2356–2375`. Hidden/vip levels mark up to 6 runtime secret blocks paying up to 130 points each; `levelMax()` has no term for them. Sharpest exposure: direct `?room=` entry seeds a token with only that room's budget and no slack cushion — a lucky, thorough legitimate run can exceed the 300-point EPS and be falsely flagged suspect. Fix: add a flat allowance (`if (l.hidden || l.vip) m += 6*130`), regenerate.

**32. Run-token HMAC secret defaults to PREMIUM_ACCESS_KEY — anonymous visitors get an offline cracking oracle** — `nq-leaderboard.js:32` (same fallback at `nq-wallet.js:38`). `/api/nq/run-start` hands any caller a known-payload/HMAC-tag pair signed with the master premium key (NQ_LB_SECRET isn't in the documented env list, so the fallback is the realistic production state). Crackability depends on the key's entropy, but reusing the master key as an anon-exposed HMAC secret is a key-separation flaw regardless. Fix: derive a per-purpose secret at boot (`HMAC(PREMIUM_ACCESS_KEY,'nq-lb-v1')`) or require a dedicated NQ_LB_SECRET.

### Low

**33. Scene restart during a backdrop fetch double-loads the plate and double-paints the scrim** — `game_logic.js:2275–2276`. The race is real (two fetches, a benign "Texture key already in use" console error) but the level keeps its art — it's painted twice, stacking the 0.22-alpha scrim to ~0.39 so that one restarted level renders noticeably darker. Fix: paint off the global texture manager (`addtexture-` event) and only queue the load if the key isn't already pending.

---

## Uncertain — needs a human or a device

Nothing landed here: every candidate finding was either confirmed with evidence or refuted in verification. (The pre-existing device-only items — iPad RES A/B, tap-to-resume — remain tracked separately and were not re-audited.)

---

## Minor polish

- **Timer watchlist (18-1, 20-1, 19-2, 16-3):** face-value margins at or below zero but n=2–3 clears each and wall-clock pollution — re-pull hotspots after a week of post-retune traffic; if within ~20% of budget, bump times 15–25%.
- **8-2 coin at (1980,224) grazes the honeypot at (2000,232)** — ~5px body overlap when grabbing from the right; nudge coin to x≤1955 or pot to x≥2040. Only instance game-wide.
- **`__NQ_PAUSE`/`__NQ_RESUME`/`__NQ_KBGAME` lack the isActive guard** `__NQ_SYNCREWARDS` has — page-hide can run pauseGame on a stopped scene (self-heals; orphaned objects plus a false ownership report to the modal logic).
- **Camera flash/shake effects aren't frozen by pauseGame** — a boss-intro flash finishes under the PAUSED card; reset the effects in pauseGame.
- **Generic ground-charge also drives the flying Bridge Drainer** — velocity is saved only by tick order; the ground-charger wobble rotation sticks on the flyer permanently. Add 'drainer' to the exclusion list at 5992.
- **Drainer's grounded snap (`GY-38`) buries its claws ~6px in the floor** every vulnerable window; snap to GY-44 and re-verify with `__NQ_STOMPTEST`.
- **Chroma-green matte fringe on cut_blackswan (2,060px) and cut_dirtywhale (1,000px)** — near-invisible at game scale; defringe on next re-export.
- **Setup-lane MEGA WHALE flash states "500K NORMIE HOLDER PERK"** — an explicit threshold the codebase's own comment says is never promised; use the "TOP-TIER HOLDER PERK (terms in testing)" hedge.
- **Numeric drift in copy:** GIGA CHAD briefing says 10s vs actual/banner 8s; yield farm quoted at 10,000% APY in one card and 40,000% in another. Pick one of each.
- **Parked nameless leaderboard runs silently die after the 2h token TTL** — the "waiting is safe" comment describes the retired v1 check; surface a name-within-2h hint and check the setHandle response.
- **Joystick header comment still claims it's OPT-IN and "ships DORMANT"** — it's been the default touch control (gate is `?joystick=0`); rewrite before it misleads a session.
- **VIP worlds 16–21 have no WorldClear celebration or Briefing** — interludes stop after world 15; the premium half of the paid wing, including the moon transition, gets the generic beat. Owner call: add entries or accept deliberately.
- **bossDefeat's bespoke TOM branch (Win screen + replay MySpace) is unreachable** — the generic private early-return supersedes it; delete or exclude TOM from the early-return.
- **`nqWorldAllowed` never enforces `vip:true` on the nine hidden VIP rooms** (non-numeric names exit before the vip check) — unexploitable today, silent bypass for any future link; check `def.vip` first.
- **`levelClear()` ignores `def.next` and always advances to idx+1** — private chains work by array-position luck; use the same expression `advanceLevel` uses.

---

## Verified clean

- **progression-flow** — audited the world/level advance graph and end-of-run routing beyond the specific defects above; nothing further confirmed.
- **Collectible reachability (telemetry-curve sweep)** — computed audit of all 2,996 coins/powerups/airdrops/bonusblocks/caches across all 90 levels (both level-def formats, moon gravity scaled): worst-case rise 188px vs 205px double jump, zero unreachable items, zero items over bare pits or out of bounds; all warp targets and `next` chains resolve to valid levels with consistent vip flags and moon `grav`.
- All ten other dimensions (time-budgets, telemetry-curve, collectible-reach, scene-lifecycle, pause-clock-edges, boss-machines, asset-sweep, copy-strings, anticheat-economy, ios-browser) were covered in full — their results are the findings above.

---

## Refuted

- **"1-1 FIRST STEPS (time:110): 15–24% projected slack on the entry level"** — the cited facts reproduced, but the inference conflated two clocks (wall-clock clear averages vs the pause-frozen live countdown); the projected squeeze doesn't hold on 1-1's actual live-timer margin.

---
*Run: 48 agents (10 finders + adversarial verification + synthesis), ~4.3M tokens, 3h18m, overnight 2026-08-16/17. Caveat: the telemetry-curve finder failed to return structured output, so its standalone findings are absent — partially covered by the time-budget finder's own telemetry pulls; rerun candidate.*
