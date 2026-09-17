"use strict";
// Shared "config ratchet" merge/diff for the liquidity-engine boot ratchets in server.js
// (pokeConfigRatchet, cunaConfigRatchet, dncConfigRatchet, roseEngineConfigRatchet). Each one
// asserts the owner's current `want` table on every boot so a deploy can never silently revert
// live tuning back to a vault default — but a durable live retune
// (POST /api/whirlpool/vault/config?durable=1) lands in kv `ratchetOverrides:<project>`, and it
// has to be merged OVER `want` before diffing against the live config or it reverts on the very
// next deploy. That merge was missing for cuna/dnc/rose until a manual audit found it
// (2026-09-05 #3) — the engine-arm-gate test now pins that all four still merge it, and that the
// "[cuna] ratchet overrides active" log line still fires.
//
// This module holds only the pure merge/diff shape: build `target` from `want` + `overrides`,
// diff it against `current` (strict !==, exactly as the ratchets always have) to get `patch`,
// then — only when a `floor` is given and `floor.when(current)` is true — Object.assign
// `floor.values` onto `patch`. Floor values are applied AFTER the diff and are never themselves
// diffed (a floor key is written even if it happens to equal `current` already; that mirrors
// today's behavior, e.g. pokeConfigRatchet's jup block and cuna/rose's cap-reset blocks).
//
// The per-project preamble (project re-registration, operator-env rebinding), the exact `want`
// values, the floor condition/values and the log text all stay in server.js — this is the one
// piece that was byte-identical four times over.
//
// `overridesApplied` is the `overrides` object echoed straight back. cunaConfigRatchet uses it
// for an extra step this module deliberately does NOT do: cuna re-applies overrides on top of
// its floor block ("a durable override beats the default table too"), so a durable override
// always wins even over a floor value. roseEngineConfigRatchet has no such re-apply — there, a
// firing floor can still clobber an override on the same key. That gap is a real, pre-existing
// difference between the two ratchets, not a bug this refactor introduced or fixed; see
// cunaConfigRatchet / roseEngineConfigRatchet in server.js.
function ratchetPatch({ current, want, overrides, floor } = {}) {
  const c = current || {};
  const w = want || {};
  const o = overrides || {};
  const target = { ...w, ...o };
  const patch = {};
  for (const k of Object.keys(target)) if (c[k] !== target[k]) patch[k] = target[k];
  if (floor && typeof floor.when === "function" && floor.when(c)) {
    Object.assign(patch, floor.values || {});
  }
  return { patch, target, overridesApplied: o };
}

module.exports = { ratchetPatch };
