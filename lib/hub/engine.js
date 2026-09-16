"use strict";
// lib/hub/engine.js — Lock to Earn for ANY project: the generic lift of the CUNA machinery that
// lives in server.js (cunaProgramme / cunaLocks / cunaAccrualTick), keyed by project id and read
// through lib/hub/store so every project has its own state, ledger, days, paid and batches.
//
// Phase 1a of docs/LOCK_TO_EARN_PLATFORM_2026-09-16.md. It runs for projects in the Hub registry;
// CUNA stays on its own code until Phase 1b switches it over (a scheduler must SKIP "cuna" while
// the legacy loop runs, or the same hour is credited twice through the aliased keys).
//
// Everything that decides money is pure and takes its inputs as arguments — configFor, gate,
// accrueSlice, missedSlices, walletView — so the tests run without a chain. scanLocks and
// accrualTick do the I/O through injected deps and a kv.
//
// Faithful to the CUNA rules, with two additions the platform terms carry: cancelableAllowed
// and the vesting shape (lib/cuna-staking.js disqualify reads both).

const hubStore = require("./store");
const proj = require("./project");
const prog = require("../cuna-programme");
const s = require("../cuna-staking");
const pay = require("../cuna-payout");

const HOUR = 3600;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ── programme state ───────────────────────────────────────────────────────────────────────────
// The `state` part of a project's store: { versions: [...], armed, startedAt }. Arming is one-way
// for the START DATE (the same rule as cuna-programme.arm): everyone's term is measured forward
// from firstSeenAt, and a start that could slide would re-cut every lock's horizon.
function readState(raw) {
  const st = raw && typeof raw === "object" ? raw : {};
  return { versions: Array.isArray(st.versions) ? st.versions : [], armed: st.armed === true, startedAt: Number(st.startedAt) > 0 ? Number(st.startedAt) : null };
}
function arm(raw, nowUnix) {
  const st = readState(raw);
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) throw new Error(`arm needs a real nowUnix: ${nowUnix}`);
  if (!st.versions.length) throw new Error("cannot arm a project with no program version — create the terms first");
  return { ...raw, versions: st.versions, armed: true, startedAt: st.startedAt || now };
}
function disarm(raw) { const st = readState(raw); return { ...raw, versions: st.versions, armed: false, startedAt: st.startedAt }; }

// The rules-engine config for a project at a moment: the project record plus the program version
// in force for that hour. Null when no version is effective yet (nothing may accrue).
function configFor({ project, state, nowUnix }) {
  const st = readState(state);
  const v = proj.versionFor(st, prog.sliceKey(nowUnix));
  if (!v || !v.terms) return null;
  const t = v.terms;
  return {
    mint: project.mint,
    startAfterUnix: st.startedAt || null,
    minDurationDays: t.minDurationDays, maxTermDays: t.maxTermDays, minLockRaw: t.minLockRaw,
    excludeWallets: [...(t.excludeWallets || [])], fundedBy: [...(t.fundedBy || [])],
    sharePct: t.sharePct, maxSharePct: t.maxSharePct, poolDailyRaw: t.poolDailyRaw, maxWalletSharePct: t.maxWalletSharePct,
    backdateCapDays: t.backdateCapDays, backdateNotBefore: t.backdateNotBefore,
    cancelableAllowed: t.cancelableAllowed === true, vesting: t.vesting || "any",
    payoutSchedule: t.payoutSchedule || "weekly",
    programVersion: v.version, programHash: v.hash,
  };
}

// Whether this hour may be accrued, and why not. Mirrors cuna-programme.accrualGate without its
// CUNA-only config validation.
function gate({ state, days, nowUnix }) {
  const st = readState(state);
  if (!st.armed) return { ok: false, reason: "programme is not armed — nobody earns until it is" };
  if (!st.startedAt) return { ok: false, reason: "armed with no start date" };
  const now = Number(nowUnix);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, reason: `bad clock: ${nowUnix}` };
  if (now < st.startedAt) return { ok: false, reason: "clock is before the programme start" };
  const key = prog.sliceKey(now);
  if (days && Object.prototype.hasOwnProperty.call(days, key)) return { ok: false, reason: `${key} is already accrued`, key };
  return { ok: true, key, sliceIndex: prog.sliceIndexOf(now), startedAt: st.startedAt };
}

