"use strict";
// Project records and program versions — the identity half of the Hub (design §2).
//
// A Project is whitelisted by the owner only; a program version is immutable once effective and
// carries a sha256 of its canonical JSON that the public page shows and the funding wallet can
// commit on-chain (Addendum B5). Editing terms never edits a version: it creates the next one
// with a new effectiveFrom, and periods already accrued under the old version keep it.

const crypto = require("crypto");
const access = require("./access");
const brandLib = require("./brand");
const { assertProjectId } = require("./store");

const B58 = require("../solana-addr").SOL_ADDR_RE;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
// Token-2022 extensions the payout path cannot yet account for. A transfer fee makes the raw
// amount that ARRIVES differ from the raw amount SENT, and a transfer hook can refuse or reorder
// a transfer — either one breaks "the receipt equals the verified transfer". Refused at approval,
// with the reason, until the payout verifier understands them.
const UNSUPPORTED_EXTENSIONS = new Set(["transferFeeConfig", "transferHook", "permanentDelegate", "nonTransferable"]);
// Round 2 #6 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): "settle" is reserved outright — a project
// with this id would put its own payout lock key (`hublock:settle:payout`, previously
// `hub:settle:payout`) inside or beside the settlement journal's own kv-key namespace
// (lib/hub/store.js JOURNAL_PREFIX = "hub:settle:"). Nothing about the id is otherwise unsafe; it
// is refused purely to keep the journal's key space unambiguous, the same spirit as the built-in
// programme ids checked against the caller's `reserved` map below.
//
// Item 6 / Round 3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): page-shadowing — every id that is a
// page or API segment registered AHEAD of the generic `/hub/:project` / `/api/hub/:project`
// patterns in server.js (on `origin/develop` and this branch) would give a project approved under
// that id no public page (or a page/response meant for something else). One list, consulted from
// both server.js's `reserved()`/`reservedMints` and this module's own `approveProject` below —
// see scripts/hub-reserved-ids-test.cjs, which greps server.js for the routes this guards.
const RESERVED_PROJECT_IDS = new Set([
  "apply", "verify", "status", "wallet", "trust", "judge", "schema", "registry", "hub",
  "demo", "demo-b", "settle", "badge",
]);
// N4 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): `vaultProject` is a plain lowercase slug —
// the id of one of OUR own vault projects (lib/whirlpool-vault.js), not a wallet address, so a
// short id-shaped string is all this module can validate; whether it actually names a live vault
// is resolved at use time (an unknown id simply adds nothing, never a wildcard).
const VAULT_PROJECT_RE = /^[a-z0-9-]{1,32}$/;
function normalizeVaultProject(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!VAULT_PROJECT_RE.test(s)) throw new Error(`vaultProject must be a short lowercase id: got ${JSON.stringify(v)}`);
  return s;
}

