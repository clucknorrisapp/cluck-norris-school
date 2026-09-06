"use strict";
// Listing Checkup — the pure core (owner ask 2026-09-06; plan: docs/LISTING_CHECKUP_PLAN.md).
//
// A project gives us its canonical record (name, symbol, mint, website, socials, logo). We read
// what every aggregator SHOWS for that mint, compare field by field, and produce a report:
// correct / incorrect (ours vs theirs) / not found / unread, with the page where each one is fixed.
//
// Honesty rules (CLAUDE.md): say what a site shows, never why; "could not read" is never "clean";
// "not found" is what the source answered, never a claim that they refuse to list it.
//
// Nothing in this file touches the network. Sources live in lib/listing-checkup-sources.js and
// take an injected fetcher, so scripts/listing-checkup-test.cjs runs the whole pipeline offline.

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FIELDS = ["name", "symbol", "website", "x", "telegram", "discord", "logo", "description"];
// Which canonical fields a source can show at all. A source that cannot show discord is not
// "missing" discord — the field is simply not compared there.
const FIELD_LABELS = { name: "Name", symbol: "Symbol", website: "Website", x: "X / Twitter", telegram: "Telegram", discord: "Discord", logo: "Logo", description: "Description" };

// ── Normalisers ───────────────────────────────────────────────────────────────────────────────
// A URL is the same listing whether it is written http://www.Site.com/ or https://site.com. We
// compare the canonical form and SHOW both originals in the report so the reader can judge.
function normUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  let url;
  try { url = new URL(s); } catch (_) { return s.toLowerCase().replace(/\/+$/, ""); }
  let host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "twitter.com") host = "x.com";
  if (host === "telegram.me") host = "t.me";
  let path = url.pathname.replace(/\/+$/, "");
  // A Telegram invite hash and an X status id are the identity; everything else drops its query.
  const keepQuery = false;
  path = path.replace(/\/+/g, "/");
  return host + (path === "/" ? "" : path) + (keepQuery ? url.search : "");
}
// @Handle, x.com/Handle, twitter.com/handle/, https://t.me/handle → "handle" (lowercase).
function normHandle(h, kind) {
  let s = String(h || "").trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(www\.)?(x\.com|twitter\.com|t\.me|telegram\.me|discord\.(gg|com))\//i.test(s)) {
    const n = normUrl(s);
    const m = n.match(/^(x\.com|t\.me|discord\.gg|discord\.com\/invite)\/([^/?#]+)/i);
    if (m) return m[2].toLowerCase();
    if (kind === "discord") return n;   // a discord.com/channels/… link is its own identity
    return n;
  }
  return s.replace(/^@/, "").toLowerCase();
}
// The link form of a handle, for display and for the "fix" rows.
function linkFor(kind, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (kind === "x") return "https://x.com/" + v.replace(/^@/, "");
  if (kind === "telegram") return "https://t.me/" + v.replace(/^@/, "");
  if (kind === "discord") return /^discord\./i.test(v) ? "https://" + v : "https://discord.gg/" + v;
  if (kind === "website") return "https://" + v;
  return v;
}
function normName(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }
function normSymbol(s) { return String(s || "").trim().replace(/^\$/, "").toLowerCase(); }
function normDescription(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }

// ── Canonical record ──────────────────────────────────────────────────────────────────────────
// What the project told us, validated and normalised once. Empty optional fields are not compared
// anywhere (a project without a Discord is not "wrong" on every site that shows none).
function canonicalFrom(input = {}) {
  const mint = String(input.mint || "").trim();
  if (!SOL_ADDR_RE.test(mint)) throw new Error("mint must be a Solana address");
  const name = String(input.name || "").trim().slice(0, 80);
  const symbol = String(input.symbol || "").trim().replace(/^\$/, "").slice(0, 20);
  if (!name) throw new Error("name is required");
  if (!symbol) throw new Error("symbol is required");
  const rec = {
    chain: "solana", mint, name, symbol,
    website: String(input.website || "").trim().slice(0, 300),
    x: String(input.x || input.twitter || "").trim().slice(0, 300),
    telegram: String(input.telegram || "").trim().slice(0, 300),
    discord: String(input.discord || "").trim().slice(0, 300),
    logo: String(input.logo || "").trim().slice(0, 500),
    description: String(input.description || "").trim().slice(0, 2000),
  };
  for (const k of ["website", "x", "telegram", "discord", "logo"]) {
    if (rec[k] && !/^[\w@.:/#?=&%+~-]+$/i.test(rec[k])) throw new Error(`${k} has characters that cannot be part of a link`);
  }
  return rec;
}
function normalisedOf(rec) {
  return {
    name: normName(rec.name), symbol: normSymbol(rec.symbol),
    website: normUrl(rec.website), x: normHandle(rec.x, "x"), telegram: normHandle(rec.telegram, "telegram"),
    discord: normHandle(rec.discord, "discord"), logo: rec.logo ? normUrl(rec.logo) : "", description: normDescription(rec.description),
  };
}

// ── Comparison ────────────────────────────────────────────────────────────────────────────────
// `shown` is what a source displays, already extracted into canonical field names by its adapter:
// { name, symbol, website, x, telegram, discord, logo, logoHash?, description } with "" for a
// field the source has empty and `undefined` for a field the source cannot show at all.
// `logoHashes` (optional) lets the caller compare fetched image bytes instead of URLs.
function compareFields(canonical, shown, { logoHashes } = {}) {
  const ours = normalisedOf(canonical);
  const out = [];
  for (const f of FIELDS) {
    if (shown[f] === undefined) continue;           // the source cannot show this field
    if (!canonical[f]) continue;                    // the project did not give it — nothing to check
    const theirsRaw = shown[f] == null ? "" : String(shown[f]);
    let theirs;
    if (f === "name") theirs = normName(theirsRaw);
    else if (f === "symbol") theirs = normSymbol(theirsRaw);
    else if (f === "website" || f === "logo") theirs = normUrl(theirsRaw);
    else if (f === "description") theirs = normDescription(theirsRaw);
    else theirs = normHandle(theirsRaw, f);
    let status;
    if (!theirs) status = "missing";
    else if (f === "logo") {
      // Every aggregator re-hosts the image on its own CDN, so a URL comparison says nothing. With
      // both images fetched we compare bytes; without, the row is 'unverified' and never counts
      // against the source.
      if (logoHashes && logoHashes.ours && logoHashes.theirs) status = logoHashes.ours === logoHashes.theirs ? "match" : "differs";
      else status = "unverified";
    }
    else if (f === "description") status = theirs === ours[f] ? "match" : (theirs.startsWith(ours[f].slice(0, 60)) || ours[f].startsWith(theirs.slice(0, 60)) ? "match" : "differs");
    else status = theirs === ours[f] ? "match" : "differs";
    const row = { field: f, label: FIELD_LABELS[f], status, ours: canonical[f], theirs: theirsRaw };
    if (f === "logo" && status === "match" && normUrl(theirsRaw) !== ours.logo) row.note = "same image, different host";
    if (f === "logo" && status === "unverified") row.note = "re-hosted image — compared by bytes on a full run";
    out.push(row);
  }
  return out;
}
// One source's overall verdict from its read outcome and field rows.
//   correct   — the source shows a record and every compared field matches
//   incorrect — at least one compared field differs or is missing
//   not-found — the source answered and has no record for this mint
//   unread    — we could not read the source (error, no key, blocked); never counted as clean
function verdictOf({ readOk, found, fields }) {
  if (!readOk) return "unread";
  if (!found) return "not-found";
  return fields.some((r) => r.status === "differs" || r.status === "missing") ? "incorrect" : "correct";
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────
// sources: [{ id, label, tier: 'preview'|'full', fixUrl(mint, extracted), pageUrl(mint), read(mint, deps) → { found, shown, url? } }]
// Every adapter failure becomes an `unread` row with its error text — a report is never a 500.
async function runCheckup(canonical, { sources, deps, tier = "preview", concurrency = 4, hashLogo } = {}) {
  const wanted = sources.filter((s) => tier === "full" || s.tier === "preview");
  const rows = new Array(wanted.length);
  let i = 0;
  async function worker() {
    while (i < wanted.length) {
      const idx = i++;
      const src = wanted[idx];
      const row = { id: src.id, label: src.label, tier: src.tier, pageUrl: safeCall(() => src.pageUrl(canonical.mint)) || null, fixUrl: null, status: "unread", found: false, fields: [], error: null };
      try {
        const r = await src.read(canonical.mint, deps);
        row.found = !!(r && r.found);
        if (r && r.url) row.pageUrl = r.url;
        if (row.found) {
          let logoHashes = null;
          if (hashLogo && canonical.logo && r.shown && r.shown.logo) {
            try { logoHashes = { ours: await hashLogo(canonical.logo), theirs: await hashLogo(r.shown.logo) }; } catch (_) { logoHashes = null; }
          }
          row.fields = compareFields(canonical, r.shown || {}, { logoHashes });
        }
        row.status = verdictOf({ readOk: true, found: row.found, fields: row.fields });
        row.fixUrl = safeCall(() => src.fixUrl(canonical.mint, r && r.shown)) || null;
      } catch (e) {
        row.status = "unread";
        row.error = String(e && e.message || e).slice(0, 200);
        row.fixUrl = safeCall(() => src.fixUrl(canonical.mint, null)) || null;
      }
      rows[idx] = row;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));
  const summary = { correct: 0, incorrect: 0, "not-found": 0, unread: 0 };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  // "Fix this first": the on-chain record is what the aggregators copy.
  const onchain = rows.find((r) => r.id === "onchain");
  const fixFirst = onchain && onchain.status === "incorrect" ? onchain.fields.filter((f) => f.status === "differs" || f.status === "missing").map((f) => f.field) : [];
  return { chain: "solana", mint: canonical.mint, canonical, tier, sources: rows, summary, fixFirst, checked: wanted.length };
}
function safeCall(fn) { try { return fn(); } catch (_) { return null; } }

// ── Cache (kv-backed, capped) ────────────────────────────────────────────────────────────────
// Reports are kept per mint (last N runs) so a project can show "fixed since last week". The map
// is capped and the oldest-touched mint is evicted — the audit's uncapped-store lesson.
const CACHE_KEY = "listingCheckup";
const CACHE_MAX_MINTS = 2000;
const CACHE_RUNS_PER_MINT = 3;
function cacheGet(kv, mint) { const all = kv.get(CACHE_KEY, {}) || {}; const e = all[mint]; return e && Array.isArray(e.runs) ? e : null; }
function cachePut(kv, mint, report, now) {
  const all = kv.get(CACHE_KEY, {}) || {};
  const e = all[mint] && Array.isArray(all[mint].runs) ? all[mint] : { runs: [] };
  e.runs.unshift({ ...report, at: now });
  e.runs = e.runs.slice(0, CACHE_RUNS_PER_MINT);
  e.touched = now;
  all[mint] = e;
  const keys = Object.keys(all);
  if (keys.length > CACHE_MAX_MINTS) {
    keys.sort((a, b) => (all[a].touched || 0) - (all[b].touched || 0));
    for (const k of keys.slice(0, keys.length - CACHE_MAX_MINTS)) delete all[k];
  }
  kv.set(CACHE_KEY, all);
  return e;
}

module.exports = {
  SOL_ADDR_RE, FIELDS, FIELD_LABELS,
  normUrl, normHandle, linkFor, normName, normSymbol,
  canonicalFrom, normalisedOf, compareFields, verdictOf, runCheckup,
  cacheGet, cachePut, CACHE_KEY, CACHE_MAX_MINTS, CACHE_RUNS_PER_MINT,
};
