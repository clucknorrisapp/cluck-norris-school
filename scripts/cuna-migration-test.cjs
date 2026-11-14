"use strict";
// Tests for the CUNA -> CLKN migration monitor: lib/cuna-migration.js (pure rules),
// lib/cuna-migration-attempts.js (the O_EXCL attempt log) and lib/cuna-migration-monitor.js (the
// tick), driven as the server drives them — the REAL kvstore on a temp DATA_DIR, real attempt files,
// real signed web3 transactions — against a stub chain that decodes every transaction it is sent and
// delivers CLKN once per unique signature, the way Solana does.
//
// The property under test, after every case: the CLKN the stub chain actually delivered to each
// wallet equals what that wallet is owed — never more. Every address is made up (Keypair.generate);
// no real list, no secret, no network.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const bs58 = require("bs58");

const M = require("../lib/cuna-migration");
const { createAttemptStore } = require("../lib/cuna-migration-attempts");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }
function section(n) { queue.push([n, null]); }

const CUNA = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const CLKN = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const TREASURY = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const TOKEN = M.TOKEN_PROGRAM;
const E9 = 10n ** 9n;
const T0 = 1800000000;                  // window start (unix)
const DAY = 86400;
const pk = () => web3.Keypair.generate().publicKey.toBase58();
const randSig = () => bs58.encode(require("crypto").randomBytes(64));
const cuna = (whole) => (BigInt(whole) * E9).toString();
const owed = (cunaRaw) => M.clknForCuna(cunaRaw);

// ── kv: the real store, one module copy per "process" ─────────────────────────────────────────
function freshKv(dir) {
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve("../lib/kvstore")];
  const kv = require("../lib/kvstore");
  process.env.DATA_DIR = prev;
  return kv;
}
function freshMonitorModule() {
  delete require.cache[require.resolve("../lib/cuna-migration-monitor")];
  return require("../lib/cuna-migration-monitor");
}

// ── The stub chain ────────────────────────────────────────────────────────────────────────────
function makeChain({ receive, payer }) {
  const ch = {
    slot: 1000, height: 5000, receive, payer,
    receiveAccts: [],                    // [{pubkey, program}]
    incoming: new Map(),                 // sig -> {tx, accts:[...], slot, err}
    payouts: new Map(),                  // sig -> {recipient, amount, memo, slot, err, deliveredAmt}
    delivered: new Map(),                // owner -> bigint CLKN delivered
    payerClkn: 10n ** 30n, payerLamports: 10n ** 12n,
    blockhashes: new Map(),
    sendModes: [], sendMode: "land",     // land | drop | landThenThrow | throw | failErr | wrongAmount
    statusLag: new Map(),                // sig -> number of null status answers still to give
    rpcFail: new Set(), txUnavailable: new Set(),
    mintAuthority: null, accountOwners: new Map(),
    sends: [], ataOwner: new Map(),
    payers: new Set([payer]),            // every address whose history / balances the stub answers as a payer
    atas: new Set(), closedAtas: new Set(),
    historyHide: new Set(),              // payout sigs a lagging node leaves out of the payer's history
  };
  ch.addReceiveAcct = (pubkey = pk(), program = TOKEN) => { ch.receiveAccts.push({ pubkey, program }); return pubkey; };
  ch.knowWallet = (w) => { ch.ataOwner.set(spl.getAssociatedTokenAddressSync(new web3.PublicKey(CLKN), new web3.PublicKey(w), true).toBase58(), w); };
  ch.payerAta = (p = payer) => spl.getAssociatedTokenAddressSync(new web3.PublicKey(CLKN), new web3.PublicKey(p), false).toBase58();
  ch.clknAtaOf = (w) => spl.getAssociatedTokenAddressSync(new web3.PublicKey(CLKN), new web3.PublicKey(w), true).toBase58();
  // A transaction from a stranger that merely names the payer and carries a migration memo.
  ch.addForeignMemo = (memo, toPayer = payer) => { const sig = randSig(); ch.payouts.set(sig, { recipient: pk(), amount: 0n, memo, slot: ++ch.slot, err: null, deliveredAmt: 0n, blockTime: T0, payer: toPayer, foreign: pk() }); return sig; };

  // One incoming CUNA transfer, in the jsonParsed shape the RPC returns.
  ch.addIncoming = ({ from, amount, to, also = [], slot, blockTime, err = null, sig = randSig(), extraFrom = null, noWitness = false, closeSource = false, mutate }) => {
    const toAcct = to || ch.receiveAccts[0].pubkey;
    const src = pk(), src2 = pk();
    const bal = BigInt(amount) * 3n;
    const keys = [{ pubkey: from }, { pubkey: src }, { pubkey: toAcct }, { pubkey: CUNA }, { pubkey: src2 }];
    const pre = [{ accountIndex: 1, mint: CUNA, owner: from, uiTokenAmount: { amount: (closeSource ? BigInt(amount) : bal).toString() } },
                 { accountIndex: 2, mint: CUNA, owner: receive, uiTokenAmount: { amount: "0" } }];
    const post = [{ accountIndex: 2, mint: CUNA, owner: receive, uiTokenAmount: { amount: String(amount) } }];
    if (!closeSource) post.push({ accountIndex: 1, mint: CUNA, owner: from, uiTokenAmount: { amount: (bal - BigInt(amount)).toString() } });
    const ix = [{ program: "spl-token", programId: TOKEN, parsed: { type: "transferChecked", info: { source: src, destination: toAcct, mint: CUNA, authority: from, tokenAmount: { amount: String(amount), decimals: 9 } } } }];
    if (extraFrom) {
      pre.push({ accountIndex: 4, mint: CUNA, owner: extraFrom, uiTokenAmount: { amount: "1000" } });
      post.push({ accountIndex: 4, mint: CUNA, owner: extraFrom, uiTokenAmount: { amount: "0" } });
      post[0] = { ...post[0], uiTokenAmount: { amount: (BigInt(amount) + 1000n).toString() } };
      ix.push({ program: "spl-token", programId: TOKEN, parsed: { type: "transfer", info: { source: src2, destination: toAcct, authority: extraFrom, amount: "1000" } } });
    }
    const s = Number(slot || ++ch.slot);
    if (s > ch.slot) ch.slot = s;
    const tx = { slot: s, blockTime: blockTime === undefined ? T0 + 100 : blockTime,
      meta: { err, preTokenBalances: pre, postTokenBalances: post, innerInstructions: [] },
      transaction: { message: { accountKeys: keys, instructions: noWitness ? [] : ix } } };
    if (mutate) mutate(tx);
    ch.incoming.set(sig, { tx, accts: [toAcct, ...also], slot: s, err });
    return sig;
  };

  function land(sig, { recipient, amount, memo, feePayer, dst }, mode) {
    const payerShort = ch.payerClkn < amount;
    const err = (mode === "failErr" || payerShort) ? { InstructionError: [3, { Custom: 1 }] } : null;
    const deliveredAmt = err ? 0n : (mode === "wrongAmount" ? amount - 1n : amount);
    ch.payouts.set(sig, { recipient, amount, memo, slot: ++ch.slot, err, deliveredAmt, blockTime: T0 + 500, payer: feePayer });
    if (dst && !err) { ch.atas.add(dst); ch.closedAtas.delete(dst); }   // a failed transaction rolls the ATA create back too
    if (!err) { ch.delivered.set(recipient, (ch.delivered.get(recipient) || 0n) + deliveredAmt); ch.payerClkn -= deliveredAmt; }
  }

  function decode(bytes) {
    const tx = web3.Transaction.from(bytes);
    assert.ok(tx.verifySignatures(), "a payout reached the chain unsigned");
    const sig = bs58.encode(tx.signature);
    let recipient = null, amount = null, memo = null, ataIdem = false, dst = null;
    for (const ix of tx.instructions) {
      const pid = ix.programId.toBase58();
      if (pid === TOKEN && ix.data[0] === 12) { amount = ix.data.readBigUInt64LE(1); dst = ix.keys[2].pubkey.toBase58(); recipient = ch.ataOwner.get(ix.keys[2].pubkey.toBase58()) || ("ata:" + ix.keys[2].pubkey.toBase58()); assert.strictEqual(ix.keys[1].pubkey.toBase58(), CLKN); assert.strictEqual(ix.data[9], 9); }
      if (pid === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") ataIdem = ix.data.length === 1 && ix.data[0] === 1;
      if (pid === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") memo = ix.data.toString("utf8");
    }
    return { tx, sig, recipient, amount, memo, ataIdem, dst, feePayer: tx.feePayer.toBase58() };
  }

  ch.conn = {
    async getLatestBlockhash() {
      if (ch.rpcFail.has("getLatestBlockhash")) throw new Error("rpc down");
      const blockhash = bs58.encode(require("crypto").randomBytes(32));
      const lastValidBlockHeight = ch.height + 150;
      ch.blockhashes.set(blockhash, lastValidBlockHeight);
      return { blockhash, lastValidBlockHeight };
    },
    async getBlockHeight() { if (ch.rpcFail.has("getBlockHeight")) throw new Error("rpc down"); return ch.height; },
    async getSignatureStatuses(sigs) {
      if (ch.rpcFail.has("getSignatureStatuses")) throw new Error("rpc down");
      return { value: sigs.map((s) => {
        const p = ch.payouts.get(s);
        if (!p) return null;
        const lag = ch.statusLag.get(s) || 0;
        if (lag > 0) { ch.statusLag.set(s, lag - 1); return null; }
        return { slot: p.slot, confirmations: null, err: p.err, confirmationStatus: ch.statusCommitment || "finalized" };
      }) };
    },
    async sendRawTransaction(bytes) {
      const d = decode(bytes);
      ch.sends.push(d);
      const mode = ch.sendModes.length ? ch.sendModes.shift() : ch.sendMode;
      if (mode === "throw") throw new Error("socket hang up");
      // The node simulated it and refused (the payer's balance moved after the tick read it): never forwarded.
      if (mode === "preflightReject") throw new Error("Transaction simulation failed: Error processing Instruction 3: insufficient funds");
      if (ch.payouts.has(d.sig)) return d.sig;                      // same signature: lands once, ever
      const lv = ch.blockhashes.get(d.tx.recentBlockhash);
      if (lv == null || ch.height > lv) throw new Error("Blockhash not found");
      if (mode === "drop") return d.sig;                            // accepted, never lands
      land(d.sig, d, mode);
      if (mode === "landThenThrow") throw new Error("timeout waiting for the response");
      return d.sig;
    },
  };

  function sigsFor(addr) {
    const rows = [];
    for (const [sig, x] of ch.incoming) if (x.accts.includes(addr)) rows.push({ signature: sig, slot: x.slot, err: x.err, blockTime: x.tx.blockTime });
    return rows;
  }
  function payoutTx(sig) {
    const p = ch.payouts.get(sig);
    const P = p.payer || payer;
    const pre = [{ accountIndex: 1, mint: CLKN, owner: P, uiTokenAmount: { amount: "1000000000000000000000" } }];
    const post = [{ accountIndex: 1, mint: CLKN, owner: P, uiTokenAmount: { amount: (10n ** 21n - p.deliveredAmt).toString() } },
                  { accountIndex: 2, mint: CLKN, owner: p.recipient, uiTokenAmount: { amount: p.deliveredAmt.toString() } }];
    const keys = p.foreign
      ? [{ pubkey: p.foreign, signer: true, writable: true }, { pubkey: P, signer: false, writable: true }]
      : [{ pubkey: P, signer: true, writable: true }, { pubkey: pk(), signer: false, writable: true }, { pubkey: pk(), signer: false, writable: true }];
    return { slot: p.slot, blockTime: p.blockTime, meta: { err: p.err, preTokenBalances: p.foreign ? [] : pre, postTokenBalances: p.foreign ? [] : post, innerInstructions: [] },
      transaction: { message: { accountKeys: keys, instructions: [] } } };
  }

  ch.rpcJson = async (method, params) => {
    if (ch.rpcFail.has(method)) throw new Error("rpc down");
    const ok = (result) => ({ jsonrpc: "2.0", id: method, result });
    switch (method) {
      case "getSlot": return ok(ch.slot);
      case "getBalance": return ok({ context: {}, value: Number(ch.payerLamports) });
      case "getAccountInfo": {
        const a = params[0];
        if (a === CLKN) return ok({ value: { owner: TOKEN, executable: false, data: { parsed: { info: { decimals: 9, mintAuthority: ch.mintAuthority } } } } });
        if (ch.atas.has(a) && !ch.closedAtas.has(a)) return ok({ value: { owner: TOKEN, executable: false, data: ["AAAA", "base64"] } });
        if (ch.accountOwners.has(a)) return ok({ value: { owner: ch.accountOwners.get(a), executable: false, data: ["AAAA", "base64"] } });
        return ok({ value: null });
      }
      case "getTokenAccountsByOwner": {
        const [owner, f] = params;
        if (owner === receive && f.mint === CUNA) return ok({ value: ch.receiveAccts.map((a) => ({ pubkey: a.pubkey, account: { owner: a.program, data: { parsed: { info: { mint: CUNA, owner: receive, tokenAmount: { amount: "0" } } } } } })) });
        if (ch.payers.has(owner) && f.mint === CLKN) return ok({ value: [{ pubkey: ch.payerAta(owner), account: { owner: TOKEN, data: { parsed: { info: { mint: CLKN, owner: payer, tokenAmount: { amount: ch.payerClkn.toString() } } } } } }] });
        return ok({ value: [] });
      }
      case "getSignaturesForAddress": {
        const [addr, o] = params;
        let rows;
        if (ch.payers.has(addr)) rows = [...ch.payouts.entries()].filter(([s, p]) => (p.payer || payer) === addr && !ch.historyHide.has(s)).map(([s, p]) => ({ signature: s, slot: p.slot, err: p.err, memo: p.memo ? `[${p.memo.length}] ${p.memo}` : null }));
        else rows = sigsFor(addr);
        rows.sort((a, b) => (b.slot - a.slot) || (a.signature < b.signature ? 1 : -1));   // newest first
        if (o.until) { const i = rows.findIndex((r) => r.signature === o.until); if (i >= 0) rows = rows.slice(0, i); }
        if (o.before) { const i = rows.findIndex((r) => r.signature === o.before); rows = i >= 0 ? rows.slice(i + 1) : []; }
        return ok(rows.slice(0, o.limit || 1000));
      }
      case "getTransaction": {
        const sig = params[0];
        if (ch.txUnavailable.has(sig)) return ok(null);
        if (ch.incoming.has(sig)) return ok(JSON.parse(JSON.stringify(ch.incoming.get(sig).tx)));
        if (ch.payouts.has(sig)) return ok(payoutTx(sig));
        return ok(null);
      }
      default: throw new Error("stub: unexpected method " + method);
    }
  };
  return ch;
}

// ── A whole world: kv, chain, monitor, configured and (optionally) armed ─────────────────────
function world(opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), "cuna-mig-test-"));
  const payerKp = opts.payerKp || web3.Keypair.generate();
  const payer = payerKp.publicKey.toBase58();
  const receive = opts.receive || pk();
  const ch = opts.chain || makeChain({ receive, payer });
  if (!ch.receiveAccts.length) ch.addReceiveAcct();
  const w = { dir, ch, payer, payerKp, receive, alerts: [], fp: {}, env: { CUNA_MIGRATION_ON: "1", ...(opts.env || {}) }, clock: opts.clock || { t: T0 + 1000 } };
  w.attemptsDir = path.join(dir, "cuna-migration", "attempts");
  w.signer = opts.signer !== undefined ? opts.signer : { keypair: payerKp };
  w.boot = (bootOpts = {}) => {
    w.kv = bootOpts.kv || freshKv(dir);
    const mod = freshMonitorModule();
    w.m = mod.createMonitor({
      kv: w.kv, rpcJson: ch.rpcJson, conn: ch.conn, attempts: createAttemptStore(w.attemptsDir),
      loadSigner: () => w.signer, env: () => w.env,
      alert: (text, key) => { w.alerts.push({ text, key }); return w.alertReturns === undefined ? 1 : w.alertReturns; },
      now: () => w.clock.t * 1000, isStaging: () => !!w.staging, mints: { cuna: CUNA, clkn: CLKN }, treasury: opts.treasury || TREASURY,
      clknUsd: () => 0.0002, failpoint: (name, info) => { const f = w.fp[name]; if (f) f(info); },
      log: process.env.DBG ? console : { warn() {}, log() {}, error() {} },
      limits: opts.limits,
      // The stub chain's slots start near 1000, far below the real epoch; tests pick their own.
      memoEpochSlot: opts.memoEpochSlot != null ? opts.memoEpochSlot : 0,
    });
    return w.m;
  };
  w.boot();
  w.journal = () => w.kv.get("cunaMigJournal", null) || M.emptyJournal();
  w.entries = () => Object.entries(w.journal().entries);
  w.advance = (blocks = 0, secs = 0) => { ch.height += blocks; w.clock.t += secs; };
  w.tick = async (n = 1) => { let r; for (let i = 0; i < n; i++) { r = await w.m.tick("test"); if (process.env.DBG) console.log(JSON.stringify(r)); w.advance(2, 5); } return r; };
  w.configure = async ({ rows, window, arm = true } = {}) => {
    let r = w.m.setPayer(payer); assert.ok(r.ok, JSON.stringify(r));
    r = await w.m.setReceive(receive); assert.ok(r.ok, JSON.stringify(r));
    r = w.m.setList(rows); assert.ok(r.ok, JSON.stringify(r));
    r = w.m.setWindow(window ? window.start : T0, window ? window.end : undefined); assert.ok(r.ok, JSON.stringify(r));
    for (const row of rows) ch.knowWallet(row.wallet);
    if (arm) { r = w.m.arm("arm-cuna-migration"); assert.ok(r.ok, JSON.stringify(r)); }
  };
  return w;
}
const row = (wallet, sendWhole = 0, locksRaw = "0", rewardsRaw = "0") => ({ wallet, sendInMaxCunaRaw: cuna(sendWhole), day0LocksClknRaw: locksRaw, day0RewardsClknRaw: rewardsRaw });
function deliveredOf(w, wallet) { return w.ch.delivered.get(wallet) || 0n; }
function assertNoOverpay(w, owedBy) {
  for (const [wallet, amt] of w.ch.delivered) {
    const o = owedBy[wallet] || 0n;
    assert.ok(amt <= o, `${wallet.slice(0, 6)} received ${amt} but is owed ${o}`);
  }
}
function uniqueLandedFor(w, wallet) { return [...w.ch.payouts.values()].filter((p) => p.recipient === wallet && !p.err).length; }

