"use strict";
// Project Hub storage — one kv namespace per project, every call names the project.
//
// There is NO default project in this module. The vault's "default to clkn" convention caused a
// live incident (CLAUDE.md, the paused-flag story), so a read or write without a projectId throws
// rather than picking one. The CUNA programme is migrated by ALIASING, not copying: for
// projectId "cuna" the parts map onto the seven legacy keys the live routes already read, so the
// old /api/cuna-stake/* routes and the new hub read ONE ledger and neither can reserve or accrue
// the same obligation twice (design §3, Addendum A's extension of test 10).

const PARTS = Object.freeze(["state", "ledger", "days", "paid", "batches"]);
const LEGACY_CUNA = Object.freeze({
  state: "cunaStake", ledger: "cunaStakeLedger", days: "cunaStakeDays",
  paid: "cunaStakePaid", batches: "cunaStakeBatches",
});
const REGISTRY_KEY = "hub:projects";      // { [projectId]: Project }
// JOURNAL_KEY: pre-2026-09-18 this held the WHOLE settlement journal as one blob, and every payout
// request read-modify-wrote it — a request stalled mid-flight (a slow RPC read) whose sibling
// completed and persisted first had its own journal entries silently erased when it woke up and
// wrote its stale snapshot back (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, durability lens P1-1: this
// is what let ONE transfer settle TWO projects' rows once its journal entry was clobbered away).
// It is now READ-ONLY: readJournal() still merges whatever it holds (so no entry written before
// this change is ever lost), but nothing writes it again — see JOURNAL_PREFIX below.
const JOURNAL_KEY = "hub:settle";
// crash P0-1/P1-1 fix: one kv key PER TRANSFER, `hub:settle:<sig>:<idx>[:<inner>]` (i.e. `hub:` +
// the entry's own xferKey, which already starts "settle:") — never a blob a concurrent request can
// clobber. Two requests (any two projects, or two batches of the same project) that each settle a
// DIFFERENT transfer touch strictly disjoint kv keys and cannot lose each other's write, even
// without the per-project lock below; setManyVerified only ever sets the keys it is given.
const JOURNAL_PREFIX = "hub:settle:";
function journalEntryKey(xferKey) {
  const s = String(xferKey || "");
  return JOURNAL_PREFIX + (s.startsWith("settle:") ? s.slice("settle:".length) : s);
}
function xferKeyFromEntryKey(k) { return "settle:" + String(k || "").slice(JOURNAL_PREFIX.length); }
const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

function assertProjectId(projectId) {
  if (typeof projectId !== "string" || !ID_RE.test(projectId)) {
    throw new Error(`projectId is required and must match ${ID_RE}: got ${JSON.stringify(projectId)}`);
  }
  return projectId;
}

function keyFor(projectId, part) {
  assertProjectId(projectId);
  if (!PARTS.includes(part)) throw new Error(`unknown store part: ${part}`);
  if (projectId === "cuna") return LEGACY_CUNA[part];
  return `program:${projectId}:${part}`;
}

function read(kv, projectId, part, fallback) {
  const v = kv.get(keyFor(projectId, part), undefined);
  return v === undefined || v === null ? fallback : v;
}
function write(kv, projectId, part, value) { kv.set(keyFor(projectId, part), value); }
// The write a MONEY part uses: true only when the value is on disk. Falls back to a plain set
// (and answers true) on a store without setVerified — the memory kv in tests, or the legacy one.
function writeVerified(kv, projectId, part, value) {
  const k = keyFor(projectId, part);
  if (typeof kv.setVerified === "function") return kv.setVerified(k, value) === true;
  kv.set(k, value);
  return true;
}

// The two money parts of a project (batches + paid) in ONE persist — see kvstore.setManyVerified.
function writeManyVerified(kv, projectId, parts) {
  const entries = {};
  for (const [part, value] of Object.entries(parts || {})) entries[keyFor(projectId, part)] = value;
  if (typeof kv.setManyVerified === "function") return kv.setManyVerified(entries) === true;
  return Object.entries(parts || {}).every(([part, value]) => writeVerified(kv, projectId, part, value));
}

