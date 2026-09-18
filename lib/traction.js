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
// The salt for every hash below (Codex brief, Round 2, batch 8, finding #3): with neither env var
// set, the old fallback was a hardcoded literal string, baked into this file and identical in
// every checkout, so the "PII-free" per-day wallet/sid hash was reversible against a public
// holder list by anyone who read this file (hash every holder address with the known salt,
// compare). Now a fresh
// install with no env var generates its own random salt ONCE (crypto.randomBytes(32), hex) and
// persists it under kv `traction:salt_v1` — never logged, read back on every later call so the
// hash stays stable for as long as the kv volume does. No kv (a caller that hasn't wired one, or
// a volume-less boot) falls back to a per-process random salt: still never the literal string,
// just not stable across a restart — a strictly better failure mode than being reversible.
const STORED_SALT_KEY = "traction:salt_v1";
let _procSalt = null;
function persistedSalt(kv) {
  if (!kv || typeof kv.get !== "function") return null;
  let existing = null;
  try { existing = kv.get(STORED_SALT_KEY, null); } catch (_) { existing = null; }
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const fresh = crypto.randomBytes(32).toString("hex");
  try {
    const ok = typeof kv.setVerified === "function" ? kv.setVerified(STORED_SALT_KEY, fresh) === true : (kv.set(STORED_SALT_KEY, fresh), true);
    if (ok) return fresh;
  } catch (_) { /* fall through to the process-local salt below */ }
  return null;
}
function SALT(kv) {
  if (process.env.ANALYTICS_SALT) return process.env.ANALYTICS_SALT;
  if (process.env.PREMIUM_ACCESS_KEY) return process.env.PREMIUM_ACCESS_KEY;
  const stored = persistedSalt(kv);
  if (stored) return stored;
  if (!_procSalt) _procSalt = crypto.randomBytes(32).toString("hex"); // no kv to persist to — random, not reversible, just not shared
  return _procSalt;
}
const WALLETS_KEY = "traction:wallet_connects_v1";     // { [source]: { [day]: [hash,...] } }
const RECEIPT_OPENS_KEY = "traction:receipt_opens_v1"; // { [day]: { [projectId]: [hash,...] } }
// E6: the school → Hub bridge. A learner who arrives at a locking lesson via a Hub project's
// #lesson=…&from=hub:<project> link (lib/hub/teach.js lessonHref, public/hub.html `lessons()`)
// and finishes it fires this — the ONE Educate→Earn number honest enough to publish, because it
// is a real person reading real material before a real decision, not a promise of anything paid.
// Same salted-hash-per-day-per-project shape as RECEIPT_OPENS_KEY, so it reads the same way.
const HUB_LESSON_READS_KEY = "traction:hub_lesson_reads_v1"; // { [day]: { [projectId]: [hash,...] } }
// BB5 (Colosseum roadmap §12): the SAME `hub_lesson_read` event now also carries which of the
// seven lock-lesson ids was actually read, so the platform-wide total above can be broken down
// by lesson — in particular, "how many learners reached the receipt lesson's finish card". A
// second, independent store (not a re-key of the one above) because this dimension is
// project-agnostic: it answers "how many read THIS lesson", not "how many read a lesson having
// arrived from THIS project". Same salted-hash-per-day dedup shape.
const HUB_LESSON_READS_BY_LESSON_KEY = "traction:hub_lesson_reads_by_lesson_v1"; // { [day]: { [lessonId]: [hash,...] } }
// The ONLY lesson ids `hub_lesson_read` can ever carry — the school only fires this event for
// the seven ids in src/App.jsx's LOCK_LESSON_IDS (the lessons that bridge to the Hub). Kept as a
// literal set here, same pattern as lib/hub/teach.js's LESSON_MAP comment: update both places
// together if that set ever changes. A `lesson` field outside this set is dropped, not stored —
// bounded so a script can't grow this key space by inventing new lesson ids.
const KNOWN_LOCK_LESSON_IDS = new Set(["tokenomics", "wallets", "staking", "lp", "volatility", "rugs", "receipt"]);
// W9 part 2 (Colosseum roadmap §W9 part 2 / E9's own "create some usage" list): the two doors
// that point EXISTING traffic — the school's own learners, and the homepage's project-operator
// tile — at the Hub, with no engine armed and no post sent to make it true. Same salted-hash-
// per-day-per-source dedup shape as the counters above. "school" fires from the school landing
// (Landing()) and from HubDemoDoor() on every lesson's finish screen (src/App.jsx); "home" fires
// from the second line under the "I run a project or community" tile (public/home.html).
const HUB_DOOR_CLICKS_KEY = "traction:hub_door_clicks_v1"; // { [day]: { [source]: [hash,...] } }
// BB5: click-throughs from the receipt lesson's OWN finish card (ReceiptLessonBridge, src/App.jsx)
// — a fixed, server-enforced allowlist, never free text. `from` is always "receipt" today (the
// only lesson with its own bridge card); `to` names which of the three links was clicked. A bad
// `from`/`to` is dropped, not stored, same as the lesson-id bound above.
const HUB_BRIDGE_CLICKS_KEY = "traction:hub_bridge_clicks_v1"; // { [day]: { [from]: { [to]: [hash,...] } } }
const HUB_BRIDGE_FROM = new Set(["receipt"]);
const HUB_BRIDGE_TO = new Set(["demo-receipt", "verify", "trust"]);
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
function hashOf(kv, ...parts) { return crypto.createHash("sha256").update(parts.join("|") + "|" + SALT(kv)).digest("hex").slice(0, 24); }
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
  const h = hashOf(kv, "wallet", source, wallet);
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
  const h = hashOf(kv, "receipt", project, sig);
  const all = pruneByDay(kv.get(RECEIPT_OPENS_KEY, {}) || {}, nowMs);
  const byProject = { ...(all[day] || {}) };
  const list = new Set(byProject[project] || []);
  if (list.has(h) || list.size >= MAX_PER_BUCKET) return;
  list.add(h);
  kv.set(RECEIPT_OPENS_KEY, { ...all, [day]: { ...byProject, [project]: [...list] } });
}

