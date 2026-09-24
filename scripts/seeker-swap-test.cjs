#!/usr/bin/env node
"use strict";
// Seeker app in-app swap — the SERVER-SIDE proxy (docs/SEEKER_SWAP_DESIGN.md). Three public
// relays: GET /api/seeker/swap/config, GET .../quote, POST .../tx. No admin key, nothing
// server-signed — every transaction Jupiter builds is signed by the user's own wallet in the app.
//
// Boots the real server.js with TWO local stubs (no live network call in CI):
//   - JUP_SWAP_BASE — replaces BOTH lite-api.jup.ag and api.jup.ag with one local HTTP server
//     that serves the REAL recorded fixtures under scripts/fixtures/seeker-swap/ (quote.json,
//     swap.json — verified against the live API by hand before this file was written; see this
//     PR's comment for the live curl output).
//   - FALLBACK_RPC_URL — replaces the chain RPC (lib/rpc.js) with the same local stub so the
//     config route's SKR/CLKN decimals lookup (AGENTS.md: never hardcode SKR/CLKN decimals) does
//     not need a real network call either. The stub answers getTokenSupply with the REAL decimals
//     read from the chain by hand (SKR=6, CLKN=9 — confirmed against mainnet getTokenSupply; see
//     the PR comment), so the config assertions below are pinned to real values, not invented ones.
//
// ⛔ NO PLATFORM FEE (owner, 2026-09-24): the fee design section and its env vars were dropped
// entirely after this file was first drafted. The one fee-shaped assertion left is negative: the
// stub must never observe a fee field on either upstream call.
//
// Usage: node scripts/seeker-swap-test.cjs (boots its own server + stub, no external network)

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

const SKR_MINT = require(path.join(ROOT, "lib", "tool-pass-qualify")).SKR_MINT;
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// A real, well-formed base58 mint that is simply NOT on the swap allowlist.
const OFF_LIST_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
// Real decimals read by hand from mainnet getTokenSupply (see the PR comment for the raw output).
const REAL_DECIMALS = { [SOL_MINT]: 9, [SKR_MINT]: 6, [CLKN_MINT]: 9, [USDC_MINT]: 6 };

const FIXTURE_QUOTE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "quote.json"), "utf8"));
const FIXTURE_SWAP = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "swap.json"), "utf8"));

