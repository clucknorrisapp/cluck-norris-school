"use strict";
// lib/hub/preview.js — "who would this pay today?" for DRAFT terms (Colosseum roadmap EE1).
//
// A READ. previewTerms() never writes anything — it builds every value it returns from plain
// objects constructed with the spread operator and hands nothing to hubStore.write / writeVerified
// / kv.set. Nothing here signs, arms, or sends.
//
// It is deliberately NOT a second formula. The two things an operator's draft can get wrong —
// "will this even validate" and "who does this actually pay" — are answered by calling the exact
// same code the live paths call:
//   - proj.createVersion (== lib/hub/routes.js `/admin?terms=1`, the real terms write) builds the
//     version record — same validateTerms, same hash, same ordering rules, same errors — on a
//     throwaway state copy that is never persisted.
//   - eng.accrueSlice (== the hourly scheduler's accrualTick, and the same call
//     lib/hub/readiness.js planBudget already makes for Launch Readiness) is the only function
//     that ever decides an accrual number. previewTerms calls it directly for the per-wallet
//     breakdown and calls planBudget — not a reimplementation of it — for the multi-day budget, so
//     the two numbers in the response can never drift apart from each other or from readiness.
//   - lib/hub/eligibility.js eligibilityRecord (== what the desk already shows for a real lock) is
//     the only function that ever turns a disqualify() reason into a public code.
//
// The projection holds today's locks CONSTANT and starts from the draft version's own
// effectiveFrom (same "the first version starts today, a later edit starts tomorrow" rule
// lib/hub/routes.js applies to a real publish) — exactly the honesty rule lib/hub/readiness.js
// planBudget documents for the reward-budget planner, extended here to eligibility. It never
// re-litigates "was this lock indexed before the programme began" against a fictional start date:
// like planBudget, it credits from the projection's start forward and does not re-decide whether a
// lock the real programme already accepted would still be accepted — see planBudget's own comment
// for why that is the honest thing to hold constant, not the moving date.

const proj = require("./project");
const eng = require("./engine");
const elig = require("./eligibility");
const rdy = require("./readiness");

const MAX_DAYS = 60; // same ceiling lib/hub/readiness.js planBudget enforces

