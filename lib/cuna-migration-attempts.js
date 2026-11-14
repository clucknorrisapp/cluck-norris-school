"use strict";
// CUNA -> CLKN migration: the APPEND-ONLY attempt log. One file per payout attempt, created with
// O_EXCL ('wx'), written, fsynced, closed — and never rewritten or deleted.
//
// Why a file and not only the kv journal: the kv store rewrites ONE whole JSON blob per write, and a
// process holding a stale copy can erase another process's keys (lib/kvstore.js header). For a payout
// that would be the worst possible loss — the record that a signed transfer exists. A file created
// with O_EXCL is (a) a real cross-process compare-and-swap: two instances cannot both own attempt n
// of a key, and (b) a copy of the signed transaction that no stale blob write can erase. The monitor
// adopts any attempt file its journal does not list and treats it as live until the chain proves it
// landed or died.
//
// File name: sha256(key).slice(0,32) + "." + n + ".json" — the key is an incoming signature or
// "day0:<wallet>", both safe to hash, neither safe to use raw as a path.
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

function hashKey(key) { return createHash("sha256").update(String(key)).digest("hex").slice(0, 32); }

function createAttemptStore(dir) {
  function ensure() { fs.mkdirSync(dir, { recursive: true }); }
  function fileFor(key, n) { return path.join(dir, `${hashKey(key)}.${Number(n)}.json`); }

  // Returns {ok:true} when this caller now owns attempt n of key, {exists:true} when someone else
  // already does, {ok:false, error} when the file could not be created/written (the caller must not
  // send). A write that fails after the create leaves a partial file, which list() reports as
  // partial — by the caller's ordering it was never broadcast.
  function claim(key, n, record) {
    ensure();
    const p = fileFor(key, n);
    let fd;
    try { fd = fs.openSync(p, "wx"); }
    catch (e) { if (e && e.code === "EEXIST") return { exists: true }; return { ok: false, error: String(e && e.message || e) }; }
    try {
      fs.writeSync(fd, JSON.stringify({ ...record, key: String(key), n: Number(n) }));
      fs.fsyncSync(fd);
    } catch (e) {
      try { fs.closeSync(fd); } catch (_) {}
      return { ok: false, error: String(e && e.message || e) };
    }
    fs.closeSync(fd);
    try { const dfd = fs.openSync(dir, "r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch (_) { /* directory fsync is best-effort */ }
    return { ok: true };
  }

  function readOne(name) {
    const m = /^([0-9a-f]{32})\.(\d+)\.json$/.exec(name);
    if (!m) return null;
    const full = path.join(dir, name);
    let mtime = 0;
    try { mtime = Math.floor(fs.statSync(full).mtimeMs / 1000); } catch (_) {}
    try {
      const o = JSON.parse(fs.readFileSync(full, "utf8"));
      if (o && typeof o === "object" && Number(o.n) === Number(m[2]) && hashKey(o.key) === m[1]) return { ...o, hash: m[1], mtime };
    } catch (_) { /* fall through: torn or empty */ }
    return { hash: m[1], n: Number(m[2]), partial: true, mtime };
  }

  function list() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    return names.map(readOne).filter(Boolean);
  }
  function forKey(key) {
    const h = hashKey(key);
    return list().filter((r) => r.hash === h);
  }
  return { claim, list, forKey, hashKey, dir };
}

module.exports = { createAttemptStore, hashKey };
