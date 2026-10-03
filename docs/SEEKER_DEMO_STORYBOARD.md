# Seeker demo video storyboard — CLOCK IN hackathon

**Status: TODO, listed in `docs/CLOCK_IN_SUBMISSION_2026.md` §8. Truth pass 2026-10-03 against
`origin/develop` @ `479f1ed1`.** This is the shot list for the demo video the owner records on his
own Seeker device — no cloud session can record it (`docs/SEEKER_APP_PLAN.md`,
`docs/SEEKER_DEVICE_TEST.md`: no container has a real wallet or a real phone). Format borrowed from
`docs/DEMO_STORYBOARD.md` (shot / screen / caption table); content is entirely new — that doc is
the Colosseum entry and Colosseum is off (AGENTS.md).

Source of truth for what the app actually does: `docs/SEEKER_APP_PLAN.md`,
`docs/SEEKER_TOOLS_BUILD.md`, `docs/SEEKER_DEMO_INVENTORY.md`, `docs/SEEKER_SWAP_DESIGN.md`,
`docs/SEEKER_DEVICE_TEST.md`, and the seven screenshots in the wrapper repo
(`clucknorrisapp/CLKN-SEEKER`, branch `claude/seeker-integration`,
`dapp-store/screenshots-seeker/01-home.png` … `07-rent-reclaim.png`; named in
`dapp-store/config.seeker.yaml`). Those seven are **Playwright captures of a statically served
build against the live read-only APIs — not device screenshots, and none shows a wallet, a
signature, the swap or the revoke.** Reference them by that path; do not copy them into this repo.
The order below follows AGENTS.md's flagship list — *"the school, the LP lab, the airdropper, the
locker room, the fire pit, project burn"* — the school leads. (The LP Lab is course content inside
the school: it is the "Liquidity & LP Mastery" course.)

---

## 0. Before you hit record — two gates

1. **The app calls production, and the swap is not on production.** The app's API base is
   `https://clucknorris.app`, which serves `main`. The swap (PR #420, merged to `develop`
   2026-09-29) is on `develop` only: on 2026-10-03 `GET https://clucknorris.app/api/seeker/swap/config`
   answered `{"success":false,"error":"not_found"}`. **Shot 8 is conditional on the owner promoting
   `develop` to `main`** (his explicit go, in the moment — AGENTS.md) **and** on this returning
   `ok:true`:
   `curl -s https://clucknorris.app/api/seeker/swap/config`. If it does not, cut shot 8 entirely;
   do not describe a swap that production cannot serve. The same promotion carries everything else
   that is `develop`-only (Revoke, the ten-language picker, the five new safety lessons) — see
   `docs/CLOCK_IN_SUBMISSION_2026.md` §8. Revoke (shot 6) works against production today, because
   it signs and reads through endpoints production already has.
