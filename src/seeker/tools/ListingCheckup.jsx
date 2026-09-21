// Cluck Norris — Seeker app, Listing Checkup pane (docs/SEEKER_TOOLS_BUILD.md).
//
// Free, read-only, no wallet, no pass — matches the "free" tier row in registry.js. Calls the
// same server the desktop tool uses, at PREVIEW tier only:
//   POST /api/listing-checkup/run  { mint, name, symbol, website?, x?, telegram?, discord?,
//                                     logo?, description?, tier: "preview" }
//   200 { ok: true, report: {...}, shareUrl }
//   400 { ok: false, error }                              — bad canonical record (rare; the form
//                                                            validates the shape client-side first)
//   429 { ok: false, error: "daily_cap_mint" | "daily_cap_ip", detail }   — from the route itself
//   429 { success:false, ok:false, error, retryAfterSec, retryAfter, windowSec } — the 15/min
//                                                            limiter mounted on the whole router
//   500 { ok: false, error }
// The FULL sweep (every source, byte-compared logos, a shareable report page) is gated by the
// unified tools pass on the website (public/listing-checkup.html — CluckGate.guard on the button).
// This pane deliberately never requests tier:"full": the doc's tier table puts Listing Checkup in
// the free/no-wallet row, and the pass flow is out of scope here (§5 of the doc covers where the
// pass belongs — RUN on a heavy tool, not this one). The preview tier already runs every check
// (chain facts, impersonators, link health, logo spec) — lib/listing-checkup-checks.js has them
// all at tier:"preview" — so nothing substantive is missing.
//
// Read the report by field, not by verdict: "correct"/"incorrect" here means "matches what you
// told us" or "differs from it" — a data-accuracy comparison against the aggregators, never a
// safety score. The UI never says safe/verified/scam/rug (CLAUDE.md, the pane contract §3).
//
// A failed run (offline, 5xx, rate limit) renders through <Unavailable>, never as an empty report
// — a report with zero sources checked would otherwise look identical to "everything's fine".
import React from "react";
import { t, tf, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_NAME = 80, MAX_SYMBOL = 20, MAX_LINK = 300, MAX_DESC = 2000;

const FIELD_LABEL = {
  name: "Name", symbol: "Symbol", website: "Website", x: "X / Twitter", telegram: "Telegram",
  discord: "Discord", logo: "Logo", description: "Description",
};
const FIELD_STATUS_LABEL = { match: "Matches", differs: "Differs", missing: "Missing there", unverified: "Could not verify" };
const SOURCE_STATUS_LABEL = { correct: "Matches your record", incorrect: "Differs from your record", "not-found": "Not listed there", unread: "Could not read" };
const LINK_STATUS_LABEL = { ok: "Reachable", broken: "Broken", redirect: "Redirects elsewhere", unverified: "Could not verify", unread: "Could not read" };

function emptyForm() {
  return { mint: "", name: "", symbol: "", website: "", x: "", telegram: "", discord: "", logo: "", description: "" };
}
// Only render a link we built or that a source claimed is http(s) — chain metadata and aggregator
// responses are attacker-controlled, and an href is not neutralised by React's text escaping the
// way a text node is (CLAUDE.md's "escape everything from chain metadata" applies to hrefs too).
// Backend-provided URLs become links only if they are http(s) — and, when the edition hands
// this pane a host allow-list, only if their host is on it. The Google Play / iOS edition does
// (store-edition v1.1.0; the v1.0.2 store page enforced the same list at render time, because a
// static verifier cannot see a link that arrives in a response). Off-list URLs render as text.
function safeHref(u, hosts) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  if (Array.isArray(hosts)) {
    try { if (!hosts.includes(new URL(s).hostname)) return null; } catch (_) { return null; }
  }
  return s;
}

