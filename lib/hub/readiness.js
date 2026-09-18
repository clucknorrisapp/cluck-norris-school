"use strict";
// Launch Readiness (design doc §Addendum A) — the checklist an operator sees before arming a
// program, and the reward-budget planner that backs its funding check. Pure: every item is
// DERIVED from the Project / program version / funding status / locks the caller already has —
// no operator free text, no authored score, no second arithmetic path (Addendum C's discipline,
// extended here to Addendum A). Signed declarations and wallet-bound lesson evidence are a later
// item; nothing here invents them.
//
// Every item is one of ok / warn / block, with its own sentence and the rule that produced it —
// never rolled into a summary "safe" or "verified project" badge (test 14 covers this surface
// too). `readiness().ready` is informational on its own; the /admin arm route is what turns a
// `block` item into an actual refusal, and only for the arm path (roadmap §4 item 2).

const eng = require("./engine");
const proj = require("./project");
const prog = require("../cuna-programme");

// A project is a DRY RUN when the owner labelled it that way in the one free-text field the
// schema already has (project.access.note, set at approval — lib/hub/project.validateProject).
// No schema change: the freeze (2026-09-16) stands. Absent a label, a project is live.
const DRY_RUN_RE = /\bdry[- ]?run\b/i;
function isDryRun(project) {
  return !!(project && project.access && DRY_RUN_RE.test(String(project.access.note || "")));
}

// ── the reward-budget planner ────────────────────────────────────────────────────────────────
// Projects `periods` days forward from `startUnix` (default: the next UTC hour), holding the
// given LOCKS CONSTANT — the only honest assumption without a future chain read — and running
// them through THE SAME lib/hub/engine.accrueSlice the live scheduler calls every real tick.
// There is no second formula: a period is 24 accrueSlice calls (one per UTC hour, exactly what
// 24 real ticks would produce on today's locks), summed. periods[0] is therefore, BY
// CONSTRUCTION, identical to what one day of live accrual would credit right now (test 12).
function planBudget({ programVersion, locks, periods = 4, startUnix } = {}) {
  if (!programVersion || !programVersion.terms) throw new Error("planBudget needs a program version with terms");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(programVersion.effectiveFrom || ""))) {
    throw new Error("planBudget needs the version's effectiveFrom (YYYY-MM-DD)");
  }
  const n = Math.max(0, Math.min(60, Math.floor(Number(periods) || 0)));
  const effFromUnix = Math.floor(Date.parse(programVersion.effectiveFrom + "T00:00:00Z") / 1000);
  const base = Number.isFinite(Number(startUnix)) && Number(startUnix) > 0 ? Number(startUnix) : Math.floor(Date.now() / 1000);
  // Never project before the version is actually in force — that would ask the engine to accrue
  // an hour it would itself refuse ("no program version is in force for this hour").
  const start = Math.floor(Math.max(base, effFromUnix) / 3600) * 3600;
  const project = { mint: programVersion.mint };
  // startedAt=1 (not `start`) on purpose: it feeds disqualify()'s "indexed before the programme
  // began" gate via configFor's startAfterUnix, and these locks already passed that gate for
  // real, on the real chain, under the real (possibly much older) arm date — this projection
  // does not re-litigate when a lock was first seen, only what it earns from `start` forward.
  const state = { versions: [programVersion], armed: true, startedAt: 1 };
  const list = Array.isArray(locks) ? locks : [];
  let days = {};
  let cumulative = 0n;
  const out = [];
  for (let p = 0; p < n; p++) {
    let periodRaw = 0n;
    for (let h = 0; h < prog.SLICES_PER_DAY; h++) {
      const nowUnix = start + p * 86400 + h * 3600;
      // Same call the live scheduler makes (lib/hub/engine.accrualTick → accrueSlice), just fed a
      // held-constant snapshot instead of a fresh chain read — never a parallel formula.
      const res = eng.accrueSlice({ project, state, days, locks: list, ledgerKnown: list.length, nowUnix });
      if (!res.ok) throw new Error(`planBudget: the engine refused a projected slice at ${nowUnix} — ${res.reason}`);
      days = { ...days, [res.key]: res.row };
      periodRaw += BigInt(res.row.distributedRaw);
    }
    cumulative += periodRaw;
    out.push({ period: p, fromUnix: start + p * 86400, obligationRaw: periodRaw.toString(), cumulativeRaw: cumulative.toString() });
  }
  return { startUnix: start, periods: out, totalRaw: cumulative.toString(), dailyRaw: out.length ? out[0].obligationRaw : "0" };
}

