// ── Holder snapshot history — append-only, hashed, served read-only ────────────
//
// Colosseum roadmap §8 X7: "The owners-snapshot tool keeps a dated, hashed snapshot per run so
// a project can show holder-count history with the hash a reader can recompute from the
// published list." This module is the pure record-keeping piece: it does not crawl anything
// (lib/owners-snapshot.js does that, and calls appendSnapshot() at the point one run finishes),
// and it does not gate anything (the crawl that produces the data is already holder-gated
// server-side — this is read-only history of a public on-chain fact, so nothing here checks a
// tools pass or a wallet).
//
// STORAGE: one kv key per snapshot, `holderSnap:<mint>:<id>`, written with kv.setVerified so a
// caller can tell whether it actually landed on disk. Append-only — a snapshot is never edited
// once written; the only mutation is pruning the OLDEST rows once a mint has more than KEEP.
//
// HASH CONTRACT (what "a reader can recompute" means in practice): the hash covers a list of
// {wallet, amount} pairs, sorted by wallet ascending and de-duplicated by construction, NOT by
// whatever order the crawl happened to produce them in. That is deliberate — a reader
// reassembling the same holder list independently (their own RPC walk, a different tool) will
// not reproduce our crawl's internal ordering, but they will reproduce the same wallet→amount
// map, and canonicalJson only cares about that once the list is put in canonical order here.
"use strict";

const { canonicalJson, sha256 } = require("./hub/project");

const PREFIX = "holderSnap:";
const KEEP = 90;

function keyFor(mint, id) { return `${PREFIX}${mint}:${id}`; }
function prefixFor(mint) { return `${PREFIX}${mint}:`; }

// Every {wallet,amount}-shaped row, normalised and sorted so two independent assemblies of the
// same holder set hash identically regardless of crawl order.
function canonicalHolderList(list) {
  const seen = new Map();
  for (const h of Array.isArray(list) ? list : []) {
    if (!h || !h.wallet) continue;
    const wallet = String(h.wallet);
    const amount = Math.round(Number(h.amount != null ? h.amount : h.balance) || 0);
    if (!wallet) continue;
    seen.set(wallet, amount); // last write wins — a caller should never pass the same wallet twice
  }
  return [...seen.entries()].map(([wallet, amount]) => ({ wallet, amount })).sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
}

// The hash a reader recomputes from a full holder list — same function on both sides
// (scripts/holders-snapshot-verify.cjs calls this directly, offline, with no kv involved).
function computeListHash(fullList) {
  return sha256(canonicalJson(canonicalHolderList(fullList)));
}

// Shape-normalise a {wallet,amount|balance} list WITHOUT reordering or deduping it — unlike
// canonicalHolderList above, this is for `top`, which is a RANK (the caller already sorted it by
// balance descending); re-sorting it by wallet the way the hash does would silently scramble the
// display order into something that looks like top holders but isn't.
function normalizeOrderedList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((h) => h && h.wallet)
    .map((h) => ({ wallet: String(h.wallet), amount: Math.round(Number(h.amount != null ? h.amount : h.balance) || 0) }));
}

function makeId(at) {
  return `${at}_${Math.random().toString(36).slice(2, 8)}`;
}

// Read every snapshot record for a mint, oldest first. `kv` needs only entriesWithPrefix (and
// get/set/setVerified for the write path below) — the same small shape lib/kvstore.js exports,
// so a test can hand in a plain in-memory object with the same four methods.
function readAll(kv, mint) {
  return kv.entriesWithPrefix(prefixFor(mint))
    .map(([k, v]) => ({ key: k, ...v }))
    .filter((r) => r && r.id) // a tombstoned (null) row from pruning is dropped, never surfaced
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

// Append one snapshot for `mint`, then prune anything beyond the newest KEEP. Never edits an
// existing record — pruning only ever removes the oldest ones once the cap is exceeded.
//   mint, at (ms epoch), holderCount, top ([{wallet,amount}], already capped by the caller),
//   totalSupplyRaw (string, raw base units), fullList ([{wallet,amount}] — every holder the run
//   produced; only its hash is kept), symbol (optional).
// Returns { ok, record } — record is the record actually written (without `key`); ok is false
// when the kv write did not verify on disk (a money-path store would refuse here; this is a
// convenience history, so the caller logs and moves on rather than failing the whole run).
function appendSnapshot(kv, { mint, at, holderCount, top, totalSupplyRaw, fullList, symbol }) {
  if (!mint || typeof mint !== "string") throw new Error("mint is required");
  if (!Array.isArray(fullList)) throw new Error("fullList is required");
  const ts = Number(at) || Date.now();
  const id = makeId(ts);
  const record = {
    id, mint, at: ts,
    holderCount: Number(holderCount) || 0,
    top: normalizeOrderedList(top).slice(0, 25),
    totalSupplyRaw: totalSupplyRaw != null ? String(totalSupplyRaw) : null,
    listHash: computeListHash(fullList),
    symbol: symbol || null,
  };
  const ok = kv.setVerified(keyFor(mint, id), record);
  pruneOldest(kv, mint);
  return { ok, record };
}

// Drop the oldest rows once a mint has more than KEEP snapshots. Deletion is "write null" —
// the same append-only-table convention lib/kvstore.js documents for clearing a key.
function pruneOldest(kv, mint) {
  const rows = readAll(kv, mint);
  const excess = rows.length - KEEP;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) kv.set(rows[i].key, null);
}

// The dated series a history panel/sparkline renders — no wallets, no top list, just what
// changed over time.
function series(kv, mint) {
  return readAll(kv, mint).map((r) => ({ id: r.id, at: r.at, holderCount: r.holderCount, listHash: r.listHash }));
}

// One full snapshot by id, with its capped top list. Returns null if not found.
function getSnapshot(kv, mint, id) {
  const rows = readAll(kv, mint);
  const r = rows.find((x) => x.id === id);
  if (!r) return null;
  const { key, ...rest } = r;
  return rest;
}

// The newest snapshot for a mint (public fields only) — what a Hub project page's fact line
// reads, or null when the mint has never been crawled.
function latest(kv, mint) {
  const rows = readAll(kv, mint);
  if (!rows.length) return null;
  const r = rows[rows.length - 1];
  return { id: r.id, at: r.at, holderCount: r.holderCount, listHash: r.listHash };
}

module.exports = { PREFIX, KEEP, canonicalHolderList, computeListHash, appendSnapshot, series, getSnapshot, latest };
