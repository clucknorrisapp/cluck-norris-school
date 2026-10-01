"use strict";
// lib/hub/explain.js — Addendum C's post-payment mirror (roadmap extension E5, 2026-09-18):
// "how this number was computed" for a settled receipt. Same discipline as teach.js:
//
//   - PURE. No network, no clock, no operator free text — there is no parameter for it.
//   - Every number is DERIVED, never authored. `total` is produced by calling accruedByWallet
//     (lib/hub/ledger.js) — the SAME function the accrual ledger itself uses to sum a wallet's
//     credits — scoped to exactly the hourly slices this receipt says it drew on. That makes
//     `matchesReceipt` true by construction whenever the caller's bookkeeping is honest, and
//     FALSE the moment it is not (a tampered fixture, a period that does not belong).
//   - No APR, APY or per-year rate is ever produced (RATE_LANGUAGE / test 17, mirrored via
//     teach.js's own guard so the two modules can never disagree about what counts).
//   - When the inputs a walkthrough needs were not retained — no periods recorded against the
//     receipt, no accrual ledger to look them up in, no program version on file — this returns
//     NO STEPS and says what is missing. A receipt made before this module existed, or by a
//     payout path that never kept its periods, has nothing to reproduce from; the page must say
//     so plainly rather than print a walkthrough that only looks derived.
//
// attributePeriods() is the read-side helper that a caller (lib/hub/public.js) uses to work out
// WHICH hourly slices a given batch row actually drew on, from nothing but the accrual ledger and
// how much every earlier batch already took for that wallet. It never changes what a batch pays —
// it explains, after the fact, a number that was already fixed. If the arithmetic does not land
// exactly on a period boundary, it fails rather than guessing which part of an hour was whose.

const L = require("./ledger");
const T = require("./teach");   // whole(), short(), LESSON_MAP, lessonHref, containsRateLanguage
const { splitAmount } = require("../buycomp-payout");

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };

// Which hourly slices of `days` this batch's amount for `wallet` was built from, given how much of
// that wallet's accrual earlier batches (by creation time) already consumed. Pure; walks the ledger
// in slice-key order (the ledger is written hour by hour, so key order is chronological) and
// captures a contiguous run of periods whose credits sum to EXACTLY `amountRaw`.
//
//   alreadyConsumedRaw   the total this wallet had already been paid or held by PRIOR batches
//   amountRaw            this batch's amount for this wallet (what the receipt says was owed)
//
// Returns { ok:true, periods:[...] } or { ok:false, periods:[], reason }. Never throws on bad
// data — a caller that cannot attribute periods shows "not retained", not an error page.
function attributePeriods({ days, wallet, alreadyConsumedRaw = "0", amountRaw }) {
  const target = big(amountRaw);
  const already = big(alreadyConsumedRaw) || 0n;
  const w = String(wallet || "");
  if (target === null || target <= 0n || !w || !days) return { ok: false, periods: [], reason: "nothing to attribute" };
  const keys = Object.keys(days).sort();
  let running = 0n;          // every credit this wallet has earned, walked in order, ever
  let capturing = false;
  let capturedSum = 0n;
  const periods = [];
  for (const k of keys) {
    const row = days[k];
    const raw = row && row.credits && row.credits[w];
    const c = raw ? big(raw) : 0n;
    if (c === null || c <= 0n) continue;
    const before = running;
    running += c;
    if (!capturing) {
      if (running <= already) continue;                        // still inside an earlier batch's share
      if (before < already) return { ok: false, periods: [], reason: "an earlier batch's amount does not land on a period boundary" };
      capturing = true;
    }
    periods.push(k);
    capturedSum += c;
    if (capturedSum === target) return { ok: true, periods };
    if (capturedSum > target) return { ok: false, periods: [], reason: "the accrual periods overshoot this batch's amount" };
  }
  return { ok: false, periods: [], reason: "ran out of accrual history before reaching this batch's amount" };
}

