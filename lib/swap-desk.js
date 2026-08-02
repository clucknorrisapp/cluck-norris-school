/* CLKN <-> NORMIE swap desk — pricing, quoting, inventory and transaction construction.
 *
 * WHAT THIS IS. A discretionary, owner-funded desk. It holds a float of both tokens and trades
 * one for the other at live USD value, atomically, with no price impact. It is NOT an AMM and
 * NOT an on-chain program — see docs/SWAP_DESIGN.md for why both were rejected.
 *
 * CUSTODY. The desk wallet must hold ONLY the swap float. Never the treasury, never a mint
 * authority. Same rule as MM_OPERATOR_SECRET, and for the same reason: the blast radius of a bug
 * in here is exactly the balance of that wallet.
 *
 * OFF BY DEFAULT. With SWAP_OPERATOR_SECRET unset, isEnabled() is false and every entry point
 * below is a structured no-op. Unset is a safe, fully-disabled desk, matching lib/whirlpool-vault.js.
 *
 * ⚠️ THE ONE THING THAT MUST NOT BE GOT WRONG. verifyAndSign() partial-signs with a keypair that
 * can move the desk's entire inventory. It signs ONLY a transaction whose message bytes are
 * byte-identical to one this module built moments earlier. Do not replace that check with
 * instruction inspection — see the comment on verifyAndSign.
 */
const crypto = require("crypto");
const { Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const bs58 = require("bs58");
const rpc = require("./rpc");
const kv = require("./kvstore");

const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const NORMIE_MINT = "FrSFwE2BxWADEyUWFXDMAeomzuB4r83ZvzdG9sevpump";

// A hard kill that does not depend on env plumbing. Flip to true to stop the desk dead even if
// the secret is set and funded. Same idiom as LIQ_ENGINE_KILLED / WALLET_WATCH_KILLED.
const SWAP_KILLED = false;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function cfg() {
  return {
    spreadBps:      num(process.env.SWAP_SPREAD_BPS, 75),
    maxDriftBps:    num(process.env.SWAP_MAX_DRIFT_BPS, 50),
    quoteTtlMs:     num(process.env.SWAP_QUOTE_TTL_SEC, 30) * 1000,
    walletDailyUsd: num(process.env.SWAP_WALLET_DAILY_USD, 250),
    globalDailyUsd: num(process.env.SWAP_GLOBAL_DAILY_USD, 2500),
    floorPct:       num(process.env.SWAP_INVENTORY_FLOOR_PCT, 10),
    minUsd:         num(process.env.SWAP_MIN_USD, 1),
    // Plausible USD range per mint. A feed outside this is broken or poisoned, not news.
    // Same defence as the SOL/BTC/JUP sanity bands in server.js — a shallow pool can print an
    // absurd price, and the desk must refuse rather than trade against it.
    bands: {
      [CLKN_MINT]:   [num(process.env.SWAP_BAND_CLKN_MIN,   0.0000001), num(process.env.SWAP_BAND_CLKN_MAX,   1)],
      [NORMIE_MINT]: [num(process.env.SWAP_BAND_NORMIE_MIN, 0.0000001), num(process.env.SWAP_BAND_NORMIE_MAX, 1)],
    },
    gapGuardPct: num(process.env.SWAP_GAP_GUARD_PCT, 25),
  };
}

// ── operator keypair ─────────────────────────────────────────────────────────
// Parse failure is treated as unset, never as a crash — a malformed secret disables the desk
// rather than taking the site down at boot. Copied from lib/whirlpool-vault.js:236.
let _kp = null, _kpTried = false;
function keypair() {
  if (_kpTried) return _kp;
  _kpTried = true;
  const raw = (process.env.SWAP_OPERATOR_SECRET || "").trim();
  if (!raw) return (_kp = null);
  try {
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
    _kp = Keypair.fromSecretKey(bytes);
    console.log(`[swap] desk wallet loaded: ${_kp.publicKey.toBase58()}`);
  } catch (_) {
    console.error("[swap] SWAP_OPERATOR_SECRET present but unparseable — desk disabled");
    _kp = null;
  }
  return _kp;
}
const isEnabled = () => !SWAP_KILLED && !!keypair();
const deskPubkey = () => { const k = keypair(); return k ? k.publicKey.toBase58() : null; };

// ── quote signing ────────────────────────────────────────────────────────────
// Fail closed with no fallback constant: an unset secret means we refuse to ISSUE or VERIFY,
// rather than silently signing everything with a shared default. Matches whirlpool-mm.js:52.
function quoteSecret() { return process.env.SWAP_QUOTE_SECRET || null; }
const b64u = (b) => Buffer.from(b).toString("base64url");
function signQuote(payload) {
  const s = quoteSecret(); if (!s) return null;
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", s).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function readQuote(token) {
  const s = quoteSecret(); if (!s || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot), mac = token.slice(dot + 1);
  const want = crypto.createHmac("sha256", s).update(body).digest("base64url");
  // timingSafeEqual throws on length mismatch, so length-check first.
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_) { return null; }
}

