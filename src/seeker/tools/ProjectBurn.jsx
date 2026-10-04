// Cluck Norris — Seeker app, Project Burn pane (docs/SEEKER_TOOLS_BUILD.md — registry id "burn").
//
// Signs and sends. Every transaction goes through src/seeker/sign.js's signSendConfirm() — the
// app's one signing seam (confirmation-err-first, three outcomes, live-pubkey re-read, message-
// byte diff, connected-wallet-signs-first). This file does not re-implement any of that; the
// unconfirmed-recheck below reuses sign.js's own checkPendingSwap / checkUnsignedPending rather
// than a second copy, and the unresolved attempt itself is persisted by burn-pending.js.
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
import { t, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, toolFetch, useOnline } from "../pane.jsx";
import { NeedsWallet } from "../needswallet.jsx";
import { shortAddr } from "../addr.js";
import { signSendConfirm, rpcFn, splTokenShim, checkPendingSwap, checkUnsignedPending } from "../sign.js";
import { loadBurnPending, saveBurnPending, clearBurnPending, BURN_PENDING_ESCAPE_MS } from "./burn-pending.js";
import { noSignatureSentence, releasedSentence } from "../attempt-copy.js";
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

// A persisted attempt (burn-pending.js), shaped as the on-screen "unconfirmed" outcome.
function outcomeFromRecord(rec) {
  return {
    status: "unconfirmed", sig: rec.sig, amount: rec.amount, symbol: rec.symbol, mint: rec.mint,
    usdValue: null, pctSupply: null, isFullBalance: rec.isFullBalance,
    at: rec.at, recentBlockhash: rec.recentBlockhash, lastValidBlockHeight: rec.lastValidBlockHeight, wallet: rec.wallet,
  };
}

