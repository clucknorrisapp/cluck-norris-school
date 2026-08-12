// ── Cluck Norris shared airdrop engine ───────────────────────────────────────
// ONE implementation of the batch-transfer machinery, shared by /airdrop and the
// Buy Special tool so prize sending lives in the same audited code path as the
// standalone airdropper. Buy Special used to hand its payout list to /airdrop
// through client storage, which kept failing inside Phantom's in-app browser;
// it now sends directly and there is no hand-off to break.
//
// Exposes two globals:
//   splToken      — the minimal SPL/ATA/memo instruction shim (unchanged)
//   CluckAirdrop  — batching + tx building + the send driver
//
// Requires /vendor/solana-web3.iife.min.js to be loaded first.
(function (global) {
"use strict";

// SPL Token program IDs and helpers (minimal implementation)
// Using Helius RPC for ATA derivation instead of full SPL library
const TOKEN_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const splToken = {
  TOKEN_PROGRAM_ID: { toString: () => TOKEN_CLASSIC },
  TOKEN_2022_PROGRAM_ID: { toString: () => TOKEN_2022 },
  ASSOCIATED_TOKEN_PROGRAM_ID: { toString: () => 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' },

  // The token program is a SEED of the ATA PDA, so a Token-2022 mint derives a
  // DIFFERENT ATA than a classic mint. tokenProgram defaults to classic, so every
  // existing (classic) call site is byte-for-byte unchanged.
  getAssociatedTokenAddressSync(mint, owner, tokenProgram) {
    const { PublicKey } = solanaWeb3;
    const [address] = PublicKey.findProgramAddressSync(
      [
        owner.toBuffer(),
        new PublicKey(tokenProgram || TOKEN_CLASSIC).toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return address;
  },

  createTransferInstruction(source, dest, owner, amount, tokenProgram) {
    const { PublicKey, TransactionInstruction } = solanaWeb3;
    const TOKEN_PROGRAM = new PublicKey(tokenProgram || TOKEN_CLASSIC);
    // Build the 9-byte instruction data with Uint8Array — the Node `Buffer`
    // global does not exist in browsers (Safari/iOS throws "Can't find
    // variable: Buffer"). Byte 0 = Transfer opcode (3), bytes 1-8 = amount u64 LE.
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
    return new TransactionInstruction({
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_PROGRAM,
      data,
    });
  },

  createAssociatedTokenAccountInstruction(payer, ata, owner, mint, tokenProgram) {
    const { PublicKey, TransactionInstruction } = solanaWeb3;
    const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const TOKEN_PROGRAM = new PublicKey(tokenProgram || TOKEN_CLASSIC);
    const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
      ],
      programId: ATA_PROGRAM,
      data: new Uint8Array(0),
    });
  },

  // CreateIdempotent (ATA program ix #1) — identical to Create but a NO-OP if the
  // account already exists, instead of failing the whole batch. Guards the race
  // where a recipient's ATA appears between our pre-flight check and the send.
  createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, tokenProgram) {
    const { PublicKey, TransactionInstruction } = solanaWeb3;
    const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const TOKEN_PROGRAM = new PublicKey(tokenProgram || TOKEN_CLASSIC);
    const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
      ],
      programId: ATA_PROGRAM,
      data: new Uint8Array([1]),   // 1 = CreateIdempotent
    });
  },

  // TransferChecked (token program ix #12) — carries the mint + decimals so a wallet
  // simulator (Phantom Lighthouse / Blockaid) can verify EXACTLY what's moving ("X CLKN")
  // rather than inferring it, which makes the tx far less likely to be scored suspicious.
  createTransferCheckedInstruction(source, mint, dest, owner, amount, decimals, tokenProgram) {
    const { PublicKey, TransactionInstruction } = solanaWeb3;
    const TOKEN_PROGRAM = new PublicKey(tokenProgram || TOKEN_CLASSIC);
    // byte 0 = TransferChecked opcode (12), bytes 1-8 = amount u64 LE, byte 9 = decimals u8.
    const data = new Uint8Array(10);
    data[0] = 12;
    new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
    data[9] = decimals & 0xff;
    return new TransactionInstruction({
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint,   isSigner: false, isWritable: false },
        { pubkey: dest,   isSigner: false, isWritable: true },
        { pubkey: owner,  isSigner: true,  isWritable: false },
      ],
      programId: TOKEN_PROGRAM,
      data,
    });
  },

  // Native SOL transfer (System Program ix #2). Hand-built for exactly the same
  // reason as the SPL instructions above: solanaWeb3.SystemProgram.transfer()
  // encodes its u64 lamports through the library's own layout helper, which calls
  // toBufferLE() and dies on "Buffer is not defined" in a browser — there is no
  // Node Buffer global and we deliberately don't ship a polyfill. That broke every
  // SOL path we had (both unlock payments AND SOL-denominated airdrop prizes), so
  // nothing here may call SystemProgram.transfer.
  // Layout: bytes 0-3 = instruction index u32 LE (2 = Transfer), bytes 4-11 = lamports u64 LE.
  createSolTransferInstruction(from, to, lamports) {
    const { TransactionInstruction, PublicKey } = solanaWeb3;
    const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
    const data = new Uint8Array(12);
    const dv = new DataView(data.buffer);
    dv.setUint32(0, 2, true);
    dv.setBigUint64(4, BigInt(lamports), true);
    return new TransactionInstruction({
      keys: [
        { pubkey: from, isSigner: true,  isWritable: true },
        { pubkey: to,   isSigner: false, isWritable: true },
      ],
      programId: SYSTEM_PROGRAM,
      data,
    });
  },

  // SPL Memo — labels the batch so the transaction is self-describing to simulators
  // and shows up in the recipient's history as a clucknorris.app airdrop.
  createMemoInstruction(memoText, signers) {
    const { PublicKey, TransactionInstruction } = solanaWeb3;
    const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const keys = (signers || []).map(s => ({ pubkey: s, isSigner: true, isWritable: false }));
    return new TransactionInstruction({
      keys,
      programId: MEMO_PROGRAM,
      data: new TextEncoder().encode(memoText),
    });
  }
};
global.splToken = splToken;

