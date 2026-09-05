"use strict";
// The staking domain's origin-lockdown exemption, asserted against server.js itself.
//
// staking.cunatoken.com (and its alias lock.cunatoken.com) is pointed straight at Railway, so it
// cannot carry the Cloudflare edge
// header and is exempted from the origin lockdown for its own surfaces. That exemption is the one
// place in the app where a request can skip the WAF, so its allowlist has to be exhaustive and
// anchored. A single loose entry — "^/api/" — would be a hole through the WAF to every money
// endpoint, reachable by anyone who points a DNS record at our origin and sets a Host header.
//
// This reads the real regex out of server.js rather than a copy, so the test cannot drift from
// what actually runs.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const queue = [];
function t(n, f) { queue.push([n, f]); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function allowlist() {
  const m = SRC.match(/const CUNA_STAKE_PATH = new RegExp\(\[([\s\S]*?)\]\.join\("\|"\)\);/);
  assert.ok(m, "CUNA_STAKE_PATH is not where this test expects it in server.js");
  // eslint-disable-next-line no-eval
  return { parts: eval("[" + m[1] + "]"), re: new RegExp(eval("[" + m[1] + "]").join("|")) };
}

t("every staking surface the page needs is allowed", () => {
  const { re } = allowlist();
  for (const p of ["/", "/cuna-staking", "/api/cuna-stake/config", "/api/cuna-stake/wallet",
                   "/api/lock/create-tx", "/api/helius-rpc", "/api/lock/record",
                   "/cluck-util.js", "/cluck-wallet.js", "/fonts/LuckiestGuy.ttf",
                   "/vendor/solana-web3-1.95.8.iife.min.js"]) {
    assert.ok(re.test(p), `${p} is not reachable on the staking host`);
  }
});

t("THE ONE THAT MATTERS: the admin route is NOT reachable through the exemption", () => {
  // /api/cuna-stake/admin is what ARMS the emission. It must never be reachable by a request that
  // skipped the WAF, at any key.
  const { re } = allowlist();
  assert.strictEqual(re.test("/api/cuna-stake/admin"), false);
});

t("no money or ops endpoint leaks through", () => {
  const { re } = allowlist();
  // /api/helius-rpc and /api/lock/record are deliberately ALLOWED (the page needs both) and are
  // asserted above. Everything here must stay out.
  for (const p of ["/api/whirlpool/vault/pause", "/api/whirlpool/vault/config",
                   "/api/lock/claim-tx", "/api/tg-test", "/api/meme-queue",
                   "/api/rose-engine", "/api/claim", "/api/track", "/wallet-xray", "/tools",
                   "/vendor/", "/vendor/anything-else.js",
                   "/api/", "/api/cuna-stake/", "/admin"]) {
    assert.strictEqual(re.test(p), false, `${p} is reachable on the staking host`);
  }
});

t("every entry is anchored at BOTH ends — a prefix would be the hole", () => {
  const { parts } = allowlist();
  for (const p of parts) {
    assert.ok(p.startsWith("^"), `${p} is not anchored at the start`);
    assert.ok(p.endsWith("$"), `${p} is not anchored at the end — it matches everything beneath it`);
  }
});

t("nothing can be smuggled past an anchored entry", () => {
  const { re } = allowlist();
  for (const p of ["/api/cuna-stake/config/../admin", "/api/cuna-stake/configX",
                   "/x/api/cuna-stake/config", "/api/cuna-stake/config/admin",
                   "/cluck-util.js.map", "/fonts/LuckiestGuy.ttf/../../server.js"]) {
    assert.strictEqual(re.test(p), false, `${p} slipped through`);
  }
});

function stakeHosts() {
  const m = SRC.match(/const CUNA_STAKE_HOSTS = String\(process\.env\.CUNA_STAKE_HOSTS \|\| "([^"]*)"\)/);
  assert.ok(m, "CUNA_STAKE_HOSTS is not where this test expects it in server.js");
  return m[1].split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

t("the default host list carries staking. and the lock. alias, with their www forms", () => {
  const hosts = stakeHosts();
  for (const h of ["staking.cunatoken.com", "www.staking.cunatoken.com",
                   "lock.cunatoken.com", "www.lock.cunatoken.com"]) {
    assert.ok(hosts.includes(h), `${h} is not in the default CUNA_STAKE_HOSTS`);
  }
  assert.strictEqual(new Set(hosts).size, hosts.length, "duplicate host in the default list");
});

t("host matching is exact — an alias is not a suffix rule", () => {
  // isStakeHost compares the whole hostname against the list. If it ever became a suffix or
  // substring test, lock.cunatoken.com.attacker.tld would inherit the WAF exemption.
  const m = SRC.match(/const isStakeHost = \(req\) => ([^;]+);/);
  assert.ok(m, "isStakeHost moved");
  const hosts = stakeHosts();
  // eslint-disable-next-line no-new-func
  const isStakeHost = new Function("CUNA_STAKE_HOSTS", "req", "return " + m[1] + ";")
    .bind(null, hosts);
  assert.strictEqual(isStakeHost({ hostname: "LOCK.CunaToken.com" }), true, "host match is case-sensitive");
  for (const bad of ["lock.cunatoken.com.attacker.tld", "evil-lock.cunatoken.com",
                     "cunatoken.com", "lock.cunatoken.com:8080", ""]) {
    assert.strictEqual(isStakeHost({ hostname: bad }), false, `${bad} was treated as a staking host`);
  }
  assert.strictEqual(isStakeHost({}), false, "a missing hostname was treated as a staking host");
});

t("the staging marking is mounted ABOVE the host routers", () => {
  // The host routers answer "/" with res.sendFile and RETURN. Anything mounted below them never
  // runs for that request, so with the staging block underneath, lock.cunatoken.com/ was served
  // with no banner and no noindex header while /cuna-staking on the same host was marked. This is
  // a pure ordering guarantee — nothing about the middleware itself expresses it — so pin it here.
  const staging = SRC.indexOf("// Staging marking. Mounted before every route");
  const gameRouter = SRC.indexOf("// Host router for the game domain");
  const stakeRouter = SRC.indexOf("// Host router for the CUNA staking domain");
  assert.ok(staging > 0 && gameRouter > 0 && stakeRouter > 0, "one of the three blocks moved");
  assert.ok(staging < gameRouter, "the staging marking sits below the game host router");
  assert.ok(staging < stakeRouter, "the staging marking sits below the staking host router");
});

t("the admin handler refuses anything that skipped the edge, allowlist or not", () => {
  // The second line of defence: if someone later widens the allowlist, this still holds.
  const i = SRC.indexOf('app.all("/api/cuna-stake/admin"');
  assert.ok(i > 0, "the admin route moved");
  const body = SRC.slice(i, i + 900);
  assert.ok(/if \(req\.cluckDirect\) return res\.status\(404\)/.test(body),
    "the admin route lost its req.cluckDirect guard");
  // and it must come BEFORE the key check, so a direct request is refused without touching the key
  assert.ok(body.indexOf("req.cluckDirect") < body.indexOf("adminAuthOK"),
    "the cluckDirect guard must run before the key comparison");
});

t("both exempted hosts mark the request as having skipped the edge", () => {
  // req.cluckDirect is what the admin guard keys on. If an exemption branch forgets to set it,
  // that host silently gets treated as if it came through Cloudflare.
  const m = SRC.match(/if \(isGameHost\(req\)[\s\S]{0,400}?return res\.status\(403\)/);
  assert.ok(m, "the lockdown exemption block moved");
  const block = m[0];
  assert.strictEqual((block.match(/req\.cluckDirect = true/g) || []).length, 2,
    "an exemption branch does not set req.cluckDirect");
});

(async () => {
  for (const [n, f] of queue) {
    try { await f(); console.log("  ✓ " + n); pass++; }
    catch (e) { console.log("  ✗ " + n + "\n      " + e.message); fail++; }
  }
  console.log(`\n${fail === 0 ? "all passed" : fail + " FAILED"} (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
