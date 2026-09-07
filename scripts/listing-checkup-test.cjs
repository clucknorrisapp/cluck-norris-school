#!/usr/bin/env node
"use strict";
// Listing Checkup — offline tests for the pure core and the adapters (fixtures recorded from the
// live APIs for CLKN on 2026-09-06). No network: every adapter reads through a fake fetcher.
const assert = require("assert");
const lc = require("../lib/listing-checkup");
const { SOURCES, byId } = require("../lib/listing-checkup-sources");

let pass = 0, fail = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);

const MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const CANON = { mint: MINT, name: "Cluck Norris", symbol: "CLKN", website: "https://clucknorris.app", x: "@FireChicken007", telegram: "https://t.me/FireChicken007", logo: "https://arweave.net/B-E2FyV8RUxlrpm0aCJH5MUVeovffe3Z1yYbjIUiE7w" };

// ── normalisers ──────────────────────────────────────────────────────────────
t("normUrl: scheme, www, trailing slash, case, twitter→x, telegram.me→t.me", () => {
  assert.strictEqual(lc.normUrl("HTTP://www.ClucKnorris.app/"), "clucknorris.app");
  assert.strictEqual(lc.normUrl("clucknorris.app"), "clucknorris.app");
  assert.strictEqual(lc.normUrl("https://clucknorris.app/tools/"), "clucknorris.app/tools");
  assert.strictEqual(lc.normUrl("https://twitter.com/FireChicken007"), "x.com/FireChicken007");
  assert.strictEqual(lc.normUrl("https://telegram.me/FireChicken007/"), "t.me/FireChicken007");
  assert.strictEqual(lc.normUrl("https://clucknorris.app/?utm=1"), "clucknorris.app");
  assert.strictEqual(lc.normUrl(""), "");
});
t("normHandle: @, URL forms, case", () => {
  assert.strictEqual(lc.normHandle("@FireChicken007", "x"), "firechicken007");
  assert.strictEqual(lc.normHandle("https://x.com/FireChicken007", "x"), "firechicken007");
  assert.strictEqual(lc.normHandle("https://twitter.com/firechicken007/", "x"), "firechicken007");
  assert.strictEqual(lc.normHandle("t.me/FireChicken007", "telegram"), "firechicken007");
  assert.strictEqual(lc.normHandle("FireChicken007", "telegram"), "firechicken007");
  assert.strictEqual(lc.normHandle("https://discord.gg/abcDEF", "discord"), "abcdef");
});
t("linkFor builds the display link for a bare handle", () => {
  assert.strictEqual(lc.linkFor("x", "FireChicken007"), "https://x.com/FireChicken007");
  assert.strictEqual(lc.linkFor("telegram", "@FireChicken007"), "https://t.me/FireChicken007");
  assert.strictEqual(lc.linkFor("website", "clucknorris.app"), "https://clucknorris.app");
  assert.strictEqual(lc.linkFor("x", "https://x.com/a"), "https://x.com/a");
});

// ── canonical record ─────────────────────────────────────────────────────────
t("canonicalFrom validates the mint and required fields, keeps optional fields empty", () => {
  const c = lc.canonicalFrom(CANON);
  assert.strictEqual(c.mint, MINT); assert.strictEqual(c.discord, ""); assert.strictEqual(c.symbol, "CLKN");
  assert.throws(() => lc.canonicalFrom({ ...CANON, mint: "nope" }), /Solana address/);
  assert.throws(() => lc.canonicalFrom({ ...CANON, name: "" }), /name/);
  assert.throws(() => lc.canonicalFrom({ ...CANON, website: "javascript:alert(1)<" }), /link/);
  assert.strictEqual(lc.canonicalFrom({ ...CANON, symbol: "$CLKN" }).symbol, "CLKN");
});