// { project, draftTerms, locks, days?, nowUnix, state, effectiveFrom, todayKey } → the preview.
// `state` is the project's REAL programme state (as read from the store) — passed straight to
// proj.createVersion exactly as the terms-write route passes it, so version numbering and the
// "effectiveFrom must be after the current version's" ordering rule behave identically to a real
// publish. `effectiveFrom` / `todayKey` are computed by the caller with the SAME helpers the
// terms-write route uses (lib/hub/routes.js dayKeyOf / defaultEffectiveFrom) — previewTerms never
// re-derives them, so "what would today's form submit" can never drift between the two routes.
function previewTerms({ project, draftTerms, locks, days = 1, nowUnix, state, effectiveFrom, todayKey } = {}) {
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`previewTerms needs a real nowUnix: ${nowUnix}`);
  const n = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days) || 1)));

  // Same call the terms write makes, on a copy of the state that is never returned to a caller
  // capable of persisting it — validateTerms runs inside this and a bad draft throws the exact
  // error a real publish would (routes.js catches it the same way: 400, publicErrMsg(e)).
  const baseState = eng.readState(state);
  const draftState = proj.createVersion(baseState, project, draftTerms, { effectiveFrom, todayKey });
  const newVersion = draftState.versions[draftState.versions.length - 1];

  // The throwaway state the projection actually runs against — one version (the draft), armed,
  // start date 1 — the same construction lib/hub/readiness.js planBudget uses for its own
  // projection, and for the same reason (see the file header and planBudget's own comment): a
  // fresh 1-epoch start never re-litigates when a lock was first seen, it only asks what these
  // locks earn from the projection's own start forward.
  const projState = { versions: [newVersion], armed: true, startedAt: 1 };
  const list = Array.isArray(locks) ? locks : [];
  const effFromUnix = Math.floor(Date.parse(String(newVersion.effectiveFrom) + "T00:00:00Z") / 1000);
  const start = Math.floor(Math.max(now, effFromUnix) / 3600) * 3600;

  // Day 0 of the projection, hour by hour — the SAME eng.accrueSlice call the live scheduler and
  // planBudget both make. Unlike planBudget, the per-wallet credits are kept rather than discarded
  // after summing, because "who gets paid" is the whole point of a preview.
  let daysAcc = {};
  const miniProject = { mint: newVersion.mint };
  let firstRow = null;
  for (let h = 0; h < 24; h++) {
    const hourUnix = start + h * 3600;
    const res = eng.accrueSlice({ project: miniProject, state: projState, days: daysAcc, locks: list, ledgerKnown: list.length, nowUnix: hourUnix });
    if (!res.ok) throw new Error(`preview: the engine refused a projected slice at ${hourUnix} — ${res.reason}`);
    daysAcc = { ...daysAcc, [res.key]: res.row };
    if (h === 0) firstRow = res.row;
  }
  const creditTotals = {};
  for (const row of Object.values(daysAcc)) {
    for (const [w, raw] of Object.entries(row.credits || {})) {
      try { creditTotals[w] = (creditTotals[w] || 0n) + BigInt(raw); } catch (_) {}
    }
  }
  const dailyPoolRaw = firstRow ? firstRow.dailyPoolRaw : "0";
  const pool = (() => { try { return BigInt(dailyPoolRaw); } catch (_) { return 0n; } })();

  // Eligibility, per wallet — the same eligibilityRecord() the desk shows for a real lock, called
  // once per escrow at the projection's start and folded to one row per recipient: a wallet
  // qualifies if ANY of its locks does (that is what the accrual pool actually pays on), and
  // otherwise reports the reason from whichever of its locks came closest to qualifying.
  const cfg = eng.configFor({ project: miniProject, state: projState, nowUnix: start });
  const byWallet = new Map();
  for (const l of list) {
    const w = l && l.recipient ? String(l.recipient) : null;
    if (!w) continue;
    const rec = elig.eligibilityRecord(l, cfg, start);
    const prev = byWallet.get(w);
    if (!prev || (rec.qualifies && !prev.qualifies) || (!rec.qualifies && !prev.qualifies && rec.reasons.length < prev.reasons.length)) {
      byWallet.set(w, rec);
    }
  }
  const wallets = [...byWallet.entries()].map(([wallet, rec]) => {
    const raw = creditTotals[wallet] || 0n;
    const shareOfPool = pool > 0n ? Number((raw * 1000000n) / pool) / 1000000 : 0;
    return {
      wallet,
      qualified: rec.qualifies,
      reason: rec.qualifies ? null : ((rec.reasons[0] && rec.reasons[0].code) || "other"),
      // The plain-words sentence the code stands for (lib/cuna-staking.js disqualify's own text,
      // via eligibility.js) — a desk shows this, not the bare code, and links the code to the
      // glossary (EE2) for whoever wants the full definition.
      reasonText: rec.qualifies ? null : ((rec.reasons[0] && rec.reasons[0].text) || null),
      accrualRaw: raw.toString(),
      shareOfPool,
    };
  }).sort((a, b) => (BigInt(b.accrualRaw) > BigInt(a.accrualRaw) ? 1 : BigInt(b.accrualRaw) < BigInt(a.accrualRaw) ? -1 : 0));
  const qualifiedCount = wallets.filter((w) => w.qualified).length;

  // The multi-day obligation — lib/hub/readiness.js planBudget itself, not a parallel sum. Same
  // start-alignment rule (`startUnix: now`) as the loop above, so periods[0] here is, by
  // construction, the same day this function just walked hour by hour.
  const budget = rdy.planBudget({ programVersion: newVersion, locks: list, periods: n, startUnix: now });

  return {
    ok: true,
    version: { hash: newVersion.hash, terms: newVersion.terms },
    wallets,
    totals: { qualified: qualifiedCount, excluded: wallets.length - qualifiedCount, dailyPoolRaw },
    budget,
    dryRun: project && project.dryRun === true,
  };
}

module.exports = { previewTerms, MAX_DAYS };
