# Handoff — the Seeker app, overnight 2026-09-20 → 21

> **Short version.** All 15 tools are built and every one of them mounts in the shipped bundle.
> Five of them sign, on one shared, guarded seam. The tools pass was silently unenforceable and
> now is not. Two live bugs in the website's own airdrop parser are written down but deliberately
> not touched. **Nothing here has been near a real wallet** — §4 is the gate. Two blockers in §3
> are yours alone: a tag, and ten minutes with your Seeker.
>
> It also stopped being an English-only app tonight — 667 strings, six languages, §2c.

**Four screenshots of the real shipped bundle** are in `docs/seeker/` — the toolkit
(`toolkit.png`), the Airdropper (`airdropper.png`), the Locker Room (`locker-room.png`), and Rent
Reclaim in Vietnamese (`rent-vietnamese.png`). Taken from the tarball that actually ships, at
390×844, with the API returning 503 so what you see is the honest failure state, not a mock.

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

### Then two adversarial lenses found the same thing again, in the shared seam itself

Two independent read-only reviews ran over the money paths — one asked *"what gets destroyed that
the person did not agree to destroy"*, the other *"what moves that should not"*. They landed on
the **same P0, in the same file, on the same line**, separately. That is the strongest signal
this repo produces; the original `err`/`confirmationStatus` P0 had exactly the same fingerprint.

`rpc()` throws in two completely different situations and `sign.js` collapsed them into one
"failed":

- **the node answered and refused it** — bad blockhash, a preflight failure. Nothing landed,
  nothing was charged, and a retry is safe.
- **the request never completed** — a dropped mobile connection, a 502 with an HTML body from the
  edge. The transaction is SIGNED and may be in the cluster right now.

The second reported as "failed" is the exact lie the seam exists to prevent, and it came with a
retry button: Project Burn said *"Nothing was burned"*, Rent Reclaim said *"Reclaimed 0 SOL"*, the
Locker Room said *"your tokens are where they were"* — and the second signature burns, closes or
locks the same tokens again, irreversibly.

**An ed25519 signature over a built transaction exists the moment the wallet returns it, not when
a node accepts it.** So `submitSigned()` keeps the signature it already holds, and the confirmation
poll answers honestly: landed, landed-and-failed, or ambiguous. It is now the ONE submit path —
`reclaim-sign.js` had written its own, which is how this would have been fixed once and left
broken in the other place.

Rent Reclaim had the same shape one level up: an ambiguous confirmation was recorded as `failed`
and then fed to the auto-retry, which re-signed closes for accounts whose first transaction may
already have landed. `unconfirmed` is its own outcome now — counted apart, never added to the
reclaimed total, never retried by anything.

Full record, finding by finding, with what pins each one:
`docs/SEEKER_MONEY_REVIEW_burn.md` and `docs/SEEKER_MONEY_REVIEW_send.md` (see the **Status**
table at the top of each).

### And one the reviews could not see

Firepit's `fmtSol` took SOL while all eight of its call sites passed LAMPORTS, so every SOL figure
in the tool was a billion times too large — a row's rent as `2039280 SOL` instead of
`0.00204 SOL`, on the action line directly above the Burn button. No source scan can catch that:
`fmtSol(a.rentLamports)` reads correctly until you read what `fmtSol` does with it. It surfaced
when a new behavioural test asserted a number that should have been on screen and was not.

That is the third time in this file that **rendered measurement and source scanning turned out to
have complementary blind spots.** Run both.

---

## 2. What is built

**All 15 tools. Every one of them reachable, and every one of them mounts in the shipped tarball
— asserted, not assumed.**

| Tool | Tier | State |
|---|---|---|
| Ask Cluck · Wallet Checkup · Listing Checkup · Launches · Daily Brief | free | live |
| Rent Reclaim | wallet | **signs** |
| Firepit · Project Burn | wallet | **signs** |
| Locker Room | wallet | **signs** — two signers, wallet first (§5) |
| Wallet X-Ray · Holders · Trace | pass | live, gated |
| Airdropper | pass | **signs**, in batches, with a public receipt |
| Buy Special | pass | live (read side; the prize-sending half is deliberately absent) |
| Hatchery | paid | **signs** |

**Suite:** `seeker-build-test` 94 · `seeker-reclaim-sign-test` 105 · `seeker-airdrop-test` ·
`seeker-reclaim-test` 40 · `seeker-app-boot-test` (A–H) · `i18n-audit` exit 0.

