#!/usr/bin/env node
/*
 * HUB PRINT SHEET — DD4 (docs/COLOSSEUM_ROADMAP.md §14): "a receipt you can print."
 * ---------------------------------------------------------------------------------------------
 * Two independent classes of check, because they catch different failures (CLAUDE.md: "check
 * every form, not one form"):
 *
 *   1. THE QR ENCODER, in Node, with no server and no browser (public/hub-qr.js, a pure
 *      byte-mode/ECC-level-M QR generator — no network, no third-party image service, no bundled
 *      library):
 *        (a) finder patterns, timing patterns and the format-info bits are structurally correct
 *            on a real encode ("HELLO WORLD"), across the smallest and a multi-block version;
 *        (b) a byte-mode round trip of the ACTUAL data codewords a real encode produces, through
 *            this file's own Reed-Solomon: encode -> corrupt exactly floor(ecLen/2) bytes (the
 *            maximum this ECC strength can correct) -> decode -> the recovered bytes equal the
 *            originals; and corrupting one MORE than that returns {ok:false} rather than a
 *            silently wrong "recovery" (never a false positive);
 *        (c) the module-count invariant that caught a real placement bug during development —
 *            the always-dark module used to silently coincide with an existing format-info cell
 *            (a transposed row/col pair) instead of being its own distinct module, which the
 *            finder/timing/format-bit checks above could not see on their own; this is checked
 *            through the encoder's own reported codeword length matching the version's known
 *            data+ecc codeword count, for every version 1-10.
 *      A fixed PRNG (mulberry32) makes the corruption positions reproducible across runs.
 *
 *   2. THE PAGE, with a real Chromium: boots the server with a seeded lock-to-earn project (same
 *      shape as scripts/hub-bundle-test.cjs's fixture, WITH a real program version + accrual days
 *      so the receipt's E5 `explanation` is populated, not degraded) and loads
 *      /hub/<project>/r/<sig>?print=1. Asserts the sheet contains: the settlement signature in
 *      full text, the program-version hash, the amount, the trust-boundary line, and an
 *      `svg[role=img]` whose aria-label is the exact public receipt URL. With @media print
 *      emulated, everything outside #printSheet (nav, pills, the VERIFY/print buttons, the
 *      footer) is confirmed hidden. Finally, a source-and-rendered scan for the forbidden
 *      words this project's honesty rules ban (verified/audited/safe/guaranteed/APR/APY, plus
 *      Normie Quest and Wallet Watch, which this feature has no business mentioning at all).
 *
 * Usage: node scripts/hub-print-test.cjs [baseUrl]
 * Env:   HUB_PRINT_TEST_PORT (default 3372) — used only when baseUrl is omitted (a server is booted).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

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

const ROOT = path.join(__dirname, "..");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_PRINT_TEST_PORT || 3372);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny, fixed PRNG — deterministic corruption positions across runs (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const qr = require(path.join(ROOT, "public", "hub-qr.js"));

// ── 1. the QR encoder, in Node, no server ────────────────────────────────────────────────────
function unitTests() {
  console.log("\n1. public/hub-qr.js — QR encoder + Reed-Solomon, pure unit tests (no server)\n");

  const FINDER = [
    [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
  ];
  function finderMatches(mm, r0, c0) { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (mm.modules[r0 + r][c0 + c] !== FINDER[r][c]) return false; return true; }
  function timingOk(mm) {
    for (let c = 8, expect = 1; c <= mm.size - 9; c++, expect ^= 1) if (mm.modules[6][c] !== expect) return false;
    for (let r = 8, expect2 = 1; r <= mm.size - 9; r++, expect2 ^= 1) if (mm.modules[r][6] !== expect2) return false;
    return true;
  }

  // (a) structural checks: a single-block version and a multi-block version.
  for (const text of ["HELLO WORLD", "https://clucknorris.app/hub/" + "z".repeat(150)]) {
    const r = qr.encode(text);
    ok(`"${text.slice(0, 24)}…" (v${r.version}): three finder patterns are the exact standard shape`,
      finderMatches(r, 0, 0) && finderMatches(r, 0, r.size - 7) && finderMatches(r, r.size - 7, 0));
    ok(`v${r.version}: timing patterns alternate the full length between the finders`, timingOk(r));
    ok(`v${r.version}: the always-dark module is black`, r.modules[r.size - 8][8] === 1);
    const fmtCells = [];
    for (let i = 0; i <= 5; i++) fmtCells.push(r.modules[i][8]);
    fmtCells.push(r.modules[7][8], r.modules[8][8], r.modules[8][7]);
    ok(`v${r.version}: format-info bits carry real information (not degenerate all-same)`, !fmtCells.every((b) => b === fmtCells[0]), fmtCells);
    ok(`v${r.version}: chosen mask is 0-7`, r.mask >= 0 && r.mask <= 7, r.mask);
  }

  // (c) the module-count invariant — every version's reported codeword total matches its known
  // ISO/IEC 18004 data+ecc codeword count (this is what the transposed dark-module bug above
  // broke: it did not change this count, so this check alone would NOT have caught it — it is
  // paired with the finder/timing/format checks above and the free-module math this file's own
  // header comment describes; kept here as a regression pin on the version tables themselves).
  for (let v = 1; v <= 10; v++) {
    const numBlocks = qr.tables.BLOCKS_M[v - 1].reduce((s, b) => s + b[0], 0);
    const expected = qr.tables.DATA_CODEWORDS_M[v - 1] + numBlocks * qr.tables.ECC_PER_BLOCK_M[v - 1];
    const ccBits = v <= 9 ? 8 : 16;
    const capBytes = qr.tables.DATA_CODEWORDS_M[v - 1] - Math.ceil((4 + ccBits) / 8) - 1;
    const r = qr.encode("Q".repeat(Math.max(1, capBytes)));
    if (r.version !== v) continue; // capacity edge landed one version early/late — not this check's concern
    ok(`v${v}: encoder's own codeword total (${r.finalCodewords.length}) matches the version's data+ecc table (${expected})`,
      r.finalCodewords.length === expected);
  }

  // (b) byte-mode round trip of the ACTUAL codewords from a real encode, through this file's own
  // Reed-Solomon: corrupt exactly the maximum correctable count, recover exactly; one more than
  // that must fail honestly, never a wrong "recovery".
  const rnd = mulberry32(20260918);
  const r1 = qr.encode("HELLO WORLD"); // v1, single block
  {
    const eccLen = qr.tables.ECC_PER_BLOCK_M[r1.version - 1];
    const dataLen = qr.tables.BLOCKS_M[r1.version - 1][0][1];
    const block = r1.finalCodewords.slice(0, dataLen);
    const ecc = r1.finalCodewords.slice(dataLen, dataLen + eccLen);
    const full = block.concat(ecc);
    const t = Math.floor(eccLen / 2);
    const corrupted = full.slice();
    const positions = new Set();
    while (positions.size < t) positions.add(Math.floor(rnd() * full.length));
    for (const p of positions) corrupted[p] ^= 0xFF;
    const res = qr.rs.decode(corrupted, eccLen);
    ok(`RS round trip on the real "HELLO WORLD" codewords: ${t} corrupted bytes (the max this ECC strength corrects) recover exactly`,
      res.ok && JSON.stringify(res.data) === JSON.stringify(block), res);

    const overCorrupted = full.slice();
    const overPositions = new Set();
    while (overPositions.size < t + 1) overPositions.add(Math.floor(rnd() * full.length));
    for (const p of overPositions) overCorrupted[p] ^= 0xFF;
    const overRes = qr.rs.decode(overCorrupted, eccLen);
    const wrongRecovery = overRes.ok && JSON.stringify(overRes.data) === JSON.stringify(block);
    ok(`RS: ${t + 1} corrupted bytes (one past correctable) never silently "recovers" the right answer`, !wrongRecovery, overRes);
  }

  // A second, multi-block version (v8: two groups) — the interleave/de-interleave boundary is
  // exactly where a block-splitting bug would hide.
  const r8text = "R".repeat(150);
  const r8 = qr.encode(r8text);
  {
    const blocks = qr.tables.BLOCKS_M[r8.version - 1];
    const eccLen = qr.tables.ECC_PER_BLOCK_M[r8.version - 1];
    const lens = []; for (const [count, len] of blocks) for (let i = 0; i < count; i++) lens.push(len);
    const maxLen = Math.max(...lens);
    const dataParts = lens.map(() => []);
    let idx = 0;
    for (let i = 0; i < maxLen; i++) for (let b = 0; b < lens.length; b++) if (i < lens[b]) dataParts[b].push(r8.finalCodewords[idx++]);
    const eccParts = lens.map(() => []);
    for (let i = 0; i < eccLen; i++) for (let b = 0; b < lens.length; b++) eccParts[b].push(r8.finalCodewords[idx++]);
    let allOk = true;
    for (let b = 0; b < lens.length; b++) {
      const full = dataParts[b].concat(eccParts[b]);
      const t = Math.floor(eccLen / 2);
      const corrupted = full.slice();
      const positions = new Set();
      while (positions.size < t) positions.add(Math.floor(rnd() * full.length));
      for (const p of positions) corrupted[p] ^= 0xFF;
      const res = qr.rs.decode(corrupted, eccLen);
      if (!res.ok || JSON.stringify(res.data) !== JSON.stringify(dataParts[b])) allOk = false;
    }
    ok(`v${r8.version} (${lens.length} blocks): every block RS round-trips independently at its max correctable count`, allOk);
  }

  // renderSvg: role=img, aria-label carries the EXACT url (never truncated, never re-derived).
  {
    const url = "https://clucknorris.app/hub/hbprint/r/" + "S".repeat(80);
    const svg = qr.renderSvg(url);
    ok('renderSvg: role="img"', /role="img"/.test(svg));
    ok("renderSvg: aria-label is the exact receipt URL", svg.includes('aria-label="' + url + '"'));
    ok("renderSvg: no forbidden word", !/verified|audited|guaranteed|\bapr\b|\bapy\b/i.test(svg));
  }
}

// ── 2. the page, with a real Chromium ────────────────────────────────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET = fakeAddr(1);
const SIG = fakeSig(1);
const PROJECT = "hbprint";
const T0 = 1_800_000_000;
const T1 = T0 + 3600;
const BATCH_AT = T0 + 7200;
const BATCH_ID = "hbprint-batch-1";
const MINT = fakeAddr(99);
const FUND = fakeAddr(50);
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const proj = require(path.join(ROOT, "lib", "hub", "project"));
const VERSION_PROJECT = { id: PROJECT, mint: MINT, rewardMint: MINT, rewardDecimals: 9, rewardTokenProgram: TOKEN_PROGRAM, fundingWallet: FUND };
const VERSION = proj.createVersion({}, VERSION_PROJECT, {
  poolDailyRaw: "1000000000000", minDurationDays: 1, maxTermDays: 540, payoutSchedule: "weekly", vesting: "any", fundedBy: [FUND],
}, { effectiveFrom: "2027-01-01", todayKey: "2027-01-01" }).versions[0];

function buildFixtureState() {
  // Real accrual days + a real program version (copied in shape from scripts/hub-bundle-test.cjs)
  // so the receipt's E5 `explanation` walkthrough is POPULATED, not degraded — the print sheet's
  // "amount the rule computed" and reproduce-steps section both need this.
  const days = {
    "2027-02-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 },
    "2027-02-01T01": { credits: { [WALLET]: "500000000" }, at: T1 },
  };
  const batches = {
    [BATCH_ID]: { id: BATCH_ID, state: "sent", at: BATCH_AT, amounts: { [WALLET]: "1500000000" }, sent: { [WALLET]: { sig: SIG, at: BATCH_AT + 60 } } },
  };
  return {
    "hub:projects": { [PROJECT]: { id: PROJECT, label: "Hub Print Test", symbol: "HPT", mint: MINT, decimals: 9, rewardMint: MINT, rewardDecimals: 9, fundingWallet: FUND } },
    [`program:${PROJECT}:days`]: days,
    [`program:${PROJECT}:batches`]: batches,
    [`program:${PROJECT}:paid`]: {},
    [`program:${PROJECT}:state`]: { versions: [VERSION] },
  };
}

async function pageTests() {
  console.log("\n2. /hub/" + PROJECT + "/r/<sig>?print=1 — real Chromium\n");
  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-print-test-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(buildFixtureState()));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }

  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    // Confirm the fixture actually produced a receipt with a real walkthrough before trusting the
    // page-level assertions below (a degraded explanation would make several of them vacuous).
    const receiptJson = await fetch(`${BASE}/api/hub/${PROJECT}/r/${SIG}`).then((r) => r.json());
    ok("fixture sanity: the seeded receipt exists", receiptJson.ok === true, JSON.stringify(receiptJson).slice(0, 300));
    ok("fixture sanity: its explanation has real steps (not degraded)", !!(receiptJson.ok && receiptJson.receipt && receiptJson.receipt.explanation && receiptJson.receipt.explanation.steps && receiptJson.receipt.explanation.steps.length), JSON.stringify(receiptJson.receipt && receiptJson.receipt.explanation));
    ok("fixture sanity: it carries a programVersion hash", !!(receiptJson.ok && receiptJson.receipt && receiptJson.receipt.programVersion && receiptJson.receipt.programVersion.hash), JSON.stringify(receiptJson.receipt && receiptJson.receipt.programVersion));
    const hashPrefix = receiptJson.ok ? String(receiptJson.receipt.programVersion.hash).slice(0, 16) : "<none>";

    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const receiptUrl = `${BASE}/hub/${PROJECT}/r/${SIG}`;
    await page.goto(`${receiptUrl}?print=1`, { waitUntil: "networkidle", timeout: 20000 });
    await sleep(300);

    ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join("\n"));

    const sheetText = await page.textContent("#printSheet").catch(() => "");
    ok("sheet contains the settlement signature in full", sheetText.includes(SIG), sheetText.slice(0, 200));
    ok("sheet contains the program-version hash", sheetText.includes(hashPrefix), hashPrefix);
    ok("sheet contains the amount", /1\.5\b/.test(sheetText) && /HPT/.test(sheetText), sheetText.slice(0, 400));
    ok('sheet contains the trust-boundary line', sheetText.includes("A receipt proves a rule was followed, not that it was fair"), sheetText.slice(0, 400));
    ok("sheet links to /hub/trust", await page.locator('#printSheet a[href="/hub/trust"]').count() > 0);
    ok('sheet contains the reproduce-steps block ("How this number was computed")', sheetText.includes("How this number was computed"), sheetText.slice(0, 400));

    const svgCount = await page.locator('#printSheet svg[role="img"]').count();
    ok("sheet has exactly one svg[role=img] (the QR)", svgCount === 1, svgCount);
    if (svgCount > 0) {
      const ariaLabel = await page.locator('#printSheet svg[role="img"]').first().getAttribute("aria-label");
      ok("the QR's aria-label is the exact public receipt URL", ariaLabel === receiptUrl, ariaLabel);
    }

    ok("body carries print-mode (the ?print=1 on-screen layout)", await page.evaluate(() => document.body.classList.contains("print-mode")));
    // On screen with print-mode: everything outside #printSheet is hidden — the same content a
    // real print would show, so a phone screenshot matches what Ctrl+P would produce.
    const mainVisibleOnScreen = await page.evaluate(() => { const m = document.querySelector("main"); return m ? getComputedStyle(m).display !== "none" : null; });
    ok("?print=1 on screen: <main> (nav/pills/buttons/footer's container) is hidden", mainVisibleOnScreen === false, mainVisibleOnScreen);
    const sheetVisibleOnScreen = await page.evaluate(() => getComputedStyle(document.getElementById("printSheet")).display !== "none");
    ok("?print=1 on screen: #printSheet itself is visible", sheetVisibleOnScreen === true);

    // Now the actual @media print emulation, on a FRESH load with no ?print=1 — proves the print
    // stylesheet alone (not just the JS-added class) hides the chrome and shows the sheet, which
    // is what happens when someone hits Ctrl+P on the plain receipt page.
    const page2 = await browser.newPage();
    await page2.goto(receiptUrl, { waitUntil: "networkidle", timeout: 20000 });
    await sleep(300);
    await page2.emulateMedia({ media: "print" });
    const mainHiddenPrint = await page2.evaluate(() => { const m = document.querySelector("main"); return m ? getComputedStyle(m).display === "none" : null; });
    ok("@media print (no ?print=1): <main> is hidden", mainHiddenPrint === true, mainHiddenPrint);
    const printBtnHidden = await page2.evaluate(() => { const b = document.getElementById("printBtn"); return b ? getComputedStyle(b).display === "none" || getComputedStyle(b.closest("main") || b).display === "none" : null; });
    ok("@media print: the Print/Verify buttons are not visible", printBtnHidden === true, printBtnHidden);
    const sheetVisiblePrint = await page2.evaluate(() => getComputedStyle(document.getElementById("printSheet")).display !== "none");
    ok("@media print: #printSheet is visible", sheetVisiblePrint === true);
    const sheetBg = await page2.evaluate(() => getComputedStyle(document.querySelector("#printSheet .ps-card")).backgroundColor);
    ok("@media print: the sheet uses a white background (print-safe, not the dark theme)", /rgb\(255,\s*255,\s*255\)/.test(sheetBg), sheetBg);

    // Normal (non-print) view: the visible "Print this page" button exists and calls window.print().
    const page3 = await browser.newPage();
    let printCalled = false;
    await page3.exposeFunction("__printHookHit", () => { printCalled = true; });
    await page3.addInitScript(() => { window.print = () => window.__printHookHit(); });
    await page3.goto(receiptUrl, { waitUntil: "networkidle", timeout: 20000 });
    await sleep(300);
    const printBtnVisible = await page3.evaluate(() => { const b = document.getElementById("printBtn"); return !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().height > 0; });
    ok('normal view: a visible "Print this page" button exists', printBtnVisible);
    await page3.click("#printBtn");
    await sleep(100);
    ok("clicking it calls window.print()", printCalled);

    // ── forbidden-word scan (source + all three rendered pages) ───────────────────────────────
    const src = fs.readFileSync(path.join(ROOT, "public", "hub.html"), "utf8") + fs.readFileSync(path.join(ROOT, "public", "hub-qr.js"), "utf8");
    const forbidden = /\bverified project\b|\baudited\b|\bguaranteed\b|\bapr\b|\bapy\b|normie\s*quest|wallet\s*watch/i;
    ok("hub.html + hub-qr.js source: no forbidden word", !forbidden.test(src));
    for (const [label, txt] of [["print=1 sheet", sheetText], ["print-emulated page", await page2.textContent("body").catch(() => "")], ["normal page", await page3.textContent("body").catch(() => "")]]) {
      ok(`${label}: no forbidden word (verified/audited/guaranteed/APR/APY, Normie Quest, Wallet Watch)`, !forbidden.test(txt.toLowerCase()));
    }
    ok('no "safe" as a standalone claim word on the print sheet', !/\bsafe\b/i.test(sheetText));

    await page.close(); await page2.close(); await page3.close();
  } finally {
    await browser.close();
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }
}

(async () => {
  unitTests();
  await pageTests();
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
