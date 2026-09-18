"use strict";
// Turning the accrual ledger into a payout, exactly once.
//
// Accrual writes what each wallet is OWED. Getting tokens to them is an owner-signed airdrop, and
// the gap between those two facts is where a payout system pays somebody twice. This module is the
// bookkeeping across that gap; it signs nothing and sends nothing.
//
// The shape:
//   credits   what accrual says each wallet has earned, ever            (grows daily)
//   paid      what has actually been sent, confirmed                    (only grows on confirmation)
//   pending   a batch exported for sending but not yet confirmed        (held aside meanwhile)
//
//   owed = credits - paid - pending
//
// The `pending` third of that is the whole point. Export a batch, get distracted, export again, and
// without it the same money appears in two batches and goes out twice. A pending batch is held
// aside the moment it is created and only becomes `paid` when the owner confirms it landed — or is
// released back to owed if it never went.

// NO MINIMUM PAYOUT (owner, 2026-09-05). Every recipient already holds CUNA and has a lock, so
// their token account exists — there is no rent to create one, just a per-transfer fee that is
// fractions of a cent inside a batch. A floor would also get MORE exclusionary as the price rises,
// which is backwards: it would quietly stop paying the smallest holders exactly as their rewards
// became worth something.
//
// The knob stays, defaulted off, because the floor is the right tool if fees ever change.
const DEFAULT_MIN_PAYOUT_RAW = 0n;

const big = (v) => { try { return BigInt(v == null ? 0 : v); } catch (_) { return null; } };

// N5 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): the composite (batchId, wallet) row key
// used below is built by joining with a single space and parsed by splitting on the FIRST space —
// safe only because a batch id is always generated `hb_`/`cb_` + hex (lib/hub/routes.js, server.js,
// lib/hub/demo-fixture.js) and a wallet is a base58 key, neither of which can ever contain a space
// today. That invariant was never asserted, so a corrupt or hand-edited batch id containing a space
// would silently attribute the row to the wrong wallet (the parse finds the FIRST space, which
// would sit inside the batch id, not at the real separator) — this throws instead, the same "fail
// loud" spirit as the NUL-byte guard this file already carries. Built and parsed in exactly the
// two places below, both through these helpers, so the two can never drift apart again.
function rowKeyOf(batchId, wallet) {
  const b = String(batchId), w = String(wallet);
  if (b.includes(" ") || w.includes(" ")) throw new Error(`cuna-payout: a batch id or wallet containing a space cannot be safely combined into a composite row key (batchId=${JSON.stringify(b)}, wallet=${JSON.stringify(w)})`);
  return b + " " + w;
}
// The SAME split the builder above relies on being safe (first space = the separator, because
// neither half may itself contain one) — never re-implemented differently from rowKeyOf.
function walletFromRowKey(rowKey) {
  const s = String(rowKey || "");
  const i = s.indexOf(" ");
  return i === -1 ? "" : s.slice(i + 1);
}

// Everything each wallet has earned across every accrued day.
function totalCredits(days) {
  const out = {};
  for (const d of Object.values(days || {})) {
    if (!d || !d.credits) continue;
    for (const [w, raw] of Object.entries(d.credits)) {
      const v = big(raw);
      if (v === null || v <= 0n) continue;
      out[w] = (out[w] || 0n) + v;
    }
  }
  return out;
}

