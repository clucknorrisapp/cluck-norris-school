# AHOY: PumpFunPirates — game runbook

A treasure-map platformer built for the **Pump Fun Pirates** community (NFT collection
`8k6YzoW4FzMDXqKKBsF52fLvKa95c3U8YnchaZXEewoE`, token **AHOY**
`39eBixffUCh2GqF8sEE9fZ1rqoeP2HxNsstN5X5ppump`). Built 2026-10-02 as a surprise for their team,
owner's call. It is a separate section like `normie-quest/`: everything lives in `pirates/`.

## Where it runs

| Surface | URL | Holder gate |
|---|---|---|
| Site (unlisted, noindex) | `/ahoy-quest/` on staging after `develop`, production after `main` | **live**: wallet sign-in, on-chain reads |
| Shareable preview | claude.ai artifact (private until shared from its Share menu) | **demo**: a labelled "Preview holder seas (demo)" button, nothing checked |

Not linked from anywhere, not in the sitemap. Don't put it in a roundup, a door or promo copy
until the Pump Fun Pirates team has seen it and said yes. The art is theirs and their holders'.

## What's in it

- **7 seas, 19 islands** (`pirates/public/js/data.js`): Bonding Curve Bay, PumpSwap Straits (free),
  Jeeter Reef, Cold Storage Glacier, Rug Kraken's Deep, Uptober Isles (AHOY tiers), Captain's
  Cove (NFT holders).
- **Map**: per-sea parchment chart, fog over islands you haven't reached, dotted routes, map pieces.
  Each island hides one piece. The last island of each sea is the **X**: a timing dig and a chest.
  The full map is worth a bigger haul.
- **Crossings**: every first crossing hits a **mishap**: storm, Rug Kraken, jeeter gulls, the
  Sirens (shill songs; following one shipwrecks you, steering away pays), message in a bottle,
  rival ship duel, the liquidity-pool whirlpool. Booty is in-game only.
- **Moves**: run, jump (hold for height, tap for a short hop), **double jump** (press again in the air; a spin and a puff of spray), cutlass (swing frame plus a sweeping slash trail), pirate power. Each pirate has its own pose frames in `assets/sprite/pose/` (`run1`, `run2`, `jump`, `swing`, side view facing right); idle is the front-facing crew art. Duck was tried and removed (owner, 2026-10-02: the frames read too tall).
- **Controls** (`pirates/public/js/input.js`): `AHOY.CONTROLS` is the one table of bindings and the in-game CONTROLS panel (title, map, pause) is drawn from it. Keyboard: arrows/A D move, Space/↑/W/Z jump, X/J cutlass, C/K/Shift power, Esc/P pause. **Controllers** (USB or Bluetooth, read with the tolerant Gamepad code ported from Normie Quest: d-pad as buttons, stick or hat axis; stuck axes and headset dongles ignored): each pad action is replayed as its key (A → Space, X/B → X, Y/bumpers/triggers → C, Start/Select → Esc, d-pad → arrows), so every scene works with a pad without knowing pads exist. Press-to-bind remap from the CONTROLS panel, saved per browser; `?gpdebug=1` shows a live button readout. **Menus**: arrows / d-pad move a highlight across buttons, islands, sea tabs and crew cards (`AHOY.Nav.add` registers anything else); Enter / A presses it. Scenes that steer with the arrows set `scene.navOff`. The tap-to-whack mishaps (kraken, gulls) get a crosshair the arrows aim and Space / X / A whacks.
- **Mobile first** (owner, 2026-10-02: "keep this very mobile friendly"; Normie Quest is the controller/desktop one). Touch is the primary way to play: drawn touch buttons on the ground strip with tap zones bigger than the circles and thumb-slide between ◀ ▶; a home-screen install (`manifest.webmanifest`, `display: fullscreen`, landscape, icons in `assets/icon/`) so it opens with no browser bars, and a title-screen tip saying how; a ⛶ fullscreen button where the browser allows it (not iPhone Safari); a short vibration on jump, hit, chest and map piece where the phone allows it (Android); pinch, double-tap zoom and long-press menus blocked; the rotate prompt shows for any touch device held upright. Check phone layouts with `ahoy-shots.cjs <dir> 844 390`.
- **Adding an action**: add a row to `AHOY.CONTROLS`, a key to `ACTION_KEY` + `DEFAULT_MAP` in `input.js` if a controller should reach it, then read that key in the scene like any other key. The controller and the panel come for free.
- **Pirates**: the four from @PUMPFUNPIRATES' banner, each with a power: Ghost Sight (reveals
  ghost planks), Grapple Hook (golden rings to high ledges), X-Ray Specs (see through cracked
  walls), Sun Dash (smash cracked walls, shrug off hits). Every island is completable by every
  pirate. Powers open bonus secrets; since the double jump (2026-10-02, owner ask) the high ghost-plank and grapple-ledge chests are also reachable by a well-timed double jump, and the cracked-wall pockets still need X-Ray or Dash.
