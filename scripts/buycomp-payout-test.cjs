#!/usr/bin/env node
"use strict";
// Buy-comp server payout — the pure half (lib/buycomp-payout.js). Every case here is a way a
// server-signed payout pays the wrong amount, the wrong wallet, or the same wallet twice:
//   - only the SEALED list is owed; SOL-terms and zero rows are skipped and surfaced, never sent;
//   - a journal row (pending OR confirmed) removes the wallet from `owed`;
//   - a duplicate wallet in the sealed list refuses the whole list;
//   - the sweep settles landed sigs, voids dropped ones only past expiry, leaves young ones alone;
//   - unpay needs the exact signature;
//   - the paste parser refuses a half-good list; the real ROSE block parses to 6 rows / 27,708.53;
//   - setVerified replaces the list, keeps the history, never touches the journal;
//   - the lock refuses a second caller until released or expired.
const bp = require("../lib/buycomp-payout");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const W = (n) => String(n).repeat(32).slice(0, 32) + "111111111111"; // 44-char base58-safe filler (digits 1-9 only — "0" is not base58)
const A = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B = "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG", C = "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ";

console.log("\nBuy-comp server payout — pure guards\n");

// ── owedNow ────────────────────────────────────────────────────────────────────────────────────
{
  ok("no comp → not ok", bp.owedNow(null).ok === false);
  ok("unverified comp → not_verified", bp.owedNow({ verified: [] }).error === "not_verified");
  const c = { verified: [
    { rank: 1, wallet: A, amount: 100, amountUnit: "token" },
    { rank: 2, wallet: B, amount: 50.5, amountUnit: "token" },
    { rank: 3, wallet: C, amount: 1.25, amountUnit: "sol", amountNote: "SOL terms" },
    { rank: 4, wallet: W(7), amount: 0 },
    { rank: 5, wallet: "not-an-address", amount: 9 },
  ] };
  const o = bp.owedNow(c);
  ok("owed = token-terms rows only", o.ok && o.owed.length === 2 && o.owed[0].wallet === A && o.owed[1].amountUi === 50.5, JSON.stringify(o));
  ok("SOL-terms, zero and bad-address rows are skipped and surfaced", o.skipped.length === 3 && o.skipped.some((s) => /SOL-terms/.test(s.reason)) && o.skipped.some((s) => s.reason === "bad address"));
  ok("totalOwed / maxOwed are the sealed numbers", o.totalOwed === 150.5 && o.maxOwed === 100);
  c.payouts = { [A]: { amountUi: 100, sig: "sigA", at: 1, pending: false } };
  const o2 = bp.owedNow(c);
  ok("a confirmed journal row removes the wallet from owed", o2.owed.length === 1 && o2.owed[0].wallet === B && o2.alreadyPaid.length === 1);
  c.payouts[B] = { amountUi: 50.5, sig: "sigB", at: 2, pending: true };
  const o3 = bp.owedNow(c);
  ok("a PENDING row blocks a retry exactly like a confirmed one", o3.owed.length === 0 && o3.pending.length === 1 && o3.pending[0].sig === "sigB");
  const dup = bp.owedNow({ verified: [{ wallet: A, amount: 1 }, { wallet: A, amount: 2 }] });
  ok("a duplicate wallet refuses the whole list", dup.ok === false && dup.error === "duplicate_wallet" && dup.wallet === A);
}

// ── the cap is the vault's own raw sum, never a rounded one ────────────────────────────────────
{
  // The real six-wallet Option B list. Both the 5-row auto-verify (26057.280000000002) and this
  // 6-row list (27708.530000000002) sum past their rounded totals in IEEE doubles — the first
  // production dry run refused itself on exactly that.
  const rows = [["4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", 13722.42], ["5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG", 5301.74],
    ["5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ", 4158.04], ["5AXZPsqsQvXaWk3Mjwn4TfisFbTyvmFaodiFLcoaHS2B", 1920.20],
    ["CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo", 1651.25], ["4tjf9BB9yEaTDcwewGf78WWz1KvvXY7wpU6AHp7SwSzS", 954.88]];
  const c = { verified: rows.map(([wallet, amount], i) => ({ rank: i + 1, wallet, amount, amountUnit: "token" })) };
  const o = bp.owedNow(c);
  // EXACTLY the sender's arithmetic: payoutSpl maps recipients to Number(amountUi) and reduces in
  // list order, then refuses `total > totalMaxUi`. Replayed here on the same list.
  const senderTotal = o.owed.map((r) => ({ amountUi: Number(r.amountUi) })).reduce((t, r) => t + r.amountUi, 0);
  ok("the real six-row ROSE list does not sum to a clean float (the trap is real)", senderTotal > +senderTotal.toFixed(2) && +senderTotal.toFixed(2) === 27708.53, String(senderTotal));
  ok("the sender's own `total > totalMax` check passes with totalOwed as the cap", !(senderTotal > o.totalOwed) && o.totalOwed === senderTotal);
  ok("…and would have REFUSED with the old rounded cap", senderTotal > +senderTotal.toFixed(9));
}