// UTC hours between the arm hour and the previous full hour that never ran. Not reconstructible
// (weight depends on what was locked at that hour) — reported, never replayed.
function missedSlices({ state, days, nowUnix }) {
  const st = readState(state);
  const now = Number(nowUnix);
  if (!st.startedAt || !Number.isFinite(now) || now <= 0) return [];
  const paid = days || {};
  const firstKey = prog.sliceKey(st.startedAt);
  const out = [];
  for (let i = 1; i <= 400 * prog.SLICES_PER_DAY; i++) {
    const k = prog.sliceKey(now - i * HOUR);
    if (k < firstKey) break;
    if (!Object.prototype.hasOwnProperty.call(paid, k)) out.push(k);
  }
  return out.reverse();
}

// ── one hour of accrual, pure ─────────────────────────────────────────────────────────────────
// Inputs are the scan result and the ledger's recent row count; the output is the row to write
// under the slice key, or a reason not to. The plausibility guards are the CUNA ones: a scan that
// returns nothing while the ledger knows rows is index lag, not "nobody qualified".
function accrueSlice({ project, state, days, locks, ledgerKnown = 0, nowUnix }) {
  const g = gate({ state, days, nowUnix });
  if (!g.ok) return { ok: false, reason: g.reason };
  const cfg = configFor({ project, state, nowUnix });
  if (!cfg) return { ok: false, reason: "no program version is in force for this hour" };
  const list = Array.isArray(locks) ? locks : null;
  if (!list) return { ok: false, reason: "no scan" };
  if (list.length === 0 && ledgerKnown > 0) return { ok: false, reason: `the scan returned zero escrows but the ledger knows ${ledgerKnown} — index lag or a layout change` };
  if (ledgerKnown >= 10 && list.length * 2 < ledgerKnown) return { ok: false, reason: `the scan returned ${list.length} escrows but the ledger knows ${ledgerKnown} — index lag or a layout change` };
  const now = Number(nowUnix);
  const unlock = list.length ? s.dailyUnlockRaw(list, now, cfg.fundedBy) : 0n;
  // CUNA's pool is capped at a share of what the funding wallet's OWN vesting schedule unlocks
  // that day — the "never unfundable" guarantee. A project that funds rewards from a plain liquid
  // wallet has no stream at all, and that cap would zero its pool. So: with a stream, the CUNA
  // rule; with a fixed pool and no stream, the fixed pool as-is — and the funding status (owed vs
  // observed balance) is the guard that says whether it can actually be paid.
  const fixed = cfg.poolDailyRaw && cfg.poolDailyRaw !== "0" ? BigInt(cfg.poolDailyRaw) : 0n;
  const dailyPool = unlock === 0n && fixed > 0n
    ? fixed
    : s.poolForDay({ dailyUnlockRaw: unlock.toString(), sharePct: cfg.sharePct, fixedRaw: cfg.poolDailyRaw, maxSharePct: cfg.maxSharePct });
  const pool = prog.slicePoolRaw(dailyPool.toString(), g.sliceIndex);
  const day = s.accrueDay({ locks: list, poolRaw: pool.toString(), nowUnix: now, cfg });
  const row = {
    at: now, sliceIndex: g.sliceIndex,
    dailyPoolRaw: dailyPool.toString(), poolRaw: pool.toString(), dailyUnlockRaw: unlock.toString(), sharePct: cfg.sharePct,
    distributedRaw: day.distributed.toString(), undistributedRaw: day.undistributed.toString(),
    eligible: day.eligible, scanned: list.length,
    credits: Object.fromEntries(Object.entries(day.credits).map(([k, v]) => [k, v.toString()])),
    programVersion: cfg.programVersion, programHash: cfg.programHash,
  };
  return { ok: true, key: g.key, row, cfg };
}

// ── the scan, with the firstSeenAt ledger ─────────────────────────────────────────────────────
// deps: { scan(mint) -> [{escrow, account}], creationTimes(escrows) -> {escrow: unix}, scanLib }
// The ledger is written ONLY while armed (the same rule as CUNA); a disarmed programme reads the
// chain and discards the creation lookups. Creation lookups that fail are retried three times
// before the row is stamped `now` and flagged — see the CUNA comment on griefable lookups.
const caches = new Map();      // projectId -> { at, locks, err, ledger, lastAttemptAt, inflight }
const retries = new Map();     // projectId -> Map(escrow -> failed lookups)
const SCAN_TTL_MS = 5 * 60 * 1000;
function cacheFor(projectId) { if (!caches.has(projectId)) caches.set(projectId, { at: 0, locks: null, err: null, ledger: null }); return caches.get(projectId); }
function resetCaches() { caches.clear(); retries.clear(); }
function resetCache(projectId) { caches.delete(projectId); }   // terms changed or armed: re-judge on the next read

