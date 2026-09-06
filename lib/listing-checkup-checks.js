"use strict";
// Listing Checkup — Batch A checks (owner go 2026-09-06: "ship and build A").
//
// A CHECK is not a listing source. It reads the canonical record (and, where cheap, the rows the
// sources already produced) and answers one question a project actually acts on:
//   impersonators — which OTHER Solana mints use your name or symbol
//   linkHealth    — do your official links actually resolve
//   logoSpec      — will your logo pass each site's upload rules
//   chainFacts    — mint / freeze / metadata authorities, token program, and (full tier) what is locked
//   listingHow    — for every "not found" row, what that site says it needs, with its form
//
// Same contract as the adapters: pure, reads through `deps`, throws on transport errors (the
// runner turns that into `unread`), never a 500. Everything here says WHAT a site shows or what
// the chain holds — never why. Nothing is submitted anywhere.

const { SOL_ADDR_RE, normName, normSymbol, normUrl } = require("./listing-checkup");

const pick = (o, k) => (o && o[k] != null ? o[k] : "");
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./i, "").toLowerCase(); } catch (_) { return ""; } };
function ensureUrl(u) { const s = String(u || "").trim(); if (!s) return ""; return /^https?:\/\//i.test(s) ? s : "https://" + s; }

// ── 1. Impersonators ─────────────────────────────────────────────────────────────────────────
// Jupiter's search answers by name OR symbol and carries holders / liquidity / verified; DexScreener's
// search adds pairs Jupiter has not indexed. Merged by mint, ours removed, sorted by liquidity.
// Jupiter's own #1 reason for refusing verification is "duplicate of another token" — this is the
// list a project needs before it applies.
const impersonators = {
  id: "impersonators", label: "Possible impersonators", tier: "preview",
  async run(canonical, deps) {
    const ourMint = canonical.mint, ourName = normName(canonical.name), ourSym = normSymbol(canonical.symbol);
    const byMint = new Map();
    const add = (m, patch) => { if (!m || m === ourMint || !SOL_ADDR_RE.test(m)) return; const cur = byMint.get(m) || { mint: m, matchOn: [] }; Object.assign(cur, patch, { matchOn: Array.from(new Set(cur.matchOn.concat(patch.matchOn || []))) }); byMint.set(m, cur); };
    const matchOf = (name, symbol) => { const on = []; if (ourSym && normSymbol(symbol) === ourSym) on.push("symbol"); if (ourName && normName(name) === ourName) on.push("name"); return on; };
    const errors = [];
    const queries = Array.from(new Set([canonical.symbol, canonical.name].map((s) => String(s || "").trim()).filter(Boolean)));
    // Jupiter
    for (const q of queries) {
      try {
        const j = await deps.fetchJson(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`, { timeoutMs: 15000 });
        for (const t of Array.isArray(j) ? j : []) {
          const on = matchOf(t && t.name, t && t.symbol); if (!on.length) continue;
          add(t.id, { name: pick(t, "name"), symbol: pick(t, "symbol"), matchOn: on, verified: !!t.isVerified, holders: Number(t.holderCount) || null, liquidityUsd: Number(t.liquidity) || 0, mcapUsd: Number(t.mcap) || null, seenOn: ["jupiter"] });
        }
      } catch (e) { errors.push("jupiter: " + String(e && e.message || e).slice(0, 80)); }
    }
    // DexScreener
    for (const q of queries) {
      try {
        const d = await deps.fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { timeoutMs: 15000 });
        for (const p of (d && Array.isArray(d.pairs)) ? d.pairs : []) {
          if (!p || p.chainId !== "solana" || !p.baseToken) continue;
          const on = matchOf(p.baseToken.name, p.baseToken.symbol); if (!on.length) continue;
          const cur = byMint.get(p.baseToken.address);
          const liq = Number(p.liquidity && p.liquidity.usd) || 0;
          add(p.baseToken.address, { name: cur && cur.name || pick(p.baseToken, "name"), symbol: cur && cur.symbol || pick(p.baseToken, "symbol"), matchOn: on,
            liquidityUsd: Math.max(liq, cur && cur.liquidityUsd || 0), pairUrl: cur && cur.pairUrl || pick(p, "url"), seenOn: Array.from(new Set((cur && cur.seenOn || []).concat(["dexscreener"]))) });
        }
      } catch (e) { errors.push("dexscreener: " + String(e && e.message || e).slice(0, 80)); }
    }
    if (errors.length === queries.length * 2) throw new Error(errors.join("; "));
    const matches = Array.from(byMint.values()).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0)).slice(0, 25);
    return { status: "ok", matches, total: byMint.size, partial: errors.length > 0, errors, queries,
      note: "Other Solana mints using this name or symbol. We report that they exist and what the sites show for them — never why." };
  },
};

// ── 2. Link health ───────────────────────────────────────────────────────────────────────────
// A wrong link on an aggregator is bad; a dead OFFICIAL link is worse and nobody checks it. Reads
// through deps.fetchText → { status, finalUrl, text, error }. X refuses anonymous reads, so we say
// "unverified" there rather than guess.
function discordInvite(u) { const m = String(u || "").match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/i); return m ? m[1] : ""; }
const linkHealth = {
  id: "linkHealth", label: "Link health", tier: "preview",
  async run(canonical, deps) {
    const out = [];
    const fields = [["website", canonical.website], ["x", canonical.x], ["telegram", canonical.telegram], ["discord", canonical.discord]];
    for (const [field, raw] of fields) {
      if (!raw) continue;
      const url = ensureUrl(raw);
      const row = { field, url, status: "unread", http: null, finalUrl: null, note: "" };
      try {
        if (field === "x") { row.status = "unverified"; row.note = "X does not answer link checks without a login, so we do not guess."; out.push(row); continue; }
        if (field === "discord" && discordInvite(url)) {
          const code = discordInvite(url);
          const r = await deps.fetchText(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`, { timeoutMs: 10000 });
          row.http = r.status;
          if (r.status === 200) { let j = null; try { j = JSON.parse(r.text); } catch (_) {} row.status = "ok"; row.note = j && j.guild ? `invite resolves to "${String(j.guild.name).slice(0, 60)}"${j.approximate_member_count ? ` · ${j.approximate_member_count} members` : ""}` : "invite resolves"; }
          else if (r.status === 404 || r.status === 410) { row.status = "broken"; row.note = "Discord says this invite is invalid or expired."; }
          else { row.status = "unread"; row.note = `Discord answered ${r.status}.`; }
          out.push(row); continue;
        }
        const r = await deps.fetchText(url, { timeoutMs: 12000, maxBytes: 300000 });
        row.http = r.status; row.finalUrl = r.finalUrl || url;
        if (field === "telegram") {
          if (r.status !== 200) { row.status = "broken"; row.note = `t.me answered ${r.status}.`; }
          else if (/tgme_page_title/.test(r.text || "")) { const m = String(r.text).match(/tgme_page_extra">([^<]{0,80})</); row.status = "ok"; row.note = m ? m[1].trim() : "public page found"; }
          else { row.status = "unverified"; row.note = "Telegram shows no public page for this link — a private group looks the same as a missing one, so we do not call it broken."; }
        } else {
          if (r.status >= 200 && r.status < 400) {
            row.status = "ok";
            const h0 = host(url), h1 = host(row.finalUrl);
            if (h1 && h0 && h1 !== h0) { row.status = "redirect"; row.note = `redirects to ${h1} — the aggregators will show the link you gave them, not where it lands.`; }
            else if (!/^https:/i.test(url)) row.note = "reachable, but the link you publish is http:// — most sites want https://.";
          } else { row.status = "broken"; row.note = `answered ${r.status}.`; }
        }
      } catch (e) { row.status = "broken"; row.note = "did not answer: " + String(e && e.message || e).slice(0, 100); }
      out.push(row);
    }
    return { status: "ok", links: out };
  },
};

// ── 3. Logo spec ─────────────────────────────────────────────────────────────────────────────
// Dimensions from the bytes (no image library): PNG, JPEG, GIF, WebP, SVG. Each site's rule is the
// number its own form states, dated — re-check them when a form changes.
const LOGO_SPECS = [
  { id: "coingecko", label: "CoinGecko", wants: "200×200, PNG / JPG / WEBP, transparent background preferred", asOf: "2026-09-06", formats: ["png", "jpeg", "webp"], min: 200, square: true, alpha: "preferred" },
  { id: "coinmarketcap", label: "CoinMarketCap", wants: "200×200 PNG, transparent background", asOf: "2026-09-06", formats: ["png"], min: 200, square: true, alpha: "required" },
  { id: "jupiter", label: "Jupiter / on-chain", wants: "a square image at a stable https URL in the on-chain metadata", asOf: "2026-09-06", formats: ["png", "jpeg", "webp", "gif", "svg"], min: 0, square: true, alpha: "n/a" },
];
function imageInfo(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), colorType = buf[25];
    let alpha = colorType === 4 || colorType === 6;
    if (!alpha) { let off = 33; while (off + 8 <= buf.length) { const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8); if (type === "tRNS") { alpha = true; break; } if (type === "IDAT" || type === "IEND") break; off += 12 + len; } }
    return { format: "png", width: w, height: h, alpha };
  }
  // GIF
  if (buf.toString("ascii", 0, 3) === "GIF") return { format: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), alpha: null };
  // JPEG — walk the markers to the first SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      const len = buf.readUInt16BE(off + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { format: "jpeg", width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5), alpha: false };
      }
      off += 2 + len;
    }
    return { format: "jpeg", width: null, height: null, alpha: false };
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) return { format: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), alpha: !!(buf[20] & 0x10) };
    if (chunk === "VP8L" && buf.length >= 25) { const b = buf.readUInt32LE(21); return { format: "webp", width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff), alpha: !!((b >> 28) & 1) }; }
    if (chunk === "VP8 " && buf.length >= 30) return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, alpha: false };
    return { format: "webp", width: null, height: null, alpha: null };
  }
  // SVG
  const head = buf.toString("utf8", 0, Math.min(buf.length, 2000));
  if (/<svg[\s>]/i.test(head)) {
    const num = (re) => { const m = head.match(re); return m ? Math.round(parseFloat(m[1])) : null; };
    let w = num(/<svg[^>]*\swidth="([\d.]+)/i), h = num(/<svg[^>]*\sheight="([\d.]+)/i);
    if (!(w && h)) { const vb = head.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)/i); if (vb) { w = Math.round(parseFloat(vb[1])); h = Math.round(parseFloat(vb[2])); } }
    return { format: "svg", width: w, height: h, alpha: true, vector: true };
  }
  return { format: "unknown", width: null, height: null, alpha: null };
}
const logoSpec = {
  id: "logoSpec", label: "Logo", tier: "preview",
  async run(canonical, deps) {
    if (!canonical.logo) return { status: "skipped", note: "no logo URL given" };
    const r = await deps.fetchBytes(canonical.logo, { timeoutMs: 10000, maxBytes: 3_000_000 });
    if (!r || r.status !== 200 || !r.buf) throw new Error(`logo URL answered ${r && r.status}`);
    const info = imageInfo(r.buf) || { format: "unknown", width: null, height: null, alpha: null };
    const square = info.width && info.height ? info.width === info.height : null;
    const sites = LOGO_SPECS.map((s) => {
      const why = [];
      if (info.format !== "unknown" && !s.formats.includes(info.format)) why.push(`${info.format.toUpperCase()} is not in its list (${s.formats.map((f) => f.toUpperCase()).join("/")})`);
      if (s.min && info.width && info.height && (info.width < s.min || info.height < s.min)) why.push(`${info.width}×${info.height} is under ${s.min}×${s.min}`);
      if (s.square && square === false) why.push(`${info.width}×${info.height} is not square`);
      if (s.alpha === "required" && info.alpha === false) why.push("no transparency");
      const ok = info.format === "unknown" || (info.width == null && s.min) ? null : why.length === 0;
      return { id: s.id, label: s.label, wants: s.wants, asOf: s.asOf, ok, why: why.join("; ") };
    });
    return { status: "ok", url: canonical.logo, format: info.format, width: info.width, height: info.height, bytes: r.buf.length, square, alpha: info.alpha, https: /^https:/i.test(canonical.logo), sites,
      note: "Each site's rule is what its own upload form states on the date shown — the form is the authority when it changes." };
  },
};