// Same as writeManyVerified but also lands raw, project-agnostic keys in the SAME persist — the
// settlement journal (JOURNAL_KEY) is global, not per-project, and the dual-write (journal event +
// attempt transition on the batch + the legacy batches[].sent[wallet] row) must land together or
// not at all (CLAUDE.md: a money journal spanning two kv keys is one persist). `rawEntries` maps a
// literal kv key (e.g. JOURNAL_KEY) to its value; `parts` is the usual per-project {part: value}.
function writeManyVerifiedMixed(kv, projectId, parts, rawEntries = {}) {
  const entries = { ...(rawEntries || {}) };
  for (const [part, value] of Object.entries(parts || {})) entries[keyFor(projectId, part)] = value;
  if (typeof kv.setManyVerified === "function") return kv.setManyVerified(entries) === true;
  return Object.entries(entries).every(([k, v]) => (typeof kv.setVerified === "function" ? kv.setVerified(k, v) === true : (kv.set(k, v), true)));
}

// N-2 (Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): whether a project id's own store namespace
// holds ANYTHING — every PART (state/ledger/days/paid/batches) empty or absent, and no settlement
// journal entry tagged with this projectId. Consulted before an id is ever re-issued to a
// DIFFERENT mint (the owner reusing a suspended id, say), so a fresh project can never silently
// inherit a stranger's accrual, payouts or receipts under its own name. `state` counts too — a
// project that already has a programme version is not "empty" even if it never earned anything.
function storeIsEmptyFor(kv, projectId) {
  assertProjectId(projectId);
  const isEmptyValue = (v) => v === undefined || v === null
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
  for (const part of PARTS) {
    if (!isEmptyValue(read(kv, projectId, part, undefined))) return false;
  }
  for (const e of Object.values(readJournal(kv))) if (e && e.projectId === projectId) return false;
  // NEW-3 (Round 5, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): two more durable, id-tagged kv
  // namespaces outside the five PARTS and the settlement journal — both introduced after this
  // guard was written, so it never learned about them. A waiver is a paper trail for money the
  // PREVIOUS project under this id never sent; a stashed access-payment quote is still payable
  // against whatever operator wallets the id names NEXT. Neither belongs to a re-issued id.
  if (typeof kv.entriesWithPrefix === "function" && kv.entriesWithPrefix(`hub:waive:${projectId}:`).length) return false;
  if (!isEmptyValue(kv.get(`hub:quotes:${projectId}`, undefined))) return false;
  return true;
}

function readRegistry(kv) { return kv.get(REGISTRY_KEY, {}) || {}; }
function writeRegistry(kv, registry) { kv.set(REGISTRY_KEY, registry); }
// Append-only at the kv level (crash P0-1/P1-1): every entry written since 2026-09-18 lives at its
// own key (journalEntryKey) and is read back with entriesWithPrefix; the pre-2026-09-18 whole-blob
// key is merged in too, read-only, for backward compatibility with whatever a live volume already
// holds — see the JOURNAL_KEY comment above. A per-entry key always wins over the legacy blob's
// copy of the same xferKey (there should never be a live conflict; the legacy blob is never
// written again), so this is a plain merge, not a precedence dispute.
// Round 2 #6 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): a project literally named "settle" put its
// own payout lock (`hub:<project>:payout` / `hub:<project>:<batchId>`) INSIDE the journal's own
// kv-key prefix ("hub:settle:" + "payout" == "hub:settle:payout"), and `entriesWithPrefix` cannot
// tell a lock row from a journal row by key alone. That project id is now reserved (see
// approveProject below) and the lock keys moved to their own `hublock:` namespace (lib/hub/
// routes.js) so this cannot recur — this shape check is the second, independent layer: anything
// under either prefix that does not look like an actual settlement entry is silently skipped
// rather than corrupting the journal, the consumed-set guard, or the public receipts-issued count.
function looksLikeJournalEntry(v) {
  return !!(v && typeof v === "object" && !Array.isArray(v)
    && typeof v.xferKey === "string" && v.xferKey.startsWith("settle:")
    && typeof v.projectId === "string" && v.projectId
    && typeof v.batchId === "string" && v.batchId
    && typeof v.wallet === "string" && v.wallet
    && typeof v.amountRaw === "string" && typeof v.appliedRaw === "string");
}
function readJournal(kv) {
  const out = {};
  try {
    const legacy = kv.get(JOURNAL_KEY, null);
    if (legacy && typeof legacy === "object") for (const [k, v] of Object.entries(legacy)) if (looksLikeJournalEntry(v)) out[k] = v;
  } catch (_) { /* a store without get(k,d) — nothing legacy to merge */ }
  if (typeof kv.entriesWithPrefix === "function") {
    for (const [k, v] of kv.entriesWithPrefix(JOURNAL_PREFIX)) if (looksLikeJournalEntry(v)) out[xferKeyFromEntryKey(k)] = v;
  }
  return out;
}
// writeJournal: kept for the handful of pure-ledger tests that predate the per-entry keys (it
// still round-trips through readJournal, since a legacy-blob write is merged back on read) — no
// live route calls this any more; every route write goes through journalEntryKey + writeManyVerifiedMixed.
function writeJournal(kv, journal) { kv.set(JOURNAL_KEY, journal); }

