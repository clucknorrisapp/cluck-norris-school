"use strict";
// lib/hub/receipt-command.js — BB4 (docs/COLOSSEUM_ROADMAP.md §12): the Telegram `/receipt
// <signature>` command. Pulled out of server.js (rather than inlined in the update handler like
// most commands) so scripts/telegram-receipt-command-test.cjs can exercise the real logic directly
// without booting the whole app — same reason lib/telegram-rooms.js is its own module.
//
// Every field in a reply comes from the SAME public view function the read route already calls
// (hubPublic.findReceipt) and the same reproduction core the reproducibility/bundle routes already
// run (lib/hub/reproduce.js) — never a private field, never a number this module invents.
//
// Room policy: this module does NOT special-case the OnlyRose room. `send` is the caller's
// tgSend (server.js), which itself goes through the ONE audited choke point (tgApi ->
// lib/telegram-rooms.js) — a reply aimed at that room is refused there, exactly like every other
// command's reply, with no `roseRoomOk` passed from here (CLAUDE.md, owner 2026-09-17: "make sure
// it is not posting anything in rose" — do not add an allow).
//
// Honesty rules (CLAUDE.md; roadmap §12): say what the record shows, never why; never
// "verified"/"safe"/"guaranteed"; no APR/APY/yield language; nothing about Normie Quest rewards;
// never mention Wallet Watch. This module only ever states a reproduce() verdict in plain words,
// an amount, a shortened signature, and two links.

const { escHtml } = require("../html-escape");

// Same base58 transaction-signature shape used throughout server.js/lib (server.js HUB_SIG_RE,
// lib/hub/public.js SIG_RE, lib/hub/routes.js SIG_RE) — kept as an identical literal rather than
// imported so this module has no dependency on server.js and stays requireable standalone.
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;

const USAGE_TEXT =
  "Usage: <code>/receipt &lt;signature&gt;</code>\n" +
  "Paste the settlement transaction signature from a Hub receipt page (or your own wallet history) and I'll check whether the published rule recomputes the same amount.";

const NOT_FOUND_TEXT = "No Hub receipt carries that signature.";

const VERDICT_WORDS = {
  MATCH: "the published rule computes the same amount",
  MISMATCH: "does not compute the same amount",
  MISSING_INPUTS: "the inputs to recompute it are not published yet",
};

