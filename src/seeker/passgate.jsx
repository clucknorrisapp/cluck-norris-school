// The tools-pass gate, rendered natively for the phone (docs/SEEKER_TOOLS_BUILD.md §5).
//
// ⚠️ ONE COPY. This started as three identical 79-line copies — one each in WalletXray.jsx,
// Holders.jsx and Trace.jsx — differing by a single string (the tool's name in one sentence).
// The three panes were built as one unit with a file-ownership boundary that did not include a
// shared file, and each copy carried a note saying "if this drifts, that is the signal to
// extract it". It was extracted before it drifted, and before Airdropper, Buy Special and
// Hatchery made it six copies of a SIGNING path.
//
// That is CLAUDE.md's standing rule applied to this app's own code, not just to the shared
// browser modules: "Don't re-type these into a page — private copies drifted badly enough to
// cause real bugs." The verification note in AGENTS.md is the same lesson from the other side —
// `function esc(` was migrated everywhere while six copies written a different way survived, one
// of them carrying an XSS gap. A duplicated block is not a bug today; it is the shape a bug
// takes six weeks from now, when one copy is fixed.
//
// What this file owns is PRESENTATION ONLY. The credential itself — the localStorage key, the
// server-issued token, what counts as proof, which errors mean "the pass died" — comes from
// window.CluckGate via src/seeker/pass.js, which is deliberately a thin binding over the one
// pass client the whole platform uses. See that file's header.
//
// The SKR-PAID pass (docs/SEEKER_SKR_PASS_DESIGN.md) is the one addition that moves money from
// here. Its logic — the quote check, the transaction, the recovery record, the redemption and its
// definitive-vs-retryable classification — is src/seeker/skr-pay.js (pure, unit-tested); the
// signing is src/seeker/sign.js's signSendConfirm, the same seam every signing pane uses. This
// file only renders it.
import React from "react";
import { Link } from "react-router-dom";
import { t, tf } from "./i18n.js";
import { shortAddr } from "./addr.js";
import { Confirm } from "./pane.jsx";
import { rpcFn } from "./sign.js";
import { fetchQuote, quoteStale, readSkrAccounts, paySkr, loadRecord, loadStuck, dismissStuck, redeemRecord, checkPayment, rawToUi } from "./skr-pay.js";

export function passGateWindow() {
  try { return (typeof window !== "undefined" && window.CluckGate) || null; } catch (_) { return null; }
}

// A tool's own gated read, classified exactly like pane.jsx's toolFetch (offline / refused /
// unavailable / ok) but sent through usePass()'s gatedFetch so the pass header goes out and a
// denial drops the local grant. Kept separate from toolFetch() rather than folded into it:
// toolFetch owns its own fetch() call and cannot be handed an already-credentialed one.
export async function gatedToolFetch(gatedFetch, url) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, kind: "offline", status: 0, error: null };
  let r, body = null;
  try { r = await gatedFetch(url); } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, kind: "aborted", status: 0, error: null };
    return { ok: false, kind: "offline", status: 0, error: null };
  }
  try { body = await r.json(); } catch (_) { body = null; }
  if (r.ok && body && body.success !== false) return { ok: true, data: body };
  if (r.status >= 400 && r.status < 500 && r.status !== 429) return { ok: false, kind: "refused", status: r.status, error: (body && body.error) || null, body };
  return { ok: false, kind: "unavailable", status: r.status, error: (body && body.error) || null, body };
}

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
// A dollar figure from the server's config/quote: whole numbers plain ("1"), fractions to cents.
// Never fmtInt for this — a $0.50 pass must not read as "$1".
function fmtUsd(n) { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2); }
function store() { try { return window.localStorage; } catch (_) { return null; } }
const httpFetch = (u, o) => fetch(u, o);

