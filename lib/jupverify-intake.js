// CLKN Productions Jup Verification Protocol (JVP) — client intake store.
//
// Client projects fill /jupverify with everything a Jupiter VRFD submission needs;
// the owner reviews at /jupverify-admin and performs the submission himself.
// (docs/CLKN_JUP_VERIFICATION_PROTOCOL.md is the protocol this feeds.)
//
// THREAT MODEL: every client string is attacker-controlled and later rendered in the
// OWNER's browser (the admin queue is the highest-value XSS target on the site) and
// possibly pasted onward into Telegram/Jupiter forms. So: sanitize at storage (this
// module is the single choke point) AND escape at render — both, always. Symbols get
// the burn-broadcaster rule ([A-Za-z0-9] only); URLs must parse as https:; free text
// is length-bounded and stored raw for esc-at-render.
//
// Same graceful-degradation pattern as lib/school-progress.js: no /data volume →
// in-memory only, batched atomic writes on a timer.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "jupverify-intake.json");

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL_RE = /^[A-Za-z0-9]{1,10}$/;             // burn-broadcaster rule
const HANDLE_RE = /^[A-Za-z0-9_]{1,32}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

const MAX_SUBMISSIONS = 500;
const MAX_ACTIVE_PER_WALLET = 3;
const ARCHIVE_TTL_MS = 180 * 86400000;               // prune archived/rejected after 180d

const STATUSES = ["submitted", "in_review", "needs_info", "engine_live", "submitted_to_jupiter", "verified", "rejected", "archived"];

let store = { subs: {} };                             // id -> record
let persistent = false;
let dirty = false;

(function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persistent = true;
    if (fs.existsSync(FILE)) {
      const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (o && typeof o === "object" && o.subs) store = o;
    }
    prune();
    console.log(`[jupverify] loaded ${Object.keys(store.subs).length} submissions from ${FILE}`);
  } catch (e) {
    console.warn(`[jupverify] volume unavailable (${e.message}) — running in-memory only`);
  }
})();

function prune() {
  const now = Date.now();
  for (const [id, r] of Object.entries(store.subs)) {
    if ((r.status === "archived" || r.status === "rejected") && now - (r.updatedAt || r.createdAt || 0) > ARCHIVE_TTL_MS) delete store.subs[id];
  }
}

function persist() {
  if (!persistent || !dirty) return;
  dirty = false;
  try { require("./atomic-write").atomicWriteFileSync(FILE, JSON.stringify(store)); }
  catch (e) { console.warn(`[jupverify] persist failed: ${e.message}`); }
}
setInterval(persist, 30000).unref();

// ── Field sanitizers ─────────────────────────────────────────────────────────
function cleanText(v, max) { return String(v == null ? "" : v).trim().slice(0, max); }
function cleanUrl(v, max = 300) {
  const s = cleanText(v, max);
  if (!s) return "";
  let u; try { u = new URL(s); } catch (_) { return null; }   // null = invalid, caller rejects
  if (u.protocol !== "https:") return null;                  // kills javascript:/data:
  return u.href.slice(0, max);
}
function cleanHandle(v) {
  const s = cleanText(v, 40).replace(/^@+/, "");
  if (!s) return "";
  return HANDLE_RE.test(s) ? s : null;
}
function cleanNum(v, lo, hi) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return undefined; // undefined = invalid
  return n;
}

// Validate + sanitize the client form. Returns { ok:true, fields } or { ok:false, error }.
function sanitizeForm(f) {
  if (!f || typeof f !== "object") return { ok: false, error: "missing form" };
  const out = {};
  const mint = cleanText(f.mint, 44);
  if (!SOL_ADDR_RE.test(mint)) return { ok: false, error: "mint: enter the token's mint address" };
  out.mint = mint;
  const symbol = cleanText(f.symbol, 12);
  if (!SYMBOL_RE.test(symbol)) return { ok: false, error: "symbol: letters and numbers only, up to 10 characters" };
  out.symbol = symbol.toUpperCase();
  out.name = cleanText(f.name, 64);
  if (!out.name) return { ok: false, error: "name: required" };
  out.description = cleanText(f.description, 1000);
  if (out.description.length < 20) return { ok: false, error: "description: tell us about the project (at least 20 characters)" };

  // URLs — https only, must parse. Website + icon required; the rest optional.
  const website = cleanUrl(f.website); if (!website) return { ok: false, error: "website: a valid https:// URL is required" };
  out.website = website;
  const iconUrl = cleanUrl(f.iconUrl); if (!iconUrl) return { ok: false, error: "iconUrl: a valid https:// URL is required (we can move it to Arweave for you)" };
  out.iconUrl = iconUrl;
  for (const k of ["telegramUrl", "discordUrl", "otherUrl"]) {
    if (f[k]) { const u = cleanUrl(f[k]); if (u === null) return { ok: false, error: `${k}: must be a valid https:// URL` }; out[k] = u || ""; }
    else out[k] = "";
  }
  out.iconPermanent = !!f.iconPermanent;

  // Handles
  const xHandle = cleanHandle(f.xHandle);
  if (!xHandle) return { ok: false, error: "xHandle: the project's X handle is required (letters/numbers/underscore)" };
  out.xHandle = xHandle;
  const tgContact = cleanHandle(f.tgContact);
  if (!tgContact) return { ok: false, error: "tgContact: a Telegram contact handle is required" };
  out.tgContact = tgContact;

  // Numbers
  const teamPct = cleanNum(f.teamPct, 0, 100); if (teamPct === undefined) return { ok: false, error: "teamPct: 0-100" };
  out.teamPct = teamPct;
  const floatTokens = cleanNum(f.floatTokens, 0, 1e18); if (floatTokens === undefined) return { ok: false, error: "floatTokens: a number" };
  out.floatTokens = floatTokens;
  const quoteAmount = cleanNum(f.quoteAmount, 0, 1e12); if (quoteAmount === undefined) return { ok: false, error: "quoteAmount: a number" };
  out.quoteAmount = quoteAmount;
  out.quoteAsset = ["USDC", "SOL"].includes(String(f.quoteAsset || "").toUpperCase()) ? String(f.quoteAsset).toUpperCase() : "USDC";

  const fundingWallet = cleanText(f.fundingWallet, 44);
  if (fundingWallet && !SOL_ADDR_RE.test(fundingWallet)) return { ok: false, error: "fundingWallet: not a valid Solana address" };
  out.fundingWallet = fundingWallet || "";

  // Free text, esc-at-render
  out.lockInfo = cleanText(f.lockInfo, 500);
  out.supplyNotes = cleanText(f.supplyNotes, 500);
  out.existingPools = cleanText(f.existingPools, 1000);
  out.notes = cleanText(f.notes, 2000);

  const email = cleanText(f.email, 255);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "email: doesn't look valid" };
  out.email = email || "";
  return { ok: true, fields: out };
}

