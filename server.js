const express = require("express");
const path = require("path");
const { join } = path;
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { createSign, createHash, createHmac, randomBytes, createPublicKey, verify: ed25519Verify } = require("crypto");
const hatchery = require("./hatchery");
const securityCoop = require("./securitycoop");
const whirlpoolMM = require("./whirlpool-mm");
const meteora = require("./lib/meteora-dlmm"); // Meteora DLMM read layer (SDK lazy-loaded inside)
const lpScanner = require("./lib/lp-scanner"); // LP Pair Scanner (Liquidity Lab flagship) — see docs/LP_SCANNER.md
const diplomaNft = require("./lib/diploma-nft"); // Graduation diploma cNFT minter (Bubblegum, treasury payer)
const orderbook = require("./lib/orderbook-scanner"); // Cluck Order Book — multi-venue resting-order/wall scanner
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
const rpc = require("./lib/rpc"); // resilient RPC: primary Helius + automatic failover
const {
  SOL_ADDR_RE, base58Decode, base58Encode, isOnCurveBytes, isOnCurve, deriveAta,
  DEX_PROGRAMS, LOCKER_PROGRAMS, TOKEN_PROGRAMS, PROGRAM_LABELS,
  KNOWN_SERVICE_WALLETS, KNOWN_CEX_WALLETS,
} = require("./lib/solana-addr");
const { runAutopsy, bagsFetch, heliusEnhancedBatched, BAGS_BASE } = require("./lib/autopsy");
const { getTokenBuyersInWindowHelius, getWalletTokenPositionHelius } = require("./lib/helius-trades");
const QUESTION_BANK = require("./data/question-bank.json");
// Live Classroom curriculum (regenerate with: node scripts/extract-curriculum.js)
let CURRICULUM = { courses: [] };
try { CURRICULUM = require("./data/curriculum.json"); } catch (_) { console.warn("[classroom] curriculum.json missing — run scripts/extract-curriculum.js"); }

// Admin/test-endpoint auth — prefer the x-premium-key HEADER over ?key= (query
// strings persist in access logs, proxies and browser history, so a secret in
// the URL leaks; a header doesn't). ?key= still works as a deprecated fallback
// for existing bookmarks/scripts. 404 (not 401) on failure, as everywhere else.
function adminAuthOK(req) {
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.headers["x-premium-key"] || req.query.key;
  return !!KEY && provided === KEY;
}

// Public-facing error text — internal errors (RPC/Helius/fetch) can carry URLs
// that embed credentials (e.g. ?api-key=...). Strip anything secret-shaped and
// bound the length before it leaves the server; the raw error still reaches the
// server log wherever the catch site logs it.
function publicErrMsg(err, fallback = "internal error") {
  let m = String((err && err.message) || fallback);
  m = m.replace(/api[-_]key=[^&\s"']+/gi, "api-key=***").replace(/https?:\/\/[^\s"']+/gi, "[url]");
  // 1500 keeps full on-chain simulation logs readable for ops debugging while
  // still bounding pathological blobs; secrets are already stripped above.
  return m.length > 1500 ? m.slice(0, 1500) + "…" : m;
}
const { PublicKey } = require("@solana/web3.js");

// Register Oswald (the site's display font) for the transcript card. Without this,
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
    "🩻 <b>Wallet X-Ray</b> — full wallet deep dive: funding origin, trades, bot/dumper signals · <b>FREE</b>\n" +
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

// ── Daily market snapshot — 2×/day: CLKN price, market cap, change, volume &
// Jupiter organic score. Repurposed from the old CLKN/SOL/BTC "Market Check";
// shares one builder with the /price command (see buildMarketSnapshotText).
// Market Check auto-post is OWNER-TOGGLEABLE via kv (default OFF as of 2026-06-14 — owner
// asked to stop the recurring market updates in the community room). Re-enable any time:
// kv marketCheckEnabled true. The manual /api/market-check-test still works regardless.
let lastMarketCheckMsgId = kv.get("marketCheckMsgId", null); // delete-previous, persisted across deploys
// Shared market-snapshot builder — used by /price (on demand) and the 2×/day auto-post.
// Price + market cap from the deepest pool, 24h change/volume, and liquidity.
// Returns the HTML message string, or null if no live price is available.
async function buildMarketSnapshotText(mint = CLKN_MINT_ADDR, sym = "CLKN") {
  const mkt = await getTokenMarket(mint);
  if (!mkt || !mkt.priceUsd) return null;
  const fmtPrice = (p) => p >= 0.01 ? "$" + p.toFixed(4) : "$" + p.toPrecision(3);
  const chg = (v) => v == null ? null : (v >= 0 ? "+" : "") + Number(v).toFixed(1) + "%";
  const c = mkt.change || {};
  let m = `📈 <b>${sym} — market</b>\n\n`;
  m += `💵 Price: <b>${fmtPrice(mkt.priceUsd)}</b>\n`;
  if (mkt.mc) m += `🏦 Market cap: <b>${fmtUsdShort(mkt.mc)}</b>\n`;
  const parts = [c.h1 != null ? `1h ${chg(c.h1)}` : null, c.h6 != null ? `6h ${chg(c.h6)}` : null, c.h24 != null ? `24h ${chg(c.h24)}` : null].filter(Boolean);
  if (parts.length) m += `📊 ${parts.join(" · ")}\n`;
  const vol = fmtUsdShort(mkt.vol24h); if (vol) m += `🔁 24h volume: <b>${vol}</b>\n`;
  if (mkt.liqUsd) m += `💧 Liquidity: <b>${fmtUsdShort(mkt.liqUsd)}</b>\n`;
  m += `\n🐔 ${TG_PUBLIC_BASE}`;
  return m;
}
// The 2×/day auto-post (repurposed Market Check) — the same CLKN snapshot as /price.
async function buildMarketCheckText() {
  return await buildMarketSnapshotText(CLKN_MINT_ADDR, "CLKN");
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
// 2×/day (15, 23 UTC = 10am · 6pm CT), interleaved with the lessons
// (13/17/21/01) so no two scheduled posts share an hour.
const MARKET_CHECK_HOURS_UTC = [15, 23];
let lastMarketCheckHour = kv.get("marketCheckHour", -1);
function marketCheckTick() {
  if (kv.get("marketCheckEnabled", false) !== true) return; // owner turned it off (2026-06-14)
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
// School of Hard Knocks, LP Lab, security); Claude writes each lesson in Cluck's
// voice. Fires 3×/day on ODD UTC hours so it never collides with the other
// scheduled posts (which land on even hours). Topics come from a SHUFFLED deck
// (persisted) — every topic airs once before any repeat, but the order reshuffles
// each pass so it never reads like the same predictable loop.
// Posts STAY (no self-clean) — they're a learning record.
const EDU_POST_ENABLED = true;
// 3×/day on the US-active window: 13/19/01 UTC = 9am · 3pm · 9pm ET. Kept on ODD
// UTC hours so they never collide with the even-hour posts (Market Check / recap).
// The 13:00 (morning) slot is the LONG lesson; 19:00 and 01:00 are punchy shorts.
const EDU_HOURS_UTC = [13, 19, 1];
const EDU_LONG_HOUR = 13; // one full lesson per day (morning); the other two slots are short
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
  "Token approvals: what you grant when you trade, why unlimited approvals to unknown contracts are dangerous, and how to revoke the ones you no longer use",
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
  "Token authorities explained: mint authority (can they print more supply?) vs update/metadata authority (can they change the name, image, or socials after launch?), and why renouncing or burning them builds buyer trust",
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
  "How to tell organic volume from wash trading",
  "Limit orders vs market orders, and when each one saves you money",
  "Cross-chain bridges and the real risks of wrapped assets (like wrapped BTC on Solana)",
  "Why deep liquidity matters more than a token's headline 24h volume number",
  "How to verify a token's liquidity is actually locked — and for how long",
  "Position sizing and stop-losses: how to survive long enough to win",
  "How to read a block explorer to confirm what a transaction actually did",
  "Arbitrage: how it keeps prices aligned across pools, and why arb volume isn't the same as real (organic) demand",
  "Volume vs demand: why a high trade count can still mean only a handful of real buyers",
];
// Lesson topic → the live tool that lets the reader DO the lesson right now.
// Keyword-matched against the topic text so new topics degrade gracefully —
// no match = no tool line, never a wrong link. First match wins (order matters:
// specific tools before the broad autopsy/score patterns).
const EDU_TOOL_ROUTES = [
  { match: /approval|revoke/i, label: "Check & revoke YOUR wallet's approvals (free)", url: "clucknorris.app/security-coop" },
  { match: /self-custody|not your keys/i, label: "Free wallet safety checkup — paste any address", url: "clucknorris.app/wallet-checkup" },
  { match: /block explorer|transaction actually did/i, label: "Trace any wallet × token history yourself (free)", url: "clucknorris.app/trace" },
  { match: /holder concentration|volume vs demand|handful of real buyers/i, label: "See any token's REAL holders vs LP & locks (free)", url: "clucknorris.app/holders" },
  { match: /wash trading|organic volume|arbitrage/i, label: "See how honest, non‑wash liquidity works (Liquidity Engine)", url: "clucknorris.app/liquidity-engine" },
  { match: /bonding curve|graduation|graduated|creator fees/i, label: "Watch live Bags launches & graduations", url: "clucknorris.app/bags" },
  { match: /honeypot|rug pull|red flags|on-chain research|contract address|authorities|locked liquidity|faked out|phantom pool/i, label: "Run a free Token Autopsy on any mint", url: "clucknorris.app/autopsy" },
  { match: /market cap|low-liquidity|deep liquidity|manipulate/i, label: "Run a free deep-dive Token Autopsy on any mint", url: "clucknorris.app/autopsy" },
  { match: /liquidity pool|AMM|x\*y=k|impermanent|providers earn|concentrated liquidity|bins and ticks|price bins|asks vs bids|ask is a sell|active vs passive|pool's liquidity/i, label: "Practice in the free interactive LP Lab", url: "clucknorris.app" },
  { match: /dollar-cost|risk budget|position sizing|stop-loss|survive/i, label: "Practice with $1K fake money in the Survival Simulator", url: "clucknorris.app" },
];
function eduToolRoute(topic) { for (const r of EDU_TOOL_ROUTES) if (r.match.test(topic)) return r; return null; }

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
// Shuffled-deck topic rotation: deal through a shuffled copy of the whole topic
// list (every topic airs once before any repeat), then reshuffle on exhaustion —
// so the order changes each pass and it never reads like the same loop. Reshuffles
// automatically if the topic list length changes (e.g. topics added/removed).
function nextEduTopic() {
  let deck = kv.get("eduDeckV2", []);
  let pos = kv.get("eduDeckPosV2", 0);
  if (!Array.isArray(deck) || deck.length !== EDU_TOPICS.length || pos >= deck.length) {
    deck = [...Array(EDU_TOPICS.length).keys()];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    pos = 0;
    kv.set("eduDeckV2", deck);
  }
  const topic = EDU_TOPICS[deck[pos]];
  kv.set("eduDeckPosV2", pos + 1);
  return topic;
}
async function notifyEduPost() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const topic = nextEduTopic();
  // 1 long + 2 short per day: the morning (EDU_LONG_HOUR) slot is the full lesson; the others are short.
  const style = (new Date().getUTCHours() === EDU_LONG_HOUR) ? "full" : "short";
  const body = await generateEduLesson(topic, style);
  if (!body) { console.warn("[EDU] no body, skipping post for topic:", topic); return; }
  // Pair the lesson with the live tool that practices it (e.g. the block-explorer
  // lesson links the Trace tool) — the lesson teaches, the link converts.
  const route = eduToolRoute(topic);
  const toolLine = route ? `🛠 <b>${route.label}</b> → ${route.url}\n` : "";
  const text = `🎓 <b>CLUCK'S LESSON</b>\n\n${tgEsc(body)}\n\n${toolLine}💬 <i>Reply to this lesson with a question and Cluck will answer.</i>\n📚 The full course is in session → clucknorris.app`;
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
        try { await postToX(route ? `🛠 ${route.label} → ${route.url}\n\n${X_LESSON_REPLY}` : X_LESSON_REPLY, { replyToId: r.id }); } catch (_) {}
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
      const prize = (i < c.places.length) ? (c.pctPrize ? ` — <b>${c.places[i].amount}% bonus</b>` : ` — <b>${c.places[i].amount.toLocaleString()} ${tgEsc(c.ticker)}</b>`) : "";
      lines.push(`${tag} <code>${short}</code> · ${(s[key] || 0).toFixed(2)} SOL${prize}`);
    });
  }
  lines.push("");
  const metricLabel = c.metric === "single" ? "biggest single buy" : "cumulative bought";
  const filterNote = c.liveHoldFilter !== false ? " · 🤖 in-window sellers auto-removed" : "";
  lines.push(`<i>metric: ${metricLabel} · refreshes ~${c.updateMins}m${filterNote} · type /buyleaders anytime</i>`);
  lines.push(ended
    ? `⚠️ PROVISIONAL. Winners must hold ${c.holdHours}h (no sells/transfers); official results come from the Rose scan after the hold.`
    : "⚠️ Live &amp; provisional — official winners are confirmed after the hold period via the Rose scan (wash-trade &amp; hold checked).");
  return lines.join("\n");
}
function buyCompMetricKey(c) { return c.metric === "single" ? "maxBuySol" : "volumeSol"; }
// Wallets that must never count in a buy comp: every managed-vault operator wallet
// (the liquidity engines — their buys are market-making, not community buys, exactly
// like the trade poller skips them for buy alerts) PLUS the comp's manual exclude list
// (third-party volume-bot wallets the operator identifies). Same principle as the CLKN
// buy-alert poller's MM-wallet skip.
function buyCompExcludeSet(c) {
  const ex = new Set();
  try { (whirlpoolMM.vault.operatorPubkeys ? whirlpoolMM.vault.operatorPubkeys() : []).forEach((w) => w && ex.add(w)); } catch (_) {}
  (Array.isArray(c.exclude) ? c.exclude : []).forEach((w) => w && ex.add(w));
  return ex;
}
const BC_TX_CACHE = new Map();  // enhanced-tx cache shared across comp refreshes
// ── Multi-source buy data (Helius primary → GeckoTerminal → Solana Tracker) ──
// One source chain shared by the buy COMPETITION and the buy-SPECIAL raffle, so
// both prefer Helius (paid plan) and only touch ST as a last resort.
async function buyersInWindowMulti(mint, fromMs, toMs, { maxPages = 60 } = {}) {
  if (BC_TX_CACHE.size > 8000) BC_TX_CACHE.clear();
  try {
    const [solUsd, mkt] = await Promise.all([
      getSolUsd().catch(() => 0),
      getTokenMarket(mint).catch(() => null),
    ]);
    const h = await getTokenBuyersInWindowHelius(mint, fromMs, toMs, {
      heliusKey: process.env.HELIUS_API_KEY, heliusEnhancedBatched,
      solUsd: solUsd || 0, tokenPriceUsd: (mkt && mkt.priceUsd) || 0, txCache: BC_TX_CACHE,
    });
    // A successful Helius scan is authoritative even with ZERO buyers — but only when it
    // covered the whole window. An empty result from a truncated scan (or a non-empty one)
    // reports its real coverage; empty + truncated falls through to the backup sources.
    if (h && h.buyers && (h.buyers.length || h.reachedWindowStart)) {
      return { buyers: h.buyers, source: "helius", reachedWindowStart: h.reachedWindowStart !== false };
    }
  } catch (e) { console.warn("[BUY] helius buyers failed:", e.message); }
  try {
    const g = await geckoBuyersInWindow(mint, fromMs, toMs);
    if (g.length) return { buyers: g, source: "geckoterminal", reachedWindowStart: true };
  } catch (e) { console.warn("[BUY] gecko buyers failed:", e.message); }
  try {
    const r = await solanaTracker.getTokenBuyersInWindow(mint, Math.floor(fromMs / 1000), Math.floor(toMs / 1000), { maxPages });
    if (r) return { buyers: r.buyers || [], source: "solana-tracker", reachedWindowStart: r.reachedWindowStart };
  } catch (e) { console.warn("[BUY] ST buyers failed:", e.message); }
  return { buyers: [], source: "none", reachedWindowStart: false };
}
// Wallet's hold position (balance + sells) — Helius first, ST fallback. Returns
// { sells, balance } in the shape the verify logic expects.
async function walletPositionMulti(wallet, mint, { fromMs = null, toMs = null } = {}) {
  try {
    const h = await getWalletTokenPositionHelius(wallet, mint, {
      heliusKey: process.env.HELIUS_API_KEY, heliusEnhancedBatched, txCache: BC_TX_CACHE, fromMs, toMs,
    });
    if (h) return { sells: h.sells, balance: h.balance, transfersOut: h.transfersOut, source: "helius" };
  } catch (e) { console.warn("[BUY] helius position failed:", e.message); }
  try {
    const pos = premiumForensics.parseStPosition(await solanaTracker.getWalletTokenPosition(wallet, mint));
    if (pos) return { ...pos, source: "solana-tracker" };
  } catch (e) { console.warn("[BUY] ST position failed:", e.message); }
  return null;
}
// Live round-trip bot filter: which of these wallets have SOLD within the contest
// window. A buy-and-dump bot sells the bag it just bought — the same disqualifier the
// post-hold Rose scan enforces, brought forward so dumpers never sit on the live board.
// Cost-guarded: results are cached and a wallet once flagged sold is never re-checked
// (a past in-window sell can't be undone); clean wallets are re-checked on a short TTL
// (they might sell later). Only a Helius window-scoped read is authoritative for a drop —
// if we had to fall back to an unscoped source, we don't risk a false disqualification.
const BC_SOLD_CACHE = new Map();   // `${compId}:${wallet}` -> { sold, ts }
const BC_SOLD_TTL = 120000;        // re-check not-yet-sold wallets at most this often
async function buyCompSoldSet(c, wallets, toMs) {
  if (BC_SOLD_CACHE.size > 20000) BC_SOLD_CACHE.clear();
  const out = new Set();
  const now = Date.now();
  const toCheck = [];
  for (const w of wallets) {
    const hit = BC_SOLD_CACHE.get(`${c.id}:${w}`);
    if (hit && hit.sold) { out.add(w); continue; }        // sticky once sold-in-window
    if (hit && now - hit.ts < BC_SOLD_TTL) continue;      // recently confirmed clean
    toCheck.push(w);
  }
  const CONC = 4;                                          // bounded concurrency (quota guard)
  for (let i = 0; i < toCheck.length; i += CONC) {
    await Promise.all(toCheck.slice(i, i + CONC).map(async (w) => {
      try {
        const pos = await walletPositionMulti(w, c.mint, { fromMs: c.startTs, toMs });
        const soldInWindow = !!pos && pos.source === "helius" && (pos.sells || 0) > 0;
        if (pos) BC_SOLD_CACHE.set(`${c.id}:${w}`, { sold: soldInWindow, ts: Date.now() });
        if (soldInWindow) out.add(w);
      } catch (_) { /* lookup failed — innocent until proven; don't drop */ }
    }));
  }
  return out;
}
async function buyCompStandings(c) {
  const toMs = Math.min(Date.now(), c.endTs);
  const { buyers: raw } = await buyersInWindowMulti(c.mint, c.startTs, toMs);
  const key = buyCompMetricKey(c);
  // Drop MM/engine wallets + manual excludes, then any sub-floor cumulative (dust/bot filter).
  const ex = buyCompExcludeSet(c);
  const minVol = Number(c.minVolSol) || 0;
  let buyers = (raw || []).filter((b) => !ex.has(b.wallet) && (minVol <= 0 || (b.volumeSol || 0) >= minVol));
  buyers.sort((a, b) => (b[key] || 0) - (a[key] || 0));
  // Then drop buy-and-dump bots: any wallet that already sold within the window. Default
  // ON; per-comp opt-out via liveHoldFilter:false. Only the top candidates are checked
  // (enough to fill the displayed board after drops) to bound the per-refresh cost.
  if (c.liveHoldFilter !== false && buyers.length) {
    const need = Math.max((c.places ? c.places.length : 3) + 6, 26);
    const sold = await buyCompSoldSet(c, buyers.slice(0, need).map((b) => b.wallet), toMs);
    if (sold.size) buyers = buyers.filter((b) => !sold.has(b.wallet));
  }
  return buyers;
}
// GeckoTerminal pool-trades fallback for buy standings (no API key, no quota). Discovers
// the token's pools via DexScreener, pulls each pool's recent trades, keeps buys in the
// window, and aggregates per wallet. volumeSol is USD/SOL-price (single recent price — fine
// for a short comp). Limit: GT returns the last ~300 trades/pool, so it fully covers a
// low/medium-volume token's window but could miss the oldest buys on a very busy token.
async function geckoBuyersInWindow(mint, fromMs, toMs) {
  let pools = [];
  try {
    const dx = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(dx)) pools = dx.map((p) => p.pairAddress).filter(Boolean);
  } catch (_) {}
  if (!pools.length) return [];
  const solUsd = (await getSolUsd().catch(() => 0)) || 0;
  const buyers = new Map();
  for (const pool of pools.slice(0, 6)) {
    try {
      // Via the shared Pro→free onchain helper: CoinGecko Pro gives higher trade-history
      // limits/coverage when COINGECKO_API_KEY is set, else free GeckoTerminal.
      const data = (await lpScanner.cgFetch(`/networks/solana/pools/${pool}/trades`)).data || [];
      for (const t of data) {
        const a = t.attributes || {};
        if (a.kind !== "buy") continue;
        const tMs = Date.parse(a.block_timestamp);
        if (!(tMs >= fromMs && tMs <= toMs)) continue;
        const wallet = a.tx_from_address;
        if (!wallet) continue;
        const usd = Number(a.volume_in_usd) || 0;
        const sol = solUsd > 0 ? usd / solUsd : 0;
        const cur = buyers.get(wallet) || { wallet, buyCount: 0, volumeSol: 0, maxBuySol: 0, volumeUsd: 0 };
        cur.buyCount++; cur.volumeSol += sol; cur.volumeUsd += usd;
        if (sol > cur.maxBuySol) cur.maxBuySol = sol;
        buyers.set(wallet, cur);
      }
    } catch (e) { console.warn(`[BUYCOMP] gecko pool ${pool.slice(0, 6)} failed:`, e.message); }
  }
  return [...buyers.values()];
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
      // Sells are scoped to comp-start onward (through the hold period — no toMs):
      // dumping pre-comp bags doesn't DQ, selling the comp buys does. Matches the
      // live board's in-window filter so a wallet shown live can't be DQ'd for
      // ancient history at payout.
      const pos = await walletPositionMulti(s.wallet, c.mint, { fromMs: c.startTs });
      if (!pos) { status = "manual"; note = "no position data — verify by hand (Trace)"; }
      else if ((pos.sells || 0) > 0) { status = "dq"; note = `sold on-chain (${pos.sells} sell${pos.sells > 1 ? "s" : ""})`; }
      else if ((pos.balance || 0) <= 0) { status = "manual"; note = "no sells but holds 0 — transferred out; trace to runner wallet"; }
      else { status = "qualified"; note = `holds ${Math.round(pos.balance).toLocaleString()}, no sells`; }
    } catch (e) { status = "manual"; note = "lookup failed — verify by hand"; }
    results.push({ wallet: s.wallet, value: s[key] || 0, status, note });
  }
  // Fill the prize places with non-DQ candidates, in rank order (DQs promote the rest up).
  const eligible = results.filter(r => r.status !== "dq");
  c.verified = eligible.slice(0, c.places.length).map((r, i) => ({ rank: i + 1, wallet: r.wallet, amount: c.pctPrize ? +((r.value || 0) * c.places[i].amount / 100).toFixed(4) : c.places[i].amount, ...(c.pctPrize ? { amountNote: `${c.places[i].amount}% of ${(r.value || 0).toFixed(2)} SOL bought (SOL terms — operator converts/pays manually)` } : {}), status: r.status, note: r.note }));
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
  // A member asked for this board, so leave it — extras a member triggered are fine.
  // Deliberately NOT tracked as c.boardMsgId and never deletes prior posts: only the
  // BOT's OWN scheduled reposts self-clean (see buyCompUpdate), so "ours" never stacks
  // while member-requested boards stay put. Silent so the bump doesn't ping the room.
  tgSend(chatId, buyCompRender(c, standings), replyTo, { silent: true });
}

// ── Interactive slash commands ─────────────────────────────────────────────
// The bot is otherwise send-only; this lets group members run /walletxray, /trace,
// /autopsy, /bags, /hatchery, etc. and get back a deep link (pre-filled with the
// mint/wallet they pass, where the tool page supports it). Delivered via a
// Telegram webhook (the server is public) — a secret_token validates that
// updates really come from Telegram. Slash commands are delivered to bots in
// groups even with privacy mode on, so this works in the Cluck Norris group.
const TG_PUBLIC_BASE = "https://clucknorris.app";
const TG_WEBHOOK_SECRET = process.env.TELEGRAM_BOT_TOKEN
  ? createHash("sha256").update("tg-webhook:" + process.env.TELEGRAM_BOT_TOKEN).digest("hex").slice(0, 40)
  : "";

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
    case "ca":
      return `🐔 <b>Cluck Norris (CLKN) — contract address</b>\n` +
        `<code>${CLKN_MINT}</code>\n\n` +
        `📊 Chart → https://${CLKN_DEXSCREENER}\n` +
        `💸 Buy on Jupiter → https://jup.ag/tokens/${CLKN_MINT}\n\n` +
        `<i>Tap the address to copy. Always double-check the CA before buying.</i>`;
    case "x":
      return `🐦 <b>Follow Cluck Norris on X</b>\nhttps://x.com/firechicken007`;
    case "website":
    case "app":
      return `🐔 <b>Cluck Norris</b> — the free crypto school + Solana tools\n${TG_PUBLIC_BASE}`;
    case "dex":
      return `📊 <b>CLKN on DexScreener</b>\nhttps://${CLKN_DEXSCREENER}`;
    case "walletxray":
      return `🩻 <b>Wallet X-Ray</b> — full wallet deep dive: funding origin, every trade, bot/dumper signals\n${link("/wallet-xray", "wallet")}` + (addr ? "" : "\n\nTip: <code>/walletxray &lt;wallet&gt;</code> pre-fills a wallet.");
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
        "🐥 /guide — new here? get pointed the right way\n" +
        "🐔 /ca — CLKN contract address + chart\n" +
        "📊 /dex — CLKN DexScreener chart\n" +
        "🐦 /x — our X (Twitter) account\n" +
        "🌐 /website (or /app) — clucknorris.app\n" +
        "💵 /price — CLKN price, market cap &amp; volume\n" +
        "🩻 /walletxray <code>&lt;wallet&gt;</code> — full wallet deep dive\n" +
        "🪦 /autopsy <code>&lt;mint&gt;</code> — full forensic breakdown\n" +
        "🔍 /trace <code>&lt;wallet&gt;</code> — wallet × token history\n" +
        "📸 /snapshot <code>&lt;mint&gt;</code> — holders + airdrop CSV\n" +
        "👥 /holders — true holders vs LP &amp; locks\n" +
        "🔒 /securitycoop — find &amp; revoke risky wallet approvals\n" +
        "📈 /buyspecial — run a buy competition\n" +
        "🌹 /rose — buy-competition analyzer + prizes\n" +
        "🏆 /buyleaders — live buy-competition standings\n" +
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
// Which vault project a Telegram chat maps to (by registered telegramChatId) — so
// /liquidity in the ROSE room shows ROSE, in the CLKN room shows CLKN. Default: clkn.
function vaultProjectForChat(chatId) {
  try {
    const projs = whirlpoolMM.vault.listProjects();
    for (const id of Object.keys(projs)) {
      if (projs[id] && String(projs[id].telegramChatId || "") === String(chatId)) return id;
    }
  } catch (_) { /* fall through to default */ }
  return "clkn";
}
async function liquidityReply(chatId, replyTo) {
  const money = (n) => { n = Number(n) || 0; if (n >= 100) return "$" + Math.round(n).toLocaleString(); if (n >= 1) return "$" + n.toFixed(2); return "$" + n.toFixed(4); };
  const tok = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"; return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 }); };
  try {
    const projectId = vaultProjectForChat(chatId);
    const proj = (whirlpoolMM.vault.listProjects() || {})[projectId] || {};
    const sym = proj.symbol || "CLKN";
    const r = await whirlpoolMM.vault.publicPositions(projectId);
    if (!r.enabled) { tgSend(chatId, `📊 The ${sym} Liquidity Engine isn't running right now.`, replyTo); return; }
    if (r.error && !r.positions.length) { tgSend(chatId, `📊 Can't read ${sym} on-chain depth this moment — the data provider is rate-limiting. The positions are still live; try again in a few minutes.`, replyTo); return; }
    if (!r.positions.length) { tgSend(chatId, `📊 No active ${sym} liquidity positions at the moment.`, replyTo); return; }
    let m = `📊 <b>${sym} Liquidity Engine — live depth</b>\n<i>powered by Cluck Norris</i>\n\n`;
    const plain = projectId !== "clkn"; // CLKN/school keeps trading terms (it teaches them); other rooms get plain English
    for (const p of r.positions) {
      const shape = p.role === "askwall" ? (plain ? "upside liquidity" : `ask wall · upside ${sym}`)
                  : p.lower >= p.current * 0.999 ? (plain ? "upside liquidity" : `upside asks (${sym})`)
                  : p.upper <= p.current * 1.001 ? "buy support"
                  : "two-sided";
      const quoteStr = p.quoteSymbol === "USDC" ? money(p.quoteAmount) : (tok(p.quoteAmount) + " SOL");
      m += `• <b>${p.pair}</b> · ${shape} ${p.inRange ? "🟢" : "⚪"}\n`;
      m += `   <b>${money(p.valueUsd)}</b> depth — ${tok(p.clknAmount)} ${sym} + ${quoteStr}\n`;
    }
    const vol = fmtUsdShort(await getClkn24hVolume(proj.tokenMint || CLKN_MINT_ADDR));
    m += `\n💧 <b>Total depth: ${money(r.totalUsd)}</b>`;
    if (r.stale) m += `  <i>(snapshot ~${r.staleSeconds}s old — live read is rate-limited)</i>`;
    if (vol) m += `  ·  📈 24h vol: <b>${vol}</b>`;
    // Active engine mode (only when a named mode is applied — "custom" stays hidden).
    try {
      const cm = whirlpoolMM.vault.listModes(projectId).current;
      if (cm && cm.mode && cm.mode !== "custom") m += `\n🎛️ Mode: <b>${cm.mode}${cm.tilt ? " · " + cm.tilt : ""}</b>`;
    } catch (_) { /* mode line is best-effort */ }
    const poolCount = new Set(r.positions.map((p) => p.pair)).size;
    m += `\n\n${r.positions.length} position${r.positions.length > 1 ? "s" : ""} across ${poolCount} pool${poolCount > 1 ? "s" : ""} — real depth, real fills, no fake volume. 🐔\n${TG_PUBLIC_BASE}/liquidity`;
    tgSend(chatId, m, replyTo);
  } catch (e) {
    tgSend(chatId, "📊 Couldn't load liquidity positions right now — try again shortly.", replyTo);
  }
}

// /price — quick market snapshot: price, market cap, 24h change/volume, liquidity, and
// the Jupiter organic score. Project-aware (ROSE room shows ROSE), reuses cached helpers.
async function priceReply(chatId, replyTo) {
  const projectId = vaultProjectForChat(chatId);
  const proj = (whirlpoolMM.vault.listProjects() || {})[projectId] || {};
  const sym = proj.symbol || "CLKN";
  const mint = proj.tokenMint || CLKN_MINT_ADDR;
  try {
    const text = await buildMarketSnapshotText(mint, sym);
    if (!text) { tgSend(chatId, `📈 Couldn't read ${sym} price right now — try again shortly.`, replyTo); return; }
    tgSend(chatId, text, replyTo);
  } catch (e) {
    tgSend(chatId, `📈 Couldn't load ${sym} price right now — try again shortly.`, replyTo);
  }
}

const TG_KNOWN_CMDS = ["ca","x","website","app","dex","walletxray","autopsy","trace","snapshot","holders","securitycoop","buyspecial","rose","hatchery","bags","tools","liquidity","price","commands","start","help","guide","buyleaders","chatid"];
// In a non-CLKN project room (e.g. ROSE) the bot only serves that project's liquidity +
// buy competitions; chatid stays so an operator can wire a buy comp. Everything else off.
const PROJECT_ROOM_CMDS = ["liquidity","price","buyleaders","chatid"];
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
        `🪦 <b>Token Autopsy</b> — deep forensic breakdown → ${B}/autopsy\n` +
        `🩻 <b>Wallet X-Ray</b> — full wallet deep dive (funding, trades, bot/dumper) → ${B}/wallet-xray\n` +
        `🔍 <b>Trace</b> — wallet × token history → ${B}/trace\n` +
        `📸 <b>Snapshot</b> — every holder + airdrop CSV → ${B}/snapshot\n` +
        `🔒 <b>Wallet Checkup</b> — find &amp; revoke risky approvals → ${B}/security-coop\n` +
        `🎒 <b>Bags feed</b> — live launches &amp; graduations → ${B}/bags\n\n` +
        "Tip: right here in chat you can run <code>/autopsy &lt;mint&gt;</code> or <code>/walletxray &lt;wallet&gt;</code>. The chain shows <i>what</i>, never <i>why</i> — always DYOR.";
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
    "- Free tools: TOKEN AUTOPSY (/autopsy — deep forensics), WALLET X-RAY (/wallet-xray — full wallet deep dive: funding origin, every trade, bot/dumper signals), TRACE (/trace — wallet×token history), SNAPSHOT (/snapshot — holders + airdrop CSV), WALLET CHECKUP (/security-coop — find & revoke risky approvals), BAGS feed (/bags — live launches & graduations), and the toolkit index (/tools).",
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
const welcomeLastMsg = new Map();  // chatId -> last welcome msg id; deleted when the next
                                   // welcome posts, so the chat holds ONE welcome, not a pile.
