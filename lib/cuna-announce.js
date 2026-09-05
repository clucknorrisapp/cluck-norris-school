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
// Rounded to the nearest whole token for display (8,333,333.33 x 6 is 50,000,000, not 49,999,999).
function whole(raw) { return Math.round(Number(BigInt(raw || 0)) / 1e9).toLocaleString("en-US"); }
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
    const earning = staking.earningRawOf(l, nowUnix, cfg);
    const end = Number(l.fullyVestedAt || l.cliffTime || 0);
    const days = Math.max(0, Math.round((end - Number(l.firstSeenAt || nowUnix)) / DAY));
    const singleCliff = String(l.perPeriodRaw || "0") === "0" || Number(l.periods || 0) === 0;
    // Single unlock (what the page builds): the multiplier is a clean tier number, say it.
    // Several unlocks (a Jupiter-made drip): say what is earning of what, never a fractional
    // "0.82x" that invites "why?" (owner, 2026-09-05).
    let earnLine;
    if (singleCliff) {
      const mult = Number((w * 100n) / unvested / BigInt(staking.minTermDaysOf(cfg))) / 100;
      earnLine = `eligible for lock-to-earn rewards at ${esc(mult.toFixed(mult % 1 ? 2 : 0))}× the entry rate`;
    } else if (earning >= unvested) {
      earnLine = `earning lock-to-earn rewards on all ${esc(whole(unvested))} CUNA`;
    } else {
      earnLine = `earning lock-to-earn rewards on ${esc(whole(earning))} of ${esc(whole(unvested))} CUNA (the rest unlocks in under 90 days)`;
    }
    const lines = [
      "🔒 <b>New CUNA lock</b>",
      `${esc(whole(l.totalRaw))} CUNA locked until ${esc(dateOf(end))}` + (days >= 28 ? ` (${monthsOf(days)} months)` : ""),
      `Wallet ${esc(shortAddr(l.recipient))} · ${earnLine}`,
    ];
    if (url) lines.push(`Lock yours: ${esc(url)}`);
    out.push({ escrow: String(key), text: lines.join("\n") });
  }
  return out;
}

// After a posting round: what happens to each row that was flagged `announcePending`.
//
// Why a flag at all: the first two launch-day locks arrived inside a redeploy window. The scan
// wrote their ledger rows, the container was replaced before the Telegram send, and the fresh
// container saw two KNOWN rows and stayed quiet — the posts were lost and had to be sent by hand
// (2026-09-05). So the pending flag is written in the same ledger write that creates the row, and
// it comes off only once the post is out. A restart anywhere in between just retries.
//
//   announced — picked and sent: stamp announcedAt, drop the flag.
//   kept      — still owed a decision: picked but the send failed; never evaluated because the
//               hourly cap cut the list short; or not in this scan at all (an RPC index that
//               dropped it for a moment must not turn into "never announce it").
//   cleared   — evaluated and not announceable (dust, short, excluded, closed): drop the flag.
function settlePending({ pending, posts, sent, budget, scanned }) {
  const picked = new Set((posts || []).map((p) => String(p.escrow)));
  const ok = new Set((sent || []).map(String));
  const inScan = scanned ? new Set([...scanned].map(String)) : null;
  const capHit = (posts || []).length >= Math.max(0, Number(budget) || 0);
  const announced = [], kept = [], cleared = [];
  for (const raw of pending || []) {
    const k = String(raw);
    if (ok.has(k)) announced.push(k);
    else if (picked.has(k)) kept.push(k);
    else if (capHit) kept.push(k);
    else if (inScan && !inScan.has(k)) kept.push(k);
    else cleared.push(k);
  }
  return { announced, kept, cleared };
}

module.exports = { pickAnnouncements, settlePending, shortAddr, whole, dateOf };
