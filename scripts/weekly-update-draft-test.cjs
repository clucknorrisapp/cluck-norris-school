#!/usr/bin/env node
"use strict";
// scripts/weekly-update-draft.cjs — grouping, production-vs-staging labelling and PR-number
// extraction, exercised against a disposable fixture git repo built here (not this repo's own
// history, so the test never drifts when new PRs land). Also exercises the module's pure
// functions directly for the classifier and regex edge cases. No network: --no-fetch throughout.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "weekly-update-draft.cjs");
const mod = require("./weekly-update-draft.cjs");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.stack || e)); } };

console.log("\nweekly-update-draft.cjs — grouping, production/staging, PR extraction\n");

// ── pure-function unit tests (no git needed) ──────────────────────────────────────────────────
t("prNumber extracts a trailing (#NNN)", () => {
  assert.strictEqual(mod.prNumber("feat(hub): thing (#101)"), 101);
  assert.strictEqual(mod.prNumber("feat(hub): thing (#101) "), 101);
  assert.strictEqual(mod.prNumber("docs: no pr number here"), null);
  assert.strictEqual(mod.prNumber("mentions (#101) mid-sentence but not at the end"), null);
});
t("isPromotionCommit matches only a leading Promote", () => {
  assert.strictEqual(mod.isPromotionCommit("Promote develop → main: thing (#200)"), true);
  assert.strictEqual(mod.isPromotionCommit("promote develop to main (#200)"), true);
  assert.strictEqual(mod.isPromotionCommit("feat: we promote healthy habits (#5)"), false);
});
t("isMergeBackCommit matches only the known plumbing shape", () => {
  assert.strictEqual(mod.isMergeBackCommit("merge origin/main into develop after the #337 squash promotion — develop side kept, it is the superset"), true);
  assert.strictEqual(mod.isMergeBackCommit("Merge origin/main into develop after #1"), true);
  assert.strictEqual(mod.isMergeBackCommit("feat(hub): merge origin/main into develop somehow (#9)"), false);
});
t("classify groups by keyword, security taking priority over hub/school on a mixed subject", () => {
  assert.strictEqual(mod.classify("feat(hub): W1 core — project records, ledger (#1)"), "Hub");
  assert.strictEqual(mod.classify("fix(school): two lessons re-keyed in six languages (#2)"), "School");
  assert.strictEqual(mod.classify("fix(security): platform deep dive P0 batch (#3)"), "Security");
  assert.strictEqual(mod.classify("chore: tidy up build scripts (#4)"), "Operations");
  assert.strictEqual(mod.classify("OnlyRose room: buy-bot replay fix, hub guard hardening (#5)"), "Security");
});
t("stripPrSuffix removes only the trailing marker", () => {
  assert.strictEqual(mod.stripPrSuffix("feat(hub): thing (#101)"), "feat(hub): thing");
  assert.strictEqual(mod.stripPrSuffix("no marker here"), "no marker here");
});

