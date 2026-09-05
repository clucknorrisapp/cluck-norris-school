<!-- Produced 2026-09-05 by a 14-agent read-only mapping run plus a critique-driven revision. State of the game + candidate plan for the owner's 'perfect, bigger, better' push. Owner decisions are marked; reward/prize terms remain UNAGREED with the NORMIE team. -->

# NORMIE QUEST — STATE OF THE GAME + CANDIDATE PLAN
**2026-09-05 · sources: seven read-only maps + my own re-verification of the disputed numbers**

> **Map correction before anything else.** The `nq-client-engine` map reports "51 levels, 8 numbered worlds" and derives from that a headline risk that the advertised "worlds 4-12 / 13-21 / all 21 worlds" copy describes content that does not exist. **That is wrong and it is the exact class of error CLAUDE.md warns about — one spelling checked, the whole class assumed.** Its regex matched only `name:'…'`. The later 39 level defs use JSON style (`{"name":"9-1",…}`). I re-parsed both forms: **90 levels, 63 numbered across worlds 1-21, 27 named rooms** — matching the `nq-content-map` map, the geometry checker's own "90 levels checked", and live telemetry that contains real deaths on 16-1, 17-1 and 21-3. The advertised world numbers are accurate. Discard that risk; nothing below is built on it.

---

## 1. What exists, in numbers

**Content** (verified by re-parsing the `LEVELS` array in `normie-quest/src/game_logic.js`, both def formats):

| | count |
|---|---|
| Levels total | **90** |
| Numbered levels | 63 (worlds 1-21 × 3) |
| Named rooms | 27 — 10 bonus, 9 ULTRA VIP, 8 private/dev/kids |
| Boss levels | **27** (22 numbered incl. the deliberate 20-2/20-3 double, 5 in rooms) |
| Distinct `bossType` | 21 (`kol` reused 5×; `golem` 2×) |
| Enemy kinds | 19 (18 in `enemies[]` + `miniworm`), **1,113 placements** — ghost 244, sniper 163, bitmaxi 156, bot 122, drillbit 103, fudster 71, jeet 45, paper 32, sandwich 30, laserbot 29, mevdrone 26, gasgoblin 22, troll 18, longneck 17, eyeball 16, jumpfish 7, flyfish 7, flashbot 5 |
| Powerup kinds | 11, **381 placements** — candle 74, bull 57, diamond 47, solana 45, supergeek 35, coldwallet 35, omegachad 30, caffeine 26, moon 15, whale 10, megawhale 7 |
| Reserve items | 4 types (disc/vial/shield/star), 3 banked slots |

**Gating shape** (verified against `nqWorldAllowed`, game_logic.js:2062-2094):
- Worlds 1-12 are the public game — `window.__NQ_WORLDS = ceil(non-hidden non-vip / 3) = 12`.
- **All 27 levels of worlds 13-21 carry `vip:true`** (legacy "VIP LEAGUES" model). A `vip:true` level resolves through `nqIsVipOrAll()` — tier-2 `'all'` **or** an explicit VIP grant (`game_logic.js:2034-2095`, per the client-engine map). ⚠ I earlier dated this to "a 2026-08-30 fix": **unverified** — no map gives a file:line or changelog for it, and it is probably a conflation with the 2026-08-30 *security review* that moved the prizes console / board-wipe / paywall-gate from `adminOK` to `masterOK` (`routes.js:46-50`), an unrelated change.
- ⚠ **Two maps disagree on whether tier-2 clears the 9 ULTRA VIP rooms.** The client-engine map reads `nqIsVipOrAll()` as tier-2 `'all'` **or** grant; the content map reads the same code as requiring an allowlist/VIP grant **in addition to** the $50 tier. Unresolved from the maps alone — settle it by reading `nqIsVipOrAll` before any copy or gating change depends on it.
- ⚠ **Doc conflict, unresolved: `NQ_VIP_WORLDS.md` (2026-07-21) describes the VIP wing as "worlds 13-15", 9 levels, allowlist-only; `NQ_LAUNCH_GATE.md` (2026-08-22) describes $50 unlocking "everything (13-21)".** Whether the 13-15 wing and the numbered tier-2 unlock 13-21 are the same worlds, a different numbering, or two separate things was **not reconciled by any map**. Don't write copy, terms or a gate change that assumes one reading.
- The 10 bonus rooms and 8 private rooms are **never gated** (`if(!m) return true`).

