#!/usr/bin/env node
"use strict";
// The app's Library (src/seeker/school/Library.jsx) — owner, 2026-09-25: "bring the library into the
// IOS version ... easily searchable and then can link into the school".
//
// Builds the edition's bundle and, at phone size, requires:
//   · the School home carries a Library card that opens /library;
//   · every glossary term from the website Library is listed (data/curriculum*.json `glossary`);
//   · no entry is missing a definition, and most entries link into at least one lesson;
//   · searching "slippage" narrows the list and ranks a term match first; a nonsense query shows the
//     empty state with a way out to Ask Cluck;
//   · a "Learn it in" link lands on that lesson's stepper;
//   · in Spanish the list renders translated definitions, and a Spanish search finds a term.
//
// Usage: node scripts/seeker-library-test.cjs [seeker|google]
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const variant = process.argv.find((a) => a === "seeker" || a === "google") || "google";
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "  — " + JSON.stringify(detail).slice(0, 300) : "")); }
}

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { console.error("✗ needs playwright"); process.exit(1); } }

  const out = execFileSync(process.execPath, ["scripts/build-store-edition.mjs", variant], { cwd: ROOT, encoding: "utf8" });
  const manifest = JSON.parse(out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "library-"));
  execFileSync("tar", ["-xzf", path.join(ROOT, "release", manifest.file), "-C", dir, "--strip-components=1"]);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const fp = path.join(dir, p);
    if (!fp.startsWith(dir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(fp)] || "application/octet-stream" }); fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", variant === "seeker" ? "curriculum.json" : "curriculum.store.json"), "utf8"));
  const glossary = cur.glossary || [];

  const findChromium = () => [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean).find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });

  console.log(`${variant}: English`);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
  await page.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".seeker-nav", { timeout: 20000 });
  await page.waitForTimeout(600);

  ok("glossary carried into the bundle's curriculum", glossary.length >= 40, glossary.length);
  const card = page.locator(".seeker-library-card");
  ok("the School home has a Library card", (await card.count()) === 1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.scrollY);
  ok("(setup) the School home is scrolled well down before opening the Library", before > 200, before);
  if (await card.count()) { await card.click(); await page.waitForTimeout(500); }
  ok("the card opens /library", /#\/library$/.test(page.url()), page.url());
  // The card sits far down the School home; the Library must still open at its TOP (owner,
  // 2026-09-25: "it defaulted at bottom of the list and had to scroll up"). App.jsx resets scroll
  // on every route change.
  ok("the Library opens at the top, not at the old scroll position", (await page.evaluate(() => window.scrollY)) < 5, await page.evaluate(() => window.scrollY));

  const items = await page.evaluate(() => [...document.querySelectorAll(".seeker-library-item")].map((li) => ({
    term: (li.querySelector(".seeker-library-term") || {}).textContent || "",
    def: (li.querySelector(".seeker-library-def") || {}).textContent || "",
    links: li.querySelectorAll(".seeker-library-link").length,
  })));
  const listed = new Set(items.map((i) => i.term.toLowerCase()));
  const missing = glossary.filter((g) => !listed.has(g.term.toLowerCase())).map((g) => g.term);
  ok(`every website glossary term is listed (${items.length} entries in all)`, missing.length === 0, missing);
  ok("no entry is missing its definition", items.every((i) => i.def.trim().length > 10), items.filter((i) => i.def.trim().length <= 10).map((i) => i.term));
  const linked = items.filter((i) => i.links > 0).length;
  ok(`most entries link into a lesson (${linked} of ${items.length})`, linked / Math.max(1, items.length) >= 0.8, linked);

  await page.fill(".seeker-library-search", "slippage");
  await page.waitForTimeout(300);
  const found = await page.evaluate(() => [...document.querySelectorAll(".seeker-library-term")].map((e) => e.textContent));
  ok("searching 'slippage' narrows the list", found.length > 0 && found.length < items.length, found.length);
  ok("and ranks a term match first", /slippage/i.test(found[0] || ""), found.slice(0, 3));

  await page.fill(".seeker-library-search", "zzqxv");
  await page.waitForTimeout(300);
  ok("a query with no match shows the empty state and a way to Ask Cluck",
    (await page.locator(".seeker-library-empty a[href$='/ask']").count()) === 1);

  await page.fill(".seeker-library-search", "impermanent");
  await page.waitForTimeout(300);
  const link = page.locator(".seeker-library-link").first();
  const href = await link.getAttribute("href");
  await link.click();
  await page.waitForTimeout(800);
  ok("a 'Learn it in' link lands on that lesson's stepper", (await page.locator(".seeker-step").count()) === 1 && page.url().endsWith(href), { href, url: page.url() });
  ok("no uncaught errors", errors.length === 0, errors);
  await page.close();

  console.log(`${variant}: Spanish`);
  const es = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await es.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await es.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await es.evaluate(() => localStorage.setItem("clkn_lang", "es"));
  // A hash-only goto does not reload the document, so the language would never apply: reload.
  await es.reload({ waitUntil: "networkidle" });
  await es.evaluate(() => { window.location.hash = "#/library"; });
  await es.waitForTimeout(2500);
  const esDef = await es.evaluate(() => {
    const li = [...document.querySelectorAll(".seeker-library-item")].find((x) => /^AMM$/i.test((x.querySelector(".seeker-library-term") || {}).textContent || ""));
    return li ? li.querySelector(".seeker-library-def").textContent : null;
  });
  const enDef = (glossary.find((g) => g.term === "AMM") || {}).def;
  ok("definitions render translated", !!esDef && esDef !== enDef, esDef && esDef.slice(0, 80));
  // The English name under a translated term must STAY English — the page translator rewrote it
  // once, so a Spanish reader saw "Clave privada / Frase semilla" twice.
  const enLines = await es.evaluate(() => [...document.querySelectorAll(".seeker-library-item")].map((li) => ({
    term: (li.querySelector(".seeker-library-term") || {}).textContent || "",
    en: (li.querySelector(".seeker-library-en") || {}).textContent || null,
  })).filter((x) => x.en !== null));
  const notEnglish = enLines.filter((x) => x.en === x.term);
  ok(`the English name under each translated term stays English (${enLines.length} lines)`, enLines.length > 10 && notEnglish.length === 0, notEnglish.slice(0, 3));
  // "semilla" only exists in the Spanish text ("Frase semilla"); the curated Spanish keeps crypto
  // words its readers really use in English ("Slippage", "Rug pull"), so those search as-is.
  await es.fill(".seeker-library-search", "semilla");
  await es.waitForTimeout(300);
  const esHit = await es.evaluate(() => [...document.querySelectorAll(".seeker-library-term")].map((e) => e.textContent));
  ok("a Spanish search finds a term", esHit.some((x) => /semilla/i.test(x)), esHit.slice(0, 3));
  await es.close();

  await browser.close(); server.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
