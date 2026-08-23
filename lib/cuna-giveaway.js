// CUNA buy-to-enter giveaway — entry ledger, scanner and draw.
//
// THE PROMO (owner, 2026-08-22): every buy of >= $5 during a 24h window earns ONE entry.
// Entries STACK and are deliberately UNCAPPED — one buy of $15 is one entry, three buys of $5
// are three, and that asymmetry is the point (it is the owner's call; more buys and more unique
// buyers is what DexScreener and Jupiter rank on). Selling ANY CUNA during the window voids
// every entry the wallet has, no matter when the sold tokens were acquired. Tokens moved out
// are FOLLOWED (see traceOutbound): sold at any hop = void, still sitting unsold = fine, which
// is what keeps a cold-wallet user — doing the thing the school teaches — from being punished
// for it. Three winners are drawn weighted by entry count.
//
// WHY A LEDGER AND NOT ONE BIG SCAN AT THE END. Two traps, both invisible in testing and both
// only biting if the promo actually works:
//
//   1. getTradeTapeHelius pages to maxSigs (900) and sets `capped`. ONE pass over a busy 24h
//      window blows through that and silently drops trades — during the highest-volume hour,
//      which is exactly when an undercount is unforgivable. Scanning forward from a cursor in
//      small slices never approaches the cap, and the ledger accumulates instead of being
//      recomputed from scratch each time.
//   2. The tape values a trade as tokenAmt x whatever price you hand it. Score the window at
//      the end and every buy gets the CLOSING price: if CUNA runs 2x, hour-1 buyers who really
//      spent $5 are re-valued at $2.50 and lose entries they earned. So each trade is priced
//      from the GeckoTerminal 5-MINUTE BAR COVERING ITS OWN TIMESTAMP. That is also what makes
//      backfill honest — a slice scanned hours late prices exactly the same as if it had been
//      scanned live.
//
// Everything here is READ-ONLY against the chain. Nothing signs, nothing moves funds.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteFileSync } = require('./atomic-write');
const { getTradeTapeHelius, getWalletTokenPositionHelius } = require('./helius-trades');
const { KNOWN_CEX_WALLETS } = require('./solana-addr');

const STATE_FILE = () => path.join(process.env.DATA_DIR || '/data', 'cuna-giveaway.json');

// Slice width for the tape scan. Small enough that even a frantic minute cannot approach the
// 900-signature cap; large enough that a 24h backfill is ~144 calls, not thousands.
const SLICE_MS = 10 * 60 * 1000;
// Ceiling on slices per scanOnce() so one invocation can't run for minutes on a backfill; the
// cursor simply advances as far as it got and the next tick picks up from there.
const MAX_SLICES_PER_RUN = 8;
const PRICE_TTL_MS = 4 * 60 * 1000;

function nowMs() { return Date.now(); }
function clampStr(v, n) { return String(v == null ? '' : v).slice(0, n); }

// ---- state ---------------------------------------------------------------------------------
function blank() {
  return {
    config: null,          // { mint, pool, symbol, startMs, endMs, minUsd, chatId }
    cursorMs: 0,           // tape scanned up to here
    wallets: {},           // wallet -> { entries, usd, buys:[{ts,usd,sig}], dq }
    scans: 0, capHits: 0, lastScanAt: 0, lastError: null,
    traced: null,          // { at, checked, dq } — outbound trace summary
    draw: null,            // { at, seedSlot, seedHash, winners:[...] }
    boardMsgId: null,      // Telegram message we edit in place
  };
}
let _mem = null;
function load() {
  if (_mem) return _mem;
  try { _mem = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); }
  catch (e) { _mem = blank(); }
  if (!_mem || typeof _mem !== 'object') _mem = blank();
  if (!_mem.wallets) _mem.wallets = {};
  return _mem;
}
function save() {
  try { atomicWriteFileSync(STATE_FILE(), JSON.stringify(_mem)); }
  catch (e) { console.warn('[cuna-giveaway] state write failed:', e.message); }
}

