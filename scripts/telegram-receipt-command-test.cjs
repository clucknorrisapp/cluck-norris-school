#!/usr/bin/env node
/*
 * TELEGRAM /receipt COMMAND — BB4 (docs/COLOSSEUM_ROADMAP.md §12): the bot answers a `/receipt
 * <signature>` command with the reproduce() verdict for a Hub settlement signature, found across
 * every registered project via the same public function GET /api/hub/:project/r/:sig uses.
 *
 * Exercises lib/hub/receipt-command.js DIRECTLY — no server boot, no HTTP — against a real,
 * disk-backed kv store seeded with one registered project and one sent lock-to-earn batch (same
 * fixture shape scripts/hub-bundle-test.cjs / scripts/hub-status-test.cjs use). The Telegram send
 * is stubbed at the audited choke point: the stub re-implements tgApi's own room check by calling
 * the REAL lib/telegram-rooms.js `refusal()` — the same module server.js's tgApi consults — so a
 * pass here means the actual wiring holds, not a restatement of the policy under test.
 *
 * Covers:
 *   1. A known signature -> reply contains the verdict, the project label, both links, no
 *      forbidden word (verified/safe/guaranteed/APR/APY/yield/Normie Quest/Wallet Watch).
 *   2. An unknown (but well-shaped) signature -> the exact plain negative.
 *   3. A malformed signature -> the exact usage line, and it never touches the per-chat cooldown.
 *   4. A command from the OnlyRose room -> the send is refused by lib/telegram-rooms.js and
 *      nothing else fires (no reply lands anywhere, no fallback to another chat).
 *   5. The per-chat rate limit drops a second lookup inside the 10s window, and lets a lookup
 *      through again once the window has passed.
 *   6. scripts/telegram-rooms-test.cjs still passes (its "no direct send outside audited
 *      functions" scan must not flag this module — it never touches the Telegram API itself).
 *
 * Usage: node scripts/telegram-receipt-command-test.cjs
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + detail : "")); }
};

// ── fixture: a real registered project + one sent lock-to-earn batch ────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (n) => Array.from({ length: 44 }, (_, i) => B58[(i * 13 + n * 7 + 5) % 58]).join("");
const fakeSig = (n) => Array.from({ length: 87 }, (_, i) => B58[(i * 11 + n * 17 + 3) % 58]).join("");
const WALLET = fakeAddr(1);
const SIG_KNOWN = fakeSig(1);
const SIG_UNKNOWN = fakeSig(2); // well-shaped, never written to any batch
const PROJECT = "rctest";
const T0 = 1_800_000_000, T1 = T0 + 3600, BATCH_AT = T0 + 7200;
const BATCH_ID = "rc-batch-1";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-cmd-test-"));
const appState = {
  "hub:projects": {
    [PROJECT]: { id: PROJECT, label: "Receipt Cmd Test", symbol: "RCT", mint: fakeAddr(9), decimals: 9, rewardMint: fakeAddr(9), rewardDecimals: 9 },
  },
  [`program:${PROJECT}:days`]: {
    "2027-03-01T00": { credits: { [WALLET]: "1000000000" }, at: T0 },
    "2027-03-01T01": { credits: { [WALLET]: "500000000" }, at: T1 },
  },
  [`program:${PROJECT}:batches`]: {
    [BATCH_ID]: { id: BATCH_ID, state: "sent", at: BATCH_AT, amounts: { [WALLET]: "1500000000" }, sent: { [WALLET]: { sig: SIG_KNOWN, at: BATCH_AT + 60 } } },
  },
  [`program:${PROJECT}:paid`]: {},
};
fs.writeFileSync(path.join(DIR, "app-state.json"), JSON.stringify(appState));
process.env.DATA_DIR = DIR;

const kv = require("../lib/kvstore");
const hubStore = require("../lib/hub/store");
const hubPublic = require("../lib/hub/public");
const hubReproduce = require("../lib/hub/reproduce");
const hubProject = require("../lib/hub/project");
const receiptCmd = require("../lib/hub/receipt-command");
delete process.env.ROSE_TG_CHAT_ID;
const rooms = require("../lib/telegram-rooms");

// Mirrors server.js's own hubProjects()/hubProjectView() for the ONE registry-based project this
// fixture needs — not a re-implementation of the policy under test, just enough plumbing to reach
// lib/hub/receipt-command.js the way server.js's wiring does.
function hubProjectsTest() {
  const reg = hubStore.readRegistry(kv) || {};
  const out = {};
  for (const [id, p] of Object.entries(reg)) {
    out[id] = { id, label: p.label, symbol: p.symbol, mint: p.mint, decimals: p.decimals,
      rewardMint: p.rewardMint || p.mint, rewardDecimals: p.rewardDecimals != null ? p.rewardDecimals : p.decimals,
      dryRun: !!p.dryRun, brand: p.brand || null };
  }
  return out;
}
function hubProjectViewTest(project) {
  const days = hubStore.read(kv, project.id, "days", null);
  let stake = null;
  if (days && Object.keys(days).length) {
    stake = hubPublic.stakeView({
      days, paid: hubStore.read(kv, project.id, "paid", {}), batches: hubStore.read(kv, project.id, "batches", {}),
      decimals: project.rewardDecimals || project.decimals || 9, project, programState: hubStore.read(kv, project.id, "state", null),
    });
  }
  return hubPublic.projectView({ project, comps: [], draws: [], stake, giveaway: null, lessonReads: null, holderSnapshot: null });
}

// ── the audited-choke-point stub: calls the REAL lib/telegram-rooms.js refusal(), same as
// server.js's tgApi ─────────────────────────────────────────────────────────────────────────────
const sentLog = [];
const refusedLog = [];
function fakeTgApi(method, payload, opts) {
  const refused = rooms.refusal(payload.chat_id, method, opts);
  if (refused) { refusedLog.push({ method, chat_id: payload.chat_id, reason: refused }); return null; }
  sentLog.push({ method, chat_id: payload.chat_id, text: payload.text });
  return { message_id: sentLog.length };
}
function fakeTgSend(chatId, text, replyTo, opts = {}) {
  const result = fakeTgApi("sendMessage", { chat_id: chatId, text }, { roseRoomOk: opts.roseRoomOk === true });
  return result ? result.message_id : null;
}

const baseCtx = {
  hubProjects: hubProjectsTest, hubProjectView: hubProjectViewTest, hubPublic, hubStore, hubReproduce, hubProject, kv,
  publicBase: "https://clucknorris.app",
};
const FORBIDDEN = [/verified/i, /\bsafe\b/i, /guarantee/i, /\bAPR\b/, /\bAPY\b/, /\byield\b/i, /normie quest/i, /wallet watch/i];

async function main() {
  console.log("\nTelegram /receipt command — BB4\n");

  console.log("1. A known signature\n");
  {
    const before = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: "111", replyToId: 1, send: fakeTgSend, cooldownMap: new Map() });
    t("sent exactly one reply", sentLog.length === before + 1, `sentLog.length=${sentLog.length}`);
    const text = sentLog[sentLog.length - 1].text;
    t("contains the MATCH verdict", /\bMATCH\b/.test(text), text);
    t("contains the project label", text.includes("Receipt Cmd Test"), text);
    t("contains the receipt-page link with the full signature", text.includes(`https://clucknorris.app/hub/${PROJECT}/r/${SIG_KNOWN}`), text);
    t("contains the /hub/verify link", text.includes("https://clucknorris.app/hub/verify"), text);
    t("shortens the signature in the Settlement line (never the full 87 chars there)", !new RegExp(`Settlement:[^\\n]*${SIG_KNOWN}`).test(text), text);
    t("carries no forbidden word", !FORBIDDEN.some((re) => re.test(text)), text);
  }

  console.log("\n2. An unknown (well-shaped) signature\n");
  {
    const before = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_UNKNOWN, chatId: "222", replyToId: 2, send: fakeTgSend, cooldownMap: new Map() });
    t("sent exactly one reply", sentLog.length === before + 1);
    t("the exact plain negative", sentLog[sentLog.length - 1].text === receiptCmd.NOT_FOUND_TEXT, sentLog[sentLog.length - 1].text);
  }

  console.log("\n3. A malformed signature\n");
  {
    const cooldownMap = new Map();
    for (const bad of ["", "not-a-signature", "0OIl" + "x".repeat(60)]) {
      const before = sentLog.length;
      await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: bad, chatId: "333", replyToId: 3, send: fakeTgSend, cooldownMap });
      t(`"${bad.slice(0, 20)}" -> the exact usage line`, sentLog.length === before + 1 && sentLog[sentLog.length - 1].text === receiptCmd.USAGE_TEXT);
    }
    t("a bad-shape reply never touches the per-chat cooldown (repeated malformed calls all reply)", sentLog.filter((s) => s.chat_id === "333").length === 3);
  }

  console.log("\n4. A command from the OnlyRose room\n");
  {
    const beforeSent = sentLog.length, beforeRefused = refusedLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: rooms.ROSE_ROOM_ID, replyToId: 4, send: fakeTgSend, cooldownMap: new Map() });
    t("the send was refused by the room policy", refusedLog.length === beforeRefused + 1, JSON.stringify(refusedLog[refusedLog.length - 1]));
    t("nothing was sent — not to the room, not anywhere else", sentLog.length === beforeSent);
  }

  console.log("\n5. Per-chat rate limit (10s)\n");
  {
    const cooldownMap = new Map();
    const T = 5_000_000;
    const before1 = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: "555", replyToId: 5, send: fakeTgSend, cooldownMap, now: () => T });
    t("first lookup sends", sentLog.length === before1 + 1);
    const before2 = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: "555", replyToId: 5, send: fakeTgSend, cooldownMap, now: () => T + 9000 });
    t("a second lookup 9s later in the same chat is DROPPED (no reply at all)", sentLog.length === before2);
    const before3 = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: "555", replyToId: 5, send: fakeTgSend, cooldownMap, now: () => T + 11000 });
    t("a third lookup 11s after the first goes through again", sentLog.length === before3 + 1);
    const before4 = sentLog.length;
    await receiptCmd.handleReceiptCommand({ ...baseCtx, arg: SIG_KNOWN, chatId: "556", replyToId: 5, send: fakeTgSend, cooldownMap, now: () => T + 9500 });
    t("a DIFFERENT chat is not affected by another chat's cooldown", sentLog.length === before4 + 1);
  }

  console.log("\n6. scripts/telegram-rooms-test.cjs still passes\n");
  {
    const r = spawnSync(process.execPath, [path.join(__dirname, "telegram-rooms-test.cjs")], { encoding: "utf8" });
    t("exits 0", r.status === 0, (r.stdout || "") + (r.stderr || ""));
  }

  console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