// ── prices ───────────────────────────────────────────────────────────────────
// Jupiter is the trusted source. DexScreener is deliberately NOT used as a second opinion:
// lib/whirlpool-vault.js:2154 records the owner's 2026-06-27 decision that its top-pair priceUsd
// is poisoned by mispriced pools (CLKN/JUP printed $1.19 against a real $0.0002). A known-bad
// feed does not become trustworthy by being outvoted.
//
// This is a local copy of the same 4-line call server.js makes. lib/ cannot reach server.js
// module scope, and lib/whirlpool-vault.js already carries its own copy — same tradeoff.
async function jupPrices(mints) {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Jupiter price ${res.status}`);
  return res.json();
}

/* Live USD prices for both mints, with a fetch timestamp we stamp ourselves — no price function
 * in this repo returns one, and "fair at the second of the swap" is unprovable without it.
 * Returns { ok, prices:{mint:usd}, at } or { ok:false, error }. NEVER guesses a price. */
async function livePrices() {
  const c = cfg();
  let raw;
  try { raw = await jupPrices([CLKN_MINT, NORMIE_MINT]); }
  catch (e) { return { ok: false, error: "price feed unavailable" }; }
  const at = Date.now();
  const out = {};
  for (const mint of [CLKN_MINT, NORMIE_MINT]) {
    const p = Number(raw && raw[mint] && raw[mint].usdPrice);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, error: "no price for one side" };
    const [lo, hi] = c.bands[mint] || [0, Infinity];
    if (p < lo || p > hi) {
      console.warn(`[swap] price ${p} for ${mint} outside sanity band [${lo}, ${hi}] — refusing`);
      return { ok: false, error: "price outside plausible range — swap paused" };
    }
    out[mint] = p;
  }
  // Temporal gap guard: an implausible jump since the last observation is far more likely to be
  // a manipulated shallow pool than a real move. Sit it out rather than trade through it.
  // Mirrors priceGapGuardPct in lib/whirlpool-vault.js:64.
  const last = kv.get("swapLastPrices", null);
  if (last && last.prices) {
    for (const mint of [CLKN_MINT, NORMIE_MINT]) {
      const prev = Number(last.prices[mint]);
      if (prev > 0) {
        const movePct = Math.abs(out[mint] - prev) / prev * 100;
        if (movePct > c.gapGuardPct) {
          // Record the new price so a genuine move unblocks on the next call instead of wedging.
          kv.set("swapLastPrices", { prices: out, at });
          console.warn(`[swap] ${mint} moved ${movePct.toFixed(1)}% since last read — sitting this one out`);
          return { ok: false, error: "price moved sharply — swap paused briefly, try again shortly" };
        }
      }
    }
  }
  kv.set("swapLastPrices", { prices: out, at });
  return { ok: true, prices: out, at };
}

// ── mint metadata, read from chain ───────────────────────────────────────────
// Decimals come from chain, never hardcoded, and the token program is resolved from the mint
// account's owner so a Token-2022 mint works. lib/jup-lock.js:66 is the reference.
const _mintCache = new Map();
async function mintInfo(mintStr) {
  if (_mintCache.has(mintStr)) return _mintCache.get(mintStr);
  const conn = rpc.connection("confirmed");
  const mint = new PublicKey(mintStr);
  const acct = await conn.getAccountInfo(mint);
  if (!acct) throw new Error("mint not found on-chain");
  const programId = acct.owner;
  const info = await spl.getMint(conn, mint, "confirmed", programId);
  // A transfer hook or a non-transferable mint breaks the atomicity this desk depends on, and
  // fails as an unreadable simulation error rather than a clear one. Refuse up front.
  if (programId.equals(spl.TOKEN_2022_PROGRAM_ID)) {
    let exts = [];
    try { exts = spl.getExtensionTypes(info.tlvData); } catch (_) {}
    const banned = exts.filter((e) => e === spl.ExtensionType.TransferHook || e === spl.ExtensionType.NonTransferable);
    if (banned.length) throw new Error("this token uses a transfer hook or is non-transferable — cannot be swapped safely");
  }
  const out = { mint, programId, decimals: info.decimals };
  _mintCache.set(mintStr, out);
  return out;
}

const pow10 = (d) => 10n ** BigInt(d);
/* UI string -> raw BigInt, truncating (never rounding up) past `decimals`. Rounding up would let
 * a user request marginally more than they typed and marginally more than the desk quoted. */
function toRaw(uiStr, decimals) {
  const s = String(uiStr).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return BigInt(i + (f + "0".repeat(decimals)).slice(0, decimals));
}
function fromRaw(raw, decimals) {
  const neg = raw < 0n; if (neg) raw = -raw;
  const s = (raw / pow10(decimals)).toString();
  const f = (raw % pow10(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + s + (f ? "." + f : "");
}

// ── inventory ────────────────────────────────────────────────────────────────
async function deskBalanceRaw(mintStr) {
  const k = keypair(); if (!k) return 0n;
  const { mint, programId } = await mintInfo(mintStr);
  const ata = spl.getAssociatedTokenAddressSync(mint, k.publicKey, false, programId);
  try {
    const bal = await rpc.connection("confirmed").getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch (_) { return 0n; }   // no ATA yet == zero inventory, not an error
}

/* Public inventory view. Safe to expose: it is the desk's own float, and a user needs to know
 * what is available before quoting. */
async function inventory() {
  if (!isEnabled()) return { enabled: false, reason: "desk not configured" };
  const [clkn, normie] = await Promise.all([deskBalanceRaw(CLKN_MINT), deskBalanceRaw(NORMIE_MINT)]);
  const [ci, ni] = await Promise.all([mintInfo(CLKN_MINT), mintInfo(NORMIE_MINT)]);
  const c = cfg();
  const floor = (raw) => raw * BigInt(Math.round(c.floorPct * 100)) / 10000n;
  return {
    enabled: true,
    desk: deskPubkey(),
    clkn:   { raw: clkn.toString(),   ui: fromRaw(clkn, ci.decimals),   available: fromRaw(clkn - floor(clkn), ci.decimals) },
    normie: { raw: normie.toString(), ui: fromRaw(normie, ni.decimals), available: fromRaw(normie - floor(normie), ni.decimals) },
  };
}

// ── daily caps ───────────────────────────────────────────────────────────────
// kv is volume-backed (/data/app-state.json), so caps survive a Railway redeploy. An in-memory
// counter would reset the budget on every deploy, which is the same as having no cap.
const utcDay = () => new Date().toISOString().slice(0, 10);
function capsState() {
  const s = kv.get("swapCaps", null);
  return (s && s.day === utcDay()) ? s : { day: utcDay(), global: 0, wallets: {} };
}
/* Two genuinely different situations that a single "limit reached" message would conflate:
 * a swap BIGGER than the whole daily cap (nothing has been used; the trade is just too large,
 * and telling someone "we've hit our limit" when nobody has swapped today is simply false), and
 * a cap with some budget already spent (a smaller swap would still go through). Say which, and
 * say what would fit — an unactionable rejection on a money path is a dead end. */
function capsCheck(wallet, usd) {
  const c = cfg(), s = capsState();
  const usdStr = (n) => "$" + (n >= 10 ? Math.floor(n) : n.toFixed(2));

  const mine = s.wallets[wallet] || 0;
  if (usd > c.walletDailyUsd) {
    return { ok: false, error: `single swaps are capped at ${usdStr(c.walletDailyUsd)} of value — try a smaller amount` };
  }
  if (mine + usd > c.walletDailyUsd) {
    return { ok: false, error: `that would put you over your ${usdStr(c.walletDailyUsd)} daily limit — you have about ${usdStr(c.walletDailyUsd - mine)} left today` };
  }
  if (usd > c.globalDailyUsd) {
    return { ok: false, error: `that swap is larger than the desk's whole daily limit of ${usdStr(c.globalDailyUsd)} — try a smaller amount` };
  }
  if (s.global + usd > c.globalDailyUsd) {
    return { ok: false, error: `the desk is near its daily limit — about ${usdStr(c.globalDailyUsd - s.global)} of capacity is left today` };
  }
  return { ok: true };
}
function capsCommit(wallet, usd) {
  const s = capsState();
  s.global += usd;
  s.wallets[wallet] = (s.wallets[wallet] || 0) + usd;
  kv.set("swapCaps", s);
}

