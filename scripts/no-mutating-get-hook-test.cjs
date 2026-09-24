#!/usr/bin/env node
// Drives the no-mutating-get hook with fake PreToolUse payloads and checks the exit code: 2
// (blocked) for a mutating admin GET, 0 (allowed) for everything else — including the exact
// commands the four money/admin slash commands (.claude/commands/*.md) actually run, which must
// all pass, since a hook that blocks its own runbook is worse than no hook.
//
// Codex round 24 (#414 P2s): the decision now lives in no-mutating-get.js, and no-mutating-get.sh
// is just a portable wrapper around it. Every case here runs through BOTH the .sh wrapper (the way
// the harness actually invokes it) AND the .js directly, so a CI runner without node on PATH can
// never mask a logic bug in the .js by silently falling through to the wrapper's crude fallback.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HOOK_SH = path.join(ROOT, ".claude", "hooks", "no-mutating-get.sh");
const HOOK_JS = path.join(ROOT, ".claude", "hooks", "no-mutating-get.js");

let failures = 0;
function runVia(bin, args, command) {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  return spawnSync(bin, args, { input: payload, encoding: "utf8" });
}

function expectExit(label, command, expected) {
  const shRes = runVia("bash", [HOOK_SH], command);
  const jsRes = runVia("node", [HOOK_JS], command);
  let ok = true;
  if (shRes.status !== expected) {
    ok = false;
    failures++;
    console.error(`FAIL (.sh): [expected exit ${expected}, got ${shRes.status}] ${label}`);
    console.error(`  command: ${command}`);
    if (shRes.stderr) console.error(`  stderr: ${shRes.stderr.trim()}`);
  }
  if (jsRes.status !== expected) {
    ok = false;
    failures++;
    console.error(`FAIL (.js): [expected exit ${expected}, got ${jsRes.status}] ${label}`);
    console.error(`  command: ${command}`);
    if (jsRes.stderr) console.error(`  stderr: ${jsRes.stderr.trim()}`);
  }
  if (ok) {
    console.log(`ok - [exit ${expected}] ${label} (.sh + .js)`);
  }
}

