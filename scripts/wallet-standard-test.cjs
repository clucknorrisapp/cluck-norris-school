"use strict";
// cluck-wallet.js only ever found wallets by their LEGACY injection (window.solana, window.phantom…).
// Jupiter Mobile's in-app browser registers through the Wallet Standard instead, so a user standing
// inside that wallet was told to "open this page in your wallet's browser" (2026-09-05). This drives
// the shared layer with a FAKE standard wallet in a headless Chromium: discovery through both the
// event handshake and the deprecated navigator.wallets path, the Phantom-shaped shim the pages were
// written against (connect / signTransaction / signAndSendTransaction / signMessage / disconnect),
// dedupe against a wallet that also injects the legacy object, late registration re-rendering the
// picker, non-Solana wallets ignored, and the in-app-browser UA path. A real Jupiter Mobile still
// has to be tried by hand — no test can produce that app.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };

const PORT = 3881;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clkn-wstd-"));
function findChromium() {
  const c = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return undefined;
}
// Reference base58 (BigInt) to check the shim's encoder against.
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = "1" + s; else break; } return s; }

// The fake wallet, installed before any page script runs. `cfg` picks the flavour.
const FAKE = (cfg) => `(() => {
  const cfg = ${JSON.stringify(cfg)};
  const ADDR = "${"6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh"}";
  const account = { address: ADDR, publicKey: new Uint8Array(32).fill(7), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction"] };
  window.__calls = [];
  const wallet = {
    version: "1.0.0", name: cfg.name, icon: "data:image/svg+xml;base64,PHN2Zy8+", chains: cfg.chains || ["solana:mainnet", "solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async (o) => { window.__calls.push(["connect", o]); wallet.accounts = [account]; return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { window.__calls.push(["disconnect"]); wallet.accounts = []; } },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => { window.__calls.push(["signTransaction", inputs.map(i => ({ len: i.transaction.length, chain: i.chain, addr: i.account.address }))]); return inputs.map(i => ({ signedTransaction: i.transaction })); } },
      "solana:signMessage": { version: "1.0.0",
        signMessage: async (...inputs) => { window.__calls.push(["signMessage", inputs.map(i => Array.from(i.message))]); return inputs.map(i => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(9) })); } },
    },
  };
  if (cfg.sendFeature) wallet.features["solana:signAndSendTransaction"] = { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
    signAndSendTransaction: async (...inputs) => { window.__calls.push(["signAndSend", inputs.map(i => ({ len: i.transaction.length, chain: i.chain }))]); return inputs.map(() => ({ signature: Uint8Array.from(cfg.sigBytes) })); } };
  window.__fakeWallet = wallet;
  const announce = () => {
    if (cfg.via === "event") {
      // the standard's handshake: wallet dispatches register-wallet with a callback, and also
      // listens for app-ready in case the app came first
      const cb = ({ register }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", (ev) => cb(ev.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
    } else {
      // deprecated path some wallets still use
      (window.navigator.wallets = window.navigator.wallets || []).push(({ register }) => register(wallet));
    }
  };
  if (cfg.delayMs) setTimeout(announce, cfg.delayMs); else announce();
  if (cfg.alsoInjectPhantom) {
    window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => ADDR } }), publicKey: null } };
  }
})();`;

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (e2) { console.error("needs playwright(-core)"); process.exit(1); } }
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR }, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  console.log("\nWallet Standard in the shared wallet layer\n");

  async function open(cfg, ua) {
    const ctx = await browser.newContext(ua ? { userAgent: ua } : {});
    const page = await ctx.newPage();
    await page.addInitScript(FAKE(cfg));
    await page.goto(`${BASE}/cuna-staking`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window.CluckWallet && window.CluckUtil), null, { timeout: 15000 });
    return { ctx, page };
  }
  const avail = (page) => page.evaluate(() => window.CluckWallet.available().map((w) => ({ id: w.id, name: w.name, icon: w.icon, standard: !!w.standard })));

  // 1. A standard-only wallet named Jupiter, via the event handshake, before the page script.
  {
    const { ctx, page } = await open({ name: "Jupiter", via: "event", sendFeature: true, sigBytes: Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256) });
    const list = await avail(page);
    ok("standard-only Jupiter is discovered and takes the registry id + icon", list.length === 1 && list[0].id === "jupiter" && list[0].name === "Jupiter" && list[0].icon === "🪐" && list[0].standard, JSON.stringify(list));

    // the page's own CONNECT button — the exact path the user hit
    await page.click("#connect");
    await page.waitForFunction(() => /Connected/.test(document.getElementById("walletBox").textContent), null, { timeout: 10000 }).catch(() => {});
    const box = await page.$eval("#walletBox", (el) => el.textContent);
    ok("CONNECT on the lock-and-earn page connects through the standard wallet", /Connected/.test(box) && /Jupiter/.test(box) && /6A5u…cnrh/.test(box), box.trim().slice(0, 120));

    // the shim, as the pages use it
    const r = await page.evaluate(async () => {
      const W3 = window.solanaWeb3;
      const list = window.CluckWallet.available(); const p = list[0].provider;
      const out = { hasW3: !!W3 };
      out.pk = p.publicKey && p.publicKey.toString();
      out.pkIsPublicKey = !!(W3 && p.publicKey instanceof W3.PublicKey);
      if (W3) {
        const tx = new W3.Transaction({ feePayer: new W3.PublicKey(out.pk), recentBlockhash: "11111111111111111111111111111111" });
        // NOT SystemProgram.transfer(): web3's layout encoders need the Node Buffer global, which
        // browsers lack (CLAUDE.md). A memo instruction is raw bytes and needs no encoder.
        tx.add(new W3.TransactionInstruction({ keys: [{ pubkey: new W3.PublicKey(out.pk), isSigner: true, isWritable: false }],
          programId: new W3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: new Uint8Array([104, 105]) }));
        const before = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
        const signed = await p.signTransaction(tx);
        out.signedIsTx = signed instanceof W3.Transaction;
        out.roundTrip = JSON.stringify(Array.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false }))) === JSON.stringify(before);
        const sent = await p.signAndSendTransaction(tx);
        out.sentSig = sent && sent.signature;
        const all = await p.signAllTransactions([tx, tx]);
        out.allLen = all.length; out.allTx = all.every((t) => t instanceof W3.Transaction);
      }
      const sm = await p.signMessage(new TextEncoder().encode("hello"), "utf8");
      out.sigLen = sm && sm.signature && sm.signature.length; out.sigIsBytes = sm.signature instanceof Uint8Array;
      out.chain = window.__calls.find((c) => c[0] === "signTransaction")[1][0].chain;
      out.msgBytes = window.__calls.find((c) => c[0] === "signMessage")[1][0];
      await p.disconnect();
      out.pkAfter = p.publicKey;
      out.calls = window.__calls.map((c) => c[0]);
      return out;
    });
    ok("publicKey is a real web3 PublicKey with the wallet's address", r.pk === "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh" && (!r.hasW3 || r.pkIsPublicKey), JSON.stringify(r));
    ok("signTransaction: legacy web3 Transaction in, Transaction out, bytes round-trip", !r.hasW3 || (r.signedIsTx && r.roundTrip), JSON.stringify(r));
    ok("signTransaction asks the wallet for solana:mainnet", r.chain === "solana:mainnet", r.chain);
    ok("signAndSendTransaction returns the signature as base58 like Phantom does", !r.hasW3 || r.sentSig === b58(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)), String(r.sentSig));
    ok("signAllTransactions signs each and returns Transactions", !r.hasW3 || (r.allLen === 2 && r.allTx), JSON.stringify(r));
    ok("signMessage passes the bytes through and returns {signature: bytes}", r.sigLen === 64 && r.sigIsBytes && JSON.stringify(r.msgBytes) === JSON.stringify(Array.from(new TextEncoder().encode("hello"))), JSON.stringify(r));
    ok("disconnect clears the key and calls the wallet", r.pkAfter === null && r.calls.includes("disconnect"), JSON.stringify(r.calls));
    if (!r.hasW3) console.log("      (web3 not loaded in this browser — transaction checks skipped)");
    await ctx.close();
  }

  // 1b. asTransaction: every shape a wallet's signTransaction has handed back becomes OUR Transaction
  //     with partialSign — the multi-signer flows died on "signed.partialSign is not a function".
  {
    const { ctx, page } = await open({ name: "Jupiter", via: "event" });
    const r = await page.evaluate(() => {
      const W3 = window.solanaWeb3; if (!W3) return { skip: true };
      const pk = new W3.PublicKey("6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh");
      const mk = () => { const t = new W3.Transaction({ feePayer: pk, recentBlockhash: "11111111111111111111111111111111" });
        t.add(new W3.TransactionInstruction({ keys: [{ pubkey: pk, isSigner: true, isWritable: false }], programId: new W3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: new Uint8Array([104, 105]) })); return t; };
      const A = window.CluckWallet.asTransaction;
      const out = {};
      const good = (t) => t instanceof W3.Transaction && typeof t.partialSign === "function";
      const tx = mk(); const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      out.transaction = good(A(mk(), tx));
      out.bytes = good(A(bytes, tx));
      out.arrayBuffer = good(A(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), tx));
      out.numberArray = good(A(Array.from(bytes), tx));
      out.wrapped = good(A({ signedTransaction: bytes }, tx));
      out.inPlace = A(undefined, tx) === tx;
      // a Transaction from a DIFFERENT web3 copy: same wire format, foreign prototype
      const foreign = { serialize: (o) => bytes, signatures: [] };
      out.foreign = good(A(foreign, tx));
      // bare signatures list grafted onto the original
      const sig = new Uint8Array(64).fill(3);
      const t2 = mk(); const grafted = A({ signatures: [{ publicKey: pk.toBase58(), signature: sig }] }, t2);
      out.graft = grafted === t2 && grafted.signatures[0].signature && grafted.signatures[0].signature[0] === 3;
      try { A({ nonsense: true }, tx); out.garbage = "no throw"; } catch (e) { out.garbage = /can't complete/.test(e.message) ? "clear error" : e.message; }
      return out;
    });
    if (r.skip) console.log("      (web3 not loaded — asTransaction checks skipped)");
    else {
      ok("asTransaction: a real Transaction passes through", r.transaction);
      ok("asTransaction: serialized bytes → Transaction", r.bytes && r.arrayBuffer && r.numberArray, JSON.stringify(r));
      ok("asTransaction: {signedTransaction} wrapper → Transaction", r.wrapped);
      ok("asTransaction: nothing returned (signed in place) → the original", r.inPlace);
      ok("asTransaction: a foreign web3 Transaction → ours, via the wire format", r.foreign);
      ok("asTransaction: a bare signatures list is grafted onto the original", r.graft);
      ok("asTransaction: garbage throws a message a person can act on", r.garbage === "clear error", String(r.garbage));
    }
    await ctx.close();
  }

  // 2. Deprecated navigator.wallets path.
  {
    const { ctx, page } = await open({ name: "Jupiter", via: "navigator" });
    const list = await avail(page);
    ok("navigator.wallets.push registration is honoured", list.some((w) => w.id === "jupiter" && w.standard), JSON.stringify(list));
    await ctx.close();
  }

  // 3. A wallet that ALSO injects the legacy object shows once, under the legacy entry.
  {
    const { ctx, page } = await open({ name: "Phantom", via: "event", alsoInjectPhantom: true });
    const list = await avail(page);
    ok("Phantom (legacy + standard) is ONE button, the legacy one", list.filter((w) => w.name === "Phantom").length === 1 && list.find((w) => w.name === "Phantom").standard === false, JSON.stringify(list));
    await ctx.close();
  }

  // 4. Late registration re-renders through watch().
  {
    const { ctx, page } = await open({ name: "Jupiter", via: "event", delayMs: 1200 });
    const seq = await page.evaluate(() => new Promise((resolve) => {
      const seen = [];
      const stop = window.CluckWallet.watch(() => { seen.push(window.CluckWallet.available().map((w) => w.id).join(",")); }, 4000);
      setTimeout(() => { stop(); resolve(seen); }, 2500);
    }));
    ok("a standard wallet that registers after load re-renders the picker", seq.some((s) => /jupiter/.test(s)), JSON.stringify(seq));
    await ctx.close();
  }

  // 5. Non-Solana standard wallets are ignored; an unknown Solana one gets a generic id.
  {
    const { ctx, page } = await open({ name: "MetaMask", via: "event", chains: ["eip155:1"] });
    const list = await avail(page);
    ok("a non-Solana standard wallet is not offered", !list.some((w) => /metamask/i.test(w.name)), JSON.stringify(list));
    await ctx.close();
    const o2 = await open({ name: "Some New Wallet", via: "event" });
    const l2 = await avail(o2.page);
    ok("an unknown Solana standard wallet is offered under a generic id with its name", l2.some((w) => w.id === "std:somenewwallet" && w.name === "Some New Wallet" && w.standard), JSON.stringify(l2));
    await o2.ctx.close();
  }

  // 6. Inside the wallet's own browser (UA names it) with a standard-only wallet: exactly one button.
  {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 JupiterMobile/2.0";
    const { ctx, page } = await open({ name: "Jupiter", via: "event" }, ua);
    const list = await avail(page);
    ok("in-app browser UA + standard-only wallet → one Jupiter entry backed by the shim", list.length === 1 && list[0].id === "jupiter", JSON.stringify(list));
    await ctx.close();
  }

  // 7. Nothing registered, nothing injected: unchanged behaviour (empty list, mobile links on a phone).
  {
    const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/cuna-staking`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.CluckWallet, null, { timeout: 15000 });
    const list = await avail(page);
    await page.click("#connect");
    const box = await page.$eval("#walletBox", (el) => el.textContent);
    ok("no wallet at all: still the open-in-a-wallet links, Jupiter named in the copy", list.length === 0 && /Open .*inside a wallet/.test(box) && /Jupiter/.test(box), box.trim().slice(0, 160));
    ok("no diagnostics unless asked for", !/windowNames/.test(box));
    // ?walletdebug=1 shows what the browser exposes — names only
    await page.goto(`${BASE}/cuna-staking?walletdebug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.CluckWallet, null, { timeout: 15000 });
    // a wallet-ish namespace that is NOT a provider (what an unknown in-app browser might inject)
    await page.evaluate(() => { window.jupiterProbe = { secretThing: "DO-NOT-SHOW" }; });
    await page.click("#connect");
    const dbg = await page.$eval("#walletBox", (el) => el.textContent);
    ok("?walletdebug=1 lists the user-agent and wallet-ish window names, never values",
       /"ua"/.test(dbg) && /iPhone/.test(dbg) && /jupiterProbe/.test(dbg) && /"legacySolana": false/.test(dbg) && !/DO-NOT-SHOW/.test(dbg), dbg.slice(0, 240));
    await ctx.close();
  }

  await browser.close();
  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
