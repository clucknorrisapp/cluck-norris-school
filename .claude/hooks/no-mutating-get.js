#!/usr/bin/env node
"use strict";
// The whole decision for the no-mutating-get PreToolUse hook. `no-mutating-get.sh` is a thin,
// portable wrapper that just pipes stdin here and exits with our exit code — this file does all
// the parsing, so it behaves identically on every runner Node itself runs on (unlike a bash
// string-splitting version, which a session found does NOT behave identically: Codex round 24 /
// #414 found that macOS's stock Bash 3.2 failed the previous version's own `;`/`&&` test cases
// outright, and that a background `&` or a nested `$(curl …)`/backtick invocation bypassed the
// whole check because the old splitter only knew about `;`, `&&`, `||`, `|` and newlines).
//
// Two things this file fixes over the old bash version:
//
// 1. Quote-aware, portable segmentation (see `segmentCommand`) — walks the command character by
//    character tracking single-quote/double-quote/backslash state, so a URL's own `&` inside
//    quotes is never mistaken for the shell's background operator, but a REAL command boundary —
//    including one hidden inside `$(...)`  or backticks — always splits the command into separate
//    invocations to judge independently.
// 2. curl's actual EFFECTIVE method (see `computeEffectiveMethod`) — curl honours the LAST `-X`
//    on its command line, not the first, and `-G`/`-I`/`-T` change what a data flag actually sends
//    as. The old check accepted `curl -X POST -X GET <admin-url>?draw=1` because *an* explicit
//    POST was present anywhere in the segment — but curl itself sends that request as a GET.
//
// Exit 0 = allow. Exit 2 = block (message on stderr). Never crashes the hook: any unexpected
// internal error falls back to a coarse fail-CLOSED text check rather than silently allowing.

const fs = require("fs");

// Only look at commands that target clucknorris.app/api/ under one of the known admin paths.
const ADMIN_PATH_RE = /clucknorris\.app\/api\/(whirlpool\/vault|cuna-giveaway\/admin|cuna-stake\/payout|cuna-stake\/admin|tg-test|x-announce|meme-queue|lock-celebration|buybot|rose-buybot|x-delete|diploma-mint|school-airdrop|[a-zA-Z0-9_-]*-engine)/;

// Only look at segments carrying a mutating flag.
const MUTATING_FLAG_RE = /[?&](run=1|arm=1|disarm=1|set=|draw=1|payout=1|export=1|send=|confirm=|sweep=1|post=1|done=|art=|clear=1|reset=1|scan=1|rewind=|board=1|on=1|off=1|dq=|min=|start=|end=)/;

