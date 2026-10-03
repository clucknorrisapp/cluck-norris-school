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
// ⚠️ Codex on #458, both P2. (1) While a signature is UNRESOLVED there is no Revoke button at all
// (the plan is empty, not merely hidden) — the old code brought it back under the Unconfirmed
// card, and one tap cleared the signature the person needed and charged a second fee. The only
// way out is Check status, which asks sign.js's checkPendingSwap — the same rule Swap uses:
// landed → re-read; failed on chain, or no status AND a dead blockhash → known not landed, then
// the chain is re-read and ONLY the accounts still showing a delegate become revocable again.
// (2) The result is rendered by a slot WalletCheckup keeps mounted, and the rescan after a
// revoke refreshes the list in the background, so "cleared / still approved / couldn't read"
// stays on screen until dismissed instead of vanishing with the loading screen.
//
// ⚠️ Codex round 2, P2 — an unresolved send must outlive this component. The ordinary Rescan and
// the back-online rescan swap the pane for its loading screen (unmounting this), and leaving the
// Checkup tab does the same; the unresolved signature used to die with the state and the same
// approvals came back with a fresh Revoke button. The record is now persisted by wallet address
// (revoke.js loadRevokePending/saveRevokePending) and restored on mount; it is cleared only when
// the send resolves (landed / failed on chain / expired by sign.js's strict rule) or the person
// dismisses it through the 10-minute "stop watching" escape hatch (Swap's PendingCard pattern).
// And checkPendingSwap is handed the REAL lastValidBlockHeight that came with the blockhash
// (runRevoke returns it); with none, the send can never be judged expired.
//
// ⚠️ Codex round 3, P2 — the record used to be written only after the send came back `unconfirmed`,
// so for the whole confirmation window (and any transport throw) nothing was persisted and a
// remount offered Revoke again. Written at SIGN time was still too late for a wallet that signs and
// sends in one operation, so it is now written BEFORE THE WALLET IS ASKED (sign.js `beforeSign`),
// with `sig: null`; the signature is filled in when the wallet returns it (`onSigned`). If it
// cannot be saved the wallet is never asked (fail closed). A `sig: null` record blocks Revoke and
// shows the watching card exactly like a known signature; it can only be released by the blockhash
// being proven dead (checkUnsignedPending) followed by the delegate re-read, or by the 10-minute
// "stop watching" hatch. A record is cleared on a definitive outcome (landed / failed / declined)
// or the existing proven-dead path.
//
// The list on the confirm sheet IS the list that gets signed: revoke.js builds the instructions
// from the same `batch` the sheet rendered, so a person approving "these 3" signs those 3.
import React from "react";
import { t, tf, useI18nReady } from "./i18n.js";
import { Confirm, Loading } from "./pane.jsx";
import { shortAddr } from "./addr.js";
import { rpcFn, checkPendingSwap, checkUnsignedPending } from "./sign.js";
import { planRevoke, runRevoke, verifyRevoked, MAX_REVOKE_PER_TX, loadRevokePending, saveRevokePending, clearRevokePending, REVOKE_PENDING_ESCAPE_MS } from "./revoke.js";

// Which scanned accounts may NOT be offered for revoking right now — "all" while a send is
// unresolved, otherwise a Set. A revoke that landed leaves its stale rows in the parent's list
// until the background rescan returns; a not-landed one frees only what the chain still shows.
function heldAccounts(outcome) {
  if (!outcome) return new Set();
  const accts = (outcome.accounts || []).map((a) => a.tokenAccount);
  if (outcome.status === "unconfirmed") return "all";
  if (outcome.status === "sent") return outcome.verify ? new Set(outcome.verify.cleared) : new Set(accts);
  if (outcome.dead) {
    if (!outcome.verify) return new Set(accts);
    const still = new Set(outcome.verify.still.map((x) => x.tokenAccount));
    return new Set(accts.filter((a) => !still.has(a)));
  }
  return new Set();
}

// A persisted record, shaped as the on-screen "unconfirmed" outcome.
function outcomeFromRecord(rec) {
  return { status: "unconfirmed", sig: rec.sig, n: rec.accounts.length, accounts: rec.accounts, recentBlockhash: rec.recentBlockhash, lastValidBlockHeight: rec.lastValidBlockHeight, wallet: rec.wallet, at: rec.at };
}

function solscanTx(sig) { return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null; }