// The native sheet §5 asks for. Renders live terms from usePass().config — never a hardcoded
// amount, price or duration; a null config (gate down / pricing outage) is handled upstream by
// usePass() returning "off", so this only ever mounts when a real config exists or is still
// loading. Reuses window.CluckGate's challenge → sign → session → grant plumbing end to end —
// the ONLY thing built here is the presentation, per pass.js's own file header.
//
// The one thing that differs per tool is a single sentence, and it is kept here as a WHOLE
// sentence per tool rather than `t(toolName) + t("runs on…")`. Two reasons, and the second is
// the load-bearing one: pane.jsx's STRING RULE says every user-visible string is translated by
// the component that renders it (so the caller passes an id, never display text); and a sentence
// split into fragments cannot be translated — word order is not English's in six of our seven
// languages, and a translator handed "Holders" and "runs on the unified tools pass…" separately
// has no way to produce a correct sentence. Adding a tool means adding its line here. (The
// Airdropper's line left on 2026-09-22 — it is free for everyone now, on every platform.)
const TOOL_LINE = {
  xray: "Wallet X-Ray runs on the unified tools pass shared by every heavy tool.",
  holders: "Holders runs on the unified tools pass shared by every heavy tool.",
  trace: "Trace runs on the unified tools pass shared by every heavy tool.",
};
const TOOL_LINE_FALLBACK = "This tool runs on the unified tools pass shared by every heavy tool.";

