#!/usr/bin/env node
"use strict";
// Seeker app in-app swap — Codex round 30, P1: "checkPendingSwap declares a PROCESSED transaction
// expired." A signature status of `processed` (or `confirmed`/`finalized`) with no `err` is a
// LANDED transaction; block-height expiry only proves nothing NEW can execute against that
// blockhash — it says nothing about whether THIS signature already landed. The previous version
// fell straight into the height check for anything that wasn't confirmed/finalized, including
// `processed`, and could report an actively-landing transaction as "expired — safe to retry".
//
// src/seeker/sign.js's checkPendingSwap() is pure (no window, only the `rpc` function it's
// handed) — this drives it directly with a scripted fake `rpc`.
//
// Usage: node scripts/seeker-pending-swap-test.cjs

const path = require("path");
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

// A scripted fake `rpc(method, params)` — call log lets assertions check that the FINAL
// searchTransactionHistory check only happens when it's actually needed (never on every poll).
function fakeRpc(script) {
  const calls = [];
  const fn = async (method, params) => {
    calls.push({ method, params });
    const step = script.shift();
    if (!step) throw new Error("fakeRpc: script exhausted, unexpected call " + method);
    if (step.throws) throw new Error(step.throws);
    return step.result;
  };
  fn.calls = calls;
  return fn;
}
function statusResult(list) { return { value: list }; }
function heightResult(h) { return h; }