async function welcomeNewMembers(msg) {
  const chatId = msg.chat && msg.chat.id;
  const members = (msg.new_chat_members || []).filter(m => m && !m.is_bot);
  if (!chatId || !members.length) return;
  // Don't push the Cluck Norris guide into another project's room (e.g. ROSE). The CLKN
  // welcome only fires in the CLKN room + general groups, never a registered non-CLKN room.
  if (vaultProjectForChat(chatId) !== "clkn") return;
  const now = Date.now(), last = welcomeCooldown.get(chatId) || 0;
  if (now - last < WELCOME_COOLDOWN_MS) return;            // anti-spam on join waves
  welcomeCooldown.set(chatId, now);
  const tags = members.slice(0, 8).map(m =>
    `<a href="tg://user?id=${m.id}">${tgEsc(m.first_name || m.username || "friend")}</a>`).join(", ");
  const mid = await tgSendKb(chatId, `🐔 Welcome to the coop, ${tags}!\n\n${GUIDE_BODY}`, GUIDE_KEYBOARD);
  if (mid) {
    registerCluckAnswer(mid, { guide: true, history: [] });
    const prev = welcomeLastMsg.get(chatId);
    if (prev && prev !== mid) tgDelete(chatId, prev);      // self-clean: newest welcome only
    welcomeLastMsg.set(chatId, mid);
  }
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
    // In a non-CLKN project room (e.g. ROSE) the bot is only here for that project's
    // liquidity + buy competitions — ignore every other command (school, tools, etc.).
    if (vaultProjectForChat(msg.chat.id) !== "clkn" && !PROJECT_ROOM_CMDS.includes(cmd)) return;
    const arg = parts[1] || null;
    // /start or /guide → open the "Where do I start?" concierge with buttons. (Only the
    // CLKN room reaches this — project rooms are gated to PROJECT_ROOM_CMDS above.)
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
    // /liquidity → live, sanitized snapshot of the Liquidity Engine's positions.
    if (cmd === "liquidity") {
      liquidityReply(msg.chat.id, msg.message_id);
      return;
    }
    // /price → quick market snapshot (price, MC, change, volume, organic score).
    if (cmd === "price") {
      priceReply(msg.chat.id, msg.message_id);
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
app.use("/api/lp-ask", rateLimit("ai", { windowMs: 60000, max: 12 }));
app.use("/api/verify-clkn-payment", rateLimit("pay", { windowMs: 60000, max: 20 }));
// Classroom: generous enough for a real multi-turn lesson/exam, tight enough to stop a bot
// hammering the reward loop. Claim is rare (one per graduation) so it's capped hard.
app.use("/api/classroom-exam", rateLimit("exam", { windowMs: 60000, max: 25 }));
app.use("/api/classroom/graduate-claim", rateLimit("gradclaim", { windowMs: 60000, max: 6 }));
app.use("/api/classroom", rateLimit("class", { windowMs: 60000, max: 30 })); // also covers /api/classroom-exam + claim (counts on top)

// The Hatchery (token creator) — mounted before the global JSON parser so its
// own larger body limit handles the base64 logo upload instead of the 100kb default.
app.use("/api/hatchery", hatchery.router);
app.use("/api/security-coop", securityCoop.router);
// Liquidity Engine — Orca Whirlpools market maker (non-custodial; builds unsigned txs).
app.use("/api/whirlpool", whirlpoolMM.router);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
  if (!adminAuthOK(req)) {
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
  if (!adminAuthOK(req)) {
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
  // Validate the address shape before it flows into upstream API paths/queries
  // (Jupiter, Solana Tracker, Bags) — matches the guard every other forensic
  // endpoint uses; blocks path/query injection via a malformed mint.
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ error: "invalid_mint" });

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
        try { position = await walletPositionMulti(wallet, mint); } catch (_) {}
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
    return res.status(500).json({ success: false, error: publicErrMsg(e) });
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
  // PRIMARY: GeckoTerminal (free) — price/MC/liquidity/volume with NO ST credits.
  // GT indexes pools straight from chain (curve + DEX), so it covers pre- and
  // post-graduation tokens. ST is now a LAST-RESORT backup only (see below).
  try {
    const gt = await fetchGeckoTerminalFallback(mint);
    if (gt && (gt.priceUsd != null || gt.fdv != null)) {
      const dexId = (gt.dexId || "").toLowerCase();
      const data = {
        name: gt.name || null,
        symbol: gt.symbol || null,
        priceUsd: gt.priceUsd ?? null,
        marketCap: gt.fdv ?? null,
        liquidityUsd: gt.totalLiqUsd ?? null,
        change24h: null,
        volume24h: gt.totalVol24h ?? null,
        market: dexId || null,
        onBondingCurve: dexId ? solanaTracker.isLaunchpadCurveMarket(dexId) : null,
        curvePct: null, // GT doesn't expose bonding-curve %; the ST backup fills it when reachable
        createdAt: null,
        image: null, twitter: null, website: null,
        source: "geckoterminal",
      };
      BAGS_FEED_PRICE_CACHE.set(mint, { data, ts: now });
      return data;
    }
  } catch (_) { /* GT miss → fall through to the ST backup */ }
  // LAST-RESORT BACKUP: Solana Tracker (quota-billed; only when GT returns nothing).
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

// ── LP Pair Scanner (Liquidity Lab flagship) — see docs/LP_SCANNER.md ──────────
// Given a PAIR (?a=<symbol|mint>&b=<symbol|mint>), find every open pool for it across
// every Solana DEX (GeckoTerminal), ranked by turnover. Public read — it's a tool.
// Informational only, NOT financial advice. No Solana Tracker dependency.
app.get("/api/lp-scan", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const A = req.query.a || req.query.tokenA, B = req.query.b || req.query.tokenB;
  if (!A || !B) return res.status(400).json({ success: false, error: "pass ?a=<token>&b=<token> (symbol or mint), optional &amount=<usd>" });
  if (req.query.debug === "cg") return res.status(200).json({ success: true, cg: await lpScanner.debugCg() });
  if (req.query.debug === "readers") return res.status(200).json({ success: true, readers: await lpScanner.debugReaders() });
  if (req.query.debug === "1") {
    try { return res.status(200).json({ success: true, debug: await lpScanner.debugFee(String(req.query.pool || "HfgjZDmexhFVD28Vkb1NbQwWeXP3uDcVTLPjSGHmRHhL")) }); }
    catch (e) { return res.status(200).json({ success: false, debugError: e.message, stack: String(e.stack || "").split("\n").slice(0, 4) }); }
  }
  const amountUsd = Number(req.query.amount) || 0;
  try { return res.status(200).json({ success: true, ...(await lpScanner.scanPair(String(A), String(B), { amountUsd })) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// LP Scanner token search (autocomplete) — ?q=. Public read.
app.get("/api/lp-token-search", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  try { return res.status(200).json({ success: true, tokens: await lpScanner.searchTokens(String(req.query.q || "")) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message, tokens: [] }); }
});

// Probe what the CoinGecko Analyst key unlocks on the AGGREGATED (non-onchain) API — so we
// know which endpoints to build on. Gated (admin); 404 when the key is wrong/absent.
app.get("/api/cg-agg-test", async (req, res) => {
  if (!adminAuthOK(req)) return res.status(404).json({ success: false, error: "not found" });
  const out = { keySet: !!process.env.COINGECKO_API_KEY };
  try { out.key = await lpScanner.cgPro("/key"); } catch (e) { out.keyErr = e.message; }
  try { out.price = await lpScanner.cgPro("/simple/price?ids=solana,bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"); } catch (e) { out.priceErr = e.message; }
  try { out.trending = ((await lpScanner.cgPro("/search/trending")).coins || []).slice(0, 5).map((c) => c.item && c.item.symbol); } catch (e) { out.trendingErr = e.message; }
  try { out.gainers = ((await lpScanner.cgPro("/coins/top_gainers_losers?vs_currency=usd&duration=24h")).top_gainers || []).slice(0, 5).map((c) => c.symbol); } catch (e) { out.gainersErr = e.message; }
  try { out.clknCoinId = await lpScanner.coingeckoIdForMint("DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"); } catch (e) { out.bridgeErr = e.message; }
  return res.status(200).json({ success: true, ...out });
});

// LP Scanner TOP POOLS — busiest Solana pools across all DEXs, refreshed hourly (warmed by
// a background timer below; this returns the cached set, computing it on the first cold call).
app.get("/api/lp-top", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=600");
  try { return res.status(200).json({ success: true, ...(await lpScanner.topPools({ kind: req.query.kind, force: req.query.refresh === "1" })) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// Warm the Top Pools cache shortly after boot, then refresh it every hour, so /api/lp-top is
// always instant. Runs regardless of the Telegram scheduler block (this is a public read).
function warmTopPools() {
  for (const kind of ["trending", "bluechip"]) {
    lpScanner.topPools({ kind, force: true })
      .then(t => console.log(`[lp-top] warmed ${kind}: ${t.count} pools`))
      .catch(e => console.warn(`[lp-top] warm ${kind} failed:`, e.message));
  }
}
setTimeout(warmTopPools, 12000);
setInterval(warmTopPools, 60 * 60 * 1000);

// Token market overview — a compact, tool-agnostic market snapshot for any mint. Fuses the
// AGGREGATED CoinGecko data (authoritative rank/ATH/24h-change/mcap) for LISTED coins with the
// GeckoTerminal onchain data (liquidity, # live markets, DEXs) for everything. Powers the live
// market header on the holder tools (Snapshot/Holders/Trace). Public read; 2-min cache.
app.get("/api/token-overview", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=120");
  const mint = String(req.query.mint || "").trim();
  if (!mint || mint.length < 32) return res.status(400).json({ success: false, error: "pass ?mint=<mint>" });
  try {
    const onchain = await fetchGeckoTerminalFallback(mint).catch(() => null);
    let cg = null;
    const id = await lpScanner.coingeckoIdForMint(mint).catch(() => null);
    if (id) {
      try {
        const c = await lpScanner.cgPro(`/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`);
        const m = c.market_data || {};
        cg = {
          coinId: id, symbol: (c.symbol || "").toUpperCase() || null, name: c.name || null,
          rank: c.market_cap_rank ?? null,
          priceUsd: m.current_price?.usd ?? null, marketCapUsd: m.market_cap?.usd ?? null,
          volume24hUsd: m.total_volume?.usd ?? null, change24hPct: m.price_change_percentage_24h ?? null,
          athUsd: m.ath?.usd ?? null, athChangePct: m.ath_change_percentage?.usd ?? null, athDate: m.ath_date?.usd ?? null,
          image: c.image?.small || c.image?.thumb || null,
        };
      } catch (_) { /* listed but detail fetch failed → onchain only */ }
    }
    if (!onchain && !cg) return res.status(200).json({ success: false, error: "no market data for this token yet" });
    const listed = !!cg;
    return res.status(200).json({
      success: true, mint, listed,
      symbol: (cg && cg.symbol) || onchain?.symbol || null,
      name: (cg && cg.name) || onchain?.name || null,
      image: cg?.image || null,
      // Prefer aggregated price/volume where listed (authoritative), else onchain.
      priceUsd: (cg && cg.priceUsd != null ? cg.priceUsd : onchain?.priceUsd) ?? null,
      change24hPct: cg?.change24hPct ?? null,
      volume24hUsd: (cg && cg.volume24hUsd != null ? cg.volume24hUsd : onchain?.totalVol24h) ?? null,
      liquidityUsd: onchain?.totalLiqUsd ?? null,           // liquidity is onchain-only
      fdvUsd: onchain?.fdv ?? null,
      marketCapUsd: cg?.marketCapUsd ?? null,
      marketCapRank: cg?.rank ?? null,
      athUsd: cg?.athUsd ?? null, athChangePct: cg?.athChangePct ?? null,
      marketCount: onchain?.poolCount ?? null,
      dexes: onchain ? [...onchain.dexFamilies] : [],
      source: listed ? "coingecko+onchain" : "onchain",
    });
  } catch (e) { return res.status(200).json({ success: false, error: publicErrMsg(e) }); }
});

// LP Scanner single-token mode — ?token=<symbol|mint>, optional &amount=<usd>. Returns EVERY
// pair/pool this token trades in across all Solana DEXs with volume + real fee yield. Public.
app.get("/api/lp-token", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const T = req.query.token || req.query.t;
  if (!T) return res.status(400).json({ success: false, error: "pass ?token=<symbol|mint>, optional &amount=<usd>" });
  const amountUsd = Number(req.query.amount) || 0;
  try { return res.status(200).json({ success: true, ...(await lpScanner.scanToken(String(T), { amountUsd })) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// LP Scanner pool deep-dive + range/earnings simulator — ?pool=<address>, optional
// &amount=<usd>&width=<halfWidthPct>. Models the concentrated-liquidity tradeoff against
// the pool's real 7d volatility. Public read. Informational only, NOT financial advice.
app.get("/api/lp-pool", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const pool = req.query.pool || req.query.address;
  if (!pool) return res.status(400).json({ success: false, error: "pass ?pool=<address>, optional &amount=<usd>&width=<halfWidthPct>" });
  const amountUsd = Number(req.query.amount) || 0;
  const halfWidthPct = req.query.width != null ? Number(req.query.width) : null;
  try { return res.status(200).json({ success: true, ...(await lpScanner.poolDeepDive(String(pool), { amountUsd, halfWidthPct })) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// Ask Cluck about pools — pool-aware AI. Scans the pair LIVE, then has Cluck analyze the
// REAL numbers (grounded, not generic). Informational only; turnover≠yield; IL flagged.
app.post("/api/lp-ask", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { question, a, b, amount } = req.body || {};
  if (!question || String(question).trim().length < 3) return res.status(400).json({ success: false, error: "Question too short" });
  if (String(question).length > 1000) return res.status(400).json({ success: false, error: "Question too long" });
  if (!a || !b) return res.status(400).json({ success: false, error: "Provide the pair (a and b)" });
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ success: false, error: "AI not configured" });
  try {
    const scan = await lpScanner.scanPair(String(a), String(b), { amountUsd: Number(amount) || 0 });
    const ctx = (scan.pools || []).map((p) => {
      const base = `${p.dex} — TVL $${p.tvlUsd.toLocaleString()}, 24h vol $${Math.round(p.volume.h24).toLocaleString()}, turnover ${p.turnover24h}x`;
      if (p.feeTier == null) return `${base}, fee tier NOT YET READ (don't estimate its yield)`;
      return `${base}, fee ${p.feeTier}%, 24h-yield ${p.feeYieldPctDay}%/day`
        + (p.feeYield7dPctDay != null ? `, 7d-avg-yield ${p.feeYield7dPctDay}%/day` : "")
        + (p.volTrend ? `, volume ${p.volTrend} vs 7d-avg` : "")
        + (p.estDailyUsd != null ? `, est $${p.estDailyUsd}/day on $${scan.amountUsd}` : "");
    }).join("\n");
    const system = `You are Cluck Norris — the toughest LP professor on Solana — analyzing REAL pool data so a user can compare where to LP ${scan.pair}.
HARD RULES:
- INFORMATIONAL ONLY. NEVER tell them where to put money, never predict prices. Explain tradeoffs; THEY decide.
- Ground every claim in the DATA below. If a pool's fee tier isn't read yet, say so — never invent a yield.
- Turnover (vol/TVL) is NOT yield. A high-turnover pool with a tiny fee earns little. Fee-yield (fees/TVL) is the money metric — teach that.
- Lead with the 7d-avg yield (the truer rate), not the 1-day number. If a pool's volume is "spiking", warn its 24h yield probably won't hold; if "cooling", flag that it's slowing down.
- Impermanent loss: a stable quote (USDC/USDT) = lower IL; two volatile assets = higher IL. Flag it.
- Earnings estimates use a TVL-share model calibrated to a real autonomous LP we operate — call them estimates, not guarantees.
- Tough, punchy, a chicken pun or two. 4–7 sentences. Always end with: not financial advice.

IL RISK (${scan.pair}): ${scan.ilRisk.level} — ${scan.ilRisk.note}

LIVE POOL DATA — ${scan.pair}${scan.amountUsd ? ` (user deposit $${scan.amountUsd.toLocaleString()})` : ""}:
${ctx || "(no pools found for this pair)"}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 600, system, messages: [{ role: "user", content: String(question) }] }),
    });
    const data = await r.json();
    if (data && data.content && data.content[0]) {
      const answer = data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/#{1,3}\s/g, "").trim();
      return res.status(200).json({ success: true, pair: scan.pair, answer, pools: scan.pools });
    }
    return res.status(500).json({ success: false, error: (data && data.error && data.error.message) || "No response from AI" });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// ── CLUCK'S DAILY ALPHA — a Solana market brief in Cluck's voice, full-stack ───────────
// Fuses CoinGecko aggregated (majors, trending, gainers/losers) + GeckoTerminal onchain
// (hottest + newest Solana pools) + our own LP engine (real fee-yield picks), then has Cluck
// synthesize a punchy, educational daily brief. Cached ~daily; posted to TG + X by the
// scheduler. Informational only — NOT financial advice.
const ALPHA_TTL = 20 * 3600 * 1000;
// A coin's X/Twitter handle from CoinGecko (links.twitter_screen_name), cached. Used to TAG
// trending tokens in the X post for engagement. Returns "handle" (no @) or null.
const _twHandleCache = new Map();
async function coinTwitter(coinId) {
  if (!coinId) return null;
  if (_twHandleCache.has(coinId)) return _twHandleCache.get(coinId);
  let h = null;
  try {
    const c = await lpScanner.cgPro(`/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
    const t = c && c.links && c.links.twitter_screen_name;
    if (t && /^[A-Za-z0-9_]{1,15}$/.test(t)) h = t; // valid X handle shape only
  } catch (_) {}
  _twHandleCache.set(coinId, h);
  return h;
}
async function gatherAlphaData() {
  const d = { majors: [], trending: [], gainers: [], losers: [], hotPools: [], newPools: [], lpPicks: [] };
  try {
    const p = await lpScanner.cgPro("/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true");
    d.majors = [["BTC", "bitcoin"], ["ETH", "ethereum"], ["SOL", "solana"]]
      .map(([sym, id]) => ({ sym, price: p[id] && p[id].usd, chg: p[id] && p[id].usd_24h_change })).filter((m) => m.price != null);
  } catch (_) {}
  try {
    const t = await lpScanner.cgPro("/search/trending");
    d.trending = (t.coins || []).slice(0, 7).map((c) => ({ id: c.item.id, sym: (c.item.symbol || "").toUpperCase(), name: c.item.name, rank: c.item.market_cap_rank, chg: c.item.data && c.item.data.price_change_percentage_24h && c.item.data.price_change_percentage_24h.usd }));
    // Pull X handles for the top trending coins so the X post can TAG them (engagement bait —
    // the projects often see the mention and engage). One light /coins/{id} call each, cached.
    await Promise.all(d.trending.slice(0, 5).map(async (c) => { c.handle = await coinTwitter(c.id); }));
  } catch (_) {}
  try {
    const g = await lpScanner.cgPro("/coins/top_gainers_losers?vs_currency=usd&duration=24h");
    d.gainers = (g.top_gainers || []).slice(0, 5).map((c) => ({ sym: (c.symbol || "").toUpperCase(), chg: c.usd_24h_change, price: c.usd }));
    d.losers = (g.top_losers || []).slice(0, 5).map((c) => ({ sym: (c.symbol || "").toUpperCase(), chg: c.usd_24h_change, price: c.usd }));
  } catch (_) {}
  try {
    const tp = await lpScanner.topPools({ kind: "trending" });
    d.hotPools = (tp.pools || []).slice(0, 6).map((p) => ({ pair: p.pair, dex: p.dex, vol: (p.volume && p.volume.h24) || 0, yieldPct: p.feeYield7dPctDay != null ? p.feeYield7dPctDay : p.feeYieldPctDay, risk: p.ilRisk && p.ilRisk.level }));
  } catch (_) {}
  try {
    const np = await lpScanner.cgFetch("/networks/solana/new_pools");
    d.newPools = (np.data || []).map((p) => { const a = p.attributes || {}; return { name: a.name, vol: Number((a.volume_usd || {}).h24) || 0, liq: Number(a.reserve_in_usd) || 0, ageH: a.pool_created_at ? Math.round((Date.now() - new Date(a.pool_created_at).getTime()) / 3600000) : null }; })
      .filter((p) => p.vol > 5000).sort((a, b) => b.vol - a.vol).slice(0, 5);
  } catch (_) {}
  try {
    const bc = await lpScanner.topPools({ kind: "bluechip" });
    d.lpPicks = (bc.pools || []).slice(0, 4).map((p) => ({ pair: p.pair, dex: p.dex, yieldPct: p.feeYield7dPctDay != null ? p.feeYield7dPctDay : p.feeYieldPctDay }));
  } catch (_) {}
  return d;
}
function alphaDataSummary(d) {
  const pct = (n) => n == null ? "?" : (n >= 0 ? "+" : "") + Number(n).toFixed(1) + "%";
  const lines = [];
  if (d.majors.length) lines.push("MAJORS: " + d.majors.map((m) => `${m.sym} $${Number(m.price).toLocaleString()} (${pct(m.chg)})`).join(", "));
  if (d.trending.length) lines.push("TRENDING (CoinGecko): " + d.trending.map((t) => `${t.sym}${t.chg != null ? " " + pct(t.chg) : ""}`).join(", "));
  if (d.gainers.length) lines.push("TOP 24h GAINERS: " + d.gainers.map((g) => `${g.sym} ${pct(g.chg)}`).join(", "));
  if (d.losers.length) lines.push("TOP 24h LOSERS: " + d.losers.map((g) => `${g.sym} ${pct(g.chg)}`).join(", "));
  if (d.hotPools.length) lines.push("HOTTEST SOLANA POOLS (by volume): " + d.hotPools.map((p) => `${p.pair} on ${p.dex} ($${Math.round(p.vol / 1000)}K 24h vol${p.yieldPct != null ? ", " + p.yieldPct + "%/day fee yield" : ""}${p.risk === "high" ? ", HIGH IL risk" : ""})`).join("; "));
  if (d.newPools.length) lines.push("BRAND-NEW SOLANA POOLS: " + d.newPools.map((p) => `${p.name} ($${Math.round(p.vol / 1000)}K vol, $${Math.round(p.liq / 1000)}K liq, ${p.ageH}h old)`).join("; "));
  if (d.lpPicks.length) lines.push("BLUE-CHIP LP YIELD (our scanner, fees/TVL): " + d.lpPicks.map((p) => `${p.pair} on ${p.dex} ${p.yieldPct}%/day`).join(", "));
  return lines.join("\n");
}
async function cluckBrief(d) {
  const summary = alphaDataSummary(d);
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return `🐔 CLUCK'S DAILY ALPHA\n\n${summary}\n\nNot financial advice. Do your own research.`;
  const system = `You are Cluck Norris — the toughest crypto professor on Solana — writing your DAILY ALPHA brief for the flock. Use ONLY the real market data below (it's live from CoinGecko + on-chain DEX data + our own LP scanner).
STYLE: punchy, confident, funny, a chicken pun or two, but genuinely informative. Teach while you report. 5 short sections with emoji headers, in this order:
🌡️ THE MOOD — read the majors (BTC/ETH/SOL) in one or two lines.
🔥 WHAT'S HOT — trending coins + the standout 24h gainers; note if a gainer looks like a pump.
🌶️ FRESH OFF THE GRILL — the brand-new Solana pools; remind them new pools are high rug risk.
💧 WHERE THE FEES ARE — the hottest Solana pools and our blue-chip LP yield picks (fee yield = the real LP money metric, not volume).
🎓 CLUCK'S LESSON — one sharp educational takeaway tied to today's data.
RULES: Never tell anyone to buy/sell or predict prices. Flag risk honestly (memecoins/new pools can go to zero). No markdown asterisks or headers (#). Write tickers plain (BONK, not $BONK) — never put a $ before a ticker. Keep the whole thing under ~320 words. End with: "Not financial advice — now go do your homework. 🐔"`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1100, system, messages: [{ role: "user", content: `Here's today's live Solana market data:\n\n${summary}\n\nWrite today's Daily Alpha.` }] }),
    });
    const data = await r.json();
    if (data && data.content && data.content[0]) return data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s/gm, "").trim();
  } catch (_) {}
  return `🐔 CLUCK'S DAILY ALPHA\n\n${summary}\n\nNot financial advice — now go do your homework. 🐔`;
}
let _alphaInFlight = null;
async function buildDailyAlpha({ force = false } = {}) {
  const cached = kv.get("dailyAlpha", null);
  if (!force && cached && Date.now() - (cached.generatedAt || 0) < ALPHA_TTL) return cached;
  if (_alphaInFlight) return _alphaInFlight; // de-dupe concurrent builds
  _alphaInFlight = (async () => {
    const data = await gatherAlphaData();
    const brief = await cluckBrief(data);
    const result = { generatedAt: Date.now(), date: new Date().toISOString().slice(0, 10), data, brief };
    kv.set("dailyAlpha", result);
    return result;
  })();
  try { return await _alphaInFlight; } finally { _alphaInFlight = null; }
}

// Public read — the latest Daily Alpha (cached; builds on first cold call).
app.get("/api/alpha", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=600");
  try { return res.status(200).json({ success: true, ...(await buildDailyAlpha({ force: req.query.refresh === "1" })) }); }
  catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// Admin — force-build the brief; &post=1 fires it to Telegram (silent) + X; &xonly=1 X only;
// &markposted=1 marks today already-posted (so the daily auto-poster skips it) without sending.
app.get("/api/alpha-test", async (req, res) => {
  if (!adminAuthOK(req)) return res.status(404).json({ success: false, error: "not found" });
  const today = new Date().toISOString().slice(0, 10);
  if (req.query.markposted === "1") { kv.set("dailyAlphaPostedDate", today); return res.status(200).json({ success: true, marked: today }); }
  try {
    const a = await buildDailyAlpha({ force: true });
    const preview = buildAlphaPosts(a); // the exact TG + X text (tags included), no sending
    let posted = null;
    if (req.query.post === "1" || req.query.xonly === "1") {
      posted = await postDailyAlpha(a, { xOnly: req.query.xonly === "1" });
      // Any successful post marks today done so the daily auto-poster won't double-post.
      if ((posted.x && posted.x.ok) || posted.telegram) kv.set("dailyAlphaPostedDate", today);
    }
    return res.status(200).json({ success: true, preview, posted, ...a });
  } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
});

// ── CLUCK'S LIVE CLASSROOM — interactive, lesson-by-lesson AI teaching ─────────────────
// Professor Cluck teaches ONE real lesson at a time, Socratically (explain → ask → grade the
// student's free-text answer → correct → advance), grounded in our ACTUAL curriculum content
// (data/curriculum.json, extracted from the school's lessons). Emits [LESSON COMPLETE] once the
// student has shown they understand the lesson's core concepts (the client marks progress).
function ccFindCourse(id) { return (CURRICULUM.courses || []).find((c) => c.id === id); }
function ccFindLesson(courseId, lessonId) { const c = ccFindCourse(courseId); return c ? (c.lessons || []).find((l) => String(l.id) === String(lessonId)) : null; }

// Lightweight syllabus for the UI — courses + lessons (titles/intros), NO quiz answers shipped.
app.get("/api/curriculum", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  const courses = (CURRICULUM.courses || []).map((c) => ({
    id: c.id, title: c.title, icon: c.icon, blurb: c.blurb,
    lessons: (c.lessons || []).map((l) => ({ id: l.id, title: l.title, icon: l.icon, intro: l.intro || l.tagline || "", belt: l.belt || null, reference: !!l.reference })),
  }));
  res.status(200).json({ success: true, courses });
});

// The teacher's grounding for ONE lesson: real material (intro/concepts/prose/sections) + an
// answer key (quiz Q→answer→why) so Cluck teaches accurately and can grade comprehension.
function lessonMaterial(lesson) {
  const parts = [`LESSON: ${lesson.title}`];
  if (lesson.intro) parts.push(`Intro: ${lesson.intro}`);
  if (lesson.content) parts.push(`Material:\n${String(lesson.content).slice(0, 1800)}`);
  if (Array.isArray(lesson.concepts) && lesson.concepts.length) parts.push("Key concepts:\n" + lesson.concepts.map((c) => `• ${c.term} — ${c.def}`).join("\n"));
  if (Array.isArray(lesson.sections) && lesson.sections.length) parts.push("Sections:\n" + lesson.sections.map((s) => `▸ ${s.heading}: ${String(s.body || "").slice(0, 500)}`).join("\n"));
  const qs = [];
  (lesson.questions || []).forEach((q) => qs.push(q));
  (lesson.sections || []).forEach((s) => (s.quiz || []).forEach((q) => qs.push(q)));
  if (qs.length) parts.push("Comprehension-check answer key (use these to test + grade the student):\n" + qs.slice(0, 8).map((q, i) => `${i + 1}. ${q.q}\n   ✓ ${q.answer}\n   why: ${q.why || ""}`).join("\n"));
  if (lesson.cluckVerdict) parts.push(`Your closing verdict for this lesson: ${lesson.cluckVerdict}`);
  return parts.join("\n\n").slice(0, 4000);
}

// LIVE EXAMPLE — for market/LP lessons, pull a REAL pool or token snapshot from our data stack
// so Cluck teaches with today's actual numbers (cached sources → cheap). Empty for lessons
// where a market example doesn't fit (e.g. "What is a Wallet?").
async function classroomLiveExample(course, lesson) {
  const t = `${lesson.title || ""} ${course.id || ""} ${lesson.intro || ""}`.toLowerCase();
  try {
    if (/liquid|pool|amm|fee|lp|impermanent|concentrat|yield|slippage|price impact|bonding/.test(t)) {
      const tp = await lpScanner.topPools({ kind: "bluechip" });
      const p = (tp.pools || [])[0];
      if (p) return `\n\nLIVE EXAMPLE (a real Solana pool RIGHT NOW — weave it in to make the lesson concrete): ${p.pair} on ${p.dex} — TVL $${Math.round(p.tvlUsd).toLocaleString()}, 24h volume $${Math.round((p.volume && p.volume.h24) || 0).toLocaleString()}, fee tier ${p.feeTier}%, ~${p.feeYield7dPctDay != null ? p.feeYield7dPctDay : p.feeYieldPctDay}%/day fee yield.`;
    }
    if (/market cap|price|token|research|on-?chain|volatil|trading|alpha|stablecoin|tokenomics|solscan/.test(t)) {
      const ov = await fetch(`http://localhost:${PORT}/api/token-overview?mint=So11111111111111111111111111111111111111112`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
      if (ov && ov.success) return `\n\nLIVE EXAMPLE (real, right now — use it to make the lesson concrete): SOL is $${ov.priceUsd}${ov.change24hPct != null ? `, ${ov.change24hPct.toFixed(1)}% 24h` : ""}${ov.marketCapRank ? `, market-cap rank #${ov.marketCapRank}` : ""}${ov.marketCapUsd ? `, ~$${(ov.marketCapUsd / 1e9).toFixed(0)}B market cap` : ""}.`;
    }
  } catch (_) {}
  return "";
}

app.post("/api/classroom", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { courseId, lessonId, message, history } = req.body || {};
  const course = ccFindCourse(courseId), lesson = ccFindLesson(courseId, lessonId);
  if (!course || !lesson) return res.status(400).json({ success: false, error: "pick a lesson" });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ success: false, error: "Classroom is offline (AI not configured)" });
  const msg = String(message || "").slice(0, 800);
  const hist = Array.isArray(history) ? history.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) })) : [];
  const opened = hist.length > 0;
  // Live data is a nice-to-have — NEVER let it block the lesson open. If it's not ready fast
  // (e.g. a cold topPools cache doing on-chain reads), skip it; the lesson still teaches.
  const live = await Promise.race([
    classroomLiveExample(course, lesson).catch(() => ""),
    new Promise((r) => setTimeout(() => r(""), 3500)),
  ]);
  const system = `You are Professor Cluck Norris — the toughest, funniest crypto professor on Solana — teaching ONE live lesson in the "${course.title}" course.

THE LESSON MATERIAL (your source of truth — teach ONLY this, accurately):
${lessonMaterial(lesson)}${live}

HOW YOU TEACH (a back-and-forth, NOT a lecture dump):
- Teach this lesson's concepts ONE at a time. Explain simply with a vivid analogy (chicken/farm puns welcome), then ASK the student a question and STOP. Wait.
- When they answer, GRADE it out loud — "✅ Nailed it" / "🟡 Close" / "❌ Not quite" — then correct/clarify briefly from the material, and move on.
- Adapt to their level. If they ask a question, ask for another example, say they're confused, or ask you to slow down — happily oblige: re-explain a DIFFERENT way (new analogy), never make them feel dumb, then steer back to the lesson.
- If the student says they're NOT SURE / don't know the answer — do NOT mark it wrong and do NOT move on. Warmly teach the answer clearly (with the explanation + a simple example), THEN ask a fresh, slightly easier check question on the SAME concept so they can get it. Learning, not gotchas.
- Keep EVERY reply SHORT (2–5 sentences), ending with a question or "ready for the next one?".
- Cover the lesson's key concepts (usually 3–6), then give a 1–2 line recap. When the student has shown they understand the CORE of this lesson, end that final message with the exact tag [LESSON COMPLETE] on its own line.
RULES: Never give financial advice or price predictions. Encouraging but blunt. No markdown headers/asterisks (the [LESSON COMPLETE] tag is the only bracketed text allowed).${opened ? "" : "\nThis is the FIRST message — welcome them to the lesson in 1 line, teach the first concept, and ask your first question."}`;
  try {
    const messages = [...hist];
    messages.push({ role: "user", content: opened ? (msg || "(continue)") : "Start the lesson, professor." });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 700, system, messages }),
    });
    const data = await r.json();
    if (data && data.content && data.content[0]) {
      let reply = data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s/gm, "").trim();
      const complete = /\[LESSON COMPLETE\]/i.test(reply);
      reply = reply.replace(/\[LESSON COMPLETE\]/ig, "").trim();
      return res.status(200).json({ success: true, reply, complete });
    }
    return res.status(500).json({ success: false, error: (data && data.error && data.error.message) || "Professor Cluck is hoarse — try again." });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// ── Classroom graduate reward claim ────────────────────────────────────────────────────
