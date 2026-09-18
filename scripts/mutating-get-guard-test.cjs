#!/usr/bin/env node
"use strict";
// Audit 2026-09-05 #5-#9: admin routes that ARM, RUN, POST, DELETE or reconfigure must refuse to
// do it on a GET (a pasted link that a chat client unfurls must never move funds or post to the
// brand channels), armed vault calls must name their project, every vault response must echo the
// project it resolved, the Meteora pool lever is allowlisted, and the two Telegram test routes
// answer 404 like every other admin route. Boots the real server with a throwaway key and no
// secrets, so nothing here can reach a chain, a wallet, X or Telegram.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.GUARD_TEST_PORT || 3137);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "guard-test-key-" + Math.random().toString(36).slice(2);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, p, withKey = true) {
  const r = await fetch(BASE + p, { method, headers: withKey ? { "x-premium-key": KEY } : {} });
  let body = null; try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, body };
}
// The Normie Quest router takes its admin key as ?key= / x-nq-key, not x-premium-key.
const NQK = "key=" + encodeURIComponent(KEY);
// Raw request: node's fetch SILENTLY DROPS a client-set Host header (it is on the forbidden-header
// list), and the F12 host-derivation assertions have to control Host and X-Forwarded-Host
// independently. Also returns Location without following redirects.
function raw(method, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: headers || {} }, (res) => {
      let data = ""; res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let body = null; try { body = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, location: res.headers.location || "", text: data, body });
      });
    });
    req.on("error", reject); req.end();
  });
}

