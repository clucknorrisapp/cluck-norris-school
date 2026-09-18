"use strict";
// lib/hub/glossary.js — Colosseum roadmap EE2: ONE source of truth for every term and reason
// code a public Hub surface (a receipt, the wallet look-up's exclusion reasons, the compare
// page, the standings, or the pre-lock lesson) renders. Pure — no network, no clock, no
// operator free text (there is no parameter for it).
//
// Every code and term key below is IMPORTED from, or named next to a comment naming, the module
// that actually emits it — never retyped from memory — so scripts/hub-glossary-test.cjs can grep
// those same modules and fail the build the moment a new code ships with no entry here (the same
// discipline CLAUDE.md's "Verification: check every form, not one form" asks for).
//
// Honesty rules (hard, CLAUDE.md "Say what's on-chain, never why" + the Earn framing):
//   - A definition says what a code means IN THE RECORD — never why a holder was excluded in
//     intent, never a motive.
//   - "reproducible" / "matches", never "verified" / "safe" / "guaranteed".
//   - No APR, APY or yield language anywhere (mirrors lib/hub/teach.js's RATE_LANGUAGE guard).
//   - Nothing about Normie Quest. Wallet Watch is never mentioned (CLAUDE.md: no public surface
//     for it at all).
//
// kind: "term" — a field name or a pre-lock/receipt question key a page renders as a label.
// kind: "reason" — a machine-checkable code a record carries for why something is, or is not,
//   counted the way it is.
// usedOn: which of the five named public surfaces (receipt, wallet, compare, standings, lesson)
//   this entry is actually linked from today. lessonId (optional): a src/App.jsx LESSONS id —
//   scripts/hub-glossary-test.cjs fails if it ever stops resolving (same C4 discipline as
//   lib/hub/teach.js's own LESSON_MAP guard).

const { REASON_CODES } = require("./eligibility");
const T = require("./teach"); // LESSON_MAP — reused so a lesson id here can never drift from teach.js's own map

const lessonHref = T.lessonHref;

// ── kind: "term" ─────────────────────────────────────────────────────────────────────────────

// A program version's term keys — exactly the ORDER/LABEL vocabulary public/hub-compare.html
// renders one row per field for (lib/hub/project.js validateTerms / program-version.schema.json
// name the same fields; hub-compare.html is the page that turns them into labels). usedOn:
// ["compare"] — this is the field-diff page's own row label.
const COMPARE_TERMS = [
  { id: "poolDailyRaw", term: "Fixed daily pool", lessonId: "receipt",
    definition: "The exact amount of the reward token a program version pays out across every qualifying locker each day, before the pro-rata split." },
  { id: "sharePct", term: "Share of the funding wallet's own daily unlock", lessonId: "receipt",
    definition: "Instead of a fixed daily amount, this program version pays a fixed percentage of whatever the funding wallet's own tokens unlock that day." },
  { id: "maxSharePct", term: "Ceiling on that share", lessonId: "receipt",
    definition: "The most a day's payout can be, as a percentage of the funding wallet's own unlock, even when the plain percentage would compute more." },
  { id: "minDurationDays", term: "Shortest lock term admitted", lessonId: "tokenomics",
    definition: "The fewest days a lock must still be committed for a locker to qualify at all — and the term that earns the base 1× multiplier." },
  { id: "maxTermDays", term: "Term length at the top rate", lessonId: "tokenomics",
    definition: "The number of committed days at which a locker reaches this program's highest multiplier. Committing longer earns no more." },
  { id: "minLockRaw", term: "Minimum amount locked to qualify", lessonId: "tokenomics",
    definition: "The smallest amount a single lock must hold. Below this, a lock does not qualify regardless of its term." },
  { id: "maxWalletSharePct", term: "Per-wallet cap on the pool's share", lessonId: "receipt",
    definition: "The most of one day's pool a single wallet's locks can be credited, as a percentage — a ceiling that can bind even when a wallet's own pro-rata share would compute more." },
  { id: "payoutSchedule", term: "Payout cadence", lessonId: "receipt",
    definition: "How often the program builds a batch and sends accrued rewards to lockers, for example weekly." },
  { id: "vesting", term: "Which lock shapes qualify", lessonId: "tokenomics",
    definition: "Which release shapes of a Jupiter Lock escrow — a single release, a vesting schedule, or either — this program's terms accept." },
  { id: "cancelableAllowed", term: "Cancelable locks admitted", lessonId: "wallets",
    definition: "Whether a lock its own creator can cancel and reclaim early is allowed to qualify for this program at all." },
  { id: "fundedBy", term: "Wallets whose own unlock feeds the pool", lessonId: "receipt",
    definition: "The wallets whose own scheduled unlocks are read to compute a percentage-based daily pool, used together with the share-of-unlock term." },
  { id: "excludeWallets", term: "Wallets excluded from the pool (Rule B)", lessonId: "rugs",
    definition: "Wallet addresses excluded from this program by recipient or by creator, regardless of what their own lock's terms would otherwise qualify for." },
  { id: "backdateCapDays", term: "How far back a late-seen lock backdates", lessonId: "tokenomics",
    definition: "The most days a lock's counted term can be backdated when the program first sees it later than the lock was actually created." },
  { id: "backdateNotBefore", term: "Earliest a lock may ever backdate to", lessonId: "tokenomics",
    definition: "A floor date before which no lock's counted term is ever backdated, however late the program first saw it." },
];

