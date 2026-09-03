// Per-wallet credential store, backed by the Railway volume at /data.
// The school's first PERMANENT output: when a learner passes the Ultimate
// Challenge or finishes the whole curriculum and submits a Solana address,
// we record it here keyed by wallet so it survives deploys and powers a
// permanent, shareable transcript page (and aggregate school metrics).
//
// Same graceful-degradation pattern as lib/kvstore.js / lib/sigstore.js: if the
// volume isn't mounted/writable (e.g. local dev) it runs in-memory only and
// never crashes — it just won't persist across restarts in that case.
//
// This store is also the keystone the rest of the school's stateful features
// hang off of (e.g. a future per-wallet "watch" list), so it stays generic.
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "credentials.json");

let byWallet = {};   // wallet -> record
let bySlug = {};     // slug   -> wallet (rebuilt from byWallet on load)
let persistent = false;
// Why persistence is off, when it is. null = persisting normally. "no-volume" is the benign
// local-dev case; "corrupt" is an OPERATOR EMERGENCY — see health() and the load() note below.
let degraded = null;
let lastPersistError = null;

// Stable, non-sequential public id derived from the wallet. Deterministic so a
// repeat claim maps to the same transcript URL; the wallet is public anyway, so
// the hybrid slug+wallet lookup is intentional (clean URL, still verifiable).
function slugFor(wallet) {
  return "clkn-" + createHash("sha256").update("transcript:" + wallet).digest("hex").slice(0, 10);
}

(function load() {
  // Reaching a writable volume and PARSING the existing file are two distinct steps (same
  // bug class as lib/sigstore.js). The old code set persistent=true and then parsed inside
  // the same try, so a CORRUPT existing file left persistent true with byWallet={} — and the
  // next record() (any /api/claim) then OVERWROTE the file with just that one new transcript,
  // destroying every other learner's transcript with no other copy anywhere. Split the steps
  // and fail closed on corruption.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
  } catch (e) {
    degraded = "no-volume";
    console.warn(`[credentials] volume unavailable (${e.message}) — running in-memory only`);
    return;
  }
  if (!fs.existsSync(FILE)) { console.log(`[credentials] no existing transcript file — starting fresh at ${FILE}`); return; }
  try {
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not a JSON object");
    byWallet = o;
    for (const w of Object.keys(byWallet)) {
      const slug = byWallet[w] && byWallet[w].slug;
      if (slug) bySlug[slug] = w;
    }
    console.log(`[credentials] loaded ${Object.keys(byWallet).length} transcripts from ${FILE}`);
  } catch (e) {
    // CORRUPT existing file. Do NOT silently start empty (the next record() would overwrite
    // it). Quarantine a copy and DISABLE persistence so record() stays in-memory-only until
    // an operator restores the file — this store has no other copy anywhere.
    persistent = false;
    degraded = "corrupt";
    try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (_) {}
    console.error(`[credentials] TRANSCRIPT FILE CORRUPT (${e.message}) — persistence DISABLED (fail-closed). Restore ${FILE} from a good copy, then restart.`);
  }
})();

function persist() {
  if (!persistent) return false;
  try { require("./atomic-write").atomicWriteFileSync(FILE, JSON.stringify(byWallet)); lastPersistError = null; return true; }
  catch (e) { lastPersistError = e.message; console.warn(`[credentials] persist failed: ${e.message}`); return false; }
}

// Is a transcript written right now actually going to survive a redeploy? /api/claim spends
// treasury SOL on a diploma mint and hands the learner a "permanent" /transcript/<slug> URL;
// when this says ok:false that URL dies at the next deploy and the SOL is spent for nothing,
// so the claim path must refuse the mint (or warn) rather than fail silently. `reason` is
// "corrupt" (operator emergency — restore the quarantined file), "no-volume" (local dev), or
// "write-failed" (the volume went read-only / full after boot).
function health() {
  const reason = degraded || (lastPersistError ? "write-failed" : null);
  return { ok: persistent && !lastPersistError, persistent, reason, detail: lastPersistError || null };
}

