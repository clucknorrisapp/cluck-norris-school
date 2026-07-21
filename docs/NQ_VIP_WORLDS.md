# Normie Quest — ULTRA VIP Wing (Worlds 13–15)

**Status: BUILT + TESTING-ONLY (2026-07-21).** Three exclusive worlds for the project's biggest
supporters. ⚠ **Per the standing NORMIE strategy note (CLAUDE.md): ALL gating terms are
TESTING-ONLY. No qualification numbers, prices, or NORMIE-vs-CLKN terms may be promised on any
public surface until the owner locks them (and the NORMIE-team agreement lands).**

## The wing

| World | Name | Theme | Signature hazards |
|---|---|---|---|
| 13 | THE WHALE POD | abyssal royal blue (theme 18) | priority gates, MEV scanners |
| 14 | THE BURN SHRINE | ember black-red (theme 19) | dump zones, scanners |
| 15 | THE DIAMOND DIMENSION | glacial crystal (theme 20) | rug platforms, scanners |

- 9 levels (idx 43–51), `vip:true` on every def. No bosses — dense, loot-heavy runs:
  extra caches, premium powerups (whale/megawhale/diamond/coldwallet spreads), and the
  **secret steel stashes** mechanic is live here (previously hidden-levels-only).
- Not part of the main 12-world story: 12-3 still ends the run at the RELAUNCH Win.
  The wing is entered from LEVEL SELECT (👑 gold rows). 13-x → 14-x → 15-x chain
  naturally with their own travel pages (BURN / DIAMOND HANDS term cards); clearing
  15-3 shows the dedicated ULTRA VIP Win tableau.
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
   `GET /normie-quest-x7/vip?key=…[&add=PUBKEY|&remove=PUBKEY]`. This endpoint requires the
   REAL admin key (`NQ_FEEDBACK_KEY` or `PREMIUM_ACCESS_KEY`) — the tester-known dashboard
   password deliberately does NOT work here. The owner adds their own wallet to grant
   themself access; the client-side QA lever (`__NQ_FORCE_VIP`) additionally requires the
   designer-lab flag, so plain testers can't console-flip it.

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
