#!/usr/bin/env node
"use strict";
// The CUNA drawing's entry registry (owner brief, 2026-09-11). Pure checks on lib/cuna-draw.js,
// then the real server booted twice: once open with the lockdown OFF (CORS, idempotency, limits,
// export auth), once with the lockdown ON to prove enter/check pass the lock host's exemption and
// export does not. A drawing whose list is wrong is a prize paid to the wrong person, so every
// rule in the brief is asserted here rather than assumed.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const draw = require("../lib/cuna-draw");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv";   // 44 chars
const A43 = "So11111111111111111111111111111111111111112";  // 43 chars, valid (wrapped SOL mint)
const B = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const C = "3BqWphsCZhmbzKfLubZfjQ3pgLWRC7HY4AXB5tk1wKCF";   // a third real wallet

function fakeStore({ persistent = true } = {}) { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v), isPersistent: () => persistent }; }

console.log("address validation — decode to exactly 32 bytes, canonical form stored");
{
  ok("a 44-char address is accepted", draw.canonicalAddress(A) === A);
  ok("a 43-char address is accepted (real, e.g. the wrapped-SOL mint)", draw.canonicalAddress(A43) === A43);
  ok("a 44-char address with the last character dropped is REJECTED (decodes to 31 bytes)", draw.canonicalAddress(A.slice(0, 43)) === null);
  ok("an extra character is rejected", draw.canonicalAddress(A + "1") === null);
  ok("wrong alphabet (0, O, I, l) is rejected", ["0" + A.slice(1), "O" + A.slice(1), "I" + A.slice(1), "l" + A.slice(1)].every((s) => draw.canonicalAddress(s) === null));
  ok("surrounding whitespace is trimmed", draw.canonicalAddress("  " + A + "\n") === A);
  ok("non-strings, empty, and junk are rejected", [null, undefined, 42, {}, [], "", "hello", "x".repeat(44)].every((v) => draw.canonicalAddress(v) === null));
}

