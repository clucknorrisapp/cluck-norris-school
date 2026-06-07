const express = require("express");
const path = require("path");
const { join } = path;
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { createSign, createHash, createHmac, randomBytes, createPublicKey, verify: ed25519Verify } = require("crypto");
const hatchery = require("./hatchery");
const securityCoop = require("./securitycoop");
const whirlpoolMM = require("./whirlpool-mm");
const { fetchBagsContext, classifyTeamActivity } = require("./lib/bags-context");
const analytics = require("./lib/analytics");
const solscan = require("./lib/solscan");
const solanaTracker = require("./lib/solana-tracker");
const premiumForensics = require("./lib/premium-forensics");
const sigStore = require("./lib/sigstore");
const kv = require("./lib/kvstore");
const recap = require("./lib/recap");
const gradTracker = require("./lib/grad-tracker");
const credentials = require("./lib/credentials");
const QUESTION_BANK = require("./data/question-bank.json");
const { PublicKey } = require("@solana/web3.js");

// Pump.fun program — used to derive the per-creator "creator vault" PDA where
// Pump creator fees accrue. Seeds ["creator-vault", creator] per the Pump IDL.
// This is the cheap, deterministic way to surface a Pump creator's fee
// earnings without a paid indexer: derive the vault, read its balance
// (unclaimed) + activity. See memory: build-decision-principle.
const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
function derivePumpCreatorVault(creatorWallet) {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), new PublicKey(creatorWallet).toBuffer()],
      PUMP_PROGRAM_ID
    );
    return pda.toBase58();
  } catch (_) { return null; }
}

// Register Oswald (the site's display font) for the score card. Without this,
// Railway's container has no usable fallback for "sans-serif" and text silently
// fails to render. WOFF files are bundled in /public/vendor/fonts/ so this
// doesn't depend on node_modules surviving the Railway deploy.
try {
  const fontsDir = join(__dirname, "public", "vendor", "fonts");
  GlobalFonts.registerFromPath(join(fontsDir, "oswald-700.woff"), "Oswald");
  GlobalFonts.registerFromPath(join(fontsDir, "oswald-400.woff"), "Oswald");
  console.log("[FONT] Oswald registered (has Oswald?", GlobalFonts.has("Oswald") + ")");
} catch (e) {
  console.warn("[FONT] Could not register Oswald — card text may not render:", e.message);
}

// ── Telegram notifications ──────────────────────────────────────────────────
// Posts updates to the Cluck Norris group via a bot. Token + chat ID live in
// Railway env vars — they NEVER touch the repo. If env isn't set, notifications
// just no-op silently so local dev works fine.
async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn("[TELEGRAM] sendMessage failed:", res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("[TELEGRAM] notify error:", e.message);
  }
}

// Toolkit reminder for the community chat. It posts SILENTLY and deletes its
// own previous reminder first — so the chat is never flooded with repeats:
// there is only ever ONE toolkit message present, and it quietly refreshes
// to the bottom on each cycle.
let lastToolsReminderMsgId = kv.get("toolsReminderMsgId", null);
async function notifyToolsReminder() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const text =
    "🛠 <b>THE CLUCK NORRIS TOOLKIT</b>\n\n" +
    "Beyond the school — real, live Solana tools. Five are 100% free; the operator " +
    "tools let you preview everything, then unlock with a small CLKN payment:\n\n" +
    "🩺 <b>Cluck Score</b> — 0–100 health check on any token · <b>FREE</b>\n" +
    "🔒 <b>Security Coop</b> — find &amp; revoke risky wallet approvals · <b>FREE</b>\n" +
    "📸 <b>Snapshot</b> — every holder + airdrop CSV for any token · <b>FREE</b>\n" +
    "🔍 <b>Trace</b> — full wallet × token transaction history · <b>FREE</b>\n" +
    "👥 <b>Holders</b> — true holders vs LP, locks &amp; programs · <b>FREE</b>\n" +
    "🥚 <b>The Hatchery</b> — create a token, guided start to finish · SOL/CLKN\n" +
    "📈 <b>Buy Special</b> + 🌹 <b>Rose</b> — run buy competitions · CLKN\n" +
    "💰 <b>Airdrop</b> — batch-send to hundreds of wallets · CLKN\n\n" +
    "🚨 <b>Have you checked the permissions on your wallet lately?????</b>\n" +
    "Every \"approve\" you've ever signed can still move your tokens — until you " +
    "revoke it. Security Coop finds them all in seconds. Free, nothing at risk.\n\n" +
    "🐔 Everything here → clucknorris.app/tools";
  try {
    if (lastToolsReminderMsgId) {
      // Drop the previous reminder so repeats never pile up in the chat.
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: lastToolsReminderMsgId }),
      }).catch(() => {});
      lastToolsReminderMsgId = null; kv.set("toolsReminderMsgId", null);
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML",
        disable_web_page_preview: true, disable_notification: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.ok && data.result) { lastToolsReminderMsgId = data.result.message_id; kv.set("toolsReminderMsgId", lastToolsReminderMsgId); }
    else console.warn("[TELEGRAM] tools reminder not ok:", JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.warn("[TELEGRAM] tools reminder failed:", e.message);
  }
}

// Fire the toolkit reminder at fixed wall-clock hours (every 6h: 00,06,12,18
// UTC). A fixed schedule, not setInterval — so a server restart doesn't drift or
// delay it; lastToolsReminderHour (persisted on the volume) stops a double-post
// within the hour even across a deploy. NOTE: this is the periodic TOOL-PROMO
// post only; the buy-notification bot is separate and unaffected.
const TOOLS_REMINDER_ENABLED = false; // PAUSED (2026-05-30) — taking a break from the toolkit reminder. Flip to true to resume.
let lastToolsReminderHour = kv.get("toolsReminderHour", -1);
function toolsReminderTick() {
  if (!TOOLS_REMINDER_ENABLED) return;
  const h = new Date().getUTCHours();
  if (h % 6 === 0 && h !== lastToolsReminderHour) {
    lastToolsReminderHour = h; kv.set("toolsReminderHour", h);
    notifyToolsReminder();
  }
}

// ── Bags Launch Radar — 2×/day: recent Bags launches + the 2 closest to
// bonding (with SOL-to-graduate). Content post that drives traffic to /bags.
// buildBagsRadarText() composes the message (also used by the test endpoint
// for dry-run verification); notifyBagsLaunches() posts it.
const BAGS_RADAR_ENABLED = true;
let lastBagsRadarMsgId = kv.get("bagsRadarMsgId", null); // delete-previous, persisted across deploys
async function buildBagsRadarText() {
  let recentLines = [];
  try {
    const fr = await fetch(`${BAGS_BASE}token-launch/feed`, { headers: { "x-api-key": process.env.BAGS_API_KEY } });
    const fd = await fr.json();
    const feed = (fd && fd.response) || [];
    // Enrich the most recent launches, drop obvious test/blank tokens, then
    // surface the 4 with the highest market cap (the notable ones, not dust).
    const enriched = [];
    for (const t of feed.slice(0, 12)) {
      const nm = String(t.symbol || t.name || "").trim().toLowerCase();
      if (!t.tokenMint || nm === "test" || nm === "") continue;
      let mc = 0;
      try { const snap = await getBagsTokenSnapshot(t.tokenMint); if (snap && snap.marketCap) mc = snap.marketCap; } catch (_) {}
      enriched.push({ name: t.name, symbol: t.symbol, mc });
    }
    enriched.sort((a, b) => b.mc - a.mc);
    for (const t of enriched.slice(0, 4)) {
      recentLines.push(`• <b>${t.name || "?"}</b> (${t.symbol || "?"})${t.mc ? ` — MC $${Math.round(t.mc).toLocaleString()}` : ""}`);
    }
  } catch (_) {}
  let gradLines = [];
  try {
    const ng = await getBagsNearGrad();
    for (const t of (ng.tokens || []).slice(0, 2)) {
      const toGrad = (85 * (1 - (t.curvePct || 0) / 100)).toFixed(1);
      gradLines.push(`• <b>${t.name || "?"}</b> (${t.symbol || "?"}) — ${(t.curvePct || 0).toFixed(0)}% · ~${toGrad} SOL to graduate`);
    }
  } catch (_) {}
  if (!recentLines.length && !gradLines.length) return null;
  return "🎒 <b>BAGS.FM LAUNCH RADAR</b>\n\n" +
    (recentLines.length ? "🆕 <b>Recent launches</b>\n" + recentLines.join("\n") + "\n\n" : "") +
    (gradLines.length ? "🎓 <b>Closest to graduating</b>\n" + gradLines.join("\n") + "\n\n" : "") +
    "📡 Live tracker — sort by newest / top MC / near-grad → clucknorris.app/bags";
}
async function notifyBagsLaunches() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const text = await buildBagsRadarText();
    if (!text) return;
    // Delete the previous Radar first so only the latest stays (no pile-up).
    if (lastBagsRadarMsgId) {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: lastBagsRadarMsgId }),
      }).catch(() => {});
      lastBagsRadarMsgId = null; kv.set("bagsRadarMsgId", null);
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.ok && data.result) { lastBagsRadarMsgId = data.result.message_id; kv.set("bagsRadarMsgId", lastBagsRadarMsgId); }
  } catch (e) { console.warn("[TELEGRAM] bags radar failed:", e.message); }
}
// 2×/day (14 & 22 UTC = 10am & 6pm ET), staggered onto hours no other scheduled
// post uses, so the radar never lands stacked on a Market Check / lesson.
const BAGS_RADAR_HOURS_UTC = [14, 22];
let lastBagsRadarHour = kv.get("bagsRadarHour", -1);
function bagsLaunchesTick() {
  if (!BAGS_RADAR_ENABLED) return;
  const now = new Date(), h = now.getUTCHours();
  if (now.getUTCMinutes() < 2 && BAGS_RADAR_HOURS_UTC.includes(h) && h !== lastBagsRadarHour) {
    lastBagsRadarHour = h; kv.set("bagsRadarHour", h);
    notifyBagsLaunches();
  }
}

// ── Market Check — 3×/day: CLKN / SOL / BTC price with 1h + 24h change.
// CLKN from Solana Tracker (price + events), SOL+BTC from CoinGecko markets.
const MARKET_CHECK_ENABLED = true;
let lastMarketCheckMsgId = kv.get("marketCheckMsgId", null); // delete-previous, persisted across deploys
function mcFmtPrice(p) {
  if (p == null || isNaN(p)) return "—";
  const v = Number(p);
  if (v >= 1000) return "$" + Math.round(v).toLocaleString();
  if (v >= 1) return "$" + v.toFixed(2);
  if (v >= 0.01) return "$" + v.toFixed(4);
  return "$" + v.toPrecision(3);
}
function mcFmtChg(pct) {
  if (pct == null || isNaN(pct)) return "—";
  const v = Number(pct);
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
// SOL + BTC from CoinGecko. The free public endpoint hard-rate-limits shared
// cloud IPs (Railway), so scheduled posts were intermittently getting a 429 and
// silently dropping the SOL/BTC lines (leaving only CLKN). Retry a few times,
// optionally authenticate with COINGECKO_API_KEY (a free demo key lifts the
// limit), and fall back to the last good values cached on the volume so the
// lines never just vanish.
async function fetchSolBtc() {
  const KEY = process.env.COINGECKO_API_KEY;
  const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana,bitcoin&price_change_percentage=1h,24h"
    + (KEY ? `&x_cg_demo_api_key=${encodeURIComponent(KEY)}` : "");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const cg = await fetch(url, { headers: KEY ? { "x-cg-demo-api-key": KEY } : {}, signal: AbortSignal.timeout(8000) });
      if (cg.ok) {
        const arr = await cg.json();
        if (Array.isArray(arr) && arr.length) {
          const by = {}; for (const c of arr) by[c.id] = c;
          const sol = by.solana, btc = by.bitcoin;
          if (sol && btc) {
            const data = {
              ts: Date.now(),
              sol: { price: sol.current_price, h1: sol.price_change_percentage_1h_in_currency, h24: sol.price_change_percentage_24h_in_currency },
              btc: { price: btc.current_price, h1: btc.price_change_percentage_1h_in_currency, h24: btc.price_change_percentage_24h_in_currency },
            };
            kv.set("marketSolBtc", data); // remember last good for the fallback
            return data;
          }
        }
      }
    } catch (_) {}
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  // Live fetch failed (almost always a 429). Serve the last good values if not
  // older than 6h — a slightly stale price beats dropping the line entirely.
  const cached = kv.get("marketSolBtc", null);
  if (cached && Date.now() - cached.ts < 6 * 3600 * 1000) return cached;
  return null;
}
// CLKN price + 1h/24h change from Solana Tracker. ST's free tier 429s often, so
// the CLKN line was sometimes dropping the same way SOL/BTC did. Retry a few
// times and fall back to the last good values cached on the volume.
async function fetchClkn() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await solanaTracker.probe("/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS");
      if (r.ok && r.data) {
        const b = r.data, pools = b.pools || [];
        const primary = pools.reduce((best, p) => ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0] || {});
        const price = primary.price?.usd;
        if (price != null) {
          const data = { ts: Date.now(), price, h1: b.events?.["1h"]?.priceChangePercentage, h24: b.events?.["24h"]?.priceChangePercentage };
          kv.set("marketClkn", data); // remember last good for the fallback
          return data;
        }
      }
    } catch (_) {}
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  const cached = kv.get("marketClkn", null);
  if (cached && Date.now() - cached.ts < 6 * 3600 * 1000) return cached;
  return null;
}
async function buildMarketCheckText() {
  const lines = [];
  try {
    const c = await fetchClkn();
    if (c) lines.push(`🐔 <b>CLKN</b> ${mcFmtPrice(c.price)}  ${mcFmtChg(c.h1)} / ${mcFmtChg(c.h24)}`);
  } catch (_) {}
  try {
    const m = await fetchSolBtc();
    if (m && m.sol) lines.push(`◎ <b>SOL</b> ${mcFmtPrice(m.sol.price)}  ${mcFmtChg(m.sol.h1)} / ${mcFmtChg(m.sol.h24)}`);
    if (m && m.btc) lines.push(`₿ <b>BTC</b> ${mcFmtPrice(m.btc.price)}  ${mcFmtChg(m.btc.h1)} / ${mcFmtChg(m.btc.h24)}`);
  } catch (_) {}
  if (!lines.length) return null;
  return "📊 <b>MARKET CHECK</b>  ·  1h / 24h\n\n" + lines.join("\n") + "\n\n🐔 clucknorris.app";
}
async function notifyMarketCheck() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const text = await buildMarketCheckText();
    if (!text) return;
    // Delete the previous Market Check first so the chat only ever shows the
    // latest one (no hourly pile-up). Bots can delete their own msgs <48h old.
    if (lastMarketCheckMsgId) {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: lastMarketCheckMsgId }),
      }).catch(() => {});
      lastMarketCheckMsgId = null; kv.set("marketCheckMsgId", null);
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.ok && data.result) { lastMarketCheckMsgId = data.result.message_id; kv.set("marketCheckMsgId", lastMarketCheckMsgId); }
  } catch (e) { console.warn("[TELEGRAM] market check failed:", e.message); }
}
// Fires every 2h near the top of an even hour (UTC). Minute-gated so it does NOT
// post on every deploy/restart; lastMarketCheckHour persisted on the volume so a
// deploy in the firing window doesn't double-post.
// 3×/day (15, 19, 23 UTC = 11am · 3pm · 7pm ET), interleaved with the lessons
// (13/17/21/01) for a clean ~2-hourly pulse — no two scheduled posts share an hour.
const MARKET_CHECK_HOURS_UTC = [15, 19, 23];
let lastMarketCheckHour = kv.get("marketCheckHour", -1);
function marketCheckTick() {
  if (!MARKET_CHECK_ENABLED) return;
  const now = new Date();
  const h = now.getUTCHours();
  if (now.getUTCMinutes() < 2 && MARKET_CHECK_HOURS_UTC.includes(h) && h !== lastMarketCheckHour) {
    lastMarketCheckHour = h; kv.set("marketCheckHour", h);
    notifyMarketCheck();
  }
}

// ── Daily Flow Recap — once per day (00:00 UTC) the bot posts a summary of the
// CLKN buy/sell flow over the window: buys/sells count + USD, net flow, unique
// buyers, biggest buy. Data comes from lib/recap.js, which accumulates every
// real swap the trade poller sees and PERSISTS on the volume — so a deploy
// mid-day doesn't reset the numbers (the reason this was shelved before).
// Self-cleaning: deletes the previous day's recap so only the latest shows.
// PAUSED until trade volume picks up (2026-05-23) — a daily recap of 0–1 trades
// isn't worth posting. Flip back to true when volume justifies it; the recap
// accumulator keeps running in the background so no data is lost while paused.
const RECAP_ENABLED = false;
let lastRecapMsgId = kv.get("recapMsgId", null); // delete-previous, persisted
function recapFmtUsd(n) { return "$" + Math.round(Number(n) || 0).toLocaleString(); }
function buildRecapText() {
  const s = recap.snapshot();
  const hours = Math.max(1, Math.round((Date.now() - s.windowStart) / 3600000));
  if (s.buyCount === 0 && s.sellCount === 0) {
    return `📊 <b>CLKN — LAST ${hours}H FLOW</b>\n\nQuiet window — no tracked buys or sells.\n\n🐔 clucknorris.app · trade on Bags`;
  }
  const net = s.netUsd;
  const netStr = (net >= 0 ? "+" : "−") + "$" + Math.round(Math.abs(net)).toLocaleString();
  const lines = [
    `🟢 <b>Buys</b>   ${s.buyCount}  ·  ${recapFmtUsd(s.buyUsd)}`,
    `🔴 <b>Sells</b>  ${s.sellCount}  ·  ${recapFmtUsd(s.sellUsd)}`,
    `⚖️ <b>Net flow</b>  ${netStr}`,
    `👥 <b>Unique buyers</b>  ${s.uniqueBuyers}`,
  ];
  if (s.topBuy && s.topBuy.usd) lines.push(`🐳 <b>Biggest buy</b>  ${recapFmtUsd(s.topBuy.usd)}`);
  return `📊 <b>CLKN — LAST ${hours}H FLOW</b>\n\n` + lines.join("\n") + `\n\n🐔 clucknorris.app · trade on Bags`;
}
async function notifyRecap() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const text = buildRecapText();
    if (lastRecapMsgId) {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: lastRecapMsgId }),
      }).catch(() => {});
      lastRecapMsgId = null; kv.set("recapMsgId", null);
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.ok && data.result) {
      lastRecapMsgId = data.result.message_id; kv.set("recapMsgId", lastRecapMsgId);
      recap.reset(); // start a fresh window only after a successful post
    } else {
      console.warn("[TELEGRAM] recap not ok:", JSON.stringify(data).slice(0, 200));
    }
  } catch (e) { console.warn("[TELEGRAM] recap failed:", e.message); }
}
// Daily at 00:00 UTC, minute-gated; lastRecapDay (persisted) prevents a repeat
// or a double-post if a deploy lands in the 00:00 window.
let lastRecapDay = kv.get("recapDay", -1);
function recapTick() {
  if (!RECAP_ENABLED) return;
  const now = new Date();
  const day = now.getUTCFullYear() * 1000 + (now.getUTCMonth() * 31 + now.getUTCDate());
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 2 && day !== lastRecapDay) {
    lastRecapDay = day; kv.set("recapDay", day);
    notifyRecap();
  }
}

// ── Daily locked-supply report ───────────────────────────────────────────────
// PUBLIC community trust signal: how much CLKN is locked (removed from circulation),
// updated daily with the change since the last report. Reads the real on-chain total
// (Jupiter Lock + Streamflow + self-owned), not the broken owner=program query.
const LOCK_REPORT_ENABLED = true;
function fmtTokensShort(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString();
}
// Build the locked-supply report message (+ data). Reads on-chain; does not post.
async function buildLockReport() {
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return { ok: false, error: "no HELIUS_API_KEY" };
  const rpcCall = heliusRpcCall(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`);
  const data = await getLockedSupply(CLKN_MINT, rpcCall);
  if (!data || !data.success) return { ok: false, error: "lock read failed" };
  const prev = kv.get("lockSnapshot", null);
  const pct = data.pctOfSupply != null ? (data.pctOfSupply * 100).toFixed(2) + "%" : "—";
  let deltaLine = "";
  if (prev && typeof prev.tokens === "number") {
    const d = data.totalLocked - prev.tokens;
    deltaLine = Math.abs(d) >= 1
      ? `\n${d > 0 ? "📈 +" : "📉 −"}${fmtTokensShort(Math.abs(d))} CLKN since last report`
      : `\n• No change since last report`;
  }
  const bd = (data.breakdown || []).map(b => `   • ${b.label}: ${fmtTokensShort(b.tokens)} CLKN`).join("\n");
  const msg =
    `🔒 <b>CLKN Locked Supply</b>\n\n` +
    `<b>${fmtTokensShort(data.totalLocked)} CLKN</b> locked — <b>${pct}</b> of supply\n` +
    `Across <b>${data.lockCount}</b> lock account${data.lockCount === 1 ? "" : "s"}` +
    (bd ? `\n${bd}` : "") +
    deltaLine +
    `\n\n🔒 Locked = removed from circulation — a long-term commitment to the project. Verify it yourself on Jupiter Lock:\nhttps://lock.jup.ag/token/${CLKN_MINT}`;
  return { ok: true, data, msg };
}
async function notifyLockReport({ dryRun = false } = {}) {
  const built = await buildLockReport();
  if (!built.ok) return built;
  if (!dryRun) {
    await tgSend(process.env.TELEGRAM_CHAT_ID, built.msg);
    kv.set("lockSnapshot", { tokens: built.data.totalLocked, ts: Date.now() });
  }
  return { ok: true, posted: !dryRun, ...built };
}
// Daily at 16:00 UTC (noon ET), minute-gated; persisted day-guard prevents repeats.
let lastLockReportDay = kv.get("lockReportDay", -1);
function lockReportTick() {
  if (!LOCK_REPORT_ENABLED) return;
  const now = new Date();
  const day = now.getUTCFullYear() * 1000 + (now.getUTCMonth() * 31 + now.getUTCDate());
  if (now.getUTCHours() === 16 && now.getUTCMinutes() < 2 && day !== lastLockReportDay) {
    lastLockReportDay = day; kv.set("lockReportDay", day);
    notifyLockReport().catch(e => console.warn("[LOCKS] daily report failed:", e.message));
  }
}

// ── Daily educational posts ("Cluck's Lesson") ────────────────────────────
// Hybrid: we own the topic list (drawn from the real curriculum — Incubator,
// School of Hard Knocks, LP Lab, security); Claude writes each short lesson in
// Cluck's voice. Fires 4×/day on ODD UTC hours so it never collides with the
// other scheduled posts (which all land on even hours). Topic rotates in order
// (index persisted on the volume) so it never repeats until the set is used up.
// Posts STAY (no self-clean) — they're a learning record.
const EDU_POST_ENABLED = true;
// 4×/day, timed to the busiest crypto-Twitter window (US-dominated): 13/17/21/01
// UTC = 9am · 1pm · 5pm · 9pm ET — full US active day, evening-inclusive. Kept on
// ODD UTC hours so they never collide with the even-hour posts (Market Check / recap).
const EDU_HOURS_UTC = [13, 17, 21, 1];
// X-only @mentions appended to each cross-posted tweet (NOT added to Telegram).
// Easy to trim/remove here if it starts reading as spam.
const X_MENTION_TAGS = "@BagsApp @BagsHackathon";
// Standard footer on lesson X posts: site, Telegram, CLKN contract, mention tags.
// (Telegram posts get their own footer — this is X-only.)
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
// NOTE: a RAW contract address in an X post → 403 "Crypto addresses are
// prohibited for the first 7 days after authentication" (killed every lesson
// cross-post). A DexScreener URL containing the mint PASSES the filter (tested
// 2026-05-25), and gives the X audience a chart/trade link — so we use that
// instead of the bare CA. The bare CA stays on Telegram only.
// CLKN's verified DexScreener pair (CLKN/SOL on Meteora) — the canonical chart link.
const CLKN_DEXSCREENER = "dexscreener.com/solana/64wxkhm4zywukyy32tfuebv5wdafdcugdxe5ntm4xatd";
// Links live in a SELF-REPLY, never the post body — X demotes the reach of posts
// that carry external links, so the lesson itself stays clean and link-free.
// No @-mentions on generic education; @Bags tags are reserved for project/app posts.
const X_LESSON_REPLY = "📚 Full school + free token tools → clucknorris.app\n📊 CLKN chart: " + CLKN_DEXSCREENER + "\n💬 t.me/FireChicken007";
const EDU_TOPICS = [
  "What a self-custody wallet is, and why \"not your keys, not your coins\"",
  "How a decentralized exchange (DEX) differs from a centralized one",
  "What slippage is and how to set it sensibly",
  "What market cap really tells you about a token — and what it doesn't",
  "How to spot a honeypot token before you buy",
  "What token approvals are and why you should revoke unused ones",
  "What a liquidity pool actually is, in plain terms",
  "How automated market makers (AMMs) set prices with the x*y=k formula",
  "Impermanent loss: what it is and when it actually costs you",
  "How liquidity providers earn fees and what drives the yield",
  "Concentrated liquidity: tighter ranges, bigger fees, more risk",
  "Price bins and ticks: how modern LP ranges work",
  "Asks vs bids — the two sides of a market: an ASK is a sell order ABOVE the current price (it sells as price rises); a BID is a buy order BELOW the price (it buys as price falls). In an LP, a range above price holds the token (asks), a range below holds the quote (bids). Single-sided liquidity lets you provide just one side — e.g. a token 'ask wall' that sells into rallies and turns buy pressure into healthy distribution, no fake volume needed.",
  "Active vs passive LP strategies and who each suits",
  "How to read a pool's liquidity, volume, and fee numbers",
  "What a bonding curve is and how token graduation works",
  "Tokenomics basics: supply, distribution, and unlock schedules",
  "What MEV is and how it quietly affects your trades",
  "Sandwich attacks and how loose slippage exposes you to them",
  "How to do basic on-chain research on a token in 2 minutes",
  "Rug pulls: the common patterns and the red flags to catch early",
  "The difference between locked liquidity and locked supply",
  "Why holder concentration matters and how to check it",
  "What renounced or burned mint authority means for a token",
  "Token metadata mutability and update authority — who can change a token's name, image and socials after launch, the bait-and-switch risk vs the legitimate need to rebrand, and why locking it builds buyer trust",
  "How creator fees work on launchpads like Bags.fm",
  "Reading a DexScreener chart without getting faked out by phantom pools",
  "Why dollar-cost averaging beats trying to time the exact bottom",
  "What a stablecoin is and the real risks behind the word \"stable\"",
  "Priority fees on Solana and why transactions sometimes fail",
  "What an RPC is and why your wallet balance sometimes lags",
  "What wrapped SOL (WSOL) is and when you'll run into it",
  "How to verify a token's real contract address before buying",
  "Why low-liquidity tokens are so easy to manipulate",
  "Setting a personal risk budget you can actually afford to lose",
  "What graduation to a DEX pool means for a launchpad token",
  "The danger of unlimited token approvals to unknown contracts",
  "How to tell organic volume from wash trading",
];
async function generateEduLesson(topic, style = "full") {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return null;
  const shape = style === "short"
    ? "HARD LIMIT: 3 sentences MAXIMUM, ~45-65 words total — punchy, no preamble. Then a blank line and a single one-line takeaway."
    : "FORMAT IS REQUIRED: write 2-3 short paragraphs of 1-2 sentences EACH, with a BLANK LINE between every paragraph. Do NOT write one solid block — if it's one paragraph you've done it wrong. After the last paragraph, add a blank line and a single one-line takeaway. Total ~110-170 words.";
  const system = "You are Cluck Norris, the toughest crypto professor at the School of Crypto Hard Knocks (clucknorris.app), powered by the CLKN token on Solana. Write ONE educational micro-lesson on the given topic for a crypto-curious audience. "
    + shape
    + " Plain text only — use blank lines to separate paragraphs, but NO markdown, NO asterisks, NO headings, NO bullet characters, NO emojis. Be accurate and practical; if a point is nuanced, note it honestly rather than oversimplifying. At most ONE light chicken/rooster pun, and only if it fits. NEVER give financial advice, price predictions, or shill any token. Output ONLY the lesson text.";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: style === "short" ? 140 : 360, system, messages: [{ role: "user", content: "Topic: " + topic }] }),
    });
    const data = await res.json();
    if (data && data.content && data.content[0]) {
      return data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").replace(/\n{3,}/g, "\n\n").trim();
    }
  } catch (e) { console.warn("[EDU] generation failed:", e.message); }
  return null;
}

// ── X / Twitter auto-post (dormant until 4 keys are set in Railway) ─────────
// We only CREATE posts on our own account (Content: Create, ~$0.01/post). Posting
// to X API v2 (POST /2/tweets) with OAuth 1.0a user-context signing — no external
// dep, signed with crypto HMAC-SHA1. If any key is missing it's a silent no-op,
// so this ships safely before the dev account exists.
function xConfigured() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
}
function xPercentEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!*'()]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
async function postToX(text, opts = {}) {
  if (!xConfigured()) return { ok: false, skipped: true };
  const ck = process.env.X_API_KEY, cs = process.env.X_API_SECRET, at = process.env.X_ACCESS_TOKEN, ats = process.env.X_ACCESS_SECRET;
  const url = "https://api.x.com/2/tweets";
  const oauth = {
    oauth_consumer_key: ck,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };
  // v2 + JSON body: only the oauth_* params are signed (JSON body is not).
  const paramStr = Object.keys(oauth).sort().map(k => `${xPercentEncode(k)}=${xPercentEncode(oauth[k])}`).join("&");
  const base = `POST&${xPercentEncode(url)}&${xPercentEncode(paramStr)}`;
  const signingKey = `${xPercentEncode(cs)}&${xPercentEncode(ats)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  const authHeader = "OAuth " + Object.keys(oauth).sort().map(k => `${xPercentEncode(k)}="${xPercentEncode(oauth[k])}"`).join(", ");
  try {
    const payload = { text };
    if (opts.replyToId) payload.reply = { in_reply_to_tweet_id: String(opts.replyToId) };  // threaded self-reply (links go here, not the post body)
    const r = await fetch(url, { method: "POST", headers: { Authorization: authHeader, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, id: j?.data?.id };
    console.warn("[X] post failed", r.status, JSON.stringify(j).slice(0, 200));
    return { ok: false, status: r.status, body: j };
  } catch (e) { console.warn("[X] post error", e.message); return { ok: false, error: e.message }; }
}
// Tweet-length (≤280) version of a lesson on the given topic, for X.
async function generateEduTweet(topic) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return null;
  const system = "You are Cluck Norris, a crypto-education project on Solana (clucknorris.app). Write ONE tweet teaching a single crisp insight about the given topic. HARD LIMIT: 270 characters MAX. Plain text, accurate, beginner-friendly, no links, no markdown, no hashtags, at most one emoji, no financial advice. Output ONLY the tweet text.";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 160, system, messages: [{ role: "user", content: "Topic: " + topic }] }),
    });
    const data = await res.json();
    if (data && data.content && data.content[0]) {
      let t = data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").trim();
      if (t.length > 270) t = t.slice(0, 269).trim() + "…";
      return t;  // clean, link-free; any links go in a self-reply at post time
    }
  } catch (e) { console.warn("[X] tweet generation failed:", e.message); }
  return null;
}
async function notifyEduPost() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const idx = kv.get("eduTopicIdx", 0);
  const topic = EDU_TOPICS[idx % EDU_TOPICS.length];
  kv.set("eduTopicIdx", (idx + 1) % EDU_TOPICS.length); // advance rotation
  const style = (idx % 3 === 2) ? "short" : "full";     // mix a punchy short one in every ~3rd lesson
  const body = await generateEduLesson(topic, style);
  if (!body) { console.warn("[EDU] no body, skipping post for topic:", topic); return; }
  const text = `🎓 <b>CLUCK'S LESSON</b>\n\n${tgEsc(body)}\n\n💬 <i>Reply to this lesson with a question and Cluck will answer.</i>\n📚 The full course is in session → clucknorris.app`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true }),
    });
    const data = await res.json().catch(() => null);
    // Remember this post is a LESSON so the reply-bot only answers lesson replies.
    if (data && data.ok && data.result) registerLessonMessage(data.result.message_id, body);
  } catch (e) { console.warn("[EDU] post failed:", e.message); }
  // Cross-post the FULL lesson to X (the account has Premium → long posts), so
  // it's never truncated. Trimmed fallback only if a long post is ever rejected.
  if (xConfigured()) {
    try {
      // Clean, link-free lesson in the post body (max algorithmic reach)…
      let r = await postToX(body);
      if (!r || !r.ok) {
        const short = body.length > 270 ? body.slice(0, 269).trim() + "…" : body;
        r = await postToX(short);
      }
      if (r && r.ok) {
        console.log(`[X] lesson tweeted (id ${r.id})`);
        // …links follow as a self-reply so they never throttle the lesson's reach.
        try { await postToX(X_LESSON_REPLY, { replyToId: r.id }); } catch (_) {}
      } else console.warn("[X] lesson tweet failed:", JSON.stringify(r).slice(0, 200));
    } catch (e) { console.warn("[EDU] X cross-post failed:", e.message); }
  }
}
let lastEduStamp = kv.get("eduStamp", "");
function eduPostTick() {
  if (!EDU_POST_ENABLED) return;
  const now = new Date();
  const h = now.getUTCHours();
  if (now.getUTCMinutes() < 2 && EDU_HOURS_UTC.includes(h)) {
    const stamp = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${h}`;
    if (stamp !== lastEduStamp) { lastEduStamp = stamp; kv.set("eduStamp", stamp); notifyEduPost(); }
  }
}

// ── Live Buy-Competition Leaderboard ("The Siren") ───────────────────────────
// A cumulative-metric live board, posted self-editing into a community's Telegram
// for the run of a token buy competition. The board is explicitly PROVISIONAL —
// it can't fully filter wash-trading in real time; official winners come from the
// retroactive Rose scan after the hold period. State is volume-backed (survives redeploys).
const BUYCOMP_KEY = "buyComps";
let buyCompRunning = false;
function buyCompsAll() { return kv.get(BUYCOMP_KEY, {}); }
function buyCompSave(c) { const all = buyCompsAll(); all[c.id] = c; kv.set(BUYCOMP_KEY, all); }
function buyCompByChat(chatId) {
  return Object.values(buyCompsAll())
    .filter(c => String(c.chatId) === String(chatId) && (c.status === "live" || c.status === "closed"))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}
function buyCompRender(c, standings) {
  const now = Date.now(), ended = now >= c.endTs;
  const medals = ["🥇", "🥈", "🥉"];
  const lines = [
    `🌹 <b>LIVE BUY COMP — $${tgEsc(c.ticker)}</b>`,
    ended ? "⏳ <b>WINDOW CLOSED</b>" : `⏳ ${bcFmtDur(c.endTs - now)} left`,
  ];
  if (c.prizeSummary) lines.push(c.prizeSummary);
  lines.push("");
  const key = buyCompMetricKey(c);
  const rows = (standings || []).slice(0, Math.max(c.places.length, 10));
  if (!rows.length) {
    lines.push("<i>No qualifying buys yet — be the first. 🌹</i>");
  } else {
    rows.forEach((s, i) => {
      const tag = i < 3 ? medals[i] : `${i + 1}.`;
      const short = s.wallet.slice(0, 4) + "…" + s.wallet.slice(-4);
      const prize = (i < c.places.length) ? ` — <b>${c.places[i].amount.toLocaleString()} ${tgEsc(c.ticker)}</b>` : "";
      lines.push(`${tag} <code>${short}</code> · ${(s[key] || 0).toFixed(2)} SOL${prize}`);
    });
  }
  lines.push("");
  const metricLabel = c.metric === "single" ? "biggest single buy" : "cumulative bought";
  lines.push(`<i>metric: ${metricLabel} · refreshes ~${c.updateMins}m · type /buyleaders anytime</i>`);
  lines.push(ended
    ? `⚠️ PROVISIONAL. Winners must hold ${c.holdHours}h (no sells/transfers); official results come from the Rose scan after the hold.`
    : "⚠️ Live &amp; provisional — official winners are confirmed after the hold period via the Rose scan (wash-trade &amp; hold checked).");
  return lines.join("\n");
}
function buyCompMetricKey(c) { return c.metric === "single" ? "maxBuySol" : "volumeSol"; }
async function buyCompStandings(c) {
  const fromSec = Math.floor(c.startTs / 1000);
  const toSec = Math.floor(Math.min(Date.now(), c.endTs) / 1000);
  const r = await solanaTracker.getTokenBuyersInWindow(c.mint, fromSec, toSec, { maxPages: 60 });
  const key = buyCompMetricKey(c);
  return ((r && r.buyers) || []).sort((a, b) => (b[key] || 0) - (a[key] || 0));
}
// Resolve the prize token's mint from the configured kind.
const BC_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BC_SOL_MINT = "So11111111111111111111111111111111111111112";
function buyCompPrizeMint(c) {
  const k = c.prizeToken && c.prizeToken.kind;
  if (k === "usdc") return BC_USDC_MINT;
  if (k === "sol") return BC_SOL_MINT;
  if (k === "spl" && c.prizeToken.mint) return c.prizeToken.mint;
  return c.mint; // native (the competition token)
}
// VERIFY (after the hold period): for the top candidates, check each still holds
// what they bought. Any market sell → DQ. Holds 0 with no sell → transferred out →
// FLAG_MANUAL (operator traces to the runner wallet). Otherwise qualified. DQs
// promote the next eligible wallet up. Uses the ST position (sells + balance).
async function buyCompVerify(c) {
  const standings = await buyCompStandings(c);
  const key = buyCompMetricKey(c);
  const candidates = standings.slice(0, c.places.length + 6);   // buffer for DQs
  const results = [];
  for (const s of candidates) {
    let status = "qualified", note = "still holding";
    try {
      const pos = premiumForensics.parseStPosition(await solanaTracker.getWalletTokenPosition(s.wallet, c.mint));
      if (!pos) { status = "manual"; note = "no position data — verify by hand (Trace)"; }
      else if ((pos.sells || 0) > 0) { status = "dq"; note = `sold on-chain (${pos.sells} sell${pos.sells > 1 ? "s" : ""})`; }
      else if ((pos.balance || 0) <= 0) { status = "manual"; note = "no sells but holds 0 — transferred out; trace to runner wallet"; }
      else { status = "qualified"; note = `holds ${Math.round(pos.balance).toLocaleString()}, no sells`; }
    } catch (e) { status = "manual"; note = "lookup failed — verify by hand"; }
    results.push({ wallet: s.wallet, value: s[key] || 0, status, note });
  }
  // Fill the prize places with non-DQ candidates, in rank order (DQs promote the rest up).
  const eligible = results.filter(r => r.status !== "dq");
  c.verified = eligible.slice(0, c.places.length).map((r, i) => ({ rank: i + 1, wallet: r.wallet, amount: c.places[i].amount, status: r.status, note: r.note }));
  c.verifyResults = results;
  c.verifiedAt = Date.now();
  if (!c.payoutToken) c.payoutToken = randomBytes(8).toString("hex");
  c.status = "verified";
  buyCompSave(c);
  return c;
}
async function buyCompUpdate(c) {
  let standings;
  try { standings = await buyCompStandings(c); }
  catch (e) { console.warn("[BUYCOMP] standings fetch failed:", e.message); return; }
  c.provisional = standings.slice(0, 20).map(s => ({ wallet: s.wallet, volumeSol: s.volumeSol, maxBuySol: s.maxBuySol, buyCount: s.buyCount }));
  const text = buyCompRender(c, standings);
  // Self-cleaning hourly repost: post a fresh board (so it resurfaces in the feed
  // as a "comp is live" reminder), then delete the previous one — one board at a
  // time, no clutter. Silent so it bumps the feed without an hourly ping.
  const prev = c.boardMsgId;
  const mid = await tgSend(c.chatId, text, null, { silent: true });
  if (mid) { c.boardMsgId = mid; if (prev && prev !== mid) tgDelete(c.chatId, prev); }
  c.lastUpdateTs = Date.now();
  buyCompSave(c);
}
async function buyCompTick() {
  if (buyCompRunning) return;
  buyCompRunning = true;
  try {
    const now = Date.now();
    for (const c of Object.values(buyCompsAll())) {
      if (c.status !== "live") continue;
      if (now >= c.endTs) {
        await buyCompUpdate(c);                 // final provisional board
        c.status = "closed"; buyCompSave(c);
        await tgSend(c.chatId, `🏁 <b>$${tgEsc(c.ticker)} buy comp — window closed!</b>\n\nThe board above is the PROVISIONAL standing. Winners must hold their buys for <b>${c.holdHours}h</b> (no sells, no transfers) — official winners are confirmed by the Rose scan after the hold. 🌹`);
        continue;
      }
      if (now >= c.startTs && (!c.lastUpdateTs || now - c.lastUpdateTs >= c.updateMins * 60000)) {
        await buyCompUpdate(c);
      }
    }
  } catch (e) { console.warn("[BUYCOMP] tick error:", e.message); }
  finally { buyCompRunning = false; }
}
// /buyleaders → live on-demand standings, quota-guarded: pulls fresh at most once
// per LB_LIVE_COOLDOWN (else serves the cached snapshot), and won't re-post within
// LB_REPLY_COOLDOWN (so rapid repeats don't spam the chat). Falls back to cache on error.
const LB_REPLY_COOLDOWN = 8000;
const LB_LIVE_COOLDOWN = 45000;
async function buyLeadersReply(c, chatId, replyTo) {
  const now = Date.now();
  if (now - (lbReplyCooldown.get(chatId) || 0) < LB_REPLY_COOLDOWN) return; // ignore rapid repeats
  lbReplyCooldown.set(chatId, now);
  let standings = c.provisional || [];
  if (c.status === "live" && now - (lbCooldown.get(chatId) || 0) >= LB_LIVE_COOLDOWN) {
    lbCooldown.set(chatId, now);
    try {
      standings = await buyCompStandings(c);                 // fresh on-chain pull
      c.provisional = standings.slice(0, 20).map(s => ({ wallet: s.wallet, volumeSol: s.volumeSol, maxBuySol: s.maxBuySol, buyCount: s.buyCount }));
      buyCompSave(c);
    } catch (e) { standings = c.provisional || []; }          // fall back to cache
  }
  tgSend(chatId, buyCompRender(c, standings), replyTo);
}

// ── Interactive slash commands ─────────────────────────────────────────────
// The bot is otherwise send-only; this lets group members run /score, /trace,
// /autopsy, /bags, /hatchery, etc. and get back a deep link (pre-filled with the
// mint/wallet they pass, where the tool page supports it). Delivered via a
// Telegram webhook (the server is public) — a secret_token validates that
// updates really come from Telegram. Slash commands are delivered to bots in
// groups even with privacy mode on, so this works in the Cluck Norris group.
const TG_PUBLIC_BASE = "https://clucknorris.app";
const TG_WEBHOOK_SECRET = process.env.TELEGRAM_BOT_TOKEN
  ? createHash("sha256").update("tg-webhook:" + process.env.TELEGRAM_BOT_TOKEN).digest("hex").slice(0, 40)
  : "";
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 mint/wallet shape

async function tgSend(chatId, text, replyTo, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
        ...(opts.silent ? { disable_notification: true } : {}),
        // Still send even if the user's command message was deleted meanwhile.
        ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    return data && data.ok && data.result ? data.result.message_id : null; // for thread tracking
  } catch (_) { return null; }
}

// Like tgSend, but with an optional inline keyboard (array of button rows).
async function tgSendKb(chatId, text, keyboard, replyTo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
        ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    return data && data.ok && data.result ? data.result.message_id : null;
  } catch (_) { return null; }
}

// Acknowledge a button tap so Telegram stops the loading spinner.
async function tgAnswerCallback(id, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !id) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, ...(text ? { text } : {}) }),
    });
  } catch (_) {}
}

// Edit an existing message in place (for self-refreshing boards). Returns ok bool.
async function tgEdit(chatId, messageId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => null);
    return !!(data && data.ok);
  } catch (_) { return false; }
}
// Delete a message (for self-cleaning reposts).
async function tgDelete(chatId, messageId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch (_) {}
}
// ms → "2d 3h 14m" / "3h 14m" / "14m"
function bcFmtDur(ms) {
  if (ms <= 0) return "0m";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// base58 address before it's used to pre-fill a tool URL).
function tgCommandReply(cmd, arg) {
  const addr = arg && SOL_ADDR_RE.test(arg) ? arg : null;
  const link = (path, qp) => `${TG_PUBLIC_BASE}${path}${addr && qp ? `?${qp}=${addr}` : ""}`;
  switch (cmd) {
    case "score":
      return `🩺 <b>Cluck Score</b> — 0–100 health check on any token\n${link("/score", "mint")}` + (addr ? "" : "\n\nTip: <code>/score &lt;mint&gt;</code> pre-fills a token.");
    case "autopsy":
      return `🪦 <b>Token Autopsy</b> — deep forensic breakdown\n${link("/autopsy", "mint")}` + (addr ? "" : "\n\nTip: <code>/autopsy &lt;mint&gt;</code>.");
    case "trace":
      return `🔍 <b>Trace</b> — full wallet × token transaction history\n${link("/trace", "wallet")}` + (addr ? "" : "\n\nTip: <code>/trace &lt;wallet or mint&gt;</code>.");
    case "snapshot":
      return `📸 <b>Snapshot</b> — every holder + airdrop CSV\n${link("/snapshot", "mint")}` + (addr ? "" : "\n\nTip: <code>/snapshot &lt;mint&gt;</code>.");
    case "holders":
      return `👥 <b>Holders</b> — true holders vs LP, locks &amp; programs\n${link("/holders")}`;
    case "securitycoop":
      return `🔒 <b>Security Coop</b> — find &amp; revoke risky wallet approvals\n${link("/security-coop")}`;
    case "buyspecial":
      return `📈 <b>Buy Special</b> — run a buy competition\n${link("/buyspecial")}`;
    case "rose":
      return `🌹 <b>Rose</b> — buy-competition analyzer with prize models\n${link("/rose")}`;
    case "hatchery":
      return `🥚 <b>The Hatchery</b> — create a token, guided start to finish\n${link("/hatchery")}`;
    case "bags":
      return `🎒 <b>Bags.fm</b> — live launches, near-grad &amp; recently graduated\n${link("/bags")}`;
    case "tools":
      return `🛠 <b>The Cluck Norris Toolkit</b> — every live Solana tool\n${link("/tools")}`;
    default: // start / help / commands
      return "🐔 <b>CLUCK NORRIS BOT — COMMANDS</b>\n" +
        "<i>Each opens the tool on clucknorris.app, with your mint/wallet pre-filled where supported.</i>\n\n" +
        "🩺 /score <code>&lt;mint&gt;</code> — token health 0–100\n" +
        "🪦 /autopsy <code>&lt;mint&gt;</code> — full forensic breakdown\n" +
        "🔍 /trace <code>&lt;wallet&gt;</code> — wallet × token history\n" +
        "📸 /snapshot <code>&lt;mint&gt;</code> — holders + airdrop CSV\n" +
        "👥 /holders — true holders vs LP &amp; locks\n" +
        "🔒 /securitycoop — find &amp; revoke risky wallet approvals\n" +
        "📈 /buyspecial — run a buy competition\n" +
        "🌹 /rose — buy-competition analyzer + prizes\n" +
        "🥚 /hatchery — create a token, guided\n" +
        "🎒 /bags — live Bags.fm launches\n" +
        "🛠 /tools — every tool in one place\n" +
        "📊 /liquidity — live AMM depth &amp; positions\n" +
        "📋 /commands — show this list\n\n" +
        `🐔 ${TG_PUBLIC_BASE}`;
  }
}

// /liquidity — public, sanitized snapshot of the Liquidity Engine's positions.
// Shows only pairs / ranges / in-range — never the wallet, balances, or sizes.
async function liquidityReply(chatId, replyTo) {
  const money = (n) => { n = Number(n) || 0; if (n >= 100) return "$" + Math.round(n).toLocaleString(); if (n >= 1) return "$" + n.toFixed(2); return "$" + n.toFixed(4); };
  const tok = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"; return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 }); };
  try {
    const r = await whirlpoolMM.vault.publicPositions();
    if (!r.enabled) { tgSend(chatId, "📊 The Liquidity Engine isn't running right now.", replyTo); return; }
    if (!r.positions.length) { tgSend(chatId, "📊 No active liquidity positions at the moment.", replyTo); return; }
    let m = "📊 <b>Cluck Norris Liquidity Engine — live depth</b>\n\n";
    for (const p of r.positions) {
      const shape = p.lower >= p.current * 0.999 ? "upside asks (CLKN)"
                  : p.upper <= p.current * 1.001 ? "buy support"
                  : "two-sided";
      const quoteStr = p.quoteSymbol === "USDC" ? money(p.quoteAmount) : (tok(p.quoteAmount) + " SOL");
      m += `• <b>${p.pair}</b> · ${shape} ${p.inRange ? "🟢" : "⚪"}\n`;
      m += `   <b>${money(p.valueUsd)}</b> depth — ${tok(p.clknAmount)} CLKN + ${quoteStr}\n`;
    }
    const vol = fmtUsdShort(await getClkn24hVolume());
    const organic = fmtOrganicScore(await getClknOrganicScore());
    m += `\n💧 <b>Total depth: ${money(r.totalUsd)}</b>`;
    if (vol) m += `  ·  📈 24h vol: <b>${vol}</b>`;
    if (organic) m += `\n🪐 <b>Jupiter organic score: ${organic}</b> <i>(Jupiter's own measure of real, non-faked trading)</i>`;
    m += `\n\n${r.positions.length} active position${r.positions.length > 1 ? "s" : ""} — real depth, real fills, no fake volume. 🐔\n${TG_PUBLIC_BASE}/liquidity`;
    tgSend(chatId, m, replyTo);
  } catch (e) {
    tgSend(chatId, "📊 Couldn't load liquidity positions right now — try again shortly.", replyTo);
  }
}

const TG_KNOWN_CMDS = ["score","autopsy","trace","snapshot","holders","securitycoop","buyspecial","rose","hatchery","bags","tools","liquidity","commands","start","help","guide","buyleaders","chatid"];
const lbCooldown = new Map();      // chatId -> last LIVE pull ts (quota guard)
const lbReplyCooldown = new Map(); // chatId -> last reply ts (chat anti-spam)

// ── "Where do I start?" concierge ──────────────────────────────────────────
// New members get a tagged welcome; /start and /guide open the same menu. Each
// journey button routes to a curated next step; replying to any concierge
// message hands the question to the app-aware guide AI (see answerLessonReply).
const GUIDE_BODY =
  "The coop is a <b>free crypto school</b> + real <b>token-research tools</b> — a lot to take in, so let's get you pointed the right way.\n\n" +
  "<b>Where are you on your crypto journey?</b> Tap one below — or just reply to this message with a question and I'll help. 🐔";
const GUIDE_KEYBOARD = [
  [{ text: "🐣 Brand new to crypto", callback_data: "g:new" }],
  [{ text: "📚 I know the basics", callback_data: "g:basics" }],
  [{ text: "💧 Liquidity pools & LP investing", callback_data: "g:lp" }],
  [{ text: "🔬 Token research & CLKN tools", callback_data: "g:research" }],
  [{ text: "🐔 About Cluck Norris & CLKN", callback_data: "g:about" }],
  [{ text: "🧭 Just exploring", callback_data: "g:explore" }],
];
function guideRoute(key) {
  const B = TG_PUBLIC_BASE;
  switch (key) {
    case "new":
      return "🐣 <b>Brand new? Perfect — start at the very beginning.</b>\n\n" +
        "Begin with the <b>Incubator</b>: tiny, plain-English lessons — what a wallet is, what a token is, how to stay safe. Then walk the <b>12-lesson course</b> (belts Freshman → Emeritus) at your own pace.\n\n" +
        `📚 Start here → ${B}\n\n` +
        "No wallet, no money, no sign-up needed to learn. Reply here any time with a question — that's what I'm for.";
    case "basics":
      return "📚 <b>Got the basics? Time to level up.</b>\n\n" +
        `Finish the <b>12-lesson course</b>, then take the <b>Ultimate Challenge</b> — pass it and you earn a verified, shareable diploma. Want to go deep on liquidity? The <b>LP Lab</b> has 12 advanced lessons.\n\n` +
        `🎓 ${B}\n\nReply with whatever you're stuck on and I'll aim you at the right lesson.`;
    case "lp":
      return "💧 <b>Liquidity pools &amp; LP investing — earn fees, know the risks.</b>\n\n" +
        "The <b>LP Lab</b> is a 12-lesson deep dive: how AMMs work, impermanent loss, concentrated liquidity, fees &amp; earnings, reading a pool, and building a real LP strategy — protocol-agnostic (Meteora, Raydium, Orca, Uniswap).\n\n" +
        `📚 Start the LP Lab → ${B}\n\n` +
        "New to it? Walk Lesson 1 (What Is Liquidity?) first. Reply here with any LP question and I'll break it down.";
    case "research":
      return "🔬 <b>Token research — vet anything on-chain before you trust it.</b>\n\n" +
        `🩺 <b>Cluck Score</b> — 0–100 health check → ${B}/score\n` +
        `🪦 <b>Token Autopsy</b> — deep forensic breakdown → ${B}/autopsy\n` +
        `🔍 <b>Trace</b> — wallet × token history → ${B}/trace\n` +
        `📸 <b>Snapshot</b> — every holder + airdrop CSV → ${B}/snapshot\n` +
        `🔒 <b>Wallet Checkup</b> — find &amp; revoke risky approvals → ${B}/security-coop\n` +
        `🎒 <b>Bags feed</b> — live launches &amp; graduations → ${B}/bags\n\n` +
        "Tip: right here in chat you can run <code>/score &lt;mint&gt;</code>. The chain shows <i>what</i>, never <i>why</i> — always DYOR.";
    case "about":
      return "🐔 <b>About Cluck Norris &amp; CLKN.</b>\n\n" +
        "Cluck Norris is the free <b>School of Crypto Hard Knocks</b> + a Solana token-safety toolkit — born from the FireChicken (FCKN) community, now with real utility.\n\n" +
        "<b>CLKN</b> is the token: it unlocks premium operator tools via a small on-chain payment (no wallet-connect needed), and holding it earns airdrop eligibility and perks. The school itself is always free.\n\n" +
        `🐔 ${B}   ·   the story &amp; grant info → ${B}/investors\n\n` +
        `💸 <b>Get CLKN</b> — it's a Solana DEX swap (no wallet-connect needed for the app): <a href="https://jup.ag/tokens/${CLKN_MINT}">Buy on Jupiter</a>  ·  <a href="https://${CLKN_DEXSCREENER}">Chart</a>\n\n` +
        "Ask me anything about how it all works.";
    case "explore":
      return "🧭 <b>Just exploring? Here's the lay of the land.</b>\n\n" +
        `🛠 Every tool in one place → ${B}/tools\n` +
        `📚 The free school (lessons + Ultimate Challenge) → ${B}\n` +
        `🎰 The Coop Spinner (free daily spins) → ${B}/slots\n\n` +
        "Or just reply with what you're curious about and I'll point you to the right spot. 🐔";
    default:
      return GUIDE_BODY;
  }
}
// App-aware guide persona (used when a reply continues a concierge thread).
function guideSystemPrompt() {
  return [
    "You are Cluck Norris, the friendly guide for the Cluck Norris app (clucknorris.app) — a FREE crypto school ('School of Crypto Hard Knocks') plus a Solana token-research toolkit. You're helping someone in a Telegram group find their way around and answering their crypto/app questions.",
    "WHAT THE APP HAS — route people to the right part:",
    "- The School (free, no wallet or sign-up to learn): the INCUBATOR (tiny beginner lessons: wallets, tokens, staying safe), the 12-LESSON COURSE (belts Freshman→Emeritus), the ULTIMATE CHALLENGE (pass for a verified, shareable diploma), and the LP LAB (12 advanced liquidity lessons).",
    "- Free tools: CLUCK SCORE (clucknorris.app/score — 0-100 token health), TOKEN AUTOPSY (/autopsy — deep forensics), TRACE (/trace — wallet×token history), SNAPSHOT (/snapshot — holders + airdrop CSV), WALLET CHECKUP (/security-coop — find & revoke risky approvals), BAGS feed (/bags — live launches & graduations), and the toolkit index (/tools).",
    "- THE HATCHERY (/hatchery): guided token creation with a safety preview.",
    "- CLKN token: unlocks premium operator tools via a small on-chain payment (no wallet-connect needed); holding it earns airdrop eligibility. The school itself is always free.",
    "- WHERE TO BUY CLKN: it's a normal swap on a Solana DEX — Jupiter is easiest. When asked where to buy, share this exact link: https://jup.ag/tokens/" + CLKN_MINT + " (chart: https://" + CLKN_DEXSCREENER + "). Buying needs a Solana wallet with some SOL; the app itself needs no wallet-connect. This is just logistics, NOT financial advice — never say whether or how much to buy.",
    "HOW TO HELP:",
    "- Work out where the person is (brand new / knows basics / trades & vets tokens / wants to launch / just exploring) and point them to the SINGLE best next step, with a clucknorris.app link.",
    "- Concrete and short: 2-5 sentences — it's a group chat. Plain text only (no markdown, asterisks, or headers).",
    "- Warmly encourage beginners; never make anyone feel dumb.",
    "- Educational ONLY. Never give financial advice, price predictions, or 'should I buy/sell/hold X' — decline and redirect to the concept or the tool that lets them decide for themselves.",
    "- HARD NO: never discuss war, military, geopolitics, elections, politicians, or government policy. If asked, give one short friendly line that you only cover Solana/crypto and the app, and invite a relevant question.",
    "- A light chicken pun is welcome; help first.",
    "- Always end with this exact line on its own: " + REPLYBOT_NFA,
  ].join("\n");
}
// Welcome new chat members (tagged), once per chat per cooldown to survive join waves.
const WELCOME_COOLDOWN_MS = 60000;
const welcomeCooldown = new Map();
async function welcomeNewMembers(msg) {
  const chatId = msg.chat && msg.chat.id;
  const members = (msg.new_chat_members || []).filter(m => m && !m.is_bot);
  if (!chatId || !members.length) return;
  const now = Date.now(), last = welcomeCooldown.get(chatId) || 0;
  if (now - last < WELCOME_COOLDOWN_MS) return;            // anti-spam on join waves
  welcomeCooldown.set(chatId, now);
  const tags = members.slice(0, 8).map(m =>
    `<a href="tg://user?id=${m.id}">${tgEsc(m.first_name || m.username || "friend")}</a>`).join(", ");
  const mid = await tgSendKb(chatId, `🐔 Welcome to the coop, ${tags}!\n\n${GUIDE_BODY}`, GUIDE_KEYBOARD);
  if (mid) registerCluckAnswer(mid, { guide: true, history: [] });
}
// Handle a journey button tap: reply with the curated route, keep it reply-able.
async function handleGuideCallback(cq) {
  try {
    tgAnswerCallback(cq.id);                               // stop the button spinner
    const data = String(cq.data || "");
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const replyTo = cq.message && cq.message.message_id;
    if (!chatId || !data.startsWith("g:")) return;
    const mid = await tgSendKb(chatId, guideRoute(data.slice(2)), null, replyTo);
    if (mid) registerCluckAnswer(mid, { guide: true, history: [] });
  } catch (e) { console.warn("[GUIDE] callback failed:", e.message); }
}

// /score <mint> → compute the real Cluck Score and reply IN-CHAT (number, grade,
// verdict, key stats). Calls our own /api/cluck-score (same as the card gen).
const scoreCooldown = new Map(); // chatId -> last /score ts (light anti-spam)
async function scoreAndReply(chatId, mint, replyTo) {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/cluck-score?mint=${encodeURIComponent(mint)}`);
    const d = await r.json().catch(() => null);
    if (!d || !d.success || d.score == null) {
      tgSend(chatId, `🩺 Couldn't score that one — not enough on-chain data (double-check it's a valid Solana mint).\n\nclucknorris.app/score?mint=${mint}`, replyTo);
      return;
    }
    const f = d.factors || {};
    const fmtUsd = (n) => n == null ? "—" : (n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "K" : "$" + Math.round(n));
    const t10 = f.concentration?.top10Share;
    const t10pct = t10 == null ? null : (t10 <= 1 ? t10 * 100 : t10);
    const lines = [
      `🩺 <b>CLUCK SCORE — ${tgEsc(d.name || d.ticker || "Token")}${d.ticker ? " ($" + tgEsc(d.ticker) + ")" : ""}</b>`,
      `<b>${d.score}/100</b>  ·  Grade ${tgEsc(d.grade)}`,
      ``,
      tgEsc(d.verdict),
      ``,
      `💧 Liquidity ${fmtUsd(f.liquidity?.value)}    👥 ${f.holders?.value ?? "—"} holders`,
      `🔒 Mint ${f.mintAuthority?.revoked ? "revoked ✅" : "active ⚠️"}    ❄️ Freeze ${f.freezeAuthority?.revoked ? "revoked ✅" : "active ⚠️"}`,
      (t10pct != null ? `📊 Top-10 hold ${t10pct.toFixed(0)}%` : ""),
      ``,
      `📋 Full breakdown → clucknorris.app/score?mint=${mint}`,
    ];
    tgSend(chatId, lines.join("\n").replace(/\n{3,}/g, "\n\n"), replyTo);
  } catch (e) {
    console.warn("[TELEGRAM] score reply failed:", e.message);
    tgSend(chatId, `🩺 Score hiccup — try again in a moment.\nclucknorris.app/score?mint=${mint}`, replyTo);
  }
}

// ── Reply-bot: educational Q&A on lesson replies (threaded) ────────────────
// Replying to one of Cluck's 🎓 lesson posts starts a conversation; replying to
// Cluck's ANSWER continues it (we track recent answers + carry the prior Q&A as
// context). Lessons only as entry points; open to everyone; 20 answers/user/day;
// educational only (declines buy/sell/price, refuses war/politics/govt, always
// appends a not-financial-advice line). Replies to a bot's own messages are
// delivered even under group privacy mode, so no privacy change is needed.
const LESSON_RING = 30;            // recent lesson posts that stay reply-able
const ANSWER_RING = 60;            // recent Cluck answers that stay reply-able (follow-ups)
const THREAD_MAX_TURNS = 6;        // Q&A pairs carried forward as conversation context
const REPLY_BOT_DAILY_MAX = 20;    // answers per user per UTC day
const replyBotCooldown = new Map(); // userId -> last answer ts (burst guard)

function registerLessonMessage(messageId, body) {
  if (!messageId) return;
  const ids = kv.get("eduLessonMsgIds", []);
  const texts = kv.get("eduLessonText", {});
  ids.push(messageId);
  texts[messageId] = String(body || "").slice(0, 1200); // context for the AI
  while (ids.length > LESSON_RING) { const drop = ids.shift(); delete texts[drop]; }
  kv.set("eduLessonMsgIds", ids);
  kv.set("eduLessonText", texts);
}
function isLessonMessage(messageId) {
  return !!messageId && kv.get("eduLessonMsgIds", []).includes(messageId);
}
function lessonTextFor(messageId) {
  return kv.get("eduLessonText", {})[messageId] || "";
}
// Track Cluck's OWN answers so a reply to one continues the conversation. Each
// stores its thread = { lesson, history:[{q,a}] }. Bounded ring like lessons.
function registerCluckAnswer(messageId, thread) {
  if (!messageId) return;
  const ids = kv.get("cluckAnswerMsgIds", []);
  const threads = kv.get("cluckThreads", {});
  ids.push(messageId);
  threads[messageId] = thread;
  while (ids.length > ANSWER_RING) { const drop = ids.shift(); delete threads[drop]; }
  kv.set("cluckAnswerMsgIds", ids);
  kv.set("cluckThreads", threads);
}
function isCluckAnswer(messageId) {
  return !!messageId && kv.get("cluckAnswerMsgIds", []).includes(messageId);
}
function threadFor(messageId) {
  return kv.get("cluckThreads", {})[messageId] || null;
}
// Returns true (and increments) if the user is under their daily cap, else false.
function replyBotConsume(userId) {
  if (!userId) return false;
  const today = new Date().toISOString().slice(0, 10); // UTC day
  let usage = kv.get("replyBotUsage", { date: today, counts: {} });
  if (usage.date !== today) usage = { date: today, counts: {} };
  const n = usage.counts[userId] || 0;
  if (n >= REPLY_BOT_DAILY_MAX) { kv.set("replyBotUsage", usage); return false; }
  usage.counts[userId] = n + 1;
  kv.set("replyBotUsage", usage);
  return true;
}
const REPLYBOT_NFA = "Not financial advice — just the coop's classroom. 🐔";

async function answerLessonReply(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const question = String(msg.text || "").trim().slice(0, 1000);
  if (!userId || question.length < 2) return;
  // light burst guard so one user can't rapid-fire
  const now = Date.now(), last = replyBotCooldown.get(userId) || 0;
  if (now - last < 4000) return;
  replyBotCooldown.set(userId, now);
  // daily cap (counts only real answer attempts)
  if (!replyBotConsume(userId)) {
    tgSend(chatId, "🐔 That's 20 questions for today, friend — even Cluck needs to roost. Catch the next lesson tomorrow.\n📚 Full course any time → clucknorris.app", msg.message_id);
    return;
  }
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) { tgSend(chatId, "🐔 Cluck's voice is hoarse right now — try again shortly.", msg.message_id); return; }
  // Reply to a LESSON → fresh thread; reply to a Cluck ANSWER → continue that
  // thread (carry its lesson + prior Q&A). targetId is whatever was replied to.
  const targetId = msg.reply_to_message && msg.reply_to_message.message_id;
  const existing = threadFor(targetId);
  const isGuide = !!(existing && existing.guide);
  const lesson = existing ? existing.lesson : lessonTextFor(targetId);
  const history = existing && Array.isArray(existing.history) ? existing.history : [];
  const system = isGuide ? guideSystemPrompt() : [
    "You are Cluck Norris, a Solana crypto EDUCATOR holding a short conversation in a Telegram group. It started when someone replied to one of your lessons; they may ask follow-ups.",
    "RULES:",
    "- Educational ONLY. Explain how things work: Solana, tokens, LPs/liquidity, wallets, approvals/security, on-chain forensics, launchpads, etc.",
    "- If asked for financial advice, price predictions, 'should I buy/sell/hold X', whether a specific token is a good investment, or anything that isn't a teachable concept: politely DECLINE and redirect to the underlying concept they could learn instead. Never tell anyone what to buy, sell, or hold, and never predict a price.",
    "- HARD NO: never discuss war, armed conflict, the military, foreign affairs/geopolitics, elections, politicians, or government/policy — not even in passing. If a question touches any of these, do NOT engage with the topic at all; reply with one short friendly line that you only cover Solana/crypto education and invite a crypto question instead. Do not take sides or give any opinion on these subjects.",
    "- A FEW light chicken puns are welcome, but teach first, joke second. Stay clear and genuinely useful.",
    "- Be concise: 2-5 short sentences — this is a group chat. Use the conversation so far so follow-ups make sense.",
    "- Plain text only (no markdown headers/bullets/asterisks).",
    "- Always end with this exact line on its own: " + REPLYBOT_NFA,
    lesson ? "For context, the lesson this thread started from said:\n" + lesson : "",
  ].filter(Boolean).join("\n");
  // Replay prior turns as the conversation, then the new question.
  const messages = [];
  for (const turn of history.slice(-THREAD_MAX_TURNS)) {
    if (turn && turn.q) messages.push({ role: "user", content: String(turn.q) });
    if (turn && turn.a) messages.push({ role: "assistant", content: String(turn.a) });
  }
  messages.push({ role: "user", content: question });
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 320, system, messages }),
    });
    const data = await res.json().catch(() => null);
    let answer = data && data.content && data.content[0] && data.content[0].text;
    if (!answer) { tgSend(chatId, "🐔 Couldn't crack that egg — mind rephrasing?", msg.message_id); return; }
    answer = answer.trim();
    if (!/not financial advice/i.test(answer)) answer += "\n\n" + REPLYBOT_NFA; // safety net
    const sentId = await tgSend(chatId, tgEsc(answer), msg.message_id);
    // Register this answer so a reply to IT continues the conversation.
    const newHistory = [...history, { q: question, a: answer }].slice(-THREAD_MAX_TURNS);
    registerCluckAnswer(sentId, { lesson, history: newHistory, guide: isGuide });
  } catch (e) {
    console.warn("[REPLYBOT] answer failed:", e.message);
    tgSend(chatId, "🐔 Cluck hit a snag — try again in a moment.", msg.message_id);
  }
}

function handleTelegramUpdate(update) {
  try {
    // Journey button taps arrive as callback queries.
    if (update && update.callback_query) { handleGuideCallback(update.callback_query); return; }
    // New members → tagged welcome + concierge (a join is a service message, no .text).
    if (update && update.message && Array.isArray(update.message.new_chat_members) && update.message.new_chat_members.length) {
      welcomeNewMembers(update.message); return;
    }
    const msg = update && (update.message || update.edited_message);
    if (!msg || !msg.text || !msg.chat) return;
    const text = msg.text.trim();
    // Reply to a LESSON post (new thread) or to one of Cluck's own ANSWERS
    // (follow-up) → educational answer. Other bot posts (market check, etc.) and
    // slash commands are not triggers.
    const rt = msg.reply_to_message;
    if (text[0] !== "/" && rt && rt.from && rt.from.is_bot
        && (isLessonMessage(rt.message_id) || isCluckAnswer(rt.message_id))) {
      answerLessonReply(msg);
      return;
    }
    if (text[0] !== "/") return;
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0].split("@")[0].toLowerCase(); // strip /cmd@BotName
    if (!TG_KNOWN_CMDS.includes(cmd)) return;          // ignore unknown commands
    const arg = parts[1] || null;
    // /start or /guide → open the "Where do I start?" concierge with buttons.
    if (cmd === "start" || cmd === "guide") {
      tgSendKb(msg.chat.id, `🐔 <b>Welcome to the School of Crypto Hard Knocks.</b>\n\n${GUIDE_BODY}`, GUIDE_KEYBOARD, msg.message_id)
        .then(mid => { if (mid) registerCluckAnswer(mid, { guide: true, history: [] }); });
      return;
    }
    // /chatid → return this chat's numeric id (for wiring a buy-comp in the portal).
    if (cmd === "chatid") {
      tgSend(msg.chat.id, `Chat ID: <code>${msg.chat.id}</code>`, msg.message_id);
      return;
    }
    // /buyleaders → live on-demand standings for this group's active buy competition.
    if (cmd === "buyleaders") {
      const c = buyCompByChat(msg.chat.id);
      if (!c) { tgSend(msg.chat.id, "🌹 No active buy competition in this group right now.", msg.message_id); return; }
      buyLeadersReply(c, msg.chat.id, msg.message_id);
      return;
    }
    // /score with a real mint → live in-chat score (light per-chat cooldown).
    if (cmd === "score" && arg && SOL_ADDR_RE.test(arg)) {
      const now = Date.now(), last = scoreCooldown.get(msg.chat.id) || 0;
      if (now - last < 6000) { tgSend(msg.chat.id, "🐔 Already scoring one — give it a few seconds.", msg.message_id); return; }
      scoreCooldown.set(msg.chat.id, now);
      scoreAndReply(msg.chat.id, arg, msg.message_id);
      return;
    }
    // /liquidity → live, sanitized snapshot of the Liquidity Engine's positions.
    if (cmd === "liquidity") {
      liquidityReply(msg.chat.id, msg.message_id);
      return;
    }
    tgSend(msg.chat.id, tgCommandReply(cmd, arg), msg.message_id);
  } catch (e) { console.warn("[TELEGRAM] update handler error:", e.message); }
}

// Send an image with caption text. Telegram fetches the photo URL itself, so it
// must be publicly accessible. Caption max is 1024 chars (vs 4096 for plain text)
// — fine for our buy alerts which are short. Falls back to plain notify on error.
async function notifyTelegramPhoto(photoUrl, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn("[TELEGRAM] sendPhoto failed, falling back to text:", res.status, body.slice(0, 200));
      // Fallback so we never miss a buy alert just because the image link broke
      await notifyTelegram(caption);
    }
  } catch (e) {
    console.warn("[TELEGRAM] sendPhoto error, falling back to text:", e.message);
    await notifyTelegram(caption);
  }
}

// Format and post a "tool unlocked" notification — fired after every successful
// CLKN micropayment verification so the community sees real product usage.
function notifyToolUnlock(tool, paidAmount, senderWallet, isHolderBonus, signature) {
  const senderShort = senderWallet ? `${senderWallet.slice(0, 4)}…${senderWallet.slice(-4)}` : "verified on-chain";
  const sigLink = signature ? `\n<a href="https://solscan.io/tx/${signature}">↗ View on Solscan</a>` : "";
  let caption;
  if (tool === "premium") {
    // The send is an OWNERSHIP PROOF, not a purchase — full access still depends
    // on the 2M+ CLKN holder check, so say that rather than "unlocked / paid".
    caption =
      `🔬 <b>PREMIUM UNLOCKED</b>\n` +
      `Verifying holder status for full access…\n` +
      `Proof: <b>${paidAmount}</b> CLKN · Sender: <code>${senderShort}</code>` +
      sigLink;
  } else {
    const map = {
      ai:         { emoji: "🤖", name: "AI TUTOR EXTENDED",        detail: "+20 questions" },
      airdrop:    { emoji: "💰", name: "AIRDROP TOOL UNLOCKED",    detail: "1 batch session" },
      buyspecial: { emoji: "📈", name: "BUY-COMP UNLOCKED",        detail: "7 days unlimited" },
    };
    const m = map[tool] || { emoji: "⚡", name: `${tool.toUpperCase()} UNLOCKED`, detail: "" };
    const bonusBadge = isHolderBonus ? " · 5× HOLDER BONUS 🏆" : "";
    caption =
      `${m.emoji} <b>${m.name}</b>${bonusBadge}\n` +
      `<b>${paidAmount}</b> CLKN paid · ${m.detail}\n` +
      `Sender: <code>${senderShort}</code>` +
      sigLink;
  }
  // Use the same Cluck graphic as the buy alerts so every CLKN-spending action
  // feels like a moment in the group. Fire-and-forget so the API response isn't blocked.
  notifyTelegramPhoto(BUY_GRAPHIC_URL, caption).catch(() => {});
}

const app = express();

// Security headers — applied to every response.
// HSTS forces browsers to use HTTPS for this domain for the next year,
// even if a user types http:// or a phishing link tries to downgrade.
// Other headers harden against clickjacking + mime-type sniffing.
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Lightweight in-memory rate limiting ───────────────────────────────────
// The /api proxies forward to PAID upstreams (Helius credits, Anthropic,
// Bags/Solana-Tracker quota) with no per-user auth, so without a cap anyone
// can script them to drain the budget. No external dep (deploys are
// `railway up` only); per-IP sliding window, resets on restart (same tradeoff
// as the in-memory Telegram trackers). Railway sits behind a proxy, so trust
// X-Forwarded-For for the real client IP rather than the proxy's.
app.set("trust proxy", true);

// ── First-party page-view analytics ───────────────────────────────────────
// Counts human page loads (privacy-respecting; see lib/analytics.js). Mounted
// early so it sees every request, but only records GETs to real pages — never
// API calls, vendored libs, or static assets. Wrapped so a tracking hiccup can
// never break a page load.
app.use((req, res, next) => {
  try {
    if (req.method === "GET") {
      const p = req.path || "/";
      const isAsset = /\.(js|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|map|json|txt|xml|webmanifest)$/i.test(p);
      if (!p.startsWith("/api") && !p.startsWith("/vendor") && !isAsset) analytics.trackView(req);
    }
  } catch (_) {}
  next();
});

const RL_BUCKETS = new Map(); // "bucket:ip" -> number[] request timestamps (ms)
function rateLimit(bucket, { windowMs, max }) {
  return (req, res, next) => {
    const ip = req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const now = Date.now();
    // Namespace per limiter so the global /api cap and the tighter per-route
    // caps count independently (a request counts against both its own bucket
    // and the global one, but they don't pollute each other).
    const key = bucket + ":" + ip;
    let arr = RL_BUCKETS.get(key);
    if (!arr) { arr = []; RL_BUCKETS.set(key, arr); }
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ success: false, error: "Rate limit exceeded — slow down." });
    }
    arr.push(now);
    next();
  };
}
// Keep the bucket map from growing unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of RL_BUCKETS) {
    while (arr.length && now - arr[0] > 60000) arr.shift();
    if (arr.length === 0) RL_BUCKETS.delete(k);
  }
}, 120000).unref();

// Generous global cap on the whole API surface — a real user's tool makes only
// a handful of calls per action, so 150/min/IP never bites legitimately but
// stops a scripted hammer. A tighter cap guards the AI endpoint (most costly
// per call); the on-chain payment check is also throttled to deter brute force.
app.use("/api/", rateLimit("api", { windowMs: 60000, max: 150 }));
app.use("/api/ask-cluck", rateLimit("ai", { windowMs: 60000, max: 15 }));
app.use("/api/verify-clkn-payment", rateLimit("pay", { windowMs: 60000, max: 20 }));

// The Hatchery (token creator) — mounted before the global JSON parser so its
// own larger body limit handles the base64 logo upload instead of the 100kb default.
app.use("/api/hatchery", hatchery.router);
app.use("/api/security-coop", securityCoop.router);
// Liquidity Engine — Orca Whirlpools market maker (non-custodial; builds unsigned txs).
app.use("/api/whirlpool", whirlpoolMM.router);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1/";
const JUPITER_LOCK_PROGRAM = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn";

// -- Bags API Proxy --
app.get("/api/bags-proxy", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const { endpoint, ...params } = req.query;
  const API_KEY = process.env.BAGS_API_KEY;
  if (!API_KEY) return res.status(500).json({ success: false, error: "Missing BAGS_API_KEY" });
  if (!endpoint) return res.status(400).json({ success: false, error: "Missing endpoint" });
  // Constrain endpoint to a safe relative path so it can never alter the host
  // (the BAGS_BASE path suffix already blocks the userinfo trick, but this keeps
  // the proxy + its API key pinned to bags.fm even if BAGS_BASE ever changes).
  if (!/^[A-Za-z0-9._\-/]+$/.test(String(endpoint)) || String(endpoint).includes("..")) {
    return res.status(400).json({ success: false, error: "Invalid endpoint" });
  }
  try {
    const queryString = new URLSearchParams(params).toString();
    const url = `${BAGS_BASE}${endpoint}${queryString ? `?${queryString}` : ""}`;
    console.log("-> Bags:", url);
    const response = await fetch(url, { headers: { "x-api-key": API_KEY } });
    const text = await response.text();
    console.log("<- Bags:", response.status, text.slice(0, 150));
    try { return res.status(200).json(JSON.parse(text)); }
    catch (e) { return res.status(500).json({ success: false, error: "Invalid JSON" }); }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Helius -- Holder Count --
// -- Shared token-context endpoint --
// Returns the Bags + Jupiter cross-verification data for a mint so any
// client-side tool (holders, snapshot UI, trace UI, score UI) can render
// verified-creator badges, fee-claim history, and Jupiter audit cross-checks
// without each tool re-implementing the integration. Result is cached per
// mint for 5 minutes (matches the bags-context module's internal cache).
// Solscan auth diagnostic — probes multiple URL/header combos with the
// currently-configured SOLSCAN_API_KEY against a known-good wallet so we
// can see which combo (if any) Solscan accepts. Visit /api/solscan-debug
// after setting / rotating the key.
app.get("/api/solscan-debug", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  // Gated: this exposes key metadata + makes upstream calls on our key. Hidden
  // (404) unless the admin passes the premium key, so it's not a public probe.
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) {
    return res.status(404).json({ error: "not_found" });
  }
  const KEY = process.env.SOLSCAN_API_KEY;
  if (!KEY) return res.status(200).json({ configured: false, message: "SOLSCAN_API_KEY env var is missing on this container" });
  const keyMeta = {
    configured: true,
    length: KEY.length,
    prefix: KEY.slice(0, 6) + "…",
    suffix: "…" + KEY.slice(-4),
    hasWhitespace: /\s/.test(KEY),
    looksLikeJwt: KEY.split(".").length === 3,
  };
  // Probe target — DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS (CLKN mint, a known address)
  const ADDR = req.query.address || "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
  const probes = [
    // Suspected free-tier endpoints
    { name: "v2 chain info",                        url: `https://pro-api.solscan.io/v2.0/chaininfo`,                       headers: { token: KEY } },
    { name: "v2 chain info /chain/info",            url: `https://pro-api.solscan.io/v2.0/chain/info`,                      headers: { token: KEY } },
    { name: "v2 token holders",                     url: `https://pro-api.solscan.io/v2.0/token/holders?address=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS&page=1&page_size=10`, headers: { token: KEY } },
    { name: "v2 token transfer",                    url: `https://pro-api.solscan.io/v2.0/token/transfer?address=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS&page=1&page_size=5`, headers: { token: KEY } },
    { name: "v2 token markets",                     url: `https://pro-api.solscan.io/v2.0/token/markets?address=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS&page=1&page_size=5`,  headers: { token: KEY } },
    { name: "v2 token price",                       url: `https://pro-api.solscan.io/v2.0/token/price?address=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`,                       headers: { token: KEY } },
    { name: "v2 token list (no params)",            url: `https://pro-api.solscan.io/v2.0/token/list?page=1&page_size=5`,                                                          headers: { token: KEY } },
    // Paid tier (known 401 — for reference)
    { name: "v2 account detail (paid tier)",        url: `https://pro-api.solscan.io/v2.0/account/detail?address=${ADDR}`,  headers: { token: KEY } },
    { name: "v2 token meta (paid tier)",            url: `https://pro-api.solscan.io/v2.0/token/meta?address=DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS`,                         headers: { token: KEY } },
  ];
  const results = [];
  for (const p of probes) {
    try {
      const r = await fetch(p.url, { headers: { ...p.headers, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      const body = await r.text();
      results.push({
        probe: p.name,
        url: p.url.replace(KEY, "[KEY]"),
        status: r.status,
        ok: r.ok,
        bodyHead: body.slice(0, 200),
      });
    } catch (e) {
      results.push({ probe: p.name, url: p.url.replace(KEY, "[KEY]"), error: e.message });
    }
  }
  return res.status(200).json({ keyMeta, probes: results });
});

// Solana Tracker free-tier diagnostic — probes the endpoints we actually
// want to use (creator buy-back, traders list, enriched holders, first
// buyers) against the configured SOLANA_TRACKER_API_KEY so we can see
// which ones the free plan exposes before wiring them into the autopsy.
// Visit /api/solana-tracker-debug after deploying the key.
app.get("/api/solana-tracker-debug", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  // Gated: leaks key metadata AND (via ?probe=) is an arbitrary-path proxy to
  // the ST API on our key. Hidden (404) unless the admin passes the premium key.
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) {
    return res.status(404).json({ error: "not_found" });
  }
  const KEY = process.env.SOLANA_TRACKER_API_KEY;
  if (!KEY) return res.status(200).json({ configured: false, message: "SOLANA_TRACKER_API_KEY env var is missing on this container" });
  const keyMeta = {
    configured: true,
    length: KEY.length,
    prefix: KEY.slice(0, 6) + "…",
    suffix: "…" + KEY.slice(-4),
    hasWhitespace: /\s/.test(KEY),
  };
  // Arbitrary-path probe — ?probe=/tokens/multi/graduating etc. Lets us
  // explore ST endpoints (find fresh pump tokens to test, inspect shapes)
  // without redeploying a new hardcoded probe each time. Read-only.
  if (req.query.probe) {
    const r = await solanaTracker.probe(String(req.query.probe));
    return res.status(200).json({
      keyMeta, probePath: req.query.probe, status: r.status, ok: r.ok,
      reason: r.reason,
      body: r.data != null ? r.data : (r.bodyHead || null),
    });
  }
  // Probe targets — CLKN mint + the CLKN dev/creator fee wallet so we get
  // real data, not just an empty 200. Override with ?mint=...&wallet=... .
  const MINT   = req.query.mint   || "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
  const WALLET = req.query.wallet || "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"; // user can pass actual dev wallet
  const probes = [
    // The headline endpoint — single wallet's position on a single token.
    // This is the one we plan to wire into Phase 2G first.
    { name: "wallet→token position (Phase 2G cross-verify)",  path: `/v2/pnl/wallets/${WALLET}/tokens/${MINT}` },
    // Top traders on the mint — replacement for Phase 2F P&L ledger.
    { name: "token traders (top 10 by pnl)",                  path: `/v2/pnl/tokens/${MINT}/traders?sort=pnl&direction=desc&limit=10` },
    // Earliest buyers — sniper detection.
    { name: "token first-buyers (limit 10)",                  path: `/v2/pnl/tokens/${MINT}/first-buyers?limit=10` },
    // Recent trades — shape check for the Buy Special double-check (need
    // per-trade time, type buy/sell, wallet).
    { name: "token trades (recent)",                          path: `/trades/${MINT}` },
    // Holders with identity tags only (lightest enrichment).
    { name: "holders enriched with identity",                 path: `/tokens/${MINT}/holders?enrich=identity` },
    // Holders with PnL too — most useful but possibly higher credit cost.
    { name: "holders enriched with all",                      path: `/tokens/${MINT}/holders?enrich=all` },
    // Wallet-level lifetime summary.
    { name: "wallet lifetime summary",                        path: `/v2/pnl/wallets/${WALLET}` },
    // Cheap baseline calls — should work even on the tightest tier.
    { name: "token info (baseline)",                          path: `/tokens/${MINT}` },
    { name: "token price (baseline)",                         path: `/price?token=${MINT}` },
  ];
  const results = [];
  for (const p of probes) {
    const r = await solanaTracker.probe(p.path);
    results.push({
      probe: p.name,
      path: p.path,
      status: r.status,
      ok: r.ok,
      reason: r.reason,
      // Show a head of the response so you can see whether free tier returns
      // real data or just a quota error. Trim to keep the JSON readable.
      bodyHead: r.bodyHead ? r.bodyHead : (r.data ? JSON.stringify(r.data).slice(0, 5000) : null),
    });
  }
  return res.status(200).json({ keyMeta, mint: MINT, wallet: WALLET, probes: results });
});

// ───────────────────────────────────────────────────────────────────────────
// PRIVATE PREMIUM FORENSICS — /api/autopsy-premium?key=...&mint=...
//
// Gated behind PREMIUM_ACCESS_KEY. Returns 404 when that env var is unset, so
// the endpoint is fully invisible until we choose to enable it, and 403 on a
// bad key. NOT linked anywhere in the free UI. The gate can later become
// token-gating / payment without changing any forensic logic. Report builders
// live in lib/premium-forensics.js. Heavy traces (the reason these are paid):
//   #1 recipient-dump trace — IMPLEMENTED (follow the creator's funnel wallets,
//      prove downstream sells via Solana Tracker per-wallet P&L)
//   #2 P&L Express          — IMPLEMENTED (full wallet ledger via ST traders)
//   #3 creator rap sheet / #4 wallet clusters / #5 money-flow — planned
// ───────────────────────────────────────────────────────────────────────────
// Premium beta access = hold this many CLKN. Easy to lower later, or to add a
// per-use payment path alongside it (the forensic logic doesn't change).
const PREMIUM_HOLDER_THRESHOLD = 2_000_000;

// ── Premium ownership proof ────────────────────────────────────────────────
// Access requires PROVING you own a wallet (not just pasting an address, which
// anyone could copy off the holders list). Two proof paths, both convert into a
// short-lived signed token bound to the proven wallet:
//   • send-7 path  → the on-chain send proves ownership (verify-clkn-payment)
//   • connect path → signMessage signature, verified here (no tx, no approval)
// The token is an HMAC over {wallet, exp} keyed by PREMIUM_ACCESS_KEY, so it
// can't be forged. The heavy run RE-checks the live CLKN balance every time, so
// access always reflects current holdings.
function issuePremiumProof(wallet, ttlMs = 24 * 3600 * 1000) {
  const secret = process.env.PREMIUM_ACCESS_KEY;
  if (!secret || !wallet) return null;
  const body = Buffer.from(JSON.stringify({ w: wallet, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyPremiumProof(token) {
  const secret = process.env.PREMIUM_ACCESS_KEY;
  if (!secret || !token) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig !== expect) return null;            // forged / tampered
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_) { return null; }
  if (!p || !p.w || !p.exp || Date.now() > p.exp) return null; // missing/expired
  return p.w;                                  // the proven wallet
}
// Verify an ed25519 signMessage signature (base64) over `message` for a base58
// Solana wallet, using Node's built-in crypto (no extra dep). Returns bool.
function verifySolanaSignature(message, signatureB64, walletB58) {
  try {
    const pub = new PublicKey(walletB58).toBytes();                 // 32-byte ed25519 key
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub)]);
    const keyObj = createPublicKey({ key: der, format: "der", type: "spki" });
    return ed25519Verify(null, Buffer.from(message, "utf8"), keyObj, Buffer.from(signatureB64, "base64"));
  } catch (_) { return false; }
}
app.get("/api/autopsy-premium", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const GATE = process.env.PREMIUM_ACCESS_KEY;
  if (!GATE) return res.status(404).json({ error: "not_found" });          // private until enabled

  // Access via EITHER the admin key (our own testing) OR a PROOF TOKEN issued
  // after the holder proved wallet ownership (send-7 or connect+sign). A pasted
  // address alone is NOT accepted — the token binds a proven wallet. We re-check
  // the live CLKN balance every run, so access always tracks current holdings.
  const provided = req.query.key || req.headers["x-premium-key"];
  const proof = req.query.proof || req.headers["x-premium-proof"];
  let accessVia = null, holderBalance = null, gateWallet = null;
  if (provided && provided === GATE) {
    accessVia = "admin-key";
  } else if (proof) {
    gateWallet = verifyPremiumProof(proof);           // proven wallet, or null if forged/expired
    if (gateWallet) {
      try { const h = await checkCLKNHolder(gateWallet); holderBalance = h.balance; } catch (_) {}
      if (holderBalance != null && holderBalance >= PREMIUM_HOLDER_THRESHOLD) accessVia = "holder";
    }
  }
  if (!accessVia) {
    if (gateWallet) return res.status(403).json({ error: "insufficient_holdings", balance: holderBalance, threshold: PREMIUM_HOLDER_THRESHOLD });
    return res.status(403).json({ error: "forbidden" });
  }

  const mint = String(req.query.mint || "").trim();
  if (!mint) return res.status(400).json({ error: "mint_required" });

  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const rpcCall = (id, method, params) => fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }).then(r => r.json());
  const heliusTxCache = new Map();
  const scanQuality = { phases: {}, degraded: false };
  const t0 = Date.now();

  try {
    // Resolve the creator the SAME way the autopsy does — the Bags/Pump
    // VERIFIED creator (the dev's operating wallet) first, then ST. ST's
    // token.creator can be a platform/creation wallet that did no funneling,
    // so using it alone made the recipient-dump trace the wrong wallet on Bags
    // tokens (it missed @glittercowboy's 42.7M funnel on GSD entirely).
    let creatorWallet = null, creatorSource = null, claimedFeesSol = null;
    try {
      const bctx = await fetchBagsContext(mint);
      const oc = bctx && bctx.bagsInfo && bctx.bagsInfo.officialCreators && bctx.bagsInfo.officialCreators[0];
      if (oc && oc.wallet) { creatorWallet = oc.wallet; creatorSource = "bags-official"; }
      if (bctx && bctx.bagsInfo && bctx.bagsInfo.totalClaimedSol != null) claimedFeesSol = bctx.bagsInfo.totalClaimedSol;
    } catch (_) {}
    if (!creatorWallet) {
      try {
        const c = await solanaTracker.getTokenCreator(mint);
        if (c && c.wallet) { creatorWallet = c.wallet; creatorSource = "solana-tracker"; }
      } catch (_) {}
    }

    // Supply + decimals for share-of-supply math.
    let supplyTokens = null, tokenDecimals = 9;
    try {
      const sup = await rpcCall("premium-supply", "getTokenSupply", [mint]);
      const v = sup?.result?.value;
      if (v) { tokenDecimals = v.decimals ?? 9; supplyTokens = parseInt(v.amount) / Math.pow(10, tokenDecimals); }
    } catch (_) {}

    // ── FEATURE #1: Recipient-dump trace + FEATURE #5: Money-flow ─────────
    let recipientDump = { feature: "recipient-dump-trace", status: "skipped", reason: !creatorWallet ? "no creator wallet resolved" : "no Helius key" };
    let moneyFlow = { feature: "money-flow-cashout", status: "skipped", reason: !creatorWallet ? "no creator wallet resolved" : "no Helius key" };
    if (creatorWallet && HELIUS_KEY) {
      // Focused scan of the creator's own signatures, collecting transfers of
      // THIS mint OUT of the creator wallet → recipient → tokens. Same parse
      // the free autopsy's Phase 2G uses, scoped to transfers-out only.
      const allSigs = [];
      let before;
      for (let p = 0; p < 4; p++) {
        const params = before ? [creatorWallet, { limit: 1000, before }] : [creatorWallet, { limit: 1000 }];
        const r = await rpcCall(`premium-creator-sigs-${p}`, "getSignaturesForAddress", params);
        const pg = r?.result || [];
        if (pg.length === 0) break;
        allSigs.push(...pg);
        if (pg.length < 1000) break;
        before = pg[pg.length - 1].signature;
      }
      const sigList = allSigs.map(s => s.signature);
      const walk = await heliusEnhancedBatched(sigList, HELIUS_KEY, "premium-recipient", heliusTxCache, scanQuality);
      const outByDest = new Map();
      const airdropRecipients = new Set();   // received via a BATCH send (many recipients in one tx)
      const AIRDROP_BATCH_MIN = 5;
      for (const tx of walk.txs) {
        if (!tx || tx.transactionError) continue;
        const txRecips = [];
        for (const tt of (tx.tokenTransfers || [])) {
          if (tt.mint !== mint) continue;
          if (tt.fromUserAccount === creatorWallet && tt.toUserAccount && tt.toUserAccount !== creatorWallet) {
            const amt = Number(tt.tokenAmount) || 0;
            if (amt > 0) { outByDest.set(tt.toUserAccount, (outByDest.get(tt.toUserAccount) || 0) + amt); txRecips.push(tt.toUserAccount); }
          }
        }
        // One tx paying out to many recipients = a batch airdrop/distribution,
        // not a covert funnel to a few wallets. Tag those recipients.
        if (new Set(txRecips).size >= AIRDROP_BATCH_MIN) txRecips.forEach(w => airdropRecipients.add(w));
      }
      // Cap the per-recipient ST trace to the 25 largest recipients to bound
      // the credit/rate cost; the long tail is rarely the dump vector.
      const sorted = [...outByDest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
      const recipients = [];
      for (const [wallet, tokensReceived] of sorted) {
        let position = null;
        try { position = premiumForensics.parseStPosition(await solanaTracker.getWalletTokenPosition(wallet, mint)); } catch (_) {}
        recipients.push({ wallet, tokensReceived, position });
      }
      // Cross-reference recipients against the autopsy's account classifier so
      // LP pools / token locks / programs are LABELED — not mislabeled as a
      // suspicious "funnel" to people. This is the autopsy context the trace was
      // missing (the whole point of pairing premium with the free report).
      const recipientTypes = await classifyAddressTypes(recipients.map(r => r.wallet), rpcCall);
      for (const r of recipients) {
        const c = recipientTypes.get(r.wallet); if (c) { r.accountType = c.category; r.accountLabel = c.label; }
        // A person who received via a batch send = airdrop recipient, not a covert funnel target.
        if (airdropRecipients.has(r.wallet) && (!r.accountType || r.accountType === "wallet")) { r.accountType = "airdrop"; r.accountLabel = "Batch send"; }
      }
      recipientDump = premiumForensics.buildRecipientDumpReport({ creatorWallet, mint, recipients, supplyTokens, priceCrashTs: null });
      recipientDump.sigsScanned = sigList.length;

      // FEATURE #5: reuse the SAME creator-tx scan to trace SOL out the door —
      // how much went to a CEX (cash-out) vs other wallets.
      // Track SOL out PER destination AND in PER source, so round-trips (the Bags
      // fee-claim 1-SOL float, swap/LP routing) can be NETTED out per counterparty.
      const solOutByDest = new Map();
      const solInBySource = new Map();
      let solInLamports = 0;
      for (const tx of walk.txs) {
        if (!tx || tx.transactionError) continue;
        for (const nt of (tx.nativeTransfers || [])) {
          const amt = Number(nt.amount) || 0;
          if (amt <= 0) continue;
          if (nt.fromUserAccount === creatorWallet && nt.toUserAccount && nt.toUserAccount !== creatorWallet) {
            solOutByDest.set(nt.toUserAccount, (solOutByDest.get(nt.toUserAccount) || 0) + amt);
          } else if (nt.toUserAccount === creatorWallet && nt.fromUserAccount !== creatorWallet) {
            solInLamports += amt;
            solInBySource.set(nt.fromUserAccount, (solInBySource.get(nt.fromUserAccount) || 0) + amt);
          }
        }
      }
      const outEntries = [...solOutByDest.entries()];
      const inEntries = [...solInBySource.entries()];
      const allDests = [...new Set([...solOutByDest.keys(), ...solInBySource.keys()])];
      const destTypes = await classifyAddressTypes(allDests, rpcCall);
      moneyFlow = premiumForensics.buildMoneyFlow({ creatorWallet, solOutByDest: outEntries, solInByDest: inEntries, solInLamports, claimedFeesSol, destTypes });
    }

    // ── FEATURE #2: P&L Express ──────────────────────────────────────────
    let pnlExpress = { feature: "pnl-express", status: "skipped" };
    try {
      const traders = await solanaTracker.getTokenTraders(mint, { sort: "pnl", direction: "desc", limit: 100 });
      pnlExpress = premiumForensics.buildPnlExpress(traders);
    } catch (e) { pnlExpress = { feature: "pnl-express", status: "error", reason: e.message }; }

    // ── FEATURE #3: Creator Rap Sheet ────────────────────────────────────
    // ST keys deploy history off the on-chain DEPLOYER wallet (pool.deployer),
    // not the verified creator — so resolve the deployer from token info, then
    // pull its full launch history with per-token outcomes.
    let creatorRapSheet = { feature: "creator-rap-sheet", status: "skipped", reason: "no deployer wallet resolved" };
    try {
      const info = await solanaTracker.getTokenInfo(mint);
      const pools = info && Array.isArray(info.pools) ? info.pools : [];
      const deployerWallet = pools.length
        ? pools.reduce((best, p) => ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0]).deployer
        : null;
      if (deployerWallet) {
        const dep = await solanaTracker.getDeployerTokens(deployerWallet, { maxPages: 3 });
        if (dep) {
          creatorRapSheet = premiumForensics.buildCreatorRapSheet({
            deployerWallet,
            total: dep.total,
            totalUniqueTokens: dep.totalUniqueTokens,
            tokens: dep.tokens,
          });
        }
      }
    } catch (e) { creatorRapSheet = { feature: "creator-rap-sheet", status: "error", reason: e.message }; }

    // ── FEATURE #4: Wallet clusters (NEUTRAL funding-source map) ──────────
    // The heaviest trace: for the top holders, find each one's first funder and
    // group wallets that share one. Stated as a neutral pattern (presale /
    // airdrop / team / CEX batch / maybe coordination) — never a "ring".
    // Bounded: top 20 holders, ≤2 sig-pages each to reach their oldest tx.
    let walletClusters = { feature: "wallet-clusters", status: "skipped", reason: "no Helius key" };
    if (HELIUS_KEY) {
      try {
        const taRes = await rpcCall("premium-clusters-holders", "getTokenAccounts", { page: 1, limit: 1000, mint, displayOptions: { showZeroBalance: false } });
        const accs = (taRes && taRes.result && taRes.result.token_accounts) || [];
        const top = accs
          .map(a => ({ owner: a.owner, amt: parseInt(a.amount || "0") }))
          .filter(a => a.owner && a.owner !== creatorWallet)
          .sort((x, y) => y.amt - x.amt)
          .slice(0, 20);
        const holders = [];
        for (const h of top) {
          let funder = null, fundingTooDeep = false;
          try {
            // Walk to the wallet's oldest reachable signature (cap 2 pages).
            let before, oldestSig = null, reachedEnd = false;
            for (let p = 0; p < 2; p++) {
              const r = await rpcCall(`pc-sigs-${p}`, "getSignaturesForAddress", before ? [h.owner, { limit: 1000, before }] : [h.owner, { limit: 1000 }]);
              const pg = r && r.result ? r.result : [];
              if (pg.length === 0) { reachedEnd = true; break; }
              oldestSig = pg[pg.length - 1].signature;
              before = oldestSig;
              if (pg.length < 1000) { reachedEnd = true; break; }
            }
            if (!reachedEnd) fundingTooDeep = true;
            if (oldestSig) {
              // The first tx is usually the funding tx — read who sent SOL in.
              const w = await heliusEnhancedBatched([oldestSig], HELIUS_KEY, "premium-cluster-fund", heliusTxCache, scanQuality);
              const tx = (w.txs && w.txs[0]) || null;
              if (tx && Array.isArray(tx.nativeTransfers)) {
                let best = null;
                for (const nt of tx.nativeTransfers) {
                  if (nt.toUserAccount === h.owner && nt.fromUserAccount && nt.fromUserAccount !== h.owner) {
                    if (!best || (Number(nt.amount) || 0) > (Number(best.amount) || 0)) best = nt;
                  }
                }
                if (best) funder = best.fromUserAccount;
              }
            }
          } catch (_) {}
          holders.push({ wallet: h.owner, tokensHeld: h.amt / Math.pow(10, tokenDecimals), funder, fundingTooDeep });
        }
        walletClusters = premiumForensics.buildWalletClusters({ holders });
      } catch (e) { walletClusters = { feature: "wallet-clusters", status: "error", reason: e.message }; }
    }

    return res.status(200).json({
      success: true,
      accessVia, holderBalance,
      mint, creatorWallet, creatorSource,
      supplyTokens: supplyTokens != null ? Math.round(supplyTokens) : null,
      tookMs: Date.now() - t0,
      features: {
        recipientDump,
        pnlExpress,
        creatorRapSheet,
        moneyFlow,
        walletClusters,
      },
    });
  } catch (e) {
    console.error("[PREMIUM] error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Bags "Recent Launches" feed price enrichment via Solana Tracker.
// DexScreener's latest/dex/tokens lags and picks a stale pool for fresh Bags
// bonding-curve tokens — it fed the feed Bounties at $12.6K / -30% when the
// live curve was $7K / -65%. ST reads the curve reserve directly, so MC /
// price / 24h change are accurate for on-curve AND graduated tokens. A short
// SHARED cache keeps ST usage bounded (~N calls per TTL total, regardless of
// how many users are watching the auto-refreshing feed).
const BAGS_FEED_PRICE_CACHE = new Map(); // mint → { data, ts }
const BAGS_FEED_PRICE_TTL = 45000;       // 45s — fresher than the 60s feed refresh
const BAGS_SNAPSHOT_STALE_CAP = 900000;  // 15 min stale-while-error cap

// Shared per-mint Bags/Solana-Tracker snapshot (cached). Reads the curve
// reserve directly so on-curve MC/price/curve% are accurate. Used by BOTH the
// launches feed and the near-graduation board, so a mint fetched for one is
// free for the other within the cache window. Returns null only if ST has
// never returned data for this mint; serves the last good value (stale flag)
// through ST rate-limit blips.
async function getBagsTokenSnapshot(mint) {
  const now = Date.now();
  const cached = BAGS_FEED_PRICE_CACHE.get(mint);
  if (cached && now - cached.ts < BAGS_FEED_PRICE_TTL) return cached.data;
  try {
    const r = await solanaTracker.probe(`/tokens/${mint}`);
    if (!r.ok || !r.data) throw new Error("no-data");
    const b = r.data;
    const pools = Array.isArray(b.pools) ? b.pools : [];
    if (pools.length === 0) throw new Error("no-pools");
    const primary = pools.reduce((best, p) =>
      ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0]);
    const market = primary.market || null;
    const onCurve = solanaTracker.isLaunchpadCurveMarket(market);
    const data = {
      name: b.token?.name || null,
      symbol: b.token?.symbol || null,
      priceUsd: primary.price?.usd ?? null,
      marketCap: primary.marketCap?.usd ?? null,
      liquidityUsd: primary.liquidity?.usd ?? null,
      change24h: b.events?.["24h"]?.priceChangePercentage ?? null,
      volume24h: primary.txns?.volume24h ?? primary.txns?.volume ?? null,
      market,
      onBondingCurve: onCurve,
      curvePct: primary.curvePercentage != null ? Number(primary.curvePercentage) : null,
      createdAt: primary.createdAt || null,
      image: b.token?.image || null,
      twitter: b.token?.twitter || null,
      website: b.token?.website || null,
      source: "solana-tracker",
    };
    BAGS_FEED_PRICE_CACHE.set(mint, { data, ts: now });
    return data;
  } catch (_) {
    if (cached && now - cached.ts < BAGS_SNAPSHOT_STALE_CAP) return { ...cached.data, stale: true };
    return null;
  }
}

app.get("/api/bags-feed-prices", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const mints = String(req.query.mints || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 20);
  if (mints.length === 0) return res.status(200).json({ success: true, prices: {} });
  const out = {};
  await Promise.all(mints.map(async (mint) => { const d = await getBagsTokenSnapshot(mint); if (d) out[mint] = d; }));
  return res.status(200).json({ success: true, prices: out });
});

// Near-graduation board — scans the recent Bags feed and surfaces the tokens
// CLOSEST to graduating off the bonding curve (highest curve %), regardless of
// launch recency (slow bonders are rare, so "close" = real momentum worth
// showcasing). Result cached ~2.5 min; per-mint snapshots reuse the same cache
// the feed uses, and the scan runs in small batches to respect ST rate limits.
const NEAR_GRAD_CACHE = { list: null, ts: 0 };
const NEAR_GRAD_TTL = 300000;   // 5 min — matches the broad watcher tick so the public board + watcher share ONE ST fetch (faster discovery into the hot-watch set; hot tokens are then polled every ~1 min by gradHotTick)
const NEAR_GRAD_SCAN = 45;      // recent launches to scan for curve progress
const BAGS_BONDING_SOL = 85;    // SOL raised to complete a Bags bonding curve
// Bags tokens closest to graduating — platform-wide via ST's "graduating"
// list (one call), filtered to Bags (meteora-curve), sorted by curve % desc.
// Result-cached; reused by the /bags page AND the Telegram launch pulse.
async function getBagsNearGrad() {
  const now = Date.now();
  if (NEAR_GRAD_CACHE.list && now - NEAR_GRAD_CACHE.ts < NEAR_GRAD_TTL) {
    return { tokens: NEAR_GRAD_CACHE.list, cached: true };
  }
  const r = await solanaTracker.probe("/tokens/multi/graduating");
  const arr = Array.isArray(r.data) ? r.data : [];
  const out = [];
  for (const item of arr) {
    const tok = item.token || {};
    const pools = Array.isArray(item.pools) ? item.pools : [];
    if (pools.length === 0 || !tok.mint) continue;
    const primary = pools.reduce((best, p) => ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0]);
    // ONLY real Bags tokens — the mint's "bags" vanity suffix is authoritative.
    // market === "meteora-curve" alone leaked non-Bags curve tokens.
    const isBags = String(tok.mint).toLowerCase().endsWith("bags");
    if (!isBags || primary.curvePercentage == null) continue;
    const curvePct = Number(primary.curvePercentage);
    // A full curve (>=100%) has already bonded — it belongs on Recently
    // Graduated, not "near grad". Drop it.
    if (curvePct >= 100) continue;
    out.push({
      tokenMint: tok.mint,
      name: tok.name, symbol: tok.symbol, image: tok.image, twitter: tok.twitter,
      priceUsd: primary.price?.usd ?? null,
      marketCap: primary.marketCap?.usd ?? null,
      change24h: item.events?.["24h"]?.priceChangePercentage ?? null,
      volume24h: primary.txns?.volume24h ?? primary.txns?.volume ?? null,
      curvePct,
      solRaised: +(BAGS_BONDING_SOL * curvePct / 100).toFixed(2),       // of 85 SOL
      solToGrad: +(BAGS_BONDING_SOL * (1 - curvePct / 100)).toFixed(2), // SOL left to bond
      createdAt: primary.createdAt || null,
    });
  }
  out.sort((a, b) => (b.curvePct || 0) - (a.curvePct || 0));
  let top = out.slice(0, 15);
  // Authoritative double-check on the highest-% candidates: ST's "graduating"
  // feed can lag and still list a token that has actually bonded (the case that
  // made a $92k/99.3% token look already-graduated). getBagsTokenSnapshot reads
  // the curve reserve directly, so onBondingCurve===false (now on an AMM) =
  // graduated → drop it. Only the most-at-risk (>=90%) are checked, reusing the
  // shared snapshot cache, so ST usage stays bounded.
  const atRisk = top.filter(t => t.curvePct >= 90).map(t => t.tokenMint).slice(0, 6);   // bound per-candidate ST snapshot rechecks
  if (atRisk.length) {
    const bonded = new Set();
    await Promise.all(atRisk.map(async (mint) => {
      const snap = await getBagsTokenSnapshot(mint);
      if (snap && (snap.onBondingCurve === false || (snap.curvePct != null && snap.curvePct >= 100))) bonded.add(mint);
    }));
    if (bonded.size) top = top.filter(t => !bonded.has(t.tokenMint));
  }
  NEAR_GRAD_CACHE.list = top; NEAR_GRAD_CACHE.ts = now;
  return { tokens: top, cached: false, scanned: arr.length };
}

app.get("/api/bags-near-grad", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = await getBagsNearGrad();
    return res.status(200).json({ success: true, cached: r.cached, scanned: r.scanned, tokens: r.tokens });
  } catch (e) {
    if (NEAR_GRAD_CACHE.list) return res.status(200).json({ success: true, cached: true, stale: true, tokens: NEAR_GRAD_CACHE.list });
    return res.status(200).json({ success: false, tokens: [], error: e.message });
  }
});

// Recently-graduated Bags tokens — ST's platform-wide "graduated" list,
// filtered to Bags (Bags graduates to Meteora DAMM v2 = market meteora-dyn-v2;
// other launchpads graduate to pumpfun-amm / raydium-*). Order preserved =
// most recently graduated first. Result-cached. Each carries a DexScreener
// link for the migrated LP.
const GRADUATED_CACHE = { list: null, ts: 0 };
const GRADUATED_TTL = 600000; // 10 min — graduated board changes slowly; share one ST fetch across loads
async function getBagsGraduated() {
  const now = Date.now();
  if (GRADUATED_CACHE.list && now - GRADUATED_CACHE.ts < GRADUATED_TTL) return { tokens: GRADUATED_CACHE.list, cached: true };
  const r = await solanaTracker.probe("/tokens/multi/graduated");
  const arr = Array.isArray(r.data) ? r.data : [];
  const out = [];
  for (const item of arr) {
    const tok = item.token || {};
    const pools = Array.isArray(item.pools) ? item.pools : [];
    if (pools.length === 0 || !tok.mint) continue;
    const primary = pools.reduce((best, p) => ((p.liquidity || {}).usd || 0) > ((best.liquidity || {}).usd || 0) ? p : best, pools[0]);
    // ONLY real Bags tokens — the mint's "bags" vanity suffix is the
    // authoritative signal. Market === meteora-dyn-v2 is too loose: other
    // launchpads also graduate to Meteora DAMM v2, so it leaked non-Bags tokens.
    const isBags = String(tok.mint).toLowerCase().endsWith("bags");
    if (!isBags) continue;
    out.push({
      tokenMint: tok.mint, name: tok.name, symbol: tok.symbol, image: tok.image, twitter: tok.twitter,
      priceUsd: primary.price?.usd ?? null,
      marketCap: primary.marketCap?.usd ?? null,
      change24h: item.events?.["24h"]?.priceChangePercentage ?? null,
      volume24h: primary.txns?.volume24h ?? primary.txns?.volume ?? null,
      liquidityUsd: primary.liquidity?.usd ?? null,
      createdAt: primary.createdAt || null,
    });
  }
  const top = out.slice(0, 15);
  GRADUATED_CACHE.list = top; GRADUATED_CACHE.ts = now;
  return { tokens: top, cached: false, scanned: arr.length };
}

// Escape API/token strings for Telegram HTML messages — a token named "<b>" or
// "&" would otherwise make Telegram reject the whole message (can't parse
// entities). Escaping & < > is enough for HTML text context.
function tgEsc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// The Recently-Graduated BOARD = our own tracked 48h record (reliable for Bags,
// unaffected by pump.fun flooding ST's global feed) merged with any Bags-suffix
// graduates ST happens to still show (dedup, additive). Our records are enriched
// with a live snapshot so MC/price reflect now, not graduation time; createdAt =
// graduatedAt so each card shows "graduated Xh ago". Cached separately (150s).
const GRAD_BOARD_CACHE = { list: null, ts: 0 };
async function getBagsGraduatedBoard() {
  const now = Date.now();
  if (GRAD_BOARD_CACHE.list && now - GRAD_BOARD_CACHE.ts < GRADUATED_TTL) return { tokens: GRAD_BOARD_CACHE.list, cached: true };
  const seen = new Set();
  const tokens = [];
  for (const g of gradTracker.listGraduated()) {       // newest-first, last 48h
    if (seen.has(g.mint)) continue; seen.add(g.mint);
    let snap = null; try { snap = await getBagsTokenSnapshot(g.mint); } catch (_) {}
    tokens.push({
      tokenMint: g.mint, name: g.name, symbol: g.symbol, image: g.image, twitter: g.twitter,
      priceUsd: snap?.priceUsd ?? g.priceUsd ?? null,
      marketCap: snap?.marketCap ?? g.marketCap ?? null,
      change24h: snap?.change24h ?? null,
      volume24h: snap?.volume24h ?? null,
      createdAt: g.graduatedAt,
      source: "tracked",
    });
  }
  try {                                                 // additive supplement from ST
    const st = await getBagsGraduated();
    for (const t of (st.tokens || [])) { if (!seen.has(t.tokenMint)) { seen.add(t.tokenMint); tokens.push(t); } }
  } catch (_) {}
  tokens.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // most recently graduated first
  const top = tokens.slice(0, 15);
  GRAD_BOARD_CACHE.list = top; GRAD_BOARD_CACHE.ts = now;
  return { tokens: top, cached: false };
}

app.get("/api/bags-graduated", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = await getBagsGraduatedBoard();
    return res.status(200).json({ success: true, cached: r.cached, tokens: r.tokens });
  } catch (e) {
    if (GRAD_BOARD_CACHE.list) return res.status(200).json({ success: true, cached: true, stale: true, tokens: GRAD_BOARD_CACHE.list });
    return res.status(200).json({ success: false, tokens: [], error: e.message });
  }
});

// ── Bags graduation watcher ────────────────────────────────────────────────
// Every few minutes: scan the Bags near-bonding list, alert once when a token
// crosses 85% to graduation, and when a watched token leaves the near-grad list
// having actually graduated (off the curve = has a DEX pool), record it to our
// 48h tracker and post a "graduated!" alert. Both alerts stay in the chat.
const GRAD_WATCH_ENABLED = true;
const NEAR_BONDING_ALERT_PCT = 70;
// Extract a valid @handle from a token's twitter field (URL or raw handle) so
// project-specific X posts can tag the project. Validates against Twitter's
// handle rules; returns "" if the value isn't a plausible handle.
function xHandle(twitter) {
  if (!twitter) return "";
  const h = String(twitter).trim()
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "")
    .replace(/^@/, "")
    .split(/[\/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? "@" + h : "";
}
async function notifyNearBonding(t) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  const cp = t.curvePct || 0;
  const toGrad = (85 * (1 - cp / 100)).toFixed(1);
  if (token && chatId) {
    const text = `⚡ <b>CLOSE TO BONDING</b>\n\n🎒 <b>${tgEsc(t.name || "?")}</b> (${tgEsc(t.symbol || "?")})\n${cp.toFixed(0)}% to graduation · ~${toGrad} SOL to go\n\n📡 Watch it live → clucknorris.app/bags`;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
    } catch (e) { console.warn("[TELEGRAM] near-bonding alert failed:", e.message); }
  }
  if (xConfigured()) {
    const h = xHandle(t.twitter);
    const label = String(t.symbol || t.name || "A Bags token").slice(0, 24);
    const tw = `⚡ ${label} is ${cp.toFixed(0)}% to graduation on Bags — ~${toGrad} SOL to bond.${h ? " " + h : ""}\n\n📡 clucknorris.app/bags ${X_MENTION_TAGS}`;
    try { await postToX(tw); } catch (_) {}
  }
}
async function notifyGraduated(rec) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    const text = `🎓 <b>GRADUATED!</b>\n\n🎒 <b>${tgEsc(rec.name || "?")}</b> (${tgEsc(rec.symbol || "?")}) just bonded off the Bags curve onto its Meteora pool.\n\n📊 Chart → https://dexscreener.com/solana/${rec.mint}`;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
    } catch (e) { console.warn("[TELEGRAM] graduated alert failed:", e.message); }
  }
  if (xConfigured()) {
    const h = xHandle(rec.twitter);
    const label = String(rec.symbol || rec.name || "A Bags token").slice(0, 24);
    const tw = `🎓 ${label} just graduated off the Bags curve onto its Meteora pool!${h ? " " + h : ""}\n\n📊 dexscreener.com/solana/${rec.mint}\n${X_MENTION_TAGS}`;
    try { await postToX(tw); } catch (_) {}
  }
}
async function gradWatcherTick() {
  if (!GRAD_WATCH_ENABLED) return;
  let near;
  try { near = (await getBagsNearGrad()).tokens || []; } catch (_) { return; }
  const nearByMint = new Map(near.map(t => [t.tokenMint, t]));
  // 1) Track every near-grad Bags token; alert once when it crosses the near-grad threshold.
  for (const t of near) {
    const w = gradTracker.getWatch(t.tokenMint) || { firstSeenTs: Date.now(), alerted: false };
    const cp = t.curvePct || 0;
    if (!w.alerted && cp >= NEAR_BONDING_ALERT_PCT) { await notifyNearBonding(t); w.alerted = true; }
    gradTracker.setWatch(t.tokenMint, {
      symbol: t.symbol, name: t.name, image: t.image, twitter: t.twitter,
      lastCurvePct: cp, lastSeenTs: Date.now(), firstSeenTs: w.firstSeenTs, alerted: w.alerted,
    });
  }
  // 2) For watched tokens that dropped off near-grad: did they graduate?
  for (const mint of gradTracker.watchedMints()) {
    if (nearByMint.has(mint)) continue;
    const w = gradTracker.getWatch(mint) || {};
    let snap = null; try { snap = await getBagsTokenSnapshot(mint); } catch (_) {}
    if (snap && snap.onBondingCurve === false) {
      const rec = { mint, name: snap.name || w.name, symbol: snap.symbol || w.symbol, image: snap.image || w.image, twitter: snap.twitter || w.twitter, graduatedAt: Date.now(), marketCap: snap.marketCap, priceUsd: snap.priceUsd };
      if (gradTracker.addGraduated(rec)) { await notifyGraduated(rec); console.log(`[GRAD-WATCH] ${rec.symbol || mint.slice(0,6)} graduated — recorded + alerted`); }
      gradTracker.removeWatch(mint);
    } else if (snap && snap.onBondingCurve === true) {
      // Still on curve, just not in the top-15 near-grad slice. Age out if it's
      // been stalled (not seen near-grad) for 12h so the watchlist stays small.
      if (w.lastSeenTs && Date.now() - w.lastSeenTs > 12 * 3600 * 1000) gradTracker.removeWatch(mint);
    } else {
      // No data this cycle; retry next time, but drop very stale entries (24h).
      if (w.firstSeenTs && Date.now() - w.firstSeenTs > 24 * 3600 * 1000) gradTracker.removeWatch(mint);
    }
  }
}
// HOT WATCH — once a token has tripped "close to bonding" (alerted), poll IT every
// minute (snapshot cache is 45s, so always fresh) so we catch & post the actual
// graduation within ~1 min instead of waiting for the next slow broad tick. Bounded
// to the few hottest tokens, so ST cost stays tiny (zero when nothing's near grad).
let gradHotRunning = false;
async function gradHotTick() {
  if (!GRAD_WATCH_ENABLED || gradHotRunning) return;
  gradHotRunning = true;
  try {
    const hot = gradTracker.watchedMints()
      .map(m => ({ mint: m, w: gradTracker.getWatch(m) || {} }))
      .filter(x => x.w.alerted)                                  // only the "close to bonding" ones
      .sort((a, b) => (b.w.lastCurvePct || 0) - (a.w.lastCurvePct || 0))
      .slice(0, 10);                                             // cap the fast-poll set
    for (const { mint, w } of hot) {
      let snap = null; try { snap = await getBagsTokenSnapshot(mint); } catch (_) {}
      if (!snap) continue;
      if (snap.onBondingCurve === false) {
        const rec = { mint, name: snap.name || w.name, symbol: snap.symbol || w.symbol, image: snap.image || w.image, twitter: snap.twitter || w.twitter, graduatedAt: Date.now(), marketCap: snap.marketCap, priceUsd: snap.priceUsd };
        if (gradTracker.addGraduated(rec)) { await notifyGraduated(rec); console.log(`[GRAD-HOT] ${rec.symbol || mint.slice(0, 6)} graduated — caught within ~1m`); }
        gradTracker.removeWatch(mint);
      } else if (snap.curvePct != null) {
        gradTracker.setWatch(mint, { lastCurvePct: snap.curvePct, lastSeenTs: Date.now() });  // keep ordering fresh
      }
    }
  } catch (e) { console.warn("[GRAD-HOT] error:", e.message); }
  finally { gradHotRunning = false; }
}

// X / Twitter status + live test (gated). Returns whether the 4 X keys are set;
// &post=1 posts a tweet (uses &text=... or a default) so you can verify posting
// works the moment the keys are added in Railway.
app.get("/api/x-post-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) return res.status(404).json({ error: "not_found" });
  if (!xConfigured()) return res.status(200).json({ configured: false, message: "Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET in Railway." });
  if (req.query.post === "1") {
    const text = req.query.text ? String(req.query.text) : "🐔 Cluck Norris is online. Crypto lessons incoming. clucknorris.app";
    const r = await postToX(text);
    return res.status(200).json({ configured: true, posted: r.ok, result: r });
  }
  return res.status(200).json({ configured: true, posted: false, hint: "add &post=1 to send a test tweet" });
});

// Cluck's Lesson — dry-run/preview (gated). Returns a freshly generated lesson
// for the NEXT topic in rotation without advancing it; &post=1 advances the
// rotation and actually posts to the group. &topic=<text> overrides the topic.
app.get("/api/edu-post-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) return res.status(404).json({ error: "not_found" });
  try {
    if (req.query.post === "1") { await notifyEduPost(); return res.status(200).json({ success: true, posted: true }); }
    const idx = kv.get("eduTopicIdx", 0);
    const topic = req.query.topic ? String(req.query.topic) : EDU_TOPICS[idx % EDU_TOPICS.length];
    const style = req.query.style === "short" ? "short" : (req.query.style === "full" ? "full" : ((idx % 3 === 2) ? "short" : "full"));
    const body = await generateEduLesson(topic, style);
    return res.status(200).json({ success: true, posted: false, nextTopicIdx: idx, topic, style, preview: body });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Graduation-watcher status (gated). Shows the current watchlist + our 48h
// graduated record; ?run=1 triggers one watcher cycle now (alerts fire if a
// token actually crosses 85% / graduates).
app.get("/api/grad-watch-status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) return res.status(404).json({ error: "not_found" });
  if (req.query.run === "1") { try { await gradWatcherTick(); } catch (_) {} }
  const watched = {}; for (const m of gradTracker.watchedMints()) watched[m] = gradTracker.getWatch(m);
  return res.status(200).json({
    persistent: gradTracker.isPersistent(), enabled: GRAD_WATCH_ENABLED, alertThresholdPct: NEAR_BONDING_ALERT_PCT,
    watchedCount: Object.keys(watched).length, watched,
    graduatedCount: gradTracker.listGraduated().length, graduated: gradTracker.listGraduated(),
  });
});

// Manually add a known graduated Bags token to our 48h tracker (gated). Useful
// for seeding the Recently-Graduated board with a real graduate the watcher
// didn't catch live. Validates the bags suffix + pulls live snapshot for the
// display fields. Stamps graduatedAt = now so it shows + persists the full 48h.
app.get("/api/grad-watch-add", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) return res.status(404).json({ error: "not_found" });
  const mint = String(req.query.mint || "").trim();
  if (!mint.toLowerCase().endsWith("bags")) return res.status(400).json({ error: "not_a_bags_mint" });
  let snap = null; try { snap = await getBagsTokenSnapshot(mint); } catch (_) {}
  if (!snap) return res.status(200).json({ added: false, error: "no_snapshot_data" });
  // Use the token's REAL graduation time (its Meteora pool createdAt) so the age
  // is honest, not "just now". Normalize sec/ms/ISO; fall back to now if absent.
  const toMs = (v) => { if (v == null) return null; if (typeof v === "number") return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return isNaN(t) ? null : t; };
  const at = toMs(snap.createdAt);
  const graduatedAt = (at && at > 0 && at <= Date.now()) ? at : Date.now();
  // Pinned: manually-seeded real graduates persist past the 48h window.
  const rec = { mint, name: snap.name, symbol: snap.symbol, image: snap.image, twitter: snap.twitter, graduatedAt, pinned: true, marketCap: snap.marketCap, priceUsd: snap.priceUsd };
  const added = gradTracker.addGraduated(rec);
  // bust the board cache so it shows immediately
  GRAD_BOARD_CACHE.list = null; GRAD_BOARD_CACHE.ts = 0;
  return res.status(200).json({ added, onBondingCurve: snap.onBondingCurve, rec });
});

// Bags Launch Radar — manual/dry-run trigger for the 2-hourly Telegram post.
// Gated by PREMIUM_ACCESS_KEY. Without ?post=1 it just RETURNS the composed
// text (verify the format, no spam); ?post=1 actually fires the Telegram post.
app.get("/api/bags-radar-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(403).json({ error: "forbidden" });
  try {
    const text = await buildBagsRadarText();
    if (req.query.post === "1") await notifyBagsLaunches();
    return res.status(200).json({ success: true, posted: req.query.post === "1", text });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Market Check — manual/dry-run trigger (gated). ?post=1 fires the Telegram post.
app.get("/api/market-check-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(403).json({ error: "forbidden" });
  try {
    const text = await buildMarketCheckText();
    if (req.query.post === "1") await notifyMarketCheck();
    return res.status(200).json({ success: true, posted: req.query.post === "1", text });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Daily Flow Recap dry-run. ?key=PREMIUM_ACCESS_KEY returns the composed text +
// the current accumulated window; add &post=1 to actually post it (which also
// resets the window, like the real daily fire). Persistent (volume) flag shown.
app.get("/api/recap-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(404).json({ error: "not_found" });
  try {
    const snapshot = recap.snapshot();
    const text = buildRecapText();
    if (req.query.post === "1") await notifyRecap();
    return res.status(200).json({ success: true, posted: req.query.post === "1", persistent: recap.isPersistent(), snapshot, text });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Locked-supply report — dry-run the daily post (returns the computed report +
// message); add &post=1 to actually fire it to the community chat. Gated.
app.get("/api/lock-report-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(404).json({ error: "not_found" });
  try {
    const r = await notifyLockReport({ dryRun: req.query.post !== "1" });
    return res.status(200).json(r);
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Telegram test message — fire a one-off custom post to the community chat,
// gated by PREMIUM_ACCESS_KEY. Lets an operator send an arbitrary note (e.g.
// "we're running a test") without shipping new content or a code change. The
// bot token + chat id are read from the live env (Railway), so this only works
// on the DEPLOYED server — never from a local/cloud clone that has no secrets.
// ?text=... overrides the default; posts silently unless &loud=1. Plain text is
// safest — raw < & > can trip Telegram's HTML parser (the JSON response below
// surfaces any such error so you can see exactly what Telegram said).
app.get("/api/tg-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(404).json({ error: "not_found" });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return res.status(200).json({ success: false, error: "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset on this server)" });
  }
  const text = req.query.text
    ? String(req.query.text).slice(0, 3500)
    : "🐔 Heads up, flock — running a quick test on the bot. Ignore any test posts; back to normal shortly.";
  const silent = req.query.loud !== "1"; // silent by default so a test doesn't ping everyone
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID, text,
        parse_mode: "HTML", disable_web_page_preview: true, disable_notification: silent,
      }),
    });
    const data = await r.json().catch(() => ({}));
    return res.status(200).json({ success: !!(data && data.ok), messageId: data?.result?.message_id || null, telegram: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Telegram webhook — receives slash-command updates. Both the path secret and
// the X-Telegram-Bot-Api-Secret-Token header must match (derived from the bot
// token) so randoms can't inject fake updates. Ack immediately, handle async.
// (Handlers tgSend / handleTelegramUpdate are defined up in the Telegram block;
// this route must live below `const app = express()`.)
app.post("/api/tg/:secret", (req, res) => {
  if (!TG_WEBHOOK_SECRET
      || req.params.secret !== TG_WEBHOOK_SECRET
      || req.headers["x-telegram-bot-api-secret-token"] !== TG_WEBHOOK_SECRET) {
    return res.status(404).json({ error: "not_found" });
  }
  res.status(200).json({ ok: true });
  handleTelegramUpdate(req.body);
});

// ── Buy-Competition admin (gated by PREMIUM_ACCESS_KEY) ──────────────────────
// Start/stop/list live buy-comp leaderboards. start params (query or body):
//   mint, chat (telegram chat id, negative), ticker, start, end (ISO or unix),
//   places (comma amounts e.g. 500000,350000,150000), hold (hours), update (mins).
// Gated by a DEDICATED password (BUYCOMP_KEY) — scoped to buy-comp only, so it can
// be used in the browser portal without exposing the master PREMIUM_ACCESS_KEY.
// The master key also works as an owner fallback.
const buyCompAdminOK = (req) => {
  const supplied = req.query.key || (req.body && req.body.key) || req.headers["x-premium-key"];
  if (!supplied) return false;
  const scoped = process.env.BUYCOMP_KEY, master = process.env.PREMIUM_ACCESS_KEY;
  return (!!scoped && supplied === scoped) || (!!master && supplied === master);
};
app.post("/api/buycomp/start", (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const q = Object.assign({}, req.query, req.body || {});
  const mint = String(q.mint || "").trim();
  const chatId = String(q.chat || q.chatId || "").trim();
  const ticker = String(q.ticker || "TOKEN").trim().slice(0, 12);
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ error: "bad mint" });
  if (!/^-?\d+$/.test(chatId)) return res.status(400).json({ error: "bad chat id" });
  const parseTs = (v) => (v == null || v === "") ? null : (isNaN(+v) ? Date.parse(v) : (+v < 1e12 ? +v * 1000 : +v));
  const startTs = parseTs(q.start) || Date.now();
  const endTs = parseTs(q.end);
  if (!endTs || endTs <= startTs) return res.status(400).json({ error: "bad window (need end > start)" });
  const places = String(q.places || "").split(",").map(s => parseInt(String(s).replace(/[^0-9]/g, ""))).filter(n => n > 0).map((amount, i) => ({ rank: i + 1, amount }));
  if (!places.length) return res.status(400).json({ error: "no prize places" });
  const holdHours = (q.hold !== undefined && q.hold !== null && q.hold !== "") ? Math.max(0, parseInt(q.hold) || 0) : 48;
  const updateMins = Math.max(5, parseInt(q.update) || 60);
  const metric = String(q.metric || "cumulative") === "single" ? "single" : "cumulative";
  const prizeTokenKind = ["native", "usdc", "sol", "spl"].includes(String(q.prizeToken)) ? String(q.prizeToken) : "native";
  const prizeTokenMint = prizeTokenKind === "spl" && SOL_ADDR_RE.test(String(q.prizeMint || "")) ? String(q.prizeMint) : null;
  const id = "bc_" + randomBytes(5).toString("hex");
  const prizeSummary = `🏆 ${places.map(p => p.amount.toLocaleString()).join(" / ")} ${ticker}`;
  const c = { id, label: String(q.label || ticker).slice(0, 60), mint, ticker, chatId, metric, startTs, endTs, holdHours, places, prizeToken: { kind: prizeTokenKind, mint: prizeTokenMint }, updateMins, prizeSummary, status: "live", boardMsgId: null, provisional: [], lastUpdateTs: 0, createdAt: Date.now() };
  buyCompSave(c);
  buyCompUpdate(c).catch(() => {});    // post the initial board now (if the window has started)
  return res.status(200).json({ ok: true, id, competition: c });
});
app.post("/api/buycomp/stop", async (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const all = buyCompsAll(); const c = all[String(req.query.id || "")];
  if (!c) return res.status(404).json({ error: "no such competition" });
  const cancel = req.query.cancel === "1";
  const reason = String(req.query.reason || "").trim().slice(0, 240);
  c.status = cancel ? "cancelled" : "closed";
  buyCompSave(c);
  // Alert the group either way (emergency stop should never be silent).
  try {
    if (cancel) {
      await tgSend(c.chatId, `🛑 <b>$${tgEsc(c.ticker)} BUY COMPETITION — STOPPED</b>\n\nThis competition has been cancelled by the organizers${reason ? `:\n<i>${tgEsc(reason)}</i>` : "."}\n\nNo winners will be drawn from this round. Questions? Reach the team. 🌹`);
    } else {
      await buyCompUpdate(c).catch(() => {});   // post the final provisional board (status now closed → won't re-tick)
      await tgSend(c.chatId, `🏁 <b>$${tgEsc(c.ticker)} buy comp — closed early.</b>\n\nThe board above is the PROVISIONAL standing. Winners must hold their buys for <b>${c.holdHours}h</b> (no sells, no transfers) — official winners are confirmed by the Rose scan after the hold. 🌹`);
    }
  } catch (_) {}
  return res.status(200).json({ ok: true, competition: c });
});
app.get("/api/buycomp/list", (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({ ok: true, competitions: Object.values(buyCompsAll()) });
});
app.post("/api/buycomp/refresh", (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const c = buyCompsAll()[String(req.query.id || "")];
  if (!c) return res.status(404).json({ error: "no such competition" });
  buyCompUpdate(c).catch(() => {});       // force an immediate repost
  return res.status(200).json({ ok: true });
});
// Run the hold-period verification (sell/transfer DQ + promotion) and build the
// payout list. Gated; refuses until the hold is over unless force=1.
app.post("/api/buycomp/verify", async (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const c = buyCompsAll()[String(req.query.id || "")];
  if (!c) return res.status(404).json({ error: "no such competition" });
  const holdEndsAt = c.endTs + (c.holdHours || 0) * 3600000;
  if (Date.now() < holdEndsAt && req.query.force !== "1") {
    return res.status(400).json({ error: "hold period not over", holdEndsAt });
  }
  try { await buyCompVerify(c); }
  catch (e) { return res.status(500).json({ error: "verify failed: " + e.message }); }
  return res.status(200).json({ ok: true, verified: c.verified, verifyResults: c.verifyResults, payoutToken: c.payoutToken, prizeMint: buyCompPrizeMint(c) });
});
// Payout list for the airdropper. Gated by the per-comp payoutToken (NOT the admin
// key) so it can be shared with the client as a self-distribution link.
app.get("/api/buycomp/payout", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const c = buyCompsAll()[String(req.query.id || "")];
  if (!c || !c.payoutToken || req.query.t !== c.payoutToken) return res.status(404).json({ error: "not_found" });
  const recipients = (c.verified || []).map(v => `${v.wallet}, ${v.amount}`).join("\n");
  return res.status(200).json({ ok: true, mint: buyCompPrizeMint(c), tokenName: c.ticker, source: "Cluck Norris Buy Comp", recipients });
});

// ── Buy Special RANDOM DRAW (the "N random buys win X CLKN" raffle) ───────────
// Distinct from the ranked buy COMPETITION above. Here every qualifying BUY is a
// raffle entry — more buys = more chances — and N DISTINCT wallets win. Eligibility
// = bought in [from,to] AND still holding at the snapshot (no on-chain sells,
// balance > 0), i.e. survived the hold. The draw is REPRODUCIBLE: we publish the
// seed + the eligible entry list, and the winners are a pure function of
// (seed, entries) — anyone can re-run the same SHA256 steps and confirm.
const BUYSPECIAL_DRAWS_KEY = "buySpecialDraws";
function bsDrawsAll() { return kv.get(BUYSPECIAL_DRAWS_KEY, {}); }
function bsDrawSave(d) { const all = bsDrawsAll(); all[d.id] = d; kv.set(BUYSPECIAL_DRAWS_KEY, all); }
const bsParseTs = (v) => (v == null || v === "") ? null : (isNaN(+v) ? Date.parse(v) : (+v < 1e12 ? +v * 1000 : +v));

// Deterministic weighted raffle. `entries` = [{wallet, chances}] in canonical
// (address-sorted) order; each wallet occupies `chances` slots. Winner of round
// k = the wallet at slot ( SHA256("seed:k") mod remainingSlots ); that wallet's
// whole block is then removed so no one wins twice. Pure + reproducible.
function bsDraw(entries, winners, seed) {
  let pool = [];
  for (const e of entries) for (let i = 0; i < e.chances; i++) pool.push(e.wallet);
  const picks = [];
  let k = 0, guard = 0;
  while (picks.length < winners && pool.length > 0 && guard++ < 100000) {
    const h = createHash("sha256").update(`${seed}:${k}`).digest("hex");
    const idx = Number(BigInt("0x" + h) % BigInt(pool.length));
    const w = pool[idx];
    k++;
    if (picks.includes(w)) continue;        // guard (we prune, so shouldn't hit)
    picks.push(w);
    pool = pool.filter(x => x !== w);        // remove the winner's whole block
  }
  return picks;
}

// POST /api/buyspecial/draw — run (or re-run with ?id=) the raffle. Admin-gated.
// Refuses before the hold snapshot time (to + holdHours) unless force=1.
app.post("/api/buyspecial/draw", async (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const q = Object.assign({}, req.query, req.body || {});
  const mint = String(q.mint || CLKN_MINT_ADDR).trim();
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ error: "bad mint" });
  const fromTs = bsParseTs(q.from), toTs = bsParseTs(q.to);
  if (!fromTs || !toTs || toTs <= fromTs) return res.status(400).json({ error: "bad window (need to>from)" });
  const winners = Math.max(1, Math.min(50, parseInt(q.winners) || 5));
  const prize = Math.max(1, parseInt(String(q.prize || "100000").replace(/[^0-9]/g, "")) || 100000);
  const holdHours = (q.hold !== undefined && q.hold !== null && q.hold !== "") ? Math.max(0, parseInt(q.hold) || 0) : 24;
  const requireHold = String(q.requireHold == null ? "1" : q.requireHold) !== "0";
  const snapshotAt = toTs + holdHours * 3600000;
  if (requireHold && Date.now() < snapshotAt && q.force !== "1") {
    return res.status(400).json({ error: "hold snapshot time not reached — pass force=1 to override", snapshotAt });
  }
  if (!solanaTracker.isConfigured()) return res.status(503).json({ error: "Solana Tracker not configured" });

  // 1) Every buyer in the window.
  let scan;
  try { scan = await solanaTracker.getTokenBuyersInWindow(mint, Math.floor(fromTs / 1000), Math.floor(toTs / 1000), { maxPages: 80 }); }
  catch (e) { return res.status(500).json({ error: "buyer scan failed: " + e.message }); }
  const buyers = (scan && scan.buyers) || [];
  if (!buyers.length) return res.status(200).json({ ok: true, note: "no buyers in window", buyersTotal: 0, reachedWindowStart: scan && scan.reachedWindowStart });

  // 2) Hold snapshot — keep only wallets still holding (no sells, balance > 0).
  const reviewed = [];
  for (const b of buyers) {
    let status = "eligible", note = `${b.buyCount} buy${b.buyCount > 1 ? "s" : ""}`;
    if (requireHold) {
      try {
        const pos = premiumForensics.parseStPosition(await solanaTracker.getWalletTokenPosition(b.wallet, mint));
        if (!pos) { status = "manual"; note = "no position data — verify by hand"; }
        else if ((pos.sells || 0) > 0) { status = "dq"; note = `sold (${pos.sells} sell${pos.sells > 1 ? "s" : ""}) — did not hold`; }
        else if ((pos.balance || 0) <= 0) { status = "manual"; note = "holds 0, no sells — transferred out; verify by hand"; }
        else { status = "eligible"; note = `holds ${Math.round(pos.balance).toLocaleString()}, ${b.buyCount} buy${b.buyCount > 1 ? "s" : ""}, no sells`; }
      } catch (e) { status = "manual"; note = "lookup failed — verify by hand"; }
      await new Promise(r => setTimeout(r, 120));   // pace ST so we don't trip the quota
    }
    reviewed.push({ wallet: b.wallet, buyCount: b.buyCount, volumeSol: b.volumeSol, status, note });
  }

  // 3) Eligible entry list — canonical order (address asc), chances = buyCount.
  const eligible = reviewed.filter(r => r.status === "eligible")
    .map(r => ({ wallet: r.wallet, chances: r.buyCount }))
    .sort((a, b) => a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0);
  const totalEntries = eligible.reduce((s, e) => s + e.chances, 0);

  // 4) Published seed + the draw.
  const seed = (q.seed && String(q.seed).trim()) || randomBytes(16).toString("hex");
  const winnerWallets = bsDraw(eligible, winners, seed);
  const recipients = winnerWallets.map(w => `${w}, ${prize}`).join("\n");

  const id = (q.id && bsDrawsAll()[String(q.id)]) ? String(q.id) : ("bsd_" + randomBytes(5).toString("hex"));
  const existing = bsDrawsAll()[id];
  const d = {
    id, mint, from: fromTs, to: toTs, holdHours, requireHold,
    winnersCount: winners, prize, seed,
    method: "CLKN Buy Special Draw v1 — entries = buyCount per wallet, wallets sorted by address; round k winner = wallet at slot SHA256(\"seed:k\") mod remainingSlots, winner's block removed each round.",
    buyersTotal: buyers.length, reachedWindowStart: scan && scan.reachedWindowStart,
    eligible, totalEntries, reviewed,
    winners: winnerWallets.map((w, i) => ({ rank: i + 1, wallet: w, prize, chances: (eligible.find(e => e.wallet === w) || {}).chances || 0 })),
    drawnAt: Date.now(),
    payoutToken: (existing && existing.payoutToken) || randomBytes(8).toString("hex"),
  };
  bsDrawSave(d);
  return res.status(200).json({
    ok: true, id: d.id, seed, mint, winners: d.winners, recipients,
    buyersTotal: buyers.length, eligibleCount: eligible.length, totalEntries,
    dq: reviewed.filter(r => r.status === "dq").length,
    manual: reviewed.filter(r => r.status === "manual").length,
    reachedWindowStart: scan && scan.reachedWindowStart, payoutToken: d.payoutToken,
  });
});

// GET /api/buyspecial/draw — admin re-fetch a stored draw (full detail incl. reviewed list).
app.get("/api/buyspecial/draw", (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const d = bsDrawsAll()[String(req.query.id || "")];
  if (!d) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({ ok: true, draw: d });
});

// GET /api/buyspecial/draw/public — PUBLIC transparency view (no key): seed,
// method, full eligible entry list + winners, so anyone can reproduce the draw.
app.get("/api/buyspecial/draw/public", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const d = bsDrawsAll()[String(req.query.id || "")];
  if (!d) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({
    ok: true, id: d.id, mint: d.mint, window: { from: d.from, to: d.to }, holdHours: d.holdHours,
    method: d.method, seed: d.seed, winnersCount: d.winnersCount, prize: d.prize,
    buyersTotal: d.buyersTotal, eligibleCount: d.eligible.length, totalEntries: d.totalEntries,
    eligible: d.eligible, winners: d.winners, drawnAt: d.drawnAt,
  });
});

// GET /api/buyspecial/draw/payout — token-gated payout list for the airdropper
// (same shape as /api/buycomp/payout, so the /airdrop handoff reuses it).
app.get("/api/buyspecial/draw/payout", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const d = bsDrawsAll()[String(req.query.id || "")];
  if (!d || !d.payoutToken || req.query.t !== d.payoutToken) return res.status(404).json({ error: "not_found" });
  const recipients = d.winners.map(w => `${w.wallet}, ${w.prize}`).join("\n");
  return res.status(200).json({ ok: true, mint: d.mint, tokenName: "CLKN", source: "Cluck Norris Buy Special draw", recipients });
});

// Buy Special double-check — independent buyer list from Solana Tracker for a
// time window, so the tool can cross-verify its own Helius value-flow scan.
// Returns the unique BUY wallets ST saw in [from, to] (unix seconds). The
// client diffs this against its own results. Degrades gracefully (success
// false) if ST is unavailable so the main scan never depends on it.
app.get("/api/buyspecial-crosscheck", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const mint = (req.query.mint || "").trim();
  const from = parseInt(req.query.from, 10);
  const to = parseInt(req.query.to, 10);
  if (!SOL_ADDR_RE.test(mint) || !from || !to || to <= from) {
    return res.status(400).json({ success: false, error: "Need mint, from, to (unix seconds, to>from)" });
  }
  if (!solanaTracker.isConfigured()) {
    return res.status(200).json({ success: false, error: "Solana Tracker not configured" });
  }
  try {
    const result = await solanaTracker.getTokenBuyersInWindow(mint, from, to);
    if (!result) return res.status(200).json({ success: false, error: "No data from Solana Tracker" });
    return res.status(200).json({
      success: true,
      source: "solana-tracker /trades",
      buyers: result.buyers,                 // [{wallet, buyCount, volumeSol}]
      buyerCount: result.buyers.length,
      tradesScanned: result.tradesScanned,
      reachedWindowStart: result.reachedWindowStart, // false = ST only covered the recent part of the window
    });
  } catch (err) {
    console.error("[buyspecial-crosscheck] error:", err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
});

app.get("/api/token-context", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const mint = (req.query.mint || "").trim();
  if (!mint || mint.length < 32) {
    return res.status(400).json({ success: false, error: "Invalid mint" });
  }
  try {
    const ctx = await fetchBagsContext(mint);
    return res.status(200).json({
      success: true,
      mint,
      bagsInfo: ctx.bagsInfo,
      jupiterInfo: ctx.jupiterInfo,
      projectFeeWallets: ctx.projectFeeWallets || [],
    });
  } catch (err) {
    console.error("[token-context] error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/holders", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const { mint } = req.query;
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  console.log("-> Holders request for mint:", mint);
  console.log("-> Helius key present:", !!HELIUS_KEY);
  if (!SOL_ADDR_RE.test(String(mint || ""))) return res.status(400).json({ success: false, error: "Invalid mint" });
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Missing HELIUS_API_KEY" });
  const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  try {
    let page = 1;
    const owners = new Set();
    while (true) {
      const response = await fetch(HELIUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `holders-${page}`,
          method: "getTokenAccounts",
          params: { page, limit: 1000, mint, displayOptions: { showZeroBalance: false } }
        })
      });
      const data = await response.json();
      console.log(`<- Helius holders page ${page} status:`, response.status, "accounts:", data.result?.token_accounts?.length);
      if (!data.result?.token_accounts?.length) break;
      data.result.token_accounts.forEach(a => { if (parseInt(a.amount) > 0) owners.add(a.owner); });
      if (data.result.token_accounts.length < 1000) break;
      page++;
      if (page > 20) break;
    }
    console.log("Total holders:", owners.size);
    return res.status(200).json({ success: true, holderCount: owners.size });
  } catch (err) {
    console.error("Holders error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Helius RPC Proxy -- hides API key from client tools (rose / airdrop / buyspecial) --
app.post("/api/helius-rpc", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  // ALLOW-LIST (default-deny): only the lightweight read + transaction-build/send
  // methods the client tools actually use — score/holders/snapshot/trace, rose/
  // buyspecial, the airdropper, the hatchery, and security-coop. Everything else
  // (getProgramAccounts*, every *Subscribe — WS-only anyway, block/supply/cluster
  // scans, requestAirdrop, …) is rejected, so this open proxy can't be turned into
  // a credit drain. Handles JSON-RPC batch bodies (arrays) too.
  const ALLOWED_RPC = new Set([
    // account / token reads
    "getAccountInfo", "getMultipleAccounts", "getBalance",
    "getTokenAccountsByOwner", "getParsedTokenAccountsByOwner", "getTokenAccountBalance",
    "getTokenSupply", "getTokenLargestAccounts", "getTokenAccounts",
    // DAS reads (Helius)
    "getAsset", "getAssetsByOwner", "searchAssets", "getAssetsByGroup",
    // signature / transaction history
    "getSignaturesForAddress", "getTransaction", "getParsedTransaction", "getParsedTransactions",
    // transaction build + send (web3.js Connection drives these for the tx tools)
    "getLatestBlockhash", "getRecentBlockhash", "isBlockhashValid",
    "getFeeForMessage", "getFeeCalculatorForBlockhash", "getMinimumBalanceForRentExemption",
    "getRecentPrioritizationFees", "simulateTransaction", "sendTransaction",
    "getSignatureStatuses", "getSignatureStatus",
    // chain info web3.js touches during init / confirmation
    "getSlot", "getBlockHeight", "getEpochInfo", "getGenesisHash", "getVersion", "getHealth",
  ]);
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (!calls.length || calls.some(c => !c || typeof c.method !== "string" || !ALLOWED_RPC.has(c.method))) {
    return res.status(403).json({ error: "method_not_allowed" });
  }
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ error: "Missing HELIUS_API_KEY" });
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });
    const text = await response.text();
    res.status(response.status);
    try { return res.json(JSON.parse(text)); }
    catch (e) { return res.send(text); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// -- Helius Enhanced Transactions Proxy -- POST array of signatures, returns parsed txns --
app.post("/api/helius-tx", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ error: "Missing HELIUS_API_KEY" });
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });
    const text = await response.text();
    res.status(response.status);
    try { return res.json(JSON.parse(text)); }
    catch (e) { return res.send(text); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// A Helius JSON-RPC caller: rpcCall(id, method, params) — forwards params as given
// (object for getTokenAccounts, array for getMultipleAccounts/getTokenSupply), so it
// works with classifyAddressTypes and the DAS endpoints alike.
function heliusRpcCall(HELIUS_URL) {
  return async (id, method, params) => {
    const r = await fetch(HELIUS_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return r.json();
  };
}

// Authoritative locked-supply reader for ANY mint. The naive approach (getTokenAccounts
// by owner=lock program) returns 0 — Jupiter Lock holds tokens in escrow PDAs, not under
// the program ID directly. Correct method (same as the Autopsy's 145M figure): list the
// mint's token accounts, then classify each account's AUTHORITY by the program that owns
// it; sum balances held under locker programs (Jupiter Lock / Streamflow) + self-owned
// permanent locks. Returns total + % of supply + per-program breakdown + the biggest locks.
async function getLockedSupply(mint, rpcCall) {
  let decimals = 9, supplyUi = 0;
  try {
    const s = await rpcCall("locks-supply", "getTokenSupply", [mint]);
    const v = s?.result?.value;
    if (v) { decimals = v.decimals ?? 9; supplyUi = parseInt(v.amount) / Math.pow(10, decimals); }
  } catch (_) { /* fall back to defaults */ }

  const accts = [];
  for (let p = 1; p <= 5; p++) {
    let r;
    try { r = await rpcCall(`locks-tas-${p}`, "getTokenAccounts", { page: p, limit: 1000, mint, displayOptions: { showZeroBalance: false } }); }
    catch (_) { break; }
    const a = r?.result?.token_accounts || [];
    if (!a.length) break;
    accts.push(...a);
    if (a.length < 1000) break;
  }
  const holders = accts
    .map(a => ({ tokenAccount: a.address, authority: a.owner, tokens: (parseInt(a.amount || "0") || 0) / Math.pow(10, decimals) }))
    .filter(h => h.tokens > 0);

  const cls = await classifyAddressTypes(holders.map(h => h.authority), rpcCall);
  let totalLocked = 0;
  const byLabel = new Map();
  const locks = [];
  for (const h of holders) {
    const c = cls.get(h.authority);
    if (c && c.category === "locker") { // classifyAddressTypes maps Jupiter Lock / Streamflow / self-owned → "locker"
      totalLocked += h.tokens;
      byLabel.set(c.label, (byLabel.get(c.label) || 0) + h.tokens);
      locks.push({ authority: h.authority, tokens: h.tokens, label: c.label });
    }
  }
  locks.sort((a, b) => b.tokens - a.tokens);
  return {
    success: true, mint, decimals, supply: supplyUi,
    totalLocked,
    pctOfSupply: supplyUi > 0 ? totalLocked / supplyUi : null,
    lockCount: locks.length,
    breakdown: [...byLabel.entries()].map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens),
    topLocks: locks.slice(0, 10),
  };
}

// -- Locked supply (Jupiter Lock + Streamflow + self-owned), read on-chain --
app.get("/api/locks", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const { mint } = req.query;
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!mint) return res.status(400).json({ success: false, error: "Missing mint" });
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Missing HELIUS_API_KEY" });
  try {
    const rpcCall = heliusRpcCall(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`);
    const data = await getLockedSupply(mint, rpcCall);
    return res.status(200).json(data);
  } catch (err) {
    console.error("Locks error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Fee Share / Analytics endpoints --
const CLKN_MINT_CONST = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";

async function bagsFetch(endpoint, API_KEY) {
  const url = `${BAGS_BASE}${endpoint}`;
  console.log("-> Bags test:", url);
  const response = await fetch(url, { headers: { "x-api-key": API_KEY } });
  const text = await response.text();
  console.log("<- Bags test:", response.status, text.slice(0, 300));
  return { status: response.status, text };
}

// "Best observed" creator-trace cache. Forensic counters (buyCount, lockCount,
// boughtSol, claimedSol, lockedTokens) are MONOTONICALLY INCREASING by
// definition — a wallet can't un-buy or un-lock something. If a later run
// shows fewer buys than an earlier one, that's always a capture failure
// (Helius rate-limited, batch retry exhausted, GeckoTerminal down, etc.),
// never reality. So we keep the max() of each counter across all runs for a
// given (creatorWallet, mint) pair. The user sees stable numbers that only
// improve, never silently regress.
const CREATOR_TRACE_CACHE = new Map();
const CREATOR_TRACE_TTL_MS = 60 * 60 * 1000; // 1 hour
function bestObservedTrace(wallet, mint, fresh) {
  const key = `${wallet}:${mint}`;
  const cached = CREATOR_TRACE_CACHE.get(key);
  // If no cache, store fresh and return as-is.
  if (!cached || Date.now() - cached.savedAt > CREATOR_TRACE_TTL_MS) {
    CREATOR_TRACE_CACHE.set(key, { trace: fresh, savedAt: Date.now() });
    return { trace: fresh, usedCache: false };
  }
  // Merge — keep the max of each monotonic field, plus newest timestamps.
  const c = cached.trace;
  const merged = { ...fresh };
  const monotonic = ["buyCount", "sellCount", "lockCount", "transferInCount", "transferOutCount",
    "boughtTokens", "soldTokens", "lockedTokens", "transferInTokens", "transferOutTokens",
    "boughtUsd", "soldUsd", "boughtSol", "soldSol", "sigsScanned"];
  let regressedAny = false;
  for (const k of monotonic) {
    const newVal = Number(fresh[k]) || 0;
    const cachedVal = Number(c[k]) || 0;
    if (cachedVal > newVal) {
      merged[k] = cachedVal;
      regressedAny = true;
    } else {
      merged[k] = newVal;
    }
  }
  // Recompute derived fields after merging
  merged.netUsd = merged.boughtUsd - merged.soldUsd;
  merged.netSol = merged.boughtSol - merged.soldSol;
  if (merged.claimedSol && merged.claimedSol > 0) {
    merged.pctReinvested = Math.min(100, (merged.boughtSol / merged.claimedSol) * 100);
  }
  // Timestamps — keep newest lastTs, oldest firstTs
  if (c.lastTs && (!merged.lastTs || c.lastTs > merged.lastTs)) merged.lastTs = c.lastTs;
  if (c.firstTs && (!merged.firstTs || c.firstTs < merged.firstTs)) merged.firstTs = c.firstTs;
  // teamNetwork: keep the one with more wallets / activity
  if (c.teamNetwork && (!merged.teamNetwork
    || (c.teamNetwork.totalBuyCount || 0) > (merged.teamNetwork.totalBuyCount || 0))) {
    merged.teamNetwork = c.teamNetwork;
  }
  // Store merged back (only if we actually improved or kept stable)
  CREATOR_TRACE_CACHE.set(key, { trace: merged, savedAt: Date.now() });
  if (regressedAny) {
    console.log(`[CREATOR-TRACE-CACHE] ${wallet.slice(0,8)}…:${mint.slice(0,6)} — fresh run regressed; using cached best (buys: ${c.buyCount} vs fresh ${fresh.buyCount}, locks: ${c.lockCount} vs fresh ${fresh.lockCount}, boughtSol: ${c.boughtSol?.toFixed(2)} vs fresh ${fresh.boughtSol?.toFixed(2)})`);
  }
  return { trace: merged, usedCache: regressedAny };
}

// Helius Enhanced API batch fetch with retry-on-429 + in-memory dedup cache.
// One canonical helper that all autopsy phases use, so a single rate-limit
// event during Phase 2F doesn't cascade into Phase 2G returning empty.
// Returns { txs, attempted, succeeded, cached, rateLimited } for diagnostics.
async function heliusEnhancedBatched(sigs, HELIUS_KEY, label, txCache, scanQuality) {
  if (!sigs || sigs.length === 0) return { txs: [], attempted: 0, succeeded: 0, cached: 0, rateLimited: 0 };
  const result = { txs: [], attempted: 0, succeeded: 0, cached: 0, rateLimited: 0 };
  // De-dupe vs cache up front so we never re-fetch a sig we already have.
  const uncached = [];
  for (const s of sigs) {
    if (txCache && txCache.has(s)) {
      const cachedTx = txCache.get(s);
      if (cachedTx) result.txs.push(cachedTx);
      result.cached++;
    } else {
      uncached.push(s);
    }
  }
  // Fetch the uncached sigs in 100-batches with retry-on-429.
  // PROACTIVE THROTTLE: pace batches with a small inter-batch delay so we
  // never trip the rate limit in the first place. Reactive backoff (waiting
  // until a 429 lands) was dropping batches on busy wallets — the creator
  // trace fires 30+ batches and slamming them back-to-back exhausted the
  // 3-retry budget on some. ~140ms between batches keeps us under ~7 req/s,
  // comfortably below the Helius limit, at the cost of a few seconds per
  // scan. Skipped before the first batch and when there's only one.
  const INTER_BATCH_MS = 140;
  let batchIndex = 0;
  for (let i = 0; i < uncached.length; i += 100) {
    if (batchIndex > 0) await new Promise(res => setTimeout(res, INTER_BATCH_MS));
    batchIndex++;
    const batch = uncached.slice(i, i + 100);
    result.attempted++;
    let attempt = 0;
    let success = false;
    while (attempt < 4 && !success) {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: batch }),
          signal: AbortSignal.timeout(20000),
        });
        if (r.status === 429) {
          attempt++;
          result.rateLimited++;
          const waitMs = Math.min(4000, 600 * Math.pow(2, attempt - 1)); // 600, 1200, 2400
          console.warn(`[AUTOPSY] Helius ${label} 429 rate-limited, backing off ${waitMs}ms (attempt ${attempt}/4)`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (r.status >= 500 && r.status < 600) {
          attempt++;
          const waitMs = 500 * attempt;
          console.warn(`[AUTOPSY] Helius ${label} status=${r.status}, retrying after ${waitMs}ms (attempt ${attempt}/4)`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (!r.ok) {
          console.warn(`[AUTOPSY] Helius ${label} non-OK status=${r.status} — giving up on this batch`);
          break;
        }
        const data = await r.json();
        if (Array.isArray(data)) {
          for (const tx of data) {
            if (tx && tx.signature && txCache) txCache.set(tx.signature, tx);
            if (tx) result.txs.push(tx);
          }
        }
        result.succeeded++;
        success = true;
      } catch (e) {
        attempt++;
        console.warn(`[AUTOPSY] Helius ${label} batch ${i} attempt ${attempt} threw:`, e.message);
        if (attempt < 3) await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
  }
  if (scanQuality) {
    scanQuality.heliusBatches += result.attempted;
    scanQuality.heliusBatchesSucceeded += result.succeeded;
    scanQuality.heliusRateLimited += result.rateLimited;
  }
  return result;
}

app.get("/api/fees", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const API_KEY = process.env.BAGS_API_KEY;
  if (!API_KEY) return res.status(500).json({ success: false, error: "Missing BAGS_API_KEY" });
  try {
    const { status, text } = await bagsFetch(`token-launch/lifetime-fees?tokenMint=${CLKN_MINT_CONST}`, API_KEY);
    try {
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch(e) {
      return res.status(500).json({ success: false, error: "Invalid JSON", raw: text.slice(0,200) });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Live reinvestment tracker — Bags creator-fee claim events for CLKN --
// Each claim event is the project pulling its 1% creator fee off Bags. The
// investors page renders these as a verifiable, itemized fee-claim record.
let REINVEST_CACHE = { data: null, ts: 0 };   // 5-min server cache (pagination is several Bags calls)
app.get("/api/reinvestment", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min — claims are infrequent
  const API_KEY = process.env.BAGS_API_KEY;
  if (!API_KEY) return res.status(500).json({ success: false, error: "Missing BAGS_API_KEY" });
  if (REINVEST_CACHE.data && Date.now() - REINVEST_CACHE.ts < 300000) {
    return res.status(200).json(REINVEST_CACHE.data);
  }
  // Bags returns the claim timestamp as a Unix value in SECONDS (its docs claim
  // ISO 8601 — they're wrong). Normalize so the clients' new Date() doesn't read
  // seconds as milliseconds (→ Jan 1970).
  const toIso = (ts) => {
    if (ts == null) return null;
    let d;
    if (typeof ts === "number" || /^\d+$/.test(String(ts))) {
      let n = Number(ts);
      if (n < 1e12) n *= 1000; // seconds → milliseconds
      d = new Date(n);
    } else { d = new Date(ts); }
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  try {
    // Bags returns claim events OLDEST-first and there are well over 50, so we
    // MUST paginate the full history — otherwise offset 0 freezes the list at
    // the 50 oldest claims (the bug this fixes). Walk pages of 100 until a
    // short/empty page (safety cap 2000 claims).
    let events = [];
    for (let page = 0; page < 20; page++) {
      const { text } = await bagsFetch(
        `fee-share/token/claim-events?tokenMint=${CLKN_MINT_CONST}&mode=offset&limit=100&offset=${page * 100}`, API_KEY);
      let batch = [];
      try {
        const d = JSON.parse(text);
        if (d && d.success && d.response && Array.isArray(d.response.events)) batch = d.response.events;
      } catch (e) {
        if (page === 0) return res.status(502).json({ success: false, error: "Invalid Bags response" });
        break; // partial history beats failing
      }
      events.push(...batch);
      if (batch.length < 100) break;
    }
    const claims = events
      .map(e => ({
        sol: Number(e.amount) / 1e9,
        timestamp: toIso(e.timestamp),
        signature: e.signature,
        isCreator: !!e.isCreator,
      }))
      .filter(c => Number.isFinite(c.sol) && c.signature);
    // Newest claim first — Bags returns oldest-first and doesn't guarantee order.
    claims.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    const totalShownSol = claims.reduce((s, c) => s + c.sol, 0);
    const payload = { success: true, claimCount: claims.length, totalShownSol, claims };
    REINVEST_CACHE = { data: payload, ts: Date.now() };
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Ultimate Challenge Claims -- Google Sheets --
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1nh3BXxalBOCMbM3EDDWiMBJtDbbYT0WyXGQjKFAarIY";
const SHEET_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const SHEET_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

async function getGoogleToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: SHEET_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  })).toString("base64url");

  // createSign imported at top
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const privateKey = (SHEET_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .trim();
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) console.error("[ERR] Token error:", JSON.stringify(tokenData));
  else console.log("[OK] Google token obtained");
  return tokenData.access_token;
}

async function appendToSheet(values) {
  const token = await getGoogleToken();
  if (!token) { console.error("[ERR] No Google token obtained"); return false; }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:H:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  console.log("-> Sheets append URL:", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] })
  });
  const text = await res.text();
  console.log("<- Sheets append:", res.status, text.slice(0, 200));
  return res.ok;
}

async function getSheetRows() {
  const token = await getGoogleToken();
  if (!token) { console.error("[ERR] No Google token for getSheetRows"); return []; }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:H`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await res.json();
  console.log("<- Sheets read:", res.status, JSON.stringify(data).slice(0, 200));
  return data.values || [];
}

async function checkCLKNHolder(wallet) {
  try {
    const HELIUS_KEY = process.env.HELIUS_API_KEY;
    const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "holder-check",
        method: "getTokenAccountsByOwner",
        params: [
          wallet,
          { mint: CLKN_MINT },
          { encoding: "jsonParsed" }
        ]
      })
    });
    const data = await response.json();
    const accounts = data?.result?.value || [];
    // A wallet can hold the same mint across several token accounts; sum them all
    // so a holder with split accounts isn't undercounted (and doesn't lose their tier).
    const balance = accounts.reduce(
      (sum, a) => sum + (a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0),
      0
    );
    return { isHolder: balance > 0, balance };
  } catch(e) {
    console.error("Holder check error:", e.message);
    return { isHolder: false, balance: 0 };
  }
}

// ── Ultimate Challenge — server-authoritative scoring ──────────────────────
// The exam is the one event a diploma is gated on, so it can't be faked. The
// answer key lives ONLY on the server: /api/exam/questions draws a set and
// shuffles each question's options server-side (so the correct index is not in
// the payload), and /api/exam/submit scores the submitted choices. A pass mints
// a one-time token the claim must present to record a "verified" diploma — that
// keeps the airdrop list and the graduate count honest. Sessions/tokens live in
// memory with a short TTL; a redeploy just means re-taking, which is fine.
const EXAM_SIZE = 50;
const EXAM_PASS_PCT = 94;
const EXAM_TTL_MS = 30 * 60 * 1000;
const examSessions = new Map();    // sessionId -> { key: [correctIdx...], createdAt }
const examPassTokens = new Map();  // token     -> { pct, score, total, createdAt, used }

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pruneExam() {
  const now = Date.now();
  for (const [k, v] of examSessions) if (now - v.createdAt > EXAM_TTL_MS) examSessions.delete(k);
  for (const [k, v] of examPassTokens) if (now - v.createdAt > EXAM_TTL_MS) examPassTokens.delete(k);
}

app.get("/api/exam/questions", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  pruneExam();
  const drawn = shuffleInPlace(QUESTION_BANK.slice()).slice(0, Math.min(EXAM_SIZE, QUESTION_BANK.length));
  const key = [];
  const questions = drawn.map((q, idx) => {
    const order = shuffleInPlace(q.options.map((_, i) => i));     // shuffle option positions
    key[idx] = order.indexOf(q.correct);                          // where the right answer landed
    return { n: idx, q: q.q, options: order.map(i => q.options[i]) };
  });
  const sessionId = randomBytes(18).toString("hex");
  examSessions.set(sessionId, { key, createdAt: Date.now() });
  return res.status(200).json({ success: true, sessionId, total: questions.length, passPct: EXAM_PASS_PCT, questions });
});

app.post("/api/exam/submit", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  pruneExam();
  const { sessionId, answers } = req.body || {};
  const sess = examSessions.get(String(sessionId || ""));
  if (!sess) return res.status(400).json({ success: false, error: "Exam session expired — restart the challenge." });
  examSessions.delete(String(sessionId)); // one-shot — a session can't be re-scored
  const a = Array.isArray(answers) ? answers : [];
  let score = 0;
  for (let i = 0; i < sess.key.length; i++) if (a[i] === sess.key[i]) score++;
  const total = sess.key.length;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const passed = pct >= EXAM_PASS_PCT;
  let passToken = null;
  if (passed) {
    passToken = randomBytes(18).toString("hex");
    examPassTokens.set(passToken, { pct, score, total, createdAt: Date.now(), used: false });
  }
  return res.status(200).json({ success: true, passed, score, total, pct, passToken });
});

app.post("/api/claim", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { wallet, score, total, pct, source, passToken, coursework } = req.body;
  if (!SOL_ADDR_RE.test(String(wallet || ""))) return res.status(400).json({ success: false, error: "Invalid wallet" });
  try {
    // A diploma is "verified" only when it rides a one-time, server-issued pass
    // token from /api/exam/submit. Without one (the graduation door, or an old
    // client) it's recorded but labelled self-reported.
    let verified = "self-reported", effScore = score, effTotal = total, effPct = pct;
    if (source !== "GRADUATION" && passToken) {
      const tok = examPassTokens.get(String(passToken));
      if (tok && !tok.used && tok.pct >= EXAM_PASS_PCT) {
        tok.used = true;
        verified = "server-scored";
        effScore = tok.score; effTotal = tok.total; effPct = tok.pct; // trust the server's numbers
      }
    }

    // Check if CLKN holder (snapshot stored on the transcript too).
    const { isHolder, balance } = await checkCLKNHolder(wallet);
    const holderStatus = isHolder ? "[OK] YES" : "[ERR] NO";

    // Google Sheet stays the airdrop list — one row per wallet.
    const rows = await getSheetRows();
    const exists = rows.some(row => row[0] === wallet);
    if (!exists) {
      const date = new Date().toISOString();
      await appendToSheet([wallet, effScore, effTotal, effPct, date, holderStatus, balance, source || "CHALLENGE"]);
      console.log(`[WIN] New claim: ${wallet} -- ${effScore}/${effTotal} (${effPct}%) [${verified}] -- CLKN Holder: ${holderStatus} (${balance})`);
    }

    // Always update the permanent transcript store (merges challenge + graduation
    // badges), even on a repeat claim — that's how a second door adds to an
    // existing record. Returns the slug so the client can link the transcript.
    const kind = source === "GRADUATION" ? "graduation" : "challenge";
    const rec = credentials.record(wallet, { kind, score: effScore, total: effTotal, pct: effPct, verified, isHolder, balance, coursework });
    return res.status(200).json({
      success: true, isHolder, balance, verified,
      slug: rec.slug, transcript: `/transcript/${rec.slug}`, alreadyOnList: exists,
    });
  } catch(err) {
    console.error("Claim error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Public credential transcript: JSON by slug or raw wallet (hybrid lookup) --
app.get("/api/credential/:id", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const rec = credentials.resolve(String(req.params.id || "").trim());
  if (!rec) return res.status(404).json({ success: false, error: "No transcript found" });
  // Public view: expose holder STATUS but never the balance (the owner may not
  // want their bag size on a shareable page).
  const pub = { ...rec, holder: rec.holder ? { isHolder: rec.holder.isHolder } : null };
  return res.status(200).json({ success: true, transcript: pub });
});

// -- Aggregate, judge-facing school metrics (verified graduates, etc.) --
app.get("/api/school-stats", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({ success: true, ...credentials.stats() });
});

// -- Credential Tier-2: prove the transcript's wallet is yours (no WalletConnect) --
// Client sends a tiny CLKN amount (tool=ownership) → verify-clkn-payment hands
// back a proof token encoding the sender wallet → posted here. We mark ownership
// verified only when the proven wallet matches the transcript's wallet.
app.post("/api/credential/verify-ownership", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { id, proof } = req.body || {};
  const rec = credentials.resolve(String(id || "").trim());
  if (!rec) return res.status(404).json({ success: false, error: "No transcript found" });
  const provenWallet = verifyPremiumProof(proof);
  if (!provenWallet) return res.status(400).json({ success: false, error: "Invalid or expired ownership proof" });
  if (provenWallet !== rec.wallet) return res.status(403).json({ success: false, error: "That wallet doesn't match this transcript" });
  const updated = credentials.setOwnership(rec.wallet, "payment");
  return res.status(200).json({ success: true, ownership: updated.ownership });
});

// -- Wallet Safety Checkup -- read-only (paste an address, no connect). Scans a
// wallet for the things that actually drain people: lingering delegate approvals
// (the one permission that persists), honeypot/Token-2022-trap holdings, and
// tokens whose mint/freeze authority is still live. Reuses Security Coop's
// delegate scanner + the same honeypot logic the Cluck Score uses.
app.get("/api/wallet-checkup", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const wallet = String(req.query.wallet || "").trim();
  if (!SOL_ADDR_RE.test(wallet)) return res.status(400).json({ success: false, error: "Invalid wallet address" });
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Server not configured" });
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const rpc = async (method, params) => {
    const r = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }) });
    return r.json();
  };
  const TOKEN_PROG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROG = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const SYS = "11111111111111111111111111111111";
  try {
    // 1. Held tokens (classic Token + Token-2022), summed per mint.
    const byMint = new Map();
    for (const prog of [TOKEN_PROG, TOKEN_2022_PROG]) {
      const d = await rpc("getTokenAccountsByOwner", [wallet, { programId: prog }, { encoding: "jsonParsed" }]);
      for (const acc of (d?.result?.value || [])) {
        const info = acc.account?.data?.parsed?.info;
        const amt = info?.tokenAmount?.uiAmount || 0;
        if (info?.mint && amt > 0) {
          const e = byMint.get(info.mint) || { mint: info.mint, amount: 0 };
          e.amount += amt; byMint.set(info.mint, e);
        }
      }
    }
    const mints = [...byMint.keys()].slice(0, 100); // cap the per-checkup work

    // 2. Inspect each held mint for honeypot extensions + live authorities.
    const riskyHoldings = [];
    if (mints.length) {
      const mi = await rpc("getMultipleAccounts", [mints, { encoding: "jsonParsed" }]);
      const vals = mi?.result?.value || [];
      mints.forEach((mint, i) => {
        const acc = vals[i];
        if (!acc) return;
        const info = acc.data?.parsed?.info || {};
        const issues = []; let severity = 0;
        if (acc.owner === TOKEN_2022_PROG) {
          const exts = Array.isArray(info.extensions) ? info.extensions : [];
          const st = (n) => { const e = exts.find(x => x && x.extension === n); return e ? (e.state || {}) : null; };
          const pd = st("permanentDelegate"); if (pd && pd.delegate && pd.delegate !== SYS) { issues.push("Permanent delegate — an authority can move or burn your tokens"); severity = 3; }
          const th = st("transferHook"); if (th && th.programId && th.programId !== SYS) { issues.push("Transfer hook — a program runs on every transfer and can block sells"); severity = 3; }
          const das = st("defaultAccountState"); if (das && das.accountState === "frozen") { issues.push("Accounts default to frozen — can't transfer until thawed"); severity = 3; }
          const tf = st("transferFeeConfig"); if (tf) { const bps = Math.max(Number(tf.newerTransferFee?.transferFeeBasisPoints) || 0, Number(tf.olderTransferFee?.transferFeeBasisPoints) || 0); if (bps > 0) { issues.push("Transfer fee " + (bps / 100).toFixed(bps % 100 ? 2 : 0) + "% taxed on every transfer"); severity = Math.max(severity, bps >= 1000 ? 3 : 2); } }
        }
        if (info.freezeAuthority) { issues.push("Freeze authority still active — these tokens can be frozen"); severity = Math.max(severity, 1); }
        if (info.mintAuthority) { issues.push("Mint authority still active — supply can be inflated"); severity = Math.max(severity, 1); }
        if (issues.length) riskyHoldings.push({ mint, amount: byMint.get(mint).amount, issues, severity });
      });
      riskyHoldings.sort((a, b) => b.severity - a.severity);
    }

    // 3. Lingering delegate approvals — the persistent drain risk (Security Coop engine).
    let approvals = [];
    try { approvals = await securityCoop.scanDelegates(wallet); } catch (_) {}

    return res.status(200).json({
      success: true, wallet,
      tokensHeld: byMint.size,
      scanned: mints.length,
      capped: byMint.size > mints.length,
      approvals,
      riskyHoldings,
    });
  } catch (e) {
    console.error("[wallet-checkup]", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/claims", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  // Admin-only: exposes the full airdrop list (wallets + balances). Gated on the
  // PREMIUM_ACCESS_KEY secret (Railway only) like the other admin endpoints —
  // never a hardcoded password in this public repo.
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) {
    return res.status(404).json({ error: "not_found" });
  }
  try {
    const rows = await getSheetRows();
    const headers = rows[0] || [];
    const data = rows.slice(1).map(row => ({
      wallet: row[0], score: row[1], total: row[2], pct: row[3], date: row[4], holder: row[5], balance: row[6], source: row[7]
    }));
    return res.status(200).json({ success: true, count: data.length, claims: data });
  } catch(err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Verify CLKN Payment (generalized per-tool unlock) --
const CLKN_RECEIVE_WALLET = "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H";
const CLKN_MINT_ADDR = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";

// Project deployer wallet — buys from here are the team reinvesting earned
// fees back into CLKN, flagged with a distinct alert instead of a plain buy.
const DEV_WALLETS = new Set([
  "3VELZ2avSUq79qstuR8a7C3euJ834WmQyrjt4uRnn4eb",
]);

// Tool → cost (CLKN, base before the unique decimal) + what gets granted.
// The base must be unique per tool so a user can't pay a 100-CLKN "airdrop" amount
// and reuse the verification to unlock a 500-CLKN tool. Math.floor(amount) checks this.
// Note: `holders` is intentionally NOT in this table — the /holders deep-view tool
// is kept internal (URL accessible but unadvertised) for the project team's own use.
// If we ever expose it publicly again, just add holders here and uncomment the gate
// wiring in public/holders.html.
const TOOL_GRANTS = {
  ai:         { cost: 500, grants: { questions: 20 } },
  airdrop:    { cost: 100, grants: { sessions: 1 } },
  buyspecial: { cost: 500, grants: { hoursOfAccess: 168 } },
  rose:       { cost: 500, grants: { hoursOfAccess: 168 } },
  // The Cluck Score card is free — generated for any mint at /api/cluck-card,
  // no payment gate. (It was never enforced; this keeps the config honest.)
  // Premium forensics: the 7-CLKN send is an OWNERSHIP PROOF, not a purchase —
  // it proves the sender controls the wallet so we can gate on its balance. On
  // a match we hand back a proof token (see verify-clkn-payment response).
  premium:    { cost: 7,   grants: {} },
  // Credential Tier-2: a tiny send that proves the sender owns the wallet on
  // their transcript. No holder gate — issues a plain ownership proof. Safe
  // because autopsy-premium still re-checks the live 2M balance at runtime.
  ownership:  { cost: 1,   grants: {} },
};

// Holders who keep ≥ this many CLKN after the send get a stretched unlock — the only
// way to reward "holders" without a wallet-connect that would be trivially spoofable.
// The sender's post-send balance is read straight from the tx's postTokenBalances,
// so it can't be faked.
// 2M CLKN ≈ $240 at $0.00012/CLKN. Adjust as price moves — fixed CLKN means
// early holders qualify at lower USD cost, which is by design.
const HOLDER_BONUS_THRESHOLD = 2_000_000;
const HOLDER_BONUS_MULTIPLIER = 5;

app.post("/api/verify-clkn-payment", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { unlockAmount, tool: toolRaw } = req.body || {};
  const tool = (typeof toolRaw === "string" && TOOL_GRANTS[toolRaw]) ? toolRaw : "ai";
  if (!unlockAmount) return res.status(400).json({ success: false, error: "Missing unlock amount" });

  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  // 3-decimal precision matches the client's generator (1000 unique values per tool).
  // SPL transfers settle exactly on-chain — there's no transfer fee to absorb — so the
  // tolerance only has to swallow floating-point rounding, not real value drift.
  const expectedAmount = parseFloat(parseFloat(unlockAmount).toFixed(3));
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid unlock amount" });
  }
  const tolerance = 0.0005;

  // Anti-tampering: the integer floor of the paid amount must match the tool's price.
  // The unique decimal (<1) only identifies the request — it doesn't change the cost.
  const expectedCost = TOOL_GRANTS[tool].cost;
  if (Math.floor(expectedAmount) !== expectedCost) {
    return res.status(400).json({
      success: false,
      error: `Wrong amount for ${tool} (expected ~${expectedCost} CLKN)`,
    });
  }

  try {
    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

    // Step 1: Get the CLKN token account for our wallet
    const tokenAcctRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "get-token-acct",
        method: "getTokenAccountsByOwner",
        params: [CLKN_RECEIVE_WALLET, { mint: CLKN_MINT_ADDR }, { encoding: "jsonParsed" }]
      })
    });
    const tokenAcctData = await tokenAcctRes.json();
    const tokenAccounts = tokenAcctData?.result?.value || [];
    if (!tokenAccounts.length) return res.status(200).json({ success: false, error: "No CLKN token account found yet. Make sure you sent CLKN to the correct wallet." });

    const tokenAccount = tokenAccounts[0].pubkey;
    const currentBalance = tokenAccounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    console.log(`[CHECK] tool=${tool} acct=${tokenAccount.slice(0,8)} balance=${currentBalance} expected=${expectedAmount}`);

    // Step 2: Get recent signatures for token account (real-time, not cached)
    const sigsRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "get-sigs",
        method: "getSignaturesForAddress",
        params: [tokenAccount, { limit: 10 }]
      })
    });
    const sigsData = await sigsRes.json();
    const signatures = sigsData?.result || [];
    console.log(`[CHECK] Got ${signatures.length} signatures to check`);

    // Step 3: Check each tx for exact incoming amount
    for (const sig of signatures) {
      const txRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "get-tx",
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
        })
      });
      const txData = await txRes.json();
      const tx = txData?.result;
      if (!tx) continue;

      const pre = (tx?.meta?.preTokenBalances || []).find(b => b.mint === CLKN_MINT_ADDR && b.owner === CLKN_RECEIVE_WALLET);
      const post = (tx?.meta?.postTokenBalances || []).find(b => b.mint === CLKN_MINT_ADDR && b.owner === CLKN_RECEIVE_WALLET);
      if (!post) continue;

      const preAmt = pre?.uiTokenAmount?.uiAmount || 0;
      const postAmt = post?.uiTokenAmount?.uiAmount || 0;
      const diff = parseFloat((postAmt - preAmt).toFixed(3));
      console.log(`[CHECK] TX ${sig.signature.slice(0,8)} diff:${diff}`);

      if (diff > 0 && Math.abs(diff - expectedAmount) <= tolerance) {
        // Replay guard: each on-chain transfer unlocks exactly once. Grants are
        // applied client-side, so without this anyone who sees a valid amount
        // on-chain could replay it to unlock for free. The real payer redeems
        // first; a later replay of the same signature is rejected here.
        if (sigStore.has(sig.signature)) {
          return res.status(200).json({ success: false, error: "This payment was already redeemed — each transfer unlocks once." });
        }
        // Find the sender: the CLKN-mint balance row whose owner isn't us and whose
        // post amount is lower than pre. Gives us both the sender wallet and what they
        // have left — the only on-chain proof of holding we can use without a wallet connect.
        let senderWallet = null;
        let senderBalance = null;
        const preBalances = (tx?.meta?.preTokenBalances || []).filter(b => b.mint === CLKN_MINT_ADDR && b.owner !== CLKN_RECEIVE_WALLET);
        for (const preB of preBalances) {
          const postB = (tx?.meta?.postTokenBalances || []).find(b => b.mint === CLKN_MINT_ADDR && b.owner === preB.owner);
          if (!postB) continue;
          const preBAmt = preB.uiTokenAmount?.uiAmount || 0;
          const postBAmt = postB.uiTokenAmount?.uiAmount || 0;
          if (postBAmt < preBAmt) {
            senderWallet = preB.owner;
            senderBalance = postBAmt;
            break;
          }
        }

        // Holder bonus: if the sender kept ≥ HOLDER_BONUS_THRESHOLD CLKN after sending,
        // stretch every numeric grant by HOLDER_BONUS_MULTIPLIER. Proven on-chain, no spoofing.
        // The AI tutor unlock is deliberately flat — send tokens, get questions, holdings don't matter.
        const isHolderBonus = tool !== "ai" && senderBalance !== null && senderBalance >= HOLDER_BONUS_THRESHOLD;
        const baseGrants = TOOL_GRANTS[tool].grants;
        const grants = {};
        for (const k of Object.keys(baseGrants)) {
          grants[k] = isHolderBonus ? baseGrants[k] * HOLDER_BONUS_MULTIPLIER : baseGrants[k];
        }

        // Mark this transfer consumed BEFORE returning so it can't be replayed.
        sigStore.add(sig.signature);
        console.log(`[OK] tool=${tool} verified ${diff} CLKN · sender=${senderWallet?.slice(0,8) || "?"} remaining=${senderBalance} bonus=${isHolderBonus} · consumed=${sigStore.size()}`);

        // Fire Telegram notification — every paid unlock pings the Cluck Norris group
        // so the community sees real on-chain product usage in real time.
        notifyToolUnlock(tool, diff, senderWallet, isHolderBonus, sig.signature);

        // Premium: the send proves the sender owns this wallet. Issue a proof
        // token only if the wallet clears the threshold (use the PRE-send balance
        // so the tiny proof-send can't drop a borderline holder under). The
        // premium run also re-checks the live balance.
        let premiumProof, premiumNote;
        if (tool === "premium") {
          const preSendBalance = senderBalance != null ? senderBalance + diff : null;
          if (preSendBalance != null && preSendBalance >= PREMIUM_HOLDER_THRESHOLD) {
            premiumProof = issuePremiumProof(senderWallet);
          } else {
            premiumNote = { insufficient: true, balance: preSendBalance, threshold: PREMIUM_HOLDER_THRESHOLD };
          }
        } else if (tool === "ownership") {
          // Credential Tier-2: plain wallet-ownership proof, no holder gate.
          premiumProof = issuePremiumProof(senderWallet);
        }

        return res.status(200).json({
          success: true,
          tool,
          amountReceived: diff,
          signature: sig.signature,
          senderWallet,
          senderBalance,
          holderBonus: isHolderBonus,
          grants,
          premiumProof,
          premiumNote,
          // Legacy back-compat for the existing AI client which reads questionsGranted directly.
          questionsGranted: grants.questions || undefined,
        });
      }
    }

    return res.status(200).json({ success: false, error: "Payment not found yet." });
  } catch(err) {
    console.error("Verify payment error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Premium "connect + sign" ownership proof. The client connects via the normal
// injected provider and signs a plain text message (signMessage) — NOT a
// transaction, no token movement, no spending approval. We verify the ed25519
// signature here, confirm it binds this wallet + a fresh nonce, then issue a
// proof token. The premium run re-checks the live CLKN balance ≥ threshold.
app.post("/api/premium-verify-sig", rateLimit("pay", { windowMs: 60000, max: 30 }), async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const { wallet, signature, message } = req.body || {};
  if (!wallet || !signature || !message) return res.status(400).json({ success: false, error: "Missing wallet, signature, or message" });
  if (!SOL_ADDR_RE.test(String(wallet))) return res.status(400).json({ success: false, error: "Invalid wallet address" });
  // The message must bind THIS wallet and a recent nonce (anti-replay).
  if (!String(message).includes("wallet: " + wallet)) return res.status(400).json({ success: false, error: "Message does not match wallet" });
  const m = /nonce:\s*(\d{10,16})/.exec(String(message));
  const ts = m ? parseInt(m[1], 10) : 0;
  if (!ts || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return res.status(400).json({ success: false, error: "Stale or missing nonce — try again" });
  if (!verifySolanaSignature(String(message), String(signature), String(wallet))) {
    return res.status(401).json({ success: false, error: "Signature did not verify" });
  }
  // Ownership proven. The proof token only proves OWNERSHIP — every consumer
  // re-checks its OWN live balance gate downstream (premium re-checks 2M at run;
  // the slot re-checks its 500k floor on every spin). So a caller may request a
  // lower issuance floor (e.g. the Coop Spinner needs 500k, not 2M) WITHOUT
  // weakening premium: a sub-2M wallet that gets a proof here still can't run
  // premium forensics. Floor is clamped to ≤ 2M so this can never raise the bar.
  const reqFloor = Number((req.body || {}).minHold);
  const floor = Number.isFinite(reqFloor) && reqFloor > 0 ? Math.min(reqFloor, PREMIUM_HOLDER_THRESHOLD) : PREMIUM_HOLDER_THRESHOLD;
  let balance = null;
  try { balance = (await checkCLKNHolder(wallet)).balance; } catch (_) {}
  if (balance != null && balance < floor) {
    return res.status(200).json({ success: false, error: "insufficient_holdings", balance, threshold: floor });
  }
  return res.status(200).json({ success: true, wallet, balance, proof: issuePremiumProof(wallet) });
});

// Lightweight public CLKN balance read (balances are public on-chain data). Lets
// the premium UI show "you hold X CLKN" for an ALREADY-verified wallet without
// making them re-verify. Bounded by the global /api/ rate limiter.
app.get("/api/clkn-balance", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const wallet = String(req.query.wallet || "").trim();
  if (!SOL_ADDR_RE.test(wallet)) return res.status(400).json({ success: false, error: "invalid wallet" });
  try {
    const h = await checkCLKNHolder(wallet);
    return res.status(200).json({ success: true, wallet, balance: h.balance, threshold: PREMIUM_HOLDER_THRESHOLD, holder: h.balance >= PREMIUM_HOLDER_THRESHOLD });
  } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// ── THE COOP SPINNER — private-beta backend ────────────────────────────────
// Server-authoritative slot: outcomes, points, daily spin limits and the weekly
// draw all live on the server (volume-backed kv) so nothing can be faked client
// side. Access = a wallet ALLOWLIST (admin adds the demo wallets); a spin is
// authenticated by the SAME ownership proof token used for premium. Spins/day =
// floor(balance / 1,000,000). Two roads to the weekly wheel: jackpot (🐔🐔🐔)
// auto-entry, or top-N by points. Draw is capped-weighted. Payout is manual.
const SLOT_SYMS = ["🐔", "🪙", "7️⃣", "💎", "🔥", "🥚", "🍗", "🩺"];   // 🩺 = rare "Doctor" symbol
const SLOT_WEIGHTS = [15, 14, 14, 14, 14, 14, 15, 3];   // per-reel frequency; 🐔🐔🐔 ≈ 1/324, 🩺🔥🐔 ≈ 1/1700
const SLOT_PTS = { spin: 5, threeKind: 40, twoCluck: 25, jackpot: 75, fireChicken: 100 };
const SLOT_FIRE_CHICKEN_AIRDROP = 7777;   // 🩺🔥🐔 Dr. Fire Chicken easter egg → CLKN airdrop (OG community honor)
const SLOT_PTS_PER_ENTRY = 120, SLOT_ENTRY_CAP = 5;
const SLOT_WHEEL = 40, SLOT_WILD = 13;   // 40-entrant wheel = up to (40-13)=27 by points + 13 wild-card; jackpots guaranteed
const SLOT_SPIN_PER = 500_000;   // eligibility floor (≈$100) + the no-sell baseline unit
const SLOT_HOLD_TOL = 0.99;      // must hold ≥99% of week-entry balance — any sell/move-out disqualifies
// Banded daily spins (user-chosen): 500k–2M→5, 2–5M→10, 5–10M→15, 10M+→20. Flatter ladder = entry holders get a real game.
function slotAllot(bal){ return bal < 500000 ? 0 : bal < 2000000 ? 5 : bal < 5000000 ? 10 : bal < 10000000 ? 15 : 20; }
function slotWeekId() {
  const d = new Date(); const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return d.getUTCFullYear() + "-W" + String(wk).padStart(2, "0");
}
// When the current points-week rolls over (board resets) — for the UI countdown.
function slotWeekEndsAt() {
  const d = new Date(); const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const offset = (d - jan1) / 86400000 + jan1.getUTCDay() + 1; // matches slotWeekId
  const daysLeft = Math.ceil(offset / 7) * 7 - offset;
  return Date.now() + Math.max(0, daysLeft) * 86400000;
}
const slotDayId = () => new Date().toISOString().slice(0, 10);
// When a wallet's daily spins refresh — next UTC midnight, matching slotDayId().
// Used by the page to count down "next free spins in …" once a wallet taps out.
function slotDayEndsAt() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}
function slotState() {
  let s = kv.get("slotsState", null);
  const wk = slotWeekId();
  if (!s || s.weekId !== wk) {                          // new week → reset points/spins, KEEP allowlist + past draws
    s = { weekId: wk, players: {}, spins: {}, bal: {}, allow: (s && s.allow) || [], draws: (s && s.draws) || {} };
    kv.set("slotsState", s);
  }
  return s;
}
// Wallet CLKN balance with a short TTL cache → daily spins (min(20, floor(bal/500k)))
// are recomputed LIVE from this, so buying more mid-week bumps your spins within
// ~60s. A burst of spins reuses one check, and the 20-cap bounds it all.
const SLOT_BAL_TTL = 60_000;
async function slotBalance(s, wallet) {
  s.bal = s.bal || {}; const c = s.bal[wallet];
  if (c && Date.now() - c.ts < SLOT_BAL_TTL) return c.bal;
  let bal; try { bal = (await checkCLKNHolder(wallet)).balance; } catch (_) { bal = c ? c.bal : 0; }
  s.bal[wallet] = { bal, ts: Date.now() }; kv.set("slotsState", s); return bal;
}
function slotPick() {
  const tot = SLOT_WEIGHTS.reduce((a, w) => a + w, 0);
  const pick = () => { let r = Math.random() * tot; for (let i = 0; i < SLOT_WEIGHTS.length; i++) { r -= SLOT_WEIGHTS[i]; if (r <= 0) return SLOT_SYMS[i]; } return SLOT_SYMS[6]; };
  return [pick(), pick(), pick()];
}
function slotScore(o) {
  let pts = SLOT_PTS.spin, jackpot = false, fireChicken = false, kind = "spin";
  if (o[0] === "🩺" && o[1] === "🔥" && o[2] === "🐔") {           // 🩺🔥🐔 = DR. FIRE CHICKEN (ordered, rare)
    pts += SLOT_PTS.fireChicken; fireChicken = true; jackpot = true; kind = "fireChicken"; // also guarantees a wheel seat
  } else if (o[0] === o[1] && o[1] === o[2]) {
    if (o[0] === "🐔") { pts += SLOT_PTS.jackpot; jackpot = true; kind = "jackpot"; } else { pts += SLOT_PTS.threeKind; kind = "threeKind"; }
  } else if (o.filter(x => x === "🐔").length === 2) { pts += SLOT_PTS.twoCluck; kind = "twoCluck"; }
  return { pts, jackpot, fireChicken, kind };
}
// Exact per-spin odds, derived straight from SLOT_WEIGHTS + the scoring rules —
// published to the page so players can see the real math (and it can never drift
// from the code). Returns each combo's probability + "1 in N".
function slotOdds() {
  const tot = SLOT_WEIGHTS.reduce((a, w) => a + w, 0);
  const w = (sym) => SLOT_WEIGHTS[SLOT_SYMS.indexOf(sym)] / tot;
  const cluck = w("🐔");
  const fireChicken = w("🩺") * w("🔥") * w("🐔");           // ordered 🩺🔥🐔
  const jackpot = cluck ** 3;                                 // 🐔🐔🐔
  let threeKind = 0;                                          // any non-🐔 three-of-a-kind
  for (let i = 0; i < SLOT_SYMS.length; i++) if (SLOT_SYMS[i] !== "🐔") threeKind += (SLOT_WEIGHTS[i] / tot) ** 3;
  const twoCluck = 3 * cluck * cluck * (1 - cluck);          // exactly two 🐔
  const anyWin = fireChicken + jackpot + threeKind + twoCluck;
  const oneIn = (x) => x > 0 ? Math.round(1 / x) : null;
  return {
    fireChicken: { pct: +(fireChicken * 100).toFixed(4), oneIn: oneIn(fireChicken) },
    jackpot:     { pct: +(jackpot * 100).toFixed(3),     oneIn: oneIn(jackpot) },
    threeKind:   { pct: +(threeKind * 100).toFixed(2),   oneIn: oneIn(threeKind) },
    twoCluck:    { pct: +(twoCluck * 100).toFixed(2),    oneIn: oneIn(twoCluck) },
    anyWin:      { pct: +(anyWin * 100).toFixed(2),      oneIn: oneIn(anyWin) },
  };
}
function slotLeaderboard(s, me) {
  const arr = Object.entries(s.players).map(([w, p]) => ({ wallet: w, pts: p.pts, jackpot: !!p.jackpot }))
    .sort((a, b) => b.pts - a.pts);
  return arr.slice(0, 20).map((p, i) => ({
    short: p.wallet.slice(0, 4) + "…" + p.wallet.slice(-4), pts: p.pts, jackpot: p.jackpot,
    qualified: i < (SLOT_WHEEL - SLOT_WILD) || p.jackpot, isMe: p.wallet === me, rank: i + 1,
  }));
}
const slotAdminOK = (req) => process.env.PREMIUM_ACCESS_KEY && (req.query.key === process.env.PREMIUM_ACCESS_KEY || req.headers["x-premium-key"] === process.env.PREMIUM_ACCESS_KEY);

// Spin — authenticated by the premium ownership proof. Enforces allowlist + daily limit.
app.post("/api/slots/spin", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const wallet = verifyPremiumProof((req.body || {}).proof);
  if (!wallet) return res.status(401).json({ error: "verify_wallet" });
  const s = slotState();
  // Open beta (default): anyone with the link who holds the floor can play.
  // Operator can close it back to invite-only (s.openBeta=false) for launch.
  if (s.openBeta === false && !s.allow.includes(wallet)) return res.status(403).json({ error: "not_in_beta" });
  if (s.draws[s.weekId]) return res.status(409).json({ error: "week_closed" });
  const bal = await slotBalance(s, wallet);
  const allot = slotAllot(bal);                                               // banded; live — reflects buys within ~60s
  if (allot < 1) return res.status(403).json({ error: "need_floor", balance: bal, floor: SLOT_SPIN_PER });
  const day = slotDayId(); s.spins[day] = s.spins[day] || {}; const used = s.spins[day][wallet] || 0;
  if (used >= allot) return res.status(429).json({ error: "no_spins_left", spinsLeft: 0, dailyAllot: allot, spinsResetAt: slotDayEndsAt() });
  const outcome = slotPick(), sc = slotScore(outcome);
  s.spins[day][wallet] = used + 1;
  const p = s.players[wallet] || { pts: 0, jackpot: false, entryBal: bal };
  if (p.entryBal == null) p.entryBal = bal;                     // week-entry balance, recorded ONCE (first spin)
  // The 7,777 CLKN Fire Chicken airdrop is capped at ONCE per wallet per week.
  // The first 🩺🔥🐔 of the week locks it (and shouts to the group); later hits
  // still score points and show the combo, but don't re-award or re-announce.
  const fcFirst = sc.fireChicken && !p.fireChicken;
  p.pts += sc.pts; if (sc.jackpot) p.jackpot = true; if (sc.fireChicken) p.fireChicken = true; s.players[wallet] = p;
  kv.set("slotsState", s);
  if (fcFirst) {                                                 // 🩺🔥🐔 easter egg → shout it to the group (first of the week only)
    const wShort = wallet.slice(0, 4) + "…" + wallet.slice(-4);
    notifyTelegram(
      `🩺🔥🐔 <b>DR. FIRE CHICKEN!</b> 🐔🔥🩺\n\n` +
      `<code>${wShort}</code> just landed the legendary combo on The Coop Spinner — an honor to the OG Fire Chicken roost. 🔥\n\n` +
      `🎁 That's an <b>automatic ${SLOT_FIRE_CHICKEN_AIRDROP.toLocaleString()} CLKN</b> airdrop at week's end (hold through the draw to claim it). One per wallet per week.\n\n` +
      `One of the rarest pulls in the coop. Think you can find the Doctor? 🎰\n🐔 clucknorris.app/slots\n\n<i>Beta — prizes are owner-funded, not project/fee funds. NFA.</i>`
    );
  }
  try { analytics.trackTool("slot_spin"); } catch (_) {}
  return res.status(200).json({ outcome, gained: sc.pts, kind: sc.kind, jackpot: p.jackpot, fireChicken: !!p.fireChicken, hitFireChicken: !!sc.fireChicken, airdrop: fcFirst ? SLOT_FIRE_CHICKEN_AIRDROP : 0, fireChickenAlreadyWon: sc.fireChicken && !fcFirst, totalPoints: p.pts, spinsLeft: allot - (used + 1), dailyAllot: allot, spinsResetAt: slotDayEndsAt(), weekId: s.weekId, leaderboard: slotLeaderboard(s, wallet) });
});

// Player + board state (proof optional — board is visible to the beta group).
app.get("/api/slots/state", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = slotState();
  const wallet = verifyPremiumProof(req.query.proof);
  let me = null;
  if (wallet) {
    const inBeta = s.openBeta !== false || s.allow.includes(wallet);
    const bal = await slotBalance(s, wallet);
    const allot = slotAllot(bal);
    const used = (s.spins[slotDayId()] || {})[wallet] || 0;
    const p = s.players[wallet] || { pts: 0, jackpot: false };
    const sold = p.entryBal != null && bal < p.entryBal * SLOT_HOLD_TOL;       // matters only at draw
    me = { wallet, inBeta, balance: bal, dailyAllot: allot, spinsLeft: Math.max(0, allot - used), points: p.pts, jackpot: !!p.jackpot, fireChicken: !!p.fireChicken, floor: SLOT_SPIN_PER, disqualified: sold };
  }
  return res.status(200).json({ weekId: s.weekId, weekEndsAt: slotWeekEndsAt(), spinsResetAt: slotDayEndsAt(), openBeta: s.openBeta !== false, drawn: s.draws[s.weekId] || null, me, leaderboard: slotLeaderboard(s, wallet), odds: slotOdds() });
});

// Admin: manage the demo allowlist.
app.post("/api/slots/allow", (req, res) => {
  if (!slotAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const s = slotState(); const w = String(req.query.wallet || "").trim();
  if (req.query.remove === "1") { s.allow = s.allow.filter(x => x !== w); }
  else { if (!SOL_ADDR_RE.test(w)) return res.status(400).json({ error: "invalid wallet" }); if (!s.allow.includes(w)) s.allow.push(w); }
  kv.set("slotsState", s);
  return res.status(200).json({ allow: s.allow });
});

// Admin: run the weekly draw. Builds a 40-entrant wheel: jackpot hitters are
// GUARANTEED a slot, then top point-earners fill up to (40-13)=27, then 13
// WILD-CARD slots are drawn at random from everyone else who played — that's
// how smaller/casual holders get a shot. Skin-in-the-game: every finalist must
// STILL hold ≥ floor at draw AND not have sold (balance ≥99% of week-entry).
// The spin itself is capped-weighted (more points = up to 5× the slices).
app.post("/api/slots/draw", async (req, res) => {
  if (!slotAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const s = slotState();
  const ranked = Object.entries(s.players).map(([w, p]) => ({ wallet: w, pts: p.pts, jackpot: !!p.jackpot, fireChicken: !!p.fireChicken, entryBal: p.entryBal }))
    .sort((a, b) => b.pts - a.pts);
  // Live re-check ALL players: must hold ≥ floor now AND not have sold/moved out.
  const checked = await Promise.all(ranked.map(async x => {
    let bal = 0; try { bal = (await checkCLKNHolder(x.wallet)).balance; } catch (_) {}
    const sold = x.entryBal != null && bal < x.entryBal * SLOT_HOLD_TOL;
    return { ...x, bal, sold, eligible: bal >= SLOT_SPIN_PER && !sold };
  }));
  const dropped = checked.filter(x => !x.eligible).map(x => ({ wallet: x.wallet.slice(0, 4) + "…" + x.wallet.slice(-4), reason: x.sold ? "sold/moved CLKN" : "below floor" }));
  const finalists = checked.filter(x => x.eligible);                  // sorted by pts (Promise.all preserves order)
  // 🩺🔥🐔 Dr. Fire Chicken winners — anyone who landed the easter egg AND still holds → guaranteed 7,777 CLKN airdrop.
  const fireChicken = checked.filter(x => x.fireChicken && x.eligible)
    .map(x => ({ wallet: x.wallet, short: x.wallet.slice(0, 4) + "…" + x.wallet.slice(-4), airdrop: SLOT_FIRE_CHICKEN_AIRDROP }));
  // Build the wheel: jackpots guaranteed → top points to 27 → wild-card to 40.
  const POINTS = SLOT_WHEEL - SLOT_WILD;
  const set = new Set();
  finalists.filter(x => x.jackpot).forEach(x => set.add(x.wallet));   // jackpot = guaranteed slot
  for (const x of finalists) { if (set.size >= POINTS) break; set.add(x.wallet); }   // top point-earners
  const rest = finalists.filter(x => !set.has(x.wallet));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  let wild = 0;
  for (const x of rest) { if (set.size >= SLOT_WHEEL) break; set.add(x.wallet); x._wild = true; wild++; }   // wild-card fill
  const entrants = finalists.filter(x => set.has(x.wallet)).map(x => ({
    wallet: x.wallet, pts: x.pts, jackpot: x.jackpot, wild: !!x._wild,
    entries: Math.max(1, Math.min(SLOT_ENTRY_CAP, Math.round(x.pts / SLOT_PTS_PER_ENTRY))),
  }));
  if (!entrants.length) return res.status(400).json({ error: "no_eligible_entrants", dropped });
  const pool = entrants.reduce((a, e) => a + e.entries, 0);
  const summary = { wheel: entrants.length, jackpotSlots: entrants.filter(e => e.jackpot).length, wildCardSlots: wild, pool, dropped: dropped.length, fireChickenWinners: fireChicken.length };
  const shorts = entrants.map(e => ({ short: e.wallet.slice(0, 4) + "…" + e.wallet.slice(-4), entries: e.entries, jackpot: e.jackpot, wild: e.wild }));
  const fcShorts = fireChicken.map(f => ({ short: f.short, airdrop: f.airdrop }));
  if (req.query.preview === "1") return res.status(200).json({ preview: true, ...summary, entrants: shorts, dropped, fireChicken });
  let r = Math.random() * pool, winner = entrants[0];
  for (const e of entrants) { r -= e.entries; if (r <= 0) { winner = e; break; } }
  s.draws[s.weekId] = { winner: winner.wallet, at: Date.now(), ...summary, entrants: shorts, fireChicken: fcShorts };
  kv.set("slotsState", s);
  return res.status(200).json({ winner: winner.wallet, winnerShort: winner.wallet.slice(0, 4) + "…" + winner.wallet.slice(-4), ...summary, entrants: shorts, fireChicken, weekId: s.weekId });
});

// Admin: reset the CURRENT week (clears points/spins/draw, keeps the allowlist).
app.post("/api/slots/reset", (req, res) => {
  if (!slotAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const s = slotState(); s.players = {}; s.spins = {}; s.bal = {}; delete s.draws[s.weekId]; kv.set("slotsState", s);
  return res.status(200).json({ ok: true, weekId: s.weekId, allow: s.allow });
});

// Admin: open beta (anyone with the link + ≥floor can play) vs invite-only (allowlist).
app.post("/api/slots/open", (req, res) => {
  if (!slotAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const s = slotState(); s.openBeta = req.query.on !== "0"; kv.set("slotsState", s);
  return res.status(200).json({ ok: true, openBeta: s.openBeta });
});

// -- Ask Cluck Norris (Claude AI) --
app.post("/api/ask-cluck", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { question, context } = req.body;
  if (!question || question.trim().length < 3) {
    return res.status(400).json({ success: false, error: "Question too short" });
  }
  // Cap input length so a single call can't be inflated to run up token cost.
  if (typeof question !== "string" || question.length > 2000) {
    return res.status(400).json({ success: false, error: "Question too long" });
  }
  const safeContext = typeof context === "string" ? context.slice(0, 200) : "";

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ success: false, error: "AI not configured" });
  }

  try {
    const systemPrompt = `You are Cluck Norris -- the toughest crypto professor in the schoolyard. You teach DeFi, blockchain, and crypto concepts at the School of Crypto Hard Knocks, powered by the CLKN token on Solana and built on Bags.fm.

YOUR SCHOOL -- KNOW THIS COLD:
- The app is live at clucknorris.app
- Built on Bags.fm, powered by the CLKN token on Solana
- CLKN contract: DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS
- Trade CLKN at: bags.fm or Jupiter
- The school has 5 areas: The Incubator (beginner), School of Hard Knocks (12 lessons), The Ultimate Challenge, The Library, and Token Data

THE CLKN INCUBATOR:
- For complete beginners. 6 lessons covering wallets, tokens, DEXs, liquidity, market cap, and safety.
- After completing the Incubator you graduate to the School of Hard Knocks

SCHOOL OF HARD KNOCKS:
- 12 progressive lessons with a belt ranking system from Freshman to Emeritus
- Topics: liquidity pools, tokenomics, MEV, on-chain research, rugs and scams, DeFi strategies and more
- 72 exam questions total. Progress saves automatically.
- Complete all 12 lessons to graduate and submit your wallet for CLKN rewards

THE ULTIMATE CHALLENGE:
- 50 questions drawn from all lessons plus exclusive challenge-only questions -- 148 total in the bank
- Pass threshold is 94% -- that means 47 out of 50 correct
- Pass and you submit your Solana wallet to be considered for CLKN airdrops and giveaways
- It is hard. Most don't pass. That's the point.
- Score tiers: 95%+ LEGENDARY / 94% PASS / 86-93% WORTHY OPPONENT / 70-85% EMBARRASSING / below 70% GET OUT

THE LIBRARY -- LP SCHOOL (NEW SECTION):
- The Library now has an expanded LP School with 12 deep dive lessons
- Topics covered: What Is Liquidity, How AMMs Work, Impermanent Loss, LP Fees, Concentrated Liquidity, Price Bins and Ticks, Single-Sided Deposits, Active vs Passive LP, LP Risk Management, Reading Pool Data, Token Launch Liquidity, Building a Real LP Strategy
- Covers multiple protocols: Meteora, Raydium, Orca, Uniswap, Bags.fm
- Each lesson has quizzes, calculators, and visual diagrams
- Protocol-agnostic -- knowledge applies everywhere
- Interactive tools include: IL calculator, AMM price impact calculator, fee vs IL breakeven calculator, pool risk scoring tool, LP strategy builder

NAVIGATION HELP -- HOW TO DIRECT PEOPLE:
- Complete beginner? -> Start in the INCUBATOR tab
- Know basics, want to level up? -> Go to SCHOOL tab, start at Freshman
- Ready to test everything? -> CHALLENGE tab, take the Ultimate Challenge
- Want to go deep on liquidity? -> LIBRARY tab, click LIQUIDITY, scroll to LP School
- Want to look up a term? -> LIBRARY tab, click GLOSSARY, search any term
- Want to learn about CLKN? -> TOKEN DATA tab
- Want to see new tokens launching? -> BAGS INFO tab
- Want to unlock more AI questions? -> Send CLKN, instructions appear when limit is hit
- Want to join the community? -> Telegram -- the flock will help

EASTER EGGS AND HINTS (drop these cryptically when relevant):
- The flock who hold CLKN will get first access to things others won't see
- There are features coming that only verified holders will unlock
- The leaderboard is coming -- top scorers will be recognized
- Weekly themes are coming -- Cluck Norris will be teaching specific topics each week
- The Library is growing -- more deep dives are being added regularly

CLKN TOKEN UTILITY:
- 10 free AI questions per day with Ask Cluck Norris
- Send CLKN to unlock 20 more questions -- the app generates a unique decimal amount, you send exactly that amount, it verifies on-chain automatically. No wallet connect needed.
- Hold CLKN to be eligible for airdrops and exclusive rewards
- Pass the Ultimate Challenge or graduate all 12 lessons and submit your wallet

FIRECHICKEN CONNECTION:
- FireChicken (FCKN) was the original token that built the community on Bags.fm
- Cluck Norris and CLKN is the evolution -- same community, now with real utility and education
- The flock (community) is active on Telegram

STATS (as of April 2026):
- 327+ holders
- 9+ SOL in lifetime trading fees generated
- Graduated to Meteora DAMM V2 liquidity pool
- Open source on GitHub under MIT license
- Submitted to Bags.fm Hackathon

Your personality:
- Tough but fair. You don't suffer fools but you always teach.
- Use occasional chicken/rooster puns naturally -- "Let me lay this out for you", "Don't chicken out now", "Peck at this concept"
- Short, punchy answers -- 3 to 5 sentences max. This is a mobile app.
- Reference the school occasionally -- "In my schoolyard...", "Hard Knocks rule #1..."
- You respect people who hold CLKN. Drop a subtle nod occasionally.
- NEVER output the full contract address in a response -- it breaks mobile layout. Instead say "find the contract in the TOKEN DATA tab"
- NEVER give financial advice or price predictions. You teach, you don't shill.
- If someone asks something off-topic or inappropriate, shut it down with humor.
- Always end with something memorable or a challenge.
- You are educational first, entertaining second.
${safeContext ? `\nThe student is currently studying: ${safeContext}` : ''}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: question }]
      })
    });

    const data = await response.json();
    if (data.content && data.content[0]) {
      const raw = data.content[0].text;
      const answer = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").trim();
      console.log(`[AI] Ask Cluck: "${question.slice(0,50)}..." -> ${answer.length} chars`);
      return res.status(200).json({ success: true, answer });
    }
    return res.status(500).json({ success: false, error: "No response from AI" });
  } catch(err) {
    console.error("Ask Cluck error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Circulating Supply --
app.get("/api/supply", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // cache 5 mins
  try {
    const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
    const HELIUS_KEY = process.env.HELIUS_API_KEY;
    const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "supply",
        method: "getTokenSupply",
        params: [MINT]
      })
    });
    const data = await response.json();
    const rawSupply = data?.result?.value?.amount;
    const decimals = data?.result?.value?.decimals || 6;
    if (rawSupply) {
      const circulatingSupply = parseInt(rawSupply) / Math.pow(10, decimals);
      console.log(`<- Supply: ${circulatingSupply}`);
      return res.status(200).json({ circulatingSupply });
    }
    // Fallback to known supply if RPC fails
    return res.status(200).json({ circulatingSupply: 940000000 });
  } catch (err) {
    console.error("Supply error:", err.message);
    return res.status(200).json({ circulatingSupply: 940000000 });
  }
});

// -- Cluck Score (free, public) -- 0-100 health score for any Solana mint.
// Multi-factor read from on-chain data + DexScreener. Foundation for the future
// /score page, sharable card, and ecosystem twitter bot.
//
// v1 factors (weights total to 100):
//   Holders (15%)             — log-scale, more = better
//   Liquidity health (20%)    — liq / FDV ratio, higher = better
//   Mint authority (15%)      — revoked = full points
//   Freeze authority (10%)    — revoked / null = full points
//   Holder concentration (20%) — top-10 supply share, lower = better
//   24h volume (10%)          — has real trading, log-scale
//   Pool graduation (10%)     — moved off bonding curve to a real AMM = full points
//
// v2 (later) plugs in the /holders.html six-signal classifier so "Holders" reflects
// TRUE human wallets, not LP/locked/program addresses.
// DexScreener stops indexing a pair ~24h after its last trade, which makes a
// quiet-but-real token look like it has zero liquidity. GeckoTerminal indexes
// pools straight from the chain and keeps quiet ones listed, so it's used as a
// fallback to recover liquidity / price / FDV. Returns null on any failure.
async function fetchGeckoTerminalFallback(mint) {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?include=base_token`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const pools = Array.isArray(j?.data) ? j.data : [];
    if (!pools.length) return null;

    let totalLiqUsd = 0, totalVol24h = 0, best = null, bestLiq = -1;
    const dexFamilies = new Set();
    for (const p of pools) {
      const a = p.attributes || {};
      const liq = parseFloat(a.reserve_in_usd) || 0;
      totalLiqUsd += liq;
      totalVol24h += parseFloat(a.volume_usd?.h24) || 0;
      const dex = (p.relationships?.dex?.data?.id || "").toLowerCase().split("-")[0];
      if (dex) dexFamilies.add(dex);
      if (liq > bestLiq) { bestLiq = liq; best = p; }
    }
    if (totalLiqUsd <= 0 || !best) return null;

    // The queried mint may sit on either side of the top pool — price the right one.
    const a = best.attributes || {};
    const mintIsBase = (best.relationships?.base_token?.data?.id || "") === `solana_${mint}`;
    const priceUsd = parseFloat(mintIsBase ? a.base_token_price_usd : a.quote_token_price_usd) || null;
    const fdv = parseFloat(a.fdv_usd || a.market_cap_usd) || null;
    const dexId = (best.relationships?.dex?.data?.id || "").toLowerCase();

    // Symbol/name from the included base_token object, when present.
    let symbol = null, name = null;
    const tok = (Array.isArray(j.included) ? j.included : []).find(x => x.id === `solana_${mint}`);
    if (tok) { symbol = tok.attributes?.symbol || null; name = tok.attributes?.name || null; }

    return { totalLiqUsd, totalVol24h, dexFamilies, priceUsd, fdv, dexId,
             poolCount: pools.length, pairAddress: a.address || null, symbol, name };
  } catch (e) {
    console.warn("[cluck-score] GeckoTerminal fallback failed:", e.message);
    return null;
  }
}

app.get("/api/cluck-score", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // 5-minute edge cache
  const mint = (req.query.mint || "").trim();
  if (!SOL_ADDR_RE.test(mint)) {
    return res.status(400).json({ success: false, error: "Invalid mint" });
  }
  try { analytics.trackTool("cluck_score"); } catch (_) {}
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) {
    return res.status(500).json({ success: false, error: "Server not configured" });
  }
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

  // One retry with backoff on a transient failure (429 / 5xx / network) so a
  // single rate-limited call doesn't silently drop a whole scoring factor. The
  // score is edge-cached 5 min, so the extra calls are bounded.
  async function rpcCall(id, method, params, _retry = 0) {
    try {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
      });
      if (r.status === 429 || r.status >= 500) throw new Error("rpc " + r.status);
      return await r.json();
    } catch (e) {
      if (_retry < 1) { await new Promise(res => setTimeout(res, 350)); return rpcCall(id, method, params, _retry + 1); }
      throw e;
    }
  }

  try {
    const [holdersData, dexData, supplyData, mintInfoData, largestData, bagsCtxData] = await Promise.allSettled([
      // Holder count — same paginated walk as /api/holders. Walk up to 10 pages
      // (10k accounts); if we hit the limit on a full page, more holders exist —
      // flag it as capped so the count is shown as "10,000+" instead of a wrong exact.
      (async () => {
        const owners = new Set();
        let capped = false;
        const MAX_PAGES = 10;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const d = await rpcCall(`score-holders-${page}`, "getTokenAccounts", {
            page, limit: 1000, mint, displayOptions: { showZeroBalance: false }
          });
          const accounts = d?.result?.token_accounts || [];
          if (!accounts.length) break;
          for (const a of accounts) {
            if (parseInt(a.amount) > 0) owners.add(a.owner);
          }
          if (accounts.length < 1000) break;
          if (page === MAX_PAGES) capped = true;
        }
        return { count: owners.size, capped };
      })(),
      fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(r => r.json()),
      rpcCall("score-supply", "getTokenSupply", [mint]),
      rpcCall("score-mint-info", "getAccountInfo", [mint, { encoding: "jsonParsed" }]),
      rpcCall("score-largest", "getTokenLargestAccounts", [mint]),
      // Shared Bags + Jupiter context — cached per-mint so multiple endpoints
      // hitting the same mint share the result.
      fetchBagsContext(mint),
    ]);

    // Extract data with safe defaults
    const holderInfo = holdersData.status === "fulfilled" ? holdersData.value : null;
    const holderCount = holderInfo ? holderInfo.count : null;
    const holderCountCapped = !!(holderInfo && holderInfo.capped);
    const allDexPairs = dexData.status === "fulfilled" && Array.isArray(dexData.value) ? dexData.value : [];
    // Only count Solana pairs. Sum liquidity across all of them — a token with
    // $20K on Meteora + $20K on Raydium has $40K of real exit liquidity, not $20K.
    const solPairs = allDexPairs.filter(p => p.chainId === "solana" || !p.chainId);
    let totalLiqUsd = solPairs.reduce((s, p) => s + (parseFloat(p.liquidity?.usd) || 0), 0);
    let totalVol24h = solPairs.reduce((s, p) => s + (parseFloat(p.volume?.h24) || 0), 0);
    // Unique DEX *protocols* (collapsing "meteora-damm-v2" / "meteora-dlmm" → "meteora")
    let dexFamilies = new Set();
    for (const p of solPairs) {
      const id = (p.dexId || "").toLowerCase().split("-")[0];
      if (id) dexFamilies.add(id);
    }
    // Top pair still used as the source of truth for price + graduation detection.
    let topPair = solPairs.length
      ? solPairs.slice().sort((a,b) => (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0))[0]
      : null;
    let poolCount = solPairs.length;

    // No DexScreener liquidity usually means the pair went quiet and got
    // dropped from its index — the pool still exists on-chain. Recover the
    // numbers from GeckoTerminal so a quiet token isn't scored as dead.
    let scoreSource = "dexscreener";
    if (totalLiqUsd === 0) {
      const gecko = await fetchGeckoTerminalFallback(mint);
      if (gecko) {
        scoreSource = "geckoterminal";
        totalLiqUsd = gecko.totalLiqUsd;
        totalVol24h = gecko.totalVol24h;
        dexFamilies = gecko.dexFamilies;
        poolCount = gecko.poolCount;
        topPair = {
          priceUsd: gecko.priceUsd,
          fdv: gecko.fdv,
          marketCap: gecko.fdv,
          dexId: gecko.dexId,
          labels: [],
          pairAddress: gecko.pairAddress,
          baseToken: { symbol: gecko.symbol, name: gecko.name },
        };
      }
    }
    // Solana Tracker correction for launchpad bonding-curve tokens. DexScreener
    // reports a phantom near-zero pool for on-curve Bags/pump tokens (a tiny
    // non-zero value that BYPASSES the $0 GeckoTerminal fallback above), which
    // would unfairly tank the liquidity component of the score. ST reads the
    // curve reserve directly — use it when it's materially larger, the same fix
    // applied to the autopsy and the launches feed.
    let onBondingCurve = false, curvePctToGrad = null;
    try {
      const stm = await solanaTracker.getTokenMarketStatus(mint);
      if (stm) {
        onBondingCurve = stm.onBondingCurve === true;
        curvePctToGrad = stm.curvePercentage;
        if (stm.liquidityUsd != null && stm.liquidityUsd > totalLiqUsd) {
          totalLiqUsd = stm.liquidityUsd;
          scoreSource = scoreSource === "dexscreener" ? "solana-tracker" : scoreSource + "+st";
          if (poolCount === 0) poolCount = 1;
        }
      }
    } catch (_) { /* degrade — keep DexScreener/Gecko numbers */ }

    const rawSupply = supplyData.status === "fulfilled" ? supplyData.value?.result?.value?.amount : null;
    const decimals = supplyData.status === "fulfilled" ? (supplyData.value?.result?.value?.decimals || 9) : 9;
    const supplyTokens = rawSupply ? parseInt(rawSupply) / Math.pow(10, decimals) : null;
    const mintParsed = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.data?.parsed?.info : null;
    const mintAuthority = mintParsed ? mintParsed.mintAuthority : undefined; // null = revoked, string = not revoked
    const freezeAuthority = mintParsed ? mintParsed.freezeAuthority : undefined;

    // Token-2022 honeypot scan — read straight off the mint account we already
    // fetched (no extra RPC). Dangerous extensions let a token block sells, seize
    // holders' tokens, or tax every transfer — so a token can otherwise score well
    // and still be a trap. Hard-danger extensions cap the score.
    const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    const SYS_PROG = "11111111111111111111111111111111";
    const mintProgram = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.owner : null;
    const isToken2022 = mintProgram === TOKEN_2022_PROGRAM;
    const exts = Array.isArray(mintParsed?.extensions) ? mintParsed.extensions : [];
    const extState = (name) => { const e = exts.find(x => x && x.extension === name); return e ? (e.state || {}) : null; };
    const sellWarnings = [];
    let honeypotHardDanger = false;
    let transferFeeBps = null;
    if (isToken2022) {
      const pd = extState("permanentDelegate");
      if (pd && pd.delegate && pd.delegate !== SYS_PROG) { sellWarnings.push("Permanent delegate set — an authority can move or burn your tokens at will."); honeypotHardDanger = true; }
      const th = extState("transferHook");
      if (th && th.programId && th.programId !== SYS_PROG) { sellWarnings.push("Transfer hook active — a custom program runs on every transfer and can block sells."); honeypotHardDanger = true; }
      const das = extState("defaultAccountState");
      if (das && das.accountState === "frozen") { sellWarnings.push("Accounts default to FROZEN — new holders can't transfer until the authority thaws them."); honeypotHardDanger = true; }
      const tf = extState("transferFeeConfig");
      if (tf) {
        transferFeeBps = Math.max(Number(tf.newerTransferFee?.transferFeeBasisPoints) || 0, Number(tf.olderTransferFee?.transferFeeBasisPoints) || 0);
        if (transferFeeBps > 0) {
          sellWarnings.push("Transfer fee of " + (transferFeeBps / 100).toFixed(transferFeeBps % 100 ? 2 : 0) + "% taxed on every buy and sell.");
          if (transferFeeBps >= 1000) honeypotHardDanger = true; // ≥10% = honeypot-grade tax
        }
      }
    }

    const largestRaw = largestData.status === "fulfilled" ? (largestData.value?.result?.value || []) : [];

    // Filter top-20 token accounts to ACTUAL HUMAN HOLDERS only.
    // Step 1: each top-20 token account has an owner — that owner is a wallet pubkey.
    // Step 2: fetch each owner's account info — if `owner` of THAT account is the
    //         System Program, it's a regular wallet (human). Otherwise it's a PDA
    //         owned by some program (LP, lock, vesting, AMM authority, etc.).
    // Two extra getMultipleAccounts calls — both batched, both small.
    const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
    let top10HumanShare = null;
    let top10RawShare = null;
    let humanTop10Holdings = [];
    let lpInTop20 = 0;
    if (largestRaw.length && supplyTokens) {
      // Raw share (informational fallback if classification fails)
      const rawSum = largestRaw.slice(0, 10).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0);
      top10RawShare = supplyTokens > 0 ? rawSum / supplyTokens : null;

      try {
        // Get the owner of each token account
        const tokenAccountInfos = await rpcCall("score-tacc-owners", "getMultipleAccounts", [
          largestRaw.map(a => a.address),
          { encoding: "jsonParsed" }
        ]);
        const taccValues = tokenAccountInfos?.result?.value || [];
        const enriched = largestRaw.map((a, i) => ({
          tokenAccount: a.address,
          uiAmount: parseFloat(a.uiAmount) || 0,
          owner: taccValues[i]?.data?.parsed?.info?.owner || null,
        })).filter(e => e.owner);

        // Classify each owner: System-Program-owned = human wallet
        if (enriched.length) {
          const ownerInfos = await rpcCall("score-owner-class", "getMultipleAccounts", [
            enriched.map(e => e.owner),
            { encoding: "base64" }
          ]);
          const ownerValues = ownerInfos?.result?.value || [];
          const humans = [];
          enriched.forEach((e, i) => {
            const ownerAcc = ownerValues[i];
            const isHuman = ownerAcc && ownerAcc.owner === SYSTEM_PROGRAM_ID;
            if (isHuman) humans.push(e);
            else lpInTop20++;
          });
          humanTop10Holdings = humans.slice(0, 10);
          const humanSum = humanTop10Holdings.reduce((s, e) => s + e.uiAmount, 0);
          top10HumanShare = supplyTokens > 0 ? humanSum / supplyTokens : null;
        }
      } catch (e) {
        console.warn("[cluck-score] Owner classification failed, using raw top-10:", e.message);
      }
    }
    // Prefer the classified human-only share. Fall back to raw if classification
    // failed (so we always have a score, even if it's a bit pessimistic).
    const top10Share = top10HumanShare != null ? top10HumanShare : top10RawShare;

    const liqUsd = totalLiqUsd; // sum across all Solana pools
    const fdv = parseFloat(topPair?.fdv || topPair?.marketCap) || (supplyTokens && parseFloat(topPair?.priceUsd) ? supplyTokens * parseFloat(topPair.priceUsd) : null);
    const liqRatio = (fdv && liqUsd) ? liqUsd / fdv : null; // 0..1
    const vol24h = totalVol24h; // sum across all Solana pools
    const dexId = (topPair?.dexId || "").toLowerCase();
    const labels = topPair?.labels || [];
    // DexScreener dexIds:
    //   graduated (real AMM): meteora / raydium / orca / phoenix / openbook / lifinity
    //                         + pumpswap (pump.fun's own AMM — pump.fun grads land here now)
    //   bonding curve:        bags / pumpfun / moonshot / fluxbeam (still on launchpad)
    const graduatedDexIds = ["meteora", "raydium", "orca", "phoenix", "openbook", "lifinity", "pumpswap"];
    const bondingCurveDexIds = ["bags", "pumpfun", "moonshot", "fluxbeam"];
    const isGraduated = !!topPair && (
      graduatedDexIds.some(s => dexId === s || dexId.startsWith(s + "-")) ||
      labels.some(l => /damm|dlmm|clmm|whirlpool|v[23]/i.test(l))
    ) && !bondingCurveDexIds.some(s => dexId.includes(s));

    // Score each factor (0..100)
    const f = {};
    // Holders: anchored to industry signals.
    //   500 holders = score 50 (Jupiter's minimum bar to even apply for verification)
    //   5000 holders = score 100 (real distribution)
    //   <100 = effectively dead
    // Formula: log10(holders) * 50 - 85, clamped to [0, 100].
    f.holders = holderCount == null ? null : Math.max(0, Math.min(100, Math.log10(Math.max(1, holderCount)) * 50 - 85));
    // Liquidity: base score from total liq÷FDV (20% = 100 points). Multi-DEX presence
    // (≥2 protocols) adds a 5-point bonus — but only if base score is already meaningful,
    // so a token with $0 spread across 5 dead pools doesn't get free credit.
    const liqBase = liqRatio == null ? null : Math.min(100, liqRatio * 500);
    const multiDexBonus = (liqBase != null && liqBase >= 20 && dexFamilies.size >= 2) ? 5 : 0;
    f.liquidity = liqBase == null ? null : Math.min(100, liqBase + multiDexBonus);
    f.mintAuthority = mintAuthority === null ? 100 : (mintAuthority === undefined ? null : 0);
    f.freezeAuthority = (freezeAuthority === null) ? 100 : (freezeAuthority === undefined ? null : 0);
    // Concentration: top10Share is the LP/lock/program-FILTERED human share
    // (top10HumanShare) whenever owner classification succeeds — so the "excellent"
    // floor is a true human floor (10%), not the lenient 25% that only made sense
    // when LP/contracts were still counted in the number. If classification fails we
    // fall back to the RAW share (LP included) and keep the 25% floor so a token isn't
    // unfairly penalized for its own pool sitting in the top 10.
    //   human-filtered: 10% → 100, 20% → 80, 30% → 60, 40% → 40, 50% → 20, 60%+ → 0
    //   raw fallback:   25% → 100 … 75%+ → 0
    const concFloor = top10HumanShare != null ? 0.10 : 0.25;
    f.concentration = top10Share == null ? null : Math.max(0, Math.min(100, 100 - Math.max(0, top10Share - concFloor) * 200));
    f.volume = vol24h == null ? null : Math.min(100, Math.log10(Math.max(1, vol24h)) * 25); // ~$10k = 100

    // --- Bags-aware verification factors (new) ---
    // The Cluck Score used to be blind to Bags context: it didn't know a token
    // had a verified team, didn't credit active fee-claim revenue, didn't
    // recognize "buy-and-lock" patterns, and could mis-flag the Bags platform
    // launcher wallet as a "dev with 1956 launches." These factors fix that.
    const bagsCtx = bagsCtxData.status === "fulfilled" ? bagsCtxData.value : { bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] };
    const teamActivity = classifyTeamActivity(bagsCtx.bagsInfo);
    const isBagsToken = !!(bagsCtx.bagsInfo && bagsCtx.bagsInfo.isBagsToken);
    const isJupVerified = !!(bagsCtx.jupiterInfo && bagsCtx.jupiterInfo.listed && Array.isArray(bagsCtx.jupiterInfo.tags) && bagsCtx.jupiterInfo.tags.some(t => t === "verified"));
    const jupOrganic = bagsCtx.jupiterInfo?.organicScoreLabel || null;
    // verifiedTeam (0..100): Bags-verified creator with active fee claims = 100;
    // verified but stale = 60; verified but never claimed = 40; unverified = 0.
    let verifiedTeamScore = null;
    if (isBagsToken && bagsCtx.bagsInfo.officialCreators.length > 0) {
      if (teamActivity === "active") verifiedTeamScore = 100;
      else if (teamActivity === "stale") verifiedTeamScore = 60;
      else if ((bagsCtx.bagsInfo.totalClaimedSol || 0) > 0) verifiedTeamScore = 70;
      else verifiedTeamScore = 40;
    } else if (isJupVerified) {
      verifiedTeamScore = 80;
    }
    f.verifiedTeam = verifiedTeamScore;

    // independentVerification (0..100): cross-checks against Jupiter's audit.
    // A token gets full credit when our reading of mint/freeze auth and
    // top-holder concentration MATCHES Jupiter's independent audit. This
    // catches our own errors and confirms reality.
    let indVerifyScore = null;
    const jupAudit = bagsCtx.jupiterInfo?.audit;
    if (jupAudit) {
      let matches = 0, checked = 0;
      checked++; if (jupAudit.mintAuthorityDisabled === (mintAuthority === null)) matches++;
      checked++; if (jupAudit.freezeAuthorityDisabled === (freezeAuthority === null)) matches++;
      if (top10Share != null && jupAudit.topHoldersPercentage != null) {
        checked++;
        if (Math.abs((top10Share * 100) - jupAudit.topHoldersPercentage) < 10) matches++;
      }
      indVerifyScore = checked > 0 ? (matches / checked) * 100 : null;
    } else if (bagsCtx.jupiterInfo?.listed) {
      // On Jupiter but no audit → small positive signal anyway
      indVerifyScore = 60;
    }
    f.independentVerification = indVerifyScore;

    // Platform-wallet guard: when Jupiter's audit shows the genesis "dev"
    // wallet has done >50 migrations, that's the platform launcher, NOT the
    // project team. Used downstream to soften any other "dev concentration"
    // signal (the concentration factor above is already top-10 humans, but
    // we record the platform-wallet status so the UI can show it).
    const isPlatformLauncherDev = !!(jupAudit && jupAudit.devMigrations != null && jupAudit.devMigrations > 50);
    // Pool type / graduation factor removed — wasn't discriminating well and we can't
    // properly distinguish "on bonding curve" from "LP-only AMM pool" without the
    // full holders classifier. isGraduated info still exposed in the response for
    // reference but doesn't count toward the score.

    // Weighted average (skip null factors, redistribute weight).
    // New (Bags-aware) weights:
    //   holders 18, liquidity 20, mintAuth 12, freezeAuth 8, concentration 18,
    //   volume 8, verifiedTeam 10, independentVerification 6.
    // The verifiedTeam + indVerify factors are NEW and only count when data
    // is present; for non-Bags / non-Jupiter tokens they're null and the
    // remaining factors get full weight as before.
    const weights = {
      holders: 18, liquidity: 20, mintAuthority: 12, freezeAuthority: 8,
      concentration: 18, volume: 8,
      verifiedTeam: 10, independentVerification: 6,
    };
    let totalWeight = 0;
    let weightedSum = 0;
    for (const k of Object.keys(weights)) {
      if (f[k] != null) {
        weightedSum += f[k] * weights[k];
        totalWeight += weights[k];
      }
    }
    let score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
    // Hard-danger Token-2022 extensions (sell-block / seize / honeypot-tax) cap the
    // score — no amount of liquidity or holders makes a token you can't safely sell
    // a healthy one.
    if (honeypotHardDanger && score != null) score = Math.min(score, 35);
    // Confidence: flag a score built from sparse data (missing the two biggest
    // factors — liquidity 20 + holders 18 — drops totalWeight below 40), so the
    // UI can label it rather than present a thin read as authoritative.
    const factorsUsed = Object.keys(weights).filter(k => f[k] != null).length;
    const lowConfidence = totalWeight < 40;

    // Standard academic grading scale — what every reader expects.
    //   95+ → A+   90+ → A   80+ → B   70+ → C   60+ → D   <60 → F
    const grade = score == null ? "—"
      : score >= 95 ? "A+"
      : score >= 90 ? "A"
      : score >= 80 ? "B"
      : score >= 70 ? "C"
      : score >= 60 ? "D"
      : "F";

    let verdict = score == null
      ? "Couldn't pull enough data to score this one. Cluck shrugs."
      : score >= 90 ? "Cluck Norris approves. Distribution, liquidity, authorities — all check out. No red flags."
      : score >= 80 ? "Healthy bird. Solid reads across the board. Normal caution applies."
      : score >= 70 ? "Decent. Worth a deeper look at the weaker factors before sizing up."
      : score >= 60 ? "Watch the eggs. A couple yellow flags here — research before getting big."
      : score >= 45 ? "Cluck raises an eyebrow. Real concerns in the breakdown below — tread carefully."
      : "Don't bring this back to the schoolyard. Multiple red flags. Cluck's not impressed.";
    if (honeypotHardDanger) verdict = "Dangerous token mechanics detected — it can block sells, seize tokens, or tax every transfer. Cluck says stay away, no matter how the rest looks.";

    return res.status(200).json({
      success: true,
      mint,
      ticker: topPair?.baseToken?.symbol || null,
      name: topPair?.baseToken?.name || null,
      score,
      grade,
      verdict,
      dataConfidence: lowConfidence ? "low" : "ok",
      factorsUsed,
      warnings: sellWarnings,
      token2022: isToken2022,
      transferFeeBps,
      factors: {
        holders:          { score: f.holders          == null ? null : Math.round(f.holders),          weight: weights.holders,          value: holderCount, capped: holderCountCapped },
        liquidity:        { score: f.liquidity        == null ? null : Math.round(f.liquidity),        weight: weights.liquidity,        value: liqUsd, ratio: liqRatio, poolCount, dexCount: dexFamilies.size, dexes: [...dexFamilies], multiDexBonus },
        mintAuthority:    { score: f.mintAuthority,    weight: weights.mintAuthority,    revoked: mintAuthority === null },
        freezeAuthority:  { score: f.freezeAuthority,  weight: weights.freezeAuthority,  revoked: freezeAuthority === null },
        concentration:    { score: f.concentration    == null ? null : Math.round(f.concentration),    weight: weights.concentration,    top10Share: top10Share, top10RawShare, top10HumanShare, humanFiltered: top10HumanShare != null, lpFilteredFromTop20: lpInTop20, isPlatformLauncherDev },
        volume:           { score: f.volume           == null ? null : Math.round(f.volume),           weight: weights.volume,           value: vol24h },
        verifiedTeam: {
          score: f.verifiedTeam == null ? null : Math.round(f.verifiedTeam),
          weight: weights.verifiedTeam,
          isBagsToken,
          isJupVerified,
          teamActivity,
          officialCreators: bagsCtx.bagsInfo?.officialCreators?.map(c => ({
            wallet: c.wallet,
            username: c.username,
            provider: c.provider,
            isAdmin: c.isAdmin,
            royaltyBps: c.royaltyBps,
          })) || [],
          totalClaimedSol: bagsCtx.bagsInfo?.totalClaimedSol || null,
          claimEventCount: bagsCtx.bagsInfo?.claimEventCount || 0,
          daysSinceLastClaim: bagsCtx.bagsInfo?.lastClaimTimestamp
            ? Math.round((Date.now() - bagsCtx.bagsInfo.lastClaimTimestamp) / 86400000)
            : null,
        },
        independentVerification: {
          score: f.independentVerification == null ? null : Math.round(f.independentVerification),
          weight: weights.independentVerification,
          jupiterListed: !!bagsCtx.jupiterInfo?.listed,
          jupiterTags: bagsCtx.jupiterInfo?.tags || [],
          jupiterHolderCount: bagsCtx.jupiterInfo?.holderCount || null,
          jupiterOrganicScore: jupOrganic,
          jupiterAudit: jupAudit ? {
            mintAuthorityDisabled: jupAudit.mintAuthorityDisabled,
            freezeAuthorityDisabled: jupAudit.freezeAuthorityDisabled,
            topHoldersPercentage: jupAudit.topHoldersPercentage,
            devMigrations: jupAudit.devMigrations,
          } : null,
        },
        // graduation/pool-type removed from scoring; isGraduated still exposed as a hint
        // for the UI to display informationally if it wants.
      },
      raw: {
        priceUsd: topPair?.priceUsd ? parseFloat(topPair.priceUsd) : null,
        fdv,
        liquidityUsd: liqUsd,
        volume24h: vol24h,
        circulatingSupply: supplyTokens,
        pairAddress: topPair?.pairAddress || null,
        source: scoreSource,
        onBondingCurve,
        curvePctToGrad: curvePctToGrad != null ? Number(curvePctToGrad.toFixed(1)) : null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Cluck Score error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- ed25519 curve check — the deterministic human-vs-contract signal --
// Real Solana wallets are ed25519 keypairs whose public key lies ON the curve.
// Program-derived addresses (AMM pool authorities, lock/vesting escrows, program
// PDAs) are generated specifically to land OFF the curve so no private key can
// exist for them. So "on curve" == a real wallet someone controls; "off curve"
// == a contract. This needs no RPC call and has none of the ambiguity of
// checking account owners or balances (a real wallet with 0 SOL returns null).
const _B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str) {
  // Leading '1' chars each encode one leading zero byte — count them separately
  // so a key with leading zero bytes decodes to the correct length.
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = []; // little-endian numeric accumulator
  for (let i = zeros; i < str.length; i++) {
    const c = _B58_ALPHABET.indexOf(str[i]);
    if (c < 0) return null;
    let carry = c;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}
const _ED_P = (1n << 255n) - 19n;
const _ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
function _edPowMod(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}
function isOnCurveBytes(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  // Compressed point: the 32 bytes are y little-endian, top bit is x's sign.
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  if (y >= _ED_P) return false;
  const y2 = (y * y) % _ED_P;
  // x² = (y² - 1) / (d·y² + 1) mod p
  const num = (y2 - 1n + _ED_P) % _ED_P;
  const den = (_ED_D * y2 + 1n) % _ED_P;
  const x2 = (num * _edPowMod(den, _ED_P - 2n, _ED_P)) % _ED_P;
  if (x2 === 0n) return true;
  // On curve iff x² is a quadratic residue mod p (Euler's criterion)
  return _edPowMod(x2, (_ED_P - 1n) / 2n, _ED_P) === 1n;
}
function isOnCurve(pubkeyBase58) {
  return isOnCurveBytes(base58Decode(pubkeyBase58));
}

// Base58 encoder + associated-token-account (ATA) derivation. Used by /api/trace
// to find a wallet's token account for a mint — including a CLOSED one — so the
// full transaction history can be pulled from getSignaturesForAddress.
function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) str += _B58_ALPHABET[digits[i]];
  return str;
}
const _TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const _ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const _PDA_MARKER = Buffer.from("ProgramDerivedAddress", "utf8");
function deriveAta(wallet, mint, tokenProgram = _TOKEN_PROGRAM_ID) {
  const w = base58Decode(wallet), t = base58Decode(tokenProgram), m = base58Decode(mint);
  if (!w || !t || !m) return null;
  const seeds = [Buffer.from(w), Buffer.from(t), Buffer.from(m)];
  const progId = Buffer.from(base58Decode(_ATA_PROGRAM_ID));
  // find_program_address: highest bump whose hash lands off-curve is the PDA
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump]));
    h.update(progId);
    h.update(_PDA_MARKER);
    const digest = h.digest();
    if (!isOnCurveBytes(digest)) return base58Encode(digest);
  }
  return null;
}

// Known Solana program IDs, used to sub-classify off-curve (contract) holders
// so the snapshot UI can tell users WHAT each excluded address is. Best-effort —
// anything not matched falls back to a generic "contract" label.
const DEX_PROGRAMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",  // Orca Whirlpool
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",  // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora Pools (DAMM v1)
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",  // Meteora DAMM v2
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",  // Meteora DBC (Bags bonding curve)
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",  // PumpSwap (pump.fun AMM)
]);
const LOCKER_PROGRAMS = new Set([
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", // Streamflow
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn", // Jupiter Lock
]);
// SPL Token + Token-2022. A *holder* address owned by one of these programs is
// itself a token account — which only happens when that account is self-owned
// (its authority = its own address): an immovable, permanent lock.
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
]);
// Program ID → human label, used by /api/trace to name contract counterparties.
const PROGRAM_LABELS = {
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": "Raydium CPMM",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc":  "Orca",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo":  "Meteora DLMM",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB": "Meteora",
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG":  "Meteora DAMM v2",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN":  "Meteora DBC",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA":  "PumpSwap",
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m":  "Streamflow Lock",
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn":  "Jupiter Lock",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4":  "Jupiter",
  "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK": "Bags Fee Shares", // creator fee-claim program
};
// Known SERVICE wallets (on-curve, so not caught by the PDA classifier) that are
// platform infrastructure, NOT people. Labeling them keeps the forensic tools
// honest — e.g. the Bags fee relayer fronts a 1-SOL float on every creator fee
// claim (paid back in the same tx); naive tools mis-read that as a cash-out.
const KNOWN_SERVICE_WALLETS = {
  "BGASPyexYFLvAUEJVGcfvh9bymeCB1Xh34dLTRv5CKyL": "Bags fee relayer",
  "BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv": "Bags platform launcher",
};

// Known CEX hot/custodial wallets on Solana. A token held in one of these among
// its top holders is exchange-CUSTODIED (many users' tokens) — NOT single-entity
// whale concentration — and a token an exchange actually lists/supports is a
// strong legitimacy signal (it cleared the exchange's due diligence and carries
// off-chain order-book liquidity our on-chain view can't see). Module-level so
// both the free autopsy concentration calc and the premium acquisition trace use it.
const KNOWN_CEX_WALLETS = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Coinbase",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": "Kraken",
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": "OKX",
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": "Bybit",
};

// Classify a batch of addresses the SAME way the free autopsy / holders view
// does, so the premium deep-trace shares that context instead of presenting raw
// transfers. on-curve = a real wallet (a person); off-curve PDA = LP pool /
// token lock / program account. Without this, LP locks & pools get mislabeled as
// a suspicious "funnel" or "cash-out". Returns Map: addr → { category, label }.
// category ∈ {wallet, lp, locker, contract}. rpcCall is the caller's Helius RPC.
async function classifyAddressTypes(addresses, rpcCall) {
  const out = new Map();
  const list = [...new Set((addresses || []).filter(Boolean))];
  const pdas = [];
  for (const a of list) {
    if (KNOWN_SERVICE_WALLETS[a]) { out.set(a, { category: "service", label: KNOWN_SERVICE_WALLETS[a] }); continue; } // platform infra, not a person
    let onCurve = false;
    try { onCurve = PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch (_) {}
    if (onCurve) out.set(a, { category: "wallet", label: "Wallet" });  // a person
    else pdas.push(a);                                                  // a PDA — read its owner
  }
  for (let i = 0; i < pdas.length; i += 100) {
    const batch = pdas.slice(i, i + 100);
    let values = [];
    try {
      const info = await rpcCall(`premium-classify-${i}`, "getMultipleAccounts", [batch, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      values = (info && info.result && info.result.value) || [];
    } catch (_) { values = []; }
    batch.forEach((a, j) => {
      const acc = values[j];
      // off-curve + null/System-owned = an AMM pool authority PDA
      if (!acc || acc.owner === "11111111111111111111111111111111") { out.set(a, { category: "lp", label: "Liquidity pool" }); return; }
      const prog = acc.owner;
      if (DEX_PROGRAMS.has(prog)) out.set(a, { category: "lp", label: PROGRAM_LABELS[prog] || "Liquidity pool" });
      else if (LOCKER_PROGRAMS.has(prog)) out.set(a, { category: "locker", label: PROGRAM_LABELS[prog] || "Token lock" });
      else if (TOKEN_PROGRAMS.has(prog)) out.set(a, { category: "locker", label: "Self-owned lock" });
      else out.set(a, { category: "contract", label: PROGRAM_LABELS[prog] || "Program account" });
    });
  }
  for (const a of list) if (!out.has(a)) out.set(a, { category: "wallet", label: "Wallet" });
  return out;
}

// -- Snapshot — token-agnostic, free, no wallet connect --
// Walks every token account for a mint, deduplicates by owner (one wallet can
// hold multiple ATAs), classifies every owner as human-vs-contract by ed25519
// curve position, and returns a clean filtered list ready to feed into the
// airdropper. Education-first UI lives at /snapshot.
app.get("/api/snapshot", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store"); // snapshots are point-in-time, never cached

  const mint = (req.query.mint || "").trim();
  const excludeNonHuman = req.query.excludeNonHuman !== "0"; // default ON — that's the airdrop-safe default
  const excludeBagsTeam = req.query.excludeBagsTeam !== "0"; // default ON — team shouldn't airdrop to itself
  const minBalance = Math.max(0, parseFloat(req.query.minBalance) || 0);

  if (!SOL_ADDR_RE.test(mint)) {
    return res.status(400).json({ success: false, error: "Invalid mint address" });
  }
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) {
    return res.status(500).json({ success: false, error: "Server not configured" });
  }
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  function rpcCall(id, method, params) {
    return fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    }).then(r => r.json());
  }

  try {
    // Supply + decimals first — we need decimals to convert raw amounts.
    // Bags context fetched in parallel so the team-exclusion filter doesn't
    // serialize against the supply lookup.
    const [supplyData, bagsCtx] = await Promise.all([
      rpcCall("snap-supply", "getTokenSupply", [mint]),
      fetchBagsContext(mint).catch(() => ({ bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] })),
    ]);
    const decimals = supplyData?.result?.value?.decimals;
    if (decimals == null) {
      return res.status(404).json({ success: false, error: "Mint not found on Solana" });
    }
    const totalSupply = parseInt(supplyData.result.value.amount || "0") / Math.pow(10, decimals);

    // Walk all token accounts. Cap at 50 pages = 50k owner-positions to keep
    // response time + Helius quota bounded. Anything bigger should run as a job.
    const MAX_PAGES = 50;
    const ownerBalances = new Map();
    let pagesFetched = 0;
    let truncated = false;
    let tokenAccountCount = 0;
    const tokenAccountAddrs = new Set();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const d = await rpcCall(`snap-page-${page}`, "getTokenAccounts", {
        page, limit: 1000, mint, displayOptions: { showZeroBalance: false }
      });
      const accounts = d?.result?.token_accounts || [];
      pagesFetched = page;
      if (!accounts.length) break;
      for (const a of accounts) {
        const amount = parseInt(a.amount);
        if (!(amount > 0)) continue;
        tokenAccountCount++;
        if (a.address) tokenAccountAddrs.add(a.address);
        const tokens = amount / Math.pow(10, decimals);
        ownerBalances.set(a.owner, (ownerBalances.get(a.owner) || 0) + tokens);
      }
      if (accounts.length < 1000) break;
      if (page === MAX_PAGES) truncated = true;
    }

    let holders = [...ownerBalances.entries()]
      .map(([wallet, balance]) => ({ wallet, balance }))
      .sort((a, b) => b.balance - a.balance);
    const rawHolderCount = holders.length;

    // Classify every owner as human (real keypair wallet) vs contract (LP pool,
    // lock/vesting escrow, program PDA) by ed25519 curve position. Deterministic,
    // no RPC, and correct regardless of whether the wallet holds any SOL.
    holders.forEach(h => { h.type = isOnCurve(h.wallet) ? "human" : "contract"; });
    // A holder address that is itself a token account of this mint can only be a
    // self-owned token account (authority = its own address) — a permanent lock.
    // Force it out of the "human" bucket even if the address sits on the curve.
    holders.forEach(h => { if (tokenAccountAddrs.has(h.wallet)) h.type = "contract"; });

    // Filter — humans, balance, and (optionally) Bags-verified team wallets.
    // The team-exclusion is opt-out by default: a team shouldn't airdrop to
    // their own creator-fee wallet. We attach a `bagsTeam` marker to each
    // holder regardless of whether they're being filtered, so the UI can
    // show them as excluded with a clear reason.
    const bagsTeamSet = new Set((bagsCtx?.projectFeeWallets || []));
    holders.forEach(h => { if (bagsTeamSet.has(h.wallet)) h.bagsTeam = true; });
    let filtered = holders;
    if (excludeNonHuman) filtered = filtered.filter(h => h.type === "human");
    if (excludeBagsTeam) filtered = filtered.filter(h => !h.bagsTeam);
    if (minBalance > 0) filtered = filtered.filter(h => h.balance >= minBalance);

    // Stats over filtered set
    const balances = filtered.map(h => h.balance);
    const totalHeldFiltered = balances.reduce((s, b) => s + b, 0);
    const median = (() => {
      if (!balances.length) return 0;
      const sorted = [...balances].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    })();
    const mean = balances.length ? totalHeldFiltered / balances.length : 0;
    const sumTopN = (n) => filtered.slice(0, n).reduce((s, h) => s + h.balance, 0);

    const excluded = holders.filter(h => h.type !== "human");
    const excludedTotal = excluded.reduce((s, h) => s + h.balance, 0);

    // Sub-classify each excluded (off-curve) address so the UI can show users
    // WHAT it is: a liquidity pool, a token locker, or another program account.
    // We read the program that owns each address. A null account (no data at
    // all) is the signature of a pure AMM pool-authority PDA → liquidity pool.
    // Capped at 200 lookups; anything beyond is labelled generically.
    const CATEGORIZE_CAP = 200;
    const toCategorize = excluded.slice(0, CATEGORIZE_CAP);
    for (let i = 0; i < toCategorize.length; i += 100) {
      const batch = toCategorize.slice(i, i + 100);
      let values = [];
      try {
        const info = await rpcCall(`snap-cat-${i}`, "getMultipleAccounts", [
          batch.map(h => h.wallet),
          { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
        ]);
        values = info?.result?.value || [];
      } catch { values = []; }
      batch.forEach((h, j) => {
        const acc = values[j];
        // No account at all, OR a System-Program account (which by definition holds
        // no data): both are off-curve authority PDAs — i.e. an AMM pool authority.
        if (!acc || acc.owner === "11111111111111111111111111111111") {
          h.category = "lp"; h.label = "Liquidity pool"; return;
        }
        const prog = acc.owner;
        if (DEX_PROGRAMS.has(prog)) { h.category = "lp"; h.label = PROGRAM_LABELS[prog] || "Liquidity pool"; }
        else if (LOCKER_PROGRAMS.has(prog)) { h.category = "locker"; h.label = PROGRAM_LABELS[prog] || "Token lock"; }
        else if (TOKEN_PROGRAMS.has(prog)) { h.category = "locker"; h.label = "Self-owned lock"; }
        else { h.category = "contract"; h.label = PROGRAM_LABELS[prog] || "Program account"; }
      });
    }
    excluded.forEach(h => { if (!h.category) { h.category = "contract"; h.label = "Program account"; } });
    const excludedBreakdown = { lp: 0, locker: 0, contract: 0 };
    excluded.forEach(h => { excludedBreakdown[h.category] = (excludedBreakdown[h.category] || 0) + 1; });

    // Dust = under 0.00001% of total supply (effectively round-error positions)
    const dustThreshold = totalSupply * 0.0000001;
    const dustCount = filtered.filter(h => h.balance < dustThreshold).length;

    return res.status(200).json({
      success: true,
      mint,
      decimals,
      totalSupply,
      generatedAt: new Date().toISOString(),
      truncated,
      pagesFetched,
      filters: { excludeNonHuman, excludeBagsTeam, minBalance },
      bagsTeam: bagsCtx?.bagsInfo ? {
        isBagsToken: !!bagsCtx.bagsInfo.isBagsToken,
        creators: (bagsCtx.bagsInfo.officialCreators || []).map(c => ({
          wallet: c.wallet,
          username: c.username,
          provider: c.provider,
          isAdmin: c.isAdmin,
        })),
        excludedFromSnapshot: holders.filter(h => h.bagsTeam).map(h => ({
          wallet: h.wallet,
          balance: h.balance,
          pct: totalSupply ? h.balance / totalSupply : null,
        })),
      } : null,
      stats: {
        rawHolderCount,
        tokenAccountCount,
        humanHolderCount: holders.filter(h => h.type === "human").length,
        contractHolderCount: excluded.length,
        filteredCount: filtered.length,
        totalHeldFiltered,
        totalHeldFilteredPct: totalSupply ? totalHeldFiltered / totalSupply : null,
        excludedTotal,
        excludedPct: totalSupply ? excludedTotal / totalSupply : null,
        excludedBreakdown,
        median,
        mean,
        dustCount,
        dustThreshold,
        top10Share: totalSupply ? sumTopN(10)  / totalSupply : null,
        top50Share: totalSupply ? sumTopN(50)  / totalSupply : null,
        top100Share: totalSupply ? sumTopN(100) / totalSupply : null,
      },
      excludedTop: excluded.slice(0, 10).map(h => ({
        wallet: h.wallet, balance: h.balance, category: h.category,
        pct: totalSupply ? h.balance / totalSupply : null
      })),
      holders: filtered,
    });
  } catch (err) {
    console.error("[snapshot] error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Trace — wallet × token transaction history (forensic) --
// Given a wallet and a token mint, returns every transaction where the two
// interacted, in chronological order, with running balance and counterparties.
// Built so a project lead can investigate "this wallet looks suspicious — show
// me everything it did with our contract" without an hour of Solscan digging.
app.get("/api/trace", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const wallet = (req.query.wallet || "").trim();
  const mint = (req.query.mint || "").trim();
  if (!SOL_ADDR_RE.test(wallet) || !SOL_ADDR_RE.test(mint)) {
    return res.status(400).json({ success: false, error: "Provide a valid wallet and token mint address" });
  }
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Server not configured" });
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  function rpcCall(id, method, params) {
    return fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    }).then(r => r.json());
  }

  try {
    // 1. Resolve the wallet's token account(s) for this mint. getTokenAccountsByOwner
    //    covers currently-open accounts; the derived ATA also covers a CLOSED
    //    account so a wallet that fully exited still shows its full history.
    // Kick off Bags context fetch in parallel — we need to know if the
    // traced wallet is a verified Bags creator and what the lock-PDA set
    // looks like for this mint, so the trace UI can show "this is the
    // verified team wallet" or "this send went to a lock contract".
    const bagsCtxPromise = fetchBagsContext(mint).catch(() => ({ bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] }));

    const tokenAccounts = new Set();
    let currentBalance = 0;
    let decimals = null;
    try {
      const owned = await rpcCall("trace-owned", "getTokenAccountsByOwner", [
        wallet, { mint }, { encoding: "jsonParsed" }
      ]);
      for (const a of owned?.result?.value || []) {
        if (a.pubkey) tokenAccounts.add(a.pubkey);
        const info = a.account?.data?.parsed?.info;
        if (info?.tokenAmount) {
          currentBalance += info.tokenAmount.uiAmount || 0;
          if (decimals == null) decimals = info.tokenAmount.decimals;
        }
      }
    } catch {}
    const ata = deriveAta(wallet, mint);
    if (ata) tokenAccounts.add(ata);
    if (decimals == null) {
      try {
        const sup = await rpcCall("trace-supply", "getTokenSupply", [mint]);
        decimals = sup?.result?.value?.decimals ?? null;
      } catch {}
    }

    if (!tokenAccounts.size) {
      return res.status(200).json({
        success: true, wallet, mint, transactions: [], summary: null,
        error: "Could not resolve a token account for this wallet and mint"
      });
    }

    // 2. Collect every signature that touched those token accounts (full history).
    const MAX_SIGS = 5000;
    const sigTimes = new Map();
    for (const acc of tokenAccounts) {
      let before;
      while (sigTimes.size < MAX_SIGS) {
        const opts = before ? { limit: 1000, before } : { limit: 1000 };
        const r = await rpcCall("trace-sigs", "getSignaturesForAddress", [acc, opts]);
        const sigs = r?.result || [];
        if (!sigs.length) break;
        for (const s of sigs) if (!s.err) sigTimes.set(s.signature, s.blockTime || 0);
        if (sigs.length < 1000) break;
        before = sigs[sigs.length - 1].signature;
      }
    }
    const truncated = sigTimes.size >= MAX_SIGS;
    const allSigs = [...sigTimes.keys()];
    if (!allSigs.length) {
      return res.status(200).json({
        success: true, wallet, mint, decimals, truncated: false,
        transactions: [], summary: { txCount: 0, currentBalance }
      });
    }

    // 3. Enhanced-parse every signature in batches of 100.
    const parsed = [];
    for (let i = 0; i < allSigs.length; i += 100) {
      const batch = allSigs.slice(i, i + 100);
      try {
        const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: batch })
        });
        const txns = await r.json();
        if (Array.isArray(txns)) parsed.push(...txns);
      } catch {}
    }

    // 4. One row per transaction that actually moved the mint for this wallet.
    const rows = [];
    for (const tx of parsed) {
      if (!tx || !tx.signature) continue;
      const transfers = tx.tokenTransfers || [];
      const native = tx.nativeTransfers || [];

      let tokenDelta = 0, counterIn = null, counterOut = null;
      for (const t of transfers) {
        if (t.mint !== mint) continue;
        const amt = parseFloat(t.tokenAmount) || 0;
        if (t.toUserAccount === wallet)   { tokenDelta += amt; counterIn  = t.fromUserAccount || counterIn; }
        if (t.fromUserAccount === wallet) { tokenDelta -= amt; counterOut = t.toUserAccount   || counterOut; }
      }
      if (Math.abs(tokenDelta) < 1e-12) continue; // ATA open/close, approvals — no movement

      // The wallet's quote-token leg (SOL / USDC / USDT) — what it cost or earned.
      const quoteSums = {};
      for (const t of transfers) {
        if (!QUOTE_TOKENS[t.mint]) continue;
        const amt = parseFloat(t.tokenAmount) || 0;
        if (t.toUserAccount === wallet)   quoteSums[t.mint] = (quoteSums[t.mint] || 0) + amt;
        if (t.fromUserAccount === wallet) quoteSums[t.mint] = (quoteSums[t.mint] || 0) - amt;
      }
      let nativeDelta = 0;
      for (const n of native) {
        const lam = Number(n.amount) || 0;
        if (n.toUserAccount === wallet)   nativeDelta += lam;
        if (n.fromUserAccount === wallet) nativeDelta -= lam;
      }
      if (Math.abs(nativeDelta) > 0)
        quoteSums[WSOL_MINT] = (quoteSums[WSOL_MINT] || 0) + nativeDelta / 1e9;
      let quoteMint = null, quoteDelta = 0;
      for (const [m, v] of Object.entries(quoteSums)) {
        if (Math.abs(v) > Math.abs(quoteDelta)) { quoteDelta = v; quoteMint = m; }
      }

      const counterparty = (tokenDelta > 0 ? counterIn : counterOut) || null;
      const counterpartyType = counterparty ? (isOnCurve(counterparty) ? "wallet" : "contract") : null;

      // Classify. A swap moves the token and the quote leg in OPPOSITE
      // directions (token in / quote out = buy). Adding or removing liquidity
      // moves them the SAME direction — both leave the wallet into a pool (add)
      // or both return from it (withdraw). The same-direction case is only
      // treated as liquidity when the counterparty is a contract or Helius
      // tagged the tx as a liquidity/pool action — otherwise it's a plain
      // multi-asset transfer.
      const hasQuote = quoteMint != null && Math.abs(quoteDelta) > 1e-12;
      const cpContract = counterpartyType === "contract";
      const liqHint = /LIQUIDIT|POOL/i.test(tx.type || "");
      let action;
      if (hasQuote && tokenDelta > 0 && quoteDelta < 0)      action = "buy";
      else if (hasQuote && tokenDelta < 0 && quoteDelta > 0) action = "sell";
      else if (hasQuote && tokenDelta < 0 && quoteDelta < 0) action = (cpContract || liqHint) ? "add_lp" : "send";
      else if (hasQuote && tokenDelta > 0 && quoteDelta > 0) action = (cpContract || liqHint) ? "withdraw_lp" : "receive";
      else if (liqHint)                                      action = tokenDelta > 0 ? "withdraw_lp" : "add_lp";
      else                                                   action = tokenDelta > 0 ? "receive" : "send";

      // Lock detection: a send to a known-locker counterparty is a lock
      // deposit, not just a plain transfer. Helius tags locker-program txs
      // via type/source (Streamflow, Jupiter Lock, etc.); we also re-classify
      // when counterparty's program-owner is in LOCKER_PROGRAMS (computed
      // below in the batch lookup).
      const helLockHint = /LOCK|STREAM|VEST|TIMELOCK/i.test(tx.type || "") || /streamflow|jupiter-?lock|lock/i.test(tx.source || "");
      if (action === "send" && (helLockHint || cpContract)) {
        // Provisional — final reclass after counterparty owner lookup below.
        action = helLockHint ? "lock" : "send";
      }
      if (action === "receive" && /LOCK|STREAM|VEST|TIMELOCK/i.test(tx.type || "")) {
        action = "unlock";
      }

      rows.push({
        signature: tx.signature,
        timestamp: tx.timestamp || sigTimes.get(tx.signature) || 0,
        action,
        tokenDelta,
        quoteDelta: quoteMint ? quoteDelta : null,
        quoteSymbol: quoteMint ? QUOTE_TOKENS[quoteMint].symbol : null,
        counterparty,
        counterpartyType,
        source: tx.source || null,
      });
    }

    rows.sort((a, b) => a.timestamp - b.timestamp || (a.signature < b.signature ? -1 : 1));

    // Running balance — anchor the newest row to the live balance, walk backward.
    // This keeps recent balances exact even if the oldest history was truncated.
    let bal = currentBalance;
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].balanceAfter = bal;
      bal -= rows[i].tokenDelta;
    }

    // Label contract counterparties: DEX/router rows take the Helius source;
    // anything else is looked up by the program that owns the address.
    const needLookup = new Set();
    for (const r of rows) {
      r.counterpartyLabel = null;
      if (r.counterpartyType !== "contract") continue;
      const src = prettySource(r.source);
      if (src) r.counterpartyLabel = src;
      else if (r.counterparty) needLookup.add(r.counterparty);
    }
    if (needLookup.size) {
      const addrs = [...needLookup].slice(0, 200);
      const labelByAddr = new Map();
      const lockerByAddr = new Set(); // counterparties whose program owner is a known locker
      for (let i = 0; i < addrs.length; i += 100) {
        const batch = addrs.slice(i, i + 100);
        try {
          const info = await rpcCall(`trace-cplabel-${i}`, "getMultipleAccounts", [
            batch, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
          ]);
          const vals = info?.result?.value || [];
          batch.forEach((a, j) => {
            const acc = vals[j];
            if (!acc) return;
            if (PROGRAM_LABELS[acc.owner]) labelByAddr.set(a, PROGRAM_LABELS[acc.owner]);
            if (LOCKER_PROGRAMS.has(acc.owner) || TOKEN_PROGRAMS.has(acc.owner)) {
              lockerByAddr.add(a);
            }
          });
        } catch {}
      }
      // Final classification pass — promote sends-to-lockers to "lock",
      // receives-from-lockers to "unlock". This is the authoritative source
      // for the lock signal, not the earlier heuristic.
      for (const r of rows) {
        if (r.counterpartyType === "contract" && !r.counterpartyLabel) {
          r.counterpartyLabel = labelByAddr.get(r.counterparty) || "Contract";
        }
        if (r.counterparty && lockerByAddr.has(r.counterparty)) {
          if (r.action === "send" || r.action === "add_lp") r.action = "lock";
          else if (r.action === "receive" || r.action === "withdraw_lp") r.action = "unlock";
          r.isLockerCounterparty = true;
        }
      }
    }

    // Aggregate token flow per "flow node" — the backbone of the graph and the
    // counterparties panel. Swaps are collapsed to their DEX venue: a sell
    // routes through ephemeral pool/route accounts that differ every time, so
    // keying by raw address fragments 30 sells into 30 meaningless nodes.
    // Keying by venue gives one honest "Jupiter" / "Raydium" market node.
    // Transfers and LP keep their real wallet/contract address.
    const nodeMap = new Map();
    for (const r of rows) {
      let key, type, label, address;
      if (r.action === "buy" || r.action === "sell") {
        const src = prettySource(r.source) || "DEX / Market";
        key = "dex:" + src; type = "market"; label = src; address = null;
      } else {
        if (!r.counterparty) continue;
        key = r.counterparty;
        type = r.counterpartyType === "contract" ? "contract" : "wallet";
        // Surface known CEX deposit wallets by name — a wallet cashing out to an
        // exchange is a key forensic signal, not just another anonymous address.
        label = r.counterpartyLabel || KNOWN_CEX_WALLETS[r.counterparty] || null;
        address = r.counterparty;
      }
      let e = nodeMap.get(key);
      if (!e) { e = { type, label, address, inflow: 0, outflow: 0, txCount: 0, sigs: [] }; nodeMap.set(key, e); }
      if (r.tokenDelta > 0) e.inflow += r.tokenDelta;
      else e.outflow += -r.tokenDelta;
      e.txCount++;
      if (e.sigs.length < 25) e.sigs.push(r.signature);
      if (!e.label && label) e.label = label;
    }
    const counterparties = [...nodeMap.values()]
      .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
      .slice(0, 60);

    const absSum = (arr) => arr.reduce((s, r) => s + Math.abs(r.tokenDelta), 0);
    const absQ   = (arr) => arr.reduce((s, r) => s + Math.abs(r.quoteDelta || 0), 0);
    const buys  = rows.filter(r => r.action === "buy");
    const sells = rows.filter(r => r.action === "sell");
    const recv  = rows.filter(r => r.action === "receive");
    const sent  = rows.filter(r => r.action === "send");
    const addLp = rows.filter(r => r.action === "add_lp");
    const wdLp  = rows.filter(r => r.action === "withdraw_lp");
    const firstInflow = rows.find(r => r.tokenDelta > 0);

    // Unique pools this wallet provided liquidity to — for "check the pool" links.
    const lpPoolMap = new Map();
    for (const r of [...addLp, ...wdLp]) {
      if (r.counterparty && !lpPoolMap.has(r.counterparty)) {
        lpPoolMap.set(r.counterparty, { address: r.counterparty, label: r.counterpartyLabel || "Liquidity Pool" });
      }
    }

    const summary = {
      txCount: rows.length,
      currentBalance,
      buyCount: buys.length, sellCount: sells.length,
      receiveCount: recv.length, sendCount: sent.length,
      sentToCount: new Set(sent.map(r => r.counterparty).filter(Boolean)).size,
      receivedFromCount: new Set(recv.map(r => r.counterparty).filter(Boolean)).size,
      addLpCount: addLp.length, withdrawLpCount: wdLp.length,
      totalBought: absSum(buys), totalSpent: absQ(buys),
      totalSold: absSum(sells), totalProceeds: absQ(sells),
      totalReceived: absSum(recv), totalSent: absSum(sent),
      totalAddedLp: absSum(addLp), totalWithdrawnLp: absSum(wdLp),
      // SOL legs of the LP actions, and the net still parked in the pool.
      // This is cost basis (what the wallet net-deposited) — the live token/SOL
      // split inside the pool drifts as others trade against it.
      lpSolIn: absQ(addLp), lpSolOut: absQ(wdLp),
      netInLpToken: absSum(addLp) - absSum(wdLp),
      netInLpSol: absQ(addLp) - absQ(wdLp),
      lpPools: [...lpPoolMap.values()],
      uniqueCounterparties: nodeMap.size,
      firstInteraction: rows.length ? rows[0].timestamp : null,
      lastInteraction: rows.length ? rows[rows.length - 1].timestamp : null,
      origin: firstInflow ? {
        action: firstInflow.action,
        counterparty: firstInflow.counterparty,
        counterpartyType: firstInflow.counterpartyType,
        counterpartyLabel: firstInflow.counterpartyLabel,
        source: firstInflow.source,
        timestamp: firstInflow.timestamp,
        amount: firstInflow.tokenDelta,
      } : null,
    };

    // Resolve bags context now — by this point all the heavy on-chain work
    // is done, so even if Bags is slow we only wait on it at the end.
    const bagsCtx = await bagsCtxPromise;
    const walletIsBagsCreator = !!(bagsCtx?.projectFeeWallets && bagsCtx.projectFeeWallets.includes(wallet));
    let walletCreatorMeta = null;
    if (walletIsBagsCreator && bagsCtx.bagsInfo) {
      const match = (bagsCtx.bagsInfo.officialCreators || []).find(c => c.wallet === wallet);
      if (match) walletCreatorMeta = {
        username: match.username,
        provider: match.provider,
        isAdmin: match.isAdmin,
        royaltyBps: match.royaltyBps,
      };
    }

    // Add lock/unlock counts to summary so the UI doesn't need to recompute.
    summary.lockCount = rows.filter(r => r.action === "lock").length;
    summary.unlockCount = rows.filter(r => r.action === "unlock").length;
    summary.lockedTokensTotal = rows.filter(r => r.action === "lock").reduce((s, r) => s + Math.abs(r.tokenDelta), 0);

    return res.status(200).json({
      success: true, wallet, mint, decimals, truncated,
      generatedAt: new Date().toISOString(),
      summary, counterparties, transactions: rows,
      bagsContext: bagsCtx?.bagsInfo ? {
        isBagsToken: !!bagsCtx.bagsInfo.isBagsToken,
        walletIsBagsCreator,
        walletCreatorMeta,
        tokenSymbol: bagsCtx.bagsInfo.symbol,
      } : null,
    });
  } catch (err) {
    console.error("[trace] error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- Cluck Score PNG card (1200x630, Twitter-card optimal) --
// Generates a shareable image for any mint by calling our own /api/cluck-score
// endpoint and rasterizing the result with @napi-rs/canvas. Cached 5 min same as
// the score endpoint. This is what makes the share button viral instead of just
// a text tweet.
const GRADE_COLORS = { "A+": "#10B981", A: "#10B981", B: "#60A5FA", C: "#F59E0B", D: "#D97706", F: "#EF4444" };

function renderScoreCard(scoreData) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background — same dark/orange theme as the rest of the app
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  // Soft radial accents
  const accent = ctx.createRadialGradient(220, 120, 0, 220, 120, 560);
  accent.addColorStop(0, "rgba(217, 119, 6, 0.18)");
  accent.addColorStop(1, "rgba(217, 119, 6, 0)");
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H);
  const accent2 = ctx.createRadialGradient(1000, 580, 0, 1000, 580, 460);
  accent2.addColorStop(0, "rgba(239, 68, 68, 0.12)");
  accent2.addColorStop(1, "rgba(239, 68, 68, 0)");
  ctx.fillStyle = accent2;
  ctx.fillRect(0, 0, W, H);

  // Brand header
  ctx.textBaseline = "top";
  ctx.fillStyle = "#D97706";
  ctx.font = "900 22px Oswald, sans-serif";
  ctx.fillText("CLUCK SCORE", 60, 50);
  ctx.fillStyle = "#6B7280";
  ctx.font = "16px Oswald, sans-serif";
  ctx.fillText("School of Crypto Hard Knocks", 60, 82);

  // Token identity
  const ticker = scoreData.ticker ? "$" + scoreData.ticker.toUpperCase() : "$UNKNOWN";
  const name = scoreData.name || (scoreData.mint ? scoreData.mint.slice(0, 10) + "…" : "");
  ctx.fillStyle = "#9CA3AF";
  ctx.font = "900 28px Oswald, sans-serif";
  ctx.fillText(ticker, 60, 140);
  ctx.fillStyle = "#F9FAFB";
  ctx.font = "900 44px Oswald, sans-serif";
  ctx.fillText(name, 60, 178);

  // Big gradient score
  const scoreText = scoreData.score == null ? "—" : String(scoreData.score);
  ctx.font = "900 220px Oswald, sans-serif";
  const scoreGrad = ctx.createLinearGradient(60, 260, 460, 480);
  scoreGrad.addColorStop(0, "#FCD34D");
  scoreGrad.addColorStop(0.5, "#F97316");
  scoreGrad.addColorStop(1, "#EF4444");
  ctx.fillStyle = scoreGrad;
  ctx.fillText(scoreText, 60, 250);
  const scoreWidth = ctx.measureText(scoreText).width;

  // " / 100" suffix
  ctx.fillStyle = "#6B7280";
  ctx.font = "300 40px Oswald, sans-serif";
  ctx.fillText("/ 100", 60 + scoreWidth + 16, 408);

  // Grade chip (right of score)
  const grade = scoreData.grade || "—";
  const gradeColor = GRADE_COLORS[grade] || GRADE_COLORS[grade[0]] || "#6B7280";
  const chipX = 60 + scoreWidth + 110;
  const chipY = 280;
  const chipW = 220, chipH = 170;
  ctx.fillStyle = gradeColor + "22";
  ctx.fillRect(chipX, chipY, chipW, chipH);
  ctx.strokeStyle = gradeColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(chipX, chipY, chipW, chipH);
  ctx.fillStyle = gradeColor;
  ctx.font = "900 110px Oswald, sans-serif";
  const gradeWidth = ctx.measureText(grade).width;
  ctx.fillText(grade, chipX + (chipW - gradeWidth) / 2, chipY + 30);
  // "GRADE" label below
  ctx.font = "900 14px Oswald, sans-serif";
  ctx.fillStyle = gradeColor;
  const lblWidth = ctx.measureText("GRADE").width;
  ctx.fillText("GRADE", chipX + (chipW - lblWidth) / 2, chipY + 145);

  // Verdict text (word-wrapped, italic, max 2 lines)
  ctx.fillStyle = "#D1D5DB";
  ctx.font = "italic 22px Oswald, sans-serif";
  const verdict = '"' + (scoreData.verdict || "") + '"';
  const maxW = W - 120;
  const words = verdict.split(" ");
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width <= maxW) current = test;
    else { lines.push(current); current = w; if (lines.length === 1) break; }
  }
  if (current) lines.push(current);
  const verdictTop = 490;
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    ctx.fillText(lines[i] + (i === 1 && lines.length > 2 ? "…" : ""), 60, verdictTop + i * 30);
  }

  // Footer URL
  ctx.fillStyle = "#D97706";
  ctx.font = "900 18px Oswald, sans-serif";
  ctx.fillText("clucknorris.app/score", 60, 580);
  ctx.fillStyle = "#6B7280";
  ctx.font = "14px Oswald, sans-serif";
  ctx.fillText("free · no wallet connect · any solana mint", 60, 604);

  return canvas.toBuffer("image/png");
}

app.get("/api/cluck-card", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const mint = (req.query.mint || "").trim();
  if (!mint || mint.length < 32) {
    return res.status(400).json({ success: false, error: "Invalid mint" });
  }
  try {
    // Re-use the score endpoint so the card and the JSON always agree.
    const scoreRes = await fetch(`http://localhost:${PORT}/api/cluck-score?mint=${encodeURIComponent(mint)}`);
    const scoreData = await scoreRes.json();
    if (!scoreData?.success) {
      return res.status(400).json({ success: false, error: scoreData?.error || "Could not score this mint" });
    }
    const png = renderScoreCard(scoreData);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", png.length);
    return res.end(png);
  } catch (err) {
    console.error("Card render error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cluck Norris round logo, loaded once and reused across card renders.
let _logoPromise = null;
function getLogo() {
  if (!_logoPromise) _logoPromise = loadImage(join(__dirname, "public", "cluck-norris-logo.jpg")).catch(() => null);
  return _logoPromise;
}

// -- Transcript share card (1200x630 PNG) — same canvas rig as the score card --
// No emoji in canvas (the bundled Oswald has none); text labels only.
async function renderCredentialCard(rec) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(220, 120, 0, 220, 120, 560);
  g.addColorStop(0, "rgba(217, 119, 6, 0.18)"); g.addColorStop(1, "rgba(217, 119, 6, 0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(1000, 580, 0, 1000, 580, 460);
  g.addColorStop(0, "rgba(212, 175, 55, 0.12)"); g.addColorStop(1, "rgba(212, 175, 55, 0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Round logo, top-right.
  const logo = await getLogo();
  if (logo) {
    const LS = 124, lx = W - 60 - LS, ly = 44, cx = lx + LS / 2, cy = ly + LS / 2, r = LS / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(logo, lx, ly, LS, LS);
    ctx.restore();
    ctx.strokeStyle = "#D97706"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.textBaseline = "top";
  ctx.fillStyle = "#D97706"; ctx.font = "900 24px Oswald, sans-serif";
  ctx.fillText("CLUCK NORRIS", 60, 48);
  ctx.fillStyle = "#6B7280"; ctx.font = "900 15px Oswald, sans-serif";
  ctx.fillText("OFFICIAL TRANSCRIPT · SCHOOL OF CRYPTO HARD KNOCKS", 60, 82);

  const diploma = rec.diploma && rec.diploma.passed ? rec.diploma : null;
  const grad = !!(rec.graduation && rec.graduation.completed);
  const verified = !!(diploma && diploma.verified === "server-scored");

  let headline = "TRANSCRIPT", hcolor = "#F9FAFB";
  if (verified) { headline = "CERTIFIED GRADUATE"; hcolor = "#D4AF37"; }
  else if (diploma) { headline = "CHALLENGE PASSED"; hcolor = "#D4AF37"; }
  else if (grad) { headline = "SCHOOL GRADUATE"; hcolor = "#10B981"; }
  ctx.fillStyle = hcolor; ctx.font = "900 70px Oswald, sans-serif";
  ctx.fillText(headline, 60, 134);

  const w = rec.wallet || "";
  const shortW = w.length > 12 ? w.slice(0, 6) + "…" + w.slice(-6) : w;
  ctx.fillStyle = "#9CA3AF"; ctx.font = "26px Oswald, sans-serif";
  ctx.fillText(shortW, 60, 220);

  let y = 300;
  function row(label, value, vcolor, tag, tagColor) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, y - 12); ctx.lineTo(W - 60, y - 12); ctx.stroke();
    ctx.fillStyle = "#9CA3AF"; ctx.font = "900 22px Oswald, sans-serif";
    ctx.fillText(label, 60, y + 14);
    ctx.fillStyle = vcolor; ctx.font = "900 46px Oswald, sans-serif";
    const vw = ctx.measureText(value).width;
    ctx.fillText(value, W - 60 - vw, y);
    if (tag) {
      ctx.fillStyle = tagColor || "#6B7280"; ctx.font = "900 14px Oswald, sans-serif";
      const tw = ctx.measureText(tag).width;
      ctx.fillText(tag, W - 60 - tw, y + 50);
    }
    y += 96;
  }
  if (diploma) row("ULTIMATE CHALLENGE", diploma.pct + "%", "#D4AF37", verified ? "VERIFIED ON-CHAIN" : "SELF-REPORTED", verified ? "#10B981" : "#6B7280");
  if (grad) row("FULL CURRICULUM", "12 / 12", "#10B981", "ALL LESSONS COMPLETE", "#6B7280");
  if (rec.holder && rec.holder.isHolder) row("STATUS", "CLKN HOLDER", "#D97706", null); // status only — never the balance (privacy)

  ctx.fillStyle = "#D97706"; ctx.font = "900 18px Oswald, sans-serif";
  ctx.fillText("clucknorris.app/transcript", 60, 580);
  ctx.fillStyle = "#6B7280"; ctx.font = "14px Oswald, sans-serif";
  ctx.fillText("permanent · verifiable · yours", 60, 604);

  return canvas.toBuffer("image/png");
}

app.get("/api/credential-card", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=120");
  const rec = credentials.resolve(String(req.query.slug || req.query.id || "").trim());
  if (!rec) return res.status(404).json({ success: false, error: "No transcript found" });
  try {
    const png = await renderCredentialCard(rec);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", png.length);
    return res.end(png);
  } catch (err) {
    console.error("Credential card error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- ROSE Buy Competition Analyzer --
// The Hatchery — guided token creator. Unlisted: not linked from nav anywhere,
// reachable only by direct URL while in private testing.
app.get("/hatchery", (req, res) => {
  res.sendFile(join(__dirname, "public", "hatchery.html"));
});

// Liquidity Engine — Orca Whirlpools concentrated-liquidity market maker.
app.get("/liquidity", (req, res) => {
  res.sendFile(join(__dirname, "public", "liquidity.html"));
});

// Liquidity Engine — product / education / platform page (the flagship pitch).
app.get("/liquidity-engine", (req, res) => {
  res.sendFile(join(__dirname, "public", "liquidity-engine.html"));
});

// Security Coop — wallet permission check / approval revoker.
app.get("/security-coop", (req, res) => {
  res.sendFile(join(__dirname, "public", "security-coop.html"));
});

// Wallet Safety Checkup — read-only scan (approvals + risky holdings).
app.get("/wallet-checkup", (req, res) => {
  res.sendFile(join(__dirname, "public", "wallet-checkup.html"));
});

// Tools & Utilities hub — the front door to the toolkit, linked from the landing.
app.get("/tools", (req, res) => {
  res.sendFile(join(__dirname, "public", "tools.html"));
});

// Privacy policy + Terms — required live at /privacy and /terms for the Solana
// dApp Store submission's Compliance section.
app.get("/privacy", (req, res) => {
  res.sendFile(join(__dirname, "public", "privacy.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(join(__dirname, "public", "terms.html"));
});

// Buy-Competition operator portal (hidden, unadvertised; actions are key-gated server-side).
app.get("/buycomp-admin", (req, res) => {
  res.sendFile(join(__dirname, "public", "buycomp-admin.html"));
});

// Buy Special random-draw runner + public results/verification view (?id=<drawId>).
app.get("/buyspecial-draw", (req, res) => {
  res.sendFile(join(__dirname, "public", "buyspecial-draw.html"));
});

app.get("/rose", (req, res) => {
  res.sendFile(join(__dirname, "public", "rose.html"));
});

// -- Premium Forensics (private, unlinked; gated by access key in the page) --
app.get("/premium", (req, res) => {
  res.sendFile(join(__dirname, "public", "premium.html"));
});

// -- The Coop Spinner (slot game) — demo/prototype --
app.get("/slots", (req, res) => {
  res.sendFile(join(__dirname, "public", "slots.html"));
});

// -- /launches + /bags-launches are aliases of the canonical Bags page (/bags),
//    which is the full Bags showcase + live launches feed. One page, one source. --
app.get(["/launches", "/bags-launches"], (req, res) => {
  res.sendFile(join(__dirname, "public", "bags.html"));
});

// -- Airdrop Tool --
app.get("/airdrop", (req, res) => {
  res.sendFile(join(__dirname, "public", "airdrop.html"));
});

// -- Buy Special Analyzer --
app.get("/buyspecial", (req, res) => {
  res.sendFile(join(__dirname, "public", "buyspecial.html"));
});

// -- Holders Analyzer --
app.get("/holders", (req, res) => {
  res.sendFile(join(__dirname, "public", "holders.html"));
});

// -- Investor / Interested Party page (live stats, pitch, real-talk risks) --
app.get("/investors", (req, res) => {
  res.sendFile(join(__dirname, "public", "investors.html"));
});
app.get("/investor", (req, res) => {
  // Singular alias for whoever types it that way
  res.sendFile(join(__dirname, "public", "investors.html"));
});

// -- Snapshot tool (paste any mint, get holders + airdrop-ready CSV) --
app.get("/snapshot", (req, res) => {
  res.sendFile(join(__dirname, "public", "snapshot.html"));
});

// -- Grant overview page (public-good framing for ecosystem grant reviewers) --
app.get("/grant", (req, res) => {
  res.sendFile(join(__dirname, "public", "grant.html"));
});

// -- Trace — wallet × token forensic history (private tool, not linked) --
app.get("/trace", (req, res) => {
  res.sendFile(join(__dirname, "public", "trace.html"));
});

// -- Token Autopsy — AI forensic agent for any Solana token (paste mint, learn from the corpse) --
app.get("/autopsy", (req, res) => {
  res.sendFile(join(__dirname, "public", "autopsy.html"));
});

// -- Traffic dashboard (private). The HTML is harmless without a key; the data
// endpoint is gated by PREMIUM_ACCESS_KEY. Open /stats?key=<key>. --
app.get("/stats", (req, res) => {
  res.sendFile(join(__dirname, "public", "stats.html"));
});
app.get("/api/stats", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.PREMIUM_ACCESS_KEY || req.query.key !== process.env.PREMIUM_ACCESS_KEY) {
    return res.status(404).json({ error: "not_found" });
  }
  const n = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
  return res.status(200).json({ success: true, ...analytics.summary(n) });
});
app.get("/bags", (req, res) => {
  res.sendFile(join(__dirname, "public", "bags.html"));
});

// Canonical public origin for social/share/og URLs — always clucknorris.app, so
// links never carry the raw Railway host even if the server is reached that way.
// Env-overridable for a future domain change or local testing.
const CANONICAL_ORIGIN = process.env.CANONICAL_ORIGIN || "https://clucknorris.app";

// -- Cluck Score public page (paste any mint, see the score rendered) --
// When a ?mint= param is present, inject mint-specific og:image and twitter:card
// meta tags so the card image unfurls on social platforms automatically.
let _scoreHtmlCache = null;
function getScoreHtml() {
  if (_scoreHtmlCache) return _scoreHtmlCache;
  _scoreHtmlCache = fs.readFileSync(join(__dirname, "public", "score.html"), "utf8");
  return _scoreHtmlCache;
}
app.get("/score", (req, res) => {
  const mint = (req.query.mint || "").trim();
  let html = getScoreHtml();
  if (mint && mint.length >= 32) {
    const cardUrl = `${CANONICAL_ORIGIN}/api/cluck-card?mint=${encodeURIComponent(mint)}`;
    const pageUrl = `${CANONICAL_ORIGIN}/score?mint=${encodeURIComponent(mint)}`;
    const meta = [
      `<meta property="og:image" content="${cardUrl}"/>`,
      `<meta property="og:image:width" content="1200"/>`,
      `<meta property="og:image:height" content="630"/>`,
      `<meta property="og:url" content="${pageUrl}"/>`,
      `<meta name="twitter:card" content="summary_large_image"/>`,
      `<meta name="twitter:image" content="${cardUrl}"/>`,
    ].join("\n");
    html = html.replace("</head>", meta + "\n</head>");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// -- Permanent transcript page (reads the slug from the path, fetches the JSON) --
let _transcriptHtmlCache = null;
function getTranscriptHtml() {
  if (_transcriptHtmlCache) return _transcriptHtmlCache;
  _transcriptHtmlCache = fs.readFileSync(join(__dirname, "public", "transcript.html"), "utf8");
  return _transcriptHtmlCache;
}
app.get("/transcript/:slug", (req, res) => {
  let html = getTranscriptHtml();
  const rec = credentials.resolve(String(req.params.slug || "").trim());
  if (rec) {
    const cardUrl = `${CANONICAL_ORIGIN}/api/credential-card?slug=${encodeURIComponent(rec.slug)}`;
    const pageUrl = `${CANONICAL_ORIGIN}/transcript/${encodeURIComponent(rec.slug)}`;
    const meta = [
      `<meta property="og:image" content="${cardUrl}"/>`,
      `<meta property="og:image:width" content="1200"/>`,
      `<meta property="og:image:height" content="630"/>`,
      `<meta property="og:url" content="${pageUrl}"/>`,
      `<meta name="twitter:card" content="summary_large_image"/>`,
      `<meta name="twitter:image" content="${cardUrl}"/>`,
    ].join("\n");
    html = html.replace("</head>", meta + "\n</head>");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// -- Bubblemaps Proxy -- Bubblemaps blocks browser CORS, so we proxy server-side.
app.get("/api/bubblemaps", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // cache 5 min
  const { token, chain } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });
  try {
    const url = `https://api-legacy.bubblemaps.io/map-data?token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain || "sol")}`;
    const response = await fetch(url);
    const text = await response.text();
    res.status(response.status);
    try { return res.json(JSON.parse(text)); }
    catch (e) { return res.send(text); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Token Autopsy — AI Forensic Agent ───────────────────────────────────────
// Paste any Solana token mint, the agent investigates on-chain + DexScreener
// state, classifies the death mode (LP rug, honeypot, soft rug, mint-dilution
// risk, alive), aggregates verified red flags, and feeds the structured facts
// to Claude Haiku for a Cluck-voice case study. Heuristic v1 — won't catch
// every pattern but won't invent numbers either. Free and public.
// Server-side report cache. A full autopsy runs ~10 phases hitting Helius +
// Solana Tracker + DexScreener; when a hot mint gets scanned repeatedly (e.g.
// a token making the rounds in chats) every run re-burns those credits. We
// cache the assembled report by mint for a short TTL so repeat scans return
// instantly and cost nothing. In-memory is fine — a 3-min hot cache doesn't
// need to survive restarts. ?nocache=1 forces a fresh run.
const AUTOPSY_CACHE = new Map();          // mint → { body, ts }
const AUTOPSY_TTL_MS = 180000;            // 3 min

app.get("/api/autopsy", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const mint = (req.query.mint || "").trim();
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ success: false, error: "Invalid mint" });
  try { analytics.trackTool("autopsy"); } catch (_) {}

  if (req.query.nocache !== "1") {
    const hit = AUTOPSY_CACHE.get(mint);
    if (hit && Date.now() - hit.ts < AUTOPSY_TTL_MS) {
      res.setHeader("X-Autopsy-Cache", "hit");
      return res.json({ ...hit.body, cached: true, cachedAgeSec: Math.round((Date.now() - hit.ts) / 1000) });
    }
  }
  res.setHeader("X-Autopsy-Cache", "miss");
  // Capture the assembled report on the way out so the next caller rides the
  // cache. Only successful reports are stored (errors should re-try fresh).
  const _resJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (body && body.success) {
        AUTOPSY_CACHE.set(mint, { body, ts: Date.now() });
        if (AUTOPSY_CACHE.size > 300) { const cut = Date.now() - AUTOPSY_TTL_MS; for (const [k, v] of AUTOPSY_CACHE) if (v.ts < cut) AUTOPSY_CACHE.delete(k); }
      }
    } catch (_) {}
    return _resJson(body);
  };

  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Server not configured" });
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  // Per-request Helius enhanced-tx cache + scan-quality tracker. Stops us
  // re-fetching the same sig across phases and gives the UI a way to flag
  // when Helius was throttling us mid-run.
  const heliusTxCache = new Map();
  const scanQuality = {
    heliusBatches: 0,
    heliusBatchesSucceeded: 0,
    heliusRateLimited: 0,
    phasesCompleted: [],
    phasesFailed: [],
  };
  function rpcCall(id, method, params) {
    return fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    }).then(r => r.json());
  }

  try {
    const [dexData, supplyData, mintInfoData] = await Promise.allSettled([
      fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(r => r.json()),
      rpcCall("autopsy-supply", "getTokenSupply", [mint]),
      rpcCall("autopsy-mint", "getAccountInfo", [mint, { encoding: "jsonParsed" }]),
    ]);

    const allPairs = dexData.status === "fulfilled" && Array.isArray(dexData.value) ? dexData.value : [];
    const solPairs = allPairs.filter(p => p.chainId === "solana" || !p.chainId);
    const totalLiqUsd = solPairs.reduce((s, p) => s + (parseFloat(p.liquidity?.usd) || 0), 0);
    const totalVol24h = solPairs.reduce((s, p) => s + (parseFloat(p.volume?.h24) || 0), 0);
    const buys24h = solPairs.reduce((s, p) => s + (p.txns?.h24?.buys || 0), 0);
    const sells24h = solPairs.reduce((s, p) => s + (p.txns?.h24?.sells || 0), 0);
    const txns24h = buys24h + sells24h;
    const topPair = solPairs.length
      ? solPairs.slice().sort((a, b) => (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0))[0]
      : null;
    const pairCreatedMs = topPair?.pairCreatedAt ? Number(topPair.pairCreatedAt) : null;
    const ageDays = pairCreatedMs ? (Date.now() - pairCreatedMs) / 86400000 : null;
    // Price trend — without this the AI thinks every low-volume token is fading.
    // DexScreener's priceChange is a % number (e.g. 12.5 means +12.5%).
    const priceChangeH1  = topPair?.priceChange?.h1  ?? null;
    const priceChangeH6  = topPair?.priceChange?.h6  ?? null;
    const priceChangeH24 = topPair?.priceChange?.h24 ?? null;

    const rawSupply = supplyData.status === "fulfilled" ? supplyData.value?.result?.value?.amount : null;
    const decimals = supplyData.status === "fulfilled" ? (supplyData.value?.result?.value?.decimals || 9) : 9;
    const supplyTokens = rawSupply ? parseInt(rawSupply) / Math.pow(10, decimals) : null;

    const mintParsed = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.data?.parsed?.info : null;
    const mintAuthority = mintParsed?.mintAuthority || null;
    const freezeAuthority = mintParsed?.freezeAuthority || null;

    // --- Token-2022 extension scan (modern honeypot / rug vectors) ---
    // The classic mint/freeze authority check is blind to Token-2022
    // extensions, which are how today's honeypots actually trap buyers: a
    // transfer hook routes every trade through a custom program that can
    // reject sells; a 100% transfer fee is an unsellable sell tax; a
    // permanent delegate can seize anyone's tokens; a non-transferable or
    // default-frozen mint blocks selling outright. The jsonParsed
    // getAccountInfo already returns these under info.extensions and the
    // owning program under value.owner — we just read them. This only fires
    // for Token-2022 mints, so standard SPL pump/Bags tokens are untouched.
    const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    const SYS_PROGRAM = "11111111111111111111111111111111";
    const tokenProgramOwner = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.owner : null;
    const isToken2022 = tokenProgramOwner === TOKEN_2022_PROGRAM;
    const mintExtensions = Array.isArray(mintParsed?.extensions) ? mintParsed.extensions : [];
    const extByType = {};
    for (const e of mintExtensions) { if (e && e.extension) extByType[e.extension] = e.state || e; }

    const token2022Risks = [];
    let transferFeeBps = null;
    if (extByType.transferFeeConfig) {
      const cfg = extByType.transferFeeConfig;
      // Read the *newer* (currently-effective) fee. jsonParsed nests it under
      // newerTransferFee.transferFeeBasisPoints (camelCase).
      transferFeeBps = cfg?.newerTransferFee?.transferFeeBasisPoints
        ?? cfg?.newerTransferFee?.transfer_fee_basis_points
        ?? null;
      if (transferFeeBps != null) {
        const pct = (transferFeeBps / 100).toFixed(transferFeeBps % 100 === 0 ? 0 : 1);
        if (transferFeeBps >= 9000) token2022Risks.push({ kind: "transfer-fee", severity: "honeypot", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee is ${pct}% — every sell is taxed into oblivion. Effectively unsellable (honeypot-grade sell tax).` });
        else if (transferFeeBps >= 1000) token2022Risks.push({ kind: "transfer-fee", severity: "severe", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee is ${pct}% — a heavy sell tax skims every trade.` });
        else if (transferFeeBps > 0) token2022Risks.push({ kind: "transfer-fee", severity: "caution", bps: transferFeeBps, label: `${pct}% transfer fee`, msg: `Token-2022 transfer fee of ${pct}% applies to every transfer.` });
      }
    }
    if (extByType.transferHook) {
      const hookProg = extByType.transferHook?.programId || extByType.transferHook?.program_id || null;
      if (hookProg && hookProg !== SYS_PROGRAM) token2022Risks.push({ kind: "transfer-hook", severity: "honeypot", program: hookProg, label: "active transfer hook", msg: `A Token-2022 transfer hook routes every trade through a custom program (${hookProg.slice(0, 4)}…${hookProg.slice(-4)}) that can block sells at will — a common honeypot mechanism.` });
    }
    if (extByType.permanentDelegate) {
      const del = extByType.permanentDelegate?.delegate || null;
      if (del && del !== SYS_PROGRAM) token2022Risks.push({ kind: "permanent-delegate", severity: "severe", delegate: del, label: "permanent delegate", msg: `A permanent delegate (${del.slice(0, 4)}…${del.slice(-4)}) can move or burn tokens from ANY wallet, forever — your holdings are seizable.` });
    }
    if (extByType.defaultAccountState) {
      const st = extByType.defaultAccountState?.accountState || extByType.defaultAccountState?.state || extByType.defaultAccountState;
      if (typeof st === "string" && st.toLowerCase() === "frozen") token2022Risks.push({ kind: "default-frozen", severity: "honeypot", label: "accounts frozen by default", msg: "New token accounts are FROZEN by default — buyers can't sell until the team manually thaws each wallet. Classic restricted-sell honeypot." });
    }
    if (extByType.nonTransferable || extByType.nonTransferableAccount) {
      token2022Risks.push({ kind: "non-transferable", severity: "honeypot", label: "non-transferable", msg: "Token is NON-TRANSFERABLE — it can never be sold or moved. Hard honeypot (or a soul-bound token, but never tradeable)." });
    }
    const hasHoneypotExtension = token2022Risks.some(r => r.severity === "honeypot");
    const hasSevereExtension = token2022Risks.some(r => r.severity === "severe" || r.severity === "honeypot");

    // --- Top 100 holders via paginated getTokenAccounts (DAS) ---
    // getTokenLargestAccounts caps at 20. The DAS getTokenAccounts gives us
    // pagination (up to 1000 per page) and the owner field directly, so we
    // can both walk deeper AND skip a batched RPC call later.
    const MAX_HOLDER_PAGES = 5;
    const allTokenAccounts = [];
    for (let p = 1; p <= MAX_HOLDER_PAGES; p++) {
      try {
        const r = await rpcCall(`autopsy-tas-${p}`, "getTokenAccounts", {
          page: p, limit: 1000, mint, displayOptions: { showZeroBalance: false }
        });
        const accs = r?.result?.token_accounts || [];
        if (accs.length === 0) break;
        allTokenAccounts.push(...accs);
        if (accs.length < 1000) break;
      } catch (e) {
        console.warn(`[AUTOPSY] token accounts page ${p} failed:`, e.message);
        break;
      }
    }
    const largestRaw = allTokenAccounts
      .map(a => ({
        address: a.address,                                              // token account address
        amount: a.amount,
        uiAmount: parseInt(a.amount || "0") / Math.pow(10, decimals),
        owner: a.owner,                                                   // wallet authority — directly available
      }))
      .filter(a => a.uiAmount > 0)
      .sort((a, b) => b.uiAmount - a.uiAmount)
      .slice(0, 100);
    const top10Sum = largestRaw.slice(0, 10).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0);
    const top10Share = supplyTokens > 0 ? top10Sum / supplyTokens : null;

    // CEX custody recognition. A known exchange wallet among the top holders is
    // custodial (many users' tokens), NOT single-entity whale concentration — so
    // we net it out of the concentration risk. And a token an exchange actually
    // lists is a real legitimacy signal, surfaced separately. Labels come from
    // Solana Tracker holder identity enrichment (authoritative — covers the many
    // rotating per-token exchange wallets a static list can't), merged with our
    // static fallback. Cached 10min; degrades to no-CEX on failure/quota.
    // Normalize "Binance 3" / "Binance Cold Wallet" / "OKX: Hot Wallet" → brand.
    const cexBrand = (n) => { if (!n) return n; const s = String(n).replace(/:.*/, "").replace(/\s*(hot|cold)\s+wallet.*$/i, "").replace(/\s+wallet.*$/i, "").replace(/\s*#?\d+\s*$/, "").trim(); return s || n; };
    // Derive CEX presence from ST's TRUE top-holder list (Helius getTokenAccounts
    // only returns an arbitrary first-5000 slice — for a million-holder token the
    // real whales, exchanges included, aren't in it). ST gives sorted holders with
    // percentage + identity tags. Cached 10min; degrades to no-CEX on failure.
    const cexWalletNames = new Map();   // owner → exchange name (for Helius-side netting)
    const cexBrands = new Set();        // brands among the true top holders
    let cexTop10Share = 0;              // CEX share within ST's true top-10 (fraction of supply)
    try {
      const eh = await solanaTracker.getEnrichedHolders(mint, { enrich: "identity" });
      const accts = (eh && Array.isArray(eh.accounts) ? eh.accounts : []);
      accts.forEach((h, rank) => {
        const id = h.identity || {};
        const isExch = id.type === "exchange" || (Array.isArray(id.tags) && id.tags.includes("exchange"));
        if (!isExch) return;
        const name = (id.exchange && id.exchange.name) || id.name || "Exchange";
        if (h.wallet) cexWalletNames.set(h.wallet, name);
        const pct = Number(h.percentage) || 0;            // ST returns % of supply
        if (pct >= 0.1) cexBrands.add(cexBrand(name));     // ignore dust deposit wallets
        if (rank < 10) cexTop10Share += pct / 100;
      });
    } catch (_) {}
    const cexExchanges = [...cexBrands];
    // Net CEX custody out of the Helius-basis concentration too (covers the case
    // where a CEX wallet IS in the visible slice). Use whichever share is larger.
    const cexNameOf = (owner) => cexWalletNames.get(owner) || KNOWN_CEX_WALLETS[owner] || null;
    const cexTop10ShareHelius = supplyTokens > 0
      ? largestRaw.slice(0, 10).filter(a => cexNameOf(a.owner)).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0) / supplyTokens
      : 0;
    const concentrationExCex = top10Share != null ? Math.max(0, top10Share - cexTop10ShareHelius) : null;
    const cexPresence = cexExchanges.length ? { exchanges: cexExchanges, top10Share: cexTop10Share } : null;

    const symbol = topPair?.baseToken?.symbol || "UNKNOWN";
    const name = topPair?.baseToken?.name || symbol;
    const priceUsd = topPair ? parseFloat(topPair.priceUsd) : null;
    const fdv = topPair?.fdv || null;
    const marketCap = topPair?.marketCap || null;
    // Turnover = 24h volume ÷ market cap. The honest "is it trading?" signal:
    // $1K/day is healthy for a $100K token (1%) but near-dead for a $40M one
    // (0.0025%). Absolute volume thresholds can't compare across sizes — turnover
    // can. Falls back to FDV when MC is missing; null when neither is known.
    const mcapForTurnover = marketCap || fdv || null;
    const turnover = (mcapForTurnover && mcapForTurnover > 0) ? totalVol24h / mcapForTurnover : null;

    // --- LP burn/lock status (classic rug vector) ---
    // Solana Tracker reports per-pool `lpBurn` = % of the pool's LP tokens that
    // are burned/locked. 100 = liquidity permanently locked (cannot be pulled);
    // low = the LP is still dev-controlled and the pool can be rugged. For
    // bonding-curve pools, liquidity is program-custodied until graduation, so
    // the classic LP-rug doesn't apply yet.
    let lpStatus = null;
    try {
      const stInfo = await solanaTracker.getTokenInfo(mint); // cached (1h)
      const liqOf = p => ((p.liquidity || {}).usd) || 0;
      const stPools = (Array.isArray(stInfo?.pools) ? stInfo.pools : []).filter(p => liqOf(p) > 0);
      if (stPools.length) {
        const totalLiq = stPools.reduce((s, p) => s + liqOf(p), 0);
        const primary = stPools.reduce((b, p) => (liqOf(p) > liqOf(b) ? p : b), stPools[0]);
        const primaryShare = totalLiq > 0 ? liqOf(primary) / totalLiq : 1;
        const meaningfulPools = stPools.filter(p => totalLiq > 0 && liqOf(p) / totalLiq >= 0.05).length; // pools holding ≥5% of liq
        const lpBurnPct = primary.lpBurn != null ? Number(primary.lpBurn) : null;
        const lpMarket = primary.market || null;
        const onCurveMkt = solanaTracker.isLaunchpadCurveMarket(lpMarket);
        // Concentrated-liquidity AMMs (Raydium CLMM, Meteora DLMM, Orca Whirlpool)
        // hold liquidity as NFT positions, not fungible LP tokens — there is
        // nothing to "burn", so a 0% lpBurn there is a NON-signal, not a rug flag.
        const concentratedMkt = /clmm|dlmm|whirlpool/i.test(String(lpMarket || ""));
        // Liquidity-weighted burn across every pool that reports a burn %.
        let wNum = 0, wDen = 0;
        for (const p of stPools) { const liq = liqOf(p); if (p.lpBurn != null && liq > 0) { wNum += Number(p.lpBurn) * liq; wDen += liq; } }
        const weightedBurn = wDen > 0 ? wNum / wDen : null;
        // "Distributed" = an established multi-pool token where no SINGLE pool's
        // lock % is a ruggability verdict (the BONK case: liquidity across ~40 pools).
        const distributed = meaningfulPools >= 3 || primaryShare < 0.6;
        let status, label;
        if (onCurveMkt) {
          status = "curve";
          label = "Liquidity is custodied in the launchpad bonding curve — program-locked until graduation, not dev-withdrawable. Classic LP-rug doesn't apply at this stage.";
        } else if (distributed) {
          status = "distributed";
          const wb = weightedBurn != null ? ` (~${weightedBurn.toFixed(0)}% liquidity-weighted LP burned across pools)` : "";
          label = `Liquidity is spread across ${meaningfulPools} significant pools of ${stPools.length} total${wb}. LP-lock analysis is most meaningful for single-pool launch tokens; for an established multi-pool token, no single pool's lock status determines ruggability — review each major pool on its own.`;
        } else if (concentratedMkt && (lpBurnPct == null || lpBurnPct < 50)) {
          status = "na";
          label = `The main pool is a concentrated-liquidity market (${lpMarket}), which holds liquidity as NFT positions rather than burnable LP tokens — the LP-burn metric doesn't apply, so a low value here is not a rug signal.`;
        } else if (lpBurnPct == null) {
          status = "unknown";
          label = "LP lock/burn status couldn't be determined for this pool type.";
        } else if (lpBurnPct >= 99) {
          status = "burned";
          label = "LP tokens are ~100% burned — pool liquidity is permanently locked and cannot be pulled. Strongest liquidity-safety signal.";
        } else if (lpBurnPct >= 50) {
          status = "partial";
          label = `~${lpBurnPct.toFixed(0)}% of LP is burned/locked — the remainder is still dev-withdrawable.`;
        } else {
          status = "unlocked";
          label = `Only ~${lpBurnPct.toFixed(0)}% of the main pool's LP is burned — that pool's liquidity is largely withdrawable by whoever holds the LP tokens. A pull risk unless it's locked elsewhere; weigh it against the token's age and how liquidity is spread across pools.`;
        }
        lpStatus = { lpBurnPct, weightedBurn, market: lpMarket, status, label, poolCount: stPools.length, meaningfulPools, primaryShare: Math.round(primaryShare * 100) };
      }
    } catch (e) { console.warn("[AUTOPSY] LP-lock check failed:", e.message); }

    // --- Metadata mutability + update authority (bait-and-switch rug vector) ---
    // A mutable token lets whoever holds the update authority change the name,
    // symbol, image and socials AFTER launch. On launchpad tokens (Bags/Pump/etc.)
    // the PLATFORM holds that authority by design — normal, not a dev risk. On a
    // hand-rolled mint, a still-active non-platform authority is the real
    // bait-and-switch vector. Helius DAS getAsset gives mutability + authority.
    let metadataStatus = null;
    try {
      const ga = await rpcCall("autopsy-getasset", "getAsset", { id: mint });
      const asset = ga?.result || null;
      if (asset && typeof asset.mutable === "boolean") {
        const fullAuth = (asset.authorities || []).find(a => Array.isArray(a.scopes) && a.scopes.includes("full")) || (asset.authorities || [])[0] || null;
        const updateAuthority = fullAuth?.address || null;
        const mintLc = mint.toLowerCase();
        const launchpadMint = mintLc.endsWith("pump") || mintLc.endsWith("bags") || mintLc.endsWith("bonk") || mintLc.endsWith("moon");
        const platformHeld = (updateAuthority || "").startsWith("BAGS") || launchpadMint;
        let status, label;
        if (!asset.mutable) {
          status = "immutable";
          label = "Metadata is immutable — name, symbol, image and links are permanently locked and can't be changed.";
        } else if (platformHeld) {
          status = "mutable-platform";
          label = "Metadata is mutable, but the update authority is held by the launchpad platform (standard for Bags/Pump launches) — the team can't unilaterally rebrand the token.";
        } else {
          status = "mutable-risk";
          label = `Metadata is mutable and the update authority${updateAuthority ? ` (${updateAuthority.slice(0, 4)}…${updateAuthority.slice(-4)})` : ""} is not a launchpad platform — the name, image and links can be changed after launch (bait-and-switch vector). Verify who controls it before trusting the branding.`;
        }
        metadataStatus = { mutable: asset.mutable, updateAuthority, platformHeld, status, label };
      }
    } catch (e) { console.warn("[AUTOPSY] metadata mutability check failed:", e.message); }

    // --- Red flags (factual, not invented) ---
    const redFlags = [];
    if (mintAuthority) redFlags.push("Mint authority is still active — the creator can print more supply at any time.");
    if (freezeAuthority) redFlags.push("Freeze authority is still active — individual wallets can be frozen.");
    for (const r of token2022Risks) redFlags.push(r.msg);
    if (concentrationExCex !== null && concentrationExCex > 0.5) redFlags.push(`Top 10 wallets hold roughly ${(concentrationExCex * 100).toFixed(0)}% of supply${cexPresence ? " (excluding exchange-custodied holdings)" : ""} — heavy concentration.`);
    // Low turnover for a sizable token — thin trading relative to its market cap.
    if (turnover !== null && (marketCap || 0) >= 1000000 && turnover < 0.0005 && totalVol24h < 25000) redFlags.push(`24h volume is only ${(turnover * 100).toFixed(3)}% of market cap — very low turnover for a $${(marketCap / 1e6).toFixed(1)}M token; trading interest is thin relative to its size (exit at size may be hard).`);
    if (totalLiqUsd > 0 && totalLiqUsd < 500) redFlags.push(`Pool liquidity is only $${totalLiqUsd.toFixed(0)} — there is effectively no exit at size.`);
    if (totalLiqUsd === 0 && solPairs.length > 0) redFlags.push("DexScreener shows pools but zero current liquidity — the LP has been pulled or migrated.");
    if (lpStatus && lpStatus.status === "unlocked") redFlags.push(`Liquidity is NOT locked — only ~${lpStatus.lpBurnPct.toFixed(0)}% of LP tokens are burned, so whoever holds the LP can withdraw the pool (classic rug vector). Verify it's locked elsewhere before trusting the depth.`);
    else if (lpStatus && lpStatus.status === "partial" && lpStatus.lpBurnPct < 80) redFlags.push(`Only ~${lpStatus.lpBurnPct.toFixed(0)}% of LP is burned/locked — the rest is dev-withdrawable.`);
    if (metadataStatus && metadataStatus.status === "mutable-risk") redFlags.push(metadataStatus.label);
    if (solPairs.length === 0) redFlags.push("No DexScreener pool found at all — the token never launched a tradeable market, or it has been delisted.");
    if (buys24h > 20 && sells24h === 0) redFlags.push(`${buys24h} buys today and zero sells — classic restricted-sell / honeypot pattern.`);
    if (buys24h > 0 && sells24h > 0 && buys24h / sells24h > 10) redFlags.push(`Buys outpace sells ${buys24h}-to-${sells24h} — sells may be partially restricted.`);
    if (ageDays !== null && ageDays > 7 && txns24h < 5 && totalLiqUsd > 0) redFlags.push("Activity has gone near-silent but the pool still technically exists — quiet-fade pattern.");

    // --- Verdict classification (heuristic, ordered) ---
    // Honesty rule: "Cause of Death" framing is reserved for tokens that are
    // genuinely dead — no pool, honeypot, drained LP, or true quiet-fade
    // (silent AND collapsed AND tiny). A still-trading token with a real
    // market cap in a drawdown is RETRACED, not dead. The earlier verdict
    // would mislabel a $68K-MC token as "QUIET FADE" off a single slow-volume
    // day — that's wrong, and we said it wouldn't happen.
    let verdict;
    if (solPairs.length === 0) {
      verdict = { type: "GHOST", label: "Cause of Death: NEVER LAUNCHED", severity: "DEAD", color: "#6B7280", icon: "👻" };
    } else if (hasHoneypotExtension) {
      // Proactive: a non-transferable / default-frozen / active-transfer-hook /
      // ~100% transfer-fee Token-2022 mint is a honeypot by construction — flag
      // it before it has to trap 20 buyers behaviorally.
      verdict = { type: "HONEYPOT", label: "Cause of Death: HONEYPOT (Token-2022)", severity: "DEAD", color: "#EF4444", icon: "🪤" };
    } else if (buys24h >= 20 && sells24h === 0 && totalLiqUsd > 0) {
      verdict = { type: "HONEYPOT", label: "Cause of Death: HONEYPOT", severity: "DEAD", color: "#EF4444", icon: "🪤" };
    } else if (totalLiqUsd < 500 && ageDays !== null && ageDays > 1) {
      verdict = { type: "LP_RUG", label: "Cause of Death: LP RUG", severity: "DEAD", color: "#EF4444", icon: "💀" };
    } else if (
      // True QUIET FADE: all of: older than 7 days, near-zero 24h volume AND
      // near-zero 24h transactions AND tiny market cap (≤ $25K). A slow day
      // alone is not death.
      ageDays !== null && ageDays > 7 &&
      totalVol24h < 50 && txns24h < 5 &&
      totalLiqUsd >= 500 &&
      (marketCap === null || marketCap <= 25000)
    ) {
      verdict = { type: "SOFT_RUG", label: "Cause of Death: QUIET FADE", severity: "DYING", color: "#F59E0B", icon: "🐌" };
    } else if (mintAuthority || freezeAuthority || hasSevereExtension || (concentrationExCex !== null && concentrationExCex > 0.5)) {
      verdict = { type: "AT_RISK", label: "Status: ALIVE BUT AT RISK", severity: "AT_RISK", color: "#F59E0B", icon: "⚠️" };
    } else if (totalLiqUsd >= 5000 && totalVol24h >= 100 && (turnover === null || turnover >= 0.001 || totalVol24h >= 25000)) {
      // Needs healthy liquidity + real volume, AND — when we know the market cap —
      // at least 0.1% daily turnover. Keeps a healthy microcap ALIVE (vol ≥ $100
      // on a ≤$100K token already clears 0.1%) while a bloated-MC token doing
      // pocket-change volume drops to UNCLEAR instead of a false "ALIVE". The
      // ≥$25K absolute-volume escape protects obviously-trading tokens when the
      // market cap is unreliable (e.g. DexScreener phantom-pool / decimals quirks).
      verdict = { type: "ALIVE", label: "Status: ALIVE & TRADING", severity: "ALIVE", color: "#10B981", icon: "🐔" };
    } else {
      verdict = { type: "UNCLEAR", label: "Status: UNCLEAR", severity: "UNCLEAR", color: "#6B7280", icon: "❓" };
    }

    // --- Report mode: autopsy framing only fits dead/dying tokens ---
    // For an alive token, calling the page a "Token Autopsy" is wrong. Cluck
    // came with a scalpel — but the patient is breathing. Swap the framing
    // to a Full Health Checkup. Same forensic depth, honest framing.
    let reportMode;
    let reportHeadline;
    let reportSubhead;
    if (verdict.severity === "ALIVE") {
      reportMode = "health-checkup";
      reportHeadline = "🚫 AUTOPSY CANCELED";
      reportSubhead = "Patient is alive and trading. Pulled out the scalpel, didn't need it. This is a Full Health Checkup instead.";
    } else if (verdict.severity === "AT_RISK") {
      reportMode = "health-assessment";
      reportHeadline = "⚠️ AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but showing warning signs. Health Assessment with concerns.";
    } else if (verdict.type === "RETRACED") {
      reportMode = "health-assessment";
      reportHeadline = "📉 AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but heavily bruised. Health Assessment of a token in a drawdown.";
    } else if (verdict.severity === "UNCLEAR") {
      reportMode = "autopsy";
      reportHeadline = "🔬 TOKEN AUTOPSY";
      reportSubhead = verdict.label;
    } else {
      // DEAD or DYING — true autopsy framing.
      reportMode = "autopsy";
      reportHeadline = "🔬 TOKEN AUTOPSY";
      reportSubhead = verdict.label;
    }

    // --- Linked lessons from the school ---
    const lessonMap = {
      GHOST:     [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "onchain", title: "Lesson 9 — On-Chain Analysis" }],
      HONEYPOT:  [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "tokenomics", title: "Lesson 6 — Tokenomics" }],
      LP_RUG:    [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "onchain", title: "Lesson 9 — On-Chain Analysis" }],
      SOFT_RUG:  [{ id: "onchain", title: "Lesson 9 — On-Chain Analysis" }, { id: "volatility", title: "Lesson 3 — Volatility & Weak Hands" }],
      RETRACED:  [{ id: "volatility", title: "Lesson 3 — Volatility & Weak Hands" }, { id: "marketcap", title: "Lesson 7 — Market Cap vs Price" }],
      AT_RISK:   [{ id: "tokenomics", title: "Lesson 6 — Tokenomics" }, { id: "rugs", title: "Lesson 2 — Rugs & Scams" }],
      CREATOR_EXTRACTED: [{ id: "rugs", title: "Lesson 2 — Rugs & Scams" }, { id: "tokenomics", title: "Lesson 6 — Tokenomics" }],
      ALIVE:     [{ id: "marketcap", title: "Lesson 7 — Market Cap vs Price" }],
      UNCLEAR:   [],
    };
    const lessons = lessonMap[verdict.type] || [];

    // --- Phase 2B: Lifetime Analysis ---
    // Walk the mint's signature history back to genesis, sample parsed
    // transactions across the lifetime, classify event types (mints / burns /
    // large transfers), and surface a chronological timeline of the
    // highest-impact moments. This is the part that makes the autopsy feel
    // like an agent that actually investigated the chain over time.
    let lifetime = null;
    let priceHistory = null;
    // Hoisted out so Phase 2F (P&L ledger) can reuse the lifetime walk + price candles.
    let lifetimeAllSigs = [];
    const priceCandlesByDay = new Map(); // dayKey (floor ts/86400000) → close price USD
    try {
      const MAX_SIG_PAGES = 5;
      const allSigs = [];
      let before = undefined;
      for (let page = 0; page < MAX_SIG_PAGES; page++) {
        const params = before ? [mint, { limit: 1000, before }] : [mint, { limit: 1000 }];
        const sigsRes = await rpcCall(`autopsy-mint-sigs-${page}`, "getSignaturesForAddress", params);
        const sigs = sigsRes?.result || [];
        if (sigs.length === 0) break;
        allSigs.push(...sigs);
        if (sigs.length < 1000) break;
        before = sigs[sigs.length - 1].signature;
      }
      const truncated = allSigs.length >= MAX_SIG_PAGES * 1000;
      // Hoist for Phase 2F (P&L engine).
      lifetimeAllSigs = allSigs;

      let genesisTimestamp = null;
      let genesisSig = null;
      if (allSigs.length > 0) {
        const oldest = allSigs[allSigs.length - 1];
        genesisTimestamp = oldest.blockTime ? oldest.blockTime * 1000 : null;
        genesisSig = oldest.signature;
      }

      // Sample signatures across the lifetime to fetch parsed details for.
      // Sampling instead of fetching all 5000 keeps response time reasonable
      // while still surfacing major events across the token's history.
      const sample = new Set();
      if (allSigs.length > 0) {
        // Oldest 10 (around launch — where mint events and initial LP add live)
        for (let i = Math.max(0, allSigs.length - 10); i < allSigs.length; i++) {
          sample.add(allSigs[i].signature);
        }
        // Most recent 10 (current activity)
        for (let i = 0; i < Math.min(10, allSigs.length); i++) {
          sample.add(allSigs[i].signature);
        }
        // 20 evenly-spaced middle samples
        if (allSigs.length > 40) {
          const step = Math.floor(allSigs.length / 22);
          for (let i = 1; i < 21; i++) {
            const idx = step * i;
            if (idx < allSigs.length) sample.add(allSigs[idx].signature);
          }
        }
      }
      const sampleArr = [...sample];

      // Batch-fetch parsed transactions via Helius Enhanced API (one call, up
      // to 100 sigs at a time — way faster than getTransaction one-by-one).
      let parsedTxs = [];
      if (sampleArr.length > 0) {
        try {
          const heliusUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
          const parsedRes = await fetch(heliusUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: sampleArr.slice(0, 100) })
          });
          const data = await parsedRes.json();
          if (Array.isArray(data)) parsedTxs = data;
        } catch (e) {
          console.warn("[AUTOPSY] Helius enhanced parse failed:", e.message);
        }
      }

      // Classify each parsed tx — mint events, burns, large transfers
      const events = [];
      for (const tx of parsedTxs) {
        if (!tx || tx.transactionError) continue;
        const ts = tx.timestamp ? tx.timestamp * 1000 : null;
        // Token mint events targeting OUR mint = potential dilution
        if (tx.type === "TOKEN_MINT" && Array.isArray(tx.tokenTransfers)) {
          for (const tt of tx.tokenTransfers) {
            if (tt.mint === mint) {
              events.push({
                type: "MINT_EVENT",
                timestamp: ts,
                signature: tx.signature,
                amount: tt.tokenAmount,
                to: tt.toUserAccount,
                description: `${Number(tt.tokenAmount || 0).toLocaleString()} ${symbol} minted${tt.toUserAccount ? ` to ${tt.toUserAccount.slice(0, 6)}…` : ""}`
              });
            }
          }
        }
        // Burn events
        if (tx.type === "BURN" || tx.type === "TOKEN_BURN") {
          if (Array.isArray(tx.tokenTransfers)) {
            for (const tt of tx.tokenTransfers) {
              if (tt.mint === mint) {
                events.push({
                  type: "BURN_EVENT",
                  timestamp: ts,
                  signature: tx.signature,
                  amount: tt.tokenAmount,
                  description: `${Number(tt.tokenAmount || 0).toLocaleString()} ${symbol} burned`
                });
              }
            }
          }
        }
        // Large transfers — >1% of supply moved in a single tx
        if (supplyTokens > 0 && Array.isArray(tx.tokenTransfers)) {
          for (const tt of tx.tokenTransfers) {
            if (tt.mint === mint && tt.tokenAmount > supplyTokens * 0.01) {
              events.push({
                type: "LARGE_TRANSFER",
                timestamp: ts,
                signature: tx.signature,
                amount: tt.tokenAmount,
                from: tt.fromUserAccount,
                to: tt.toUserAccount,
                description: `${((tt.tokenAmount / supplyTokens) * 100).toFixed(2)}% of supply moved${tt.fromUserAccount ? ` from ${tt.fromUserAccount.slice(0, 6)}…` : ""}${tt.toUserAccount ? ` to ${tt.toUserAccount.slice(0, 6)}…` : ""}`
              });
            }
          }
        }
      }

      // Always include the genesis as the bottom event
      if (genesisTimestamp) {
        events.push({
          type: "GENESIS",
          timestamp: genesisTimestamp,
          signature: genesisSig,
          description: `${symbol} mint created on Solana`
        });
      }

      // Dedupe by signature, sort newest-first, cap at 15
      const seenSigs = new Set();
      const keyEvents = events
        .filter(e => e.timestamp && e.signature && !seenSigs.has(e.signature) && seenSigs.add(e.signature))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 15);

      const postGenesisMints = keyEvents.filter(e => e.type === "MINT_EVENT");
      if (postGenesisMints.length > 0) {
        redFlags.push(`${postGenesisMints.length} post-launch mint event(s) detected — the mint authority was actively used to print supply after launch.`);
      }

      // Detect whether the token went through a bonding-curve phase before
      // its DEX pool existed. Bags.fm tokens graduate from Meteora DBC; Pump.fun
      // tokens graduate from their own bonding curve program. Critically, we
      // restrict detection to the OLDEST sampled txs — checking all sampled txs
      // produces false positives because Jupiter aggregator sometimes routes
      // post-graduation trades through PumpSwap's AMM, which is NOT the same as
      // the token having had a Pump.fun bonding curve.
      const BAGS_DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";       // Meteora DBC (Bags bonding curve)
      const PUMP_FUN_BC = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";    // Pump.fun bonding curve program
      // Sort sampled parsed txs by timestamp ascending, only check the oldest
      // 15 (genesis era) for bonding-curve program activity.
      const earlyTxs = parsedTxs
        .filter(t => t && t.timestamp)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, 15);
      let bondingCurveDetected = false;
      let bondingCurveSource = null;
      for (const tx of earlyTxs) {
        const accounts = tx?.accountData || [];
        const instructions = tx?.instructions || [];
        const checkSet = new Set();
        accounts.forEach(a => a?.account && checkSet.add(a.account));
        instructions.forEach(ix => ix?.programId && checkSet.add(ix.programId));
        if (checkSet.has(BAGS_DBC)) { bondingCurveDetected = true; bondingCurveSource = "Bags.fm (Meteora DBC)"; break; }
        if (checkSet.has(PUMP_FUN_BC)) { bondingCurveDetected = true; bondingCurveSource = "Pump.fun"; break; }
      }

      // --- Total burned aggregation (cumulative, from sampled events) ---
      const burnedFromEvents = keyEvents
        .filter(e => e.type === "BURN_EVENT")
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);

      // --- Airdrop / dust-drop detection ---
      // A single tx with many tokenTransfers from the SAME source = a bulk
      // distribution event. We classify each by recipient count and per-recipient
      // amount: dust drops (tiny amounts, designed to inflate holder count) vs
      // real airdrops (meaningful amounts to many wallets).
      const airdropEvents = [];
      for (const tx of parsedTxs) {
        if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
        const mineForMint = tx.tokenTransfers.filter(tt => tt && tt.mint === mint);
        if (mineForMint.length < 5) continue; // need at least 5 transfers to call it bulk
        const bySource = {};
        for (const tt of mineForMint) {
          if (!tt.fromUserAccount) continue;
          (bySource[tt.fromUserAccount] = bySource[tt.fromUserAccount] || []).push(tt);
        }
        for (const [src, transfers] of Object.entries(bySource)) {
          if (transfers.length < 5) continue;
          const totalAmount = transfers.reduce((s, tt) => s + (Number(tt.tokenAmount) || 0), 0);
          const avgPerRecipient = totalAmount / transfers.length;
          const sharePerRecipient = supplyTokens > 0 ? avgPerRecipient / supplyTokens : 0;
          // Dust drop: each recipient gets less than 0.0001% of supply
          const kind = sharePerRecipient < 0.000001 ? "dust" : "airdrop";
          airdropEvents.push({
            timestamp: tx.timestamp ? tx.timestamp * 1000 : null,
            signature: tx.signature,
            source: src,
            recipients: transfers.length,
            totalAmount,
            avgPerRecipient,
            kind,
          });
        }
      }
      const dustDropCount = airdropEvents.filter(a => a.kind === "dust").length;
      if (dustDropCount > 0) {
        const totalDustRecipients = airdropEvents.filter(a => a.kind === "dust").reduce((s, a) => s + a.recipients, 0);
        redFlags.push(`${dustDropCount} dust-drop event(s) detected (~${totalDustRecipients} dust recipients) — pattern often used to inflate holder count artificially.`);
      }

      // --- Creator wallet detection ---
      // Use the fee payer of the genesis transaction as the creator wallet
      // proxy. Helius enhanced parsed txs include the feePayer field.
      let creatorWallet = null;
      if (genesisSig) {
        const genesisTx = parsedTxs.find(t => t?.signature === genesisSig);
        if (genesisTx?.feePayer) creatorWallet = genesisTx.feePayer;
      }

      lifetime = {
        genesisTimestamp,
        genesisSignature: genesisSig,
        totalKnownSignatures: allSigs.length,
        signatureHistoryTruncated: truncated,
        keyEvents,
        bondingCurveDetected,
        bondingCurveSource,
        totalBurnedObserved: burnedFromEvents,
        airdropEvents,
        creatorWallet,
      };
    } catch (e) {
      console.warn("[AUTOPSY] lifetime analysis failed:", e.message);
    }

    // --- Phase 2B: Historical price + market cap via GeckoTerminal OHLCV ---
    // DexScreener gives us current snapshot. GeckoTerminal lets us pull daily
    // candles across the lifetime — we use that to find the peak price/MC and
    // the drawdown to "now," which is the missing context that turns a number
    // into a story.
    if (topPair && topPair.pairAddress) {
      try {
        const gtUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${topPair.pairAddress}/ohlcv/day?aggregate=1&limit=365`;
        const gtRes = await fetch(gtUrl);
        const gtData = await gtRes.json();
        const candles = gtData?.data?.attributes?.ohlcv_list || [];
        if (candles.length > 0) {
          // Each candle = [timestamp_seconds, open, high, low, close, volume]
          // Use the daily CLOSE (where price actually settled) not the daily HIGH
          // (which can be a single-tick spike during a thin candle). The close
          // is what the token genuinely traded at by end of that day — the
          // honest forensic answer to "what was the peak."
          let peakPrice = 0, peakTs = 0;
          for (const c of candles) {
            const close = Number(c[4]) || 0;
            const tsSec = Number(c[0]) || 0;
            if (close > peakPrice) { peakPrice = close; peakTs = tsSec * 1000; }
            // Stash for Phase 2F P&L valuation — index by UTC day key.
            if (tsSec > 0 && close > 0) {
              const dayKey = Math.floor((tsSec * 1000) / 86400000);
              priceCandlesByDay.set(dayKey, close);
            }
          }
          const currentPrice = priceUsd || (candles[0] && Number(candles[0][4])) || 0;
          const drawdownPct = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice) * 100 : null;
          const peakMarketCap = supplyTokens > 0 && peakPrice > 0 ? peakPrice * supplyTokens : null;
          // Multi-window volume sums from the same daily candles we already
          // walked above — no extra API call. This gives an honest "is this
          // token actually being traded over a longer window" signal so a
          // single quiet 24h doesn't make a healthy token look UNCLEAR. We
          // bucket by candle age in ms rather than array index because
          // GeckoTerminal's return order isn't documented and can drift.
          const nowMs = Date.now();
          let vol24h = 0, vol48h = 0, vol7d = 0, vol30d = 0;
          for (const c of candles) {
            const tsMs = (Number(c[0]) || 0) * 1000;
            const volUsd = Number(c[5]) || 0;
            const ageMs = nowMs - tsMs;
            if (ageMs < 0) continue;
            if (ageMs <= 1 * 86400000)  vol24h += volUsd;
            if (ageMs <= 2 * 86400000)  vol48h += volUsd;
            if (ageMs <= 7 * 86400000)  vol7d  += volUsd;
            if (ageMs <= 30 * 86400000) vol30d += volUsd;
          }
          priceHistory = {
            peakPrice,
            peakTimestamp: peakTs,
            peakMarketCap,
            currentPrice,
            drawdownFromPeakPct: drawdownPct,
            candleCount: candles.length,
            // Multi-window volume context. Use these to spot tokens that
            // look quiet today but are clearly trading over the week or
            // month. Verdict ladder uses vol7d to promote UNCLEAR → ALIVE
            // when there's real cumulative activity.
            volumeWindows: { vol24h, vol48h, vol7d, vol30d },
          };
          if (drawdownPct !== null && drawdownPct < -90 && peakPrice > 0) {
            redFlags.push(`Down ${drawdownPct.toFixed(0)}% from all-time high — price has effectively collapsed from peak.`);
          } else if (drawdownPct !== null && drawdownPct < -70 && peakPrice > 0) {
            redFlags.push(`Down ${drawdownPct.toFixed(0)}% from all-time high — significant retracement.`);
          }
        }
      } catch (e) {
        console.warn("[AUTOPSY] GeckoTerminal OHLCV failed:", e.message);
      }
    }

    // --- Verdict re-classification with priceHistory in hand ---
    // The first-pass verdict couldn't see drawdown-from-peak. Now we can.
    // Upgrade a generic UNCLEAR / SOFT_RUG to RETRACED when the token is
    // still trading at a real market cap but is heavily off its highs — the
    // honest framing for "I know it went really high but is it really that bad?"
    if (
      priceHistory && priceHistory.drawdownFromPeakPct !== null &&
      priceHistory.drawdownFromPeakPct < -70 &&
      totalLiqUsd >= 500 &&
      (marketCap === null || marketCap > 25000) &&
      (verdict.type === "UNCLEAR" || verdict.type === "SOFT_RUG" || verdict.type === "AT_RISK")
    ) {
      verdict = { type: "RETRACED", label: "Status: HEAVILY RETRACED — STILL TRADING", severity: "AT_RISK", color: "#F59E0B", icon: "📉" };
      // Refresh report mode for the upgraded verdict.
      reportMode = "health-assessment";
      reportHeadline = "📉 AUTOPSY ON STANDBY";
      reportSubhead = "Patient is alive but heavily bruised. Health Assessment of a token in a drawdown.";
    }

    // --- Verdict promotion: low 24h volume but healthy weekly trading ---
    // The first-pass ALIVE rule requires DexScreener 24h volume ≥ $100, which
    // mislabels two kinds of token as UNCLEAR:
    //  1. A healthy token after a single quiet day (7d volume is fine).
    //  2. A FRESH graduating pump.fun token DexScreener hasn't indexed yet —
    //     it shows $0 DexScreener liquidity/volume even while trading heavily
    //     on its new pool (we see the real volume via GeckoTerminal candles).
    // Promote UNCLEAR → ALIVE when EITHER:
    //  • vol7d is substantial (≥ $5k) — that volume PROVES liquidity exists
    //    (you can't trade $5k+/wk against nothing), so missing DexScreener
    //    liquidity data doesn't mean the token is dead; OR
    //  • vol7d ≥ $700 AND DexScreener confirms liquidity ≥ $5k (the original
    //    quiet-day case).
    const vw = priceHistory && priceHistory.volumeWindows;
    if (
      vw && verdict.type === "UNCLEAR" && (
        vw.vol7d >= 5000 ||
        (vw.vol7d >= 700 && totalLiqUsd >= 5000)
      )
    ) {
      verdict = { type: "ALIVE", label: "Status: ALIVE & TRADING", severity: "ALIVE", color: "#10B981", icon: "🐔" };
      reportMode = "health-checkup";
      reportHeadline = "🚫 AUTOPSY CANCELED";
      reportSubhead = "Patient is alive and trading. Full Health Checkup of a token doing fine.";
    }
    // Refresh lessons after potential verdict upgrade.
    const lessonsFinal = lessonMap[verdict.type] || lessons;

    // --- Phase 2A: Top Holders Forensic Panel ---
    // Take the top 10 token accounts and:
    //   1) Look up each token account's "authority" (.data.parsed.info.owner)
    //   2) Look up that authority's program-owner — System Program = human wallet;
    //      a DEX program = LP; a known locker program = locked; the SPL Token
    //      program itself = self-owned lock (permanent).
    //   3) For human-wallet holders, walk their token account's signature history,
    //      grab the OLDEST signature (their first interaction with this token),
    //      and fetch that transaction to find how much they first received.
    //   4) Classify acquisition timing (sniper / very_early / early / first_week
    //      / later) vs the token's pool-creation timestamp, and behavior
    //      (HELD / ACCUMULATED / REDUCED / EXITED_MOSTLY) by comparing the
    //      first-received amount to their current balance.
    const AUTOPSY_SYS_PROGRAM = "11111111111111111111111111111111";
    let topHolders = [];
    const holderBreakdown = { sniper: 0, very_early: 0, early: 0, first_week: 0, later: 0, pre_pool: 0, bonding_curve: 0, locker: 0, lp: 0, selflock: 0, program: 0 };
    // Hoisted: bagsInfo / pumpInfo are populated later (Phase 2D / 2E) but
    // bondingCurveActive needs the references here. Avoid TDZ by declaring early.
    let bagsInfo = null;
    let creatorVerification = null;   // Bags creator social-verification signal (set once bagsInfo resolves)
    let pumpInfo = null;
    const dbcBuyerSet = new Set();
    // Bags/Pump-verified bonding curve gets priority over the on-chain heuristic.
    // Read as a function so it picks up bagsInfo/pumpInfo once they're populated.
    // Did this token launch through a bonding curve (Bags DBC / Pump.fun)?
    // If so, holders who acquired "before the DEX pool" bought ON THE CURVE
    // before graduation — a legitimate early-buyer path, NOT pre-launch
    // insiders. lifetime.bondingCurveDetected is unreliable (only fires if the
    // sampled sig-walk happened to catch the DBC program), so we also trust
    // the mint-suffix vanity conventions: Pump.fun mints end "pump", Bags
    // mints commonly end "BAGS". Either is definitive enough to treat
    // pre-pool acquisition as bonding-curve buying, not insider allocation.
    const MINT_LOWER = (mint || "").toLowerCase();
    const isLaunchpadMint = MINT_LOWER.endsWith("pump") || MINT_LOWER.endsWith("bags") || MINT_LOWER.endsWith("bonk") || MINT_LOWER.endsWith("moon");
    const bondingCurveActive = () => !!(lifetime && lifetime.bondingCurveDetected)
      || !!(bagsInfo && bagsInfo.dbcBuyersIdentified > 0)
      || !!(pumpInfo && pumpInfo.bcBuyersIdentified > 0)
      || isLaunchpadMint;
    const behaviorBreakdown = { HELD: 0, ACCUMULATED: 0, REDUCED: 0, EXITED_MOSTLY: 0, UNKNOWN: 0 };
    let lockedSupplyShare = 0;
    // Authoritative locked-token COUNT from holder classification. This is
    // the reliable source — it sums actual current balances held in locker
    // PDAs (Jupiter Lock / Streamflow / self-owned locks), unlike the Phase
    // 2G creator-trace which only catches lock DEPOSITS the creator wallet
    // made inside our signature scan window (and badly under-counts: 60M
    // traced vs 145M actually locked for CLKN). The /api/locks endpoint
    // can't be used here — it queries by owner=JUPITER_LOCK_PROGRAM which
    // returns 0 because Jupiter Lock holds tokens in PDAs, not under the
    // program ID directly.
    let lockedSupplyTokens = 0;
    let humanSupplyShare = 0;
    try {
      const TOP_N = 100;
      const targets = largestRaw.slice(0, TOP_N);
      if (targets.length > 0) {
        // Step 1: Authority is already on each largestRaw entry (a.owner) —
        // skipped the per-token-account RPC because getTokenAccounts gave us
        // the wallet directly.
        const authorities = targets.map(a => a.owner);

        // Step 2: Authority → program owner (so we can classify). For 100
        // wallets that's potentially many getMultipleAccounts batches —
        // chunked into 100s as the RPC accepts.
        const uniqueAuths = [...new Set(authorities.filter(Boolean))];
        const authOwnerMap = new Map();
        for (let i = 0; i < uniqueAuths.length; i += 100) {
          const chunk = uniqueAuths.slice(i, i + 100);
          try {
            const authRes = await rpcCall(`autopsy-auths-${i}`, "getMultipleAccounts", [
              chunk, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
            ]);
            const authInfos = authRes?.result?.value || [];
            chunk.forEach((a, j) => authOwnerMap.set(a, authInfos[j]?.owner || null));
          } catch (e) {
            console.warn(`[AUTOPSY] auth batch ${i} failed:`, e.message);
          }
        }

        // Helper: determine if a pubkey is on the ed25519 curve (real wallet)
        // vs off-curve (a program-derived address / PDA). Matches the engine
        // the Holders tool uses to distinguish AMM pool-authority PDAs from
        // human wallets when both look "System Program owned" to a naive read.
        const isOnCurveSafe = (pk) => { try { return isOnCurve(pk); } catch { return false; } };

        topHolders = targets.map((acc, i) => {
          const auth = authorities[i];
          const authOwner = auth ? authOwnerMap.get(auth) : null;
          const uiAmount = parseFloat(acc.uiAmount) || 0;
          const share = supplyTokens > 0 ? uiAmount / supplyTokens : 0;
          let category, label;
          if (!auth) { category = "unknown"; label = "Unknown"; }
          // The full LP-vs-wallet logic, matching what the Holders engine does:
          //   on-curve = real ed25519 keypair → human wallet
          //   off-curve + (no account OR System-Program owned) → pool-authority PDA / LP
          //   off-curve + program owned → that program (locker / DEX / other)
          // An on-curve wallet with no account info just means it has never paid
          // for a SOL transaction (received tokens but no SOL itself) — still
          // a human wallet, NOT an LP.
          else if (!authOwner &&  isOnCurveSafe(auth)) { category = "wallet"; label = "Human wallet"; }
          else if (!authOwner && !isOnCurveSafe(auth)) { category = "lp";     label = "Liquidity pool"; }
          else if (authOwner === AUTOPSY_SYS_PROGRAM && !isOnCurveSafe(auth)) { category = "lp";     label = "Liquidity pool"; }
          else if (authOwner === AUTOPSY_SYS_PROGRAM) { category = "wallet"; label = "Human wallet"; }
          else if (DEX_PROGRAMS.has(authOwner)) { category = "lp"; label = PROGRAM_LABELS[authOwner] || "Liquidity pool"; }
          else if (LOCKER_PROGRAMS.has(authOwner)) { category = "locker"; label = PROGRAM_LABELS[authOwner] || "Token lock"; }
          else if (TOKEN_PROGRAMS.has(authOwner)) { category = "selflock"; label = "Self-owned lock (permanent)"; }
          else { category = "program"; label = PROGRAM_LABELS[authOwner] || "Program account"; }
          if (category === "locker" || category === "selflock") { lockedSupplyShare += share; lockedSupplyTokens += uiAmount; }
          if (category === "wallet") humanSupplyShare += share;
          return {
            rank: i + 1,
            tokenAccount: acc.address,
            authority: auth,
            uiAmount,
            share,
            category, label,
            firstAcquiredAt: null,
            firstAcquiredAmount: null,
            behavior: null,
            acquisitionTiming: null,
            sigCount: null,
          };
        });

        // Step 3: For each wallet holder, walk their token-account history (parallel)
        const walletHolders = topHolders.filter(h => h.category === "wallet");
        await Promise.allSettled(walletHolders.map(async (h, idx) => {
          try {
            const sigsRes = await rpcCall(`autopsy-sigs-${idx}`, "getSignaturesForAddress", [
              h.tokenAccount, { limit: 1000 }
            ]);
            const sigs = sigsRes?.result || [];
            h.sigCount = sigs.length;
            if (sigs.length === 0) return;
            const oldestSig = sigs[sigs.length - 1];
            h.firstAcquiredAt = oldestSig.blockTime ? oldestSig.blockTime * 1000 : null;
            h.firstAcquiredSignature = oldestSig.signature; // for acquisition-source attribution below
            // Acquisition timing vs pool launch
            if (h.firstAcquiredAt && pairCreatedMs) {
              const dms = h.firstAcquiredAt - pairCreatedMs;
              if (dms < -60_000) {
                // Had tokens before the current DEX pool existed. If the token
                // had a Bags/Pump bonding-curve phase, this means they bought
                // through the bonding curve (a legitimate early-supporter path,
                // not necessarily an insider pre-allocation).
                h.acquisitionTiming = bondingCurveActive() ? "bonding_curve" : "pre_pool";
              }
              else if (dms < 60_000) h.acquisitionTiming = "sniper";
              else if (dms < 3_600_000) h.acquisitionTiming = "very_early";
              else if (dms < 86_400_000) h.acquisitionTiming = "early";
              else if (dms < 7 * 86_400_000) h.acquisitionTiming = "first_week";
              else h.acquisitionTiming = "later";
            }
            // BAGS-VERIFIED OVERRIDE: if this wallet appears in the DBC pool's
            // buyer set (a fact, not an inference), upgrade their label from
            // "pre_pool"/"later" to "bonding_curve" with a verified flag.
            if (dbcBuyerSet.has(h.authority)) {
              h.dbcVerified = true;
              h.acquisitionTiming = "bonding_curve";
            }
            // Fetch first tx to read first-received amount
            const txRes = await rpcCall(`autopsy-tx-${idx}`, "getTransaction", [
              oldestSig.signature,
              { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }
            ]);
            const tx = txRes?.result;
            if (tx?.meta?.postTokenBalances) {
              const accountKeys = tx.transaction?.message?.accountKeys || [];
              const post = tx.meta.postTokenBalances.find(b => {
                const k = accountKeys[b.accountIndex];
                const kStr = typeof k === "string" ? k : k?.pubkey;
                return kStr === h.tokenAccount;
              });
              if (post?.uiTokenAmount) h.firstAcquiredAmount = parseFloat(post.uiTokenAmount.uiAmount) || 0;
            }
            if (h.firstAcquiredAmount !== null && h.firstAcquiredAmount > 0) {
              const ratio = h.uiAmount / h.firstAcquiredAmount;
              if (ratio >= 1.10) h.behavior = "ACCUMULATED";
              else if (ratio >= 0.90) h.behavior = "HELD";
              else if (ratio >= 0.10) h.behavior = "REDUCED";
              else h.behavior = "EXITED_MOSTLY";
            } else {
              h.behavior = "UNKNOWN";
            }
          } catch (e) {
            console.warn(`[AUTOPSY] holder rank ${h.rank} walk failed:`, e.message);
          }
        }));

        // Aggregate breakdowns + extra red flags
        topHolders.forEach(h => {
          if (h.acquisitionTiming && holderBreakdown[h.acquisitionTiming] !== undefined) holderBreakdown[h.acquisitionTiming]++;
          if (h.category === "locker") holderBreakdown.locker++;
          if (h.category === "lp") holderBreakdown.lp++;
          if (h.category === "selflock") holderBreakdown.selflock++;
          if (h.category === "program") holderBreakdown.program++;
          if (h.behavior && behaviorBreakdown[h.behavior] !== undefined) behaviorBreakdown[h.behavior]++;
        });
        if (behaviorBreakdown.EXITED_MOSTLY >= 3) redFlags.push(`${behaviorBreakdown.EXITED_MOSTLY} of the top 10 holders have sold most of their original position — distribution pattern.`);
        if (holderBreakdown.sniper >= 4) {
          // Honesty: "insider entry" asserts team coordination we can't prove
          // from timing alone (snipers are usually bots/public). And on a
          // launchpad token, buying within a minute of the pool is often just
          // early bonding-curve buying, not graduation-sniping. Word it for
          // what it is — concentrated early entry — and name the launchpad case.
          const launchpad = bondingCurveActive() || isLaunchpadMint;
          const lp = MINT_LOWER.endsWith("pump") ? "Pump.fun" : "launchpad";
          redFlags.push(launchpad
            ? `${holderBreakdown.sniper} of the top 10 bought within the first minute — concentrated early entry. On a ${lp} token this is typically early bonding-curve buyers or snipers/bots, NOT proof of team or insider coordination.`
            : `${holderBreakdown.sniper} of the top 10 bought within the first minute — heavy early concentration (snipers/bots or coordinated entry; on-chain timing alone can't tell which).`);
        }
        if (holderBreakdown.locker + holderBreakdown.selflock === 0 && verdict.type !== "ALIVE" && verdict.type !== "AT_RISK") redFlags.push("None of the top 10 holdings are in a recognized lock — no enforced supply restrictions.");
      }
    } catch (err) {
      console.warn("[AUTOPSY] top-holder analysis failed:", err.message);
    }

    // --- Phase 2D: Bags.fm API deep integration ---
    // For Bags.fm tokens we can pull official metadata + creators + the DBC
    // (bonding-curve) pool key. Walking the DBC pool's signatures gives us
    // VERIFIED bonding-curve buyer wallets — replacing the "had tokens before
    // the DEX pool = bonding curve buyer" inference with hard fact.
    // bagsInfo + dbcBuyerSet hoisted above for TDZ; reuse them here.
    const BAGS_API_KEY = process.env.BAGS_API_KEY;
    if (BAGS_API_KEY) {
      // Initialize an empty bagsInfo upfront. Any single Bags endpoint
      // returning real data is enough to confirm this is a Bags token —
      // do NOT gate the integration on a single endpoint (token-launch/info
      // currently 404s for some mints, including CLKN, and was blocking
      // everything downstream).
      const bagsCandidate = {
        isBagsToken: false,
        name: null,
        symbol: null,
        status: null,
        launchSignature: null,
        officialCreators: [],
        dbcPoolKey: null,
        dammV2PoolKey: null,
        dbcSignaturesScanned: 0,
        dbcBuyersIdentified: 0,
      };

      // 1) Official creators — the most important call. If this returns
      // creators, we know it's a Bags token AND we have the operational
      // wallets.
      try {
        const r = await bagsFetch(`token-launch/creator/v3?tokenMint=${mint}`, BAGS_API_KEY);
        console.log(`[AUTOPSY] Bags creator/v3 status=${r.status} bodyHead=${(r.text || "").slice(0, 300)}`);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const creators = (Array.isArray(parsed) && parsed)
            || (Array.isArray(parsed?.response) && parsed.response)
            || (Array.isArray(parsed?.response?.creators) && parsed.response.creators)
            || (Array.isArray(parsed?.creators) && parsed.creators)
            || (Array.isArray(parsed?.data) && parsed.data)
            || null;
          if (creators && creators.length > 0) {
            bagsCandidate.officialCreators = creators.map(c => {
              const provider = c.provider || c.socialProvider || null;
              const username = c.providerUsername || c.username || c.handle || c.twitterUsername || null;
              return {
                wallet: c.wallet || c.walletAddress || c.walletPubkey || c.creatorWallet || null,
                provider,
                username,
                twitterUsername: c.twitterUsername || (provider === "twitter" ? username : null),
                // Bags only surfaces a social identity for wallets with a VERIFIED
                // linked profile — so a provider+handle present here = verified.
                verified: !!(provider && username),
                isAdmin: !!c.isAdmin,
                royaltyBps: c.royaltyBps ?? c.royaltyBasisPoints ?? null,
              };
            }).filter(c => c.wallet);
            if (bagsCandidate.officialCreators.length > 0) {
              bagsCandidate.isBagsToken = true;
              console.log(`[AUTOPSY] Bags creator/v3 parsed ${bagsCandidate.officialCreators.length} creators: ${bagsCandidate.officialCreators.map(c => c.wallet.slice(0,8) + "…").join(", ")}`);
            }
          } else {
            console.warn(`[AUTOPSY] Bags creator/v3 returned 200 but no creators array found.`);
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Bags creator/v3 failed:", e.message); }

      // 2) Token launch info — best-effort. May 404 for some mints; if it
      // works, it gives us name/symbol/status/launchSignature.
      try {
        const r = await bagsFetch(`token-launch/info?tokenMint=${mint}`, BAGS_API_KEY);
        console.log(`[AUTOPSY] Bags info status=${r.status}`);
        if (r.status === 200) {
          const parsed = JSON.parse(r.text);
          const info = parsed?.response?.token || parsed?.response || parsed;
          if (info && (info.tokenMint || info.status || info.launchSignature || info.symbol || info.name)) {
            bagsCandidate.isBagsToken = true;
            bagsCandidate.name = info.name || bagsCandidate.name;
            bagsCandidate.symbol = info.symbol || bagsCandidate.symbol;
            bagsCandidate.status = info.status || bagsCandidate.status;
            bagsCandidate.launchSignature = info.launchSignature || bagsCandidate.launchSignature;
            if (info.dbcPoolKey) bagsCandidate.dbcPoolKey = info.dbcPoolKey;
            if (info.dammV2PoolKey) bagsCandidate.dammV2PoolKey = info.dammV2PoolKey;
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Bags token-launch/info failed:", e.message); }

      // Adopt the candidate if any signal confirms it's a Bags token.
      if (bagsCandidate.isBagsToken) {
        bagsInfo = bagsCandidate;
      }

      if (bagsInfo) {

        // Creator social-verification signal. Bags only surfaces a social
        // identity for fee wallets with a VERIFIED linked profile, so an
        // official creator carrying a provider+handle = verified/accountable;
        // a Bags token whose creators are all wallet-only = anonymous fee
        // earners. Bags-confirmed identity → we can assert it (forensic rule).
        const ocs = bagsInfo.officialCreators || [];
        if (ocs.length) {
          const verified = ocs.filter(c => c.verified && c.username);
          creatorVerification = {
            status: verified.length ? "verified" : "anonymous",
            verifiedCount: verified.length,
            totalCreators: ocs.length,
            handles: verified.map(c => ({ provider: c.provider, username: c.username })),
          };
        }

        // 3) Pool info — DBC + DAMM V2 pool keys
        try {
          const r = await bagsFetch(`token-launch/pool-info?tokenMint=${mint}`, BAGS_API_KEY);
          console.log(`[AUTOPSY] Bags pool-info status=${r.status}`);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const info = parsed?.response || parsed;
            if (info) {
              // Only overwrite when the call returns a real value — don't
              // clobber a key we already learned from token-launch/info.
              if (info.dbcPoolKey) bagsInfo.dbcPoolKey = info.dbcPoolKey;
              if (info.dammV2PoolKey) bagsInfo.dammV2PoolKey = info.dammV2PoolKey;
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags pool-info failed:", e.message); }

        // 3b) Lifetime fees — total project revenue claimed to date.
        // Forensic signal: how much have the registered creator wallets
        // actually extracted? A high number + recent activity = active project
        // operating off creator-fee revenue; zero or stale = abandoned launch.
        bagsInfo.lifetimeFeesSol = null;
        try {
          const r = await bagsFetch(`token-launch/lifetime-fees?tokenMint=${mint}`, BAGS_API_KEY);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const data = parsed?.success ? parsed.response : parsed;
            // Bags returns lifetime fees in lamports under various field names
            // depending on the response shape — be tolerant.
            const lamports = data?.lifetimeFees ?? data?.totalFees ?? data?.amount ?? null;
            if (lamports !== null && Number.isFinite(Number(lamports))) {
              bagsInfo.lifetimeFeesSol = Number(lamports) / 1e9;
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags lifetime-fees failed:", e.message); }

        // 3c) Claim events — itemized history of fee claims. Used to compute
        // claim count + last-claim timestamp ("when did the team last touch
        // their revenue?") which separates active from abandoned projects.
        // Bags returns events in chronological order (oldest first) so a
        // single page of 100 can hide recent claims for active wallets that
        // have claimed >100 times. Paginate up to 5 pages = 500 events to
        // catch the actual most-recent claim.
        bagsInfo.claimEventCount = 0;
        bagsInfo.lastClaimTimestamp = null;
        bagsInfo.totalClaimedSol = null;
        try {
          let allEvents = [];
          for (let page = 0; page < 5; page++) {
            const offset = page * 100;
            const r = await bagsFetch(`fee-share/token/claim-events?tokenMint=${mint}&mode=offset&limit=100&offset=${offset}`, BAGS_API_KEY);
            if (r.status !== 200) break;
            const parsed = JSON.parse(r.text);
            const events = parsed?.success && parsed.response && Array.isArray(parsed.response.events)
              ? parsed.response.events : [];
            if (events.length === 0) break;
            allEvents.push(...events);
            if (events.length < 100) break;
          }
          bagsInfo.claimEventCount = allEvents.length;
          let totalLamports = 0;
          let latestTs = 0;
          for (const ev of allEvents) {
            const amt = Number(ev.amount);
            if (Number.isFinite(amt)) totalLamports += amt;
            let ts = ev.timestamp;
            if (typeof ts === "number" || /^\d+$/.test(String(ts))) {
              let n = Number(ts);
              if (n < 1e12) n *= 1000;
              if (n > latestTs) latestTs = n;
            }
          }
          if (totalLamports > 0) bagsInfo.totalClaimedSol = totalLamports / 1e9;
          if (latestTs > 0) bagsInfo.lastClaimTimestamp = latestTs;
          console.log(`[AUTOPSY] Bags claim-events: count=${allEvents.length} totalClaimedSol=${totalLamports / 1e9} latestTs=${latestTs ? new Date(latestTs).toISOString() : "—"}`);
        } catch (e) { console.warn("[AUTOPSY] Bags claim-events failed:", e.message); }

        // 3d) Claim STATS — per-claimer breakdown. Tells us EXACTLY which
        // wallet claimed how much SOL across the lifetime, along with their
        // username/social handle. More precise than creator/v3 (which only
        // shows registered shares; this shows actual collected amounts).
        bagsInfo.claimers = [];
        try {
          const r = await bagsFetch(`token-launch/claim-stats?tokenMint=${mint}`, BAGS_API_KEY);
          if (r.status === 200) {
            const parsed = JSON.parse(r.text);
            const claimers = (Array.isArray(parsed?.response) && parsed.response)
              || (Array.isArray(parsed) && parsed)
              || null;
            if (claimers) {
              bagsInfo.claimers = claimers.map(c => ({
                wallet: c.wallet || null,
                username: c.username || c.bagsUsername || c.providerUsername || null,
                provider: c.provider || null,
                twitterUsername: c.twitterUsername || null,
                pfp: c.pfp || null,
                totalClaimedSol: c.totalClaimed != null ? Number(c.totalClaimed) / 1e9 : null,
                royaltyBps: c.royaltyBps ?? null,
                isCreator: !!c.isCreator,
                isAdmin: !!c.isAdmin,
              })).filter(c => c.wallet);
              console.log(`[AUTOPSY] Bags claim-stats: ${bagsInfo.claimers.length} claimers — ${bagsInfo.claimers.map(c => `${c.username || c.wallet.slice(0,6)}=${(c.totalClaimedSol || 0).toFixed(2)}SOL`).join(", ")}`);
            }
          }
        } catch (e) { console.warn("[AUTOPSY] Bags claim-stats failed:", e.message); }

        // 4) Walk the DBC pool's signatures via Helius RPC, batch-parse via
        // Helius Enhanced to identify verified bonding-curve buyer wallets.
        // For each parsed tx, any tokenTransfer FROM dbcPoolKey of OUR mint
        // identifies a real DBC buyer.
        if (bagsInfo.dbcPoolKey) {
          try {
            const dbcSigs = [];
            let dbcBefore = undefined;
            for (let p = 0; p < 2; p++) {
              const params = dbcBefore ? [bagsInfo.dbcPoolKey, { limit: 1000, before: dbcBefore }] : [bagsInfo.dbcPoolKey, { limit: 1000 }];
              const r = await rpcCall(`autopsy-dbc-sigs-${p}`, "getSignaturesForAddress", params);
              const ss = r?.result || [];
              if (ss.length === 0) break;
              dbcSigs.push(...ss);
              if (ss.length < 1000) break;
              dbcBefore = ss[ss.length - 1].signature;
            }
            bagsInfo.dbcSignaturesScanned = dbcSigs.length;
            if (dbcSigs.length > 0) {
              // Sample up to 100 sigs evenly across the lifetime
              const sampled = [];
              const SAMPLE_SIZE = 100;
              const step = Math.max(1, Math.floor(dbcSigs.length / SAMPLE_SIZE));
              for (let i = 0; i < dbcSigs.length; i += step) {
                sampled.push(dbcSigs[i].signature);
                if (sampled.length >= SAMPLE_SIZE) break;
              }
              try {
                const dRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ transactions: sampled })
                });
                const dData = await dRes.json();
                if (Array.isArray(dData)) {
                  for (const tx of dData) {
                    if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
                    for (const tt of tx.tokenTransfers) {
                      if (tt && tt.mint === mint && tt.fromUserAccount === bagsInfo.dbcPoolKey && tt.toUserAccount) {
                        dbcBuyerSet.add(tt.toUserAccount);
                      }
                    }
                  }
                }
                bagsInfo.dbcBuyersIdentified = dbcBuyerSet.size;
              } catch (e) { console.warn("[AUTOPSY] DBC pool parse failed:", e.message); }
            }
          } catch (e) { console.warn("[AUTOPSY] DBC sig walk failed:", e.message); }
        }
      }
    }
    console.log(`[AUTOPSY] Bags integration: ${bagsInfo ? `isBagsToken=true creators=${bagsInfo.officialCreators.length} dbcSigs=${bagsInfo.dbcSignaturesScanned} dbcBuyers=${bagsInfo.dbcBuyersIdentified}` : "not a Bags token"}`);

    // --- Phase 2H: Jupiter independent cross-verification ---
    // Jupiter's v2 token search endpoint returns far more than "is listed".
    // It gives us independent holder count, market data, audit data
    // (mint/freeze authority status from Jupiter's POV), launchpad
    // confirmation, organic-trade score, and devMigrations/devMints —
    // the LATTER is the definitive proof that the on-chain genesis-fee-payer
    // wallet is a platform launcher (a wallet with 1956 migrations is not
    // a project dev). Cross-references all this against our own measurements
    // so the user sees agreement / disagreement.
    let jupiterInfo = null;
    try {
      const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length > 0) {
          const t = data.find(d => d.id === mint) || data[0];
          jupiterInfo = {
            listed: true,
            name: t.name || null,
            symbol: t.symbol || null,
            icon: t.icon || null,
            tags: Array.isArray(t.tags) ? t.tags : [],
            launchpad: t.launchpad || null,
            metaLaunchpad: t.metaLaunchpad || null,
            graduatedAt: t.graduatedAt || null,
            graduatedPool: t.graduatedPool || null,
            holderCount: t.holderCount ?? null,
            fdv: t.fdv ?? null,
            mcap: t.mcap ?? null,
            usdPrice: t.usdPrice ?? null,
            liquidity: t.liquidity ?? null,
            twitter: t.twitter || null,
            telegram: t.telegram || null,
            website: t.website || null,
            stats24h: t.stats24h || null,
            stats6h: t.stats6h || null,
            // Audit block — Jupiter's independent reading of mint/freeze
            // authority status + top-holder concentration + dev-wallet stats.
            audit: t.audit ? {
              mintAuthorityDisabled: !!t.audit.mintAuthorityDisabled,
              freezeAuthorityDisabled: !!t.audit.freezeAuthorityDisabled,
              topHoldersPercentage: t.audit.topHoldersPercentage ?? null,
              devMigrations: t.audit.devMigrations ?? null,
              devMints: t.audit.devMints ?? null,
            } : null,
            organicScore: t.organicScore ?? null,
            organicScoreLabel: t.organicScoreLabel || null,
            // The on-chain "dev" wallet per Jupiter = genesis-tx fee payer.
            // For platform launches (Bags / Pump) this is the PLATFORM wallet,
            // and audit.devMigrations is the smoking gun (thousands of migrations).
            onChainDevPerJupiter: t.dev || null,
          };
        }
      } else if (r.status === 404) {
        jupiterInfo = { listed: false };
      }
    } catch (e) {
      console.warn("[AUTOPSY] Jupiter v2 search failed:", e.message);
    }
    console.log(`[AUTOPSY] Jupiter cross-verify: ${jupiterInfo ? (jupiterInfo.listed ? `holderCount=${jupiterInfo.holderCount} mcap=${jupiterInfo.mcap} tags=${jupiterInfo.tags.join(",")} devMigrations=${jupiterInfo.audit?.devMigrations}` : "not listed") : "no response"}`);

    // --- Phase 2E: Pump.fun frontend API integration ---
    // Symmetric to Bags: pull official metadata + creator + full pre-graduation
    // price history from Pump.fun's unauthenticated frontend API. Then walk
    // the bonding-curve account's signatures for verified buyers (same trick
    // as Bags DBC). Unlike GeckoTerminal which only sees post-graduation data,
    // Pump.fun's chart goes all the way back to mint.
    // pumpInfo hoisted above for TDZ; reuse it here.
    if (!bagsInfo) {
      try {
        const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; CluckNorrisAutopsy/1.0)" },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const data = await r.json();
          if (data && data.mint === mint) {
            pumpInfo = {
              isPumpToken: true,
              name: data.name || null,
              symbol: data.symbol || null,
              createdTimestamp: data.created_timestamp || null,
              creator: data.creator || null,
              complete: !!data.complete, // graduated?
              marketCapUsd: data.usd_market_cap || null,
              raydiumPool: data.raydium_pool || null,
              twitter: data.twitter || null,
              telegram: data.telegram || null,
              website: data.website || null,
              imageUri: data.image_uri || null,
              bondingCurve: data.bonding_curve || null,
              associatedBondingCurve: data.associated_bonding_curve || null,
              bcSignaturesScanned: 0,
              bcBuyersIdentified: 0,
              priceHistory: null,
            };
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Pump.fun coins fetch failed:", e.message); }
    }

    // Synthesized recognition for graduated Pump tokens. Pump's frontend API
    // only serves tokens still on the bonding curve — once a token graduates
    // it 404s, so pumpInfo stays null and the launchpad card never shows even
    // though the mint suffix proves it's a Pump.fun token. Synthesize minimal
    // recognition (it's a Pump token, and graduated since a DEX pool exists)
    // so the card shows its launchpad provenance. Creator is filled in after
    // creator detection from the ST-resolved creator; bonding-curve buyer
    // stats stay 0 (the API that would provide them is gone for graduated
    // tokens — we're honest about that rather than faking it).
    if (!pumpInfo && !bagsInfo && MINT_LOWER.endsWith("pump")) {
      // Graduation status MUST come from a reliable source — NOT from whether
      // GeckoTerminal has candles (it indexes on-curve pump pools too, so
      // price history is NOT proof of graduation). Ask Solana Tracker: a pool
      // with market "pumpfun" is still on the bonding curve. This getTokenInfo
      // call is cached and reused by the creator lookup below — no double fetch.
      let stMarket = null;
      try { stMarket = await solanaTracker.getTokenMarketStatus(mint); } catch (e) { /* degrade */ }
      pumpInfo = {
        isPumpToken: true,
        synthesized: true,
        symbol: symbol || null,
        // graduated only when ST confirms a non-curve market; if ST is
        // unavailable, leave null (unknown) rather than guessing wrong.
        complete: stMarket ? stMarket.graduated : null,
        onBondingCurve: stMarket ? stMarket.onBondingCurve : null,
        curvePercentage: stMarket ? stMarket.curvePercentage : null,
        market: stMarket ? stMarket.market : null,
        stLiquidityUsd: stMarket ? stMarket.liquidityUsd : null,
        creator: null,            // filled post-creator-detection
        bondingCurve: null,
        bcSignaturesScanned: 0,
        bcBuyersIdentified: 0,
        priceHistory: null,
      };
      console.log(`[AUTOPSY] Pump.fun: synthesized recognition — market=${stMarket?.market || "?"} graduated=${stMarket?.graduated} curve=${stMarket?.curvePercentage}% stLiq=$${stMarket?.liquidityUsd}`);
    }

    // Pump.fun candlestick history — full chart back to mint (the OHLCV gap
    // fix). Skip for synthesized (graduated) tokens — the API won't have them.
    if (pumpInfo && !pumpInfo.synthesized) {
      try {
        const r = await fetch(`https://frontend-api.pump.fun/candlesticks/${mint}?offset=0&limit=1000&timeframe=5`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; CluckNorrisAutopsy/1.0)" },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data) && data.length > 0) {
            let peakPrice = 0, peakTs = 0;
            for (const c of data) {
              const close = Number(c.close) || 0;
              if (close > peakPrice) { peakPrice = close; peakTs = (c.timestamp || 0) * 1000; }
            }
            const latest = data[data.length - 1];
            const pumpCurrentPrice = priceUsd || Number(latest?.close) || 0;
            const drawdown = peakPrice > 0 ? ((pumpCurrentPrice - peakPrice) / peakPrice) * 100 : null;
            pumpInfo.priceHistory = {
              peakPrice,
              peakTimestamp: peakTs,
              peakMarketCap: supplyTokens > 0 && peakPrice > 0 ? peakPrice * supplyTokens : null,
              currentPrice: pumpCurrentPrice,
              drawdownFromPeakPct: drawdown,
              candleCount: data.length,
              source: "Pump.fun",
            };
            // Override GeckoTerminal-derived priceHistory if Pump's is fuller
            // (Pump.fun includes pre-graduation candles GeckoTerminal can't see)
            if (!priceHistory || data.length > (priceHistory.candleCount || 0)) {
              priceHistory = pumpInfo.priceHistory;
            }
          }
        }
      } catch (e) { console.warn("[AUTOPSY] Pump.fun candlesticks failed:", e.message); }
    }

    // Walk Pump.fun bonding-curve account for verified buyers (same as Bags DBC)
    if (pumpInfo && pumpInfo.bondingCurve) {
      try {
        const bcSigs = [];
        let bcBefore = undefined;
        for (let p = 0; p < 2; p++) {
          const params = bcBefore ? [pumpInfo.bondingCurve, { limit: 1000, before: bcBefore }] : [pumpInfo.bondingCurve, { limit: 1000 }];
          const sigRes = await rpcCall(`autopsy-pump-sigs-${p}`, "getSignaturesForAddress", params);
          const ss = sigRes?.result || [];
          if (ss.length === 0) break;
          bcSigs.push(...ss);
          if (ss.length < 1000) break;
          bcBefore = ss[ss.length - 1].signature;
        }
        pumpInfo.bcSignaturesScanned = bcSigs.length;
        if (bcSigs.length > 0) {
          const sampled = [];
          const SAMPLE_SIZE = 100;
          const step = Math.max(1, Math.floor(bcSigs.length / SAMPLE_SIZE));
          for (let i = 0; i < bcSigs.length; i += step) {
            sampled.push(bcSigs[i].signature);
            if (sampled.length >= SAMPLE_SIZE) break;
          }
          const dRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: sampled })
          });
          const dData = await dRes.json();
          if (Array.isArray(dData)) {
            for (const tx of dData) {
              if (!tx || !Array.isArray(tx.tokenTransfers)) continue;
              for (const tt of tx.tokenTransfers) {
                if (tt && tt.mint === mint && tt.fromUserAccount === pumpInfo.bondingCurve && tt.toUserAccount) {
                  dbcBuyerSet.add(tt.toUserAccount); // unified set — Bags + Pump both feed into here
                }
              }
            }
          }
          pumpInfo.bcBuyersIdentified = dbcBuyerSet.size - (bagsInfo?.dbcBuyersIdentified || 0);
        }
      } catch (e) { console.warn("[AUTOPSY] Pump bonding curve walk failed:", e.message); }
    }
    console.log(`[AUTOPSY] Pump.fun integration: ${pumpInfo ? `isPumpToken=true complete=${pumpInfo.complete} bcSigs=${pumpInfo.bcSignaturesScanned} bcBuyers=${pumpInfo.bcBuyersIdentified}` : "not a Pump token"}`);

    // (KNOWN_CEX_WALLETS is now a module-level constant — shared with the free
    // autopsy concentration calc. Used below to refine acquisition labels.)

    // --- Phase 2D/2E post-pass: tag fee-receiver wallets on the holder rows ---
    // For Bags tokens, the creator/v3 endpoint returns every wallet entitled
    // to creator-fee royalties (with royaltyBps). For Pump.fun tokens, the
    // coins endpoint returns the launch creator. These ARE the project's
    // operational wallets — they receive the cash. We tag any top-100 holder
    // whose authority matches as a `bagsFeeWallet` / `pumpCreator` so the UI
    // can surface a prominent badge and the AI prompt can use it. Generic fix
    // for ANY Bags token, not CLKN-specific.
    const projectFeeWalletMap = new Map(); // wallet → { source, royaltyBps?, username?, provider? }
    if (bagsInfo && Array.isArray(bagsInfo.officialCreators)) {
      for (const c of bagsInfo.officialCreators) {
        if (c.wallet) {
          projectFeeWalletMap.set(c.wallet, {
            source: "bags",
            royaltyBps: c.royaltyBps,
            username: c.username,
            provider: c.provider,
            isAdmin: c.isAdmin,
          });
        }
      }
    }
    if (pumpInfo && pumpInfo.creator) {
      // Pump creator gets a separate badge; if it ALSO matches a Bags receiver
      // (rare cross-launch case), the Bags entry wins for label clarity.
      if (!projectFeeWalletMap.has(pumpInfo.creator)) {
        projectFeeWalletMap.set(pumpInfo.creator, { source: "pump" });
      }
    }
    if (projectFeeWalletMap.size > 0 && Array.isArray(topHolders)) {
      for (const h of topHolders) {
        const w = h.authority || h.wallet;
        const meta = w ? projectFeeWalletMap.get(w) : null;
        if (meta) {
          h.projectFeeWallet = meta;
          // Royalty share string for badge display.
          if (meta.royaltyBps != null) {
            h.projectFeeRoyaltyPct = Number(meta.royaltyBps) / 100;
          }
        }
      }
    }

    // --- Phase 2C: Acquisition-source attribution + distributors ---
    // For each wallet holder, fetch their first-tx via the Helius Enhanced API
    // and classify HOW they acquired their tokens:
    //   BOUGHT   — via a DEX swap
    //   TRANSFER — sent directly from another wallet (airdrop / gift / OTC)
    //   MINTED   — direct mint instruction (initial allocation from creator)
    // For TRANSFER cases we capture the source wallet, then aggregate to find
    // "distributors": wallets that sent tokens to multiple top holders (the
    // signal that says "this is an airdrop / bulk distribution event").
    let distributors = [];
    try {
      // Include wallets + lockers + selflocks. A team-distribution wallet may
      // have sent tokens both to human holders AND to lock contracts; we want
      // to show ALL of those recipients with the right label, not just the
      // wallet-side ones. Excludes LP and generic program accounts (those
      // aren't normal distribution targets).
      const walletHoldersAll = topHolders.filter(h =>
        h.category === "wallet" || h.category === "locker" || h.category === "selflock"
      );
      const firstSigsToFetch = walletHoldersAll
        .filter(h => h.firstAcquiredSignature)
        .map(h => h.firstAcquiredSignature);
      if (firstSigsToFetch.length > 0) {
        const acqUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
        const acqRes = await fetch(acqUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: firstSigsToFetch.slice(0, 100) })
        });
        const acqData = await acqRes.json();
        const acqMap = new Map();
        if (Array.isArray(acqData)) for (const tx of acqData) { if (tx?.signature) acqMap.set(tx.signature, tx); }
        for (const h of walletHoldersAll) {
          const tx = acqMap.get(h.firstAcquiredSignature);
          if (!tx) { h.acquisitionType = "UNKNOWN"; continue; }
          const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
          // Find the transfer where THIS wallet received OUR mint
          const ours = tts.find(tt => tt && tt.mint === mint && tt.toUserAccount === h.authority);
          if (ours) {
            if (!ours.fromUserAccount) {
              h.acquisitionType = "MINTED"; h.acquisitionSource = null;
            } else if (tx.type === "SWAP") {
              h.acquisitionType = "BOUGHT"; h.acquisitionSource = ours.fromUserAccount;
            } else {
              h.acquisitionType = "TRANSFER"; h.acquisitionSource = ours.fromUserAccount;
            }
          } else {
            if (tx.type === "SWAP") h.acquisitionType = "BOUGHT";
            else if (tx.type === "TOKEN_MINT") h.acquisitionType = "MINTED";
            else h.acquisitionType = "OTHER";
          }
        }

        // --- Refine acquisition sources: distinguish CEX withdrawals and pool
        // routing from genuine wallet-to-wallet transfers. Currently anything
        // not classified as SWAP is "TRANSFER" — but most of those are actually
        // Coinbase/Binance withdrawals (which are real users withdrawing from
        // an exchange, not airdrop recipients) or Jupiter routing through pool
        // authorities (which is really a BUY). We look up each source's owner
        // program to refine the label.
        const allSourceAddrs = new Set();
        for (const h of walletHoldersAll) { if (h.acquisitionSource) allSourceAddrs.add(h.acquisitionSource); }
        const sourceArr = [...allSourceAddrs];
        const sourceOwnerMap = new Map();
        for (let i = 0; i < sourceArr.length; i += 100) {
          try {
            const so = await rpcCall(`autopsy-src-${i}`, "getMultipleAccounts", [
              sourceArr.slice(i, i + 100),
              { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
            ]);
            const sInfos = so?.result?.value || [];
            sourceArr.slice(i, i + 100).forEach((a, j) => sourceOwnerMap.set(a, sInfos[j]?.owner || null));
          } catch (e) { console.warn(`[AUTOPSY] source batch ${i} failed:`, e.message); }
        }
        for (const h of walletHoldersAll) {
          if (!h.acquisitionSource) continue;
          const src = h.acquisitionSource;
          const sOwner = sourceOwnerMap.get(src);
          if (KNOWN_CEX_WALLETS[src]) {
            h.acquisitionType = "CEX_WITHDRAWAL";
            h.acquisitionSourceLabel = KNOWN_CEX_WALLETS[src];
          } else if (sOwner && DEX_PROGRAMS.has(sOwner)) {
            // Source is owned by a DEX program — this was actually a swap routed
            // through that pool, not a wallet-to-wallet transfer.
            h.acquisitionType = "BOUGHT";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || "DEX pool";
          } else if (sOwner && LOCKER_PROGRAMS.has(sOwner)) {
            h.acquisitionType = "LOCK_UNLOCK";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || "Token lock";
          } else if (sOwner && sOwner !== "11111111111111111111111111111111") {
            // Source is owned by SOME program (not the System Program), which
            // means it isn't a human wallet — it's a PDA / program-controlled
            // account. Even if we don't have a friendly label for the owning
            // program, we know this wasn't a wallet-to-wallet transfer.
            // Falling back to the program-id short hash is honest and stops
            // it from being misread as an insider airdrop.
            h.acquisitionType = "PROGRAM_ROUTE";
            h.acquisitionSourceLabel = PROGRAM_LABELS[sOwner] || `Program ${sOwner.slice(0, 6)}…${sOwner.slice(-4)}`;
            h.acquisitionProgramId = sOwner;
          }
          // else: source IS owned by the System Program → genuine human-wallet
          // sender → keep as TRANSFER.
        }

        // Aggregate distributors: source wallets that sent tokens to 2+ top holders.
        // Crucially, ONLY count genuine wallet-to-wallet TRANSFERs after the
        // refinement above — CEX withdrawals and pool routing don't count.
        const distMap = new Map();
        for (const h of walletHoldersAll) {
          if (h.acquisitionType === "TRANSFER" && h.acquisitionSource) {
            const cur = distMap.get(h.acquisitionSource) || {
              recipients: [], totalShare: 0,
              lockedRecipients: 0, walletRecipients: 0, lockedShare: 0, walletShare: 0,
            };
            const isLocker = h.category === "locker" || h.category === "selflock";
            cur.recipients.push({
              rank: h.rank,
              authority: h.authority,
              share: h.share,
              category: h.category,
              label: h.label,
              isLocker,
              firstAcquiredAmount: h.firstAcquiredAmount || null,
              currentBalance: h.uiAmount || 0,
            });
            cur.totalShare += h.share || 0;
            if (isLocker) {
              cur.lockedRecipients++;
              cur.lockedShare += h.share || 0;
            } else {
              cur.walletRecipients++;
              cur.walletShare += h.share || 0;
            }
            distMap.set(h.acquisitionSource, cur);
          }
        }
        // Threshold lowered to 1 — even a single-recipient distributor is
        // worth surfacing now that each row shows the actual recipient list
        // with categories. Sort by total recipient count desc.
        distributors = [...distMap.entries()]
          .filter(([_, info]) => info.recipients.length >= 1)
          .map(([source, info]) => ({
            sourceWallet: source,
            recipientsInTop20: info.recipients.length,
            walletRecipientsInTop20: info.walletRecipients,
            lockedRecipientsInTop20: info.lockedRecipients,
            totalShareDistributed: info.totalShare,
            walletShareDistributed: info.walletShare,
            lockedShareDistributed: info.lockedShare,
            recipients: info.recipients,
            // Filled in by the distributor-attribution pass below
            firstAcquiredAt: null,
            firstAcquiredSignature: null,
            acquisitionType: null,
            acquisitionTiming: null,
          }))
          .sort((a, b) => b.recipientsInTop20 - a.recipientsInTop20);
        // Tag each distributor with whether they're a VERIFIED team wallet
        // (Bags/Pump official creator). A verified team wallet doing
        // distribution is normal migration / airdrop / team allocation — not
        // an insider rug. The forensic interpretation is completely different.
        for (const d of distributors) {
          d.isVerifiedTeamWallet = projectFeeWalletMap && projectFeeWalletMap.has(d.sourceWallet);
        }
        // Red flag only when distributor is NOT a verified team wallet AND
        // they're sending to actual human WALLETS (not locks). Sending to
        // locks is a positive supply-removal signal, the opposite of an
        // airdrop / insider distribution.
        const topDist = distributors[0];
        if (topDist && topDist.walletRecipientsInTop20 >= 5 && !topDist.isVerifiedTeamWallet) {
          redFlags.push(`One wallet (${topDist.sourceWallet.slice(0, 8)}…) distributed tokens to ${topDist.walletRecipientsInTop20} of the top 20 human-holder wallets — bulk-distribution / airdrop source (NOT a verified team wallet — investigate whether this is insider distribution).`);
        } else if (topDist && topDist.walletRecipientsInTop20 >= 3 && !topDist.isVerifiedTeamWallet) {
          redFlags.push(`One wallet sent tokens to ${topDist.walletRecipientsInTop20} top-20 human holders — concentrated distribution source.`);
        } else if (topDist && topDist.isVerifiedTeamWallet) {
          console.log(`[AUTOPSY] Verified team-wallet distribution suppressed from red flags: source=${topDist.sourceWallet.slice(0,8)}… recipients=${topDist.recipientsInTop20} (wallets=${topDist.walletRecipientsInTop20}, locks=${topDist.lockedRecipientsInTop20})`);
        }

        // --- Distributor acquisition attribution ---
        // For each identified distributor, figure out HOW they got the tokens
        // they later distributed. The classic "bought big at launch then
        // airdropped to past supporters" pattern shows up as
        // acquisitionType=BOUGHT + acquisitionTiming=sniper/bonding_curve.
        const DIST_CAP = Math.min(distributors.length, 5);
        await Promise.allSettled(distributors.slice(0, DIST_CAP).map(async (dist, di) => {
          try {
            const tacRes = await rpcCall(`autopsy-dist-tac-${di}`, "getTokenAccountsByOwner", [
              dist.sourceWallet, { mint }, { encoding: "jsonParsed" }
            ]);
            const accs = tacRes?.result?.value || [];
            if (accs.length === 0) return;
            const tac = accs[0].pubkey;
            const distSigsRes = await rpcCall(`autopsy-dist-sigs-${di}`, "getSignaturesForAddress", [
              tac, { limit: 1000 }
            ]);
            const distSigs = distSigsRes?.result || [];
            if (distSigs.length === 0) return;
            const oldest = distSigs[distSigs.length - 1];
            dist.firstAcquiredAt = oldest.blockTime ? oldest.blockTime * 1000 : null;
            dist.firstAcquiredSignature = oldest.signature;
            // Timing classification (matches the same buckets as top holders)
            if (dist.firstAcquiredAt && pairCreatedMs) {
              const dms = dist.firstAcquiredAt - pairCreatedMs;
              if (dms < -60_000) dist.acquisitionTiming = bondingCurveActive() ? "bonding_curve" : "pre_pool";
              else if (dms < 60_000) dist.acquisitionTiming = "sniper";
              else if (dms < 3_600_000) dist.acquisitionTiming = "very_early";
              else if (dms < 86_400_000) dist.acquisitionTiming = "early";
              else if (dms < 7 * 86_400_000) dist.acquisitionTiming = "first_week";
              else dist.acquisitionTiming = "later";
            }
          } catch (e) {
            console.warn(`[AUTOPSY] distributor ${di} history failed:`, e.message);
          }
        }));

        // Batch-fetch parsed first-txs for distributors via Helius Enhanced
        const distSigsToFetch = distributors.slice(0, DIST_CAP).filter(d => d.firstAcquiredSignature).map(d => d.firstAcquiredSignature);
        if (distSigsToFetch.length > 0) {
          try {
            const dUrl = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`;
            const dRes = await fetch(dUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactions: distSigsToFetch })
            });
            const dData = await dRes.json();
            const dMap = new Map();
            if (Array.isArray(dData)) for (const t of dData) { if (t?.signature) dMap.set(t.signature, t); }
            for (const dist of distributors.slice(0, DIST_CAP)) {
              const tx = dMap.get(dist.firstAcquiredSignature);
              if (!tx) { dist.acquisitionType = "UNKNOWN"; continue; }
              const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
              const ours = tts.find(tt => tt && tt.mint === mint && tt.toUserAccount === dist.sourceWallet);
              if (ours) {
                if (!ours.fromUserAccount) dist.acquisitionType = "MINTED";
                else if (tx.type === "SWAP") dist.acquisitionType = "BOUGHT";
                else dist.acquisitionType = "TRANSFER";
              } else {
                if (tx.type === "SWAP") dist.acquisitionType = "BOUGHT";
                else if (tx.type === "TOKEN_MINT") dist.acquisitionType = "MINTED";
                else dist.acquisitionType = "OTHER";
              }
            }
          } catch (e) {
            console.warn("[AUTOPSY] distributor enhanced fetch failed:", e.message);
          }
        }

        // Promote one final red flag if a distributor bought-then-distributed
        const buyerDistributor = distributors.find(d =>
          d.acquisitionType === "BOUGHT" &&
          (d.acquisitionTiming === "sniper" || d.acquisitionTiming === "very_early" || d.acquisitionTiming === "bonding_curve") &&
          d.recipientsInTop20 >= 3
        );
        if (buyerDistributor) {
          redFlags.push(`A wallet bought a large position at launch (${buyerDistributor.acquisitionTiming}) and then distributed it to ${buyerDistributor.recipientsInTop20} top-20 holders — classic "buy big then airdrop" pattern.`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] acquisition attribution failed:", e.message);
    }

    // --- Creator status: did the creator wallet keep or sell their stake? ---
    // Cross-reference the creator wallet against the top holders. For Bags
    // tokens we use the OFFICIAL creator wallet from /token-launch/creator/v3
    // (which often includes a Twitter handle) — far more accurate than the
    // "genesis tx fee payer" heuristic (which catches the Bags platform).
    let creatorStatus = null;
    let effectiveCreatorWallet = lifetime?.creatorWallet || null;
    let effectiveCreatorSource = "genesis-tx-fee-payer";
    let bagsCreatorMeta = null;
    if (bagsInfo && bagsInfo.officialCreators && bagsInfo.officialCreators.length > 0) {
      // Prefer the first admin creator; fall back to the first creator listed.
      const admin = bagsInfo.officialCreators.find(c => c.isAdmin) || bagsInfo.officialCreators[0];
      effectiveCreatorWallet = admin.wallet;
      effectiveCreatorSource = "bags-official";
      bagsCreatorMeta = admin;
    } else if (pumpInfo && pumpInfo.creator) {
      effectiveCreatorWallet = pumpInfo.creator;
      effectiveCreatorSource = "pump-official";
    } else {
      // Bags/Pump platform APIs didn't return a creator. Before trusting the
      // genesis-tx fee payer (which on launchpad tokens is the PLATFORM wallet
      // — the shared Bags/Pump address that paid for thousands of launches,
      // NOT the project team), ask Solana Tracker. Its indexer returns the
      // real token creator even for graduated Pump.fun tokens where Pump's own
      // API no longer serves pre-graduation data. This is what stops us
      // fingering the platform wallet as "the dev" and falsely narrating
      // "creator exited." Pump mints (…pump suffix) are flagged so we never
      // fall back to the genesis payer for them.
      const isPumpMint = typeof mint === "string" && mint.toLowerCase().endsWith("pump");
      let stCreator = null;
      try { stCreator = await solanaTracker.getTokenCreator(mint); } catch (e) { /* degrade */ }
      if (stCreator && stCreator.wallet) {
        effectiveCreatorWallet = stCreator.wallet;
        effectiveCreatorSource = "solana-tracker";
      } else if (bagsInfo || pumpInfo || isPumpMint) {
        // Known launchpad token but NO source could give us the real creator.
        // Refuse to show the genesis fee payer (platform wallet) as the dev.
        effectiveCreatorWallet = null;
        effectiveCreatorSource = "unverified-platform-launch";
        redFlags.push(
          bagsInfo
            ? "Bags-platform-launched token, but no registered creator was returned by the Bags API — the on-chain genesis tx was paid by the Bags platform wallet, not by the project team. Treat any 'dev wallet' label from other tools (DexScreener, etc.) as misleading for this token."
            : "Pump.fun token, but neither Pump nor Solana Tracker returned a verified creator — the on-chain genesis tx was paid by the Pump platform wallet, not by the project team. Don't trust any 'dev wallet' label here."
        );
      }
      // else: not a launchpad token and ST had nothing — keep the genesis-tx
      // fee payer default (for a plain SPL token, the genesis payer usually
      // IS the creator).
    }
    if (effectiveCreatorWallet) {
      const creatorInTop = topHolders.find(h => h.authority === effectiveCreatorWallet);
      if (creatorInTop) {
        creatorInTop.isCreator = true;
        creatorInTop.creatorMeta = bagsCreatorMeta;
        const creatorLabel = bagsCreatorMeta?.username ? `Creator (@${bagsCreatorMeta.username})` : "Creator wallet";
        creatorStatus = {
          wallet: effectiveCreatorWallet,
          source: effectiveCreatorSource,
          bagsCreatorMeta,
          inTopHolders: true,
          rank: creatorInTop.rank,
          currentShare: creatorInTop.share,
          behavior: creatorInTop.behavior,
          summary: creatorInTop.behavior === "EXITED_MOSTLY"
            ? `${creatorLabel} is in the top 100 but has sold most of their original position.`
            : creatorInTop.behavior === "REDUCED"
            ? `${creatorLabel} is in the top 100 and has trimmed their position.`
            : creatorInTop.behavior === "HELD"
            ? `${creatorLabel} is in the top 100 and is still holding their original position.`
            : creatorInTop.behavior === "ACCUMULATED"
            ? `${creatorLabel} is in the top 100 and has accumulated more since launch.`
            : `${creatorLabel} is in the top 100 at rank ${creatorInTop.rank}.`,
        };
      } else {
        // Creator not in top 100. For Bags-verified creators this is OFTEN
        // normal — the fee-receiving wallet receives SOL royalties and may
        // never hold tokens (buy-backs typically route to LP or burn, not
        // back to the operational wallet). We'll enrich this status with
        // actual on-chain activity from walletPnl below, after that's built.
        // Don't pre-emptively red-flag it.
        // On a bonding curve (ANY launchpad) the supply lives in the curve
        // contract, so the creator not being a top holder is NORMAL — it is
        // NOT an exit or distribution. Resolve curve status here (ST call is
        // cached) so we don't mis-fire "creator exited" on a fresh launchpad
        // token (this mis-fired on LetsBonk/Raydium on-curve tokens).
        let creatorOnCurve = false;
        try {
          if (pumpInfo) creatorOnCurve = pumpInfo.onBondingCurve === true;
          else { const stm = await solanaTracker.getTokenMarketStatus(mint); creatorOnCurve = !!(stm && stm.onBondingCurve); }
        } catch (_) {}
        creatorStatus = {
          wallet: effectiveCreatorWallet,
          source: effectiveCreatorSource,
          bagsCreatorMeta,
          inTopHolders: false,
          summary: effectiveCreatorSource === "bags-official"
            ? `Bags-verified creator${bagsCreatorMeta?.username ? ` (@${bagsCreatorMeta.username})` : ""} does not currently hold tokens in the top 100 — common for fee-receiving operational wallets. See the P&L Ledger PROJECT WALLETS tab for their on-chain activity.`
            : effectiveCreatorSource === "pump-official"
            ? "Pump-verified creator does not currently hold tokens in the top 100 — common for fee-receiving operational wallets."
            : creatorOnCurve
            ? "Creator isn't a top holder, but the token is still on the bonding curve — the supply is held by the curve contract, not distributed out. That's normal pre-graduation, NOT an exit signal."
            : "Creator wallet is NOT in the top 100 holders — they've either fully exited their initial position or distributed it out.",
        };
        // Red-flag the genesis-fee-payer case ONLY when the token has a real
        // DEX pool (graduated / non-launchpad). On a curve it's a false signal.
        if (effectiveCreatorSource === "genesis-tx-fee-payer" && !creatorOnCurve) {
          redFlags.push("Creator wallet (genesis-tx fee payer) does not appear in the top 100 — they have either exited or distributed their initial stake.");
        }
      }
    }

    // Backfill the synthesized Pump card's creator from the ST-resolved one.
    if (pumpInfo && pumpInfo.synthesized && !pumpInfo.creator && effectiveCreatorWallet) {
      pumpInfo.creator = effectiveCreatorWallet;
    }

    // ── On-bonding-curve detection + verdict correction (Pump.fun OR Bags) ──
    // A token still on its launchpad bonding curve has NO DEX pool yet, so
    // DexScreener shows ~$0 (or a phantom near-zero-liquidity pool) — which
    // falsely trips LP_RUG / GHOST / UNCLEAR / SOFT_RUG, or lands AT_RISK off
    // early-stage concentration + "no exit". It isn't rugged; its liquidity is
    // the curve reserve. Pump on-curve is detected during synthesis
    // (pumpInfo.onBondingCurve); Bags tokens carry no market status, so resolve
    // it from Solana Tracker here (market "meteora-curve" / "…curve" = still on
    // the Bags DBC curve). Same root cause we fixed for the launches feed.
    let lpOnCurve = pumpInfo ? (pumpInfo.onBondingCurve === true) : false;
    let lpCurvePct = pumpInfo ? pumpInfo.curvePercentage : null;
    let lpCurveLiqUsd = pumpInfo ? (pumpInfo.stLiquidityUsd || 0) : 0;
    let lpName = pumpInfo ? "Pump.fun" : (bagsInfo ? "Bags" : "the launchpad");
    // For ANY non-Pump token, resolve curve status from Solana Tracker — this
    // covers Bags (meteora-curve), Raydium LaunchLab / LetsBonk
    // (raydium-launchpad) and any other launchpad curve, not just Bags. ST's
    // getTokenInfo is already cached from creator detection, so this is ~free.
    if (!pumpInfo) {
      try {
        const stm = await solanaTracker.getTokenMarketStatus(mint);
        if (stm) {
          if (bagsInfo) {
            bagsInfo.onBondingCurve = stm.onBondingCurve;
            bagsInfo.graduated = stm.graduated;
            bagsInfo.curvePercentage = stm.curvePercentage;
            bagsInfo.market = stm.market;
            bagsInfo.stLiquidityUsd = stm.liquidityUsd;
          }
          lpOnCurve = stm.onBondingCurve === true;
          lpCurvePct = stm.curvePercentage;
          lpCurveLiqUsd = stm.liquidityUsd || 0;
          if (!bagsInfo && lpOnCurve) {
            const m = (stm.market || "").toLowerCase();
            lpName = m === "meteora-curve" ? "Bags"
              : m.includes("launchpad") ? (MINT_LOWER.endsWith("bonk") ? "LetsBonk" : "Raydium LaunchLab")
              : m === "moonshot" ? "Moonshot"
              : m === "pumpfun" ? "Pump.fun"
              : "the launchpad";
          }
          console.log(`[AUTOPSY] market status: market=${stm.market} onCurve=${stm.onBondingCurve} curve=${stm.curvePercentage}% stLiq=$${stm.liquidityUsd}`);
        }
      } catch (e) { /* degrade — leave as graduated/unknown */ }
    }

    if (lpOnCurve && lpCurveLiqUsd >= 500
      && ["LP_RUG", "GHOST", "UNCLEAR", "SOFT_RUG", "AT_RISK"].includes(verdict.type)) {
      const curveStr = lpCurvePct != null ? ` (${lpCurvePct.toFixed(1)}% to graduation)` : "";
      verdict = { type: "ON_CURVE", label: "Status: ON THE BONDING CURVE — PRE-GRADUATION", severity: "AT_RISK", color: "#F59E0B", icon: "🌱" };
      reportMode = "health-assessment";
      reportHeadline = "🌱 ON THE BONDING CURVE";
      reportSubhead = `Still on the ${lpName} bonding curve${curveStr} — it hasn't graduated to a DEX pool yet. No DEX pool is normal at this stage (liquidity is the curve reserve, ~$${Math.round(lpCurveLiqUsd).toLocaleString()}), not a rug. Early and speculative by definition.`;
      // Strip the misleading DexScreener-liquidity red flags (meaningless
      // pre-graduation) and replace with the honest curve-reserve fact.
      const drop = ["effectively no exit", "zero current liquidity", "No DexScreener pool", "never launched a tradeable"];
      for (let i = redFlags.length - 1; i >= 0; i--) {
        if (drop.some(d => redFlags[i].includes(d))) redFlags.splice(i, 1);
      }
      redFlags.push(`Still on the ${lpName} bonding curve${curveStr} with ~$${Math.round(lpCurveLiqUsd).toLocaleString()} in curve-reserve liquidity — early and speculative, but the curve is intact (the DEX pool comes at graduation, not a rug).`);
      // At low curve %, the bonding-curve contract itself is the biggest "holder",
      // so a raw top-10 % reads as false whale concentration. Reframe it.
      if (lpCurvePct != null && lpCurvePct < 60) {
        for (let i = 0; i < redFlags.length; i++) {
          if (redFlags[i].includes("heavy concentration")) {
            redFlags[i] = `Top-10 holder share looks high, but the token is only ${lpCurvePct.toFixed(0)}% through its bonding curve — most of that supply still sits in the curve contract (unbought), not in whale wallets. Re-check holder concentration after it graduates.`;
          }
        }
      }
    }

    // --- Phase 2J: Pump.fun creator-fee tracking ---
    // Pump.fun creators earn a per-trade creator fee that accrues in a
    // "creator vault" PDA (seeds ["creator-vault", creator] on the Pump
    // program). This is the cheap, deterministic Pump-fee source — derive the
    // vault, read its current balance (unclaimed fees) + signature activity
    // (every accrual/claim leaves a tx). No paid indexer needed. Only runs for
    // pump-suffixed mints with an identified creator.
    let pumpCreatorFees = null;
    try {
      const isPumpMint = typeof mint === "string" && mint.toLowerCase().endsWith("pump");
      if (isPumpMint && effectiveCreatorWallet) {
        const vault = derivePumpCreatorVault(effectiveCreatorWallet);
        if (vault) {
          const [balRes, sigRes] = await Promise.all([
            rpcCall("autopsy-pump-vault-bal", "getBalance", [vault]),
            rpcCall("autopsy-pump-vault-sigs", "getSignaturesForAddress", [vault, { limit: 1000 }]),
          ]);
          // Distinguish a genuine empty/new vault from a FAILED lookup. A
          // failed RPC has no `result` field at all — showing "0 fees" in that
          // case would falsely tell an upset holder "the dev took nothing"
          // when we simply didn't get an answer. If the signatures lookup
          // didn't return an array, treat the whole thing as a miss and skip
          // (panel hides) rather than reporting a misleading zero.
          const sigsOk = Array.isArray(sigRes?.result);
          if (!sigsOk) {
            console.warn(`[AUTOPSY] Phase 2J vault lookup failed (no result) for ${vault.slice(0,8)} — skipping to avoid false zero`);
            throw new Error("vault-lookup-failed");
          }
          const unclaimedLamports = balRes?.result?.value || 0;
          const sigs = sigRes.result;
          const oldestTs = sigs.length ? sigs[sigs.length - 1].blockTime : null;
          // Lifetime CLAIMED — walk the vault history and sum SOL that left
          // the vault to the creator (the claim outflows). This is the honest
          // "how much did the dev extract in creator fees" number — the one an
          // upset holder of a failed token actually wants. We use this vault's
          // own outflows (nativeTransfers from vault → creator) so a claim that
          // batched multiple tokens' vaults is attributed correctly to THIS
          // token only. Walks up to the 1000-sig cap; flagged as a lower bound
          // if capped. Cheap now that Phase 2F is gone.
          let lifetimeClaimedSol = null;
          try {
            const sigList = sigs.map(s => s.signature).filter(Boolean);
            if (sigList.length > 0) {
              const walk = await heliusEnhancedBatched(sigList, HELIUS_KEY, "phase-2J-vault", heliusTxCache, scanQuality);
              let claimedLamports = 0;
              for (const tx of (walk.txs || [])) {
                for (const nt of (tx.nativeTransfers || [])) {
                  if (nt && nt.fromUserAccount === vault && nt.toUserAccount === effectiveCreatorWallet) {
                    claimedLamports += Number(nt.amount) || 0;
                  }
                }
              }
              lifetimeClaimedSol = claimedLamports / 1e9;
            }
          } catch (e) {
            console.warn("[AUTOPSY] Phase 2J claimed-fee walk failed:", e.message);
          }
          pumpCreatorFees = {
            vault,
            unclaimedSol: unclaimedLamports / 1e9,
            // Lifetime SOL the creator pulled out of this token's fee vault.
            lifetimeClaimedSol,
            // Total fees the creator has realized from this token = claimed +
            // what's still sitting unclaimed in the vault.
            lifetimeTotalSol: lifetimeClaimedSol != null ? lifetimeClaimedSol + unclaimedLamports / 1e9 : null,
            // Number of on-chain fee events touching the vault (accruals +
            // claims). A proxy for how actively the token generated creator
            // fees. Capped at 1000 by the signature page; show "1000+" then.
            feeEventCount: sigs.length,
            feeEventsCapped: sigs.length >= 1000,
            firstFeeEventTs: oldestTs ? oldestTs * 1000 : null,
          };
          console.log(`[AUTOPSY] Phase 2J pump creator fees: vault=${vault.slice(0,8)}… unclaimed=${pumpCreatorFees.unclaimedSol.toFixed(4)} claimed=${lifetimeClaimedSol != null ? lifetimeClaimedSol.toFixed(3) : "?"} SOL events=${sigs.length}${pumpCreatorFees.feeEventsCapped ? "+" : ""}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2J pump creator-fee tracking failed:", e.message);
    }

    // --- Phase 2K: Creator wallet profile + funding source ---
    // Is the creator wallet an established operator wallet or a fresh throwaway
    // deployer? One signatures page answers it cheaply: 1000+ txs = established
    // (NOT a burner). For a FRESH wallet (genesis reachable in one page) we
    // trace one hop back — who funded it — because "creator funds a brand-new
    // deployer from a single source right before launch" is the obfuscation
    // pattern the funding-source check (from the research note) is meant to
    // catch. We don't deep-paginate active wallets — that would violate the
    // cheap-first rule and the activity level already tells the story.
    let creatorWalletProfile = null;
    try {
      if (effectiveCreatorWallet) {
        const profRes = await rpcCall("autopsy-creator-profile", "getSignaturesForAddress", [effectiveCreatorWallet, { limit: 1000 }]);
        const psigs = profRes?.result;
        if (Array.isArray(psigs) && psigs.length > 0) {
          const isEstablished = psigs.length >= 1000;
          const oldestSeen = psigs[psigs.length - 1].blockTime;
          let fundingSource = null;
          if (!isEstablished) {
            // Genesis reachable in one page — the oldest tx is the wallet's
            // first. Parse it (enhanced) and read who sent the creator its
            // first SOL. That sender is the funding source.
            try {
              const gSig = psigs[psigs.length - 1].signature;
              const gWalk = await heliusEnhancedBatched([gSig], HELIUS_KEY, "phase-2K-genesis", heliusTxCache, scanQuality);
              const gtx = (gWalk.txs || [])[0];
              if (gtx && Array.isArray(gtx.nativeTransfers)) {
                let best = null;
                for (const nt of gtx.nativeTransfers) {
                  if (nt && nt.toUserAccount === effectiveCreatorWallet && nt.fromUserAccount && nt.fromUserAccount !== effectiveCreatorWallet) {
                    if (!best || (Number(nt.amount) || 0) > (Number(best.amount) || 0)) best = nt;
                  }
                }
                if (best) {
                  fundingSource = {
                    wallet: best.fromUserAccount,
                    solAmount: (Number(best.amount) || 0) / 1e9,
                    label: KNOWN_CEX_WALLETS[best.fromUserAccount] || null,
                  };
                }
              }
            } catch (e) { /* funding trace best-effort */ }
          }
          // Serial-deployer signal — how many tokens this wallet has launched.
          // A high count flips "established wallet" from reassuring to a
          // token-mill risk flag. Best-effort via Solana Tracker.
          let deployedTokens = null;
          try { deployedTokens = await solanaTracker.getDeployerTokenCount(effectiveCreatorWallet); } catch (e) { /* degrade */ }
          const deployCount = deployedTokens ? deployedTokens.count : null;
          const deployExact = deployedTokens ? deployedTokens.exact : false;
          // Tiered: 25+ = serial launcher (token mill), 5-24 = multiple tokens.
          const isSerialDeployer = deployCount != null && deployCount >= 25;
          creatorWalletProfile = {
            txCountAtLeast: psigs.length,
            isEstablished,
            oldestSeenTs: oldestSeen ? oldestSeen * 1000 : null,
            fundingSource,
            deployedTokenCount: deployCount,
            deployedTokenCountExact: deployExact,
            isSerialDeployer,
          };
          if (isSerialDeployer) {
            redFlags.push(`Creator wallet has deployed ${deployExact ? "" : "at least "}${deployCount} tokens — a serial-launcher pattern. A long wallet history here is a token-mill signal, not a sign of a committed operator.`);
          }
          console.log(`[AUTOPSY] Phase 2K creator profile: ${effectiveCreatorWallet.slice(0,8)}… established=${isEstablished} txs>=${psigs.length} deployed=${deployCount != null ? (deployExact ? "" : ">=") + deployCount : "?"} serial=${isSerialDeployer} funder=${fundingSource ? (fundingSource.label || fundingSource.wallet.slice(0,8)) : "n/a"}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2K creator profile failed:", e.message);
    }

    // --- Per-wallet P&L ledger: REMOVED ---
    // The Helius-based lifetime P&L walk was the heaviest, most rate-limit-prone
    // part of the free autopsy and had already been disabled behind a flag.
    // Removed entirely; everything downstream null-guards walletPnl. The token-
    // gated "P&L Express" (Solana Tracker /traders) in lib/premium-forensics.js
    // is the path forward if a per-wallet ledger is ever wanted again.
    let walletPnl = null;

    // --- Creator-status enrichment from walletPnl ---
    // Now that we know what every wallet actually did on-chain, replace the
    // "creator not in top 100 → must have exited" inference with the actual
    // truth: did they buy? sell? do buy-backs? sit dormant? This is the
    // honest answer for fee-receiving operational wallets that legitimately
    // don't hold tokens at any given snapshot.
    // --- Phase 2G: Direct creator-wallet trace ---
    // The Phase 2F lifetime walk can miss daily creator buy-backs when they
    // route through Jupiter (multi-hop token transfers don't fit the clean
    // pool→wallet pattern). Walk the creator wallet's OWN signatures directly
    // and count CLKN buys/sells/locks. Targeted and accurate — independent of
    // how the swap was routed.
    let creatorTrace = null;
    if (creatorStatus && creatorStatus.wallet) {
      try {
        // Rebuild a small lockerAddressSet here so we can detect lock deposits
        // independently of Phase 2F's scope.
        const traceLockerSet = new Set();
        for (const p of LOCKER_PROGRAMS) traceLockerSet.add(p);
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if ((h.category === "locker" || h.category === "selflock") && addr) {
            traceLockerSet.add(addr);
          }
        }
        // Paginate aggressively — heavy buy-back wallets accumulate thousands
        // of sigs (every claim, every buy, every lock, every transfer). Cap
        // at 5000 sigs (5 pages × 1000) to give honest coverage.
        const allCreatorSigs = [];
        let beforeSig = undefined;
        for (let p = 0; p < 5; p++) {
          const params = beforeSig
            ? [creatorStatus.wallet, { limit: 1000, before: beforeSig }]
            : [creatorStatus.wallet, { limit: 1000 }];
          const sigsRes = await rpcCall(`autopsy-creator-direct-sigs-${p}`, "getSignaturesForAddress", params);
          const pageSigs = sigsRes?.result || [];
          if (pageSigs.length === 0) break;
          allCreatorSigs.push(...pageSigs);
          if (pageSigs.length < 1000) break;
          beforeSig = pageSigs[pageSigs.length - 1].signature;
        }
        const sigs = allCreatorSigs.map(s => s.signature);
        // Critical: only SWAP-type transactions count as buys/sells. A
        // non-SWAP outflow is a transfer or a lock deposit, NOT a sell.
        // Earlier version conflated all outflows as sells which produced the
        // wrong "163 sells" result for wallets that only buy-and-lock.
        let buyCount = 0, sellCount = 0, lockCount = 0;
        let transferInCount = 0, transferOutCount = 0;
        let boughtTokens = 0, soldTokens = 0, lockedTokens = 0;
        let transferInTokens = 0, transferOutTokens = 0;
        // Per-destination CLKN flow out — used to identify sub-distributor
        // wallets for the multi-hop team-network trace below.
        const transferOutByDest = new Map(); // wallet → tokens transferred out
        // Per-source CLKN flow in (in case sub-wallets sent CLKN back).
        const transferInBySource = new Map();
        // Per-destination SOL flow out (non-swap). Critical for buy-and-lock
        // teams: creator claims SOL fees and sends SOL (not CLKN) to a
        // sub-wallet that does the buys + locks. Without this, multi-hop
        // misses the whole "fees → SOL → sub-wallet buys" path.
        const solOutByDest = new Map(); // wallet → lamports
        let boughtUsd = 0, soldUsd = 0;
        // SOL actually spent on buys. This is the most honest "$ into the
        // token" signal because it tracks what the user paid in SOL terms,
        // independent of when CLKN's daily-close price was for USD valuation.
        let boughtSolLamports = 0, soldSolLamports = 0;
        let firstTs = null, lastTs = null;
        // Phase 2G creator-trace through the same retry-aware helper.
        const creatorFetchResult = await heliusEnhancedBatched(
          sigs, HELIUS_KEY, "phase-2G-creator", heliusTxCache, scanQuality
        );
        {
          const dataR = creatorFetchResult.txs;
          {
            for (const tx of dataR) {
              if (!tx || tx.transactionError) continue;
              const ts = tx.timestamp ? tx.timestamp * 1000 : null;
              const dayKey = ts ? Math.floor(ts / 86400000) : null;
              let dayUsd = dayKey !== null ? priceCandlesByDay.get(dayKey) : null;
              if (!dayUsd && dayKey !== null) {
                for (let off = 1; off <= 3 && !dayUsd; off++) {
                  dayUsd = priceCandlesByDay.get(dayKey - off) || priceCandlesByDay.get(dayKey + off) || null;
                }
              }
              const isSwap = tx.type === "SWAP";
              // SOL cost flows through BOTH nativeTransfers (raw SOL) and WSOL
              // tokenTransfers (the common Jupiter path). Sum both for EVERY tx
              // — not just type==="SWAP" — because Helius mislabels many real
              // swaps (Jupiter/aggregator/newer launchpad routes) as UNKNOWN or
              // TRANSFER. We reclassify by value flow below.
              const WSOL_MINT = "So11111111111111111111111111111111111111112";
              let netSolForCreatorLamports = 0;
              if (Array.isArray(tx.nativeTransfers)) {
                for (const nt of tx.nativeTransfers) {
                  if (!nt) continue;
                  if (nt.fromUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports -= Number(nt.amount) || 0;
                  } else if (nt.toUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports += Number(nt.amount) || 0;
                  }
                }
              }
              if (Array.isArray(tx.tokenTransfers)) {
                for (const tt of tx.tokenTransfers) {
                  if (!tt || tt.mint !== WSOL_MINT) continue;
                  // WSOL has 9 decimals — tokenAmount IS the SOL-equivalent.
                  const lamports = Math.round((Number(tt.tokenAmount) || 0) * 1e9);
                  if (tt.fromUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports -= lamports;
                  } else if (tt.toUserAccount === creatorStatus.wallet) {
                    netSolForCreatorLamports += lamports;
                  }
                }
              }
              // ── Value-flow trade detection (the 2G under-count fix) ──
              // A BUY = creator RECEIVED CLKN and PAID SOL (net SOL out); a SELL
              // = creator SENT CLKN and RECEIVED SOL. True regardless of the
              // Helius `type` label, so it captures the buys/sells previously
              // dropped into the transfer bucket (e.g. 71 of 128 → full count).
              const SOL_TRADE_LAMPORTS = 1_000_000; // 0.001 SOL — ignore dust/fees
              let clknIn = false, clknOut = false;
              for (const tt of (Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [])) {
                if (!tt || tt.mint !== mint) continue;
                if (tt.toUserAccount === creatorStatus.wallet) clknIn = true;
                else if (tt.fromUserAccount === creatorStatus.wallet) clknOut = true;
              }
              const buyByFlow  = clknIn  && (isSwap || netSolForCreatorLamports <= -SOL_TRADE_LAMPORTS);
              const sellByFlow = clknOut && (isSwap || netSolForCreatorLamports >=  SOL_TRADE_LAMPORTS);
              const isCreatorTrade = buyByFlow || sellByFlow;
              // NON-swap SOL outflows to genuine human-wallet destinations.
              // CRITICAL: Helius sometimes classifies multi-hop swaps as
              // type !== "SWAP" — we must defensively exclude any destination
              // that's a DEX program, locker, LP authority, CEX, token
              // program, or system program. Otherwise we count routing SOL
              // as if it were a transfer to a sub-distributor (the bug that
              // produced "193 SOL sent to sub-wallets" on CLKN).
              if (!isCreatorTrade && Array.isArray(tx.nativeTransfers)) {
                for (const nt of tx.nativeTransfers) {
                  if (!nt) continue;
                  if (nt.fromUserAccount === creatorStatus.wallet
                    && nt.toUserAccount
                    && nt.toUserAccount !== creatorStatus.wallet) {
                    const dest = nt.toUserAccount;
                    // Reject any program/system destination — only true
                    // wallet-to-wallet SOL transfers count.
                    if (DEX_PROGRAMS.has(dest) || LOCKER_PROGRAMS.has(dest)
                      || TOKEN_PROGRAMS.has(dest) || traceLockerSet.has(dest)
                      || KNOWN_CEX_WALLETS[dest]
                      || dest === "11111111111111111111111111111111") continue;
                    const lamports = Number(nt.amount) || 0;
                    if (lamports >= 10_000_000) { // ≥ 0.01 SOL → meaningful
                      solOutByDest.set(
                        dest,
                        (solOutByDest.get(dest) || 0) + lamports
                      );
                    }
                  }
                }
              }
              const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
              // To avoid double-counting SOL across multiple tokenTransfers in
              // the same swap (Jupiter routes), record one SOL leg per swap.
              let solRecordedForThisSwap = false;
              for (const tt of tts) {
                if (!tt || tt.mint !== mint) continue;
                const amt = Number(tt.tokenAmount) || 0;
                if (amt <= 0) continue;
                const touched = ts;
                // Creator received CLKN
                if (tt.toUserAccount === creatorStatus.wallet) {
                  if (buyByFlow) {
                    // Market buy — received CLKN and paid SOL (or Helius typed
                    // it SWAP). Counts routed/aggregator buys, not just SWAPs.
                    buyCount++;
                    boughtTokens += amt;
                    if (dayUsd) boughtUsd += amt * dayUsd;
                    // SOL spent on this buy = negative netSol. Record once per tx.
                    if (!solRecordedForThisSwap && netSolForCreatorLamports < 0) {
                      boughtSolLamports += Math.abs(netSolForCreatorLamports);
                      solRecordedForThisSwap = true;
                    }
                  } else {
                    // Received CLKN with no SOL paid — a genuine transfer-in
                    // (gift/airdrop/sub-wallet return), not a market buy.
                    transferInCount++;
                    transferInTokens += amt;
                    if (tt.fromUserAccount) {
                      transferInBySource.set(
                        tt.fromUserAccount,
                        (transferInBySource.get(tt.fromUserAccount) || 0) + amt
                      );
                    }
                  }
                  if (touched) {
                    if (!firstTs || touched < firstTs) firstTs = touched;
                    if (!lastTs || touched > lastTs) lastTs = touched;
                  }
                }
                // Creator sent CLKN
                else if (tt.fromUserAccount === creatorStatus.wallet) {
                  if (traceLockerSet.has(tt.toUserAccount)) {
                    // Lock deposit — supply removed (never a sell, even if SOL moved).
                    lockCount++;
                    lockedTokens += amt;
                  } else if (sellByFlow) {
                    // Market sell — sent CLKN and received SOL (or Helius typed
                    // it SWAP). Locks/transfers are NOT sells.
                    sellCount++;
                    soldTokens += amt;
                    if (dayUsd) soldUsd += amt * dayUsd;
                    // SOL received from this sell = positive netSol for creator.
                    if (!solRecordedForThisSwap && netSolForCreatorLamports > 0) {
                      soldSolLamports += netSolForCreatorLamports;
                      solRecordedForThisSwap = true;
                    }
                  } else {
                    // Sent to another wallet — transfer-out, NOT a sell. Could
                    // be a sub-distributor wallet, a team operational move, or
                    // a gift; the hidden-exit detection (Phase 2C-bis) will
                    // surface if those recipients subsequently dump.
                    transferOutCount++;
                    transferOutTokens += amt;
                    if (tt.toUserAccount) {
                      transferOutByDest.set(
                        tt.toUserAccount,
                        (transferOutByDest.get(tt.toUserAccount) || 0) + amt
                      );
                    }
                  }
                  if (touched) {
                    if (!firstTs || touched < firstTs) firstTs = touched;
                    if (!lastTs || touched > lastTs) lastTs = touched;
                  }
                }
              }
            }
          }
        }
        if (creatorFetchResult.rateLimited > 0) scanQuality.phasesFailed.push("phase-2G-partial");
        else scanQuality.phasesCompleted.push("phase-2G");
        const boughtSol = boughtSolLamports / 1e9;
        const soldSol = soldSolLamports / 1e9;
        // VERIFICATION — fetch the creator wallet's current SOL balance and
        // compute: claimed - bought - currentBalance - knownSent ≈ 0 if we
        // captured everything. Surfaces undercounting honestly.
        let creatorSolBalanceNow = null;
        let unaccountedSol = null;
        try {
          const balRes = await rpcCall("autopsy-creator-bal", "getBalance", [creatorStatus.wallet]);
          if (balRes && balRes.result && balRes.result.value != null) {
            creatorSolBalanceNow = Number(balRes.result.value) / 1e9;
          }
        } catch (e) { console.warn("[AUTOPSY] Creator wallet balance fetch failed:", e.message); }
        const claimedSolNow = bagsInfo?.totalClaimedSol || bagsInfo?.lifetimeFeesSol || null;
        const knownSolSentToSubs = [...solOutByDest.values()].reduce((a, b) => a + b, 0) / 1e9;
        if (claimedSolNow != null && creatorSolBalanceNow != null) {
          unaccountedSol = claimedSolNow - boughtSol - creatorSolBalanceNow - knownSolSentToSubs;
          console.log(`[AUTOPSY] SOL verification — claimed=${claimedSolNow.toFixed(3)}  buys=${boughtSol.toFixed(3)}  currentBal=${creatorSolBalanceNow.toFixed(3)}  sentToSubs=${knownSolSentToSubs.toFixed(3)}  unaccounted=${unaccountedSol.toFixed(3)}`);
        }
        // Cross-reference against the Bags lifetime fees: how much of the SOL
        // claimed in creator fees is the wallet actually putting back into
        // buy-backs? > 80% = "reinvesting everything". Strongest project signal.
        const claimedSol = bagsInfo?.totalClaimedSol || bagsInfo?.lifetimeFeesSol || null;
        const pctReinvested = claimedSol && claimedSol > 0
          ? Math.min(100, (boughtSol / claimedSol) * 100)
          : null;
        creatorTrace = {
          sigsScanned: sigs.length,
          buyCount, sellCount, lockCount,
          transferInCount, transferOutCount,
          // Distinct recipient wallets of the creator's token transfers-out.
          // The COUNT is free (we already have the dest map); the per-wallet
          // sell-trace (did each recipient dump?) is the premium feature.
          transferOutDistinctRecipients: transferOutByDest.size,
          boughtTokens, soldTokens, lockedTokens,
          transferInTokens, transferOutTokens,
          boughtUsd, soldUsd,
          boughtSol, soldSol,
          netUsd: boughtUsd - soldUsd,
          netSol: boughtSol - soldSol,
          claimedSol,
          pctReinvested,
          firstTs, lastTs,
          // Verification balance — lets the UI flag if numbers don't add up.
          creatorSolBalanceNow,
          knownSolSentToSubs,
          unaccountedSol,
        };
        console.log(`[AUTOPSY] Phase 2G creator trace for ${creatorStatus.wallet.slice(0,8)}…: sigs=${sigs.length} buys=${buyCount}(${boughtSol.toFixed(3)} SOL) sells=${sellCount} locks=${lockCount} claimed=${claimedSol || "?"} SOL pctReinvested=${pctReinvested !== null ? pctReinvested.toFixed(0) + "%" : "—"}`);

        // Merge with best-observed cache — forensic counters can only grow,
        // so a lower fresh observation than cached is always capture failure.
        const merged = bestObservedTrace(creatorStatus.wallet, mint, creatorTrace);
        creatorTrace = merged.trace;
        creatorTrace.usedBestObservedCache = merged.usedCache;

        // ── Solana Tracker independent cross-verification ───────────────
        // Same wallet, same mint, computed server-side from their indexer
        // rather than our Helius signature scan. This is the "second
        // opinion" that lets the UI show a ✓ badge when numbers agree
        // (high confidence) or surface the discrepancy when they don't.
        // Free tier — gracefully no-op if key is missing or quota is hit.
        try {
          const stPos = await solanaTracker.getWalletTokenPosition(creatorStatus.wallet, mint);
          if (stPos) {
            // Actual response shape (verified from production debug 2026-05-21):
            //   { wallet, identity, pnlMode, token,
            //     pnl:     { realized, realizedRaw, unrealized, total },
            //     invested, proceeds, roi,
            //     current: { balance, costBasis, value, price, avgCost },
            //     volume:  { tokensBought, tokensSold, buyUsd, sellUsd },
            //     averages:{ buy, sell },
            //     counts:  { buys, sells, total },
            //     timing:  { firstBuy, lastBuy, firstTrade, lastTrade, holdTimeSecs },
            //     meta:    { symbol, name, decimals, price, marketCap, liquidity, primaryMarket } }
            // Read defensively in case a future schema tweak nests fields
            // differently — fall back to the flat shape if the namespaced
            // one isn't present.
            const pnlNs   = stPos.pnl     || {};
            const curNs   = stPos.current || {};
            const volNs   = stPos.volume  || {};
            const cntNs   = stPos.counts  || {};
            const timeNs  = stPos.timing  || {};
            const stRealized   = Number(pnlNs.realized   != null ? pnlNs.realized   : stPos.realized   || 0);
            const stUnrealized = Number(pnlNs.unrealized != null ? pnlNs.unrealized : stPos.unrealized || 0);
            const stTotal      = Number(pnlNs.total      != null ? pnlNs.total      : (stRealized + stUnrealized));
            const stBuys       = Number(cntNs.buys       != null ? cntNs.buys       : stPos.buys       || 0);
            const stSells      = Number(cntNs.sells      != null ? cntNs.sells      : stPos.sells      || 0);
            const stBalance    = Number(curNs.balance    != null ? curNs.balance    : stPos.balance    || 0);
            const stCostUsd    = Number(curNs.costBasis  != null ? curNs.costBasis  : stPos.costBasis  || 0);
            const stValueUsd   = Number(curNs.value      != null ? curNs.value      : stPos.value      || 0);
            const stBoughtUsd  = Number(volNs.buyUsd     != null ? volNs.buyUsd     : stPos.totalBought || 0);
            const stSoldUsd    = Number(volNs.sellUsd    != null ? volNs.sellUsd    : stPos.totalSold  || 0);
            const stInvested   = Number(stPos.invested   != null ? stPos.invested   : 0);
            const stProceeds   = Number(stPos.proceeds   != null ? stPos.proceeds   : 0);
            const stRoi        = Number(stPos.roi        != null ? stPos.roi        : 0);
            const stFirstBuy   = timeNs.firstBuy || null;
            const stLastBuy    = timeNs.lastBuy  || null;
            // Compare with our own counters. We treat <=20% absolute drift
            // on bought-USD or buy count as "in agreement" since the two
            // sources price slightly differently (theirs uses their own
            // OHLCV at fill time; ours uses GeckoTerminal closes).
            const ourBuys      = creatorTrace.buyCount || 0;
            const ourBoughtUsd = creatorTrace.boughtUsd || 0;
            const buysAgree    = stBuys === 0 ? ourBuys === 0
              : Math.abs(stBuys - ourBuys) / Math.max(stBuys, ourBuys, 1) <= 0.2;
            const usdAgree     = stBoughtUsd === 0 ? ourBoughtUsd === 0
              : Math.abs(stBoughtUsd - ourBoughtUsd) / Math.max(stBoughtUsd, ourBoughtUsd, 1) <= 0.2;
            // Divergence classification — not all mismatches are alarming.
            // Three states:
            //   "agree"        → numbers match within tolerance (green ✓)
            //   "st-sees-more" → ST captured MORE buys than us but both agree
            //                    on zero sells. That's just our trace being
            //                    conservative (signature-walk gaps), NOT a
            //                    red flag. Neutral/blue badge.
            //   "concerning"   → ST caught sells we missed, or the numbers
            //                    conflict in a way worth a manual look. Red.
            const ourSells = creatorTrace.sellCount || 0;
            const sellsMatch = stSells === ourSells || (stSells === 0 && ourSells === 0);
            let divergenceKind;
            if (buysAgree && usdAgree) {
              divergenceKind = "agree";
            } else if (stBuys >= ourBuys && stSells === 0 && ourSells === 0) {
              // ST sees same-or-more buys, nobody sold — pure capture gap.
              divergenceKind = "st-sees-more";
            } else {
              divergenceKind = "concerning";
            }
            // Identity tags (developer / pool / arbitrage etc.) — surface
            // them for UI labeling even if the position numbers don't agree.
            const stIdentity = stPos.identity || null;
            creatorTrace.solanaTrackerCrossCheck = {
              source: "solana-tracker /v2/pnl/wallets/{wallet}/tokens/{token}",
              pnlMode: stPos.pnlMode || "strict",
              identity: stIdentity,
              realized: stRealized,
              unrealized: stUnrealized,
              total: stTotal,
              buys: stBuys,
              sells: stSells,
              balance: stBalance,
              costBasisUsd: stCostUsd,
              valueUsd: stValueUsd,
              totalBoughtUsd: stBoughtUsd,
              totalSoldUsd: stSoldUsd,
              // Per-token "invested" (personal USD into this mint) and
              // proceeds (USD pulled out via sells). Together with ROI
              // these answer "did the dev actually put their own money in".
              invested: stInvested,
              proceeds: stProceeds,
              roi: stRoi,
              firstBuyTs: stFirstBuy,
              lastBuyTs: stLastBuy,
              // Tells the UI whether to show a green ✓ or an amber !
              agrees: buysAgree && usdAgree,
              buysAgree, usdAgree,
              // "agree" | "st-sees-more" | "concerning" — drives the badge.
              divergenceKind,
              // Useful headline fact: dev has never sold this token.
              neverSold: stSells === 0 && stSoldUsd === 0,
            };
            console.log(`[AUTOPSY] Phase 2G Solana Tracker cross-check: stBuys=${stBuys} stBoughtUsd=$${stBoughtUsd.toFixed(2)} stSells=${stSells} ourBuys=${ourBuys} ourBoughtUsd=$${ourBoughtUsd.toFixed(2)} agrees=${buysAgree && usdAgree}`);
          } else {
            console.log("[AUTOPSY] Phase 2G Solana Tracker cross-check skipped (no data — key missing or quota hit)");
          }
        } catch (e) {
          console.warn("[AUTOPSY] Phase 2G Solana Tracker cross-check failed:", e.message);
        }

        // --- Phase 2G-bis: Multi-hop sub-distributor trace ---
        // The creator often routes through sub-distributor wallets that do
        // the actual lock deposits or additional buys. To get the FULL team
        // picture, identify the top sub-distributors the creator transferred
        // CLKN to, trace their CLKN activity, and aggregate everything into
        // a "team network" total. This is what closes the gap between
        // "creator wallet buys" and "every fee went into the token".
        try {
          // Sub-distributor candidates = wallets that received either
          // significant CLKN OR significant SOL from the creator. This
          // covers BOTH paths: (a) creator buys CLKN + transfers to sub,
          // and (b) creator transfers SOL → sub buys CLKN itself. Without
          // path (b) we miss most buy-and-lock teams.
          const candidateMap = new Map();
          for (const [w, tokens] of transferOutByDest) {
            candidateMap.set(w, { wallet: w, clknTokens: tokens, solLamports: 0 });
          }
          for (const [w, lamports] of solOutByDest) {
            const existing = candidateMap.get(w) || { wallet: w, clknTokens: 0, solLamports: 0 };
            existing.solLamports = lamports;
            candidateMap.set(w, existing);
          }
          // Rank by combined "value flowed" — treat 1 SOL ≈ 1e6 CLKN units
          // for ranking purposes (rough; just needs to be in the same
          // ballpark). Then keep top 3 candidates not already in the
          // locker / LP / CEX exclusion sets.
          const subDistCandidates = [...candidateMap.values()]
            .filter(c => !traceLockerSet.has(c.wallet) && !excludeSet.has(c.wallet))
            .map(c => ({
              ...c,
              tokensReceived: c.clknTokens,
              solReceived: c.solLamports / 1e9,
              rankScore: c.clknTokens + (c.solLamports / 1e9) * 1_000_000,
            }))
            .filter(c => c.solReceived >= 0.1 || c.clknTokens > 0)
            .sort((a, b) => b.rankScore - a.rankScore)
            .slice(0, 3);
          console.log(`[AUTOPSY] Phase 2G-bis sub-distributor candidates: ${subDistCandidates.map(c => `${c.wallet.slice(0,8)}…(clkn=${Math.round(c.clknTokens)}, sol=${c.solReceived.toFixed(2)})`).join(", ") || "(none)"}`);

          const teamSubTraces = [];
          for (const cand of subDistCandidates) {
            try {
              // Walk the sub-distributor wallet's sigs (smaller cap — these
              // are secondary in the chain).
              const subSigs = [];
              let subBefore = undefined;
              for (let p = 0; p < 3; p++) {
                const params = subBefore
                  ? [cand.wallet, { limit: 1000, before: subBefore }]
                  : [cand.wallet, { limit: 1000 }];
                const r = await rpcCall(`autopsy-subdist-${cand.wallet.slice(0,8)}-${p}`, "getSignaturesForAddress", params);
                const pageSigs = r?.result || [];
                if (pageSigs.length === 0) break;
                subSigs.push(...pageSigs);
                if (pageSigs.length < 1000) break;
                subBefore = pageSigs[pageSigs.length - 1].signature;
              }
              const subSigList = subSigs.map(s => s.signature);
              let sBuy = 0, sSell = 0, sLock = 0, sTransOut = 0;
              let sBoughtTokens = 0, sSoldTokens = 0, sLockedTokens = 0;
              let sBoughtSolLamports = 0, sSoldSolLamports = 0;
              let sBoughtUsd = 0, sSoldUsd = 0;
              const subFetchResult = await heliusEnhancedBatched(
                subSigList, HELIUS_KEY, `phase-2G-sub-${cand.wallet.slice(0,6)}`, heliusTxCache, scanQuality
              );
              {
                {
                  const dataR = subFetchResult.txs;
                  for (const tx of dataR) {
                    if (!tx || tx.transactionError) continue;
                    const ts = tx.timestamp ? tx.timestamp * 1000 : null;
                    const dayKey = ts ? Math.floor(ts / 86400000) : null;
                    let dayUsd = dayKey !== null ? priceCandlesByDay.get(dayKey) : null;
                    if (!dayUsd && dayKey !== null) {
                      for (let off = 1; off <= 3 && !dayUsd; off++) {
                        dayUsd = priceCandlesByDay.get(dayKey - off) || priceCandlesByDay.get(dayKey + off) || null;
                      }
                    }
                    const isSwap = tx.type === "SWAP";
                    let netSolLamports = 0;
                    if (isSwap && Array.isArray(tx.nativeTransfers)) {
                      for (const nt of tx.nativeTransfers) {
                        if (!nt) continue;
                        if (nt.fromUserAccount === cand.wallet) netSolLamports -= Number(nt.amount) || 0;
                        else if (nt.toUserAccount === cand.wallet) netSolLamports += Number(nt.amount) || 0;
                      }
                    }
                    // Same WSOL fix as creator trace — Jupiter/Bags routes
                    // move SOL via WSOL token transfers, not native transfers.
                    const WSOL_MINT_SUB = "So11111111111111111111111111111111111111112";
                    if (isSwap && Array.isArray(tx.tokenTransfers)) {
                      for (const tt of tx.tokenTransfers) {
                        if (!tt || tt.mint !== WSOL_MINT_SUB) continue;
                        const solEquiv = Number(tt.tokenAmount) || 0;
                        const lamports = Math.round(solEquiv * 1e9);
                        if (tt.fromUserAccount === cand.wallet) netSolLamports -= lamports;
                        else if (tt.toUserAccount === cand.wallet) netSolLamports += lamports;
                      }
                    }
                    let solRecorded = false;
                    const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
                    for (const tt of tts) {
                      if (!tt || tt.mint !== mint) continue;
                      const amt = Number(tt.tokenAmount) || 0;
                      if (amt <= 0) continue;
                      if (tt.toUserAccount === cand.wallet) {
                        if (isSwap) {
                          sBuy++;
                          sBoughtTokens += amt;
                          if (dayUsd) sBoughtUsd += amt * dayUsd;
                          if (!solRecorded && netSolLamports < 0) {
                            sBoughtSolLamports += Math.abs(netSolLamports);
                            solRecorded = true;
                          }
                        }
                      } else if (tt.fromUserAccount === cand.wallet) {
                        if (isSwap) {
                          sSell++;
                          sSoldTokens += amt;
                          if (dayUsd) sSoldUsd += amt * dayUsd;
                          if (!solRecorded && netSolLamports > 0) {
                            sSoldSolLamports += netSolLamports;
                            solRecorded = true;
                          }
                        } else if (traceLockerSet.has(tt.toUserAccount)) {
                          sLock++;
                          sLockedTokens += amt;
                        } else {
                          sTransOut++;
                        }
                      }
                    }
                  }
                }
              }
              const subBoughtSol = sBoughtSolLamports / 1e9;
              const subSoldSol = sSoldSolLamports / 1e9;
              // Only include this sub-wallet if it shows TEAM-like behavior:
              // either it locked tokens (clear team signal), or it
              // accumulated more than it sold (buy-and-hold for the team).
              // Excludes wallets that received some CLKN from the creator
              // but then traded against the team (unrelated personal trading).
              const subAccumulating = sBuy > sSell && sBoughtTokens > sSoldTokens;
              const isTeamLike = sLock > 0 || (sBuy >= 3 && subAccumulating);
              if (isTeamLike) {
                teamSubTraces.push({
                  wallet: cand.wallet,
                  tokensReceivedFromCreator: cand.tokensReceived,
                  sigsScanned: subSigList.length,
                  buyCount: sBuy, sellCount: sSell, lockCount: sLock, transferOutCount: sTransOut,
                  boughtTokens: sBoughtTokens, soldTokens: sSoldTokens, lockedTokens: sLockedTokens,
                  boughtUsd: sBoughtUsd, soldUsd: sSoldUsd,
                  boughtSol: subBoughtSol, soldSol: subSoldSol,
                });
                console.log(`[AUTOPSY] Phase 2G-bis sub-trace ${cand.wallet.slice(0,8)}…: buys=${sBuy} locks=${sLock} solSpent=${subBoughtSol.toFixed(3)}`);
              }
            } catch (e) {
              console.warn(`[AUTOPSY] Phase 2G-bis sub-distributor walk failed for ${cand.wallet.slice(0,8)}:`, e.message);
            }
          }

          // Aggregate into a teamNetwork total (creator + sub-distributors).
          if (teamSubTraces.length > 0) {
            let netBuy = buyCount, netSell = sellCount, netLock = lockCount;
            let netBoughtSol = boughtSol, netSoldSol = soldSol;
            let netBoughtUsd = boughtUsd, netSoldUsd = soldUsd;
            let netLockedTokens = lockedTokens;
            for (const sub of teamSubTraces) {
              netBuy += sub.buyCount;
              netSell += sub.sellCount;
              netLock += sub.lockCount;
              netBoughtSol += sub.boughtSol;
              netSoldSol += sub.soldSol;
              netBoughtUsd += sub.boughtUsd;
              netSoldUsd += sub.soldUsd;
              netLockedTokens += sub.lockedTokens;
            }
            const netPctReinvested = claimedSol && claimedSol > 0
              ? Math.min(100, (netBoughtSol / claimedSol) * 100)
              : null;
            creatorTrace.teamNetwork = {
              walletCount: 1 + teamSubTraces.length,
              subWallets: teamSubTraces.map(s => ({
                wallet: s.wallet,
                buyCount: s.buyCount,
                lockCount: s.lockCount,
                boughtSol: s.boughtSol,
                lockedTokens: s.lockedTokens,
                tokensReceivedFromCreator: s.tokensReceivedFromCreator,
              })),
              totalBuyCount: netBuy,
              totalSellCount: netSell,
              totalLockCount: netLock,
              totalBoughtSol: netBoughtSol,
              totalLockedTokens: netLockedTokens,
              totalBoughtUsd: netBoughtUsd,
              totalSoldUsd: netSoldUsd,
              netUsd: netBoughtUsd - netSoldUsd,
              pctReinvestedNetwork: netPctReinvested,
            };
            console.log(`[AUTOPSY] Phase 2G-bis team network: wallets=${1 + teamSubTraces.length} totalBuys=${netBuy} totalLocks=${netLock} totalSolSpent=${netBoughtSol.toFixed(3)} pctReinvestedNetwork=${netPctReinvested !== null ? netPctReinvested.toFixed(0) + "%" : "—"}`);
          }
        } catch (e) {
          console.warn("[AUTOPSY] Phase 2G-bis multi-hop trace failed:", e.message);
        }
      } catch (e) {
        console.warn("[AUTOPSY] Phase 2G creator-trace failed:", e.message);
      }
    }

    // This enrichment now runs whether or not the creator sits in top 100 —
    // a creator who's "in the top 100 at rank 12" doing daily buy-backs is a
    // completely different story than one sitting dormant at rank 12. The
    // direct creator trace (Phase 2G) is authoritative when present; otherwise
    // fall back to projectWallets from the mint-side walk.
    if (creatorStatus && (creatorTrace || (walletPnl && walletPnl.projectWallets && walletPnl.projectWallets.length > 0))) {
      const creatorActivity = creatorTrace || (walletPnl && walletPnl.projectWallets.find(p => p.wallet === creatorStatus.wallet));
      if (creatorActivity) {
        const handle = bagsCreatorMeta?.username ? `@${bagsCreatorMeta.username}` : "Verified creator";
        const netUsd = creatorActivity.boughtUsd - creatorActivity.soldUsd;
        // Buy frequency: if firstTs available and they have many buys, compute
        // buys-per-active-day for the "buys every day" claim verification.
        let buyFreqStr = "";
        if (creatorActivity.firstTs && creatorActivity.buyCount > 0) {
          const daysActive = Math.max(1, (Date.now() - creatorActivity.firstTs) / 86400000);
          const buysPerDay = creatorActivity.buyCount / daysActive;
          if (buysPerDay >= 0.7) {
            buyFreqStr = ` (~${buysPerDay.toFixed(1)} buys/day on average over ${Math.round(daysActive)} days)`;
          } else if (buysPerDay >= 0.1) {
            buyFreqStr = ` (~${(buysPerDay * 7).toFixed(1)} buys/week)`;
          }
        }
        creatorStatus.onChainActivity = {
          buyCount: creatorActivity.buyCount,
          sellCount: creatorActivity.sellCount,
          lockCount: creatorActivity.lockCount || 0,
          transferInCount: creatorActivity.transferInCount || 0,
          transferOutCount: creatorActivity.transferOutCount || 0,
          boughtTokens: creatorActivity.boughtTokens,
          soldTokens: creatorActivity.soldTokens,
          // Traced lock deposits from the creator wallet (signature-walk
          // subset). Kept for the "N lock deposits" count.
          lockedTokens: creatorActivity.lockedTokens || 0,
          // Authoritative total currently locked across ALL locker PDAs,
          // from holder classification. This is what "X CLKN permanently
          // locked" should display — 145M for CLKN, not the 60M we traced.
          lockedTokensActual: lockedSupplyTokens > 0
            ? Math.max(lockedSupplyTokens, creatorActivity.lockedTokens || 0)
            : (creatorActivity.lockedTokens || 0),
          transferOutTokens: creatorActivity.transferOutTokens || 0,
          transferOutDistinctRecipients: creatorActivity.transferOutDistinctRecipients || 0,
          boughtUsd: creatorActivity.boughtUsd,
          soldUsd: creatorActivity.soldUsd,
          // SOL flow — what the user actually paid in SOL for buy-backs.
          boughtSol: creatorActivity.boughtSol || 0,
          soldSol: creatorActivity.soldSol || 0,
          netSol: creatorActivity.netSol || 0,
          claimedSol: creatorActivity.claimedSol || null,
          pctReinvested: creatorActivity.pctReinvested != null ? creatorActivity.pctReinvested : null,
          creatorSolBalanceNow: creatorActivity.creatorSolBalanceNow != null ? creatorActivity.creatorSolBalanceNow : null,
          knownSolSentToSubs: creatorActivity.knownSolSentToSubs || 0,
          unaccountedSol: creatorActivity.unaccountedSol != null ? creatorActivity.unaccountedSol : null,
          netUsd,
          lastActivityTs: creatorActivity.lastTs,
          firstActivityTs: creatorActivity.firstTs,
          buyFrequencyStr: buyFreqStr,
          // Multi-hop team network — sub-distributor wallets aggregated.
          teamNetwork: creatorActivity.teamNetwork || null,
          // Solana Tracker independent cross-verification of the above
          // numbers. Null if the key is missing, quota is hit, or the
          // wallet has no indexed PnL position yet.
          solanaTrackerCrossCheck: creatorActivity.solanaTrackerCrossCheck || null,
        };
        const isLocking = (creatorActivity.lockedTokens || 0) > 0 && (creatorActivity.lockCount || 0) >= 1;
        // Behavior correction: the Phase 2A behavior tag compared "first
        // received vs current balance" — which mislabels a buy-and-lock
        // wallet as REDUCED because locked tokens left the wallet the same
        // way a sell would. If we have proof the creator did 0 market sells
        // AND has lock deposits accounting for the gap, override the holder
        // row's behavior to "ACCUMULATED" (they put more in than they took
        // out — the locks are removal-from-circulation, not a sell).
        if (creatorStatus.inTopHolders && creatorActivity.sellCount === 0
          && (creatorActivity.lockedTokens || 0) > 0) {
          const creatorHolder = topHolders.find(h => (h.authority || h.wallet) === creatorStatus.wallet);
          if (creatorHolder && (creatorHolder.behavior === "REDUCED" || creatorHolder.behavior === "EXITED_MOSTLY")) {
            const oldBehavior = creatorHolder.behavior;
            creatorHolder.behavior = "ACCUMULATED";
            creatorHolder.behaviorOverride = {
              from: oldBehavior,
              reason: `Wallet did 0 market sells. Apparent reduction (${(creatorHolder.firstAcquiredAmount - creatorHolder.uiAmount).toLocaleString()} tokens) is explained by ${creatorActivity.lockCount} lock deposit${creatorActivity.lockCount === 1 ? "" : "s"} totaling ${Math.round(creatorActivity.lockedTokens).toLocaleString()} CLKN sent to lock contracts.`,
            };
            // Rebuild breakdown counts so summary stays consistent.
            if (behaviorBreakdown && behaviorBreakdown[oldBehavior] > 0) {
              behaviorBreakdown[oldBehavior]--;
              behaviorBreakdown.ACCUMULATED = (behaviorBreakdown.ACCUMULATED || 0) + 1;
            }
            console.log(`[AUTOPSY] Behavior override for creator ${creatorStatus.wallet.slice(0,8)}…: ${oldBehavior} → ACCUMULATED (locks=${creatorActivity.lockCount}, sells=0)`);
          }
        }
        // Override summary based on actual behavior — this REPLACES the
        // generic "is in the top 100 at rank X" with the story that matters.
        // Buy-and-lock is the strongest project signal: buy supply from market,
        // then permanently remove it via the locker. Highlight that explicitly.
        const sellsAreNegligible = creatorActivity.sellCount === 0
          || (creatorActivity.buyCount > creatorActivity.sellCount * 1.5 && creatorActivity.boughtUsd > creatorActivity.soldUsd);
        // Prefer team-network totals when sub-distributors were detected —
        // that's the honest "every fee went into the token" picture.
        const tn = creatorActivity.teamNetwork;
        const effectiveBuys = tn ? tn.totalBuyCount : creatorActivity.buyCount;
        const effectiveSells = tn ? tn.totalSellCount : creatorActivity.sellCount;
        const effectiveLocks = tn ? tn.totalLockCount : creatorActivity.lockCount;
        const effectiveBoughtSol = tn ? tn.totalBoughtSol : (creatorActivity.boughtSol || 0);
        // "Permanently locked" should reflect what's ACTUALLY locked right
        // now (holder-classification total across all locker PDAs), not just
        // the deposits we traced from the creator wallet. Phase 2G traced 60M
        // of direct deposits for CLKN; holder classification sees the real
        // 145M. Use the larger/authoritative holder total when we have it,
        // falling back to the traced number if classification found nothing.
        const tracedLockedTokens = tn ? tn.totalLockedTokens : creatorActivity.lockedTokens;
        const effectiveLockedTokens = lockedSupplyTokens > 0
          ? Math.max(lockedSupplyTokens, tracedLockedTokens || 0)
          : tracedLockedTokens;
        const effectivePctReinvested = tn ? tn.pctReinvestedNetwork : creatorActivity.pctReinvested;
        const effectiveNetUsd = tn ? tn.netUsd : netUsd;
        const networkSuffix = tn && tn.walletCount > 1
          ? ` across creator + ${tn.walletCount - 1} sub-distributor wallet${tn.walletCount - 1 === 1 ? '' : 's'}`
          : '';
        if ((isLocking || (tn && tn.totalLockCount > 0)) && effectiveBuys >= 3 && sellsAreNegligible) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` (rank ${creatorStatus.rank})` : "";
          const solStr = effectiveBoughtSol > 0
            ? ` ${effectiveBoughtSol.toFixed(2)} SOL spent on buy-backs${networkSuffix}`
            : "";
          const reinvestedStr = effectivePctReinvested != null && creatorActivity.claimedSol
            ? ` (~${effectivePctReinvested.toFixed(0)}% of the ${creatorActivity.claimedSol.toFixed(2)} SOL claimed in lifetime creator fees recycled back into buys)`
            : "";
          // Dual-funding-source insert — when Solana Tracker's independent
          // indexer captures meaningfully more buys than our trace AND the
          // extra capital is real (>$50) AND zero sells, surface BOTH
          // funding paths rather than letting "100% of fees recycled"
          // imply our trace tells the whole story. Two stacking signals:
          // fee recycling (our Phase 2G) + personal capital on top (theirs).
          const stx = creatorActivity.solanaTrackerCrossCheck;
          let dualFundingStr = "";
          if (stx && stx.sells === 0 && stx.buys > effectiveBuys && stx.invested > 50) {
            const extraBuys = stx.buys - effectiveBuys;
            const extraUsd = Math.max(0, (stx.totalBoughtUsd || 0) - (creatorActivity.boughtUsd || 0));
            const roiStr = stx.roi ? `, ${stx.roi.toFixed(0)}% ROI` : "";
            const unrealStr = stx.unrealized > 0 ? `, $${Math.round(stx.unrealized).toLocaleString()} unrealized gain` : "";
            dualFundingStr = ` Solana Tracker (independent indexer) sees ${extraBuys} additional buys funded by personal capital — ~$${Math.round(extraUsd).toLocaleString()} added on top, bringing lifetime totals to ${stx.buys} buys, $${Math.round(stx.invested).toLocaleString()} personal investment${unrealStr}${roiStr}.`;
          }
          creatorStatus.summary = `🔄🔒 ${handle}${rankSuffix} is running a buy-and-lock — ${effectiveBuys} market buys + ${effectiveLocks} lock deposits, ${effectiveSells} actual market sells lifetime${buyFreqStr}.${solStr}${reinvestedStr}.${dualFundingStr} ${Math.round(effectiveLockedTokens).toLocaleString()} CLKN permanently locked.`;
          creatorStatus.behaviorKind = "BUY_AND_LOCK";
        } else if (effectiveBuys >= 3 && effectiveBuys > effectiveSells * 1.5 && (tn ? tn.totalBoughtUsd : creatorActivity.boughtUsd) > (tn ? tn.totalSoldUsd : creatorActivity.soldUsd)) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` and sits at rank ${creatorStatus.rank}` : "";
          creatorStatus.summary = `🔄 ${handle} is actively buying back${rankSuffix} — ${creatorActivity.buyCount} buys vs ${creatorActivity.sellCount} sells lifetime${buyFreqStr}, net +$${netUsd.toFixed(2)} into the token.`;
          creatorStatus.behaviorKind = "BUY_BACK_ACTIVE";
        } else if (creatorActivity.sellCount >= 3 && creatorActivity.sellCount > creatorActivity.buyCount * 2 && creatorActivity.soldUsd > creatorActivity.boughtUsd * 1.5) {
          creatorStatus.summary = `${handle} has been net-selling — ${creatorActivity.sellCount} sells vs ${creatorActivity.buyCount} buys, net −$${Math.abs(netUsd).toFixed(2)} out. This is distribution, not buy-back behavior.`;
          creatorStatus.behaviorKind = "NET_SELLING";
          redFlags.push(`${handle} has been net-selling: ${creatorActivity.sellCount} sells vs ${creatorActivity.buyCount} buys lifetime. The fee-receiving wallet is taking tokens OUT, not putting them back.`);
        } else if (creatorActivity.buyCount > 0 || creatorActivity.sellCount > 0) {
          const rankSuffix = creatorStatus.inTopHolders && creatorStatus.rank ? ` (rank ${creatorStatus.rank})` : "";
          creatorStatus.summary = `${handle}${rankSuffix} has on-chain activity: ${creatorActivity.buyCount} buys, ${creatorActivity.sellCount} sells, net ${netUsd >= 0 ? "+" : "−"}$${Math.abs(netUsd).toFixed(2)}.`;
          creatorStatus.behaviorKind = "MIXED";
        }

        // --- Extraction overlay (hidden-dump detection) ---------------------
        // A "buy-back" / "buy-and-lock" can still be a NET EXTRACTION when the
        // creator claimed far more in fees than they recycled, or funneled a
        // large multiple of their on-market buys out to other wallets. The
        // creator's own wallet showing 0 market sells is exactly what makes a
        // dev dump hard to see — the value leaves via FEE CLAIMS and TOKEN
        // TRANSFERS, not swaps. These two factual signals catch that without
        // asserting intent (we state the chain; we don't claim the recipients
        // dumped unless a downstream trace proves it). GSD case: claimed
        // 1,135 SOL, reinvested 11%, funneled 42.7M tokens out, token -99%.
        const _claimed = creatorActivity.claimedSol || 0;
        const _reinv = effectivePctReinvested;
        const _boughtSol = creatorActivity.boughtSol || 0;
        const _outTok = creatorActivity.transferOutTokens || 0;
        const _boughtTok = creatorActivity.boughtTokens || 0;
        const _outShare = supplyTokens > 0 ? _outTok / supplyTokens : 0;
        // Fee extraction dominates when meaningful fees were claimed but only a
        // small fraction was recycled into buys.
        if (_claimed >= 10 && _reinv != null && _reinv < 50) {
          const _net = Math.max(0, _claimed - _boughtSol);
          creatorStatus.onChainActivity.feeExtractionDominant = true;
          creatorStatus.onChainActivity.netFeeExtractionSol = Number(_net.toFixed(2));
          redFlags.push(`${handle} claimed ~${_claimed.toFixed(0)} SOL in creator fees but recycled only ${_reinv.toFixed(0)}% (~${_boughtSol.toFixed(0)} SOL) back into buys — roughly ${_net.toFixed(0)} SOL kept. The buy-back is real but a minority of the money flow; fee extraction dominates.`);
        }
        // Funnel-heavy when the creator moved far more tokens OUT to other
        // wallets than they bought on-market, and it's a real share of supply.
        if (_outTok > 0 && _boughtTok > 0 && _outTok > _boughtTok * 3 && _outShare > 0.03) {
          creatorStatus.onChainActivity.funnelHeavy = true;
          creatorStatus.onChainActivity.transferOutShareOfSupply = Number((_outShare * 100).toFixed(1));
          const _recip = creatorActivity.transferOutDistinctRecipients || 0;
          const _recipStr = _recip > 0 ? ` across ${_recip} distinct wallet${_recip === 1 ? "" : "s"}` : "";
          redFlags.push(`${handle} transferred ${Math.round(_outTok).toLocaleString()} tokens (~${(_outShare * 100).toFixed(0)}% of supply) out${_recipStr} — far more than the ${Math.round(_boughtTok).toLocaleString()} bought on-market. The creator wallet shows 0 market sells, but a funnel this large is a potential hidden-exit vector: the selling may have happened from the recipient wallets.`);
        }
      }
    }

    // --- Hidden Exit Distributors: transfer-then-dump pattern ---
    // The forensic signal users care about most: a wallet that distributes
    // tokens to multiple other wallets which THEN dump them. Classic exit
    // obfuscation — the source wallet looks innocent ("just transferred to
    // friends") while the actual selling happens from the recipient wallets,
    // so they evade simple top-seller scans. Detect by walking each
    // distributor's recipient list and measuring how many recipients have
    // dumped most of what they received.
    // --- Phase 2I: Lock Attribution ---
    // For each detected lock holder account (locker / selflock category),
    // trace its single funding transaction to find WHO locked (the fee-payer
    // signer) and via WHAT platform (the program in the create instruction).
    // Every lock account has exactly one tx — created+funded, then immovable —
    // so this is cheap: one getSignaturesForAddress + one getTransaction each.
    //
    // Why account-state classification isn't enough: a Streamflow / Jupiter
    // lock leaves tokens in a self-owned escrow that, by current on-chain
    // state, is indistinguishable from a generic self-lock. The platform and
    // the locker's identity live ONLY in the funding tx. So we read it there.
    //
    // Per the forensic-evidence-rule, we label a locker "team" ONLY when its
    // wallet matches the verified creator. Otherwise it's shown neutrally —
    // it could be the team, or a conviction community holder, and we can't
    // prove which from the chain alone. Unknown locker programs are surfaced
    // by their program ID so the tool learns new lockers organically.
    const LOCK_PLATFORM_BY_PROGRAM = {
      "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m": "Streamflow",
      "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn": "Jupiter Lock",
    };
    const LOCK_INFRA_PROGRAMS = new Set([
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "ComputeBudget111111111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    ]);
    let lockAttribution = null;
    try {
      const lockHolders = topHolders.filter(h =>
        (h.category === "locker" || h.category === "selflock") && h.tokenAccount);
      if (lockHolders.length > 0) {
        // Verified team wallets — only the proven creator. We do NOT guess.
        const teamWallets = new Set();
        if (creatorStatus && creatorStatus.wallet && creatorStatus.verified !== false
          && creatorStatus.source !== "genesis-tx-fee-payer") {
          teamWallets.add(creatorStatus.wallet);
        }
        const lockers = [];
        const platformTotals = {};
        for (const lh of lockHolders.slice(0, 15)) {
          try {
            const sigRes = await rpcCall(`autopsy-lock-sigs-${lh.rank}`, "getSignaturesForAddress", [lh.tokenAccount, { limit: 1000 }]);
            const sigs = sigRes?.result || [];
            if (!sigs.length) continue;
            const fundingSig = sigs[sigs.length - 1].signature; // oldest = creation/funding
            const txRes = await rpcCall(`autopsy-lock-tx-${lh.rank}`, "getTransaction", [fundingSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
            const txr = txRes?.result;
            if (!txr) continue;
            const msg = (txr.transaction || {}).message || {};
            const keys = msg.accountKeys || [];
            const lockerWallet = (keys.find(k => k && k.signer) || {}).pubkey || null;
            // Collect every program touched (top-level + inner instructions).
            const progIds = new Set();
            (msg.instructions || []).forEach(ix => { if (ix && ix.programId) progIds.add(ix.programId); });
            ((txr.meta || {}).innerInstructions || []).forEach(inner =>
              (inner.instructions || []).forEach(ix => { if (ix && ix.programId) progIds.add(ix.programId); }));
            let platform = null, platformProgram = null;
            for (const pid of progIds) {
              if (LOCK_PLATFORM_BY_PROGRAM[pid]) { platform = LOCK_PLATFORM_BY_PROGRAM[pid]; platformProgram = pid; break; }
            }
            if (!platform) {
              // No recognized locker — surface the non-infrastructure program
              // so we can identify and name it later. If there's only infra,
              // it's a plain self-owned lock (authority set to self / burned).
              platformProgram = [...progIds].find(p => !LOCK_INFRA_PROGRAMS.has(p)) || null;
              platform = platformProgram ? "Unrecognized locker" : "Self-owned lock";
            }
            const isTeam = !!(lockerWallet && teamWallets.has(lockerWallet));
            lockers.push({
              lockAccount: lh.tokenAccount,
              lockerWallet,
              amount: lh.uiAmount,
              share: lh.share,
              platform,
              platformProgram,
              isTeam,
              fundingSig,
            });
            platformTotals[platform] = (platformTotals[platform] || 0) + (lh.share || 0);
          } catch (e) {
            console.warn(`[AUTOPSY] Phase 2I lock trace failed for ${lh.tokenAccount.slice(0,8)}:`, e.message);
          }
        }
        if (lockers.length > 0) {
          const totalShare = lockers.reduce((s, l) => s + (l.share || 0), 0);
          const teamShare = lockers.filter(l => l.isTeam).reduce((s, l) => s + (l.share || 0), 0);
          lockAttribution = {
            lockers: lockers.sort((a, b) => (b.share || 0) - (a.share || 0)),
            totalLockedShare: totalShare,
            teamLockedShare: teamShare,
            // "Unlabeled" = locked by wallets we can't verify as team. Could be
            // team or conviction community holders — we don't assert which.
            unlabeledLockedShare: totalShare - teamShare,
            platformTotals,
          };
          console.log(`[AUTOPSY] Phase 2I lock attribution: ${lockers.length} locks, ${(totalShare * 100).toFixed(1)}% total (${(teamShare * 100).toFixed(1)}% verified-team, rest unlabeled), platforms: ${Object.keys(platformTotals).join(", ")}`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Phase 2I lock attribution failed:", e.message);
    }

    let hiddenExitDistributors = [];
    try {
      if (distributors && distributors.length > 0 && topHolders && topHolders.length > 0) {
        // Build a set of "legitimate" source wallets to exclude — verified
        // Bags / Pump creator wallets and recognized lockers. Their transfers
        // are normal team distribution, not hidden exits.
        const legitSourceSet = new Set();
        if (projectFeeWalletMap && projectFeeWalletMap.size > 0) {
          for (const w of projectFeeWalletMap.keys()) legitSourceSet.add(w);
        }
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if ((h.category === "locker" || h.category === "selflock" || h.category === "lp") && addr) {
            legitSourceSet.add(addr);
          }
        }

        for (const d of distributors) {
          if (legitSourceSet.has(d.sourceWallet)) continue;
          const recipientStats = (d.recipients || []).map(r => {
            const h = topHolders.find(th => (th.authority || th.wallet) === r.authority);
            if (!h || !h.firstAcquiredAmount || h.firstAcquiredAmount <= 0) return null;
            const cur = Number(h.uiAmount) || 0;
            const first = Number(h.firstAcquiredAmount) || 0;
            const dumpRatio = first > 0 ? Math.max(0, (first - cur) / first) : 0;
            return {
              rank: r.rank,
              authority: r.authority,
              receivedAmount: first,
              currentBalance: cur,
              dumpRatio,
              dumpedMost: dumpRatio > 0.7,
              dumpedHalf: dumpRatio > 0.5,
              status: dumpRatio > 0.95 ? "EXITED"
                : dumpRatio > 0.7 ? "DUMPED_MOST"
                : dumpRatio > 0.3 ? "TRIMMED"
                : dumpRatio < -0.2 ? "ACCUMULATED"
                : "HELD",
            };
          }).filter(Boolean);
          if (recipientStats.length < 2) continue;
          const dumpedMostCount = recipientStats.filter(r => r.dumpedMost).length;
          const dumpedHalfCount = recipientStats.filter(r => r.dumpedHalf).length;
          const exitedCount = recipientStats.filter(r => r.status === "EXITED").length;
          const dumpedMostPct = dumpedMostCount / recipientStats.length;
          // Threshold: 50%+ of recipients dumped > 70% of what they received.
          // For 2-recipient distributors require both; for 3+ require majority.
          const isCoordinatedExit = recipientStats.length >= 2 && dumpedMostPct >= 0.5;
          if (isCoordinatedExit) {
            hiddenExitDistributors.push({
              sourceWallet: d.sourceWallet,
              totalRecipients: recipientStats.length,
              dumpedMostCount,
              dumpedHalfCount,
              exitedCount,
              dumpedMostPct,
              // Was the source wallet ITSELF a seller? Cross-reference walletPnl
              // to flag the strongest "transfer-out + sell-the-rest" combo.
              sourceAlsoSold: (() => {
                if (!walletPnl) return null;
                const sp = (walletPnl.topSellers || []).find(s => s.wallet === d.sourceWallet);
                if (sp) return { soldUsd: sp.soldUsd, sellCount: sp.sellCount };
                return null;
              })(),
              recipientStats,
            });
          }
        }

        // Red flags for any coordinated-exit patterns we found.
        for (const ex of hiddenExitDistributors) {
          const srcShort = ex.sourceWallet.slice(0, 8) + "…";
          const alsoSold = ex.sourceAlsoSold
            ? ` AND the source wallet itself sold $${ex.sourceAlsoSold.soldUsd.toFixed(0)} across ${ex.sourceAlsoSold.sellCount} swaps`
            : "";
          redFlags.push(`🚨 HIDDEN-EXIT PATTERN: Wallet ${srcShort} transferred to ${ex.totalRecipients} top holders and ${ex.dumpedMostCount} of them have dumped > 70% of what they received${alsoSold}. Coordinated transfer-then-dump signature — the source wallet looks clean on a simple sell scan, but the recipients are the ones doing the selling.`);
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] Hidden-exit distributor detection failed:", e.message);
    }

    // --- Soften bulk-distribution red flag for bonding-curve tokens ---
    // For Bags/Pump tokens it's common for one bonding-curve buyer to be the
    // team's distribution wallet — they bought in size during the BC then
    // distributed to a holder list. That's a legitimate launch pattern, not
    // an insider rug. We don't suppress the signal entirely (it's still
    // useful information), but we add context so it's not read as fraud.
    if (bondingCurveActive() && distributors && distributors.length > 0) {
      // Find any bulk-distribution flag we added earlier and reframe it.
      for (let i = 0; i < redFlags.length; i++) {
        if (redFlags[i].includes("distributed tokens to") && redFlags[i].includes("top 20 holders")) {
          redFlags[i] += " (Context: this token launched via a bonding-curve platform — a single wallet distributing to many top holders is consistent with the team buying through the BC and then distributing to a known holder list, which is a legitimate launch pattern. Verify the distributor wallet's history before treating this as insider activity.)";
        }
      }
    }

    // --- TRANSFER source enrichment ---
    // A holder labeled "WALLET TRANSFER from <opaque hash>" looks suspicious
    // even when the source is a known team-distribution wallet (a wallet that
    // bought big on the bonding curve then airdropped to a holder list — a
    // legitimate pattern for Bags/Pump launches with a previous-project list).
    // Enrich each TRANSFER holder with what the source wallet actually IS, so
    // the UI can show "from team distribution wallet" instead of a raw hash.
    // FORENSIC PRINCIPLE: we only label a wallet "team" / "creator" when we
    // have VERIFIED evidence — i.e., it's registered with Bags or Pump as an
    // official creator. Everything else gets a factual, neutral label that
    // describes what the wallet DID without assuming intent. A wallet that
    // received from a verified creator could be a legitimate sub-distributor
    // OR a coordinated dump-prep wallet — on-chain data alone can't tell
    // them apart, so we don't pretend it can.
    try {
      const distSourceSet = new Set((distributors || []).map(d => d.sourceWallet));
      const bagsCreatorWallets = new Set(
        (bagsInfo?.officialCreators || []).map(c => c.wallet).filter(Boolean)
      );

      for (const h of topHolders) {
        if (h.acquisitionType === "TRANSFER" && h.acquisitionSource) {
          const src = h.acquisitionSource;
          if (bagsCreatorWallets.has(src)) {
            // PROVEN — Bags creator/v3 explicitly lists this wallet.
            h.acquisitionSourceKind = "bags-creator";
            h.acquisitionSourceContext = "Bags-verified creator wallet";
          } else if (distSourceSet.has(src)) {
            // Distributor — neutral fact only. Does NOT claim team status.
            // Could be team operations, could be coordinated insider
            // distribution, could be a public airdrop. The data shows what
            // happened, not WHY.
            const dist = (distributors || []).find(d => d.sourceWallet === src);
            const cnt = dist ? (dist.walletRecipientsInTop20 || dist.recipientsInTop20 || 0) : 0;
            h.acquisitionSourceKind = "distributor";
            h.acquisitionSourceContext = cnt >= 2
              ? `Distributor wallet (sent to ${cnt} top-20 holders — origin not verified)`
              : null;
          } else if (dbcBuyerSet && dbcBuyerSet.has(src)) {
            // PROVEN — we walked the DBC pool and saw this wallet buy.
            h.acquisitionSourceKind = "bc-buyer";
            h.acquisitionSourceContext = bagsInfo ? "Bags bonding-curve buyer (verified)" : "Pump bonding-curve buyer (verified)";
          }
        }
      }
    } catch (e) {
      console.warn("[AUTOPSY] TRANSFER source enrichment failed:", e.message);
    }

    // --- Solscan enrichment pass ---
    // Independent wallet labels (CEX hot wallets, market makers, known team
    // wallets, etc.) for any counterparty we don't already recognize. Pulls
    // labels from Solscan in batch with a small concurrency cap to be polite
    // to the free-tier quota. Degrades to no-op if the API key is missing.
    let solscanHolderCount = null;
    if (solscan.isConfigured()) {
      try {
        // Independent holder count — third source alongside Helius (our walk)
        // and Jupiter (their indexer). When all three agree, high confidence.
        solscanHolderCount = await solscan.getTokenHolderCount(mint);
        // Collect addresses that need a label: top-100 holders that aren't
        // already classified as LP/locker/program, plus distinct distributor
        // sources, plus distinct TRANSFER acquisition-sources. Cap total
        // batch at 60 addresses per autopsy to stay quota-friendly.
        const needLabels = new Set();
        for (const h of topHolders) {
          if (h.category !== "wallet") continue;
          const addr = h.authority || h.wallet;
          if (addr) needLabels.add(addr);
          if (h.acquisitionSource) needLabels.add(h.acquisitionSource);
        }
        for (const d of (distributors || [])) {
          if (d.sourceWallet) needLabels.add(d.sourceWallet);
        }
        const addrs = [...needLabels].slice(0, 60);
        const labelMap = await solscan.batchAccountLabels(addrs);
        // Apply labels to topHolders + distributors
        for (const h of topHolders) {
          const addr = h.authority || h.wallet;
          if (addr && labelMap.get(addr)) h.solscanLabel = labelMap.get(addr);
          if (h.acquisitionSource && labelMap.get(h.acquisitionSource)) {
            h.acquisitionSourceSolscanLabel = labelMap.get(h.acquisitionSource);
          }
        }
        for (const d of (distributors || [])) {
          if (d.sourceWallet && labelMap.get(d.sourceWallet)) {
            d.solscanLabel = labelMap.get(d.sourceWallet);
          }
        }
        const labelHitCount = [...labelMap.values()].filter(Boolean).length;
        console.log(`[AUTOPSY] Solscan: labels requested for ${addrs.length} wallets, ${labelHitCount} returned non-null. holderCount=${solscanHolderCount}`);
      } catch (e) {
        console.warn("[AUTOPSY] Solscan enrichment failed:", e.message);
      }
    }

    // --- Extraction verdict correction (hidden dev-dump guard) -------------
    // The base verdict ladder runs before the creator trace, so a token that
    // is technically still trading (real liquidity + volume) lands on ALIVE /
    // "AUTOPSY CANCELED" even when the creator quietly extracted heavily via
    // FEES and TOKEN TRANSFERS rather than market sells. That cheerful frame
    // is the exact false-reassurance failure mode this tool exists to avoid.
    // Once the creator analysis has run, downgrade an ALIVE verdict to AT_RISK
    // when the extraction overlay fired AND the price has genuinely collapsed
    // (so we don't ding a healthy token whose creator merely claimed fees).
    {
      const oa = creatorStatus && creatorStatus.onChainActivity;
      const extractionFlag = oa && (oa.feeExtractionDominant || oa.funnelHeavy);
      const drawdown = priceHistory && priceHistory.drawdownFromPeakPct != null ? priceHistory.drawdownFromPeakPct : null;
      const collapsed = (drawdown != null && drawdown <= -80) || (priceChangeH24 != null && priceChangeH24 <= -50);
      if (verdict.severity === "ALIVE" && extractionFlag && collapsed) {
        verdict = { type: "CREATOR_EXTRACTED", label: "Status: TRADING — BUT CREATOR EXTRACTED", severity: "AT_RISK", color: "#F59E0B", icon: "🩸" };
        reportMode = "health-assessment";
        reportHeadline = "🩸 AUTOPSY ON STANDBY";
        reportSubhead = oa.funnelHeavy && oa.feeExtractionDominant
          ? "Still trading, but the creator extracted value via fees and funneled a large share of supply out to other wallets while the price collapsed. Their own wallet shows no market sells — the dump hid in fee claims and transfers."
          : oa.feeExtractionDominant
          ? "Still trading, but the creator claimed far more in fees than they recycled while the price collapsed. The buy-back is real but a minority of the money flow."
          : "Still trading, but the creator funneled a large share of supply out to other wallets while the price collapsed — a potential hidden-exit vector.";
      }
    }

    // --- AI Narration (Claude Haiku, Cluck's voice, deterministic facts only) ---
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    let narrative = null;
    if (ANTHROPIC_KEY) {
      const facts = {
        symbol, name,
        verdict: verdict.type,
        ageDays: ageDays !== null ? Math.round(ageDays) : null,
        totalLiquidityUsd: Number(totalLiqUsd.toFixed(2)),
        volume24hUsd: Number(totalVol24h.toFixed(2)),
        priceChange1h:  priceChangeH1  !== null ? `${priceChangeH1  >= 0 ? "+" : ""}${priceChangeH1.toFixed(1)}%`  : null,
        priceChange6h:  priceChangeH6  !== null ? `${priceChangeH6  >= 0 ? "+" : ""}${priceChangeH6.toFixed(1)}%`  : null,
        priceChange24h: priceChangeH24 !== null ? `${priceChangeH24 >= 0 ? "+" : ""}${priceChangeH24.toFixed(1)}%` : null,
        buys24h, sells24h,
        mintAuthorityActive: !!mintAuthority,
        freezeAuthorityActive: !!freezeAuthority,
        // Token-2022 extension risks (modern honeypot vectors). Only present
        // for Token-2022 mints; null/empty for standard SPL tokens. When a
        // honeypot-grade extension is present this is the headline finding.
        token2022: isToken2022 ? {
          isToken2022: true,
          transferFeePct: transferFeeBps != null ? `${(transferFeeBps / 100).toFixed(2)}%` : null,
          risks: token2022Risks.map(r => ({ kind: r.kind, severity: r.severity, label: r.label })),
          hasHoneypotExtension,
          note: hasHoneypotExtension
            ? "HONEYPOT-GRADE Token-2022 extension present (non-transferable, default-frozen, active transfer hook, or ~100% transfer fee). This is the headline — buyers cannot reliably sell. Lead with it and name the exact mechanism from risks[]."
            : token2022Risks.length > 0
            ? "Token-2022 extensions present that affect trading (transfer fee and/or permanent delegate). Name them plainly as costs/risks; a permanent delegate means holdings are seizable, a transfer fee taxes every trade."
            : "Token-2022 mint with no dangerous extensions detected — note the program but no extension-based red flag.",
        } : null,
        top10Concentration: top10Share !== null ? `${(top10Share * 100).toFixed(0)}%` : null,
        priceUsd, fdv, marketCap,
        poolCount: solPairs.length,
        topHolderForensics: {
          lockedSupplyShare: `${(lockedSupplyShare * 100).toFixed(1)}%`,
          humanSupplyShare: `${(humanSupplyShare * 100).toFixed(1)}%`,
          snipersInTop20: holderBreakdown.sniper,
          earlyBuyersInTop20: holderBreakdown.very_early + holderBreakdown.early,
          bondingCurveBuyersInTop20: holderBreakdown.bonding_curve,
          prePoolHoldersInTop20: holderBreakdown.pre_pool,
          lockedPositionsInTop20: holderBreakdown.locker + holderBreakdown.selflock,
          lpPositionsInTop20: holderBreakdown.lp,
          holding: behaviorBreakdown.HELD,
          accumulated: behaviorBreakdown.ACCUMULATED,
          reduced: behaviorBreakdown.REDUCED,
          exitedMostly: behaviorBreakdown.EXITED_MOSTLY,
        },
        // Lock attribution — who locked supply, via what platform. Feed this
        // so the narrator credits locked supply as conviction and NEVER reads
        // "creator not a top holder" as "abandoned" when supply is locked.
        // teamLocked = verified-creator locks; unlabeledLocked = locks by
        // wallets we can't prove are team (could be team OR community holders
        // — do NOT assert which).
        lockAttribution: lockAttribution ? {
          totalLockedPctOfSupply: `${(lockAttribution.totalLockedShare * 100).toFixed(1)}%`,
          teamVerifiedLockedPct: `${(lockAttribution.teamLockedShare * 100).toFixed(1)}%`,
          unlabeledLockedPct: `${(lockAttribution.unlabeledLockedShare * 100).toFixed(1)}%`,
          lockerWalletCount: lockAttribution.lockers.length,
          platforms: Object.keys(lockAttribution.platformTotals),
          note: "Unlabeled locks are by wallets not verified as team — they may be team OR conviction community holders. Do not claim which. Locked supply is removed from circulation; treat it as a commitment signal, not 'abandoned'.",
        } : null,
        // Creator wallet profile — established operator wallet vs fresh
        // throwaway deployer, plus funding source for fresh wallets.
        creatorWalletProfile: creatorWalletProfile ? {
          established: creatorWalletProfile.isEstablished,
          txCountAtLeast: creatorWalletProfile.txCountAtLeast,
          deployedTokenCount: creatorWalletProfile.deployedTokenCount,
          deployedTokenCountExact: creatorWalletProfile.deployedTokenCountExact,
          isSerialDeployer: creatorWalletProfile.isSerialDeployer,
          fundedBy: creatorWalletProfile.fundingSource
            ? (creatorWalletProfile.fundingSource.label || creatorWalletProfile.fundingSource.wallet)
            : null,
          note: creatorWalletProfile.isSerialDeployer
            ? "SERIAL DEPLOYER — this wallet has launched many tokens. A long tx history here is a token-mill signal, NOT a committed operator. Do NOT describe it as 'established/verified operator' in a reassuring way; name the serial-launch pattern."
            : creatorWalletProfile.deployedTokenCount != null && creatorWalletProfile.deployedTokenCount > 1
            ? `Creator wallet has deployed ${creatorWalletProfile.deployedTokenCount} tokens — has launched others before. Mention neutrally; established history is a fact, not a safety guarantee.`
            : creatorWalletProfile.isEstablished
            ? "Active wallet with a long tx history. State neutrally — a long history is a fact, NOT proof of legitimacy (serial ruggers also have long histories). Don't call it 'verified operator' as if it's reassuring."
            : "Fresh/low-activity wallet. If fundedBy is set, that's who sent it its first SOL — a fresh deployer funded from a single source right before launch is an obfuscation pattern worth naming neutrally.",
        } : null,
        // Pump.fun creator-fee signal (when present). unclaimedSol is what's
        // sitting in the creator's fee vault right now; feeEventCount is how
        // many on-chain fee events the vault has seen (activity proxy).
        pumpCreatorFees: pumpCreatorFees ? {
          unclaimedSol: pumpCreatorFees.unclaimedSol,
          lifetimeClaimedSol: pumpCreatorFees.lifetimeClaimedSol,
          lifetimeTotalSol: pumpCreatorFees.lifetimeTotalSol,
          feeEventCount: pumpCreatorFees.feeEventCount,
          feeEventsCapped: pumpCreatorFees.feeEventsCapped,
          note: "Pump.fun creator fees accrue in an on-chain vault. lifetimeClaimedSol is how much the creator has pulled OUT of this token's fee vault over its life; unclaimedSol is what's still sitting there. lifetimeTotalSol = claimed + unclaimed = total creator-fee revenue realized from this token. If feeEventsCapped is true, claimed is a lower bound (vault history exceeded 1000 events).",
        } : null,
        lifetimeAnalysis: lifetime ? {
          mintedDaysAgo: lifetime.genesisTimestamp ? Math.round((Date.now() - lifetime.genesisTimestamp) / 86400000) : null,
          totalKnownSignatures: lifetime.totalKnownSignatures,
          signatureHistoryTruncated: lifetime.signatureHistoryTruncated,
          bondingCurveDetected: lifetime.bondingCurveDetected,
          bondingCurveSource: lifetime.bondingCurveSource,
          postLaunchMintEvents: lifetime.keyEvents.filter(e => e.type === "MINT_EVENT").length,
          burnEventsObserved: lifetime.keyEvents.filter(e => e.type === "BURN_EVENT").length,
          totalBurnedObserved: lifetime.totalBurnedObserved,
          burnedAsShareOfSupply: supplyTokens > 0 && lifetime.totalBurnedObserved > 0 ? `${(lifetime.totalBurnedObserved / supplyTokens * 100).toFixed(2)}%` : null,
          largeTransfersObserved: lifetime.keyEvents.filter(e => e.type === "LARGE_TRANSFER").length,
          airdropEventsObserved: lifetime.airdropEvents.length,
          dustDropEventsObserved: lifetime.airdropEvents.filter(a => a.kind === "dust").length,
          totalAirdropRecipients: lifetime.airdropEvents.reduce((s, a) => s + a.recipients, 0),
          keyEventCount: lifetime.keyEvents.length,
        } : null,
        creatorStatus: creatorStatus ? {
          inTopHolders: creatorStatus.inTopHolders,
          rank: creatorStatus.rank || null,
          behavior: creatorStatus.behavior || null,
          behaviorKind: creatorStatus.behaviorKind || null,
          summary: creatorStatus.summary,
          onChainActivity: creatorStatus.onChainActivity || null,
        } : null,
        // Explicit count clarity — these are over the TOP 100 holders, NOT
        // top 20. Stops the AI from writing "of the top 20, 22 are pre-pool"
        // which is mathematically impossible.
        topHoldersScannedCount: topHolders.length,
        acquisitionBreakdown: (() => {
          const counts = { BOUGHT: 0, TRANSFER: 0, MINTED: 0, OTHER: 0, UNKNOWN: 0 };
          topHolders.filter(h => h.category === "wallet").forEach(h => {
            counts[h.acquisitionType || "UNKNOWN"] = (counts[h.acquisitionType || "UNKNOWN"] || 0) + 1;
          });
          return counts;
        })(),
        distributorCount: distributors.length,
        topDistributorRecipients: distributors[0]?.recipientsInTop20 || 0,
        // Critical: is the top distributor the VERIFIED creator wallet? If
        // yes, this is team distribution (migration / airdrop to past
        // supporters / community allocation), NOT insider rugging.
        topDistributorIsVerifiedCreator: !!(distributors[0] && distributors[0].isVerifiedTeamWallet),
        bagsLaunch: bagsInfo ? {
          isBagsToken: true,
          status: bagsInfo.status,
          symbol: bagsInfo.symbol,
          // Bags graduation status from Solana Tracker (market "meteora-curve"
          // = still on the Bags DBC curve; graduated = migrated to Meteora
          // DAMM). onBondingCurve true means NO DEX pool yet — that's normal,
          // not a rug; the real liquidity is the curve reserve (stLiquidityUsd).
          graduated: bagsInfo.graduated != null ? bagsInfo.graduated : null,
          onBondingCurve: bagsInfo.onBondingCurve === true,
          curvePercentage: bagsInfo.curvePercentage != null ? bagsInfo.curvePercentage : null,
          stLiquidityUsd: bagsInfo.stLiquidityUsd != null ? bagsInfo.stLiquidityUsd : null,
          market: bagsInfo.market || null,
          officialCreators: bagsInfo.officialCreators.map(c => `${c.provider}:${c.username}`),
          dbcSignaturesScanned: bagsInfo.dbcSignaturesScanned,
          dbcBuyersIdentified: bagsInfo.dbcBuyersIdentified,
          dbcBuyersInTop100: topHolders.filter(h => h.dbcVerified).length,
          lifetimeFeesSol: bagsInfo.lifetimeFeesSol,
          totalClaimedSol: bagsInfo.totalClaimedSol,
          claimEventCount: bagsInfo.claimEventCount,
          daysSinceLastClaim: bagsInfo.lastClaimTimestamp ? Math.round((Date.now() - bagsInfo.lastClaimTimestamp) / 86400000) : null,
          feeWalletsInTop100: topHolders.filter(h => h.projectFeeWallet && h.projectFeeWallet.source === "bags").length,
        } : null,
        creatorVerification: {
          source: effectiveCreatorSource,
          isPlatformUnverified: effectiveCreatorSource === "unverified-platform-launch",
        },
        pumpLaunch: pumpInfo ? {
          isPumpToken: true,
          // Graduation is authoritative from Solana Tracker's pool market:
          // "pumpfun" = STILL on the bonding curve; PumpSwap/Raydium/Meteora
          // = graduated. null = unknown (don't assert either way).
          graduated: pumpInfo.complete,
          onBondingCurve: pumpInfo.onBondingCurve === true,
          curvePercentage: pumpInfo.curvePercentage != null ? pumpInfo.curvePercentage : null,
          market: pumpInfo.market || null,
          // Real liquidity from ST (the bonding-curve reserve pre-graduation,
          // or the DEX pool post-graduation) — present even when DexScreener
          // shows $0 because it dropped/never-indexed the pair.
          stLiquidityUsd: pumpInfo.stLiquidityUsd != null ? pumpInfo.stLiquidityUsd : null,
          symbol: pumpInfo.symbol,
          creator: pumpInfo.creator,
          hasSocials: !!(pumpInfo.twitter || pumpInfo.telegram || pumpInfo.website),
          bcSignaturesScanned: pumpInfo.bcSignaturesScanned || 0,
          bcBuyersIdentified: pumpInfo.bcBuyersIdentified || 0,
          bcBuyersInTop100: topHolders.filter(h => h.dbcVerified).length,
          pumpEraPeakPriceUsd: pumpInfo.priceHistory?.peakPrice || null,
        } : null,
        hiddenExitPatterns: hiddenExitDistributors && hiddenExitDistributors.length > 0 ? {
          count: hiddenExitDistributors.length,
          topPattern: hiddenExitDistributors[0] ? {
            sourceShort: hiddenExitDistributors[0].sourceWallet.slice(0, 8) + "…",
            totalRecipients: hiddenExitDistributors[0].totalRecipients,
            dumpedMostCount: hiddenExitDistributors[0].dumpedMostCount,
            exitedCount: hiddenExitDistributors[0].exitedCount,
            sourceAlsoSold: !!hiddenExitDistributors[0].sourceAlsoSold,
          } : null,
        } : null,
        pnlLedger: walletPnl ? {
          walletsAnalyzed: walletPnl.walletsAnalyzed,
          signaturesScanned: walletPnl.signaturesScanned,
          coverageMode: walletPnl.coverageMode,
          topSellerSoldUsd: walletPnl.topSellers[0]?.soldUsd || 0,
          topSellerSoldTokens: walletPnl.topSellers[0]?.soldTokens || 0,
          topBuyerBoughtUsd: walletPnl.topBuyers[0]?.boughtUsd || 0,
          biggestWinnerRealizedUsd: walletPnl.madeMoney[0]?.realizedPnlUsd || 0,
          biggestLoserRealizedUsd: walletPnl.gotWrecked[0]?.realizedPnlUsd || 0,
          tookTheMoneyCount: walletPnl.tookTheMoney.length,
          tookTheMoneyTopProfitUsd: walletPnl.tookTheMoney[0]?.realizedPnlUsd || 0,
        } : null,
        priceHistory: priceHistory ? {
          peakPriceUsd: priceHistory.peakPrice,
          peakMarketCapUsd: priceHistory.peakMarketCap,
          peakDaysAgo: priceHistory.peakTimestamp ? Math.round((Date.now() - priceHistory.peakTimestamp) / 86400000) : null,
          currentPriceUsd: priceHistory.currentPrice,
          drawdownFromPeakPct: priceHistory.drawdownFromPeakPct !== null ? `${priceHistory.drawdownFromPeakPct.toFixed(1)}%` : null,
          historyDays: priceHistory.candleCount,
          // Multi-window volume context — surfaces 7d / 30d sums so a
          // single quiet day doesn't make a healthy token look UNCLEAR.
          volumeWindows: priceHistory.volumeWindows || null,
        } : null,
        redFlags,
        lpLock: lpStatus ? { status: lpStatus.status, lpBurnPct: lpStatus.lpBurnPct, note: lpStatus.label } : null,
        cexPresence: cexPresence ? { exchanges: cexPresence.exchanges, note: `Listed/custodied by ${cexPresence.exchanges.length} exchange(s) (${cexPresence.exchanges.slice(0, 5).join(", ")}${cexPresence.exchanges.length > 5 ? `, +${cexPresence.exchanges.length - 5} more` : ""}) among the true top holders — a legitimacy signal (cleared CEX due diligence; adds off-chain order-book liquidity not visible on-chain). ~${Math.round((cexPresence.top10Share || 0) * 100)}% of supply is exchange-custodied — custodial, not single-entity concentration.` } : null,
        creatorVerification: creatorVerification ? { status: creatorVerification.status, note: creatorVerification.status === "verified" ? `Creator identity is verified on Bags: ${creatorVerification.handles.map(h => "@" + h.username).join(", ")} (${creatorVerification.handles[0].provider}). A named, verified human is attached to the fee wallet — an accountability signal.` : `Bags token but no verified social is linked to the creator wallet(s) — an anonymous fee earner. Not inherently bad (many legit devs stay anon), but there's no verified identity to hold accountable.` } : null,
        metadata: metadataStatus ? { status: metadataStatus.status, mutable: metadataStatus.mutable, updateAuthority: metadataStatus.updateAuthority, note: metadataStatus.label } : null,
      };
      const modeIntro = reportMode === "health-checkup"
        ? "You are Cluck Norris, a wry, blunt, no-hype crypto sensei. The user paste a token expecting an autopsy — but this patient is alive and trading. AUTOPSY CANCELED. Open by acknowledging you came with the scalpel and didn't need it, then deliver a Full Health Checkup using the verified on-chain facts. Same forensic depth, but framed as a physical, not a post-mortem. Do NOT use death language (corpse, post-mortem, cause of death, dying, fade). Use checkup/health/vital-signs language instead."
        : reportMode === "health-assessment"
        ? "You are Cluck Norris, a wry, blunt, no-hype crypto sensei. The user paste a token expecting an autopsy — but this patient is alive, just bruised. AUTOPSY ON STANDBY. Open by acknowledging the patient is alive but showing warning signs / heavy retracement, then deliver a Health Assessment using the verified on-chain facts. Honest about concerns, but not a death certificate. Avoid 'corpse' / 'post-mortem' language; use 'health' / 'patient' / 'recovery' / 'warning signs' framing."
        : "You are Cluck Norris, a wry, blunt, no-hype crypto sensei narrating a forensic post-mortem on a Solana token. You receive verified on-chain facts and must explain what happened — or what state the token is in — as a teaching case study.";
      const sysPrompt = `${modeIntro}

STRICT RULES:
- ONLY use the facts you are given. Never invent numbers, dates, wallet addresses, or events that are not in the data.
- Voice: blunt, dry, slightly wry. For dead/dying tokens, treat the token as a teachable corpse. For alive tokens, treat them as a live patient — describe vital signs and overall health, not death. No hype, no shilling, no price predictions.
- Length: 2 to 3 short paragraphs. Mobile reading.
- Reference the specific red flags by what they are. Be specific about the verdict.
- End with one sentence naming the lesson the reader should take. Something like: "The tell was X — exactly the kind of pattern the Rugs lesson teaches you to spot."
- If the verdict is ALIVE or UNCLEAR, narrate that honestly. Do not invent a death.
- READ THE PRICE TREND. A token can have low 24h volume and still be appreciating (quiet accumulation, not a fade), or be moving down (active distribution). If priceChange24h is positive, do not call it a "slow fade" or "quiet death" — it is trending up on thin volume, which is a different story.
- READ THE TOP-HOLDER FORENSICS. The topHolderForensics block tells you how the top 20 broke down: how many are in locks vs LP vs human wallets; how many were launch snipers vs early buyers vs later; how many bought through a bonding curve vs received tokens pre-pool; how many of the humans are still holding vs sold vs accumulated more. Reference this when it tells a story.
  CRITICAL on "pre-pool" / "bonding curve": for a Bags.fm or Pump.fun token (bondingCurveDetected true, or the mint ends in "pump"/"BAGS"), holders who acquired BEFORE the DEX pool existed bought ON THE BONDING CURVE before the token graduated to its public pool (e.g. Meteora). This is the NORMAL early-buyer path — they are NOT pre-launch insiders and did NOT "receive an allocation before launch." NEVER describe bonding-curve / pre-graduation buyers as insider distribution or pre-launch allocations. The "possible insider distribution" read ONLY applies to a NON-launchpad token where wallets received tokens before any pool with no bonding-curve mechanism at all. When in doubt on a launchpad token, call them "early bonding-curve buyers," not insiders.
- READ THE LIFETIME ANALYSIS. lifetimeAnalysis.mintedDaysAgo tells you when the token was created. postLaunchMintEvents > 0 means the mint authority was actually USED to print supply after launch — name that explicitly as proven dilution, not just theoretical risk. bondingCurveDetected being true means this is a Bags.fm or Pump.fun graduated token; reflect that in how you describe early holders.
- READ THE PRICE HISTORY EXACTLY. priceHistory.drawdownFromPeakPct tells you the drop from the daily-close peak in the DEX-pool's history. priceHistory.peakDaysAgo gives the EXACT number of days since that peak. CRITICAL: use peakDaysAgo verbatim — NEVER invent timeframes like "first week" or "seven weeks" unless they match peakDaysAgo. If peakDaysAgo is 54, say "peaked 54 days ago," not "in the first week" or any other fabricated phrase. Also remember: for graduated Bags.fm or Pump.fun tokens, the price history starts at GRADUATION, not at token mint — so the "peak" may be the post-graduation settled price, not the bonding-curve high. Be honest about which window you're reading.
- READ THE CREATOR STATUS. creatorStatus tells you what the wallet that paid for the genesis tx has done with their position. CRITICAL: "not in the top 20/100 holders" does NOT automatically mean the creator exited or distributed — their tokens may be LOCKED (see lockAttribution), or the creator wallet may be misidentified (on Pump.fun/Bags graduated tokens we sometimes only have the genesis-tx fee payer, which is a platform wallet, not the team). NEVER assert "the creator dumped / exited / distributed" off "not a current holder" alone. Only say it if creatorStatus shows actual sells. If they HELD or ACCUMULATED, say so honestly.
- READ THE LOCK ATTRIBUTION. lockAttribution (when present) tells you how much supply is LOCKED and via what platform (Streamflow, Jupiter Lock, etc.). Locked supply is removed from circulation — a commitment signal, NOT abandonment. teamVerifiedLockedPct is locks by the proven creator; unlabeledLockedPct is locks by wallets we could NOT verify as team (could be team OR conviction community holders — do NOT claim which). If a meaningful % of supply is locked, name it as a positive and NEVER pair it with an "everyone abandoned ship" narrative — those contradict each other.
- READ THE CREATOR FEES (both platforms). State plainly how much the creator extracted in fees over the token's life — this is a key honest fact a reader of a FAILED or collapsed token wants. The number comes from whichever applies: for Pump.fun tokens, pumpCreatorFees.lifetimeTotalSol (claimed + unclaimed); for Bags tokens, creatorStatus.onChainActivity.claimedSol (SOL claimed in creator fees). Treat both the same way: "the creator pulled ~X SOL in creator fees over the token's life." Do NOT moralize or accuse — earning creator fees is normal; just report the number and let the reader judge. If the fee total is meaningful relative to the token's collapse, naming it is exactly the kind of fact this tool exists to surface. The "fees recycled back into buys = positive story" framing ONLY applies when pctReinvested is genuinely high (e.g. 70%+) AND feeExtractionDominant is not set; a creator who claimed a lot but recycled only a small fraction (low pctReinvested / feeExtractionDominant true) is EXTRACTING, not recycling — say that plainly even if there is a token-flow tag like buy-back.
- READ THE CREATOR WALLET PROFILE. creatorWalletProfile.established=true means the creator wallet is an active operator wallet with a long history — NOT a fresh throwaway deployer; never imply it's a burner. If established=false and fundedBy is set, that's who funded the wallet; a fresh deployer funded from a single source right before launch is worth naming neutrally as a setup pattern (not proof of bad intent).
- READ THE BURN AND AIRDROP DATA. lifetimeAnalysis.totalBurnedObserved + burnedAsShareOfSupply tells you if real burning happened. dustDropEventsObserved > 0 means the token did inorganic dust drops to inflate holder count (a red flag). airdropEventsObserved counts bulk distribution events — that's neutral by itself but worth naming if substantial.
- READ THE ACQUISITION BREAKDOWN AND DISTRIBUTOR DATA. acquisitionBreakdown tells you HOW the top wallets got their tokens: BOUGHT (via DEX, organic), TRANSFER (sent directly from another wallet — could be airdrop, team allocation, insider coordination, or coordinated dump-prep), or MINTED (direct from mint authority). If most are TRANSFER and distributorCount > 0, the holders weren't organic buyers — they were distributed to. CRITICAL EVIDENCE RULES: only call a distributor a "team wallet" when topDistributorIsVerifiedCreator is TRUE (meaning the wallet is in Bags creator/v3 registration — VERIFIED). For any OTHER distributor — even one that distributed to many wallets — DO NOT claim or imply team affiliation. On-chain transfer patterns can equally indicate team distribution, insider coordination, coordinated dump-prep, or community airdrop, and we cannot tell them apart from blockchain data alone. Use strictly neutral language: "a wallet distributed tokens to N top holders" — and explicitly flag the uncertainty ("origin not verified — could be team operations, insider coordination, or public airdrop"). The only time you can confidently call something team activity is when the source wallet is in the Bags/Pump verified-creator API response.
- ALL HOLDER COUNTS (holderBreakdown, acquisitionBreakdown, behaviorBreakdown) are computed across the TOP 100 HOLDERS (topHoldersScannedCount), not the top 20. Do NOT write phrases like "of the top 20, 22 are pre-pool" — that is mathematically impossible. The badges-card in the UI shows the top 20 visually, but every COUNT you receive in facts spans the full top 100. Use phrasing like "across the top holders we analyzed" or cite the breakdown directly without making top-20 claims.
- CREATOR BEHAVIOR KIND IS AUTHORITATIVE — BUT CHECK THE EXTRACTION OVERLAY FIRST. If creatorStatus.behaviorKind is "BUY_AND_LOCK" or "BUY_BACK_ACTIVE", the creator wallet is buying and removing supply, NOT selling via swaps. NORMALLY you lead with the buy-back: describe it with the specific numbers from creatorStatus.onChainActivity (buyCount, lockCount, lockedTokens, boughtSol, pctReinvested, teamNetwork totals). Do NOT say "zero buy history" / "P&L came back blank" / anything implying absence when onChainActivity shows numerical activity.
  CRITICAL EXCEPTION — extraction overlay: if creatorStatus.onChainActivity.feeExtractionDominant is TRUE or creatorStatus.onChainActivity.funnelHeavy is TRUE, the buy-back is NOT the headline — EXTRACTION IS. You MUST lead with the extraction and present the buy-back as the smaller, secondary flow. feeExtractionDominant means the creator claimed far more in creator fees than they recycled into buys (see netFeeExtractionSol = SOL kept, and pctReinvested = the small % put back) — lead with "claimed ~X SOL in fees, recycled only Y% — roughly Z SOL kept." funnelHeavy means the creator moved a large share of supply (transferOutShareOfSupply %) out to OTHER wallets, far more than they bought on-market — lead with that token funnel. The whole point: a creator wallet showing 0 market sells does NOT mean nothing was extracted — fee claims and token transfers-out are the extraction vectors a naive "did the dev sell?" check misses entirely. When either flag is set, NEVER frame the creator as pure conviction / diamond hands; name the extraction as the dominant story, then note the buy-back as the minority counter-flow. Stay factual — state the fee/transfer chain; do not assert the recipient wallets dumped unless other facts prove it.
  The creatorStatus.onChainActivity.sellCount is ONLY market sells (SWAP-type, creator's tokens flowing out). transferOutCount is NOT a market sell — those are wallet-to-wallet moves. But a LARGE transferOutTokens (funnelHeavy) is still a hidden-exit vector to name as a fact, not dismiss. When sellCount is 0, NEVER say "the creator has been selling on the market," but DO say "the creator extracted value via fees / token transfers" when the overlay flags are set.
- READ THE BAGS LAUNCH DATA IF PRESENT. bagsLaunch.isBagsToken being true means this token launched on Bags.fm. bagsLaunch.officialCreators is the verified creator list (with Twitter handles when present) — use these names directly when narrating who the creator is. bagsLaunch.dbcBuyersInTop100 is the count of top-100 holders we verified bought through the actual Bags bonding curve (not inferred — confirmed by parsing the DBC pool's transactions). When this number is high, the top-holder structure is dominated by genuine early-supporter bonding-curve buyers, NOT pre-allocated insiders — narrate that distinction honestly. bagsLaunch.totalClaimedSol + claimEventCount + daysSinceLastClaim tell you whether the project is ACTIVELY claiming its creator fees (recent claims = active operations, no claims or stale = abandoned). bagsLaunch.feeWalletsInTop100 tells you whether the fee-receiving wallets ALSO hold tokens directly — a fee wallet that holds zero tokens but receives fees is the team's separate operational wallet (normal); a fee wallet that ALSO sits in the top 100 means the team holds AND extracts (more concentrated power).
  BAGS GRADUATION (critical — same rules as Pump): bagsLaunch.graduated / bagsLaunch.onBondingCurve are authoritative from Solana Tracker. onBondingCurve true (market "meteora-curve") = the token is STILL ON THE BAGS BONDING CURVE and has NOT graduated to its Meteora DEX pool yet. A token still on the curve has NO DEX pool — that is NORMAL and BY DESIGN, not a rug. DexScreener showing ~$0 (or a tiny phantom pool) for an on-curve Bags token does NOT mean "LP pulled" / "no exit" / "never launched". Its real liquidity is the curve reserve — see bagsLaunch.stLiquidityUsd for the actual figure, and bagsLaunch.curvePercentage for progress to graduation. NEVER say "LP pulled" / "rug" / "no exit at size" for a Bags token that simply hasn't graduated. Describe it as "still on the Bags bonding curve (X% to graduation) with ~$Y in curve liquidity — early and speculative." Only describe a graduated Meteora pool when graduated is true.
- READ THE CREATOR VERIFICATION BLOCK. creatorVerification.source tells you where the creator wallet came from: "bags-official" (verified by Bags API) and "pump-official" (verified by Pump API) are HIGH-CONFIDENCE — name the wallet/handle directly. "genesis-tx-fee-payer" is the on-chain fallback. "unverified-platform-launch" is CRITICAL — it means this is a Bags/Pump token where the platform API returned no registered creator, and the on-chain genesis tx fee payer is the PLATFORM wallet (Bags/Pump's shared launcher that has launched thousands of tokens), NOT the project team. Do NOT call out a "dev wallet" or attribute on-chain creator behavior to that wallet in this case — explicitly say the project's true creator is not verifiable from on-chain data alone, and warn that tools like DexScreener may show the platform wallet labeled as "dev" for many unrelated tokens because they don't make this distinction.
- READ THE PUMP LAUNCH DATA IF PRESENT. pumpLaunch.isPumpToken being true means this token launched on Pump.fun.
  GRADUATION (critical — get this right): pumpLaunch.graduated is authoritative. true = the token has migrated to a DEX pool (PumpSwap/Raydium/Meteora). false / onBondingCurve=true = the token is STILL ON THE BONDING CURVE at Pump.fun and has NOT graduated. NEVER say a token "graduated off the bonding curve" unless graduated is true. If onBondingCurve is true, describe it as "still on the Pump.fun bonding curve" (optionally with curvePercentage to graduation).
  LIQUIDITY ON A BONDING-CURVE TOKEN: a token still on the curve has NO DEX liquidity pool yet — that is NORMAL and BY DESIGN, not a rug. DexScreener showing $0 liquidity for an on-curve token does NOT mean "the LP was pulled" or "wasn't seeded." Its real liquidity is the bonding-curve reserve — see pumpLaunch.stLiquidityUsd (from Solana Tracker) for the actual figure. NEVER say "LP pulled" / "LP not seeded" for a token that simply hasn't graduated yet.
  pumpLaunch.bcBuyersInTop100 is the count of top-100 holders verified as bonding-curve buyers. A high number means most top holders bought organically through the curve, not via insider allocation. pumpLaunch.pumpEraPeakPriceUsd captures the peak during the bonding-curve era. For graduated tokens, GeckoTerminal price history starts at graduation.
- READ THE HIDDEN-EXIT PATTERNS IF PRESENT. hiddenExitPatterns flags wallets that transferred tokens to multiple OTHER wallets which THEN dumped — a classic obfuscation move (the source wallet doesn't show up in a simple top-seller scan because the actual selling happens from the recipient wallets). When hiddenExitPatterns.count > 0, this is the SHARPEST forensic signal on the page: lead with it. Use the exact wording "transfer-then-dump pattern" or "hidden exit". When sourceAlsoSold is true, escalate further — the source wallet was distributing tokens to obfuscate AND extracting value directly. These detections specifically exclude verified Bags/Pump creator wallets and known LP/locker addresses, so they're not false-flagged on legitimate team distribution.
- READ THE PNL LEDGER IF PRESENT. pnlLedger reconstructs every wallet's lifetime buy/sell history priced at that day's USD close. tookTheMoneyCount is the number of wallets that sold their entire position FOR A PROFIT and walked — call those out as "cash-out wallets" when material. biggestWinnerRealizedUsd / biggestLoserRealizedUsd give you the polar extremes: who made bank vs who got rekt. topSellerSoldUsd is the most-extracted single wallet — if that's a large fraction of total volume, the distribution was lopsided (one wallet drained the pool). If the top seller exit dwarfs the top buyer entry, distribution was concentrated on the way out — name it.
- READ THE CREATOR ON-CHAIN ACTIVITY when present (creatorStatus.onChainActivity). The fields distinguish three different on-chain actions for the creator wallet: buyCount/boughtUsd = buying on the open market, sellCount/soldUsd = extracting value via swaps, and lockCount/lockedTokens = sending tokens to a locker contract (permanently removing supply, NOT a sell). creatorStatus.behaviorKind being "BUY_AND_LOCK" is the strongest possible signal — the team is buying CLKN with their fees and immediately locking what they buy, taking supply OUT of circulation. Lead with this when present: "@handle is running a buy-and-lock — X buys, Y lock deposits, Z tokens removed from circulation." It is NOT a sell pattern; do not characterize it as distribution.
- READ THE TOKEN-2022 EXTENSIONS IF PRESENT. The token2022 block only appears for Token-2022 mints. token2022.hasHoneypotExtension being true is the SHARPEST red flag on the entire page — it means the mint is built to trap buyers: a non-transferable token (can never be sold), accounts frozen by default (can't sell until manually thawed), an active transfer hook (a custom program can reject sells at will), or a ~100% transfer fee (sells taxed into nothing). When true, LEAD THE NARRATIVE WITH IT and name the exact mechanism from token2022.risks[] — this is a honeypot regardless of liquidity or buy/sell counts. A permanent delegate (severity "severe") means every holder's tokens are seizable/burnable by the delegate at any time — name it as a control risk even if not a hard honeypot. A transfer fee under 10% is a cost to disclose, not a honeypot. Standard SPL tokens have no token2022 block — do NOT mention Token-2022 at all for them.
- No markdown asterisks, no headers. Plain prose paragraphs.`;
      const userMsg = `Token: ${symbol} (${name})\nReport mode: ${reportMode}\nVerdict: ${verdict.type} — ${verdict.label}\nVerified facts:\n${JSON.stringify(facts, null, 2)}\n\n${reportMode === "health-checkup" ? "Write the Full Health Checkup now." : reportMode === "health-assessment" ? "Write the Health Assessment now." : "Write the forensic case study now."}`;
      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 600,
            system: sysPrompt,
            messages: [{ role: "user", content: userMsg }]
          })
        });
        const aiData = await aiRes.json();
        if (aiData.content && aiData.content[0]) {
          narrative = aiData.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").trim();
        }
      } catch (e) {
        console.warn("[AUTOPSY] AI narration failed:", e.message);
      }
    }

    console.log(`[AUTOPSY] ${symbol} -> ${verdict.type} (${redFlags.length} red flags, narration=${narrative ? "yes" : "no"})`);

    return res.status(200).json({
      success: true,
      mint,
      symbol, name,
      verdict,
      reportMode, reportHeadline, reportSubhead,
      facts: {
        symbol, name, decimals,
        totalSupply: supplyTokens,
        mintAuthorityRevoked: !mintAuthority,
        freezeAuthorityRevoked: !freezeAuthority,
        token2022: isToken2022 ? {
          isToken2022: true,
          transferFeePct: transferFeeBps != null ? Number((transferFeeBps / 100).toFixed(2)) : null,
          hasHoneypotExtension,
          risks: token2022Risks.map(r => ({ kind: r.kind, severity: r.severity, label: r.label, msg: r.msg })),
        } : null,
        totalLiqUsd: Number(totalLiqUsd.toFixed(2)),
        totalVol24h: Number(totalVol24h.toFixed(2)),
        priceChangeH1, priceChangeH6, priceChangeH24,
        buys24h, sells24h, txns24h,
        poolCount: solPairs.length,
        priceUsd, fdv, marketCap, turnover,
        ageDays: ageDays !== null ? Math.round(ageDays) : null,
        pairCreatedAt: pairCreatedMs ? new Date(pairCreatedMs).toISOString() : null,
        top10Concentration: top10Share,
        topPair: topPair ? {
          dexId: topPair.dexId,
          pairAddress: topPair.pairAddress,
          url: topPair.url || null,
        } : null,
      },
      redFlags,
      lpStatus,
      cexPresence,
      creatorVerification,
      metadataStatus,
      narrative,
      lessons: lessonMap[verdict.type] || lessonsFinal,
      topHolders,
      holderBreakdown,
      behaviorBreakdown,
      lockedSupplyShare,
      humanSupplyShare,
      lifetime,
      priceHistory,
      creatorStatus,
      distributors,
      bagsInfo,
      pumpInfo,
      walletPnl,
      lockAttribution,
      pumpCreatorFees,
      creatorWalletProfile,
      hiddenExitDistributors,
      jupiterInfo,
      solscan: solscan.isConfigured() ? {
        configured: true,
        holderCount: solscanHolderCount,
      } : { configured: false },
      scanQuality: (() => {
        // Annotate scanQuality with a human-readable summary so the UI can
        // render an honest "Cluck needs more time" banner when something
        // didn't finish cleanly. Quality buckets:
        //   FULL — every phase completed without rate-limiting
        //   PARTIAL — minor degradation (a couple of 429s, retried OK)
        //   DEGRADED — multiple phases failed or rate-limited heavily
        const failedPhases = (scanQuality.phasesFailed || []);
        const limitedCount = scanQuality.heliusRateLimited || 0;
        const batchSuccessRate = scanQuality.heliusBatches > 0
          ? scanQuality.heliusBatchesSucceeded / scanQuality.heliusBatches
          : 1;
        // Solana-Tracker-aware: if the ONLY degraded phases are the Phase 2G
        // creator-trace family AND Solana Tracker provided a complete
        // cross-check for the creator wallet, the headline creator numbers
        // (buys, sells, invested, ROI) are NOT missing — they're sourced
        // from ST's complete indexer, not our rate-limited signature walk.
        // In that case the banner shouldn't alarm; it should explain the
        // numbers are backfilled from an independent complete source.
        const stBackfilled = !!(creatorStatus && creatorStatus.onChainActivity
          && creatorStatus.onChainActivity.solanaTrackerCrossCheck);
        const onlyCreatorDegraded = failedPhases.length > 0
          && failedPhases.every(p => typeof p === "string" && p.startsWith("phase-2G"));
        let qualityLabel = "FULL";
        let qualityMessage = null;
        if (stBackfilled && onlyCreatorDegraded && batchSuccessRate >= 0.85 && limitedCount < 5) {
          // Phase 2G's raw trace was throttled, but ST has the real numbers.
          qualityLabel = "BACKFILLED";
          qualityMessage = `Our raw signature trace got rate-limited by Helius, but the creator's buy / sell / lock / ROI figures shown here are sourced from Solana Tracker's complete indexer — these headline numbers are not missing data. The on-chain trace below ("our trace") stays conservative; trust the Solana Tracker cross-check for the fuller picture.`;
        } else if (failedPhases.length >= 2 || batchSuccessRate < 0.85 || limitedCount >= 5) {
          qualityLabel = "DEGRADED";
          qualityMessage = `Cluck didn't get a clean read this run. ${failedPhases.length > 0 ? failedPhases.join(", ") + " came back partial. " : ""}${limitedCount > 0 ? `Helius rate-limited ${limitedCount} batch${limitedCount === 1 ? "" : "es"}. ` : ""}Some numbers may be lower than reality. Re-run in 30 seconds for cleaner data — counters only grow across runs (we cache the best observation per wallet).`;
        } else if (failedPhases.length === 1 || limitedCount >= 1 || batchSuccessRate < 0.98) {
          qualityLabel = "PARTIAL";
          qualityMessage = `Cluck got most of the data. ${failedPhases.length > 0 ? failedPhases[0] + " was slightly degraded. " : ""}${limitedCount > 0 ? `${limitedCount} batch retry on rate limit. ` : ""}Best-observed cache filled the gaps.`;
        }
        // Also flag when GeckoTerminal didn't load (boughtUsd math goes to 0)
        if (!priceHistory) {
          if (qualityLabel === "FULL") qualityLabel = "PARTIAL";
          if (!qualityMessage) qualityMessage = "";
          qualityMessage = (qualityMessage || "") + " (Price history from GeckoTerminal didn't load — USD-valued P&L will be approximate.)";
        }
        return {
          ...scanQuality,
          qualityLabel,
          qualityMessage,
          usedBestObservedCache: !!(creatorStatus && creatorStatus.onChainActivity && creatorTrace && creatorTrace.usedBestObservedCache),
        };
      })(),
    });
  } catch (err) {
    console.error("Autopsy error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -- www redirect --
app.use((req, res, next) => {
  if (req.headers.host && req.headers.host.startsWith("www.")) {
    return res.redirect(301, "https://" + req.headers.host.slice(4) + req.url);
  }
  next();
});

// -- Vendored libraries (served from same origin so tracking-prevention browsers
// don't block third-party CDN scripts that the airdrop tool depends on) --
app.use("/vendor", express.static(join(__dirname, "public", "vendor"), { maxAge: "30d", immutable: true }));

// -- Serve React app --
app.use(express.static(join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

// ── CLKN Trade Poller ──────────────────────────────────────────────────────
// Every 30s, fetch the latest signatures hitting the Meteora CLKN pool, parse
// any new ones via Helius enhanced txns, and post a Telegram message for each
// detected trade — buys (CLKN out of pool to a wallet) and sells (CLKN from a
// wallet back to the pool), with SOL/wSOL moving the other way to confirm it's
// a swap and not a P2P transfer.
const CLKN_POOL_ADDRESS = "64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd"; // Meteora DAMM V2
const CLKN_ORCA_POOL = "H1r9ut25xAU1B1AbZRhvSJjShd4Q3mtmysYHBisFES7H"; // Orca Whirlpool CLKN/USDC 0.02% — our primary Liquidity Engine base pool
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
// Quote tokens we recognize as "the buyer paid with this." Helius returns
// tokenAmount already in UI units, so we just need symbol + emoji per quote.
const QUOTE_TOKENS = {
  [WSOL_MINT]: { symbol: "SOL",  emoji: "◎", isStable: false },
  [USDC_MINT]: { symbol: "USDC", emoji: "$", isStable: true },
  [USDT_MINT]: { symbol: "USDT", emoji: "$", isStable: true },
};
// Buys below this USD value don't fire a Telegram notification. Default $5 so
// the channel shows the steady stream of smaller buys (good for hype during a
// Buy Special) while still filtering bot dust. Override via env var.
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "20");
// Sells have a higher floor than buys by default — only larger sells are worth
// surfacing. Override either side via MIN_BUY_USD / MIN_SELL_USD.
const MIN_SELL_USD = parseFloat(process.env.MIN_SELL_USD || "50");
// Community-reinvestment buys (from a DEV_WALLETS address) get their own, lower
// floor — the project buying its own fees back is worth showing even in small
// size, so these post down to $1 while ordinary buys are held to MIN_BUY_USD.
const MIN_REINVEST_USD = parseFloat(process.env.MIN_REINVEST_USD || "1");

// Cached SOL/USD price for converting non-stable quote amounts into USD.
// Refreshed every 5 minutes from CoinGecko (with DexScreener fallback). We start
// with NO price rather than a hardcoded guess — a fabricated rate would post a
// silently-wrong dollar value on a SOL-quoted buy. Until a real price is fetched
// (or both sources are down), getSolUsd returns null and the SOL-quoted alert is
// skipped rather than mis-valued; stable-quoted (USDC/USDT) trades are unaffected.
// An operator can seed an approximate rate via SOL_USD_FALLBACK if they'd rather
// post an estimate than skip during a total price-source outage.
let cachedSolUsd = parseFloat(process.env.SOL_USD_FALLBACK) || null;
let cachedSolUsdAt = 0;
async function getSolUsd() {
  const now = Date.now();
  if (now - cachedSolUsdAt < 5 * 60 * 1000 && cachedSolUsdAt > 0) return cachedSolUsd;
  // Try CoinGecko first (free, reliable, no key needed). Fall back to DexScreener
  // SOL/USDC pair if CoinGecko hiccups so the bot stays accurate.
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    const price = parseFloat(data?.solana?.usd);
    if (Number.isFinite(price) && price > 0) {
      cachedSolUsd = price;
      cachedSolUsdAt = now;
      return cachedSolUsd;
    }
  } catch (e) {
    console.warn("[TELEGRAM] CoinGecko SOL fetch failed:", e.message);
  }
  // Fallback — pull from DexScreener's SOL token pair (any pair gives priceUsd)
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${WSOL_MINT}`);
    const data = await res.json();
    const pair = data?.pairs?.[0];
    const price = parseFloat(pair?.priceUsd);
    if (Number.isFinite(price) && price > 0) {
      cachedSolUsd = price;
      cachedSolUsdAt = now;
    }
  } catch (e) {
    console.warn("[TELEGRAM] DexScreener SOL fallback failed, using last-known price:", e.message);
  }
  return cachedSolUsd;
}

// Convert a trade's quote leg (SOL/USDC/USDT) into USD. Works for buys and
// sells alike — both carry the same { quote: { mint, amount } } shape.
function quoteUsdValue(trade) {
  const meta = QUOTE_TOKENS[trade.quote.mint];
  if (!meta) return null;
  if (meta.isStable) return trade.quote.amount;
  if (!cachedSolUsd) return null; // no real SOL price yet — skip rather than fabricate a USD value
  return trade.quote.amount * cachedSolUsd; // SOL/wSOL × cached USD price
}

// Per-pool last-seen signature. Refreshed each poll cycle. Map of pool address → last sig.
// New pools (discovered via DexScreener refresh) start with null = first-run-skip-history.
// Persisted across restarts so a redeploy doesn't reset the poller to "head" and
// silently skip every trade in the deploy window (the #1 cause of missed buys).
// On restart it resumes from the last-processed sig and backfills the gap (bounded
// by the per-pool signature fetch limit below).
const lastSeenByPool = new Map(Object.entries(kv.get("buyPollLastSeen", {})));
function rememberLastSeen(poolAddress, sig) {
  lastSeenByPool.set(poolAddress, sig);
  try { kv.set("buyPollLastSeen", Object.fromEntries(lastSeenByPool)); } catch (_) {}
}
let cachedPools = []; // [{ address, dexId, labels }, ...]
let cachedPoolsAt = 0;

// Pull every Solana CLKN pool from DexScreener — covers Meteora DAMM v2 plus any
// other DEX where CLKN trades. Cached 10 min so we don't hammer DexScreener.
async function getClknPools() {
  const now = Date.now();
  if (cachedPools.length && now - cachedPoolsAt < 10 * 60 * 1000) return cachedPools;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${CLKN_MINT_ADDR}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      const pools = data
        .filter(p => (p.chainId === "solana" || !p.chainId) && p.pairAddress)
        .map(p => ({
          address: p.pairAddress,
          dexId: (p.dexId || "").toLowerCase(),
          labels: Array.isArray(p.labels) ? p.labels : [],
        }));
      if (pools.length) {
        cachedPools = pools;
        cachedPoolsAt = now;
        console.log(`[TELEGRAM] Refreshed pool list: ${pools.length} pool(s) [${pools.map(p => `${p.address.slice(0,6)}/${p.dexId}`).join(", ")}]`);
      }
    }
  } catch (e) {
    console.warn("[TELEGRAM] Pool list fetch failed:", e.message);
  }
  // Always include the main Meteora pool as a hard fallback even if DexScreener fails
  if (!cachedPools.find(p => p.address === CLKN_POOL_ADDRESS)) {
    cachedPools.push({ address: CLKN_POOL_ADDRESS, dexId: "meteora", labels: ["DAMM v2"] });
  }
  // And our own Orca Whirlpool (the Liquidity Engine pool) so buys that fill against
  // our market-maker depth get announced too — DexScreener can lag on a fresh pool.
  if (!cachedPools.find(p => p.address === CLKN_ORCA_POOL)) {
    cachedPools.push({ address: CLKN_ORCA_POOL, dexId: "orca", labels: ["Whirlpool"] });
  }
  return cachedPools;
}

// DexScreener dexId → display name. Anything missing falls through to a Title-cased dexId.
const DEX_LABELS = {
  meteora: "Meteora",
  raydium: "Raydium",
  orca: "Orca",
  pumpfun: "Pump.fun",
  pumpswap: "PumpSwap",
  phoenix: "Phoenix",
  lifinity: "Lifinity",
  openbook: "OpenBook",
};
// Helius enhanced-tx `source` field → display name. UNKNOWN/SYSTEM are dropped.
const SOURCE_LABELS = {
  JUPITER: "Jupiter",
  RAYDIUM: "Raydium",
  METEORA: "Meteora",
  ORCA: "Orca",
  PUMP_AMM: "Pump.fun",
  PUMPSWAP: "PumpSwap",
  PHOENIX: "Phoenix",
  LIFINITY: "Lifinity",
  OPENBOOK: "OpenBook",
  WHIRLPOOL: "Orca",
};
function prettyDex(pool) {
  if (!pool) return "Unknown DEX";
  const id = (pool.dexId || "").toLowerCase();
  const name = DEX_LABELS[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Unknown DEX");
  const lbl = (pool.labels || []).filter(Boolean).join(" ");
  return lbl ? `${name} ${lbl}` : name;
}
function prettySource(source) {
  if (!source) return "";
  if (source === "UNKNOWN" || source === "SYSTEM_PROGRAM") return "";
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  // Fallback: turn METEORA_DAMM_V2 → "Meteora Damm V2"
  return source.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function formatRoute(tx, pool) {
  const poolStr = prettyDex(pool);
  const src = prettySource(tx?.source);
  const poolDexName = DEX_LABELS[(pool?.dexId || "").toLowerCase()] || "";
  // If a router executed it and the router isn't the pool's own DEX, show both legs
  if (src && poolDexName && !src.toLowerCase().startsWith(poolDexName.toLowerCase())) {
    return `via <b>${src}</b> → ${poolStr}`;
  }
  return `via <b>${poolStr}</b>`;
}
function formatClknPrice(usd, clknAmount) {
  if (!usd || !clknAmount) return null;
  const p = usd / clknAmount;
  if (!isFinite(p) || p <= 0) return null;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(7)}`;
  return `$${p.toExponential(2)}`;
}

// CLKN total supply, cached — it only changes on the rare burn, so a long TTL
// is fine. Used to turn a trade's price into a market-cap figure for alerts.
let cachedClknSupply = 0;
let cachedClknSupplyAt = 0;
async function getClknSupply(HELIUS_KEY) {
  const now = Date.now();
  if (cachedClknSupply && now - cachedClknSupplyAt < 6 * 60 * 60 * 1000) return cachedClknSupply;
  try {
    const url = HELIUS_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
      : "https://api.mainnet-beta.solana.com";
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [CLKN_MINT_ADDR] }),
    });
    const d = await r.json();
    const ui = d && d.result && d.result.value && d.result.value.uiAmount;
    if (ui && ui > 0) { cachedClknSupply = ui; cachedClknSupplyAt = now; }
  } catch (e) { /* keep the last good value */ }
  return cachedClknSupply || 1e9;   // ≈1B fallback if the lookup has never succeeded
}

// Market cap shown on a buy/sell alert: the trade's price (USD per CLKN) × the
// total supply — i.e. the market cap implied right after that trade. Compact $.
async function formatClknMarketCap(usd, clknAmount, HELIUS_KEY) {
  if (!usd || !clknAmount) return null;
  const price = usd / clknAmount;
  if (!isFinite(price) || price <= 0) return null;
  const mc = price * (await getClknSupply(HELIUS_KEY));
  if (!isFinite(mc) || mc <= 0) return null;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

// Pool-centric CLKN trade detection.
//
// Wallet-tracing broke on Jupiter routes: the trader and the proceeds-receiver
// are different accounts, and the CLKN only ever hops between off-curve route
// PDAs — so no real wallet could be pinned and routed sells went undetected.
// This version anchors on net token-balance changes (tx.accountData):
//   • the LP pool    = the off-curve account whose CLKN balance moved the most
//   • pool CLKN up   => SELL  (someone sold into the pool)
//   • pool CLKN down => BUY   (someone bought out of the pool)
//   • clknAmount     = magnitude of that pool-side CLKN change
//   • quote leg      = the same pool owner's WSOL/USDC balance change
//   • trader         = the on-curve wallet whose CLKN moved the opposite way
// The pool's balance delta is unambiguous no matter how many hops a route
// used. `trader` is null when a route never surfaces the trader as a plain
// on-curve wallet — the trade is still reported, just without holder rank.
function detectClknTrade(tx) {
  if (!tx || tx.transactionError) return null;

  // Net balance change per owner wallet, summed from accountData.
  const clknByOwner = new Map();              // owner -> net CLKN (UI units)
  const quoteByOwner = new Map();             // owner -> { quoteMint -> net }
  for (const ad of (tx.accountData || [])) {
    for (const bc of (ad.tokenBalanceChanges || [])) {
      const owner = bc.userAccount;
      const raw = bc.rawTokenAmount;
      if (!owner || !raw) continue;
      const amt = Number(raw.tokenAmount) / Math.pow(10, raw.decimals || 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      if (bc.mint === CLKN_MINT_ADDR) {
        clknByOwner.set(owner, (clknByOwner.get(owner) || 0) + amt);
      } else if (QUOTE_TOKENS[bc.mint]) {
        let q = quoteByOwner.get(owner);
        if (!q) { q = {}; quoteByOwner.set(owner, q); }
        const cur = q[bc.mint] || { net: 0, gross: 0 };
        cur.net += amt;
        cur.gross = Math.max(cur.gross, Math.abs(amt)); // biggest single leg
        q[bc.mint] = cur;
      }
    }
  }
  if (!clknByOwner.size) return null;

  const onCurve = (addr) => { try { return isOnCurve(addr); } catch { return false; } };

  // The CLKN pool = the off-curve account whose CLKN balance moved the most.
  let pool = null, poolClkn = 0;
  for (const [owner, delta] of clknByOwner) {
    if (onCurve(owner)) continue;
    if (Math.abs(delta) > Math.abs(poolClkn)) { pool = owner; poolClkn = delta; }
  }
  if (!pool || poolClkn === 0) return null;   // no pool leg => not a CLKN swap

  const action = poolClkn > 0 ? "sell" : "buy";
  const clknAmount = Math.abs(poolClkn);

  // Trader = on-curve wallet whose CLKN moved opposite the pool (down on a
  // sell, up on a buy). Largest such mover wins; null if none surfaced.
  let trader = null, traderMag = 0;
  for (const [owner, delta] of clknByOwner) {
    if (!onCurve(owner)) continue;
    const matches = action === "sell" ? delta < 0 : delta > 0;
    if (matches && Math.abs(delta) > traderMag) { trader = owner; traderMag = Math.abs(delta); }
  }

  // Quote leg = the pool owner's WSOL/USDC balance change — the other half of
  // the swap. Magnitude only; direction is already known from `action`.
  const poolQuotes = quoteByOwner.get(pool) || {};
  let quoteMint = null, quoteAmount = 0, quoteDelta = 0;
  for (const [mint, v] of Object.entries(poolQuotes)) {
    // Jupiter routes the quote token IN and OUT of the pool/route account, so its
    // NET can be ~0 even though real SOL moved (this silently dropped big routed
    // trades). Use the larger of |net| and the biggest single leg for magnitude;
    // direction still comes from the CLKN side below.
    const mag = Math.max(Math.abs(v.net), v.gross);
    if (mag > quoteAmount) { quoteMint = mint; quoteAmount = mag; quoteDelta = v.net; }
  }
  if (!quoteMint || quoteAmount <= 0) return null;

  // A real swap moves the pool's CLKN and its quote token in OPPOSITE directions
  // (CLKN in / quote out on a sell, CLKN out / quote in on a buy). Adding or
  // removing liquidity moves BOTH the same way — both into the pool, or both out.
  // Same direction => liquidity add/remove, not a trade — don't fire an alert.
  if (Math.sign(poolClkn) === Math.sign(quoteDelta)) return null;

  return { action, trader, clknAmount, quote: { mint: quoteMint, amount: quoteAmount } };
}

function fmtClkn(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString();
}

function fmtQuote(q) {
  const meta = QUOTE_TOKENS[q.mint] || { symbol: "?", isStable: false };
  if (meta.isStable) {
    // USDC/USDT — show as $ amount
    return `$${q.amount.toFixed(2)} ${meta.symbol}`;
  }
  // SOL — keep precision
  return `${q.amount.toFixed(3)} ${meta.symbol}`;
}

// Public Cluck graphic served from the React app's public/ folder, copied to dist
// at build time so it's reachable at clucknorris.app/cluck-norris.png. Telegram
// fetches this URL each time it sends a photo message.
const BUY_GRAPHIC_URL = "https://clucknorris.app/cluck-norris.png";

// Cluck-themed holder ranks by CLKN balance, keyed to share of the 1B total
// supply: EGG <0.01%, CHICK 0.01–0.1%, SPRING CHICKEN 0.1–0.5%, HEN 0.5–1.5%,
// ROOSTER 1.5–3%, HEAD ROOSTER 3%+. `min` is the lower token bound of each tier.
const CLKN_TIERS = [
  { min: 0,           emoji: "🥚", name: "EGG" },
  { min: 100_000,     emoji: "🐣", name: "CHICK" },
  { min: 1_000_000,   emoji: "🐤", name: "SPRING CHICKEN" },
  { min: 5_000_000,   emoji: "🐔", name: "HEN" },
  { min: 15_000_000,  emoji: "🐓", name: "ROOSTER" },
  { min: 30_000_000,  emoji: "👑", name: "HEAD ROOSTER" },
];
function clknTier(amount) {
  let t = CLKN_TIERS[0];
  for (const tier of CLKN_TIERS) if (amount >= tier.min) t = tier;
  return t;
}

// Pull a wallet's SOL balance and total CLKN holdings — used to rank a trader
// and detect a tier change on buy and sell alerts.
async function getWalletStats(wallet, HELIUS_KEY) {
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const call = (id, method, params) => fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  }).then(r => r.json());
  let solBalance = null, clknBalance = null;
  try {
    const [bal, tok] = await Promise.all([
      call("bs-sol", "getBalance", [wallet]),
      call("bs-clkn", "getTokenAccountsByOwner", [wallet, { mint: CLKN_MINT_ADDR }, { encoding: "jsonParsed" }]),
    ]);
    if (bal?.result?.value != null) solBalance = bal.result.value / 1e9;
    const accs = tok?.result?.value || [];
    clknBalance = 0;
    for (const a of accs) clknBalance += a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
  } catch (e) {
    console.warn("[TELEGRAM] Wallet stats lookup failed:", e.message);
  }
  return { solBalance, clknBalance };
}

// Total CLKN 24h volume across all Solana pairs (DexScreener), cached 5 min.
let cached24hVol = null, cached24hVolAt = 0;
async function getClkn24hVolume() {
  const now = Date.now();
  if (cached24hVol !== null && now - cached24hVolAt < 5 * 60 * 1000) return cached24hVol;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${CLKN_MINT_ADDR}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      let v = 0;
      for (const p of data) { const h = Number(p?.volume?.h24); if (Number.isFinite(h)) v += h; }
      cached24hVol = v; cached24hVolAt = now;
    }
  } catch (e) { console.warn("[TELEGRAM] 24h volume fetch failed:", e.message); }
  return cached24hVol;
}
// Compact USD: $123 / $4.5K / $1.2M. Returns null for non-finite input.
function fmtUsdShort(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  n = Number(n);
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

// Jupiter's organic score for CLKN (0–100 + a high/medium/low label). It's
// Jupiter's own measure of REAL, non-manipulated trading — the metric our
// Liquidity Engine is built to earn honestly (and the one wash-volume bots can't
// fake). Cached 5 min. Returns { score, label } or null. Same v2 endpoint the
// Token Autopsy uses for cross-verification.
let cachedOrganic = null, cachedOrganicAt = 0;
async function getClknOrganicScore() {
  const now = Date.now();
  if (cachedOrganic !== null && now - cachedOrganicAt < 5 * 60 * 1000) return cachedOrganic;
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${CLKN_MINT_ADDR}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const t = data.find((d) => d.id === CLKN_MINT_ADDR) || data[0];
        if (t && t.organicScore != null) {
          cachedOrganic = { score: Number(t.organicScore), label: t.organicScoreLabel || null };
          cachedOrganicAt = now;
        }
      }
    }
  } catch (e) { console.warn("[TELEGRAM] organic score fetch failed:", e.message); }
  return cachedOrganic;
}
// "26.6 🟢 high" — colored by Jupiter's label. Returns null if unavailable.
function fmtOrganicScore(o) {
  if (!o || !Number.isFinite(Number(o.score))) return null;
  const dot = o.label === "high" ? "🟢" : o.label === "medium" ? "🟡" : "🟠";
  return `${o.score.toFixed(1)} ${dot}${o.label ? " " + o.label : ""}`;
}

async function notifyClknBuy(trade, tx, pool, usdValue, HELIUS_KEY) {
  const buyer = trade.trader;
  const buyerShort = buyer ? `${buyer.slice(0, 4)}…${buyer.slice(-4)}` : "unknown";
  const isDevBuy = buyer != null && DEV_WALLETS.has(buyer);
  const meta = QUOTE_TOKENS[trade.quote.mint];
  // Only show "($X.XX)" suffix when the quote isn't already a USD-denominated
  // stablecoin — for USDC/USDT the amount IS the dollar value.
  const usdSuffix = (meta && !meta.isStable && usdValue) ? ` <i>($${usdValue.toFixed(2)})</i>` : "";
  const routeLine = formatRoute(tx, pool);
  const priceStr = formatClknPrice(usdValue, trade.clknAmount);
  const mcapStr = await formatClknMarketCap(usdValue, trade.clknAmount, HELIUS_KEY);
  const vol24Str = fmtUsdShort(await getClkn24hVolume());
  const organicStr = fmtOrganicScore(await getClknOrganicScore());
  const priceLine =
    (priceStr ? `\nPrice: <b>${priceStr}</b>` : "") +
    (mcapStr ? `\nMarket cap: <b>${mcapStr}</b>` : "") +
    (vol24Str ? `\n24h Vol: <b>${vol24Str}</b>` : "") +
    (organicStr ? `\nJupiter organic score: <b>${organicStr}</b>` : "");

  // Buyer rank + wallet — holdings now, the tier they sit in, whether this buy
  // promoted them, and how much they grew their position. Skipped for dev buys
  // (community reinvestment) and when a route never surfaced an on-curve buyer.
  // holderState/growthPct also pick which buy-pun ladder fires below.
  let rankBlock = "";
  let holderState = "unknown";   // "new" | "existing" | "unknown" (stats failed)
  let growthPct = null;
  if (!isDevBuy && buyer) {
    const stats = await getWalletStats(buyer, HELIUS_KEY);
    if (stats.clknBalance != null) {
      const after = stats.clknBalance;
      const before = Math.max(0, after - trade.clknAmount);
      const tierAfter = clknTier(after), tierBefore = clknTier(before);
      if (tierAfter.min > tierBefore.min) {
        rankBlock += `\n🏆 <b>PROMOTED: ${tierBefore.name} → ${tierAfter.name}</b>`;
      }
      rankBlock += `\n${tierAfter.emoji} <b>${tierAfter.name}</b> · holds ${fmtClkn(after)} CLKN`;
      if (before > 0) {
        holderState = "existing";
        growthPct = (trade.clknAmount / before) * 100;
        rankBlock += `\n📈 grew position +${growthPct < 1000 ? growthPct.toFixed(1) : Math.round(growthPct).toLocaleString()}%`;
      } else {
        holderState = "new";
        rankBlock += `\n🆕 first cluck — brand new holder`;
      }
    }
    if (stats.solBalance != null) {
      rankBlock += `\n💰 ${stats.solBalance.toFixed(2)} SOL left in wallet`;
    }
  }

  const header = isDevBuy
    ? `♻️ <b>COMMUNITY REINVESTMENT</b>\n<i>Project fees — bought straight back into CLKN</i>\n`
    : `🐔 <b>NEW CLUCK ACQUIRED</b>\n`;
  const buyerLabel = isDevBuy ? "Team wallet" : "Buyer";
  const caption =
    header +
    `${fmtQuote(trade.quote)}${usdSuffix} → <b>${fmtClkn(trade.clknAmount)} CLKN</b>\n` +
    (isDevBuy ? "" : `${buyPun(usdValue, holderState)}\n`) +
    `${routeLine}${priceLine}${rankBlock}\n` +
    `${buyerLabel}: <code>${buyerShort}</code>\n` +
    `<a href="https://solscan.io/tx/${tx.signature}">↗ View on Solscan</a>\n` +
    `🐔 <a href="https://clucknorris.app">Tools & school: clucknorris.app</a>`;
  await notifyTelegramPhoto(BUY_GRAPHIC_URL, caption);
}

// Chicken-pun line for buy alerts — counterpart to sellPun. Three ladders by
// `holderState`: a brand-new buyer, an existing holder topping up their bag
// (fine-grained — they're our core flock), and a holder-neutral fallback for
// when the wallet-stats lookup couldn't tell us which. All plain USD ladders,
// easy to tweak.
function buyPun(usd, holderState) {
  const v = usd || 0;
  if (holderState === "new") {
    if (v >= 1000) return "🐣💰 <b>BIG-MONEY HATCHLING</b> — boldest first cluck we've seen.";
    if (v >= 750)  return "🐥 Big first cluck — this hatchling came to roost properly.";
    if (v >= 500)  return "🐥 Bold debut — a new bird struts to the front of the coop.";
    if (v >= 250)  return "🐣 No timid first peck — this newcomer means it.";
    if (v >= 100)  return "🐣 New bird settles in — finding its perch.";
    if (v >= 50)   return "🐣 A new face joins the coop — welcome to the flock!";
    if (v >= 10)   return "🐣 Fresh out of the egg — a new bird tries the feed.";
    return "🐣 A new chick wanders in and pecks its very first kernel.";
  }
  if (holderState === "existing") {
    if (v >= 1000) return "🐔💪 <b>BACKING THE TRUCK UP</b> — a holder just reloaded HARD.";
    if (v >= 750)  return "🐓 A holder doubles down — real weight on the roost.";
    if (v >= 500)  return "🐓 A seasoned bird stacks with serious intent.";
    if (v >= 250)  return "🐓 A holder leans in — the bag's getting heavier.";
    if (v >= 100)  return "🐔 A holder pads the nest — steady accumulation.";
    if (v >= 50)   return "🐔 A holder adds a respectable beakful to the nest.";
    if (v >= 10)   return "🐔 A holder tops off the feed bowl.";
    return "🐔 A holder flicks a few more crumbs onto the pile.";
  }
  // unknown — generic size ladder, kept holder-neutral (no newcomer language,
  // since an existing holder lands here whenever the stats lookup fails).
  if (v >= 5000) return "🦅 <b>BIG BIRD INBOUND</b> — someone backed the feed truck up to the coop.";
  if (v >= 1000) return "🐓 That's a rooster-sized order — strut earned.";
  if (v >= 250)  return "🐔 Nice peck — the henhouse is filling up.";
  if (v >= 50)   return "🐔 A tidy peck of CLKN scooped up.";
  return "🐤 Peck peck — every kernel counts.";
}

// Size-scaled chicken-pun line for sell alerts — the bigger the dump, the
// bigger the cluck. 8-tier USD ladder matching the buy ladders' breakpoints
// (10/50/100/250/500/750/1000); plain ladder, easy to tweak.
function sellPun(usd) {
  const v = usd || 0;
  if (v >= 1000) return "🍗 <b>FOWL PLAY!</b> That's not a sell, that's a Sunday roast.";
  if (v >= 750)  return "🪶 Big bird flapped off — feathers everywhere.";
  if (v >= 500)  return "🪶 Feathers in the air — a real bird took flight.";
  if (v >= 250)  return "🐓 Squawk! Somebody flew the coop with a beakful.";
  if (v >= 100)  return "🐔 A modest cluck cashed out.";
  if (v >= 50)   return "🐔 A few feathers ruffled — the flock barely blinked.";
  if (v >= 10)   return "🐤 A couple feathers drift down — nobody flinched.";
  return "🐤 Chicken feed — barely a peck off the pile.";
}

// Sell alert — the mirror of notifyClknBuy. Showing both sides keeps the feed
// honest: every dip a seller creates is a cheaper entry for the rest of the
// flock, so the caption frames it as a top-up opportunity rather than FUD.
async function notifyClknSell(trade, tx, pool, usdValue, HELIUS_KEY) {
  const seller = trade.trader;
  const sellerShort = seller ? `${seller.slice(0, 4)}…${seller.slice(-4)}` : "unknown";
  const meta = QUOTE_TOKENS[trade.quote.mint];
  // Only show "($X.XX)" suffix when the quote isn't already a USD stablecoin.
  const usdSuffix = (meta && !meta.isStable && usdValue) ? ` <i>($${usdValue.toFixed(2)})</i>` : "";
  const routeLine = formatRoute(tx, pool);
  const priceStr = formatClknPrice(usdValue, trade.clknAmount);
  const mcapStr = await formatClknMarketCap(usdValue, trade.clknAmount, HELIUS_KEY);
  const vol24Str = fmtUsdShort(await getClkn24hVolume());
  const organicStr = fmtOrganicScore(await getClknOrganicScore());
  const priceLine =
    (priceStr ? `\nPrice: <b>${priceStr}</b>` : "") +
    (mcapStr ? `\nMarket cap: <b>${mcapStr}</b>` : "") +
    (vol24Str ? `\n24h Vol: <b>${vol24Str}</b>` : "") +
    (organicStr ? `\nJupiter organic score: <b>${organicStr}</b>` : "");

  // Seller rank — holdings now, the tier they sit in, whether this sell knocked
  // them down a rung, and how much of their bag they trimmed. Skipped when a
  // route never surfaced a plain on-curve seller wallet.
  let rankBlock = "";
  if (seller) {
    const stats = await getWalletStats(seller, HELIUS_KEY);
    if (stats.clknBalance != null) {
      const after = stats.clknBalance;
      const before = after + trade.clknAmount; // they held more before selling
      const tierAfter = clknTier(after), tierBefore = clknTier(before);
      if (tierAfter.min < tierBefore.min) {
        rankBlock += `\n📉 <b>SLIPPED: ${tierBefore.name} → ${tierAfter.name}</b>`;
      }
      if (after < 1) {
        rankBlock += `\n🚪 closed out — fully exited their position`;
      } else {
        rankBlock += `\n${tierAfter.emoji} <b>${tierAfter.name}</b> · still holds ${fmtClkn(after)} CLKN`;
        const pct = before > 0 ? (trade.clknAmount / before) * 100 : 0;
        rankBlock += `\n✂️ trimmed position −${pct < 1000 ? pct.toFixed(1) : Math.round(pct).toLocaleString()}%`;
      }
    }
    if (stats.solBalance != null) {
      rankBlock += `\n💰 ${stats.solBalance.toFixed(2)} SOL in wallet`;
    }
  }

  const caption =
    `🔻 <b>CLUCK SOLD</b>\n` +
    `<b>${fmtClkn(trade.clknAmount)} CLKN</b> → ${fmtQuote(trade.quote)}${usdSuffix}\n` +
    `${sellPun(usdValue)}\n` +
    `${routeLine}${priceLine}${rankBlock}\n` +
    `Seller: <code>${sellerShort}</code>\n` +
    `💧 <i>Every dip is a discount — a cheaper chance to stack CLKN</i>\n` +
    `<a href="https://solscan.io/tx/${tx.signature}">↗ View on Solscan</a>\n` +
    `🐔 <a href="https://clucknorris.app">Tools & school: clucknorris.app</a>`;
  await notifyTelegramPhoto(BUY_GRAPHIC_URL, caption);
}

// In-memory dedupe: same signature can appear under multiple pools (Jupiter route
// touching all of them). Don't post the same buy twice. TTL'd by tx-count cap.
// Already-announced signatures. PERSISTED across restarts — otherwise every deploy
// (which restarts the server) wipes this in-memory set and the poller re-announces
// the most recent buy/sell it had already posted (the "same reinvestment every update"
// bug). Loaded from the volume on boot, rewritten as new sigs are recorded.
const recentlyNotifiedSigs = new Set(kv.get("buyNotifiedSigs", []));
function rememberSig(sig) {
  recentlyNotifiedSigs.add(sig);
  // Keep set bounded — drop oldest if it grows past 1000 entries
  if (recentlyNotifiedSigs.size > 1000) {
    const first = recentlyNotifiedSigs.values().next().value;
    recentlyNotifiedSigs.delete(first);
  }
  try { kv.set("buyNotifiedSigs", [...recentlyNotifiedSigs]); } catch (_) {}
}

// Does an enhanced-API tx actually carry the token-balance deltas detectClknTrade
// needs? A freshly-landed sig is often returned by the enhanced API with EMPTY
// accountData (not enriched yet) — that's indistinguishable from a non-trade and
// was a silent source of missed buys. When this is false we fall back to raw RPC.
function hasTokenBalanceData(tx) {
  return Array.isArray(tx?.accountData) &&
    tx.accountData.some(ad => Array.isArray(ad.tokenBalanceChanges) && ad.tokenBalanceChanges.length);
}

// Per-sig parse-attempt counter (in-memory). Lets us retry a sig the enhanced API
// hasn't indexed yet across poll cycles WITHOUT advancing lastSeen past it, while
// capping retries so a genuinely-unparseable sig can't wedge the poller forever.
const pollParseAttempts = new Map();
const MAX_PARSE_ATTEMPTS = 40; // ~20 min at the 30s poll cadence

// Raw getTransaction → enhanced-like shape. The enhanced (parsed) API lags by
// minutes on Jupiter-routed swaps; raw RPC has the tx almost immediately. We
// reconstruct accountData[].tokenBalanceChanges from meta.pre/postTokenBalances
// so detectClknTrade works identically on either source.
async function fetchRawTradeTx(sig, HELIUS_KEY) {
  let raw;
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTransaction",
        params: [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed", commitment: "confirmed" }],
      }),
    });
    const d = await r.json();
    raw = d?.result || null;
  } catch (_) { return null; }
  if (!raw) return null; // not indexed yet on the RPC node either
  if (raw.meta?.err) return { signature: sig, transactionError: raw.meta.err, accountData: [] };

  // Net raw-unit balance change per token account (keyed by accountIndex), then
  // emitted as one change per account with its owner + mint, matching the
  // enhanced API's rawTokenAmount shape.
  const byIdx = new Map();
  const seed = (b, isPost) => {
    const e = byIdx.get(b.accountIndex) || { owner: b.owner, mint: b.mint, pre: 0, post: 0, decimals: b.uiTokenAmount?.decimals || 0 };
    const amt = Number(b.uiTokenAmount?.amount || 0);
    if (isPost) e.post = amt; else e.pre = amt;
    e.owner = b.owner; e.mint = b.mint; e.decimals = b.uiTokenAmount?.decimals ?? e.decimals;
    byIdx.set(b.accountIndex, e);
  };
  for (const b of (raw.meta?.preTokenBalances || [])) seed(b, false);
  for (const b of (raw.meta?.postTokenBalances || [])) seed(b, true);

  const changes = [];
  for (const e of byIdx.values()) {
    const delta = e.post - e.pre; // raw integer units
    if (!delta || !e.owner) continue;
    changes.push({ userAccount: e.owner, mint: e.mint, rawTokenAmount: { tokenAmount: String(delta), decimals: e.decimals } });
  }
  if (!changes.length) return null;
  return { signature: sig, transactionError: null, source: "RAW", accountData: [{ tokenBalanceChanges: changes }] };
}

async function pollClknBuys() {
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY || !process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    // Refresh SOL price once per cycle (cached internally for 5 min)
    await getSolUsd();
    // Get current pool list (cached internally for 10 min)
    const pools = await getClknPools();
    if (!pools.length) return;

    // Poll each pool serially with a tiny gap so we don't spike Helius
    for (const pool of pools) {
      await pollSinglePool(pool, HELIUS_KEY);
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    console.warn("[TELEGRAM] Buy poll cycle error:", e.message);
  }
}

async function pollSinglePool(pool, HELIUS_KEY) {
  const poolAddress = pool.address;
  try {
    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
    const sigsRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "buy-poll",
        method: "getSignaturesForAddress",
        params: [poolAddress, { limit: 100 }],
      }),
    });
    const sigsData = await sigsRes.json();
    const sigs = sigsData?.result || [];
    if (!sigs.length) return;

    // First-run for this pool — record the head and skip history
    const lastSeen = lastSeenByPool.get(poolAddress);
    if (lastSeen === undefined || lastSeen === null) {
      rememberLastSeen(poolAddress, sigs[0].signature);
      console.log(`[TELEGRAM] Pool ${poolAddress.slice(0,6)}… initialized at sig ${sigs[0].signature.slice(0,8)}`);
      return;
    }

    // Find sigs newer than the last seen for this pool
    const newSigs = [];
    for (const s of sigs) {
      if (s.signature === lastSeen) break;
      if (s.err) continue;
      if (recentlyNotifiedSigs.has(s.signature)) continue; // already handled via another pool
      newSigs.push(s.signature);
    }
    if (!newSigs.length) {
      rememberLastSeen(poolAddress, sigs[0].signature);
      return;
    }
    newSigs.reverse();

    // Pull the enhanced (parsed) form for the batch — fast path. This API LAGS by
    // minutes on freshly-landed Jupiter-routed swaps, so we map it by signature and
    // fall back to raw getTransaction per-sig below for anything it hasn't enriched.
    let enhancedById = new Map();
    try {
      const enhancedRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: newSigs }),
      });
      const txns = await enhancedRes.json();
      if (Array.isArray(txns)) for (const t of txns) if (t?.signature) enhancedById.set(t.signature, t);
    } catch (e) {
      console.warn(`[TELEGRAM] Enhanced batch fetch failed (pool ${poolAddress.slice(0,6)}):`, e.message);
    }

    // Walk oldest→newest. Advance lastSeen only across CONTIGUOUS resolved sigs:
    // the moment we hit one we can't parse yet, stop advancing so it's retried
    // next cycle instead of being skipped forever (the root cause of missed buys).
    let advanceTo = lastSeen;
    let blocked = false;
    for (const sig of newSigs) {
      if (recentlyNotifiedSigs.has(sig)) { if (!blocked) advanceTo = sig; continue; }

      let tx = enhancedById.get(sig);
      // Enhanced API returned nothing usable (missing, or not enriched yet) → raw RPC.
      if (!hasTokenBalanceData(tx)) {
        const rawTx = await fetchRawTradeTx(sig, HELIUS_KEY);
        if (rawTx) tx = rawTx;
      }

      // Still no balance data anywhere → not indexed yet. Hold the pointer and retry,
      // up to a cap (so a permanently-unparseable sig eventually gets stepped over).
      if (!hasTokenBalanceData(tx) && !tx?.transactionError) {
        const n = (pollParseAttempts.get(sig) || 0) + 1;
        if (n < MAX_PARSE_ATTEMPTS) {
          pollParseAttempts.set(sig, n);
          console.log(`[TELEGRAM] Sig ${sig.slice(0,8)} not indexed yet (attempt ${n}/${MAX_PARSE_ATTEMPTS}, pool ${poolAddress.slice(0,6)}) — holding lastSeen`);
          blocked = true;
          continue;
        }
        console.warn(`[TELEGRAM] Giving up on sig ${sig.slice(0,8)} after ${n} attempts (pool ${poolAddress.slice(0,6)})`);
        pollParseAttempts.delete(sig);
        if (!blocked) advanceTo = sig;
        continue;
      }
      pollParseAttempts.delete(sig); // resolved (parsed or errored) — clear retry state

      // Pool-centric detection — classifies buy vs sell from the CLKN pool's
      // own balance change, so Jupiter-routed trades are caught too.
      const trade = detectClknTrade(tx);
      if (!trade) {
        console.log(`[TELEGRAM] No buy/sell in tx ${sig.slice(0,8)} (pool ${poolAddress.slice(0,6)})`);
        if (!blocked) advanceTo = sig;
        continue;
      }

      // Skip the MM vault's own operator wallet — its liquidity deploys/swaps are
      // market-making, not community buys, and shouldn't post as "reinvestment".
      const mmWallet = whirlpoolMM.vault.operatorPubkey && whirlpoolMM.vault.operatorPubkey();
      if (trade.trader && mmWallet && trade.trader === mmWallet) {
        console.log(`[TELEGRAM] Skipping MM vault op (liquidity management) · sig ${sig.slice(0,8)}`);
        rememberSig(sig);
        if (!blocked) advanceTo = sig;
        continue;
      }

      const usd = quoteUsdValue(trade);
      const quoteMeta = QUOTE_TOKENS[trade.quote.mint] || { symbol: '?' };
      const usdStr = usd == null ? "no USD" : "$" + usd.toFixed(4);
      const isReinvestBuy = trade.action !== "sell" && trade.trader != null && DEV_WALLETS.has(trade.trader);
      const floor = trade.action === "sell" ? MIN_SELL_USD
                  : isReinvestBuy ? MIN_REINVEST_USD
                  : MIN_BUY_USD;
      console.log(`[TELEGRAM] ${trade.action === "sell" ? "Sell" : "Buy"} detected (pool ${poolAddress.slice(0,6)}/${pool.dexId}, source ${tx.source || "?"}): ${trade.clknAmount.toFixed(0)} CLKN for ${trade.quote.amount} ${quoteMeta.symbol} (${usdStr}) by ${trade.trader ? trade.trader.slice(0,6) : "unknown"} · sig ${sig.slice(0,8)}`);
      // Feed the rolling daily recap (all real swaps, not just alert-worthy ones
      // — the recap is about total flow, so it records below the alert floor).
      recap.record({ action: trade.action, usd, trader: trade.trader, sig });
      if (usd == null || usd < floor) {
        console.log(`[TELEGRAM] Skipping (${usdStr} < $${floor})`);
        rememberSig(sig); // remember so other pools don't re-process it
        if (!blocked) advanceTo = sig;
        continue;
      }
      if (trade.action === "sell") await notifyClknSell(trade, tx, pool, usd, HELIUS_KEY);
      else                         await notifyClknBuy(trade, tx, pool, usd, HELIUS_KEY);
      rememberSig(sig);
      if (!blocked) advanceTo = sig;
    }

    if (advanceTo) rememberLastSeen(poolAddress, advanceTo);
  } catch (e) {
    console.warn(`[TELEGRAM] Pool ${pool?.address?.slice(0,6) || "?"} poll error:`, e.message);
  }
}

app.listen(PORT, () => {
  console.log(`[CLUCK] Cluck Norris server running on port ${PORT}`);
  console.log(`BAGS_API_KEY present: ${!!process.env.BAGS_API_KEY}`);
  console.log(`HELIUS_API_KEY present: ${!!process.env.HELIUS_API_KEY}`);
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    console.log(`[TELEGRAM] Bot configured · chat ${process.env.TELEGRAM_CHAT_ID} · trade poller starting in 5s`);
    // Brief delay before first poll so server is fully ready
    setTimeout(() => {
      pollClknBuys();
      setInterval(pollClknBuys, 30000);
    }, 5000);
    // Toolkit reminder — checked each minute, fires at fixed 4-hour marks.
    setInterval(toolsReminderTick, 60 * 1000);
    // Bags Launch Radar — checked each minute, fires at fixed 2-hour marks.
    setInterval(bagsLaunchesTick, 60 * 1000);
    // Market Check — checked each minute, fires every 2h near :00 UTC.
    setInterval(marketCheckTick, 60 * 1000);
    // Daily Flow Recap — checked each minute, fires once per day at 00:00 UTC.
    setInterval(recapTick, 60 * 1000);
    setInterval(lockReportTick, 60 * 1000);
    // Bags graduation watcher — every 3 min: alert near-bonding (85%) + capture
    // graduations into our own 48h record (independent of pump.fun flooding ST).
    setTimeout(gradWatcherTick, 12000);
    setInterval(gradWatcherTick, 300 * 1000);   // 5 min — broad discovery: find tokens entering "close to bonding" + fire near-grad alerts
    setInterval(gradHotTick, 60 * 1000);        // 1 min — fast-watch ONLY the alerted ("close to bonding") tokens so graduations post within ~1 min (cost scales with the tiny hot set)
    // Cluck's Lesson — educational post 4×/day on odd UTC hours (13/17/21/01).
    setInterval(eduPostTick, 60 * 1000);
    // Live buy-competition leaderboards — refresh active boards, close on window end.
    setInterval(buyCompTick, 60 * 1000);
    // Interactive slash commands — register the webhook + the "/" command menu.
    (async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token || !TG_WEBHOOK_SECRET) return;
      try {
        await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `${TG_PUBLIC_BASE}/api/tg/${TG_WEBHOOK_SECRET}`,
            secret_token: TG_WEBHOOK_SECRET,
            allowed_updates: ["message", "callback_query"],
          }),
        });
        await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands: [
            { command: "guide", description: "Where do I start? Get pointed the right way" },
            { command: "score", description: "Token health 0–100 (/score <mint>)" },
            { command: "autopsy", description: "Forensic breakdown (/autopsy <mint>)" },
            { command: "trace", description: "Wallet × token history (/trace <wallet>)" },
            { command: "snapshot", description: "Holders + airdrop CSV (/snapshot <mint>)" },
            { command: "holders", description: "True holders vs LP & locks" },
            { command: "securitycoop", description: "Find & revoke risky wallet approvals" },
            { command: "buyspecial", description: "Run a buy competition" },
            { command: "rose", description: "Buy-competition analyzer + prizes" },
            { command: "hatchery", description: "Create a token, guided" },
            { command: "bags", description: "Live Bags.fm launches" },
            { command: "tools", description: "All the Cluck Norris tools" },
            { command: "liquidity", description: "Live AMM depth & positions" },
            { command: "commands", description: "List every command + what it does" },
          ] }),
        });
        console.log("[TELEGRAM] webhook + command menu registered");
      } catch (e) { console.warn("[TELEGRAM] webhook setup failed:", e.message); }
    })();
  } else {
    console.log(`[TELEGRAM] Bot env vars not set — notifications disabled`);
  }

  // Liquidity vault — autonomous Orca Whirlpool position manager. INDEPENDENT of
  // Telegram: it starts only when MM_OPERATOR_SECRET (the dedicated hot wallet)
  // is set, so deploying without that key is a safe no-op and can never move
  // funds. Ticks every 3 minutes; re-centers the position as price moves.
  if (whirlpoolMM.vault.isEnabled()) {
    console.log("[VAULT] Liquidity vault enabled — autonomous position management every 3m");
    const vaultTick = async () => {
      // Equal-pools rebalancer first — swap free SOL↔USDC toward the underweight pool
      // so the deploy triggers below can grow it. Keeps CLKN/USDC ≈ CLKN/SOL in value.
      try {
        const rb = await whirlpoolMM.vault.rebalancePools({});
        if (rb && !["none", "balanced", "capped"].includes(rb.action)) console.log("[VAULT][rebalance]", rb.action, "·", rb.reason || "");
      } catch (e) { console.error("[VAULT] rebalance error:", e.message); }
      // Ask-wall first so it reserves its CLKN before the balanced base sizes.
      try {
        const w = await whirlpoolMM.vault.tickAskWall({});
        if (w && !["none", "hold", "deferred"].includes(w.action)) console.log("[VAULT][ask-wall]", w.action, "·", w.reason || "");
      } catch (e) { console.error("[VAULT] ask-wall tick error:", e.message); }
      try {
        const r = await whirlpoolMM.vault.tick({});
        if (r && !["none", "hold", "deferred"].includes(r.action)) console.log("[VAULT]", r.action, "·", r.reason || "");
      } catch (e) { console.error("[VAULT] tick error:", e.message); }
      // CLKN/SOL vault (optional; off unless solEnabled) — captures SOL-driven arbitrage.
      try {
        const s = await whirlpoolMM.vault.tickSol({});
        if (s && !["none", "hold", "deferred"].includes(s.action)) console.log("[VAULT][CLKN/SOL]", s.action, "·", s.reason || "");
      } catch (e) { console.error("[VAULT] CLKN/SOL tick error:", e.message); }
    };
    setTimeout(vaultTick, 15000);
    setInterval(vaultTick, 180 * 1000);
  } else {
    console.log("[VAULT] MM_OPERATOR_SECRET not set — autonomous vault disabled");
  }
});