export default function CheckupRevoke({ wallet, approvals, scannedAddress, onDone }) {
  useI18nReady();
  const [sheet, setSheet] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // { status, sig?, error?, n, verify?: {cleared, still, unreadable}, verifying?, checking? }
  // Starts from the persisted record for this wallet, if any (see the note above).
  const [outcome, setOutcome] = React.useState(() => {
    const rec = wallet && wallet.address ? loadRevokePending(wallet.address) : null;
    return rec ? outcomeFromRecord(rec) : null;
  });
  const [, tick] = React.useState(0);
  const walletAddr = wallet && wallet.address ? wallet.address : null;
  // The wallet can connect, or change, after mount: pick up its record, and never carry another
  // wallet's unresolved send onto this one's screen.
  React.useEffect(() => {
    const rec = walletAddr ? loadRevokePending(walletAddr) : null;
    setOutcome((o) => {
      if (o && o.status === "unconfirmed" && o.wallet && o.wallet !== walletAddr) return rec ? outcomeFromRecord(rec) : null;
      if (!o && rec) return outcomeFromRecord(rec);
      return o;
    });
  }, [walletAddr]);
  const isUnconfirmed = !!outcome && outcome.status === "unconfirmed";
  // Ticks just often enough to notice crossing the 10-minute mark (Swap's PendingCard does the same).
  React.useEffect(() => {
    if (!isUnconfirmed) return undefined;
    const iv = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, [isUnconfirmed]);

  const plan = React.useMemo(() => {
    const held = heldAccounts(outcome);
    const usable = held === "all" ? [] : (approvals || []).filter((a) => a && !held.has(a.tokenAccount));
    return planRevoke(usable, MAX_REVOKE_PER_TX);
  }, [approvals, outcome]);
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
    // Codex round 3, P2: the pending record is written BEFORE the wallet is asked (sig: null), so a
    // wallet that signs-and-sends in one step has still left it behind, and a save that fails means
    // the wallet is never asked. The signature is filled in once the wallet returns it.
    let startedAt = Date.now();
    const res = await runRevoke({
      provider: wallet.provider,
      owner: wallet.address,
      batch: plan.batch,
      beforeSign: (rec) => saveRevokePending({ ...rec, sig: null, wallet: wallet.address, at: startedAt }),
      onSigned: (rec) => saveRevokePending({ ...rec, wallet: wallet.address, at: startedAt }),
    });
    await settle(res);
  }

  async function settle(res) {
    const base = { n: res.accounts ? res.accounts.length : n, accounts: res.accounts || [], recentBlockhash: res.recentBlockhash || null, lastValidBlockHeight: typeof res.lastValidBlockHeight === "number" ? res.lastValidBlockHeight : null };
    // A definitive answer (landed; failed/refused so nothing landed; declined in the wallet) retires
    // the record written before the prompt. Unconfirmed keeps it, below.
    if (res.status === "sent" || res.status === "failed" || res.status === "declined") clearRevokePending(wallet.address);
    if (res.status === "sent") {
      setOutcome({ ...base, status: "sent", sig: res.sig, verifying: true });
      const v = await verifyRevoked(rpcFn(), base.accounts.map((a) => a.tokenAccount));
      setOutcome((o) => (o ? { ...o, verify: v, verifying: false } : o));
      if (typeof onDone === "function") onDone();       // rescan: the list above must show the new truth
    } else if (res.status === "unconfirmed") {
      // Persist BEFORE showing it, so a rescan / tab switch / reload from this moment on restores it.
      // Already saved at signing; re-save (keeping the original start time) as a belt for the
      // signAndSendTransaction path, where sign.js cannot stop a broadcast that already happened.
      const prev = loadRevokePending(wallet.address);
      // Codex round 3 (re-review), P2: `res.noSignature` = a send-capable wallet errored after it may
      // have broadcast. The sig:null record written before the prompt STAYS and Revoke stays off.
      const sig = res.sig || null;
      const rec = { sig, accounts: base.accounts, recentBlockhash: base.recentBlockhash, lastValidBlockHeight: base.lastValidBlockHeight, wallet: wallet.address, at: prev && (prev.sig || null) === sig ? prev.at : Date.now() };
      saveRevokePending(rec);
      setOutcome({ ...base, status: "unconfirmed", sig, wallet: rec.wallet, at: rec.at });
    } else if (res.status === "declined") {
      setOutcome({ ...base, status: "declined" });
    } else {
      setOutcome({ ...base, status: "failed", sig: res.sig, error: res.error });
    }
    setBusy(false);
  }

  // The recovery action for an ambiguous send: ask sign.js's checkPendingSwap about the exact
  // signature (it searches history, because a person may tap this minutes later). pending →
  // nothing changes and there is still no Revoke; landed → the same re-read as a plain send;
  // failed on chain, or expired (no status AND a dead blockhash) → known not landed, so the chain
  // is re-read and only what still shows a delegate may be revoked again. The REAL
  // lastValidBlockHeight of the blockhash the transaction was built against is passed (null when the
  // node gave none: then checkPendingSwap can never call it expired). Any resolution clears the
  // persisted record; a still-pending answer keeps it.
  async function recheck() {
    if (!outcome || outcome.status !== "unconfirmed" || outcome.checking) return;
    setOutcome((o) => ({ ...o, checking: true }));
    try {
      const lv = outcome.lastValidBlockHeight == null ? null : outcome.lastValidBlockHeight;
      // No signature yet (the record was written before the wallet prompt): nothing to look up, only the
      // transaction's own lifetime can release it — see sign.js checkUnsignedPending.
      const r = outcome.sig
        ? await checkPendingSwap(rpcFn(), { signature: outcome.sig, lastValidBlockHeight: lv, recentBlockhash: outcome.recentBlockhash })
        : await checkUnsignedPending(rpcFn(), { lastValidBlockHeight: lv, recentBlockhash: outcome.recentBlockhash });
      if (r.status === "sent") {
        clearRevokePending(outcome.wallet || walletAddr);
        setOutcome((o) => ({ ...o, status: "sent", checking: false, verifying: true }));
      } else if (r.status === "expired" && !outcome.sig) {
        // ⚠️ Codex round 3 (re-review #2), P2: a SIGNATURE-LESS attempt whose blockhash has expired can
        // no longer land, but expiry cannot say whether it landed EARLIER — there is no signature to
        // look up. So this is not "failed / did not land". The record is released and the delegate
        // re-read below is the only claim made: all gone → cleared; some left → revocable again.
        clearRevokePending(outcome.wallet || walletAddr);
        setOutcome((o) => ({ ...o, status: "released", dead: true, checking: false, verifying: true }));
      } else if (r.status === "failed" || r.status === "expired") {
        clearRevokePending(outcome.wallet || walletAddr);
        setOutcome((o) => ({ ...o, status: "failed", dead: true, error: r.status === "failed" ? r.error : "", checking: false, verifying: true }));
      } else {
        setOutcome((o) => ({ ...o, checking: false }));
        return;
      }
      const v = await verifyRevoked(rpcFn(), outcome.accounts.map((a) => a.tokenAccount));
      setOutcome((o) => (o ? { ...o, verify: v, verifying: false } : o));
      if (typeof onDone === "function") onDone();
    } catch (e) {
      setOutcome((o) => (o ? { ...o, checking: false } : o));
    }
  }

  // The escape hatch: after REVOKE_PENDING_ESCAPE_MS an unresolved send can be dropped from view.
  // The signature link stays on the card right up to this tap; dropping it is "stop watching", not
  // a claim that nothing happened.
  function stopWatching() {
    clearRevokePending(outcome && outcome.wallet ? outcome.wallet : walletAddr);
    setOutcome(null);
  }

  // The chain's own answer, per account — shared by a landed revoke and a known-not-landed one.
  function verifyLines() {
    if (outcome.verifying) return <p>{t("Re-reading each account on chain…")}</p>;
    if (!outcome.verify) return null;
    return (
      <>
        <p>{tf("Re-read on chain: {cleared} of {n} approvals are gone.", { cleared: outcome.verify.cleared.length, n: outcome.n })}</p>
        {outcome.verify.still.length ? <p className="seeker-revoke-warn">{tf("{n} still show a delegate — rescan and revoke again.", { n: outcome.verify.still.length })}</p> : null}
        {outcome.verify.unreadable.length ? <p className="seeker-revoke-warn">{tf("{n} could not be re-read — status unknown, not counted as cleared.", { n: outcome.verify.unreadable.length })}</p> : null}
      </>
    );
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
              {verifyLines()}
              {solscanTx(outcome.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(outcome.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
            </>
          ) : outcome.status === "unconfirmed" ? (
            <>
              <p className="seeker-revoke-outcome-title">{outcome.sig ? t("Unconfirmed") : t("Revoking…")}</p>
              {/* No signature yet = the wallet prompt may still be open (or was closed with the app).
                  Deliberately reuses existing strings only: a new key needs nine translations and a
                  store-edition exclusion (seeker-build-test). */}
              {outcome.sig ? <p>{t("This was submitted but had no on-chain status after 30 seconds. It may still land — check before signing again.")}</p> : null}
              {outcome.sig ? <p className="seeker-checkup-mono seeker-revoke-sig">{shortAddr(outcome.sig)}</p> : null}
              <button type="button" className="seeker-btn seeker-btn-quiet" disabled={outcome.checking} onClick={recheck}>{outcome.checking ? t("Checking…") : t("Check status")}</button>
              {outcome.at && Date.now() - outcome.at >= REVOKE_PENDING_ESCAPE_MS ? (
                <div className="seeker-swap-pending-escape">
                  {outcome.sig ? <p>{t("This is taking longer than usual to confirm. Your signature above is the real record — check it on Solscan, or stop watching here.")}</p> : null}
                  <button type="button" className="seeker-btn seeker-btn-quiet seeker-revoke-stopwatch" onClick={stopWatching}>{t("Stop watching")}</button>
                </div>
              ) : null}
              {solscanTx(outcome.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(outcome.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
            </>
          ) : outcome.status === "released" ? (
            <>
              {/* No title and no "did not land": expiry of a signature-less attempt proves nothing
                  about whether it landed earlier. Only the chain re-read speaks. */}
              {verifyLines()}
            </>
          ) : outcome.status === "failed" ? (
            <>
              <p className="seeker-revoke-outcome-title">{t("Revoke failed")}</p>
              <p>{t("Nothing was revoked — the transaction did not land.")}{outcome.error ? ` ${outcome.error}` : ""}</p>
              {outcome.dead ? verifyLines() : null}
              {outcome.dead && solscanTx(outcome.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(outcome.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
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
