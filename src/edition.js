// Which EDITION of the school this bundle is, decided at BUILD time.
//
// FULL (the website + the Solana Seeker dApp Store wrapper, which loads the live site): every
// feature. STORE (Google Play, later iOS): an education-only build with no wallet, no holder
// gate, no payments, no on-chain transactions and no token promotion — the excluded flows are
// COMPILED OUT, not hidden. Vite replaces `import.meta.env.VITE_STORE_EDITION` with a string
// literal, so `STORE` folds to a constant and every `STORE ? … : …` / `!STORE && …` branch is
// dead-code-eliminated; a component only reachable from a removed branch is tree-shaken with it.
// The store build verifies that by grepping its own output (scripts/store-edition-test.cjs).
//
// The store bundle runs from a webview origin (capacitor://localhost, https://localhost), where a
// relative "/api/…" would never reach the backend. Every call site goes through api() so the seam
// is visible, but the prefix is applied at BUILD time: scripts/build-store-edition.mjs rewrites
// every `"/api/` literal in the bundle to `"https://clucknorris.app/api/` (store-edition.json →
// apiBase) and its verifier fails the build if any relative one survives. Nothing runtime, so the
// live site is byte-for-byte unaffected.
export const EDITION = import.meta.env.VITE_STORE_EDITION || "";
export const STORE = import.meta.env.VITE_STORE_EDITION === "google" || import.meta.env.VITE_STORE_EDITION === "ios";
export const api = (path) => path;
// Pages the store bundle carries as files beside index.html. Anything not listed here is not in
// the bundle, so the concierge only ever links to what exists.
export const STORE_PAGES = { "/wallet-checkup": "./wallet-checkup.html", "/listing-checkup": "./listing-checkup.html" };
