// Cluck Norris — Seeker app, Wallet X-Ray pane (docs/SEEKER_TOOLS_BUILD.md — registry id "xray").
//
// PASS-GATED (the unified tools pass, §5 of the build doc). Pages preview free — the explainer,
// the address field and the empty state render to anyone; only RUN needs the pass. Rebuilt from
// public/wallet-xray.html's behaviour, never its markup (the hackathon's own scoring rule).
//
// Server: GET /api/wallet-xray?wallet=<address>&deep=0|1  (server.js ~16318)
//   200 { success:true, wallet, generatedAt, truncated, mode,
//         empty?:true,                                    // no readable history at all
//         balances:{ solBalance, solUsd, solUsdValue, tokenCount, portfolioUsd },
//         funding: { ts, amountSol, from, label, sig, kind, exact, reachedGenesis, dustFirst } | null,
//         activity:{ buyCount, sellCount, swapCount, tokenSendCount, tokenRecvCount, distinctTokens,
//                    txPerDay, lpAdd, lpRemove, nftCount, sellBuyRatio },
//         cadence:{ medianGapSec, fastGapFrac, maxPerMinute },
//         flips:{ medianHoldSec, fastFlipCount, flipFrac, recvThenSold },
//         cex:[{ name, in, out, count, net }], topSources:[{source,count}],
//         topTokens:[{ mint, symbol, name, held, heldUsd, bought, sold, recv, sent, classification }],
//         labels:[{ tag, icon, level:"info"|"med"|"high", evidence }], verdict,
//         dd: { riskScore, riskLevel, flags, poisoningDetected, source:"dd.xyz" } | null,
//         charts:{...} (not rendered here — a phone reads the numbers, not the chart),
//         transactions:[{ signature, ts, action, solDelta, quoteUsd, tokens, counterparty,
//                          counterpartyLabel, fee, description, usd }], txReturned, txTotal,
//         disclaimer }
//   402 { success:false, error:"pass_required", detail }        — needs the pass (toolPassGate)
//   403 { success:false, error:"insufficient_holdings"|"bad_pass"|"pass_expired", detail, balance?, needed? }
//   400 { success:false, error }  — bad wallet address
//   500 { success:false, error }  — server/RPC trouble
//
// "Say what's on-chain, never why" (CLAUDE.md): every label below is the SERVER's own evidence
// string, already the wording the desktop tool ships; this pane renders it as a fact with its
// evidence sentence, never invents a verdict of its own. `verdict` and `disclaimer` are likewise
// rendered verbatim from the server — the server explicitly frames them as "on-chain behavioral
// patterns, not statements of intent". Nothing here calls a wallet "creator" or "team" — X-Ray
// has no launchpad cross-check, unlike Trace's Bags-verified creator flag.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, useOnline } from "../pane.jsx";
import { usePass } from "../pass.js";
import { PassGate, gatedToolFetch } from "../passgate.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
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
function fmtDur(s) {
  s = Number(s) || 0;
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}
function fmtTs(ts) {
  if (!ts) return "";
  try { return new Date(ts * 1000).toLocaleString(); } catch (_) { return ""; }
}
// Only render an href we built ourselves from a validated address — chain data is
// attacker-controlled and React's text escaping does not neutralise an href (CLAUDE.md).
function safeHref(u) { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : null; }
function solscanAcct(addr) { return safeHref(`https://solscan.io/account/${encodeURIComponent(addr)}`); }

// The tools-pass gate lives in ONE file — src/seeker/passgate.jsx. It used to be a 79-line
// copy in each of the three pass-gated panes, differing by a single string; see that file's
// header for why it was extracted before it drifted rather than after.

const LABEL_LEVEL_CLASS = { high: " seeker-forensic-label-high", med: " seeker-forensic-label-med", info: "" };

function LabelRow({ l }) {
  return (
    <div className={"seeker-forensic-label" + (LABEL_LEVEL_CLASS[l.level] || "")}>
      <span className="seeker-forensic-label-icon" aria-hidden="true">{l.icon || "•"}</span>
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-label-tag">{l.tag}</div>
        <div className="seeker-forensic-label-evidence">{l.evidence}</div>
      </div>
    </div>
  );
}

