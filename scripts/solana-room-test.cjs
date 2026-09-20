#!/usr/bin/env node
"use strict";
// The Solana Room (CLAUDE.md) — a public, no-wallet reference room on how Solana actually works.
// Ships the room shell (/solana) plus ten full pages in two groups.
//
//   THE MECHANICS (tier 1) — how the machine works: /solana/rent ("The deposit you didn't know
//   you made"), /solana/wallet, /solana/mint, /solana/buying, /solana/transfers, /solana/fees.
//   THE BIGGER PICTURE (tier 2) — /solana/uses (what the chain is actually used for),
//   /solana/markets (what you actually own on an exchange vs. self-custody vs. a fund),
//   /solana/events (where the ecosystem meets, and the fake-event scams), /solana/links (the
//   safe copy of the domains people get phished on).
//
// Boots the REAL server with a throwaway DATA_DIR on a no-build boot (no `npm run build` has
// run — CLAUDE.md: public/ is only served through the vite build's copy in dist/, so every page
// needs its own explicit app.get route or they 404 here) and asserts:
//
//   (a) every route (the room + ten topic pages) serves 200 on a no-build boot;
//   (b) the room page's two topic arrays point at all ten pages, and both section titles render;
//   (c) the rent page carries a distinct scam-warning block and the "not an airdrop" statement;
//   (d) every literal string passed to a page's own t() i18n helper, on ANY page, exists in all
//       six curated dictionaries (public/i18n/<lang>.json) — extracted the same way
//       scripts/i18n-audit.cjs's Hub-pages gate does (a literal string immediately inside a
//       t(...)/tf(...) call, scoped to <script> blocks);
//   (e) no forbidden word/phrase, TIERED. FORBIDDEN_ALL (yield/APR/APY framing, Normie Quest,
//       Wallet Watch, Nomadz, the Solana Foundation) and FORBIDDEN_ADVICE (the phrasings that
//       turn an explanation into a recommendation) apply to every page. The ETF ban applies to
//       every page EXCEPT /solana/markets, whose subject it is — and that carve-out is pinned to
//       that one route so it cannot silently widen;
//   (f) the mint page's two example mint addresses (the real SKR mint and its impersonator)
//       appear byte-for-byte exactly as given — a typo'd address on a page about impersonation
//       would be its own disaster;
//   (g) the buying, transfers and fees pages each carry their required content blocks and cite
//       solana.com for their factual claims;
//   (h) every tier-2 page is DATED AND OWNED — it carries its "last checked" date and who
//       maintains it, and every external link on it is rel="noopener noreferrer". Tier 2
//       describes things that go stale (which products exist, when an event is, whether a domain
//       is still official); saying when it was last checked is what makes that honest.
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

// Every page in the room, in the order the room index lists them. THE MECHANICS (tier 1) is how
// the machine works; THE BIGGER PICTURE (tier 2) is what it is used for, what you actually own,
// where the ecosystem meets, and the safe copy of the domains people get phished on. Tier 2
// pages describe things that can go stale, so each one carries its own dated ownership line —
// asserted in (h) below.
const MECHANICS_PAGES = [
  { route: "/solana/rent", file: "solana-rent.html" },
  { route: "/solana/wallet", file: "solana-wallet.html" },
  { route: "/solana/mint", file: "solana-mint.html" },
  { route: "/solana/buying", file: "solana-buying.html" },
  { route: "/solana/transfers", file: "solana-transfers.html" },
  { route: "/solana/fees", file: "solana-fees.html" },
];
const BIGGER_PICTURE_PAGES = [
  { route: "/solana/uses", file: "solana-uses.html" },
  { route: "/solana/markets", file: "solana-markets.html" },
  { route: "/solana/events", file: "solana-events.html" },
  { route: "/solana/links", file: "solana-links.html" },
  { route: "/solana/phone", file: "solana-phone.html" },
];
const TOPIC_PAGES = MECHANICS_PAGES.concat(BIGGER_PICTURE_PAGES);
const ALL_PAGES = [{ route: "/solana", file: "solana-room.html" }].concat(TOPIC_PAGES);
const PAGE_FILES = ALL_PAGES.map((p) => p.file);
// The dated ownership line every tier-2 page must carry — "dated and owned" is the whole reason
// these four are allowed to state things that change (owner's scope line for tier 2).
// Each tier-2 page states the date IT was last checked, which is not one shared constant — the
// phone page was written a day after the other four and says so. What matters is that every one
// of them carries a real date and the same owner line, so the date is per-route.
const TIER2_DATE_BY_ROUTE = {
  "/solana/uses": "Last checked 19 September 2026",
  "/solana/markets": "Last checked 19 September 2026",
  "/solana/events": "Last checked 19 September 2026",
  "/solana/links": "Last checked 19 September 2026",
  "/solana/phone": "Last checked 20 September 2026",
};
const TIER2_OWNER_LINE = "maintained by Cluck Norris";
const LANGS = ["es", "hi", "it", "pt", "vi", "zh"];