// What is owed right now, per wallet. Anything already paid or sitting in a pending batch is
// subtracted. Never negative: an over-payment (a manual send outside this system) shows as zero
// owed, not as a debt the next batch would try to claw back.
//
// `journal` + `projectId` are OPTIONAL (W3 — the settlement journal is now consulted, not just the
// legacy `paid`/`sent` rows): a wallet with a settlement-journal event for a batch of this project is
// reserved/settled for that row exactly as a legacy `sent` row would be. The legacy row stays the
// COMPATIBILITY MIRROR — still written every time, still read here — but the journal is
// authoritative when both exist.
//
// crash P1-3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): the union of the two witnesses MUST be taken
// PER (batch, wallet) ROW, never per-wallet TOTAL. A per-wallet max is only safe if one witness's
// row set is a superset of the other's — which a lost journal write (P1-1, closed by the
// append-only journal) or a void that only touches the legacy side (P1-2, closed by "&void= refuses
// a journaled row") used to be able to break: wallet accrued 200 across two batches, batch1 settled
// journal-only (its legacy row voided), batch2 settled legacy-only (its journal write lost) — 200
// genuinely left the wallet, but a per-wallet max of totals (max(legacy=100, journal=100) = 100)
// re-offers the other 100. Per row, `max(legacyRow, journalRow)` for EACH batch sums to 200 — 0 left
// to offer. A caller that has not been updated to pass `journal`/`projectId` sees exactly the
// behavior it always had (the two new params default to nothing consulted).
function owedNow({ days, paid, pending, journal = null, projectId = null }) {
  const credits = totalCredits(days);
  const out = {};
  const held = {};
  const settledByWallet = {};   // Σ over every row of max(legacyRowRaw, journalRowRaw)
  // Σ appliedRaw per (batchId, wallet) row, from the settlement journal (this project only).
  const journalRowApplied = {};
  if (journal && projectId) {
    for (const e of Object.values(journal)) {
      if (!e || e.projectId !== projectId) continue;
      const v = big(e.appliedRaw);
      if (!v || v <= 0n) continue;
      const k = rowKeyOf(e.batchId, e.wallet);
      journalRowApplied[k] = (journalRowApplied[k] || 0n) + v;
    }
  }
  const matchedRowKeys = new Set();
  for (const b of Object.values(pending || {})) {
    if (!b || !b.amounts) continue;
    for (const [w, raw] of Object.entries(b.amounts)) {
      const v = big(raw);
      if (!v || v <= 0n) continue;
      const rowKey = rowKeyOf(b.id, w);
      matchedRowKeys.add(rowKey);
      // recordSent never partially records a legacy row — a `sent[w]` flag means the FULL row
      // amount left, so that is this row's legacy witness. The journal's per-row witness is
      // `journalRowApplied` for this exact (batch, wallet). Neither is subtracted twice; the row
      // contributes only its own max, once, to the wallet's total settled amount.
      const legacyRowRaw = (b.sent && b.sent[w]) ? v : 0n;
      const journalRowRaw = journalRowApplied[rowKey] || 0n;
      const rowSettled = legacyRowRaw > journalRowRaw ? legacyRowRaw : journalRowRaw;
      settledByWallet[w] = (settledByWallet[w] || 0n) + rowSettled;
      // An unsent row of a PENDING batch is held (it is about to be paid); a sent row is in `paid`,
      // holding it too would subtract it twice.
      if (!(b.sent && b.sent[w]) && b.state === "pending") held[w] = (held[w] || 0n) + v;
    }
  }
  // A journal row whose batch is not present in `pending` (a caller that passed a partial or empty
  // batches map, or a batch purged from storage) still proves settlement on its own — there is no
  // legacy row to compare it against, so it is simply added rather than lost.
  for (const [rowKey, v] of Object.entries(journalRowApplied)) {
    if (matchedRowKeys.has(rowKey)) continue;
    const w = walletFromRowKey(rowKey);
    settledByWallet[w] = (settledByWallet[w] || 0n) + v;
  }
  for (const [w, earned] of Object.entries(credits)) {
    // `paid` is a per-wallet CUMULATIVE legacy total that can predate any batch row (a ledger
    // written by the old two-step code, or restored from a backup) — that residual can never be
    // attributed to a specific row, so it is folded in as a wallet-level FLOOR on top of the
    // per-row sum above, never double-subtracted against it (Codex 2026-09-17, finding 1).
    const paidRaw = big((paid || {})[w]) || 0n;
    const settled = paidRaw > (settledByWallet[w] || 0n) ? paidRaw : (settledByWallet[w] || 0n);
    const left = earned - settled - (held[w] || 0n);
    out[w] = left > 0n ? left : 0n;
  }
  return out;
}

// A batch to hand to the airdropper. Wallets below the dust floor are left owed, not dropped.
function buildBatch({ owed, minPayoutRaw = DEFAULT_MIN_PAYOUT_RAW, batchId, nowUnix }) {
  const floor = big(minPayoutRaw);
  if (floor === null || floor < 0n) throw new Error(`minPayoutRaw must be whole base units: got ${minPayoutRaw}`);
  if (!batchId) throw new Error("a batch needs an id");
  const amounts = {};
  const skipped = {};
  let totalRaw = 0n;
  // Sorted, so the same owed set always produces the same batch and the same file.
  for (const w of Object.keys(owed || {}).sort()) {
    const v = big(owed[w]);
    if (v === null || v <= 0n) continue;
    if (v < floor) { skipped[w] = v.toString(); continue; }
    amounts[w] = v.toString();
    totalRaw += v;
  }
  return {
    id: batchId, state: "pending", at: Number(nowUnix) || 0,
    amounts, skippedBelowFloor: skipped,
    totalRaw: totalRaw.toString(), count: Object.keys(amounts).length,
  };
}

