// Normie Quest — playtest feedback digest (AI-triaged, twice-daily).
//
// Self-contained + unit-testable: reads the tester comment store, has Claude triage the NEW comments
// (since a durable watermark) into a tight Telegram-HTML digest, and hands it to an injected
// `notify(text) -> messageId|null` (server.js wires that to a SILENT operator DM). Falls back to a
// plain grouped list if the AI call fails or ANTHROPIC_API_KEY is unset, so signal is never lost.
//
// State (in the shared kvstore): nqDigestSince = ms watermark of the last DELIVERED comment.

const kv = require("../lib/kvstore");
const store = require("./nq-feedback");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function triage(comments) {
  const compact = comments.map((c) => ({ level: c.level || "?", kind: c.kind || "note", by: c.name || "anon", text: String(c.text || "").slice(0, 600) }));
  const fallback = () => {
    const byLevel = {};
    compact.forEach((c) => { (byLevel[c.level] = byLevel[c.level] || []).push(c); });
    return Object.keys(byLevel).sort().map((lv) =>
      `<b>${esc(lv)}</b>\n` + byLevel[lv].map((c) => `• [${esc(c.kind)}] ${esc(c.text)} <i>— ${esc(c.by)}</i>`).join("\n")
    ).join("\n\n");
  };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return fallback();
  const system = "You are the QA lead for 'Normie Quest', a free Super-Mario-style side-scrolling platformer for a Solana memecoin. "
    + "You receive raw playtester comments as JSON (each has level, kind=bug|idea|note, by, text). Produce a SHORT triaged digest for the "
    + "developer. Telegram HTML ONLY: <b>bold</b>, <i>italic</i>, and • bullet characters — NO markdown, NO # headers, NO links, NO other tags. "
    + "Group by level (bold the level id). Merge duplicates and say how many testers hit the same thing. Lead with the most actionable BUGS, then "
    + "ideas, then minor notes. Be concrete and terse; paraphrase, don't quote in full. If a comment is vague, keep it but append (unclear). Max ~15 bullets total.";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1400, system, messages: [{ role: "user", content: JSON.stringify(compact) }] }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => null);
    const text = data && data.content && data.content[0] && data.content[0].text;
    return (text && text.trim()) || fallback();
  } catch (_) { return fallback(); }
}

// send: actually deliver via notify() (else dry-run/preview). reset: re-baseline the watermark to now.
// notify: async (text) => messageId|null. Returns a status object.
async function run({ send = false, reset = false, notify = null } = {}) {
  if (reset) kv.set("nqDigestSince", Date.now());
  const since = Number(kv.get("nqDigestSince", 0)) || 0;
  let all = [];
  try { all = store.list() || []; } catch (_) { all = []; }
  const fresh = all.filter((c) => Number(c.at || 0) > since);
  const result = { total: all.length, sinceTs: since, newCount: fresh.length };
  if (!fresh.length) { result.status = "no_new"; return result; }
  const digest = await triage(fresh);
  const maxAt = fresh.reduce((m, c) => Math.max(m, Number(c.at || 0)), since);
  const body = `🎮 <b>Normie Quest — playtest digest</b>\n${fresh.length} new comment${fresh.length === 1 ? "" : "s"} · `
    + `<a href="https://clucknorris.app/normie-quest-x7/feedback?key=normiequesttest">full dashboard</a>\n\n${digest}`;
  result.digest = digest;
  if (send && typeof notify === "function") {
    const mid = await notify(body);
    if (mid) { kv.set("nqDigestSince", maxAt); result.status = "sent"; }   // advance watermark ONLY on confirmed delivery — a failed send retries next slot
    else { result.status = "send_failed"; }
  } else { result.status = "dry"; result.preview = body; }
  return result;
}

module.exports = { triage, run };
