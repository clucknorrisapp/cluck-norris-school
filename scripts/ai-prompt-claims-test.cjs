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

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} FAILING\n`);
process.exit(failures === 0 ? 0 : 1);
