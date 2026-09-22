// Cluck Norris — Seeker app, Buy Special pane (docs/SEEKER_TOOLS_BUILD.md — registry id "buyspecial").
//
// PASS-GATED (the unified tools pass, §5 of the build doc). Pages preview free — the explainer,
// the mint field, the window chips and the empty states render to anyone; only the two on-chain
// reads below need the pass. READ-ONLY: this pane never builds, signs or sends a transaction — it
// scans buys, checks who still holds them, and previews a % bonus. Rebuilt from
// public/buyspecial-pro.html's BEHAVIOUR, never its markup — that page is served at both
// /buyspecial and /rose (AGENTS.md's file/route mismatch note) and is really three tools in one:
// a buyer scanner, a hold/eligibility checker, and (Step 3, deliberately NOT rebuilt here) an
// in-page prize sender. Nothing in this file signs or sends — see "What was left out" below.
//
// Servers called, every shape pinned from reading the handler, not the desktop page's comments
// (server.js's own comment on crosscheck is incomplete — see the tokensBought note below):
//
// GET /api/buyspecial-crosscheck?mint=&from=&to=  (server.js ~9478, toolPassGate-protected)
//   200 { success:true, source:"helius"|"geckoterminal"|"solana-tracker"|"multi-source",
//         buyers:[{ wallet, buyCount, volumeSol, tokensBought, maxBuySol }], buyerCount,
//         tradesScanned?, reachedWindowStart }   — reachedWindowStart:false = the scan only
//         covered the recent part of the window (ST fallback), same meaning as X-Ray's `truncated`.
//   200 { success:false, error:"No buyer data from any source" }  — soft failure, still HTTP 200;
//         gatedToolFetch treats this as `unavailable` (status 200 but success:false), which is the
//         right call here too — the window not "buyer-free", the source lookup returned nothing.
//   402/403 { success:false, error:"pass_required"|"insufficient_holdings"|"bad_pass"|"pass_expired", detail }
//   400 { success:false, error }  — bad mint or window (need mint, from<to, unix seconds)
//   ⚠️ tokensBought is only reliably populated when source==="helius" — the GeckoTerminal and
//   Solana Tracker fallback paths (lib/helius-trades.js geckoBuyersInWindow / solana-tracker.js)
//   build their buyer objects WITHOUT a tokensBought field (confirmed by reading both — the desktop
//   page never mentions this and just does `b.tokensBought||0`, silently reading 0). This pane
//   surfaces the source and warns when it isn't "helius" rather than showing a confident 0.
//
// GET /api/buyspecial-holdcheck?mint=&wallets=&from=&to=  (server.js ~9516, toolPassGate-protected)
//   200 { success:true, results:[{ wallet, balance:number|null, sells:number|null,
//         transfersOut?, soldInWindow, source:"helius"|"solana-tracker"|"none"|"error" }] }
//   `soldInWindow` is only authoritative when source==="helius" (server's own comment) — an
//   unscoped fallback can't prove a drop, so this pane never disqualifies on soldInWindow alone
//   without checking that. Max 200 wallets per call (server 400s above that) — chunked below.
//   402/403 same pass-denial shapes as crosscheck. 400 on a bad mint/window/wallet list.
//
// GET /api/buyspecial-trace?mint=&wallet=&from=&to=  (server.js ~10237, toolPassGate-protected)
//   One-hop trace for a wallet that moved its buy elsewhere: did the destination wallet still
//   hold it, sell it, or is it a dead end?
//   200 { success:true, resolved:"none", note }                                — no transfer out
//   200 { success:true, resolved:"split", dests:[{to,amount}], note }          — split, manual
//   200 { success:true, resolved:"unresolved", payTo, moved, note }            — dest lookup failed
//   200 { success:true, resolved:"sold", payTo, moved, note }                  — dest sold downstream
//   200 { success:true, resolved:"empty", payTo, moved, note }                 — dest holds 0
//   200 { success:true, resolved:"held", payTo, moved, destHeld, note }        — dest still holds it
//   200 { success:false, error:"source lookup failed" }  — soft failure (200 + success:false),
//         same `unavailable` classification as crosscheck's soft failure above.
//   402/403/400 as above.
//
// GET /api/buycomp/presets  (server.js ~7887, PUBLIC, no pass) — up to 8 live/recent buy
//   competitions the Telegram bot is already running, for a one-tap prefill. Always
//   `{ ok:true, comps:[...] }` — the handler wraps its own lookup in try/catch and answers an
//   empty list on any failure, so unlike every gated read above there is NO way to tell "no live
//   comps" from "couldn't check" from this response alone. Treated here as a best-effort
//   convenience, not a fact this pane vouches for: a miss just hides the prefill chips, no
//   Unavailable state, nothing that could read as a wrong on-chain answer.
//
// What was DELIBERATELY LEFT OUT (see the handback report for the full reasoning):
//   - Step 3 of the desktop tool (connect a sending wallet, build/sign/send the prize transfers)
//     — this app is read-only; a wallet-signing money-movement flow does not belong in this pane.
//   - Reward-token choice (SOL / USDC / another mint) — the desktop tool prices these through
//     /api/token-price to convert the % basis; skipped here to keep the preview to what the two
//     pass-gated reads above actually hand back (the comp token's own units), never an invented
//     number this pane can't attribute to a source.
//   - "Ranked winners" mode (rank-by / prize pool / equal-fixed-prorata split) — the desktop tool's
//     second reward mode. Kept to the more common "reward every holder a %" shape to keep this
//     pane's math auditable in one pass; the two forensic reads (who bought, who still holds) are
//     unchanged and are the part that is actually a chain fact.
//   - /api/buyspecial/draw, /draw/public, /draw/payout, /api/buyspecial/campaign, /optin,
//     /optin/manual, /api/admin-check — the first three are a SEPARATE raffle/giveaway feature
//     (buyCompAdminOK-gated to create; buyspecial-pro.html never calls them). The campaign/optin
//     group belongs to the separate public opt-in page (buyspecial-optin.html) and the operator
//     dashboard — and "buyspecial-dashboard" is explicitly on SEEKER_TOOLS_BUILD.md's excluded
//     list. admin-check is the operator-key exemption from the pass; this app has no operator
//     surface, so it is never called.
//
// "Say what's on-chain, never why": every row here is a buy count, a balance and a sell/transfer
// flag, on-chain facts as the server itself scoped them — never a verdict about intent, never
// "safe" or "verified". The bonus-% figure is a PREVIEW this pane computes locally from those
// facts for whoever is sizing a competition — never a promise this app can pay (it can't send).
import React from "react";
import { t, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, useOnline } from "../pane.jsx";
import { usePass } from "../pass.js";
import { PassGate, gatedToolFetch } from "../passgate.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const HOLDCHECK_CHUNK = 200; // server's own hard limit (server.js ~9531) — chunk to stay under it

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
function fmtSol(n) { return (Number(n) || 0).toFixed(2); }
function nowSec() { return Math.floor(Date.now() / 1000); }
// <input type="datetime-local"> plumbing — local wall-clock string <-> unix seconds.
function toLocalInput(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function parseLocalInput(s) { if (!s) return 0; const ms = new Date(s).getTime(); return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0; }
// Only render an href built from a value this pane validated itself — chain data is
// attacker-controlled and React's escaping does not neutralise an href (CLAUDE.md).
function safeHref(u) { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : null; }
function solscanToken(mint) { return safeHref(`https://solscan.io/token/${encodeURIComponent(mint)}`); }

// The tools-pass gate lives in ONE file — src/seeker/passgate.jsx. See that file's header for
// why it was extracted before it drifted rather than after.

const WINDOW_PRESET_HOURS = [24, 48, 72, 168];
const WINDOW_PRESET_LABEL = { 24: "Last 24 hours", 48: "Last 48 hours", 72: "Last 72 hours", 168: "Last 7 days" };

// Eligibility/preview status a computed row can carry — every label is a fact about what the
// hold-check found, never a safety verdict.
const STATUS_LABEL = {
  sold: "Sold in the window — disqualified",
  notEligible: "Not eligible",
  lookupFailed: "Hold lookup failed — verify by hand",
  movedPartial: "Moved some out — previewed on what's still held",
  held: "Held — no sell found",
  notRequired: "Holding not required for this comp",
};
const STATUS_CLASS = {
  sold: "seeker-bs-tag-bad", notEligible: "seeker-bs-tag-bad", lookupFailed: "seeker-bs-tag-muted",
  movedPartial: "seeker-bs-tag-warn", held: "seeker-bs-tag-ok", notRequired: "seeker-bs-tag-ok",
};
const TRACE_NOTE = {
  none: "No outgoing transfer found in the window.",
  split: "Moved across more than one wallet — resolve by hand.",
  unresolved: "Could not look up the destination wallet.",
  sold: "The wallet it moved to has since sold — nothing further to trace.",
  empty: "The wallet it moved to now holds zero.",
  held: "Still held at the destination wallet.",
};

function BuyerRow({ b, rank, onExclude }) {
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>#{rank} {shortAddr(b.wallet)}</span></div>
        <div className="seeker-forensic-row-sub">{fmtInt(b.buyCount || 0)} {t("buys")} · {fmtSol(b.volumeSol)} SOL</div>
        <div className="seeker-bs-rowactions">
          <button type="button" className="seeker-bs-smallbtn" onClick={onExclude}>{t("Exclude")}</button>
        </div>
      </div>
      <div className="seeker-forensic-row-value">{fmtNum(b.tokensBought || 0)}</div>
    </div>
  );
}

