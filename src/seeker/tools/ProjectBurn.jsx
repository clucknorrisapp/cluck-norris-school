// Cluck Norris — Seeker app, Project Burn pane (docs/SEEKER_TOOLS_BUILD.md — registry id "burn").
//
// Signs and sends. Every transaction goes through src/seeker/sign.js's signSendConfirm() — the
// app's one signing seam (confirmation-err-first, three outcomes, live-pubkey re-read, message-
// byte diff, connected-wallet-signs-first). This file does not re-implement any of that; the
// unconfirmed-recheck below reuses sign.js's own confirmSignature() rather than a second copy.
//
// Server (server.js, read-only until the receipt call):
//   GET  /api/burn-token-info?mint=<mint>&wallet=<address>
//     200 { success:true, mint, symbol, name, decimals, program, supplyRaw, supply, priceUsd,
//           walletBalanceRaw, walletBalance, tokenAccount }
//     400 { success:false, error }  — bad mint/wallet, or not a fungible token
//     404 { success:false, error }  — mint not found on-chain
//     500 { success:false, error }  — server/RPC trouble
//   POST /api/burn-receipt { sig, mint, wallet } — re-reads the transaction on-chain, checks the
//     wallet signed it, and reads the TRUE burned amount from the pre/post token balance delta
//     (never the client's claim) before minting a receipt. A verified burn over
//     BURN_BROADCAST_MIN_USD (server default $10, unpriced tokens skipped) also auto-posts a
//     celebration to X/Telegram — that is entirely server-side policy the client cannot see or
//     control, so this pane never promises a broadcast. There is also no hosted receipt PAGE
//     (checked public/project-burn.html — it has none either): the "receipt" is the server's
//     VERIFIED figures (burned amount, usdValue, pctSupply, all re-derived from the chain, never
//     the client's claim) shown in-app plus a Solscan link, the same as the desktop tool.
//   A receipt failure is NEVER reported as a failed burn — the tokens are already gone by the
//   time this call happens. The burn outcome and the receipt outcome are two separate facts,
//   shown as two separate lines.
//
// `supply` and `priceUsd` can each be null (best-effort reads) — reported as UNKNOWN, never as
// zero or omitted, so the confirm sheet never implies "0% of supply" or "$0 destroyed" when the
// true figure just couldn't be read (CLAUDE.md: a failed read is never a lie about the numbers).
// "Say what's on-chain, never why": this pane reports supply, balance and price as facts and
// never labels the token or the burn safe, verified, or a good idea.
//
// ⚠️ FRESH READ BEFORE SIGNING: tapping Burn does not build the transaction from whatever the
// page happened to be showing — it re-reads /api/burn-token-info right then, re-checks the typed
// amount against that fresh balance, and freezes the result (`confirmTok`) before the sheet ever
// opens. Signing later reads only that frozen snapshot, never a value recomputed at signing time
// (same discipline as Firepit's confirmSel, firepit.html's own variable of that name).
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, NeedsWallet, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import { signSendConfirm, confirmSignature, rpcFn, splTokenShim } from "../sign.js";
import "./tools.css";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Only ever an href built from a validated value (CLAUDE.md — React's escaping doesn't neutralise
// an href). `sig` here always originates from our own signSendConfirm() call, never from an
// external API or user input, but the check costs nothing and matches Airdropper's own solscanTx().
function solscanTx(sig) { return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null; }

function fmtUsd(n) {
  n = Number(n) || 0;
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
function fmtPctSupply(p) {
  if (p == null) return null;
  return p < 0.01 ? "<0.01%" : p.toFixed(p < 1 ? 4 : 2) + "%";
}
// A decimal-string amount → raw integer string, BigInt-safe (no float rounding).
function scaleToRaw(s, decimals) {
  s = String(s || "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return "0";
  const parts = s.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
  return (whole + frac).replace(/^0+/, "") || "0";
}

const OUTCOME_LABEL = {
  sent: "Burned",
  failed: "Burn failed",
  unconfirmed: "Unconfirmed",
  declined: "Declined",
};

function OutcomeCard({ o, onDismiss, onRetry, onCheckStatus }) {
  return (
    <div className={"seeker-burn-outcome seeker-burn-outcome-" + o.status} role={o.status === "failed" || o.status === "unconfirmed" ? "alert" : "status"}>
      <p className="seeker-burn-outcome-title">
        {o.status === "sent" ? "🔥 " : o.status === "failed" ? "⚠️ " : o.status === "unconfirmed" ? "⏳ " : ""}
        {t(OUTCOME_LABEL[o.status])}
      </p>
      {o.status === "sent" ? (
        <>
          <p>{t("Burned")} <strong>{fmtNum((o.receipt && o.receipt.burned) != null ? o.receipt.burned : o.amount)} {o.symbol}</strong>{o.isFullBalance ? <> · {t("your entire balance")}</> : null}. {t("This is permanent and cannot be undone.")}</p>
          {o.receipt ? (
            <>
              {/* The server re-read the transaction on-chain and verified this — never the
                  client's own claim (server.js /api/burn-receipt). No hosted receipt page exists
                  yet (checked public/project-burn.html: it shows the same verified figures plus a
                  Solscan link, nothing more), so this pane shows exactly that, not a fabricated
                  URL. */}
              {o.receipt.usdValue != null ? <p>{t("Verified value destroyed")}: <strong className="seeker-firepit-destroyval">{fmtUsd(o.receipt.usdValue)}</strong></p> : null}
              {o.receipt.pctSupply != null ? <p>{fmtPctSupply(o.receipt.pctSupply)} {t("of total supply, verified on-chain.")}</p> : null}
              {solscanTx(o.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
            </>
          ) : o.receiptError ? (
            <p className="seeker-passgate-err">{t("The tokens were burned. The verified receipt could not be recorded:")} {o.receiptError}{solscanTx(o.sig) ? <> — <a className="seeker-forensic-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("view transaction on Solscan")}</a></> : null}</p>
          ) : (
            <p>{t("Verifying the burn on-chain…")}</p>
          )}
        </>
      ) : o.status === "unconfirmed" ? (
        <>
          <p>{t("This was submitted but had no on-chain status after 30 seconds. It may still have landed — check before doing anything else. Resending it if it already landed would burn the tokens a second time.")}</p>
          <div className="seeker-burn-outcome-actions">
            <button type="button" className="seeker-btn seeker-btn-quiet" disabled={o.checking} onClick={onCheckStatus}>{o.checking ? t("Checking…") : t("Check status")}</button>
          </div>
        </>
      ) : o.status === "failed" ? (
        <>
          <p>{t("Nothing was burned — the transaction did not land.")}{o.error ? ` ${o.error}` : ""}</p>
          <div className="seeker-burn-outcome-actions">
            <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onRetry}>{t("Try again")}</button>
          </div>
        </>
      ) : (
        <>
          <p>{t("You declined in your wallet — nothing was sent.")}</p>
          <div className="seeker-burn-outcome-actions">
            <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onRetry}>{t("Try again")}</button>
          </div>
        </>
      )}
      {o.status !== "unconfirmed" ? (
        <div className="seeker-burn-outcome-actions">
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onDismiss}>{t("OK")}</button>
        </div>
      ) : null}
    </div>
  );
}

export default function ProjectBurnPane({ wallet }) {
  const online = useOnline();
  const [mintInput, setMintInput] = React.useState("");
  const [formError, setFormError] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | loading | loaded | unavailable | refused
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [tok, setTok] = React.useState(null);
  const [amount, setAmount] = React.useState("");
  // confirmPhase: idle | checking (fresh re-read in flight) | ready (sheet open) | stale | error
  const [confirmPhase, setConfirmPhase] = React.useState("idle");
  const [confirmTok, setConfirmTok] = React.useState(null); // the FROZEN fresh read + resolved raw amount — see header note
  const [burning, setBurning] = React.useState(false);
  const [burnOutcome, setBurnOutcome] = React.useState(null); // { status, sig?, error?, amount, symbol, mint, usdValue, pctSupply, isFullBalance, receipt?, receiptError?, checking? }
  const abortRef = React.useRef(null);
  const confirmAbortRef = React.useRef(null);

  React.useEffect(() => () => {
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
  }, []);

  // Shared fetch — used both for the first load from the form and for a silent refresh after a
  // burn lands (which must NOT reset the amount field or clear an outcome card still on screen).
  function fetchToken(mint) {
    if (!online) { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
    setPhase("loading");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/burn-token-info?mint=${encodeURIComponent(mint)}&wallet=${encodeURIComponent(wallet.address || "")}`;
    toolFetch(url, { signal: ctrl.signal }).then((res) => {
      if (res.kind === "aborted") return;
      if (res.ok) { setTok(res.data); setPhase("loaded"); return; }
      if (res.kind === "offline") { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
      if (res.kind === "refused") {
        setPhase("refused");
        setErrMsg((res.body && res.body.error) || t("That mint wasn't something we could use."));
        return;
      }
      setErrKind("unavailable"); setErrMsg(t("Could not read that token from the chain right now. Try again shortly."));
      setPhase("unavailable");
    });
  }
  // A refresh/retry of the CURRENTLY loaded mint — after a burn lands, or from the Unavailable
  // panel's "Try again". Never touches the amount field or an outcome card still on screen.
  function loadToken() {
    const mint = tok && tok.mint;
    if (!mint) return;
    fetchToken(mint);
  }
  // First load, from the form's mint input — resets the form's own state.
  function loadTokenFromInput() {
    const mint = mintInput.trim();
    if (!MINT_RE.test(mint)) { setFormError(t("Enter a valid Solana mint address.")); return; }
    setFormError(null);
    setAmount("");
    setBurnOutcome(null);
    fetchToken(mint);
  }

  if (!wallet.connected) {
    return (
      <Pane icon="🕯" title="Project Burn">
        <p className="seeker-tool-lede">{t("Burn part of your own project's token supply, on purpose, and get a shareable on-chain-verified receipt. Non-custodial — you sign, we take nothing.")}</p>
        <NeedsWallet why="Connect the wallet that holds the tokens you want to burn." wallet={wallet} />
      </Pane>
    );
  }

  const balance = tok && tok.walletBalance != null ? Number(tok.walletBalance) : null;
  const amtNum = parseFloat(amount) || 0;
  const overBalance = balance != null && amtNum > balance + 1e-12;
  const rawAmt = tok ? scaleToRaw(amount, tok.decimals) : "0";
  const tooSmall = amtNum > 0 && rawAmt === "0";
  const canBurn = tok && amtNum > 0 && !overBalance && !tooSmall && confirmPhase !== "checking" && !burning;

  function setPct(p) {
    if (!tok || balance == null) return;
    if (p === 100) setAmount(String(balance));
    else setAmount(String(+(balance * p / 100).toFixed(tok.decimals)));
    if (confirmPhase !== "idle") setConfirmPhase("idle");
  }

  const usdValue = tok && tok.priceUsd != null ? amtNum * tok.priceUsd : null;
  const pctSupply = tok && tok.supply ? (amtNum / tok.supply) * 100 : null;
  const isFullBalance = balance != null && amtNum >= balance - 1e-12 && amtNum > 0;

  // ── open the confirm sheet on a FRESH chain read (see header note) ─────────────────────────
  async function openConfirm() {
    if (!tok || !canBurn) return;
    const mint = tok.mint;
    const typedAmt = amtNum;
    setConfirmPhase("checking");
    setConfirmTok(null);
    try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    confirmAbortRef.current = ctrl;
    const res = await toolFetch(`/api/burn-token-info?mint=${encodeURIComponent(mint)}&wallet=${encodeURIComponent(wallet.address || "")}`, { signal: ctrl.signal });
    if (res.kind === "aborted") return;
    if (!res.ok) { setConfirmPhase("error"); return; }
    const fresh = res.data;
    setTok(fresh); // keep the visible card in step with the same fresh read used to sign
    const freshBal = fresh.walletBalance != null ? Number(fresh.walletBalance) : null;
    if (freshBal == null || typedAmt <= 0 || typedAmt > freshBal + 1e-12) { setConfirmPhase("stale"); return; }
    const freshFull = freshBal != null && typedAmt >= freshBal - 1e-12;
    // A full-balance burn uses the EXACT on-chain raw balance (no float path) so nothing rounds
    // and leaves dust; otherwise scale the typed decimal string by the fresh decimals.
    const freshRaw = freshFull && fresh.walletBalanceRaw ? fresh.walletBalanceRaw : scaleToRaw(amount, fresh.decimals);
    if (!freshRaw || freshRaw === "0") { setConfirmPhase("stale"); return; }
    setConfirmTok({ ...fresh, rawAmt: freshRaw, amtNum: typedAmt, isFullBalance: freshFull });
    setConfirmPhase("ready");
  }
  function cancelConfirm() { setConfirmPhase("idle"); setConfirmTok(null); }

  // ── build + sign, exactly the frozen confirmTok — never a recomputed read ──────────────────
  async function onConfirmed() {
    const frozen = confirmTok;
    setConfirmPhase("idle");
    setConfirmTok(null);
    if (!frozen) return;
    setBurning(true);
    setBurnOutcome(null);
    const res = await signSendConfirm({
      provider: wallet.provider,
      owner: wallet.address,
      build: (web3, blockhash, owner) => {
        const { Transaction, PublicKey } = web3;
        const spl = splTokenShim();
        const ownerKey = new PublicKey(owner);
        const mintKey = new PublicKey(frozen.mint);
        // The token account to burn from: the server's fresh read returned the holder's
        // largest-balance account (its ATA in the normal case); derive it if absent — same
        // fallback as public/project-burn.html.
        const ata = frozen.tokenAccount ? new PublicKey(frozen.tokenAccount)
          : spl.getAssociatedTokenAddressSync(mintKey, ownerKey, frozen.program);
        const tx = new Transaction();
        // ONLY a burnChecked instruction — decimals-checked by the program, so a wrong-decimals
        // build fails safe rather than burning the wrong amount. No close: the account stays open.
        tx.add(spl.createBurnCheckedInstruction(ata, mintKey, ownerKey, frozen.rawAmt, frozen.decimals, frozen.program));
        tx.feePayer = ownerKey;
        tx.recentBlockhash = blockhash;
        return tx;
      },
    });
    await settleOutcome(res, frozen);
  }

  async function fetchReceipt(sig, mint) {
    try {
      const r = await fetch("/api/burn-receipt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sig, mint, wallet: wallet.address }),
      });
      const j = await r.json().catch(() => null);
      if (j && j.success) setBurnOutcome((o) => (o ? { ...o, receipt: j.receipt } : o));
      else setBurnOutcome((o) => (o ? { ...o, receiptError: (j && j.error) || t("unknown error") } : o));
    } catch (_) {
      setBurnOutcome((o) => (o ? { ...o, receiptError: t("could not reach the receipt service") } : o));
    }
  }

  async function settleOutcome(res, frozen) {
    const base = {
      amount: frozen.amtNum, symbol: frozen.symbol, mint: frozen.mint,
      usdValue: frozen.priceUsd != null ? frozen.amtNum * frozen.priceUsd : null,
      pctSupply: frozen.supply ? (frozen.amtNum / frozen.supply) * 100 : null,
      isFullBalance: frozen.isFullBalance,
    };
    if (res.status === "sent") {
      setBurnOutcome({ ...base, status: "sent", sig: res.sig });
      fetchReceipt(res.sig, frozen.mint);
      loadToken(); // refresh balance/supply so a second burn sees the new figure
    } else if (res.status === "unconfirmed") {
      setBurnOutcome({ ...base, status: "unconfirmed", sig: res.sig });
    } else if (res.status === "declined") {
      setBurnOutcome({ ...base, status: "declined" });
    } else {
      setBurnOutcome({ ...base, status: "failed", error: res.error });
    }
    setBurning(false);
  }

  // The PRIMARY recovery action for an ambiguous send: re-poll the exact signature already held
  // via sign.js's own confirmSignature — never a second, hand-rolled status check (header note).
  // A "still pending" result changes nothing so a stray tap can't be read as permission to retry.
  async function recheckPending() {
    if (!burnOutcome || burnOutcome.status !== "unconfirmed" || burnOutcome.checking) return;
    setBurnOutcome((o) => ({ ...o, checking: true }));
    try {
      // searchHistory: a recheck can happen minutes or hours later, by which point a genuinely
      // landed burn has fallen out of the validator's recent-status cache and would come back
      // ambiguous forever. attempts:1 because this is a person asking now, not a poll.
      const landed = await confirmSignature(rpcFn(), burnOutcome.sig, { searchHistory: true, attempts: 1 });
      if (landed) {
        setBurnOutcome((o) => ({ ...o, status: "sent", checking: false }));
        fetchReceipt(burnOutcome.sig, burnOutcome.mint);
        loadToken();
      } else {
        setBurnOutcome((o) => ({ ...o, checking: false })); // still ambiguous — unchanged, safe
      }
    } catch (e) {
      // Landed AND failed on-chain: nothing was burned. Safe to retry.
      setBurnOutcome((o) => ({ ...o, status: "failed", error: (e && e.message) || String(e), checking: false }));
    }
  }

  function dismissOutcome() { setBurnOutcome(null); }
  function retryFromOutcome() { setBurnOutcome(null); }

  const confirmLines = confirmTok ? [
    <span key="a">{t("Burning")}: <strong>{fmtNum(confirmTok.amtNum)} {confirmTok.symbol}</strong>{confirmTok.isFullBalance ? <> · {t("your entire balance")}</> : null}</span>,
    <span key="p">{confirmTok.supply ? <>{fmtPctSupply((confirmTok.amtNum / confirmTok.supply) * 100)} {t("of the total token supply")}</> : t("Total supply is unknown — we can't say what share of supply this is.")}</span>,
    <span key="v">{confirmTok.priceUsd != null ? <>{t("Value being destroyed")}: <strong className="seeker-firepit-destroyval">{fmtUsd(confirmTok.amtNum * confirmTok.priceUsd)}</strong></> : t("This token has no live price — the dollar value being destroyed is unknown, not zero.")}</span>,
    <span key="o">{t("The token account stays open — only the burned amount is destroyed.")}</span>,
    <span key="f">{t("This is permanent. Burned tokens are gone forever and cannot be recovered.")}</span>,
  ] : [];

  return (
    <Pane icon="🕯" title="Project Burn">
      <p className="seeker-tool-lede">{t("Burn part of your own project's token supply, on purpose, and get a shareable on-chain-verified receipt for your community. Non-custodial — you sign, we take nothing.")}</p>

      <div className="seeker-burn-form">
        <label className="seeker-listing-label" htmlFor="pb-mint">{t("Token mint address")}</label>
        <input
          id="pb-mint"
          className="seeker-listing-input"
          value={mintInput}
          onChange={(e) => setMintInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") loadTokenFromInput(); }}
          placeholder={t("Paste your token's mint address")}
          autoComplete="off"
          spellCheck="false"
        />
        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={loadTokenFromInput} disabled={phase === "loading"}>
          {phase === "loading" ? t("Reading…") : t("Load token")}
        </button>
      </div>

      {phase === "loading" ? <Loading label={t("Reading the token from the chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={tok && tok.mint ? loadToken : loadTokenFromInput} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "loaded" && tok ? (
        <div className="seeker-burn-tokencard">
          <div className="seeker-burn-tokenhead">
            <span className="seeker-burn-tokenicon">{(tok.symbol || "?").slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="seeker-burn-tokenname">{tok.name && tok.name !== tok.symbol ? `${tok.name} · ${tok.symbol}` : tok.symbol}</div>
              <div className="seeker-tool-note">{shortAddr(tok.mint)}</div>
            </div>
          </div>
          <dl className="seeker-listing-facts">
            <div><dt>{t("Your balance")}</dt><dd>{tok.walletBalance == null ? t("Unknown") : `${fmtNum(balance)} ${tok.symbol}`}</dd></div>
            <div><dt>{t("Total supply")}</dt><dd>{tok.supply == null ? t("Unknown") : fmtNum(tok.supply)}</dd></div>
            <div><dt>{t("Price")}</dt><dd>{tok.priceUsd == null ? t("Unknown") : (tok.priceUsd < 0.000001 ? "<$0.000001" : "$" + Number(tok.priceUsd).toPrecision(4))}</dd></div>
          </dl>

          {burnOutcome ? (
            <OutcomeCard o={burnOutcome} onDismiss={dismissOutcome} onRetry={retryFromOutcome} onCheckStatus={recheckPending} />
          ) : burning ? (
            <Loading label={t("Approve the burn in your wallet…")} />
          ) : tok.walletBalance != null && balance <= 0 ? (
            /* One whole sentence per translation unit, with the symbol shown beside it rather
               than a fragment glued on — a leading "— connect the wallet…" cannot be translated
               into a language whose clause order is not English's (pane.jsx's STRING RULE). */
            <Empty>{t("This wallet holds none of this token — connect the wallet that holds the tokens you want to burn.")} ({tok.symbol})</Empty>
          ) : (
            <>
              <label className="seeker-listing-label" htmlFor="pb-amount">{t("Amount to burn")}</label>
              <input
                id="pb-amount"
                className="seeker-listing-input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); if (confirmPhase !== "idle") setConfirmPhase("idle"); }}
                placeholder="0"
              />
              <div className="seeker-burn-pctrow">
                <button type="button" className="seeker-btn seeker-btn-quiet" disabled={balance == null} onClick={() => setPct(25)}>25%</button>
                <button type="button" className="seeker-btn seeker-btn-quiet" disabled={balance == null} onClick={() => setPct(50)}>50%</button>
                <button type="button" className="seeker-btn seeker-btn-quiet" disabled={balance == null} onClick={() => setPct(100)}>{t("Max")}</button>
              </div>
              {amtNum > 0 ? (
                <p className={"seeker-burn-live" + (overBalance ? " seeker-burn-live-err" : "")}>
                  {overBalance
                    ? <>{t("You only hold")} {fmtNum(balance)} {tok.symbol} — {t("reduce the amount.")}</>
                    : <>{t("Burning")} {fmtNum(amtNum)} {tok.symbol}{usdValue != null ? <> · ≈ {fmtUsd(usdValue)}</> : <> · {t("value unknown")}</>}{pctSupply != null ? <> · {fmtPctSupply(pctSupply)} {t("of supply")}</> : null}</>}
                </p>
              ) : null}
              {confirmPhase === "checking" ? <Loading label={t("Re-checking your balance on-chain before you sign…")} /> : null}
              {confirmPhase === "stale" ? (
                <p className="seeker-tool-note seeker-passgate-err" role="alert">{t("Your balance changed since this page loaded — reduce the amount or reload, then try again.")}</p>
              ) : null}
              {confirmPhase === "error" ? (
                <p className="seeker-tool-note seeker-passgate-err" role="alert">{t("Could not re-check your balance on-chain. Try again.")}</p>
              ) : null}
              <button type="button" className="seeker-btn seeker-btn-danger seeker-burn-actionbtn" disabled={!canBurn} onClick={openConfirm}>{t("Burn")}</button>
            </>
          )}
        </div>
      ) : null}

      <Confirm
        open={confirmPhase === "ready"}
        title="Confirm burn"
        lines={confirmLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />
    </Pane>
  );
}
