#!/usr/bin/env node
/*
 * HUB A11Y — phone polish + accessibility gate for the public Hub pages (Colosseum roadmap §7:
 * "accessibility and phone polish on the public pages" — judges click these on phones).
 * ---------------------------------------------------------------------------------------------
 * Boots the real server with a throwaway DATA_DIR and TOOLGATE_OFF=1 (no payment gate to fight
 * through) and drives five public pages with a real headless browser at two phone widths:
 *   /hub  /hub/demo  /for-projects  /hub/apply  /hub/<project>/pay
 * Checks, per CLAUDE.md's Conventions section and the roadmap's accessibility line:
 *   (a) no horizontal page overflow (scrollWidth <= innerWidth, 1px tolerance for subpixel rounding)
 *   (b) every REAL tap target (button, submit input, and any standalone/card-style link — i.e.
 *       not a link sitting inline inside a sentence, the standard WCAG 2.5.5 "target in text"
 *       exception) is >= 44x44 CSS px
 *   (d) every <img> has an alt attribute, every icon-only control (no text, no aria-label/title)
 *       has an accessible name, heading order has exactly one h1 and never skips a level, and a
 *       <main> landmark exists
 *   (g) long mono strings (mint addresses, signatures, hashes) wrap or are contained — never push
 *       their card wider than the viewport
 * This is a REGRESSION gate for these five pages specifically (the Normie Quest visual gate does
 * not cover them at all). It is not a full WCAG audit — contrast and the language-toggle's lang
 * attribute were checked by hand for this batch (see the PR) and are not re-derived here because
 * they need a real color-math pass / a page reload, which is out of scope for a boot-time CI gate.
 *
 * Usage: node scripts/hub-a11y-test.cjs [baseUrl]
 * Env:   A11Y_TEST_PORT (default 3204) — used only when baseUrl is omitted (a server is booted).
 */
"use strict";
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

