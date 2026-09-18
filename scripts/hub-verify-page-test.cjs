#!/usr/bin/env node
/*
 * HUB VERIFY PAGE — Y1 (docs/COLOSSEUM_ROADMAP.md §9): the browser bundle at
 * public/hub-verify.bundle.js (built by `npm run build:hubverify`, vite.hubverify.config.js from
 * hub-verify-src/entry.js) must agree with the Node script it mirrors (scripts/reproduce-receipt.cjs
 * / lib/hub/reproduce.js) on every fixture — not "close enough", byte-for-byte the same verdict.
 * Three layers, cheapest first:
 *
 *   1. Pure Node/Node comparison — no server, no browser: dynamic-`import()` the built ESM bundle
 *      IN NODE and diff its `reproduce`/`reproduceBuyCompRow`/`validate` output against the CJS
 *      libs on the same fixtures (MATCH, MISMATCH, MISSING_INPUTS, a buy-comp row). If these ever
 *      disagree, the bundle drifted from the source it was built from.
 *   2. Boots a real server against a throwaway DATA_DIR seeded with a REAL lock-to-earn project
 *      (registered in the hub kv registry, with real batches/days — NOT the "demo" dry-run fixture
 *      at /hub/demo, which runs the newer Addendum-B ledger.js shape lib/hub/reproduce.js does not
 *      cover yet, per that file's own header). One batch is correct (MATCH); a second batch's
 *      amount is deliberately wrong (MISMATCH) so both verdicts are exercised for real.
 *   3. Drives /hub/verify with real Chromium (Playwright): the "from a URL" path (typed in and via
 *      `?receipt=`) and the "from saved files" offline path (receipt.json + batch-inputs.json,
 *      fetched once with plain HTTP then handed to the page as local files — no further network),
 *      and asserts the rendered verdict badge equals what `node scripts/reproduce-receipt.cjs`
 *      prints for the exact same URL.
 *
 * Usage: node scripts/hub-verify-page-test.cjs [baseUrl]
 * Env:   HUB_VERIFY_TEST_PORT (default 3218) — used only when baseUrl is omitted (a server is booted).
 */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

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
const BUNDLE_PATH = path.join(ROOT, "public", "hub-verify.bundle.js");
const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_VERIFY_TEST_PORT || 3218);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// `page.textContent("body")` returns raw DOM textContent, which walks INTO <script> elements too
// (a script tag's source is stored as a text-node child) — on this page that means every English
// literal passed to t()/tf() is "found in the body" simply because it sits in the inline module
// script, independent of what actually rendered. `innerText` is the rendered/visible text only
// (CSS-aware, skips script/style), which is what "does this leak on screen" actually means; the
// language-guard and i18n checks below both need that distinction or they pass for the wrong reason.
const innerText = (pg) => pg.evaluate(() => document.body.innerText).catch(() => "");

// ── fixture data — a REAL project registered in the hub kv registry, not the demo fixture ──────
const WALLET = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET2 = fakeAddr(2);
const SIG_MATCH = fakeSig(1);
const SIG_MISMATCH = fakeSig(2);
const PROJECT = "hvtest";
const T0 = 1_800_000_000; // fixed, arbitrary unix seconds — this is a fixture, not a live clock
const T1 = T0 + 3600;
const BATCH_AT = T0 + 7200;

function buildFixtureState() {
  const days = {
    "2027-01-15T00": { credits: { [WALLET]: "1000000000", [WALLET2]: "700000000" }, at: T0 },
    "2027-01-15T01": { credits: { [WALLET]: "500000000", [WALLET2]: "100000000" }, at: T1 },
  };
  const batches = {
    "hv-batch-match": {
      id: "hv-batch-match", state: "sent", at: BATCH_AT,
      amounts: { [WALLET]: "1500000000" },                 // == 1000000000 + 500000000, correct
      sent: { [WALLET]: { sig: SIG_MATCH, at: BATCH_AT + 60 } },
    },
    "hv-batch-mismatch": {
      id: "hv-batch-mismatch", state: "sent", at: BATCH_AT,
      amounts: { [WALLET2]: "900000000" },                 // should be 800000000 — deliberately wrong
      sent: { [WALLET2]: { sig: SIG_MISMATCH, at: BATCH_AT + 60 } },
    },
  };
  return {
    "hub:projects": {
      [PROJECT]: { id: PROJECT, label: "Hub Verify Test", symbol: "HVT", mint: fakeAddr(99), decimals: 9, rewardMint: fakeAddr(99), rewardDecimals: 9 },
    },
    [`program:${PROJECT}:days`]: days,
    [`program:${PROJECT}:batches`]: batches,
    [`program:${PROJECT}:paid`]: {},
  };
}

