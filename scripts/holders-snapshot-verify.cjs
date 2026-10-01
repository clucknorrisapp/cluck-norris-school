#!/usr/bin/env node
"use strict";
// scripts/holders-snapshot-verify.cjs — X7 (Colosseum roadmap §8): the READER side of the holder
// snapshot hash. lib/holders-snapshot.js writes `listHash` = sha256 over the canonical JSON of a
// snapshot's full holder list; this recomputes the same hash from a holder list you supply and
// tells you whether it matches what was published. Offline once you have both files — no key, no
// wallet, no server trusted beyond having handed you the two JSON documents.
//
// Usage:
//   node scripts/holders-snapshot-verify.cjs <snapshot-json-or-url> <full-list-json>
//
//   <snapshot-json-or-url>  a local file, or a URL, holding the published snapshot record — either
//                           the raw { id, mint, at, holderCount, top, totalSupplyRaw, listHash }
//                           shape, or the { ok, snapshot: {...} } wrapper GET
//                           /api/holders/snapshots/:id?mint=... returns.
//   <full-list-json>        a local file holding the full holder list that snapshot was taken
//                           over — an array of { wallet, amount } (or { wallet, balance }, the
//                           shape owners-snapshot's own exports use). Order does not matter: the
//                           hash is computed over the list sorted by wallet, so two independent
//                           assemblies of the same holders hash identically.
//
// Exit codes: 0 MATCH, 2 MISMATCH, 1 usage or a file/fetch that could not be read at all.

const fs = require("fs");
const { computeListHash } = require("../lib/holders-snapshot");

function usage() {
  console.error("usage: node scripts/holders-snapshot-verify.cjs <snapshot-json-or-url> <full-list-json>");
}

async function readJsonArg(arg) {
  if (/^https?:\/\//i.test(arg)) {
    const r = await fetch(arg);
    if (!r.ok) throw new Error(`fetch ${arg} → HTTP ${r.status}`);
    return r.json();
  }
  if (!fs.existsSync(arg)) throw new Error(`no such file: ${arg}`);
  return JSON.parse(fs.readFileSync(arg, "utf8"));
}

function unwrapSnapshot(body) {
  if (body && body.snapshot && typeof body.snapshot === "object") return body.snapshot;
  return body;
}

function unwrapList(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.holders)) return body.holders;   // /api/snapshot's shape
  if (body && Array.isArray(body.top)) return body.top;           // a snapshot record passed by mistake
  if (body && Array.isArray(body.fullList)) return body.fullList;
  throw new Error("full-list JSON is not an array (and no .holders/.top/.fullList array found on it)");
}

async function main(argv) {
  if (argv.length !== 2) { usage(); process.exit(1); }
  const [snapArg, listArg] = argv;
  let snapshot, list;
  try { snapshot = unwrapSnapshot(await readJsonArg(snapArg)); }
  catch (e) { console.error(`could not read snapshot (${snapArg}): ${e.message}`); process.exit(1); }
  try { list = unwrapList(await readJsonArg(listArg)); }
  catch (e) { console.error(`could not read full-list (${listArg}): ${e.message}`); process.exit(1); }

  if (!snapshot || typeof snapshot.listHash !== "string" || !snapshot.listHash) {
    console.error("snapshot JSON has no listHash to check against");
    process.exit(1);
  }
  const recomputed = computeListHash(list);
  const match = recomputed === snapshot.listHash;
  console.log(`snapshot id:       ${snapshot.id || "(unknown)"}`);
  console.log(`mint:              ${snapshot.mint || "(unknown)"}`);
  console.log(`holderCount:       ${snapshot.holderCount != null ? snapshot.holderCount : "(unknown)"}`);
  console.log(`rows recomputed:   ${list.length}`);
  console.log(`published hash:    ${snapshot.listHash}`);
  console.log(`recomputed hash:   ${recomputed}`);
  console.log(match ? "MATCH" : "MISMATCH");
  process.exit(match ? 0 : 2);
}

main(process.argv.slice(2)).catch((e) => { console.error(e && e.message || e); process.exit(1); });