// ═════════════════════════════════════════════════════════════════════════════════════════════
section("the rate is exact integer math");

t("1,000,000 CUNA is exactly 27,700 CLKN", () => {
  assert.strictEqual(M.clknForCuna((1000000n * E9).toString()), 27700n * E9);
  assert.strictEqual(M.clknForCuna("1000000000000000"), 27700000000000n);
});
t("36 raw rounds to 0 (nothing owed), 37 raw to 1", () => {
  assert.strictEqual(M.clknForCuna("36"), 0n);
  assert.strictEqual(M.clknForCuna("37"), 1n);
  assert.strictEqual(M.clknForCuna("0"), 0n);
});
t("splitting a wallet's CUNA into two transfers never pays more than one transfer of the sum", () => {
  for (let i = 0; i < 2000; i++) {
    const total = BigInt(Math.floor(Math.random() * 1e12)) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const a = total === 0n ? 0n : BigInt(Math.floor(Math.random() * Number(total % 100000000n)));
    const b = total - a;
    assert.ok(M.clknForCuna(a) + M.clknForCuna(b) <= M.clknForCuna(total));
  }
});
t("a non-integer amount is refused, never rounded", () => {
  for (const bad of ["1.5", "", " 1", "-1", "1e9", null]) assert.throws(() => M.clknForCuna(bad));
});

section("the uploaded list");

t("valid list: sha256 is stable under reordering, totals are exact", () => {
  const a = pk(), b = pk(), c = pk();
  const rows = [row(a, 1000000), row(b, 37, "5", "7"), { wallet: c, sendInMaxCunaRaw: "36", day0LocksClknRaw: "0", day0RewardsClknRaw: "0" }];
  const v1 = M.validateList(rows), v2 = M.validateList(rows.slice().reverse());
  assert.ok(v1.ok, JSON.stringify(v1));
  assert.strictEqual(v1.sha256, v2.sha256);
  assert.strictEqual(v1.totals.sendInMaxCunaRaw, (1000000n * E9 + 37n * E9 + 36n).toString());
  assert.strictEqual(v1.totals.sendInClknRaw, (27700n * E9 + M.clknForCuna(37n * E9) + 0n).toString());
  assert.strictEqual(v1.totals.day0LocksClknRaw, "5");
  assert.strictEqual(v1.totals.day0RewardsClknRaw, "7");
  assert.strictEqual(v1.totals.totalClknNeededRaw, (BigInt(v1.totals.sendInClknRaw) + 12n).toString());
  assert.strictEqual(v1.totals.lockers, 1);
});
t("leading zeros normalise, so the hash cannot differ by formatting", () => {
  const a = pk();
  const v1 = M.validateList([{ wallet: a, sendInMaxCunaRaw: "007", day0LocksClknRaw: "0", day0RewardsClknRaw: "00" }]);
  const v2 = M.validateList([{ wallet: a, sendInMaxCunaRaw: "7", day0LocksClknRaw: "0", day0RewardsClknRaw: "0" }]);
  assert.strictEqual(v1.sha256, v2.sha256);
});
t("refused: duplicate wallet, a non-digit raw, a number instead of a string, the receive wallet / treasury on the list, a row with nothing", () => {
  const a = pk(), recv = pk();
  const cases = [
    [[row(a, 1), row(a, 2)], /twice/],
    [[{ ...row(a, 1), sendInMaxCunaRaw: "1.5" }], /raw integer STRING/],
    [[{ ...row(a, 1), sendInMaxCunaRaw: 1000 }], /raw integer STRING/],
    [[row(recv, 1)], /receive wallet/],
    [[row(TREASURY, 1)], /receive wallet, the payer or the treasury/],
    [[row(a, 0)], /no amount/],
    [[{ ...row(a, 1), wallet: "notanaddress" }], /base58/],
    [[], /non-empty/],
  ];
  for (const [rows, re] of cases) {
    const v = M.validateList(rows, { forbidden: [recv, TREASURY] });
    assert.strictEqual(v.ok, false, JSON.stringify(rows));
    assert.ok(v.errors.some((e) => re.test(e)), v.errors.join(" | "));
  }
});
t("more than 500 rows is refused whole", () => {
  const rows = []; for (let i = 0; i < 501; i++) rows.push(row(pk(), 1));
  assert.strictEqual(M.validateList(rows).ok, false);
});

section("reading an incoming transfer: the sender is the one owner whose CUNA fell");

{
  const receive = pk(), payer = pk();
  const ch = makeChain({ receive, payer }); ch.addReceiveAcct();
  const cls = (sig) => M.classifyIncoming(ch.incoming.get(sig).tx, { mint: CUNA, receiver: receive });
  t("a plain transfer: sender found, received = min(rise, fall, instruction)", () => {
    const from = pk();
    const c = cls(ch.addIncoming({ from, amount: cuna(500) }));
    assert.strictEqual(c.kind, "ok"); assert.strictEqual(c.sender, from); assert.strictEqual(c.receivedRaw, cuna(500));
  });
  t("a source account closed in the same transaction still counts as the fall", () => {
    const from = pk();
    const c = cls(ch.addIncoming({ from, amount: cuna(9), closeSource: true }));
    assert.strictEqual(c.kind, "ok"); assert.strictEqual(c.sender, from); assert.strictEqual(c.receivedRaw, cuna(9));
  });
  t("two owners fell → held multi_sender", () => {
    const c = cls(ch.addIncoming({ from: pk(), amount: cuna(5), extraFrom: pk() }));
    assert.strictEqual(c.kind, "held"); assert.strictEqual(c.reason, "multi_sender");
  });
  t("the receive wallet did not rise → held no_rise; quiet when it is the owner's own outflow", () => {
    const sig = ch.addIncoming({ from: pk(), amount: cuna(5), mutate: (tx) => {
      // the receive wallet SENDS 5 out: its balance falls, nobody else's does
      tx.meta.preTokenBalances = [{ accountIndex: 2, mint: CUNA, owner: receive, uiTokenAmount: { amount: cuna(10) } }];
      tx.meta.postTokenBalances = [{ accountIndex: 2, mint: CUNA, owner: receive, uiTokenAmount: { amount: cuna(5) } }];
    } });
    const c = cls(sig);
    assert.strictEqual(c.reason, "no_rise"); assert.strictEqual(c.quiet, true);
  });
  t("CUNA rose but nobody else fell → held no_sender", () => {
    const sig = ch.addIncoming({ from: pk(), amount: cuna(5), mutate: (tx) => { tx.meta.preTokenBalances = tx.meta.preTokenBalances.filter((r) => r.owner === receive); tx.meta.postTokenBalances = tx.meta.postTokenBalances.filter((r) => r.owner === receive); } });
    assert.strictEqual(cls(sig).reason, "no_sender");
  });
  t("no transfer instruction from the faller into the receive wallet → held no_transfer_witness", () => {
    assert.strictEqual(cls(ch.addIncoming({ from: pk(), amount: cuna(5), noWitness: true })).reason, "no_transfer_witness");
  });
  t("a failed transaction is 'failed'; missing balance arrays or a null blockTime are 'unavailable', never 'no CUNA moved'", () => {
    assert.strictEqual(cls(ch.addIncoming({ from: pk(), amount: cuna(5), err: { InstructionError: [0, "x"] } })).kind, "failed");
    assert.strictEqual(cls(ch.addIncoming({ from: pk(), amount: cuna(5), mutate: (tx) => { delete tx.meta.preTokenBalances; } })).kind, "unavailable");
    assert.strictEqual(cls(ch.addIncoming({ from: pk(), amount: cuna(5), blockTime: null })).kind, "unavailable");
    assert.strictEqual(M.classifyIncoming(null, { mint: CUNA, receiver: receive }).kind, "unavailable");
  });
}

t("the memo names the key and attempt, and parses back out of an RPC memo field", () => {
  const m = M.memoFor("5abc", 2);
  assert.strictEqual(m, "CLKN migration 5abc #2");
  assert.deepStrictEqual(M.keysFromMemo(`[${m.length}] ${m}`), [{ key: "5abc", n: 2 }]);
  assert.deepStrictEqual(M.keysFromMemo("[22] CLKN migration day0:AbC #1; [3] hey"), [{ key: "day0:AbC", n: 1 }]);
});

section("the attempt log is a real compare-and-swap");

t("claim is O_EXCL: the second claimer of attempt n is told it exists; files are never rewritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuna-mig-att-"));
  const a = createAttemptStore(dir), b = createAttemptStore(dir);
  assert.deepStrictEqual(a.claim("sigA", 1, { paySig: "x" }), { ok: true });
  assert.deepStrictEqual(b.claim("sigA", 1, { paySig: "y" }), { exists: true });
  assert.strictEqual(a.forKey("sigA")[0].paySig, "x");
  fs.writeFileSync(path.join(dir, a.hashKey("sigB") + ".1.json"), "{tor");
  const p = a.list().find((r) => r.hash === a.hashKey("sigB"));
  assert.ok(p && p.partial && p.n === 1);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
section("one send pays once");

