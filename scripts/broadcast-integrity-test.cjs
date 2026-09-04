#!/usr/bin/env node
/**
 * Two ways the brand channels could say something untrue.
 *
 * A) A SEND THAT FAILED, REPORTED AS SENT. tgSend catches its own errors and returns null, so a
 *    Telegram outage is indistinguishable from success at every call site. Three schedulers then
 *    advanced durable state anyway — the worst being the graduate watcher, which marked new
 *    graduates "seen" after a DM that never arrived, so no later tick surfaced them and the
 *    airdrop prompt (gated on the message id) never registered. A learner finished the course and
 *    their airdrop simply never happened.
 *
 * B) AN ANNOUNCEMENT THAT WAS NEVER TRUE. /api/hatchery/minted checked that `signature` resolved
 *    to SOME successful mainnet transaction — never that it created the mint being announced —
 *    while /build is unauthenticated and registers the address before anything is signed.
 *
 * The state-advance rules are pure decisions, so they are asserted directly here rather than by
 * booting a server and breaking Telegram; the hatchery checks are asserted against the shipped
 * source, since exercising them needs a real chain.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const hatchery = fs.readFileSync(path.join(ROOT, 'hatchery.js'), 'utf8');

console.log('\nA. a failed send must not advance durable state\n');

// The rule, extracted exactly as the three call sites now implement it.
const advanceGrad = (chatConfigured, sentId, nNew) => (nNew === 0 || !chatConfigured || !!sentId);
ok('a graduate whose DM failed is NOT marked seen', advanceGrad(true, null, 2) === false);
ok('a graduate whose DM landed IS marked seen', advanceGrad(true, 12345, 2) === true);
ok('a tick with nothing new still advances (no send was attempted)', advanceGrad(true, null, 0) === true);
ok('no operator chat configured still advances (documented deliberate skip)', advanceGrad(false, null, 2) === true);

// Source-level: these are the lines that were wrong. Assert the shape, so a revert is loud.
// A POSITIVE assertion. The first version of this was a negative regex and it passed against the
// UNFIXED code — it proved nothing, which is exactly the failure mode the mutation run exists to
// catch. The guard variable has to be there by name.
ok('the grad watcher guards its watermark on the send result',
   /const gradAdvanceOk = gradNothingNew \|\| !chat \|\| !!sentId;/.test(server) &&
   /if \(gradAdvanceOk\) \{\s*\n\s*kv\.set\("schoolGradSeen"/.test(server),
   'no gradAdvanceOk guard around kv.set("schoolGradSeen")');
ok('and it warns when it defers a graduate', /school-grad\] Telegram DM FAILED/.test(server));
ok('the lock report only moves its baseline when Telegram accepted the message',
   /if \(tgMsgIdLock\) kv\.set\("lockSnapshot"/.test(server));
ok('the lock report says so when the send failed',
   /lock-report\] Telegram send FAILED/.test(server));
ok('the ops report no longer forces ok = true after the fallback send',
   !/await tgSend\(chat, caption, null, \{ silent: true \}\); ok = true;/.test(server));
ok('the ops report only starts its 12h clock on an accepted send',
   /if \(ok\) kv\.set\("opsReportAt"/.test(server));

console.log('\nB. an announcement must be about a mint that exists\n');

const minted = hatchery.slice(hatchery.indexOf('router.post("/minted"'), hatchery.indexOf('router.post("/minted"') + 3500);
ok('/minted requires the signature to reference the announced mint',
   /keys\.includes\(mintAddress\)/.test(minted), 'no account-key check found');
ok('/minted requires the mint to actually exist on-chain as a mint',
   /parsed\.type !== "mint"/.test(minted), 'no mint-account check found');
ok('/minted no longer takes the announced name/symbol from the request body',
   /hatcheryMeta\.get\(mintAddress\)/.test(minted) && !/String\(name \|\| "A new token"\)/.test(minted),
   'body-supplied name/symbol still reaches the announcement');
ok('the built name/symbol are recorded at build time', /hatcheryMeta\.set\(mintAddress/.test(hatchery));
ok('and that map is bounded', /hatcheryMeta\.size > 5000/.test(hatchery));

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
process.exit(failures ? 1 : 0);
