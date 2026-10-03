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
  const rpcUrl = `http://127.0.0.1:${rpcServer.address().port}/`;
  app.use(makeRouter({ getUsdPrice: async () => 0.00004, rpcUrl, sessionSecret: "test-secret" }));
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

  // ── Finding 4: session tokens. A cached grant is only ever a wallet-bound proof of an earlier
  // signature; the tier is re-read live every time and never travels in the token.
  console.log("session (returning player re-check)");
  let tokA = null;
  const decode = (tok) => JSON.parse(Buffer.from(tok.split(".")[0], "base64url").toString("utf8"));
  await t("verify issues a wallet-bound token with a one-day expiry and NO tier in it", async () => {
    const { res } = await signIn(kpA, A); tokA = res.body.token;
    assert.ok(res.body.token, "token issued");
    const p = decode(res.body.token);
    assert.strictEqual(p.w, A); assert.ok(!("tier" in p) && !("nfts" in p));
    assert.ok(Math.abs(p.exp - (Date.now() + makeRouter.SESSION_TTL_MS)) < 60_000, "expiry is about a day out");
    assert.ok(Math.abs(res.body.expiresAt - p.exp) < 5_000, "expiresAt matches the token");
  });
  await t("/session with a good token re-reads the chain and returns the live tier", async () => {
    const { res } = await signIn(kpA, A); const r = await post("/api/ahoy/session", { wallet: A, token: res.body.token });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.tier, "nft"); assert.strictEqual(r.body.nfts.length, 1);
    const { res: rb } = await signIn(kpB, B); const r2 = await post("/api/ahoy/session", { wallet: B, token: rb.body.token });
    assert.strictEqual(r2.body.tier, "captain");
  });
  await t("a token for wallet A cannot be used for wallet B", async () => {
    const { res } = await signIn(kpA, A); const r = await post("/api/ahoy/session", { wallet: B, token: res.body.token });
    assert.strictEqual(r.status, 401);
  });
  await t("a tampered, empty or hand-made token is refused", async () => {
    const { res } = await signIn(kpA, A); const [body, sig] = res.body.token.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "ahoy", w: C, exp: Date.now() + 1e9 })).toString("base64url");
    for (const tok of [forged + "." + sig, body + "." + sig.slice(1) + "A", "", "nft", null]) {
      const r = await post("/api/ahoy/session", { wallet: tok === forged + "." + sig ? C : A, token: tok });
      assert.strictEqual(r.status, 401, "token " + String(tok).slice(0, 12));
    }
  });
  await t("an expired token is refused", async () => {
    let clock = 1_000_000_000_000;
    const app2 = express(); app2.use(makeRouter({ getUsdPrice: async () => 0.00004, rpcUrl, sessionSecret: "test-secret", now: () => clock }));
    const srv2 = await new Promise((r) => { const x = app2.listen(0, () => r(x)); });
    const b2 = `http://127.0.0.1:${srv2.address().port}`;
    const p2 = async (path, body) => { const r = await fetch(b2 + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const ch = await p2("/api/ahoy/challenge", { wallet: A });
    const v = await p2("/api/ahoy/verify", { wallet: A, nonce: ch.body.nonce, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpA.secretKey)) });
    assert.strictEqual((await p2("/api/ahoy/session", { wallet: A, token: v.body.token })).status, 200);
    clock += makeRouter.SESSION_TTL_MS + 1000;
    assert.strictEqual((await p2("/api/ahoy/session", { wallet: A, token: v.body.token })).status, 401);
    srv2.close();
  });
  await t("with no session secret there is no token and /session refuses everything", async () => {
    const saved = process.env.AHOY_SESSION_SECRET; delete process.env.AHOY_SESSION_SECRET;
    const app3 = express(); app3.use(makeRouter({ getUsdPrice: async () => 0.00004, rpcUrl }));
    const srv3 = await new Promise((r) => { const x = app3.listen(0, () => r(x)); });
    const b3 = `http://127.0.0.1:${srv3.address().port}`;
    const p3 = async (path, body) => { const r = await fetch(b3 + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const ch = await p3("/api/ahoy/challenge", { wallet: A });
    const v = await p3("/api/ahoy/verify", { wallet: A, nonce: ch.body.nonce, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpA.secretKey)) });
    assert.strictEqual(v.status, 200); assert.strictEqual(v.body.token, null);
    assert.strictEqual((await p3("/api/ahoy/session", { wallet: A, token: "anything" })).status, 401);
    srv3.close(); if (saved !== undefined) process.env.AHOY_SESSION_SECRET = saved;
  });
  await t("/session answers 503 + unavailable when the chain can't be read (never a zero balance)", async () => {
    const down = express(); down.use(express.json()); down.post("/", (req, rs) => rs.status(500).json({ error: { message: "down" } }));
    const dsrv = await new Promise((r) => { const x = down.listen(0, () => r(x)); });
    const app4 = express(); app4.use(makeRouter({ getUsdPrice: async () => 0.00004, rpcUrl: `http://127.0.0.1:${dsrv.address().port}/`, sessionSecret: "test-secret" }));
    const srv4 = await new Promise((r) => { const x = app4.listen(0, () => r(x)); });
    const r = await fetch(`http://127.0.0.1:${srv4.address().port}/api/ahoy/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: A, token: tokA }) });
    const j = await r.json();
    assert.strictEqual(r.status, 503); assert.strictEqual(j.unavailable, true); assert.ok(!j.tier);
    srv4.close(); dsrv.close();
  });

  // ── Finding 6: a last-good price has a maximum age. Drives the FALLBACK PATH itself: both price
  // sources fail, a cached price exists, and the clock moves past the limit.
  console.log("stale price");
  const clock6 = { now: 2_000_000_000_000 };
  const src = { primary: 0.00004, jup: null, primaryCalls: 0, jupCalls: 0 };
  const app6 = express();
  app6.use(makeRouter({
    rpcUrl, now: () => clock6.now, sessionSecret: "test-secret",
    getUsdPrice: async () => { src.primaryCalls++; if (src.primary == null) throw new Error("primary down"); return src.primary; },
    jupPrice: async () => { src.jupCalls++; if (src.jup == null) throw new Error("jup down"); return src.jup; },
  }));
  const srv6 = await new Promise((r) => { const x = app6.listen(0, () => r(x)); });
  const b6 = `http://127.0.0.1:${srv6.address().port}`;
  const p6 = async (path, body) => { const r = await fetch(b6 + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const tierOfB = async () => {
    const ch = await p6("/api/ahoy/challenge", { wallet: B });
    return (await p6("/api/ahoy/verify", { wallet: B, nonce: ch.body.nonce, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kpB.secretKey)) })).body;
  };
  const cfg6 = async () => (await fetch(b6 + "/api/ahoy/config")).json();
  await t("a good price is cached and used", async () => { assert.strictEqual((await tierOfB()).tier, "captain"); });
  src.primary = null; // both sources now fail
  await t("sources failing, last-good price YOUNG (5 min): still used", async () => {
    clock6.now += 5 * 60_000; const before = src.jupCalls;
    const r = await tierOfB();
    assert.ok(src.jupCalls > before, "the secondary source was tried (fallback path ran)");
    assert.strictEqual(r.tier, "captain"); assert.strictEqual(r.unavailable, false); assert.ok(r.priceUsd > 0);
  });
  await t("sources failing, last-good price OLDER than the limit: 'unavailable', no tier from the old price", async () => {
    clock6.now += makeRouter.PRICE_MAX_AGE_MS + 1000; const before = src.jupCalls;
    const r = await tierOfB();
    assert.ok(src.jupCalls > before, "both sources were tried");
    assert.strictEqual(r.unavailable, true); assert.strictEqual(r.tier, "free"); assert.strictEqual(r.priceUsd, null); assert.strictEqual(r.usd, null);
    const c = await cfg6();
    assert.strictEqual(c.priceUsd, null); assert.ok(c.tiers.every((x) => x.holdAhoy == null), "config no longer prices tiers from the stale number");
  });
  await t("a recovered source restores the tier", async () => {
    src.primary = 0.00004;
    const r = await tierOfB(); assert.strictEqual(r.tier, "captain"); assert.strictEqual(r.unavailable, false);
  });
  await t("the secondary source alone keeps the gate alive (and refreshes the age)", async () => {
    src.primary = null; src.jup = 0.00004; clock6.now += 2 * 60_000;
    const r = await tierOfB(); assert.strictEqual(r.tier, "captain"); assert.ok(src.jupCalls > 0);
    src.jup = null; clock6.now += 10 * 60_000;
    assert.strictEqual((await tierOfB()).tier, "captain", "10 min after the refresh is still young");
    clock6.now += 25 * 60_000;
    assert.strictEqual((await tierOfB()).unavailable, true, "35 min after the refresh is stale");
  });
  srv6.close();

  server.close(); rpcServer.close();
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
