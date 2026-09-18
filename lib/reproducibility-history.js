// ── Reproducibility history — a daily, append-only, hashed record per project ──────────────────
//
// Colosseum roadmap §13 CC4: "A daily append-only record per project of {reproduced, total,
// missingInputs} … kept 90 days, hashed like the holder snapshots … so the badge has a trend and
// a regression is visible the day it happens." This module is the pure record-keeping piece — it
// does not compute a project's reproducibility (server.js's hubReproducibilityFor() does, the
// exact function /api/hub/:project/reproducibility and the badge already share a cache with) and
// it does not schedule anything (server.js's daily tick calls record() once per project per UTC
// day and never throws out of the interval). Same shape as lib/holders-snapshot.js on purpose —
// this is the second append-only, hashed history table in the codebase, not a new pattern.
//
// STORAGE: one kv key per (project, day), `hubReproHist:<projectId>:<YYYY-MM-DD>`, written with
// kv.setVerified so a caller can tell whether it actually landed on disk. APPEND-ONLY BY DAY: a
// second record() call for a (project, day) that already has one is refused outright
// (`{ok:false, reason:"day_exists"}`) rather than silently overwriting it — a day's number, once
// written, never moves. The only mutation after a successful write is pruning the OLDEST rows
// once a project has more than KEEP.
//
// THE CHAIN: each record carries a hash over its own canonical fields (projectId, day,
// reproduced, total, missingInputs, at, prevHash) and `prevHash` — the hash of whatever record
// was, at write time, the newest one on file for that project. Since days are always written
// forward (the tick only ever asks for "today"), write order and calendar order coincide, so
// `series()` returning days ascending is also the chain in write order. Pruning the oldest rows
// once the cap is exceeded means the new head's `prevHash` refers to a hash that is no longer
// stored — that is expected (the same tradeoff holder snapshots make keeping only 90) and
// `verifyChain()` treats the current oldest record's `prevHash` as unverifiable rather than a
// break; every OTHER link, and every record's own hash, is recomputed and must match.
//
// A GAP IS A GAP: a UTC day with no record (a boot skipped, the tick errored, the box was down)
// is simply absent from `series()` — never backfilled, interpolated, or inferred from neighbours.
"use strict";

const { canonicalJson, sha256 } = require("./hub/project");

const PREFIX = "hubReproHist:";
const KEEP = 90;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function keyFor(projectId, day) { return `${PREFIX}${projectId}:${day}`; }
function prefixFor(projectId) { return `${PREFIX}${projectId}:`; }

// The fields the hash actually covers — used both when writing a new record and when
// recomputing one to verify it. `hash` and the `key` readAll() attaches are never inputs to
// themselves.
function canonicalFields(r) {
  return {
    projectId: String(r.projectId),
    day: String(r.day),
    reproduced: Number(r.reproduced) || 0,
    total: Number(r.total) || 0,
    missingInputs: Number(r.missingInputs) || 0,
    at: Number(r.at) || 0,
    prevHash: r.prevHash || null,
  };
}
function computeHash(r) { return sha256(canonicalJson(canonicalFields(r))); }

// Every record for a project, oldest first (day order — see the header note on why this is also
// write order). `kv` needs only entriesWithPrefix/get/set/setVerified — the same small shape
// lib/kvstore.js exports, so a test can hand in a plain in-memory object with those four methods.
function readAll(kv, projectId) {
  return kv.entriesWithPrefix(prefixFor(projectId))
    .map(([k, v]) => ({ key: k, ...v }))
    .filter((r) => r && r.day) // a tombstoned (null) row from pruning is dropped, never surfaced
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// Append one record for (projectId, day). Refuses — never overwrites — if that day already has
// one. Returns { ok, record } on a fresh write, or { ok:false, reason:"day_exists" } when it
// already existed (not an error; the caller's daily tick calls this unconditionally and treats
// this reason as "nothing to do today").
function record(kv, { projectId, day, reproduced, total, missingInputs, at }) {
  if (!projectId || typeof projectId !== "string") throw new Error("projectId is required");
  if (!DAY_RE.test(String(day || ""))) throw new Error("day must be YYYY-MM-DD");
  const key = keyFor(projectId, day);
  if (kv.get(key, null) != null) return { ok: false, reason: "day_exists" };
  const rows = readAll(kv, projectId);
  const prevHash = rows.length ? rows[rows.length - 1].hash || null : null;
  const rec = canonicalFields({ projectId, day, reproduced, total, missingInputs, at: Number(at) || Date.now(), prevHash });
  rec.hash = computeHash(rec);
  const ok = kv.setVerified(key, rec);
  pruneOldest(kv, projectId);
  return { ok, record: rec };
}

// Drop the oldest rows once a project has more than KEEP records. Deletion is "write null" — the
// same append-only-table convention lib/holders-snapshot.js and lib/kvstore.js document.
function pruneOldest(kv, projectId) {
  const rows = readAll(kv, projectId);
  const excess = rows.length - KEEP;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) kv.set(rows[i].key, null);
}

// The dated series a history panel/sparkline renders — days ascending, with gaps simply absent
// (never interpolated). Public fields only.
function series(kv, projectId) {
  return readAll(kv, projectId).map((r) => ({
    day: r.day, reproduced: Number(r.reproduced) || 0, total: Number(r.total) || 0,
    missingInputs: Number(r.missingInputs) || 0, hash: r.hash, prevHash: r.prevHash || null,
  }));
}

// Recomputes every stored record's hash from its own fields and checks every prevHash link
// against its predecessor's actual hash. The oldest remaining record's prevHash is not checked
// against anything (pruning may have already dropped the record it names — see the header note);
// every other record's hash AND its link to the one before it must hold, or the chain is broken.
function verifyChain(kv, projectId) {
  const rows = readAll(kv, projectId);
  const problems = [];
  let prevHash = null;
  for (const r of rows) {
    const expected = computeHash(r);
    if (expected !== r.hash) problems.push({ day: r.day, reason: "hash_mismatch" });
    else if (prevHash !== null && r.prevHash !== prevHash) problems.push({ day: r.day, reason: "prevHash_mismatch" });
    prevHash = r.hash;
  }
  return { ok: problems.length === 0, days: rows.length, problems };
}

module.exports = { record, series, verifyChain, pruneOldest, KEEP, PREFIX };
