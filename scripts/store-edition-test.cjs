#!/usr/bin/env node
"use strict";
// The STORE edition (Google Play / iOS bundle) — what a store reviewer and the wrapper both rely
// on, asserted rather than assumed. Two halves:
//   1. The bundle: builds it (scripts/build-store-edition.mjs), then independently re-checks the
//      published tarball — one top-level dir, index.html at the root after --strip-components=1,
//      sha256 file matches, and the content rules: no wallet, no pass, no swap widget, no
//      analytics, no link to a page the bundle does not carry, every API call absolute.
//   2. The backend it talks to: boots server.js and checks the CORS the app's webview origins
//      need (and ONLY on the endpoints the edition uses), the User-Agent defense-in-depth (the
//      store marker is refused on every excluded endpoint and grants nothing anywhere), the
//      certificate flow (gate blocks a fresh device; issues once the gate is off; idempotent;
//      public verification; no PII), and the Ask Cluck report.
// `--no-server` runs only half 1 (the release workflow uses it after the build).
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const NO_SERVER = args.includes("--no-server");
const variant = args.find((a) => !a.startsWith("--")) || "google";
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "store-edition", "store-edition.json"), "utf8"));
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("bundle — build + independent re-check");
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-store-edition.mjs"), variant], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] }).toString();
  const manifest = JSON.parse(out.trim().split("\n").pop());
  const tgz = path.join(ROOT, "release", manifest.file);
  ok("build wrote the tarball named per the contract", fs.existsSync(tgz) && manifest.file === `store-edition-${variant}-${cfg.version}.tgz`, manifest.file);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
  ok("manifest sha256 matches the file", sha === manifest.sha256);
  ok(".sha256 sidecar matches", fs.readFileSync(tgz + ".sha256", "utf8").startsWith(sha + "  "));
  ok("sourceCommit is a full git sha", /^[0-9a-f]{40}$/.test(manifest.sourceCommit));
  const listing = execFileSync("tar", ["-tzf", tgz]).toString().trim().split("\n");
  const top = new Set(listing.map((l) => l.split("/")[0]));
  ok("exactly one top-level directory, named like the file", top.size === 1 && [...top][0] === manifest.topDir, [...top]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "store-edition-"));
  execFileSync("tar", ["-xzf", tgz, "-C", tmp, "--strip-components=1"]);
  ok("--strip-components=1 leaves index.html at the root (what the wrapper's prep-dist runs)", fs.existsSync(path.join(tmp, "index.html")));
  for (const p of cfg.pages) ok(`carries ${p}`, fs.existsSync(path.join(tmp, p)));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(tmp), text = files.filter((f) => /\.(html|js|css|json)$/.test(f)).map((f) => [path.relative(tmp, f), fs.readFileSync(f, "utf8")]);
  const all = text.map(([, t]) => t).join("\n");
  // Since 1.0.2 the dictionaries are pruned at build time, so the checks cover EVERY text file —
  // the v1.0.1 residual (the CLKN mint inside an orphaned dictionary entry) is exactly what a
  // json exemption let through.
  const code = all;
  for (const bad of cfg.forbidden) ok(`bundle never contains "${bad}"`, !code.includes(bad), text.filter(([, t]) => t.includes(bad)).map(([f]) => f));
  for (const pat of cfg.forbiddenPatterns || []) { const re = new RegExp(pat); ok(`bundle code never matches /${pat}/`, !re.test(code), text.filter(([, t]) => re.test(t)).map(([f, t]) => `${f}: ${(t.match(re) || [""])[0].slice(0, 60)}`)); }
  // The v1.0.0 leaks (owner found them on-device 2026-09-12): a Jupiter swap link + the CLKN mint in
  // the LP Lab, Meteora/Bags/Jupiter venue + referral links in the Library, connect/revoke residue in
  // the wallet checkup. Pinned here so a regression is named, not just counted.
  ok("no swap/venue/referral leak (jup.ag/swap, CLKN mint, app.meteora.ag, bags.fm referral)", !code.includes("jup.ag/swap") && !code.includes("DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS") && !code.includes("app.meteora.ag") && !/bags\.fm\?ref/.test(code));
  ok("wallet checkup carries no connect/revoke residue (wallet-btn, syncRevokeUi, connectWallet)", (() => { const t = text.find(([f]) => f === "wallet-checkup.html")[1]; return !t.includes("wallet-btn") && !t.includes("syncRevokeUi") && !t.includes("connectWallet") && !t.includes("revokeCard"); })());
  ok("no relative /api reference anywhere", !/["'`]\/api\/[a-zA-Z]/.test(all));
  ok("every API call points at the live backend", all.includes(`${cfg.apiBase}/api/ask-cluck`) && all.includes(`${cfg.apiBase}/api/track`) && all.includes(`${cfg.apiBase}/api/claim/certificate`) && all.includes(`${cfg.apiBase}/api/wallet-checkup`) && all.includes(`${cfg.apiBase}/api/listing-checkup/run`));
  ok("the store-only surfaces are present (certificate, report, listing link)", all.includes("CERTIFICATE OF COMPLETION") && all.includes("REPORT THIS ANSWER") && all.includes("listing-checkup.html"));
  ok("the full edition's wallet claim and trade links are compiled out", !code.includes("YOU EARNED YOUR SPOT IN THE FLOCK") && !code.includes("Submit your Solana wallet"));
  ok("no leftover STORE markers", !/STORE:(OUT|IN)/.test(all));
  ok("no page in the bundle that is not allow-listed", files.filter((f) => f.endsWith(".html")).map((f) => path.relative(tmp, f)).sort().join(",") === ["index.html", ...cfg.pages].sort().join(","), files.filter((f) => f.endsWith(".html")).map((f) => path.relative(tmp, f)));
  ok("the wallet checkup page carries the scan but no revoke card, no connect, no signing", (() => { const t = text.find(([f]) => f === "wallet-checkup.html")[1]; return t.includes("/api/wallet-checkup?wallet=") && !t.includes("revokeCard") && !t.includes("connectWallet") && !t.includes("signAndSend"); })());
  ok("the listing checkup page runs the full sweep without a gate", (() => { const t = text.find(([f]) => f === "listing-checkup.html")[1]; return t.includes("function runFull()") && !t.includes("CluckGate") && !t.includes("tools pass"); })());
  fs.rmSync(tmp, { recursive: true, force: true });
  if (NO_SERVER) { console.log(failures ? `\n${failures} FAILED` : "\nall passed (bundle only)"); process.exit(failures ? 1 : 0); }

  console.log("\nbackend — CORS, UA defense, certificate, report");
  const KEY = "store-test-admin-key";
  async function boot(port, extraEnv) {
    const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "store-srv-"));
    const env = { ...process.env, PORT: String(port), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY, TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "", FALLBACK_RPC_URL: "http://127.0.0.1:9", ...extraEnv };
    const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`; let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    const stop = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
    if (!up) { stop(); throw new Error("server did not come up on " + port); }
    return { base, stop };
  }
  function req(base, p, { method = "GET", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(base + p); const h = { ...headers };
      if (body != null) h["content-length"] = String(Buffer.byteLength(body));
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
        let t = ""; res.setEncoding("utf8"); res.on("data", (c) => { t += c; });
        res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, json: j, text: t, h: (k) => res.headers[k.toLowerCase()] }); });
      });
      r.on("error", reject); if (body != null) r.write(body); r.end();
    });
  }
  const CAP = "capacitor://localhost", UA = "Mozilla/5.0 (Linux; Android 14) ClucknorrisPlay/1.0";
  const s1 = await boot(4481, { GRAD_GATE_OFF: "" });
  try {
    const pre = await req(s1.base, "/api/ask-cluck", { method: "OPTIONS", headers: { origin: CAP, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    ok("OPTIONS /api/ask-cluck from capacitor://localhost → 204 with the CORS triple", pre.status === 204 && pre.h("access-control-allow-origin") === CAP && pre.h("access-control-allow-methods") === "GET, POST, OPTIONS" && /content-type/i.test(pre.h("access-control-allow-headers") || ""), { status: pre.status, acao: pre.h("access-control-allow-origin") });
    for (const o of ["https://localhost", "http://localhost"]) { const r = await req(s1.base, "/api/track", { method: "OPTIONS", headers: { origin: o } }); ok(`OPTIONS /api/track from ${o} → 204 + echo`, r.status === 204 && r.h("access-control-allow-origin") === o); }
    const tr = await req(s1.base, "/api/track", { method: "POST", headers: { origin: CAP, "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ event: "lesson_start:x", sid: "store-test-sid-0001" }) });
    ok("POST /api/track with the store origin + UA is served with CORS", tr.status < 400 && tr.h("access-control-allow-origin") === CAP, { status: tr.status, acao: tr.h("access-control-allow-origin") });
    const ex = await req(s1.base, "/api/hatchery/config", { method: "OPTIONS", headers: { origin: CAP, "access-control-request-method": "GET" } });
    ok("an excluded endpoint gets NO CORS for the app origin (preflight does not 204 with our headers)", !(ex.status === 204 && ex.h("access-control-allow-origin") === CAP), { status: ex.status, acao: ex.h("access-control-allow-origin") });
    const foreign = await req(s1.base, "/api/ask-cluck", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    ok("a foreign origin gets no app-origin echo", foreign.h("access-control-allow-origin") !== "https://evil.example");
    for (const p of ["/api/tool-gate/config", "/api/tool-gate/session", "/api/hatchery/config", "/api/buyspecial/config", "/api/lock/recent", "/api/wallet-xray?wallet=x", "/api/trace?wallet=x", "/api/claim", "/api/cuna-draw/enter", "/api/security-coop/revoke", "/api/airdrop-collect"]) {
      const r = await req(s1.base, p, { method: p === "/api/claim" || p.includes("session") || p.includes("enter") || p.includes("revoke") ? "POST" : "GET", headers: { "user-agent": UA, "content-type": "application/json" }, body: "{}" });
      ok(`store UA refused on ${p} → 403`, r.status === 403 && r.json && r.json.error === "not_available_in_this_edition", r.status);
    }
    const allowed = await req(s1.base, "/api/tool-gate/config", { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/128" } });
    ok("the same excluded endpoint still serves a normal browser (the UA is a hint, not a gate)", allowed.status === 200, allowed.status);
    const cert0 = await req(s1.base, "/api/claim/certificate", { method: "POST", headers: { origin: CAP, "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ sid: "store-test-sid-0001", coursework: { lpLab: 3 } }) });
    ok("certificate for a device with no lesson record → 403 not_yet (the gate holds without a wallet)", cert0.status === 403 && cert0.json && cert0.json.error === "not_yet", cert0.json);
    ok("bad sid → 400", (await req(s1.base, "/api/claim/certificate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: "x" }) })).status === 400);
    const rep = await req(s1.base, "/api/ask-cluck/report", { method: "POST", headers: { origin: CAP, "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ question: "what is a wallet", answer: "a bank", reason: "inaccurate" }) });
    ok("POST /api/ask-cluck/report → 200 with CORS", rep.status === 200 && rep.json && rep.json.ok === true && rep.h("access-control-allow-origin") === CAP, rep.json);
    ok("an empty report → 400", (await req(s1.base, "/api/ask-cluck/report", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 400);
    const list0 = await req(s1.base, "/api/ask-cluck/reports");
    ok("reports need the admin key → 404", list0.status === 404);
    const list1 = await req(s1.base, "/api/ask-cluck/reports", { headers: { "x-premium-key": KEY } });
    ok("the owner reads the report with reason, question, answer and edition=store, and nothing identifying", list1.status === 200 && list1.json.count === 1 && list1.json.reports[0].reason === "inaccurate" && list1.json.reports[0].edition === "store" && !JSON.stringify(list1.json.reports[0]).includes("127.0.0.1"), list1.json);
  } finally { s1.stop(); }

  const s2 = await boot(4482, { GRAD_GATE_OFF: "1" });
  try {
    const a = await req(s2.base, "/api/claim/certificate", { method: "POST", headers: { origin: CAP, "content-type": "application/json" }, body: JSON.stringify({ sid: "store-test-sid-0002", coursework: { lpLab: 5, incubator: 9 } }) });
    ok("gate off → a certificate is issued with an id, a date and a verify URL", a.status === 200 && a.json && a.json.ok && /^C[0-9A-F]{10}$/.test(a.json.certificate.id) && a.json.certificate.verifyUrl.endsWith("/certificate/" + a.json.certificate.id) && a.json.certificate.coursework.lpLab === 5, a.json);
    const b = await req(s2.base, "/api/claim/certificate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: "store-test-sid-0002" }) });
    ok("asking again returns the SAME certificate (one per learner session)", b.status === 200 && b.json.certificate.id === a.json.certificate.id && b.json.certificate.issuedAt === a.json.certificate.issuedAt);
    const c = await req(s2.base, "/api/claim/certificate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: "store-test-sid-0003" }) });
    ok("another session gets a different certificate", c.status === 200 && c.json.certificate.id !== a.json.certificate.id);
    const v = await req(s2.base, "/api/certificate/" + a.json.certificate.id, { headers: { origin: CAP } });
    ok("public verification JSON: genuine, dated, no sid, no name, with CORS", v.status === 200 && v.json.ok && v.json.id === a.json.certificate.id && !JSON.stringify(v.json).includes("sid") && v.h("access-control-allow-origin"), v.json);
    ok("lower-case id verifies too", (await req(s2.base, "/api/certificate/" + a.json.certificate.id.toLowerCase())).status === 200);
    ok("an unknown id → 404", (await req(s2.base, "/api/certificate/CDEADBEEF00")).status === 404);
    const page = await req(s2.base, "/certificate/" + a.json.certificate.id);
    // The store edition's own legal pages: direct HTTPS URLs for the Play listing + the in-app
    // footer. They must describe the stripped app — no token payments, no address collection.
    for (const [route, must] of [["/privacy/store", "no wallet address"], ["/terms/store", "no token requirement"]]) {
      const lp = await req(s2.base, route);
      const bad = ["CLKN token", "Google Sheets", "airdrop list", "premium", "transcript", "wallet-connect"].filter((w) => lp.text.includes(w));
      ok(`${route} loads and describes the stripped app`, lp.status === 200 && /text\/html/.test(lp.h("content-type") || "") && lp.text.includes(must) && lp.text.includes("CLKN Productions") && bad.length === 0, { status: lp.status, bad });
    }
    ok("the human page renders the id and says it is genuine", page.status === 200 && page.text.includes(a.json.certificate.id) && /genuine/i.test(page.text) && /<title>Certificate/.test(page.text));
    ok("the human page 404s an unknown id without echoing markup", (await req(s2.base, "/certificate/%3Cscript%3E")).status === 404);
  } finally { s2.stop(); }

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
