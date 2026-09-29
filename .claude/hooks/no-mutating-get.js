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
// 2. curl's actual EFFECTIVE method (see `parseRequests`) — curl honours the LAST `-X`
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
// 2. curl's actual effective HTTP method, per request, for one invocation's words.
//
// ONE parser (`parseRequests`) does what curl's own argument loop does, so the request boundary
// (`--next` / `-:`), every option's value consumption, and the method signals can never disagree
// with each other (Codex round 32 P2 x2 — clustered short options and long options were each
// handled by separate, partial code paths, and the `--next` splitter ran BEFORE value consumption).
//
// Short options (`-abc`): curl reads one letter at a time. A value-less letter (`s`, `S`, `v`, `G`,
// `I`, `#`, …) is skipped; the FIRST letter that takes a value consumes the rest of the word as its
// value, or the next word if the cluster ends there — the value is never re-scanned as more
// letters (`-o/dev/null`, `-XPOST`, `-H'x: y'`, `-d@file`). `-:` is curl's short spelling of
// `--next` and it works INSIDE a cluster (`-s:` is `-s --next`); everything after it in the
// cluster already belongs to the NEXT request.
//
// Long options (`--opt value` or `--opt=value`): a value-taking long option consumes its value
// so it is never mistaken for a URL, a method or another flag; `--request`/`--data*`/`--json`/
// `--form*`/`--upload-file`/`--get`/`--head`/`--url-query` carry method meaning. Curl also accepts
// an unambiguous prefix of a long option (`--data-r`), so names are resolved against the known
// set before dispatch. Anything after a bare `--` is positional, never an option.
//
// Method precedence, per request: the LAST `-X`/`--request` wins; else `-I`/`--head` → HEAD; else
// `-G`/`--get` → GET; else `-T`/`--upload-file` → PUT; else any data/form flag → POST; else GET.
// A `--next` resets every one of these ("reset all options … to the default values").
const METHOD_VALUE_FLAGS = { X: "method", d: "data", T: "upload", F: "data" };
const NO_VALUE_METHOD_FLAGS = { G: "get", I: "head" };
// Value-taking short flags that do NOT affect the method — every short option curl documents as
// taking an argument, consumed opaquely so a `d`/`X`/… inside the value is never mistaken for a flag.
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

// Every long option that takes a value but carries no method/data meaning of its own (curl(1)'s
// long-option list; boolean options and the ones handled for their own semantics — `--request`,
// `--upload-file`, `--url-query`, the data/form family — are excluded).
const LONG_VALUE_FLAGS = new Set([
  "--abstract-unix-socket", "--alt-svc", "--aws-sigv4", "--cacert", "--capath", "--cert",
  "--cert-type", "--ciphers", "--config", "--connect-timeout", "--connect-to", "--continue-at",
  "--cookie", "--cookie-jar", "--create-file-mode", "--crlfile", "--curves", "--delegation",
  "--dns-interface", "--dns-ipv4-addr", "--dns-ipv6-addr", "--dns-servers", "--doh-url",
  "--dump-header", "--ech", "--egd-file", "--engine", "--etag-compare", "--etag-save",
  "--expect100-timeout", "--ftp-account", "--ftp-alternative-to-user", "--ftp-method",
  "--ftp-port", "--ftp-ssl-ccc-mode", "--happy-eyeballs-timeout-ms", "--haproxy-clientip",
  "--header", "--hostpubmd5", "--hostpubsha256", "--hsts", "--interface", "--ip-tos",
  "--keepalive-time", "--key", "--key-type", "--krb", "--libcurl", "--limit-rate",
  "--local-port", "--login-options", "--mail-auth", "--mail-from", "--mail-rcpt",
  "--max-filesize", "--max-redirs", "--max-time", "--netrc-file", "--noproxy",
  "--oauth2-bearer", "--output", "--output-dir", "--parallel-max", "--pass", "--pinnedpubkey",
  "--proto", "--proto-default", "--proto-redir", "--proxy", "--proxy-cacert", "--proxy-capath",
  "--proxy-cert", "--proxy-cert-type", "--proxy-ciphers", "--proxy-crlfile", "--proxy-header",
  "--proxy-key", "--proxy-key-type", "--proxy-pass", "--proxy-pinnedpubkey",
  "--proxy-service-name", "--proxy-tls13-ciphers", "--proxy-tlsauthtype",
  "--proxy-tlspassword", "--proxy-tlsuser", "--proxy-user", "--proxy1.0", "--pubkey",
  "--random-file", "--range", "--rate", "--referer", "--request-target", "--resolve", "--retry",
  "--retry-delay", "--retry-max-time", "--sasl-authzid", "--service-name", "--socks4",
  "--socks4a", "--socks5", "--socks5-gssapi-service", "--socks5-hostname", "--speed-limit",
  "--speed-time", "--ssl-sessions", "--stderr", "--tftp-blksize", "--time-cond",
  "--tls-max", "--tls13-ciphers", "--tlsauthtype", "--tlspassword", "--tlsuser", "--trace",
  "--trace-ascii", "--unix-socket", "--upload-flags", "--url", "--user", "--user-agent",
  "--variable", "--vlan-priority", "--write-out",
]);
// Long options this parser gives its own meaning to (plus `--next`) — with the two sets above,
// the vocabulary a prefix like `--data-r` is resolved against.
const LONG_SPECIAL = ["--request", "--get", "--head", "--next", "--upload-file", "--url-query"];
const ALL_LONG = new Set([...LONG_SPECIAL, ...DATA_LONG_FLAGS, ...LONG_VALUE_FLAGS]);

