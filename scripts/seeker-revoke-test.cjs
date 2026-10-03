#!/usr/bin/env node
"use strict";
// Seeker app — REVOKE approvals (src/seeker/revoke.js) + the two full-edition-only Checkup
// pieces (CheckupRevoke.jsx, Disconnect.jsx). THIS SIGNS WITH THE PERSON'S WALLET.
//
// No live RPC, no real wallet, nothing signed: revoke.js is imported under Node (22 auto-detects
// the ESM syntax) with a fake rpc; the instruction it builds is diffed BYTE-FOR-BYTE against
// @solana/spl-token's createRevokeInstruction for both token programs (AGENTS.md: a hand-built
// instruction is diffed against the library in Node before shipping); the "empirical" re-read
// keeps cleared / still-delegated / unreadable apart and never counts a failed read as cleared;
// the batch planner caps, de-duplicates and refuses rows it cannot act on; the signing path is
// sign.js's signSendConfirm and nothing else (no inline sendTransaction, no SystemProgram, no
// web3 import); and the shared WalletCheckup.jsx / education edition never gain a reference to
// anything the store build refuses.
//
// Usage: node scripts/seeker-revoke-test.cjs
const fs = require("fs");
const path = require("path");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};
const pk = () => web3.Keypair.generate().publicKey.toBase58();

