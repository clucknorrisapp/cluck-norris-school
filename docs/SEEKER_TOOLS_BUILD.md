# The Seeker app — every tool, rebuilt for a phone

**Owner decision, 2026-09-21: "I want to build all the tools into the seeker app appropriately…
Don't nickel and dime this."** This supersedes the earlier three-surface scope in
`docs/SEEKER_APP_PLAN.md` §4. That document stays the decision of record for *which repo* and
*what the app is*; this one is the decision of record for *the tool surface*.

**It is the decision of record. Do not re-litigate it; amend it.**

---

## 1. The one rule everything here serves

The hackathon's own words, and the reason this is a rebuild rather than a port:

> *"You can participate with an existing web app, but you must build an Android app with
> significant mobile-specific development. Direct ports or PWA wrappers with little mobile
> optimisation will score poorly."*

So: **no tool page is copied into the bundle.** Each tool is rebuilt as a React pane that calls
the same proven server endpoints the website calls. The backend does not change (a live site, a
Play app and an iOS app depend on that exact surface). The client is new.

If you find yourself pasting HTML out of `public/*.html`, stop — that is the thing that loses.

## 2. What ships

Every tool below gets a pane. Tiers are the existing access model (AGENTS.md), unchanged — the
app does not invent new gates and does not hardcode any amount.

### Free, no wallet needed — read-only
| Tool | Route | Server |
|---|---|---|
| Ask Cluck | `/ask` | `POST /api/ask-cluck` — **done** |
| Listing Checkup | `/tools/listing` | `/api/listing-checkup/*` |
| Bags feed | `/tools/bags` | the bags launches/graduated reads |
| Alpha brief | `/tools/alpha` | the daily brief read |

### Free, wallet connects to act
| Tool | Route | Notes |
|---|---|---|
| Rent Reclaim | `/rent` | **signs** — many batches, one wallet prompt |
| Wallet Checkup | `/checkup` | **live** |
| Firepit | `/tools/firepit` | **signs** — burn junk + reclaim rent; the value-guard is load-bearing |
| Locker Room | `/tools/lock` | **signs** — the flagship story; non-custodial locking; the app's only two-signer transaction |
| Project Burn | `/tools/burn` | **signs** — verified burn + receipt |

### Heavy — the unified tools pass
`$50 of CLKN` held (live-priced) **or** `0.05 SOL` for a 7-day pass. Config comes from
`GET /api/tool-gate/config`. ⛔ **Never hardcode the amount or the lamports.**
| Tool | Route |
|---|---|
| Wallet X-Ray | `/tools/xray` |
| Token Holders | `/tools/holders` |
| Trace | `/tools/trace` |
| Airdrop | `/tools/airdrop` | **signs** — drives `public/airdrop-engine.js`, plans with `public/airdrop-plan.js`, records a public receipt |
| Buy Special | `/tools/buyspecial` | read side only — the prize-SENDING half is an operator surface and is out of scope below |

### Paid
| Tool | Route | Notes |
|---|---|---|
| Hatchery | `/tools/hatchery` | **signs** — probe `/api/hatchery/config` for today's figure, computed live |

### Deliberately NOT in the app
Operator and project-owner surfaces: `hub-desk`, `hub-pay`, `hub-apply`, `client-portal`,
`jupverify`, `owners-snapshot`, `buyspecial-dashboard`, `cuna-payout`, `cuna-staking`,
`lp-rescue`, `premium`/autopsy, `transcript`. These are desk work on a large screen, they are not
what a phone in a pocket is for, and several are owner-only. Not a capability gap — a scope line.

### ⚠️ Superseded in part, 2026-09-21 (owner, on the device)

Two corrections from the owner after installing the app on his Seeker — **wallet connect and
signing work**, and then:

1. 🚩 **The flagships are "the school, the LP lab, the airdropper, the locker room, the fire pit,
   project burn"** — and the **school leads**. The home screen must lead with those, not with a
   catalogue grouped by access tier. See AGENTS.md.
