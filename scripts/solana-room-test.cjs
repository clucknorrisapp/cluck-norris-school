#!/usr/bin/env node
"use strict";
// The Solana Room (CLAUDE.md) — a public, no-wallet reference room on how Solana actually works.
// Ships the room shell (/solana) plus three full pages: the rent page (/solana/rent, "The
// deposit you didn't know you made"), the wallet page (/solana/wallet, "What your wallet
// actually holds") and the mint page (/solana/mint, "What a token mint is"). Boots the REAL
// server with a throwaway DATA_DIR on a no-build boot (no `npm run build` has run — CLAUDE.md:
// public/ is only served through the vite build's copy in dist/, so every page needs its own
// explicit app.get route or they 404 here) and asserts:
//
//   (a) all four routes serve 200 on a no-build boot;
//   (b) the room page links to all three topic pages;
//   (c) the rent page carries a distinct scam-warning block and the "not an airdrop" statement;
//   (d) every literal string passed to this page's own t() i18n helper, on ANY of the four
//       pages, exists in all six curated dictionaries (public/i18n/<lang>.json) — extracted the
//       same way scripts/i18n-audit.cjs's Hub-pages gate does (a literal string immediately
//       inside a t(...)/tf(...) call, scoped to <script> blocks);
//   (e) no forbidden word/phrase appears on any of the four pages: no yield/APR/APY framing,
//       nothing about Normie Quest or Wallet Watch, no mention of Nomadz, and nothing about the
//       Solana Foundation or ETFs (this increment's explicit scope limits);
//   (f) the mint page's two example mint addresses (the real SKR mint and its impersonator)
//       appear byte-for-byte exactly as given — a typo'd address on a page about impersonation
//       would be its own disaster.
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

const PAGE_FILES = ["solana-room.html", "solana-rent.html", "solana-wallet.html", "solana-mint.html"];
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

  // ── (a) all four routes serve 200 on a no-build boot ─────────────────────────────────────────
  console.log("(a) all four routes serve 200 on a no-build boot\n");
  let roomText = "", rentText = "", walletText = "", mintText = "";
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

  // ── (b) the room links to all three topic pages ─────────────────────────────────────────────
  // The room page renders its "available now" cards from an AVAILABLE_NOW array (each entry's
  // `href` field feeds the anchor tag at render time), so the literal attribute text
  // `href="/solana/rent"` never appears in the unrendered source the way a hand-written anchor
  // would — this checks the array's own href fields instead, which is what actually drives the
  // rendered link.
  console.log("\n(b) the room page links to all three topic pages\n");
  ok("room page's AVAILABLE_NOW array points at /solana/rent", /href:\s*['"]\/solana\/rent['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/wallet", /href:\s*['"]\/solana\/wallet['"]/.test(roomText));
  ok("room page's AVAILABLE_NOW array points at /solana/mint", /href:\s*['"]\/solana\/mint['"]/.test(roomText));

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

  // ── (f) the mint page's two example mint addresses appear exactly as given ─────────────────
  console.log("\n(f) the mint page's two example mint addresses appear exactly as given\n");
  ok("mint page contains the real SKR mint address, byte-for-byte", mintText.includes(SKR_REAL_MINT));
  ok("mint page contains the impersonator mint address, byte-for-byte", mintText.includes(SKR_FAKE_MINT));
  ok("the two example mint addresses are not the same string", SKR_REAL_MINT !== SKR_FAKE_MINT);

  // ── the room page moved both new topics out of "coming next" ───────────────────────────────
  // Parses the two source arrays directly (AVAILABLE_NOW / COMING_NEXT) rather than eyeballing
  // string position, so this can't be fooled by an unrelated literal occurring earlier in the
  // file — it checks which ARRAY each topic's title literal actually sits inside.
  console.log('\nthe room page moved both new topics into "available now", not "coming next"\n');
  {
    const availableBlock = (/var AVAILABLE_NOW = \[([\s\S]*?)\n\s*\];/.exec(roomText) || [])[1] || "";
    const comingBlock = (/var COMING_NEXT = \[([\s\S]*?)\n\s*\];/.exec(roomText) || [])[1] || "";
    ok("room page source has a parseable AVAILABLE_NOW array", availableBlock.length > 0);
    ok("room page source has a parseable COMING_NEXT array", comingBlock.length > 0);
    ok('"What your wallet actually holds" is in AVAILABLE_NOW', availableBlock.includes("What your wallet actually holds"));
    ok('"What a token mint is" is in AVAILABLE_NOW', availableBlock.includes("What a token mint is"));
    ok('"What your wallet actually holds" is NOT in COMING_NEXT', !comingBlock.includes("What your wallet actually holds"));
    ok('"What a token mint is" is NOT in COMING_NEXT', !comingBlock.includes("What a token mint is"));
    ok('three topics remain in COMING_NEXT', (comingBlock.match(/title:/g) || []).length === 3, "found " + (comingBlock.match(/title:/g) || []).length);
  }

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

  // ── (d) every t() key on all four pages exists in all six dictionaries ──────────────────────
  console.log("\n(d) every t() key on all four pages exists in all six curated dictionaries\n");
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
  ok("at least one t() key was found across all four pages", allKeys.size > 30, String(allKeys.size));
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

  // ── (e) no forbidden word/phrase on any of the four pages ───────────────────────────────────
  console.log("\n(e) no forbidden word or phrase appears on any of the four pages\n");
  for (const { fileText, label } of [
    { fileText: roomText, label: "/solana" },
    { fileText: rentText, label: "/solana/rent" },
    { fileText: walletText, label: "/solana/wallet" },
    { fileText: mintText, label: "/solana/mint" },
  ]) {
    for (const { name, re } of FORBIDDEN) {
      const m = fileText.match(re);
      ok(`${label}: no "${name}"`, !m, m ? "found near: " + fileText.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
    }
  }

  console.log(fail ? `\n${fail} FAILED, ${pass} passed\n` : `\nall ${pass} passed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