// curl accepts an unambiguous prefix of a long option. Exact names win; a prefix that matches more
// than one known option is ambiguous (curl refuses it, so nothing is sent) and is left as-is.
function resolveLong(name) {
  if (ALL_LONG.has(name)) return name;
  let found = null;
  for (const cand of ALL_LONG) {
    if (cand.startsWith(name)) {
      if (found) return name;
      found = cand;
    }
  }
  return found || name;
}

function newRequest() {
  return {
    words: [], explicit: null, forceGet: false, hasUrlQueryData: false, head: false,
    upload: false, hasData: false, dataValues: [], method: "GET",
  };
}

function finishRequest(r) {
  if (r.explicit) r.method = r.explicit;
  else if (r.head) r.method = "HEAD";
  else if (r.forceGet) r.method = "GET";
  else if (r.upload) r.method = "PUT";
  else if (r.hasData) r.method = "POST";
  else r.method = "GET";
  return r;
}

// Returns one entry per request in the invocation (`--next` / `-:` start a new one, with every
// option reset): `{ words, method, forceGet, hasUrlQueryData, dataValues }`. `words` are the words
// that belong to that request (options, their values and URLs), for the caller's text checks.
// `dataValues` are `{ kind, v }` entries — `v` is the raw value handed to a data/form flag or
// `--url-query`, `kind` is `urlquery` / `urlencode` (`--data-urlencode`) / `raw` (every other data
// flag) — with `-G`/`--get` curl moves them onto the URL as query parameters (Codex round 32 P2),
// so the caller rebuilds the query from them (`effectiveQuery`) using each kind's own value form. `forceGet`/`hasUrlQueryData` are returned separately from `method`: `-G` and
// `--url-query` modify the URL whatever the final method resolves to (`-I -G -d draw=1` is HEAD,
// but the data still lands on the URL).
function parseRequests(words) {
  const requests = [];
  let cur = newRequest();
  let noMoreFlags = false;
  let idx = 0;

  // Consume the next word as an option's value (kept with the request it belongs to).
  function take() {
    if (idx + 1 >= words.length) return undefined;
    idx++;
    cur.words.push(words[idx]);
    return words[idx];
  }
  function endRequest() {
    requests.push(finishRequest(cur));
    cur = newRequest();
  }

  for (; idx < words.length; idx++) {
    const w = words[idx];
    cur.words.push(w);
    if (noMoreFlags) continue;
    if (w === "--") {
      noMoreFlags = true;
      continue;
    }
    if (w.length < 2 || w[0] !== "-") continue; // a URL or other positional value

    if (w[1] === "-") {
      // Long option, `--opt value` or `--opt=value`.
      let name = w;
      let inline;
      const eq = w.indexOf("=");
      if (eq > 2) {
        name = w.slice(0, eq);
        inline = w.slice(eq + 1);
      }
      name = resolveLong(name);
      const value = () => (inline !== undefined ? inline : take());
      if (name === "--next") {
        endRequest();
      } else if (name === "--request") {
        const v = value();
        if (v) cur.explicit = v.toUpperCase();
      } else if (name === "--get") {
        cur.forceGet = true;
      } else if (name === "--head") {
        cur.head = true;
      } else if (name === "--upload-file") {
        cur.upload = true;
        value();
      } else if (name === "--url-query") {
        cur.hasUrlQueryData = true;
        const v = value();
        if (v !== undefined) cur.dataValues.push({ kind: "urlquery", v });
      } else if (DATA_LONG_FLAGS.has(name)) {
        cur.hasData = true;
        const v = value();
        if (v !== undefined) {
          cur.dataValues.push({ kind: name === "--data-urlencode" ? "urlencode" : "raw", v });
        }
      } else if (LONG_VALUE_FLAGS.has(name)) {
        value(); // opaque — consumed so it is never re-scanned as a flag
      }
      // else: a boolean long option (or one we do not know) — nothing to consume
      continue;
    }

    // Short option or a cluster of them (`-sSXPOST`, `-Gd`, `-o/dev/null`, `-s:`).
    const body = w.slice(1);
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      const remainder = body.slice(j + 1);
      if (c === ":") {
        endRequest(); // `-:` is `--next`; the rest of the cluster belongs to the next request
        continue;
      }
      if (c in METHOD_VALUE_FLAGS) {
        const kind = METHOD_VALUE_FLAGS[c];
        const v = remainder.length > 0 ? remainder : take();
        if (kind === "method") {
          if (v) cur.explicit = v.toUpperCase();
        } else if (kind === "data") {
          cur.hasData = true;
          if (v !== undefined) cur.dataValues.push({ kind: "raw", v });
        } else {
          cur.upload = true;
        }
        break; // the rest of this word was the flag's inline value, not more flags
      }
      if (c in NO_VALUE_METHOD_FLAGS) {
        // G/I take NO value — keep scanning so `-Gd draw=1` still sees the `d` (Codex round 32).
        if (NO_VALUE_METHOD_FLAGS[c] === "get") cur.forceGet = true;
        else cur.head = true;
        continue;
      }
      if (OPAQUE_VALUE_FLAGS.has(c)) {
        if (remainder.length === 0) take();
        break;
      }
      // else: a boolean short flag (s, S, v, #, …) — keep scanning the cluster.
    }
  }
  endRequest();
  return requests;
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

