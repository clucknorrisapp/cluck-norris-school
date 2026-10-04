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

## 0. Before you hit record — two gates (both OPEN as of 2026-10-04)

1. **Production carries everything.** `develop` was promoted to `main` on the owner's go on
   2026-10-04 (PR #482, merge `1e4b7ac5`, then #484 `3bba62b1`); `GET https://clucknorris.app/api/seeker/swap/config`
   and `GET …/api/tool-gate/skr-quote?wallet=<addr>` both answer on production (checked 15:11 UTC).
   So the swap, the SKR-paid pass, Revoke, the ten languages and the 64 lessons are all live. If a
   later check ever finds `not_found` again, cut the affected shot — never describe a thing
   production cannot serve.
2. **Which APK.** Record on the **release APK** the Mac builds from the pinned
   `store-seeker-v1.0.2` bundle with `npm run build:seeker-update` (package
   `app.clucknorris.school`, versionCode 10 / 2.0.0, signed with the original listing's key —
   wrapper `docs/CLOCK_IN_MAC_RUNBOOK.md` §2.0). Not the `.seeker.dev` debug build: its bundle may
   be a different commit from what ships. The bottom bar on that build is **School · Toolkit ·
   Daily · Swap · Ask** (owner, 2026-10-04: the bar is for places you go every day).

---

## 1. The 90-second cut

Record in portrait, on the Seeker, screen-recorded on-device (see §3). Every caption is a factual
statement, never a promise — no yield, no return, no guarantee, no price or dollar claim (AGENTS.md's
"Earn" rule). **The school leads and the swap is the Solana Mobile moment** (owner, 2026-10-04:
"Rent reclaim sure as heck shouldn't be a focus … the school is the focus … connect your wallet
and buy Seeker or buy Cluck, those are focus"). Rent Reclaim is in the extended cut only.

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 1 | 0:00–0:07 | `/school` (school home) | Open the app. It lands on the school, not the tools grid. Let the "x / 64" progress card read; the bar shows School · Toolkit · Daily · Swap · Ask. | "The School of Crypto Hard Knocks — free, no wallet, no signup." |
| 2 | 0:07–0:18 | `/school/:courseId/:lessonId` (a lesson) | Open one lesson from The Incubator, step through a screen or two, then tap the language pill and switch to Español — the same lesson re-renders. | "64 lessons, bundled on the phone — in ten languages." |
| 3 | 0:18–0:26 | `/ask` (Ask Cluck tab) | Type a real beginner question ("what is a seed phrase"), get an answer. | "Ask Cluck — the AI tutor, same one on the website." |
| 4 | 0:26–0:32 | `/tools` (Toolkit tab) | Open the tab; the "Start here" group (Firepit, Locker Room, Project Burn, Airdropper) is on screen, scroll once. | "The tools, built for this phone." |
| 5 | 0:32–0:57 | `/tools/swap` (Swap tab) | **Connect Wallet** → the MWA sheet opens (wallet app comes to the foreground) → approve the connection → back in the app, pick SOL → SKR and a small amount → the quote card shows the rate, the minimum received and the price impact → tap Review swap → the app's confirm sheet → the wallet's own confirm sheet → approve → landed, with the Solscan link. | "Swap SOL, SKR, CLKN or USDC without leaving the app — signed on your phone with Mobile Wallet Adapter. Rate, minimum received and price impact shown before you sign." |
| 6 | 0:57–1:12 | Tools pass sheet → pay in SKR (open Wallet X-Ray or Holders with a wallet that holds a little SKR but is under both doors) | The pass sheet opens instead of a result, showing the CLKN door, the SKR door and the SKR price for seven days — all live numbers. Tap **Pay in SKR** → the wallet's confirm sheet names the SKR amount → approve → the sheet reports the pass granted and its expiry, and the tool runs. | "One tools pass — hold CLKN or SKR, or pay once, in SOL or in SKR. Terms shown live, never fixed in the app." |
| 7 | 1:12–1:25 | `/checkup` (from the Toolkit, wallet already connected) | The checkup scans the connected wallet. On the approvals list, tap **Revoke this approval** → the confirm sheet lists exactly the accounts → approve in the wallet → the app re-reads the chain and shows the per-account answer. | "Wallet Checkup — see who can move your tokens, then revoke it. Signed on your phone." |
| 8 | 1:25–1:30 | `/tools/alpha` (Daily tab) | Open the Daily: today's lesson, the one question, where the majors closed. | "The Daily — something to open every day." |

Total ~90 s. If it runs long, trim shots 2 and 3 by 2–3 s each; never trim shot 5 — it is the one
Solana Mobile Stack moment, and the only shot where the wallet signs a transaction the app did not
build locally (it receives it from the server and checks it first: `src/seeker/swap-verify.js`,
then the pre-sign simulation, `src/seeker/swap-simulate.js` — a one-line voice-over if there is
room, not a caption).

### Shot 5 detail — what must actually be visible

This is the one Solana Mobile Stack moment judges will scrutinize. The recording must show, in
order and legibly:
1. The app's own "Connect Wallet" tap.
2. The **MWA sheet** — the OS-level wallet-picker / handoff to the wallet app (not an in-app modal).
3. The wallet app's own **connection approval** screen, then control returning to Cluck Norris.
4. The quote card: rate, minimum received, price impact, with the amount typed.
5. The app's confirm sheet, then the wallet's own **confirm sheet** — the SOL out and the SKR in
   must be the figures the app showed first.
6. The wallet's approval, control returning to the app.
7. The app's own outcome text (landed / failed / unconfirmed) and the **Solscan link** the owner
   taps to show the transaction on-chain in a browser.

If step 2 or 5 cannot be captured cleanly in one take, retake the whole shot rather than cutting
around it — the MWA sheet and the wallet's own confirm sheet are the proof this isn't a mocked flow.

### Shot 6 detail — the SKR-paid pass (#421, on production since 2026-10-04)

The sheet quotes a server-signed SKR amount (`GET /api/tool-gate/skr-quote`, ten-minute validity)
for the dollar figure the config serves — **never say the figure**, let the screen show it. The
wallet's confirm sheet must show an SKR transfer of exactly that amount to the receiver. After
approval the sheet says the pass is granted and until when; that line is the point of the shot.
If the demo wallet already qualifies through CLKN or SKR holdings, use a second wallet below both
doors (see §3). A quote that fails to load is a 503 the sheet reports honestly — if that happens on
the day, wait a minute and retry; the server needs three price ticks after a cold deploy.

### Shot 7 detail — the Revoke setup

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

Same opening (shots 1–8 above, ~1:30), then add:

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 9 | 1:30–1:50 | `/rent` (Rent Reclaim, from the Toolkit) | The scan lists closable accounts and the SOL each returns → tap one → the wallet's confirm sheet names the exact SOL amount → approve → the result (landed / failed / unconfirmed) and an explorer link. | "Get your own SOL back — dead token accounts are holding it. We charge nothing." |
| 10 | 1:50–2:05 | `/tools/firepit` (Firepit) | Show the three sections: reclaim rent from empty accounts, reclaim surplus rent (accounts stay open), burn tokens. Select one item; the confirm sheet's button names its job. Complete one. | "Firepit — reclaim the rent in empty accounts, or burn worthless tokens. Every token is priced first." |
| 11 | 2:05–2:18 | `/tools/lock` (Locker Room) | Preview a lock; if completing it, show the wallet as the first signer, then the ephemeral escrow key. | "Locker Room — lock tokens on Jupiter Lock, non-custodially, with public proof." |
| 12 | 2:18–2:26 | `/tools/burn` (Project Burn) | Preview only (burning supply is real) — show the fee/consequence text before any signature. | "Project Burn — a verifiable on-chain burn receipt." |
| 13 | 2:26–2:34 | School home, language pill open | Open the language pill and let the full list show, then pick one. | "Ten languages: English, Spanish, Hindi, Italian, Portuguese, Vietnamese, Chinese, Korean, Turkish, Indonesian." |
| 14 | 2:34–2:44 | A lesson, airplane mode | Turn on airplane mode, open a second, not-yet-opened lesson — it renders with no network. | "The school works with no signal — it's already on the phone." |
| 15 | 2:44–2:52 | `/tools/alpha` (Daily) with airplane mode still on | Open the Daily — it says it's offline rather than showing stale numbers. | "Every tool says so, honestly, when it can't reach the network." |
| 16 | 2:52–3:00 | `/checkup` → "Disconnect & clean up" card, airplane mode off | Scroll to the card, tap the disconnect button; the card confirms and shows the "still to do in your wallet app" steps. | "Disconnect & clean up — clears this phone's pass and sign-in, and says where your wallet keeps the rest." |

End on: school home, wallet disconnected, Cluck Norris wordmark. No slogan overlay beyond what
the app itself already renders.

---

## 3. Recording notes

- **Device:** the owner's own Seeker, screen-recorded with the built-in Android screen recorder
  (no third-party capture app needed; portrait orientation throughout — do not rotate for any
  shot).
- **Wallet:** use a **demo wallet** holding only what each shot needs (a little SOL for fees, one
  junk token for Firepit, a token account with an open delegate approval for shot 7, a little SKR but less than either
  door for shot 6, and a small SOL balance to swap for shot 5). **Never show a wallet's real overall balance beyond what a shot
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
- **Pass-sheet shot (6):** if the demo wallet already qualifies through CLKN or SKR by recording
  day, use a second demo wallet below both doors that holds a little SKR — this shot now ends in a
  signature (the SKR payment), so it is recorded in one take like the others.
- **Wallet-flow honesty:** no step-by-step device run of the wallet flows is recorded anywhere in
  the repo (the owner's own 2026-09-21 statement that connect and signing work is in
  `docs/SEEKER_TOOLS_BUILD.md`; nothing is recorded for the swap, the SKR-paid pass, revoke or surplus reclaim — the
  2026-10-04 device session is the first). If a signing shot does not work on the day, that is a
  finding to report, not a shot to fake.

---

## 4. Claims checklist — every caption must be true in the code on `main` (= production since 2026-10-04)

| Caption / claim | Backed by |
|---|---|
| "Free, no wallet, no signup" (school) | `src/seeker/edition/full.jsx` + `edu.jsx` route tables, `docs/SEEKER_DEMO_INVENTORY.md` §1–2 (`/school` needs no wallet in either edition) |
| "64 lessons, bundled on the phone" | `data/curriculum.json` — 64 lessons / 4 courses / 235 questions, `node scripts/extract-curriculum.js --check` passes against `src/App.jsx` `LESSONS` (21) + `INCUBATOR_LESSONS` (7) + `src/sections/LPLab.jsx` `LP_LESSONS` (15) + 21 Library pieces; the app's progress card shows `TOTAL_LESSONS` from `src/seeker/school/curriculum.js`; "works offline" in `docs/SEEKER_DEMO_INVENTORY.md` §1. **On production since the 2026-10-04 promotion** (58 → 63 in #459, → 64 in #464) |
| "in ten languages" / "Ten languages: …" | `public/i18n.js` `LANGS` (10 entries: en zh es it pt vi hi ko tr id); the Seeker bundle has no `excludeLangs` (`store-edition/seeker-edition.json`), confirmed by building it: 10 picker entries, 18 dictionary files; all 1,291 app strings present in all nine dictionaries (`scripts/seeker-i18n-keys.cjs`; `scripts/seeker-build-test.cjs` §f). PR #462. The Play/iOS bundles stay at seven — do not use this caption on a store-edition recording |
| "Ask Cluck — the AI tutor" | `docs/CLOCK_IN_SUBMISSION_2026.md` §5; `/ask` is a bottom tab in both editions. Do not say it sits inside lessons — it does not. For Italian the server adds no reply-language instruction (`AI_LANGS`, `server.js:155` has no `it`), so do not demo Ask Cluck in Italian |
| "The tools, built for this phone" / "Start here" group | `src/seeker/tools/registry.js` (`flagship: true` on firepit, lock, burn, airdrop), `src/seeker/ToolsHome.jsx` ("Start here") |
| "Get your own SOL back — signed on your phone with MWA" | `src/seeker/reclaim-sign.js` `runFullReclaim()`; `docs/SEEKER_DEVICE_TEST.md` step 12; `docs/SEEKER_APP_PLAN.md` §4's money-path rule ("the client builds and signs, the server never signs for a user") |
| "Wallet Checkup — see who can move your tokens, then revoke it" | PR #458 (`src/seeker/CheckupRevoke.jsx`, `src/seeker/revoke.js`, `scripts/seeker-revoke-test.cjs` 87 checks passing); the sheet text "Each delegate below loses the ability to move that token out of your wallet. This costs a network fee and nothing else — your tokens stay where they are."; result re-read from chain; round-2 fixes in #473. **develop only; client-side, works against production** |
| "paste any address, free" (if shown) | PR #397 ("Wallet Checkup takes any pasted address in the full edition too"); `docs/SEEKER_DEVICE_TEST.md` step 11. Revoke is not offered on a pasted address |
| "Terms shown live, never fixed in the app" | `/api/tool-gate/config` (served `skr` block confirmed live 2026-10-03), `lib/tool-pass-qualify.js`, `scripts/tool-pass-qualify-test.cjs`, `src/seeker/passgate.jsx`; AGENTS.md's tools-pass section — never state a dollar figure in the caption, only that it renders live |
| "Swap SOL, SKR, CLKN or USDC without leaving the app — signed on your phone with MWA. Rate, minimum received and price impact shown before you sign" (shot 5) | Registry blurb in `src/seeker/tools/registry.js`; `src/seeker/tools/Swap.jsx` (the Swap tab since 1.0.2); `server.js` `/api/seeker/swap/{config,quote,tx}`; `docs/SEEKER_SWAP_DESIGN.md`; PR #420, on production since 2026-10-04 (`/api/seeker/swap/config` answers). The attempt record written before the wallet is asked (#479) is why a lost reply never unlocks the form |
| "One tools pass — hold CLKN or SKR, or pay once, in SOL or in SKR" (shot 6) | #421 (`lib/tool-pass-skr.js`, `src/seeker/skr-pay.js`, `src/seeker/passgate.jsx`; `GET /api/tool-gate/skr-quote` answered a signed quote on production 2026-10-04 15:11 UTC; `scripts/tool-pass-skr-test.cjs`, `scripts/seeker-skr-pay-test.cjs` 129 checks). Never state the dollar or SKR figure — the sheet renders it live |
| "The Daily — something to open every day" (shot 8) | `src/seeker/tools/DailyBrief.jsx`, a bottom tab in both editions since 1.0.2 (`src/seeker/edition/full.jsx` TABS) |
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