// ── 1. pure Node/Node comparison — no server ────────────────────────────────────────────────────
async function pureComparison() {
  console.log("\n1. the browser bundle agrees with the Node lib on the same fixtures (no server)\n");
  ok("bundle exists (build it with `npm run build:hubverify` first)", fs.existsSync(BUNDLE_PATH));
  if (!fs.existsSync(BUNDLE_PATH)) return;

  const bundle = await import("file://" + BUNDLE_PATH);
  const cjs = require("../lib/hub/reproduce");
  const schemaValidate = require("../lib/hub/schema-validate");
  const canonical = require("../lib/hub/canonical");
  const project = require("../lib/hub/project");

  // MATCH
  const inputsMatch = { periods: [{ key: "a", at: 1, creditRaw: "1000000000" }, { key: "b", at: 2, creditRaw: "500000000" }], priorPaidRaw: "0", priorReservedRaw: "0" };
  const receiptMatch = { amountRaw: "1500000000" };
  const cjsMatch = cjs.reproduce({ programVersion: null, inputs: inputsMatch, receipt: receiptMatch });
  const bundleMatch = bundle.reproduce({ programVersion: null, inputs: inputsMatch, receipt: receiptMatch });
  ok("reproduce() MATCH: bundle === CJS", JSON.stringify(bundleMatch) === JSON.stringify(cjsMatch), JSON.stringify({ cjsMatch, bundleMatch }));
  ok("...and it actually says MATCH", cjsMatch.status === "MATCH");

  // MISMATCH
  const receiptWrong = { amountRaw: "1600000000" };
  const cjsMismatch = cjs.reproduce({ programVersion: null, inputs: inputsMatch, receipt: receiptWrong });
  const bundleMismatch = bundle.reproduce({ programVersion: null, inputs: inputsMatch, receipt: receiptWrong });
  ok("reproduce() MISMATCH: bundle === CJS", JSON.stringify(bundleMismatch) === JSON.stringify(cjsMismatch));
  ok("...and it actually says MISMATCH", cjsMismatch.status === "MISMATCH");

  // MISSING_INPUTS
  const cjsMissing = cjs.reproduce({ programVersion: null, inputs: null, receipt: receiptMatch });
  const bundleMissing = bundle.reproduce({ programVersion: null, inputs: null, receipt: receiptMatch });
  ok("reproduce() MISSING_INPUTS: bundle === CJS", JSON.stringify(bundleMissing) === JSON.stringify(cjsMissing));
  ok("...and it actually says MISSING_INPUTS", cjsMissing.status === "MISSING_INPUTS");

  // buy-comp row
  const bc = { terms: { places: [{ amount: 10 }], pctPrize: false }, rank: 1, tokensBought: null, valueSol: null, published: 10 };
  const cjsBc = cjs.reproduceBuyCompRow(bc);
  const bundleBc = bundle.reproduceBuyCompRow(bc);
  ok("reproduceBuyCompRow(): bundle === CJS", JSON.stringify(bundleBc) === JSON.stringify(cjsBc));

  // schema-validate.validate()
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false };
  const good = { a: "x" }, bad = { a: 1, b: 2 };
  ok("schema validate() valid body: bundle === CJS", JSON.stringify(bundle.validate(schema, good)) === JSON.stringify(schemaValidate.validate(schema, good)));
  ok("schema validate() invalid body: bundle === CJS", JSON.stringify(bundle.validate(schema, bad)) === JSON.stringify(schemaValidate.validate(schema, bad)));

  // canonicalJson + the version-hash adapter — the bundle's async crypto.subtle path vs Node's
  // sync node:crypto path (lib/hub/project.js) must agree on the SAME version record.
  const body = { projectId: "x", version: 1, effectiveFrom: "2027-01-01", effectiveTo: null, mint: "a", rewardMint: "a", rewardDecimals: 9, rewardTokenProgram: "t", fundingResponsibility: "f", signer: "f", exclusions: { rule: "B", wallets: [] }, terms: { a: 1 } };
  ok("canonicalJson(): bundle === CJS", bundle.canonicalJson(body) === canonical.canonicalJson(body));
  const hash = project.sha256(project.canonicalJson(body));
  const v = { ...body, hash };
  const bundleHashCheck = await bundle.verifyVersionHash(v);
  ok("verifyVersionHash(): browser crypto.subtle recomputes the SAME hash node:crypto did", bundleHashCheck.ok === true && bundleHashCheck.computed === hash, JSON.stringify(bundleHashCheck));
  const tampered = { ...v, hash: "deadbeef" };
  const bundleHashTampered = await bundle.verifyVersionHash(tampered);
  ok("verifyVersionHash(): a tampered hash is caught", bundleHashTampered.ok === false);
}