function TokenRow({ tk }) {
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top">
          <span>{tk.symbol || t("Unknown token")}</span>
        </div>
        <div className="seeker-forensic-row-sub">{shortAddr(tk.mint)}</div>
        <span className="seeker-forensic-row-tag">{tk.classification}</span>
      </div>
      <div className="seeker-forensic-row-value">
        {tk.held > 0 ? <>{fmtNum(tk.held)}{tk.heldUsd > 0 ? <><br />{fmtUsd(tk.heldUsd)}</> : null}</> : t("not held")}
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
          {fmtTs(r.ts)}{r.counterpartyLabel ? ` · ${r.counterpartyLabel}` : r.counterparty ? ` · ${shortAddr(r.counterparty)}` : ""}
        </div>
      </div>
      <div className="seeker-forensic-row-value">
        {r.usd ? fmtUsd(r.usd) : r.solDelta ? `${r.solDelta > 0 ? "+" : ""}${r.solDelta} SOL` : ""}
      </div>
    </div>
  );
}
const ACTION_LABEL = {
  buy: "Buy", sell: "Sell", swap: "Swap", send: "Sent", receive: "Received",
  sol_in: "SOL in", sol_out: "SOL out", lp_add: "Added liquidity", lp_remove: "Removed liquidity",
  other: "Other",
};

