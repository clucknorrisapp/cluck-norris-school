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
// A token transaction fixture built from balances alone. Since Codex round 20 the funding check is
// bound to a PARSED TRANSFER (source owner → destination owner, mint, amount), so the fixture
// synthesises what a jsonParsed getTransaction would carry for the balances it is given: one
// account key per (owner, mint) row — the owner's address stands in for its token account — with
// `accountIndex` on every balance row, and one transferChecked from each owner whose balance of a
// mint fell to each owner whose balance of that mint rose, for the amount that rose. `payer`
// puts that key first (the fee payer, feePayerOf). Fixtures that need a different shape build it
// by hand (the inner-CPI, unrelated-token and same-mint-other-recipient cases below).
const tx = ({ err = null, pre = [], post = [], blockTime, payer } = {}) => {
  const keys = payer ? [payer] : [];
  const keyOf = (o) => { if (!keys.includes(o)) keys.push(o); return keys.indexOf(o); };
  const index = (rows) => rows.map((b) => ({ ...b, accountIndex: keyOf(b.owner) }));
  const preRows = index(pre), postRows = index(post);
  const mints = new Set([...preRows, ...postRows].map((b) => b.mint));
  const ixs = [];
  for (const m of mints) {
    const delta = new Map();
    for (const b of preRows) if (b.mint === m) delta.set(b.owner, (delta.get(b.owner) || 0n) - BigInt(b.uiTokenAmount.amount));
    for (const b of postRows) if (b.mint === m) delta.set(b.owner, (delta.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount));
    for (const [from, d] of delta) if (d < 0n) for (const [to, g] of delta) if (g > 0n) {
      ixs.push({ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", program: "spl-token", parsed: { type: "transferChecked", info: { source: from, destination: to, authority: from, mint: m, tokenAmount: { amount: g.toString() } } } });
    }
  }
  if (keys.length && !keys.includes("11111111111111111111111111111111")) keys.push("11111111111111111111111111111111");
  return { meta: { err, preTokenBalances: preRows, postTokenBalances: postRows }, transaction: { message: { accountKeys: keys, instructions: ixs } }, blockTime: blockTime ?? Math.floor(NOW / 1000) };
};

// A row the operator PAYER really funded: PAYER loses `amt` raw of MINT, `to` gains it. Since
// Codex round 16 only rows like this are ever stored — an unfunded or short transfer is reported
// back with its reason and never touches the drop — so fixtures that just need a drop to exist
// use this shape.
const paid = (to, amt) => tx({ pre: [bal(PAYER, MINT, amt * 2n), bal(to, MINT, 0n)], post: [bal(PAYER, MINT, amt), bal(to, MINT, amt)] });
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
    assert.strictEqual(AR.rowOnDrop(drop, sig, A).verified, true, "rows are keyed by (signature, wallet) — round 18");
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
    assert.strictEqual(r.ok, false, "nothing verified → no drop is created (Codex round 16)");
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.results[0].verified, false);
    assert.match(r.results[0].reason, /smaller than the amount owed/);
    assert.strictEqual(r.dropId, undefined, "no dropId for a drop that was never created");
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
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 409, "and nothing is stored, so no drop exists");
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
    assert.strictEqual(r1.ok, false); assert.strictEqual(r1.status, 409, "an unreadable first row creates nothing");
    assert.strictEqual(r1.results[0].verified, false); assert.match(r1.results[0].reason, /could not read the chain/);
    fail = false;
    const r2 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW + 1000 });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.results[0].verified, true, "the same row, retried once readable, is recorded — nothing was stuck");
  });

  await tAsync("continuing a dropId under different mint/decimals/createdAt is refused", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig();
    const t1 = paid(A, 1_000_000_000_000n);
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW });
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: OTHER_MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig: fakeSig() }], getTx: async () => null, now: NOW });
    assert.strictEqual(r2.ok, false); assert.strictEqual(r2.status, 400);
  });

  await tAsync("a different operator may not append to someone else's dropId", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig();
    const t1 = paid(A, 1_000_000_000_000n);
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW });
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: B, rows: [{ wallet: A, amount: "1000", sig: fakeSig() }], getTx: async () => null, now: NOW });
    assert.strictEqual(r2.ok, false); assert.strictEqual(r2.status, 403);
  });

  await tAsync("the per-drop row cap refuses a call that would exceed it", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = paid(A, 1_000_000_000_000n);
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1000", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
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
    const t1 = paid(A, 1_000_000_000n);
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
    const cont = await AR.recordDrop({ kv, dropId: lastOk.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: B, amount: "1", sig: moreSig }], getTx: txByMap({ [moreSig]: paid(B, 1_000_000_000n) }), now: NOW });
    assert.strictEqual(cont.ok, true, "continuing an in-progress drop is never throttled by the daily-new-drop cap");
    assert.strictEqual(cont.results[0].verified, true);
    // A different operator is unaffected by PAYER's cap (its row is funded by A, the operator).
    const otherSig = fakeSig();
    const tA = tx({ pre: [bal(A, MINT, 2_000_000_000n), bal(B, MINT, 0n)], post: [bal(A, MINT, 1_000_000_000n), bal(B, MINT, 1_000_000_000n)] });
    const other = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: A, rows: [{ wallet: B, amount: "1", sig: otherSig }], getTx: txByMap({ [otherSig]: tA }), now: NOW });
    assert.strictEqual(other.ok, true, JSON.stringify(other));
  });

  // ── No operator passed (the normal case since 2026-09-22: the Airdropper is free for everyone,
  // there is no pass, and nothing the client sends names the wallet). The operator is the FEE
  // PAYER of the first row's transaction — accountKeys[0] on a jsonParsed tx — and every later
  // row is held to it exactly as a pass-named operator was. The receipt route passes nothing.
  const txPaidBy = (payer, opts) => tx({ ...opts, payer });
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
    assert.strictEqual(r2.ok, false, "a batch that put nothing on the receipt is not a success (round 17)");
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(r2.results[0].verified, false, "B's transfer must not record as PAYER's drop");
    assert.strictEqual(r2.results[0].reason, "transfer_not_from_operator");
    assert.strictEqual(AR.loadDrop(kv, r1.dropId).operator, PAYER, "the operator does not move to the stranger");
    assert.strictEqual(Object.keys(AR.loadDrop(kv, r1.dropId).rows).length, 1, "and nothing was written");
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
    // (The fixture pays A. This row used to name B and still "succeed" because an existing drop
    // answered 200 for a batch of which nothing verified — round 17 made that a 409, which is
    // what exposed the fixture.)
    const cont = await AR.recordDrop({ kv, dropId: last.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: contSig }], getTx: contTx, now: NOW });
    assert.strictEqual(cont.ok, true, "continuing an existing drop is never throttled");
    assert.strictEqual(cont.results[0].verified, true);
    const { sig: otherSig, getTx: otherTx } = mk(B);
    const other = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: otherSig }], getTx: otherTx, now: NOW });
    assert.strictEqual(other.ok, true, "a different fee payer is unaffected by PAYER's cap");
  });
  await tAsync("⚠️ Codex round 16 P2-3: an unreadable first tx creates NO drop (no operator:null receipt to take over, no deferred cap) — the retry creates it with the operator and the cap charged", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig();
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig1 }], getTx: async () => { throw new Error("rpc down"); }, now: NOW });
    assert.strictEqual(r1.ok, false); assert.strictEqual(r1.status, 409); assert.strictEqual(r1.dropId, undefined);
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r2 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: sig1 }], getTx: txByMap({ [sig1]: t1 }), now: NOW + 1000 });
    assert.strictEqual(r2.ok, true); assert.strictEqual(r2.drop.operator, PAYER); assert.strictEqual(r2.results[0].verified, true);
    const day = new Date(NOW + 1000).toISOString().slice(0, 10);
    assert.deepStrictEqual(kv.get(`airdropOpDrops:${PAYER}:${day}`, []), [r2.dropId], "the cap is charged when the drop is really created");
  });
  await tAsync("⚠️ Codex round 16 P1: junk rows against a known dropId are reported, NEVER stored — the row cap cannot be filled by a stranger", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r1.ok, true);
    // A stranger with the public dropId: bad amounts, unreadable sigs, and a transfer B funded.
    const junk = [];
    for (let i = 0; i < 1500; i++) junk.push({ wallet: A, amount: "abc", sig: fakeSig() });
    for (let i = 0; i < 400; i++) junk.push({ wallet: A, amount: "1", sig: fakeSig() });
    const bSig = fakeSig();
    const tB = txPaidBy(B, { pre: [bal(B, MINT, 5_000_000_000n), bal(A, MINT, 1_000_000_000n)], post: [bal(B, MINT, 4_000_000_000n), bal(A, MINT, 2_000_000_000n)] });
    junk.push({ wallet: A, amount: "1", sig: bSig });
    const r2 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: junk, getTx: async (s) => { if (s === bSig) return tB; throw new Error("rpc down"); }, now: NOW + 1000 });
    assert.strictEqual(r2.ok, false, "nothing landed → 409, never a 200 a client could count (round 17)"); assert.strictEqual(r2.status, 409);
    assert.strictEqual(r2.results.length, junk.length, "every junk row is answered");
    assert.ok(r2.results.every((x) => x.verified === false), "and none verified");
    assert.strictEqual(Object.keys(AR.loadDrop(kv, r1.dropId).rows).length, 1, "and none was stored");
    // The operator's next real row still lands.
    const sig3 = fakeSig();
    const t3 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 4_000_000_000n), bal(B, MINT, 0n)], post: [bal(PAYER, MINT, 3_000_000_000n), bal(B, MINT, 1_000_000_000n)] });
    const r3 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: B, amount: "1", sig: sig3 }], getTx: txByMap({ [sig3]: t3 }), now: NOW + 2000 });
    assert.strictEqual(r3.ok, true); assert.strictEqual(r3.results[0].verified, true); assert.strictEqual(r3.totals.rows, 2);
  });
  await tAsync("⚠️ Codex round 16 P2-2: replaying a FAILED public transaction creates no drop and charges nobody's quota", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const failed = txPaidBy(PAYER, { err: { InstructionError: [0, "Custom"] }, pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)] });
    for (let i = 0; i < 25; i++) {
      const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: failed }), now: NOW });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 409, JSON.stringify(r));
    }
    const day = new Date(NOW).toISOString().slice(0, 10);
    assert.deepStrictEqual(kv.get(`airdropOpDrops:${PAYER}:${day}`, []), [], "no quota consumed");
    // And PAYER's own real drop still goes through afterwards.
    const good = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const ok = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig: good }], getTx: txByMap({ [good]: t1 }), now: NOW });
    assert.strictEqual(ok.ok, true);
  });
  await tAsync("⚠️ Codex round 16: a signature already on one receipt cannot start a second drop (one signature, one receipt)", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(A, MINT, 1_000_000_000n)] });
    const r1 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r1.ok, true);
    const r2 = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 1000 });
    assert.strictEqual(r2.ok, false); assert.strictEqual(r2.status, 409);
    assert.match(r2.results[0].reason, /already recorded on another receipt/);
    const day = new Date(NOW).toISOString().slice(0, 10);
    assert.deepStrictEqual(kv.get(`airdropOpDrops:${PAYER}:${day}`, []), [r1.dropId], "the replay charged no second drop");
    // Replaying it into ITS OWN receipt is the idempotent no-op it always was.
    const r3 = await AR.recordDrop({ kv, dropId: r1.dropId, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 2000 });
    assert.strictEqual(r3.ok, true); assert.strictEqual(r3.results[0].alreadyRecorded, true);
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
    const t1 = paid(A, 1_000_000_000_000n);
    const t2 = paid(B, 2_000_000_000_000n);
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
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 409, "malformed rows alone create nothing");
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
  const natTx = ({ err = null, keys = [], pre = [], post = [], blockTime, ixs = [] } = {}) => ({
    meta: { err, preBalances: pre, postBalances: post },
    transaction: { message: { accountKeys: keys, instructions: ixs } },
    blockTime: blockTime ?? Math.floor(NOW / 1000),
  });
  // The parsed SystemProgram transfer the airdropper's createSolTransferInstruction produces.
  const solIx = (from, to, lamports) => ({ programId: "11111111111111111111111111111111", program: "system", parsed: { type: "transfer", info: { source: from, destination: to, lamports } } });

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

  t("nativeSourceIsOperator: only a wallet that actually lost the lamports, through a transfer TO this recipient, counts as the funder", () => {
    const x = natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9], ixs: [solIx(PAYER, A, 1_000_000_000)] });
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: PAYER, wallet: A, minRaw: 1_000_000_000n }), true);
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: A, wallet: A, minRaw: 1_000_000_000n }), false,
      "the RECIPIENT must never read as the funder");
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: B, wallet: A, minRaw: 1n }), false,
      "a wallet not in the transaction at all is not the funder");
    assert.strictEqual(AR.nativeSourceIsOperator(x, { operator: PAYER, wallet: B, minRaw: 1n }), false,
      "the transfer must name THIS recipient (round 19)");
    const noIx = natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9] });
    assert.strictEqual(AR.nativeSourceIsOperator(noIx, { operator: PAYER, wallet: A, minRaw: 1_000_000_000n }), false,
      "a lamport delta with no parsed transfer from operator to recipient is not funding (round 19)");
  });

  await tAsync("⚠️ a SOL drop RECORDS and VERIFIES end to end — it used to die on 'bad mint'", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const getTx = txByMap({ [sig]: natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9], ixs: [solIx(PAYER, A, 1_000_000_000)] }) });
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

  await tAsync("⚠️ a SOL row the chain does not support is reported UNVERIFIED and never stored, never quietly passed", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    // B is in the transaction but gained nothing.
    const getTx = txByMap({ [sig]: natTx({ keys: [PAYER, A, B], pre: [10e9, 0, 5e9], post: [8.999995e9, 1e9, 5e9], ixs: [solIx(PAYER, A, 1_000_000_000)] }) });
    const r = await AR.recordDrop({
      kv, getTx, now: NOW, mint: NATIVE, decimals: 9, createdAt: NOW - 60_000,
      rows: [{ wallet: B, amount: "1", sig }],
    });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 409);
    assert.strictEqual(r.results[0].verified, false);
    assert.match(r.results[0].reason, /no SOL reached this wallet/);
  });

  await tAsync("⚠️ a SOL drop with an operator on record refuses a row a STRANGER funded", async () => {
    const kv = memoryKv();
    const sig1 = fakeSig(), sig2 = fakeSig();
    // sig1 establishes the drop with PAYER as operator; sig2 is funded by B instead.
    const getTx = txByMap({
      [sig1]: natTx({ keys: [PAYER, A], pre: [10e9, 0], post: [8.999995e9, 1e9], ixs: [solIx(PAYER, A, 1_000_000_000)] }),
      [sig2]: natTx({ keys: [B, A], pre: [10e9, 0], post: [8.999995e9, 1e9], ixs: [solIx(B, A, 1_000_000_000)] }),
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


  // ── Codex round 17 (re-review of round 16's head, 2026-09-22): the commit race ─────────────
  // A getTx that yields to the event loop, as a real RPC does, so two calls interleave.
  const slowTxByMap = (map) => async (sig) => { await new Promise((r) => setImmediate(r)); if (Object.prototype.hasOwnProperty.call(map, sig)) return map[sig]; throw new Error("sig not found"); };
  // lib/kvstore.js can replace `state` wholesale on refresh(), so a value read before an await
  // is a SNAPSHOT, not a live reference. memoryKv hands back the live object, which hides the
  // lost-update bug; this wrapper models the real store's behaviour.
  const snapshotKv = (kv) => ({ ...kv, get: (k, d) => { const v = kv.get(k, d); return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; } });
  const payerTx = (to, amt) => txPaidBy(PAYER, { pre: [bal(PAYER, MINT, amt * 2n), bal(to, MINT, 0n)], post: [bal(PAYER, MINT, amt), bal(to, MINT, amt)] });

  await tAsync("⚠️ round 17: the SAME signature in two concurrent calls makes ONE receipt, never two", async () => {
    const kv = snapshotKv(memoryKv());
    const sig = fakeSig();
    const getTx = slowTxByMap({ [sig]: payerTx(A, 1_000_000_000n) });
    const args = { kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx, now: NOW };
    const [r1, r2] = await Promise.all([AR.recordDrop({ ...args }), AR.recordDrop({ ...args })]);
    const oks = [r1, r2].filter((r) => r.ok);
    assert.strictEqual(oks.length, 1, "exactly one call created a drop: " + JSON.stringify([r1, r2].map((r) => [r.ok, r.status])));
    const loser = r1.ok ? r2 : r1;
    assert.strictEqual(loser.status, 409);
    assert.strictEqual(loser.results[0].reason, "already recorded on another receipt");
    assert.strictEqual(AR.receiptOfSig(kv, sig), oks[0].dropId, "the signature key names the one receipt");
    assert.strictEqual(kv.get(AR.kvKey(loser.dropId || "none"), null), null, "the loser wrote no drop");
  });
  await tAsync("⚠️ round 17: two concurrent calls with DIFFERENT signatures never erase each other's signature key — neither can be re-recorded", async () => {
    const kv = snapshotKv(memoryKv());
    const s1 = fakeSig(), s2 = fakeSig();
    const getTx = slowTxByMap({ [s1]: payerTx(A, 1_000_000_000n), [s2]: payerTx(B, 1_000_000_000n) });
    const base = { kv, mint: MINT, decimals: 9, createdAt: NOW, getTx, now: NOW };
    const [r1, r2] = await Promise.all([
      AR.recordDrop({ ...base, rows: [{ wallet: A, amount: "1", sig: s1 }] }),
      AR.recordDrop({ ...base, rows: [{ wallet: B, amount: "1", sig: s2 }] }),
    ]);
    assert.strictEqual(r1.ok, true); assert.strictEqual(r2.ok, true);
    assert.strictEqual(AR.receiptOfSig(kv, s1), r1.dropId, "s1 is still indexed after s2's write");
    assert.strictEqual(AR.receiptOfSig(kv, s2), r2.dropId);
    for (const [sig, wallet] of [[s1, A], [s2, B]]) {
      const again = await AR.recordDrop({ ...base, rows: [{ wallet, amount: "1", sig }] });
      assert.strictEqual(again.ok, false, "a recorded signature cannot start a second receipt");
      assert.strictEqual(again.results[0].reason, "already recorded on another receipt");
    }
  });
  await tAsync("⚠️ round 17: two concurrent batches of ONE drop both land — the second write does not drop the first's rows", async () => {
    const kv = snapshotKv(memoryKv());
    const s0 = fakeSig(), s1 = fakeSig(), s2 = fakeSig();
    const getTx = slowTxByMap({ [s0]: payerTx(A, 1_000_000_000n), [s1]: payerTx(A, 1_000_000_000n), [s2]: payerTx(B, 1_000_000_000n) });
    const base = { kv, mint: MINT, decimals: 9, createdAt: NOW, getTx, now: NOW };
    const r0 = await AR.recordDrop({ ...base, rows: [{ wallet: A, amount: "1", sig: s0 }] });
    assert.strictEqual(r0.ok, true);
    const [a, b] = await Promise.all([
      AR.recordDrop({ ...base, dropId: r0.dropId, rows: [{ wallet: A, amount: "1", sig: s1 }] }),
      AR.recordDrop({ ...base, dropId: r0.dropId, rows: [{ wallet: B, amount: "1", sig: s2 }] }),
    ]);
    assert.strictEqual(a.ok, true); assert.strictEqual(b.ok, true);
    const drop = AR.loadDrop(kv, r0.dropId);
    assert.deepStrictEqual(Object.keys(drop.rows).sort(), [AR.rowKey(s0, A), AR.rowKey(s1, A), AR.rowKey(s2, B)].sort(), "all three rows are on the receipt");
    for (const s of [s0, s1, s2]) assert.strictEqual(AR.receiptOfSig(kv, s), r0.dropId);
  });
  await tAsync("⚠️ round 17: an EXISTING drop answers 409 to a batch of which nothing verified — never a 200 a client could count as recorded", async () => {
    const kv = memoryKv();
    const s0 = fakeSig(), s1 = fakeSig(), s2 = fakeSig();
    const short = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n)], post: [bal(PAYER, MINT, 4_999_999_999n), bal(A, MINT, 1n)] });
    const getTx = txByMap({ [s0]: payerTx(A, 1_000_000_000n), [s1]: short });
    const base = { kv, mint: MINT, decimals: 9, createdAt: NOW, getTx, now: NOW };
    const r0 = await AR.recordDrop({ ...base, rows: [{ wallet: A, amount: "1", sig: s0 }] });
    const r1 = await AR.recordDrop({ ...base, dropId: r0.dropId, rows: [{ wallet: A, amount: "1", sig: s1 }, { wallet: B, amount: "1", sig: s2 }] });
    assert.strictEqual(r1.ok, false); assert.strictEqual(r1.status, 409);
    assert.strictEqual(r1.results.length, 2);
    assert.match(r1.results[0].reason, /smaller than the amount owed/);
    assert.match(r1.results[1].reason, /could not read the chain/);
    assert.strictEqual(Object.keys(AR.loadDrop(kv, r0.dropId).rows).length, 1);
    // A retry whose rows are ALL already on the receipt is still the idempotent success.
    const r2 = await AR.recordDrop({ ...base, dropId: r0.dropId, rows: [{ wallet: A, amount: "1", sig: s0 }] });
    assert.strictEqual(r2.ok, true); assert.strictEqual(r2.nothingNew, true);
    assert.deepStrictEqual(r2.totals, { rows: 1, verified: 1, stored: 0, alreadyRecorded: 1, refused: 0 });
  });
  await tAsync("⚠️ round 17: totals say what LANDED — a mixed batch reports stored / alreadyRecorded / refused, in input order, one result per input row", async () => {
    const kv = memoryKv();
    const s0 = fakeSig(), s1 = fakeSig(), s2 = fakeSig();
    const getTx = txByMap({ [s0]: payerTx(A, 1_000_000_000n), [s1]: payerTx(B, 1_000_000_000n) });
    const base = { kv, mint: MINT, decimals: 9, createdAt: NOW, getTx, now: NOW };
    const r0 = await AR.recordDrop({ ...base, rows: [{ wallet: A, amount: "1", sig: s0 }] });
    // s0 again (already on), s1 new (lands), s2 unreadable (refused), s1 AGAIN in the same call (a duplicate row).
    const r1 = await AR.recordDrop({ ...base, dropId: r0.dropId, rows: [
      { wallet: A, amount: "1", sig: s0 }, { wallet: B, amount: "1", sig: s1 }, { wallet: B, amount: "1", sig: s2 }, { wallet: B, amount: "1", sig: s1 },
    ] });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.results.length, 4);
    assert.strictEqual(r1.results[0].alreadyRecorded, true);
    assert.strictEqual(r1.results[1].verified, true); assert.ok(!r1.results[1].alreadyRecorded);
    assert.strictEqual(r1.results[2].verified, false);
    assert.strictEqual(r1.results[3].verified, true); assert.strictEqual(r1.results[3].duplicateInCall, true);
    assert.deepStrictEqual(r1.totals, { rows: 2, verified: 2, stored: 1, alreadyRecorded: 2, refused: 1 });
    assert.strictEqual(r1.results.filter((x) => x.verified).length, 3, "a client counting verified results counts the three rows that are on the receipt");
  });
  await tAsync("round 17: no signature ever lands in one big index object — only per-signature keys", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: payerTx(A, 1_000_000_000n) }), now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(kv.get("airdropReceiptSigIndex", null), null, "the round-16 whole-object index is gone");
    assert.strictEqual(kv.get(AR.sigKey(sig), null), r.dropId);
  });


  // ── Codex round 18 (re-review of 72b4d48): row identity, the quota under concurrency ───────
  await tAsync("⚠️ round 18 P1: ONE transaction pays A and B → TWO rows on the receipt, each verified under its own wallet, one signature key", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    // The airdropper's real shape: one signed batch, many recipients, the operator down by the sum.
    const batch = txPaidBy(PAYER, { pre: [bal(PAYER, MINT, 5_000_000_000n), bal(A, MINT, 0n), bal(B, MINT, 0n)], post: [bal(PAYER, MINT, 3_000_000_000n), bal(A, MINT, 1_000_000_000n), bal(B, MINT, 1_000_000_000n)] });
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }, { wallet: B, amount: "1", sig }], getTx: txByMap({ [sig]: batch }), now: NOW });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.results.map((x) => [x.wallet, x.verified, !!x.alreadyRecorded]), [[A, true, false], [B, true, false]], "both recipients, in order, neither a duplicate");
    const drop = AR.loadDrop(kv, r.dropId);
    assert.strictEqual(Object.keys(drop.rows).length, 2);
    assert.strictEqual(AR.rowOnDrop(drop, sig, A).wallet, A); assert.strictEqual(AR.rowOnDrop(drop, sig, B).wallet, B);
    assert.deepStrictEqual(r.totals, { rows: 2, verified: 2, stored: 2, alreadyRecorded: 0, refused: 0 });
    assert.strictEqual(AR.receiptOfSig(kv, sig), r.dropId, "the transaction is owned by this one receipt");
    assert.strictEqual(AR.publicDrop(drop).count, 2); assert.strictEqual(AR.publicDrop(drop).total, "2");
    // The same batch posted again: both rows already recorded, nothing new, still a success.
    const again = await AR.recordDrop({ kv, dropId: r.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }, { wallet: B, amount: "1", sig }], getTx: txByMap({ [sig]: batch }), now: NOW + 1000 });
    assert.strictEqual(again.ok, true); assert.strictEqual(again.nothingNew, true);
    assert.deepStrictEqual(again.totals, { rows: 2, verified: 2, stored: 0, alreadyRecorded: 2, refused: 0 });
    // A third "recipient" of the same signature that the chain does NOT show paid is refused, the two stay.
    const r3 = await AR.recordDrop({ kv, dropId: r.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: PAYER, amount: "1", sig }], getTx: txByMap({ [sig]: batch }), now: NOW + 2000 });
    assert.strictEqual(r3.ok, false); assert.strictEqual(r3.status, 409); assert.strictEqual(Object.keys(AR.loadDrop(kv, r.dropId).rows).length, 2);
  });
  await tAsync("⚠️ round 18 P2: the daily cap holds under concurrency — from 19, two overlapping first-row calls make 20, never 21", async () => {
    const kv = snapshotKv(memoryKv());
    const day = new Date(NOW).toISOString().slice(0, 10);
    kv.set(`airdropOpDrops:${PAYER}:${day}`, Array.from({ length: 19 }, (_, i) => "seed" + i));
    const s1 = fakeSig(), s2 = fakeSig();
    const getTx = slowTxByMap({ [s1]: payerTx(A, 1_000_000_000n), [s2]: payerTx(B, 1_000_000_000n) });
    const base = { kv, mint: MINT, decimals: 9, createdAt: NOW, getTx, now: NOW };
    const [r1, r2] = await Promise.all([
      AR.recordDrop({ ...base, rows: [{ wallet: A, amount: "1", sig: s1 }] }),
      AR.recordDrop({ ...base, rows: [{ wallet: B, amount: "1", sig: s2 }] }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    assert.strictEqual(oks.length, 1, JSON.stringify([r1, r2].map((r) => [r.ok, r.status])));
    const loser = r1.ok ? r2 : r1;
    assert.strictEqual(loser.status, 429);
    assert.strictEqual(kv.get(`airdropOpDrops:${PAYER}:${day}`, []).length, 20, "exactly the cap, never over it");
    assert.strictEqual(loser.dropId, undefined);
    // Same with the operator PASSED (the route's normal case since round 18).
    const kv2 = snapshotKv(memoryKv());
    kv2.set(`airdropOpDrops:${PAYER}:${day}`, Array.from({ length: 19 }, (_, i) => "seed" + i));
    const [q1, q2] = await Promise.all([
      AR.recordDrop({ ...base, kv: kv2, operator: PAYER, rows: [{ wallet: A, amount: "1", sig: s1 }] }),
      AR.recordDrop({ ...base, kv: kv2, operator: PAYER, rows: [{ wallet: B, amount: "1", sig: s2 }] }),
    ]);
    assert.strictEqual([q1, q2].filter((r) => r.ok).length, 1);
    assert.strictEqual(kv2.get(`airdropOpDrops:${PAYER}:${day}`, []).length, 20);
  });
  await tAsync("round 18: a row stored before this change under the bare signature is still recognised — a retry never stores it twice", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: payerTx(A, 1_000_000_000n) }), now: NOW });
    // Rewrite the stored row the way rounds 15–17 keyed it.
    const drop = AR.loadDrop(kv, r.dropId);
    const row = drop.rows[AR.rowKey(sig, A)]; delete drop.rows[AR.rowKey(sig, A)]; drop.rows[sig] = row; kv.set(AR.kvKey(r.dropId), drop);
    const again = await AR.recordDrop({ kv, dropId: r.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: payerTx(A, 1_000_000_000n) }), now: NOW + 1000 });
    assert.strictEqual(again.ok, true); assert.strictEqual(again.results[0].alreadyRecorded, true);
    assert.strictEqual(Object.keys(AR.loadDrop(kv, r.dropId).rows).length, 1, "one row, under the legacy key, not two");
  });
  await tAsync("⚠️ round 18 P2: with the operator PROVEN by the caller, a stranger's earlier claim of the operator's transfer cannot exist — an existing drop refuses a different operator, and the operator's own receipt records the transfer", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const tx = payerTx(A, 1_000_000_000n);
    // The stranger presents PAYER's transfer with THEIR proven wallet (B): the transfer was not funded by B → refused, no drop.
    const stranger = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: B, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: tx }), now: NOW });
    assert.strictEqual(stranger.ok, false); assert.strictEqual(stranger.status, 409);
    assert.strictEqual(stranger.results[0].reason, AR.SOURCE_MISMATCH_REASON);
    assert.strictEqual(AR.receiptOfSig(kv, sig), null, "the signature was not claimed");
    // The operator records it on their own receipt.
    const own = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: tx }), now: NOW + 1000 });
    assert.strictEqual(own.ok, true); assert.strictEqual(AR.receiptOfSig(kv, sig), own.dropId);
    // And the stranger cannot append to it either.
    const append = await AR.recordDrop({ kv, dropId: own.dropId, mint: MINT, decimals: 9, createdAt: NOW, operator: B, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: tx }), now: NOW + 2000 });
    assert.strictEqual(append.ok, false); assert.strictEqual(append.status, 403);
  });


  // ── Codex round 19 (re-review of ede8756): funding attribution ──────────────────────────────
  await tAsync("⚠️ round 19 P2: a signed wallet X that moved an UNRELATED token in the transaction where Y paid A cannot claim A's row — only Y can", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    // One transaction: X sends OTHER_MINT somewhere (X is a transfer authority in it), Y sends MINT to A.
    const X = B, Y = PAYER;
    const t1 = {
      meta: { err: null,
        preTokenBalances: [
          { accountIndex: 0, owner: X, mint: OTHER_MINT, uiTokenAmount: { amount: "9000000000" } },
          { accountIndex: 1, owner: Y, mint: MINT, uiTokenAmount: { amount: "5000000000" } },
          { accountIndex: 2, owner: A, mint: MINT, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 0, owner: X, mint: OTHER_MINT, uiTokenAmount: { amount: "8000000000" } },
          { accountIndex: 1, owner: Y, mint: MINT, uiTokenAmount: { amount: "4000000000" } },
          { accountIndex: 2, owner: A, mint: MINT, uiTokenAmount: { amount: "1000000000" } },
        ] },
      transaction: { message: { accountKeys: [X, Y, A, "11111111111111111111111111111111"], instructions: [
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transfer", info: { source: X, destination: "11111111111111111111111111111111", authority: X, amount: "1000000000" } } },
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: Y, destination: A, authority: Y, mint: MINT, tokenAmount: { amount: "1000000000" } } } },
      ] } },
      blockTime: Math.floor(NOW / 1000),
    };
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: X, wallet: A, minRaw: 1_000_000_000n }), false, "X's authority over an unrelated transfer is not funding");
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: Y, wallet: A, minRaw: 1_000_000_000n }), true);
    const asX = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: X, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(asX.ok, false); assert.strictEqual(asX.status, 409); assert.strictEqual(asX.results[0].reason, AR.SOURCE_MISMATCH_REASON);
    assert.strictEqual(AR.receiptOfSig(kv, sig), null, "X claimed nothing");
    const asY = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: Y, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 1000 });
    assert.strictEqual(asY.ok, true); assert.strictEqual(AR.receiptOfSig(kv, sig), asY.dropId);
  });
  await tAsync("⚠️ round 19 P2 (native): a FEE PAYER X in the transaction where Y sent SOL to A cannot claim A's row, however small the claim", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const X = B, Y = PAYER;
    // X pays the 5,000-lamport fee; Y sends 1,000 lamports to A. X's lamports went down by more than the claim.
    const t1 = natTx({ keys: [X, Y, A], pre: [1e9, 1e9, 0], post: [1e9 - 5000, 1e9 - 1000, 1000], ixs: [solIx(Y, A, 1000)] });
    assert.strictEqual(AR.nativeSourceIsOperator(t1, { operator: X, wallet: A, minRaw: 1000n }), false);
    assert.strictEqual(AR.nativeSourceIsOperator(t1, { operator: X, wallet: A, minRaw: 1n }), false, "the old delta-only rule passed this");
    assert.strictEqual(AR.nativeSourceIsOperator(t1, { operator: Y, wallet: A, minRaw: 1000n }), true);
    const asX = await AR.recordDrop({ kv, mint: AR.NATIVE_MINT, decimals: 9, createdAt: NOW, operator: X, rows: [{ wallet: A, amount: "0.000001", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(asX.ok, false); assert.strictEqual(asX.results[0].reason, AR.SOURCE_MISMATCH_REASON);
    const asY = await AR.recordDrop({ kv, mint: AR.NATIVE_MINT, decimals: 9, createdAt: NOW, operator: Y, rows: [{ wallet: A, amount: "0.000001", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 1000 });
    assert.strictEqual(asY.ok, true);
  });
  await tAsync("round 19: a delegate moving the operator's tokens still counts as the operator's funding (the operator's own account drains)", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const DELEGATE = B;
    const t1 = {
      meta: { err: null,
        preTokenBalances: [{ accountIndex: 0, owner: PAYER, mint: MINT, uiTokenAmount: { amount: "5000000000" } }, { accountIndex: 1, owner: A, mint: MINT, uiTokenAmount: { amount: "0" } }],
        postTokenBalances: [{ accountIndex: 0, owner: PAYER, mint: MINT, uiTokenAmount: { amount: "4000000000" } }, { accountIndex: 1, owner: A, mint: MINT, uiTokenAmount: { amount: "1000000000" } }] },
      transaction: { message: { accountKeys: [PAYER, A, DELEGATE], instructions: [
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: PAYER, destination: A, authority: DELEGATE, mint: MINT, tokenAmount: { amount: "1000000000" } } } },
      ] } },
      blockTime: Math.floor(NOW / 1000),
    };
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.results[0].verified, true);
    const asDelegate = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: DELEGATE, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 1000 });
    assert.strictEqual(asDelegate.ok, false, "the delegate's authority alone is not funding — its balance did not move");
  });


  // ── Codex round 20 (re-review of e0400d0): the funding evidence must name THIS recipient ─────
  await tAsync("⚠️ round 20 P2: in ONE transaction X pays B and Y pays A, the same mint — X cannot record A's row, Y can; and X can record B's", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const X = B, Y = PAYER;
    const C = "GMUYqTwgDeR9CxE7Pp49um76n7zu98iA2tTNYsY47phb"; // a fourth wallet
    // X → C (1 token), Y → A (1 token), both MINT. X really lost the mint — but to C, not to A.
    const t1 = {
      meta: { err: null,
        preTokenBalances: [
          { accountIndex: 0, owner: X, mint: MINT, uiTokenAmount: { amount: "5000000000" } },
          { accountIndex: 1, owner: Y, mint: MINT, uiTokenAmount: { amount: "5000000000" } },
          { accountIndex: 2, owner: A, mint: MINT, uiTokenAmount: { amount: "0" } },
          { accountIndex: 3, owner: C, mint: MINT, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 0, owner: X, mint: MINT, uiTokenAmount: { amount: "4000000000" } },
          { accountIndex: 1, owner: Y, mint: MINT, uiTokenAmount: { amount: "4000000000" } },
          { accountIndex: 2, owner: A, mint: MINT, uiTokenAmount: { amount: "1000000000" } },
          { accountIndex: 3, owner: C, mint: MINT, uiTokenAmount: { amount: "1000000000" } },
        ] },
      transaction: { message: { accountKeys: [X, Y, A, C], instructions: [
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: X, destination: C, authority: X, mint: MINT, tokenAmount: { amount: "1000000000" } } } },
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: Y, destination: A, authority: Y, mint: MINT, tokenAmount: { amount: "1000000000" } } } },
      ] } },
      blockTime: Math.floor(NOW / 1000),
    };
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: X, wallet: A, minRaw: 1_000_000_000n }), false, "X lost the mint, but not to A");
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: Y, wallet: A, minRaw: 1_000_000_000n }), true);
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: X, wallet: C, minRaw: 1_000_000_000n }), true, "X did pay C");
    const asX = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: X, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(asX.ok, false); assert.strictEqual(asX.results[0].reason, AR.SOURCE_MISMATCH_REASON);
    assert.strictEqual(AR.receiptOfSig(kv, sig), null, "X claimed nothing");
    const asY = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: Y, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 1000 });
    assert.strictEqual(asY.ok, true); assert.strictEqual(AR.receiptOfSig(kv, sig), asY.dropId);
    // The signature now belongs to Y's receipt; X's own real row (X → C) in the same transaction
    // is refused as "already recorded on another receipt" — one signature, one receipt is the
    // ownership rule, unchanged. X's row is true on-chain; it is simply not on X's receipt.
    const xOwn = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: X, rows: [{ wallet: C, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW + 2000 });
    assert.strictEqual(xOwn.ok, false); assert.strictEqual(xOwn.results[0].reason, "already recorded on another receipt");
  });
  await tAsync("round 20: a transfer of the right mint and amount from the operator to the WRONG recipient, or of a different amount, is not funding for this row", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = tx({ pre: [bal(PAYER, MINT, 5_000_000_000n), bal(B, MINT, 0n)], post: [bal(PAYER, MINT, 4_000_000_000n), bal(B, MINT, 1_000_000_000n)] });
    // The row claims A, the chain shows PAYER → B. rowPaidBy refuses first (A is not in the tx).
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.results[0].verified, false);
    // And directly: the bound check refuses the wrong recipient and an under-sized transfer.
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: PAYER, wallet: A, minRaw: 1_000_000_000n }), false);
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: PAYER, wallet: B, minRaw: 1_000_000_001n }), false);
    assert.strictEqual(AR.sourceIsOperator(t1, { mint: MINT, operator: PAYER, wallet: B, minRaw: 1_000_000_000n }), true);
  });
  await tAsync("round 20: the recipient's token account created in the same transaction (no pre row) still binds — post rows are read first", async () => {
    const kv = memoryKv();
    const sig = fakeSig();
    const t1 = {
      meta: { err: null,
        preTokenBalances: [{ accountIndex: 0, owner: PAYER, mint: MINT, uiTokenAmount: { amount: "5000000000" } }],
        postTokenBalances: [{ accountIndex: 0, owner: PAYER, mint: MINT, uiTokenAmount: { amount: "4000000000" } }, { accountIndex: 1, owner: A, mint: MINT, uiTokenAmount: { amount: "1000000000" } }] },
      transaction: { message: { accountKeys: [PAYER, A], instructions: [
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked", info: { source: PAYER, destination: A, authority: PAYER, mint: MINT, tokenAmount: { amount: "1000000000" } } } },
      ] } },
      blockTime: Math.floor(NOW / 1000),
    };
    const r = await AR.recordDrop({ kv, mint: MINT, decimals: 9, createdAt: NOW, operator: PAYER, rows: [{ wallet: A, amount: "1", sig }], getTx: txByMap({ [sig]: t1 }), now: NOW });
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(r.results[0].verified, true);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
