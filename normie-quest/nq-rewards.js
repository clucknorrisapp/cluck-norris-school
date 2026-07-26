// Normie Quest — wallet-bound REWARD store (the premium-perk backbone).
//
// Winnings (from the VIP daily wheel, owner grants, leaderboard airdrops) are queued PER WALLET
// as pending game-boost items. The game client claims them one at a time into the player's Item
// Reserve on their next login — so a prize won on the lounge wheel shows up in-game on ANY device.
//
// These are IN-GAME items (disc / vial / shield), NOT tokens: no funds move, nothing to sign, no
// hot wallet, no anti-dump problem. Pure retention value. If token payouts are ever added they
// go through the owner-signed airdropper, never this file.
//
// Store: /data/nq-rewards.json  { pending: { <wallet>:[item,...] }, spins: { <wallet>:"YYYY-MM-DD" } }

const fs = require('fs');
const path = require('path');

// Valid grantable items — MIRRORS RESERVE_ITEMS in the game. An id here that the game does not
// know is granted, queued, delivered, and then silently dropped by the client's unknown-id filter,
// so this list has to move whenever that one does. ('clock' was removed 2026-07-26.)
const ITEMS = { disc: 1, vial: 1, shield: 1, star: 1, bomb: 1 };
const MAX_PENDING = 20;                                  // cap a wallet's queue so it can't grow unbounded
// Wheel prize tables — EVERY spin wins something (loyalty program, not a lottery). Weighted.
// Two tables: the free daily spin is open to any verified wallet, VIP gets the better odds AND
// the bonus windows. Same three items in both, because the wheel graphic is a fixed 3-wedge
// conic gradient — adding star/bomb to the VIP table means rebuilding that graphic first.
const WHEEL_VIP = [
  { item: 'disc', weight: 40 },
  { item: 'vial', weight: 35 },
  { item: 'shield', weight: 25 },
];
// Weighted toward the weakest item (+5 ammo) and away from the two strong ones (full heal,
// audit shield), so the VIP table is a visible upgrade rather than a cosmetic one.
const WHEEL_FREE = [
  { item: 'disc', weight: 70 },
  { item: 'vial', weight: 22 },
  { item: 'shield', weight: 8 },
];
const WHEEL = WHEEL_VIP;   // kept so any existing reference still resolves to the VIP table
function wheelFor(vip) { return vip ? WHEEL_VIP : WHEEL_FREE; }

