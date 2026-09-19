"use strict";
// lib/hub/feed.js — Colosseum roadmap §14 DD2: "Follow a project without a wallet." Pure item
// builder + two serializers (JSON Feed 1.1, RSS 2.0) over the exact same PUBLIC view functions
// every other Hub read route already composes from (lib/hub/public.js's projectView/
// programVersionView, lib/hub/reproduce.js's per-batch reproducibility, lib/holders-snapshot.js's
// series). Nothing here reads a store or a private field itself — every input is already-public
// data the caller (server.js) assembled, the same discipline lib/hub/bundle.js documents for the
// evidence bundle.
//
// FOUR item kinds, exactly the ones the roadmap names — never a fifth invented one:
//   version:<n>       a program version was published (with its hash)
//   commitment:<sig>  that version's hash was independently committed on-chain (B5)
//   batch:<id>        a batch settled — receipt count + that batch's OWN reproducibility ratio,
//                      from the SAME computation /api/hub/:project/reproducibility publishes
//                      (never a lagged daily history figure — see the `history` note below)
//   snapshot:<id>      a holder snapshot was recorded (X7)
//
// `history` (lib/reproducibility-history.js series()) is accepted for parity with everything the
// project computes and could, in principle, be surfaced — but it is NOT what a batch item's ratio
// is built from. The daily history is one project-wide number recorded once per UTC day; a batch
// item's ratio must be the exact number the reproducibility route/badge would report for THAT
// batch right now, or "the feed says 1 of 1" and "the route says 1 of 2" could read as two
// different claims about the same batch. `history` stays a no-op input today rather than being
// left out of the signature, so a caller that already has it in hand (server.js does, next to the
// other reproducibility reads) can pass it through without this module silently ignoring an arg
// it never declared.
//
// STABILITY: an item's `id` is built ONLY from its kind and its own natural, never-reused key
// (a version number, a batch id, a snapshot id, a signature) — never from anything that could
// change between two reads of the same record (an array index, a live rank). Two calls over the
// same underlying data must produce byte-identical items.
//
// HONESTY (CLAUDE.md, "say what's on-chain, never why"; DD2's own hard rules): every title/summary
// states what the record shows — a version published, a batch's receipts settled, a snapshot
// taken, a memo observed — never why it happened. "reproduce" / "match" are the only claim words
// used for a batch's ratio; "verified" / "audited" / "safe" never appear. No APR/APY/yield
// anywhere (these items never carry a dollar figure at all). Nothing about Normie Quest. Wallet
// Watch is never mentioned — it has no Hub project and never will.

const { escHtml } = require("../html-escape");

const JSON_FEED_VERSION = "https://jsonfeed.org/version/1.1";

function isoFromUnixSeconds(sec) {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}
function isoFromEpochMs(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}
function isoFromDayKey(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00.000Z` : null;
}
const trimSlash = (s) => String(s || "").replace(/\/+$/, "");

// ── item builders, one per kind — each returns null for a record too incomplete to publish ─────

function versionItem({ v, projectId, base }) {
  if (!v || v.version == null || !v.hash) return null;
  const date = isoFromDayKey(v.effectiveFrom);
  if (!date) return null;
  return {
    id: `version:v${v.version}`,
    kind: "version",
    title: `Program version ${v.version} published`,
    summary: `Program version ${v.version} took effect ${v.effectiveFrom}. Terms hash ${v.hash}.`,
    date,
    url: `${base}/api/hub/${encodeURIComponent(projectId)}/program/${encodeURIComponent(v.version)}`,
  };
}

// A commitment is a fact about a SIGNATURE — its own public page is the transaction itself
// (any explorer, not our server), same convention every Hub page already uses for a signature
// link (hub.html/hub-desk.html/hub-compare.html's txLink → solscan.io/tx/<sig>).
function commitmentItem({ c }) {
  if (!c || !c.sig) return null;
  const date = isoFromUnixSeconds(c.observedAt);
  if (!date) return null;
  const version = c.version != null ? c.version : null;
  const hashNote = c.hash ? ` (hash ${c.hash})` : "";
  return {
    id: `commitment:${c.sig}`,
    kind: "commitment",
    title: version != null ? `Program version ${version} committed on-chain` : "A program version was committed on-chain",
    summary: `An on-chain memo committing ${version != null ? `program version ${version}'s` : "a program version's"} hash${hashNote} was observed, signature ${c.sig}.`,
    date,
    url: `https://solscan.io/tx/${encodeURIComponent(c.sig)}`,
  };
}

function batchItem({ id, b, rep, projectId, base }) {
  if (!b) return null;
  const sentWallets = Object.keys(b.sent || {});
  if (!sentWallets.length) return null; // "settled" — a built-but-unsent batch is not a feed item
  const date = isoFromUnixSeconds(b.at);
  if (!date) return null;
  const count = sentWallets.length;
  const ratio = rep && Number.isFinite(Number(rep.total)) ? `${Number(rep.reproduced) || 0} of ${Number(rep.total) || 0}` : null;
  return {
    id: `batch:${id}`,
    kind: "batch",
    title: `Batch settled — ${count} receipt${count === 1 ? "" : "s"}`,
    summary: ratio
      ? `This batch paid ${count} wallet${count === 1 ? "" : "s"}; ${ratio} receipts in it reproduce from the published inputs.`
      : `This batch paid ${count} wallet${count === 1 ? "" : "s"}.`,
    date,
    url: `${base}/api/hub/${encodeURIComponent(projectId)}/batch/${encodeURIComponent(id)}/inputs`,
  };
}