// The six pre-lock question keys lib/hub/teach.js's LESSON_MAP names (Addendum C — "teach the
// button before you offer it"). Rendered today on the /hub/demo walkthrough (public/hub-demo.html
// d.teach.answers). usedOn: ["lesson"].
const TEACH_TERMS = [
  { id: "what_happens", term: "What happens to my tokens?",
    definition: "Where locked tokens sit while committed — a Jupiter Lock escrow, an on-chain account anyone can open — and when the published schedule releases them." },
  { id: "can_i_sell", term: "Can I sell during the lock?",
    definition: "Whether the locked tokens can be moved, sold, or used by anyone — the locker, the project, or the platform — before the lock's own unlock date." },
  { id: "where_reward", term: "Where does the reward come from?",
    definition: "The project's own funding wallet a program's rewards are paid from, and what is currently known about what it owes against what it holds." },
  { id: "how_much", term: "How much will I get?",
    definition: "A locker's pro-rata share of a shared pool that others locking or unlocking changes over time — computed from the amount locked and the term committed to, never a promised rate." },
  { id: "risks", term: "What are the risks?",
    definition: "The plain facts about what can go wrong while locked: tokens are frozen for the committed term regardless of price, and funding coverage or a differing reward asset can change what actually arrives." },
  { id: "why_lock", term: "Why lock at all?",
    definition: "A lock is a public, checkable, time-limited promise not to sell — the reason a project or a holder uses one, independent of any specific program's own terms." },
];

// lib/hub/explain.js's "how this number was computed" step keys — the post-payment mirror of
// teach.js. Listed here as literals with the source noted, since explain.js builds them inline
// (push("term_rule", ...) etc.) rather than exporting them as constants.
const EXPLAIN_RECEIPT_TERMS = [
  { id: "term_rule", term: "The term rule your lock was measured against", lessonId: "receipt", usedOn: ["receipt"],
    definition: "The published day range a receipt's multiplier was computed under — the same range shown before the lock was made." },
  { id: "accrual_window", term: "Hourly slices accrued", lessonId: "receipt", usedOn: ["receipt"],
    definition: "The specific span of hourly accrual periods a receipt's amount was built from, read straight from the ledger's own record." },
  { id: "pro_rata_share", term: "Your share of each hour's pool", lessonId: "receipt", usedOn: ["receipt"],
    definition: "What a wallet's own credited amount was in each accrued hour, and what percentage of that hour's total pool it represented." },
  { id: "subtotal", term: "Added up", lessonId: "receipt", usedOn: ["receipt"],
    definition: "The exact sum of every hour's share listed in the walkthrough — the number a reader can check by hand against the receipt's total." },
  { id: "prior_payments", term: "Prior payments applied", lessonId: "receipt", usedOn: ["receipt"],
    definition: "How much of what was owed on a row had already been paid or waived by an earlier settlement — shown only when it changes the picture." },
];
// lib/hub/explain.js's explainBuyCompRow() step keys — the same "how this number was computed"
// pattern for a buy-competition winner, rendered on the project page's standings (never on a
// dedicated receipt page — a buy-comp payout row carries no separate /r/:sig walkthrough today).
const EXPLAIN_BUYCOMP_TERMS = [
  { id: "place_rule", term: "Rank's published prize", lessonId: "receipt", usedOn: ["standings"],
    definition: "The prize this competition published for a given rank before its window opened — a flat amount, or a percentage of the winner's own qualifying buy." },
  { id: "what_was_bought", term: "What the scan counted for this wallet", lessonId: "receipt", usedOn: ["standings"],
    definition: "The wallet's own qualifying buy volume from the window-scoped scan — the same figure the public standings show for that wallet." },
  { id: "computed", term: "Computed", lessonId: "receipt", usedOn: ["standings"],
    definition: "The amount this walkthrough's own arithmetic produces from the published rule and the observed inputs listed above it." },
];

