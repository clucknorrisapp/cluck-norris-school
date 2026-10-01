#!/usr/bin/env node
"use strict";
// Colosseum roadmap §14 DD2 — "Follow a project without a wallet": GET /api/hub/:project/feed.json
// (JSON Feed 1.1) and GET /hub/:project/feed.xml (RSS 2.0), both composed ONLY from lib/hub/feed.js
// over the same public views/computations every other Hub read route already shares (hubProjectView,
// the exact per-batch reproducibility rows /api/hub/:project/reproducibility publishes, and
// lib/holders-snapshot.js's series()).
//
// Boots the real server against a throwaway DATA_DIR seeded with ONE registered project carrying:
//   - two published program versions (built through lib/hub/project.js, like scripts/hub-compare-
//     test.cjs's own fixture), the first with an observed on-chain commitment applied through
//     lib/hub/commit.js (the real B5 application function, not a hand-built object)
//   - one settled lock-to-earn batch paying two wallets, whose accrual credits are seeded to match
//     exactly (so the reproducibility ratio is a clean "2 of 2", checkable exactly)
//   - two holder snapshots, appended through the real lib/holders-snapshot.js appendSnapshot (so
//     listHash is the real computed hash, not a fixture value that could drift from the code)
//
// What must hold:
//   - JSON Feed validates against a minimal schema check (required keys/types; items[].id unique;
//     date_published is a valid ISO string)
//   - RSS is well-formed XML (the same dependency-free check scripts/hub-badge-test.cjs uses,
//     adapted for an <rss> root) with the expected item count
//   - both list the exact same ids, in the same order
//   - two fetches of EACH route are byte-identical (no live clock embedded in the body)
//   - a demo project 404s on both routes; an unknown project id 404s too
//   - no private field (operatorWallets, payoutSourcesHistory, desk) and no forbidden word
//     (verified/audited/safe/guaranteed, APR/APY/yield, Normie Quest, Wallet Watch) reaches either
//     body
//
// Usage: node scripts/hub-feed-test.cjs
// Env:   HUB_FEED_TEST_PORT (default 3367)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.HUB_FEED_TEST_PORT || 3367);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

// ── fixture: a real project, two program versions (one committed on-chain), one settled batch,
// two holder snapshots ──────────────────────────────────────────────────────────────────────────
const proj = require(path.join(ROOT, "lib", "hub", "project"));
const commit = require(path.join(ROOT, "lib", "hub", "commit"));
const holders = require(path.join(ROOT, "lib", "holders-snapshot"));

const PROJECT = "feedtest";
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET1 = fakeAddr(11), WALLET2 = fakeAddr(12);
const SIG1 = fakeSig(21), SIG2 = fakeSig(22), COMMIT_SIG = fakeSig(23);
const T0 = 1_800_000_000; // fixed unix seconds, a fixture clock — not live

// A tiny in-memory kv, the same shape lib/holders-snapshot.js needs (get/set/setVerified/
// entriesWithPrefix) — used ONLY to run the real appendSnapshot() so listHash/id are computed by
// the real code, then its whole backing object is merged straight into the server's app-state.json.
function memoryKv() {
  const state = {};
  return {
    state,
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
    set: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); },
    setVerified: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); return true; },
    entriesWithPrefix: (prefix) => Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => [k, state[k]]),
  };
}