console.log("not-a-wallet addresses are refused at entry (programs, mints, PDAs)");
{
  const w = { open: 0, close: 1e15 }, store = fakeStore();
  ok("the System Program (32 zero bytes — the site session's production test row) → 400", draw.enter({ store, address: "11111111111111111111111111111111", now: 1, window: w }).status === 400);
  ok("the Token Program → 400", draw.enter({ store, address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", now: 1, window: w }).status === 400);
  ok("the CUNA mint and wrapped SOL → 400", draw.enter({ store, address: "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc", now: 1, window: w }).status === 400 && draw.enter({ store, address: A43, now: 1, window: w }).status === 400);
  ok("a PDA (the Meteora vault authority, off-curve) → 400 with the off-curve reason", /off-curve/.test(draw.enter({ store, address: "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC", now: 1, window: w }).error));
  ok("an Orca pool address (off-curve) → 400", draw.enter({ store, address: "2pxxjL96USyv6WPbrF2xkoKt16UdueyTuzr3CLwwTb1G", now: 1, window: w }).status === 400);
  ok("nothing was stored by any of those", draw.exportRows(store).length === 0);
  ok("a real wallet still enters", draw.enter({ store, address: A, now: 1, window: w }).recorded === true);
  ok("check does not apply the wallet rule (it reports what is stored, nothing more)", draw.check({ store, address: "11111111111111111111111111111111" }).status === 200);
}

console.log("delete");
{
  const w = { open: 0, close: 1e15 }, store = fakeStore();
  draw.enter({ store, address: A, now: 5, window: w }); draw.enter({ store, address: B, now: 6, window: w });
  const d = draw.deleteEntry({ store, address: " " + A + " " });
  ok("removes exactly that row and reports what it was", d.ok && d.removed === true && d.was && d.was.at === 5 && draw.exportRows(store).length === 1 && draw.exportRows(store)[0].address === B, d);
  ok("deleting again → removed:false, nothing else touched", draw.deleteEntry({ store, address: A }).removed === false && draw.exportRows(store).length === 1);
  ok("bad address → 400", draw.deleteEntry({ store, address: "nope" }).status === 400);
  ok("the address can re-enter afterwards with a fresh created_at", draw.enter({ store, address: A, now: 9, window: w }).recorded === true && draw.check({ store, address: A }).at === 9);
}

console.log("window enforced server-side");
{
  const w = { open: 1000, close: 2000 };
  ok("before open → not_open", draw.windowState(999, w) === "not_open");
  ok("at open → open", draw.windowState(1000, w) === "open");
  ok("just before close → open", draw.windowState(1999, w) === "open");
  ok("at close → closed (exclusive)", draw.windowState(2000, w) === "closed");
  ok("defaults are the brief's instants", draw.DEFAULT_WINDOW.open === Date.parse("2026-09-11T15:30:00Z") && draw.DEFAULT_WINDOW.close === Date.parse("2026-09-13T18:00:00Z"));
  ok("env override parses, bad env falls back", (() => { const x = draw.windowFromEnv({ CUNA_DRAW_OPEN: "2026-01-01T00:00:00Z", CUNA_DRAW_CLOSE: "garbage" }); return x.open === Date.parse("2026-01-01T00:00:00Z") && x.close === draw.DEFAULT_WINDOW.close; })());
  const store = fakeStore();
  ok("enter before open → 403, nothing stored", draw.enter({ store, address: A, now: 999, window: w }).status === 403 && draw.exportRows(store).length === 0);
  ok("enter after close → 403, nothing stored", draw.enter({ store, address: A, now: 2000, window: w }).status === 403 && draw.exportRows(store).length === 0);
}

console.log("idempotent, capped, durable-only");
{
  const w = { open: 0, close: 1e15 }, store = fakeStore();
  const a = draw.enter({ store, address: A, now: 5000, window: w, ipHash: "abc" });
  ok("first POST records", a.ok && a.recorded === true && a.found === true && a.at === 5000, a);
  const b = draw.enter({ store, address: " " + A + " ", now: 9000, window: w });
  ok("second POST (even with whitespace) is a 200 no-op and created_at does not move", b.ok && b.recorded === false && b.found === true && b.at === 5000, b);
  ok("exactly one row", draw.exportRows(store).length === 1 && draw.exportRows(store)[0].ipHash === "abc");
  ok("check finds it, and not the other", draw.check({ store, address: A }).found === true && draw.check({ store, address: B }).found === false);
  ok("check with a bad address → 400", draw.check({ store, address: "nope" }).status === 400);
  ok("bad address on enter → 400, nothing stored", draw.enter({ store, address: A.slice(0, 43), now: 5000, window: w }).status === 400 && draw.exportRows(store).length === 1);
  const capped = draw.enter({ store, address: B, now: 6000, window: w, cap: 1 });
  ok("cap reached → 503, nothing stored", capped.status === 503 && draw.exportRows(store).length === 1, capped);
  const mem = fakeStore({ persistent: false });
  const m = draw.enter({ store: mem, address: A, now: 5000, window: w });
  ok("memory-only store → 503 refused (a deploy would erase the drawing), nothing stored", m.status === 503 && draw.exportRows(mem).length === 0, m);
  ok("…but an address already stored still reads found:true on a memory-only store", (() => { const s2 = fakeStore({ persistent: true }); draw.enter({ store: s2, address: A, now: 1, window: w }); s2.isPersistent = () => false; return draw.enter({ store: s2, address: A, now: 2, window: w }).found === true; })());
  ok("export rows are ordered by time then address, with ISO created_at", (() => { const s3 = fakeStore(); draw.enter({ store: s3, address: B, now: 20, window: w }); draw.enter({ store: s3, address: A, now: 10, window: w }); const r = draw.exportRows(s3); return r[0].address === A && r[1].address === B && r[0].created_at === new Date(10).toISOString(); })());
  ok("a corrupted store value reads as empty rather than throwing", (() => { const s4 = fakeStore(); s4.set(draw.KEY, "junk"); return draw.exportRows(s4).length === 0 && draw.check({ store: s4, address: A }).found === false; })());
}

// ── the real server ───────────────────────────────────────────────────────────
const KEY = "draw-test-admin-key", TOKEN = "draw-export-token";
async function boot(port, extraEnv) {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cuna-draw-test-"));
  const env = { ...process.env, PORT: String(port), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY, CUNA_DRAW_EXPORT_TOKEN: TOKEN,
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9", CUNA_DRAW_OPEN: "2020-01-01T00:00:00Z", CUNA_DRAW_CLOSE: "2099-01-01T00:00:00Z", ...extraEnv };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  if (!up) { stop(); throw new Error("server did not come up on " + port); }
  return { base, stop };
}
// http.request rather than fetch: undici silently drops a caller-supplied Host header, and the
// lockdown section below needs the server to see "lock.cunatoken.com".
const http = require("http");
function req(base, p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const h = { ...headers };
    if (body != null && !h["content-length"]) h["content-length"] = String(Buffer.byteLength(body));
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch (_) {} resolve({ status: res.statusCode, json, text, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v.join(", ") : (v == null ? null : v); } } }); });
    });
    r.on("error", reject);
    if (body != null) r.write(body);
    r.end();
  });
}
const ORIGIN = "https://cunatoken.com";

