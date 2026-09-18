#!/usr/bin/env node
"use strict";
// scripts/weekly-update-draft.cjs — Colosseum roadmap §10 Z1: "weekly updates from the record,
// not from memory." Builds the W10 "shipped this week" list and the three-bullet skeleton
// straight from `git log` on `develop` and `main`, so each Sunday's refresh is a run, not a
// rewrite. Read-only: no writes except an optional --out file, no network beyond one `git fetch`.
//
//   node scripts/weekly-update-draft.cjs --from YYYY-MM-DD --to YYYY-MM-DD [options]
//
// Options:
//   --out <file>          Write the draft to this file instead of stdout.
//   --no-fetch            Skip the `git fetch` — use whatever refs are already local. The ONLY
//                          network call this script ever makes is that one fetch; pass this flag
//                          to run fully offline (e.g. inside a test's disposable repo).
//   --develop-ref <ref>   Default "origin/develop". A local branch name works too (tests use one).
//   --main-ref <ref>      Default "origin/main".
//   --repo <path>         Run git against this working directory instead of the current one.
//
// What "from the record" means here, precisely:
//   1. Read every commit reachable from --develop-ref and --main-ref whose COMMIT date (not
//      author date — a rebase or amend can separate the two, and the commit date is when it
//      actually landed) falls inside [--from 00:00 UTC, --to 23:59:59 UTC].
//   2. Keep only commits that are actually squash-merged PRs: a subject ending in "(#NNN)" —
//      the shape every PR in this repo lands with (CLAUDE.md "Shipping cadence"). A commit
//      without that suffix (a plain doc commit, a merge-back after a promotion) is not a PR and
//      is dropped from the list, though "merge-back" commits are also filtered explicitly.
//   3. A commit whose subject starts with "Promote " is the develop → main RELEASE MECHANISM,
//      not a feature — every promotion inside the window is listed once, separately, never
//      folded into a feature bullet and never double-counted against the PR number it carries.
//   4. Every remaining PR is grouped into one of four areas by a keyword match against its own
//      subject: Hub, School, Security, or Operations (the fallback bucket). This is a mechanical
//      heuristic, not editorial judgement — the generated draft is reconciled by hand afterward,
//      same as any other draft.
//   5. A PR is labelled "production" if a commit ending in that PR's own "(#NNN)" appears
//      ANYWHERE in the FULL history of --main-ref (unrestricted by date — a promotion can land
//      after the reporting window closes, and what matters is today's status, not the window's).
//      Everything else is "staging only". This works because promotions in this repo are real
//      merges of develop into main (not squashes), so every originally-squashed feature commit
//      stays reachable from main under its own PR number once promoted — confirmed against this
//      repo's own history before relying on it (see the commit message / handback report).
//
// Nothing here invents a claim: every line traces to a commit this script actually read.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function usage() {
  return [
    "usage: node scripts/weekly-update-draft.cjs --from YYYY-MM-DD --to YYYY-MM-DD [options]",
    "",
    "  --out <file>          write the draft to this file instead of stdout",
    "  --no-fetch            skip `git fetch` (the only network call this script makes)",
    "  --develop-ref <ref>   default origin/develop",
    "  --main-ref <ref>      default origin/main",
    "  --repo <path>         run git against this directory instead of the current one",
  ].join("\n");
}

