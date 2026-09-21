// Cluck Norris — Seeker app, Airdropper pane (docs/SEEKER_TOOLS_BUILD.md — registry id "airdrop").
//
// PASS-GATED, WALLET-SIGNED, AND THE ONE PANE IN THIS APP THAT MOVES SOMEONE ELSE'S MONEY OUT OF
// THE USER'S WALLET IN BULK. Everything unusual below is because of that sentence.
//
// ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────────────────────
// It does not implement batching, transaction building, instruction encoding, or confirmation.
// All of that is public/airdrop-engine.js (window.CluckAirdrop) — the platform's ONE audited
// batch-transfer path, shared by /airdrop, Buy Special, the CUNA payout desk and the Hub desk.
// CLAUDE.md's rule is explicit that re-typing a shared browser module into a page is how private
// copies drift into real bugs, and this is the module where that would cost the most. The engine
// is now shipped in the Seeker bundle (seeker.html, store-edition/seeker-edition.json) and driven
// through its own documented API: CluckAirdrop.send({ rpc, provider, walletPubkey, mint, decimals,
// native, recipients, memo, onProgress, onResult, shouldContinue }) → { sent, failed, unconfirmed }.
//
// It also does not encode a single instruction here. AGENTS.md forbids calling
// SystemProgram.transfer() or any web3.js layout encoder in a browser page — they encode u64
// through toBufferLE(), which needs the Node Buffer global browsers don't have and we ship no
// polyfill; that silently killed three money paths at once. The engine's splToken shim exists
// precisely so no page has to.
//
// The PLANNING half — turning a pasted list into recipients, and recipients into a cost — is
// public/airdrop-plan.js, pure and dependency-free so a .cjs test can pin it with fixtures
// (scripts/seeker-airdrop-test.cjs). Its header documents two real bugs in the desktop parser
// that it deliberately does not reproduce: silently coerced ambiguous number formats, and
// duplicate addresses summed in floats and never mentioned.
//
// ── THE THREE-STATE RULE ─────────────────────────────────────────────────────────────────────
// A batch has THREE outcomes and this pane never collapses them, because each collapse is a
// specific lie to the operator:
//   sent        — confirmed on-chain.
//   failed      — landed and failed, or never went: nobody in that batch was paid. Retry it.
//   unconfirmed — submitted, no status after 30s. It may still land. Reporting it as "sent"
//                 makes unpaid people look paid; reporting it as "failed" invites a resend that
//                 DOUBLE-PAYS. It is its own state, with its signature, and the instruction is
//                 to check the signature before resending.
// The engine already distinguishes all three (its own comment records the day it didn't). This
// pane's job is to keep them distinct all the way to the screen.
//
// ── SERVER ───────────────────────────────────────────────────────────────────────────────────
//   POST /api/airdrop/record  (toolPassGate)  { dropId?, mint, decimals, createdAt, rows:[{wallet, amount, sig}] }
//     200 { success:true, dropId, url:"/airdrop/r/<id>", recorded, totals }
//     400 { success:false, error }   — bad rows / too many rows
//     402/403 { success:false, error:"pass_required"|"insufficient_holdings"|… , detail }
//   The receipt is the verifiable half: a stranger can read /airdrop/r/<id> and the server
//   re-reads each signature on-chain. Recording NEVER blocks or fails the send — the tokens have
//   already landed by then, and a receipt hiccup that looked like a failed airdrop would be its
//   own lie. A failed record is reported as exactly what it is: the rows sent, the receipt short.
//
// "Say what's on-chain, never why" applies to the token too: this pane shows the mint's decimals
// and the sender's balance as the chain reports them and makes no claim about the token itself.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Unavailable, Confirm, NeedsWallet, useOnline } from "../pane.jsx";
import { usePass } from "../pass.js";
import { PassGate } from "../passgate.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_RECIPIENTS = 2000;     // a phone paste, not a spreadsheet job — see the note at parse()
const RECORD_CHUNK = 100;        // the server's own per-call row cap is higher; this keeps posts small

