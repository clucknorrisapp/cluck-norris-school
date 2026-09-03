// Server-side school progression ledger — the evidence behind a graduation claim.
//
// WHY: /api/claim used to be a pure client assertion. A bare POST {wallet} recorded a
// "graduate" transcript, put the wallet on the airdrop sheet, and minted a treasury-paid
// diploma cNFT — bounded only by a per-IP rate limit and the 60/day mint cap. This module
// gives the server its own record of the learner's journey: the React school pings each
// lesson completion (fire-and-forget, keyed by an anonymous per-browser session id), and
// the claim handler asks "did this browser actually walk the curriculum?"
//
// THREAT MODEL (deliberate, don't over-promise): the quiz answers ship in the client
// bundle, so this can never prove KNOWLEDGE — it proves invested wall-clock shape. A
// scripted attacker must now emit the right events spread over real minutes per session,
// under the /api/track rate limit, and still lands inside the daily mint cap. That turns
// "curl once per wallet" into "run a patient bot farm for worthless NFTs" — and the CLKN
// airdrop itself stays human-approved (airdrop-by-reply), so no automated payout hangs
// off this either way.
//
// Same graceful-degradation pattern as lib/credentials.js: no volume → in-memory only.
const fs = require("fs");
const path = require("path");
const curriculum = require("./curriculum");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "school-progress.json");

const SID_RE = /^[a-z0-9-]{8,64}$/;          // client sends crypto.randomUUID()
const LESSON_RE = /^[a-z0-9-]{1,48}$/;       // same shape trackFunnel allows after the colon
const MAX_MARKS_PER_SID = 40;                // 12 lessons today; headroom, not a spam sink
const MAX_SIDS = 20000;                      // prune oldest beyond this
const TTL_MS = 120 * 86400000;               // drop sessions idle for 120 days

// Grandfathering: learners who finished lessons BEFORE this shipped only have localStorage
// evidence. The client replays those as backfill marks (bf:1). Backfill satisfies the
// spread requirement until this sunset; after it, backfilled marks still count toward the
// lesson total but the time-spread must come from live marks. Hardcoded on purpose — a kv
// knob here would just be one more thing to forget to turn off.
const BACKFILL_SUNSET = Date.UTC(2026, 8, 19); // 2026-09-19 (month is 0-based)

let sessions = {}; // sid -> { createdAt, lastAt, wallet|null, marks: { lessonId: { t, bf } } }
let persistent = false;
let dirty = false;
let corruptAt = null;   // set when load() found an unparseable ledger — surfaced by summary()

