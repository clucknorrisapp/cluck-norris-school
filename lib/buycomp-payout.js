"use strict";
// lib/buycomp-payout.js — server-signed buy-competition payouts: the PURE half.
//
// A buy comp's verified winner list (`c.verified`, sealed by buyCompVerify or set by the operator
// after a hand check) used to reach wallets one way only: pasted into /airdrop and signed in the
// owner's browser. Owner ask 2026-09-15 ("part of the buy specials in future will be automated
// options for me and projects"): the server pays it, signing with the payer project's operator key
// the way the CUNA giveaway payout already does. Same shape, same guards, same lessons:
//   - recipients come ONLY from the sealed list stored on the comp — never from the send call;
//   - each transfer is journaled on the comp the moment it is SUBMITTED, so a retry after a 524 or
//     a mid-run redeploy can never pay a wallet twice; a sent-but-unconfirmed row blocks exactly
//     like a confirmed one until a chain sweep (or the operator, with the signature) resolves it;
//   - the send caps are the sealed list's own numbers (never more than verify sealed), tightened
//     by env if set; the vault adds the mint-authority refusal and the balance check.
// Everything here is pure (comp object in, comp object + report out) so it is testable without a
// chain or a kv; server.js owns persistence and the vault call.

const { SOL_ADDR_RE } = require("./solana-addr");
const nowMs = () => Date.now();

// The sealed rows the server may pay. SOL-terms rows (a comp whose buy source carried no token
// amounts) are NOT payable here — the operator converts and pays those by hand, as the verify note
// already says — and a zero/NaN amount or a malformed address is skipped and surfaced, never sent.
function payableRows(c) {
  const rows = Array.isArray(c && c.verified) ? c.verified : [];
  const payable = [], skipped = [];
  for (const v of rows) {
    const wallet = String((v && v.wallet) || "");
    const amountUi = Number(v && v.amount);
    if (!SOL_ADDR_RE.test(wallet)) { skipped.push({ wallet, reason: "bad address" }); continue; }
    if (v.amountUnit === "sol") { skipped.push({ wallet, amount: amountUi, reason: "SOL-terms amount — convert and pay by hand" }); continue; }
    if (!Number.isFinite(amountUi) || !(amountUi > 0)) { skipped.push({ wallet, amount: v && v.amount, reason: "zero or unparsable amount" }); continue; }
    payable.push({ wallet, amountUi, rank: v.rank });
  }
  return { payable, skipped };
}

// What is still owed: the sealed list minus every wallet with a journal row. A pending row (sent,
// not confirmed) counts as paid here on purpose — it may already have landed.
function owedNow(c) {
  if (!c) return { ok: false, error: "no_comp" };
  if (!Array.isArray(c.verified) || !c.verified.length) {
    return { ok: false, error: "not_verified", detail: "nothing is sealed to pay — run /api/buycomp/verify, or POST &set= the list" };
  }
  const paid = (c.payouts && typeof c.payouts === "object") ? c.payouts : {};
  const { payable, skipped } = payableRows(c);
  // Two rows for one wallet would pay that address twice. Refuse the whole list, loudly.
  const seen = new Set();
  for (const r of payable) {
    if (seen.has(r.wallet)) return { ok: false, error: "duplicate_wallet", wallet: r.wallet };
    seen.add(r.wallet);
  }
  const owed = payable.filter((r) => !paid[r.wallet]);
  const pending = Object.entries(paid).filter(([, p]) => p && p.pending)
    .map(([wallet, p]) => ({ wallet, sig: p.sig, amountUi: p.amountUi, at: p.at }));
  return {
    ok: true, owed, skipped, pending,
    alreadyPaid: Object.entries(paid).map(([wallet, p]) => ({ wallet, ...p })),
    // UNROUNDED on purpose: this is the cap the vault compares its own raw sum against, and both
    // sides sum the same numbers in the same order. Rounding it (toFixed) refused the ROSE payout
    // by a float epsilon — 26057.280000000002 > 26057.28 — on the first production dry run.
    totalOwed: owed.reduce((t, r) => t + r.amountUi, 0),
    maxOwed: owed.reduce((m, r) => Math.max(m, r.amountUi), 0),
  };
}

// Journal a submitted transfer on the comp. A row with a SIGNATURE counts, confirmed or not.
// Mutates c; the caller MUST persist it and read it back before trusting it.
function recordPayout(c, rows) {
  c.payouts = (c.payouts && typeof c.payouts === "object") ? c.payouts : {};
  for (const r of rows || []) {
    if (!r || !r.wallet || !r.sig) continue;
    const cur = c.payouts[r.wallet];
    if (!cur) c.payouts[r.wallet] = { amountUi: r.amountUi, sig: r.sig, at: nowMs(), pending: !!r.pending };
    else if (cur.pending && !r.pending) { cur.pending = false; cur.confirmedAt = nowMs(); }
  }
  return c;
}

