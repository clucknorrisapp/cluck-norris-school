#!/usr/bin/env node
"use strict";
// Solana Room parity — the Seeker app (both editions) vs. the website (CLAUDE.md/AGENTS.md's
// task: "the app and the site cannot silently diverge").
//
// src/seeker/solana/content.js is a DATA port of public/solana-<id>.html's own render() function
// — same English strings, so the same six curated dictionaries already carry a translation. This
// test is the drift gate: it extracts every literal t()/tf() call from the website page's own
// <script> block (same technique as scripts/solana-room-test.cjs's extractJsTFCalls) and every
// string the data module actually carries (walked as data, not scanned as source — content.js
// holds object literals, not t(...) call sites), then checks BOTH directions per page:
//
//   (1) every string content.js carries for a page is a literal t() call somewhere in that
//       page's website file — a typo or a paraphrase during porting fails loudly here, never
//       silently ships an unreachable-in-the-dictionary string;
//   (2) every literal t() call on the website page is either ported (present in content.js) or
//       named in KNOWN_NOT_PORTED below with a reason — so a website edit that adds a new fact
//       fails this test until it's ported or the gap is named on purpose. KNOWN_NOT_PORTED
//       exists ONLY for content this PR's own header explains: cross-links to tools that don't
//       exist (the same way) in both app editions (/lp-lab, /autopsy, /firepit).
//
// Also checks: (3) every string content.js carries exists in all six non-English dictionaries
// (public/i18n/<lang>.json) — the actual i18n completeness claim, independent of
// scripts/seeker-build-test.cjs's own broader sweep; (4) the room's routes render real headings
// offline, at 360x800, from the BUILT seeker bundle, with the network refused — a static-text
// room needs no "unavailable" state, and this proves it never tries one.
//
// Usage: node scripts/seeker-solana-room-test.cjs
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };

// ════════════════════════════════════════════════════════════════════════════════════════════
// t() key extraction from the website's own <script> block — identical technique to
// scripts/solana-room-test.cjs and scripts/i18n-audit.cjs's extractJsTFCalls.
// ════════════════════════════════════════════════════════════════════════════════════════════
function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function extractJsScriptBlocks(raw) {
  const blocks = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(raw))) blocks.push(m[1]);
  return blocks;
}
function siteKeys(file) {
  const raw = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
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

// ════════════════════════════════════════════════════════════════════════════════════════════
// content.js as DATA, not source — strip its two `import`s and `export` keywords, then eval the
// module body so PAGES/INDEX/etc. are real JS values to walk. `t` becomes the identity function
// (the point here is the ENGLISH key text, not a translation), matching how the module documents
// its own gated-strings function elsewhere in the repo (e.g. public/solana-room.html).
// ════════════════════════════════════════════════════════════════════════════════════════════
function loadContentModule() {
  const src = fs.readFileSync(path.join(ROOT, "src", "seeker", "solana", "content.js"), "utf8");
  const body = src
    .replace(/^import\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?$/gm, "")
    .replace(/^export\s+const/gm, "const")
    .replace(/^export\s+function/gm, "function");
  const sandbox = { module: { exports: {} }, exports: {} };
  const fn = new Function("module", "exports", `
    const t = (s) => s;
    ${body}
    module.exports = { INDEX, MECHANICS, BIGGER_PICTURE, PAGES, ORDER };
  `);
  fn(sandbox.module, sandbox.exports);
  return sandbox.module.exports;
}

function contentKeysForPage(page) {
  const keys = new Set();
  const add = (s) => { if (typeof s === "string" && s.trim()) keys.add(norm(s)); };
  const walkFact = (f) => { if (Array.isArray(f)) f.forEach((p) => add(p.text)); else add(f); };
  add(page.title); add(page.sub);
  for (const b of page.blocks) {
    if (b.kind === "intro") b.paras.forEach(add);
    if (b.kind === "section") {
      add(b.title); add(b.lede);
      (b.facts || []).forEach(walkFact);
      (b.trailingFacts || []).forEach(walkFact);
      add(b.footnoteText);
      if (b.internalCta) add(b.internalCta.label);
      if (b.externalCta) b.externalCta.forEach((l) => add(l.label));
      (b.rentStages || []).forEach(add);
      (b.stageRows || []).forEach((r) => { add(r.name); (r.vals || []).forEach((v) => { add(v.label); if (v.translateValue) add(v.value); }); });
    }
    if (b.kind === "table") { add(b.title); add(b.colLabel.a); add(b.colLabel.b); add(b.colLabel.c); b.rows.forEach((r) => { add(r.axis); add(r.a); add(r.b); add(r.c); }); }
    if (b.kind === "linkgroups") b.groups.forEach((g) => { add(g.title); add(g.lede); g.items.forEach((it) => { add(it.name); add(it.for); add(it.wont); }); });
    if (b.kind === "sources") b.links.forEach((l) => add(l.label));
    if (b.kind === "internal") b.links.forEach((l) => add(l.label));
    if (b.kind === "footnote") add(b.text);
  }
  return keys;
}

const PAGE_FILES = {
  rent: "solana-rent.html",
  wallet: "solana-wallet.html",
  mint: "solana-mint.html",
  buying: "solana-buying.html",
  transfers: "solana-transfers.html",
  fees: "solana-fees.html",
  uses: "solana-uses.html",
  markets: "solana-markets.html",
  events: "solana-events.html",
  links: "solana-links.html",
};

// Every website string this PR deliberately does NOT port, with the reason (this PR's own
// header comment in content.js, restated per-string here so a reviewer sees it inline). Cross-
// links to tools that are not the same in both app editions: LP Lab and Token Autopsy exist in
// neither Seeker app edition; Firepit exists only in the full/Seeker edition, never Play/iOS.
// Anything else missing here FAILS the test — that is the point.
const KNOWN_NOT_PORTED = {
  buying: [
    "Practice pool mechanics hands-on, free — LP Lab →",
    "A deeper forensic read on any mint → Token Autopsy",
  ],
  mint: [
    "A deeper forensic read on any mint → Token Autopsy",
  ],
  rent: [
    "Close an account you're finished with, safely, at /firepit →",
  ],
};

console.log("Solana Room — Seeker app vs. website parity\n");

const mod = loadContentModule();
const LANGS = ["es", "hi", "it", "pt", "vi", "zh"];
const dicts = {};
for (const l of LANGS) dicts[l] = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "i18n", `${l}.json`), "utf8"));

