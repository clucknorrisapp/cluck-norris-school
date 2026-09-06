#!/usr/bin/env node
"use strict";
// Listing Checkup — Batch A checks, on fixtures (no network). CI: node-check job.
const assert = require("assert");
const C = require("../lib/listing-checkup-checks");
const core = require("../lib/listing-checkup");

let n = 0, failed = 0;
const t = (name, fn) => { n++; try { fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      " + (e && e.message || e)); } };
const ta = async (name, fn) => { n++; try { await fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      " + (e && e.message || e)); } };

const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const CLONE1 = "FrSFwE2BxWADEyUWFXDMAeomzuB4r83ZvzdG9sevpump";
const CLONE2 = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const canonical = core.canonicalFrom({ name: "Cluck Norris", symbol: "CLKN", mint: MINT, website: "https://clucknorris.app", x: "https://x.com/clucknorrisapp", telegram: "https://t.me/clucknorris", discord: "https://discord.gg/abc123", logo: "https://clucknorris.app/logo.png" });

// ── image header parsing ────────────────────────────────────────────────────────────────────
function png(w, h, colorType) { const b = Buffer.alloc(33 + 12); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = colorType; b.writeUInt32BE(0, 33); b.write("IEND", 37, "ascii"); return b; }
function jpeg(w, h) { const b = Buffer.alloc(30); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(4, 4); b[8] = 0xff; b[9] = 0xc0; b.writeUInt16BE(11, 10); b[12] = 8; b.writeUInt16BE(h, 13); b.writeUInt16BE(w, 15); return b; }
function gif(w, h) { const b = Buffer.alloc(16); b.write("GIF89a", 0, "ascii"); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; }
function webpVP8X(w, h, alpha) { const b = Buffer.alloc(40); b.write("RIFF", 0, "ascii"); b.write("WEBP", 8, "ascii"); b.write("VP8X", 12, "ascii"); b[20] = alpha ? 0x10 : 0; b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; }

console.log("\nListing Checkup — Batch A checks\n");
t("PNG 200x200 RGBA reads as square with alpha", () => { const i = C.imageInfo(png(200, 200, 6)); assert.deepStrictEqual([i.format, i.width, i.height, i.alpha], ["png", 200, 200, true]); });
t("PNG RGB (no tRNS) reads as no alpha", () => { assert.strictEqual(C.imageInfo(png(512, 512, 2)).alpha, false); });
t("JPEG SOF0 dimensions", () => { const i = C.imageInfo(jpeg(300, 150)); assert.deepStrictEqual([i.format, i.width, i.height], ["jpeg", 300, 150]); });
t("GIF dimensions", () => { const i = C.imageInfo(gif(64, 64)); assert.deepStrictEqual([i.format, i.width, i.height], ["gif", 64, 64]); });
t("WebP VP8X dimensions + alpha flag", () => { const i = C.imageInfo(webpVP8X(256, 256, true)); assert.deepStrictEqual([i.format, i.width, i.height, i.alpha], ["webp", 256, 256, true]); });
t("SVG viewBox dimensions", () => { const i = C.imageInfo(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle r="1"/></svg>')); assert.deepStrictEqual([i.format, i.width, i.height], ["svg", 120, 120]); });
t("garbage bytes read as unknown, never throw", () => { assert.strictEqual(C.imageInfo(Buffer.from("hello world, not an image at all")).format, "unknown"); assert.strictEqual(C.imageInfo(Buffer.alloc(3)), null); });

// ── logoSpec verdicts per site ──────────────────────────────────────────────────────────────
(async () => {
  await ta("logoSpec: 200x200 RGBA PNG passes every site", async () => {
    const r = await C.logoSpec.run(canonical, { fetchBytes: async () => ({ status: 200, buf: png(200, 200, 6) }) });
    assert.strictEqual(r.status, "ok"); assert.ok(r.sites.every((s) => s.ok === true), JSON.stringify(r.sites));
  });
  await ta("logoSpec: 512x512 JPEG fails CMC (PNG only, no alpha) and passes CoinGecko", async () => {
    const r = await C.logoSpec.run(canonical, { fetchBytes: async () => ({ status: 200, buf: jpeg(512, 512) }) });
    const cmc = r.sites.find((s) => s.id === "coinmarketcap"), cg = r.sites.find((s) => s.id === "coingecko");
    assert.strictEqual(cmc.ok, false); assert.ok(/JPEG/.test(cmc.why) && /transparency/.test(cmc.why), cmc.why); assert.strictEqual(cg.ok, true);
  });
  await ta("logoSpec: 100x120 PNG is under-size and not square", async () => {
    const r = await C.logoSpec.run(canonical, { fetchBytes: async () => ({ status: 200, buf: png(100, 120, 6) }) });
    const cg = r.sites.find((s) => s.id === "coingecko"); assert.strictEqual(cg.ok, false); assert.ok(/under 200/.test(cg.why) && /not square/.test(cg.why), cg.why); assert.strictEqual(r.square, false);
  });
  await ta("logoSpec: no logo → skipped, not unread", async () => { const r = await C.logoSpec.run(core.canonicalFrom({ name: "A", symbol: "A", mint: MINT }), {}); assert.strictEqual(r.status, "skipped"); });
  await ta("logoSpec: a 404 logo throws (runner makes it unread)", async () => { await assert.rejects(C.logoSpec.run(canonical, { fetchBytes: async () => ({ status: 404 }) })); });

  // ── impersonators ────────────────────────────────────────────────────────────────────────
  const jup = [
    { id: MINT, name: "Cluck Norris", symbol: "CLKN", isVerified: true, holderCount: 5000, liquidity: 100000 },
    { id: CLONE1, name: "Cluck Norris", symbol: "CLKN", isVerified: false, holderCount: 12, liquidity: 300 },
    { id: CLONE2, name: "Cluck Norris 2.0", symbol: "clkn", isVerified: false, holderCount: 3, liquidity: 20 },
    { id: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
  ];
  const dex = { pairs: [
    { chainId: "solana", baseToken: { address: CLONE1, name: "Cluck Norris", symbol: "CLKN" }, liquidity: { usd: 450 }, url: "https://dexscreener.com/solana/pair1" },
    { chainId: "solana", baseToken: { address: "3pQxPq1u4xXrB5F1H6R5R7N6y9d3n2p1w5w6k7t8u9v1", name: "Cluck", symbol: "CLKN" }, liquidity: { usd: 9000 }, url: "https://dexscreener.com/solana/pair2" },
    { chainId: "ethereum", baseToken: { address: "0xabc", name: "Cluck Norris", symbol: "CLKN" }, liquidity: { usd: 1e6 } },
  ] };
  const depsImp = { fetchJson: async (u) => (/jup\.ag/.test(u) ? jup : dex) };
  await ta("impersonators: merges Jupiter + DexScreener by mint, drops ours and other chains, sorts by liquidity", async () => {
    const r = await C.impersonators.run(canonical, depsImp);
    assert.strictEqual(r.status, "ok");
    const mints = r.matches.map((m) => m.mint);
    assert.ok(!mints.includes(MINT), "ours excluded"); assert.ok(!mints.includes("0xabc"), "eth excluded"); assert.ok(!mints.includes("So11111111111111111111111111111111111111112"), "SOL not a match");
    assert.strictEqual(mints[0], "3pQxPq1u4xXrB5F1H6R5R7N6y9d3n2p1w5w6k7t8u9v1", "highest liquidity first");
    const c1 = r.matches.find((m) => m.mint === CLONE1);
    assert.deepStrictEqual(c1.matchOn.sort(), ["name", "symbol"]); assert.strictEqual(c1.liquidityUsd, 450, "max of both sources"); assert.deepStrictEqual(c1.seenOn, ["jupiter", "dexscreener"]); assert.strictEqual(c1.holders, 12);
    const c2 = r.matches.find((m) => m.mint === CLONE2); assert.deepStrictEqual(c2.matchOn, ["symbol"], "symbol match is case-insensitive, name differs");
  });
  await ta("impersonators: one source down → partial with the error named, not unread", async () => {
    const r = await C.impersonators.run(canonical, { fetchJson: async (u) => { if (/jup\.ag/.test(u)) throw new Error("boom"); return dex; } });
    assert.strictEqual(r.status, "ok"); assert.strictEqual(r.partial, true); assert.ok(r.errors.some((e) => /jupiter/.test(e)));
  });
  await ta("impersonators: every source down → throws (runner: unread)", async () => { await assert.rejects(C.impersonators.run(canonical, { fetchJson: async () => { throw new Error("down"); } })); });

  // ── link health ──────────────────────────────────────────────────────────────────────────
  const depsLinks = { fetchText: async (u) => {
    if (/discord\.com\/api/.test(u)) return { status: 200, text: JSON.stringify({ guild: { name: "Cluck Coop" }, approximate_member_count: 321 }) };
    if (/t\.me/.test(u)) return { status: 200, text: '<div class="tgme_page_title">Cluck Norris</div><div class="tgme_page_extra">1 234 members</div>' };
    if (/clucknorris\.app/.test(u)) return { status: 200, finalUrl: "https://clucknorris.app/", text: "<html>" };
    return { status: 404, text: "" };
  } };
  await ta("linkHealth: website ok, telegram public page, discord invite resolves, X unverified", async () => {
    const r = await C.linkHealth.run(canonical, depsLinks);
    const by = Object.fromEntries(r.links.map((l) => [l.field, l]));
    assert.strictEqual(by.website.status, "ok"); assert.strictEqual(by.telegram.status, "ok"); assert.ok(/members/.test(by.telegram.note));
    assert.strictEqual(by.discord.status, "ok"); assert.ok(/Cluck Coop/.test(by.discord.note) && /321/.test(by.discord.note));
    assert.strictEqual(by.x.status, "unverified");
  });
  await ta("linkHealth: dead site → broken; off-domain redirect → redirect; expired invite → broken; private telegram → unverified", async () => {
    const r = await C.linkHealth.run(core.canonicalFrom({ name: "A", symbol: "A", mint: MINT, website: "https://dead.example", telegram: "https://t.me/+privateinvite", discord: "https://discord.gg/expired" }), { fetchText: async (u) => {
      if (/discord\.com\/api/.test(u)) return { status: 404, text: "{}" };
      if (/t\.me/.test(u)) return { status: 200, text: "<html>If you have Telegram, you can contact</html>" };
      return { status: 503, text: "" };
    } });
    const by = Object.fromEntries(r.links.map((l) => [l.field, l]));
    assert.strictEqual(by.website.status, "broken"); assert.strictEqual(by.discord.status, "broken"); assert.strictEqual(by.telegram.status, "unverified");
    const r2 = await C.linkHealth.run(core.canonicalFrom({ name: "A", symbol: "A", mint: MINT, website: "https://old.example" }), { fetchText: async () => ({ status: 200, finalUrl: "https://new.example/home", text: "" }) });
    assert.strictEqual(r2.links[0].status, "redirect"); assert.ok(/new\.example/.test(r2.links[0].note));
  });
  await ta("linkHealth: a fetch that throws is broken with the reason, never a throw out", async () => {
    const r = await C.linkHealth.run(core.canonicalFrom({ name: "A", symbol: "A", mint: MINT, website: "https://x.example" }), { fetchText: async () => { throw new Error("ENOTFOUND"); } });
    assert.strictEqual(r.links[0].status, "broken"); assert.ok(/ENOTFOUND/.test(r.links[0].note));
  });

  // ── chain facts ──────────────────────────────────────────────────────────────────────────
  const rows = [{ id: "onchain", extra: { mutable: true, mintAuthority: "", freezeAuthority: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", supply: 1e9, decimals: 6, tokenProgram: "Token", updateAuthority: "Auth111" } }, { id: "rugcheck", extra: { lpLockedPct: 92.5 } }];
  await ta("chainFacts: authorities, mutability, program, LP lock from the rows; no RPC call on preview", async () => {
    const r = await C.chainFacts.run(canonical, { lockedSupply: async () => { throw new Error("must not be called on preview"); } }, { rows, tier: "preview" });
    assert.strictEqual(r.facts.mintAuthority.revoked, true); assert.strictEqual(r.facts.freezeAuthority.revoked, false); assert.strictEqual(r.facts.metadataMutable, true); assert.strictEqual(r.facts.tokenProgram, "Token"); assert.strictEqual(r.lpLockedPct, 92.5); assert.strictEqual(r.locks, null);
  });
  await ta("chainFacts: full tier adds the Locker Room lock scan", async () => {
    const r = await C.chainFacts.run(canonical, { lockedSupply: async () => ({ success: true, totalLocked: 2.5e8, pctOfSupply: 0.25, lockCount: 3, breakdown: [{ label: "Jupiter Lock", tokens: 2.5e8 }], partial: false }) }, { rows, tier: "full" });
    assert.strictEqual(r.locks.lockCount, 3); assert.strictEqual(r.locks.pctOfSupply, 0.25); assert.ok(/\/lock\//.test(r.locks.page));
  });
  await ta("chainFacts: on-chain row unread → unread, never invented", async () => { const r = await C.chainFacts.run(canonical, {}, { rows: [{ id: "onchain", error: "offline" }], tier: "preview" }); assert.strictEqual(r.status, "unread"); });

  // ── listing how-to covers every source ───────────────────────────────────────────────────
  t("LISTING_HOW has an entry with a URL for every source id", () => {
    const { SOURCES } = require("../lib/listing-checkup-sources");
    for (const s of SOURCES) { const h = C.LISTING_HOW[s.id]; assert.ok(h && h.needs && /^https:\/\//.test(h.url), "missing how-to for " + s.id); }
  });

  // ── the runner wires checks in ───────────────────────────────────────────────────────────
  await ta("runCheckup: report.checks carries every check, a throwing check is unread, not-found rows get howToList", async () => {
    const sources = [
      { id: "onchain", label: "On-chain", tier: "preview", pageUrl: () => "https://solscan.io", fixUrl: () => "https://clucknorris.app/hatchery", read: async () => ({ found: true, shown: { name: "Cluck Norris", symbol: "CLKN" }, extra: { mutable: false, mintAuthority: "", freezeAuthority: "" } }) },
      { id: "coingecko", label: "CoinGecko", tier: "preview", pageUrl: () => "https://coingecko.com", fixUrl: () => "https://coingecko.com/fix", read: async () => ({ found: false }) },
    ];
    const checks = [C.chainFacts, { id: "boom", label: "Boom", tier: "preview", run: async () => { throw new Error("kaput"); } }, { id: "fullOnly", label: "Full", tier: "full", run: async () => ({ status: "ok" }) }];
    const rep = await core.runCheckup(canonical, { sources, checks, howToList: C.LISTING_HOW, deps: {}, tier: "preview" });
    assert.strictEqual(rep.checks.chainFacts.status, "ok"); assert.strictEqual(rep.checks.chainFacts.facts.mintAuthority.revoked, true);
    assert.strictEqual(rep.checks.boom.status, "unread"); assert.ok(/kaput/.test(rep.checks.boom.error));
    assert.ok(!rep.checks.fullOnly, "full-tier check skipped on preview");
    const cg = rep.sources.find((r) => r.id === "coingecko"); assert.strictEqual(cg.status, "not-found"); assert.ok(cg.howToList && /coingecko/.test(cg.howToList.url));
    assert.deepStrictEqual(rep.sources.find((r) => r.id === "onchain").extra, { mutable: false, mintAuthority: "", freezeAuthority: "" }, "extra kept on the row");
  });

  console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(failed ? 1 : 0);
})();
