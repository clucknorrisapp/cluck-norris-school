# Lock to Earn as a platform — any project, their rules, our engine, their holders' receipts

**Owner, 2026-09-16 (verbatim intent):** *"allow other project holders to come on board, either pay
us to use the platform or hold a certain amount of CLKN, then they can set all of the parameters
they want for what the lock and hold looks like for their community. Cancelable or non-cancelable.
Minimum amount. Minimum time. Vesting versus no vesting. Weekly, monthly, at the end of a lock.
Ultimate flexibility. … projects can have their people lock tokens through Jupiter, which is very
safe and not held by the community, and they can monitor that and be rewarded just like a staking
contract — without the staking contract, without the risk and without the cost."*

One sentence for the pitch: **staking rewards without a staking contract — tokens sit in Jupiter
Lock (nobody holds them, not us, not the project), the project sets the rules, our engine reads the
chain, computes and pays, and every holder can verify every payout.**

## What already exists (nothing here is rewritten)

| need | have | where |
|---|---|---|
| lock tokens, non-custodial | the Locker Room: builds an unsigned Jupiter Lock tx, the user's wallet signs | `lib/jup-lock.js`, `/locker-room` |
| find every lock of a token | by-mint escrow scan, paged (`getProgramAccountsV2`) | `lib/cuna-lock-scan.js` |
| decide who qualifies | rules engine: cancelable, min size, min/max term, vesting-aware (only what is still locked earns), exclusions, backdate cap | `lib/cuna-staking.js` `disqualify` / `weightOf` / `accrueDay`; reason codes in `lib/hub/eligibility.js` |
| run it | programme lifecycle: arm/disarm (start date never slides), hourly slices, missed-slice catch-up | `lib/cuna-programme.js` |
| the terms, versioned and hashed | `validateTerms` → immutable program versions with sha256 | `lib/hub/project.js` |
| per-project storage | `program:<id>:{state,ledger,days,paid,batches}`; CUNA aliased to its legacy keys | `lib/hub/store.js` |
| owe / reserve / settle without double-pay | ledger partition, settlement journal keyed by the chain transfer, attempt state machine | `lib/hub/ledger.js`, `lib/hub/attempts.js` |
| pay | batches + **server-signed send** (journal before broadcast, disk-verified, raw units, sweep/void) — or the airdropper for a project that signs itself | `lib/cuna-payout.js`, `/api/cuna-stake/payout?send=` |
| show holders | the public Hub: terms hash, timeline, eligibility facts, receipts, verify-on-chain, check-a-wallet | `/hub/:project`, `lib/hub/public.js` |
| explain it honestly | teach block — six questions, lesson links, **no APR ever** | `lib/hub/teach.js` |
| gate access by holding or paying | the tools pass: hold $X of CLKN (live-priced) or pay SOL; signed session, never a bearer | `toolPassGate`, `/api/tool-gate/*` |

## The parameters (the owner's list → the field)

| the owner said | field | exists? |
|---|---|---|
| cancelable or non-cancelable | `cancelableAllowed` | ✅ |
| minimum amount of tokens | `minLockRaw` | ✅ |
| minimum amount of time | `minDurationDays` (+ `maxTermDays` ceiling) | ✅ |
| vesting vs no vesting | `vesting: "any" \| "cliff-only" \| "vesting-only"` — the engine already earns only on what is still locked; this decides which lock *shapes* qualify | 🆕 |
| weekly / monthly / at the end of a lock | `payoutSchedule: daily \| weekly \| monthly \| at-unlock \| manual` (`monthly`, `at-unlock` new; `at-unlock` pays each wallet when its own lock releases) | 🆕 partly |
| what funds it | `poolDailyRaw` (fixed) or `sharePct` of the funding wallet's daily unlock, `maxSharePct`, `maxWalletSharePct` cap | ✅ |
| who is out | `excludeWallets` (funding + operator wallets always) | ✅ |
| when it starts / how far back a lock counts | `startedAt` (arm, one-way), `backdateCapDays`, `backdateNotBefore` | ✅ |
| who may change it | `operatorWallets` on the project record; edits create a new **version**, old periods keep the old terms | ✅ |