// Chrome the SolanaRoom.jsx component itself renders as hardcoded literal t() calls — not part
// of any one page's data in content.js, so contentKeysForPage() can't see them, but they ARE
// genuinely rendered for every ported page (the Sources card + the bottom "back to the room"
// link) or one specific one (the links page's per-item "For:" / "Won't tell you:" labels).
const COMMON_CHROME = ["Back to the Solana Room →"];
const LINKS_CHROME = ["For:", "Won't tell you:"];
// The rent page's stage-row labels are RentStages' own hardcoded literal t() calls in
// SolanaRoom.jsx (the numbers are live rent-math.js arithmetic, not per-page data — see
// content.js's own comment on `rentStages`), so they're not in contentKeysForPage()'s walk either.
const RENT_CHROME = ["Deposit required", "Surplus vs. the original"];
// The markets page's COL_LABEL values are read through a variable on the WEBSITE too
// (`t(COL_LABEL[key])`), and — unlike every other page's title/blurb table — the website's own
// __solanaMarketsGatedStrings doesn't list them, so they are not a literal t() call anywhere in
// solana-markets.html. That is a pre-existing gap in the SITE's own i18n audit coverage (not
// something this PR introduces or should silently paper over on the site), not app-side drift —
// this app ships them correctly translated regardless (the i18n-completeness check below proves
// it), so they're excused from the literal-call comparison only.
const MARKETS_SITE_GAP = ["On an exchange", "Self-custody", "Fund / ETF"];

const allContentKeys = new Set();

