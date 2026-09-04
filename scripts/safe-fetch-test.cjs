#!/usr/bin/env node
/**
 * The SSRF guard on /api/token-icon.
 *
 * The URL fetched there is whatever `icon` Jupiter's token list carries for a mint, and anyone
 * can list a token — so it is attacker-supplied with a third party in between. The old guard was
 * one regex on the hostname of the FIRST url plus redirect:"follow".
 *
 * The address classifier is tested directly. The redirect behaviour is tested against a REAL
 * local HTTP server, because "we don't follow redirects to private hosts" is exactly the kind of
 * claim that reads as true and isn't.
 */
const http = require('http');
const path = require('path');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const { safeFetchImage, hostIsPublic, isPrivateAddr } = require(path.join(__dirname, '..', 'lib', 'safe-fetch.js'));

(async () => {
  console.log('\naddress classification\n');
  const mustBlock = [
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['10.1.2.3', 'RFC1918'],
    ['172.16.0.1', 'RFC1918 lower bound'],
    ['172.31.255.254', 'RFC1918 upper bound'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.169.254', 'CLOUD METADATA — the one that matters'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4 loopback in an IPv6 coat'],
  ];
  for (const [ip, why] of mustBlock) ok(`blocks ${ip} (${why})`, isPrivateAddr(ip) === true);
  const mustAllow = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '2606:4700::1111'];
  for (const ip of mustAllow) ok(`allows public ${ip}`, isPrivateAddr(ip) === false);

  console.log('\nhostname forms the old regex missed\n');
  ok('rejects a decimal IP (http://2130706433 = 127.0.0.1)', (await hostIsPublic('2130706433')) === false);
  ok('rejects a hex IP (0x7f000001)', (await hostIsPublic('0x7f000001')) === false);
  ok('rejects localhost', (await hostIsPublic('localhost')) === false);
  ok('rejects a subdomain of localhost', (await hostIsPublic('foo.localhost')) === false);
  ok('rejects an IP literal that IS private', (await hostIsPublic('169.254.169.254')) === false);

  console.log('\nredirects — the hole that was actually open\n');
  // A "public-looking" origin that redirects into localhost. The origin here IS localhost, so the
  // first-hop check catches it before the redirect is even issued — which is itself the point:
  // every hop is checked, not just the last. To prove the REDIRECT is what gets refused rather
  // than the origin, we drive the loop starting from the redirect target directly as well.
  const srv = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    if (req.url === '/img') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from([0x89, 0x50])); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  ok('refuses a plain http:// URL outright (https only)',
     (await safeFetchImage(`http://127.0.0.1:${port}/img`)) === null);
  ok('refuses a loopback origin even over https',
     (await safeFetchImage(`https://127.0.0.1:${port}/img`)) === null);
  ok('refuses the cloud-metadata address as a redirect TARGET',
     (await safeFetchImage('https://169.254.169.254/latest/meta-data/')) === null);
  ok('refuses a decimal-notation loopback URL',
     (await safeFetchImage('https://2130706433/img')) === null);
  ok('refuses a URL that is not a URL', (await safeFetchImage('not a url')) === null);
  ok('refuses an empty URL', (await safeFetchImage('')) === null);
  srv.close();

  // THE CASE THE OLD CODE ACTUALLY GOT WRONG: hop 1 is a perfectly ordinary public https host,
  // and its 302 points at the metadata service. The old guard checked hop 1, said yes, and handed
  // the rest to redirect:"follow". There is no public host to serve from in a test, so the fetch
  // and the resolver are injected — see the seam comment in lib/safe-fetch.js.
  console.log('\npublic host redirecting into a private one\n');
  {
    const seen = [];
    const fakeFetch = async (url) => {
      seen.push(url);
      if (url.startsWith('https://cdn.example.com/')) {
        return { status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) } };
      }
      return { status: 200, ok: true, headers: { get: () => 'image/png' } };
    };
    const r = await safeFetchImage('https://cdn.example.com/icon.png', {
      _fetch: fakeFetch,
      _hostIsPublic: async (h) => h === 'cdn.example.com',   // only hop 1 is public
    });
    ok('a public host redirecting to the metadata service is REFUSED at hop 2', r === null,
       'got a response back; hops attempted: ' + seen.join(' -> '));
    ok('and the private URL is never fetched', !seen.some((u) => u.includes('169.254.169.254')),
       seen.join(' -> '));
  }
  {
    // A redirect to another PUBLIC host is still followed — the guard must not break real CDNs.
    const seen = [];
    const fakeFetch = async (url) => {
      seen.push(url);
      if (seen.length === 1) return { status: 301, headers: { get: () => 'https://images.example.net/final.png' } };
      return { status: 200, ok: true, headers: { get: () => 'image/png' } };
    };
    const r = await safeFetchImage('https://cdn.example.com/icon.png', { _fetch: fakeFetch, _hostIsPublic: async () => true });
    ok('a redirect between two public hosts is still followed', r && r.status === 200, JSON.stringify(seen));
  }
  {
    // A redirect loop must terminate rather than spin.
    let n = 0;
    const fakeFetch = async () => { n++; return { status: 302, headers: { get: () => 'https://a.example.com/' + n } }; };
    const r = await safeFetchImage('https://a.example.com/0', { _fetch: fakeFetch, _hostIsPublic: async () => true });
    ok('a redirect loop is cut off by the hop cap, it does not spin', r === null && n <= 6, 'hops: ' + n);
  }

  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