function FieldRow({ row }) {
  return (
    <div className={"seeker-listing-field seeker-listing-field-" + row.status}>
      <div className="seeker-listing-field-top">
        <span className="seeker-listing-field-label">{t(FIELD_LABEL[row.field] || row.label)}</span>
        <span className="seeker-listing-field-status">{t(FIELD_STATUS_LABEL[row.status] || row.status)}</span>
      </div>
      {row.status !== "match" ? (
        <div className="seeker-listing-field-detail">
          <div><span className="seeker-listing-field-tag">{t("You say")}</span>{row.ours || t("(not given)")}</div>
          <div><span className="seeker-listing-field-tag">{t("They show")}</span>{row.theirs || t("(nothing)")}</div>
        </div>
      ) : null}
      {row.note ? <div className="seeker-listing-field-note">{row.note}</div> : null}
    </div>
  );
}

function SourceCard({ row, open, onToggle, hosts }) {
  const pageHref = safeHref(row.pageUrl, hosts);
  const fixHref = safeHref(row.fixUrl, hosts);
  const howtoHref = row.howToList ? safeHref(row.howToList.url, hosts) : null;
  return (
    <div className="seeker-listing-source">
      <button type="button" className="seeker-listing-source-head" onClick={onToggle} aria-expanded={open}>
        <span className={"seeker-listing-dot seeker-listing-dot-" + row.status} aria-hidden="true" />
        <span className="seeker-listing-source-label">{row.label}</span>
        <span className="seeker-listing-source-status">{t(SOURCE_STATUS_LABEL[row.status] || row.status)}</span>
        <span className="seeker-listing-source-chev" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="seeker-listing-source-body">
          {row.status === "unread" ? (
            <Unavailable kind="unavailable" message={row.error ? t("Could not read this source right now.") : t("Could not read this source right now.")} />
          ) : row.status === "not-found" ? (
            <>
              <Empty>{t("This site has no listing for this mint.")}</Empty>
              {row.howToList ? (
                <div className="seeker-listing-howto">
                  <p>{row.howToList.needs}</p>
                  <p className="seeker-tool-note">{t("As of")} {row.howToList.asOf}</p>
                  {howtoHref ? <a className="seeker-listing-link" href={howtoHref} target="_blank" rel="noopener noreferrer">{t("Open")} →</a> : null}
                </div>
              ) : null}
            </>
          ) : row.fields.length === 0 ? (
            <Empty>{t("It lists this token, but none of the fields you gave us are ones we can compare here.")}</Empty>
          ) : (
            row.fields.map((f) => <FieldRow key={f.field} row={f} />)
          )}
          {pageHref ? <a className="seeker-listing-link" href={pageHref} target="_blank" rel="noopener noreferrer">{t("View there")} →</a> : null}
          {fixHref ? <a className="seeker-listing-link" href={fixHref} target="_blank" rel="noopener noreferrer">{t("Fix your record")} →</a> : null}
        </div>
      ) : null}
    </div>
  );
}

function ChainFactsCard({ cf }) {
  if (!cf) return null;
  if (cf.status !== "ok" || !cf.facts) {
    return (
      <section className="seeker-listing-card">
        <h2 className="seeker-listing-card-title">{t("Chain facts")}</h2>
        <Unavailable kind="unavailable" message={t("Could not read the on-chain record.")} />
      </section>
    );
  }
  const f = cf.facts;
  const authText = (a) => (a && a.revoked ? t("Revoked") : `${t("Active")} — ${shortAddr(a && a.address)}`);
  return (
    <section className="seeker-listing-card">
      <h2 className="seeker-listing-card-title">{t("Chain facts")}</h2>
      <dl className="seeker-listing-facts">
        <div><dt>{t("Mint authority")}</dt><dd>{authText(f.mintAuthority)}</dd></div>
        <div><dt>{t("Freeze authority")}</dt><dd>{authText(f.freezeAuthority)}</dd></div>
        <div><dt>{t("Metadata")}</dt><dd>{f.metadataMutable === true ? t("Mutable") : f.metadataMutable === false ? t("Immutable") : t("Unknown")}</dd></div>
        <div><dt>{t("Token program")}</dt><dd>{f.tokenProgram || t("Unknown")}</dd></div>
      </dl>
      {cf.lpLockedPct != null ? <p className="seeker-tool-note">{t("LP locked (Rugcheck)")}: {cf.lpLockedPct}%</p> : null}
    </section>
  );
}