function buildFixture() {
  const project = proj.validateProject(
    { id: PROJECT, label: "Feed Test Co", symbol: "FEDT", mint: MINT, fundingWallet: FUND, operatorWallets: [] },
    { decimals: 9, tokenProgram: TOK, extensions: [] },
  );
  const termsBase = { poolDailyRaw: "1000000000000", sharePct: 5, maxSharePct: 25, maxTermDays: 540, payoutSchedule: "weekly", minDurationDays: 90, fundedBy: [FUND] };
  let state = proj.createVersion({}, project, termsBase, { effectiveFrom: "2026-01-01", todayKey: "2026-01-01" });
  const termsV2 = { ...termsBase, minDurationDays: 60 };
  state = proj.createVersion(state, project, termsV2, { effectiveFrom: "2026-02-01", todayKey: "2026-01-01" });
  const v1 = state.versions[0], v2 = state.versions[1];

  // B5: an observed on-chain commitment for v1, applied through the real function — never a
  // hand-built object — so this fixture proves the actual apply path, not an assumption about it.
  const commitment = { sig: COMMIT_SIG, slot: 55555, observedAt: T0 + 100, memo: commit.memoText(PROJECT, v1.version, v1.hash) };
  const applied = commit.applyCommitment(state, 0, commitment);
  ok("fixture: applyCommitment actually attached a commitment to v1", applied.already === false && applied.commitment.sig === COMMIT_SIG);
  state = applied.state;

  const days = { "2027-02-01T00": { credits: { [WALLET1]: "1000000000", [WALLET2]: "2000000000" }, at: T0 } };
  const batches = {
    "hb-batch-1": {
      id: "hb-batch-1", state: "sent", at: T0 + 3600, count: 2, totalRaw: "3000000000",
      amounts: { [WALLET1]: "1000000000", [WALLET2]: "2000000000" },
      sent: { [WALLET1]: { sig: SIG1, at: T0 + 3660 }, [WALLET2]: { sig: SIG2, at: T0 + 3660 } },
    },
  };

  const snapKv = memoryKv();
  const topA = [{ wallet: WALLET1, amount: 500 }, { wallet: WALLET2, amount: 300 }];
  const topB = [{ wallet: WALLET1, amount: 650 }, { wallet: WALLET2, amount: 300 }];
  const snap1 = holders.appendSnapshot(snapKv, { mint: MINT, at: 1_700_000_000_000, holderCount: 2, top: topA, totalSupplyRaw: "10000", fullList: topA }).record;
  const snap2 = holders.appendSnapshot(snapKv, { mint: MINT, at: 1_700_100_000_000, holderCount: 2, top: topB, totalSupplyRaw: "10500", fullList: topB }).record;

  const fixture = {
    "hub:projects": {
      // status:"approved" — required for the lib/hub/routes.js program/:version lookup a version
      // item links to (not for server.js's own hubProjects(), which doesn't check status).
      [PROJECT]: { id: PROJECT, label: "Feed Test Co", symbol: "FEDT", mint: MINT, decimals: 9, rewardMint: MINT, rewardDecimals: 9, status: "approved" },
    },
    [`program:${PROJECT}:state`]: state,
    [`program:${PROJECT}:days`]: days,
    [`program:${PROJECT}:batches`]: batches,
    [`program:${PROJECT}:paid`]: {},
    ...snapKv.state,
  };
  return { fixture, v1, v2, snap1, snap2 };
}

// ── a minimal, dependency-free well-formedness check (same idiom as scripts/hub-badge-test.cjs,
// adapted for an RSS document: an optional XML prolog, then one root <rss> element). ──────────
function xmlIsWellFormed(xml) {
  const body = xml.replace(/^\s*<\?xml[^>]*\?>/, "");
  if (!/^\s*<rss[\s>]/.test(body)) return { ok: false, why: "does not start with <rss>" };
  if (/<script/i.test(xml)) return { ok: false, why: "contains <script" };
  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/)?>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(body))) {
    const [full, name, selfClose] = m;
    if (full.startsWith("<?") || full.startsWith("<!")) continue;
    if (selfClose) continue;
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) return { ok: false, why: `mismatched close </${name}> (expected </${top}>)` };
    } else {
      stack.push(name);
    }
  }
  if (stack.length) return { ok: false, why: `unclosed tag(s): ${stack.join(",")}` };
  return { ok: true };
}

const FORBIDDEN_WORDS = [/\bverified\b/i, /\baudited\b/i, /\bsafe\b/i, /\bguaranteed\b/i, /\bAPR\b/, /\bAPY\b/, /\byield\b/i, /Normie Quest/i, /Wallet Watch/i];
const PRIVATE_FIELDS = ["operatorWallets", "payoutSourcesHistory", "desk"];

