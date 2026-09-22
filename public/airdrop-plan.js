/* Cluck Norris — airdrop PLANNING decisions, in one pure, dependency-free place.
 *
 * The Seeker app's Airdropper drives the platform's proven batch-transfer engine
 * (public/airdrop-engine.js, window.CluckAirdrop) for everything that touches the chain. What
 * this file owns is the part BEFORE the wallet is ever asked to sign: turning a pasted list into
 * recipients, and turning recipients into a cost the sender sees before they commit.
 *
 * Kept out of the pane, and pure, for the same reason public/rent-reclaim-plan.js is: this is
 * where money-shaped mistakes live, and a decision you can `require()` from a .cjs test is a
 * decision that can be pinned with fixtures instead of argued about. It is dual-exported (window
 * global + CommonJS) exactly the way rent-math.js and rent-reclaim-plan.js are.
 *
 * ── TWO REAL BUGS IN THE DESKTOP PARSER THAT THIS FILE DOES NOT REPRODUCE ────────────────────
 * Found reading public/airdrop.html's parseRecipients() while building the phone version. Both
 * are live on the website today; neither is fixed here (this file is not loaded by that page) —
 * they are written down so the next person to touch airdrop.html knows, and so nobody "aligns"
 * this file to that one.
 *
 *   1. AMBIGUOUS NUMBER FORMATS ARE SILENTLY COERCED.
 *      `parseFloat(amtStr.replace(/[^0-9.]/g, ''))` turns the European "1.234,56" into "1.23456"
 *      → 1.23456 tokens instead of 1234.56. It also turns "1,234.56" into 1234.56 correctly, so
 *      the two formats are indistinguishable to it and one of them is wrong by ~1000×. Here, a
 *      row whose number could mean two different things is REJECTED with a reason and shown to
 *      the operator, never guessed. The engine's own rule for the transfer itself is "never
 *      guess for the actual transfer" — this is that rule, one step earlier.
 *
 *   2. DUPLICATE ADDRESSES ARE SUMMED IN FLOATS, AND SILENTLY.
 *      `existing.amount += amount` is a float add, and airdrop-engine.js's own toBaseUnits()
 *      comment explains why that is not safe: a JS number loses precision above ~9e15, which at
 *      nine decimals is ~9 million tokens — inside a normal payout row. The float damage is done
 *      before the engine's careful string surgery ever sees the value. Worse, the merge is
 *      invisible: a list with an accidental duplicate quietly pays one wallet twice as much.
 *      Here amounts stay DECIMAL STRINGS end to end, duplicates are summed by aligning decimal
 *      points and adding digit by digit (addDecimal below), and the merge count is returned so
 *      the pane can say it out loud before anyone signs.
 *
 * Nothing in this file talks to a network, a wallet or the chain.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.CluckAirdropPlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Solana base58, same shape the rest of the repo uses (lib/solana-addr, the panes' ADDR_RE).
  var ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function isValidAddress(s) { return ADDR_RE.test(String(s || "").trim()); }

  // ── amounts, as strings ──────────────────────────────────────────────────────────────────
  // Accepted: "1234", "1234.56", ".5", "1,234.56" and "1 234.56" (grouped thousands, dot
  // decimal). Rejected — with a reason, never coerced: a comma used as the DECIMAL mark
  // ("1,5" / "1.234,56"), anything with two decimal marks, scientific notation, and negatives.
  // A rejected row is shown to the operator; it is never sent and never silently reinterpreted.
  function parseAmount(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, reason: "no amount on this line" };
    if (/[eE]/.test(s)) return { ok: false, reason: "scientific notation — write the number out in full" };
    if (/^-/.test(s)) return { ok: false, reason: "negative amount" };
    // Strip a currency-ish prefix/suffix but NOT digit separators — those decide the meaning.
    s = s.replace(/^[^0-9.,]+/, "").replace(/[^0-9.,]+$/, "");
    if (!s) return { ok: false, reason: "no digits in the amount" };

    var dots = (s.match(/\./g) || []).length;
    var commas = (s.match(/,/g) || []).length;
    if (dots > 1) return { ok: false, reason: "more than one decimal point" };
    if (dots === 1 && commas > 0) {
      // Both present: whichever comes LAST is the decimal mark. "1,234.56" is fine;
      // "1.234,56" means something different from what an English reader assumes — reject it.
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) return { ok: false, reason: 'unclear format — is "' + s + '" a comma decimal? write it as 1234.56' };
      s = s.replace(/,/g, "");
    } else if (commas > 0) {
      // Commas only. Grouped thousands are unambiguous ONLY in the 1,234,567 shape; anything
      // else ("1,5", "12,34") is a comma decimal in some locale and a typo in others.
      if (!/^[0-9]{1,3}(,[0-9]{3})+$/.test(s)) return { ok: false, reason: 'unclear format — is "' + s + '" a comma decimal? write it as 1234.56' };
      s = s.replace(/,/g, "");
    }
    // ⚠️ NO whitespace stripping. An early version of this function stripped internal spaces,
    // and the per-wallet splitter below fed it "1.234 56" (what "1.234,56" becomes once the row
    // is split on commas) — which collapsed to "1.23456" and let the European format straight
    // back in through the side door, the exact bug §2 of the test exists to refuse. Its own test
    // caught it. Anything with a space left in it by this point is ambiguous: refuse it.
    if (/[\s_]/.test(s)) return { ok: false, reason: 'unclear format — write "' + s.trim() + '" as a single number, e.g. 1234.56' };
    if (!/^[0-9]*\.?[0-9]*$/.test(s) || !/[0-9]/.test(s)) return { ok: false, reason: "not a number" };
    if (/^0*(\.0*)?$/.test(s)) return { ok: false, reason: "amount is zero" };
    return { ok: true, value: normalizeDecimal(s) };
  }

  function normalizeDecimal(s) {
    var p = String(s).split(".");
    var whole = (p[0] || "").replace(/^0+(?=[0-9])/, "") || "0";
    var frac = (p[1] || "").replace(/0+$/, "");
    return frac ? whole + "." + frac : whole;
  }

  // Add two non-negative decimal STRINGS exactly. No Number() anywhere: a float add is what
  // makes a 29,000,000-token row come out 2 base units short (see the header).
  function addDecimal(a, b) {
    var A = String(a).split("."), B = String(b).split(".");
    var aw = A[0] || "0", af = A[1] || "", bw = B[0] || "0", bf = B[1] || "";
    var n = Math.max(af.length, bf.length);
    while (af.length < n) af += "0";
    while (bf.length < n) bf += "0";
    var x = (aw + af).replace(/^0+(?=[0-9])/, ""), y = (bw + bf).replace(/^0+(?=[0-9])/, "");
    var sum = addDigits(x, y);
    if (n === 0) return normalizeDecimal(sum);
    while (sum.length <= n) sum = "0" + sum;
    return normalizeDecimal(sum.slice(0, sum.length - n) + "." + sum.slice(sum.length - n));
  }
  function addDigits(x, y) {
    var i = x.length - 1, j = y.length - 1, carry = 0, out = "";
    while (i >= 0 || j >= 0 || carry) {
      var d = carry + (i >= 0 ? x.charCodeAt(i--) - 48 : 0) + (j >= 0 ? y.charCodeAt(j--) - 48 : 0);
      out = String(d % 10) + out; carry = d >= 10 ? 1 : 0;
    }
    return out || "0";
  }
  // Subtract two non-negative decimal STRINGS exactly, clamped at zero. Same no-Number() rule as
  // addDecimal — this feeds a "you are short by X" line, and a float there would report a
  // shortfall of 0.00000000000001 on two numbers that are actually equal.
  function subDecimal(a, b) {
    if (cmpDecimal(a, b) <= 0) return "0";
    var A = String(a).split("."), B = String(b).split(".");
    var af = A[1] || "", bf = B[1] || "";
    var n = Math.max(af.length, bf.length);
    while (af.length < n) af += "0";
    while (bf.length < n) bf += "0";
    var x = ((A[0] || "0") + af).replace(/^0+(?=[0-9])/, "");
    var y = ((B[0] || "0") + bf).replace(/^0+(?=[0-9])/, "");
    var diff = subDigits(x, y);
    if (n === 0) return normalizeDecimal(diff);
    while (diff.length <= n) diff = "0" + diff;
    return normalizeDecimal(diff.slice(0, diff.length - n) + "." + diff.slice(diff.length - n));
  }
  function subDigits(x, y) {
    var i = x.length - 1, j = y.length - 1, borrow = 0, out = "";
    while (i >= 0 || j >= 0) {
      var d = (i >= 0 ? x.charCodeAt(i--) - 48 : 0) - (j >= 0 ? y.charCodeAt(j--) - 48 : 0) - borrow;
      if (d < 0) { d += 10; borrow = 1; } else { borrow = 0; }
      out = String(d) + out;
    }
    return out.replace(/^0+(?=[0-9])/, "") || "0";
  }

  // A chain balance is base units (an integer STRING) plus a decimals count. Turning it into a
  // comparable decimal must not go through Number: a token with 9 decimals and a large supply
  // exceeds 2^53 in base units, which is exactly the class of balance an airdropper deals with.
  // This is pure string surgery — insert a point, pad, normalise.
  function baseUnitsToDecimal(amount, decimals) {
    var s = String(amount == null ? "" : amount).trim();
    if (!/^[0-9]+$/.test(s)) return null;
    var d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 30) return null;
    if (d === 0) return normalizeDecimal(s);
    while (s.length <= d) s = "0" + s;
    return normalizeDecimal(s.slice(0, s.length - d) + "." + s.slice(s.length - d));
  }

  // a >= b, on decimal strings. Used only for the "skip below" filter.
  function cmpDecimal(a, b) {
    var A = String(a).split("."), B = String(b).split(".");
    var aw = (A[0] || "0").replace(/^0+(?=[0-9])/, ""), bw = (B[0] || "0").replace(/^0+(?=[0-9])/, "");
    if (aw.length !== bw.length) return aw.length < bw.length ? -1 : 1;
    if (aw !== bw) return aw < bw ? -1 : 1;
    var af = A[1] || "", bf = B[1] || "", n = Math.max(af.length, bf.length);
    while (af.length < n) af += "0";
    while (bf.length < n) bf += "0";
    if (af === bf) return 0;
    return af < bf ? -1 : 1;
  }

  // ── the list ─────────────────────────────────────────────────────────────────────────────
  // mode "equal"     — text is one address per line; every row gets `equalAmount`.
  // mode "perWallet" — text is "address,amount" (comma, tab, pipe, or whitespace separated,
  //                    either order), which is what a holder export or a spreadsheet gives you.
  //
  // Returns EVERY outcome separately, because collapsing them is how an operator ends up
  // believing they sent to people they did not:
  //   rows      — what will actually be sent, amounts as decimal strings
  //   invalid   — lines that could not be read, each with its own reason and the line itself
  //   skipped   — valid rows held back by the `minAmount` filter
  //   merged    — addresses that appeared more than once, with what they were merged into
  function parseRecipients(opts) {
    opts = opts || {};
    var mode = opts.mode === "perWallet" ? "perWallet" : "equal";
    var lines = String(opts.text || "").split(/\r?\n/);
    var minAmount = opts.minAmount ? parseAmount(opts.minAmount) : null;
    var min = minAmount && minAmount.ok ? minAmount.value : null;

    var equal = null;
    if (mode === "equal") {
      equal = parseAmount(opts.equalAmount);
      if (!equal.ok) return { rows: [], invalid: [], skipped: [], merged: [], total: "0", error: equal.reason };
    }

    var byAddr = Object.create(null), order = [], invalid = [], merged = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      // A header row from a spreadsheet export. Matched on the WHOLE cell, not a substring:
      // "address" appears inside plenty of real data, and the desktop tool's substring test
      // would drop a legitimate line that merely contained the word.
      if (/^(wallet|address|owner|holder)\b/i.test(line) && !ADDR_RE.test(line.split(/[,\t|\s]+/)[0])) continue;

      var addr = null, amtRaw = null;
      if (mode === "equal") {
        addr = line.split(/[,\t|\s]+/)[0];
        amtRaw = equal.value;
      } else {
        var parts = line.split(/[,\t|]/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length < 2) parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 2) { invalid.push({ line: line, reason: "no amount on this line" }); continue; }
        // ⚠️ EXACTLY two fields, or the row is ambiguous. The obvious implementation —
        // "address is one field, join everything else back together" — silently repairs
        // "<addr>,1.234,56" into "1.234 56" and then into 1.23456, which is the comma-decimal
        // bug this file exists to refuse, arriving through the splitter instead of the parser.
        // A third field means the operator's separator and their decimal mark are the same
        // character, and nothing on the line says which is which. Refuse and show them the row.
        if (parts.length > 2) { invalid.push({ line: line, reason: "too many values on this line — is a comma being used as both a separator and a decimal point?" }); continue; }
        // Either order — a holder export puts the address first, a payout sheet often doesn't.
        if (isValidAddress(parts[0])) { addr = parts[0]; amtRaw = parts[1]; }
        else { addr = parts[1]; amtRaw = parts[0]; }
      }

      if (!isValidAddress(addr)) { invalid.push({ line: line, reason: "not a valid Solana address" }); continue; }
      var amt = mode === "equal" ? { ok: true, value: equal.value } : parseAmount(amtRaw);
      if (!amt.ok) { invalid.push({ line: line, reason: amt.reason }); continue; }

      if (byAddr[addr]) {
        // ⚠️ The two modes MERGE DIFFERENTLY, and the difference is the operator's intent.
        // "address,amount" rows are line items: the same wallet twice means two payments, so
        // they sum. "Give everyone X" listed twice still means X — summing there would double
        // one person's share because their address got pasted twice, which is not a decision
        // anyone made. Either way the repeat is REPORTED (merged[]) rather than swallowed; the
        // desktop tool does neither.
        if (mode === "perWallet") byAddr[addr].amount = addDecimal(byAddr[addr].amount, amt.value);
        byAddr[addr].times += 1;
        continue;
      }
      byAddr[addr] = { addr: addr, amount: amt.value, times: 1 };
      order.push(addr);
    }

    var rows = [], skipped = [], total = "0";
    for (var k = 0; k < order.length; k++) {
      var r = byAddr[order[k]];
      if (r.times > 1) merged.push({ addr: r.addr, times: r.times, amount: r.amount });
      if (min && cmpDecimal(r.amount, min) < 0) { skipped.push({ addr: r.addr, amount: r.amount, reason: "below the minimum you set" }); continue; }
      rows.push({ addr: r.addr, amount: r.amount });
      total = addDecimal(total, r.amount);
    }
    return { rows: rows, invalid: invalid, skipped: skipped, merged: merged, total: total, error: null };
  }

  // ── what it will cost ────────────────────────────────────────────────────────────────────
  // Mirrors airdrop-engine.js's planBatches weighting exactly (a recipient needing a new token
  // account costs 2 slots, everyone else 1) so the transaction count the sender is shown is the
  // transaction count the engine will actually produce. `lamportsPerAta` is the LIVE rent the
  // caller read from the chain — never a constant here (Agave 4.2 lowers rent across five
  // feature gates from 2026-09-10, so a frozen number drifts, and it drifts UP: the estimate
  // would overstate the cost and the sender would be told they cannot afford something they can).
  function estimateCost(opts) {
    opts = opts || {};
    var rows = opts.rows || [];
    var budget = opts.weightBudget || 16;
    var native = !!opts.native;
    var txCount = 0, weight = 0, newAtas = 0;
    for (var i = 0; i < rows.length; i++) {
      var needsAta = !native && !!rows[i].needsAta;
      if (needsAta) newAtas++;
      var cost = needsAta ? 2 : 1;
      if (weight && weight + cost > budget) { txCount++; weight = 0; }
      weight += cost;
    }
    if (weight) txCount++;
    var feeLamports = txCount * (opts.lamportsPerTxFee || 5000);
    var rentLamports = newAtas * (opts.lamportsPerAta || 0);

    // What is available to SEND, as an exact decimal string, or null if we could not read it.
    // For a token drop that is the token balance. For a SOL drop the fees and the rent come out
    // of the same balance, so they are subtracted first — sending every lamport you hold is not
    // possible and telling someone it is would be the same lie in a smaller size.
    var sendable = null;
    if (native) {
      if (typeof opts.solBalanceLamports === "number") {
        var spare = opts.solBalanceLamports - feeLamports - rentLamports;
        sendable = baseUnitsToDecimal(String(spare > 0 ? spare : 0), 9);
      }
    } else if (opts.tokenBalanceBaseUnits != null) {
      sendable = baseUnitsToDecimal(opts.tokenBalanceBaseUnits, opts.decimals);
    }

    return {
      txCount: txCount, newAtas: newAtas,
      feeLamports: feeLamports, rentLamports: rentLamports,
      totalLamports: feeLamports + rentLamports,
      // A cost the sender can't cover is a thing to say BEFORE the first wallet prompt, not
      // after three batches have already gone out. null = we could not read their balance,
      // which is "unknown", never "affordable".
      affordable: typeof opts.solBalanceLamports === "number"
        ? opts.solBalanceLamports >= feeLamports + rentLamports : null,
      // ⚠️ `affordable` above is about FEES AND RENT ONLY, and for a long time it was the pane's
      // only pre-send check (adversarial review P1-3, 2026-09-21). It can never fire for the
      // AMOUNT BEING SENT — so a wallet holding 1,000,000 tokens could start a 1,500,000-token
      // drop with no warning at all, land the first k batches, and then fail every remaining one
      // with `insufficient funds`, a wallet prompt and a fee each time. Some recipients paid,
      // some not, and the public receipt publishes the partial list as a completed drop. A SOL
      // drop was worse: 100 wallets x 5 SOL from a 2 SOL wallet reported "about 0.000035 SOL"
      // and `affordable: true`, because 2 SOL comfortably covers the fees.
      //
      // The numbers were already in hand — the balance read is in the same RPC response the
      // decimals come from — they were simply never compared. All of this is decimal-string
      // arithmetic: a float here would be the very bug this module exists to refuse.
      //   sendable      what is actually available to send, after fees and rent for a SOL drop
      //   enoughToSend  true / false / null (null = balance unreadable, which is NOT "enough")
      //   shortBy       how much is missing, for a sentence a person can act on
      sendable: sendable,
      enoughToSend: sendable === null || opts.sendTotal == null ? null
        : cmpDecimal(sendable, String(opts.sendTotal)) >= 0,
      shortBy: sendable === null || opts.sendTotal == null ? null
        : subDecimal(String(opts.sendTotal), sendable),
    };
  }

  return {
    isValidAddress: isValidAddress,
    parseAmount: parseAmount,
    normalizeDecimal: normalizeDecimal,
    addDecimal: addDecimal,
    cmpDecimal: cmpDecimal,
    subDecimal: subDecimal,
    baseUnitsToDecimal: baseUnitsToDecimal,
    parseRecipients: parseRecipients,
    estimateCost: estimateCost,
  };
});
