"use strict";
// Server-side fetches of URLs a stranger can influence.
//
// The token tools read a token's metadata JSON, and the URL comes either from the chain or from
// the caller (a working gateway, when the one on-chain is throttled). Either way it is not ours,
// and a server fetching an arbitrary URL is a door into whatever the server can reach that the
// internet cannot: the Railway private network, cloud metadata at 169.254.169.254, localhost.
//
// Two things make this harder than a hostname blocklist:
//   1. DNS. "evil.example.com" is a public name that can resolve to 127.0.0.1. So the ADDRESSES
//      have to be checked, not the name — and every address it resolves to, not just the first.
//   2. Redirects. A public URL that 302s to http://169.254.169.254/ passes a check done only on
//      the original URL. So redirects are followed MANUALLY, re-validating every hop.
//
// There is a residual DNS-rebinding window between the lookup and the connection. Closing it
// needs a custom agent that pins the resolved address; that is worth doing if this ever fetches
// something sensitive, but the payload here is a public token's metadata and the practical
// exposure is a blind request, so the cost/benefit doesn't justify it yet.

const dns = require("dns").promises;
const net = require("net");

const MAX_REDIRECTS = 4;

// v4 ranges that must never be reachable, as [firstOctet, test] pairs kept explicit rather than
// clever — a CIDR one-liner here would be harder to audit than the list it replaces.
function isPrivateV4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;  // unparseable → refuse
  const [a, b] = p;
  if (a === 0) return true;                        // "this network"
  if (a === 10) return true;                       // RFC1918
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true;         // RFC1918
  if (a === 192 && b === 0) return true;           // IETF protocol assignments (incl. 192.0.0.0/24)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                       // multicast + reserved + broadcast
  return false;
}

function isPrivateV6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;                 // unspecified, loopback
  if (s.startsWith("fe80") || s.startsWith("fec0")) return true; // link-local, site-local
  if (/^f[cd]/.test(s)) return true;                          // unique-local fc00::/7
  if (s.startsWith("ff")) return true;                        // multicast
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms carry a v4 address inside.
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) return isPrivateV4(v4[1]);
  return false;
}

function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;   // not an IP at all → refuse rather than guess
}

// Names that never belong to the public internet, whatever DNS happens to say today.
function isBlockedHostname(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (h.endsWith(".localdomain")) return true;
  return false;
}

async function assertPublicHttpsUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { throw new Error("not a valid URL"); }
  // https only. Plain http would also expose the fetch to network-level tampering, and every
  // gateway worth reading serves https.
  if (u.protocol !== "https:") throw new Error(`refusing a non-https URL (${u.protocol}//…)`);
  if (u.username || u.password) throw new Error("refusing a URL with embedded credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) throw new Error(`refusing a non-public hostname (${host})`);

  // An IP literal skips DNS entirely — check it directly.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`refusing a private address (${host})`);
    return u;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: true }); }
  catch (_) { throw new Error(`could not resolve ${host}`); }
  if (!addrs.length) throw new Error(`${host} resolved to nothing`);
  // EVERY address, not just the first: a name that resolves to one public and one private address
  // would otherwise pass and then connect to whichever the stack picks.
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error(`${host} resolves to a private address (${a.address})`);
  }
  return u;
}

// fetch() with the guard applied to the original URL and to every redirect hop.
async function safeFetch(rawUrl, opts = {}) {
  let url = String(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpsUrl(url);
    const r = await fetch(url, { ...opts, redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return r;                       // a redirect with nowhere to go — hand it back as-is
      url = new URL(loc, url).toString();       // relative Location is legal
      continue;
    }
    return r;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

module.exports = { assertPublicHttpsUrl, safeFetch, isPrivateAddress, isBlockedHostname, MAX_REDIRECTS };