function storePath() { return path.join(process.env.DATA_DIR || '/data', 'nq-rewards.json'); }
function load() {
  try { const o = JSON.parse(fs.readFileSync(storePath(), 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch (e) { return {}; }
}
function save(o) { try { fs.writeFileSync(storePath(), JSON.stringify(o)); return true; } catch (e) { return false; } }
function utcDay(ts) { return new Date(ts == null ? Date.now() : ts).toISOString().slice(0, 10); }

// ---- pending queue ------------------------------------------------------
function grant(wallet, item, nowMs) {
  const w = String(wallet || '');
  if (!w || !ITEMS[item]) return { ok: false, error: 'bad_grant' };
  const s = load();
  s.pending = s.pending || {};
  const q = (s.pending[w] = s.pending[w] || []);
  if (q.length >= MAX_PENDING) return { ok: false, error: 'queue_full', pending: q.length };
  q.push(item);
  save(s);
  return { ok: true, item, pending: q.length };
}
function pendingCount(wallet) {
  const s = load(); const q = (s.pending && s.pending[String(wallet || '')]) || []; return q.length;
}
// Claim ONE item (the reserve holds one at a time); the client grants it and calls again when free.
function claimOne(wallet) {
  const w = String(wallet || '');
  const s = load();
  const q = (s.pending && s.pending[w]) || [];
  if (!q.length) return { ok: true, item: null, pending: 0 };
  const item = q.shift();
  if (!q.length) delete s.pending[w];
  save(s);
  return { ok: true, item, pending: q.length };
}

// ---- daily wheel --------------------------------------------------------
function canSpin(wallet, nowMs) {
  const s = load(); const last = (s.spins && s.spins[String(wallet || '')]) || null;
  return last !== utcDay(nowMs);
}
function nextSpinAt(nowMs) {
  const d = new Date(nowMs == null ? Date.now() : nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);   // next UTC midnight
}

// ---- BONUS SPINS (the "extra daily spin, given out a few times a day") --------------------
// A few 1-hour "happy hour" windows per UTC day. During a window a VIP who has already used
// their daily spin gets ONE extra spin. Entirely clock-driven — no scheduler/cron needed, so it
// survives container resets. One bonus per window per wallet (tracked in s.bonus[wallet]).
const BONUS_SPIN_HOURS = [12, 18, 22];              // UTC window START hours (each lasts 1h)
function bonusWindowKey(nowMs) {                    // "YYYY-MM-DD:H" for the active window, else null
  const d = new Date(nowMs == null ? Date.now() : nowMs);
  if (BONUS_SPIN_HOURS.indexOf(d.getUTCHours()) < 0) return null;
  return utcDay(nowMs) + ':' + d.getUTCHours();
}
function bonusAvailable(wallet, nowMs) {             // window open AND this wallet hasn't taken THIS window
  const win = bonusWindowKey(nowMs); if (!win) return false;
  const s = load(); const last = (s.bonus && s.bonus[String(wallet || '')]) || null;
  return last !== win;
}
function nextBonusAt(nowMs) {                        // start of the next bonus window (UTC)
  const base = nowMs == null ? Date.now() : nowMs;
  const d = new Date(base);
  for (let add = 1; add <= 48; add++) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + add, 0, 0, 0);
    if (BONUS_SPIN_HOURS.indexOf(new Date(t).getUTCHours()) >= 0) return t;
  }
  return base + 3600000;
}
// Either kind of spin is available right now (daily OR an open bonus window this wallet hasn't used).
function canSpinNow(wallet, nowMs) { return canSpin(wallet, nowMs) || bonusAvailable(wallet, nowMs); }
function pickPrize(vip) {
  const table = wheelFor(vip);
  const total = table.reduce((n, p) => n + p.weight, 0);
  // crypto-strong pick (server-authoritative; every spin wins, odds published below)
  let r = (require('crypto').randomInt(0, total));
  for (const p of table) { if (r < p.weight) return p.item; r -= p.weight; }
  return table[0].item;
}
function spin(wallet, nowMs, opts) {
  const w = String(wallet || '');
  if (!w) return { ok: false, error: 'no_wallet' };
  const vip = !!(opts && opts.vip);
  const daily = canSpin(w, nowMs);
  // Bonus windows stay a VIP perk; a free wallet gets the once-a-day spin only.
  const bonus = !daily && vip && bonusAvailable(w, nowMs);
  if (!daily && !bonus) return { ok: false, error: 'already_spun', nextSpinAt: nextSpinAt(nowMs), nextBonusAt: nextBonusAt(nowMs) };
  const item = pickPrize(vip);
  const g = grant(w, item, nowMs);
  if (!g.ok) return { ok: false, error: g.error, nextSpinAt: nextSpinAt(nowMs) };
  const s = load();
  if (daily) { s.spins = s.spins || {}; s.spins[w] = utcDay(nowMs); }
  else { s.bonus = s.bonus || {}; s.bonus[w] = bonusWindowKey(nowMs); }
  save(s);
  return { ok: true, prize: item, bonus: !!bonus, pending: g.pending, nextSpinAt: nextSpinAt(nowMs), nextBonusAt: nextBonusAt(nowMs), bonusAvailable: bonusAvailable(w, nowMs) };
}
// Published odds (shown on the wheel — provably-honest since it's server-authoritative + declared).
function odds(vip) {
  const table = wheelFor(vip);
  const total = table.reduce((n, p) => n + p.weight, 0);
  return table.map((p) => ({ item: p.item, pct: Math.round((p.weight / total) * 100) }));
}

module.exports = { grant, pendingCount, claimOne, canSpin, nextSpinAt, spin, odds, ITEMS, wheelFor,
  bonusAvailable, nextBonusAt, canSpinNow, bonusWindowKey, BONUS_SPIN_HOURS };