function snapshotItem({ s, mint, base }) {
  if (!s || !s.id) return null;
  const date = isoFromEpochMs(s.at);
  if (!date) return null;
  const holderCount = Number(s.holderCount) || 0;
  return {
    id: `snapshot:${s.id}`,
    kind: "snapshot",
    title: `Holder snapshot recorded — ${holderCount} holder${holderCount === 1 ? "" : "s"}`,
    summary: `A holder snapshot recorded ${holderCount} holder${holderCount === 1 ? "" : "s"}, list hash ${s.listHash || ""}.`,
    date,
    url: `${base}/api/holders/snapshots/${encodeURIComponent(s.id)}?mint=${encodeURIComponent(mint || "")}`,
  };
}

// The public feed, newest first. Every input is data the caller already read through a public
// view function or a public store shape — nothing here decides what is private; it only shapes
// what was already whitelisted into an item.
//   projectView        lib/hub/public.js projectView(...) — used for id/mint only here
//   versions            full public program-version docs (lib/hub/public.js programVersionView
//                        with {full:true}) — carries hash + commitment
//   batches             the raw batch store ({ [batchId]: { at, sent, ... } })
//   receiptsByBatch      { [batchId]: { total, reproduced, mismatched, missingInputs } } — the
//                        SAME per-batch rows /api/hub/:project/reproducibility returns
//   snapshots           lib/holders-snapshot.js series(kv, mint)
//   history             lib/reproducibility-history.js series(kv, projectId) — accepted, unused
//                        today (see the header note above)
//   commitments         optional pre-extracted [{ version, hash, sig, slot, observedAt }]; when
//                        omitted, derived from `versions[].commitment`
//   base                this deploy's own origin (e.g. `${req.protocol}://${req.get("host")}`) —
//                        never hardcoded, so the same code serves correctly in a test and in prod
function buildFeedItems({ projectView, versions = [], batches = {}, receiptsByBatch = {}, snapshots = [], history = [], commitments = null, base } = {}) {
  const projectId = projectView && projectView.id;
  const mint = projectView && projectView.mint;
  const originBase = trimSlash(base);
  const items = [];

  for (const v of Array.isArray(versions) ? versions : []) {
    const it = versionItem({ v, projectId, base: originBase });
    if (it) items.push(it);
  }

  const commitList = Array.isArray(commitments) && commitments.length
    ? commitments
    : (Array.isArray(versions) ? versions : [])
        .filter((v) => v && v.commitment && v.commitment.sig)
        .map((v) => ({ version: v.version, hash: v.hash, ...v.commitment }));
  for (const c of commitList) {
    const it = commitmentItem({ c });
    if (it) items.push(it);
  }

  for (const [id, b] of Object.entries(batches || {})) {
    const it = batchItem({ id, b, rep: receiptsByBatch ? receiptsByBatch[id] : null, projectId, base: originBase });
    if (it) items.push(it);
  }

  for (const s of Array.isArray(snapshots) ? snapshots : []) {
    const it = snapshotItem({ s, mint, base: originBase });
    if (it) items.push(it);
  }

  void history; // accepted, not yet consumed — see the header note
  items.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return items;
}

// ── JSON Feed 1.1 (https://jsonfeed.org/version/1.1) ────────────────────────────────────────────
function toJsonFeed(items, meta = {}) {
  return {
    version: JSON_FEED_VERSION,
    title: String(meta.title || "Hub project feed"),
    home_page_url: String(meta.home_page_url || ""),
    feed_url: String(meta.feed_url || ""),
    items: (items || []).map((it) => ({
      id: String(it.id),
      url: String(it.url),
      title: String(it.title),
      content_text: String(it.summary),
      date_published: String(it.date),
    })),
  };
}

// RFC 822 date, the shape RSS's <pubDate> requires — Node's toUTCString already gives
// "Fri, 18 Sep 2026 00:00:00 GMT"; RSS wants "GMT" or a numeric offset, both are legal, so it is
// used as-is.
function rfc822(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

// ── RSS 2.0 ──────────────────────────────────────────────────────────────────────────────────
function toRss(items, meta = {}) {
  const title = escHtml(meta.title || "Hub project feed");
  const link = escHtml(meta.home_page_url || "");
  const description = escHtml(meta.description || String(meta.title || "Hub project feed"));
  const feedUrl = escHtml(meta.feed_url || "");
  const itemsXml = (items || []).map((it) => {
    const pub = rfc822(it.date);
    return "<item>"
      + "<title>" + escHtml(it.title) + "</title>"
      + "<link>" + escHtml(it.url) + "</link>"
      + "<guid isPermaLink=\"false\">" + escHtml(it.id) + "</guid>"
      + (pub ? "<pubDate>" + escHtml(pub) + "</pubDate>" : "")
      + "<description>" + escHtml(it.summary) + "</description>"
      + "</item>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<rss version="2.0"><channel>'
    + "<title>" + title + "</title>"
    + "<link>" + link + "</link>"
    + "<description>" + description + "</description>"
    + '<atom:link href="' + feedUrl + '" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom"/>'
    + itemsXml
    + "</channel></rss>";
}

module.exports = { buildFeedItems, toJsonFeed, toRss };