// The airdropper's manual format: "wallet, amount" per line, in whole tokens.
//
// Whole tokens are produced by STRING surgery on the raw amount, never by dividing. A payout line
// is the last place to introduce a float: 1,276,382.123456789 CUNA does not survive a JS number,
// and the number that comes out of that division is what somebody actually receives.
function toAirdropLines(amounts, decimals = 9) {
  const lines = [];
  for (const w of Object.keys(amounts || {}).sort()) {
    let s = String(amounts[w]);
    if (s.length <= decimals) s = "0".repeat(decimals - s.length + 1) + s;
    const whole = s.slice(0, s.length - decimals);
    const frac = s.slice(s.length - decimals).replace(/0+$/, "");
    lines.push(`${w}, ${whole}${frac ? "." + frac : ""}`);
  }
  return lines.join("\n");
}

// The rows that still have to go: the batch's amounts minus anything already recorded as sent.
function remainingOf(batch) {
  const out = {};
  for (const [w, raw] of Object.entries((batch && batch.amounts) || {})) {
    if (batch.sent && batch.sent[w]) continue;
    out[w] = raw;
  }
  return out;
}

// PER-WALLET confirmation — the fix for the partial send.
//
// The airdrop engine sends a batch as several transactions and routinely comes back with "37
// landed, 15 failed". With only confirm-all and cancel-all, both moves are wrong: confirm marks the
// 15 paid (they never are), cancel returns the 37 to owed (they are paid twice next week). This
// records exactly the rows whose transaction CONFIRMED, each with its signature, the moment it
// did. What is left is exactly what still has to go, and a retry sends only that.
//
// A row is recorded once: a second report for the same wallet is ignored, not summed, so a
// duplicated callback or a replayed request cannot inflate `paid`. The batch stays pending until
// every row is sent, then flips to "sent" on its own.
function recordSent({ batch, paid, results, nowUnix }) {
  // ANY batch state. A transaction that confirmed while the batch was being closed in another tab
  // still moved money; refusing to record it returned the row to owed and paid it again next week.
  // The dedup below is what protects against double counting, not the batch state.
  if (!batch || !batch.amounts) throw new Error("no such batch");
  const nextPaid = { ...(paid || {}) };
  const sent = { ...(batch.sent || {}) };
  const recorded = [], ignored = [];
  for (const r of results || []) {
    const w = r && String(r.wallet || "");
    const sig = r && String(r.sig || "").trim();
    if (!w || !(w in (batch.amounts || {}))) { ignored.push({ wallet: w, why: "not in this batch" }); continue; }
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) { ignored.push({ wallet: w, why: "no transaction signature" }); continue; }
    if (sent[w]) {
      // The server-signed path journals a row PENDING before it broadcasts (the same signature
      // is known from the signed bytes) and reports it again once the confirm lands. That second
      // report resolves the flag; it never counts the amount twice. Any other repeat is ignored.
      if (sent[w].pending && sent[w].sig === sig && !(r && r.pending)) { sent[w] = { ...sent[w], pending: false, confirmedAt: Number(nowUnix) || 0 }; recorded.push(w); continue; }
      ignored.push({ wallet: w, why: "already recorded" }); continue;
    }
    const v = big(batch.amounts[w]);
    if (v === null || v <= 0n) { ignored.push({ wallet: w, why: "zero amount" }); continue; }
    nextPaid[w] = ((big(nextPaid[w]) || 0n) + v).toString();
    sent[w] = { sig, at: Number(nowUnix) || 0, ...(r && r.pending ? { pending: true } : {}) };
    recorded.push(w);
  }
  const allSent = Object.keys(batch.amounts || {}).every((w) => sent[w]);
  // Only a PENDING batch completes itself; a closed or cancelled one keeps its state and just
  // carries the extra recorded rows.
  const state = batch.state === "pending" && allSent ? "sent" : batch.state;
  const next = { ...batch, sent, state };
  if (state === "sent" && !next.completedAt) next.completedAt = Number(nowUnix) || 0;
  return { paid: nextPaid, batch: next, recorded, ignored, remaining: remainingOf(next) };
}

