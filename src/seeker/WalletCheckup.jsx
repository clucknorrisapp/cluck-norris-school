// Cluck Norris — Seeker app, Wallet Checkup pane (increment 4, docs/SEEKER_APP_PLAN.md §4:
// "approvals, freeze/mint authority, honeypot risk — read-only, free, and the brand").
//
// READ-ONLY, FREE, NO GATE. Calls GET /api/wallet-checkup?wallet=<address> (server.js ~14605) —
// the same scanner that powers /wallet-checkup on the website. Request/response shape verified
// by reading server.js + securitycoop.js directly, not guessed:
//   GET /api/wallet-checkup?wallet=<addr>
//   200 { success: true, wallet, tokensHeld, scanned, capped, unverified,
//         portfolioUsd, atRiskUsd,
//         holdings: [{ mint, amount, symbol, name, logo, priceUsd, valueUsd }],
//         approvals: [{ tokenAccount, mint, delegate, program, delegatedAmount, balance }],
//         riskyHoldings: [{ mint, amount, symbol, valueUsd, issues: [string], severity }] }
//   400 { success: false, error: "Invalid wallet address" }
//   429 { success: false, ok: false, error, retryAfterSec, retryAfter, windowSec }  — one
//        limiter here (rateLimit("forensic", 15/min)), unlike Ask Cluck's two, so there is no
//        minute-vs-daily guess to make.
//   500 { success: false, error: "Server not configured" | <caught msg> }
// `unverified` is load-bearing: mints the RPC couldn't read are NOT folded into "clean" — the
// scan says so explicitly rather than going quiet about what it could not check.
//
// Four states, never conflated (RentReclaim.jsx's rule, CLAUDE.md): not-connected, loading, a
// real result, and unavailable. A failed read NEVER renders as "nothing wrong here" — the single
// worst thing this pane could do is tell someone their wallet is clean when it could not
// actually look (same rule as Rent Reclaim's "RPC outage is unavailable, never a zero").
//
// Brand rule — "say what's on-chain, never why": this renders the server's own plain-English
// issue sentences (mint/freeze authority, honeypot extensions) as facts and never adds a score,
// a verdict word ("safe"/"verified"/"scam"/"rug"), or a rating on top of them. "No issues found
// in the checks completed" — modelled on the website's own wording — is as far as the "clean"
// state goes, and it always names what was and wasn't checked (scan scope + unverified count)
// right next to it, so a partial scan never reads as a full pass.
//
// Guardrail before power: approvals are a real thing a first-timer could act on, but revoking
// needs a wallet signature and that is OUT OF SCOPE tonight (CLAUDE.md: "PLAN != EXECUTE for
// money" / no signing path here). This pane shows the finding and points to the website's own
// /wallet-checkup, which already has the revoke flow — it never builds or signs a transaction.
//
// Offline is first-class, same posture as Ask Cluck: `navigator.onLine` is checked before every
// scan (skips the fetch entirely) and the pane listens for the browser's `online` event to
// rescan automatically once the connection returns.
//
// Every mint/symbol/name here is attacker-controlled chain metadata. This renders it as plain
// React text only — never dangerouslySetInnerHTML (CLAUDE.md's recorded XSS bug class).
import React from "react";
import { t, tf, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import ShieldIcon from "./icons/ShieldIcon.jsx";

const WEBSITE_CHECKUP_URL = "https://clucknorris.app/wallet-checkup";

function isOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch (_) {
    return true;
  }
}

// Dollar formatting via the shared cluck-util.js (loaded as a plain <script> in seeker.html —
// same pattern as RentReclaim.jsx's fmtSol). CluckUtil.fmtUsd returns null for <=0 on purpose
// (a missing price must not read as "$0.00"), which is wrong here: a genuinely empty portfolio
// IS $0.00, so the fallback below only fires for that case, not for a real formatting failure.
function fmtUsd(n) {
  const v = Number(n) || 0;
  try {
    if (typeof window !== "undefined" && window.CluckUtil && typeof window.CluckUtil.fmtUsd === "function") {
      const r = window.CluckUtil.fmtUsd(v);
      if (r) return r;
    }
  } catch (_) {}
  return "$" + v.toFixed(2);
}