function pendingRows(c) {
  const paid = (c && c.payouts) || {};
  return Object.entries(paid).filter(([, p]) => p && p.pending && p.sig).map(([wallet, rec]) => ({ wallet, rec }));
}

// Resolve pending rows against chain statuses (one per row, same order — getSignatureStatuses
// with searchTransactionHistory). Landed clean → settled. Landed with an error → the chain holds
// a definitive record that no tokens moved → archived to payoutsVoid and the wallet is owed again.
// NOT FOUND → stays pending, however old (second reviewer, 2026-09-15): an RPC node with a gap in
// its history, or one that is lagging, answers null for a transaction that DID land, and the
// earlier "null and older than five minutes = never landed" rule would have paid that winner a
// second time. Absence of evidence is not evidence of absence on money. The operator clears a row
// they have checked on an explorer with &unpay=<wallet>&sig=<sig>; nothing here does it for them.
function sweepPending(c, rows, statuses, now = nowMs()) {
  const confirmed = [], cleared = [], stillPending = [];
  c.payoutsVoid = Array.isArray(c.payoutsVoid) ? c.payoutsVoid : [];
  rows.forEach(({ wallet, rec }, i) => {
    const st = statuses[i];
    const age = now - (Number(rec.at) || 0);
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      rec.pending = false; rec.confirmedAt = now; confirmed.push({ wallet, sig: rec.sig });
    } else if (st && st.err) {
      c.payoutsVoid.push({ wallet, ...rec, voidedAt: now, reason: "tx_error" });
      delete c.payouts[wallet];
      cleared.push({ wallet, sig: rec.sig, reason: "tx_error" });
    } else {
      stillPending.push({ wallet, sig: rec.sig, ageMs: age,
        note: "not found by this RPC — NOT cleared. Check the signature on an explorer; only if it truly never landed, POST &unpay=<wallet>&sig=<sig>." });
    }
  });
  return { confirmed, cleared, stillPending };
}

// The manual lever for a row the sweep cannot decide. The signature is REQUIRED and must match:
// clearing a record re-opens the door to paying that wallet again, so it must not be possible by
// wallet alone. Archived, never deleted.
function unpay(c, wallet, sig) {
  const rec = c && c.payouts && c.payouts[wallet];
  if (!rec) return { ok: false, error: "no_record" };
  if (!sig || rec.sig !== sig) return { ok: false, error: "sig_mismatch", recordedSig: rec.sig, detail: "pass the exact recorded signature — verify on-chain that it did NOT land first" };
  c.payoutsVoid = Array.isArray(c.payoutsVoid) ? c.payoutsVoid : [];
  c.payoutsVoid.push({ wallet, ...rec, voidedAt: nowMs(), reason: "operator_unpay" });
  delete c.payouts[wallet];
  return { ok: true, wallet, cleared: rec };
}

// "wallet, amount" lines — the airdropper's own paste format — to rows. Throws on anything off,
// because a half-parsed list is a wrong payout.
function parseRecipientLines(text, { max = 500 } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(address|wallet)\b/i.test(line)) continue;   // blank or header row
    const m = line.split(/[,\t]/).map((s) => s.trim());
    const wallet = m[0], amount = Number(String(m[1] || "").replace(/_/g, ""));
    if (!SOL_ADDR_RE.test(wallet)) throw new Error("bad wallet on line: " + line.slice(0, 60));
    if (!Number.isFinite(amount) || !(amount > 0)) throw new Error("bad amount on line: " + line.slice(0, 60));
    if (seen.has(wallet)) throw new Error("duplicate wallet: " + wallet);
    seen.add(wallet);
    out.push({ wallet, amount });
    if (out.length > max) throw new Error("too many recipients (max " + max + ")");
  }
  if (!out.length) throw new Error("no recipients");
  return out;
}

// Replace the sealed list by hand — the case verify cannot see: a wallet whose bag sits in a
// Jupiter lock scans as balance 0 and lands in "manual" (the ROSE horse race, 2026-09-14). Audited
// on the comp with the list it replaced. It only ever replaces the LIST; the payout journal is
// untouched, so a wallet already paid stays paid.
function setVerified(c, rows, { by = "operator", note = "" } = {}) {
  const prev = Array.isArray(c.verified) ? c.verified : [];
  c.verifiedHistory = Array.isArray(c.verifiedHistory) ? c.verifiedHistory : [];
  c.verifiedHistory.push({ at: nowMs(), by, note: String(note || "").slice(0, 200), replaced: prev });
  c.verified = rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, amount: r.amount, amountUnit: "token", status: "qualified", note: "set by " + by }));
  c.verifiedAt = nowMs();
  c.verifiedBy = by;
  c.status = "verified";
  return c;
}