function TraceResult({ data }) {
  if (!data || !data.resolved) return <div className="seeker-bs-tracebox">{t("Trace failed — try again shortly.")}</div>;
  const base = t(TRACE_NOTE[data.resolved] || data.resolved);
  if (data.resolved === "held") {
    return <div className="seeker-bs-tracebox">{base} {fmtNum(data.moved)} {t("moved to")} {shortAddr(data.payTo)} · {fmtNum(data.destHeld)} {t("held there now")}.</div>;
  }
  if (data.resolved === "sold" || data.resolved === "empty" || data.resolved === "unresolved") {
    return <div className="seeker-bs-tracebox">{base}{data.payTo ? ` (${shortAddr(data.payTo)})` : ""}</div>;
  }
  return <div className="seeker-bs-tracebox">{base}</div>;
}

function ResultRow({ r, trace, onTrace }) {
  // Same one-hop-trace condition the desktop tool uses: some of the buy moved elsewhere and the
  // destination is still an open question worth following.
  const showTrace = r.held != null && r.held >= 0 && (r.transfersOut || 0) > 0 && r.held < r.bought;
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>{shortAddr(r.wallet)}</span></div>
        <div className="seeker-forensic-row-sub">
          {fmtNum(r.bought)} {t("bought")}{r.held != null && r.held >= 0 ? <> · {fmtNum(r.held)} {t("held now")}</> : null}
        </div>
        <span className={"seeker-forensic-row-tag " + (STATUS_CLASS[r.statusKey] || "")}>{t(STATUS_LABEL[r.statusKey] || r.statusKey)}</span>
        {showTrace ? (
          <div className="seeker-bs-rowactions">
            <button type="button" className="seeker-bs-smallbtn" disabled={trace && trace.status === "loading"} onClick={onTrace}>
              {trace && trace.status === "loading" ? t("Tracing…") : t("Trace moved tokens")}
            </button>
          </div>
        ) : null}
        {trace && trace.status === "done" ? <TraceResult data={trace.data} /> : null}
        {trace && trace.status === "error" ? <div className="seeker-bs-tracebox">{t("Could not trace this wallet's transfer right now.")}</div> : null}
      </div>
      <div className="seeker-forensic-row-value">{r.eligible ? fmtNum(r.payout) : "—"}</div>
    </div>
  );
}

