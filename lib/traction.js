"use strict";
// lib/traction.js — Colosseum W9 part 1: product OUTCOME counters, each derived from a store that
// already exists (or a minimal new event this same change adds at an existing choke point), so a
// figure in a future docs/TRACTION_*.md is reproducible from stored events by
// scripts/traction-report.cjs, never trusted. Pure: `compute()` only reads; it never writes and
// never touches the chain. `kv` is whatever implements lib/kvstore.js's surface (get/set/
// entriesWithPrefix) — the real store, or lib/hub/store.js `memoryKv` in tests.
//
// Two gaps are reported here, not hidden, because an honest zero is worth more than a flattering
// guess (CLAUDE.md, "Verification: check every form, not one form"):
//
//   1. W3 (docs/COLOSSEUM_ROADMAP.md §W3) wired lib/hub/ledger.js's settlement journal
//      (`hub:settle`) into POST /api/hub/:project/payout (both `&sent=` and `&send=`, plus
//      `&sweep=` for a row confirmed late) as a dual-write ON TOP OF the legacy
//      lib/cuna-payout.js `batch.sent[wallet]` mechanism, which stays the mechanism that actually
//      pays and the compatibility mirror `owedNow` still reads (lib/hub/settle.js). A row settles
//      into the journal only when its transfer can be attributed to one specific instruction
//      (lib/payout-verify.js locateTransferInstruction — Addendum B1 never fabricates an
//      instruction index); a row it cannot attribute stays legacy-only and is reported as such in
//      the route's own response, never silently dropped. lib/hub/attempts.js's row states
//      (`submitted` before a managed-payer broadcast confirms, `settled` once journaled) are
//      stamped the same way. So the counters below now read real, growing numbers — not the
//      historical CUNA rows written before this change, which have no journal event and never will
//      without a separate, owner-run backfill (`scripts/hub-journal-backfill-preview.cjs` prints
//      what one WOULD write; it changes nothing).
//   2. Nothing durably recorded "a wallet connected" before this change. The tools-pass session
//      (server.js issueToolPass / POST /api/tool-gate/session) and the Hub operator desk session
//      (lib/hub/operator.js issueToken / POST /api/hub/:project/desk/session) are both stateless
//      HMAC issuance — no kv write. Normie Quest's /api/nq/wallet/config is a config read with no
//      persisted event either. So this file adds ONE minimal, salted, PII-free event at each of
//      the two Hub-adjacent choke points (recordWalletConnect, called from server.js and
//      lib/hub/routes.js) and reports NQ as not counted rather than inventing a number for it.
//   3. hatchery.js persists only the LIFETIME SET of mint addresses ever built
//      (`hatchery_mints_v1`) — no fee amount, payer or timestamp per mint. Hatchery revenue is
//      therefore NOT reproducible for a period or in lamports; `revenueHatchery` says so.

const crypto = require("crypto");
const hubStore = require("./hub/store");

// ── the two new durable events (server.js / lib/hub/routes.js call these; compute() only reads) ─
const SALT = () => process.env.ANALYTICS_SALT || process.env.PREMIUM_ACCESS_KEY || "clkn-traction-salt";
const WALLETS_KEY = "traction:wallet_connects_v1";     // { [source]: { [day]: [hash,...] } }
const RECEIPT_OPENS_KEY = "traction:receipt_opens_v1"; // { [day]: { [projectId]: [hash,...] } }
const MAX_PER_BUCKET = 5000;      // same abuse-guard cap lib/analytics.js uses per day
const KEEP_DAYS = 400;            // well past the hackathon window; bounded so this never grows forever

