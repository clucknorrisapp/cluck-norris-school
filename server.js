const express = require("express");
const path = require("path");
const { join } = path;
const fs = require("fs");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { createSign, createHash } = require("crypto");
const hatchery = require("./hatchery");

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
  const map = {
    ai:         { emoji: "🤖", name: "AI TUTOR EXTENDED",        detail: "+20 questions" },
    airdrop:    { emoji: "💰", name: "AIRDROP TOOL UNLOCKED",    detail: "1 batch session" },
    buyspecial: { emoji: "📈", name: "BUY-COMP UNLOCKED",        detail: "7 days unlimited" },
    score:      { emoji: "🪧", name: "CLUCK SCORE CARD",         detail: "PNG generated" },
  };
  const m = map[tool] || { emoji: "⚡", name: `${tool.toUpperCase()} UNLOCKED`, detail: "" };
  const bonusBadge = isHolderBonus ? " · 5× HOLDER BONUS 🏆" : "";
  const senderShort = senderWallet ? `${senderWallet.slice(0, 4)}…${senderWallet.slice(-4)}` : "verified on-chain";
  const sigLink = signature ? `\n<a href="https://solscan.io/tx/${signature}">↗ View on Solscan</a>` : "";
  const caption =
    `${m.emoji} <b>${m.name}</b>${bonusBadge}\n` +
    `<b>${paidAmount}</b> CLKN paid · ${m.detail}\n` +
    `Sender: <code>${senderShort}</code>` +
    sigLink;
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

// The Hatchery (token creator) — mounted before the global JSON parser so its
// own larger body limit handles the base64 logo upload instead of the 100kb default.
app.use("/api/hatchery", hatchery.router);

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
app.get("/api/holders", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const { mint } = req.query;
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  console.log("-> Holders request for mint:", mint);
  console.log("-> Helius key present:", !!HELIUS_KEY);
  if (!mint) return res.status(400).json({ success: false, error: "Missing mint" });
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

// -- Jupiter Lock -- hardcoded from lock.jup.ag --
app.get("/api/locks", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const { mint } = req.query;
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  if (!mint) return res.status(400).json({ success: false, error: "Missing mint" });
  if (!HELIUS_KEY) return res.status(500).json({ success: false, error: "Missing HELIUS_API_KEY" });
  const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  try {
    const response = await fetch(HELIUS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "locks",
        method: "getTokenAccounts",
        params: { page: 1, limit: 1000, mint, owner: JUPITER_LOCK_PROGRAM, displayOptions: { showZeroBalance: false } }
      })
    });
    const data = await response.json();
    console.log("<- Helius locks status:", response.status, JSON.stringify(data).slice(0, 300));
    const accounts = data.result?.token_accounts || [];
    const totalLocked = accounts.reduce((sum, a) => sum + (parseInt(a.amount) || 0), 0);
    return res.status(200).json({ success: true, lockCount: accounts.length, totalLocked, locks: accounts.slice(0, 10) });
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
    if (accounts.length > 0) {
      const balance = accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
      return { isHolder: balance > 0, balance };
    }
    return { isHolder: false, balance: 0 };
  } catch(e) {
    console.error("Holder check error:", e.message);
    return { isHolder: false, balance: 0 };
  }
}