// Records that `sid` (the school's anonymous per-browser id — never a wallet) finished a
// locking lesson having arrived from `project`'s Hub page. Dedups per (day, project, sid): a
// learner who re-passes the same lesson twice in a day, or passes several of the six locking
// lessons in one visit, counts once — this measures READERS, not lesson-completion events.
// BB5: `lesson` is optional (old rows, and any call site that doesn't have it, still count
// toward the total above) and, when given, ALSO records into the per-lesson breakdown — but
// only when it's one of the seven known lock-lesson ids (KNOWN_LOCK_LESSON_IDS); anything else
// is silently dropped rather than stored, so a script can't grow that key space.
function recordHubLessonRead(kv, { project, sid, lesson, nowMs = Date.now() } = {}) {
  if (!project || !sid || !kv || typeof kv.set !== "function") return;
  const day = dayKeyOf(nowMs);
  const h = hashOf(kv, "hublesson", project, sid);
  const all = kv.get(HUB_LESSON_READS_KEY, {}) || {};
  const byProject = { ...(all[day] || {}) };
  const list = new Set(byProject[project] || []);
  if (!list.has(h) && list.size < MAX_PER_BUCKET) {
    list.add(h);
    kv.set(HUB_LESSON_READS_KEY, { ...all, [day]: { ...byProject, [project]: [...list] } });
  }
  if (lesson && KNOWN_LOCK_LESSON_IDS.has(lesson)) {
    const h2 = hashOf(kv, "hublessonbylesson", lesson, sid);
    const allL = kv.get(HUB_LESSON_READS_BY_LESSON_KEY, {}) || {};
    const byLesson = { ...(allL[day] || {}) };
    const listL = new Set(byLesson[lesson] || []);
    if (!listL.has(h2) && listL.size < MAX_PER_BUCKET) {
      listL.add(h2);
      kv.set(HUB_LESSON_READS_BY_LESSON_KEY, { ...allL, [day]: { ...byLesson, [lesson]: [...listL] } });
    }
  }
}
// W9 part 2. `source` is "school" (school landing / lesson finish screens, no wallet, no
// project context) or "home" (the homepage's project-operator tile). Dedups per (day, source,
// sid) — the school sends its own anonymous `clkn_sid`; the home page sends an equivalent
// anonymous per-browser id it keeps in the same localStorage key, so a visitor who sees both
// doors on the same day is still one person in the lifetime count, not two.
function recordHubDoorClick(kv, { source, sid, nowMs = Date.now() } = {}) {
  if (!source || !sid || !kv || typeof kv.set !== "function") return;
  const day = dayKeyOf(nowMs);
  const h = hashOf(kv, "doorclick", source, sid);
  const all = kv.get(HUB_DOOR_CLICKS_KEY, {}) || {};
  const bySource = { ...(all[day] || {}) };
  const list = new Set(bySource[source] || []);
  if (list.has(h) || list.size >= MAX_PER_BUCKET) return;
  list.add(h);
  kv.set(HUB_DOOR_CLICKS_KEY, { ...all, [day]: { ...bySource, [source]: [...list] } });
}
// BB5: `from`/`to` are checked against the fixed allowlists above and dropped (not stored) if
// either isn't recognized — mirrors recordHubLessonRead's lesson-id bound. Dedups per (day,
// from, to, sid), same salted-hash shape as everything else in this file.
function recordHubBridgeClick(kv, { from, to, sid, nowMs = Date.now() } = {}) {
  if (!from || !to || !sid || !kv || typeof kv.set !== "function") return;
  if (!HUB_BRIDGE_FROM.has(from) || !HUB_BRIDGE_TO.has(to)) return;
  const day = dayKeyOf(nowMs);
  const h = hashOf(kv, "bridgeclick", from, to, sid);
  const all = kv.get(HUB_BRIDGE_CLICKS_KEY, {}) || {};
  const byFrom = { ...(all[day] || {}) };
  const byTo = { ...(byFrom[from] || {}) };
  const list = new Set(byTo[to] || []);
  if (list.has(h) || list.size >= MAX_PER_BUCKET) return;
  list.add(h);
  kv.set(HUB_BRIDGE_CLICKS_KEY, { ...all, [day]: { ...byFrom, [from]: { ...byTo, [to]: [...list] } } });
}
function readWalletConnects(kv) { return (kv && kv.get(WALLETS_KEY, {})) || {}; }
function readReceiptOpens(kv) { return (kv && kv.get(RECEIPT_OPENS_KEY, {})) || {}; }
function readHubLessonReads(kv) { return (kv && kv.get(HUB_LESSON_READS_KEY, {})) || {}; }
function readHubLessonReadsByLesson(kv) { return (kv && kv.get(HUB_LESSON_READS_BY_LESSON_KEY, {})) || {}; }
function readHubDoorClicks(kv) { return (kv && kv.get(HUB_DOOR_CLICKS_KEY, {})) || {}; }
function readHubBridgeClicks(kv) { return (kv && kv.get(HUB_BRIDGE_CLICKS_KEY, {})) || {}; }

