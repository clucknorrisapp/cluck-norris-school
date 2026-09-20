#!/usr/bin/env node
"use strict";
// AA1 follow-up (Colosseum roadmap §14 DD2 + §11 AA1) — "follow a wallet without a project":
// GET /api/hub/wallet/:wallet/feed.json (JSON Feed 1.1) and GET /hub/wallet/:wallet/feed.xml
// (RSS 2.0), the per-wallet twin of scripts/hub-feed-test.cjs's per-project feed. Both are
// composed ONLY from lib/hub/feed.js's buildWalletFeedItems() over the same public views every
// other Hub read route already shares (hubProjectView/hubPublic.walletLookup, the exact per-batch
// reproducibility rows /api/hub/:project/reproducibility publishes).
//
// Boots the real server against a throwaway DATA_DIR seeded with THREE registered projects:
//   - project A (a HOSTILE label — "<b>Evil</b> & Co", the XSS/XML-injection shape scripts/
//     hub-og-test.cjs already uses for this exact escaping class of bug): two published versions
//     (the first with an observed on-chain commitment), a batch that pays the fixture WALLET, and
//     a SECOND batch that pays a different wallet only — proving batch-level scoping, not just
//     project-level scoping.
//   - project B (a plain label): one published version, and a batch reusing the SAME batch id
//     string as project A's own batch ("batch-1") — proving item ids are namespaced per project,
//     never colliding across two projects that happen to share a batch id or a version number.
//   - project C: has activity, but never for WALLET at all — WALLET must not appear in it, so
//     nothing from project C may ever reach WALLET's feed.
//
// What must hold:
//   - both routes 200 for WALLET, and list the SAME item ids in the SAME order
//   - JSON parses; the RSS is parsed with a real (non-regex) hand-rolled XML tree parser — entity
//     decoding round-trips the hostile label back to its exact original text, which is the
//     strongest proof the escaping is both correct AND well-formed (a raw unescaped "<" or "&"
//     would make this parser throw, not just look wrong under a regex)
//   - only batch-1 (not batch-2) appears for project A; project B's batch-1 is a DISTINCT item
//     from project A's batch-1; project C contributes nothing
//   - a wallet with zero activity anywhere gets a valid, well-formed, EMPTY feed (200, not 404,
//     not a crash)
//   - a malformed or oversized address is refused 400 on both routes, before any project is ever
//     walked
//
// Usage: node scripts/hub-wallet-feed-test.cjs
// Env:   HUB_WALLET_FEED_TEST_PORT (default 3368)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.HUB_WALLET_FEED_TEST_PORT || 3368);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