// JSON with keys sorted at every level and BigInts as strings — the only serialisation a hash may
// be taken over, or two identical programs hash differently on field order.
function canonicalJson(v) {
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
function sha256(s) { return crypto.createHash("sha256").update(s, "utf8").digest("hex"); }

function addr(v, what) {
  if (!B58.test(String(v || ""))) throw new Error(`${what} is not an address: ${JSON.stringify(v)}`);
  return String(v);
}

// mintInfo comes from an on-chain read the caller did: { decimals, tokenProgram, extensions[] }.
// Decimals are stored on the Project from that read, never typed in — a wrong decimals value is
// a 1000x payout in whichever direction.
function validateProject(input, mintInfo) {
  const p = input || {};
  const id = assertProjectId(p.id);
  if (!mintInfo || !Number.isInteger(mintInfo.decimals) || mintInfo.decimals < 0 || mintInfo.decimals > 18) {
    throw new Error("mintInfo.decimals must come from the mint account on-chain");
  }
  if (!TOKEN_PROGRAMS.has(String(mintInfo.tokenProgram))) throw new Error(`unsupported token program: ${mintInfo.tokenProgram}`);
  const bad = (mintInfo.extensions || []).filter((e) => UNSUPPORTED_EXTENSIONS.has(e));
  if (bad.length) throw new Error(`refused at approval: the mint carries Token-2022 extensions the payout path does not support yet (${bad.join(", ")})`);
  const label = String(p.label || "").trim();
  if (!label || label.length > 64) throw new Error("label is required (1–64 chars)");
  const symbol = String(p.symbol || "").trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) throw new Error("symbol must be 1–12 letters or digits");
  const mint = addr(p.mint, "mint");
  // Dry run (Colosseum E10, owner 2026-09-18): a labelled placeholder for a project whose terms
  // and funding wallet are NOT yet agreed. It may omit fundingWallet entirely — the engine and
  // payout routes refuse to arm or pay a dry-run project regardless (lib/hub/engine.js arm(),
  // lib/hub/routes.js), so there is nothing for a missing wallet to break. A real (non-dry-run)
  // project still requires one, unchanged from before this field existed.
  const dryRun = p.dryRun === true || p.dryRun === "1" || p.dryRun === "true";
  let fundingWallet = null;
  if (p.fundingWallet) fundingWallet = addr(p.fundingWallet, "fundingWallet");
  else if (!dryRun) fundingWallet = addr(p.fundingWallet, "fundingWallet"); // throws: required
  const operatorWallets = [...new Set((Array.isArray(p.operatorWallets) ? p.operatorWallets : []).map((w) => addr(w, "operatorWallets entry")))];
  const brand = brandLib.validateBrand(p.brand);
  // First release: one immutable reward asset per project. Defaults to the project mint.
  const rewardMint = p.rewardMint ? addr(p.rewardMint, "rewardMint") : mint;
  const rewardInfo = rewardMint === mint ? mintInfo : p.rewardMintInfo;
  if (!rewardInfo || !Number.isInteger(rewardInfo.decimals) || !TOKEN_PROGRAMS.has(String(rewardInfo.tokenProgram))) {
    throw new Error("rewardMintInfo { decimals, tokenProgram } must come from the reward mint on-chain");
  }
  const badR = (rewardInfo.extensions || []).filter((e) => UNSUPPORTED_EXTENSIONS.has(e));
  if (badR.length) throw new Error(`refused at approval: the reward mint carries unsupported Token-2022 extensions (${badR.join(", ")})`);
  return {
    id, label, symbol, mint,
    decimals: mintInfo.decimals, tokenProgram: String(mintInfo.tokenProgram),
    rewardMint, rewardDecimals: rewardInfo.decimals, rewardTokenProgram: String(rewardInfo.tokenProgram),
    fundingWallet, operatorWallets,
    dryRun, brand,
    // Platform access: the tier is the owner's call at approval (never self-declared).
    access: access.normalizeAccess({ tier: p.accessTier, note: p.accessNote }),
    // Round 2 #3 (docs/HUB_JOURNAL_VERIFY_2026-09-18.md): `payoutSources` is DELIBERATELY never
    // read from `input` here — this function is also what a self-serve /hub-apply application
    // builds its project from (lib/hub/apply.js validateApplication/approve), and this field must
    // only ever be set by the owner through the registry admin path (see withPayoutSources /
    // routes.js /api/hub-registry), never by an applicant's own submitted terms. A fresh project
    // and a re-validated one (an edit through the same registry path) both start here at empty —
    // lib/hub/routes.js is what carries the previous value forward across an edit, or applies a
    // change, never this constructor.
    payoutSources: [], payoutSourcesHistory: [],
    // N4: same discipline as payoutSources — never read from `input` here (an applicant cannot set
    // its own vault pairing), only ever set afterward through the owner-gated registry path.
    vaultProject: null,
    status: "draft", approvedAt: null, approvedBy: null,
  };
}

// A payment-source allowlist ENTRY, distinct from `fundedBy` (a program-version term with its own
// documented meaning — see validateTerms below). Base58 wallets, at most 5 (Round 2 #3).
function validatePayoutSources(list) {
  const arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
  const out = [...new Set(arr.map((w) => addr(w, "payoutSources entry")))];
  if (out.length > 5) throw new Error("payoutSources may name at most 5 wallets");
  return out;
}

