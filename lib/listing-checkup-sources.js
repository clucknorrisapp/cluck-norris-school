"use strict";
// Listing Checkup — source adapters (docs/LISTING_CHECKUP_PLAN.md, table "Sources for v1").
//
// Every adapter has the same shape and reads through `deps.fetchJson(url, opts)` / `deps.fetchText`
// so the test suite feeds fixtures and CI never touches the network:
//   { id, label, tier, pageUrl(mint), fixUrl(mint, shown), read(mint, deps) → { found, shown, url } }
// `shown` uses the canonical field names; a field the source CANNOT show is left undefined, a
// field it shows empty is "". Adapters throw on transport/shape errors — the runner turns that
// into an `unread` row; they return { found:false } when the source answers "no such token".
//
// Fix links point at the page where the PROJECT updates its own record. We never submit anything.

const { SOL_ADDR_RE } = require("./listing-checkup");

const pick = (o, k) => (o && o[k] != null ? o[k] : "");
const firstUrl = (arr, pred) => { for (const w of Array.isArray(arr) ? arr : []) { const u = typeof w === "string" ? w : (w && w.url); if (u && (!pred || pred(w, u))) return u; } return ""; };
function assertMint(mint) { if (!SOL_ADDR_RE.test(String(mint || ""))) throw new Error("bad mint"); }
async function getJson(deps, url, opts) {
  const r = await deps.fetchJson(url, opts);
  if (r && typeof r === "object" && "__status" in r) {
    if (r.__status === 404) return { __notFound: true };
    if (r.__status >= 400) throw new Error(`${new URL(url).hostname} answered ${r.__status}`);
  }
  return r;
}

// 1. The on-chain record — Metaplex metadata via Helius DAS getAsset + the URI JSON. This is what
//    most aggregators copy, so the report leads with it.
const onchain = {
  id: "onchain", label: "On-chain metadata (Metaplex)", tier: "preview",
  pageUrl: (mint) => `https://solscan.io/token/${mint}#metadata`,
  fixUrl: () => "https://clucknorris.app/hatchery#metadata",
  async read(mint, deps) {
    assertMint(mint);
    const asset = await deps.rpcCall("listing-asset", "getAsset", [mint]);
    if (!asset || asset.error || !asset.content) return { found: false };
    const meta = asset.content.metadata || {};
    const links = asset.content.links || {};
    const uri = pick(asset.content, "json_uri");
    let json = null;
    if (uri && deps.fetchJson) { try { json = await deps.fetchJson(uri, { timeoutMs: 10000 }); } catch (_) { json = null; } }
    const ext = (json && (json.extensions || json.properties || {})) || {};
    const shown = {
      name: pick(meta, "name") || pick(json, "name"),
      symbol: pick(meta, "symbol") || pick(json, "symbol"),
      logo: pick(links, "image") || pick(json, "image"),
      website: pick(links, "external_url") || pick(json, "external_url") || pick(ext, "website"),
      x: pick(ext, "twitter") || pick(json, "twitter"),
      telegram: pick(ext, "telegram") || pick(json, "telegram"),
      discord: pick(ext, "discord") || pick(json, "discord"),
      description: pick(meta, "description") || pick(json, "description"),
    };
    return { found: true, shown, url: `https://solscan.io/token/${mint}#metadata`, mutable: asset.mutable };
  },
};

// 2. CoinGecko — free API; no key needed for the contract lookup at our volume.
const coingecko = {
  id: "coingecko", label: "CoinGecko", tier: "preview",
  pageUrl: () => "https://www.coingecko.com/",
  fixUrl: (mint, shown) => (shown && shown._cgId) ? `https://www.coingecko.com/en/coins/${shown._cgId}#update-request` : "https://support.coingecko.com/hc/en-us/requests/new",
  async read(mint, deps) {
    assertMint(mint);
    const j = await getJson(deps, `https://api.coingecko.com/api/v3/coins/solana/contract/${mint}`, { timeoutMs: 15000 });
    if (!j || j.__notFound || j.error || !j.id) return { found: false };
    const l = j.links || {};
    const shown = {
      _cgId: j.id,
      name: pick(j, "name"), symbol: pick(j, "symbol"),
      website: firstUrl(l.homepage), x: pick(l, "twitter_screen_name"),
      telegram: pick(l, "telegram_channel_identifier"), discord: firstUrl(l.chat_url, (w, u) => /discord/i.test(u)),
      logo: pick(j.image || {}, "large") || pick(j.image || {}, "small"),
      description: pick(j.description || {}, "en"),
    };
    return { found: true, shown, url: `https://www.coingecko.com/en/coins/${j.id}` };
  },
};

