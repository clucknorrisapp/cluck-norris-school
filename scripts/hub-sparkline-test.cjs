#!/usr/bin/env node
"use strict";
// P3-08 (docs/HUB_PUBLIC_SURFACES_VERIFY_2026-09-18.md): public/hub-sparkline.js's render() used
// to fall back to an identity "escaper" (`function (s) { return String(s); }`) when the caller
// passed no `opts.esc` — a shared renderer whose default is "do not escape" is one forgetful call
// site away from an SVG injection, even though both current callers (public/hub.html,
// public/hub-status.html) already pass CluckUtil.esc. Pure unit test: loads the plain-JS IIFE
// into a small vm sandbox (no browser needed — it only touches `window` as its global carrier)
// and calls HubSparkline.render() directly.
//
// Usage: node scripts/hub-sparkline-test.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name); else { failures++; console.log("  ✗ " + name + (detail ? "\n      " + detail : "")); } };

const SRC_PATH = path.join(__dirname, "..", "public", "hub-sparkline.js");
const src = fs.readFileSync(SRC_PATH, "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: SRC_PATH });
const HubSparkline = sandbox.window.HubSparkline;

console.log("\nHubSparkline.render() — P3-08: no identity-escaper fallback\n");

ok("public/hub-sparkline.js loads and exposes window.HubSparkline.render", !!HubSparkline && typeof HubSparkline.render === "function");
if (!HubSparkline) { console.log(`\n${failures} FAILED\n`); process.exit(1); }

const DAYS = [{ day: "2026-09-18", reproduced: 1, total: 1 }];

let threw = null;
try { HubSparkline.render(DAYS, {}); } catch (e) { threw = e; }
ok("render() with no opts.esc THROWS instead of silently not escaping", !!threw, threw && threw.message);
ok("...and the error names opts.esc so a caller knows what to fix", threw && /opts\.esc/.test(threw.message), threw && threw.message);

threw = null;
try { HubSparkline.render(DAYS); } catch (e) { threw = e; } // opts omitted entirely
ok("render() with opts omitted entirely also throws (opts.esc still missing)", !!threw);

threw = null;
try { HubSparkline.render(DAYS, { esc: "not a function" }); } catch (e) { threw = e; }
ok("render() with a non-function opts.esc also throws", !!threw);

let out = null, callCount = 0;
const realEsc = (s) => { callCount++; return String(s).replace(/</g, "&lt;"); };
try { out = HubSparkline.render(DAYS, { esc: realEsc }); } catch (e) { out = null; }
ok("render() with a real esc function works and returns an <svg>", !!out && /<svg/.test(out), out);
ok("...and esc was actually called (not bypassed)", callCount > 0);

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
