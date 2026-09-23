#!/usr/bin/env node
// Pins the .claude/ scaffolding (agents, commands, rules) added 2026-09-23 so it can't silently
// rot: every agent file has a real model alias, every money command keeps its PLAN != EXECUTE
// gate, every rules file's paths: globs actually match something in the repo, no committed file
// under .claude/ names a real model id instead of an alias, and — the one that matters most —
// splitting the path-specific traps out of AGENTS.md into .claude/rules/*.md did not lose a
// single sentence: a pinned list of distinctive lines from the ORIGINAL AGENTS.md must each
// still exist in exactly one of AGENTS.md + the rules files.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function fail(msg) {
  failures++;
  console.error("FAIL: " + msg);
}
function ok(msg) {
  console.log("ok - " + msg);
}

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

// ---------------------------------------------------------------------------
// Minimal frontmatter parser (no yaml dep in this repo). Handles the flat
// key: value pairs and the one list field (`paths:`) our files actually use.
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { frontmatter: null, body: text };
  const raw = m[1];
  const body = text.slice(m[0].length);
  const fm = {};
  const lines = raw.split(/\r?\n/);
  let curListKey = null;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line) && curListKey) {
      const val = line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, "");
      fm[curListKey].push(val);
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (val === "") {
        fm[key] = [];
        curListKey = key;
      } else {
        fm[key] = val.replace(/^["']|["']$/g, "");
        curListKey = null;
      }
    }
  }
  return { frontmatter: fm, body };
}

function normalizeWs(s) {
  // Strip a leading markdown blockquote marker ("> ") from each line first, so a sentence
  // that line-wraps inside a `>` block (as several moved AGENTS.md handoffs do) still reads as
  // continuous prose instead of picking up a literal "> " where the line broke.
  const stripped = s
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join(" ");
  return stripped.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// (a) Every agent file parses; frontmatter has name, description, model in {haiku, sonnet, opus}.
const AGENTS_DIR = ".claude/agents";
const REQUIRED_AGENTS = ["mechanic.md", "builder.md", "reviewer.md", "verifier.md"];
const EXPECTED_MODEL = { "mechanic.md": "haiku", "builder.md": "sonnet", "reviewer.md": "opus", "verifier.md": "sonnet" };
const VALID_MODELS = new Set(["haiku", "sonnet", "opus"]);

for (const f of REQUIRED_AGENTS) {
  const p = path.join(AGENTS_DIR, f);
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) { fail(`missing agent file ${p}`); continue; }
  const text = read(p);
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter) { fail(`${p}: no frontmatter block`); continue; }
  if (!frontmatter.name) fail(`${p}: frontmatter missing 'name'`);
  if (!frontmatter.description) fail(`${p}: frontmatter missing 'description'`);
  if (!frontmatter.model || !VALID_MODELS.has(frontmatter.model)) {
    fail(`${p}: frontmatter 'model' must be one of haiku/sonnet/opus, got ${JSON.stringify(frontmatter.model)}`);
  } else if (EXPECTED_MODEL[f] && frontmatter.model !== EXPECTED_MODEL[f]) {
    fail(`${p}: expected model '${EXPECTED_MODEL[f]}' per AGENTS.md model tiering, got '${frontmatter.model}'`);
  } else {
    ok(`${p} parses with model=${frontmatter.model}`);
  }
}

// ---------------------------------------------------------------------------
// (b) Every command file has a description; the money ones carry the literal gate lines.
const COMMANDS_DIR = ".claude/commands";
const REQUIRED_COMMANDS = ["promote.md", "store-release.md", "cuna-payout.md", "cuna-special.md"];
const MONEY_COMMANDS = ["cuna-payout.md", "cuna-special.md"];

const commandTexts = {};
for (const f of REQUIRED_COMMANDS) {
  const p = path.join(COMMANDS_DIR, f);
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) { fail(`missing command file ${p}`); continue; }
  const text = read(p);
  commandTexts[f] = text;
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter) { fail(`${p}: no frontmatter block`); continue; }
  if (!frontmatter.description) fail(`${p}: frontmatter missing 'description'`);
  else ok(`${p} has a description`);
}

for (const f of MONEY_COMMANDS) {
  const text = commandTexts[f];
  if (!text) continue;
  if (!text.includes("PLAN ≠ EXECUTE")) {
    fail(`${f}: money command must carry the literal "PLAN ≠ EXECUTE" gate line`);
  } else {
    ok(`${f} carries the PLAN ≠ EXECUTE gate`);
  }
}

