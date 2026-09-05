#!/usr/bin/env node
/**
 * The AI tutor's free daily allowance was only ever enforced in the BROWSER.
 *
 * AskCluck (src/shared.jsx) counts questions in localStorage against DAILY_LIMIT = 10. Clearing
 * site data resets it, and the server never knew — so the real ceiling was the per-minute cap,
 * which permits ~21,600 billed Anthropic calls per IP per day on an endpoint that is free by
 * design and has no wallet gate in front of it.
 *
 * Boots the real server and talks to it over HTTP, because the thing under test is middleware
 * ordering as much as arithmetic: the cap has to fire BEFORE the handler spends a paid API call.
 *
 * Usage: node scripts/ai-daily-cap-test.cjs
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const PORT = 3877;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clkn-aicap-'));

const ask = (body) => fetch(`${BASE}/api/ask-cluck`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || { question: 'what is impermanent loss?' }),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, ASK_CLUCK_DAILY: '3',
           // no ANTHROPIC_API_KEY: the handler will fail, which is fine — the cap must fire in
           // FRONT of it, and that is exactly what this proves.
           ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  const done = () => { try { srv.kill('SIGKILL'); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} };
  process.on('exit', done);

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { up = true; break; } } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) { console.error('  server did not come up'); done(); process.exit(1); }

  console.log('\nAI tutor daily cap (server-side)\n');

  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(await ask());
  ok('the first three questions are not blocked by the daily cap',
     seen.every((r) => r.status !== 429), JSON.stringify(seen.map((r) => r.status)));

  const blocked = await ask();
  ok('the fourth is refused once the daily cap is reached', blocked.status === 429,
     'status ' + blocked.status + ' ' + JSON.stringify(blocked.json));
  ok('and it says WHY, in the school\'s own terms, not "slow down"',
     /free question limit/i.test(String(blocked.json.error || '')), String(blocked.json.error));
  ok('the response carries how long to wait', Number(blocked.json.retryAfterSec) > 3600,
     'retryAfterSec=' + blocked.json.retryAfterSec);

  // The cap must sit IN FRONT of the handler — a 429 that arrives after the paid call has been
  // made saves nothing. With no API key the handler cannot return 429, so a 429 here can only
  // have come from the middleware.
  ok('the cap fires in front of the handler, before any paid call',
     blocked.status === 429 && blocked.json.success === false);

  // ...and it must NOT leak onto other endpoints.
  const health = await fetch(`${BASE}/healthz`).then((r) => r.status);
  ok('unrelated endpoints are unaffected', health === 200, 'healthz ' + health);

  done();
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