// ── monitoring ───────────────────────────────────────────────────────────────
// A desk holding real money that nobody can see running is the part worth being uneasy about.
// On-chain history exists, but it requires someone to go and look — which means a drained side,
// or a bot working the spread, is invisible until the owner happens to check. Everything below
// is so the desk reports on itself.
//
// Telegram is SILENT (disable_notification) by design: these are operational events, not things
// that should buzz a phone at 3am. The low-inventory warning is the one that actually matters,
// because one-directional flow is the expected case, not the exception.
const LOG_KEY = "swapLog", LOG_MAX = 500;

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.SWAP_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;   // same rule as the rest of the app: no creds, no alerts
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML",
                             disable_web_page_preview: true, disable_notification: true }),
    });
  } catch (_) { /* an alert failing must never fail a swap that already landed */ }
}

/* Durable record of every completed swap. kv is volume-backed, so this survives redeploys —
 * an in-memory log would be wiped by the very deploys that happen most often. */
function recordSwap(entry) {
  try {
    const log = kv.get(LOG_KEY, []) || [];
    log.unshift(entry);
    kv.set(LOG_KEY, log.slice(0, LOG_MAX));
  } catch (_) { /* logging must never break a settled swap */ }
}

/* Warn once per side per UTC day when what's left drops under the threshold. Once-per-day
 * because a draining side would otherwise fire on every subsequent swap and train you to
 * ignore it — an alert you learn to skip is worse than no alert. */
