#!/usr/bin/env node
/**
 * CUNA giveaway — the room leaderboard is POSTED, never GET.
 *
 * /api/tg-test has been POST-only since 2026-09-17 (#335): every form of it sends, so the whole GET
 * method answers 405. lib/cuna-giveaway.js's postBoard() — the 15-minute room leaderboard the owner
 * asked for — kept sending a GET, so every refresh since then answered 405 → `send_failed` on the
 * 5-minute tick, silently. The previous promo had already closed, so nothing showed it until the
 * 2026-09-22 birthday special opened with a board that never appeared.
 *
 * Dependency-free: a stub of the tg-test route (405 on GET, success on POST — exactly production's
 * behaviour) and the real module against a temp DATA_DIR.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cuna-board-'));
process.env.DATA_DIR = DIR;
const g = require('../lib/cuna-giveaway');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
};

(async () => {
  console.log('\nCUNA giveaway — the board post is a POST to /api/tg-test\n');
  const seen = [];
  let nextId = 4242;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), key: req.headers['x-premium-key'] || null });
    res.setHeader('content-type', 'application/json');
    if (u.pathname !== '/api/tg-test') { res.statusCode = 404; return res.end(JSON.stringify({ success: false, error: 'not_found' })); }
    // Production since #335: the whole GET method is refused.
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ success: false, error: 'method_not_allowed', detail: 'POST only' })); }
    const id = nextId++;
    res.end(JSON.stringify({ success: true, messageId: id, pinned: u.searchParams.get('pin') === '1', replaced: u.searchParams.get('replaceMsg') || null }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  try {
    g.configure({ mint: 'MintMintMintMintMintMintMintMintMintMintMint', pool: 'PoolPoolPoolPoolPoolPoolPoolPoolPoolPoolPool', symbol: 'CUNA',
      chatId: '-1001', startMs: Date.now() - 60000, endMs: Date.now() + 3600000, minUsd: 2.8, displayUsd: 3, mode: 'giveaway' });

    const first = await g.postBoard({ base, premiumKey: 'test-key' });
    ok('postBoard succeeds against a POST-only tg-test', first.ok === true && first.messageId === 4242, first);
    ok('… and it was a POST', seen.length === 1 && seen[0].method === 'POST', seen);
    ok('… to /api/tg-test with the chat, the board text, pin=1 and the key in the header (never the query)',
       seen[0].path === '/api/tg-test' && seen[0].q.chat === '-1001' && /CUNA GIVEAWAY/.test(seen[0].q.text || '') && seen[0].q.pin === '1'
       && seen[0].key === 'test-key' && !('key' in seen[0].q), seen[0]);
    ok('the new board id is remembered so the next drop can replace it', g.boardMsgId() === 4242, g.boardMsgId());

    const second = await g.postBoard({ base, premiumKey: 'test-key' });
    ok('the second drop replaces the first (replaceMsg = previous id) and remembers the new id',
       second.ok === true && second.replaced === 4242 && seen[1].q.replaceMsg === '4242' && g.boardMsgId() === 4243, { second, q: seen[1].q });

    // The regression shape, so the test fails loudly if anyone puts the GET back: a stub that
    // answers success to a GET would hide it; this one answers what production answers.
    ok('a GET to the stub is what production does — 405, success:false', await (async () => {
      const r = await fetch(base + '/api/tg-test?chat=-1001&text=x');
      const j = await r.json();
      return r.status === 405 && j.success === false;
    })());
  } finally {
    srv.close();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