// ⚠️ Codex on #479 (b0d381a4), P1 — an UNCONFIRMED burn has no "OK". It used to offer one when
// there was no signature (a send-capable wallet errored after it may have broadcast), which
// cleared the card, brought the form back and let the same amount be burned a second time. Now
// the only ways out of this card are the chain (Check status: landed / failed on chain / blockhash
// proven dead) and, after BURN_PENDING_ESCAPE_MS, "Stop watching" — which is not a claim that
// nothing happened. The record behind the card is persisted (burn-pending.js) so a remount or
// reload restores it, and it was written BEFORE the wallet was asked.
function OutcomeCard({ o, onDismiss, onRetry, onCheckStatus, onStopWatching }) {
  const [, forceTick] = React.useState(0);
  const unresolved = o.status === "unconfirmed";
  React.useEffect(() => {
    if (!unresolved) return undefined;
    const iv = setInterval(() => forceTick((n) => n + 1), 30000); // notice crossing the 10-minute mark
    return () => clearInterval(iv);
  }, [unresolved]);
  const showEscape = unresolved && typeof o.at === "number" && Date.now() - o.at >= BURN_PENDING_ESCAPE_MS;
  return (
    <div className={"seeker-burn-outcome seeker-burn-outcome-" + o.status} role={o.status === "failed" || o.status === "unconfirmed" ? "alert" : "status"}>
      {o.status !== "released" ? (
        <p className="seeker-burn-outcome-title">
          {o.status === "sent" ? "🔥 " : o.status === "failed" ? "⚠️ " : o.status === "unconfirmed" ? "⏳ " : ""}
          {t(OUTCOME_LABEL[o.status])}
        </p>
      ) : null}
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
          {o.sig
            ? <p>{t("This was submitted but had no on-chain status after 30 seconds. It may still have landed — check before doing anything else. Resending it if it already landed would burn the tokens a second time.")}</p>
            : <p>{noSignatureSentence()}</p>}
          {solscanTx(o.sig) ? <p><a className="seeker-forensic-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
          <div className="seeker-burn-outcome-actions">
            {/* With a signature this asks the chain about it; without one only the attempt's own
                lifetime (blockhash proven dead) can release it — and then the balance re-read is
                the only claim. Either way there is a button: a missing signature is tracked, never
                treated as nothing to look up. */}
            <button type="button" className="seeker-btn seeker-btn-quiet" disabled={o.checking} onClick={onCheckStatus}>{o.checking ? t("Checking…") : t("Check status")}</button>
          </div>
          {showEscape ? (
            <div className="seeker-swap-pending-escape">
              {o.sig ? <p>{t("This is taking longer than usual to confirm. Your signature above is the real record — check it on Solscan, or stop watching here.")}</p> : null}
              <button type="button" className="seeker-btn seeker-btn-quiet seeker-burn-stopwatch" onClick={onStopWatching}>{t("Stop watching")}</button>
            </div>
          ) : null}
        </>
      ) : o.status === "released" ? (
        // A signature-less attempt whose blockhash is proven dead. No title, no "nothing was
        // burned": the balance on the card above was re-read when this was released, and that
        // is the only record there is.
        // `true`: this card renders only inside a LOADED token card (phase === "loaded"), so the
        // balance shown above it is a real read, never the pre-release figure.
        <p>{releasedSentence(true)}</p>
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
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
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
  const [burnOutcome, setBurnOutcome] = React.useState(null); // { status, sig?, error?, amount, symbol, mint, usdValue, pctSupply, isFullBalance, receipt?, receiptError?, checking?, at?, recentBlockhash?, lastValidBlockHeight?, wallet? }
  const abortRef = React.useRef(null);
  const confirmAbortRef = React.useRef(null);

  React.useEffect(() => () => {
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
  }, []);

  // ── restore an unresolved attempt for THIS wallet (Codex on #479, P1) ─────────────────────────
  // The record is written before the wallet is asked (see onConfirmed), so a prompt that was
  // closed with the app, a wallet reply that never came back, or a confirmation still in flight
  // all come back here as the watching card — with the burn form OFF — and the token the attempt
  // was for is loaded so the card has somewhere to render. Another wallet's record is never shown.
  const walletAddr = wallet.connected && wallet.address ? wallet.address : null;
  React.useEffect(() => {
    const rec = walletAddr ? loadBurnPending(walletAddr) : null;
    // ⚠️ Codex round 2 on #479 (e3d3effa), P1 — THE RECORD ALWAYS WINS. The first cut kept any
    // declined / sent / failed card that happened to be on screen, so switching from wallet A
    // (its declined card still open) to wallet B (an unresolved burn on record) showed A's card,
    // whose OK brought the burn form back for B while B's blockhash was still live — a second
    // prompt, and B's original record overwritten. Now: a record for the connected wallet is
    // restored unconditionally (keeping an unconfirmed card already showing for that wallet, so
    // a Check status in flight is not reset); without one, an outcome that belongs to a
    // different wallet is dropped rather than carried onto this one's screen.
    setBurnOutcome((o) => {
      if (rec) return o && o.status === "unconfirmed" && o.wallet === walletAddr ? o : outcomeFromRecord(rec);
      if (o && o.wallet && o.wallet !== walletAddr) return null;
      return o;
    });
    if (rec) {
      setMintInput(rec.mint);
      setFormError(null);
      fetchToken(rec.mint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddr]);

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
    // An UNRESOLVED attempt is never dropped by loading a token — it is cleared only by the chain
    // or the escape hatch (Codex on #479, P1). Loading a different mint keeps the card, which
    // renders on whatever token card is shown and keeps the burn form off.
    setBurnOutcome((o) => (o && o.status === "unconfirmed" ? o : null));
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
  // ⚠️ `balance != null` is REQUIRED, not decorative (adversarial review P2-8, 2026-09-21).
  // /api/burn-token-info swallows a failed getTokenAccountsByOwner and answers 200 with
  // walletBalance: null, so `balance` is null, `overBalance` is false (it is guarded on
  // balance != null), and this used to arm a live Burn button under a card reading
  // "Your balance: Unknown". A burn is irreversible; arming it on a balance nobody could read
  // is the opposite of this app's rule that the guardrail comes before the power.
  const unresolved = !!burnOutcome && burnOutcome.status === "unconfirmed";
  const canBurn = tok && balance != null && amtNum > 0 && !overBalance && !tooSmall && confirmPhase !== "checking" && !burning && !unresolved;

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
    // ⚠️ TWO DIFFERENT FACTS, and they were collapsed into one sentence that blamed the person.
    // An unreadable balance printed "Your balance changed since this page loaded" — a claim
    // about their wallet the app has no basis for. pane.jsx's own rule: a failed read is never
    // rendered as the user's fault and never as a number.
    if (freshBal == null) { setConfirmPhase("unreadable"); return; }
    if (typedAmt <= 0 || typedAmt > freshBal + 1e-12) { setConfirmPhase("stale"); return; }
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
    if (unresolved) return; // never a second attempt while the first is unresolved
    setBurning(true);
    setBurnOutcome(null);
    // ⚠️ Codex on #479 (b0d381a4), P1 — the attempt is on record BEFORE the wallet is asked. A
    // send-capable wallet (signAndSendTransaction / MWA) can broadcast and then throw without a
    // signature; `onSigned` never runs then, and this pane used to hold the outcome in React state
    // only and offer "OK" — a second tap burned the same amount again. `beforeSign` writes the
    // record with `sig: null` (sign.js runs it after build(), so the blockhash and its lifetime
    // are known); `onSigned` fills the signature in; a save that fails means the wallet is never
    // asked (sign.js returns `failed` and says so). Only the chain releases the record.
    const startedAt = Date.now();
    const ownerAddr = wallet.address;
    let builtBlockhash = null;
    const record = (sig, lifetime) => ({
      sig, mint: frozen.mint, symbol: frozen.symbol, decimals: frozen.decimals, rawAmt: frozen.rawAmt,
      amount: frozen.amtNum, isFullBalance: frozen.isFullBalance,
      recentBlockhash: builtBlockhash, lastValidBlockHeight: lifetime, wallet: ownerAddr, at: startedAt,
    });
    let lifetime = null;
    const res = await signSendConfirm({
      provider: wallet.provider,
      owner: ownerAddr,
      beforeSign: (info) => {
        lifetime = info && typeof info.lastValidBlockHeight === "number" ? info.lastValidBlockHeight : null;
        return saveBurnPending(record(null, lifetime)); // false → sign.js: the wallet is never asked
      },
      onSigned: (sig) => { saveBurnPending(record(sig, lifetime)); },
      build: (web3, blockhash, owner) => {
        builtBlockhash = blockhash;
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
      wallet: wallet.address, // every outcome names its wallet — a switch drops another wallet's card (round 2, P1)
      amount: frozen.amtNum, symbol: frozen.symbol, mint: frozen.mint,
      usdValue: frozen.priceUsd != null ? frozen.amtNum * frozen.priceUsd : null,
      pctSupply: frozen.supply ? (frozen.amtNum / frozen.supply) * 100 : null,
      isFullBalance: frozen.isFullBalance,
    };
    // A definitive answer (landed; refused so nothing landed; declined in the wallet) retires the
    // record written before the prompt. Unconfirmed keeps it — with or without a signature.
    if (res.status === "sent" || res.status === "failed" || res.status === "declined") clearBurnPending(wallet.address);
    if (res.status === "sent") {
      setBurnOutcome({ ...base, status: "sent", sig: res.sig });
      fetchReceipt(res.sig, frozen.mint);
      loadToken(); // refresh balance/supply so a second burn sees the new figure
    } else if (res.status === "unconfirmed") {
      // Codex on #479, P1: `res.noSignature` (a send-capable wallet errored after it may have
      // broadcast) is tracked exactly like a known signature — the sig:null record STAYS, the
      // form stays off, and only Check status / the chain can release it.
      const prev = loadBurnPending(wallet.address);
      const sig = res.sig || null;
      const rec = { ...(prev || {}), sig, mint: frozen.mint, symbol: frozen.symbol, decimals: frozen.decimals, rawAmt: frozen.rawAmt, amount: frozen.amtNum, isFullBalance: frozen.isFullBalance, wallet: wallet.address, at: prev && typeof prev.at === "number" ? prev.at : Date.now() };
      saveBurnPending(rec);
      setBurnOutcome({ ...base, status: "unconfirmed", sig, at: rec.at, recentBlockhash: rec.recentBlockhash || null, lastValidBlockHeight: rec.lastValidBlockHeight == null ? null : rec.lastValidBlockHeight, wallet: wallet.address });
    } else if (res.status === "declined") {
      setBurnOutcome({ ...base, status: "declined" });
    } else {
      setBurnOutcome({ ...base, status: "failed", error: res.error });
    }
    setBurning(false);
  }

  // The PRIMARY recovery action for an ambiguous send — through sign.js's own checks, never a
  // hand-rolled status read (header note). With a signature: checkPendingSwap (err before status,
  // history searched, expiry only on a well-formed null AND a dead blockhash) — landed → receipt +
  // balance re-read; failed on chain / expired → nothing was burned. Without one (Codex on #479,
  // P1): checkUnsignedPending — the attempt's blockhash proven dead releases the record, the
  // balance is re-read, and that re-read is the ONLY claim; never "did not land". A "still
  // pending" answer changes nothing so a stray tap can't be read as permission to retry.
  async function recheckPending() {
    if (!burnOutcome || burnOutcome.status !== "unconfirmed" || burnOutcome.checking) return;
    setBurnOutcome((o) => ({ ...o, checking: true }));
    const walletOf = burnOutcome.wallet || wallet.address;
    try {
      const lv = typeof burnOutcome.lastValidBlockHeight === "number" ? burnOutcome.lastValidBlockHeight : null;
      const r = burnOutcome.sig
        ? await checkPendingSwap(rpcFn(), { signature: burnOutcome.sig, lastValidBlockHeight: lv, recentBlockhash: burnOutcome.recentBlockhash || null })
        : await checkUnsignedPending(rpcFn(), { lastValidBlockHeight: lv, recentBlockhash: burnOutcome.recentBlockhash || null });
      if (r.status === "sent") {
        clearBurnPending(walletOf);
        setBurnOutcome((o) => ({ ...o, status: "sent", checking: false }));
        fetchReceipt(burnOutcome.sig, burnOutcome.mint);
        loadToken();
      } else if (r.status === "expired" && !burnOutcome.sig) {
        clearBurnPending(walletOf);
        setBurnOutcome((o) => ({ ...o, status: "released", checking: false }));
        loadToken(); // the balance re-read is the record
      } else if (r.status === "failed" || r.status === "expired") {
        // Landed and failed on chain, or provably never landed: nothing was burned.
        clearBurnPending(walletOf);
        setBurnOutcome((o) => ({ ...o, status: "failed", error: r.status === "failed" ? r.error : "", checking: false }));
        loadToken();
      } else {
        setBurnOutcome((o) => ({ ...o, checking: false })); // still ambiguous — unchanged, safe
      }
    } catch (e) {
      setBurnOutcome((o) => (o ? { ...o, checking: false } : o)); // a read failure is not an answer
    }
  }

  // The escape hatch: after BURN_PENDING_ESCAPE_MS an unresolved attempt can be dropped from
  // view. Not a claim that nothing happened — the signature link (when there is one) stays on the
  // card right up to this tap.
  function stopWatching() {
    clearBurnPending((burnOutcome && burnOutcome.wallet) || wallet.address);
    setBurnOutcome(null);
    loadToken();
  }

  function dismissOutcome() { setBurnOutcome((o) => (o && o.status === "unconfirmed" ? o : null)); }
  function retryFromOutcome() { setBurnOutcome((o) => (o && o.status === "unconfirmed" ? o : null)); }

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
            <OutcomeCard o={burnOutcome} onDismiss={dismissOutcome} onRetry={retryFromOutcome} onCheckStatus={recheckPending} onStopWatching={stopWatching} />
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
              {/* The other half of P2-8: we could not READ it. Not the same thing as it having
                  changed, and not the person's doing. */}
              {confirmPhase === "unreadable" ? (
                <p className="seeker-tool-note seeker-passgate-err" role="alert">{t("Could not read your balance just now, so nothing was signed. Try again in a moment.")}</p>
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
