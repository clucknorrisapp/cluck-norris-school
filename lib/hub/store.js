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
const JOURNAL_KEY = "hub:settle";         // { [xferKey]: SettlementEvent } — one write per transfer, ever
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

function readRegistry(kv) { return kv.get(REGISTRY_KEY, {}) || {}; }
function writeRegistry(kv, registry) { kv.set(REGISTRY_KEY, registry); }
function readJournal(kv) { return kv.get(JOURNAL_KEY, {}) || {}; }
function writeJournal(kv, journal) { kv.set(JOURNAL_KEY, journal); }

// A throwaway in-memory kv with the same two-method surface as lib/kvstore — for tests and for
// fault injection (a `failOn` predicate makes a set() throw BEFORE it lands, so a crash between
// two writes can be reproduced exactly).
function memoryKv(initial = {}, { failOn } = {}) {
  const state = { ...initial };
  return {
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
    set: (k, v) => { if (failOn && failOn(k, v)) throw new Error(`injected fault on set(${k})`); state[k] = JSON.parse(JSON.stringify(v)); },
    isPersistent: () => true,
    dump: () => JSON.parse(JSON.stringify(state)),
  };
}

module.exports = { PARTS, LEGACY_CUNA, REGISTRY_KEY, JOURNAL_KEY, assertProjectId, keyFor, read, write, writeVerified, readRegistry, writeRegistry, readJournal, writeJournal, memoryKv };