function ImpersonatorsCard({ data, hosts }) {
  if (!data) return null;
  if (data.status !== "ok") {
    return (
      <section className="seeker-listing-card">
        <h2 className="seeker-listing-card-title">{t("Possible impersonators")}</h2>
        <Unavailable kind="unavailable" message={t("Could not check for other mints using this name or symbol.")} />
      </section>
    );
  }
  return (
    <section className="seeker-listing-card">
      <h2 className="seeker-listing-card-title">{t("Possible impersonators")}</h2>
      <p className="seeker-tool-note">{t("Other Solana mints using this name or symbol. We report that they exist and what the sites show for them — never why.")}</p>
      {data.matches.length === 0 ? (
        <Empty>{t("No other mints found using this name or symbol.")}</Empty>
      ) : (
        data.matches.map((m) => {
          const href = safeHref(m.pairUrl, hosts);
          return (
            <div className="seeker-listing-imp" key={m.mint}>
              <div className="seeker-listing-imp-top">
                <span>{m.name || t("(no name)")}{m.symbol ? ` · ${m.symbol}` : ""}</span>
                {m.verified ? <span className="seeker-listing-imp-badge">{t("Jupiter marks: verified")}</span> : null}
              </div>
              <div className="seeker-tool-note">
                {shortAddr(m.mint)} · {t("matches on")} {(m.matchOn || []).map((x) => t(x)).join(", ")}
              </div>
              {m.liquidityUsd ? <div className="seeker-tool-note">{t("Liquidity")}: ${Math.round(m.liquidityUsd).toLocaleString()}</div> : null}
              {href ? <a className="seeker-listing-link" href={href} target="_blank" rel="noopener noreferrer">{t("View")} →</a> : null}
            </div>
          );
        })
      )}
      {data.partial ? <p className="seeker-tool-note">{t("One or more sources could not be checked for this list.")}</p> : null}
    </section>
  );
}

function LinkHealthCard({ data }) {
  if (!data || data.status !== "ok" || !data.links || data.links.length === 0) return null;
  return (
    <section className="seeker-listing-card">
      <h2 className="seeker-listing-card-title">{t("Link health")}</h2>
      {data.links.map((l) => (
        <div className="seeker-listing-linkrow" key={l.field}>
          <span className="seeker-listing-linkrow-field">{t(FIELD_LABEL[l.field] || l.field)}</span>
          <span className={"seeker-listing-linkrow-status seeker-listing-linkrow-status-" + l.status}>{t(LINK_STATUS_LABEL[l.status] || l.status)}</span>
          {l.note ? <div className="seeker-tool-note">{l.note}</div> : null}
        </div>
      ))}
    </section>
  );
}

function LogoSpecCard({ data }) {
  if (!data || data.status === "skipped") return null;
  if (data.status !== "ok") {
    return (
      <section className="seeker-listing-card">
        <h2 className="seeker-listing-card-title">{t("Logo")}</h2>
        <Unavailable kind="unavailable" message={t("Could not read the logo image.")} />
      </section>
    );
  }
  return (
    <section className="seeker-listing-card">
      <h2 className="seeker-listing-card-title">{t("Logo")}</h2>
      <p className="seeker-tool-note">
        {data.width && data.height ? `${data.width}×${data.height}` : t("Unknown size")}
        {" · "}{data.format ? data.format.toUpperCase() : t("Unknown format")}
        {data.square === false ? ` · ${t("not square")}` : ""}
        {data.https ? "" : ` · ${t("not https")}`}
      </p>
      {(data.sites || []).map((s) => (
        <div className="seeker-listing-linkrow" key={s.id}>
          <span className="seeker-listing-linkrow-field">{s.label}</span>
          <span className={"seeker-listing-linkrow-status " + (s.ok === true ? "seeker-listing-linkrow-status-ok" : s.ok === false ? "seeker-listing-linkrow-status-broken" : "seeker-listing-linkrow-status-unread")}>
            {s.ok === true ? t("Passes") : s.ok === false ? t("Would not pass") : t("Unknown")}
          </span>
          {s.why ? <div className="seeker-tool-note">{s.why}</div> : null}
        </div>
      ))}
    </section>
  );
}