// ── kind: "reason" ───────────────────────────────────────────────────────────────────────────

// The prefix→code map itself lives in lib/hub/eligibility.js (REASON_CODES, imported below) —
// this is only the plain-word definition for each of ITS codes, keyed the same way, so the two
// can never name a code differently. A change to REASON_CODES that adds a code with no entry
// here fails scripts/hub-glossary-test.cjs, not silently ships.
const ELIGIBILITY_DEFS = {
  not_a_lock: "The account is not a Jupiter Lock escrow for this program's token, so it was never eligible.",
  different_token: "The escrow locks a different token than this program's own mint, so it does not qualify.",
  cancelable: "The lock lets its creator cancel it and take the tokens back before the unlock date. This program does not count a cancelable lock unless its terms explicitly allow one.",
  cancelled: "The lock has already been cancelled on-chain — its tokens were returned before the unlock date, so nothing remains locked to earn against.",
  not_indexed: "The lock has not yet been seen by the index this program reads from. It may still appear on a later scan.",
  seen_before_program: "The lock already existed on-chain before this program's window began, so its term is not counted from the program's own start date.",
  no_schedule: "The escrow carries no unlock schedule the program can read, so a term cannot be measured.",
  term_too_short: "No portion of this lock remains committed for at least the program's minimum term.",
  nothing_locked: "Every token in this escrow has already unlocked or been released — nothing remains locked.",
  below_min_lock: "The amount locked is under this program's minimum lock size.",
  no_recipient: "The escrow names no recipient wallet this program can credit.",
  excluded_recipient: "The recipient wallet is on this program's exclusion list (Rule B), so it is never credited regardless of what its own lock's terms would otherwise qualify for.",
  excluded_creator: "The wallet that created this lock is on this program's exclusion list (Rule B), so a lock it created is never credited regardless of its own terms.",
  vesting_not_allowed: "This lock's release shape — a vesting schedule — is not one this program's terms admit.",
  cliff_not_allowed: "This lock releases everything in a single event with no vesting, which this program's terms do not admit.",
};
// codeFor()'s fallback (lib/hub/eligibility.js): a disqualifying condition this glossary does not
// yet name a specific code for.
const OTHER_DEF = "A disqualifying condition not yet given its own code here. The record still carries the original plain-language reason text alongside it.";
// lib/hub/routes.js's own literal (not part of REASON_CODES — set directly where no program
// version is in force for a project at all, so nothing could be evaluated).
const NO_PROGRAM_DEF = "No program version was in force for this project when this record was read, so nothing could be evaluated against a published rule.";