// The mint page's real, verifiable example (task brief, verified against docs/SEEKER_APP_PLAN.md
// §7): the official SKR mint (Jupiter-verified, ~45.8k holders) and the impersonator mint that a
// plain web search surfaced first (unverified, 4 holders, no market cap). Exact-match, not a
// substring/case-insensitive check — a single swapped character here would defeat the page's
// entire point.
const SKR_REAL_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const SKR_FAKE_MINT = "79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj";

// FORBIDDEN_ALL — applies to EVERY page in the room, tier 1 and tier 2 alike. No yield/APR/APY
// framing (CLAUDE.md: "Earn" describes capability, never a promise), nothing about Normie Quest
// reward terms, never mention Wallet Watch (it is private — CLAUDE.md), no Nomadz, nothing about
// the Solana Foundation. "airdrop" and "free" are NOT forbidden — the rent page legitimately uses
// both to REFUTE the "claim your free SOL" framing ("It is not an airdrop").
const FORBIDDEN_ALL = [
  { name: "yield", re: /\byield\b/i },
  { name: "APR", re: /\bapr\b/i },
  { name: "APY", re: /\bapy\b/i },
  { name: "guaranteed", re: /\bguaranteed\b/i },
  { name: "Normie Quest", re: /normie\s*quest/i },
  { name: "Wallet Watch", re: /wallet\s*watch/i },
  { name: "Nomadz", re: /nomadz/i },
  { name: "Solana Foundation", re: /solana\s*foundation/i },
];

// FORBIDDEN_TIER1 — the mechanics pages explain how the machine works and have no business
// discussing investment products; the ETF ban was written as a scope limit for THAT tier and
// stays exactly as strict there. /solana/markets is the one page whose whole subject is what you
// actually own in each case, so it is allowed the word — and pays for it with the much harder
// advice ban below, which applies everywhere.
const FORBIDDEN_TIER1 = [
  { name: "ETF", re: /\betfs?\b/i },
];