// A graduate who PASSED a course final (single-use server-issued token) submits a wallet +
// social proof (X post tagging us, or a Telegram post — owner's call). Recorded to a review
// queue; the OWNER verifies the social proof and batch-airdrops CLKN via the Airdropper. One
// reward per wallet. No auto-spend — keeps the money owner-controlled and Sybil-reviewable.
const GRAD_TOKEN_TTL = 24 * 3600 * 1000;
// Normalize an X/Telegram link or handle to a single dedupe key, so the Sybil unit is the
// SOCIAL ACCOUNT (hard to mass-create) not the wallet (free). x.com/<user>/status/…, t.me/<user>,
// or a bare @handle all collapse to one key. Falls back to the raw string if unparseable.
function socialHandleKey(s) {
  s = String(s || "").trim().toLowerCase();
  let m = s.match(/(?:x\.com|twitter\.com)\/([a-z0-9_]{1,15})(?:[\/?#]|$)/);
  if (m && m[1] !== "i" && m[1] !== "home") return "x:" + m[1];
  m = s.match(/(?:t\.me|telegram\.me)\/([a-z0-9_]{3,32})/);
  if (m) return "tg:" + m[1];
  m = s.match(/^@?([a-z0-9_]{2,32})$/);
  if (m) return "h:" + m[1];
  return "raw:" + s.replace(/\s+/g, "").slice(0, 60);
}
app.post("/api/classroom/graduate-claim", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const { courseId, token, wallet, social } = req.body || {};
  const w = String(wallet || "").trim();
  if (!SOL_ADDR_RE.test(w)) return res.status(400).json({ success: false, error: "Enter a valid Solana wallet address" });
  const soc = String(social || "").trim().slice(0, 300);
  if (soc.length < 5) return res.status(400).json({ success: false, error: "Paste your X or Telegram post link / handle so we can verify" });
  const hk = socialHandleKey(soc);
  // Verify the single-use graduation token is valid (don't consume until checks pass).
  const toks = kv.get("classroomGradTokens", {}) || {};
  const t = token && toks[String(token)];
  if (!t || t.courseId !== courseId || (Date.now() - (t.ts || 0)) > GRAD_TOKEN_TTL) {
    return res.status(400).json({ success: false, error: "Graduation not verified — pass the course final first (or it expired; retake the final)." });
  }
  const grads = kv.get("classroomGraduates", {}) || {};
  if (grads[w]) return res.status(200).json({ success: true, already: true, message: "This wallet already claimed a graduate reward — one per wallet. You're on the list." });
  // One reward per SOCIAL ACCOUNT (the real anti-Sybil gate).
  const handles = kv.get("classroomGradHandles", {}) || {};
  if (handles[hk] && handles[hk] !== w) {
    return res.status(200).json({ success: false, error: "That social account already claimed a graduate reward — one reward per X/Telegram account." });
  }
  delete toks[String(token)]; kv.set("classroomGradTokens", toks); // consume (single-use)
  handles[hk] = w; kv.set("classroomGradHandles", handles);
  const course = ccFindCourse(courseId);
  grads[w] = { wallet: w, courseId, courseTitle: course ? course.title : courseId, social: soc, handleKey: hk, ts: Date.now(), status: "pending" };
  kv.set("classroomGraduates", grads);
  return res.status(200).json({ success: true, message: "🎓 Claim received! You're on the graduate list. We verify the social post, then send your CLKN reward. Welcome to the flock." });
});

// Admin — review/manage the graduate reward queue. ?action=approve|paid|reject&wallet=… to set status;
// no action = list. Approved/paid wallets are what you batch into the Airdropper.
app.get("/api/classroom/graduates", (req, res) => {
  if (!adminAuthOK(req)) return res.status(404).json({ success: false, error: "not found" });
  const grads = kv.get("classroomGraduates", {}) || {};
  const action = req.query.action, w = String(req.query.wallet || "").trim();
  if (action && w && grads[w]) {
    if (action === "reject") {
      const hk = grads[w].handleKey;
      delete grads[w];
      if (hk) { const handles = kv.get("classroomGradHandles", {}) || {}; if (handles[hk] === w) { delete handles[hk]; kv.set("classroomGradHandles", handles); } }
    } else if (["approve", "paid", "pending"].includes(action)) grads[w].status = action;
    kv.set("classroomGraduates", grads);
  }
  const list = Object.values(grads).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return res.status(200).json({ success: true, count: list.length, byStatus: list.reduce((m, g) => { m[g.status] = (m[g.status] || 0) + 1; return m; }, {}), graduates: list });
});

// Course FINAL EXAM — Cluck administers a graded 6-question final from the whole course's
// material. Pass = Course Graduate. Emits [EXAM PASSED] / [EXAM FAILED] on the final message.
function courseExamPool(course) {
  const qs = [];
  for (const l of (course.lessons || [])) {
    (l.questions || []).forEach((q) => { if (q && q.q && q.answer) qs.push(q); });
    (l.sections || []).forEach((s) => (s.quiz || []).forEach((q) => { if (q && q.q && q.answer) qs.push(q); }));
  }
  return qs.slice(0, 16).map((q, i) => `${i + 1}. ${q.q}\n   ✓ ${q.answer}\n   why: ${q.why || ""}`).join("\n");
}
app.post("/api/classroom-exam", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { courseId, message, history } = req.body || {};
  const course = ccFindCourse(courseId);
  if (!course) return res.status(400).json({ success: false, error: "pick a course" });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ success: false, error: "Exam hall is offline (AI not configured)" });
  const pool = courseExamPool(course);
  if (!pool) return res.status(400).json({ success: false, error: "this course has no exam questions" });
  const msg = String(message || "").slice(0, 800);
  const hist = Array.isArray(history) ? history.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-16).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) })) : [];
  const opened = hist.length > 0;
  const system = `You are Professor Cluck Norris administering the FINAL EXAM for the "${course.title}" course. This is a graded test — be fair but rigorous (a little less hand-holding than class).

THE EXAM QUESTION BANK (your source of truth + answer key):
${pool}

HOW THE EXAM RUNS:
- Administer a SIX-question final. Ask ONE question at a time (you may lightly reword for plain English), then STOP and wait for the student's answer.
- Grade each answer out loud: "✅ Correct" / "🟡 Partial" / "❌ Incorrect" + one short line of why. Count ✅ as 1 point, 🟡 as 0.5.
- Track the question number ("Question 3 of 6"). Use the conversation so far to know how many you've already asked.
- This is a TEST: don't teach the answer before they try, and don't give hints. (If they say they don't know, mark it and move on.)
- After the 6th answer, give the final score as X/6 and a verdict. PASS = 4/6 or better. End that final message with the tag [EXAM PASSED] or [EXAM FAILED] on its own line.
RULES: No financial advice. Encouraging but honest. No markdown headers/asterisks (the [EXAM PASSED]/[EXAM FAILED] tag is the only bracketed text).${opened ? "" : "\nThis is the FIRST message — welcome them to the final exam in one line, then ask Question 1 of 6."}`;
  try {
    const messages = [...hist];
    messages.push({ role: "user", content: opened ? (msg || "(continue)") : "Begin the final exam, professor." });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 700, system, messages }),
    });
    const data = await r.json();
    if (data && data.content && data.content[0]) {
      let reply = data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s/gm, "").trim();
      const passed = /\[EXAM PASSED\]/i.test(reply);
      const failed = /\[EXAM FAILED\]/i.test(reply);
      reply = reply.replace(/\[EXAM (PASSED|FAILED)\]/ig, "").trim();
      let gradToken = null;
      if (passed) { // issue a single-use, server-verified graduation token so a claim can't be faked
        gradToken = randomBytes(18).toString("hex");
        const toks = kv.get("classroomGradTokens", {}) || {};
        toks[gradToken] = { courseId, ts: Date.now() };
        kv.set("classroomGradTokens", toks);
      }
      return res.status(200).json({ success: true, reply, finished: passed || failed, passed, gradToken });
    }
    return res.status(500).json({ success: false, error: (data && data.error && data.error.message) || "Professor Cluck is hoarse — try again." });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// Build the Telegram + X post text for a brief (no sending). X ALWAYS tags the ecosystem