// ── recordPayout ───────────────────────────────────────────────────────────────────────────────
{
  const c = { verified: [{ wallet: A, amount: 1 }] };
  bp.recordPayout(c, [{ wallet: A, amountUi: 1, sig: "s1", pending: true }]);
  ok("submit journals pending:true", c.payouts[A] && c.payouts[A].pending === true && c.payouts[A].sig === "s1");
  bp.recordPayout(c, [{ wallet: A, amountUi: 1, sig: "s1" }]);
  ok("the confirm resolves pending → false and stamps confirmedAt", c.payouts[A].pending === false && c.payouts[A].confirmedAt > 0);
  bp.recordPayout(c, [{ wallet: B, amountUi: 1 }, null, { wallet: "", sig: "x" }]);
  ok("a row without a signature is never journaled", !c.payouts[B] && Object.keys(c.payouts).length === 1);
}

// ── sweepPending ───────────────────────────────────────────────────────────────────────────────
{
  const now = 10_000_000;
  const old = now - 3 * 3600 * 1000, young = now - 1000;   // three hours old vs one second old
  const c = { verified: [], payouts: {
    [A]: { amountUi: 1, sig: "landed", at: old, pending: true },
    [B]: { amountUi: 2, sig: "unknown-old", at: old, pending: true },
    [C]: { amountUi: 3, sig: "unknown-young", at: young, pending: true },
    [W(4)]: { amountUi: 4, sig: "errored", at: old, pending: true },
    [W(5)]: { amountUi: 5, sig: "done", at: old, pending: false },
  } };
  const rows = bp.pendingRows(c);
  ok("pendingRows lists only pending rows with a sig", rows.length === 4);
  const statuses = rows.map(({ rec }) => rec.sig === "landed" ? { confirmationStatus: "finalized", err: null }
    : rec.sig === "errored" ? { confirmationStatus: "confirmed", err: { InstructionError: [0, "x"] } } : null);
  const r = bp.sweepPending(c, rows, statuses, now);
  ok("landed → settled", r.confirmed.length === 1 && c.payouts[A].pending === false);
  ok("errored on-chain → voided (a definitive record that no tokens moved) and owed again", r.cleared.length === 1 && r.cleared[0].reason === "tx_error" && !c.payouts[W(4)]);
  // THE REVIEWER'S CASE: a null status from this RPC, however old, is not proof the transfer
  // never landed. Clearing it put a possibly-paid winner back in `owed`.
  ok("unknown and HOURS old → still pending, never cleared, never owed again", c.payouts[B] && c.payouts[B].pending === true && !r.cleared.some((x) => x.wallet === B));
  ok("unknown and young → still pending", c.payouts[C] && c.payouts[C].pending === true);
  ok("both unknowns are reported with the operator instruction", r.stillPending.length === 2 && r.stillPending.every((p) => /unpay/.test(p.note)));
  ok("only the on-chain error is archived", c.payoutsVoid.length === 1 && c.payoutsVoid[0].reason === "tx_error" && c.payoutsVoid[0].voidedAt === now);
  ok("a non-pending row is untouched", c.payouts[W(5)].pending === false);
  ok("owedNow after the sweep: the errored wallet is owed, the unknowns are not", (() => { c.verified = [A, B, C, W(4)].map((w, i) => ({ wallet: w, amount: i + 1 })); const o = bp.owedNow(c); return o.owed.length === 1 && o.owed[0].wallet === W(4) && o.pending.length === 2; })());
}

