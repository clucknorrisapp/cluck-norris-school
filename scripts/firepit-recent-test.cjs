#!/usr/bin/env node
// Pins the Firepit "recently closed / withdrawn" rule (src/seeker/tools/firepit-recent.js, and the
// same rule in public/firepit.html): a Rescan may hide a row ONLY when it is provably a lagging
// node's view of what this session just closed or withdrew. Codex review of #471: address + elapsed
// time alone hid a recreated-and-funded account and a genuine new surplus deposit.
// The website copy is exercised in a real page by scripts/firepit-surplus-test.cjs; this file also
// runs the website's applyRecent() source in a sandbox so the two copies can't drift apart.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
const ok = (name, cond, extra) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : "  — " + JSON.stringify(extra)}`); if (!cond) failures++; };

const ACC = "Acct1111111111111111111111111111111111111111";
const row = (o) => Object.assign({ tokenAccount: ACC, amountRaw: "1000000", rentLamports: 2039280, surplusLamports: 0, surplusEligible: false }, o);

// One adapter per copy: closed(entry) / withdrawn(entry) seed the record, run(list, slot) applies it.
function appCopy(applyRecent) {
  let recent;
  return {
    reset() { recent = { closed: {}, withdrawn: {} }; },
    closed(e) { recent.closed[ACC] = e; },
    withdrawn(e) { recent.withdrawn[ACC] = { at: e.at, prior: e.prior, slot: e.slot }; },
    run(list, slot) { return applyRecent(list, recent, slot); },
  };
}
function webCopy() {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "firepit.html"), "utf8");
  const start = html.indexOf("var RECENT_MS = 120000;");
  const end = html.indexOf("async function scan(){");
  if (start < 0 || end < 0) throw new Error("could not find applyRecent in public/firepit.html");
  const ctx = { rpc: () => Promise.resolve(null) };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return {
    reset() { for (const k of Object.keys(ctx.recentlyClosed)) delete ctx.recentlyClosed[k]; for (const k of Object.keys(ctx.recentlyWithdrawn)) delete ctx.recentlyWithdrawn[k]; },
    closed(e) { ctx.recentlyClosed[ACC] = { at: e.at, amountRaw: e.amountRaw, lamports: e.lamports, slot: e.slot }; },
    withdrawn(e) { ctx.recentlyWithdrawn[ACC] = { at: e.at, priorLamports: e.prior, slot: e.slot }; },
    run(list, slot) { return ctx.applyRecent(list, slot); },
  };
}

function suite(label, c) {
  console.log(`\n${label}`);
  const now = Date.now();
  const closedSnap = { at: now, amountRaw: "1000000", lamports: 2039280, slot: 500 };

  c.reset(); c.closed(closedSnap);
  ok("a lagging scan (slot below ours) showing the exact pre-close state is hidden", c.run([row()], 400).length === 0);
  c.reset(); c.closed({ ...closedSnap, slot: null });
  ok("…and with no slot known at all, the exact pre-close state is still hidden", c.run([row()], undefined).length === 0);

  c.reset(); c.closed(closedSnap);
  ok("Codex: the same ATA recreated and funded (different amount) is SHOWN, even on a lagging slot", c.run([row({ amountRaw: "5000000" })], 400).length === 1);
  c.reset(); c.closed(closedSnap);
  ok("a recreated account with different lamports is shown", c.run([row({ rentLamports: 2100000 })], 400).length === 1);
  c.reset(); c.closed(closedSnap);
  ok("a scan answered at or after our slot is trusted even when it matches exactly", c.run([row()], 500).length === 1);
  ok("…and a slower node answering AFTER that fresh read is still recognised as lagging", c.run([row()], 400).length === 0);
  c.reset(); c.closed({ ...closedSnap, at: now - 121000 });
  ok("after two minutes the record lapses and the row is shown", c.run([row()], 400).length === 1);
  c.reset(); c.closed(closedSnap);
  ok("other accounts are never touched", c.run([row({ tokenAccount: "Other111111111111111111111111111111111111111" })], 400).length === 1);

  const prior = 1855569;
  c.reset(); c.withdrawn({ at: now, prior, slot: 500 });
  let out = c.run([row({ rentLamports: prior, surplusLamports: 367129, surplusEligible: true })], 400);
  ok("a lagging scan still showing the pre-withdraw lamports does not re-offer the surplus", out.length === 1 && out[0].surplusEligible === false && out[0].surplusLamports === 0);
  c.reset(); c.withdrawn({ at: now, prior, slot: 500 });
  out = c.run([row({ rentLamports: prior + 50000, surplusLamports: 417129, surplusEligible: true })], 400);
  ok("Codex: a genuine new deposit (lamports above the prior balance) IS offered, even on a lagging slot", out[0].surplusEligible === true && out[0].surplusLamports === 417129);
  c.reset(); c.withdrawn({ at: now, prior, slot: 500 });
  out = c.run([row({ rentLamports: prior, surplusLamports: 367129, surplusEligible: true })], 600);
  ok("a scan newer than our withdrawal is trusted, even at the same lamports", out[0].surplusEligible === true);
  c.reset(); c.withdrawn({ at: now, prior, slot: 500 });
  out = c.run([row({ rentLamports: 1488440, surplusLamports: 0, surplusEligible: false })], 400);
  ok("the post-withdraw state passes through unchanged", out[0].rentLamports === 1488440);
}

(async () => {
  const mod = await import(path.join(__dirname, "..", "src", "seeker", "tools", "firepit-recent.js"));
  console.log("\nFirepit — what a Rescan may hide");
  suite("app (src/seeker/tools/firepit-recent.js)", appCopy(mod.applyRecent));
  suite("website (public/firepit.html)", webCopy());
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