// ── the checklist ────────────────────────────────────────────────────────────────────────────
// { project, programVersion, state, fundingStatus, locks } → { ready, items[] }. `programVersion`
// is the version currently IN FORCE (proj.versionFor(state, today)) or null before v1 starts.
// `fundingStatus` is lib/hub/ledger.fundingStatus's output for this project right now.
function readiness({ project, programVersion, state, fundingStatus, locks }) {
  const items = [];
  const push = (key, label, status, detail, rule) => items.push({ key, label, status, detail, rule });
  const st = eng.readState(state);
  const inForce = programVersion || null;
  const fs = fundingStatus || {};

  // 1. Funding wallet — present, and not the same key as the desk/operator login.
  if (!project || !project.fundingWallet) {
    push("funding_wallet", "Funding wallet", "block",
      "no funding wallet is on the project record", "a project needs project.fundingWallet before it can pay anyone");
  } else if ((project.operatorWallets || []).includes(project.fundingWallet)) {
    push("funding_wallet", "Funding wallet", "warn",
      `${project.fundingWallet} is set, but it is ALSO listed as an operator wallet — the desk login and the wallet that signs payouts should be different keys`,
      "project.fundingWallet is not one of project.operatorWallets");
  } else {
    push("funding_wallet", "Funding wallet", "ok",
      `${project.fundingWallet} — distinct from every operator/desk wallet`,
      "project.fundingWallet is set and is not one of project.operatorWallets");
  }

  // 2. Program version published, with a hash that verifies against its own record.
  if (!inForce) {
    push("program_version", "Program version", "block",
      "no program version is in force yet", "proj.versionFor(state, today) is null — publish a version first");
  } else if (!proj.verifyVersionHash(inForce)) {
    push("program_version", "Program version", "block",
      "the version's hash does not verify against its own record", "proj.verifyVersionHash(version) must be true");
  } else {
    push("program_version", "Program version", "ok",
      `v${inForce.version} published ${inForce.effectiveFrom} — hash ${String(inForce.hash).slice(0, 12)}…`,
      "a program version is in force and its hash verifies (lib/hub/project.verifyVersionHash)");
  }

  // 3. On-chain commitment (design Addendum B5) — an optional field a future publish step adds
  // (`version.commitment = { sig, at }`, the funding wallet's own memo transaction). Nothing here
  // requires it to exist; it is read defensively and never treated as anything but what it is.
  const commitment = inForce && inForce.commitment;
  if (commitment && commitment.sig) {
    push("commitment", "On-chain commitment", "ok",
      `the funding wallet signed a memo committing this hash at ${String(commitment.sig).slice(0, 10)}…`,
      "Addendum B5: a memo transaction, signed by the funding wallet, carrying program:<id>:v<n>:<hash>");
  } else {
    push("commitment", "On-chain commitment", "warn",
      "not yet committed (dry run)",
      "Addendum B5's on-chain memo commitment has not been recorded for this version — the calculation is reproducible from the published inputs, not independently verified");
  }

  // 4. Reward asset — matches the locked mint, or the differing-asset warning is mandatory and
  // cannot be dismissed by any operator field (Addendum C, test 16).
  if (project && project.rewardMint && project.mint && String(project.rewardMint) !== String(project.mint)) {
    push("reward_asset", "Reward asset", "warn",
      `holders lock ${project.mint} and are paid in a different asset, ${project.rewardMint} — the differing-asset risk notice is shown to every holder and is not optional`,
      "project.rewardMint !== project.mint (Addendum C's mandatory reward-asset warning)");
  } else {
    push("reward_asset", "Reward asset", "ok",
      "the reward asset matches the locked mint", "project.rewardMint === project.mint");
  }

  // 5. Term range — sane against the same bounds lib/hub/project.validateTerms enforces (the
  // "lock program's real min/max" this platform will admit: 1 to 3650 days, min <= max).
  const terms = inForce && inForce.terms;
  if (!terms) {
    push("term_range", "Term range", "block",
      "no terms to check — no version is in force", "term_range depends on a published program version");
  } else {
    const sane = Number.isInteger(terms.minDurationDays) && terms.minDurationDays >= 1
      && Number.isInteger(terms.maxTermDays) && terms.maxTermDays >= terms.minDurationDays && terms.maxTermDays <= 3650;
    push("term_range", "Term range", sane ? "ok" : "block",
      `${terms.minDurationDays} to ${terms.maxTermDays} days`,
      "1 <= minDurationDays <= maxTermDays <= 3650 — the same bound lib/hub/project.validateTerms enforces at publish");
  }

  // 6. Budget — the projected obligation for the COMING period against the observed funding
  // balance, coverage stated as a fraction with days-of-runway. `block` when coverage < 1: the
  // checklist always classifies a known shortfall as a block (roadmap §4 item 2's default is to
  // SHOW a shortfall, never to silently arm over one) — the arm route below is what turns this
  // into an actual refusal, and only for the confirm=go-live path.
  let plan = null;
  if (inForce) { try { plan = planBudget({ programVersion: inForce, locks: locks || [], periods: 1 }); } catch (_) { plan = null; } }
  if (!inForce || !plan) {
    push("budget", "Reward budget", "block",
      "cannot project a budget without a published, in-force program version", "planBudget needs the version in force");
  } else {
    const existingObligation = (() => { try { return BigInt(fs.obligationsRaw || "0"); } catch (_) { return 0n; } })();
    const nextPeriodRaw = BigInt(plan.periods[0].obligationRaw);
    const neededRaw = existingObligation + nextPeriodRaw;
    if (neededRaw === 0n) {
      push("budget", "Reward budget", "ok",
        "nothing owed yet and nothing projected for the coming period", "obligationsRaw + the next period's projected obligation is 0");
    } else if (fs.observedBalanceRaw == null) {
      push("budget", "Reward budget", "warn",
        "the funding wallet's balance could not be read just now — coverage for the coming period is unknown (never treated as zero)",
        "fundingStatus.observedBalanceRaw is null");
    } else {
      let observed = 0n; try { observed = BigInt(fs.observedBalanceRaw); } catch (_) { observed = 0n; }
      // An advisory ratio for display, not a payment amount — fixed-point to six places is exact
      // enough and keeps this pure BigInt arithmetic until the very last step.
      const coverage = Number((observed * 1000000n) / neededRaw) / 1000000;
      const runwayDays = nextPeriodRaw > 0n ? Number(observed / nextPeriodRaw) : null;
      push("budget", "Reward budget", coverage < 1 ? "block" : "ok",
        `coverage ${coverage.toFixed(2)}x of what is owed plus the coming period (owed ${existingObligation} + projected ${nextPeriodRaw} raw)` +
        (runwayDays == null ? " — no projected burn" : ` — about ${runwayDays} day(s) of runway at the last observed balance`),
        "coverage = observedBalanceRaw / (obligationsRaw + next-period projected obligation); block when coverage < 1");
    }
  }

  // 7. Dry run — always blocks. Terms on a dry-run project are a rehearsal, not an agreement; an
  // operator cannot arm real money against them.
  if (isDryRun(project)) {
    push("dry_run", "Dry run", "block", "dry run — terms not agreed", "project.access.note is labelled a dry run");
  } else {
    push("dry_run", "Dry run", "ok", "not a dry run", "project.access.note carries no dry-run label");
  }

  return { ready: items.every((i) => i.status !== "block"), items };
}

module.exports = { isDryRun, DRY_RUN_RE, planBudget, readiness };
