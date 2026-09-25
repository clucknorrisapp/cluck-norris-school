"use strict";
// Firepit's "reclaim surplus rent — keep the account open" job, RENDERED (public/firepit.html).
// A source scan cannot see this class of bug (CLAUDE.md: "rendered measurement and source
// scanning have complementary blind spots") — this actually loads the shipped page in headless
// Chromium with a fake wallet and a stubbed /api/burn-scan + /api/helius-rpc, and decodes the
// REAL transaction bytes the page hands to sendTransaction with @solana/web3.js, exactly the way
// scripts/verify-burn-close.cjs diffs the instruction builder in isolation but this time end to
// end through the page's own selection/confirm/sign flow.
//
// Covers: the surplus section renders with the right totals (gross/fee/net) from a fixture with a
// real mainnet surplus figure; wrapped SOL and an unreadable-minimum account are excluded from the
// table even though they're present in the scan; the built transaction contains ONLY opcode-38
// WithdrawExcessLamports instructions (never a burn/close mixed in), one per selected account, each
// keyed [account writable, destination(=wallet) writable, authority(=wallet) signer]; the
// transaction is actually signed by the connected wallet's key (a real ed25519 signature, verified
// against the message); and after a confirmed send the account drops out of the surplus table.
//
// Run: node scripts/firepit-surplus-test.cjs     (boots its own server, no live RPC/network)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const web3 = require("@solana/web3.js");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d !== undefined ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };

const PORT = 4497;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-firepit-surplus-"));
function findChromium() {
  for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) if (fs.existsSync(p)) return p;
  return undefined;
}

const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// A real fee-payer keypair — the fake wallet actually signs with it (Keypair.fromSecretKey in the
// page), so the built transaction has a REAL, verifiable ed25519 signature, not a stub.
const kp = web3.Keypair.generate();
const WALLET = kp.publicKey.toBase58();
const SECRET = JSON.stringify(Array.from(kp.secretKey));
// A structurally valid (32-byte, base58) blockhash — never a real one, since sendTransaction
// itself is stubbed below and the transaction is never actually broadcast.
const FAKE_BLOCKHASH = web3.Keypair.generate().publicKey.toBase58();

// Real mainnet figures (AGENTS.md / the surplus PR's own verification), not invented ones. Every
// address below is a REAL ed25519 public key (Keypair.generate()), never a hand-typed string —
// a hand-typed placeholder can (and did, during development) contain a non-base58 character
// (0/O/I/l) and blow up `new PublicKey(...)` deep in the page's own transaction builder.
const MIN_165 = 1488440;
const realAcctPk = web3.Keypair.generate().publicKey.toBase58();
const realMintPk = web3.Keypair.generate().publicKey.toBase58();
const wsolAcctPk = web3.Keypair.generate().publicKey.toBase58();
const unknownAcctPk = web3.Keypair.generate().publicKey.toBase58();
const unknownMintPk = web3.Keypair.generate().publicKey.toBase58();
const REAL_ACCT = { // 165-byte classic account with a genuine surplus
  tokenAccount: realAcctPk,
  mint: realMintPk,
  program: TOKEN_CLASSIC, amountRaw: "0", decimals: 6, uiAmount: 0,
  rentLamports: 1855569, frozen: false, delegated: false, space: 165, isNative: false, owner: WALLET,
  symbol: "USD1", name: "USD1", logo: null, priceUsd: 1, valueUsd: 0, priceKnown: true,
  rentExemptLamports: MIN_165, surplusLamports: 1855569 - MIN_165, surplusEligible: true,
  empty: true, isNft: false,
};
const WSOL_ACCT = { // wrapped SOL — must be excluded from the surplus table no matter its balance
  tokenAccount: wsolAcctPk,
  mint: WSOL_MINT, program: TOKEN_CLASSIC, amountRaw: "5000000000", decimals: 9, uiAmount: 5,
  rentLamports: 2039280 + 5000000000, frozen: false, delegated: false, space: 165, isNative: true, owner: WALLET,
  symbol: "SOL", name: "Wrapped SOL", logo: null, priceUsd: 150, valueUsd: 750, priceKnown: true,
  rentExemptLamports: null, surplusLamports: null, surplusEligible: false,
  empty: false, isNft: false,
};
const UNKNOWN_MIN_ACCT = { // minimum couldn't be read for this account — must never look eligible
  tokenAccount: unknownAcctPk,
  mint: unknownMintPk,
  program: TOKEN_2022, amountRaw: "0", decimals: 9, uiAmount: 0,
  rentLamports: 2039280, frozen: false, delegated: false, space: 165, isNative: false, owner: WALLET,
  symbol: "XYZ", name: "XYZ token", logo: null, priceUsd: 0, valueUsd: 0, priceKnown: false,
  rentExemptLamports: null, surplusLamports: null, surplusEligible: false,
  empty: true, isNft: false,
};
function scanFixture(overrides) {
  return Object.assign({
    success: true, wallet: WALLET, count: 3, capped: false,
    rentSolTotal: 0, valueUsdTotal: 0,
    surplusAvailable: true, surplusLamportsTotal: REAL_ACCT.surplusLamports, surplusSolTotal: REAL_ACCT.surplusLamports / 1e9,
    accounts: [REAL_ACCT, WSOL_ACCT, UNKNOWN_MIN_ACCT],
  }, overrides || {});
}