function fmtNum(n) {
  try {
    if (typeof window !== "undefined" && window.CluckUtil && typeof window.CluckUtil.fmt === "function") {
      return window.CluckUtil.fmt(n);
    }
  } catch (_) {}
  return Math.round(Number(n) || 0).toLocaleString();
}

// A wait duration in whole seconds -> a short phrase, same shape as AskCluck.jsx's formatWait
// but seconds-only: this route sits behind exactly one limiter (15/min), so there is no
// minute-vs-daily distinction to make here.
function formatWaitSec(sec) {
  if (!(sec > 0)) return null;
  return tf("Try again in {n} seconds.", { n: sec });
}

function scopeNote(capped, scanned, tokensHeld) {
  if (!capped) return t("checked on all held tokens");
  return `${t("checked on")} ${scanned} ${t("of")} ${tokensHeld} ${t("held tokens")}`;
}

function ApprovalRow({ a }) {
  return (
    <div className="seeker-checkup-row seeker-checkup-row-warn">
      <div className="seeker-checkup-row-main">
        {t("Delegate")}: <span className="seeker-checkup-mono">{shortAddr(a.delegate)}</span>
      </div>
      <div className="seeker-checkup-row-sub">
        {t("Token")}: <span className="seeker-checkup-mono">{shortAddr(a.mint)}</span> · {t("approved up to")} {a.delegatedAmount} ({t("you hold")} {a.balance})
      </div>
    </div>
  );
}

function RiskyRow({ r }) {
  return (
    <div className={"seeker-checkup-row seeker-checkup-row-sev" + (r.severity || 1)}>
      <div className="seeker-checkup-row-main">
        <span>{r.symbol ? "$" + r.symbol : shortAddr(r.mint)}</span>
        {r.valueUsd > 0 ? <span className="seeker-checkup-row-usd">{fmtUsd(r.valueUsd)}</span> : null}
      </div>
      <div className="seeker-checkup-row-sub">{t("holding")} {fmtNum(r.amount)}</div>
      {(r.issues || []).map((issue, i) => (
        // Server-generated fact sentences (mint/freeze authority, honeypot extensions) — data,
        // not app chrome, so not routed through t() (same posture as AskCluck's AI answer).
        <div key={i} className="seeker-checkup-issue">{issue}</div>
      ))}
    </div>
  );
}