// ── 4. Chain facts (+ locks on the full tier) ───────────────────────────────────────────────
// What every listing reviewer looks at first, read from the DAS record the on-chain adapter already
// fetched (row.extra) — no second RPC call. Locks come from the same on-chain scan the Locker Room
// uses (deps.lockedSupply), full tier only because it is a multi-page token-account read.
const chainFacts = {
  id: "chainFacts", label: "Chain facts", tier: "preview",
  async run(canonical, deps, ctx) {
    const onchain = (ctx && ctx.rows || []).find((r) => r.id === "onchain");
    const x = onchain && onchain.extra;
    if (!x) return { status: "unread", note: onchain && onchain.error ? "on-chain record unread: " + onchain.error : "on-chain record unread" };
    const facts = {
      mintAuthority: x.mintAuthority ? { revoked: false, address: x.mintAuthority } : { revoked: true },
      freezeAuthority: x.freezeAuthority ? { revoked: false, address: x.freezeAuthority } : { revoked: true },
      metadataMutable: x.mutable === true ? true : x.mutable === false ? false : null,
      updateAuthority: x.updateAuthority || null,
      tokenProgram: x.tokenProgram || null,
      supply: x.supply != null ? x.supply : null, decimals: x.decimals != null ? x.decimals : null,
    };
    const out = { status: "ok", facts, locks: null, lpLockedPct: null };
    const rug = (ctx && ctx.rows || []).find((r) => r.id === "rugcheck");
    if (rug && rug.extra && rug.extra.lpLockedPct != null) out.lpLockedPct = rug.extra.lpLockedPct;
    if (ctx && ctx.tier === "full" && deps.lockedSupply) {
      try {
        const l = await deps.lockedSupply(canonical.mint);
        if (l && l.success) out.locks = { totalLocked: l.totalLocked, pctOfSupply: l.pctOfSupply, lockCount: l.lockCount, breakdown: l.breakdown || [], partial: !!l.partial, page: `https://clucknorris.app/lock/${canonical.mint}` };
      } catch (e) { out.locksError = String(e && e.message || e).slice(0, 120); }
    }
    return out;
  },
};

