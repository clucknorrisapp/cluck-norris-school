"use strict";
// Tests for lib/safe-fetch.js — the guard that stands between a stranger-supplied URL and our
// server's network position. Every case here is an attack that works against a naive check.
//
// No dependencies and no outbound network: the address checks are pure, the DNS cases use names
// that resolve locally or not at all, and the redirect chain runs against a stubbed global fetch.
// That matters because this has to pass in the node-check CI job, which installs nothing.

const assert = require("assert");
const sf = require("../lib/safe-fetch");

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r && typeof r.then === "function") return r.then(
    () => { console.log("  ✓", name); pass++; },
    (e) => { console.log("  ✗", name, "\n     ", e.message); fail++; });
    console.log("  ✓", name); pass++;
  } catch (e) { console.log("  ✗", name, "\n     ", e.message); fail++; }
}
async function rejects(fn, re, why) {
  let threw = null;
  try { await fn(); } catch (e) { threw = e; }
  assert.ok(threw, `expected a rejection: ${why}`);
  if (re) assert.ok(re.test(threw.message), `wrong reason: ${threw.message}`);
}

(async () => {
console.log("\nprivate address detection");
await t("loopback v4", () => assert.strictEqual(sf.isPrivateAddress("127.0.0.1"), true));
await t("loopback, non-obvious octet", () => assert.strictEqual(sf.isPrivateAddress("127.99.12.3"), true));
await t("cloud metadata 169.254.169.254", () => assert.strictEqual(sf.isPrivateAddress("169.254.169.254"), true));
await t("RFC1918 10/8", () => assert.strictEqual(sf.isPrivateAddress("10.4.5.6"), true));
await t("RFC1918 172.16/12 lower edge", () => assert.strictEqual(sf.isPrivateAddress("172.16.0.1"), true));
await t("RFC1918 172.31/12 upper edge", () => assert.strictEqual(sf.isPrivateAddress("172.31.255.254"), true));
await t("172.15 is PUBLIC (just outside the range)", () => assert.strictEqual(sf.isPrivateAddress("172.15.0.1"), false));
await t("172.32 is PUBLIC (just outside the range)", () => assert.strictEqual(sf.isPrivateAddress("172.32.0.1"), false));
await t("RFC1918 192.168/16", () => assert.strictEqual(sf.isPrivateAddress("192.168.1.1"), true));
await t("CGNAT 100.64/10", () => assert.strictEqual(sf.isPrivateAddress("100.64.0.1"), true));
await t("100.63 is PUBLIC", () => assert.strictEqual(sf.isPrivateAddress("100.63.255.255"), false));
await t("0.0.0.0", () => assert.strictEqual(sf.isPrivateAddress("0.0.0.0"), true));
await t("multicast 224/4", () => assert.strictEqual(sf.isPrivateAddress("224.0.0.1"), true));
await t("broadcast 255.255.255.255", () => assert.strictEqual(sf.isPrivateAddress("255.255.255.255"), true));
await t("a real public address passes", () => assert.strictEqual(sf.isPrivateAddress("8.8.8.8"), false));
await t("garbage is refused, not guessed", () => assert.strictEqual(sf.isPrivateAddress("not-an-ip"), true));

console.log("\nIPv6 — the forms a v4-only check misses");
await t("::1 loopback", () => assert.strictEqual(sf.isPrivateAddress("::1"), true));
await t("unique-local fc00::/7", () => assert.strictEqual(sf.isPrivateAddress("fd12:3456::1"), true));
await t("link-local fe80::", () => assert.strictEqual(sf.isPrivateAddress("fe80::1"), true));
await t("v4-MAPPED loopback ::ffff:127.0.0.1", () => assert.strictEqual(sf.isPrivateAddress("::ffff:127.0.0.1"), true));
await t("v4-mapped metadata ::ffff:169.254.169.254", () => assert.strictEqual(sf.isPrivateAddress("::ffff:169.254.169.254"), true));
await t("a public v6 passes", () => assert.strictEqual(sf.isPrivateAddress("2606:4700::1111"), false));

console.log("\nhostnames that are never public");
await t("localhost", () => assert.strictEqual(sf.isBlockedHostname("localhost"), true));
await t("sub.localhost", () => assert.strictEqual(sf.isBlockedHostname("api.localhost"), true));
await t("*.internal", () => assert.strictEqual(sf.isBlockedHostname("db.internal"), true));
await t("*.local", () => assert.strictEqual(sf.isBlockedHostname("printer.local"), true));
await t("trailing dot doesn't evade", () => assert.strictEqual(sf.isBlockedHostname("localhost."), true));
await t("case doesn't evade", () => assert.strictEqual(sf.isBlockedHostname("LocalHost"), true));
await t("a normal host is allowed", () => assert.strictEqual(sf.isBlockedHostname("arweave.net"), false));

console.log("\nURL gate");
await t("http:// is refused", () => rejects(() => sf.assertPublicHttpsUrl("http://example.com/x"), /non-https/, "plain http"));
await t("file:// is refused", () => rejects(() => sf.assertPublicHttpsUrl("file:///etc/passwd"), /non-https/, "file scheme"));
await t("embedded credentials refused", () => rejects(() => sf.assertPublicHttpsUrl("https://u:p@example.com/"), /credentials/, "user:pass@"));
await t("nonsense refused", () => rejects(() => sf.assertPublicHttpsUrl("://///"), /valid URL/, "unparseable"));
await t("https://127.0.0.1 refused", () => rejects(() => sf.assertPublicHttpsUrl("https://127.0.0.1/x"), /private address/, "IP literal"));
await t("https://169.254.169.254 refused", () => rejects(() => sf.assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/"), /private address/, "metadata"));
await t("bracketed v6 loopback refused", () => rejects(() => sf.assertPublicHttpsUrl("https://[::1]/x"), /private address/, "[::1]"));
await t("https://localhost refused", () => rejects(() => sf.assertPublicHttpsUrl("https://localhost/x"), /non-public hostname/, "localhost"));
await t("a name that RESOLVES to loopback is refused", () =>
  // localhost resolves without any network, which is what makes this testable offline. The point
  // it proves is that resolution is consulted at all — a name-only blocklist is not enough.
  rejects(() => sf.assertPublicHttpsUrl("https://localhost.localdomain/x"), /non-public|private|resolve/, "resolves private"));
await t("an unresolvable name is refused, not allowed", () =>
  rejects(() => sf.assertPublicHttpsUrl("https://nx-" + Date.now() + "-invalid.invalid/x"), /could not resolve/, "NXDOMAIN"));

console.log("\nredirects — the standard way past a one-shot check");
const realFetch = globalThis.fetch;
function stubFetch(plan) {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const step = plan[seen.length - 1];
    if (!step) throw new Error("stub ran out of plan at " + url);
    if (step.location) return { status: step.status || 302, headers: { get: (k) => (k.toLowerCase() === "location" ? step.location : null) } };
    return { status: step.status || 200, ok: true, headers: { get: () => null }, body: step.body || "ok" };
  };
  return seen;
}
try {
  await t("a public → private redirect is REFUSED at the hop", async () => {
    const seen = stubFetch([{ location: "https://169.254.169.254/latest/" }]);
    await rejects(() => sf.safeFetch("https://arweave.net/thing"), /private address/, "302 to metadata");
    assert.strictEqual(seen.length, 1, "must not have fetched the private hop");
  });
  await t("a public → public redirect is followed", async () => {
    const seen = stubFetch([{ location: "https://dweb.link/ipfs/x" }, { status: 200 }]);
    const r = await sf.safeFetch("https://arweave.net/thing");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(seen, ["https://arweave.net/thing", "https://dweb.link/ipfs/x"]);
  });
  await t("a relative Location resolves against the current URL", async () => {
    const seen = stubFetch([{ location: "/moved" }, { status: 200 }]);
    await sf.safeFetch("https://arweave.net/thing");
    assert.strictEqual(seen[1], "https://arweave.net/moved");
  });
  await t("a redirect LOOP terminates instead of hanging", async () => {
    const plan = []; for (let i = 0; i < 20; i++) plan.push({ location: "https://arweave.net/loop" + i });
    stubFetch(plan);
    await rejects(() => sf.safeFetch("https://arweave.net/loop"), /too many redirects/, "infinite loop");
  });
  await t("redirect count is bounded to MAX_REDIRECTS hops", async () => {
    const plan = []; for (let i = 0; i < sf.MAX_REDIRECTS; i++) plan.push({ location: "https://arweave.net/h" + i });
    plan.push({ status: 200 });
    const seen = stubFetch(plan);
    const r = await sf.safeFetch("https://arweave.net/start");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(seen.length, sf.MAX_REDIRECTS + 1);
  });
  await t("a redirect with no Location is handed back, not followed blindly", async () => {
    stubFetch([{ status: 302 }]);
    const r = await sf.safeFetch("https://arweave.net/thing");
    assert.strictEqual(r.status, 302);
  });
} finally { globalThis.fetch = realFetch; }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
