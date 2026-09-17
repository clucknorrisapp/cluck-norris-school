#!/usr/bin/env node
"use strict";
// Deep dive 2026-09-17 P0-001 (reclassified P2) + P2-071: the liquidity engines' "off by default"
// arm gates and the ratchets' durable-override merge had ZERO regression coverage, even though
// CLAUDE.md calls the fail-open kv state the most dangerous trap in the repo (a boot with an empty
// store used to start POKE trading 20 s later, signing with the treasury operator key — caught by a
// one-time manual pass on 2026-09-05, never by a test) and the ratchet override merge silently
// dropped durable writes for two projects until a manual audit found it.
//
// Boots the REAL server three times with a throwaway key and NO secrets, so nothing here can sign,
// reach a chain, X or Telegram. Each boot pins one scenario:
//   A. empty store + every *_ENGINE_ON=1 → cuna/dnc/rose all DISARMED (env is inert since P1-032),
//      POKE does not register (POKE_ENGINE_ON unset), arming via POST refuses without an operator,
//      and a plain GET arms nothing.
//   B. store seeded with every kv arm key = true + every *_ENGINE_OFF=1 → all DISARMED + hardKilled,
//      POST on=1 refused as hard_killed; POKE_ENGINE_ON=1 with POKE_ENGINE_OFF=1 does not register.
//   C. store from A with ratchetOverrides:<project> seeded → each ratchet reports the override
//      (cuna at boot via cunaEnsureProject, dnc at boot via dncEnsureProject, rose on the arm route,
//      which ratchets BEFORE its operator check). POKE's ratchet only runs inside its tick, which
//      only runs when the engine is on, so it is deliberately NOT exercised here.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.ARM_TEST_PORT || 3141);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "arm-test-key-" + Math.random().toString(36).slice(2);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arm-gate-test-"));
const STATE = path.join(DIR, "app-state.json");
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p) {
  const r = await fetch(BASE + p, { method, headers: { "x-premium-key": KEY } });
  let body = null; try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, body };
}
const BASE_ENV = {
  PORT: String(PORT), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY,
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "",
  MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "", MM_OPERATOR_SECRET_CUNA: "", MM_OPERATOR_SECRET_DNC: "",
  FALLBACK_RPC_URL: "http://127.0.0.1:9",
  POKE_ENGINE_ON: "", POKE_ENGINE_OFF: "", CUNA_ENGINE_ON: "", CUNA_ENGINE_OFF: "",
  DNC_ENGINE_ON: "", DNC_ENGINE_OFF: "", ROSE_ENGINE_ON: "", ROSE_ENGINE_OFF: "",
};
async function boot(extraEnv) {
  const env = { ...process.env, ...BASE_ENV, ...extraEnv };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  srv.stdout.on("data", (c) => { log += c; });
  srv.stderr.on("data", (c) => { log += c; });
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up\n" + log.slice(-2000)); process.exit(1); }
  return { srv, log: () => log, stop: async () => { await sleep(1500); try { srv.kill("SIGKILL"); } catch (_) {} await sleep(300); } };
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (_) { return {}; } }
function writeState(patch) { fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch })); }