### The four things in this build worth your attention

**1. The tools pass was unenforceable, and everything was green.** `src/seeker/pass.js` reads
`window.CluckGate`, which `public/cluck-gate.js` installs — and that file was in neither
`seeker.html`'s script tags nor the bundle's file list. So in the tarball that actually ships,
the global did not exist, `usePass()` took its documented fail-open branch, and every pass-tier
tool would have run ungated. Nothing caught it because each part was individually fine: the
source builds, the panes render, the tarball verifies, and failing open IS correct for a real
outage — it is only wrong when the client was never shipped. Section F of the boot test now
asserts it against the BUNDLE: the file is there, the global exists, and a RUN with no pass never
calls the gated API. Run as a mutation, removing the script tag makes `/api/wallet-xray` get
called with no pass.

**2. One signing seam, not five.** `src/seeker/sign.js` now holds the four protections every
wallet-touching tool needs, and its header says what each one costs when missing. `reclaim-sign.js`
no longer defines any of them; it re-exports. `seeker-build-test` (e2) is the inventory: nothing
outside the seam may call `getSignatureStatuses` or `sendTransaction`, nothing may re-declare its
exports, and the err-before-status ordering is asserted **positively** — a negative regex passes
against the broken code, which is how the original assertion went green while wrong.

**3. Three outcomes, never two.** Sent / failed / **unconfirmed** is carried end to end, in the
Airdropper, both burn tools, the Locker Room and the Hatchery. "Unconfirmed" means it may still
land: called "sent", unpaid people look paid; called "failed", a retry double-pays or double-burns
or double-locks. Section H caught a live instance of exactly this — after an unconfirmed lock the
"Lock tokens" button was still on screen, one tap from committing the tokens twice. It is hidden
now for sent and unconfirmed, kept for failed and declined.

