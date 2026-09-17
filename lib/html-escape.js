"use strict";
// The one HTML escaper for Node-side rendering. Three byte-identical copies lived in server.js,
// lib/learn-pages.js and lib/cuna-announce.js (simplifier pass, 2026-09-17); the browser-side twin
// is CluckUtil.esc in public/cluck-util.js. All five characters — the single quote is the one a
// hand-rolled copy forgets, and that copy is what an attacker-named token exploits.
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
module.exports = { escHtml };