export default function WalletXrayPane({ wallet }) {
  const online = useOnline();
  const pass = usePass();
  const [input, setInput] = React.useState("");
  const [deep, setDeep] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | loading | result | unavailable | refused | unsignable
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [data, setData] = React.useState(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [txShown, setTxShown] = React.useState(20);
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function doScan(addr) {
    if (!online) { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
    setPhase("loading");
    setTxShown(20);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/wallet-xray?wallet=${encodeURIComponent(addr)}${deep ? "&deep=1" : ""}`;
    gatedToolFetch(pass.gatedFetch, url).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        if (pass.isDenial(res.body)) { pass.refresh(); setGateOpen(true); setPhase("form"); return; }
        if (res.kind === "offline") { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
        if (res.kind === "refused") { setPhase("refused"); setErrMsg((res.body && res.body.error) || t("That address wasn't something we could use.")); return; }
        setPhase("unavailable"); setErrKind("unavailable");
        setErrMsg(t("Could not read that wallet from the chain right now. Try again shortly."));
        return;
      }
      setData(res.data);
      setPhase("result");
    });
  }

  function run() {
    const addr = input.trim();
    if (!ADDR_RE.test(addr)) { setFormError(t("Enter a valid Solana wallet address.")); return; }
    setFormError(null);
    // "unsignable" — no wallet on this device can produce a signature, so a pass can never
    // be obtained here. The plain explanation is already rendered under the form; running
    // the tool anyway would just draw a real 402 from the server, so do nothing rather than
    // fire a call that cannot succeed.
    if (pass.status === "unsignable") return;
    if (pass.status === "needed") { setGateOpen(true); return; }
    doScan(addr);
  }

  function onUnlocked() { setGateOpen(false); pass.refresh(); doScan(input.trim()); }

  const runDisabled = phase === "loading" || pass.status === "loading";

  return (
    <Pane icon="🔎" title="Wallet X-Ray">
      <p className="seeker-tool-lede">{t("Paste any Solana wallet to see its funding origin and the activity we can find. This is an activity scan, not a balance sheet: it can miss holdings, and it reports what happened, never why.")}</p>

      <div className="seeker-forensic-form">
        {wallet.connected ? (
          <div className="seeker-forensic-userow">
            <button type="button" className="seeker-forensic-uselink" onClick={() => setInput(wallet.address)}>{t("Use my connected wallet")}</button>
          </div>
        ) : null}
        <label className="seeker-listing-label" htmlFor="xray-addr">{t("Wallet address")}</label>
        <input
          id="xray-addr"
          className="seeker-listing-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder={t("Paste a wallet address")}
          autoComplete="off"
          spellCheck="false"
        />
        <label className="seeker-forensic-deeprow">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
          {t("Look deeper — more history, slower scan")}
        </label>
        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={run} disabled={runDisabled}>
          {phase === "loading" ? t("Scanning…") : t("Run X-Ray")}
        </button>
        {pass.status === "unsignable" ? (
          <div className="seeker-tool-notyet" role="status">
            <p className="seeker-tool-notyet-title">🔒 {t("No wallet on this device can sign")}</p>
            <p>{t("The tools pass needs a signature, and this device has no wallet that can produce one yet. This resolves itself once wallet support lands in the app — nothing you can do here unlocks it early.")}</p>
          </div>
        ) : null}
      </div>

      {phase === "loading" ? <Loading label={t(deep ? "Digging through a deep history — this can take a couple of minutes…" : "Scanning the chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={() => doScan(input.trim())} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && data && data.empty ? (
        <Empty>{t("No readable on-chain history for this wallet — brand new, dormant, or holdings only with no transactions.")}</Empty>
      ) : null}

      {phase === "result" && data && !data.empty ? (
        <>
          {data.truncated ? <p className="seeker-tool-note seeker-forensic-truncnote">{t("This wallet has more history than the scan reached — figures reflect what was scanned, not its whole lifetime.")}</p> : null}

          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("SOL balance")}</div><div className="seeker-forensic-stat-value">{data.balances.solBalance.toFixed(3)} SOL{data.balances.solUsdValue ? <><br />{fmtUsd(data.balances.solUsdValue)}</> : null}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Token portfolio")}</div><div className="seeker-forensic-stat-value">{data.balances.tokenCount} {t("tokens")}{data.balances.portfolioUsd ? <><br />{fmtUsd(data.balances.portfolioUsd)}</> : null}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Buys / sells")}</div><div className="seeker-forensic-stat-value">{fmtInt(data.activity.buyCount)} / {fmtInt(data.activity.sellCount)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Distinct tokens traded")}</div><div className="seeker-forensic-stat-value">{fmtInt(data.activity.distinctTokens)}</div></div>
          </div>

          {data.funding ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Funding origin")}</strong>
              <p style={{ margin: "6px 0 0" }}>
                {data.funding.kind === "SOL" && data.funding.amountSol
                  ? <>{t("First funded with ~")}{Number(data.funding.amountSol).toFixed(2)} SOL {data.funding.label ? t("from") + " " + data.funding.label : t("from another wallet")}</>
                  : <>{t("First funding")} {data.funding.label ? t("from") + " " + data.funding.label : t("from another wallet")}</>}
                {data.funding.from && !data.funding.label ? <> ({shortAddr(data.funding.from)})</> : null}
                {data.funding.reachedGenesis === false ? <> — {t("oldest reached, couldn't page fully to genesis")}</> : null}
              </p>
            </div>
          ) : null}

          <div className="seeker-forensic-verdict">{data.verdict}</div>

          {data.labels && data.labels.length ? (
            <div className="seeker-forensic-labels">{data.labels.map((l, i) => <LabelRow key={i} l={l} />)}</div>
          ) : null}

          {data.dd && data.dd.riskLevel ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Third-party risk check (DD.xyz)")}</strong>
              <p style={{ margin: "6px 0 0" }}>{t("Risk level")}: {data.dd.riskLevel}{data.dd.flags && data.dd.flags.length ? " — " + data.dd.flags.join(", ") : ""}</p>
              {data.dd.poisoningDetected ? <p style={{ margin: "4px 0 0" }}>{t("Address-poisoning activity was flagged touching this wallet — double-check any address copied from its history before sending.")}</p> : null}
            </div>
          ) : null}

          {data.cex && data.cex.length ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Exchange flows")}</strong>
              <div className="seeker-forensic-rows" style={{ marginTop: 8 }}>
                {data.cex.map((c, i) => (
                  <div className="seeker-forensic-row" key={i}>
                    <div className="seeker-forensic-row-main">{c.name}</div>
                    <div className="seeker-forensic-row-value">{fmtInt(c.in)} {t("in")} / {fmtInt(c.out)} {t("out")}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {data.topTokens && data.topTokens.length ? (
            <div className="seeker-listing-card">
              <h2 className="seeker-listing-card-title">{t("Most-active tokens")}</h2>
              <div className="seeker-forensic-rows">{data.topTokens.slice(0, 15).map((tk, i) => <TokenRow key={i} tk={tk} />)}</div>
            </div>
          ) : null}

          {data.transactions && data.transactions.length ? (
            <div className="seeker-listing-card">
              <h2 className="seeker-listing-card-title">{t("Recent activity")}</h2>
              <div className="seeker-forensic-rows">{data.transactions.slice(0, txShown).map((r) => <TxRow key={r.signature} r={r} />)}</div>
              {data.txTotal > txShown ? (
                <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => setTxShown((n) => n + 20)}>
                  {t("Show more")} ({txShown} {t("of")} {data.txTotal})
                </button>
              ) : null}
            </div>
          ) : null}

          {solscanAcct(data.wallet) ? (
            <p style={{ textAlign: "center" }}>
              <a className="seeker-forensic-link" href={solscanAcct(data.wallet)} target="_blank" rel="noopener noreferrer">{t("View on Solscan")} ↗</a>
            </p>
          ) : null}

          <p className="seeker-forensic-disclaimer">{data.disclaimer}</p>
        </>
      ) : null}

      {gateOpen ? (
        <PassGate pass={pass} wallet={wallet} tool="xray" onUnlocked={onUnlocked} onClose={() => setGateOpen(false)} />
      ) : null}
    </Pane>
  );
}
