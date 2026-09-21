// Cluck Norris — Seeker app, Daily Brief pane (docs/SEEKER_TOOLS_BUILD.md).
//
// Free, read-only, no wallet, no pass. One endpoint, server.js ~5157:
//   GET /api/alpha
//     200 { success: true, generatedAt, date, data: { majors, trending, gainers, losers,
//           hotPools, newPools, lpPicks }, brief: <string> }
//     200 { success: false, error }
// `Cache-Control: public, max-age=600` on the response — the server rebuilds the brief at most
// every ~20h (ALPHA_TTL) and returns the cached one otherwise, so "Refresh" here just re-reads
// that cache; it never passes ?refresh=1 (that forces a full rebuild, including a live Claude
// call, and is not something a free read-only pane should be able to trigger on demand).
//
// The brief itself is Cluck's own AI-written prose over real market data (never edited here,
// rendered as plain text — it is model output, not markup). The structured "data" object backs a
// second, factual section underneath it: majors, trending, movers, pools. Nothing here is a
// recommendation — the server's own system prompt already forbids buy/sell calls and price
// predictions, and this pane adds no scoring or verdicts of its own on top of the numbers.
import React from "react";
import { t, tf } from "../i18n.js";
import { Pane, Loading, Unavailable, toolFetch, useOnline } from "../pane.jsx";
import "./tools.css";

function fmtUsd0(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + Math.round(v);
}
function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "?";
  return v >= 1 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toFixed(v < 0.01 ? 6 : 4);
}
function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function pctClass(n) { return Number(n) >= 0 ? "seeker-launch-up" : "seeker-launch-down"; }

function Section({ title, children }) {
  return (
    <section className="seeker-brief-card">
      <h2 className="seeker-brief-card-title">{title}</h2>
      {children}
    </section>
  );
}

export default function DailyBriefPane() {
  const online = useOnline();
  const [phase, setPhase] = React.useState("loading"); // loading | result | unavailable
  const [payload, setPayload] = React.useState(null);
  const [errKind, setErrKind] = React.useState("unavailable");
  const abortRef = React.useRef(null);

  const load = React.useCallback(() => {
    setPhase("loading");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    toolFetch("/api/alpha", { signal: ctrl.signal }).then((res) => {
      if (!res.ok) {
        if (res.kind === "aborted") return;
        setPhase("unavailable");
        setErrKind(res.kind === "offline" ? "offline" : "unavailable");
        return;
      }
      setPayload(res.data);
      setPhase("result");
    });
  }, []);

  React.useEffect(() => {
    load();
    return () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} };
  }, [load]);

  const d = (payload && payload.data) || {};

  return (
    <Pane icon="📰" title="Daily Brief">
      <p className="seeker-tool-lede">
        {t("The flock's daily read on Solana — majors, what's trending, fresh pools and real LP fee yields. Free, no wallet needed.")}
      </p>

      {phase === "loading" ? <Loading label={t("Cluck is reading the tape…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} onRetry={load} /> : null}

      {phase === "result" && payload ? (
        <div className="seeker-brief">
          {payload.date ? <div className="seeker-brief-date">{payload.date}</div> : null}

          <div className="seeker-brief-text">{payload.brief || ""}</div>

          {(d.majors || []).length ? (
            <Section title={t("The majors")}>
              <div className="seeker-brief-majors">
                {d.majors.map((m) => (
                  <div className="seeker-brief-major" key={m.sym}>
                    <span className="seeker-brief-major-sym">{m.sym}</span>
                    <span className="seeker-brief-major-price">${fmtPrice(m.price)}</span>
                    {m.chg != null ? <span className={pctClass(m.chg)}>{fmtPct(m.chg)}</span> : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {(d.trending || []).length ? (
            <Section title={t("Trending on Solana")}>
              <div className="seeker-brief-chips">
                {d.trending.map((tk, i) => (
                  <span className="seeker-brief-chip" key={tk.sym + ":" + i}>{tk.sym}{tk.chg != null ? ` ${fmtPct(tk.chg)}` : ""}</span>
                ))}
              </div>
            </Section>
          ) : null}

          {((d.gainers || []).length || (d.losers || []).length) ? (
            <Section title={t("24h movers")}>
              <div className="seeker-brief-movers">
                <div>
                  <div className="seeker-brief-movers-h">{t("Gainers")}</div>
                  {(d.gainers || []).length === 0
                    ? <div className="seeker-tool-note">{t("None right now.")}</div>
                    : (d.gainers || []).map((g, i) => (
                        <div className="seeker-brief-mover-row" key={g.sym + ":" + i}><span>{g.sym}</span><span className="seeker-launch-up">{fmtPct(g.chg)}</span></div>
                      ))}
                </div>
                <div>
                  <div className="seeker-brief-movers-h">{t("Losers")}</div>
                  {(d.losers || []).length === 0
                    ? <div className="seeker-tool-note">{t("None right now.")}</div>
                    : (d.losers || []).map((g, i) => (
                        <div className="seeker-brief-mover-row" key={g.sym + ":" + i}><span>{g.sym}</span><span className="seeker-launch-down">{fmtPct(g.chg)}</span></div>
                      ))}
                </div>
              </div>
            </Section>
          ) : null}

          {(d.hotPools || []).length ? (
            <Section title={t("Where the fees are")}>
              {d.hotPools.map((p, i) => (
                <div className="seeker-brief-pool-row" key={(p.pair || "") + ":" + i}>
                  <div>
                    <span className="seeker-brief-pool-pair">{p.pair || "?"}</span>
                    <span className="seeker-tool-note"> {p.dex || ""}{p.risk === "high" ? ` · ${t("high IL risk")}` : ""}</span>
                  </div>
                  <div className="seeker-brief-pool-nums">
                    {p.vol ? <span>{fmtUsd0(p.vol)} {t("24h vol")}</span> : null}
                    {p.yieldPct != null ? <span className="seeker-brief-yield">{p.yieldPct}%/{t("day")}</span> : null}
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {(d.newPools || []).length ? (
            <Section title={t("Fresh off the grill")}>
              {d.newPools.map((p, i) => (
                <div className="seeker-brief-pool-row" key={(p.name || "") + ":" + i}>
                  <div><span className="seeker-brief-pool-pair">{p.name || "?"}</span></div>
                  <div className="seeker-brief-pool-nums">
                    {p.vol ? <span>{fmtUsd0(p.vol)} {t("vol")}</span> : null}
                    {p.liq ? <span>{fmtUsd0(p.liq)} {t("liq")}</span> : null}
                    {p.ageH != null ? <span>{tf("{n}h old", { n: p.ageH })}</span> : null}
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {(d.lpPicks || []).length ? (
            <Section title={t("Blue-chip LP picks")}>
              {d.lpPicks.map((p, i) => (
                <div className="seeker-brief-pool-row" key={(p.pair || "") + ":" + i}>
                  <div><span className="seeker-brief-pool-pair">{p.pair || "?"}</span><span className="seeker-tool-note"> {p.dex || ""}</span></div>
                  {p.yieldPct != null ? <span className="seeker-brief-yield">{p.yieldPct}%/{t("day")}</span> : null}
                </div>
              ))}
            </Section>
          ) : null}

          <p className="seeker-brief-disclaimer">{t("Informational only — not financial advice.")}</p>

          <button type="button" className="seeker-btn seeker-btn-quiet seeker-brief-refresh" onClick={load} disabled={!online}>
            {t("Refresh")}
          </button>
        </div>
      ) : null}
    </Pane>
  );
}
