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
let _memMtime = 0;
function load() {
  // Cache invalidation by mtime. The process cached _mem forever and save() writes the WHOLE
  // blob, so a second process (Railway runs more than one) would hold a stale config and
  // silently revert another process's change the next time IT saved — a board post reverted
  // `mode` every single time while plain reads showed the new value. Re-read when the file
  // has moved on; keep the cache when it hasn't.
  try {
    const st = fs.statSync(STATE_FILE());
    if (_mem && st.mtimeMs === _memMtime) return _mem;
    _mem = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    _memMtime = st.mtimeMs;
    return _mem;
  } catch (_) { /* missing/unreadable — fall through to the original path */ }
  if (_mem) return _mem;
  try { _mem = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); }
  catch (e) { _mem = blank(); }
  if (!_mem || typeof _mem !== 'object') _mem = blank();
  if (!_mem.wallets) _mem.wallets = {};
  return _mem;
}
function save() {
  try {
    atomicWriteFileSync(STATE_FILE(), JSON.stringify(_mem));
    try { _memMtime = fs.statSync(STATE_FILE()).mtimeMs; } catch (_) { _memMtime = 0; }
  }
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
  // 'special' = buy-and-hold, EVERY qualifying wallet paid a % back in TOKENS (no winner
  // is drawn); 'giveaway' = the entry raffle. 'contest' is accepted as a legacy alias so a
  // config stored before the rename keeps scoring instead of silently reverting to raffle.
  if (c.mode === 'contest') c.mode = 'special';
  if (c.mode !== 'special') c.mode = 'giveaway';
  c.bonusPct = Number(c.bonusPct) || 0;
  // 'per-buy' (default, the historic behaviour) or 'per-dollar'. Anything unrecognised falls back
  // to per-buy rather than throwing — a typo in an admin URL must never silently rescore a promo.
  c.entryMode = c.entryMode === 'per-dollar' ? 'per-dollar' : 'per-buy';
  // Hold deadline: buyers must still hold at this instant to be paid. Distinct from endMs
  // (when BUYING stops) — conflating the two is how a hold rule gets scored a day early.
  c.holdEndMs = Number(c.holdEndMs) || 0;
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
// PRE-PAYOUT HOLD CHECK (owner's rule, 2026-08-23: "if you sell before the tokens are sent out
// you are ineligible"). The scanner cannot cover this — its ceiling is the entry-window close,
// and this rule runs all the way to the moment prizes leave the wallet. So it is a point-in-time
// check the operator runs immediately BEFORE sending: read each drawn wallet's CURRENT on-chain
// balance and compare it to what they bought.
//
// Reports, never auto-disqualifies. A low balance has innocent explanations — the wallet may have
// held CUNA before the promo, moved to a hardware wallet, or the price moved — and stripping
// somebody's prize automatically on a heuristic is exactly the kind of false accusation this
// project does not make. It hands back the numbers and the operator decides, with manualDq as
// the lever.
async function checkWinnersStillHolding(deps) {
  const s = load();
  if (!s.draw || !Array.isArray(s.draw.winners)) return { ok: false, error: 'no_draw' };
  const rpcUrl = (deps && deps.rpcUrl) || 'https://api.mainnet-beta.solana.com';
  const mint = (s.config || {}).mint;
  if (!mint) return { ok: false, error: 'not_configured' };
  const call = async (method, params) => {
    const r = await (await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'hold', method, params }) })).json();
    return r.result;
  };
  const rows = [];
  for (const w of s.draw.winners) {
    const rec = s.wallets[w.wallet] || {};
    let bal = 0, err = null;
    try {
      const r = await call('getTokenAccountsByOwner', [w.wallet, { mint }, { encoding: 'jsonParsed' }]);
      for (const a of ((r && r.value) || [])) bal += Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0);
    } catch (e) { err = e.message; }
    // WHETHER SOMEONE STILL HOLDS IS A TOKEN QUESTION, NOT A DOLLAR ONE.
    //
    // This used to decide it in USD: balance x priceAt(now) vs what they spent. That is wrong twice
    // over, and it fired for real on 2026-09-04 — it flagged ALL FOUR winners plus the alternate as
    // having dumped, minutes after their prizes had landed and while every balance was UP.
    //
    //   1. priceAt() reads the module's _bars cache, which ONLY scanOnce() fills. After the window
    //      closes the scanner is a deliberate no-op, so on any process restart (every deploy) the
    //      cache is empty and every price lookup returns 0 — making holdUsd 0, heldPct 0, and
    //      every winner "flagged". The fallback to priceAt(endMs) does not help: same empty cache.
    //   2. Even with a working price, judging a HOLD in dollars means a price drop reads as a sell.
    //      Someone who never moved a token gets disqualified because the market fell.
    //
    // Both failures point the same way — toward disqualifying people who did nothing wrong, on the
    // one check that gates whether a winner gets paid. So the verdict is now token-based and
    // price-free: what they hold now vs what they BOUGHT in the window. USD is kept as decoration,
    // clearly null when unknown, and can never move the flag.
    let px = 0;
    try {
      if (!_bars.list.length && (s.config || {}).pool) await loadBars(s.config.pool);
      px = priceAt(nowMs()) || priceAt((s.config || {}).endMs) || 0;
    } catch (_) { px = 0; }
    const boughtUsd = Number(rec.usd || 0);
    const boughtTok = Number(rec.tokens || 0);
    // keptPct is the real signal. null when we never recorded what they bought — unknown, not zero.
    const keptPct = boughtTok > 0 ? Math.round((bal / boughtTok) * 1000) / 10 : null;
    rows.push({
      place: w.place, wallet: w.wallet, alternate: !!w.alternate, prize: w.prize,
      entries: w.entries, boughtUsd: Math.round(boughtUsd * 100) / 100,
      boughtTokens: boughtTok, balance: bal,
      keptPct,
      // decoration only — null (not 0) when the price feed is cold, so a missing price is
      // visibly missing instead of silently reading as "worth nothing"
      holdUsd: px > 0 ? Math.round(bal * px * 100) / 100 : null,
      heldPct: px > 0 && boughtUsd > 0 ? Math.round(((bal * px) / boughtUsd) * 1000) / 10 : null,
      priceKnown: px > 0,
      emptied: bal === 0,
      error: err,
    });
  }
  // Flag on TOKENS ONLY. A read error is flagged too — an unreadable balance is not a pass.
  const flagged = rows.filter((r) => r.error || r.emptied || (r.keptPct !== null && r.keptPct < 50));
  return {
    ok: true, at: nowMs(), rows,
    basis: 'tokens-held-vs-tokens-bought',
    priceKnown: rows.some((r) => r.priceKnown),
    flagged: flagged.length, flaggedWallets: flagged.map((r) => r.wallet),
  };
}