// project: the Project record (symbol/rewardSymbol/decimals). programVersion: the version record
// in force when the underlying accrual ran (version.terms). receipt: { wallet, periods, totals? }
// — totals, if present, is the Addendum B partition shape { owedRaw, appliedRaw, excessRaw,
// remainingRaw, waivedRaw }; without it, receipt.amountRaw is read instead. ledgerRows: the
// project's `days` accrual store (or a journal-equivalent), keyed by the same slice keys as
// receipt.periods.
function explainReceipt({ project, programVersion, receipt, ledgerRows }) {
  const missing = [];
  if (!project) missing.push("the project record is not available");
  if (!receipt) missing.push("the receipt is not available");
  if (missing.length) return { steps: [], missing, total: null, matchesReceipt: false };

  const periods = Array.isArray(receipt.periods) ? [...receipt.periods] : null;
  const days = ledgerRows || null;
  if (!periods || !periods.length) missing.push("the accrual periods behind this receipt were not retained");
  if (!days) missing.push("the accrual ledger for this project is not available");
  if (!programVersion || !programVersion.terms) missing.push("the program version in force when this accrued is not retained");
  if (missing.length) return { steps: [], missing, total: null, matchesReceipt: false };

  const wallet = String(receipt.wallet || "");
  const sorted = [...periods].sort();
  const scoped = {};
  for (const k of sorted) {
    if (!Object.prototype.hasOwnProperty.call(days, k)) { missing.push(`accrual period ${k} is no longer in the ledger`); continue; }
    scoped[k] = days[k];
  }
  if (missing.length) return { steps: [], missing, total: null, matchesReceipt: false };

  // The SAME function the accrual ledger uses to turn a set of hourly rows into a wallet's total
  // (lib/hub/public.js's stakeView and lib/cuna-payout's totalCredits both read the identical
  // shape) — called here scoped to exactly this receipt's periods, so the number below cannot
  // drift from how the money itself was actually summed.
  const totals = L.accruedByWallet(scoped);
  const total = (totals[wallet] || 0n).toString();
  const owedRaw = receipt.totals && receipt.totals.owedRaw != null ? String(receipt.totals.owedRaw)
    : receipt.amountRaw != null ? String(receipt.amountRaw) : null;
  const matchesReceipt = owedRaw != null && total === owedRaw;

  const t = programVersion.terms;
  const rdec = Number(project.rewardDecimals != null ? project.rewardDecimals : project.decimals) || 0;
  const sym = project.rewardSymbol || project.symbol || "";
  const steps = [];
  const push = (key, label, value, unit, rule) => steps.push({ key, label, value, unit: unit || null, rule, lesson: { id: T.LESSON_MAP[key] || T.LESSON_MAP.how_much, href: T.lessonHref(T.LESSON_MAP[key] || T.LESSON_MAP.how_much) } });

  // 1. The term rule that decided the multiplier — never a number invented for this wallet, the
  // published rule its own payout was computed under.
  push("term_rule", "The term rule your lock was measured against",
    `${t.minDurationDays}–${t.maxTermDays} days`, "day range",
    `This program pays 1× to a locker who committed the minimum ${t.minDurationDays} days, up to the top rate at ${t.maxTermDays} days or more — the rate you were shown when you locked is the rate every hour below was paid at. No bonus multiplier exists outside this range.`);

  // 2. The accrual window this receipt covers.
  push("accrual_window", `${sorted.length} hourly slice${sorted.length === 1 ? "" : "s"} accrued`,
    `${sorted[0]} → ${sorted[sorted.length - 1]}`, "UTC hours",
    "Every hour the programme runs, it splits that hour's pool across everyone who qualified that hour. This receipt adds up every hour that had not already been paid or held by an earlier payment.");

  // 3. Pro-rata share, hour by hour — the number that answers "how much of that hour's pool was
  // mine", derived from the pool figure the ledger itself recorded for that hour (never a
  // recomputed weight, which the ledger does not keep per wallet after the hour has passed).
  let sumCredits = 0n;
  const perPeriod = sorted.map((k) => {
    const row = scoped[k] || {};
    const c = row.credits && row.credits[wallet] ? BigInt(row.credits[wallet]) : 0n;
    sumCredits += c;
    const pool = row.distributedRaw != null ? big(row.distributedRaw) : row.poolRaw != null ? big(row.poolRaw) : null;
    const pct = pool && pool > 0n ? Number((c * 1000000n) / pool) / 10000 : null;
    return { key: k, creditRaw: c.toString(), pct };
  });
  const shown = perPeriod.slice(0, 6);
  push("pro_rata_share", "Your share of each hour's pool",
    shown.map((p) => `${p.key}: ${T.whole(p.creditRaw, rdec)} ${sym}${p.pct != null ? ` (${p.pct}% of that hour)` : ""}`).join("; ") + (perPeriod.length > shown.length ? `; …and ${perPeriod.length - shown.length} more hour${perPeriod.length - shown.length === 1 ? "" : "s"}` : ""),
    "per-hour", "Your share is your locked amount multiplied by the term you committed to, divided by everyone else's qualifying share that hour — the same rule Addendum C describes before you lock, applied hour by hour rather than estimated in advance. It goes down when more tokens are locked and up when locks end; it is not a rate anyone promised you.");

  // 4. The sum — the number a reader can check by hand against the list above, exactly the total.
  push("subtotal", "Added up", `${T.whole(sumCredits.toString(), rdec)} ${sym}`, sym,
    "The sum of every hour's share listed above. When a pool does not split evenly, the leftover base units go to whichever wallet's share rounds down the most that hour (largest-remainder) — nothing is ever silently dropped, so this sum is exact, not rounded.");

  // 5. Prior payments applied — Addendum B's paidApplied, shown only when it says something a
  // plain total would not: a partial settlement, or an owner waive.
  if (receipt.totals) {
    const rt = receipt.totals;
    const applied = big(rt.appliedRaw) || 0n, owed = big(rt.owedRaw) || 0n, waived = big(rt.waivedRaw) || 0n, remaining = big(rt.remainingRaw) || 0n;
    if (applied !== owed || waived > 0n) {
      push("prior_payments", "Prior payments applied",
        `${T.whole(applied.toString(), rdec)} of ${T.whole(owed.toString(), rdec)} ${sym} applied so far` + (waived > 0n ? `, ${T.whole(waived.toString(), rdec)} waived` : "") + (remaining > 0n ? `, ${T.whole(remaining.toString(), rdec)} still remaining` : ""),
        sym, "Settlements are applied against this row in the order they landed on chain; a partial payment leaves a remainder that is carried forward — it is never re-offered as new money, and an owner waive only ever releases it back to future accrual, never to a payment.");
    }
  }

  return { steps, total, matchesReceipt, missing: [] };
}