async function scanLocks({ kv, projectId, project, state, nowUnix, force = false, deps, onAlert = null }) {
  hubStore.assertProjectId(projectId);
  const c = cacheFor(projectId);
  const nowMs = Number(nowUnix) * 1000;
  if (!force && c.locks && nowMs - c.at < SCAN_TTL_MS) return c;
  if (!force && c.err && nowMs - (c.lastAttemptAt || 0) < 60 * 1000) return c;
  if (c.inflight) return c.inflight;
  c.inflight = (async () => {
    try {
      const st = readState(state);
      const cfg = configFor({ project, state, nowUnix });
      const scanLib = deps.scanLib || require("../cuna-lock-scan");
      const scanned = await deps.scan(project.mint);
      const stored = st.armed ? (hubStore.read(kv, projectId, "ledger", {}) || {}) : {};
      const unknown = scanned.map((x) => String(x.escrow && x.escrow.toBase58 ? x.escrow.toBase58() : x.escrow)).filter((k) => !stored[k]);
      let createdAt = {};
      if (unknown.length && st.armed && typeof deps.creationTimes === "function") {
        try { createdAt = await deps.creationTimes(unknown); } catch (e) { if (onAlert) onAlert(`creation-time lookup failed, using now: ${e.message}`); }
      }
      const merged = scanLib.mergeLedger({ scanned, ledger: stored, nowUnix, createdAt,
        backdateCapDays: cfg ? cfg.backdateCapDays : 30, notBefore: cfg ? cfg.backdateNotBefore : 0 });
      if (st.armed) {
        const ledger = { ...merged.ledger };
        const r = retries.get(projectId) || new Map();
        for (const k of merged.added.filter((k) => createdAt[k] == null)) {
          const n = (r.get(k) || 0) + 1; r.set(k, n);
          if (n < 3) delete ledger[k];
          else { ledger[k] = { ...ledger[k], creationPending: true }; if (onAlert) onAlert(`lock ${k} recorded at today's date after 3 failed creation lookups — restamp it by hand if it was made earlier`); }
        }
        retries.set(projectId, r);
        hubStore.write(kv, projectId, "ledger", ledger);
        Object.assign(c, { at: nowMs, locks: merged.locks, err: null, ledger });
      } else {
        Object.assign(c, { at: nowMs, locks: merged.locks, err: null, ledger: merged.ledger });
      }
    } catch (e) {
      Object.assign(c, { err: String((e && e.message) || e).slice(0, 200), lastAttemptAt: nowMs });
    } finally { c.inflight = null; }
    return c;
  })();
  return c.inflight;
}

// ── the tick ──────────────────────────────────────────────────────────────────────────────────
// Credits one hour from a FRESH, successful scan or not at all — a day written from a stale
// snapshot is permanent and wrong. The days ledger is money (credits become payouts), so it is
// written through kv.setVerified when the store offers it and the write is refused otherwise.
async function accrualTick({ kv, projectId, project, nowUnix, deps, onAlert = null, reason = "tick" }) {
  hubStore.assertProjectId(projectId);
  const state = hubStore.read(kv, projectId, "state", {});
  const days = hubStore.read(kv, projectId, "days", {}) || {};
  const g = gate({ state, days, nowUnix });
  if (!g.ok) return { ok: false, reason: g.reason };
  const snap = await scanLocks({ kv, projectId, project, state, nowUnix, force: true, deps, onAlert });
  if (snap.err) return { ok: false, reason: `the chain read failed: ${snap.err}` };
  if (!snap.locks) return { ok: false, reason: "no fresh scan this tick" };
  const ledger = hubStore.read(kv, projectId, "ledger", {}) || {};
  const ledgerKnown = Object.values(ledger).filter((r) => r && Number(r.lastSeenAt || 0) >= Number(nowUnix) - 7 * 86400).length;
  const res = accrueSlice({ project, state, days, locks: snap.locks, ledgerKnown, nowUnix });
  if (!res.ok) { if (onAlert) onAlert(`accrual skipped ${g.key}: ${res.reason}`); return { ok: false, reason: res.reason, key: g.key }; }
  const next = { ...days, [res.key]: res.row };
  const landed = hubStore.writeVerified(kv, projectId, "days", next);
  if (!landed) { if (onAlert) onAlert(`accrual for ${res.key} did NOT reach the volume — refusing to count it`); return { ok: false, reason: "days ledger write did not persist", key: res.key }; }
  return { ok: true, key: res.key, reason, eligible: res.row.eligible, distributedRaw: res.row.distributedRaw, undistributedRaw: res.row.undistributedRaw,
    missed: missedSlices({ state, days: next, nowUnix }) };
}

