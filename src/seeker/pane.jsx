// Shared pane primitives for the Seeker app's tools (docs/SEEKER_TOOLS_BUILD.md §3).
//
// Twelve tools are being rebuilt for the phone in parallel. Without one set of primitives they
// would arrive as twelve dialects of the same four states, and the app would feel like a folder
// of web pages — which is exactly what the hackathon says scores poorly. Everything a tool pane
// needs to be honest about what it knows lives here, so a tool author writes the TOOL.
//
// The load-bearing rule these encode: a FAILED read is never an EMPTY result. `Unavailable` and
// `Empty` are different components on purpose, and there is deliberately no single "no data"
// state that could serve both. Telling someone their wallet is clean, or that they have no rent
// to reclaim, when we could not actually look, is a lie about their money.
import React from "react";
import { t, useI18nReady } from "./i18n.js";

// ── connectivity ────────────────────────────────────────────────────────────
// A phone loses signal in a lift. Every pane that fetches must know, and must recover on its own
// when the connection comes back rather than leaving the user staring at a dead error.
export function useOnline() {
  const [online, setOnline] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  React.useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

// ── the fetch every tool should use ─────────────────────────────────────────
// Returns a discriminated result, never a thrown string and never a bare null: the caller is
// forced to tell "it worked and there is nothing" apart from "we could not look".
//   { ok: true,  data }
//   { ok: false, kind: "offline" | "unavailable" | "refused", status, error }
// `refused` is a 4xx the CALLER caused (a bad address, too long a question) and is the pane's
// job to explain; `unavailable` is everything else and is never the user's fault.
export async function toolFetch(url, opts) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline", status: 0, error: null };
  }
  let r, body = null;
  try { r = await fetch(url, opts); } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, kind: "aborted", status: 0, error: null };
    return { ok: false, kind: "offline", status: 0, error: null };
  }
  try { body = await r.json(); } catch (_) { body = null; }
  if (r.ok && body && body.success !== false && body.status !== "unavailable") return { ok: true, data: body };
  if (r.status >= 400 && r.status < 500 && r.status !== 429) {
    return { ok: false, kind: "refused", status: r.status, error: (body && body.error) || null, body };
  }
  return { ok: false, kind: "unavailable", status: r.status, error: (body && body.error) || null, body };
}

// ── chrome ──────────────────────────────────────────────────────────────────
export function Pane({ icon, title, children }) {
  useI18nReady();
  return (
    <div className="seeker-tool">
      {icon ? <div className="seeker-tool-icon" aria-hidden="true">{icon}</div> : null}
      {title ? <h1 className="seeker-tool-title">{t(title)}</h1> : null}
      {children}
    </div>
  );
}

export function Loading({ label }) {
  useI18nReady();
  return (
    <div className="seeker-tool-loading" role="status" aria-live="polite">
      <span className="seeker-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{t(label || "Working…")}</span>
    </div>
  );
}

// An HONEST empty: we looked, and there is nothing. Never used for a failed read.
export function Empty({ children }) {
  useI18nReady();
  return <p className="seeker-tool-empty">{children}</p>;
}

// We could NOT look. Always an alert, always offers the way back, never shows a number.
export function Unavailable({ kind, message, onRetry }) {
  useI18nReady();
  const text = kind === "offline"
    ? t("You're offline. This needs a connection — it'll work again as soon as you're back.")
    : (message || t("Could not read the chain right now. Try again shortly."));
  return (
    <div className="seeker-tool-unavailable" role="alert">
      <p>{text}</p>
      {onRetry ? <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onRetry}>{t("Try again")}</button> : null}
    </div>
  );
}

// A 4xx the caller caused — a malformed address, an out-of-range input. The user can fix it, so
// say what to fix rather than blaming the chain.
export function Refused({ message }) {
  useI18nReady();
  return <div className="seeker-tool-refused" role="alert"><p>{message || t("That input wasn't something we could use.")}</p></div>;
}

// ── wallet gate ─────────────────────────────────────────────────────────────
// A pane that needs an address renders this instead of its body. It NEVER fakes a connection and
// never renders a result implying a wallet was read. Inside the bundled app with no native MWA
// bridge yet, `CluckWallet.available()` is empty — say that plainly rather than spinning.
export function NeedsWallet({ why, wallet }) {
  useI18nReady();
  const [noWallet, setNoWallet] = React.useState(false);
  React.useEffect(() => {
    try {
      const CW = window.CluckWallet;
      setNoWallet(!!(CW && typeof CW.available === "function" && CW.available().length === 0));
    } catch (_) { setNoWallet(false); }
  }, []);
  return (
    <div className="seeker-tool-needswallet">
      <p>{t(why || "Connect your wallet to use this.")}</p>
      {noWallet
        ? <p className="seeker-tool-note">{t("No wallet app was found on this device.")}</p>
        : <button type="button" className="seeker-btn" onClick={wallet && wallet.connect}>{t("Connect Wallet")}</button>}
    </div>
  );
}

// ── the destructive-action confirm ──────────────────────────────────────────
// "Guardrails before power" is the brand, and it is the rule that separates this app from the
// tools that let a first-timer hurt themselves. Anything irreversible names the exact
// consequence in plain words BEFORE the signature — the count, the amount, what cannot be undone.
export function Confirm({ open, title, lines, confirmLabel, onConfirm, onCancel, danger }) {
  useI18nReady();
  if (!open) return null;
  return (
    <div className="seeker-confirm-wrap" role="dialog" aria-modal="true" aria-label={t(title)}>
      <div className={"seeker-confirm" + (danger ? " seeker-confirm-danger" : "")}>
        <h2>{t(title)}</h2>
        {(lines || []).map((l, i) => <p key={i}>{l}</p>)}
        <div className="seeker-confirm-actions">
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onCancel}>{t("Cancel")}</button>
          <button type="button" className={"seeker-btn" + (danger ? " seeker-btn-danger" : "")} onClick={onConfirm}>{t(confirmLabel || "Confirm")}</button>
        </div>
      </div>
    </div>
  );
}