function dayKeyOf(ms) { return new Date(Number(ms) || 0).toISOString().slice(0, 10); }
// ISO week (Monday-start), "YYYY-Www" — coarse enough that "two different periods" in the
// repeat-operators counter means what a human would call two different weeks.
function isoWeekKeyOf(dayKey) {
  const d = new Date(String(dayKey).slice(0, 10) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function hashOf(...parts) { return crypto.createHash("sha256").update(parts.join("|") + "|" + SALT()).digest("hex").slice(0, 24); }
function dayInRange(day, fromDay, toDay) { return day >= fromDay && day <= toDay; }
function pruneByDay(byDay, nowMs) {
  const cutoff = dayKeyOf(nowMs - KEEP_DAYS * 86400000);
  const out = {};
  for (const [d, v] of Object.entries(byDay || {})) if (d >= cutoff) out[d] = v;
  return out;
}

// Records that `wallet` proved itself at `source` ("toolpass" | "hub-operator") today. Dedups per
// (source, day, wallet) — five connects in one day count once, so this measures wallets, not hits.
// Never stores the wallet itself: only a salted hash, so this is PII-free by construction.
function recordWalletConnect(kv, { source, wallet, nowMs = Date.now() } = {}) {
  if (!wallet || !source || !kv || typeof kv.set !== "function") return;
  const day = dayKeyOf(nowMs);
  const h = hashOf("wallet", source, wallet);
  const all = kv.get(WALLETS_KEY, {}) || {};
  const bySource = pruneByDay(all[source] || {}, nowMs);
  const today = new Set(bySource[day] || []);
  if (today.has(h) || today.size >= MAX_PER_BUCKET) return;
  today.add(h);
  kv.set(WALLETS_KEY, { ...all, [source]: { ...bySource, [day]: [...today] } });
}

// Records that a receipt at (project, sig) was opened through the public receipt route. Same
// salted-hash, per-day dedup shape as above.
function recordReceiptOpen(kv, { project, sig, nowMs = Date.now() } = {}) {
  if (!project || !sig || !kv || typeof kv.set !== "function") return;
  const day = dayKeyOf(nowMs);
  const h = hashOf("receipt", project, sig);
  const all = pruneByDay(kv.get(RECEIPT_OPENS_KEY, {}) || {}, nowMs);
  const byProject = { ...(all[day] || {}) };
  const list = new Set(byProject[project] || []);
  if (list.has(h) || list.size >= MAX_PER_BUCKET) return;
  list.add(h);
  kv.set(RECEIPT_OPENS_KEY, { ...all, [day]: { ...byProject, [project]: [...list] } });
}

function readWalletConnects(kv) { return (kv && kv.get(WALLETS_KEY, {})) || {}; }
function readReceiptOpens(kv) { return (kv && kv.get(RECEIPT_OPENS_KEY, {})) || {}; }

// ── whose activity a counter reflects ────────────────────────────────────────────────────────
// The built-in programmes (project.js: "CLKN, CUNA, ROSE are code, not registry rows") are never
// a paying, self-registered Hub operator. CLKN and CUNA are Cluck Norris's own token/community —
// any activity attributed to them is founder-operated. ROSE is the roadmap's named dry-run
// candidate (docs/COLOSSEUM_ROADMAP.md §4 decision 1). Anything else in the registry is an
// independently onboarded project.
const FOUNDER_IDS = new Set(["clkn", "cuna"]);
const DRYRUN_IDS = new Set(["rose"]);
function labelFor(ids) {
  const set = [...new Set((ids || []).filter(Boolean))];
  if (!set.length) return "independent"; // no contributions yet — the honest floor: nothing founder-operated moved this number
  const isF = (id) => FOUNDER_IDS.has(id), isD = (id) => DRYRUN_IDS.has(id), isI = (id) => !isF(id) && !isD(id);
  if (set.every(isF)) return "founder-operated";
  if (set.every(isD)) return "dry-run";
  if (set.every(isI)) return "independent";
  return "mixed";
}

function toMs(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  return Number.isFinite(t) ? t : fallback;
}

// dryRun (Colosseum E10) projects — e.g. the POKEAHOE placeholder — are excluded from every
// traction counter here: they never arm, so they never accrue or pay for real, and counting a
// labelled dry run as traction would make the numbers dishonest. This is the SAME dryRun flag
// lib/hub/engine.js refuses to arm and lib/hub/routes.js refuses to pay.
function approvedProjects(registry) {
  return Object.entries(registry || {}).filter(([, p]) => p && p.status === "approved" && p.dryRun !== true);
}
function versionsOf(kv, projectId) {
  const state = hubStore.read(kv, projectId, "state", {}) || {};
  return Array.isArray(state.versions) ? state.versions : [];
}
// Every {wallet, sig, at, batchId} the LIVE payout mechanism has recorded as sent, across every
// batch of one project — lib/cuna-payout.js `batch.sent`, written by
// POST /api/hub/:project/payout?sent= (lib/hub/routes.js). This is what actually pays today.
function sentRowsOf(kv, projectId) {
  const batches = hubStore.read(kv, projectId, "batches", {}) || {};
  const rows = [];
  for (const b of Object.values(batches || {})) {
    if (!b || !b.sent) continue;
    for (const [wallet, s] of Object.entries(b.sent)) if (s && s.sig) rows.push({ wallet, sig: s.sig, at: (Number(s.at) || 0) * 1000, batchId: b.id || null }); // s.at is nowUnix (seconds), lib/cuna-payout.js recordSent
  }
  return rows;
}
// lib/hub/attempts.js's row states, stamped by the W3 dual-write in lib/hub/routes.js (see this
// file's header) onto `batches[].attempts[wallet]` — `submitted` before a managed-payer broadcast
// confirms, `settled` once the journal has an event for the row.
function attemptSignaturesOf(kv, projectId) {
  const batches = hubStore.read(kv, projectId, "batches", {}) || {};
  const rows = [];
  for (const b of Object.values(batches || {})) {
    if (!b || !b.attempts) continue;
    for (const [wallet, a] of Object.entries(b.attempts)) {
      if (a && a.sig) rows.push({ wallet, sig: a.sig, at: (Number(a.sigAt || a.settledAt || a.startedAt) || 0) * 1000, batchId: b.id || null, state: a.state });
      for (const f of (a && a.failed) || []) if (f && f.sig) rows.push({ wallet, sig: f.sig, at: (Number(f.sigAt || f.failedAt) || 0) * 1000, batchId: b.id || null, state: "failed" });
    }
  }
  return rows;
}

// { period, counters: { name: { value, denominator, source, label, note? } } }. `from`/`to` are a
// Date.now()-style ms timestamp or a "YYYY-MM-DD" day string; both default to the trailing 30 days.
function compute({ kv, from, to } = {}) {
  if (!kv || typeof kv.get !== "function") throw new Error("compute() needs a kv with get()");
  const toMsV = toMs(to, Date.now());
  const fromMsV = toMs(from, toMsV - 30 * 86400000);
  const fromDay = dayKeyOf(fromMsV), toDay = dayKeyOf(toMsV);
  const inRangeMs = (ms) => dayInRange(dayKeyOf(ms), fromDay, toDay);
  const period = { from: fromDay, to: toDay, fromMs: fromMsV, toMs: toMsV };

  const registry = hubStore.readRegistry(kv) || {};
  const approved = approvedProjects(registry);
  const approvedIds = approved.map(([id]) => id);
  const allProjectIds = [...new Set([...approvedIds, "cuna"])]; // cuna pays live but is not a registry row

  const counters = {};
  const caveats = [];

  // ── wallets connected ──────────────────────────────────────────────────────────────────────
  const wc = readWalletConnects(kv);
  const wcLifetime = new Set(), wcPeriod = new Set();
  const bySource = {};
  for (const [source, byDay] of Object.entries(wc)) {
    bySource[source] = 0;
    for (const [day, hashes] of Object.entries(byDay || {})) {
      for (const h of hashes || []) {
        wcLifetime.add(source + ":" + h);
        if (dayInRange(day, fromDay, toDay)) { wcPeriod.add(source + ":" + h); bySource[source]++; }
      }
    }
  }
  counters.walletsConnected = {
    value: wcPeriod.size, denominator: wcLifetime.size,
    source: "kv `traction:wallet_connects_v1` — a salted per-day hash recorded when POST /api/tool-gate/session issues a session (source \"toolpass\") or POST /api/hub/:project/desk/session issues an operator token (source \"hub-operator\"); this change adds the write at both choke points",
    label: "independent", bySource,
    note: "Normie Quest's /api/nq/wallet/config is a config read with no persisted event and is NOT counted — durable only once a similar event is added there.",
  };
  caveats.push("wallets connected excludes Normie Quest wallet checks (not durably recorded anywhere).");

  // ── programs created / program versions published (Hub-registered projects) ─────────────────
  let programsInPeriod = 0, programsLifetime = 0, versionsInPeriod = 0, versionsLifetime = 0;
  const programIds = [], versionIds = [];
  for (const [id] of approved) {
    const versions = versionsOf(kv, id);
    if (!versions.length) continue;
    programsLifetime++;
    const v1Day = String(versions[0].effectiveFrom || "").slice(0, 10);
    if (dayInRange(v1Day, fromDay, toDay)) { programsInPeriod++; programIds.push(id); }
    for (const v of versions) {
      versionsLifetime++;
      const d = String(v.effectiveFrom || "").slice(0, 10);
      if (dayInRange(d, fromDay, toDay)) { versionsInPeriod++; versionIds.push(id); }
    }
  }
  counters.hubProgramsCreated = {
    value: programsInPeriod, denominator: programsLifetime,
    source: "lib/hub/store.js REGISTRY_KEY (approved projects) whose `state.versions[0].effectiveFrom` (lib/hub/project.js createVersion) falls in the period",
    label: labelFor(programIds),
  };
  counters.hubProgramVersionsPublished = {
    value: versionsInPeriod, denominator: versionsLifetime,
    source: "every approved project's `state.versions[]`, counted by `effectiveFrom`",
    label: labelFor(versionIds),
  };

  // ── receipts issued ────────────────────────────────────────────────────────────────────────
  const journal = hubStore.readJournal(kv) || {};
  let journalInPeriod = 0, journalLifetime = 0; const journalIds = [];
  for (const e of Object.values(journal)) {
    if (!e) continue;
    journalLifetime++;
    if (inRangeMs((Number(e.at) || 0) * 1000)) { journalInPeriod++; journalIds.push(e.projectId); }
  }
  counters.hubReceiptsIssuedJournal = {
    value: journalInPeriod, denominator: journalLifetime,
    source: "lib/hub/store.js JOURNAL_KEY (`hub:settle`) via lib/hub/ledger.js settle() — the design's settlement journal, dual-written by POST /api/hub/:project/payout since W3",
    label: labelFor(journalIds),
    note: journalLifetime === 0 ? "0 so far on this deployment — either no row has settled since W3 shipped, or every settled row's transfer could not be attributed to one instruction (lib/payout-verify.js locateTransferInstruction) and stayed legacy-only; hubReceiptsIssuedSent/cunaReceiptsIssued below are the mechanism that actually pays regardless. Historical rows sent before W3 have no journal event and never will without a separate, owner-run backfill." : undefined,
  };
  let sentInPeriod = 0, sentLifetime = 0; const sentIds = [];
  for (const id of approvedIds) {
    if (id === "cuna") continue; // CUNA predates the Hub's onboarding flow — counted separately below
    for (const r of sentRowsOf(kv, id)) { sentLifetime++; if (inRangeMs(r.at)) { sentInPeriod++; sentIds.push(id); } }
  }
  counters.hubReceiptsIssuedSent = {
    value: sentInPeriod, denominator: sentLifetime,
    source: "every Hub-registered project's `batches[].sent[wallet]` (lib/cuna-payout.js recordSent, written by POST /api/hub/:project/payout?sent=) — the mechanism that actually pays today",
    label: labelFor(sentIds),
  };
  let cunaInPeriod = 0, cunaLifetime = 0;
  for (const r of sentRowsOf(kv, "cuna")) { cunaLifetime++; if (inRangeMs(r.at)) cunaInPeriod++; }
  counters.cunaReceiptsIssued = {
    value: cunaInPeriod, denominator: cunaLifetime,
    source: "the aliased `cunaStakeBatches[].sent[wallet]` (lib/hub/store.js maps projectId \"cuna\" onto the legacy keys) — the pre-window CUNA payout (server.js /cuna-payout, lib/cuna-payout.js), kept separate because it predates the Hub and is the owner's own programme",
    label: "founder-operated",
  };

  // ── receipts opened by a holder ────────────────────────────────────────────────────────────
  const opens = readReceiptOpens(kv);
  let opensInPeriod = 0, opensLifetime = 0; const openIds = [];
  for (const [day, byProject] of Object.entries(opens)) {
    for (const [projectId, hashes] of Object.entries(byProject || {})) {
      const n = (hashes || []).length;
      opensLifetime += n;
      if (dayInRange(day, fromDay, toDay)) { opensInPeriod += n; if (n) openIds.push(projectId); }
    }
  }
  const receiptsIssuedToDate = journalLifetime + sentLifetime + cunaLifetime;
  counters.hubReceiptsOpened = {
    value: opensInPeriod, denominator: receiptsIssuedToDate,
    source: "kv `traction:receipt_opens_v1` — a salted per-day hash recorded by GET /api/hub/:project/r/:sig on a hit; this change adds the write (the route previously recorded nothing)",
    label: labelFor(openIds),
    note: "denominator is every receipt issued to date (journal + sent + CUNA sent) — reads as \"opens this period ÷ receipts that exist\", not an open rate per receipt (dedup is per day, not per receipt, so one receipt reopened later in the same day counts once).",
  };

  // ── batches signed ─────────────────────────────────────────────────────────────────────────
  let attemptsInPeriod = 0, attemptsLifetime = 0; const attemptIds = [];
  for (const id of allProjectIds) {
    for (const r of attemptSignaturesOf(kv, id)) { attemptsLifetime++; if (inRangeMs(r.at)) { attemptsInPeriod++; attemptIds.push(id); } }
  }
  counters.hubBatchesSigned = {
    value: attemptsInPeriod, denominator: attemptsLifetime,
    source: "every project's `batches[].attempts[wallet]` — `submitted` stamped by lib/hub/attempts.js stampSubmitted when the managed payer signs (before broadcast), `settled` stamped by stampSettled once the journal has an event for the row (lib/hub/routes.js, W3)",
    label: labelFor(attemptIds),
    note: attemptsLifetime === 0 ? "0 so far on this deployment — no row has gone through the `&send=` managed-payer branch, or reached `settled`, since W3 shipped." : undefined,
  };
  if (journalLifetime === 0 && attemptsLifetime === 0) caveats.push("the settlement-journal and attempt-state counters (hubReceiptsIssuedJournal, hubBatchesSigned) read 0 on this deployment — see each counter's own note for why (W3 wired both into lib/hub/routes.js; a 0 here is either 'nothing settled yet' or 'nothing was attributable to one instruction', not 'not wired').");

  // ── repeat operators (an operator with activity in >= 2 different ISO weeks in the period) ──
  const REPEAT_WEEKS = 2;
  let repeatCount = 0; const repeatIds = [];
  const eligibleOperators = approvedIds.filter((id) => id !== "cuna"); // cuna predates onboarding
  for (const id of eligibleOperators) {
    const days = hubStore.read(kv, id, "days", {}) || {};
    const weeks = new Set();
    for (const sliceKey of Object.keys(days)) {
      const day = String(sliceKey).slice(0, 10);
      if (dayInRange(day, fromDay, toDay)) weeks.add(isoWeekKeyOf(day));
    }
    if (weeks.size >= REPEAT_WEEKS) { repeatCount++; repeatIds.push(id); }
  }
  counters.repeatOperators = {
    value: repeatCount, denominator: eligibleOperators.length,
    source: `distinct ISO weeks with at least one accrual slice in each Hub-registered project's \`days\` part (lib/hub/store.js), within the period — an operator counts once it has activity in ${REPEAT_WEEKS}+ different weeks`,
    label: labelFor(repeatIds),
  };

  // ── revenue ────────────────────────────────────────────────────────────────────────────────
  const canScan = typeof kv.entriesWithPrefix === "function";
  let toolsPassLamports = 0, toolsPassCount = 0, toolsPassLamportsAll = 0, toolsPassCountAll = 0;
  if (canScan) {
    for (const [, rec] of kv.entriesWithPrefix("toolPassPaid:")) {
      if (!rec) continue;
      const lamports = Number(rec.lamports) || 0;
      const at = Number(rec.startAt) || Number(rec.at) || 0;
      toolsPassCountAll++; toolsPassLamportsAll += lamports;
      if (inRangeMs(at)) { toolsPassCount++; toolsPassLamports += lamports; }
    }
  } else {
    caveats.push("revenueToolsPass* is 0/unavailable — the kv passed to compute() has no entriesWithPrefix()");
  }
  const toolsPassSource = "kv `toolPassPaid:<sig>` audit records (lib/tool-pass-redeem.js redeemPaidPass, one per redeemed payment), enumerated via kv.entriesWithPrefix" + (canScan ? "" : " (UNAVAILABLE on this kv)");
  counters.revenueToolsPassLamports = { value: toolsPassLamports, denominator: toolsPassLamportsAll, source: toolsPassSource, label: "independent" };
  counters.revenueToolsPassCount = { value: toolsPassCount, denominator: toolsPassCountAll, source: toolsPassSource, label: "independent" };

  let accessSolLamports = 0, accessSolCount = 0, accessSolLamportsAll = 0, accessSolCountAll = 0;
  let accessClknRaw = 0n, accessClknCount = 0, accessClknRawAll = 0n, accessClknCountAll = 0;
  const accessIds = [];
  for (const [id, p] of approved) {
    for (const pay of (p.access && p.access.payments) || []) {
      if (!pay) continue;
      const atMs = (Number(pay.atUnix) || 0) * 1000;
      if (pay.kind === "sol" && Number.isFinite(Number(pay.lamports))) {
        const l = Number(pay.lamports);
        accessSolLamportsAll += l; accessSolCountAll++;
        if (inRangeMs(atMs)) { accessSolLamports += l; accessSolCount++; accessIds.push(id); }
      } else if (pay.kind === "clkn" && pay.clknRaw != null) {
        let v; try { v = BigInt(pay.clknRaw); } catch (_) { continue; }
        accessClknRawAll += v; accessClknCountAll++;
        if (inRangeMs(atMs)) { accessClknRaw += v; accessClknCount++; accessIds.push(id); }
      }
    }
  }
  const accessSolSource = "lib/hub/access.js `project.access.payments[]` in the registry (kind \"sol\")";
  const accessClknSource = "same, kind \"clkn\" — raw base units only; no SOL-equivalent or USD figure is stored at payment time, so none is reported";
  counters.revenueHubAccessSolLamports = { value: accessSolLamports, denominator: accessSolLamportsAll, source: accessSolSource, label: labelFor(accessIds) };
  counters.revenueHubAccessSolCount = { value: accessSolCount, denominator: accessSolCountAll, source: accessSolSource, label: labelFor(accessIds) };
  counters.revenueHubAccessClknRaw = { value: accessClknRaw.toString(), denominator: accessClknRawAll.toString(), source: accessClknSource, label: labelFor(accessIds) };
  counters.revenueHubAccessClknCount = { value: accessClknCount, denominator: accessClknCountAll, source: accessClknSource, label: labelFor(accessIds) };

  let hatcheryBuiltAllTime = null;
  try {
    const h = kv.get("hatchery_mints_v1", null);
    hatcheryBuiltAllTime = h && Array.isArray(h.built) ? h.built.length : null;
  } catch (_) { /* leave null */ }
  counters.revenueHatchery = {
    value: null, denominator: hatcheryBuiltAllTime,
    source: "hatchery.js kv `hatchery_mints_v1` — records only the LIFETIME SET of mint addresses ever built; no fee amount, payer or timestamp is persisted per mint",
    label: "independent",
    note: "NOT REPRODUCIBLE for revenue: neither an amount nor a date is stored, so no period-scoped or lamport figure can be derived. `denominator` is the only number this source can give — a lifetime count of mints built, never fees.",
  };
  caveats.push("revenueHatchery is not reproducible for a period or in lamports — hatchery.js persists only a lifetime set of mint addresses, no amount or timestamp.");

  // ── operator onboarding clock (Colosseum E7 — the W6b "observed setup time" column) ──────────
  // Four deltas, seconds, computed only when BOTH endpoints of a step are on record; never a made-
  // up number — a project mid-onboarding shows real deltas up to wherever it has got to, then null.
  // Milestones are written once, at the choke point, by lib/hub/project.js (approveProject),
  // lib/hub/apply.js (approve — appliedAt + firstVersionPublishedAt together, since a self-serve
  // application's draft becomes v1 the moment it is approved) and lib/hub/routes.js (firstPaidAt on
  // a verified access payment, firstVersionPublishedAt on a project's first &terms=1, firstArmedAt
  // mirroring state.startedAt which the engine itself never moves once set, firstBatchSignedAt on
  // the first batches[].sent write — whichever the live payout route actually does today).
  const onboarding = [];
  let sawDryRunField = false;
  for (const [id, p] of approved) {
    if (p && p.dryRun === true) { sawDryRunField = true; continue; }
    const ms = (p && p.milestones) || {};
    const delta = (a, b) => (Number.isFinite(ms[a]) && Number.isFinite(ms[b]) ? ms[b] - ms[a] : null);
    onboarding.push({
      project: id,
      deltas: {
        applyToApprove: delta("appliedAt", "approvedAt"),
        approveToFirstVersion: delta("approvedAt", "firstVersionPublishedAt"),
        firstVersionToFirstArm: delta("firstVersionPublishedAt", "firstArmedAt"),
        firstArmToFirstBatch: delta("firstArmedAt", "firstBatchSignedAt"),
      },
      label: labelFor([id]),
    });
  }
  // CUNA predates the Hub entirely — a built-in programme (project.js), never a registry row, so
  // it never had an apply/approve/arm sequence to measure. Labelled, not reported as a false zero.
  onboarding.push({ project: "cuna", deltas: { applyToApprove: null, approveToFirstVersion: null, firstVersionToFirstArm: null, firstArmToFirstBatch: null }, label: "n/a (pre-window)" });
  if (!sawDryRunField) caveats.push("onboarding's dryRun filter is a no-op today: no project record yet carries a `dryRun` field (E2 adds the dry-run fixture project) — nothing was excluded on that basis.");

  return { period, counters, caveats, onboarding };
}

module.exports = {
  WALLETS_KEY, RECEIPT_OPENS_KEY, FOUNDER_IDS, DRYRUN_IDS,
  dayKeyOf, isoWeekKeyOf, labelFor,
  recordWalletConnect, recordReceiptOpen, readWalletConnects, readReceiptOpens,
  compute,
};