// partners (@JupiterExchange = routing artery + our earner's venue; @BagsApp = the launchpad/
// hackathon host), then tags trending tokens by their X handle (engagement — tagged projects
// often re-engage). Packs trending tags to fit 280.
function buildAlphaPosts(a) {
  const body = (a.brief || "").trim();
  const telegram = body + `\n\n🔬 Full picture + tools: clucknorris.app/alpha`;
  const tr = (a.data.trending || []).slice(0, 6);
  // Engagement tag line: ALWAYS tag the ecosystem partners (@JupiterExchange = routing artery +
  // our earner's venue; @BagsApp = launchpad/hackathon host) + trending tokens by their handle.
  const trendTags = tr.map((t) => `$${t.sym}${t.handle ? " @" + t.handle : ""}`).join("  ");
  const tagLine = `🔥 Trending: ${trendTags}\n\nvia @JupiterExchange @BagsApp · clucknorris.app/alpha · not financial advice`;
  // X is PREMIUM here → post the FULL brief (no 280 truncation). But X allows at most ONE
  // cashtag ($SYMBOL) per post, so strip "$" before LETTERS (cashtags) while keeping "$" before
  // digits (dollar amounts like $64,327). Engagement comes from the @handles, not cashtags.
  const tweet = `🐔 Cluck's Daily Alpha — Solana\n\n${body}\n\n${tagLine}`.replace(/\$([A-Za-z])/g, "$1").slice(0, 9000);
  const taggedHandles = ["@JupiterExchange", "@BagsApp", ...tr.filter((t) => t.handle).map((t) => "@" + t.handle)];
  return { telegram, tweet, taggedHandles };
}
// Post the brief to the community Telegram (SILENT per house rule) + X. opts.xOnly re-posts
// only X (e.g. after fixing an X-specific rejection without duplicating the Telegram post).
async function postDailyAlpha(a, opts = {}) {
  const p = buildAlphaPosts(a);
  const out = { tweet: p.tweet, taggedHandles: p.taggedHandles };
  if (!opts.xOnly) { try { out.telegram = await tgSend(process.env.TELEGRAM_CHAT_ID, p.telegram, null, { silent: true }); } catch (e) { out.telegramErr = e.message; } }
  try { out.x = await postToX(p.tweet); } catch (e) { out.xErr = e.message; }
  return out;
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
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
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
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    if (req.query.post === "1") { await notifyEduPost(); return res.status(200).json({ success: true, posted: true }); }
    const deck = kv.get("eduDeckV2", []); const pos = kv.get("eduDeckPosV2", 0);
    const peekIdx = (Array.isArray(deck) && deck.length === EDU_TOPICS.length && pos < deck.length) ? deck[pos] : 0;
    const topic = req.query.topic ? String(req.query.topic) : EDU_TOPICS[peekIdx];
    const slotStyle = (new Date().getUTCHours() === EDU_LONG_HOUR) ? "full" : "short";
    const style = req.query.style === "short" ? "short" : (req.query.style === "full" ? "full" : slotStyle);
    const body = await generateEduLesson(topic, style);
    return res.status(200).json({ success: true, posted: false, topic, style, preview: body });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// Treasury DAILY RECAP — token-denominated growth (assets, not dollars). Tracks how much
// each sleeve + the overall stack grew in SOL/cbBTC terms vs the prior day and vs an inception
// baseline, with an LP-vs-HODL edge (so it scores accumulation, not USD price). Private DM.
// Snapshots persist on the volume so deltas survive deploys. send=false → preview only (no DM,
// no snapshot write), so a dry-run can't disturb the baseline.
async function sendTreasuryRecap({ send = true, reset = false } = {}) {
  const tgtok = process.env.TELEGRAM_BOT_TOKEN;
  const proj = whirlpoolMM.vault.getProject("treasury");
  if (!proj || !proj.telegramChatId) return { skipped: "no treasury chat" };
  const st = await whirlpoolMM.vault.status("treasury");
  if (!st || !st.enabled) return { skipped: "treasury not enabled" };
  const pos = await whirlpoolMM.vault.publicPositions("treasury").catch(() => null);
  const f = st.float || {}, earn = st.earnings || {}, px = earn.prices || {};
  const solUsd = px.solUsd || (pos && pos.solUsd) || 0;
  const baseUsd = px.clknUsd || (pos && (pos.clknUsd || pos.btcUsd)) || 0;
  if (!(baseUsd > 0)) return { skipped: "no price" };
  const sleeves = ((pos && pos.positions) || []).filter((p) => (p.valueUsd || 0) >= 1);
  let posSol = 0, posBase = 0, deployedUsd = 0;
  for (const p of sleeves) { posBase += p.clknAmount || 0; posSol += p.quoteAmount || 0; deployedUsd += p.valueUsd || 0; }
  // Fold in Meteora DLMM positions — same treasury wallet, different venue (the Orca
  // engine is blind to them), so count them explicitly or the recap misses the bulk of the stack.
  let metFeesUsd = 0, metFeeTok = { cbbtc: 0, sol: 0 }; const metPositions = [];
  try {
    const m = await meteora.status({ solUsd, btcUsd: baseUsd });
    metFeesUsd = m.lifetimeFeeUsd || 0; // pending + claimed + closed-position ledger
    metFeeTok = m.lifetimeFeeTokens || metFeeTok; // token-denominated, for a price-immune 24h delta
    for (const p of (m.positions || [])) {
      const xIsBtc = p.symX === "cbBTC";
      posBase += xIsBtc ? (p.amountX || 0) : (p.amountY || 0);
      posSol += xIsBtc ? (p.amountY || 0) : (p.amountX || 0);
      deployedUsd += p.valueUsd || 0;
      metPositions.push({ valueUsd: p.valueUsd || 0, inRange: p.inRange, lowerPrice: p.lowerPrice, upperPrice: p.upperPrice });
    }
  } catch (_) { /* meteora read best-effort — don't break the recap if it's down */ }
  const totalSol = posSol + (f.sol || 0);
  const totalBase = posBase + (f.clkn || 0);
  const valueUsd = deployedUsd + (f.sol || 0) * solUsd + (f.clkn || 0) * baseUsd + (f.usdc || 0);
  const valueBtc = valueUsd / baseUsd;
  const feesUsd = (earn.totalEarnedUsd != null ? earn.totalEarnedUsd : 0) + metFeesUsd;
  const snap = {
    ts: Date.now(), solUsd, baseUsd, valueUsd, valueBtc, totalSol, totalBase, feesUsd, feeTok: metFeeTok,
    positions: sleeves.map((p) => ({ role: p.role, valueUsd: p.valueUsd || 0, valueBtc: (p.valueUsd || 0) / baseUsd })),
  };
  const storeKey = "treasuryRecapSnaps";
  // reset=true wipes the prior baseline/prev so a fresh starting line is set here — used after
  // a migration/restructuring (e.g. moving to Meteora) so deltas track fees, not the churn.
  const store = reset ? {} : (kv.get(storeKey, {}) || {});
  const prev = store.prev || null;
  const baseline = store.baseline || snap;

  const pct = (now, was) => (was > 0 ? (now - was) / was * 100 : 0);
  const sg = (x, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);
  const btc = (v) => "Ƀ" + v.toFixed(6);
  const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const roleName = { tight: "Concentrated", wide: "Wide backbone", base: "Idle range" };

  const L = [];
  L.push(`📈 <b>Treasury Daily Recap</b> — cbBTC/SOL`);
  L.push(`<i>asset growth (BTC + SOL), not USD</i>`);
  L.push(``);
  L.push(`<b>Positions</b>${prev ? " (24h)" : ""}`);
  for (const p of sleeves) {
    const was = prev && prev.positions.find((x) => x.role === p.role);
    const d = was ? ` · ${sg(pct((p.valueUsd || 0) / baseUsd, was.valueBtc))}%` : "";
    L.push(`• ${roleName[p.role] || p.role}: ${btc((p.valueUsd || 0) / baseUsd)} (${usd(p.valueUsd || 0)})${d}`);
  }
  for (const mp of metPositions) {
    const rng = (mp.lowerPrice && mp.upperPrice) ? ` ${mp.lowerPrice.toFixed(0)}–${mp.upperPrice.toFixed(0)}` : "";
    L.push(`• Meteora${rng}: ${btc(mp.valueUsd / baseUsd)} (${usd(mp.valueUsd)}) ${mp.inRange ? "✓ in range" : "⚠️ OUT of range"}`);
  }
  L.push(``);
  L.push(`<b>Assets held</b>`);
  L.push(`SOL    ${totalSol.toFixed(3)}${prev ? `  (${sg(totalSol - prev.totalSol, 3)} · ${sg(pct(totalSol, prev.totalSol))}%)` : ""}`);
  L.push(`cbBTC  ${totalBase.toFixed(6)}${prev ? `  (${sg(totalBase - prev.totalBase, 6)} · ${sg(pct(totalBase, prev.totalBase))}%)` : ""}`);
  L.push(`Stack  ${btc(valueBtc)} (${usd(valueUsd)})${prev ? `  ${sg(pct(valueBtc, prev.valueBtc))}% / 24h` : ""}`);
  L.push(``);
  // 24h fee delta from TOKEN amounts (price-immune): diff fee tokens, value at today's price.
  const feeDelta = (prev && prev.feeTok)
    ? (metFeeTok.cbbtc - prev.feeTok.cbbtc) * baseUsd + (metFeeTok.sol - prev.feeTok.sol) * solUsd
    : feesUsd;
  L.push(`<b>Fees</b> ${prev ? `${sg(feeDelta)} (24h, in-kind)` : `${usd(feesUsd)} to date`} · compounding`);
  if (baseline && baseline.ts !== snap.ts) {
    const days = Math.max(1 / 24, (snap.ts - baseline.ts) / 86400000);
    const lpPct = pct(valueBtc, baseline.valueBtc);
    const hodlNowBtc = baseline.totalBase + baseline.totalSol * (solUsd / baseUsd);
    const hodlPct = pct(hodlNowBtc, baseline.valueBtc);
    L.push(`<b>Since start</b> (${days.toFixed(1)}d): ${sg(lpPct)}% in BTC (${sg(lpPct / days)}%/day)`);
    L.push(`vs holding the basket ${sg(hodlPct)}% → <b>LP edge ${sg(lpPct - hodlPct)}%</b>`);
  } else {
    L.push(`<i>Baseline set — daily growth deltas begin next recap.</i>`);
  }
  L.push(`<i>Goal: +0.50%/day in assets</i>`);
  const text = L.join("\n");

  if (!send) return { sent: false, preview: text, valueBtc, valueUsd };
  if (tgtok) {
    await fetch(`https://api.telegram.org/bot${tgtok}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: proj.telegramChatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  }
  kv.set(storeKey, { baseline, prev: snap, history: [...((store.history) || []).slice(-29), { ts: snap.ts, valueBtc, totalSol, totalBase, feesUsd }] });
  return { sent: !!tgtok, text, valueBtc, valueUsd };
}

// Treasury daily recap — preview (gated). Default returns the composed recap WITHOUT sending
// or writing a snapshot; &send=1 actually DMs it (and records the snapshot/baseline).
app.get("/api/treasury-recap-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try { return res.status(200).json(await sendTreasuryRecap({ send: req.query.send === "1", reset: req.query.reset === "1" })); }
  catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});
// JUP/USDC private recap — preview by default; &send=1 DMs it; &reset=1 rebaselines the delta.
app.get("/api/jup-recap-test", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try { return res.status(200).json(await sendJupUsdcRecap({ send: req.query.send === "1", reset: req.query.reset === "1", rebaselineClaimedUsd: req.query.rebaselineClaimed != null ? Number(req.query.rebaselineClaimed) : null })); }
  catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Pool Monitor — live close-watch of the JUP/USDC earner (gated). Position + fee pace + peak
// $/min & $/hr bursts (from poolMonitorTick) + live pool volume + edge proximity, so the owner
// can watch closely and adjust. Powers the /pool-monitor dashboard.
app.get("/api/pool-monitor", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ success: false, error: "not found" });
  try {
    let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
    const m = await meteora.status({ jupUsd });
    const pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && (p.valueUsd || 0) >= 1) || null;
    const L = jupUsdcLedger();
    const mon = kv.get("poolMonitor", {}) || {};
    const samples = (mon.samples || []);
    let recentRatePerMin = null, last1hUsd = null, paceWindowMin = null;
    if (samples.length >= 2) {
      const b = samples[samples.length - 1];
      // PACE over a trailing 30-min window. A single 2-min sample-to-sample delta is far too
      // noisy: fees don't accrue every sample, so the rate read ~$0/day almost constantly.
      // Fall back to the widest window available if <30 min of samples exist yet.
      let pw = samples.filter((s) => s.ts >= b.ts - 30 * 60000);
      if (pw.length < 2) pw = samples.slice(-2);
      const dMin = (pw[pw.length - 1].ts - pw[0].ts) / 60000;
      if (dMin > 0) { recentRatePerMin = Number(((pw[pw.length - 1].lifetimeUsd - pw[0].lifetimeUsd) / dMin).toFixed(3)); paceWindowMin = Math.round(dMin); }
      const win = samples.filter((s) => s.ts >= b.ts - 3600000); if (win.length >= 2) last1hUsd = Number((win[win.length - 1].lifetimeUsd - win[0].lifetimeUsd).toFixed(2));
    }
    let pool = {};
    try { const j = await lpScanner.cgFetch(`/networks/solana/pools/${JUPUSDC_POOL}`); const a = (j.data || {}).attributes || {}; const v = a.volume_usd || {}; pool = { tvlUsd: Math.round(+a.reserve_in_usd || 0), volH1: Math.round(+v.h1 || 0), volH24: Math.round(+v.h24 || 0) }; } catch (_) {}
    let position = null;
    if (pos) {
      const span = pos.upperBinId - pos.lowerBinId, frac = span > 0 ? (pos.activeBinId - pos.lowerBinId) / span : 0.5;
      const jupUsdVal = (pos.amountX || 0) * pos.currentPrice, tot = jupUsdVal + (pos.amountY || 0);
      position = { valueUsd: pos.valueUsd, inRange: pos.inRange, price: pos.currentPrice, lower: pos.lowerPrice, upper: pos.upperPrice, claimableUsd: Number((pos.pendingFeeUsd || 0).toFixed(2)), jupPct: tot > 0 ? Math.round(jupUsdVal / tot * 100) : null, edgePct: Math.round(Math.min(frac, 1 - frac) * 100), frac: Number(frac.toFixed(3)) };
    }
    const lifetimeUsd = pos ? Number(((L.bankedClaimedUsd || 0) + (pos.claimedFeeUsd || 0) + (pos.pendingFeeUsd || 0)).toFixed(2)) : (mon.lastLifetimeUsd != null ? Number(mon.lastLifetimeUsd.toFixed(2)) : null);
    // LP-vs-HODL (read-only): fees net of impermanent loss + swap cost. Baseline backfilled by
    // the recap / poolMonitorTick; null until it's set. rebalanceCostUsd = real swap impact captured per recenter.
    const lpVsHodl = pos ? jupLpVsHodl(L, pos.valueUsd || 0, pos.pendingFeeUsd || 0, jupUsd) : null;
    return res.status(200).json({
      success: true, position, pool, lpVsHodl,
      fees: {
        lifetimeUsd, claimableUsd: position ? position.claimableUsd : null,
        recentRatePerMin, recentRatePerDay: recentRatePerMin != null ? Number((recentRatePerMin * 1440).toFixed(0)) : null, paceWindowMin,
        last1hUsd, peakPerMinUsd: mon.peakPerMinUsd || 0, peakPerMinAt: mon.peakPerMinAt || null,
        peakPerHourUsd: mon.peakPerHourUsd || 0, peakPerHourAt: mon.peakPerHourAt || null,
        rebalances: L.recenters || 0, rebalanceCostUsd: Number((L.rebalanceCostUsd || 0).toFixed(2)),
      },
      samples: samples.slice(-90), updatedAt: mon.lastTs || null,
    });
  } catch (e) { return res.status(200).json({ success: false, error: publicErrMsg(e) }); }
});

// Meteora DLMM positions — read-only status (gated). Lists the treasury wallet's
// Meteora positions (range, amounts, pending fees, in-range) so the cbBTC/SOL
// position on Meteora can be tracked alongside the Orca vault. Values use the
// treasury vault's current SOL/cbBTC prices.
app.get("/api/meteora/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    let solUsd = 0, btcUsd = 0, jupUsd = 0;
    try { const st = await whirlpoolMM.vault.status("treasury"); const px = (st.earnings || {}).prices || {}; solUsd = px.solUsd || 0; btcUsd = px.clknUsd || 0; } catch (_) {}
    try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
    return res.status(200).json(await meteora.status({ solUsd, btcUsd, jupUsd }));
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora DLMM — pull liquidity (gated). ?pct=0.05 withdraws 5% to the wallet (no
// close). DRY RUN unless &run=1. Optional &position=<pubkey> (defaults to the only one).
app.get("/api/meteora/remove-liquidity", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    return res.status(200).json(await meteora.removeLiquidity({ positionPubkey: req.query.position || null, pct: req.query.pct, close: req.query.close === "1", dryRun: req.query.run !== "1" }));
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora DLMM — add liquidity back (gated). ?cbbtc=&sol= amounts. DRY RUN unless &run=1.
app.get("/api/meteora/add-liquidity", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    return res.status(200).json(await meteora.addLiquidity({ positionPubkey: req.query.position || null, cbbtcUi: req.query.cbbtc, solUi: req.query.sol, dryRun: req.query.run !== "1" }));
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora DLMM — open a fresh centered position (gated). ?cbbtc=&sol=&half=0.6&dist=spot|curve|bidask
// Centers on current price, ±half%. DRY RUN unless &run=1 (dry shows bin math + #positions).
app.get("/api/meteora/open-position", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    return res.status(200).json(await meteora.openPosition({
      cbbtcUi: req.query.cbbtc, solUi: req.query.sol,
      // Non-cbBTC/SOL pools: &pool=<address> + &x=/&y= per-side amounts in the
      // pool's own tokenX/tokenY order (x/y take precedence over cbbtc/sol).
      ...(req.query.pool ? { poolAddress: String(req.query.pool) } : {}),
      ...(req.query.x != null ? { xUi: Number(req.query.x) } : {}),
      ...(req.query.y != null ? { yUi: Number(req.query.y) } : {}),
      halfWidthPct: req.query.half != null ? Number(req.query.half) : 0.6,
      distribution: req.query.dist || "spot", dryRun: req.query.run !== "1",
    }));
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora DLMM — unwrap stranded wSOL back to native lamports (gated). Closes/swaps can
// leave the operator's SOL wrapped, which starves position-rent payments even when the
// float looks funded. open/add now auto-unwrap, this is the manual lever. DRY unless &run=1.
app.get("/api/meteora/unwrap", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    const { connection } = require("./lib/rpc");
    return res.status(200).json(await meteora.unwrapWsol(connection(), { dryRun: req.query.run !== "1" }));
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// ── Meteora autonomous re-center ─────────────────────────────────────────────
// Closes the managed position (claim fees + rent), rebalances the freed float ~50/50,
// reopens fresh & centered at the configured width/distribution. Triggers when the
// position is OOR or past edgeFrac, with anti-thrash. Orchestrated here because it needs
// both the Meteora primitives and the treasury vault's Jupiter swap.
function meteoraDM(text) {
  try {
    const tg = process.env.TELEGRAM_BOT_TOKEN, proj = whirlpoolMM.vault.getProject("treasury");
    if (tg && proj && proj.telegramChatId) fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: proj.telegramChatId, parse_mode: "HTML", text }) }).catch(() => {});
  } catch (_) {}
}
// ── JUP/USDC earner recap → PRIVATE treasury DM (operator only, NOT community) ──
// Tracks fees made vs rebalancing spent via a persistent ledger (kv jupUsdcLedger):
//   lifetimeFeesUsd  = bankedClaimed (from past positions) + live claimed + live claimable
//   recenters / rebalanceCostUsd = position-changing recenters (close→reopen, detected
//     here by the position pubkey changing) + swaps logged by the in-place tool.
// Honest limit: a MANUAL in-place rebalance in the Meteora UI keeps the same pubkey and
// its swap cost isn't visible to us — so the cost figure is a floor + estimate, labelled.
function jupUsdcLedger() { return kv.get("jupUsdcLedger", { bankedClaimedUsd: 0, lastPubkey: null, lastClaimedUsd: 0, recenters: 0, rebalanceCostUsd: 0, baselineTs: Date.now() }); }
const EST_RECENTER_COST_USD = 1.0;   // manual/unseen recenter fallback (recap pubkey-change path): swap + tx estimate
const EST_RECENTER_TX_USD = 0.02;    // autonomous recenter: ~2 tx fees only; the REAL swap impact is added separately by jupUsdcRecenter
// Called by the in-place rebalance tool with the ACTUAL swapped USD (its swap keeps the
// same pubkey, so the recap's pubkey-change detector won't see it — log it here instead).
function jupUsdcLogRebalance(swapUsd) {
  const L = jupUsdcLedger();
  L.recenters = (L.recenters || 0) + 1;
  L.rebalanceCostUsd = (L.rebalanceCostUsd || 0) + Math.max(0.02, (Number(swapUsd) || 0) * 0.0015 + 0.02); // ~15bps swap + tx
  kv.set("jupUsdcLedger", L);
}
// Bank a CLOSED position's realized fees (claimed over its life + pending claimed at close)
// at the moment of close — durably, immediately — so fees are never lost when a recenter
// (autonomous loop OR a manual /api/meteora/recenter) destroys a position between recap runs.
// Sets lastPubkey=null so the recap's pubkey-change fallback won't ALSO bank this close (no
// double-count); the recap re-adopts the next live position cleanly. This is the real fix for
// the lifetime-fees undercount: banking used to happen only inside the 6h recap, on stale data.
function jupUsdcBankClose(closedPos) {
  const L = jupUsdcLedger();
  const realized = (Number(closedPos && closedPos.claimedFeeUsd) || 0) + (Number(closedPos && closedPos.pendingFeeUsd) || 0);
  L.bankedClaimedUsd = (L.bankedClaimedUsd || 0) + realized;
  L.recenters = (L.recenters || 0) + 1;
  L.rebalanceCostUsd = (L.rebalanceCostUsd || 0) + EST_RECENTER_TX_USD; // tx only; jupUsdcRecenter adds the real swap impact after the swap lands
  L.lastPubkey = null;        // closed; recap re-adopts the next live position without re-banking
  L.lastClaimedUsd = 0;
  kv.set("jupUsdcLedger", L);
  return realized;
}
// ── LP-vs-HODL: the only honest "are we actually winning?" number ──────────────
// Fee counters can't see impermanent loss — fees can read +$400 while the position grew
// only $150 because each recenter swaps to 50/50 at an adverse price, crystallizing IL.
// LP-vs-HODL compares the position's value now to what the BASELINE token basket
// (JUP + USDC held since baseline) would be worth now. Positive = fees beat IL; negative =
// IL (+ swap cost, already inside valueUsd) is eating the fees. Swap costs need no separate
// subtraction here — they reduce valueUsd directly, so they're already captured.
// LIMITATION: manual adds/removes aren't tracked, so re-baseline (&reset=1) after any.
function ensureJupHodlBaseline(L, pos, jupUsd) {
  if (L && L.hodlBaseJup == null && pos && jupUsd > 0) {
    L.hodlBaseJup = Number(pos.amountX || 0);   // JUP held at baseline
    L.hodlBaseUsdc = Number(pos.amountY || 0);   // USDC held at baseline
    L.hodlBaseJupUsd = jupUsd;
    L.hodlBaseTs = Date.now();
  }
  return L;
}
function jupLpVsHodl(L, valueUsd, claimableUsd, jupUsd) {
  if (!L || L.hodlBaseJup == null || !(jupUsd > 0)) return null;
  const hodlNowUsd = L.hodlBaseJup * jupUsd + (L.hodlBaseUsdc || 0); // baseline basket priced now
  const lpNowUsd = (Number(valueUsd) || 0) + (Number(claimableUsd) || 0); // position (fees compound in) + unclaimed
  return {
    hodlNowUsd: Number(hodlNowUsd.toFixed(2)), lpNowUsd: Number(lpNowUsd.toFixed(2)),
    lpVsHodlUsd: Number((lpNowUsd - hodlNowUsd).toFixed(2)), sinceTs: L.hodlBaseTs || null,
  };
}
async function sendJupUsdcRecap({ send = true, reset = false, rebaselineClaimedUsd = null } = {}) {
  if (!meteora.isEnabled()) return { skipped: "meteora not enabled" };
  let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
  const m = await meteora.status({ jupUsd });
  const pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && (p.valueUsd || 0) >= 1);
  if (!pos) return { skipped: "no JUP/USDC position" };
  const valueUsd = pos.valueUsd || 0;
  const claimableUsd = pos.pendingFeeUsd || 0;
  const claimedUsd = pos.claimedFeeUsd || 0;
  const pubkey = pos.positionPubkey || null;
  // Ledger update (skipped on a read-only preview so previews never mutate accounting).
  let L = reset ? { bankedClaimedUsd: 0, lastPubkey: pubkey, lastClaimedUsd: claimedUsd, recenters: 0, rebalanceCostUsd: 0, baselineTs: Date.now(), hodlBaseJup: Number(pos.amountX || 0), hodlBaseUsdc: Number(pos.amountY || 0), hodlBaseJupUsd: jupUsd, hodlBaseTs: Date.now() } : jupUsdcLedger();
  if (!reset) ensureJupHodlBaseline(L, pos, jupUsd);   // backfill the basket for ledgers predating LP-vs-HODL
  if (!reset && L.lastPubkey && pubkey && pubkey !== L.lastPubkey) {
    // Position changed → a close→reopen recenter happened: bank the old position's final
    // claimed fees (they vanish from the live read) and count/estimate the recenter cost.
    L.bankedClaimedUsd = (L.bankedClaimedUsd || 0) + (L.lastClaimedUsd || 0);
    L.recenters = (L.recenters || 0) + 1;
    L.rebalanceCostUsd = (L.rebalanceCostUsd || 0) + EST_RECENTER_COST_USD;
  }
  if (!reset) { L.lastPubkey = pubkey; L.lastClaimedUsd = claimedUsd; }
  // One-time re-baseline: sync banked fees to Meteora's authoritative "Fees Claimed" figure
  // (the UI number) so the lifetime counter is correct now; close-time banking keeps it
  // accurate from here. bankedClaimed + live-claimed must equal that total.
  if (rebaselineClaimedUsd != null && Number.isFinite(Number(rebaselineClaimedUsd))) {
    L.bankedClaimedUsd = Math.max(0, Number(rebaselineClaimedUsd) - claimedUsd);
    kv.set("jupUsdcLedger", L);        // persist immediately, independent of send
    kv.set("jupUsdcRecapSnap", null);  // drop the stale snapshot so the next recap's delta isn't a spurious spike
  }
  const lifetimeFeesUsd = (L.bankedClaimedUsd || 0) + claimedUsd + claimableUsd;
  const netUsd = lifetimeFeesUsd - (L.rebalanceCostUsd || 0);
  const snap = { ts: Date.now(), valueUsd, lifetimeFeesUsd };
  const prev = reset ? null : kv.get("jupUsdcRecapSnap", null);
  if (send) { kv.set("jupUsdcLedger", L); kv.set("jupUsdcRecapSnap", snap); }
  const fmtUsd = (n) => "$" + (Number(n) || 0).toFixed(2);
  const signed = (n) => (n >= 0 ? "+" : "") + fmtUsd(n);
  let deltaLine = "";
  if (prev) {
    const hrs = Math.max(0.1, (snap.ts - prev.ts) / 3600000);
    const feeDelta = lifetimeFeesUsd - (prev.lifetimeFeesUsd != null ? prev.lifetimeFeesUsd : (prev.lifetimeFeeUsd || 0));
    deltaLine = `\n📈 <b>${signed(feeDelta)}</b> fees in ${hrs.toFixed(0)}h (~${fmtUsd(feeDelta / hrs * 24)}/day)`;
  }
  const rangeStr = (pos.lowerPrice && pos.upperPrice) ? ` (${pos.lowerPrice.toPrecision(5)}–${pos.upperPrice.toPrecision(5)})` : "";
  const costLine = (L.recenters || 0) > 0
    ? `\n🔄 Rebalances: <b>${L.recenters}</b> · est. cost ${fmtUsd(L.rebalanceCostUsd)} <i>(close→reopen seen; manual UI in-place swaps not counted)</i>`
    : `\n🔄 Rebalances: 0`;
  const mon = kv.get("poolMonitor", {}) || {};
  const peakLine = (mon.peakPerHourUsd || mon.peakPerMinUsd)
    ? `\n🚀 Peak burst: <b>${fmtUsd((mon.peakPerMinUsd || 0) * 60)}/hr</b> rate (best hour ${fmtUsd(mon.peakPerHourUsd || 0)})` : "";
  // LP-vs-HODL — the real bottom line (fees net of IL + swap cost). See jupLpVsHodl.
  const lp = jupLpVsHodl(L, valueUsd, claimableUsd, jupUsd);
  const lpLine = lp
    ? `\n📊 LP vs HODL: <b>${signed(lp.lpVsHodlUsd)}</b> ${lp.lpVsHodlUsd >= 0 ? "— fees beating IL ✅" : "— IL eating fees ⚠️"}${lp.sinceTs ? ` (since ${((Date.now() - lp.sinceTs) / 3600000).toFixed(0)}h ago)` : ""}\n   <i>vs holding the baseline basket; re-baseline (&reset=1) after any manual add/remove</i>`
    : "";
  const text =
    `💰 <b>JUP/USDC earner</b> — private recap\n` +
    `💧 Liquidity: <b>${fmtUsd(valueUsd)}</b> · ${pos.inRange ? "✅ in range" : "⚠️ OUT of range"}${rangeStr}\n` +
    `🪙 Claimable now: <b>${fmtUsd(claimableUsd)}</b>\n` +
    `💵 Fees lifetime: <b>${fmtUsd(lifetimeFeesUsd)}</b>` +
    deltaLine +
    costLine +
    peakLine +
    `\n🧮 Net (fees − est. cost): <b>${signed(netUsd)}</b>` +
    lpLine +
    `\n<i>operator-only · not posted to the community</i>`;
  if (send) meteoraDM(text);
  return { sent: send, valueUsd, claimableUsd, lifetimeFeesUsd, recenters: L.recenters || 0, rebalanceCostUsd: L.rebalanceCostUsd || 0, netUsd, lpVsHodl: lp, preview: text };
}

async function meteoraRecenter({ dryRun = false, force = false } = {}) {
  if (!meteora.isEnabled()) return { action: "none", reason: "operator not set" };
  const cfg = meteora.getCfg();
  let solUsd = 0, btcUsd = 0;
  try { const st = await whirlpoolMM.vault.status("treasury"); const px = (st.earnings || {}).prices || {}; solUsd = px.solUsd || 0; btcUsd = px.clknUsd || 0; } catch (_) {}

  // A1 — recover a stranded chaser FIRST: a prior re-center may have closed but failed to
  // reopen (funds sit in the wallet). Reopen exactly the recorded freed amounts, then stop.
  const pending = kv.get("meteoraReopenPending", null);
  if (pending && pending.cbbtc != null) {
    if (dryRun) return { action: "would-retry-reopen", pending };
    const f = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
    const o = await meteora.openPosition({ cbbtcUi: Math.min(pending.cbbtc, f.clkn || 0), solUi: Math.min(pending.sol, Math.max(0, (f.sol || 0) - 0.25)), halfWidthPct: pending.halfWidthPct || cfg.halfWidthPct, distribution: pending.distribution || cfg.distribution });
    if (o.positions && o.positions[0]) kv.set("meteoraManagedPubkey", o.positions[0]);
    kv.set("meteoraReopenPending", null);
    meteoraDM(`✅ <b>Meteora re-center recovered</b> — chaser reopened (±${pending.halfWidthPct || cfg.halfWidthPct}%).`);
    return { action: "reopened-recovered", positions: o.positions };
  }

  const m = await meteora.status({ solUsd, btcUsd });
  // MANAGED-position selection. Prefer the pinned pubkey (B3) from the last open; fall back to
  // width-match (closest to cfg.halfWidthPct, within 1.8x) only to (re)bootstrap. The loop must
  // only ever touch the chaser — a ±2.5–3% backbone or experiment is structurally untouchable.
  const hwOf = (p) => (p.lowerPrice && p.upperPrice && p.upperPrice > p.lowerPrice)
    ? ((p.upperPrice - p.lowerPrice) / 2) / ((p.upperPrice + p.lowerPrice) / 2) * 100 : null;
  const pinned = kv.get("meteoraManagedPubkey", null);
  let pos = pinned ? (m.positions || []).find((p) => p.positionPubkey === pinned) : null;
  if (!pos) {
    const candidates = (m.positions || [])
      .map((p) => ({ p, hw: hwOf(p) }))
      .filter((c) => c.hw != null && c.p.positionPubkey && c.hw <= cfg.halfWidthPct * 1.8)
      .sort((a, b) => Math.abs(a.hw - cfg.halfWidthPct) - Math.abs(b.hw - cfg.halfWidthPct));
    if (!candidates.length) return { action: "none", reason: `no position near the managed width (±${cfg.halfWidthPct}%) — backbone/experiments are left alone` };
    pos = candidates[0].p;
    if (!dryRun) kv.set("meteoraManagedPubkey", pos.positionPubkey); // pin going forward
  }
  const span = pos.upperBinId - pos.lowerBinId;
  const frac = span > 0 ? (pos.activeBinId - pos.lowerBinId) / span : 0.5;
  const needs = force || !pos.inRange || frac < cfg.edgeFrac || frac > 1 - cfg.edgeFrac;
  const base = { pool: "meteora", managed: pos.position, widthPct: Number((hwOf(pos) || 0).toFixed(2)), frac: Number(frac.toFixed(3)), inRange: pos.inRange, valueUsd: pos.valueUsd, otherPositions: (m.positions || []).length - 1 };
  if (!needs) return { ...base, action: "hold", reason: `centered ${(frac * 100).toFixed(0)}%` };
  const sinceLast = (Date.now() - kv.get("meteoraLastRecenterTs", 0)) / 1000;
  if (!force && sinceLast < cfg.minRecenterSec) return { ...base, action: "deferred", reason: `anti-thrash (${Math.round(sinceLast)}s < ${cfg.minRecenterSec}s)` };
  if (dryRun) return { ...base, action: "would-recenter", reason: pos.inRange ? `near edge ${(frac * 100).toFixed(0)}%` : "out of range" };

  // A1 — stamp anti-thrash UP FRONT (so a crash can't allow instant re-entry) and wrap the
  // whole close→swap→reopen so a failed reopen flags a retry + alerts instead of stranding funds.
  kv.set("meteoraLastRecenterTs", Date.now());
  const steps = [];
  const freedX = (pos.amountX || 0) + (pos.pendingFeeX || 0); // cbBTC
  const freedY = (pos.amountY || 0) + (pos.pendingFeeY || 0); // SOL
  let closeSucceeded = false, depX = freedX, depY = freedY;
  try {
    const r = await meteora.removeLiquidity({ positionPubkey: pos.positionPubkey, pct: 1, close: true });
    closeSucceeded = true;
    kv.set("meteoraManagedPubkey", null); // old chaser is gone
    steps.push({ closed: pos.position, sigs: (r.sigs || []).length });
    await new Promise((res) => setTimeout(res, 2500));
    // Rebalance ONLY the freed amounts to ~50/50 (never the whole wallet → backbone funds safe).
    if (solUsd > 0 && btcUsd > 0) {
      const vX = freedX * btcUsd, vY = freedY * solUsd, target = (vX + vY) / 2;
      const diff = vX - target;
      if (Math.abs(diff) > 1) {
        if (diff > 0) { await whirlpoolMM.vault.manualSwap({ projectId: "treasury", fromSym: "BTC", toSym: "SOL", amountUi: diff / btcUsd, silent: true }); depX = target / btcUsd; depY = freedY + (diff / solUsd) * 0.998; }
        else { await whirlpoolMM.vault.manualSwap({ projectId: "treasury", fromSym: "SOL", toSym: "BTC", amountUi: -diff / solUsd, silent: true }); depY = target / solUsd; depX = freedX + (-diff / btcUsd) * 0.998; }
        steps.push({ rebalancedUsd: Number(Math.abs(diff).toFixed(2)) });
        await new Promise((res) => setTimeout(res, 2500));
      }
    }
    const f = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
    const o = await meteora.openPosition({
      cbbtcUi: Math.min(depX, f.clkn || 0),
      solUi: Math.min(depY, Math.max(0, (f.sol || 0) - 0.25)),
      halfWidthPct: cfg.halfWidthPct, distribution: cfg.distribution,
    });
    steps.push({ opened: o.positions, sigs: (o.sigs || []).length });
    if (o.positions && o.positions[0]) kv.set("meteoraManagedPubkey", o.positions[0]); // B3: pin new chaser
    meteoraDM(`🔄 <b>Meteora re-centered</b> (chaser only)\n±${cfg.halfWidthPct}% ${cfg.distribution} · was ${pos.inRange ? `near edge ${(frac * 100).toFixed(0)}%` : "OUT of range"}${base.otherPositions > 0 ? ` · ${base.otherPositions} other position(s) untouched` : ""}`);
  } catch (e) {
    if (closeSucceeded) {
      // Close landed but reopen failed → freed funds sit in the wallet. Flag for auto-retry
      // (next tick reopens exactly these amounts) and alert — never silently stranded.
      kv.set("meteoraReopenPending", { cbbtc: depX, sol: depY, halfWidthPct: cfg.halfWidthPct, distribution: cfg.distribution, ts: Date.now() });
      meteoraDM(`⚠️ <b>Meteora re-center: reopen FAILED</b>\nClose landed; ~$${(depX * btcUsd + depY * solUsd).toFixed(0)} freed in wallet. Auto-retry on next tick.\n<code>${(e.message || "").slice(0, 120)}</code>`);
    } else {
      meteoraDM(`⚠️ <b>Meteora re-center: close failed</b> — position intact, will retry.\n<code>${(e.message || "").slice(0, 120)}</code>`);
    }
    return { ...base, action: "error", closeSucceeded, error: e.message, steps };
  }
  return { ...base, action: "recentered", steps };
}

// ── JUP/USDC Meteora earner — autonomous re-center (owner-authorized 2026-06-12:
// "you can recenter JUP/USDC as needed"). Same battle-tested skeleton as
// meteoraRecenter (pin → edge check → stamp anti-thrash UP FRONT → close → 50/50
// the freed amounts → reopen → re-pin, with reopen-failure recovery), but generic
// X/Y in the pool's own token order (X=JUP, Y=USDC) via the module's xUi/yUi open.
const JUPUSDC_POOL = "HfgjZDmexhFVD28Vkb1NbQwWeXP3uDcVTLPjSGHmRHhL";
// enabled DEFAULTS OFF (owner hard rule 2026-06-13): the close→swap→reopen auto-recenter
// leaks funds (the SDK can't reproduce Meteora's UI swap+recenter bundle) — the owner
// rebalances by hand in the UI. A kv {enabled:true} can opt back in, but a kv reset must
// never silently re-arm the leak, so the code default is false. We MONITOR, the owner taps.
// halfWidthPct 3 ≈ the owner's tight ~±3% range; maxImpactPct 0.2 caps the rebalance swap's
// Jupiter price impact (a costlier route is skipped — see jupUsdcRecenter). enabled gates the
// autonomous close→swap→reopen loop ("Option B": recenter + 50/50 swap + redeposit, $0 residue).
// Split anti-thrash: minRecenterSecOor (120s) = OUT of range → earning $0, react on the
// next check; minRecenterSec (1800s) = near-edge but still earning → wait so we don't churn
// (each rebalance crystallizes IL — the "tight chasers died on choppy days" lesson).
// distribution "spot" (owner's call 2026-06-15, switched from "curve"): the reopened position
// spreads liquidity EVENLY across the ±width band instead of center-weighting it. A kv
// {distribution:"curve"} can override; the code default is the owner's current intent.
function jupUsdcCfg() { return { enabled: false, halfWidthPct: 4, distribution: "spot", edgeFrac: 0.12, minRecenterSec: 1800, minRecenterSecOor: 120, maxImpactPct: 0.2, ...kv.get("jupUsdcCfg", {}) }; }
async function jupUsdcRecenter({ dryRun = false, force = false } = {}) {
  if (!meteora.isEnabled()) return { action: "none", reason: "operator not set" };
  const cfg = jupUsdcCfg();
  let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
  // Recover a stranded close-without-reopen FIRST (funds sitting in the wallet).
  const pending = kv.get("jupUsdcReopenPending", null);
  if (pending && pending.x != null) {
    if (dryRun) return { action: "would-retry-reopen", pending };
    const f = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
    const o = await meteora.openPosition({ poolAddress: JUPUSDC_POOL, xUi: Math.min(pending.x, f.jup || 0), yUi: Math.min(pending.y, f.usdc || 0), halfWidthPct: pending.halfWidthPct || cfg.halfWidthPct, distribution: pending.distribution || cfg.distribution });
    if (o.positions && o.positions[0]) kv.set("jupUsdcManagedPubkey", o.positions[0]);
    kv.set("jupUsdcReopenPending", null);
    meteoraDM(`✅ <b>JUP/USDC re-center recovered</b> — reopened (±${pending.halfWidthPct || cfg.halfWidthPct}%).`);
    return { action: "reopened-recovered", positions: o.positions };
  }
  const m = await meteora.status({ jupUsd });
  const pinned = kv.get("jupUsdcManagedPubkey", null);
  let pos = pinned ? (m.positions || []).find((p) => p.positionPubkey === pinned) : null;
  if (!pos) {
    pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && p.positionPubkey);
    if (!pos) return { action: "none", reason: "no JUP/USDC position found" };
    if (!dryRun) kv.set("jupUsdcManagedPubkey", pos.positionPubkey);  // pin going forward
  }
  const span = pos.upperBinId - pos.lowerBinId;
  const frac = span > 0 ? (pos.activeBinId - pos.lowerBinId) / span : 0.5;
  const needs = force || !pos.inRange || frac < cfg.edgeFrac || frac > 1 - cfg.edgeFrac;
  const base = { pool: "jup-usdc", managed: pos.position, frac: Number(frac.toFixed(3)), inRange: pos.inRange, valueUsd: pos.valueUsd };
  if (!needs) return { ...base, action: "hold", reason: `centered ${(frac * 100).toFixed(0)}%` };
  const sinceLast = (Date.now() - kv.get("jupUsdcLastRecenterTs", 0)) / 1000;
  // OOR = earning $0 → short cooldown (react fast); near-edge but still earning → long cooldown (don't churn).
  const cooldown = pos.inRange ? cfg.minRecenterSec : (cfg.minRecenterSecOor != null ? cfg.minRecenterSecOor : 120);
  if (!force && sinceLast < cooldown) return { ...base, action: "deferred", reason: `anti-thrash (${Math.round(sinceLast)}s < ${cooldown}s, ${pos.inRange ? "near-edge" : "OOR"})` };
  if (dryRun) return { ...base, action: "would-recenter", reason: pos.inRange ? `near edge ${(frac * 100).toFixed(0)}%` : "out of range" };
  kv.set("jupUsdcLastRecenterTs", Date.now());   // stamp up front — a crash can't allow instant re-entry
  const steps = [];
  const freedX = (pos.amountX || 0) + (pos.pendingFeeX || 0); // JUP
  const freedY = (pos.amountY || 0) + (pos.pendingFeeY || 0); // USDC
  let closeSucceeded = false, depX = freedX, depY = freedY, posEarnedUsd = 0;
  try {
    const r = await meteora.removeLiquidity({ positionPubkey: pos.positionPubkey, pct: 1, close: true });
    closeSucceeded = true;
    kv.set("jupUsdcManagedPubkey", null);
    // Bank this position's realized fees NOW (claimed + pending) — before the reopen, so even a
    // failed reopen + later retry can't lose them from the lifetime count. Capture the total this
    // position earned over its life so we can report it in the rebalance DM.
    try { posEarnedUsd = jupUsdcBankClose(pos) || 0; } catch (_) {}
    steps.push({ closed: pos.position, sigs: (r.sigs || []).length });
    await new Promise((res) => setTimeout(res, 2500));
    // Rebalance ONLY the freed amounts to ~50/50 (never the whole wallet). The swap is
    // price-impact-guarded (cfg.maxImpactPct): if a clean route isn't available we SKIP the
    // swap and reopen with the freed amounts as-is — centered but not perfectly balanced,
    // funds fully intact (owner tops up later) — rather than eat a costly swap that would
    // burn the day's fees. On skip, depX/depY stay = the freed amounts (their init values).
    if (jupUsd > 0) {
      const vX = freedX * jupUsd, vY = freedY, target = (vX + vY) / 2;
      const diff = vX - target;
      if (Math.abs(diff) > 1) {
        const sw = diff > 0
          ? await whirlpoolMM.vault.manualSwap({ projectId: "treasury", fromSym: "JUP", toSym: "USDC", amountUi: diff / jupUsd, maxImpactPct: cfg.maxImpactPct, silent: true })
          : await whirlpoolMM.vault.manualSwap({ projectId: "treasury", fromSym: "USDC", toSym: "JUP", amountUi: -diff, maxImpactPct: cfg.maxImpactPct, silent: true });
        if (sw && sw.action === "swap") {
          if (diff > 0) { depX = target / jupUsd; depY = freedY + diff * 0.998; }
          else { depY = target; depX = freedX + (-diff / jupUsd) * 0.998; }
          // Log the ACTUAL swap cost (price impact on the swapped notional) — replaces the
          // old flat $1/recenter estimate so the recap's cost + LP-vs-HODL reflect reality.
          const swapCostUsd = Math.abs(diff) * ((Number(sw.impactPct) || 0) / 100);
          try { const Lc = jupUsdcLedger(); Lc.rebalanceCostUsd = (Lc.rebalanceCostUsd || 0) + swapCostUsd; kv.set("jupUsdcLedger", Lc); } catch (_) {}
          steps.push({ rebalancedUsd: Number(Math.abs(diff).toFixed(2)), impactPct: sw.impactPct, swapCostUsd: Number(swapCostUsd.toFixed(3)) });
          await new Promise((res) => setTimeout(res, 2500));
        } else {
          steps.push({ swapSkipped: (sw && sw.reason) || "no route" });
        }
      }
    }
    const f = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
    const o = await meteora.openPosition({ poolAddress: JUPUSDC_POOL, xUi: Math.min(depX, f.jup || 0), yUi: Math.min(depY, f.usdc || 0), halfWidthPct: cfg.halfWidthPct, distribution: cfg.distribution });
    steps.push({ opened: o.positions, sigs: (o.sigs || []).length });
    if (o.positions && o.positions[0]) kv.set("jupUsdcManagedPubkey", o.positions[0]);
    const swStep = steps.find((s) => s.rebalancedUsd != null) || steps.find((s) => s.swapSkipped);
    const swTxt = !swStep ? " · already balanced"
      : swStep.swapSkipped ? ` · ⚠️ swap skipped (${swStep.swapSkipped}) — centered, not fully balanced`
      : ` · swapped $${swStep.rebalancedUsd} to 50/50 (impact ${swStep.impactPct != null ? swStep.impactPct + "%" : "?"})`;
    meteoraDM(`🔄 <b>JUP/USDC re-centered</b> ±${cfg.halfWidthPct}% ${cfg.distribution} · was ${pos.inRange ? `near edge ${(frac * 100).toFixed(0)}%` : "OUT of range"}${swTxt} · ~$${Math.round(pos.valueUsd)}\n💰 That position earned <b>$${posEarnedUsd.toFixed(2)}</b> in fees over its life.`);
  } catch (e) {
    if (closeSucceeded) {
      kv.set("jupUsdcReopenPending", { x: depX, y: depY, halfWidthPct: cfg.halfWidthPct, distribution: cfg.distribution, ts: Date.now() });
      meteoraDM(`⚠️ <b>JUP/USDC re-center: reopen FAILED</b>\nClose landed; ~$${(depX * jupUsd + depY).toFixed(0)} freed in wallet. Auto-retry on next tick.\n<code>${(e.message || "").slice(0, 120)}</code>`);
    } else {
      meteoraDM(`⚠️ <b>JUP/USDC re-center: close failed</b> — position intact, will retry.\n<code>${(e.message || "").slice(0, 120)}</code>`);
    }
    return { ...base, action: "error", closeSucceeded, error: e.message, steps };
  }
  return { ...base, action: "recentered", steps };
}

// ── In-place rebalance for JUP/USDC (the Meteora UI "Rebalance" flow) — BACKGROUND
// TOOL, NOT auto-wired. Manual lever only: the 5-min loop still uses close→swap→reopen.
// Flow (X=JUP, Y=USDC): value both sides → the EXCESS side gets a withdrawBps keep-out
// in rebalance #1 (recenter + excess lands in the wallet) → Jupiter-swap the excess to
// the other token → rebalance #2 deposits it back as a top-up. Already balanced →
// single bps-0 rebalance. DRY RUN unless &run=1 — dry-run shows the full plan.
async function jupUsdcRebalanceInPlace({ dryRun = false } = {}) {
  if (!meteora.isEnabled()) return { action: "none", reason: "operator not set" };
  let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
  const m = await meteora.status({ jupUsd });
  const pinned = kv.get("jupUsdcManagedPubkey", null);
  let pos = pinned ? (m.positions || []).find((p) => p.positionPubkey === pinned) : null;
  if (!pos) pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && p.positionPubkey);
  if (!pos) return { action: "none", reason: "no JUP/USDC position found" };
  const cfg = jupUsdcCfg();
  const base = { pool: "jup-usdc", position: pos.positionPubkey, valueUsd: pos.valueUsd };
  // The literal Meteora UI operation: "Rebalance" + "Curve" + Submit. ONE in-place call
  // — withdraw, recenter on the current price, redeposit (curve) into the SAME position
  // NFT, fees claimed in-op. NO external swap, NO keep-out: that hand-rolled machinery
  // is exactly what leaked $478 to the wallet, so it's gone. After a live run, the wallet
  // residue is measured before→after (must be ~$0; anything more means the SDK redeposit
  // left funds and we DON'T automate yet).
  if (dryRun) {
    // Show the EXACT "Swaps Required" + "Rebalanced Position" the Meteora UI shows,
    // so we can validate against a UI screenshot before any live run.
    const q = await meteora.rebalanceQuote({ positionPubkey: pos.positionPubkey, strategy: cfg.distribution });
    const amt = q.autofillAmount || 0;
    const amtUsd = q.isBidSide ? amt : amt * (jupUsd || 0);
    const swap = amtUsd < 1 ? null : (q.isBidSide
      ? { sell: Number((amt / (jupUsd || 1)).toFixed(2)), sellSym: "JUP", get: Number(amt.toFixed(2)), getSym: "USDC" }   // short USDC → sell JUP
      : { sell: Number((amt * (jupUsd || 0)).toFixed(2)), sellSym: "USDC", get: Number(amt.toFixed(2)), getSym: "JUP" });  // short JUP → sell USDC
    return { ...base, action: "would-rebalance", strategy: cfg.distribution,
      currentPosition: { jup: Number((pos.amountX || 0).toFixed(2)), usdc: Number((pos.amountY || 0).toFixed(2)) },
      swapRequired: swap, balancedTarget: { jup: Number((q.targetX || 0).toFixed(2)), usdc: Number((q.targetY || 0).toFixed(2)) } };
  }
  const before = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
  const r = await meteora.rebalanceInPlace({ positionPubkey: pos.positionPubkey, strategy: cfg.distribution });
  const after = ((await whirlpoolMM.vault.status("treasury")) || {}).float || {};
  const resJup = Math.max(0, (after.jup || 0) - (before.jup || 0));
  const resUsdc = Math.max(0, (after.usdc || 0) - (before.usdc || 0));
  const residualUsd = resJup * (jupUsd || 0) + resUsdc;
  try { jupUsdcLogRebalance(residualUsd); } catch (_) {}   // cost-per-shuffle = residue + ~tx fee
  meteoraDM(`🔧 <b>JUP/USDC rebalanced</b> (${cfg.distribution}, in place) · same NFT. Wallet residue: $${residualUsd.toFixed(2)}.`);
  return { ...base, action: "rebalanced-inplace", sigs: r.sigs, residual: { jup: Number(resJup.toFixed(4)), usdc: Number(resUsdc.toFixed(2)), usd: Number(residualUsd.toFixed(2)) } };
}
// In-place rebalance endpoint (gated, BACKGROUND tool). DRY RUN unless &run=1.
app.get("/api/meteora/rebalance-inplace", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try { return res.status(200).json(await jupUsdcRebalanceInPlace({ dryRun: req.query.run !== "1" })); }
  catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora re-center (gated). DRY RUN unless &run=1. &force=1 ignores edge/anti-thrash checks.
// &which=jup targets the JUP/USDC earner instead of the cbBTC/SOL chaser.
app.get("/api/meteora/recenter", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    const fn = req.query.which === "jup" ? jupUsdcRecenter : meteoraRecenter;
    return res.status(200).json(await fn({ dryRun: req.query.run !== "1", force: req.query.force === "1" }));
  }
  catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Meteora config (gated). GET returns config; query params set it (e.g. ?autoRecenter=1&half=0.6&dist=curve).
app.get("/api/meteora/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    // &which=jup patches the JUP/USDC earner's kv config instead of the cbBTC chaser's.
    if (req.query.which === "jup") {
      const cur = jupUsdcCfg();
      const patch = {};
      if (req.query.halfWidthPct != null) patch.halfWidthPct = Math.max(0.5, Math.min(30, Number(req.query.halfWidthPct) || cur.halfWidthPct));
      if (req.query.distribution != null) patch.distribution = ["spot", "curve", "bidask"].includes(String(req.query.distribution)) ? String(req.query.distribution) : cur.distribution;
      if (req.query.edgeFrac != null) patch.edgeFrac = Math.max(0.02, Math.min(0.45, Number(req.query.edgeFrac) || cur.edgeFrac));
      if (req.query.minRecenterSec != null) patch.minRecenterSec = Math.max(60, Math.min(86400, parseInt(req.query.minRecenterSec) || cur.minRecenterSec));
      if (req.query.minRecenterSecOor != null) patch.minRecenterSecOor = Math.max(30, Math.min(86400, parseInt(req.query.minRecenterSecOor) || cur.minRecenterSecOor));
      if (req.query.maxImpactPct != null) patch.maxImpactPct = Math.max(0.01, Math.min(5, Number(req.query.maxImpactPct) || cur.maxImpactPct));
      if (req.query.enabled != null) patch.enabled = !["0", "false", "off"].includes(String(req.query.enabled).toLowerCase());
      if (Object.keys(patch).length) kv.set("jupUsdcCfg", { ...kv.get("jupUsdcCfg", {}), ...patch });
      return res.status(200).json({ which: "jup", config: jupUsdcCfg() });
    }
    const patch = {};
    for (const k of ["halfWidthPct", "distribution", "edgeFrac", "minRecenterSec", "autoRecenter"]) if (req.query[k] != null) patch[k] = req.query[k];
    const cfg = Object.keys(patch).length ? meteora.setCfg(patch) : meteora.getCfg();
    // Fee-ledger seeding (absolute token amounts) — align lifetime fees with Meteora's
    // app-shown "Fees Claimed" for history that predates the ledger.
    let ledger = meteora.getLedger();
    if (req.query.ledgerCbbtc != null || req.query.ledgerSol != null) ledger = meteora.setLedger({ cbbtc: req.query.ledgerCbbtc, sol: req.query.ledgerSol });
    return res.status(200).json({ config: cfg, feeLedger: ledger });
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// ── CLKN Blitz ───────────────────────────────────────────────────────────────
// Temporarily slams the main CLKN engine's CLKN/USDC + CLKN/SOL into a super-tight
// range at reduced deployFrac to pull routed volume, then auto-reverts after `minutes`.
// Reset-proof: the expiry is persisted (clknBlitzUntil) and checked every minute AND on
// boot, so a redeploy mid-blitz still reverts on time. Restores the captured widths.
function blitzDM(text) {
  try {
    const tg = process.env.TELEGRAM_BOT_TOKEN, proj = whirlpoolMM.vault.getProject("treasury");
    if (tg && proj && proj.telegramChatId) fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: proj.telegramChatId, parse_mode: "HTML", text }) }).catch(() => {});
  } catch (_) {}
}
async function clknForceRedeploy() {
  const cur = await whirlpoolMM.vault.status("clkn"); const s = (cur && cur.state) || {};
  const baseMint = s.positionMint || null, solMint = (s.solVault && s.solVault.mint) || null;
  if (baseMint) { try { await whirlpoolMM.vault.closePosition({ projectId: "clkn", mint: baseMint }); } catch (_) {} }
  if (solMint) { try { await whirlpoolMM.vault.closePosition({ projectId: "clkn", mint: solMint }); } catch (_) {} }
  try { await whirlpoolMM.vault.tick({ projectId: "clkn" }); } catch (e) { console.warn("[blitz] base tick:", e.message); }
  try { await whirlpoolMM.vault.tickSol({ projectId: "clkn" }); } catch (e) { console.warn("[blitz] sol tick:", e.message); }
}
async function clknBlitzStart({ widthPct = 0.77, minutes = 60, dryRun = false } = {}) {
  const cur = await whirlpoolMM.vault.status("clkn");
  if (!cur || !cur.enabled) return { error: "clkn engine not enabled" };
  const c = cur.config || {};
  // A5: if a blitz is ALREADY active, never re-capture restore (that would bank the blitz's
  // tight config as "normal" and lose the real pre-blitz widths). Just extend the timer.
  const alreadyActive = clknBlitzActive() && kv.get("clknBlitzRestore", null);
  const restore = alreadyActive ? kv.get("clknBlitzRestore", null) : { widthPct: c.widthPct, solWidthPct: c.solWidthPct, deployFrac: c.deployFrac };
  const out = { action: dryRun ? "would-blitz" : "blitz", widthPct, minutes, restore, extendedExisting: !!alreadyActive };
  if (dryRun) return out;
  kv.set("clknBlitzRestore", restore);
  kv.set("clknBlitzUntil", Date.now() + minutes * 60000);
  kv.set("clknBlitzLastStart", Date.now()); // for the organic-score logger's blitz-window tagging
  whirlpoolMM.vault.setConfig({ widthPct, solWidthPct: widthPct, deployFrac: 0.75 }, "clkn");
  await clknForceRedeploy();
  blitzDM(`⚡ <b>CLKN Blitz ${alreadyActive ? "RE-TUNED" : "ON"}</b>\n±${widthPct}% on CLKN/USDC + CLKN/SOL · ~75% deploy · auto-reverts in ${minutes}m`);
  return { ...out, until: kv.get("clknBlitzUntil", 0) };
}
let _blitzReverting = false;
async function clknBlitzRevert(reason = "timer") {
  const restore = kv.get("clknBlitzRestore", null);
  if (!restore) { kv.set("clknBlitzUntil", 0); return { reverted: false, reason: "no restore stored" }; }
  if (_blitzReverting) return { reverted: false, reason: "revert already in flight" };
  _blitzReverting = true;
  try {
    // A4: do the work FIRST; clear the timer/restore only after success. If this throws or the
    // process dies, clknBlitzUntil stays set so clknBlitzCheck retries — the blitz can't get
    // stuck tight forever. (setConfig is in-memory+persisted and effectively idempotent.)
    whirlpoolMM.vault.setConfig({ widthPct: restore.widthPct, solWidthPct: restore.solWidthPct, deployFrac: restore.deployFrac }, "clkn");
    await clknForceRedeploy();
    kv.set("clknBlitzUntil", 0);
    kv.set("clknBlitzRestore", null);
    blitzDM(`✅ <b>CLKN Blitz over</b> — restored ±${restore.widthPct}% / ±${restore.solWidthPct}% (${reason})`);
    return { reverted: true, restore };
  } finally { _blitzReverting = false; }
}
function clknBlitzActive() { return kv.get("clknBlitzUntil", 0) > 0; }
function clknBlitzCheck() {
  const until = kv.get("clknBlitzUntil", 0);
  // Retry whenever an expired timer OR a leftover restore (from a crashed revert) is present.
  if ((until && Date.now() > until) || (!until && kv.get("clknBlitzRestore", null)))
    clknBlitzRevert("timer").catch((e) => console.warn("[clkn-blitz] revert failed (will retry):", e.message));
}

// CLKN Blitz control (gated). &run=1 starts; &abort=1 reverts now; no flag = status/plan.
app.get("/api/clkn-blitz", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    if (req.query.abort === "1") return res.status(200).json(await clknBlitzRevert("manual abort"));
    const width = req.query.width != null ? Number(req.query.width) : 0.77;
    const minutes = req.query.minutes != null ? Number(req.query.minutes) : 60;
    const r = await clknBlitzStart({ widthPct: width, minutes, dryRun: req.query.run !== "1" });
    const until = kv.get("clknBlitzUntil", 0);
    return res.status(200).json({ ...r, active: until > 0, until, minutesLeft: until ? Math.max(0, Math.round((until - Date.now()) / 60000)) : 0 });
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// Organic-score log + Blitz-effect summary (gated). &snap=1 records a snapshot now.
app.get("/api/clkn-organic-log", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    // Arm the one-shot recovery reminder: &remindIn=<hours>[&remindChat=<id>]. Fires
    // from the hourly logger on Railway, DMs the operator bot room. &remindIn=0 disarms.
    if (req.query.remindIn != null) {
      const hrs = Number(req.query.remindIn);
      if (Number.isFinite(hrs) && hrs > 0) {
        kv.set("organicReminderAt", Date.now() + hrs * 3600 * 1000);
        kv.set("organicReminderArmedAt", Date.now());
        if (req.query.remindChat) kv.set("organicReminderChat", String(req.query.remindChat));
      } else { kv.set("organicReminderAt", 0); }
    }
    if (req.query.snap === "1") await recordOrganicSnapshot();
    const log = kv.get("clknOrganicLog", []) || [];
    const scored = log.filter((e) => e.score != null);
    // "Blitz window" = snapshot taken during a Blitz or within 6h after one started.
    const inWindow = (e) => e.blitzActive || (e.minsSinceBlitz != null && e.minsSinceBlitz <= 360);
    const blitzWin = scored.filter(inWindow), baseline = scored.filter((e) => !inWindow(e));
    const avg = (a) => a.length ? Number((a.reduce((s, e) => s + e.score, 0) / a.length).toFixed(2)) : null;
    return res.status(200).json({
      count: log.length,
      summary: {
        avgScore_blitzWindow: avg(blitzWin), samples_blitz: blitzWin.length,
        avgScore_baseline: avg(baseline), samples_baseline: baseline.length,
        latest: scored.length ? scored[scored.length - 1] : null,
        note: "blitzWindow = during a Blitz or ≤6h after one started; needs a few Blitzes for signal",
      },
      recent: log.slice(-72),
    });
  } catch (e) { return res.status(500).json({ error: publicErrMsg(e) }); }
});

// PUBLIC engine proof — the live Jupiter organic score + a safe history subset for the
// /liquidity-engine page's proof chart. Organic score / volume / price are all public
// market data; this exposes no wallet, position, or strategy detail. Cached 2 min.
let _engineProofCache = null, _engineProofAt = 0;
app.get("/api/engine-proof", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=120");
  try {
    const now = Date.now();
    if (_engineProofCache && now - _engineProofAt < 2 * 60 * 1000) return res.status(200).json(_engineProofCache);
    const org = await getClknOrganicScore(CLKN_MINT_ADDR).catch(() => null);
    const log = kv.get("clknOrganicLog", []) || [];
    // last 14 days of hourly samples, slimmed to ts/score/vol + blitz-active flag
    const history = log.slice(-336).filter((e) => e.score != null).map((e) => ({
      t: e.ts, s: e.score, v: e.vol24h ?? null, b: !!e.blitzActive,
    }));
    const out = {
      organic: org && Number.isFinite(org.score)
        ? { score: Number(org.score.toFixed(1)), label: ["high", "medium", "low"].includes(org.label) ? org.label : null }
        : null,
      history,
      updatedAt: now,
    };
    _engineProofCache = out; _engineProofAt = now;
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: "unavailable" }); }
});

// Graduation-watcher status (gated). Shows the current watchlist + our 48h
// graduated record; ?run=1 triggers one watcher cycle now (alerts fire if a
// token actually crosses 85% / graduates).
app.get("/api/grad-watch-status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
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
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
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
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
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
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
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
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
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
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
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
  // Target chat: explicit &chat=, or &project= (resolve that project's room), else default.
  let chatId = process.env.TELEGRAM_CHAT_ID;
  if (req.query.chat) chatId = String(req.query.chat);
  else if (req.query.project) {
    try { const p = whirlpoolMM.vault.getProject(String(req.query.project)); if (p && p.telegramChatId) chatId = p.telegramChatId; } catch (_) {}
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text,
        parse_mode: "HTML", disable_web_page_preview: true, disable_notification: silent,
      }),
    });
    const data = await r.json().catch(() => ({}));
    // &pin=1 — pin the message we just sent (silently, matching the send's notification mode).
    let pinned = null;
    if (req.query.pin === "1" && data?.result?.message_id) {
      try {
        const pr = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/pinChatMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: data.result.message_id, disable_notification: silent }),
        });
        const pd = await pr.json().catch(() => ({}));
        pinned = !!(pd && pd.ok);
      } catch (_) { pinned = false; }
    }
    return res.status(200).json({ success: !!(data && data.ok), messageId: data?.result?.message_id || null, pinned, telegram: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: publicErrMsg(e) });
  }
});

// Telegram webhook diagnostics (gated). getWebhookInfo + getMe — shows whether the
// webhook URL is registered, how many updates are queued, and Telegram's last delivery
// error (why commands like /liquidity might go unanswered). Add &reset=1 to re-register
// the webhook (the same setWebhook the boot block runs); &drop=1 also clears the backlog.
app.get("/api/tg-webhook-info", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.PREMIUM_ACCESS_KEY;
  const provided = req.query.key || req.headers["x-premium-key"];
  if (!KEY || provided !== KEY) return res.status(404).json({ error: "not_found" });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !TG_WEBHOOK_SECRET) return res.status(200).json({ ok: false, error: "Telegram not configured (TELEGRAM_BOT_TOKEN unset)" });
  const expectedUrl = `${TG_PUBLIC_BASE}/api/tg/${TG_WEBHOOK_SECRET}`;
  let resetResult = null;
  try {
    if (req.query.reset === "1") {
      const sr = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: expectedUrl, secret_token: TG_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: req.query.drop === "1" }),
      });
      resetResult = await sr.json().catch(() => ({}));
    }
    const wi = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json().catch(() => ({}));
    const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json().catch(() => ({}));
    const info = wi.result || {};
    return res.status(200).json({
      ok: true,
      bot: me.result ? { username: me.result.username, id: me.result.id, canReadAllGroupMessages: me.result.can_read_all_group_messages } : me,
      expectedUrl,
      urlMatches: info.url === expectedUrl,
      webhook: {
        url: info.url,
        pending_update_count: info.pending_update_count,
        last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
        last_error_message: info.last_error_message || null,
        ip_address: info.ip_address || null,
        max_connections: info.max_connections,
        allowed_updates: info.allowed_updates,
      },
      ...(resetResult ? { reset: resetResult } : {}),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: publicErrMsg(e) });
  }
});


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
  // pct=1 → places are PERCENTAGES of each winner's own cumulative buys (e.g. 15,15,15),
  // not fixed token amounts; q.prize overrides the board's prize line with free text.
  const pctPrize = q.pct === "1" || q.pct === 1;
  const prizeSummary = q.prize ? "🏆 " + String(q.prize).slice(0, 140)
    : pctPrize ? `🏆 Top ${places.length}: ${places.map(p => p.amount + "%").join(" / ")} of your cumulative buys`
    : `🏆 ${places.map(p => p.amount.toLocaleString()).join(" / ")} ${ticker}`;
  const exclude = String(q.exclude || "").split(",").map((s) => s.trim()).filter((w) => SOL_ADDR_RE.test(w));
  const minVolSol = Math.max(0, Number(q.minVolSol) || 0);
  // Auto-remove buy-and-dump bots (wallets that sold within the window) from the live
  // board. Default ON; pass liveHoldFilter=0/false to leave the raw board unfiltered.
  const liveHoldFilter = !["0", "false", "no", "off"].includes(String(q.liveHoldFilter ?? "").toLowerCase());
  const c = { id, label: String(q.label || ticker).slice(0, 60), mint, ticker, chatId, metric, startTs, endTs, holdHours, places, pctPrize, exclude, minVolSol, liveHoldFilter, prizeToken: { kind: prizeTokenKind, mint: prizeTokenMint }, updateMins, prizeSummary, status: "live", boardMsgId: null, provisional: [], lastUpdateTs: 0, createdAt: Date.now() };
  buyCompSave(c);
  buyCompUpdate(c).catch(() => {});    // post the initial board now (if the window has started)
  return res.status(200).json({ ok: true, id, competition: c });
});
// Manage a LIVE comp's bot/volume-bot exclusions (gated). ?id=&add=w1,w2 appends,
// &remove=w1 drops, &set=w1,w2 replaces, &minVolSol=0.05 sets the dust floor. Re-renders
// the board immediately. The MM/engine wallets are auto-excluded regardless of this list.
app.post("/api/buycomp/exclude", async (req, res) => {
  if (!buyCompAdminOK(req)) return res.status(404).json({ error: "not_found" });
  const q = Object.assign({}, req.query, req.body || {});
  const c = buyCompsAll()[String(q.id || "")];
  if (!c) return res.status(404).json({ error: "no such competition" });
  const parse = (v) => String(v || "").split(",").map((s) => s.trim()).filter((w) => SOL_ADDR_RE.test(w));
  c.exclude = Array.isArray(c.exclude) ? c.exclude : [];
  if (q.set != null) c.exclude = parse(q.set);
  if (q.add) c.exclude = [...new Set([...c.exclude, ...parse(q.add)])];
  if (q.remove) { const rm = new Set(parse(q.remove)); c.exclude = c.exclude.filter((w) => !rm.has(w)); }
  if (q.minVolSol != null) c.minVolSol = Math.max(0, Number(q.minVolSol) || 0);
  if (q.liveHoldFilter != null) c.liveHoldFilter = !["0", "false", "no", "off"].includes(String(q.liveHoldFilter).toLowerCase());
  buyCompSave(c);
  try { await buyCompUpdate(c); } catch (_) {}
  return res.status(200).json({ ok: true, id: c.id, exclude: c.exclude, minVolSol: c.minVolSol || 0, liveHoldFilter: c.liveHoldFilter !== false, autoExcludedEngineWallets: [...buyCompExcludeSet({ exclude: [] })] });
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
  catch (e) { return res.status(500).json({ error: "verify failed: " + publicErrMsg(e) }); }
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

  // 1) Every buyer in the window.
  let scan;
  try { scan = await buyersInWindowMulti(mint, fromTs, toTs, { maxPages: 80 }); }
  catch (e) { return res.status(500).json({ error: "buyer scan failed: " + publicErrMsg(e) }); }
  const buyers = (scan && scan.buyers) || [];
  if (!buyers.length) return res.status(200).json({ ok: true, note: "no buyers in window", buyersTotal: 0, reachedWindowStart: scan && scan.reachedWindowStart });

  // 2) Hold snapshot — keep only wallets still holding (no sells, balance > 0).
  const reviewed = [];
  for (const b of buyers) {
    let status = "eligible", note = `${b.buyCount} buy${b.buyCount > 1 ? "s" : ""}`;
    if (requireHold) {
      try {
        // Window-start onward (through the hold — no toMs): selling pre-window bags
        // doesn't DQ a raffle entry; selling the window buys does.
        const pos = await walletPositionMulti(b.wallet, mint, { fromMs: fromTs });
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
  try {
    const result = await buyersInWindowMulti(mint, from * 1000, to * 1000);
    if (!result) return res.status(200).json({ success: false, error: "No buyer data from any source" });
    return res.status(200).json({
      success: true,
      source: result.source || "multi-source",
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
    // rpc.rpcFetch fails over to any backup RPC on a primary 429/outage, so the
    // client tools (rose, airdrop, buyspecial) keep reading the chain.
    const response = await rpc.rpcFetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });
    const text = await response.text();
    res.status(response.status);
    try { return res.json(JSON.parse(text)); }
    catch (e) { return res.send(text); }
  } catch (err) {
    return res.status(500).json({ error: publicErrMsg(err) });
  }
});

// -- Helius Enhanced Transactions Proxy -- POST array of signatures, returns parsed txns --
app.post("/api/helius-tx", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  // This is the Helius Enhanced Transactions REST API (api.helius.xyz/v0), NOT JSON-RPC —
  // a generic backup / public node can't serve it, so rpc.rpcFetch's node failover doesn't
  // apply. Instead fail over across Helius KEYS (primary → HELIUS_API_KEY_2) on a 429/5xx,
  // so a credit cap on one key rolls to the other instead of going blind.
  const keys = rpc.heliusKeys();
  if (!keys.length) return res.status(500).json({ error: "Missing HELIUS_API_KEY" });
  let lastErr;
  for (let i = 0; i < keys.length; i++) {
    const isLast = i === keys.length - 1;
    try {
      const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${keys[i]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {})
      });
      if (rpc.isRetriableStatus(response.status) && !isLast) {
        try { await response.body?.cancel?.(); } catch {}
        continue;
      }
      const text = await response.text();
      res.status(response.status);
      try { return res.json(JSON.parse(text)); }
      catch (e) { return res.send(text); }
    } catch (err) {
      lastErr = err;
      if (!isLast) continue;
      return res.status(500).json({ error: publicErrMsg(err) });
    }
  }
  return res.status(500).json({ error: publicErrMsg(lastErr, "helius-tx failed") });
});

// A Helius JSON-RPC caller: rpcCall(id, method, params) — forwards params as given
// (object for getTokenAccounts, array for getMultipleAccounts/getTokenSupply), so it
// works with classifyAddressTypes and the DAS endpoints alike.
// Routes through rpc.rpcFetch so a primary 429 / outage fails over to any backup
// RPC (and the public node) instead of failing the call. The passed HELIUS_URL is
// honored as the first attempt; rpc.rpcFetch then rolls through the rest.
function heliusRpcCall(HELIUS_URL) {
  return async (id, method, params) => {
    const r = await rpc.rpcFetch(HELIUS_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return r.json();
  };
}

// ── Cluck Order Book — resting-order / wall scanner (GATED while building) ────
// Multi-venue read-only scan of where buy/sell pressure rests around a token's
// spot (Jupiter limit orders now; AMM depth + CLOBs next). Core lives in
// lib/orderbook-scanner.js. GATED (404 without the premium key) — it does NOT
// touch the public site/UX; the public page ships once the engine is complete.
app.get("/api/order-scan", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  const mint = String(req.query.mint || CLKN_MINT_ADDR);
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ error: "bad mint" });
  try {
    if (req.query.debug === "orca") { const pool = String(req.query.pool || ""); if (!SOL_ADDR_RE.test(pool)) return res.status(400).json({ error: "bad pool" }); return res.json({ success: true, debug: await orderbook.debugOrcaPositions(pool) }); }
    if (req.query.debug === "orcawalls") { const pool = String(req.query.pool || ""); if (!SOL_ADDR_RE.test(pool)) return res.status(400).json({ error: "bad pool" }); const orca = require("./lib/orca-whirlpools"); const spot = await orderbook.getUsdPrice(mint).catch(() => null); return res.json({ success: true, debug: await orca.poolWalls(pool, mint, spot) }); }
    if (req.query.debug) return res.json({ success: true, debug: await orderbook.debugJupSample(mint, String(req.query.debug)) });
    const data = await orderbook.scan(mint, { nocache: req.query.nocache === "1" });
    return res.json({ success: true, ...data });
  } catch (e) {
    return res.status(500).json({ success: false, error: publicErrMsg(e) });
  }
});

// ── Order Book MONITOR — day-to-day resting-order tracking + alerts ──────────
// Thin tokens rarely show resting limit orders, and the ones that do often fill
// within seconds. A periodic snapshot catches any order that rests longer than
// the poll interval, keeps a short history, and DMs the owner when a resting
// limit order APPEARS or DISAPPEARS (filled/cancelled) — "look day to day"
// without watching live. Storage: kv obSnaps_<mint> { history, current, lastDiff }.
const OB_SNAP_KEY = (mint) => `obSnaps_${mint}`;
function obWatchMints() { const w = kv.get("obWatch", null); return Array.isArray(w) && w.length ? w : [CLKN_MINT_ADDR]; }
function obOwnerWallets() { const w = kv.get("obOwnerWallets", null); return Array.isArray(w) ? w : []; } // your LP wallets → alerts tag yours vs 3rd-party
async function recordOrderbookSnapshot(mint) {
  const m = await orderbook.monitorScan(mint);
  // Degraded read (no spot price) → don't snapshot/diff, so a transient data
  // outage can't fire a false "appeared/filled" alert.
  if (m.spotUsd == null) return { at: Date.now(), spotUsd: null, asks: 0, bids: 0, diff: null, degraded: true };
  // Exclude the project's own LP wallets — alerts should only fire for orders/walls
  // that AREN'T yours (your own positions flipping in/out of range shouldn't ping).
  const myW = new Set(obOwnerWallets());
  const orders = (m.orders || []).filter(o => o.orderPubkey && o.priceUsd != null && !(o.owner && myW.has(o.owner)));
  const pkSet = new Set(orders.map(o => o.orderPubkey));
  const store = kv.get(OB_SNAP_KEY(mint), { history: [], current: null, lastDiff: null });
  const prev = store.current;
  const asks = orders.filter(o => o.side === "sell"), bids = orders.filter(o => o.side === "buy");
  const sum = a => a.reduce((s, o) => s + (o.sizeUsd || 0), 0);
  const at = Date.now();
  const compact = o => ({ side: o.side, priceUsd: o.priceUsd, sizeUsd: o.sizeUsd, distPct: o.distPct, venue: o.venue, orderPubkey: o.orderPubkey, owner: o.owner || null });
  let diff = null;
  if (prev) {
    const prevSet = new Set(prev.pubkeys || []);
    const appeared = orders.filter(o => !prevSet.has(o.orderPubkey)).slice(0, 30).map(compact);
    const disappeared = (prev.orders || []).filter(o => !pkSet.has(o.orderPubkey)).slice(0, 30);
    if (appeared.length || disappeared.length) diff = { at, appeared, disappeared };
  }
  store.history.push({ at, spotUsd: m.spotUsd, asks: asks.length, bids: bids.length, askUsd: sum(asks), bidUsd: sum(bids) });
  if (store.history.length > 300) store.history = store.history.slice(-300);
  store.current = { at, spotUsd: m.spotUsd, pubkeys: orders.map(o => o.orderPubkey).slice(0, 400), orders: orders.slice(0, 80).map(compact) };
  if (diff) store.lastDiff = diff;
  kv.set(OB_SNAP_KEY(mint), store);
  return { at, spotUsd: m.spotUsd, asks: asks.length, bids: bids.length, diff };
}
// Day-to-day view (gated): current resting orders + recent history + last change.
app.get("/api/order-watch", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  // Register your LP wallet(s) so the monitor never alerts on your own positions.
  if (req.query.setOwners != null) {
    const list = String(req.query.setOwners).split(",").map(s => s.trim()).filter(w => SOL_ADDR_RE.test(w));
    kv.set("obOwnerWallets", list);
    return res.json({ success: true, ownerWallets: list });
  }
  const mint = String(req.query.mint || CLKN_MINT_ADDR);
  if (!SOL_ADDR_RE.test(mint)) return res.status(400).json({ error: "bad mint" });
  try {
    if (req.query.run === "1") await recordOrderbookSnapshot(mint);
    const store = kv.get(OB_SNAP_KEY(mint), { history: [], current: null, lastDiff: null });
    return res.json({ success: true, mint, watching: obWatchMints().includes(mint), current: store.current, lastDiff: store.lastDiff, history: store.history.slice(-100) });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// ── CLKN multi-quote STRUCTURE watch (read-only, strategy phase) ─────────────
// Hourly snapshot of how the owner-managed 3-pair Orca structure moves: per-pool
// position count / in-range / value, plus organic score + 24h volume. Pure
// observation for strategy-building — NEVER acts on positions (owner controls
// manually). kv clknStructureLog (ring). View: /api/order-watch/structure.
const CLKN_ORCA_POOLS = [
  { pool: "EL1ZDnuTE4J4LZJLP76VapFSDiM7Xt18ZsnzVeqNvaPr", pair: "CLKN/SOL" },
  { pool: "H1r9ut25xAU1B1AbZRhvSJjShd4Q3mtmysYHBisFES7H", pair: "CLKN/USDC" },
  { pool: "7eVP5Jqe5CiX7LJtfzC6xdfGxFpfPX7jsvaoLnCdn9aB", pair: "CLKN/JUP" },
];
async function recordClknStructureSnapshot() {
  const orca = require("./lib/orca-whirlpools");
  const spot = await orderbook.getUsdPrice(CLKN_MINT_ADDR).catch(() => null);
  const organic = await getClknOrganicScore(CLKN_MINT_ADDR).catch(() => null);
  const vol24h = await getClkn24hVolume(CLKN_MINT_ADDR).catch(() => null);
  const pools = [];
  for (const { pool, pair } of CLKN_ORCA_POOLS) {
    try {
      const r = await orca.poolWalls(pool, CLKN_MINT_ADDR, spot);
      const all = r.walls || [];
      pools.push({ pair, positions: all.length, inRange: all.filter(w => w.inRange).length, outOfRange: all.filter(w => !w.inRange).length, valueUsd: Math.round(all.reduce((s, w) => s + (w.sizeUsd || 0), 0)) });
    } catch (e) { pools.push({ pair, error: String(e.message || e).slice(0, 80) }); }
  }
  const snap = { at: Date.now(), spotUsd: spot, organic: organic && Number.isFinite(organic.score) ? organic.score : null, vol24h: vol24h || null, totalValueUsd: Math.round(pools.reduce((s, p) => s + (p.valueUsd || 0), 0)), pools };
  let hist = kv.get("clknStructureLog", []) || [];
  hist.push(snap); if (hist.length > 800) hist = hist.slice(-800);
  kv.set("clknStructureLog", hist);
  return snap;
}
app.get("/api/order-watch/structure", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  try {
    if (req.query.run === "1") await recordClknStructureSnapshot();
    const hist = kv.get("clknStructureLog", []) || [];
    return res.json({ success: true, latest: hist[hist.length - 1] || null, count: hist.length, history: hist.slice(-200) });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
  }
});

// -- Fee Share / Analytics endpoints --
const CLKN_MINT_CONST = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";

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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
// Per-source quotas for the exam draw (must sum to EXAM_SIZE; tune here).
const EXAM_SOURCE_MIX = { CURRICULUM: 20, ULTIMATE: 20, LPLAB: 10 };
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
  // Stratified draw by question source — a flat random draw over the 210-question bank
  // (CURRICULUM 70 / ULTIMATE 59 / LPLAB 81) makes the exam LP-heavy by count. Pin the
  // mix so the core curriculum stays the backbone; backfill from the leftover pool if a
  // source ever runs short, so the exam is always EXAM_SIZE questions.
  const want = Math.min(EXAM_SIZE, QUESTION_BANK.length);
  const drawn = [];
  const leftover = [];
  for (const [src, quota] of Object.entries(EXAM_SOURCE_MIX)) {
    const pool = shuffleInPlace(QUESTION_BANK.filter((q) => q.source === src));
    drawn.push(...pool.slice(0, quota));
    leftover.push(...pool.slice(quota));
  }
  leftover.push(...QUESTION_BANK.filter((q) => !(q.source in EXAM_SOURCE_MIX)));
  if (drawn.length < want) drawn.push(...shuffleInPlace(leftover).slice(0, want - drawn.length));
  shuffleInPlace(drawn).splice(want);
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
    // Graduating the FULL curriculum earns the on-chain diploma NFT (not the Ultimate
    // Challenge). Best-effort: a mint hiccup never fails the claim — the record is saved.
    let nft = null;
    if (kind === "graduation") {
      try { nft = await diplomaNft.mintDiploma(wallet, rec.slug); }
      catch (e) { nft = { ok: false, error: publicErrMsg(e) }; }
    }
    return res.status(200).json({
      success: true, isHolder, balance, verified,
      slug: rec.slug, transcript: `/transcript/${rec.slug}`, alreadyOnList: exists, nft,
    });
  } catch(err) {
    console.error("Claim error:", err.message);
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
// delegate scanner + the autopsy's honeypot logic.
// Batch price + identity for many Solana mints (chunks of 30) via the GeckoTerminal onchain
// multi-token endpoint → { mint: {symbol,name,priceUsd,logo} }. Powers wallet portfolio USD
// values (wallet-checkup) and per-holder USD (holders/snapshot). Routes through cgFetch (Pro).
async function priceTokensBatch(mints) {
  const out = {};
  const uniq = [...new Set((mints || []).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    try {
      const j = await lpScanner.cgFetch(`/networks/solana/tokens/multi/${chunk.join(",")}`);
      for (const t of (j.data || [])) {
        const a = t.attributes || {};
        const mint = (a.address || (t.id || "").replace("solana_", ""));
        if (!mint) continue;
        out[mint] = { symbol: a.symbol || null, name: a.name || null, priceUsd: Number(a.price_usd) || 0, logo: a.image_url && a.image_url !== "missing.png" ? a.image_url : null };
      }
    } catch (_) { /* skip the chunk on failure — those tokens just show no price */ }
  }
  return out;
}

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

    // 4. Portfolio view — price every held token (one batched call) → USD value per holding +
    // total wallet value + how much sits in the risky tokens. Turns the safety scan into a
    // proper wallet tracker. Tokens with no market price (long-tail/dead) just show $0.
    const priced = await priceTokensBatch(mints);
    const holdings = mints.map((m) => {
      const e = byMint.get(m), p = priced[m] || {};
      return { mint: m, amount: e.amount, symbol: p.symbol || null, name: p.name || null, logo: p.logo || null, priceUsd: p.priceUsd || 0, valueUsd: Number(((e.amount || 0) * (p.priceUsd || 0)).toFixed(2)) };
    }).sort((a, b) => b.valueUsd - a.valueUsd);
    const portfolioUsd = Number(holdings.reduce((s, h) => s + h.valueUsd, 0).toFixed(2));
    let atRiskUsd = 0;
    riskyHoldings.forEach((r) => { const h = holdings.find((x) => x.mint === r.mint); r.valueUsd = h ? h.valueUsd : null; r.symbol = h ? h.symbol : null; if (h) atRiskUsd += h.valueUsd; });

    return res.status(200).json({
      success: true, wallet,
      tokensHeld: byMint.size,
      scanned: mints.length,
      capped: byMint.size > mints.length,
      portfolioUsd, atRiskUsd: Number(atRiskUsd.toFixed(2)),
      holdings,
      approvals,
      riskyHoldings,
    });
  } catch (e) {
    console.error("[wallet-checkup]", e.message);
    return res.status(500).json({ success: false, error: publicErrMsg(e) });
  }
});

app.get("/api/claims", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  // Admin-only: exposes the full airdrop list (wallets + balances). Gated on the
  // PREMIUM_ACCESS_KEY secret (Railway only) like the other admin endpoints —
  // never a hardcoded password in this public repo.
  if (!adminAuthOK(req)) {
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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

// Managed-vault engine operator wallets (CLKN liquidity engine + any other project
// operators). Their CLKN BUYS now render as community reinvestment — the engine
// buying CLKN back is real buy pressure — while their SELLS stay suppressed (MM noise).
function mmOperatorWallets() {
  try {
    return whirlpoolMM.vault.operatorPubkeys
      ? whirlpoolMM.vault.operatorPubkeys()
      : [whirlpoolMM.vault.operatorPubkey && whirlpoolMM.vault.operatorPubkey()].filter(Boolean);
  } catch (_) { return []; }
}
// A buy that should post as "♻️ COMMUNITY REINVESTMENT": the team deployer OR an
// engine operator wallet. Single source of truth for the poller + the buy alert.
function isReinvestWallet(addr) {
  return addr != null && (DEV_WALLETS.has(addr) || mmOperatorWallets().includes(addr));
}

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
        params: [tokenAccount, { limit: 10, commitment: "finalized" }]
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
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]
        })
      });
      const txData = await txRes.json();
      const tx = txData?.result;
      if (!tx) continue;
      // Only count a finalized transfer that actually SUCCEEDED. A failed tx rolls
      // its balances back (so diff would be 0), but assert it explicitly rather
      // than relying on that side effect — don't honor a transfer the chain rejected.
      if (tx.meta?.err) continue;

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
        // add() is an atomic test-and-set: if a concurrent request already claimed
        // this signature it returns false, and we reject rather than double-grant.
        if (!sigStore.add(sig.signature)) {
          return res.status(200).json({ success: false, error: "This payment was already redeemed — each transfer unlocks once." });
        }
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
// ── Provably-fair RNG (commit-reveal) — CLAUDE.md "slots: provably-fair before real prizes" ──
// Per-spin: the server commits to sha256(serverSeed) BEFORE the spin (returned by /state and
// as nextCommit on every spin), derives the outcome from sha256(serverSeed:clientSeed:nonce),
// then reveals serverSeed so the player can recompute both the commit and the outcome. The
// seed rotates EVERY spin — a revealed seed can never predict a future spin (otherwise a
// player could precompute the next outcome and skip bad spins).
const sha256hex = (v) => createHash("sha256").update(String(v)).digest("hex");
function slotFair(s, wallet) {
  s.fair = s.fair || {};
  if (!s.fair[wallet] || !s.fair[wallet].seed) s.fair[wallet] = { seed: randomBytes(32).toString("hex"), nonce: 0 };
  return s.fair[wallet];
}
// Per-week seed for the wheel draw — committed all week in /state, revealed by the draw.
function slotWeekFair(s) {
  s.weekFair = s.weekFair || {};
  if (!s.weekFair[s.weekId]) s.weekFair[s.weekId] = randomBytes(32).toString("hex");
  return s.weekFair[s.weekId];
}
// hex hash → n floats in [0,1) (8 hex chars = uint32 each; sha256 yields up to 8)
function rollFloats(hex, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16) / 0x100000000);
  return out;
}
// Same weighted pick as the original slotPick, but driven by supplied floats.
function slotPickFair(rs) {
  const tot = SLOT_WEIGHTS.reduce((a, w) => a + w, 0);
  const pick = (r0) => { let r = r0 * tot; for (let i = 0; i < SLOT_WEIGHTS.length; i++) { r -= SLOT_WEIGHTS[i]; if (r <= 0) return SLOT_SYMS[i]; } return SLOT_SYMS[SLOT_SYMS.length - 1]; };
  return [pick(rs[0]), pick(rs[1]), pick(rs[2])];
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
  // Provably-fair outcome: committed seed (published before this spin) + player's
  // clientSeed + nonce → deterministic roll. Seed is revealed below and rotated.
  const fair = slotFair(s, wallet);
  const clientSeed = String((req.body || {}).clientSeed || "").slice(0, 64);
  const commit = sha256hex(fair.seed);
  const roll = sha256hex(`${fair.seed}:${clientSeed}:${fair.nonce}`);
  const outcome = slotPickFair(rollFloats(roll, 3)), sc = slotScore(outcome);
  const revealedSeed = fair.seed, revealedNonce = fair.nonce;
  s.fair[wallet] = { seed: randomBytes(32).toString("hex"), nonce: 0 };       // rotate — commit chain continues
  const nextCommit = sha256hex(s.fair[wallet].seed);
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
  return res.status(200).json({
    outcome, gained: sc.pts, kind: sc.kind, jackpot: p.jackpot, fireChicken: !!p.fireChicken, hitFireChicken: !!sc.fireChicken, airdrop: fcFirst ? SLOT_FIRE_CHICKEN_AIRDROP : 0, fireChickenAlreadyWon: sc.fireChicken && !fcFirst, totalPoints: p.pts, spinsLeft: allot - (used + 1), dailyAllot: allot, spinsResetAt: slotDayEndsAt(), weekId: s.weekId, leaderboard: slotLeaderboard(s, wallet),
    // commit-reveal proof: sha256(serverSeed) === commit (published before this spin), and
    // sha256(`${serverSeed}:${clientSeed}:${nonce}`) → first 3×8 hex chars as uint32/2^32 → weighted symbols.
    fair: { commit, serverSeed: revealedSeed, clientSeed, nonce: revealedNonce, roll, nextCommit, algo: "sha256(serverSeed:clientSeed:nonce) -> 3 x uint32/2^32 -> weighted pick over published odds" },
  });
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
    me = { wallet, inBeta, balance: bal, dailyAllot: allot, spinsLeft: Math.max(0, allot - used), points: p.pts, jackpot: !!p.jackpot, fireChicken: !!p.fireChicken, floor: SLOT_SPIN_PER, disqualified: sold, fairCommit: sha256hex(slotFair(s, wallet).seed) };
  }
  const weekFairCommit = sha256hex(slotWeekFair(s));   // wheel-draw seed commit, public all week
  kv.set("slotsState", s);                             // persist any seeds created above
  return res.status(200).json({ weekId: s.weekId, weekEndsAt: slotWeekEndsAt(), spinsResetAt: slotDayEndsAt(), openBeta: s.openBeta !== false, drawn: s.draws[s.weekId] || null, me, leaderboard: slotLeaderboard(s, wallet), odds: slotOdds(), weekFairCommit });
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
  // Both random steps below (wild-card shuffle + winner pick) derive from the week's
  // committed seed (weekFairCommit in /state all week) so the whole draw is verifiable
  // from the published entrant list once the seed is revealed.
  const weekSeed = slotWeekFair(s);
  const rest = finalists.filter(x => !set.has(x.wallet));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rollFloats(sha256hex(`${weekSeed}:${s.weekId}:wild:${i}`), 1)[0] * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
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
  // Winner from the committed week seed + the published entrant composition (wallet:entries,
  // sorted) — anyone can recompute this from the draw record once the seed is revealed.
  const compo = entrants.map(e => `${e.wallet}:${e.entries}`).sort().join(",");
  const winnerRoll = sha256hex(`${weekSeed}:${s.weekId}:winner:${sha256hex(compo)}`);
  let r = rollFloats(winnerRoll, 1)[0] * pool, winner = entrants[0];
  for (const e of entrants) { r -= e.entries; if (r <= 0) { winner = e; break; } }
  const fairProof = {
    weekId: s.weekId, commit: sha256hex(weekSeed), serverSeed: weekSeed, compoHash: sha256hex(compo),
    algo: "winner = sha256(seed:weekId:winner:compoHash) -> uint32/2^32 * pool over entries; wild shuffle = sha256(seed:weekId:wild:i)",
  };
  s.draws[s.weekId] = { winner: winner.wallet, at: Date.now(), ...summary, entrants: shorts, fireChicken: fcShorts, fair: fairProof };
  kv.set("slotsState", s);
  return res.status(200).json({ winner: winner.wallet, winnerShort: winner.wallet.slice(0, 4) + "…" + winner.wallet.slice(-4), ...summary, entrants: shorts, fireChicken, weekId: s.weekId, fair: fairProof });
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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

// -- GeckoTerminal liquidity/price fallback (shared by /api/token-overview) --
// DexScreener stops indexing a pair ~24h after its last trade, which makes a
// quiet-but-real token look like it has zero liquidity. GeckoTerminal indexes
// pools straight from the chain and keeps quiet ones listed, so it's used as a
// fallback to recover liquidity / price / FDV. Returns null on any failure.
async function fetchGeckoTerminalFallback(mint) {
  try {
    // Routes through the CoinGecko Pro onchain API when COINGECKO_API_KEY is set (fuller multi-
    // DEX coverage, accurate aggregated volume, no rate-limit throttling), else free GeckoTerminal.
    const j = await lpScanner.cgFetch(`/networks/solana/tokens/${mint}/pools?include=base_token`);
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

// Address primitives + program/wallet tables now live in lib/solana-addr.js
// (one source of truth for trace / snapshot / cluck-score / autopsy).

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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
  }
});

// === Wallet X-Ray — full-wallet behavioral deep dive (all tokens) ===========
// Unlike /api/trace (one wallet × one token), this reads the wallet's ENTIRE
// recent enhanced history and profiles the wallet itself: where it was funded
// from, everything it bought / sold / transferred across every token, and
// pattern signals (bot cadence, fast-flip dumping, CEX cash-out, LP, holder).
// Forensic rule: these are ON-CHAIN PATTERNS, never asserted intent — a "bot"
// or "dumper" label is a behavioral read of the tape, not a verdict on a person.
const WX_WSOL = "So11111111111111111111111111111111111111112";
const WX_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WX_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const WX_STABLES = new Set([WX_USDC, WX_USDT]);
// Helius `source` values that mean "this tx ran through a DEX / aggregator" —
// used to disambiguate a swap (priced trade) from a bare wallet-to-wallet move.
const WX_DEX_SOURCES = new Set([
  "JUPITER", "RAYDIUM", "ORCA", "METEORA", "PUMP_FUN", "PUMP_AMM", "PUMPSWAP",
  "PHOENIX", "LIFINITY", "ALDRIN", "SABER", "SERUM", "OPENBOOK", "STEP_FINANCE",
  "CROPPER", "FLUXBEAM", "INVARIANT", "RAYDIUM_CLMM", "RAYDIUM_CPMM", "DEXLAB",
]);
function wxMedian(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function wxDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 90) return sec + "s";
  if (sec < 5400) return Math.round(sec / 60) + "m";
  if (sec < 172800) return (sec / 3600).toFixed(1) + "h";
  return (sec / 86400).toFixed(1) + "d";
}

// Find a wallet's TRUE origin — its very first transaction and who funded it.
// This is independent of the (capped) enhanced-history scan: we page SIGNATURES
// ONLY (cheap — no enhanced parse) straight to the bottom of the wallet's history,
// grab the oldest signature, then enhanced-parse just THAT one tx to see where the
// first lamports came from (a CEX hot wallet, a service, or another wallet). Paging
// signatures is fast enough to reach genesis on all but the most extreme wallets;
// reachedGenesis reports honestly whether we hit the very first tx. totalSigs is the
// wallet's lifetime transaction count when genesis is reached.
async function wxFindOrigin(wallet, rpcUrl, HELIUS_KEY, labelWallet, { maxPages, deadline }) {
  let before = null, oldestSig = null, totalSigs = 0, reachedGenesis = false, pages = 0, lastPage = [];
  for (; pages < maxPages; pages++) {
    if (Date.now() > deadline) break;
    let arr = [];
    try {
      const r = await fetch(rpcUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "wo", method: "getSignaturesForAddress", params: [wallet, { limit: 1000, ...(before ? { before } : {}) }] }),
      });
      arr = (await r.json()).result || [];
    } catch { break; }
    if (!arr.length) { reachedGenesis = true; break; }
    totalSigs += arr.length;
    lastPage = arr;                          // keep the oldest page reached (sigs come newest-first)
    oldestSig = arr[arr.length - 1].signature;
    if (arr.length < 1000) { reachedGenesis = true; break; }
    before = oldestSig;
  }
  if (!oldestSig) return null;

  // Examine the OLDEST ~10 transactions, chronological. The wallet's first-ever tx is
  // often unsolicited token DUST/spam — not the real funding. So we separate the first
  // on-chain appearance from the first genuine SOL inflow (the actual money source).
  const oldestSigs = lastPage.slice(-10).reverse().map((s) => s.signature); // oldest → newer
  let parsed = [];
  try {
    const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: oldestSigs }), signal: AbortSignal.timeout(14000),
    });
    const a = await r.json();
    if (Array.isArray(a)) parsed = a.filter(Boolean).sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
  } catch {}

  const DUST_SOL = 0.0015; // below this an inbound "SOL" is just rent dust, not funding
  let firstActivity = null, funding = null, firstTokenIn = null;
  for (const tx of parsed) {
    const ts = tx.timestamp || 0;
    if (!firstActivity) firstActivity = { sig: tx.signature, ts, type: tx.type || null, source: tx.source || null };
    // First meaningful SOL inflow = the real funding event.
    if (!funding) {
      let best = 0, from = null;
      for (const n of tx.nativeTransfers || []) { if (n.toUserAccount === wallet) { const amt = (Number(n.amount) || 0) / 1e9; if (amt > best) { best = amt; from = n.fromUserAccount; } } }
      if (best >= DUST_SOL && from) funding = { sig: tx.signature, ts, funder: from, amountSol: best, kind: "SOL" };
    }
    // Track the first token received (for the dust note / token-funded wallets).
    if (!firstTokenIn) for (const t of tx.tokenTransfers || []) { if (t.toUserAccount === wallet && t.fromUserAccount && t.fromUserAccount !== wallet) { firstTokenIn = { sig: tx.signature, ts, from: t.fromUserAccount, mint: t.mint }; break; } }
    if (funding) break;
  }

  // Fall back to a token-funded origin if no SOL inflow appeared in the oldest slice.
  if (!funding && firstTokenIn) funding = { sig: firstTokenIn.sig, ts: firstTokenIn.ts, funder: firstTokenIn.from, amountSol: 0, kind: "token" };
  if (!funding && firstActivity && parsed[0] && parsed[0].feePayer && parsed[0].feePayer !== wallet) funding = { sig: firstActivity.sig, ts: firstActivity.ts, funder: parsed[0].feePayer, amountSol: 0, kind: "first-action" };

  const dustFirst = !!(firstActivity && funding && firstActivity.sig !== funding.sig && firstActivity.ts < funding.ts);
  return {
    firstSig: firstActivity ? firstActivity.sig : oldestSig,
    firstTs: firstActivity ? firstActivity.ts : 0,
    firstActivity,
    funder: funding ? funding.funder : null,
    funderLabel: funding && funding.funder ? labelWallet(funding.funder) : null,
    amountSol: funding ? funding.amountSol : 0,
    kind: funding ? funding.kind : null,
    fundingSig: funding ? funding.sig : null,
    fundingTs: funding ? funding.ts : 0,
    dustFirst,
    lifetimeTx: totalSigs, reachedGenesis,
  };
}

// Token Vitals — FACTS-ONLY token snapshot. This intentionally returns NO score, NO grade,
// NO verdict: the removed Cluck Score gave reassuring grades to tokens that then rugged, so the
// roll-up itself was the problem. Here we surface the same on-chain readings the score was built
// from (authorities, liquidity, holders/concentration, Token-2022 mechanics, market, Bags/Jupiter
// context) and let the reader judge. Forensic rule: state WHAT's on-chain, never assert intent.
app.get("/api/token-vitals", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // 5-minute edge cache
  const mint = (req.query.mint || "").trim();
  if (!SOL_ADDR_RE.test(mint)) {
    return res.status(400).json({ success: false, error: "Invalid mint" });
  }
  try { analytics.trackTool("token_vitals"); } catch (_) {}
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) {
    return res.status(500).json({ success: false, error: "Server not configured" });
  }
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

  // One retry with backoff on a transient failure (429 / 5xx / network) so a single
  // rate-limited call doesn't silently drop a whole fact. Edge-cached 5 min → calls bounded.
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
      // Holder count — paginated walk (up to 10k accounts); flag capped so a hit limit shows
      // as "10,000+" instead of a wrong exact.
      (async () => {
        const owners = new Set();
        let capped = false;
        const MAX_PAGES = 10;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const d = await rpcCall(`tv-holders-${page}`, "getTokenAccounts", {
            page, limit: 1000, mint, displayOptions: { showZeroBalance: false }
          });
          const accounts = d?.result?.token_accounts || [];
          if (!accounts.length) break;
          for (const a of accounts) { if (parseInt(a.amount) > 0) owners.add(a.owner); }
          if (accounts.length < 1000) break;
          if (page === MAX_PAGES) capped = true;
        }
        return { count: owners.size, capped };
      })(),
      fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(r => r.json()),
      rpcCall("tv-supply", "getTokenSupply", [mint]),
      rpcCall("tv-mint-info", "getAccountInfo", [mint, { encoding: "jsonParsed" }]),
      rpcCall("tv-largest", "getTokenLargestAccounts", [mint]),
      fetchBagsContext(mint),
    ]);

    const holderInfo = holdersData.status === "fulfilled" ? holdersData.value : null;
    const holderCount = holderInfo ? holderInfo.count : null;
    const holderCountCapped = !!(holderInfo && holderInfo.capped);
    const allDexPairs = dexData.status === "fulfilled" && Array.isArray(dexData.value) ? dexData.value : [];
    // Only Solana pairs. Sum liquidity/volume across all of them (multi-pool = real total exit depth).
    const solPairs = allDexPairs.filter(p => p.chainId === "solana" || !p.chainId);
    let totalLiqUsd = solPairs.reduce((s, p) => s + (parseFloat(p.liquidity?.usd) || 0), 0);
    let totalVol24h = solPairs.reduce((s, p) => s + (parseFloat(p.volume?.h24) || 0), 0);
    let dexFamilies = new Set();
    for (const p of solPairs) {
      const id = (p.dexId || "").toLowerCase().split("-")[0];
      if (id) dexFamilies.add(id);
    }
    let topPair = solPairs.length
      ? solPairs.slice().sort((a, b) => (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0))[0]
      : null;
    let poolCount = solPairs.length;

    // Quiet pools get dropped from DexScreener's index but still exist on-chain — recover
    // numbers from GeckoTerminal so a quiet token isn't reported as dead.
    let vitalsSource = "dexscreener";
    if (totalLiqUsd === 0) {
      const gecko = await fetchGeckoTerminalFallback(mint);
      if (gecko) {
        vitalsSource = "geckoterminal";
        totalLiqUsd = gecko.totalLiqUsd;
        totalVol24h = gecko.totalVol24h;
        dexFamilies = gecko.dexFamilies;
        poolCount = gecko.poolCount;
        topPair = {
          priceUsd: gecko.priceUsd, fdv: gecko.fdv, marketCap: gecko.fdv, dexId: gecko.dexId,
          labels: [], pairAddress: gecko.pairAddress,
          baseToken: { symbol: gecko.symbol, name: gecko.name },
        };
      }
    }
    // Solana Tracker correction for on-curve launchpad tokens: DexScreener reports a phantom
    // near-zero pool that bypasses the $0 Gecko fallback. ST reads the curve reserve directly.
    // Only call it when liquidity looks phantom/thin (real DEX liquidity = graduated, no fix needed).
    let onBondingCurve = false, curvePctToGrad = null;
    if (totalLiqUsd < 5000) {
      try {
        const stm = await solanaTracker.getTokenMarketStatus(mint);
        if (stm) {
          onBondingCurve = stm.onBondingCurve === true;
          curvePctToGrad = stm.curvePercentage;
          if (stm.liquidityUsd != null && stm.liquidityUsd > totalLiqUsd) {
            totalLiqUsd = stm.liquidityUsd;
            vitalsSource = vitalsSource === "dexscreener" ? "solana-tracker" : vitalsSource + "+st";
            if (poolCount === 0) poolCount = 1;
          }
        }
      } catch (_) { /* degrade — keep DexScreener/Gecko numbers */ }
    }

    const rawSupply = supplyData.status === "fulfilled" ? supplyData.value?.result?.value?.amount : null;
    const decimals = supplyData.status === "fulfilled" ? (supplyData.value?.result?.value?.decimals || 9) : 9;
    const supplyTokens = rawSupply ? parseInt(rawSupply) / Math.pow(10, decimals) : null;
    const mintParsed = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.data?.parsed?.info : null;
    const mintAuthority = mintParsed ? mintParsed.mintAuthority : undefined;   // null = revoked, string = active
    const freezeAuthority = mintParsed ? mintParsed.freezeAuthority : undefined;

    // Token-2022 honeypot scan — read straight off the mint account already fetched (no extra RPC).
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
    // Classify top-20 token accounts to ACTUAL HUMAN HOLDERS (System-Program-owned), filtering
    // out LP/lock/vesting/AMM PDAs so concentration reflects humans, not the token's own pool.
    const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
    let top10HumanShare = null, top10RawShare = null, humanTop10Holdings = [], lpInTop20 = 0;
    if (largestRaw.length && supplyTokens) {
      const rawSum = largestRaw.slice(0, 10).reduce((s, a) => s + (parseFloat(a.uiAmount) || 0), 0);
      top10RawShare = supplyTokens > 0 ? rawSum / supplyTokens : null;
      try {
        const tokenAccountInfos = await rpcCall("tv-tacc-owners", "getMultipleAccounts", [
          largestRaw.map(a => a.address), { encoding: "jsonParsed" }
        ]);
        const taccValues = tokenAccountInfos?.result?.value || [];
        const enriched = largestRaw.map((a, i) => ({
          tokenAccount: a.address,
          uiAmount: parseFloat(a.uiAmount) || 0,
          owner: taccValues[i]?.data?.parsed?.info?.owner || null,
        })).filter(e => e.owner);
        if (enriched.length) {
          const ownerInfos = await rpcCall("tv-owner-class", "getMultipleAccounts", [
            enriched.map(e => e.owner), { encoding: "base64" }
          ]);
          const ownerValues = ownerInfos?.result?.value || [];
          const humans = [];
          enriched.forEach((e, i) => {
            const ownerAcc = ownerValues[i];
            if (ownerAcc && ownerAcc.owner === SYSTEM_PROGRAM_ID) humans.push(e);
            else lpInTop20++;
          });
          humanTop10Holdings = humans.slice(0, 10);
          const humanSum = humanTop10Holdings.reduce((s, e) => s + e.uiAmount, 0);
          top10HumanShare = supplyTokens > 0 ? humanSum / supplyTokens : null;
        }
      } catch (e) {
        console.warn("[token-vitals] Owner classification failed, using raw top-10:", e.message);
      }
    }
    const top10Share = top10HumanShare != null ? top10HumanShare : top10RawShare;

    const liqUsd = totalLiqUsd;
    const fdv = parseFloat(topPair?.fdv || topPair?.marketCap) || (supplyTokens && parseFloat(topPair?.priceUsd) ? supplyTokens * parseFloat(topPair.priceUsd) : null);
    const liqRatio = (fdv && liqUsd) ? liqUsd / fdv : null;
    const vol24h = totalVol24h;
    const dexId = (topPair?.dexId || "").toLowerCase();
    const labels = topPair?.labels || [];
    const graduatedDexIds = ["meteora", "raydium", "orca", "phoenix", "openbook", "lifinity", "pumpswap"];
    const bondingCurveDexIds = ["bags", "pumpfun", "moonshot", "fluxbeam"];
    const isGraduated = !!topPair && (
      graduatedDexIds.some(s => dexId === s || dexId.startsWith(s + "-")) ||
      labels.some(l => /damm|dlmm|clmm|whirlpool|v[23]/i.test(l))
    ) && !bondingCurveDexIds.some(s => dexId.includes(s));

    // Bags + Jupiter context as FACTS (not scored): verified creators, fee-claim activity,
    // Jupiter listing/audit. classifyTeamActivity returns "active"/"stale"/"none"/null.
    const bagsCtx = bagsCtxData.status === "fulfilled" ? bagsCtxData.value : { bagsInfo: null, jupiterInfo: null, projectFeeWallets: [] };
    const teamActivity = classifyTeamActivity(bagsCtx.bagsInfo);
    const isBagsToken = !!(bagsCtx.bagsInfo && bagsCtx.bagsInfo.isBagsToken);
    const isJupVerified = !!(bagsCtx.jupiterInfo && bagsCtx.jupiterInfo.listed && Array.isArray(bagsCtx.jupiterInfo.tags) && bagsCtx.jupiterInfo.tags.some(t => t === "verified"));
    const jupAudit = bagsCtx.jupiterInfo?.audit || null;
    const isPlatformLauncherDev = !!(jupAudit && jupAudit.devMigrations != null && jupAudit.devMigrations > 50);

    return res.status(200).json({
      success: true,
      mint,
      ticker: topPair?.baseToken?.symbol || null,
      name: topPair?.baseToken?.name || null,
      // ⚠️ No score/grade/verdict by design — these are raw on-chain readings, not a safety rating.
      authorities: {
        mint: mintAuthority === null ? "revoked" : (mintAuthority === undefined ? "unknown" : "active"),
        freeze: freezeAuthority === null ? "revoked" : (freezeAuthority === undefined ? "unknown" : "active"),
        mintAuthorityAddress: (mintAuthority && mintAuthority !== undefined) ? mintAuthority : null,
        freezeAuthorityAddress: (freezeAuthority && freezeAuthority !== undefined) ? freezeAuthority : null,
      },
      token2022: {
        isToken2022,
        transferFeeBps,
        hardDangerMechanics: honeypotHardDanger,
        findings: sellWarnings,
      },
      liquidity: {
        totalUsd: liqUsd,
        liqToFdvRatio: liqRatio != null ? Number(liqRatio.toFixed(4)) : null,
        poolCount,
        dexCount: dexFamilies.size,
        dexes: [...dexFamilies],
      },
      volume24hUsd: vol24h,
      holders: {
        count: holderCount,
        capped: holderCountCapped,
        top10Share,
        top10HumanShare,
        top10RawShare,
        humanFiltered: top10HumanShare != null,
        lpFilteredFromTop20: lpInTop20,
        topHolders: humanTop10Holdings.map(h => ({
          owner: h.owner,
          uiAmount: h.uiAmount,
          share: (supplyTokens && supplyTokens > 0) ? h.uiAmount / supplyTokens : null,
        })),
      },
      market: {
        priceUsd: topPair?.priceUsd ? parseFloat(topPair.priceUsd) : null,
        fdv,
        circulatingSupply: supplyTokens,
        decimals,
        pairAddress: topPair?.pairAddress || null,
        source: vitalsSource,
        onBondingCurve,
        curvePctToGrad: curvePctToGrad != null ? Number(curvePctToGrad.toFixed(1)) : null,
        isGraduated,
      },
      bags: {
        isBagsToken,
        teamActivity,
        officialCreators: bagsCtx.bagsInfo?.officialCreators?.map(c => ({
          wallet: c.wallet, username: c.username, provider: c.provider, isAdmin: c.isAdmin, royaltyBps: c.royaltyBps,
        })) || [],
        totalClaimedSol: bagsCtx.bagsInfo?.totalClaimedSol || null,
        claimEventCount: bagsCtx.bagsInfo?.claimEventCount || 0,
        daysSinceLastClaim: bagsCtx.bagsInfo?.lastClaimTimestamp
          ? Math.round((Date.now() - bagsCtx.bagsInfo.lastClaimTimestamp) / 86400000) : null,
      },
      jupiter: {
        listed: !!bagsCtx.jupiterInfo?.listed,
        verified: isJupVerified,
        tags: bagsCtx.jupiterInfo?.tags || [],
        holderCount: bagsCtx.jupiterInfo?.holderCount || null,
        organicScore: bagsCtx.jupiterInfo?.organicScoreLabel || null,
        isPlatformLauncherDev,
        audit: jupAudit ? {
          mintAuthorityDisabled: jupAudit.mintAuthorityDisabled,
          freezeAuthorityDisabled: jupAudit.freezeAuthorityDisabled,
          topHoldersPercentage: jupAudit.topHoldersPercentage,
          devMigrations: jupAudit.devMigrations,
        } : null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Token Vitals error:", err.message);
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
  }
});

app.get("/api/wallet-xray", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const wallet = String(req.query.wallet || "").trim();
  if (!SOL_ADDR_RE.test(wallet)) return res.status(400).json({ success: false, error: "Provide a valid wallet address" });
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Server not configured" });
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const rpc = async (method, params) => {
    const r = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }) });
    return r.json();
  };
  const labelWallet = (a) => KNOWN_CEX_WALLETS[a] || KNOWN_SERVICE_WALLETS[a] || null;

  try {
    // 0. SOL price + current SOL balance (parallel, both best-effort).
    let solUsd = 0, solBalance = 0;
    await Promise.all([
      (async () => { try { const p = await lpScanner.cgPro("/simple/price?ids=solana&vs_currencies=usd"); solUsd = (p && p.solana && p.solana.usd) || 0; } catch {} })(),
      (async () => { try { const b = await rpc("getBalance", [wallet]); solBalance = (b?.result?.value || 0) / 1e9; } catch {} })(),
    ]);

    // 1. Pull the wallet's enhanced transaction history (newest → oldest),
    //    paged, time-budgeted so a hyperactive wallet can't hang the request.
    //    COAL MINER MODE (deep=1): for wallets with more history than the
    //    standard scan reaches, dig far deeper (5,000 txns, ~4-min budget).
    const deep = String(req.query.deep || "") === "1";
    const MAX_PAGES = deep ? 50 : 15, PAGE = 100, DEADLINE = Date.now() + (deep ? 235000 : 55000);
    // Trace the wallet's TRUE origin in parallel (signature-paging to genesis is
    // cheap and independent of the enhanced-history cap) — this is the vital
    // "where did the money first come from" answer, reliable even on deep wallets.
    // Signature-only paging is cheap (~1k sigs/request), so reach for genesis hard —
    // this is what makes the AGE + funding origin honest on years-old wallets.
    const originPromise = wxFindOrigin(wallet, rpcUrl, HELIUS_KEY, labelWallet, {
      maxPages: deep ? 800 : 300, deadline: Date.now() + (deep ? 180000 : 48000),
    }).catch(() => null);
    let before = null; const txs = []; let pages = 0, reachedEnd = false;
    for (; pages < MAX_PAGES; pages++) {
      if (Date.now() > DEADLINE) break;
      const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&limit=${PAGE}` + (before ? `&before=${before}` : "");
      let arr = [];
      try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); arr = await r.json(); } catch { break; }
      if (!Array.isArray(arr) || !arr.length) { reachedEnd = true; break; }
      txs.push(...arr);
      if (arr.length < PAGE) { reachedEnd = true; break; }
      before = arr[arr.length - 1].signature;
    }
    const truncated = !reachedEnd; // history deeper than we scanned (oldest activity not seen)
    if (!txs.length) {
      return res.status(200).json({
        success: true, wallet, generatedAt: new Date().toISOString(),
        empty: true, balances: { solBalance, solUsd, solUsdValue: solBalance * solUsd },
        labels: [{ tag: "No activity", icon: "🫥", level: "info", evidence: "No enhanced transaction history was returned for this wallet." }],
        verdict: "This wallet has no readable on-chain history in the scanned window — brand new, dormant, or it only holds with no transactions.",
      });
    }

    // 2. Walk every tx, accumulating wallet-centric aggregates.
    let minTs = Infinity, maxTs = 0;
    let buyCount = 0, sellCount = 0, swapCount = 0, tokenSendCount = 0, tokenRecvCount = 0;
    let solInCount = 0, solOutCount = 0, lpAdd = 0, lpRemove = 0, nftCount = 0;
    let solSpentBuys = 0, solGainedSells = 0; // rough USD throughput on swaps
    const tokensTraded = new Set();
    const mintStats = new Map();   // mint → behavior record
    const cexFlows = new Map();    // exchange name → {in,out,count}
    const sources = new Map();     // helius source → count
    const sentTo = new Set(), recvFrom = new Set();
    const initiatedTs = [];        // timestamps of wallet-initiated txs (cadence)
    let firstFunding = null;       // earliest external SOL inflow (funding origin)
    const rows = [];               // normalized per-tx timeline (returned for display + AI)
    const dayMap = new Map();      // day bucket → activity counts (for the activity chart)

    for (const tx of txs) {
      if (!tx || !tx.signature) continue;
      const ts = Number(tx.timestamp) || 0;
      if (ts) { if (ts < minTs) minTs = ts; if (ts > maxTs) maxTs = ts; }
      if (tx.feePayer === wallet && ts) initiatedTs.push(ts);
      if (tx.source) sources.set(tx.source, (sources.get(tx.source) || 0) + 1);
      const type = tx.type || "";
      const isDexSrc = WX_DEX_SOURCES.has(tx.source);

      // Native SOL net delta + the external counterparties on each side.
      let solDelta = 0; const extIn = new Set(), extOut = new Set();
      for (const n of tx.nativeTransfers || []) {
        const a = (Number(n.amount) || 0) / 1e9;
        if (n.toUserAccount === wallet) { solDelta += a; if (n.fromUserAccount && n.fromUserAccount !== wallet) extIn.add(n.fromUserAccount); }
        if (n.fromUserAccount === wallet) { solDelta -= a; if (n.toUserAccount && n.toUserAccount !== wallet) extOut.add(n.toUserAccount); }
      }
      // Per-mint token net delta for this wallet.
      const deltas = new Map();
      for (const t of tx.tokenTransfers || []) {
        if (!t.mint) continue;
        const a = Number(t.tokenAmount) || 0;
        if (t.toUserAccount === wallet) { deltas.set(t.mint, (deltas.get(t.mint) || 0) + a); if (t.fromUserAccount && t.fromUserAccount !== wallet) extIn.add(t.fromUserAccount); }
        if (t.fromUserAccount === wallet) { deltas.set(t.mint, (deltas.get(t.mint) || 0) - a); if (t.toUserAccount && t.toUserAccount !== wallet) extOut.add(t.toUserAccount); }
      }
      // Fold wSOL into the SOL leg; pull stables out as quote.
      if (deltas.has(WX_WSOL)) { solDelta += deltas.get(WX_WSOL); deltas.delete(WX_WSOL); }
      let stableDelta = 0;
      for (const s of WX_STABLES) if (deltas.has(s)) { stableDelta += deltas.get(s); deltas.delete(s); }
      const quoteUsd = solDelta * solUsd + stableDelta; // + = wallet received value, − = wallet spent value

      // Known-CEX touch detection (cash-out vs funding signal).
      for (const a of extOut) { const nm = KNOWN_CEX_WALLETS[a]; if (nm) { const e = cexFlows.get(nm) || { in: 0, out: 0, count: 0 }; e.out++; e.count++; cexFlows.set(nm, e); } }
      for (const a of extIn) { const nm = KNOWN_CEX_WALLETS[a]; if (nm) { const e = cexFlows.get(nm) || { in: 0, out: 0, count: 0 }; e.in++; e.count++; cexFlows.set(nm, e); } }
      if (/LIQUIDITY/i.test(type)) { if (/ADD|DEPOSIT|INCREASE/i.test(type)) lpAdd++; else lpRemove++; }
      if (/NFT/i.test(type)) nftCount++;

      const moved = [...deltas.entries()].filter(([, v]) => Math.abs(v) > 1e-9);
      const isSwap = type === "SWAP" || (tx.events && tx.events.swap) || (moved.length > 0 && isDexSrc && Math.abs(quoteUsd) > 0.01);
      if (isSwap) swapCount++;

      for (const [m, v] of moved) {
        tokensTraded.add(m);
        const st = mintStats.get(m) || { mint: m, bought: 0, sold: 0, recv: 0, sent: 0, buyCount: 0, sellCount: 0, firstBuy: null, firstSell: null };
        if (v > 0) {
          if (isSwap || quoteUsd < -0.01) {
            st.bought += v; st.buyCount++; buyCount++; if (quoteUsd < 0) solSpentBuys += -quoteUsd;
            // firstBuy = first real BUY only (a transfer/airdrop IN is NOT a buy).
            if (st.firstBuy == null || (ts && ts < st.firstBuy)) st.firstBuy = ts;
          } else { st.recv += v; tokenRecvCount++; recvFrom.add([...extIn][0] || ""); }
        } else {
          const av = -v;
          if (isSwap || quoteUsd > 0.01) {
            st.sold += av; st.sellCount++; sellCount++; if (quoteUsd > 0) solGainedSells += quoteUsd;
            // firstSell = first real SELL only. A plain transfer OUT to another wallet is NOT a
            // sell and must never count as a flip (you didn't exit — you moved it).
            if (st.firstSell == null || (ts && ts < st.firstSell)) st.firstSell = ts;
          } else { st.sent += av; tokenSendCount++; sentTo.add([...extOut][0] || ""); }
        }
        mintStats.set(m, st);
      }

      // Pure SOL transfers (no token moved) — wallet-to-wallet / CEX moves.
      if (!moved.length) {
        if (solDelta > 0.0005) solInCount++;
        else if (solDelta < -0.0005) solOutCount++;
      }
      // Funding origin: earliest tx where the wallet RECEIVED SOL from an external party.
      if (solDelta > 0 && extIn.size && ts) {
        if (!firstFunding || ts < firstFunding.ts) {
          const src = [...extIn][0];
          firstFunding = { ts, amountSol: solDelta, from: src, label: labelWallet(src), sig: tx.signature };
        }
      }

      // Normalized timeline row — one per tx that did something we can name.
      let action = "other";
      if (/LIQUIDITY/i.test(type)) action = /ADD|DEPOSIT|INCREASE/i.test(type) ? "lp_add" : "lp_remove";
      else if (isSwap && moved.length) action = quoteUsd < -0.01 ? "buy" : quoteUsd > 0.01 ? "sell" : (moved.some(([, v]) => v > 0) ? "buy" : "sell");
      else if (moved.length) {
        const anyIn = moved.some(([, v]) => v > 0), anyOut = moved.some(([, v]) => v < 0);
        action = anyOut && !anyIn ? "send" : anyIn && !anyOut ? "receive" : "swap";
      } else if (solDelta > 0.0005) action = "sol_in";
      else if (solDelta < -0.0005) action = "sol_out";

      // Primary external counterparty for the row.
      let cp = null, cpLabel = null;
      if (action === "send" || action === "sol_out") cp = [...extOut][0] || null;
      else if (action === "receive" || action === "sol_in") cp = [...extIn][0] || null;
      else cp = [...extOut][0] || [...extIn][0] || null;
      cpLabel = (action === "buy" || action === "sell" || action === "swap" || action === "lp_add" || action === "lp_remove")
        ? (tx.source ? String(tx.source).replace(/_/g, " ") : null)
        : (cp ? labelWallet(cp) : null);

      if (action !== "other" || moved.length) {
        rows.push({
          signature: tx.signature, ts, type, source: tx.source || null, action,
          solDelta: Number(solDelta.toFixed(6)), quoteUsd: Number(quoteUsd.toFixed(2)),
          tokens: moved.map(([m, v]) => ({ mint: m, delta: v })),
          counterparty: cp, counterpartyLabel: cpLabel,
          fee: Number(((tx.fee || 0) / 1e9).toFixed(6)),
          description: String(tx.description || "").slice(0, 280),
        });
      }
      if (ts) {
        const day = Math.floor(ts / 86400);
        const e = dayMap.get(day) || { day, count: 0, buys: 0, sells: 0, in: 0, out: 0 };
        e.count++;
        if (action === "buy") e.buys++; else if (action === "sell") e.sells++;
        else if (action === "receive" || action === "sol_in") e.in++; else if (action === "send" || action === "sol_out") e.out++;
        dayMap.set(day, e);
      }
    }

    // 3. Current token holdings (for "still holds" + portfolio value).
    const heldByMint = new Map();
    for (const prog of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
      try {
        const d = await rpc("getTokenAccountsByOwner", [wallet, { programId: prog }, { encoding: "jsonParsed" }]);
        for (const acc of (d?.result?.value || [])) {
          const info = acc.account?.data?.parsed?.info;
          const amt = info?.tokenAmount?.uiAmount || 0;
          if (info?.mint && amt > 0) heldByMint.set(info.mint, (heldByMint.get(info.mint) || 0) + amt);
        }
      } catch {}
    }

    // 4. Derived metrics.
    const totalTx = txs.length;
    const spanSec = (maxTs && minTs !== Infinity) ? (maxTs - minTs) : 0;
    const spanDays = spanSec / 86400;
    const nowDays = (Date.now() / 1000 - (minTs === Infinity ? Date.now() / 1000 : minTs)) / 86400;
    const txPerDay = spanDays > 0.04 ? totalTx / spanDays : totalTx; // <1h span → just use count
    const distinctTokens = tokensTraded.size;
    const sellBuyRatio = sellCount / Math.max(1, buyCount);

    // Cadence (bot tell): gaps between consecutive wallet-initiated txs.
    initiatedTs.sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < initiatedTs.length; i++) gaps.push(initiatedTs[i] - initiatedTs[i - 1]);
    const medianGapSec = wxMedian(gaps);
    const fastGapFrac = gaps.length ? gaps.filter((g) => g <= 2).length / gaps.length : 0;
    const minuteBuckets = new Map();
    for (const t of initiatedTs) { const k = Math.floor(t / 60); minuteBuckets.set(k, (minuteBuckets.get(k) || 0) + 1); }
    const maxPerMinute = minuteBuckets.size ? Math.max(...minuteBuckets.values()) : 0;

    // Flip speed (dumper tell): a flip is BOUGHT then SOLD — hold = firstSell − firstBuy.
    // Tokens that were only transferred out (not sold) are NOT flips and don't count here.
    const holds = [];
    let fastFlipCount = 0, recvThenSold = 0;
    for (const st of mintStats.values()) {
      if (st.firstBuy && st.firstSell && st.firstSell >= st.firstBuy) {
        const h = st.firstSell - st.firstBuy; holds.push(h);
        if (h < 3600) fastFlipCount++;
      }
      if (st.recv > 0 && st.sold > 0) recvThenSold++;
    }
    const medianHoldSec = wxMedian(holds);
    const flipFrac = holds.length ? fastFlipCount / holds.length : 0;

    // 5. Top tokens by activity, enriched with symbol + held value.
    const byActivity = [...mintStats.values()].sort((a, b) => (b.bought + b.sold + b.recv + b.sent) - (a.bought + a.sold + a.recv + a.sent));
    const topMints = byActivity.slice(0, 20);
    // Price the most-active mints (for token cards AND timeline symbols) + everything held.
    const priceInfo = await priceTokensBatch([...new Set([...byActivity.slice(0, 90).map((t) => t.mint), ...heldByMint.keys()])].slice(0, 100)).catch(() => ({}));
    let portfolioUsd = 0;
    for (const [m, amt] of heldByMint) { const p = priceInfo[m]; if (p && p.priceUsd) portfolioUsd += amt * p.priceUsd; }
    const topTokens = topMints.map((t) => {
      const held = heldByMint.get(t.mint) || 0;
      const p = priceInfo[t.mint] || {};
      let cls;
      if (held > 0 && t.sellCount === 0 && t.buyCount > 0) cls = "holding";
      else if (t.firstBuy && t.firstSell && (t.firstSell - t.firstBuy) < 3600) cls = "fast flip";
      else if (t.recv > 0 && t.sold > 0) cls = "received & sold";
      else if (t.sold > t.bought * 1.2 && t.sold > 0) cls = "net seller";
      else if (t.sent > 0 && t.sellCount === 0 && t.buyCount === 0) cls = "transferred out";
      else if (t.buyCount > 0 || t.sellCount > 0) cls = "traded";
      else cls = "moved";
      return {
        mint: t.mint, symbol: p.symbol || null, name: p.name || null, logo: p.logo || null,
        bought: t.bought, sold: t.sold, recv: t.recv, sent: t.sent,
        buyCount: t.buyCount, sellCount: t.sellCount,
        held, heldUsd: held * (p.priceUsd || 0), classification: cls,
      };
    });

    // 5b. Enrich the timeline rows with token symbols + a best-effort USD value.
    for (const r of rows) {
      let usd = 0;
      if (r.action === "buy" || r.action === "sell") usd = Math.abs(r.quoteUsd);
      else if (r.action === "sol_in" || r.action === "sol_out") usd = Math.abs(r.solDelta) * solUsd;
      for (const tc of r.tokens) {
        const p = priceInfo[tc.mint];
        if (p) { tc.symbol = p.symbol || null; tc.logo = p.logo || null; }
        if (!usd && p && p.priceUsd) usd += Math.abs(tc.delta) * p.priceUsd;
      }
      r.usd = Number(usd.toFixed(2));
    }
    // 5c. Chart series: daily activity (oldest→newest) + hold-time distribution.
    const daily = [...dayMap.values()].sort((a, b) => a.day - b.day).map((e) => ({ ts: e.day * 86400, count: e.count, buys: e.buys, sells: e.sells, in: e.in, out: e.out }));
    const HB = [{ lbl: "<1m", max: 60 }, { lbl: "1–10m", max: 600 }, { lbl: "10–60m", max: 3600 }, { lbl: "1–6h", max: 21600 }, { lbl: "6–24h", max: 86400 }, { lbl: "1–7d", max: 604800 }, { lbl: ">7d", max: Infinity }];
    const holdBuckets = HB.map((b) => ({ label: b.lbl, count: 0 }));
    for (const h of holds) { const i = HB.findIndex((b) => h < b.max); if (i >= 0) holdBuckets[i].count++; }
    const actionBreakdown = {};
    for (const r of rows) actionBreakdown[r.action] = (actionBreakdown[r.action] || 0) + 1;

    // 5d. Resolve the true wallet origin (paged in parallel) and unify the funding read.
    const origin = await originPromise;
    let funding = null;
    if (origin && origin.funder) {
      funding = {
        ts: origin.fundingTs || origin.firstTs, amountSol: origin.amountSol, from: origin.funder,
        label: origin.funderLabel, sig: origin.fundingSig || origin.firstSig, kind: origin.kind,
        exact: origin.reachedGenesis, reachedGenesis: origin.reachedGenesis, lifetimeTx: origin.lifetimeTx,
        firstTs: origin.firstTs, firstSig: origin.firstSig, dustFirst: origin.dustFirst,
      };
    } else if (firstFunding) {
      funding = { ...firstFunding, kind: "SOL", exact: false, reachedGenesis: false, firstTs: firstFunding.ts, dustFirst: false };
    }

    // 6. CEX net direction.
    const cex = [...cexFlows.entries()].map(([name, e]) => ({ name, ...e, net: e.out - e.in })).sort((a, b) => b.count - a.count);
    const netCexOut = cex.reduce((s, c) => s + (c.out - c.in), 0);
    const cexNames = [...new Set(cex.map((c) => c.name))];

    // 7. Behavioral labels — each is on-chain EVIDENCE, not a claim of intent.
    const labels = [];
    const isFresh = totalTx < 12 && distinctTokens < 4;
    const veryHighFreq = txPerDay >= 120 || maxPerMinute >= 18 || fastGapFrac >= 0.32;
    const highFreq = txPerDay >= 40 || maxPerMinute >= 8 || fastGapFrac >= 0.16;
    const dumpHeavy = sellBuyRatio >= 1.6 && sellCount >= 5;
    const fastFlipper = flipFrac >= 0.4 && fastFlipCount >= 4;
    const farmDump = recvThenSold >= 4;
    const holder = buyCount >= 3 && sellCount <= Math.max(1, buyCount * 0.25) && (portfolioUsd > 0 || heldByMint.size > 0);
    const whale = solBalance >= 200 || portfolioUsd >= 50000;
    const cashingOut = netCexOut >= 2;
    const cexFunded = cex.some((c) => c.in > 0) && (firstFunding && firstFunding.label);
    const lpProvider = (lpAdd + lpRemove) >= 3;
    const trader = distinctTokens >= 8 && swapCount >= 10 && !veryHighFreq;

    if (isFresh) labels.push({ tag: "Fresh / low activity", icon: "🆕", level: "info", evidence: `Only ${totalTx} txns across ${distinctTokens} token${distinctTokens === 1 ? "" : "s"} in the scanned window.` });
    if (veryHighFreq) labels.push({ tag: "Bot-like cadence", icon: "🤖", level: "high", evidence: `~${Math.round(txPerDay)} txns/day, up to ${maxPerMinute} in one minute, ${(fastGapFrac * 100).toFixed(0)}% of txns fire ≤2s apart — automated trading cadence.` });
    else if (highFreq) labels.push({ tag: "High-frequency", icon: "⚙️", level: "med", evidence: `~${Math.round(txPerDay)} txns/day (median ${wxDur(medianGapSec)} between txns) — far above a manual trader.` });
    if (fastFlipper) labels.push({ tag: "Fast flipper", icon: "⚡", level: "high", evidence: `${fastFlipCount} token${fastFlipCount === 1 ? "" : "s"} sold within an hour of buying (median hold ${wxDur(medianHoldSec)}).` });
    if (dumpHeavy) labels.push({ tag: "Sell-heavy / dumper", icon: "📉", level: "high", evidence: `${sellCount} sells vs ${buyCount} buys (${sellBuyRatio.toFixed(1)}× sell:buy) — exits far more than it accumulates.` });
    if (farmDump) labels.push({ tag: "Receives & dumps", icon: "🪂", level: "med", evidence: `${recvThenSold} tokens were received by transfer/airdrop and then sold — airdrop-farm / distribution-then-sell pattern.` });
    if (cashingOut) labels.push({ tag: "Cashing out to CEX", icon: "🏦", level: "med", evidence: `Net ${netCexOut} more deposits to ${cexNames.join(", ")} than withdrawals — funds flowing toward an exchange off-ramp.` });
    if (lpProvider) labels.push({ tag: "Liquidity provider", icon: "💧", level: "info", evidence: `${lpAdd} add-LP and ${lpRemove} remove-LP actions — runs liquidity positions.` });
    if (holder) labels.push({ tag: "Accumulator / holder", icon: "💎", level: "info", evidence: `${buyCount} buys vs only ${sellCount} sells, still holding ${heldByMint.size} token${heldByMint.size === 1 ? "" : "s"}${portfolioUsd > 0 ? ` (~${fmtUsdShort(portfolioUsd)})` : ""}.` });
    if (whale) labels.push({ tag: "Whale-sized", icon: "🐋", level: "info", evidence: `Holds ${solBalance.toFixed(1)} SOL${portfolioUsd > 0 ? ` + ~${fmtUsdShort(portfolioUsd)} in tokens` : ""}.` });
    if (trader && !labels.some((l) => l.level === "high")) labels.push({ tag: "Active trader", icon: "🎯", level: "info", evidence: `${swapCount} swaps across ${distinctTokens} tokens — a busy but human-paced trader.` });
    if (!labels.length) labels.push({ tag: "Ordinary activity", icon: "👤", level: "info", evidence: `${totalTx} txns, ${buyCount} buys / ${sellCount} sells across ${distinctTokens} tokens — no standout bot or dumping pattern.` });

    // 8. Plain-English read (deterministic, evidence-only).
    const verdictBits = [];
    if (funding) {
      const whoFrom = funding.label ? `from ${funding.label}` : "from another wallet";
      const genNote = funding.exact ? " (traced to genesis)" : " (oldest reached — couldn't page fully to genesis)";
      if (funding.kind === "SOL" && funding.amountSol > 0) verdictBits.push(`First funded with ~${funding.amountSol.toFixed(2)} SOL ${whoFrom}${genNote}.`);
      else verdictBits.push(`First funding ${whoFrom}${genNote}.`);
      if (funding.dustFirst) verdictBits.push(`Its first on-chain appearance was an unsolicited token transfer — likely dust/spam, not the funding source.`);
    }
    verdictBits.push(`Across ${totalTx} scanned txns it made ${buyCount} buys and ${sellCount} sells over ${distinctTokens} tokens, sent ${tokenSendCount} token transfers out and received ${tokenRecvCount}.`);
    const headline = labels.filter((l) => l.level === "high").map((l) => l.tag);
    if (headline.length) verdictBits.push(`Strongest signals: ${headline.join(" + ")}.`);
    const verdict = verdictBits.join(" ");

    return res.status(200).json({
      success: true, wallet, generatedAt: new Date().toISOString(), truncated, mode: deep ? "coalminer" : "xray",
      scanned: { txCount: totalTx, pages, truncated, deep, spanDays: Number(spanDays.toFixed(2)), firstSeen: minTs === Infinity ? null : minTs, lastSeen: maxTs || null, ageDays: Number(nowDays.toFixed(1)), lifetimeTx: origin ? origin.lifetimeTx : null, reachedGenesis: origin ? origin.reachedGenesis : false },
      balances: { solBalance, solUsd, solUsdValue: solBalance * solUsd, tokenCount: heldByMint.size, portfolioUsd },
      funding,
      activity: { buyCount, sellCount, swapCount, tokenSendCount, tokenRecvCount, solInCount, solOutCount, distinctTokens, txPerDay: Number(txPerDay.toFixed(1)), lpAdd, lpRemove, nftCount, sellBuyRatio: Number(sellBuyRatio.toFixed(2)) },
      cadence: { medianGapSec: Math.round(medianGapSec), fastGapFrac: Number(fastGapFrac.toFixed(3)), maxPerMinute },
      flips: { medianHoldSec: Math.round(medianHoldSec), fastFlipCount, flipFrac: Number(flipFrac.toFixed(3)), recvThenSold },
      cex, topSources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      topTokens, labels, verdict,
      charts: { daily, holdBuckets, actionBreakdown },
      transactions: rows.slice(0, deep ? 2500 : 800), txReturned: Math.min(rows.length, deep ? 2500 : 800), txTotal: rows.length,
      disclaimer: "These are on-chain behavioral patterns, not statements of intent. The same pattern can come from a bot, a fund, a market maker, or a person — use this as a research lead, not a verdict.",
    });
  } catch (err) {
    console.error("[wallet-xray] error:", err.message);
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
  }
});