## Three decisions that are the owner's

1. **Who signs the rewards.** Two modes, both should exist:
   - **Self-sign (non-custodial, default for onboarded projects):** the batch is built by us, the project's wallet signs it in their browser (the airdropper path — live today). We never hold their reward tokens.
   - **Managed:** a payer wallet we hold the key for, funded by the project (how CUNA and ROSE run today via Railway operator keys). Fully automatic. Needs a per-project key we custody — a real responsibility; fine for projects we run, not the default for strangers.
2. **The gate.** Hold **$N of CLKN** in an operator wallet (live-priced, `/api/tool-gate/config` pattern — never hardcoded) **or** pay **X SOL per month**. Amounts are yours; my placeholder is $500 / 0.5 SOL·month until you say otherwise.
3. **Approval.** The design already says a project is whitelisted by the owner. Keep it: self-serve *application*, one-click **approve** by you in the desk (mint checked on-chain: decimals, token program, no transfer-fee/hook extensions — the payout verifier cannot account for those yet).

## Phases (each a PR, each demoable; window ends Oct 12)

**Phase 1 — the engine works for any project (backend).** Per-project programme store, scan by the
project's mint, accrual scheduler over every armed project, eligibility from the project's terms,
payout batches per project with server send (`from=<payer>`) or self-sign export; cadences
`monthly` and `at-unlock`; `vesting` shape rule. CUNA becomes "just a project" through the alias
with zero behaviour change (its tests stay green). Public Hub already renders whatever is in the
per-project store.

**Phase 2 — the project desk (`/hub/:project/desk`).** Wallet-signed operator session (an
`operatorWallets` entry signs the nonce — nothing typed, no key). The terms form → a new hashed
version. Live lockers table with eligibility reason codes and the numbers that decided them.
Accrued-to-date, funding status (three numbers, never one "funded" boolean), next-payout preview.
Payout desk: build batch → **Sign in my wallet** or **Send from managed wallet** → receipts appear
on the public page. Teach block on every screen; no rate language can render.

**Phase 3 — self-serve onboarding (`/hub/apply`).** Connect wallet → pick the mint (on-chain read
fills decimals/program/extensions) → gate check (hold or pay) → funding wallet + operator wallets →
draft terms with the teach block → submit → owner approves → live. The application itself becomes
the project's first program version.

**Later:** managed-wallet custody done properly (per-project keys encrypted at rest), a public
directory of live programs, the seven languages on the desk.

## Status

- **2026-09-16 — Phase 1a, the engine module (`lib/hub/engine.js`, `scripts/hub-engine-test.cjs`).**
  Per-project: config from the version in force, arm/disarm (start date never slides), the hourly
  gate, one hour of accrual (pure), missed slices, the lock scan with the firstSeenAt ledger, the
  tick over the project's own keys, `runAll` over the registry (skipping `cuna` while its legacy
  loop runs), and the holder view. The rules engine gained `cancelableAllowed` and the `vesting`
  shape (defaults = CUNA's behaviour, its 68 rule tests unchanged). One product rule decided in
  code: a **fixed daily pool with no vesting stream is honoured as-is** — CUNA's stream cap only
  applies when the funding wallet has a stream — and the funding status is the guard.
  Not yet: routes (admin / wallet / payout per project), the desk, onboarding.

## What it must never become

No APR/APY anywhere (the teach guard already refuses it). No claim a lock "earns" anything beyond
what the funding wallet has actually put in — funding status shows obligations vs observed balance
vs reserved, and a shortfall is a shortfall. We never hold a holder's tokens: locks are Jupiter's,
rewards are the project's, and a managed payer wallet is opt-in with the responsibility named.
