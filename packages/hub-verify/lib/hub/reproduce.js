"use strict";
// lib/hub/reproduce.js — E1 (docs/COLOSSEUM_ROADMAP.md §1 "The number"): the pure core a reader's
// own machine and the server share to check whether a Hub receipt can be RE-DERIVED from published
// inputs, not merely re-displayed. No I/O — every input here is already-loaded data (a batch, the
// accrual `days`, the project's other batches); the caller (scripts/reproduce-receipt.cjs, or the
// /api/hub/:project/... routes in server.js) does the fetching or the kv reads.
//
// Today this covers TWO kinds: "lock-to-earn" (which CUNA is aliased onto — lib/hub/store.js) and
// "buy-comp" (Colosseum roadmap §7 extension, X3). The live payout that produces a lock-to-earn
// receipt is lib/cuna-payout.js's buildBatch/recordSent, shared by both /cuna-payout and
// /api/hub/:project/payout (lib/hub/routes.js) — a lock-to-earn batch itself carries no
// program-version hash of its own. W3 wired the Addendum-B settlement journal (lib/hub/ledger.js)
// into that same route as a dual-write on top of the legacy batch, so `buildInputsForWallet` /
// `buildBatchInputs` now fill in `programVersion` — {version, hash}, the program version IN FORCE
// when the batch was built — for any (batch, wallet) row that already has a journal event; a row
// with no journal event (predates the dual-write, or its transfer could not be attributed to one
// instruction) still reports `hash: null` honestly, never invented. A buy-comp row reproduces
// through `reproduceBuyCompRow` below, from exactly the fields the public standings route already
// publishes (terms, this wallet's rank, its review row) — `projectReproducibility` runs it over
// every winner of every SEALED comp, and reports an unsealed comp's rows as MISSING_INPUTS ("not
// sealed") rather than guessing at a claim that could still change. Buy Special draws and the CUNA
// giveaway are still their own, not-yet-covered kinds — `reproduce()` and
// `projectReproducibility()` say so as MISSING_INPUTS, naming the kind, rather than silently
// reporting them as reproducible or dropping them from the ratio.
//
// THE ARITHMETIC (mirrors lib/cuna-payout.js exactly, reconstructed from durable, timestamped
// data instead of live state):
//
//   owed(wallet) at the moment a batch was built = every earlier period's credit for that wallet
//                                                   − whatever was already PAID by then
//                                                   − whatever another batch was still HOLDING then
//
// A period's credit is "earlier" if its accrual tick's own timestamp (`days[key].at`) is at or
// before the batch's own creation time (`batch.at`) — periods are never re-accrued once written,
// so this is exact. "Paid by then" and "held by then" are reconstructed from every OTHER batch's
// own timestamps (`at`, `sent[wallet].at`, `cancelledAt`) — batches are never deleted, so nothing
// here needs a separate historical snapshot; the batch store already retains it. This is only ever
// computed for a wallet whose row in this batch is already SENT (a receipt exists) — the same
// public/private line lib/hub/public.js draws: an unsent row is never made public here either.

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };
const nz = (v) => (v < 0n ? 0n : v);
const { splitAmount } = require("../buycomp-payout");

