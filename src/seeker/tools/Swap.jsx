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
import { Pane, Loading, Unavailable, Refused, Confirm, toolFetch, useOnline } from "../pane.jsx";
import { NeedsWallet } from "../needswallet.jsx";
import { signSendConfirm, assertSameAccount, rpcFn, checkPendingSwap } from "../sign.js";
import { verifySwapTransaction } from "../swap-verify.js";
import "./tools.css";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTE_REFRESH_MS = 15000;
const QUOTE_STALE_MS = 60000;
const SOL_RESERVE_LAMPORTS = "10000000"; // 0.01 SOL kept back for fees when paying SOL
// Fix round P3: the pane debounces its own quote requests by 400ms (typing several digits into
// the amount box should not fire one request per keystroke) — server-side, the quote route also
// gained its own 30/min-per-IP floor independent of that.
const QUOTE_DEBOUNCE_MS = 400;
// Fix round P2-2: an "unconfirmed" result is persisted so navigating away and back (or the app
// being backgrounded) resumes the check instead of losing it — never resolved by guessing, only
// by a real getSignatureStatuses/getBlockHeight read.
const PENDING_STORAGE_KEY = "seekerSwapPendingTx";
const PENDING_POLL_MS = 3000;
// ⚠️ Codex round 30 P2 — "the displayed fee is from a different transaction than the one
// signed." `/tx` used to be called TWICE per swap: once (best-effort) when the sheet opened, to
// show a fee estimate, and again (for real) inside onConfirmed with whatever the live address
// happened to be at that moment — two separate Jupiter builds, each with its own priority fee and
// its own `lastValidBlockHeight`, so the number the sheet showed was never provably the number in
// the transaction actually signed. Now `/tx` is called exactly ONCE, when the sheet opens, and
// that SAME response is what gets signed. If more than this many ms pass before the person
// confirms, or the wallet's live address moved, the flow re-fetches and re-renders the sheet with
// the new numbers instead of ever signing something the sheet didn't show.
const CONFIRM_TX_TTL_MS = 45000;

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

// P2-2, the SOL-paying "Max"/over-balance figure: 0.01 SOL is always kept back for fees, so the
// spendable cap on a SOL pay-leg is the balance MINUS the reserve, never the raw balance.
function spendableCap(mint, rawBalance) {
  if (!mint || rawBalance == null) return rawBalance;
  if (mint.mint !== NATIVE_SOL_MINT) return rawBalance;
  return cmpRaw(rawBalance, SOL_RESERVE_LAMPORTS) > 0 ? (BigInt(rawBalance) - BigInt(SOL_RESERVE_LAMPORTS)).toString() : "0";
}

function solscanTx(sig) {
  return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(String(sig || "")) ? `https://solscan.io/tx/${sig}` : null;
}

// ⚠️ Fix round P3: these titles used to be `t(OUTCOME_LABEL[o.status])` — a COMPUTED lookup the
// key extractor (scripts/seeker-i18n-keys.cjs) cannot see, since it only recognises literal
// t("…")/tf("…", …) call sites. Written out as literal calls below so "Swapped" / "Swap failed" /
// "Unconfirmed" / "Expired" / "Declined" all reach the six translated dictionaries.
function outcomeTitle(status) {
  if (status === "sent") return t("Swapped");
  if (status === "failed") return t("Swap failed");
  if (status === "expired") return t("Expired");
  if (status === "declined") return t("Declined");
  return t("Unconfirmed");
}

