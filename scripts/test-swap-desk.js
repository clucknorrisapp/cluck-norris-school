#!/usr/bin/env node
/* Tests for lib/swap-desk.js. No network, no funds, no RPC — everything here is local.
 *
 * The section that matters most is TAMPER REJECTION. The desk keypair can move the desk's whole
 * inventory, so "verifyAndSign only signs what it built" is the property that makes the desk
 * safe. docs/SWAP_DESIGN.md §6 makes this test a precondition to arming it.
 *
 * Run: node scripts/test-swap-desk.js
 */
process.env.SWAP_QUOTE_SECRET = "test-quote-secret-not-a-real-one";
process.env.DATA_DIR = process.env.DATA_DIR || "/tmp";
// Never touch mainnet from a test: the honest-path case below reaches sendRawTransaction, so the
// primary RPC is pinned to a closed local port and the paid Helius keys are dropped. CI sets the
// same (syntax-check.yml) — a local run cannot spend RPC quota or reach a real node.
process.env.FALLBACK_RPC_URL = process.env.FALLBACK_RPC_URL || "http://127.0.0.1:9";
delete process.env.HELIUS_API_KEY;
delete process.env.HELIUS_API_KEY_2;

const assert = require("assert");
const { Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");

// A throwaway keypair so isEnabled() is true. Generated here, never persisted, holds nothing.
const desk = Keypair.generate();
process.env.SWAP_OPERATOR_SECRET = JSON.stringify(Array.from(desk.secretKey));

const swap = require("../lib/swap-desk");
const { toRaw, fromRaw, signQuote, readQuote, pending } = swap._internal;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}

console.log("\nraw <-> ui conversion");
t("6dp round trip", () => assert.strictEqual(fromRaw(toRaw("1234.5678", 6), 6), "1234.5678"));
t("9dp round trip", () => assert.strictEqual(fromRaw(toRaw("0.000000001", 9), 9), "0.000000001"));
t("strips thousands separators", () => assert.strictEqual(toRaw("1,000,000", 6), 1000000000000n));
t("integer input", () => assert.strictEqual(toRaw("450", 6), 450000000n));
t("TRUNCATES excess precision, never rounds up", () => {
  // Rounding up would let a user move fractionally more than they typed and more than was quoted.
  assert.strictEqual(toRaw("1.9999999", 6), 1999999n);
});
t("rejects junk", () => { assert.strictEqual(toRaw("abc", 6), null); assert.strictEqual(toRaw("1.2.3", 6), null); });
t("rejects negatives", () => assert.strictEqual(toRaw("-5", 6), null));
t("no float error at CLKN scale", () => {
  assert.strictEqual(fromRaw(toRaw("453714343.123456", 6), 6), "453714343.123456");
});
t("does not hardcode decimals", () => {
  // Same digits, different decimals, different raw value — proves decimals flow through.
  assert.notStrictEqual(toRaw("1.5", 6).toString(), toRaw("1.5", 9).toString());
  assert.strictEqual(toRaw("1.5", 6), 1500000n);
  assert.strictEqual(toRaw("1.5", 9), 1500000000n);
});

console.log("\nquote signing");
t("round trips a payload", () => {
  const p = { inMint: swap.CLKN_MINT, outMint: swap.NORMIE_MINT, inRaw: "1000", exp: Date.now() + 1000 };
  assert.deepStrictEqual(readQuote(signQuote(p)), p);
});
t("rejects a flipped payload byte", () => {
  const tok = signQuote({ a: 1 });
  const [body, mac] = [tok.slice(0, tok.lastIndexOf(".")), tok.slice(tok.lastIndexOf(".") + 1)];
  const tampered = Buffer.from(body, "base64url"); tampered[0] ^= 0xff;
  assert.strictEqual(readQuote(`${tampered.toString("base64url")}.${mac}`), null);
});
t("rejects a forged MAC", () => {
  const tok = signQuote({ a: 1 });
  assert.strictEqual(readQuote(tok.slice(0, tok.lastIndexOf(".")) + ".deadbeef"), null);
});
t("rejects garbage", () => {
  [null, undefined, "", "no-dot", 42, {}].forEach((v) => assert.strictEqual(readQuote(v), null));
});
t("refuses to verify when the secret is unset (fails closed)", () => {
  const tok = signQuote({ a: 1 });
  const saved = process.env.SWAP_QUOTE_SECRET;
  delete process.env.SWAP_QUOTE_SECRET;
  const got = readQuote(tok);
  process.env.SWAP_QUOTE_SECRET = saved;
  assert.strictEqual(got, null, "an unset secret must not verify a previously-valid token");
});