// Every period whose credit for `wallet` had already been written by `uptoAt` (inclusive) — the
// exact set lib/cuna-payout.js's totalCredits/owedNow summed at the moment the batch was built.
function periodsCreditedTo(days, wallet, uptoAt) {
  const out = [];
  for (const [key, d] of Object.entries(days || {})) {
    if (!d || !d.credits) continue;
    const raw = d.credits[wallet];
    if (raw == null) continue;
    const v = big(raw);
    if (v === null || v <= 0n) continue;
    const at = Number(d.at);
    if (!Number.isFinite(at) || at > Number(uptoAt)) continue;
    out.push({ key, at, creditRaw: v.toString() });
  }
  out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// Was `wallet`'s row in batch `b` already recorded PAID (sent[wallet].at) before `uptoAt`?
function paidBefore(b, wallet, uptoAt) {
  if (!b || !b.amounts || !(wallet in b.amounts)) return 0n;
  const s = b.sent && b.sent[wallet];
  if (!s) return 0n;
  const at = Number(s.at);
  return Number.isFinite(at) && at < Number(uptoAt) ? (big(b.amounts[wallet]) || 0n) : 0n;
}

// Was `wallet`'s row in batch `b` RESERVED — created and not yet paid or released — at `uptoAt`?
function heldAt(b, wallet, uptoAt) {
  if (!b || !b.amounts || !(wallet in b.amounts)) return false;
  const T = Number(uptoAt);
  const at = Number(b.at);
  if (!Number.isFinite(at) || !(at < T)) return false;                 // not created yet
  if (b.cancelledAt != null && Number(b.cancelledAt) < T) return false; // released before T
  const s = b.sent && b.sent[wallet];
  if (s && Number(s.at) < T) return false;                             // already paid before T
  return true;
}

// Reconstructs, purely from the batch store's own timestamps, what `owedNow` actually consumed
// for `wallet` at the instant `batch` (excluded from the scan) was created.
function priorState(batches, wallet, excludeBatchId, uptoAt) {
  let paid = 0n, reserved = 0n;
  for (const [id, b] of Object.entries(batches || {})) {
    if (id === excludeBatchId) continue;
    paid += paidBefore(b, wallet, uptoAt);
    if (heldAt(b, wallet, uptoAt)) reserved += big(b.amounts[wallet]) || 0n;
  }
  return { paidRaw: paid.toString(), reservedRaw: reserved.toString() };
}

// The published inputs for one (batch, wallet) row — what the settlement that produced this
// receipt actually used. Only ever built for a wallet already SENT in this batch.
//
// `journal`/`programState` are OPTIONAL, additive (W3): a lock-to-earn batch built by
// lib/cuna-payout.js buildBatch carries no program-version hash of its own (see this file's
// header) — but once the settlement journal has an event for this exact (batch, wallet), the
// program version IN FORCE when the batch was built is a real, derivable fact (the same lookup
// lib/hub/public.js findReceipt uses for the Addendum-B receipt), so `programVersion` is filled in
// from there rather than staying null forever. No journal event yet → unchanged (null), never
// guessed.
function buildInputsForWallet({ batch, wallet, days, batches, journal = null, programState = null }) {
  if (!batch || !batch.amounts || !(wallet in batch.amounts)) return null;
  if (!batch.sent || !batch.sent[wallet]) return null;   // not yet public — see lib/hub/public.js
  const uptoAt = Number(batch.at);
  const periods = periodsCreditedTo(days, wallet, uptoAt);
  const prior = priorState(batches, wallet, batch.id, uptoAt);
  let programVersion = null;
  if (journal && programState) {
    const hasJournalEntry = Object.values(journal).some((e) => e && e.batchId === batch.id && e.wallet === wallet);
    if (hasJournalEntry) {
      const day = Number.isFinite(uptoAt) ? new Date(uptoAt * 1000).toISOString().slice(0, 10) : null;
      const { versionFor } = require("./version-for");
      const v = day ? versionFor(programState, day) : null;
      if (v) programVersion = { version: v.version, hash: v.hash };
    }
  }
  return {
    kind: "lock-to-earn", batchId: batch.id, batchAt: uptoAt, wallet,
    amountRaw: String(batch.amounts[wallet]),
    periods, priorPaidRaw: prior.paidRaw, priorReservedRaw: prior.reservedRaw,
    programVersion,
  };
}

// Every wallet already public through this batch (a sent row) — never an unsent one.
function buildBatchInputs({ batch, days, batches, journal = null, programState = null }) {
  const out = {};
  for (const wallet of Object.keys((batch && batch.sent) || {})) {
    const inp = buildInputsForWallet({ batch, wallet, days, batches, journal, programState });
    if (inp) out[wallet] = inp;
  }
  return out;
}

// The pure check. `programVersion` (a { hash, ... } or null) is carried through only for the
// report — the arithmetic is entirely in `inputs`. `receipt` is the published claim: at minimum
// { amountRaw }. `inputs` is what buildInputsForWallet returns (or null/partial when unavailable).
function reproduce({ programVersion, inputs, receipt } = {}) {
  const hash = (programVersion && programVersion.hash) || null;
  const missing = [];
  if (!receipt || receipt.amountRaw == null) missing.push("receipt.amountRaw (the published amount)");
  if (!inputs) {
    missing.push("the batch's published inputs (periods, prior paid, prior reserved)");
  } else {
    if (!Array.isArray(inputs.periods)) missing.push("inputs.periods");
    if (inputs.priorPaidRaw == null) missing.push("inputs.priorPaidRaw");
    if (inputs.priorReservedRaw == null) missing.push("inputs.priorReservedRaw");
  }
  if (missing.length) {
    return { status: "MISSING_INPUTS", published: receipt && receipt.amountRaw != null ? String(receipt.amountRaw) : null, reproduced: null, hash, missing };
  }

  let credited = 0n;
  for (const p of inputs.periods) {
    const v = big(p && p.creditRaw);
    if (v !== null && v > 0n) credited += v;
  }
  const priorPaid = big(inputs.priorPaidRaw), priorReserved = big(inputs.priorReservedRaw);
  if (priorPaid === null || priorReserved === null) {
    return { status: "MISSING_INPUTS", published: String(receipt.amountRaw), reproduced: null, hash, missing: ["inputs.priorPaidRaw / inputs.priorReservedRaw (not whole numbers)"] };
  }
  const reproduced = nz(credited - priorPaid - priorReserved);
  const published = big(receipt.amountRaw);
  if (published === null) {
    return { status: "MISSING_INPUTS", published: null, reproduced: reproduced.toString(), hash, missing: ["receipt.amountRaw (not a whole number)"] };
  }
  return { status: reproduced === published ? "MATCH" : "MISMATCH", published: published.toString(), reproduced: reproduced.toString(), hash, missing: [] };
}

// A "buy-comp" program's own row set, from exactly the shape lib/hub/public.js compView() (or the
// gated compStandingsView() once sealed) hands back: `results` (the winners — rank/wallet/amount,
// the SEALED claim), `review` (this wallet's rank/tokensBought/value inputs) and `payouts` (an
// actual paid transaction, when one exists). A winner is counted here whether or not it has been
// paid yet — sealing, not payment, is what turns a claim into something a reader can check — but
// an UNSEALED comp's rows (a live scanner draft, before the operator/scan finalizes it) are named
// MISSING_INPUTS ("not sealed") rather than run through the split at all: the claim could still
// change, so nothing here should look like it already reproduced. `published` is whatever a reader
// would actually see for that wallet — the paid amount if one landed, else the sealed claim itself
// (mirrors reproduceBuyCompRow's own doc comment) — so an operator hand-editing a payout without
// updating the sealed list shows up as a MISMATCH, never smoothed over.
function buyCompProgramRow(p) {
  const rows = Array.isArray(p.results) ? p.results : [];
  if (!rows.length) return null;
  const payoutByWallet = {};
  for (const pay of (Array.isArray(p.payouts) ? p.payouts : [])) if (pay && pay.wallet) payoutByWallet[pay.wallet] = pay;
  const reviewByWallet = {};
  for (const rv of (Array.isArray(p.review) ? p.review : [])) if (rv && rv.wallet) reviewByWallet[rv.wallet] = rv;
  let total = 0, reproduced = 0, mismatched = 0, missingInputs = 0;
  for (const w of rows) {
    total++;
    if (!p.sealed) { missingInputs++; continue; }
    const pay = payoutByWallet[w.wallet];
    const published = pay && pay.amountUi != null ? pay.amountUi : w.amount;
    const rv = reviewByWallet[w.wallet] || {};
    const r = reproduceBuyCompRow({ terms: p.terms, rank: w.rank, tokensBought: rv.tokensBought, valueSol: rv.value, published });
    if (r.status === "MATCH") reproduced++;
    else if (r.status === "MISMATCH") mismatched++;
    else missingInputs++;
  }
  const out = { batchId: p.id, kind: p.kind, total, reproduced, mismatched, missingInputs, period: null };
  if (!p.sealed) out.note = "not sealed";
  return out;
}

// Runs reproduce() over every settled (sent) row of every lock-to-earn batch in `batches`, plus
// reproduceBuyCompRow() over every winner of every "buy-comp" program supplied via
// `otherPrograms`, plus every payout row of any OTHER, still-not-implemented kind (giveaway,
// buy-special-draw) — those are reported as MISSING_INPUTS naming the kind, since this file does
// not reproduce them (yet), rather than silently excluding them from the denominator or, worse,
// counting them as reproduced. `otherPrograms` is the same array hubProjectView(p).programs hands
// back (server.js) — nothing here fetches over HTTP; the caller passes the comp record in.
// `journal` / `programState` (W3) let the lock-to-earn rows carry the program version in force.
function projectReproducibility({ batches, days, otherPrograms = [], journal = null, programState = null } = {}) {
  const out = [];
  let totalAll = 0, reproducedAll = 0;
  for (const [id, b] of Object.entries(batches || {})) {
    const wallets = Object.keys((b && b.sent) || {});
    if (!wallets.length) continue;
    let total = 0, reproduced = 0, mismatched = 0, missingInputs = 0;
    for (const wallet of wallets) {
      total++;
      const inputs = buildInputsForWallet({ batch: b, wallet, days, batches, journal, programState });
      const r = reproduce({ programVersion: inputs ? inputs.programVersion : null, inputs, receipt: { amountRaw: inputs ? inputs.amountRaw : (b.amounts && b.amounts[wallet]) } });
      if (r.status === "MATCH") reproduced++;
      else if (r.status === "MISMATCH") mismatched++;
      else missingInputs++;
    }
    const period = Number.isFinite(Number(b.at)) ? new Date(Number(b.at) * 1000).toISOString().slice(0, 10) : null;
    out.push({ batchId: id, kind: "lock-to-earn", total, reproduced, mismatched, missingInputs, period });
    totalAll += total; reproducedAll += reproduced;
  }
  for (const p of otherPrograms || []) {
    if (p && p.kind === "buy-comp") {
      const row = buyCompProgramRow(p);
      if (!row) continue;
      out.push(row);
      totalAll += row.total; reproducedAll += row.reproduced;
      continue;
    }
    const rows = (p && Array.isArray(p.payouts) ? p.payouts : []).filter((x) => x && x.sig);
    if (!rows.length) continue;
    out.push({ batchId: p.id, kind: p.kind, total: rows.length, reproduced: 0, mismatched: 0, missingInputs: rows.length, period: null, note: `reproduction is not implemented yet for kind "${p.kind}"` });
    totalAll += rows.length;
  }
  out.sort((a, b) => (a.period || "").localeCompare(b.period || "") || String(a.batchId).localeCompare(String(b.batchId)));
  return { batches: out, overall: { total: totalAll, reproduced: reproducedAll } };
}

// ── buy-comp (Colosseum roadmap §7 extension — the public standings page) ─────────────────────
// Unlike lock-to-earn, a buy-comp prize has no raw-base-unit ledger to replay: the published claim
// is a UI-unit amount, and the inputs the split needs — the comp's own places, this wallet's rank,
// and what the scan counted as its qualifying buy (tokensBought / valueSol) — are ALL already
// public on the standings route (GET /api/hub/:project/p/:compId/standings: terms.places,
// results[].rank, review[].tokensBought / review[].value). `published` is the receipt's own
// amountUi (what was actually paid, or the sealed result if nothing has paid yet) — a MISMATCH
// here is a real signal (e.g. the operator replaced the sealed list by hand), never smoothed over.
function reproduceBuyCompRow({ terms, rank, tokensBought, valueSol, published } = {}) {
  const missing = [];
  if (!terms || !Array.isArray(terms.places) || !terms.places.length) missing.push("terms.places (the competition's published rules)");
  if (!(Number(rank) >= 1)) missing.push("this wallet's rank");
  if (published == null || published === "") missing.push("the published amount for this wallet (a paid receipt or the sealed result)");
  if (missing.length) return { status: "MISSING_INPUTS", published: published != null && published !== "" ? String(published) : null, reproduced: null, hash: null, missing };

  const place = terms.places[Number(rank) - 1];
  if (!place) return { status: "MISSING_INPUTS", published: String(published), reproduced: null, hash: null, missing: [`terms.places has no entry for rank ${rank}`] };
  if (terms.pctPrize && !(Number(tokensBought) > 0) && (valueSol == null || valueSol === "")) {
    return { status: "MISSING_INPUTS", published: String(published), reproduced: null, hash: null, missing: ["this wallet's qualifying volume (tokensBought or valueSol) is not published for this row"] };
  }

  const split = splitAmount({ pctPrize: terms.pctPrize, placeAmount: place.amount, tokensBought, valueSol, ticker: terms.ticker || "tokens" });
  const reproduced = split.amount;
  const pub = Number(published);
  if (!Number.isFinite(pub)) return { status: "MISSING_INPUTS", published: String(published), reproduced: String(reproduced), hash: null, missing: ["the published amount is not a number"] };
  const match = Number.isFinite(Number(reproduced)) && Math.abs(Number(reproduced) - pub) < 1e-6;
  return { status: match ? "MATCH" : "MISMATCH", published: String(published), reproduced: String(reproduced), hash: null, missing: [] };
}

module.exports = { periodsCreditedTo, paidBefore, heldAt, priorState, buildInputsForWallet, buildBatchInputs, reproduce, projectReproducibility, reproduceBuyCompRow };
