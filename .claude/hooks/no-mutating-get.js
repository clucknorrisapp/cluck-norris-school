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
// `-sSXPOST` or `-sSd` are handled by scanning the cluster left to right: a boolean flag with no
// value (`s`, `S`, `v`, …) is skipped over, but the FIRST value-taking flag encountered consumes
// the rest of the word (or the next word, if nothing follows in the cluster) as ITS value and the
// scan of that cluster stops there — the consumed value is never re-scanned as more flag letters.
// Anything after a bare `--` is a positional argument, never a flag.
//
// Codex round 32 P2: `-o/dev/null` used to be misparsed — the loop kept scanning past `o` (which
// wasn't in the value-flag set at all) and hit the `d` inside `/dev/null`, wrongly setting
// hasData. Every short flag curl documents as value-taking is now recognised and consumes its
// value; only `X`/`d`/`T`/`F` (and the value-less `G`/`I`) affect the computed method — the rest
// (`o`/`H`/`A`/`u`/`b`/`c`/`e`/`m`/`w`/`U`/`x`/`y`/`z`/`K`/`E`, …) are consumed opaquely and never
// set hasData.
const METHOD_VALUE_FLAGS = { X: "method", d: "data", T: "upload", F: "data" };
const NO_VALUE_METHOD_FLAGS = { G: "get", I: "head" };
// Value-taking short flags that do NOT affect the method — just consume their value so a `d`/`X`/…
// inside that value is never mistaken for another flag. Not exhaustive of every curl short option,
// but covers every one curl documents as taking an argument.
// Codex round 32 "second lens" P3: -D/-r/-Y/-Q/-C/-t/-P also take a value in real curl (dump-header
// file, range, speed-limit, quote command, resume-from offset, telnet option, ftp-port) and were
// missing — `curl -D/dev/stderr ".../admin?key=k&draw=1"` used to fall through unrecognised.
const OPAQUE_VALUE_FLAGS = new Set([
  "o", "H", "A", "u", "b", "c", "e", "m", "w", "U", "x", "y", "z", "K", "E",
  "D", "r", "Y", "Q", "C", "t", "P",
]);
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

// Codex round 33 P2: every OTHER curl long option that takes a value must still consume it — the
// old code fell through to `continue; // unrecognized long flag — ignore` for anything not on the
// small explicit list above, which left the VALUE word to be re-scanned on the next loop
// iteration as if it were its own flag: `curl --header '-XPOST' <admin-url>?draw=1` read the
// header's VALUE as an explicit `-X POST`, while real curl sends that request as a GET (curl
// never even looks at `--header`'s value as a flag). None of these carry any method/data meaning
// of their own — enumerated from curl(1)'s long-option list, excluding the ones already handled
// above for their OWN semantics (`--request`, `--get`, `--head`, `--upload-file`, `--url-query`,
// the `--data*`/`--json`/`--form*` family) and excluding boolean (no-argument) long options.
const LONG_VALUE_FLAGS = new Set([
  "--abstract-unix-socket", "--alt-svc", "--aws-sigv4", "--cacert", "--capath", "--cert",
  "--cert-type", "--ciphers", "--config", "--connect-timeout", "--connect-to", "--continue-at",
  "--cookie", "--cookie-jar", "--crlfile", "--delegation", "--dns-interface", "--dns-ipv4-addr",
  "--dns-ipv6-addr", "--dns-servers", "--doh-url", "--dump-header", "--egd-file", "--engine",
  "--etag-compare", "--etag-save", "--expect100-timeout", "--ftp-account",
  "--ftp-alternative-to-user", "--ftp-method", "--ftp-port", "--happy-eyeballs-timeout-ms",
  "--header", "--hostpubmd5", "--hostpubsha256", "--hsts", "--interface", "--keepalive-time",
  "--key", "--key-type", "--krb", "--libcurl", "--limit-rate", "--local-port", "--login-options",
  "--mail-auth", "--mail-from", "--mail-rcpt", "--max-filesize", "--max-redirs", "--max-time",
  "--netrc-file", "--noproxy", "--oauth2-bearer", "--output", "--output-dir", "--parallel-max",
  "--pass", "--proto", "--proto-default", "--proto-redir", "--proxy", "--proxy-header",
  "--proxy-pass", "--proxy-service-name", "--proxy-user", "--proxy1.0", "--pubkey",
  "--random-file", "--range", "--rate", "--referer", "--request-target", "--resolve", "--retry",
  "--retry-delay", "--retry-max-time", "--sasl-authzid", "--service-name", "--socks4",
  "--socks4a", "--socks5", "--socks5-gssapi-service", "--speed-limit", "--speed-time", "--stderr",
  "--tftp-blksize", "--time-cond", "--tlsauthtype", "--tlspassword", "--tlsuser", "--trace",
  "--trace-ascii", "--unix-socket", "--url", "--user", "--user-agent", "--variable", "--write-out",
]);