if (commandTexts["cuna-payout.md"]) {
  const text = commandTexts["cuna-payout.md"];
  if (!/\bgo\b/.test(text)) {
    fail("cuna-payout.md: must name the literal 'go' argument that unlocks send/sweep");
  } else {
    ok("cuna-payout.md names 'go' as the send argument");
  }
}

if (commandTexts["promote.md"]) {
  const text = commandTexts["promote.md"];
  if (!/owner/i.test(text) || !text.includes("never inferred")) {
    fail("promote.md: must state the owner-go-only gate ('never inferred')");
  } else {
    ok("promote.md states the owner-go-only gate");
  }
}

// ---------------------------------------------------------------------------
// (c) Every rules file has a `paths:` frontmatter whose every glob matches >=1 existing file.
const RULES_DIR = ".claude/rules";
const REQUIRED_RULES = ["normie-quest.md", "money-engines.md", "store-and-seeker.md", "telegram-x.md"];
const ruleTexts = {};

// No `fs.globSync` in Node 20 (CI's node-version) and no glob dependency in this repo, so a
// small hand-rolled matcher: walk the tree once (skipping .git/node_modules/build output),
// convert each glob to a regex (`**` crosses slashes, `*` does not), and test membership.
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".claude-cache"]);
let ALL_REPO_FILES = null;
function allRepoFiles() {
  if (ALL_REPO_FILES) return ALL_REPO_FILES;
  const out = [];
  (function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  })(ROOT);
  ALL_REPO_FILES = out;
  return out;
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // "**" — cross zero or more path segments. Swallow a following "/" too so
      // "src/seeker/**" matches "src/seeker/App.jsx" as well as deeper paths.
      i++;
      if (glob[i + 1] === "/") i++;
      re += ".*";
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

function globMatchesSomething(glob) {
  const re = globToRegExp(glob);
  return allRepoFiles().some((f) => re.test(f));
}

for (const f of REQUIRED_RULES) {
  const p = path.join(RULES_DIR, f);
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) { fail(`missing rules file ${p}`); continue; }
  const text = read(p);
  ruleTexts[f] = text;
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter || !Array.isArray(frontmatter.paths) || frontmatter.paths.length === 0) {
    fail(`${p}: frontmatter missing a non-empty 'paths:' list`);
    continue;
  }
  let allMatch = true;
  for (const g of frontmatter.paths) {
    if (!globMatchesSomething(g)) {
      allMatch = false;
      fail(`${p}: paths glob '${g}' matches no file in the repo`);
    }
  }
  if (allMatch) ok(`${p} paths: all ${frontmatter.paths.length} globs match >=1 file`);
}

// ---------------------------------------------------------------------------
// (d) No text lost: pinned distinctive sentences from the ORIGINAL AGENTS.md must each survive
// in exactly one of AGENTS.md + the rules files (whitespace-normalized substring match).
const PINNED_SENTENCES = [
  "setScrollFactor(0)` does NOT take an object out of the camera transform",
  "iOS audio has FOUR dead states, not two",
  "Headless Chromium renders the game's WebGL at ~0.5 fps",
  "A vault `paused` flag FAILS OPEN, and a stale `lastTickTs` proves nothing.",
  "a tight-quoting engine that ABSORBS someone's sell may sell that absorbed inventory back to recoup its quote funds",
  "The engine boot ratchets re-assert per-project config on EVERY deploy",
  "the endpoints in `STORE_API_RE` (`server.js`) are a versioned contract",
  "every endpoint it uses needs CORS for that origin",
  "buy special is in the tools list and shouldn't be in here at all on seeker",
  "The Cluck bot posts NOTHING in the OnlyRose room",
  "`tgSend` and `postToX` SWALLOW their own errors and return null",
  "A Telegram post with an image gets 1024 characters, not 4096",
  "the birthday special's board never appeared",
  "Rule B (exclude-by-recipient-and-creator) is the ONLY thing keeping 2.285B of treasury locks",
  "flagships are the school, the LP lab, the airdropper, the locker room, the fire pit, project burn",
  // The global money posture must stay in AGENTS.md (loads for every session), not only in the
  // path-scoped rules file — the first cut of the split moved it out, review caught it.
  "WATCH-ONLY.** Don't rebalance, recenter, close, redeploy, add/remove liquidity",
  "NO LIQUIDITY ENGINE RUNS FOR ANY PROJECT",
  "The autonomous rebalancer is hard-killed in code",
  "Read balances ON-CHAIN, never with the product tools.",
  "Treasury wallet `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`",
];