// curl's URL-encoding for the content part of `--data-urlencode` / `--url-query` (unreserved
// characters kept, everything else %XX).
function curlEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// The value forms of `--data-urlencode` (and of `--url-query`, which is "identical … with one
// extension", the `+` form) — curl's own logic, verified against a real curl on a loopback server:
//   `+content`        --url-query ONLY: the rest is appended AS-IS, unencoded (`+draw=1` sends
//                     `draw=1` — Codex round 34 P2: the raw `+` made the old check look at `?+draw=1`).
//                     `--data-urlencode` has no `+` form: `+draw=1` is name `+draw`, sent as `+draw=1`.
//   `=content`        the leading `=` is dropped, content URL-encoded, no name (`=draw=1` → `draw%3D1`).
//   `name=content`    name kept AS-IS, content URL-encoded (`=` is looked for first, so
//                     `email=a@b.com` is NOT a file reference).
//   `name@file`/`@file`  (no `=` anywhere) contents come from a FILE this hook cannot read → opaque.
//   `content`         neither `=` nor `@`: the whole value URL-encoded.
// Every other data flag (`-d`, `--data`, `--data-raw`, …) is appended raw with `-G`; a leading `@`
// makes curl read a file, and the round-32 fail-closed rule (any `@`) is kept for those.
function effectiveQuery(dataValues) {
  const parts = [];
  let opaque = null;
  for (const { kind, v } of dataValues) {
    if (kind === "raw") {
      if (/@/.test(v)) opaque = opaque || v;
      else parts.push(v);
      continue;
    }
    if (kind === "urlquery" && v[0] === "+") {
      parts.push(v.slice(1));
      continue;
    }
    let sepIdx = v.indexOf("=");
    if (sepIdx === -1) sepIdx = v.indexOf("@");
    if (sepIdx === -1) {
      parts.push(curlEncode(v));
      continue;
    }
    if (v[sepIdx] === "@") {
      opaque = opaque || v;
      continue;
    }
    const name = v.slice(0, sepIdx);
    const enc = curlEncode(v.slice(sepIdx + 1));
    parts.push(name === "" ? enc : name + "=" + enc);
  }
  return { parts, opaque };
}

function printBlocked(segment, method, command, opaque) {
  process.stderr.write(
    [
      "BLOCKED: this curl targets a clucknorris.app admin route with a mutating flag but is not a POST.",
      ...(opaque !== undefined && opaque !== null
        ? [
            `Why: a query value (${JSON.stringify(opaque)}) is read from a FILE (@file / name@file) that this hook`,
            "cannot see, so it may carry a mutating flag (draw=1, run=1, …). Failing closed — inline the",
            "value, or send the request as -X POST.",
          ]
        : []),
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
      const requests = parseRequests(words);
      for (const eff of requests) {
        const partText = eff.words.join(" ");
        if (!ADMIN_PATH_RE.test(partText)) continue;
        const dataValues = eff.dataValues;
        const method = eff.method;
        let mutating = MUTATING_FLAG_RE.test(partText);
        let opaqueRef = null;
        // Codex round 32 "second lens" P3: rebuild and test the query whenever `-G`/`--get` OR
        // `--url-query` is present, regardless of the FINAL resolved method — `-G` moves data
        // onto the URL even when an explicit `-X HEAD`/`-I` is also present, and `--url-query`
        // always modifies the URL regardless of method.
        if (!mutating && (eff.forceGet || eff.hasUrlQueryData)) {
          // Fail-closed: a value curl reads from a file (`@file`, or `name@file`) has unknown
          // contents at review time — never assume it's safe just because ITS TEXT doesn't
          // contain a mutating flag.
          // Codex round 34 P2: the query is judged AFTER curl's own value-form transforms
          // (`effectiveQuery`) — `--url-query '+draw=1'` is sent as `draw=1`.
          const q = effectiveQuery(dataValues);
          if (q.opaque !== null) {
            mutating = true;
            opaqueRef = q.opaque;
          } else {
            const urlQuery = extractAdminUrlQuery(partText);
            const combined = "?" + [urlQuery, ...q.parts].filter(Boolean).join("&");
            mutating = MUTATING_FLAG_RE.test(combined);
          }
        }
        if (!mutating) continue;
        if (method !== "POST") {
          printBlocked(partText.trim(), method, command, opaqueRef);
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
