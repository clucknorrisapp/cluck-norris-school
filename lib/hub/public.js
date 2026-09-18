"use strict";
// lib/hub/public.js — the PUBLIC face of the Hub: pure view builders over the stores the routes
// already keep (buy comps, Buy Special draws, the CUNA giveaway, lock-to-earn). It WHITELISTS,
// never filters: every field on a public view is named here, so a private field on a record (a
// comp's payout token, its Telegram chat id, a board message id) can never leak by default. The
// test asserts the JSON of every view carries none of them.
//
// Theme (owner, 2026-09-14): "the strongest version of Earn is the one we can prove: a holder who
// can check what they were owed and what arrived." These views are that check, without a wallet.
// Brand rule: say what is on-chain, never why. A disqualification is shown as the observed fact
// (sold in the window; moved the bag out during the hold) and the rule it broke — never a motive.

const { canonicalJson, sha256, versionFor } = require("./project");
const { accruedByWallet, receipt: ledgerReceipt } = require("./ledger");
const { attributePeriods, explainReceipt } = require("./explain");

const B58 = require("../solana-addr").SOL_ADDR_RE;
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const big = (v) => { try { return BigInt(String(v == null ? 0 : v)); } catch (_) { return 0n; } };

// raw base units → whole-token string by string surgery, never division: this number is what a
// person is told they received.
function rawToUi(raw, decimals = 9) {
  let s = big(raw).toString();
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  if (!(decimals > 0)) return (neg ? "-" : "") + s;
  if (s.length <= decimals) s = "0".repeat(decimals - s.length + 1) + s;
  const w = s.slice(0, s.length - decimals), f = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + w + (f ? "." + f : "");
}

// ── buy competitions ──────────────────────────────────────────────────────────────────────────
// The terms a comp RAN under. Comps predate program versions, so the hash is taken over the fields
// that decide who wins and how much — never over results, the journal or bookkeeping — so it is
// stable from the moment the comp starts and anyone can recompute it from the public view.
function compTerms(c) {
  return {
    kind: "buy-comp", id: String(c.id || ""), mint: String(c.mint || ""), ticker: String(c.ticker || ""),
    startTs: num(c.startTs), endTs: num(c.endTs), holdHours: num(c.holdHours) || 0,
    metric: c.metric === "single" ? "single" : "cumulative",
    places: (Array.isArray(c.places) ? c.places : []).map((p) => ({ rank: num(p.rank), amount: num(p.amount) })),
    pctPrize: !!c.pctPrize, usdPrize: !!c.usdPrize,
    prizeToken: { kind: (c.prizeToken && c.prizeToken.kind) || "native", mint: (c.prizeToken && c.prizeToken.mint) || null },
    minVolSol: num(c.minVolSol) || 0,
    exclude: [...(Array.isArray(c.exclude) ? c.exclude : [])].filter((w) => B58.test(w)).sort(),
    pools: [...(Array.isArray(c.pools) ? c.pools : [])].filter((w) => B58.test(w)).sort(),
    entryUsd: num(c.entryUsd), entryHorses: num(c.entryHorses),
  };
}
function termsHash(terms) { return sha256(canonicalJson(terms)); }

function payoutRows(payouts) {
  return Object.entries(payouts || {}).map(([wallet, p]) => ({
    wallet, amountUi: num(p && p.amountUi), sig: (p && p.sig) || null, at: num(p && p.at),
    state: p && p.pending ? "submitted" : "settled", confirmedAt: num(p && p.confirmedAt),
  })).sort((a, b) => (b.amountUi || 0) - (a.amountUi || 0));
}
const sumUi = (rows, pick) => +rows.reduce((t, r) => t + (num(pick(r)) || 0), 0).toFixed(9);

