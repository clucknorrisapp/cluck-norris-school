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
import React from "react";
import { t, tf } from "./i18n.js";
import { shortAddr } from "./addr.js";

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
// has no way to produce a correct sentence. Adding a tool means adding its line here.
const TOOL_LINE = {
  xray: "Wallet X-Ray runs on the unified tools pass shared by every heavy tool.",
  holders: "Holders runs on the unified tools pass shared by every heavy tool.",
  trace: "Trace runs on the unified tools pass shared by every heavy tool.",
  airdrop: "The Airdropper runs on the unified tools pass shared by every heavy tool.",
  buyspecial: "Buy Special runs on the unified tools pass shared by every heavy tool.",
};
const TOOL_LINE_FALLBACK = "This tool runs on the unified tools pass shared by every heavy tool.";

// `tool` is a registry id (src/seeker/tools/registry.js), never display text.
export function PassGate({ pass, wallet, tool, onUnlocked, onClose }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [needPay, setNeedPay] = React.useState(null);

  async function checkHolder() {
    const g = passGateWindow();
    if (!g) { setErr(t("The pass service isn't available right now.")); return; }
    if (!wallet.provider || typeof wallet.provider.signMessage !== "function") {
      setErr(t("This wallet can't sign messages — try Phantom, Solflare, Backpack or Jupiter."));
      return;
    }
    setBusy(true); setErr(null); setNeedPay(null);
    try {
      const chR = await fetch(`/api/tool-gate/challenge?wallet=${encodeURIComponent(wallet.address)}`);
      const ch = await chR.json().catch(() => null);
      if (!ch || !ch.success || !ch.message) { setErr(t("Could not reach the pass service. Try again shortly.")); setBusy(false); return; }
      const enc = new TextEncoder().encode(ch.message);
      let sig;
      try { sig = await wallet.provider.signMessage(enc, "utf8"); }
      catch (_e) { setErr(t("Signature request was rejected or failed.")); setBusy(false); return; }
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
      if (j && j.success && j.pass) { g.grant(j.days || 1, j.via || "holder", j.pass); setBusy(false); onUnlocked(); return; }
      if (j && j.error === "insufficient_holdings") { setNeedPay({ detail: j.detail }); setBusy(false); return; }
      setErr((j && (j.detail || j.error)) || t("Could not verify this wallet."));
    } catch (_e) { setErr(t("Could not reach the pass service. Try again shortly.")); }
    setBusy(false);
  }

  const cfg = pass.config;
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
            {cfg.skr && cfg.skr.skrNeeded
              ? tf("Holding about {skr} SKR (around ${usd} worth) unlocks them the same way, in this app.",
                   { skr: fmtInt(cfg.skr.skrNeeded), usd: fmtInt(cfg.holdUsd) })
              : null}
            {" "}
            {tf("Not holding? Pay {sol} SOL for a {days}-day pass to all of them.",
                { sol: cfg.lamports / 1e9, days: cfg.days })}
          </p>
        ) : <p className="seeker-tool-note">{t("Loading today's terms…")}</p>}

        {!wallet.connected ? (
          <button type="button" className="seeker-btn" onClick={wallet.connect}>{t("Connect Wallet")}</button>
        ) : (
          <>
            <p className="seeker-passgate-wallet">{shortAddr(wallet.address)}</p>
            <button type="button" className="seeker-btn" disabled={busy} onClick={checkHolder}>
              {busy ? t("Checking…") : t("Check my wallet")}
            </button>
          </>
        )}

        {needPay ? (
          <p className="seeker-passgate-needpay" role="alert">
            {needPay.detail || t("This wallet doesn't hold enough CLKN or SKR for the free tier.")}{" "}
            {t("Paying in SOL from the full site at clucknorris.app also unlocks the pass — that payment flow isn't built into this app yet.")}
          </p>
        ) : null}
        {err ? <p className="seeker-tool-note seeker-passgate-err" role="alert">{err}</p> : null}

        <div className="seeker-confirm-actions">
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onClose}>{t("Not now")}</button>
        </div>
      </div>
    </div>
  );
}
