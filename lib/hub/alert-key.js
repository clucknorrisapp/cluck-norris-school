"use strict";
// N-1 (Round 4, docs/HUB_JOURNAL_VERIFY_2026-09-18.md): a stable dedupe key for the Hub's operator-
// room alerts, pulled out as its own pure module so it can be unit tested directly rather than only
// as a shape assertion against server.js.
//
// The bug: server.js's hubAlert used `"hub:" + String(message).slice(0, 40)` as the 6-hour dedupe
// key for EVERY alert, including the three payout-summary alerts (`sent`/`sweep`/`send` in
// lib/hub/routes.js), whose messages are shaped `<projectId>: batch <batchId> — …`. A project id
// can be up to 32 characters (lib/hub/store.js ID_RE); once `len(projectId) > ~19` the batch id no
// longer fits in the 40-character slice, so every batch's summary — a different batch, a different
// fraud event — collapsed onto the SAME key and only the first reached the operator room in any
// 6-hour window.
//
// The fix: when the caller supplies `meta = { projectId, batchId, kind }` (kind is "sent" / "sweep"
// / "send" — the three payout-summary alert kinds), the key is a hash of that triple, so it can
// never collapse across batches or projects, however long the id. Every OTHER hubAlert call (no
// meta) keeps the exact old 40-char-of-text shape — this only tightens the payout summaries.
const crypto = require("crypto");

function hubAlertKey(message, meta) {
  if (meta && meta.projectId && meta.batchId && meta.kind) {
    const h = crypto.createHash("sha256").update(`${meta.projectId}|${meta.batchId}|${meta.kind}`).digest("hex");
    return "hub:" + h.slice(0, 16);
  }
  return "hub:" + String(message == null ? "" : message).slice(0, 40);
}

module.exports = { hubAlertKey };
