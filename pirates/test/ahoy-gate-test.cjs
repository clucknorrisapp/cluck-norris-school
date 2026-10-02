#!/usr/bin/env node
// AHOY: PumpFunPirates — holder gate tests. Pure tier decision + the full HTTP sign-in flow with a
// real ed25519 keypair against a FAKE chain (a local JSON-RPC stub), so it runs with no network.
const assert = require("assert");
const express = require("express");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const makeRouter = require("../routes");
const { decideTier, tiers, AHOY_MINT } = makeRouter;

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log("  ✓ " + name); pass++; } catch (e) { console.log("  ✗ " + name + "\n      " + e.message); fail++; } };

(async () => {
  const T = tiers();
  console.log("tier decision");
  await t("an NFT holder is crew regardless of AHOY", () => assert.strictEqual(decideTier({ nftCount: 1, ahoy: 0, priceUsd: 0.00004, tiers: T }).tier, "nft"));
  await t("$5 of AHOY is deckhand", () => assert.strictEqual(decideTier({ nftCount: 0, ahoy: 5 / 0.00004, priceUsd: 0.00004, tiers: T }).tier, "deckhand"));
  await t("$25 of AHOY is captain", () => assert.strictEqual(decideTier({ nftCount: 0, ahoy: 25 / 0.00004, priceUsd: 0.00004, tiers: T }).tier, "captain"));
  await t("just under $5 stays free", () => assert.strictEqual(decideTier({ nftCount: 0, ahoy: 4.99 / 0.00004, priceUsd: 0.00004, tiers: T }).tier, "free"));
  await t("a price outage is 'unavailable', never a zero balance", () => {
    const d = decideTier({ nftCount: 0, ahoy: 1e9, priceUsd: null, tiers: T });
    assert.strictEqual(d.tier, "free"); assert.strictEqual(d.unavailable, true);
  });

  // Fake chain: holder A has 200k AHOY + 1 Pirate NFT, holder B has 700k AHOY, nobody else has anything.
  const kpA = nacl.sign.keyPair(), kpB = nacl.sign.keyPair(), kpC = nacl.sign.keyPair();
  const A = bs58.encode(kpA.publicKey), B = bs58.encode(kpB.publicKey), C = bs58.encode(kpC.publicKey);
  const rpcApp = express(); rpcApp.use(express.json());
  rpcApp.post("/", (req, res) => {
    const { method, params } = req.body;
    if (method === "getTokenAccountsByOwner") {
      const owner = params[0], amt = owner === A ? "200000" : owner === B ? "700000" : null;
      assert.strictEqual(params[1].mint, AHOY_MINT);
      return res.json({ result: { value: amt ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: amt } } } } } }] : [] } });
    }
    if (method === "searchAssets") {
      const items = params.ownerAddress === A ? [{ id: "NFT1", content: { metadata: { name: "Pump Fun Pirates #16", attributes: [{ trait_type: "eyewear", value: "laser" }] }, files: [{ uri: "https://example/16.png" }] } }] : [];
      return res.json({ result: { items } });
    }
    res.json({ error: { message: "unexpected " + method } });
  });
  const rpcServer = await new Promise((r) => { const s = rpcApp.listen(0, () => r(s)); });
  const app = express();
  app.use(makeRouter({ getUsdPrice: async () => 0.00004, rpcUrl: `http://127.0.0.1:${rpcServer.address().port}/` }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const signIn = async (kp, wallet, tamper) => {
    const ch = await post("/api/ahoy/challenge", { wallet });
    assert.ok(ch.body.ok, "challenge ok");
    const sig = nacl.sign.detached(new TextEncoder().encode(tamper ? ch.body.message + "x" : ch.body.message), kp.secretKey);
    return { ch, res: await post("/api/ahoy/verify", { wallet, nonce: ch.body.nonce, signature: bs58.encode(sig) }) };
  };

  console.log("http flow");
  await t("config prices the tiers live (AHOY amounts from the price, not hardcoded)", async () => {
    const j = await (await fetch(base + "/api/ahoy/config")).json();
    assert.strictEqual(j.priceUsd, 0.00004);
    assert.strictEqual(Math.round(j.tiers.find((x) => x.id === "deckhand").holdAhoy), 125000);
  });
  await t("holder A (NFT) signs in → tier nft, NFT listed with traits", async () => {
    const { res } = await signIn(kpA, A);
    assert.strictEqual(res.body.tier, "nft"); assert.strictEqual(res.body.nfts.length, 1); assert.strictEqual(res.body.nfts[0].traits.eyewear, "laser");
  });
  await t("holder B (700k AHOY ≈ $28) → captain", async () => { const { res } = await signIn(kpB, B); assert.strictEqual(res.body.tier, "captain"); });
  await t("wallet C (nothing) → free", async () => { const { res } = await signIn(kpC, C); assert.strictEqual(res.body.tier, "free"); });
  await t("a signature from the WRONG key is refused", async () => {
    const ch = await post("/api/ahoy/challenge", { wallet: A });
    const sig = nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpB.secretKey);
    const r = await post("/api/ahoy/verify", { wallet: A, nonce: ch.body.nonce, signature: bs58.encode(sig) });
    assert.strictEqual(r.status, 401);
  });
  await t("a tampered message is refused", async () => { const { res } = await signIn(kpA, A, true); assert.strictEqual(res.status, 401); });
  await t("a nonce is single-use (replay refused)", async () => {
    const ch = await post("/api/ahoy/challenge", { wallet: B });
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpB.secretKey));
    const r1 = await post("/api/ahoy/verify", { wallet: B, nonce: ch.body.nonce, signature: sig });
    const r2 = await post("/api/ahoy/verify", { wallet: B, nonce: ch.body.nonce, signature: sig });
    assert.strictEqual(r1.status, 200); assert.strictEqual(r2.status, 400);
  });
  await t("a nonce issued to one wallet can't be used by another", async () => {
    const ch = await post("/api/ahoy/challenge", { wallet: A });
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpB.secretKey));
    const r = await post("/api/ahoy/verify", { wallet: B, nonce: ch.body.nonce, signature: sig });
    assert.strictEqual(r.status, 400);
  });
  await t("a non-address is refused at the challenge", async () => { const r = await post("/api/ahoy/challenge", { wallet: "not-a-wallet" }); assert.strictEqual(r.status, 400); });
  await t("/ahoy-quest redirects once to /ahoy-quest/ and the shell is noindex", async () => {
    const r1 = await fetch(base + "/ahoy-quest", { redirect: "manual" });
    assert.strictEqual(r1.status, 301); assert.strictEqual(r1.headers.get("location"), "/ahoy-quest/");
    const r2 = await fetch(base + "/ahoy-quest/", { redirect: "manual" });
    assert.strictEqual(r2.status, 200); assert.match(r2.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(await r2.text(), /AHOY: PumpFunPirates/);
  });

  server.close(); rpcServer.close();
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
