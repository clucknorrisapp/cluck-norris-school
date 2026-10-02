// Pure: which rows of a fresh Firepit scan are a lagging RPC node's view of something this
// session already closed or withdrew. Shared by src/seeker/tools/Firepit.jsx; public/firepit.html
// carries the same rule in plain JS. scripts/firepit-recent-test.cjs pins it.
//
// Accounts this session WATCHED close (and surpluses it watched withdraw). An RPC node can lag a
// few seconds behind the confirmation we saw, so a Rescan in that window must not bring a closed
// account back or re-offer a surplus already taken (owner report 2026-10-02: "after you burn a
// token, Rescan doesn't actually rescan — you have to disconnect and reconnect").
// A row is hidden ONLY when it is provably that lag (Codex review of #471): the scan is not known
// to be newer than our transaction (its slot is below the slot read once the tx confirmed, or
// either slot is unknown) AND the row is exactly the state we acted on — same amount and same
// lamports. A recreated account, a new deposit, or any scan read after our transaction is always
// shown. Same rule as public/firepit.html. The two-minute window only bounds how long a record lives.
export const RECENT_MS = 120000;
const scanIsAfter = (e, scanSlot) => typeof scanSlot === "number" && typeof e.slot === "number" && scanSlot >= e.slot;
export function applyRecent(list, recent, scanSlot) {
  const now = Date.now();
  return (list || []).filter((a) => {
    const c = recent.closed[a.tokenAccount];
    if (!c) return true;
    if (now - c.at >= RECENT_MS) { delete recent.closed[a.tokenAccount]; return true; }
    if (scanIsAfter(c, scanSlot)) return true;   // this read already reflects our tx; a later, slower node may not, so the record stays
    return !(String(a.amountRaw) === String(c.amountRaw) && Number(a.rentLamports) === c.lamports);
  }).map((a) => {
    const w = recent.withdrawn[a.tokenAccount];
    if (!w) return a;
    if (now - w.at >= RECENT_MS) { delete recent.withdrawn[a.tokenAccount]; return a; }
    if (scanIsAfter(w, scanSlot)) return a;
    if (Number(a.rentLamports) === w.prior) return { ...a, surplusLamports: 0, surplusEligible: false };
    return a;
  });
}