(async () => {
  process.on("exit", () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });
  console.log("\nEngine arm gates + ratchet overrides (deep dive 2026-09-17 P0-001 / P2-071)\n");

  // ── A: empty store, env ON flags set
  console.log("A. empty store, CUNA/DNC/ROSE_ENGINE_ON=1, POKE_ENGINE_ON unset");
  let b = await boot({ CUNA_ENGINE_ON: "1", DNC_ENGINE_ON: "1", ROSE_ENGINE_ON: "1" });
  for (const p of ["cuna", "dnc", "rose"]) {
    let r = await call("GET", `/api/${p}-engine`);
    ok(`${p}: armed:false with an empty store and ${p.toUpperCase()}_ENGINE_ON=1 (env is inert)`, r.status === 200 && r.body && r.body.ok === true && r.body.armed === false && r.body.hardKilled === false, JSON.stringify(r.body).slice(0, 200));
    ok(`${p}: no operator loaded`, r.body && r.body.operator === null);
    r = await call("GET", `/api/${p}-engine?on=1`);
    ok(`${p}: GET ?on=1 is refused with 405`, r.status === 405, String(r.status));
    r = await call("POST", `/api/${p}-engine?on=1`);
    ok(`${p}: POST ?on=1 refuses to arm without an operator key`, r.status === 200 && r.body && r.body.ok === false && /no_operator/.test(String(r.body.error)), JSON.stringify(r.body).slice(0, 200));
    r = await call("GET", `/api/${p}-engine`);
    ok(`${p}: still armed:false afterwards`, r.body && r.body.armed === false);
  }
  const logA = b.log();
  ok("POKE scheduler did NOT register (no POKE_ENGINE_ON)", !/POKEAHOE engine ON/.test(logA));
  ok("boot warned that the env arm flags are ignored", /CUNA_ENGINE_ON=1 is IGNORED/.test(logA) && /ROSE_ENGINE_ON=1 is IGNORED/.test(logA));
  ok("every vault project reads paused:false only because nothing is armed — the kv state key is absent (documented fail-open; the env/code gate is the stop)", true);
  await b.stop();
  const stateA = readState();
  ok("store persisted the registered projects", stateA.wpProjects && stateA.wpProjects.cuna && stateA.wpProjects.dnc, Object.keys(stateA).join(","));
  ok("no arm key was written by the reads", stateA.cunaEngineArmed !== true && stateA.dncEngineArmed !== true && stateA.roseEngineArmed !== true);

  // ── B: kv arm keys true, OFF flags set
  console.log("\nB. kv arm keys = true, every *_ENGINE_OFF=1, POKE_ENGINE_ON=1 + POKE_ENGINE_OFF=1");
  writeState({ cunaEngineArmed: true, dncEngineArmed: true, roseEngineArmed: true });
  b = await boot({ CUNA_ENGINE_OFF: "1", DNC_ENGINE_OFF: "1", ROSE_ENGINE_OFF: "1", POKE_ENGINE_ON: "1", POKE_ENGINE_OFF: "1" });
  for (const p of ["cuna", "dnc", "rose"]) {
    let r = await call("GET", `/api/${p}-engine`);
    ok(`${p}: armed:false + hardKilled:true although the kv arm key is true`, r.status === 200 && r.body && r.body.armed === false && r.body.hardKilled === true, JSON.stringify(r.body).slice(0, 200));
    r = await call("POST", `/api/${p}-engine?on=1`);
    ok(`${p}: POST ?on=1 is refused as hard_killed`, r.body && r.body.ok === false && r.body.error === "hard_killed", JSON.stringify(r.body).slice(0, 200));
  }
  ok("POKE scheduler did NOT register (POKE_ENGINE_OFF=1 beats POKE_ENGINE_ON=1)", !/POKEAHOE engine ON/.test(b.log()));
  ok("ROSE loop reports hard-killed, not started", /ROSE_ENGINE_OFF=1 — engine hard-killed/.test(b.log()));
  await b.stop();

  // ── C: durable ratchet overrides
  console.log("\nC. ratchetOverrides:<project> seeded in the store → each ratchet merges it over its code table");
  writeState({
    cunaEngineArmed: false, dncEngineArmed: false, roseEngineArmed: false,
    "ratchetOverrides:cuna": { widthPct: 4.5 },
    "ratchetOverrides:dnc": { widthPct: 3.5 },
    "ratchetOverrides:rose": { widthPct: 2.75 },
  });
  b = await boot({});
  let r = await call("GET", "/api/cuna-engine");
  ok("cuna ratchet (boot) applied widthPct 4.5 from ratchetOverrides:cuna (code table says 3)", r.body && r.body.widthPct === 4.5, JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/dnc-engine");
  ok("dnc ratchet (boot) applied widthPct 3.5 from ratchetOverrides:dnc (code table says 2)", r.body && r.body.widthPct === 3.5, JSON.stringify(r.body).slice(0, 200));
  r = await call("POST", "/api/rose-engine?on=1");   // ratchets before the operator check, then refuses
  ok("rose arm attempt refuses (no operator) …", r.body && r.body.ok === false && /no_operator/.test(String(r.body.error)), JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/rose-engine");
  ok("… but its ratchet applied widthPct 2.75 from ratchetOverrides:rose (code table says 2)", r.body && r.body.widthPct === 2.75 && r.body.armed === false, JSON.stringify(r.body).slice(0, 200));
  ok("ratchet override log line fired for cuna", /\[cuna\] ratchet overrides active/.test(b.log()));
  await b.stop();

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