// FORBIDDEN_ADVICE — applies to EVERY page. These are the phrasings that turn an explanation
// into a recommendation. Deliberately positive-form only: "not financial advice" contains the
// words "financial advice", and that disclaimer is a line we WANT on the markets page.
const FORBIDDEN_ADVICE = [
  { name: "good investment", re: /\bgood investment\b/i },
  // "worth buying" is DELIBERATELY not here. This school uses it constantly in the negative —
  // "this isn't a claim that either mint is worth buying", "being swappable says nothing about
  // being worth buying" — and a substring rule cannot tell the refutation from the claim. Same
  // trap as "not financial advice" containing "financial advice". The six patterns that remain
  // have no honest negative use on these pages.
  { name: "you should buy", re: /\byou should (?:buy|sell|hold|invest)\b/i },
  { name: "we recommend", re: /\bwe recommend\b/i },
  { name: "price target", re: /\bprice target\b/i },
  { name: "to the moon", re: /\bto the moon\b/i },
  { name: "will go up", re: /\bwill (?:go|head|be) (?:up|higher|down|lower)\b/i },
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

  // ── (a) every route serves 200 on a no-build boot ───────────────────────────────────────────
  console.log(`(a) all ${ALL_PAGES.length} routes serve 200 on a no-build boot\n`);
  const body = {};   // route -> served HTML
  for (const page of ALL_PAGES) {
    const r = await fetch(`${BASE}${page.route}`);
    ok(`GET ${page.route} -> 200`, r.status === 200, "got " + r.status);
    body[page.route] = await r.text();
    ok(`GET ${page.route} body is non-trivial HTML`, body[page.route].length > 500 && /<html/i.test(body[page.route]));
  }
  const roomText = body["/solana"], rentText = body["/solana/rent"], walletText = body["/solana/wallet"],
        mintText = body["/solana/mint"], buyingText = body["/solana/buying"],
        transfersText = body["/solana/transfers"], feesText = body["/solana/fees"];

  // ── (b) the room links to every topic page ──────────────────────────────────────────────────
  // The room page renders its cards from two arrays (MECHANICS and BIGGER_PICTURE — each entry's
  // `href` field feeds the anchor at render time), so the literal attribute text
  // `href="/solana/rent"` never appears in the unrendered source the way a hand-written anchor
  // would. This checks the arrays' own href fields, which is what actually drives the link.
  console.log(`\n(b) the room page links to all ${TOPIC_PAGES.length} topic pages\n`);
  for (const page of TOPIC_PAGES) {
    ok(`room page points at ${page.route}`, new RegExp("href:\\s*['\"]" + page.route + "['\"]").test(roomText));
  }
  // The two section headings are passed to the local section() helper, which runs them through
  // t() itself — so the literal sits inside section(...), not inside t(...). Both spellings are
  // pinned: the call that renders them, and their presence in __solanaRoomGatedStrings() so the
  // regex-based i18n gates can see them at all (they are invisible to a t()-literal scan).
  ok("room page renders both sections (The mechanics / The bigger picture)",
    /section\(['"]The mechanics['"]/.test(roomText) && /section\(['"]The bigger picture['"]/.test(roomText));
  ok("both section headings are listed in __solanaRoomGatedStrings so the i18n gate sees them",
    /t\(['"]The mechanics['"]\)/.test(roomText) && /t\(['"]The bigger picture['"]\)/.test(roomText));

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

  // ── the room page's two topic arrays, parsed from source ────────────────────────────────────
  // Parses the arrays directly (MECHANICS / BIGGER_PICTURE / COMING_NEXT) rather than eyeballing
  // string position, so this can't be fooled by an unrelated literal occurring earlier in the
  // file — it checks which ARRAY each topic's title literal actually sits inside. A tier-2 title
  // sitting in MECHANICS (or vice versa) would render the room under the wrong heading.
  console.log("\nthe room page's two topic arrays hold the right topics; COMING_NEXT is empty\n");
  {
    const grab = (name) => (new RegExp("var " + name + " = \\[([\\s\\S]*?)\\n\\s*\\];").exec(roomText) || [])[1] || "";
    const mechBlock = grab("MECHANICS"), bigBlock = grab("BIGGER_PICTURE");
    const comingBlock = (/var COMING_NEXT = (\[[\s\S]*?\]);/.exec(roomText) || [])[1] || "";
    ok("room page source has a parseable MECHANICS array", mechBlock.length > 0);
    ok("room page source has a parseable BIGGER_PICTURE array", bigBlock.length > 0);
    ok("room page source has a parseable COMING_NEXT array", comingBlock.length > 0);
    for (const title of ["The deposit you didn't know you made", "What your wallet actually holds",
      "What a token mint is", "What actually happens when you buy",
      "Sending tokens, and why the first one costs extra", "What a transaction actually costs"]) {
      ok(`"${title}" is in MECHANICS, and not in BIGGER_PICTURE`, mechBlock.includes(title) && !bigBlock.includes(title));
    }
    for (const title of ["What Solana is actually used for", "Buying SOL, ETFs, and what you actually own",
      "Where the Solana world actually meets", "Where to look things up",
      "The Solana phone, and what it actually changes"]) {
      ok(`"${title}" is in BIGGER_PICTURE, and not in MECHANICS`, bigBlock.includes(title) && !mechBlock.includes(title));
    }
    ok("six topics in MECHANICS", (mechBlock.match(/title:/g) || []).length === 6, "found " + (mechBlock.match(/title:/g) || []).length);
    ok("five topics in BIGGER_PICTURE", (bigBlock.match(/title:/g) || []).length === 5, "found " + (bigBlock.match(/title:/g) || []).length);
    ok("COMING_NEXT is now an empty array", /^\[\s*\]$/.test(comingBlock.trim()), "got " + JSON.stringify(comingBlock.trim().slice(0, 60)));
  }
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

  // ── (e) no forbidden word/phrase, tiered ────────────────────────────────────────────────────
  console.log("\n(e) no forbidden word or phrase\n");
  for (const page of ALL_PAGES) {
    const text = body[page.route];
    // The ETF ban skips the tier-2 pages and the room index; the index gets its own narrower
    // check just below (every hit must sit inside the markets entry's title), and /solana/markets
    // is the carve-out by definition.
    const etfExempt = BIGGER_PICTURE_PAGES.some((x) => x.route === page.route) || page.route === "/solana";
    const rules = FORBIDDEN_ALL.concat(FORBIDDEN_ADVICE).concat(etfExempt ? [] : FORBIDDEN_TIER1);
    for (const { name, re } of rules) {
      const m = text.match(re);
      ok(`${page.route}: no "${name}"`, !m, m ? "found near: " + text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
    }
  }
  // ETF stays banned everywhere EXCEPT the one page whose subject it is — pinned explicitly so
  // the carve-out can never silently widen to the other three tier-2 pages.
  // The room INDEX has to be able to name the page it links to ("Buying SOL, ETFs, and what you
  // actually own"), so its occurrences are allowed — but only inside that one entry, checked
  // below, never loose in the index's own copy.
  {
    const idx = body["/solana"];
    const hits = [...idx.matchAll(/\betfs?\b/gi)];
    const allInTitle = hits.every((m) => /Buying SOL, ETFs, and what you actually own/.test(idx.slice(Math.max(0, m.index - 60), m.index + 60)));
    ok(`/solana: every "ETF" on the index sits inside the markets entry's own title (${hits.length} found)`, hits.length > 0 && allInTitle);
  }
  for (const page of BIGGER_PICTURE_PAGES.filter((x) => x.route !== "/solana/markets")) {
    const m = body[page.route].match(/\betfs?\b/i);
    ok(`${page.route}: no "ETF" (the carve-out is /solana/markets only)`, !m,
      m ? "found near: " + body[page.route].slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ") : "");
  }

  // ── (h) tier 2 is dated and owned ───────────────────────────────────────────────────────────
  // The four bigger-picture pages describe things that go stale — which products exist, when an
  // event is, whether a domain is still the official one. That is only honest if the page says
  // when it was last checked and who maintains it, on the page, where the reader sees it.
  console.log("\n(h) every tier-2 page is dated and owned\n");
  for (const page of BIGGER_PICTURE_PAGES) {
    const text = body[page.route];
    const expectedDate = TIER2_DATE_BY_ROUTE[page.route];
    ok(`${page.route}: has an expected "last checked" date in the test's own table`, !!expectedDate,
      "add this route to TIER2_DATE_BY_ROUTE when you add a tier-2 page");
    ok(`${page.route}: carries "${expectedDate}"`, !!expectedDate && text.includes(expectedDate));
    ok(`${page.route}: carries "${TIER2_OWNER_LINE}"`, text.includes(TIER2_OWNER_LINE));
    // Anchors on these pages are built inside JS template strings, so scan for the attribute
    // itself rather than for a parsed <a> element: every target="_blank" must be immediately
    // followed by rel="noopener noreferrer". A bare target="_blank" hands the opened page a
    // live window.opener back into ours.
    const blanks = [...text.matchAll(/target=["']_blank["']([\s\S]{0,60})/gi)];
    ok(`${page.route}: every target="_blank" carries rel="noopener noreferrer" (${blanks.length} found)`,
      blanks.length > 0 && blanks.every((m) => /rel=["']noopener noreferrer["']/.test(m[1])),
      blanks.length === 0 ? "no external link found at all" : "a target=\"_blank\" without rel=\"noopener noreferrer\"");
  }

  // ── (i) each tier-2 page carries the blocks it exists for ───────────────────────────────────
  // Named blocks, not prose matches: the copy will be reworded, the promise the page makes will
  // not. Every one of these is a thing the owner's scope line for tier 2 asked for.
  console.log("\n(i) each tier-2 page carries the blocks it exists for\n");
  const REQUIRED_SECTIONS = {
    "/solana/uses": ["honest-answer", "stablecoins", "nfts", "depin", "mobile", "tradeoffs", "outage-history"],
    "/solana/markets": ["on-exchange", "self-custody", "fund-etf", "comparison-table", "institutional-interest"],
    "/solana/events": ["why-it-matters", "conferences", "hackathons", "meetups", "scam-fake-ticket",
                       "scam-cloned-site", "scam-livestream-airdrop", "scam-speaker-dm", "scam-qr-code",
                       "scam-support-dm", "scam-golden-rule", "not-affiliated"],
    "/solana/links": ["safety-rule", "cant-tell-you"],
    "/solana/phone": ["what-it-is", "seed-vault", "mwa", "dapp-store", "skr", "skr-impersonator",
                      "what-it-doesnt-fix", "disclosure"],
  };
  for (const [route, sections] of Object.entries(REQUIRED_SECTIONS)) {
    const missing = sections.filter((id) => !new RegExp('data-section="' + id + '"').test(body[route]));
    ok(`${route}: all ${sections.length} required blocks present`, missing.length === 0, missing.join(", "));
  }
  // The three load-bearing promises, in the page's own words. Each one is the reason its page is
  // allowed to exist at all, so each is pinned to the literal sentence.
  ok("/solana/markets opens by refusing to tell anyone what to buy",
    /does\s*n[o']t tell you what to buy/i.test(body["/solana/markets"]));
  ok("/solana/markets carries an explicit not-investment-advice line",
    /(?:nothing|not)[^.]{0,60}(?:investment|financial) advice/i.test(body["/solana/markets"]));
  ok("/solana/events states we run none of these events and are not affiliated",
    /not affiliated/i.test(body["/solana/events"]) && /does not (?:organize|organise|host|sponsor|run)/i.test(body["/solana/events"]));
  ok("/solana/events discloses our own entry in the hackathon it names",
    /Full disclosure/i.test(body["/solana/events"]) && /Cluck Norris is entered/i.test(body["/solana/events"]));
  ok("/solana/links leads with type-it-yourself before any link",
    body["/solana/links"].indexOf('data-section="safety-rule"') < body["/solana/links"].indexOf('data-section="cant-tell-you"'));
  // The phone page names two live mint addresses and asks the reader to tell them apart. A typo in
  // either is the single worst defect this page could ship — the same reason the mint page's two
  // addresses are pinned byte-for-byte in (f). Same treatment here.
  ok("/solana/phone carries the REAL SKR mint byte-for-byte", body["/solana/phone"].includes(SKR_REAL_MINT));
  ok("/solana/phone carries the impersonator mint byte-for-byte", body["/solana/phone"].includes(SKR_FAKE_MINT));
  ok("/solana/phone states outright that it carries no price and no market cap",
    /no price and no market cap/i.test(body["/solana/phone"]));
  ok("/solana/phone discloses that we publish on that store and are entered in a Solana Mobile hackathon",
    /publish/i.test(body["/solana/phone"]) && /hackathon/i.test(body["/solana/phone"]));
  ok("/solana/phone says the hardware protects the key but not the decision",
    /protect the key/i.test(body["/solana/phone"]) && /decision you make/i.test(body["/solana/phone"]));
  ok("/solana/uses states plainly that most activity is trading/speculation",
    /(?:trading|specul)/i.test(body["/solana/uses"]));


  // ── (j) the back-to-the-room link is actually VISIBLE ───────────────────────────────────────
  // This exists because the link was present, correct and INVISIBLE for the whole life of the
  // room. public/cluck-nav.js injects a fixed nav bar on every deep page and, with it, a rule
  // hiding the page's own back link as redundant — written when every such link said "← HOME".
  // The Solana Room's links say "← THE SOLANA ROOM" and point at /solana, and the Project Hub's
  // say "← PROJECT HUB": 23 section-level back links across public/ rendered at height 0 with
  // nothing reporting it. A source scan alone cannot catch this (the markup is perfect) and a
  // rendered check alone cannot explain it, so this checks BOTH — AGENTS.md, "rendered
  // measurement and source scanning have complementary blind spots. Run both."
  console.log("\n(j) the back-to-the-room link is present in source AND visible when rendered\n");
  {
    const nav = fs.readFileSync(path.join(ROOT, "public", "cluck-nav.js"), "utf8");
    ok("cluck-nav.js no longer hides back links by class alone", !/a\.back\s*,\s*a\.back-home\s*,\s*a\.home\s*\{/.test(nav));
    ok("cluck-nav.js scopes its hide rule to links that actually point home", /a\.back-home\[href='\/'\]/.test(nav));
    for (const page of TOPIC_PAGES) {
      ok(`${page.route}: its top back link points at /solana`, /<a class="back-home" href="\/solana"/.test(body[page.route]));
    }
  }
  {
    const pw = resolvePlaywright();
    if (!pw) {
      console.log("  · playwright(-core) not resolvable — skipping the rendered visibility check (everything above still ran)");
    } else {
      const browser = await pw.chromium.launch(PW_LAUNCH);
      try {
        for (const route of ["/solana/rent", "/solana/markets"]) {
          const pg = await browser.newPage({ viewport: { width: 390, height: 780 } });
          await pg.goto(BASE + route, { waitUntil: "domcontentloaded" });
          await pg.waitForTimeout(1500);   // cluck-nav.js injects its bar and CSS on load
          const seen = await pg.evaluate(() => {
            const a = document.querySelector("a.back-home");
            if (!a) return { missing: true };
            const r = a.getBoundingClientRect();
            return { href: a.getAttribute("href"), height: Math.round(r.height), text: a.textContent.trim() };
          });
          await pg.close();
          ok(`${route}: the back link RENDERS with real height (not hidden by the nav bar)`,
            !seen.missing && seen.height > 0 && seen.href === "/solana", JSON.stringify(seen));
        }
      } finally { await browser.close(); }
    }
  }

  console.log(fail ? `\n${fail} FAILED, ${pass} passed\n` : `\nall ${pass} passed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });


// Playwright is optional here, exactly as in scripts/seeker-build-test.cjs: the node-check job is
// zero-dependency, so the rendered half of (j) skips gracefully rather than failing a runner that
// has no browser. The chromium binary lives at PLAYWRIGHT_BROWSERS_PATH in this environment.
const PW_LAUNCH = fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {};
function resolvePlaywright() {
  const candidates = [
    "playwright", "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright"),
    path.join(__dirname, "..", "node_modules", "playwright-core"),
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  return null;
}