- **NFT holders** sail as their own pirate: eyewear trait → power (vr→Ghost Sight,
  patch→Grapple, 3d→X-Ray, shades→Dash, hook arm→Grapple), and **laser** eyewear adds a laser
  attack. Their NFT shows as a crest and on the HUD.
- **Boss**: Kraken's Lair, the Rug Kraken. Tentacles slam where you stand, rolled rugs come
  along the floor, 10 hits.

## Holder tiers

Seas 1–2 free · `AHOY_DECKHAND_USD` (default **$5**) of AHOY → Reef + Glacier ·
`AHOY_CAPTAIN_USD` (default **$25**) → + Deep + Uptober · any Pump Fun Pirates NFT → everything +
Captain's Cove + sail as your NFT. USD amounts are config; AHOY amounts are computed from the
live price on every `/api/ahoy/config` read. **Never hardcode an AHOY amount in copy.** These
defaults were set by the build session, not by the Pump Fun Pirates team. Agree them with them.

API (`pirates/routes.js`, read-only, no transactions):
- `GET /api/ahoy/config`: tiers + live price (GeckoTerminal/Jupiter via the server's
  `orderbook.getUsdPrice`, Jupiter lite as fallback).
- `POST /api/ahoy/challenge {wallet}`: one-line message with a single-use, 5-minute nonce.
- `POST /api/ahoy/verify {wallet, nonce, signature}`: ed25519 check, then
  `getTokenAccountsByOwner` (mint filter) + DAS `searchAssets` (collection grouping). A price
  outage returns `unavailable`, never a zero balance.

## Build and test

```
node pirates/tools/build-assets.cjs        # re-download + compress the Higgsfield art (tools/art-sources.json)
node pirates/test/ahoy-gate-test.cjs       # holder gate: real ed25519 keypair vs a fake chain (15 cases)
node pirates/test/ahoy-smoke.cjs [--shots dir] [--base url]   # headless: every scene, mishap and island; no console errors
node pirates/test/ahoy-shots.cjs <dir> [w h]     # title, every sea map, a touch level + pause (default iPad 1366x1024; 844 390 = iPhone landscape)
node pirates/tools/build-artifact.cjs <dir>      # the shareable preview (inlined scripts, Phaser from cdnjs)
```

The art came from Higgsfield (`image_auto` with their banner, map and our beach concept as style
references; sprites run through background removal). Raw downloads cache in
`pirates/tools/.cache` (gitignored).

## Its own domain (not done yet)

Same pattern as `normiequest.app` in `server.js` (search `NQ_GAME_HOSTS`): add an
`AHOY_GAME_HOSTS` list, serve `pirates/public` at `/` on those hosts, allow only the game's paths
(`/`, `/js/*`, `/assets/*`, `/vendor/*`, `/api/ahoy/(config|challenge|verify)`), add the host to the
origin-lockdown exemption, and add `/` on that host to the eval-CSP check. Pick the domain first,
then point it at Railway.

## Not verified

No session can sign with a real wallet, so the live sign-in has only been exercised with a
generated keypair against a fake chain. The first real-wallet check is the owner's.