(function load() {
  // Reaching a writable volume and PARSING the existing file are two distinct steps (same
  // bug class as lib/credentials.js / lib/kvstore.js). The old code set persistent=true and
  // then parsed inside the SAME try, so a CORRUPT ledger left sessions={} with persistent
  // still true — and the 30s persist() below then atomically OVERWROTE the file with an
  // empty ledger. Since the grad gate started ENFORCING off this ledger (2026-09-02) that
  // wipe blocks every in-flight learner with `no-progress`, and the localStorage backfill is
  // one-shot, so there is nothing to recover from. Split the steps and fail closed.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
  } catch (e) {
    console.warn(`[school-progress] volume unavailable (${e.message}) — running in-memory only`);
    return;
  }
  if (!fs.existsSync(FILE)) { console.log(`[school-progress] no existing ledger — starting fresh at ${FILE}`); return; }
  try {
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not a JSON object");
    sessions = o;
    prune();
    console.log(`[school-progress] loaded ${Object.keys(sessions).length} sessions from ${FILE}`);
  } catch (e) {
    // CORRUPT existing ledger. Do NOT silently start empty — the next persist() tick would
    // overwrite it. Quarantine a copy and DISABLE persistence so the timer stays a no-op
    // until an operator restores the file. summary().persistent surfaces this to the owner
    // via /api/school/grad-gate.
    persistent = false;
    corruptAt = new Date().toISOString();
    try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[school-progress] PROGRESS LEDGER CORRUPT (${e.message}) — persistence DISABLED (fail-closed). Restore ${FILE} from a good copy, then restart.`);
  }
})();

function prune() {
  const now = Date.now();
  const ids = Object.keys(sessions);
  for (const id of ids) {
    const s = sessions[id];
    if (!s || !s.createdAt || now - (s.lastAt || s.createdAt) > TTL_MS) delete sessions[id];
  }
  const left = Object.keys(sessions);
  if (left.length > MAX_SIDS) {
    // Evict by VALUE first (fewest lesson marks — a flooded sid has zero or one),
    // then by recency within a tier. A sid-flooding attacker's sessions are always
    // freshest, so sorting by lastAt alone evicted real learners first; this keeps
    // any session that has actually recorded progress until the junk is gone.
    left.sort((a, b) => {
      const ma = Object.keys((sessions[a] && sessions[a].marks) || {}).length;
      const mb = Object.keys((sessions[b] && sessions[b].marks) || {}).length;
      if (ma !== mb) return ma - mb;
      return (sessions[a].lastAt || 0) - (sessions[b].lastAt || 0);
    });
    for (const id of left.slice(0, left.length - MAX_SIDS)) delete sessions[id];
  }
}

// Writes are frequent (every lesson completion) and low-value individually — batch them
// on a timer instead of fsyncing the file per event like credentials.js does per claim.
function persist() {
  if (!persistent || !dirty) return;
  dirty = false;
  try { require("./atomic-write").atomicWriteFileSync(FILE, JSON.stringify(sessions)); }
  catch (e) { console.warn(`[school-progress] persist failed: ${e.message}`); }
}
setInterval(persist, 30000).unref();

// Record one lesson completion for a session. Backfill marks are the client replaying
// pre-gate localStorage progress (see BACKFILL_SUNSET). Silently ignores garbage — this
// sits behind the public /api/track sink and must never throw into it.
function mark(sid, lessonId, { backfill = false } = {}) {
  sid = String(sid || "").toLowerCase();
  lessonId = String(lessonId || "").toLowerCase();
  if (!SID_RE.test(sid) || !LESSON_RE.test(lessonId)) return false;
  // Only count real curriculum lesson ids — otherwise any regex-shaped string satisfies
  // the gate. Degrades to "don't filter" (not "reject everything") when the id list can't
  // be extracted, so a parse hiccup can't lock every learner out of graduating.
  const known = curriculum.lessonIds();
  if (known && !known.has(lessonId)) return false;
  const now = Date.now();
  let s = sessions[sid];
  if (!s) {
    if (Object.keys(sessions).length >= MAX_SIDS + 500) prune();
    s = sessions[sid] = { createdAt: now, lastAt: now, wallet: null, marks: {} };
  }
  s.lastAt = now;
  if (!s.marks[lessonId] && Object.keys(s.marks).length < MAX_MARKS_PER_SID) {
    // Backfill can never overwrite or follow a live mark for the same lesson — first
    // sighting wins, so a late "bf" replay can't relabel genuine progression.
    s.marks[lessonId] = { t: now, bf: backfill ? 1 : 0 };
  }
  dirty = true;
  return true;
}

// The gate. Answers "should this session be allowed to graduate-mint right now?"
// Checks, cheapest first:
//   1. session exists and has >= requiredLessons distinct lesson marks
//   2. session is at least minAgeMs old (a fresh curl session must sit and wait)
//   3. live (non-backfill) marks span >= minSpreadBuckets distinct 5-minute windows —
//      i.e. the lessons were finished across real elapsed time, not one burst.
//      Waived while backfilled marks cover the requirement and the sunset hasn't passed.
//   4. the session isn't already bound to a different wallet (one diploma per browser
//      session — a second wallet on the same sid is a farm signature, not a household).
function evaluate(sid, wallet, { requiredLessons = 12, minAgeMs = 15 * 60000, minSpreadBuckets = 3 } = {}) {
  sid = String(sid || "").toLowerCase();
  if (!SID_RE.test(sid)) return { ok: false, code: "no-sid", detail: "missing/invalid session id" };
  const s = sessions[sid];
  if (!s) return { ok: false, code: "no-progress", detail: "no progression recorded for this session" };
  const marks = Object.values(s.marks || {});
  if (marks.length < requiredLessons) {
    return { ok: false, code: "incomplete", detail: `${marks.length}/${requiredLessons} lessons recorded` };
  }
  const now = Date.now();
  const age = now - s.createdAt;
  if (age < minAgeMs) {
    return { ok: false, code: "too-fresh", detail: `session ${Math.round(age / 60000)}m old, needs ${Math.round(minAgeMs / 60000)}m` };
  }
  const live = marks.filter((m) => !m.bf);
  const liveBuckets = new Set(live.map((m) => Math.floor(m.t / 300000))).size;
  const backfillCovers = now < BACKFILL_SUNSET && marks.length - live.length > 0;
  if (liveBuckets < minSpreadBuckets && !backfillCovers) {
    return { ok: false, code: "burst", detail: `live marks span ${liveBuckets} five-minute windows, need ${minSpreadBuckets}` };
  }
  if (s.wallet && s.wallet !== wallet) {
    return { ok: false, code: "sid-used", detail: "session already graduated a different wallet" };
  }
  return { ok: true, code: "ok", detail: `${marks.length} lessons, ${Math.round(age / 60000)}m session, ${liveBuckets} live windows${backfillCovers ? " (backfill grandfathered)" : ""}` };
}

// Bind the session to the wallet that successfully minted, closing it to other wallets.
function bindWallet(sid, wallet) {
  const s = sessions[String(sid || "").toLowerCase()];
  if (s && !s.wallet) { s.wallet = wallet; dirty = true; persist(); }
}

function statusFor(sid) {
  const s = sessions[String(sid || "").toLowerCase()];
  if (!s) return null;
  const marks = Object.values(s.marks || {});
  return { createdAt: s.createdAt, lastAt: s.lastAt, wallet: s.wallet ? s.wallet.slice(0, 6) + "…" : null, lessons: marks.length, backfilled: marks.filter((m) => m.bf).length };
}

function summary() {
  const list = Object.values(sessions);
  return {
    sessions: list.length,
    persistent,
    corruptAt,
    graduatedSids: list.filter((s) => s.wallet).length,
    backfillSunset: new Date(BACKFILL_SUNSET).toISOString().slice(0, 10),
  };
}

module.exports = { mark, evaluate, bindWallet, statusFor, summary, flush: persist };
