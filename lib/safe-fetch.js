"use strict";
/**
 * Fetching a URL somebody else chose.
 *
 * /api/token-icon fetches whatever `icon` URL Jupiter's token list carries for a mint. Anyone can
 * list a token, so that URL is attacker-supplied in practice — it just takes a detour through a
 * third party first. The guard there was one regex on the hostname of the FIRST url, and
 * `redirect: "follow"`, which is three holes wide:
 *
 *   1. it only tested the first hop. A perfectly ordinary https host answering 302
 *      -> http://169.254.169.254/latest/meta-data/ was followed without a second look;
 *   2. `\d+\.\d+\.\d+\.\d+` misses most ways of writing an IP. http://2130706433/ and
 *      http://127.1/ are both 127.0.0.1 and both sail past it;
 *   3. a plain DNS name that resolves to a private address (localtest.me, or any host the
 *      attacker controls the zone for) was never checked at all.
 *
 * So: resolve every hop, reject any address in a private, loopback, link-local, CGNAT or
 * unique-local range, follow redirects by hand with a hop cap, and require https throughout.
 *
 * HONEST LIMIT: this does not close DNS rebinding. We resolve, approve the addresses, and then
 * hand the URL to fetch(), which resolves again — a zone that answers differently between those
 * two lookups can still point the second one at a private address. Closing it properly means
 * pinning the connection to the approved IP, which breaks TLS SNI/cert validation unless you
 * hand-roll the agent. What IS closed is everything above, plus the response guards at the call
 * site (content-type and size), which is what actually turns a fetch into an exfiltration
 * channel. Do not describe this module as rebinding-proof.
 */
const dns = require("dns").promises;
const net = require("net");

// IPv4 ranges that must never be reachable from a URL somebody else picked.
function isPrivateV4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparsable → refuse
  const [a, b] = p;
  if (a === 0) return true;                        // "this network"
  if (a === 10) return true;                       // RFC1918
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true;// RFC1918
  if (a === 192 && b === 168) return true;         // RFC1918
  if (a === 192 && b === 0) return true;           // IETF protocol assignments / 192.0.0.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                       // multicast + reserved + broadcast
  return false;
}

function isPrivateV6(ip) {
  const s = String(ip).toLowerCase().split("%")[0];
  if (s === "::1" || s === "::") return true;                       // loopback / unspecified
  if (/^f[cd]/.test(s)) return true;                                // fc00::/7 unique-local
  if (/^fe[89ab]/.test(s)) return true;                             // fe80::/10 link-local
  if (/^ff/.test(s)) return true;                                   // multicast
  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 coat.
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isPrivateV4(m[1]);
  return false;
}

function isPrivateAddr(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;   // not an address we can reason about → refuse
}

// Every address a hostname resolves to must be public. One private answer refuses the whole host:
// a round-robin that returns a good address and a bad one is not safe, it is intermittently bad.
async function hostIsPublic(hostname) {
  // An IP literal in the URL never reaches DNS — check it directly, in whatever notation.
  // new URL() has already normalised bracketed IPv6 and dotted-quad forms; a bare integer like
  // 2130706433 arrives here as a "hostname" that net.isIP rejects, and the resolve below fails,
  // so it is refused either way. Being explicit is cheaper than relying on that.
  if (net.isIP(hostname)) return !isPrivateAddr(hostname);
  if (/^\d+$/.test(hostname)) return false;                       // decimal IP (http://2130706433/)
  if (/^0[xX]/.test(hostname)) return false;                      // hex IP
  if (!/^[a-z0-9.-]+$/i.test(hostname)) return false;             // no unicode/idn surprises
  if (/(^|\.)localhost$/i.test(hostname)) return false;
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); }
  catch (_) { return false; }
  if (!addrs || !addrs.length) return false;
  return addrs.every((a) => !isPrivateAddr(a.address));
}

/**
 * fetch(), with every redirect hop validated.
 *
 * Returns the Response on success, or null when any hop is refused — callers treat null as
 * "no image", never as an error worth surfacing to a user (it would leak which internal hosts
 * exist, which is the thing we are guarding).
 */
// `_fetch` and `_hostIsPublic` are TEST SEAMS, and exist for one reason: the interesting case is
// a PUBLIC first hop redirecting to a private second hop, and that cannot be staged from a test
// with no public host to serve from. Proving hop 2 is refused matters more than keeping the
// signature clean — the old code checked hop 1 and followed the rest blind, and no test could
// see it. Production never passes them.
async function safeFetchImage(startUrl, { timeoutMs = 9000, maxHops = 4, _fetch, _hostIsPublic } = {}) {
  const doFetch = _fetch || fetch;
  const hostOk = _hostIsPublic || hostIsPublic;
  let url = String(startUrl || "");
  for (let hop = 0; hop <= maxHops; hop++) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (u.protocol !== "https:") return null;                     // https only, on EVERY hop
    if (!(await hostOk(u.hostname))) return null;
    let r;
    // redirect:"manual" is the whole point — following automatically is what let hop 1 be
    // checked and hops 2..n not be.
    try { r = await doFetch(u.toString(), { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" }); }
    catch (_) { return null; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return null;
      try { url = new URL(loc, u).toString(); } catch (_) { return null; }
      continue;
    }
    return r;
  }
  return null;   // too many hops
}

module.exports = { safeFetchImage, hostIsPublic, isPrivateAddr, isPrivateV4, isPrivateV6 };
