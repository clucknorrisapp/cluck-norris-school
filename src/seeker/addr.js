// Cluck Norris — Seeker app, tiny address-formatting helper.
// Shared by App.jsx (wallet status pill) and RentReclaim.jsx (per-account mint/account labels) so
// there is exactly one shortening rule in this app, not two that could drift (CLAUDE.md).
export function shortAddr(address) {
  try {
    if (typeof window !== "undefined" && window.CluckUtil && typeof window.CluckUtil.shortAddr === "function") {
      return window.CluckUtil.shortAddr(address);
    }
  } catch (_) {}
  const a = String(address || "");
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