// Ask Cluck about a wallet or a SPECIFIC transaction — conversational forensic
// helper. The client passes the lightweight wallet profile it already rendered
// (display context only); when a signature is given we RE-FETCH that one tx from
// Helius server-side so the explanation is grounded in real on-chain data, not
// just what the client claims. Cheap (1 enhanced-tx call), accurate, and keeps
// the forensic rule intact: explain WHAT happened, never assert WHY.
app.use("/api/wallet-xray/ask", rateLimit("xrayask", { windowMs: 60000, max: 20 }));
app.post("/api/wallet-xray/ask", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ success: false, error: "Cluck is offline (AI not configured)" });
  const { wallet, question, signature, profile, history } = req.body || {};
  const w = String(wallet || "").trim();
  const q = String(question || "").slice(0, 600);
  if (!q) return res.status(400).json({ success: false, error: "Ask a question" });
  const hist = Array.isArray(history) ? history.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) })) : [];

  // Ground the answer: if a signature is given, fetch + describe that exact tx.
  let txContext = "";
  const sig = String(signature || "").trim();
  if (sig && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) {
    const HELIUS_KEY = process.env.HELIUS_API_KEY;
    if (HELIUS_KEY) {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: [sig] }), signal: AbortSignal.timeout(12000),
        });
        const arr = await r.json();
        const tx = Array.isArray(arr) && arr[0];
        if (tx) {
          const lines = [];
          lines.push(`Signature: ${tx.signature}`);
          if (tx.timestamp) lines.push(`When: ${new Date(tx.timestamp * 1000).toISOString()}`);
          lines.push(`Type: ${tx.type || "?"} · Source: ${tx.source || "?"} · Fee payer: ${tx.feePayer || "?"}`);
          if (tx.description) lines.push(`Helius description: ${tx.description}`);
          const tt = (tx.tokenTransfers || []).slice(0, 24).map((t) => `  ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${t.tokenAmount} of ${t.mint}`);
          if (tt.length) lines.push("Token transfers:\n" + tt.join("\n"));
          const nt = (tx.nativeTransfers || []).slice(0, 16).map((n) => `  ${n.fromUserAccount || "?"} → ${n.toUserAccount || "?"}: ${(Number(n.amount) || 0) / 1e9} SOL`);
          if (nt.length) lines.push("Native SOL transfers:\n" + nt.join("\n"));
          if (tx.events && tx.events.swap) lines.push(`Swap event present (DEX trade).`);
          txContext = `\n\nTHE SPECIFIC TRANSACTION THE USER IS ASKING ABOUT (real on-chain data, fetched just now — this is your source of truth for THIS tx):\n${lines.join("\n")}\nThe wallet under investigation is ${w}. Interpret every transfer relative to THAT wallet (into it = received/bought; out of it = sent/sold).`;
        }
      } catch (_) { /* fall back to profile-only context */ }
    }
  }

  // Lightweight wallet profile from the client (display context only — capped).
  let profCtx = "";
  try { if (profile) profCtx = "\n\nTHE WALLET'S PROFILE (from the X-Ray report on screen):\n" + JSON.stringify(profile).slice(0, 4000); } catch (_) {}

  const system = `You are Cluck Norris — a sharp, plain-spoken Solana on-chain forensic analyst with a wry chicken-themed wit. The user is investigating a Solana wallet with the Wallet X-Ray tool and is asking you to make sense of it${sig ? ", specifically about one transaction" : ""}.

Wallet under investigation: ${w || "(unknown)"}${profCtx}${txContext}

HOW YOU ANSWER:
- Be concrete and use the real data above. Translate raw transfers into plain English ("this wallet swapped 12 SOL for ~4M BONK on Jupiter", "received 50K tokens from another wallet, then sold them 3 minutes later").
- THE GOLDEN RULE: state WHAT the chain shows, NEVER assert WHY (intent). Say "this pattern is consistent with…" not "this person is a scammer". The chain shows what, not why.
- Point out what's notable for an investigator: funding source, fast flips, transfers to/from exchanges, bot-like timing, accumulation vs distribution — but always as on-chain evidence, not a verdict.
- If asked something the data can't answer, say so and suggest what to check (Solscan, the token's autopsy, tracing a counterparty).
- Keep it tight: 2–6 sentences usually. No markdown headers or asterisks. No financial advice or price predictions.`;

  try {
    const messages = [...hist, { role: "user", content: q }];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 700, system, messages }),
    });
    const data = await r.json();
    if (data && data.content && data.content[0]) {
      const reply = data.content[0].text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s/gm, "").trim();
      return res.status(200).json({ success: true, reply });
    }
    return res.status(500).json({ success: false, error: (data && data.error && data.error.message) || "Cluck went quiet — try again." });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