app.post("/api/claim", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { wallet, score, total, pct, source } = req.body;
  if (!wallet || wallet.length < 32) return res.status(400).json({ success: false, error: "Invalid wallet" });
  try {
    // Check for duplicates
    const rows = await getSheetRows();
    const exists = rows.some(row => row[0] === wallet);
    if (exists) return res.status(200).json({ success: true, message: "Already claimed" });
    // Check if CLKN holder
    const { isHolder, balance } = await checkCLKNHolder(wallet);
    const holderStatus = isHolder ? "[OK] YES" : "[ERR] NO";
    const date = new Date().toISOString();
    await appendToSheet([wallet, score, total, pct, date, holderStatus, balance, source || "CHALLENGE"]);
    console.log(`[WIN] New claim: ${wallet} -- ${score}/${total} (${pct}%) -- CLKN Holder: ${holderStatus} (${balance})`);
    return res.status(200).json({ success: true, isHolder, balance });
  } catch(err) {
    console.error("Sheets error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/claims", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const auth = req.query.key;
  if (auth !== "firechicken007") return res.status(401).json({ success: false, error: "Unauthorized" });
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
// The base must be unique per tool so a user can't pay 100 CLKN with a "score" amount
// and reuse the verification to unlock a 500-CLKN tool. Math.floor(amount) checks this.
// Note: `holders` is intentionally NOT in this table — the /holders deep-view tool
// is kept internal (URL accessible but unadvertised) for the project team's own use.
// If we ever expose it publicly again, just add holders here and uncomment the gate
// wiring in public/holders.html.
const TOOL_GRANTS = {
  ai:         { cost: 500, grants: { questions: 20 } },
  airdrop:    { cost: 100, grants: { sessions: 1 } },
  buyspecial: { cost: 500, grants: { hoursOfAccess: 168 } },
  score:      { cost: 100, grants: { cards: 1 } },
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
        const isHolderBonus = senderBalance !== null && senderBalance >= HOLDER_BONUS_THRESHOLD;
        const baseGrants = TOOL_GRANTS[tool].grants;
        const grants = {};
        for (const k of Object.keys(baseGrants)) {
          grants[k] = isHolderBonus ? baseGrants[k] * HOLDER_BONUS_MULTIPLIER : baseGrants[k];
        }

        console.log(`[OK] tool=${tool} verified ${diff} CLKN · sender=${senderWallet?.slice(0,8) || "?"} remaining=${senderBalance} bonus=${isHolderBonus}`);

        // Fire Telegram notification — every paid unlock pings the Cluck Norris group
        // so the community sees real on-chain product usage in real time.
        notifyToolUnlock(tool, diff, senderWallet, isHolderBonus, sig.signature);

        return res.status(200).json({
          success: true,
          tool,
          amountReceived: diff,
          signature: sig.signature,
          senderWallet,
          senderBalance,
          holderBonus: isHolderBonus,
          grants,
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

// -- Ask Cluck Norris (Claude AI) --
app.post("/api/ask-cluck", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { question, context } = req.body;
  if (!question || question.trim().length < 3) {
    return res.status(400).json({ success: false, error: "Question too short" });
  }

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
${context ? `\nThe student is currently studying: ${context}` : ''}`;

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
  if (!mint || mint.length < 32) {
    return res.status(400).json({ success: false, error: "Invalid mint" });
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
    const [holdersData, dexData, supplyData, mintInfoData, largestData] = await Promise.allSettled([
      // Holder count — same paginated walk as /api/holders, capped at 5 pages for speed
      (async () => {
        const owners = new Set();
        for (let page = 1; page <= 5; page++) {
          const d = await rpcCall(`score-holders-${page}`, "getTokenAccounts", {
            page, limit: 1000, mint, displayOptions: { showZeroBalance: false }
          });
          const accounts = d?.result?.token_accounts || [];
          if (!accounts.length) break;
          for (const a of accounts) {
            if (parseInt(a.amount) > 0) owners.add(a.owner);
          }
          if (accounts.length < 1000) break;
        }
        return owners.size;
      })(),
      fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(r => r.json()),
      rpcCall("score-supply", "getTokenSupply", [mint]),
      rpcCall("score-mint-info", "getAccountInfo", [mint, { encoding: "jsonParsed" }]),
      rpcCall("score-largest", "getTokenLargestAccounts", [mint]),
    ]);

    // Extract data with safe defaults
    const holderCount = holdersData.status === "fulfilled" ? holdersData.value : null;
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
    const rawSupply = supplyData.status === "fulfilled" ? supplyData.value?.result?.value?.amount : null;
    const decimals = supplyData.status === "fulfilled" ? (supplyData.value?.result?.value?.decimals || 9) : 9;
    const supplyTokens = rawSupply ? parseInt(rawSupply) / Math.pow(10, decimals) : null;
    const mintParsed = mintInfoData.status === "fulfilled" ? mintInfoData.value?.result?.value?.data?.parsed?.info : null;
    const mintAuthority = mintParsed ? mintParsed.mintAuthority : undefined; // null = revoked, string = not revoked
    const freezeAuthority = mintParsed ? mintParsed.freezeAuthority : undefined;
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
    // Concentration: softened to acknowledge that legitimate LP, team locks, vesting
    // contracts, and the AMM pool itself routinely sit in the top-10 and aren't actual
    // rug risk. Until we port the full LP/lock classifier (v2), 25% is the practical
    // "excellent" floor.
    //   25% → 100 (excellent — likely LP + tiny human concentration)
    //   35% → 80   45% → 60   55% → 40
    //   65% → 20   75%+ → 0   (real whale risk — one cluster controls the float)
    f.concentration = top10Share == null ? null : Math.max(0, Math.min(100, 100 - Math.max(0, top10Share - 0.25) * 200));
    f.volume = vol24h == null ? null : Math.min(100, Math.log10(Math.max(1, vol24h)) * 25); // ~$10k = 100
    // Pool type / graduation factor removed — wasn't discriminating well and we can't
    // properly distinguish "on bonding curve" from "LP-only AMM pool" without the
    // full holders classifier. isGraduated info still exposed in the response for
    // reference but doesn't count toward the score.

    // Weighted average (skip null factors, redistribute weight)
    // Dropped graduation (10%); redistributed 5/5 to holders and liquidity.
    const weights = { holders: 20, liquidity: 25, mintAuthority: 15, freezeAuthority: 10, concentration: 20, volume: 10 };
    let totalWeight = 0;
    let weightedSum = 0;
    for (const k of Object.keys(weights)) {
      if (f[k] != null) {
        weightedSum += f[k] * weights[k];
        totalWeight += weights[k];
      }
    }
    const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

    // Standard academic grading scale — what every reader expects.
    //   95+ → A+   90+ → A   80+ → B   70+ → C   60+ → D   <60 → F
    const grade = score == null ? "—"
      : score >= 95 ? "A+"
      : score >= 90 ? "A"
      : score >= 80 ? "B"
      : score >= 70 ? "C"
      : score >= 60 ? "D"
      : "F";

    const verdict = score == null
      ? "Couldn't pull enough data to score this one. Cluck shrugs."
      : score >= 90 ? "Cluck Norris approves. Distribution, liquidity, authorities — all check out. No red flags."
      : score >= 80 ? "Healthy bird. Solid reads across the board. Normal caution applies."
      : score >= 70 ? "Decent. Worth a deeper look at the weaker factors before sizing up."
      : score >= 60 ? "Watch the eggs. A couple yellow flags here — research before getting big."
      : score >= 45 ? "Cluck raises an eyebrow. Real concerns in the breakdown below — tread carefully."
      : "Don't bring this back to the schoolyard. Multiple red flags. Cluck's not impressed.";

    return res.status(200).json({
      success: true,
      mint,
      ticker: topPair?.baseToken?.symbol || null,
      name: topPair?.baseToken?.name || null,
      score,
      grade,
      verdict,
      factors: {
        holders:          { score: f.holders          == null ? null : Math.round(f.holders),          weight: weights.holders,          value: holderCount },
        liquidity:        { score: f.liquidity        == null ? null : Math.round(f.liquidity),        weight: weights.liquidity,        value: liqUsd, ratio: liqRatio, poolCount, dexCount: dexFamilies.size, dexes: [...dexFamilies], multiDexBonus },
        mintAuthority:    { score: f.mintAuthority,    weight: weights.mintAuthority,    revoked: mintAuthority === null },
        freezeAuthority:  { score: f.freezeAuthority,  weight: weights.freezeAuthority,  revoked: freezeAuthority === null },
        concentration:    { score: f.concentration    == null ? null : Math.round(f.concentration),    weight: weights.concentration,    top10Share: top10Share, top10RawShare, top10HumanShare, lpFilteredFromTop20: lpInTop20 },
        volume:           { score: f.volume           == null ? null : Math.round(f.volume),           weight: weights.volume,           value: vol24h },
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
};

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
  const minBalance = Math.max(0, parseFloat(req.query.minBalance) || 0);

  if (!mint || mint.length < 32) {
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
    const [supplyData] = await Promise.all([
      rpcCall("snap-supply", "getTokenSupply", [mint]),
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

    // Filter
    let filtered = holders;
    if (excludeNonHuman) filtered = filtered.filter(h => h.type === "human");
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
        if (!acc) { h.category = "lp"; return; } // pure authority PDA → AMM pool
        const prog = acc.owner;
        if (DEX_PROGRAMS.has(prog)) h.category = "lp";
        else if (LOCKER_PROGRAMS.has(prog)) h.category = "locker";
        else h.category = "contract";
      });
    }
    excluded.forEach(h => { if (!h.category) h.category = "contract"; });
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
      filters: { excludeNonHuman, minBalance },
      stats: {
        rawHolderCount,
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
  if (wallet.length < 32 || wallet.length > 44 || mint.length < 32 || mint.length > 44) {
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
      for (let i = 0; i < addrs.length; i += 100) {
        const batch = addrs.slice(i, i + 100);
        try {
          const info = await rpcCall(`trace-cplabel-${i}`, "getMultipleAccounts", [
            batch, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }
          ]);
          const vals = info?.result?.value || [];
          batch.forEach((a, j) => {
            const acc = vals[j];
            if (acc && PROGRAM_LABELS[acc.owner]) labelByAddr.set(a, PROGRAM_LABELS[acc.owner]);
          });
        } catch {}
      }
      for (const r of rows) {
        if (r.counterpartyType === "contract" && !r.counterpartyLabel) {
          r.counterpartyLabel = labelByAddr.get(r.counterparty) || "Contract";
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
        label = r.counterpartyLabel || null;
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

    return res.status(200).json({
      success: true, wallet, mint, decimals, truncated,
      generatedAt: new Date().toISOString(),
      summary, counterparties, transactions: rows,
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

// -- ROSE Buy Competition Analyzer --
// The Hatchery — guided token creator. Unlisted: not linked from nav anywhere,
// reachable only by direct URL while in private testing.
app.get("/hatchery", (req, res) => {
  res.sendFile(join(__dirname, "public", "hatchery.html"));
});

app.get("/rose", (req, res) => {
  res.sendFile(join(__dirname, "public", "rose.html"));
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
    const host = req.get("host") || "clucknorris.app";
    const proto = req.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const cardUrl = `${proto}://${host}/api/cluck-card?mint=${encodeURIComponent(mint)}`;
    const pageUrl = `${proto}://${host}/score?mint=${encodeURIComponent(mint)}`;
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
// Buys below this USD value don't fire a Telegram notification. Default $0.50
// catches split-routing halves of $1 buys via Jupiter aggregator while still
// filtering bot dust. Override via env var.
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "0.5");
// Sells use the same floor by default, so both sides are reported on equal
// terms. Set MIN_SELL_USD to give the sell side its own threshold.
const MIN_SELL_USD = parseFloat(process.env.MIN_SELL_USD || String(MIN_BUY_USD));

// Cached SOL/USD price for converting non-stable quote amounts into USD.
// Refreshed every 5 minutes from CoinGecko (with DexScreener fallback). The
// hardcoded value is only used if BOTH price sources fail — it'll be wrong
// the moment SOL moves, but better than skipping all buy alerts.
let cachedSolUsd = 100;
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
    console.warn("[TELEGRAM] DexScreener SOL fallback failed, using cached/hardcoded:", e.message);
  }
  return cachedSolUsd;
}

// Convert a trade's quote leg (SOL/USDC/USDT) into USD. Works for buys and
// sells alike — both carry the same { quote: { mint, amount } } shape.
function quoteUsdValue(trade) {
  const meta = QUOTE_TOKENS[trade.quote.mint];
  if (!meta) return null;
  if (meta.isStable) return trade.quote.amount;
  return trade.quote.amount * cachedSolUsd; // SOL/wSOL × cached USD price
}

// Per-pool last-seen signature. Refreshed each poll cycle. Map of pool address → last sig.
// New pools (discovered via DexScreener refresh) start with null = first-run-skip-history.
const lastSeenByPool = new Map();
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
        q[bc.mint] = (q[bc.mint] || 0) + amt;
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
  let quoteMint = null, quoteAmount = 0;
  for (const [mint, delta] of Object.entries(poolQuotes)) {
    if (Math.abs(delta) > quoteAmount) { quoteMint = mint; quoteAmount = Math.abs(delta); }
  }
  if (!quoteMint || quoteAmount <= 0) return null;

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
  const priceLine = priceStr ? `\nPrice: <b>${priceStr}</b>` : "";

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
  const priceLine = priceStr ? `\nPrice: <b>${priceStr}</b>` : "";

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
const recentlyNotifiedSigs = new Set();
function rememberSig(sig) {
  recentlyNotifiedSigs.add(sig);
  // Keep set bounded — drop oldest if it grows past 1000 entries
  if (recentlyNotifiedSigs.size > 1000) {
    const first = recentlyNotifiedSigs.values().next().value;
    recentlyNotifiedSigs.delete(first);
  }
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
        params: [poolAddress, { limit: 15 }],
      }),
    });
    const sigsData = await sigsRes.json();
    const sigs = sigsData?.result || [];
    if (!sigs.length) return;

    // First-run for this pool — record the head and skip history
    const lastSeen = lastSeenByPool.get(poolAddress);
    if (lastSeen === undefined || lastSeen === null) {
      lastSeenByPool.set(poolAddress, sigs[0].signature);
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
      lastSeenByPool.set(poolAddress, sigs[0].signature);
      return;
    }
    newSigs.reverse();

    const enhancedRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: newSigs }),
    });
    const txns = await enhancedRes.json();
    if (!Array.isArray(txns)) return;

    for (const tx of txns) {
      if (recentlyNotifiedSigs.has(tx.signature)) continue;

      // Pool-centric detection — classifies buy vs sell from the CLKN pool's
      // own balance change, so Jupiter-routed trades are caught too.
      const trade = detectClknTrade(tx);
      if (!trade) {
        console.log(`[TELEGRAM] No buy/sell in tx ${tx.signature?.slice(0,8)} (pool ${poolAddress.slice(0,6)})`);
        continue;
      }

      const usd = quoteUsdValue(trade);
      const quoteMeta = QUOTE_TOKENS[trade.quote.mint] || { symbol: '?' };
      const usdStr = usd == null ? "no USD" : "$" + usd.toFixed(4);
      const floor = trade.action === "sell" ? MIN_SELL_USD : MIN_BUY_USD;
      console.log(`[TELEGRAM] ${trade.action === "sell" ? "Sell" : "Buy"} detected (pool ${poolAddress.slice(0,6)}/${pool.dexId}, source ${tx.source || "?"}): ${trade.clknAmount.toFixed(0)} CLKN for ${trade.quote.amount} ${quoteMeta.symbol} (${usdStr}) by ${trade.trader ? trade.trader.slice(0,6) : "unknown"} · sig ${tx.signature.slice(0,8)}`);
      if (usd == null || usd < floor) {
        console.log(`[TELEGRAM] Skipping (${usdStr} < $${floor})`);
        rememberSig(tx.signature); // remember so other pools don't re-process it
        continue;
      }
      if (trade.action === "sell") await notifyClknSell(trade, tx, pool, usd, HELIUS_KEY);
      else                         await notifyClknBuy(trade, tx, pool, usd, HELIUS_KEY);
      rememberSig(tx.signature);
    }

    lastSeenByPool.set(poolAddress, sigs[0].signature);
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
  } else {
    console.log(`[TELEGRAM] Bot env vars not set — notifications disabled`);
  }
});