// ── a small, REAL, tree-based XML parser (no library, no regex-driven decisions) — deliberately
// zero-dependency, matching this job's own posture (node-check installs no browser). Handles the
// prolog, comments, attributes, self-closing tags, nested elements and the five standard XML
// entities + numeric character references. Throws on any structural problem (mismatched or
// unterminated tags, trailing content) rather than reporting a soft "looks fine". ─────────────────
function decodeXmlEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[ent];
  });
}
function parseXml(xml) {
  let i = 0;
  const n = xml.length;
  const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  function skipMisc() {
    for (;;) {
      while (i < n && isSpace(xml[i])) i++;
      if (xml.slice(i, i + 5) === "<?xml" || xml.slice(i, i + 2) === "<?") { const end = xml.indexOf("?>", i); if (end < 0) throw new Error("unterminated <?...?>"); i = end + 2; continue; }
      if (xml.slice(i, i + 4) === "<!--") { const end = xml.indexOf("-->", i); if (end < 0) throw new Error("unterminated comment"); i = end + 3; continue; }
      break;
    }
  }
  function parseElement() {
    if (xml[i] !== "<") throw new Error(`expected "<" at offset ${i}`);
    i++;
    const nameStart = i;
    while (i < n && !isSpace(xml[i]) && xml[i] !== "/" && xml[i] !== ">") i++;
    const name = xml.slice(nameStart, i);
    if (!name) throw new Error(`empty tag name at offset ${nameStart}`);
    const attrs = {};
    for (;;) {
      while (i < n && isSpace(xml[i])) i++;
      if (xml.slice(i, i + 2) === "/>") { i += 2; return { name, attrs, children: [], text: "" }; }
      if (xml[i] === ">") { i++; break; }
      const attrStart = i;
      while (i < n && xml[i] !== "=" && !isSpace(xml[i]) && xml[i] !== ">" && xml[i] !== "/") i++;
      const attrName = xml.slice(attrStart, i);
      while (i < n && isSpace(xml[i])) i++;
      if (xml[i] !== "=") throw new Error(`expected "=" after attribute "${attrName}" at offset ${i}`);
      i++;
      while (i < n && isSpace(xml[i])) i++;
      const quote = xml[i];
      if (quote !== '"' && quote !== "'") throw new Error(`expected quoted attribute value at offset ${i}`);
      i++;
      const valStart = i;
      while (i < n && xml[i] !== quote) i++;
      if (i >= n) throw new Error(`unterminated attribute value for "${attrName}"`);
      attrs[attrName] = decodeXmlEntities(xml.slice(valStart, i));
      i++;
    }
    const children = [];
    let text = "";
    for (;;) {
      if (i >= n) throw new Error(`unterminated element <${name}>`);
      if (xml[i] === "<") {
        if (xml.slice(i, i + 2) === "</") {
          i += 2;
          const closeStart = i;
          while (i < n && xml[i] !== ">") i++;
          if (i >= n) throw new Error(`unterminated closing tag for <${name}>`);
          const closeName = xml.slice(closeStart, i).trim();
          i++;
          if (closeName !== name) throw new Error(`mismatched close tag </${closeName}> — expected </${name}>`);
          return { name, attrs, children, text: decodeXmlEntities(text) };
        }
        if (xml.slice(i, i + 4) === "<!--") { const end = xml.indexOf("-->", i); if (end < 0) throw new Error("unterminated comment"); i = end + 3; continue; }
        children.push(parseElement());
      } else {
        text += xml[i]; i++;
      }
    }
  }
  skipMisc();
  const root = parseElement();
  while (i < n) { if (isSpace(xml[i])) { i++; continue; } throw new Error(`trailing content after root element at offset ${i}: ${JSON.stringify(xml.slice(i, i + 40))}`); }
  return root;
}
const childrenOf = (node, tag) => (node && node.children ? node.children.filter((c) => c.name === tag) : []);
const childOf = (node, tag) => childrenOf(node, tag)[0] || null;

// ── fixture: three registered projects, one with a hostile label ───────────────────────────────
const proj = require(path.join(ROOT, "lib", "hub", "project"));
const commit = require(path.join(ROOT, "lib", "hub", "commit"));

const HOSTILE_LABEL = "<b>Evil</b> & Co";   // the exact fixture scripts/hub-og-test.cjs uses
const PROJECT_A = "wfeeda", PROJECT_B = "wfeedb", PROJECT_C = "wfeedc";
const MINT_A = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const MINT_B = "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo";
const MINT_C = "A75SXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaKSp1";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET = fakeAddr(31);         // the wallet under test — in A and B, never in C
const WALLET_OTHER = fakeAddr(32);   // in A's second batch and in C — never in WALLET's feed
const UNSEEN_WALLET = fakeAddr(99);  // valid shape, appears nowhere
const SIG_A1 = fakeSig(41), SIG_A2 = fakeSig(42), SIG_B1 = fakeSig(43), SIG_C1 = fakeSig(44), COMMIT_SIG = fakeSig(45);
const T0 = 1_800_000_000; // fixed unix seconds — never a live clock