// Shareable LP Pair Scanner card — the top pool for a pair, its real fee yield, and (if a
// deposit was given) the estimated $/day. Built for X/Telegram virality + brand reach.
async function renderLpCard(scan) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, H);
  const a1 = ctx.createRadialGradient(220, 120, 0, 220, 120, 600);
  a1.addColorStop(0, "rgba(217,119,6,0.20)"); a1.addColorStop(1, "rgba(217,119,6,0)");
  ctx.fillStyle = a1; ctx.fillRect(0, 0, W, H);
  const a2 = ctx.createRadialGradient(1000, 580, 0, 1000, 580, 480);
  a2.addColorStop(0, "rgba(16,185,129,0.12)"); a2.addColorStop(1, "rgba(16,185,129,0)");
  ctx.fillStyle = a2; ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#D97706"; ctx.font = "900 22px Oswald, sans-serif";
  ctx.fillText("🔬 LP PAIR SCANNER", 60, 50);
  ctx.fillStyle = "#6B7280"; ctx.font = "16px Oswald, sans-serif";
  ctx.fillText("School of Crypto Hard Knocks", 60, 82);

  // Round logo, top-right
  const logo = await getLogo();
  if (logo) {
    const r = 46, lx = W - 60 - r * 2, ly = 46;
    ctx.save(); ctx.beginPath(); ctx.arc(lx + r, ly + r, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(logo, lx, ly, r * 2, r * 2); ctx.restore();
    ctx.strokeStyle = "#D97706"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(lx + r, ly + r, r, 0, Math.PI * 2); ctx.stroke();
  }

  // Pair title
  ctx.fillStyle = "#F9FAFB"; ctx.font = "900 64px Oswald, sans-serif";
  ctx.fillText(String(scan.pair || ""), 60, 150);

  const pools = (scan.pools || []).filter((p) => p.feeTier != null);
  const best = pools[0];
  if (best) {
    // Headline: best fee yield
    const yld = best.feeYield7dPctDay != null ? best.feeYield7dPctDay : best.feeYieldPctDay;
    ctx.fillStyle = "#6B7280"; ctx.font = "900 18px Oswald, sans-serif";
    ctx.fillText("TOP FEE YIELD — " + String(best.dex || "").toUpperCase() + " · " + best.feeTier + "% FEE", 60, 248);
    ctx.font = "900 130px Oswald, sans-serif";
    const g = ctx.createLinearGradient(60, 280, 520, 420);
    g.addColorStop(0, "#6EE7B7"); g.addColorStop(1, "#10B981");
    ctx.fillStyle = g;
    const yText = (yld != null ? yld : "—") + "%";
    ctx.fillText(yText, 60, 278);
    const yw = ctx.measureText(yText).width;
    ctx.fillStyle = "#6B7280"; ctx.font = "300 30px Oswald, sans-serif";
    ctx.fillText("/ day", 60 + yw + 18, 372);

    // Est $/day chip (if a deposit was given)
    if (best.estDailyUsd != null && scan.amountUsd) {
      const cx = 720, cy = 270, cw = 420, ch = 150;
      ctx.fillStyle = "rgba(217,119,6,0.10)"; ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = "rgba(217,119,6,0.5)"; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, cw, ch);
      ctx.fillStyle = "#9CA3AF"; ctx.font = "900 16px Oswald, sans-serif";
      ctx.fillText("EST. ON $" + Number(scan.amountUsd).toLocaleString(), cx + 24, cy + 22);
      ctx.fillStyle = "#FCD34D"; ctx.font = "900 72px Oswald, sans-serif";
      ctx.fillText("$" + best.estDailyUsd, cx + 24, cy + 50);
      ctx.fillStyle = "#6B7280"; ctx.font = "300 22px Oswald, sans-serif";
      const dw = ctx.measureText("$" + best.estDailyUsd).width;
      ctx.fillText("/ day", cx + 24 + dw + 12, cy + 96);
    }

    // Mini ranking of the next pools
    let ry = 452;
    ctx.font = "900 15px Oswald, sans-serif"; ctx.fillStyle = "#6B7280";
    ctx.fillText(pools.length + " POOLS WITH READ FEES · RANKED BY YIELD", 60, ry); ry += 26;
    ctx.font = "18px Oswald, sans-serif";
    for (const p of pools.slice(0, 3)) {
      const py = p.feeYield7dPctDay != null ? p.feeYield7dPctDay : p.feeYieldPctDay;
      ctx.fillStyle = "#D1D5DB";
      ctx.fillText("• " + String(p.dex || "").toUpperCase(), 60, ry);
      ctx.fillStyle = "#6EE7B7";
      ctx.fillText((py != null ? py + "%/day" : "—"), 300, ry);
      ctx.fillStyle = "#6B7280";
      ctx.fillText("TVL $" + Math.round((p.tvlUsd || 0) / 1000) + "K", 470, ry);
      ry += 26;
    }
  } else {
    ctx.fillStyle = "#9CA3AF"; ctx.font = "30px Oswald, sans-serif";
    ctx.fillText("No pools with on-chain fee data yet for this pair.", 60, 300);
  }

  // IL risk badge (bottom-right)
  const il = scan.ilRisk || {};
  const ilColors = { minimal: "#6EE7B7", low: "#93C5FD", moderate: "#FCD34D", high: "#FCA5A5" };
  if (il.level) {
    ctx.fillStyle = ilColors[il.level] || "#6B7280";
    ctx.font = "900 18px Oswald, sans-serif";
    const t = "IL RISK: " + il.level.toUpperCase();
    const tw = ctx.measureText(t).width;
    ctx.fillText(t, W - 60 - tw, 560);
  }

  ctx.fillStyle = "#D97706"; ctx.font = "900 18px Oswald, sans-serif";
  ctx.fillText("clucknorris.app/lp-scanner", 60, 580);
  ctx.fillStyle = "#6B7280"; ctx.font = "14px Oswald, sans-serif";
  ctx.fillText("every pool · every dex · real yield · not financial advice", 60, 604);

  return canvas.toBuffer("image/png");
}