// ── fixture git repo: a small, disposable history exercising every rule at once ───────────────
function sh(cwd, args, env) {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
}
function commit(cwd, { subject, isoDate, file = "f.txt", content = String(Math.random()) }) {
  fs.writeFileSync(path.join(cwd, file), content);
  sh(cwd, ["add", "-A"]);
  sh(cwd, ["commit", "-m", subject, "--no-gpg-sign"], {
    GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate,
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.com",
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-update-draft-test-"));
try {
  sh(tmp, ["init", "-q", "-b", "main"]);
  sh(tmp, ["config", "user.email", "t@example.com"]);
  sh(tmp, ["config", "user.name", "Test"]);

  // Before the window entirely — must never appear in the draft.
  commit(tmp, { subject: "chore: repo init", isoDate: "2026-09-01T00:00:00Z" });

  sh(tmp, ["checkout", "-b", "develop"]);
  // In-window, Hub area, will be promoted → production.
  commit(tmp, { subject: "feat(hub): thing one (#101)", isoDate: "2026-09-14T14:00:00Z" });
  // In-window, School area, will be promoted → production.
  commit(tmp, { subject: "fix(school): lesson two, re-keyed (#102)", isoDate: "2026-09-14T15:00:00Z" });
  // Outside the window (before --from) — must be excluded even though it's a real PR.
  commit(tmp, { subject: "feat(hub): thing three, too early (#103)", isoDate: "2026-09-10T09:00:00Z" });

  sh(tmp, ["checkout", "main"]);
  // A real (non-squash) merge, exactly like this repo's "Promote develop -> main" commits: it
  // carries #101 and #102 forward into main's own history under their original PR numbers.
  sh(tmp, ["merge", "develop", "--no-ff", "-m", "Promote develop → main: thing one + lesson two (#200)", "--no-gpg-sign"], {
    GIT_AUTHOR_DATE: "2026-09-15T10:00:00Z", GIT_COMMITTER_DATE: "2026-09-15T10:00:00Z",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.com",
  });

  sh(tmp, ["checkout", "develop"]);
  // In-window, Security area, never promoted → staging only.
  commit(tmp, { subject: "fix(security): hardening patch (#104)", isoDate: "2026-09-16T08:00:00Z" });
  // In-window, no keyword hit → falls to Operations.
  commit(tmp, { subject: "chore: tidy up build scripts (#106)", isoDate: "2026-09-16T09:00:00Z" });
  // A merge-back plumbing commit — no PR number, must never appear at all.
  commit(tmp, { subject: "merge origin/main into develop after the #200 squash promotion — develop side kept", isoDate: "2026-09-16T09:30:00Z" });
  // Outside the window (after --to) — must be excluded.
  commit(tmp, { subject: "feat(hub): thing five, too late (#107)", isoDate: "2026-09-25T00:00:00Z" });

  const run = () => execFileSync("node", [SCRIPT, "--repo", tmp, "--develop-ref", "develop", "--main-ref", "main", "--no-fetch", "--from", "2026-09-14", "--to", "2026-09-18"], { encoding: "utf8" });

  const out = run();

  t("extracts every in-window PR number, and only those", () => {
    for (const n of [101, 102, 104, 106]) assert.ok(out.includes(`#${n}`), `missing #${n}`);
    for (const n of [103, 107]) assert.ok(!out.includes(`#${n}`), `#${n} (outside window) leaked in`);
  });
  t("groups #101 under Hub, #102 under School, #104 under Security, #106 under Operations", () => {
    const hub = out.slice(out.indexOf("### Hub"), out.indexOf("### School"));
    const school = out.slice(out.indexOf("### School"), out.indexOf("### Security"));
    const security = out.slice(out.indexOf("### Security"), out.indexOf("### Operations"));
    const ops = out.slice(out.indexOf("### Operations"), out.indexOf("## Promotions"));
    assert.ok(hub.includes("#101"), "hub section");
    assert.ok(school.includes("#102"), "school section");
    assert.ok(security.includes("#104"), "security section");
    assert.ok(ops.includes("#106"), "operations section");
  });
  t("promoted PRs are labelled production, unpromoted ones staging only", () => {
    const line101 = out.split("\n").find((l) => l.includes("#101"));
    const line102 = out.split("\n").find((l) => l.includes("#102"));
    const line104 = out.split("\n").find((l) => l.includes("#104"));
    assert.ok(/production \(main\)/.test(line101), line101);
    assert.ok(/production \(main\)/.test(line102), line102);
    assert.ok(/staging only \(develop\)/.test(line104), line104);
  });
  t("the promotion (#200) is listed once under Promotions, and never as its own feature bullet", () => {
    const promoSection = out.slice(out.indexOf("## Promotions"), out.indexOf("## The three bullets"));
    assert.ok(promoSection.includes("#200"), "promotion missing from Promotions section");
    const featureSection = out.slice(out.indexOf("## Shipped"), out.indexOf("## Promotions"));
    assert.ok(!featureSection.includes("#200"), "#200 leaked into the feature list");
    const occurrences = (out.match(/#200\b/g) || []).length;
    assert.strictEqual(occurrences, 1, `#200 should appear exactly once, saw ${occurrences}`);
  });
  t("the merge-back plumbing commit never appears", () => {
    assert.ok(!out.includes("squash promotion"), "merge-back commit text leaked in");
  });
  t("the shipped-bullet skeleton is pre-filled from the list, and the other two are left to fill", () => {
    const bulletSection = out.slice(out.indexOf("1. **What shipped.**"), out.indexOf("## Refresh checklist"));
    assert.ok(/Hub \(1\)/.test(bulletSection), "hub count in bullet");
    assert.ok(bulletSection.includes("[to be filled]"), "hard/next left blank");
  });
  t("--out writes the same text to a file", () => {
    const outFile = path.join(tmp, "draft.md");
    execFileSync("node", [SCRIPT, "--repo", tmp, "--develop-ref", "develop", "--main-ref", "main", "--no-fetch", "--from", "2026-09-14", "--to", "2026-09-18", "--out", outFile], { encoding: "utf8" });
    const written = fs.readFileSync(outFile, "utf8");
    assert.ok(written.includes("#101") && written.includes("#104"));
  });
  t("missing --from/--to exits non-zero with usage, and makes no network call (implicitly, via --no-fetch not being required here)", () => {
    let threw = false;
    try { execFileSync("node", [SCRIPT, "--repo", tmp, "--no-fetch"], { encoding: "utf8" }); }
    catch (e) { threw = true; assert.strictEqual(e.status, 1); }
    assert.ok(threw, "should have exited non-zero");
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