t("a listed send-in inside the window, armed, pays floor(credit*277/10000) CLKN to the SENDER, once, creating its ATA idempotently", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(400) });
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(400)));
  assert.strictEqual(w.ch.sends.length, 1);
  assert.ok(w.ch.sends[0].ataIdem, "the ATA must be created with the idempotent instruction");
  assert.ok(/^CLKN migration \S+ #1$/.test(w.ch.sends[0].memo), w.ch.sends[0].memo);
  const [[, e]] = w.entries();
  assert.strictEqual(e.state, "paid"); assert.strictEqual(e.paidSig, w.ch.sends[0].sig);
  assert.ok(w.alerts.some((a) => /sending/.test(a.text)), "a payout line is alerted");
});

t("the same signature seen on two receiver accounts, and again after a cursor reset, is ONE entry and ONE payment", async () => {
  const A = pk();
  const w = world(); const acct2 = w.ch.addReceiveAcct();
  await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(100), also: [acct2] });
  await w.tick(3);
  const j = w.journal(); j.cursors = {}; assert.ok(w.kv.setVerified("cunaMigJournal", j));
  await w.tick(3);
  assert.strictEqual(w.entries().length, 1);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(100)));
  assert.strictEqual(uniqueLandedFor(w, A), 1);
});

section("crashes never pay twice");

t("crash after signing, before the attempt file: nothing recorded or sent; the restart pays once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(50) });
  w.fp.after_sign = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.strictEqual(fs.existsSync(w.attemptsDir) ? fs.readdirSync(w.attemptsDir).length : 0, 0);
  delete w.fp.after_sign; w.boot();
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(50))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("crash after the attempt file, before the journal: the orphan is adopted as live; no new attempt until provable expiry (finalized height past lvbh+150 AND two not-found reads ≥60 s apart); then exactly one payment", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(50) });
  w.fp.after_claim = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  assert.strictEqual(w.ch.sends.length, 0, "nothing broadcast");
  delete w.fp.after_claim;
  w.advance(400, 0);                                   // blockhash expired while we were down
  w.boot();
  await w.m.tick("t");
  let e = w.entries()[0][1];
  assert.strictEqual(e.state, "sending"); assert.strictEqual(e.attempts.length, 1); assert.ok(e.attempts[0].adopted);
  assert.strictEqual(w.ch.sends.length, 0, "expired bytes are not rebroadcast and no new attempt is built yet");
  w.advance(5, 30); await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 0, "two not-found reads less than 60 s apart do not count");
  w.advance(5, 31); await w.m.tick("t");
  e = w.entries()[0][1];
  assert.strictEqual(e.attempts[0].outcome, "expired");
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(50))); assert.strictEqual(uniqueLandedFor(w, A), 1);
  assert.strictEqual(w.entries()[0][1].attempts.length, 2);
});

t("crash after the journal, before broadcast: restart within the blockhash window rebroadcasts the identical bytes — one payment, one signature", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(70) });
  w.fp.after_journal = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  const sig = w.entries()[0][1].attempts[0].paySig;
  delete w.fp.after_journal; w.boot();
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(70)));
  assert.ok(w.ch.sends.every((s) => s.sig === sig), "only the journaled signature ever reached the chain");
  assert.strictEqual(w.entries()[0][1].paidSig, sig);
});

t("crash after the journal, restart after expiry: one payment after provable expiry, never two", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(70) });
  w.fp.after_journal = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  delete w.fp.after_journal; w.advance(400, 0); w.boot();
  for (let i = 0; i < 6; i++) { await w.m.tick("t"); w.advance(5, 61); }
  assert.strictEqual(deliveredOf(w, A), owed(cuna(70))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("crash after a broadcast that landed: the restart resolves it as paid from the chain, no second send", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(80) });
  w.fp.after_send = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  delete w.fp.after_send; w.boot();
  await w.tick(4);
  assert.strictEqual(w.ch.sends.length, 1);
  assert.strictEqual(w.entries()[0][1].state, "paid");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(80)));
});

t("a dropped send response (accepted, then the call throws) resolves as paid, never as failed", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["landThenThrow"];
  await w.tick(4);
  assert.strictEqual(w.ch.sends.length, 1);
  const e = w.entries()[0][1];
  assert.strictEqual(e.state, "paid"); assert.strictEqual(e.attempts[0].outcome, "landed");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

t("a send that throws without landing is NOT failed: the same bytes are rebroadcast and land once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["throw"];
  await w.tick(4);
  assert.strictEqual(new Set(w.ch.sends.map((s) => s.sig)).size, 1);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

t("network drop (never landed): rebroadcast of the IDENTICAL signature before expiry lands once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(20) });
  w.ch.sendModes = ["drop", "drop"];
  await w.tick(5);
  assert.ok(w.ch.sends.length >= 2, "it was rebroadcast");
  assert.strictEqual(new Set(w.ch.sends.map((s) => s.sig)).size, 1, "every broadcast is the same signature");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(20)));
});

t("network drop that never lands: the expiry + two-read rule allows exactly ONE new attempt, which lands once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(20) });
  w.ch.sendMode = "drop";
  await w.m.tick("t");
  w.advance(400, 0); await w.m.tick("t");
  w.advance(5, 61); w.ch.sendMode = "land"; await w.m.tick("t");
  await w.tick(3);
  const e = w.entries()[0][1];
  assert.strictEqual(e.attempts.length, 2); assert.strictEqual(e.attempts[0].outcome, "expired");
  assert.strictEqual(e.state, "paid");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(20))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("lagging node: status null past expiry but the payout DID land — the memo guard revives it, no second attempt, paid once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(30) });
  await w.m.tick("t");
  const sig = w.ch.sends[0].sig;
  w.ch.statusLag.set(sig, 1000);
  w.advance(400, 0); await w.m.tick("t");
  w.advance(5, 61); await w.m.tick("t");
  let e = w.entries()[0][1];
  assert.strictEqual(e.attempts.length, 1, "no second attempt was built");
  assert.strictEqual(e.attempts[0].outcome, "live"); assert.ok(e.attempts[0].revived >= 1);
  w.ch.statusLag.set(sig, 0);
  await w.tick(2);
  e = w.entries()[0][1];
  assert.strictEqual(e.state, "paid"); assert.strictEqual(w.ch.sends.length, 1);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(30)));
});

section("the memo witness survives a lost journal");

t("the attempt deleted from the journal but its file kept: adopted back and resolved as paid — no new payout", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  await w.m.tick("t");
  const j = w.journal(); const e = Object.values(j.entries)[0]; e.attempts = []; e.state = "due"; assert.ok(w.kv.setVerified("cunaMigJournal", j));
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 1);
  assert.strictEqual(Object.values(w.journal().entries)[0].state, "paid");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
});

t("the whole journal AND the attempt files lost while the chain holds the memo'd payout: no new payout, the journal is halted, an alert goes out", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  assert.ok(w.kv.setVerified("cunaMigJournal", M.emptyJournal()));
  fs.rmSync(w.attemptsDir, { recursive: true, force: true });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 1, "no new payout");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  assert.strictEqual(w.journal().halted.code, "unknown_memo");
  assert.ok(w.alerts.some((a) => /HALTED \(unknown_memo\)/.test(a.text)));
  assert.strictEqual(w.m.armFacts().armed, false);
});

section("two instances on one volume");

t("two monitors (two kvstore copies on one DATA_DIR) ticking interleaved: exactly one payment per transfer", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000), row(B, 1000)] });
  const kv2 = freshKv(w.dir);
  const m2 = freshMonitorModule().createMonitor({
    kv: kv2, rpcJson: w.ch.rpcJson, conn: w.ch.conn, attempts: createAttemptStore(w.attemptsDir), loadSigner: () => w.signer, env: () => w.env,
    alert: () => 1, now: () => w.clock.t * 1000, mints: { cuna: CUNA, clkn: CLKN }, treasury: TREASURY, log: { warn() {}, log() {}, error() {} },
    memoEpochSlot: 0,
  });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(20) });
  for (let i = 0; i < 5; i++) { await Promise.all([w.m.tick("a"), m2.tick("b")]); w.advance(2, 5); }
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w, A), 1);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(20))); assert.strictEqual(uniqueLandedFor(w, B), 1);
});

t("a second process with a STALE journal and a lagging directory listing: its claim of attempt #1 hits O_EXCL and it sends nothing; its stale blob write erases the attempt from kv, and the attempt file restores it — one payment", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)], arm: false });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.m.tick("detect");                                   // disarmed: the entry is recorded due
  const snapshot = JSON.parse(JSON.stringify(w.journal()));
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  w.ch.sendModes = ["drop"];
  await w.m.tick("A sends #1");                               // attempt #1 live, never landed yet
  assert.strictEqual(w.ch.sends.length, 1);
  const kvB = freshKv(w.dir);
  const staleKv = { ...kvB, get: (k, d) => (k === "cunaMigJournal" ? JSON.parse(JSON.stringify(snapshot)) : kvB.get(k, d)), setVerified: kvB.setVerified, setManyVerified: kvB.setManyVerified, set: kvB.set, isPersistent: kvB.isPersistent, loadError: kvB.loadError };
  const realStore = createAttemptStore(w.attemptsDir);
  const claims = [];
  const laggyStore = { ...realStore, list: () => [], forKey: () => [], claim: (k, n, r) => { const c = realStore.claim(k, n, r); claims.push(c); return c; } };
  const mB = freshMonitorModule().createMonitor({
    kv: staleKv, rpcJson: w.ch.rpcJson, conn: w.ch.conn, attempts: laggyStore, loadSigner: () => w.signer, env: () => w.env,
    alert: () => 1, now: () => w.clock.t * 1000, mints: { cuna: CUNA, clkn: CLKN }, treasury: TREASURY, log: { warn() {}, log() {}, error() {} },
    memoEpochSlot: 0,
  });
  await mB.tick("B, stale");
  assert.ok(claims.some((c) => c.exists), "B reached the claim and O_EXCL refused it");
  assert.strictEqual(w.ch.sends.length, 1, "B broadcast nothing");
  w.boot();                                                   // A again, fresh view of the volume
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w, A), 1);
  assert.strictEqual(new Set(w.ch.sends.map((s) => s.sig)).size, 1, "only attempt #1's signature ever reached the chain");
});

section("caps");

t("two send-ins whose total exceeds sendInMax: the second is credited only the remainder, the rest is held as excess and alerted", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(70) });
  w.ch.addIncoming({ from: A, amount: cuna(50) });
  await w.tick(4);
  const es = w.entries().map(([, e]) => e).sort((a, b) => a.slot - b.slot);
  assert.strictEqual(es[0].creditCunaRaw, cuna(70));
  assert.strictEqual(es[1].creditCunaRaw, cuna(30)); assert.strictEqual(es[1].excessCunaRaw, cuna(20));
  assert.strictEqual(deliveredOf(w, A), owed(cuna(70)) + owed(cuna(30)));
  assert.ok(deliveredOf(w, A) <= owed(cuna(100)));
  assert.ok(w.alerts.some((a) => /over the cap/.test(a.text)));
  assert.strictEqual(w.journal().credited[A], cuna(100));
});

t("…the same with a crash and restart between the two send-ins", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(70) });
  w.fp.after_journal = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  delete w.fp.after_journal; w.boot();
  w.ch.addIncoming({ from: A, amount: cuna(50) });
  await w.tick(5);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(70)) + owed(cuna(30)));
  const third = w.entries().map(([, e]) => e).find((e) => e.excessCunaRaw === cuna(20));
  assert.ok(third, "the remainder entry carries the 20 CUNA excess");
});

t("a send-in to a wallet already at its cap is held over_cap and pays nothing", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 10)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: A, amount: cuna(5) });
  await w.tick(4);
  const held = w.entries().map(([, e]) => e).find((e) => e.reason === "over_cap");
  assert.ok(held); assert.strictEqual(held.excessCunaRaw, cuna(5));
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

t("global cap: an env override LOWERS the cap and holds further sends; an override above the list total does not raise it", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)] });
  w.env.CUNA_MIGRATION_MAX_CLKN_RAW = owed(cuna(100)).toString();
  w.ch.addIncoming({ from: A, amount: cuna(100) });
  w.ch.addIncoming({ from: B, amount: cuna(100) });
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A) + deliveredOf(w, B), owed(cuna(100)));
  assert.ok(w.alerts.some((a) => a.key === "mig-globalcap"));
  assert.strictEqual(w.entries().filter(([, e]) => e.state === "due").length, 1, "the other entry waits, due");
  w.env.CUNA_MIGRATION_MAX_CLKN_RAW = (10n ** 30n).toString();
  const s = await w.m.status();
  assert.ok(/above the list total/.test(s.cap.warn)); assert.strictEqual(s.cap.globalCapRaw, s.list.totals.totalClknNeededRaw);
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(100)));
  w.env.CUNA_MIGRATION_MAX_CLKN_RAW = "12.5";
  assert.strictEqual((await w.m.status()).cap.globalCapRaw, "0", "a malformed override holds everything");
});

t("the per-tick limit is honoured", async () => {
  const ws = [pk(), pk(), pk()];
  const w = world({ env: { CUNA_MIGRATION_TICK_MAX: "1" } }); await w.configure({ rows: ws.map((x) => row(x, 10)) });
  for (const x of ws) w.ch.addIncoming({ from: x, amount: cuna(10) });
  await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 1);
  await w.tick(5);
  for (const x of ws) assert.strictEqual(deliveredOf(w, x), owed(cuna(10)));
});

section("held, never paid");

