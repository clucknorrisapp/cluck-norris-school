#!/usr/bin/env node
"use strict";
// scripts/reproduce-receipt.cjs — E1 (docs/COLOSSEUM_ROADMAP.md §1 "the number"): re-derive a Hub
// receipt's amount on YOUR OWN machine from the published inputs, using the exact pure functions
// the server itself runs (lib/hub/reproduce.js). Fetches only public JSON — no wallet, no key.
//
// Usage:
//   node scripts/reproduce-receipt.cjs <receipt-url>
//   node scripts/reproduce-receipt.cjs <project> <batchId> <wallet>
//   node scripts/reproduce-receipt.cjs --offline <dir> <receipt-url>
//   node scripts/reproduce-receipt.cjs --offline <dir> <project> <batchId> <wallet>
//   node scripts/reproduce-receipt.cjs --bundle <file>
//
// <receipt-url> is the public receipt page, e.g. https://clucknorris.app/hub/cuna/r/<sig>
// (the JSON form /api/hub/cuna/r/<sig> works too — only the path is read).
//
// --offline <dir> reads previously-saved JSON instead of the network, so a reader can verify with
// no network at all. Save the files yourself first, e.g.:
//   curl -s https://clucknorris.app/api/hub/cuna/r/<sig>                                > receipt.json
//   curl -s "https://clucknorris.app/api/hub/cuna/batch/<batchId>/inputs?wallet=<addr>" > batch-inputs.json
// (with the <project> <batchId> <wallet> form, receipt.json is not needed — only batch-inputs.json.)
//
// --bundle <file> reproduces EVERY receipt in a saved evidence bundle (AA2,
// docs/COLOSSEUM_ROADMAP.md §11 — the "download the evidence bundle" link on any batch or receipt
// page, or `curl -s .../api/hub/<project>/batch/<batchId>/bundle > bundle.json`) in one run: the
// bundle's own hash is checked and printed FIRST — a mismatch means the file was altered or
// truncated after it was built, and every receipt is still reproduced and reported regardless.
// Exits 0 only if the hash matched AND every receipt reproduced to MATCH; 2 if any receipt
// MISMATCHed; 3 if the hash failed to verify or any receipt was MISSING_INPUTS (and nothing
// MISMATCHed); 1 on a missing/unreadable file.
//
// Exit codes (all other forms): 0 MATCH, 2 MISMATCH, 3 MISSING_INPUTS (the message names the
// missing input), 1 usage or a fetch that could not be completed at all.

const fs = require("fs");
const path = require("path");
const { reproduce, reproduceBuyCompRow } = require("../lib/hub/reproduce");
const { splitBundle, verifyBundleHash } = require("../lib/hub/bundle");

const DEFAULT_HOST = "https://clucknorris.app";
const RECEIPT_URL_RE = /^\/(?:api\/)?hub\/([a-z0-9-]{1,32})\/r\/([1-9A-HJ-NP-Za-km-z]{60,100})\/?$/;

function usage() {
  console.error([
    "usage: node scripts/reproduce-receipt.cjs <receipt url | project batch wallet> [--offline <dir>]",
    "       node scripts/reproduce-receipt.cjs --bundle <file>",
    "  <receipt url>          e.g. https://clucknorris.app/hub/cuna/r/<sig>",
    "  <project batch wallet> e.g. cuna hb_1a2b3c4d 4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs",
    "  --bundle <file>        reproduce every receipt in a saved evidence bundle (AA2)",
  ].join("\n"));
}

function parseArgs(argv) {
  const a = [...argv];
  let offlineDir = null;
  const i = a.indexOf("--offline");
  if (i !== -1) { offlineDir = a[i + 1]; a.splice(i, 2); }
  return { rest: a, offlineDir };
}

function parseReceiptUrl(u) {
  let url;
  try { url = new URL(u); } catch (_) { return null; }
  const m = url.pathname.match(RECEIPT_URL_RE);
  if (!m) return null;
  return { host: url.origin, project: m[1], sig: m[2] };
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return null; }
}

async function fetchJson(url) {
  const r = await fetch(url);
  let body = null;
  try { body = await r.json(); } catch (_) { /* leave null */ }
  return { ok: r.ok, status: r.status, body };
}

function report({ project, batchId, wallet, result }) {
  console.log(`project:           ${project}`);
  if (batchId) console.log(`batch:             ${batchId}`);
  if (wallet) console.log(`wallet:            ${wallet}`);
  console.log(`published amount:  ${result.published == null ? "(unknown — see missing inputs)" : result.published + " raw base units"}`);
  console.log(`reproduced amount: ${result.reproduced == null ? "(not computed)" : result.reproduced + " raw base units"}`);
  console.log(`program-version hash: ${result.hash || "(none published for this batch)"}`);
  console.log(`status:            ${result.status}`);
  if (result.missing.length) {
    console.log("missing inputs:");
    for (const m of result.missing) console.log(`  - ${m}`);
  }
}

