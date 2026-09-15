#!/usr/bin/env node
"use strict";
// CUNA drawing — pick the 0.25 SOL winner from the official entry list, reproducibly.
//
// The rules on cunatoken.com/draw.html (2026-09-11 → 2026-09-13 18:00Z):
//   1. reply to the pinned @cunatoken post with your Solana address,
//   2. enter the SAME address on the drawing page (that is the registry this reads),
//   3. hold more than $1 of $CUNA at that address AT THE TIME OF THE DRAWING → a second entry.
// One winner, 0.25 SOL. "On X only, or here only, is not an entry."
//
// READ-ONLY. Nothing here signs or sends — paying the winner is the owner's own manual step.
//
//   node scripts/cuna-draw-pick.cjs --live [--verified <file>] [--x-post <id>] [--seed auto|<str>]
//
// Inputs
//   --live                 pull the registry from the app (needs PREMIUM_ACCESS_KEY or CUNA_DRAW_EXPORT_TOKEN)
//   --export <file>        …or read a saved /api/cuna-draw/export JSON
//   --verified <file>      the X-verified addresses: one per line, OR the raw pasted thread text —
//                          every wallet-shaped string in it is extracted (--x-replies-file is an alias)
//   --x-post <tweet id>    …or ask the app to read the replies itself (/api/cuna-draw/x-replies, same key;
//                          X recent search reaches back 7 days only)
//   --preview              no X check yet: run the draw over EVERY entry, clearly labelled PREVIEW
//   --x-check-after        owner's call (2026-09-15): draw over EVERY site entry and verify the winner's X
//                          reply AFTER the draw; if it is missing the next alternate takes the prize,
//                          same seed, same list — the result says so
//   --seed auto|<string>   auto (default) = the latest FINALIZED Solana blockhash, slot recorded
//   --alternates N         how many runners-up to list after the winner (default 3)
//   --min-usd N            the second-entry threshold (default 1)
//   --out <file>           where the JSON result goes (default: cuna-draw-result-<ts>.json in cwd)
//   --base <url>           app base for --live / --x-post (default https://clucknorris.app)
//   --rpc <url>            Solana RPC (default RPC_URL env, else the app's /api/helius-rpc proxy — the
//                          public mainnet endpoint 429s getTokenAccountsByOwner after a handful of calls)
//   --allow-balance-errors a wallet whose balance could not be read gets ONE entry instead of stopping
//                          the run (a final result with unread balances is otherwise refused)
//
// Publish the result JSON alongside the winner: seed + entries (with chances) + the SHA256 walk let
// anyone re-run it — `drawFromSeed` in lib/cuna-draw.js is the whole algorithm.
const fs = require("fs");
const path = require("path");
const draw = require("../lib/cuna-draw");

const CUNA_MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };

const BASE = (opt("--base", process.env.CLKN_BASE || "https://clucknorris.app")).replace(/\/$/, "");
const RPC = opt("--rpc", process.env.RPC_URL || (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : `${BASE}/api/helius-rpc`));
const MIN_USD = Number(opt("--min-usd", "1"));
const ALTS = Math.max(0, Number(opt("--alternates", "3")) || 0);
const PREVIEW = flag("--preview");
const X_AFTER = flag("--x-check-after");
const adminHeaders = () => {
  const h = {};
  if (process.env.CUNA_DRAW_EXPORT_TOKEN) h["x-draw-token"] = process.env.CUNA_DRAW_EXPORT_TOKEN;
  else if (process.env.PREMIUM_ACCESS_KEY) h["x-premium-key"] = process.env.PREMIUM_ACCESS_KEY;
  return h;
};

async function getJson(url, init) {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Paced + retried: a 429 from a public endpoint is the normal case, not a wallet with no balance.
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * 2 ** (attempt - 1));
    try {
      const j = await getJson(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (j.error) { last = new Error(`${method}: ${JSON.stringify(j.error)}`); if (j.error.code === 429) continue; throw last; }
      return j.result;
    } catch (e) { last = e; if (!/429/.test(e.message)) throw e; }
  }
  throw last;
}

