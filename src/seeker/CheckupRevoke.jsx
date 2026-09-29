// Cluck Norris — Seeker app, the REVOKE control under Wallet Checkup's approvals list.
//
// FULL EDITION ONLY. WalletCheckup.jsx is shared with the education-only Play/iOS edition, whose
// build refuses the string "CluckWallet" and anything that signs, so this lives in its own module
// and reaches the pane through a render prop (`revoke`) that the education edition never passes.
// The pane keeps its own "Revoke on the website" note for the case where nothing is passed.
//
// Four outcomes, never two (sign.js): sent → re-read every touched account on chain and show the
// per-account answer; unconfirmed → the signature, a Check button, and NO retry (a resend of a
// landed revoke is harmless, but the habit of retrying an ambiguous send is the one that double-
// burns elsewhere, and this app teaches one habit); failed → say nothing moved; declined → a
// normal outcome, not an error.
//
// The list on the confirm sheet IS the list that gets signed: revoke.js builds the instructions
// from the same `batch` the sheet rendered, so a person approving "these 3" signs those 3.
import React from "react";
import { t, tf, useI18nReady } from "./i18n.js";
import { Confirm, Loading } from "./pane.jsx";
import { shortAddr } from "./addr.js";
import { rpcFn, confirmSignature } from "./sign.js";
import { planRevoke, runRevoke, verifyRevoked, MAX_REVOKE_PER_TX } from "./revoke.js";

function solscanTx(sig) { return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null; }

