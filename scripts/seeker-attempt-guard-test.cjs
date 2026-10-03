#!/usr/bin/env node
"use strict";
// Seeker app — THE ATTEMPT GUARD on the two irreversible panes, Swap and Project Burn.
//
// Codex on #479 (b0d381a4), P1: "signature-less wallet errors still permit a second swap or
// burn." A send-capable wallet (signAndSendTransaction, MWA) can broadcast and then throw before
// it hands back the signature. sign.js already reported that honestly (`unconfirmed`,
// `noSignature: true`) — but Swap cleared `swapping` with no pending record, so the form unlocked
// and Review was live again; Project Burn offered "OK" on a signature-less unconfirmed card, which
// restored the burn form. The first transaction lands, the wallet reply is lost, the person taps
// again, and the amount is swapped — or permanently burned — twice.
//
// What this pins, for BOTH panes:
//   · the attempt is on record BEFORE the wallet is asked (sign.js `beforeSign`): a record with
//     `sig: null`, the transaction's own blockhash and its lifetime, keyed by wallet;
//   · a save that fails means the wallet is NEVER asked;
//   · after a signature-less `unconfirmed`, the form stays off — no OK, no Review, no Burn — and a
//     remount restores the same locked state;
//   · the only release is the chain: a blockhash proven dead (sign.js checkUnsignedPending) frees
//     the record, the balance is re-read, and the on-screen words NEVER say "did not land";
//   · a definitive outcome (landed / refused / declined) retires the record;
//   · the 10-minute "Stop watching" hatch exists and is not presented as "nothing happened".
//
// (a) and (b) run under plain Node. (c)/(d) bundle the REAL panes with esbuild (only sign.js's
// signSendConfirm — the wallet call — and, for Swap, the already-tested verifier/simulator are
// replaced) and drive them in headless Chromium against a scripted rpc. node-check has no
// Chromium, so the rendered sections skip there; the smoke-test job sets
// ATTEMPT_RENDER_REQUIRED=1, where a missing browser is a failure.
//
// Usage: node scripts/seeker-attempt-guard-test.cjs

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const SEEKER = path.join(ROOT, "src", "seeker");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail))?.slice(0, 600) : "")); }
};
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const pk = () => Array.from(crypto.randomBytes(44)).map((b) => B58[b % 58]).join("");
const NOSIG_RE = /No signature came back from your wallet/;
// Codex round 2 on #479, P2: two released sentences — "was just re-read" ONLY after a successful
// balance read, "could not be re-read" when that read failed. Never the first on a failed read.
const RELEASED_RE = /That attempt can no longer land/;
const RELEASED_READ_RE = /Your balance was just re-read from the chain/;
const RELEASED_FAIL_RE = /Your balance could not be re-read just now/;
const SAVE_FAIL_RE = /Could not save the recovery record/;