// 3. GeckoTerminal — token + the /info endpoint that carries websites and socials.
const geckoterminal = {
  id: "geckoterminal", label: "GeckoTerminal", tier: "preview",
  pageUrl: (mint) => `https://www.geckoterminal.com/solana/tokens/${mint}`,
  fixUrl: (mint) => `https://www.geckoterminal.com/solana/tokens/${mint}?tab=update`,
  async read(mint, deps) {
    assertMint(mint);
    const base = await getJson(deps, `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`, { timeoutMs: 15000 });
    if (!base || base.__notFound || !base.data) return { found: false };
    const a = base.data.attributes || {};
    let info = {};
    try { const inf = await getJson(deps, `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/info`, { timeoutMs: 15000 }); info = (inf && inf.data && inf.data.attributes) || {}; } catch (_) { info = {}; }
    const shown = {
      name: pick(a, "name"), symbol: pick(a, "symbol"), logo: pick(a, "image_url") || pick(info, "image_url"),
      // GeckoTerminal lists the DEX/launchpad page alongside the project site — the project's own
      // domain is the one to compare, so prefer a website that is not a launchpad.
      website: firstUrl(info.websites, (w, u) => !/bags\.fm|pump\.fun|dexscreener|geckoterminal/i.test(u)) || firstUrl(info.websites),
      x: pick(info, "twitter_handle"), telegram: pick(info, "telegram_handle"), discord: pick(info, "discord_url"),
      description: pick(info, "description"),
    };
    return { found: true, shown, url: `https://www.geckoterminal.com/solana/tokens/${mint}` };
  },
};

// 4. DexScreener — pairs carry the token profile (websites/socials) when the project bought
//    Enhanced Token Info; otherwise only name/symbol.
const dexscreener = {
  id: "dexscreener", label: "DexScreener", tier: "preview",
  pageUrl: (mint) => `https://dexscreener.com/solana/${mint}`,
  fixUrl: () => "https://marketplace.dexscreener.com/product/token-info",
  async read(mint, deps) {
    assertMint(mint);
    const j = await getJson(deps, `https://api.dexscreener.com/tokens/v1/solana/${mint}`, { timeoutMs: 15000 });
    if (!Array.isArray(j) || !j.length) return { found: false };
    const pair = j.find((p) => p && p.baseToken && p.baseToken.address === mint) || j[0];
    const info = pair.info || {};
    const socials = Array.isArray(info.socials) ? info.socials : [];
    const social = (t) => { const s = socials.find((x) => x && String(x.type).toLowerCase() === t); return s ? s.url : ""; };
    const shown = {
      name: pick(pair.baseToken || {}, "name"), symbol: pick(pair.baseToken || {}, "symbol"),
      logo: pick(info, "imageUrl"),
      website: firstUrl(info.websites, (w, u) => !/bags\.fm|pump\.fun/i.test(u)) || firstUrl(info.websites),
      x: social("twitter"), telegram: social("telegram"), discord: social("discord"),
    };
    return { found: true, shown, url: pair.url || `https://dexscreener.com/solana/${mint}` };
  },
};

// 5. Jupiter — the token API (search by mint) carries name/symbol/icon/socials + the verified tag.
const jupiter = {
  id: "jupiter", label: "Jupiter", tier: "preview",
  pageUrl: (mint) => `https://jup.ag/tokens/${mint}`,
  fixUrl: () => "https://catdet.jup.ag/",
  async read(mint, deps) {
    assertMint(mint);
    const j = await getJson(deps, `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`, { timeoutMs: 15000 });
    const t = Array.isArray(j) ? j.find((x) => x && x.id === mint) : null;
    if (!t) return { found: false };
    const shown = {
      name: pick(t, "name"), symbol: pick(t, "symbol"), logo: pick(t, "icon"),
      website: pick(t, "website"), x: pick(t, "twitter"), telegram: pick(t, "telegram"), discord: pick(t, "discord"),
    };
    return { found: true, shown, url: `https://jup.ag/tokens/${mint}`, verified: !!t.isVerified, tags: t.tags || [] };
  },
};

