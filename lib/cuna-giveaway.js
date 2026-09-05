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
// Returns whether the write actually landed. Callers on the MONEY path (recordPayout) must check
// it — a swallowed write failure means prizes go out with no durable record and the next run pays
// everyone again. Callers on the scanner path can keep ignoring it; a lost scan tick is harmless.
function save() {
  try {
    atomicWriteFileSync(STATE_FILE(), JSON.stringify(_mem));
    try { _memMtime = fs.statSync(STATE_FILE()).mtimeMs; } catch (_) { _memMtime = 0; }
    return true;
  }
  catch (e) { console.warn('[cuna-giveaway] state write failed:', e.message); return false; }
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
  // ARCHIVE THE PAYOUTS. This used to leave s.payouts untouched, so the finished promo's records
  // sat in the store while s.draw was cleared — and the next draw's migration then adopted them
  // as its own, refusing to pay a repeat winner their NEW prize (see migratePayouts). Anything
  // still in the flat legacy shape is parked here too; nothing is deleted, it is just moved out
  // of the live map so a new round starts with a clean slate and the audit trail survives.
  if (s.payouts && Object.keys(s.payouts).length) {
    s.payoutsArchive = s.payoutsArchive || [];
    s.payoutsArchive.push({ archivedAt: nowMs(), drawAt: (s.draw && s.draw.at) || null,
                            seedHash: (s.draw && s.draw.seedHash) || null, payouts: s.payouts });
    s.payouts = {};
  }
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
  let incompleteThisRun = false;   // THIS run's verdict — not a leftover lastError from a past one
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
    // A SLICE THE TAPE COULD NOT FULLY COVER MUST NOT BE MARKED DONE.
    //
    // getTradeTapeHelius now reports reachedWindowStart: false when an RPC error (including a
    // 200-with-{error} throttle), a page-budget exhaustion, or a short enhanced-tx batch left
    // part of the slice unscanned. Advancing the cursor over that slice retires it forever — the
    // scanner is incremental and never looks back — so a throttled minute would permanently lose
    // whatever traded in it. A missed BUY costs someone entries they earned; a missed SELL leaves
    // a wallet holding entries it should have lost, and that one decides who wins a prize.
    //
    // So: keep the trades we did see (they are deduped by signature, re-scanning is free) and
    // stop WITHOUT advancing. The next tick retries the same slice.
    if (tape.reachedWindowStart === false) {
      incompleteThisRun = true;
      s.incompleteSlices = (s.incompleteSlices || 0) + 1;
      s.lastError = 'slice_incomplete: ' + JSON.stringify({ from, to,
        capped: !!tape.capped, txsMissing: tape.txsMissing || 0, poolErrors: (tape.poolErrors || []).length });
    }

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
    if (tape.reachedWindowStart === false) { slices++; break; }   // retry this slice next tick
    s.cursorMs = to;
    slices++;
  }
  s.scans++; s.lastScanAt = nowMs();
  // Clear lastError unless THIS run hit an incomplete slice. Testing the stored string instead
  // left a recovered scanner reporting itself stalled forever, off the previous run's message.
  if (!incompleteThisRun) s.lastError = null;
  save();
  return {
    ok: true, cursorMs: s.cursorMs, slices, trades, newEntries, newDq,
    incompleteSlices: s.incompleteSlices || 0,
    stalled: incompleteThisRun,
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
    // The token this draw is FOR. Without it, pointing config at the next promo's mint before
    // resetting would let a payout send the new token to the old winners.
    mint: c.mint,
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
// LEGACY SHAPE MIGRATION — do not remove until no deployment can still hold the old file.
//
// The first version of recordPayout keyed records by wallet directly: s.payouts[wallet] = {...}.
// Round-scoping changed that to s.payouts[round][wallet]. On a store written by the old code the
// new reader finds nothing under the round key, concludes NOBODY was paid, and a re-run pays every
// winner a second time — 10,000,000 CUNA on the round that was live when this changed.
//
// Legacy entries are told apart by shape, not by key: a wallet record carries `sig` directly, a
// round bucket is a map of wallet records and never does.
//
// WHICH ROUND THEY BELONG TO IS DECIDED BY TIME, NOT BY "whatever draw is current". The first
// version folded every legacy record into the current draw's round on the reasoning that the flat
// shape only ever existed for one draw — true of when those records were WRITTEN, false of when
// this function RUNS. It runs on every payoutOwed()/payoutState() call, forever. So after the next
// promo was drawn, promo 1's records were adopted as promo 2's, and a repeat winner was reported
// as already paid and silently never got their new prize — the exact symptom round-scoping was
// introduced to cure. Worse, it fired on a READ: merely previewing &payout=1 rewrote the money
// record irreversibly.
//
// A legacy record belongs to the current draw only if it was written AFTER that draw was sealed.
// Everything older is parked under 'legacy', which no round ever reads, so the audit trail
// survives and cannot be mistaken for a payment on this round.
function migratePayouts(s) {
  const p = s.payouts;
  if (!p || typeof p !== 'object') return false;
  const legacy = Object.entries(p).filter(([, v]) => v && typeof v === 'object' && typeof v.sig === 'string');
  if (!legacy.length) return false;
  const drawAt = (s.draw && Number(s.draw.at)) || 0;
  const cur = String((s.draw && s.draw.seedHash) || '');
  for (const [wallet, rec] of legacy) {
    const at = Number(rec && rec.at) || 0;
    const belongsToCurrent = !!cur && drawAt > 0 && at >= drawAt;
    const round = belongsToCurrent ? cur : 'legacy';
    p[round] = p[round] || {};
    if (!p[round][wallet]) {
      p[round][wallet] = rec;
    } else {
      // A DISTINCT on-chain transfer with its own signature. Never drop it on the floor — that is
      // audit-trail loss on a money path. Keep the incumbent as the authoritative record and hang
      // the other one off it.
      const prior = p[round][wallet];
      if (prior.sig !== rec.sig) { prior.superseded = (prior.superseded || []).concat([rec]); }
    }
    delete p[wallet];
  }
  return true;
}

function payoutOwed() {
  const s = load();
  if (!s.draw || !s.draw.winners) return { ok: false, error: 'no_draw' };
  if (migratePayouts(s)) save();
  const c = s.config || {};
  // THE DRAW IS FOR ONE TOKEN. s.draw pins the mint it was drawn against; if the config has since
  // been pointed at a different token (setting up the next promo before resetting), paying would
  // send the NEW token, in the OLD amounts, to the OLD winners — and it would succeed cleanly,
  // because decimals are read from whatever mint is current. Refuse instead.
  if (s.draw.mint && c.mint && s.draw.mint !== c.mint) {
    return { ok: false, error: 'mint_changed', drawMint: s.draw.mint, configMint: c.mint };
  }
  // Payout records are scoped to the DRAW that produced them. Keying by wallet alone meant a
  // repeat winner across two promos was filtered out by the PREVIOUS promo's record and silently
  // never paid — while `alreadyPaid` showed a legitimate-looking entry explaining nothing.
  const round = String(s.draw.seedHash || 'nodraw');
  const paid = (s.payouts && s.payouts[round]) || {};
  const dqd = [], flaggedNotBlocked = [];
  const owed = s.draw.winners
    .filter((w) => !w.alternate && Number(w.prize) > 0)
    // PAID FIRST, DQ SECOND. Reversed, an already-paid winner who was later marked showed up in
    // `disqualified` — which reads as "prize vacated, unpaid" when the money is already gone.
    .filter((w) => !paid[w.wallet])
    .filter((w) => {
      // A winner disqualified AFTER the draw (the documented holdcheck → &dq= flow, for someone
      // who dumped between the spin and the payout) was still paid in full: runDraw filters dq at
      // draw time, but this list is read from the sealed draw and never re-checked it.
      //
      // ONLY A HUMAN MAY VACATE A SEALED PRIZE. This deliberately ignores automated flags:
      // traceOutbound sets rec.dq from two-hop transfer HEURISTICS (sent_to_exchange,
      // sold_after_transfer) with no `manual` marker, and undoDq hard-refuses to lift those
      // (scanner_dq_not_reversible). Honouring them here meant one heuristic false positive on a
      // routine post-draw &trace=1 made a sealed winner permanently unpayable, with no override
      // anywhere in the endpoint. A scanner suspicion is a prompt for the owner to look, not a
      // verdict that takes someone's prize.
      const rec = (s.wallets || {})[w.wallet];
      const dq = rec && rec.dq;
      if (dq && dq.manual === true) {
        dqd.push({ wallet: w.wallet, prize: Number(w.prize), reason: dq.reason, manual: true });
        return false;
      }
      if (dq) flaggedNotBlocked.push({ wallet: w.wallet, prize: Number(w.prize), reason: dq.reason,
        note: 'scanner flag only — NOT withheld. Confirm it and &dq= the wallet if the prize should be vacated.' });
      return true;
    })
    .map((w) => ({ wallet: w.wallet, amountUi: Number(w.prize) }));
  // A record that is still `pending` blocks payment exactly like a confirmed one — that is the
  // point, it may already have landed. But it must not block FOREVER: confirmSig gives up at ~90s,
  // which is around blockhash expiry, so the common cause of a pending row is a dropped tx that
  // will never land. Surfaced here with its signature so the operator can check it and clear it
  // with &unpay=<wallet>&sig=<sig>; payoutSweepPending() below does the same automatically.
  const pendingRows = Object.entries(paid).filter(([, p]) => p && p.pending)
    .map(([wallet, p]) => ({ wallet, sig: p.sig, amountUi: p.amountUi, at: p.at }));
  return {
    ok: true,
    owed,
    round,
    drawMint: s.draw.mint || null,
    // Surfaced, never silently skipped: a vacated prize is an owner decision (promote the
    // alternate, or leave it unpaid), and nothing here promotes alternates on its own.
    disqualified: dqd,
    flagged: flaggedNotBlocked,
    pending: pendingRows,
    alreadyPaid: Object.entries(paid).map(([wallet, p]) => ({ wallet, ...p })),
    totalOwed: owed.reduce((t, r) => t + r.amountUi, 0),
  };
}
function recordPayout(rows, roundKey) {
  const s = load();
  migratePayouts(s);
  const round = String(roundKey || (s.draw && s.draw.seedHash) || 'nodraw');
  s.payouts = s.payouts || {};
  s.payouts[round] = s.payouts[round] || {};
  for (const r of (rows || [])) {
    // A row with a SIGNATURE counts, confirmed or not. A sent-but-unconfirmed transfer may
    // already have landed, so it must block a retry exactly like a confirmed one — recording
    // only confirmed rows is what made a confirm timeout pay a winner twice.
    if (!r || !r.wallet || !r.sig) continue;
    if (!s.payouts[round][r.wallet]) {
      s.payouts[round][r.wallet] = { amountUi: r.amountUi, sig: r.sig, at: nowMs(), pending: !!r.pending };
    } else if (s.payouts[round][r.wallet].pending && !r.pending) {
      s.payouts[round][r.wallet].pending = false;   // a later confirm resolves it
    }
  }
  // THROW IF THE WRITE DID NOT LAND. This is the money path: the caller (payoutSpl) stops the
  // batch on a throw, which is the correct trade — unpaid recipients can be paid once the store is
  // writable, double-paid ones cannot be unpaid.
  if (!save()) throw new Error('payout ledger write failed — refusing to report a payment as recorded');
  return s.payouts[round];
}
function payoutState() { const s = load(); if (migratePayouts(s)) save(); return s.payouts || {}; }

// ---- pending records: resolve them instead of leaving a winner unpayable ---------------------
// A `pending` record means "sent, not confirmed" and blocks a retry on purpose. But confirmSig
// gives up around blockhash expiry, so most pending rows are transactions that were DROPPED and
// will never land — and with no way to clear one, that winner could never be paid through this
// endpoint again. The only recourse was hand-editing the file on the Railway volume.
//
// This asks the chain. searchTransactionHistory covers the case where the sig landed but the
// confirm call timed out. A sig the chain does not know, well past expiry, is gone: clear it and
// the winner returns to `owed`. Anything ambiguous is left alone — never guess on money.
const PENDING_EXPIRY_MS = 5 * 60 * 1000;   // comfortably past blockhash expiry (~60-90s)
async function payoutSweepPending({ rpcUrl } = {}) {
  const s = load();
  if (migratePayouts(s)) save();
  const round = String((s.draw && s.draw.seedHash) || 'nodraw');
  const bucket = (s.payouts && s.payouts[round]) || {};
  const rows = Object.entries(bucket).filter(([, p]) => p && p.pending && p.sig);
  if (!rows.length) return { ok: true, checked: 0, confirmed: [], cleared: [], stillPending: [] };
  if (!rpcUrl) return { ok: false, error: 'no_rpc', checked: rows.length };
  let statuses = [];
  try {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
        params: [rows.map(([, p]) => p.sig), { searchTransactionHistory: true }] }) });
    const j = await r.json();
    statuses = (j && j.result && j.result.value) || [];
  } catch (e) { return { ok: false, error: 'rpc_failed', detail: String(e.message || e) }; }
  const confirmed = [], cleared = [], stillPending = [];
  rows.forEach(([wallet, rec], i) => {
    const st = statuses[i];
    const age = nowMs() - (Number(rec.at) || 0);
    if (st && !st.err) { rec.pending = false; rec.confirmedAt = nowMs(); confirmed.push({ wallet, sig: rec.sig }); }
    else if ((st === null || st === undefined || (st && st.err)) && age > PENDING_EXPIRY_MS) {
      // Gone (or landed as an error — no tokens moved either way). Archive it, don't delete it.
      s.payoutsVoid = s.payoutsVoid || [];
      s.payoutsVoid.push({ round, wallet, ...rec, voidedAt: nowMs(), reason: st && st.err ? 'tx_error' : 'never_landed' });
      delete bucket[wallet];
      cleared.push({ wallet, sig: rec.sig, reason: st && st.err ? 'tx_error' : 'never_landed' });
    } else { stillPending.push({ wallet, sig: rec.sig, ageMs: age }); }
  });
  if (!save()) return { ok: false, error: 'write_failed' };
  return { ok: true, checked: rows.length, confirmed, cleared, stillPending };
}