// MANUAL DISQUALIFICATION. The automatic scanner stops at the window close by design — its
// ceiling is min(now, endMs) — so it cannot see a wallet that dumps AFTER the window but BEFORE
// the wheel spins. The promo copy covers that case ("hold your tokens til the wheel has spun")
// even though the scanner does not, and closing the gap by moving the ceiling would silently
// rewrite the scoring rule for every wallet at once. This is the narrow, auditable alternative:
// an operator marks one wallet, with a reason, and it shows on the board as a normal ❌ rather
// than quietly vanishing. Reversible via undq.
function manualDq(wallet, reason) {
  const s = load();
  const w = String(wallet || '').trim();
  if (!w) return { ok: false, error: 'wallet required' };
  const r = s.wallets[w];
  if (!r) return { ok: false, error: 'no_such_wallet' };
  if (r.dq) return { ok: true, already: true, wallet: w, dq: r.dq };
  r.dq = { reason: String(reason || 'sold_before_draw').slice(0, 60), at: nowMs(), manual: true };
  save();
  return { ok: true, wallet: w, entries: r.entries, dq: r.dq };
}
function undoDq(wallet) {
  const s = load();
  const w = String(wallet || '').trim();
  const r = s.wallets[w];
  if (!r) return { ok: false, error: 'no_such_wallet' };
  if (!r.dq) return { ok: true, already: true, wallet: w };
  // Only a MANUAL mark can be lifted here — an on-chain sell the scanner found is a fact, and
  // an operator should not be able to un-see it with a query string.
  if (!r.dq.manual) return { ok: false, error: 'scanner_dq_not_reversible', dq: r.dq };
  r.dq = null; save();
  return { ok: true, wallet: w, entries: r.entries };
}
function isExcluded(c, w) {
  const list = (c && c.exclude) || [];
  for (let i = 0; i < list.length; i++) if (list[i] === w) return true;
  return false;
}
function walletRec(s, w) {
  if (!s.wallets[w]) s.wallets[w] = { entries: 0, usd: 0, tokens: 0, buys: [], dq: null };
  const r = s.wallets[w];
  // Older ledgers predate token tracking; give them the field rather than NaN-ing every sum.
  if (typeof r.tokens !== 'number') r.tokens = 0;
  return r;
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
        // HOW MANY ENTRIES A QUALIFYING BUY EARNS. Deduped by signature either way, so a
        // re-scanned slice can never double-count.
        //
        //   'per-buy'    (DEFAULT, unchanged) — one entry per qualifying buy transaction.
        //   'per-dollar' — floor(usd / minUsd), so entries track capital committed.
        //
        // Why the option exists (first 4-winner draw, 2026-09-04): per-buy counts how OFTEN
        // someone bought, never how MUCH. A wallet that DCA'd $303 across 71 small buys got 71
        // entries; a wallet that put in $198 in two clean buys got 2 — 0.75% of the pool, a 3%
        // shot, while being the second-biggest buyer in the contest. It is also trivially gamed
        // by splitting one buy into many. Per-dollar removes both effects: 66 small buys and one
        // big buy of the same total score identically.
        //
        // The default is deliberately UNCHANGED. Which way a promo counts is the owner's product
        // decision, not a default to be quietly flipped under a running contest — set
        // entryMode=per-dollar on the next one.
        if (!rec.buys.some((b) => b.sig === t.sig)) {
          const tok = Number(t.tokenAmt) || 0;
          const gained = c.entryMode === 'per-dollar'
            ? Math.max(1, Math.floor(usd / (c.minUsd || 1)))   // a qualifying buy always earns >= 1
            : 1;
          rec.buys.push({ ts: t.ts, usd: Math.round(usd * 100) / 100, tok, sig: t.sig, entries: gained });
          rec.entries += gained; rec.usd = Math.round((rec.usd + usd) * 100) / 100;
          rec.tokens += tok;
          newEntries += gained;
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
    if (r.entries > 0) live.push({ wallet: w, entries: r.entries, usd: r.usd, tokens: r.tokens || 0 });
  }
  // Contest mode ranks by TOKENS BOUGHT (what the bonus is paid on); the raffle ranked by
  // entry count. Same ledger, two orderings — never mix them on one board.
  const byTokens = (c.mode === 'special');
  live.sort((a, b) => (byTokens ? (b.tokens - a.tokens || b.usd - a.usd) : (b.entries - a.entries || b.usd - a.usd)));
  const totalEntries = live.reduce((t, x) => t + x.entries, 0);
  const totalUsd = live.reduce((t, x) => t + x.usd, 0);
  const totalTokens = live.reduce((t, x) => t + (x.tokens || 0), 0);
  return {
    config: c, cursorMs: s.cursorMs, lastScanAt: s.lastScanAt, capHits: s.capHits, lastError: s.lastError,
    totalEntries, totalWallets: live.length, totalUsd: Math.round(totalUsd * 100) / 100,
    totalTokens, bonusPct: Number(c.bonusPct) || 0, mode: c.mode || 'giveaway',
    totalBonus: totalTokens * ((Number(c.bonusPct) || 0) / 100),
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
    const bl = await call('getBlock', [seedSlot, { maxSupportedTransactionVersion: 1, transactionDetails: 'none', rewards: false }]);
    seedHash = bl && bl.blockhash;
  } catch (e) { return { ok: false, error: 'seed_failed', detail: e.message }; }
  if (!seedHash) return { ok: false, error: 'no_seed_hash' };

  const seedHex = crypto.createHash('sha256').update(String(seedHash)).digest('hex');
  const prizes = (opts && opts.prizes) || [5000000, 3000000, 2000000];
  // ALTERNATES are drawn in the SAME pass, from the same seed, in order — not picked later.
  // That matters: if an alternate had to be drawn after a winner was found ineligible, it would
  // be seeded from a block hash chosen after everyone already knew who was disqualified. Drawing
  // 4th place up front means the standby is provably as fair as the prizes, and promoting it is
  // just reading down a list that was fixed before anyone saw it.
  const alts = Math.max(0, Math.min(3, opts && opts.alternates !== undefined ? Number(opts.alternates) : 1));
  const want = Math.min(prizes.length + alts, eligible.length);
  const winners = drawFromSeed(seedHex, eligible, want);
  winners.forEach((w, i) => {
    w.prize = prizes[i] || 0;
    if (i >= prizes.length) { w.alternate = true; w.altRank = i - prizes.length + 1; }
  });
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
  // Top 7 for the Buy Special (owner, 2026-08-26); the raffle board keeps its 20 rows.
  const st = standings((getConfigMode() === 'special') ? 7 : 20);
  const c = st.config || {};
  const sym = c.symbol || 'CUNA';
  const closed = !st.open && st.endMs && nowMs() >= st.endMs;
  // BUY SPECIAL (owner, 2026-08-26): ranked by CUMULATIVE TOKENS BOUGHT, % back paid in tokens.
  if (c.mode === 'special') return specialBoardText(st, c, sym, closed);
  // 20 rows, not 10 — field report (owner, 2026-08-22): a 1-entry buyer below the top-10 fold read
  // his absence as "my buy didn't count" when he was eligible the whole time. Show more, and when
  // even 20 isn't everyone, SAY there are more, so absence from the list never reads as absence
  // from the draw.
  const L = [];
  L.push(closed ? '\uD83C\uDFA1 CUNA GIVEAWAY \u2014 WINDOW CLOSED' : '\uD83C\uDFA1 CUNA GIVEAWAY \u2014 LIVE');
  L.push('');
  L.push('\uD83C\uDF9F ' + st.totalEntries.toLocaleString() + ' entries from ' + st.totalWallets.toLocaleString() + ' wallets'
         + (closed ? '' : '  \u00B7  \u23F3 ' + hms((st.endMs || 0) - nowMs()) + ' left'));
  L.push('');
  if (!st.top.length) {
    L.push(c.entryMode === 'per-dollar'
      ? ('No qualifying buys yet \u2014 every $' + (c.displayUsd || 5) + ' you buy is one entry.')
      : ('No qualifying buys yet \u2014 every $' + (c.displayUsd || 5) + '+ buy is one entry.'));
  } else {
    const medal = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    // SHOW THE DOLLARS, not just the entry count (owner, 2026-09-04). The board used to print
    // entries alone, which made a real asymmetry invisible: on the first 4-winner draw a wallet
    // showed as "2 entries" while having spent $198 \u2014 the second-biggest buyer in the contest,
    // looking like its smallest participant. Nobody could see that from the board, including the
    // owner, until the numbers were pulled apart afterwards. One entry per qualifying buy means
    // entry count measures HOW OFTEN someone bought; the dollar figure is the only thing on the
    // board that shows HOW MUCH.
    st.top.forEach((r, i) => {
      const usd = Number(r.usd) || 0;
      L.push((medal[i] || ('  ' + (i + 1) + '.')) + ' ' + short(r.wallet) + ' \u2014 ' + r.entries.toLocaleString()
             + ' entr' + (r.entries === 1 ? 'y' : 'ies')
             + (usd > 0 ? ' \u00b7 $' + (usd >= 100 ? Math.round(usd).toLocaleString() : usd.toFixed(2)) : ''));
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
    : (c.entryMode === 'per-dollar'
        ? ('Every $' + (c.displayUsd || 5) + ' bought = 1 entry, no cap, they stack \u2014 buy in one go or many, same odds. Selling voids every entry you have.')
        : ('Every $' + (c.displayUsd || 5) + '+ buy = 1 entry, no cap, they stack. Selling voids every entry you have.')));
  L.push('Updated every ' + (Math.max(5, Number(c.boardEveryMin) || 5)) + ' min \u00B7 counted straight off the chain');
  return L.join('\n');
}

// Round token counts for display. A bonus of 1,234,567.89 CUNA reads as noise; the payout is
// computed from the exact figure, this only formats it.
function getConfigMode() { const c = load().config || {}; return c.mode || 'giveaway'; }

function tk(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

function specialBoardText(st, c, sym, closed) {
  const pct = Number(c.bonusPct) || 0;
  const L = [];
  L.push(closed ? '\uD83C\uDF81 CUNA BUY SPECIAL \u2014 BUY WINDOW CLOSED' : '\uD83C\uDF81 CUNA BUY SPECIAL \u2014 LIVE');
  L.push('');
  L.push('\uD83D\uDC45 ' + tk(st.totalTokens) + ' ' + sym + ' bought by ' + st.totalWallets.toLocaleString() + ' wallet'
         + (st.totalWallets === 1 ? '' : 's')
         + (closed ? '' : '  \u00B7  \u23F3 ' + hms((st.endMs || 0) - nowMs()) + ' left'));
  L.push('\uD83C\uDF81 ' + tk(st.totalBonus) + ' ' + sym + ' in bonuses earned so far (' + pct + '% back)');
  L.push('');
  if (!st.top.length) {
    L.push('No buys counted yet \u2014 every buy in the window earns ' + pct + '% back in ' + sym + '.');
  } else {
    // NO medals here: this is a special, not a contest, and a podium implies one winner
    // beating another when in fact every qualifying wallet is paid the same % back.
    st.top.forEach((r, i) => {
      const bonus = (r.tokens || 0) * (pct / 100);
      L.push((i + 1) + '. ' + short(r.wallet)
             + ' \u2014 ' + tk(r.tokens) + ' ' + sym
             + '  (+' + tk(bonus) + ' bonus)');
    });
  }
  if (st.totalWallets > st.top.length) {
    L.push('  \u2026 +' + (st.totalWallets - st.top.length) + ' more wallets earning \u2014 every buy counts, listed or not');
  }
  if (st.disqualified > 0) {
    L.push('');
    L.push('\u274C ' + st.disqualified + ' wallet' + (st.disqualified === 1 ? '' : 's') + ' voided (sold during the window)');
  }
  L.push('');
  L.push(closed
    ? 'Buying is closed. HOLD through the 48h period \u2014 no sells, no transfers out \u2014 then bonuses are verified and paid.'
    : 'Not a contest \u2014 EVERY qualifying wallet gets ' + pct + '% back in ' + sym + '. Hold 48h after close. Selling or moving tokens out voids it.');
  L.push('Updated every ' + (Math.max(5, Number(c.boardEveryMin) || 5)) + ' min \u00B7 counted straight off the chain');
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
  // The admin key travels in the x-premium-key header (tg-test accepts it), never the query
  // string — this hop goes out through the public edge and back, and URLs land in logs.
  const url = base + '/api/tg-test?chat=' + encodeURIComponent(c.chatId)
    + '&text=' + encodeURIComponent(text.slice(0, 3500))
    + (pin ? '&pin=1' : '')
    + (replace && prev ? '&replaceMsg=' + encodeURIComponent(String(prev)) : '');
  try {
    const r = await fetch(url, { headers: { 'x-premium-key': key }, signal: AbortSignal.timeout(20000) });
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

// ---- payout bookkeeping ------------------------------------------------------------------------
// The prize send is NOT idempotent by nature: a retry after a timeout would happily pay a winner
// twice. So every landed signature is recorded against the wallet BEFORE anything can be retried,
// and payoutOwed() subtracts what is already paid. A caller that runs the payout three times pays
// each winner once.
function payoutOwed() {
  const s = load();
  if (!s.draw || !s.draw.winners) return { ok: false, error: 'no_draw' };
  const paid = s.payouts || {};
  const owed = s.draw.winners
    .filter((w) => !w.alternate && Number(w.prize) > 0)
    .filter((w) => !paid[w.wallet])
    .map((w) => ({ wallet: w.wallet, amountUi: Number(w.prize) }));
  return {
    ok: true,
    owed,
    alreadyPaid: Object.entries(paid).map(([wallet, p]) => ({ wallet, ...p })),
    totalOwed: owed.reduce((t, r) => t + r.amountUi, 0),
  };
}
function recordPayout(rows) {
  const s = load();
  s.payouts = s.payouts || {};
  for (const r of (rows || [])) {
    if (!r || !r.wallet || !r.sig) continue;
    // never overwrite an existing record — the first landed payment is the true one
    if (!s.payouts[r.wallet]) s.payouts[r.wallet] = { amountUi: r.amountUi, sig: r.sig, at: nowMs() };
  }
  save();
  return s.payouts;
}
function payoutState() { const s = load(); return s.payouts || {}; }

module.exports = { manualDq, undoDq, checkWinnersStillHolding,
  configure, config, resetLedger, scanOnce, traceOutbound, standings,
  runDraw, drawFromSeed, fullEntryList, setBoardMsgId, boardMsgId,
  payoutOwed, recordPayout, payoutState,
  boardText, postBoard,
};