// A throwaway in-memory kv with the same surface as lib/kvstore — for tests and for fault injection
// (a `failOn` predicate makes a write throw BEFORE it lands, so a crash exactly at that write can be
// reproduced). setVerified/setManyVerified mirror lib/kvstore.js's real contract for the ONE thing
// that matters to the money tests here: setManyVerified checks failOn against every key in the
// batch BEFORE writing any of them, so a fault injected on one key of a multi-key write leaves ALL
// of them untouched — the same all-or-nothing shape as kvstore's single JSON.stringify(state) file
// write, not the weaker "some keys landed" a naive per-key loop would give.
function memoryKv(initial = {}, { failOn } = {}) {
  const state = { ...initial };
  const put = (k, v) => { state[k] = JSON.parse(JSON.stringify(v)); };
  return {
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
    set: (k, v) => { if (failOn && failOn(k, v)) throw new Error(`injected fault on set(${k})`); put(k, v); },
    setVerified: (k, v) => { if (failOn && failOn(k, v)) throw new Error(`injected fault on set(${k})`); put(k, v); return true; },
    setManyVerified: (entries) => {
      const list = Object.entries(entries || {});
      const bad = failOn && list.find(([k, v]) => failOn(k, v));
      if (bad) throw new Error(`injected fault on setManyVerified(${bad[0]})`);
      for (const [k, v] of list) put(k, v);
      return true;
    },
    isPersistent: () => true,
    dump: () => JSON.parse(JSON.stringify(state)),
    // Same read-only prefix scan as lib/kvstore.js — kept in sync so a pure module (e.g.
    // lib/traction.js) works identically against the real store and this test fixture.
    entriesWithPrefix: (prefix) => {
      const p = String(prefix || "");
      if (!p) return [];
      return Object.keys(state).filter((k) => k.startsWith(p)).map((k) => [k, state[k]]);
    },
  };
}

// crash P0-1: serialise the WHOLE mutating payout handler for one project (not just the managed
// payer's own broadcast, which lib/buycomp-payout.js's lock already covered) — held across every
// persist in the request, including the journal write, so two overlapping requests for the SAME
// project can no longer read-modify-write the same batches/paid blob and erase each other's rows
// (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, durability lens P0-1). Deliberately its OWN small lock
// rather than reusing lib/buycomp-payout.js's lockAcquire: that module's lock key is a single
// GLOBAL constant regardless of the id passed in, so reusing it here would serialise every
// project's payout route against every OTHER project's, and against buy-comp payouts and hub
// access payments too — correct but needlessly coarse. This one is keyed by the literal string
// the caller passes.
const LOCK_TTL_MS = 10 * 60 * 1000;   // matches lib/buycomp-payout.js's payout lock TTL
function lockAcquire(kv, key, nowMs = Date.now()) {
  const L = kv.get(key, null);
  if (L && L.at && nowMs - Number(L.at) < LOCK_TTL_MS) return { ok: false, held: true, since: L.at, ageMs: nowMs - Number(L.at) };
  const token = String(nowMs) + "." + Math.random().toString(36).slice(2, 10);
  kv.set(key, { at: nowMs, token });
  const after = kv.get(key, null);
  if (!after || after.token !== token) return { ok: false, held: true, lostRace: true, since: after && after.at };
  return { ok: true, token };
}
function lockRelease(kv, key, token) {
  const L = kv.get(key, null);
  if (L && (!token || L.token === token)) { kv.set(key, null); return true; }
  return false;
}

module.exports = { PARTS, LEGACY_CUNA, REGISTRY_KEY, JOURNAL_KEY, JOURNAL_PREFIX, journalEntryKey, xferKeyFromEntryKey, looksLikeJournalEntry, assertProjectId, keyFor, read, write, writeVerified, writeManyVerified, writeManyVerifiedMixed, readRegistry, writeRegistry, readJournal, writeJournal, memoryKv, lockAcquire, lockRelease, LOCK_TTL_MS, storeIsEmptyFor };