for (const id of Object.keys(PAGE_FILES)) {
  const page = mod.PAGES[id];
  ok(`content.js has a "${id}" page`, !!page);
  if (!page) continue;
  const site = siteKeys(PAGE_FILES[id]);
  const dataKeys = contentKeysForPage(page);
  dataKeys.forEach((k) => allContentKeys.add(k));

  // page.title / page.sub are the <h1> / eyebrow markup text, translated by the sitewide
  // dictionary observer rather than the page's own t() — same as the back-home link's "← THE
  // SOLANA ROOM". They're excluded from the literal-t()-call comparison below (both directions)
  // but stay in allContentKeys for the i18n-completeness check further down.
  const content = new Set(dataKeys);
  content.delete(norm(page.title));
  content.delete(norm(page.sub));
  COMMON_CHROME.forEach((k) => content.add(k));
  if (page.blocks.some((b) => b.kind === "sources")) content.add("Sources");
  if (id === "links") LINKS_CHROME.forEach((k) => content.add(k));
  if (id === "rent") RENT_CHROME.forEach((k) => content.add(k));
  if (id === "markets") MARKETS_SITE_GAP.forEach((k) => content.delete(k));

  // (1) app -> site: every ported string is a real, literal t() call on the website page.
  const notOnSite = [...content].filter((k) => !site.has(k));
  ok(`/solana/${id}: every content.js string is a literal t() call in ${PAGE_FILES[id]}`, notOnSite.length === 0, notOnSite.slice(0, 5));

  // (2) site -> app: every website string is ported, or named in KNOWN_NOT_PORTED.
  const excused = new Set(KNOWN_NOT_PORTED[id] || []);
  const notPorted = [...site].filter((k) => !content.has(k) && !excused.has(k));
  ok(`/solana/${id}: every ${PAGE_FILES[id]} string is ported (or named in KNOWN_NOT_PORTED)`, notPorted.length === 0, notPorted.slice(0, 8));

  // Every KNOWN_NOT_PORTED entry must actually exist on the site — an excuse for a string that
  // was never real would hide a typo, not a deliberate omission.
  const staleExcuses = [...excused].filter((k) => !site.has(k));
  ok(`/solana/${id}: KNOWN_NOT_PORTED entries are real website strings`, staleExcuses.length === 0, staleExcuses);
}

// The room index's own strings (the two group ledes, every topic BLURB) against solana-room.html.
// idx.title/idx.sub and every topic's own .title are header-markup / page-title duplicates (same
// exclusion as page.title/page.sub above) — not literal t() calls on the site either.
{
  const site = siteKeys("solana-room.html");
  const idx = mod.INDEX;
  // ⚠️ MECHANICS[0] (rent) is ALSO excluded from this comparison — solana-room.html's own
  // __solanaRoomGatedStrings starts at MECHANICS[1] ("What your wallet actually holds") and never
  // lists rent's own title or blurb as a literal call either. Same class of pre-existing site-side
  // gap as MARKETS_SITE_GAP above, not app-side drift.
  const idxKeys = [idx.intro, idx.mechanicsTitle, idx.mechanicsLede, idx.biggerTitle, idx.biggerLede, idx.readIt]
    .concat(mod.MECHANICS.slice(1).map((t) => t.blurb))
    .concat(mod.BIGGER_PICTURE.map((t) => t.blurb))
    .map(norm);
  [idx.title, idx.sub].concat(mod.MECHANICS.map((t) => t.title)).concat(mod.BIGGER_PICTURE.map((t) => t.title))
    .concat([mod.MECHANICS[0].blurb])
    .forEach((k) => allContentKeys.add(norm(k)));
  idxKeys.forEach((k) => allContentKeys.add(k));
  const notOnSite = idxKeys.filter((k) => !site.has(k));
  ok("the room index's own strings are all literal t() calls in solana-room.html", notOnSite.length === 0, notOnSite);
  // MECHANICS/BIGGER_PICTURE order and ids match the website's two topic lists exactly.
  ok("MECHANICS lists the same 6 pages, in the same order, as solana-room.html", JSON.stringify(mod.MECHANICS.map((t) => t.id)) === JSON.stringify(["rent", "wallet", "mint", "buying", "transfers", "fees"]));
  ok("BIGGER_PICTURE lists the same 4 ported pages, in the same order (phone excluded)", JSON.stringify(mod.BIGGER_PICTURE.map((t) => t.id)) === JSON.stringify(["uses", "markets", "events", "links"]));
}

// (3) every content string is translated in all six dictionaries.
for (const l of LANGS) {
  const missing = [...allContentKeys].filter((k) => !Object.prototype.hasOwnProperty.call(dicts[l], k));
  ok(`${l}.json translates every Solana Room string the app renders (${allContentKeys.size} total)`, missing.length === 0, missing.slice(0, 5));
}

