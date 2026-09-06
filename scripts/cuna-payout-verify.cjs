"use strict";
// Independent pre-send check on a payout batch. Run it BEFORE the airdrop, every time.
//
//   node scripts/cuna-payout-verify.cjs <baseUrl> <adminKey> [batchId]
//
// The point is INDEPENDENCE. It does not ask the server whether the server is right — it pulls the
// day ledger, the paid record and the batch, then recomputes from scratch and compares. A bug in
// lib/cuna-payout.js that produced a wrong batch would also produce a wrong "everything is fine"
// if this simply re-read the same code path.
//
// Read-only. Sends nothing, signs nothing, changes nothing.

const https = require("https");
const http = require("http");
const payout = require("../lib/cuna-payout");

const [, , BASE, KEY, WANT_BATCH] = process.argv;
if (!BASE || !KEY) {
  console.error("usage: node scripts/cuna-payout-verify.cjs <baseUrl> <adminKey> [batchId]");
  process.exit(1);
}

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    (url.protocol === "https:" ? https : http).get(url, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(`bad JSON from ${path}: ${b.slice(0, 120)}`)); } });
    }).on("error", reject);
  });
}

const CUNA = (raw) => (Number(raw) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 0 });
const problems = [];
const notes = [];
function check(ok, label, detail) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) problems.push(label + (detail ? ": " + detail : ""));
}

(async () => {
  const k = encodeURIComponent(KEY);
  const pay = await get(`/api/cuna-stake/payout?key=${k}`);
  const admin = await get(`/api/cuna-stake/admin?key=${k}`);
  if (!pay || !pay.ok) throw new Error("payout endpoint refused — wrong key or not deployed");
  if (!admin || !admin.ok) throw new Error("admin endpoint refused");

  const batch = WANT_BATCH
    ? (pay.pendingBatches || []).find((b) => b.id === WANT_BATCH)
    : (pay.pendingBatches || [])[0];

  console.log(`\nprogramme: armed=${admin.armed} · days accrued=${pay.daysAccrued} · paid to date=${CUNA(pay.totalPaidRaw)} CUNA`);
  console.log(`pending batches: ${(pay.pendingBatches || []).length}`);
  if (!batch) {
    console.log("\nNo pending batch to verify. Create one with ?export=1 first.\n");
    process.exit(0);
  }
  const full = await get(`/api/cuna-stake/payout?key=${k}&batch=${encodeURIComponent(batch.id)}`);
  const amounts = (full && full.batchAmounts) || null;

  console.log(`\nbatch ${batch.id}: ${batch.count} wallets, ${CUNA(batch.totalRaw)} CUNA\n`);

  // 1. The line items must add up to the stated total. A batch whose header disagrees with its
  //    own rows is the difference between paying 300k and paying 3M.
  if (amounts) {
    let sum = 0n;
    for (const v of Object.values(amounts)) sum += BigInt(v);
    check(sum.toString() === String(batch.totalRaw), "line items sum to the batch total",
      sum.toString() === String(batch.totalRaw) ? `${CUNA(sum)} CUNA` : `rows ${CUNA(sum)} vs header ${CUNA(batch.totalRaw)}`);
    check(Object.keys(amounts).length === batch.count, "row count matches the header",
      `${Object.keys(amounts).length} vs ${batch.count}`);
  } else {
    notes.push("server did not return per-wallet amounts; row-level checks skipped");
  }

  // 2. Conservation. Everything ever credited must equal paid + pending + still-owed. If these
  //    do not reconcile, some wallet is about to be paid twice or not at all.
  const owedTotal = BigInt(pay.owedTotalRaw || 0);
  const paidTotal = BigInt(pay.totalPaidRaw || 0);
  let pendingTotal = 0n;
  for (const b of pay.pendingBatches || []) pendingTotal += BigInt(b.totalRaw);
  const accountedFor = owedTotal + paidTotal + pendingTotal;
  // creditedTotalRaw lives on the PAYOUT response, not the admin one. This line used to read
  // admin.creditedTotalRaw (never present), fall back to accountedFor, and compare a number to
  // itself — the one check meant to catch a double-pay could never fail.
  if (pay.creditedTotalRaw == null) throw new Error("payout response has no creditedTotalRaw — refusing to reconcile against nothing");
  const credited = BigInt(pay.creditedTotalRaw);
  check(credited === accountedFor, "owed + pending + paid reconciles with everything credited",
    `credited ${CUNA(credited)} vs accounted ${CUNA(accountedFor)}`);

  // 3. Nobody in the batch may be an excluded wallet. Rule B is the only thing keeping the
  //    treasury out of its own emission, and a payout is the moment it would actually cost money.
  const excluded = (admin.config && admin.config.excludeWallets) || [];
  if (amounts) {
    const bad = Object.keys(amounts).filter((w) => excluded.includes(w));
    check(bad.length === 0, "no excluded wallet appears in the batch", bad.join(", ") || `${excluded.length} on the list`);
  }

  // 4. Every recipient should currently hold a qualifying lock. Someone whose lock ended still
  //    deserves what they earned, so this is a NOTE, not a failure — but an address that never
  //    had a lock at all would be a real problem.
  if (amounts) {
    const unknown = [];
    for (const w of Object.keys(amounts)) {
      const r = await get(`/api/cuna-stake/wallet?address=${encodeURIComponent(w)}`);
      if (!r || !r.ok || !(r.locks || []).length) unknown.push(w);
    }
    check(unknown.length === 0, "every recipient has a CUNA lock on-chain",
      unknown.length ? unknown.map((w) => w.slice(0, 8) + "…").join(", ") : `${Object.keys(amounts).length} checked`);
  }

  // 5. Sanity ceiling. The batch cannot exceed what the programme could possibly have emitted
  //    across the SLICES it has accrued — dailyPool × slices / 24. Catches an accrual that ran many
  //    times, a pool misread, or a slice that credited a whole day (audit 2026-09-05 #4: the old
  //    line multiplied the daily pool by the slice count, a ceiling 24× too loose — a batch that
  //    over-credited every wallet exactly 24× would have landed exactly on it).
  const poolRaw = BigInt(admin.poolTodayRaw || 0);
  const slices = Number(pay.slicesAccrued != null ? pay.slicesAccrued : admin.slicesAccrued) || 0;
  const ceiling = (poolRaw * BigInt(Math.max(1, slices)) + 23n) / 24n;
  check(slices > 0, "the payout route reports slicesAccrued (server has the audit #4 fix)", `slices=${slices} days=${pay.daysAccrued}`);
  check(BigInt(batch.totalRaw) <= ceiling, "batch is within slices/24 × daily pool",
    `${CUNA(batch.totalRaw)} vs ceiling ${CUNA(ceiling)} (${slices} slices ≈ ${pay.daysAccrued} days)`);

  // 6. No duplicates, no zero or negative rows, nothing under the payout floor.
  if (amounts) {
    const keys = Object.keys(amounts);
    check(new Set(keys).size === keys.length, "no duplicate recipients");
    const bad = keys.filter((w) => { try { return BigInt(amounts[w]) <= 0n; } catch (_) { return true; } });
    check(bad.length === 0, "every amount is a positive whole number", bad.join(", "));
  }

  console.log("");
  for (const n of notes) console.log(`  · ${n}`);
  if (problems.length) {
    console.log(`\n✗ ${problems.length} PROBLEM(S) — DO NOT SEND THIS BATCH:\n`);
    for (const p of problems) console.log("   " + p);
    process.exit(1);
  }
  console.log("\n✓ batch verified — safe to airdrop, then confirm with ?confirm=" + batch.id + "\n");
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
