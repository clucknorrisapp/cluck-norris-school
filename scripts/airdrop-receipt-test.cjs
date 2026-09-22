#!/usr/bin/env node
"use strict";
// lib/airdrop-receipt.js — the airdrop per-drop public receipt (Colosseum roadmap §W4/Extension).
// Pure module, so this runs standalone: no server boot, memoryKv (lib/hub/store.js's fixture,
// same two-method surface as lib/kvstore.js) + a mocked getTx() in place of the chain.
const assert = require("assert");
const bs58 = require("bs58");
const { memoryKv } = require("../lib/hub/store");
const AR = require("../lib/airdrop-receipt");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.stack || e)); } };
const tAsync = async (n, f) => { try { await f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.stack || e)); } };

const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const OTHER_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const A = "2nAYWqxLN9P5HKRxgbcPVKrboWZiTNncfvUhPNYXzWtv";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PAYER = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

let sigCounter = 0;
function fakeSig() { sigCounter++; const b = Buffer.alloc(64, 0); b.writeUInt32BE(sigCounter, 0); return bs58.encode(b); }
const bal = (owner, mint, amount) => ({ owner, mint, uiTokenAmount: { amount: String(amount) } });
const NOW = 1_800_000_000_000; // fixed ms "now" for deterministic notBefore checks
const tx = ({ err = null, pre = [], post = [], blockTime } = {}) => ({ meta: { err, preTokenBalances: pre, postTokenBalances: post }, blockTime: blockTime ?? Math.floor(NOW / 1000) });

function txByMap(map) { return async (sig) => { if (Object.prototype.hasOwnProperty.call(map, sig)) return map[sig]; throw new Error("sig not found (test getTx called for an unmocked sig)"); }; }