**4. The Airdropper does not reimplement the engine.** It drives `public/airdrop-engine.js`, the
platform's one audited batch-transfer path, now shipped in the bundle. What IS new is
`public/airdrop-plan.js` — the parse-and-cost half, pure and fixture-tested. Writing it turned up
**two live bugs in the desktop parser**, both documented there and deliberately not "fixed" in
passing (`public/airdrop.html` is a live money path and not this change's to touch):

- `parseFloat` after stripping non-digits reads the European **"1.234,56" as 1.23456** — three
  orders of magnitude out, on a payout row, silently. The phone version refuses such a row.
- **Duplicate addresses are summed in floats, and never mentioned.** The engine's own comment
  explains why a float add is unsafe past ~9M tokens at nine decimals. The phone version keeps
  amounts as decimal strings throughout and reports every merge before anyone signs.

## 2c. The app is not English-only any more

The school ships in seven languages and this app is part of the school. It was shipping in one.
An English-only app beside a seven-language school is not a smaller version of the same product —
it is a different one for everyone who does not read English.

**667 strings, six languages.** The key list is GENERATED from the source
(`scripts/seeker-i18n-keys.cjs`), not kept by hand — a hand-kept list sat at eight entries while
the app grew to fifteen tools, and would have gone on passing while 600 strings shipped in
English. The same generator feeds `store-edition.json`'s `excludeKeys`, so none of this
wallet-and-payments copy can ride along into the education-only Play bundle
(`--sync-exclude`, 147 → 807 entries).

**Three things it turned up, in order of how much they matter:**

1. **The source scan alone was not enough.** It found 644 strings; the app still rendered 27 in
   English, because the tool NAMES and BLURBS live as data in `registry.js` and the pass sheet's
   per-tool sentence lives in `passgate.jsx`, rendered as `t(tool.blurb)`. A scan for `t("…")`
   cannot see any of that. It was caught by a RENDERED check — booting the bundle in a Spanish
   locale and reading the screen. Source scanning and rendered measurement have complementary
   blind spots; AGENTS.md says run both, and this is that costing a round trip. Both halves are
   now in CI.

2. **Sentences were being glued together from fragments, and could not be translated at all.**
   "Try again in" + n + "s", and the tools-pass terms built from EIGHT separate pieces — "Hold
   about", "(around", "for a", "day". Reads fine in English; impossible in six languages whose
   clause order is not English's. Two translators flagged it independently, and one returned an
   empty string for the bare "s" — which was the honest answer and is what surfaced it. Those are
   whole sentences with `{placeholder}` values now, using the repo's existing `tf()` convention,
   which `i18n-audit` already checks for placeholder mismatches. The inline bold on the pass
   amounts went with it: an untranslatable sentence in six languages is a worse trade than
   unbolded numerals in one.

3. **Pre-existing gaps in the shipped website dictionaries**, spotted by a translator while
   cross-checking house style — not introduced here and not fixed here, because they are the
   website's copy, not this app's:
   - `vi.json`: `"Total supply"` and `"✅ GRADUATED"` left in English while the same words are
     correctly translated in neighbouring entries.
   - `it.json` and `vi.json`: the all-caps `"📡 LIVE BAGS.FM LAUNCHES"` heading untranslated
     while lowercase "launches" is translated everywhere else in both files.
   - `vi.json`: "airdropper" translated in one entry and kept as an English loanword in three
     others — inconsistent either way.

**And an open question, now answered with a measurement.** `hi.json` has long looked half
untranslated. It is not: 164 of ~2,125 entries (7.7%) are byte-identical to English, and
essentially all of them are proper nouns, our own tool names, or shouting CTA buttons — never
plain prose. The other 92% is fluent Hindi that deliberately code-switches crypto nouns into
Latin script or transliteration (वॉलेट, टोकन, कनेक्ट करें), which is how Indian crypto communities
actually write. That is a house style, not a gap, and this app's 667 strings follow it.

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

This list got longer tonight, not shorter, because five tools now sign. Read it as the gate
before any of this touches real money.

- **No real signature, by any wallet, ever.** Every signing claim in this app comes from reading
  the code and from fake providers with generated keypairs. Same gap AGENTS.md already names for
  locks and connect-and-sign.
- **No real RPC response observed.** Response shapes come from the handlers and from documented
  schemas, not from a live call.
- **No real burn, no real lock, no real airdrop, no real mint.** All four are exercised against a
  fake chain that returns what we told it to.
- **The Hatchery's image path has never run in a browser at all.** A phone's camera roll gives
  1–15 MB photos and `/build` caps the logo at 100 KiB, so the pane downscales and re-encodes via
  `<canvas>` — code-reviewed against the documented APIs, never executed. Test it on a real device
  before the Hatchery ships.
- **Three cheap tests worth doing before trusting any of this with money**, each one transaction:
  1. On devnet, confirm `CloseAccount` really refuses a non-empty account — the last line under
     the `uiAmount` class of bug in Rent Reclaim.
  2. One real lock through the Locker Room, and read the signatures on Solscan: the wallet must be
     the fee payer, the escrow key the second signer.
  3. One two-batch airdrop to two throwaway wallets, and check the public receipt lists exactly
     the confirmed rows.

---

## 5. The decision that needed your agreement — and how it was resolved

The earlier draft of this handoff stopped Firepit, Project Burn and the Locker Room short of the
signature, and asked whether you would rather I had pushed through. **I pushed through, but not
before extracting the seam first.** The reason for stopping was never caution about the feature —
it was that the send/confirm logic had already been copy-pasted once and produced the same P0 in
two files. Writing a third and fourth copy would have produced a third and fourth instance.

So the order was: extract `src/seeker/sign.js`, prove it, put the five signing tools on it, and
guard the arrangement in CI so a sixth copy cannot appear. All three tools sign now.

**The Locker Room is the one to look at.** It is the only two-signer transaction in the app, and
the order is a rule from CLAUDE.md, not a style: the connected wallet signs first, then the
ephemeral escrow key, or Phantom warns the user that the transaction may be malicious. A rule
stated in a comment is not a rule, so section H takes the bytes the app actually submits,
deserializes them, and reads the signatures back out — both present, both verifying, the wallet
at index 0 and the escrow key at 1.

## 6. Also fixed along the way

Two of these were only visible in a screenshot. Nobody had looked at this app — it had been
measured, asserted and built, never seen.

- **The shared language pill was sitting on top of the fourth nav tab.** Wallet Checkup was
  untappable on every screen. The boot test asserted every nav control was at least 44px and it
  was; that every tool mounts and they did; that the route works and it does. **A tap target can
  be exactly the right size and still be unreachable.** Guarded now by asking the browser what is
  actually at each control's centre point.
- **Rent Reclaim and Wallet Checkup asked for a wallet and gave you no way to connect one** — a
  title, a sentence, and an empty screen, on the second bottom-nav tab and on the free tool that
  hands people money back. Both use the shared `NeedsWallet` now. Guarded for every pane at once:
  a pane whose text asks you to connect must render a control or say the device has no wallet.
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
