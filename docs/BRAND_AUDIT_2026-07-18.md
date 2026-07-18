# CLUCK NORRIS BRAND AUDIT — 2026-07-18

**What this is:** the canonical memory file for the full-property brand audit of clucknorris.app (repo `clucknorrisapp/cluck-norris-school`). Inputs: a complete surface inventory, four analysis lenses (redundancy, weakness, funnel, brand), and five growth perspectives (CT operator, product-led-growth, SEO, tokenomics, skeptic). Everything below was verified against the live site and repo on 2026-07-18 unless marked otherwise. **Note on the header date:** the audit run passed no label; this document is dated by audit date. Nothing was found broken at the API level — all inventoried pages return 200 and every backing route responds. The problems are copy drift, discoverability, contradictions, and focus.

---

## 1. THE MAP — everything the app has

### Free public research tools
| Surface | One line | Status |
|---|---|---|
| **Token Autopsy** (`/autopsy`) | AI forensic agent: classifies any mint's death mode, writes a teaching case study in Cluck's voice; premium deep-trace embedded inline | ✅ healthy — featured in "Start Here" |
| **Wallet X-Ray** (`/wallet-xray`) | Whole-wallet deep dive + behavior classification + "Ask Cluck" AI chat; the free flagship that replaced Cluck Score | ✅ healthy — but **noindexed by accident** (line 7) |
| **Trace** (`/trace`) | One wallet × one mint chronological forensic history with funding hops | ✅ healthy |
| **Snapshot** (`/snapshot`) | Point-in-time holder list, LP/team-filtered, airdrop-ready CSV | ✅ healthy |
| **Holders** (`/holders`) | Analytics lens over the same Snapshot engine (⚠️ page uses `/api/snapshot`, NOT `/api/holders` — that's a separate CLKN-stats endpoint used by grant/investors/school) | ✅ healthy |
| **Token Vitals** (`/token-vitals`) | Deliberately no-score fact sheet — the philosophical successor to the removed Cluck Score | ✅ healthy |
| **Wallet Safety Checkup** (`/wallet-checkup`) | Read-only paste-an-address drain-risk scan; routes to Security Coop for treatment | ✅ healthy |
| **Bags Hub** (`/bags`) | Live Bags.fm launches/graduations feed; pipeline verified alive | 🟡 orphaned — not on tools.html or cluck-nav |
| **Tools hub** (`/tools`) | Index of the toolkit; canonical per-tool positioning | ✅ healthy — meta description still says "token health scoring" (stale) |

### Premium / payments layer
| Surface | One line | Status |
|---|---|---|
| **CLKN micropayment rail** | Unique-decimal send to the receive wallet, no wallet-connect, on-chain verified, sigstore replay-guarded (fails closed) | ✅ audited sound |
| **Holder bonus** | ≥2M CLKN post-send → 5× every grant, read from the payment tx | ✅ healthy (2M lives in two constants + Normie Quest — divergence risk) |
| **Premium Forensics** (`/premium`, `/api/autopsy-premium`) | 2M-holder-gated deep trace; **all five roadmap features shipped** despite stale "planned" comments | ✅ healthy |
| **Coop Spinner slots** (`/slots`) | Hold-gated (500k) provably-fair spins → weekly wheel | ⚠️ two live contradictions (gating path + prize copy) |
| **Airdrop tool** (`/airdrop`) | Client-side batch sender, 100 CLKN unlock | ✅ works; unlock semantics disagree across 4 surfaces |
| **Buy Special** (`/buyspecial`) + **Rose** (`/rose`) | Two paid buy-comp trackers on the SAME engine at the same price — users can't tell them apart | ⚠️ merge candidate |
| **Buy Special draw** + **buycomp admin** | Operator raffle + ranked live-leaderboard comps | ✅ healthy, operator-only |
| **Vested Buy Special** | Bonus-vests-via-Jupiter-Lock campaigns; payout loop shipped 2026-07-16 | 🟠 **never run end-to-end** |
| **Credential Tier-2 ownership proof** | 1-CLKN send proving transcript wallet ownership | ✅ healthy |

### School
| Surface | One line | Status |
|---|---|---|
| **Core curriculum** (12 belt lessons) + **Incubator** (7 beginner) + **LP Lab** (12 advanced, calculators) + **Library** + **Survival Simulator** | The actual school, React SPA at `/school` | ✅ healthy |
| **Ultimate Challenge exam** | 50 Q, 94% pass, server-scored, stratified draw from 210-question bank | ⚠️ working as designed but **0 passes ever** |
| **Credentials/transcripts** | Permanent per-wallet records, public `/transcript/:slug` with proper OG cards, cNFT diplomas | ✅ healthy — 9 transcripts, all self-reported, 0 verified |
| **/curriculum SEO mirror** | Static HTML for crawlers, no answer key | 🟠 stale: says "six languages," omits Hindi; 81 LP-quiz texts never render (shape mismatch) |
| **i18n (7 languages)** + **TTS read-aloud** | Curated dictionaries en/zh/es/it/pt/vi/hi + ElevenLabs Cluck voice with /data cache | ✅ healthy (TTS audio verified in only 4 of 7 langs) |
| **/learn pages** (18 assets × 7 langs) | The best-built SEO surface on the site | ✅ healthy |
| **AI Classroom** (`/classroom`) + **Ask Cluck** (`/ask-cluck`, alias `/crypto-school`) | Live AI lectures grounded on a third, manually-regenerated lesson copy | ✅ healthy; grounding file has no drift guard |

### Locker + DeFi
| Surface | One line | Status |
|---|---|---|
| **Jup Locker Room** (`/locker-room`) | Free non-custodial locks on the Jupiter Lock program incl. unverified Token-2022 that lock.jup.ag won't list; on-chain "locked via clucknorris.app" memo; Lock of Fame | ✅ code excellent — **worst discoverability on the site** (no sitemap, no README, school links external lock.jup.ag) |
| **Liquidity tool** (`/liquidity`, `/liquidity-engine`) | Both routes serve a locked "In Development" placeholder; build endpoints 403'd (`ENGINE_PUBLIC_LOCKED`) | 🟡 hidden by owner's call; unrouted files contain false "live today" copy |
| **Security Coop** (`/security-coop`) | Connect-and-revoke approval cleaner (Checkup's treatment arm) | ✅ healthy |
| **Hatchery** (`/hatchery`) | Guided SPL minter that deliberately stops at the mint; teaches locking but doesn't link the Locker Room | ✅ healthy |
| **LP Scanner** (`/lp-scanner`) | Market-wide pool analytics — operator-only since 2026-07-04 | 🟡 hidden by design |

### Game (Normie Quest — friend's NORMIE token)
| Surface | One line | Status |
|---|---|---|
| **Platformer** (`/normie-quest-x7`) | 34-level Phaser game, unguessable URL, noindex, linked nowhere — containment verified holding | ✅ healthy, deliberately hidden |
| **Premium layer** (lab lane: leaderboards, wallet tiers, burn-to-play, Jupiter buy widget) | Dormant behind `__NQ_SETUP`; ≥2M CLKN = full access (cross-brand hook already wired) | 🟠 unfinished by design |
| **Telemetry/feedback/digest/PWA/music** | All healthy; twice-daily AI digest to operator | ✅ healthy |
| **Two dead prototypes** | 4.9 MB of unrouted HTML in every clone | 🔴 delete |

### Socials / automation
| Surface | One line | Status |
|---|---|---|
| **LIVE:** buy/sell poller + 12-min reconcile + arb suppression; Cluck's Lesson (1×/day X, carve-out); Chain Spotlight (2×/day, only poster with failure alerting); daily lock report; lock-celebration handoff (session-dependent image leg); NQ digest; school grad watcher; source-health monitor; TG webhook/commands | The working spine | ✅ |
| **DEAD-BUT-TICKING:** tools reminder, Bags radar, recap, market check, outreach, tool spotlight, daily alpha, grad watcher, content engine, X blitz | Const/kv-disabled; several would silently no-op against `X_AUTOPOST_PAUSED` if revived | 🟡 trap class |
| **KILLED:** Wallet Watch (`WALLET_WATCH_KILLED`, was ~90% of Helius bill); ALL liquidity ticks incl. read-only OOR monitors (`LIQ_ENGINE_KILLED`, 2026-07-14) | ⚠️ CLAUDE.md still describes several as live | 🔴 doc drift |
| **STALE:** 12h ops report hardcodes "Engine: ±3%" for a dead engine; whaleRefresh burns a daily holder walk for a killed consumer | 🔴 fix |
| **Media pipeline** | Higgsfield MCP + MEDIA_LIBRARY.md manifest, session-driven | ✅ healthy |

### Ops / infra
| Surface | One line | Status |
|---|---|---|
| **lib/rpc failover** | Sound design, but ~25 call sites + all of helius-trades bypass it with raw primary-key fetches | ⚠️ partial adoption |
| **kvstore** | Single non-atomic JSON file now backing payments-adjacent dedupe, analytics, vault state | ⚠️ one truncated write loses everything |
| **/data volume** | Single durable store; all consumers degrade gracefully; sigstore fails closed | ✅ |
| **Source-health monitor** | Probes ST/Helius/Bags/TG — but NOT GeckoTerminal/DexScreener/Jupiter, all load-bearing post-CoinGecko-divorce | ⚠️ blind spots |
| **Liquidity vault + Meteora ops** | Kept-for-redeploy code, owner-mandated; four layered kill switches | 🟡 dormant by design |
| **Analytics** | First-party covers everything server-side; GA4 covers only the React shell — structurally disagreeing double-system | 🟠 half-state |

### Narrative pages
| Surface | One line | Status |
|---|---|---|
| **home.html** (`/`) | Education-first landing, Locker Room NEW banner, correct OG | ✅ healthy |
| **README.md** | Canonical hackathon/grant doc — **zero Locker Room mention**, committed model id, stale USD figures | 🔴 stale |
| **investors.html** | Live-stat honesty posture — but no Locker Room, no OG image, model id committed | 🟡 |
| **grant.html** | Correct language count and budget math — but claims a "cross-Solana" lock feed that became our-locker-only 2026-07-17, and headlines **"VERIFIED GRADUATES: 0"** | ⚠️ |
| **clkn.html** (`/clkn`) | All live-fetched numbers (no drift) — but zero reason-to-buy copy and no OG | ⚠️ |
| **SEO posture** | robots/sitemap/curriculum mirror well designed — but sitemap indexes the dead liquidity placeholders and omits the flagship locker; unknown paths soft-404 as 200 | ⚠️ |

---

## 2. TRIM LIST — cut or merge, ranked

1. **Fix the 12h ops report lying to the owner.** `server.js:~11671` hardcodes "Engine: ±3%" and narrates positions for an engine killed 2026-07-14. Action: drop the hardcoded line; render "engine killed — anchors only" when `LIQ_ENGINE_KILLED` is true. Keep the organic-score chart — still useful.
2. **Kill the scheduled whaleRefresh.** Daily full CLKN holder walk on Helius whose main consumer (Wallet Watch) is hard-killed. Action: delete the setInterval/setTimeout at `server.js:12960-12961`; the gated `/api/whale-watch?refresh=1` on-demand path already exists. Zero functionality lost, real credit spend saved.
3. **Merge Rose into Buy Special.** Same engine, same price, indistinguishable copy; Rose is also fully off-brand (red palette, no "Cluck Norris" in title, stale generic meta). Action: one "Buy Comp" page with ranked-prizes and threshold-rewards modes, one TOOL_GRANTS entry, `/rose` redirects. Minimum-viable version if a merge is too big now: differentiate the copy, fix rose's meta, add rose to `notifyToolUnlock`. **Do NOT touch** the operator surfaces underneath (ranked comps, raffle draw, vested campaigns) — different mechanics deliberately sharing data infra.
4. **Delete the two Normie Quest prototypes** (4.9 MB unrouted HTML in every clone/deploy; git history keeps them forever). Also fix or delete the stale `music/README.md` world table (MUSIC_NOTES.md is the locked reference).
5. **Park the unrouted liquidity marketing pages safely.** `liquidity.html`/`liquidity-engine.html` are unrouted but contain "running this second" claims that are now false; a future re-route publishes lies on a grant-scrutinized repo. Action: top-of-file "UNROUTED — copy stale, verify engine status before re-routing" comment + neutralize the live-today lines. **Do NOT delete** — the interactive UI is real future product.
6. **Defuse the dead-but-ticking poster trap once, centrally.** Nine disabled schedulers are each one flag-flip from "running" while silently dropping their X leg under `X_AUTOPOST_PAUSED` (the exact failure that hid the 2026-07-08 spotlight outage). Action: in `postToX`'s paused branch, DM the operator once per (caller, day) when a non-force call is dropped. **Do NOT delete the schedulers** — owner may revive any.
7. **Fix the three misleading comment blocks** before they cause rework: `server.js:2588` + `lib/premium-forensics.js:17-19` still call shipped premium features "planned"; `hatchery.js:6-8` describes a signing flow that would mislead a session into "fixing" correct code.
8. **Close the lesson-copy drift hole.** Run `scripts/extract-curriculum.js` in CI (or at boot) so `data/curriculum.json` regenerates on lesson edits; teach `lpLessonBlock` to read lesson-level `quiz:[]` arrays (recovers 81 questions of SEO text — never answers). **Do NOT collapse the four lesson copies** — each serves a distinct runtime need (exam security, crawler HTML, AI grounding, source).
9. **Resolve the GA4 half-state** — either remove the snippet (first-party already covers everything, and "no third-party scripts" becomes true again — the better fit for a privacy/forensics brand) or inject it site-wide via cluck-nav.js. The current SPA-only state is the only wrong option. Owner's call (see §7).
10. **Merge the duplicate 2M constants** (`HOLDER_BONUS_THRESHOLD` / `PREMIUM_HOLDER_THRESHOLD`) or derive one from the other; add cross-reference comments to Normie Quest's third copy (leave it uncoupled per the "copy patterns, don't couple" rule).
11. **LP-vs-HODL dual implementation: do nothing now** (owner rule — keep Meteora code for redeploy). Filed intent: at redeploy, retire `jupLpVsHodl` in favor of the vault's superior baseline-basket method.

**Explicitly NOT redundant — protect from future cleanup sessions:** Snapshot vs Holders (one engine, two lenses; `/api/holders` is a *different product* with silent consumers), Trace vs X-Ray, Autopsy vs Token Vitals (the verdict/no-score split that replaced Cluck Score — collapsing them recreates the scoring problem), Checkup vs Security Coop (diagnosis vs treatment), Incubator vs core lessons, the `/crypto-school` alias, all dormant Meteora/vault code, the three permanent wide anchors, and the brand bag (never sold).

---

## 3. STRENGTHEN LIST

### High
1. **Update CLAUDE.md's engine banner — the fix that de-risks everything else.** It still describes OOR alerts, Wallet Watch, and LP-vs-HODL DMs as live; all are killed. Silence from monitors currently means "killed," not "fine" — dangerous given the owner's manual-redeploy posture. Also: celebration fallback is 24h in code vs 6h documented; locked-supply figures in the file (19.14%/28) are badly stale vs live (41.07%/53) — never copy them into public text.
2. **Locker Room discoverability package** (also funnel leak #1): add `/locker-room` to SITEMAP_PAGES; add it to README.md and investors.html; swap `Library.jsx:1120`'s external lock.jup.ag link to `/locker-room`; add a lock CTA to hatchery's locking section; Lock-of-Fame `?fame=` deep link on clkn.html.
3. **Fix the public false claims:** liquidity-engine.html "running this second" (edit to honest past-tense/manual-phase framing); grant.html:128 "cross-Solana recently locked feed" → "live feed of locks created through our locker" (a *stronger* claim — every entry is memo-attributed).
4. **Resolve the slots contradictions:** (a) send-path posts `tool='premium'` (2M gate) while copy promises 500k — a 500k–2M holder hits a false dead end; (b) "no prizes are awarded" banner coexists with a promised 7,777 CLKN airdrop on-page and in a public TG blast. Pick one truth per issue and align every surface. For a brand whose pitch is honesty, these are disproportionately damaging.
5. **Silent-X-failure guard** (same fix as Trim #6) — one shared alert in `postToX` makes every current and future paused drop loud.
6. **Split the kill switch:** move read-only monitors (OOR ticks, pool-monitor, LP-vs-HODL) onto their own `MONITORS_KILLED` const so watch-only alerting can run while fund-movers stay dead. Right now, if the owner redeploys tight pools, **nothing** alerts on out-of-range.
7. **Make kvstore atomic** (~10 lines: tmp-file + rename + .bak fallback). One truncated write currently zeroes dedupe stamps → the buy poller re-announces trades, among other things.

### Medium
8. **Helius resilience:** migrate `lib/helius-trades.js` and the ~25 raw-fetch call sites to `rpc.rpcFetch`; set `HELIUS_API_KEY_2` on Railway; add GeckoTerminal + Jupiter probes to `checkSourceHealth`.
9. **Dress-rehearse the Vested Buy Special payout** with 2–3 owner wallets, including one deliberately-failing row, before any real campaign. A half-distributed vesting payout in public would be negative-viral.
10. **Fix `/curriculum`:** "six languages" → seven + हिन्दी (lines 121, 137 — live in prod, the exact drift class CLAUDE.md warns about).
11. **Stop headlining zero:** grant/investor stat cards should lead with non-zero numbers (9 transcripts, tool runs, locked %) and show verified diplomas only once ≥1 exists. Then make the exam passable (see §7 — owner decision on the 94% bar) and persist exam sessions to /data so redeploys don't void attempts.
12. **OG cards on the three most-shared pages:** absolute og:image in the React shell (`index.html:20` — relative URL, scrapers reject it), and add OG blocks to investors.html and clkn.html (home.html has the correct pattern to copy).
13. **Standardize airdrop unlock semantics on time** (`{hours:1}`, copy aligned) and **drop all hardcoded USD glosses** (they're mutually inconsistent today: $0.0001 vs $0.00012 implied prices).
14. **Delete the accidental noindex on wallet-xray.html** — the free flagship is invisible to Google while sitting in the sitemap.

### Low
15. Adopt `/bags` into tools.html + cluck-nav (or record its soft-launch status so sessions stop re-flagging it).
16. Swap unpkg CDN web3.js for the vendored copy on locker-room.html and buyspecial-dashboard.html (verify 1.95.x API match).
17. Real 404s from the SPA catch-all for unknown paths (currently soft-404 as 200 — crawl waste, and a prerequisite for the autopsy-permalink play).
18. Mobile/onboarding: **verified fine, no work needed** — every tool is paste-an-address, no wallet connect, viewport tags present throughout.

---

## 4. FUNNEL — journeys and the 5 biggest leaks

**The four new-visitor journeys:** (1) **Degen** wanting a free token check — highest-volume CT intent; (2) **Newcomer learner** — best-served today (1 click to Incubator); (3) **Project owner** wanting to lock tokens; (4) **CLKN buyer** deciding whether to buy.

**Leak 1 — The flagship is invisible (project-owner journey).** The Locker Room exists only for people who land on the homepage. Sitemap: 166 URLs, zero locker entries — while the dead liquidity placeholders ARE indexed. README/investors: zero mentions. The school sends lock-curious learners to external lock.jup.ag. The Hatchery *teaches* locking and doesn't link the door. **Fix:** the discoverability package (Strengthen #2). Four small pure-addition edits.

**Leak 2 — /clkn shows a chart and no reason to buy (buyer journey).** Verified by grep: the buy page contains no mention of unlocks, holder bonus, locked supply, school, or premium. The pitch exists — scattered across four other pages the buyer never sees. **Fix:** a "What CLKN unlocks" card (tool pricing, 2M→5× bonus, live locked-% linking `?fame=`, school one-liner) + OG tags.

**Leak 3 — Homepage is school-only above the fold (degen journey).** The tool that replaced Cluck Score as flagship is 3+ clicks deep behind a collapsed accordion where "I need research tools" is option 7 of 9. Compounding: tools.html's meta still advertises "token health scoring" — a deliberately removed product — and rose's meta is a generic leftover, so the pages that do rank mis-sell themselves. **Fix:** a "Check any token / wallet" paste box or two-button strip on the hero; fix both metas.

**Leak 4 — Broken OG cards at the top of every journey.** The growth engine is X/TG links, but /school shares cardless (relative og:image), /clkn and /investors share with no card at all. Every social referral arrives pre-degraded. **Fix:** three one-line-class edits (Strengthen #12). **Sequence this before any push that drives sharing.**

**Leak 5 — The learner journey terminates at an unpassable exam.** 9 transcripts, all self-reported; 0 diplomas ever. The 94%-over-50 bar plus redeploy-wiped in-memory sessions make the differentiator effectively unreachable — and the grant page then displays the resulting zero to Foundation reviewers. **Fix:** stat-card swap now (mechanical); exam-bar decision is the owner's (§7); persist sessions to /data regardless.

---

## 5. BRAND VERDICT

**The story the site should tell, in one paragraph:** *Cluck Norris is a free Solana crypto school taught by a chicken, plus free forensic tools that show you exactly who's about to rug you, plus a lock room where teams prove on-chain that they can't dump — all funded by premium operator tools paid in CLKN micropayments, no wallet-connect required. The brand's superpower is radical honesty: no scores, no grades, no asserted intent — the chain shows what, not why.* Today no single page says this. CLKN plays five unrelated roles (payment rail, premium key, slots ticket, game tier, locked-supply narrative) and no public surface states why it exists; each narrative door (README, grant, investors, home) pitches a different flagship; and the honesty voice is contradicted by the slots prize copy, the "token health scoring" meta, and mutually inconsistent USD figures.

**Coherence calls:**
- **Write ONE canonical two-sentence CLKN story** ("CLKN pays for the premium operator tools — no wallet-connect, just send the coin; hold 2M+ and everything unlocks 5×. Fees fund the free school.") and render it verbatim on clkn.html, home footer, investors, tools header, and README. Unlock panels link to it instead of re-explaining.
- **One flagship story across all four narrative doors:** school + forensics + Locker Room, funded by CLKN tools. README is the worst offender (zero Locker Room) — fix it first; also remove the committed model identifiers (README:199, investors:469) per the repo's own rule.
- **Naming:** adopt one convention — `<emoji> <Tool Name> · Cluck Norris` — across ~12 title tags. Keep the chicken puns (they're the voice) but resolve the Coop collision (Security Coop vs Coop Spinner) either by renaming the spinner or by an intentional cross-linked "not that coop" joke. Retire the "Rose" name with the Buy Special merge. Make `/ask-cluck` the sole public name for the chat (`/crypto-school` collides with the actual school — keep as alias only) and present education as one family: School · Classroom · Library · Learn.
- **Visual identity:** 90% unified; port rose, locker-room, and wallet-checkup onto the shared `:root` token block. Decide the autopsy premium styling (recommendation: on-brand base + one distinct gold "premium" border treatment).
- **Normie Quest:** the containment wall is verified holding — keep it. But the 2M-CLKN tier hook already couples the brands at the token level. Before any surfacing: productize as a white-label "token game engine" under the operator-tools story, or move it to its own domain. A gambling-adjacent game for someone else's token on the "school that protects normies" domain is a direct tone contradiction.
- **tools.html:** restructure into three labeled bands matching the story — LEARN / PROTECT & INVESTIGATE / OPERATOR TOOLS · PAID IN CLKN — so a stranger leaves able to repeat the pitch.

---

## 6. GROWTH PLAYBOOK

**How the five perspectives were merged.** The CT operator, PLG, and SEO perspectives converge hard on the same insight from three directions: *tool results are the marketing, and they currently die in private browser tabs.* The tokenomics perspective adds the only plays that acquire genuinely new wallets (Locker Room B2B, graduation rewards). The skeptic's frame — quoted below — is weighted most heavily on **sequencing and restraint**, because it's the only perspective that accounts for the binding constraint (one owner's attention); it is weighted least on its most radical prescriptions (killing i18n/slots outright), where "stop building new surfaces" is the defensible core and "delete working retention surfaces" is not. Where SEO wants multilingual expansion and tokenomics wants a tiers page, the skeptic's freeze wins for 90 days: those are good plays for *after* the wedge shows growth.

**The skeptic's core warning (in spirit, near-verbatim):**
> This is not a product with a traffic problem — it is a portfolio with an identity problem. ~80 components, one person, and the scarcest resource (owner attention) drains into micromanaging ~$9K of the project's own LP, which produces zero users. Every comparable one-person crypto product that won had ONE name-equals-job wedge and distribution living where users already are — embedded, installed in other people's groups, or ranking for the exact thing people search the day a token dies. Cluck has none of that. The monetization is anti-growth (buy an illiquid memecoin, then send a magic decimal), and its revenue-depends-on-CLKN-price circularity is what justifies the LP theater that eats the owner. Stop building. Ship distribution for the one tool whose usage moment is also its marketing moment.

**The single bet (skeptic, endorsed by this audit):** make **Token Autopsy the wedge for 90 days**. It is the only tool whose moment of use is a news event — a rug — where victims search the exact mint address at maximum motivation, and nobody owns "the rug post-mortem" as a brand. X-Ray competes with Solscan/Arkham; the school competes with YouTube; Autopsy-as-publication competes with nothing. The school is the retention layer behind it, and the Locker Room is the parallel B2B wedge that runs on borrowed distribution rather than owner broadcast.

### Top 10 plays (deduped, ranked by impact/effort)

1. **Share-surface foundation: OG cards + share buttons on Autopsy, X-Ray, transcripts, /clkn, /investors.** *(PLG + CT + Skeptic — all three independently)* Small-to-medium effort, prerequisite for everything below: every share currently renders as a bare URL. Port the locker-room copy-link/tweet-intent kit (locker-room.html:410-419) to autopsy and x-ray result footers; fix the relative og:image; log share clicks via lib/analytics.js. **Do this first — share loops before OG cards = wasted first impressions.**
2. **Autopsy permalinks: `/autopsy/<mint>` as permanent, indexable, OG-carded pages, served from cache only.** *(SEO + Skeptic + PLG)* Medium effort, highest ceiling: owns "is [token] a rug" long-tail with near-zero competition; inventory grows itself as users run autopsies. Persist reports to /data (the 3-min in-memory cache is not an indexable surface); index only substantive reports; escape all token strings; backfill the 50 most-searched dead tokens. Requires real 404s from the SPA catch-all first.
3. **Locker Room wedge: discoverability package + per-project public Lock Pages + graduation-moment pitch.** *(CT + PLG + Tokenomics + the weakness lens — the strongest four-way convergence in this audit)* The only play where someone else's community walks in the door; the memo makes adoption permanently countable; the Token-2022 capability is a literal "nowhere else can do this." Build `/lock/:mint` flex pages off the memo-gated feed + a badge/embed + an operator-approved outreach template attached to the existing 1-minute grad-detection window. Offer each locking project a free celebration image (pipeline exists) they'll repost to their own audience.
4. **Free `/autopsy` + `/xray` Telegram bot any group can install.** *(Skeptic)* Medium effort, high impact: the concrete distribution muscle every successful comparable has. The webhook commands already exist — make the bot multi-chat, rate-limited per chat, every result linking back to the permalink pages. Seed with 20 mid-size trading groups. Every install is permanent free distribution.
5. **Rug-response news-jacking, manual and owner-driven.** *(CT)* Small effort: when a rug trends, run the autopsy, post the long-form case study (X Premium — no truncation), reply-drop under the 3–5 biggest threads, follow the mirror+bump rule. Respects `X_AUTOPOST_PAUSED` — no new autoposter. The house forensic rule ("state what's on-chain, never assert intent") is the legal shield and must hold verbatim on every card and page.
6. **Reply-guy operating system, 30 min/day.** *(CT)* Smallest effort, compounding: answer "is X safe" / victim / airdrop-planning / lock-announcement threads with *live tool results*, not pitches. Also the discovery engine for plays 3 and 5. Free forever.
7. **Zero-input first run: preload famous cases.** *(PLG)* Small effort: point "Start Here" cards at `?mint=<famous rug>` deep links (auto-run already works) + example chips on empty states. The first pageview becomes the aha instead of an empty input box. Keep the curated list fresh.
8. **Graduate flex loop + referral transcripts + reward ladder.** *(Tokenomics + PLG + CT)* Publish a staged reward ladder (completion → small drop; verified diploma → larger drop + spins + a 24h premium pass), gated on the existing Tier-2 ownership proof; add `?ref=<slug>` attribution and an "Earn yours" CTA on transcripts; publicly congratulate every grad (the watcher DM already fires). Status-only referrals first — sidesteps sybil farming. Blocked until the exam is passable (§7).
9. **Query-intent SEO packaging: keyword-first titles, FAQ/HowTo JSON-LD, technical fixes.** *(SEO)* Small effort per page: "Lock Solana Tokens Free," "Revoke Token Approvals Solana," "Solana Rug Checker" — the answers are already written; only the packaging is brand-first. Includes the wallet-xray noindex deletion and locker sitemap entry (already in Strengthen).
10. **Break the CLKN-only paywall: accept SOL/USDC on the same unique-decimal rail + one free premium run/week.** *(Skeptic; conflicts with the tokenomics instinct)* Resolution: the skeptic is right that "buy an illiquid token first" guarantees near-zero cold conversion, and the tokenomics goal survives intact by keeping the 2M-CLKN 5× bonus as the holder perk — token as *discount tier*, not *gate*. The verification code generalizes (one more mint check in the balance-delta parse). **Owner decision — it touches the token story (§7).**

**Deliberately demoted:** Autopsy Spaces (CT — good, but founder-time-expensive; revisit after the reply-guy ritual is habitual), multilingual /curriculum + glossary pages and /learn buy-variants (SEO — real but post-freeze), lock-to-earn balance counting and the /tiers page (Tokenomics — retention of existing holders, not acquisition; and lock-counting needs careful per-wallet escrow attribution shipped dry-run-first), formalized holder tiers (same reason).

### Quick wins (each doable in a day)
- Delete wallet-xray's noindex line; add `/locker-room` to the sitemap; drop the locked liquidity placeholders from it.
- Fix `/curriculum`'s "six languages"; fix tools.html and rose.html meta descriptions.
- Absolute og:image in index.html; OG blocks on clkn/investors.
- Port the locker share-kit to autopsy + x-ray result views; watermark every PNG the app emits with clucknorris.app.
- Point "Start Here" cards at preloaded famous-case deep links; add example chips.
- Rewrite README.md (add Locker Room//learn/Classroom, drop model ids, drop USD figures) — it's the grant entry.
- Live "locked via clucknorris.app" adoption count on the homepage next to the Locker banner.
- "Earn yours" CTA on `/transcript/:slug`; publicly congratulate each new grad.
- Delete the whaleRefresh schedule and the two NQ prototypes; fix the ops-report caption.
- Analytics decision executed (GA everywhere via cluck-nav, or GA deleted) + funnel events on share clicks and `?mint=/?fame=/?ref=` arrivals so loop K-factor becomes a number on /stats.
- One vi + one hi post/week reusing the existing translations ("free Solana school in your language") — pure distribution, zero build.
- Set the hard weekly cap on LP-ops session time (skeptic's point: that's where the attention actually drains).

### Risks (merged, the ones that bind)
- **Every new posting surface needs an explicit owner carve-out from `X_AUTOPOST_PAUSED` AND failure alerting** — the spotlight outage must not repeat. All viral mechanics above are user-initiated by design.
- **Public rug verdicts invite heat** — the "chain shows what, not why" rule enforced mechanically on cards and permalink pages is both the legal shield and the brand.
- **Crawler-triggered compute:** permalinks serve cached reports only; never let a crawl trigger a forensic run (Helius + Claude spend).
- **Referral/airdrop rewards attract sybils** — status-only first, ownership-proof-gated always, modest amounts sized to actual fee revenue.
- **Wallet roast/share formats stay self-serve** (users share their OWN results; truncate addresses) — uninvited third-party roasts read doxx-adjacent. Never index per-wallet result URLs.
- **No mechanic that resembles wash/self-volume** — CoinGecko rejected three times and actively detects it; also note the organic score (33.0) is partly a product of the owner's own arb structure, a dependency the credibility story should not lean on harder.
- **Founder time is the constraint** — pick two manual plays (reply-guy + rug-response recommended) and do them daily rather than five badly. The freeze discipline is itself the biggest risk: the repo's history shows the default is to build.

---

## 7. DECISIONS NEEDED FROM THE OWNER

1. **The 90-day wedge bet:** commit to Autopsy-as-flagship + feature freeze (no new surfaces until the wedge shows 30 days of visitor growth), yes or no? Everything in §6 is sequenced on this.
2. **Payment rail:** accept SOL/USDC alongside CLKN (keeping the 2M 5× bonus as the holder perk)? This changes the token's role from gate to tier — a strategy call, not an engineering one.
3. **Slots truth:** does the beta pay the 7,777 CLKN Fire Chicken prize or not? And is the entry floor 500k or 2M? Both contradictions need one answer each before someone claims the prize.
4. **Exam bar:** lower 94%, shorten the exam, add practice/retake flow — or accept that "verified diploma" stays unexercised? The grant stat renders 0 until this is decided.
5. **Rose:** merge into Buy Special (recommended) or keep as a separately-branded product with fixed copy/palette?
6. **Analytics:** delete GA4 (restores the "no third-party scripts" claim — recommended for this brand) or extend it site-wide?
7. **Normie Quest end-state:** hand off to the NORMIE owner, productize as a white-label token-game service, or keep hidden indefinitely? Also the timing of the monetization flag-flip.
8. **Monitor un-kill:** approve the `MONITORS_KILLED` split so OOR alerting can run without re-arming fund-movers — needed *before* any manual pool redeploy.
9. **Grant figure check:** grant.html asks $8,000 (table sums correctly); the audit brief referenced $6k. Confirm which number went to the Foundation — no $6k exists anywhere in the repo. *(Evidence thin here: only the page itself was verifiable.)*
10. **/bags:** public (add to tools hub) or soft-launched (record the intent)?
11. **Autopsy premium styling:** on-brand with a premium accent, or deliberately distinct? (Deferred since June — decide intentionally.)
12. **`/clkn` organic-score card:** the live readout arguably differs from the banned "0→33" marketing copy, but it is a public organic-score surface — confirm it matches your intent.

**Honesty notes on evidence:** traffic and conversion numbers were not available to any lens — the funnel leak ranking is structural reasoning, not measured drop-off (fixing the analytics half-state makes the next audit data-driven). SEO volume claims ("near-zero competition") are directional, unverified against keyword tools. The Vested Buy Special risk is inferred from "never run," not from an observed failure. The skeptic's "LP theater produces zero users" is an attention-allocation argument, not a P&L one — the LP structure demonstrably produced the organic score, which has its own listing value; the audit's position is that both things are true and the time cap resolves the tension.