(async () => {
  console.log("\nAirdrop per-drop receipt (lib/airdrop-receipt.js)\n");

  await tAsync("toRaw/rawToUi round-trip, fixed-point (no float precision loss)", async () => {
    assert.strictEqual(AR.toRaw("1234.5", 9), 1234500000000n);
    assert.strictEqual(AR.toRaw("9000000.000000001", 9), 9000000000000001n, "9M tokens at 9 decimals — the float-precision boundary");
    assert.strictEqual(AR.rawToUi(1234500000000n, 9), "1234.5");
    assert.strictEqual(AR.toRaw("abc", 9), null);
    assert.strictEqual(AR.toRaw("-1", 9), null);
    assert.strictEqual(AR.toRaw("1.23456789012", 9), null, "more precision than the mint has is refused, never silently truncated");
  });

  await tAsync("a verified row records as paid", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    // 1000 whole tokens at 9 decimals = 1_000_000_000_000 raw units.
    const t1 = tx({ pre: [bal(PAYER, MINT, 2_000_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 1_000_000_000_000n), bal(A, MINT, 1_000_000_000_000n)] });
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW,
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.results[0].verified, true);
    assert.strictEqual(r.totals.verified, 1);
    const drop = AR.loadDrop(kv, r.dropId);
    assert.strictEqual(drop.rows[sig].verified, true);
    assert.strictEqual(drop.operator, PAYER, "operator is stored internally");
  });

  await tAsync("a mismatched row (short transfer) records as unverified with a reason, never as paid", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, MINT, 10_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 9_999_999_999n), bal(A, MINT, 1n)] }); // 1 raw unit, not 1000
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.results[0].verified, false);
    assert.match(r.results[0].reason, /smaller than the amount owed/);
    const drop = AR.loadDrop(kv, r.dropId);
    assert.strictEqual(drop.rows[sig].verified, false);
  });

  await tAsync("a row for the wrong mint is unverified (never credited from an unrelated token move)", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, OTHER_MINT, 10_000_000_000n)], post: [bal(PAYER, OTHER_MINT, 9_000_000_000n), bal(A, OTHER_MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW,
    });
    assert.strictEqual(r.results[0].verified, false);
  });

  // ── Finding #1 (Codex brief, Round 2, batch 8): rowPaidBy alone matches mint + destination
  // owner + amount, never WHO paid — so a stranger's unrelated transfer of the same mint to the
  // same recipient, or a DEX routing the mint through an inner CPI, would record as this
  // operator's airdrop. sourceIsOperator() closes that; these three pin it. (The fix lives here,
  // never in lib/payout-verify.js — a separate branch, PR #342, adds its own funding-wallet check
  // there for the CUNA/Hub settlement journal.)
  await tAsync("finding #1: a transfer FROM the drop's operator verifies", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.results[0].verified, true, JSON.stringify(r.results));
    assert.strictEqual(r.results[0].reason, null);
  });

  await tAsync("finding #1: the SAME mint/wallet/amount moved by a STRANGER is unverified, not credited as the operator's drop", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const STRANGER = B; // not the drop's operator (PAYER)
    const t1 = tx({ pre: [bal(STRANGER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(STRANGER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.results[0].verified, false, "a stranger's transfer must never verify as this operator's airdrop");
    assert.strictEqual(r.results[0].reason, AR.SOURCE_MISMATCH_REASON);
    const drop = AR.loadDrop(kv, r.dropId);
    assert.strictEqual(drop.rows[sig].verified, false);
    assert.strictEqual(drop.rows[sig].reason, AR.SOURCE_MISMATCH_REASON);
  });

  await tAsync("finding #1: an inner-CPI transfer routed through a DEX pool (not the operator) is unverified", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const DEX_POOL_OWNER = "H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm"; // the pool's own token-account owner
    const DEX_POOL_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"; // the CPI's signing authority — neither is PAYER
    const SRC_TOKEN_ACCOUNT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // the pool's token account (an address, not a wallet)
    const t1 = {
      meta: {
        err: null,
        preTokenBalances: [
          { accountIndex: 0, owner: DEX_POOL_OWNER, mint: MINT, uiTokenAmount: { amount: "5000000000" } },
          { accountIndex: 1, owner: A, mint: MINT, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 0, owner: DEX_POOL_OWNER, mint: MINT, uiTokenAmount: { amount: "4000000000" } },
          { accountIndex: 1, owner: A, mint: MINT, uiTokenAmount: { amount: "1000000000" } },
        ],
        // The transfer that actually moves the mint is nested under a DEX/swap instruction, not a
        // top-level one — exactly the "inner-CPI" shape rowPaidBy's pre/post-balance check already
        // handles correctly (it reads net effect, not instruction depth); this pins that the NEW
        // source check reaches the same conclusion by parsed-instruction authority too.
        innerInstructions: [{ index: 0, instructions: [
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transfer", info: { source: SRC_TOKEN_ACCOUNT, destination: "11111111111111111111111111111111", authority: DEX_POOL_AUTHORITY, amount: "1000000000" } } },
        ] }],
      },
      transaction: { message: { accountKeys: [SRC_TOKEN_ACCOUNT, "11111111111111111111111111111111"] } },
      blockTime: Math.floor(NOW / 1000),
    };
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.results[0].verified, false, "a DEX-routed inner-CPI transfer must not verify as the operator's drop");
    assert.strictEqual(r.results[0].reason, AR.SOURCE_MISMATCH_REASON);
  });

  await tAsync("a transaction predating the drop cannot be its payment (notBefore)", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const old = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)], blockTime: Math.floor((NOW - 3_600_000) / 1000) });
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: old }), now: NOW,
    });
    assert.strictEqual(r.results[0].verified, false);
    assert.match(r.results[0].reason, /before the batch was exported/);
  });

  await tAsync("replaying an already-verified sig is a no-op — getTx is not called again", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, MINT, 2_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 1_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    let calls = 0;
    const getTx = async (s) => { calls++; if (s === sig) return t1; throw new Error("unmocked"); };
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW });
    assert.strictEqual(r1.ok, true); assert.strictEqual(r1.results[0].verified, true, JSON.stringify(r1.results)); assert.strictEqual(calls, 1);
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW + 1000 });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(calls, 1, "getTx must not be called again for an already-verified sig");
    assert.strictEqual(r2.results[0].alreadyRecorded, true);
    assert.strictEqual(Object.keys(r2.drop.rows).length, 1, "no duplicate row");
  });

  await tAsync("a sig recorded but never verified (e.g. an RPC hiccup) IS retried on replay", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    let fail = true;
    const getTx = async () => { if (fail) throw new Error("RPC unavailable"); return tx({ pre: [bal(PAYER, MINT, 2_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 1_000_000_000n), bal(A, MINT, 1_000_000_000n)] }); };
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW });
    assert.strictEqual(r1.results[0].verified, false);
    fail = false;
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW + 1000 });
    assert.strictEqual(r2.results[0].verified, true, "a previously-unverified row is re-checked, not stuck forever");
  });

  await tAsync("continuing a dropId under different mint/decimals/createdAt is refused", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig();
    const t1 = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW });
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: OTHER_MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig: fakeSig() }], getTx: async () => null, now: NOW });
    assert.strictEqual(r2.ok, false); assert.strictEqual(r2.status, 400);
  });

  await tAsync("a different operator may not append to someone else's dropId", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig();
    const t1 = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW });
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: B, rows: [{ wallet: A, amount: "1000", sig: fakeSig() }], getTx: async () => null, now: NOW });
    assert.strictEqual(r2.ok, false); assert.strictEqual(r2.status, 403);
  });

  await tAsync("the per-drop row cap refuses a call that would exceed it", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    // Force the cap down for this check by hand-editing the stored drop to look nearly full.
    const drop = AR.loadDrop(kv, r1.dropId);
    for (let i = 0; i < AR.MAX_ROWS_PER_DROP - 1; i++) drop.rows["pad" + i] = { wallet: A, amount: "1", sig: "pad" + i, verified: true, recordedAt: NOW };
    kv.set(AR.kvKey(r1.dropId), drop);
    const overflowSig = fakeSig();
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: B, amount: "1", sig: overflowSig }], getTx: txByMap({ [overflowSig]: t1 }), now: NOW });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.error, /row cap/);
  });

  await tAsync("the daily per-operator drop cap refuses a NEW drop past the limit — continuing an existing one is unaffected", async () => {
    const kv = memoryKv();
    const t1 = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)] });
    let lastOk;
    for (let i = 0; i < AR.MAX_DROPS_PER_OPERATOR_PER_DAY; i++) {
      const sig = fakeSig();
      lastOk = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
      assert.strictEqual(lastOk.ok, true, "drop #" + i + " should succeed");
    }
    const overSig = fakeSig();
    const over = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig: overSig }], getTx: txByMap({ [overSig]: t1 }), now: NOW });
    assert.strictEqual(over.ok, false); assert.strictEqual(over.status, 429);
    // Adding another row to the LAST already-created drop today must still work — the cap only
    // gates minting a NEW dropId.
    const moreSig = fakeSig();
    const cont = await AR.recordDrop({ kv, dropId: lastOk.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: B, amount: "1", sig: moreSig }], getTx: txByMap({ [moreSig]: t1 }), now: NOW });
    assert.strictEqual(cont.ok, true, "continuing an in-progress drop is never throttled by the daily-new-drop cap");
    // A different operator is unaffected by PAYER's cap.
    const otherSig = fakeSig();
    const other = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: A, rows: [{ wallet: B, amount: "1", sig: otherSig }], getTx: txByMap({ [otherSig]: t1 }), now: NOW });
    assert.strictEqual(other.ok, true);
  });

  // ── No operator passed (the normal case since 2026-09-22: the Airdropper is free for everyone,
  // there is no pass, and nothing the client sends names the wallet). The operator is the FEE
  // PAYER of the first row's transaction — accountKeys[0] on a jsonParsed tx — and every later
  // row is held to it exactly as a pass-named operator was. The receipt route passes nothing.
  const txPaidBy = (payer, opts) => { const t1 = tx(opts); t1.transaction = { message: { accountKeys: [payer, "11111111111111111111111111111111"] } }; return t1; };
  await tAsync("no operator passed: the fee payer of the first readable row BECOMES the operator (stored, never public)", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.drop.operator, PAYER, "operator derived from accountKeys[0]");
    assert.strictEqual(r.results[0].verified, true, JSON.stringify(r.results));
    assert.ok(!JSON.stringify(AR.publicDrop(r.drop)).includes(PAYER), "derived operator never reaches the public body");
    assert.strictEqual(AR.feePayerOf(t1), PAYER);
    assert.strictEqual(AR.feePayerOf(tx({})), null, "a tx with no account keys names nobody");
    assert.strictEqual(AR.feePayerOf({ transaction: { message: { accountKeys: [{ pubkey: PAYER, signer: true }] } } }), PAYER, "object-shaped keys too");
  });
  await tAsync("no operator passed: a later row a STRANGER funded is unverified against the derived operator", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig(), sig2 = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const t2 = txPaidBy(B, { pre: [bal(B, MINT, 5_000_000_000n), bal(A, MINT, 1_000_000_000n)], post: [bal(B, MINT, 4_000_000_000n), bal(A, MINT, 2_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW });
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig2 }], getTx: txByMap({ [sig2]: t2 }), now: NOW + 1000 });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.results[0].verified, false, "B's transfer must not record as PAYER's drop");
    assert.strictEqual(r2.results[0].reason, "transfer_not_from_operator");
    assert.strictEqual(r2.drop.operator, PAYER, "the operator does not move to the stranger");
  });
  await tAsync("no operator passed: two payers in ONE batch — the first readable row names the operator, the other payer's row is unverified", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig(), sig2 = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const t2 = txPaidBy(B, { pre: [bal(B, MINT, 5_000_000_000n), bal(A, MINT, 1_000_000_000n)], post: [bal(B, MINT, 4_000_000_000n), bal(A, MINT, 2_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig1 }, { wallet: A, amount: "1", sig: sig2 }], getTx: txByMap({ [sig1]: t1, [sig2]: t2 }), now: NOW });
    assert.strictEqual(r.results[0].verified, true);
    assert.strictEqual(r.results[1].verified, false);
    assert.strictEqual(r.drop.operator, PAYER);
  });
  await tAsync("no operator passed: the daily cap is keyed on the DERIVED payer — the 21st new drop from the same fee payer is refused, a different payer is not", async () => {
    const kv = memoryKv();
    const mk = (payer) => { const sig = fakeSig(); const t1 = txPaidBy(payer, { pre: [bal(payer, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(payer, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] }); return { sig, getTx: txByMap({ [sig]: t1 }) }; };
    let last;
    for (let i = 0; i < 20; i++) {
      const { sig, getTx } = mk(PAYER);
      last = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW });
      assert.strictEqual(last.ok, true, `drop ${i + 1}: ${JSON.stringify(last)}`);
    }
    const { sig: overSig, getTx: overTx } = mk(PAYER);
    const over = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: overSig }], getTx: overTx, now: NOW });
    assert.strictEqual(over.ok, false); assert.strictEqual(over.status, 429);
    const { sig: contSig, getTx: contTx } = mk(PAYER);
    const cont = await AR.recordDrop({ kv, dropId: last.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: B, amount: "1", sig: contSig }], getTx: contTx, now: NOW });
    assert.strictEqual(cont.ok, true, "continuing an existing drop is never throttled");
    const { sig: otherSig, getTx: otherTx } = mk(B);
    const other = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: otherSig }], getTx: otherTx, now: NOW });
    assert.strictEqual(other.ok, true, "a different fee payer is unaffected by PAYER's cap");
  });
  await tAsync("no operator passed and the first tx cannot be read: the drop is created with operator:null, and the NEXT readable row names it", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig(), sig2 = fakeSig();
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig1 }], getTx: async () => { throw new Error("rpc down"); }, now: NOW });
    assert.strictEqual(r1.ok, true); assert.strictEqual(r1.drop.operator, null); assert.strictEqual(r1.results[0].verified, false);
    const t2 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig2 }], getTx: txByMap({ [sig2]: t2 }), now: NOW + 1000 });
    assert.strictEqual(r2.ok, true); assert.strictEqual(r2.drop.operator, PAYER); assert.strictEqual(r2.results[0].verified, true);
  });

  await tAsync("the public body carries no operator wallet anywhere", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, MINT, 2_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 1_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    const pub = AR.publicDrop(AR.loadDrop(kv, r.dropId), { symbol: "TEST" });
    const json = JSON.stringify(pub);
    assert.ok(!json.includes(PAYER), "the operator's wallet must not appear anywhere in the public body");
    assert.strictEqual(pub.count, 1);
    assert.strictEqual(pub.verifiedCount, 1);
    assert.strictEqual(pub.total, "1", "1 whole token at 9 decimals");
    assert.strictEqual(pub.rows[0].wallet, A);
    assert.strictEqual(pub.rows[0].sig, sig);
    assert.strictEqual(pub.rows[0].verified, true);
    assert.strictEqual(pub.rows[0].reason, null, "a verified row carries no reason");
  });

  await tAsync("the per-wallet lookup finds the right row and nothing else", async () => {
    const kv = memoryKv();
    const sigA = fakeSig(), sigB = fakeSig();
    const t1 = tx({ pre: [bal(A, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n)] });
    const t2 = tx({ pre: [bal(B, MINT, 0n)], post: [bal(B, MINT, 2_000_000_000n)] });
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: A, amount: "1000", sig: sigA }, { wallet: B, amount: "2000", sig: sigB }],
      getTx: txByMap({ [sigA]: t1, [sigB]: t2 }), now: NOW,
    });
    const drop = AR.loadDrop(kv, r.dropId);
    const rowA = Object.values(drop.rows).find((x) => x.wallet === A);
    const rowB = Object.values(drop.rows).find((x) => x.wallet === B);
    assert.strictEqual(rowA.sig, sigA); assert.strictEqual(rowB.sig, sigB);
    assert.strictEqual(AR.publicRow(rowA).wallet, A);
  });

  await tAsync("malformed wallet or signature rows are refused, not stored or chain-checked", async () => {
    const kv = memoryKv();
    let calls = 0;
    const getTx = async () => { calls++; return null; };
    const r = await AR.recordDrop({
      kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER,
      rows: [{ wallet: "not-a-wallet", amount: "1", sig: fakeSig() }, { wallet: A, amount: "1", sig: "not-a-signature" }],
      getTx, now: NOW,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.results[0].verified, false); assert.match(r.results[0].reason, /wallet address/);
    assert.strictEqual(r.results[1].verified, false); assert.match(r.results[1].reason, /signature/);
    assert.strictEqual(calls, 0, "the chain is never read for input that cannot possibly verify");
  });

  // ── native SOL drops (adversarial review P2-5) ───────────────────────────────────────────
  // A SOL drop could never be recorded: the pane posted the literal "native", SOL_ADDR_RE
  // rejected it, and every SOL drop died on "bad mint". The handle is now the canonical
  // wrapped-SOL mint address, and verification reads LAMPORT deltas — payout-verify.js's
  // rowPaidBy cannot see a SystemProgram transfer at all, and widening the Hub's shared money
  // verifier for an airdrop receipt was the wrong trade.
  const NATIVE = AR.NATIVE_MINT;
  // A native tx: account keys plus the pre/post lamport arrays the chain already returns.
  const natTx = ({ err = null, keys = [], pre = [], post = [], blockTime } = {}) => ({
    meta: { err, preBalances: pre, postBalances: post },
    transaction: { message: { accountKeys: keys } },
    blockTime: blockTime ?? Math.floor(NOW / 1000),
  });

  t("lamportDelta reads the net change for a wallet, and null when it is not in the tx", () => {
    const x = natTx({ keys: [PAYER, A], pre: [10_000_000_000, 0], post: [8_999_995_000, 1_000_000_000] });
    assert.strictEqual(AR.lamportDelta(x, A), 1_000_000_000n);
    assert.strictEqual(AR.lamportDelta(x, PAYER), -1_000_005_000n);
    assert.strictEqual(AR.lamportDelta(x, B), null, "a wallet not in the transaction is null, never 0");
  });

  t("lamportDelta tolerates accountKeys as {pubkey} objects, not only strings", () => {
    const x = natTx({ keys: [{ pubkey: PAYER }, { pubkey: A }], pre: [10_000_000_000, 0], post: [8_999_995_000, 1_000_000_000] });
    assert.strictEqual(AR.lamportDelta(x, A), 1_000_000_000n);
  });

  t("⚠️ nativeRowPaid refuses a failed transaction before it looks at any balance", () => {
    const x = natTx({ err: { InstructionError: [0, "Custom"] }, keys: [PAYER, A], pre: [10e9, 0], post: [9e9, 1e9] });
    const v = AR.nativeRowPaid(x, { wallet: A, minRaw: "1000000000", nowUnix: Math.floor(NOW / 1000) });
    assert.strictEqual(v.ok, false);
    assert.match(v.why, /failed on chain/);
  });

  t("nativeRowPaid: enough SOL arrived → ok; not enough → refused with both numbers", () => {
    const x = natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] });
    assert.strictEqual(AR.nativeRowPaid(x, { wallet: A, minRaw: "1000000000", nowUnix: Math.floor(NOW / 1000) }).ok, true);
    const short = AR.nativeRowPaid(x, { wallet: A, minRaw: "2000000000", nowUnix: Math.floor(NOW / 1000) });
    assert.strictEqual(short.ok, false);
    assert.match(short.why, /smaller than the amount owed/);
    assert.strictEqual(short.deltaRaw, "1000000000");
  });

  t("⚠️ a wallet whose SOL went DOWN is never 'paid' — the sender is not a recipient", () => {
    const x = natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] });
    const v = AR.nativeRowPaid(x, { wallet: PAYER, minRaw: "1", nowUnix: Math.floor(NOW / 1000) });
    assert.strictEqual(v.ok, false);
    assert.match(v.why, /no SOL reached this wallet/);
  });

  t("nativeSourceIsOperator: only a wallet that actually lost the lamports counts as the funder", () => {
    const x = natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] });
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: PAYER, minRaw: 1_000_000_000n }), true);
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: A, minRaw: 1_000_000_000n }), false,
      "the RECIPIENT must never read as the funder");
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: B, minRaw: 1n }), false,
      "a wallet not in the transaction at all is not the funder");
  });

  await tAsync("⚠️ a SOL drop RECORDS and VERIFIES end to end — it used to die on 'bad mint'", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const getTx = txByMap({ [sig]: natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] }) });
    const r = await AR.recordDrop({
      kv, getTx, now: NOW, mint: NATIVE, decimals: 9, createdAt: NOW - 60_000,
      rows: [{ wallet: A, amount: "1", sig }],
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.results[0].verified, true, JSON.stringify(r.results[0]));
    assert.ok(r.dropId, "a SOL drop gets a real dropId, which is what the public URL is built from");
    assert.strictEqual(r.drop.mint, NATIVE, "and it is stored under a real base58 mint, needing no special case downstream");
    assert.strictEqual(r.totals.verified, 1);
  });

  await tAsync("⚠️ a SOL row the chain does not support is recorded UNVERIFIED, never quietly passed", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    // B is in the transaction but gained nothing.
    const getTx = txByMap({ [sig]: natTx({ keys: [PAYER, A, B], pre: [10e9, 0, 5e9], post: [8.999995e9, 1e9, 5e9] }) });
    const r = await AR.recordDrop({
      kv, getTx, now: NOW, mint: NATIVE, decimals: 9, createdAt: NOW - 60_000,
      rows: [{ wallet: B, amount: "1", sig }],
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.results[0].verified, false);
    assert.match(r.results[0].reason, /no SOL reached this wallet/);
  });

  await tAsync("⚠️ a SOL drop with an operator on record refuses a row a STRANGER funded", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig(), sig2 = fakeSig();
    // sig1 establishes the drop with PAYER as operator; sig2 is funded by B instead.
    const getTx = txByMap({
      [sig1]: natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] }),
      [sig2]: natTx({ keys: [B, A], pre: [10e9, 0], post: [8.999995e9, 1e9] }),
    });
    const first = await AR.recordDrop({
      kv, getTx, now: NOW, mint: NATIVE, decimals: 9, createdAt: NOW - 60_000, operator: PAYER,
      rows: [{ wallet: A, amount: "1", sig: sig1 }],
    });
    assert.strictEqual(first.results[0].verified, true, JSON.stringify(first.results[0]));
    const second = await AR.recordDrop({
      kv, getTx, now: NOW, dropId: first.dropId, mint: NATIVE, decimals: 9, createdAt: NOW - 60_000,
      rows: [{ wallet: A, amount: "1", sig: sig2 }],
    });
    assert.strictEqual(second.results[0].verified, false, JSON.stringify(second.results[0]));
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