t("unlisted sender, multiple senders, no transfer witness, sender = payer: all held, nothing paid; no rise (the owner's own outflow) is counted, never an entry and never alerted", async () => {
  const A = pk(), U = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: U, amount: cuna(5) });
  w.ch.addIncoming({ from: A, amount: cuna(5), extraFrom: pk() });
  w.ch.addIncoming({ from: A, amount: cuna(5), noWitness: true });
  w.ch.addIncoming({ from: w.payer, amount: cuna(5) });
  w.ch.addIncoming({ from: A, amount: cuna(5), mutate: (tx) => {
    tx.meta.preTokenBalances = [{ accountIndex: 2, mint: CUNA, owner: w.receive, uiTokenAmount: { amount: cuna(10) } }, { accountIndex: 1, mint: CUNA, owner: U, uiTokenAmount: { amount: "0" } }];
    tx.meta.postTokenBalances = [{ accountIndex: 2, mint: CUNA, owner: w.receive, uiTokenAmount: { amount: cuna(5) } }, { accountIndex: 1, mint: CUNA, owner: U, uiTokenAmount: { amount: cuna(5) } }];
  } });
  await w.tick(3);
  const reasons = w.entries().map(([, e]) => e.reason).sort();
  assert.deepStrictEqual(reasons, ["multi_sender", "no_transfer_witness", "sender_is_payer", "unlisted_sender"]);
  assert.strictEqual(w.journal().skipped.noRise, 1);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.ok(w.alerts.some((a) => /HELD \(unlisted_sender\)/.test(a.text)));
  assert.ok(!w.alerts.some((a) => /no_rise/.test(a.text)), "the owner selling CUNA out by hand is not alerted");
  assert.strictEqual(w.journal().credited[A], undefined);
});

t("a failed transaction (row err, and meta.err at fetch) is ignored", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(5), err: { InstructionError: [0, "x"] } });
  w.ch.addIncoming({ from: A, amount: cuna(5), mutate: (tx) => { tx.meta.err = { InstructionError: [0, "y"] }; } });
  await w.tick(3);
  assert.strictEqual(w.entries().length, 0); assert.strictEqual(w.ch.sends.length, 0);
  assert.ok(Object.keys(w.journal().cursors).length === 1, "the cursor may pass a failed transaction");
});

t("an unreadable transaction (missing balances, null blockTime, not yet indexed) stops the walk: nothing recorded, cursor held, later signatures NOT processed out of order", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  const s1 = w.ch.addIncoming({ from: A, amount: cuna(60) });
  w.ch.addIncoming({ from: A, amount: cuna(60) });
  w.ch.txUnavailable.add(s1);
  await w.tick(2);
  assert.strictEqual(w.entries().length, 0);
  assert.deepStrictEqual(w.journal().cursors, {});
  w.ch.txUnavailable.delete(s1);
  const tx = w.ch.incoming.get(s1).tx; const saved = tx.blockTime; tx.blockTime = null;
  await w.tick(2);
  assert.strictEqual(w.entries().length, 0, "a null blockTime is unavailable too");
  tx.blockTime = saved;
  await w.tick(4);
  const e1 = w.journal().entries[s1];
  assert.strictEqual(e1.creditCunaRaw, cuna(60), "the EARLIER transfer got the first credit");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(60)) + owed(cuna(40)));
});

section("arming");

t("disarmed: detection records due entries and pays nothing; arming with both flags pays the backlog once; a later tick pays nothing", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)], arm: false });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(20) });
  await w.tick(3);
  assert.strictEqual(w.entries().filter(([, e]) => e.state === "due").length, 2);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(deliveredOf(w, B), owed(cuna(20)));
  const n = w.ch.sends.length;
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, n);
});

t("env ON without the kv arm pays nothing; the kv arm without env ON pays nothing; OFF=1 beats both and does no tick work at all", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)], arm: false });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0, "env ON alone");
  assert.strictEqual(w.m.arm("nope").ok, false, "arming needs the confirm word");
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  delete w.env.CUNA_MIGRATION_ON;
  await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0, "kv arm alone");
  w.env.CUNA_MIGRATION_ON = "1"; w.env.CUNA_MIGRATION_OFF = "1";
  const before = JSON.stringify(w.journal());
  const r = await w.m.tick("t");
  assert.strictEqual(r.off, true);
  assert.strictEqual(JSON.stringify(w.journal()), before, "OFF does no detection, resolution or write");
  assert.strictEqual(w.ch.sends.length, 0);
  delete w.env.CUNA_MIGRATION_OFF;
  await w.tick(2);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

t("staging never pays, even with both flags", async () => {
  const A = pk();
  const w = world(); w.staging = true; await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0); assert.strictEqual(w.m.armFacts().staging, true);
});

t("disarming between two sends in one tick stops the second (per-send re-check)", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  w.fp.after_send = () => { w.m.disarm(); };
  await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 1);
});

t("while disarmed, resolution still records a landed payment as paid, but never rebroadcasts", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  w.ch.sendModes = ["land", "drop"];
  await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 2);
  w.m.disarm();
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 2, "no rebroadcast while disarmed");
  const st = Object.fromEntries(w.entries().map(([, e]) => [e.sender, e.state]));
  assert.strictEqual(st[A], "paid"); assert.strictEqual(st[B], "sending");
});

section("the window");

t("a transfer before the window start is held before_window; at or after the end is held after_window and not paid even when armed", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)], window: { start: T0, end: T0 + 30 * DAY } });
  w.ch.addIncoming({ from: A, amount: cuna(5), blockTime: T0 - 1 });
  w.ch.addIncoming({ from: A, amount: cuna(5), blockTime: T0 + 30 * DAY });
  w.ch.addIncoming({ from: A, amount: cuna(5), blockTime: T0 + 31 * DAY });
  await w.tick(3);
  const reasons = w.entries().map(([, e]) => e.reason).sort();
  assert.deepStrictEqual(reasons, ["after_window", "after_window", "before_window"]);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.strictEqual(w.journal().credited[A], undefined, "held transfers consume no credit");
});

t("the window end defaults to start + 30 days", () => {
  const w = world();
  const r = w.m.setWindow(T0);
  assert.deepStrictEqual(r.window, { start: T0, end: T0 + 30 * DAY });
});

section("the payer");

t("payer short of CLKN: no send, the entry stays due, the alert carries a dedupe key; funding it pays once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.payerClkn = 1n;
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.strictEqual(w.entries()[0][1].state, "due");
  const shorts = w.alerts.filter((a) => /is short/.test(a.text));
  assert.ok(shorts.length >= 1 && shorts.every((a) => a.key === "mig-short"));
  w.ch.payerClkn = 10n ** 30n;
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(w.ch.sends.length, 1);
});

t("payer short of SOL (fee + ATA rent + the 0.01 SOL floor): no send until funded", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.payerLamports = 12000000n;   // above the floor, below floor + rent
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0);
  w.ch.payerLamports = 10n ** 10n;
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

t("payer secret refusals: equal to MM_OPERATOR_SECRET, an MM_OPERATOR_SECRET_* (in the other encoding) or CUNA_BURN_SECRET; unparseable; unset", () => {
  const { loadPayerSignerFromEnv } = freshMonitorModule();
  const kp = web3.Keypair.generate();
  const b58 = bs58.encode(kp.secretKey), arr = JSON.stringify(Array.from(kp.secretKey));
  assert.strictEqual(loadPayerSignerFromEnv({}), null);
  assert.ok(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: b58 }).keypair.publicKey.equals(kp.publicKey));
  assert.ok(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: arr }).keypair, "a JSON byte array parses");
  assert.ok(/MM_OPERATOR_SECRET\b/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: b58, MM_OPERATOR_SECRET: b58 }).refused));
  assert.ok(/MM_OPERATOR_SECRET_TREASURY/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: b58, MM_OPERATOR_SECRET_TREASURY: arr }).refused));
  assert.ok(/CUNA_BURN_SECRET/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: arr, CUNA_BURN_SECRET: b58 }).refused));
  assert.ok(/does not parse/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: "nope" }).refused));
});

t("…and a refused or mismatched signer, the CLKN mint authority, or a payer that is the receive wallet / treasury / a listed wallet never sends", async () => {
  const A = pk();
  // refused signer
  let w = world(); await w.configure({ rows: [row(A, 100)] });
  w.signer = { refused: "the payer secret is the same key as MM_OPERATOR_SECRET" };
  w.ch.addIncoming({ from: A, amount: cuna(10) }); await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0); assert.strictEqual(w.m.armFacts().payerLoaded, false);
  // a key that is not the configured payer
  w.signer = { keypair: web3.Keypair.generate() }; await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0); assert.ok(/the configured payer is/.test(w.m.armFacts().payerWhy), w.m.armFacts().payerWhy);
  // the payer is the CLKN mint authority
  w.signer = { keypair: w.payerKp }; w.ch.mintAuthority = w.payer; await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 0); assert.ok(w.alerts.some((a) => /mint authority/.test(a.text)));
  w.ch.mintAuthority = null; await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
  // config refusals
  w = world();
  assert.ok(w.m.setPayer(w.payer).ok);
  assert.strictEqual((await w.m.setReceive(w.payer)).ok, false, "receive = payer");
  assert.strictEqual(w.m.setPayer(TREASURY).ok, false, "payer = treasury");
  assert.ok((await w.m.setReceive(w.receive)).ok);
  assert.strictEqual(w.m.setPayer(w.receive).ok, false, "payer = receive");
  assert.ok(w.m.setList([row(A, 1)]).ok);
  assert.strictEqual(w.m.setPayer(A).ok, false, "payer = a listed wallet");
  assert.strictEqual((await w.m.setReceive(TREASURY)).ok, false, "receive = treasury");
  // a payer pubkey configured as a listed wallet through the back door is still refused at signing
  const L = w.kv.get("cunaMigList"); const c = w.kv.get("cunaMigConfig");
  const kpL = web3.Keypair.generate();
  assert.ok(w.kv.setVerified("cunaMigList", { ...L, rows: L.rows.concat([row(kpL.publicKey.toBase58(), 1)]) }));
  assert.ok(w.kv.setVerified("cunaMigConfig", { ...c, payerPubkey: kpL.publicKey.toBase58() }));
  w.signer = { keypair: kpL };
  assert.ok(/listed wallet/.test(w.m.armFacts().payerWhy));
});

section("receive wallet");

t("the receive wallet must be a plain system wallet, not on the list, and is settable only while disarmed with an empty journal", async () => {
  const A = pk();
  const w = world();
  const prog = pk(); w.ch.accountOwners.set(prog, TOKEN);
  assert.strictEqual((await w.m.setReceive(prog)).ok, false, "a token-program-owned account");
  assert.strictEqual((await w.m.setReceive("notanaddress")).ok, false);
  const pda = web3.PublicKey.findProgramAddressSync([Buffer.from("x")], new web3.PublicKey(TOKEN))[0].toBase58();
  assert.strictEqual((await w.m.setReceive(pda)).ok, false, "off-curve");
  await w.configure({ rows: [row(A, 100)], arm: false });
  assert.strictEqual(w.m.setList([row(w.receive, 1)]).ok, false, "receive wallet on the list");
  const r = await w.m.setReceive(pk()); assert.ok(r.ok, "still changeable while disarmed with an empty journal");
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  assert.strictEqual((await w.m.setReceive(pk())).ok, false, "armed");
  w.m.disarm();
  assert.ok((await w.m.setReceive(w.receive)).ok);
  w.ch.addIncoming({ from: A, amount: cuna(1) });
  await w.tick(1);
  assert.strictEqual(w.entries().length, 1);
  const again = await w.m.setReceive(pk());
  assert.strictEqual(again.ok, false, "a journal with transfers pins the receive wallet");
  assert.strictEqual(w.m.setList([row(A, 5)]).ok, false, "…and the list");
});

t("the token program id constant is the real one", () => {
  assert.strictEqual(M.TOKEN_PROGRAM, spl.TOKEN_PROGRAM_ID.toBase58());
});

t("transfers at or before the since slot are never read", async () => {
  const A = pk();
  const w = world();
  w.ch.addIncoming({ from: A, amount: cuna(5), slot: 999 });
  await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(7) });
  await w.tick(3);
  assert.strictEqual(w.entries().length, 1);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(7)));
});

section("Day 0");

t("the dry run leaves the journal bytes unchanged and lists each locker; run=1 pays each locker once (locks + rewards); a second run pays nothing; a holder who is also a locker gets both", async () => {
  const H = pk(), L1 = pk(), L2 = pk();
  const w = world(); await w.configure({ rows: [row(H, 100, "500", "25"), row(L1, 0, "1000", "0"), row(L2, 0, "0", "77")] });
  const before = JSON.stringify(w.kv.get("cunaMigJournal", null));
  const p = await w.m.day0Preview();
  assert.strictEqual(JSON.stringify(w.kv.get("cunaMigJournal", null)), before, "dry run writes nothing");
  assert.strictEqual(p.dryRun, true); assert.strictEqual(p.lockers, 3); assert.strictEqual(p.totalClknRaw, "1602");
  assert.strictEqual(p.rows.find((r) => r.wallet === H).clknRaw, "525");
  assert.strictEqual((await w.m.day0Run("nope")).ok, false, "needs the confirm word");
  const r = await w.m.day0Run("pay-day0");
  assert.ok(r.ok); assert.strictEqual(r.created, 3);
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, L1), 1000n); assert.strictEqual(deliveredOf(w, L2), 77n); assert.strictEqual(deliveredOf(w, H), 525n);
  const r2 = await w.m.day0Run("pay-day0");
  assert.strictEqual(r2.created, 0);
  await w.tick(2);
  assert.strictEqual(w.ch.sends.length, 3);
  w.ch.addIncoming({ from: H, amount: cuna(100) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, H), 525n + owed(cuna(100)), "the send-in entitlement is independent of Day 0");
});

t("Day 0 needs the full two-flag arm", async () => {
  const L1 = pk();
  const w = world(); await w.configure({ rows: [row(L1, 0, "10", "0")], arm: false });
  const r = await w.m.day0Run("pay-day0");
  assert.strictEqual(r.ok, false); assert.strictEqual(w.entries().length, 0);
});

section("durability");