function compView(c) {
  const terms = compTerms(c);
  const results = (Array.isArray(c.verified) ? c.verified : []).map((v) => ({
    rank: num(v.rank), wallet: String(v.wallet || ""), amount: num(v.amount),
    amountUnit: v.amountUnit === "sol" ? "sol" : "token", amountNote: v.amountNote || null,
    status: String(v.status || ""), note: String(v.note || ""),
  }));
  // Every candidate the hold check looked at, with the observed fact. This is the part a losing
  // wallet most wants to see, and the part that makes the winners' list believable.
  const review = (Array.isArray(c.verifyResults) ? c.verifyResults : []).map((r) => ({
    wallet: String(r.wallet || ""), status: String(r.status || ""), fact: String(r.note || ""),
    value: num(r.value), tokensBought: num(r.tokensBought),
  }));
  const payouts = payoutRows(c.payouts);
  const voids = (Array.isArray(c.payoutsVoid) ? c.payoutsVoid : []).map((v) => ({
    wallet: String(v.wallet || ""), sig: v.sig || null, amountUi: num(v.amountUi), reason: v.reason || null, voidedAt: num(v.voidedAt),
  }));
  const settled = payouts.filter((p) => p.state === "settled"), submitted = payouts.filter((p) => p.state === "submitted");
  const paidSet = new Set(payouts.map((p) => p.wallet));
  const owed = results.filter((r) => r.amountUnit === "token" && r.amount > 0);
  const holdEndsTs = terms.endTs != null ? terms.endTs + terms.holdHours * 3600000 : null;
  const ats = payouts.map((p) => p.at).filter((t) => t != null);
  return {
    kind: "buy-comp", id: terms.id, label: String(c.label || c.ticker || ""), ticker: terms.ticker, mint: terms.mint,
    prizeMint: terms.prizeToken.kind === "spl" && terms.prizeToken.mint ? terms.prizeToken.mint : terms.mint,
    status: String(c.status || ""), createdAt: num(c.createdAt), verifiedAt: num(c.verifiedAt),
    verifiedBy: c.verifiedBy === "operator" ? "operator" : "scanner",
    listHistory: (Array.isArray(c.verifiedHistory) ? c.verifiedHistory : []).map((h) => ({
      at: num(h.at), by: h.by || null, note: String(h.note || ""), replacedCount: Array.isArray(h.replaced) ? h.replaced.length : 0,
    })),
    timeline: { startTs: terms.startTs, endTs: terms.endTs, holdEndsTs, verifiedAt: num(c.verifiedAt),
      firstPaidAt: ats.length ? Math.min(...ats) : null, lastPaidAt: ats.length ? Math.max(...ats) : null },
    terms, termsHash: termsHash(terms), prizeSummary: String(c.prizeSummary || ""),
    results, review, payouts, voids,
    // A winner with no journal row is "no receipt on file" — NEVER "owed". Comps settled before
    // the Hub journaled signatures (the airdropper path) have winners and no rows; calling those
    // owed on a public page is false (owner, 2026-09-16: "we've paid things and it still showed
    // owed"). Only a live ledger figure may use the word.
    payoutNote: results.length && !payouts.length && /^(verified|closed)$/.test(String(c.status || ""))
      ? "No transaction receipts are on file for this competition — it was settled before the Hub journaled signatures."
      : null,
    totals: {
      winners: results.length, sealedUi: sumUi(owed, (r) => r.amount),
      paidUi: sumUi(settled, (p) => p.amountUi), submittedUi: sumUi(submitted, (p) => p.amountUi),
      settled: settled.length, submitted: submitted.length, noReceipt: owed.filter((r) => !paidSet.has(r.wallet)).length,
      reviewed: review.length, disqualified: review.filter((r) => r.status === "dq").length, manual: review.filter((r) => r.status === "manual").length,
    },
  };
}