function parseArgs(argv) {
  const a = { fetch: true, developRef: "origin/develop", mainRef: "origin/main", repo: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--from") a.from = argv[++i];
    else if (t === "--to") a.to = argv[++i];
    else if (t === "--out") a.out = argv[++i];
    else if (t === "--no-fetch") a.fetch = false;
    else if (t === "--develop-ref") a.developRef = argv[++i];
    else if (t === "--main-ref") a.mainRef = argv[++i];
    else if (t === "--repo") a.repo = argv[++i];
    else if (t === "--help" || t === "-h") a.help = true;
    else throw new Error(`unrecognised argument: ${t}`);
  }
  return a;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function tryFetch(repo) {
  try {
    git(repo, ["fetch", "origin", "--quiet"]);
  } catch (e) {
    const msg = String((e && e.message) || e).split("\n")[0];
    process.stderr.write(`[weekly-update-draft] git fetch failed, continuing with local refs: ${msg}\n`);
  }
}

// One commit per line: sha \x1f commit-date-ISO \x1f subject. \x1f (unit separator) can't appear
// in a subject line typed by a human, so a plain split is safe; sliced by index anyway, in case.
function fullLog(repo, ref) {
  let out;
  try {
    out = git(repo, ["log", ref, "--date=iso-strict", "--pretty=format:%H%x1f%cI%x1f%s"]);
  } catch (e) {
    throw new Error(`git log failed for ref "${ref}": ${String((e && e.message) || e).split("\n")[0]}`);
  }
  if (!out.trim()) return [];
  return out.split("\n").map((line) => {
    const i1 = line.indexOf("\x1f");
    const i2 = line.indexOf("\x1f", i1 + 1);
    return { sha: line.slice(0, i1), date: line.slice(i1 + 1, i2), subject: line.slice(i2 + 1) };
  });
}

function inWindow(commit, fromDate, toDate) {
  const d = new Date(commit.date);
  return d >= fromDate && d <= toDate;
}

const PR_NUMBER_RE = /\(#(\d+)\)\s*$/;
function prNumber(subject) {
  const m = PR_NUMBER_RE.exec(String(subject || "").trimEnd());
  return m ? Number(m[1]) : null;
}
function isPromotionCommit(subject) {
  return /^promote\b/i.test(String(subject || "").trim());
}
function isMergeBackCommit(subject) {
  // "merge origin/main into develop after the #NNN squash promotion — develop side kept" —
  // repo plumbing, not a deliverable; never carries a "(#NNN)" of its own so prNumber() already
  // drops it, but named explicitly here so the intent reads plainly.
  return /^merge origin\/main into develop\b/i.test(String(subject || "").trim());
}

// Mechanical grouping — a keyword hit on the PR's own subject, checked in this priority order so
// a subject that touches several areas (a big batch commit) lands somewhere defensible rather
// than being split. Reconciled by hand afterward, same as any other draft (CLAUDE.md "tell the
// truth about what you did" applies to the generated file, not to this heuristic).
const AREA_PATTERNS = [
  ["Security", /\b(security|hardening|codex|deep[- ]dive|p[0-3]\b|onlyrose|only ?rose|buy-?bot|lockdown|exploit|guard)\b/i],
  ["Hub", /\bhub\b|lock[- ]to[- ]earn|\bpayout(s)?\b|buy-?comp\b|\bairdrop(s|per)?\b|\breceipt(s)?\b|readiness|reproduc|engine dashboard|liquidity-engine|\bjvp\b/i],
  ["School", /\bschool\b|\blesson(s)?\b|\bi18n\b|\blanguage(s)?\b|\bquiz\b|\blp lab\b|curriculum|translat/i],
];
function classify(subject) {
  const s = String(subject || "");
  for (const [area, re] of AREA_PATTERNS) if (re.test(s)) return area;
  return "Operations";
}

function stripPrSuffix(subject) {
  return String(subject || "").replace(PR_NUMBER_RE, "").trim();
}

function collectItems({ repo, developRef, mainRef, fromDate, toDate }) {
  const developAll = fullLog(repo, developRef);
  const mainAll = fullLog(repo, mainRef);

  // "on production" is a CURRENT status question, so it is checked against the FULL history of
  // main, not the date window — a promotion after the window still makes an in-window feature
  // production by the time anyone reads this draft.
  const mainPrNumbers = new Set();
  for (const c of mainAll) {
    const n = prNumber(c.subject);
    if (n != null) mainPrNumbers.add(n);
  }

  const developWindow = developAll.filter((c) => inWindow(c, fromDate, toDate));
  const mainWindow = mainAll.filter((c) => inWindow(c, fromDate, toDate));

  const itemsByPr = new Map(); // prNumber -> { prNumber, subject, date, area }
  const promotionsByPr = new Map(); // prNumber -> { prNumber, subject, date }

  for (const c of [...developWindow, ...mainWindow]) {
    if (isMergeBackCommit(c.subject)) continue;
    const n = prNumber(c.subject);
    if (n == null) continue; // not a squash-merged PR — nothing to cite
    if (isPromotionCommit(c.subject)) {
      if (!promotionsByPr.has(n) || new Date(c.date) < new Date(promotionsByPr.get(n).date)) {
        promotionsByPr.set(n, { prNumber: n, subject: stripPrSuffix(c.subject), date: c.date });
      }
      continue;
    }
    const existing = itemsByPr.get(n);
    if (!existing || new Date(c.date) < new Date(existing.date)) {
      itemsByPr.set(n, {
        prNumber: n,
        subject: stripPrSuffix(c.subject),
        date: c.date,
        area: classify(c.subject),
        production: mainPrNumbers.has(n),
      });
    }
  }

  const items = [...itemsByPr.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  const promotions = [...promotionsByPr.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { items, promotions };
}

const AREA_ORDER = ["Hub", "School", "Security", "Operations"];

function renderShippedSection(items) {
  const byArea = new Map(AREA_ORDER.map((a) => [a, []]));
  for (const it of items) byArea.get(it.area).push(it);
  const lines = [];
  for (const area of AREA_ORDER) {
    const rows = byArea.get(area);
    if (!rows.length) continue;
    lines.push(`### ${area}`, "");
    for (const it of rows) {
      const status = it.production ? "production (main)" : "staging only (develop)";
      lines.push(`- PR #${it.prNumber} — ${it.subject} [${status}]`);
    }
    lines.push("");
  }
  if (!items.length) lines.push("(no squash-merged PRs found in this window)", "");
  return lines;
}

function renderPromotionsSection(promotions) {
  const lines = ["## Promotions (develop → main) in this window", ""];
  if (!promotions.length) {
    lines.push("(none in this window — check `git log origin/main` before assuming nothing promoted)", "");
    return lines;
  }
  lines.push("Each promotion below is the release mechanism for every item above that it made", "\"production\" — listed once here, not repeated per feature.", "");
  for (const p of promotions) {
    const day = p.date.slice(0, 10);
    lines.push(`- PR #${p.prNumber} (${day}) — ${p.subject}`);
  }
  lines.push("");
  return lines;
}

function renderShippedBullet(items) {
  const byArea = new Map(AREA_ORDER.map((a) => [a, []]));
  for (const it of items) byArea.get(it.area).push(it);
  const parts = [];
  for (const area of AREA_ORDER) {
    const rows = byArea.get(area);
    if (!rows.length) continue;
    const named = rows.slice(0, 3).map((it) => {
      const full = `#${it.prNumber} ${it.subject}`;
      return full.length > 90 ? full.slice(0, 89) + "…" : full;
    });
    const more = rows.length > 3 ? `, +${rows.length - 3} more` : "";
    parts.push(`${area} (${rows.length}): ${named.join("; ")}${more}`);
  }
  return parts.length ? parts.join(" — ") : "(nothing merged in this window)";
}

function render({ from, to, items, promotions }) {
  const lines = [];
  lines.push(`# Colosseum weekly update draft — ${from} → ${to}`, "");
  lines.push(`Generated by \`scripts/weekly-update-draft.cjs\` from \`git log\` on the develop and`, `main refs. Nothing below is invented — every line traces to a commit; reconcile by hand`, `before publishing (CLAUDE.md "tell the truth about what you did").`, "");
  lines.push("## Shipped this week (paste-ready, with links)", "");
  lines.push(...renderShippedSection(items));
  lines.push(...renderPromotionsSection(promotions));
  lines.push("## The three bullets (skeleton)", "");
  lines.push(`1. **What shipped.** ${renderShippedBullet(items)}`, "");
  lines.push("2. **What was hard.** [to be filled]", "");
  lines.push("3. **What's next.** [to be filled]", "");
  lines.push("## Refresh checklist (the day before recording)", "");
  lines.push(
    "- [ ] Re-run this script with `--to` set to today — anything merged since this draft belongs in the list.",
    "- [ ] `git log origin/develop` — confirm every PR above (and any new one) actually merged.",
    "- [ ] `git log origin/main` — confirm which of the above is actually promoted; never assume production status without a fresh run (CLAUDE.md \"Branching\": promotion is the owner's explicit go, never automatic, never inferred).",
    "- [ ] Pick the demo URL based on what's promoted at recording time — never show a develop/staging URL as if it were the live product.",
    "- [ ] Re-read `docs/ARENA_POSTS.md`'s status table before posting anything from it — it can be stale by the time this draft is read.",
    ""
  );
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  if (!args.from || !args.to) { console.error(usage()); process.exitCode = 1; return; }
  if (!DATE_RE.test(args.from) || !DATE_RE.test(args.to)) {
    console.error("--from and --to must be YYYY-MM-DD"); process.exitCode = 1; return;
  }
  const fromDate = new Date(`${args.from}T00:00:00Z`);
  const toDate = new Date(`${args.to}T23:59:59Z`);
  if (!(fromDate <= toDate)) { console.error("--from must not be after --to"); process.exitCode = 1; return; }

  const repo = path.resolve(args.repo);
  if (args.fetch) tryFetch(repo);

  const { items, promotions } = collectItems({
    repo, developRef: args.developRef, mainRef: args.mainRef, fromDate, toDate,
  });

  const text = render({ from: args.from, to: args.to, items, promotions });
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), text.endsWith("\n") ? text : text + "\n");
    console.error(`[weekly-update-draft] wrote ${args.out}`);
  } else {
    console.log(text);
  }
}

if (require.main === module) main();

module.exports = { classify, prNumber, isPromotionCommit, isMergeBackCommit, collectItems, render, stripPrSuffix };
