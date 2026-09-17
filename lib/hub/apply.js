"use strict";
// Self-serve onboarding — the application, pure (Phase 3, owner 2026-09-16: "allow other project
// holders to come on board … set all the parameters they want").
//
// An application GRANTS NOTHING. It is a validated draft — the project record and a full terms
// draft, both checked the same way approval checks them (mint read on-chain by the caller, terms
// through validateTerms) — that the owner approves in one click. Approval turns it into a
// registry project whose first program version is the draft, effective tomorrow; then the project
// pays its month (lib/hub/access-pay.js) and arms. The tier is the OWNER's at approval: an
// applicant may ask for `standard` or `small`, never `comped`.
const crypto = require("crypto");
const proj = require("./project");
const access = require("./access");
const teach = require("./teach");
const L = require("./ledger");

const MAX_PENDING = 200;
const CONTACT_MAX = 80;
const TERM_KEYS = ["poolDailyRaw", "sharePct", "maxSharePct", "minDurationDays", "maxTermDays", "minLockRaw", "maxWalletSharePct", "backdateCapDays", "backdateNotBefore", "payoutSchedule", "vesting", "cancelableAllowed", "excludeWallets", "fundedBy"];

function newId() { return "app_" + crypto.randomBytes(5).toString("hex"); }
function dayKey(unix) { return new Date(unix * 1000).toISOString().slice(0, 10); }
function tomorrowKey(unix) { return dayKey(unix + 86400); }

// Validate one application. `mintInfo` (and `rewardMintInfo` inside input when the reward differs)
// must come from the chain — validateProject refuses anything else.
function validateApplication(input, mintInfo, { nowUnix, id = newId }) {
  const a = input || {};
  const tierRequested = access.assertTier(a.tierRequested == null ? "standard" : a.tierRequested);
  if (tierRequested === "comped") throw new Error("comped is granted by the owner, not requested");
  const contact = String(a.contact || "").trim().slice(0, CONTACT_MAX);
  if (!contact) throw new Error("a contact is required (a Telegram or X handle, or an email) so the owner can reach the project");
  const applicant = a.applicantWallet ? String(a.applicantWallet) : null;
  const projectInput = { id: a.id, label: a.label, symbol: a.symbol, mint: a.mint, fundingWallet: a.fundingWallet, operatorWallets: a.operatorWallets, rewardMint: a.rewardMint, rewardMintInfo: a.rewardMintInfo, accessTier: tierRequested };
  const project = proj.validateProject(projectInput, mintInfo);
  if (applicant && !project.operatorWallets.includes(applicant)) throw new Error("the connected wallet must be one of the operator wallets");
  const termsIn = {};
  for (const k of TERM_KEYS) if (a.terms && a.terms[k] != null && a.terms[k] !== "") termsIn[k] = a.terms[k];
  if (termsIn.cancelableAllowed != null) termsIn.cancelableAllowed = termsIn.cancelableAllowed === true || String(termsIn.cancelableAllowed) === "1" || String(termsIn.cancelableAllowed) === "true";
  const terms = proj.validateTerms(termsIn, project);
  return { id: id(), projectId: project.id, project, terms, tierRequested, contact, applicantWallet: applicant, submittedAt: Number(nowUnix), status: "pending", decidedAt: null, reason: null };
}

// What the applicant sees before submitting: the terms as the engine will read them, the version
// hash they would sign up to, and the teach block their holders would read. Never stored.
function preview(app, { nowUnix }) {
  const state = proj.createVersion({}, app.project, app.terms, { effectiveFrom: tomorrowKey(nowUnix), todayKey: dayKey(nowUnix) });
  const version = state.versions[0];
  const funding = L.fundingStatus({ part: {}, batches: {}, journal: {}, projectId: app.projectId, observed: null });
  const block = teach.teachBlock({ project: app.project, version, funding });
  return { version: { version: version.version, effectiveFrom: version.effectiveFrom, hash: version.hash, terms: version.terms }, teach: block };
}

// Add to the book: one pending application per mint and per project id, a cap on the book.
function addToBook(book, app) {
  const b = { ...(book || {}) };
  const pending = Object.values(b).filter((x) => x && x.status === "pending");
  if (pending.length >= MAX_PENDING) throw new Error("the application queue is full — try again later");
  if (pending.some((x) => x.project.mint === app.project.mint)) throw new Error("an application for this mint is already waiting");
  if (pending.some((x) => x.projectId === app.projectId)) throw new Error(`the project id "${app.projectId}" is already waiting for approval — pick another`);
  b[app.id] = app;
  return b;
}

// Owner approval: the registry project (tier + note are the owner's), plus the state with the
// draft as v1 effective tomorrow. `freshMintInfo` is a fresh chain read at approval time.
function approve(book, registry, appId, { tier, note, nowUnix, freshMintInfo, freshRewardMintInfo, reserved }) {
  const app = (book || {})[appId];
  if (!app) throw new Error("no such application");
  if (app.status !== "pending") throw new Error(`application is ${app.status}`);
  const t = access.assertTier(tier == null ? app.tierRequested : tier);
  const project = proj.validateProject({ ...app.project, rewardMintInfo: freshRewardMintInfo, accessTier: t, accessNote: note }, freshMintInfo || { decimals: app.project.decimals, tokenProgram: app.project.tokenProgram, extensions: [] });
  const reg = proj.approveProject(registry, project, { nowUnix, reserved });
  const state = proj.createVersion({}, reg[project.id], app.terms, { effectiveFrom: tomorrowKey(nowUnix), todayKey: dayKey(nowUnix) });
  const nextBook = { ...book, [appId]: { ...app, status: "approved", decidedAt: Number(nowUnix) } };
  return { registry: reg, state, book: nextBook, project: reg[project.id] };
}

function reject(book, appId, { reason, nowUnix }) {
  const app = (book || {})[appId];
  if (!app) throw new Error("no such application");
  if (app.status !== "pending") throw new Error(`application is ${app.status}`);
  return { ...book, [appId]: { ...app, status: "rejected", decidedAt: Number(nowUnix), reason: String(reason || "").slice(0, 200) } };
}

// The owner's list: never the applicant's terms verbatim in a public place — this is admin-only.
function listView(book) {
  return Object.values(book || {}).sort((a, b) => b.submittedAt - a.submittedAt).map((a) => ({
    id: a.id, status: a.status, projectId: a.projectId, label: a.project.label, symbol: a.project.symbol, mint: a.project.mint,
    fundingWallet: a.project.fundingWallet, operatorWallets: a.project.operatorWallets, tierRequested: a.tierRequested, contact: a.contact,
    applicantWallet: a.applicantWallet, submittedAt: a.submittedAt, decidedAt: a.decidedAt, reason: a.reason, terms: a.terms,
  }));
}

module.exports = { MAX_PENDING, TERM_KEYS, validateApplication, preview, addToBook, approve, reject, listView, dayKey, tomorrowKey };