// Every approved, armed project in the registry, except the ones a legacy loop still owns.
async function runAll({ kv, nowUnix, deps, skip = ["cuna"], onAlert = null, reason = "tick" }) {
  const registry = hubStore.readRegistry(kv) || {};
  const out = {};
  for (const [projectId, project] of Object.entries(registry)) {
    if (skip.includes(projectId) || !project || project.approved === false) continue;
    try { out[projectId] = await accrualTick({ kv, projectId, project, nowUnix, deps, onAlert, reason }); }
    catch (e) { out[projectId] = { ok: false, reason: String((e && e.message) || e).slice(0, 200) }; }
  }
  return out;
}

// ── what one holder sees ──────────────────────────────────────────────────────────────────────
// The lock site's wallet view for any project: am I locked, how much, until when, how much longer;
// earned; paid, each with its transaction; owed now. Pure.
function walletView({ project, state, addr, locks, days, paid, batches, nowUnix }) {
  const w = String(addr || "");
  if (!B58.test(w)) return { ok: false, error: "not a Solana address" };
  const st = readState(state);
  const cfg = configFor({ project, state, nowUnix }) || {};
  const now = Number(nowUnix);
  const mine = (locks || []).filter((l) => l && l.recipient === w);
  let accrued = 0n;
  for (const d of Object.values(days || {})) { const c = d && d.credits && d.credits[w]; if (c) { try { accrued += BigInt(c); } catch (_) {} } }
  let paidRaw = 0n; try { paidRaw = BigInt((paid || {})[w] || 0); } catch (_) {}
  const owedRaw = pay.owedNow({ days: days || {}, paid: paid || {}, pending: batches || {} })[w] || 0n;
  let earningRaw = 0n, totalRaw = 0n;
  const lockRows = mine.map((l) => {
    const sp = s.splitOf(l, now);
    totalRaw += BigInt(sp.totalRaw);
    const q = cfg.mint ? s.qualifies(l, cfg) : false;
    if (q) earningRaw += s.earningRawOf(l, now, cfg);
    const end = Number(l.fullyVestedAt || 0), cliff = Number(l.cliffTime || 0);
    return { escrow: l.escrow, amountRaw: l.atRiskRaw, split: sp, cliffTime: l.cliffTime, fullyVestedAt: l.fullyVestedAt, firstSeenAt: l.firstSeenAt,
      qualifies: q, earning: st.armed && q, reasons: cfg.mint ? s.disqualify(l, cfg) : ["no program version in force"],
      weight: cfg.mint ? s.weightOf(l, now, cfg).toString() : "0",
      daysLeft: end ? Math.max(0, Math.ceil((end - now) / 86400)) : null, daysToCliff: cliff && now < cliff ? Math.ceil((cliff - now) / 86400) : 0 };
  });
  const payouts = Object.values(batches || {})
    .filter((b) => b && b.amounts && b.amounts[w] && b.sent && b.sent[w])
    .map((b) => ({ batch: b.id, at: Number(b.sent[w].at) || Number(b.at) || 0, amountRaw: String(b.amounts[w]), sig: b.sent[w].sig || null, confirmed: !b.sent[w].pending, manual: !!b.sent[w].manual }))
    .sort((x, y) => y.at - x.at);
  return { ok: true, armed: st.armed, programVersion: cfg.programVersion || null, programHash: cfg.programHash || null, payoutSchedule: cfg.payoutSchedule || null,
    locks: lockRows, accruedRaw: accrued.toString(), paidRaw: paidRaw.toString(), owedRaw: owedRaw.toString(),
    earningOnRaw: earningRaw.toString(), totalLockedRaw: totalRaw.toString(), payouts };
}

module.exports = { readState, arm, disarm, configFor, gate, missedSlices, accrueSlice, scanLocks, accrualTick, runAll, walletView, resetCaches, resetCache, SCAN_TTL_MS };