(async () => {
  console.log("\nSeeker — attempt guard on Swap + Project Burn (Codex on #479, P1)\n");

  // ── (a) burn-pending.js under Node, with a fake storage ────────────────────────────────────
  console.log("(a) burn-pending.js — the persisted attempt record\n");
  {
    const BP = await import(path.join(SEEKER, "tools", "burn-pending.js") + "?t=" + Date.now());
    const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
    const W = pk(), MINT = pk(), BH = pk();
    const st = mem();
    ok("no record → null", BP.loadBurnPending(W, st) === null);
    ok("a sig:null record (written before the prompt) saves and reads back with sig null, blockhash and lifetime",
       BP.saveBurnPending({ sig: null, mint: MINT, symbol: "TKN", decimals: 6, rawAmt: "10000000", amount: 10, isFullBalance: false, recentBlockhash: BH, lastValidBlockHeight: 900, wallet: W, at: 123 }, st) === true
       && (() => { const r = BP.loadBurnPending(W, st); return r && r.sig === null && r.mint === MINT && r.rawAmt === "10000000" && r.recentBlockhash === BH && r.lastValidBlockHeight === 900 && r.at === 123; })(),
       BP.loadBurnPending(W, st));
    ok("filling the signature in keeps everything else", BP.saveBurnPending({ ...BP.loadBurnPending(W, st), sig: "SIG1" }, st) && BP.loadBurnPending(W, st).sig === "SIG1" && BP.loadBurnPending(W, st).at === 123);
    ok("another wallet's record is never applied", BP.loadBurnPending(pk(), st) === null);
    ok("a record whose stored wallet disagrees with its key is refused", (() => { const m = JSON.parse(st.getItem(BP.BURN_PENDING_KEY)); m[W].wallet = pk(); st.setItem(BP.BURN_PENDING_KEY, JSON.stringify(m)); return BP.loadBurnPending(W, st) === null; })());
    st._m.clear();
    ok("a record with no mint is refused on save", BP.saveBurnPending({ sig: null, wallet: W }, st) === false);
    const silent = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    ok("a storage that silently drops the write → save returns false (read back, never assumed)", BP.saveBurnPending({ sig: null, mint: MINT, wallet: W }, silent) === false);
    const throwing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
    ok("a storage that throws → save returns false, never throws", BP.saveBurnPending({ sig: null, mint: MINT, wallet: W }, throwing) === false);
    BP.saveBurnPending({ sig: null, mint: MINT, wallet: W, recentBlockhash: BH, lastValidBlockHeight: 1 }, st);
    BP.clearBurnPending(W, st);
    ok("clear removes the record (and the key once empty)", BP.loadBurnPending(W, st) === null && st.getItem(BP.BURN_PENDING_KEY) === null);
    ok("BURN_PENDING_ESCAPE_MS is the same 10 minutes as Swap's and Revoke's", BP.BURN_PENDING_ESCAPE_MS === 10 * 60 * 1000);
  }

  // ── (b) static pins on the panes ──────────────────────────────────────────────────────────
  console.log("\n(b) static — both panes hand sign.js a beforeSign save, and neither unlocks on a missing signature\n");
  {
    const swap = fs.readFileSync(path.join(SEEKER, "tools", "Swap.jsx"), "utf8");
    const burn = fs.readFileSync(path.join(SEEKER, "tools", "ProjectBurn.jsx"), "utf8");
    ok("Swap passes beforeSign to signSendConfirm and writes a sig:null record in it", /beforeSign:\s*\(\)\s*=>\s*\{[\s\S]*?sig:\s*null[\s\S]*?savePending\(p\)/.test(swap));
    ok("Swap's loadPending accepts a record with no signature", !/if \(!p \|\| !p\.sig \|\| !p\.wallet\) return null/.test(swap));
    ok("Swap's poll uses checkUnsignedPending for a sig-less record", /checkUnsignedPending\(rpcFn\(\)/.test(swap));
    ok("Swap no longer sets a bare 'unconfirmed' outcome with no record on noSignature", !/res\.noSignature\)\s*\{[\s\S]*?setOutcome\(\{ \.\.\.base, status: "unconfirmed" \}\)/.test(swap));
    ok("Project Burn passes beforeSign and onSigned through burn-pending.js", /beforeSign:\s*\(info\)\s*=>[\s\S]*?saveBurnPending\(record\(null/.test(burn) && /onSigned:\s*\(sig\)\s*=>\s*\{\s*saveBurnPending\(record\(sig/.test(burn));
    ok("Project Burn's OK button is never offered on an unconfirmed card (sig or not)", /\{o\.status !== "unconfirmed" \? \(/.test(burn) && !/o\.status !== "unconfirmed" \|\| !o\.sig/.test(burn));
    ok("Project Burn's Check status button is unconditional on an unconfirmed card", !/\{o\.sig \? <button[^>]*onClick=\{onCheckStatus\}/.test(burn));
    ok("Project Burn resolves through sign.js's checkPendingSwap / checkUnsignedPending, not a private status read", /checkPendingSwap\(rpcFn\(\)/.test(burn) && /checkUnsignedPending\(rpcFn\(\)/.test(burn) && !/confirmSignature\(/.test(burn));
    ok("both panes share the sentences from attempt-copy.js (one key text, no drift)", /from "\.\.\/attempt-copy\.js"/.test(swap) && /from "\.\.\/attempt-copy\.js"/.test(burn));
    const copy = fs.readFileSync(path.join(SEEKER, "attempt-copy.js"), "utf8");
    const literals = (copy.match(/t\("([^"]+)"\)/g) || []).join("\n");
    ok("attempt-copy.js carries exactly the three sentences, and none claims the transaction did not land", (copy.match(/t\("/g) || []).length === 3 && !/did not land|nothing was|failed/i.test(literals), literals);
    // Codex round 2 on #479: P1 — the Burn restore effect lets the connected wallet's record win
    // over any card left on screen, and every outcome names its wallet; P2 — Swap's released card
    // follows the balance read's own phase and marks the read in flight before releasing.
    ok("Burn: on a wallet change the connected wallet's record ALWAYS wins over a card already on screen", /if \(rec\) return o && o\.status === "unconfirmed" && o\.wallet === walletAddr \? o : outcomeFromRecord\(rec\);/.test(burn));
    ok("Burn: every settled outcome names its wallet, and another wallet's card is dropped on a switch", /wallet: wallet\.address,/.test(burn) && /if \(o && o\.wallet && o\.wallet !== walletAddr\) return null;/.test(burn));
    ok("Swap: the released card claims a re-read only when balPhase is loaded, says 'could not' when unavailable, and shows Reading balance… meanwhile",
       /balPhase === "loaded" \? <p>\{releasedSentence\(true\)\}<\/p>/.test(swap) && /balPhase === "unavailable" \? <p>\{releasedSentence\(false\)\}<\/p>/.test(swap) && /<Loading label=\{t\("Reading balance…"\)\} \/>/.test(swap));
    ok("Swap: the balance read is marked in flight synchronously before the record is released", /setBalIn\(\{ phase: "loading", raw: null \}\);\s*\n\s*setBalTick\(\(n\) => n \+ 1\);\s*\n\s*await resolvePending\(\{ status: "released" \}\);/.test(swap));
    // The new keys reach every shipped dictionary (nine languages) and the store-edition prune.
    const keys = ["No signature came back from your wallet. If it already sent this, it may still land — check before trying again.",
                  "That attempt can no longer land, and with no signature there is nothing to look up — whether it landed earlier can't be said from here. Your balance was just re-read from the chain; that is the record.",
                  "That attempt can no longer land, and with no signature there is nothing to look up — whether it landed earlier can't be said from here. Your balance could not be re-read just now; check it before trying again."];
    const missing = [];
    for (const l of ["es", "hi", "it", "pt", "vi", "zh", "ko", "tr", "id"]) {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", l + ".json"), "utf8"));
      for (const k of keys) if (!d[k] || d[k] === k) missing.push(l + ":" + k.slice(0, 20));
    }
    ok("all three sentences are translated in all nine dictionaries", missing.length === 0, missing);
    const excl = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8")).excludeKeys || [];
    ok("…and pruned from the education-only store bundles", keys.every((k) => excl.includes(k)));
  }

  // ── (c)/(d) rendered ───────────────────────────────────────────────────────────────────────
  let esbuild, chromium;
  try { esbuild = require("esbuild"); } catch (_) { esbuild = null; }
  try { ({ chromium } = require("playwright")); } catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { chromium = null; } }
  if (!esbuild || !chromium) {
    if (process.env.ATTEMPT_RENDER_REQUIRED === "1") ok("esbuild + playwright are available for the rendered checks", false, "missing " + (!esbuild ? "esbuild " : "") + (!chromium ? "playwright" : ""));
    else console.log("\n  · " + (!esbuild ? "esbuild " : "") + (!chromium ? "playwright " : "") + "not resolvable — skipping the rendered checks (everything above still ran)");
  } else {
    const exe = ["/opt/pw-browsers/chromium", process.env.PLAYWRIGHT_CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
    const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    const RECOVERY = "Could not save the recovery record — nothing was sent. Free some storage and try again.";

    // Only the wallet call is scripted: everything else in sign.js (checkPendingSwap,
    // checkUnsignedPending, assertSameAccount, rpcFn) is the real module.
    function signShim(importerRe, extra) {
      return {
        name: "sign-shim",
        setup(b) {
          b.onResolve({ filter: /^\.\.\/sign\.js$/ }, (args) => (importerRe.test(args.importer) ? { path: "sign-shim", namespace: "shim" } : null));
          b.onLoad({ filter: /^sign-shim$/, namespace: "shim" }, () => ({
            contents: `export * from ${JSON.stringify(path.join(SEEKER, "sign.js"))};\nexport const signSendConfirm = (a) => window.__state.signSendConfirm(a);\n${extra || ""}`,
            resolveDir: SEEKER,
          }));
        },
      };
    }
    async function bundle(entry, plugins) {
      const built = await esbuild.build({
        stdin: { contents: entry, resolveDir: SEEKER, loader: "jsx", sourcefile: "harness.jsx" },
        bundle: true, write: false, format: "iife", plugins, logLevel: "silent",
        loader: { ".css": "empty" },
        define: { "process.env.NODE_ENV": '"production"' },
      });
      return built.outputFiles[0].text;
    }
    async function openPage(bundleText, init, initArgs) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("https://seeker.test/**", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }));
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto("https://seeker.test/");
      await page.evaluate(init, initArgs);
      await page.addScriptTag({ content: bundleText });
      page.__context = context;
      return { page, errors };
    }
    const body = (page) => page.evaluate(() => document.body.innerText);
    const remount = (page) => page.evaluate(() => { window.__unmount(); window.__mount(); });
    const set = (page, patch) => page.evaluate((p) => Object.assign(window.__state, p), patch);

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(c) rendered — Project Burn\n");
    {
      const burnBundle = await bundle(`
        import React from "react";
        import { createRoot } from "react-dom/client";
        import ProjectBurnPane from "./tools/ProjectBurn.jsx";
        // The connected wallet can change under the pane (round 2, P1): window.__setWallet(addr).
        function Host() {
          const [addr, setAddr] = React.useState(window.__ADDR);
          window.__setWallet = setAddr;
          const wallet = { connected: true, address: addr, provider: { publicKey: { toString: () => addr } } };
          return <ProjectBurnPane wallet={wallet} />;
        }
        let root = null;
        window.__mount = () => { root = createRoot(document.getElementById("root")); root.render(<Host />); };
        window.__unmount = () => { if (root) root.unmount(); root = null; };
        window.__mount();
      `, [signShim(/ProjectBurn\.jsx$/, `export const splTokenShim = () => ({ getAssociatedTokenAddressSync: () => ({}), createBurnCheckedInstruction: () => ({}) });`)]);
      const KEY = "clkn_seeker_burn_pending";
      const ADDR = pk(), MINT = pk(), BH = pk(), SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
      const init = ({ ADDR, MINT, BH, SIG, state }) => {
        window.__ADDR = ADDR;
        const s = window.__state = Object.assign({ fetchCount: 0, receiptCount: 0, height: 1000, lvbh: 900, blockhashValid: true, sigStatus: null, balance: 100 }, state);
        s.signSendConfirm = async (a) => {
          s.beforeSignSeen = typeof a.beforeSign === "function"; s.walletAsked = false; s.storedAtAsk = null;
          const web3 = { Transaction: function () { this.add = () => {}; }, PublicKey: function (x) { this.x = x; } };
          a.build(web3, BH, ADDR, { lastValidBlockHeight: s.lvbh });   // the real build runs: blockhash captured for the record
          let saved = true;
          if (s.beforeSignSeen) { try { saved = a.beforeSign({ blockhash: BH, lastValidBlockHeight: s.lvbh }) !== false; } catch (_) { saved = false; } }
          if (!saved) return { status: "failed", error: "Could not save the recovery record — nothing was sent. Free some storage and try again." };
          s.walletAsked = true; s.storedAtAsk = window.localStorage.getItem("clkn_seeker_burn_pending");
          if (s.mode === "noSignature") return { status: "unconfirmed", noSignature: true, error: "bridge closed after broadcast" };
          if (s.mode === "declined") return { status: "declined" };
          if (s.mode === "refused") return { status: "failed", error: "node refused it" };
          if (typeof a.onSigned === "function") { try { a.onSigned(SIG); } catch (_) {} }
          if (s.mode === "sent") return { status: "sent", sig: SIG };
          return { status: "unconfirmed", sig: SIG };
        };
        window.CluckUtil = { rpc: async (m) => {
          if (m === "getSignatureStatuses") return { value: [s.sigStatus] };
          if (m === "getBlockHeight") return s.height;
          if (m === "isBlockhashValid") return { value: s.blockhashValid };
          throw new Error("unexpected rpc " + m);
        } };
        window.fetch = async (url, opts) => {
          if (/\/api\/burn-receipt/.test(url)) { s.receiptCount++; return { ok: true, status: 200, json: async () => ({ success: true, receipt: { burned: 10, usdValue: null, pctSupply: 1 } }) }; }
          s.fetchCount++;
          const mint = decodeURIComponent((String(url).match(/mint=([^&]+)/) || [])[1] || "");
          return { ok: true, status: 200, json: async () => ({ success: true, mint, symbol: "TKN", name: "Token", decimals: 6, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", supplyRaw: "1000000000", supply: 1000, priceUsd: null, walletBalanceRaw: String(Math.round(s.balance * 1e6)), walletBalance: s.balance, tokenAccount: ADDR }) };
        };
      };
      async function open(state) { return openPage(burnBundle, init, { ADDR, MINT, BH, SIG, state }); }
      const stored = (page) => page.evaluate(() => window.localStorage.getItem("clkn_seeker_burn_pending"));
      const burnBtn = (page) => page.$(".seeker-burn-actionbtn");
      const okBtnInCard = (page) => page.evaluate(() => { const c = document.querySelector(".seeker-burn-outcome"); return !!c && Array.from(c.querySelectorAll("button")).some((b) => b.innerText.trim() === "OK"); });
      async function loadAndBurn(page, amount) {
        await page.waitForSelector("#pb-mint", { timeout: 10000 });
        await page.fill("#pb-mint", MINT);
        await page.click(".seeker-burn-form .seeker-listing-runbtn");
        await page.waitForSelector("#pb-amount", { timeout: 10000 });
        await page.fill("#pb-amount", amount || "10");
        await page.click(".seeker-burn-actionbtn");
        await page.waitForSelector(".seeker-confirm .seeker-btn-danger", { timeout: 10000 });
        await page.click(".seeker-confirm .seeker-btn-danger");
      }
      const checkStatus = async (page) => {
        await page.click(".seeker-burn-outcome-unconfirmed .seeker-btn-quiet");
        await page.waitForFunction(() => !/Checking…/.test(document.body.innerText), null, { timeout: 10000 });
      };

      {
        // The finding itself: a send-capable wallet errors after it may have broadcast, no signature.
        const { page, errors } = await open({ mode: "noSignature" });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        const atAsk = JSON.parse((await page.evaluate(() => window.__state.storedAtAsk)) || "null");
        ok("the record was in storage at the moment the wallet was asked: sig null, mint, raw amount, blockhash, lifetime",
           atAsk && atAsk[ADDR] && atAsk[ADDR].sig === null && atAsk[ADDR].mint === MINT && atAsk[ADDR].rawAmt === "10000000" && atAsk[ADDR].recentBlockhash === BH && atAsk[ADDR].lastValidBlockHeight === 900, atAsk);
        const txt = await body(page);
        ok("no signature: the unconfirmed card has NO OK button", !(await okBtnInCard(page)));
        ok("no signature: NO Burn button — the form is off", !(await burnBtn(page)));
        ok("no signature: the card says a signature never came back, and never 'failed' / 'did not land'", NOSIG_RE.test(txt) && !/Burn failed|did not land|Nothing was burned/.test(txt), txt.slice(0, 400));
        ok("no signature: Check status is offered anyway", /Check status/.test(txt));
        const kept = JSON.parse((await stored(page)) || "null");
        ok("no signature: the record is KEPT, still sig:null", kept && kept[ADDR] && kept[ADDR].sig === null, kept);
        await checkStatus(page);
        ok("Check status with a live blockhash: still unconfirmed, record kept, no Burn", !!(await page.$(".seeker-burn-outcome-unconfirmed")) && (await stored(page)) !== null && !(await burnBtn(page)));
        await remount(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        ok("remount: the locked state is restored from the record (token reloaded, card shown, no Burn, no OK)", !(await burnBtn(page)) && !(await okBtnInCard(page)) && NOSIG_RE.test(await body(page)));
        // Loading a token mid-attempt must not drop the card.
        await page.fill("#pb-mint", pk());
        await page.click(".seeker-burn-form .seeker-listing-runbtn");
        await page.waitForTimeout(300);
        ok("loading another token while unresolved keeps the card and the form off", !!(await page.$(".seeker-burn-outcome-unconfirmed")) && !(await burnBtn(page)));
        // The chain proves the blockhash dead → released: balance re-read is the only claim.
        const before = await page.evaluate(() => window.__state.fetchCount);
        await set(page, { blockhashValid: false, balance: 90 });
        await checkStatus(page);
        await page.waitForSelector(".seeker-burn-outcome-released", { timeout: 10000 });
        const rel = await body(page);
        ok("blockhash proven dead: the card is 'released' and says the balance was re-read (it renders only inside a LOADED token card)", RELEASED_READ_RE.test(rel) && !RELEASED_FAIL_RE.test(rel), rel.slice(0, 400));
        ok("…and NEVER says it did not land or that nothing was burned", !/did not land|Nothing was burned|Burn failed/.test(rel), rel.slice(0, 400));
        ok("…the balance was re-read from the chain and is what's shown", (await page.evaluate(() => window.__state.fetchCount)) > before && /90 TKN/.test(rel), rel.slice(0, 400));
        ok("…and the record is released", (await stored(page)) === null, await stored(page));
        ok("…with an OK that brings the form back", await okBtnInCard(page));
        await page.evaluate(() => Array.from(document.querySelectorAll(".seeker-burn-outcome button")).find((b) => b.innerText.trim() === "OK").click());
        await page.waitForSelector(".seeker-burn-actionbtn", { timeout: 10000 });
        ok("after OK: the Burn button is back", !!(await burnBtn(page)));
        ok("no-signature flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // The 10-minute hatch, after a remount with an aged record.
        const { page } = await open({ mode: "noSignature" });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        ok("a fresh unresolved attempt offers no escape hatch yet", !/Stop watching/.test(await body(page)));
        await page.evaluate((k) => { const m = JSON.parse(window.localStorage.getItem(k)); m[window.__ADDR].at = Date.now() - 11 * 60 * 1000; window.localStorage.setItem(k, JSON.stringify(m)); }, KEY);
        await remount(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        ok("after 10 minutes the card offers 'Stop watching' — still no OK, no Burn", /Stop watching/.test(await body(page)) && !(await okBtnInCard(page)) && !(await burnBtn(page)));
        await page.click(".seeker-burn-stopwatch");
        await page.waitForSelector(".seeker-burn-actionbtn", { timeout: 10000 });
        ok("Stop watching clears the record and brings the form back", (await stored(page)) === null && !!(await burnBtn(page)));
        await page.close();
      }
      {
        // Storage failure → the wallet is never asked.
        const { page } = await open({ mode: "noSignature" });
        await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); }; });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-failed", { timeout: 10000 });
        const st = await page.evaluate(() => ({ asked: window.__state.walletAsked, seen: window.__state.beforeSignSeen }));
        ok("the pane hands the seam a beforeSign callback", st.seen === true, st);
        ok("storage write failure → the wallet is NEVER asked, and the person is told why", st.asked === false && SAVE_FAIL_RE.test(await body(page)), st);
        await page.close();
      }
      {
        // Declined / refused / landed each retire the pre-prompt record.
        for (const [mode, sel] of [["declined", ".seeker-burn-outcome-declined"], ["refused", ".seeker-burn-outcome-failed"], ["sent", ".seeker-burn-outcome-sent"]]) {
          const { page } = await open({ mode });
          await loadAndBurn(page);
          await page.waitForSelector(sel, { timeout: 10000 });
          ok(`${mode}: the record written before the prompt is retired`, (await stored(page)) === null, await stored(page));
          await page.close();
        }
      }
      {
        // Unconfirmed WITH a signature: Check status → the chain says confirmed → Burned, record cleared.
        const { page } = await open({ mode: "unconfirmed" });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        const mid = JSON.parse((await stored(page)) || "null");
        ok("unconfirmed with a signature: the record carries it", mid && mid[ADDR] && mid[ADDR].sig === SIG, mid);
        ok("…no OK, no Burn, explorer link shown", !(await okBtnInCard(page)) && !(await burnBtn(page)) && !!(await page.$('a[href="https://solscan.io/tx/' + SIG + '"]')));
        await set(page, { sigStatus: { err: null, confirmationStatus: "confirmed" } });
        await checkStatus(page);
        await page.waitForSelector(".seeker-burn-outcome-sent", { timeout: 10000 });
        ok("Check status → confirmed: Burned, receipt fetched, record cleared", (await stored(page)) === null && (await page.evaluate(() => window.__state.receiptCount)) === 1);
        await page.close();
      }
      {
        // ⚠️ Codex round 2 on #479, P1 — wallet A's declined card is on screen; wallet B (with an
        // unresolved burn on record, blockhash still live) connects. The first cut kept A's card,
        // whose OK brought the burn form back for B. Now B's record wins the moment B connects.
        const B = pk();
        const { page, errors } = await open({ mode: "declined" });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-declined", { timeout: 10000 });
        await page.evaluate(({ k, B, MINT, BH }) => {
          window.localStorage.setItem(k, JSON.stringify({ [B]: { sig: null, mint: MINT, symbol: "TKN", decimals: 6, rawAmt: "5000000", amount: 5, isFullBalance: false, recentBlockhash: BH, lastValidBlockHeight: 900, wallet: B, at: Date.now() } }));
          window.__state.walletAsked = false;
          window.__setWallet(B);
        }, { k: KEY, B, MINT, BH });
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        ok("wallet switch onto an unresolved record: B's watching card replaces A's declined card", !(await page.$(".seeker-burn-outcome-declined")) && NOSIG_RE.test(await body(page)));
        ok("…no OK, no Burn — nothing on screen can start a second attempt for B", !(await okBtnInCard(page)) && !(await burnBtn(page)));
        const recB = JSON.parse((await stored(page)) || "null");
        ok("…B's original record is untouched (still sig:null, same blockhash) and the wallet was never asked", recB && recB[B] && recB[B].sig === null && recB[B].recentBlockhash === BH && recB[B].rawAmt === "5000000" && (await page.evaluate(() => window.__state.walletAsked)) === false, recB);
        // Switching back to A (no record) must not carry B's card onto A's screen.
        await page.evaluate((A) => window.__setWallet(A), ADDR);
        await page.waitForFunction(() => !document.querySelector(".seeker-burn-outcome-unconfirmed"), null, { timeout: 10000 });
        ok("switching back to a wallet with no record drops B's card (and A's old declined card is gone too)", !(await page.$(".seeker-burn-outcome")));
        ok("wallet-switch flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // Unconfirmed with a signature that then FAILS on chain: nothing burned, form back.
        const { page } = await open({ mode: "unconfirmed" });
        await loadAndBurn(page);
        await page.waitForSelector(".seeker-burn-outcome-unconfirmed", { timeout: 10000 });
        await set(page, { sigStatus: { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" } });
        await checkStatus(page);
        await page.waitForSelector(".seeker-burn-outcome-failed", { timeout: 10000 });
        ok("a signature that landed and failed on chain: 'Nothing was burned', record cleared", /Nothing was burned/.test(await body(page)) && (await stored(page)) === null);
        await page.close();
      }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    console.log("\n(d) rendered — Swap\n");
    {
      const QUOTE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "quote.json"), "utf8"));
      const SWAP = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "seeker-swap", "swap.json"), "utf8"));
      const SOL = "So11111111111111111111111111111111111111112";
      const SKR = QUOTE.outputMint;
      // The structural verifier and the pre-sign simulation are each pinned by their own test
      // (seeker-swap-verify-test, seeker-swap-simulate-test); here they pass so the attempt guard
      // behind them can be exercised. sign.js: only the wallet call is scripted.
      const passThrough = {
        name: "swap-verify-sim-shim",
        setup(b) {
          b.onResolve({ filter: /^\.\.\/swap-verify\.js$/ }, () => ({ path: "verify-shim", namespace: "shim" }));
          b.onLoad({ filter: /^verify-shim$/, namespace: "shim" }, () => ({ contents: `export const MAX_PRIORITY_FEE_LAMPORTS = 1000000;\nexport const verifySwapTransaction = () => ({ ok: true, feeLamports: 5000, signatureCount: 1, ataCreateCount: 0, createdAtas: [], outputAtas: [], trackedAtas: [] });`, resolveDir: SEEKER }));
          b.onResolve({ filter: /^\.\.\/swap-simulate\.js$/ }, () => ({ path: "sim-shim", namespace: "shim" }));
          b.onLoad({ filter: /^sim-shim$/, namespace: "shim" }, () => ({ contents: `export const preSignSimulation = async () => ({ ok: true });`, resolveDir: SEEKER }));
        },
      };
      const swapBundle = await bundle(`
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { MemoryRouter } from "react-router-dom";
        import SwapPane from "./tools/Swap.jsx";
        const wallet = { connected: true, address: window.__ADDR, provider: { publicKey: { toString: () => window.__ADDR } } };
        let root = null;
        window.__mount = () => { root = createRoot(document.getElementById("root")); root.render(<MemoryRouter><SwapPane wallet={wallet} /></MemoryRouter>); };
        window.__unmount = () => { if (root) root.unmount(); root = null; };
        window.__mount();
      `, [signShim(/Swap\.jsx$/), passThrough]);
      const KEY = "seekerSwapPendingTx";
      const ADDR = pk(), BH = pk(), SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
      const LVB = SWAP.lastValidBlockHeight;
      const init = ({ ADDR, BH, SIG, QUOTE, SWAP, SOL, SKR, state }) => {
        window.__ADDR = ADDR;
        const s = window.__state = Object.assign({ balanceReads: 0, height: 1000, blockhashValid: true, sigStatus: null }, state);
        // The v0 transaction is never really deserialised here (the verifier is shimmed); the
        // pane reads ONLY `.message.recentBlockhash` off it for the record, so hand it that.
        window.solanaWeb3 = { VersionedTransaction: { deserialize: () => ({ version: 0, message: { recentBlockhash: BH } }) }, PublicKey: function () {} };
        s.signSendConfirm = async (a) => {
          s.beforeSignSeen = typeof a.beforeSign === "function"; s.walletAsked = false; s.storedAtAsk = null;
          a.build(window.solanaWeb3, "unused", ADDR, { lastValidBlockHeight: 1 });
          let saved = true;
          if (s.beforeSignSeen) { try { saved = a.beforeSign({ blockhash: "unused", lastValidBlockHeight: 1 }) !== false; } catch (_) { saved = false; } }
          if (!saved) return { status: "failed", error: "Could not save the recovery record — nothing was sent. Free some storage and try again." };
          s.walletAsked = true; s.storedAtAsk = window.localStorage.getItem("seekerSwapPendingTx");
          if (s.mode === "noSignature") return { status: "unconfirmed", noSignature: true, error: "bridge closed after broadcast" };
          if (s.mode === "declined") return { status: "declined" };
          if (typeof a.onSigned === "function") { try { if (a.onSigned(SIG) === false && a.requireOnSigned) return { status: "failed", error: "Could not save the recovery record — nothing was sent. Free some storage and try again.", sig: SIG }; } catch (_) { if (a.requireOnSigned) return { status: "failed", error: "Could not save the recovery record — nothing was sent. Free some storage and try again.", sig: SIG }; } }
          if (s.mode === "sent") return { status: "sent", sig: SIG };
          return { status: "unconfirmed", sig: SIG };
        };
        window.CluckUtil = { rpc: async (m) => {
          if (m === "getBalance") { s.balanceReads++; if (s.balanceFail) throw new Error("rpc down"); return { value: 1000000000 }; }
          if (m === "getTokenAccountsByOwner") return { value: [] };
          if (m === "getSignatureStatuses") return { value: [s.sigStatus] };
          if (m === "getBlockHeight") return s.height;
          if (m === "isBlockhashValid") return { value: s.blockhashValid };
          throw new Error("unexpected rpc " + m);
        } };
        const json = (o) => ({ ok: true, status: 200, json: async () => o });
        window.fetch = async (url) => {
          const u = String(url);
          if (/\/api\/seeker\/swap\/config/.test(u)) return json({ ok: true, mints: [{ symbol: "SOL", mint: SOL, decimals: 9 }, { symbol: "SKR", mint: SKR, decimals: 6 }], defaultIn: "SOL", defaultOut: "SKR", slippageBpsOptions: [50, 100, 300], defaultSlippageBps: 100, platformFeeBps: 0 });
          if (/\/api\/seeker\/swap\/quote/.test(u)) return json({ ok: true, quote: QUOTE, quoteId: "q1" });
          if (/\/api\/seeker\/swap\/tx/.test(u)) return json({ ok: true, swapTransaction: SWAP.swapTransaction, lastValidBlockHeight: SWAP.lastValidBlockHeight, inputMint: QUOTE.inputMint, outputMint: QUOTE.outputMint, inAmount: QUOTE.inAmount, outAmount: QUOTE.outAmount, otherAmountThreshold: QUOTE.otherAmountThreshold, slippageBps: QUOTE.slippageBps, priceImpactPct: QUOTE.priceImpactPct });
          return { ok: false, status: 404, json: async () => ({}) };
        };
      };
      async function open(state) { return openPage(swapBundle, init, { ADDR, BH, SIG, QUOTE, SWAP, SOL, SKR, state }); }
      const stored = (page) => page.evaluate(() => window.localStorage.getItem("seekerSwapPendingTx"));
      const amountDisabled = (page) => page.evaluate(() => { const i = document.querySelector("#swap-pay-amount"); return i ? i.disabled : null; });
      const reviewLive = (page) => page.evaluate(() => { const b = document.querySelector(".seeker-listing-runbtn"); return !!b && !b.disabled; });
      async function quoteAndConfirm(page) {
        await page.waitForSelector("#swap-pay-amount", { timeout: 10000 });
        await page.fill("#swap-pay-amount", "0.01");
        await page.waitForSelector(".seeker-listing-runbtn:not([disabled])", { timeout: 10000 });
        await page.click(".seeker-listing-runbtn");
        await page.waitForSelector(".seeker-confirm-actions", { timeout: 10000 });
        await page.click(".seeker-confirm-actions button:not(.seeker-btn-quiet)");
      }

      {
        const { page, errors } = await open({ mode: "noSignature" });
        await quoteAndConfirm(page);
        await page.waitForFunction(() => window.__state.walletAsked === true, null, { timeout: 10000 });
        const atAsk = JSON.parse((await page.evaluate(() => window.__state.storedAtAsk)) || "null");
        ok("the record was in storage at the moment the wallet was asked: sig null, the transaction's OWN blockhash, upstream's lifetime, the wallet",
           atAsk && atAsk.sig === null && atAsk.recentBlockhash === BH && atAsk.lastValidBlockHeight === LVB && atAsk.wallet === ADDR, atAsk);
        await page.waitForFunction(() => !/Approve the swap in your wallet/.test(document.body.innerText), null, { timeout: 10000 });
        await page.waitForTimeout(300);
        const txt = await body(page);
        ok("no signature: the amount field is DISABLED (the form is locked by the record)", (await amountDisabled(page)) === true);
        ok("no signature: Review swap is not live", !(await reviewLive(page)));
        ok("no signature: the watching card says a signature never came back; never 'failed' / 'did not land'", NOSIG_RE.test(txt) && !/Swap failed|did not land|Try again/.test(txt), txt.slice(0, 500));
        const kept = JSON.parse((await stored(page)) || "null");
        ok("no signature: the record is KEPT, still sig:null", kept && kept.sig === null && kept.wallet === ADDR, kept);
        // The poll runs every 3s: a live blockhash keeps everything locked.
        await page.waitForTimeout(3500);
        ok("3s later with a live blockhash: still locked, record kept", (await amountDisabled(page)) === true && (await stored(page)) !== null);
        await remount(page);
        await page.waitForSelector("#swap-pay-amount", { timeout: 10000 });
        await page.waitForTimeout(300);
        ok("remount: the sig-less record is restored and the form is still locked", (await amountDisabled(page)) === true && NOSIG_RE.test(await body(page)));
        // Blockhash proven dead → released: balance re-read, the record freed, no "did not land".
        const reads = await page.evaluate(() => window.__state.balanceReads);
        await set(page, { height: LVB + 10, blockhashValid: false });
        await page.waitForSelector(".seeker-burn-outcome-released", { timeout: 10000 });
        let rel = await body(page);
        await page.waitForFunction(() => /Your balance was just re-read from the chain/.test(document.body.innerText), null, { timeout: 10000 });
        ok("blockhash proven dead: a 'released' card that says the balance was re-read — once the read succeeded", RELEASED_READ_RE.test(rel = await body(page)) && !RELEASED_FAIL_RE.test(rel), rel.slice(0, 500));
        ok("…that never says it did not land / safe to try again", !/did not land|safe to try again|Swap failed/.test(rel), rel.slice(0, 500));
        ok("…the balance was re-read from the chain", (await page.evaluate(() => window.__state.balanceReads)) > reads);
        ok("…the record is released and the form is usable again", (await stored(page)) === null && (await amountDisabled(page)) === false);
        ok("swap no-signature flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // ⚠️ Codex round 2 on #479, P2 — the same release, but the balance re-read FAILS. The
        // card used to say "Your balance was just re-read from the chain" beside "Balance
        // unavailable". Now it says the read failed, and never claims a re-read.
        const { page } = await open({ mode: "noSignature" });
        await quoteAndConfirm(page);
        await page.waitForFunction(() => window.__state.walletAsked === true, null, { timeout: 10000 });
        await page.waitForFunction(() => !/Approve the swap in your wallet/.test(document.body.innerText), null, { timeout: 10000 });
        await set(page, { balanceFail: true, height: LVB + 10, blockhashValid: false });
        await page.waitForSelector(".seeker-burn-outcome-released", { timeout: 10000 });
        await page.waitForFunction(() => /Balance unavailable/.test(document.body.innerText), null, { timeout: 10000 });
        const txt = await body(page);
        ok("released while the balance read FAILS: the card says the balance could not be re-read", RELEASED_FAIL_RE.test(txt), txt.slice(0, 600));
        ok("…and NEVER claims it was just re-read", !RELEASED_READ_RE.test(txt), txt.slice(0, 600));
        ok("…the form's own balance line agrees (Balance unavailable), the record is released", /Balance unavailable/.test(txt) && (await stored(page)) === null);
        await page.close();
      }
      {
        const { page } = await open({ mode: "noSignature" });
        await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); }; });
        await quoteAndConfirm(page);
        await page.waitForSelector(".seeker-burn-outcome-failed", { timeout: 10000 });
        const st = await page.evaluate(() => ({ asked: window.__state.walletAsked, seen: window.__state.beforeSignSeen }));
        ok("Swap hands the seam a beforeSign callback", st.seen === true, st);
        ok("storage write failure → the wallet is NEVER asked, and the person is told why", st.asked === false && SAVE_FAIL_RE.test(await body(page)), st);
        await page.close();
      }
      {
        for (const [mode, sel] of [["declined", ".seeker-burn-outcome-declined"], ["sent", ".seeker-burn-outcome-sent"]]) {
          const { page } = await open({ mode });
          await quoteAndConfirm(page);
          await page.waitForSelector(sel, { timeout: 10000 });
          await page.waitForTimeout(200);
          ok(`${mode}: the record written before the prompt is retired and the form is usable`, (await stored(page)) === null && (await amountDisabled(page)) === false, await stored(page));
          await page.close();
        }
      }
      {
        // Unconfirmed WITH a signature keeps the existing behaviour: locked, polled, resolved by the chain.
        const { page } = await open({ mode: "unconfirmed" });
        await quoteAndConfirm(page);
        await page.waitForFunction((k) => { const r = JSON.parse(window.localStorage.getItem(k) || "null"); return !!(r && r.sig); }, KEY, { timeout: 10000 });
        const rec = JSON.parse((await stored(page)) || "null");
        ok("unconfirmed with a signature: the record carries it, with the same blockhash and lifetime", rec && rec.sig === SIG && rec.recentBlockhash === BH && rec.lastValidBlockHeight === LVB, rec);
        await set(page, { sigStatus: { err: null, confirmationStatus: "confirmed" } });
        await page.waitForSelector(".seeker-burn-outcome-sent", { timeout: 10000 });
        ok("the poll resolves it as Swapped and clears the record", (await stored(page)) === null);
        await page.close();
      }
    }
    await browser.close();
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
