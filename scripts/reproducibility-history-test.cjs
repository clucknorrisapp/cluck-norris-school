#!/usr/bin/env node
"use strict";
// CC4 (docs/COLOSSEUM_ROADMAP.md §13) — the daily append-only reproducibility history behind the
// badge/ratio. Two layers, same idiom as scripts/holders-snapshot-test.cjs +
// scripts/hub-status-test.cjs:
//   1. Pure unit tests of lib/reproducibility-history.js against an in-memory kv — no server:
//      append-only refusal on a second write for the same (project, day), the hash chain verifies
//      end to end, a tampered record breaks it, the 90-day cap drops the oldest first, and a
//      skipped day is a gap (absent), never interpolated.
//   2. A route section: boots the real server with a throwaway DATA_DIR seeded with a real
//      registered project ("rhtest") and one sent lock-to-earn batch (same fixture shape
//      scripts/hub-status-test.cjs and scripts/hub-badge-test.cjs use), with the tick's own
//      interval/boot-delay env overrides set small so it fires twice inside the test's own wait —
//      asserts today's record was written exactly once (the second firing hits day_exists and is
//      a no-op), the route serves it with chainOk:true, a demo project 404s, and /hub/status
//      renders the sparkline with its aria-label (Playwright, one page load).
//
// Usage: node scripts/reproducibility-history-test.cjs
// Env:   REPRO_HISTORY_TEST_PORT (default 3317)
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const reproHistory = require("../lib/reproducibility-history");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + (e && e.message || e)); }
};
const section = (n) => console.log("\n" + n);

// ── in-memory kv, same four-method surface lib/kvstore.js exports (see holders-snapshot-test.cjs) ──
function memoryKv() {
  const state = {};
  return {
    get: (k, d) => (Object.prototype.hasOwnProperty.call(state, k) ? state[k] : d),
    set: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); },
    setVerified: (k, v) => { state[k] = v === null ? null : JSON.parse(JSON.stringify(v)); return true; },
    entriesWithPrefix: (prefix) => Object.keys(state).filter((k) => k.startsWith(prefix)).map((k) => [k, state[k]]),
  };
}
const dayStr = (offset) => new Date(Date.UTC(2027, 0, 1) + offset * 86400000).toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1) pure unit tests
// ════════════════════════════════════════════════════════════════════════════════════════════
section("record() — append-only per (project, day)");

t("a second record() for the same (project, day) is refused, never overwrites", () => {
  const kv = memoryKv();
  const r1 = reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 4, total: 5, missingInputs: 1, at: 1000 });
  assert.ok(r1.ok, "first write verifies");
  const r2 = reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 5, total: 5, missingInputs: 0, at: 2000 });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, "day_exists");
  const series = reproHistory.series(kv, "rh");
  assert.strictEqual(series.length, 1, "still exactly one record");
  assert.strictEqual(series[0].reproduced, 4, "the FIRST write's numbers, never the refused second one's");
  assert.strictEqual(series[0].total, 5);
});

t("two different projects on the same day never collide", () => {
  const kv = memoryKv();
  reproHistory.record(kv, { projectId: "rh-a", day: dayStr(0), reproduced: 1, total: 1, missingInputs: 0, at: 1000 });
  reproHistory.record(kv, { projectId: "rh-b", day: dayStr(0), reproduced: 0, total: 0, missingInputs: 0, at: 1000 });
  assert.strictEqual(reproHistory.series(kv, "rh-a").length, 1);
  assert.strictEqual(reproHistory.series(kv, "rh-b").length, 1);
});

t("rejects a malformed day", () => {
  const kv = memoryKv();
  assert.throws(() => reproHistory.record(kv, { projectId: "rh", day: "not-a-day", reproduced: 1, total: 1, missingInputs: 0, at: 1000 }));
  assert.throws(() => reproHistory.record(kv, { projectId: "rh", day: "2027/01/01", reproduced: 1, total: 1, missingInputs: 0, at: 1000 }));
});

section("the hash chain");

