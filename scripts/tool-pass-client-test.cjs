#!/usr/bin/env node
// Tools pass CLIENT — the payment attempt survives a lost wallet callback (second reviewer, round 4).
//
// Finding: rememberPay ran only after signAndSendTransaction returned its signature. A wallet that
// broadcast but whose callback rejected (or a tab lost mid-call) left nothing behind; the next tap
// saw no pending payment and sent a FRESH transfer, without the separate new-payment confirmation.
// Reproduced by the reviewer with a mock wallet that broadcasts then rejects: two clicks → two
// broadcasts.
//
// What this pins, with a fake Wallet Standard wallet, a mocked RPC and the REAL server + REAL
// cluck-gate.js on a real tool page:
//   A. sign-first wallet: the signature is in localStorage BEFORE sendTransaction reaches the RPC.
//   B. send-only wallet that broadcasts then rejects: an unresolved attempt (sig:null) is recorded,
//      the page says the wallet may still have sent it, and a SECOND tap does NOT broadcast again —
//      it asks the chain; an empty-but-young history stays "unknown" (still no charge).
//   C. the chain shows a payment to us since the attempt → the client adopts that signature and the
//      server issues the pass; still exactly one broadcast.
//   D. an attempt proven dead (history read in full, blockhash long expired) IS released, so a
//      wallet whose transfer genuinely never happened can pay again.
//   E. server.js: the advertised offer is read per request (getters), not snapshotted at boot.
//
// Runs offline: no keys, no chain, no money. Needs playwright + a chromium (CI installs both in the
// smoke-test job; locally /opt/pw-browsers/chromium or PLAYWRIGHT_CHROMIUM_PATH).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };
const PORT = 3884;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-gate-client-"));
const ADDR = "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh";
const SIGBYTES = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = "1" + s; else break; } return s; }
const SIG = b58(SIGBYTES);
function findChromium() {
  const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return undefined;
}

