#!/usr/bin/env node
"use strict";
// Colosseum roadmap §11 AA1 — "one wallet, every project": GET /api/hub/wallet/:wallet and the
// /hub/wallet[/:wallet] page. Boots the real server with a throwaway DATA_DIR pre-seeded with
// TWO registry projects and a buy competition on each — the SAME fixture wallet qualifies (and
// is paid) in one and is disqualified (with a reason on record) in the other — and drives the
// real HTTP routes, asserting:
//   - the roll-up is composed ONLY from hubPublic.walletLookup per project (no private field
//     ever reaches it — same PRIVATE guard scripts/hub-public-test.cjs and
//     scripts/hub-buycomp-public-test.cjs already pin, checked again here on the wire);
//   - both projects appear with the right verdict, and a demo/fixture project never does (the
//     Colosseum judges' demo fixture never touches the real registry — E2 — so it structurally
//     cannot leak in; asserted anyway as the honest contract this endpoint promises);
//   - a malformed address is 400, an unseen valid address is a 200 with seenIn:0 (an honest
//     empty, never an error);
//   - the page serves 200 at /hub/wallet and /hub/wallet/<addr>, and carries none of the banned
//     words (CLAUDE.md: "Earn" is capability, never a promise — no yield/APR/APY, no
//     verified/safe/guaranteed).
//
// Usage: node scripts/hub-wallet-test.cjs [baseUrl]
// Env:   HUB_WALLET_TEST_PORT (default 3244) — used only when baseUrl is omitted.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.HUB_WALLET_TEST_PORT || 3244);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-wallet-test-"));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(p) { const r = await fetch(BASE + p); let body = null; try { body = await r.json(); } catch (_) {} return { status: r.status, body }; }
async function getText(p) { const r = await fetch(BASE + p); return { status: r.status, text: await r.text() }; }

const WALLET = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs";        // seen in BOTH projects
const UNSEEN_WALLET = "5WKKoF7LcDRsSfTYxccSEj7hejh9U5ZqcX74C7E5X7HG";  // valid address, no rows anywhere
const MINT1 = "CwaM5dYLzya3V26VHQjnZVxh3iigrxbgVQJm4npPSBdo";
const MINT2 = "A75SXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaKSp1";
const SIG = "2N7ZTAmnz5cjxkwcDyWiotYs9AZYTTnmnaFpBvAL1LjPst26GSyyrzmEtUJgPg4SjfSF4EMJjHYpDxu8E9KScCju";
const DQ_FACT = "moved the bag out during the hold (2 transfers) — not eligible";
const PRIVATE = ["chatId", "-1002625127458", "boardMsgId", "SECRET-PAYOUT-TOKEN", "provisional", "lastUpdateTs"];

const comp1 = {
  id: "bc_wt1", label: "WT1 Race", mint: MINT1, ticker: "WT1",
  chatId: "-1002625127458", boardMsgId: 999, provisional: [{ wallet: WALLET }], lastUpdateTs: 1,
  payoutToken: "SECRET-PAYOUT-TOKEN",
  startTs: 1757800000000, endTs: 1757900000000, holdHours: 24, places: [{ rank: 1, amount: 100 }], pctPrize: false,
  metric: "cumulative", prizeToken: { kind: "native", mint: null }, exclude: [], pools: [],
  status: "verified", createdAt: 1757790000000, verifiedAt: 1757990000000,
  verified: [{ rank: 1, wallet: WALLET, amount: 100, amountUnit: "token", status: "qualified", note: "set by operator" }],
  verifyResults: [{ wallet: WALLET, value: 12, tokensBought: 1000, status: "qualified", note: "holds all, no sells" }],
  payouts: { [WALLET]: { amountUi: 100, sig: SIG, at: 1758000000000, pending: false } },
};
const comp2 = {
  id: "bc_wt2", label: "WT2 Race", mint: MINT2, ticker: "WT2",
  startTs: 1757800000000, endTs: 1757900000000, holdHours: 24, places: [{ rank: 1, amount: 50 }], pctPrize: false,
  metric: "cumulative", prizeToken: { kind: "native", mint: null }, exclude: [], pools: [],
  status: "verified", createdAt: 1757790000000, verifiedAt: 1757990000000,
  verified: [],
  verifyResults: [{ wallet: WALLET, value: 30, tokensBought: 5000, status: "dq", note: DQ_FACT }],
  payouts: {},
};
const SEED = {
  "hub:projects": {
    walltest1: { id: "walltest1", label: "Wall Test One", symbol: "WT1", mint: MINT1, decimals: 9 },
    walltest2: { id: "walltest2", label: "Wall Test Two", symbol: "WT2", mint: MINT2, decimals: 9 },
  },
  buyComps: { bc_wt1: comp1, bc_wt2: comp2 },
};

