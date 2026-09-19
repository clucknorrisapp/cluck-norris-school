#!/usr/bin/env node
"use strict";
// The Solana Room (CLAUDE.md) — a public, no-wallet reference room on how Solana actually works.
// Ships the room shell (/solana) plus six full pages: the rent page (/solana/rent, "The deposit
// you didn't know you made"), the wallet page (/solana/wallet, "What your wallet actually
// holds"), the mint page (/solana/mint, "What a token mint is"), the buying page (/solana/buying,
// "What actually happens when you buy"), the transfers page (/solana/transfers, "Sending tokens,
// and why the first one costs extra") and the fees page (/solana/fees, "What a transaction
// actually costs"). Boots the REAL server with a throwaway DATA_DIR on a no-build boot (no
// `npm run build` has run — CLAUDE.md: public/ is only served through the vite build's copy in
// dist/, so every page needs its own explicit app.get route or they 404 here) and asserts:
//
//   (a) all seven routes (the room + six topic pages) serve 200 on a no-build boot;
//   (b) the room page links to all six topic pages, and COMING_NEXT is now empty (all six
//       tier-1 topics have shipped);
//   (c) the rent page carries a distinct scam-warning block and the "not an airdrop" statement;
//   (d) every literal string passed to this page's own t() i18n helper, on ANY of the seven
//       pages, exists in all six curated dictionaries (public/i18n/<lang>.json) — extracted the
//       same way scripts/i18n-audit.cjs's Hub-pages gate does (a literal string immediately
//       inside a t(...)/tf(...) call, scoped to <script> blocks);
//   (e) no forbidden word/phrase appears on any of the seven pages: no yield/APR/APY framing,
//       nothing about Normie Quest or Wallet Watch, no mention of Nomadz, and nothing about the
//       Solana Foundation or ETFs (this increment's explicit scope limits);
//   (f) the mint page's two example mint addresses (the real SKR mint and its impersonator)
//       appear byte-for-byte exactly as given — a typo'd address on a page about impersonation
//       would be its own disaster;
//   (g) the buying, transfers and fees pages each carry their required content blocks and cite
//       solana.com for their factual claims.
//
// Usage: node scripts/solana-room-test.cjs [baseUrl]
// Env:   SOLANA_ROOM_TEST_PORT (default 3601, inside the reserved 3600-3609 test-server range)
//        — used only when baseUrl is omitted (a server is booted).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.SOLANA_ROOM_TEST_PORT || 3601);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "solana-room-test-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════════════════════
// (d) t() key extraction — same technique as scripts/i18n-audit.cjs's extractJsTFCalls: a
// literal string immediately inside a t(...)/tf(...) call, scoped to <script> blocks (never
// markup text), so it never double-counts a literal that also happens to appear as body copy.
// ════════════════════════════════════════════════════════════════════════════════════════════
function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function extractJsScriptBlocks(raw) {
  const blocks = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(raw))) blocks.push(m[1]);
  return blocks;
}
function extractJsTFCalls(raw) {
  const keys = new Set();
  const callRe = /\b(?:t|tf)\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const block of extractJsScriptBlocks(raw)) {
    let m;
    while ((m = callRe.exec(block))) {
      const v = norm(decodeEntities(m[2].replace(/\\(['"\\])/g, "$1")));
      if (v) keys.add(v);
    }
  }
  return keys;
}

const PAGE_FILES = ["solana-room.html", "solana-rent.html", "solana-wallet.html", "solana-mint.html", "solana-buying.html", "solana-transfers.html", "solana-fees.html"];
const LANGS = ["es", "hi", "it", "pt", "vi", "zh"];

// The mint page's real, verifiable example (task brief, verified against docs/SEEKER_APP_PLAN.md
// §7): the official SKR mint (Jupiter-verified, ~45.8k holders) and the impersonator mint that a
// plain web search surfaced first (unverified, 4 holders, no market cap). Exact-match, not a
// substring/case-insensitive check — a single swapped character here would defeat the page's
// entire point.
const SKR_REAL_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const SKR_FAKE_MINT = "79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj";

// FORBIDDEN — this increment's explicit scope limits (task brief, not the broader hub-trust
// list): no yield/APR/APY framing, nothing about Normie Quest reward terms, never mention Wallet
// Watch (it is private — CLAUDE.md), no Nomadz, nothing about the Solana Foundation or ETFs.
// "airdrop" and "free" are NOT forbidden — the page legitimately uses both to REFUTE the "claim
// your free SOL" framing ("It is not an airdrop", "not free money appearing from nowhere").
const FORBIDDEN = [
  { name: "yield", re: /\byield\b/i },
  { name: "APR", re: /\bapr\b/i },
  { name: "APY", re: /\bapy\b/i },
  { name: "guaranteed", re: /\bguaranteed\b/i },
  { name: "Normie Quest", re: /normie\s*quest/i },
  { name: "Wallet Watch", re: /wallet\s*watch/i },
  { name: "Nomadz", re: /nomadz/i },
  { name: "Solana Foundation", re: /solana\s*foundation/i },
  { name: "ETF", re: /\betfs?\b/i },
];

(async () => {
  let srv = null;
  if (!ARG_BASE) {
    const env = {
      ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "",
      MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9",
    };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {}
      await sleep(500);
    }
    if (!up) { console.error("  server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  const done = () => { if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} } try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);

  console.log(`\nThe Solana Room — ${BASE}\n`);

  // ── (a) all seven routes serve 200 on a no-build boot ────────────────────────────────────────
  console.log("(a) all seven routes serve 200 on a no-build boot\n");
  let roomText = "", rentText = "", walletText = "", mintText = "", buyingText = "", transfersText = "", feesText = "";
  {
    const r = await fetch(`${BASE}/solana`);
    ok("GET /solana -> 200", r.status === 200, "got " + r.status);
    roomText = await r.text();
    ok("GET /solana body is non-trivial HTML", roomText.length > 500 && /<html/i.test(roomText));
  }
  {
    const r = await fetch(`${BASE}/solana/rent`);
    ok("GET /solana/rent -> 200", r.status === 200, "got " + r.status);
    rentText = await r.text();
    ok("GET /solana/rent body is non-trivial HTML", rentText.length > 500 && /<html/i.test(rentText));
  }
  {
    const r = await fetch(`${BASE}/solana/wallet`);
    ok("GET /solana/wallet -> 200", r.status === 200, "got " + r.status);
    walletText = await r.text();
    ok("GET /solana/wallet body is non-trivial HTML", walletText.length > 500 && /<html/i.test(walletText));
  }
  {
    const r = await fetch(`${BASE}/solana/mint`);
    ok("GET /solana/mint -> 200", r.status === 200, "got " + r.status);
    mintText = await r.text();
    ok("GET /solana/mint body is non-trivial HTML", mintText.length > 500 && /<html/i.test(mintText));
  }
  {
    const r = await fetch(`${BASE}/solana/buying`);
    ok("GET /solana/buying -> 200", r.status === 200, "got " + r.status);
    buyingText = await r.text();
    ok("GET /solana/buying body is non-trivial HTML", buyingText.length > 500 && /<html/i.test(buyingText));
  }
  {
    const r = await fetch(`${BASE}/solana/transfers`);
    ok("GET /solana/transfers -> 200", r.status === 200, "got " + r.status);
    transfersText = await r.text();
    ok("GET /solana/transfers body is non-trivial HTML", transfersText.length > 500 && /<html/i.test(transfersText));
  }
  {
    const r = await fetch(`${BASE}/solana/fees`);
    ok("GET /solana/fees -> 200", r.status === 200, "got " + r.status);
    feesText = await r.text();
    ok("GET /solana/fees body is non-trivial HTML", feesText.length > 500 && /<html/i.test(feesText));
  }

  // ── (b) the room links to all six topic pages ────────────────────────────────────────────────
  // The room page renders its "available now" cards from an AVAILABLE_NOW array (each entry's
  // `href` field feeds the anchor tag at render time), so the literal attribute text
  // `href="/solana/rent"` never appears in the unrendered source the way a hand-written anchor
  // would — this checks the array's own href fields instead, which is what actually drives the
  // rendered link.
  console.log("\n(b) the room page links to all six topic pages\n");
  ok("room page's AVAILABLE_NOW array points at /solana/rent", /href:\s*['"]\/solana\/rent['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/wallet", /href:\s*['"]\/solana\/wallet['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/mint", /href:\s*['"]\/solana\/mint['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/buying", /href:\s*['"]\/solana\/buying['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/transfers", /href:\s*['"]\/solana\/transfers['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/fees", /href:\s*['"]\/solana\/fees['"]/.test(roomText));

  // ── (c) the rent page carries the scam-warning block and the "not an airdrop" statement ─────
  console.log('\n(c) the rent page carries the scam-warning block and the "not an airdrop" statement\n');
  ok('rent page has a data-section="scam-warning" block', /data-section=["']scam-warning["']/.test(rentText));
  ok('rent page has a data-section="not-an-airdrop" block', /data-section=["']not-an-airdrop["']/.test(rentText));
  ok('rent page states "It is not an airdrop"', rentText.includes("It is not an airdrop"));
  ok('rent page warns nobody needs a seed phrase', /seed phrase/i.test(rentText));
  ok('rent page warns against a token delegate approval', /token delegate/i.test(rentText));
  ok('rent page says a surplus-withdrawal view is not built yet (no implying it exists)', /no page here yet/i.test(rentText));
  ok("rent page links to /firepit as the honest next step for closing an account", /href=["']\/firepit["']/.test(rentText));
  ok("rent page cites solana.com/upgrades/reduced-rent", rentText.includes("https://solana.com/upgrades/reduced-rent"));
  ok("rent page cites solana.com/docs/tokens/advanced/withdraw-excess-lamports", rentText.includes("https://solana.com/docs/tokens/advanced/withdraw-excess-lamports"));

  // ── the wallet page and the mint page carry their required content ─────────────────────────
  console.log("\nthe wallet page and the mint page carry their required content\n");
  ok('wallet page has a data-section="seed-phrase" block', /data-section=["']seed-phrase["']/.test(walletText));
  ok('wallet page has a data-section="connecting" block', /data-section=["']connecting["']/.test(walletText));
  ok("wallet page cites solana.com/docs/core/accounts", walletText.includes("https://solana.com/docs/core/accounts"));
  ok("wallet page cites solana.com/docs/core/transactions", walletText.includes("https://solana.com/docs/core/transactions"));
  ok("wallet page links to /wallet-checkup", /href=["']\/wallet-checkup["']/.test(walletText));
  ok("wallet page links back to /solana/rent", /href=["']\/solana\/rent["']/.test(walletText));
  ok('mint page has a data-section="impersonation-example" block', /data-section=["']impersonation-example["']/.test(mintText));
  ok('mint page has a data-section="legitimacy-guardrail" block', /data-section=["']legitimacy-guardrail["']/.test(mintText));
  ok("mint page cites solana.com/docs/tokens/basics", mintText.includes("https://solana.com/docs/tokens/basics"));
  ok("mint page cites solana.com/docs/tokens/basics/create-mint", mintText.includes("https://solana.com/docs/tokens/basics/create-mint"));
  ok("mint page links to /wallet-checkup", /href=["']\/wallet-checkup["']/.test(mintText));
  ok("mint page links to /autopsy", /href=["']\/autopsy["']/.test(mintText));
  ok("mint page links back to /solana/wallet", /href=["']\/solana\/wallet["']/.test(mintText));

  // ── the buying page carries its required content ────────────────────────────────────────────
  console.log("\nthe buying page carries its required content\n");
  ok('buying page has a data-section="not-a-store" block', /data-section=["']not-a-store["']/.test(buyingText));
  ok('buying page has a data-section="slippage" block', /data-section=["']slippage["']/.test(buyingText));
  ok('buying page has a data-section="impact-vs-fee" block', /data-section=["']impact-vs-fee["']/.test(buyingText));
  ok('buying page has a data-section="failed-swap-cost" block', /data-section=["']failed-swap-cost["']/.test(buyingText));
  ok('buying page has a data-section="tradeable-not-endorsement" block', /data-section=["']tradeable-not-endorsement["']/.test(buyingText));
  ok("buying page mentions slippage", /slippage/i.test(buyingText));
  ok("buying page mentions price impact", /price impact/i.test(buyingText));
  ok("buying page says a failed swap still costs a fee", /still charge|isn't free to attempt|not free to attempt/i.test(buyingText));
  ok("buying page links to /lp-lab", /href=["']\/lp-lab["']/.test(buyingText));
  ok("buying page links to /wallet-checkup", /href=["']\/wallet-checkup["']/.test(buyingText));
  ok("buying page links to /autopsy", /href=["']\/autopsy["']/.test(buyingText));
  ok("buying page links back to /solana", /href=["']\/solana["']/.test(buyingText));
  ok("buying page cites solana.com/docs/core/transactions", buyingText.includes("https://solana.com/docs/core/transactions"));
  ok("buying page cites solana.com/docs/core/fees", buyingText.includes("https://solana.com/docs/core/fees"));

  // ── the transfers page carries its required content ─────────────────────────────────────────
  console.log("\nthe transfers page carries its required content\n");
  ok('transfers page has a data-section="account-to-account" block', /data-section=["']account-to-account["']/.test(transfersText));
  ok('transfers page has a data-section="sol-vs-spl" block', /data-section=["']sol-vs-spl["']/.test(transfersText));
  ok('transfers page has a data-section="first-transfer-cost" block', /data-section=["']first-transfer-cost["']/.test(transfersText));
  ok('transfers page has a data-section="memo-warning" block', /data-section=["']memo-warning["']/.test(transfersText));
  ok('transfers page has a data-section="no-undo" block', /data-section=["']no-undo["']/.test(transfersText));
  ok("transfers page mentions memo", /memo/i.test(transfersText));
  ok("transfers page says a transfer is irreversible", /cannot be taken back|is final/i.test(transfersText));
  ok("transfers page links to /solana/rent", /href=["']\/solana\/rent["']/.test(transfersText));
  ok("transfers page links back to /solana/wallet or /solana", /href=["'](\/solana\/wallet|\/solana)["']/.test(transfersText));
  ok("transfers page cites solana.com/docs/tokens/basics/transfer-tokens", transfersText.includes("https://solana.com/docs/tokens/basics/transfer-tokens"));
  ok("transfers page cites solana.com/docs/tokens/basics/create-token-account", transfersText.includes("https://solana.com/docs/tokens/basics/create-token-account"));
  ok("transfers page cites solana.com/docs/tokens/extensions", transfersText.includes("https://solana.com/docs/tokens/extensions"));

  // ── the fees page carries its required content ──────────────────────────────────────────────
  console.log("\nthe fees page carries its required content\n");
  ok('fees page has a data-section="base-fee" block', /data-section=["']base-fee["']/.test(feesText));
  ok('fees page has a data-section="priority-fee" block', /data-section=["']priority-fee["']/.test(feesText));
  ok('fees page has a data-section="compute-units" block', /data-section=["']compute-units["']/.test(feesText));
  ok('fees page has a data-section="failed-tx-fee" block', /data-section=["']failed-tx-fee["']/.test(feesText));
  ok('fees page has a data-section="need-sol-to-move-tokens" block', /data-section=["']need-sol-to-move-tokens["']/.test(feesText));
  ok("fees page states the base fee is 5,000 lamports per signature", /5,000 lamports/.test(feesText));
  ok("fees page states the compute unit default of 200,000", /200,000/.test(feesText));
  ok("fees page states the compute unit max of 1,400,000", /1,400,000/.test(feesText));
  ok("fees page says a failed transaction still costs a fee", /still charged|still cost/i.test(feesText));
  ok("fees page links back to /solana/rent", /href=["']\/solana\/rent["']/.test(feesText));
  ok("fees page cites solana.com/docs/core/fees", feesText.includes("https://solana.com/docs/core/fees"));
  ok("fees page cites solana.com/docs/core/transactions", feesText.includes("https://solana.com/docs/core/transactions"));

  // ── (f) the mint page's two example mint addresses appear exactly as given ─────────────────
  console.log("\n(f) the mint page's two example mint addresses appear exactly as given\n");
  ok("mint page contains the real SKR mint address, byte-for-byte", mintText.includes(SKR_REAL_MINT));
  ok("mint page contains the impersonator mint address, byte-for-byte", mintText.includes(SKR_FAKE_MINT));
  ok("the two example mint addresses are not the same string", SKR_REAL_MINT !== SKR_FAKE_MINT);

  // ── the room page moved all six topics into "available now"; COMING_NEXT is now empty ───────
  // Parses the two source arrays directly (AVAILABLE_NOW / COMING_NEXT) rather than eyeballing
  // string position, so this can't be fooled by an unrelated literal occurring earlier in the
  // file — it checks which ARRAY each topic's title literal actually sits inside.
  console.log('\nthe room page has all six topics in "available now"; COMING_NEXT is empty\n');
  {
    const availableBlock = (/var AVAILABLE_NOW = \[([\s\S]*?)\n\s*\];/.exec(roomText) || [])[1] || "";
    const comingBlock = (/var COMING_NEXT = (\[[\s\S]*?\]);/.exec(roomText) || [])[1] || "";
    ok("room page source has a parseable AVAILABLE_NOW array", availableBlock.length > 0);
    ok("room page source has a parseable COMING_NEXT array", comingBlock.length > 0);
    ok('"What your wallet actually holds" is in AVAILABLE_NOW', availableBlock.includes("What your wallet actually holds"));
    ok('"What a token mint is" is in AVAILABLE_NOW', availableBlock.includes("What a token mint is"));
    ok('"What actually happens when you buy" is in AVAILABLE_NOW', availableBlock.includes("What actually happens when you buy"));
    ok('"Sending tokens, and why the first one costs extra" is in AVAILABLE_NOW', availableBlock.includes("Sending tokens, and why the first one costs extra"));
    ok('"What a transaction actually costs" is in AVAILABLE_NOW', availableBlock.includes("What a transaction actually costs"));
    ok("six topics are in AVAILABLE_NOW", (availableBlock.match(/title:/g) || []).length === 6, "found " + (availableBlock.match(/title:/g) || []).length);
    ok("COMING_NEXT is now an empty array", /^\[\s*\]$/.test(comingBlock.trim()), "got " + JSON.stringify(comingBlock.trim().slice(0, 60)));
  }
  // The "coming next" section itself must not render when COMING_NEXT is empty — an empty card
  // with a title and lede but nothing underneath would be its own small bug. This is a static
  // fetch of the unexecuted page source (no headless browser here), so the literal copy is
  // always present in the script text regardless of runtime state; what this actually checks is
  // that render() gates the whole card behind a length check rather than always emitting it.
  ok('room page guards the "Coming next" card on COMING_NEXT.length > 0', /COMING_NEXT\.length > 0/.test(roomText));

  // ── the rent numbers — re-derived independently here too, not just eyeballed ────────────────
  console.log("\nrent numbers (re-derived independently)\n");
  const BILLABLE_BYTES = 293; // 165-byte token account + 128-byte account overhead
  const STAGES = [
    { rate: 6960, sol: "0.00203928" },
    { rate: 6333, sol: "0.00185557" },
    { rate: 5080, sol: "0.00148844" },
    { rate: 696, sol: "0.00020393" },
  ];
  for (const s of STAGES) {
    const lamports = BILLABLE_BYTES * s.rate;
    const sol = (lamports / 1e9).toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
    ok(`${s.rate} lamports/byte -> ${lamports} lamports (${s.sol} SOL)`, sol.startsWith(s.sol), "computed " + sol);
  }
  const original = BILLABLE_BYTES * STAGES[0].rate;
  const surplus1 = original - BILLABLE_BYTES * STAGES[1].rate;
  const surplus2 = original - BILLABLE_BYTES * STAGES[2].rate;
  const surplusAll = original - BILLABLE_BYTES * STAGES[3].rate;
  ok("step 1 surplus is 183,711 lamports", surplus1 === 183711, String(surplus1));
  ok("step 2 surplus is 550,840 lamports", surplus2 === 550840, String(surplus2));
  ok("all-five surplus is 1,835,352 lamports", surplusAll === 1835352, String(surplusAll));

  // ── (d) every t() key on all seven pages exists in all six dictionaries ─────────────────────
  console.log("\n(d) every t() key on all seven pages exists in all six curated dictionaries\n");
  const dicts = {};
  for (const lang of LANGS) {
    try { dicts[lang] = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${lang}.json`), "utf8")); }
    catch (e) { dicts[lang] = null; ok(`public/i18n/${lang}.json parses as JSON`, false, e.message); }
  }
  const allKeys = new Set();
  for (const f of PAGE_FILES) {
    const raw = fs.readFileSync(path.join(ROOT, "public", f), "utf8");
    for (const k of extractJsTFCalls(raw)) allKeys.add(k);
  }
  ok("at least one t() key was found across all seven pages", allKeys.size > 30, String(allKeys.size));
  let keyGaps = 0;
  for (const key of allKeys) {
    for (const lang of LANGS) {
      if (!dicts[lang]) continue;
      if (!(key in dicts[lang])) {
        keyGaps++;
        console.log(`  ✗ missing in ${lang}: ${JSON.stringify(key.slice(0, 80))}${key.length > 80 ? "…" : ""}`);
      }
    }
  }
  ok(`every t() key (${allKeys.size} unique) exists in all six dictionaries`, keyGaps === 0, keyGaps + " gap(s)");

  // ── (e) no forbidden word/phrase on any of the seven pages ──────────────────────────────────
  console.log("\n(e) no forbidden word or phrase appears on any of the seven pages\n");
  for (const { fileText, label } of [
    { fileText: roomText, label: "/solana" },
    { fileText: rentText, label: "/solana/rent" },
    { fileText: walletText, label: "/solana/wallet" },
    { fileText: mintText, label: "/solana/mint" },
    { fileText: buyingText, label: "/solana/buying" },
    { fileText: transfersText, label: "/solana/transfers" },
    { fileText: feesText, label: "/solana/fees" },
  ]) {
    for (const { name, re } of FORBIDDEN) {
      const m = fileText.match(re);
      ok(`${label}: no "${name}"`, !m, m ? "found near: " + fileText.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
    }
  }

  console.log(fail ? `\n${fail} FAILED, ${pass} passed\n` : `\nall ${pass} passed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
