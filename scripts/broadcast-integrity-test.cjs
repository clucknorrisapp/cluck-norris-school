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

// Treasury daily recap (Codex on #333): the send result decides whether the `prev` snapshot moves.
// Positive shape assertion — `landed` is checked BEFORE the store write, inside sendTreasuryRecap.
{
  const start = server.indexOf('async function sendTreasuryRecap(');
  const end = server.indexOf('\n}\n', start);
  const fn = start >= 0 ? server.slice(start, end) : '';
  const iLanded = fn.indexOf('const landed = await tgApi("sendMessage"');
  const iGuard = fn.indexOf('if (!landed)');
  const iWrite = fn.indexOf('kv.set(storeKey, { baseline, prev: snap');
  ok('treasury recap: the Telegram result is captured', iLanded >= 0);
  ok('treasury recap: a failed send returns before the snapshot write', iGuard > iLanded && iWrite > iGuard, `landed@${iLanded} guard@${iGuard} write@${iWrite}`);
  ok('treasury recap: sent:true is only ever returned after the write', /sent: true, text, valueBtc, valueUsd/.test(fn) && !/sent: !!tgtok/.test(fn));
}

// Hub alert dedupe (N-1, Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): hubAlert used to write
// its 6-hour dedupe watermark BEFORE calling cunaOpsAlert/tgSend, so a swallowed send (tgSend
// returns null on failure — the exact pattern this file exists to catch) ate the next 6 hours of
// fraud-refusal alerts for that key. It also deduped on a 40-char slice of free text, which could
// collapse two different batches together once the project id ran past ~19 characters — see
// scripts/hub-settle-route-test.cjs section 34 for the executable half of that fix
// (lib/hub/alert-key.js). This is the source-shape half: hubAlert's own watermark timing.
{
  const start = server.indexOf('const hubAlert = (m, meta) => {');
  const end = start >= 0 ? server.indexOf('\n};', start) : -1;
  const fn = start >= 0 && end > start ? server.slice(start, end) : '';
  ok('hubAlert exists with the (message, meta) signature', start >= 0, 'const hubAlert = (m, meta) => { not found');
  const iSend = fn.indexOf('await cunaOpsAlert(');
  const iSet = fn.indexOf('HUB_ALERT_SEEN.set(key, now)');
  ok('hubAlert captures the send result before touching its watermark', iSend >= 0 && iSet > iSend, `send@${iSend} set@${iSet}`);
  ok('the watermark is set only when the send returned something (never unconditionally)',
     /if \(sent\) HUB_ALERT_SEEN\.set\(key, now\);/.test(fn), 'no `if (sent) HUB_ALERT_SEEN.set(...)` guard found');
  ok('hubAlert never writes HUB_ALERT_SEEN outside that guarded line', (fn.match(/HUB_ALERT_SEEN\.set\(/g) || []).length === 1);
  // Bypasses cunaOpsAlert's OWN dedupe (dedupeKey=null) rather than moving CUNA_ALERT_SEEN's
  // watermark timing for every other caller (accrual/burn/watchdog/kv-load alerts).
  ok('hubAlert bypasses cunaOpsAlert\'s own dedupe key rather than reusing/altering it',
     /await cunaOpsAlert\(`⚠️ Hub: \$\{m\}`, null\)/.test(fn), 'cunaOpsAlert is not called with dedupeKey=null');
  ok('cunaOpsAlert itself (the CUNA scheduler\'s shared dedupe) is untouched by this fix',
     /const last = CUNA_ALERT_SEEN\.get\(dedupeKey\) \|\| 0;\s*\n\s*if \(now - last < 6 \* 60 \* 60 \* 1000\) return null;\s*\n\s*CUNA_ALERT_SEEN\.set\(dedupeKey, now\);/.test(server),
     'cunaOpsAlert\'s check-then-set-before-send shape changed — that was deliberately left alone for every non-Hub caller');
}

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