t("a journal write failure before a send: nothing is broadcast that tick; the signed attempt is adopted next tick and pays exactly once", async () => {
  const A = pk();
  const w2 = world(); await w2.configure({ rows: [row(A, 100)] });
  w2.ch.addIncoming({ from: A, amount: cuna(10) });
  let failing = false;
  const realKv = w2.kv;
  const wrapped = { ...realKv, get: realKv.get, set: realKv.set, setVerified: (k, v) => (failing ? false : realKv.setVerified(k, v)), setManyVerified: realKv.setManyVerified, isPersistent: realKv.isPersistent, loadError: realKv.loadError };
  w2.boot({ kv: wrapped });
  w2.fp.after_claim = () => { failing = true; };
  await w2.m.tick("t");
  assert.strictEqual(w2.ch.sends.length, 0, "nothing broadcast when the journal write failed");
  delete w2.fp.after_claim; failing = false;
  await w2.tick(3);
  assert.strictEqual(deliveredOf(w2, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w2, A), 1);
});

t("a store that is not persistent, or that failed to load, does nothing at all", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  const kv = w.kv;
  w.boot({ kv: { ...kv, get: kv.get, setVerified: kv.setVerified, isPersistent: () => false, loadError: () => null } });
  let r = await w.m.tick("t");
  assert.strictEqual(r.ok, false); assert.strictEqual(w.ch.sends.length, 0);
  w.boot({ kv: { ...kv, get: kv.get, setVerified: kv.setVerified, isPersistent: () => true, loadError: () => "corrupt" } });
  r = await w.m.tick("t");
  assert.strictEqual(r.ok, false); assert.strictEqual(w.ch.sends.length, 0);
  assert.strictEqual(w.m.armFacts().armed, false);
});

t("an alert that returns null (Telegram down) changes no journal state", async () => {
  const A = pk();
  const w = world(); w.alertReturns = null; await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.entries()[0][1].state, "paid");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
});

section("anomalies");

t("a payout that landed with the wrong CLKN deltas: the entry freezes as an anomaly, everything halts, nothing is retried; ack clears the halt but the entry stays frozen", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["wrongAmount"];
  await w.tick(2);
  const e = w.entries()[0][1];
  assert.strictEqual(e.state, "anomaly"); assert.strictEqual(w.journal().halted.code, "anomaly");
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 1, "nothing is sent while halted");
  assert.strictEqual(w.m.ack("wrong").ok, false);
  assert.ok(w.m.ack("anomaly").ok);
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(10)));
  assert.strictEqual(w.entries().find(([, x]) => x.sender === A)[1].state, "anomaly");
  assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("three dead attempts (each failed on chain) → held attempts_exhausted, never a fourth", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendMode = "failErr";
  await w.tick(6);
  const e = w.entries()[0][1];
  assert.strictEqual(e.state, "held"); assert.strictEqual(e.reason, "attempts_exhausted");
  assert.strictEqual(e.attempts.length, 3); assert.strictEqual(w.ch.sends.length, 3);
  assert.strictEqual(deliveredOf(w, A), 0n);
});

t("an owner hold= moves a due entry to held:owner and it is never paid", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)], arm: false });
  const sig = w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(1);
  assert.ok(w.m.hold(sig).ok);
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0);
  assert.strictEqual(w.journal().entries[sig].reason, "owner");
});

t("a credited total that does not match its entries halts", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)], arm: false });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(1);
  const j = w.journal(); j.credited[A] = "1"; assert.ok(w.kv.setVerified("cunaMigJournal", j));
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  await w.tick(1);
  assert.strictEqual(w.journal().halted.code, "credit_mismatch");
  assert.strictEqual(w.ch.sends.length, 0);
});

section("reads");

t("the public lookup returns only the queried wallet's own row and no admin fields; status carries the hash, totals and USD figure", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100, "3", "4"), row(B, 50)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  await w.tick(3);
  const v = w.m.publicLookup(A);
  assert.strictEqual(v.listed, true); assert.strictEqual(v.sendInMaxCunaRaw, cuna(100)); assert.strictEqual(v.remainingCunaRaw, cuna(90));
  assert.strictEqual(v.transfers.length, 1); assert.ok(v.transfers[0].paySig);
  assert.strictEqual(v.totals.clknPaidRaw, owed(cuna(10)).toString());
  assert.strictEqual(v.day0.state, "not_started"); assert.strictEqual(v.day0.clknRaw, "7");
  const s = JSON.stringify(v);
  for (const bad of [B, "sha256", "txBase64", "cursors", "halted", "lamports", w.payer]) assert.ok(!s.includes(bad), "public lookup leaked " + bad);
  assert.strictEqual(w.m.publicLookup(pk()).listed, false);
  const st = await w.m.status();
  assert.strictEqual(st.list.rowCount, 2); assert.ok(/^[0-9a-f]{64}$/.test(st.list.sha256));
  assert.strictEqual(st.list.totals.totalClknNeededRaw, (owed(cuna(150)) + 7n).toString());
  assert.strictEqual(st.list.clknUsd, 0.0002);
  assert.strictEqual(st.list.totalClknNeededUsdIndicative, Math.round(Number(st.list.totals.totalClknNeededRaw) / 1e9 * 0.0002 * 100) / 100);
  assert.strictEqual(st.totals.paidClknRaw, (owed(cuna(10)) * 2n).toString());
  assert.ok(st.payer.clknRaw && st.payer.solNeededEstimateLamports > 0);
});

t("status is a pure read: it never ticks", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  const before = JSON.stringify(w.kv.get("cunaMigJournal", null));
  await w.m.status(); await w.m.day0Preview(); w.m.publicTerms(); w.m.publicLookup(A);
  assert.strictEqual(JSON.stringify(w.kv.get("cunaMigJournal", null)), before);
  assert.strictEqual(w.ch.sends.length, 0);
});

// ── The list converter (scripts/cuna-migration-list.cjs) ──────────────────────────────────────
section("paying from the treasury (owner, 2026-11-14)");

// Treasury mode needs the owner's reserves and an explicit cap stated in env (above the list total,
// so the cap stays the list total in these tests).
const TENV = { CUNA_MIGRATION_PAYER_SOURCE: "treasury", CUNA_MIGRATION_SOL_RESERVE_LAMPORTS: "100000000", CUNA_MIGRATION_CLKN_RESERVE_RAW: "0", CUNA_MIGRATION_MAX_CLKN_RAW: "1" + "0".repeat(30) };

t("CUNA_MIGRATION_PAYER_SOURCE=treasury loads MM_OPERATOR_SECRET_TREASURY; both sources, a missing key or an unknown source are refused", () => {
  const { loadPayerSignerFromEnv } = freshMonitorModule();
  const kp = web3.Keypair.generate();
  const b58 = bs58.encode(kp.secretKey), arr = JSON.stringify(Array.from(kp.secretKey));
  const s = loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SOURCE: "treasury", MM_OPERATOR_SECRET_TREASURY: arr });
  assert.ok(s.keypair.publicKey.equals(kp.publicKey)); assert.strictEqual(s.source, "treasury");
  assert.ok(/set only one/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SOURCE: "treasury", MM_OPERATOR_SECRET_TREASURY: arr, CUNA_MIGRATION_PAYER_SECRET: b58 }).refused));
  assert.ok(/is not set/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SOURCE: "treasury" }).refused));
  assert.ok(/does not parse/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SOURCE: "treasury", MM_OPERATOR_SECRET_TREASURY: "nope" }).refused));
  assert.ok(/not a known source/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SOURCE: "clkn", MM_OPERATOR_SECRET_TREASURY: arr }).refused));
  // Without the source, the dedicated path still refuses the treasury key.
  assert.ok(/MM_OPERATOR_SECRET_TREASURY/.test(loadPayerSignerFromEnv({ CUNA_MIGRATION_PAYER_SECRET: b58, MM_OPERATOR_SECRET_TREASURY: arr }).refused));
});

t("treasury mode pays once from the treasury; without the env the treasury is refused, and with it any other payer is refused", async () => {
  const A = pk();
  const tkp = web3.Keypair.generate(), T = tkp.publicKey.toBase58();
  // on purpose: the treasury pays
  let w = world({ payerKp: tkp, treasury: T, env: TENV, signer: { keypair: tkp, source: "treasury" } });
  await w.configure({ rows: [row(A, 100)] });
  assert.strictEqual(w.m.armFacts().armed, true, JSON.stringify(w.m.armFacts()));
  assert.strictEqual(w.m.armFacts().payerSource, "treasury");
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3); await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(w.ch.sends.length, 1);
  // the treasury key loaded, but the env no longer says treasury: nothing arms
  w.env = { CUNA_MIGRATION_ON: "1" };
  assert.strictEqual(w.m.armFacts().armed, false); assert.ok(/does not match/.test(w.m.armFacts().payerWhy), w.m.armFacts().payerWhy);
  // a dedicated key that happens to be the treasury, with the env set: still refused (the source must say treasury)
  w.env = { CUNA_MIGRATION_ON: "1", ...TENV }; w.signer = { keypair: tkp };
  assert.strictEqual(w.m.armFacts().armed, false); assert.ok(/pay from it on purpose/.test(w.m.armFacts().payerWhy), w.m.armFacts().payerWhy);
  // setPayer: the treasury needs the env, and the env allows only the treasury
  w = world({ treasury: T });
  assert.strictEqual(w.m.setPayer(T).ok, false, "treasury without the env");
  w = world({ treasury: T, env: TENV });
  assert.strictEqual(w.m.setPayer(w.payer).ok, false, "a non-treasury payer with the env");
  assert.ok(w.m.setPayer(T).ok);
  // the treasury can never be on the list or be the receive wallet
  assert.strictEqual(w.m.setList([row(T, 1)]).ok, false);
  assert.strictEqual((await w.m.setReceive(T)).ok, false);
});

t("the payer-history scan floor: payouts above it are still caught after a lost journal; the real floor predates this code", async () => {
  assert.ok(M.MEMO_EPOCH_SLOT > 466132529 && M.MEMO_EPOCH_SLOT < 469370219, "between the snapshot slot and the 2026-11-14 15:00 UTC slot");
  const A = pk();
  const w = world({ memoEpochSlot: 900 }); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  assert.ok(w.kv.setVerified("cunaMigJournal", M.emptyJournal()));
  fs.rmSync(w.attemptsDir, { recursive: true, force: true });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 1, "no new payout");
  assert.strictEqual(w.journal().halted.code, "unknown_memo");
});

t("the payout shape check: only compute budget, the recipient's CLKN ATA create, ONE CLKN TransferChecked of the planned amount and the memo, signed by the payer alone", () => {
  const { assertPayoutShape } = freshMonitorModule();
  const payerKp = web3.Keypair.generate(), payer = payerKp.publicKey, owner = new web3.PublicKey(pk()), mint = new web3.PublicKey(CLKN);
  const src = spl.getAssociatedTokenAddressSync(mint, payer, false), dst = spl.getAssociatedTokenAddressSync(mint, owner, true);
  const build = (mut = {}) => {
    const tx = new web3.Transaction({ feePayer: payer, blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 10 })
      .add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }))
      .add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }))
      .add(spl.createAssociatedTokenAccountIdempotentInstruction(payer, dst, owner, mut.ataMint || mint))
      .add(spl.createTransferCheckedInstruction(src, mut.mint || mint, mut.dst || dst, payer, mut.amount || 5n, 9))
      .add(new web3.TransactionInstruction({ keys: [], programId: new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: Buffer.from("CLKN migration x #1") }));
    if (mut.extra) tx.add(mut.extra);
    return tx;
  };
  const x = { payer: payer.toBase58(), mint: CLKN, owner: owner.toBase58(), amountRaw: "5", key: "x", n: 1, cuPriceMax: 50000 };
  assertPayoutShape(build(), x);
  const other = new web3.PublicKey(CUNA);
  assert.throws(() => assertPayoutShape(build({ extra: web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: owner, lamports: 1 }) }), x), /unexpected instructions/);
  assert.throws(() => assertPayoutShape(build({ mint: other }), x), /planned CLKN amount/);
  assert.throws(() => assertPayoutShape(build({ amount: 6n }), x), /planned CLKN amount/);
  assert.throws(() => assertPayoutShape(build({ dst: spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(pk()), true) }), x), /planned CLKN amount/);
  assert.throws(() => assertPayoutShape(build({ ataMint: other }), x), /ATA create/);
});

t("treasury mode does not arm without the owner's SOL reserve (at least 0.05 SOL), CLKN reserve and explicit cap; a value that does not parse is not armed in either mode", async () => {
  const A = pk();
  const tkp = web3.Keypair.generate(), T = tkp.publicKey.toBase58();
  const w = world({ payerKp: tkp, treasury: T, env: TENV, signer: { keypair: tkp, source: "treasury" } });
  await w.configure({ rows: [row(A, 100)], arm: false });
  for (const drop of ["CUNA_MIGRATION_SOL_RESERVE_LAMPORTS", "CUNA_MIGRATION_CLKN_RESERVE_RAW", "CUNA_MIGRATION_MAX_CLKN_RAW"]) {
    const env = { CUNA_MIGRATION_ON: "1", ...TENV }; delete env[drop]; w.env = env;
    const r = w.m.arm("arm-cuna-migration");
    assert.strictEqual(r.ok, false, drop); assert.ok(r.error.includes(drop), r.error);
    assert.strictEqual(w.m.armFacts().armed, false, drop);
  }
  w.env = { CUNA_MIGRATION_ON: "1", ...TENV, CUNA_MIGRATION_SOL_RESERVE_LAMPORTS: "10000000" };
  assert.ok(/at least/.test(w.m.arm("arm-cuna-migration").error));
  w.env = { CUNA_MIGRATION_ON: "1", ...TENV };
  assert.ok(w.m.arm("arm-cuna-migration").ok);
  assert.strictEqual(w.m.armFacts().armed, true);
  // the env losing a reserve later disarms the send path, even with the kv arm set
  w.env = { CUNA_MIGRATION_ON: "1", ...TENV }; delete w.env.CUNA_MIGRATION_CLKN_RESERVE_RAW;
  assert.strictEqual(w.m.armFacts().armed, false);
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0);
  // a dedicated payer with a reserve that does not parse is not armed either
  const d = world(); await d.configure({ rows: [row(A, 100)] });
  d.env = { CUNA_MIGRATION_ON: "1", CUNA_MIGRATION_SOL_RESERVE_LAMPORTS: "0.5" };
  assert.strictEqual(d.m.armFacts().armed, false); assert.ok(/not a raw integer/.test(d.m.armFacts().reservesWhy));
});