2. **Which APK.** A dev APK is built by the wrapper repo's `android-build.yml`, job
   `seeker-dev-apk` (debug, appId `app.clucknorris.seeker.dev`, frontend built from `develop`).
   A release APK needs a pinned `store-seeker-v*` release, and none exists yet. Record on whichever
   build the owner actually installs; the lesson count and the language list below describe the
   `develop` build (production's school still has 58 lessons and seven languages).

---

## 1. The 90-second cut

Record in portrait, on the Seeker, screen-recorded on-device (see §3). Every caption is a factual
statement, never a promise — no yield, no return, no guarantee, no price or dollar claim (AGENTS.md's
"Earn" rule).

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 1 | 0:00–0:07 | `/school` (school home) | Open the app. It lands on the school, not the tools grid. Let the "x / 64" progress card read. | "The School of Crypto Hard Knocks — free, no wallet, no signup." |
| 2 | 0:07–0:19 | `/school/:courseId/:lessonId` (a lesson) | Open one lesson from The Incubator, step through a screen or two, then tap the language pill and switch to Español — the same lesson re-renders. | "64 lessons, bundled on the phone — in ten languages." |
| 3 | 0:19–0:28 | `/ask` (Ask Cluck) | Type a real beginner question ("what is a seed phrase"), get an answer. | "Ask Cluck — the AI tutor, same one on the website." |
| 4 | 0:28–0:35 | `/tools` (Toolkit grid) | Open the tab; the "Start here" group (Firepit, Locker Room, Project Burn, Airdropper) is on screen, scroll once. | "The tools, built for this phone." |
| 5 | 0:35–1:00 | `/rent` (Rent Reclaim) | Tap Rent Reclaim → **Connect Wallet** → the MWA sheet opens (wallet app switches to foreground) → approve the connection → the scan lists closable accounts → tap one → the wallet's confirm sheet names the exact SOL amount → approve → back in the app, the result (landed / failed / unconfirmed) and an explorer link. | "Get your own SOL back — signed on your phone with Mobile Wallet Adapter." |
| 6 | 1:00–1:15 | `/checkup` (Wallet Checkup, wallet already connected from shot 5) | The checkup scans the connected wallet. On the approvals list, tap **Revoke this approval** → the confirm sheet lists exactly the accounts → approve in the wallet → the app re-reads the chain and shows the per-account answer. | "Wallet Checkup — see who can move your tokens, then revoke it. Signed on your phone." |
| 7 | 1:15–1:25 | Tools pass sheet (opened from X-Ray or Holders with a wallet under both doors) | Run a pass-gated tool with a wallet that doesn't qualify; the pass sheet opens instead of a result, showing the CLKN amount, the SKR amount, and the SOL price/day terms — all live numbers. | "One tools pass — hold CLKN or SKR, or pay once in SOL. Terms shown live, never fixed in the app." |
| 8 | 1:25–1:40 | **CONDITIONAL on the owner promoting `develop` → `main`** (§0 gate 1) — `/tools/swap`, reached from the pass sheet's "Swap for SKR in this app" link or the grid | Pick SOL → SKR and an amount, get a quote; the card shows the rate, the minimum received and the price impact; tap Review swap → the confirm sheet → the wallet signs → landed, with a Solscan link. | "Swap SOL, SKR, CLKN or USDC without leaving the app — rate, minimum received and price impact shown before you sign." — **cut this shot entirely if production still returns `not_found` for the swap; do not describe a swap that isn't live.** |

Total with shot 8: ~100 s; without it, ~85 s. To land at 90 with the swap, drop shot 7 (the pass
sheet is the only shot with nothing to sign) or take 3 s off each of shots 2 and 3. The swap shot is
the only one where the wallet signs a transaction the app did not build locally — it receives it
from the server and checks it before showing the wallet (`src/seeker/swap-verify.js`, then the
pre-sign simulation, `src/seeker/swap-simulate.js`); that is a one-line voice-over if there is
room, not a caption.

### Shot 5 detail — what must actually be visible

This is the one Solana Mobile Stack moment judges will scrutinize. The recording must show, in
order and legibly:
1. The app's own "Connect Wallet" tap.
2. The **MWA sheet** — the OS-level wallet-picker / handoff to the wallet app (not an in-app modal).
3. The wallet app's own **connection approval** screen, then control returning to Cluck Norris.
4. The Rent Reclaim scan result (closable accounts + SOL amounts).
5. Tapping "close" on one account → the wallet's own **confirm sheet naming the exact SOL amount**
   (this is the number the app told you first — it must match).
6. The wallet's approval, control returning to the app.
7. The app's own outcome text (landed / failed / unconfirmed — `docs/SEEKER_DEVICE_TEST.md` step 12)
   and an **explorer link** the owner taps to show the transaction on-chain in a browser.

If step 2 or 5 cannot be captured cleanly in one take, retake the whole shot rather than cutting
around it — the MWA sheet and the wallet's own confirm sheet are the proof this isn't a mocked flow.

### Shot 6 detail — the Revoke setup

The Revoke control appears only when the scanned address **is** the connected wallet (it does not
show on a pasted address) and only when the scan finds a token account with an open delegate
approval (`src/seeker/CheckupRevoke.jsx`). So the demo wallet needs one such account **before**
recording — set it up on the demo wallet ahead of time; if the checkup finds none, the Revoke
control is simply not there, and the honest fallback is to film the scan-only checkup and skip the
revoke, not to fake an approval. The confirm sheet says the revoke costs a network fee and nothing
else, and the result is the app's own re-read of each account (cleared / still approved / couldn't
read) — film that line, it is the point of the shot.

---

## 2. The 3-minute extended cut