export default function ListingCheckupPane({ linkHosts }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const [form, setForm] = React.useState(emptyForm());
  const [more, setMore] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | loading | result | unavailable | refused
  const [report, setReport] = React.useState(null);
  const [shareUrl, setShareUrl] = React.useState(null);
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [openSources, setOpenSources] = React.useState(() => new Set());
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function toggleSource(id) {
    setOpenSources((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function run() {
    const mint = form.mint.trim();
    const name = form.name.trim();
    const symbol = form.symbol.trim();
    if (!MINT_RE.test(mint)) { setFormError(t("Enter a valid Solana mint address.")); return; }
    if (!name) { setFormError(t("Enter the token's name.")); return; }
    if (!symbol) { setFormError(t("Enter the token's symbol.")); return; }
    setFormError(null);

    if (!online) { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }

    setPhase("loading");
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const payload = { mint, name, symbol, tier: "preview" };
    for (const k of ["website", "x", "telegram", "discord", "logo", "description"]) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }

    toolFetch("/api/listing-checkup/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).then((res) => {
      if (res.ok) {
        setReport(res.data.report);
        setShareUrl(res.data.shareUrl || null);
        setOpenSources(new Set());
        setPhase("result");
        return;
      }
      if (res.kind === "aborted") return;
      if (res.kind === "offline") { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
      if (res.kind === "refused") {
        setPhase("refused");
        setErrMsg(t("Check what you entered — one of the fields wasn't something we could use."));
        return;
      }
      // unavailable: network failure, 5xx, or a 429 from either the per-minute limiter or the
      // route's own daily-sweep cap (both land here — toolFetch never treats 429 as "refused").
      setErrKind("unavailable");
      if (res.status === 429) {
        const err = res.body && res.body.error;
        if (err === "daily_cap_mint" || err === "daily_cap_ip") {
          setErrMsg((res.body && res.body.detail) || t("Too many checkups on this today. Try again tomorrow."));
        } else {
          const retry = res.body && (res.body.retryAfterSec || res.body.retryAfter);
          setErrMsg(retry ? tf("Slow down a little. Try again in {n} seconds.", { n: retry }) : t("Slow down a little — too many checkups at once."));
        }
      } else {
        setErrMsg(t("Could not read the aggregators right now. Try again shortly."));
      }
      setPhase("unavailable");
    });
  }

  return (
    <Pane icon="📋" title="Listing Checkup">
      <p className="seeker-tool-lede">
        {t("See what CoinGecko, GeckoTerminal, DexScreener, Jupiter and the on-chain record show for a token — compared field by field against what you tell us. Free, read-only, no wallet needed.")}
      </p>

      <div className="seeker-listing-form">
        <label className="seeker-listing-label" htmlFor="lc-mint">{t("Mint address")}</label>
        <input id="lc-mint" className="seeker-listing-input" value={form.mint} onChange={(e) => setField("mint", e.target.value)} placeholder={t("Paste the mint address")} autoComplete="off" spellCheck="false" />

        <label className="seeker-listing-label" htmlFor="lc-name">{t("Token name")}</label>
        <input id="lc-name" className="seeker-listing-input" value={form.name} onChange={(e) => setField("name", e.target.value.slice(0, MAX_NAME))} placeholder={t("e.g. Cluck Norris")} autoComplete="off" />

        <label className="seeker-listing-label" htmlFor="lc-symbol">{t("Symbol")}</label>
        <input id="lc-symbol" className="seeker-listing-input" value={form.symbol} onChange={(e) => setField("symbol", e.target.value.slice(0, MAX_SYMBOL))} placeholder={t("e.g. CLKN")} autoComplete="off" />

        <button type="button" className="seeker-listing-more-toggle" onClick={() => setMore((m) => !m)}>
          {more ? t("Hide website & socials") : t("Add website & socials (optional)")}
        </button>

        {more ? (
          <div className="seeker-listing-more">
            <label className="seeker-listing-label" htmlFor="lc-website">{t("Website")}</label>
            <input id="lc-website" className="seeker-listing-input" value={form.website} onChange={(e) => setField("website", e.target.value.slice(0, MAX_LINK))} placeholder="https://…" autoComplete="off" />

            <label className="seeker-listing-label" htmlFor="lc-x">{t("X / Twitter")}</label>
            <input id="lc-x" className="seeker-listing-input" value={form.x} onChange={(e) => setField("x", e.target.value.slice(0, MAX_LINK))} placeholder={t("@handle or link")} autoComplete="off" />

            <label className="seeker-listing-label" htmlFor="lc-telegram">{t("Telegram")}</label>
            <input id="lc-telegram" className="seeker-listing-input" value={form.telegram} onChange={(e) => setField("telegram", e.target.value.slice(0, MAX_LINK))} placeholder={t("t.me/… or handle")} autoComplete="off" />

            <label className="seeker-listing-label" htmlFor="lc-discord">{t("Discord")}</label>
            <input id="lc-discord" className="seeker-listing-input" value={form.discord} onChange={(e) => setField("discord", e.target.value.slice(0, MAX_LINK))} placeholder="discord.gg/…" autoComplete="off" />

            <label className="seeker-listing-label" htmlFor="lc-logo">{t("Logo URL")}</label>
            <input id="lc-logo" className="seeker-listing-input" value={form.logo} onChange={(e) => setField("logo", e.target.value.slice(0, MAX_LINK))} placeholder="https://…/logo.png" autoComplete="off" />

            <label className="seeker-listing-label" htmlFor="lc-description">{t("Description")}</label>
            <textarea id="lc-description" className="seeker-listing-input seeker-listing-textarea" value={form.description} onChange={(e) => setField("description", e.target.value.slice(0, MAX_DESC))} placeholder={t("The one-paragraph description you use everywhere")} />
          </div>
        ) : null}

        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}

        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={run} disabled={phase === "loading"}>
          {phase === "loading" ? t("Checking…") : t("Run checkup")}
        </button>
      </div>

      {phase === "loading" ? <Loading label={t("Reading the on-chain record and every aggregator…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={run} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && report ? (
        <div className="seeker-listing-report">
          <div className="seeker-listing-summary">
            <span className="seeker-listing-chip seeker-listing-chip-correct">{report.summary.correct || 0} {t("match")}</span>
            <span className="seeker-listing-chip seeker-listing-chip-incorrect">{report.summary.incorrect || 0} {t("differ")}</span>
            <span className="seeker-listing-chip seeker-listing-chip-notfound">{report.summary["not-found"] || 0} {t("not listed")}</span>
            <span className="seeker-listing-chip seeker-listing-chip-unread">{report.summary.unread || 0} {t("unread")}</span>
          </div>

          {report.fixFirst && report.fixFirst.length > 0 ? (
            <p className="seeker-listing-fixfirst">
              {t("Fix this first — the on-chain record is what the aggregators copy:")} {report.fixFirst.map((f) => t(FIELD_LABEL[f] || f)).join(", ")}
            </p>
          ) : null}

          <ChainFactsCard cf={report.checks && report.checks.chainFacts} />

          <section className="seeker-listing-card">
            <h2 className="seeker-listing-card-title">{t("Sources")}</h2>
            {report.sources.map((row) => (
              <SourceCard key={row.id} row={row} open={openSources.has(row.id)} onToggle={() => toggleSource(row.id)} hosts={linkHosts} />
            ))}
          </section>

          <ImpersonatorsCard data={report.checks && report.checks.impersonators} hosts={linkHosts} />
          <LinkHealthCard data={report.checks && report.checks.linkHealth} />
          <LogoSpecCard data={report.checks && report.checks.logoSpec} />

          {shareUrl ? <p className="seeker-tool-note seeker-listing-share">{t("Full report")}: {shareUrl}</p> : null}
        </div>
      ) : null}
    </Pane>
  );
}
