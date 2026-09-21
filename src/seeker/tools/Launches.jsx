// Cluck Norris — Seeker app, Launches pane (docs/SEEKER_TOOLS_BUILD.md).
//
// Free, read-only, no wallet, no pass. Two tabs over the two live Bags reads server.js already
// serves publicly:
//   GET /api/bags-near-grad
//     200 { success: true, cached, scanned, sourceDown, tokens: [{ tokenMint, name, symbol,
//           image, twitter, priceUsd: null, marketCap: null, change24h: null, volume24h,
//           curvePct, solRaised, solToGrad, createdAt }] }
//     — getBagsNearGrad() never throws: a failed on-chain scan comes back as sourceDown:true with
//       whatever cached list it still has (possibly empty). success is ALWAYS true here, so it is
//       NOT proof the read worked — see the honesty note below.
//   GET /api/bags-graduated
//     200 { success: true, cached, tokens: [{ tokenMint, name, symbol, image, twitter, priceUsd,
//           marketCap, change24h, volume24h, createdAt }] }
//     200 { success: true, cached: true, stale: true, tokens: [...] }   — the live board failed,
//           serving the last good one
//     200 { success: false, tokens: [], error }                        — no cache to fall back to
//
// ⚠️ Honesty rule this pane exists to keep (CLAUDE.md, pane contract §1): `success:true` on
// near-grad does NOT mean the read worked. When the on-chain scan fails and there is no cached
// list, the endpoint still answers success:true with tokens:[] and sourceDown:true — an empty
// array from a failed read, not a real "nothing is close to graduating". Rendering that as Empty
// would be exactly the lie CLAUDE.md calls out ("telling someone there is nothing when we could
// not actually look"). So sourceDown + zero tokens is treated as Unavailable here, never Empty;
// sourceDown + a non-empty (stale) list is shown, labelled as stale, because it IS real data.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const BAGS_BONDING_SOL = 85; // display only — mirrors server.js's constant, never computed here

function toMs(ts) {
  const n = Number(ts);
  if (!n) return null;
  return n < 10_000_000_000 ? n * 1000 : n; // tolerate seconds or milliseconds
}
function agoText(ts) {
  const ms = toMs(ts);
  if (!ms) return null;
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return t("just now");
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}${t("m ago")}`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}${t("h ago")}`;
  const day = Math.floor(hr / 24);
  return `${day}${t("d ago")}`;
}
function isHttpUrl(u) { return /^https?:\/\//i.test(String(u || "")); }
// The Bags feed's `twitter` field has shown up as a bare handle or a full profile URL; either way
// it is attacker-controlled (a launcher's own metadata), so we extract and validate a real X
// handle before ever building a link from it, rather than trusting the raw string as an href.
function xHandleFrom(tw) {
  const s = String(tw || "").trim();
  if (!s) return null;
  const h = s.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
}
function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(v < 1 ? 4 : 2);
}
function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