Same opening (shots 1–8 above, ~1:40 with the swap; if shot 8 is cut, everything below moves up
15 s), then add:

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 9 | 1:40–1:55 | `/tools/firepit` (Firepit) | Show the three sections: reclaim rent from empty accounts, reclaim surplus rent (accounts stay open), burn tokens. Select one item; the confirm sheet's button names its job. Complete one. | "Firepit — reclaim the rent in empty accounts, or burn worthless tokens. Every token is priced first." |
| 10 | 1:55–2:10 | `/tools/lock` (Locker Room) | Preview a lock; if completing it, show the wallet as the first signer, then the ephemeral escrow key. | "Locker Room — lock tokens on Jupiter Lock, non-custodially, with public proof." |
| 11 | 2:10–2:20 | `/tools/burn` (Project Burn) | Preview only (burning supply is real) — show the fee/consequence text before any signature. | "Project Burn — a verifiable on-chain burn receipt." |
| 12 | 2:20–2:30 | School home, language pill open | Open the language pill and let the full list show, then pick one. | "Ten languages: English, Spanish, Hindi, Italian, Portuguese, Vietnamese, Chinese, Korean, Turkish, Indonesian." |
| 13 | 2:30–2:42 | A lesson, airplane mode | Turn on airplane mode, open a second, not-yet-opened lesson — it renders with no network. | "The school works with no signal — it's already on the phone." |
| 14 | 2:42–2:50 | `/tools/alpha` (Daily) with airplane mode still on | Open the Daily — it says it's offline rather than showing stale numbers. | "Every tool says so, honestly, when it can't reach the network." |
| 15 | 2:50–3:00 | `/checkup` → "Disconnect & clean up" card, airplane mode off | Scroll to the card, tap the disconnect button; the card confirms and shows the "still to do in your wallet app" steps. | "Disconnect & clean up — clears this phone's pass and sign-in, and says where your wallet keeps the rest." |

End on: school home, wallet disconnected, Cluck Norris wordmark. No slogan overlay beyond what
the app itself already renders.

---

## 3. Recording notes

- **Device:** the owner's own Seeker, screen-recorded with the built-in Android screen recorder
  (no third-party capture app needed; portrait orientation throughout — do not rotate for any
  shot).
- **Wallet:** use a **demo wallet** holding only what each shot needs (a little SOL for fees, one
  junk token for Firepit, a token account with an open delegate approval for shot 6, an amount of
  CLKN or SKR near a pass-door threshold if shot 7 needs to show the sheet, and a small SOL balance
  to swap if shot 8 is in). **Never show a wallet's real overall balance beyond what a shot
  requires** — no portfolio screen, no full holdings list from the wallet app itself.
- **Blur or crop out:** the wallet app's own balance/portfolio screens beyond the single approval
  sheet needed, any real personal address if it isn't the demo wallet, notification shade content
  if it appears when the OS switches apps for MWA.
- **Retake, don't patch:** if the MWA sheet (shot 5, step 2) or a confirm sheet doesn't render
  cleanly, redo the whole shot from "Connect Wallet" rather than splicing — a cut mid-approval
  reads as staged.
- **Live data only.** No mocked API responses, no `--offline` demo fixtures (that convention is
  the Hub/Colosseum material in `docs/DEMO_STORYBOARD.md`; this app has no dry-run mode — every
  screen here calls the real, running `clucknorris.app` backend).
- **Pass-sheet shot (7):** if the demo wallet already qualifies through CLKN or SKR by recording
  day, either top down a second demo wallet below both doors, or capture the sheet earlier and
  splice in cleanly (this one exception to "don't patch" is fine — it's an empty-state screen, not
  a signature).
- **Wallet-flow honesty:** no step-by-step device run of the wallet flows is recorded anywhere in
  the repo (the owner's own 2026-09-21 statement that connect and signing work is in
  `docs/SEEKER_TOOLS_BUILD.md`; nothing is recorded for the swap, revoke or surplus reclaim). If a
  signing shot does not work on the day, that is a finding to report, not a shot to fake.

---

## 4. Claims checklist — every caption must be true in the code on `develop`

