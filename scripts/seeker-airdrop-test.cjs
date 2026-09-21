#!/usr/bin/env node
"use strict";
// The Airdropper's PLANNING decisions — public/airdrop-plan.js — pinned with fixtures.
//
// This moves money in bulk, and every decision below happens BEFORE the wallet is asked to sign,
// which is the last point at which a mistake is still free. The chain-touching half is
// public/airdrop-engine.js (the platform's one audited batch-transfer path, unchanged by this
// work) and its runtime behaviour in the shipped app is section G of seeker-app-boot-test.cjs.
//
// Two of these sections exist because the DESKTOP parser gets them wrong today, live on the
// website. They are documented in airdrop-plan.js's header so nobody "aligns" the new file to
// the old one. Neither is fixed here — public/airdrop.html is not this file's to change, and a
// silent behaviour change to a live money path is not something to slip into an app build.
//
//   §2 ambiguous number formats. parseFloat(s.replace(/[^0-9.]/g,'')) reads the European
//      "1.234,56" as 1.23456 — three orders of magnitude out, silently, on a payout row.
//   §3 duplicate addresses summed in FLOATS, and never mentioned. airdrop-engine.js's own
//      toBaseUnits() comment explains why a float add is unsafe past ~9e15 (≈9M tokens at nine
//      decimals — inside a normal weekly payout), and the merge is invisible either way.
//
// Usage: node scripts/seeker-airdrop-test.cjs
const path = require("path");
const ROOT = path.join(__dirname, "..");
const P = require(path.join(ROOT, "public", "airdrop-plan.js"));

let failures = 0;
const ok = (n, c, d) => { if (c) console.log("  ✓ " + n); else { failures++; console.log("  ✗ " + n + (d ? "\n      " + (typeof d === "string" ? d : JSON.stringify(d)) : "")); } };

const A = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const B = "6A5uicTYmdVerq5JDKcb3XC9J8sv5F7zMKGqBBYXcnrh";
const C = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

console.log("\n1. addresses\n");
ok("a real mint/wallet address is valid", P.isValidAddress(A) && P.isValidAddress(B));
ok("too long is rejected", !P.isValidAddress(A + "XX"));
ok("0/O/I/l are rejected (base58 has no look-alikes)", !P.isValidAddress("0W6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS"));
ok("too short is rejected", !P.isValidAddress("abc"));
ok("whitespace is trimmed, not rejected", P.isValidAddress("  " + A + "  "));

console.log("\n2. amounts — ambiguous formats are REFUSED, never guessed\n");
ok('"1234.56" reads as itself', P.parseAmount("1234.56").value === "1234.56");
ok('"1,234.56" is grouped thousands — 1234.56', P.parseAmount("1,234.56").value === "1234.56");
ok('"1,234,567" is grouped thousands — 1234567', P.parseAmount("1,234,567").value === "1234567");
// ⚠️ THE ONE THAT MATTERS. The desktop parser turns this into 1.23456 and sends a thousandth of
// what the operator meant. Refusing is the only honest answer: the string means different
// amounts in different locales and nothing on the line says which.
const eu = P.parseAmount("1.234,56");
ok('⚠️ "1.234,56" is REFUSED, not read as 1.23456', !eu.ok && /comma decimal/.test(eu.reason), JSON.stringify(eu));
ok('⚠️ "1,5" is REFUSED (comma decimal in six of our seven languages)', !P.parseAmount("1,5").ok);
ok('"12,34" is refused too — not a valid thousands group', !P.parseAmount("12,34").ok);
ok('".5" is fine', P.parseAmount(".5").value === "0.5");
ok('"0100.500" normalises to "100.5"', P.parseAmount("0100.500").value === "100.5");
ok("a negative amount is refused", !P.parseAmount("-5").ok);
ok("zero is refused (an empty transfer is never what anyone meant)", !P.parseAmount("0").ok && !P.parseAmount("0.000").ok);
ok("scientific notation is refused rather than expanded", !P.parseAmount("1e9").ok);
ok("two decimal points are refused", !P.parseAmount("1.2.3").ok);
ok("an empty cell is refused", !P.parseAmount("").ok && !P.parseAmount("   ").ok);

console.log("\n3. exact addition — no floats anywhere near a payout row\n");
// The float that airdrop-engine.js's own comment warns about: at nine decimals, ~9M tokens is
// where a JS number stops being exact, and these are ordinary payout sizes.
ok("29,000,000.123456789 + 0.000000001 is exact",
   P.addDecimal("29000000.123456789", "0.000000001") === "29000000.12345679");