// ── Buy Special draws (the reproducible raffle) ───────────────────────────────────────────────
function drawView(d) {
  const winners = (Array.isArray(d.winners) ? d.winners : []).map((w) => ({ rank: num(w.rank), wallet: String(w.wallet || ""), prize: num(w.prize), chances: num(w.chances) }));
  const review = (Array.isArray(d.reviewed) ? d.reviewed : []).map((r) => ({ wallet: String(r.wallet || ""), status: String(r.status || ""), fact: String(r.note || ""), buyCount: num(r.buyCount) }));
  const terms = { kind: "buy-special-draw", id: String(d.id || ""), mint: String(d.mint || ""), from: num(d.from), to: num(d.to),
    holdHours: num(d.holdHours) || 0, requireHold: d.requireHold !== false, winnersCount: num(d.winnersCount), prize: num(d.prize), method: String(d.method || "") };
  return {
    kind: "buy-special-draw", id: terms.id, label: "Buy Special draw", ticker: "CLKN", mint: terms.mint, prizeMint: terms.mint,
    status: winners.length ? "drawn" : "open",
    timeline: { startTs: terms.from, endTs: terms.to, holdEndsTs: terms.to != null ? terms.to + terms.holdHours * 3600000 : null, drawnAt: num(d.drawnAt) },
    terms, termsHash: termsHash(terms), method: terms.method, seed: String(d.seed || ""), reproducible: !!(d.seed && terms.method),
    eligible: (Array.isArray(d.eligible) ? d.eligible : []).map((e) => ({ wallet: String(e.wallet || ""), chances: num(e.chances) })),
    totalEntries: num(d.totalEntries), buyersTotal: num(d.buyersTotal),
    review, winners,
    // Draws were paid through the airdropper before receipts were journaled — said plainly.
    payouts: [], payoutNote: "paid through the airdropper before the Hub journaled signatures — no receipts on file for this draw",
    totals: { winners: winners.length, prizeEachUi: terms.prize, owedUi: winners.length * (terms.prize || 0), paidUi: 0, settled: 0, submitted: 0,
      reviewed: review.length, disqualified: review.filter((r) => r.status === "dq").length, manual: review.filter((r) => r.status === "manual").length },
  };
}

// ── the CUNA giveaway (sealed draw + server-signed payouts) ──────────────────────────────────
function giveawayView({ draw, payouts, cfg } = {}) {
  if (!draw || !Array.isArray(draw.winners)) return null;
  const round = String(draw.seedHash || "nodraw");
  const mint = String(draw.mint || (cfg && cfg.mint) || "");
  const winners = draw.winners.map((w) => ({ rank: num(w.rank), wallet: String(w.wallet || ""), prizeUi: num(w.prize), alternate: !!w.alternate }));
  const rows = payoutRows((payouts && payouts[round]) || {});
  const settled = rows.filter((p) => p.state === "settled"), submitted = rows.filter((p) => p.state === "submitted");
  const real = winners.filter((w) => !w.alternate && w.prizeUi > 0);
  const ats = rows.map((p) => p.at).filter((t) => t != null);
  return {
    kind: "giveaway", id: "giveaway-" + round.slice(0, 12), label: "Holder giveaway", ticker: String((cfg && cfg.symbol) || "CUNA"), mint, prizeMint: mint,
    status: rows.length ? "paid" : "drawn",
    timeline: { drawnAt: num(draw.at), firstPaidAt: ats.length ? Math.min(...ats) : null, lastPaidAt: ats.length ? Math.max(...ats) : null },
    seedSlot: num(draw.seedSlot), seedHash: draw.seedHash || null, reproducible: !!draw.seedHash,
    winners, payouts: rows,
    totals: { winners: real.length, sealedUi: sumUi(real, (w) => w.prizeUi), paidUi: sumUi(settled, (p) => p.amountUi), submittedUi: sumUi(submitted, (p) => p.amountUi),
      settled: settled.length, submitted: submitted.length, noReceipt: real.filter((w) => !rows.some((r) => r.wallet === w.wallet)).length },
  };
}