| Caption / claim | Backed by |
|---|---|
| "Free, no wallet, no signup" (school) | `src/seeker/edition/full.jsx` + `edu.jsx` route tables, `docs/SEEKER_DEMO_INVENTORY.md` §1–2 (`/school` needs no wallet in either edition) |
| "64 lessons, bundled on the phone" | `data/curriculum.json` — 64 lessons / 4 courses / 235 questions, `node scripts/extract-curriculum.js --check` passes against `src/App.jsx` `LESSONS` (21) + `INCUBATOR_LESSONS` (7) + `src/sections/LPLab.jsx` `LP_LESSONS` (15) + 21 Library pieces; the app's progress card shows `TOTAL_LESSONS` from `src/seeker/school/curriculum.js`; "works offline" in `docs/SEEKER_DEMO_INVENTORY.md` §1. **Production still bundles 58** — the caption is true for a `develop` build only (58 → 63 in #459, → 64 in #464) |
| "in ten languages" / "Ten languages: …" | `public/i18n.js` `LANGS` (10 entries: en zh es it pt vi hi ko tr id); the Seeker bundle has no `excludeLangs` (`store-edition/seeker-edition.json`), confirmed by building it: 10 picker entries, 18 dictionary files; all 1,291 app strings present in all nine dictionaries (`scripts/seeker-i18n-keys.cjs`; `scripts/seeker-build-test.cjs` §f). PR #462. The Play/iOS bundles stay at seven — do not use this caption on a store-edition recording |
| "Ask Cluck — the AI tutor" | `docs/CLOCK_IN_SUBMISSION_2026.md` §5; `/ask` is a bottom tab in both editions. Do not say it sits inside lessons — it does not. For Italian the server adds no reply-language instruction (`AI_LANGS`, `server.js:155` has no `it`), so do not demo Ask Cluck in Italian |
| "The tools, built for this phone" / "Start here" group | `src/seeker/tools/registry.js` (`flagship: true` on firepit, lock, burn, airdrop), `src/seeker/ToolsHome.jsx` ("Start here") |
| "Get your own SOL back — signed on your phone with MWA" | `src/seeker/reclaim-sign.js` `runFullReclaim()`; `docs/SEEKER_DEVICE_TEST.md` step 12; `docs/SEEKER_APP_PLAN.md` §4's money-path rule ("the client builds and signs, the server never signs for a user") |
| "Wallet Checkup — see who can move your tokens, then revoke it" | PR #458 (`src/seeker/CheckupRevoke.jsx`, `src/seeker/revoke.js`, `scripts/seeker-revoke-test.cjs` 87 checks passing); the sheet text "Each delegate below loses the ability to move that token out of your wallet. This costs a network fee and nothing else — your tokens stay where they are."; result re-read from chain; round-2 fixes in #473. **develop only; client-side, works against production** |
| "paste any address, free" (if shown) | PR #397 ("Wallet Checkup takes any pasted address in the full edition too"); `docs/SEEKER_DEVICE_TEST.md` step 11. Revoke is not offered on a pasted address |
| "One tools pass — hold CLKN or SKR, or pay once in SOL. Terms shown live" | `/api/tool-gate/config` (served `skr` block confirmed live 2026-10-03), `lib/tool-pass-qualify.js`, `scripts/tool-pass-qualify-test.cjs`, `src/seeker/passgate.jsx`; AGENTS.md's tools-pass section — never state a dollar figure in the caption, only that it renders live |
| "Swap SOL, SKR, CLKN or USDC without leaving the app — rate, minimum received and price impact shown before you sign" (shot 8, conditional) | Registry blurb in `src/seeker/tools/registry.js`; `src/seeker/tools/Swap.jsx`; `server.js` `/api/seeker/swap/{config,quote,tx}`; `docs/SEEKER_SWAP_DESIGN.md`; PR #420 merge `ec977c0f` on `develop` (2026-09-29). **Usable only once production serves it** — verify with `curl -s https://clucknorris.app/api/seeker/swap/config` returning `ok:true` before cutting the video; on 2026-10-03 it returned `not_found` |
| "Firepit — reclaim the rent in empty accounts, or burn worthless tokens. Every token is priced first" | `src/seeker/tools/Firepit.jsx` (three sections: "Reclaim rent — empty accounts", "Reclaim surplus rent — keep accounts open", "Burn tokens — and reclaim rent too"; buttons "Reclaim rent" / "Reclaim surplus" / red "Burn"); PRs #443, #471 (on production as #457, #472, #474, #475); `src/seeker/sign.js` `signSendConfirm()`; `docs/SEEKER_DEVICE_TEST.md` step 13 |
| "Locker Room — lock tokens on Jupiter Lock, non-custodially, with public proof" | `src/seeker/tools/LockerRoom.jsx`; AGENTS.md's two-signer rule (connected wallet signs first, then the ephemeral escrow key) |
| "Project Burn — a verifiable on-chain burn receipt" | `src/seeker/tools/ProjectBurn.jsx`, `src/seeker/sign.js` `signSendConfirm()` |
| "The school works with no signal" | `docs/SEEKER_DEMO_INVENTORY.md` §1 ("works offline: yes — curriculum is bundled"); `docs/SEEKER_DEVICE_TEST.md` step 5 |
| "Every tool says so, honestly, when it can't reach the network" | PR #396, `src/seeker/pane.jsx` `useOnline()`/`toolFetch()`; `docs/SEEKER_DEVICE_TEST.md` steps 8, 22 |
| "Disconnect & clean up — clears this phone's pass and sign-in, and says where your wallet keeps the rest" | `src/seeker/Disconnect.jsx` (calls the wallet's own `disconnect()`, clears the tools pass and the Airdropper's receipt sign-in; "Nothing here can see or remove connections stored inside your wallet app — only the wallet can."); PR #458; develop only |

