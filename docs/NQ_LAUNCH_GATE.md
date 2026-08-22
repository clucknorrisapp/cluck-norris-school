# Normie Quest — the launch gate (worlds on/off without a redeploy)

Shipped 2026-08-22 for the public launch. One switch decides how far anyone can get into the
game. It lives on the `/data` volume, so **flipping it takes seconds from a phone and needs no
redeploy and no restart**.

## The three knobs

| knob | what it does | launch value |
|---|---|---|
| `on` | master switch. `false` = **no gating at all**, whole game free to everyone (exactly how the public build behaved before launch day). Panic switch. | `true` |
| `freeMax` | highest world playable with **no wallet connected** | `3` |
| `cap` | **hard ceiling over every tier** — holders and VIP included. `0` = no cap, tiers apply normally. | `3` |

At launch `freeMax = cap = 3`, so **everyone gets worlds 1–3 and nobody gets more**, holder or not.

## The levers

All are `GET`, admin-keyed, 404 without the key — fire them from a phone browser.
`KEY` = `PREMIUM_ACCESS_KEY` (or `NQ_FEEDBACK_KEY`).

```
read the current state       /api/nq/gate?key=KEY
▶ OPEN THE HIGHER WORLDS     /api/nq/gate?key=KEY&cap=0      ← the "few days are up" flip
   put the cap back          /api/nq/gate?key=KEY&cap=3
   widen the free tier       /api/nq/gate?key=KEY&freeMax=4
   panic: make it all free   /api/nq/gate?key=KEY&on=0
   back to the env default   /api/nq/gate?key=KEY&reset=1
```

Every response echoes `effective`, i.e. what a real player would get right now:

```json
"effective": { "noWallet": [1,3], "tier1": [1,8], "tier2": "all" }
```

**Takes effect within ~5s for everyone.** Server caches gate state 5s; the client re-reads
`/api/nq/wallet/config` on every launch.

## Boot defaults (Railway env)

`NQ_GATE_ON=1`, `NQ_GATE_FREE_MAX=3`, `NQ_GATE_CAP=3`.

⚠️ **Unset env = gate off = open game.** That is deliberate — deploying this module can never
silently lock a running game. It also means the env vars must be set on Railway for the launch
lock to be armed after a redeploy. A live override (`/api/nq/gate?...`) outranks the env until
you `&reset=1`.

## What unlocks worlds 4+ once the cap lifts

The existing wallet tiers in `nq-wallet.js`, all env-tunable, **owner's call, not yet decided**:

| env | default | grants |
|---|---|---|
| `NQ_TIER1_NORMIE` | 10 000 | worlds 1–8 |
| `NQ_TIER2_NORMIE` | 50 000 | all worlds |
| `NQ_CLKN_ACCESS` | 2 000 000 | all worlds |

⚠️ **No public surface names a threshold, a price or an unlock term** — NQ's holder terms are
still unagreed with the NORMIE team (CLAUDE.md). The in-game card says "opening soon" while the
cap is on and "hold amount: TBD — testing" after. Keep it that way until terms are actually agreed.

## Leaderboard

Owner's rule, launch day: **anyone can put a name on the board.** Connecting a wallet is what
makes a run **🏆 prize eligible** — that flag is set server-side in `/api/nq/score` from a
checked session token, never from anything the client claims. Players with no wallet see one
line under the board telling them what they're missing.

Season reset (archives first, then wipes):
`/api/nq/leaderboard/reset?key=KEY&confirm=RESET`

## Holder tiers (owner, 2026-08-22 — LIVE terms)

Free **1-3** · hold **$5 of NORMIE** → worlds **4-12** · **$50** → **everything (13-21)**.
CLKN whales (2M) keep full access; the manual VIP allowlist is unchanged.

- Dollar-priced live: `NQ_TIER1_USD` (default **5**) / `NQ_TIER2_USD` (default **50**), token
  amounts derived from the NORMIE price on every read (GeckoTerminal → DexScreener fallback,
  60s cache, `/data/nq-normie-price.json` last-known-good, 10x sanity band). Set either env to 0
  → token-count mode (`NQ_TIER1_NORMIE`/`NQ_TIER2_NORMIE`); same fallback if a price has never
  been seen. **Defaults are the live terms — no Railway change needed.**
- `/api/nq/wallet/config` → `terms` carries `{tier1Usd, tier2Usd, priceUsd, usdPriced,
  tier1Normie, tier2Normie}`; the boot shim stashes it as `window.__NQ_TERMS` and every piece of
  gate copy (title chips, lock cards, teaser) renders from it — no hardcoded amounts anywhere.
- **Go-live flip** (tiers take over from the launch cap): `/api/nq/gate?key=KEY&cap=0`.
  Back to worlds-1-3-only: `&cap=3`. Everything off: `&on=0`.

## What a capped player actually sees

Verified on production 2026-08-22 (worlds 1-3 open, cap armed):

- **Title:** `PLAY NOW  W1-3` / `W4-21  OPENING SOON` — instead of the FREE / PREMIUM / VIP chips.
- **Hitting the cap** (finishing 3-3, or any entry into a world above the cap) → the `VipPitch`
  scene in *launch-cap mode*: **"🔒 THAT'S THE FRONTIER — FOR NOW"**, "the rest of the game
  unlocks in a few days", a prize-eligibility nudge, and the `$NORMIE` identity + where-to-buy
  line. **No hold amount and no perk is named anywhere** — NQ's holder terms are unagreed, so
  the card must never imply one.
- While capped, the card drops the **PREMIUM LOUNGE** button for non-VIPs (nothing to sell yet)
  and the mid-run upsell teaser is suppressed entirely (`nqShouldPitch` returns false).
- **Back** goes to the **Title** screen, not `LevelSelect` — that picker is the TEST BUILD screen
  and only exists for `TEST_MODE` players (`nqHasPicker()`). Before the launch gate the locked
  card could only fire in the setup lane, so this branch had never been reachable by a real
  player.

When the cap lifts (`cap=0`) all of the above reverts to the members'-wing card automatically —
there is no second switch to remember.

## Honest limits

The world lock is **client-side**, because the game is client-side — it shapes what normal
players reach, it is not a security boundary, and a determined person can bypass it. That was
already true of the old tier gate. The parts that are actually enforced server-side are the
leaderboard, rewards, prize eligibility and claims.

Fail-open by design: if the config never arrives (offline first visit, API down) the game stays
playable rather than locking someone out. Returning players and PWA relaunches use a
`localStorage` cache of the last-known gate, so they stay capped even offline.

## Files

- `normie-quest/nq-gate.js` — state, env defaults, `/data` override, clamping
- `normie-quest/nq-wallet.js` — tier grants run through `gate.clamp()`
- `normie-quest/routes.js` — `/api/nq/gate` lever; gate published on `/api/nq/wallet/config`
- `normie-quest/src/game_logic.js` — `nqWorldAllowed()`, title bands, locked-world card
- `normie-quest/public/normie-quest-platformer.html` — head shim that fetches + caches the gate