export default function CheckupRevoke({ wallet, approvals, scannedAddress, onDone }) {
  useI18nReady();
  const [sheet, setSheet] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // { status, sig?, error?, n, verify?: {cleared, still, unreadable}, verifying?, checking? }
  const [outcome, setOutcome] = React.useState(null);

  const plan = React.useMemo(() => planRevoke(approvals, MAX_REVOKE_PER_TX), [approvals]);
  const n = plan.batch.length;

  if (!wallet || !wallet.connected) return null;
  if (scannedAddress && wallet.address !== scannedAddress) {
    return (
      <p className="seeker-checkup-revokenote">
        {tf("You're connected as {wallet} but scanned {scanned}. You can only revoke approvals on the wallet you connected.", { wallet: shortAddr(wallet.address), scanned: shortAddr(scannedAddress) })}
      </p>
    );
  }
  if (!n && !outcome) return null;

  async function onConfirmed() {
    setSheet(false);
    if (busy || !n) return;
    setBusy(true);
    setOutcome(null);
    const res = await runRevoke({ provider: wallet.provider, owner: wallet.address, batch: plan.batch });
    await settle(res);
  }

  async function settle(res) {
    const base = { n: res.accounts ? res.accounts.length : n, accounts: res.accounts || [] };
    if (res.status === "sent") {
      setOutcome({ ...base, status: "sent", sig: res.sig, verifying: true });
      const v = await verifyRevoked(rpcFn(), base.accounts.map((a) => a.tokenAccount));
      setOutcome((o) => (o ? { ...o, verify: v, verifying: false } : o));
      if (typeof onDone === "function") onDone();       // rescan: the list above must show the new truth
    } else if (res.status === "unconfirmed") {
      setOutcome({ ...base, status: "unconfirmed", sig: res.sig });
    } else if (res.status === "declined") {
      setOutcome({ ...base, status: "declined" });
    } else {
      setOutcome({ ...base, status: "failed", sig: res.sig, error: res.error });
    }
    setBusy(false);
  }

  // The recovery action for an ambiguous send: re-poll the exact signature via sign.js's own
  // confirmSignature (searchHistory, because a person may tap this minutes later). "Still
  // pending" changes nothing; landed → the same re-read as a plain send.
  async function recheck() {
    if (!outcome || outcome.status !== "unconfirmed" || outcome.checking) return;
    setOutcome((o) => ({ ...o, checking: true }));
    try {
      const landed = await confirmSignature(rpcFn(), outcome.sig, { searchHistory: true, attempts: 1 });
      if (landed) {
        setOutcome((o) => ({ ...o, status: "sent", checking: false, verifying: true }));
        const v = await verifyRevoked(rpcFn(), outcome.accounts.map((a) => a.tokenAccount));
        setOutcome((o) => (o ? { ...o, verify: v, verifying: false } : o));
        if (typeof onDone === "function") onDone();
      } else {
        setOutcome((o) => ({ ...o, checking: false }));
      }
    } catch (e) {
      setOutcome((o) => ({ ...o, status: "failed", error: (e && e.message) || String(e), checking: false }));
    }
  }

  const rows = plan.batch.map((a) => ({
    key: a.tokenAccount,
    left: a.delegate ? shortAddr(a.delegate) : "—",
    right: a.mint ? shortAddr(a.mint) : shortAddr(a.tokenAccount),
  }));

  return (
    <div className="seeker-revoke">
      {n && !busy ? (
        <>
          <button type="button" className="seeker-btn seeker-btn-danger seeker-revoke-btn" onClick={() => setSheet(true)}>
            {n === 1 ? t("Revoke this approval") : tf("Revoke {n} approvals", { n })}
          </button>
          {plan.remaining.length ? (
            <p className="seeker-checkup-revokenote">{tf("Up to {max} per transaction — run it again after this one confirms for the rest.", { max: MAX_REVOKE_PER_TX })}</p>
          ) : null}
          {plan.skipped.length ? (
            <p className="seeker-checkup-revokenote">{tf("{n} could not be prepared from the scan and were left out.", { n: plan.skipped.length })}</p>
          ) : null}
        </>
      ) : null}
      {busy ? <Loading label="Revoking…" /> : null}

      {outcome ? (
        <div className={"seeker-revoke-outcome seeker-revoke-outcome-" + outcome.status} role={outcome.status === "failed" || outcome.status === "unconfirmed" ? "alert" : "status"}>
          {outcome.status === "sent" ? (
            <>
              <p className="seeker-revoke-outcome-title">{t("Revoke transaction confirmed")}</p>
              {outcome.verifying ? (
                <p>{t("Re-reading each account on chain…")}</p>
              ) : outcome.verify ? (
                <>
                  <p>{tf("Re-read on chain: {cleared} of {n} approvals are gone.", { cleared: outcome.verify.cleared.length, n: outcome.n })}</p>
                  {outcome.verify.still.length ? <p className="seeker-revoke-warn">{tf("{n} still show a delegate — rescan and revoke again.", { n: outcome.verify.still.length })}</p> : null}
                  {outcome.verify.unreadable.length ? <p className="seeker-revoke-warn">{tf("{n} could not be re-read — status unknown, not counted as cleared.", { n: outcome.verify.unreadable.length })}</p> : null}
                </>
              ) : null}
              {solscanTx(outcome.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(outcome.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
            </>
          ) : outcome.status === "unconfirmed" ? (
            <>
              <p className="seeker-revoke-outcome-title">{t("Unconfirmed")}</p>
              <p>{t("This was submitted but had no on-chain status after 30 seconds. It may still land — check before signing again.")}</p>
              <button type="button" className="seeker-btn seeker-btn-quiet" disabled={outcome.checking} onClick={recheck}>{outcome.checking ? t("Checking…") : t("Check status")}</button>
              {solscanTx(outcome.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(outcome.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
            </>
          ) : outcome.status === "failed" ? (
            <>
              <p className="seeker-revoke-outcome-title">{t("Revoke failed")}</p>
              <p>{t("Nothing was revoked — the transaction did not land.")}{outcome.error ? ` ${outcome.error}` : ""}</p>
            </>
          ) : (
            <p>{t("You declined in your wallet — nothing was sent.")}</p>
          )}
          {outcome.status !== "unconfirmed" ? (
            <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => setOutcome(null)}>{t("OK")}</button>
          ) : null}
        </div>
      ) : null}

      <Confirm
        open={sheet}
        danger
        title="Revoke these approvals?"
        lines={[t("Each delegate below loses the ability to move that token out of your wallet. This costs a network fee and nothing else — your tokens stay where they are.")]}
        rows={rows}
        confirmLabel="Revoke"
        onConfirm={onConfirmed}
        onCancel={() => setSheet(false)}
      />
    </div>
  );
}