// The hold-through classification lib/hub/public.js's holdThroughOf() computes for a buy
// competition or Buy Special draw's reviewed wallets (PR #298 comment there): "held" is the
// qualifying case (not listed here — it is not an exclusion); these four are the ways a
// non-qualifying wallet is actually recorded, kept apart on purpose rather than lumped into one
// generic disqualification. Rendered today in the "reviewed and not paid" list on a project's
// page and in the wallet look-up's per-program rows. usedOn: ["wallet", "standings"].
const HOLD_THROUGH_DEFS = [
  { id: "sold", lessonId: "volatility", definition: "The wallet's qualifying buy was sold on-chain during the competition window or its hold period." },
  { id: "moved-out", lessonId: "volatility", definition: "The wallet moved its qualifying buy out — to another wallet or a venue — during the window or hold period, without an on-chain sale being what was actually observed." },
  { id: "locked-not-a-sell", lessonId: "volatility", definition: "The wallet's whole qualifying buy went into a lock escrow during the hold period. That is the opposite of an exit, so it is not treated as a disqualification — just recorded plainly." },
  { id: "unverified", definition: "A lookup gap — a coverage or RPC miss — left nothing observed either way for this wallet during the hold period." },
];
// The raw review status a wallet can carry before hold-through classification exists for it (Buy
// Special draws don't compute hold-through; a buy competition's OWN review rows also carry this
// underneath the classification above). Rendered as the "Excluded" pill's own label on the wallet
// look-up when no hold-through fact is available. usedOn: ["wallet", "standings"].
const REVIEW_STATUS_DEFS = [
  { id: "dq", definition: "The automated review found this wallet did not qualify. Where a more specific fact was recorded (sold, or moved the bag out), that is shown alongside this status." },
  { id: "manual", definition: "This wallet's status for this program was set by an operator by hand, rather than decided by the automatic scan." },
];
// lib/buycomp-payout.js's own settlement-void reasons — rendered directly as the pill label next
// to a voided transfer record on a project's page (public/hub.html's "voided transfer records"
// list reads v.reason verbatim). usedOn: ["standings"].
const VOID_REASON_DEFS = [
  { id: "tx_error", definition: "The settlement transaction sent for this row failed or errored on-chain, so the payout was voided — the amount was not actually delivered." },
  { id: "operator_unpay", definition: "An operator manually voided this row after it had been marked paid. The record was corrected by hand, not by a transaction failure." },
];
// lib/hub/access.js and lib/hub/access-pay.js's own payment/access-gate outcomes. Not rendered
// as a literal code on any page today (the pay flow shows the human sentence built from one of
// these, not the code itself) — kept here so the code that decides what a project's access page
// says can never drift from an undocumented string. usedOn: [].
const ACCESS_REASON_DEFS = [
  { id: "comped_never_pays", definition: "This project's access is comped. No payment is owed for it and none is ever collected." },
  { id: "no_payment", definition: "No payment matching this access request has been recorded yet." },
  { id: "short", definition: "A payment was recorded, but its amount is less than the quoted or published price." },
  { id: "no_quote", definition: "No price quote was on file to check this payment against." },
  { id: "not_final_yet", definition: "The payment transaction has not yet reached finality on-chain. The record settles once it does." },
  { id: "outside_quote_window", definition: "The payment landed after its price quote had already expired." },
];
// The per-transfer settlement journal's own refusal codes (docs/HUB_JOURNAL_VERIFY_2026-09-18.md)
// — lib/hub/ledger.js settle(), lib/hub/routes.js's PASS 1/2/3 attribution, and
// lib/payout-verify.js's funding-wallet check. Reachable only from the operator desk today, not
// yet a literal code on a public page — kept here so the record's own vocabulary is documented
// before a public surface for it exists, not after. usedOn: [].
const SETTLEMENT_REASON_DEFS = [
  { id: "amount_mismatch", definition: "A transfer's amount did not exactly match what this row still had remaining, so it was refused rather than partially applied. The row is left exactly as it was, for a later, exactly-matching transfer to settle." },
  { id: "row_already_settled", definition: "This row was already fully settled before this transfer was checked, so the transfer is refused as too late to be this row's payment — it does not undo or contest the earlier settlement." },
  { id: "transfer_not_from_funding_wallet", definition: "The transfer's source was not one of the project's own authorized funding wallets, or fell short of what a payout would require, so it could not be accepted as this row's settlement." },
  { id: "duplicate_settlement_candidate", definition: "More than one observed transfer could equal this row's exact remaining amount. Only one is ever accepted as the settlement; the rest are refused under this code rather than guessed between." },
];

