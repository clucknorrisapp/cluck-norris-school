# Handoff — the Seeker app, overnight 2026-09-20 → 21

Written for the owner's review. Owner's instruction for the night: *"build all the tools into the
seeker app appropriately… Don't nickel and dime this"*, *"we aren't shipping a wrapper"*,
*"Don't stop on this til done. No approvals."*

Everything below is on **`claude/seeker-selfhost-fonts`**, open as **PR #387 → develop**. Nothing
has gone to `main`; that is still your explicit go, as always.

---

## 1. Read this first: two bugs, one of them was live

### A transaction that FAILED on-chain was reported as a success

`getSignatureStatuses` returns **both** `err` and `confirmationStatus` for a transaction that
landed and then failed. Two call sites tested the status first, which made the `err` check below
it dead code.

- **`public/airdrop-engine.js` — the LIVE airdropper on clucknorris.app.** A failed batch reported
  every recipient as sent. This was shipped and running. It was found only because the Seeker
  work had copied the function.
- **`src/seeker/reclaim-sign.js`** — a failed close marked all 26 accounts in its batch "Closed",
  added their rent to the reclaimed total, and recorded them as done so the pane would never
  offer them again.

⚠️ **The assertion that should have caught it was passing.** Its fixture used a status shape
mainnet never returns (`err` with no `confirmationStatus`), so it asserted the opposite of reality
and went green. Corrected and mutation-proved: re-inverting the two lines turns it red, restoring
turns it green.

### The feature was dead above 100 accounts

`getFreshBalances` sent the whole candidate set to `getMultipleAccounts`, whose limit is 100,
while the scan allows 300. A wallet with 101+ dead accounts got *"Could not read the chain right
now"* permanently — the feature was dead for exactly the wallets it is worth the most to, and it
blamed an outage that was not happening. `public/airdrop-engine.js`, the file this was copied
from, chunks at 100; the chunking was dropped in the copy.

**Both bugs came from the same habit: copying the send/confirm logic instead of sharing it.**
See §5.

---

## 2. What is built

**9 of 15 tools, all reachable in the app.**

| Tool | Tier | State |
|---|---|---|
| Rent Reclaim | wallet | **signs** — hardened by two adversarial lenses + a 10-finding fix round |
| Ask Cluck | free | live |
| Wallet Checkup | free | live |
| Listing Checkup · Launches · Daily Brief | free | live |
| Firepit · Project Burn | wallet | live, **read + confirm UX, no signing** (§5) |
| Toolkit grid | — | live, the app's front door |

In flight when this was written: Locker Room, and the pass tier (X-Ray, Holders, Trace).
Not started: Airdropper, Buy Special, Hatchery.

**Suite:** `seeker-reclaim-sign-test` 105 · `seeker-reclaim-test` 40 · `seeker-build-test` 79 ·
`seeker-app-boot-test` all green · `i18n-audit` exit 0.

### Things worth knowing about how it was built

- **The app is booted in CI for the first time.** `seeker-app-boot-test.cjs` unpacks the *shipped
  tarball* and drives it in a 390×844 Chromium. Nothing had ever opened the app before — it could
  have built clean and rendered a blank screen.
- **The fonts are ours now.** The bundle was fetching Anton + Chakra Petch from Google at runtime:
  brand type gone offline, a third-party call on every cold start. All 19 faces vendored
  (`scripts/vendor-fonts.mjs`, re-runnable); 106 dead preconnects and 2 direct font links removed
  across 54 files. The bundle now reaches **nothing off-device but our own API**, asserted at
  runtime, and both bundle configs drop the font hosts so a regression is a build failure.
- **`Unavailable` and `Empty` are separate components** in `src/seeker/pane.jsx`, with no shared
  "no data" state between them. A failed read can never render as an empty result.
- **The pass is bound, not rebuilt.** `src/seeker/pass.js` uses `cluck-gate.js` for the whole
  credential surface and replaces only `guard()`'s desktop card. No amount is hardcoded anywhere.

---

## 3. ⛔ Two blockers. Only you can clear them.

### 1. There is no APK yet — needs a tag

The wrapper repo had **no `seeker` build target at all**; `store-edition.lock` listed only google
and ios. Added on `clucknorrisapp/clkn-seeker` branch **`claude/seeker-build-target`**.

It **refuses to build**, on purpose: *"Refusing to build a store target without a pinned,
checksummed release."* Faking a pin to make it green would have been exactly the kind of false
success this night's P0 was about. Four-step procedure in that repo's `docs/SEEKER_TARGET.md`;
it needs a `store-seeker-v0.1.0` tag push, which a cloud session cannot do.

### 2. The wallet cannot connect yet — needs your Seeker

The native `CluckMWA` plugin is written on **`claude/cluck-mwa-plugin`** (Kotlin, real `transact`
sessions, clientlib pinned 2.1.1 — 2.2.0 would have forced an unrelated SDK bump). It caught a
real bug on the way: `MobileWalletAdapter.blockchain` **defaults to Devnet**, so every adapter now
sets Mainnet explicitly.

**It has never been compiled** — no Android SDK in this container. Until the 10-step device
checklist in `docs/MWA_PLUGIN.md` passes, an APK built today opens, renders and reads, but
**cannot sign**. That checklist is the day-3 gate no cloud session can close.

---

## 4. Never verified, and you should not assume it was

- **No real signature, by any wallet, ever.** Every signing claim is from reading and from fake
  providers. This is the same gap AGENTS.md already names for locks and connect-and-sign.
- **No real RPC response observed.** The `uiAmount: null` case and the 100-pubkey limit rest on
  documented schemas and this repo's own prior art, not on a live call.
- **One cheap test worth doing before trusting Rent Reclaim with real money:** confirm on devnet
  that `CloseAccount` really does refuse a non-empty account. That refusal is the last line under
  the `uiAmount` class of bug. One transaction settles it.

---

## 5. The decision I made that most needs your agreement

**Firepit, Project Burn and the Locker Room were built read-side + full confirm UX, stopping
short of the signature.**

The P0 existed in two places because the send/confirm logic had been copy-pasted once already.
Writing a third and fourth copy overnight would have produced a third and fourth instance of it.
The right fix is to extract the now-hardened seam into one shared, tested helper and have every
signing tool sit on it — but that is a refactor of a money path that had *just* been hardened and
reviewed, and doing it unguided at 4am is how the hardening gets quietly undone.

So: the panes are complete up to the signature, and signing lands on the shared seam, once, with
review. If you would rather I had pushed through and shipped signing in all of them tonight, say
so and it is a short job — but I would want the adversarial pass on it before it reaches anyone's
wallet.

---

## 6. Also fixed along the way

- The store-edition host scanner was treating the vendored web3 bundle's **licence comments** as
  our code, which had forced `api.mainnet-beta.solana.com` onto the allow-list — that would have
  let a future accident bypass our own RPC proxy silently. Vendored files are now exempt; the
  runtime boot test covers them instead.
- `seeker-build-test`'s pristine-baseline check had a symlink bug that gave every builder phantom
  failures all night.
- `"No balance — safe to close."` is gone. It broke the brand rule, it was untrue for Token-2022
  accounts with withheld fees, and it was the *one* reclaim string already translated into all six
  languages while every guardrail sentence was English-only. Replaced and curated in all six.
- A test assertion that ended in `|| true` — it could never fail. Removed.
