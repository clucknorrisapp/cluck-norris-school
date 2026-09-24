# Seeker demo video storyboard — CLOCK IN hackathon

**Status: TODO, listed in `docs/CLOCK_IN_SUBMISSION_2026.md` §8.** This is the shot list for the
demo video the owner records on his own Seeker device — no cloud session can record it
(`docs/SEEKER_APP_PLAN.md`, `docs/SEEKER_DEVICE_TEST.md`: no container has a real wallet or a real
phone). Format borrowed from `docs/DEMO_STORYBOARD.md` (shot / screen / caption table); content is
entirely new — that doc is the Colosseum entry and Colosseum is off (AGENTS.md).

Source of truth for what the app actually does: `docs/SEEKER_APP_PLAN.md`,
`docs/SEEKER_TOOLS_BUILD.md`, `docs/SEEKER_DEMO_INVENTORY.md`, `docs/SEEKER_DEVICE_TEST.md`, and
the seven real screenshots already captured from a live build in the wrapper repo
(`clkn-seeker`, branch `claude/seeker-integration`,
`dapp-store/screenshots-seeker/01-home.png` … `07-rent-reclaim.png`; named in
`dapp-store/config.seeker.yaml`). Reference those PNGs by that path — do not copy them into this
repo. The order below follows AGENTS.md's flagship list: *"the school, the LP lab, the
airdropper, the locker room, the fire pit, project burn"* — the school leads.

---

## 1. The 90-second cut

