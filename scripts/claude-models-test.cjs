#!/usr/bin/env node
/**
 * The app's own Sonnet calls (server.js) must stay valid for the model they name.
 *
 * Claude Sonnet 5.5 rejects `thinking: {type:"disabled"}` with a 400, so every claude-sonnet-5-5
 * call carries `thinking: {type:"between_tools"}` (the no-thinking setting, which is only accepted
 * at effort `high` or below and with no other field inside `thinking`) and an explicit effort.
 * A route that read `data.content[0].text` would also break the day a `thinking` block comes
 * first, so the response is read by block type. Source-level: a live call needs a real key.
 */
const fs = require('fs');
const path = require('path');
let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const bodies = server.split('\n').filter((l) => /model: "claude-sonnet-5(-5)?"/.test(l));

console.log('\nSonnet call sites in server.js\n');
ok('there are Sonnet call sites to check', bodies.length >= 5, 'found ' + bodies.length);
ok('none still names the retired claude-sonnet-5', !bodies.some((l) => /model: "claude-sonnet-5"/.test(l)), bodies.filter((l) => /model: "claude-sonnet-5"/.test(l)).join('\n      '));
ok('none sends thinking:disabled (a 400 on Sonnet 5.5)', !bodies.some((l) => /thinking: \{ type: "disabled" \}/.test(l)));
ok('every one sends thinking between_tools', bodies.every((l) => /thinking: \{ type: "between_tools" \}/.test(l)));
ok('every one sets an explicit effort no higher than high', bodies.every((l) => /output_config: \{ effort: "(low|medium|high)" \}/.test(l)));
ok('none forces a tool (forced tool_choice is a 400)', !bodies.some((l) => /tool_choice/.test(l)));
ok('none sends sampling params (rejected)', !bodies.some((l) => /temperature|top_p|top_k/.test(l)));

console.log('\nResponse handling\n');
ok('claudeText() reads the first text block by type', /function claudeText\(data\)[\s\S]{0,300}x\.type === "text"/.test(server));
// Each Sonnet call site is followed by its response handling; none may index content[0].
const idx = [];
server.split('\n').forEach((l, i) => { if (/model: "claude-sonnet-5-5"/.test(l)) idx.push(i); });
const lines = server.split('\n');
const positional = idx.filter((i) => /data\.content\[0\]/.test(lines.slice(i, i + 12).join('\n')));
ok('no Sonnet site reads data.content[0] any more', positional.length === 0, 'still positional after line(s): ' + positional.map((i) => i + 1).join(', '));

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
process.exit(failures ? 1 : 0);