(async () => {
  console.log("\nHub project feed — JSON Feed + RSS (Colosseum roadmap §14 DD2)\n");
  const { fixture, v1, v2, snap1, snap2 } = buildFixture();

  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-feed-test-"));
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
    `version:v${v1.version}`, `version:v${v2.version}`,
    `commitment:${COMMIT_SIG}`,
    "batch:hb-batch-1",
    `snapshot:${snap1.id}`, `snapshot:${snap2.id}`,
  ].sort();

  try {
    console.log("1. GET /api/hub/:project/feed.json\n");
    const r1 = await fetch(`${BASE}/api/hub/${PROJECT}/feed.json`);
    const text1 = await r1.text();
    let body1; try { body1 = JSON.parse(text1); } catch (_) { body1 = null; }
    ok("200", r1.status === 200, String(r1.status));
    ok("Content-Type is application/feed+json", (r1.headers.get("content-type") || "").includes("application/feed+json"), r1.headers.get("content-type"));
    ok("Cache-Control is public, max-age=300", r1.headers.get("cache-control") === "public, max-age=300", r1.headers.get("cache-control"));
    ok("carries an ETag", !!r1.headers.get("etag"));

    // ── minimal JSON Feed 1.1 schema check ──
    ok("version is the JSON Feed 1.1 URL", body1 && body1.version === "https://jsonfeed.org/version/1.1", JSON.stringify(body1 && body1.version));
    ok("title is a non-empty string", typeof (body1 && body1.title) === "string" && body1.title.length > 0);
    ok("home_page_url is an absolute URL", /^https?:\/\//.test((body1 && body1.home_page_url) || ""), body1 && body1.home_page_url);
    ok("feed_url is an absolute URL ending in feed.json", /^https?:\/\/.*\/feed\.json$/.test((body1 && body1.feed_url) || ""), body1 && body1.feed_url);
    ok("items is an array", Array.isArray(body1 && body1.items));
    const items1 = (body1 && body1.items) || [];
    ok("items has exactly 6 entries (2 versions + 1 commitment + 1 batch + 2 snapshots)", items1.length === 6, JSON.stringify(items1.map((x) => x.id)));
    const shapeOk = items1.every((it) => typeof it.id === "string" && it.id.length > 0
      && typeof it.url === "string" && /^https?:\/\//.test(it.url)
      && typeof it.title === "string" && it.title.length > 0
      && typeof it.content_text === "string" && it.content_text.length > 0
      && typeof it.date_published === "string" && !Number.isNaN(new Date(it.date_published).getTime()));
    ok("every item has id/url/title/content_text/date_published, correctly typed", shapeOk, JSON.stringify(items1, null, 2));
    const ids1 = items1.map((x) => x.id);
    ok("items[].id are all unique", new Set(ids1).size === ids1.length, JSON.stringify(ids1));
    ok("ids are exactly the expected set", JSON.stringify([...ids1].sort()) === JSON.stringify(EXPECT_IDS), JSON.stringify(ids1));
    // newest-first ordering
    const dates1 = items1.map((x) => x.date_published);
    const sortedDesc = [...dates1].sort().reverse();
    ok("items are ordered newest first", JSON.stringify(dates1) === JSON.stringify(sortedDesc), JSON.stringify(dates1));

    // ── content spot-checks, by kind ──
    const byId = Object.fromEntries(items1.map((x) => [x.id, x]));
    const vItem1 = byId[`version:v${v1.version}`];
    ok("version item links the canonical program-version doc", vItem1 && vItem1.url === `${new URL(r1.url).origin}/api/hub/${PROJECT}/program/${v1.version}`, vItem1 && vItem1.url);
    ok("version item's summary carries the real hash", vItem1 && vItem1.content_text.includes(v1.hash), vItem1 && vItem1.content_text);
    const cItem = byId[`commitment:${COMMIT_SIG}`];
    ok("commitment item links solscan by signature", cItem && cItem.url === `https://solscan.io/tx/${COMMIT_SIG}`, cItem && cItem.url);
    ok("commitment item's date is the observed time (unix seconds → ISO)", cItem && cItem.date_published === new Date((T0 + 100) * 1000).toISOString(), cItem && cItem.date_published);
    const bItem = byId["batch:hb-batch-1"];
    ok("batch item's title names the receipt count", bItem && bItem.title.includes("2 receipt"), bItem && bItem.title);
    ok("batch item's summary carries the exact 2 of 2 reproducibility ratio", bItem && /\b2 of 2\b/.test(bItem.content_text), bItem && bItem.content_text);
    ok("batch item never claims 'verified' for its ratio", bItem && !/verified/i.test(bItem.content_text), bItem && bItem.content_text);
    const sItem = byId[`snapshot:${snap1.id}`];
    ok("snapshot item's summary carries the real listHash", sItem && sItem.content_text.includes(snap1.listHash), sItem && sItem.content_text);

    console.log("\n2. GET /hub/:project/feed.xml\n");
    const r2 = await fetch(`${BASE}/hub/${PROJECT}/feed.xml`);
    const xml = await r2.text();
    ok("200", r2.status === 200, String(r2.status));
    ok("Content-Type is application/rss+xml", (r2.headers.get("content-type") || "").includes("application/rss+xml"), r2.headers.get("content-type"));
    ok("Cache-Control is public, max-age=300", r2.headers.get("cache-control") === "public, max-age=300", r2.headers.get("cache-control"));
    ok("carries an ETag", !!r2.headers.get("etag"));
    const wf = xmlIsWellFormed(xml);
    ok("RSS is well-formed XML", wf.ok, wf.why);
    const itemCount = (xml.match(/<item>/g) || []).length;
    ok("RSS has exactly 6 <item> entries", itemCount === 6, String(itemCount));
    const guids = [...xml.matchAll(/<guid isPermaLink="false">([^<]*)<\/guid>/g)].map((m) => m[1]);
    ok("RSS guids are isPermaLink=\"false\" throughout, one per item", guids.length === 6, String(guids.length));
    ok("RSS lists the SAME ids as the JSON feed", JSON.stringify([...guids].sort()) === JSON.stringify(EXPECT_IDS), JSON.stringify(guids));
    ok("every <link> in the RSS is an absolute URL", [...xml.matchAll(/<link>([^<]*)<\/link>/g)].every((m) => /^https?:\/\//.test(m[1])));

    console.log("\n3. Stability — two fetches are byte-identical\n");
    const r1b = await fetch(`${BASE}/api/hub/${PROJECT}/feed.json`);
    const text1b = await r1b.text();
    ok("feed.json: two fetches are byte-identical", text1 === text1b);
    const r2b = await fetch(`${BASE}/hub/${PROJECT}/feed.xml`);
    const xmlB = await r2b.text();
    ok("feed.xml: two fetches are byte-identical", xml === xmlB);

    console.log("\n4. Demo + unknown projects 404\n");
    let r = await fetch(`${BASE}/api/hub/demo/feed.json`);
    ok("demo project 404s on feed.json", r.status === 404, String(r.status));
    r = await fetch(`${BASE}/hub/demo/feed.xml`);
    ok("demo project 404s on feed.xml", r.status === 404, String(r.status));
    r = await fetch(`${BASE}/api/hub/not-a-real-project-xyz/feed.json`);
    ok("unknown project 404s on feed.json", r.status === 404, String(r.status));
    r = await fetch(`${BASE}/hub/not-a-real-project-xyz/feed.xml`);
    ok("unknown project 404s on feed.xml", r.status === 404, String(r.status));

    console.log("\n5. Route ordering — /hub/:project/feed.xml resolves to the literal route, never the page catch-all\n");
    ok("feed.xml did not fall through to the hub.html shell", !xml.includes("<!DOCTYPE html") && !xml.includes("<title>Project Hub"), xml.slice(0, 120));

    console.log("\n6. No private field, no forbidden word, in either body\n");
    for (const body of [text1, xml]) {
      for (const f of PRIVATE_FIELDS) ok(`no "${f}" in the body`, !body.includes(f));
      for (const re of FORBIDDEN_WORDS) ok(`no forbidden word ${re} in the body`, !re.test(body));
    }
  } finally {
    done();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