t("treasury mode: payouts never take the treasury below its SOL reserve or its CLKN reserve, and the priority fee is capped lower", async () => {
  const A = pk(), B = pk();
  const tkp = web3.Keypair.generate(), T = tkp.publicKey.toBase58();
  const env = { ...TENV, CUNA_MIGRATION_SOL_RESERVE_LAMPORTS: "300000000", CUNA_MIGRATION_CLKN_RESERVE_RAW: (1000n * E9).toString(), CUNA_MIGRATION_CU_PRICE: "500000" };
  const w = world({ payerKp: tkp, treasury: T, env, signer: { keypair: tkp, source: "treasury" } });
  await w.configure({ rows: [row(A, 1000000), row(B, 1000000)] });
  assert.strictEqual(w.m.armFacts().armed, true, JSON.stringify(w.m.armFacts()));
  assert.strictEqual((await w.m.status()).cap.cuPrice, 50000, "the treasury's priority-fee ceiling");
  // CLKN: the treasury holds the reserve plus A's payout less one raw unit, so A waits
  const need = owed(cuna(100000));
  w.ch.payerClkn = 1000n * E9 + need - 1n;
  w.ch.addIncoming({ from: A, amount: cuna(100000) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0, "the CLKN reserve is never spent");
  assert.strictEqual((await w.m.status()).payer.coversRemaining, false);
  w.ch.payerClkn += 1n;
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), need);
  assert.strictEqual(w.ch.payerClkn, 1000n * E9, "exactly the reserve is left");
  // SOL: just under reserve + fee + rent, B waits
  w.ch.payerClkn = 10n ** 24n;
  const fee = 5000 + Math.ceil((50000 * 100000) / 1e6);
  w.ch.payerLamports = BigInt(300000000 + fee + 2039280 - 1);
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, B), 0n, "the SOL reserve is never spent");
  const st = await w.m.status();
  assert.strictEqual(st.payer.solReserveLamports, 300000000);
  w.ch.payerLamports += 1n;
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(10)));
});

t("payer rotation (dedicated -> treasury) then a lost journal: the old payer's history is still read, so its payout is never paid again", async () => {
  for (const wipeConfigHistory of [false, true]) {
    const A = pk();
    const tkp = web3.Keypair.generate(), T = tkp.publicKey.toBase58();
    const w = world({ treasury: T });
    await w.configure({ rows: [row(A, 1000)] });
    w.ch.addIncoming({ from: A, amount: cuna(10) });
    await w.tick(3);
    assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
    assert.ok(w.m.disarm().ok);
    w.env = { CUNA_MIGRATION_ON: "1", ...TENV };
    w.signer = { keypair: tkp, source: "treasury" };
    w.ch.payers.add(T);
    const r = w.m.setPayer(T); assert.ok(r.ok, JSON.stringify(r));
    assert.deepStrictEqual(r.payerHistory, [w.payer, T]);
    assert.ok(w.m.arm("arm-cuna-migration").ok);
    await w.tick(2);
    // the journal and the attempt files are lost; in the second pass a config restore drops the
    // config's own history too, and only the separate kv key remembers the old payer
    assert.ok(w.kv.setVerified("cunaMigJournal", M.emptyJournal()));
    if (wipeConfigHistory) { const c = { ...w.kv.get("cunaMigConfig") }; delete c.payerHistory; assert.ok(w.kv.setVerified("cunaMigConfig", c)); }
    fs.rmSync(w.attemptsDir, { recursive: true, force: true });
    w.boot();
    await w.tick(4);
    assert.strictEqual(deliveredOf(w, A), owed(cuna(10)), "A was paid twice" + (wipeConfigHistory ? " (config history wiped)" : ""));
    assert.strictEqual(w.ch.sends.length, 1);
    assert.strictEqual(w.journal().halted && w.journal().halted.code, "unknown_memo");
  }
});

t("more stranger memo rows in ONE slot than a tick may fetch: verdicts are kept across ticks, the cursor moves past the slot, and a later send-in is paid", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(5) });
  await w.tick(3);
  const s = ++w.ch.slot;
  for (let i = 0; i < 51; i++) { const sig = w.ch.addForeignMemo(`CLKN migration junk${i} #1`); w.ch.payouts.get(sig).slot = s; }
  w.ch.slot = s;
  w.ch.addIncoming({ from: A, amount: cuna(7) });
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(5)) + owed(cuna(7)));
  assert.ok(w.journal().payerCursors[w.payer].slot >= s, "the cursor is past the stall slot");
  assert.strictEqual(w.journal().halted, null);
});

t("a stranger who names the payer in more memo rows every tick than a tick may check cannot hold up payouts for keys those rows do not name", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(9) });
  let n = 0;
  for (let i = 0; i < 10; i++) { for (let k = 0; k < 51; k++) w.ch.addForeignMemo(`CLKN migration junk${n++} #1`); await w.tick(1); }
  assert.strictEqual(deliveredOf(w, A), owed(cuna(9)));
  assert.strictEqual(w.journal().halted, null);
});

t("…but a key that unchecked rows DO name waits until they are checked; and a payer-signed payout hidden behind them (a lost journal) still halts, never pays twice", async () => {
  const A = pk();
  const w = world({ limits: { maxFetch: 5 } }); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  const [key] = w.entries()[0];
  const real = w.ch.sends[0].sig, realSlot = w.ch.payouts.get(real).slot;
  // 30 stranger rows naming the same key, all BELOW the real payout, so they are checked first
  for (let i = 0; i < 30; i++) { const sig = w.ch.addForeignMemo(`CLKN migration ${key} #1`); w.ch.payouts.get(sig).slot = realSlot - 1; }
  assert.ok(w.kv.setVerified("cunaMigJournal", M.emptyJournal()));
  fs.rmSync(w.attemptsDir, { recursive: true, force: true });
  w.boot();
  await w.tick(1);
  assert.strictEqual(w.journal().entries[key].state, "due", "re-detected");
  assert.strictEqual(w.ch.sends.length, 1, "the key waits while rows naming it are unchecked");
  await w.tick(8);
  assert.strictEqual(w.ch.sends.length, 1, "no second payout");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  assert.strictEqual(w.journal().halted && w.journal().halted.code, "unknown_memo");
});

section("the list converter");

t("decimal CUNA/CLKN become exact raw-integer strings; a value with more than 9 decimals or a float-only form is refused", () => {
  const conv = require("./cuna-migration-list.cjs");
  const a = pk(), b = pk();
  const out = conv.convertRows([{ wallet: a, sendCuna: 1234567.123456789, locks: 0, rew: 0 }, { wallet: b, sendCuna: "0", locks: "1000.5", rew: 2 }]);
  assert.deepStrictEqual(out.rows[0], { wallet: a, sendInMaxCunaRaw: "1234567123456789", day0LocksClknRaw: "0", day0RewardsClknRaw: "0" });
  assert.deepStrictEqual(out.rows[1], { wallet: b, sendInMaxCunaRaw: "0", day0LocksClknRaw: "1000500000000", day0RewardsClknRaw: "2000000000" });
  assert.strictEqual(conv.toRaw("0.000000001"), "1");
  assert.strictEqual(conv.toRaw(27700), "27700000000000");
  assert.throws(() => conv.toRaw("1.0000000001"), /9 decimals/);
  assert.throws(() => conv.toRaw(-1));
  assert.throws(() => conv.toRaw(1e21), /exponent|safe/);
  assert.throws(() => conv.toRaw("abc"));
  assert.ok(M.validateList(out.rows).ok, "its output is a valid upload");
});

t("the CLI reads JSON numbers from their source text (never through a float) and prints the upload body", () => {
  const conv = require("./cuna-migration-list.cjs");
  const a = pk();
  // 9007199254.740993 is not representable as a double; parsed as a number it would become ...0992.
  const { parsed } = conv.parseExact(`[{"wallet":"${a}","sendCuna":9007199254.740993,"locks":0,"rew":0.1}]`);
  const body = conv.convertRows(parsed);
  assert.strictEqual(body.rows[0].sendInMaxCunaRaw, "9007199254740993000");
  assert.strictEqual(body.rows[0].day0RewardsClknRaw, "100000000");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuna-mig-list-"));
  const f = path.join(dir, "ledger.json");
  fs.writeFileSync(f, `[{"wallet":"${a}","sendCuna":1000000,"locks":12.5,"rew":0}]`);
  const r = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "cuna-migration-list.cjs"), f], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const up = JSON.parse(r.stdout);
  assert.deepStrictEqual(up.rows, [{ wallet: a, sendInMaxCunaRaw: "1000000000000000", day0LocksClknRaw: "12500000000", day0RewardsClknRaw: "0" }]);
  assert.ok(/sha256\s+[0-9a-f]{64}/.test(r.stderr) && r.stderr.includes(M.validateList(up.rows).sha256));
  fs.writeFileSync(f, `[{"wallet":"${a}","sendCuna":1.0000000001,"locks":0,"rew":0}]`);
  const bad = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "cuna-migration-list.cjs"), f], { encoding: "utf8" });
  assert.notStrictEqual(bad.status, 0); assert.ok(/more than 9 decimals/.test(bad.stderr));
  // Exact on every Node version (CI runs 20): a number a double cannot hold survives, digits inside a
  // string are left alone, and a negative or exponent amount is refused, never converted.
  const p2 = conv.parseExact(`[{"wallet":"${a} 1.5","sendCuna":123456789.123456789,"locks":0.000000001,"rew":"7","allowOffCurve":true}]`).parsed;
  assert.strictEqual(p2[0].wallet, `${a} 1.5`); assert.strictEqual(p2[0].sendCuna, "123456789.123456789");
  assert.strictEqual(p2[0].allowOffCurve, true);
  assert.strictEqual(conv.convertRows(p2).rows[0].sendInMaxCunaRaw, "123456789123456789");
  assert.strictEqual(conv.convertRows(p2).rows[0].day0LocksClknRaw, "1");
  assert.throws(() => conv.convertRows(conv.parseExact(`[{"wallet":"${a}","sendCuna":-1}]`).parsed), /not a plain non-negative decimal/);
  assert.throws(() => conv.convertRows(conv.parseExact(`[{"wallet":"${a}","sendCuna":4.155E+4}]`).parsed), /not a plain non-negative decimal/);
});

// ── Adversarial review (2026-11-14): each case below failed against the code before its fix ──
section("review: an error is final only at finalized");

t("judgeAttempt: an err at processed or confirmed is WAIT; only an err at finalized is failed", () => {
  const a = { paySig: "x", n: 1, clknRaw: "5", recipient: "r", lastValidBlockHeight: 100, at: 0 };
  const o = { nowS: 1, payer: "p", clknMint: CLKN };
  const err = { InstructionError: [3, { Custom: 1 }] };
  assert.strictEqual(M.judgeAttempt(a, { status: { err, confirmationStatus: "processed" } }, o).verdict, "wait");
  assert.strictEqual(M.judgeAttempt(a, { status: { err, confirmationStatus: "confirmed" } }, o).verdict, "wait");
  assert.strictEqual(M.judgeAttempt(a, { status: { err, confirmationStatus: "finalized" } }, o).verdict, "failed");
});

t("an error seen at PROCESSED does not kill the attempt: no second payout is built, and when the same bytes land cleanly it pays ONCE", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(400) });
  w.ch.sendModes = ["failErr"]; w.ch.statusCommitment = "processed";
  await w.m.tick("t1");
  const first = w.ch.sends[0];
  w.advance(1, 5); await w.m.tick("t2");
  assert.strictEqual(new Set(w.ch.sends.map((x) => x.sig)).size, 1, "no attempt #2 while #1 is not final");
  // the errored fork is dropped; #1 lands without error on the canonical fork
  const p1 = w.ch.payouts.get(first.sig); p1.err = null; p1.deliveredAmt = p1.amount;
  w.ch.delivered.set(A, (w.ch.delivered.get(A) || 0n) + p1.amount);
  w.ch.statusCommitment = "finalized";
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(400)));
  assert.strictEqual(w.entries()[0][1].state, "paid");
  assert.strictEqual(new Set(w.ch.sends.map((x) => x.sig)).size, 1);
});

t("…and an error that reaches FINALIZED is failed: exactly one retry, paid once", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  w.ch.sendModes = ["failErr"]; w.ch.statusCommitment = "processed";
  await w.tick(2);
  assert.strictEqual(w.entries()[0][1].attempts[0].outcome, "live");
  w.ch.statusCommitment = "finalized";
  await w.tick(4);
  const e = w.entries()[0][1];
  assert.strictEqual(e.attempts[0].outcome, "failed"); assert.strictEqual(e.state, "paid");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

section("review: the memo witness runs every tick, over every payer, and only counts payer-signed rows");

t("a payout wrongly judged dead lands late on a lagging node AFTER its retry paid: with nothing left due, the witness still revives it and the second landing halts as an anomaly", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(30) });
  await w.m.tick("t");
  const s1 = w.ch.sends[0].sig;
  w.ch.statusLag.set(s1, 1000); w.ch.historyHide.add(s1);    // the node shows neither its status nor its history
  w.advance(400, 0); await w.m.tick("t");
  w.advance(5, 61); await w.m.tick("t");                     // judged expired; attempt #2 sent and lands
  await w.tick(2);
  assert.strictEqual(w.entries()[0][1].state, "paid");
  assert.strictEqual(uniqueLandedFor(w, A), 2, "the setup: both attempts landed on chain");
  w.ch.statusLag.set(s1, 0); w.ch.historyHide.delete(s1);    // the node catches up; nothing is due any more
  await w.tick(3);
  assert.strictEqual(w.journal().halted && w.journal().halted.code, "anomaly", "the double payment is flagged");
  assert.strictEqual(w.entries()[0][1].state, "anomaly");
  assert.strictEqual(w.m.armFacts().armed, false);
});