// solana-phone.html is deliberately excluded from this PR (content.js's own header, and the task
// brief) — pin that PAGE_FILES/PAGES never grows an eleventh id by accident.
ok("solana-phone is NOT ported in this PR (held for a follow-up)", !mod.PAGES.phone && !Object.values(PAGE_FILES).includes("solana-phone.html"));

// The mint page's two example addresses, byte-for-byte — same reasoning as
// scripts/solana-room-test.cjs's own check: a typo'd address on a page about impersonation would
// be its own disaster.
{
  const SKR_REAL_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
  const SKR_FAKE_MINT = "79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj";
  const src = fs.readFileSync(path.join(ROOT, "src", "seeker", "solana", "content.js"), "utf8");
  ok("content.js carries the real SKR mint byte-for-byte", src.includes(SKR_REAL_MINT));
  ok("content.js carries the impersonator mint byte-for-byte", src.includes(SKR_FAKE_MINT));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// (4) rendered, offline, from the BUILT seeker bundle — /solana and /solana/rent actually show
// real headings at 360x800 with every network request refused (a static room needs nothing else).
// ════════════════════════════════════════════════════════════════════════════════════════════
(async () => {
  let pw = null;
  for (const c of ["playwright", "playwright-core", path.join(ROOT, "node_modules", "playwright")]) {
    try { pw = require(c); break; } catch (_) {}
  }
  if (!pw) {
    console.log("  · Playwright not available — skipping the rendered offline check");
  } else {
    const http = require("http");
    const os = require("os");
    const { execFileSync } = require("child_process");
    const distDir = path.join(ROOT, "dist-seeker");
    if (!fs.existsSync(path.join(distDir, "seeker.html"))) {
      console.log("  · dist-seeker/ not built (run: STORE_EDITION=seeker npx vite build --outDir dist-seeker) — skipping the rendered check");
    } else {
      const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
      // Static files the seeker bundle needs that live in public/ (not copied into dist-seeker
      // by a no-publicDir build) — served from ROOT/public alongside dist-seeker's own assets,
      // same layered approach the app uses in production (server.js's static routes).
      const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split("?")[0]);
        if (p === "/" || p === "/index.html") p = "/seeker.html";
        const distFp = path.join(distDir, p);
        const pubFp = path.join(ROOT, "public", p);
        const fp = fs.existsSync(distFp) && !fs.statSync(distFp).isDirectory() ? distFp
          : (fs.existsSync(pubFp) && !fs.statSync(pubFp).isDirectory() ? pubFp : null);
        if (!fp) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": mime[path.extname(fp)] || "application/octet-stream" });
        fs.createReadStream(fp).pipe(res);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      const findChromium = () => {
        for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) if (fs.existsSync(p)) return p;
        return undefined;
      };
      const browser = await pw.chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
      try {
        // A real Solana address, offline: every request to any host OTHER than 127.0.0.1 is
        // aborted — proving the room renders with no network at all, not merely "didn't happen
        // to fetch this run".
        const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
        let blockedExternal = 0;
        await page.route("**/*", (route) => {
          const u = new URL(route.request().url());
          if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") { blockedExternal++; route.abort(); return; }
          route.continue();
        });
        await page.goto(`http://127.0.0.1:${port}/#/solana`, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForSelector(".seeker-solana h1", { timeout: 15000 });
        const indexH1 = await page.locator(".seeker-solana h1").innerText();
        ok("rendered offline: /solana shows a real heading", /Solana Room/i.test(indexH1), indexH1);
        const topicCount = await page.locator(".seeker-solana-topic").count();
        ok("rendered offline: /solana lists both topic groups' pages", topicCount === 10, topicCount);

        await page.locator('.seeker-solana-topic-link[href="#/solana/rent"]').first().click();
        await page.waitForSelector(".seeker-solana h1", { timeout: 15000 });
        const rentH1 = await page.locator(".seeker-solana h1").innerText();
        ok("rendered offline: /solana/rent shows its own heading after in-app navigation", /deposit/i.test(rentH1), rentH1);
        const scamCard = await page.locator(".seeker-solana-card.scam").count();
        ok("rendered offline: /solana/rent carries at least one scam-warning card", scamCard >= 1, scamCard);
        ok("rendered offline: no request ever left 127.0.0.1 (a static room needs no network)", blockedExternal === 0, blockedExternal);
      } finally {
        await browser.close();
        server.close();
      }
    }
  }

  console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `\nall passed (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
