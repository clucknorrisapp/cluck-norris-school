"use strict";
// Teach the button before you offer it (design Addendum C). The six answers a holder should have
// before they immobilise tokens for months — every one DERIVED from the program's own entities,
// none authored per project. No operator free text reaches this module: it has no parameter for
// it. No APR, APY or per-year rate is ever produced: the pool is shared and any individual's share
// falls when others lock, so a rate shown before commitment would be the exact pattern this
// project exists to warn about (C3). Test 17 pins the absence over every string this emits.
//
// Pure. Strings are English with stable keys and params so the seven-language dictionary can
// replace the text without touching the derivation.

const DAY = 86400;

// C4: the lesson map is a constant beside the curriculum, identical for every project. The ids
// are core-track LESSONS ids from src/App.jsx; scripts/hub-teach-test.cjs fails if one stops
// resolving, so a renamed or deleted lesson breaks the build rather than shipping a dead link.
const LESSON_MAP = Object.freeze({
  what_happens: "tokenomics",   // supply, vesting and locks
  can_i_sell: "wallets",        // custody: who can move what
  where_reward: "staking",      // where yield actually comes from
  how_much: "lp",               // a share of a shared pool, and dilution
  risks: "volatility",          // the risk of being unable to react
  why_lock: "rugs",             // why projects lock in the first place
});
// projectId (optional) carries the Hub context back to the school so a learner who arrives here
// from a project page can be bridged back to THAT project's page (E6: the school → Hub bridge)
// instead of the generic /hub index, and so the finished-lesson funnel event
// (`hub_lesson_read:<project>`, see lib/traction.js) can be attributed. Parsed client-side by
// src/App.jsx's hashParam("from"); format kept deliberately simple ("hub:<id>") since the id is
// the only thing that needs to survive the round trip.
const lessonHref = (id, projectId) => `/school#lesson=${id}` + (projectId ? `&from=hub:${projectId}` : "");

const RATE_LANGUAGE = /\bAPR\b|\bAPY\b|\bannual(?:i[sz]ed)?\s+(?:rate|yield|return)\b|\bper[- ]?(?:year|annum)\b|%\s*(?:\/|per|a|an)\s*(?:year|yr|annum)\b|\byearly\s+(?:rate|yield|return)\b/i;
function containsRateLanguage(text) { return RATE_LANGUAGE.test(String(text || "")); }

const dateOf = (unix) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);
const whole = (raw, decimals) => {
  let s = String(BigInt(raw || 0));
  if (s.length <= decimals) s = "0".repeat(decimals - s.length + 1) + s;
  const w = s.slice(0, s.length - decimals), f = s.slice(s.length - decimals).replace(/0+$/, "");
  return Number(w).toLocaleString("en-US") + (f ? "." + f : "");
};
const short = (a) => { const s = String(a || ""); return s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s; };

// The last release date of a normalized escrow: cliff plus every period. Null when unreadable.
function lockEndUnix(lock) {
  if (!lock) return null;
  const cliff = Number(lock.cliffTime || 0);
  if (!cliff) return null;
  const freq = Number(lock.frequency) || 0, periods = Number(lock.periods) || 0;
  return cliff + Math.max(0, periods - 1) * freq;
}