// ── 5. How to get listed (for "not found" rows) ──────────────────────────────────────────────
// What each site says it needs, in its own words as of the date, and the page where the project
// applies. We link; we never submit. Attached to every not-found row by the runner.
const LISTING_HOW = {
  coingecko: { needs: "trading on an exchange or DEX CoinGecko already tracks, a working website, socials and a logo; submitted through its coin listing request form", url: "https://support.coingecko.com/hc/en-us/categories/7684622718105-CoinGecko-Request-Forms", asOf: "2026-09-06" },
  coinmarketcap: { needs: "a live market on a tracked exchange, an official website, socials, a 200×200 PNG logo and an accurate contract address; submitted through the cryptoasset listing request form", url: "https://support.coinmarketcap.com/hc/en-us/sections/360008843692-Listings-Request-Forms", asOf: "2026-09-06" },
  geckoterminal: { needs: "nothing to submit — it indexes pools automatically from the DEXes it supports; not found means no pool on a supported Solana DEX yet", url: "https://www.geckoterminal.com/solana/pools", asOf: "2026-09-06" },
  dexscreener: { needs: "nothing to submit — it indexes pairs automatically; not found means no pair with liquidity on a supported Solana DEX yet", url: "https://dexscreener.com/solana", asOf: "2026-09-06" },
  jupiter: { needs: "Jupiter Verify (the Catdet list is retired) weighs organic score, trading activity and community support; a duplicate of another token's name or symbol is the most common refusal — see the impersonator list above", url: "https://verified.jup.ag/", asOf: "2026-09-06" },
  birdeye: { needs: "nothing to submit — it indexes any token with a trading pair; the token profile is updated from the token page", url: "https://birdeye.so/", asOf: "2026-09-06" },
  solscan: { needs: "on-chain Metaplex metadata; not found means the mint has none — set it and Solscan reads it", url: "https://clucknorris.app/hatchery#metadata", asOf: "2026-09-06" },
  rugcheck: { needs: "nothing to submit — a report is generated on demand for any mint with a market", url: "https://rugcheck.xyz/", asOf: "2026-09-06" },
  pumpfun: { needs: "only tokens launched on pump.fun have a page there", url: "https://pump.fun/", asOf: "2026-09-06" },
  onchain: { needs: "Metaplex metadata on the mint — the record every aggregator copies", url: "https://clucknorris.app/hatchery#metadata", asOf: "2026-09-06" },
};

const CHECKS = [chainFacts, impersonators, linkHealth, logoSpec];

module.exports = { CHECKS, LISTING_HOW, LOGO_SPECS, imageInfo, impersonators, linkHealth, logoSpec, chainFacts, discordInvite };