ok("123,456,789.123456789 + 0.000000001 is exact",
   P.addDecimal("123456789.123456789", "0.000000001") === "123456789.12345679");
// The float answer here is 0.30000000000000004 — a classic, and it would go out as base units.
ok("0.1 + 0.2 is 0.3, not 0.30000000000000004", P.addDecimal("0.1", "0.2") === "0.3");
ok("carries propagate across the decimal point", P.addDecimal("0.999999999", "0.000000001") === "1");
ok("whole numbers add", P.addDecimal("999", "1") === "1000");
ok("different scales line up", P.addDecimal("1.5", "2.25") === "3.75");
{
  // A float would give 9007199254740992 for both of these — the same answer for two different
  // sums, which is exactly the class of error that makes paid ≠ sent.
  const a = P.addDecimal("9007199254740991", "1"), b = P.addDecimal("9007199254740991", "2");
  ok("past 2^53 two different sums stay different", a === "9007199254740992" && b === "9007199254740993", `${a} / ${b}`);
}
ok("comparison is exact too", P.cmpDecimal("0.1", "0.2") < 0 && P.cmpDecimal("10", "9.999") > 0 && P.cmpDecimal("1.50", "1.5") === 0);

console.log("\n4. the list — every outcome reported separately\n");
{
  const r = P.parseRecipients({ mode: "perWallet", text: [
    `${A},10`,
    `${B}\t2.5`,
    `${C} 0.25`,
    "notanaddress,3",
    `${A},5`,                 // duplicate — merged
    `${B},1.234,56`,          // comma as BOTH separator and decimal — refused
    "",
    "wallet,amount",          // a spreadsheet header
  ].join("\n") });
  ok("valid rows survive", r.rows.length === 3, JSON.stringify(r.rows));
  ok("comma, tab and space separators all parse", r.rows.map((x) => x.amount).join("|") === "15|2.5|0.25", JSON.stringify(r.rows));
  ok("⚠️ the duplicate is MERGED and REPORTED, not silently summed", r.merged.length === 1 && r.merged[0].times === 2 && r.merged[0].amount === "15", JSON.stringify(r.merged));
  ok("the bad address is invalid, with its own line and reason", r.invalid.some((v) => /notanaddress/.test(v.line) && /valid Solana address/.test(v.reason)), JSON.stringify(r.invalid));
  // ⚠️ REGRESSION GUARD, and it earned its place: the first version of the splitter joined the
  // extra fields back with a space, the parser stripped that space, and this row went through as
  // 1.23456 — the comma-decimal bug arriving through the splitter instead of the parser. Two
  // spellings of the same refusal, so a fix in one place can't quietly reopen the other.
  ok("⚠️ a comma used as BOTH separator and decimal is refused, never read as 1.23456",
     r.invalid.some((v) => /1\.234,56/.test(v.line) && /too many values/.test(v.reason)) &&
     !r.rows.some((x) => x.amount === "1.23456"), JSON.stringify(r.invalid));
  ok("a bare space inside an amount is refused too (the other spelling of the same trap)",
     !P.parseAmount("1.234 56").ok, JSON.stringify(P.parseAmount("1.234 56")));
  ok("a header row is skipped without being called an error", !r.invalid.some((v) => /^wallet,amount/.test(v.line)), JSON.stringify(r.invalid));
  ok("the total is the sum of what will actually be sent", r.total === "17.75", r.total);
}
{
  // Either column order — a holder export puts the address first, a payout sheet often doesn't.
  const r = P.parseRecipients({ mode: "perWallet", text: `10,${A}\n${B},20` });
  ok("address-last rows parse the same as address-first", r.rows.length === 2 && r.rows[0].amount === "10" && r.rows[1].amount === "20", JSON.stringify(r.rows));
}
{
  const r = P.parseRecipients({ mode: "equal", text: `${A}\n${B}\n${A}\nnope`, equalAmount: "7.5" });
  ok("equal mode gives everyone the same amount", r.rows.length === 2 && r.rows.every((x) => x.amount === "7.5"), JSON.stringify(r.rows));
  // ⚠️ THE MODES MERGE DIFFERENTLY ON PURPOSE. "address,amount" rows are line items, so a repeat
  // sums (§4 above). "Give everyone 7.5" listed twice still means 7.5 — summing there would
  // double someone's share because their address got pasted twice, which nobody decided. The
  // repeat is still REPORTED either way.
  ok("⚠️ equal mode does NOT double a repeated address — it still gets 7.5",
     r.rows.every((x) => x.amount === "7.5"), JSON.stringify(r.rows));
  ok("...but the repeat is still reported, not swallowed", r.merged.length === 1 && r.merged[0].times === 2, JSON.stringify(r.merged));
  ok("equal mode rejects a bad line", r.invalid.length === 1);
  ok("equal mode's total is 2 x 7.5, not 3 x 7.5", r.total === "15", r.total);
}
ok("equal mode with no amount is an error, not an empty send",
   !!P.parseRecipients({ mode: "equal", text: A, equalAmount: "" }).error);
