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
| Rent Reclaim | `/rent` | **in flight** — increment 3 signing |
| Wallet Checkup | `/checkup` | **in flight** |
| Firepit | `/tools/firepit` | burn junk + reclaim rent; the value-guard is load-bearing |
| Locker Room | `/tools/lock` | the flagship story; non-custodial locking |
| Project Burn | `/tools/burn` | verified burn + receipt |

### Heavy — the unified tools pass
`$50 of CLKN` held (live-priced) **or** `0.05 SOL` for a 7-day pass. Config comes from
`GET /api/tool-gate/config`. ⛔ **Never hardcode the amount or the lamports.**
| Tool | Route |
|---|---|
| Wallet X-Ray | `/tools/xray` |
| Token Holders | `/tools/holders` |
| Trace | `/tools/trace` |
| Airdrop | `/tools/airdrop` |
| Buy Special | `/tools/buyspecial` |

### Paid
| Tool | Route | Notes |
|---|---|---|
| Hatchery | `/tools/hatchery` | probe `/api/hatchery/config` for today's figure — computed live |

### Deliberately NOT in the app
Operator and project-owner surfaces: `hub-desk`, `hub-pay`, `hub-apply`, `client-portal`,
`jupverify`, `owners-snapshot`, `buyspecial-dashboard`, `cuna-payout`, `cuna-staking`,
`lp-rescue`, `premium`/autopsy, `transcript`. These are desk work on a large screen, they are not
what a phone in a pocket is for, and several are owner-only. Not a capability gap — a scope line.

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

## 6. Tests

Each pane is covered by `scripts/seeker-app-boot-test.cjs`, which boots the **shipped tarball** in
a phone-sized Chromium. Add your tool's assertions there: it renders, its states are distinct, a
failed read shows unavailable and never a zero, and its controls clear 44px. Pure logic goes in a
`public/*.js` dual-export module with its own Node test, the way `rent-math.js` and
`rent-reclaim-plan.js` do — not buried in a component.