// Native SOL is sent with a system transfer and has no mint and no token account,
// so every ATA code path is skipped for it.
var NATIVE_DECIMALS = 9;

var CluckAirdrop = {
  // Solana's 1232-byte tx limit fits ~18 weighted slots of plain transfers, but a
  // checked transfer (adds the mint account) plus the per-tx memo pushes the densest
  // ATA-heavy batch close to the limit — hold at 16 for a safe ~110-byte margin.
  TX_WEIGHT_BUDGET: 16,
  LAMPORTS_PER_ATA_RENT: 2039280,   // rent for a 165-byte SPL token account
  LAMPORTS_PER_TX_FEE: 5000,

  // Fixed-point string conversion — never amount * 10**decimals, whose float
  // multiply loses precision above ~9M tokens at 9 decimals.
  toBaseUnits: function (amount, decimals) {
    var n = Number(amount);
    if (!isFinite(n) || n <= 0) return 0n;
    var parts = n.toFixed(decimals).split(".");
    var intPart = parts[0], fracPart = parts[1] || "";
    return BigInt(intPart) * (10n ** BigInt(decimals))
         + BigInt(fracPart.padEnd(decimals, "0").slice(0, decimals) || "0");
  },

  // Pack recipients into batches under the tx size limit. A transfer weighs 1;
  // an ATA-create + transfer weighs 2.
  planBatches: function (active, budget) {
    var cap = budget || this.TX_WEIGHT_BUDGET, batches = [], current = [], weight = 0;
    for (var i = 0; i < active.length; i++) {
      var cost = active[i].needsAta ? 2 : 1;
      if (current.length && weight + cost > cap) { batches.push(current); current = []; weight = 0; }
      current.push(active[i]); weight += cost;
    }
    if (current.length) batches.push(current);
    return batches;
  },

  // Derive each recipient's ATA and find out which ones don't exist yet (the sender
  // pays rent for those). Marks r.ataAddress / r.needsAta / r.invalidAddress in place.
  // No-op for native SOL. On RPC failure it assumes the worst case so the cost
  // estimate never reads low.
  // Resolve which token program owns a mint (classic SPL vs Token-2022). The mint
  // ACCOUNT's owner IS the token program. Defaults to classic on any RPC failure so
  // the common path never breaks on a transient error. Returns a program-id string.
  resolveTokenProgram: async function (mint, rpc) {
    try {
      var res = await rpc("getAccountInfo", [mint, { encoding: "base64" }]);
      var owner = res && res.value && res.value.owner;
      if (owner === TOKEN_2022) return TOKEN_2022;
    } catch (e) {}
    return TOKEN_CLASSIC;
  },

  checkRecipientAtas: async function (arr, mint, rpc, tokenProgram) {
    if (!arr.length || !mint) return;
    if (typeof solanaWeb3 === "undefined" || typeof splToken === "undefined") return;
    var mintPk;
    try { mintPk = new solanaWeb3.PublicKey(mint); } catch (e) { return; }
    var entries = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      try {
        r.ataAddress = splToken.getAssociatedTokenAddressSync(mintPk, new solanaWeb3.PublicKey(r.addr), tokenProgram).toString();
        r.invalidAddress = false;
        entries.push(r);
      } catch (e) {
        r.invalidAddress = true; r.needsAta = false;
        if (!r.skip) { r.skip = true; r.skipReason = "Invalid address"; }
      }
    }
    var BATCH = 100;
    for (var j = 0; j < entries.length; j += BATCH) {
      var slice = entries.slice(j, j + BATCH);
      try {
        var res = await rpc("getMultipleAccounts", [slice.map(function (e) { return e.ataAddress; }), { encoding: "base64" }]);
        var accounts = (res && res.value) || [];
        slice.forEach(function (e, idx) { e.needsAta = !accounts[idx]; });
      } catch (e) {
        slice.forEach(function (e) { if (e.needsAta === undefined) e.needsAta = true; });
      }
    }
  },

  getAssociatedTokenAddress: function (mint, owner, tokenProgram) {
    return splToken.getAssociatedTokenAddressSync(
      new solanaWeb3.PublicKey(mint), new solanaWeb3.PublicKey(owner), tokenProgram).toString();
  },

  // Build one signable transaction. `native` switches the whole batch to
  // SystemProgram transfers (SOL prizes); otherwise it's transferChecked, which
  // carries the mint + decimals so wallet simulators can state exactly what moves.
  buildTransaction: function (opts) {
    var Transaction = solanaWeb3.Transaction, PublicKey = solanaWeb3.PublicKey;
    var tx = new Transaction();
    tx.recentBlockhash = opts.blockhash;
    var feePayerPk = new PublicKey(opts.feePayer);
    tx.feePayer = feePayerPk;
    // Self-describing memo first, so a simulator reads the intent up front instead of
    // scoring an unlabeled multi-recipient transfer as a possible drain.
    tx.add(splToken.createMemoInstruction(opts.memo || "clucknorris.app airdrop", [feePayerPk]));
    var mintPk = opts.native ? null : new PublicKey(opts.mint);
    var tokProg = opts.tokenProgram || TOKEN_CLASSIC;   // classic unless the mint is Token-2022
    for (var i = 0; i < opts.instructions.length; i++) {
      var ix = opts.instructions[i];
      if (ix.type === "createATA") {
        tx.add(splToken.createAssociatedTokenAccountIdempotentInstruction(
          feePayerPk, new PublicKey(ix.ata), new PublicKey(ix.owner), mintPk, tokProg));
      } else if (ix.type === "solTransfer") {
        tx.add(splToken.createSolTransferInstruction(
          feePayerPk, new PublicKey(ix.to), Number(ix.amount)));
      } else if (ix.type === "transfer") {
        tx.add(splToken.createTransferCheckedInstruction(
          new PublicKey(ix.from), mintPk, new PublicKey(ix.to), feePayerPk, ix.amount, opts.decimals, tokProg));
      }
    }
    return tx;
  },

  confirmTransaction: async function (signature, rpc) {
    for (var i = 0; i < 30; i++) {
      await new Promise(function (r) { setTimeout(r, 1000); });
      try {
        var result = await rpc("getSignatureStatuses", [[signature]]);
        var st = result && result.value && result.value[0];
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return true;
        if (st && st.err) throw new Error("Transaction failed on-chain");
      } catch (e) { if (/failed on-chain/.test(e.message)) throw e; }
    }
    return false;
  },

  // Full send driver. opts:
  //   provider, walletPubkey, rpc, recipients[{addr,amount}], mint, native, decimals,
  //   memo, onProgress(msg, pct), onResult({addr,amount,status,sig,error})
  // Returns { sent, failed }. A failed batch is reported per recipient and the run
  // continues — one bad batch never silently drops the rest.
  send: async function (opts) {
    var rpc = opts.rpc, native = !!opts.native;
    var active = opts.recipients.filter(function (r) { return r.addr && Number(r.amount) > 0; });
    if (!active.length) throw new Error("No recipients to send to");
    var progress = opts.onProgress || function () {};
    var report = opts.onResult || function () {};
    var decimals = native ? NATIVE_DECIMALS : opts.decimals;
    var senderTokenAccount = null;
    var tokenProgram = TOKEN_CLASSIC;

    if (!native) {
      progress("Reading your token account…", 1);
      // Which token program owns this mint? The sender's own token account is owned by
      // it, so resolve from there (one fewer RPC than a separate getAccountInfo).
      var accts = await rpc("getTokenAccountsByOwner",
        [opts.walletPubkey, { mint: opts.mint }, { encoding: "jsonParsed" }]);
      var first = accts && accts.value && accts.value[0];
      if (!first) throw new Error("No token account for " + opts.mint + " in your wallet");
      senderTokenAccount = first.pubkey;
      if (first.account && first.account.owner === TOKEN_2022) tokenProgram = TOKEN_2022;
      // Authoritative decimals from chain — transferChecked REQUIRES the exact value,
      // and a custom token can be anything. Never guess for the actual transfer.
      var onchain = first.account && first.account.data && first.account.data.parsed
        && first.account.data.parsed.info.tokenAmount.decimals;
      if (Number.isInteger(onchain)) decimals = onchain;
      progress("Checking recipient token accounts…", 2);
      await this.checkRecipientAtas(active, opts.mint, rpc, tokenProgram);
    } else {
      active.forEach(function (r) { r.needsAta = false; });
    }

    var batches = this.planBatches(active);
    var sent = 0, failed = 0, done = 0;
    for (var bi = 0; bi < batches.length; bi++) {
      var batch = batches[bi];
      progress("Transaction " + (bi + 1) + " of " + batches.length + " — " + batch.length + " wallets…",
        (done / active.length) * 100);
      try {
        var bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
        var blockhash = bh && bh.value && bh.value.blockhash;
        if (!blockhash) throw new Error("Could not fetch a recent blockhash");
        var instructions = [];
        for (var ri = 0; ri < batch.length; ri++) {
          var r = batch[ri];
          var raw = this.toBaseUnits(r.amount, decimals);
          if (native) { instructions.push({ type: "solTransfer", to: r.addr, amount: raw }); continue; }
          var dest = r.ataAddress || this.getAssociatedTokenAddress(opts.mint, r.addr, tokenProgram);
          if (r.needsAta) instructions.push({ type: "createATA", mint: opts.mint, owner: r.addr, ata: dest });
          instructions.push({ type: "transfer", from: senderTokenAccount, to: dest, amount: raw });
        }
        var tx = this.buildTransaction({
          instructions: instructions, feePayer: opts.walletPubkey, blockhash: blockhash,
          mint: opts.mint, decimals: decimals, native: native, memo: opts.memo, tokenProgram: tokenProgram });
        var res = await opts.provider.signAndSendTransaction(tx);
        var sig = res && res.signature;
        await this.confirmTransaction(sig, rpc);
        batch.forEach(function (r) { sent++; report({ addr: r.addr, amount: r.amount, status: "sent", sig: sig }); });
      } catch (err) {
        var msg = (err && err.message) || String(err);
        batch.forEach(function (r) { failed++; report({ addr: r.addr, amount: r.amount, status: "failed", error: msg }); });
      }
      done += batch.length;
    }
    progress("Done — " + sent + " sent" + (failed ? ", " + failed + " failed" : ""), 100);
    return { sent: sent, failed: failed, decimals: decimals };
  },
};

global.CluckAirdrop = CluckAirdrop;
})(globalThis);
