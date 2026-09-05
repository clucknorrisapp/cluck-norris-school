<!-- Produced 2026-09-05 by a 14-agent read-only mapping run (11 readers, 2 syntheses, 1 critic) plus a critique-driven revision. Plan, not findings: every lead traces to a map with file:line or a live read. Re-baseline against main after #234 before opening finders. -->

# Cluck Norris — Full Live Audit Plan

**Scope:** everything live on clucknorris.app (+ normiequest.app, staking.cunatoken.com, lock.cunatoken.com host families).
**Precondition:** starts *after* PR #234 lands on `main`. The four maps below were taken from `develop` at 2026-09-05T21:50Z, pre-merge — **re-baseline every finder against `main` post-merge**, or half the leads will be stale before they're opened.
**Posture:** read-only. Nothing in this plan executes, arms, posts, or moves anything.

---

## 1. Surfaces ranked by blast radius

### Tier 0 — moves money autonomously (irreversible)
| # | Surface | Why it's first |
|---|---|---|
| 1 | `whirlpool-mm.js` vault/* (open/close/add/remove/swap/sell-clip/transfer/rebalance/buyback/recoup-baseline) + server.js Meteora endpoints | Only code in the repo that signs with an operator key and moves real funds without a human in the loop. Five projects (poke/cuna/dnc/rose/treasury). |
| 2 | CUNA daily burn (`cunaBurnTick`, `/api/cuna-burn/admin`) | Destroys tokens, cannot be undone. Live read: `hasSigner:true, armed:false, totalBurnedRaw:'0'` — fully wired, 690,000 CUNA/day, one flag from firing. |
| 3 | CUNA accrual ledger + payout console (`/api/cuna-stake/*`) | **Armed and accruing live right now** (`armed:true`, 8 qualifying locks). Rule B (exclude-by-creator-*and*-recipient) is the only thing keeping treasury locks out of the pool. Terms are measured FORWARD from our own `firstSeenAt`, never `vesting_start_time` — live CUNA escrows declare **2069 and 2077** (creator-set; Jupiter sets it equal to the cliff), so any code path that trusts the escrow's own start date pools locks that should never qualify. Every accrual bug is a real debt to a real wallet. |
| 4 | Boot ratchets (`cunaConfigRatchet`, `dncConfigRatchet`, `roseEngineConfigRatchet`, `pokeConfigRatchet`) | A non-`&durable=1` live retune silently reverts on the next deploy. Already bit CUNA twice on 2026-08-28. Config *is* a money path here. |
| 5 | `wallRatchetTick` | The one automation coded to close/reopen treasury positions while the vault is paused. Inert today only because `LIQ_ENGINE_KILLED` blocks `liqInterval` registration — not because it's disarmed (`cfg.enabled` defaults true). |

⚠️ **Rows 1–2, current state:** the live read at map time shows **all five vault projects `paused:true`, poke included** — even though poke's code default is ON (`POKE_ENGINE_ON = POKE_ENGINE_OFF!=='1' && !IS_STAGING`, server.js:750), and the burner reads `armed:false` with `totalBurnedRaw:'0'`. Nothing in Tier 0 is trading or burning today. Rank it first for blast radius, not for activity — and whether that pause is the owner's stop is his to say (§4 check 2), not ours to infer. Read-only: nothing here gets resumed, armed, or unpaused by this audit.

### Tier 1 — money the user signs (our bytes, their funds)
| # | Surface | Why |
|---|---|---|
| 6 | `public/airdrop-engine.js` (SPL + hand-rolled SOL transfer ix) | Hand-encoded instruction bytes in a browser with no `Buffer`. The documented trap that killed three money paths at once. Used by both `/airdrop` and Buy Special payouts. |
| 7 | `hatchery.js` build/submit/minted | Server builds a fee-bearing tx, client signs, server co-signs with an ephemeral mint key. `builtIxsPreserved()` is the only thing stopping a stripped fee transfer. |
| 8 | `/api/lock/create-tx`, `/api/lock/claim-tx`, `/api/lp-rescue/build-withdraw`, `securitycoop /revoke`, `swap.js /build /submit`, `token-metadata/prepare`, `token-authority/prepare` | Unsigned-tx builders. A wrong account, authority, or amount is the user's loss, on our brand. |
| 9 | Buy Special draw/payout + buycomp payout | Per-comp `payoutToken` (not the admin key) authorizes a recipient list. Different secret, different blast radius. |
| 10 | `/api/claim` → diploma cNFT mint | Treasury-paid mint, per-wallet idempotency + atomic daily cap reservation. **Gate auto-armed 2026-09-02 — enforce mode is live as of today and nobody has read the `[GRAD-GATE]` counters.** |

### Tier 2 — auth / gates (revenue + access)
| # | Surface | Why |
|---|---|---|
| 11 | Unified tools pass (`/api/tool-gate/config` + `cluck-gate.js` + `clkn_tools_unlock`) | The map could not locate a server-side on-chain confirmation for the 0.05 SOL payment. If enforcement is localStorage-only, the pass is free. Highest-value single lead in this audit. |
| 12 | NQ tier gate (`/api/nq/wallet/config`, `/api/nq/gate`) | Same question: is world 4-12 access enforced when the level content is served, or only in client JS? |
| 13 | `adminAuthOK` (~20+ endpoints, `x-premium-key` **or `?key=`**) | One secret gates posting, payouts, draws, engine arm/disarm, config writes. `?key=` in a URL lands in logs, referrers, browser history. |
| 14 | Premium 2M holder gate + connect-and-sign (`/api/premium-verify-sig`, jupverify submit, `nq/wallet/verify`) | Nonce/replay window, `minHold:0` paths, and the `Math.min(reqFloor, PREMIUM_HOLDER_THRESHOLD)` clamp that stops a low-floor request weakening premium. |
| 15 | `POST /api/burn-receipt` | Public, unauthenticated, and its success causes a post to the brand X account and public Telegram. Verified on-chain and rate-limited — but it is the one lever a stranger can pull on our channels. |
| 16 | Normie Quest weekly prize console (`nq-claims.js`; `GET /normie-quest-x7/prizes`, `/api/nq/claim/status|prepare|claim`) | The only PII surface in the estate: shipping addresses, AES-256-GCM at rest, key from `NQ_CLAIM_SECRET` or HMAC(`PREMIUM_ACCESS_KEY`,'nq-claims-v1') with **no random fallback** (claims refuse with `not_configured` rather than store undecryptable PII, nq-claims.js:44-48). Decrypted **only** in the masterOK-gated console (routes.js:653); `markShipped()` deletes `addrEnc` permanently. The consent signature embeds a SHA-256 of the normalized address, so a captured signature can't redirect a prize. Money-adjacent but not money — nothing in code promises a NORMIE payout, and **prize/reward terms are unagreed, so the audit reads this flow and promises nothing**. No map read its live state (nq-live-telemetry left it untouched on purpose). |
| 17 | CF origin lockdown (`X-Cluck-Edge-Auth`) + `/api/tg/:secret` dual-secret | The edge is the outer wall for everything above. |

### Tier 3 — public copy and honesty
| # | Surface | Why |
|---|---|---|
| 18 | `README.md` (233 lines) + `public/investors.html` (683 lines) | Read by people evaluating the project. A claim that isn't true in the code is a real problem. |
| 19 | "Say what's on-chain, never why" across autopsy / X-Ray / holders / trace / burn + Telegram output | The brand claim. Any "creator"/"team"/"insider" label not backed by a launchpad API is a breach of it. |
| 20 | Removed-feature and retired-gate references (Ultimate Challenge, Survival Sim, Cluck Score, Coop Spinner, `/curriculum`, Token Vitals, send-to-unlock, per-tool 50k/100k thresholds, Solana Foundation) | Retired things that still appear in copy read as live promises. |
| 21 | Count guards + i18n | `en` has no file — six locale sets (`es hi it pt vi zh` × base/`.school`/`.locker`) drift silently when English copy changes. Recent commit `b3d0873` (12→14 classes) shows the count claim moves. The **“seven languages”** claim (en/es/hi/it/pt/vi/zh, per CLAUDE.md the number to quote in grant material) is a README/investors claim — verify it inside #18's claim-by-claim pass, not as a separate opinion, so one number is checked once against `public/i18n/*.json`. |
| 22 | Route-name ≠ served-file drift, now suspected in the API layer | Verified for a dozen HTML routes; `airdrop-comp/check` vs `tool-comp/check`, `buyspecial-crosscheck/holdcheck/trace`, `lp-scan/lp-top/lp-token-search` look like the same historical-merge pattern. |

### Tier 4 — everything else
| # | Surface | Why |
|---|---|---|
| 23 | Broadcast layer (`postToX` 12 call sites, `tgSend`/`tgSendKb`/`tgSendPhotoKb`, `broadcastBurnCelebration`) | Reputational, not financial — but a wrong post can't be recalled. |
| 24 | Non-money schedulers (grad watchers, recap, lesson, chain spotlight, buy pollers, source health, whale refresh) | Silent-failure class: they report green while doing nothing. |
| 25 | Normie Quest (`normie-quest/routes.js`, mounted at root, no prefix) | Public since 2026-08-22, its own money path (NORMIE burn, wheel, claims) and its own render gates. |
| 26 | Shared client modules (`cluck-wallet.js`, `cluck-util.js`, `cluck-gate.js`, `market-header.js`) vs private copies | Drifted copies have caused real bugs, including a missing single-quote escape. |
| 27 | CI coverage vs 317 routes | `node --check` + ~25 targeted scripts. The three mounted routers' HTTP layer, jupverify, and the admin/test endpoint family appear to have no functional test. |

---

## 2. Audit dimensions

Rule for every dimension: **finders produce leads with file:line evidence, verifiers try to kill them.** A verifier's job is refutation, not confirmation — its default output is "not a finding, here's why". Anything a verifier can't refute goes to synthesis.

Model tier per CLAUDE.md: Haiku for mechanical/verifiable, Sonnet for the workhorse reading and fix-drafting, Opus/Fable only where being wrong costs money or the brand.

---

### A. Money-path integrity (server-signed)
**Finders (4, Sonnet):** vault mutation routes end-to-end (auth → scope allowlist → amount derivation → signer identity); burner arming chain + double-burn guards + claim-first logic; accrual arithmetic in `lib/cuna-staking.js` / `lib/cuna-programme.js` (day split, weights, `owed()`, `firstSeenAt` forward-measurement, 2069/2077 escrow declarations); **`swap.js` (`/api/swap/build|submit`, the CLKN↔NORMIE swap desk, swap.js:56-70)** — no map described its logic or auth beyond naming it a mounted router, so it enters the audit **unread**: who signs, how the quote and amounts are derived, whether `submit` can be handed an arbitrary transaction, and whether the never-sell brand-bag rule can be reached through it.

**The four things that hold the CUNA money — check all four, not just Rule B:** (1) Rule B, exclude-by-creator-*and*-recipient, with `validateConfig()` refusing to let `excludeWallets` ever drop the treasury; (2) the two-flag arm on the staking program (nothing is written while disarmed, which is what protects `firstSeenAt` integrity); (3) the burner's own arming chain — kv `cunaBurn.armed`, a configured wallet, and the **separate** `CUNA_BURN_SECRET` env var, deliberately distinct from `MM_OPERATOR_SECRET_TREASURY` so arming one feature can't grant burn power — plus the signer-pubkey-equals-`cfg.wallet` check; (4) terms measured forward from `firstSeenAt`, never `vesting_start_time`. A finder that clears one and assumes the class is clean is the failure mode CLAUDE.md warns about.

**Naming convention (carry it into every finding and any fix):** prose says **program**; the file is **`lib/cuna-programme.js`** and that spelling is the owner's. Never “correct” it in a rename, an import, or a doc reference — that is the same naming-drift trap as the `esc`/`WALLETS` variants.
**Verifiers (2, Opus/Fable):** must try to refute — "can a request reach a signer with a mint outside the project allowlist?", "can two ticks burn the same day?", "can a treasury lock enter the accrual pool through the recipient field rather than creator?", "does a `sending`-state crash re-send blind?". Opus because a wrong verdict here is the burner or the treasury.
**Known leads in:** #4 ratchet override only confirmed for `dnc` (server.js:1163-1180) — cuna/rose inferred from comments, unverified; #5 `wallRatchetCfg.enabled` defaults true; live vault state all five `paused:true` while poke's code default is ON.

### B. Gate enforcement — client vs server
**Finders (3, Sonnet):** tools-pass SOL payment path (grep the whole repo for the verification route, `clkn_tools_unlock` writers, `/api/verify-sol-payment` callers); NQ level/world/asset serving vs `/api/nq/gate`; premium 2M re-check on every run + the `minHold:0` transcript path.
**Verifiers (2, Opus/Fable):** refute by constructing the bypass on paper — "with devtools and no wallet, what exactly stops RUN?", "does the server ever see the pass?", "is a world-4 asset URL guessable and unauthenticated?". Opus: this is the revenue gate and the answer changes what ships next.
**Known leads in:** map flagged both the SOL-payment verification and NQ server-side enforcement as **not located**, explicitly as gaps, not as clean.

### C. Admin/auth surface
**Finders (2, Sonnet):** enumerate every `adminAuthOK` / scoped-key route and classify by worst-case effect (posts / pays / arms / destroys / reads); audit `?key=` acceptance vs header-only, 404-on-fail consistency, POST-only enforcement on mutating query params.
**Verifier (1, Opus/Fable):** refute "the key is adequately protected" — where does it end up in logs, error bodies, Cloudflare analytics, docs, or a runbook example URL? Opus because one secret fronts payouts and the burner.
**Known leads in:** `?key=` accepted alongside header; `/api/whirlpool/vault/pause` POST-only trap that reads as "endpoint gone" mid-stop; **`whirlpool-mm.js` `vault/client/*` (login, message, status, positions, costs, earnings, pause, resume, modes, mode — whirlpool-mm.js:385-421)**, a client-facing MM dashboard whose serving page/host and public linkage no map could confirm — find the UI, establish its auth (`vault/client/pause` is POST-only), and decide whether it is an unlisted public surface. Also: NQ's own gates are a different key family — `adminOK`/`masterOK` accept only `?key=` or `x-nq-key`, and reject `x-premium-key` outright (verified live), so the header-only rule in §4 cannot be satisfied there at all.

### D. Broadcast safety
**Finders (2, Sonnet):** trace the untraced `postToX` call sites (server.js:5171, 5342, 5360, 5513 — no `opts`, so pause-gated, but callers unknown); trace the meme/image path `queueMemeRequest` → `handleContentApprovalCallback` → actual room post, end to end.
**Verifier (1, Sonnet):** refute "no attacker-controlled string reaches a brand channel unsanitized" and "no staging deploy can post unlabeled". Sonnet, not Opus — reputational, recoverable, no funds.
**Known leads in:** `broadcastBurnCelebration`'s Telegram leg calls the Telegram API directly at server.js:1726-1729, bypassing `tgSend` and therefore its `[STAGING]` prefix; `tgSendKb`/`tgSendPhotoKb` have no staging label at all; giveaway board auto-posts publicly every ~5 min during an active window. **Known unknown, state it as such:** the `CUNA_PUBLIC_ROOM` / `CUNA_OPS_CHAT_ID` broadcast paths (giveaway / lock-and-earn, referenced around server.js:11016-11046) were **not traced** — the map saw only the chat-id resolution lines, not the posting logic or its user-reachable triggers. That is uncovered ground, not clean ground.

### E. Public honesty (docs ↔ code)
**Finders (3, Sonnet):** README claim-by-claim against code; `investors.html` claim-by-claim; a sweep of all public copy + Telegram/X templates for causal language about wallets ("team", "creator", "insider", "rugged", "scam") not backed by a launchpad API.
**Verifier (1, Opus/Fable):** refute each claimed mismatch by finding the code that *does* support it. Opus: these are the brand and the hackathon entry; a false "your README lies" finding costs owner trust, a missed one costs credibility with evaluators.
**Known leads in:** none pre-flagged — this dimension starts empty by design.

### F. State-vs-docs drift
**Finders (2, Sonnet):** every `⛔`/"SHIPS DISARMED"/"ON BY DEFAULT"/"KILLED" assertion in code comments, CLAUDE.md and `docs/` checked against the live read; every hardcoded const kill switch (`LIQ_ENGINE_KILLED`, `X_AUTOPOST_PAUSED`, `JUP_AUTO_REBALANCE_KILLED`, `WALLET_WATCH_KILLED`) checked against what actually registers.
**Verifier (1, Sonnet):** refute each drift claim from the live endpoint, not from the doc.
**Known leads in:** server.js ~10499 comment says CUNA staking "SHIPS DISARMED … no one earns until I make the announcements" while `/api/cuna-stake/config` reads `armed:true` — **highest-confidence drift lead in the set**; docs say POKE is ON by default while all five vault projects read `paused:true`; `GRAD_GATE_AUTO_ENFORCE` (2026-09-02) has passed so `/api/claim` is enforcing today.

### G. Injection / XSS / attacker-controlled strings
**Finders (2, Sonnet):** every `innerHTML` sink fed by API/chain/URL data vs `CluckUtil.esc`; every hand-rolled escape variant (`function esc(`, `var esc =`, `const esc = s =>`, `escapeHtml`, `tgEsc`) checked for the single-quote gap. **Check every form, not one form** — this is the failure mode that cost a day.
**Verifier (1, Sonnet):** refute by proving the sink is text-only or the value is server-derived.

### H. Dead code, route drift, CI coverage
**Inventory (2, Haiku, low effort):** **locate the `lock.cunatoken.com` host-matching block, or state on the record that none exists** (server.js:3388-3391 names it in a comment; 3427-3457 handles only normiequest.app and staking.cunatoken.com) — a grep with a right answer, and it must land in phase 0 because §4 check 9 and the Tier-3 route-drift lead both depend on the answer; dump all 317 routes with method + handler line + first-line comment; dump every `public/*.html` and mark which have an explicit `app.get` vs which only work post-`npm run build`; dump every CI script and the file it actually targets.
**Finder (1, Sonnet):** from those inventories, name the duplicate/orphan/unreferenced set and the untested money routes.
**Verifier (1, Haiku):** "is this really unreferenced?" is a grep with a right answer — cheapest possible confirmation, paired with `effort: 'low'`.
**Known leads in:** the API-layer duplicate families; `lock.cunatoken.com` has no located host-router block (server.js:3388-3391 comment names it, 3427-3457 handles only the other two); `public/` 404s on a no-build boot.

### I. Normie Quest
**Finders (2, Sonnet):** NQ money/claim paths (`burn-tx`, `burn-send`, `wheel/spin`, `rewards/claim`, `claim/prepare`, `claim`, `promo`, `pair/*`) — this router mounts at root with no prefix, so its auth is entirely its own; plus the public pages under `/normie-quest-x7`.
**Checks (1, Haiku):** run `nq-geometry-check.cjs`, `nq-boss-ground.cjs`, `nq-visual.cjs`, `nq-tier-gate-test.cjs`, `nq-claims-test.cjs`, `nq-leaderboard-test.cjs` and report output verbatim. Running a test and reporting output is exactly the Haiku case. **Do not** run the full 90-level state test unless a level def changed — `nq-verify.cjs <baseUrl>` reads the diff and picks.
**Verifier:** none separate; fold into synthesis.

### J. i18n + count guards
**Inventory (1, Haiku):** run `scripts/i18n-scan.js` + `i18n-sweep.js`, `check-counts.js`, `check-jsx-components.js`; report the key-drift delta per locale and every count claim vs actual. Mechanical, verifiable, one right answer.

**Model-tier summary:** Haiku = 5 agents (inventories, test-running, drift counts). Sonnet = 21 (all finders + non-money verifiers). Opus/Fable = 6 (money verifier ×2, gate verifier ×2, admin-key verifier ×1, honesty verifier ×1) + 1 synthesis. Opus is spent only where a wrong verdict costs money, the gate, or the brand — a verifier on a stale comment is not worth the tier.

---

## 3. What cannot be verified from a cloud container

No keys, no wallet, no phone, no Cloudflare console. These have **never** been exercised end-to-end by any session — and per CLAUDE.md that is exactly where the worst bugs hide. Audit them by reading code and by asking the owner to drive.

**Cannot verify here → ask the owner to exercise by hand:**

| Thing | Why blocked | Ask the owner to do |
|---|---|---|
| **CUNA accrual is armed and accruing** | A read-only map can see `armed:true`; it cannot see whether the owner intended it, and no session may arm or disarm it | **Notify first, audit second.** Tell the owner that `/api/cuna-stake/config` reads `armed:true` with 8 qualifying locks while server.js ~10499 still says “SHIPS DISARMED … no one earns until I make the announcements”, and ask whether that is his arm. Real wallets are accruing today. **Read-only: do not arm, disarm, or write config** (§6) |
| Rendered autopsy report (incl. premium sections) | Needs a real forensics run + holder proof; harness must report `REPORT RENDERED: true` or the numbers are the idle page | Run one autopsy on a known token, screenshot the rendered report top-to-bottom, incl. the off-theme premium sections (that styling call is still open) |
| Real Jupiter Lock create + claim | Needs a funded wallet and a signature | Create one small real lock via `/locker-room`, confirm the attribution memo lands, then claim it. Confirm no "may be malicious" warning appeared |
| Connect-and-sign with a real wallet | Phantom/Solflare/Jupiter Mobile in a real browser; recent commits `0d7ab90`/`03defa5` touched exactly this | Connect + sign on desktop Phantom and on Jupiter Mobile's in-app browser; confirm disconnect actually clears state and shows which wallet is connected |
| Tools-pass 0.05 SOL payment | Requires sending SOL and observing whether the server ever verifies it | **(owner-only — do not attempt from a session: this spends SOL, it is an execute, not a read.)** **Owner pays the 0.05 SOL pass from a wallet holding zero CLKN.** Then, from a *different* browser profile, checks whether the pass can be granted without paying. This single test settles lead #11 |
| NQ tier gate | Same shape, NORMIE side | From a wallet holding no NORMIE, confirm world 4 is actually unreachable — not just hidden |
| Hatchery mint (build → sign → submit → announce) | Needs fee SOL + a real mint | Mint one throwaway token; confirm the fee landed in `HATCHERY_TREASURY` and the Telegram announce references the real mint |
| Diploma cNFT mint + `/api/claim` under enforce | Treasury-signed; gate armed 2026-09-02 | Complete one course run as a fresh browser and confirm a legit learner is **not** blocked; paste the recent `[GRAD-GATE]` / `blockedOrWouldBlock` numbers |
| Airdrop batch send (SPL + SOL) | Real transfers | Send one 2-recipient dust batch, both token and SOL legs, from a phone browser and a desktop |
| Buy Special draw payout / buycomp payout / CUNA payout mark-sent | Moves funds | Owner-only; audit reads code and the public draw-reproducibility endpoint instead |
| Any burn, any engine arm, any vault action | Money rules | Not in scope — see §6 |
| Live X / Telegram posting | Would post | Owner confirms the last lock post and last burn celebration rendered correctly; we read templates only |
| Cloudflare WAF + `X-Cluck-Edge-Auth` origin lockdown | Infra, not repo | Owner confirms direct-to-origin-IP still 403s and `/healthz` still passes; confirm staging does **not** share `TELEGRAM_CHAT_ID` with prod (this settles the burn-celebration staging lead, which is a code gap, not a confirmed misconfig) |
| NQ weekly prize console + claim flow (live state) | masterOK-gated and it decrypts shipping addresses; NQ's gates don't accept the `x-premium-key` header at all, so reading it would break §4's no-`?key=` rule as well as the no-PII posture | **(owner-only — do not open from a session.)** Owner opens `/normie-quest-x7/prizes` himself and reports **counts only** — pending winners, shipped rows, whether the encryption key is configured (a `not_configured` refusal is the tell) — never address content. Sessions read `nq-claims.js` and the test instead |
| Normie Quest on a real iPad | The four dead audio states, incl. the zombie | Owner plays 5 min on iPad with the pause card open, reports the live `audio:` line |
| Visual baselines | Cross-machine pixel variance is the whole reason the char surfaces are advisory | Owner eyeballs any `--update` baseline PNGs before they're committed |

---

## 4. Live-data checks (production reads only)

**Hard rules for every live call, no exceptions:**
- GET only. Never `post=1`, `run=1`, `loud=1`, `sweep=1`, `unpay=`, `arm=1`, `draw=1`, `reset=1`, `durable=1`, `force=1`, `on=1`, `off=1`.
- Admin key via **`x-premium-key` header only**, never `?key=` (it lands in logs — that's lead #13).
- Chain balances via `getTokenAccountsByOwner` (jsonParsed, **both** token programs) + `getBalance` POSTed to `/api/helius-rpc`. **Never** read balances with `/api/wallet-xray` or autopsy — they're activity scanners and have produced two wrong balance reports.
- Read production, not staging, and record the timestamp on every reading.

**Checks:**

1. **CUNA accrual vs on-chain.** `/api/cuna-stake/config` + the ledger vs the actual Jupiter Lock escrows on-chain. Confirm: (a) every qualifying lock's creator **and** recipient are outside `excludeWallets`; (b) treasury `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8` appears in neither role in any pooled lock; (c) `firstSeenAt` is the term origin, not `vesting_start_time` (live escrows declare 2069/2077); (d) the daily-unlock ceiling math against the actual paying wallet's balance; (e) sum of owed vs `poolDailyRaw` × elapsed days. This is the check that matters most — the ledger is live and accruing. **Before filing anything from this check, raise the armed-state question with the owner (§3):** no session can tell from outside whether `armed:true` was intended, and every day it runs is debt recorded against real wallets.
2. **Engine states, all five.** `GET /api/whirlpool/vault/status?project={poke,cuna,dnc,rose}` and **without** `project=` (which returns the CLKN project, **not** treasury — the mistake that redeployed a live vault two minutes after a stop). Record `paused`, mode, config, position count. Diff against what code comments and `docs/` claim. The maps read all five `paused:true`; confirm that's still true and **ask the owner whether that's his stop** rather than inferring.
3. **Burner readiness.** `GET /api/cuna-burn/admin` (no `run`): `armed`, `hasSigner`, `amountRaw`, `hourUtc`, `daysBurned`, `totalBurnedRaw`. Expect `armed:false`, `totalBurnedRaw:'0'`. Any drift from that is an immediate escalation, not a finding to file.
4. **Ratchet override state.** For each engine, compare the live config against the hardcoded `want` block. Anything the owner tuned that isn't in `ratchetOverrides:<project>` will revert on the next deploy — list it explicitly so he can re-write it durably before the next push.
5. **Scheduler heartbeats.** Confirm the schedulers actually started: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` must both be set at boot or the whole block never registers. Read the accrual watchdog's last-slice timestamp, the source-health daily all-green, the last recap/lesson/lock-report timestamps, the reconcile backstop, and the buy pollers — via dry-run GETs on the `*-test` endpoints **with no `post=1`**. Goal: catch the silent-failure class where a timer reports green on the wrong thing.
6. **Gate configs sane.** `/api/tool-gate/config` (`clknNeeded` within the 10× price sanity band, `enabled:true`, receiver address correct), `/api/nq/wallet/config` (tier1/tier2 USD-priced, `usdPriced:true`), `/api/hatchery/config` (fee + CLKN discount computed live). Confirm no page hardcodes any of these amounts — grep for the literal numbers currently returned.
7. **i18n key drift.** `scripts/i18n-scan.js` + `i18n-sweep.js`. English has no file; six locale sets × three files each. Report per-locale missing/orphan keys. Any English string edited in this batch without a key sync silently drops six languages.
8. **Count guards.** `scripts/check-counts.js`, `check-jsx-components.js`, `engine-sim-test.cjs`, `nq-geometry-check.cjs`, plus the curriculum drift guard. Commit `b3d0873` moved the class count 12→14 — confirm every surface (tutor prompt, i18n keys, README, investors, Telegram About card) now says 14.
9. **Public reachability.** HEAD every documented public route incl. every `public/*.html` raw URL and the redirect pairs (`/grant`→`/investors`, `/token-vitals`→`/holders`). Confirm `/api/*` 404s are real JSON 404s and not the React shell at 200. Confirm the three host families resolve as intended — including `lock.cunatoken.com`, whose router block was never located (phase-0 inventory owns finding it).
10. **NQ prize/claim flow — state only, no PII.** `GET /api/nq/claim/status` (public read, rate-limited) for the weekly window and whether a winner is pending. ⛔ **Do not open `/normie-quest-x7/prizes`** — it is the only place shipping addresses are decrypted, and NQ's `masterOK` takes the key only via `?key=` or `x-nq-key` (the `x-premium-key` header is rejected, verified live), so opening it would break both the no-`?key=` rule above and the no-PII posture. Live state for that console comes from the owner (§3), not from a session.

---

## 5. Ordering and rough cost

| Phase | What | Agents | Model | Gate to next phase |
|---|---|---|---|---|
| 0 | Re-baseline on post-#234 `main`; route/page/CI/test inventories; locate the `lock.cunatoken.com` host block (or prove none exists); i18n + count guards; live-data reads §4 | 5 Haiku + 2 Haiku live-readers | Haiku, low effort | Inventories exist and live state is on paper |
| 1 | Finders across dimensions A–I, each seeded with its known leads | 19 Sonnet | Sonnet | Every lead has file:line evidence or is withdrawn |
| 2 | Verifiers — refute-first | 4 Opus (money ×2, gate ×2) + 1 Opus (admin key) + 1 Opus (honesty) + 4 Sonnet (broadcast, drift, XSS, dead code) | mixed | Surviving findings only |
| 3 | Synthesis: dedupe, rank by blast radius, split into "fix now / fix in batch / owner decision", draft the PR batching | 1 Opus/Fable | Opus | Owner reads one document |

**Total ≈ 36 agent runs.** Roughly: 7 Haiku, 23 Sonnet, 6 Opus. Phase 1 is the bulk of the token spend; phase 2's Opus calls are the bulk of the cost per agent.

**Parallelism:** phase 0 all at once; phase 1 in two waves (money/gates/admin first, then copy/drift/dead-code) so verifiers can start on the Tier-0 leads while the rest are still finding.

**If you want it cheaper, cut in this order — each line is a real reduction in confidence, listed least-costly-to-lose first:**
1. Dimension H (dead code / route drift / CI coverage) — 3 agents. Pure hygiene; nothing here loses money today.
2. Dimension I finders — 2 agents. Keep the Haiku test-runner; drop the code reading. NQ has the most CI coverage of anything in the repo.
3. Dimension G down to one finder — the `esc` sweep is a grep, and check-every-form can be done by one agent with a good pattern list.
4. Dimension E from 3 finders to 1 — README + investors in one pass, drop the standalone causal-language sweep.
5. Drop the Opus honesty verifier, self-verify at Sonnet — saves one Opus run, accepts a higher false-positive rate on copy findings.

**Do not cut, at any price:** dimension A (money), dimension B (the tools-pass and NQ enforcement questions), the dimension F CUNA-armed drift check, live-data checks 1–4, and the phase-3 Opus synthesis. Cutting synthesis is how 30 agents' findings become 30 unranked bullets nobody acts on.

---

## 6. Non-goals — explicit

- **Wallet Watch is not a surface.** It is private, its scheduler is hard-killed, and its public exposure is currently zero. It will not be listed, linked, described, counted in an endpoint roundup, or mentioned in any audit output, summary, PR, investor copy, or promo. Nothing will stop a finder from adding it — so this is stated up front and repeated in every finder's brief.
- **Nothing executes.** No engine armed, disarmed, paused, or resumed. No burn. No swap, rebalance, open, close, add, or remove liquidity. No payout, no mark-sent, no draw, no sweep. No `&durable=1` config write — including "helpfully" re-writing a reverted owner tuning. **PLAN ≠ EXECUTE:** the audit states the exact fix and stops; the owner picks the parameters and gives the go.
- **Nothing posts.** No `post=1`, no `loud=1`, no `force`. No X, no Telegram, no test post into a real chat. Telegram is silent by default and stays that way.
- **Nothing rebuilt.** Ultimate Challenge, Survival Simulator, Cluck Score, Coop Spinner, `/curriculum`, Token Vitals, and send-to-unlock stay removed. Finding a reference to one is a copy finding, not a reinstatement ticket.
- **Closed decisions stay closed.** Solana Foundation, CoinGecko. No reapplication, no re-adding the tag, no work premised on either.
- **No promotion to `main`.** Everything lands on `develop`. Promotion is the owner's explicit go in the moment, never inferred from "the audit passed".
- **Nothing destructive to git.** No force-push, no `reset --hard`, no branch deletion — that was never granted.
- **No NORMIE reward or prize promises.** Access tiers are owner-set and public; rewards terms are unagreed. VIP-wing terms are owner-to-confirm. The weekly physical-prize flow (Tier-2 #16) is audited as a **PII and auth surface only** — findings describe how it protects addresses and who can decrypt them, never what a winner gets or when. Any change to its gating is an OWNER DECISION / security review before implementation, not an audit fix.
- **No findings invented.** Every lead in this plan traces to a map with file:line or a live read with a timestamp. A finder that returns "looks fine" is a valid result; a finder that returns a plausible-sounding bug it can't point at is worse than nothing. If a check didn't run, the audit says so — most of the worst bugs here survived because something reported green on the wrong thing.