// project: the Project record; version: a program version record; funding: lib/hub/ledger.fundingStatus
// output; lock (optional): the connected wallet's normalized escrow; estimate (optional): today's
// preview { sliceRaw, dailyRaw } — page-only, never stored.
function teachBlock({ project, version, funding, lock = null, estimate = null }) {
  if (!project || !version || !version.terms) throw new Error("teachBlock needs the project and a program version");
  const t = version.terms;
  const sym = project.symbol;
  const dec = Number(project.decimals) || 0;
  const rdec = Number(project.rewardDecimals) || 0;
  const rewardDiffers = String(project.rewardMint) !== String(project.mint);
  const answers = [];
  const q = (key, question, text, params, derivedFrom, opts = {}) => answers.push({ key, question, text, params, derivedFrom, lesson: { id: LESSON_MAP[key], href: lessonHref(LESSON_MAP[key], project.id) }, alwaysVisible: !!opts.alwaysVisible });

  // 1. What happens to my tokens?
  if (lock && lockEndUnix(lock)) {
    const end = lockEndUnix(lock);
    q("what_happens", "What happens to my tokens?",
      `${whole(lock.totalRaw, dec)} ${sym} sit in Jupiter Lock escrow ${short(lock.escrow)} — an on-chain account you can open yourself — with the last release on ${dateOf(end)}. The program counts your term from ${dateOf(lock.firstSeenAt)}, the day it first saw this lock, never from a date you set.`,
      { escrow: lock.escrow, amountRaw: String(lock.totalRaw), unlockDate: dateOf(end), firstSeenAt: dateOf(lock.firstSeenAt) },
      ["eligibility.escrow", "eligibility.amountRaw", "eligibility.firstSeenAt", "lock.cliffTime", "lock.frequency", "lock.periods"]);
  } else {
    q("what_happens", "What happens to my tokens?",
      `Your ${sym} move into a Jupiter Lock escrow — an on-chain account you can open yourself — until the unlock date you choose. This program counts terms from ${t.minDurationDays} to ${t.maxTermDays} days, measured from the day it first sees your lock.`,
      { minTermDays: t.minDurationDays, maxTermDays: t.maxTermDays },
      ["version.terms.minDurationDays", "version.terms.maxTermDays"]);
  }

  // 2. Can I sell during the lock? — always visible
  if (t.cancelableAllowed) {
    q("can_i_sell", "Can I sell during the lock?",
      `Not while they are locked. This program allows cancelable locks, which means the lock's creator can cancel it and take the tokens back before the date — so a cancelable lock is not a commitment the way a fixed one is.`,
      { cancelableAllowed: true }, ["version.terms.cancelableAllowed"], { alwaysVisible: true });
  } else {
    q("can_i_sell", "Can I sell during the lock?",
      `No. Until the unlock date nobody can move them early — not you, not the project, not us. A cancelable lock does not qualify for this program.`,
      { cancelableAllowed: false }, ["version.terms.cancelableAllowed", "eligibility.reasons"], { alwaysVisible: true });
  }

  // 3. Where does the reward come from?
  const f = funding || {};
  const showing = f.observedBalanceRaw == null ? "balance unavailable" : "observed balance";
  let fundingLine;
  if (f.observedBalanceRaw == null) {
    fundingLine = `Rewards are paid from the funding wallet ${short(project.fundingWallet)}, which the project controls, not us. Right now the program owes ${whole(f.obligationsRaw || "0", rdec)} ${project.rewardSymbol || "reward tokens"} in total and ${whole(f.reservedRaw || "0", rdec)} is set aside in batches being paid. The funding wallet's balance could not be read just now, so no coverage is shown.`;
  } else {
    const sf = BigInt(f.shortfallRaw || 0);
    fundingLine = `Rewards are paid from the funding wallet ${short(project.fundingWallet)}, which the project controls, not us. Right now the program owes ${whole(f.obligationsRaw || "0", rdec)} in total, ${whole(f.reservedRaw || "0", rdec)} is set aside in batches being paid, and the wallet held ${whole(f.observedBalanceRaw, rdec)} when last read${f.observedAt ? " on " + dateOf(f.observedAt) : ""}. ${sf > 0n ? `That is ${whole(sf.toString(), rdec)} short of what is owed.` : "An observed balance is not reserved funding — it can be spent on anything."}`;
  }
  q("where_reward", "Where does the reward come from?", fundingLine,
    { fundingWallet: project.fundingWallet, showing, obligationsRaw: f.obligationsRaw || "0", reservedRaw: f.reservedRaw || "0", observedBalanceRaw: f.observedBalanceRaw == null ? null : f.observedBalanceRaw, shortfallRaw: f.shortfallRaw == null ? null : f.shortfallRaw },
    ["funding.obligationsRaw", "funding.reservedRaw", "funding.observedBalanceRaw", "funding.shortfallRaw", "version.fundingResponsibility"]);

  // 4. How much will I get? — C3: never a rate
  const rule = `Your share is your locked amount multiplied by the term you committed to, from 1x at ${t.minDurationDays} days to the top tier at ${t.maxTermDays} days, divided by everyone else's share.`;
  const honest = "This is today's share. It goes down when more tokens are locked and up when locks end. It is not a rate anyone promised you.";
  if (estimate && estimate.sliceRaw != null) {
    q("how_much", "How much will I get?",
      `Estimate for today only: about ${whole(estimate.sliceRaw, rdec)} this hour, ${whole(estimate.dailyRaw || "0", rdec)} over the day. ${honest} ${rule}`,
      { estimate: true, sliceRaw: String(estimate.sliceRaw), dailyRaw: String(estimate.dailyRaw || "0"), minTermDays: t.minDurationDays, maxTermDays: t.maxTermDays },
      ["estimate (page only, never stored)", "version.terms.poolDailyRaw", "version.terms.minDurationDays", "version.terms.maxTermDays"]);
  } else {
    q("how_much", "How much will I get?",
      `A share of a pool that everyone who locks divides between them. ${rule} ${honest} Connect a wallet to see today's estimate for your own lock.`,
      { estimate: false, minTermDays: t.minDurationDays, maxTermDays: t.maxTermDays },
      ["version.terms.poolDailyRaw", "version.terms.minDurationDays", "version.terms.maxTermDays"]);
  }

  // 5. What are the risks? — always visible; the reward-asset line is mandatory when derived
  const risks = [
    `Your tokens cannot be sold, moved or used for ${t.minDurationDays} to ${t.maxTermDays} days whatever the price does in between.`,
  ];
  if (f.observedBalanceRaw == null) risks.push("The funding wallet's balance could not be read, so whether the rewards owed are covered right now is unknown.");
  else if (BigInt(f.shortfallRaw || 0) > 0n) risks.push("The funding wallet currently holds less than the rewards already owed.");
  if (rewardDiffers) risks.push(`You are locking ${sym} and being paid in a different token (${project.rewardSymbol || short(project.rewardMint)}). Its value moves on its own, so the reward can be worth more or less than it looks today, independently of ${sym}.`);
  q("risks", "What are the risks?", risks.join(" "),
    { minTermDays: t.minDurationDays, maxTermDays: t.maxTermDays, shortfallState: f.observedBalanceRaw == null ? "unknown" : (BigInt(f.shortfallRaw || 0) > 0n ? "short" : "covered_at_last_read"), rewardAssetDiffers: rewardDiffers },
    ["version.terms.minDurationDays", "version.terms.maxTermDays", "funding.shortfallRaw", "project.rewardMint", "project.mint"], { alwaysVisible: true });

  // 6. Why lock at all? — generic, no project-specific claim
  q("why_lock", "Why lock at all?",
    "A lock is a public, checkable promise not to sell for a set time. Projects lock to show their supply is not about to hit the market; holders lock to share in a reward pool for making that promise too. It proves the promise, not the project.",
    {}, []);

  return {
    projectId: project.id, programVersion: version.version, programHash: version.hash,
    rewardAssetDiffers: rewardDiffers,
    answers,
    notices: {
      reproducible: "The calculation is reproducible from the published inputs.",   // never "independently verified" until B5 exists
    },
  };
}

// Every string the block emits, for the rate-language guard and the no-badge guard.
function allText(block) {
  const out = [];
  for (const a of block.answers || []) { out.push(a.question, a.text); }
  for (const v of Object.values(block.notices || {})) out.push(v);
  return out;
}

module.exports = { LESSON_MAP, lessonHref, RATE_LANGUAGE, containsRateLanguage, lockEndUnix, teachBlock, allText, whole, short };