t("verifyChain passes end to end over a real sequence", () => {
  const kv = memoryKv();
  for (let i = 0; i < 5; i++) reproHistory.record(kv, { projectId: "rh", day: dayStr(i), reproduced: i, total: 5, missingInputs: 0, at: 1000 + i });
  const chain = reproHistory.verifyChain(kv, "rh");
  assert.strictEqual(chain.ok, true, JSON.stringify(chain.problems));
  assert.strictEqual(chain.days, 5);
});

t("each record's prevHash is the previous record's actual hash", () => {
  const kv = memoryKv();
  const r1 = reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 1, total: 1, missingInputs: 0, at: 1000 });
  const r2 = reproHistory.record(kv, { projectId: "rh", day: dayStr(1), reproduced: 2, total: 2, missingInputs: 0, at: 2000 });
  assert.strictEqual(r1.record.prevHash, null, "the very first record chains to nothing");
  assert.strictEqual(r2.record.prevHash, r1.record.hash);
  assert.notStrictEqual(r1.record.hash, r2.record.hash);
});

t("a tampered record breaks the chain (hash mismatch) without corrupting earlier days", () => {
  const kv = memoryKv();
  reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 1, total: 1, missingInputs: 0, at: 1000 });
  reproHistory.record(kv, { projectId: "rh", day: dayStr(1), reproduced: 2, total: 2, missingInputs: 0, at: 2000 });
  reproHistory.record(kv, { projectId: "rh", day: dayStr(2), reproduced: 3, total: 3, missingInputs: 0, at: 3000 });
  assert.strictEqual(reproHistory.verifyChain(kv, "rh").ok, true, "sanity: untampered chain verifies");
  // Tamper day 1's `total` in place, leaving its stored `hash` untouched — the same forgery shape
  // the module header describes: a reader who recomputes the hash from the (now-wrong) fields
  // must catch it.
  const key = `${reproHistory.PREFIX}rh:${dayStr(1)}`;
  const tampered = kv.get(key);
  kv.set(key, { ...tampered, total: 999 });
  const chain = reproHistory.verifyChain(kv, "rh");
  assert.strictEqual(chain.ok, false);
  assert.ok(chain.problems.some((p) => p.day === dayStr(1) && p.reason === "hash_mismatch"), JSON.stringify(chain.problems));
});

t("a forged-but-self-consistent hash still breaks the NEXT record's prevHash link", () => {
  const kv = memoryKv();
  reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 1, total: 1, missingInputs: 0, at: 1000 });
  reproHistory.record(kv, { projectId: "rh", day: dayStr(1), reproduced: 2, total: 2, missingInputs: 0, at: 2000 });
  const key = dayN => `${reproHistory.PREFIX}rh:${dayStr(dayN)}`;
  const day0 = kv.get(key(0));
  const forged = { ...day0, total: 42 };
  // Recompute the hash the same way the module does, so day0 alone looks internally consistent —
  // but day1's prevHash still names the ORIGINAL hash, which no longer exists anywhere.
  const { canonicalJson, sha256 } = require("../lib/hub/project");
  forged.hash = sha256(canonicalJson({ projectId: forged.projectId, day: forged.day, reproduced: forged.reproduced, total: forged.total, missingInputs: forged.missingInputs, at: forged.at, prevHash: forged.prevHash }));
  kv.set(key(0), forged);
  const chain = reproHistory.verifyChain(kv, "rh");
  assert.strictEqual(chain.ok, false);
  assert.ok(chain.problems.some((p) => p.day === dayStr(1) && p.reason === "prevHash_mismatch"), JSON.stringify(chain.problems));
});

section("the 90-day cap");

t("the cap is not exceeded, and the oldest is the one dropped", () => {
  const kv = memoryKv();
  const total = reproHistory.KEEP + 5;
  for (let i = 0; i < total; i++) reproHistory.record(kv, { projectId: "rh", day: dayStr(i), reproduced: i, total: total, missingInputs: 0, at: 1000 + i });
  const series = reproHistory.series(kv, "rh");
  assert.strictEqual(series.length, reproHistory.KEEP, `kept exactly ${reproHistory.KEEP}`);
  assert.strictEqual(series[0].day, dayStr(total - reproHistory.KEEP), "the oldest surviving day is the (total-KEEP)th one");
  assert.strictEqual(series[series.length - 1].day, dayStr(total - 1), "the newest day is still there");
});