async function inventoryAlert(prices) {
  const lowUsd = num(process.env.SWAP_LOW_INVENTORY_USD, 200);
  const flagged = kv.get("swapLowFlag", {}) || {};
  const day = utcDay();
  for (const [mint, label] of [[CLKN_MINT, "CLKN"], [NORMIE_MINT, "NORMIE"]]) {
    try {
      const info = await mintInfo(mint);
      const raw = await deskBalanceRaw(mint);
      const c = cfg();
      const avail = raw - (raw * BigInt(Math.round(c.floorPct * 100)) / 10000n);
      const usd = Number(fromRaw(avail, info.decimals)) * (prices[mint] || 0);
      if (usd < lowUsd) {
        if (flagged[label] === day) continue;             // already said so today
        flagged[label] = day; kv.set("swapLowFlag", flagged);
        await notify(`⚠️ <b>Swap desk low on ${label}</b>\n\nAbout <b>$${usd.toFixed(0)}</b> left to trade `
          + `(a ${c.floorPct}% reserve is held back on top).\n\nTop it up, or that side stops filling.`);
      } else if (flagged[label]) {
        delete flagged[label]; kv.set("swapLowFlag", flagged);   // recovered — re-arm the warning
      }
    } catch (_) { /* an alert is never worth throwing over */ }
  }
}

/* Recent swaps + today's cap usage, for the operator view. */
function stats() {
  const caps = capsState();
  return {
    enabled: isEnabled(), desk: deskPubkey(),
    day: caps.day, globalUsd: caps.global, wallets: caps.wallets,
    limits: { walletDailyUsd: cfg().walletDailyUsd, globalDailyUsd: cfg().globalDailyUsd, spreadBps: cfg().spreadBps },
    recent: (kv.get(LOG_KEY, []) || []).slice(0, 50),
  };
}