(async () => {
  console.log("\nSeeker swap — checkPendingSwap() (sign.js), Codex round 30 P1\n");

  const mod = await import(path.join(ROOT, "src", "seeker", "sign.js") + "?t=" + Date.now());
  const { checkPendingSwap } = mod;
  const SIG = "3VELZ2avSUq79qstuR8a7C3euJ834WmQyrjt4uRnn4eb";
  const LVB = 100;

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("(1) Codex's fixture — processed, height already past the limit -> NOT expired\n");
  {
    // getSignatureStatuses (no searchTransactionHistory) returns `processed`, getBlockHeight is
    // already past lastValidBlockHeight. The OLD code fell straight into the height check and
    // returned "expired" here; `processed` must short-circuit to "pending" before that ever runs.
    const rpc = fakeRpc([
      { result: statusResult([{ err: null, confirmationStatus: "processed" }]) },
      { result: heightResult(LVB + 50) },
    ]);
    const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
    ok("processed + height past limit -> pending, never expired", r.status === "pending", r);
    ok("no THIRD (searchTransactionHistory) call was made — processed already resolved it", rpc.calls.length === 2, rpc.calls);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(2) null status + height past limit + history says null -> expired\n");
  {
    const rpc = fakeRpc([
      { result: statusResult([null]) },               // first check: no status
      { result: heightResult(LVB + 50) },              // height already past
      { result: statusResult([null]) },                // final searchTransactionHistory check: still nothing
    ]);
    const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
    ok("null status, height past limit, final history check null -> expired", r.status === "expired", r);
    ok("the final check DID pass searchTransactionHistory:true", rpc.calls[2] && rpc.calls[2].params[1] && rpc.calls[2].params[1].searchTransactionHistory === true, rpc.calls[2]);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(3) null status + height past limit + history says confirmed -> sent\n");
  {
    const rpc = fakeRpc([
      { result: statusResult([null]) },
      { result: heightResult(LVB + 50) },
      { result: statusResult([{ err: null, confirmationStatus: "confirmed" }]) },
    ]);
    const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
    ok("null status, height past limit, final history check confirmed -> sent", r.status === "sent", r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(4) null status + height past limit + history call errors -> stays pending, never a guessed answer\n");
  {
    const rpc = fakeRpc([
      { result: statusResult([null]) },
      { result: heightResult(LVB + 50) },
      { throws: "rpc unavailable" },
    ]);
    const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
    ok("an RPC error on the final check -> pending, never expired or sent", r.status === "pending", r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(5) unchanged behaviour — err first, confirmed/finalized without ever needing the height\n");
  {
    const rpcErr = fakeRpc([
      { result: statusResult([{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "processed" }]) },
      { result: heightResult(LVB - 5) },
    ]);
    const rErr = await checkPendingSwap(rpcErr, { signature: SIG, lastValidBlockHeight: LVB });
    ok("err set (even alongside a confirmationStatus) -> failed, err-first", rErr.status === "failed" && /failed on-chain/i.test(rErr.error), rErr);

    const rpcOk = fakeRpc([
      { result: statusResult([{ err: null, confirmationStatus: "finalized" }]) },
      { result: heightResult(LVB - 5) },
    ]);
    const rOk = await checkPendingSwap(rpcOk, { signature: SIG, lastValidBlockHeight: LVB });
    ok("finalized -> sent", rOk.status === "sent", rOk);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n(6) height not yet past the limit -> pending regardless of status shape\n");
  {
    const rpc = fakeRpc([
      { result: statusResult([null]) },
      { result: heightResult(LVB - 1) },
    ]);
    const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
    ok("null status, height still under the limit -> pending, no final check needed", r.status === "pending" && rpc.calls.length === 2, r);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Codex round 31, P2 — "malformed status responses become expired." Only a WELL-FORMED explicit
  // null (`result.value` an array whose entry at index 0 is literally `null`) may ever become
  // "expired". `{}`, `{value:[]}`, `null`, and `undefined` are not answers — they must stay
  // `pending`, on BOTH the first check and the final searchTransactionHistory check, height past
  // expiry or not.
  console.log("\n(7) Codex round 31, P2 — malformed status shapes never become 'expired'\n");
  {
    const malformedShapes = [
      { label: "{}", value: {} },
      { label: "{value:[]}", value: { value: [] } },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
    ];
    for (const shape of malformedShapes) {
      const rpc = fakeRpc([
        { result: shape.value },               // first check: malformed, not a well-formed null
        { result: heightResult(LVB + 50) },     // height already past
        { result: shape.value },                // final check: same malformed shape again
      ]);
      const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
      ok(`malformed status shape ${shape.label}, height past expiry -> stays pending, never expired/sent/failed`,
        r.status === "pending", r);
    }

    // A non-array `value` (another malformed shape) must behave the same way.
    {
      const rpc = fakeRpc([
        { result: { value: "not-an-array" } },
        { result: heightResult(LVB + 50) },
        { result: { value: "not-an-array" } },
      ]);
      const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
      ok("non-array `value` -> stays pending, never expired", r.status === "pending", r);
    }

    // A thrown RPC error on the FIRST check (not just the final one) must also stay pending —
    // statusOutcome(undefined) returns null (no status), which falls through to the height check
    // and then the final check exactly as a malformed shape would.
    {
      const rpc = fakeRpc([
        { throws: "rpc unavailable on first check" },
      ]);
      const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
      ok("an RPC error on the very first Promise.all -> pending (caught by the outer try/catch)", r.status === "pending", r);
    }

    // Control: a WELL-FORMED explicit null on both checks, height past expiry -> genuinely expired.
    {
      const rpc = fakeRpc([
        { result: statusResult([null]) },
        { result: heightResult(LVB + 50) },
        { result: statusResult([null]) },
      ]);
      const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
      ok("well-formed null on both checks, height past expiry -> genuinely expired", r.status === "expired", r);
    }

    // Control: a well-formed CONFIRMED on the final check -> sent, not expired.
    {
      const rpc = fakeRpc([
        { result: statusResult([null]) },
        { result: heightResult(LVB + 50) },
        { result: statusResult([{ err: null, confirmationStatus: "confirmed" }]) },
      ]);
      const r = await checkPendingSwap(rpc, { signature: SIG, lastValidBlockHeight: LVB });
      ok("well-formed confirmed on the final check -> sent", r.status === "sent", r);
    }
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