// The fake wallet. `mode` = "sign" (solana:signTransaction only — the shim's send-only fallback is
// never used) or "send" (solana:signAndSendTransaction only: broadcasts, counts it, then REJECTS —
// the reviewer's reproduction). signMessage always works (the session challenge).
const FAKE = (mode) => `(() => {
  const ADDR = "${ADDR}";
  const SIGBYTES = Uint8Array.from(${JSON.stringify(SIGBYTES)});
  const account = { address: ADDR, publicKey: new Uint8Array(32).fill(7), chains: ["solana:mainnet"], features: [] };
  window.__sends = 0; window.__signs = 0;
  const wallet = {
    version: "1.0.0", name: "FakeWallet", icon: "data:image/svg+xml;base64,PHN2Zy8+", chains: ["solana:mainnet"], accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => inputs.map(i => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(9) })) },
    },
  };
  if (${JSON.stringify(mode)} === "sign") {
    wallet.features["solana:signTransaction"] = { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
      signTransaction: async (...inputs) => inputs.map(i => {
        // legacy wire format: compact-u16 signature count, then 64-byte signatures, then the message.
        const b = Uint8Array.from(i.transaction); b[0] = 1; b.set(SIGBYTES, 1); window.__signs++;
        return { signedTransaction: b };
      }) };
  } else {
    wallet.features["solana:signAndSendTransaction"] = { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
      signAndSendTransaction: async () => { window.__sends++; throw new Error("wallet callback lost after broadcast"); } };
  }
  const cb = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
})();`;

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (e2) { console.error("needs playwright(-core)"); process.exit(1); } }
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "", FALLBACK_RPC_URL: "http://127.0.0.1:9" } });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  const cfg = await (await fetch(`${BASE}/api/tool-gate/config`)).json();
  const RECEIVER = cfg.receiver;
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  console.log("\nTools pass client — a lost wallet callback never charges twice\n");

  // Mocks: the pass service (challenge / session) and the RPC. `rpc` is per-scenario state.
  async function open(mode, rpc, seed) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(FAKE(mode));
    if (seed) await page.addInitScript((s) => { localStorage.setItem("clkn_tools_paysig", JSON.stringify(s)); }, seed);
    await page.route("**/api/tool-gate/challenge*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, message: "clkn-tools challenge nonce-for-test" }) }));
    await page.route("**/api/tool-gate/session", async (r) => {
      const body = JSON.parse(r.request().postData() || "{}");
      rpc.sessions.push(body);
      if (body.paySig) {
        const j = rpc.sessionForSig ? rpc.sessionForSig(body.paySig) : { success: false, error: "payment not found yet" };
        return r.fulfill({ contentType: "application/json", body: JSON.stringify(j) });
      }
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ success: false, error: "insufficient_holdings", balance: 0, needed: 1000, payIntent: "pi-test" }) });
    });
    await page.route("**/api/helius-rpc", async (r) => {
      const body = JSON.parse(r.request().postData() || "{}");
      rpc.calls.push(body.method);
      const reply = (result) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) });
      if (body.method === "getLatestBlockhash") return reply({ context: { slot: 1 }, value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 } });
      if (body.method === "sendTransaction") { rpc.sendSeenRecord = await page.evaluate(() => localStorage.getItem("clkn_tools_paysig")); return reply(SIG); }
      if (body.method === "getSignaturesForAddress") return reply(rpc.history || []);
      if (body.method === "getTransaction") return reply(rpc.tx ? rpc.tx(body.params[0]) : null);
      return reply(null);
    });
    await page.goto(`${BASE}/wallet-xray`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window.CluckGate && window.CluckWallet && window.CluckUtil), null, { timeout: 15000 });
    // open the gate card the way a tool does, then connect the (only) wallet → PAY appears
    await page.evaluate(() => { window.__ran = 0; window.CluckGate.guard(function () { window.__ran++; }, { tool: "X-Ray" })(); });
    await page.click('[data-ckg="connect"]');
    await page.waitForSelector('[data-ckg="pay"]:not([style*="display: none"])', { timeout: 15000 });
    return { ctx, page };
  }
  const status = (page) => page.$eval(".ckg-status", (el) => el.textContent);
  const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("clkn_tools_paysig") || "null"));
  const newPayVisible = (page) => page.$eval('[data-ckg="newpay"]', (el) => el.style.display !== "none");
  const paymentTx = (sig) => ({ transaction: { message: { instructions: [{ program: "system", parsed: { type: "transfer", info: { source: ADDR, destination: RECEIVER, lamports: 1 } } }] } }, meta: { innerInstructions: [] } });

  // A. sign-first: the signature is durable BEFORE the RPC sees sendTransaction; the pass lands; record cleared.
  {
    const rpc = { calls: [], sessions: [], sessionForSig: (s) => (s === SIG ? { success: true, pass: "t:test", days: 7 } : { success: false, error: "payment not found yet" }) };
    const { ctx, page } = await open("sign", rpc);
    await page.click('[data-ckg="pay"]');
    await page.waitForFunction(() => /unlocked/.test(document.querySelector(".ckg-status").textContent), null, { timeout: 30000 }).catch(() => {});
    const st = await status(page);
    const seen = rpc.sendSeenRecord ? JSON.parse(rpc.sendSeenRecord) : null;
    ok("A: the wallet signed once and the page sent it (sendTransaction reached the RPC exactly once)", rpc.calls.filter((m) => m === "sendTransaction").length === 1 && (await page.evaluate(() => window.__signs)) === 1, rpc.calls.join(","));
    ok("A: the signature was in localStorage BEFORE sendTransaction was sent", seen && seen.sig === SIG && seen.wallet === ADDR, JSON.stringify(seen));
    ok("A: the same signature was presented to the pass service and the pass was granted", rpc.sessions.some((b) => b.paySig === SIG) && /unlocked/.test(st), st);
    ok("A: the attempt record is cleared once the pass lands", (await record(page)) === null);
    await ctx.close();
  }

  // B. send-only wallet, broadcast then reject: one broadcast, an unresolved record, and the second tap
  //    asks the chain instead of sending again.
  {
    const rpc = { calls: [], sessions: [], history: [] };
    const { ctx, page } = await open("send", rpc);
    await page.click('[data-ckg="pay"]');
    await page.waitForFunction(() => /Payment failed/.test(document.querySelector(".ckg-status").textContent), null, { timeout: 30000 }).catch(() => {});
    const st1 = await status(page); const rec1 = await record(page);
    ok("B: the wallet broadcast once and rejected", (await page.evaluate(() => window.__sends)) === 1);
    ok("B: an UNRESOLVED attempt (sig:null, this wallet, a blockhash) was recorded before the call", rec1 && rec1.sig === null && rec1.wallet === ADDR && !!rec1.bh, JSON.stringify(rec1));
    ok("B: the page says the wallet may still have sent it and offers the explicit new-payment control", /may still have sent it/.test(st1) && (await newPayVisible(page)), st1);
    // second tap — the reviewer's reproduction: this used to send a second transfer
    await page.click('[data-ckg="pay"]');
    await page.waitForFunction(() => /Could not confirm yet|unlocked|Payment failed/.test(document.querySelector(".ckg-status").textContent), null, { timeout: 30000 }).catch(() => {});
    const st2 = await status(page); const rec2 = await record(page);
    ok("B: the second tap did NOT broadcast again", (await page.evaluate(() => window.__sends)) === 1, "sends=" + (await page.evaluate(() => window.__sends)));
    ok("B: it asked the chain for the wallet's recent history instead", rpc.calls.includes("getSignaturesForAddress"), rpc.calls.join(","));
    ok("B: an empty but YOUNG history stays unknown — record kept, nothing charged, user told to re-check", rec2 && rec2.sig === null && /Could not confirm yet/.test(st2), st2);
    await ctx.close();
  }

  // C. the chain shows our payment since the attempt → adopted, pass granted, still one broadcast.
  {
    const now = Math.floor(Date.now() / 1000);
    const rpc = { calls: [], sessions: [], history: [{ signature: "unrelatedSig111", blockTime: now, err: null }, { signature: SIG, blockTime: now, err: null }],
      tx: (sig) => (sig === SIG ? paymentTx(sig) : { transaction: { message: { instructions: [] } }, meta: {} }),
      sessionForSig: (s) => (s === SIG ? { success: true, pass: "t:test", days: 7 } : { success: false, error: "payment not found yet" }) };
    const seed = { sig: null, wallet: ADDR, at: Date.now() - 30000, bh: "11111111111111111111111111111111" };
    const { ctx, page } = await open("send", rpc, seed);
    await page.click('[data-ckg="pay"]');
    await page.waitForFunction(() => /unlocked|Payment failed|Could not confirm/.test(document.querySelector(".ckg-status").textContent), null, { timeout: 30000 }).catch(() => {});
    const st = await status(page);
    ok("C: the payment found in the wallet's history is adopted and the pass is issued for THAT signature", rpc.sessions.some((b) => b.paySig === SIG) && /unlocked/.test(st), st);
    ok("C: no new transfer was sent", (await page.evaluate(() => window.__sends)) === 0);
    ok("C: only OUR transfer was adopted — the unrelated signature was inspected and skipped", rpc.calls.filter((m) => m === "getTransaction").length >= 1 && !rpc.sessions.some((b) => b.paySig === "unrelatedSig111"));
    await ctx.close();
  }

  // D. proven dead (history covered, attempt older than any blockhash can live) → released, a new payment may go.
  {
    const rpc = { calls: [], sessions: [], history: [{ signature: "olderSig", blockTime: Math.floor(Date.now() / 1000) - 3600, err: null }], tx: () => null };
    const seed = { sig: null, wallet: ADDR, at: Date.now() - 200000, bh: "11111111111111111111111111111111" };
    const { ctx, page } = await open("send", rpc, seed);
    await page.click('[data-ckg="pay"]');
    await page.waitForFunction(() => /Payment failed|Could not confirm|unlocked/.test(document.querySelector(".ckg-status").textContent), null, { timeout: 30000 }).catch(() => {});
    ok("D: a dead attempt is released and the wallet is asked to pay again (exactly one new broadcast)", (await page.evaluate(() => window.__sends)) === 1 && rpc.calls.includes("getSignaturesForAddress"), rpc.calls.join(","));
  }

  // E. server: the advertised offer is a per-request read of the terms schedule, not a boot snapshot.
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const block = src.slice(src.indexOf("const TOOLGATE = {"), src.indexOf("const TOOLGATE = {") + 1600);
    ok("E: TOOLGATE.lamports and .days are getters over TOOLGATE_TERMS.current() (round 4: boot snapshot advertised a stale offer across a schedule boundary)",
      /get lamports\(\)\s*\{\s*return TOOLGATE_TERMS\.current\(\)\.lamports/.test(block) && /get days\(\)\s*\{\s*return TOOLGATE_TERMS\.current\(\)\.days/.test(block));
    const gate = fs.readFileSync(path.join(__dirname, "..", "public", "cluck-gate.js"), "utf8");
    ok("E: the client re-reads the offer right before it builds the transfer", /config\(true\)/.test(gate) && gate.indexOf("config(true)") < gate.lastIndexOf("createSolTransferInstruction"));
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall tools-pass client checks pass");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
