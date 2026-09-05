"use strict";
// Lock announcements for the CUNA community room (owner, 2026-09-05: "people should know when
// people lock and that those locks are now eligible for rewards").
//
// This is a PUBLIC post built from chain data, so three rules hold it:
//   1. Nothing free-form from the chain reaches the message. The escrow metadata name is
//      creator-set text and never appears; the wallet is a shortened address; amounts, dates and
//      the multiplier are numbers we computed. Escaped anyway, because the room renders HTML.
//   2. Only locks that QUALIFY are announced. A griefer can make a thousand dust locks for rent;
//      the dust floor keeps them out of the pool and this keeps them out of the room.
//   3. Capped per hour and deduplicated by escrow (the ledger remembers), so a burst of locks —
//      or a restart — cannot spam the room.
//
// Pure: hand it the new escrows and the locks, get back the messages. Posting is the caller's.

const DAY = 86400;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shortAddr(a) { const s = String(a || ""); return s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s; }
function whole(raw) { return (Number(BigInt(raw || 0) / 1000000000n)).toLocaleString("en-US"); }
function dateOf(unix) {
  const d = new Date(Number(unix) * 1000);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function monthsOf(days) { return Math.round(days / 30.4); }

// Which of the newly indexed escrows deserve a post, and the post for each.
function pickAnnouncements({ added, locks, cfg, staking, nowUnix, ledger, maxPerHour = 10, recentAnnounced = 0, url }) {
  const out = [];
  const budget = Math.max(0, Number(maxPerHour) - Number(recentAnnounced || 0));
  const byEscrow = new Map((locks || []).map((l) => [String(l.escrow), l]));
  for (const key of added || []) {
    if (out.length >= budget) break;
    const l = byEscrow.get(String(key));
    if (!l) continue;
    const row = (ledger || {})[String(key)];
    if (row && row.announcedAt) continue;                     // already told the room (survives restarts)
    if (!staking.qualifies(l, cfg)) continue;                  // dust and short locks stay quiet
    const split = staking.splitOf(l, nowUnix);
    const unvested = BigInt(split.unvestedRaw || 0);
    if (unvested <= 0n) continue;
    const w = staking.weightOf(l, nowUnix, cfg);
    if (w <= 0n) continue;
    // effective multiplier on what is actually locked, in entry-tier units
    const mult = Number((w * 100n) / unvested / BigInt(staking.minTermDaysOf(cfg))) / 100;
    const end = Number(l.fullyVestedAt || l.cliffTime || 0);
    const days = Math.max(0, Math.round((end - Number(l.firstSeenAt || nowUnix)) / DAY));
    const lines = [
      "🔒 <b>New CUNA lock</b>",
      `${esc(whole(l.totalRaw))} CUNA locked until ${esc(dateOf(end))}` + (days >= 28 ? ` (${monthsOf(days)} months)` : ""),
      `Wallet ${esc(shortAddr(l.recipient))} · eligible for lock-to-earn rewards at ${esc(mult.toFixed(mult % 1 ? 2 : 0))}× the entry rate`,
    ];
    if (url) lines.push(`Lock yours: ${esc(url)}`);
    out.push({ escrow: String(key), text: lines.join("\n") });
  }
  return out;
}

module.exports = { pickAnnouncements, shortAddr, whole, dateOf };
