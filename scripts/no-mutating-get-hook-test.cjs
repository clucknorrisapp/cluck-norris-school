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

// --- Per-request, not command-wide (Codex round 23 / #411 P2): an earlier or later curl's own
// -X POST must not "cover" an unrelated curl in the same shell command. ------------------------
expectExit(
  "unrelated POST first, then an unsafe admin GET after a ;",
  'curl -sS -X POST https://example.com/hook; curl -sS "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  2
);
expectExit(
  "explicit -X GET plus --data on an admin mutating route — GET wins, still unsafe",
  'curl -sS -X GET --data \'\' "https://clucknorris.app/api/tg-test?key=k&post=1"',
  2
);
expectExit(
  "-G (explicit GET override) plus --data-urlencode — still a GET, still unsafe",
  'curl -sS -G --data-urlencode "x=1" "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1"',
  2
);
expectExit(
  "unsafe admin GET first, then an unrelated POST after &&",
  'curl -sS "https://clucknorris.app/api/whirlpool/vault/pause?project=poke&key=k&run=1" && curl -sS -X POST https://example.com/x',
  2
);
expectExit(
  "-XPOST (no space) on the admin route itself",
  'curl -sS -XPOST -H "x-premium-key: k" "https://clucknorris.app/api/cuna-giveaway/admin?scan=1"',
  0
);
expectExit(
  "-X POST admin route piped into node — the curl segment itself is a safe POST",
  'curl -sS -X POST -H "x-premium-key: k" "https://clucknorris.app/api/cuna-giveaway/admin?scan=1" | node -e \'let s=""\'',
  0
);
expectExit(
  "two admin routes chained with ; , each POSTed on its own",
  'curl -sS --request POST "https://clucknorris.app/api/meme-queue?key=k&done=1" ; curl -sS -X POST "https://clucknorris.app/api/tg-test?key=k&chat=1&post=1"',
  0
);
expectExit(
  "flag-less admin read, no mutating flag at all",
  'curl -sS "https://clucknorris.app/api/cuna-giveaway/admin?key=k"',
  0
);

// --- The exact commands the money/admin slash commands run must all PASS ---
const COMMANDS_DIR = path.join(ROOT, ".claude", "commands");
const commandFiles = ["cuna-payout.md", "cuna-special.md", "promote.md", "store-release.md"];
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