function shortSig(sig) {
  const s = String(sig || "");
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

// Looks a signature up across every registered, non-demo Hub project — the same public function
// GET /api/hub/:project/r/:sig calls, just run once per project instead of once for a known
// project id. `hubProjects` is a () => {id: project} map (server.js hubProjects(), which never
// registers "demo"/"demo-b" — those live only in lib/hub/demo-fixture.js); `hubProjectView` builds
// one project's public view (server.js hubProjectView(project)); `hubPublic` is lib/hub/public.js.
//
// Returns `{ project, receipt }` or null. `project` is exactly one of hubProjects()'s own values
// (id/label/symbol/mint/decimals/rewardMint/rewardDecimals/dryRun/brand — the same shape /api/hub
// lists, never a private field). `receipt` is exactly what hubPublic.findReceipt() returns
// (projectId/symbol/dryRun/brand/program/receipt) — also never a private field.
function findHubReceiptBySig({ hubProjects, hubProjectView, hubPublic }, sig) {
  const s = String(sig || "");
  if (!SIG_RE.test(s)) return null;
  for (const project of Object.values(hubProjects() || {})) {
    let view;
    try { view = hubProjectView(project); } catch (_) { continue; }
    let found;
    try { found = hubPublic.findReceipt(view, s); } catch (_) { found = null; }
    if (found) return { project, receipt: found };
  }
  return null;
}

// Reproduces the amount for an already-found receipt — the same (batch, wallet) arithmetic
// GET /api/hub/:project/reproducibility and the AA2 bundle route already run, reconstructed purely
// from the batch/day ledger this project's routes already keep (lib/hub/reproduce.js's own header
// explains why: nothing here is a live DB read the reader could not also make themselves).
//
// Today only "lock-to-earn" rows carry that ledger. Any other kind (buy-comp, giveaway,
// buy-special-draw) reports MISSING_INPUTS naming the kind — exactly like
// lib/hub/reproduce.js's own projectReproducibility() does for those kinds elsewhere — never
// guessed at.
function reproduceHubReceipt({ hubStore, hubReproduce, hubProject, kv }, projectId, found) {
  const program = found.program || {};
  const row = found.receipt || {};
  if (program.kind !== "lock-to-earn") {
    return {
      status: "MISSING_INPUTS", published: row.amountUi != null ? String(row.amountUi) : null,
      reproduced: null, hash: null,
      missing: [`reproduction is not implemented yet for kind "${program.kind || "unknown"}"`],
    };
  }
  const batches = hubStore.read(kv, projectId, "batches", {}) || {};
  const batch = batches[row.batchId];
  if (!batch) {
    return { status: "MISSING_INPUTS", published: row.amountUi != null ? String(row.amountUi) : null, reproduced: null, hash: null, missing: ["the batch record behind this receipt"] };
  }
  const days = hubStore.read(kv, projectId, "days", {}) || {};
  const inputs = hubReproduce.buildInputsForWallet({ batch, wallet: row.wallet, days, batches });
  // The program version in force when this batch was built — same lookup the AA2 bundle route
  // runs. Absent for a project whose payout predates program versions (CUNA) — reproduce() then
  // reports hash: null rather than inventing one.
  let programVersion = null;
  try {
    const state = hubStore.read(kv, projectId, "state", {}) || {};
    if (Array.isArray(state.versions) && state.versions.length) {
      const dayKey = new Date((Number(batch.at) || 0) * 1000).toISOString().slice(0, 10);
      programVersion = hubProject.versionFor(state, dayKey) || null;
    }
  } catch (_) { /* no version state on this project — reproduce() still runs, hash stays null */ }
  return hubReproduce.reproduce({
    programVersion, inputs,
    receipt: { amountRaw: inputs ? inputs.amountRaw : (batch.amounts && batch.amounts[row.wallet]) },
  });
}

// The reply text — HTML, every value escaped with the shared Node-side escaper, no yield/verified
// language. `hubPublic` is passed through only for rawToUi() (raw base units -> a whole-token
// string by string surgery, never division — the same formatter every other Hub view uses).
function composeReceiptText({ project, found, verdict, publicBase, hubPublic }) {
  const row = found.receipt || {};
  const symbol = found.symbol || project.symbol || "";
  const words = VERDICT_WORDS[verdict.status] || VERDICT_WORDS.MISSING_INPUTS;
  let amountLine;
  if (verdict.reproduced != null) {
    const decimals = Number.isInteger(project.rewardDecimals) ? project.rewardDecimals
      : (Number.isInteger(project.decimals) ? project.decimals : 9);
    const ui = hubPublic.rawToUi(verdict.reproduced, decimals);
    amountLine = `${escHtml(ui)} ${escHtml(symbol)}`.trim();
  } else {
    amountLine = "not available — the inputs to recompute it are not published yet";
  }
  const sig = String(row.sig || "");
  const link1 = `${publicBase}/hub/${encodeURIComponent(project.id)}/r/${encodeURIComponent(sig)}`;
  const link2 = `${publicBase}/hub/verify`;
  return (
    `🧾 <b>${escHtml(project.label || project.id)}</b> — Hub receipt\n` +
    `Verdict: <b>${escHtml(verdict.status)}</b> — ${words}\n` +
    `Amount the published rule computes: ${amountLine}\n` +
    `Settlement: <code>${escHtml(shortSig(sig))}</code>\n\n` +
    `${link1}\n${link2}`
  );
}

// The full command: validate shape, rate-limit per chat, look up, reproduce, reply.
//
// `send` is the caller's tgSend(chatId, text, replyTo) — this module calls it and nothing else;
// it never touches the Telegram API directly and never passes an OnlyRose allow (see header).
//
// `cooldownMap` (chatId -> last lookup timestamp) defaults to one Map shared for this module's
// lifetime — pass a fresh Map (or a fixed `now`) from a test for isolation. Only a well-shaped
// signature counts against the cooldown (a bad-shape usage reply is free — it never touches a
// store). Nothing this function does is durable: the cooldown map is in-process memory only, like
// the other command cooldowns in server.js (lbCooldown, TG_BUYSPECIAL_COOLDOWN_MS).
const DEFAULT_COOLDOWN_MS = 10 * 1000;
// P3-10 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): the default cooldown map is a
// process-lifetime Map keyed by chatId with no eviction — every chat that has ever run the
// command holds an entry forever. Bounded here: any entry older than COOLDOWN_MAP_MAX_AGE_MS is
// dropped on every call (cheap — the map only ever holds "chats that used /receipt recently"),
// and the map is hard-capped at COOLDOWN_MAP_MAX_ENTRIES by evicting the oldest entries first
// (insertion order in a Map — the cooldown value itself IS the last-touch timestamp, so the
// oldest entries are the least recently used ones) if pruning by age alone isn't enough.
const COOLDOWN_MAP_MAX_AGE_MS = 10 * 60 * 1000;
const COOLDOWN_MAP_MAX_ENTRIES = 1000;
// Age-based: run before the lookup below, so a stale entry never affects this call's own cooldown
// check (it wouldn't anyway — COOLDOWN_MAP_MAX_AGE_MS is 60x cooldownMs — but a call from any chat
// keeps the map from accumulating chats that stopped using the command).
function pruneStaleCooldowns(map, t) {
  for (const [k, last] of map) if (t - last > COOLDOWN_MAP_MAX_AGE_MS) map.delete(k);
}
// Cap-based: run AFTER this call's own entry is written, so the map never holds more than the cap
// at rest, even mid-burst — evicts the single oldest entry by Map iteration (insertion) order.
// LRU-ish, not exact: `Map#set` on an EXISTING key updates its value without moving it in
// iteration order, so a chat re-using the command doesn't refresh its position — but the age-based
// prune above already clears anything genuinely stale regardless of position, and the realistic
// abuse shape this caps (many distinct one-off chats, not one chat hammering the command) is
// exactly insertion order.
function enforceCooldownCap(map) {
  while (map.size > COOLDOWN_MAP_MAX_ENTRIES) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}
async function handleReceiptCommand({
  arg, chatId, replyToId, send,
  hubProjects, hubProjectView, hubPublic, hubStore, hubReproduce, hubProject, kv,
  publicBase, cooldownMap, now = Date.now, cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  const sig = String(arg || "").trim();
  if (!SIG_RE.test(sig)) return send(chatId, USAGE_TEXT, replyToId);

  const map = cooldownMap || (handleReceiptCommand._defaultCooldown || (handleReceiptCommand._defaultCooldown = new Map()));
  const t = now();
  pruneStaleCooldowns(map, t);
  const last = map.get(chatId);
  if (last != null && t - last < cooldownMs) return null; // dropped — a room can't loop this
  map.set(chatId, t);
  enforceCooldownCap(map);

  const found = findHubReceiptBySig({ hubProjects, hubProjectView, hubPublic }, sig);
  if (!found) return send(chatId, NOT_FOUND_TEXT, replyToId);

  const verdict = reproduceHubReceipt({ hubStore, hubReproduce, hubProject, kv }, found.project.id, found.receipt);
  const text = composeReceiptText({ project: found.project, found: found.receipt, verdict, publicBase, hubPublic });
  return send(chatId, text, replyToId);
}

module.exports = {
  SIG_RE, USAGE_TEXT, NOT_FOUND_TEXT, VERDICT_WORDS,
  shortSig, findHubReceiptBySig, reproduceHubReceipt, composeReceiptText, handleReceiptCommand,
};
