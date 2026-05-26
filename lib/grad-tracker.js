// Our OWN Bags graduation tracker, persisted on the Railway volume.
//
// Why this exists: ST's /tokens/multi/graduated is one global "latest ~100
// graduations across ALL launchpads" list, and pump.fun floods it (we measured
// ~92/100), so Bags graduations fall out of that window almost immediately —
// filtering it for Bags reliably finds nothing. Instead we WATCH Bags tokens as
// they approach bonding (from the near-grad scan), and when a watched token
// actually graduates we record it HERE with a timestamp. The /bags Recently
// Graduated board then reads our own 48h record, independent of pump.fun volume.
//
// Two collections:
//   watch:      mint -> { symbol, name, image, twitter, firstSeenTs, lastSeenTs,
//                         lastCurvePct, alerted }   (tokens near bonding we're tracking)
//   graduated:  [ { mint, symbol, name, image, twitter, graduatedAt, marketCap,
//                   priceUsd } ]   (confirmed Bags graduations, pruned to 48h)
// File-backed at /data/grad-tracker.json; degrades to in-memory if no volume.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "grad-tracker.json");
const RETAIN_MS = 48 * 60 * 60 * 1000; // keep graduations for 48h

let state = { watch: {}, graduated: [] };
let persistent = false;

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && o.watch && Array.isArray(o.graduated)) state = o;
    }
    console.log(`[grad-tracker] ${Object.keys(state.watch).length} watched, ${state.graduated.length} graduated (loaded from ${FILE})`);
  } catch (e) {
    console.warn(`[grad-tracker] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

function persist() {
  if (!persistent) return;
  try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { console.warn(`[grad-tracker] persist failed: ${e.message}`); }
}

function pruneGraduated() {
  const cut = Date.now() - RETAIN_MS;
  // Pinned entries (manually-seeded real graduates) never expire; organic
  // captures drop off after 48h.
  state.graduated = state.graduated.filter(g => g.pinned || (g.graduatedAt || 0) >= cut);
}

module.exports = {
  getWatch: (m) => state.watch[m] || null,
  setWatch: (m, d) => { state.watch[m] = { ...(state.watch[m] || {}), ...d }; persist(); },
  removeWatch: (m) => { if (state.watch[m]) { delete state.watch[m]; persist(); } },
  watchedMints: () => Object.keys(state.watch),
  // Add a confirmed graduation (dedup by mint), keep newest-first, prune to 48h.
  addGraduated: (rec) => {
    if (!rec || !rec.mint) return false;
    const i = state.graduated.findIndex(g => g.mint === rec.mint);
    if (i >= 0) state.graduated[i] = { ...state.graduated[i], ...rec }; // update-or-insert (allows re-seeding)
    else state.graduated.unshift(rec);
    pruneGraduated();
    persist();
    return true;
  },
  listGraduated: () => { pruneGraduated(); return state.graduated.slice(); },
  isPersistent: () => persistent,
};
