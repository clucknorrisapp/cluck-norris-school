#!/usr/bin/env node
"use strict";
// lib/engine-ratchet — the pure merge/diff shared by pokeConfigRatchet/cunaConfigRatchet/
// dncConfigRatchet/roseEngineConfigRatchet (server.js). The override merge these pin was missing
// for cuna/dnc/rose until a manual audit found it (2026-09-05 #3): a "durable" live retune landed
// in kv ratchetOverrides:<project> and was silently reverted by the very next deploy because the
// ratchet never read the table back. The engine-arm-gate test pins the same thing end-to-end
// against the real server; this file pins the pure function in isolation.
const assert = require("assert");
const { ratchetPatch } = require("../lib/engine-ratchet");
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.stack)); } };

t("empty overrides: patch equals want-minus-current (only the keys that actually differ)", () => {
  const current = { feeTierPct: 0.3, widthPct: 10, pair: "CUNA/USDC" };
  const want = { feeTierPct: 0.05, widthPct: 3, pair: "CUNA/USDC" };
  const { patch, target } = ratchetPatch({ current, want, overrides: {} });
  assert.deepStrictEqual(patch, { feeTierPct: 0.05, widthPct: 3 }, "pair matches current already, so it is not in the patch");
  assert.deepStrictEqual(target, want);
});

t("overrides win over want on a conflicting key", () => {
  const current = { widthPct: 10 };
  const want = { widthPct: 3 };
  const overrides = { widthPct: 7 };
  const { patch, target } = ratchetPatch({ current, want, overrides });
  assert.strictEqual(target.widthPct, 7, "override beats want in the merged target");
  assert.strictEqual(patch.widthPct, 7, "the patch carries the override's value, not want's");
});

t("an override equal to current produces no patch key for that key", () => {
  const current = { widthPct: 3, feeTierPct: 0.05 };
  const want = { widthPct: 10, feeTierPct: 0.3 };   // would-be reverts if overrides did not win
  const overrides = { widthPct: 3 };                // owner's live value — already correct
  const { patch } = ratchetPatch({ current, want, overrides });
  assert.strictEqual("widthPct" in patch, false, "already-correct override key is not rewritten");
  assert.strictEqual(patch.feeTierPct, 0.3, "an untouched want key still diffs normally");
});

t("null-valued override keys are NOT special here — the route deletes them at write time", () => {
  // /api/whirlpool/vault/config?durable=1 (whirlpool-mm.js ~702-718): a body[k] === null
  // *deletes* that key from the stored ratchetOverrides:<project> table before it is ever
  // written back to kv ("delete overrides[k]"). So by the time a ratchet reads the table, an
  // override value is never literally null — this pure function has no null-handling because
  // none is needed. Passing one through anyway should behave like any other override value: it
  // wins over want, and only enters the patch when it actually differs from current.
  const current = { widthPct: 10, feeTierPct: 0.05 };
  const want = { widthPct: 3, feeTierPct: 0.05 };
  const overrides = { widthPct: null };
  const { patch, target } = ratchetPatch({ current, want, overrides });
  assert.strictEqual(target.widthPct, null, "the merge itself does not special-case null");
  assert.strictEqual(patch.widthPct, null, "null differs from the numeric current, so it diffs in like any other value");
  assert.strictEqual("feeTierPct" in patch, false, "untouched by the null override, and already equal to current");
});

t("floor applies only when `when` returns true", () => {
  const wantsFloor = {
    current: { feeTierPct: 0.3, widthPct: 10 },   // still a vault default
    want: { pair: "CUNA/USDC" },
    overrides: {},
    floor: { when: (c) => c.feeTierPct === 0.3 || c.widthPct === 10, values: { maxUsd: 400, solMaxSol: 4.2 } },
  };
  const atFloor = ratchetPatch(wantsFloor);
  assert.strictEqual(atFloor.patch.maxUsd, 400);
  assert.strictEqual(atFloor.patch.solMaxSol, 4.2);

  const pastFloor = ratchetPatch({
    ...wantsFloor,
    current: { feeTierPct: 0.05, widthPct: 3 },   // owner already retuned past the vault default
  });
  assert.strictEqual("maxUsd" in pastFloor.patch, false, "floor never fires once current has moved off the vault default");
  assert.strictEqual("solMaxSol" in pastFloor.patch, false);
});

t("floor values are assigned AFTER the diff and are never themselves diffed", () => {
  // Pin the ordering explicitly: a floor value equal to `current` still lands in the patch,
  // because Object.assign runs unconditionally once `when` is true — it is not run back through
  // the current!==target check the way `want`/`overrides` keys are. This is exactly
  // pokeConfigRatchet's jup block (patch.jupFeeTierPct = 0.01 is set unconditionally once
  // !c.jupEnabled, with no diff against the live value) and cuna/rose's cap-reset blocks.
  const current = { feeTierPct: 0.3, maxUsd: 400 };   // maxUsd already happens to equal the floor value
  const { patch } = ratchetPatch({
    current, want: {}, overrides: {},
    floor: { when: (c) => c.feeTierPct === 0.3, values: { maxUsd: 400 } },
  });
  assert.strictEqual("maxUsd" in patch, true, "a floor value is written even when it equals current — it is not diffed");
});

t("a key present in current but absent from want (and not overridden, not floored) is never touched", () => {
  const current = { pair: "CUNA/USDC", someUnrelatedKnob: 42, feeTierPct: 0.3 };
  const want = { feeTierPct: 0.05 };
  const { patch } = ratchetPatch({ current, want, overrides: {} });
  assert.strictEqual("someUnrelatedKnob" in patch, false);
  assert.strictEqual("pair" in patch, false, "not named in want, current holds it — leave it alone");
  assert.strictEqual(patch.feeTierPct, 0.05);
});

t("no floor given: patch is just the want+overrides diff, nothing more", () => {
  // dncConfigRatchet has no floor block at all — pins that floor is genuinely optional.
  const current = { widthPct: 10 };
  const { patch } = ratchetPatch({ current, want: { widthPct: 2 }, overrides: {} });
  assert.deepStrictEqual(patch, { widthPct: 2 });
});

t("empty want, empty overrides, no floor: patch and target are both empty", () => {
  const { patch, target } = ratchetPatch({ current: { anything: 1 }, want: {}, overrides: {} });
  assert.deepStrictEqual(patch, {});
  assert.deepStrictEqual(target, {});
});

t("overridesApplied echoes the overrides object back unchanged, for a caller's own re-apply step", () => {
  // cunaConfigRatchet uses this to re-apply overrides on top of its floor block ("a durable
  // override beats the default table too") — a step this pure function deliberately does not
  // do itself, since roseEngineConfigRatchet does NOT do it (a firing floor there can still
  // clobber an override on the same key — a real, pre-existing difference between the two).
  const overrides = { widthPct: 7 };
  const { overridesApplied } = ratchetPatch({ current: {}, want: {}, overrides });
  assert.strictEqual(overridesApplied, overrides);
});

t("current missing entirely (getConfig returned undefined/falsy) does not throw", () => {
  const { patch } = ratchetPatch({ current: undefined, want: { widthPct: 2 }, overrides: {} });
  assert.deepStrictEqual(patch, { widthPct: 2 });
});

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
