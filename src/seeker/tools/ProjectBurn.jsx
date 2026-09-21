// Cluck Norris — Seeker app, Project Burn pane (docs/SEEKER_TOOLS_BUILD.md — registry id "burn").
//
// ⛔ SCOPE LINE (owner-set, tonight's build): READ SIDE + CLASSIFICATION + THE FULL CONFIRM UX
// ONLY. No transaction is built, no signature is requested, nothing is sent — see the identical
// header note in Firepit.jsx for why: the send/confirm seam that both burn tools need is being
// extracted into one hardened, reviewed helper in a parallel fix round (an adversarial review
// found the same landed-but-failed status bug already live in public/airdrop-engine.js from a
// copy-paste of this exact send/confirm logic). Tapping "Confirm and sign" here renders the
// SigningNotYet block instead of touching a wallet's signTransaction.
//
// Server (server.js, both read-only until the receipt call, which this pane never reaches):
//   GET  /api/burn-token-info?mint=<mint>&wallet=<address>
//     200 { success:true, mint, symbol, name, decimals, program, supplyRaw, supply, priceUsd,
//           walletBalanceRaw, walletBalance, tokenAccount }
//     400 { success:false, error }  — bad mint/wallet, or not a fungible token
//     404 { success:false, error }  — mint not found on-chain
//     500 { success:false, error }  — server/RPC trouble
//   POST /api/burn-receipt { sig, mint, wallet } — verifies a REAL burn on-chain before minting a
//     receipt. This pane never calls it: there is no real signature to verify yet (scope line
//     above). That is why the confirm sheet stops at SigningNotYet rather than a receipt screen.
//
// `supply` and `priceUsd` can each be null (best-effort reads) — reported as UNKNOWN, never as
// zero or omitted, so the confirm sheet never implies "0% of supply" or "$0 destroyed" when the
// true figure just couldn't be read (CLAUDE.md: a failed read is never a lie about the numbers).
// "Say what's on-chain, never why": this pane reports supply, balance and price as facts and
// never labels the token or the burn safe, verified, or a good idea.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, NeedsWallet, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
// A decimal-string amount → raw integer string, BigInt-safe (no float rounding). Only used to
// decide over-balance / too-small, never sent anywhere in this build.
function scaleToRaw(s, decimals) {
  s = String(s || "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return "0";
  const parts = s.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
  return (whole + frac).replace(/^0+/, "") || "0";
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
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function loadToken() {
    const mint = mintInput.trim();
    if (!MINT_RE.test(mint)) { setFormError(t("Enter a valid Solana mint address.")); return; }
    setFormError(null);
    setNotice(null);
    setAmount("");
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
  const canBurn = tok && amtNum > 0 && !overBalance && !tooSmall;

  function setPct(p) {
    if (!tok || balance == null) return;
    if (p === 100) setAmount(String(balance));
    else setAmount(String(+(balance * p / 100).toFixed(tok.decimals)));
  }

  const usdValue = tok && tok.priceUsd != null ? amtNum * tok.priceUsd : null;
  const pctSupply = tok && tok.supply ? (amtNum / tok.supply) * 100 : null;
  const isFullBalance = balance != null && amtNum >= balance - 1e-12 && amtNum > 0;

  function openConfirm() { if (canBurn) setConfirmOpen(true); }
  function cancelConfirm() { setConfirmOpen(false); }
  function onConfirmed() {
    // ⛔ NO SIGNING TONIGHT. See the file header — this is the deliberate stop, not a bug.
    setConfirmOpen(false);
    setNotice({ amount: amtNum, symbol: tok.symbol, usdValue, pctSupply, isFullBalance });
  }

  const confirmLines = tok ? [
    <span key="a">{t("Burning")}: <strong>{fmtNum(amtNum)} {tok.symbol}</strong>{isFullBalance ? <> · {t("your entire balance")}</> : null}</span>,
    <span key="p">{pctSupply != null ? <>{fmtPctSupply(pctSupply)} {t("of the total token supply")}</> : t("Total supply is unknown — we can't say what share of supply this is.")}</span>,
    <span key="v">{usdValue != null ? <>{t("Value being destroyed")}: <strong className="seeker-firepit-destroyval">{fmtUsd(usdValue)}</strong></> : t("This token has no live price — the dollar value being destroyed is unknown, not zero.")}</span>,
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
          onKeyDown={(e) => { if (e.key === "Enter") loadToken(); }}
          placeholder={t("Paste your token's mint address")}
          autoComplete="off"
          spellCheck="false"
        />
        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={loadToken} disabled={phase === "loading"}>
          {phase === "loading" ? t("Reading…") : t("Load token")}
        </button>
      </div>

      {phase === "loading" ? <Loading label={t("Reading the token from the chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={loadToken} /> : null}
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

          {tok.walletBalance != null && balance <= 0 ? (
            <Empty>{t("This wallet holds 0")} {tok.symbol}{t(" — connect the wallet that holds the tokens you want to burn.")}</Empty>
          ) : (
            <>
              <label className="seeker-listing-label" htmlFor="pb-amount">{t("Amount to burn")}</label>
              <input
                id="pb-amount"
                className="seeker-listing-input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
              <button type="button" className="seeker-btn seeker-btn-danger seeker-burn-actionbtn" disabled={!canBurn} onClick={openConfirm}>{t("Burn")}</button>
            </>
          )}
        </div>
      ) : null}

      <Confirm
        open={confirmOpen}
        title="Confirm burn"
        lines={confirmLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />

      {notice ? (
        <div className="seeker-tool-notyet" role="status">
          <p className="seeker-tool-notyet-title">🚧 {t("Signing lands in the next build")}</p>
          <p>{t("Nothing was sent or signed. This build ships the token read, the confirm step and the receipt verification server-side; the actual burn transaction ships in a follow-up build on a hardened, shared send-and-confirm helper.")}</p>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => setNotice(null)}>{t("OK")}</button>
        </div>
      ) : null}
    </Pane>
  );
}
