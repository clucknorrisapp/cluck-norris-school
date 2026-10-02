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
    global.window = {
      solanaWeb3: web3,
      CluckWallet: { asTransaction: (s) => s, b58encode: () => null },
      CluckUtil: { rpc: async (m) => { if (m === "getLatestBlockhash") return { value: { blockhash: web3.Keypair.generate().publicKey.toBase58() } }; throw new Error("unexpected " + m); } },
    };
    const declining = { publicKey: new web3.PublicKey(owner), signTransaction: async (tx) => { built = tx; const e = new Error("User rejected the request."); e.code = 4001; throw e; } };
    const res = await R.runRevoke({ provider: declining, owner, batch });
    ok("a wallet decline is reported as declined (a normal outcome, not an error)", res.status === "declined", res);
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

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