// ── lock-to-earn (the accrual ledger + the airdropper batches with their signatures) ─────────
// `project` and `programState` are OPTIONAL, additive inputs for roadmap E5 ("the receipt
// teaches"): without them every row's `explanation` degrades to `{steps:[], missing:[...]}` —
// never a fabricated walkthrough — so a caller that has not been updated (this file's own test)
// sees exactly the view it always has, plus one harmless extra field per row.
function stakeView({ days, paid, batches, decimals = 9, project = null, programState = null } = {}) {
  const accrued = accruedByWallet(days);
  let accruedTotal = 0n; for (const v of Object.values(accrued)) accruedTotal += v;
  let paidTotal = 0n;
  const paidRows = Object.entries(paid || {}).map(([wallet, raw]) => { const v = big(raw); paidTotal += v; return { wallet, paidUi: rawToUi(v, decimals) }; });

  // "How this number was computed" (roadmap E5): attribute each SENT row's amount to the exact
  // hourly accrual slices it drew on, purely by replaying every batch this project has ever built
  // in the order it was built. This never decides money — a batch's amount was already fixed by
  // pay.buildBatch — it only explains, after the fact, a number that cannot be changed by this
  // module. Batches are walked oldest-first so a wallet's periods are consumed in the same order
  // its accrual actually happened; only SENT rows consume anything (a cancelled or still-pending
  // row returns its periods to the next batch, exactly as owedNow already treats it).
  const orderedBatches = Object.values(batches || {}).filter(Boolean)
    .sort((a, b) => (num(a.at) || 0) - (num(b.at) || 0) || String(a.id || "").localeCompare(String(b.id || "")));
  const running = {};              // wallet -> BigInt consumed by batches already walked
  const explanationOf = {};        // batchId -> wallet -> explanation
  for (const b of orderedBatches) {
    explanationOf[b.id] = {};
    for (const [wallet, raw] of Object.entries(b.amounts || {})) {
      if (!(b.sent && b.sent[wallet])) continue;
      const before = running[wallet] || 0n;
      explanationOf[b.id][wallet] = (() => {
        if (!project) return { steps: [], missing: ["the project record is not available"], total: null, matchesReceipt: false };
        const attr = attributePeriods({ days, wallet, alreadyConsumedRaw: before.toString(), amountRaw: raw });
        if (!attr.ok) return { steps: [], missing: [attr.reason || "the accrual periods behind this receipt could not be attributed"], total: null, matchesReceipt: false };
        const lastPeriod = attr.periods[attr.periods.length - 1];
        const pv = programState ? versionFor(programState, lastPeriod) : null;
        const receipt = { wallet, periods: attr.periods, totals: { owedRaw: String(raw), appliedRaw: String(raw), excessRaw: "0", remainingRaw: "0", waivedRaw: "0" } };
        return explainReceipt({ project, programVersion: pv, receipt, ledgerRows: days });
      })();
      running[wallet] = before + (big(raw) || 0n);
    }
  }

  const batchViews = orderedBatches.map((b) => ({
    id: String(b.id || ""), state: String(b.state || ""), at: num(b.at), count: num(b.count), totalUi: rawToUi(b.totalRaw, decimals),
    confirmedAt: num(b.confirmedAt), cancelledAt: num(b.cancelledAt), note: String(b.note || ""),
    // Only rows that were SENT are public (with their signature). A row in a batch that is built
    // but not yet sent is not shown — the public record is what was paid, never "owed" next to
    // an address (owner, 2026-09-16). count/totalUi still describe the whole batch.
    rows: Object.entries(b.amounts || {}).filter(([wallet]) => b.sent && b.sent[wallet]).map(([wallet, raw]) => {
      const s = b.sent[wallet];
      return { wallet, amountUi: rawToUi(raw, decimals), sig: s.sig ? String(s.sig) : null, at: num(s.at),
        state: s.sig ? (s.pending ? "submitted" : "settled") : "confirmed-manually",
        explanation: explanationOf[b.id][wallet] };
    }),
  })).sort((a, b) => (b.at || 0) - (a.at || 0));
  // The accrual store is keyed by HOURLY slice ("YYYY-MM-DDTHH"); days are the distinct dates.
  const sliceKeys = Object.keys(days || {}).sort();
  const dayKeys = [...new Set(sliceKeys.map((k) => String(k).slice(0, 10)))].sort();
  const owedRaw = accruedTotal - paidTotal;
  return {
    kind: "lock-to-earn", id: "lock-to-earn", label: "Lock to Earn",
    status: sliceKeys.length ? "accruing" : "not-started",
    accrual: { slices: sliceKeys.length, days: dayKeys.length, firstDay: dayKeys[0] || null, lastDay: dayKeys[dayKeys.length - 1] || null, wallets: Object.keys(accrued).length },
    totals: { accruedUi: rawToUi(accruedTotal, decimals), paidUi: rawToUi(paidTotal, decimals), sincePayoutUi: rawToUi(owedRaw < 0n ? 0n : owedRaw, decimals),
      batches: batchViews.length, settled: batchViews.reduce((t, b) => t + b.rows.filter((r) => r.sig).length, 0) },
    payouts: batchViews.flatMap((b) => b.rows.filter((r) => r.sig).map((r) => ({ ...r, batchId: b.id }))),
    batches: batchViews, paid: paidRows,
  };
}