// Apply an owner-set payoutSources change to a project record, append-only-audited. `base` is the
// record to start from (the project's EXISTING registry row when editing, or the freshly
// validated project when there is none yet). Returns { project, changed } — `changed` is false
// (and the record byte-for-byte the same modulo re-validation) when the new list is the same set
// as before, so a caller only alerts and grows history on an ACTUAL change, never on every edit
// that happens to repeat the same value.
function withPayoutSources(base, list, { nowUnix } = {}) {
  const next = validatePayoutSources(list);
  const prev = Array.isArray(base && base.payoutSources) ? base.payoutSources : [];
  const same = prev.length === next.length && [...prev].sort().every((w, i) => w === [...next].sort()[i]);
  if (same) return { project: { ...base, payoutSources: prev }, changed: false };
  const history = Array.isArray(base && base.payoutSourcesHistory) ? base.payoutSourcesHistory : [];
  return {
    project: { ...base, payoutSources: next, payoutSourcesHistory: [...history, { payoutSources: next, at: Number(nowUnix) || 0 }] },
    changed: true,
  };
}

// Owner approval. Refuses a mint that is already registered under another project — two
// projects on one mint would run two programmes over the same escrows.
//
// `requireNew` (N2, docs/HUB_JOURNAL_VERIFY_2026-09-18.md, Round 3): set by lib/hub/apply.js
// approve() — the self-serve path — so an APPLICATION can never target an id or mint that already
// belongs to a registered project, regardless of whether that project has program versions yet.
// Without this, an application submitted with an existing (registered, not-yet-termed) project's
// own id AND mint passed every other check here and took the project over: `approveProject`
// returns `{...project}` from the FRESH `validateProject` result, which resets `fundingWallet`,
// `operatorWallets`, `payoutSources` and `payoutSourcesHistory` to the applicant's own — an
// allowlist reset (closed separately) but also a silent change of who owns the project (open until
// this). The owner's own direct edit path (`/api/hub-registry?id=`, routes.js) intentionally
// re-approves the SAME id to edit it and must keep working, so it never passes this flag.
function approveProject(registry, project, { nowUnix, reserved, appliedAt, requireNew = false } = {}) {
  const reg = registry || {};
  if (RESERVED_PROJECT_IDS.has(project.id)) throw new Error(`"${project.id}" is a reserved id — pick another`);
  // The built-in programmes (CLKN, CUNA, ROSE) are code, not registry rows, so the loop below could
  // not see them and a second project was approvable on CUNA's live mint — double-crediting the same
  // escrows (deep dive 2026-09-17 P1-030). `reserved` is { id: mint } for those.
  for (const [rid, rmint] of Object.entries(reserved || {})) {
    if (rid === project.id) throw new Error(`"${rid}" is a built-in programme id — pick another`);
    if (rmint && rmint === project.mint) throw new Error(`mint ${project.mint} is the built-in "${rid}" programme — it cannot be registered under another id`);
  }
  for (const [otherId, other] of Object.entries(reg)) {
    if (otherId !== project.id && other && other.mint === project.mint && other.status !== "suspended") {
      throw new Error(`mint ${project.mint} is already registered as project "${otherId}"`);
    }
  }
  if (requireNew && reg[project.id] && reg[project.id].status !== "suspended") {
    const err = new Error(`project "${project.id}" already exists — it cannot be approved as a new project; the owner edits an existing project through /api/hub-registry?id=`);
    err.code = "project_exists";
    throw err;
  }
  if (reg[project.id] && reg[project.id].status === "approved" && reg[project.id].mint !== project.mint) {
    throw new Error(`project "${project.id}" is approved on a different mint; the reward asset and mint are immutable — use a new project id`);
  }
  // Re-approving keeps the months already paid; only the tier and note are re-decided.
  const prev = reg[project.id] && reg[project.id].access;
  const acc = prev ? { ...prev, tier: project.access.tier, note: project.access.note } : project.access;
  const prevMilestones = (reg[project.id] && reg[project.id].milestones) || (project.milestones || null);
  let milestones = setMilestoneOnce(prevMilestones, "approvedAt", nowUnix);
  if (appliedAt != null) milestones = setMilestoneOnce(milestones, "appliedAt", appliedAt);
  const approved = { ...project, access: acc, status: "approved", approvedAt: Number(nowUnix), approvedBy: "owner", milestones };
  return { ...reg, [project.id]: approved };
}

