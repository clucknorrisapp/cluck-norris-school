# Normie Quest — Dev Notes

Side-scrolling Phaser 3.60 platformer for NORMIE/CLKN. Lives at **clucknorris.app/normie-quest-x7**.
This file is the single source of truth for how the game is built and the design decisions behind it,
so any fresh session (or a human/external auditor) can pick up cleanly.

> ⚠️ **CONCURRENT-SESSION WARNING (read first).** Normie Quest has been worked on by MORE THAN ONE
> Claude session in parallel, each building the whole `public/*.html` from its own scratchpad copy of
> `game_logic.js`. That means `src/game_logic.js` in this repo can go STALE the moment another session
> deploys. **Before trusting or editing `src/game_logic.js`, confirm it still rebuilds the live HTML
> byte-identically** (`node normie-quest/src/build.js` then `git diff normie-quest/public/normie-quest-platformer.html`
> — expect NO diff). If it differs, the deployed HTML is newer: re-extract the source from it (the game
> logic is the last `<script>` block in `normie-quest-platformer.html`, human-readable). The committed
> `src/` here was last reconstructed from the deployed HTML and verified byte-identical, and includes a
> concurrent session's Worlds 16–21 work (modern image-background engine, multi-slot inventory, new
> star/clock/bomb boosts) — 3 of that session's assets remain INLINE (not tokenized) in `game_logic.js`.
> **To avoid future clobbering, all sessions should build from THIS committed `src/`, not private copies.**

## Source of truth & build pipeline
The game is authored as ONE readable source file and assembled into a self-contained HTML:

```
normie-quest/src/game_logic.js   ← THE source (~3.1k lines). Edit this, never the built HTML.
normie-quest/src/assets/*.b64    ← 58 cut-out sprite/audio assets (raw base64), inlined at build.
public/vendor/phaser-3.60.0.min.js ← Phaser 3.60 (the ONE vendored copy), inlined for the CSP-free standalone build.
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

## 🛍 The shop (Item Reserve) — shipped 2026-08-02, OFF by default

Pay $NORMIE **or SOL**, get ONE banked power-up. It replaces the old `BURN_GATE` / `Gate` scene,
which was a **mock**: a fake "send 1,000 NORMIE with memo NQ-XXXX" screen and a
`[ SIMULATE BURN CONFIRMED ]` button that never touched the chain, one boolean away from charging
real people for a simulation. Both the flag and the scene are deleted. **The game is free to start
and stays that way** — the shop is optional boosts only.

**⚠️ MECHANISM CHANGE, same day it shipped (owner call, 2026-08-02): this was built as a BURN shop
and never armed as one.** It is now a PAYMENT shop. $NORMIE goes to the shop wallet and **the owner
locks what arrives on-chain** — that lock is the whole defence for collecting another project's
token with no agreement in place, so it is a real commitment, not marketing. SOL goes to community
giveaways. The old burn build would also have FAILED for every player: **NORMIE is a Token-2022
mint** (owner `TokenzQdB…`, verified on-chain — carrying only MetadataPointer + TokenMetadata, no
transfer fee), and the burn code used legacy-program defaults, so `getMint` threw before anyone
could sign. The payment code resolves the token program from the mint account and refuses
TransferFee / TransferHook / NonTransferable mints at build time.

**Arming it takes two env vars: `NQ_SHOP=1` and `NQ_PAY_DEST=<shop wallet>`.** There is
deliberately no default destination — the old incinerator fallback would silently turn "we lock
what you send" back into a burn. Use a dedicated wallet: NOT the treasury, and **NOT the swap-desk
wallet** (mixing them corrupts the desk's inventory accounting). Unset (the default, and what
production is on now) means `/api/nq/config` reports `shopEnabled:false`, the 🛍 Shop tab never
renders, and every shop route answers `not_configured`. `NQ_NORMIE_PRICE` sets the base NORMIE
price (default 1000; legacy name `NQ_BURN_AMOUNT` still read); `NQ_SOL_PRICE` sets the base SOL
price and **unset/0 keeps the SOL rail off**. The catalogue in `normie-burn.js` prices each item
off the base (×1 disc, ×2 vial/shield, ×3 star/bomb). Prices are read live from the server — never
hardcode one in the client. The shop page SHOWS the receiving address so anyone can watch the
wallet and check the locks; replay guards are namespaced per rail (`normie:<sig>` / `sol:<sig>`).

**⚠️ Terms are TESTING-ONLY.** Nothing about NQ's $NORMIE economy is agreed with the NORMIE team, so
the shop stays behind the unlinked game URL and no public surface may mention it.

Where it lives:
- `normie-quest/normie-burn.js` — sessions (wallet-bound + item-bound), the unsigned tx, the
  broadcast guard, on-chain verify, the durable replay guard, the once-only claim latch.
- `normie-quest/routes.js` — `/api/nq/config`, `/api/nq/shop/session`, `/api/nq/burn-tx`,
  `/api/nq/burn-send`, `/api/nq/shop/claim`. All per-IP throttled; all the money ones also require a
  proven wallet session. (`/api/nq/session` and `/api/nq/verify`, the play-gate pair, are deleted.)
- `src/game_logic.js`, the player-panel script block — the 🔥 Shop tab. A **DOM overlay, not a Phaser
  scene**: it needs the wallet plumbing that already lives there (duplicating the 11-wallet registry
  into a scene is the drift CLAUDE.md warns about), it is mostly warning copy that will not fit
  legibly on a 480×270 pixel canvas, and it has to open from anywhere, not only at a scene boundary.

Design rules baked in — change them deliberately, not by accident:
- **The item is delivered through the EXISTING reward queue** (`rewards.grant` →
  `/api/nq/rewards/claim` → `syncRewards()`), exactly like a wheel win. One delivery path, wallet
  bound, survives a reload, follows the player to another device.
- **The server broadcasts, and only the transaction it built.** `sendSigned` compares the submitted
  message byte-for-byte with the one it issued for that session, so the endpoint cannot be used as
  a relay for anything else. One signer — the player's own wallet — so the Phantom multi-signer
  ordering rule does not apply. No key is ever held server-side.
- **A double-click cannot double-burn**: the button is inert until an explicit tick, disables on the
  first click, a `shopBusy` latch refuses a second start, the confirm screen is replaced by a
  progress screen, and the session is single-use and replay-guarded on disk.
- **A burn that lands must never be lost.** The session id is parked in `sessionStorage` *before*
  broadcast, the claim poll resumes on reload, and if `rewards.grant` fails (full queue) the
  once-only latch is RELEASED so a retry still delivers.
- `nq-rewards.js` `ITEMS`, `RESERVE_ITEMS` and the `normie-burn.js` catalogue must stay mirrored.
  `routes.js` validates every catalogue id against `rewards.ITEMS` before issuing a session, so a
  drift fails at request time instead of eating somebody's tokens. The client reads item names and
  descriptions from `window.__NQ_ITEMS`, published off `RESERVE_ITEMS` — never retyped.

### LOCKING tokens for power-ups — designed, NOT built (owner decision pending)
(Not to be confused with the shop above: there the OWNER locks NORMIE he has received. This section
is about a player locking THEIR OWN tokens to earn a perk — a different custody question entirely.)
Asked for, deliberately left unbuilt: **locking needs a different trust model from paying.** A payment
is one irreversible event we can verify once and forget. A lock is a *relationship over time* —
which means every hard part is a new part:

1. **Custody.** Jupiter Lock (`lock.jup.ag`) escrows to a program-owned account with a claim
   authority. We would build unsigned lock transactions the same way, but from then on the player's
   tokens are somewhere we can see and cannot touch — and if the lock program, its UI or its fee
   model changes, our perk changes with it. A burn has no such dependency.
2. **Continuous verification, not a one-shot.** "Locked ⇒ boost" has to be re-checked, because a
   lock can expire or be claimed early. That means a scheduled reader over every locked wallet
   (paid RPC per wallet per tick) and a defined answer to "the lock ended, does the perk end too?"
   Neither exists.
3. **Revocation is a product decision, not a code one.** Taking a boost back when a lock unwinds
   feels like a punishment; leaving it granted makes a lock a slow burn with the tokens returned.
   The owner has to pick, and the choice sets what may ever be said about it publicly.
4. **State we do not have.** Burns are stateless — one durable set of consumed signatures. Locks
   need a per-wallet record (escrow address, amount, unlock time, last verified, perk granted) that
   survives redeploys and reconciles against the chain.
5. **A bigger promise.** A burn asks for tokens the player already accepts are gone. A lock asks
   them to trust that they get them back — from a game whose NORMIE terms are explicitly unagreed.
   That is the wrong order: settle the terms, then ask for custody.

Rough shape if it is ever green-lit: `normie-lock.js` alongside `normie-burn.js` (build unsigned
Jupiter Lock txs, same wallet-first signing, same broadcast-only-what-we-built guard), a durable
`/data/nq-locks.json`, a re-verification sweep on the existing scheduler pattern, and a perk that is
**time-boxed and re-granted** while the lock holds rather than granted once — the only model where
an unwound lock needs no clawback. **Do not start it until the owner has answered (3).**

## Open / parked threads
- **Real giveaway/rewards system** (premium) — not yet designed. Would tie into `/api/claim` +
  `lib/credentials.js` (verified transcripts already exist): track achievements → giveaway entries → draw.
- **Mega Whale art** — swap procedural sprite for a generated blue whale if desired.
- Optional: add a teaser hidden room to the free demo (Worlds 1–2) — allowed since hidden rooms only
  pay IN-GAME coins, not real rewards.

## Active dev branch
`claude/normie-quest-phase-0-lsa4dt` → merged to `main` (Railway auto-deploys `main`).
