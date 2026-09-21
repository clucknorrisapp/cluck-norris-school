// Cluck Norris — Seeker app, Locker Room pane (docs/SEEKER_TOOLS_BUILD.md — registry id "lock").
// This is the flagship story (AGENTS.md): "helping communities lock tokens on Jupiter Lock and
// broadcast it." Two halves, both real tonight:
//
// ⛔ SCOPE LINE (owner-set, tonight's build): READ SIDE + FULL CONFIRM UX ONLY. No transaction is
// signed or sent. Same reason as Firepit.jsx / ProjectBurn.jsx: the send/confirm seam (sign →
// partialSign → submit → poll getSignatureStatuses) is being extracted into one hardened, reviewed
// helper after an adversarial review found a landed-but-failed status bug baked into a copy-pasted
// version of it. Locking lands on top of that helper once it exists. Tapping "Confirm and sign"
// here renders the SigningNotYet block instead of touching a wallet.
//
// Server (server.js, all read-only or build-only — nothing here ever asks a wallet to sign):
//   GET  /api/locks?mint=<mint>  — the public proof read, on-chain, no wallet needed.
//     200 { success:true, partial, mint, decimals, supply, totalLocked, pctOfSupply, lockCount,
//           breakdown:[{label,tokens}], topLocks:[{authority,tokens,label}] (top 20),
//           token:{name,symbol,icon} }
//     400 { success:false, error }  — bad mint address
//     500 { success:false, error }  — RPC/server trouble
//   POST /api/lock/create-tx  — builds and MAINNET-SIMULATES an unsigned create-lock transaction.
//     This does not sign or send anything; it is the same pre-flight the desktop tool runs before
//     ever touching a wallet, so calling it is exactly "build everything up to the signature".
//     body: { mint, sender, recipient?, amount, cliffUnix, cliffPct, periods, interval, cancelable,
//             recipientChangeable }
//     200 { ok:true, txBase64, baseSecret, escrow, escrowToken, decimals, tokenProgram,
//           schedule:{totalRaw,cliffRaw,perPeriodRaw,periods,freqSec,cliffTime}, simError,
//           tokenSymbol?, tokenName? }
//       — txBase64/baseSecret are UNSIGNED/throwaway and never used by this pane; discarded. A
//         non-null `simError` means the plan would fail on-chain (bad balance, wrong mint, a
//         soulbound/transfer-hook token, …) and this pane treats it as a fixable form problem, not
//         a result to confirm.
//     400 { ok:false, error }  — bad mint/recipient, non-transferable/transfer-hook token, etc.
//     (`schedule.cliffTime` / the derived "fully vested" date below are REAL on-chain values for a
//      lock WE are constructing right now — there is no "our vs. their" ambiguity to resolve.)
//
// ⚠️ THE FIRSTSEENAT TRAP (AGENTS.md, CUNA lock-to-earn): an escrow's own `vesting_start_time` is
// creator-set and Jupiter sets it equal to the cliff, so it lies about how long a lock has run —
// live escrows in this system declare 2069 and 2077. That trap is about READING SOMEONE ELSE'S
// escrow to judge how long it has been committed for. It does not apply to the schedule this pane
// shows in the create flow, because WE are the creator building the transaction: `cliffTime` here
// is the literal unix time the user picked (or "now"), not a declared value we have to distrust.
// Two things this pane does BECAUSE of that trap: (1) it never reads or surfaces `vestingStartTime`
// from anywhere — not from this endpoint's response (which doesn't return it) and not invented
// locally; (2) the "fully vested" date is derived the same defensive way lib/cuna-staking.js
// derives it — cliffTime + frequency*periods only when `amountPerPeriod` is actually > 0, otherwise
// everything already came free at the cliff — so a schedule padded with zero-release periods can
// never show a fake far-future end date.
//
// The confirm sheet does its OWN date math from the server's `schedule`, and this pane never
// computes a second, client-guessed date for the same lock — exactly the class of "two dates that
// disagree" the AGENTS.md trap is a record of.
//
// "Say what's on-chain, never why" (CLAUDE.md): amounts, dates, cancel/recipient-change rights and
// existing-lock totals are reported as facts. Nothing here is called safe, legit or a good idea.
//
// `Empty` and `Unavailable` never collapse into one rendering: a mint with zero on-chain locks and
// a mint we simply could not read are different answers and get different components.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, NeedsWallet, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