t("a stranger's transaction that names the payer with a migration memo does not halt anything; the holder is paid", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addForeignMemo("CLKN migration grief #1");
  w.ch.addIncoming({ from: A, amount: cuna(400) });
  await w.tick(3);
  assert.strictEqual(w.journal().halted, null);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(400)));
});

t("a payer-SIGNED memo the journal does not own halts ONCE; it is adopted into its entry, so after the ack nothing re-halts and nothing pays twice", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(40) });
  await w.tick(3);
  assert.ok(w.kv.setVerified("cunaMigJournal", M.emptyJournal()));
  fs.rmSync(w.attemptsDir, { recursive: true, force: true });
  w.boot();
  await w.tick(2);
  assert.strictEqual(w.journal().halted.code, "unknown_memo");
  assert.ok(w.m.ack("unknown_memo").ok);
  await w.tick(4);
  assert.strictEqual(w.journal().halted, null, "the same memo does not halt again");
  assert.strictEqual(w.ch.sends.length, 1, "no second payout");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(40)));
  assert.strictEqual(w.entries()[0][1].state, "paid", "the adopted payout is recorded from the chain");
});

t("rotating the payer while an old-payer payout is wrongly judged dead never pays twice: the old payer's history is still read", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(30) });
  await w.m.tick("t");
  const s1 = w.ch.sends[0].sig;
  w.ch.statusLag.set(s1, 1000);
  w.m.disarm();
  w.advance(400, 0); await w.m.tick("t");
  w.advance(5, 61); await w.m.tick("t");
  const P2 = web3.Keypair.generate();
  w.ch.payers.add(P2.publicKey.toBase58());
  const r = w.m.setPayer(P2.publicKey.toBase58());
  if (r.ok) {
    w.signer = { keypair: P2 };
    assert.ok(w.m.arm("arm-cuna-migration").ok);
    w.ch.statusLag.set(s1, 0);
    await w.tick(4);
  }
  assert.strictEqual(deliveredOf(w, A), owed(cuna(30)));
  assert.strictEqual(uniqueLandedFor(w, A), 1);
});

section("review: spam cannot stop the monitor");

t("more than 20 pages of dust signatures between ticks: the walk resumes instead of stalling, and a real send-in behind them is paid", async () => {
  const A = pk();
  const w = world({ limits: { maxFetch: 5000 } }); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(1) });
  await w.tick(2);
  const spammer = pk();
  for (let i = 0; i < 20001; i++) w.ch.addIncoming({ from: spammer, amount: "1" });
  w.ch.addIncoming({ from: A, amount: cuna(100) });
  for (let i = 0; i < 12 && deliveredOf(w, A) < owed(cuna(1)) + owed(cuna(100)); i++) await w.tick(1);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(1)) + owed(cuna(100)));
  assert.strictEqual(w.entries().length, 2, "dust is never an entry");
  assert.strictEqual(w.journal().skipped.dust.count, 20001);
});

t("a journal with more than MAX_ENTRIES held entries still resolves in-flight payouts and still pays; only PAYABLE entries count", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000), row(B, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["drop"];
  await w.m.tick("t");                                       // A's attempt is live, not landed
  const j = w.journal();
  for (let i = 0; i <= M.MAX_ENTRIES; i++) j.entries["junk" + i] = { kind: "sendin", sig: "junk" + i, slot: 1, blockTime: 1, sender: pk(), receivedCunaRaw: "1", creditCunaRaw: "0", excessCunaRaw: "1", clknRaw: "0", state: "held", reason: "unlisted_sender", attempts: [] };
  assert.ok(w.kv.setVerified("cunaMigJournal", j));
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)), "A's in-flight payout was resolved (rebroadcast and landed)");
  assert.strictEqual(deliveredOf(w, B), owed(cuna(10)));
});

t("dust (under 1 CUNA) from anyone is counted, never an entry and never credited; a listed wallet sees its dust in the public lookup", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  for (let i = 0; i < 3; i++) w.ch.addIncoming({ from: pk(), amount: "1" });
  w.ch.addIncoming({ from: A, amount: "999999999" });
  await w.tick(3);
  assert.strictEqual(w.entries().length, 0);
  const sk = w.journal().skipped;
  assert.strictEqual(sk.dust.count, 4); assert.strictEqual(sk.dust.cunaRaw, "1000000002");
  assert.strictEqual(w.journal().credited[A], undefined);
  const v = w.m.publicLookup(A);
  assert.strictEqual(v.dust.cunaRaw, "999999999"); assert.strictEqual(v.totals.cunaReceivedRaw, "999999999");
  assert.strictEqual(v.transfers.length, 1); assert.strictEqual(v.transfers[0].heldReason, "dust");
  assert.strictEqual(w.ch.sends.length, 0);
  await w.tick(2);
  assert.strictEqual(w.journal().skipped.dust.count, 4, "re-reading never counts twice");
});

section("review: dust payouts cannot drain the payer or crowd others out");

t("one payout per recipient per tick", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000), row(B, 1000)] });
  for (let i = 0; i < 3; i++) w.ch.addIncoming({ from: A, amount: cuna(2) });
  w.ch.addIncoming({ from: B, amount: cuna(5) });
  await w.m.tick("t");
  const to = w.ch.sends.map((x) => x.recipient);
  assert.strictEqual(to.filter((x) => x === A).length, 1); assert.strictEqual(to.filter((x) => x === B).length, 1);
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(2)) * 3n);
});

t("a wallet that was paid and then closed its CLKN account is held, not re-funded the account rent", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
  w.ch.closedAtas.add(w.ch.clknAtaOf(A));
  const s2 = w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.journal().entries[s2].state, "held"); assert.strictEqual(w.journal().entries[s2].reason, "recipient_ata_closed");
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
  assert.strictEqual(w.ch.sends.length, 1);
});

section("review: off-curve recipients");

t("an off-curve (program-derived) wallet is refused on upload unless its row says allowOffCurve:true; the opt-in is part of the hash", () => {
  const [pda] = web3.PublicKey.findProgramAddressSync([Buffer.from("escrow")], new web3.PublicKey(TOKEN));
  const P = pda.toBase58();
  assert.ok(!M.isWalletAddress(P));
  const A = pk();
  const plain = M.validateList([row(A, 10), row(P, 0, "5", "0")]);
  assert.strictEqual(plain.ok, false); assert.ok(plain.errors.some((e) => /OFF the curve/.test(e)));
  const opted = M.validateList([row(A, 10), { ...row(P, 0, "5", "0"), allowOffCurve: true }]);
  assert.ok(opted.ok); assert.deepStrictEqual(opted.offCurve, [P]);
  const onlyA = M.validateList([row(A, 10)]);
  assert.strictEqual(onlyA.sha256, M.validateList([{ ...row(A, 10), allowOffCurve: false }]).sha256, "an on-curve list hashes as before");
  assert.ok(opted.rows.find((r) => r.wallet === P).allowOffCurve === true);
  assert.ok(M.offCurveRefused({ wallet: P })); assert.ok(!M.offCurveRefused({ wallet: P, allowOffCurve: true })); assert.ok(!M.offCurveRefused({ wallet: A }));
});


section("review: the payout shape is checked against the plan, and stored bytes are checked before a rebroadcast");

const MEMO_PID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// A payout built by hand in the exact shape the monitor builds, with any one piece swapped out.
function payoutTx({ payerKp, owner, amount, key, n, blockhash, mut = {} }) {
  const payer = payerKp.publicKey, mint = new web3.PublicKey(CLKN), ow = new web3.PublicKey(owner);
  const src = mut.src || spl.getAssociatedTokenAddressSync(mint, payer, false), dst = mut.dst || spl.getAssociatedTokenAddressSync(mint, ow, true);
  let ata = mut.nonIdempotent ? spl.createAssociatedTokenAccountInstruction(mut.funder || payer, dst, ow, mint) : spl.createAssociatedTokenAccountIdempotentInstruction(mut.funder || payer, dst, ow, mint);
  if (mut.ataKeys) ata = new web3.TransactionInstruction({ keys: mut.ataKeys(ata.keys), programId: ata.programId, data: ata.data });
  return new web3.Transaction({ feePayer: payer, blockhash: blockhash || bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 10 })
    .add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: mut.units || 100000 }))
    .add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: mut.price != null ? mut.price : 20000 }))
    .add(ata)
    .add(spl.createTransferCheckedInstruction(src, mint, dst, payer, BigInt(amount), 9))
    .add(new web3.TransactionInstruction({ keys: mut.memoKeys || [], programId: MEMO_PID, data: Buffer.from(mut.memo || M.memoFor(key, n)) }));
}

t("the shape check derives the token accounts itself and decodes the ATA create, the compute budget and the memo", () => {
  const { assertPayoutShape } = freshMonitorModule();
  const payerKp = web3.Keypair.generate(), other = web3.Keypair.generate(), owner = pk();
  const x = { payer: payerKp.publicKey.toBase58(), mint: CLKN, owner, amountRaw: "5", key: "sigK", n: 2, cuPriceMax: 50000 };
  const b = (mut) => payoutTx({ payerKp, owner, amount: 5n, key: "sigK", n: 2, mut });
  assertPayoutShape(b(), x);
  // the builder's own accounts are not trusted: a plan that names a wrong source still fails
  const wrongSrc = new web3.PublicKey(pk());
  assert.throws(() => assertPayoutShape(b({ src: wrongSrc }), { ...x, src: wrongSrc.toBase58() }), /planned CLKN amount/);
  assert.throws(() => assertPayoutShape(b({ nonIdempotent: true }), x), /CreateIdempotent/);
  assert.throws(() => assertPayoutShape(b({ funder: other.publicKey }), x), /funded by the payer/);
  assert.throws(() => assertPayoutShape(b({ ataKeys: (k) => [k[0], k[1], k[2], k[3], k[5], k[4]] }), x), /System and Token programs/);
  assert.throws(() => assertPayoutShape(b({ units: 1400000 }), x), /compute unit limit/);
  assert.throws(() => assertPayoutShape(b({ price: 10000000000 }), x), /above the ceiling/);
  assert.throws(() => assertPayoutShape(b({ price: 50001 }), x), /above the ceiling/);
  assertPayoutShape(b({ price: 50000 }), x);
  assert.throws(() => assertPayoutShape(b({ price: 60000 }), { ...x, cuPriceMax: 50000 }), /above the ceiling/);
  assert.throws(() => assertPayoutShape(b({ memoKeys: [{ pubkey: new web3.PublicKey(pk()), isSigner: false, isWritable: true }] }), x), /memo carries accounts/);
  assert.throws(() => assertPayoutShape(b({ memo: M.memoFor("sigK", 3) }), x), /attempt's memo/);
  assert.throws(() => assertPayoutShape(b(), { ...x, n: 1 }), /attempt's memo/);
  const { key, ...noKey } = x; void key;
  assert.throws(() => assertPayoutShape(b(), noKey), /plan is incomplete/);
  const { cuPriceMax, ...noCeil } = x; void cuPriceMax;
  assert.throws(() => assertPayoutShape(b(), noCeil), /ceiling/);
});

t("treasury mode: the monitor's own payouts carry a price at or under the treasury ceiling, the exact CU limit and the attempt's memo", async () => {
  const { assertPayoutShape, CU_PRICE_MAX_TREASURY } = freshMonitorModule();
  const A = pk();
  const tkp = web3.Keypair.generate(), T = tkp.publicKey.toBase58();
  const w = world({ payerKp: tkp, treasury: T, env: { ...TENV, CUNA_MIGRATION_CU_PRICE: "999999" }, signer: { keypair: tkp, source: "treasury" } });
  await w.configure({ rows: [row(A, 100)] });
  const sig = w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 1);
  const tx = w.ch.sends[0].tx;
  assertPayoutShape(tx, { payer: T, mint: CLKN, owner: A, amountRaw: owed(cuna(10)).toString(), key: sig, n: 1, cuPriceMax: CU_PRICE_MAX_TREASURY });
  assert.throws(() => assertPayoutShape(tx, { payer: T, mint: CLKN, owner: A, amountRaw: owed(cuna(10)).toString(), key: sig, n: 1, cuPriceMax: CU_PRICE_MAX_TREASURY - 1 }), /above the ceiling/);
});

t("stored bytes whose signature is not the attempt's paySig are never rebroadcast: the entry freezes as an anomaly and everything halts", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)] });
  const sig = w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["drop"];
  await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 1);
  const j = w.journal(); const a = j.entries[sig].attempts[0];
  // Other valid, payer-signed bytes (a different blockhash, so a different signature) in the journal's copy.
  const { blockhash } = await w.ch.conn.getLatestBlockhash();
  const other = payoutTx({ payerKp: w.payerKp, owner: A, amount: BigInt(a.clknRaw), key: sig, n: 1, blockhash }); other.sign(w.payerKp);
  a.txBase64 = other.serialize().toString("base64");
  assert.ok(w.kv.setVerified("cunaMigJournal", j));
  const otherSig = bs58.encode(other.signature);
  await w.m.tick("t");
  assert.strictEqual(w.ch.sends.length, 1, "nothing was rebroadcast");
  assert.ok(!w.ch.payouts.has(otherSig), "the other bytes never reached the chain");
  const e = w.journal().entries[sig];
  assert.strictEqual(e.state, "anomaly"); assert.ok(/paySig/.test(e.reason), e.reason);
  assert.strictEqual(w.journal().halted.code, "anomaly");
  assert.ok(w.alerts.some((x) => /stored bytes/.test(x.text)), "the owner is told");
  // after the ack the entry stays frozen and is never paid; others pay
  assert.ok(w.m.ack("anomaly").ok);
  w.ch.addIncoming({ from: B, amount: cuna(10) });
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), 0n);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(10)));
  assert.strictEqual(w.journal().entries[sig].state, "anomaly");
});