**Tiers — live, never hardcode** (`GET /api/nq/wallet/config`, pulled this session):
`usdPriced:true`, `priceUsd 0.0010080` → **tier1 $5 = 4,961 NORMIE → worlds [1,12]**; **tier2 $50 = 49,605 NORMIE → `all`**; **2,000,000 CLKN → tier2**. Gate: `on:true, freeMax:3, cap:0` (launch cap lifted). Shop `shopEnabled:false`. Promo card `null` (never written).

**Code**: `game_logic.js` **9,784 lines** (the entire client engine, one IIFE) + `build.js` 105. Backend **13,819 lines** across `routes.js` (1,459) and 14 modules.

**Tests / gates**: 8 harnesses, 2 generators, 1 audio tool.
- *In CI, unconditional*: `nq-geometry-check`, `nq-tier-gate-test`, `nq-leaderboard-test` (twice — dep-free then strict), `nq-claims-test` (strict in smoke-test), budget/graph freshness.
- *In CI, path-gated*: `nq-visual` — **1 of 6 surfaces is a hard gate** (gravemite 5.0%); title/HUD/3 characters advisory.
- *Manual only, not in CI*: `nq-state-test` (all 90 levels), `nq-boss-ground` (**13 of 27 bosses** in a hand-written list), `nq-pause-touch`, `nq-verify` (the router that picks the others).

**Asset weight** (measured):

| | bytes |
|---|---|
| `public/worlds` (59 webp, 1376×768) | 4.92 MB |
| `public/music` (8 tracks, mp3/m4a) | 23.21 MB |
| `public/sfx` (1 file) | 15 KB |
| `public/pwa` | 0.68 MB |
| `src/assets` (base64 sprites, inlined at build) | 10.40 MB |
| `art-refs` (dev-only) | 13.48 MB |
| **built `normie-quest-platformer.html`** | **11.37 MB raw** |
| **served, compressed (measured live)** | **8.15 MB, `cdn-cache-control: max-age=300`** |

---

## 2. What the live data says

### The data says

**Volume** (dashboard window since 2026-07-20): 3,762 events · 3,245 deaths · 517 clears · **6.3 deaths/clear** · 72 levels played · 61 scored runs · 51 wallet-verified · 2 comments · 2 VIP members · **runs in the last 7 days: 0**.

**Sessions** (journey, all-time): 13 unique players · 13 sessions · **0 returning** · devices 4 mobile / 2 desktop / 7 unknown · avg 4.2 min, **median 1 min**, longest 18.1 min, total 55.2 min · starts 73 · clears 17 · deaths 231 · quits 8 · overall clear rate 23.3%.