// ── 3. the "no verified/safe badge, no APR" language guard (independent of the money paths above) ─
function languageGuard(bodyText) {
  const lower = bodyText.toLowerCase();
  ok("no 'verified project' claim on the page", !lower.includes("verified project"));
  ok("no 'safe' badge/claim on the page", !/\bsafe\b/.test(lower));
  ok("no APR/APY/yield-rate language on the page", !/\bapr\b/.test(lower) && !/\bapy\b/.test(lower));
}

async function main() {
  // Build once, up front, if a prior `npm run build` hasn't already produced it — CI's own smoke
  // job does `test -f public/hub-verify.bundle.js || npm run build:hubverify` before this script
  // runs at all, so this is the self-sufficient fallback for running the test on its own.
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.log("building public/hub-verify.bundle.js (npm run build:hubverify)…");
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", ".bin", "vite"), "build", "--config", "vite.hubverify.config.js"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0 || !fs.existsSync(BUNDLE_PATH)) { console.error("could not build the bundle"); process.exit(1); }
  }

  await pureComparison();

  let srv = null, DIR = null;
  if (!ARG_BASE) {
    DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-verify-"));
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(buildFixtureState()));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }

  const urlMatch = `${BASE}/hub/${PROJECT}/r/${SIG_MATCH}`;
  const urlMismatch = `${BASE}/hub/${PROJECT}/r/${SIG_MISMATCH}`;

  console.log("\n2. GET /api/hub/" + PROJECT + "/r/<sig> serves the seeded fixture\n");
  try {
    const rMatch = await fetch(`${BASE}/api/hub/${PROJECT}/r/${SIG_MATCH}`).then((x) => x.json());
    ok("MATCH fixture receipt is servable", rMatch.ok === true && rMatch.receipt && rMatch.receipt.sig === SIG_MATCH, JSON.stringify(rMatch));
    const rMismatch = await fetch(`${BASE}/api/hub/${PROJECT}/r/${SIG_MISMATCH}`).then((x) => x.json());
    ok("MISMATCH fixture receipt is servable", rMismatch.ok === true && rMismatch.receipt && rMismatch.receipt.sig === SIG_MISMATCH, JSON.stringify(rMismatch));
  } catch (e) { ok("fixture receipts are servable", false, e.message); }

  console.log("\n3. node scripts/reproduce-receipt.cjs — the reference CLI verdicts\n");
  function runCli(url) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "reproduce-receipt.cjs"), url], { encoding: "utf8" });
    const m = /^status:\s*(\S+)/m.exec(r.stdout || "");
    return { code: r.status, status: m ? m[1] : null, stdout: r.stdout, stderr: r.stderr };
  }
  const cliMatch = runCli(urlMatch);
  const cliMismatch = runCli(urlMismatch);
  ok("CLI says MATCH for the correct batch (exit 0)", cliMatch.status === "MATCH" && cliMatch.code === 0, cliMatch.stdout + cliMatch.stderr);
  ok("CLI says MISMATCH for the tampered batch (exit 2)", cliMismatch.status === "MISMATCH" && cliMismatch.code === 2, cliMismatch.stdout + cliMismatch.stderr);

  console.log("\n4. /hub/verify in a real browser — the URL path\n");
  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let allBodyText = "";
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    // 4a. ?receipt=<url> — the link every receipt page will carry
    await page.goto(`${BASE}/hub/verify?receipt=${encodeURIComponent(urlMatch)}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
    let badge = await page.textContent(".verdict .badge").catch(() => null);
    ok("?receipt= query param auto-runs and shows MATCH", badge === "MATCH", "got: " + badge);
    allBodyText += (await innerText(page)) + " ";

    // 4b. typed into the URL field + button click — the interactive path
    await page.goto(`${BASE}/hub/verify`, { waitUntil: "networkidle", timeout: 20000 });
    await page.fill("#urlIn", urlMismatch);
    await page.click("#urlBtn");
    await page.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
    badge = await page.textContent(".verdict .badge").catch(() => null);
    ok("typed URL + REPRODUCE shows MISMATCH for the tampered batch", badge === "MISMATCH", "got: " + badge);
    allBodyText += (await innerText(page)) + " ";

    ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join("\n"));

    console.log("\n5. /hub/verify — the offline (saved files) path\n");
    const receiptJson = await fetch(`${BASE}/api/hub/${PROJECT}/r/${SIG_MATCH}`).then((r) => r.text());
    const receiptBody = JSON.parse(receiptJson);
    const inputsJson = await fetch(`${BASE}/api/hub/${PROJECT}/batch/${receiptBody.receipt.batchId}/inputs?wallet=${encodeURIComponent(WALLET)}`).then((r) => r.text());
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-verify-files-"));
    const receiptPath = path.join(tmp, "receipt.json"), inputsPath = path.join(tmp, "batch-inputs.json");
    fs.writeFileSync(receiptPath, receiptJson);
    fs.writeFileSync(inputsPath, inputsJson);

    await page.goto(`${BASE}/hub/verify`, { waitUntil: "networkidle", timeout: 20000 });
    await page.click("#tabFiles");
    await page.setInputFiles("#fileIn", [receiptPath, inputsPath]);
    await page.waitForFunction(() => !document.getElementById("filesBtn").disabled, {}, { timeout: 5000 }).catch(() => {});
    const btnEnabled = !(await page.$eval("#filesBtn", (b) => b.disabled).catch(() => true));
    ok("both files load and enable REPRODUCE FROM FILES", btnEnabled);
    if (btnEnabled) {
      await page.click("#filesBtn");
      await page.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
      badge = await page.textContent(".verdict .badge").catch(() => null);
      ok("offline path from saved files shows MATCH (same as the CLI)", badge === "MATCH", "got: " + badge);
    }
    allBodyText += (await innerText(page)) + " ";
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log("\n6. language guard — no verified-project/safe badge, no APR anywhere on the page\n");
    languageGuard(allBodyText);

    // ── 7. CC2 (docs/COLOSSEUM_ROADMAP.md Extension 7): the page's own t()/tf() strings must
    // actually render in the visitor's chosen language, not fall through to English. `clkn_lang`
    // (the same localStorage key i18n.js reads — see public/i18n.js's own `detect()`) is set via
    // `addInitScript` BEFORE the page's first script runs, in a fresh context per language so it
    // never leaks between runs. Three sample strings per language: one from the static markup
    // (curated via i18n.js's own DOM walker) and two this page's own `t()` builds at render time
    // — covering both translation paths this CC2 change touches. The verdict CODE (MATCH) must
    // stay the literal, untranslated string in every language — only the prose beside it changes.
    async function runLanguageCheck(lang, expectSamples) {
      console.log(`\n7. /hub/verify in "${lang}" — curated strings render translated, not English\n`);
      const ctx = await browser.newContext();
      await ctx.addInitScript((l) => { try { localStorage.setItem("clkn_lang", l); } catch (_) {} }, lang);
      const p = await ctx.newPage();
      try {
        await p.goto(`${BASE}/hub/verify?receipt=${encodeURIComponent(urlMatch)}`, { waitUntil: "networkidle", timeout: 20000 });
        await p.waitForSelector(".verdict .badge", { timeout: 10000 }).catch(() => {});
        const badge = await p.textContent(".verdict .badge").catch(() => null);
        ok(`[${lang}] verdict code stays the literal "MATCH" (never translated)`, badge === "MATCH", "got: " + badge);
        // Case-insensitive: some of these labels sit under CSS `text-transform:uppercase` (the
        // `.steps .lbl` rule), so the rendered text is e.g. "CANTIDAD PUBLICADA" while the curated
        // dictionary value (and the sample below) is sentence case — that's a CSS presentation
        // detail, not a translation gap, and the check should not care about it either way.
        const body = (await innerText(p)).toLowerCase();
        for (const s of expectSamples) {
          ok(`[${lang}] renders "${s.slice(0, 44)}${s.length > 44 ? "…" : ""}"`, body.includes(s.toLowerCase()), "page body did not contain the expected " + lang + " string: " + s);
        }
        ok(`[${lang}] does not fall back to the raw English verdict explanation`, !body.includes("this amount is exactly reproducible from the inputs the server published."));
      } finally {
        await ctx.close();
      }
    }
    await runLanguageCheck("es", [
      "Reproducir un recibo",                  // markup (h1) — i18n.js's own curated-dict path
      "Cantidad publicada",                    // this page's t() — a plain label
      "Esta cantidad es exactamente reproducible a partir de las entradas que publicó el servidor.", // this page's t() — the MATCH explanation sentence
    ]);
    await runLanguageCheck("zh", [
      "复现一张收据",           // markup (h1) — i18n.js's own curated-dict path
      "已公布金额",             // this page's t() — a plain label
      "该金额可由服务器公布的输入精确复现。", // this page's t() — the MATCH explanation sentence
    ]);
  } finally {
    await browser.close();
    if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} }
    if (DIR) { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