// ── Full tier (pass) ─────────────────────────────────────────────────────────────────────────
// 6. Solscan — token meta on the key we hold; no key → unread (never a fake clean).
const solscan = {
  id: "solscan", label: "Solscan", tier: "full",
  pageUrl: (mint) => `https://solscan.io/token/${mint}`,
  fixUrl: () => "https://clucknorris.app/hatchery#metadata",
  async read(mint, deps) {
    assertMint(mint);
    const key = deps.env && deps.env.SOLSCAN_API_KEY;
    if (!key) throw new Error("SOLSCAN_API_KEY not configured");
    const j = await getJson(deps, `https://pro-api.solscan.io/v2.0/token/meta?address=${mint}`, { timeoutMs: 15000, headers: { token: key } });
    const d = j && j.data;
    if (!d || !d.address) return { found: false };
    const m = d.metadata || {};
    const shown = { name: pick(d, "name"), symbol: pick(d, "symbol"), logo: pick(d, "icon"), website: pick(m, "website"), x: pick(m, "twitter"), description: pick(m, "description") };
    return { found: true, shown, url: `https://solscan.io/token/${mint}` };
  },
};
// 7. Rugcheck — what its report shows for the token's links.
const rugcheck = {
  id: "rugcheck", label: "Rugcheck", tier: "full",
  pageUrl: (mint) => `https://rugcheck.xyz/tokens/${mint}`,
  fixUrl: (mint) => `https://rugcheck.xyz/tokens/${mint}#verify`,
  async read(mint, deps) {
    assertMint(mint);
    const j = await getJson(deps, `https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { timeoutMs: 20000 });
    if (!j || j.__notFound || !(j.tokenMeta || j.fileMeta)) return { found: false };
    const tm = j.tokenMeta || {}, fm = j.fileMeta || {}, v = j.verification || {};
    const links = Array.isArray(v.links) ? v.links : [];
    const link = (re) => { const l = links.find((x) => re.test(String(x && (x.url || x.value) || ""))); return l ? (l.url || l.value) : ""; };
    const shown = { name: pick(tm, "name") || pick(fm, "name"), symbol: pick(tm, "symbol") || pick(fm, "symbol"), logo: pick(fm, "image"), description: pick(fm, "description"),
      website: link(/^(?!.*(x\.com|twitter\.com|t\.me|discord))/i), x: link(/x\.com|twitter\.com/i), telegram: link(/t\.me/i), discord: link(/discord/i) };
    return { found: true, shown, url: `https://rugcheck.xyz/tokens/${mint}`, verified: !!v.jup_verified };
  },
};
// 8. pump.fun — only meaningful for pump tokens; unofficial endpoint, tolerate failure as unread.
const pumpfun = {
  id: "pumpfun", label: "pump.fun", tier: "full",
  pageUrl: (mint) => `https://pump.fun/coin/${mint}`,
  fixUrl: (mint) => `https://pump.fun/coin/${mint}`,
  async read(mint, deps) {
    assertMint(mint);
    if (!/pump$/.test(mint)) return { found: false };
    const j = await getJson(deps, `https://frontend-api.pump.fun/coins/${mint}`, { timeoutMs: 15000 });
    if (!j || j.__notFound || !j.mint) return { found: false };
    const shown = { name: pick(j, "name"), symbol: pick(j, "symbol"), logo: pick(j, "image_uri"), website: pick(j, "website"), x: pick(j, "twitter"), telegram: pick(j, "telegram"), description: pick(j, "description") };
    return { found: true, shown, url: `https://pump.fun/coin/${mint}` };
  },
};
// 9. CoinMarketCap — needs a (free) key; unread until it is set.
const coinmarketcap = {
  id: "coinmarketcap", label: "CoinMarketCap", tier: "full",
  pageUrl: () => "https://coinmarketcap.com/",
  fixUrl: () => "https://support.coinmarketcap.com/hc/en-us/requests/new",
  async read(mint, deps) {
    assertMint(mint);
    const key = deps.env && deps.env.CMC_API_KEY;
    if (!key) throw new Error("CMC_API_KEY not configured");
    const j = await getJson(deps, `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${mint}`, { timeoutMs: 15000, headers: { "X-CMC_PRO_API_KEY": key } });
    const d = j && j.data ? Object.values(j.data)[0] : null;
    if (!d) return { found: false };
    const u = d.urls || {};
    const shown = { name: pick(d, "name"), symbol: pick(d, "symbol"), logo: pick(d, "logo"), description: pick(d, "description"),
      website: firstUrl(u.website), x: firstUrl(u.twitter), telegram: firstUrl(u.chat, (w, url) => /t\.me/i.test(url)), discord: firstUrl(u.chat, (w, url) => /discord/i.test(url)) };
    return { found: true, shown, url: d.slug ? `https://coinmarketcap.com/currencies/${d.slug}/` : "https://coinmarketcap.com/" };
  },
};
// 10. Birdeye — needs a key; unread until set. The v3 token metadata endpoint (owner-supplied,
//     2026-09-06) carries exactly the fields we compare and costs fewer credits than the market
//     overview: { address, name, symbol, logo_uri, extensions: { website, twitter, telegram, discord, description } }.
const birdeye = {
  id: "birdeye", label: "Birdeye", tier: "full",
  pageUrl: (mint) => `https://birdeye.so/token/${mint}?chain=solana`,
  fixUrl: (mint) => `https://birdeye.so/token/${mint}?chain=solana#update`,
  async read(mint, deps) {
    assertMint(mint);
    const key = deps.env && deps.env.BIRDEYE_API_KEY;
    if (!key) throw new Error("BIRDEYE_API_KEY not configured");
    const j = await getJson(deps, `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${mint}`, { timeoutMs: 15000, headers: { "X-API-KEY": key, "x-chain": "solana" } });
    const d = j && j.data;
    if (!d || !d.address) return { found: false };
    const e = d.extensions || {};
    const shown = { name: pick(d, "name"), symbol: pick(d, "symbol"), logo: pick(d, "logo_uri") || pick(d, "logoURI"), website: pick(e, "website"), x: pick(e, "twitter"), telegram: pick(e, "telegram"), discord: pick(e, "discord"), description: pick(e, "description") };
    return { found: true, shown, url: `https://birdeye.so/token/${mint}?chain=solana` };
  },
};

const SOURCES = [onchain, coingecko, geckoterminal, dexscreener, jupiter, solscan, rugcheck, pumpfun, coinmarketcap, birdeye];
module.exports = { SOURCES, byId: Object.fromEntries(SOURCES.map((s) => [s.id, s])) };
