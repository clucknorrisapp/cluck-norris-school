#!/usr/bin/env node
"use strict";
// Versioned-transaction (v0) support in the Seeker app's ONE signing seam — Part A of
// docs/SEEKER_SWAP_DESIGN.md's "the one technical gap" table. Jupiter's swap endpoint always
// returns a v0 VersionedTransaction (address lookup tables; every multi-hop route — SKR and CLKN
// from most inputs — needs them), and the seam (src/seeker/sign.js + public/cluck-wallet.js's
// asTransaction) was built only against legacy Transactions. Before this file's changes:
//   - messageBytes(tx) called tx.compileMessage(), which does not exist on a VersionedTransaction
//     and threw → caught → returned null. sameBytes(null, anything) is false, so EVERY v0 swap
//     would have failed the byte-diff (protection 4 in sign.js) as "the wallet returned a
//     different transaction than the one you approved" even for an honest wallet.
//   - signatureOf(tx) read tx.signatures[0].signature, which is undefined on a v0 tx (its
//     signatures are raw Uint8Array entries, not {publicKey, signature} objects) → always null,
//     silently losing protection 5 (recovering the local signature after a transport failure).
//   - asTransaction(signed, original) always ran signed bytes through the LEGACY
//     Transaction.from(...) path, which does not throw on v0 bytes — it corrupts the message.
//
// ⚠️ Codex round 27 P1 — fixed: signSendConfirm's byte diff (protection 4) used to compute
// messageBytes(tx) AFTER provider.signTransaction(tx) had already run. A wallet that mutates the
// SAME transaction object in place (legally possible — nothing requires a wallet to return a
// distinct copy) rather than returning a new signed object was therefore diffed against ITSELF,
// post-mutation, and passed every time — reproduced on both the legacy and v0 paths. Fixed by
// capturing an independent byte COPY of the approved message (`Uint8Array.from(messageBytes(tx))`)
// BEFORE the wallet is ever called, and diffing against that copy, never a live re-read of `tx`.
// The same bug, same fix, applies to src/seeker/reclaim-sign.js's own batch-level diff. Section 7
// below drives signSendConfirm end-to-end with a fake wallet that mutates in place, for both tx
// shapes, plus a sanity pass proving an honest wallet still succeeds.
//
// What this test proves instead:
//   1. messageBytes/sameBytes/signatureOf work correctly on a REAL v0 VersionedTransaction built
//      with @solana/web3.js in Node (TransactionMessage → compileToV0Message → VersionedTransaction),
//      signed with a throwaway Keypair — no network, no real wallet, no live RPC.
//   2. asTransaction (public/cluck-wallet.js, loaded into THIS process's real global with
//      vm.runInThisContext rather than a separate vm sandbox — see the note below) returns a
//      VersionedTransaction for every shape a wallet can hand back (instance, Uint8Array,
//      ArrayBuffer-backed view, bare ArrayBuffer, foreign-web3 object with .serialize(), the
//      {signedTransaction} wrapper) when the ORIGINAL was v0, and throws a readable error for the
//      bare {signatures:[...]} graft (that shape only makes sense against a legacy Transaction's
//      per-signer-slot array — a v0 message has none).
//   3. The LEGACY branch of every function above is unchanged, pinned byte-for-byte against a real
//      legacy Transaction built with the same instructions — Firepit, Project Burn, Rent Reclaim,
//      the Locker Room and the Airdropper all sign legacy transactions through these same helpers
//      and must not regress.
//   4. A negative: a v0 whose message bytes were altered after signing fails sameBytes, so a
//      substituted transaction is still caught for v0 exactly as it is for legacy.
//
// Not touched, and not tested here beyond a source-level note (design's own §4 of the gap table):
// submitSigned() and txToBytes()/txFromBytes() (both in the files below) already branch on
// `tx.version !== undefined` and needed no change — submitSigned serializes whatever real
// Transaction/VersionedTransaction it's given via its own .serialize(), and txToBytes/txFromBytes
// (used by the Wallet Standard and MWA provider shims) already have the v0 branch. Confirmed by
// reading both functions; scripts/seeker-build-test.cjs's MWA section already round-trips a
// generic byte array through txToBytes/txFromBytes without version-specific behaviour to add.
//
// vm.runInThisContext, not vm.createContext/runInContext: cluck-wallet.js's asTransaction does
// `signed instanceof W3.Transaction` / `instanceof W3.VersionedTransaction` against
// `global.solanaWeb3`, which this test sets to the SAME @solana/web3.js module instance used to
// build the fixtures. A separate vm context (a different V8 realm) would give that realm its own
// Uint8Array/ArrayBuffer classes, and a host-realm Uint8Array would fail `instanceof` against the
// sandbox's — exactly the cross-realm trap scripts/seeker-build-test.cjs's MWA section works
// around with ArrayBuffer.isView() in its OWN assertions. Running in THIS context avoids the
// problem outright: one realm, one set of classes, real interop.
//
// Usage: node scripts/seeker-sign-versioned-test.cjs

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const web3 = require("@solana/web3.js");
const bs58 = require("bs58");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