// ── B5: the public projection of a program version + its on-chain commitment (roadmap E3) ─────
// Only sig/slot/observedAt ever reach a public body — never the memo text (it's derivable from
// the version's own hash + the project id + version number anyway, so repeating it publicly adds
// nothing a reader cannot already recompute themselves).
function commitmentView(v) {
  const c = v && v.commitment;
  if (!c || !c.sig) return null;
  return { sig: String(c.sig), slot: Number.isInteger(c.slot) ? c.slot : null, observedAt: Number(c.observedAt) || null };
}
function programVersionView(v) {
  if (!v) return null;
  return { version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo != null ? v.effectiveTo : null, hash: v.hash, terms: v.terms, commitment: commitmentView(v) };
}

// ── one project, every program ───────────────────────────────────────────────────────────────
const startOf = (p) => (p.timeline && (p.timeline.startTs || p.timeline.drawnAt)) || p.createdAt || 0;
// `lessonReads` (optional): { count, period, denominator } from lib/traction.js
// lessonReadsForProject() — E6, the school → Hub bridge. Whitelisted down to just `count` and
// `period` on the public view: `denominator` is an internal figure for the W9 report, never
// shown next to a project's own number (an "N visitors ÷ M page views" line invites exactly the
// kind of rate-shaped claim this module elsewhere goes out of its way to avoid).
function projectView({ project, comps = [], draws = [], stake = null, giveaway = null, lessonReads = null }) {
  const programs = [...comps.map(compView), ...draws.map(drawView)];
  if (giveaway) programs.push(giveaway);
  if (stake) programs.push(stake);
  programs.sort((a, b) => startOf(b) - startOf(a));
  const receipts = programs.reduce((t, p) => t + (p.payouts || []).filter((r) => r.sig).length, 0);
  return {
    id: project.id, label: project.label, symbol: project.symbol, mint: project.mint,
    decimals: Number.isInteger(project.decimals) ? project.decimals : null,
    // The reward asset (may differ from the locked token); amounts in `programs` are formatted
    // with ITS decimals (P1-036).
    rewardMint: project.rewardMint ? String(project.rewardMint) : project.mint,
    rewardDecimals: Number.isInteger(project.rewardDecimals) ? project.rewardDecimals : (Number.isInteger(project.decimals) ? project.decimals : null),
    // dryRun + brand (Colosseum E10) — whitelisted like every other public field here. brand is
    // re-shaped rather than passed through verbatim so an unexpected extra key on the stored
    // record can never leak onto the public page.
    dryRun: project.dryRun === true,
    brand: project.brand ? {
      logo: project.brand.logo || null, accent: project.brand.accent || null, accent2: project.brand.accent2 || null,
      tagline: project.brand.tagline || null, socials: project.brand.socials || null,
    } : null,
    generatedAt: Date.now(), programs,
    totals: { programs: programs.length, receipts, paidRows: programs.reduce((t, p) => t + (p.payouts || []).length, 0) },
    lessonReads: (lessonReads && lessonReads.count > 0) ? { count: lessonReads.count, period: lessonReads.period } : null,
  };
}

// Everything one wallet was part of in one project: eligible, owed, paid, disqualified, reviewed.
function walletLookup(view, wallet) {
  const w = String(wallet || "");
  if (!B58.test(w)) return { ok: false, error: "not a Solana address" };
  const entries = [];
  for (const p of view.programs || []) {
    const head = { projectId: view.id, program: p.id, kind: p.kind, label: p.label, ticker: p.ticker || view.symbol };
    for (const r of p.results || []) if (r.wallet === w) entries.push({ ...head, role: "winner", rank: r.rank, amountUi: r.amount, unit: r.amountUnit, note: r.note });
    for (const r of p.winners || []) if (r.wallet === w) entries.push({ ...head, role: r.alternate ? "alternate" : "winner", rank: r.rank, amountUi: r.prizeUi != null ? r.prizeUi : r.prize });
    for (const r of p.review || []) if (r.wallet === w && r.status !== "qualified" && r.status !== "eligible") entries.push({ ...head, role: r.status, fact: r.fact });
    for (const r of p.payouts || []) if (r.wallet === w) entries.push({ ...head, role: "paid", amountUi: r.amountUi, sig: r.sig, at: r.at, state: r.state });
    // Batch rows without a signature (a batch built but not yet sent) are NOT surfaced: the public
    // record is what was paid, with its transaction — never "owed" next to an address.
  }
  return { ok: true, wallet: w, projectId: view.id, entries };
}