// Computes the effective HTTP method for one invocation's words, returning
// `{ method, forceGet, hasUrlQueryData }`. When `dataValuesOut` (an array) is passed, every raw
// value handed to a data/form flag (`-d`, `-F`, `--data*`, `--json`, `--form*`) or to
// `--url-query`/`--url-query=` is pushed onto it — Codex round 32 P2: with `-G`/`--get`, curl
// moves data-flag values onto the URL as query parameters instead of sending a body, so the
// caller needs the raw values to reconstruct the query a `-G` request actually sends (see
// `extractAdminUrlQuery` / main()). `--url-query` (round 32 "second lens" P3) always appends its
// value to the URL's query regardless of method — it's not a data flag and doesn't imply POST —
// so `forceGet`/`hasUrlQueryData` are both returned separately from `method`: the caller must
// rebuild and test the query whenever EITHER is true, not only when the final resolved method
// happens to be GET (round 32 "second lens" P3: `-I -G -d draw=1`/`-X HEAD -G -d draw=1` resolve
// to HEAD, not GET, but `-G` still moves the data onto the URL and must still be caught).
function computeEffectiveMethod(words, dataValuesOut) {
  let explicit = null;
  let forceGet = false;
  let hasUrlQueryData = false;
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
      if (w === "--url-query") {
        hasUrlQueryData = true;
        if (words[idx + 1] !== undefined) {
          if (dataValuesOut) dataValuesOut.push(words[idx + 1]);
          idx++;
        }
        continue;
      }
      if (w.startsWith("--url-query=")) {
        hasUrlQueryData = true;
        if (dataValuesOut) dataValuesOut.push(w.slice("--url-query=".length));
        continue;
      }
      if (DATA_LONG_FLAGS.has(w)) {
        hasData = true;
        if (words[idx + 1] !== undefined) {
          if (dataValuesOut) dataValuesOut.push(words[idx + 1]);
          idx++;
        }
        continue;
      }
      {
        const pfx = DATA_LONG_PREFIXES.find((p) => w.startsWith(p));
        if (pfx) {
          hasData = true;
          if (dataValuesOut) dataValuesOut.push(w.slice(pfx.length));
          continue;
        }
      }
      if (LONG_VALUE_FLAGS.has(w)) {
        // Opaque — consumes its value (inline `--opt=value`, handled below, or the next word) but
        // carries no method/data meaning of its own.
        if (words[idx + 1] !== undefined) idx++;
        continue;
      }
      {
        const eq = w.indexOf("=");
        if (eq > 2 && LONG_VALUE_FLAGS.has(w.slice(0, eq))) {
          continue;   // `--opt=value` inline form — nothing left to consume
        }
      }
      continue; // truly unrecognized long flag (or a boolean one) — ignore
    }

    // Short flag or a cluster of them (e.g. -sSXPOST, -sSd, -G, -I, -o/dev/null).
    const body = w.slice(1);
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      const remainder = body.slice(j + 1);
      if (c in METHOD_VALUE_FLAGS) {
        const kind = METHOD_VALUE_FLAGS[c];
        if (kind === "method") {
          if (remainder.length > 0) {
            explicit = remainder.toUpperCase();
          } else if (words[idx + 1] !== undefined) {
            explicit = words[idx + 1].toUpperCase();
            idx++;
          }
        } else if (kind === "data") {
          hasData = true;
          if (remainder.length > 0) {
            if (dataValuesOut) dataValuesOut.push(remainder);
          } else if (words[idx + 1] !== undefined) {
            if (dataValuesOut) dataValuesOut.push(words[idx + 1]);
            idx++;
          }
        } else if (kind === "upload") {
          upload = true;
          if (remainder.length === 0 && words[idx + 1] !== undefined) idx++;
        }
        break; // the rest of this word (if any) was the flag's inline value, not more flags
      }
      if (c in NO_VALUE_METHOD_FLAGS) {
        // Codex round 32 "second lens" P2: G/I take NO value, so `-Gd draw=1` (or `-sGd draw=1`)
        // must keep scanning the cluster past the `G` — the old `break` here stopped right after
        // it and never saw the `d` two characters later, so the data value it carries (and thus
        // the query -G moves it into) was silently dropped.
        if (NO_VALUE_METHOD_FLAGS[c] === "get") forceGet = true;
        else head = true;
        continue;
      }
      if (OPAQUE_VALUE_FLAGS.has(c)) {
        // Takes a value but doesn't affect the method — just consume it (inline remainder, or the
        // next word if the cluster ends here) so nothing inside that value is mistaken for a flag.
        if (remainder.length === 0 && words[idx + 1] !== undefined) idx++;
        break;
      }
      // else: a boolean flag with no value (s, S, v, #, …) — keep scanning the cluster.
    }
  }

  let method;
  if (explicit) method = explicit;
  else if (head) method = "HEAD";
  else if (forceGet) method = "GET";
  else if (upload) method = "PUT";
  else if (hasData) method = "POST";
  else method = "GET";
  return { method, forceGet, hasUrlQueryData };
}