Record in portrait, on the Seeker, screen-recorded on-device (see §3). Every caption is a factual
statement, never a promise — no yield, no return, no guarantee (AGENTS.md's "Earn" rule).

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 1 | 0:00–0:10 | `/school` (school home) | Open the app. It lands on the school, not the tools grid. | "The School of Crypto Hard Knocks — free, no wallet, no signup." |
| 2 | 0:10–0:25 | `/school/:courseId/:lessonId` (a lesson) | Tap into The Incubator, open one lesson, scroll it, mark it done. | "58 lessons, bundled on the phone." |
| 3 | 0:25–0:38 | `/ask` (Ask Cluck) | Type a real beginner question ("what is a seed phrase"), get an answer. | "Ask Cluck — the AI tutor, same one on the website." |
| 4 | 0:38–0:50 | `/checkup` (Wallet Checkup) | Paste a public address, run it, show the approvals/authorities result. | "Wallet Checkup — paste any address, free." |
| 5 | 0:50–1:00 | `/tools` (Toolkit grid) | Open the tab, scroll past the "START HERE" flagships. | "The tools, built for this phone." |
| 6 | 1:00–1:25 | `/rent` (Rent Reclaim) | Tap Rent Reclaim → **Connect Wallet** → the MWA sheet opens (wallet app switches to foreground) → approve the connection → the scan lists closable accounts → tap one → the wallet's confirm sheet names the exact SOL amount → approve → back in the app, the result (landed / failed / unconfirmed) and an explorer link. | "Get your own SOL back — signed on your phone with Mobile Wallet Adapter." |
| 7 | 1:25–1:40 | Tools pass sheet (opened from X-Ray or Holders with a wallet under both doors) | Run a paid tool with a wallet that doesn't qualify; the pass sheet opens instead of a result, showing the CLKN amount, the SKR amount, and the SOL price/day terms — all live numbers. | "One tools pass — hold CLKN or SKR, or pay once in SOL. Terms shown live, never fixed in the app." |
| 8 | 1:40–1:55 | **CONDITIONAL on PR #420 being merged to `develop` by recording day** — the in-app SKR/CLKN/SOL/USDC swap, from the pass sheet or its own pane | Pick an amount, get a quote, the confirm sheet shows the exact route and amount, sign, land. | "Swap for SKR without leaving the app." — **cut this shot entirely if #420 has not merged; do not describe a swap that isn't shipped.** |

Total with shot 8: ~100s; without it, ~85s. Trim shot 2 or 4 by a few seconds to land at 90 if #420 ships.

### Shot 6 detail — what must actually be visible

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

---

## 2. The 3-minute extended cut

Same opening (shots 1–7 above, ~1:40), then add:

| # | Sec | Screen | Owner does | On-screen caption |
|---|---|---|---|---|
| 9 | 1:40–2:00 | `/tools/firepit` (Firepit) | Pick one junk token, see it priced first, burn it, show the three-outcome result. | "Firepit — burn worthless tokens, reclaim the rent underneath." |
| 10 | 2:00–2:20 | `/tools/lock` (Locker Room) | Preview a lock; if completing it, show the wallet as the first signer, then the ephemeral escrow key. | "Locker Room — lock tokens on Jupiter Lock, non-custodially, with public proof." |
| 11 | 2:20–2:35 | `/tools/burn` (Project Burn) | Preview only (burning supply is real) — show the fee/consequence text before any signature. | "Project Burn — a verifiable on-chain burn receipt." |
| 12 | 2:35–2:50 | School home, language pill | Tap the floating language pill, switch to Español (or 中文), show the same lesson re-rendered. | "Seven languages: English, Spanish, Hindi, Italian, Portuguese, Vietnamese, Chinese." |
| 13 | 2:50–3:05 | A lesson, airplane mode | Turn on airplane mode, open a second, not-yet-opened lesson — it renders with no network. | "The school works with no signal — it's already on the phone." |
| 14 | 3:05–3:15 | Toolkit grid, `/tools/alpha` (Daily) with airplane mode still on | Open the Daily — it says it's offline rather than showing stale numbers. | "Every tool says so, honestly, when it can't reach the network." |

End on: school home, wallet disconnected, Cluck Norris wordmark. No slogan overlay beyond what
the app itself already renders.

---

## 3. Recording notes

- **Device:** the owner's own Seeker, screen-recorded with the built-in Android screen recorder
  (no third-party capture app needed; portrait orientation throughout — do not rotate for any
  shot).
- **Wallet:** use a **demo wallet** holding only what each shot needs (a little SOL for fees, one
  junk token for Firepit, an amount of CLKN or SKR near a pass-door threshold if shot 7 needs to
  show the sheet). **Never show a wallet's real overall balance beyond what a shot requires** — no
  portfolio screen, no full holdings list from the wallet app itself.
- **Blur or crop out:** the wallet app's own balance/portfolio screens beyond the single approval
  sheet needed, any real personal address if it isn't the demo wallet, notification shade content
  if it appears when the OS switches apps for MWA.
- **Retake, don't patch:** if the MWA sheet (shot 6, step 2) or a confirm sheet doesn't render
  cleanly, redo the whole shot from "Connect Wallet" rather than splicing — a cut mid-approval
  reads as staged.
- **Live data only.** No mocked API responses, no `--offline` demo fixtures (that convention is
  the Hub/Colosseum material in `docs/DEMO_STORYBOARD.md`; this app has no dry-run mode — every
  screen here calls the real, running `clucknorris.app` backend, same as the seven screenshots
  already captured in the wrapper repo).
- **Pass-sheet shot (7):** if the demo wallet already qualifies through CLKN or SKR by recording
  day, either top down a second demo wallet below both doors, or capture the sheet earlier and
  splice in cleanly (this one exception to "don't patch" is fine — it's an empty-state screen, not
  a signature).

---

## 4. Claims checklist — every caption must be true in the code on `develop`

| Caption / claim | Backed by |
|---|---|
| "Free, no wallet, no signup" (school) | `src/seeker/edition/full.jsx` + `edu.jsx` route tables, `docs/SEEKER_DEMO_INVENTORY.md` §1–2 (`/school` needs no wallet in either edition) |
| "58 lessons, bundled on the phone" | `src/seeker/school/curriculum.js`; "works offline" verified in `docs/SEEKER_DEMO_INVENTORY.md` §1 |
| "Ask Cluck — the AI tutor" | `docs/CLOCK_IN_SUBMISSION_2026.md` §5; `/ask` route in both editions |
| "Wallet Checkup — paste any address, free" | PR #397 ("Wallet Checkup takes any pasted address in the full edition too"); `docs/SEEKER_DEVICE_TEST.md` step 11 |
| "Get your own SOL back — signed on your phone with MWA" | `src/seeker/reclaim-sign.js` `runFullReclaim()`; `docs/SEEKER_DEVICE_TEST.md` step 12; `docs/SEEKER_APP_PLAN.md` §4's money-path rule ("the client builds and signs, the server never signs for a user") |
| "One tools pass — hold CLKN or SKR, or pay once in SOL. Terms shown live" | `/api/tool-gate/config`, `lib/tool-pass-qualify.js`, `scripts/tool-pass-qualify-test.cjs`, `src/seeker/passgate.jsx`; AGENTS.md's tools-pass section — never state a dollar figure in the caption, only that it renders live |
| "Swap for SKR without leaving the app" (shot 8, conditional) | PR #420 / `docs/SEEKER_SWAP_DESIGN.md` — **only usable once merged to `develop`; verify with `git log origin/develop` before cutting the video** |
| "Firepit — burn worthless tokens, reclaim the rent underneath" | `src/seeker/tools/Firepit.jsx`, `src/seeker/sign.js` `signSendConfirm()`; `docs/SEEKER_DEVICE_TEST.md` step 13 |
| "Locker Room — lock tokens on Jupiter Lock, non-custodially, with public proof" | `src/seeker/tools/LockerRoom.jsx`; AGENTS.md's two-signer rule (connected wallet signs first, then the ephemeral escrow key) |
| "Project Burn — a verifiable on-chain burn receipt" | `src/seeker/tools/ProjectBurn.jsx`, `src/seeker/sign.js` `signSendConfirm()` |
| "Seven languages" | AGENTS.md; `public/i18n/{es,hi,it,pt,vi,zh}.json`; PR #398's i18n extractor |
| "The school works with no signal" | `docs/SEEKER_DEMO_INVENTORY.md` §1 ("works offline: yes — curriculum is bundled"); `docs/SEEKER_DEVICE_TEST.md` step 5 |
| "Every tool says so, honestly, when it can't reach the network" | PR #396, `src/seeker/pane.jsx` `useOnline()`/`toolFetch()`; `docs/SEEKER_DEVICE_TEST.md` steps 8, 22 |
| Tools grid leads with the flagship order shown | `src/seeker/tools/registry.js` (`flagship: true` entries), `docs/SEEKER_DEVICE_TEST.md` step 6 |

Before recording, re-run `docs/SEEKER_DEVICE_TEST.md` steps 1–24 once end to end so nothing in
this storyboard describes a screen that has since changed its wording.

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
- **Any guaranteed return, yield figure, or "investment" language** — "Earn potential" describes
  capability only, never a promise (AGENTS.md's Educate → Build → Earn section). Do not say
  "you'll earn," "guaranteed," or quote an APR/APY anywhere in narration or captions.
- **A dollar or token amount for the tools-pass doors as a fixed number** — say "shown live in the
  app," never "$10 of CLKN" or "$20 of SKR" as if those numbers are permanent (they're env-config
  and can change).
- **The website's diploma cNFT as something this app claims** — the Seeker school explicitly says
  "the diploma is claimed on clucknorris.app" (visible in `01-home.png`'s progress card); don't
  narrate as if the app itself mints it.
