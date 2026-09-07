# Normie Quest — ULTRA VIP Wing (Worlds 13–21)

**Status: BUILT + TESTING-ONLY (2026-07-21).** Nine exclusive worlds for the project's biggest
supporters (grew from the original 3-world wing — see the deep dive, 2026-09-06). ⚠ **Per the
standing NORMIE strategy note (CLAUDE.md): ALL gating terms are TESTING-ONLY. No qualification
numbers, prices, or NORMIE-vs-CLKN terms may be promised on any public surface until the owner
locks them (and the NORMIE-team agreement lands).**

## The wing

| World | Name | Theme | Boss |
|---|---|---|---|
| 13 | THE WHALE POD | abyssal royal blue (theme 18) | Leviathan |
| 14 | THE BURN SHRINE | ember black-red (theme 19) | Burnlord |
| 15 | THE DIAMOND DIMENSION | glacial crystal (theme 20) | Diamond Titan |
| 16 | THE CITADEL | cyber-vault violet-steel (theme 21) | Core Sentinel |
| 17 | THE EXCHANGE SPIRE | neon bourse cyan-violet (theme 22) | Market Maker |
| 18 | THE GOLD RESERVE | institutional gold vault (theme 23) | The Chairman |
| 19 | THE ORBITAL VAULT | space-station chrome (theme 24) | Sat Warden |
| 20 | THE ASCENT / SAYLOR SUMMIT | storm-height tower (themes 25/26) | Storm Herald + Saylor |
| 21 | THE MOON | lunar finale (theme 27) | Wen Moon |

- 27 levels (worlds 13–21 × 3), `vip:true` on every def. **Every world ends in a boss fight**
  (world 20 has two: Storm Herald on 20-2, Saylor on 20-3) — dense, loot-heavy runs with extra
  caches, premium powerups (whale/megawhale/diamond/coldwallet spreads), and the **secret steel
  stashes** mechanic (previously hidden-levels-only).
- Separately, **9 grant-only hidden rooms** (WHALEGROTTO, MOONCACHE, DEADWALLET, COLDSTORAGE,
  DARKPOOL, ICEBERG, PROOFVAULT, SATSTATION, SUPERCYCLE) also carry `vip:true` — these are bonus
  rooms reached via warps, not part of the 13–21 world chain.
- Not part of the main 12-world story: 12-3 still ends the run at the RELAUNCH Win.
  The wing is entered from LEVEL SELECT (👑 gold rows) and chains 13-x → 14-x → … → 21-x, with
  travel pages between bands; clearing 21-3 shows the dedicated ULTRA VIP Win tableau.
- All public world counts (title, Win screen, leaderboard tiers) EXCLUDE the wing —
  the game still presents as 12 worlds.

## Access (how a wallet gets `vip: true`)

`nq-wallet.js` returns `vip` on verify/refresh; the client stores it in `walletState.vip`
(`window.__NQ_VIP()`), and `nqWorldAllowed` requires it for any `def.vip` level (setup lane;
lab lever `__NQ_FORCE_VIP=true` bypasses for QA).

**⚠ OWNER-ONLY LOCKDOWN (owner call 2026-07-21): VIP is ALLOWLIST-ONLY for now.**
1. **Balance threshold** — `NQ_VIP_NORMIE` / `NQ_VIP_CLKN` env vars, **default 0 = OFF**
   (so no whale tester accidentally qualifies). Set them only when terms are locked.
2. **Manual allowlist** — `/data/nq-vip.json`, managed via
   `GET /normie-quest-x7/vip?key=…[&add=PUBKEY|&remove=PUBKEY]`. This endpoint requires
   `masterOK`, which checks **`PREMIUM_ACCESS_KEY` only** (`routes.js`) — the low-trust
   `NQ_FEEDBACK_KEY` and the tester-known dashboard password deliberately do NOT work here.
   The owner adds their own wallet to grant themself access; the client-side QA lever
   (`__NQ_FORCE_VIP`) additionally requires the designer-lab flag, so plain testers can't
   console-flip it.

## 👑 The VIP Lounge (separate page)

`/normie-quest-x7/lounge` — a wallet-gated page outside the game: the owner posts giveaways,
alpha, and perk announcements for VIPs only. Sign-message auth (same session flow as the game),
feed served only to sessions whose wallet passes `isVip`. VIPs also get a "👑 VIP LOUNGE"
button on the game's world map. Owner posts via
`GET /normie-quest-x7/lounge-admin?key=REAL_KEY&title=…&body=…[&tag=giveaway|alpha|perk]`
(`&remove=<id>` deletes; bare call lists). Posts live at `/data/nq-lounge.json`.

## Qualification economy — OWNER DECISIONS PENDING

The four intended paths beyond raw holding, with the infra each would reuse:

| Path | Proposed mechanic | Infra ready to reuse | Owner must decide |
|---|---|---|---|
| **Big buys** | cumulative buys ≥ X over a window ⇒ VIP for N days | `buyersInWindowMulti` (Helius→GT→ST), buy-comp engine | X, window, duration |
| **Token locks** | lock ≥ X NORMIE/CLKN on Jupiter Lock/Streamflow ⇒ VIP while locked | `LOCKER_PROGRAMS` scan + lock attribution (Locker Room infra) | X, which token(s) |
| **Burns** | burn ≥ X ⇒ permanent VIP | `normie-burn.js` verifyBurn already exists in the NQ folder | X, permanence |
| **Pay SOL** | one-time SOL payment to a project wallet ⇒ VIP (project uses SOL as buy pressure) | unique-decimal payment verification pattern (CLKN premium rail, adapted to SOL) | price, wallet, what the SOL buys back |

Recommended sequencing: ship balance+allowlist now (done), automate **locks** first (it
feeds the Locker Room flagship story), then burns, then SOL pay, then buy-volume.

## Ops notes
- VIP status is re-read on every launch via `/api/nq/wallet/refresh` — dropping below the
  balance threshold loses access unless allowlisted (locks/burns grants would live in the
  allowlist until their automation lands).
- Never publicize the wing's existence with terms attached; "ask in the community" copy only.