(async () => {
  const R = await import(path.join(ROOT, "src", "seeker", "revoke.js") + "?t=" + Date.now());

  console.log("\n(a) the Revoke instruction, byte-for-byte against @solana/spl-token\n");
  for (const [label, program, lib] of [["legacy", R.TOKEN_PROGRAM, spl.TOKEN_PROGRAM_ID], ["Token-2022", R.TOKEN_2022_PROGRAM, spl.TOKEN_2022_PROGRAM_ID]]) {
    const acct = pk(), owner = pk();
    const ours = R.revokeDescriptor(acct, owner, program);
    const ref = spl.createRevokeInstruction(new web3.PublicKey(acct), new web3.PublicKey(owner), [], lib);
    ok(`${label}: program id matches the library's`, ours.programId === ref.programId.toBase58() && program === lib.toBase58());
    ok(`${label}: data is exactly the library's bytes`, Buffer.from(ours.data).equals(Buffer.from(ref.data)), { ours: ours.data, ref: [...ref.data] });
    const keysEq = ours.keys.length === ref.keys.length && ours.keys.every((k, i) =>
      k.pubkey === ref.keys[i].pubkey.toBase58() && !!k.isSigner === ref.keys[i].isSigner && !!k.isWritable === ref.keys[i].isWritable);
    ok(`${label}: account list matches (token account writable, owner signer) in order`, keysEq, { ours: ours.keys, ref: ref.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })) });
  }
  ok("the whole instruction is one byte of data — nothing to encode, no Buffer needed", R.REVOKE_TAG === 5 && R.revokeDescriptor(pk(), pk(), R.TOKEN_PROGRAM).data.length === 1);

  console.log("\n(b) planning a batch — cap, de-dupe, refuse what cannot be acted on\n");
  {
    const rows = [];
    for (let i = 0; i < 11; i++) rows.push({ tokenAccount: pk(), mint: pk(), delegate: pk(), program: i % 2 ? R.TOKEN_2022_PROGRAM : R.TOKEN_PROGRAM });
    const p = R.planRevoke(rows);
    ok(`11 approvals → a batch of ${R.MAX_REVOKE_PER_TX} and 3 remaining`, p.batch.length === R.MAX_REVOKE_PER_TX && p.remaining.length === 3 && p.skipped.length === 0, { batch: p.batch.length, remaining: p.remaining.length });
    ok("the batch keeps each row's own program (never re-guessed)", p.batch.every((b, i) => b.program === rows[i].program));
    const dup = R.planRevoke([rows[0], rows[0], rows[1]]);
    ok("the same token account twice is revoked once", dup.batch.length === 2);
    const bad = R.planRevoke([{ tokenAccount: "not-an-address", program: R.TOKEN_PROGRAM }, { tokenAccount: pk(), program: pk() }, rows[2]]);
    ok("a malformed account and an unknown program are SKIPPED and reported, not built", bad.batch.length === 1 && bad.skipped.length === 2, { batch: bad.batch.length, skipped: bad.skipped.length });
    ok("a row with no program defaults to the legacy token program (the scanner's own default)", R.revocable({ tokenAccount: pk() }).program === R.TOKEN_PROGRAM);
    ok("an empty list plans nothing", R.planRevoke([]).batch.length === 0 && R.planRevoke(null).batch.length === 0);
  }

  console.log("\n(c) the empirical re-read — cleared / still delegated / unreadable are three answers\n");
  {
    const a = pk(), b = pk(), c = pk(), d = pk();
    const parsed = (delegate) => ({ data: { parsed: { info: delegate ? { delegate } : {} } } });
    const rpc = async (m, params) => {
      if (m !== "getMultipleAccounts") throw new Error("unexpected " + m);
      const list = params[0];
      return { value: list.map((x) => x === a ? parsed(null) : x === b ? parsed(pk()) : x === c ? null : { data: "base64-not-parsed" }) };
    };
    const v = await R.verifyRevoked(rpc, [a, b, c, d]);
    ok("an account with no delegate → cleared", v.cleared.includes(a));
    ok("an account that STILL has a delegate → still (with the delegate named)", v.still.length === 1 && v.still[0].tokenAccount === b && v.still[0].delegate);
    ok("an account that no longer exists → cleared (nothing can be delegated on it)", v.cleared.includes(c));
    ok("an account the RPC returned unparsed → UNREADABLE, never cleared", v.unreadable.includes(d) && !v.cleared.includes(d));
    const down = await R.verifyRevoked(async () => { throw new Error("rpc down"); }, [a, b]);
    ok("an RPC failure marks EVERY account unreadable and clears none", down.unreadable.length === 2 && down.cleared.length === 0 && down.still.length === 0);
    const empty = await R.verifyRevoked(async () => ({}), [a]);
    ok("a malformed RPC answer (no value array) is unreadable, not cleared", empty.unreadable.length === 1 && empty.cleared.length === 0);
    const none = await R.verifyRevoked(async () => { throw new Error("must not be called"); }, []);
    ok("nothing to re-read → no call, empty answer", none.cleared.length === 0 && none.unreadable.length === 0);
  }

  console.log("\n(d) the signing path is the shared seam, and build() refuses a switched account\n");
  {
    const src = fs.readFileSync(path.join(ROOT, "src", "seeker", "revoke.js"), "utf8");
    ok("revoke.js imports signSendConfirm from ./sign.js and calls it", /import \{ signSendConfirm \} from "\.\/sign\.js"/.test(src) && /await signSendConfirm\(\{/.test(src));
    ok("no inline sendTransaction / getSignatureStatuses (protection 5 lives in sign.js)", !/"sendTransaction"|getSignatureStatuses/.test(src));
    ok("never SystemProgram.transfer or a web3.js import (AGENTS.md's Buffer trap)", !/SystemProgram|from "@solana\/web3\.js"/.test(src));
    ok("build() refuses when the live account is not the scanned owner", /if \(live !== owner\) throw new Error/.test(src));
    // Drive runRevoke with a fake window: the build must produce exactly one Revoke per account
    // for the live owner, and a wallet decline must come back as "declined", not an error.
    const owner = pk();
    const batch = [{ tokenAccount: pk(), program: R.TOKEN_PROGRAM, mint: pk(), delegate: pk() }, { tokenAccount: pk(), program: R.TOKEN_2022_PROGRAM, mint: pk(), delegate: pk() }];
    let built = null;
    let lvbh = 777;   // what the fake node's getLatestBlockhash reports as the blockhash's lifetime
    global.window = {
      solanaWeb3: web3,
      CluckWallet: { asTransaction: (s) => s, b58encode: () => null },
      CluckUtil: { rpc: async (m) => { if (m === "getLatestBlockhash") return { value: lvbh === undefined ? { blockhash: web3.Keypair.generate().publicKey.toBase58() } : { blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: lvbh } }; throw new Error("unexpected " + m); } },
    };
    const declining = { publicKey: new web3.PublicKey(owner), signTransaction: async (tx) => { built = tx; const e = new Error("User rejected the request."); e.code = 4001; throw e; } };
    const res = await R.runRevoke({ provider: declining, owner, batch });
    ok("a wallet decline is reported as declined (a normal outcome, not an error)", res.status === "declined", res);
    ok("runRevoke returns the lastValidBlockHeight that came with the blockhash it built against (Codex round 2)", res.lastValidBlockHeight === 777 && typeof res.recentBlockhash === "string", res);
    lvbh = undefined;
    const noLife = await R.runRevoke({ provider: declining, owner, batch });
    ok("a node that gave no lastValidBlockHeight -> null, never a guessed number", noLife.lastValidBlockHeight === null, noLife);
    lvbh = 777;
    ok("the transaction the wallet was shown carried exactly one instruction per account", built && built.instructions.length === 2);
    const ixOk = built && built.instructions.every((ix, i) =>
      ix.programId.toBase58() === batch[i].program
      && ix.keys[0].pubkey.toBase58() === batch[i].tokenAccount && ix.keys[0].isWritable
      && ix.keys[1].pubkey.toBase58() === owner && ix.keys[1].isSigner
      && Buffer.from(ix.data).equals(Buffer.from([5])));
    ok("…each one a Revoke of that account, signed by the scanned owner, on that account's program", ixOk);
    ok("the scanned owner pays the fee", built && built.feePayer && built.feePayer.toBase58() === owner);
    const switched = { publicKey: new web3.PublicKey(pk()), signTransaction: async () => { throw new Error("must not sign"); } };
    const sw = await R.runRevoke({ provider: switched, owner, batch });
    ok("a wallet that switched accounts since the scan is refused BEFORE signing", sw.status === "failed" && /switched accounts/.test(sw.error || ""), sw);
    const nothing = await R.runRevoke({ provider: declining, owner, batch: [] });
    ok("an empty batch never reaches the wallet", nothing.status === "failed" && nothing.accounts.length === 0);
    delete global.window;
  }

  console.log("\n(d1) Codex round 3: the pending record exists BEFORE the wallet is asked, so no wallet path can broadcast first\n");
  {
    const bs58m = require("bs58"); const b58 = (bs58m.encode || (bs58m.default && bs58m.default.encode)).bind(bs58m.default || bs58m);
    const kp = web3.Keypair.generate(); const owner = kp.publicKey.toBase58();
    const batch = [{ tokenAccount: pk(), program: R.TOKEN_PROGRAM, mint: pk(), delegate: pk() }, { tokenAccount: pk(), program: R.TOKEN_2022_PROGRAM, mint: pk(), delegate: pk() }];
    const bhash = pk();
    let events = [];
    global.window = {
      solanaWeb3: web3,
      CluckWallet: { asTransaction: (sg) => sg, b58encode: (u8) => b58(u8) },
      CluckUtil: { rpc: async (m) => {
        if (m === "getLatestBlockhash") return { value: { blockhash: bhash, lastValidBlockHeight: 4242 } };
        if (m === "sendTransaction") { events.push("send"); return "SENTSIG"; }
        if (m === "getSignatureStatuses") return { value: [{ err: null, confirmationStatus: "confirmed" }] };
        throw new Error("unexpected " + m);
      } },
    };
    const signOnly = { publicKey: kp.publicKey, signTransaction: async (tx) => { events.push("wallet-asked"); tx.partialSign(kp); return tx; } };
    // A wallet that signs AND broadcasts in one operation (MWA signAndSendTransactions, Phantom's
    // signAndSendTransaction): by the time it returns, the transaction is on chain.
    const signAndSend = { publicKey: kp.publicKey, signAndSendTransaction: async () => { events.push("wallet-asked+broadcast"); return { signature: "SAS" + "1".repeat(60) }; } };
    let before = null, signed = null;
    const cbs = { beforeSign: (r) => { events.push("saved-before"); before = r; return true; }, onSigned: (r) => { events.push("sig-filled"); signed = r; } };

    const res = await R.runRevoke({ provider: signOnly, owner, batch, ...cbs });
    ok("sign-then-send wallet: the record is saved BEFORE the wallet is asked, the signature filled after, then the send",
       events.join(",") === "saved-before,wallet-asked,sig-filled,send", events);
    ok("…the early record carries the accounts, the blockhash and its real lastValidBlockHeight, and NO signature yet",
       before && before.accounts.length === 2 && before.recentBlockhash === bhash && before.lastValidBlockHeight === 4242 && !before.sig, before);
    ok("…the fill-in carries the wallet's own signature", signed && typeof signed.sig === "string" && signed.sig.length >= 80, signed);
    ok("…and the result is a normal sent", res.status === "sent", res);

    events = [];
    const res2 = await R.runRevoke({ provider: signAndSend, owner, batch, ...cbs });
    ok("signAndSend-style wallet (broadcasts inside the wallet call): the record existed BEFORE that call",
       events[0] === "saved-before" && events.indexOf("saved-before") < events.indexOf("wallet-asked+broadcast"), events);
    ok("…and the signature it returns is filled in afterwards", events.includes("sig-filled") && res2.status === "sent", { events, res2 });

    for (const [label, cb] of [["returns false", () => false], ["throws", () => { throw new Error("QuotaExceededError"); }]]) {
      for (const [pname, prov] of [["sign-then-send", signOnly], ["signAndSend", signAndSend]]) {
        events = [];
        const r2 = await R.runRevoke({ provider: prov, owner, batch, beforeSign: cb, onSigned: () => events.push("sig-filled") });
        ok(`${pname} wallet, save ${label} → the WALLET IS NEVER ASKED and nothing is sent (fail closed)`, events.length === 0, events);
        ok(`…the person is told, as a failure`, r2.status === "failed" && /Could not save the recovery record/.test(r2.error || ""), r2);
      }
    }
    events = [];
    const r3 = await R.runRevoke({ provider: signOnly, owner, batch });
    ok("with no callbacks the behaviour is unchanged (asks the wallet, sends)", events.join(",") === "wallet-asked,send" && r3.status === "sent", { events, r3 });

    // sign.js: the sig-less recheck. Only the transaction's own lifetime may release a record with no signature.
    const S = await import(path.join(ROOT, "src", "seeker", "sign.js") + "?t=" + Date.now());
    const chain = (h, valid) => async (m) => { if (m === "getBlockHeight") return h; if (m === "isBlockhashValid") return valid; throw new Error("unexpected " + m); };
    ok("sig-less record: height not past lastValidBlockHeight → pending", (await S.checkUnsignedPending(chain(100, { value: false }), { lastValidBlockHeight: 200, recentBlockhash: bhash })).status === "pending");
    ok("sig-less record: height past it but the blockhash is not PROVEN dead ({}, null, true, error) → pending",
       (await Promise.all([{}, null, { value: true }, { value: null }].map((v) => S.checkUnsignedPending(chain(300, v), { lastValidBlockHeight: 200, recentBlockhash: bhash })))).every((r) => r.status === "pending")
       && (await S.checkUnsignedPending(async () => { throw new Error("down"); }, { lastValidBlockHeight: 200, recentBlockhash: bhash })).status === "pending");
    ok("sig-less record: no recorded blockhash or lifetime → pending forever (never guessed)",
       (await S.checkUnsignedPending(chain(300, { value: false }), { lastValidBlockHeight: 200, recentBlockhash: null })).status === "pending"
       && (await S.checkUnsignedPending(chain(300, { value: false }), { lastValidBlockHeight: null, recentBlockhash: bhash })).status === "pending");
    ok("sig-less record: height past it AND isBlockhashValid value === false → expired", (await S.checkUnsignedPending(chain(300, { value: false }), { lastValidBlockHeight: 200, recentBlockhash: bhash })).status === "expired");
    delete global.window;
  }

  console.log("\n(d2) the persisted unresolved-send record — by wallet, validated, never throws\n");
  {
    const mem = {};
    const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    global.window = { localStorage: store };
    const w1 = pk(), w2 = pk(), acct = pk();
    const rec = { sig: "S".repeat(88), accounts: [{ tokenAccount: acct, program: R.TOKEN_PROGRAM, mint: pk(), delegate: pk() }], recentBlockhash: pk(), lastValidBlockHeight: 250, wallet: w1, at: 12345 };
    ok("save then load round-trips every field", R.saveRevokePending(rec) && JSON.stringify(R.loadRevokePending(w1)) === JSON.stringify({ ...rec, accounts: [{ tokenAccount: acct, program: R.TOKEN_PROGRAM, mint: rec.accounts[0].mint, delegate: rec.accounts[0].delegate }] }), R.loadRevokePending(w1));
    ok("a record written before the wallet signed (sig null) saves and loads, still keyed by wallet",
       R.saveRevokePending({ ...rec, sig: null, wallet: w2 }) && R.loadRevokePending(w2) && R.loadRevokePending(w2).sig === null && R.loadRevokePending(w2).accounts.length === 1);
    R.clearRevokePending(w2);
    ok("it is keyed by wallet: another wallet sees nothing", R.loadRevokePending(w2) === null);
    ok("a second wallet's record does not clobber the first", R.saveRevokePending({ ...rec, wallet: w2, sig: "T".repeat(88) }) && R.loadRevokePending(w1).sig === rec.sig && R.loadRevokePending(w2).sig === "T".repeat(88));
    R.clearRevokePending(w1);
    ok("clear removes only that wallet's record", R.loadRevokePending(w1) === null && !!R.loadRevokePending(w2));
    R.clearRevokePending(w2);
    ok("clearing the last record removes the key", !(R.REVOKE_PENDING_KEY in mem));
    mem[R.REVOKE_PENDING_KEY] = "{not json";
    ok("a corrupt value loads as null instead of throwing", R.loadRevokePending(w1) === null);
    mem[R.REVOKE_PENDING_KEY] = JSON.stringify({ [w1]: { sig: "x", wallet: w2, accounts: rec.accounts } });
    ok("a record whose wallet field disagrees with its key is refused", R.loadRevokePending(w1) === null);
    global.window = { localStorage: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } } };
    ok("storage that throws: save reports false, load is null, clear does not throw", R.saveRevokePending(rec) === false && R.loadRevokePending(w1) === null && (R.clearRevokePending(w1), true));
    delete global.window;
    ok("no window at all: nothing throws", R.saveRevokePending(rec) === false && R.loadRevokePending(w1) === null);
  }

  console.log("\n(e) the shared pane and the education edition stay clean\n");
  {
    const checkup = fs.readFileSync(path.join(ROOT, "src", "seeker", "WalletCheckup.jsx"), "utf8");
    // Imports and identifiers, not comments — the header comment NAMES the two modules so a reader
    // knows where the signing half went; what must never appear is a reference the bundler follows.
    ok("WalletCheckup.jsx never references CluckWallet, signing, or imports revoke/CheckupRevoke/Disconnect (it is in the Play/iOS bundle)",
       !/CluckWallet|signTransaction|signSendConfirm|from "\.\/(revoke\.js|CheckupRevoke\.jsx|Disconnect\.jsx|sign\.js)"/.test(checkup));
    ok("WalletCheckup.jsx renders the `revoke` render prop in place of the website note, and `footer` after the results", /typeof revoke === "function" \? revoke\(\{ approvals, address, rescan/.test(checkup) && /\{footer \|\| null\}/.test(checkup));
    const edu = fs.readFileSync(path.join(ROOT, "src", "seeker", "edition", "edu.jsx"), "utf8");
    ok("edu.jsx imports neither CheckupRevoke nor Disconnect", !/CheckupRevoke|Disconnect\.jsx/.test(edu));
    const full = fs.readFileSync(path.join(ROOT, "src", "seeker", "edition", "full.jsx"), "utf8");
    ok("full.jsx passes both to every Checkup that has an address", (full.match(/revoke=\{revoke\} footer=\{footer\}/g) || []).length === 2);
    const cr = fs.readFileSync(path.join(ROOT, "src", "seeker", "CheckupRevoke.jsx"), "utf8");
    ok("CheckupRevoke refuses to revoke when the scanned address is not the connected wallet", /wallet\.address !== scannedAddress/.test(cr));
    ok("CheckupRevoke re-reads the chain after a confirmed send (never reports 'revoked' off the signature alone)", /verifyRevoked\(rpcFn\(\)/.test(cr));
    ok("an unconfirmed send offers Check status and no retry", /Check status/.test(cr) && !/status === "unconfirmed"[\s\S]{0,600}Try again/.test(cr));
    const dc = fs.readFileSync(path.join(ROOT, "src", "seeker", "Disconnect.jsx"), "utf8");
    ok("Disconnect clears the pass through CluckGate.clear() (the one pass client), never a re-typed key", /CluckGate[\s\S]{0,80}g\.clear\(\)/.test(dc) && !/clkn_tools_unlock/.test(dc));
    ok("Disconnect forgets the receipt sign-in via the shared module and calls the wallet's own disconnect", /forgetReceiptSession\(null\)/.test(dc) && /wallet\.disconnect\(\)/.test(dc));
    ok("Disconnect says on screen that it cannot touch connections inside the wallet app", /only the wallet can/.test(dc));
    const ad = fs.readFileSync(path.join(ROOT, "src", "seeker", "tools", "Airdropper.jsx"), "utf8");
    ok("the Airdropper uses the same receipt-session module (one key, no private copy)", /from "\.\.\/receipt-session\.js"/.test(ad) && !/clkn_seeker_receipt_session/.test(ad));
  }

  // (f) RENDERED — Codex on #458, both P2. WalletCheckup + CheckupRevoke are bundled with esbuild
  // exactly as the app imports them (only runRevoke, the wallet-signing call, is replaced) and
  // driven in headless Chromium with a scripted rpc: an unresolved send must offer NO Revoke and
  // keep its signature; and the post-revoke refresh must not erase the chain re-read.
  console.log("\n(f) rendered: unconfirmed offers no second revoke; the rescan keeps the re-read on screen\n");
  {
    let esbuild, chromium;
    try { esbuild = require("esbuild"); } catch (_) { esbuild = null; }
    try { ({ chromium } = require("playwright")); } catch (_) { try { ({ chromium } = require("playwright-core")); } catch (_2) { chromium = null; } }
    if (!esbuild || !chromium) {
      // node-check installs no Chromium, so these skip there; the smoke-test job re-runs this
      // script with REVOKE_RENDER_REQUIRED=1, where a missing browser is a failure, not a skip.
      if (process.env.REVOKE_RENDER_REQUIRED === "1") ok("esbuild + playwright are available for the rendered checks", false, "missing " + (!esbuild ? "esbuild " : "") + (!chromium ? "playwright" : ""));
      else console.log("  · " + (!esbuild ? "esbuild " : "") + (!chromium ? "playwright " : "") + "not resolvable — skipping the rendered checks (everything above still ran)");
    } else {
      const SEEKER = path.join(ROOT, "src", "seeker");
      const shim = {
        name: "revoke-runRevoke-shim",
        setup(b) {
          b.onResolve({ filter: /^\.\/revoke\.js$/ }, (args) => (/CheckupRevoke\.jsx$/.test(args.importer) ? { path: "revoke-shim", namespace: "shim" } : null));
          b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
            // an explicit export shadows the star re-export: the REAL planner and verifyRevoked
            // run; only the call that asks a wallet to sign is scripted by the test.
            contents: `export * from ${JSON.stringify(path.join(SEEKER, "revoke.js"))};\nexport const runRevoke = (a) => window.__state.runRevoke(a);`,
            resolveDir: SEEKER,
          }));
        },
      };
      const built = await esbuild.build({
        stdin: {
          contents: `
            import React from "react";
            import { createRoot } from "react-dom/client";
            import WalletCheckupPane from "./WalletCheckup.jsx";
            import CheckupRevoke from "./CheckupRevoke.jsx";
            const wallet = { connected: true, address: window.__ADDR, provider: {} };
            const revoke = ({ approvals, address, rescan }) => <CheckupRevoke wallet={wallet} approvals={approvals} scannedAddress={address} onDone={rescan} />;
            // mount/unmount hooks: leaving the Checkup tab and coming back is a real unmount.
            let root = null;
            window.__mount = () => { root = createRoot(document.getElementById("root")); root.render(<WalletCheckupPane address={window.__ADDR} revoke={revoke} />); };
            window.__unmount = () => { if (root) root.unmount(); root = null; };
            window.__mount();
          `,
          resolveDir: SEEKER, loader: "jsx", sourcefile: "harness.jsx",
        },
        bundle: true, write: false, format: "iife", plugins: [shim], logLevel: "silent",
        define: { "process.env.NODE_ENV": '"production"' },
      });
      const bundle = built.outputFiles[0].text;
      const exe = ["/opt/pw-browsers/chromium", process.env.PLAYWRIGHT_CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
      const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

      const ADDR = pk(), A = pk(), B = pk(), SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW", BH = pk();
      const approval = (ta) => ({ tokenAccount: ta, mint: pk(), delegate: pk(), program: R.TOKEN_PROGRAM, delegatedAmount: "5", balance: "10" });
      const rowsAB = [approval(A), approval(B)];

      // One fresh page per scenario. `state` is the scripted chain, mutable from the test.
      async function open(state) {
        // A fresh context per page (its own localStorage) on a routed https origin — about:blank has
        // no usable localStorage, and the persisted record is exactly what is under test.
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.route("https://seeker.test/**", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }));
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto("https://seeker.test/");
        await page.evaluate(({ ADDR, A, B, SIG, BH, state }) => {
          window.__ADDR = ADDR;
          // `lvbh` is the lastValidBlockHeight that came with the blockhash; 900 < height 1000 means
          // "the chain has moved past the transaction's lifetime" unless a scenario says otherwise.
          const s = window.__state = Object.assign({ fetchCount: 0, scanDelay: 0, height: 1000, lvbh: 900, blockhashValid: true, sigStatus: null, accounts: {} }, state);
          s.runRevoke = async (a) => {
            const accounts = s.sentRows.map((r) => ({ tokenAccount: r.tokenAccount, program: r.program, mint: r.mint, delegate: r.delegate }));
            const KEY = "clkn_seeker_revoke_pending";
            // Mimics sign.js's seam: beforeSign runs after the build and BEFORE the wallet is asked (a
            // throw / false → the wallet is never asked); onSigned fills the signature in once the wallet
            // returns; only then does the broadcast + confirmation happen.
            s.walletAsked = false; s.broadcast = false; s.beforeSignSeen = typeof a.beforeSign === "function"; s.storedAtAsk = null;
            let saved = true;   // no callback passed → the seam has nothing to wait on
            if (s.beforeSignSeen) { try { saved = a.beforeSign({ accounts, recentBlockhash: BH, lastValidBlockHeight: s.lvbh }) !== false; } catch (_) { saved = false; } }
            if (!saved) return { status: "failed", error: "Could not save the recovery record — nothing was sent. Free some storage and try again.", accounts, recentBlockhash: BH, lastValidBlockHeight: s.lvbh };
            s.walletAsked = true; s.storedAtAsk = window.localStorage.getItem(KEY);
            if (s.signGate) await new Promise((r) => { window.__releaseSign = r; });
            if (s.declineAtPrompt) return { status: "declined", accounts, recentBlockhash: BH, lastValidBlockHeight: s.lvbh };
            if (typeof a.onSigned === "function") { try { a.onSigned({ sig: SIG, accounts, recentBlockhash: BH, lastValidBlockHeight: s.lvbh }); } catch (_) {} }
            s.broadcast = true;
            if (s.sendGate) await new Promise((r) => { window.__releaseSend = r; });
            return { status: s.sendStatus, sig: SIG, accounts, recentBlockhash: BH, lastValidBlockHeight: s.lvbh };
          };
          const parsed = (d) => ({ data: { parsed: { info: d ? { delegate: d } : {} } } });
          window.CluckUtil = { rpc: async (m, p) => {
            if (m === "getSignatureStatuses") return { value: [s.sigStatus] };
            if (m === "getBlockHeight") return s.height;
            if (m === "isBlockhashValid") return "validRaw" in s ? s.validRaw : { value: s.blockhashValid };
            if (m === "getMultipleAccounts") return { value: p[0].map((ta) => { const v = s.accounts[ta]; return v === "closed" ? null : v === "unreadable" ? { data: "base64" } : parsed(v === "delegate" ? "DeLeGate1111111111111111111111111111111111" : null); }) };
            throw new Error("unexpected rpc " + m);
          } };
          window.fetch = async () => {
            s.fetchCount++;
            await new Promise((r) => setTimeout(r, s.scanDelay));
            return { ok: true, status: 200, json: async () => ({ success: true, wallet: ADDR, tokensHeld: 2, scanned: 2, capped: false, unverified: 0, portfolioUsd: 0, atRiskUsd: 0, holdings: [], approvals: s.rows, riskyHoldings: [] }) };
          };
        }, { ADDR, A, B, SIG, BH, state: { ...state, sentRows: state.rows } });
        await page.addScriptTag({ content: bundle });
        await page.waitForSelector(".seeker-revoke-btn", { timeout: 10000 });
        page.__context = context;
        return { page, errors };
      }
      const body = (page) => page.evaluate(() => document.body.innerText);
      const revokeBtns = (page) => page.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim()).filter((x) => /^Revoke( this approval| \d+ approvals)$/.test(x)));
      async function submit(page) {
        await page.click(".seeker-revoke-btn");
        await page.click(".seeker-confirm .seeker-btn-danger");
      }
      const stored = (page) => page.evaluate(() => window.localStorage.getItem("clkn_seeker_revoke_pending"));
      const remount = async (page) => { await page.evaluate(() => { window.__unmount(); window.__mount(); }); };
      const unconfirmedCard = (page) => page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 10000 });
      const checkStatus = async (page) => {
        await page.click(".seeker-revoke-outcome-unconfirmed .seeker-btn-quiet");
        await page.waitForFunction(() => !/Checking…/.test(document.body.innerText), null, { timeout: 10000 });
      };
      const set = (page, patch) => page.evaluate((p) => Object.assign(window.__state, p), patch);

      // ── Finding 1: unconfirmed ──────────────────────────────────────────────────────────
      {
        const { page, errors } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 10000 });
        let txt = await body(page);
        ok("unconfirmed: NO Revoke button is offered for those accounts", (await revokeBtns(page)).length === 0, await revokeBtns(page));
        const persisted = JSON.parse((await stored(page)) || "null");
        ok("unconfirmed: the record is persisted by wallet with signature, accounts, blockhash, REAL lastValidBlockHeight and time",
           persisted && persisted[ADDR] && persisted[ADDR].sig === SIG && persisted[ADDR].accounts.length === 2 && persisted[ADDR].recentBlockhash === BH && persisted[ADDR].lastValidBlockHeight === 900 && persisted[ADDR].wallet === ADDR && typeof persisted[ADDR].at === "number", persisted);
        ok("unconfirmed: the original signature is still shown (short form) with its explorer link",
           txt.includes(SIG.slice(0, 4) + "…" + SIG.slice(-4)) && (await page.evaluate((s) => !!document.querySelector('a[href="https://solscan.io/tx/' + s + '"]'), SIG)));
        // Check status while the chain says nothing and the blockhash is still live → still pending.
        await page.click(".seeker-revoke-outcome-unconfirmed button");
        await page.waitForFunction(() => !/Checking…/.test(document.body.innerText), null, { timeout: 10000 });
        ok("still pending (no status, blockhash live): still unconfirmed, still NO Revoke, signature kept",
           (await revokeBtns(page)).length === 0 && !!(await page.$(".seeker-revoke-outcome-unconfirmed")) && (await body(page)).includes(SIG.slice(0, 4)));
        // The blockhash dies with no status → known not landed. Only the account the chain STILL shows
        // a delegate on (A) may be revoked again; B (cleared by someone else) may not.
        await set(page, { blockhashValid: false, accounts: { [A]: "delegate", [B]: "clear" } });
        await page.click(".seeker-revoke-outcome-unconfirmed button");
        await page.waitForSelector(".seeker-revoke-outcome-failed", { timeout: 10000 });
        await page.waitForFunction(() => /Re-read on chain/.test(document.body.innerText), null, { timeout: 10000 });
        const btns = await revokeBtns(page);
        ok("expired + chain re-read: Revoke returns for ONLY the account still showing a delegate", btns.length === 1 && btns[0] === "Revoke this approval", btns);
        ok("expired (strict rule met): the persisted record is cleared", (await stored(page)) === null, await stored(page));
        ok("expired: the outcome says nothing was revoked and keeps the signature link", /Nothing was revoked/.test(await body(page)) && (await page.evaluate((s) => !!document.querySelector('a[href="https://solscan.io/tx/' + s + '"]'), SIG)));
        ok("unconfirmed flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // a landed-and-FAILED original is known not landed too, but a re-read that shows every
        // approval already gone offers nothing to revoke
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "clear", [B]: "closed" } });
        await submit(page);
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 10000 });
        await set(page, { sigStatus: { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" } });
        await page.click(".seeker-revoke-outcome-unconfirmed button");
        await page.waitForFunction(() => /Re-read on chain: 2 of 2/.test(document.body.innerText), null, { timeout: 10000 });
        ok("failed on chain + every approval already gone: no Revoke offered", (await revokeBtns(page)).length === 0);
        await page.close();
      }
      {
        // unconfirmed that turns out to have LANDED → confirmed + re-read, never a second revoke
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "clear" } });
        await submit(page);
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 10000 });
        await set(page, { sigStatus: { err: null, confirmationStatus: "confirmed" } });
        await page.click(".seeker-revoke-outcome-unconfirmed button");
        await page.waitForFunction(() => /Revoke transaction confirmed/.test(document.body.innerText) && /Re-read on chain: 1 of 2/.test(document.body.innerText), null, { timeout: 10000 });
        ok("unconfirmed that landed: confirmed + per-account re-read", /still show a delegate/.test(await body(page)));
        await page.close();
      }

      // ── Codex round 2, Finding 2: only an explicit `false` is a dead blockhash ──────────────
      for (const [label, patch] of [
        ["isBlockhashValid answers {} (unknown)", { validRaw: {} }],
        ["isBlockhashValid answers null (unknown)", { validRaw: null }],
        ["isBlockhashValid answers {value:null} (unknown)", { validRaw: { value: null } }],
      ]) {
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await set(page, patch);                     // height 1000 is past lvbh 900, status is null
        await checkStatus(page);
        ok(`${label}: still unconfirmed, NO Revoke button, signature kept, record kept`,
           (await revokeBtns(page)).length === 0 && !!(await page.$(".seeker-revoke-outcome-unconfirmed")) && (await body(page)).includes(SIG.slice(0, 4)) && (await stored(page)) !== null);
        await page.close();
      }
      {
        // The node's height has not reached the transaction's own lifetime: with the REAL
        // lastValidBlockHeight (250) a node at height 90 is "pending" even when the blockhash looks dead.
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", height: 90, lvbh: 250, blockhashValid: false, accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await checkStatus(page);
        ok("node at height 90 below lastValidBlockHeight 250 (blockhash reported dead): pending, NO Revoke, record kept",
           (await revokeBtns(page)).length === 0 && !!(await page.$(".seeker-revoke-outcome-unconfirmed")) && (await stored(page)) !== null);
        // ...and once the node passes the lifetime AND says the blockhash is dead, it IS expired.
        await set(page, { height: 300 });
        await checkStatus(page);
        await page.waitForSelector(".seeker-revoke-outcome-failed", { timeout: 10000 });
        ok("the same send at height 300 > 250 with a dead blockhash: expired (the strict rule, not a weaker one)", !!(await page.$(".seeker-revoke-outcome-failed")));
        await page.close();
      }
      {
        // No lifetime known (the node gave none): the send can never be judged expired.
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", lvbh: null, blockhashValid: false, accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await checkStatus(page);
        ok("lastValidBlockHeight missing (null): pending, never expired, NO Revoke", (await revokeBtns(page)).length === 0 && !!(await page.$(".seeker-revoke-outcome-unconfirmed")));
        await page.close();
      }

      // ── Codex round 2, Finding 3: the unresolved send survives rescans and remounts ─────────
      {
        const { page, errors } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await page.click(".seeker-checkup-rescanbtn");          // the ordinary manual Rescan
        await page.waitForFunction(() => window.__state.fetchCount >= 2, null, { timeout: 10000 });
        await unconfirmedCard(page);
        ok("manual Rescan: still NO Revoke button for the same accounts", (await revokeBtns(page)).length === 0, await revokeBtns(page));
        ok("manual Rescan: the SAME signature is still shown", (await body(page)).includes(SIG.slice(0, 4) + "…" + SIG.slice(-4)) && (await page.evaluate((s) => !!document.querySelector('a[href="https://solscan.io/tx/' + s + '"]'), SIG)));
        await remount(page);                                     // leave the Checkup tab and come back
        await unconfirmedCard(page);
        ok("unmount + remount: still pending, still NO Revoke, same signature",
           (await revokeBtns(page)).length === 0 && (await body(page)).includes(SIG.slice(0, 4) + "…" + SIG.slice(-4)));
        // the restored card still resolves through Check status
        await set(page, { sigStatus: { err: null, confirmationStatus: "confirmed" }, accounts: { [A]: "clear", [B]: "clear" } });
        await checkStatus(page);
        await page.waitForFunction(() => /Revoke transaction confirmed/.test(document.body.innerText) && /Re-read on chain: 2 of 2/.test(document.body.innerText), null, { timeout: 10000 });
        ok("a restored record resolves through Check status, and resolving clears it", (await stored(page)) === null, await stored(page));
        ok("rescan/remount flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // the back-online rescan takes the same loading-screen path as the manual one
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
        await page.click(".seeker-checkup-rescanbtn");          // offline: the pane shows its offline screen
        await page.waitForFunction(() => /offline/i.test(document.body.innerText), null, { timeout: 10000 });
        await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); window.dispatchEvent(new Event("online")); });
        await unconfirmedCard(page);
        ok("offline then back-online rescan: still pending, NO Revoke, same signature", (await revokeBtns(page)).length === 0 && (await body(page)).includes(SIG.slice(0, 4)));
        await page.close();
      }
      {
        // a record belongs to the wallet that signed it; another wallet's pane does not show it
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        await page.evaluate((o) => { window.localStorage.setItem("clkn_seeker_revoke_pending", JSON.stringify({ [o]: JSON.parse(window.localStorage.getItem("clkn_seeker_revoke_pending"))[window.__ADDR] })); }, pk());
        await remount(page);
        await page.waitForSelector(".seeker-revoke-btn", { timeout: 10000 });
        ok("a record stored for a DIFFERENT wallet is not applied here", !(await page.$(".seeker-revoke-outcome-unconfirmed")) && (await revokeBtns(page)).length === 1);
        await page.close();
      }
      {
        // the 10-minute escape hatch (Swap's pattern): nothing before it, "Stop watching" after it
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await unconfirmedCard(page);
        ok("a fresh unresolved send offers no escape hatch yet", !/Stop watching/.test(await body(page)));
        await page.evaluate(() => {
          const m = JSON.parse(window.localStorage.getItem("clkn_seeker_revoke_pending"));
          m[window.__ADDR].at = Date.now() - 11 * 60 * 1000;
          window.localStorage.setItem("clkn_seeker_revoke_pending", JSON.stringify(m));
        });
        await remount(page);
        await unconfirmedCard(page);
        ok("after 10 minutes the card offers 'Stop watching' and still shows the signature link", /Stop watching/.test(await body(page)) && (await page.evaluate((s) => !!document.querySelector('a[href="https://solscan.io/tx/' + s + '"]'), SIG)));
        ok("...and still NO Revoke until it is dismissed", (await revokeBtns(page)).length === 0);
        await page.click(".seeker-revoke-stopwatch");
        await page.waitForSelector(".seeker-revoke-btn", { timeout: 10000 });
        ok("dismissing through the escape hatch clears the record and frees the accounts", (await stored(page)) === null && (await revokeBtns(page)).length === 1 && !(await page.$(".seeker-revoke-outcome-unconfirmed")));
        await page.close();
      }

      // ── Codex round 3, P2: the record exists BEFORE the wallet is asked ───────────────────────
      const KEYSTR = "clkn_seeker_revoke_pending";
      {
        // (a) remount DURING SIGNING — the wallet prompt is still open (promise pending).
        const { page, errors } = await open({ rows: rowsAB, sendStatus: "unconfirmed", signGate: true, sendGate: true, accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await page.waitForFunction(() => window.__state.walletAsked === true, null, { timeout: 10000 }).catch(() => {});
        const asked = JSON.parse((await stored(page)) || "null");
        ok("while the wallet prompt is open: the pending record is ALREADY stored, by wallet, with no signature yet",
           asked && asked[ADDR] && asked[ADDR].sig === null && asked[ADDR].accounts.length === 2 && asked[ADDR].recentBlockhash === BH && asked[ADDR].lastValidBlockHeight === 900, asked);
        ok("…and it was in storage at the moment the wallet was asked", !!(await page.evaluate(() => window.__state.storedAtAsk)));
        await remount(page);                                     // leave Checkup during signing, come back
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 4000 }).catch(() => {});
        ok("(a) remount DURING SIGNING: NO Revoke button is offered", (await revokeBtns(page)).length === 0, await revokeBtns(page));
        ok("…the watching card is shown, is titled Revoking…, and has no signature link", /Revoking…/.test(await page.$eval(".seeker-revoke-outcome-unconfirmed", (el) => el.innerText)) && !(await page.$('a[href^="https://solscan.io/tx/"]')) && /Check status/.test(await body(page)));
        // Check status while the blockhash is still live → still pending, still blocked
        await checkStatus(page).catch(() => {});
        ok("a sig-less record with a LIVE blockhash stays pending after Check status (record kept, no Revoke)",
           (await revokeBtns(page)).length === 0 && (await stored(page)) !== null);
        // (b) now the wallet signs: the signature is filled into the record while the send is unresolved
        await page.evaluate(() => window.__releaseSign());
        await page.waitForFunction(() => window.__state.broadcast === true, null, { timeout: 4000 }).catch(() => {});
        const mid = JSON.parse((await stored(page)) || "null");
        ok("(b) during CONFIRMATION (sig known, unresolved): the record now carries the signature", mid && mid[ADDR] && mid[ADDR].sig === SIG, mid);
        await remount(page);
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 4000 }).catch(() => {});
        ok("(b) remount during confirmation: NO Revoke button, signature shown", (await revokeBtns(page)).length === 0 && (await body(page)).includes(SIG.slice(0, 4) + "…" + SIG.slice(-4)));
        await set(page, { sendStatus: "sent" });
        await page.evaluate(() => window.__releaseSend());
        await page.waitForFunction((k) => window.localStorage.getItem(k) === null, KEYSTR, { timeout: 4000 }).catch(() => {});
        ok("a definitive landed outcome clears the record", (await stored(page)) === null, await stored(page));
        ok("signing/confirmation flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // A sig-less record whose blockhash is PROVEN dead is released, and only still-delegated accounts return.
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", signGate: true, accounts: { [A]: "delegate", [B]: "clear" } });
        await submit(page);
        await page.waitForFunction(() => window.__state.walletAsked === true, null, { timeout: 10000 }).catch(() => {});
        await remount(page);
        await page.waitForSelector(".seeker-revoke-outcome-unconfirmed", { timeout: 4000 }).catch(() => {});
        await set(page, { blockhashValid: false });             // height 1000 is past lvbh 900
        await checkStatus(page).catch(() => {});
        await page.waitForSelector(".seeker-revoke-outcome-failed", { timeout: 4000 }).catch(() => {});
        await page.waitForFunction(() => /Re-read on chain/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => {});
        const btns = await revokeBtns(page);
        ok("sig-less record, blockhash proven dead + re-read: Revoke returns for ONLY the account still showing a delegate", btns.length === 1 && btns[0] === "Revoke this approval", btns);
        ok("…and the record is cleared", (await stored(page)) === null, await stored(page));
        await page.close();
      }
      {
        // The wallet prompt is declined → nothing was sent, the record written before the prompt is retired.
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", signGate: true, declineAtPrompt: true, accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await page.waitForFunction(() => window.__state.walletAsked === true, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => window.__releaseSign());
        await page.waitForSelector(".seeker-revoke-outcome-declined", { timeout: 4000 }).catch(() => {});
        ok("a declined prompt clears the early record and the accounts are revocable again", (await stored(page)) === null && (await revokeBtns(page)).length === 1, await stored(page));
        await page.close();
      }
      {
        // A definitive failed outcome (node refused it) also clears the early record.
        const { page } = await open({ rows: rowsAB, sendStatus: "failed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await submit(page);
        await page.waitForSelector(".seeker-revoke-outcome-failed", { timeout: 10000 });
        ok("a definitive failed send clears the record written before the prompt", (await stored(page)) === null, await stored(page));
        ok("…and the accounts are revocable again (nothing landed)", (await revokeBtns(page)).length === 1);
        await page.close();
      }
      {
        // (c) storage write failure → the wallet is NEVER asked.
        const { page } = await open({ rows: rowsAB, sendStatus: "unconfirmed", accounts: { [A]: "delegate", [B]: "delegate" } });
        await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); }; });
        await submit(page);
        await page.waitForSelector(".seeker-revoke-outcome-failed", { timeout: 4000 }).catch(() => {});
        const st = await page.evaluate(() => ({ walletAsked: window.__state.walletAsked, broadcast: window.__state.broadcast, beforeSignSeen: window.__state.beforeSignSeen }));
        ok("the pane hands the seam a beforeSign save callback at all", st.beforeSignSeen === true, st);
        ok("(c) storage write failure → the wallet is NEVER asked, nothing is broadcast", st.walletAsked === false && st.broadcast === false, st);
        ok("…and the person is told why, in plain words", /Could not save the recovery record/.test(await body(page)));
        await page.close();
      }

      // ── Finding 2: the refresh keeps the result ─────────────────────────────────────────
      {
        // A cleared, B could not be read. The refresh is slow so we can look in the middle of it.
        const { page, errors } = await open({ rows: rowsAB, sendStatus: "sent", scanDelay: 400, accounts: { [A]: "clear", [B]: "unreadable" } });
        await submit(page);
        await page.waitForFunction(() => /Re-read on chain: 1 of 2/.test(document.body.innerText), null, { timeout: 10000 });
        await page.waitForFunction(() => window.__state.fetchCount >= 2, null, { timeout: 10000 });
        let txt = await body(page);
        ok("mid-refresh: no loading screen replaced the result", !/Scanning your wallet/.test(txt) && /Revoke transaction confirmed/.test(txt), txt.slice(0, 300));
        ok("mid-refresh: the unreadable account's warning is on screen", /1 could not be re-read — status unknown, not counted as cleared/.test(txt));
        await page.waitForTimeout(900);   // the refresh has now returned
        txt = await body(page);
        ok("after the refresh: transaction outcome, cleared count and the unreadable warning are STILL on screen",
           /Revoke transaction confirmed/.test(txt) && /1 of 2 approvals are gone/.test(txt) && /1 could not be re-read — status unknown/.test(txt), txt.slice(0, 400));
        ok("after the refresh: the rescan really happened (list was fetched again)", (await page.evaluate(() => window.__state.fetchCount)) >= 2);
        await page.click(".seeker-revoke-outcome-sent button");
        ok("dismissing the result removes it", !(await page.$(".seeker-revoke-outcome")));
        ok("refresh flow: no uncaught exception", errors.length === 0, errors.join(" | "));
        await page.close();
      }
      {
        // Every approval cleared and the rescan returns an EMPTY list: the approvals section goes
        // away, and the result must outlive it.
        const { page } = await open({ rows: rowsAB, sendStatus: "sent", accounts: { [A]: "clear", [B]: "clear" } });
        await set(page, { rows: [] });     // what the post-revoke refresh will read: nothing left
        await submit(page);
        await page.waitForFunction(() => window.__state.fetchCount >= 2, null, { timeout: 10000 });
        await page.waitForFunction(() => !document.querySelector(".seeker-checkup-section"), null, { timeout: 10000 });
        ok("the approvals list is gone after the refresh", !(await page.$(".seeker-checkup-section")));
        ok("all-cleared: the result is still on screen after the section that held it disappeared", /Revoke transaction confirmed/.test(await body(page)) && /2 of 2 approvals are gone/.test(await body(page)));
        await page.close();
      }
      await browser.close();
    }
  }

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