// ── Store operations ─────────────────────────────────────────────────────────
function findByWalletMint(wallet, mint) {
  return Object.values(store.subs).find((r) => r.wallet === wallet && r.mint === mint) || null;
}
function activeCountFor(wallet) {
  return Object.values(store.subs).filter((r) => r.wallet === wallet && !["archived", "rejected", "verified"].includes(r.status)).length;
}

// Create or update (same wallet+mint = resubmission; status resets to submitted).
// `chain` = server-computed facts (decimals, supplyUi, authorities, badges) — never client input.
function submit({ wallet, fields, chain, ip }) {
  prune();
  const existing = findByWalletMint(wallet, fields.mint);
  if (!existing) {
    if (Object.keys(store.subs).length >= MAX_SUBMISSIONS) return { ok: false, error: "Intake is full — contact the team directly." };
    if (activeCountFor(wallet) >= MAX_ACTIVE_PER_WALLET) return { ok: false, error: "This wallet already has the maximum open submissions." };
  }
  const now = Date.now();
  const id = existing ? existing.id : crypto.randomBytes(6).toString("hex");
  const prev = existing || { createdAt: now, history: [] };
  const rec = {
    ...prev,
    id, wallet, ...fields,
    chain: chain || prev.chain || null,
    ip: ip || prev.ip || null,
    status: "submitted",
    updatedAt: now,
    ownerNotes: prev.ownerNotes || "",
    clientMessage: prev.clientMessage || "",
    history: [...(prev.history || []), { at: now, from: existing ? existing.status : null, to: "submitted" }].slice(-40),
  };
  store.subs[id] = rec;
  dirty = true; persist();
  return { ok: true, id, resubmission: !!existing };
}

// Ids are crypto.randomBytes(6).toString("hex"); anything else (e.g. "constructor", which
// would resolve to Object via the prototype) is not a record.
const ID_RE = /^[0-9a-f]{12}$/;
function lookup(id) {
  id = String(id);
  return ID_RE.test(id) && Object.prototype.hasOwnProperty.call(store.subs, id) ? store.subs[id] : null;
}
function get(id) { return lookup(id) || null; }

function list() {
  return Object.values(store.subs)
    .map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, mint: r.mint, wallet: r.wallet, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt }))
    .sort((a, b) => {
      const attn = (s) => (["submitted", "needs_info"].includes(s.status) ? 0 : 1);
      return attn(a) - attn(b) || (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

function adminUpdate(id, { status, ownerNotes, clientMessage }) {
  const r = lookup(id);
  if (!r) return { ok: false, error: "not found" };
  const now = Date.now();
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return { ok: false, error: "bad status" };
    if (status !== r.status) { r.history = [...(r.history || []), { at: now, from: r.status, to: status }].slice(-40); r.status = status; }
  }
  if (ownerNotes !== undefined) r.ownerNotes = cleanText(ownerNotes, 4000);       // private — never returned to the client
  if (clientMessage !== undefined) r.clientMessage = cleanText(clientMessage, 500); // shown on the client's status card (esc'd there)
  r.updatedAt = now;
  dirty = true; persist();
  return { ok: true, record: r };
}

// Client-safe view: no ownerNotes, no ip, history as to/at only.
function clientView(r) {
  if (!r) return null;
  return {
    id: r.id, symbol: r.symbol, name: r.name, mint: r.mint, status: r.status,
    clientMessage: r.clientMessage || "",
    history: (r.history || []).map((h) => ({ at: h.at, to: h.to })),
    updatedAt: r.updatedAt,
  };
}

module.exports = { sanitizeForm, submit, get, list, adminUpdate, clientView };