ok("equal mode with an ambiguous amount is an error",
   !!P.parseRecipients({ mode: "equal", text: A, equalAmount: "1,5" }).error);
{
  const r = P.parseRecipients({ mode: "perWallet", text: `${A},10\n${B},1`, minAmount: "5" });
  ok("the minimum filter holds a row back rather than dropping it silently",
     r.rows.length === 1 && r.skipped.length === 1 && r.skipped[0].addr === B, JSON.stringify(r));
  ok("a skipped row is NOT in the total", r.total === "10", r.total);
}
ok("nothing parseable gives empty lists, never a fabricated row",
   (() => { const r = P.parseRecipients({ mode: "perWallet", text: "just some words\nand more" });
            return r.rows.length === 0 && r.invalid.length === 2 && r.total === "0"; })());

console.log("\n5. cost — the same batching the engine will actually use\n");
{
  // airdrop-engine.js planBatches: a recipient needing a new token account weighs 2, everyone
  // else 1, budget 16. If these two ever disagree, the operator is shown a transaction count
  // and a fee that are not the ones they will be asked to approve.
  const rows16 = Array.from({ length: 16 }, () => ({ addr: A, amount: "1" }));
  ok("16 plain transfers are one transaction", P.estimateCost({ rows: rows16 }).txCount === 1);
  ok("17 plain transfers are two", P.estimateCost({ rows: rows16.concat([{ addr: A, amount: "1" }]) }).txCount === 2);
  const rowsAta = Array.from({ length: 8 }, () => ({ addr: A, amount: "1", needsAta: true }));
  ok("8 recipients needing an account are one transaction (weight 2 each)", P.estimateCost({ rows: rowsAta }).txCount === 1);
  ok("9 of them are two", P.estimateCost({ rows: rowsAta.concat([{ addr: A, amount: "1", needsAta: true }]) }).txCount === 2);
  ok("native SOL never counts an account rent, whatever the rows say",
     P.estimateCost({ rows: rowsAta, native: true, lamportsPerAta: 2039280 }).rentLamports === 0);
  const c = P.estimateCost({ rows: rowsAta, lamportsPerAta: 2039280, lamportsPerTxFee: 5000 });
  ok("rent is counted per NEW account, fees per transaction",
     c.newAtas === 8 && c.rentLamports === 8 * 2039280 && c.feeLamports === 5000 && c.totalLamports === 8 * 2039280 + 5000, JSON.stringify(c));
  // ⚠️ The rent figure is the caller's LIVE chain read. Agave 4.2 lowers rent across five feature
  // gates from 2026-09-10, so a constant frozen in here would drift — and it drifts UP, telling a
  // sender they cannot afford something they can.
  ok("no rent constant is baked in — an unsupplied rent is zero, not a guess",
     P.estimateCost({ rows: rowsAta }).rentLamports === 0);
}
{
  // "Can they afford it" has THREE answers, and "we could not read the balance" is not "yes".
  const rows = [{ addr: A, amount: "1" }];
  ok("a balance that covers it says so", P.estimateCost({ rows, solBalanceLamports: 1e9 }).affordable === true);
  ok("a balance that does not says so", P.estimateCost({ rows, solBalanceLamports: 1 }).affordable === false);
  ok("⚠️ an unreadable balance is null — never an optimistic true",
     P.estimateCost({ rows }).affordable === null && P.estimateCost({ rows, solBalanceLamports: null }).affordable === null);
}

console.log("\n" + (failures ? failures + " FAILED" : "all passed") + "\n");
process.exit(failures ? 1 : 0);