if (!fs.existsSync(HOOK_SH)) {
  console.error(`FAIL: hook wrapper not found at ${HOOK_SH}`);
  process.exit(1);
}
if (!fs.existsSync(HOOK_JS)) {
  console.error(`FAIL: hook script not found at ${HOOK_JS}`);
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
expectExit(
  "cuna-giveaway rewind=, plain GET (2026-09-24 settle-delay fix)",
  'curl "https://clucknorris.app/api/cuna-giveaway/admin?key=k&rewind=2026-09-23T12:25:00Z"',
  2
);
expectExit(
  "cuna-giveaway rewind= as POST",
  'curl -sS -X POST -H "x-premium-key: k" "https://clucknorris.app/api/cuna-giveaway/admin?rewind=2026-09-23T12:25:00Z"',
  0
);

// --- Codex round 24 (#414 P2s): quote-aware boundaries + curl's effective method -----------------
expectExit(
  "explicit -X POST overridden by a later -X GET on the SAME curl — curl sends GET, still unsafe",
  'curl -X POST -X GET "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  2
);
expectExit(
  "backgrounded with a trailing & — must still be judged, not swallowed",
  'curl -sS "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1" &',
  2
);
expectExit(
  "curl hidden inside $(...) even though the whole thing is wrapped in an outer double-quoted echo",
  'echo "$(curl -sS "https://clucknorris.app/api/tg-test?key=k&post=1")"',
  2
);
expectExit(
  "curl hidden inside a backtick command substitution assigned to a variable",
  'X=`curl -sS "https://clucknorris.app/api/meme-queue?key=k&done=1"`',
  2
);
expectExit(
  "unrelated POST first, then an unsafe admin GET after a ; — the ; must still split them",
  'curl -sS -X POST https://example.com/a; curl -sS "https://clucknorris.app/api/whirlpool/vault/pause?project=poke&key=k&run=1"',
  2
);
expectExit(
  "unrelated POST first, then an unsafe admin GET after && — the && must still split them",
  'curl -sS -X POST https://example.com/a && curl -sS "https://clucknorris.app/api/whirlpool/vault/pause?project=poke&key=k&run=1"',
  2
);
expectExit(
  "-d with an explicit -G override — curl sends this as a GET despite the data flag",
  'curl -d "" -G "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1"',
  2
);
expectExit(
  "-I (HEAD) on a mutating admin route — not a POST",
  'curl -I "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1"',
  2
);
expectExit(
  "wrapped in a bare subshell (...) — the parens must not hide the curl inside",
  '(curl -sS "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1")',
  2
);
expectExit(
  "-X GET then -X POST — last -X wins, curl sends POST, allowed",
  'curl -X GET -X POST "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1"',
  0
);
expectExit(
  "-sSXPOST combined short-flag cluster with an inline method value",
  'curl -sSXPOST -H "x-premium-key: k" "https://clucknorris.app/api/cuna-giveaway/admin?scan=1"',
  0
);
expectExit(
  "--request=POST long-flag inline form",
  'curl -sS --request=POST "https://clucknorris.app/api/meme-queue?key=k&done=1"',
  0
);
expectExit(
  "-X 'POST' with the method value quoted",
  "curl -sS -X 'POST' \"https://clucknorris.app/api/tg-test?key=k&chat=1&post=1\"",
  0
);
expectExit(
  "-F form data implies POST",
  'curl -sS -F "photo=@/tmp/x.png" "https://clucknorris.app/api/tg-test?key=k&chat=1&post=1"',
  0
);
expectExit(
  "-G after -X POST — explicit -X still wins over -G per curl's own precedence",
  'curl -sS -G -X POST "https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1"',
  0
);
expectExit(
  "a safe -X POST curl piped into a non-curl command — the pipe target is not itself a curl",
  "curl -sS -X POST \"https://clucknorris.app/api/cuna-giveaway/admin?key=k&scan=1\" | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d)'",
  0
);
expectExit(
  "-X POST with a URL-encoded ampersand in a value — still fine, still POST",
  'curl -sS -X POST "https://clucknorris.app/api/tg-test?key=k&chat=1&post=1&text=a%26b"',
  0
);

// --- Codex round 32 P2: short-flag cluster value-consumption + --next request boundary ---------
expectExit(
  "-o/dev/null short-flag value must not be misparsed as -d data (Codex round 32)",
  'curl -o/dev/null "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  2
);
expectExit(
  "-o /dev/null (separate word) is the same trap, still allowed since it's a plain GET with no data intent — must still block on the admin mutating GET",
  'curl -o /dev/null "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  2
);
expectExit(
  "-X POST safe request, --next resets the method for the admin GET that follows (Codex round 32)",
  'curl -X POST https://example.com/hook --next "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  2
);
expectExit(
  "--next admin request explicitly POSTed on its own side is allowed",
  'curl -X POST https://example.com/hook --next -X POST "https://clucknorris.app/api/cuna-giveaway/admin?key=k&draw=1"',
  0
);

// --- Codex round 32 P2: -G/--get converts -d/--data* into query params MUTATING_FLAG_RE must see -
expectExit(
  "-G --data-urlencode draw=1 turns into a GET query the raw-text check couldn't see (Codex round 32)",
  'curl -G --data-urlencode draw=1 "https://clucknorris.app/api/cuna-giveaway/admin?key=k"',
  2
);
expectExit(
  "-G -d 'draw=1' — same trap, short -d form",
  "curl -G -d 'draw=1' \"https://clucknorris.app/api/cuna-giveaway/admin?key=k\"",
  2
);
expectExit(
  "-G --data-raw 'x=1&draw=1' — the mutating flag is buried inside a larger data-raw value",
  "curl -G --data-raw 'x=1&draw=1' \"https://clucknorris.app/api/cuna-giveaway/admin?key=k\"",
  2
);
expectExit(
  "-G with data that carries no mutating flag at all stays allowed",
  "curl -G -d 'foo=bar' \"https://clucknorris.app/api/cuna-giveaway/admin?key=k\"",
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