(async () => {
  let srv = null;
  if (!ARG_BASE) {
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(SEED));
    // NODE_ENV=test turns on the wallet-cache debug header (P1-03, server.js /api/hub/wallet/:wallet)
    // — never present outside test, so this is the ONE test file that needs it set.
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1", NODE_ENV: "test",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("  server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  const done = () => { if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} } try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);

  console.log(`\nHub cross-project wallet look-up (Colosseum roadmap AA1) — ${BASE}\n`);

  // ── 1. malformed address → 400 ──────────────────────────────────────────────────────────────
  {
    const { status, body } = await getJson("/api/hub/wallet/not-an-address");
    ok("malformed address: 400", status === 400, String(status));
    ok("malformed address: honest reason", body && body.ok === false && /not a Solana address/i.test(body.error || ""), JSON.stringify(body));
  }

  // ── 2. an unseen valid address → 200, empty, honest ─────────────────────────────────────────
  {
    const { status, body } = await getJson("/api/hub/wallet/" + UNSEEN_WALLET);
    ok("unseen wallet: 200 (not an error)", status === 200, String(status));
    ok("unseen wallet: seenIn 0, empty projects", body && body.ok === true && body.seenIn === 0 && Array.isArray(body.projects) && body.projects.length === 0, JSON.stringify(body));
  }

  // ── 3. the fixture wallet across two projects — one qualifies + paid, one excluded ─────────
  {
    const { status, body } = await getJson("/api/hub/wallet/" + WALLET);
    ok("fixture wallet: 200", status === 200, String(status));
    ok("fixture wallet: seenIn 2, both real projects listed", body && body.ok === true && body.seenIn === 2 && body.projects.length === 2, JSON.stringify(body));
    const p1 = body.projects.find((p) => p.id === "walltest1");
    const p2 = body.projects.find((p) => p.id === "walltest2");
    ok("project 1 present with its own label", !!p1 && p1.label === "Wall Test One");
    ok("project 2 present with its own label", !!p2 && p2.label === "Wall Test Two");
    ok("no demo/fixture project ever appears in the roll-up", !body.projects.some((p) => p.id === "demo" || p.id === "demo-b"));

    const prog1 = p1 && p1.programs.find((pr) => pr.id === "bc_wt1");
    ok("project 1's program groups the winner AND paid rows under one program", !!prog1 && prog1.kind === "buy-comp" && prog1.rows.length === 2,
      JSON.stringify(prog1));
    ok("project 1: a winner row carries the sealed (owed) amount, no signature",
      !!prog1 && prog1.rows.some((r) => r.role === "winner" && Number(r.amountUi) === 100 && !r.sig));
    ok("project 1: a paid row carries the settlement signature — what arrived",
      !!prog1 && prog1.rows.some((r) => r.role === "paid" && r.sig === SIG && Number(r.amountUi) === 100 && r.state === "settled"));

    const prog2 = p2 && p2.programs.find((pr) => pr.id === "bc_wt2");
    ok("project 2's program shows the exclusion with the reason on record",
      !!prog2 && prog2.rows.length === 1 && prog2.rows[0].role === "dq" && prog2.rows[0].fact === DQ_FACT, JSON.stringify(prog2));
    ok("project 2: no paid/winner row for a disqualified wallet", !!prog2 && !prog2.rows.some((r) => r.role === "paid" || r.role === "winner"));

    const json = JSON.stringify(body);
    ok("no private field reaches the wire (chatId, board id, payout token, live board)", PRIVATE.every((s) => !json.includes(s)), PRIVATE.filter((s) => json.includes(s)).join(","));
    ok("Cache-Control: no-store, like the per-project wallet route", (await fetch(BASE + "/api/hub/wallet/" + WALLET)).headers.get("cache-control") === "no-store");
    ok("generatedAt is a fresh timestamp", typeof body.generatedAt === "number" && Math.abs(Date.now() - body.generatedAt) < 15000);
  }

  // ── 3b. P1-03: a 60s in-memory cache keyed by wallet — a second lookup within the window is
  // served from cache (never re-walks every project's ledger), while the response still stamps a
  // fresh `generatedAt` and keeps `Cache-Control: no-store` (the cache is server-side memoisation
  // of the expensive computation, never a claim that the HTTP response itself is cacheable).
  // Asserted with the `x-hub-wallet-cache` debug header the route exposes ONLY under NODE_ENV=test
  // (this test file's server was booted with it — see above) rather than by timing, which would
  // be flaky under load. A wallet never looked up anywhere else in this file, so the first hit is
  // guaranteed a cache MISS. ──────────────────────────────────────────────────────────────────
  {
    const CACHE_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const r1 = await fetch(BASE + "/api/hub/wallet/" + CACHE_WALLET);
    const body1 = await r1.json();
    ok("P1-03: first lookup is a cache MISS", r1.headers.get("x-hub-wallet-cache") === "miss", String(r1.headers.get("x-hub-wallet-cache")));
    const r2 = await fetch(BASE + "/api/hub/wallet/" + CACHE_WALLET);
    const body2 = await r2.json();
    ok("P1-03: a second lookup within 60s is a cache HIT", r2.headers.get("x-hub-wallet-cache") === "hit", String(r2.headers.get("x-hub-wallet-cache")));
    ok("P1-03: the cached data itself is unchanged (same seenIn/projects)", body1.seenIn === body2.seenIn && JSON.stringify(body1.projects) === JSON.stringify(body2.projects));
    ok("P1-03: generatedAt is still stamped fresh on the cache-HIT response too", typeof body2.generatedAt === "number" && Math.abs(Date.now() - body2.generatedAt) < 15000);
    ok("P1-03: Cache-Control stays no-store on a cache-HIT response", r2.headers.get("cache-control") === "no-store", String(r2.headers.get("cache-control")));
  }

  // ── 4. "wallet" cannot be registered as a project id ────────────────────────────────────────
  // Pure unit check against lib/hub/project.js's approveProject — the same guard server.js wires
  // up via hubRoutes.mount's reservedMints() (Colosseum roadmap AA1: /hub/wallet[/:wallet] and
  // GET /api/hub/wallet/:wallet must never collide with a real registered project named "wallet").
  {
    const proj = require("../lib/hub/project");
    const RESERVED = { clkn: "clkn-mint", cuna: "cuna-mint", rose: "rose-mint", demo: null, "demo-b": null, wallet: null };
    let threw = null;
    try { proj.approveProject({}, { id: "wallet", mint: MINT1, access: { tier: "standard" } }, { nowUnix: 1758000000, reserved: RESERVED }); }
    catch (e) { threw = e; }
    ok("a project literally named \"wallet\" is refused at approval", !!threw && /wallet.*built-in|built-in.*wallet/i.test(threw.message), threw && threw.message);
    let ok2 = false;
    try { proj.approveProject({}, { id: "not-wallet", mint: MINT1, access: { tier: "standard" } }, { nowUnix: 1758000000, reserved: RESERVED }); ok2 = true; } catch (e) { ok2 = false; }
    ok("a project with any other id still approves fine against the same reserved map", ok2);
  }

  // ── 5. the page serves 200, bare and pre-filled ─────────────────────────────────────────────
  {
    const { status, text } = await getText("/hub/wallet");
    ok("page: /hub/wallet serves 200", status === 200, String(status));
    ok("page: has a real <main> and an address input", /<main/i.test(text) && /id="walletIn"/.test(text));
  }
  {
    const { status, text } = await getText("/hub/wallet/" + WALLET);
    ok("page: /hub/wallet/<address> serves 200", status === 200, String(status));
    const lower = text.toLowerCase();
    const banned = ["yield", "apr", "apy", "verified", "safe", "guaranteed"];
    const hit = banned.filter((w) => lower.includes(w));
    ok("page: no yield/APR/APY/verified/safe/guaranteed language anywhere in the markup", hit.length === 0, hit.join(", "));
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
