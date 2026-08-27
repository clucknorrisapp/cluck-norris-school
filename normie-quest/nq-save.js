// nq-save.js — cross-device cloud save for Normie Quest, keyed by VERIFIED wallet.
//
// The game banks a checkpoint per world (registry nqCp) and per level (nqLvlCp — the tier-2/VIP
// resume perk). Those were in-memory only, then mirrored to localStorage (2026-08-27) — which is
// per-browser, per-origin. This is the piece that makes progress FOLLOW THE PLAYER: connect the
// same wallet on a phone and a desktop and both resume from the furthest point reached anywhere.
//
// SECURITY MODEL: the wallet address is only the filing key, and every read AND write requires the
// nq-wallet session token (sign-message ownership proof, checked by the route with checkSession) —
// nobody can read or poison another player's save. The VALUES are still client-reported: this is a
// bookmark for where a run resumes, not a prize input. Nothing here feeds the leaderboard, rewards,
// or claims — those stay run-token-gated. Worst case of a self-forged save is skipping your own
// levels in a game whose world access is separately gated by live holdings (nqWorldAllowed clamps
// the resume READ client-side, and world entry re-checks the tier server-config regardless).
//
// MERGE RULE — furthest-reached wins, per checkpoint PAIR (index + its score travel together):
// a stale device syncing old numbers can never rewind a save, and "NEW GAME" on one device never
// deletes the bank another device still wants. Saves only ever advance.
//
// Durable in /data (survives redeploys), same store convention as nq-ledger.js / nq-rewards.js.

const fs = require('fs');
const path = require('path');

function storePath() { return path.join(process.env.DATA_DIR || '/data', 'nq-saves.json'); }
function load() {
  try { const o = JSON.parse(fs.readFileSync(storePath(), 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch (e) { return {}; }
}
function persist(o) { try { require('../lib/atomic-write').atomicWriteFileSync(storePath(), JSON.stringify(o)); return true; } catch (e) { return false; } }

// Level indexes are clamped to a generous ceiling, not to today's LEVELS.length — the server does
// not load the level data, and the CLIENT already degrades an out-of-range index to "no save".
const MAX_LEVEL = 999, MAX_SCORE = 99999999;
function ci(v, max) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; }
function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  return { cp: ci(s.cp, MAX_LEVEL), cpScore: ci(s.cpScore, MAX_SCORE),
           lvlCp: ci(s.lvlCp, MAX_LEVEL), lvlCpScore: ci(s.lvlCpScore, MAX_SCORE) };
}

// Read a wallet's save. Never throws. null = nothing banked.
function get(wallet) {
  const r = load()[String(wallet || '')];
  if (!r) return null;
  const s = normalize(r);
  return (s.cp || s.lvlCp) ? { ...s, at: Number(r.at) || 0 } : null;
}

// Merge an incoming save (furthest-reached per pair) and persist. Returns the merged save.
// Idempotent: replaying the same body is a no-op beyond the timestamp.
function put(wallet, incoming) {
  const w = String(wallet || '');
  const inc = normalize(incoming);
  const store = load();
  const cur = normalize(store[w]);
  const merged = {
    cp: cur.cp, cpScore: cur.cpScore, lvlCp: cur.lvlCp, lvlCpScore: cur.lvlCpScore,
  };
  if (inc.cp > cur.cp) { merged.cp = inc.cp; merged.cpScore = inc.cpScore; }
  if (inc.lvlCp > cur.lvlCp) { merged.lvlCp = inc.lvlCp; merged.lvlCpScore = inc.lvlCpScore; }
  if (!(merged.cp || merged.lvlCp)) return null;   // nothing banked on either side — store nothing
  merged.at = Date.now();
  store[w] = merged;
  persist(store);
  return merged;
}

module.exports = { get, put };
