// The Airdropper's receipt sign-in token, per wallet, 23h (the server issues 24h). localStorage so
// a drop resumed after the OS backgrounded the app does not prompt again mid-run.
//
// In its own module (moved out of tools/Airdropper.jsx, 2026-09-29) because a second place now
// needs to FORGET it: the Checkup's "Disconnect & clean up" card, whose whole promise is that
// this device holds nothing for the wallet afterwards. A card that cleared the tools pass and
// left this token behind would be saying something untrue, and importing the Airdropper pane to
// reach one helper is the wrong shape. Same key, same three functions, same behaviour.
export const RECEIPT_SESSION_KEY = "clkn_seeker_receipt_session";

export function readReceiptSession(address) {
  try { const d = JSON.parse(localStorage.getItem(RECEIPT_SESSION_KEY) || "null"); return d && d.wallet === address && d.exp > Date.now() && d.pass ? d.pass : null; } catch (_) { return null; }
}
export function writeReceiptSession(address, pass) {
  try { localStorage.setItem(RECEIPT_SESSION_KEY, JSON.stringify({ wallet: address, pass, exp: Date.now() + 23 * 3600e3 })); } catch (_) {}
}
// `address` null/undefined forgets whatever is stored, whoever it belongs to.
export function forgetReceiptSession(address) {
  try { const d = JSON.parse(localStorage.getItem(RECEIPT_SESSION_KEY) || "null"); if (!d || !address || d.wallet === address) localStorage.removeItem(RECEIPT_SESSION_KEY); } catch (_) {}
}