**Worst levels by deaths-per-clear** (matches the dashboard's own NEEDS ATTENTION chips exactly):

| level | deaths | clears | d/c | top killer |
|---|---|---|---|---|
| SANDCASTLE | 10 | 0 | ∞ | DRAGGED UNDER (4) — pre-cutoff test data |
| **11-3** | 119 | 1 | **119** | GROUND-WORM SPIT (33) |
| **12-3** | 118 | 2 | 59 | CARTEL DUMP CANDLE (29) |
| **1-1** | 116 | 4 | 29 | JEET TOUCH (57) |
| 8-3 | 115 | 5 | 23 | SNIPER BOLT (39) |
| 10-3 | 114 | 6 | 19 | GROUND-WORM SPIT (29) |
| 16-1 | 76 | 4 | 19 | GROUND-WORM SPIT (28) |
| 21-3 | 107 | 6 | 17.8 | SNIPER BOLT (27) |
| 8-2 | 113 | 7 | 16.1 | SNIPER BOLT (49) |
| 9-1 | 89 | 6 | 14.8 | GROUND-WORM SPIT (25) |
| 17-1 | 48 | 4 | 12 | SNIPER BOLT (32) |
| 9-3 | 59 | 5 | 11.8 | GROUND-WORM SPIT (22) |

**Top killers game-wide**: SNIPER BOLT **650** · GROUND-WORM SPIT **438** · GHOST TOUCH 340 · FELL IN A PIT 237 · SPIKES 212.

**Drop-off**: 1-1 — 26 starts, 2 clears, 6 quits (**23.1% quit, 7.7% clear**). 1-3 — 6 starts, 1 clear, 1 quit. 2-1 — 1 start, 0 clears, 1 quit (n=1, ignore).

**Leaderboard**: 61 rows, weekly board **empty** since the 2026-08-31 week start. Three distinct non-suspect players, ever: NormieCEO 83,405 (world 11), Chuck 7,826 (world 3 — wallet `2zMCUkE9…` is the CLKN treasury), Saahitama 588 (world 1). All activity landed in **two bursts, 2026-08-22 and 2026-08-23**.

**Wallet connects by app**: Jupiter 7 · Phantom 4 · loungePhantom 2 · Solflare 1.

**Player comments — both of them, verbatim:**

> **1.** `Dr x` · level `6-3 @x6368` · kind `bug` · 2026-07-27T00:28:54Z · Safari/Mac
> **"🪲 Something buggy here (quick tag)"**

> **2.** `anon` · level `1-2 @x247` · kind `note` · 2026-07-21T02:53:04Z · Safari/iPhone iOS 18.7
> **"🎉 Fun! (quick tag)"**

My read: both are **preset quick-tag taps, not written feedback** — there is zero free text in the store, ever. #1 is unactionable as filed (no repro, no cause) but its position is interesting: 6-3 is a boss, at x6368 of a ~6.7k-wide level, i.e. at the arena. If it were a boss-grounding artifact it would fit the 2026-08-16 sink bug's timeline (this comment predates the fix by three weeks) — **not verified, and not worth chasing without a repro.** #2 is the only qualitative positive signal the game has and it is from world 1 on an iPhone.

### I infer

- **1-1 is the wall, not world 11.** 116 deaths for 4 clears and a 23% quit rate on the *first screen of the free tier*, killed mostly by `jeet` touch. Every other tuning candidate is downstream of this one.
- **Two enemy archetypes own the death curve**: sniper (650) and ground-worm spit (438) are 33% of all deaths between them. A per-archetype pass moves more of the curve than any per-level edit.
- **The $5 tier ends in a wall.** 11-3 (119:1) and 12-3 (59:1) are the last two bosses a tier-1 holder can reach and the least beatable content in the game. That is the worst possible place for a difficulty spike — it is the moment a paying player decides whether $50 is worth it.
- **There is no retention loop.** 0 of 13 sessions returned; median session 1 minute. The game has been *sampled*, never *played by a cohort*.
- **We are tuning on ~13 players from two days a fortnight ago.** 51 of 61 verified runs against 3 distinct non-suspect players means most rows are the same few wallets, one of which is the treasury. **Treat the leaderboard as a test fixture, not a market signal.** Any level with fewer than ~10 clears is directional only.
- **We have no qualitative channel.** `nq-feedback` is wired to the `?test=1` build; the public game has no visible feedback affordance, which is why 3,762 events produced 2 preset tags.

---

## 3. Reliability debt

| # | Issue | Evidence | Fix shape |
|---|---|---|---|
| 1 | **Music is misrouted for every deep world.** Track is picked by `def.name.charAt(0)` — so `"9-1"`, `"10-1"`…`"21-2"` all fall through to `world1`. ~25 paid levels play the world-1 theme; world 8's two normal levels play the **boss** track (`w0==='8'?'boss'`). Only 5 of 90 levels set `music` explicitly. | `game_logic.js:2501` (read in full) | Parse the world number, replace the ternary ladder with a `WORLD_MUSIC[w]` table. S. |
| 2 | **The 90-level boot + boss-stompability test never runs in CI.** A shared-engine change can go green and deploy. | no `nq-state-test` reference in `.github/workflows/syntax-check.yml`; only `nq-verify.cjs` invokes it, and that is manual too | Add a CI step running `nq-verify.cjs --against <merge-base>`, plus a nightly full run. |
| 3 | **Boss-grounding guard is manual and covers 13 of 27 bosses — and this gap is a repeat.** The 2026-08-17 overnight audit (finding #18) already found the guard missing boss paths (state-machine / VIP bosses) *after* it had been purpose-built to close exactly this class. A hand-curated list has now failed twice. | `nq-boss-ground.cjs:31-52` hand-written `BOSSES` list; `docs/AUDIT_2026-08-17_OVERNIGHT.md:97`; not in CI | Generate the list from `LEVELS` (`boss:true`), gate it on any `src/assets/cut_*.b64` or boss-def diff. |
| 4 | **Touch pause is untested behaviorally.** The harness asserts hotspot geometry only; it states four attempts to drive a real tap in headless Chromium failed. | `nq-pause-touch.cjs:133-149`; not in CI | Put the geometry assertion in CI; keep tap-to-pause as a named manual iPad step in the release ritual. |
| 5 | **5 of 6 visual surfaces cannot fail the build**, pending an open determinism TODO (player still physics-settling at capture; webfont rasterizes per-machine). | `nq-visual.cjs:72-104`; CLAUDE.md | Settle+freeze the player before capture, self-host the arcade font, re-promote to hard gates. |
| 6 | **iOS audio has no telemetry.** The four-dead-state + zombie machinery is correct and must not be simplified, but we learn about failures only from an owner's iPad. | `game_logic.js:249-297`, pause-card diagnostic at 5975 | Fire `nqTele('audio',{state,frozen,rebuilt})` on every rebuild; surface incidence on the dashboard. S. |
| 7 | **Unbounded per-wallet stores.** `nq-rewards` (pending/spins/bonus/passes/raffle/hbuff), `nq-ledger`, `nq-save` bound each wallet's substructure but **not the number of distinct wallet keys**. Sign-message costs nothing, so throwaway keypairs are a slow disk-filler on the `/data` volume. | server map; no eviction found for the outer map in any of the three | Count/LRU cap + prune-on-write, same shape as `nq-pair`'s `MAX_PENDING=500`. |
| 8 | **10 backend modules have no logic test** — rewards, ledger, save, pair, promo, telemetry, journey, feedback, digest, normie-burn. Only `node --check`. | CI YAML | One dep-free `.cjs` per module in the node-check job; start with rewards/ledger/save (they hold state players earn). |
| 9 | **GHOSTSHIP `bossBodyBot` contradiction.** The comment at `game_logic.js:4149-4151` says the GHOST SHIP floats and **"its hull ends at 78% of the plate"**; `HANDOFF_2026-08-16` goes further and states it declares `bossBodyBot:0.96`. **No level in `LEVELS` sets `bossBodyBot` at all** (verified — zero key assignments), so all 27 bosses run the ground default 1.00. Three sources, three different numbers — 78%, 0.96, and the 1.00 actually in force. Either the docs are stale or the galleon is mis-seated by ~22% of its height. | my parse; `game_logic.js:1559-1573`, `:4149-4151` | Run `nq-boss-ground.cjs` idx 89 against staging and measure the hull against the 78% target; correct whichever of the three is wrong. S, and it removes a booby trap for the next boss. |
| 10 | **8.15 MB compressed for the game document**, because 50+ sprites are inlined base64. Edge cache is 300s, so most cold loads pull it from origin. | measured live: `raw 11,369,682 / compressed 8,151,985` | Move sprites to a hashed atlas under `/nq-assets/`, long-cache it; keep the inlined build for `normie-quest-play.html` only. L. |
| 11 | **Orphans / unverified assets.** `icon-512-maskable.png` and `apple-touch-icon.png` are not linked from either HTML head (the manifest may declare them — **not verified**); `art-refs/lounge-title.b64.txt` and 5 creature PNGs are unreferenced; whether `art-refs` (13.5 MB) is copied into `dist/` at build is **not verified**. | assets map + my `du` | Read `manifest.webmanifest`; check `dist/` after a build; delete or move `art-refs` out of any copied tree. S. |
| 12 | **Hardcoded world ranges in paywall copy.** Amounts render live from `nqTerms()`, but `"worlds 4-12"`, `"the deep worlds 13-21"`, `"all 21 worlds"` are string literals. | `game_logic.js:7361, 7471-7483` | Derive the ranges from `__NQ_ACCESS` / `__NQ_WORLDS` the way the amounts already are — otherwise a tier change makes the copy lie. S. |
| 13 | **18 rooms are ungated by tier** (`if(!m) return true`) — the 10 bonus rooms and 8 private rooms. Client-side gate anyway, so this is product shape, not security. | `game_logic.js:2086` | Decide deliberately: bonus rooms as a free-tier teaser is defensible; make it a choice, not a fall-through. |
| 14 | ⛔ **OWNER DECISION / SECURITY REVIEW — not pre-approved.** `x-premium-key` is refused by every NQ admin gate (only `?key=` or `x-nq-key`) — it returns a 404-shaped body, which reads as "endpoint gone" mid-incident. Widening an accepted-credential form is an **auth-surface change** on gates that include `masterOK` (VIP grants, reward grants, leaderboard reset, the launch-gate lever, the PII-bearing prizes console), and 2026-08-30 moved gates *tighter*, not looser. | `routes.js:37-61`; reproduced live | **Default: document the correct header in the runbook — no code change.** Accepting a third alias needs an explicit owner go plus a security review; do not implement it as part of a sprint. S. |
| 15 | **No public feedback affordance.** `nq-feedback` serves the `?test=1` build; hence 2 preset tags against 3,762 events. | feedback store count = 2 | One-tap feedback chip on the pause card in the public build. S. |

---

## 4. PERFECT — polish candidates

| # | Candidate | Evidence | Effort | Risk | Verification |
|---|---|---|---|---|---|
| P1 | **1-1 opening pass** — thin/slow the jeets in the first ~800px, add footing over the early gaps | 116 deaths / 4 clears; JEET TOUCH 57; 23.1% quit rate; 26 starts is the largest single-level sample we have | **S** | Low — it is the free tier, no budget or boss coupling. Regen `nq-budgets.json` if enemy count changes | `nq-geometry-check` (must stay PASS), `nq-verify` picks the single-level state test, then watch 1-1 quit rate |
| P2 | **Sniper archetype pass** — telegraph the shot, or cap fire rate above a `diffMul` threshold | 650 deaths game-wide (#1 killer), top cause on 8-2, 8-3, 17-1, 21-3; **163 placements** | **M** | **Medium — a shared behavior change touches ~40 levels at once.** Prefer a per-level knob or a `diffMul`-scaled cadence over a global constant | Full `nq-state-test` (this is a shared-code change → `nq-verify` will demand it), then per-level death deltas |
| P3 | **Ground-worm spit pass** — same shape | 438 deaths (#2); top cause on 11-3, 10-3, 16-1, 9-1, 9-3 | **M** | Medium, same reason | as P2 |
| P4 | **11-3 / 12-3 boss rebalance** (`mevdragon`, `dirtywhale`) — HP or attack cadence | 119:1 and 59:1; these are the last two bosses inside the $5 tier | **M** | Medium — boss HP feeds `nq-budgets.json`; a lowered ceiling can flag legit runs | `gen-budgets.cjs` + `gen-level-graph.cjs` regen (CI fails if stale), `nq-boss-ground` on both, state test on both |
| P5 | **Music routing fix** (debt #1) | 25 paid levels play the world-1 theme | **S** | Low | Boot staging, walk 9-1/16-1/21-1, confirm three distinct tracks |
| P6 | **Feel — jump buffer only.** 130ms → 150ms | FELL IN A PIT = 237 deaths (#4). Speed 192 / boost 225 / jump -430 are **owner-set 2026-08-16 and frozen** | **S** | **Owner decision, not mine.** Do not touch speed | `nq-geometry-check` reach math must be unchanged; manual on staging |
| P7 | **Device tag on death beacons** — `nqTele('death')` carries no device; only journey has it (4 mobile / 2 desktop / 7 unknown) | can't currently answer "do mobile players die more?" | **S** | None (additive field, `nq-telemetry` validates `ev` and `world`, not extra keys) | Dashboard shows the split within a day of traffic |
| P8 | **Audio-health beacon** (debt #6) | 4 dead states, zero field data | **S** | None | Dashboard counter |
| P9 | **Load time — sprite atlas** | 8.15 MB compressed, measured | **L** | Medium — touches the build pipeline and every texture key; visual baselines must be re-approved | `nq-visual --update` with an eyeballed PNG diff; re-measure `size_download` |
| P10 | **Save/continue for wallet-less players** — server-side save keyed by the existing anonymous `nq_sid` | cloud save requires a wallet session; the free tier (worlds 1-3, the majority) loses progress on a cache clear | **M** | Medium — **pair with debt #7 or it is a new unbounded store** | New dep-free test for the merge rule (furthest-wins), same shape as the `nq-save` logic |
| P11 | **Paywall moment** — fire the pitch on a *clear*, not on a lock | 1-3 is a boss and the last free level; today a player who just lost a boss fight meets the upsell | **S** | Low — `LevelClear` beat rotation already exists | Manual walk of 1-3 → 2-1 on staging |
| P12 | **Public feedback chip** (debt #15) | 2 comments / 3,762 events | **S** | Low — store is capped at 2,000 | Post one from staging, read it back on the dashboard |

---

## 5. BIGGER — content candidates

**The per-world pipeline** (what every new world costs, from the content map + my checks):

1. 3 level defs appended to `LEVELS` in the **JSON-per-line** format (the later style — both parse).
2. A `1376×768` webp plate in `public/worlds/` + a `WORLD_ART` key; bump `WORLD_ART_VER` to bust the 7-day CDN cache.
3. A boss: new `bossType`, a **~330×480 full-body plate with feet reaching the bottom edge** (chroma-key + trim recipe in `HANDOFF_2026-08-16_ART.md`), left at the `bossBodyBot` default 1.00 unless it floats.
4. A `WORLD_CLEARS` entry keyed by the `LEVELS` index after the boss; optional `BRIEFINGS` entry.
5. Music — a new track, or a `WORLD_MUSIC` entry once P5 lands.
6. **Regen `nq-budgets.json` and `nq-level-graph.json`** (CI fails on stale) and keep `nq-geometry-check` at PASS.
7. Add the boss to `nq-boss-ground`; re-baseline `nq-visual` only if a captured surface moved.

Note: `WORLD_ART` already carries plates through w21, and 59 plates exist for 21 worlds — **art is staged up to the current content, not beyond it.** A world 22 needs new art.

| Candidate | What it costs | Effort |
|---|---|---|
| **Fill hidden rooms for worlds 14-20** (owner rule: exactly one per world; per HANDOFF_2026-07-24 only 13 and 21 had one — **not reverified**) | reuses existing themes and plates; def + graph/budget regen per room | **S each** |
| **Wire LAUNCHPAD** — built, unwired, parked for a World 9 warp | a one-line warp entry | **S** |
| **Re-skin the 4 reused `kol` bosses** (TOMSTURF/BEACH/SANDCASTLE/GHOSTSHIP all share `kol`) | 4 boss plates through the art recipe; no level-design work | **M** |
| **Time Attack / one-life gauntlet over existing levels** | no art; reuses the per-level point budgets and the run-token chain the leaderboard already enforces | **M** |
| **World 22** | full pipeline above, new plate set + boss + music | **L** — after §7 steps 3 and 7 |

**What the VIP wing needs to open**: the 9 VIP rooms are **built and playable today** (grant, and possibly tier-2 `'all'` — see the unresolved read in §1). ⚠ **Which worlds the "VIP wing" even means is unresolved in the docs**: `NQ_VIP_WORLDS.md` (2026-07-21) says worlds 13-15, allowlist-only; `NQ_LAUNCH_GATE.md` (2026-08-22) says $50 unlocks 13-21. No map reconciles them, and the code has both a 9-room `vip:true` wing and 27 numbered deep-world levels. Settle the numbering **before** terms are written, or the terms will name the wrong content. Missing is (a) **owner-confirmed qualification terms** — four proposed paths (locks, burns, pay-SOL, buy volume) each need a threshold, window, duration and permanence decision, with locks recommended first because it feeds the Locker Room story; (b) the wheel graphic — 3 rendered wedges against 6 prize items, hardcoded conic gradient (**status not reverified since 2026-07-25**); (c) a copy pass that names **no** threshold until terms exist. ⚠ **VIP-wing terms are owner-to-confirm; nothing public may state a number.**

---

## 6. BETTER — retention / social / rewards

⚠ **Anything touching prizes or rewards: TERMS UNAGREED with the NORMIE team — promise nothing.** The code already holds this line: `nq-rewards` pays only in-game items, passes, raffle entries and points; its header states token payouts would go through the owner-signed airdropper, never that file; `nq-promo` calls its admin write "the honesty gate"; `nq-claims` names only a generic physical prize. Keep it that way.

| Candidate | State today | Effort | Note |
|---|---|---|---|
| **Leaderboard seasons** | weekly reset lever exists (`masterOK` + `&confirm=RESET`, archives then wipes); weekly board is **empty** | S to operate | Seasons need traffic to mean anything. Sequence after acquisition, not before |
| **Weekly prize flow** | fully built — 1 winner configured, 14-day window, sign-to-claim binding an address hash, AES-256-GCM at rest, ciphertext wiped on ship. 1 pending winner this week. ⚠ **Live state unverified:** `/normie-quest-x7/prizes` (masterOK, the only place shipping addresses are decrypted) and `/api/nq/claim/status` were **deliberately left unread** by the telemetry map under a read-only/no-PII posture, and no map confirmed their production behaviour | already done | ⚠ **TERMS UNAGREED.** Don't extend, don't publicise terms. **Read-only posture: a session must not open the prizes console or pull claim state — it decrypts PII. Verifying that flow is an owner action, and an owner ask (§8 Q9), not something to run from here** |
| **VIP wheel — add the missing prizes** | 3 wedges rendered, 6 items exist (star/clock/bomb owner-grant-only) | M (graphic rebuild first) | ⚠ TERMS UNAGREED for anything beyond in-game items |
| **TV pairing** | built (QR + two-secret claim), **zero usage instrumentation** | S to add a counter | Cheap; tells us whether it was worth building |
| **Lounge** | speakeasy page, wallet-gated, daily spin | live | Blocked on VIP terms |
| **End-of-run share card** — score / furthest world / deaths, rendered client-side | does not exist | S-M | **The only candidate here that could create traffic rather than assume it.** Must name no reward terms |
| **Weekly promo card** | wired into the between-level beats, `updatedAt: 0` — **never used once** | S | A free surface already built and idle |

**Honest read**: 0 of 13 sessions returned and the median session is 1 minute. No amount of reward machinery retains a cohort that does not exist. The retention work that matters this month is P1 (the 1-1 wall) and the share card — everything else on this list is machinery waiting for players.

---

## 7. Recommended sequence

**Weeks 1-2** — all on `develop` → staging; nothing here needs a money decision.

1. **P5 music routing** + **debt #12 hardcoded ranges**. *Unblocks*: the paid tier stops sounding like world 1; the paywall copy stops being a manual edit away from lying. (Debt #14 is **deliberately not in this batch** — it is an auth-surface change needing an owner go and a security review. The runbook line documenting the correct header is fine to write; the code alias is not.)
2. **P1 (1-1) + P4 (11-3, 12-3)**. *Unblocks*: the funnel entrance and the tier-1 exit — the two ends of the paying path.
3. **Wire `nq-verify`/`nq-state-test` and `nq-boss-ground` into CI; generate the boss list from `LEVELS`** (debt #2, #3). *Unblocks*: **every content change after this one is safe to ship.* Do this before, not after, the balance work lands on `main`.
4. **Cap the unbounded wallet stores + first tests for rewards/ledger/save** (debt #7, #8). *Unblocks*: opening the wheel and lounge to more wallets.
5. **P7 device tag + P8 audio beacon + P12 feedback chip**. *Unblocks*: the next tuning pass runs on data instead of inference.
6. **Debt #9 GHOSTSHIP `bossBodyBot`** — one staging run, settle it. *Unblocks*: the next floating boss has a correct example to copy.

**Next**

7. **P9 sprite atlas / load time** (L). *Unblocks*: mobile first-load and the app-store transition.
8. **P2/P3 sniper + ground-worm archetype passes** — deliberately *after* step 3, because these are shared-code changes and step 3 is what makes them verifiable.
9. **P10 anonymous cross-device save** (M).
10. **Hidden rooms for worlds 14-20 + wire LAUNCHPAD** (S each).
11. **Share card** (M), then the promo card put to use (S).
12. **Visual-gate determinism → re-promote the character surfaces** (M).
13. **New world / Time Attack mode** (L) — only after 3 and 7.

**Owner decisions, not mine**: every `develop` → `main` promotion; whether feel numbers may be touched at all (P6); the 11-3/12-3 difficulty intent; VIP qualification terms; **debt #14's admin-header alias (auth surface — owner go + security review)**; anything in §6 touching prizes, including any live check of the claims/prizes PII flow; whether to spend on new art for a world 22; whether the free tier stays at 3 worlds.

---

## 8. Questions

1. **Tune or acquire?** Everything in §4 assumes we keep the current audience. We have 13 players, 0 returning, from two days a fortnight ago. Is the first job making the game better, or getting anyone to play it?
2. **11-3 and 12-3**: 119 deaths to 1 clear at the end of the $5 tier — wall by design, or bug-shaped difficulty?
3. **Feel**: 192/225/-430 are your numbers from 2026-08-16 and I have treated them as frozen. May I move the jump **buffer** only (130→150ms), or is nothing in feel open?
4. **Music**: worlds 9-21 all play the world-1 track today. When I build the per-world table — reuse the 8 tracks we own, or do you want new ones?
5. **VIP wing**: what qualifies? The nine rooms are built and playable; nothing public can name a threshold until you say one.
6. **Prizes**: is *anything* agreed with the NORMIE team yet, or does the weekly physical prize remain the only reward we ever mention?
7. **Free tier**: stays at worlds 1-3, or does 1-3 being a boss make world 4 the better wall?
8. **VIP numbering**: is the "VIP wing" worlds 13-15 (the 2026-07-21 doc) or the deep worlds 13-21 (the 2026-08-22 launch gate), or both, separately? Terms can't be written until that's one answer.
9. **Prize flow**: its live state is unverified — the prizes console decrypts shipping addresses, so no session has touched it. Do you want to confirm the pending winner and the 14-day window yourself, or authorise a check and say exactly how far it may go?
10. **8.15 MB** to load the game. Acceptable through the app-store transition, or does the atlas work jump the queue?