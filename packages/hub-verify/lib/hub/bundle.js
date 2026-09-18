"use strict";
// lib/hub/bundle.js — AA2 (docs/COLOSSEUM_ROADMAP.md §11): the offline evidence bundle. One JSON
// document a holder can save that carries everything E1/Y1 (lib/hub/reproduce.js, hub-verify.html)
// need to reproduce a whole batch's receipts later, without three separate `curl`s and without
// trusting a live server to still be answering honestly at the moment they check.
//
// Pure and browser-safe — no `require` of anything Node-only, no `Buffer`, no `crypto`/
// `crypto.subtle` — so the SAME file ships in the server (required by server.js) and in the
// browser bundle (hub-verify-src/entry.js), one implementation, not two that could drift
// (CLAUDE.md, "Verification: check every form, not one form"). That is also why this file carries
// its own tiny SHA-256 (below) rather than reusing lib/hub/project.js's `sha256` (node:crypto,
// sync) or the browser's `crypto.subtle` (async, see hub-verify-src/entry.js `sha256Hex`): those
// two already disagree on sync vs async, and a bundle's own integrity check should not depend on
// which runtime is doing the checking, or need an `await` just to answer "does this file match
// the hash printed inside it". `canonicalJson` (./canonical) is the same one the program-version
// hash is taken over, so both hashes are byte-identical in shape even though this one is computed
// by a different routine.
//
// `buildBundle` composes ONLY from what its caller already built from the PUBLIC view functions
// (lib/hub/reproduce.js buildBatchInputs, lib/hub/public.js findReceipt/programVersionView) — this
// module never reads a store or a private field itself, so a bundle can never carry more than the
// public routes it mirrors already do.
//
// `hash` covers the bundle's PAYLOAD only — kind/bundleVersion/project/program/batch/receipts/
// schemas — never `hash` itself and never `generatedAt`, which is stamped on AFTER hashing. That
// is deliberate, the same reasoning lib/hub/canonical.js gives for stripping `effectiveTo` before
// hashing a program version: two downloads of the SAME settled batch, at two different times,
// must hash identically, or "save this file, it never changes" would be false the moment a reader
// re-downloaded it a day later.

const { canonicalJson } = require("./canonical");

const BUNDLE_KIND = "clkn-hub-evidence-bundle";
const BUNDLE_VERSION = 1;

