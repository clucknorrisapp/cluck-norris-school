#!/usr/bin/env node
"use strict";
// The public Hub views (lib/hub/public.js). What must hold:
//   - NOTHING private reaches a public view: a comp's payout token, its Telegram chat id, its board
//     message id — asserted on the JSON of every view, not on a field list;
//   - the terms hash covers only what decides the outcome, so it is stable across key order and
//     unchanged by results, payouts or bookkeeping;
//   - totals are what a holder would compute by hand; raw→ui is string surgery;
//   - a wallet lookup finds every role, a receipt lookup finds a row by signature and nothing else.
const pub = require("../lib/hub/public");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const A = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", B = "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG", C = "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo", D = "A75SXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaKSp1";
const SIG = "2N7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCju";
const PRIVATE = ["payoutToken", "SECRET-TOKEN-VALUE", "chatId", "-1002625127458", "boardMsgId", "provisional", "lastUpdateTs"];

console.log("\nHub public views\n");

const comp = {
  id: "bc_ec2e5f9669", label: "ROSE horse race", mint: "RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF", ticker: "ROSE",
  chatId: "-1002625127458", boardMsgId: 12345, provisional: [{ wallet: A }], lastUpdateTs: 1, updateMins: 60, emoji: "🐎",
  payoutToken: "SECRET-TOKEN-VALUE",
  startTs: 1757800000000, endTs: 1757900000000, holdHours: 48, places: [{ rank: 1, amount: 10 }, { rank: 2, amount: 10 }], pctPrize: true,
  metric: "cumulative", prizeToken: { kind: "native", mint: null }, exclude: [B], pools: [], status: "verified", createdAt: 1757790000000, verifiedAt: 1757990000000,
  verified: [{ rank: 1, wallet: A, amount: 13722.42, amountUnit: "token", status: "qualified", note: "set by operator" }, { rank: 2, wallet: C, amount: 1651.25, amountUnit: "token", status: "qualified", note: "set by operator" }],
  verifiedBy: "operator", verifiedHistory: [{ at: 1757995000000, by: "operator", note: "option B", replaced: [{ wallet: A, amount: 13722.42 }] }],
  verifyResults: [{ wallet: A, value: 12, tokensBought: 137224.2, status: "qualified", note: "holds 209,396, no sells" }, { wallet: D, value: 30, tokensBought: 216357, status: "dq", note: "moved the bag out during the hold (3 transfers out) — not eligible" }, { wallet: C, value: 2, tokensBought: 16512.5, status: "manual", note: "holds 0 but the scan saw no sell and no transfer" }],
  payouts: { [A]: { amountUi: 13722.42, sig: SIG, at: 1758000000000, pending: false, confirmedAt: 1758000010000 }, [C]: { amountUi: 1651.25, sig: "5imKPgf7PnbJtUFJMsWTjTnBVt7Kkv8ctjbv2xmreHkoekcVoMu9XdKrBPRic7iJX2YmUFmquHVhB87wh488hy2R", at: 1758000020000, pending: true } },
};

// ── leak guard ────────────────────────────────────────────────────────────────────────────────
{
  const v = pub.compView(comp);
  const json = JSON.stringify(v);
  ok("no private field or value reaches the comp view", PRIVATE.every((s) => !json.includes(s)), PRIVATE.filter((s) => json.includes(s)).join(","));
  const pv = pub.projectView({ project: { id: "rose", label: "OnlyRose", symbol: "ROSE", mint: comp.mint, decimals: 9 }, comps: [comp] });
  const pj = JSON.stringify(pv);
  ok("…nor the project view", PRIVATE.every((s) => !pj.includes(s)));
  ok("…nor a wallet lookup or a receipt", PRIVATE.every((s) => !JSON.stringify(pub.walletLookup(pv, A)).includes(s) && !JSON.stringify(pub.findReceipt(pv, SIG)).includes(s)));
}