(async () => {
  // ── Load public/cluck-wallet.js into THIS process's real global (see the header note) ────────
  global.solanaWeb3 = web3;
  // Node ships its own read-only `navigator` global (Node 21+) — cluck-wallet.js only ever reads
  // it behind `global.navigator && …` guards, so the built-in stand-in is harmless here.
  const walletSrc = fs.readFileSync(path.join(ROOT, "public", "cluck-wallet.js"), "utf8");
  vm.runInThisContext(walletSrc, { filename: "cluck-wallet.js" });
  const CW = global.CluckWallet;
  ok("cluck-wallet.js loaded and exported asTransaction", typeof CW.asTransaction === "function");

  // ── Load src/seeker/sign.js as an ESM, with a fake `window` (real @solana/web3.js standing in
  // for the vendored IIFE — the same pattern scripts/seeker-reclaim-sign-test.cjs's browser-seam
  // section uses). CluckWallet is the SAME object we just loaded above, so asTransaction's own
  // behaviour is exercised through the seam, not re-implemented. ─────────────────────────────────
  global.window = { solanaWeb3: web3, CluckWallet: CW, CluckUtil: { rpc: async () => { throw new Error("not used in this test"); } } };
  global.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  const seam = await import(path.join(ROOT, "src", "seeker", "sign.js") + "?t=" + Date.now());

  // ── Fixtures: one real v0 tx, one real legacy tx, same instructions ────────────────────────────
  function buildPair() {
    const payer = web3.Keypair.generate();
    const dest1 = web3.Keypair.generate().publicKey;
    const dest2 = web3.Keypair.generate().publicKey;
    const blockhash = web3.Keypair.generate().publicKey.toBase58(); // any 32-byte base58 value, shaped like a blockhash
    const ixs = [
      web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dest1, lamports: 1000 }),
      web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dest2, lamports: 2000 }),
    ];
    const msgV0 = new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const v0tx = new web3.VersionedTransaction(msgV0);
    const legacyTx = new web3.Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
    ixs.forEach((ix) => legacyTx.add(ix));
    return { payer, v0tx, legacyTx };
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 1. messageBytes / sameBytes — v0
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nmessageBytes / sameBytes — v0\n");
  {
    const { v0tx } = buildPair();
    const mb = seam.messageBytes(v0tx);
    ok("messageBytes(v0) returns real bytes, not null (the exact bug: compileMessage() threw on v0 and was silently caught)", mb instanceof Uint8Array && mb.length > 0, mb && mb.length);
    ok("messageBytes(v0) matches tx.message.serialize() directly", Buffer.compare(Buffer.from(mb), Buffer.from(v0tx.message.serialize())) === 0);

    const deserialized = web3.VersionedTransaction.deserialize(v0tx.serialize());
    ok("sameBytes matches a deserialised copy of the same v0 tx", seam.sameBytes(mb, seam.messageBytes(deserialized)));

    // Negative: an altered message must NOT compare equal.
    const mutated = Buffer.from(mb);
    mutated[Math.floor(mutated.length / 2)] ^= 0xff;
    ok("sameBytes correctly FAILS when the v0 message bytes were altered (a substituted transaction is still caught)", !seam.sameBytes(mb, mutated));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 2. messageBytes / sameBytes — legacy (unchanged, pinned)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nmessageBytes / sameBytes — legacy (unchanged)\n");
  {
    const { legacyTx } = buildPair();
    const mb = seam.messageBytes(legacyTx);
    ok("messageBytes(legacy) still returns tx.compileMessage().serialize() directly", Buffer.compare(Buffer.from(mb), Buffer.from(legacyTx.compileMessage().serialize())) === 0);
    ok("sameBytes(legacy, legacy) still true", seam.sameBytes(mb, mb));
    const mutated = Buffer.from(mb); mutated[0] ^= 0xff;
    ok("sameBytes still fails on an altered legacy message", !seam.sameBytes(mb, mutated));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 3. signatureOf — v0: null unsigned, correct after signing with a throwaway Keypair
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nsignatureOf — v0\n");
  {
    const { payer, v0tx } = buildPair();
    ok("signatureOf(v0, unsigned) is null (the pre-allocated 64 zero bytes must not be reported as a real signature)", seam.signatureOf(v0tx) === null);
    v0tx.sign([payer]);
    const got = seam.signatureOf(v0tx);
    const want = bs58.encode(Buffer.from(v0tx.signatures[0]));
    ok("signatureOf(v0, signed) returns the real signature, base58, matching bs58(tx.signatures[0])", got === want, { got, want });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 4. signatureOf — legacy (unchanged, pinned)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nsignatureOf — legacy (unchanged)\n");
  {
    const { payer, legacyTx } = buildPair();
    ok("signatureOf(legacy, unsigned) is null", seam.signatureOf(legacyTx) === null);
    legacyTx.sign(payer);
    const got = seam.signatureOf(legacyTx);
    const want = bs58.encode(Buffer.from(legacyTx.signatures[0].signature));
    ok("signatureOf(legacy, signed) unchanged: bs58 of signatures[0].signature", got === want, { got, want });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 5. asTransaction — v0: every accepted shape, and the refused shape
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nasTransaction — v0 (public/cluck-wallet.js)\n");
  {
    const { payer, v0tx } = buildPair();
    v0tx.sign([payer]);
    const rawBytes = v0tx.serialize(); // Uint8Array

    // (a) a VersionedTransaction instance passes straight through
    const a = CW.asTransaction(v0tx, v0tx);
    ok("instance: a VersionedTransaction instance passes through unchanged", a === v0tx);

    // (b) raw Uint8Array
    const b = CW.asTransaction(rawBytes, v0tx);
    ok("Uint8Array: deserialises to a VersionedTransaction with the same message bytes", b instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(b), seam.messageBytes(v0tx)));

    // (c) ArrayBuffer-backed view that is NOT itself a Uint8Array (e.g. a Buffer subview / DataView-style view)
    const viewBacked = new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    // Buffer IS a Uint8Array subclass in Node, so use a Node Buffer to exercise the
    // "ArrayBuffer-backed view" branch distinctly from the plain-Uint8Array branch above.
    const bufView = Buffer.from(rawBytes);
    const c = CW.asTransaction(bufView, v0tx);
    ok("ArrayBuffer-backed view (Node Buffer): deserialises correctly", c instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(c), seam.messageBytes(v0tx)));
    ok("(sanity) the view-backed input really does have .buffer instanceof ArrayBuffer, proving this exercised that branch", viewBacked.buffer instanceof ArrayBuffer);

    // (d) bare ArrayBuffer
    const ab = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    const d = CW.asTransaction(ab, v0tx);
    ok("ArrayBuffer: deserialises correctly", d instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(d), seam.messageBytes(v0tx)));

    // (e) number array
    const numArr = Array.from(rawBytes);
    const e = CW.asTransaction(numArr, v0tx);
    ok("number array: deserialises correctly", e instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(e), seam.messageBytes(v0tx)));

    // (f) {signedTransaction} wrapper (Wallet Standard shape)
    const f = CW.asTransaction({ signedTransaction: rawBytes }, v0tx);
    ok("{signedTransaction} wrapper: recurses and deserialises correctly", f instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(f), seam.messageBytes(v0tx)));

    // (g) a foreign-web3 versioned object exposing only .serialize() — round-trips through ours
    const foreign = { serialize: () => rawBytes };
    const g = CW.asTransaction(foreign, v0tx);
    ok("foreign object with .serialize(): round-trips through VersionedTransaction.deserialize", g instanceof web3.VersionedTransaction && seam.sameBytes(seam.messageBytes(g), seam.messageBytes(v0tx)));

    // (h) the bare {signatures:[...]} graft — legacy-only, must THROW a readable error for v0
    let threw = false, msg = "";
    try { CW.asTransaction({ signatures: [{ publicKey: payer.publicKey, signature: Buffer.alloc(64, 1) }] }, v0tx); }
    catch (err) { threw = true; msg = err.message; }
    ok("bare {signatures:[...]} graft is REFUSED for a v0 original (that shape only makes sense against a legacy signer-slot array)", threw, msg);
    ok("...with a readable message naming what happened, not a generic error", /versioned transaction/i.test(msg), msg);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 6. asTransaction — legacy (unchanged, pinned byte-for-byte)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nasTransaction — legacy (unchanged)\n");
  {
    const { payer, legacyTx } = buildPair();
    legacyTx.sign(payer);
    const rawBytes = legacyTx.serialize({ requireAllSignatures: true, verifySignatures: true });

    const a = CW.asTransaction(legacyTx, legacyTx);
    ok("instance: a legacy Transaction instance passes through unchanged", a === legacyTx);

    const b = CW.asTransaction(rawBytes, legacyTx);
    ok("Uint8Array: Transaction.from(...) round-trips to the same wire bytes", b instanceof web3.Transaction && Buffer.compare(Buffer.from(b.serialize({ requireAllSignatures: true, verifySignatures: true })), Buffer.from(rawBytes)) === 0);

    const ab = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    const c = CW.asTransaction(ab, legacyTx);
    ok("ArrayBuffer: round-trips to the same wire bytes", c instanceof web3.Transaction && Buffer.compare(Buffer.from(c.serialize({ requireAllSignatures: true, verifySignatures: true })), Buffer.from(rawBytes)) === 0);

    const numArr = Array.from(rawBytes);
    const d = CW.asTransaction(numArr, legacyTx);
    ok("number array: round-trips to the same wire bytes", d instanceof web3.Transaction && Buffer.compare(Buffer.from(d.serialize({ requireAllSignatures: true, verifySignatures: true })), Buffer.from(rawBytes)) === 0);

    const e = CW.asTransaction({ signedTransaction: rawBytes }, legacyTx);
    ok("{signedTransaction} wrapper: still recurses correctly for legacy", e instanceof web3.Transaction && Buffer.compare(Buffer.from(e.serialize({ requireAllSignatures: true, verifySignatures: true })), Buffer.from(rawBytes)) === 0);

    const foreign = { serialize: (opts) => legacyTx.serialize(opts) };
    const f = CW.asTransaction(foreign, legacyTx);
    ok("foreign object with .serialize(): still round-trips for legacy", f instanceof web3.Transaction && Buffer.compare(Buffer.from(f.serialize({ requireAllSignatures: true, verifySignatures: true })), Buffer.from(rawBytes)) === 0);

    // The bare {signatures:[...]} graft is legacy's OWN path and must still work unchanged.
    const fresh = new web3.Transaction({ feePayer: legacyTx.feePayer, recentBlockhash: legacyTx.recentBlockhash });
    legacyTx.instructions.forEach((ix) => fresh.add(ix));
    const signedShape = { signatures: [{ publicKey: payer.publicKey, signature: legacyTx.signatures[0].signature }] };
    const g = CW.asTransaction(signedShape, fresh);
    ok("bare {signatures:[...]} graft still works for a legacy original (unchanged path)", g === fresh && g.signatures[0].signature && Buffer.compare(Buffer.from(g.signatures[0].signature), Buffer.from(legacyTx.signatures[0].signature)) === 0);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 7. Codex round 27 P1 — mutation AFTER signing: a wallet that mutates the SAME transaction
  // object in place (rather than returning a distinct signed copy) must not be able to bypass
  // protection (4) by making messageBytes(tx) read the ALREADY-mutated object. Fixed by capturing
  // an independent byte COPY of the approved message before the wallet is ever called, and diffing
  // against that copy — never re-reading `tx` after signTransaction returns. Both legacy and v0.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nCodex round 27 P1 — a wallet that mutates `tx` in place must still be caught (legacy + v0)\n");
  {
    let sendCalls = 0;
    global.window.CluckUtil = {
      rpc: async (method) => {
        if (method === "getLatestBlockhash") return { value: { blockhash: web3.Keypair.generate().publicKey.toBase58() } };
        if (method === "sendTransaction") { sendCalls++; return "SHOULD_NEVER_BE_CALLED"; }
        throw new Error("unexpected rpc call: " + method);
      },
    };

    // --- legacy: the fake wallet swaps the instruction for a different destination/amount, then
    // returns the SAME Transaction object reference ("signed in place"). ------------------------
    {
      sendCalls = 0;
      const payer = web3.Keypair.generate();
      const honestDest = web3.Keypair.generate().publicKey;
      const substitutedDest = web3.Keypair.generate().publicKey;
      const buildLegacy = (w3, blockhash, live) => {
        const t = new w3.Transaction({ feePayer: new w3.PublicKey(live), recentBlockhash: blockhash });
        t.add(w3.SystemProgram.transfer({ fromPubkey: new w3.PublicKey(live), toPubkey: honestDest, lamports: 1000 }));
        return t;
      };
      const mutatingProvider = {
        publicKey: { toString: () => payer.publicKey.toBase58() },
        signTransaction: async (tx) => {
          // Mutate the exact object the caller built and holds a reference to — a different
          // destination AND amount than what was approved — then hand back that SAME reference.
          tx.instructions[0] = web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: substitutedDest, lamports: 999999 });
          return tx;
        },
      };
      const res = await seam.signSendConfirm({ provider: mutatingProvider, owner: payer.publicKey.toBase58(), build: buildLegacy });
      ok("legacy: an in-place mutation is caught — status 'failed'", res.status === "failed", res);
      ok("legacy: the error names it as a different transaction", /different transaction/i.test(res.error || ""), res.error);
      ok("legacy: sendTransaction was NEVER called (caught before any submission)", sendCalls === 0, sendCalls);
    }

    // --- v0: the fake wallet rebuilds `tx.message` with a different instruction and assigns it
    // onto the SAME VersionedTransaction object ("signed in place"). ---------------------------
    {
      sendCalls = 0;
      const payer = web3.Keypair.generate();
      const honestDest = web3.Keypair.generate().publicKey;
      const substitutedDest = web3.Keypair.generate().publicKey;
      const buildV0 = (w3, blockhash, live) => {
        const msg = new w3.TransactionMessage({
          payerKey: new w3.PublicKey(live), recentBlockhash: blockhash,
          instructions: [w3.SystemProgram.transfer({ fromPubkey: new w3.PublicKey(live), toPubkey: honestDest, lamports: 1000 })],
        }).compileToV0Message();
        return new w3.VersionedTransaction(msg);
      };
      const mutatingProviderV0 = {
        publicKey: { toString: () => payer.publicKey.toBase58() },
        signTransaction: async (tx) => {
          const newMsg = new web3.TransactionMessage({
            payerKey: payer.publicKey, recentBlockhash: tx.message.recentBlockhash,
            instructions: [web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: substitutedDest, lamports: 999999 })],
          }).compileToV0Message();
          tx.message = newMsg;   // mutate the SAME VersionedTransaction object in place
          return tx;
        },
      };
      const res = await seam.signSendConfirm({ provider: mutatingProviderV0, owner: payer.publicKey.toBase58(), build: buildV0 });
      ok("v0: an in-place mutation of tx.message is caught — status 'failed'", res.status === "failed", res);
      ok("v0: the error names it as a different transaction", /different transaction/i.test(res.error || ""), res.error);
      ok("v0: sendTransaction was NEVER called (caught before any submission)", sendCalls === 0, sendCalls);
    }

    // --- sanity: an HONEST wallet (no mutation) still passes for both, so the fix isn't
    // over-broad. setTimeout collapsed to instant so the confirm poll doesn't add real delay. ---
    {
      const realSetTimeout = global.setTimeout;
      global.setTimeout = (fn) => fn();
      try {
        global.window.CluckUtil = {
          rpc: async (method) => {
            if (method === "getLatestBlockhash") return { value: { blockhash: web3.Keypair.generate().publicKey.toBase58() } };
            if (method === "sendTransaction") return "HONEST_SIG_1111111111111111111111111111111111111111111111111111111111111";
            if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed" }] };
            throw new Error("unexpected rpc call: " + method);
          },
        };
        const payer = web3.Keypair.generate();
        const dest = web3.Keypair.generate().publicKey;
        const honestProvider = {
          publicKey: { toString: () => payer.publicKey.toBase58() },
          signTransaction: async (tx) => { tx.partialSign ? tx.partialSign(payer) : tx.sign([payer]); return tx; },
        };
        const buildLegacy = (w3, blockhash, live) => {
          const t = new w3.Transaction({ feePayer: new w3.PublicKey(live), recentBlockhash: blockhash });
          t.add(w3.SystemProgram.transfer({ fromPubkey: new w3.PublicKey(live), toPubkey: dest, lamports: 1000 }));
          return t;
        };
        const resLegacy = await seam.signSendConfirm({ provider: honestProvider, owner: payer.publicKey.toBase58(), build: buildLegacy });
        ok("sanity: an HONEST legacy wallet (no mutation) still sends successfully — the fix isn't over-broad", resLegacy.status === "sent", resLegacy);

        const buildV0 = (w3, blockhash, live) => {
          const msg = new w3.TransactionMessage({
            payerKey: new w3.PublicKey(live), recentBlockhash: blockhash,
            instructions: [w3.SystemProgram.transfer({ fromPubkey: new w3.PublicKey(live), toPubkey: dest, lamports: 1000 })],
          }).compileToV0Message();
          return new w3.VersionedTransaction(msg);
        };
        const resV0 = await seam.signSendConfirm({ provider: honestProvider, owner: payer.publicKey.toBase58(), build: buildV0 });
        ok("sanity: an HONEST v0 wallet (no mutation) still sends successfully — the fix isn't over-broad", resV0.status === "sent", resV0);
      } finally { global.setTimeout = realSetTimeout; }
    }
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