function plan() { try { return (typeof window !== "undefined" && window.CluckAirdropPlan) || null; } catch (_) { return null; } }
function engine() { try { return (typeof window !== "undefined" && window.CluckAirdrop) || null; } catch (_) { return null; } }
function util() { try { return (typeof window !== "undefined" && window.CluckUtil) || null; } catch (_) { return null; } }

function rpc(method, params) {
  const u = util();
  if (!u || typeof u.rpc !== "function") return Promise.reject(new Error("rpc unavailable"));
  return u.rpc(method, params);
}

function fmtSol(lamports) {
  const n = (Number(lamports) || 0) / 1e9;
  if (n === 0) return "0 SOL";
  if (n < 0.000001) return "<0.000001 SOL";
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") + " SOL";
}
// Only ever an href we built ourselves from a validated value — chain data and user input are
// both attacker-controlled, and React's text escaping does not neutralise an href (CLAUDE.md).
function solscanTx(sig) { return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null; }

const STATUS_LABEL = { sent: "Sent", failed: "Failed", unconfirmed: "Unconfirmed" };
const STATUS_CLASS = { sent: " seeker-drop-row-sent", failed: " seeker-drop-row-failed", unconfirmed: " seeker-drop-row-unconfirmed" };

function ResultRow({ r }) {
  const href = solscanTx(r.sig);
  return (
    <div className={"seeker-forensic-row" + (STATUS_CLASS[r.status] || "")}>
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>{shortAddr(r.addr)}</span></div>
        <div className="seeker-forensic-row-sub">
          {t(STATUS_LABEL[r.status] || r.status)}
          {r.error ? ` · ${r.error}` : ""}
        </div>
        {href ? <a className="seeker-forensic-link" href={href} target="_blank" rel="noopener noreferrer">{t("View on Solscan")}</a> : null}
      </div>
      <div className="seeker-forensic-row-value">{r.amount}</div>
    </div>
  );
}

