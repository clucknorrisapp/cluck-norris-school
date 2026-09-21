// public/rent-reclaim-plan.js — Rent Reclaim, SIGNING-PATH DECISIONS (increment 3 of
// docs/SEEKER_APP_PLAN.md; the full contract is docs/SEEKER_RECLAIM_SIGNING_SPEC.md — read that
// first, this file implements it rather than re-deriving it).
//
// THIS MOVES USER FUNDS. Every rule that decides whether an account gets closed, who the rent
// lamports go to, how many closes fit in one transaction, and what counts as "confirmed" lives
// HERE, in one small dependency-free file — not scattered across a UI component and a wallet
// callback where a reviewer has to reconstruct the safety argument from call sites. The browser
// seam that actually talks to solanaWeb3 and the connected wallet (src/seeker/reclaim-sign.js) is
// deliberately thin: it supplies four small async functions (an "io" object — getFreshBalances,
// getBlockhash, signAndSendAll, confirmSignature) and this file's runReclaimFlow() drives all of
// the sequencing and every safety decision around them. That is what makes this file testable
// with a plain `require()` and a fake bridge object in scripts/seeker-reclaim-sign-test.cjs — "no
// live RPC, no real signing, in CI" (spec §5) is true because nothing in here ever imports web3,
// fetch, or a DOM. Same dual-export UMD pattern as public/rent-math.js (see its header for why:
// Node `require()`s it AND the browser loads it as a plain <script>), and the same reason it
// lives under public/ rather than lib/ — the seeker store-edition bundle only ever copies an
// allow-listed set of files out of public/ (scripts/build-store-edition.mjs), so a shared module
// this app's UI needs at runtime has to sit where that allow-list can reach it.
//
// ⛔ Rule 1 (the single most dangerous parameter in this feature, spec §2.1): the rent
// destination is ALWAYS the connected wallet. buildCloseInstruction() below takes a `destination`
// argument and REFUSES (throws) unless it is byte-identical to `owner` — the check is INSIDE the
// function, not left to a caller's discipline, so a future call site cannot silently thread a
// different value through. Mutation-tested in scripts/seeker-reclaim-sign-test.cjs Test 2.
//
// ⛔ Rule 2: never close an account holding a balance. Enforced twice — once at selection
// (classifyForClose) and again immediately before building (reverifyBalances, against a FRESH
// read, spec §2.2/§2.6) — because a stale scan is exactly the race this feature must not lose to.
//
// ⛔ Rule 3: wrapped SOL is refused explicitly, with a reason, never silently dropped
// (classifyForClose AND buildCloseInstruction both check it — see Rule 1's comment on
// defense-in-depth).
//
// ⛔ Rule 4: this file never signs and never submits anything by itself — it hands back plain
// instruction DESCRIPTORS ({programId, keys, data} — no web3.js objects) and calls the injected
// `io` functions the caller supplies. The actual signing happens in the browser, through the
// connected wallet, in src/seeker/reclaim-sign.js.
"use strict";
(function (global) {
  "use strict";

  // ── SPL Token program ids + the one instruction this file ever builds ──────────────────────
  // Duplicated as string literals rather than required from lib/solana-addr's TOKEN_PROGRAMS on
  // purpose — this file ships into the browser bundle and must stay dependency-free (decision 1
  // of docs/SEEKER_RECLAIM_SIGNING_SPEC.md's build brief); public/airdrop-engine.js keeps its own
  // copies of these same two ids for the identical reason. scripts/seeker-reclaim-sign-test.cjs
  // Test 1 re-derives the actual instruction bytes from @solana/spl-token for BOTH ids and diffs
  // them against buildCloseInstruction's output — that is what keeps this copy honest, not eyeballing it.
  var TOKEN_PROGRAM_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  var TOKEN_PROGRAM_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  var WSOL_MINT = "So11111111111111111111111111111111111111112";
  // CloseAccount is SPL Token instruction #9 (classic AND Token-2022 share the same opcode and
  // account layout for this instruction — only TransferChecked/BurnChecked-style ones carry
  // amount/decimals payloads that could differ). One byte of data, no encoding to get wrong.
  var CLOSE_ACCOUNT_OPCODE = 9;

  // ── transaction-size arithmetic — a COMPUTED bound, not a magic number ──────────────────────
  // Solana's legacy Message wire format, byte for byte, for a transaction made ENTIRELY of
  // CloseAccount instructions signed by one signer (the owner, who is also the fee payer, the
  // destination, and the close authority on every instruction — so the owner's pubkey appears
  // MANY times in instruction account lists but only ONCE in the account-keys table):
  //
  //   signatures        : compact-u16 count (1 byte, count<128) + count * 64            = 1 + 64
  //   message header    : numRequiredSignatures/numReadonlySigned/numReadonlyUnsigned    = 3
  //   account keys      : compact-u16 count (1 byte, count<128) + count * 32 bytes
  //       — fixed keys, present once no matter how many closes are batched: owner (signer/fee
  //         payer/destination/authority — ONE entry) + the token program — 2 keys, 64 bytes
  //       — plus ONE new key per close instruction: the token account being closed (it is never
  //         reused across instructions, so it always adds a fresh 32-byte entry)
  //   recent blockhash  : fixed                                                          = 32
  //   instructions      : compact-u16 count (1 byte, count<128) + per instruction:
  //       program_id_index (1) + compact-u16 accounts-len (1, len=3<128) + 3 account-index
  //       bytes (3) + compact-u16 data-len (1, len=1<128) + 1 data byte (opcode)  = 7 bytes/ix
  //
  // So: fixed = (1+64) + 3 + (1 + 2*32) + 32 + 1 = 166 bytes, and each ADDITIONAL close costs
  // 32 (its own account-key entry) + 7 (its compiled instruction) = 39 bytes. All three
  // compact-u16 counts stay 1 byte as long as the batch is under 128 (true well before the size
  // limit binds — see MAX_CLOSES_PER_TX below). Solana's hard ceiling on a serialized transaction
  // is 1232 bytes (the 1280-byte IPv6 MTU minus 48 bytes of packet headers). SAFETY_MARGIN_BYTES
  // absorbs the two things this arithmetic doesn't model — a mixed classic+Token-2022 batch adds
  // one extra 32-byte program-id key, and different wallets round-trip a signed transaction with
  // small incidental differences — without needing a second, more fragile formula for either.
  var MAX_TX_BYTES = 1232;
  var SAFETY_MARGIN_BYTES = 40;
  var FIXED_OVERHEAD_BYTES = 166; // sigs(65) + header(3) + keys-len(1) + fixed keys(64) + blockhash(32) + ix-len(1)
  var PER_CLOSE_BYTES = 39; // one new 32-byte account key + one 7-byte compiled instruction
  var MAX_CLOSES_PER_TX = Math.floor((MAX_TX_BYTES - SAFETY_MARGIN_BYTES - FIXED_OVERHEAD_BYTES) / PER_CLOSE_BYTES);
  // With the numbers above: floor((1232 - 40 - 166) / 39) = floor(1026 / 39) = 26 closes per
  // transaction. A 40-account wallet therefore plans into 2 batches (26 + 14) — see
  // scripts/seeker-reclaim-sign-test.cjs Test 5.

  function isWrappedSol(mint) { return mint === WSOL_MINT; }

  // ⚠️ P1-B (adversarial review, 2026-09-21): classify on the EXACT base-unit `amount` STRING,
  // never on `uiAmount`. `uiAmount` is `f64 | null` in the RPC schema — a Token-2022 account with
  // withheld transfer fees (or any account the RPC can't ui-scale) comes back `uiAmount: null`,
  // and `Number(null) === 0`, which used to read a wallet that STILL HOLDS TOKENS as empty and
  // safe to close. `amount` is never null for an account that exists; anything else
  // (non-numeric, missing) is treated as holds_balance, NEVER reclaimable — an unreadable balance
  // can only ever err toward refusing to close.
  function isZeroAmount(amount) {
    return typeof amount === "string" && amount === "0";
  }

  // Rule 2 + Rule 3, applied to a scan-side account record ({tokenAccount, mint, program,
  // amount, uiAmount, lamports, ...} — the exact shape GET /api/seeker/reclaimable returns per
  // account, lib/rent-reclaim.js's own P1-B fix). `uiAmount` is display-only here — never read.
  function classifyForClose(acc) {
    if (!acc || !acc.tokenAccount || !acc.mint || !acc.program) {
      return { eligible: false, reason: "malformed account record" };
    }
    if (isWrappedSol(acc.mint)) {
      return { eligible: false, reason: "Wrapped SOL — closing it is not offered here." };
    }
    if (!isZeroAmount(acc.amount)) {
      return { eligible: false, reason: "Still holds a token balance — closing it would lose that balance." };
    }
    return { eligible: true, reason: null };
  }

  function selectEligible(accounts) {
    var out = [];
    (accounts || []).forEach(function (a) {
      if (classifyForClose(a).eligible) out.push(a);
    });
    return out;
  }

  // Idempotency, part 1 (spec §5 Test 7): a re-run must not attempt an account a PRIOR run
  // already confirmed closed. `closedTokenAccounts` is whatever the caller remembers from earlier
  // confirmed rows (an array or a Set of tokenAccount strings) — the caller (reclaim-sign.js /
  // the pane's component state) is expected to accumulate this across clicks in a session.
  function excludeAlreadyClosed(candidates, closedTokenAccounts) {
    var closed = closedTokenAccounts instanceof Set ? closedTokenAccounts : new Set(closedTokenAccounts || []);
    var kept = [], excluded = [];
    (candidates || []).forEach(function (c) {
      if (closed.has(c.tokenAccount)) {
        excluded.push(mergeRow(c, "skipped", "already closed in a previous run"));
      } else {
        kept.push(c);
      }
    });
    return { kept: kept, excluded: excluded };
  }

  // Idempotency, part 2 + Rule 2's "immediately before building" re-check (spec §2.2/§2.6/§5
  // Test 3): `freshMap` maps tokenAccount -> { exists, amount, lamports, mint, owner }, produced
  // by a REAL, JUST-NOW chain read (io.getFreshBalances — a getMultipleAccounts call, so `owner`
  // here is the account's PARSED AUTHORITY, info.owner — the wallet that controls the token
  // account — never the owning PROGRAM id getMultipleAccounts' top-level `owner` field would
  // give you; the browser seam (src/seeker/reclaim-sign.js) is what maps the raw RPC response
  // into this shape). An account the fresh read says no longer exists is treated as "already
  // closed elsewhere" (harmless — it just quietly drops off this run's candidate list, exactly
  // like a row a previous run already confirmed) rather than an error.
  //
  // `freshMap == null` means the fresh read itself FAILED — never fall through and treat that as
  // "everything is still zero, safe to close" (spec's hard "unavailable, never zero" rule, same
  // one CLAUDE.md states for the tool gate and lib/rent-reclaim.js's own read side). It throws a
  // tagged error (`.code === "unavailable"`) instead of returning a result, so a caller cannot
  // accidentally ignore it and keep going.
  //
  // ⚠️ P2-I (adversarial review, 2026-09-21): the SERVER'S claimed lamports/mint were, until now,
  // carried straight through to the confirm sheet and the close instruction untouched — even
  // though the fresh read right here already has the true on-chain values for exactly these
  // accounts. This is the one place that HAS the truth, so it now (a) overwrites `lamports` with
  // the just-read on-chain value (the confirm sheet and the reclaimed total are built from
  // `kept`, so they inherit this automatically) and (b) drops — never closes — any candidate
  // whose fresh mint differs from what the server claimed, or whose fresh owner (the account's
  // real authority) is not the CONNECTED wallet. A caller (server response, or anything upstream
  // of it) claiming a token account that isn't actually this wallet's, or mislabeling its mint,
  // can therefore never reach a close instruction — closes the hostile-server-data class at the
  // read step, not by trusting buildCloseInstruction's owner check alone.
  function reverifyBalances(candidates, freshMap, connectedOwner) {
    if (freshMap == null) {
      var e = new Error("Could not re-verify balances — the chain is unavailable right now.");
      e.code = "unavailable";
      throw e;
    }
    var kept = [], dropped = [];
    (candidates || []).forEach(function (c) {
      var fresh = freshMap[c.tokenAccount];
      if (!fresh || fresh.exists === false) {
        dropped.push(mergeRow(c, "skipped", "no longer exists — already closed"));
        return;
      }
      if (!isZeroAmount(fresh.amount)) {
        dropped.push(mergeRow(c, "skipped", "gained a balance since the scan"));
        return;
      }
      if (fresh.mint && c.mint && fresh.mint !== c.mint) {
        dropped.push(mergeRow(c, "skipped", "the mint on-chain doesn't match what was scanned — refused"));
        return;
      }
      if (connectedOwner && fresh.owner && fresh.owner !== connectedOwner) {
        dropped.push(mergeRow(c, "skipped", "this account isn't controlled by the connected wallet — refused"));
        return;
      }
      var freshLamports = typeof fresh.lamports === "number" && isFinite(fresh.lamports) ? fresh.lamports : c.lamports;
      kept.push(Object.assign({}, c, { lamports: freshLamports }));
    });
    return { kept: kept, dropped: dropped };
  }

  // Rule 1: builds ONE CloseAccount instruction descriptor. `destination` and `owner` are BOTH
  // required and are checked against each other — not merely both defaulted to the same variable
  // by whoever calls this — so a bug upstream that threads a different value through here still
  // gets refused. Also re-refuses wrapped SOL and an unrecognized token program as belt-and-braces
  // (classifyForClose already excludes both upstream; this is defense in depth, not the only
  // check — spec's review question is "can ANY input make the rent go somewhere else").
  function buildCloseInstruction(params) {
    var tokenAccount = params && params.tokenAccount;
    var mint = params && params.mint;
    var destination = params && params.destination;
    var owner = params && params.owner;
    var programId = params && params.programId;
    if (!tokenAccount || !mint || !destination || !owner || !programId) {
      throw new Error("buildCloseInstruction: missing a required field");
    }
    if (isWrappedSol(mint)) {
      throw new Error("refused: wrapped SOL is not closed by this tool");
    }
    if (destination !== owner) {
      throw new Error("refused: close destination must equal the connected wallet");
    }
    if (programId !== TOKEN_PROGRAM_CLASSIC && programId !== TOKEN_PROGRAM_2022) {
      throw new Error("refused: unrecognized token program");
    }
    return {
      programId: programId,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: [CLOSE_ACCOUNT_OPCODE],
    };
  }

  function buildBatchDescriptors(batch, owner) {
    return (batch || []).map(function (c) {
      return buildCloseInstruction({ tokenAccount: c.tokenAccount, mint: c.mint, destination: owner, owner: owner, programId: c.program });
    });
  }

  // Chunk an already-filtered candidate list into transactions under the computed size bound.
  function planBatches(candidates, maxPerBatch) {
    var cap = maxPerBatch > 0 ? maxPerBatch : MAX_CLOSES_PER_TX;
    var batches = [], current = [];
    (candidates || []).forEach(function (c) {
      if (current.length >= cap) { batches.push(current); current = []; }
      current.push(c);
    });
    if (current.length) batches.push(current);
    return batches;
  }

  function lamportsForList(list) {
    return (list || []).reduce(function (s, c) { return s + (Number(c.lamports) || 0); }, 0);
  }

  function mergeRow(acc, outcome, reason, extra) {
    var row = { tokenAccount: acc.tokenAccount, mint: acc.mint, lamports: Number(acc.lamports) || 0, outcome: outcome, reason: reason || null };
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) row[k] = extra[k]; }
    return row;
  }

  // Rule: "never claim success from a submitted signature alone" — reclaimedLamports sums ONLY
  // outcome === "confirmed" rows. Every other outcome ("failed", "skipped", "rejected") is
  // reported but contributes nothing to the total.
  function summarize(rows) {
    var reclaimedLamports = 0, confirmed = 0, failed = 0, skipped = 0, rejected = 0;
    (rows || []).forEach(function (r) {
      if (r.outcome === "confirmed") { reclaimedLamports += Number(r.lamports) || 0; confirmed++; }
      else if (r.outcome === "failed") failed++;
      else if (r.outcome === "skipped") skipped++;
      else if (r.outcome === "rejected") rejected++;
    });
    return {
      reclaimedLamports: reclaimedLamports,
      confirmedCount: confirmed,
      failedCount: failed,
      skippedCount: skipped,
      rejectedCount: rejected,
      rows: rows || [],
    };
  }

  // ── shared select -> exclude-already-closed -> fresh re-verify (Rule 6) ─────────────────────
  // The FIRST half of the orchestrator, factored out so the confirm sheet (planConfirmation,
  // P2-I) runs the exact same safety checks the real run will apply — a re-implementation for
  // "just the numbers" is exactly how a check like this drifts out of sync and stops meaning
  // anything. Returns either { status: "unavailable", rows } or { status: "ok", toClose, rows }.
  async function prepareCandidates(input, io) {
    var owner = input && input.owner;
    if (!owner) throw new Error("owner (the connected wallet) is required");

    var eligible = selectEligible((input && input.accounts) || []);
    var idem = excludeAlreadyClosed(eligible, input && input.closedTokenAccounts);
    var rows = idem.excluded.slice();
    var candidates = idem.kept;

    if (!candidates.length) return { status: "ok", toClose: [], rows: rows };

    var freshMap = null;
    try {
      freshMap = await io.getFreshBalances(candidates.map(function (c) { return c.tokenAccount; }));
    } catch (e) {
      freshMap = null;
    }
    var reverified;
    try {
      reverified = reverifyBalances(candidates, freshMap, owner);
    } catch (e) {
      if (e && e.code === "unavailable") return { status: "unavailable", toClose: [], rows: rows };
      throw e;
    }
    rows = rows.concat(reverified.dropped);
    return { status: "ok", toClose: reverified.kept, rows: rows };
  }

  // ── confirm-sheet support (P2-I) ────────────────────────────────────────────────────────────
  // Runs the SAME selection + fresh re-verify runReclaimFlow is about to run, so the numbers a
  // person signs off on are read from the chain right before the confirm sheet renders, not
  // whatever the (possibly minutes-old) initial scan said. Never signs, never builds a
  // transaction — `io` here only needs to supply getFreshBalances. Returns { status: "ok" |
  // "unavailable", toClose, lamports, rows }; `toClose` is what the real run should be handed so
  // it doesn't have to guess, and `rows` carries honest reasons for anything already dropped
  // (e.g. "gained a balance since the scan") so a lower count than the original scan showed is
  // never a silent discrepancy.
  async function planConfirmation(input, io) {
    var prep = await prepareCandidates(input, io);
    return {
      status: prep.status,
      toClose: prep.toClose,
      lamports: lamportsForList(prep.toClose),
      rows: prep.rows,
    };
  }

  // Build, sign, send and confirm ONE round of batches, returning { rows, allRejected }.
  // `allRejected` mirrors the old inline check (every batch declined) so runReclaimFlow's status
  // stays correct even after a retry round runs (a retry never touches a rejected batch — see
  // below — so this flag, captured on the FIRST round, is still the right answer for the whole
  // run). Factored out so the P1-D retry-as-singles round below is the identical code path, not
  // a second, drifting implementation of "send a batch and read back what happened".
  async function sendAndConfirmBatches(io, owner, blockhash, batches) {
    var descriptorBatches = batches.map(function (b) { return buildBatchDescriptors(b, owner); });
    var rows = [];
    var sendResults;
    try {
      sendResults = await io.signAndSendAll(descriptorBatches, blockhash, owner);
    } catch (e) {
      if (e && e.rejected) {
        // The whole run was declined in ONE prompt (e.g. signAllTransactions itself was
        // rejected) before any signature exists — nothing here can claim success. A rejected
        // signature is a normal outcome, not an error state (spec §3): every planned close is
        // reported "rejected", never "failed".
        batches.forEach(function (b) { b.forEach(function (c) { rows.push(mergeRow(c, "rejected", "you declined to sign")); }); });
        return { rows: rows, allRejected: true };
      }
      // Some other outright failure preparing/sending — never silently drop these accounts from
      // the report; they simply did not close.
      batches.forEach(function (b) { b.forEach(function (c) { rows.push(mergeRow(c, "failed", (e && e.message) || String(e))); }); });
      return { rows: rows, allRejected: false };
    }

    for (var i = 0; i < batches.length; i++) {
      var batch = batches[i];
      var r = sendResults[i] || { error: "no result returned for this batch" };
      if (r.rejected) {
        batch.forEach(function (c) { rows.push(mergeRow(c, "rejected", "you declined to sign")); });
        continue;
      }
      if (!r.sig) {
        batch.forEach(function (c) { rows.push(mergeRow(c, "failed", r.error || "could not submit")); });
        continue;
      }
      var confirmed = false, confirmError = null;
      try { confirmed = await io.confirmSignature(r.sig); }
      catch (e) { confirmError = (e && e.message) || String(e); }
      (function (sig, isConfirmed, err) {
        batch.forEach(function (c) {
          if (isConfirmed) rows.push(mergeRow(c, "confirmed", null, { sig: sig }));
          else if (err) rows.push(mergeRow(c, "failed", "closing transaction failed on-chain: " + err, { sig: sig }));
          else rows.push(mergeRow(c, "failed", "submitted but unconfirmed after the wait — check the signature before retrying", { sig: sig }));
        });
      })(r.sig, confirmed, confirmError);
    }

    var allRejected = batches.length > 0 && sendResults.every(function (r) { return r && r.rejected; });
    return { rows: rows, allRejected: allRejected };
  }

  // ── the orchestrator ─────────────────────────────────────────────────────────────────────────
  // Runs the WHOLE signing flow end to end: select -> exclude already-closed -> re-verify fresh
  // (Rule 6: re-verify, then build, then sign, in that order, smallest possible window) -> batch
  // -> for each batch build descriptors, fetch a blockhash, sign+send, confirm -> P1-D: any batch
  // that failed OUTRIGHT (not declined) is re-planned as one transaction per account and retried
  // exactly once -> summarize.
  //
  // `input`: { accounts, owner, closedTokenAccounts, maxClosesPerTx }
  //   accounts             — the scan result's `.accounts` array (GET /api/seeker/reclaimable),
  //                          or the `toClose` a prior planConfirmation() call already re-verified.
  //   owner                — the CONNECTED wallet's pubkey string. Never taken from anywhere else.
  //   closedTokenAccounts  — tokenAccounts a PRIOR run of this function already confirmed (array
  //                          or Set) — idempotency across repeated clicks in the same session.
  //   maxClosesPerTx       — optional override for planBatches' cap (default MAX_CLOSES_PER_TX,
  //                          the computed bound above). Exists so a caller — or
  //                          scripts/seeker-reclaim-sign-test.cjs, forcing one close per
  //                          transaction to exercise per-batch outcomes without needing 26+
  //                          fixture accounts — can ask for smaller batches; it can only make
  //                          batches SMALLER than the computed bound, never larger (planBatches
  //                          ignores a non-positive value and falls back to the real cap).
  //
  // `io`: four injected async functions — the ENTIRE surface this file touches outside itself,
  // and the entire surface a test needs to fake (spec §5: "fixtures and a fake MWA bridge — no
  // live RPC, no real signing"):
  //   io.getFreshBalances(tokenAccounts) -> { [tokenAccount]: {exists, amount, lamports, mint,
  //                                            owner} } | throws/null
  //   io.getBlockhash()                  -> blockhash string | throws/null
  //   io.signAndSendAll(descriptorBatches, blockhash, owner)
  //       -> array, one entry per batch, of { sig } | { rejected: true } | { error: string }
  //   io.confirmSignature(sig)           -> true (landed) | false (timed out, ambiguous) | throws
  //                                          (failed on-chain)
  //
  // Returns { status: "ok"|"unavailable"|"rejected", reclaimedLamports, confirmedCount,
  //           failedCount, skippedCount, rejectedCount, rows }. `status` is about the RUN as a
  // whole (could the chain be read at all; did the person say no); the per-row outcomes are
  // always the honest per-account record regardless of `status`.
  async function runReclaimFlow(input, io) {
    var owner = input && input.owner;
    if (!owner) throw new Error("runReclaimFlow: owner (the connected wallet) is required");

    var prep = await prepareCandidates(input, io);
    if (prep.status === "unavailable") return Object.assign({ status: "unavailable" }, summarize(prep.rows));
    var rows = prep.rows;
    var toClose = prep.toClose;

    if (!toClose.length) {
      return Object.assign({ status: "ok" }, summarize(rows));
    }

    var blockhash = null;
    try { blockhash = await io.getBlockhash(); } catch (e) { blockhash = null; }
    if (!blockhash) {
      return Object.assign({ status: "unavailable" }, summarize(rows));
    }

    var requestedCap = input && input.maxClosesPerTx > 0 ? input.maxClosesPerTx : MAX_CLOSES_PER_TX;
    var batches = planBatches(toClose, Math.min(requestedCap, MAX_CLOSES_PER_TX));

    var first = await sendAndConfirmBatches(io, owner, blockhash, batches);
    rows = rows.concat(first.rows);

    // ⚠️ P1-D (adversarial review, 2026-09-21): a batch is ONE atomic transaction — if it fails
    // on-chain because of ONE poisoned account (Token-2022 withheld transfer fees, a
    // confidential account, anything classification doesn't model), sendAndConfirmBatches just
    // marked EVERY account in that batch "failed", even though the other 25 would have closed
    // fine on their own. Re-plan any batch that failed OUTRIGHT — never a DECLINED one; a
    // decline is a normal "no" and is never retried — as one transaction per account, and retry
    // exactly once. A retry is safe: reverifyBalances already dropped anything that no longer
    // exists, and closing an account twice is a no-op failure on the token program's side, never
    // a double-spend. Batches of exactly one account are skipped here — resending the identical
    // failing transaction gains nothing a single retry of the whole run wouldn't already offer.
    var retryAccounts = [];
    batches.forEach(function (b) {
      if (b.length <= 1) return;
      var repRow = rows.filter(function (r) { return r.tokenAccount === b[0].tokenAccount; }).pop();
      if (repRow && repRow.outcome === "failed") retryAccounts = retryAccounts.concat(b);
    });

    if (retryAccounts.length) {
      var retryBlockhash = null;
      try { retryBlockhash = await io.getBlockhash(); } catch (e) { retryBlockhash = null; }
      if (retryBlockhash) {
        var singleBatches = planBatches(retryAccounts, 1);
        var retried = await sendAndConfirmBatches(io, owner, retryBlockhash, singleBatches);
        var retriedTAs = {};
        retryAccounts.forEach(function (c) { retriedTAs[c.tokenAccount] = true; });
        rows = rows.filter(function (r) { return !retriedTAs[r.tokenAccount]; }).concat(retried.rows);
      }
      // If even a fresh blockhash isn't available, the accounts stay reported as they were —
      // "failed", with the original batch's signature attached — never silently dropped.
    }

    return Object.assign({ status: first.allRejected ? "rejected" : "ok" }, summarize(rows));
  }

  var CluckReclaimPlan = {
    TOKEN_PROGRAM_CLASSIC: TOKEN_PROGRAM_CLASSIC,
    TOKEN_PROGRAM_2022: TOKEN_PROGRAM_2022,
    WSOL_MINT: WSOL_MINT,
    CLOSE_ACCOUNT_OPCODE: CLOSE_ACCOUNT_OPCODE,
    MAX_TX_BYTES: MAX_TX_BYTES,
    SAFETY_MARGIN_BYTES: SAFETY_MARGIN_BYTES,
    FIXED_OVERHEAD_BYTES: FIXED_OVERHEAD_BYTES,
    PER_CLOSE_BYTES: PER_CLOSE_BYTES,
    MAX_CLOSES_PER_TX: MAX_CLOSES_PER_TX,
    classifyForClose: classifyForClose,
    selectEligible: selectEligible,
    excludeAlreadyClosed: excludeAlreadyClosed,
    reverifyBalances: reverifyBalances,
    buildCloseInstruction: buildCloseInstruction,
    buildBatchDescriptors: buildBatchDescriptors,
    planBatches: planBatches,
    lamportsForList: lamportsForList,
    summarize: summarize,
    prepareCandidates: prepareCandidates,
    planConfirmation: planConfirmation,
    sendAndConfirmBatches: sendAndConfirmBatches,
    runReclaimFlow: runReclaimFlow,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CluckReclaimPlan;
  if (typeof global !== "undefined") global.CluckReclaimPlan = CluckReclaimPlan;
})(typeof globalThis !== "undefined" ? globalThis : this);
