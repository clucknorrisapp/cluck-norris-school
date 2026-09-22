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
//   POST /api/airdrop/record  (no pass — free for everyone, owner 2026-09-22)
//                             { dropId?, mint, decimals, createdAt, rows:[{wallet, amount, sig}] }
//     200 { success:true, dropId, url:"/airdrop/r/<id>", recorded, totals }
//     400 { success:false, error }   — bad rows / too many rows
//     429 { success:false, error }   — this wallet's daily drop cap (keyed on the fee payer the
//                                      server reads off the chain, never on anything we send)
//   This pane carried the unified tools pass from its first commit to 2026-09-22 (usePass and
//   the shared pass sheet, keyed by the registry id "airdrop"). It is free now, on every
//   platform; the wallet is still needed —
//   it signs every batch — but nothing is checked, bought or held to use the tool.
//   The receipt is the verifiable half: a stranger can read /airdrop/r/<id> and the server
//   re-reads each signature on-chain. Recording NEVER blocks or fails the send — the tokens have
//   already landed by then, and a receipt hiccup that looked like a failed airdrop would be its
//   own lie. A failed record is reported as exactly what it is: the rows sent, the receipt short.
//
// "Say what's on-chain, never why" applies to the token too: this pane shows the mint's decimals
// and the sender's balance as the chain reports them and makes no claim about the token itself.
import React from "react";
import { t, tf, useI18nReady } from "../i18n.js";
import { Pane, Loading, Unavailable, Confirm, NeedsWallet, useOnline } from "../pane.jsx";
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
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();

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
  // A ref does not re-render, and the done view needs to SAY that the run was stopped
  // (adversarial review P3-9), so the same fact is mirrored into state.
  const [stopped, setStopped] = React.useState(false);
  const liveRef = React.useRef(true);
  React.useEffect(() => () => { liveRef.current = false; stopRef.current = true; }, []);

  // ⚠️ LOSING THE WALLET MID-DROP MUST STOP THE DROP (adversarial review P3-10, 2026-09-21).
  // App.jsx drops the connection outright when the wallet switches accounts — the right call —
  // but an in-flight send() closed over `wallet.provider` and `wallet.address` when it started
  // and kept going: every remaining batch still built for the OLD address, still prompting the
  // now-different wallet, with nothing setting stopRef. Best case those batches fail signature
  // verification and land in the Failed count; a lenient shimmed provider is the case sign.js's
  // live-public-key re-read exists for, and this engine does not have it.
  //
  // The engine already has the hook for this: shouldContinue is checked before each batch, so
  // setting the flag stops the run BEFORE the next wallet prompt rather than after it.
  React.useEffect(() => {
    if (!wallet.connected && phase === "sending") stopRef.current = true;
  }, [wallet.connected, phase]);

  const ready = engine() && plan() && util();

  function resetRun() {
    setResults([]); setReceipt(null); setProgress({ msg: "", pct: 0 }); stopRef.current = false; setStopped(false);
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
      let tokenBalanceBaseUnits = null;
      const rows = res.rows.map((r) => ({ ...r }));
      if (!native) {
        const accts = await rpc("getTokenAccountsByOwner", [wallet.address, { mint: mint.trim() }, { encoding: "jsonParsed" }]);
        const first = accts && accts.value && accts.value[0];
        if (!first) {
          // ⚠️ NOT phase "review" (adversarial review P1-4, 2026-09-21). This branch set a form
          // error AND moved to review with `parsed` already populated — so the Send button
          // rendered, on a mint this wallet holds no account for, under an error message.
          // Stay on the form: there is nothing here that can be sent.
          setPhase("form"); setCost(null); setParsed(null); setDecimals(null);
          setFormError(`${t("Your wallet has no account for that token, so there is nothing to send from.")}`);
          return;
        }
        const tokenAmount = first.account && first.account.data && first.account.data.parsed
          && first.account.data.parsed.info && first.account.data.parsed.info.tokenAmount;
        const onchain = tokenAmount && tokenAmount.decimals;
        if (Number.isInteger(onchain)) dec = onchain;
        // ⚠️ The BALANCE, from the response we were already reading the decimals out of
        // (adversarial review P1-3). It used to be dropped on the floor, so nothing compared
        // what is being sent against what is held, and a drop that could not finish started
        // anyway. `amount` is base units as a STRING — keep it a string all the way to
        // estimateCost, which does the comparison in exact decimal arithmetic.
        tokenBalanceBaseUnits = (tokenAmount && typeof tokenAmount.amount === "string") ? tokenAmount.amount : null;
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
        // The three the amount check needs. `res.total` is the parser's own exact decimal
        // string for the whole list — never re-summed here, never a float.
        sendTotal: res.total, tokenBalanceBaseUnits, decimals: native ? 9 : dec,
      }));
      setPhase("review");
    } catch (_e) {
      if (!liveRef.current) return;
      // The list is still good — only the cost preview failed. Say that, rather than throwing the
      // parsed list away, and do NOT show a zero cost.
      //
      // ⚠️ But `decimals` must NOT survive this (adversarial review P1-4). setDecimals runs after
      // two awaited RPC calls, so one 502 here left the PREVIOUS drop's decimals in state while
      // the screen showed only "could not read the network cost", which reads as cosmetic. The
      // chain transfer was still correct (the engine re-reads decimals from the mint), but the
      // public receipt was posted with the stale figure — and lib/airdrop-receipt.js derives its
      // verification threshold from it, so every row recorded verified:true against a bar 1000x
      // too low, or verified:false on a drop that was perfect. null means "we do not know",
      // which the record path already treats as "do not send a decimals field".
      setCost(null);
      setDecimals(null);
      setPhase("review");
    }
  }

  // ── the send ───────────────────────────────────────────────────────────────────────────────
  function askToSend() {
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
    // The public handle for a native SOL drop. It is the canonical wrapped-SOL mint address, so
    // it is a real base58 address that needs no special case in the receipt's storage, URL or
    // page — and lib/airdrop-receipt.js verifies it from LAMPORT deltas rather than token
    // balances. Before this, the pane posted the literal string "native", SOL_ADDR_RE rejected
    // it, and every SOL drop reported "the public receipt did not record them: bad mint"
    // (adversarial review P2-5).
    const NATIVE_RECEIPT_MINT = "So11111111111111111111111111111111111111112";

    // ⚠️ A PARTIAL RECEIPT IS NOT "NO RECEIPT" (adversarial review P2-7, 2026-09-21). This used
    // to `setReceipt({ error })` on the first failed chunk, which REPLACED the whole object and
    // threw away the url of the chunks that HAD recorded. A 250-row drop whose third chunk hit
    // the rate limiter reported "the public receipt did not record them" while 200 of them were
    // on a receipt at a URL the person could no longer see. Keep both facts, and keep the link.
    // Run-level, NOT per call: record() is now called several times during one drop (see the
    // flush in onResult), so a per-call counter would make the last flush's numbers look like
    // the whole run's.
    let recorded = 0, attempted = 0;
    async function record(rows, decimalsForReceipt) {
      if (!rows.length) return;
      attempted += rows.length;
      const fail = (msg) => {
        if (!liveRef.current) return;
        setReceipt((prev) => ({ ...(prev || {}), error: msg, recorded, total: attempted }));
      };
      for (let i = 0; i < rows.length; i += RECORD_CHUNK) {
        const chunk = rows.slice(i, i + RECORD_CHUNK);
        try {
          const r = await fetch("/api/airdrop/record", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dropId: dropId || undefined, mint: native ? NATIVE_RECEIPT_MINT : mint.trim(),
              decimals: Number.isInteger(decimalsForReceipt) ? decimalsForReceipt : undefined, createdAt: created,
              rows: chunk.map((x) => ({ wallet: x.addr, amount: String(x.amount), sig: x.sig })),
            }),
          });
          const j = await r.json().catch(() => null);
          if (!j || !j.success) { fail((j && (j.detail || j.error)) || t("unknown error")); return; }
          dropId = j.dropId;
          recorded += chunk.length;
          // Clear any earlier error only once a chunk has actually succeeded after it.
          if (liveRef.current) setReceipt({ url: j.url, recorded, total: attempted });
        } catch (_) { fail(t("could not reach the receipt service")); return; }
      }
    }

    let pendingReceipt = [];
    let flushing = false;
    // Starts as the state value and is REPLACED by the engine's own figure the moment the run
    // returns one. Undefined is a legitimate answer — the receipt route treats a missing
    // decimals as "not stated" rather than guessing, which is the honest outcome when the only
    // two sources we trust disagree or neither could be read.
    let receiptDecimals = decimals;
    try {
      // ⚠️ The engine's RETURN VALUE is the authority on decimals — it re-reads them from the
      // mint itself before transferring (airdrop-engine.js) and overrides whatever it was
      // passed. Taking the receipt's figure from React state instead meant the receipt could be
      // denominated differently from the transfer that actually happened. Keep them the same
      // number, from the same place.
      const sendResult = await E.send({
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
          // ⚠️ RECORD AS THEY LAND, NOT ONCE AT THE END (adversarial review P2-6, 2026-09-21).
          // The comment above `record()` has always said why, and the code did the opposite: a
          // single call after the whole run. A 600-wallet drop is ~38 wallet prompts, minutes of
          // switching between the wallet app and this one on a phone — and when iOS reclaims the
          // tab at prompt 30, thirty batches of tokens are on chain, `record` never ran, the
          // receipt does not exist, and there is no path in the pane to build one from rows it
          // no longer has. Real tokens moved with no public proof and no way to produce it.
          //
          // Flushing on a batch boundary keeps at most one batch at risk instead of all of them.
          // The dropId threading already supports it — that is exactly what the
          // `dropId: dropId || undefined` continuation is for. A flush in flight is skipped
          // rather than queued: the next boundary picks up whatever is still pending, and the
          // final record() after the loop catches the remainder either way.
          // ⚠️ Only flush when the denomination is KNOWN. `decimals` is null whenever this run's
          // own chain read failed (see review()'s catch — P1-4), and recordDrop pins mint +
          // decimals on the FIRST call for a dropId: a flush with the wrong figure would either
          // be rejected for the rest of the run or, worse, fix the receipt to a denomination the
          // transfers do not use. When we do not know, everything waits for the final record(),
          // which takes the engine's own authoritative figure.
          if (Number.isInteger(receiptDecimals) && pendingReceipt.length >= RECORD_CHUNK && !flushing) {
            const batch = pendingReceipt;
            pendingReceipt = [];
            flushing = true;
            // Not awaited — onResult must not hold up the next wallet prompt.
            record(batch, receiptDecimals).finally(() => { flushing = false; });
          }
        },
      });
      if (sendResult && Number.isInteger(sendResult.decimals)) receiptDecimals = sendResult.decimals;
    } catch (e) {
      if (liveRef.current) { setErrKind("unavailable"); setErrMsg((e && e.message) || String(e)); }
    }
    await record(pendingReceipt, receiptDecimals);
    if (liveRef.current) setPhase("done");
  }

  const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  // Counted off the engine's own reason string rather than arithmetic on totals, so the banner
  // and the rows can never disagree.
  const stoppedNotAttempted = results.filter((r) => r.status === "failed" && /stopped by the caller/.test(String(r.error || ""))).length;
  const runDisabled = phase === "checking" || phase === "sending";

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
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-drop-stop" onClick={() => { stopRef.current = true; setStopped(true); }}>
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
          {/* ⚠️ "Sent 40 · Failed 460" is how a run that went badly wrong reads, not one the
              operator halted on purpose (adversarial review P3-9). The engine reports every
              recipient it never reached as failed — defensible per row, and each row does carry
              the reason — but the two tiles above say nothing about the stop. The rows that were
              never attempted are counted by the engine's own reason string, so this number can
              never drift from what the rows themselves say. */}
          {stopped && stoppedNotAttempted > 0 ? (
            <div className="seeker-drop-note seeker-drop-note-warn" role="alert">
              {tf("You stopped this drop. {n} of these wallets were never attempted — nothing was sent to them, and nothing was charged for them.", { n: stoppedNotAttempted })}
            </div>
          ) : null}
          {counts.unconfirmed ? (
            <div className="seeker-drop-unconfirmed" role="alert">
              <p className="seeker-tool-notyet-title">⏳ {counts.unconfirmed} {t("unconfirmed")}</p>
              <p>{t("These were submitted but had no on-chain status after 30 seconds. They may still have landed. Check each signature on Solscan BEFORE resending — resending one that landed pays that wallet twice.")}</p>
            </div>
          ) : null}
          {errMsg ? <p className="seeker-tool-note seeker-passgate-err" role="alert">{errMsg}</p> : null}
          {/* THREE states, not two (P2-7): a full receipt, a PARTIAL one — link and all — and no
              receipt at all. Collapsing the middle one into the last discards the link to rows
              that really were recorded. */}
          {receipt && receipt.url ? (
            <>
              <p className="seeker-tool-note">
                {t("Public receipt:")}{" "}
                <a className="seeker-forensic-link" href={`https://clucknorris.app${receipt.url}`} target="_blank" rel="noopener noreferrer">{t("open it")}</a>
              </p>
              {receipt.error ? (
                <p className="seeker-tool-note seeker-passgate-err" role="alert">
                  {tf("Only {done} of {total} rows made it onto the receipt — the rest did not record:", { done: receipt.recorded, total: receipt.total })} {receipt.error}
                </p>
              ) : null}
            </>
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
              {/* ⚠️ The warning above is about FEES. This one is about the AMOUNT, and for a long
                  time it did not exist (adversarial review P1-3) — so the only affordability
                  check the pane had could never fire for what was actually being sent. Both are
                  shown: they are different problems and a person can have either, or both. */}
              {cost && cost.enoughToSend === false ? (
                <div className="seeker-drop-note seeker-drop-note-warn" role="alert">
                  {tf("This list sends more than the wallet holds — it is short by {short}. A drop that runs out part-way pays some wallets and not others, and every failed transaction still costs a fee.",
                      { short: `${cost.shortBy} ${native ? "SOL" : t("tokens")}` })}
                </div>
              ) : null}
              {cost && cost.enoughToSend === null && parsed.rows.length ? (
                /* Unreadable is not "fine". Say which check could not be made, rather than
                   letting a silent screen imply both passed. */
                <p className="seeker-tool-note">{t("Could not read the sending wallet's balance, so this was not checked against the total below.")}</p>
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
    </Pane>
  );
}