const FAKE_WALLET = `(() => {
  const SECRET = ${SECRET};
  const ADDR = ${JSON.stringify(WALLET)};
  window.__sentTxs = [];
  const provider = {
    isPhantom: true,
    publicKey: { toString: () => ADDR },
    connect: async () => ({ publicKey: { toString: () => ADDR } }),
    disconnect: async () => {},
    signTransaction: async (tx) => {
      const kp = solanaWeb3.Keypair.fromSecretKey(new Uint8Array(SECRET));
      tx.partialSign(kp);   // a REAL ed25519 signature over the exact message the page built
      window.__sentTxs.push(Array.from(tx.serialize()));
      return tx;
    },
  };
  window.phantom = { solana: provider };
})();`;

let stop = () => {};
(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (e2) { console.error("needs playwright(-core)"); process.exit(1); } }

  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HELIUS_API_KEY: "", FALLBACK_RPC_URL: "http://127.0.0.1:9" }, stdio: "ignore" });
  stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", stop);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { console.error("  server did not come up"); stop(); process.exit(1); }

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  console.log("\nFirepit — surplus rent (rendered, stubbed RPC)\n");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (process.env.FIREPIT_TEST_DEBUG) console.log("[page]", msg.type(), msg.text()); });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.addInitScript(FAKE_WALLET);

  let scanCalls = 0;
  let capturedSendTxB64 = null;
  let sentTransaction = false;
  await page.route("**/api/burn-scan**", async (route) => {
    scanCalls++;
    // After a "confirmed" send, the account the test reclaims from must read back with its
    // surplus gone — this is what proves the page re-reads reality rather than trusting the ask.
    if (sentTransaction) {
      const closed = Object.assign({}, REAL_ACCT, { rentLamports: MIN_165, surplusLamports: 0, surplusEligible: false });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scanFixture({ accounts: [closed, WSOL_ACCT, UNKNOWN_MIN_ACCT] })) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scanFixture()) });
  });
  // The FIRST getSignatureStatuses poll is deliberately DELAYED — this holds the run in the
  // "Confirming on-chain…" state for a controlled window so the test below (finding 1) can try to
  // dismiss the sheet and start a second job while the first is still in flight.
  let sigStatusDelayed = false;
  await page.route("**/api/helius-rpc**", async (route) => {
    const body = route.request().postDataJSON();
    const calls = Array.isArray(body) ? body : [body];
    if (calls.some((c) => c.method === "getSignatureStatuses") && !sigStatusDelayed) {
      sigStatusDelayed = true;
      await new Promise((r) => setTimeout(r, 1200));
    }
    const results = calls.map((c) => {
      if (c.method === "getLatestBlockhash") return { jsonrpc: "2.0", id: c.id, result: { context: { slot: 1 }, value: { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 999999999 } } };
      if (c.method === "sendTransaction") {
        capturedSendTxB64 = c.params[0];
        sentTransaction = true;
        return { jsonrpc: "2.0", id: c.id, result: "FAKESIG11111111111111111111111111111111111111111111111111" };
      }
      if (c.method === "getSignatureStatuses") return { jsonrpc: "2.0", id: c.id, result: { context: { slot: 1 }, value: [{ confirmationStatus: "confirmed", err: null }] } };
      return { jsonrpc: "2.0", id: c.id, result: null };
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? results : results[0]) });
  });

  await page.goto(`${BASE}/firepit`, { waitUntil: "domcontentloaded" });
  // The page's own CONNECT button.
  await page.waitForFunction(() => !!(window.CluckWallet && window.CluckWallet.available && window.CluckWallet.available().length), null, { timeout: 15000 });
  const list = await page.evaluate(() => window.CluckWallet.available().map((w) => w.name));
  ok("the fake wallet is discovered by the page's own picker", list.length >= 1, list);
  await page.evaluate(() => { document.querySelectorAll("#picker button")[0].click(); });
  await page.waitForFunction(() => !document.getElementById("results-card").classList.contains("hidden"), null, { timeout: 15000 });
  ok("burn-scan was called on connect", scanCalls >= 1, scanCalls);

  // ── the view + totals ──────────────────────────────────────────────────────────────────────
  const rowsText = await page.$eval("#rows-surplus", (el) => el.textContent);
  ok("the surplus section lists the real surplus-eligible account", /USD1/.test(rowsText), rowsText.slice(0, 200));
  ok("wrapped SOL is NOT in the surplus table despite its huge balance", !/Wrapped SOL/.test(rowsText) && !new RegExp((WSOL_ACCT.symbol)).test(rowsText.replace("USD1", "")), rowsText.slice(0, 200));
  ok("the unreadable-minimum account is NOT in the surplus table", !/XYZ/.test(rowsText), rowsText.slice(0, 200));

  await page.click("#sel-surplus-all");
  const gross = await page.$eval("#surplus-gross", (el) => el.textContent);
  const expectedSol = (REAL_ACCT.surplusLamports / 1e9);
  ok("the gross total matches the fixture's real surplus figure (367,129 lamports)", gross.replace(/[^0-9.]/g, "").startsWith(expectedSol.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")) || parseFloat(gross) === parseFloat(expectedSol.toFixed(6)), { gross, expectedSol });
  ok("Reclaim surplus button is enabled once something is selected", await page.$eval("#surplus-btn", (el) => !el.disabled));

  // ── sign + send ────────────────────────────────────────────────────────────────────────────
  await page.click("#surplus-btn");
  await page.waitForSelector("#modal.show", { timeout: 5000 });
  const modalTitle = await page.$eval("#m-title", (el) => el.textContent);
  ok("the confirm sheet uses the surplus job's own honest copy (never burn language)", /surplus/i.test(modalTitle) && !/burn/i.test(modalTitle), modalTitle);
  ok("no typed confirmation is required — nothing here destroys value", await page.$eval("#m-go", (el) => !el.disabled));

  await page.click("#m-go");
  await page.waitForFunction(() => window.__sentTxs && window.__sentTxs.length > 0, null, { timeout: 15000 });
  // The wallet-side signature (window.__sentTxs) and the actual network submission (captured in
  // the /api/helius-rpc route handler, below) are two different async hops — wait for BOTH before
  // asserting anything about what was submitted, or this races and reads capturedSendTxB64 before
  // the route handler has run.
  for (let i = 0; i < 100 && !capturedSendTxB64; i++) await new Promise((r) => setTimeout(r, 100));
  ok("the wallet was asked to sign, and the page actually submitted a transaction", !!capturedSendTxB64);

  // ── finding 1: the sheet cannot be dismissed, and a second job cannot start, mid-run ──────────
  // The getSignatureStatuses stub above delays its first answer, so the run is still sitting in
  // "Confirming on-chain…" right now — the exact window a backdrop click or a second button tap
  // used to be able to exploit.
  await page.waitForFunction(() => /Confirming on-chain/i.test((document.getElementById("m-status") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  await page.click("#modal", { position: { x: 5, y: 5 } });   // the darkened backdrop, not the box
  const stillOpenMidRun = await page.$eval("#modal", (el) => el.classList.contains("show"));
  ok("finding 1: the confirm sheet CANNOT be closed by clicking the backdrop while a job is signing/sending", stillOpenMidRun);
  const midRunTitle = await page.$eval("#m-title", (el) => el.textContent);
  await page.evaluate(() => { const b = document.getElementById("surplus-btn"); b && b.click(); });
  const titleAfterTap = await page.$eval("#m-title", (el) => el.textContent);
  ok("finding 1: tapping an action button mid-run does not reopen or replace the sheet (confirmKind stays put)", titleAfterTap === midRunTitle, { midRunTitle, titleAfterTap });
  const sentCountMidRun = await page.evaluate(() => window.__sentTxs.length);
  ok("finding 1: no SECOND signature was requested from that tap", sentCountMidRun === 1, sentCountMidRun);

  // Decode the REAL bytes the page handed to sendTransaction.
  const raw = Buffer.from(capturedSendTxB64, "base64");
  const tx = web3.Transaction.from(raw);
  ok("exactly one instruction — one selected account", tx.instructions.length === 1, tx.instructions.length);
  const ix = tx.instructions[0];
  ok("the instruction targets the classic Token program (this account's own `program`)", ix.programId.toBase58() === TOKEN_CLASSIC, ix.programId.toBase58());
  ok("data is EXACTLY the single opcode byte 38 — no payload", ix.data.length === 1 && ix.data[0] === 38, Array.from(ix.data));
  // Destination and authority are BOTH the connected wallet, which is also the fee payer — once
  // compiled into a real Solana message, Transaction dedupes repeated pubkeys onto ONE account
  // meta carrying the UNION of privileges every reference to it asked for (and the fee payer is
  // always signer+writable regardless). So both entries legitimately read back signer:true,
  // writable:true here — that is the network's own compiled-message behaviour, not a bug in the
  // instruction; what matters is that destination is AT LEAST writable and authority is AT LEAST
  // a signer, both are the WALLET (never a third, user-editable address), and the token account
  // itself is the one non-wallet key.
  ok("keys: [account (writable, not the wallet), destination(=wallet, writable), authority(=wallet, signer)] — never a user-editable destination",
    ix.keys.length === 3 &&
    ix.keys[0].pubkey.toBase58() === REAL_ACCT.tokenAccount && ix.keys[0].pubkey.toBase58() !== WALLET && ix.keys[0].isWritable === true && ix.keys[0].isSigner === false &&
    ix.keys[1].pubkey.toBase58() === WALLET && ix.keys[1].isWritable === true &&
    ix.keys[2].pubkey.toBase58() === WALLET && ix.keys[2].isSigner === true,
    ix.keys.map((k) => ({ p: k.pubkey.toBase58(), w: k.isWritable, s: k.isSigner })));
  ok("the transaction is REALLY signed by the connected wallet (verified ed25519 signature, not a stub)",
    tx.verifySignatures());
  ok("the fee payer is the connected wallet", tx.feePayer && tx.feePayer.toBase58() === WALLET);

  // The fixture's post-send burn-scan response reports this account at exactly today's minimum
  // (1,488,440 lamports) — the page must derive "actually arrived" as prior minus fresh
  // (1,855,569 − 1,488,440 = 367,129) and say so, not merely echo the requested figure back as if
  // it were confirmed fact (adversarial review on PR #443, finding 9).
  // "arrived in your wallet" is unique to the FINAL rescanUntilCleanSurplus message — the interim
  // "confirming what actually arrived…" status also contains "actually arrived" as a substring, so
  // matching on that alone would pass against the wrong (intermediate) message.
  await page.waitForFunction(() => /arrived in your wallet/i.test(document.getElementById("status").textContent), null, { timeout: 20000 }).catch(() => {});
  const finalStatus = await page.$eval("#status", (el) => el.textContent);
  ok("the finished-run status reports SUCCESS, not an error class", await page.$eval("#status", (el) => el.className.includes("ok") && !el.className.includes("err")), finalStatus);
  ok("the finished-run status names the ACTUAL amount that arrived (0.000367 SOL, re-derived from a fresh scan), not just a bare success flag",
    /arrived in your wallet/i.test(finalStatus) && /0\.000367/.test(finalStatus), finalStatus);

  await ctx.close();
  await browser.close();
  stop();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(1); });