// AGENTS.md — the canonical CLKN mint. Used only as the View Locks tab's starting example so the
// tab never opens blank; a visitor can look up any mint at any time.
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Abbreviated K/M/B display — matches ProjectBurn.jsx's fmtNum, which the confirm-sheet precedent
// in this app already treats as "exact enough" to name an amount by (the underlying value being
// locked is never rounded; only its on-screen label is).
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
function fmtPct(fracOrNull) {
  if (fracOrNull == null || !isFinite(fracOrNull)) return null;
  const p = fracOrNull * 100;
  return p < 0.01 ? "<0.01%" : p.toFixed(p < 1 ? 4 : 2) + "%";
}
function fmtDate(unixSeconds) {
  if (unixSeconds == null || !isFinite(unixSeconds)) return null;
  try { return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch (_) { return null; }
}

// ── View Locks — the public proof half. No wallet needed: this is a chain read on ANY mint, not
// an action on the connected wallet's own assets, so it stays open even to a visitor with no
// wallet at all (the pane contract's "preview free" spirit, applied literally here since there is
// no gated action to preview toward). ────────────────────────────────────────────────────────────
function ViewLocksTab() {
  const online = useOnline();
  const [mintInput, setMintInput] = React.useState(CLKN_MINT);
  const [phase, setPhase] = React.useState("idle"); // idle | loading | result | unavailable | refused
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [data, setData] = React.useState(null);
  const abortRef = React.useRef(null);

  const load = React.useCallback((mintRaw) => {
    const mint = String(mintRaw || "").trim();
    if (!MINT_RE.test(mint)) { setPhase("refused"); setErrMsg(t("Enter a valid Solana mint address.")); return; }
    setErrMsg(null);
    if (!online) { setPhase("unavailable"); setErrKind("offline"); return; }
    setPhase("loading");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    toolFetch(`/api/locks?mint=${encodeURIComponent(mint)}`, { signal: ctrl.signal }).then((res) => {
      if (res.kind === "aborted") return;
      if (res.ok) { setData(res.data); setPhase("result"); return; }
      if (res.kind === "offline") { setErrKind("offline"); setPhase("unavailable"); return; }
      if (res.kind === "refused") { setErrMsg((res.body && res.body.error) || t("That mint wasn't something we could use.")); setPhase("refused"); return; }
      setErrKind("unavailable");
      setPhase("unavailable");
    });
  }, [online]);

  React.useEffect(() => {
    load(CLKN_MINT);
    return () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mint = (data && data.mint) || mintInput.trim();
  const proofHref = MINT_RE.test(mint) ? `/lock/${encodeURIComponent(mint)}` : null;
  const jupHref = MINT_RE.test(mint) ? `https://lock.jup.ag/token/${encodeURIComponent(mint)}` : null;

  return (
    <>
      <div className="seeker-listing-form">
        <label className="seeker-listing-label" htmlFor="lr-mint">{t("Token mint address")}</label>
        <input
          id="lr-mint"
          className="seeker-listing-input"
          value={mintInput}
          onChange={(e) => setMintInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(mintInput); }}
          placeholder={t("Paste a token's mint address")}
          autoComplete="off"
          spellCheck="false"
        />
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={() => load(mintInput)} disabled={phase === "loading"}>
          {phase === "loading" ? t("Reading…") : t("Look up locks")}
        </button>
      </div>

      {phase === "loading" ? <Loading label={t("Reading on-chain locks…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} onRetry={() => load(mintInput)} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && data ? (
        <>
          {data.lockCount > 0 ? (
            <div className="seeker-listing-card">
              <div className="seeker-listing-card-title">
                {data.token && (data.token.name || data.token.symbol)
                  ? (data.token.name && data.token.symbol ? `${data.token.name} · ${data.token.symbol}` : (data.token.name || data.token.symbol))
                  : t("Token")}
              </div>
              <div className="seeker-tool-note" style={{ marginBottom: 10 }}>{shortAddr(data.mint)}</div>

              <div className="seeker-lock-pctwrap">
                <span className="seeker-lock-pct">{fmtPct(data.pctOfSupply) || "—"}</span>
                <span className="seeker-lock-pctcap">{t("OF SUPPLY LOCKED")}</span>
              </div>
              {data.pctOfSupply == null ? <p className="seeker-tool-note">{t("Total supply couldn't be read, so the percentage is unknown — the totals below are still real.")}</p> : null}

              <div className="seeker-brief-majors">
                <div className="seeker-brief-major">
                  <span className="seeker-brief-major-sym">{t("TOTAL LOCKED")}</span>
                  <span className="seeker-brief-major-price">{fmtNum(data.totalLocked)}</span>
                </div>
                <div className="seeker-brief-major">
                  <span className="seeker-brief-major-sym">{t("LOCK ACCOUNTS")}</span>
                  <span className="seeker-brief-major-price">{data.lockCount || 0}</span>
                </div>
              </div>

              {data.partial ? <p className="seeker-tool-note" style={{ marginTop: 10 }}>{t("Partial read — an on-chain scan didn't fully complete, so these totals may undercount. Try again shortly.")}</p> : null}

              {(data.breakdown || []).length > 0 ? (
                <>
                  <div className="seeker-lock-toplocks-title">{t("BY PLATFORM")}</div>
                  {data.breakdown.map((b, i) => {
                    const w = data.totalLocked > 0 ? (b.tokens / data.totalLocked) * 100 : 0;
                    return (
                      <div key={i}>
                        <div className="seeker-brief-pool-row" style={{ borderTop: i === 0 ? "none" : undefined }}>
                          <span className="seeker-brief-pool-pair">{b.label}</span>
                          <span className="seeker-brief-pool-nums">{fmtNum(b.tokens)} · {w.toFixed(1)}%</span>
                        </div>
                        <div className="seeker-launch-bar"><div className="seeker-launch-bar-fill" style={{ width: w.toFixed(1) + "%" }} /></div>
                      </div>
                    );
                  })}
                </>
              ) : null}

              {(data.topLocks || []).length > 0 ? (
                <>
                  <div className="seeker-lock-toplocks-title">{t("BIGGEST LOCKS")}</div>
                  {data.topLocks.slice(0, 8).map((l, i) => (
                    <div className="seeker-brief-pool-row" key={l.authority + i} style={{ borderTop: i === 0 ? "none" : undefined }}>
                      <span className="seeker-lock-toplock-rank">{i + 1}</span>
                      <span className="seeker-lock-toplock-amt">{fmtNum(l.tokens)}</span>
                      <span className="seeker-lock-toplock-who">{shortAddr(l.authority)}</span>
                      <span className="seeker-lock-toplock-label">{l.label}</span>
                    </div>
                  ))}
                </>
              ) : null}

              <p className="seeker-tool-note" style={{ marginTop: 12 }}>{t("Scope: counts Jupiter Lock, Streamflow and Bonfida Vesting escrows plus permanently frozen self-owned accounts, read live on-chain. Locks on other vesting platforms are not yet detected.")}</p>
            </div>
          ) : (
            <Empty>{t("No on-chain locks found for this mint yet — be the first to lock in the Create a Lock tab.")}</Empty>
          )}

          <div style={{ textAlign: "center", marginTop: 4 }}>
            {proofHref ? <a className="seeker-listing-link" href={proofHref} target="_blank" rel="noopener noreferrer">{t("Open the public report →")}</a> : null}
            {jupHref ? <a className="seeker-listing-link" href={jupHref} target="_blank" rel="noopener noreferrer">{t("Cross-check on lock.jup.ag →")}</a> : null}
          </div>
        </>
      ) : null}
    </>
  );
}

// ── Create a Lock — moves the connected wallet's own tokens, so it needs a wallet. ────────────────
function CreateLockTab({ wallet }) {
  const online = useOnline();
  const [mintInput, setMintInput] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [recipientInput, setRecipientInput] = React.useState("");
  const [cliffDate, setCliffDate] = React.useState("");
  const [cliffPct, setCliffPct] = React.useState("0");
  const [duration, setDuration] = React.useState("12");
  const [intervalUnit, setIntervalUnit] = React.useState("month");
  const [cancelable, setCancelable] = React.useState(false);
  const [recipientChangeable, setRecipientChangeable] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  const [simWarning, setSimWarning] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | building | reviewed | unavailable
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [plan, setPlan] = React.useState(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function quickCliff(months) {
    if (!months) { setCliffDate(""); return; }
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setCliffDate(d.toISOString().slice(0, 10));
  }

  function review() {
    const mint = mintInput.trim();
    if (!MINT_RE.test(mint)) { setFormError(t("Enter a valid Solana mint address.")); return; }
    const amt = parseFloat(String(amount).trim());
    if (!(amt > 0)) { setFormError(t("Enter an amount greater than zero.")); return; }
    const recipient = recipientInput.trim();
    if (recipient && !MINT_RE.test(recipient)) { setFormError(t("Recipient must be a valid Solana wallet address.")); return; }
    const periods = Math.max(1, Math.min(1000, parseInt(duration, 10) || 1));
    const pct = Math.max(0, Math.min(100, parseFloat(cliffPct) || 0));
    setFormError(null);
    setSimWarning(null);
    setNotice(null);
    setPlan(null);
    if (!online) { setPhase("unavailable"); setErrKind("offline"); return; }
    setPhase("building");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cliffUnix = cliffDate ? Math.floor(new Date(cliffDate + "T00:00:00Z").getTime() / 1000) : 0;
    toolFetch("/api/lock/create-tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        mint, sender: wallet.address, recipient: recipient || undefined, amount: String(amt),
        cliffUnix, cliffPct: pct, periods, interval: intervalUnit,
        cancelable, recipientChangeable,
      }),
    }).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        if (res.kind === "offline") { setErrKind("offline"); setPhase("unavailable"); return; }
        if (res.kind === "refused") { setSimWarning((res.body && res.body.error) || t("That couldn't be locked as entered.")); setPhase("form"); return; }
        setErrKind("unavailable");
        setPhase("unavailable");
        return;
      }
      const d = res.data;
      if (d.simError) { setSimWarning(d.simError); setPhase("form"); return; }
      setPlan({ ...d, recipientResolved: recipient || wallet.address, cancelable, recipientChangeable });
      setPhase("reviewed");
    });
  }

  if (!wallet.connected) {
    return (
      <>
        <p className="seeker-tool-lede">{t("Lock your project's tokens on Jupiter Lock's audited program — non-custodial, no cut, no fee. Everything unlocks on a fixed public schedule your community can verify forever.")}</p>
        <NeedsWallet why="Connect the wallet that holds the tokens you want to lock." wallet={wallet} />
      </>
    );
  }

  const dec = plan ? plan.decimals : null;
  const scale = dec != null ? Math.pow(10, dec) : null;
  const totalTokens = plan && scale ? Number(plan.schedule.totalRaw) / scale : null;
  const cliffTokens = plan && scale ? Number(plan.schedule.cliffRaw) / scale : null;
  const perPeriodTokens = plan && scale ? Number(plan.schedule.perPeriodRaw) / scale : null;
  const periodsN = plan ? plan.schedule.periods : null;
  const cliffTime = plan ? plan.schedule.cliffTime : null;
  // Mirrors lib/cuna-staking.js's own derivation of "when the last token actually comes free":
  // only trust an end date past the cliff when a period actually releases something.
  const fullyVestedAt = plan ? (perPeriodTokens > 0 ? cliffTime + plan.schedule.freqSec * periodsN : cliffTime) : null;
  const symbol = plan ? (plan.tokenSymbol || null) : null;
  const isSelf = plan && plan.recipientResolved === wallet.address;

  const confirmLines = plan ? [
    <span key="a">{t("Locking")}: <strong>{fmtNum(totalTokens)}{symbol ? ` ${symbol}` : ""}</strong></span>,
    <span key="r">{t("Claimable by")}: <strong>{isSelf ? t("you") : shortAddr(plan.recipientResolved)}</strong></span>,
    cliffTokens > 0
      ? <span key="s1">{fmtNum(cliffTokens)}{symbol ? ` ${symbol}` : ""} {t("unlocks on")} <strong>{fmtDate(cliffTime)}</strong>{perPeriodTokens > 0 ? <>; {t("the rest releases in")} {periodsN} {t("steps until fully unlocked on")} <strong>{fmtDate(fullyVestedAt)}</strong></> : null}.</span>
      : (perPeriodTokens > 0
          ? <span key="s2">{t("Nothing unlocks until")} <strong>{fmtDate(cliffTime)}</strong> ({t("the cliff")}). {t("After that it releases in")} {periodsN} {t("steps until fully unlocked on")} <strong>{fmtDate(fullyVestedAt)}</strong>.</span>
          : <span key="s3">{t("All of it unlocks on")} <strong>{fmtDate(cliffTime)}</strong>. {t("Nothing releases before that date.")}</span>),
    <span key="c">{plan.cancelable
      ? t("This lock is cancelable — you can reclaim anything not yet vested before the schedule finishes.")
      : t("This lock CANNOT be canceled. The tokens cannot be retrieved before the dates above, by anyone, including us.")}</span>,
    plan.recipientChangeable ? <span key="rc">{t("You can redirect who claims it later — the recipient isn't permanent.")}</span> : null,
    <span key="f">{t("This moves the tokens into an on-chain escrow the moment it's submitted. It cannot be undone.")}</span>,
  ].filter(Boolean) : [];

  function openConfirm() { if (plan) setConfirmOpen(true); }
  function cancelConfirm() { setConfirmOpen(false); }
  function onConfirmed() {
    // ⛔ NO SIGNING TONIGHT. See the file header — deliberate stop, not a bug.
    setConfirmOpen(false);
    setNotice({ amount: totalTokens, symbol, cliffTime, fullyVestedAt });
  }

  return (
    <>
      <p className="seeker-tool-lede">{t("Lock your project's tokens on Jupiter Lock's audited program — non-custodial, no cut, no fee. Everything unlocks on a fixed public schedule your community can verify forever.")}</p>

      <div className="seeker-listing-form">
        <label className="seeker-listing-label" htmlFor="lr-c-mint">{t("Token mint address")}</label>
        <input id="lr-c-mint" className="seeker-listing-input" value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder={t("Paste your token's mint address")} autoComplete="off" spellCheck="false" />

        <label className="seeker-listing-label" htmlFor="lr-c-amount">{t("Amount to lock")}</label>
        <input id="lr-c-amount" className="seeker-listing-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />

        <label className="seeker-listing-label" htmlFor="lr-c-recipient">{t("Recipient wallet (who can claim)")}</label>
        <input id="lr-c-recipient" className="seeker-listing-input" value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)} placeholder={t("Leave blank to lock to yourself")} autoComplete="off" spellCheck="false" />

        <label className="seeker-listing-label">{t("Cliff date (optional wait before anything unlocks)")}</label>
        <input className="seeker-listing-input" type="date" value={cliffDate} onChange={(e) => setCliffDate(e.target.value)} />
        <div className="seeker-burn-pctrow" style={{ marginTop: 8 }}>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => quickCliff(3)}>{t("+3mo")}</button>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => quickCliff(6)}>{t("+6mo")}</button>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => quickCliff(12)}>{t("+1yr")}</button>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => quickCliff(0)}>{t("Clear")}</button>
        </div>

        <label className="seeker-listing-label" htmlFor="lr-c-cliffpct">{t("% released at the cliff")}</label>
        <input id="lr-c-cliffpct" className="seeker-listing-input" inputMode="decimal" value={cliffPct} onChange={(e) => setCliffPct(e.target.value)} placeholder="0" />

        <label className="seeker-listing-label">{t("Then release the rest in")}</label>
        <div className="seeker-lock-durrow">
          <input className="seeker-listing-input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="12" />
          <select className="seeker-lock-select" value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value)}>
            <option value="day">{t("daily steps")}</option>
            <option value="week">{t("weekly steps")}</option>
            <option value="month">{t("monthly steps")}</option>
          </select>
        </div>

        <label className="seeker-lock-toggle">
          <input type="checkbox" checked={cancelable} onChange={(e) => setCancelable(e.target.checked)} />
          <span>
            <span className="seeker-lock-toggle-label">{t("Make this lock cancelable by me")}</span>
            <span className="seeker-lock-toggle-note">{t("Off (default) is the stronger lock: permanent, nobody — including us — can pull the tokens back early.")}</span>
          </span>
        </label>
        <label className="seeker-lock-toggle">
          <input type="checkbox" checked={recipientChangeable} onChange={(e) => setRecipientChangeable(e.target.checked)} />
          <span>
            <span className="seeker-lock-toggle-label">{t("Recipient can be changed later")}</span>
            <span className="seeker-lock-toggle-note">{t("Off (default) makes the recipient permanent. On, you can redirect who claims it — useful if the recipient wallet is ever compromised.")}</span>
          </span>
        </label>

        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        {simWarning ? <p className="seeker-lock-simwarning" role="alert">{simWarning}</p> : null}

        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={review} disabled={phase === "building"}>
          {phase === "building" ? t("Checking on-chain…") : t("Review lock")}
        </button>
      </div>

      {phase === "building" ? <Loading label={t("Building and simulating the lock on-chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={review} /> : null}

      {phase === "reviewed" && plan ? (
        <div className="seeker-burn-tokencard">
          <div className="seeker-burn-tokenhead">
            <span className="seeker-burn-tokenicon">{(symbol || "?").slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="seeker-burn-tokenname">{plan.tokenName && plan.tokenName !== symbol ? `${plan.tokenName} · ${symbol}` : (symbol || t("Token"))}</div>
              <div className="seeker-tool-note">{t("Escrow")}: {shortAddr(plan.escrow)}</div>
            </div>
          </div>
          <dl className="seeker-listing-facts">
            <div><dt>{t("Amount")}</dt><dd>{fmtNum(totalTokens)}{symbol ? ` ${symbol}` : ""}</dd></div>
            <div><dt>{t("Claimable by")}</dt><dd>{isSelf ? t("you") : shortAddr(plan.recipientResolved)}</dd></div>
            <div><dt>{t("First unlock")}</dt><dd>{fmtDate(cliffTime)}</dd></div>
            <div><dt>{t("Fully unlocked")}</dt><dd>{fmtDate(fullyVestedAt)}</dd></div>
            <div><dt>{t("Cancelable")}</dt><dd>{plan.cancelable ? t("Yes, by you") : t("No — permanent")}</dd></div>
          </dl>
          <button type="button" className="seeker-btn seeker-btn-danger seeker-burn-actionbtn" onClick={openConfirm}>{t("Lock tokens")}</button>
        </div>
      ) : null}

      <Confirm
        open={confirmOpen}
        title="Confirm lock"
        lines={confirmLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />

      {notice ? (
        <div className="seeker-tool-notyet" role="status">
          <p className="seeker-tool-notyet-title">🚧 {t("Signing lands in the next build")}</p>
          <p>{t("Nothing was sent or signed. This build ships the on-chain simulation, the exact schedule and this confirm step; the actual lock transaction ships in a follow-up build on a hardened, shared send-and-confirm helper.")}</p>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => setNotice(null)}>{t("OK")}</button>
        </div>
      ) : null}
    </>
  );
}

export default function LockerRoomPane({ wallet }) {
  const [tab, setTab] = React.useState("view"); // view | create

  return (
    <Pane icon="🔒" title="Locker Room">
      <div className="seeker-launch-tabs">
        <button type="button" className={"seeker-launch-tabbtn" + (tab === "view" ? " active" : "")} onClick={() => setTab("view")}>{t("View Locks")}</button>
        <button type="button" className={"seeker-launch-tabbtn" + (tab === "create" ? " active" : "")} onClick={() => setTab("create")}>{t("Create a Lock")}</button>
      </div>

      {tab === "view" ? (
        <>
          <p className="seeker-tool-lede">{t("Any Solana token can be locked here, free — see exactly what's locked for a mint, on-chain, verifiable by anyone.")}</p>
          <ViewLocksTab />
        </>
      ) : (
        <CreateLockTab wallet={wallet} />
      )}
    </Pane>
  );
}
