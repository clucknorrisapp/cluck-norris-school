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

// Stable, non-sequential public id derived from the wallet. Deterministic so a
// repeat claim maps to the same transcript URL; the wallet is public anyway, so
// the hybrid slug+wallet lookup is intentional (clean URL, still verifiable).
function slugFor(wallet) {
  return "clkn-" + createHash("sha256").update("transcript:" + wallet).digest("hex").slice(0, 10);
}

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && typeof o === "object") {
        byWallet = o;
        for (const w of Object.keys(byWallet)) {
          const slug = byWallet[w] && byWallet[w].slug;
          if (slug) bySlug[slug] = w;
        }
      }
    }
    console.log(`[credentials] loaded ${Object.keys(byWallet).length} transcripts from ${FILE}`);
  } catch (e) {
    console.warn(`[credentials] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

function persist() {
  if (!persistent) return;
  try { fs.writeFileSync(FILE, JSON.stringify(byWallet)); }
  catch (e) { console.warn(`[credentials] persist failed: ${e.message}`); }
}

// Record an achievement against a wallet. `kind` is "challenge" or "graduation".
// Merges into any existing record so a learner who both passes the exam AND
// finishes the curriculum keeps both badges. Returns the record (with slug).
function record(wallet, { kind, score, total, pct, verified, isHolder, balance, coursework } = {}) {
  const now = new Date().toISOString();
  let rec = byWallet[wallet];
  if (!rec) {
    const slug = slugFor(wallet);
    rec = { wallet, slug, createdAt: now, updatedAt: now, diploma: null, graduation: null, holder: null, coursework: null };
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
  };
}

module.exports = { record, getByWallet, getBySlug, resolve, stats, slugFor, isPersistent: () => persistent };