// The run lock lives in the STORE with a TTL, not in a module boolean: Railway runs more than one
// process, and a 524-then-retry can land on a different instance. Not a true CAS — set, then read
// back and check the token survived — but it closes the window that matters (two operator clicks
// seconds apart), and a crash cannot wedge it shut.
const LOCK_KEY = "buyCompPayoutLock";
const LOCK_TTL_MS = 10 * 60 * 1000;
function lockAcquire(store, compId, now = nowMs()) {
  const L = store.get(LOCK_KEY, null);
  if (L && L.at && now - Number(L.at) < LOCK_TTL_MS) {
    return { ok: false, held: true, since: L.at, ageMs: now - Number(L.at), compId: L.compId };
  }
  const token = String(now) + "." + Math.random().toString(36).slice(2, 10);
  store.set(LOCK_KEY, { at: now, pid: process.pid, compId: String(compId || ""), token });
  const after = store.get(LOCK_KEY, null);
  if (!after || after.token !== token) return { ok: false, held: true, lostRace: true, since: after && after.at };
  return { ok: true, token };
}
function lockRelease(store, token) {
  const L = store.get(LOCK_KEY, null);
  if (L && (!token || L.token === token)) { store.set(LOCK_KEY, null); return true; }
  return false;
}
function lockState(store) { return store.get(LOCK_KEY, null); }

// ── the split: how much a placed wallet's prize actually is (Colosseum roadmap §7 — the public
// standings + hold-through page) ─────────────────────────────────────────────────────────────
// Extracted from buyCompVerify() in server.js, which used to compute this inline — the "how this
// number was computed" walkthrough (lib/hub/explain.js) and reproduce-a-receipt
// (lib/hub/reproduce.js) need the EXACT function that decided the money, never a re-typed copy
// that could quietly drift from it. Pure: no comp object, no wallet, no chain — just the
// published rule (pctPrize + this rank's placeAmount) and what the wallet's own buys were.
//
//   pctPrize      the comp's own flag: is `placeAmount` a PERCENT of the wallet's own buys, or a
//                 flat number?
//   placeAmount   the comp's published places[rank-1].amount — a percent (0-100) when pctPrize,
//                 else the flat prize for that rank
//   tokensBought  the wallet's own qualifying token volume from the buy scan (Helius); a
//                 GeckoTerminal/Solana Tracker fallback carries none, in which case valueSol is
//                 used instead and the prize is paid in SOL terms (the operator converts by hand)
//   valueSol      the wallet's own qualifying SOL volume, used only when tokensBought is absent
//   ticker        the comp's token symbol, for the note's wording only — never the arithmetic
//
// Returns { amount } for a flat prize (no amountUnit/amountNote — matches the shape a flat prize
// has always carried on `c.verified`), or { amount, amountUnit, amountNote } for a percentage one.
function splitAmount({ pctPrize, placeAmount, tokensBought, valueSol, ticker = "tokens" } = {}) {
  const pct = Number(placeAmount);
  const tok = Number(tokensBought) > 0;
  if (!pctPrize) return { amount: pct };
  if (tok) {
    const amount = +((Number(tokensBought) * pct) / 100).toFixed(2);
    return { amount, amountUnit: "token", amountNote: `${pct}% of ${Math.round(Number(tokensBought)).toLocaleString()} ${ticker} bought` };
  }
  const amount = +((Number(valueSol) || 0) * pct / 100).toFixed(4);
  return { amount, amountUnit: "sol", amountNote: `${pct}% of ${(Number(valueSol) || 0).toFixed(2)} SOL bought (SOL terms — the buy source had no token amounts; operator converts/pays manually)` };
}

// One sealed row exactly as buyCompVerify used to build it inline — `c` the comp, `r` one
// candidate from the hold-check review (with `.value`/`.tokensBought`/`.status`/`.note`), `i` its
// zero-based rank position among the places paid.
function verifiedRow(c, r, i) {
  const split = splitAmount({ pctPrize: c.pctPrize, placeAmount: c.places[i].amount, tokensBought: r.tokensBought, valueSol: r.value, ticker: c.ticker || "tokens" });
  return { rank: i + 1, wallet: r.wallet, ...split, status: r.status, note: r.note };
}

module.exports = {
  owedNow, payableRows, recordPayout, pendingRows, sweepPending, unpay, parseRecipientLines, setVerified,
  lockAcquire, lockRelease, lockState, LOCK_KEY, LOCK_TTL_MS, SOL_ADDR_RE,
  splitAmount, verifiedRow,
};