app.get("/api/lp-card", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const A = req.query.a || req.query.tokenA, B = req.query.b || req.query.tokenB;
  if (!A || !B) return res.status(400).json({ success: false, error: "pass ?a=<token>&b=<token>, optional &amount=<usd>" });
  try {
    const scan = await lpScanner.scanPair(String(A), String(B), { amountUsd: Number(req.query.amount) || 0 });
    const png = await renderLpCard(scan);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", png.length);
    return res.end(png);
  } catch (err) {
    console.error("LP card render error:", err.message);
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
  }
});

// Cluck Norris round logo, loaded once and reused across card renders.
let _logoPromise = null;
function getLogo() {
  if (!_logoPromise) _logoPromise = loadImage(join(__dirname, "public", "cluck-norris-logo.jpg")).catch(() => null);
  return _logoPromise;
}

// -- Transcript share card (1200x630 PNG) — canvas rig --
// No emoji in canvas (the bundled Oswald has none); text labels only.
// Cluck's diploma line — uplifting, but with the schoolyard edge. Tier-based off the record.
function cluckDiplomaMessage(rec) {
  const d = rec.diploma && rec.diploma.passed ? rec.diploma : null;
  const grad = !!(rec.graduation && rec.graduation.completed);
  const pct = d ? (d.pct || 0) : 0;
  if (d && pct >= 95) return "Sharp work. Don't get cocky — the market humbles everyone.";
  if (d) return "You made it through. Barely impressive. Now go prove it.";
  if (grad) return "You finished what most quit. Respect — now stay hungry.";
  return "You showed up. That's a start. The schoolyard's still waiting.";
}

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
    const LS = 168, lx = W - 60 - LS, ly = 40, cx = lx + LS / 2, cy = ly + LS / 2, r = LS / 2;
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

  // Cluck's line — uplifting with a bite (sits between the wallet and the score rows).
  ctx.fillStyle = "#D4AF37"; ctx.font = "22px Oswald, sans-serif";
  ctx.fillText('"' + cluckDiplomaMessage(rec) + '" - Cluck', 60, 256);

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

// Diploma NFT metadata (Metaplex JSON standard) — served as each diploma cNFT's URI.
// Art = the personalized credential card; only graduates get minted, so it's graduation-framed.
app.get("/api/diploma-metadata/:slug", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const rec = credentials.getBySlug(String(req.params.slug || ""));
  if (!rec) return res.status(404).json({ error: "not_found" });
  const origin = CANONICAL_ORIGIN;
  const img = `${origin}/api/credential-card?slug=${encodeURIComponent(rec.slug)}`;
  const dip = rec.diploma && rec.diploma.passed ? rec.diploma : null;
  const attrs = [
    { trait_type: "Credential", value: "School Graduate" },
    { trait_type: "Curriculum", value: "12 / 12 lessons" },
  ];
  if (dip) attrs.push({ trait_type: "Ultimate Challenge", value: (dip.pct || 0) + "%" });
  if (rec.holder) attrs.push({ trait_type: "CLKN Holder", value: rec.holder.isHolder ? "Yes" : "No" });
  attrs.push({ trait_type: "Graduated", value: ((rec.graduation && rec.graduation.at) || rec.createdAt || "").slice(0, 10) });
  return res.status(200).json({
    name: "Cluck Norris Diploma",
    symbol: "CLKNDIP",
    description: "Proof of graduation from the School of Crypto Hard Knocks (clucknorris.app) — a free Solana crypto school. Earned by completing the full 12-lesson curriculum. Earned, not bought. 🐔",
    image: img,
    external_url: `${origin}/transcript/${encodeURIComponent(rec.slug)}`,
    attributes: attrs,
    properties: { category: "image", files: [{ uri: img, type: "image/png" }] },
  });
});

// Collection-level metadata for the "Cluck Norris Diplomas" set (the collection NFT's URI).
// Logo as the collection art (per owner: logo = collection, personalized card = each diploma).
app.get("/api/diploma-collection", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  const img = `${CANONICAL_ORIGIN}/cluck-norris-logo.jpg`;
  return res.status(200).json({
    name: "Cluck Norris Diplomas",
    symbol: "CLKNDIP",
    description: "On-chain graduation diplomas from the School of Crypto Hard Knocks (clucknorris.app) — a free Solana crypto school. Earned by completing the full 12-lesson curriculum. Free to learn, yours to own. 🐔",
    image: img,
    external_url: "https://clucknorris.app",
    properties: { category: "image", files: [{ uri: img, type: "image/jpeg" }] },
  });
});

// Diploma NFT admin (gated, 404 without key). ?action=status | create-tree | create-collection | test | backfill.
// Mutating actions need &run=1. create-tree is one-time (~0.3 SOL); backfill mints to every
// graduate who left a wallet (idempotent — won't double-mint).
app.get("/api/diploma-mint", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!adminAuthOK(req)) return res.status(404).json({ error: "not_found" });
  const action = String(req.query.action || "status");
  try {
    if (action === "status") return res.status(200).json({ success: true, ...diplomaNft.status() });
    if (action === "create-tree") {
      if (req.query.run !== "1") return res.status(200).json({ success: true, dryRun: true, hint: "add &run=1 to create the shared tree (~0.3 SOL, one-time)" });
      return res.status(200).json({ success: true, tree: await diplomaNft.ensureTree() });
    }
    if (action === "create-collection") {
      if (req.query.run !== "1") return res.status(200).json({ success: true, dryRun: true, hint: "add &run=1 to create the verified collection NFT (~0.01 SOL, one-time)" });
      return res.status(200).json({ success: true, collection: await diplomaNft.ensureCollection() });
    }
    if (action === "test") {
      const wallet = String(req.query.wallet || "");
      if (!SOL_ADDR_RE.test(wallet)) return res.status(400).json({ success: false, error: "valid &wallet= required" });
      if (req.query.run !== "1") return res.status(200).json({ success: true, dryRun: true, wallet });
      return res.status(200).json(await diplomaNft.mintDiploma(wallet, String(req.query.slug || "test"), { force: req.query.force === "1" }));
    }
    if (action === "backfill") {
      const eligible = credentials.all().filter(r => r.graduation && r.graduation.completed && SOL_ADDR_RE.test(r.wallet || ""));
      if (req.query.run !== "1") return res.status(200).json({ success: true, dryRun: true, eligible: eligible.length });
      const results = [];
      for (const rec of eligible) {
        try { const r = await diplomaNft.mintDiploma(rec.wallet, rec.slug); results.push({ wallet: rec.wallet.slice(0, 6) + "…", ok: r.ok, already: !!r.already, sig: r.sig || null, reason: r.reason || null }); }
        catch (e) { results.push({ wallet: rec.wallet.slice(0, 6) + "…", ok: false, error: e.message }); }
      }
      return res.status(200).json({ success: true, eligible: eligible.length, minted: results.filter(r => r.ok && !r.already).length, results });
    }
    return res.status(400).json({ success: false, error: "unknown action (status|create-tree|test|backfill)" });
  } catch (e) { return res.status(500).json({ success: false, error: publicErrMsg(e) }); }
});

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
    return res.status(500).json({ success: false, error: publicErrMsg(err) });
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

// LP Pair Scanner — standalone flagship: every pool for a pair across every DEX + Ask Cluck.
app.get("/lp-scanner", (req, res) => {
  res.sendFile(join(__dirname, "public", "lp-scanner.html"));
});

app.get("/alpha", (req, res) => {
  res.sendFile(join(__dirname, "public", "alpha.html"));
});

app.get("/classroom", (req, res) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate"); // it changes often — never serve a stale copy
  res.sendFile(join(__dirname, "public", "classroom.html"));
});

app.get("/pool-monitor", (req, res) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  res.sendFile(join(__dirname, "public", "pool-monitor.html"));
});

// Shared market-header script for the token tools (repo public/ isn't statically mounted).
app.get("/market-header.js", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type("application/javascript");
  res.sendFile(join(__dirname, "public", "market-header.js"));
});

// Liquidity Engine — product / education / platform page (the flagship pitch).
app.get("/liquidity-engine", (req, res) => {
  res.sendFile(join(__dirname, "public", "liquidity-engine.html"));
});

// Liquidity Engine — multi-project operator dashboard (key-gated client-side).
app.get("/engine-dashboard", (req, res) => {
  res.sendFile(join(__dirname, "public", "engine-dashboard.html"));
});

// Liquidity Engine — client portal (wallet-signature login; per-project, for owners).
app.get("/portal", (req, res) => {
  res.sendFile(join(__dirname, "public", "client-portal.html"));
});

// Security Coop — wallet permission check / approval revoker.
app.get("/security-coop", (req, res) => {
  res.sendFile(join(__dirname, "public", "security-coop.html"));
});

// Wallet Safety Checkup — read-only scan (approvals + risky holdings).
app.get("/wallet-checkup", (req, res) => {
  res.sendFile(join(__dirname, "public", "wallet-checkup.html"));
});

// Wallet X-Ray — full-wallet behavioral deep dive (funding, buys/sells/transfers, bot/dumper signals).
app.get("/wallet-xray", (req, res) => {
  res.sendFile(join(__dirname, "public", "wallet-xray.html"));
});

// Token Vitals — facts-only token snapshot (authorities, liquidity, holders, Token-2022 safety,
// market). Deliberately NO score/grade/verdict (see the API note) — just the on-chain readings.
app.get("/token-vitals", (req, res) => {
  res.sendFile(join(__dirname, "public", "token-vitals.html"));
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

// -- Cluck Order Book (resting orders + cross-pool AMM depth; UI for /api/order-scan) --
app.get("/order-book", (req, res) => {
  res.sendFile(join(__dirname, "public", "order-book.html"));
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
  if (!adminAuthOK(req)) {
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
    return res.status(500).json({ error: publicErrMsg(err) });
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
  // The report builder lives in lib/autopsy.js — runAutopsy(mint) → { status, body }.
  // Store the assembled report so the next caller rides the cache. Only
  // successful reports are stored (errors should re-try fresh).
  const { status, body } = await runAutopsy(mint, { nocache: req.query.nocache === "1" });
  if (status === 200 && body && body.success) {
    AUTOPSY_CACHE.set(mint, { body, ts: Date.now() });
    if (AUTOPSY_CACHE.size > 300) { const cut = Date.now() - AUTOPSY_TTL_MS; for (const [k, v] of AUTOPSY_CACHE) if (v.ts < cut) AUTOPSY_CACHE.delete(k); }
  }
  if (status >= 500 && body && body.error) body.error = publicErrMsg({ message: body.error });
  return res.status(status).json(body);
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
const CLKN_ORCA_BTC_POOL = "5T9kVXHWpJiiK1SUTKm4tCd7kUMa78AtgGcD71raYkoQ"; // Orca Whirlpool CLKN/cbBTC 0.02% — the new BTC-quote Liquidity Engine pool
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const CBBTC_MINT = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"; // Coinbase wrapped BTC (8 decimals)
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"; // Jupiter governance token (6 decimals)
// Quote tokens we recognize as "the buyer paid with this." Helius returns
// tokenAmount already in UI units, so we just need symbol + emoji per quote.
const QUOTE_TOKENS = {
  [WSOL_MINT]: { symbol: "SOL",  emoji: "◎", isStable: false },
  [USDC_MINT]: { symbol: "USDC", emoji: "$", isStable: true },
  [USDT_MINT]: { symbol: "USDT", emoji: "$", isStable: true },
  [CBBTC_MINT]: { symbol: "cbBTC", emoji: "₿", isStable: false },
  [JUP_MINT]: { symbol: "JUP", emoji: "🪐", isStable: false },
};
// Buys below this USD value don't fire a Telegram notification. Default $5 so
// the channel shows the steady stream of smaller buys (good for hype during a
// Buy Special) while still filtering bot dust. Override via env var.
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "35");
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

// Cached BTC/USD price for valuing cbBTC-quoted trades on the new CLKN/cbBTC pool.
// Same pattern as getSolUsd: CoinGecko first, DexScreener cbBTC fallback, null until
// a real price loads (so we skip rather than post a fabricated USD value).
let cachedBtcUsd = parseFloat(process.env.BTC_USD_FALLBACK) || null;
let cachedBtcUsdAt = 0;
async function getBtcUsd() {
  const now = Date.now();
  if (now - cachedBtcUsdAt < 5 * 60 * 1000 && cachedBtcUsdAt > 0) return cachedBtcUsd;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const data = await res.json();
    const price = parseFloat(data?.bitcoin?.usd);
    if (Number.isFinite(price) && price > 0) { cachedBtcUsd = price; cachedBtcUsdAt = now; return cachedBtcUsd; }
  } catch (e) { console.warn("[TELEGRAM] CoinGecko BTC fetch failed:", e.message); }
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CBBTC_MINT}`);
    const data = await res.json();
    const price = parseFloat(data?.pairs?.[0]?.priceUsd);
    if (Number.isFinite(price) && price > 0) { cachedBtcUsd = price; cachedBtcUsdAt = now; }
  } catch (e) { console.warn("[TELEGRAM] DexScreener cbBTC fallback failed:", e.message); }
  return cachedBtcUsd;
}

// Cached JUP/USD price for valuing JUP-quoted trades on the new CLKN/JUP pool.
// Same pattern as getSolUsd: CoinGecko first, DexScreener JUP fallback, null until
// a real price loads (so we skip rather than post a fabricated USD value).
let cachedJupUsd = parseFloat(process.env.JUP_USD_FALLBACK) || null;
let cachedJupUsdAt = 0;
async function getJupUsd() {
  const now = Date.now();
  if (now - cachedJupUsdAt < 5 * 60 * 1000 && cachedJupUsdAt > 0) return cachedJupUsd;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=jupiter-exchange-solana&vs_currencies=usd");
    const data = await res.json();
    const price = parseFloat(data?.["jupiter-exchange-solana"]?.usd);
    if (Number.isFinite(price) && price > 0) { cachedJupUsd = price; cachedJupUsdAt = now; return cachedJupUsd; }
  } catch (e) { console.warn("[TELEGRAM] CoinGecko JUP fetch failed:", e.message); }
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${JUP_MINT}`);
    const data = await res.json();
    const price = parseFloat(data?.pairs?.[0]?.priceUsd);
    if (Number.isFinite(price) && price > 0) { cachedJupUsd = price; cachedJupUsdAt = now; }
  } catch (e) { console.warn("[TELEGRAM] DexScreener JUP fallback failed:", e.message); }
  return cachedJupUsd;
}

// Convert a trade's quote leg (SOL/USDC/USDT/cbBTC/JUP) into USD. Works for buys and
// sells alike — both carry the same { quote: { mint, amount } } shape.
function quoteUsdValue(trade) {
  const meta = QUOTE_TOKENS[trade.quote.mint];
  if (!meta) return null;
  if (meta.isStable) return trade.quote.amount;
  if (trade.quote.mint === CBBTC_MINT) {
    if (!cachedBtcUsd) return null; // no real BTC price yet — skip rather than fabricate
    return trade.quote.amount * cachedBtcUsd; // cbBTC × cached USD price
  }
  if (trade.quote.mint === JUP_MINT) {
    if (!cachedJupUsd) return null; // no real JUP price yet — skip rather than fabricate
    return trade.quote.amount * cachedJupUsd; // JUP × cached USD price
  }
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
  // And the new CLKN/cbBTC Orca pool, so BTC-quoted buys/sells are watched immediately
  // (DexScreener lags on a fresh pool, but we want it covered from the first block).
  if (!cachedPools.find(p => p.address === CLKN_ORCA_BTC_POOL)) {
    cachedPools.push({ address: CLKN_ORCA_BTC_POOL, dexId: "orca", labels: ["Whirlpool"] });
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
  // Fallback: `source` is third-party (Helius) data that ends up inside Telegram
  // HTML — only accept Helius's enum shape (A-Z/0-9/_, bounded) and title-case it
  // (METEORA_DAMM_V2 → "Meteora Damm V2"); anything else gets a safe generic label.
  if (!/^[A-Z0-9_]{2,32}$/.test(source)) return "DEX";
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
let cached24hVol = null, cached24hVolAt = 0; // CLKN fast-path (back-compat)
const vol24hByMint = new Map(); // mint -> { v, at } for other projects
async function getClkn24hVolume(mint = CLKN_MINT_ADDR) {
  const now = Date.now();
  const isClkn = mint === CLKN_MINT_ADDR;
  if (isClkn && cached24hVol !== null && now - cached24hVolAt < 5 * 60 * 1000) return cached24hVol;
  if (!isClkn) { const c = vol24hByMint.get(mint); if (c && now - c.at < 5 * 60 * 1000) return c.v; }
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      let v = 0;
      for (const p of data) { const h = Number(p?.volume?.h24); if (Number.isFinite(h)) v += h; }
      if (isClkn) { cached24hVol = v; cached24hVolAt = now; } else { vol24hByMint.set(mint, { v, at: now }); }
      return v;
    }
  } catch (e) { console.warn("[TELEGRAM] 24h volume fetch failed:", e.message); }
  return isClkn ? cached24hVol : ((vol24hByMint.get(mint) || {}).v ?? null);
}
// Compact USD: $123 / $4.5K / $1.2M. Returns null for non-finite input.
function fmtUsdShort(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  n = Number(n);
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

// Live market snapshot for any Solana mint from DexScreener: price + market cap from
// the DEEPEST pool (real price discovery), 24h volume summed across pools, and the
// price-change deltas. Same endpoint getClkn24hVolume() uses. Returns null on failure.
async function getTokenMarket(mint = CLKN_MINT_ADDR) {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    let vol24h = 0;
    for (const p of data) { const h = Number(p?.volume?.h24); if (Number.isFinite(h)) vol24h += h; }
    const deepest = data.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return {
      priceUsd: Number(deepest.priceUsd) || null,
      mc: Number(deepest.marketCap || deepest.fdv) || null,
      liqUsd: Math.round(deepest.liquidity?.usd || 0),
      vol24h,
      change: deepest.priceChange || {},
    };
  } catch (e) { console.warn("[TELEGRAM] market fetch failed:", e.message); return null; }
}

// Jupiter's organic score for CLKN (0–100 + a high/medium/low label). It's
// Jupiter's own measure of REAL, non-manipulated trading — the metric our
// Liquidity Engine is built to earn honestly (and the one wash-volume bots can't
// fake). Cached 5 min. Returns { score, label } or null. Same v2 endpoint the
// Token Autopsy uses for cross-verification.
let cachedOrganic = null, cachedOrganicAt = 0; // CLKN fast-path (back-compat)
const organicByMint = new Map(); // mint -> { o, at }
async function getClknOrganicScore(mint = CLKN_MINT_ADDR) {
  const now = Date.now();
  const isClkn = mint === CLKN_MINT_ADDR;
  if (isClkn && cachedOrganic !== null && now - cachedOrganicAt < 5 * 60 * 1000) return cachedOrganic;
  if (!isClkn) { const c = organicByMint.get(mint); if (c && now - c.at < 5 * 60 * 1000) return c.o; }
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        const t = data.find((d) => d.id === mint) || data[0];
        if (t && t.organicScore != null) {
          const o = { score: Number(t.organicScore), label: t.organicScoreLabel || null };
          if (isClkn) { cachedOrganic = o; cachedOrganicAt = now; } else { organicByMint.set(mint, { o, at: now }); }
          return o;
        }
      }
    }
  } catch (e) { console.warn("[TELEGRAM] organic score fetch failed:", e.message); }
  return isClkn ? cachedOrganic : ((organicByMint.get(mint) || {}).o ?? null);
}
// "26.6 🟢 high" — colored by Jupiter's label. Returns null if unavailable.
function fmtOrganicScore(o) {
  if (!o || !Number.isFinite(Number(o.score))) return null;
  const dot = o.label === "high" ? "🟢" : o.label === "medium" ? "🟡" : "🟠";
  return `${o.score.toFixed(1)} ${dot}${o.label ? " " + o.label : ""}`;
}