// Program terms. Mirrors lib/cuna-programme.validateConfig, generalised: the exclusion rule is
// "every wallet that FUNDS the pool, plus the project's funding wallet, is excluded" (Rule B per
// project), instead of the CLKN treasury by name.
function validateTerms(input, project) {
  const t = { ...(input || {}) };
  const num = (k, lo, hi, dflt) => {
    const v = Number(t[k] == null ? dflt : t[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}: got ${t[k]}`);
    return v;
  };
  const out = {};
  let pool;
  try { pool = BigInt(t.poolDailyRaw == null ? 0 : t.poolDailyRaw); } catch (_) { throw new Error(`poolDailyRaw must be whole base units: got ${t.poolDailyRaw}`); }
  if (pool < 0n) throw new Error("poolDailyRaw cannot be negative");
  out.poolDailyRaw = pool.toString();
  out.sharePct = num("sharePct", 0.01, 100, 5);
  out.maxSharePct = num("maxSharePct", 1, 100, 25);
  if (out.poolDailyRaw === "0" && !(out.sharePct > 0)) throw new Error("either poolDailyRaw or sharePct must fund the pool");
  out.minDurationDays = Math.floor(num("minDurationDays", 1, 3650, 90));
  out.maxTermDays = Math.floor(num("maxTermDays", 1, 3650, 540));
  if (out.maxTermDays < out.minDurationDays) throw new Error(`maxTermDays (${out.maxTermDays}) cannot be below minDurationDays (${out.minDurationDays})`);
  let floor;
  try { floor = BigInt(t.minLockRaw == null ? 0 : t.minLockRaw); } catch (_) { throw new Error(`minLockRaw must be whole base units: got ${t.minLockRaw}`); }
  if (floor < 0n) throw new Error("minLockRaw cannot be negative");
  out.minLockRaw = floor.toString();
  const cap = Number(t.maxWalletSharePct == null ? 0 : t.maxWalletSharePct);
  if (!Number.isFinite(cap) || cap < 0 || cap >= 100) throw new Error(`maxWalletSharePct must be 0 (off) or in (0,100): got ${t.maxWalletSharePct}`);
  out.maxWalletSharePct = cap;
  out.cancelableAllowed = t.cancelableAllowed === true;
  out.fundedBy = [...new Set((Array.isArray(t.fundedBy) ? t.fundedBy : [project.fundingWallet]).map((w) => addr(w, "fundedBy entry")))];
  const ex = new Set((Array.isArray(t.excludeWallets) ? t.excludeWallets : []).map((w) => addr(w, "excludeWallets entry")));
  ex.add(project.fundingWallet);
  for (const w of out.fundedBy) ex.add(w);
  out.excludeWallets = [...ex].sort();
  out.backdateCapDays = Math.floor(num("backdateCapDays", 0, 3650, 30));
  out.backdateNotBefore = Math.floor(num("backdateNotBefore", 0, 4102444800, 0));
  // Cadence (owner, 2026-09-16: "weekly, monthly, at the end of a lock"). `at-unlock` pays each
  // wallet when its own lock finishes releasing — the accrual is unchanged, only when it is paid.
  out.payoutSchedule = String(t.payoutSchedule || "weekly");
  if (!["daily", "weekly", "monthly", "at-unlock", "manual"].includes(out.payoutSchedule)) {
    throw new Error(`payoutSchedule must be daily, weekly, monthly, at-unlock or manual: got ${t.payoutSchedule}`);
  }
  // Which lock SHAPES qualify (owner: "vesting versus no vesting"). The engine already earns only
  // on what is still locked, so this only decides admission: `any` (default), `cliff-only` (a
  // single release at the cliff — the "no vesting" lock), `vesting-only` (periodic releases).
  out.vesting = String(t.vesting || "any");
  if (!["any", "cliff-only", "vesting-only"].includes(out.vesting)) throw new Error(`vesting must be any, cliff-only or vesting-only: got ${t.vesting}`);
  return out;
}

// ── the operator onboarding clock (Colosseum E7) ─────────────────────────────────────────────
// Six choke points, each set at most once: appliedAt (the /hub-apply submission, absent for a
// project the owner seeds directly through /api/hub-registry?id=), approvedAt (owner approval),
// firstPaidAt (first access payment verified), firstVersionPublishedAt (first program version),
// firstArmedAt (lock-to-earn armed for the first time — mirrors state.startedAt, which the engine
// already never moves once set), firstBatchSignedAt (first batch row recorded sent). Never
// overwritten: a milestone already on the record is kept exactly, even across a re-approval or a
// disarm/re-arm cycle, because "first" only ever means the first time.
function milestonesInit() {
  return { appliedAt: null, approvedAt: null, firstPaidAt: null, firstVersionPublishedAt: null, firstArmedAt: null, firstBatchSignedAt: null };
}
function setMilestoneOnce(milestones, key, value) {
  const m = { ...milestonesInit(), ...(milestones || {}) };
  if (m[key] == null && value != null && Number.isFinite(Number(value))) m[key] = Number(value);
  return m;
}

function versionRecord(project, version, terms, effectiveFrom) {
  const body = {
    projectId: project.id, version, effectiveFrom, effectiveTo: null,
    mint: project.mint, rewardMint: project.rewardMint, rewardDecimals: project.rewardDecimals,
    rewardTokenProgram: project.rewardTokenProgram,
    fundingResponsibility: project.fundingWallet, signer: project.fundingWallet,
    exclusions: { rule: "B", wallets: terms.excludeWallets },
    terms,
  };
  return { ...body, hash: sha256(canonicalJson(body)) };
}

// Create version n+1 (or v1). Boundaries are UTC days: effectiveFrom is YYYY-MM-DD and takes
// effect at 00:00 UTC; it must be after the current version's effectiveFrom and not before
// today, so no period ever straddles two versions and no accrued period changes version.
function createVersion(state, project, termsInput, { effectiveFrom, todayKey }) {
  if (!DAY_RE.test(String(effectiveFrom))) throw new Error(`effectiveFrom must be YYYY-MM-DD: got ${effectiveFrom}`);
  if (!DAY_RE.test(String(todayKey))) throw new Error(`todayKey must be YYYY-MM-DD: got ${todayKey}`);
  if (effectiveFrom < todayKey) throw new Error(`effectiveFrom ${effectiveFrom} is in the past — periods already accrued keep their version`);
  const versions = Array.isArray(state && state.versions) ? state.versions : [];
  const current = versions[versions.length - 1] || null;
  if (current && effectiveFrom <= current.effectiveFrom) throw new Error(`effectiveFrom must be after v${current.version}'s ${current.effectiveFrom}`);
  const terms = validateTerms(termsInput, project);
  const next = versionRecord(project, versions.length + 1, terms, effectiveFrom);
  const closed = current ? { ...current, effectiveTo: effectiveFrom } : null;
  const out = closed ? [...versions.slice(0, -1), closed, next] : [next];
  return { ...(state || {}), versions: out };
}

// The version in force for a period key ("YYYY-MM-DD" or "YYYY-MM-DDTHH"): the last version whose
// effectiveFrom <= the period's day. Null before v1.
function versionFor(state, periodKey) {
  const day = String(periodKey).slice(0, 10);
  const versions = Array.isArray(state && state.versions) ? state.versions : [];
  let hit = null;
  for (const v of versions) if (v.effectiveFrom <= day) hit = v;
  return hit;
}

// A version's hash must be recomputable from the record itself — this is what the public page
// and the on-chain memo commit to.
// effectiveTo is BOOKKEEPING set later when the next version closes this one (design §2: "v1
// keeps its hash and gains effectiveTo") — it is never part of what was hashed. Verifying with
// the mutated value made every closed version fail verification on the public page (found by
// the cadence/vesting test, 2026-09-16). Hash exactly what versionRecord hashed.
// `commitment` (Addendum B5, lib/hub/commit.js) is bookkeeping added AFTER publish, exactly like
// effectiveTo — it records that something later happened to this version, it was never part of
// what versionRecord hashed, and it must never be. Strip both before recomputing.
function verifyVersionHash(v) {
  const { hash, effectiveTo, commitment, ...body } = v || {};
  return typeof hash === "string" && sha256(canonicalJson({ ...body, effectiveTo: null })) === hash;
}

module.exports = { TOKEN_PROGRAMS, UNSUPPORTED_EXTENSIONS, RESERVED_PROJECT_IDS, canonicalJson, sha256, validateProject, approveProject, validateTerms, createVersion, versionFor, verifyVersionHash, milestonesInit, setMilestoneOnce, validatePayoutSources, withPayoutSources, normalizeVaultProject, validateBrand: brandLib.validateBrand };
