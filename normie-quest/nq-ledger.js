// nq-ledger.js — off-chain per-wallet points ledger for the Normie Cash rewards economy.
//
// This is the bookkeeping layer only: NO tokens, NO treasury, NO on-chain anything. It tracks a
// soft points balance per wallet so players can earn (wheel, loot boxes, level clears) and later
// spend (power-ups, draw entries) or — eventually, in a separate owner-signed step — cash out.
//
// SECURITY MODEL (the important part): the wallet address is only the filing key. Callers MUST pass
// a SERVER-DECIDED `amount` and a unique `eventId` — never a client-reported number. `credit()` is
// idempotent on `eventId`, so a replay/double-tap can't double-credit, and it enforces optional
// per-wallet daily/lifetime caps to bound multi-wallet farming. The anti-cheat lives in the CALLER
// (only credit from server-authoritative events: the wheel roll, a run-token-gated loot/clear) —
// this module guarantees the accounting is honest once a legitimate amount reaches it.
//
// Durable in /data (survives redeploys), same store convention as nq-rewards.js.

const fs = require('fs');
const path = require('path');

function storePath() { return path.join(process.env.DATA_DIR || '/data', 'nq-ledger.json'); }
function load() {
  try { const o = JSON.parse(fs.readFileSync(storePath(), 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch (e) { return {}; }
}
function save(o) { try { fs.writeFileSync(storePath(), JSON.stringify(o)); return true; } catch (e) { return false; } }
function utcDay(ts) { return new Date(ts == null ? Date.now() : ts).toISOString().slice(0, 10); }

const HISTORY_MAX = 200;          // per-wallet: keep the most recent N events (bounds file growth)
function envInt(name) { const n = parseInt(process.env[name] || '', 10); return Number.isFinite(n) && n >= 0 ? n : 0; }
function dailyCap() { return envInt('NQ_LEDGER_DAILY_CAP'); }       // 0 = no daily cap
function lifetimeCap() { return envInt('NQ_LEDGER_LIFETIME_CAP'); } // 0 = no lifetime cap

function rec(store, w) {
  let r = store[w];
  if (!r) r = store[w] = { balance: 0, earnedTotal: 0, spentTotal: 0, claimed: {}, day: '', dayEarned: 0, history: [] };
  return r;
}
function trim(r) { if (r.history.length > HISTORY_MAX) r.history = r.history.slice(-HISTORY_MAX); }

// Read a wallet's balance (+ lifetime totals). Never throws.
function balance(wallet) {
  const r = load()[wallet];
  return r ? { balance: r.balance, earnedTotal: r.earnedTotal || 0, spentTotal: r.spentTotal || 0 }
           : { balance: 0, earnedTotal: 0, spentTotal: 0 };
}

// Most-recent events for a wallet (for the in-game history / audit view).
function history(wallet, n) {
  const r = load()[wallet];
  if (!r) return [];
  return (r.history || []).slice(-Math.max(1, Math.min(HISTORY_MAX, n || 25)));
}

// Credit SERVER-DECIDED points. Idempotent on eventId. amount is trusted to be server-authoritative.
// Returns { ok, credited, balance, already?, capped? }.
function credit(wallet, opts) {
  opts = opts || {};
  const amount = Math.floor(Number(opts.amount) || 0);
  const eventId = opts.eventId;
  if (!wallet || !eventId || amount <= 0) return { ok: false, reason: 'bad_args' };
  const s = load();
  const r = rec(s, wallet);
  if (Object.prototype.hasOwnProperty.call(r.claimed, eventId)) {
    return { ok: true, credited: 0, already: true, balance: r.balance };   // idempotent — already counted
  }
  const today = utcDay(opts.nowMs);
  if (r.day !== today) { r.day = today; r.dayEarned = 0; }
  let grant = amount;
  const dcap = dailyCap();
  if (dcap > 0) grant = Math.min(grant, Math.max(0, dcap - r.dayEarned));
  const lcap = lifetimeCap();
  if (lcap > 0) grant = Math.min(grant, Math.max(0, lcap - (r.earnedTotal || 0)));
  // Record the claim either way so idempotency is stable; only move points when grant > 0.
  r.claimed[eventId] = grant;
  if (grant > 0) {
    r.balance += grant; r.earnedTotal = (r.earnedTotal || 0) + grant; r.dayEarned += grant;
    r.history.push({ id: eventId, kind: String(opts.kind || 'earn'), amount: grant, ts: (opts.nowMs == null ? Date.now() : opts.nowMs) });
    trim(r);
  }
  save(s);
  return { ok: true, credited: grant, capped: grant < amount, balance: r.balance };
}

// Deduct points (spending on power-ups / draw entries). Balance-checked. reason is a label.
// Returns { ok, spent, balance } or { ok:false, reason:'insufficient', balance }.
function spend(wallet, amount, reason) {
  amount = Math.floor(Number(amount) || 0);
  if (!wallet || amount <= 0) return { ok: false, reason: 'bad_args' };
  const s = load();
  const r = s[wallet];
  if (!r || r.balance < amount) return { ok: false, reason: 'insufficient', balance: r ? r.balance : 0 };
  r.balance -= amount; r.spentTotal = (r.spentTotal || 0) + amount;
  r.history.push({ id: 'spend:' + String(reason || 'item') + ':' + Date.now(), kind: 'spend', amount: -amount, ts: Date.now() });
  trim(r);
  save(s);
  return { ok: true, spent: amount, balance: r.balance };
}

module.exports = { balance, history, credit, spend };