// ── quote ────────────────────────────────────────────────────────────────────
/* Price an exact-in swap. Returns a signed, short-lived quote the client hands back to build().
 * Every rejection is a plain sentence a user can act on — never a raw error. */
async function quote({ inMint, outMint, amountUi, wallet }) {
  if (!isEnabled()) return { ok: false, error: "the swap desk is not live yet" };
  if (!quoteSecret()) return { ok: false, error: "the swap desk is not configured" };
  const pair = new Set([inMint, outMint]);
  if (pair.size !== 2 || !pair.has(CLKN_MINT) || !pair.has(NORMIE_MINT)) {
    return { ok: false, error: "this desk swaps CLKN and NORMIE only" };
  }
  let owner; try { owner = new PublicKey(wallet).toBase58(); } catch (_) { return { ok: false, error: "connect a wallet first" }; }

  const c = cfg();
  const [inI, outI] = await Promise.all([mintInfo(inMint), mintInfo(outMint)]);
  const inRaw = toRaw(amountUi, inI.decimals);
  if (inRaw == null || inRaw <= 0n) return { ok: false, error: "enter an amount" };

  const px = await livePrices();
  if (!px.ok) return { ok: false, error: px.error };

  const inUsd = Number(fromRaw(inRaw, inI.decimals)) * px.prices[inMint];
  if (inUsd < c.minUsd) return { ok: false, error: `minimum swap is about $${c.minUsd}` };

  const cap = capsCheck(owner, inUsd);
  if (!cap.ok) return cap;

  // Dollar-for-dollar, less the spread. All integer maths: floats are fine for displaying a
  // number and wrong for moving one.
  const scale = pow10(outI.decimals) * 1000000n;
  const rate = BigInt(Math.round((px.prices[inMint] / px.prices[outMint]) * 1e6));
  const gross = inRaw * rate * pow10(outI.decimals) / (pow10(inI.decimals) * 1000000n);
  const outRaw = gross * BigInt(10000 - Math.round(c.spreadBps)) / 10000n;
  if (outRaw <= 0n) return { ok: false, error: "amount too small to swap" };
  void scale;

  const have = await deskBalanceRaw(outMint);
  const floor = have * BigInt(Math.round(c.floorPct * 100)) / 10000n;
  if (outRaw > have - floor) {
    return { ok: false, error: `the desk doesn't hold enough ${outMint === CLKN_MINT ? "CLKN" : "NORMIE"} for that right now`,
             available: fromRaw(have - floor, outI.decimals) };
  }

  const exp = Date.now() + c.quoteTtlMs;
  const payload = { inMint, outMint, inRaw: inRaw.toString(), outRaw: outRaw.toString(),
                    pIn: px.prices[inMint], pOut: px.prices[outMint], at: px.at, usd: inUsd, owner, exp };
  return {
    ok: true,
    quote: signQuote(payload),
    inUi: fromRaw(inRaw, inI.decimals),
    outUi: fromRaw(outRaw, outI.decimals),
    priceIn: px.prices[inMint], priceOut: px.prices[outMint],
    usd: inUsd, spreadBps: c.spreadBps, expiresAt: exp, priceAt: px.at,
  };
}

// ── build ────────────────────────────────────────────────────────────────────
// Pending builds, keyed by an opaque token. Holds the EXACT message bytes we constructed; submit
// compares against these. In-memory on purpose: a build is only valid for the next 60 seconds,
// and a restart should invalidate every outstanding one rather than resurrect it.
const _pending = new Map();
const BUILD_TTL_MS = 60 * 1000;
function sweepPending() {
  const now = Date.now();
  for (const [k, v] of _pending) if (v.exp < now) _pending.delete(k);
}