// ── unpay ──────────────────────────────────────────────────────────────────────────────────────
{
  const c = { payouts: { [A]: { amountUi: 1, sig: "real", at: 1, pending: true } } };
  ok("unpay: no record", bp.unpay(c, B, "real").error === "no_record");
  ok("unpay: wrong sig refused", bp.unpay(c, A, "wrong").error === "sig_mismatch" && !!c.payouts[A]);
  ok("unpay: empty sig refused", bp.unpay(c, A, "").error === "sig_mismatch");
  const r = bp.unpay(c, A, "real");
  ok("unpay: exact sig clears and archives", r.ok && !c.payouts[A] && c.payoutsVoid.length === 1 && c.payoutsVoid[0].reason === "operator_unpay");
}

// ── parseRecipientLines ────────────────────────────────────────────────────────────────────────
{
  const rose = [
    "wallet, amount",
    "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs, 13722.42",
    "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG, 5301.74",
    "5EjuMxEyxbmja7Nn664CqF5CD47udkqR4dppqNTtDprQ, 4158.04",
    "5AXZPsqsQvXaWk3Mjwn4TfisFbTyvmFaodiFLcoaHS2B, 1920.20",
    "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo, 1651.25",
    "4tjf9BB9yEaTDcwewGf78WWz1KvvXY7wpU6AHp7SwSzS, 954.88",
    "",
  ].join("\n");
  const rows = bp.parseRecipientLines(rose);
  const total = +rows.reduce((t, r) => t + r.amount, 0).toFixed(2);
  ok("the ROSE block parses to 6 rows totalling 27,708.53 (header + blank skipped)", rows.length === 6 && total === 27708.53, `rows=${rows.length} total=${total}`);
  ok("tab-separated works", bp.parseRecipientLines(A + "\t12").length === 1);
  const throws = (t) => { try { bp.parseRecipientLines(t); return false; } catch (_) { return true; } };
  ok("bad wallet throws", throws("abc, 5"));
  ok("bad amount throws", throws(A + ", zero"));
  ok("zero amount throws", throws(A + ", 0"));
  ok("negative amount throws", throws(A + ", -1"));
  ok("duplicate wallet throws", throws(A + ", 1\n" + A + ", 2"));
  ok("empty list throws", throws("wallet, amount\n\n"));
  ok("one bad line fails the whole list", throws(A + ", 1\nbad, 2"));
}

// ── setVerified ────────────────────────────────────────────────────────────────────────────────
{
  const c = { verified: [{ rank: 1, wallet: A, amount: 1 }], payouts: { [A]: { amountUi: 1, sig: "paid", at: 1, pending: false } }, status: "verified" };
  bp.setVerified(c, [{ wallet: A, amount: 10 }, { wallet: B, amount: 20 }], { by: "operator", note: "option B" });
  ok("setVerified replaces the sealed list with ranks", c.verified.length === 2 && c.verified[1].rank === 2 && c.verified[1].amount === 20 && c.verified[0].amountUnit === "token");
  ok("the replaced list is kept in history with the note", c.verifiedHistory.length === 1 && c.verifiedHistory[0].replaced[0].amount === 1 && c.verifiedHistory[0].note === "option B");
  ok("the payout journal is untouched — an already-paid wallet stays paid", c.payouts[A].sig === "paid" && bp.owedNow(c).owed.length === 1 && bp.owedNow(c).owed[0].wallet === B);
}

// ── lock ───────────────────────────────────────────────────────────────────────────────────────
{
  const mem = {}; const store = { get: (k, d) => (k in mem && mem[k] != null ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
  const l1 = bp.lockAcquire(store, "bc_1", 1000);
  ok("first caller takes the lock", l1.ok && !!l1.token);
  const l2 = bp.lockAcquire(store, "bc_1", 2000);
  ok("second caller is refused while held", !l2.ok && l2.held);
  ok("a wrong token cannot release it", bp.lockRelease(store, "nope") === false && !!bp.lockState(store));
  ok("the holder releases it", bp.lockRelease(store, l1.token) === true && bp.lockState(store) == null);
  const l3 = bp.lockAcquire(store, "bc_1", 3000);
  ok("free again after release", l3.ok);
  const l4 = bp.lockAcquire(store, "bc_2", 3000 + bp.LOCK_TTL_MS + 1);
  ok("a stale lock self-clears after the TTL", l4.ok);
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