// Record an achievement against a wallet. `kind` is "challenge" or "graduation".
// Merges into any existing record so a learner who both passes the exam AND
// finishes the curriculum keeps both badges. Returns the record (with slug).
function record(wallet, { kind, score, total, pct, verified, isHolder, balance, coursework } = {}) {
  const now = new Date().toISOString();
  let rec = byWallet[wallet];
  if (!rec) {
    const slug = slugFor(wallet);
    rec = { wallet, slug, createdAt: now, updatedAt: now, diploma: null, graduation: null, holder: null, coursework: null, ownership: null };
    byWallet[wallet] = rec;
    bySlug[slug] = wallet;
  }
  rec.updatedAt = now;
  if (kind === "challenge") {
    // Keep the best attempt if the exam is re-taken.
    if (!rec.diploma || (pct || 0) >= (rec.diploma.pct || 0)) {
      rec.diploma = { passed: true, score, total, pct, verified: verified || "self-reported", at: now };
    }
  } else if (kind === "graduation") {
    rec.graduation = { completed: true, at: (rec.graduation && rec.graduation.at) || now };
  }
  if (typeof balance === "number") {
    rec.holder = { isHolder: !!isHolder, balance, at: now };
  }
  if (coursework && typeof coursework === "object") {
    // Max-merge so a claim from a fresh browser (less progress) never erases
    // coursework already recorded for this wallet. Counts are clamped to totals.
    const cur = rec.coursework || {};
    const track = (count, total, curCount, curTotal) => {
      const t = Math.max(0, Math.floor(Number(total) || Number(curTotal) || 0));
      const c = Math.max(Math.floor(Number(count) || 0), Math.floor(Number(curCount) || 0));
      return { count: t ? Math.min(c, t) : c, total: t };
    };
    const belts = track(coursework.belts, coursework.beltsTotal, cur.belts && cur.belts.count, cur.belts && cur.belts.total);
    const incubator = track(coursework.incubator, coursework.incubatorTotal, cur.incubator && cur.incubator.count, cur.incubator && cur.incubator.total);
    const lpLab = track(coursework.lpLab, coursework.lpLabTotal, cur.lpLab && cur.lpLab.count, cur.lpLab && cur.lpLab.total);
    rec.coursework = { belts, incubator, lpLab, at: now };
  }
  persist();
  return rec;
}

function getByWallet(w) { return byWallet[w] || null; }
function getBySlug(s) { return bySlug[s] ? byWallet[bySlug[s]] : null; }
function resolve(idOrSlug) { return getBySlug(idOrSlug) || getByWallet(idOrSlug); }

// Mark that the transcript's wallet was proven (Tier-2). `method` is "payment".
function setOwnership(wallet, method) {
  const rec = byWallet[wallet];
  if (!rec) return null;
  rec.ownership = { verified: true, method: method || "payment", at: new Date().toISOString() };
  rec.updatedAt = rec.ownership.at;
  persist();
  return rec;
}

// Aggregate, judge-facing metrics. No raw wallets in the recent list — only a
// truncated form — so the public stats endpoint doesn't dump the full list.
function stats() {
  const list = Object.values(byWallet);
  const diplomas = list.filter(r => r.diploma && r.diploma.passed);
  const recent = [...list]
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, 10)
    .map(r => ({
      slug: r.slug,
      wallet: r.wallet.slice(0, 4) + "…" + r.wallet.slice(-4),
      diploma: r.diploma ? { pct: r.diploma.pct, verified: r.diploma.verified } : null,
      graduated: !!(r.graduation && r.graduation.completed),
      at: r.updatedAt,
    }));
  return {
    totalTranscripts: list.length,
    diplomas: diplomas.length,
    verifiedDiplomas: diplomas.filter(r => r.diploma.verified === "server-scored").length,
    graduates: list.filter(r => r.graduation && r.graduation.completed).length,
    holders: list.filter(r => r.holder && r.holder.isHolder).length,
    recent,
    // Surfaced so a degraded store is visible on the existing stats endpoint instead of
    // living only in a console.error nothing watches.
    storeHealthy: health().ok,
  };
}

module.exports = { record, setOwnership, getByWallet, getBySlug, resolve, stats, all: () => Object.values(byWallet), isPersistent: () => persistent, health };
