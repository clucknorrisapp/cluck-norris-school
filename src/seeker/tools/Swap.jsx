// Cluck Norris — Seeker app, Swap pane (docs/SEEKER_SWAP_DESIGN.md — registry id "swap").
//
// Signs and sends. Every transaction goes through src/seeker/sign.js's signSendConfirm() — the
// app's one signing seam (confirmation-err-first, three outcomes, live-pubkey re-read, message-
// byte diff, connected-wallet-signs-first). This file does not re-implement any of that.
//
// ⚠️ THE TRANSACTION IS A VERSIONED TRANSACTION (v0, address lookup tables), not the legacy
// `Transaction` every other signing pane here builds. `build()` below does not construct
// anything — it just deserializes the bytes the server already built and returns them; the
// blockhash/owner arguments signSendConfirm() normally hands `build()` are unused on purpose,
// because Jupiter's transaction already carries its own blockhash. See
// docs/SEEKER_SWAP_DESIGN.md's "the one technical gap" section for what sign.js and
// cluck-wallet.js had to learn about v0 transactions before this pane could exist at all.
//
// Server — the app never calls Jupiter directly (the key, the mint allowlist and rate limiting
// all stay server-side; docs/SEEKER_SWAP_DESIGN.md "Server: the swap proxy"):
//   GET  /api/seeker/swap/config
//     200 { ok:true, mints:[{symbol,mint,decimals}], defaultIn, defaultOut,
//           slippageBpsOptions:[…], defaultSlippageBps, platformFeeBps }
//   GET  /api/seeker/swap/quote?inputMint=&outputMint=&amount=&slippageBps=
//     200 { ok:true, quote:{inAmount,outAmount,otherAmountThreshold,priceImpactPct,routePlan,…},
//           quoteId }
//     400 { ok:false, error }        — bad mint/amount/slippage, the field named
//     502 { ok:false, error }        — Jupiter failed; never a fabricated quote
//   POST /api/seeker/swap/tx  { quoteId, userPublicKey }
//     200 { ok:true, swapTransaction:<base64 v0 tx>, lastValidBlockHeight, inputMint, outputMint,
//           inAmount, outAmount, otherAmountThreshold, priceImpactPct }   — amounts ECHOED from
//           the STORED quote, not the request, so the confirm sheet and the transaction always
//           agree
//     400 { ok:false, error }        — bad userPublicKey
//     409 { ok:false, error:"quote_expired" }  — the quoteId aged out (60s) or is unknown; the
//           pane re-quotes and reopens the sheet with fresh numbers, and never signs the old one
//     502 { ok:false, error }
//
// ⚠️ THE quoteId/userPublicKey ORDER IS LOAD-BEARING (docs/SEEKER_SWAP_DESIGN.md "review before
// merge"). `userPublicKey` sent with the tx request is the LIVE address read via
// assertSameAccount() right before that request goes out — not the address captured when the
// quote was fetched, and not read again later. If the wallet switched accounts between quoting
// and confirming, this pane finds out before ever asking Jupiter to build a transaction for the
// wrong owner.
//
// ⚠️ GUARDRAILS BEFORE POWER (AGENTS.md), not a block: a quote with priceImpactPct >= 1% renders
// an amber line; >= 5% renders in the danger style and the confirm sheet requires typing "SWAP".
// The person's call either way.
//
// ⚠️ SAY WHAT'S ON-CHAIN, NEVER WHY. This pane shows a rate, a minimum, an impact percentage and
// a fee — never "buy CLKN", never a price direction, never a chart, never a sentence about where
// a price is going or what holding something is worth doing.
//
// Balances are read ON-CHAIN through /api/helius-rpc (AGENTS.md: never a product scanner).
// getBalance for SOL; getTokenAccountsByOwner (jsonParsed) filtered by the specific mint for
// everything else — filtering by `mint` rather than iterating both token programs finds the
// right account regardless of which program owns that mint (a given mint belongs to exactly one
// of TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA / TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb),
// and every account matching that filter is summed — this app's own Airdropper pane
// (src/seeker/tools/Airdropper.jsx) reads a wallet's balance of one already-known mint the same
// way. All amounts sent to the chain or compared against a balance are base-unit STRINGS
// (BigInt), never `parseFloat * 10**decimals` (AGENTS.md).
import React from "react";
import { useSearchParams } from "react-router-dom";
import { t, tf, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, toolFetch, useOnline } from "../pane.jsx";
import { NeedsWallet } from "../needswallet.jsx";
import { signSendConfirm, assertSameAccount, rpcFn } from "../sign.js";
import "./tools.css";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTE_REFRESH_MS = 15000;
const QUOTE_STALE_MS = 60000;
const SOL_RESERVE_LAMPORTS = "10000000"; // 0.01 SOL kept back for fees when paying SOL