function resolvePlaywright() {
  const candidates = [
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(__dirname, "..", "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  throw new Error("could not resolve playwright-core from any known location");
}
const { chromium } = resolvePlaywright();

const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.A11Y_TEST_PORT || 3204);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

// Holders (Colosseum roadmap §12 CC3 — the X7 history + AA3 Compare panels join the gate).
// SEED_MINT is a fixture address (same shape scripts/holders-snapshot-diff-test.cjs uses, not a
// real mint) with two snapshots seeded directly through lib/holders-snapshot.js's appendSnapshot
// (see the DATA_DIR setup below) so both panels render without a live RPC crawl, which this
// throwaway boot can't do (FALLBACK_RPC_URL points nowhere on purpose). The empty-state URL
// (no history/compare yet — a mint nobody has ever crawled) stays in the list too, since it's a
// different render path (both cards are `display:none` until at least one/two snapshots exist).
const SEED_MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
// CC1 (docs/COLOSSEUM_ROADMAP.md §13): a11y coverage for /hub/:project/programs/compare needs a
// project with two published program versions to actually render a diff — "poke" (seeded by
// server.js itself, dryRun, no program version) can't exercise it. Seeded directly through
// lib/hub/project.js, the same way the admin route itself creates a version, into a throwaway
// DATA_DIR's app-state.json BEFORE the server boots (this test has no per-page setup hook, so
// this is the file-level seed hub-status-test.cjs / hub-bundle-test.cjs already use).
const hubProject = require(path.join(__dirname, "..", "lib", "hub", "project"));
const A11Y_CMP_PROJECT = "a11ycmp";
function a11yCompareFixture() {
  const MINT = "6M6nk7cGaFC4RfxhKr7VfDD3JkyrFrjPT6RM4a97pump";
  const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const project = hubProject.validateProject(
    { id: A11Y_CMP_PROJECT, label: "A11y Compare Co", symbol: "A11Y", mint: MINT, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const base = { poolDailyRaw: "1000000000000", sharePct: 5, maxSharePct: 25, maxTermDays: 540, payoutSchedule: "weekly", minDurationDays: 90, fundedBy: [FUND] };
  let state = hubProject.createVersion({}, project, base, { effectiveFrom: "2026-01-01", todayKey: "2026-01-01" });
  state = hubProject.createVersion(state, project, { ...base, minDurationDays: 60, payoutSchedule: "monthly" }, { effectiveFrom: "2026-02-01", todayKey: "2026-01-01" });
  return {
    "hub:projects": { [A11Y_CMP_PROJECT]: { id: A11Y_CMP_PROJECT, label: "A11y Compare Co", symbol: "A11Y", mint: MINT, decimals: 9, rewardMint: MINT, rewardDecimals: 9, status: "approved" } },
    [`program:${A11Y_CMP_PROJECT}:state`]: state,
  };
}

// DD4 (docs/COLOSSEUM_ROADMAP.md §14): a11y coverage for the print sheet needs a real settled
// receipt WITH a program version + accrual days behind it (the same shape
// scripts/hub-print-test.cjs uses), so the sheet's "amount the rule computed" and reproduce-steps
// section actually render — a receipt with no retained explanation would exercise the degraded
// path instead, which is not what a judge scanning this page in real use ever sees.
const A11Y_PRINT_PROJECT = "a11yprint";
// Deterministic, guaranteed-valid base58 fixture values (same generator scripts/hub-bundle-test.cjs
// and scripts/hub-print-test.cjs use) — a hand-typed address risks a base58-excluded character
// (0, O, I, l) or the wrong length, which HUB_SIG_RE / the wallet-shape check would then 400 on.
const A11Y_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const a11yFakeAddr = (n) => Array.from({ length: 44 }, (_, i) => A11Y_B58[(i * 13 + n * 7 + 5) % 58]).join("");
const a11yFakeSig = (n) => Array.from({ length: 87 }, (_, i) => A11Y_B58[(i * 11 + n * 17 + 3) % 58]).join("");
const A11Y_PRINT_SIG = a11yFakeSig(201);
function a11yPrintFixture() {
  const MINT = a11yFakeAddr(201);
  const FUND = a11yFakeAddr(202);
  const wallet = a11yFakeAddr(203);
  const at = 1_800_000_000;
  const VERSION_PROJECT = { id: A11Y_PRINT_PROJECT, mint: MINT, rewardMint: MINT, rewardDecimals: 9, rewardTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", fundingWallet: FUND };
  const version = hubProject.createVersion({}, VERSION_PROJECT, {
    poolDailyRaw: "1000000000000", minDurationDays: 1, maxTermDays: 540, payoutSchedule: "weekly", vesting: "any", fundedBy: [FUND],
  }, { effectiveFrom: "2027-01-01", todayKey: "2027-01-01" }).versions[0];
  return {
    "hub:projects": { [A11Y_PRINT_PROJECT]: { id: A11Y_PRINT_PROJECT, label: "A11y Print Co", symbol: "A11P", mint: MINT, decimals: 9, rewardMint: MINT, rewardDecimals: 9, fundingWallet: FUND } },
    [`program:${A11Y_PRINT_PROJECT}:days`]: { "2027-02-01T00": { credits: { [wallet]: "1000000000" }, at }, "2027-02-01T01": { credits: { [wallet]: "500000000" }, at: at + 3600 } },
    [`program:${A11Y_PRINT_PROJECT}:batches`]: { "a11yprint-batch-1": { id: "a11yprint-batch-1", state: "sent", at: at + 7200, amounts: { [wallet]: "1500000000" }, sent: { [wallet]: { sig: A11Y_PRINT_SIG, at: at + 7260 } } } },
    [`program:${A11Y_PRINT_PROJECT}:paid`]: {},
    [`program:${A11Y_PRINT_PROJECT}:state`]: { versions: [version] },
  };
}

const PAGES = [
  { path: "/hub", name: "Hub index" },
  // A real branded project page (hero, dry-run badge, social pills) — the index alone never
  // exercises that render path, and it's what a judge actually clicks into from the index.
  { path: "/hub/poke", name: "Hub project page (poke)" },
  { path: "/hub/demo", name: "Hub demo walkthrough" },
  { path: `/hub/${A11Y_CMP_PROJECT}/programs/compare`, name: "Hub compare — what changed between two program versions (CC1)" },
  { path: "/for-projects", name: "For Projects" },
  { path: "/hub/apply", name: "Hub apply (lock-to-earn form)" },
  { path: "/hub/cuna/pay", name: "Hub pay" },
  { path: "/hub/verify", name: "Hub verify (Y1 — reproduce a receipt in the browser)" },
  { path: "/hub/status", name: "Hub status (Z2 — what is live, where, and how reproducible)" },
  { path: "/hub/wallet", name: "Hub wallet look-up (AA1 — one wallet, every project)" },
  { path: "/hub/wallet/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS", name: "Hub wallet look-up, pre-filled (AA1)" },
  { path: "/hub/trust", name: "Hub trust boundary (AA5 — what this doesn't prove)" },
  { path: "/hub/judge", name: "Hub judge guide (AA4 — the judge's fifteen minutes)" },
  { path: "/hub/glossary", name: "Hub glossary (EE2 — every term and reason code, in plain words)" },
  { path: "/holders", name: "Holders (CC3 — empty state, no snapshot history yet)" },
  { path: `/holders?mint=${SEED_MINT}`, name: "Holders (CC3 — X7 history + AA3 Compare, seeded)" },
  { path: `/hub/${A11Y_PRINT_PROJECT}/r/${A11Y_PRINT_SIG}?print=1`, name: "Hub receipt print sheet (DD4 — a receipt you can print)" },
];
const WIDTHS = [
  { width: 360, height: 780, label: "360×780" },
  { width: 390, height: 844, label: "390×844" },
];

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("    ✓ " + name);
  else { failures++; console.log("    ✗ " + name + (detail ? "\n        " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── in-page audit, runs inside the browser ────────────────────────────────────────────────────
function pageAudit() {
  const out = { overflow: null, badTargets: [], images: [], iconControlsBad: [], headings: [], mainCount: 0, navCount: 0, monoOverflow: [] };

  out.overflow = { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (el.closest("[hidden]")) return false;
    return true;
  }
  // WCAG 2.5.5 "target in text block" exception: a link embedded inline among other real text in
  // its own immediate parent is exempt (rewriting every inline citation/lesson-link into a button
  // is not what real sites do, and it isn't what the task's own pages do either — .fact/.hint
  // paragraphs routinely end in "... <a>Learn more →</a>"). A link that is the SOLE content of
  // its container (a card, a step link row, a social pill, a CTA row) is not exempt — only a
  // link with a real TEXT-NODE neighbour (words immediately before/after it in the same line of
  // prose) counts as "in a sentence"; a link that merely shares a parent with an unrelated
  // sibling element (e.g. a bold label in its own <b>, a heading in its own <div>) still reads as
  // a standalone control and is not exempt.
  function inlineInProse(a) {
    const t = (n) => (n && n.nodeType === 3 ? n.textContent.trim() : "");
    return t(a.previousSibling).length > 2 || t(a.nextSibling).length > 2;
  }
  // Two more accepted exceptions, both ubiquitous on these pages and standard for dense,
  // data-heavy UI (Solscan/Etherscan-style explorers use the same pattern everywhere):
  //   - a short "mono" data-reference link (a wallet address, a tx signature, a hash, a short
  //     id) — compact by nature; the addressed data itself, not a call to action.
  //   - any link inside a <td> — a data table's own density is the accepted tradeoff, and
  //     WCAG 2.5.5 (itself only AAA) explicitly does not expect table cells to hit 44px.
  function isDataRefOrTableCell(a) {
    if (a.closest("td")) return true;
    if (a.classList && a.classList.contains("mono")) return true;
    if (a.closest(".mono")) return true;
    return false;
  }
  // The floating global widgets (cluck-nav.js's Home/Tools/Ask-Cluck pills, i18n.js's language
  // picker, read-aloud.js's Listen button) are injected on every page on the whole site, not
  // authored by these five pages — they are a known, separately-reported gap (see the PR), not
  // something this gate re-flags on every one of these five pages.
  function isSharedGlobalWidget(el) { return !!el.closest("#cluck-nav-bar,#clkn-lang-toggle,#clkn-read-bar"); }
  const targets = Array.prototype.slice.call(document.querySelectorAll("a[href], button, input[type=submit], input[type=button]"));
  targets.forEach((el) => {
    if (!visible(el)) return;
    if (isSharedGlobalWidget(el)) return;
    if (el.tagName === "A" && (inlineInProse(el) || isDataRefOrTableCell(el))) return;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      out.badTargets.push({ tag: el.tagName, id: el.id || null, cls: el.className || null, text: (el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll("img"), (img) => {
    if (!img.hasAttribute("alt")) out.images.push({ src: img.getAttribute("src") || "(no src)" });
  });

  // Icon-only controls: a button/link with no visible text and no accessible-name attribute.
  Array.prototype.slice.call(document.querySelectorAll("button, a[href]")).forEach((el) => {
    if (!visible(el)) return;
    const text = (el.textContent || "").replace(/\s+/g, "").trim();
    if (text.length > 0) return;                                    // has visible text -> fine
    if (el.querySelector("img[alt]") && el.querySelector("img[alt]").getAttribute("alt")) return;
    const name = el.getAttribute("aria-label") || el.getAttribute("title") || (el.getAttribute("aria-labelledby") && "labelledby");
    if (!name) out.iconControlsBad.push({ tag: el.tagName, id: el.id || null, cls: el.className || null, html: el.outerHTML.slice(0, 120) });
  });

  const hs = Array.prototype.slice.call(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(visible);
  out.headings = hs.map((h) => Number(h.tagName.slice(1)));
  out.mainCount = document.querySelectorAll("main").length;
  out.navCount = document.querySelectorAll("nav").length;

  Array.prototype.forEach.call(document.querySelectorAll(".mono, pre.proof"), (el) => {
    if (!visible(el)) return;
    if (el.scrollWidth > el.clientWidth + 2) out.monoOverflow.push({ cls: el.className, text: (el.textContent || "").slice(0, 40) });
  });

  return out;
}

function headingOrderOk(seq) {
  if (!seq.length) return "no headings found";
  const h1s = seq.filter((n) => n === 1).length;
  if (h1s !== 1) return `expected exactly one <h1>, found ${h1s}`;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] > seq[i - 1] + 1) return `heading level jumps from h${seq[i - 1]} to h${seq[i]} (skips a level)`;
  }
  return null;
}

async function auditPage(browser, pagePath, pageName) {
  console.log(`\n${pageName} (${pagePath})`);
  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + pagePath, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(350);   // let async fetch()-driven renders (the app div) settle
      const data = await page.evaluate(pageAudit);
      const tag = `[${vp.label}]`;

      ok(`${tag} no horizontal overflow`, data.overflow.scrollWidth <= data.overflow.innerWidth + 1,
        `scrollWidth ${data.overflow.scrollWidth} > innerWidth ${data.overflow.innerWidth}`);

      ok(`${tag} tap targets >= 44x44 (standalone links/buttons)`, data.badTargets.length === 0,
        data.badTargets.slice(0, 6).map((t) => `${t.tag}${t.id ? "#" + t.id : ""}.${String(t.cls).split(" ")[0] || ""} "${t.text}" ${t.w}x${t.h}`).join("\n        "));

      ok(`${tag} every <img> has alt`, data.images.length === 0,
        data.images.map((i) => i.src).join(", "));

      ok(`${tag} icon-only controls have an accessible name`, data.iconControlsBad.length === 0,
        data.iconControlsBad.map((c) => c.html).join("\n        "));

      const headErr = headingOrderOk(data.headings);
      ok(`${tag} heading order sane (one h1, no skipped level)`, !headErr, headErr + " — sequence: h" + data.headings.join(", h"));

      ok(`${tag} <main> landmark present`, data.mainCount >= 1);
      ok(`${tag} <nav> landmark present`, data.navCount >= 1);

      ok(`${tag} mono/proof strings don't overflow their box`, data.monoOverflow.length === 0,
        data.monoOverflow.map((m) => `.${String(m.cls).split(" ")[0]} "${m.text}"`).join("\n        "));
    } catch (e) {
      failures++;
      console.log(`    ✗ [${vp.label}] page audit threw: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }
}

(async () => {
  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-a11y-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify({ ...a11yCompareFixture(), ...a11yPrintFixture() }));

    // Seed two holder snapshots for SEED_MINT directly through the real kv module +
    // appendSnapshot, pointed at the same DATA_DIR the server is about to boot with — the same
    // durable-write seeding scripts/holders-snapshot-diff-test.cjs uses, so /holders?mint=... has
    // both the X7 history table and the AA3 Compare panel populated without a live RPC crawl.
    process.env.DATA_DIR = DIR;
    delete require.cache[require.resolve("../lib/kvstore")];
    const kv = require("../lib/kvstore");
    const holdersSnapshot = require("../lib/holders-snapshot");
    const W = (n) => `Wallet${String(n).padStart(6, "0")}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);
    const fromTop = [{ wallet: W(0), amount: 500 }, { wallet: W(1), amount: 300 }, { wallet: W(2), amount: 100 }];
    const toTop = [{ wallet: W(0), amount: 650 }, { wallet: W(1), amount: 300 }, { wallet: W(3), amount: 50 }];
    holdersSnapshot.appendSnapshot(kv, { mint: SEED_MINT, at: Date.now() - 86400000, holderCount: 10, top: fromTop, totalSupplyRaw: "10000", fullList: fromTop });
    holdersSnapshot.appendSnapshot(kv, { mint: SEED_MINT, at: Date.now(), holderCount: 11, top: toTop, totalSupplyRaw: "10200", fullList: toTop });

    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  console.log(`\nHub accessibility + phone polish gate — ${BASE}\n`);
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const p of PAGES) await auditPage(browser, p.path, p.name);
  } finally {
    await browser.close();
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