function TokenCard({ tok, mode }) {
  const [imgOk, setImgOk] = React.useState(true);
  const handle = xHandleFrom(tok.twitter);
  const img = isHttpUrl(tok.image) ? tok.image : null;
  const ago = agoText(tok.createdAt);
  return (
    <div className="seeker-launch-card">
      <div className="seeker-launch-avatar" aria-hidden="true">
        {img && imgOk ? <img src={img} alt="" onError={() => setImgOk(false)} /> : <span>{"🪙"}</span>}
      </div>
      <div className="seeker-launch-body">
        <div className="seeker-launch-top">
          <span className="seeker-launch-name">{tok.name || t("(unnamed)")}</span>
          {tok.symbol ? <span className="seeker-launch-symbol">{tok.symbol}</span> : null}
        </div>
        <div className="seeker-tool-note">{shortAddr(tok.tokenMint)}{ago ? ` · ${ago}` : ""}</div>

        {mode === "near" ? (
          <>
            <div className="seeker-launch-bar">
              <div className="seeker-launch-bar-fill" style={{ width: Math.max(0, Math.min(100, tok.curvePct || 0)) + "%" }} />
            </div>
            <div className="seeker-tool-note">
              {t("Curve")}: {(tok.curvePct || 0).toFixed(1)}% · {t("raised")} {tok.solRaised != null ? tok.solRaised.toFixed(1) : "?"} / {BAGS_BONDING_SOL} SOL
            </div>
          </>
        ) : (
          <div className="seeker-launch-stats">
            {tok.priceUsd != null ? <span>{fmtUsd(tok.priceUsd)}</span> : null}
            {tok.marketCap != null ? <span>{t("MC")} {fmtUsd(tok.marketCap)}</span> : null}
            {tok.change24h != null ? <span className={Number(tok.change24h) >= 0 ? "seeker-launch-up" : "seeker-launch-down"}>{fmtPct(tok.change24h)}</span> : null}
          </div>
        )}

        {handle ? <a className="seeker-listing-link" href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">{t("X profile")} →</a> : null}
      </div>
    </div>
  );
}

const TABS = [
  { id: "near", label: "Near graduation", endpoint: "/api/bags-near-grad" },
  { id: "graduated", label: "Recently graduated", endpoint: "/api/bags-graduated" },
];

export default function LaunchesPane() {
  const online = useOnline();
  const [tab, setTab] = React.useState("near");
  const [phase, setPhase] = React.useState("loading"); // loading | result | unavailable
  const [tokens, setTokens] = React.useState([]);
  const [stale, setStale] = React.useState(false);
  const [errKind, setErrKind] = React.useState("unavailable");
  const abortRef = React.useRef(null);

  const load = React.useCallback((which) => {
    setPhase("loading");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const spec = TABS.find((x) => x.id === which) || TABS[0];
    toolFetch(spec.endpoint, { signal: ctrl.signal }).then((res) => {
      if (!res.ok) {
        if (res.kind === "aborted") return;
        setPhase("unavailable");
        setErrKind(res.kind === "offline" ? "offline" : "unavailable");
        return;
      }
      const data = res.data || {};
      const list = Array.isArray(data.tokens) ? data.tokens : [];
      // See the file header: near-grad answers success:true even on a failed scan with no cache.
      const readReallyFailed = data.success === false || (which === "near" && !!data.sourceDown && list.length === 0);
      if (readReallyFailed) {
        setPhase("unavailable");
        setErrKind("unavailable");
        return;
      }
      setStale(!!data.stale || (which === "near" && !!data.sourceDown));
      setTokens(list);
      setPhase("result");
    });
  }, []);

  React.useEffect(() => {
    load(tab);
    return () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} };
  }, [tab, load]);

  return (
    <Pane icon="🎒" title="Launches">
      <p className="seeker-tool-lede">{t("Live Bags launches, read straight off the chain. Free, no wallet needed.")}</p>

      <div className="seeker-launch-tabs" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={"seeker-launch-tabbtn" + (tab === tb.id ? " active" : "")}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>

      {phase === "loading" ? <Loading label={t("Reading the chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} onRetry={() => load(tab)} /> : null}

      {phase === "result" ? (
        <>
          {stale ? <p className="seeker-tool-note seeker-launch-stale">{t("Showing the last successful read — a fresh one just failed.")}</p> : null}
          {tokens.length === 0 ? (
            <Empty>{t(tab === "near" ? "Nothing is close to graduating right now." : "Nothing has graduated recently.")}</Empty>
          ) : (
            <div className="seeker-launch-list">
              {tokens.map((tk) => <TokenCard key={tk.tokenMint} tok={tk} mode={tab} />)}
            </div>
          )}
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-launch-refresh" onClick={() => load(tab)} disabled={!online}>
            {t("Refresh")}
          </button>
        </>
      ) : null}
    </Pane>
  );
}
