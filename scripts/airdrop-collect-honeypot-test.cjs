#!/usr/bin/env node
"use strict";
// Airdrop signup honeypot — route-level test on the real server, offline. A filled "website"
// field (the hidden trap real visitors never see) must get the normal success shape back
// (so a bot can't tell it was caught) but must NOT be stored in the signup list.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PORT = Number(process.env.AC_TEST_PORT || 3171);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ac-honeypot-"));
// A syntactically valid, never-funded Solana address — rejectNonWallet fails open with no
// HELIUS_API_KEY set (see server.js), so this test needs no network access.
const ADDR_BOT = "11111111111111111111111111111112";
const ADDR_REAL = "So11111111111111111111111111111111111111112";
let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + d : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HELIUS_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" }, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/healthz")).ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  console.log("\nAirdrop-collect honeypot (offline)\n");

  const campaign = "hp-test";
  let r = await post("/api/airdrop-collect", { address: ADDR_BOT, campaign, website: "https://spam.example" });
  let j = await r.json();
  ok("filled honeypot → 200 with the normal success shape", r.status === 200 && j.success === true && typeof j.count === "number" && typeof j.message === "string", JSON.stringify(j));

  r = await fetch(BASE + "/api/airdrop-collect?c=" + campaign);
  j = await r.json();
  ok("…and the entry was NOT stored (public count stays 0)", r.status === 200 && j.count === 0, JSON.stringify(j));

  r = await post("/api/airdrop-collect", { address: ADDR_REAL, campaign, website: "" });
  j = await r.json();
  ok("empty honeypot (a real visitor) → stored normally", r.status === 200 && j.success === true && j.count === 1, JSON.stringify(j));

  r = await post("/api/airdrop-collect", { address: ADDR_REAL, campaign: "hp-test2" });
  j = await r.json();
  ok("no website field at all (older client) still works", r.status === 200 && j.success === true, JSON.stringify(j));

  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
