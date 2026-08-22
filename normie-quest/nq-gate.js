// Normie Quest — ACCESS GATE (launch cap + free tier). One source of truth for "how far can
// this player go", read by nq-wallet (tier grants) and published to the client via
// /api/nq/wallet/config so the game's nqWorldAllowed() enforces the same numbers.
//
// WHY THIS EXISTS (owner, 2026-08-22 — public launch day): the game goes live with worlds 1-3
// open to EVERYONE, and nothing beyond that for anyone — even holders — for the first few days.
// Then the cap lifts and the higher worlds open to holders on terms the owner sets separately.
// That "first few days" switch has to be flippable in seconds from a phone, with no redeploy,
// so the state lives on the /data volume with env vars as the boot default.
//
// THREE KNOBS:
//   on      master switch. false = NO gating at all, the whole game is free to everyone
//           (exactly how the public build behaved before launch day). Panic switch.
//   freeMax highest world playable with no wallet connected            (launch: 3)
//   cap     HARD ceiling applied to EVERY tier incl. holders + VIP.    (launch: 3)
//           0 = no cap, tiers apply normally. This is the "open the higher worlds" lever:
//           set cap=0 and holders immediately get their tier's worlds.
//
// Env boot defaults (Railway):  NQ_GATE_ON, NQ_GATE_FREE_MAX, NQ_GATE_CAP
// Live override (no redeploy):  GET /api/nq/gate?key=<PREMIUM_ACCESS_KEY>&cap=0
//
// ⚠️ TERMS: this module decides HOW FAR, never WHAT YOU MUST HOLD. Thresholds stay in nq-wallet
// (env-tunable) and are deliberately not published anywhere public — NQ's holder terms are still
// unagreed with the NORMIE team (CLAUDE.md), so no surface here may promise an unlock price.

const fs = require('fs');
const path = require('path');

function statePath() { return path.join(process.env.DATA_DIR || '/data', 'nq-gate.json'); }

function bool(v, d) {
  if (v == null || v === '') return d;
  return /^(1|true|yes|on)$/i.test(String(v));
}
function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; }

// Boot defaults from env. Launch day ships gate ON, free 1-3, cap 3 — but only because the env
// says so; an unset env keeps the pre-launch behaviour (open game) so a fresh deploy of this
// module can never silently lock a running game.
function envDefaults() {
  return {
    on: bool(process.env.NQ_GATE_ON, false),
    freeMax: int(process.env.NQ_GATE_FREE_MAX, 3),
    cap: int(process.env.NQ_GATE_CAP, 0),
  };
}

let _cache = null, _cacheAt = 0;
const CACHE_MS = 5000;   // the client polls this on every launch; don't stat the volume per hit

function readOverride() {
  try {
    const o = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return (o && typeof o === 'object') ? o : null;
  } catch (e) { return null; }
}

// Current effective state = env defaults, with any live override on top.
function state(force) {
  const now = Date.now();
  if (!force && _cache && (now - _cacheAt) < CACHE_MS) return _cache;
  const d = envDefaults();
  const o = readOverride();
  const s = {
    on: (o && o.on != null) ? !!o.on : d.on,
    freeMax: (o && o.freeMax != null) ? int(o.freeMax, d.freeMax) : d.freeMax,
    cap: (o && o.cap != null) ? int(o.cap, d.cap) : d.cap,
    source: o ? 'override' : 'env',
    updatedAt: (o && o.updatedAt) || null,
  };
  _cache = s; _cacheAt = now;
  return s;
}

// Write a live override. Only the keys passed are changed; the rest keep their current value.
function setState(patch) {
  const cur = state(true);
  const next = {
    on: patch.on != null ? !!patch.on : cur.on,
    freeMax: patch.freeMax != null ? int(patch.freeMax, cur.freeMax) : cur.freeMax,
    cap: patch.cap != null ? int(patch.cap, cur.cap) : cur.cap,
    updatedAt: Date.now(),
  };
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  require('../lib/atomic-write').atomicWriteFileSync(statePath(), JSON.stringify(next));
  _cache = null;   // force re-read on next state()
  return state(true);
}

// Drop the override entirely and fall back to the env defaults.
function clearOverride() {
  try { fs.unlinkSync(statePath()); } catch (e) {}
  _cache = null;
  return state(true);
}

// ---- the actual gate ------------------------------------------------------
// Clamp a tier's world grant by the launch cap. `worlds` is the nq-wallet shape:
//   'all'  -> every world        |  [lo,hi] -> an inclusive world range
// Returns the same shape. With the gate OFF this is always 'all' — no tier can lock anything.
function clamp(worlds) {
  const s = state();
  if (!s.on) return 'all';
  if (!s.cap) return worlds;                      // no launch cap: tiers apply as-is
  if (worlds === 'all') return [1, s.cap];
  if (Array.isArray(worlds) && worlds.length === 2) return [worlds[0], Math.min(worlds[1], s.cap)];
  return [1, s.cap];
}

// What a wallet-less player gets. Also the client's fallback when no wallet is connected.
function freeWorlds() {
  const s = state();
  if (!s.on) return 'all';
  return clamp([1, s.freeMax]);
}

// Secret-free view for the client. NO thresholds, NO prices, NO unlock terms — just structure.
function publicState() {
  const s = state();
  return { on: s.on, freeMax: s.freeMax, cap: s.cap };
}

module.exports = { state, setState, clearOverride, clamp, freeWorlds, publicState, statePath };