function configure(patch) {
  const s = load();
  const c = Object.assign({ minUsd: 5, displayUsd: 5, symbol: 'CUNA' }, s.config || {}, patch || {});
  // TWO numbers on purpose (owner, 2026-08-22). minUsd is what SCORES; displayUsd is what the
  // promo SAYS. The promo says $5 and we score at $4.75, so LP tax and slippage on a genuine $5
  // buy can never cost someone their entry. The gap only ever runs in the buyer's favour — it
  // grants entries to people who tried to qualify and got shaved, and takes none away — which is
  // why it is a quiet grace buffer rather than a term anyone needs to read.
  c.minUsd = Number(c.minUsd) || 5;
  c.displayUsd = Number(c.displayUsd) || 5;
  // NOT ELIGIBLE, and deliberately not the same thing as DISQUALIFIED. Project-side wallets
  // (treasury, the pool itself, the operator) can trade the token for perfectly ordinary reasons
  // and must never be able to win the community's prize. They are filtered out of the board and
  // the draw entirely rather than shown with a ❌, because that mark means "broke the no-selling
  // rule" and pinning it on the project's own wallet would read as an accusation.
  if (patch && patch.exclude !== undefined) {
    c.exclude = String(patch.exclude || '').split(',').map((w) => w.trim()).filter(Boolean);
  }
  if (!Array.isArray(c.exclude)) c.exclude = [];
  c.startMs = Number(c.startMs) || 0;
  c.endMs = Number(c.endMs) || 0;
  s.config = c;
  if (!s.cursorMs || s.cursorMs < c.startMs) s.cursorMs = c.startMs;
  save();
  return c;
}
function config() { return load().config; }

// Wipe every counted result but KEEP the config — for a re-run, or to rescore after a fix.
function resetLedger() {
  const s = load();
  s.wallets = {}; s.scans = 0; s.capHits = 0; s.lastScanAt = 0; s.lastError = null;
  s.traced = null; s.draw = null;
  s.cursorMs = (s.config && s.config.startMs) || 0;
  save();
  return { ok: true, cursorMs: s.cursorMs };
}