// ── comparison ───────────────────────────────────────────────────────────────
t("compareFields: match / differs / missing, and fields the source cannot show are skipped", () => {
  const c = lc.canonicalFrom(CANON);
  const rows = lc.compareFields(c, { name: "Cluck Norris", symbol: "clkn", website: "http://www.clucknorris.app/", x: "firechicken007", telegram: "", logo: "https://cdn.example/x.png" });
  const by = Object.fromEntries(rows.map((r) => [r.field, r.status]));
  assert.deepStrictEqual(by, { name: "match", symbol: "match", website: "match", x: "match", telegram: "missing", logo: "unverified" });
  assert.ok(!rows.find((r) => r.field === "discord"), "discord not given by the project → not compared");
  assert.ok(!rows.find((r) => r.field === "description"), "description not shown by the source → not compared");
});
t("compareFields: a different website is reported with both values", () => {
  const c = lc.canonicalFrom(CANON);
  const r = lc.compareFields(c, { website: "https://clucknorris.io" }).find((x) => x.field === "website");
  assert.strictEqual(r.status, "differs"); assert.strictEqual(r.ours, "https://clucknorris.app"); assert.strictEqual(r.theirs, "https://clucknorris.io");
});
t("logo: hash match beats URL difference", () => {
  const c = lc.canonicalFrom(CANON);
  const r = lc.compareFields(c, { logo: "https://cdn.other/host.png" }, { logoHashes: { ours: "abc", theirs: "abc" } }).find((x) => x.field === "logo");
  assert.strictEqual(r.status, "match"); assert.strictEqual(r.note, "same image, different host");
});
t("verdictOf: unread beats everything; not-found; incorrect on differs/missing; unverified never counts against", () => {
  assert.strictEqual(lc.verdictOf({ readOk: true, found: true, fields: [{ status: "match" }, { status: "unverified" }] }), "correct");
  assert.strictEqual(lc.verdictOf({ readOk: false, found: true, fields: [] }), "unread");
  assert.strictEqual(lc.verdictOf({ readOk: true, found: false, fields: [] }), "not-found");
  assert.strictEqual(lc.verdictOf({ readOk: true, found: true, fields: [{ status: "match" }] }), "correct");
  assert.strictEqual(lc.verdictOf({ readOk: true, found: true, fields: [{ status: "match" }, { status: "missing" }] }), "incorrect");
});

// ── adapters on recorded fixtures ─────────────────────────────────────────────
const FIX = {
  [`https://api.coingecko.com/api/v3/coins/solana/contract/${MINT}`]: { __status: 404, error: "coin not found" },
  [`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}`]: { data: { attributes: { name: "Cluck Norris", symbol: "CLKN", image_url: "https://assets.geckoterminal.com/x0fk8" } } },
  [`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}/info`]: { data: { attributes: { name: "Cluck Norris", symbol: "CLKN", websites: ["https://bags.fm/dw6df2", "https://clucknorris.app"], twitter_handle: "FireChicken007", telegram_handle: "FireChicken007", discord_url: null, image_url: "https://assets.geckoterminal.com/x0fk8" } } },
  [`https://api.dexscreener.com/tokens/v1/solana/${MINT}`]: [{ url: "https://dexscreener.com/solana/pair1", baseToken: { address: MINT, name: "Cluck Norris", symbol: "CLKN" }, info: { imageUrl: "https://cdn.dexscreener.com/cms/images/79Q1", websites: [{ url: "https://clucknorris.app", label: "Website" }, { url: "https://bags.fm/apps/2789", label: "Bags" }], socials: [{ url: "https://x.com/firechicken007", type: "twitter" }, { url: "https://t.me/FireChicken007", type: "telegram" }] } }],
  [`https://lite-api.jup.ag/tokens/v2/search?query=${MINT}`]: [{ id: MINT, name: "Cluck Norris", symbol: "CLKN", icon: "https://arweave.net/B-E2FyV8RUxlrpm0aCJH5MUVeovffe3Z1yYbjIUiE7w", isVerified: true, tags: ["verified"], website: "https://clucknorris.app", twitter: "https://x.com/FireChicken007", telegram: "https://t.me/FireChicken007" }],
  "https://arweave.net/meta.json": { name: "Cluck Norris", symbol: "CLKN", image: "https://arweave.net/B-E2FyV8RUxlrpm0aCJH5MUVeovffe3Z1yYbjIUiE7w", external_url: "https://clucknorris.app", extensions: { twitter: "https://twitter.com/FireChicken007", telegram: "https://t.me/FireChicken007" } },
};
const deps = {
  fetchJson: async (url) => { if (url in FIX) return FIX[url]; throw new Error("no fixture for " + url); },
  rpcCall: async (id, method, params) => {
    assert.strictEqual(method, "getAsset");
    return { id: params[0], mutable: true, content: { json_uri: "https://arweave.net/meta.json", metadata: { name: "Cluck Norris", symbol: "CLKN", description: "" }, links: { image: "https://arweave.net/B-E2FyV8RUxlrpm0aCJH5MUVeovffe3Z1yYbjIUiE7w", external_url: "https://clucknorris.app" } } };
  },
  env: {},
};