// ── buy-comp mirror (Colosseum roadmap extension E5 + §7, the public standings page) ──────────
// A buy-comp winner's "how this number was computed": the published rule for their rank, what
// the scan counted as their own qualifying buy, and the split — computed by splitAmount(), the
// EXACT pure function buyCompVerify (server.js) used, never a re-typed copy. `expectedAmount`
// (optional) is the already-published amount for this wallet (the sealed result, or what was
// actually paid) — when given, `matchesReceipt` says whether this walkthrough's own arithmetic
// lands on that same number; a mismatch here is a real signal (e.g. an operator override), never
// smoothed over.
function explainBuyCompRow({ terms, rank, tokensBought, valueSol, ticker, expectedAmount = null } = {}) {
  const missing = [];
  if (!terms || !Array.isArray(terms.places) || !terms.places.length) missing.push("the competition's published places are not available");
  if (!(Number(rank) >= 1)) missing.push("this wallet's rank is not available");
  if (missing.length) return { steps: [], missing, total: null, matchesReceipt: false };
  const place = terms.places[Number(rank) - 1];
  if (!place) return { steps: [], missing: [`no published place for rank ${rank}`], total: null, matchesReceipt: false };

  const sym = ticker || "tokens";
  const split = splitAmount({ pctPrize: terms.pctPrize, placeAmount: place.amount, tokensBought, valueSol, ticker: sym });
  const steps = [];
  const push = (key, label, value, rule) => steps.push({ key, label, value, unit: null, rule, lesson: { id: T.LESSON_MAP.how_much, href: T.lessonHref(T.LESSON_MAP.how_much) } });

  push("place_rule", `Rank ${rank}'s published prize`,
    terms.pctPrize ? `${place.amount}%` : `${place.amount} ${sym}`.trim(),
    terms.pctPrize
      ? "A percentage prize pays a share of what the winner themselves bought — never a fixed number picked after the fact. This is the same percentage published for this rank before the window opened."
      : "A flat prize is the same published number for this rank, regardless of buy size — set before the window opened, not adjusted afterward.");

  if (terms.pctPrize) {
    push("what_was_bought", "What the scan counted for this wallet",
      Number(tokensBought) > 0
        ? `${Math.round(Number(tokensBought)).toLocaleString()} ${sym} bought`
        : `${(Number(valueSol) || 0).toFixed(2)} SOL of buys (the buy source carried no token amount for this trade)`,
      "The wallet's own qualifying volume from the window-scoped buy scan — the same number the public standings show — never a total position or a balance.");
  }

  push("computed", "Computed",
    split.amountUnit === "sol" ? `${split.amount} SOL` : `${split.amount} ${sym}`.trim(),
    split.amountNote || `The published flat prize for rank ${rank} — ${place.amount} ${sym}.`);

  const total = split.amount;
  const matchesReceipt = expectedAmount == null || (Number.isFinite(Number(expectedAmount)) && Math.abs(Number(total) - Number(expectedAmount)) < 1e-6);
  return { steps, total, matchesReceipt, missing: [] };
}

// Every string the walkthrough emits, for the rate-language and no-badge guards (mirrors
// teach.js's allText so the two modules are checked the same way).
function allText(x) {
  const out = [];
  for (const s of (x && x.steps) || []) { out.push(s.key, s.label, String(s.value), s.rule); }
  return out;
}

module.exports = { attributePeriods, explainReceipt, explainBuyCompRow, allText };