(async () => {
  console.log("\nserver — open window, lockdown off");
  const s1 = await boot(4471);
  try {
    const pre = await req(s1.base, "/api/cuna-draw/enter", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    ok("OPTIONS /enter → 204", pre.status === 204, pre.status);
    ok("…with Access-Control-Allow-Origin: https://cunatoken.com", pre.headers.get("access-control-allow-origin") === ORIGIN, pre.headers.get("access-control-allow-origin"));
    ok("…Allow-Methods GET, POST, OPTIONS and Allow-Headers Content-Type", pre.headers.get("access-control-allow-methods") === "GET, POST, OPTIONS" && pre.headers.get("access-control-allow-headers") === "Content-Type");
    const pre2 = await req(s1.base, "/api/cuna-draw/check", { method: "OPTIONS", headers: { origin: "https://www.cunatoken.com" } });
    ok("OPTIONS /check → 204 for the www origin too", pre2.status === 204 && pre2.headers.get("access-control-allow-origin") === "https://www.cunatoken.com");
    const evil = await req(s1.base, "/api/cuna-draw/enter", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    ok("a foreign origin gets no Allow-Origin header", evil.status === 204 && !evil.headers.get("access-control-allow-origin"));

    const e1 = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ address: A }) });
    ok("POST /enter (JSON) → 200 recorded:true", e1.status === 200 && e1.json && e1.json.recorded === true && e1.json.found === true, e1.json);
    ok("…with the CORS header on the actual response", e1.headers.get("access-control-allow-origin") === ORIGIN);
    const e2 = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A }) });
    ok("second POST → 200 no-op (recorded:false, found:true)", e2.status === 200 && e2.json.recorded === false && e2.json.found === true, e2.json);
    const e3 = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "text/plain" }, body: C });
    ok("POST /enter with a text/plain body (no preflight) → 200 recorded", e3.status === 200 && e3.json.recorded === true && e3.json.address === C, e3.json);
    const sys = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "11111111111111111111111111111111" }) });
    ok("the System Program address → 400 (the production test row can never come back)", sys.status === 400 && /program or mint/.test(sys.json.error), sys.json);
    const e4 = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ address: B }) });
    ok("POST /enter with JSON sent as text/plain → 200 recorded", e4.status === 200 && e4.json.recorded === true && e4.json.address === B, e4.json);
    const bad = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A.slice(0, 43) }) });
    ok("truncated address → 400", bad.status === 400, bad.json);
    const big = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A, pad: "x".repeat(600) }) });
    ok("oversized body → 413", big.status === 413, big.status);
    const noBody = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok("missing address → 400", noBody.status === 400);

    const c1 = await req(s1.base, "/api/cuna-draw/check?address=" + A, { headers: { origin: ORIGIN } });
    ok("GET /check → { ok:true, found:true } with CORS", c1.status === 200 && c1.json.ok === true && c1.json.found === true && c1.headers.get("access-control-allow-origin") === ORIGIN, c1.json);
    const c2 = await req(s1.base, "/api/cuna-draw/check?address=" + "HiahJYkBMSYzckeb8XeZ7dvxVeWTsq8jQQ2wq4Jo4SDZ");
    ok("GET /check for an unknown address → found:false", c2.status === 200 && c2.json.found === false);
    ok("GET /check with a bad address → 400", (await req(s1.base, "/api/cuna-draw/check?address=nope")).status === 400);

    const x0 = await req(s1.base, "/api/cuna-draw/export");
    ok("export without a token → 404 (indistinguishable)", x0.status === 404);
    const x1 = await req(s1.base, "/api/cuna-draw/export", { headers: { "x-draw-token": "wrong" } });
    ok("export with a wrong token → 404", x1.status === 404);
    const xq = await req(s1.base, "/api/cuna-draw/export?t=" + TOKEN);
    ok("the token in the query string does NOT work (header only)", xq.status === 404);
    const x2 = await req(s1.base, "/api/cuna-draw/export", { headers: { "x-draw-token": TOKEN } });
    ok("export with the token → the three rows, persistent:true, window state open", x2.status === 200 && x2.json.count === 3 && x2.json.persistent === true && x2.json.window.state === "open", x2.json && { count: x2.json.count, persistent: x2.json.persistent, window: x2.json.window });
    ok("rows carry address + ISO created_at + an ipHash, never the raw IP", x2.json.entries.every((r) => r.address && /^\d{4}-\d{2}-\d{2}T/.test(r.created_at) && typeof r.ipHash === "string" && r.ipHash.length === 16 && !/127\.0\.0\.1/.test(JSON.stringify(r))));
    const x3 = await req(s1.base, "/api/cuna-draw/export", { headers: { "x-premium-key": KEY } });
    ok("the admin key also opens the export", x3.status === 200 && x3.json.count === 3);
    const csv = await req(s1.base, "/api/cuna-draw/export?format=csv", { headers: { "x-draw-token": TOKEN } });
    ok("CSV export: header + three lines", csv.status === 200 && csv.text.split("\n").filter(Boolean).length === 4 && csv.text.startsWith("address,created_at"));

    const d0 = await req(s1.base, "/api/cuna-draw/entry?address=" + C, { method: "DELETE" });
    ok("DELETE /entry without a token → 404, row still there", d0.status === 404 && (await req(s1.base, "/api/cuna-draw/check?address=" + C)).json.found === true);
    const d1 = await req(s1.base, "/api/cuna-draw/entry?address=" + C, { method: "DELETE", headers: { "x-draw-token": TOKEN } });
    ok("DELETE /entry with the token → removed:true", d1.status === 200 && d1.json.removed === true && d1.json.address === C, d1.json);
    ok("…and /check no longer finds it; export count is 2", (await req(s1.base, "/api/cuna-draw/check?address=" + C)).json.found === false && (await req(s1.base, "/api/cuna-draw/export", { headers: { "x-draw-token": TOKEN } })).json.count === 2);
    const d2 = await req(s1.base, "/api/cuna-draw/entry?address=" + C, { method: "DELETE", headers: { "x-premium-key": KEY } });
    ok("DELETE again (admin key) → removed:false", d2.status === 200 && d2.json.removed === false);
    ok("GET on /entry is not a route (a pasted link cannot delete)", (await req(s1.base, "/api/cuna-draw/entry?address=" + A, { headers: { "x-draw-token": TOKEN } })).status === 404);

    // Rate limit: 10/min on /enter per IP. We have used 6 so far in this window.
    let limited = false;
    for (let i = 0; i < 8; i++) { const r = await req(s1.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A }) }); if (r.status === 429) { limited = true; break; } }
    ok("the 11th POST in a minute → 429", limited);
  } finally { s1.stop(); }

  console.log("\nserver — window not open yet");
  const s2 = await boot(4472, { CUNA_DRAW_OPEN: "2099-01-01T00:00:00Z", CUNA_DRAW_CLOSE: "2099-06-01T00:00:00Z" });
  try {
    const e = await req(s2.base, "/api/cuna-draw/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A }) });
    ok("enter before the window → 403 and nothing recorded", e.status === 403 && e.json.window === "not_open", e.json);
    const x = await req(s2.base, "/api/cuna-draw/export", { headers: { "x-draw-token": TOKEN } });
    ok("export shows zero rows and state not_open", x.json.count === 0 && x.json.window.state === "not_open");
  } finally { s2.stop(); }

  console.log("\nserver — origin lockdown ON, requests arriving as lock.cunatoken.com");
  const s3 = await boot(4473, { CF_ORIGIN_SECRET: "edge-secret-for-test" });
  try {
    const H = { host: "lock.cunatoken.com" };
    const e = await req(s3.base, "/api/cuna-draw/enter", { method: "POST", headers: { ...H, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ address: A }) });
    ok("POST /enter passes the lock host's exemption → 200", e.status === 200 && e.json && e.json.recorded === true, { status: e.status, body: e.json || e.text.slice(0, 80) });
    const pre = await req(s3.base, "/api/cuna-draw/enter", { method: "OPTIONS", headers: { ...H, origin: ORIGIN } });
    ok("OPTIONS /enter passes too → 204", pre.status === 204, pre.status);
    const c = await req(s3.base, "/api/cuna-draw/check?address=" + A, { headers: H });
    ok("GET /check passes → found:true", c.status === 200 && c.json.found === true);
    const x = await req(s3.base, "/api/cuna-draw/export", { headers: { ...H, "x-draw-token": TOKEN } });
    ok("export is NOT reachable through the lock host even with the token → 403", x.status === 403, x.status);
    const dl = await req(s3.base, "/api/cuna-draw/entry?address=" + A, { method: "DELETE", headers: { ...H, "x-draw-token": TOKEN } });
    ok("DELETE /entry is NOT reachable through the lock host either → 403", dl.status === 403, dl.status);
    const direct = await req(s3.base, "/api/cuna-draw/enter", { method: "POST", headers: { host: "clucknorris.app", "content-type": "application/json" }, body: JSON.stringify({ address: B }) });
    ok("a direct-to-origin request on the main host without the edge header is still 403", direct.status === 403, direct.status);
  } finally { s3.stop(); }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