t("an adopted attempt file whose bytes carry the paySig but are not this payout's shape is never rebroadcast", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  const sig = w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.fp.after_claim = () => { throw new Error("CRASH"); };
  await assert.rejects(w.m.tick("t"), /CRASH/);
  delete w.fp.after_claim;
  const name = fs.readdirSync(w.attemptsDir)[0];
  const f = JSON.parse(fs.readFileSync(path.join(w.attemptsDir, name), "utf8"));
  // The same signature over a different message (twice the amount): the signature no longer verifies,
  // and the message is not the planned payout.
  const t2 = payoutTx({ payerKp: w.payerKp, owner: A, amount: BigInt(f.clknRaw) * 2n, key: sig, n: 1, blockhash: f.blockhash });
  t2.lastValidBlockHeight = f.lastValidBlockHeight;
  t2.addSignature(w.payerKp.publicKey, Buffer.from(bs58.decode(f.paySig)));
  f.txBase64 = t2.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  fs.writeFileSync(path.join(w.attemptsDir, name), JSON.stringify(f));
  w.boot();
  await w.m.tick("t");
  const e = w.journal().entries[sig];
  assert.ok(e.attempts[0].adopted);
  assert.strictEqual(e.state, "anomaly", e.state + " " + e.reason); assert.ok(/stored payout bytes refused/.test(e.reason), e.reason);
  assert.strictEqual(w.journal().halted.code, "anomaly");
  assert.strictEqual(w.ch.sends.length, 0, "nothing was put on the wire");
  await w.tick(3);
  assert.strictEqual(w.ch.sends.length, 0); assert.strictEqual(deliveredOf(w, A), 0n);
});

t("a build that fails the shape check holds that ONE entry (payout_shape_refused), alerts once for it, and sends nothing else that tick; the rest stay due", async () => {
  const A = pk(), B = pk(), C = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100), row(C, 100)] });
  const sA = w.ch.addIncoming({ from: A, amount: cuna(10) });
  const sB = w.ch.addIncoming({ from: B, amount: cuna(10) });
  w.ch.addIncoming({ from: C, amount: cuna(10) });
  // A library change that encodes the priority fee wrongly for the first two builds (A and B).
  const orig = web3.ComputeBudgetProgram.setComputeUnitPrice;
  let calls = 0;
  web3.ComputeBudgetProgram.setComputeUnitPrice = function (p) { calls++; return orig.call(this, calls <= 2 ? { microLamports: Number(p.microLamports) * 1000000 } : p); };
  let r;
  try { r = await w.m.tick("t"); } finally { web3.ComputeBudgetProgram.setComputeUnitPrice = orig; }
  assert.ok(r && r.ok, "the tick completed: " + JSON.stringify(r));
  let j = w.journal();
  assert.strictEqual(j.entries[sA].state, "held"); assert.strictEqual(j.entries[sA].reason, "payout_shape_refused");
  assert.strictEqual(j.entries[sB].state, "due", "the first refusal stops the tick: B was not built");
  assert.strictEqual(j.entries[sA].attempts.length, 0, "nothing was signed or recorded for it");
  assert.strictEqual(r.shapeRefused.length, 1);
  assert.strictEqual(w.ch.sends.length, 0, "nothing sent in the tick that refused");
  assert.ok(j.lastTick && j.lastTick.at, "lastTick is still written");
  web3.ComputeBudgetProgram.setComputeUnitPrice = function (p) { calls++; return orig.call(this, calls <= 2 ? { microLamports: Number(p.microLamports) * 1000000 } : p); };
  try { await w.tick(4); } finally { web3.ComputeBudgetProgram.setComputeUnitPrice = orig; }
  j = w.journal();
  assert.strictEqual(j.entries[sB].reason, "payout_shape_refused");
  const shapeAlerts = w.alerts.filter((x) => /^mig-shape:/.test(x.key || ""));
  assert.strictEqual(shapeAlerts.length, 2, "one alert per refused entry, each with its own dedupe key");
  assert.notStrictEqual(shapeAlerts[0].key, shapeAlerts[1].key); assert.ok(/above the ceiling/.test(shapeAlerts[0].text));
  assert.strictEqual(deliveredOf(w, C), owed(cuna(10)), "the other entry paid");
  assert.strictEqual(deliveredOf(w, A), 0n);
  // fixed: the owner releases it and it pays once
  const rel = await w.m.release(sA);
  assert.ok(rel.ok, JSON.stringify(rel));
  await w.tick(3);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("a build failure that hits EVERY payout holds one entry per tick, not the whole queue; once the cause is gone the rest pay with no release", async () => {
  const A = pk(), B = pk(), C = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100), row(C, 100)] });
  const sA = w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.addIncoming({ from: B, amount: cuna(10) }); w.ch.addIncoming({ from: C, amount: cuna(10) });
  const orig = web3.ComputeBudgetProgram.setComputeUnitPrice;
  web3.ComputeBudgetProgram.setComputeUnitPrice = function (p) { return orig.call(this, { microLamports: Number(p.microLamports) * 1000000 }); };
  try { await w.m.tick("t"); } finally { web3.ComputeBudgetProgram.setComputeUnitPrice = orig; }
  const held = w.entries().filter(([, e]) => e.state === "held");
  assert.strictEqual(held.length, 1, "one entry held, the others still due"); assert.strictEqual(held[0][0], sA);
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, B), owed(cuna(10))); assert.strictEqual(deliveredOf(w, C), owed(cuna(10)));
  assert.strictEqual(deliveredOf(w, A), 0n, "the held one waits for the owner's release");
});

t("stored bytes signed under the dedicated payer's wider fee ceiling are not frozen when the treasury source is switched on mid-flight", async () => {
  const A = pk();
  const w = world({ env: { CUNA_MIGRATION_CU_PRICE: "100000" } }); await w.configure({ rows: [row(A, 100)] });
  w.ch.addIncoming({ from: A, amount: cuna(10) });
  w.ch.sendModes = ["drop"];
  await w.m.tick("t");                       // signed at 100,000 micro-lamports and dropped
  assert.strictEqual(w.ch.sends.length, 1);
  // The ceiling for NEW builds drops to 50,000. This payer is not the treasury, so the monitor
  // disarms (nothing is rebroadcast), but the stored bytes are still judged every tick, and before
  // the fix they failed the current ceiling and froze the entry as an anomaly with a global halt.
  w.env = { ...w.env, CUNA_MIGRATION_PAYER_SOURCE: "treasury" };
  w.ch.sendMode = "land";
  await w.tick(2);
  let j = w.journal();
  assert.ok(!j.halted, "no halt: " + JSON.stringify(j.halted));
  assert.strictEqual(Object.values(j.entries)[0].state, "sending", "still a live payout, not frozen");
  assert.strictEqual(deliveredOf(w, A), 0n, "nothing rebroadcast while disarmed");
  // Switched back: the same stored bytes are rebroadcast and land once.
  const { CUNA_MIGRATION_PAYER_SOURCE, ...rest } = w.env; w.env = rest;
  await w.tick(3);
  j = w.journal();
  assert.ok(!j.halted);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w, A), 1);
  assert.strictEqual(new Set(w.ch.sends.map((s) => s.sig)).size, 1, "the same signature, never a second payout");
});

section("review: an entry held after attempts that never reached the chain");

async function exhaustByPreflight(w) {
  w.ch.sendMode = "preflightReject";
  for (let i = 0; i < 20; i++) {
    await w.m.tick("t");
    const e = w.entries()[0][1];
    if (e.state === "held") return e;
    w.advance(200, 61);
  }
  throw new Error("never held");
}

t("three payouts rejected at preflight hold the entry; release= returns it to due only once every attempt is dead on chain, and it then pays once with attempt #4", async () => {
  const A = pk();
  const w = world(); await w.configure({ rows: [row(A, 100)] });
  const sig = w.ch.addIncoming({ from: A, amount: cuna(10) });
  let e = await exhaustByPreflight(w);
  assert.strictEqual(e.reason, "attempts_exhausted"); assert.strictEqual(e.attempts.length, 3);
  assert.ok(e.attempts.every((a) => a.outcome === "expired"));
  assert.strictEqual(deliveredOf(w, A), 0n);
  w.ch.sendMode = "land";
  await w.tick(2);
  assert.strictEqual(w.journal().entries[sig].state, "held", "a held entry is never retried on its own");
  // refusals
  assert.strictEqual((await w.m.release("nope")).status, 404);
  w.ch.rpcFail.add("getSignatureStatuses");
  assert.strictEqual((await w.m.release(sig)).status, 503, "no chain read, no release");
  w.ch.rpcFail.delete("getSignatureStatuses");
  // a lagging node said not found, but attempt #3 is on chain after all: refused
  const s3 = e.attempts[2].paySig;
  w.ch.payouts.set(s3, { recipient: A, amount: 1n, memo: M.memoFor(sig, 3), slot: ++w.ch.slot, err: null, deliveredAmt: 0n, blockTime: T0, payer: w.payer });
  const r1 = await w.m.release(sig);
  assert.strictEqual(r1.ok, false); assert.strictEqual(r1.status, 409); assert.ok(/on chain/.test(r1.error), r1.error);
  w.ch.payouts.delete(s3);
  assert.strictEqual(w.journal().entries[sig].state, "held");
  // all dead: released
  const r2 = await w.m.release(sig);
  assert.ok(r2.ok, JSON.stringify(r2)); assert.strictEqual(r2.deadAttempts, 3);
  e = w.journal().entries[sig];
  assert.strictEqual(e.state, "due"); assert.strictEqual(e.releasedDead, 3);
  assert.strictEqual((await w.m.release(sig)).status, 409, "a due entry cannot be released");
  await w.tick(4);
  e = w.journal().entries[sig];
  assert.strictEqual(e.state, "paid"); assert.strictEqual(e.attempts.length, 4); assert.strictEqual(e.attempts[3].n, 4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10))); assert.strictEqual(uniqueLandedFor(w, A), 1);
});

t("release= refuses an entry held for any other reason, and one whose attempt file is not in the journal", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 100), row(B, 100)], arm: false });
  const sA = w.ch.addIncoming({ from: A, amount: cuna(10) });
  await w.tick(1);
  assert.ok(w.m.hold(sA).ok);
  const r = await w.m.release(sA);
  assert.strictEqual(r.status, 409); assert.ok(/attempts_exhausted/.test(r.error), r.error);
  // an exhausted entry beside an attempt file the journal does not list
  const w2 = world(); await w2.configure({ rows: [row(B, 100)] });
  const sB = w2.ch.addIncoming({ from: B, amount: cuna(10) });
  await exhaustByPreflight(w2);
  createAttemptStore(w2.attemptsDir).claim(sB, 9, { paySig: randSig(), clknRaw: "1", recipient: B, payer: w2.payer });
  const r2 = await w2.m.release(sB);
  assert.strictEqual(r2.status, 409); assert.ok(/not dead/.test(r2.error), r2.error);
});

section("review: the record matches the chain");

t("the epoch-slot comment and the runbook's list of treasury signers say what the code and chain say", () => {
  const lib = fs.readFileSync(path.join(__dirname, "..", "lib", "cuna-migration.js"), "utf8");
  assert.ok(/1794653315/.test(lib) && /2026-11-14 10:48:35 UTC/.test(lib), "the slot's block time");
  assert.ok(!/07:00 UTC/.test(lib));
  const rb = fs.readFileSync(path.join(__dirname, "..", "docs", "CUNA_MIGRATION_RUNBOOK.md"), "utf8");
  assert.ok(!/shared\s+with buy-comp, the Hub desk/.test(rb) && !/a payout and a\s+buy-comp payout can race/.test(rb), "buy-comp and the Hub desk do not sign with the treasury");
  assert.ok(/lib\/diploma-nft\.js/.test(rb) && /do\s+\*\*not\*\* sign with it/.test(rb));
  assert.ok(/release=<key>/.test(rb));
});

section("review: receive accounts");

t("a receive token account that was seen once and then closed is still walked; so is the receive wallet's CUNA ATA, listed or not", async () => {
  const A = pk(), B = pk();
  const w = world(); await w.configure({ rows: [row(A, 1000), row(B, 1000)] });
  const acct2 = w.ch.addReceiveAcct();
  await w.tick(1);                                           // acct2 is seen and recorded
  w.ch.addIncoming({ from: A, amount: cuna(10), to: acct2 });
  w.ch.receiveAccts = w.ch.receiveAccts.filter((x) => x.pubkey !== acct2);   // closed before the next tick
  const ata = spl.getAssociatedTokenAddressSync(new web3.PublicKey(CUNA), new web3.PublicKey(w.receive), false).toBase58();
  w.ch.addIncoming({ from: B, amount: cuna(20), to: ata });                   // into the ATA, never listed
  await w.tick(4);
  assert.strictEqual(deliveredOf(w, A), owed(cuna(10)));
  assert.strictEqual(deliveredOf(w, B), owed(cuna(20)));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
(async () => {
  const only = process.env.CUNA_MIG_ONLY || "";
  for (const [n, f] of queue) {
    if (!f) { console.log(`\n${n}`); continue; }
    if (only && !n.includes(only)) continue;
    try { await f(); pass++; console.log(`  ✓ ${n}`); }
    catch (e) { fail++; console.log(`  ✗ ${n}\n      ${(e && e.stack || e).toString().split("\n").slice(0, 4).join("\n      ")}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
