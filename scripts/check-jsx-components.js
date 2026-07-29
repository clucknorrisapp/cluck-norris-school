#!/usr/bin/env node
// Undefined-component guard for the React app.
//
// WHY THIS EXISTS: `<CalcErrorBoundary>` was referenced in twelve places in LPLab.jsx and never
// defined. That is legal JavaScript — a free variable is only a ReferenceError at RUNTIME — so
// `npm run build` succeeded, CI was green (it only `node --check`s the BACKEND), and the broken
// bundle auto-deployed to production, where every LP Lab lesson hosting a calculator rendered as
// a blank page. Nothing in the pipeline could have caught it.
//
// This is deliberately a dumb regex scan, not a parser: it needs zero dependencies and only has
// to catch the one shape that actually bit us — a capitalised JSX tag with no definition and no
// import in the same file. Lowercase tags are host elements and are ignored; dotted tags
// (<Foo.Bar/>) are checked on their root identifier.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
// React built-ins and anything the runtime provides rather than the module.
const GLOBALS = new Set(["Fragment", "React", "Suspense", "StrictMode", "Profiler"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.log("✓ jsx component guard — no src/ directory, nothing to check");
  process.exit(0);
}

let failures = 0;
let filesChecked = 0;
let tagsChecked = 0;

for (const file of walk(SRC)) {
  const s = fs.readFileSync(file, "utf8");
  filesChecked++;

  // Used: any capitalised JSX opening tag. Take the root of a dotted path.
  const used = new Set(
    [...s.matchAll(/<([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*[\s/>]/g)].map((m) => m[1])
  );
  // Defined in-file: function / class / const / let / var declarations.
  const defined = new Set(
    [...s.matchAll(/(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1])
  );
  // Imported: every capitalised identifier appearing in an import clause.
  const imported = new Set();
  for (const m of s.matchAll(/import\s+([\s\S]+?)\s+from\s+["']/g)) {
    for (const id of m[1].matchAll(/[A-Z][A-Za-z0-9_]*/g)) imported.add(id[0]);
  }

  const missing = [...used].filter(
    (n) => !defined.has(n) && !imported.has(n) && !GLOBALS.has(n)
  );
  tagsChecked += used.size;

  if (missing.length) {
    failures++;
    const rel = path.relative(ROOT, file);
    for (const name of missing.sort()) {
      // Report the first use site so the failure is directly clickable.
      const idx = s.split("\n").findIndex((l) => new RegExp(`<${name}[\\s/>]`).test(l));
      console.error(
        `✗ ${rel}:${idx + 1} — <${name}> is used but never defined or imported in this file.`
      );
    }
  }
}

if (failures) {
  console.error(
    `\n${failures} file(s) reference undefined components. This builds fine and throws at runtime — ` +
      `it would blank the page in production. Define or import the component before merging.`
  );
  process.exit(1);
}

console.log(
  `✓ jsx component guard — ${tagsChecked} component references across ${filesChecked} files all defined or imported`
);
