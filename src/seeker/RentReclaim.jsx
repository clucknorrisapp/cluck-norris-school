// Cluck Norris — Seeker app, Rent Reclaim pane (increment 2 = the read side; increment 3 = the
// SIGNING path, docs/SEEKER_APP_PLAN.md / docs/SEEKER_RECLAIM_SIGNING_SPEC.md — THIS MOVES USER
// FUNDS, read the spec before touching this file).
//
// The scan itself is still read-only: GET /api/seeker/reclaimable?wallet=<address>
// (lib/rent-reclaim.js) — free, ungated, no wallet signature needed. Tapping Reclaim now DOES
// build and sign a real transaction, but ALL of that logic lives in
// public/rent-reclaim-plan.js (the pure decisions) and src/seeker/reclaim-sign.js (the thin
// browser seam that talks to the wallet) — this component only renders states and calls
// runFullReclaim(). It never itself decides who is eligible, builds an instruction, or touches a
// destination address.
//
// Distinct states, never conflated: not-connected, loading, an honest empty result (scanned fine,
// nothing reclaimable), "unavailable" (the chain could not be read — CLAUDE.md's "RPC failure
// must read as unavailable, never as zero" applies here exactly as it does to the scan), a confirm
// step naming the exact count and SOL before any signature, signing-in-progress, a rejected
// signature (a NORMAL outcome, not an error — the user changed their mind), and a result screen
// with per-account confirmed/failed/skipped rows and a confirmed-only total.
import React from "react";
import { t, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import { runFullReclaim } from "./reclaim-sign.js";

// public/rent-math.js is loaded as a plain <script> in seeker.html (same pattern as
// cluck-util.js/cluck-wallet.js — see that file's header) so this pane and /solana/rent format
// SOL amounts with the exact same function. Falls back gracefully if it somehow didn't load.
function fmtSol(lamports) {
  try {
    if (typeof window !== "undefined" && window.CluckRentMath && typeof window.CluckRentMath.fmtSol === "function") {
      return window.CluckRentMath.fmtSol(lamports);
    }
  } catch (_) {}
  return (Number(lamports || 0) / 1e9).toFixed(6) + " SOL";
}

function reasonFor(status) {
  if (status === "reclaimable") return t("No balance — safe to close.");
  if (status === "holds_balance") return t("Still holds tokens — won't be closed.");
  return t("Wrapped SOL — not handled here.");
}

function AccountRow({ a }) {
  return (
    <div className={"seeker-reclaim-row seeker-reclaim-row-" + a.status}>
      <div className="seeker-reclaim-row-main">
        <span className="seeker-reclaim-row-mint">{shortAddr(a.mint)}</span>
        <span className="seeker-reclaim-row-sol">{fmtSol(a.lamports)}</span>
      </div>
      <div className="seeker-reclaim-row-reason">{reasonFor(a.status)}</div>
    </div>
  );
}

function Group({ status, title, accounts, emptyText }) {
  if (!accounts.length) {
    if (!emptyText) return null;
    return (
      <div className="seeker-reclaim-group">
        <div className="seeker-reclaim-group-title">{title}</div>
        <div className="seeker-reclaim-empty">{emptyText}</div>
      </div>
    );
  }
  return (
    <div className="seeker-reclaim-group">
      <div className="seeker-reclaim-group-title">{title} · {accounts.length}</div>
      {accounts.map((a) => <AccountRow key={a.tokenAccount} a={a} />)}
    </div>
  );
}

// Increment 3 — signing. Vocabulary is closed/reclaimed/refused, per docs/SEEKER_RECLAIM_SIGNING_
// SPEC.md — never "verified" or "safe" about any token, and a declined signature reads as a plain,
// unalarming fact, not an error.
function outcomeLabel(outcome) {
  if (outcome === "confirmed") return t("Closed");
  if (outcome === "rejected") return t("Declined");
  if (outcome === "skipped") return t("Skipped");
  return t("Failed");
}

function ResultRow({ r }) {
  return (
    <div className={"seeker-reclaim-row seeker-reclaim-resultrow seeker-reclaim-resultrow-" + r.outcome}>
      <div className="seeker-reclaim-row-main">
        <span className="seeker-reclaim-row-mint">{shortAddr(r.mint)}</span>
        <span className="seeker-reclaim-row-outcome">{outcomeLabel(r.outcome)}</span>
      </div>
      <div className="seeker-reclaim-row-reason">
        {r.outcome === "confirmed" ? fmtSol(r.lamports) : (r.reason || "")}
      </div>
      {r.sig ? (
        <a className="seeker-reclaim-siglink" href={`https://solscan.io/tx/${encodeURIComponent(r.sig)}`} target="_blank" rel="noopener noreferrer">
          {t("View signature")}
        </a>
      ) : null}
    </div>
  );
}

// The confirm step every signature gets (spec Rule 5): names the EXACT account count and the
// EXACT SOL coming back, before any wallet prompt fires. First-timers get warned before they can
// hurt themselves — that's the brand (CLAUDE.md).
function ConfirmSheet({ count, lamports, busy, onConfirm, onCancel }) {
  return (
    <div className="seeker-reclaim-confirm" role="alertdialog" aria-modal="true">
      <h2 className="seeker-reclaim-confirm-title">{t("Confirm reclaim")}</h2>
      <div className="seeker-reclaim-confirm-row">
        <span>{t("Accounts to close")}</span>
        <strong>{count}</strong>
      </div>
      <div className="seeker-reclaim-confirm-row">
        <span>{t("SOL returning to your wallet")}</span>
        <strong>{fmtSol(lamports)}</strong>
      </div>
      <p className="seeker-reclaim-confirm-note">{t("Your wallet will ask you to approve this next.")}</p>
      <div className="seeker-reclaim-confirm-actions">
        <button type="button" className="seeker-reclaim-confirm-cancel" onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button type="button" className="seeker-reclaim-confirm-go" onClick={onConfirm} disabled={busy}>
          {busy ? t("Signing…") : t("Confirm and sign")}
        </button>
      </div>
    </div>
  );
}

export default function RentReclaimPane({ wallet }) {
  useI18nReady();
  const [state, setState] = React.useState({ phase: "idle", data: null });
  // Signing state, kept separate from the scan state above: "idle" (no sign in flight),
  // "confirming" (the pre-signature sheet is up), "signing" (runFullReclaim is running),
  // "done" (a run finished — status ok/rejected/unavailable, see r.status).
  const [sign, setSign] = React.useState({ phase: "idle", result: null, error: null });
  // Idempotency across repeated taps IN THIS SESSION (spec §5 Test 7): tokenAccounts a run has
  // already confirmed closed are remembered here and excluded from every later run's candidate
  // pool by CluckReclaimPlan.excludeAlreadyClosed — a retry after a partial failure never
  // re-attempts (or double-counts) an account this pane has already seen confirmed.
  const [closedTokenAccounts, setClosedTokenAccounts] = React.useState([]);

  const scan = React.useCallback((address, signal) => {
    if (!address) return;
    setState({ phase: "loading", data: null });
    fetch(`/api/seeker/reclaimable?wallet=${encodeURIComponent(address)}`, { signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // Both an HTTP-level failure and a body-level status:"unavailable" (or a malformed body)
        // land here — never fall through to rendering a zero/empty result off a failed read.
        if (!j || !r.ok || j.status === "unavailable" || j.success !== true) {
          setState({ phase: "unavailable", data: null });
          return;
        }
        setState({ phase: "ok", data: j });
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setState({ phase: "unavailable", data: null });
      });
  }, []);

  React.useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setState({ phase: "idle", data: null });
      setSign({ phase: "idle", result: null, error: null });
      setClosedTokenAccounts([]);
      return undefined;
    }
    const ctrl = new AbortController();
    scan(wallet.address, ctrl.signal);
    return () => ctrl.abort();
  }, [wallet.connected, wallet.address, scan]);

  const reclaimableNow = (state.data && state.data.accounts || []).filter(
    (a) => a.status === "reclaimable" && !closedTokenAccounts.includes(a.tokenAccount)
  );
  const reclaimableLamports = reclaimableNow.reduce((s, a) => s + (Number(a.lamports) || 0), 0);

  const openConfirm = React.useCallback(() => {
    if (!reclaimableNow.length) return;
    setSign({ phase: "confirming", result: null, error: null });
  }, [reclaimableNow.length]);

  const cancelConfirm = React.useCallback(() => {
    setSign({ phase: "idle", result: null, error: null });
  }, []);

  const doReclaim = React.useCallback(async () => {
    setSign({ phase: "signing", result: null, error: null });
    try {
      const result = await runFullReclaim({ wallet, accounts: reclaimableNow, closedTokenAccounts });
      const newlyConfirmed = (result.rows || []).filter((r) => r.outcome === "confirmed").map((r) => r.tokenAccount);
      if (newlyConfirmed.length) setClosedTokenAccounts((prev) => prev.concat(newlyConfirmed));
      setSign({ phase: "done", result, error: null });
    } catch (e) {
      // A hard failure BEFORE the pure module could even report a status (e.g. the wallet layer
      // never loaded) — never rendered as a fabricated result, always its own honest error state.
      setSign({ phase: "error", result: null, error: (e && e.message) || String(e) });
    }
  }, [wallet, reclaimableNow, closedTokenAccounts]);

  if (!wallet.connected) {
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p>{t("Connect your wallet to scan for reclaimable rent.")}</p>
      </section>
    );
  }

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p>{t("Scanning your wallet…")}</p>
      </section>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p className="seeker-reclaim-errtext" role="alert">{t("Could not read the chain right now. Try again shortly.")}</p>
        <button
          type="button"
          className="seeker-reclaim-retrybtn"
          onClick={() => scan(wallet.address)}
        >
          {t("Try again")}
        </button>
      </section>
    );
  }

  const data = state.data;
  const accounts = data.accounts || [];
  // reclaimableNow (computed above, before the early returns, since it also feeds the confirm
  // sheet) already excludes anything this session has confirmed closed — reuse it here rather
  // than a second, un-filtered list that would keep showing a closed account as "Reclaimable"
  // right next to its own "Closed" result row.
  const reclaimable = reclaimableNow;
  const holdsBalance = accounts.filter((a) => a.status === "holds_balance");
  const refused = accounts.filter((a) => a.status === "refused");

  const signResult = sign.phase === "done" ? sign.result : null;

  return (
    <div className="seeker-reclaim">
      <div className="seeker-reclaim-topicon" aria-hidden="true">💰</div>
      <h1 className="seeker-reclaim-title">{t("Rent Reclaim")}</h1>

      <div className="seeker-reclaim-total">
        <span className="seeker-reclaim-total-label">{t("Total reclaimable")}</span>
        <span className="seeker-reclaim-total-val">{fmtSol(reclaimableLamports)}</span>
      </div>

      {data.truncated ? (
        <p className="seeker-reclaim-truncnote">{t("More accounts exist in this wallet than are shown here.")}</p>
      ) : null}

      {sign.phase === "confirming" ? (
        <ConfirmSheet
          count={reclaimableNow.length}
          lamports={reclaimableLamports}
          busy={false}
          onConfirm={doReclaim}
          onCancel={cancelConfirm}
        />
      ) : (
        <button type="button" className="seeker-reclaim-btn" disabled={!reclaimableNow.length || sign.phase === "signing"} onClick={openConfirm}>
          {sign.phase === "signing" ? t("Signing…") : t("Reclaim")}
        </button>
      )}

      {sign.phase === "error" ? (
        <p className="seeker-reclaim-errtext" role="alert">{sign.error}</p>
      ) : null}

      {signResult && signResult.status === "unavailable" ? (
        <p className="seeker-reclaim-errtext" role="alert">{t("Could not read the chain right now. Try again shortly.")}</p>
      ) : null}

      {signResult && signResult.status === "rejected" ? (
        <p className="seeker-reclaim-declinedtext">{t("You declined to sign — nothing was closed.")}</p>
      ) : null}

      {signResult && signResult.rows && signResult.rows.length ? (
        <div className="seeker-reclaim-group">
          <div className="seeker-reclaim-group-title">
            {t("Reclaimed")} · {fmtSol(signResult.reclaimedLamports)}
          </div>
          {signResult.rows.map((r, i) => <ResultRow key={r.tokenAccount + ":" + i} r={r} />)}
        </div>
      ) : null}

      <Group status="reclaimable" title={t("Reclaimable")} accounts={reclaimable} emptyText={t("No reclaimable rent found in this wallet right now.")} />
      <Group status="holds_balance" title={t("Holds a balance")} accounts={holdsBalance} />
      <Group status="refused" title={t("Refused")} accounts={refused} />

      <button
        type="button"
        className="seeker-reclaim-retrybtn"
        onClick={() => { const ctrl = new AbortController(); scan(wallet.address, ctrl.signal); }}
      >
        {t("Rescan")}
      </button>
    </div>
  );
}