// The batch landed IN FULL, confirmed by hand. Kept for the manual flow; the page records rows
// one at a time through recordSent instead. Rows already recorded are not counted twice.
function confirmBatch({ batch, paid, nowUnix }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be confirmed");
  const next = { ...(paid || {}) };
  const sent = { ...(batch.sent || {}) };
  for (const [w, raw] of Object.entries(batch.amounts || {})) {
    if (sent[w]) continue;
    const v = big(raw);
    if (v === null || v <= 0n) continue;
    next[w] = ((big(next[w]) || 0n) + v).toString();
    sent[w] = { sig: null, at: Number(nowUnix) || 0, manual: true };
  }
  return { paid: next, batch: { ...batch, sent, state: "sent" } };
}

// Resolve PENDING rows against chain statuses ({ wallet, sig, status } per row, status as
// getSignatureStatuses returns it, or null). Landed clean → the flag clears. Landed with an error →
// the chain holds a definitive record that no tokens moved → the row is voided and its amount
// comes off `paid`, so the wallet is owed again. NOT FOUND stays pending, however old (second
// reviewer, 2026-09-15): a lagging node answers null for a transfer that did land. The operator
// clears one they checked on an explorer with voidSent + the exact signature; nothing here does.
function resolveSent({ batch, paid, rows, nowUnix }) {
  let next = { batch, paid };
  const confirmed = [], voided = [], stillPending = [];
  for (const r of rows || []) {
    const rec = next.batch && next.batch.sent && next.batch.sent[r.wallet];
    if (!rec || !rec.pending || rec.sig !== r.sig) continue;
    const st = r.status;
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      const sent = { ...next.batch.sent, [r.wallet]: { ...rec, pending: false, confirmedAt: Number(nowUnix) || 0 } };
      next = { ...next, batch: { ...next.batch, sent } };
      confirmed.push({ wallet: r.wallet, sig: r.sig });
    } else if (st && st.err) {
      const v = voidSent({ batch: next.batch, paid: next.paid, wallet: r.wallet, sig: r.sig, nowUnix, reason: "tx_error" });
      if (v.ok) { next = { batch: v.batch, paid: v.paid }; voided.push({ wallet: r.wallet, sig: r.sig, reason: "tx_error" }); }
    } else {
      stillPending.push({ wallet: r.wallet, sig: r.sig, note: "not found by this RPC — NOT cleared. Check it on an explorer; only if it truly never landed, POST &void=<wallet>&sig=<sig>." });
    }
  }
  return { ...next, confirmed, voided, stillPending };
}

// Void one recorded row. The exact signature is REQUIRED and must match: this re-opens the door to
// paying the wallet again, so it must not be possible by wallet alone. The amount comes off `paid`
// (never below zero), the row is archived on the batch, and a batch that had completed itself
// goes back to pending so the row can be sent again.
function voidSent({ batch, paid, wallet, sig, nowUnix, reason = "operator_void" }) {
  const rec = batch && batch.sent && batch.sent[wallet];
  if (!rec) return { ok: false, error: "no_record" };
  if (!sig || rec.sig !== sig) return { ok: false, error: "sig_mismatch", recordedSig: rec.sig || null };
  const v = big(batch.amounts && batch.amounts[wallet]) || 0n;
  const cur = big((paid || {})[wallet]) || 0n;
  const nextPaid = { ...(paid || {}), [wallet]: (cur - v > 0n ? cur - v : 0n).toString() };
  const sent = { ...batch.sent }; delete sent[wallet];
  const voided = [...(batch.voided || []), { wallet, ...rec, voidedAt: Number(nowUnix) || 0, reason }];
  const state = batch.state === "sent" ? "pending" : batch.state;
  const nextBatch = { ...batch, sent, voided, state };
  if (state === "pending") delete nextBatch.completedAt;
  return { ok: true, batch: nextBatch, paid: nextPaid, cleared: rec };
}

// Stop a batch. Rows already SENT stay paid (they are); rows never sent go straight back to owed —
// nothing is written to paid for them. A batch with no sent rows is "cancelled"; one that went
// partway is "closed", so the history says which.
function cancelBatch({ batch }) {
  if (!batch || batch.state !== "pending") throw new Error("only a pending batch can be cancelled");
  const anySent = Object.keys(batch.sent || {}).length > 0;
  return { ...batch, state: anySent ? "closed" : "cancelled" };
}

module.exports = {
  DEFAULT_MIN_PAYOUT_RAW, totalCredits, owedNow, buildBatch, toAirdropLines,
  remainingOf, recordSent, confirmBatch, cancelBatch,
  resolveSent, voidSent, rowKeyOf, walletFromRowKey,
};
