#!/usr/bin/env node
/**
 * ai-prompt-claims-test.cjs — the AI must not tell people things the product does not do.
 *
 * WHY THIS EXISTS. Ask Cluck's system prompt is copy, and copy drifts. It is also the copy with
 * the widest reach and the least review: it answers in seven languages, on the website, in the
 * Play app and in the iOS app, and nobody proof-reads it because it is buried in server.js.
 *
 * On 2026-09-21 an owner review caught Firepit claiming a value guard "stops you" burning
 * anything worth money. Checking the same class found it in the tool catalog (Launches "read
 * straight off the chain" when it is an API; X-Ray claiming "behavioral signals ... straight off
 * the chain") and then AGAIN here, where it was worst:
 *
 *   - the prompt listed Wallet X-Ray, Holders and Trace under "FREE TOOLS (all read-only, no
 *     wallet connect)". They moved behind the unified tools pass on 2026-08-18 and need a
 *     connected wallet. The SAME prompt described the pass correctly further down, so the model
 *     held two contradictory statements about money and the wrong one came first.
 *   - it said X-Ray shows "every trade". AGENTS.md states plainly that the x-ray is an activity
 *     scanner that undercounts and misses holdings, and that two wrong balance reports came from
 *     trusting it.
 *
 * That is the "check every form, not one form" trap in CLAUDE.md, found on its fourth surface.
 * This test is the form-checker: it reads the live prompt out of server.js and fails on the
 * claims we know are false, so the next edit cannot quietly reintroduce them.
 *
 *   node scripts/ai-prompt-claims-test.cjs
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// The Ask Cluck system prompt, by its own opening line. Anchoring on the text rather than a line
// number so the test survives server.js moving around (it is ~11k lines and moves constantly).
const START = "You are Cluck Norris -- the toughest crypto professor";
const startAt = src.indexOf(START);
if (startAt < 0) {
  console.error("FAIL: could not find the Ask Cluck system prompt in server.js.\n" +
                "If it was renamed or moved, update START here — do not delete this test.");
  process.exit(1);
}
// Up to the end of that template literal.
const endAt = src.indexOf("`;", startAt);
const prompt = src.slice(startAt, endAt > 0 ? endAt : startAt + 20000);

let failures = 0;
function refuse(name, re, why) {
  const hit = re.exec(prompt);
  const ok = !hit;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      found: ${JSON.stringify(hit[0].slice(0, 120))}\n      why:   ${why}`);
}
function require_(name, re, why) {
  const ok = re.test(prompt);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`      why: ${why}`);
}

console.log("\nAsk Cluck system prompt — claims the code must support\n");

refuse(
  "does NOT advertise the heavy tools as free with no wallet",
  /FREE TOOLS \(all read-only, no wallet connect\)/i,
  "X-Ray, Holders and Trace need a connected wallet and the tools pass since 2026-08-18."
);

refuse(
  "does NOT claim X-Ray shows every trade",
  /every trade/i,
  "The x-ray is an activity scanner; AGENTS.md records two wrong balance reports from trusting it."
);

refuse(
  "does NOT call a token safe, verified or a rug",
  /\b(this token is safe|guaranteed safe|verified safe)\b/i,
  "Say what's on-chain, never why — and never a safety verdict."
);

// Positive assertions. A negative-only test passes against a prompt that says nothing at all,
// which is exactly how the original err-before-status assertion went green while being wrong.
require_(
  "states that the heavy tools need a connected wallet",
  /HEAVY TOOLS[\s\S]{0,200}CONNECTED WALLET/i,
  "The correction must actually be present, not merely the wrong claim absent."
);

require_(
  "tells the model the scanners can miss things",
  /ACTIVITY SCANNERS?[\s\S]{0,300}(miss|do not see everything)/i,
  "The honest limit has to be stated, or the model will infer completeness."
);

require_(
  "keeps the what-not-why rule",
  /never\s+WHY|what happened, never why|shows WHAT happened, never WHY/i,
  "The brand's core forensic rule belongs in the prompt that answers most questions."
);

// Never hardcode the pass amounts — same rule as every other surface.
refuse(
  "does NOT hardcode a CLKN token amount for the tools pass",
  /hold\s+[\d,]{4,}\s*CLKN/i,
  "The threshold is live-priced from /api/tool-gate/config; a fixed figure goes stale."
);


// ── The DAILY BRIEF — both the prompt and the path the prompt cannot protect ──────────────────
//
// cluckBrief() builds a data summary (alphaDataSummary) and asks the model to write from it. If
// the AI call fails, or there is no API key, it returns the RAW SUMMARY to the reader instead —
// the brand's daily post, verbatim, with no model in between. So an instruction in the prompt
// ("never call anything a yield") protects only the happy path; the summary itself has to be
// clean. Codex reproduced the fallback carrying "%/day fee yield" on PR #390 with a simulated
// request failure. The same review caught the relabel calling a SEVEN-DAY average "last 24h".
// The fix is that no fee-ratio figure reaches the summary at all; this pins that on both paths.
{
  const fnStart = src.indexOf("function alphaDataSummary(");
  // `async function` — a bare "function cluckBrief(" anchor sliced nothing and the first run
  // reported the fallback clean on an empty string. Anchor on the real declaration.
  const fnEnd = src.indexOf("\nasync function cluckBrief(", fnStart);
  const cbEnd = src.indexOf("\nlet _alphaInFlight", fnEnd);
  const summaryFn = fnStart > 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : "";
  const briefFn = fnEnd > 0 && cbEnd > fnEnd ? src.slice(fnEnd, cbEnd) : "";
  // Only the STRINGS the code emits — comments explain history and are allowed to name the words.
  const strip = (x) => x.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const emittedSummary = strip(summaryFn);   // what the FALLBACK publishes verbatim
  const emittedBrief = strip(briefFn);       // the prompt + the fallback wrappers
  // ⚠️ The prompt's PROHIBITION names the words ("NEVER call a pool blue-chip … never present
  // any pool as a pick"). A bare word-refusal on the prompt fails on the sentence that forbids
  // the thing — the first run of this did exactly that. So the summary is held to the bare words
  // and the prompt only to AFFIRMATIVE constructions.
  function refuseIn(name, re, why, scope) {
    const hit = re.exec(scope || emittedSummary);
    const ok = !hit;
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) console.log(`      found: ${JSON.stringify(hit[0].slice(0, 120))}\n      why:   ${why}`);
  }
  console.log("\n  daily brief — the data summary the FALLBACK path publishes verbatim:");
  const found = summaryFn.length > 200 && briefFn.length > 200;
  if (!found) failures++;
  console.log(`  ${found ? "✓" : "✗"} alphaDataSummary() and cluckBrief() were both located in server.js`);
  refuseIn("the summary carries NO per-day fee ratio (\"%/day\")", /%\/day/i,
           "a fee ratio printed beside a pool is a yield claim the fallback path publishes with no model to soften it");
  refuseIn("the summary never says \"yield\" (the prompt's prohibition cannot reach the fallback)", /\byield/i,
           "AGENTS.md: never a yield figure we do not pay");
  refuseIn("the summary never says \"blue-chip\"", /blue[- ]?chip/i,
           "a safety verdict on tokens, forbidden outright");
  refuseIn("the summary has no \"picks\" line — a scanner ranking presented as picks is a recommendation", /\bpicks?\b/i,
           "say what's on-chain, never why");
  refuseIn("the prompt never ASKS for blue-chip anything (\"our blue-chip\", \"blue-chip LP\")", /(our|the|any) blue[- ]?chip|blue[- ]?chip (lp|pool|pick|yield)/i,
           "the prohibition may name the word; an instruction to produce it may not", emittedBrief);
  refuseIn("the prompt never ASKS for picks (\"yield picks\", \"our picks\", \"LP picks\")", /(yield|our|lp|top) picks?\b/i,
           "same — forbid, never request", emittedBrief);
  refuseIn("the prompt never carries a per-day figure", /%\/day/i, "a yield claim in the model's own instructions", emittedBrief);
  refuseIn("no \"last 24h\" label on a figure that is a seven-day average", /last 24h fees/i,
           "feeYield7dPctDay is a 7-day average volume figure; the first relabel got the period wrong (Codex)");
  const promptOk = /never quote, estimate or imply a yield, a return, an APR/.test(briefFn);
  if (!promptOk) failures++;
  console.log(`  ${promptOk ? "✓" : "✗"} the brief's prompt forbids quoting or implying a yield, return or APR`);
}

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} FAILING\n`);
process.exit(failures === 0 ? 0 : 1);