// ---- price: 5-minute bars covering the window ------------------------------------------------
// One GeckoTerminal call returns up to 1000 bars; a 24h window is 288, so the whole promo fits
// in a single fetch that we refresh every few minutes as new bars close.
let _bars = { at: 0, list: [], pool: null };
async function loadBars(pool) {
  const fresh = _bars.pool === pool && nowMs() - _bars.at < PRICE_TTL_MS && _bars.list.length;
  if (fresh) return _bars.list;
  try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000`,
      { signal: AbortSignal.timeout(9000) },
    );
    const j = await r.json();
    const list = ((j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [])
      .map((b) => ({ t: Number(b[0]) * 1000, c: Number(b[4]) }))
      .filter((b) => b.t > 0 && b.c > 0)
      .sort((a, b) => a.t - b.t);
    if (list.length) _bars = { at: nowMs(), list, pool };
    else console.warn('[cuna-giveaway] OHLCV returned no usable bars');
  } catch (e) { console.warn('[cuna-giveaway] OHLCV fetch failed:', e.message); }
  return _bars.list;
}
// Price at a moment = the close of the 5-minute bar that CONTAINS it (nearest earlier bar).
// Returns 0 when we have no bar for that time — the caller then refuses to score the slice
// rather than pricing a trade wrong, because the price decides who cleared $5.
function priceAt(ts) {
  const list = _bars.list;
  if (!list.length) return 0;
  let lo = 0, hi = list.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= ts) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best < 0) return list[0].c;                       // trade older than our oldest bar
  if (ts - list[best].t > 60 * 60 * 1000) return 0;     // >1h stale: refuse rather than guess
  return list[best].c;
}

// ---- the scan ---------------------------------------------------------------------------------
function isExcluded(c, w) {
  const list = (c && c.exclude) || [];
  for (let i = 0; i < list.length; i++) if (list[i] === w) return true;
  return false;
}
function walletRec(s, w) {
  if (!s.wallets[w]) s.wallets[w] = { entries: 0, usd: 0, buys: [], dq: null };
  return s.wallets[w];
}

// Scan forward from the cursor. Safe to call at any cadence and safe to call late: each slice
// is priced from its own bars, so a backfilled slice scores identically to a live one.
async function scanOnce(deps) {
  const s = load();
  const c = s.config;
  if (!c || !c.mint || !c.pool) return { ok: false, error: 'not_configured' };
  const { heliusKey, heliusEnhancedBatched } = deps || {};
  if (!heliusKey || !heliusEnhancedBatched) return { ok: false, error: 'no_helius' };

  const ceiling = Math.min(nowMs(), c.endMs || nowMs());
  if (s.cursorMs >= ceiling) return { ok: true, upToDate: true, cursorMs: s.cursorMs };

  await loadBars(c.pool);
  if (!_bars.list.length) {
    s.lastError = 'no_price_bars'; save();
    return { ok: false, error: 'no_price_bars' };   // never score without prices
  }

  let slices = 0, newEntries = 0, newDq = 0, trades = 0;
  while (s.cursorMs < ceiling && slices < MAX_SLICES_PER_RUN) {
    const from = s.cursorMs;
    const to = Math.min(from + SLICE_MS, ceiling);
    let tape = null;
    try {
      tape = await getTradeTapeHelius(c.mint, from, to, {
        heliusKey, heliusEnhancedBatched,
        solUsd: 0, tokenPriceUsd: 0,   // we price each trade ourselves, per its own bar
        maxSigs: 900, txCache: new Map(),
      });
    } catch (e) {
      s.lastError = 'tape:' + e.message; save();
      return { ok: false, error: 'tape_failed', detail: e.message, cursorMs: s.cursorMs };
    }
    if (!tape) { s.lastError = 'tape_null'; save(); return { ok: false, error: 'tape_null', cursorMs: s.cursorMs }; }
    if (tape.capped) s.capHits++;   // should never happen at this slice width; surfaced if it does

    for (const t of (tape.trades || [])) {
      if (!t || !t.wallet || t.ts < c.startMs || t.ts > (c.endMs || ceiling)) continue;
      trades++;
      const px = priceAt(t.ts);
      if (!px) continue;                       // unpriceable moment — do not guess
      const usd = (Number(t.tokenAmt) || 0) * px;
      const rec = walletRec(s, t.wallet);
      if (t.side === 'sell') {
        if (!rec.dq) {
          rec.dq = { reason: 'sold_in_window', at: t.ts, sig: t.sig, usd: Math.round(usd * 100) / 100 };
          newDq++;
        }
      } else if (usd >= c.minUsd) {
        // One entry per qualifying BUY TRANSACTION — per buy, not per dollar. Deduped by
        // signature so a re-scanned slice can never double-count.
        if (!rec.buys.some((b) => b.sig === t.sig)) {
          rec.buys.push({ ts: t.ts, usd: Math.round(usd * 100) / 100, sig: t.sig });
          rec.entries++; rec.usd = Math.round((rec.usd + usd) * 100) / 100;
          newEntries++;
        }
      }
    }
    s.cursorMs = to;
    slices++;
  }
  s.scans++; s.lastScanAt = nowMs(); s.lastError = null;
  save();
  return {
    ok: true, cursorMs: s.cursorMs, slices, trades, newEntries, newDq,
    behindMs: Math.max(0, ceiling - s.cursorMs),
  };
}

// ---- outbound trace: follow the tokens, not the wallet -----------------------------------------
// A transfer to your own hardware wallet and a transfer to a stranger are IDENTICAL on-chain, so
// we never rule on who owns a destination — only on what happened to the tokens. Sold at any hop
// (or into a known exchange, where we lose sight of them) voids the entries; still sitting unsold
// leaves them intact. That is "say what's on-chain, never why" applied to a prize rule.
async function traceOutbound(deps, opts) {
  const s = load();
  const c = s.config;
  if (!c) return { ok: false, error: 'not_configured' };
  const { heliusKey, heliusEnhancedBatched } = deps || {};
  if (!heliusKey || !heliusEnhancedBatched) return { ok: false, error: 'no_helius' };
  const hops = Math.max(1, Math.min(2, (opts && opts.hops) || 2));
  const limit = (opts && opts.limit) || 400;

  const cands = Object.keys(s.wallets).filter((w) => s.wallets[w].entries > 0 && !s.wallets[w].dq).slice(0, limit);
  let checked = 0, dq = 0;
  const txCache = new Map();
  for (const w of cands) {
    let pos = null;
    try {
      pos = await getWalletTokenPositionHelius(w, c.mint, {
        heliusKey, heliusEnhancedBatched, txCache, fromMs: c.startMs, toMs: c.endMs || nowMs(),
      });
    } catch (e) { continue; }
    if (!pos) continue;
    checked++;
    const rec = s.wallets[w];
    // Direct sell the tape may have missed (relayer-paid, odd routing).
    if (pos.sells > 0) { rec.dq = { reason: 'sold_in_window', at: c.endMs, detail: pos.sells + ' sell tx' }; dq++; continue; }
    // Hold-check: the tokens must still be somewhere unsold. `pos.balance` covers what stayed
    // put; the per-destination walk below covers what moved.
    for (const d of (pos.transferDests || [])) {
      if (rec.dq) break;
      const cex = KNOWN_CEX_WALLETS[d.to];
      if (cex) {
        rec.dq = { reason: 'sent_to_exchange', at: c.endMs, detail: cex + ' (' + Math.round(d.amount).toLocaleString() + ' ' + c.symbol + ')', dest: d.to };
        dq++; break;
      }
      if (hops < 2) continue;
      let hop = null;
      try {
        hop = await getWalletTokenPositionHelius(d.to, c.mint, {
          heliusKey, heliusEnhancedBatched, txCache, fromMs: c.startMs, toMs: c.endMs || nowMs(),
        });
      } catch (e) { continue; }
      if (!hop) continue;
      if (hop.sells > 0) {
        rec.dq = { reason: 'sold_after_transfer', at: c.endMs, dest: d.to,
                   detail: 'moved ' + Math.round(d.amount).toLocaleString() + ' ' + c.symbol + ' → ' + d.to.slice(0, 4) + '…' + d.to.slice(-4) + ', sold there' };
        dq++; break;
      }
      // Onward transfer from the destination, at the hop limit: we can no longer see the tokens.
      for (const d2 of (hop.transferDests || [])) {
        const cex2 = KNOWN_CEX_WALLETS[d2.to];
        if (cex2) {
          rec.dq = { reason: 'sent_to_exchange', at: c.endMs, dest: d2.to, detail: cex2 + ' (via ' + d.to.slice(0, 4) + '…)' };
          dq++; break;
        }
      }
    }
  }
  s.traced = { at: nowMs(), checked, dq, hops };
  save();
  return { ok: true, checked, dq, candidates: cands.length };
}

// ---- standings ---------------------------------------------------------------------------------
function standings(n) {
  const s = load();
  const c = s.config || {};
  const live = [], out = [];
  let excluded = 0;
  for (const [w, r] of Object.entries(s.wallets)) {
    if (isExcluded(c, w)) { if (r.entries > 0) excluded++; continue; }   // never on the board, never in the draw
    if (r.dq) { if (r.entries > 0) out.push({ wallet: w, entries: r.entries, dq: r.dq }); continue; }
    if (r.entries > 0) live.push({ wallet: w, entries: r.entries, usd: r.usd });
  }
  live.sort((a, b) => b.entries - a.entries || b.usd - a.usd);
  const totalEntries = live.reduce((t, x) => t + x.entries, 0);
  const totalUsd = live.reduce((t, x) => t + x.usd, 0);
  return {
    config: c, cursorMs: s.cursorMs, lastScanAt: s.lastScanAt, capHits: s.capHits, lastError: s.lastError,
    totalEntries, totalWallets: live.length, totalUsd: Math.round(totalUsd * 100) / 100,
    disqualified: out.length, disqualifiedList: out.slice(0, 50), excluded,
    top: live.slice(0, Math.max(1, Math.min(100, n || 10))),
    traced: s.traced, draw: s.draw,
    startMs: c.startMs || 0, endMs: c.endMs || 0,
    open: !!(c.startMs && c.endMs && nowMs() >= c.startMs && nowMs() < c.endMs),
  };
}

// ---- the draw ------------------------------------------------------------------------------------
// Weighted by entries, seeded from a Solana block hash NOBODY can know in advance. The seed slot,
// its hash and the exact entry list are all published, so anyone can replay this and get the same
// three winners — the alternative ("trust us") is not something this project should ever ask for.
function drawFromSeed(seedHex, entries, count) {
  const winners = [];
  const pool = entries.map((e) => ({ ...e }));
  for (let i = 0; i < count && pool.length; i++) {
    const total = pool.reduce((t, x) => t + x.entries, 0);
    if (total <= 0) break;
    // Fresh 8 bytes of the keyed stream per draw → independent, reproducible picks.
    const h = crypto.createHmac('sha256', Buffer.from(seedHex, 'hex')).update('draw-' + i).digest();
    const pick = Number(h.readBigUInt64BE(0) % BigInt(total));
    let acc = 0, idx = 0;
    for (let k = 0; k < pool.length; k++) { acc += pool[k].entries; if (pick < acc) { idx = k; break; } }
    winners.push({ place: i + 1, wallet: pool[idx].wallet, entries: pool[idx].entries, ticket: pick, of: total });
    pool.splice(idx, 1);   // one prize per wallet
  }
  return winners;
}

async function runDraw(deps, opts) {
  const s = load();
  const c = s.config;
  if (!c) return { ok: false, error: 'not_configured' };
  if (s.draw && !(opts && opts.force)) return { ok: true, already: true, draw: s.draw };
  const st = standings(100000);
  const eligible = Object.entries(s.wallets)
    .filter(([w, r]) => r.entries > 0 && !r.dq && !isExcluded(c, w))
    .map(([wallet, r]) => ({ wallet, entries: r.entries }));
  if (!eligible.length) return { ok: false, error: 'no_eligible_entries' };

  // Seed: the hash of a recent finalized slot. Taken AFTER the window closes, so it cannot have
  // been known — let alone influenced — by anyone while entries were still being earned.
  let seedSlot = null, seedHash = null;
  try {
    const rpcUrl = deps && deps.rpcUrl ? deps.rpcUrl : 'https://api.mainnet-beta.solana.com';
    const call = async (method, params) => {
      const r = await (await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'draw', method, params }) })).json();
      return r.result;
    };
    seedSlot = await call('getSlot', [{ commitment: 'finalized' }]);
    const bl = await call('getBlock', [seedSlot, { maxSupportedTransactionVersion: 0, transactionDetails: 'none', rewards: false }]);
    seedHash = bl && bl.blockhash;
  } catch (e) { return { ok: false, error: 'seed_failed', detail: e.message }; }
  if (!seedHash) return { ok: false, error: 'no_seed_hash' };

  const seedHex = crypto.createHash('sha256').update(String(seedHash)).digest('hex');
  const winners = drawFromSeed(seedHex, eligible, Math.min(3, eligible.length));
  const prizes = (opts && opts.prizes) || [5000000, 3000000, 2000000];
  winners.forEach((w, i) => { w.prize = prizes[i] || 0; });
  s.draw = {
    at: nowMs(), seedSlot, seedHash, seedHex, winners,
    totalEntries: st.totalEntries, totalWallets: st.totalWallets,
    entryListHash: crypto.createHash('sha256')
      .update(eligible.slice().sort((a, b) => (a.wallet < b.wallet ? -1 : 1)).map((e) => e.wallet + ':' + e.entries).join('|'))
      .digest('hex'),
  };
  save();
  return { ok: true, draw: s.draw };
}

// ---- the pinned live board ----------------------------------------------------------------------
// Owner's call: POST A FRESH MESSAGE and delete the previous one, rather than editing in place.
// Editing keeps the board pinned where it first landed and it slides out of view as the room
// talks; reposting keeps it at the bottom where people actually see it. tg-test's &replaceMsg
// does exactly this — send first, delete the old id after, and never fail the send if the delete
// does. Posts inherit the house SILENT default, so 288 refreshes over 24h do not ping anyone.
function short(w) { return w.slice(0, 4) + '\u2026' + w.slice(-4); }
function hms(ms) {
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
}
function boardText() {
  // 20 rows, not 10 — field report (owner, 2026-08-22): a 1-entry buyer below the top-10 fold read
  // his absence as "my buy didn't count" when he was eligible the whole time. Show more, and when
  // even 20 isn't everyone, SAY there are more, so absence from the list never reads as absence
  // from the draw.
  const st = standings(20);
  const c = st.config || {};
  const sym = c.symbol || 'CUNA';
  const closed = !st.open && st.endMs && nowMs() >= st.endMs;
  const L = [];
  L.push(closed ? '\uD83C\uDFA1 CUNA GIVEAWAY \u2014 WINDOW CLOSED' : '\uD83C\uDFA1 CUNA GIVEAWAY \u2014 LIVE');
  L.push('');
  L.push('\uD83C\uDF9F ' + st.totalEntries.toLocaleString() + ' entries from ' + st.totalWallets.toLocaleString() + ' wallets'
         + (closed ? '' : '  \u00B7  \u23F3 ' + hms((st.endMs || 0) - nowMs()) + ' left'));
  L.push('');
  if (!st.top.length) {
    L.push('No qualifying buys yet \u2014 every $' + (c.displayUsd || 5) + '+ buy is one entry.');
  } else {
    const medal = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    st.top.forEach((r, i) => {
      L.push((medal[i] || ('  ' + (i + 1) + '.')) + ' ' + short(r.wallet) + ' \u2014 ' + r.entries.toLocaleString()
             + ' entr' + (r.entries === 1 ? 'y' : 'ies'));
    });
  }
  if (st.totalWallets > st.top.length) {
    L.push('  \u2026 +' + (st.totalWallets - st.top.length) + ' more wallets in the draw \u2014 every qualifying buy counts, listed or not');
  }
  if (st.disqualified > 0) {
    L.push('');
    L.push('\u274C ' + st.disqualified + ' wallet' + (st.disqualified === 1 ? '' : 's') + ' disqualified (sold during the window)');
  }
  L.push('');
  L.push(closed
    ? 'Scoring is final. Full entry list + the block-hash seed drop with the winners.'
    : 'Every $' + (c.displayUsd || 5) + '+ buy = 1 entry, no cap, they stack. Selling voids every entry you have.');
  L.push('Updated every 5 min \u00B7 counted straight off the chain');
  return L.join('\n');
}

// Post the board and retire the previous one. Returns { ok, messageId } or { ok:false, ... }.
async function postBoard(opts) {
  const s = load();
  const c = s.config;
  if (!c || !c.chatId) return { ok: false, error: 'no_chat' };
  const key = (opts && opts.premiumKey) || process.env.PREMIUM_ACCESS_KEY;
  const base = (opts && opts.base) || 'https://clucknorris.app';
  if (!key) return { ok: false, error: 'no_key' };
  const text = boardText();
  // A TEXT message allows 4096 chars, so the 1024 photo-caption trap does not apply here — but
  // stay well clear anyway; a top-10 board is ~500.
  const prev = s.boardMsgId;
  // ONE BOARD, ALWAYS THE LATEST, ALWAYS PINNED (owner, 2026-08-22, final shape).
  // Order matters and tg-test already does it right: send the new board, delete the previous one,
  // then pin the new one. Deleting a pinned message drops its pin, so doing the delete first
  // leaves exactly one pinned message and no orphan pin. Net effect the owner asked for — anyone
  // scrolling the thread sees a single leaderboard post (the current one, at the bottom), and
  // anyone opening pinned messages sees that same fresh board. 24h of refreshes never accumulate.
  // Both are opt-OUT (&replaceoff=1 / &pinoff=1) rather than opt-in.
  const pin = c.boardPin !== false;
  const replace = c.boardReplace !== false;
  const url = base + '/api/tg-test?key=' + encodeURIComponent(key)
    + '&chat=' + encodeURIComponent(c.chatId)
    + '&text=' + encodeURIComponent(text.slice(0, 3500))
    + (pin ? '&pin=1' : '')
    + (replace && prev ? '&replaceMsg=' + encodeURIComponent(String(prev)) : '');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (!j || !j.success) return { ok: false, error: 'send_failed', detail: (j && j.error) || null };
    // Only forget the old id once the new one is actually up — a failed send must never leave
    // the board with no message to replace next time.
    s.boardMsgId = j.messageId || null;
    save();
    return { ok: true, messageId: j.messageId, replaced: prev || null, pinned: j.pinned === true };
  } catch (e) { return { ok: false, error: 'send_error', detail: e.message }; }
}

function fullEntryList() {
  const s = load();
  const c = s.config || {};
  return Object.entries(s.wallets)
    .filter(([w, r]) => r.entries > 0 && !isExcluded(c, w))
    .map(([wallet, r]) => ({ wallet, entries: r.entries, usd: r.usd, dq: r.dq ? r.dq.reason : null }))
    .sort((a, b) => b.entries - a.entries);
}
function setBoardMsgId(id) { const s = load(); s.boardMsgId = id || null; save(); return s.boardMsgId; }
function boardMsgId() { return load().boardMsgId; }

module.exports = {
  configure, config, resetLedger, scanOnce, traceOutbound, standings,
  runDraw, drawFromSeed, fullEntryList, setBoardMsgId, boardMsgId,
  boardText, postBoard,
  priceAt, loadBars, STATE_FILE,
};