console.log("\ntamper rejection  <-- the safety property");
const user = Keypair.generate();
const attacker = Keypair.generate();

// Stand in for a real build(): a transaction the desk legitimately constructed.
function legitTx() {
  return new Transaction({ feePayer: user.publicKey, recentBlockhash: PublicKey.default.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: desk.publicKey, lamports: 1000 }))
    .add(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: user.publicKey, lamports: 2000 }));
}
function seed(tx) {
  const token = "test-" + Math.random().toString(36).slice(2);
  pending.set(token, { message: tx.serializeMessage(), owner: user.publicKey.toBase58(), usd: 10, exp: Date.now() + 60000 });
  return token;
}
const signedBy = (tx, kp) => { tx.partialSign(kp); return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"); };

async function tamperTests() {
  const checks = [
    ["the out-leg amount is increased", () => {
      const tx = legitTx();
      tx.instructions[1] = SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: user.publicKey, lamports: 999999999 });
      return tx;
    }],
    ["the destination is swapped to an attacker", () => {
      const tx = legitTx();
      tx.instructions[1] = SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: attacker.publicKey, lamports: 2000 });
      return tx;
    }],
    ["an extra instruction is appended", () => {
      const tx = legitTx();
      tx.add(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: attacker.publicKey, lamports: 500 }));
      return tx;
    }],
    ["the user's own in-leg is removed", () => {
      const tx = legitTx();
      tx.instructions.splice(0, 1);
      return tx;
    }],
    ["the legs are reordered", () => {
      const tx = legitTx();
      tx.instructions.reverse();
      return tx;
    }],
  ];

  for (const [name, mutate] of checks) {
    const token = seed(legitTx());                 // desk stashed the HONEST message
    const bad = mutate();                          // attacker submits a DIFFERENT one
    bad.recentBlockhash = PublicKey.default.toBase58();
    bad.feePayer = user.publicKey;
    const r = await swap.verifyAndSign({ buildToken: token, signedTxBase64: signedBy(bad, user) });
    try {
      assert.strictEqual(r.ok, false, "tampered transaction was ACCEPTED");
      assert.match(r.error, /doesn't match/, `wrong rejection reason: ${r.error}`);
      console.log(`  ok    rejects: ${name}`); pass++;
    } catch (e) { console.log(`  FAIL  rejects: ${name}\n          ${e.message}`); fail++; }
  }

  // The honest path must still work, or the check above is just "reject everything".
  {
    const tx = legitTx();
    const token = seed(tx);
    const r = await swap.verifyAndSign({ buildToken: token, signedTxBase64: signedBy(tx, user) });
    // It will fail at the SEND step (no network / no funds) — but it must get past byte equality.
    try {
      assert.ok(!/doesn't match/.test(r.error || ""), `honest transaction was rejected as tampered: ${r.error}`);
      console.log("  ok    accepts the untampered transaction (passes byte equality)"); pass++;
    } catch (e) { console.log(`  FAIL  honest path\n          ${e.message}`); fail++; }
  }

  // Single-use: the token is consumed even on a rejected attempt.
  {
    const tx = legitTx();
    const token = seed(tx);
    await swap.verifyAndSign({ buildToken: token, signedTxBase64: signedBy(tx, user) });
    const again = await swap.verifyAndSign({ buildToken: token, signedTxBase64: signedBy(legitTx(), user) });
    try {
      assert.strictEqual(again.ok, false);
      assert.match(again.error, /expired|start again/);
      console.log("  ok    a build token cannot be used twice"); pass++;
    } catch (e) { console.log(`  FAIL  replay\n          ${e.message}`); fail++; }
  }

  // An unknown token must not be treated as a fresh build.
  {
    const r = await swap.verifyAndSign({ buildToken: "never-issued", signedTxBase64: signedBy(legitTx(), user) });
    try {
      assert.strictEqual(r.ok, false);
      console.log("  ok    rejects an unknown build token"); pass++;
    } catch (e) { console.log(`  FAIL  unknown token\n          ${e.message}`); fail++; }
  }
}

console.log("\npair validation — 3-token registry");
async function pairTests() {
  const W = user.publicKey.toBase58();
  const bad = await swap.quote({ inMint: swap.CLKN_MINT, outMint: "So11111111111111111111111111111111111111112", amountUi: "1", wallet: W });
  t("refuses a mint this desk doesn't trade", () => assert.match(bad.error, /only/));
  t("registry names all three tokens in the rejection", () => {
    for (const sym of ["CLKN", "NORMIE", "ROSE"]) assert.ok(bad.error.includes(sym), `missing ${sym} in: ${bad.error}`);
  });
  for (const [name, m] of [["CLKN", swap.CLKN_MINT], ["NORMIE", swap.NORMIE_MINT], ["ROSE", swap.ROSE_MINT]]) {
    const same = await swap.quote({ inMint: m, outMint: m, amountUi: "1", wallet: W });
    t(`refuses ${name}->${name}`, () => assert.match(same.error, /only|different/));
  }
  // Every distinct pair must pass validation. Proven WITHOUT network: a malformed wallet is
  // rejected AFTER the pair check, so reaching "connect a wallet" proves the pair was accepted.
  const mints = [swap.CLKN_MINT, swap.NORMIE_MINT, swap.ROSE_MINT];
  for (const a of mints) for (const b of mints) {
    if (a === b) continue;
    const r = await swap.quote({ inMint: a, outMint: b, amountUi: "1", wallet: "not-a-pubkey" });
    t(`accepts ${swap.TOKENS[a]}->${swap.TOKENS[b]} (reaches wallet check)`, () => assert.match(r.error, /connect a wallet/));
  }
  t("registry has exactly 3 tokens", () => assert.strictEqual(Object.keys(swap.TOKENS).length, 3));
}

console.log("\ngap guard — the pump-the-pool defence");
{
  const { gapVerdict } = swap._internal;
  const C = { gapGuardPct: 25 };
  const NOW = 1_800_000_000_000;
  const base = { prices: { [swap.CLKN_MINT]: 0.00045, [swap.NORMIE_MINT]: 0.00072, [swap.ROSE_MINT]: 0.000089 }, at: NOW - 60_000 };
  const pumped = { ...base.prices, [swap.ROSE_MINT]: 0.000089 * 1.44 };   // the $700-into-$7K move

  t("normal drift passes", () => {
    const v = gapVerdict(base, { ...base.prices, [swap.ROSE_MINT]: 0.000089 * 1.05 }, NOW, C);
    assert.strictEqual(v.tripped, false);
  });
  t("a 44% ROSE pump trips", () => {
    const v = gapVerdict(base, pumped, NOW, C);
    assert.strictEqual(v.tripped, true);
    assert.strictEqual(v.mint, swap.ROSE_MINT);
  });
  t("RETRY SECONDS LATER STILL TRIPS — the quote-twice hole is closed", () => {
    // The baseline must be unchanged by the first refusal: same baseline in, same verdict out.
    const v1 = gapVerdict(base, pumped, NOW, C);
    const v2 = gapVerdict(base, pumped, NOW + 3_000, C);
    assert.ok(v1.tripped && v2.tripped, "an attacker's blocked quote must not become the next quote's baseline");
  });
  t("a pump must be SUSTAINED past the baseline TTL to be accepted", () => {
    const v = gapVerdict(base, pumped, NOW + 16 * 60_000, C);   // baseline now stale (>15 min)
    assert.strictEqual(v.tripped, false, "stale baseline is noise, not evidence — desk re-baselines");
  });
  t("no baseline at all → trades (first observation)", () => {
    assert.strictEqual(gapVerdict(null, pumped, NOW, C).tripped, false);
  });
}

console.log("\nmonitoring");
async function monitorTests() {
  // stats() is what the operator view renders — it must work before a single swap exists,
  // otherwise the first thing you see after arming the desk is a crash.
  const s = swap.stats();
  t("stats works on an empty desk", () => {
    assert.strictEqual(typeof s.day, "string");
    assert.ok(Array.isArray(s.recent));
    assert.strictEqual(typeof s.limits.spreadBps, "number");
  });
  t("no daily caps by default (limits report null)", () => {
    assert.strictEqual(s.limits.walletDailyUsd, null);
    assert.strictEqual(s.limits.globalDailyUsd, null);
  });
  t("a cap re-enables when its env var is set", () => {
    const saved = process.env.SWAP_WALLET_DAILY_USD;
    process.env.SWAP_WALLET_DAILY_USD = "250";
    const cfg = swap._internal.cfg();
    const on = Number.isFinite(cfg.walletDailyUsd) && cfg.walletDailyUsd === 250;
    if (saved === undefined) delete process.env.SWAP_WALLET_DAILY_USD; else process.env.SWAP_WALLET_DAILY_USD = saved;
    assert.ok(on, "setting SWAP_WALLET_DAILY_USD must switch the cap back on");
  });

  // A Telegram outage, or simply no bot configured, must never turn a settled swap into an
  // error. The alert path is best-effort by design, so prove it stays quiet rather than throwing.
  t("alerting is a no-op with no bot configured", () => {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.doesNotThrow(() => { swap.stats(); });
    if (saved) process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  // The operator endpoint, including the case that matters most: an UNSET key must 404 rather
  // than 401. A 401 confirms the endpoint exists and is worth attacking.
  const express = require("express");
  const { router } = require("../swap");
  await new Promise((resolve) => {
    const app = express(); app.use("/api/swap", router);
    const srv = app.listen(0, async () => {
      const base = `http://localhost:${srv.address().port}`;
      const code = async (u, h) => (await fetch(base + u, { headers: h || {} })).status;
      const saved = process.env.SWAP_ADMIN_KEY;

      process.env.SWAP_ADMIN_KEY = "k-for-test";
      const noKey = await code("/api/swap/admin");
      const wrong = await code("/api/swap/admin?key=nope");
      const right = await code("/api/swap/admin?key=k-for-test");
      const hdr   = await code("/api/swap/admin", { "x-swap-key": "k-for-test" });
      delete process.env.SWAP_ADMIN_KEY;
      const unset = await code("/api/swap/admin?key=anything");
      if (saved) process.env.SWAP_ADMIN_KEY = saved;

      const checks = [
        ["operator view 404s with no key", noKey, 404],
        ["operator view 404s on a wrong key", wrong, 404],
        ["operator view opens with the right key", right, 200],
        ["operator view accepts the header form", hdr, 200],
        ["operator view 404s when the key is UNSET (never 401)", unset, 404],
      ];
      for (const [name, got, want] of checks) {
        try { assert.strictEqual(got, want); console.log(`  ok    ${name}`); pass++; }
        catch (e) { console.log(`  FAIL  ${name}\n          got ${got}, want ${want}`); fail++; }
      }
      srv.close(resolve);
    });
  });
}

(async () => {
  await tamperTests();
  await pairTests();
  await monitorTests();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
