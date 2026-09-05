#!/usr/bin/env node
/**
 * Owners Snapshot access gate — dependency-free check.
 *
 * The crawl is up to an hour of paid RPC reads, so RUNNING one is holder-gated
 * (owner, 2026-09-03). This asserts the gate actually closes, that the page reads
 * its requirement from the server instead of hardcoding it (CLAUDE.md), and that
 * TOOLGATE_OFF still opens everything.
 *
 * Boots the real server twice — once gated, once with the kill switch on — because
 * the switch is read at request time from env, and a test that only exercises the
 * happy path is exactly the kind of green-on-the-wrong-thing this repo keeps getting
 * bitten by.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function ok(name) { console.log("  ✓ " + name); }
function bad(name, detail) { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

const GOOD_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const GOOD_WALLET = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function boot(port, extraEnv) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), NODE_ENV: "test" }, extraEnv || {}),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (child.exitCode !== null) throw new Error("server exited (" + child.exitCode + "):\n" + log.slice(-2000));
    try { const r = await fetch(base + "/healthz"); if (r.ok) return { child, base }; } catch (e) {}
  }
  child.kill("SIGKILL");
  throw new Error("server did not come up:\n" + log.slice(-2000));
}

async function post(base, p, body) {
  const r = await fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, json: j };
}

(async () => {
  console.log("Owners Snapshot gate\n");

  // ---- static: the page must not hardcode the price-derived requirement ------
  console.log("page");
  const page = fs.readFileSync(path.join(ROOT, "public", "owners-snapshot.html"), "utf8");
  check("sends the connected wallet with /start",
    /owners-snapshot\/start[\s\S]{0,400}?wallet:/.test(page));
  check("renders its requirement from /api/owners-snapshot/config",
    page.includes("/api/owners-snapshot/config"));
  check("loads the shared wallet registry, not a private copy",
    page.includes("/cluck-wallet.js") && !/const\s+WALLETS\s*=\s*\{/.test(page));
  check("offers a disconnect (CLAUDE.md: connect implies disconnect)",
    page.includes("CluckWallet.disconnect"));
  // A literal "$50" or a CLKN token count in the page would go stale the moment the
  // price moves — the amount is live-derived server-side and must stay there.
  const hardcoded = page.match(/\$\s?50\b|\b\d{2,3},\d{3}\s*CLKN\b/g);
  check("no hardcoded dollar/CLKN requirement in the page", !hardcoded,
    hardcoded ? "found: " + hardcoded.join(", ") : "");

  // ---- gated boot -----------------------------------------------------------
  console.log("\ngate on");
  let s = await boot(3878, { TOOLGATE_OFF: "" });
  try {
    const cfg = await (await fetch(s.base + "/api/owners-snapshot/config")).json();
    check("config exposes holdUsd + caps", cfg && cfg.ok && typeof cfg.holdUsd === "number" &&
      cfg.caps && cfg.caps.perWalletPerDay > 0 && cfg.caps.totalPerDay > 0,
      JSON.stringify(cfg));
    check("config reports the gate as on", cfg && cfg.gateOff === false);

    const noWallet = await post(s.base, "/api/owners-snapshot/start", { mint: GOOD_MINT });
    check("start without a wallet is refused", noWallet.status === 401 &&
      noWallet.json && noWallet.json.error === "wallet_required",
      noWallet.status + " " + JSON.stringify(noWallet.json));

    const junkWallet = await post(s.base, "/api/owners-snapshot/start", { mint: GOOD_MINT, wallet: "not-an-address" });
    check("start with a junk wallet is refused", junkWallet.status === 401 &&
      junkWallet.json && junkWallet.json.error === "wallet_required",
      junkWallet.status + " " + JSON.stringify(junkWallet.json));

    const badMint = await post(s.base, "/api/owners-snapshot/start", { mint: "nope", wallet: GOOD_WALLET });
    check("a bad mint still fails before any holder lookup", badMint.status === 400,
      badMint.status + " " + JSON.stringify(badMint.json));

    // A real wallet with no CLKN (or no network in CI) must never be let through:
    // every remaining path is a refusal, and specifically not a 200.
    const realWallet = await post(s.base, "/api/owners-snapshot/start", { mint: GOOD_MINT, wallet: GOOD_WALLET });
    check("a non-holder wallet never starts a crawl", realWallet.status !== 200,
      "got " + realWallet.status + " " + JSON.stringify(realWallet.json));

    // Reading stays free — the gate is on RUN only.
    const hist = await fetch(s.base + "/api/owners-snapshot/history?mint=" + GOOD_MINT);
    check("reading history stays free", hist.status === 200, "got " + hist.status);
  } finally { s.child.kill("SIGKILL"); }

  // ---- kill switch ----------------------------------------------------------
  console.log("\nTOOLGATE_OFF=1");
  s = await boot(3879, { TOOLGATE_OFF: "1" });
  try {
    const cfg = await (await fetch(s.base + "/api/owners-snapshot/config")).json();
    check("config reports the gate as off", cfg && cfg.gateOff === true, JSON.stringify(cfg));
    const r = await post(s.base, "/api/owners-snapshot/start", { mint: GOOD_MINT });
    check("start needs no wallet when the gate is off",
      !(r.json && r.json.error === "wallet_required"),
      r.status + " " + JSON.stringify(r.json));
  } finally { s.child.kill("SIGKILL"); }

  console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("\nharness error: " + (e && e.stack || e)); process.exit(1); });