2. ⛔ **Launches is REMOVED** (owner: *"I don't want the launches stuff on there especially any
   bags info"*). The pane, its route, its registry row, its i18n keys and its own CSS are gone.
   Six classes from its CSS block survive under their old `seeker-launch-` names because the
   Locker Room, the Hatchery and the Daily Brief all use them — deleting the block wholesale
   broke all three.
3. **The Daily Brief is HELD** — owner has not decided ("let's circle back later"). It reads
   `/api/alpha`, the same brief that already feeds the daily Telegram and X post, and it shows
   new pools and gainers/losers, which is the launch-flavoured content point 2 is about. Do not
   remove it, and do not defend it; it is an open question.

**And the big one: this document is why the app had no school.** It enumerates fifteen TOOLS,
and the app was built to it exactly — `seeker.html` is a separate Vite entry over `src/seeker/*`
and never included the school at all. Nothing was deleted; the school was never routed in, and
`/` was pointed at `/tools`. The fix in flight is a **phone-native school** (owner's pick) over
the EXISTING lesson data, leading the app.

### Status, 2026-09-21
**All 15 are built, wired and reachable**, and `scripts/seeker-app-boot-test.cjs` drives every
one of them in the shipped tarball and asserts it mounts — read from the grid's own rendered
hrefs, not a list in the test, so a new tool cannot be added without a render check.

Five of them sign: Rent Reclaim, Firepit, Project Burn, the Locker Room and the Hatchery, plus
the Airdropper. **Nothing has been exercised against a real wallet or a real chain** — see
`docs/HANDOFF_2026-09-21_SEEKER.md` §4 for the device gate that has to pass first.

## 2b. Three things are shared, and CI keeps them shared

This app's recurring failure mode is not a missing feature; it is the same logic written twice
and fixed once. Each of these was a real instance, and each is now pinned by
`scripts/seeker-build-test.cjs` section (e2).

| Shared file | What it owns | What happened without it |
|---|---|---|
| `src/seeker/sign.js` | the whole sign → send → confirm path, and four protections | the same P0 (confirmationStatus checked before err) shipped in TWO copies and was found by two reviewers on the same day |
| `src/seeker/passgate.jsx` | the tools-pass sheet | three byte-identical 79-line copies differing by one sentence, each carrying a note saying "extract this if it drifts" |
| `public/airdrop-engine.js` | batching, tx building, instruction encoding | the Seeker Airdropper drives it rather than carrying a copy; `public/airdrop-plan.js` is the only new logic, and it is pure |

The guard is an inventory, not a style rule: no file outside the seam may call
`getSignatureStatuses` or `sendTransaction`, no pane may define a `PassGate`, and the
err-before-status ordering is asserted **positively** — a negative regex passes against the
broken code, which is exactly how the original assertion went green while being wrong.

## 3. The pane contract — every tool obeys it

Import the shared primitives from `src/seeker/pane.jsx`. Do not re-invent them per tool; the
whole point is that twelve panes feel like one app.

1. **Four states, never conflated:** idle/not-ready · loading · result · **unavailable**.
   ⚠️ A failed read NEVER renders as an empty or zero result. Telling someone their wallet is
   clean, or that they have nothing to reclaim, when we could not actually look, is a lie about
   their money. This is the rule that already governs Rent Reclaim and the tool gate.
2. **Offline is first-class.** `navigator.onLine` plus a failed fetch, and recovery when the
   connection returns.
3. **Say what's on-chain, never why.** Report authorities, balances, approvals, lock terms as
   facts. Never label a token safe, verified, scam or rug. Only call a wallet "creator" or "team"
   when a launchpad API confirms it.
4. **Guardrails before power.** Anything destructive or irreversible gets a confirm step naming
   the exact consequence, in plain words, before the signature.
5. **Escape everything from chain metadata.** Token names and symbols are attacker-controlled —
   a recorded bug class here. React text rendering only; never `dangerouslySetInnerHTML`.
6. **Mobile-first, measured:** ≥44px tap targets, safe-area insets, no horizontal overflow at
   390px, a composer/input that survives the on-screen keyboard.
7. **Every string through `t()`.** `public/i18n/en.json` does not exist and must not be created —
   English IS the key text. Do not touch the six translated dictionaries; a later pass does that.
8. **Never hardcode a price, threshold or amount.** Render from the live config endpoint.

## 4. Wallet and signing

One layer: `window.CluckWallet` (`public/cluck-wallet.js`). It already does legacy injection,
Wallet Standard discovery, **and** a Mobile Wallet Adapter path that looks for a native bridge at
`Capacitor.Plugins.CluckMWA`.

⚠️ **The native plugin does not exist yet** — its own comment says so, and it is increment 2 of
the `CLKN-SEEKER` repo. Until it lands, connect inside the bundled app finds nothing. Consequences
for every builder:

- Build against `window.CluckWallet` and **nothing else**. When the plugin lands, every pane gets
  MWA for free, with no per-pane change. That is the entire reason the layer was consolidated.
- A pane must degrade honestly when no wallet is available: say so, never pretend to connect, and
  never render a result that implies a wallet was read.
- ⛔ **Never call `SystemProgram.transfer()` or any web3.js layout encoder in the browser.** It
  needs a Node `Buffer` that browsers do not have and we ship no polyfill; this silently killed
  three money paths at once. Use the hand-built encoders and diff their bytes against the library
  in Node before shipping.

## 5. The tools pass on a phone

The pass is a **signed session**: the wallet signs a one-line nonce, `POST /api/tool-gate/session`
verifies it and returns an HMAC token, and `x-clkn-pass: t:<token>` is what the heavy APIs check.
A payment signature is evidence, never the credential.

In the app: **pages preview free; the gate fires on RUN.** A heavy pane must render its explainer,
its input and its empty state to anyone — only the run is gated. If pricing is down, fail open.

## 5b. Adding a string, in seven languages

The app renders in all seven languages the school does, and CI fails if a string it shows is
missing from any of the six translated dictionaries. The loop is three commands:

```
node scripts/seeker-i18n-keys.cjs                 # every string the app renders, from the source
node scripts/seeker-i18n-keys.cjs --missing es    # the ones es still needs
node scripts/seeker-i18n-merge.cjs <dir> --apply  # fold {english: translation} files back in
node scripts/seeker-i18n-keys.cjs --sync-exclude  # keep the store bundle's excludeKeys in step
```

Four rules, each of which cost a round trip to learn:

1. ⛔ **`public/i18n/en.json` does not exist and must never be created.** English IS the key text.
   An en.json would make every key look translated and silently disarm all six checks. Two
   builders proposed creating one on the same day, independently; it is asserted against now.
2. **The key list is GENERATED, never kept by hand.** It sat at eight literals while the app grew
   to fifteen tools. If you add a TABLE of display strings — the way `registry.js` holds every
   tool's title and blurb — add it to the extractor's `TABLES`, or it renders in English forever
   while every check passes.
3. **One whole sentence per translation unit.** A value goes INSIDE the sentence with the
   `tf("… {n} …", {n})` helper, never glued on either side of a `t()` fragment. "Try again in" +
   n + "s" reads fine in English and cannot be translated into any of our six; three translators
   said so independently, and one returned an empty string for the bare "s", which was the honest
   answer. Placeholders must survive translation verbatim — `i18n-audit` checks that.
4. **Both halves, always.** The source scan and the rendered check have complementary blind spots
   (AGENTS.md). `seeker-build-test` (f) reads the files; `seeker-app-boot-test` (I) boots the
   bundle in a Spanish locale and reads the screen. The first said 644/644 while the app showed
   27 strings of English; only the second could see it.

## 6. Tests

Each pane is covered by `scripts/seeker-app-boot-test.cjs`, which boots the **shipped tarball** in
a phone-sized Chromium. Add your tool's assertions there: it renders, its states are distinct, a
failed read shows unavailable and never a zero, and its controls clear 44px. Pure logic goes in a
`public/*.js` dual-export module with its own Node test, the way `rent-math.js` and
`rent-reclaim-plan.js` do — not buried in a component.

### What the boot test now covers, section by section

| | What it drives |
|---|---|
| A | the bundle mounts, loads its scripts, reaches **nothing off-device but our own API**, and the brand fonts come from inside the bundle |
| B | hash routing, 44px targets, the grid's honesty rule (an unbuilt tool is never a link), and **every built tool mounts** |
| C | connect and disconnect through the real shared registry |
| D | ⚠️ a 503 renders **unavailable and never a zero total** — asserted negatively too |
| E | a good read renders the real numbers, in the right groups, with the server's own reasons |
| F | ⚠️ the tools pass is really **enforced in the bundle** — a RUN with no pass never calls the gated API |
| G | ⚠️ the Airdropper's **three outcomes stay apart**, and only confirmed rows reach the public receipt |
| H | ⚠️ the Locker Room's **two signatures, in order** — read back out of the bytes actually submitted |

### Three ways a test here has lied, and what to do about it

Each of these happened while building this app. They are listed because each one looked exactly
like a product bug or a clean pass, and cost real time.

1. **A fixture that can't occur.** The original confirmation assertion used a status shape mainnet
   never returns (`err` with no `confirmationStatus`), so it asserted the opposite of reality and
   went green over a live P0. **Fixtures must be shapes the chain actually produces.**
2. **A probe that produces no output is not a pass.** A bad URL injected into a comment, and then
   into an unused export, both "passed" the host scanner — comments are stripped and unused
   exports are tree-shaken. Only a third probe, changing a URL that actually renders, proved the
   scanner worked at all.
3. **A harness that fails for its own reasons.** Addresses that match base58 but aren't real
   keypairs, a fake wallet that returns the unsigned bytes it was handed, a template literal that
   didn't interpolate — each produced a screen full of failures that read as a regression in the
   pane. **Before believing a red test, check the fixture.**

Run a new or changed guard as a **mutation**: break the thing it protects and watch it go red,
then restore it. A guard that has never been seen to fail is not known to work.