// Organic-score logger — hourly snapshot of CLKN's Jupiter organic score + price/volume,
// tagged with whether a Blitz is active / how recent. Lets us PROVE or disprove the
// Blitz→organic-score effect with data (tight Blitz liquidity → best price → real routed
// flow → organic score up). Persisted ring buffer in kv (~33 days hourly).
async function recordOrganicSnapshot() {
  try {
    const [org, mkt] = await Promise.all([
      getClknOrganicScore(CLKN_MINT_ADDR).catch(() => null),
      getTokenMarket(CLKN_MINT_ADDR).catch(() => null),
    ]);
    if (!org && !mkt) return;
    const now = Date.now();
    const lastBlitz = kv.get("clknBlitzLastStart", 0);
    const entry = {
      ts: now,
      score: org && Number.isFinite(org.score) ? Number(org.score.toFixed(2)) : null,
      label: org ? org.label : null,
      priceUsd: mkt ? mkt.priceUsd : null,
      vol24h: mkt && mkt.vol24h != null ? Math.round(mkt.vol24h) : null,
      blitzActive: kv.get("clknBlitzUntil", 0) > now,
      minsSinceBlitz: lastBlitz ? Math.round((now - lastBlitz) / 60000) : null,
    };
    // Routability probe: can Jupiter route a small CLKN buy through OUR Orca pools?
    // (Thin pools aren't in Jupiter's index — flips true once depth crosses their
    // threshold; that's the unlock for organic flow filling on engine pools.)
    try {
      const q = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=${CLKN_MINT_ADDR}&amount=10000000&swapMode=ExactIn&slippageBps=300&dexes=Orca`, { signal: AbortSignal.timeout(8000) });
      const qd = await q.json();
      entry.orcaRoutable = !(qd && qd.error);
    } catch (_) { entry.orcaRoutable = null; }
    const log = kv.get("clknOrganicLog", []) || [];
    log.push(entry);
    kv.set("clknOrganicLog", log.slice(-800));
    try { await maybeFireOrganicReminder(entry); } catch (_) {}
  } catch (e) { console.warn("[organic-log] failed:", e.message); }
}

// One-shot reminder: armed via /api/clkn-organic-log?remindIn=<hours>. The hourly
// logger checks it; once we're past the target time it DMs the operator room (loud,
// the private bot chat — NOT the community group) with the current organic score, then
// disarms. Runs on Railway so it survives ephemeral cloud-session containers.
async function maybeFireOrganicReminder(entry) {
  const at = kv.get("organicReminderAt", 0);
  if (!at || Date.now() < at) return;
  const chat = kv.get("organicReminderChat", "") || "1846034838"; // operator/treasury DM
  kv.set("organicReminderAt", 0); // disarm first so it can't double-fire
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  if (!tok) return;
  const log = kv.get("clknOrganicLog", []) || [];
  const armedAt = kv.get("organicReminderArmedAt", 0);
  const base = log.find((e) => e.ts >= armedAt && e.score != null);
  const score = entry && entry.score != null ? entry.score : "?";
  const baseTxt = base ? ` (was ${base.score} at arm time)` : "";
  const text = `⏰🐔 <b>Organic-score recovery check</b>\n\nCLKN Jupiter organic score is now <b>${score}</b>${baseTxt}.\nBlitz has been off ~12h. If it climbed back toward ~30, the recovery thesis held — run steady/deep, not spiky.\n\nReply in your session: "pull the organic recovery" for the full curve.`;
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: false }),
    });
  } catch (e) { console.warn("[organic-reminder] send failed:", e.message); }
}

async function notifyClknBuy(trade, tx, pool, usdValue, HELIUS_KEY) {
  const buyer = trade.trader;
  const buyerShort = buyer ? `${buyer.slice(0, 4)}…${buyer.slice(-4)}` : "unknown";
  const isDevBuy = isReinvestWallet(buyer);   // team deployer OR an engine operator wallet
  const meta = QUOTE_TOKENS[trade.quote.mint];
  // Only show "($X.XX)" suffix when the quote isn't already a USD-denominated
  // stablecoin — for USDC/USDT the amount IS the dollar value.
  const usdSuffix = (meta && !meta.isStable && usdValue) ? ` <i>($${usdValue.toFixed(2)})</i>` : "";
  const routeLine = formatRoute(tx, pool);
  const priceStr = formatClknPrice(usdValue, trade.clknAmount);
  const mcapStr = await formatClknMarketCap(usdValue, trade.clknAmount, HELIUS_KEY);
  const vol24Str = fmtUsdShort(await getClkn24hVolume());
  const priceLine =
    (priceStr ? `\nPrice: <b>${priceStr}</b>` : "") +
    (mcapStr ? `\nMarket cap: <b>${mcapStr}</b>` : "") +
    (vol24Str ? `\n24h Vol: <b>${vol24Str}</b>` : "");

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
  const priceLine =
    (priceStr ? `\nPrice: <b>${priceStr}</b>` : "") +
    (mcapStr ? `\nMarket cap: <b>${mcapStr}</b>` : "") +
    (vol24Str ? `\n24h Vol: <b>${vol24Str}</b>` : "");

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
    // Refresh SOL + BTC + JUP prices once per cycle (each cached internally for 5 min)
    await getSolUsd();
    await getBtcUsd();
    await getJupUsd();
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

      // Skip a managed vault operator's SELLS — liquidity-management sells aren't
      // community flow. Its BUYS now pass through and post as community reinvestment
      // (engine buying CLKN back = real buy pressure the owner wants surfaced).
      if (trade.trader && trade.action === "sell" && mmOperatorWallets().includes(trade.trader)) {
        console.log(`[TELEGRAM] Skipping MM vault op SELL (liquidity management) · sig ${sig.slice(0,8)}`);
        rememberSig(sig);
        if (!blocked) advanceTo = sig;
        continue;
      }

      const usd = quoteUsdValue(trade);
      const quoteMeta = QUOTE_TOKENS[trade.quote.mint] || { symbol: '?' };
      const usdStr = usd == null ? "no USD" : "$" + usd.toFixed(4);
      const isReinvestBuy = trade.action !== "sell" && isReinvestWallet(trade.trader);
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
  // Boot env audit — one line saying exactly which expected vars are absent, so
  // "the bot isn't doing X" is diagnosable from the first lines of the deploy log.
  {
    const expected = [
      "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "HELIUS_API_KEY", "BAGS_API_KEY",
      "ANTHROPIC_API_KEY", "SOLANA_TRACKER_API_KEY", "SOLSCAN_API_KEY",
      "PREMIUM_ACCESS_KEY", "BUYCOMP_KEY", "X_API_KEY", "X_API_SECRET",
      "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "GOOGLE_SHEET_ID", "GOOGLE_CLIENT_EMAIL",
      "GOOGLE_PRIVATE_KEY", "HATCHERY_TURBO_KEY", "COINGECKO_API_KEY", "DATA_DIR",
      "MM_OPERATOR_SECRET",
    ];
    const missing = expected.filter((k) => !process.env[k]);
    console.log(`[boot] env audit: ${expected.length - missing.length}/${expected.length} expected vars present${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.warn("[boot] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID unset → the ENTIRE scheduler block (alerts, lessons, radar, recap, grad watcher, webhook) is OFF");
    }
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    console.log(`[TELEGRAM] Bot configured · chat ${process.env.TELEGRAM_CHAT_ID} · trade poller starting in 5s`);
    // Brief delay before first poll so server is fully ready
    setTimeout(() => {
      pollClknBuys();
      setInterval(pollClknBuys, 30000);
    }, 5000);
    // Cluck's Daily Alpha — auto-post once/day at ~ALPHA_POST_HOUR UTC to X + (silent) Telegram.
    // Stamps the date BEFORE posting so a crash/retry can't double-post publicly; a rare failed
    // post is recoverable via /api/alpha-test?post=1. Change the hour freely (or kv alphaPostHour).
    async function dailyAlphaTick() {
      try {
        const now = new Date();
        const hour = Number(kv.get("alphaPostHour", 14)); // 14:00 UTC ≈ 9–10am ET
        if (now.getUTCHours() < hour) return;
        const today = now.toISOString().slice(0, 10);
        if (kv.get("dailyAlphaPostedDate", null) === today) return;
        kv.set("dailyAlphaPostedDate", today);
        const a = await buildDailyAlpha({ force: true });
        const posted = await postDailyAlpha(a);
        console.log("[daily-alpha] posted", today, { x: !!(posted.x && posted.x.ok), tg: !!posted.telegram, xErr: posted.x && posted.x.body });
      } catch (e) { console.warn("[daily-alpha] tick failed:", e.message); }
    }
    setInterval(dailyAlphaTick, 10 * 60 * 1000); // check every 10 min; fires once/day past the hour
    setTimeout(dailyAlphaTick, 95000);
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
    // Cluck's Lesson — educational post 3×/day on odd UTC hours (13/19/01): 1 long + 2 short.
    setInterval(eduPostTick, 60 * 1000);
    // Treasury report — private DM (the treasury project's chat) of balances + fees every
    // 6h. Persisted stamp so redeploys don't re-fire; no-op unless the treasury is funded.
    let lastTreasuryReportAt = kv.get("treasuryReportAt", 0);
    async function sendTreasuryReport() {
      const tok = process.env.TELEGRAM_BOT_TOKEN; if (!tok) return;
      try {
        const proj = whirlpoolMM.vault.getProject("treasury"); if (!proj || !proj.telegramChatId) return;
        const st = await whirlpoolMM.vault.status("treasury"); if (!st || !st.enabled) return;
        const pos = await whirlpoolMM.vault.publicPositions("treasury").catch(() => null);
        const f = st.float || {}, earn = st.earnings || {}, cost = st.costs || {}, px = earn.prices || {};
        const dep = pos && typeof pos.totalUsd === "number" ? pos.totalUsd : 0;
        const sleeves = ((pos && pos.positions) || []).filter((p) => p.role === "wide" || p.role === "tight")
          .map((p) => `  • ${p.role}: $${(p.valueUsd || 0).toFixed(2)} (${p.inRange ? "in range" : "OUT of range"})`).join("\n");
        // Fold in Meteora (the treasury now lives there; the Orca vault is empty).
        let metValue = 0, metFees = 0, metPending = 0, metLines = "";
        try {
          const m = await meteora.status({ solUsd: px.solUsd || 0, btcUsd: px.clknUsd || 0 });
          metFees = m.lifetimeFeeUsd || 0; // pending + claimed + the closed-position ledger
          metPending = m.pendingFeeUsd || 0;
          for (const p of (m.positions || [])) {
            metValue += p.valueUsd || 0;
            const rng = (p.lowerPrice && p.upperPrice) ? ` ${p.lowerPrice.toFixed(0)}–${p.upperPrice.toFixed(0)}` : "";
            metLines += `  • Meteora${rng}: $${(p.valueUsd || 0).toFixed(2)} (${p.inRange ? "in range" : "OUT"}) · pending $${(p.pendingFeeUsd || 0).toFixed(4)} · claimed $${(p.claimedFeeUsd || 0).toFixed(4)}\n`;
          }
        } catch (_) {}
        const floatUsd = (f.sol || 0) * (px.solUsd || 0) + (f.clkn || 0) * (px.clknUsd || 0) + (f.usdc || 0);
        const earned = (earn.totalEarnedUsd != null ? earn.totalEarnedUsd : 0) + metFees;
        const spent = cost.lifetime && typeof cost.lifetime.usd === "number" ? cost.lifetime.usd : 0;
        const net = earned - spent;
        const msg =
          `🏦 <b>Treasury report</b> — cbBTC/SOL\n\n` +
          `<b>Total value:</b> $${(dep + metValue + floatUsd).toFixed(2)}\n` +
          `<b>Deployed:</b> $${(dep + metValue).toFixed(2)}\n${sleeves ? sleeves + "\n" : ""}${metLines}` +
          `<b>Wallet float:</b> ${(f.sol || 0).toFixed(3)} SOL · ${(f.clkn || 0).toFixed(6)} cbBTC · $${(f.usdc || 0).toFixed(2)} USDC (≈$${floatUsd.toFixed(2)})\n\n` +
          `<b>Fees earned (lifetime):</b> $${earned.toFixed(4)} <i>(Meteora $${metFees.toFixed(4)}: pending $${metPending.toFixed(4)} + claimed/closed $${(metFees - metPending).toFixed(4)})</i>\n` +
          `<b>Fees spent (moves):</b> $${spent.toFixed(4)} <i>(${(cost.lifetime && cost.lifetime.txCount) || 0} txs)</i>\n` +
          `<b>Net:</b> $${net.toFixed(4)}`;
        await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: proj.telegramChatId, text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
        });
      } catch (e) { console.warn("[treasury-report] failed:", e.message); }
    }
    function treasuryReportTick() {
      const now = Date.now();
      if (now - lastTreasuryReportAt >= 6 * 3600 * 1000) { lastTreasuryReportAt = now; kv.set("treasuryReportAt", now); sendTreasuryReport(); }
    }
    // 6h cbBTC/SOL treasury report DISABLED (owner 2026-06-12): the treasury now holds only
    // the JUP/USDC earner; the single daily JUP/USDC recap below is the only one we want.
    // (sendTreasuryReport retained for when a cbBTC/SOL backbone returns.)
    void treasuryReportTick;
    // 6-HOURLY recap → PRIVATE DM: the JUP/USDC earner only (owner's call, 2026-06-12).
    let lastTreasuryRecapAt = kv.get("treasuryRecapAt", 0);
    function treasuryRecapTick() {
      const now = Date.now();
      if (now - lastTreasuryRecapAt >= 6 * 3600 * 1000) { lastTreasuryRecapAt = now; kv.set("treasuryRecapAt", now); sendJupUsdcRecap({}).catch((e) => console.warn("[jup-recap] failed:", e.message)); }
    }
    setInterval(treasuryRecapTick, 5 * 60 * 1000);
    setTimeout(treasuryRecapTick, 30000); // first recap shortly after boot captures the baseline; then every 6h
    // Meteora range monitor — DM the treasury chat when a position drifts NEAR an edge
    // (early nudge) or goes fully OUT of range, so the OWNER can do the 10-sec UI rebalance
    // (Rebalance tab → Curve → Rebalance → approve). Read-only + DM: this never moves funds.
    // Two edge-triggered, debounced state machines (one alert per episode, no spam):
    //   _metEdgeState — "near edge": fires once when frac crosses past NEAR_EDGE_FRAC of either
    //     end while still in range; re-arms only after price returns to the center band.
    //   _metOorState  — "out of range": fires once on the OOR transition; clears on return.
    const NEAR_EDGE_FRAC = 0.12;       // alert when <12% from either end (i.e. >88% across)
    const EDGE_REARM_LO = 0.30, EDGE_REARM_HI = 0.70; // must re-center toward middle to re-arm
    let _metOorState = kv.get("meteoraOorState", {});
    let _metEdgeState = kv.get("meteoraEdgeState", {});
    let tg, proj; // set each tick; metDM closes over them
    const meteoraPoolLink = (pair) => pair === "JUP/USDC" ? `https://app.meteora.ag/dlmm/${JUPUSDC_POOL}` : null;
    const rebalanceSteps = (pair) => {
      const link = meteoraPoolLink(pair);
      return `Open Meteora → <b>Rebalance</b> tab → <b>Curve</b> → <b>Rebalance</b> → approve.${link ? `\n${link}` : ""}`;
    };
    async function metDM(text) {
      await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: proj.telegramChatId, parse_mode: "HTML", disable_web_page_preview: true, text }),
      });
    }
    async function meteoraOorTick() {
      tg = process.env.TELEGRAM_BOT_TOKEN; proj = whirlpoolMM.vault.getProject("treasury");
      if (!tg || !proj || !proj.telegramChatId) return;
      try {
        if (!meteora.isEnabled()) return;
        let solUsd = 0, btcUsd = 0, jupUsd = 0;
        try { const st = await whirlpoolMM.vault.status("treasury"); const px = (st.earnings || {}).prices || {}; solUsd = px.solUsd || 0; btcUsd = px.clknUsd || 0; } catch (_) {}
        try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
        const m = await meteora.status({ solUsd, btcUsd, jupUsd });
        for (const p of (m.positions || [])) {
          const key = p.position;
          const rangeStr = p.lowerPrice ? `${p.lowerPrice.toPrecision(4)}–${p.upperPrice.toPrecision(4)}` : "?";
          const valStr = "$" + Math.round(p.valueUsd || 0);
          // Where the active bin sits across the position: 0 = bottom edge, 1 = top edge.
          const span = (p.upperBinId != null && p.lowerBinId != null) ? p.upperBinId - p.lowerBinId : 0;
          const frac = span > 0 && p.activeBinId != null ? (p.activeBinId - p.lowerBinId) / span : 0.5;
          const acrossPct = Math.round(frac * 100);
          const nearEdge = p.inRange && (frac <= NEAR_EDGE_FRAC || frac >= 1 - NEAR_EDGE_FRAC);
          const wasOor = !!_metOorState[key];
          const wasEdge = !!_metEdgeState[key];

          // OUT OF RANGE — fires once on the transition.
          if (!p.inRange && !wasOor) {
            _metOorState[key] = Date.now(); kv.set("meteoraOorState", _metOorState);
            if (wasEdge) { delete _metEdgeState[key]; kv.set("meteoraEdgeState", _metEdgeState); } // OOR supersedes the edge warning
            await metDM(`🚨 <b>Meteora position OUT of range</b>\n${p.pair} · earning $0 until re-centered\nrange ${rangeStr} · value ${valStr}\n${rebalanceSteps(p.pair)}`);
            continue;
          }
          if (p.inRange && wasOor) {
            delete _metOorState[key]; kv.set("meteoraOorState", _metOorState);
            await metDM(`✅ <b>Meteora back in range</b>\n${p.pair} · earning fees again.`);
            // fall through so the edge state can re-arm/clear from the fresh frac below
          }

          // NEAR EDGE (still in range) — early nudge, fires once per approach.
          if (nearEdge && !wasEdge) {
            _metEdgeState[key] = Date.now(); kv.set("meteoraEdgeState", _metEdgeState);
            const side = frac >= 0.5 ? "top" : "bottom";
            await metDM(`⚠️ <b>Meteora position NEAR EDGE</b>\n${p.pair} · ${acrossPct}% across range (price near the ${side}, about to drift out)\nrange ${rangeStr} · value ${valStr}\nRebalance now to re-center & keep earning:\n${rebalanceSteps(p.pair)}`);
          } else if (wasEdge && frac >= EDGE_REARM_LO && frac <= EDGE_REARM_HI) {
            // Re-centered back toward the middle — clear silently so the next approach can alert again.
            delete _metEdgeState[key]; kv.set("meteoraEdgeState", _metEdgeState);
          }
        }
      } catch (e) { console.warn("[meteora-oor] failed:", e.message); }
    }
    // Organic-score logger — hourly CLKN snapshot tagged with Blitz activity (proves the
    // Blitz→organic-score effect over time). Cheap; just two cached API reads + a kv write.
    setInterval(recordOrganicSnapshot, 60 * 60 * 1000);
    setTimeout(recordOrganicSnapshot, 25000);
    setInterval(meteoraOorTick, 5 * 60 * 1000);
    setTimeout(meteoraOorTick, 45000);
    // Meteora autonomous re-center — only acts when meteoraCfg.autoRecenter is ON (ships OFF).
    // Edge/anti-thrash checks live in meteoraRecenter; this just invokes it on the cadence.
    async function meteoraRecenterTick() {
      try {
        if (!meteora.isEnabled() || !meteora.getCfg().autoRecenter) return;
        const r = await meteoraRecenter({});
        if (r && !["none", "hold", "deferred"].includes(r.action)) console.log("[meteora-recenter]", r.action, "·", r.reason || "");
      } catch (e) { console.warn("[meteora-recenter] failed:", e.message); }
    }
    setInterval(meteoraRecenterTick, 5 * 60 * 1000);
    // ⛔ JUP/USDC autonomous rebalancer — HARD-DISABLED at the code level (owner's call,
    // 2026-06-16: "stop rebalancing period, don't touch it"). The loop auto-adopted a
    // manually-opened position and recentered it; the owner wants it dead so NO kv flag can
    // revive it by accident. JUP_AUTO_REBALANCE_KILLED gates the tick below — it never calls
    // jupUsdcRecenter. To bring back autonomous rebalancing, set this to false AND set
    // jupUsdcCfg.enabled — a deliberate, two-step opt-in, never a silent default.
    // (The manual lever /api/meteora/recenter?which=jup&force=1 is owner-initiated + key-gated
    // and is intentionally left available — it only ever runs when the owner explicitly calls it.)
    const JUP_AUTO_REBALANCE_KILLED = true;
    async function jupUsdcRecenterTick() {
      try {
        if (JUP_AUTO_REBALANCE_KILLED || !meteora.isEnabled() || !jupUsdcCfg().enabled) return;
        const r = await jupUsdcRecenter({});
        if (r && !["none", "hold", "deferred"].includes(r.action)) console.log("[jup-usdc-recenter]", r.action, "·", r.reason || "");
      } catch (e) { console.warn("[jup-usdc-recenter] failed:", e.message); }
    }
    setInterval(jupUsdcRecenterTick, 5 * 60 * 1000);
    setTimeout(jupUsdcRecenterTick, 75000);
    // Order Book monitor — snapshot watched mints' resting limit orders every 10 min and
    // DM (silent) when one appears or fills/cancels, so the owner can catch them day-to-day.
    async function orderbookMonitorTick() {
      try {
        for (const mint of obWatchMints()) {
          const { diff } = await recordOrderbookSnapshot(mint);
          if (!diff || (!diff.appeared.length && !diff.disappeared.length)) continue;
          const sym = mint === CLKN_MINT_ADDR ? "CLKN" : (mint.slice(0, 4) + "…");
          const mine = obOwnerWallets();
          const line = o => {
            const tag = o.owner ? (mine.includes(o.owner) ? " · ✅ yours" : " · ⚠️ " + o.owner.slice(0, 4) + "…" + o.owner.slice(-4)) : "";
            return `  ${o.side === "sell" ? "🔴 SELL" : "🟢 BUY"} ${fmtUsdShort(o.sizeUsd) || "?"} @ ${o.priceUsd ? "$" + Number(o.priceUsd).toPrecision(4) : "?"}${o.distPct != null ? ` (${o.distPct >= 0 ? "+" : ""}${Number(o.distPct).toFixed(1)}%)` : ""}${o.venue ? " [" + o.venue + "]" : ""}${tag}`;
          };
          let msg = `🧱 <b>Order Book — ${sym}</b>`;
          if (diff.appeared.length) msg += `\n\n🆕 <b>${diff.appeared.length} limit order(s) APPEARED:</b>\n` + diff.appeared.slice(0, 8).map(line).join("\n");
          if (diff.disappeared.length) msg += `\n\n✅ <b>${diff.disappeared.length} filled/cancelled:</b>\n` + diff.disappeared.slice(0, 8).map(line).join("\n");
          msg += `\n\n🔍 ${TG_PUBLIC_BASE}/order-book`;
          const chat = kv.get("obWatchChat", "") || "1846034838"; // operator/treasury DM (silent)
          try { await tgSend(chat, msg); } catch (_) {}
        }
      } catch (e) { console.warn("[order-book-monitor] failed:", e.message); }
    }
    setInterval(orderbookMonitorTick, 10 * 60 * 1000);
    setTimeout(orderbookMonitorTick, 120000);
    // CLKN structure watch — hourly read-only log of how the 3-pair strategy moves.
    setInterval(recordClknStructureSnapshot, 60 * 60 * 1000);
    setTimeout(recordClknStructureSnapshot, 150000);
    // JUP/USDC daily LP-vs-HODL scorecard — the durable check-in (the app is always-on, so this
    // survives container/session resets). Fires at most once/24h, and only once the HODL baseline
    // is ≥24h old (needs a day of data to be meaningful). Tells the owner whether fees are beating
    // impermanent loss, with the action to take if not. Silent DM (per the silent-default rule).
    async function jupLpVsHodlDailyCheck() {
      try {
        if (!meteora.isEnabled() || !jupUsdcCfg().enabled) return;
        if (Date.now() - kv.get("jupLpHodlCheckAt", 0) < 24 * 3600 * 1000) return;
        let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
        const m = await meteora.status({ jupUsd });
        const pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && (p.valueUsd || 0) >= 1);
        if (!pos) return;
        const L = jupUsdcLedger();
        const lp = jupLpVsHodl(L, pos.valueUsd || 0, pos.pendingFeeUsd || 0, jupUsd);
        if (!lp || !lp.sinceTs) return;
        const ageH = (Date.now() - lp.sinceTs) / 3600000;
        if (ageH < 24) return;                                  // wait for a full day of data
        kv.set("jupLpHodlCheckAt", Date.now());
        const win = lp.lpVsHodlUsd >= 0;
        const pct = pos.valueUsd > 0 ? (lp.lpVsHodlUsd / pos.valueUsd * 100) : 0;
        meteoraDM(
          `📊 <b>JUP/USDC — daily LP-vs-HODL check</b>\n` +
          `${win ? "✅" : "⚠️"} <b>${win ? "+" : "−"}$${Math.abs(lp.lpVsHodlUsd).toFixed(2)}</b> (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% of position) over ${ageH.toFixed(0)}h\n` +
          `LP $${lp.lpNowUsd.toFixed(0)} vs if-held $${lp.hodlNowUsd.toFixed(0)} · ${L.recenters || 0} rebalances (cost $${(L.rebalanceCostUsd || 0).toFixed(2)})\n` +
          (win ? "Fees are beating impermanent loss. 👍" : "IL + swap cost is eating fees — consider widening the band further or slowing the OOR cadence (minRecenterSecOor).") +
          `\n<i>re-baseline (&reset=1) after any manual add/remove</i>`
        );
      } catch (e) { console.warn("[jup-lphodl] failed:", e.message); }
    }
    setInterval(jupLpVsHodlDailyCheck, 60 * 60 * 1000);          // checks hourly, DMs at most once/24h
    setTimeout(jupLpVsHodlDailyCheck, 95000);
    // Pool Monitor — sample the JUP/USDC earner every 2 min: fee pace + peak $/min & $/hr
    // bursts + edge proximity, so the owner can watch closely and adjust. Powers /api/pool-monitor.
    async function poolMonitorTick() {
      try {
        if (!meteora.isEnabled()) return;
        let jupUsd = 0; try { jupUsd = (await getJupUsd()) || 0; } catch (_) {}
        const m = await meteora.status({ jupUsd });
        const pos = (m.positions || []).find((p) => p.pair === "JUP/USDC" && (p.valueUsd || 0) >= 1);
        if (!pos) return;
        const L = jupUsdcLedger();
        if (L.hodlBaseJup == null) { ensureJupHodlBaseline(L, pos, jupUsd); try { kv.set("jupUsdcLedger", L); } catch (_) {} } // seed LP-vs-HODL basket
        const claimable = pos.pendingFeeUsd || 0, claimed = pos.claimedFeeUsd || 0;
        const lifetimeUsd = (L.bankedClaimedUsd || 0) + claimed + claimable;
        const now = Date.now();
        const mon = kv.get("poolMonitor", null) || { peakPerMinUsd: 0, peakPerHourUsd: 0, samples: [] };
        if (mon.lastTs && mon.lastLifetimeUsd != null) {
          const dMin = (now - mon.lastTs) / 60000, dFee = lifetimeUsd - mon.lastLifetimeUsd;
          if (dMin > 0 && dMin <= 6 && dFee >= 0) {
            const rpm = dFee / dMin;
            if (rpm > (mon.peakPerMinUsd || 0)) { mon.peakPerMinUsd = Number(rpm.toFixed(3)); mon.peakPerMinAt = now; }
          }
        }
        const span = pos.upperBinId - pos.lowerBinId, frac = span > 0 ? (pos.activeBinId - pos.lowerBinId) / span : 0.5;
        mon.samples.push({ ts: now, lifetimeUsd: Number(lifetimeUsd.toFixed(2)), value: Number((pos.valueUsd || 0).toFixed(2)), price: pos.currentPrice, inRange: pos.inRange, claimable: Number(claimable.toFixed(2)), frac: Number(frac.toFixed(3)) });
        if (mon.samples.length > 200) mon.samples = mon.samples.slice(-200); // ~6.6h @ 2min
        const win = mon.samples.filter((s) => s.ts >= now - 3600000);
        if (win.length >= 2) { const hr = win[win.length - 1].lifetimeUsd - win[0].lifetimeUsd; if (hr > (mon.peakPerHourUsd || 0)) { mon.peakPerHourUsd = Number(hr.toFixed(2)); mon.peakPerHourAt = now; } }
        mon.lastTs = now; mon.lastLifetimeUsd = lifetimeUsd;
        kv.set("poolMonitor", mon);
      } catch (e) { console.warn("[pool-monitor] tick failed:", e.message); }
    }
    setInterval(poolMonitorTick, 2 * 60 * 1000);
    setTimeout(poolMonitorTick, 60000);
    // CLKN Blitz auto-revert — reset-proof: checks the persisted expiry every minute and
    // once shortly after boot, so a redeploy mid-blitz still reverts on time.
    setInterval(clknBlitzCheck, 60 * 1000);
    setTimeout(clknBlitzCheck, 12000);
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
            { command: "ca", description: "CLKN contract address + DexScreener chart" },
            { command: "dex", description: "CLKN DexScreener chart" },
            { command: "x", description: "Our X (Twitter) account" },
            { command: "website", description: "clucknorris.app — school + tools" },
            { command: "app", description: "clucknorris.app — school + tools" },
            { command: "price", description: "CLKN price, market cap & volume" },
            { command: "walletxray", description: "Full wallet deep dive (/walletxray <wallet>)" },
            { command: "autopsy", description: "Forensic breakdown (/autopsy <mint>)" },
            { command: "trace", description: "Wallet × token history (/trace <wallet>)" },
            { command: "snapshot", description: "Holders + airdrop CSV (/snapshot <mint>)" },
            { command: "holders", description: "True holders vs LP & locks" },
            { command: "securitycoop", description: "Find & revoke risky wallet approvals" },
            { command: "buyspecial", description: "Run a buy competition" },
            { command: "rose", description: "Buy-competition analyzer + prizes" },
            { command: "buyleaders", description: "Live buy-competition standings" },
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
  // funds. Ticks every 10 minutes; re-centers the position as price moves.
  // Multi-tenant: the scheduler loops over every ACTIVE project that has its operator
  // key loaded (CLKN via MM_OPERATOR_SECRET; others via their own env var). Sequential
  // per project = naturally staggered for RPC limits. A project with no key is skipped,
  // so registering one is safe until its wallet/key is funded & set.
  const vaultEnabledIds = () => Object.keys(whirlpoolMM.vault.listProjects()).filter((id) => {
    const p = whirlpoolMM.vault.getProject(id);
    return p && p.active !== false && whirlpoolMM.vault.isEnabled(id);
  });
  const startIds = vaultEnabledIds();
  if (startIds.length) console.log(`[VAULT] enabled — autonomous management every 10m · projects: ${startIds.join(", ")}`);
  else console.log("[VAULT] no project operator key set — idle (will service projects once a key is present)");

  const runProject = async (id) => {
    const tag = `[VAULT:${id}]`;
    // Equal-pools rebalancer first, then ask-wall (reserves its token), base, SOL pool.
    try { const rb = await whirlpoolMM.vault.rebalancePools({ projectId: id }); if (rb && !["none", "balanced", "capped"].includes(rb.action)) console.log(`${tag}[rebalance]`, rb.action, "·", rb.reason || ""); } catch (e) { console.error(`${tag} rebalance error:`, e.message); }
    try { const w = await whirlpoolMM.vault.tickAskWall({ projectId: id }); if (w && !["none", "hold", "deferred"].includes(w.action)) console.log(`${tag}[ask-wall]`, w.action, "·", w.reason || ""); } catch (e) { console.error(`${tag} ask-wall error:`, e.message); }
    try { const r = await whirlpoolMM.vault.tick({ projectId: id }); if (r && !["none", "hold", "deferred"].includes(r.action)) console.log(tag, r.action, "·", r.reason || ""); } catch (e) { console.error(`${tag} tick error:`, e.message); }
    try { const s = await whirlpoolMM.vault.tickSol({ projectId: id }); if (s && !["none", "hold", "deferred"].includes(s.action)) console.log(`${tag}[token/SOL]`, s.action, "·", s.reason || ""); } catch (e) { console.error(`${tag} token/SOL error:`, e.message); }
    try { const b = await whirlpoolMM.vault.tickBtc({ projectId: id }); if (b && !["none", "hold", "deferred"].includes(b.action)) console.log(`${tag}[token/cbBTC]`, b.action, "·", b.reason || ""); } catch (e) { console.error(`${tag} token/cbBTC error:`, e.message); }
    try { const j = await whirlpoolMM.vault.tickJup({ projectId: id }); if (j && !["none", "hold", "deferred"].includes(j.action)) console.log(`${tag}[token/JUP]`, j.action, "·", j.reason || ""); } catch (e) { console.error(`${tag} token/JUP error:`, e.message); }
    try { const tr = await whirlpoolMM.vault.tickTreasury({ projectId: id }); if (tr && !["none", "hold", "deferred"].includes(tr.action)) console.log(`${tag}[dual-sleeve]`, tr.action, "·", tr.reason || ""); } catch (e) { console.error(`${tag} dual-sleeve error:`, e.message); }
    try { const bb = await whirlpoolMM.vault.buyback({ projectId: id }); if (bb && !["none", "disabled", "deferred", "capped"].includes(bb.action)) console.log(`${tag}[buyback]`, bb.action, "·", bb.reason || ""); } catch (e) { console.error(`${tag} buyback error:`, e.message); }
  };
  const vaultTick = async () => {
    for (const id of vaultEnabledIds()) await runProject(id);
  };
  // Boot tick — but SKIP any project that ticked within the last 8 min (persisted across
  // redeploys). At 2-40 deploys/day this stops each redeploy firing a redundant cold cycle;
  // it still fires when genuinely due, so the ~10-min cadence holds no matter the deploy rate.
  const BOOT_TICK_MIN_GAP_MS = 8 * 60 * 1000;
  const vaultBootTick = async () => {
    for (const id of vaultEnabledIds()) {
      const last = whirlpoolMM.vault.lastTickTs(id);
      if (last && Date.now() - last < BOOT_TICK_MIN_GAP_MS) {
        console.log(`[VAULT:${id}] boot tick skipped — last tick ${Math.round((Date.now() - last) / 1000)}s ago (redeploy guard)`);
        continue;
      }
      await runProject(id);
    }
  };
  setTimeout(vaultBootTick, 15000);
  setInterval(vaultTick, 600 * 1000); // 10 min — low burn; positions are almost always "hold" between ticks
  // Treasury concentrated sleeve — faster 5-min re-center loop so the tight/mega sleeve
  // stays pinned in range (where the fees are). Lock-protected (no overlap with the 10-min
  // full tick); only runs the treasury's dual-sleeve, not the whole vault.
  setInterval(() => { whirlpoolMM.vault.tickTreasury({ projectId: "treasury" }).catch(() => {}); }, 300 * 1000);
});
