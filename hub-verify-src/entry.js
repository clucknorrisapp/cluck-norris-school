// hub-verify-src/entry.js — the ESM entry point vite.hubverify.config.js bundles into
// public/hub-verify.bundle.js (Y1, docs/COLOSSEUM_ROADMAP.md §9). It re-exports the SAME pure
// functions scripts/reproduce-receipt.cjs runs on a reader's own machine (lib/hub/reproduce.js,
// lib/hub/schema-validate.js), so a reader who does not run Node gets the identical verdict in a
// browser tab instead — see that script's header and docs/HUB_VERIFY.md for what each one checks.
//
// No Node builtins anywhere in this chain: lib/hub/reproduce.js -> lib/buycomp-payout.js ->
// lib/sol-addr-re.js (a bare regex, not the Buffer/crypto-using lib/solana-addr.js) and
// lib/hub/schema-validate.js / lib/hub/canonical.js have no requires at all. lib/hub/bundle.js
// (AA2's evidence bundle — not to be confused with THIS file's own build output,
// public/hub-verify.bundle.js) is the same: it carries its own pure SHA-256 rather than reaching
// for node:crypto or crypto.subtle. `scripts/
// hub-verify-bundle-test.cjs` pins this by importing the built bundle in Node and diffing its
// output against the CJS libs on the same fixtures — if a future change reintroduces an `fs`,
// `path` or `crypto` import into that chain, the browser build still succeeds (esbuild does not
// know it can't run in a browser) but the PAGE will throw at runtime, so that test also greps the
// source files for a top-level Node-only require as a second, independent check.
import { reproduce, reproduceBuyCompRow, buildBatchInputs } from '../lib/hub/reproduce.js';
import { validate } from '../lib/hub/schema-validate.js';
import { canonicalJson, versionHashInput } from '../lib/hub/canonical.js';
// AA2 (docs/COLOSSEUM_ROADMAP.md §11): the evidence-bundle helpers — same reasoning as the three
// imports above, one implementation shared by the server (lib/hub/bundle.js, required directly)
// and this browser bundle, never two copies that could drift.
import { splitBundle, verifyBundleHash, BUNDLE_KIND } from '../lib/hub/bundle.js';

// The browser half of the hash adapter: lib/hub/project.js's verifyVersionHash hashes
// versionHashInput()'s canonical string with node:crypto (sync); crypto.subtle is async, so this
// necessarily is too. Same canonical string, same comparison, same reason lib/hub/canonical.js's
// header gives for splitting the two apart.
async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Recompute a program version's own hash in the browser and say whether it matches what the
// version itself declares — the exact walkthrough HUB_VERIFY.md §d has a reader paste into a
// terminal, run here instead so the page can do it. `hash: null` (no `hash` field on the version
// — CUNA's pre-Hub programme carries none) is reported as its own status, never as a mismatch.
async function verifyVersionHash(version) {
  const { hash, canon } = versionHashInput(version);
  if (hash == null) return { ok: false, hash: null, computed: null, reason: 'this program version carries no hash to check' };
  const computed = await sha256Hex(canon);
  return { ok: computed === hash, hash, computed, reason: null };
}

export { reproduce, reproduceBuyCompRow, buildBatchInputs, validate, canonicalJson, sha256Hex, verifyVersionHash, splitBundle, verifyBundleHash, BUNDLE_KIND };