export default function AirdropperPane({ wallet }) {
  const online = useOnline();
  const pass = usePass();

  const [native, setNative] = React.useState(false);
  const [mint, setMint] = React.useState("");
  const [mode, setMode] = React.useState("equal");       // equal | perWallet
  const [text, setText] = React.useState("");
  const [equalAmount, setEqualAmount] = React.useState("");
  const [minAmount, setMinAmount] = React.useState("");
  const [memo, setMemo] = React.useState("");

  const [formError, setFormError] = React.useState(null);
  const [parsed, setParsed] = React.useState(null);      // the plan module's full result
  const [cost, setCost] = React.useState(null);
  const [phase, setPhase] = React.useState("form");      // form | checking | review | sending | done | unavailable
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [progress, setProgress] = React.useState({ msg: "", pct: 0 });
  const [results, setResults] = React.useState([]);
  const [receipt, setReceipt] = React.useState(null);    // { url } | { error }
  const [decimals, setDecimals] = React.useState(null);

  // ⚠️ A send in flight must be stoppable, and the engine's own `shouldContinue` hook exists for
  // exactly this: a caller that can no longer RECORD what it sent must be able to stop before the
  // next wallet prompt rather than keep sending money it cannot account for. A ref, not state —
  // the engine reads it synchronously between batches and a state read would be stale.
  const stopRef = React.useRef(false);
  const liveRef = React.useRef(true);
  React.useEffect(() => () => { liveRef.current = false; stopRef.current = true; }, []);

  const ready = engine() && plan() && util();

  function resetRun() {
    setResults([]); setReceipt(null); setProgress({ msg: "", pct: 0 }); stopRef.current = false;
  }

  // ── parse + preflight ──────────────────────────────────────────────────────────────────────
  async function review() {
    const P = plan();
    if (!P) { setPhase("unavailable"); setErrKind("unavailable"); setErrMsg(t("The airdrop engine didn't load. Reopen the app and try again.")); return; }
    if (!native && !ADDR_RE.test(mint.trim())) { setFormError(t("Enter a valid token mint address, or switch to sending SOL.")); return; }
    if (!text.trim()) { setFormError(t("Paste the wallets you want to send to.")); return; }
    setFormError(null);
    resetRun();

    const res = P.parseRecipients({ mode, text, equalAmount, minAmount });
    if (res.error) { setFormError(t(res.error)); return; }
    if (!res.rows.length) {
      setFormError(res.invalid.length
        ? t("None of those lines could be read as a wallet and an amount.")
        : t("No recipients found in what you pasted."));
      setParsed(res);
      return;
    }
    // A cap, stated out loud rather than silently truncating — a truncated list that reports
    // success is the worst possible failure for a payout.
    if (res.rows.length > MAX_RECIPIENTS) {
      setFormError(`${t("That list has")} ${res.rows.length} ${t("wallets. This app sends up to")} ${MAX_RECIPIENTS} ${t("at a time — split it, or use the full site.")}`);
      setParsed(res);
      return;
    }

    setParsed(res);
    setPhase("checking");

    // Which recipients need a token account created, what that costs today, and can the sender
    // actually afford it. All read-only. An RPC failure here is "unknown", never "free".
    try {
      let dec = 9, txBudget = (engine() && engine().TX_WEIGHT_BUDGET) || 16;
      const rows = res.rows.map((r) => ({ ...r }));
      if (!native) {
        const accts = await rpc("getTokenAccountsByOwner", [wallet.address, { mint: mint.trim() }, { encoding: "jsonParsed" }]);
        const first = accts && accts.value && accts.value[0];
        if (!first) {
          setPhase("review"); setCost(null);
          setFormError(`${t("Your wallet has no account for that token, so there is nothing to send from.")}`);
          return;
        }
        const onchain = first.account && first.account.data && first.account.data.parsed
          && first.account.data.parsed.info && first.account.data.parsed.info.tokenAmount
          && first.account.data.parsed.info.tokenAmount.decimals;
        if (Number.isInteger(onchain)) dec = onchain;
        const tokenProgram = (first.account && first.account.owner) || undefined;
        await engine().checkRecipientAtas(rows, mint.trim(), rpc, tokenProgram);
      }
      setDecimals(native ? 9 : dec);

      let lamportsPerAta = 0;
      if (!native) { try { lamportsPerAta = await engine().refreshRent(rpc); } catch (_) { lamportsPerAta = engine().LAMPORTS_PER_ATA_RENT; } }
      let solBalanceLamports = null;
      try { const b = await rpc("getBalance", [wallet.address]); solBalanceLamports = (b && typeof b.value === "number") ? b.value : null; } catch (_) { solBalanceLamports = null; }

      if (!liveRef.current) return;
      setParsed({ ...res, rows });
      setCost(plan().estimateCost({
        rows, native, weightBudget: txBudget,
        lamportsPerAta, lamportsPerTxFee: (engine() && engine().LAMPORTS_PER_TX_FEE) || 5000,
        solBalanceLamports,
      }));
      setPhase("review");
    } catch (_e) {
      if (!liveRef.current) return;
      // The list is still good — only the cost preview failed. Say that, rather than throwing the
      // parsed list away, and do NOT show a zero cost.
      setCost(null);
      setPhase("review");
    }
  }

  // ── the send ───────────────────────────────────────────────────────────────────────────────
  function askToSend() {
    if (pass.status === "unsignable") return;
    if (pass.status === "needed") { setGateOpen(true); return; }
    if (!wallet.connected) { wallet.connect(); return; }
    setConfirmOpen(true);
  }

  async function send() {
    setConfirmOpen(false);
    const E = engine();
    if (!E || !parsed || !parsed.rows.length) return;
    resetRun();
    setPhase("sending");

    const created = Date.now();
    let dropId = null;
    const collected = [];

    // Record each batch's confirmed rows as they land, not once at the end: an app backgrounded
    // by the OS mid-run (a real thing on a phone) would otherwise take the whole receipt with it.
    async function record(rows) {
      if (!rows.length) return;
      for (let i = 0; i < rows.length; i += RECORD_CHUNK) {
        const chunk = rows.slice(i, i + RECORD_CHUNK);
        try {
          const r = await pass.gatedFetch("/api/airdrop/record", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dropId: dropId || undefined, mint: native ? "native" : mint.trim(),
              decimals: decimals == null ? undefined : decimals, createdAt: created,
              rows: chunk.map((x) => ({ wallet: x.addr, amount: String(x.amount), sig: x.sig })),
            }),
          });
          const j = await r.json().catch(() => null);
          if (!j || !j.success) { setReceipt({ error: (j && (j.detail || j.error)) || t("unknown error") }); return; }
          dropId = j.dropId;
          if (liveRef.current) setReceipt({ url: j.url });
        } catch (_) { setReceipt({ error: t("could not reach the receipt service") }); return; }
      }
    }

    let pendingReceipt = [];
    try {
      await E.send({
        rpc, provider: wallet.provider, walletPubkey: wallet.address,
        mint: native ? null : mint.trim(), decimals, native,
        recipients: parsed.rows.map((r) => ({ addr: r.addr, amount: r.amount, needsAta: r.needsAta, ataAddress: r.ataAddress })),
        memo: memo.trim() || undefined,
        shouldContinue: () => !stopRef.current,
        onProgress: (msg, pct) => { if (liveRef.current) setProgress({ msg, pct: Math.round(pct || 0) }); },
        onResult: (r) => {
          collected.push(r);
          if (liveRef.current) setResults(collected.slice());
          // ONLY a confirmed row goes on the public receipt. An unconfirmed row has no on-chain
          // truth yet, and a failed one has none at all — recording either would publish a claim
          // the chain does not support, which is the whole thing the receipt exists to avoid.
          if (r.status === "sent" && r.sig) pendingReceipt.push(r);
        },
      });
    } catch (e) {
      if (liveRef.current) { setErrKind("unavailable"); setErrMsg((e && e.message) || String(e)); }
    }
    await record(pendingReceipt);
    if (liveRef.current) setPhase("done");
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const runDisabled = phase === "checking" || phase === "sending" || pass.status === "loading";

  if (!online && phase === "form") {
    return <Pane icon="🪂" title="Airdropper"><Unavailable kind="offline" /></Pane>;
  }

  return (
    <Pane icon="🪂" title="Airdropper">
      <p className="seeker-tool-lede">{t("Send one token to many wallets in a few signed batches — with a public receipt anyone can check afterwards.")}</p>

      {!ready ? (
        <Unavailable kind="unavailable" message={t("The airdrop engine didn't load. Reopen the app and try again.")} />
      ) : phase === "sending" ? (
        <>
          <Loading label={progress.msg || t("Sending…")} />
          <div className="seeker-drop-progress" role="status" aria-live="polite">
            <div className="seeker-drop-progressbar"><span style={{ width: `${Math.min(100, progress.pct)}%` }} /></div>
            <p className="seeker-tool-note">{progress.msg}</p>
          </div>
          {/* Stopping is always available, and it stops BEFORE the next wallet prompt — batches
              already signed cannot be recalled, and the button says so. */}
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-drop-stop" onClick={() => { stopRef.current = true; }}>
            {t("Stop before the next batch")}
          </button>
          {results.length ? <div className="seeker-forensic-rows">{results.slice(-12).map((r, i) => <ResultRow key={i} r={r} />)}</div> : null}
        </>
      ) : phase === "done" ? (
        <>
          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Sent")}</div><div className="seeker-forensic-stat-value">{counts.sent || 0}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Failed")}</div><div className="seeker-forensic-stat-value">{counts.failed || 0}</div></div>
          </div>
          {counts.unconfirmed ? (
            <div className="seeker-drop-unconfirmed" role="alert">
              <p className="seeker-tool-notyet-title">⏳ {counts.unconfirmed} {t("unconfirmed")}</p>
              <p>{t("These were submitted but had no on-chain status after 30 seconds. They may still have landed. Check each signature on Solscan BEFORE resending — resending one that landed pays that wallet twice.")}</p>
            </div>
          ) : null}
          {errMsg ? <p className="seeker-tool-note seeker-passgate-err" role="alert">{errMsg}</p> : null}
          {receipt && receipt.url ? (
            <p className="seeker-tool-note">
              {t("Public receipt:")}{" "}
              <a className="seeker-forensic-link" href={`https://clucknorris.app${receipt.url}`} target="_blank" rel="noopener noreferrer">{t("open it")}</a>
            </p>
          ) : receipt && receipt.error ? (
            <p className="seeker-tool-note seeker-passgate-err" role="alert">
              {t("The tokens sent. The public receipt did not record them:")} {receipt.error}
            </p>
          ) : null}
          <div className="seeker-forensic-rows">{results.map((r, i) => <ResultRow key={i} r={r} />)}</div>
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => { resetRun(); setPhase("form"); }}>
            {t("Start another drop")}
          </button>
        </>
      ) : (
        <>
          <div className="seeker-forensic-form">
            <label className="seeker-lock-toggle">
              <input type="checkbox" checked={native} onChange={(e) => { setNative(e.target.checked); setParsed(null); setCost(null); setPhase("form"); }} />
              <span>
                <span className="seeker-lock-toggle-label">{t("Send SOL instead of a token")}</span>
                <span className="seeker-lock-toggle-note">{t("SOL needs no token account, so there is no rent to pay for recipients.")}</span>
              </span>
            </label>

            {!native ? (
              <>
                <label className="seeker-listing-label" htmlFor="drop-mint">{t("Token mint address")}</label>
                <input id="drop-mint" className="seeker-listing-input" value={mint} autoComplete="off" spellCheck="false"
                  onChange={(e) => { setMint(e.target.value); setParsed(null); setCost(null); setPhase("form"); }}
                  placeholder={t("Paste the token's mint address")} />
              </>
            ) : null}

            <div className="seeker-drop-modes" role="group" aria-label={t("How much each wallet gets")}>
              <button type="button" className={"seeker-btn seeker-btn-quiet" + (mode === "equal" ? " seeker-drop-mode-on" : "")}
                onClick={() => { setMode("equal"); setParsed(null); setCost(null); setPhase("form"); }}>{t("Same to everyone")}</button>
              <button type="button" className={"seeker-btn seeker-btn-quiet" + (mode === "perWallet" ? " seeker-drop-mode-on" : "")}
                onClick={() => { setMode("perWallet"); setParsed(null); setCost(null); setPhase("form"); }}>{t("Amount per wallet")}</button>
            </div>

            <label className="seeker-listing-label" htmlFor="drop-list">{t("Wallets")}</label>
            <textarea id="drop-list" className="seeker-listing-input seeker-drop-textarea" value={text} spellCheck="false"
              onChange={(e) => { setText(e.target.value); setParsed(null); setCost(null); setPhase("form"); }}
              placeholder={mode === "equal" ? t("One wallet address per line") : t("One per line: address,amount")} />

            {mode === "equal" ? (
              <>
                <label className="seeker-listing-label" htmlFor="drop-amt">{t("Amount per wallet")}</label>
                <input id="drop-amt" className="seeker-listing-input" value={equalAmount} inputMode="decimal" autoComplete="off"
                  onChange={(e) => { setEqualAmount(e.target.value); setParsed(null); setCost(null); setPhase("form"); }} placeholder="100" />
              </>
            ) : null}

            <label className="seeker-listing-label" htmlFor="drop-min">{t("Skip wallets below (optional)")}</label>
            <input id="drop-min" className="seeker-listing-input" value={minAmount} inputMode="decimal" autoComplete="off"
              onChange={(e) => { setMinAmount(e.target.value); setParsed(null); setCost(null); setPhase("form"); }} placeholder={t("no minimum")} />

            <label className="seeker-listing-label" htmlFor="drop-memo">{t("Memo on each transaction (optional)")}</label>
            <input id="drop-memo" className="seeker-listing-input" value={memo} maxLength={80} autoComplete="off"
              onChange={(e) => setMemo(e.target.value)} placeholder={t("e.g. September rewards")} />

            {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}

            <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={review} disabled={runDisabled}>
              {phase === "checking" ? t("Checking…") : t("Review the drop")}
            </button>

            {pass.status === "unsignable" ? (
              <div className="seeker-tool-notyet" role="status">
                <p className="seeker-tool-notyet-title">🔒 {t("No wallet on this device can sign")}</p>
                <p>{t("The tools pass needs a signature, and this device has no wallet that can produce one yet. This resolves itself once wallet support lands in the app — nothing you can do here unlocks it early.")}</p>
              </div>
            ) : null}
          </div>

          {phase === "checking" ? <Loading label={t("Reading the chain…")} /> : null}

          {parsed ? (
            <>
              <div className="seeker-forensic-statgrid">
                <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Wallets")}</div><div className="seeker-forensic-stat-value">{parsed.rows.length}</div></div>
                <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Total to send")}</div><div className="seeker-forensic-stat-value">{parsed.total}</div></div>
              </div>

              {/* Every outcome of the parse gets its own line. A list that quietly dropped rows is
                  how an operator ends up believing they paid people they did not. */}
              {parsed.merged.length ? (
                <div className="seeker-drop-note" role="status">
                  {parsed.merged.length} {t("address(es) appeared more than once and were merged into one payment each — the totals above already reflect that.")}
                </div>
              ) : null}
              {parsed.skipped.length ? (
                <div className="seeker-drop-note" role="status">
                  {parsed.skipped.length} {t("wallet(s) were below the minimum you set and will not be sent to.")}
                </div>
              ) : null}
              {parsed.invalid.length ? (
                <div className="seeker-drop-note seeker-drop-note-warn" role="alert">
                  <p>{parsed.invalid.length} {t("line(s) could not be read and will NOT be sent to:")}</p>
                  {parsed.invalid.slice(0, 6).map((v, i) => (
                    <p key={i} className="seeker-forensic-row-sub">{v.line.slice(0, 44)} — {t(v.reason)}</p>
                  ))}
                  {parsed.invalid.length > 6 ? <p className="seeker-forensic-row-sub">…{parsed.invalid.length - 6} {t("more")}</p> : null}
                </div>
              ) : null}

              {phase === "review" ? (
                cost ? (
                  <div className="seeker-forensic-statgrid">
                    <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Transactions to sign")}</div><div className="seeker-forensic-stat-value">{cost.txCount}</div></div>
                    <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Network cost")}</div><div className="seeker-forensic-stat-value">{fmtSol(cost.totalLamports)}</div></div>
                  </div>
                ) : (
                  // NOT a zero. "We could not read it" and "it is free" are different facts.
                  <div className="seeker-drop-note seeker-drop-note-warn" role="alert">
                    {t("Could not read the network cost right now — the wallet will still show you each transaction's fee before you approve it.")}
                  </div>
                )
              ) : null}
              {cost && cost.newAtas ? (
                <p className="seeker-tool-note">{cost.newAtas} {t("of these wallets have never held this token, so you also pay a one-time account rent for each —")} {fmtSol(cost.rentLamports)}.</p>
              ) : null}
              {cost && cost.affordable === false ? (
                <div className="seeker-drop-note seeker-drop-note-warn" role="alert">
                  {t("Your wallet does not hold enough SOL to cover that. Top it up before starting — a drop that runs out part-way pays some wallets and not others.")}
                </div>
              ) : null}

              {phase === "review" && parsed.rows.length ? (
                !wallet.connected
                  ? <NeedsWallet why={t("Connect the wallet holding the tokens to send them.")} wallet={wallet} />
                  : <button type="button" className="seeker-btn seeker-drop-send" onClick={askToSend} disabled={runDisabled}>
                      {t("Send to")} {parsed.rows.length} {t("wallets")}
                    </button>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {errMsg && phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={() => { setPhase("form"); setErrMsg(null); }} /> : null}

      <Confirm
        open={confirmOpen}
        title="Send this drop?"
        danger
        confirmLabel="Send it"
        lines={parsed ? [
          `${t("You are about to send")} ${parsed.total} ${native ? "SOL" : t("tokens")} ${t("to")} ${parsed.rows.length} ${t("wallets.")}`,
          cost ? `${t("Your wallet will ask you to approve")} ${cost.txCount} ${t("transaction(s), costing about")} ${fmtSol(cost.totalLamports)} ${t("in network fees and rent.")}` : t("Your wallet will show you each transaction's fee before you approve it."),
          t("Transfers cannot be reversed. Check the wallets and the amount before you approve."),
        ] : []}
        onConfirm={send}
        onCancel={() => setConfirmOpen(false)}
      />

      {gateOpen ? (
        <PassGate pass={pass} wallet={wallet} tool="airdrop" onUnlocked={() => { setGateOpen(false); pass.refresh(); setConfirmOpen(true); }} onClose={() => setGateOpen(false)} />
      ) : null}
    </Pane>
  );
}
