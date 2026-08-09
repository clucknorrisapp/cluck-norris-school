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
// the bonus windows. The lounge wheel DRAWS ITSELF from these percentages (SVG, wedge per entry,
// sized by the real odds — since 2026-08-02; the old graphic was a fixed 3-wedge gradient), so a
// prize added here appears on the wheel by itself. Keep entries in ITEMS/RESERVE_ITEMS or the
// grant is silently dropped client-side — that rule hasn't moved.
// The 'preview' wedge is a VIP-only prize: a Preview Pass — time-limited access to the hidden
// world that's featured on the wheel this rotation (see PREVIEW_ROOMS below). It is NOT a reserve
// item, so spin() special-cases it (grantPass, not grant) and it never enters the ITEMS queue.
// It IS in the published odds, so the wheel stays provably-honest — the pass is the declared prize,
// the "hidden prizes" are the bonus pickups waiting inside the preview world itself.
const WHEEL_VIP = [
  { item: 'disc', weight: 28 },
  { item: 'vial', weight: 24 },
  { item: 'shield', weight: 18 },
  { item: 'bomb', weight: 14 },     // 🚀 Air Strike — a real reserve item, banked like disc/vial/shield
  { item: 'preview', weight: 8 },   // 🎟️ Preview Pass — a hidden-world unlock (grantPass, not the queue)
  { item: 'raffle', weight: 8 },    // 🎫 Drawing Entry — an off-chain raffle ticket (owner runs the draw)
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

// ---- 🎟️ PREVIEW PASSES — the VIP wheel's hidden-world unlock -----------------------------
// A Preview Pass grants time-limited access to the ONE hidden world featured this rotation. The
// featured world rotates on a fixed weekly, UTC-anchored cadence (no scheduler — clock-derived, so
// it survives container resets, same trick as the bonus windows). A won pass is good for 48h from
// the win. Passes are an ACCESS grant surfaced in the lounge, not an in-game inventory item — no
// funds, nothing to sign. The `room` matches a private level's name (?room=beach loads it), so the
// unlisted link stays the only door and the pass is how a VIP learns today's room + gets a play link.
const PREVIEW_ROOMS = [
  { room: 'beach', label: 'The Shallows', emoji: '🦈' },
  { room: 'sandcastle', label: 'The Sandcastle Keep', emoji: '🏰' },
];
const PREVIEW_TTL_MS = 48 * 3600 * 1000;             // a won pass lasts 48h
const PREVIEW_ROTATE_MS = 7 * 24 * 3600 * 1000;      // the featured world rotates weekly
function previewRoom(nowMs) {
  const t = nowMs == null ? Date.now() : nowMs;
  return PREVIEW_ROOMS[Math.floor(t / PREVIEW_ROTATE_MS) % PREVIEW_ROOMS.length];
}
function grantPass(wallet, nowMs) {
  const w = String(wallet || ''); if (!w) return { ok: false, error: 'no_wallet' };
  const t = nowMs == null ? Date.now() : nowMs;
  const pr = previewRoom(t);
  const s = load(); s.passes = s.passes || {};
  s.passes[w] = { room: pr.room, label: pr.label, emoji: pr.emoji, expires: t + PREVIEW_TTL_MS };
  save(s);
  return { ok: true, room: pr.room, label: pr.label, emoji: pr.emoji, expires: s.passes[w].expires };
}
function activePass(wallet, nowMs) {
  const t = nowMs == null ? Date.now() : nowMs;
  const s = load(); const p = s.passes && s.passes[String(wallet || '')];
  if (!p || !p.expires || p.expires <= t) return null;
  return { room: p.room, label: p.label, emoji: p.emoji, expires: p.expires };
}

// ---- 🎫 DRAWING ENTRIES — an off-chain raffle ticket won on the wheel -----------------------
// Landing the 'raffle' wedge banks ONE entry to the wallet's running total. Entries are just a
// count (s.raffle[wallet]) — the owner runs the actual draw manually and announces it in the feed,
// exactly like the giveaways already posted there. No funds move here and nothing is promised on a
// public surface; this only records "you're in." A prize/payout, if any, is a separate owner action.
function addRaffleEntry(wallet) {
  const w = String(wallet || ''); if (!w) return { ok: false, error: 'no_wallet' };
  const s = load(); s.raffle = s.raffle || {};
  s.raffle[w] = (s.raffle[w] || 0) + 1;
  save(s);
  return { ok: true, entries: s.raffle[w] };
}
function raffleEntries(wallet) {
  const s = load(); return (s.raffle && s.raffle[String(wallet || '')]) || 0;
}

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
  // Pop past any RETIRED id. Queues are durable on /data, so an item removed from the game after a
  // grant was banked (e.g. 'clock' on 2026-07-26) sits there forever: claimOne would hand it over,
  // the client's unknown-id guard would refuse it, and the player would silently lose a prize they
  // were owed with no way to see why. Skipping them here drains the dead entries instead.
  let item = null;
  while (q.length) { const c = q.shift(); if (ITEMS[c]) { item = c; break; } }
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
  // 🎟️ Preview Pass: an ACCESS grant, not a queued reserve item. grantPass persists it (and, on the
  // same store, records the used spin below). It can only be drawn from the VIP table, so a free
  // wallet never lands here.
  let pass = null, entries = null, pending;
  if (item === 'preview') {
    const gp = grantPass(w, nowMs);
    if (!gp.ok) return { ok: false, error: gp.error, nextSpinAt: nextSpinAt(nowMs) };
    pass = { room: gp.room, label: gp.label, emoji: gp.emoji, expires: gp.expires };
    pending = pendingCount(w);
  } else if (item === 'raffle') {
    // 🎫 an off-chain drawing entry — banked to a running count, not the reserve queue
    const re = addRaffleEntry(w);
    entries = re.entries;
    pending = pendingCount(w);
  } else {
    const g = grant(w, item, nowMs);
    if (!g.ok) return { ok: false, error: g.error, nextSpinAt: nextSpinAt(nowMs) };
    pending = g.pending;
  }
  const s = load();
  if (daily) { s.spins = s.spins || {}; s.spins[w] = utcDay(nowMs); }
  else { s.bonus = s.bonus || {}; s.bonus[w] = bonusWindowKey(nowMs); }
  save(s);
  return { ok: true, prize: item, pass: pass, entries: entries, bonus: !!bonus, pending: pending, nextSpinAt: nextSpinAt(nowMs), nextBonusAt: nextBonusAt(nowMs), bonusAvailable: bonusAvailable(w, nowMs) };
}
// Published odds (shown on the wheel — provably-honest since it's server-authoritative + declared).
function odds(vip) {
  const table = wheelFor(vip);
  const total = table.reduce((n, p) => n + p.weight, 0);
  return table.map((p) => ({ item: p.item, pct: Math.round((p.weight / total) * 100) }));
}

module.exports = { grant, pendingCount, claimOne, canSpin, nextSpinAt, spin, odds, ITEMS, wheelFor,
  bonusAvailable, nextBonusAt, canSpinNow, bonusWindowKey, BONUS_SPIN_HOURS,
  previewRoom, grantPass, activePass, PREVIEW_ROOMS,
  addRaffleEntry, raffleEntries };