**Before recording, re-run `docs/SEEKER_DEVICE_TEST.md` once end to end — but know that it is
stale in places.** It was written 2026-09-22, before the swap, Revoke, the Disconnect card,
surplus reclaim and the ten-language picker, so none of those has a step. Step 6 also lists the
grid's flagship order as "Rent Reclaim, Airdropper, Locker Room, Firepit, Project Burn"; the grid
today leads with a "Start here" group of Firepit, Locker Room, Project Burn, Airdropper (Rent
Reclaim is not flagged). Walk shots 6, 8 and 9 by hand from this storyboard instead. Do the
wrapper's 10-step MWA checklist (`docs/MWA_PLUGIN.md` on the wrapper's `claude/seeker-integration`
branch) first, as that doc says.

---

## 5. What NOT to show or say

- **Buy Special / Buy comp** — not in the app at all (owner, 2026-09-22; PRs #401/#402). Don't
  film it, don't mention it, don't let a stale bookmark land on it mid-recording.
- **Wallet Watch** — private, no public surface, ever (AGENTS.md). Never appears in this app
  anyway; just don't narrate anything that implies it exists.
- **Normie Quest reward/prize terms** — unagreed with the NORMIE team. If Normie Quest is shown at
  all (it isn't in this app's route tables per `docs/SEEKER_DEMO_INVENTORY.md` §5), never state a
  reward figure.
- **Colosseum** — off entirely (owner, 2026-09-21). No mention, no "we also entered…" aside.
- **Perpetuals / leveraged trading / derivatives** — none exist in this app or on the platform;
  don't imply otherwise even as a "coming soon."
- **An Apple Watch app** — not part of this entry (`docs/IOS_NATIVE_APP_PLAN.md` is explicitly
  post-Seeker-submission).
- **Seed Vault integration** — there is none. The Solana Room's Seeker wing has a *reading page*
  about Seed Vault; do not narrate it as a feature of the app.
- **Paying the tools pass in SKR** — design only (PR #421, open, no code). Don't film it, don't
  say "pay in SKR"; the SKR door is *holding* SKR.
- **The swap as live, before it is** — see §0. And never frame it as buying a token to hold: the
  pane says "Swap", never "Buy CLKN", and nothing in the video may speak to where a price is going.
- **Any guaranteed return, yield figure, or "investment" language** — "Earn potential" describes
  capability only, never a promise (AGENTS.md's Educate → Build → Earn section). Do not say
  "you'll earn," "guaranteed," or quote an APR/APY anywhere in narration or captions.
- **A dollar or token amount for the tools-pass doors as a fixed number** — say "shown live in the
  app," never a fixed "$"-denominated figure for CLKN or SKR as if those numbers are permanent
  (they're env-config and can change).
- **The website's diploma cNFT as something this app claims** — the Seeker school explicitly says
  "the diploma is claimed on clucknorris.app" (visible in `01-home.png`'s progress card); don't
  narrate as if the app itself mints it.