/* Re-price, construct the two-leg transaction, simulate it, and stash its message bytes. */
async function build({ quote: token }) {
  if (!isEnabled()) return { ok: false, error: "the swap desk is not live yet" };
  const q = readQuote(token);
  if (!q) return { ok: false, error: "that quote isn't valid — get a fresh one" };
  if (Date.now() > q.exp) return { ok: false, error: "that quote expired — get a fresh one" };

  const c = cfg();
  // THE "fair at the second of the swap" GUARANTEE. The user saw a price; the chain will settle
  // a moment later. Re-read and refuse if the market moved beyond tolerance, rather than
  // honouring a stale number in either party's favour.
  const px = await livePrices();
  if (!px.ok) return { ok: false, error: px.error };
  for (const [mint, quoted] of [[q.inMint, q.pIn], [q.outMint, q.pOut]]) {
    const drift = Math.abs(px.prices[mint] - quoted) / quoted * 10000;
    if (drift > c.maxDriftBps) {
      return { ok: false, error: "the price moved while you were deciding — here's a fresh quote", requote: true };
    }
  }

  const owner = new PublicKey(q.owner);
  const k = keypair();
  const [inI, outI] = await Promise.all([mintInfo(q.inMint), mintInfo(q.outMint)]);
  const inRaw = BigInt(q.inRaw), outRaw = BigInt(q.outRaw);

  // Inventory is re-checked here too: the quote may have been issued before another swap drained it.
  const have = await deskBalanceRaw(q.outMint);
  const floor = have * BigInt(Math.round(c.floorPct * 100)) / 10000n;
  if (outRaw > have - floor) return { ok: false, error: "the desk just ran short on that side — try a smaller amount" };

  const cap = capsCheck(q.owner, q.usd);
  if (!cap.ok) return cap;

  const userIn  = spl.getAssociatedTokenAddressSync(inI.mint,  owner,        false, inI.programId);
  const userOut = spl.getAssociatedTokenAddressSync(outI.mint, owner,        false, outI.programId);
  const deskIn  = spl.getAssociatedTokenAddressSync(inI.mint,  k.publicKey,  false, inI.programId);
  const deskOut = spl.getAssociatedTokenAddressSync(outI.mint, k.publicKey,  false, outI.programId);

  const { blockhash } = await rpc.connection("confirmed").getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, recentBlockhash: blockhash });

  // The USER pays rent for their own receiving account. A desk-funded ATA is a drain vector —
  // an attacker would spam account creations to bleed the desk's SOL with no swap ever settling.
  tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(owner, userOut, owner, outI.mint, outI.programId));
  // transferChecked, not transfer: it names the mint and decimals in the instruction, so the
  // wallet's own simulator can show the user exactly what moves. That materially lowers the
  // "may be malicious" score on a multi-signer transaction (public/airdrop-engine.js:100).
  tx.add(spl.createTransferCheckedInstruction(userIn, inI.mint, deskIn, owner, inRaw, inI.decimals, [], inI.programId));
  tx.add(spl.createTransferCheckedInstruction(deskOut, outI.mint, userOut, k.publicKey, outRaw, outI.decimals, [], outI.programId));

  // Simulate before handing it over — never make a user sign a transaction we already know fails.
  try {
    const sim = await rpc.connection("confirmed").simulateTransaction(tx, undefined, [owner]);
    if (sim && sim.value && sim.value.err) {
      const logs = (sim.value.logs || []).join(" ");
      if (/insufficient funds|InsufficientFunds/i.test(logs)) return { ok: false, error: "not enough balance in your wallet for that swap" };
      return { ok: false, error: "that swap can't complete right now" };
    }
  } catch (_) { /* simulation is best-effort; a transient RPC failure shouldn't block a good swap */ }

  const message = tx.serializeMessage();
  const buildToken = crypto.randomBytes(24).toString("base64url");
  sweepPending();
  // inMint/outMint/inUi/outUi ride along purely so the settle path can log and alert without
  // re-deriving them from the transaction after the fact.
  _pending.set(buildToken, { message, owner: q.owner, usd: q.usd,
    inMint: q.inMint, outMint: q.outMint,
    inUi: fromRaw(inRaw, inI.decimals), outUi: fromRaw(outRaw, outI.decimals),
    exp: Date.now() + BUILD_TTL_MS });

  return {
    ok: true, buildToken,
    txBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    outUi: fromRaw(outRaw, outI.decimals), inUi: fromRaw(inRaw, inI.decimals),
  };
}

