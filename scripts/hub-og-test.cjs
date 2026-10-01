#!/usr/bin/env node
"use strict";
// Colosseum roadmap §9 Y4 — shareable Hub pages. Boots the real server with a throwaway DATA_DIR
// pre-seeded with one hostile-label registry project (the escaping case) and drives the Hub demo
// fixture (E2) plus the real /hub/:project route over HTTP, asserting the SERVER-RENDERED <head>
// (not the client-rendered body) carries correct, escaped Open Graph / Twitter Card meta, that a
// missing project/program/receipt still serves 200 with the generic Hub meta, that the demo pages
// carry the "DRY RUN — fixture data" label, and that the static card image route serves a real
// PNG with a long cache header.
//
// Usage: node scripts/hub-og-test.cjs [baseUrl]
// Env:   OG_TEST_PORT (default 3222) — used only when baseUrl is omitted (a server is booted).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ARG_BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || null;
const PORT = Number(process.env.OG_TEST_PORT || 3222);
const BASE = ARG_BASE || `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hub-og-test-"));

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, headers: r.headers, text: await r.text() };
}
function metaOf(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}
function titleOf(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1] : null;
}

// A registry project with an XSS-shaped label — hubProjects() (server.js) reads the registry raw
// (mint/label/symbol/decimals only, no HTML sanitizing there — escaping is this feature's job, at
// render time), so seeding it directly into app-state.json exercises the real hubProjectView()
// path a curl against production would hit.
const HOSTILE_LABEL = "<b>Evil</b> & Co";
const SEED = {
  "hub:projects": {
    xtest: { id: "xtest", label: HOSTILE_LABEL, symbol: "xte", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  },
};

(async () => {
  let srv = null;
  if (!ARG_BASE) {
    fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(SEED));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, TOOLGATE_OFF: "1",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
      FALLBACK_RPC_URL: "http://127.0.0.1:9" };
    srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
    let up = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
    if (!up) { console.error("  server did not come up"); if (srv) srv.kill("SIGKILL"); process.exit(1); }
  }
  const done = () => { if (srv) { try { srv.kill("SIGKILL"); } catch (_) {} } try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);

  console.log(`\nHub shareable Open Graph / Twitter Card meta (Colosseum roadmap Y4) — ${BASE}\n`);

  // ── 1. the static card image ────────────────────────────────────────────────────────────────
  {
    const r = await fetch(`${BASE}/og/hub-card.png`);
    ok("image route: 200", r.status === 200, "got " + r.status);
    ok("image route: image/png", (r.headers.get("content-type") || "").includes("image/png"), r.headers.get("content-type"));
    ok("image route: long cache", /max-age=31536000/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
    const buf = Buffer.from(await r.arrayBuffer());
    ok("image route: non-trivial PNG body", buf.length > 1000, String(buf.length));
  }

  // ── 2. Hub index (no project) — generic meta ────────────────────────────────────────────────
  {
    const { text } = await getText("/hub");
    ok("index: og:image points at the static card", metaOf(text, "og:image") === "https://clucknorris.app/og/hub-card.png");
    ok("index: og:type website", metaOf(text, "og:type") === "website");
    ok("index: twitter:card summary_large_image", metaOf(text, "twitter:card") === "summary_large_image");
    ok("index: og:url is the hub root", metaOf(text, "og:url") === "https://clucknorris.app/hub", metaOf(text, "og:url"));
  }

  // ── 3. real project page with a hostile label — escaped, not executed ──────────────────────
  {
    const { text } = await getText("/hub/xtest");
    const title = titleOf(text) || "";
    const desc = metaOf(text, "og:description") || "";
    ok("project: raw <b> never reaches the page", !text.includes("<b>Evil</b>"));
    ok("project: label is HTML-escaped in <title>", title.includes("&lt;b&gt;Evil&lt;/b&gt; &amp; Co"), title);
    ok("project: label is HTML-escaped in og:description", desc.includes("&lt;b&gt;Evil&lt;/b&gt; &amp; Co") || desc.includes(HOSTILE_LABEL.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;")), desc);
    ok("project: title <= 70 chars", title.length <= 70, String(title.length));
    ok("project: description <= 200 chars", desc.length <= 200, String(desc.length));
    ok("project: description names the reproducibility line", desc.includes("reproducible from the published inputs"), desc);
  }

  // ── 4. an unknown project still serves the generic meta at 200 ─────────────────────────────
  {
    const { status, text } = await getText("/hub/does-not-exist-project");
    ok("unknown project: still 200", status === 200, String(status));
    ok("unknown project: falls back to the generic Hub title", titleOf(text) === "Project Hub — receipts you can verify", titleOf(text));
  }

  // ── 5. the demo walkthrough (E2) carries the DRY RUN — fixture data label ──────────────────
  {
    const { text } = await getText("/hub/demo");
    ok("demo project: title names the fixture project", (titleOf(text) || "").includes("Demo Community"), titleOf(text));
    ok("demo project: DRY RUN — fixture data label present", (metaOf(text, "og:description") || "").includes("DRY RUN — fixture data"), metaOf(text, "og:description"));
    ok("demo project: still points at the one static card", metaOf(text, "og:image") === "https://clucknorris.app/og/hub-card.png");
  }
  {
    const { text } = await getText("/hub/demo-b");
    ok("demo-b: isolated project's own label", (titleOf(text) || "").includes("Demo Community B"), titleOf(text));
  }

  // ── 6. a demo receipt page — amount + symbol + the reproducibility line, escaped ───────────
  {
    const { text } = await getText("/hub/demo/r/rcpt-a");
    const title = titleOf(text) || "", desc = metaOf(text, "og:description") || "";
    ok("demo receipt: title carries an amount and the symbol", /DEMO/.test(title) && /receipt/i.test(title), title);
    ok("demo receipt: description carries the reproducibility line", desc.includes("reproducible from the published inputs"), desc);
    ok("demo receipt: DRY RUN — fixture data label present", desc.includes("DRY RUN — fixture data"), desc);
    ok("demo receipt: twitter:title mirrors og:title (escaped identically)", metaOf(text, "twitter:title") === title, metaOf(text, "twitter:title") + " vs " + title);
  }

  // ── 7. a missing demo receipt still serves the page with the GENERIC meta ─────────────────
  {
    const { status, text } = await getText("/hub/demo/r/does-not-exist");
    ok("missing demo receipt: still 200", status === 200, String(status));
    ok("missing demo receipt: generic Hub title", titleOf(text) === "Project Hub — receipts you can verify", titleOf(text));
    ok("missing demo receipt: generic Hub description", metaOf(text, "og:description") === "What a project promised its holders, who qualified, and the transaction that paid each one — re-checked against Solana in your browser. No wallet needed.");
  }

  // ── 8. for-projects — a static generic card (no per-request build) ────────────────────────
  {
    const { text } = await getText("/for-projects");
    ok("for-projects: og:image set", metaOf(text, "og:image") === "https://clucknorris.app/og/hub-card.png");
    ok("for-projects: twitter:card set", metaOf(text, "twitter:card") === "summary_large_image");
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing assertion${failures === 1 ? "" : "s"}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