function buildEligibilityEntries() {
  const out = [];
  const seen = new Set();
  for (const [, code] of REASON_CODES) {
    if (seen.has(code)) continue; // REASON_CODES can, in principle, map two prefixes to one code
    seen.add(code);
    const def = ELIGIBILITY_DEFS[code];
    if (!def) throw new Error(`lib/hub/glossary.js: eligibility.js REASON_CODES has "${code}" with no definition here`);
    out.push({ id: code, kind: "reason", term: code, definition: def, usedOn: ["wallet"], lessonId: /^(excluded_)/.test(code) ? "rugs" : "tokenomics", source: "lib/hub/eligibility.js REASON_CODES" });
  }
  out.push({ id: "other", kind: "reason", term: "other", definition: OTHER_DEF, usedOn: ["wallet"], lessonId: null, source: "lib/hub/eligibility.js codeFor() fallback" });
  out.push({ id: "no_program", kind: "reason", term: "no_program", definition: NO_PROGRAM_DEF, usedOn: ["wallet"], lessonId: null, source: "lib/hub/routes.js literal (code: \"no_program\")" });
  return out;
}

const ENTRIES = [
  ...COMPARE_TERMS.map((e) => ({ id: e.id, kind: "term", term: e.term, definition: e.definition, usedOn: ["compare"], lessonId: e.lessonId || null, source: "public/hub-compare.html LABEL / lib/hub/project.js validateTerms" })),
  ...TEACH_TERMS.map((e) => ({ id: e.id, kind: "term", term: e.term, definition: e.definition, usedOn: ["lesson"], lessonId: T.LESSON_MAP[e.id] || null, source: "lib/hub/teach.js teachBlock()" })),
  ...EXPLAIN_RECEIPT_TERMS.map((e) => ({ id: e.id, kind: "term", term: e.term, definition: e.definition, usedOn: e.usedOn, lessonId: e.lessonId, source: "lib/hub/explain.js explainReceipt()" })),
  ...EXPLAIN_BUYCOMP_TERMS.map((e) => ({ id: e.id, kind: "term", term: e.term, definition: e.definition, usedOn: e.usedOn, lessonId: e.lessonId, source: "lib/hub/explain.js explainBuyCompRow()" })),
  ...buildEligibilityEntries(),
  ...HOLD_THROUGH_DEFS.map((e) => ({ id: e.id, kind: "reason", term: e.id, definition: e.definition, usedOn: ["wallet", "standings"], lessonId: e.lessonId || null, source: "lib/hub/public.js holdThroughOf()" })),
  ...REVIEW_STATUS_DEFS.map((e) => ({ id: e.id, kind: "reason", term: e.id, definition: e.definition, usedOn: ["wallet", "standings"], lessonId: null, source: "lib/hub/public.js compView()/drawView() review status" })),
  ...VOID_REASON_DEFS.map((e) => ({ id: e.id, kind: "reason", term: e.id, definition: e.definition, usedOn: ["standings"], lessonId: null, source: "lib/buycomp-payout.js" })),
  ...ACCESS_REASON_DEFS.map((e) => ({ id: e.id, kind: "reason", term: e.id, definition: e.definition, usedOn: [], lessonId: null, source: "lib/hub/access.js / lib/hub/access-pay.js" })),
  ...SETTLEMENT_REASON_DEFS.map((e) => ({ id: e.id, kind: "reason", term: e.id, definition: e.definition, usedOn: [], lessonId: null, source: "lib/hub/ledger.js settle() / lib/hub/routes.js / lib/payout-verify.js" })),
];

// Every entry, plus its lesson href — computed here (not stored) so a rename in teach.js's
// lessonHref format is picked up automatically.
function entries() {
  return ENTRIES.map((e) => ({ ...e, lesson: e.lessonId ? { id: e.lessonId, href: lessonHref(e.lessonId) } : null }));
}
function byId(id) { return entries().find((e) => e.id === String(id || "")) || null; }
// Every id whose kind is "reason" — what scripts/hub-glossary-test.cjs's drift check (and any
// future caller that wants just the reason vocabulary) checks membership against.
function reasonIds() { return ENTRIES.filter((e) => e.kind === "reason").map((e) => e.id); }

module.exports = { entries, byId, reasonIds };