// ── submit ───────────────────────────────────────────────────────────────────
/* ⚠️⚠️ THE SAFETY-CRITICAL FUNCTION IN THIS FILE. ⚠️⚠️
 *
 * The desk keypair can move the desk's entire inventory. If this signed whatever arrived, an
 * attacker would submit a transaction whose "out leg" pays them the whole balance, and the
 * server would sign it. Total loss, and the natural implementation is precisely the vulnerable one.
 *
 * The defence is BYTE EQUALITY against the message this module built seconds earlier — not
 * instruction inspection. Inspection is a whitelist, and a whitelist is a list of the attacks you
 * thought of. Byte equality is a fingerprint: one different lamport, one extra instruction, one
 * reordered account and it fails closed.
 *
 * Signatures live outside the message, so the user's signature does not perturb the comparison.
 * Do not "optimise" this into a parse-and-validate. */
async function verifyAndSign({ buildToken, signedTxBase64 }) {
  if (!isEnabled()) return { ok: false, error: "the swap desk is not live yet" };
  sweepPending();
  const pend = _pending.get(buildToken);
  if (!pend) return { ok: false, error: "that swap expired before it was signed — start again" };
  // Single-use: delete BEFORE doing any work, so a double-submit cannot get two signatures.
  _pending.delete(buildToken);

  let tx;
  try { tx = Transaction.from(Buffer.from(String(signedTxBase64), "base64")); }
  catch (_) { return { ok: false, error: "could not read that signed transaction" }; }

  const got = tx.serializeMessage();
  if (got.length !== pend.message.length || !crypto.timingSafeEqual(got, pend.message)) {
    console.error("[swap] REJECTED: submitted message does not match the one built. Possible tampering.");
    return { ok: false, error: "that transaction doesn't match the swap that was quoted" };
  }

  const k = keypair();
  tx.partialSign(k);
  if (!tx.verifySignatures()) return { ok: false, error: "the transaction is missing your signature" };

  let sig;
  try {
    sig = await rpc.connection("confirmed").sendRawTransaction(tx.serialize(), {
      skipPreflight: true, preflightCommitment: "confirmed", maxRetries: 5,
    });
  } catch (e) {
    // sendTransaction is non-idempotent (lib/rpc.js:87): an error here does NOT prove the
    // transaction failed to broadcast. Never auto-retry — say so and let the user check.
    console.error("[swap] send failed:", e.message);
    return { ok: false, error: "the network didn't confirm the send — check your wallet before retrying" };
  }

  // Commit the cap only once the swap is actually on the wire.
  capsCommit(pend.owner, pend.usd);

  // Report it. Everything below is best-effort and deliberately AFTER the send: the swap has
  // already settled on-chain, so a failed log or a Telegram outage must not turn a successful
  // swap into an error the user sees.
  const entry = { at: Date.now(), wallet: pend.owner, usd: pend.usd,
                  inMint: pend.inMint, outMint: pend.outMint,
                  inUi: pend.inUi, outUi: pend.outUi, signature: sig };
  recordSwap(entry);
  const sym = (m) => (m === CLKN_MINT ? "CLKN" : m === NORMIE_MINT ? "NORMIE" : "?");
  notify(`🔄 <b>Swap filled</b>\n\n<b>${entry.inUi} ${sym(pend.inMint)}</b> → <b>${entry.outUi} ${sym(pend.outMint)}</b>`
    + `\n$${Number(pend.usd).toFixed(2)} · ${String(pend.owner).slice(0, 4)}…${String(pend.owner).slice(-4)}`
    + `\n\n<a href="https://solscan.io/tx/${sig}">View on Solscan</a>`).catch(() => {});
  livePrices().then((p) => { if (p.ok) return inventoryAlert(p.prices); }).catch(() => {});

  return { ok: true, signature: sig };
}

module.exports = {
  CLKN_MINT, NORMIE_MINT,
  isEnabled, deskPubkey, inventory, quote, build, verifyAndSign, stats,
  // Exported for tests only. `pending` is the in-memory build map: a test needs to seed it to
  // prove verifyAndSign rejects a tampered transaction, and that property is a precondition to
  // ever arming this desk (docs/SWAP_DESIGN.md §6). Seeding it grants nothing on its own — the
  // byte-equality check and the user's own signature still have to pass.
  _internal: { toRaw, fromRaw, signQuote, readQuote, cfg, pending: _pending },
};
