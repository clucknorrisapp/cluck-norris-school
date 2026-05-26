// Rolling buy/sell flow accumulator for the CLKN trade bot's periodic recap,
// persisted on the Railway volume at /data/recap.json. This is the reason the
// recap was shelved originally: trade stats kept in memory reset on every
// redeploy, so a recap right after a deploy would show wrong numbers. Now the
// window survives restarts — the bot reloads the in-progress window on boot.
//
// Records every real CLKN swap the poller sees (USD-valued, >= $1 to drop
// dust), tracks buy/sell counts + USD totals, unique buyer/seller wallets, and
// the single biggest buy. snapshot() reads it; reset() starts a fresh window
// (called after a successful recap post). Degrades to in-memory if /data isn't
// writable, same as sigstore/kvstore.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "recap.json");
const RECAP_MIN_USD = Number(process.env.RECAP_MIN_USD || 1);

function emptyWindow() {
  return { windowStart: Date.now(), buyCount: 0, buyUsd: 0, sellCount: 0, sellUsd: 0, buyers: [], sellers: [], topBuy: null };
}
let win = emptyWindow();
let persistent = false;

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && typeof o === "object" && o.windowStart) win = o;
    }
    console.log(`[recap] window since ${new Date(win.windowStart).toISOString()} — ${win.buyCount} buys / ${win.sellCount} sells so far`);
  } catch (e) {
    console.warn(`[recap] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

// Debounced write — trades can cluster, so coalesce rapid records into one
// write a few seconds later instead of hammering the disk per swap.
let dirty = false, timer = null;
function persistSoon() {
  if (!persistent) return;
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null; if (!dirty) return; dirty = false;
    try { fs.writeFileSync(FILE, JSON.stringify(win)); } catch (e) { console.warn(`[recap] persist failed: ${e.message}`); }
  }, 3000);
  if (timer.unref) timer.unref();
}

function record({ action, usd, trader, sig }) {
  if (usd == null || !isFinite(usd) || usd < RECAP_MIN_USD) return;
  if (action === "sell") {
    win.sellCount++; win.sellUsd += usd;
    if (trader && !win.sellers.includes(trader)) win.sellers.push(trader);
  } else {
    win.buyCount++; win.buyUsd += usd;
    if (trader && !win.buyers.includes(trader)) win.buyers.push(trader);
    if (!win.topBuy || usd > win.topBuy.usd) win.topBuy = { usd, trader, sig };
  }
  persistSoon();
}

function snapshot() {
  return {
    windowStart: win.windowStart,
    buyCount: win.buyCount, buyUsd: win.buyUsd,
    sellCount: win.sellCount, sellUsd: win.sellUsd,
    uniqueBuyers: win.buyers.length, uniqueSellers: win.sellers.length,
    netUsd: win.buyUsd - win.sellUsd,
    topBuy: win.topBuy,
  };
}

function reset() {
  win = emptyWindow();
  if (persistent) { try { fs.writeFileSync(FILE, JSON.stringify(win)); } catch (_) {} }
}

module.exports = { record, snapshot, reset, isPersistent: () => persistent };