// ---------------------------------------------------------------------------------------------
// `curl url1 -X POST … --next url2 …` (or `--next-based multiple requests) resets the method for
// every request after a `--next` — curl documents it as "reset all options … to the default
// values", so a `-X POST` before `--next` does NOT cover the request(s) after it. Codex round 32
// P2: `curl -X POST <safe-url> --next GET /api/…/admin?run=1` used to be judged as ONE POST
// invocation because the whole word list shared a single computed method. Split on `--next` and
// judge each resulting request independently, exactly like separate curl invocations.
// Codex round 33 P2: `-:` is curl's own short spelling of `--next` (curl(1): "-:, --next") — a
// STANDALONE short option (curl does not combine it into a cluster with other short flags), so
// `curl -X POST <safe-url> -: <admin-url>?draw=1` split just as cleanly as the `--next` form but
// was never recognised as a boundary at all.
function splitOnNext(words) {
  const parts = [[]];
  for (const w of words) {
    if (w === "--next" || w === "-:") {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1].push(w);
  }
  return parts;
}

// Codex round 32 P2: `-G`/`--get` makes curl send its `-d`/`--data*` values as URL query
// parameters instead of a body — `curl -G --data-urlencode draw=1 …/admin` is a GET to
// `…/admin?draw=1`, but MUTATING_FLAG_RE tested only the raw command text, where `draw=1` never
// has a `?`/`&` right before it (it's a separate `--data-urlencode` argument, not URL text) — so
// it was invisible to the check. When the effective method is GET, reconstruct the query a real
// `-G` request would send — the admin URL's own query string plus every data-flag value, joined
// with `&` — and test the mutating-flag pattern against THAT.
function extractAdminUrlQuery(text) {
  const m = /clucknorris\.app\/api\/[^\s'"]*/.exec(text);
  if (!m) return "";
  const qIdx = m[0].indexOf("?");
  return qIdx === -1 ? "" : m[0].slice(qIdx + 1);
}

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
      const words = tokenizeWords(seg);
      // `--next` starts a brand-new request within the SAME curl invocation, with its own reset
      // method — judge each one independently rather than computing one method for the whole seg.
      const parts = splitOnNext(words);
      for (const part of parts) {
        const partText = part.join(" ");
        if (!ADMIN_PATH_RE.test(partText)) continue;
        const dataValues = [];
        const eff = computeEffectiveMethod(part, dataValues);
        const method = eff.method;
        let mutating = MUTATING_FLAG_RE.test(partText);
        // Codex round 32 "second lens" P3: rebuild and test the query whenever `-G`/`--get` OR
        // `--url-query` is present, regardless of the FINAL resolved method — `-G` moves data
        // onto the URL even when an explicit `-X HEAD`/`-I` is also present, and `--url-query`
        // always modifies the URL regardless of method.
        if (!mutating && (eff.forceGet || eff.hasUrlQueryData)) {
          // Fail-closed: a value curl reads from a file (`@file`, or `name@file`) has unknown
          // contents at review time — never assume it's safe just because ITS TEXT doesn't
          // contain a mutating flag.
          const opaqueFileRef = dataValues.some((v) => /@/.test(v));
          if (opaqueFileRef) {
            mutating = true;
          } else {
            const urlQuery = extractAdminUrlQuery(partText);
            const combined = "?" + [urlQuery, dataValues.join("&")].filter(Boolean).join("&");
            mutating = MUTATING_FLAG_RE.test(combined);
          }
        }
        if (!mutating) continue;
        if (method !== "POST") {
          printBlocked(partText.trim(), method, command);
          process.exit(2);
          return;
        }
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