// ---------------------------------------------------------------------------------------------
// 1. Quote-aware invocation-boundary scanner.
//
// Semantics (deliberately simplified, not a full shell grammar, but faithful enough to never miss
// a real boundary or split a quoted value apart):
//   - Outside ANY quotes: `;`, `&&`, `||`, `|`, a lone `&` (background), `(`, `)`, `{`, `}`,
//     newline, `$(` and a backtick are all boundaries.
//   - Inside double quotes: nothing is a boundary EXCEPT `$(` and a backtick — command
//     substitution still runs even inside a double-quoted string, so a curl hidden behind it must
//     still be judged on its own.
//   - Inside single quotes: nothing is ever a boundary, not even `$(`/backtick — single quotes are
//     fully literal in the shell.
//   - A `&` inside single or double quotes is never a boundary, so a URL query string like
//     `?key=k&draw=1` stays whole with the curl that reads it.
//   - Every boundary starts a fresh segment in a fresh (unquoted) state — a boundary can only ever
//     fire once we are textually outside single quotes, and the two boundary characters that can
//     fire while `inDouble` is still true ( `$(` / backtick ) mark the start of a brand-new command
//     context (the whole point of command substitution), so the quote state does not carry across
//     them.
function segmentCommand(command) {
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  const n = command.length;
  let i = 0;

  function pushSegment() {
    if (current.trim() !== "") segments.push(current);
    current = "";
    inDouble = false;
    inSingle = false;
  }

  while (i < n) {
    const ch = command[i];

    // Backslash escapes the next character everywhere except inside single quotes.
    if (ch === "\\" && !inSingle) {
      current += ch;
      if (i + 1 < n) {
        current += command[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }

    // `$(` and a backtick are boundaries even inside double quotes — command substitution
    // still runs there. Never fires inside single quotes (excluded above).
    if (ch === "$" && command[i + 1] === "(") {
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === "`") {
      pushSegment();
      i += 1;
      continue;
    }

    if (ch === '"') {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }

    if (inDouble) {
      // Inside double quotes, nothing else is a boundary — & ; | ( ) { } and newline are all
      // literal text here.
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      i += 1;
      continue;
    }

    // Fully unquoted from here on — the remaining boundary characters apply.
    if (ch === "\n" || ch === ";" || ch === "(" || ch === ")" || ch === "{" || ch === "}") {
      pushSegment();
      i += 1;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === "|") {
      pushSegment();
      i += 1;
      continue;
    }
    if (ch === "&") {
      // A lone `&` outside any quotes is the background operator — a boundary.
      pushSegment();
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  pushSegment();
  return segments;
}

// ---------------------------------------------------------------------------------------------
// Quote-aware word tokenizer for ONE already-isolated invocation (a segment). Splits on
// whitespace, strips the quotes from each word's value, and treats `--opt=value` as a single word
// because `=` is never a separator.
function tokenizeWords(text) {
  const words = [];
  let current = "";
  let started = false;
  let inSingle = false;
  let inDouble = false;
  const n = text.length;
  let i = 0;

  function pushWord() {
    if (started) words.push(current);
    current = "";
    started = false;
  }

  while (i < n) {
    const ch = text[i];

    if (ch === "\\" && !inSingle) {
      started = true;
      if (i + 1 < n) {
        current += text[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        i += 1;
        continue;
      }
      current += ch;
      started = true;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        i += 1;
        continue;
      }
      current += ch;
      started = true;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      started = true;
      i += 1;
      continue;
    }

    if (ch === " " || ch === "\t") {
      pushWord();
      i += 1;
      continue;
    }

    current += ch;
    started = true;
    i += 1;
  }
  pushWord();
  return words;
}

// ---------------------------------------------------------------------------------------------
// 2. curl's actual effective HTTP method for one invocation's words.
//
// `-X <m>` / `-X<m>` / `--request <m>` / `--request=<m>` set `explicit` — the LAST one on the
// command line wins, matching curl's own behaviour. `-G`/`--get` force a GET (moving any `-d` data
// onto the URL); `-I`/`--head` force a HEAD; `-T`/`--upload-file` implies a PUT; any of
// `-d`/`--data*`/`--json`/`-F`/`--form*` implies a POST. Combined short-flag clusters like
// `-sSXPOST` or `-sSd` are handled by scanning the cluster for the LAST-letter special flag
// (X/d/G/I/T/F) and either taking the rest of that word as its inline value or, if nothing
// follows in the word, the next word on the command line. Anything after a bare `--` is a
// positional argument, never a flag.
const SHORT_VALUE_FLAGS = new Set(["X", "d", "G", "I", "T", "F"]);
const DATA_LONG_FLAGS = new Set([
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "--json",
  "--form",
  "--form-string",
]);
const DATA_LONG_PREFIXES = Array.from(DATA_LONG_FLAGS, (f) => f + "=");

function computeEffectiveMethod(words) {
  let explicit = null;
  let forceGet = false;
  let head = false;
  let upload = false;
  let hasData = false;
  let noMoreFlags = false;

  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx];
    if (noMoreFlags) continue;
    if (w === "--") {
      noMoreFlags = true;
      continue;
    }
    if (w.length < 2 || w[0] !== "-") continue; // not a flag — a URL or other positional value

    if (w[1] === "-") {
      // Long flag.
      if (w === "--request") {
        if (words[idx + 1] !== undefined) {
          explicit = words[idx + 1].toUpperCase();
          idx++;
        }
        continue;
      }
      if (w.startsWith("--request=")) {
        explicit = w.slice("--request=".length).toUpperCase();
        continue;
      }
      if (w === "--get") {
        forceGet = true;
        continue;
      }
      if (w === "--head") {
        head = true;
        continue;
      }
      if (w === "--upload-file") {
        upload = true;
        if (words[idx + 1] !== undefined) idx++;
        continue;
      }
      if (w.startsWith("--upload-file=")) {
        upload = true;
        continue;
      }
      if (DATA_LONG_FLAGS.has(w)) {
        hasData = true;
        if (words[idx + 1] !== undefined) idx++;
        continue;
      }
      if (DATA_LONG_PREFIXES.some((p) => w.startsWith(p))) {
        hasData = true;
        continue;
      }
      continue; // unrecognized long flag — ignore
    }

    // Short flag or a cluster of them (e.g. -sSXPOST, -sSd, -G, -I).
    const body = w.slice(1);
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (!SHORT_VALUE_FLAGS.has(c)) continue;
      const remainder = body.slice(j + 1);
      if (c === "X") {
        if (remainder.length > 0) {
          explicit = remainder.toUpperCase();
        } else if (words[idx + 1] !== undefined) {
          explicit = words[idx + 1].toUpperCase();
          idx++;
        }
      } else if (c === "d") {
        hasData = true;
        if (remainder.length === 0 && words[idx + 1] !== undefined) idx++;
      } else if (c === "G") {
        forceGet = true;
      } else if (c === "I") {
        head = true;
      } else if (c === "T") {
        upload = true;
        if (remainder.length === 0 && words[idx + 1] !== undefined) idx++;
      } else if (c === "F") {
        hasData = true;
        if (remainder.length === 0 && words[idx + 1] !== undefined) idx++;
      }
      break; // the rest of this word (if any) was the flag's inline value, not more flags
    }
  }

  if (explicit) return explicit;
  if (head) return "HEAD";
  if (forceGet) return "GET";
  if (upload) return "PUT";
  if (hasData) return "POST";
  return "GET";
}

// ---------------------------------------------------------------------------------------------
function printBlocked(segment, method, command) {
  process.stderr.write(
    [
      "BLOCKED: this curl targets a clucknorris.app admin route with a mutating flag but is not a POST.",
      "AGENTS.md: 'Admin routes that ACT are POST-only' — a GET on these routes either 405s or,",
      "worse, silently runs the dry-run/read path while looking like the real action (or vice versa",
      "— the 2026-09-17 rose-buybot incident: a 'harmless' GET actually ran a full poll).",
      "Add -X POST (or --request POST / --data / --data-binary) to the command.",
      "This is judged PER curl invocation — an earlier or later POST elsewhere in the same",
      "command does not cover this one.",
      `Segment: ${segment}`,
      `Effective method: ${method}`,
      `Command: ${command}`,
      "",
    ].join("\n")
  );
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

function main() {
  const raw = readStdin();

  try {
    let command = "";
    try {
      const parsed = JSON.parse(raw);
      command = (parsed && parsed.tool_input && parsed.tool_input.command) || "";
    } catch (e) {
      command = "";
    }
    if (!command || typeof command !== "string") {
      process.exit(0);
      return;
    }

    const segments = segmentCommand(command);
    for (const seg of segments) {
      if (!/\bcurl\b/.test(seg)) continue;
      if (!ADMIN_PATH_RE.test(seg)) continue;
      if (!MUTATING_FLAG_RE.test(seg)) continue;
      const words = tokenizeWords(seg);
      const method = computeEffectiveMethod(words);
      if (method !== "POST") {
        printBlocked(seg.trim(), method, command);
        process.exit(2);
        return;
      }
    }
    process.exit(0);
  } catch (err) {
    // Never crash-allow: an internal bug in the checker above must not silently open the door on
    // exactly the class of command it exists to catch.
    try {
      const hasAdminPath = /clucknorris\.app\/api\//.test(raw);
      const hasMutatingFlag = MUTATING_FLAG_RE.test(raw);
      if (hasAdminPath && hasMutatingFlag) {
        process.stderr.write("BLOCKED: hook error, failing closed.\n");
        process.stderr.write(String((err && err.stack) || err) + "\n");
        process.exit(2);
        return;
      }
    } catch (e2) {
      // fall through to allow
    }
    process.exit(0);
  }
}

main();