(async () => {
  console.log("\nSeeker swap — server-side proxy\n");

  // ---- static: SEEKER_API_RE covers all three paths, without a pane on this branch to derive
  // the inventory from (the Swap pane ships on a separate branch/PR). --------------------------
  console.log("(0) static — SEEKER_API_RE matches all three swap routes\n");
  {
    const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    const m = src.match(/const SEEKER_API_RE = \/(.*)\/;/);
    if (!m) { console.log("  ✗ SEEKER_API_RE not found in server.js"); process.exit(1); }
    const re = new RegExp(m[1]);
    for (const p of ["/api/seeker/swap/config", "/api/seeker/swap/quote", "/api/seeker/swap/tx"]) {
      ok(`SEEKER_API_RE matches ${p}`, re.test(p));
    }
    ok("SEEKER_API_RE does NOT match an unrelated /api/seeker/swap/anything-else path", !re.test("/api/seeker/swap/anything-else"));
  }

  // ---- local stubs -------------------------------------------------------------------------
  let jupState = { failQuote: false, failSwap: false, lastQuoteQuery: null, lastSwapBody: null };
  const stub = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (u.pathname === "/swap/v1/quote") {
        jupState.lastQuoteQuery = u.search;
        if (jupState.failQuote) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "simulated upstream failure" })); return; }
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(FIXTURE_QUOTE)); return;
      }
      if (u.pathname === "/swap/v1/swap" && req.method === "POST") {
        try { jupState.lastSwapBody = JSON.parse(body || "{}"); } catch (_) { jupState.lastSwapBody = null; }
        if (jupState.failSwap) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "simulated upstream failure" })); return; }
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(FIXTURE_SWAP)); return;
      }
      // The RPC stand-in — lib/rpc.js posts the whole JSON-RPC body straight to FALLBACK_RPC_URL.
      if (req.method === "POST" && u.pathname === "/rpc") {
        let j = null; try { j = JSON.parse(body || "{}"); } catch (_) {}
        if (j && j.method === "getTokenSupply") {
          const mint = j.params && j.params[0];
          const decimals = REAL_DECIMALS[mint];
          if (decimals != null) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, result: { context: { slot: 1 }, value: { amount: "1", decimals, uiAmount: 1 } } }));
            return;
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: j && j.id, error: { message: "unexpected rpc call in test" } })); return;
      }
      res.writeHead(404, { "Content-Type": "application/json" }); res.end("{}");
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = stub.address().port;
  const stubBase = `http://127.0.0.1:${stubPort}`;

  // ---- boot server.js ------------------------------------------------------------------------
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seeker-swap-"));
  const PORT = 4492;
  const env = {
    ...process.env, PORT: String(PORT), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: "seeker-swap-test-key",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", HELIUS_API_KEY_2: "",
    MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: `${stubBase}/rpc`,
    JUP_SWAP_BASE: stubBase,
    JUPITER_API_KEY: "", // no key in this test — jupSwapCall must still work through JUP_SWAP_BASE
  };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  const base = `http://127.0.0.1:${PORT}`;
  const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { stub.close(); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { stop(); console.log("  ✗ server did not come up"); process.exit(1); }

  function getJson(p) { return fetch(base + p).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })); }
  function postJson(p, body) {
    return fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  }

  try {
    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(1) GET /api/seeker/swap/config\n");
    {
      const r = await getJson("/api/seeker/swap/config");
      ok("200 ok:true", r.status === 200 && r.json && r.json.ok === true, r);
      const bySym = {}; (r.json && r.json.mints || []).forEach((m) => (bySym[m.symbol] = m));
      ok("lists exactly SOL, SKR, CLKN, USDC", Object.keys(bySym).sort().join(",") === "CLKN,SKR,SOL,USDC", bySym);
      ok("SKR mint comes from lib/tool-pass-qualify.js's SKR_MINT (never retyped)", bySym.SKR && bySym.SKR.mint === SKR_MINT, bySym.SKR);
      ok("CLKN mint is the real CLKN mint", bySym.CLKN && bySym.CLKN.mint === CLKN_MINT, bySym.CLKN);
      ok("SOL decimals = 9 (fixed)", bySym.SOL && bySym.SOL.decimals === 9);
      ok("USDC decimals = 6 (fixed)", bySym.USDC && bySym.USDC.decimals === 6);
      ok("⚠️ SKR decimals READ FROM THE CHAIN (via the stub, real value = 6), never hardcoded", bySym.SKR && bySym.SKR.decimals === 6, bySym.SKR);
      ok("⚠️ CLKN decimals READ FROM THE CHAIN (via the stub, real value = 9), never hardcoded", bySym.CLKN && bySym.CLKN.decimals === 9, bySym.CLKN);
      ok("defaultIn/defaultOut = SOL/SKR", r.json.defaultIn === "SOL" && r.json.defaultOut === "SKR");
      ok("slippageBpsOptions includes 50/100/300, default 100", JSON.stringify(r.json.slippageBpsOptions) === JSON.stringify([50, 100, 300]) && r.json.defaultSlippageBps === 100, r.json);
      ok("⛔ platformFeeBps is published as the constant 0 (owner, 2026-09-24: no platform fee)", r.json.platformFeeBps === 0, r.json.platformFeeBps);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(2) GET /api/seeker/swap/quote — validation\n");
    {
      const good = { inputMint: SOL_MINT, outputMint: SKR_MINT, amount: "10000000", slippageBps: "100" };
      const q = (over) => "/api/seeker/swap/quote?" + new URLSearchParams(Object.assign({}, good, over)).toString();

      const r1 = await getJson(q({ inputMint: OFF_LIST_MINT }));
      ok("non-allowlisted inputMint -> 400 bad_request, field:inputMint", r1.status === 400 && r1.json.error === "bad_request" && r1.json.field === "inputMint", r1);

      const r2 = await getJson(q({ outputMint: OFF_LIST_MINT }));
      ok("non-allowlisted outputMint -> 400 bad_request, field:outputMint", r2.status === 400 && r2.json.error === "bad_request" && r2.json.field === "outputMint", r2);

      const r3 = await getJson(q({ outputMint: SOL_MINT })); // input === output, both allowlisted
      ok("identical mints -> 400 bad_request", r3.status === 400 && r3.json.error === "bad_request", r3);

      const r4 = await getJson(q({ amount: "1.5" }));
      ok("float amount -> 400 bad_request, field:amount", r4.status === 400 && r4.json.error === "bad_request" && r4.json.field === "amount", r4);

      const r5 = await getJson(q({ amount: "1".repeat(21) }));
      ok("21-digit amount -> 400 bad_request, field:amount", r5.status === 400 && r5.json.error === "bad_request" && r5.json.field === "amount", r5);

      const r6 = await getJson(q({ amount: "0" }));
      ok("zero amount -> 400 bad_request, field:amount", r6.status === 400 && r6.json.error === "bad_request" && r6.json.field === "amount", r6);

      const r7 = await getJson(q({ slippageBps: "25" }));
      ok("off-list slippageBps -> 400 bad_request, field:slippageBps", r7.status === 400 && r7.json.error === "bad_request" && r7.json.field === "slippageBps", r7);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(3) GET /api/seeker/swap/quote — good quote, and the fee assertion\n");
    let quoteId = null;
    {
      jupState.lastQuoteQuery = null;
      const r = await getJson("/api/seeker/swap/quote?" + new URLSearchParams({ inputMint: SOL_MINT, outputMint: SKR_MINT, amount: "10000000", slippageBps: "100" }).toString());
      ok("200 ok:true with quote + quoteId", r.status === 200 && r.json && r.json.ok === true && !!r.json.quote && !!r.json.quoteId, r);
      ok("quote is the fixture's own quote object (inputMint/outputMint/outAmount match)",
        r.json.quote && r.json.quote.inputMint === FIXTURE_QUOTE.inputMint && r.json.quote.outputMint === FIXTURE_QUOTE.outputMint && r.json.quote.outAmount === FIXTURE_QUOTE.outAmount, r.json.quote);
      ok("⛔ NO platformFeeBps was sent on the upstream quote query (owner, 2026-09-24: no platform fee)",
        !!jupState.lastQuoteQuery && !/platformFeeBps/i.test(jupState.lastQuoteQuery), jupState.lastQuoteQuery);
      quoteId = r.json.quoteId;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(4) POST /api/seeker/swap/tx\n");
    {
      const someKey = "3VELZ2avSUq79qstuR8a7C3euJ834WmQyrjt4uRnn4eb"; // any real-shaped base58 address

      const r1 = await postJson("/api/seeker/swap/tx", { quoteId: "not-a-real-id", userPublicKey: someKey });
      ok("unknown quoteId -> 409 quote_expired", r1.status === 409 && r1.json.error === "quote_expired", r1);

      const r2 = await postJson("/api/seeker/swap/tx", { quoteId, userPublicKey: "not-an-address" });
      ok("bad userPublicKey -> 400 bad_request, field:userPublicKey", r2.status === 400 && r2.json.error === "bad_request" && r2.json.field === "userPublicKey", r2);

      jupState.lastSwapBody = null;
      // Send different amounts than the stored quote's own — they must be IGNORED; the response
      // must echo the STORED quote, not anything from this request body.
      const r3 = await postJson("/api/seeker/swap/tx", { quoteId, userPublicKey: someKey, inAmount: "999", outAmount: "999", otherAmountThreshold: "999" });
      ok("good tx -> 200 ok:true with the fixture's swapTransaction", r3.status === 200 && r3.json && r3.json.ok === true && r3.json.swapTransaction === FIXTURE_SWAP.swapTransaction, r3.status);
      ok("lastValidBlockHeight comes from the fixture", r3.json.lastValidBlockHeight === FIXTURE_SWAP.lastValidBlockHeight, r3.json.lastValidBlockHeight);
      ok("⚠️ inAmount/outAmount/otherAmountThreshold are echoed from the STORED quote, not the request's forged values",
        r3.json.inAmount === FIXTURE_QUOTE.inAmount && r3.json.outAmount === FIXTURE_QUOTE.outAmount && r3.json.otherAmountThreshold === FIXTURE_QUOTE.otherAmountThreshold, r3.json);
      ok("the swap call really did reach the stub with the real userPublicKey", !!jupState.lastSwapBody && jupState.lastSwapBody.userPublicKey === someKey, jupState.lastSwapBody);
      ok("the swap call carries the STORED quoteResponse (not anything client-forged)", !!jupState.lastSwapBody && jupState.lastSwapBody.quoteResponse && jupState.lastSwapBody.quoteResponse.outAmount === FIXTURE_QUOTE.outAmount, jupState.lastSwapBody && jupState.lastSwapBody.quoteResponse);
      ok("⛔ NO feeAccount / platformFee on the swap body (owner, 2026-09-24: no platform fee)",
        !!jupState.lastSwapBody && jupState.lastSwapBody.feeAccount === undefined && jupState.lastSwapBody.platformFee === undefined, jupState.lastSwapBody);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(5) upstream failure -> 502, never a fabricated quote\n");
    {
      jupState.failQuote = true;
      const r = await getJson("/api/seeker/swap/quote?" + new URLSearchParams({ inputMint: SOL_MINT, outputMint: SKR_MINT, amount: "10000000", slippageBps: "100" }).toString());
      ok("stub 500 on quote -> 502 quote_unavailable", r.status === 502 && r.json.error === "quote_unavailable", r);
      ok("⚠️ no `quote` field on a failed quote (never a fabricated response)", r.json.quote === undefined, r.json);
      jupState.failQuote = false;

      jupState.failSwap = true;
      // Re-quote for a fresh id first (the earlier one may have expired the 60s window in a slow CI run, but more importantly this proves the failure path independent of quote state).
      const rq = await getJson("/api/seeker/swap/quote?" + new URLSearchParams({ inputMint: SOL_MINT, outputMint: SKR_MINT, amount: "10000000", slippageBps: "100" }).toString());
      const r2 = await postJson("/api/seeker/swap/tx", { quoteId: rq.json.quoteId, userPublicKey: "3VELZ2avSUq79qstuR8a7C3euJ834WmQyrjt4uRnn4eb" });
      ok("stub 500 on swap -> 502 swap_unavailable", r2.status === 502 && r2.json.error === "swap_unavailable", r2);
      ok("⚠️ no `swapTransaction` field on a failed tx build", r2.json.swapTransaction === undefined, r2.json);
      jupState.failSwap = false;
    }
  } finally { stop(); }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