// ── a small, dependency-free SHA-256 (browser + Node byte-identical) ───────────────────────────
// Standard FIPS 180-4 SHA-256 over the UTF-8 bytes of a string. No dependency on Node's `crypto`
// or the browser's `crypto.subtle` — see the file header for why a third implementation exists at
// all. Verified byte-for-byte against `node:crypto` on empty/short/long/multibyte/emoji inputs and
// inputs that land on every padding boundary (scripts/hub-bundle-test.cjs).
function utf8Bytes(str) {
  const out = [];
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    let c = s.codePointAt(i);
    if (c > 0xffff) i++; // this codepoint consumed a UTF-16 surrogate pair
    if (c < 0x80) { out.push(c); }
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c < 0x10000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256Hex(str) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const msg = utf8Bytes(str);
  // The message length in bits, split into the high/low 32 bits of a 64-bit big-endian field
  // (FIPS 180-4 §5.1.1). A JSON bundle is nowhere near 2^32 bytes, but the split costs nothing.
  const bitLenLow = (msg.length * 8) >>> 0;
  const bitLenHigh = Math.floor(msg.length / 0x20000000); // bytes*8 / 2^32 === bytes / 2^29
  const padded = msg.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  for (let i = 3; i >= 0; i--) padded.push((bitLenHigh >>> (i * 8)) & 0xff);
  for (let i = 3; i >= 0; i--) padded.push((bitLenLow >>> (i * 8)) & 0xff);

  const w = new Array(64);
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      const o = chunkStart + i * 4;
      w[i] = ((padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(toHex).join("");
}

// The first `$schema` found on a receipt (either the receipt envelope itself, or its nested
// `.receipt`) — whatever identifier the ROUTE that built these receipts stamped onto them. Every
// receipt in one bundle comes from the same batch/route, so the first one found stands for all.
function firstSchemaOf(receiptsArr) {
  for (const r of receiptsArr || []) {
    if (r && typeof r.$schema === "string") return r.$schema;
    if (r && r.receipt && typeof r.receipt.$schema === "string") return r.receipt.$schema;
  }
  return null;
}

// { projectView: {id, label, ...}, programVersion: (pub.programVersionView(...) shape) | null,
//   batchInputs: { batchId, decimals, wallets } (the /inputs route's own body, minus `ok`) | null,
//   receipts: [ (pub.findReceipt(...) shape), ... ],
//   settled: boolean (defaults to receipts.length > 0 when omitted), note: string | null }
// Every field the caller passes in already came from a public route's own view function — this
// function only reshapes and hashes; it never decides what is public.
// `settled`/`note` are genuine members of the bundle's own payload, not a wrapper the route adds
// afterward — they are DERIVED, deterministic facts about this batch (same as everything else
// here), so including them in the hash costs nothing and avoids a real bug: a route that instead
// merged `{ ...bundle, settled, note }` onto the RESPONSE would have those two extra keys present
// when a reader re-hashes a SAVED copy of that response, and `bundleHash`/`verifyBundleHash` (which
// only ever strip `hash`/`generatedAt`, nothing else — see their own comments) would then disagree
// with the hash the server itself computed before `settled`/`note` existed on the object.
function buildBundle({ projectView, programVersion, batchInputs, receipts, settled, note } = {}) {
  const project = projectView ? { id: projectView.id != null ? String(projectView.id) : null, label: projectView.label != null ? String(projectView.label) : null, dryRun: projectView.dryRun === true } : null;
  let program = null;
  if (programVersion) { const { $schema, ...rest } = programVersion; program = rest; }
  const bi = batchInputs || {};
  const batch = {
    id: bi.batchId != null ? String(bi.batchId) : null,
    decimals: Number.isInteger(bi.decimals) ? bi.decimals : null,
    inputs: bi.wallets || {},
  };
  const receiptsOut = Array.isArray(receipts) ? receipts : [];
  const schemas = {
    receipt: firstSchemaOf(receiptsOut),
    // No route serves a dedicated schema for the /inputs wire shape yet (docs/HUB_VERIFY.md §a) —
    // reported honestly as null rather than pointing at a schema that doesn't describe this body.
    batchInputs: typeof bi.$schema === "string" ? bi.$schema : null,
    programVersion: (programVersion && typeof programVersion.$schema === "string") ? programVersion.$schema : null,
  };
  const settledOut = typeof settled === "boolean" ? settled : receiptsOut.length > 0;
  // Normalized through one JSON round trip BEFORE hashing: a view function upstream (e.g.
  // hubPublic.findReceipt's `program.mint`/`prizeMint` for a "lock-to-earn" program, which has
  // neither field) can legally hand back an `undefined` value on a key. `JSON.stringify` — what
  // every consumer of this bundle (an HTTP response, a saved file) actually serializes it with —
  // drops that key entirely; `canonicalJson` does not (it walks every own key regardless of
  // value), so hashing the raw object would bake in keys that vanish the moment this bundle is
  // actually served or saved, and every later `bundleHash`/`verifyBundleHash` on the real bytes
  // would disagree with the hash computed here. Round-tripping first makes the hash input exactly
  // the bytes a reader will ever actually see.
  const body = JSON.parse(JSON.stringify({
    kind: BUNDLE_KIND, bundleVersion: BUNDLE_VERSION, project, program, batch, receipts: receiptsOut, schemas,
    settled: settledOut, note: note != null ? String(note) : null,
  }));
  const hash = sha256Hex(canonicalJson(body));
  return { ...body, generatedAt: Date.now(), hash };
}

// Recompute a bundle's own hash exactly the way buildBundle did — everything except `hash` and
// `generatedAt` itself.
function bundleHash(bundle) {
  const { hash, generatedAt, ...rest } = bundle || {};
  return sha256Hex(canonicalJson(rest));
}

// Whether a (possibly altered, possibly truncated) bundle file still matches its own declared
// hash. `ok:false` here means exactly one thing: the bytes changed after the bundle was built —
// never a judgement on whether the program itself was fair (hub-verify.html says both, plainly).
function verifyBundleHash(bundle) {
  if (!bundle || typeof bundle.hash !== "string" || !bundle.hash) {
    return { ok: false, computed: null, declared: null, reason: "this file carries no hash to check" };
  }
  const computed = bundleHash(bundle);
  return { ok: computed === bundle.hash, computed, declared: bundle.hash };
}

// Splits an evidence bundle back into the three shapes the EXISTING per-receipt reproduce path
// (lib/hub/reproduce.js `reproduce`, driven from hub-verify.html's offline-files flow) already
// consumes — so that flow runs unchanged, once per receipt, against this bundle's one shared
// batch-inputs/program-version instead of three separately-dropped files.
function splitBundle(bundle) {
  const b = bundle || {};
  const batch = b.batch || {};
  return {
    receipts: Array.isArray(b.receipts) ? b.receipts : [],
    batchInputs: { batchId: batch.id != null ? batch.id : null, decimals: batch.decimals != null ? batch.decimals : null, wallets: batch.inputs || {} },
    programVersion: b.program || null,
  };
}

module.exports = { BUNDLE_KIND, BUNDLE_VERSION, buildBundle, bundleHash, verifyBundleHash, splitBundle, sha256Hex };
