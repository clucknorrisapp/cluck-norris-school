// Normie Quest — playtester feedback store (test dashboard backend).
//
// Self-contained: no imports from the Cluck Norris app (copy patterns, don't couple).
// Durable JSON on the Railway volume (DATA_DIR), same pattern as the burn replay-guard.
// Testers POST comments from the ?test=1 build; the owner reads them from a gated dashboard.
// Nothing here touches funds, secrets, or the live game — it only appends/reads a comment list.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-feedback.json');
const MAX = 2000;   // keep the last N comments; a hard cap so the file can't grow unbounded

function load() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }   // first run: no file yet
}
function save(arr) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}

function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }

// Append one comment. Returns {ok} / {ok:false,status}. Never throws.
function add(o) {
  o = o || {};
  const text = clip(o.text, 2000).trim();
  if (!text) return { ok: false, status: 'empty' };
  const e = {
    id: Math.random().toString(36).slice(2, 10),
    name: clip(o.name, 60).trim() || 'anon',
    level: clip(o.level, 24).trim(),
    kind: clip(o.kind, 16).trim(),          // 'bug' | 'idea' | 'note' (free-form; UI sets it)
    text,
    ua: clip(o.ua, 200),
    at: Date.now(),
  };
  let arr = load();
  arr.push(e);
  if (arr.length > MAX) arr = arr.slice(-MAX);
  if (!save(arr)) return { ok: false, status: 'persist_failed' };
  return { ok: true, id: e.id };
}

function list() { return load(); }
function count() { return load().length; }

module.exports = { add, list, count };