t("onchain adapter reads DAS + the URI JSON into canonical fields", async () => {
  const r = await byId.onchain.read(MINT, deps);
  assert.strictEqual(r.found, true); assert.strictEqual(r.shown.website, "https://clucknorris.app"); assert.strictEqual(r.shown.x, "https://twitter.com/FireChicken007");
});

t("onchain adapter unwraps the JSON-RPC envelope heliusRpcCall returns (live 2026-09-06: every token read not-found without this)", async () => {
  const wrapped = { ...deps, rpcCall: async (id, method, params) => ({ jsonrpc: "2.0", id, result: await deps.rpcCall(id, method, params) }) };
  const r = await byId.onchain.read(MINT, wrapped);
  assert.strictEqual(r.found, true); assert.ok(r.shown && r.shown.name, "name read through the envelope");
  const errored = { ...deps, rpcCall: async () => ({ jsonrpc: "2.0", error: { code: -32000, message: "boom" } }) };
  await assert.rejects(byId.onchain.read(MINT, errored), /rpc: boom/);
});
t("coingecko adapter: 404 is not-found, never an error", async () => {
  const r = await byId.coingecko.read(MINT, deps); assert.strictEqual(r.found, false);
});
t("geckoterminal adapter prefers the project's own site over the launchpad link", async () => {
  const r = await byId.geckoterminal.read(MINT, deps);
  assert.strictEqual(r.shown.website, "https://clucknorris.app"); assert.strictEqual(r.shown.x, "FireChicken007"); assert.strictEqual(r.shown.discord, "");
});
t("dexscreener adapter picks the base-token pair and its socials", async () => {
  const r = await byId.dexscreener.read(MINT, deps);
  assert.strictEqual(r.shown.telegram, "https://t.me/FireChicken007"); assert.strictEqual(r.shown.website, "https://clucknorris.app"); assert.strictEqual(r.url, "https://dexscreener.com/solana/pair1");
});
t("jupiter adapter matches the mint exactly and carries the verified flag", async () => {
  const r = await byId.jupiter.read(MINT, deps); assert.strictEqual(r.verified, true); assert.strictEqual(r.shown.x, "https://x.com/FireChicken007");
});
t("adapters that need a missing key throw (→ unread), never return a clean row", async () => {
  await assert.rejects(() => byId.solscan.read(MINT, deps), /SOLSCAN_API_KEY/);
  await assert.rejects(() => byId.coinmarketcap.read(MINT, deps), /CMC_API_KEY/);
  await assert.rejects(() => byId.birdeye.read(MINT, deps), /BIRDEYE_API_KEY/);
});
t("birdeye adapter parses the v3 metadata shape (owner's sample, address-keyed and single)", async () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const sample = { data: { [SOL]: { address: SOL, symbol: "SOL", name: "Wrapped SOL", decimals: 9, extensions: { coingecko_id: "solana", website: "https://solana.com/", twitter: "https://twitter.com/solana", discord: "https://discordapp.com/invite/pquxPsq", medium: "https://medium.com/solana-labs" }, logo_uri: "https://img.fotofolio.xyz/?url=x" } }, success: true };
  const d2 = { fetchJson: async () => sample, env: { BIRDEYE_API_KEY: "k" } };
  const r = await byId.birdeye.read(SOL, d2);
  assert.strictEqual(r.found, true); assert.strictEqual(r.shown.website, "https://solana.com/"); assert.strictEqual(r.shown.x, "https://twitter.com/solana"); assert.strictEqual(r.shown.discord, "https://discordapp.com/invite/pquxPsq"); assert.strictEqual(r.shown.telegram, "");
  const single = { data: sample.data[SOL], success: true };
  const r2 = await byId.birdeye.read(SOL, { fetchJson: async () => single, env: { BIRDEYE_API_KEY: "k" } });
  assert.strictEqual(r2.found, true); assert.strictEqual(r2.shown.name, "Wrapped SOL");
  const c = lc.canonicalFrom({ mint: SOL, name: "Wrapped SOL", symbol: "SOL", website: "solana.com", x: "@solana" });
  const rows = lc.compareFields(c, r.shown);
  assert.deepStrictEqual(Object.fromEntries(rows.map((x) => [x.field, x.status])), { name: "match", symbol: "match", website: "match", x: "match" });
});
t("pumpfun adapter is not-found for a non-pump mint without a network call", async () => {
  const r = await byId.pumpfun.read(MINT, { fetchJson: async () => { throw new Error("should not be called"); } }); assert.strictEqual(r.found, false);
});

