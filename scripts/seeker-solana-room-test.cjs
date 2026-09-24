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

// solana-phone.html is not ported into content.js (content.js's own header) — it's ported below
// into the SEEKER-EDITION-ONLY wing instead (src/seeker/solana/wing-content.js). Pin that
// PAGE_FILES/PAGES (the shared room, reachable by both editions) never grows an eleventh id.
ok("solana-phone is not in the SHARED room's content.js (it's Seeker-wing-only — see below)", !mod.PAGES.phone && !Object.values(PAGE_FILES).includes("solana-phone.html"));

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
// The SEEKER WING — src/seeker/solana/wing-content.js, registered only in full.jsx (never
// edu.jsx). Same two checks as every page above, but against public/solana-phone.html, whose
// content is now split across the wing's five pages rather than one — so both directions are
// checked against the UNION of every wing page's strings, not any single one.
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\nThe Seeker wing — parity with public/solana-phone.html\n");
{
  const wingFp = path.join(ROOT, "src", "seeker", "solana", "wing-content.js");
  ok("src/seeker/solana/wing-content.js exists", fs.existsSync(wingFp));
  const wingSrc = fs.readFileSync(wingFp, "utf8")
    .replace(/^import\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?$/gm, "")
    .replace(/^export\s+const/gm, "const")
    .replace(/^export\s+function/gm, "function");
  const wingFn = new Function("module", `
    const t = (s) => s;
    ${wingSrc}
    module.exports = { WING_ORDER, WING_INDEX, WING_TOPICS, WING_PAGES };
  `);
  const wingSandbox = { module: { exports: {} } };
  wingFn(wingSandbox.module);
  const wing = wingSandbox.module.exports;

  ok("wing-content.js exports the 5 Seeker-wing pages, in order", JSON.stringify(wing.WING_ORDER) === JSON.stringify(["skr", "phone", "seedvault", "mwa", "dappstore"]));

  const phoneSite = siteKeys("solana-phone.html");
  const wingKeys = new Set();
  const wAdd = (s) => { if (typeof s === "string" && s.trim()) wingKeys.add(norm(s)); };
  const wWalkFact = (f) => { if (Array.isArray(f)) f.forEach((p) => wAdd(p.text)); else wAdd(f); };
  for (const id of wing.WING_ORDER) {
    const page = wing.WING_PAGES[id];
    ok(`wing has a "${id}" page`, !!page);
    if (!page) continue;
    for (const b of page.blocks) {
      if (b.kind === "intro") b.paras.forEach(wAdd);
      if (b.kind === "section") {
        wAdd(b.title);
        (b.facts || []).forEach(wWalkFact);
        (b.trailingFacts || []).forEach(wWalkFact);
        wAdd(b.footnoteText);
        if (b.internalCta) wAdd(b.internalCta.label);
        (b.stageRows || []).forEach((r) => { wAdd(r.name); (r.vals || []).forEach((v) => { wAdd(v.label); if (v.translateValue) wAdd(v.value); }); });
      }
      if (b.kind === "sources") b.links.forEach((l) => wAdd(l.label));
      if (b.kind === "internal") b.links.forEach((l) => wAdd(l.label));
    }
    // "Sources" is SeekerWing.jsx's own hardcoded chrome (its <Sources> component), same as
    // SolanaRoom.jsx's own — not per-page data, so the walk above can't see it.
    if (page.blocks.some((b) => b.kind === "sources")) wAdd("Sources");
  }
  // SeekerWing.jsx's own hardcoded bottom-of-page chrome, same reasoning as "Sources" above.
  wAdd("Back to the Solana Room →");

  // (1) wing -> site: every string ported FROM solana-phone.html must be a real literal t() call
  // there. NEW copy (written for the wing, not the website) is excused by name.
  const WING_NEW_COPY = new Set([
    // Room-index / wing-index chrome, and per-page intros/sections written for this wing.
    norm(wing.WING_INDEX.title), norm(wing.WING_INDEX.lede),
    ...wing.WING_TOPICS.flatMap((t) => [norm(t.title), norm(t.blurb)]),
    "SKR is Solana Mobile's own token — network rewards for Seeker owners, published by Solana Mobile itself. A plain web search for it turns up an impersonator first. Here's the real mint, the fake one, what SKR actually is, and the one thing it does inside this app.",
    "What SKR does in this app",
    "Nothing is gated behind SKR here. Every heavy tool already has two other free doors — holding CLKN, or paying the small SOL pass — and SKR only ever adds a third door. It never removes either of the other two, and nothing in this app requires it.",
    "Coming: a way to hold a lifetime pass instead of a wallet balance being checked every time you run a tool. Not shipped yet.",
    "What Seeker adds is hardware and software built specifically for holding keys and approving transactions, which the rest of this room covers.",
    "Seed Vault: where your keys actually live →", "Mobile Wallet Adapter: how signing actually works →",
    "The Solana dApp Store →", "SKR, and telling the real mint from the impersonator →",
    "On most phones, a wallet is just an app, holding your key inside its own storage. Seed Vault is Solana Mobile's answer to that — hardware built specifically so no app, including this one, ever gets to hold the key at all.",
    "What this app can and can't see",
    "This app never asks for, receives, or stores a seed phrase or a private key — not in Seed Vault, not anywhere. Every action that moves funds or signs anything is built here, then handed to your wallet app to approve and sign, exactly the way Mobile Wallet Adapter works.",
    "What this app CAN see is only what you approve it to see: your public address, and the result of a transaction you already signed. It never sees your key, and it can't sign anything on its own.",
    "How that handshake actually works →",
    "Every time this app asks you to approve something — locking tokens, burning a supply, reclaiming rent — it's using the same protocol underneath: Mobile Wallet Adapter. Here's what that sheet actually is, and why this app never touches your key.",
    "What \"sign\" authorises, in this app's own confirm sheets",
    "Every confirm sheet in this app — before a lock, a burn, a transfer, a reclaim — shows you exactly what it is about to ask your wallet to sign, the same detail Mobile Wallet Adapter shows: the instructions, the amounts, the recipient. Approving it authorises that one transaction, once. It does not hand this app standing permission to do anything else, and it does not hand this app your key.",
    "If a confirm sheet or a wallet's own MWA prompt ever shows something different from what you expected, the answer is the same one crypto safety always comes down to: decline it, and check before you sign again.",
    "This app itself is published on the Solana dApp Store — a second Android app store, built specifically for apps that use wallets, tokens and other on-chain features.",
    "We publish our own school there too — the same free lessons that live at clucknorris.app, wrapped for the dApp Store. Saying so here, in the section where we're describing the store, is the honest way to mention it.",
    "How an update reaches your phone",
    "This app you're reading this page in is that same listing. An update to it is published to the dApp Store the same way any app update is published to any store; the store checks for and delivers it, not this app itself.",
    // Reused from content.js's "mint" page stageRows (already-translated, zero new copy there),
    // not from solana-phone.html — the wing's skr page uses THAT comparison table instead of
    // solana-phone.html's own richer MINT_AXES one (see KNOWN_NOT_PORTED_PHONE below).
    "SKR — the official mint", "Mint address", "Registry status", "Jupiter-verified", "Holders",
    "\"Seeker | Solana Mobile👇\" — an impersonator mint", "Unverified, no market cap",
    "Check a mint's authorities and your own approvals — free, read-only, no signup →",
  ].map(norm));
  const wingNotOnSite = [...wingKeys].filter((k) => !phoneSite.has(k) && !WING_NEW_COPY.has(k));
  ok("every wing string not marked as new copy is a literal t() call in solana-phone.html", wingNotOnSite.length === 0, wingNotOnSite.slice(0, 8));

  // (2) site -> wing: every solana-phone.html string is ported into the wing somewhere, or named
  // in KNOWN_NOT_PORTED_PHONE with a reason.
  // solana-phone.html's own real-vs-impersonator MINT_AXES table (Verified on Jupiter / Holders
  // (checked today) / organic score / Market) is NOT ported — the wing's skr page uses
  // content.js's own "mint" page stageRows for that comparison instead (already-translated,
  // same two addresses), rather than carrying two different-shaped comparison tables for the
  // same two mints. Everything else on the page is ported.
  const KNOWN_NOT_PORTED_PHONE = new Set([
    "Verified on Jupiter", "Holders (checked today)", "Jupiter's organic score", "Market",
    "The real SKR", "The impersonator", "Yes", "No", "~45,700", "4",
    "Actively scored", "0 — no real trading activity behind it",
    "Trades across dozens of pools on several exchanges", "No market cap, no meaningful liquidity",
    "The real SKR mint", "The impersonator mint",
    // Superseded by a reworded version carried in WING_NEW_COPY above ("...which the rest of
    // this room covers" instead of "...this page is about" — the content now spans 5 pages).
    "What Seeker adds is hardware and software built specifically for holding keys and approving transactions, which the rest of this page is about.",
    // The website's own sentence points at a disclosure block "at the bottom of this page" — the
    // wing's dappstore page carries a shorter version instead, and the disclosure itself moved to
    // the wing's phone page (see the "Where we stand" section, ported verbatim there).
    "We publish our own school there too — the same free lessons that live at clucknorris.app, wrapped for the dApp Store. Saying so here, in the section where we're describing the store, is the honest way to mention it; the disclosure at the bottom of this page says the same thing again on its own.",
    // The mint-address sentence is split around a <code> element on the website; the wing states
    // the same facts as whole sentences instead (its own intro plus content.js's mint stageRows).
    "SKR is the token of the Solana Mobile ecosystem: an SPL token with 6 decimals, at the mint address",
    ". It is verified on Jupiter, and its holder count is around 45,700, checked today.",
    // Cross-links to pages this wing doesn't carry (the shared room's /solana/mint,
    // /wallet-checkup outside this app's own /checkup route, and the plain /solana index link —
    // the wing's own internal links point at its in-app equivalents instead).
    "What a token mint is — the one address that defines a token →",
    "Wallet Checkup — a free safety read on any address, no wallet or signup needed →",
    "The Solana Room — how the rest of it actually works →",
    // The website's dated "Last checked … · maintained by Cluck Norris" footer has no per-page
    // equivalent in the wing (a static in-app room needs no live-currency disclosure the way a
    // standalone web page does — same posture as content.js's own ported pages, none of which
    // carry this line either).
    "Last checked 20 September 2026 · maintained by Cluck Norris",
  ].map(norm));
  const notPortedPhone = [...phoneSite].filter((k) => !wingKeys.has(k) && !KNOWN_NOT_PORTED_PHONE.has(k));
  ok("every solana-phone.html string is ported into the wing (or named in KNOWN_NOT_PORTED_PHONE)", notPortedPhone.length === 0, notPortedPhone.slice(0, 8));

  const wingRaw = fs.readFileSync(wingFp, "utf8");
  ok("wing-content.js carries the real SKR mint byte-for-byte", wingRaw.includes("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3"));
  ok("wing-content.js carries the impersonator mint byte-for-byte", wingRaw.includes("79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj"));

  // (3) translation completeness — the wing's OWN key extractor (scripts/seeker-i18n-keys.cjs's
  // wingContentKeys(), plus its normal source scan of SeekerWing.jsx's own hardcoded t()/tf()
  // calls) against all six dictionaries. Independent of the union used above.
  const { keys: allSeekerKeys } = require(path.join(ROOT, "scripts", "seeker-i18n-keys.cjs"));
  const seekerKeys = allSeekerKeys();
  const wingRelevant = seekerKeys.filter((k) => wingKeys.has(norm(k)) || WING_NEW_COPY.has(norm(k)));
  for (const l of LANGS) {
    const missing = wingRelevant.filter((k) => !Object.prototype.hasOwnProperty.call(dicts[l], k));
    ok(`${l}.json translates every Seeker-wing string this test found (${wingRelevant.length} checked)`, missing.length === 0, missing.slice(0, 5));
  }

  // The full/Seeker edition is the only one that can ever reach the wing — edu.jsx's own source
  // never mentions it, by construction (its import-list-is-the-safety-argument, same as
  // docs/STORE_EDITION.md). Nothing here should be able to change that unnoticed.
  const eduSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "edition", "edu.jsx"), "utf8");
  ok("edu.jsx never imports the Seeker wing", !/SeekerWing|wing-content/.test(eduSrc));
  const fullSrc = fs.readFileSync(path.join(ROOT, "src", "seeker", "edition", "full.jsx"), "utf8");
  ok("full.jsx registers the wing's route", /\/solana\/seeker\/:pageId/.test(fullSrc) && /SeekerWingPage/.test(fullSrc));
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