// Colosseum roadmap §7 — a "buy-comp" receipt reproduces from the PUBLIC standings route (the
// terms it ran under, this wallet's rank, and what the scan counted as its own qualifying buy)
// rather than a batch/inputs pair — there is no raw-base-unit ledger for a buy comp the way
// lock-to-earn has. Exits the same way the lock-to-earn path does: 0 MATCH, 2 MISMATCH, 3
// MISSING_INPUTS.
async function reproduceBuyComp({ host, project, receiptBody, offlineDir }) {
  const wallet = receiptBody.receipt.wallet || null;
  const compId = receiptBody.program && receiptBody.program.id;
  const published = receiptBody.receipt.amountUi;
  const standingsBody = offlineDir
    ? readJson(path.join(offlineDir, "standings.json"))
    : await (async () => { try { const r = await fetchJson(`${host}/api/hub/${encodeURIComponent(project)}/p/${encodeURIComponent(compId)}/standings`); return r.ok ? r.body : null; } catch (_) { return null; } })();
  const comp = standingsBody && standingsBody.ok ? standingsBody.comp : null;
  if (!comp || !comp.sealed) {
    report({ project, wallet, result: { status: "MISSING_INPUTS", published: published != null ? String(published) : null, reproduced: null, hash: null, missing: [offlineDir ? `${path.join(offlineDir, "standings.json")} is missing, or the competition is not sealed` : "could not fetch the sealed standings (GET /api/hub/<project>/p/<compId>/standings), or the competition is not sealed yet"] } });
    process.exit(3);
  }
  const win = (comp.results || []).find((r) => r.wallet === wallet);
  const rev = (comp.review || []).find((r) => r.wallet === wallet);
  const result = reproduceBuyCompRow({
    terms: comp.terms, rank: win ? win.rank : null,
    tokensBought: rev ? rev.tokensBought : null, valueSol: rev ? rev.value : null,
    published,
  });
  report({ project, wallet, result });
  process.exit(result.status === "MATCH" ? 0 : result.status === "MISMATCH" ? 2 : 3);
}