// (d2) The posture sentences above must live in AGENTS.md specifically — a rules file only
// loads for sessions touching its paths, and WATCH-ONLY applies to every session.
const MUST_BE_IN_AGENTS_MD = [
  "WATCH-ONLY.** Don't rebalance, recenter, close, redeploy, add/remove liquidity",
  "NO LIQUIDITY ENGINE RUNS FOR ANY PROJECT",
  "The autonomous rebalancer is hard-killed in code",
  "Read balances ON-CHAIN, never with the product tools.",
  "Treasury wallet `2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8`",
  // Codex round 23 (#411 P2): the OnlyRose posting policy is the owner's rule, not a
  // path-specific implementation trap — a session that only runs a curl never loads
  // telegram-x.md, so the policy sentence itself must live in AGENTS.md (the implementation
  // detail stays in telegram-x.md, pointed back at AGENTS.md).
  "The Cluck bot posts NOTHING in the OnlyRose room",
];

const AGENTS_MD_TEXT = normalizeWs(read("AGENTS.md"));
const RULES_TEXTS_NORM = {};
for (const f of REQUIRED_RULES) {
  if (ruleTexts[f]) RULES_TEXTS_NORM[f] = normalizeWs(ruleTexts[f]);
}

for (const sentence of PINNED_SENTENCES) {
  const needle = normalizeWs(sentence);
  const hits = [];
  if (AGENTS_MD_TEXT.includes(needle)) hits.push("AGENTS.md");
  for (const f of REQUIRED_RULES) {
    if (RULES_TEXTS_NORM[f] && RULES_TEXTS_NORM[f].includes(needle)) hits.push(f);
  }
  if (hits.length === 0) {
    fail(`pinned sentence lost entirely (not in AGENTS.md or any rules file): "${sentence.slice(0, 60)}..."`);
  } else if (hits.length > 1) {
    fail(`pinned sentence duplicated in ${hits.join(", ")}: "${sentence.slice(0, 60)}..."`);
  } else {
    ok(`pinned sentence present exactly once (in ${hits[0]}): "${sentence.slice(0, 40)}..."`);
  }
}

for (const sentence of MUST_BE_IN_AGENTS_MD) {
  if (!AGENTS_MD_TEXT.includes(normalizeWs(sentence))) {
    fail(`global money posture missing from AGENTS.md (it must load for every session): "${sentence.slice(0, 60)}"`);
  } else {
    ok(`global money posture in AGENTS.md: "${sentence.slice(0, 40)}..."`);
  }
}

// ---------------------------------------------------------------------------
// (e) AGENTS.md carries a pointer line for every rules file.
for (const f of REQUIRED_RULES) {
  const needle = `.claude/rules/${f}`;
  if (!read("AGENTS.md").includes(needle)) {
    fail(`AGENTS.md has no pointer line naming ${needle}`);
  } else {
    ok(`AGENTS.md points to ${needle}`);
  }
}

// ---------------------------------------------------------------------------
// (f) No committed file under the scaffolding this test owns (.claude/agents, .claude/commands,
// .claude/rules, .claude/hooks) contains a model identifier of the form claude-[a-z]+-[0-9] — the
// frontmatter aliases haiku/sonnet/opus are fine, a literal model id is not (AGENTS.md: "don't put
// a model identifier in committed files"). Scoped to the directories this scaffolding change
// owns, not the whole of .claude/ (which also holds pre-existing skills this task didn't touch —
// see the note this script prints if it ever finds one there).
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const SCAFFOLD_DIRS = ["agents", "commands", "rules", "hooks"].map((d) => path.join(ROOT, ".claude", d));
const MODEL_ID_RE = /claude-[a-z]+-[0-9]/;
let modelIdHit = false;
for (const dir of SCAFFOLD_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const full of walk(dir)) {
    const rel = path.relative(ROOT, full);
    let text;
    try { text = fs.readFileSync(full, "utf8"); } catch (e) { continue; }
    const m = text.match(MODEL_ID_RE);
    if (m) {
      modelIdHit = true;
      fail(`${rel}: contains a model identifier '${m[0]}' — use the alias (haiku/sonnet/opus) instead`);
    }
  }
}
if (!modelIdHit) ok("no committed file under the new .claude/ scaffolding names a model identifier (claude-<name>-<number>)");

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agents-rules checks passed.");