// Balance the CLAUDE.md way: getTokenAccountsByOwner for BOTH token programs, jsonParsed.
async function cunaBalance(owner) {
  let ui = 0;
  for (const programId of TOKEN_PROGRAMS) {
    const r = await rpc("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]);
    for (const a of ((r && r.value) || [])) {
      const info = a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
      if (info && info.mint === CUNA_MINT) ui += Number((info.tokenAmount && info.tokenAmount.uiAmount) || 0);
    }
  }
  return ui;
}
// Price from the deepest DexScreener pair for the mint — recorded in the result so the $1 line is auditable.
async function cunaPrice() {
  const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${CUNA_MINT}`);
  const pairs = (j.pairs || []).filter((p) => p.priceUsd && p.liquidity && p.liquidity.usd).sort((a, b) => b.liquidity.usd - a.liquidity.usd);
  if (!pairs.length) throw new Error("no priced DexScreener pair for CUNA");
  return { priceUsd: Number(pairs[0].priceUsd), pair: pairs[0].pairAddress, dex: pairs[0].dexId, liquidityUsd: pairs[0].liquidity.usd };
}

(async () => {
  // 1. The registry.
  let exp;
  if (opt("--export")) exp = JSON.parse(fs.readFileSync(opt("--export"), "utf8"));
  else if (flag("--live")) {
    if (!Object.keys(adminHeaders()).length) throw new Error("--live needs PREMIUM_ACCESS_KEY or CUNA_DRAW_EXPORT_TOKEN in the env");
    exp = await getJson(`${BASE}/api/cuna-draw/export`, { headers: adminHeaders() });
  } else throw new Error("give --live or --export <file>");
  const registry = (exp.entries || []).map((e) => ({ address: draw.canonicalAddress(e.address), enteredAt: e.created_at || new Date(e.at || 0).toISOString() })).filter((e) => e.address);
  if (exp.window && exp.window.state && exp.window.state !== "closed") console.warn(`⚠ the entry window is ${exp.window.state}, not closed — a draw now would be premature`);
  console.log(`registry: ${registry.length} entries (window ${exp.window ? exp.window.open + " → " + exp.window.close + ", " + exp.window.state : "unknown"})`);

  // 2. Who replied under the pinned post with the same address.
  let verified = null, xInfo = null;
  const vfile = opt("--verified") || opt("--x-replies-file");
  if (vfile) {
    verified = new Set(draw.extractAddresses(fs.readFileSync(vfile, "utf8")));
    xInfo = { source: "file", file: vfile, addresses: verified.size };
  } else if (opt("--x-post")) {
    const j = await getJson(`${BASE}/api/cuna-draw/x-replies?post=${encodeURIComponent(opt("--x-post"))}`, { headers: adminHeaders() });
    if (j.xError) throw new Error(`X reply read failed: ${JSON.stringify(j.xError)} — paste the thread into a file and use --verified instead`);
    verified = new Set(j.matched.map((m) => m.address));
    xInfo = { source: "x-api", post: j.post, replies: j.replies, addressesInReplies: j.addressesInReplies, unmatchedReplies: j.unmatchedReplies };
  }
  if (!verified && !PREVIEW && !X_AFTER) {
    console.log("\nNo X verification given. Either:");
    console.log("  --verified <file>   one address per line, or the pasted reply thread (addresses are extracted)");
    console.log("  --x-post <id>       let the app read the replies with its X keys (7-day search window)");
    console.log("  --preview           run the draw over every entry now, labelled PREVIEW (not a result)");
    console.log("\nEntries on the list:");
    for (const e of registry) console.log(`  ${e.enteredAt}  ${e.address}`);
    process.exit(2);
  }
  const eligible = !verified ? registry.slice() : registry.filter((e) => verified.has(e.address));
  const dropped = registry.filter((e) => !eligible.includes(e));
  console.log(`eligible: ${eligible.length}${!verified ? (PREVIEW ? " (PREVIEW — every entry treated as verified)" : " (every site entry — X reply verified AFTER the draw, alternates in order)") : " after the X check"}, dropped ${dropped.length}`);

  // 3. The second entry: > $MIN_USD of CUNA at the time of the drawing, read on-chain now.
  const price = await cunaPrice();
  const checkedAt = new Date().toISOString();
  console.log(`CUNA price $${price.priceUsd} (${price.dex} ${price.pair}, liq $${Math.round(price.liquidityUsd)}) at ${checkedAt}`);
  const entries = [];
  for (const e of eligible) {
    let balance = null, err = null;
    try { balance = await cunaBalance(e.address); } catch (x) { err = x.message; }
    const usd = balance == null ? null : balance * price.priceUsd;
    const chances = usd != null && usd > MIN_USD ? 2 : 1;   // an RPC failure is ONE entry, never zero
    entries.push({ address: e.address, enteredAt: e.enteredAt, balance, usd: usd == null ? null : Number(usd.toFixed(4)), chances, ...(err ? { balanceError: err } : {}) });
    console.log(`  ${e.address}  ${balance == null ? "balance: ERROR " + err : balance.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " CUNA ≈ $" + usd.toFixed(2)}  → ${chances} ${chances === 1 ? "entry" : "entries"}`);
    await sleep(250);
  }
  const unread = entries.filter((e) => e.balanceError).length;
  if (unread && !(PREVIEW && !verified) && !flag("--allow-balance-errors")) throw new Error(`${unread} balance(s) could not be read — a final draw with an unread balance may shortchange a holder. Re-run (the RPC was rate-limited or down), or pass --allow-balance-errors to count each as one entry.`);

  // 4. The seed: a finalized blockhash nobody could have chosen, slot recorded for re-verification.
  let seed = opt("--seed", "auto"), seedSource;
  if (seed === "auto") {
    const r = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
    seed = r.value.blockhash;
    seedSource = { kind: "solana-blockhash", slot: r.context.slot, commitment: "finalized", verify: `getBlock(${r.context.slot}).blockhash === "${seed}"` };
  } else seedSource = { kind: "supplied" };

  // 5. The draw.
  const picks = draw.drawFromSeed(entries, seed, 1 + ALTS);
  const totalChances = entries.reduce((n, e) => n + e.chances, 0);
  const result = {
    kind: PREVIEW && !verified ? "PREVIEW — not a result" : "CUNA drawing result",
    prize: "0.25 SOL", drawnAt: checkedAt,
    rules: { xReplyRequired: true, xReplyCheckedBeforeDraw: !!verified, secondEntryOverUsd: MIN_USD,
      ...(X_AFTER && !verified ? { note: "drawn over every site entry; the winner's reply under the pinned post is verified after the draw — if it is missing, the next alternate takes the prize (same seed, same list)" } : {}) },
    registry: { count: registry.length, window: exp.window || null }, xVerification: xInfo,
    price, seed, seedSource, entriesHash: draw.entriesHash(entries), totalChances,
    winner: picks[0] ? picks[0].address : null, alternates: picks.slice(1).map((p) => p.address), picks,
    entries, droppedByXCheck: dropped.map((d) => d.address),
    algorithm: "sort entries by address; pool = each address repeated `chances` times; pick k = pool[ SHA256(seed + ':' + k) mod pool.length ]; remove the picked address's block; repeat (lib/cuna-draw.js drawFromSeed)",
  };
  const out = opt("--out", path.join(process.cwd(), `cuna-draw-result-${checkedAt.replace(/[:.]/g, "-")}.json`));
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`\n${result.kind}`);
  console.log(`seed ${seed}${seedSource.slot ? " (finalized blockhash, slot " + seedSource.slot + ")" : ""}`);
  console.log(`entries ${entries.length}, total chances ${totalChances}, list hash ${result.entriesHash}`);
  console.log(`WINNER     ${result.winner || "(no eligible entries)"}`);
  result.alternates.forEach((a, i) => console.log(`alternate ${i + 1}  ${a}`));
  console.log(`\nresult written to ${out}`);
})().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
