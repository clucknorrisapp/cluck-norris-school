"use strict";
// Canonical JSON — the ONLY serialisation a program version's hash may be taken over (every
// object's keys sorted, BigInts as strings). Extracted out of lib/hub/project.js so the EXACT
// same function runs in Node (project.js, hashed with node:crypto) and in the browser
// (public/hub-verify.bundle.js — Y1, hashed with crypto.subtle) — one function, not two
// hand-typed copies that could drift (CLAUDE.md, "Verification: check every form, not one
// form"). No `require` of anything, so it is safe to bundle for a browser with no polyfills.
function canonicalJson(v) {
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

// What lib/hub/project.js's verifyVersionHash hashes, minus the actual hashing — `effectiveTo`
// is bookkeeping added after a version is superseded and `commitment` is bookkeeping added after
// on-chain publish (Addendum B5); neither was ever part of what versionRecord() hashed (see
// project.js's own comment on verifyVersionHash). Returns { hash, canon }: `hash` is the value to
// compare a computed digest against (or null when the version carries none — CUNA's pre-Hub
// programme, HUB_VERIFY.md §d), `canon` is the exact string a sha256 must be taken over. The
// caller supplies its own hasher — Node's node:crypto (sync) or the browser's crypto.subtle
// (async) — and compares the result to `hash` itself; this module never hashes anything.
function versionHashInput(v) {
  const { hash, effectiveTo, commitment, ...body } = v || {};
  return { hash: typeof hash === "string" ? hash : null, canon: canonicalJson({ ...body, effectiveTo: null }) };
}

module.exports = { canonicalJson, versionHashInput };