// AA2: reproduce every receipt in a saved evidence bundle. Prints the bundle-hash check first
// (never blocks the rest — a mismatched file is still worth knowing what it reproduces to), then
// one report per receipt, then a batch-level summary line.
function reproduceBundleFile(file) {
  const raw = readJson(file);
  if (!raw) { console.error(`could not read or parse ${file} as JSON`); process.exit(1); }
  const hashCheck = verifyBundleHash(raw);
  console.log(`bundle hash: ${hashCheck.ok ? "MATCHES" : "DOES NOT MATCH"}${hashCheck.reason ? " — " + hashCheck.reason : ""}`);
  if (!hashCheck.ok && !hashCheck.reason) console.log(`  declared: ${hashCheck.declared}\n  computed: ${hashCheck.computed}`);
  if (raw.settled === false) console.log(`note: ${raw.note || "this batch has not been settled yet"}`);
  const { receipts, batchInputs, programVersion } = splitBundle(raw);
  let matches = 0, mismatches = 0, missing = 0;
  for (const rb of receipts) {
    const wallet = rb && rb.receipt ? rb.receipt.wallet : null;
    const entry = wallet && batchInputs.wallets ? batchInputs.wallets[wallet] : null;
    const receiptForCore = { amountRaw: entry ? entry.amountRaw : (rb && rb.receipt ? rb.receipt.amountRaw : null) };
    const inputsForCore = entry ? { periods: entry.periods, priorPaidRaw: entry.priorPaidRaw, priorReservedRaw: entry.priorReservedRaw } : null;
    const result = reproduce({ programVersion, inputs: inputsForCore, receipt: receiptForCore });
    if (!entry) result.missing.push("the bundle's batch inputs do not carry this wallet");
    if (result.status === "MATCH") matches++; else if (result.status === "MISMATCH") mismatches++; else missing++;
    console.log("");
    report({ project: raw.project && raw.project.id, batchId: raw.batch && raw.batch.id, wallet, result });
  }
  console.log(`\n${matches} of ${receipts.length} receipt${receipts.length === 1 ? "" : "s"} in this batch reproduce${receipts.length === 1 ? "s" : ""} to MATCH${mismatches ? `, ${mismatches} MISMATCH` : ""}${missing ? `, ${missing} MISSING_INPUTS` : ""}.`);
  if (mismatches > 0) process.exit(2);
  if (!hashCheck.ok || missing > 0) process.exit(3);
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  const bundleIdx = argv.indexOf("--bundle");
  if (bundleIdx !== -1) {
    const file = argv[bundleIdx + 1];
    if (!file) { usage(); process.exit(1); }
    reproduceBundleFile(file);
    return;
  }
  const { rest, offlineDir } = parseArgs(argv);
  if (rest.length !== 1 && rest.length !== 3) { usage(); process.exit(1); }

  let project, sig = null, batchId = null, wallet = null, host = DEFAULT_HOST;
  if (rest.length === 1) {
    const parsed = parseReceiptUrl(rest[0]);
    if (!parsed) { console.error(`not a receipt URL (expected .../hub/<project>/r/<sig>): ${rest[0]}`); process.exit(1); }
    ({ project, sig, host } = parsed);
  } else {
    [project, batchId, wallet] = rest;
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(project || ""))) { console.error(`not a project id: ${project}`); process.exit(1); }
  }

  // Step 1 — the receipt, when we started from a URL: it names the batch, the wallet and the
  // program kind. Only "lock-to-earn" is reproduced here today (see lib/hub/reproduce.js).
  let receiptBody = null;
  if (sig) {
    receiptBody = offlineDir
      ? readJson(path.join(offlineDir, "receipt.json"))
      : await (async () => { try { const r = await fetchJson(`${host}/api/hub/${encodeURIComponent(project)}/r/${encodeURIComponent(sig)}`); return r.ok ? r.body : null; } catch (_) { return null; } })();
    if (!receiptBody || !receiptBody.ok || !receiptBody.receipt) {
      report({ project, result: { status: "MISSING_INPUTS", published: null, reproduced: null, hash: null, missing: [offlineDir ? `${path.join(offlineDir, "receipt.json")} is missing or not a receipt response` : "could not fetch the receipt — check the URL"] } });
      process.exit(3);
    }
    batchId = receiptBody.receipt.batchId || null;
    wallet = receiptBody.receipt.wallet || null;
    const kind = receiptBody.program && receiptBody.program.kind;
    if (kind === "buy-comp") { await reproduceBuyComp({ host, project, receiptBody, offlineDir }); return; }
    if (kind && kind !== "lock-to-earn") {
      report({ project, batchId, wallet, result: { status: "MISSING_INPUTS", published: receiptBody.receipt.amountUi != null ? String(receiptBody.receipt.amountUi) + " (UI units — raw not published for this kind)" : null, reproduced: null, hash: null, missing: [`reproduction is not implemented yet for kind "${kind}" — only "lock-to-earn" and "buy-comp" today`] } });
      process.exit(3);
    }
    if (!batchId || !wallet) {
      report({ project, result: { status: "MISSING_INPUTS", published: null, reproduced: null, hash: null, missing: ["the receipt has no batchId/wallet — not a lock-to-earn payout"] } });
      process.exit(3);
    }
  }

  // Step 2 — the batch's published inputs for this wallet: the periods it drew on, and what was
  // already paid/reserved elsewhere at the moment the batch was built (lib/hub/reproduce.js).
  const inputsBody = offlineDir
    ? readJson(path.join(offlineDir, "batch-inputs.json"))
    : await (async () => { try { const r = await fetchJson(`${host}/api/hub/${encodeURIComponent(project)}/batch/${encodeURIComponent(batchId)}/inputs?wallet=${encodeURIComponent(wallet)}`); return r.ok ? r.body : null; } catch (_) { return null; } })();

  const entry = inputsBody && inputsBody.ok && inputsBody.wallets ? inputsBody.wallets[wallet] : null;
  const receiptForCore = { amountRaw: entry ? entry.amountRaw : null };
  const inputsForCore = entry ? { periods: entry.periods, priorPaidRaw: entry.priorPaidRaw, priorReservedRaw: entry.priorReservedRaw } : null;

  // No program-version hash exists yet for a live lock-to-earn batch (see the file header) — the
  // second (kind, hash) parameter is here so a future hashed batch flows through unchanged.
  const result = reproduce({ programVersion: entry && entry.programVersion ? entry.programVersion : null, inputs: inputsForCore, receipt: receiptForCore });
  if (!entry) {
    // reproduce() already names the missing pieces (receipt.amountRaw, the batch inputs); add
    // WHERE we looked, since that is what a reader needs to fix next.
    result.missing.push(offlineDir ? `(looked in ${path.join(offlineDir, "batch-inputs.json")})` : "(the fetch for the batch's inputs did not return this wallet)");
  }
  report({ project, batchId, wallet, result });
  process.exit(result.status === "MATCH" ? 0 : result.status === "MISMATCH" ? 2 : 3);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