// `journal`/`batches`/`project`/`programState` are OPTIONAL, additive context (W3 — closing
// lib/hub/README.md's "receipt gap"): without them this returns exactly the legacy shape it always
// has. With them, a "lock-to-earn" row that the settlement journal already has at least one event
// for (i.e. it went through the dual-write in lib/hub/routes.js POST /api/hub/:project/payout)
// serves the Addendum-B3 receipt built by lib/hub/ledger.js receipt() instead — settlements[] +
// totals + the program-version hash the batch was built under — never a fabricated one: a row with
// no journal event (predates this change, or the transfer could not be attributed to one
// instruction) stays on the legacy shape below. `batches` is the project's raw batches map
// (hubStore part "batches"); `project` is the FULL registry record (for fundingWallet — the trimmed
// `hubProjects()` view server.js also passes as `view` does not carry it); `programState` is the
// project's raw "state" part, used to look up the program version in force when the batch was built.
function findReceipt(view, sig, { journal = null, batches = null, project = null, programState = null } = {}) {
  const s = String(sig || "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s)) return null;
  for (const p of view.programs || []) {
    const row = (p.payouts || []).find((r) => r.sig === s);
    if (!row) continue;
    if (p.kind === "lock-to-earn" && journal && batches && row.batchId != null) {
      const batch = batches[row.batchId];
      const hasJournalEntry = batch && Object.values(journal).some((e) => e && e.projectId === view.id && e.batchId === batch.id && e.wallet === row.wallet);
      if (batch && hasJournalEntry) {
        const day = Number.isFinite(Number(batch.at)) ? new Date(Number(batch.at) * 1000).toISOString().slice(0, 10) : null;
        const version = programState && day ? versionFor(programState, day) : null;
        const rewardMint = (project && project.rewardMint) || view.rewardMint;
        const rewardDecimals = Number.isInteger(project && project.rewardDecimals) ? project.rewardDecimals : view.rewardDecimals;
        if (version && rewardMint != null && Number.isInteger(rewardDecimals)) {
          const shimBatch = { ...batch, projectId: view.id, programVersion: version.version, programHash: version.hash, rewardMint, rewardDecimals };
          const rec = ledgerReceipt({ projectId: view.id, batch: shimBatch, wallet: row.wallet, journal, project: project || null });
          // adv P1-4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): wrap the Addendum-B3 receipt in the
          // SAME siblings (`program`, `symbol`, `dryRun`, `brand`) the legacy shape returns below —
          // public/hub.html's renderReceipt reads `r.program`/`r.symbol`/`r.dryRun`/`r.brand` and
          // `r.receipt` regardless of which shape `r.receipt` itself turns out to be, so a caller
          // that has not been updated to expect settlements[] still finds every field it looks for
          // at the level it already looks for it. `rec` itself is untouched — it still validates
          // receipt.schema.json on its own (see scripts/hub-schema-test.cjs test 4).
          // stakeView()'s program object (kind "lock-to-earn") carries no mint/prizeMint of its own
          // (nothing to disambiguate — a project has exactly one lock-to-earn program); `view.mint`
          // / `rewardMint` (already resolved above) fill that in rather than leaving them undefined.
          if (rec) return { projectId: view.id, symbol: view.symbol, dryRun: view.dryRun === true, brand: view.brand || null,
            program: { kind: p.kind, id: p.id, label: p.label, ticker: p.ticker || view.symbol, mint: p.mint || view.mint, prizeMint: p.prizeMint || rewardMint || p.mint || view.mint, termsHash: rec.programHash || null },
            receipt: rec };
        }
        // A journal event exists but the program version (or the reward asset's decimals) could not
        // be resolved — never invent either; fall through to the legacy shape rather than serve a
        // receipt with a guessed hash.
      }
    }
    return { projectId: view.id, symbol: view.symbol, dryRun: view.dryRun === true, brand: view.brand || null, program: { kind: p.kind, id: p.id, label: p.label, ticker: p.ticker || view.symbol, mint: p.mint, prizeMint: p.prizeMint || p.mint, termsHash: p.termsHash || null }, receipt: row };
  }
  return null;
}

module.exports = { rawToUi, compTerms, termsHash, compView, drawView, giveawayView, stakeView, projectView, walletLookup, findReceipt, commitmentView, programVersionView, B58 };
