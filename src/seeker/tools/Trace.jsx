// Cluck Norris — Seeker app, Trace pane (docs/SEEKER_TOOLS_BUILD.md — registry id "trace").
//
// PASS-GATED (the unified tools pass, §5 of the build doc). Pages preview free — the explainer,
// both fields and the empty state render to anyone; only RUN needs the pass. Rebuilt from
// public/trace.html's behaviour, never its markup — a wallet × one token transaction history.
//
// Server: GET /api/trace?wallet=<address>&mint=<mint>  (server.js ~15837)
//   200 { success:true, wallet, mint, decimals, truncated,
//         transactions:[], summary:null, error:"Could not resolve a token account…" }  — soft-empty:
//         this wallet never held this mint, so there is nothing to trace. Still success:true.
//   200 { success:true, wallet, mint, decimals, truncated, generatedAt,
//         summary: { txCount, currentBalance, buyCount, sellCount, receiveCount, sendCount,
//                     sentToCount, receivedFromCount, addLpCount, withdrawLpCount,
//                     totalBought, totalSpent, totalSold, totalProceeds, totalReceived, totalSent,
//                     totalAddedLp, totalWithdrawnLp, lpSolIn, lpSolOut, netInLpToken, netInLpSol,
//                     lpPools, uniqueCounterparties, firstInteraction, lastInteraction,
//                     origin:{action,counterparty,counterpartyType,counterpartyLabel,source,timestamp,amount},
//                     lockCount, unlockCount, lockedTokensTotal },
//         counterparties:[{type,label,address,inflow,outflow,txCount,sigs}],
//         transactions:[{ signature, timestamp, action, tokenDelta, quoteDelta, quoteSymbol,
//                          counterparty, counterpartyType, counterpartyLabel, source, balanceAfter,
//                          isLockerCounterparty? }],
//         bagsContext: { isBagsToken, walletIsBagsCreator, walletCreatorMeta, tokenSymbol } | null }
//   402/403 — pass_required / insufficient_holdings / bad_pass / pass_expired (toolPassGate)
//   400 { success:false, error }  — bad wallet or mint address
//   500 { success:false, error }
//
// "Say what's on-chain, never why": every row is a flow of tokens between two addresses, on a
// date, with a running balance — never a verdict about intent. `walletIsBagsCreator` is the ONE
// place this pane calls a wallet "creator" — a Bags (launchpad) API confirmation, exactly the
// recorded rule in CLAUDE.md ("only call a wallet creator or team when a launchpad API confirms
// it"). Nothing else here ever uses that word.
import React from "react";
import { t, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, useOnline } from "../pane.jsx";
import { usePass } from "../pass.js";
import { PassGate, gatedToolFetch } from "../passgate.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
function fmtNum(n) {
  n = Number(n) || 0;
  const sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return sign + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return sign + (n / 1e3).toFixed(2) + "K";
  return sign + n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
function fmtTs(ts) {
  if (!ts) return "";
  try { return new Date(ts * 1000).toLocaleString(); } catch (_) { return ""; }
}
function safeHref(u) { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : null; }
function solscanAcct(addr) { return safeHref(`https://solscan.io/account/${encodeURIComponent(addr)}`); }

// The tools-pass gate lives in ONE file — src/seeker/passgate.jsx. It used to be a 79-line
// copy in each of the three pass-gated panes, differing by a single string; see that file's
// header for why it was extracted before it drifted rather than after.

const ACTION_LABEL = {
  buy: "Buy", sell: "Sell", send: "Sent", receive: "Received",
  add_lp: "Added liquidity", withdraw_lp: "Removed liquidity", lock: "Locked", unlock: "Unlocked",
};

function CounterpartyRow({ c }) {
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>{c.label || (c.address ? shortAddr(c.address) : t("Market"))}</span></div>
        <div className="seeker-forensic-row-sub">{fmtInt(c.txCount)} {t("transactions")} · {c.type === "contract" ? t("contract") : c.type === "market" ? t("DEX venue") : t("wallet")}</div>
      </div>
      <div className="seeker-forensic-row-value">
        {c.inflow > 0 ? <>+{fmtNum(c.inflow)}<br /></> : null}
        {c.outflow > 0 ? <>-{fmtNum(c.outflow)}</> : null}
      </div>
    </div>
  );
}