// `tool` is a registry id (src/seeker/tools/registry.js), never display text.
export function PassGate({ pass, wallet, tool, onUnlocked, onClose }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [needPay, setNeedPay] = React.useState(null);
  // The SKR-paid pass. `skr` is the quote + the payer's source account while the Confirm sheet is
  // up; `rec` mirrors the stored recovery record for this wallet (a payment that was signed and
  // may or may not have landed); `payNote` is the last outcome line; `short` = not enough SKR.
  const [skr, setSkr] = React.useState(null);          // { quote, source }
  const [skrBusy, setSkrBusy] = React.useState(null);  // null | "quote" | "sign" | "check"
  const [rec, setRec] = React.useState(null);
  const [payNote, setPayNote] = React.useState(null);  // { tone: "ok"|"warn"|"err", text }
  const [short, setShort] = React.useState(null);      // { have, need }
  const [stuck, setStuck] = React.useState([]);        // payments that landed but cannot buy a pass

  // One signed sign-in: challenge → signMessage → session. Used by "Check my wallet" and, when a
  // stored payIntent has expired, by "Check payment". Returns
  //   { kind:"granted", j } | { kind:"needpay", detail, payIntent } | { kind:"error", message }
  async function signSession() {
    const g = passGateWindow();
    if (!g) return { kind: "error", message: t("The pass service isn't available right now.") };
    if (!wallet.provider || typeof wallet.provider.signMessage !== "function") {
      return { kind: "error", message: t("This wallet can't sign messages — try Phantom, Solflare, Backpack or Jupiter.") };
    }
    try {
      const chR = await fetch(`/api/tool-gate/challenge?wallet=${encodeURIComponent(wallet.address)}`);
      const ch = await chR.json().catch(() => null);
      if (!ch || !ch.success || !ch.message) return { kind: "error", message: t("Could not reach the pass service. Try again shortly.") };
      const enc = new TextEncoder().encode(ch.message);
      let sig;
      try { sig = await wallet.provider.signMessage(enc, "utf8"); }
      catch (_e) { return { kind: "error", message: t("Signature request was rejected or failed.") }; }
      let bytes = (sig && sig.signature) ? sig.signature : sig;
      if (bytes && bytes.data && !bytes.length) bytes = bytes.data;
      const arr = new Uint8Array(bytes);
      let bin = ""; for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
      const b64 = btoa(bin);
      const sessR = await fetch("/api/tool-gate/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // doors: the free-tier doors THIS app offers beyond CLKN. The Seeker app is the one
        // surface with the SKR door (owner, 2026-09-19; lib/tool-pass-qualify.js); the website's
        // cluck-gate.js sends none. Nothing is gated behind SKR — it opens the same door CLKN does.
        body: JSON.stringify({ wallet: wallet.address, message: ch.message, signature: b64, doors: ["skr"] }),
      });
      const j = await sessR.json().catch(() => null);
      if (j && j.success && j.pass) return { kind: "granted", j };
      if (j && j.error === "insufficient_holdings") return { kind: "needpay", detail: j.detail, payIntent: j.payIntent || null };
      return { kind: "error", message: (j && (j.detail || j.error)) || t("Could not verify this wallet.") };
    } catch (_e) { return { kind: "error", message: t("Could not reach the pass service. Try again shortly.") }; }
  }

  async function checkHolder() {
    setBusy(true); setErr(null); setNeedPay(null); setPayNote(null); setShort(null);
    const r = await signSession();
    if (r.kind === "granted") { passGateWindow().grant(r.j.days || 1, r.j.via || "holder", r.j.pass); setBusy(false); onUnlocked(); return; }
    if (r.kind === "needpay") setNeedPay({ detail: r.detail, payIntent: r.payIntent });
    else setErr(r.message);
    setBusy(false);
  }

  // ── the SKR payment ────────────────────────────────────────────────────────────────────────
  // A fresh payIntent for a stored payment whose intent expired: one more signed sign-in. If that
  // sign-in finds the wallet now qualifies on holdings, it simply unlocks (and returns null).
  async function refreshIntent() {
    const r = await signSession();
    if (r.kind === "granted") { passGateWindow().grant(r.j.days || 1, r.j.via || "holder", r.j.pass); onUnlocked(); return null; }
    if (r.kind === "needpay" && r.payIntent) { setNeedPay({ detail: r.detail, payIntent: r.payIntent }); return r.payIntent; }
    return null;
  }

  // Everything a redemption can come back as, said honestly. A grant unlocks; a definitive refusal
  // names its reason (that transfer will never buy a pass); anything else keeps the record and says
  // the payment is not lost.
  function applyOutcome(out) {
    const g = passGateWindow();
    if (out.kind === "granted") {
      setRec(null); setSkr(null);
      if (g) g.grant(out.days, "paid-skr", out.pass);
      setPayNote({ tone: "ok", text: tf("Paid — every heavy tool is unlocked for {days} days.", { days: out.days }) });
      onUnlocked();
    } else if (out.kind === "refused" && out.keptActive) {
      // The support entry could not be stored (storage full?), so the active record was NOT cleared:
      // it still carries the signature. Show the support state straight from this answer.
      setRec(loadRecord(store(), wallet.address));
      setPayNote({ tone: "err", text: tf("A payment of {amount} SKR was sent but could not buy a pass: {reason}. Keep this signature and contact support: {sig}", { amount: out.amountUi || "?", reason: out.error || out.code || "?", sig: out.sig }) });
    } else if (out.kind === "cannot-confirm") {
      // The search for a payment we could not see was not complete (or an RPC call failed): kept, never released.
      setRec(loadRecord(store(), wallet.address));
      setPayNote({ tone: "warn", text: t("We can't tell yet whether this payment went through. If SKR left your wallet, look in your wallet's history and contact support.") });
    } else if (out.kind === "refused" && out.watching) {
      // Codex round 4 on #421 (P1): a candidate the chain SEARCH turned up was refused, but the
      // attempt's own blockhash is still live — the real payment may yet land. The attempt is still
      // on record (skr-pay.js kept it as the guard) and this sheet must keep showing "Check payment",
      // never a second pay button. The first cut dropped `rec` here and offered another payment.
      setRec(loadRecord(store(), wallet.address));
      setStuck(loadStuck(store(), wallet.address));   // the refused candidate is kept as evidence
      setPayNote({ tone: "warn", text: tf("That payment can't buy a pass: {reason}", { reason: out.error || out.code || "?" }) + " " + t("Your payment may still be landing — check it before paying again.") });
    } else if (out.kind === "refused") {
      setRec(null);
      setStuck(loadStuck(store(), wallet.address));   // a payment that landed is kept, with its signature
      setPayNote({ tone: "err", text: tf("That payment can't buy a pass: {reason}", { reason: out.error || out.code || "?" }) });
    } else if (out.kind === "never-landed") {
      setRec(null);
      setPayNote({ tone: "warn", text: t("That payment never landed — nothing was charged. You can pay again.") });
    } else if (out.kind === "signin") {
      setRec(loadRecord(store(), wallet.address));
      setPayNote({ tone: "warn", text: t("Your payment may still be landing — check it before paying again.") });
    } else if (out.kind === "retry") {
      setRec(loadRecord(store(), wallet.address));
      setPayNote({ tone: "warn", text: t("Your payment is sent, but the pass service could not confirm it yet. Nothing new was charged — check it again in a moment.") });
    }
  }

  async function startSkrPay() {
    if (!store() || !wallet.connected || !needPay || !needPay.payIntent) { setErr(t("Check your wallet first, then pay.")); return; }
    setSkrBusy("quote"); setErr(null); setPayNote(null); setShort(null);
    try {
      const q = await fetchQuote(httpFetch, wallet.address);
      if (!q.ok) {
        setErr(q.kind === "price" ? t("SKR pricing is unavailable right now — try again in a minute.")
          : q.kind === "offline" ? t("Could not reach the pass service. Try again shortly.")
          : t("Could not get an SKR quote. Try again shortly."));
        return;
      }
      let accts;
      try { accts = await readSkrAccounts(rpcFn(), wallet.address); }
      catch (_) { setErr(t("Could not read your SKR balance. Try again shortly.")); return; }
      const need = BigInt(q.quote.amountRaw);
      if (!accts.best || accts.best.raw < need) {
        setShort({ have: rawToUi(accts.total.toString(), q.quote.decimals), need: q.quote.amountUi });
        return;
      }
      setSkr({ quote: q.quote, source: accts.best.pubkey });
    } finally { setSkrBusy(null); }
  }

  async function confirmSkrPay() {
    const st = store();
    const { quote, source } = skr;
    // A sheet left open past the quote's life is re-priced, not paid at the old number.
    if (quoteStale(quote)) {
      setSkr(null); setSkrBusy("quote");
      const q = await fetchQuote(httpFetch, wallet.address);
      setSkrBusy(null);
      if (!q.ok) { setErr(t("SKR pricing is unavailable right now — try again in a minute.")); return; }
      setSkr({ quote: q.quote, source });
      setPayNote({ tone: "warn", text: t("The quote was refreshed — review it and confirm again.") });
      return;
    }
    setSkr(null); setSkrBusy("sign"); setErr(null); setPayNote(null);
    try {
      // skr-pay.js paySkr: signSendConfirm with the recovery record persisted BEFORE submission.
      const res = await paySkr({ provider: wallet.provider, owner: wallet.address, quote, source, payIntent: needPay.payIntent, storage: st });
      if (res.status === "declined") { setPayNote({ tone: "warn", text: t("You declined in your wallet — nothing was sent.") }); return; }
      if (res.status === "failed") {
        // The node refused it, or it landed and FAILED on-chain: nobody was paid, a retry is safe
        // (paySkr already cleared the record).
        setErr(tf("The payment did not go through — nothing was charged. {reason}", { reason: res.error || "" }));
        return;
      }
      setRec(loadRecord(st, wallet.address));
      if (res.status === "unconfirmed") {
        setPayNote({ tone: "warn", text: t("Your payment may still be landing — check it before paying again.") });
        return;
      }
      // "sent": landed. Redeem it now; the record is already stored, so a failure here loses nothing.
      setSkrBusy("check");
      applyOutcome(await redeemRecord({ fetchFn: httpFetch, storage: st, wallet: wallet.address, refreshIntent }));
    } catch (e) {
      setErr((e && e.message) || t("Could not reach the pass service. Try again shortly."));
    } finally { setSkrBusy(null); }
  }

  async function checkStored() {
    setSkrBusy("check"); setErr(null);
    try {
      applyOutcome(await checkPayment({ fetchFn: httpFetch, storage: store(), wallet: wallet.address, rpc: rpcFn(), refreshIntent }));
    } catch (_) { setErr(t("Could not reach the pass service. Try again shortly.")); }
    finally { setSkrBusy(null); }
  }

  // Reopening with a stored payment for this wallet re-posts it automatically, before anything
  // else — with the stored payIntent only (an expired one waits for the "Check payment" tap, since
  // refreshing it needs a signature and a prompt should never appear unasked).
  React.useEffect(() => {
    if (!wallet.connected || !wallet.address || !store()) { setRec(null); setStuck([]); return undefined; }
    const stored = loadRecord(store(), wallet.address);
    setRec(stored);
    setStuck(loadStuck(store(), wallet.address));
    if (!stored) return undefined;
    let alive = true;
    (async () => {
      setSkrBusy("check");
      try {
        const out = await redeemRecord({ fetchFn: httpFetch, storage: store(), wallet: wallet.address, refreshIntent: null });
        if (alive) applyOutcome(out);
      } catch (_) { /* the Check payment button remains */ }
      finally { if (alive) setSkrBusy(null); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address]);

  const cfg = pass.config;
  const skrPass = cfg && cfg.skr && cfg.skr.pass ? cfg.skr.pass : null;
  const payBusy = !!skrBusy;
  return (
    <div className="seeker-confirm-wrap" role="dialog" aria-modal="true" aria-label={t("Unlock the tools pass")}>
      <div className="seeker-confirm seeker-passgate">
        <h2>{t("Unlock the tools pass")}</h2>
        <p className="seeker-tool-note">{t(TOOL_LINE[tool] || TOOL_LINE_FALLBACK)}</p>
        {/* ⚠️ WHOLE SENTENCES WITH THE VALUES INSIDE THEM, not fragments glued around <strong>.
            This paragraph used to be built from EIGHT separate t() calls — "Hold about", "(around",
            "worth) and every heavy tool runs free while you hold it.", "for a", "day", "pass to
            all of them." — which reads fine in English and cannot be translated into any of our
            six languages: the clause order differs and a translator handed "for a" and "day"
            separately has nothing to work with. Two translators flagged it independently.
            The inline bold went with it, deliberately: an untranslatable sentence in six
            languages is a worse trade than unbolded numerals in one. The live figures are still
            the only numbers in the paragraph, and they still come from the server — never
            hardcoded (AGENTS.md). */}
        {cfg ? (
          <p className="seeker-passgate-terms">
            {cfg.clknNeeded
              ? tf("Hold about {clkn} CLKN (around ${usd} worth) and every heavy tool runs free while you hold it.",
                   { clkn: fmtInt(cfg.clknNeeded), usd: fmtInt(cfg.holdUsd) })
              : tf("Hold ${usd} worth of CLKN and every heavy tool runs free while you hold it.",
                   { usd: fmtInt(cfg.holdUsd) })}
            {cfg.skr && cfg.skr.skrNeeded ? " " : ""}
            {/* The SKR door carries ITS OWN dollar figure (cfg.skr.holdUsd — owner, 2026-09-22:
                "$20 of SKR or $10 of CLKN"), so the sentence reads the figure from the skr block,
                never the CLKN one beside it. Older configs without skr.holdUsd fall back to it. */}
            {cfg.skr && cfg.skr.skrNeeded
              ? tf("Holding about {skr} SKR (around ${usd} worth) unlocks them the same way, in this app.",
                   { skr: fmtInt(cfg.skr.skrNeeded), usd: fmtInt(cfg.skr.holdUsd || cfg.holdUsd) })
              : null}
            {" "}
            {tf("Not holding? Pay {sol} SOL for a {days}-day pass to all of them.",
                { sol: cfg.lamports / 1e9, days: cfg.days })}
          </p>
        ) : <p className="seeker-tool-note">{t("Loading today's terms…")}</p>}

        {/* The whole tie-in to Swap from this sheet, per docs/SEEKER_SWAP_DESIGN.md — one line
            under the SKR sentence, only when the SKR door is actually live in this config. */}
        {cfg && cfg.skr && cfg.skr.skrNeeded ? (
          <p className="seeker-tool-note">
            <Link to="/tools/swap?out=SKR" className="seeker-listing-link">{t("Swap for SKR in this app")}</Link>
          </p>
        ) : null}

        {!wallet.connected ? (
          <button type="button" className="seeker-btn" onClick={wallet.connect}>{t("Connect Wallet")}</button>
        ) : (
          <>
            <p className="seeker-passgate-wallet">{shortAddr(wallet.address)}</p>
            <button type="button" className="seeker-btn" disabled={busy || payBusy} onClick={checkHolder}>
              {busy ? t("Checking…") : t("Check my wallet")}
            </button>
          </>
        )}

        {/* A payment that was signed and may or may not have landed: shown first, and while it
            exists nothing else offers to pay (a second payment is how someone pays twice). */}
        {wallet.connected && rec ? (
          <div className="seeker-burn-outcome seeker-burn-outcome-unconfirmed" role="status">
            <p className="seeker-burn-outcome-title">⏳ {t("Unconfirmed")}</p>
            <p>{t("Your payment may still be landing — check it before paying again.")}</p>
            <div className="seeker-burn-outcome-actions">
              <button type="button" className="seeker-btn" disabled={payBusy} onClick={checkStored}>
                {skrBusy === "check" ? t("Checking…") : t("Check payment")}
              </button>
            </div>
          </div>
        ) : null}

        {/* A payment that LANDED but could not buy a pass (an expired quote window, a rotated key, a
            transaction that paid for more than one wallet…). Never dropped silently: the signature
            stays here, with the reason, until the person dismisses it. Does not block a new payment. */}
        {wallet.connected ? stuck.map((s) => (
          <div key={s.paySig} className="seeker-burn-outcome seeker-burn-outcome-failed" role="alert">
            <p className="seeker-burn-outcome-title">⚠️ {t("Needs attention")}</p>
            <p>{tf("A payment of {amount} SKR was sent but could not buy a pass: {reason}. Keep this signature and contact support: {sig}",
                   { amount: s.amountUi || "?", reason: s.error || s.code || "?", sig: s.paySig })}</p>
            <div className="seeker-burn-outcome-actions">
              <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => { dismissStuck(store(), wallet.address, s.paySig); setStuck(loadStuck(store(), wallet.address)); }}>{t("Dismiss")}</button>
            </div>
          </div>
        )) : null}

        {needPay ? (
          <p className="seeker-passgate-needpay" role="alert">
            {needPay.detail || t("This wallet doesn't hold enough CLKN or SKR for the free tier.")}{" "}
            {skrPass ? null : t("Paying in SOL from the full site at clucknorris.app also unlocks the pass.")}
          </p>
        ) : null}

        {/* Pay in SKR: only after the wallet proved itself and did not qualify (that answer carries
            the payIntent the redemption needs), only when the server's config offers it, and never
            while an earlier payment is unresolved. The figures are the server's — the exact amount
            is the quote's, shown on the confirm sheet. */}
        {needPay && needPay.payIntent && skrPass && !rec ? (
          <div className="seeker-passgate-skr">
            <p className="seeker-tool-note">
              {skrPass.skrNeeded
                ? tf("Pay about {skr} SKR (around ${usd}) for a {days}-day pass to all of them, in this app.",
                     { skr: fmtInt(skrPass.skrNeeded), usd: fmtUsd(skrPass.usd), days: skrPass.days })
                : tf("Pay about ${usd} worth of SKR for a {days}-day pass to all of them, in this app.",
                     { usd: fmtUsd(skrPass.usd), days: skrPass.days })}
            </p>
            <button type="button" className="seeker-btn" disabled={payBusy} onClick={startSkrPay}>
              {skrBusy === "quote" ? t("Getting a quote…") : skrBusy === "sign" ? t("Waiting for your wallet…") : t("Pay in SKR")}
            </button>
            {short ? (
              <p className="seeker-tool-note seeker-passgate-err" role="alert">
                {tf("You hold about {have} SKR — this pass needs {need}. Swap for SKR in this app, then come back.", { have: short.have, need: short.need })}{" "}
                <Link to="/tools/swap?out=SKR" className="seeker-listing-link">{t("Swap for SKR in this app")}</Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {payNote ? <p className={"seeker-tool-note" + (payNote.tone === "err" ? " seeker-passgate-err" : "")} role={payNote.tone === "ok" ? "status" : "alert"}>{payNote.text}</p> : null}
        {err ? <p className="seeker-tool-note seeker-passgate-err" role="alert">{err}</p> : null}

        <div className="seeker-confirm-actions">
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onClose}>{t("Not now")}</button>
        </div>
      </div>

      <Confirm
        open={!!skr}
        title="Pay for the tools pass in SKR"
        lines={skr ? [
          tf("Pay {amount} SKR (about ${usd}) for a {days}-day pass to all the heavy tools.", { amount: skr.quote.amountUi, usd: fmtUsd(skr.quote.usd), days: skr.quote.days }),
          tf("To: {receiver}", { receiver: shortAddr(skr.quote.receiver) }),
          skr.quote.receiverAtaExists === true ? null : t("About 0.002 SOL once, to open the receiving account."),
          t("This sends SKR from your wallet and can't be undone."),
        ].filter(Boolean) : []}
        confirmLabel="Pay in SKR"
        onConfirm={confirmSkrPay}
        onCancel={() => setSkr(null)}
      />
    </div>
  );
}
