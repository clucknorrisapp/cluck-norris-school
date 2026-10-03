#!/usr/bin/env node
"use strict";
// The Seeker app's SKR-paid pass — the CLIENT half (src/seeker/skr-pay.js, driven through the real
// signing seam src/seeker/sign.js). The server half is scripts/tool-pass-skr-test.cjs.
//
// This moves a person's SKR, so what is pinned is the order and the classification, not the happy
// path alone:
//   1. the instruction bytes the page builds are byte-identical to @solana/spl-token's (AGENTS.md:
//      "diff its bytes against the library in Node") — classic AND Token-2022;
//   2. the quote is checked before a wallet is asked to sign (mint, program, amount ↔ amountUi);
//   3. the recovery record is written AFTER the wallet signs and BEFORE the transaction is
//      submitted and before any redemption request — and a record that cannot be stored stops the
//      broadcast (nothing is sent that cannot be recovered);
//   4. landed / failed / unconfirmed / declined stay four different things;
//   5. a retryable refusal (5xx, transport, "not visible yet") KEEPS the record; a grant or a
//      DEFINITIVE refusal clears it, and the refusal's reason is surfaced; reopening re-posts it;
//   6. a payment that never landed is released only when the node proves its blockhash dead.
// No network, no wallet: a fake window, a fake fetch, a real ed25519 keypair as the "wallet".
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const RECEIVER = "7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H";
const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

