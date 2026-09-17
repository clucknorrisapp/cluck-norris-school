#!/usr/bin/env node
"use strict";
// lib/telegram-rooms — the Cluck bot never posts in the OnlyRose room (owner, 2026-09-17), and the
// wiring that makes every sender in the app obey it. Pure checks plus source assertions.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };

delete process.env.ROSE_TG_CHAT_ID;
const rooms = require("../lib/telegram-rooms");
const ROSE = rooms.ROSE_ROOM_ID;

console.log("\nTelegram room policy — nothing from the Cluck bot lands in the OnlyRose room\n");

t("the OnlyRose room id is the known one", () => assert.strictEqual(ROSE, "-1002625127458"));
t("isRoseRoom matches string and number forms, nothing else", () => {
  assert.strictEqual(rooms.isRoseRoom("-1002625127458"), true);
  assert.strictEqual(rooms.isRoseRoom(-1002625127458), true);
  assert.strictEqual(rooms.isRoseRoom("-1003938497778"), false);
  assert.strictEqual(rooms.isRoseRoom(null), false);
  assert.strictEqual(rooms.isRoseRoom(undefined), false);
});
t("a sendMessage to the OnlyRose room is refused by default", () => assert.ok(rooms.refusal(ROSE, "sendMessage")));
t("sendPhoto / sendDocument / sendAnimation / editMessageText / pinChatMessage to the room are refused", () => {
  for (const m of ["sendPhoto", "sendDocument", "sendAnimation", "sendVideo", "editMessageText", "editMessageCaption", "pinChatMessage"]) assert.ok(rooms.refusal(ROSE, m), m);
});
t("deleteMessage and answerCallbackQuery in the room are allowed (they post nothing)", () => {
  assert.strictEqual(rooms.refusal(ROSE, "deleteMessage"), null);
  assert.strictEqual(rooms.refusal(ROSE, "answerCallbackQuery"), null);
});
t("the explicit allow lets a send through", () => assert.strictEqual(rooms.refusal(ROSE, "sendMessage", { roseRoomOk: true }), null));
t("a truthy-but-not-true allow does not count", () => assert.ok(rooms.refusal(ROSE, "sendMessage", { roseRoomOk: 1 })));
t("any other chat is never refused", () => {
  assert.strictEqual(rooms.refusal("-1003938497778", "sendMessage"), null);
  assert.strictEqual(rooms.refusal(process.env.TELEGRAM_CHAT_ID || "12345", "sendPhoto"), null);
});

// ── Wiring: every sender consults the policy ──────────────────────────────────────────────────
const ROOT = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const vault = fs.readFileSync(path.join(ROOT, "lib", "whirlpool-vault.js"), "utf8");
const swap = fs.readFileSync(path.join(ROOT, "lib", "swap-desk.js"), "utf8");

t("server.js tgApi refuses through the policy before any fetch", () => {
  const i = server.indexOf("async function tgApi(");
  const body = server.slice(i, server.indexOf("\n}\n", i));
  const iRef = body.indexOf("tgRooms.refusal(");
  const iFetch = body.indexOf("fetch(");
  assert.ok(iRef >= 0, "tgApi consults tgRooms.refusal");
  assert.ok(iFetch > iRef, "the refusal check comes before the fetch");
});
t("the ROSE bot's own send path is the one that passes roseRoomOk", () => {
  assert.ok(/async function roseTgSend\([\s\S]*?roseRoomOk: true/.test(server), "roseTgSend passes the allow");
  assert.ok(/async function roseTgSendPhoto\([\s\S]*?roseRoomOk: true/.test(server), "roseTgSendPhoto passes the allow");
});
t("the hand-rolled senders in /api/tg-test and the meme uploaders consult the policy", () => {
  const i = server.indexOf("async function tgTestQuerySend(");
  assert.ok(server.slice(i, i + 6000).includes("tgRooms.refusal("), "tg-test query path");
  const j = server.indexOf("async function tgTestRawUpload(");
  assert.ok(server.slice(j, j + 2500).includes("tgRooms.refusal("), "tg-test raw upload");
  const k = server.indexOf("async function tgUploadPhotoFromUrl(");
  assert.ok(server.slice(k, k + 1200).includes("tgRooms.refusal("), "meme photo upload");
  const l = server.indexOf("async function tgUploadAnimationFromBuffer(");
  assert.ok(server.slice(l, l + 1200).includes("tgRooms.refusal("), "meme gif upload");
});
t("lib/whirlpool-vault.js and lib/swap-desk.js direct senders consult the policy", () => {
  assert.ok(vault.includes('require("./telegram-rooms")') && vault.includes("refusal("), "vault notify");
  assert.ok(swap.includes('require("./telegram-rooms")') && swap.includes("refusal("), "swap-desk notify");
});
t("no other direct Telegram send survives outside tgApi / the audited sites", () => {
  // Every `api.telegram.org/bot…/send*` fetch in server.js must sit inside one of the audited
  // functions; a new one anywhere else fails this test until it is routed through tgApi.
  const audited = ["async function tgApi(", "async function tgUploadPhotoFromUrl(", "async function tgUploadAnimationFromBuffer(", "async function tgTestQuerySend(", "async function tgTestRawUpload("];
  const spans = audited.map((sig) => { const i = server.indexOf(sig); return [i, server.indexOf("\n}\n", i)]; });
  const re = /api\.telegram\.org\/bot[^`]*\/(send[A-Za-z]+|editMessage[A-Za-z]*|pinChatMessage)/g;
  let m, stray = [];
  while ((m = re.exec(server))) { if (!spans.some(([a, b]) => m.index > a && m.index < b)) stray.push(server.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")); }
  assert.deepStrictEqual(stray, [], "stray direct sends: " + stray.join(" || "));
});

console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