function TxRow({ r }) {
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>{t(ACTION_LABEL[r.action] || r.action)}</span></div>
        <div className="seeker-forensic-row-sub">
          {fmtTs(r.timestamp)}{r.counterpartyLabel ? ` · ${r.counterpartyLabel}` : r.counterparty ? ` · ${shortAddr(r.counterparty)}` : ""}
        </div>
      </div>
      <div className="seeker-forensic-row-value">
        {r.tokenDelta > 0 ? "+" : ""}{fmtNum(r.tokenDelta)}
        {r.quoteDelta != null ? <><br /><span style={{ fontSize: 11 }}>{r.quoteDelta > 0 ? "+" : ""}{fmtNum(r.quoteDelta)} {r.quoteSymbol}</span></> : null}
      </div>
    </div>
  );
}

export default function TracePane({ wallet }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const pass = usePass();
  const [walletInput, setWalletInput] = React.useState("");
  const [mintInput, setMintInput] = React.useState("");
  const [formError, setFormError] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | loading | result | unavailable | refused
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [data, setData] = React.useState(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [txShown, setTxShown] = React.useState(20);
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function doScan(w, m) {
    if (!online) { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
    setPhase("loading");
    setTxShown(20);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/trace?wallet=${encodeURIComponent(w)}&mint=${encodeURIComponent(m)}`;
    gatedToolFetch(pass.gatedFetch, url).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        if (pass.isDenial(res.body)) { pass.refresh(); setGateOpen(true); setPhase("form"); return; }
        if (res.kind === "offline") { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
        if (res.kind === "refused") { setPhase("refused"); setErrMsg((res.body && res.body.error) || t("That wallet or mint wasn't something we could use.")); return; }
        setPhase("unavailable"); setErrKind("unavailable");
        setErrMsg(t("Could not read that history from the chain right now. Try again shortly."));
        return;
      }
      setData(res.data);
      setPhase("result");
    });
  }

  function run() {
    const w = walletInput.trim(), m = mintInput.trim();
    if (!ADDR_RE.test(w)) { setFormError(t("Enter a valid Solana wallet address.")); return; }
    if (!ADDR_RE.test(m)) { setFormError(t("Enter a valid Solana token mint address.")); return; }
    setFormError(null);
    // "unsignable" — no wallet on this device can produce a signature, so a pass can never
    // be obtained here. The plain explanation is already rendered under the form; running
    // the tool anyway would just draw a real 402 from the server, so do nothing rather than
    // fire a call that cannot succeed.
    if (pass.status === "unsignable") return;
    if (pass.status === "needed") { setGateOpen(true); return; }
    doScan(w, m);
  }

  function onUnlocked() { setGateOpen(false); pass.refresh(); doScan(walletInput.trim(), mintInput.trim()); }

  const runDisabled = phase === "loading" || pass.status === "loading";
  const s = data && data.summary;
  const noHistory = data && !s && (!data.transactions || data.transactions.length === 0);
  const txDesc = data && data.transactions ? [...data.transactions].reverse() : [];

  return (
    <Pane icon="🧭" title="Trace">
      <p className="seeker-tool-lede">{t("Follow every interaction between one wallet and one token — buys, sells, transfers and lock/unlock moves, in order, with the running balance.")}</p>

      <div className="seeker-forensic-form">
        {wallet.connected ? (
          <div className="seeker-forensic-userow">
            <button type="button" className="seeker-forensic-uselink" onClick={() => setWalletInput(wallet.address)}>{t("Use my connected wallet")}</button>
          </div>
        ) : null}
        <label className="seeker-listing-label" htmlFor="trace-wallet">{t("Wallet address")}</label>
        <input
          id="trace-wallet"
          className="seeker-listing-input"
          value={walletInput}
          onChange={(e) => setWalletInput(e.target.value)}
          placeholder={t("Paste a wallet address")}
          autoComplete="off"
          spellCheck="false"
        />
        <label className="seeker-listing-label" htmlFor="trace-mint">{t("Token mint address")}</label>
        <input
          id="trace-mint"
          className="seeker-listing-input"
          value={mintInput}
          onChange={(e) => setMintInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder={t("Paste a token's mint address")}
          autoComplete="off"
          spellCheck="false"
        />
        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={run} disabled={runDisabled}>
          {phase === "loading" ? t("Tracing…") : t("Run Trace")}
        </button>
        {pass.status === "unsignable" ? (
          <div className="seeker-tool-notyet" role="status">
            <p className="seeker-tool-notyet-title">🔒 {t("No wallet on this device can sign")}</p>
            <p>{t("The tools pass needs a signature, and this device has no wallet that can produce one yet. This resolves itself once wallet support lands in the app — nothing you can do here unlocks it early.")}</p>
          </div>
        ) : null}
      </div>

      {phase === "loading" ? <Loading label={t("Walking every signature that touched this wallet's token account…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={() => doScan(walletInput.trim(), mintInput.trim())} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && noHistory ? (
        <Empty>{t("This wallet has no token account for this mint on-chain — nothing to trace.")}</Empty>
      ) : null}
      {phase === "result" && s && s.txCount === 0 ? (
        <Empty>{t("A token account exists but no interaction was found for this wallet and this mint.")}</Empty>
      ) : null}

      {phase === "result" && s && s.txCount > 0 ? (
        <>
          {data.truncated ? <p className="seeker-tool-note seeker-forensic-truncnote">{t("This wallet has more signatures than the scan reached — figures reflect what was scanned.")}</p> : null}

          {data.bagsContext && data.bagsContext.walletIsBagsCreator ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Bags-verified creator")}</strong>
              <p style={{ margin: "6px 0 0" }}>{t("This wallet is a Bags-confirmed creator of this token.")}{data.bagsContext.tokenSymbol ? " (" + data.bagsContext.tokenSymbol + ")" : ""}</p>
            </div>
          ) : null}

          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Current balance")}</div><div className="seeker-forensic-stat-value">{fmtNum(s.currentBalance)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Buys / sells")}</div><div className="seeker-forensic-stat-value">{fmtInt(s.buyCount)} / {fmtInt(s.sellCount)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Sent / received")}</div><div className="seeker-forensic-stat-value">{fmtInt(s.sendCount)} / {fmtInt(s.receiveCount)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Unique counterparties")}</div><div className="seeker-forensic-stat-value">{fmtInt(s.uniqueCounterparties)}</div></div>
          </div>

          {s.origin ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("First time this wallet held the token")}</strong>
              <p style={{ margin: "6px 0 0" }}>
                {t(ACTION_LABEL[s.origin.action] || s.origin.action)} {fmtNum(s.origin.amount)} · {fmtTs(s.origin.timestamp)}
                {s.origin.counterpartyLabel ? ` · ${s.origin.counterpartyLabel}` : s.origin.counterparty ? ` · ${shortAddr(s.origin.counterparty)}` : ""}
              </p>
            </div>
          ) : null}

          {(s.lockCount > 0 || s.unlockCount > 0) ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Lock activity")}</strong>
              <p style={{ margin: "6px 0 0" }}>{fmtInt(s.lockCount)} {t("lock deposits")}, {fmtInt(s.unlockCount)} {t("unlocks")}{s.lockedTokensTotal ? <> — {fmtNum(s.lockedTokensTotal)} {t("locked in total")}</> : null}</p>
            </div>
          ) : null}

          {data.counterparties && data.counterparties.length ? (
            <div className="seeker-listing-card">
              <h2 className="seeker-listing-card-title">{t("Top counterparties")}</h2>
              <div className="seeker-forensic-rows">{data.counterparties.slice(0, 20).map((c, i) => <CounterpartyRow key={i} c={c} />)}</div>
            </div>
          ) : null}

          {txDesc.length ? (
            <div className="seeker-listing-card">
              <h2 className="seeker-listing-card-title">{t("Transaction history")}</h2>
              <div className="seeker-forensic-rows">{txDesc.slice(0, txShown).map((r) => <TxRow key={r.signature} r={r} />)}</div>
              {txDesc.length > txShown ? (
                <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => setTxShown((n) => n + 20)}>
                  {t("Show more")} ({txShown} {t("of")} {txDesc.length})
                </button>
              ) : null}
            </div>
          ) : null}

          {solscanAcct(data.wallet) ? (
            <p style={{ textAlign: "center" }}>
              <a className="seeker-forensic-link" href={solscanAcct(data.wallet)} target="_blank" rel="noopener noreferrer">{t("View wallet on Solscan")} ↗</a>
            </p>
          ) : null}
        </>
      ) : null}

      {gateOpen ? (
        <PassGate pass={pass} wallet={wallet} tool="trace" onUnlocked={onUnlocked} onClose={() => setGateOpen(false)} />
      ) : null}
    </Pane>
  );
}
