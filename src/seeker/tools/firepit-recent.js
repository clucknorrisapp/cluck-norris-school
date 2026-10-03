// Which rows of a fresh Firepit scan are a lagging RPC node's view of something this session
// already closed or withdrew. Used by src/seeker/tools/Firepit.jsx; public/firepit.html carries
// the same rule in plain JS. scripts/firepit-recent-test.cjs runs both copies against the same
// cases.
//
// Why: an RPC node can lag a few seconds behind the confirmation we saw, so a Rescan right after a
// burn/reclaim showed the closed accounts again (owner report 2026-10-02: "Rescan doesn't actually
// rescan — you have to disconnect and reconnect").
//
// The rule (Codex review of #473 — elapsed time, a separate getSlot, or a scan-wide slot are not
// proof of anything about ONE account):
//   1. Only a row that is EXACTLY the state we acted on is a suspect: for a close, the same amount
//      and lamports; for a withdrawal, the same lamports as before it. Any other row is new chain
//      state and passes untouched.
//   2. A suspect is checked against the chain itself: getMultipleAccounts with
//      minContextSlot = the slot our transaction LANDED in (getSignatureStatuses' own `slot`), so
//      the node that answers has provably processed it. Closed + absent → stale, hidden. Closed +
//      present → the account was recreated, shown. Withdrawn → the verified lamports replace the
//      row's, and its surplus shrinks by what really left.
//   3. No proof means no hiding: an unknown tx slot, or no node at that slot after a few tries,
//      leaves the row exactly as the scan returned it.
//   4. (Codex round 3) The proof must also be NO OLDER THAN THE SCAN it overrides. The scan carries
//      its own read slot (/api/burn-scan `slot`), and the proof read must satisfy
//      context.slot >= max(txSlot, scanSlot). Close at 100, recreate at 250, scan at 300: a lagging
//      proof node at 200 says "absent", which is true of 200 and says nothing about 300 — it must be
//      refused, not believed. An unknown scanSlot is no proof at all.
// The two-minute window only bounds how long a record lives.
export const RECENT_MS = 120000;
const TRIES = 3;

export function pruneRecent(recent, now) {
  for (const k of Object.keys(recent.closed)) if (now - recent.closed[k].at >= RECENT_MS) delete recent.closed[k];
  for (const k of Object.keys(recent.withdrawn)) if (now - recent.withdrawn[k].at >= RECENT_MS) delete recent.withdrawn[k];
}

function suspect(a, recent) {
  const c = recent.closed[a.tokenAccount];
  if (c && typeof c.txSlot === "number" && String(a.amountRaw) === String(c.amountRaw) && Number(a.rentLamports) === c.lamports) return { kind: "closed", txSlot: c.txSlot };
  const w = recent.withdrawn[a.tokenAccount];
  if (w && typeof w.txSlot === "number" && Number(a.rentLamports) === w.prior) return { kind: "withdrawn", txSlot: w.txSlot };
  return null;
}

export async function reconcileRecent(list, recent, rpc, opts) {
  const o = opts || {};
  const now = typeof o.now === "number" ? o.now : Date.now();
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rows = list || [];
  pruneRecent(recent, now);
  const sus = [];
  rows.forEach((a) => { const s = suspect(a, recent); if (s) sus.push({ a, ...s }); });
  if (!sus.length || typeof rpc !== "function") return rows;
  if (!Number.isSafeInteger(o.scanSlot) || o.scanSlot < 0) return rows;   // unknown scan slot → no proof → hide nothing
  const minSlot = Math.max(o.scanSlot, ...sus.map((x) => x.txSlot));
  let infos = null;
  for (let i = 0; i < TRIES && !infos; i++) {
    try {
      const r = await rpc("getMultipleAccounts", [sus.map((x) => x.a.tokenAccount), { commitment: "confirmed", minContextSlot: minSlot, encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      if (r && r.context && typeof r.context.slot === "number" && r.context.slot >= minSlot && Array.isArray(r.value) && r.value.length === sus.length) infos = r.value;
    } catch (_) { /* a node below minContextSlot answers with an error: try again */ }
    if (!infos && i < TRIES - 1) await sleep(800 * (i + 1));
  }
  if (!infos) return rows;   // no proof → no hiding
  const verdict = new Map();
  sus.forEach((x, i) => verdict.set(x.a.tokenAccount, { kind: x.kind, info: infos[i] }));
  const out = [];
  for (const a of rows) {
    const v = verdict.get(a.tokenAccount);
    if (!v) { out.push(a); continue; }
    if (v.info === null) continue;   // gone at a slot past our transaction: the scan row is stale
    if (v.kind === "closed") { out.push(a); continue; }   // exists past our close: recreated, genuine
    const live = Number(v.info.lamports);
    const was = Number(a.rentLamports) || 0;
    if (Number.isFinite(live) && live < was) {
      const surplus = Math.max(0, (Number(a.surplusLamports) || 0) - (was - live));
      out.push({ ...a, rentLamports: live, surplusLamports: surplus, surplusEligible: !!a.surplusEligible && surplus > 0 });
    } else out.push(a);
  }
  return out;
}