function OutcomeCard({ o, onDismiss, onRetry }) {
  return (
    <div className={"seeker-burn-outcome seeker-burn-outcome-" + o.status} role={o.status === "failed" || o.status === "expired" ? "alert" : "status"}>
      <p className="seeker-burn-outcome-title">
        {o.status === "sent" ? "✅ " : o.status === "failed" ? "⚠️ " : o.status === "expired" ? "⏱️ " : ""}
        {outcomeTitle(o.status)}
      </p>
      {o.status === "sent" ? (
        <>
          <p>{tf("Swapped {inAmt} {inSym} for at least {outAmt} {outSym}.", { inAmt: o.inAmt, inSym: o.inSym, outAmt: o.outAmt, outSym: o.outSym })}</p>
          {solscanTx(o.sig) ? <p><a className="seeker-listing-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
        </>
      ) : o.status === "failed" ? (
        // P3: two different sentences depending on whether the transaction actually landed and
        // then failed on-chain (a fee was charged) or never landed at all (nothing was charged).
        // sign.js's confirmSignature() and this pane's own resumed-poll code both prefix an
        // on-chain failure's message with "failed on-chain" — see the checks below.
        <>
          <p>
            {o.error && /^failed on-chain/i.test(o.error)
              ? t("The transaction landed but failed on-chain — nothing was swapped; a network fee was charged.")
              : t("The transaction did not land — nothing was swapped.")}
            {o.error ? ` ${o.error}` : ""}
          </p>
          {solscanTx(o.sig) ? <p><a className="seeker-listing-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
        </>
      ) : o.status === "expired" ? (
        <p>{t("This did not land before its expiry block height passed — it's safe to try again.")} {solscanTx(o.sig) ? <a className="seeker-listing-link" href={solscanTx(o.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a> : null}</p>
      ) : (
        <p>{t("You declined in your wallet — nothing was sent.")}</p>
      )}
      <div className="seeker-burn-outcome-actions">
        <button type="button" className="seeker-btn seeker-btn-quiet" onClick={o.status === "failed" || o.status === "declined" || o.status === "expired" ? onRetry : onDismiss}>
          {o.status === "failed" || o.status === "declined" || o.status === "expired" ? t("Try again") : t("OK")}
        </button>
      </div>
    </div>
  );
}

// The "checking" card shown WHILE an unconfirmed signature is still being polled — the form stays
// locked and there is no retry button here, only the signature and a live status line (P2-2).
function PendingCard({ p }) {
  return (
    <div className="seeker-burn-outcome seeker-burn-outcome-unconfirmed" role="status">
      <p className="seeker-burn-outcome-title">⏳ {outcomeTitle("unconfirmed")}</p>
      <p>{t("Checking…")} {tf("Submitted {inAmt} {inSym} → {outSym}.", { inAmt: p.inAmt || "—", inSym: p.inSym || "", outSym: p.outSym || "" })}</p>
      {solscanTx(p.sig) ? <p><a className="seeker-listing-link" href={solscanTx(p.sig)} target="_blank" rel="noopener noreferrer">{t("View transaction on Solscan")}</a></p> : null}
    </div>
  );
}

// ── localStorage persistence for an in-flight "unconfirmed" swap (P2-2) ──────────────────────
function loadPending() {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.sig || !p.wallet) return null;
    return p;
  } catch (_) { return null; }
}
function savePending(p) {
  try { window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
}
function clearPendingStorage() {
  try { window.localStorage.removeItem(PENDING_STORAGE_KEY); } catch (_) {}
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
  // Round 30 P2 fix — confirmData now carries the SINGLE /tx build the sheet shows AND the one
  // that gets signed: { data:{quote,quoteId}, fetchedAt, tx:<the /tx response>, builtAt, builtFor }.
  // `data`/`fetchedAt` keep the same shape `quote` itself uses so every existing `confirmData.data.quote`
  // read below is unchanged.
  const [confirmData, setConfirmData] = React.useState(null);
  const [confirmNote, setConfirmNote] = React.useState(null);

  const [swapping, setSwapping] = React.useState(false);
  const [outcome, setOutcome] = React.useState(null);

  // P2-2: an in-flight "unconfirmed" signature — while this is set the whole form is locked (no
  // amount/picker/flip/slippage/review) and a background poll (getSignatureStatuses +
  // getBlockHeight) resolves it into sent/failed/expired. Persisted so leaving and returning to
  // the pane (or the app being backgrounded) resumes the same check instead of losing it.
  const [pending, setPending] = React.useState(null); // { sig, lastValidBlockHeight, wallet, at, inSym, outSym, inAmt, outAmt }
  const [outAtaExists, setOutAtaExists] = React.useState(null); // null unknown | true | false

  const quoteAbortRef = React.useRef(null);

  // ── resume a pending swap from localStorage on mount / wallet change (P2-2) ────────────────
  React.useEffect(() => {
    if (!wallet.connected || !wallet.address) return;
    const saved = loadPending();
    if (saved && saved.wallet === wallet.address) setPending(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address]);

  // ── poll a pending signature every 3s: getSignatureStatuses AND getBlockHeight (P2-2) ──────
  React.useEffect(() => {
    if (!pending) return undefined;
    let stopped = false;
    async function resolvePending(extra) {
      if (stopped) return;
      stopped = true;
      clearPendingStorage();
      setPending(null);
      setSwapping(false);
      setOutcome({ status: extra.status, error: extra.error, sig: pending.sig, inSym: pending.inSym, outSym: pending.outSym, inAmt: pending.inAmt, outAmt: pending.outAmt });
    }
    async function checkOnce() {
      if (stopped) return;
      // checkPendingSwap lives in sign.js — the ONE signing seam — not here (P2-2's poll still
      // has to go through the seam's err-before-confirmationStatus rule; scripts/seeker-build-test.cjs
      // pins that no pane calls getSignatureStatuses directly).
      const result = await checkPendingSwap(rpcFn(), { signature: pending.sig, lastValidBlockHeight: pending.lastValidBlockHeight });
      if (result.status === "pending") return; // keep polling
      await resolvePending(result);
    }
    checkOnce();
    const iv = setInterval(checkOnce, PENDING_POLL_MS);
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending && pending.sig]);

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

  // P2 P3: for a SOL pay-leg, 0.01 SOL is reserved for fees — the spendable cap is the balance
  // minus that reserve, never the raw balance (spendableCap() is a no-op for any other mint).
  const overBalance = balIn.phase === "loaded" && amountRaw && !isZeroRaw(amountRaw) && cmpRaw(amountRaw, spendableCap(inMint, balIn.raw)) > 0;

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
    // ⚠️ P2-3: the moment the amount, either mint, or the slippage chip changes (this effect's own
    // deps), the OLD quote is no longer valid for what's on screen now — stop showing its numbers
    // and disable review (canReview requires quotePhase==="loaded") until a fresh one lands. This
    // runs once per DEPENDENCY change, never on the periodic 15s auto-refresh below (that reuses
    // the same `run()` via setInterval without re-entering this block), so the silent background
    // refresh still avoids flicker via the functional setQuotePhase inside run().
    setQuote(null);
    setQuotePhase("loading");
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
    // P3: debounce the pane's own quote requests by 400ms — typing several digits should fire one
    // request, not one per keystroke. The periodic 15s refresh is a separate timer, unaffected.
    const debounceTimer = setTimeout(run, QUOTE_DEBOUNCE_MS);
    const iv = setInterval(run, QUOTE_REFRESH_MS);
    return () => { cancelled = true; clearTimeout(debounceTimer); clearInterval(iv); try { quoteAbortRef.current && quoteAbortRef.current.abort(); } catch (_) {} };
  }, [inMint, outMint, amountRaw, slippageBps]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── does the RECEIVE mint's ATA already exist? checked whenever a fresh quote lands (P3: the
  // confirm sheet's "Network cost" line needs to know before the sheet opens) ──────────────────
  React.useEffect(() => {
    let live = true;
    if (!quote || !outMint || !wallet.address) { setOutAtaExists(null); return undefined; }
    if (outMint.mint === NATIVE_SOL_MINT) { setOutAtaExists(true); return undefined; } // native SOL never needs an ATA
    (async () => {
      try {
        const rpc = rpcFn();
        const accts = await rpc("getTokenAccountsByOwner", [wallet.address, { mint: outMint.mint }, { encoding: "jsonParsed" }]);
        const list = (accts && accts.value) || [];
        if (live) setOutAtaExists(list.length > 0);
      } catch (_) { if (live) setOutAtaExists(null); }
    })();
    return () => { live = false; };
  }, [quote, outMint && outMint.mint, wallet.address]);

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
    let raw = spendableCap(inMint, balIn.raw);
    setAmount(rawToPlainDecimal(raw, inMint.decimals));
  }

  // ── build the ONE /tx response the sheet shows AND the one that gets signed (round 30 fix 6) ──
  // Throws { code:409 } when the quoteId aged out server-side, or a plain Error otherwise. The
  // LIVE address is re-read (assertSameAccount) right before the request goes out every time this
  // runs — at sheet-open time here, and again in onConfirmed if a refresh is needed there.
  async function buildConfirmData(q) {
    const live = assertSameAccount(wallet.provider, wallet.address);
    const r = await fetch("/api/seeker/swap/tx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: q.data.quoteId, userPublicKey: live }),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 409) { const e = new Error("quote_expired"); e.code = 409; throw e; }
    if (!r.ok || !body || !body.ok) { const e = new Error((body && body.error) || "swap_unavailable"); e.code = r.status; throw e; }
    return { data: q.data, fetchedAt: q.fetchedAt, tx: body, builtAt: Date.now(), builtFor: live };
  }

  // ── open the confirm sheet with a FRESH quote (re-fetched if stale) AND the ONE /tx build that
  // will be signed — round 30 fix 6: this used to be fetched again, separately, at confirm time,
  // so the fee/expiry the sheet showed could differ from what actually got signed. ─────────────
  async function openReview() {
    if (!quote || pending) return;
    setConfirmPhase("checking");
    setConfirmNote(null);
    let q = quote;
    if (Date.now() - quote.fetchedAt > QUOTE_STALE_MS) {
      const res = await fetchQuoteNow();
      if (!res || !res.ok) { setConfirmPhase("error"); return; }
      q = { data: res.data, fetchedAt: Date.now() };
      setQuote(q);
    }
    try {
      const cd = await buildConfirmData(q);
      setConfirmData(cd);
      setConfirmPhase("ready");
    } catch (e) {
      if (e && e.code === 409) {
        const res = await fetchQuoteNow();
        if (res && res.ok) {
          const fresh = { data: res.data, fetchedAt: Date.now() };
          setQuote(fresh);
          try {
            const cd = await buildConfirmData(fresh);
            setConfirmData(cd);
            setConfirmPhase("ready");
            return;
          } catch (_) { /* fall through to error */ }
        }
      }
      setConfirmPhase("error");
    }
  }
  function cancelConfirm() { setConfirmPhase("idle"); setConfirmData(null); setConfirmNote(null); }

  // ── confirm + sign ───────────────────────────────────────────────────────────────────────────
  async function onConfirmed() {
    const cd = confirmData;
    setConfirmPhase("idle");
    if (!cd) return;

    // ⚠️ Round 30 fix 6: NEVER sign a transaction whose numbers the sheet did not show. If too
    // much time passed since /tx was built, or the wallet's live address moved since then,
    // re-fetch and re-OPEN the sheet with the fresh numbers instead of silently signing stale
    // ones — the person reviews again before anything is sent to their wallet.
    let live;
    try { live = assertSameAccount(wallet.provider, wallet.address); }
    catch (e) { setOutcome({ status: "failed", error: (e && e.message) || String(e) }); return; }
    const stale = Date.now() - cd.builtAt > CONFIRM_TX_TTL_MS;
    if (stale || live !== cd.builtFor) {
      setConfirmPhase("checking");
      try {
        const fresh = await buildConfirmData(cd);
        setConfirmData(fresh);
        setConfirmNote(t("That quote's numbers had aged — here are the current ones. Review before continuing."));
        setConfirmPhase("ready");
      } catch (e) {
        if (e && e.code === 409) {
          const res = await fetchQuoteNow();
          if (res && res.ok) {
            const fresh2 = { data: res.data, fetchedAt: Date.now() };
            setQuote(fresh2);
            try {
              const cd2 = await buildConfirmData(fresh2);
              setConfirmData(cd2);
              setConfirmNote(t("That quote had expired — here are the current numbers. Review before continuing."));
              setConfirmPhase("ready");
              return;
            } catch (_) { /* fall through */ }
          }
        }
        setConfirmData(null);
        setOutcome({ status: "failed", error: t("The quote expired and a fresh one could not be fetched. Try again.") });
      }
      return;
    }

    setConfirmData(null);
    setSwapping(true);
    setOutcome(null);

    const body = cd.tx;
    const swapTransaction = body.swapTransaction;
    // ⚠️ P2-1: the quote object the person was actually SHOWN (from the confirm sheet,
    // `cd.data.quote`) — verifySwapTransaction() compares this against the bytes of the route
    // instruction Jupiter built, not against anything the server merely SAYS about it.
    const shownQuote = cd && cd.data && cd.data.quote;
    const inAmt = fmtAmt(body.inAmount, inMint.decimals);
    const outAmt = fmtAmt(body.otherAmountThreshold, outMint.decimals);
    const res = await signSendConfirm({
      provider: wallet.provider,
      owner: wallet.address,
      // The blockhash argument is unused — the server-built v0 transaction carries its own
      // blockhash already (docs/SEEKER_SWAP_DESIGN.md). `freshLive` IS used: it's the address
      // signSendConfirm's OWN assertSameAccount() re-reads immediately before calling build(),
      // even fresher than the `live` this function closed over above.
      build: (web3, _blockhash, freshLive) => {
        const deserialized = web3.VersionedTransaction.deserialize(base64ToBytes(swapTransaction));
        // ⚠️ P2-1 / round 30: structurally verify BEFORE this is ever handed to the wallet to
        // sign, against the freshest possible re-read of the connected address — never a cached
        // one — and against the SAME priority-fee ceiling this sheet displayed
        // (body.prioritizationFeeLamports, round 30 fix 6). Throwing here is caught by
        // signSendConfirm and reported as "failed" with this sentence; nothing is ever signed on
        // a mismatch.
        const check = verifySwapTransaction({
          tx: deserialized, liveAddress: freshLive || live, quote: shownQuote,
          PublicKeyClass: web3.PublicKey, maxPriorityFeeLamports: body.prioritizationFeeLamports,
        });
        if (!check.ok) throw new Error(check.reason);
        return deserialized;
      },
      // ⚠️ Round 30 fix 3 — persist the pending record the MOMENT a validly-diffed signature comes
      // back, before submission is even attempted, so a transport failure (which can throw before
      // signSendConfirm ever returns) does not lose it. See sign.js's own note on `onSigned`.
      onSigned: (sig) => {
        const p = { sig, lastValidBlockHeight: body.lastValidBlockHeight, wallet: live, at: Date.now(), inSym, outSym, inAmt, outAmt };
        savePending(p);
        setPending(p);
      },
    });

    const base = { inSym, outSym, inAmt, outAmt };
    if (res.status === "sent") {
      setOutcome({ ...base, status: "sent", sig: res.sig });
      setBalTick((n) => n + 1); // re-read balances now that the swap landed
      setSwapping(false);
    } else if (res.status === "unconfirmed") {
      // onSigned already persisted the pending record above — nothing more to do here.
      // setSwapping(false) intentionally NOT called-then-forgotten — `pending` itself now drives
      // the locked-form UI, and clearing `swapping` too early would flash the form as usable for
      // one render before `pending`'s effect takes over.
      setSwapping(false);
    } else {
      // "failed" or "declined": whatever onSigned may have persisted was never actually landed
      // (the node explicitly refused it, or nothing was ever signed) — clear it rather than
      // leaving a stale pending record the poller would spin on forever.
      clearPendingStorage();
      setPending(null);
      if (res.status === "declined") {
        setOutcome({ ...base, status: "declined" });
      } else {
        setOutcome({ ...base, status: "failed", error: res.error, sig: res.sig });
      }
      setSwapping(false);
    }
  }

  function dismissOutcome() { setOutcome(null); }
  function retryFromOutcome() { setOutcome(null); }

  // ── derived quote figures ───────────────────────────────────────────────────────────────────
  // ⚠️ P3: priceImpactPct is a FRACTION, not already a percent — checked against Jupiter's public
  // quote API docs ("priceImpactPct: … represented as a ratio, e.g. 0.01 = 1%") AND against this
  // pane's own recorded fixture: scripts/fixtures/seeker-swap/quote.json's 0.01 SOL → SKR quote
  // carries "priceImpactPct":"0.0014022…", i.e. ~0.14% impact for a three-hop, sub-$2 trade — a
  // plausible small-trade figure. Reading it as an already-a-percent value (skip the *100) would
  // make that same quote read as a 0.0014% impact, invisible at any real trade size; reading the
  // *100 the OTHER way (treating "0.0014" as already ×100) would put a 0.01 SOL trade at "100×"
  // impact, which a swap that size cannot produce. So *100 below is correct, not a guess.
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
  // P3: guarded the same way as impactPct above — a missing/non-numeric priceImpactPct must
  // render "—", never "NaN%" (Number(undefined) is NaN; the isFinite() check below catches it).
  const cImpactPct = cq && cq.priceImpactPct != null ? Number(cq.priceImpactPct) * 100 : null;
  const cImpactStr = cImpactPct != null && isFinite(cImpactPct) ? `${cImpactPct.toFixed(2)}%` : "—";
  const cDanger = cImpactPct != null && isFinite(cImpactPct) && cImpactPct >= 5;
  // P3 / round 30 fix 6: "Network cost" — the priority fee from the SAME /tx build that will be
  // signed (confirmData.tx, never a second, separate estimate call), plus the one-time ATA-open
  // note when the receiving mint's account does not exist yet (checked at quote time, above).
  const cTx = confirmData && confirmData.tx;
  const feeSolStr = cTx && cTx.prioritizationFeeLamports != null
    ? fmtAmt(String(cTx.prioritizationFeeLamports), 9, 6) : null;
  const confirmLines = cq && inMint && outMint ? [
    <span key="p">{tf("Pay {amt} {sym}", { amt: fmtAmt(cq.inAmount, inMint.decimals), sym: inSym })}</span>,
    <span key="r">{tf("Receive at least {amt} {sym}", { amt: fmtAmt(cq.otherAmountThreshold, outMint.decimals), sym: outSym })}</span>,
    <span key="i">{tf("Price impact: {pct}", { pct: cImpactStr })}</span>,
    // ⚠️ P2-3: reads cq.slippageBps (the number baked into THIS quote/transaction), never the
    // `slippageBps` chip state — the chip can change after the sheet opened with a stale quote
    // still on screen for one render.
    <span key="s">{tf("Slippage: {pct}%", { pct: (Number(cq.slippageBps) / 100).toFixed(2) })}</span>,
    feeBps ? <span key="f">{tf("Platform fee: {pct}%", { pct: (feeBps / 100).toFixed(2) })}</span> : null,
    feeSolStr ? <span key="net">{tf("Network cost: up to {sol} SOL priority fee", { sol: feeSolStr })}</span> : null,
    outAtaExists === false ? <span key="ata">{t("About 0.002 SOL once, to open the receiving account.")}</span> : null,
  ].filter(Boolean) : [];

  const canReview = !!(quote && quotePhase === "loaded" && amountRaw && !isZeroRaw(amountRaw) && !overBalance && online && confirmPhase !== "checking" && !swapping && !pending);
  // P2-2: while an unconfirmed signature is being checked, the whole form is locked — no editing
  // the amount, no picking a different mint, no flipping, no changing slippage, no re-review.
  const locked = !!pending;

  return (
    <Pane icon="🔁" title="Swap">
      <p className="seeker-tool-lede">{t("Swap SOL, SKR, CLKN and USDC in this app. Every quote shows the rate, the minimum you receive and the price impact before you sign. Non-custodial — you sign, we take nothing.")}</p>

      {configPhase === "loading" ? <Loading label={t("Loading swap terms…")} /> : null}
      {configPhase === "unavailable" ? <Unavailable kind={online ? "unavailable" : "offline"} onRetry={loadConfig} /> : null}

      {configPhase === "loaded" && config ? (
        <div className="seeker-swap-form">
          {swapping ? <Loading label={t("Approve the swap in your wallet…")} /> : null}
          {pending ? <PendingCard p={pending} /> : null}
          {outcome ? <OutcomeCard o={outcome} onDismiss={dismissOutcome} onRetry={retryFromOutcome} /> : null}

          {!swapping ? (
            <>
              <div className="seeker-swap-row">
                <div className="seeker-swap-rowhead">
                  <label className="seeker-listing-label" htmlFor="swap-pay-mint">{t("Pay")}</label>
                  {inMint ? (
                    <span
                      className="seeker-tool-note"
                      // P3: this is the SUM across every account you hold of this mint (both
                      // token programs) — the spendable amount in a single transfer is really
                      // your primary token account's own balance, which is usually the same
                      // number but is not guaranteed to be if you hold more than one account.
                      title={t("Sum across every account you hold of this token. If you hold more than one account, your spendable amount in a single transfer may be less than this total.")}
                    >
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
                    disabled={locked}
                  />
                  <select
                    id="swap-pay-mint"
                    className="seeker-listing-input seeker-swap-picker"
                    value={inSym || ""}
                    onChange={(e) => { setOutSym((o) => (o === e.target.value ? inSym : o)); setInSym(e.target.value); setQuote(null); setQuotePhase("idle"); }}
                    aria-label={t("Token to pay with")}
                    disabled={locked}
                  >
                    {mints.map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                  </select>
                </div>
                <button type="button" className="seeker-btn seeker-btn-quiet seeker-swap-maxbtn" disabled={locked || balIn.phase !== "loaded"} onClick={onMax}>{t("Max")}</button>
                {overBalance ? <p className="seeker-listing-formerror">{tf("You only hold {bal} {sym}.", { bal: fmtAmt(balIn.raw, inMint.decimals), sym: inSym })}</p> : null}
                {formError ? <p className="seeker-listing-formerror">{formError}</p> : null}
              </div>

              <button type="button" className="seeker-btn seeker-btn-quiet seeker-swap-flip" onClick={flip} aria-label={t("Swap the pay and receive tokens")} disabled={locked}>⇅</button>

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
                    disabled={locked}
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
                        disabled={locked}
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
