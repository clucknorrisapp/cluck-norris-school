#!/usr/bin/env node
"use strict";
// kv.setVerified — the only kv write a money path may trust (second reviewer, 2026-09-15).
// set() swallows the persist error, get() answers from memory, isPersistent() only says the
// directory existed at boot. So the "set, read it back, check isPersistent()" pattern passed with
// the volume broken, and a payout journal row could be reported recorded while living only in
// RAM — one restart from being paid again. This reproduces that with a broken write target and
// asserts setVerified is the one call that tells the truth.
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kv-verified-"));
process.env.DATA_DIR = DIR;
const kv = require("../lib/kvstore");
const FILE = path.join(DIR, "app-state.json");
const onDisk = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (_) { return null; } };

console.log("\nkv store — disk-verified writes\n");

ok("a normal write is verified on disk", kv.setVerified("a", { x: 1 }) === true && onDisk() && onDisk().a.x === 1);
ok("lastPersistError is null after a write that landed", kv.lastPersistError() === null);

// Break the target: a DIRECTORY where the file should be, so the atomic rename fails. Works for
// root and non-root alike (chmod tricks do not stop root).
fs.rmSync(FILE);
fs.mkdirSync(FILE);
const r = kv.setVerified("b", { y: 2 });
ok("a write that cannot reach the volume returns false", r === false);
ok("…while the plain in-memory read STILL returns it (the trap: a read-back proves nothing)", !!kv.get("b") && kv.get("b").y === 2);
ok("…and isPersistent() STILL says true (the other half of the trap)", kv.isPersistent() === true);
ok("lastPersistError names the failure", /EISDIR|ENOTEMPTY|EEXIST|EPERM|EACCES|rename|directory/i.test(String(kv.lastPersistError() || "")), String(kv.lastPersistError()));
ok("the value is genuinely NOT on disk", onDisk() === null);

// Volume back: the next verified write lands and carries the key that was only in memory.
fs.rmdirSync(FILE);
ok("after the volume is back, the next verified write lands and includes the earlier key", kv.setVerified("c", 3) === true && onDisk().b.y === 2 && onDisk().c === 3);
ok("lastPersistError clears again", kv.lastPersistError() === null);

// The plain set() path is unchanged for everything that is not money: it still never throws.
let threw = false;
fs.rmSync(FILE); fs.mkdirSync(FILE);
try { kv.set("z", 1); } catch (_) { threw = true; }
ok("plain set() still swallows a failed persist (non-money callers are unchanged)", threw === false && kv.get("z") === 1);
fs.rmdirSync(FILE);

// Codex 2026-09-17 finding 1: the two money keys of a payout journal must land in ONE persist.
console.log("\nsetManyVerified — several keys, one persist\n");
ok("two keys land together and both verify on disk", kv.setManyVerified({ m1: { a: 1 }, m2: [1, 2] }) === true && onDisk().m1.a === 1 && onDisk().m2.length === 2);
fs.rmSync(FILE); fs.mkdirSync(FILE);
ok("with the volume broken neither key is reported as landed", kv.setManyVerified({ m3: 1, m4: 2 }) === false && onDisk() === null);
fs.rmdirSync(FILE);
ok("after recovery the next many-write carries the earlier keys", kv.setManyVerified({ m5: 5 }) === true && onDisk().m3 === 1 && onDisk().m5 === 5);

// Deep dive 2026-09-17 P0-005: a file that EXISTS but does not parse used to boot as a healthy,
// persistent, EMPTY store — the next set() overwrote the only copy of every ledger. It must boot
// in-memory, preserve the file, and make setVerified refuse. Fresh process: the store is a singleton.
console.log("\ncorrupt app-state.json at boot\n");
const { execFileSync } = require("child_process");
const CDIR = fs.mkdtempSync(path.join(os.tmpdir(), "kv-corrupt-"));
fs.writeFileSync(path.join(CDIR, "app-state.json"), '{"ledger":{"a":1}, TRUNCATED');
let boot = null;
try {
  const raw = execFileSync(process.execPath, ["-e", `
    const kv = require(${JSON.stringify(path.join(__dirname, "..", "lib", "kvstore.js"))});
    const verified = kv.setVerified("k", 1);
    console.log(JSON.stringify({ persistent: kv.isPersistent(), loadError: kv.loadError(), verified, mem: kv.get("k") }));
  `], { env: { ...process.env, DATA_DIR: CDIR }, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").pop();
  boot = JSON.parse(raw);
} catch (e) { boot = { error: String(e && e.message || e) }; }
ok("a corrupt file boots the store NOT persistent", boot && boot.persistent === false, JSON.stringify(boot));
ok("loadError names the file and the reason", boot && /not valid JSON/.test(String(boot.loadError || "")), String(boot && boot.loadError));
ok("setVerified refuses while in-memory (a money path stops)", boot && boot.verified === false && boot.mem === 1);
const kept = fs.readdirSync(CDIR).filter((f) => /^app-state\.json\.corrupt-/.test(f));
ok("the corrupt file is preserved under a dated name", kept.length === 1 && fs.readFileSync(path.join(CDIR, kept[0]), "utf8").includes("TRUNCATED"), kept.join(","));
ok("the original is NOT overwritten by a blank store", fs.readFileSync(path.join(CDIR, "app-state.json"), "utf8").includes("TRUNCATED"));
try { fs.rmSync(CDIR, { recursive: true, force: true }); } catch (_) {}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
