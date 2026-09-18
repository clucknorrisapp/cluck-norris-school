#!/usr/bin/env node
"use strict";
// DD1 (docs/COLOSSEUM_ROADMAP.md §14): builds packages/hub-verify — the SAME verifier
// (scripts/reproduce-receipt.cjs + the pure libs it and the browser bundle share) packaged as a
// standalone `npx @clkn/hub-verify <receipt-url | bundle.json>` command. This script never
// hand-types a second copy of any of it; it COPIES the exact repo files byte-for-byte into the
// package directory (renaming only where a file's repo-internal name would be confusing as a
// public `bin` — scripts/reproduce-receipt.cjs becomes bin/hub-verify.cjs) and writes a
// MANIFEST.json recording each source file's sha256, so drift between the repo lib and the
// packaged copy is a diffable, CI-caught fact rather than something a reviewer has to notice by
// eye (CLAUDE.md, "Verification: check every form, not one form").
//
// Every mapped destination preserves the SAME relative path shape the source file already uses
// (bin/ sits next to lib/ exactly where scripts/ sits next to lib/ at the repo root; lib/hub/*.js
// sits next to lib/*.js exactly like the repo's own lib/hub/ next to lib/) — so not one `require`
// string needs rewriting today. `assertRequiresResolve` below is the safety net for the day that
// stops being true: it parses every `require(...)` call in each copied JS file and fails the
// build loudly if a relative require would resolve outside this package's own copied tree, or a
// bare require names anything other than a small allowlist of Node builtins — rather than
// silently shipping a package whose bin throws the moment someone actually runs it.
//
// Usage: node scripts/build-hub-verify-package.cjs [outDir]
//   outDir defaults to packages/hub-verify (repo-relative). scripts/hub-verify-package-test.cjs
//   passes a throwaway temp dir to prove a fresh build is byte-identical to the committed copy.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "packages", "hub-verify");

// Every file this package needs, and nothing else — see the header for why the destination
// shape was chosen. `kind` only affects the require-scan below (schemas and docs carry none).
const FILE_MAP = [
  { src: "lib/hub/reproduce.js", dest: "lib/hub/reproduce.js", kind: "js" },
  { src: "lib/hub/schema-validate.js", dest: "lib/hub/schema-validate.js", kind: "js" },
  { src: "lib/hub/canonical.js", dest: "lib/hub/canonical.js", kind: "js" },
  { src: "lib/hub/bundle.js", dest: "lib/hub/bundle.js", kind: "js" },
  { src: "lib/sol-addr-re.js", dest: "lib/sol-addr-re.js", kind: "js" },
  { src: "lib/buycomp-payout.js", dest: "lib/buycomp-payout.js", kind: "js" },
  { src: "lib/hub/schema/batch.schema.json", dest: "schema/batch.schema.json", kind: "json" },
  { src: "lib/hub/schema/program-version.schema.json", dest: "schema/program-version.schema.json", kind: "json" },
  { src: "lib/hub/schema/project-public.schema.json", dest: "schema/project-public.schema.json", kind: "json" },
  { src: "lib/hub/schema/receipt.schema.json", dest: "schema/receipt.schema.json", kind: "json" },
  // The CLI itself — same file scripts/reproduce-receipt.cjs already ships and is tested by
  // scripts/reproduce-receipt-test.cjs; the package's `bin` is not a rewritten copy of its logic,
  // it IS that file, so "the package CLI must produce the same output format" is true by
  // construction rather than by two authors staying in sync.
  { src: "scripts/reproduce-receipt.cjs", dest: "bin/hub-verify.cjs", kind: "js" },
];

// Node builtins this copied code actually uses (bin/hub-verify.cjs: fs, path; the global `fetch`
// is not a `require` at all). Anything else on a bare `require(...)` fails the build — that is
// exactly the guard against a future edit quietly reaching for an npm dependency or a
// server.js/kv/network module in code that is supposed to stay dependency-free and offline-safe.
const ALLOWED_BUILTINS = new Set(["fs", "path"]);

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function collectRequires(content) {
  const out = [];
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
}

// Fails loudly if any `require(...)` in `content` (copied from `srcRel`, landing at `destRel`)
// would not resolve inside the package once copied — either a relative require pointing outside
// the set of files this build actually copies, or a bare require naming anything outside
// ALLOWED_BUILTINS. This is what lets the "no rewriting needed" claim in the file header stay
// true rather than assumed.
function assertRequiresResolve(content, srcRel, destRel, destRoot, copiedDestSet) {
  for (const req of collectRequires(content)) {
    if (req.startsWith(".")) {
      const resolvedDest = path.normalize(path.join(path.dirname(destRel), req));
      const candidates = [resolvedDest, resolvedDest + ".js", resolvedDest + ".json", path.join(resolvedDest, "index.js")];
      if (!candidates.some((c) => copiedDestSet.has(c.split(path.sep).join("/")))) {
        throw new Error(`build-hub-verify-package: ${srcRel} requires "${req}" which does not resolve to any file this build copies (would land outside packages/hub-verify once built) — add it to FILE_MAP or fix the source.`);
      }
    } else if (!ALLOWED_BUILTINS.has(req)) {
      throw new Error(`build-hub-verify-package: ${srcRel} requires "${req}", which is not in ALLOWED_BUILTINS — packages/hub-verify must ship with zero runtime dependencies and no reach into server.js/kv/network modules.`);
    }
  }
}

function build(outDir) {
  const out = path.resolve(outDir || DEFAULT_OUT);
  fs.rmSync(path.join(out, "lib"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "schema"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "bin"), { recursive: true, force: true });

  const destSet = new Set(FILE_MAP.map((f) => f.dest));
  const manifestFiles = [];
  for (const { src, dest, kind } of FILE_MAP) {
    const srcPath = path.join(ROOT, src);
    const content = fs.readFileSync(srcPath, "utf8");
    if (kind === "js") assertRequiresResolve(content, src, dest, out, destSet);
    const destPath = path.join(out, dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    manifestFiles.push({ source: src, dest, sha256: sha256(Buffer.from(content, "utf8")) });
  }
  manifestFiles.sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0));
  // No timestamp, no absolute path — this file must be byte-identical whether it is built once
  // at commit time or a hundred times in CI's own drift check (scripts/hub-verify-package-test.cjs).
  const manifest = { generator: "scripts/build-hub-verify-package.cjs", package: "@clkn/hub-verify", files: manifestFiles };
  fs.writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { outDir: out, manifest };
}

if (require.main === module) {
  const outArg = process.argv[2];
  const { outDir, manifest } = build(outArg);
  console.log(`built packages/hub-verify at ${outDir} (${manifest.files.length} files)`);
}

module.exports = { build, FILE_MAP, ALLOWED_BUILTINS, sha256, collectRequires };