export default function BuySpecialPane({ wallet }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const pass = usePass();

  // ── config form state ────────────────────────────────────────────────────────────────────
  const [mintInput, setMintInput] = React.useState("");
  const [windowFrom, setWindowFrom] = React.useState(0);
  const [windowTo, setWindowTo] = React.useState(0);
  const [activePresetHours, setActivePresetHours] = React.useState(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [requireHold, setRequireHold] = React.useState(true);
  const [holdHours, setHoldHours] = React.useState("");
  const [bonusPct, setBonusPct] = React.useState("10");
  const [ignoreText, setIgnoreText] = React.useState("");
  const [formError, setFormError] = React.useState(null);
  const [comps, setComps] = React.useState([]);

  // ── step 1: scan buys ────────────────────────────────────────────────────────────────────
  const [scanPhase, setScanPhase] = React.useState("form"); // form | loading | result | unavailable | refused
  const [scanErrKind, setScanErrKind] = React.useState("unavailable");
  const [scanErrMsg, setScanErrMsg] = React.useState(null);
  const [buyers, setBuyers] = React.useState(null);
  const [source, setSource] = React.useState("");
  const [reachedWindowStart, setReachedWindowStart] = React.useState(true);
  const [scannedMint, setScannedMint] = React.useState("");
  const [scannedFrom, setScannedFrom] = React.useState(0);
  const [scannedTo, setScannedTo] = React.useState(0);
  const [buyerShown, setBuyerShown] = React.useState(20);

  // ── step 2: verify holds & preview ───────────────────────────────────────────────────────
  const [computePhase, setComputePhase] = React.useState("idle"); // idle | loading | result | unavailable | refused
  const [computeErrKind, setComputeErrKind] = React.useState("unavailable");
  const [computeErrMsg, setComputeErrMsg] = React.useState(null);
  const [rows, setRows] = React.useState(null);
  const [computeMeta, setComputeMeta] = React.useState({ eligibleCount: 0, dqCount: 0, total: 0 });
  const [resultShown, setResultShown] = React.useState(20);
  const [traceMap, setTraceMap] = React.useState({});

  const [gateOpen, setGateOpen] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState(null); // "scan" | "compute" | null
  const abortRef = React.useRef(null);
  // Compute's own controller (separate from the scan's `abortRef`): a fresh scan or a fresh
  // compute must both be able to invalidate a compute already in flight, so a stale run that
  // resolves late can never overwrite `rows`/`computeMeta` with an answer for a buyer list that
  // is no longer on screen. `gatedToolFetch` (passgate.jsx) doesn't thread a signal into the
  // underlying request — same limitation `abortRef` above already has — so the guard that
  // actually does the work is the ref-identity check in doCompute()'s `.then()`, not the network
  // cancellation; `.abort()` is still called for the same reason `abortRef` calls it.
  const computeAbortRef = React.useRef(null);
  React.useEffect(() => () => {
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    try { computeAbortRef.current && computeAbortRef.current.abort(); } catch (_) {}
  }, []);

  // Free, unauthenticated convenience — see the file header on why a miss here is silent rather
  // than an Unavailable state: the endpoint itself can't tell "no live comps" from "couldn't check".
  React.useEffect(() => {
    let alive = true;
    fetch("/api/buycomp/presets").then((r) => r.json()).then((d) => {
      if (alive && d && Array.isArray(d.comps)) setComps(d.comps);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const ignoreSet = React.useMemo(
    () => new Set((ignoreText || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)),
    [ignoreText]
  );
  const activeBuyers = React.useMemo(() => (buyers || []).filter((b) => !ignoreSet.has(b.wallet)), [buyers, ignoreSet]);
  const totalBought = React.useMemo(() => activeBuyers.reduce((s, b) => s + (Number(b.tokensBought) || 0), 0), [activeBuyers]);

  function selectPreset(hours) {
    const to = nowSec();
    setWindowFrom(to - hours * 3600); setWindowTo(to); setActivePresetHours(hours);
  }
  function applyComp(c) {
    setFormError(null);
    if (c.mint && ADDR_RE.test(c.mint)) setMintInput(c.mint);
    const from = c.startTs ? Math.floor(c.startTs / 1000) : 0, to = c.endTs ? Math.floor(c.endTs / 1000) : 0;
    if (from && to && to > from) { setWindowFrom(from); setWindowTo(to); setActivePresetHours(null); }
    if (c.pctPrize && Array.isArray(c.places) && c.places.length === 1) setBonusPct(String(c.places[0]));
  }
  function excludeWallet(w) {
    setIgnoreText((prev) => {
      const set = new Set((prev || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
      if (set.has(w)) return prev;
      return prev && prev.trim() ? prev.trim() + "\n" + w : w;
    });
  }

  function doScan(mint, from, to) {
    if (!online) { setScanPhase("unavailable"); setScanErrKind("offline"); setScanErrMsg(null); return; }
    setScanPhase("loading");
    setComputePhase("idle"); setRows(null); setTraceMap({}); setBuyerShown(20);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    // A fresh scan invalidates any compute still running against the PREVIOUS scan's buyers —
    // letting it land after this would overwrite rows/computeMeta next to a brand-new buyer list
    // it no longer corresponds to.
    try { computeAbortRef.current && computeAbortRef.current.abort(); } catch (_) {}
    computeAbortRef.current = null;   // so the superseded run's identity check fails even if its last chunk was already in flight (verifier on #396, P1-3)
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/buyspecial-crosscheck?mint=${encodeURIComponent(mint)}&from=${from}&to=${to}`;
    gatedToolFetch(pass.gatedFetch, url).then((res) => {
      // A newer scan (or unmount) supersedes this one: drop its result rather than let an older
      // buyer list land over a newer one (verifier on #396, P3-7 — gatedToolFetch carries no
      // signal, so the identity check is the only stop).
      if (ctrl.signal.aborted || abortRef.current !== ctrl) return;
      if (res.kind === "aborted") return;
      if (!res.ok) {
        if (pass.isDenial(res.body)) { pass.refresh(); setPendingAction("scan"); setGateOpen(true); setScanPhase("form"); return; }
        if (res.kind === "offline") { setScanPhase("unavailable"); setScanErrKind("offline"); setScanErrMsg(null); return; }
        if (res.kind === "refused") { setScanPhase("refused"); setScanErrMsg((res.body && res.body.error) || t("That mint or window wasn't something we could use.")); return; }
        setScanPhase("unavailable"); setScanErrKind("unavailable");
        setScanErrMsg(t("Could not read buys for this token from the chain right now. Try again shortly."));
        return;
      }
      setBuyers(res.data.buyers || []);
      setSource(res.data.source || "on-chain");
      setReachedWindowStart(res.data.reachedWindowStart !== false);
      setScannedMint(mint); setScannedFrom(from); setScannedTo(to);
      setScanPhase("result");
    });
  }

  function runScan() {
    const mint = mintInput.trim();
    if (!ADDR_RE.test(mint)) { setFormError(t("Enter a valid Solana token mint address.")); return; }
    if (!windowFrom || !windowTo || windowTo <= windowFrom) { setFormError(t("Set a buy window — pick a quick range or a custom start and end.")); return; }
    setFormError(null);
    // "unsignable" — no wallet on this device can produce a signature, so a pass can never be
    // obtained here. Running anyway would just draw a real 402 from the server.
    if (pass.status === "unsignable") return;
    if (pass.status === "needed") { setPendingAction("scan"); setGateOpen(true); return; }
    doScan(mint, windowFrom, windowTo);
  }

  // Fetches one hold-check chunk at a time (server caps a single call at 200 wallets) and stops
  // on the FIRST failure — a partial holdMap rendered as if it were the whole answer would be
  // exactly the "empty read that isn't" this app is built to never do. `ctrl` is this run's own
  // AbortController (see computeAbortRef above): checked between chunks so a superseded run
  // stops making further requests rather than racing a newer one to the finish.
  async function runHoldcheckChunks(wallets, mint, from, to, ctrl) {
    const holdMap = {};
    for (let i = 0; i < wallets.length; i += HOLDCHECK_CHUNK) {
      if (ctrl && ctrl.signal.aborted) return { ok: false, kind: "aborted" };
      const chunk = wallets.slice(i, i + HOLDCHECK_CHUNK);
      const url = `/api/buyspecial-holdcheck?mint=${encodeURIComponent(mint)}&from=${from}&to=${to}&wallets=${encodeURIComponent(chunk.join(","))}`;
      const res = await gatedToolFetch(pass.gatedFetch, url);
      if (!res.ok) return res;
      for (const r of (res.data.results || [])) holdMap[r.wallet] = r;
    }
    return { ok: true, holdMap };
  }

  // Pure client math over data already fetched — the % preview. `holdMapOrNull` is null when
  // holding wasn't required at all (no fetch needed: every buyer with a qualifying buy previews).
  function finalizeRows(active, holdMapOrNull, holdHoursNum) {
    const stillMustHold = requireHold && holdHoursNum === 0;
    const pct = (parseFloat(bonusPct) || 0) / 100;
    const computed = active.map((b) => {
      const bought = Number(b.tokensBought) || 0;
      if (!requireHold) {
        const eligible = bought > 0;
        return { wallet: b.wallet, bought, held: null, transfersOut: 0, statusKey: "notRequired", eligible, payout: eligible ? bought * pct : 0 };
      }
      const h = (holdMapOrNull && holdMapOrNull[b.wallet]) || null;
      const lookupFailed = !h || h.balance == null;
      const held = lookupFailed ? -1 : Number(h.balance) || 0;
      const sold = !!(h && h.soldInWindow);
      const transfersOut = (h && h.transfersOut) || 0;
      const eligible = bought > 0 && !sold && (!stillMustHold || held > 0);
      const cap = (stillMustHold && held >= 0) ? Math.min(bought, held) : bought;
      const payout = eligible ? cap * pct : 0;
      let statusKey;
      if (sold) statusKey = "sold";
      else if (!eligible) statusKey = lookupFailed ? "lookupFailed" : "notEligible";
      else if (stillMustHold && held >= 0 && held < bought) statusKey = "movedPartial";
      else statusKey = "held";
      return { wallet: b.wallet, bought, held, transfersOut, statusKey, eligible, payout };
    });
    const eligibleRows = computed.filter((r) => r.eligible);
    setRows(computed);
    setResultShown(20);
    setComputeMeta({ eligibleCount: eligibleRows.length, dqCount: computed.length - eligibleRows.length, total: eligibleRows.reduce((s, r) => s + r.payout, 0) });
    setComputePhase("result");
  }

  function doCompute() {
    const active = activeBuyers;
    if (!active.length) return;
    const holdHoursNum = Math.max(0, parseFloat(holdHours) || 0);
    if (!requireHold) { finalizeRows(active, null, 0); return; }
    if (!online) { setComputePhase("unavailable"); setComputeErrKind("offline"); setComputeErrMsg(null); return; }
    setComputePhase("loading");
    // This run's own controller — a NEWER compute (or a fresh scan, see doScan) invalidates the
    // one before it, the same shape as the scan's own abortRef above.
    try { computeAbortRef.current && computeAbortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    computeAbortRef.current = ctrl;
    const now = nowSec();
    const checkTo = holdHoursNum > 0 ? Math.min(now, scannedTo + Math.round(holdHoursNum * 3600)) : now;
    runHoldcheckChunks(active.map((b) => b.wallet), scannedMint, scannedFrom, checkTo, ctrl).then((res) => {
      // Superseded by a newer compute or a fresh scan — drop this run's result rather than let
      // it land over whatever replaced it.
      if (ctrl.signal.aborted || computeAbortRef.current !== ctrl) return;
      if (!res.ok) {
        if (res.kind === "aborted") return;
        if (pass.isDenial(res.body)) { pass.refresh(); setPendingAction("compute"); setGateOpen(true); setComputePhase("idle"); return; }
        if (res.kind === "offline") { setComputePhase("unavailable"); setComputeErrKind("offline"); setComputeErrMsg(null); return; }
        if (res.kind === "refused") { setComputePhase("refused"); setComputeErrMsg((res.body && res.body.error) || t("That request wasn't something we could use.")); return; }
        setComputePhase("unavailable"); setComputeErrKind("unavailable");
        setComputeErrMsg(t("Could not verify holdings from the chain right now. Try again shortly."));
        return;
      }
      finalizeRows(active, res.holdMap, holdHoursNum);
    });
  }

  function runCompute() {
    if (!activeBuyers.length) return;
    if (requireHold && pass.status === "unsignable") return;
    if (requireHold && pass.status === "needed") { setPendingAction("compute"); setGateOpen(true); return; }
    doCompute();
  }

  function onUnlocked() {
    setGateOpen(false); pass.refresh();
    const action = pendingAction; setPendingAction(null);
    if (action === "compute") doCompute(); else doScan(mintInput.trim(), windowFrom, windowTo);
  }

  async function traceWallet(w) {
    setTraceMap((m) => ({ ...m, [w]: { status: "loading" } }));
    const url = `/api/buyspecial-trace?mint=${encodeURIComponent(scannedMint)}&wallet=${encodeURIComponent(w)}&from=${scannedFrom}&to=${nowSec()}`;
    const res = await gatedToolFetch(pass.gatedFetch, url);
    if (!res.ok) {
      if (pass.isDenial(res.body)) { pass.refresh(); setTraceMap((m) => ({ ...m, [w]: { status: "idle" } })); setGateOpen(true); return; }
      setTraceMap((m) => ({ ...m, [w]: { status: "error" } }));
      return;
    }
    setTraceMap((m) => ({ ...m, [w]: { status: "done", data: res.data } }));
  }

  const scanRunDisabled = scanPhase === "loading" || pass.status === "loading";
  const computeRunDisabled = computePhase === "loading" || pass.status === "loading" || activeBuyers.length === 0;
  const scanTokenLink = scanPhase === "result" ? solscanToken(scannedMint) : null;

  return (
    <Pane icon="🎯" title="Buy Special">
      <p className="seeker-tool-lede">{t("Scan who bought a token in a time window, see who still holds it, and preview a % bonus before you run a competition on the full site.")}</p>

      <div className="seeker-forensic-form">
        {comps.length ? (
          <>
            <label className="seeker-listing-label">{t("Live & recent competitions")}</label>
            <div className="seeker-bs-chiprow">
              {comps.map((c) => (
                <button key={c.id} type="button" className="seeker-bs-chip" onClick={() => applyComp(c)}>
                  {c.emoji ? c.emoji + " " : ""}{c.ticker || t("Token")}{c.status === "live" ? " ●" : ""}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <label className="seeker-listing-label" htmlFor="bs-mint">{t("Token mint address")}</label>
        <div className="seeker-bs-chiprow">
          <button type="button" className={"seeker-bs-chip" + (mintInput.trim() === CLKN_MINT ? " seeker-bs-chip-active" : "")} onClick={() => { setMintInput(CLKN_MINT); setFormError(null); }}>
            🐔 CLKN
          </button>
        </div>
        <input
          id="bs-mint" className="seeker-listing-input" value={mintInput}
          onChange={(e) => { setMintInput(e.target.value); setFormError(null); }}
          placeholder={t("Paste a token's mint address")} autoComplete="off" spellCheck="false"
        />

        <label className="seeker-listing-label">{t("Buy window")}</label>
        <div className="seeker-bs-chiprow">
          {WINDOW_PRESET_HOURS.map((h) => (
            <button key={h} type="button" className={"seeker-bs-chip" + (activePresetHours === h ? " seeker-bs-chip-active" : "")} onClick={() => selectPreset(h)}>
              {t(WINDOW_PRESET_LABEL[h])}
            </button>
          ))}
        </div>
        {windowFrom && windowTo ? (
          <p className="seeker-bs-windownote">{new Date(windowFrom * 1000).toLocaleString()} → {new Date(windowTo * 1000).toLocaleString()}</p>
        ) : null}

        <button type="button" className="seeker-listing-more-toggle" onClick={() => setAdvancedOpen((a) => !a)}>
          {advancedOpen ? t("Hide advanced options") : t("Custom window, hold rules & exclusions")}
        </button>
        {advancedOpen ? (
          <div className="seeker-listing-more">
            <label className="seeker-listing-label" htmlFor="bs-from">{t("Custom start")}</label>
            <input id="bs-from" type="datetime-local" className="seeker-listing-input" value={toLocalInput(windowFrom)}
              onChange={(e) => { setWindowFrom(parseLocalInput(e.target.value)); setActivePresetHours(null); }} />
            <label className="seeker-listing-label" htmlFor="bs-to">{t("Custom end")}</label>
            <input id="bs-to" type="datetime-local" className="seeker-listing-input" value={toLocalInput(windowTo)}
              onChange={(e) => { setWindowTo(parseLocalInput(e.target.value)); setActivePresetHours(null); }} />

            <div className="seeker-bs-checkrow" style={{ marginTop: 12 }}>
              <input id="bs-requirehold" type="checkbox" className="seeker-bs-checkbox" checked={requireHold} onChange={(e) => setRequireHold(e.target.checked)} />
              <label htmlFor="bs-requirehold">{t("Require holding — disqualify anyone who sold or moved out their buy")}</label>
            </div>
            {requireHold ? (
              <>
                <label className="seeker-listing-label" htmlFor="bs-holdhours">{t("Hold for this many hours after the window (blank = must still hold right now)")}</label>
                <input id="bs-holdhours" type="number" min="0" step="1" className="seeker-listing-input" value={holdHours} onChange={(e) => setHoldHours(e.target.value)} placeholder={t("e.g. 24")} />
              </>
            ) : null}

            <label className="seeker-listing-label" htmlFor="bs-bonus">{t("Bonus % of tokens bought — used only for the preview below")}</label>
            <input id="bs-bonus" type="number" min="0" step="0.5" className="seeker-listing-input" value={bonusPct} onChange={(e) => setBonusPct(e.target.value)} />

            <label className="seeker-listing-label" htmlFor="bs-ignore">{t("Exclude wallets — one per line")}</label>
            <textarea id="bs-ignore" className="seeker-listing-input seeker-listing-textarea" value={ignoreText} onChange={(e) => setIgnoreText(e.target.value)} placeholder={t("Paste team, insider or treasury addresses to leave out")} />
          </div>
        ) : null}

        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={runScan} disabled={scanRunDisabled}>
          {scanPhase === "loading" ? t("Scanning…") : t("Scan buys")}
        </button>
        {pass.status === "unsignable" ? (
          <div className="seeker-tool-notyet" role="status">
            <p className="seeker-tool-notyet-title">🔒 {t("No wallet on this device can sign")}</p>
            <p>{t("The tools pass needs a signature, and this device has no wallet that can produce one yet. This resolves itself once wallet support lands in the app — nothing you can do here unlocks it early.")}</p>
          </div>
        ) : null}
      </div>

      {scanPhase === "loading" ? <Loading label={t("Scanning the chain for buys in this window…")} /> : null}
      {scanPhase === "unavailable" ? <Unavailable kind={scanErrKind} message={scanErrMsg} onRetry={() => doScan(scannedMint || mintInput.trim(), windowFrom, windowTo)} /> : null}
      {scanPhase === "refused" ? <Refused message={scanErrMsg} /> : null}

      {scanPhase === "result" && buyers && buyers.length === 0 ? (
        <Empty>{t("No buys were found in this window.")}</Empty>
      ) : null}

      {scanPhase === "result" && buyers && buyers.length > 0 ? (
        <>
          {reachedWindowStart === false ? <p className="seeker-tool-note seeker-forensic-truncnote">{t("This scan may not have reached the very start of the window — buyers right at the edge could be missing.")}</p> : null}
          {source && source !== "helius" ? <p className="seeker-tool-note seeker-forensic-truncnote">{t("This source doesn't report tokens bought per wallet — the bonus-% preview below may read 0 for every buyer. SOL-spent figures are still accurate.")}</p> : null}

          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Buyers")}</div><div className="seeker-forensic-stat-value">{fmtInt(activeBuyers.length)}{ignoreSet.size ? ` · ${fmtInt(ignoreSet.size)} ${t("excluded")}` : ""}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Total bought")}</div><div className="seeker-forensic-stat-value">{fmtNum(totalBought)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Source")}</div><div className="seeker-forensic-stat-value">{source}</div></div>
          </div>

          <div className="seeker-listing-card">
            <h2 className="seeker-listing-card-title">{t("Buyers in this window")}</h2>
            {activeBuyers.length === 0 ? (
              <Empty>{t("Every buyer is excluded — clear the ignore list under advanced options.")}</Empty>
            ) : (
              <>
                <div className="seeker-forensic-rows">
                  {activeBuyers.slice(0, buyerShown).map((b, i) => (
                    <BuyerRow key={b.wallet} b={b} rank={i + 1} onExclude={() => excludeWallet(b.wallet)} />
                  ))}
                </div>
                {activeBuyers.length > buyerShown ? (
                  <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => setBuyerShown((n) => n + 20)}>
                    {t("Show more")} ({buyerShown} {t("of")} {activeBuyers.length})
                  </button>
                ) : null}
              </>
            )}
          </div>

          <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={runCompute} disabled={computeRunDisabled}>
            {computePhase === "loading" ? t("Checking holdings…") : t("Verify holds & preview payout")}
          </button>

          {computePhase === "unavailable" ? <Unavailable kind={computeErrKind} message={computeErrMsg} onRetry={runCompute} /> : null}
          {computePhase === "refused" ? <Refused message={computeErrMsg} /> : null}

          {computePhase === "result" && rows ? (
            <>
              <div className="seeker-forensic-statgrid">
                <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Eligible")}</div><div className="seeker-forensic-stat-value">{fmtInt(computeMeta.eligibleCount)}</div></div>
                <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Disqualified")}</div><div className="seeker-forensic-stat-value">{fmtInt(computeMeta.dqCount)}</div></div>
                <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Preview payout")}</div><div className="seeker-forensic-stat-value">{fmtNum(computeMeta.total)}</div></div>
              </div>
              <p className="seeker-forensic-disclaimer">{t("Preview only, in the mint's own on-chain units — this app can't send anything. Run the competition from the full site to actually pay winners.")}</p>

              <div className="seeker-listing-card">
                <h2 className="seeker-listing-card-title">{t("Eligibility & preview")}</h2>
                <div className="seeker-forensic-rows">
                  {rows.slice(0, resultShown).map((r) => (
                    <ResultRow key={r.wallet} r={r} trace={traceMap[r.wallet]} onTrace={() => traceWallet(r.wallet)} />
                  ))}
                </div>
                {rows.length > resultShown ? (
                  <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => setResultShown((n) => n + 20)}>
                    {t("Show more")} ({resultShown} {t("of")} {rows.length})
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {scanTokenLink ? (
            <p style={{ textAlign: "center" }}>
              <a className="seeker-forensic-link" href={scanTokenLink} target="_blank" rel="noopener noreferrer">{t("View token on Solscan")} ↗</a>
            </p>
          ) : null}
        </>
      ) : null}

      {gateOpen ? (
        <PassGate pass={pass} wallet={wallet} tool="buyspecial" onUnlocked={onUnlocked} onClose={() => { setGateOpen(false); setPendingAction(null); }} />
      ) : null}
    </Pane>
  );
}
