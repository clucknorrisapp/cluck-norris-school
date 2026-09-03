// Regression test: lp-scanner.html moved the operator key from a persistent localStorage key
// to per-tab sessionStorage AND scrubs ?key= out of the URL immediately, which (before this
// fix) left NO way to reopen the tool in a new tab/window/after a restart — no working entry
// point, nothing left in the URL, and the read of sessionStorage was itself unguarded so a
// browser blocking site data would throw out of the inline script instead of showing the "no
// key" banner (audit Batch B / moneyReview). In practice that pushes operators toward pasting
// the master PREMIUM_ACCESS_KEY into a notes app or a saved link — worse than the localStorage
// behaviour it replaced.
//
// This test extracts the real key-handling script block from lp-scanner.html and runs it
// against a mocked DOM/sessionStorage (no network, no real key), exercising the actual
// lpSaveKeyAndReload() function end-to-end: typing a key into the on-page input and clicking
// Unlock must persist it to sessionStorage for the next load, and a sessionStorage that throws
// must not crash the script.
//
// Run: node scripts/test-lp-scanner-key-entry.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "lp-scanner.html"), "utf8");

const startMarker = "// Operator-only since 2026-07-04";
const startIdx = SRC.indexOf(startMarker);
if (startIdx < 0) { console.error("FAIL: could not find the lp-scanner key-handling block"); process.exit(1); }
const scriptEnd = SRC.indexOf("</script>", startIdx);
const block = SRC.slice(startIdx, scriptEnd);

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
  else console.log(`ok - ${label}`);
}

function makeFakeDom(inputValue) {
  const elements = {};
  const bodyChildren = [];
  const input = { id: "lpKeyInput", value: inputValue, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } };
  elements["lpKeyInput"] = input;
  let reloaded = false;
  return {
    input,
    reloadedFlag: () => reloaded,
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); if (c.id) elements[c.id] = c; }, addEventListener() {}, set textContent(v) { this._text = v; } }),
      addEventListener: () => {},
      body: { prepend: (el) => bodyChildren.push(el) },
    },
    location: { reload: () => { reloaded = true; }, search: "", pathname: "/lp-scanner.html", hash: "" },
  };
}

// ── 1. The sessionStorage READ must be guarded (try/catch), not just the write ─────────────
check(
  "the initial sessionStorage.getItem('lpKey') read is wrapped in try/catch",
  /try\s*\{\s*LPKEY\s*=\s*LPKEY\s*\|\|\s*sessionStorage\.getItem\('lpKey'\)/.test(block)
);

// ── 2. Run the block with a sessionStorage that THROWS on every call (site-data-blocked
// browser) and confirm it does not throw out of the script.
{
  const throwingSessionStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const fakeUrlParams = function () { return { get: () => null, delete() {}, toString: () => "" }; };
  const win = makeFakeDom("");
  let threw = false;
  try {
    const fn = new Function(
      "sessionStorage", "URLSearchParams", "location", "history", "document",
      `${block}\nreturn typeof LPKEY;`
    );
    fn(throwingSessionStorage, fakeUrlParams, win.location, { replaceState() {} }, win.document);
  } catch (e) { threw = true; }
  check("a throwing sessionStorage does not crash the key-handling script", !threw);
}

// ── 3. lpSaveKeyAndReload() actually persists a typed key and reloads ─────────────────────
{
  const store = {};
  const workingSessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  const fakeUrlParams = function () { return { get: () => null, delete() {}, toString: () => "" }; };
  const win = makeFakeDom("MY-TEST-KEY");
  const fn = new Function(
    "sessionStorage", "URLSearchParams", "location", "history", "document",
    `${block}\nreturn lpSaveKeyAndReload;`
  );
  const lpSaveKeyAndReload = fn(workingSessionStorage, fakeUrlParams, win.location, { replaceState() {} }, win.document);
  lpSaveKeyAndReload();
  check("typing a key and clicking Unlock saves it to sessionStorage", store.lpKey === "MY-TEST-KEY");
  check("typing a key and clicking Unlock reloads the page to pick it up", win.reloadedFlag());
}

// ── 4. An empty input must NOT wipe out any previously-saved key ──────────────────────────
{
  const store = { lpKey: "EXISTING-KEY" };
  const workingSessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  const fakeUrlParams = function () { return { get: () => null, delete() {}, toString: () => "" }; };
  const win = makeFakeDom("   ");
  const fn = new Function(
    "sessionStorage", "URLSearchParams", "location", "history", "document",
    `${block}\nreturn lpSaveKeyAndReload;`
  );
  const lpSaveKeyAndReload = fn(workingSessionStorage, fakeUrlParams, win.location, { replaceState() {} }, win.document);
  lpSaveKeyAndReload();
  check("submitting a blank/whitespace key does not clobber an existing saved key", store.lpKey === "EXISTING-KEY");
  check("submitting a blank/whitespace key does not reload the page", !win.reloadedFlag());
}

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll lp-scanner key-entry checks passed.");
