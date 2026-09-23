#!/usr/bin/env node
// Drives .claude/hooks/no-mutating-get.sh with fake PreToolUse payloads and checks the exit code:
// 2 (blocked) for a mutating admin GET, 0 (allowed) for everything else — including the exact
// commands the four money/admin slash commands (.claude/commands/*.md) actually run, which must
// all pass, since a hook that blocks its own runbook is worse than no hook.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HOOK = path.join(ROOT, ".claude", "hooks", "no-mutating-get.sh");

let failures = 0;
function runHook(command) {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const res = spawnSync("bash", [HOOK], { input: payload, encoding: "utf8" });
  return res;
}

function expectExit(label, command, expected) {
  const res = runHook(command);
  if (res.status === expected) {
    console.log(`ok - [exit ${expected}] ${label}`);
  } else {
    failures++;
    console.error(`FAIL: [expected exit ${expected}, got ${res.status}] ${label}`);
    console.error(`  command: ${command}`);
    if (res.stderr) console.error(`  stderr: ${res.stderr.trim()}`);
  }
}

if (!fs.existsSync(HOOK)) {
  console.error(`FAIL: hook script not found at ${HOOK}`);
  process.exit(1);
}

// --- Blocked: mutating admin flag, no POST ---------------------------------
expectExit(
  "vault pause with run=1, no -X POST",
  "curl 'https://clucknorris.app/api/whirlpool/vault/pause?project=poke&run=1&key=abc'",
  2
);
expectExit(
  "cuna-giveaway draw=1, plain GET",
  'curl "https://clucknorris.app/api/cuna-giveaway/admin?draw=1&prizes=1,2,3"',
  2
);
expectExit(
  "tg-test post=1, plain GET",
  'curl "https://clucknorris.app/api/tg-test?post=1&text=hi"',
  2
);
expectExit(
  "rose-buybot run=1, plain GET (the 2026-09-17 incident shape)",
  'curl "https://clucknorris.app/api/rose-buybot?run=1"',
  2
);
expectExit(
  "cuna-stake/admin arm=1, plain GET",
  'curl -H "x-premium-key: $K" "https://clucknorris.app/api/cuna-stake/admin?arm=1&confirm=go-live"',
  2
);

// --- Allowed: same routes/flags, but properly POSTed -----------------------
expectExit(
  "vault pause with run=1, -X POST",
  "curl -X POST 'https://clucknorris.app/api/whirlpool/vault/pause?project=poke&run=1&key=abc'",
  0
);
expectExit(
  "cuna-giveaway draw=1, -X POST",
  'curl -X POST -H "x-premium-key: $K" "https://clucknorris.app/api/cuna-giveaway/admin?draw=1&prizes=1,2,3"',
  0
);
expectExit(
  "tg-test post=1, -X POST",
  'curl -X POST "https://clucknorris.app/api/tg-test?post=1&text=hi"',
  0
);
expectExit(
  "x-announce post=1, --data instead of -X POST",
  "curl --data 'foo=bar' \"https://clucknorris.app/api/x-announce?post=1\"",
  0
);
expectExit(
  "x-delete run=1, --request POST",
  'curl --request POST "https://clucknorris.app/api/x-delete?run=1"',
  0
);

// --- Allowed: reads (no mutating flag), non-admin paths, non-curl ----------
expectExit(
  "cuna-stake payout read, no flags",
  'curl -H "x-premium-key: $K" "https://clucknorris.app/api/cuna-stake/payout"',
  0
);
expectExit(
  "public cuna-giveaway status (no /admin)",
  'curl "https://clucknorris.app/api/cuna-giveaway"',
  0
);
expectExit("non-curl command", "git status", 0);
expectExit(
  "curl to an unrelated host",
  'curl "https://example.com/api/whirlpool/vault/pause?run=1"',
  0
);

// --- The exact commands the money/admin slash commands run must all PASS ---
const COMMANDS_DIR = path.join(ROOT, ".claude", "commands");
const commandFiles = ["cuna-payout.md", "cuna-special.md", "promote.md"];
let extracted = 0;
for (const f of commandFiles) {
  const full = path.join(COMMANDS_DIR, f);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  // Pull every fenced code line that starts with `curl` — that's every real command these
  // runbooks actually execute.
  const lines = text.split(/\r?\n/).filter((l) => /^\s*curl\b/.test(l));
  for (const line of lines) {
    extracted++;
    expectExit(`${f}: ${line.trim().slice(0, 70)}...`, line.trim(), 0);
  }
}
if (extracted < 5) {
  failures++;
  console.error(`FAIL: expected to extract several curl lines from the slash commands, only found ${extracted}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll no-mutating-get hook checks passed.");