export default function WalletCheckupPane({ address, gate }) {
  useI18nReady();
  // phase: idle | loading | ok | error. kind (error only): offline | rate | refused | unavailable.
  const [state, setState] = React.useState({ phase: "idle", kind: null, data: null, retrySec: 0, errMsg: null });
  const [online, setOnline] = React.useState(isOnline());
  const wasOfflineRef = React.useRef(!online);
  const abortRef = React.useRef(null);

  const scan = React.useCallback((address, signal) => {
    if (!address) return;
    if (!isOnline()) {
      setState({ phase: "error", kind: "offline", data: null, retrySec: 0, errMsg: null });
      return;
    }
    setState({ phase: "loading", kind: null, data: null, retrySec: 0, errMsg: null });
    fetch(`/api/wallet-checkup?wallet=${encodeURIComponent(address)}`, { signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (res.status === 429) {
          const retrySec = Number((body && (body.retryAfterSec || body.retryAfter)) || 0);
          setState({ phase: "error", kind: "rate", data: null, retrySec, errMsg: null });
          return;
        }
        // A 4xx OTHER than 429 is the wallet address itself, not the chain (toolFetch's own
        // split, pane.jsx: "refused" is a 4xx the CALLER caused and the pane's job to explain;
        // "unavailable" is everything else and never the user's fault) — this used to fold both
        // into the same generic "could not read the chain" line.
        if (res.status >= 400 && res.status < 500) {
          setState({ phase: "error", kind: "refused", data: null, retrySec: 0, errMsg: (body && body.error) || null });
          return;
        }
        // Any other HTTP-level failure, a missing/malformed body, or success!==true all land as
        // "unavailable" — never fall through to rendering an empty/zero result off a failed read.
        if (!res.ok || !body || body.success !== true) {
          setState({ phase: "error", kind: "unavailable", data: null, retrySec: 0, errMsg: null });
          return;
        }
        setState({ phase: "ok", kind: null, data: body, retrySec: 0, errMsg: null });
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setState({ phase: "error", kind: isOnline() ? "unavailable" : "offline", data: null, retrySec: 0, errMsg: null });
      });
  }, []);

  React.useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    if (typeof window !== "undefined") {
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      }
    };
  }, []);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  React.useEffect(() => {
    if (!address) {
      setState({ phase: "idle", kind: null, data: null, retrySec: 0 });
      return undefined;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    scan(address, ctrl.signal);
    return () => ctrl.abort();
  }, [address, scan]);

  // Recover automatically once the connection returns — same posture as Ask Cluck's offline
  // handling, but here "recover" means "rescan" rather than "let the next send through".
  React.useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = !online;
    if (wasOffline && online && address) {
      scan(address);
    }
  }, [online, address, scan]);

  if (!address) {
    // No address yet. WHAT asks for one is the EDITION's call, not this pane's: the full app
    // passes a NeedsWallet gate (connect, MWA-aware), the Google Play / iOS edition passes a
    // paste-an-address form, because that edition has no wallet at all — its listing says so and
    // its build refuses the string. The pane itself never knows which; it just renders `gate`.
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon"><ShieldIcon /></div>
        <h1>{t("Wallet Checkup")}</h1>
        {gate}
      </section>
    );
  }

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon"><ShieldIcon /></div>
        <h1>{t("Wallet Checkup")}</h1>
        <p>{t("Scanning your wallet…")}</p>
      </section>
    );
  }

  if (state.phase === "error") {
    const text =
      state.kind === "offline"
        ? t("You're offline. Wallet Checkup needs a connection — it'll scan automatically once you're back online.")
        : state.kind === "rate"
        ? t("Too many checkups at once.") + " " + (formatWaitSec(state.retrySec) || t("Try again in a moment."))
        : state.kind === "refused"
        ? (state.errMsg || t("That address wasn't something we could use."))
        : t("Could not read the chain right now. Try again shortly.");
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon"><ShieldIcon /></div>
        <h1>{t("Wallet Checkup")}</h1>
        <p className="seeker-checkup-errtext" role="alert">{text}</p>
        <button type="button" className="seeker-checkup-rescanbtn" onClick={() => scan(address)}>
          {t("Try again")}
        </button>
      </section>
    );
  }

  const data = state.data;
  const approvals = data.approvals || [];
  const risky = data.riskyHoldings || [];
  const unverified = data.unverified || 0;
  const capped = !!data.capped;
  const scanned = data.scanned || 0;
  const tokensHeld = data.tokensHeld || 0;
  const partial = capped || unverified > 0;
  const clean = approvals.length === 0 && risky.length === 0;

  return (
    <div className="seeker-checkup">
      <div className="seeker-checkup-topicon"><ShieldIcon /></div>
      <h1 className="seeker-checkup-title">{t("Wallet Checkup")}</h1>

      <div className="seeker-checkup-summary">
        <div className="seeker-checkup-stat">
          <span className="seeker-checkup-stat-val">{fmtUsd(data.portfolioUsd)}</span>
          <span className="seeker-checkup-stat-label">{t("Portfolio value")}</span>
        </div>
        <div className="seeker-checkup-stat">
          <span className={"seeker-checkup-stat-val" + (approvals.length ? " seeker-checkup-stat-val-danger" : " seeker-checkup-stat-val-ok")}>{approvals.length}</span>
          <span className="seeker-checkup-stat-label">{t("Open approvals")}</span>
        </div>
        <div className="seeker-checkup-stat">
          <span className={"seeker-checkup-stat-val" + (risky.length ? " seeker-checkup-stat-val-caution" : " seeker-checkup-stat-val-ok")}>{risky.length}</span>
          <span className="seeker-checkup-stat-label">{t("Risky holdings")}</span>
        </div>
      </div>

      <div className="seeker-checkup-scope">
        <div className="seeker-checkup-scope-title">{t("Checks in this scan")}</div>
        <div className="seeker-checkup-scope-line">{t("Open delegate approvals — checked")}</div>
        <div className="seeker-checkup-scope-line">{t("Honeypot / Token-2022 traps")} — {scopeNote(capped, scanned, tokensHeld)}</div>
        <div className="seeker-checkup-scope-line">{t("Live mint / freeze authority")} — {scopeNote(capped, scanned, tokensHeld)}</div>
        {unverified > 0 ? (
          <div className="seeker-checkup-scope-line seeker-checkup-scope-warn">
            {unverified} {unverified === 1
              ? t("token could not be read from the chain — status unknown, not counted as clear.")
              : t("tokens could not be read from the chain — status unknown, not counted as clear.")}
          </div>
        ) : null}
      </div>

      {clean ? (
        <div className="seeker-checkup-clean">
          <div className="seeker-checkup-clean-icon"><ShieldIcon /></div>
          <div className="seeker-checkup-clean-title">{t("No issues found in the checks completed")}</div>
          <p>
            {t("No open approvals and no honeypot or authority risk in what was checked.")}
            {partial ? " " + t("Some tokens weren't checked — see the scan scope above.") : ""}
          </p>
        </div>
      ) : null}

      {/* data-clkn-avoid-kids on both sections below: each row is its own card at a different
          screen height depending on how many issue lines it prints (e.g. "supply can be inf…"),
          so the row's own top — not the section's — is what the fixed 🌐 pill must clear. Found
          overlapping the tail of a risky-holding line in real Seeker-edition screenshots, 360x800
          CSS @3x, 2026-09-24 — the pill has no idea these rows exist without this marker. */}
      {approvals.length ? (
        <div className="seeker-checkup-section">
          <div className="seeker-checkup-section-title seeker-checkup-section-title-warn">
            {t("Open approvals")} · {approvals.length}
          </div>
          <p className="seeker-checkup-section-explain">
            {t("A delegate can move the approved amount out of your wallet without asking again.")}
          </p>
          <div data-clkn-avoid-kids="1">
            {approvals.map((a) => <ApprovalRow key={a.tokenAccount} a={a} />)}
          </div>
          <p className="seeker-checkup-revokenote">
            {t("Revoking needs a wallet signature — not available in this app yet.")}{" "}
            <a href={WEBSITE_CHECKUP_URL} target="_blank" rel="noreferrer">{t("Revoke on the website")}</a>
          </p>
        </div>
      ) : null}

      {risky.length ? (
        <div className="seeker-checkup-section">
          <div className="seeker-checkup-section-title seeker-checkup-section-title-warn">
            {t("Risky holdings")} · {risky.length}
            {data.atRiskUsd > 0 ? " · " + fmtUsd(data.atRiskUsd) + " " + t("at risk") : ""}
          </div>
          <div data-clkn-avoid-kids="1">
            {risky.map((r) => <RiskyRow key={r.mint} r={r} />)}
          </div>
        </div>
      ) : null}

      <button type="button" className="seeker-checkup-rescanbtn" onClick={() => scan(address)}>
        {t("Rescan")}
      </button>
    </div>
  );
}
