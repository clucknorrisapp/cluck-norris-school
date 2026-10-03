#!/usr/bin/env node
"use strict";
// The tools-pass terms schedule is APPEND-ONLY (lib/tool-pass-terms.js): a payment resolves to the
// entry in force at its block time, so editing an old entry would move passes already bought.
// Pins: ascending `from`, the 2026-08-18 launch entry untouched, the SKR term appended (never
// edited into the old one), and that a payment from before it resolves to a term WITHOUT `skr`.
const T = require("../lib/tool-pass-terms");
let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail !== undefined ? "\n      " + JSON.stringify(detail) : "")); } };

ok("entries are ascending by `from`", T.SCHEDULE.every((e, i) => i === 0 || e.from > T.SCHEDULE[i - 1].from));
const launch = T.SCHEDULE[0];
ok("the 2026-08-18 launch entry is intact: 0.05 SOL → 7 days, no SKR term", launch.from === Date.UTC(2026, 7, 18) && launch.days === 7 && launch.lamports === 50_000_000 && launch.skr === undefined, launch);
const cur = T.current(Date.UTC(2026, 9, 4));
ok("the current entry carries the SKR term ($1) and the SAME SOL terms", cur.skr && cur.skr.usd === 1 && cur.days === 7 && cur.lamports === 50_000_000, cur);
ok("a payment from before the SKR entry resolves to a term with no `skr`", T.termsAt(Date.UTC(2026, 9, 2)).skr === undefined && T.termsAt(Date.UTC(2026, 9, 2)) === launch);
ok("entries are frozen (nothing can mutate a past term)", Object.isFrozen(cur) && Object.isFrozen(cur.skr) && Object.isFrozen(launch));
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
