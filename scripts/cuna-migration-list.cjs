#!/usr/bin/env node
"use strict";
// Convert the owner's migration ledger into the body for POST /api/cuna-migration/admin?list=1.
//
//   node scripts/cuna-migration-list.cjs ledger.json > upload.json
//
// Input: a JSON array of rows {wallet, sendCuna, locks, rew} — CUNA (sendCuna) and CLKN (locks,
// rew) as DECIMAL amounts, the owner's ledger format. Output: {"rows":[{wallet, sendInMaxCunaRaw,
// day0LocksClknRaw, day0RewardsClknRaw}]} with exact raw-integer strings (both mints have 9
// decimals). Numbers are converted from their SOURCE TEXT, never through a float: 1234567.123456789
// as a JS double is not that number. More than 9 decimals is refused rather than rounded, and so is
// anything negative or written with an exponent. The summary (row count, totals, sha256 — the same
// hash the admin status prints after the upload) goes to stderr so stdout stays the upload body.
//
// The ledger and the upload hold real wallets: keep them out of the repo (it is public).

const fs = require("fs");
const DECIMALS = 9;

function toRaw(v) {
  if (typeof v === "bigint") { if (v < 0n) throw new Error("negative amount"); return (v * 10n ** BigInt(DECIMALS)).toString(); }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) throw new Error(`bad amount ${v}`);
    const s = String(v);
    if (/e/i.test(s)) throw new Error(`amount ${s} is in exponent form — write it out in full (it is not safe to convert)`);
    v = s;
  }
  const s = String(v == null ? "" : v).trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`amount ${JSON.stringify(v)} is not a plain non-negative decimal`);
  const frac = (m[2] || "").replace(/0+$/, "");
  if (frac.length > DECIMALS) throw new Error(`amount ${s} has more than ${DECIMALS} decimals — refusing to round`);
  return (BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt((frac || "0").padEnd(DECIMALS, "0"))).toString();
}

function convertRows(rows) {
  if (!Array.isArray(rows)) throw new Error("the ledger must be a JSON array of rows");
  const out = rows.map((r, i) => {
    if (!r || typeof r.wallet !== "string") throw new Error(`row ${i + 1}: no wallet`);
    try {
      return { wallet: r.wallet.trim(), sendInMaxCunaRaw: toRaw(r.sendCuna == null ? 0 : r.sendCuna),
        day0LocksClknRaw: toRaw(r.locks == null ? 0 : r.locks), day0RewardsClknRaw: toRaw(r.rew == null ? 0 : r.rew) };
    } catch (e) { throw new Error(`row ${i + 1} (${r.wallet}): ${e.message}`); }
  });
  return { rows: out };
}

// JSON.parse with each number kept as its exact source text (Node 22+ passes it to the reviver).
function parseExact(text) {
  let sourceSeen = false;
  const parsed = JSON.parse(text, function (k, v, ctx) {
    if (typeof v === "number") {
      if (ctx && typeof ctx.source === "string") { sourceSeen = true; return ctx.source; }
      return v;
    }
    return v;
  });
  return { parsed, exact: sourceSeen || !/\d\.\d/.test(text) };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node scripts/cuna-migration-list.cjs <ledger.json> > upload.json"); process.exit(2); }
  try {
    const { parsed, exact } = parseExact(fs.readFileSync(file, "utf8"));
    if (!exact) throw new Error("this Node cannot read JSON numbers exactly — quote the amounts as strings, or use Node 22+");
    const body = convertRows(parsed);
    const M = require("../lib/cuna-migration");
    const v = M.validateList(body.rows);
    if (!v.ok) { console.error("the converted list would be refused:\n  " + v.errors.join("\n  ")); process.exit(1); }
    process.stdout.write(JSON.stringify(body, null, 1) + "\n");
    console.error(`rows ${v.totals.rowCount} (holders ${v.totals.holders}, lockers ${v.totals.lockers})`);
    console.error(`send-in max   ${v.totals.sendInMaxCunaRaw} raw CUNA -> ${v.totals.sendInClknRaw} raw CLKN`);
    console.error(`day0 locks    ${v.totals.day0LocksClknRaw} raw CLKN`);
    console.error(`day0 rewards  ${v.totals.day0RewardsClknRaw} raw CLKN`);
    console.error(`TOTAL CLKN    ${v.totals.totalClknNeededRaw} raw`);
    console.error(`sha256        ${v.sha256}`);
  } catch (e) { console.error("refused: " + e.message); process.exit(1); }
}

module.exports = { toRaw, convertRows, parseExact };