(async () => {
  // ── load the real browser modules into THIS process (one realm, real interop) ───────────────
  global.solanaWeb3 = web3;
  global.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "public", "cluck-wallet.js"), "utf8"), { filename: "cluck-wallet.js" });
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "public", "airdrop-engine.js"), "utf8"), { filename: "airdrop-engine.js" });
  const shim = global.splToken;
  if (!shim || typeof shim.createTransferCheckedInstruction !== "function") { console.log("  ✗ the splToken shim did not load"); process.exit(1); }
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, 0, ...a);   // confirmSignature's 30 one-second polls, instantly

  const payerKp = web3.Keypair.generate();
  const PAYER = payerKp.publicKey.toBase58();
  const state = { sendMode: "ok", statusMode: "landed", rpcLog: [], sent: [], height: 100, blockhashValid: true, txStatusNull: false };
  const randHash = () => web3.Keypair.generate().publicKey.toBase58();
  global.window = {
    solanaWeb3: web3, CluckWallet: global.CluckWallet, splToken: shim,
    CluckUtil: {
      rpc: async (method, params) => {
        state.rpcLog.push(method);
        if (method === "getLatestBlockhash") return { value: { blockhash: randHash(), lastValidBlockHeight: 1000 } };
        if (method === "sendTransaction") {
          state.sent.push(params[0]);
          if (state.sendMode === "transport") throw new Error("fetch failed");
          if (state.sendMode === "reject") { const e = new Error("Transaction simulation failed"); e.rpcError = true; throw e; }
          return web3.Transaction.from(Buffer.from(params[0], "base64")).signature ? require("bs58").encode(web3.Transaction.from(Buffer.from(params[0], "base64")).signature) : "x";
        }
        if (method === "getSignatureStatuses") {
          if (state.statusMode === "landed") return { value: [{ confirmationStatus: "confirmed", err: null }] };
          if (state.statusMode === "failed") return { value: [{ confirmationStatus: "confirmed", err: { InstructionError: [1, "Custom"] } }] };
          return { value: [null] };
        }
        if (method === "getBlockHeight") return state.height;
        if (method === "isBlockhashValid") return { value: state.blockhashValid };
        throw new Error("unexpected rpc " + method);
      },
    },
  };
  const rpc = (m, p) => global.window.CluckUtil.rpc(m, p);
  const mod = await import(path.join(ROOT, "src", "seeker", "skr-pay.js") + "?t=" + Date.now());

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────
  const ataOf = (program) => spl.getAssociatedTokenAddressSync(new web3.PublicKey(SKR_MINT), new web3.PublicKey(RECEIVER), true, new web3.PublicKey(program)).toBase58();
  const mkQuote = (over) => ({
    success: true, mint: SKR_MINT, decimals: 6, program: CLASSIC, usd: 1, priceUsd: 0.02, amountRaw: "50000000", amountUi: "50", days: 7,
    receiver: RECEIVER, receiverAta: ataOf(CLASSIC), receiverAtaExists: false, issuedAt: Date.now(), expiresAt: Date.now() + 600e3, quote: "body.mac", ...over,
  });
  function memStorage(opts = {}) {
    const m = new Map(); const log = [];
    return {
      setItem: (k, v) => { log.push("save"); if (opts.throwOnSet) throw new Error("QuotaExceededError"); if (!opts.silentDrop) m.set(k, v); },
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      removeItem: (k) => { log.push("clear"); m.delete(k); },
      log, raw: m,
    };
  }
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error("no body"); return body; } });
  const provider = (over = {}) => ({ publicKey: { toString: () => PAYER }, signTransaction: async (tx) => { tx.partialSign(payerKp); return tx; }, ...over });
  const reset = () => { state.sendMode = "ok"; state.statusMode = "landed"; state.rpcLog = []; state.sent = []; state.height = 100; state.blockhashValid = true; };
  const norm = (ix) => JSON.stringify({ p: ix.programId.toBase58(), k: ix.keys.map((k) => [k.pubkey.toBase58(), !!k.isSigner, !!k.isWritable]), d: Array.from(ix.data) });

  // ═══ 1. instruction bytes vs the library ═══════════════════════════════════════════════════
  console.log("\n1. the page's instructions are byte-identical to @solana/spl-token (classic + Token-2022)\n");
  for (const [label, program] of [["classic", CLASSIC], ["Token-2022", T22]]) {
    const q = mkQuote({ program, receiverAta: ataOf(program) });
    const source = web3.Keypair.generate().publicKey.toBase58();
    const tx = mod.buildSkrPayTx(web3, shim, { payer: PAYER, quote: q, source, blockhash: randHash() });
    const [createIx, transferIx] = tx.instructions;
    const P = new web3.PublicKey(program), mint = new web3.PublicKey(SKR_MINT), payer = new web3.PublicKey(PAYER), recv = new web3.PublicKey(RECEIVER);
    const ata = spl.getAssociatedTokenAddressSync(mint, recv, true, P);
    ok(`${label}: the shim's ATA derivation = the library's`, shim.getAssociatedTokenAddressSync(mint, recv, program).toBase58() === ata.toBase58());
    const libTransfer = spl.createTransferCheckedInstruction(new web3.PublicKey(source), mint, ata, payer, 50000000n, 6, [], P);
    ok(`${label}: TransferChecked (programId, key order/flags, data) = the library's`, norm(transferIx) === norm(libTransfer), { ours: norm(transferIx), lib: norm(libTransfer) });
    const libCreate = spl.createAssociatedTokenAccountIdempotentInstruction(payer, ata, recv, mint, P);
    // The shim's create-idempotent still passes the legacy SysvarRent key as a 7th account (the ATA
    // program ignores it) — scripts/verify-burn-close.cjs documents the same known, harmless
    // difference. Everything else must match exactly.
    const ours = createIx.keys.map((k) => [k.pubkey.toBase58(), !!k.isSigner, !!k.isWritable]);
    const lib = libCreate.keys.map((k) => [k.pubkey.toBase58(), !!k.isSigner, !!k.isWritable]);
    ok(`${label}: CreateIdempotent — programId, data and the first ${lib.length} accounts = the library's; the extra is SysvarRent`,
      createIx.programId.toBase58() === libCreate.programId.toBase58() && Buffer.compare(Buffer.from(createIx.data), Buffer.from(libCreate.data)) === 0
        && JSON.stringify(ours.slice(0, lib.length)) === JSON.stringify(lib) && ours.length - lib.length <= 1
        && (ours.length === lib.length || ours[ours.length - 1][0] === "SysvarRent111111111111111111111111111111111"), { ours, lib });
    ok(`${label}: exactly two instructions, fee payer = the payer`, tx.instructions.length === 2 && tx.feePayer.toBase58() === PAYER);
    ok(`${label}: the only signer the message requires is the payer`, tx.compileMessage().header.numRequiredSignatures === 1);
  }
  {
    let msg = "";
    try { mod.buildSkrPayTx(web3, shim, { payer: PAYER, quote: mkQuote({ receiverAta: web3.Keypair.generate().publicKey.toBase58() }), source: PAYER, blockhash: randHash() }); } catch (e) { msg = e.message; }
    ok("a quote whose receiving account is not the receiver's derived account is refused before signing", /does not match the receiver/.test(msg), msg);
  }

  // ═══ 2. the quote is checked before signing ═════════════════════════════════════════════════
  console.log("\n2. the quote is validated before a wallet is asked to sign\n");
  ok("a good quote passes", mod.validateQuote(mkQuote()) === null);
  ok("a quote naming another mint is refused", /different token/.test(mod.validateQuote(mkQuote({ mint: web3.Keypair.generate().publicKey.toBase58() })) || ""));
  ok("an unknown token program is refused", /program/.test(mod.validateQuote(mkQuote({ program: "11111111111111111111111111111111" })) || ""));
  ok("an amountUi that is not the amountRaw is refused (the sheet must print what is signed)", /self-consistent/.test(mod.validateQuote(mkQuote({ amountUi: "5" })) || ""));
  ok("a non-integer / leading-zero / negative amount is refused", ["0", "012", "-5", "5.5", "abc", ""].every((a) => mod.validateQuote(mkQuote({ amountRaw: a })) !== null));
  ok("a malformed receiver is refused", mod.validateQuote(mkQuote({ receiver: "nope" })) !== null);
  let r = await mod.fetchQuote(async () => resp(503, { success: false, error: "skr_price_unavailable" }), PAYER);
  ok("503 skr_price_unavailable → kind 'price' (no amount is ever guessed)", r.ok === false && r.kind === "price", r);
  r = await mod.fetchQuote(async () => { throw new Error("offline"); }, PAYER);
  ok("a network failure → kind 'offline'", r.ok === false && r.kind === "offline", r);
  r = await mod.fetchQuote(async () => resp(200, mkQuote({ mint: "x".repeat(44) })), PAYER);
  ok("a 200 whose quote fails validation → refused as 'error'", r.ok === false && r.kind === "error", r);
  r = await mod.fetchQuote(async () => resp(200, mkQuote()), PAYER);
  ok("a valid quote is returned", r.ok === true && r.quote.amountRaw === "50000000", r);

  // ═══ 3. reading the payer's SKR ═════════════════════════════════════════════════════════════
  console.log("\n3. the payer's SKR — look-alikes and frozen accounts do not count\n");
  {
    const acct = (pubkey, o) => ({ pubkey, account: { data: { parsed: { info: { mint: SKR_MINT, owner: PAYER, state: "initialized", tokenAmount: { amount: "0" }, ...o } } } } });
    const res = await mod.readSkrAccounts(async () => ({ value: [
      acct("A1", { tokenAmount: { amount: "30000000" } }),
      acct("A2", { tokenAmount: { amount: "70000000" } }),
      acct("A3", { tokenAmount: { amount: "999999999" }, state: "frozen" }),
      acct("A4", { tokenAmount: { amount: "999999999" }, owner: web3.Keypair.generate().publicKey.toBase58() }),
      acct("A5", { tokenAmount: { amount: "999999999" }, mint: web3.Keypair.generate().publicKey.toBase58() }),
    ] }), PAYER);
    ok("total counts only the owner's unfrozen SKR; the transfer source is the richest such account", res.total === 100000000n && res.best.pubkey === "A2", { total: String(res.total), best: res.best && res.best.pubkey });
    let threw = false; try { await mod.readSkrAccounts(async () => { throw new Error("rpc down"); }, PAYER); } catch (_) { threw = true; }
    ok("an RPC failure throws (the sheet says 'could not read', never 'you have none')", threw);
    threw = false; try { await mod.readSkrAccounts(async () => ({}), PAYER); } catch (_) { threw = true; }
    ok("a malformed answer throws too", threw);
  }

  // ═══ 4. ORDER: record → submit → redeem ════════════════════════════════════════════════════
  console.log("\n4. the recovery record is written BEFORE submission and BEFORE any redemption request\n");
  const quote = mkQuote();
  const source = web3.Keypair.generate().publicKey.toBase58();
  const INTENT = "intent.mac";
  async function payAndRedeem({ fetchImpl, storage, refreshIntent, prov }) {
    const events = [];
    const origRpc = global.window.CluckUtil.rpc;
    global.window.CluckUtil.rpc = async (m, p) => { if (m === "sendTransaction") events.push("send"); return origRpc(m, p); };
    const origSet = storage.setItem; storage.setItem = (k, v) => { events.push("save"); return origSet(k, v); };
    const fetchFn = async (u, o) => { events.push("session"); return fetchImpl(u, o); };
    let res, out = null;
    try {
      res = await mod.paySkr({ provider: prov || provider(), owner: PAYER, quote, source, payIntent: INTENT, storage });
      if (res.status === "sent") out = await mod.redeemRecord({ fetchFn, storage, wallet: PAYER, refreshIntent });
    } finally { global.window.CluckUtil.rpc = origRpc; }
    return { res, out, events };
  }
  const grantBody = { success: true, via: "paid-skr", pass: "t:abc.def", days: 7, termDays: 7, recovered: false };
  {
    reset(); const st = memStorage();
    const bodies = [];
    const { res, out, events } = await payAndRedeem({ storage: st, fetchImpl: async (u, o) => { bodies.push(JSON.parse(o.body)); return resp(200, grantBody); } });
    ok("landed → status 'sent'", res.status === "sent" && !!res.sig, res);
    ok("ORDER: save → send → session (record before submit, submit before redemption)", events.join(",") === "save,send,session", events);
    const sent = web3.Transaction.from(Buffer.from(state.sent[0], "base64"));
    ok("the submitted transaction is the built one: 2 instructions, signed by the payer alone", sent.instructions.length === 2 && sent.verifySignatures() && sent.signatures.length === 1 && sent.feePayer.toBase58() === PAYER);
    ok("the session request carries wallet, payIntent, paySig, payKind:'skr' and the quote token", bodies[0].wallet === PAYER && bodies[0].payIntent === INTENT && bodies[0].paySig === res.sig && bodies[0].payKind === "skr" && bodies[0].skrQuote === "body.mac", bodies[0]);
    ok("a grant clears the record and returns the pass", out.kind === "granted" && out.pass === "t:abc.def" && mod.loadRecord(st, PAYER) === null, out);
  }
  {
    // A record that cannot be stored must STOP the broadcast.
    reset(); const st = memStorage({ throwOnSet: true });
    const { res, events } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody) });
    ok("storage throws → nothing is sent: status 'failed', sendTransaction NEVER called", res.status === "failed" && !events.includes("send") && state.sent.length === 0, { res, events });
    reset(); const st2 = memStorage({ silentDrop: true });
    const r2 = await payAndRedeem({ storage: st2, fetchImpl: async () => resp(200, grantBody) });
    ok("storage that silently drops the write (read-back mismatch) → nothing is sent either", r2.res.status === "failed" && state.sent.length === 0, r2.res);
  }

  // ═══ 5. the four outcomes stay apart ═══════════════════════════════════════════════════════
  console.log("\n5. landed / failed / unconfirmed / declined\n");
  {
    reset(); state.sendMode = "reject"; const st = memStorage();
    const { res } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody) });
    ok("the NODE refused it → 'failed', record cleared, retry is safe", res.status === "failed" && mod.loadRecord(st, PAYER) === null, res);
  }
  {
    reset(); state.statusMode = "failed"; const st = memStorage();
    const { res } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody) });
    ok("it landed and FAILED on-chain → 'failed', record cleared (nobody was paid)", res.status === "failed" && /failed on-chain/.test(res.error || "") && mod.loadRecord(st, PAYER) === null, res);
  }
  {
    reset(); state.sendMode = "transport"; state.statusMode = "none"; const st = memStorage();
    const { res, events } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody) });
    ok("a transport failure with no status → 'unconfirmed' (NOT failed, NOT sent), signature kept", res.status === "unconfirmed" && !!res.sig, res);
    ok("…and the record was stored before the submit that threw, and stays", events[0] === "save" && mod.loadRecord(st, PAYER) && mod.loadRecord(st, PAYER).paySig === res.sig, events);
  }
  {
    reset(); const st = memStorage();
    const { res } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody), prov: provider({ signTransaction: async () => { const e = new Error("User rejected the request."); e.code = 4001; throw e; } }) });
    ok("declined in the wallet → 'declined', no record, nothing sent", res.status === "declined" && mod.loadRecord(st, PAYER) === null && state.sent.length === 0, res);
  }
  {
    reset(); const st = memStorage();
    const other = web3.Keypair.generate().publicKey.toBase58();
    const { res } = await payAndRedeem({ storage: st, fetchImpl: async () => resp(200, grantBody), prov: provider({ publicKey: { toString: () => other } }) });
    ok("the wallet switched accounts → refused before building anything; nothing sent, nothing stored", res.status === "failed" && /switched accounts/.test(res.error || "") && state.sent.length === 0 && mod.loadRecord(st, PAYER) === null, res);
  }

  // ═══ 6. redemption: keep on retryable, clear on grant/definitive ═══════════════════════════
  console.log("\n6. redemption — retryable keeps the record, a grant or a definitive refusal clears it\n");
  function seeded() { reset(); const st = memStorage(); mod.saveRecord(st, { wallet: PAYER, paySig: "S".repeat(88), skrQuote: "q.t", payIntent: INTENT, at: Date.now(), recentBlockhash: randHash(), lastValidBlockHeight: 1000, amountUi: "50" }); return st; }
  const redeem = (st, fetchFn, refreshIntent) => mod.redeemRecord({ fetchFn, storage: st, wallet: PAYER, refreshIntent });
  {
    let st = seeded();
    let out = await redeem(st, async () => resp(503, { success: false, error: "could not check this payment right now", retry: true, code: "skr_unavailable" }));
    ok("a 503 'unavailable' → retry, record KEPT", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    out = await redeem(st, async () => { throw new Error("network"); });
    ok("a transport failure → retry, record KEPT", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    out = await redeem(st, async () => resp(200, { success: false, error: "the chain has not shown this payment yet", retry: true, definitive: false, code: "skr_not_found_yet" }));
    ok("'not visible yet' → retry, record KEPT", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    out = await redeem(st, async () => resp(502, undefined));
    ok("an HTML/non-JSON 502 → retry, record KEPT", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    out = await redeem(st, async () => resp(401, { success: false, error: "skr quote invalid — request a new one", code: "skr_quote_invalid" }));
    ok("an unverifiable quote is not 'definitive' → record KEPT, error shown", out.kind === "retry" && /quote invalid/.test(out.error || "") && !!mod.loadRecord(st, PAYER), out);
    out = await redeem(st, async () => resp(200, grantBody));
    ok("REOPEN: re-posting the kept record after the outage → granted, record cleared", out.kind === "granted" && mod.loadRecord(st, PAYER) === null, out);
  }
  for (const [code, error, status] of [["amount_too_low", "amount too low", 200], ["different_wallet", "payment was made by a different wallet", 403], ["outside_window", "this payment landed after its quote expired, so it was priced on a stale number", 200], ["used_elsewhere", "this payment was already used for a platform-access month", 409]]) {
    const st = seeded();
    const out = await redeem(st, async () => resp(status, { success: false, error, code, definitive: true }));
    ok(`DEFINITIVE '${code}' → refused with its reason, record cleared`, out.kind === "refused" && out.error === error && out.code === code && mod.loadRecord(st, PAYER) === null, out);
  }
  {
    // pay intent expiry
    let st = seeded(); const seen = [];
    let out = await redeem(st, async (u, o) => { const b = JSON.parse(o.body); seen.push(b.payIntent); return b.payIntent === "fresh.intent" ? resp(200, grantBody) : resp(401, { success: false, error: "pay intent expired — connect again" }); }, async () => "fresh.intent");
    ok("'pay intent expired' → one fresh sign-in, the same signature re-posted with the new intent → granted", out.kind === "granted" && seen.join(",") === INTENT + ",fresh.intent", { out, seen });
    st = seeded();
    out = await redeem(st, async () => resp(401, { success: false, error: "pay intent expired — connect again" }), async () => null);
    ok("…and if the person does not sign in again → 'signin', record KEPT", out.kind === "signin" && !!mod.loadRecord(st, PAYER), out);
    st = seeded();
    out = await redeem(st, async () => resp(401, { success: false, error: "pay intent expired — connect again" }), null);
    ok("…an automatic reopen never prompts: no refresher → 'signin', record KEPT", out.kind === "signin" && !!mod.loadRecord(st, PAYER), out);
    ok("with no record there is nothing to post", (await mod.redeemRecord({ fetchFn: async () => { throw new Error("must not be called"); }, storage: memStorage(), wallet: PAYER })).kind === "none");
    const old = memStorage(); old.setItem("clkn_seeker_skrpay:" + PAYER, JSON.stringify({ wallet: PAYER, paySig: "S", at: Date.now() - 9 * 24 * 3600e3 }));
    ok("a record older than 8 days is dropped, not replayed", mod.loadRecord(old, PAYER) === null);
    const other = memStorage(); other.setItem("clkn_seeker_skrpay:" + PAYER, JSON.stringify({ wallet: "SomeoneElse", paySig: "S", at: Date.now() }));
    ok("a record for another wallet is never loaded", mod.loadRecord(other, PAYER) === null);
  }

  // ═══ 7. "Check payment" — releasing a payment that never landed ════════════════════════════
  console.log("\n7. Check payment — only a provably dead blockhash releases a record\n");
  const notFound = async () => resp(200, { success: false, error: "the chain has not shown this payment yet", retry: true, code: "skr_not_found_yet" });
  {
    let st = seeded(); state.statusMode = "none"; state.height = 5000; state.blockhashValid = false;
    let out = await mod.checkPayment({ fetchFn: notFound, storage: st, wallet: PAYER, rpc });
    ok("not visible + node says the blockhash is dead (height past, isBlockhashValid false) → 'never-landed', record cleared", out.kind === "never-landed" && mod.loadRecord(st, PAYER) === null, out);
    st = seeded(); state.height = 5000; state.blockhashValid = true;
    out = await mod.checkPayment({ fetchFn: notFound, storage: st, wallet: PAYER, rpc });
    ok("blockhash still valid → the record is KEPT (it could still land)", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    st = seeded(); state.height = 100; state.blockhashValid = false;
    out = await mod.checkPayment({ fetchFn: notFound, storage: st, wallet: PAYER, rpc });
    ok("height not past the limit → KEPT even if isBlockhashValid says false", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    st = seeded(); state.statusMode = "failed";
    out = await mod.checkPayment({ fetchFn: notFound, storage: st, wallet: PAYER, rpc });
    ok("it landed and failed on-chain → released as never paid", out.kind === "never-landed" && mod.loadRecord(st, PAYER) === null, out);
    st = seeded(); state.statusMode = "landed";
    out = await mod.checkPayment({ fetchFn: notFound, storage: st, wallet: PAYER, rpc });
    ok("it landed but the service has not caught up → KEPT (never released while it is on chain)", out.kind === "retry" && !!mod.loadRecord(st, PAYER), out);
    st = seeded(); state.statusMode = "landed";
    out = await mod.checkPayment({ fetchFn: async () => resp(200, grantBody), storage: st, wallet: PAYER, rpc });
    ok("a grant short-circuits the chain check", out.kind === "granted" && mod.loadRecord(st, PAYER) === null, out);
  }

  // ═══ 8. source-level guards on the page ════════════════════════════════════════════════════
  console.log("\n8. source guards — no web3.js layout encoder, one signing seam, no hardcoded amount\n");
  {
    const files = ["skr-pay.js", "passgate.jsx"].map((f) => fs.readFileSync(path.join(ROOT, "src", "seeker", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
    const all = files.join("\n");
    ok("no SystemProgram.transfer / web3.js token encoder in the page code", !/SystemProgram\.transfer|createTransferInstruction\b|toBufferLE/.test(all));
    ok("no direct sendTransaction / getSignatureStatuses / signTransaction call outside sign.js", !/sendTransaction|getSignatureStatuses|\.signTransaction\(|signAndSendTransaction/.test(all));
    ok("the SKR amount is never a literal in the page code (it is the server's quote)", !/50000000|"50"|=\s*50\b/.test(all));
  }

  console.log(`\n${fail ? fail + " FAILED, " : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