// No Node Buffer anywhere in this app (AGENTS.md) — plain browser primitives only.
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// BigInt-safe base-units -> plain decimal string (no thousands grouping, no rounding) — used for
// an EDITABLE amount (the Max button), where CluckUtil.rawAmount's grouping/rounding would be
// wrong to feed back into an input a person can still edit.
function rawToPlainDecimal(raw, decimals) {
  let s = String(raw == null ? "0" : raw).replace(/[^0-9]/g, "") || "0";
  if (decimals <= 0) return s.replace(/^0+(?=\d)/, "");
  s = s.padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const f = s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

// Display formatting for a quoted/base-unit amount — delegates to the shared, tested converter
// (public/cluck-util.js CluckUtil.rawAmount, string/BigInt math only, thousands-grouped) with a
// same-contract local fallback for a page where it has not loaded (matches Firepit's fmtSol note).
function fmtAmt(raw, decimals, maxFrac) {
  try {
    if (typeof window !== "undefined" && window.CluckUtil && typeof window.CluckUtil.rawAmount === "function") {
      return window.CluckUtil.rawAmount(raw, decimals, maxFrac == null ? 6 : maxFrac);
    }
  } catch (_) {}
  const plain = rawToPlainDecimal(raw, decimals);
  const parts = plain.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (parts[1] && parts[1].length > (maxFrac == null ? 6 : maxFrac)) parts[1] = parts[1].slice(0, maxFrac == null ? 6 : maxFrac);
  return parts[1] ? parts.join(".") : parts[0];
}

// Decimal-string amount input -> base-unit integer string. String math only, never
// parseFloat * 10**decimals (AGENTS.md). Rejects more fractional digits than the mint supports —
// the caller shows a form error rather than silently truncating someone's typed amount.
function toBaseUnits(input, decimals) {
  const s = String(input || "").trim();
  if (s === "" || s === ".") return { raw: null, tooManyDecimals: false };
  if (!/^\d*\.?\d*$/.test(s)) return { raw: null, tooManyDecimals: false };
  const parts = s.split(".");
  const whole = parts[0] || "0";
  const frac = parts[1] || "";
  if (frac.length > decimals) return { raw: null, tooManyDecimals: true };
  const raw = (whole + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return { raw: raw === "" ? "0" : raw, tooManyDecimals: false };
}

function isZeroRaw(raw) { return !raw || /^0*$/.test(raw); }

function cmpRaw(a, b) {
  try { const x = BigInt(a || "0"), y = BigInt(b || "0"); return x < y ? -1 : x > y ? 1 : 0; }
  catch (_) { return 0; }
}

const OUTCOME_LABEL = {
  sent: "Swapped",
  failed: "Swap failed",
  unconfirmed: "Unconfirmed",
  declined: "Declined",
};

function solscanTx(sig) {
  return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null;
}

function OutcomeCard({ o, onDismiss, onRetry }) {
  return (
    <div className={"seeker-burn-outcome seeker-burn-outcome-" + o.status} role={o.status === "failed" || o.status === "unconfirmed" ? "alert" : "status"}>
      <p className="seeker-burn-outcome-title">
        {o.status === "sent" ? "✅ " : o.status === "failed" ? "⚠️ " : o.status === "unconfirmed" ? "⏳ " : ""}
        {t(OUTCOME_LABEL[o.status])}
      </p>
      {o.status === "sent" ? (
        <>
          <p>{tf("Swapped {inAmt} {inSym} for at least {outAmt} {outSym}.", { inAmt: o.inAmt, inSym: o.inSym, outAmt: o.outAmt, outSym: o.outSym })}</p>
          {solscanTx(o.sig) ? <p><a className="seeker-listing-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
        </>
      ) : o.status === "unconfirmed" ? (
        <p>{t("This was submitted but had no on-chain status after 30 seconds. It may still have landed — check the signature before trying again.")} {solscanTx(o.sig) ? <a className="seeker-listing-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a> : null}</p>
      ) : o.status === "failed" ? (
        <p>{t("Nothing was swapped — the transaction did not land.")}{o.error ? ` ${o.error}` : ""}</p>
      ) : (
        <p>{t("You declined in your wallet — nothing was sent.")}</p>
      )}
      {o.status !== "unconfirmed" ? (
        <div className="seeker-burn-outcome-actions">
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={o.status === "failed" || o.status === "declined" ? onRetry : onDismiss}>
            {o.status === "failed" || o.status === "declined" ? t("Try again") : t("OK")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function SwapPane({ wallet }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const [params] = useSearchParams();

  const [configPhase, setConfigPhase] = React.useState("loading"); // loading | loaded | unavailable
  const [config, setConfig] = React.useState(null);
  const [inSym, setInSym] = React.useState(null);
  const [outSym, setOutSym] = React.useState(null);
  const [slippageBps, setSlippageBps] = React.useState(null);
  const [amount, setAmount] = React.useState("");
  const [formError, setFormError] = React.useState(null);

  const [balIn, setBalIn] = React.useState({ phase: "idle", raw: null }); // idle|loading|loaded|unavailable
  const [balTick, setBalTick] = React.useState(0);

  const [quote, setQuote] = React.useState(null);       // { data:{quote,quoteId}, fetchedAt }
  const [quotePhase, setQuotePhase] = React.useState("idle"); // idle|loading|loaded|unavailable|refused
  const [quoteErr, setQuoteErr] = React.useState(null);

  const [confirmPhase, setConfirmPhase] = React.useState("idle"); // idle|checking|ready|expired|error
  const [confirmData, setConfirmData] = React.useState(null); // the frozen quote used to open the sheet
  const [confirmNote, setConfirmNote] = React.useState(null);

  const [swapping, setSwapping] = React.useState(false);
  const [outcome, setOutcome] = React.useState(null);

  const quoteAbortRef = React.useRef(null);

  // ── config: load once, mints/defaults/slippage options ─────────────────────────────────────
  const loadConfig = React.useCallback(() => {
    setConfigPhase("loading");
    toolFetch("/api/seeker/swap/config").then((res) => {
      if (!res.ok) { setConfigPhase("unavailable"); return; }
      const cfg = res.data;
      setConfig(cfg);
      // ?in=/?out= preselect by symbol (docs/SEEKER_SWAP_DESIGN.md, the pass sheet's SKR line
      // links here). Falls back to the config's own defaults when absent or unknown.
      const mints = cfg.mints || [];
      const has = (s) => mints.some((m) => m.symbol === s);
      const qIn = (params.get("in") || "").toUpperCase();
      const qOut = (params.get("out") || "").toUpperCase();
      setInSym(has(qIn) ? qIn : cfg.defaultIn);
      setOutSym(has(qOut) ? qOut : cfg.defaultOut);
      setSlippageBps(cfg.defaultSlippageBps);
      setConfigPhase("loaded");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, []);
  React.useEffect(() => { loadConfig(); }, [loadConfig]);

  const mints = (config && config.mints) || [];
  const bySym = React.useMemo(() => {
    const m = {};
    mints.forEach((x) => { m[x.symbol] = x; });
    return m;
  }, [mints]);
  const inMint = inSym ? bySym[inSym] : null;
  const outMint = outSym ? bySym[outSym] : null;

  // ── balance of the PAY mint, on-chain ───────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!wallet.connected || !wallet.address || !inMint) { setBalIn({ phase: "idle", raw: null }); return undefined; }
    let live = true;
    setBalIn({ phase: "loading", raw: null });
    const rpc = rpcFn();
    (async () => {
      try {
        let raw;
        if (inMint.mint === NATIVE_SOL_MINT) {
          const b = await rpc("getBalance", [wallet.address]);
          raw = (b && typeof b.value === "number") ? String(b.value) : "0";
        } else {
          const accts = await rpc("getTokenAccountsByOwner", [wallet.address, { mint: inMint.mint }, { encoding: "jsonParsed" }]);
          const list = (accts && accts.value) || [];
          let sum = 0n;
          for (const a of list) {
            const amt = a && a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info
              && a.account.data.parsed.info.tokenAmount && a.account.data.parsed.info.tokenAmount.amount;
            if (typeof amt === "string" && /^[0-9]+$/.test(amt)) sum += BigInt(amt);
          }
          raw = sum.toString();
        }
        if (live) setBalIn({ phase: "loaded", raw });
      } catch (_) {
        if (live) setBalIn({ phase: "unavailable", raw: null });
      }
    })();
    return () => { live = false; };
  }, [wallet.connected, wallet.address, inMint && inMint.mint, balTick]);

  // ── amount -> base units, validated against the mint's own decimals ────────────────────────
  const amountConv = inMint ? toBaseUnits(amount, inMint.decimals) : { raw: null, tooManyDecimals: false };
  const amountRaw = amountConv.raw;
  React.useEffect(() => {
    setFormError(amountConv.tooManyDecimals && inSym ? tf("That's more decimal places than {sym} supports.", { sym: inSym }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, inSym]);

  const overBalance = balIn.phase === "loaded" && amountRaw && !isZeroRaw(amountRaw) && cmpRaw(amountRaw, balIn.raw) > 0;

  // ── quote: fetch + 15s refresh while an amount is present and the pane is mounted ───────────
  const fetchQuoteNow = React.useCallback(async () => {
    if (!inMint || !outMint || !amountRaw || isZeroRaw(amountRaw) || slippageBps == null) return null;
    if (inMint.mint === outMint.mint) return null;
    try { quoteAbortRef.current && quoteAbortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    quoteAbortRef.current = ctrl;
    const url = `/api/seeker/swap/quote?inputMint=${encodeURIComponent(inMint.mint)}&outputMint=${encodeURIComponent(outMint.mint)}&amount=${encodeURIComponent(amountRaw)}&slippageBps=${encodeURIComponent(slippageBps)}`;
    const res = await toolFetch(url, { signal: ctrl.signal });
    if (res.kind === "aborted") return null;
    return res;
  }, [inMint, outMint, amountRaw, slippageBps]);

  React.useEffect(() => {
    if (!inMint || !outMint || inMint.mint === outMint.mint) { setQuote(null); setQuotePhase("idle"); return undefined; }
    if (!amountRaw || isZeroRaw(amountRaw)) { setQuote(null); setQuotePhase("idle"); return undefined; }
    let cancelled = false;
    async function run() {
      setQuotePhase((p) => (p === "loaded" ? "loaded" : "loading"));
      const res = await fetchQuoteNow();
      if (cancelled || !res) return;
      if (res.ok) {
        setQuote({ data: res.data, fetchedAt: Date.now() });
        setQuotePhase("loaded");
        setQuoteErr(null);
      } else if (res.kind === "refused") {
        setQuote(null); setQuotePhase("refused");
        setQuoteErr((res.body && res.body.error) || t("That amount or pair wasn't something we could use."));
      } else if (res.kind === "offline") {
        setQuote(null); setQuotePhase("unavailable"); setQuoteErr(null);
      } else {
        setQuote(null); setQuotePhase("unavailable"); setQuoteErr(null);
      }
    }
    run();
    const iv = setInterval(run, QUOTE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(iv); try { quoteAbortRef.current && quoteAbortRef.current.abort(); } catch (_) {} };
  }, [inMint, outMint, amountRaw, slippageBps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wallet.connected) {
    return (
      <Pane icon="🔁" title="Swap">
        <p className="seeker-tool-lede">{t("Swap SOL, SKR, CLKN and USDC in this app. Every quote shows the rate, the minimum you receive and the price impact before you sign. Non-custodial — you sign, we take nothing.")}</p>
        <NeedsWallet why="Connect your wallet to get a quote and swap." wallet={wallet} />
      </Pane>
    );
  }

  function flip() {
    if (!inSym || !outSym) return;
    setInSym(outSym);
    setOutSym(inSym);
    setQuote(null);
    setQuotePhase("idle");
  }

  function onMax() {
    if (!inMint || balIn.phase !== "loaded" || balIn.raw == null) return;
    let raw = balIn.raw;
    if (inMint.mint === NATIVE_SOL_MINT) {
      raw = cmpRaw(raw, SOL_RESERVE_LAMPORTS) > 0 ? (BigInt(raw) - BigInt(SOL_RESERVE_LAMPORTS)).toString() : "0";
    }
    setAmount(rawToPlainDecimal(raw, inMint.decimals));
  }

  // ── open the confirm sheet with a FRESH quote (re-fetched if stale) ─────────────────────────
  async function openReview() {
    if (!quote) return;
    setConfirmPhase("checking");
    setConfirmNote(null);
    let q = quote;
    if (Date.now() - quote.fetchedAt > QUOTE_STALE_MS) {
      const res = await fetchQuoteNow();
      if (!res || !res.ok) { setConfirmPhase("error"); return; }
      q = { data: res.data, fetchedAt: Date.now() };
      setQuote(q);
    }
    setConfirmData(q);
    setConfirmPhase("ready");
  }
  function cancelConfirm() { setConfirmPhase("idle"); setConfirmData(null); setConfirmNote(null); }

  // ── confirm + sign ───────────────────────────────────────────────────────────────────────────
  async function onConfirmed() {
    const q = confirmData;
    setConfirmPhase("idle");
    setConfirmData(null);
    if (!q) return;
    setSwapping(true);
    setOutcome(null);

    let live;
    try {
      live = assertSameAccount(wallet.provider, wallet.address);
    } catch (e) {
      setSwapping(false);
      setOutcome({ status: "failed", error: (e && e.message) || String(e) });
      return;
    }

    // The transaction is requested with the LIVE address, right now — not the one captured at
    // quote time (docs/SEEKER_SWAP_DESIGN.md).
    let r, body = null;
    try {
      r = await fetch("/api/seeker/swap/tx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: q.data.quoteId, userPublicKey: live }),
      });
      body = await r.json().catch(() => null);
    } catch (_) {
      setSwapping(false);
      setOutcome({ status: "failed", error: t("Could not reach the swap service.") });
      return;
    }

    if (r.status === 409) {
      // The quote expired server-side between opening the sheet and confirming — re-quote and
      // reopen with fresh numbers. Never sign against the stale one.
      const res = await fetchQuoteNow();
      setSwapping(false);
      if (res && res.ok) {
        const fresh = { data: res.data, fetchedAt: Date.now() };
        setQuote(fresh);
        setConfirmData(fresh);
        setConfirmNote(t("That quote had expired — here are the current numbers. Review before continuing."));
        setConfirmPhase("ready");
      } else {
        setQuotePhase("unavailable");
        setOutcome({ status: "failed", error: t("The quote expired and a fresh one could not be fetched. Try again.") });
      }
      return;
    }
    if (!r.ok || !body || !body.ok) {
      setSwapping(false);
      setOutcome({ status: "failed", error: (body && body.error) || t("The swap service refused this request.") });
      return;
    }

    const swapTransaction = body.swapTransaction;
    const res = await signSendConfirm({
      provider: wallet.provider,
      owner: wallet.address,
      // The blockhash/owner arguments are unused — the server-built v0 transaction carries its
      // own blockhash already (docs/SEEKER_SWAP_DESIGN.md).
      build: (web3) => web3.VersionedTransaction.deserialize(base64ToBytes(swapTransaction)),
    });

    const inAmt = fmtAmt(body.inAmount, inMint.decimals);
    const outAmt = fmtAmt(body.otherAmountThreshold, outMint.decimals);
    const base = { inSym, outSym, inAmt, outAmt };
    if (res.status === "sent") {
      setOutcome({ ...base, status: "sent", sig: res.sig });
      setBalTick((n) => n + 1); // re-read balances now that the swap landed
    } else if (res.status === "unconfirmed") {
      setOutcome({ ...base, status: "unconfirmed", sig: res.sig });
    } else if (res.status === "declined") {
      setOutcome({ ...base, status: "declined" });
    } else {
      setOutcome({ ...base, status: "failed", error: res.error });
    }
    setSwapping(false);
  }

  function dismissOutcome() { setOutcome(null); }
  function retryFromOutcome() { setOutcome(null); }

  // ── derived quote figures ───────────────────────────────────────────────────────────────────
  const qd = quote && quote.data && quote.data.quote;
  const impactPct = qd && qd.priceImpactPct != null ? Number(qd.priceImpactPct) * 100 : null;
  const impactWarn = impactPct != null && isFinite(impactPct) && impactPct >= 1;
  const impactDanger = impactPct != null && isFinite(impactPct) && impactPct >= 5;
  const rate = qd && inMint && outMint
    ? (Number(qd.outAmount) / Math.pow(10, outMint.decimals)) / (Number(qd.inAmount) / Math.pow(10, inMint.decimals))
    : null;
  const hops = qd && Array.isArray(qd.routePlan) ? qd.routePlan.length : null;
  const feeBps = config && config.platformFeeBps;

  const cq = confirmData && confirmData.data && confirmData.data.quote;
  const cImpactPct = cq && cq.priceImpactPct != null ? Number(cq.priceImpactPct) * 100 : null;
  const cDanger = cImpactPct != null && isFinite(cImpactPct) && cImpactPct >= 5;
  const confirmLines = cq && inMint && outMint ? [
    <span key="p">{tf("Pay {amt} {sym}", { amt: fmtAmt(cq.inAmount, inMint.decimals), sym: inSym })}</span>,
    <span key="r">{tf("Receive at least {amt} {sym}", { amt: fmtAmt(cq.otherAmountThreshold, outMint.decimals), sym: outSym })}</span>,
    <span key="i">{tf("Price impact: {pct}%", { pct: (Number(cq.priceImpactPct) * 100).toFixed(2) })}</span>,
    <span key="s">{tf("Slippage: {pct}%", { pct: (slippageBps / 100).toFixed(2) })}</span>,
    feeBps ? <span key="f">{tf("Platform fee: {pct}%", { pct: (feeBps / 100).toFixed(2) })}</span> : null,
  ].filter(Boolean) : [];

  const canReview = !!(quote && quotePhase === "loaded" && amountRaw && !isZeroRaw(amountRaw) && !overBalance && online && confirmPhase !== "checking" && !swapping);

  return (
    <Pane icon="🔁" title="Swap">
      <p className="seeker-tool-lede">{t("Swap SOL, SKR, CLKN and USDC in this app. Every quote shows the rate, the minimum you receive and the price impact before you sign. Non-custodial — you sign, we take nothing.")}</p>

      {configPhase === "loading" ? <Loading label={t("Loading swap terms…")} /> : null}
      {configPhase === "unavailable" ? <Unavailable kind={online ? "unavailable" : "offline"} onRetry={loadConfig} /> : null}

      {configPhase === "loaded" && config ? (
        <div className="seeker-swap-form">
          {swapping ? <Loading label={t("Approve the swap in your wallet…")} /> : null}
          {outcome ? <OutcomeCard o={outcome} onDismiss={dismissOutcome} onRetry={retryFromOutcome} /> : null}

          {!swapping ? (
            <>
              <div className="seeker-swap-row">
                <div className="seeker-swap-rowhead">
                  <label className="seeker-listing-label" htmlFor="swap-pay-mint">{t("Pay")}</label>
                  {inMint ? (
                    <span className="seeker-tool-note">
                      {balIn.phase === "loading" ? t("Reading balance…") : null}
                      {balIn.phase === "unavailable" ? t("Balance unavailable") : null}
                      {balIn.phase === "loaded" ? <>{t("Balance")}: {fmtAmt(balIn.raw, inMint.decimals)} {inSym}</> : null}
                    </span>
                  ) : null}
                </div>
                <div className="seeker-swap-amountrow">
                  <input
                    id="swap-pay-amount"
                    className="seeker-listing-input seeker-swap-amountinput"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    aria-label={t("Amount to pay")}
                  />
                  <select
                    id="swap-pay-mint"
                    className="seeker-listing-input seeker-swap-picker"
                    value={inSym || ""}
                    onChange={(e) => { setOutSym((o) => (o === e.target.value ? inSym : o)); setInSym(e.target.value); setQuote(null); setQuotePhase("idle"); }}
                    aria-label={t("Token to pay with")}
                  >
                    {mints.map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                  </select>
                </div>
                <button type="button" className="seeker-btn seeker-btn-quiet seeker-swap-maxbtn" disabled={balIn.phase !== "loaded"} onClick={onMax}>{t("Max")}</button>
                {overBalance ? <p className="seeker-listing-formerror">{tf("You only hold {bal} {sym}.", { bal: fmtAmt(balIn.raw, inMint.decimals), sym: inSym })}</p> : null}
                {formError ? <p className="seeker-listing-formerror">{formError}</p> : null}
              </div>

              <button type="button" className="seeker-btn seeker-btn-quiet seeker-swap-flip" onClick={flip} aria-label={t("Swap the pay and receive tokens")}>⇅</button>

              <div className="seeker-swap-row">
                <label className="seeker-listing-label" htmlFor="swap-receive-mint">{t("Receive")}</label>
                <div className="seeker-swap-amountrow">
                  <div className="seeker-swap-receiveamount" aria-live="polite">
                    {qd && outMint ? fmtAmt(qd.outAmount, outMint.decimals) : "0"}
                  </div>
                  <select
                    id="swap-receive-mint"
                    className="seeker-listing-input seeker-swap-picker"
                    value={outSym || ""}
                    onChange={(e) => { setInSym((i) => (i === e.target.value ? outSym : i)); setOutSym(e.target.value); setQuote(null); setQuotePhase("idle"); }}
                    aria-label={t("Token to receive")}
                  >
                    {mints.map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                  </select>
                </div>
              </div>

              {inSym && outSym && inSym === outSym ? <p className="seeker-listing-formerror">{t("Pick two different tokens.")}</p> : null}

              {quotePhase === "loading" && !quote ? <Loading label={t("Getting a quote…")} /> : null}
              {quotePhase === "unavailable" ? <Unavailable kind={online ? "unavailable" : "offline"} onRetry={() => fetchQuoteNow().then((res) => { if (res && res.ok) { setQuote({ data: res.data, fetchedAt: Date.now() }); setQuotePhase("loaded"); } })} /> : null}
              {quotePhase === "refused" ? <Refused message={quoteErr} /> : null}

              {qd && inMint && outMint && quotePhase === "loaded" ? (
                <div className="seeker-listing-card seeker-swap-quotecard">
                  <dl className="seeker-listing-facts">
                    <div><dt>{t("Rate")}</dt><dd>{rate != null && isFinite(rate) ? `1 ${inSym} ≈ ${rate < 0.000001 ? rate.toExponential(2) : rate.toPrecision(6)} ${outSym}` : "—"}</dd></div>
                    <div><dt>{t("Minimum received")}</dt><dd>{fmtAmt(qd.otherAmountThreshold, outMint.decimals)} {outSym}</dd></div>
                    <div><dt>{t("Price impact")}</dt><dd>{impactPct != null && isFinite(impactPct) ? `${impactPct.toFixed(2)}%` : "—"}</dd></div>
                    <div><dt>{t("Hops")}</dt><dd>{hops != null ? hops : "—"}</dd></div>
                    {feeBps ? <div><dt>{t("Platform fee")}</dt><dd>{(feeBps / 100).toFixed(2)}%</dd></div> : null}
                  </dl>

                  <label className="seeker-listing-label" htmlFor="swap-slippage">{t("Slippage")}</label>
                  <div id="swap-slippage" className="seeker-swap-slippage">
                    {(config.slippageBpsOptions || []).map((bps) => (
                      <button
                        key={bps}
                        type="button"
                        className={"seeker-swap-slippage-chip" + (slippageBps === bps ? " active" : "")}
                        onClick={() => setSlippageBps(bps)}
                        aria-pressed={slippageBps === bps}
                      >
                        {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                      </button>
                    ))}
                  </div>

                  {impactWarn ? (
                    <p className={"seeker-listing-fixfirst" + (impactDanger ? " seeker-swap-impact-danger" : "")}>
                      {tf("This trade moves the price by {pct}%.", { pct: impactPct.toFixed(2) })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {confirmPhase === "checking" ? <Loading label={t("Getting the latest quote before you sign…")} /> : null}
              {confirmPhase === "error" ? <p className="seeker-listing-formerror" role="alert">{t("Could not get a fresh quote. Try again.")}</p> : null}

              <button type="button" className="seeker-btn seeker-listing-runbtn" disabled={!canReview} onClick={openReview}>{t("Review swap")}</button>
            </>
          ) : null}
        </div>
      ) : null}

      <Confirm
        open={confirmPhase === "ready"}
        title="Confirm swap"
        lines={confirmNote ? [<span key="note" className="seeker-tool-note">{confirmNote}</span>, ...confirmLines] : confirmLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger={cDanger}
        typeToConfirm={cDanger ? "SWAP" : null}
      />
    </Pane>
  );
}
