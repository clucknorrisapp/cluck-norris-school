// Cluck Norris — Seeker app, Rent Reclaim pane (increment 2, docs/SEEKER_APP_PLAN.md).
//
// READ SIDE ONLY. Calls GET /api/seeker/reclaimable?wallet=<address> (lib/rent-reclaim.js) — a
// free, ungated, unauthenticated read of public chain state; no wallet signature is asked for or
// needed. The "Reclaim" button below is deliberately disabled: signing is increment 3, with its
// own adversarial review, because it moves user funds (CLAUDE.md: "PLAN != EXECUTE for money").
// Nothing in this file builds or sends a transaction.
//
// Four distinct states, never conflated: not-connected (no wallet to scan yet), loading, an
// honest empty result (scanned fine, nothing reclaimable), and "unavailable" (the chain could not
// be read) — CLAUDE.md's hard rule for the tool gate ("RPC failure must read as unavailable,
// never as zero") applies just as hard to a feature that tells someone how much SOL they can get
// back. A failed scan never renders as "$0 to reclaim".
import React from "react";
import { t, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";

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

export default function RentReclaimPane({ wallet }) {
  useI18nReady();
  const [state, setState] = React.useState({ phase: "idle", data: null });

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
      return undefined;
    }
    const ctrl = new AbortController();
    scan(wallet.address, ctrl.signal);
    return () => ctrl.abort();
  }, [wallet.connected, wallet.address, scan]);

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
  const reclaimable = accounts.filter((a) => a.status === "reclaimable");
  const holdsBalance = accounts.filter((a) => a.status === "holds_balance");
  const refused = accounts.filter((a) => a.status === "refused");

  return (
    <div className="seeker-reclaim">
      <div className="seeker-reclaim-topicon" aria-hidden="true">💰</div>
      <h1 className="seeker-reclaim-title">{t("Rent Reclaim")}</h1>

      <div className="seeker-reclaim-total">
        <span className="seeker-reclaim-total-label">{t("Total reclaimable")}</span>
        <span className="seeker-reclaim-total-val">{fmtSol(data.totalReclaimableLamports)}</span>
      </div>

      {data.truncated ? (
        <p className="seeker-reclaim-truncnote">{t("More accounts exist in this wallet than are shown here.")}</p>
      ) : null}

      <button type="button" className="seeker-reclaim-btn" disabled>
        {t("Reclaim")}
      </button>
      <p className="seeker-reclaim-btnnote">{t("Signing is coming in the next build.")}</p>

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