(async () => {
  // CUNA_ENGINE_ON=1 is deliberately set: since 2026-09-17 (P1-032) an env arm flag must NOT arm
  // anything — the kv key is the only switch and an absent key is OFF. ANTHROPIC_API_KEY is a
  // dummy so the X-Ray chat route reaches its pass check instead of the "AI not configured" 500.
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: DIR, PREMIUM_ACCESS_KEY: KEY, CUNA_ENGINE_ON: "1", ANTHROPIC_API_KEY: "test-not-a-key",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HELIUS_API_KEY: "", MM_OPERATOR_SECRET: "", MM_OPERATOR_SECRET_TREASURY: "",
    FALLBACK_RPC_URL: "http://127.0.0.1:9" };
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env, stdio: "ignore" });
  const done = () => { try { srv.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on("exit", done);
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {} await sleep(500); }
  if (!up) { console.error("  server did not come up"); process.exit(1); }
  console.log("\nAdmin mutation discipline (audit 2026-09-05 #5-#9)\n");

  // ── #7 vault: armed GET → 405; armed POST without project → 400; dry GET still answers and echoes the project
  let r = await call("GET", "/api/whirlpool/vault/close-position?project=treasury&mint=11111111111111111111111111111111&run=1");
  ok("GET /vault/close-position?run=1 is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("POST", "/api/whirlpool/vault/close-position?mint=11111111111111111111111111111111&run=1");
  ok("POST armed call with no project= is refused with 400 (no silent clkn default)", r.status === 400 && /project/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
  r = await call("GET", "/api/whirlpool/vault/close-position?project=treasury&mint=11111111111111111111111111111111");
  ok("GET dry run still answers and echoes project=treasury", r.status === 200 && r.body && r.body.project === "treasury" && r.body.action === "would-close", JSON.stringify(r.body));
  ok("…and carries an operator field (null here — no secrets loaded)", r.body && "operator" in r.body);
  r = await call("GET", "/api/whirlpool/vault/recoup-baseline?project=cuna&arm=1");
  ok("GET /vault/recoup-baseline?arm=1 is refused with 405", r.status === 405);
  r = await call("POST", "/api/whirlpool/vault/config");
  ok("POST /vault/config without project= is refused with 400", r.status === 400, JSON.stringify(r.body));
  r = await call("GET", "/api/whirlpool/vault/status?project=poke");
  ok("GET /vault/status still reads (and echoes poke)", r.status === 200 && r.body && r.body.project === "poke", JSON.stringify(r.body).slice(0, 160));
  r = await call("GET", "/api/whirlpool/vault/status?project=treasury", false);
  ok("vault routes stay 404 without the key", r.status === 404);

  // ── #8 server admin routes
  r = await call("GET", "/api/x-delete?id=123&run=1");
  ok("GET /api/x-delete?run=1 is refused with 405 (irreversible)", r.status === 405);
  r = await call("GET", "/api/x-delete?id=123");
  ok("GET /api/x-delete without run=1 stays the dry run", r.status === 200 && r.body && r.body.dryRun === true, JSON.stringify(r.body));
  r = await call("GET", "/api/treasury-engine-window");
  ok("bare GET /api/treasury-engine-window no longer ARMS — it reports", r.status === 200 && r.body && r.body.armed === false && r.body.note, JSON.stringify(r.body));
  r = await call("POST", "/api/treasury-engine-window?off=1");
  ok("POST /api/treasury-engine-window?off=1 works", r.status === 200 && r.body && r.body.armed === false);
  r = await call("GET", "/api/lock-celebration?clear=1");
  ok("GET /api/lock-celebration?clear=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/lock-celebration");
  ok("GET /api/lock-celebration still reads pending", r.status === 200 && r.body && "pending" in r.body, JSON.stringify(r.body));
  r = await call("POST", "/api/lock-celebration?clear=1");
  ok("POST /api/lock-celebration?clear=1 clears", r.status === 200 && r.body && r.body.cleared === true, JSON.stringify(r.body));
  r = await call("GET", "/api/buybot?project=cuna&arm=1");
  ok("GET /api/buybot?arm=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/buybot?project=cuna&min=5");
  ok("GET /api/buybot with a config field is refused with 405 (every field upsert saves)", r.status === 405);
  r = await call("GET", "/api/buybot?list=1");
  ok("GET /api/buybot?list=1 still lists", r.status === 200 && r.body && Array.isArray(r.body.bots));
  r = await call("GET", "/api/rose-buybot?arm=1");
  ok("GET /api/rose-buybot?arm=1 is refused with 405", r.status === 405);
  // Incident 2026-09-17: the flag-less GET used to run a full poll "even while disarmed" and, with
  // a cursor stale from days of disarm, posted a whole window of old buys into the OnlyRose room.
  // The plain GET is a status read now; the poll is POST ?run=1 only.
  r = await call("GET", "/api/rose-buybot");
  ok("GET /api/rose-buybot (flag-less) is the status read — never a poll", r.status === 200 && r.body && r.body.status === true && !("scanned" in r.body) && !("posted" in r.body), JSON.stringify(r.body).slice(0, 160));
  r = await call("GET", "/api/rose-buybot?run=1");
  ok("GET /api/rose-buybot?run=1 is refused with 405", r.status === 405, String(r.status));
  r = await call("POST", "/api/rose-buybot?run=1");
  ok("POST /api/rose-buybot?run=1 reaches the poll (no token here → dormant, not the status shape)", r.status === 200 && r.body && r.body.status !== true, JSON.stringify(r.body).slice(0, 160));
  // /api/tg-test is POST-only since 2026-09-17 (owner: "convert tg-test too, routine first"): every
  // form of it sends, so the whole GET method is refused — after the key check, which stays 404.
  r = await call("GET", "/api/tg-test?text=hello"); ok("GET /api/tg-test?text= is refused with 405 (POST-only since 2026-09-17)", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/tg-test"); ok("flag-less GET /api/tg-test is refused too (it would post the default heads-up)", r.status === 405);
  r = await call("GET", "/api/tg-test?text=hello", false); ok("GET /api/tg-test without the key stays 404", r.status === 404);
  r = await call("POST", "/api/tg-test?text=hello"); ok("POST /api/tg-test reaches the query send path (no token here → 'not configured', not a 400)", r.status === 200 && r.body && r.body.success === false && /not configured/.test(String(r.body.error)), JSON.stringify(r.body));
  {
    const bytes = Buffer.alloc(512, 1);
    const up = await fetch(BASE + "/api/tg-test?kind=animation", { method: "POST", headers: { "x-premium-key": KEY, "Content-Type": "image/gif" }, body: bytes });
    const ub = await up.json().catch(() => null);
    ok("POST /api/tg-test with file bytes reaches the raw-upload path (no token here → 'not configured')", up.status === 200 && ub && ub.success === false && /not configured/.test(String(ub.error)), up.status + " " + JSON.stringify(ub));
    // Codex on #333: a short body must be REFUSED, never re-read as the bodiless query send (which
    // would post the default heads-up text to the room).
    const short = await fetch(BASE + "/api/tg-test?kind=animation", { method: "POST", headers: { "x-premium-key": KEY, "Content-Type": "image/gif" }, body: Buffer.alloc(50, 1) });
    const sb = await short.json().catch(() => null);
    ok("POST /api/tg-test with a 50-byte body is refused 400 (not routed to the text send)", short.status === 400 && sb && /too short/.test(String(sb.error)), short.status + " " + JSON.stringify(sb));
  }
  // /api/meme-queue (owner, 2026-09-17: "convert meme-queue done to POST too, routine first"):
  // done= / art= / clear=1 write → POST-only; the list, history=1 and all=1 stay reads.
  r = await call("GET", "/api/meme-queue?done=abc"); ok("GET /api/meme-queue?done= is refused with 405", r.status === 405, String(r.status));
  r = await call("GET", "/api/meme-queue?clear=1"); ok("GET /api/meme-queue?clear=1 is refused with 405", r.status === 405, String(r.status));
  r = await call("GET", "/api/meme-queue"); ok("GET /api/meme-queue still lists pending", r.status === 200 && r.body && r.body.ok === true && Array.isArray(r.body.pending), JSON.stringify(r.body).slice(0, 120));
  r = await call("GET", "/api/meme-queue?history=1"); ok("GET /api/meme-queue?history=1 still reads the art ledger", r.status === 200 && r.body && Array.isArray(r.body.art), JSON.stringify(r.body).slice(0, 120));
  r = await call("POST", "/api/meme-queue?done=abc&art=%7B%22image%22%3A%22x%22%7D"); ok("POST /api/meme-queue?done=&art= goes through", r.status === 200 && r.body && r.body.ok === true, JSON.stringify(r.body).slice(0, 120));
  r = await call("GET", "/api/meme-queue?done=abc", false); ok("meme-queue stays 404 without the key", r.status === 404);

  // ── buy-comp server payout: run / sweep / unpay / set on a GET → 405, decided BEFORE the comp
  // lookup so a pasted link is refused before it touches anything; the flag-less GET is the read.
  r = await call("GET", "/api/buycomp/send?id=nope&run=1");
  ok("GET /api/buycomp/send?run=1 is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/buycomp/send?id=nope&set=x");
  ok("GET /api/buycomp/send?set= is refused with 405", r.status === 405);
  r = await call("GET", "/api/buycomp/send?id=nope&sweep=1");
  ok("GET /api/buycomp/send?sweep=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/buycomp/send?id=nope");
  ok("flag-less GET /api/buycomp/send is the read (404 for an unknown comp, not 405)", r.status === 404 && !!r.body && /no such competition/.test(String(r.body.error)), JSON.stringify(r.body));
  r = await call("GET", "/api/buycomp/send?id=nope&run=1", false);
  ok("/api/buycomp/send without the key is 404 like every admin route", r.status === 404);
  // ── the per-project Lock to Earn routes: every mutation is POST-only and refused BEFORE the
  // project lookup; the registry and admin/payout routes are 404 without the key
  r = await call("GET", "/api/hub-registry?id=x&mint=y");
  ok("GET /api/hub-registry?id= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/hub-registry", false);
  ok("/api/hub-registry without the key is 404", r.status === 404);
  r = await call("GET", "/api/hub/nope/admin?arm=1&confirm=go-live");
  ok("GET /api/hub/:project/admin?arm=1 is refused with 405 (before the project lookup)", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/admin?terms=1");
  ok("GET /api/hub/:project/admin?terms=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/hub/nope/admin");
  ok("flag-less GET /api/hub/:project/admin is the read (404 for an unknown project)", r.status === 404 && !!r.body && /no such project/.test(String(r.body.error)), JSON.stringify(r.body));
  r = await call("GET", "/api/hub-registry?approve=app_x");
  ok("GET /api/hub-registry?approve= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/hub-registry?reject=app_x");
  ok("GET /api/hub-registry?reject= is refused with 405", r.status === 405);
  r = await call("GET", "/api/hub-apply", false);
  ok("GET /api/hub-apply without ?mint= is 400 (submitting is a POST)", r.status === 400 && /POST/.test(String(r.body && r.body.error)), JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/desk/session?wallet=x", false);
  ok("GET /api/hub/:project/desk/session is refused with 405 (POST-only)", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/desk", false);
  ok("/api/hub/:project/desk without a key or operator token is 404", r.status === 404);
  r = await call("GET", "/api/hub/nope/admin", false);
  ok("/api/hub/:project/admin without a key or operator token is 404 (no project-exists hint)", r.status === 404 && !(r.body && /no such project/.test(String(r.body.error))), JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/access?sig=x&quote=y", false);
  ok("GET /api/hub/:project/access?sig= is refused with 405 (before the project lookup)", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/access", false);
  ok("flag-less GET /api/hub/:project/access is the quote read (404 for an unknown project)", r.status === 404, JSON.stringify(r.body));
  r = await call("GET", "/api/hub/nope/payout?export=1");
  ok("GET /api/hub/:project/payout?export=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/hub/nope/payout?send=x&run=1");
  ok("GET /api/hub/:project/payout?send= is refused with 405", r.status === 405);
  r = await call("GET", "/api/hub/nope/payout", false);
  ok("/api/hub/:project/payout without the key is 404", r.status === 404);
  r = await call("GET", "/api/hub/nope/holder?address=4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", false);
  ok("the public holder view answers 404 for an unknown project (no key needed)", r.status === 404 && !!r.body && /no such project/.test(String(r.body.error)));

  // ── B5 (Colosseum E3): commit/build and commit/observe are POST-only, refused before the
  // project lookup — a pasted link (or a chat unfurl) must never even attempt to build or observe
  // an on-chain commitment.
  r = await call("GET", "/api/hub/nope/commit/build?version=1");
  ok("GET /api/hub/:project/commit/build is refused with 405 (POST-only)", r.status === 405, JSON.stringify(r.body));
  r = await call("POST", "/api/hub/nope/commit/build?version=1");
  ok("POST /api/hub/:project/commit/build for an unknown project is 404", r.status === 404);
  r = await call("GET", "/api/hub/nope/commit/observe?sig=x");
  ok("GET /api/hub/:project/commit/observe is refused with 405 (POST-only)", r.status === 405, JSON.stringify(r.body));
  r = await call("POST", "/api/hub/nope/commit/observe?sig=x");
  ok("POST /api/hub/:project/commit/observe for an unknown project is 404", r.status === 404);
  r = await call("GET", "/api/hub/nope/program/1", false);
  ok("the public program-version view answers 404 for an unknown project (no key needed, no method restriction — it only reads)", r.status === 404);

  // ── lock-to-earn server send: send / sweep / void on a GET → 405 like confirm / cancel / export
  r = await call("GET", "/api/cuna-stake/payout?send=nope&run=1");
  ok("GET /api/cuna-stake/payout?send= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/cuna-stake/payout?void=x&sig=y");
  ok("GET /api/cuna-stake/payout?void= is refused with 405", r.status === 405);

  // ── #9 telegram test routes: 404 (not 403) without the key; post=1 needs POST
  r = await call("GET", "/api/bags-radar-test", false);
  ok("GET /api/bags-radar-test without key → 404 (was 403)", r.status === 404, String(r.status));
  r = await call("GET", "/api/market-check-test", false);
  ok("GET /api/market-check-test without key → 404 (was 403)", r.status === 404, String(r.status));
  r = await call("GET", "/api/bags-radar-test?post=1");
  ok("GET /api/bags-radar-test?post=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/market-check-test?post=1");
  ok("GET /api/market-check-test?post=1 is refused with 405", r.status === 405);

  // ── #6 Meteora pool allowlist — refused before anything touches the chain, dry run included
  r = await call("GET", "/api/meteora/open-position?pool=BnGwTFd5rBBVR1EYdEGkbf5c1sNqUqA6hQ2MuT9yrK5v&x=1&y=1");
  ok("open-position on a pool outside the allowlist is refused", r.status >= 400 && /allowlist/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const meteora = require("../lib/meteora-dlmm");
  ok("assertPoolAllowed accepts the canonical pool", (() => { try { meteora.assertPoolAllowed(meteora.METEORA_POOL); return true; } catch (e) { return false; } })());
  ok("assertPoolAllowed rejects any other address", (() => { try { meteora.assertPoolAllowed("BnGwTFd5rBBVR1EYdEGkbf5c1sNqUqA6hQ2MuT9yrK5v"); return false; } catch (e) { return /allowlist/.test(e.message); } })());

  // ── #4 the admin route reports days as DAYS and the payout route reports slices
  r = await call("GET", "/api/cuna-stake/admin");
  ok("cuna admin reports daysAccrued and slicesAccrued as numbers", r.status === 200 && r.body && typeof r.body.daysAccrued === "number" && typeof r.body.slicesAccrued === "number" && r.body.daysAccrued <= r.body.slicesAccrued, JSON.stringify({ d: r.body && r.body.daysAccrued, s: r.body && r.body.slicesAccrued, status: r.status }));

  // ── F12 (deep dive 2026-09-06): the Cloudflare origin-lockdown exemption for the game host.
  // This harness boots with CF_ORIGIN_SECRET UNSET, which is the required dev/CI posture: the
  // lockdown is dark, nothing 403s, and clientIp() keeps its pre-lockdown behaviour (server.js
  // stamps req.cluckEdgeVerified = null when there is no secret to verify against, and
  // normie-quest/routes.js only distrusts `cf-connecting-ip` when that flag is explicitly false).
  // So the two halves that ARE assertable secret-free are the ones that scope the exemption:
  //   (a) the game host is derived from the TCP Host header, never X-Forwarded-Host — Express runs
  //       `trust proxy: true`, which made req.hostname honour a client-supplied forwarded host;
  //   (b) NQ_GAME_PATH is exhaustive, so the admin/PII consoles are not game surfaces.
  // WITH the secret set, (a)+(b) are exactly what the 403 branch keys off: a spoofed
  // X-Forwarded-Host no longer buys the exemption, and /normie-quest-x7/{prizes,vip,reward,
  // lounge-admin,dashboard} plus /api/nq/{gate,leaderboard/reset} fall through to the 403 instead
  // of being waved past the WAF. Those paths cannot be exercised here without arming the secret,
  // which would 403 the rest of this file.
  let x = await raw("GET", "/api/nq/gate?key=nope", { "x-forwarded-host": "normiequest.app" });
  ok("X-Forwarded-Host cannot make a request look like the game host (F12)", x.status === 404 && !x.location, x.status + " " + x.location);
  x = await raw("GET", "/normie-quest-x7", { host: "normiequest.app" });
  ok("a real Host: normiequest.app still serves the game shell", x.status === 200, String(x.status));
  x = await raw("GET", "/api/nq/config", { host: "normiequest.app" });
  ok("…and the public game API", x.status === 200, String(x.status));
  x = await raw("GET", "/normie-quest-x7/prizes?" + NQK, { host: "normiequest.app" });
  ok("…but the PII console is NOT a game surface — it bounces off the game host", x.status === 301 && /clucknorris\.app/.test(x.location), x.status + " " + x.location);
  x = await raw("GET", "/normie-quest-x7/dashboard?" + NQK, { host: "normiequest.app" });
  ok("…nor is the operator dashboard", x.status === 301, x.status + " " + x.location);
  x = await raw("GET", "/api/nq/leaderboard/reset?" + NQK, { host: "normiequest.app" });
  ok("…nor the owner season-reset lever", x.status === 301, x.status + " " + x.location);
  x = await raw("GET", "/api/nq/gate?" + NQK, { host: "normiequest.app" });
  ok("…nor the launch-gate lever", x.status === 301, x.status + " " + x.location);

  // ── §9.11: the Normie Quest admin routes that ACT follow the repo POST-only rule.
  // One triple per converted route: flag-less GET = the read, GET with a mutating flag = 405,
  // POST = through. DATA_DIR is the throwaway temp dir above, so every write here is discarded.
  const PK = "A".repeat(32);   // valid base58 shape for the VIP allowlist regex; not a real wallet
  r = await call("GET", "/normie-quest-x7/vip?" + NQK + "&add=" + PK);
  ok("GET /normie-quest-x7/vip?add= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/normie-quest-x7/vip?" + NQK);
  ok("GET /normie-quest-x7/vip still lists the allowlist", r.status === 200 && r.body && Array.isArray(r.body.wallets), JSON.stringify(r.body));
  r = await call("POST", "/normie-quest-x7/vip?" + NQK + "&add=" + PK);
  ok("POST /normie-quest-x7/vip?add= grants", r.status === 200 && r.body && r.body.wallets.indexOf(PK) !== -1, JSON.stringify(r.body));
  r = await call("POST", "/normie-quest-x7/vip?" + NQK + "&remove=" + PK);
  ok("POST /normie-quest-x7/vip?remove= revokes", r.status === 200 && r.body && r.body.wallets.indexOf(PK) === -1, JSON.stringify(r.body));

  r = await call("GET", "/normie-quest-x7/lounge-admin?" + NQK + "&title=t&body=b");
  ok("GET /normie-quest-x7/lounge-admin?title=&body= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/normie-quest-x7/lounge-admin?" + NQK);
  ok("GET /normie-quest-x7/lounge-admin still lists posts", r.status === 200 && r.body && Array.isArray(r.body.posts), JSON.stringify(r.body));
  r = await call("POST", "/normie-quest-x7/lounge-admin?" + NQK + "&title=t&body=b");
  ok("POST /normie-quest-x7/lounge-admin posts", r.status === 200 && r.body && r.body.count === 1, JSON.stringify(r.body));

  r = await call("GET", "/normie-quest-x7/reward?" + NQK + "&wallet=" + PK + "&item=disc");
  ok("GET /normie-quest-x7/reward?item= is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/normie-quest-x7/reward?" + NQK + "&wallet=" + PK);
  ok("GET /normie-quest-x7/reward still reads a wallet's queue", r.status === 200 && r.body && r.body.pending === 0, JSON.stringify(r.body));
  r = await call("POST", "/normie-quest-x7/reward?" + NQK + "&wallet=" + PK + "&item=disc");
  ok("POST /normie-quest-x7/reward grants the item", r.status === 200 && r.body && r.body.ok === true && r.body.pending === 1, JSON.stringify(r.body));

  // The giveaway console renders on GET (it is a browser page); only &shipped= acts — and it
  // permanently wipes a winner's decrypted address, so it must never fire on a link unfurl.
  r = await call("GET", "/normie-quest-x7/prizes?" + NQK + "&shipped=0:" + PK + "&confirm=SHIPPED");
  ok("GET /normie-quest-x7/prizes?shipped= is refused with 405 (irreversible)", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/normie-quest-x7/prizes?" + NQK);
  ok("GET /normie-quest-x7/prizes still renders the console", r.status === 200);
  r = await call("POST", "/normie-quest-x7/prizes?" + NQK + "&shipped=0:" + PK + "&confirm=SHIPPED");
  ok("POST /normie-quest-x7/prizes?shipped= goes through (no such claim here — status only)", r.status === 200);

  r = await call("GET", "/api/nq/leaderboard/reset?" + NQK + "&confirm=RESET");
  ok("GET /api/nq/leaderboard/reset?confirm=RESET is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/nq/leaderboard/reset?" + NQK);
  ok("GET /api/nq/leaderboard/reset without confirm stays the self-documenting 400", r.status === 400, JSON.stringify(r.body));
  r = await call("POST", "/api/nq/leaderboard/reset?" + NQK + "&confirm=RESET");
  ok("POST /api/nq/leaderboard/reset?confirm=RESET archives + clears", r.status === 200 && r.body && r.body.ok === true, JSON.stringify(r.body));
  r = await call("GET", "/api/nq/leaderboard/reset?confirm=RESET&key=wrong", false);
  ok("…and it is still an indistinguishable 404 with a wrong admin key", r.status === 404, String(r.status));

  // EXCEPTION, owner decision: /api/nq/gate is the phone panic lever and stays a GET. Pinned so a
  // future "make every admin route POST" pass does not quietly take it away.
  r = await call("GET", "/api/nq/gate?" + NQK + "&cap=0");
  ok("/api/nq/gate?cap= stays a working GET (owner's phone panic lever — deliberate exception)", r.status === 200 && r.body && r.body.changed === true, JSON.stringify(r.body));

  // ── Deep dive 2026-09-17 P0-002 / P0-008: the admin routes the 09-05 audit missed ──
  console.log("\nDeep dive 2026-09-17 — the routes the first audit missed\n");
  r = await call("GET", "/api/cuna-giveaway/admin?draw=1");
  ok("GET /api/cuna-giveaway/admin?draw=1 is refused with 405", r.status === 405, JSON.stringify(r.body));
  r = await call("GET", "/api/cuna-giveaway/admin?payout=1&run=1");
  ok("GET /api/cuna-giveaway/admin?payout=1&run=1 (SENDS prizes) is refused with 405", r.status === 405);
  r = await call("GET", "/api/cuna-giveaway/admin?scan=1");
  ok("GET /api/cuna-giveaway/admin?scan=1 (ledger write) is refused with 405", r.status === 405);
  r = await call("GET", "/api/cuna-giveaway/admin?reset=1");
  ok("GET /api/cuna-giveaway/admin?reset=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/cuna-giveaway/admin");
  ok("GET /api/cuna-giveaway/admin flag-less still reports config", r.status === 200 && r.body && r.body.ok === true && ("config" in r.body), JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/cuna-giveaway/admin?payout=1");
  ok("GET /api/cuna-giveaway/admin?payout=1 (preview, no run) is still a read", r.status !== 405 && r.status !== 404, String(r.status));
  r = await call("GET", "/api/cuna-giveaway/admin?draw=1&key=wrong", false);
  ok("…and a wrong key is still an indistinguishable 404", r.status === 404);
  for (const p of ["remove-liquidity?run=1", "add-liquidity?run=1", "open-position?run=1", "unwrap?run=1", "rebalance-inplace?run=1", "recenter?run=1", "config?autoRecenter=1", "config?which=jup&enabled=0", "config?ledgerSol=1"]) {
    r = await call("GET", "/api/meteora/" + p);
    ok(`GET /api/meteora/${p} is refused with 405`, r.status === 405, String(r.status));
  }
  r = await call("GET", "/api/meteora/config");
  ok("GET /api/meteora/config still reads", r.status === 200 && r.body && !!r.body.config, String(r.status));
  r = await call("GET", "/api/clkn-blitz?run=1"); ok("GET /api/clkn-blitz?run=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/clkn-blitz?abort=1"); ok("GET /api/clkn-blitz?abort=1 is refused with 405", r.status === 405);
  for (const e of ["dnc", "rose", "cuna"]) {
    r = await call("GET", `/api/${e}-engine?on=1`); ok(`GET /api/${e}-engine?on=1 is refused with 405`, r.status === 405, String(r.status));
    r = await call("GET", `/api/${e}-engine?off=1`); ok(`GET /api/${e}-engine?off=1 is refused with 405`, r.status === 405, String(r.status));
    r = await call("GET", `/api/${e}-engine`); ok(`GET /api/${e}-engine still reports state (not armed)`, r.status === 200 && r.body && r.body.ok === true && r.body.armed === false, JSON.stringify(r.body).slice(0, 160));
  }
  r = await call("GET", "/api/diploma-mint?action=create-tree&run=1"); ok("GET /api/diploma-mint?action=create-tree&run=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/diploma-mint?action=backfill&run=1"); ok("GET /api/diploma-mint?action=backfill&run=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/diploma-mint?action=create-tree"); ok("GET /api/diploma-mint?action=create-tree stays the dry run", r.status === 200 && r.body && r.body.dryRun === true, JSON.stringify(r.body));
  r = await call("GET", "/api/school-airdrop?max=5"); ok("GET /api/school-airdrop?max=5 is refused with 405", r.status === 405);
  r = await call("GET", "/api/school-airdrop?wallet=" + PK + "&amount=1&run=1"); ok("GET /api/school-airdrop?wallet=&amount=&run=1 is refused with 405", r.status === 405);
  r = await call("GET", "/api/school-airdrop"); ok("GET /api/school-airdrop still reports status", r.status === 200 && r.body && r.body.success === true, JSON.stringify(r.body).slice(0, 160));

  // ── P0-009/010: Buy Special's data endpoints check the tools pass SERVER-side ──
  const BS = "/api/buyspecial-crosscheck?mint=" + PK + "&from=1700000000&to=1700003600";
  r = await call("GET", BS, false);
  ok("GET /api/buyspecial-crosscheck without a pass is 402 pass_required", r.status === 402 && r.body && r.body.error === "pass_required", JSON.stringify(r.body).slice(0, 160));
  r = await raw("GET", BS, { "x-clkn-pass": "t:garbage.token" });
  ok("…a forged pass is 403", r.status === 403, String(r.status));
  r = await call("GET", "/api/buyspecial-holdcheck?mint=" + PK + "&from=1700000000&to=1700003600&wallets=" + PK, false);
  ok("GET /api/buyspecial-holdcheck without a pass is 402", r.status === 402, String(r.status));
  r = await call("GET", "/api/buyspecial-trace?mint=" + PK + "&wallet=" + PK + "&from=1700000000&to=1700003600", false);
  ok("GET /api/buyspecial-trace without a pass is 402", r.status === 402, String(r.status));
  r = await call("GET", BS);
  ok("…the operator console (admin key header) passes the gate", r.status !== 402 && r.status !== 403 && r.status !== 404, String(r.status));

  // ── Deep dive 2026-09-17 P1 batch ──
  console.log("\nDeep dive 2026-09-17 — P1 batch\n");
  r = await call("GET", "/api/x-post-test?post=1&text=hello"); ok("GET /api/x-post-test?post=1 is refused with 405 (P1-019)", r.status === 405, String(r.status));
  r = await call("GET", "/api/x-post-test"); ok("GET /api/x-post-test flag-less still answers", r.status === 200, String(r.status));
  r = await call("GET", "/api/x-announce?post=1&text=hello"); ok("GET /api/x-announce?post=1 is refused with 405 (P1-019)", r.status === 405, String(r.status));
  r = await call("GET", "/api/x-announce?text=hello"); ok("GET /api/x-announce without post=1 stays the dry run", r.status === 200 && r.body && r.body.dryRun === true, JSON.stringify(r.body));
  r = await call("GET", "/api/classroom/graduates?action=paid&wallet=" + PK); ok("GET /api/classroom/graduates?action= is refused with 405 (P1-058)", r.status === 405, String(r.status));
  r = await call("GET", "/api/classroom/graduates"); ok("GET /api/classroom/graduates still lists", r.status === 200 && r.body && r.body.success === true, JSON.stringify(r.body).slice(0, 120));
  // P2-113 (2026-09-17): the graduation gate's mode/threshold writes are POST-only; the read stays.
  r = await call("GET", "/api/school/grad-gate?mode=off"); ok("GET /api/school/grad-gate?mode= is refused with 405 (P2-113)", r.status === 405, String(r.status));
  r = await call("GET", "/api/school/grad-gate?lessons=1"); ok("GET /api/school/grad-gate?lessons= is refused with 405", r.status === 405, String(r.status));
  r = await call("GET", "/api/school/grad-gate"); ok("GET /api/school/grad-gate still reads (mode + recentBlocks journal)", r.status === 200 && r.body && typeof r.body.mode === "string" && Array.isArray(r.body.recentBlocks), JSON.stringify(r.body).slice(0, 160));
  r = await call("POST", "/api/school/grad-gate?mode=monitor"); ok("POST /api/school/grad-gate?mode= writes", r.status === 200 && r.body && r.body.mode === "monitor", JSON.stringify(r.body).slice(0, 120));
  r = await call("POST", "/api/school/grad-gate?mode="); ok("…and mode= (empty) returns it to auto", r.status === 200 && r.body && r.body.modePinned === null, JSON.stringify(r.body).slice(0, 120));
  r = await call("GET", "/api/school/grad-gate?mode=off", false); ok("grad-gate stays 404 without the key", r.status === 404);
  // A blocked claim is journalled (2026-09-17): the store-edition certificate route runs the same
  // gate as /api/claim, so a fresh sid with no progress is refused AND shows up in recentBlocks.
  {
    const sid = "guardtest-" + Math.random().toString(36).slice(2, 10);
    const c = await fetch(BASE + "/api/claim/certificate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid }) });
    const cb = await c.json().catch(() => null);
    ok("POST /api/claim/certificate with no progress is refused 403 not_yet", c.status === 403 && cb && cb.error === "not_yet" && cb.code === "no-progress", c.status + " " + JSON.stringify(cb).slice(0, 120));
    r = await call("GET", "/api/school/grad-gate");
    const entry = (r.body && r.body.recentBlocks || []).find((e) => e && e.sid === sid.slice(0, 8));
    ok("…and the block is journalled in recentBlocks (route, code, truncated sid)", !!entry && entry.route === "certificate" && entry.code === "no-progress" && entry.lessons === 0, JSON.stringify(r.body && r.body.recentBlocks).slice(0, 200));
    ok("…and the counter moved with it", r.body && r.body.blockedOrWouldBlock >= 1);
  }
  r = await call("GET", "/api/cuna-engine"); ok("CUNA_ENGINE_ON=1 in the environment does NOT arm the engine — kv is the only switch (P1-032)", r.status === 200 && r.body && r.body.armed === false, JSON.stringify(r.body).slice(0, 160));
  {
    const pr = await fetch(BASE + "/api/wallet-xray/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "what is this wallet" }) });
    let pb = null; try { pb = await pr.json(); } catch (_) {}
    ok("POST /api/wallet-xray/ask without a pass is 402 pass_required (P1-064)", pr.status === 402 && pb && pb.error === "pass_required", pr.status + " " + JSON.stringify(pb).slice(0, 120));
    const pr2 = await fetch(BASE + "/api/wallet-xray/ask", { method: "POST", headers: { "Content-Type": "application/json", "x-clkn-pass": "t:garbage.token" }, body: JSON.stringify({ question: "hi" }) });
    ok("…a forged pass is 403", pr2.status === 403, String(pr2.status));
  }

  done();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e && e.stack || e); process.exit(1); });