// ── terms hash ────────────────────────────────────────────────────────────────────────────────
{
  const h1 = pub.compView(comp).termsHash;
  const reordered = Object.fromEntries(Object.entries(comp).reverse());
  ok("the terms hash is stable across key order", pub.compView(reordered).termsHash === h1);
  const paidMore = { ...comp, payouts: {}, verified: [], verifyResults: [], status: "closed", boardMsgId: 999 };
  ok("results, payouts, status and bookkeeping do not change the terms hash", pub.compView(paidMore).termsHash === h1);
  ok("changing a prize place changes it", pub.compView({ ...comp, places: [{ rank: 1, amount: 11 }] }).termsHash !== h1);
  ok("changing the hold changes it", pub.compView({ ...comp, holdHours: 24 }).termsHash !== h1);
  ok("it is a sha256 hex", /^[0-9a-f]{64}$/.test(h1));
}

// ── totals and facts ──────────────────────────────────────────────────────────────────────────
{
  const v = pub.compView(comp);
  ok("sealed total = the sealed token-terms rows", v.totals.sealedUi === 15373.67 && v.totals.winners === 2);
  ok("paid counts only settled rows; submitted is separate", v.totals.paidUi === 13722.42 && v.totals.submittedUi === 1651.25 && v.totals.settled === 1 && v.totals.submitted === 1);
  ok("noReceipt = sealed winners with no journal row", v.totals.noReceipt === 0 && v.payoutNote === null);
  // THE OWNER'S CASE (2026-09-16): a comp settled through the airdropper before the Hub journaled
  // signatures has winners and no rows. That is "no receipt on file" — never "owed".
  const pre = pub.compView({ ...comp, payouts: {} });
  ok("a verified comp with no journal rows says 'no receipts on file' and never uses the word owed",
     pre.totals.noReceipt === 2 && /No transaction receipts are on file/.test(pre.payoutNote) && !JSON.stringify(pre.totals).includes("owed") && !("owedUi" in pre.totals) && !("unpaid" in pre.totals));
  ok("a live comp (not yet verified) carries no such note", pub.compView({ ...comp, payouts: {}, status: "live" }).payoutNote === null);
  ok("the DQ and the manual case are surfaced as observed facts", v.totals.disqualified === 1 && v.totals.manual === 1 && v.review.find((r) => r.wallet === D).fact.includes("moved the bag out"));
  ok("hold end is derived from the terms", v.timeline.holdEndsTs === comp.endTs + 48 * 3600000);
  ok("the operator's list replacement is on the record", v.verifiedBy === "operator" && v.listHistory.length === 1 && v.listHistory[0].replacedCount === 1);
  ok("payouts are sorted by amount with explicit states", v.payouts[0].wallet === A && v.payouts[0].state === "settled" && v.payouts[1].state === "submitted");
  ok("prizeMint defaults to the comp mint for native prizes", v.prizeMint === comp.mint && pub.compView({ ...comp, prizeToken: { kind: "spl", mint: A } }).prizeMint === A);
}

// ── rawToUi ───────────────────────────────────────────────────────────────────────────────────
{
  ok("rawToUi: whole tokens", pub.rawToUi("27708530000000", 9) === "27708.53");
  ok("rawToUi: sub-unit", pub.rawToUi("5", 9) === "0.000000005");
  ok("rawToUi: exact whole", pub.rawToUi("1000000000", 9) === "1");
  ok("rawToUi: zero and garbage", pub.rawToUi("0", 9) === "0" && pub.rawToUi("abc", 9) === "0");
  ok("rawToUi: 6 decimals", pub.rawToUi("1234567", 6) === "1.234567");
}