// ── the run ──────────────────────────────────────────────────────────────────
t("runCheckup (preview): CLKN fixtures → onchain/gt/dex/jup correct, coingecko not-found; no 500 shape", async () => {
  const c = lc.canonicalFrom(CANON);
  const rep = await lc.runCheckup(c, { sources: SOURCES, deps, tier: "preview" });
  assert.strictEqual(rep.checked, 5);
  const st = Object.fromEntries(rep.sources.map((s) => [s.id, s.status]));
  assert.deepStrictEqual(st, { onchain: "correct", coingecko: "not-found", geckoterminal: "correct", dexscreener: "correct", jupiter: "correct" });
  assert.deepStrictEqual(rep.summary, { correct: 4, incorrect: 0, "not-found": 1, unread: 0 });
  assert.deepStrictEqual(rep.fixFirst, []);
  assert.ok(rep.sources.every((s) => typeof s.fixUrl === "string" && s.fixUrl.startsWith("http")), "every row carries a fix link");
});
t("runCheckup (full): keyless sources land as unread with the reason; a wrong on-chain site → fixFirst", async () => {
  const c = lc.canonicalFrom({ ...CANON, website: "https://clucknorris.io" });
  const rep = await lc.runCheckup(c, { sources: SOURCES, deps, tier: "full" });
  const by = Object.fromEntries(rep.sources.map((s) => [s.id, s]));
  assert.strictEqual(by.solscan.status, "unread"); assert.match(by.solscan.error, /SOLSCAN_API_KEY/);
  assert.strictEqual(by.onchain.status, "incorrect"); assert.deepStrictEqual(rep.fixFirst, ["website"]);
  assert.strictEqual(by.geckoterminal.status, "incorrect");
  assert.strictEqual(rep.summary.unread, 4, "solscan, cmc, birdeye without keys + rugcheck with no fixture → unread; pumpfun is not-found for a non-pump mint");
  assert.strictEqual(by.pumpfun.status, "not-found");
});
t("runCheckup: an adapter that throws becomes an unread row, the report still returns", async () => {
  const c = lc.canonicalFrom(CANON);
  const boom = { id: "boom", label: "Boom", tier: "preview", pageUrl: () => "https://boom", fixUrl: () => "https://boom/fix", read: async () => { throw new Error("kaboom"); } };
  const rep = await lc.runCheckup(c, { sources: [boom], deps, tier: "preview" });
  assert.strictEqual(rep.sources[0].status, "unread"); assert.strictEqual(rep.sources[0].error, "kaboom");
});

// ── cache ────────────────────────────────────────────────────────────────────
t("cache keeps the last 3 runs per mint and evicts the oldest-touched mint past the cap", () => {
  const store = {}; const kv = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } };
  for (let i = 0; i < 5; i++) lc.cachePut(kv, MINT, { summary: { i } }, 1000 + i);
  assert.strictEqual(lc.cacheGet(kv, MINT).runs.length, 3); assert.strictEqual(lc.cacheGet(kv, MINT).runs[0].summary.i, 4);
  const all = kv.get(lc.CACHE_KEY, {});
  for (let i = 0; i < lc.CACHE_MAX_MINTS + 5; i++) all["m" + i] = { runs: [{}], touched: i };
  kv.set(lc.CACHE_KEY, all);
  lc.cachePut(kv, "fresh", { summary: {} }, 99999);
  const after = kv.get(lc.CACHE_KEY, {});
  assert.ok(Object.keys(after).length <= lc.CACHE_MAX_MINTS); assert.ok(after.fresh); assert.ok(!after.m0, "oldest-touched evicted");
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + (e && e.message)); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
