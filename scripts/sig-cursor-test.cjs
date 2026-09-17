#!/usr/bin/env node
"use strict";
// lib/sig-cursor — the "fresh signatures since the durable cursor" walk shared by the ROSE buy
// bot, the generic per-project buy bot, and the burn watcher (all in server.js). Proven identical
// across all three call sites before extraction: same skip-on-err semantics (ROSE/generic write
// `if (s.err) continue;`, the burn watcher writes `if (!s.err) fresh.push(...)` — same outcome,
// just phrased the opposite way round), same newest-first input assumption, same
// collect-then-reverse to oldest-first output order, same "cursor sig itself never pushed" rule.
const assert = require("assert");
const { freshSince } = require("../lib/sig-cursor");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };

// sigs are newest-first, exactly as getSignaturesForAddress returns them.
const s = (signature, err = null) => ({ signature, err });
const SIGS = [s("e5"), s("d4"), s("c3", { InstructionError: [0, "x"] }), s("b2"), s("a1")]; // newest → oldest

t("empty list: nothing fresh, cursor not found, no head", () => {
  const r = freshSince([], "anything");
  assert.deepStrictEqual(r, { fresh: [], cursorFound: false, head: null });
});

t("no cursor (null lastSig): all non-err sigs, oldest-last→ no, oldest-FIRST order, cursorFound false, head is sigs[0]", () => {
  const r = freshSince(SIGS, null);
  assert.deepStrictEqual(r.fresh, ["a1", "b2", "d4", "e5"], "c3 (err) skipped; oldest-first order");
  assert.strictEqual(r.cursorFound, false);
  assert.strictEqual(r.head, "e5");
});

t("cursor at head: nothing fresh, cursorFound true", () => {
  const r = freshSince(SIGS, "e5");
  assert.deepStrictEqual(r.fresh, []);
  assert.strictEqual(r.cursorFound, true);
  assert.strictEqual(r.head, "e5");
});

t("cursor mid-list: exactly the newer sigs, oldest-first, cursor itself excluded, err entries between cursor and head skipped", () => {
  const r = freshSince(SIGS, "b2");
  // newer-than-b2 in the raw (newest-first) order is [e5, d4, c3(err)]; c3 is skipped for err;
  // b2 itself must never appear. Result is that set reversed to oldest-first.
  assert.deepStrictEqual(r.fresh, ["d4", "e5"]);
  assert.strictEqual(r.cursorFound, true);
});

t("cursor absent but list non-empty (fell off the window): all non-err sigs, cursorFound false", () => {
  const r = freshSince(SIGS, "not-in-the-window");
  assert.deepStrictEqual(r.fresh, ["a1", "b2", "d4", "e5"]);
  assert.strictEqual(r.cursorFound, false);
  assert.strictEqual(r.head, "e5");
});

t("err entries are skipped wherever they sit, never counted as the cursor unless signature matches", () => {
  const withErrAtCursor = [s("z9"), s("y8", { some: "err" }), s("x7")];
  // cursor is the erroring sig itself — must still be found (matched by signature, not by err),
  // and must never be pushed into fresh.
  const r = freshSince(withErrAtCursor, "y8");
  assert.deepStrictEqual(r.fresh, ["z9"], "z9 is newer than the cursor and has no err of its own");
  assert.strictEqual(r.cursorFound, true);
});

t("cursor entry itself is never included even when older entries exist", () => {
  const r = freshSince(SIGS, "d4");
  assert.deepStrictEqual(r.fresh, ["e5"]);
  assert(!r.fresh.includes("d4"));
});

t("a single-item list with the cursor at that item: nothing fresh", () => {
  const r = freshSince([s("only")], "only");
  assert.deepStrictEqual(r, { fresh: [], cursorFound: true, head: "only" });
});

t("head is always sigs[0].signature regardless of the cursor position", () => {
  assert.strictEqual(freshSince(SIGS, "b2").head, "e5");
  assert.strictEqual(freshSince(SIGS, null).head, "e5");
  assert.strictEqual(freshSince(SIGS, "missing").head, "e5");
});

t("non-array input is treated as empty, not a throw", () => {
  assert.deepStrictEqual(freshSince(null, "x"), { fresh: [], cursorFound: false, head: null });
  assert.deepStrictEqual(freshSince(undefined, "x"), { fresh: [], cursorFound: false, head: null });
});

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