// ── lock-to-earn ──────────────────────────────────────────────────────────────────────────────
{
  const days = { "2026-09-06T20": { distributed: "3000000000", credits: { [A]: "2000000000", [B]: "1000000000" } }, "2026-09-06T21": { distributed: "0", credits: {} }, "2026-09-07T03": { distributed: "3000000000", credits: { [A]: "1500000000", [B]: "1500000000" } } };
  const paid = { [A]: "3500000000" };
  const batches = { cb_1: { id: "cb_1", state: "confirmed", at: 1757990000, count: 2, totalRaw: "6000000000", amounts: { [A]: "3500000000", [B]: "2500000000" }, sent: { [A]: { sig: SIG, at: 1757990100 } } } };
  const v = pub.stakeView({ days, paid, batches, decimals: 9 });
  ok("accrued is summed across slices by string arithmetic; slices and DAYS are counted apart", v.totals.accruedUi === "6" && v.accrual.slices === 3 && v.accrual.days === 2 && v.accrual.firstDay === "2026-09-06" && v.accrual.wallets === 2);
  ok("paid and accrued-since-payout follow", v.totals.paidUi === "3.5" && v.totals.sincePayoutUi === "2.5");
  ok("a batch row with a signature is a receipt; an unsent row is NOT public (no 'owed' next to an address)", v.payouts.length === 1 && v.payouts[0].wallet === A && !v.batches[0].rows.some((r) => r.wallet === B) && v.batches[0].count === 2);
  ok("the word 'owed' appears nowhere in the lock-to-earn view", !/owed/i.test(JSON.stringify(v)));
}

// ── giveaway and draw ─────────────────────────────────────────────────────────────────────────
{
  const g = pub.giveawayView({ draw: { at: 1757900000000, seedSlot: 1, seedHash: "abc123def456ghi", mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", winners: [{ rank: 1, wallet: A, prize: 4000000 }, { rank: 2, wallet: B, prize: 3000000 }, { rank: 5, wallet: C, prize: 0, alternate: true }] },
    payouts: { abc123def456ghi: { [A]: { amountUi: 4000000, sig: SIG, at: 1, pending: false } } }, cfg: { mint: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", symbol: "CUNA" } });
  ok("giveaway: alternates are not counted; one receipted, one without a receipt", g.totals.winners === 2 && g.totals.sealedUi === 7000000 && g.totals.paidUi === 4000000 && g.totals.noReceipt === 1 && g.reproducible === true && !("owedUi" in g.totals));
  ok("giveaway: null without a draw", pub.giveawayView({ draw: null }) === null);
  const d = pub.drawView({ id: "bsd_1", mint: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS", from: 1, to: 2, holdHours: 24, requireHold: true, winnersCount: 2, prize: 100000, seed: "s", method: "m", payoutToken: "SECRET-TOKEN-VALUE",
    eligible: [{ wallet: A, chances: 2 }], totalEntries: 2, buyersTotal: 3, reviewed: [{ wallet: B, status: "dq", note: "sold (1 sell) — did not hold", buyCount: 1 }], winners: [{ rank: 1, wallet: A, prize: 100000, chances: 2 }], drawnAt: 3 });
  ok("draw: reproducible, honest about no receipts, no token leak", d.reproducible && d.payouts.length === 0 && /airdropper/.test(d.payoutNote) && !JSON.stringify(d).includes("SECRET-TOKEN-VALUE") && d.totals.disqualified === 1);
}

// ── lookups ───────────────────────────────────────────────────────────────────────────────────
{
  const pv = pub.projectView({ project: { id: "rose", label: "OnlyRose", symbol: "ROSE", mint: comp.mint, decimals: 9 }, comps: [comp] });
  const la = pub.walletLookup(pv, A);
  ok("wallet lookup: a winner shows winner + paid", la.ok && la.entries.some((e) => e.role === "winner") && la.entries.some((e) => e.role === "paid" && e.sig === SIG));
  const ld = pub.walletLookup(pv, D);
  ok("wallet lookup: a disqualified wallet sees the observed fact", ld.entries.length === 1 && ld.entries[0].role === "dq" && /moved the bag out/.test(ld.entries[0].fact));
  ok("wallet lookup: a stranger sees nothing", pub.walletLookup(pv, "11111111111111111111111111111111").entries.length === 0);
  ok("wallet lookup: a bad address is refused", pub.walletLookup(pv, "nope").ok === false);
  const r = pub.findReceipt(pv, SIG);
  ok("receipt lookup by signature", r && r.receipt.wallet === A && r.program.id === comp.id && r.program.termsHash === pv.programs[0].termsHash);
  ok("receipt lookup: unknown or malformed signature → null", pub.findReceipt(pv, "1".repeat(64)) === null && pub.findReceipt(pv, "short") === null);
  ok("project view counts receipts (rows with a signature)", pv.totals.receipts === 2 && pv.totals.programs === 1);
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