t("staying at or under the cap never drops anything", () => {
  const kv = memoryKv();
  for (let i = 0; i < reproHistory.KEEP; i++) reproHistory.record(kv, { projectId: "rh", day: dayStr(i), reproduced: 1, total: 1, missingInputs: 0, at: 1000 + i });
  assert.strictEqual(reproHistory.series(kv, "rh").length, reproHistory.KEEP);
});

section("gaps are gaps — never interpolated");

t("a skipped day is simply absent from the series, not synthesized", () => {
  const kv = memoryKv();
  reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 1, total: 1, missingInputs: 0, at: 1000 });
  // day 1 is deliberately never recorded
  reproHistory.record(kv, { projectId: "rh", day: dayStr(2), reproduced: 3, total: 3, missingInputs: 0, at: 3000 });
  const series = reproHistory.series(kv, "rh");
  assert.strictEqual(series.length, 2, "exactly the two recorded days, nothing invented for day 1");
  assert.deepStrictEqual(series.map((r) => r.day), [dayStr(0), dayStr(2)]);
  // Verified separately from the chain check above: the chain still verifies across a real gap —
  // a gap in calendar days is not the same thing as a broken hash link.
  assert.strictEqual(reproHistory.verifyChain(kv, "rh").ok, true);
});

t("series() carries only the public fields, never a project id or a key", () => {
  const kv = memoryKv();
  reproHistory.record(kv, { projectId: "rh", day: dayStr(0), reproduced: 1, total: 2, missingInputs: 1, at: 1000 });
  const series = reproHistory.series(kv, "rh");
  assert.deepStrictEqual(Object.keys(series[0]).sort(), ["day", "hash", "missingInputs", "prevHash", "reproduced", "total"].sort());
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2) route section — a real server, a real project, the real tick
// ════════════════════════════════════════════════════════════════════════════════════════════
const PORT = Number(process.env.REPRO_HISTORY_TEST_PORT || 3317);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rfail = 0;
const rok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { rfail++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

function resolvePlaywright() {
  const candidates = [
    "playwright-core",
    path.join(__dirname, "..", "node_modules", "playwright-core"),
    path.join(__dirname, "..", "..", "node_modules", "playwright-core"),
    "/home/user/cluck-norris-school/node_modules/playwright-core",
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  return null;
}

// Same fixture shape scripts/hub-status-test.cjs / scripts/hub-badge-test.cjs use: a real,
// non-dryRun registered project ("rhtest") with one already-sent lock-to-earn batch, so
// hubReproducibilityFor() has a real 1-of-1 to report and the tick has something to write.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const RH_MINT = fakeAddr(9);
const WALLET = fakeAddr(11);
const SIG = fakeSig(3);
const T0 = 1_800_000_000;
function seededFixtureState() {
  const days = { "2027-02-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 } };
  const batches = {
    "rh-batch-1": { id: "rh-batch-1", state: "sent", at: T0 + 3600, count: 1, totalRaw: "1000000000", amounts: { [WALLET]: "1000000000" }, sent: { [WALLET]: { sig: SIG, at: T0 + 3660 } } },
  };
  return {
    "hub:projects": { rhtest: { id: "rhtest", label: "Repro History Test", symbol: "RHT", mint: RH_MINT, decimals: 9, rewardMint: RH_MINT, rewardDecimals: 9 } },
    "program:rhtest:days": days,
    "program:rhtest:batches": batches,
    "program:rhtest:paid": {},
  };
}

(async () => {
  console.log(`\nReproducibility history route section (Colosseum roadmap §13 CC4) — ${BASE}\n`);
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "repro-history-"));
  fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(seededFixtureState()));
  // The tick's own test-only overrides (see server.js's comment on these two env vars): a short
  // boot delay and a short interval so the tick fires TWICE well inside this test's own wait,
  // proving the second firing is a no-op (day_exists) rather than a double-write.
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
    HUB_REPRO_HIST_BOOT_MS: "300", HUB_REPRO_HIST_TICK_MS: "3000",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
  const cleanup = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", cleanup);
  try {
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("  server did not come up"); process.exit(1); }

    console.log("1. the tick fires twice; today's record is written exactly once\n");
    // 300ms (first/boot tick) + 3000ms (second/timer tick) + margin.
    await sleep(4200);
    const today = new Date().toISOString().slice(0, 10);
    const hist = await fetch(`${BASE}/api/hub/rhtest/reproducibility/history`).then((r) => r.json());
    rok("ok:true", hist.ok === true, JSON.stringify(hist));
    rok("exactly one day recorded (the second tick hit day_exists, not a duplicate)", Array.isArray(hist.days) && hist.days.length === 1, JSON.stringify(hist.days));
    if (hist.days && hist.days.length) {
      rok("it is today's UTC day", hist.days[0].day === today, `${hist.days[0].day} vs ${today}`);
      rok("reproduced/total match the fixture's one sent receipt (1 of 1)", hist.days[0].reproduced === 1 && hist.days[0].total === 1, JSON.stringify(hist.days[0]));
      rok("missingInputs is a number", Number.isFinite(hist.days[0].missingInputs), JSON.stringify(hist.days[0]));
      rok("carries hash/prevHash", typeof hist.days[0].hash === "string" && hist.days[0].hash.length === 64 && hist.days[0].prevHash === null, JSON.stringify(hist.days[0]));
    }
    rok("chainOk:true", hist.chainOk === true, JSON.stringify(hist));

    console.log("\n2. shape + 404s\n");
    const demo = await fetch(`${BASE}/api/hub/demo/reproducibility/history`);
    rok("a demo project id is 404 (never registrable — see hubProjects())", demo.status === 404, String(demo.status));
    const unknown = await fetch(`${BASE}/api/hub/not-a-real-project-xyz/reproducibility/history`);
    rok("an unknown project id is 404", unknown.status === 404, String(unknown.status));
    rok("Cache-Control matches its sibling (300s)", hist && true, ""); // header check below, kept here for section grouping
    const histResp = await fetch(`${BASE}/api/hub/rhtest/reproducibility/history`);
    rok("Cache-Control is public, max-age=300", histResp.headers.get("cache-control") === "public, max-age=300", histResp.headers.get("cache-control"));
    rok("carries an ETag", !!histResp.headers.get("etag"));
    // Route-ordering check the roadmap item calls out explicitly: /api/hub/:project (3 segments)
    // must not have swallowed this 5-segment path.
    rok("the route actually resolves rhtest's own history, not a generic :project 404", histResp.status === 200);

    console.log("\n3. /hub/status renders the sparkline with its aria-label (Playwright)\n");
    const pw = resolvePlaywright();
    if (!pw) {
      console.log("  · playwright-core not resolvable — skipping the rendered-page check (everything else above still ran)");
    } else {
      const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${BASE}/hub/status`, { waitUntil: "networkidle", timeout: 20000 });
        await sleep(500); // let the fetch()-driven render settle
        const card = page.locator("#proj-rhtest");
        rok("rhtest's card is on the page", (await card.count()) > 0);
        const svg = card.locator("svg.hub-spark");
        rok("the card renders a sparkline SVG", (await svg.count()) > 0);
        if (await svg.count()) {
          const aria = await svg.first().getAttribute("aria-label");
          rok("the SVG carries a non-empty aria-label", !!aria && aria.length > 0, String(aria));
          rok("the aria-label names today's ratio in plain words", !!aria && /1 of 1/.test(aria) && new RegExp(today).test(aria), String(aria));
          const titleText = await svg.first().locator("title").first().textContent();
          rok("the SVG also carries a <title> (a non-hover text alternative)", !!titleText && titleText.length > 0, String(titleText));
        }
        const cardText = await card.innerText();
        rok("the visible text alternative under the chart repeats the same summary", /1 of 1/.test(cardText) && /day.*on record/i.test(cardText), cardText.slice(0, 300));
        rok("the chain-ok word is shown", /chain ok/i.test(cardText), cardText.slice(0, 300));
      } finally {
        await browser.close();
      }
    }
  } finally {
    cleanup();
  }

  const totalFail = fail + rfail;
  console.log(`\n${pass} unit passed, ${fail} unit failed · route section: ${rfail} failing assertion${rfail === 1 ? "" : "s"}\n`);
  console.log(totalFail ? `${totalFail} FAILED` : "all passed");
  process.exit(totalFail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