function buildFixture() {
  // ── project A: hostile label, two versions (v1 committed), two batches ──
  const projectA = proj.validateProject(
    { id: PROJECT_A, label: HOSTILE_LABEL, symbol: "WFA", mint: MINT_A, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const termsBase = { poolDailyRaw: "1000000000000", sharePct: 5, maxSharePct: 25, maxTermDays: 540, payoutSchedule: "weekly", minDurationDays: 90, fundedBy: [FUND] };
  let stateA = proj.createVersion({}, projectA, termsBase, { effectiveFrom: "2026-01-01", todayKey: "2026-01-01" });
  stateA = proj.createVersion(stateA, projectA, { ...termsBase, minDurationDays: 60 }, { effectiveFrom: "2026-02-01", todayKey: "2026-01-01" });
  const aV1 = stateA.versions[0], aV2 = stateA.versions[1];
  const commitment = { sig: COMMIT_SIG, slot: 55555, observedAt: T0 + 100, memo: commit.memoText(PROJECT_A, aV1.version, aV1.hash) };
  const appliedA = commit.applyCommitment(stateA, 0, commitment);
  ok("fixture: applyCommitment actually attached a commitment to project A's v1", appliedA.already === false && appliedA.commitment.sig === COMMIT_SIG);
  stateA = appliedA.state;

  const daysA = {
    "2027-02-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 },
    "2027-02-02T00": { credits: { [WALLET_OTHER]: "2000000000" }, at: T0 },
  };
  const batchesA = {
    "batch-1": { id: "batch-1", state: "sent", at: T0 + 3600, count: 1, totalRaw: "1000000000", amounts: { [WALLET]: "1000000000" }, sent: { [WALLET]: { sig: SIG_A1, at: T0 + 3660 } } },
    "batch-2": { id: "batch-2", state: "sent", at: T0 + 7200, count: 1, totalRaw: "2000000000", amounts: { [WALLET_OTHER]: "2000000000" }, sent: { [WALLET_OTHER]: { sig: SIG_A2, at: T0 + 7260 } } },
  };

  // ── project B: plain label, one version, a batch reusing "batch-1" as its own id ──
  const projectB = proj.validateProject(
    { id: PROJECT_B, label: "Wallet Feed Test B", symbol: "WFB", mint: MINT_B, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const stateB = proj.createVersion({}, projectB, termsBase, { effectiveFrom: "2026-03-01", todayKey: "2026-01-01" });
  const bV1 = stateB.versions[0];
  const daysB = { "2027-03-01T00": { credits: { [WALLET]: "500000000" }, at: T0 } };
  const batchesB = { "batch-1": { id: "batch-1", state: "sent", at: T0 + 10800, count: 1, totalRaw: "500000000", amounts: { [WALLET]: "500000000" }, sent: { [WALLET]: { sig: SIG_B1, at: T0 + 10860 } } } };

  // ── project C: has activity, but never for WALLET ──
  const projectC = proj.validateProject(
    { id: PROJECT_C, label: "Wallet Feed Test C", symbol: "WFC", mint: MINT_C, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const stateC = proj.createVersion({}, projectC, termsBase, { effectiveFrom: "2026-04-01", todayKey: "2026-01-01" });
  const daysC = { "2027-04-01T00": { credits: { [WALLET_OTHER]: "700000000" }, at: T0 } };
  const batchesC = { "batch-1": { id: "batch-1", state: "sent", at: T0 + 14400, count: 1, totalRaw: "700000000", amounts: { [WALLET_OTHER]: "700000000" }, sent: { [WALLET_OTHER]: { sig: SIG_C1, at: T0 + 14460 } } } };

  const fixture = {
    "hub:projects": {
      [PROJECT_A]: { id: PROJECT_A, label: HOSTILE_LABEL, symbol: "WFA", mint: MINT_A, decimals: 9, rewardMint: MINT_A, rewardDecimals: 9, status: "approved" },
      [PROJECT_B]: { id: PROJECT_B, label: "Wallet Feed Test B", symbol: "WFB", mint: MINT_B, decimals: 9, rewardMint: MINT_B, rewardDecimals: 9, status: "approved" },
      [PROJECT_C]: { id: PROJECT_C, label: "Wallet Feed Test C", symbol: "WFC", mint: MINT_C, decimals: 9, rewardMint: MINT_C, rewardDecimals: 9, status: "approved" },
    },
    [`program:${PROJECT_A}:state`]: stateA, [`program:${PROJECT_A}:days`]: daysA, [`program:${PROJECT_A}:batches`]: batchesA, [`program:${PROJECT_A}:paid`]: {},
    [`program:${PROJECT_B}:state`]: stateB, [`program:${PROJECT_B}:days`]: daysB, [`program:${PROJECT_B}:batches`]: batchesB, [`program:${PROJECT_B}:paid`]: {},
    [`program:${PROJECT_C}:state`]: stateC, [`program:${PROJECT_C}:days`]: daysC, [`program:${PROJECT_C}:batches`]: batchesC, [`program:${PROJECT_C}:paid`]: {},
  };
  return { fixture, aV1, aV2, bV1 };
}

async function getJson(p) { const r = await fetch(BASE + p); let body = null; try { body = await r.json(); } catch (_) {} return { r, body }; }
async function getText(p) { const r = await fetch(BASE + p); return { r, text: await r.text() }; }

(async () => {
  console.log("\nHub wallet feed — JSON Feed + RSS across every project a wallet appears in (AA1 follow-up)\n");
  const { fixture, aV1, aV2, bV1 } = buildFixture();

  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-wallet-feed-test-"));
  fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(fixture));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }

  const EXPECT_IDS = [
    `${PROJECT_A}:version:v${aV1.version}`, `${PROJECT_A}:version:v${aV2.version}`,
    `${PROJECT_A}:commitment:${COMMIT_SIG}`,
    `${PROJECT_A}:batch:batch-1`,
    `${PROJECT_B}:version:v${bV1.version}`,
    `${PROJECT_B}:batch:batch-1`,
  ].sort();

  try {
    console.log("1. GET /api/hub/wallet/:wallet/feed.json\n");
    const { r: r1, body: body1raw } = await getJson(`/api/hub/wallet/${WALLET}/feed.json`);
    const text1 = JSON.stringify(body1raw);
    ok("200", r1.status === 200, String(r1.status));
    ok("Content-Type is application/feed+json", (r1.headers.get("content-type") || "").includes("application/feed+json"), r1.headers.get("content-type"));
    ok("carries an ETag", !!r1.headers.get("etag"));
    ok("version is the JSON Feed 1.1 URL", body1raw && body1raw.version === "https://jsonfeed.org/version/1.1", JSON.stringify(body1raw && body1raw.version));
    ok("feed_url is absolute and ends in this wallet's feed.json", new RegExp(`^https?://.*/api/hub/wallet/${WALLET}/feed\\.json$`).test((body1raw && body1raw.feed_url) || ""), body1raw && body1raw.feed_url);
    const items1 = (body1raw && body1raw.items) || [];
    const shapeOk = items1.every((it) => typeof it.id === "string" && it.id.length > 0
      && typeof it.url === "string" && /^https?:\/\//.test(it.url)
      && typeof it.title === "string" && it.title.length > 0
      && typeof it.content_text === "string" && it.content_text.length > 0
      && typeof it.date_published === "string" && !Number.isNaN(new Date(it.date_published).getTime()));
    ok("every item has id/url/title/content_text/date_published, correctly typed", shapeOk, JSON.stringify(items1, null, 2));
    const ids1 = items1.map((x) => x.id);
    ok("items[].id are all unique", new Set(ids1).size === ids1.length, JSON.stringify(ids1));
    ok("ids are exactly the expected 6 — project A's batch-2 (didn't pay WALLET) and all of project C are excluded", JSON.stringify([...ids1].sort()) === JSON.stringify(EXPECT_IDS), JSON.stringify(ids1));
    const dates1 = items1.map((x) => x.date_published);
    ok("items are ordered newest first", JSON.stringify(dates1) === JSON.stringify([...dates1].sort().reverse()), JSON.stringify(dates1));
    ok("no id from project A's OTHER batch (batch-2, paid WALLET_OTHER, not WALLET)", !ids1.includes(`${PROJECT_A}:batch:batch-2`), JSON.stringify(ids1));
    ok("no id from project C anywhere (WALLET has zero entries there)", !ids1.some((id) => id.startsWith(`${PROJECT_C}:`)), JSON.stringify(ids1));

    const byId1 = Object.fromEntries(items1.map((x) => [x.id, x]));
    const hostileItem = byId1[`${PROJECT_A}:batch:batch-1`];
    ok("JSON Feed carries the hostile label VERBATIM (JSON needs no HTML/XML escaping)", hostileItem && hostileItem.title.startsWith(HOSTILE_LABEL + " — "), hostileItem && hostileItem.title);
    ok("project B's batch-1 is a DISTINCT item id from project A's batch-1 (namespaced by project)", !!byId1[`${PROJECT_B}:batch:batch-1`] && byId1[`${PROJECT_B}:batch:batch-1`] !== hostileItem);
    ok("batch item's summary carries the reproducibility ratio, not a claim of 'verified'", hostileItem && /\b1 of 1\b/.test(hostileItem.content_text) && !/verified/i.test(hostileItem.content_text), hostileItem && hostileItem.content_text);

    console.log("\n2. GET /hub/wallet/:wallet/feed.xml — parsed with a REAL (non-regex) XML tree parser\n");
    const { r: r2, text: xml } = await getText(`/hub/wallet/${WALLET}/feed.xml`);
    ok("200", r2.status === 200, String(r2.status));
    ok("Content-Type is application/rss+xml", (r2.headers.get("content-type") || "").includes("application/rss+xml"), r2.headers.get("content-type"));
    ok("carries an ETag", !!r2.headers.get("etag"));

    let doc = null, parseErr = null;
    try { doc = parseXml(xml); } catch (e) { parseErr = e; }
    ok("RSS parses as well-formed XML with a real tree parser (no regex heuristics)", !!doc && !parseErr, parseErr && parseErr.message);
    ok("root element is <rss>", doc && doc.name === "rss");
    const channel = doc && childOf(doc, "channel");
    ok("has exactly one <channel>", !!channel);
    const itemNodes = channel ? childrenOf(channel, "item") : [];
    ok("RSS has exactly 6 <item> elements", itemNodes.length === 6, String(itemNodes.length));

    const guids2 = itemNodes.map((it) => (childOf(it, "guid") || {}).text || "");
    ok("RSS guids are the SAME 6 ids, same set as the JSON feed", JSON.stringify([...guids2].sort()) === JSON.stringify(EXPECT_IDS), JSON.stringify(guids2));
    ok("RSS lists items in the SAME ORDER as the JSON feed", JSON.stringify(guids2) === JSON.stringify(ids1), `xml: ${JSON.stringify(guids2)}\n      json: ${JSON.stringify(ids1)}`);
    for (const it of itemNodes) ok(`guid ${((childOf(it, "guid") || {}).text)}: isPermaLink="false"`, (childOf(it, "guid") || {}).attrs && childOf(it, "guid").attrs.isPermaLink === "false");

    // ── the assertion that matters most: the hostile label round-trips exactly through the real
    // parser's entity decoding — proof the raw XML both escaped it correctly (or this parser would
    // have thrown on a stray "<" or "&") and did not double-escape it. ──────────────────────────
    const hostileNode = itemNodes.find((it) => (childOf(it, "guid") || {}).text === `${PROJECT_A}:batch:batch-1`);
    ok("raw XML bytes contain the ESCAPED form, never a literal unescaped tag", xml.includes("&lt;b&gt;Evil&lt;/b&gt; &amp; Co"), xml.slice(0, 400));
    ok("raw XML bytes never contain the literal, unescaped hostile label", !xml.includes(HOSTILE_LABEL));
    const hostileTitle = hostileNode && childOf(hostileNode, "title");
    ok("parsed + entity-decoded <title> recovers the EXACT original hostile label text", hostileTitle && hostileTitle.text.startsWith(HOSTILE_LABEL + " — "), hostileTitle && hostileTitle.text);
    const hostileDesc = hostileNode && childOf(hostileNode, "description");
    ok("parsed + entity-decoded <description> recovers the exact original hostile label text too", hostileDesc && hostileDesc.text.startsWith(HOSTILE_LABEL + ":"), hostileDesc && hostileDesc.text);

    console.log("\n3. An unseen wallet gets a valid, well-formed, EMPTY feed — never a 404, never a crash\n");
    {
      const { r, body } = await getJson(`/api/hub/wallet/${UNSEEN_WALLET}/feed.json`);
      ok("200 (not 404/500)", r.status === 200, String(r.status));
      ok("version is still the JSON Feed 1.1 URL", body && body.version === "https://jsonfeed.org/version/1.1");
      ok("items is an empty array", Array.isArray(body && body.items) && body.items.length === 0, JSON.stringify(body));
      const { r: rx, text: xmlEmpty } = await getText(`/hub/wallet/${UNSEEN_WALLET}/feed.xml`);
      ok("200 (not 404/500)", rx.status === 200, String(rx.status));
      let docEmpty = null, e2 = null;
      try { docEmpty = parseXml(xmlEmpty); } catch (e) { e2 = e; }
      ok("empty feed is still well-formed XML", !!docEmpty && !e2, e2 && e2.message);
      const chEmpty = docEmpty && childOf(docEmpty, "channel");
      ok("empty feed has zero <item> elements", chEmpty && childrenOf(chEmpty, "item").length === 0);
    }

    console.log("\n4. Malformed / oversized address — 400 on both routes, before any project is walked\n");
    {
      let r = await fetch(`${BASE}/api/hub/wallet/not-an-address/feed.json`);
      let body = await r.json();
      ok("malformed address: 400 on feed.json", r.status === 400, String(r.status));
      ok("malformed address: honest reason", body && body.ok === false && /not a Solana address/i.test(body.error || ""), JSON.stringify(body));
      r = await fetch(`${BASE}/hub/wallet/not-an-address/feed.xml`);
      body = await r.json();
      ok("malformed address: 400 on feed.xml", r.status === 400, String(r.status));
      ok("malformed address: honest reason on feed.xml too", body && body.ok === false && /not a Solana address/i.test(body.error || ""), JSON.stringify(body));

      const OVERSIZED = "1".repeat(200);
      r = await fetch(`${BASE}/api/hub/wallet/${OVERSIZED}/feed.json`);
      ok("oversized address: 400, never reaches a store lookup", r.status === 400, String(r.status));
      r = await fetch(`${BASE}/hub/wallet/${OVERSIZED}/feed.xml`);
      ok("oversized address: 400 on feed.xml too", r.status === 400, String(r.status));
    }

    console.log("\n5. Route ordering — /hub/wallet/:wallet/feed.xml resolves to the literal route, never the wallet-page catch-all\n");
    {
      const { text: xmlAgain } = await getText(`/hub/wallet/${WALLET}/feed.xml`);
      ok("feed.xml did not fall through to the hub-wallet.html shell", !xmlAgain.includes("<!DOCTYPE html") && !xmlAgain.includes("One Wallet, Every Project"), xmlAgain.slice(0, 120));
    }

    console.log("\n6. No private field, no forbidden word, in either body\n");
    const PRIVATE_FIELDS = ["operatorWallets", "payoutSourcesHistory", "desk"];
    const FORBIDDEN_WORDS = [/\bverified\b/i, /\baudited\b/i, /\bsafe\b/i, /\bguaranteed\b/i, /\bAPR\b/, /\bAPY\b/, /\byield\b/i, /Normie Quest/i, /Wallet Watch/i];
    for (const body of [text1, xml]) {
      for (const f of PRIVATE_FIELDS) ok(`no "${f}" in the body`, !body.includes(f));
      for (const re of FORBIDDEN_WORDS) ok(`no forbidden word ${re} in the body`, !re.test(body));
    }

    console.log("\n7. The /hub/wallet/<address> page carries a follow link to both feeds\n");
    {
      const { text } = await getText(`/hub/wallet/${WALLET}`);
      ok("page mentions following this wallet", /Follow this wallet/i.test(text), text.slice(0, 200));
      ok("page's script builds a link to the JSON feed route", text.includes("/feed.json"));
      ok("page's script builds a link to the RSS feed route", text.includes("/feed.xml"));
    }
  } finally {
    done();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", (e && e.stack) || e); process.exit(1); });