// The manual lever, for when the sweep cannot decide (RPC down, or a sig the chain still reports
// as processed-but-unconfirmed hours later). The signature is REQUIRED and must match: clearing a
// payment record re-opens the door to paying that wallet again, so it must not be possible to do
// casually or by wallet alone. The cleared record is archived, never deleted.
function payoutUnpay(wallet, sig) {
  const s = load();
  if (migratePayouts(s)) save();
  const round = String((s.draw && s.draw.seedHash) || 'nodraw');
  const bucket = (s.payouts && s.payouts[round]) || {};
  const rec = bucket[wallet];
  if (!rec) return { ok: false, error: 'no_record', round };
  if (!sig || rec.sig !== sig) return { ok: false, error: 'sig_mismatch', recordedSig: rec.sig,
    detail: 'pass the exact signature from &payoutstate=1 — verify on-chain that it did NOT land first' };
  s.payoutsVoid = s.payoutsVoid || [];
  s.payoutsVoid.push({ round, wallet, ...rec, voidedAt: nowMs(), reason: 'operator_unpay' });
  delete bucket[wallet];
  if (!save()) return { ok: false, error: 'write_failed' };
  return { ok: true, round, wallet, cleared: rec };
}

// ---- the payout lock lives in the STORE, not in a module variable ----------------------------
// A `let inFlight` boolean guards one process. This file's own config comment says Railway runs
// more than one, and the motivating scenario (Cloudflare 524s the operator at 100s while the run
// is still sending, so they hit the URL again) can land on a different instance — or on a fresh
// one after a redeploy, where the boolean is back to false. Both invocations then read the same
// `owed` and send the full set: every winner paid twice.
//
// TTL'd so a crash cannot wedge the endpoint shut: a lock older than the longest plausible run
// self-clears rather than needing a human.
const PAYOUT_LOCK_TTL_MS = 10 * 60 * 1000;
function payoutLockAcquire(round) {
  const s = load();
  const L = s.payoutLock;
  if (L && L.at && nowMs() - Number(L.at) < PAYOUT_LOCK_TTL_MS) {
    return { ok: false, held: true, since: L.at, ageMs: nowMs() - Number(L.at), round: L.round, pid: L.pid };
  }
  const token = String(nowMs()) + '.' + Math.random().toString(36).slice(2, 10);
  s.payoutLock = { at: nowMs(), pid: process.pid, round: String(round || ''), token };
  if (!save()) return { ok: false, held: false, error: 'write_failed' };
  // Re-read from disk: two processes that raced both wrote, and the LAST write wins. Whoever's
  // token survived the round-trip owns the lock; the loser backs off rather than paying in
  // parallel. Not a true CAS, but it closes the window that matters (two operator clicks seconds
  // apart) without adding a lock service to a single-file store.
  _memMtime = 0;
  const after = load();
  if (!after.payoutLock || after.payoutLock.token !== token) {
    return { ok: false, held: true, since: after.payoutLock && after.payoutLock.at, lostRace: true };
  }
  return { ok: true, token };
}
function payoutLockRelease(token) {
  _memMtime = 0;
  const s = load();
  if (s.payoutLock && (!token || s.payoutLock.token === token)) { s.payoutLock = null; save(); return true; }
  return false;
}
function payoutLockState() { const s = load(); return s.payoutLock || null; }

module.exports = { manualDq, undoDq, checkWinnersStillHolding,
  configure, config, resetLedger, scanOnce, traceOutbound, standings,
  runDraw, drawFromSeed, fullEntryList, setBoardMsgId, boardMsgId,
  payoutOwed, recordPayout, payoutState, payoutSweepPending, payoutUnpay,
  payoutLockAcquire, payoutLockRelease, payoutLockState,
  boardText, postBoard,
};