// Page views of an exact analytics path (`analytics_v1` kv, server.js's `req.path`) within a
// day range — the same lookup lessonReadsForProject() does for a Hub project page, pulled out
// here so the door-click counters can use it against `/school` and `/` too. `null` (never a
// guessed 0) when the analytics store has no bucket for that path in range, so a report can say
// "denominator unavailable" instead of implying zero traffic.
function pageViewsInPeriod(kv, path, fromDay, toDay) {
  try {
    const raw = kv && kv.get ? kv.get("analytics_v1", null) : null;
    if (raw && raw.days) {
      let views = 0, found = false;
      for (const [day, b] of Object.entries(raw.days)) {
        if (!dayInRange(day, fromDay, toDay)) continue;
        if (b && b.paths && Object.prototype.hasOwnProperty.call(b.paths, path)) { found = true; views += Number(b.paths[path]) || 0; }
      }
      if (found) return views;
    }
  } catch (_) { /* stays null — "unavailable", never a guessed zero */ }
  return null;
}

// Per-project figure for the project's own public JSON (lib/hub/public.js projectView →
// `lessonReads`) — separate from the aggregate counter in compute() because a project page needs
// ITS OWN count and a denominator scoped to ITS OWN page, not the platform-wide total. The
// denominator is that project's own page views in the same period, read straight out of
// lib/analytics.js's stored buckets (kv `analytics_v1`) at the exact path `/hub/<project>` —
// bypassing analytics.summary()'s top-15-per-day cap, which would silently under-count a path
// that isn't in the day's top 15. `null` (never 0) when the analytics store can't answer, so the
// page can say "denominator unavailable" instead of implying a real zero.
function lessonReadsForProject(kv, projectId, { from, to } = {}) {
  if (!projectId || !kv || typeof kv.get !== "function") return { count: 0, period: null, denominator: null };
  const toMsV = toMs(to, Date.now());
  const fromMsV = toMs(from, toMsV - 30 * 86400000);
  const fromDay = dayKeyOf(fromMsV), toDay = dayKeyOf(toMsV);
  const period = { from: fromDay, to: toDay };
  const reads = readHubLessonReads(kv);
  let count = 0;
  for (const [day, byProject] of Object.entries(reads)) {
    if (!dayInRange(day, fromDay, toDay)) continue;
    count += ((byProject && byProject[projectId]) || []).length;
  }
  const denominator = pageViewsInPeriod(kv, "/hub/" + projectId, fromDay, toDay);
  return { count, period, denominator };
}

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

  // ── school → Hub bridge (E6) ───────────────────────────────────────────────────────────────
  const hlr = readHubLessonReads(kv);
  let hlrInPeriod = 0, hlrLifetime = 0; const hlrIds = [];
  for (const [day, byProject] of Object.entries(hlr)) {
    for (const [projectId, hashes] of Object.entries(byProject || {})) {
      const n = (hashes || []).length;
      hlrLifetime += n;
      if (dayInRange(day, fromDay, toDay)) { hlrInPeriod += n; if (n) hlrIds.push(projectId); }
    }
  }
  counters.hubLessonReads = {
    value: hlrInPeriod, denominator: hlrLifetime,
    source: "kv `traction:hub_lesson_reads_v1` — a salted per-day-per-project hash recorded when the school posts a `hub_lesson_read:<project>` funnel event (POST /api/track) after a learner who arrived via a Hub project's lessonHref finishes one of the six locking lessons (lib/hub/teach.js LESSON_MAP)",
    label: labelFor(hlrIds),
    note: "the per-project figure on a project's own page (lib/hub/public.js projectView `lessonReads`) is computed separately by traction.lessonReadsForProject() against that project's own page-view denominator — this counter is the platform-wide total, denominator = lifetime.",
  };

  // ── doors to the Hub (W9 part 2) — existing traffic pointed at the Hub, no engine armed ──────
  const hdc = readHubDoorClicks(kv);
  const hdcInPeriod = { school: 0, home: 0 }, hdcLifetime = { school: 0, home: 0 };
  for (const [day, bySource] of Object.entries(hdc)) {
    for (const [source, hashes] of Object.entries(bySource || {})) {
      const n = (hashes || []).length;
      hdcLifetime[source] = (hdcLifetime[source] || 0) + n;
      if (dayInRange(day, fromDay, toDay)) hdcInPeriod[source] = (hdcInPeriod[source] || 0) + n;
    }
  }
  const schoolViews = pageViewsInPeriod(kv, "/school", fromDay, toDay);
  counters.hubDoorClicksSchool = {
    value: hdcInPeriod.school || 0, denominator: schoolViews,
    source: "kv `traction:hub_door_clicks_v1` source \"school\" — a salted per-day hash recorded when POST /api/track sees `hub_door_click:school` from the school landing's front door or a lesson finish screen's \"See how a project's rewards are actually paid\" card (src/App.jsx HubDemoDoor); denominator is analytics_v1's page views of /school in the same period",
    label: "independent",
    note: schoolViews == null ? "denominator unavailable — analytics_v1 has no /school bucket for this period" : undefined,
  };
  const homeViews = pageViewsInPeriod(kv, "/", fromDay, toDay);
  counters.hubDoorClicksHome = {
    value: hdcInPeriod.home || 0, denominator: homeViews,
    source: "kv `traction:hub_door_clicks_v1` source \"home\" — recorded when POST /api/track sees `hub_door_click:home` from the homepage's \"See a published program and its receipts\" line under the \"I run a project or community\" tile (public/home.html); denominator is analytics_v1's page views of / (homepage) in the same period",
    label: "independent",
    note: homeViews == null ? "denominator unavailable — analytics_v1 has no / bucket for this period" : undefined,
  };
  if (schoolViews == null || homeViews == null) caveats.push("hubDoorClicksSchool/hubDoorClicksHome may report a null denominator when analytics_v1 hasn't recorded a views bucket yet for that path/period — never a guessed zero.");

  // ── receipt lesson bridge (BB5) — the receipt lesson's own finish-screen doors ────────────────
  // Same "doors" shape as hubDoorClicksSchool/Home just above: a count, denominated against
  // /school's own page views in the same period (null, never a guessed zero, when analytics has
  // no bucket for it yet), label "independent" because this funnel isn't attributable to any one
  // Hub project. hubLessonReadsReceipt is "reached the receipt lesson's finish card"; the three
  // hubBridgeClicks* are what a learner did from there.
  const hlrByLesson = readHubLessonReadsByLesson(kv);
  let receiptReadsInPeriod = 0, receiptReadsLifetime = 0;
  for (const [day, byLesson] of Object.entries(hlrByLesson)) {
    const n = ((byLesson && byLesson.receipt) || []).length;
    receiptReadsLifetime += n;
    if (dayInRange(day, fromDay, toDay)) receiptReadsInPeriod += n;
  }
  counters.hubLessonReadsReceipt = {
    value: receiptReadsInPeriod, denominator: schoolViews,
    source: "kv `traction:hub_lesson_reads_by_lesson_v1` lesson \"receipt\" — a salted per-day hash recorded when POST /api/track sees `hub_lesson_read:<project>` carrying `lesson:\"receipt\"` (src/App.jsx, LOCK_LESSON_IDS) after a learner finishes the \"Read a Payout Receipt\" lesson; denominator is analytics_v1's page views of /school in the same period",
    label: "independent",
    note: schoolViews == null ? "denominator unavailable — analytics_v1 has no /school bucket for this period" : undefined,
  };
  const hbc = readHubBridgeClicks(kv);
  const bridgeInPeriod = { "demo-receipt": 0, verify: 0, trust: 0 };
  const bridgeLifetime = { "demo-receipt": 0, verify: 0, trust: 0 };
  for (const [day, byFrom] of Object.entries(hbc)) {
    const byTo = (byFrom && byFrom.receipt) || {};
    for (const [to, hashes] of Object.entries(byTo)) {
      const n = (hashes || []).length;
      if (!(to in bridgeLifetime)) continue; // ignore anything outside the allowlist (should never be stored anyway)
      bridgeLifetime[to] += n;
      if (dayInRange(day, fromDay, toDay)) bridgeInPeriod[to] += n;
    }
  }
  const bridgeLabels = { "demo-receipt": "Open a real receipt and check it, line by line", verify: "Reproduce it yourself, in your own browser", trust: "See what none of this proves" };
  const bridgeCounterNames = { "demo-receipt": "hubBridgeClicksDemoReceipt", verify: "hubBridgeClicksVerify", trust: "hubBridgeClicksTrust" };
  for (const to of ["demo-receipt", "verify", "trust"]) {
    counters[bridgeCounterNames[to]] = {
      value: bridgeInPeriod[to] || 0, denominator: schoolViews,
      source: `kv \`traction:hub_bridge_clicks_v1\` from "receipt" to "${to}" — a salted per-day hash recorded when POST /api/track sees \`hub_bridge_click\` with {from:"receipt", to:"${to}"} from the receipt lesson's own finish card ("${bridgeLabels[to]}", src/App.jsx ReceiptLessonBridge); denominator is analytics_v1's page views of /school in the same period`,
      label: "independent",
      note: schoolViews == null ? "denominator unavailable — analytics_v1 has no /school bucket for this period" : undefined,
    };
  }
  if (schoolViews == null) caveats.push("hubLessonReadsReceipt/hubBridgeClicks* may report a null denominator when analytics_v1 hasn't recorded a /school views bucket yet for that period — never a guessed zero.");

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
  WALLETS_KEY, RECEIPT_OPENS_KEY, HUB_LESSON_READS_KEY, HUB_LESSON_READS_BY_LESSON_KEY,
  HUB_DOOR_CLICKS_KEY, HUB_BRIDGE_CLICKS_KEY, FOUNDER_IDS, DRYRUN_IDS,
  KNOWN_LOCK_LESSON_IDS, HUB_BRIDGE_FROM, HUB_BRIDGE_TO,
  dayKeyOf, isoWeekKeyOf, labelFor,
  recordWalletConnect, recordReceiptOpen, recordHubLessonRead, recordHubDoorClick, recordHubBridgeClick,
  readWalletConnects, readReceiptOpens, readHubLessonReads, readHubLessonReadsByLesson,
  readHubDoorClicks, readHubBridgeClicks,
  lessonReadsForProject, pageViewsInPeriod,
  compute,
  // Test-only: the salt machinery itself (finding #3, batch 8) — scripts/traction-test.cjs pins
  // that it's stored, stable across a re-require, and different per kv. Never called by compute()
  // or the record* functions' own callers.
  STORED_SALT_KEY, hashOf,
};
