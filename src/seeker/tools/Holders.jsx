// Cluck Norris — Seeker app, Holders pane (docs/SEEKER_TOOLS_BUILD.md — registry id "holders").
//
// PASS-GATED (the unified tools pass, §5 of the build doc). Pages preview free — the explainer,
// the mint field and the empty state render to anyone; only RUN needs the pass. Rebuilt from
// public/token-holders.html's behaviour, never its markup — that page's own comment says it and
// /snapshot both serve token-holders.html (AGENTS.md's file/route mismatch warning), and its data
// call is GET /api/snapshot, not a route literally named "holders".
//
// Server: GET /api/snapshot?mint=<mint>&excludeNonHuman=0&excludeBagsTeam=0&minBalance=0
//   (server.js ~15628). Both filters are sent OFF here on purpose — this pane reports the WHOLE
//   holder set as the honest baseline (concentration stats over everyone who holds a balance) and
//   lets the per-row `type`/`category`/`bagsTeam` fields say what each address actually is, rather
//   than silently pre-filtering rows out of the number the pane reports as "holders".
//   200 { success:true, mint, decimals, totalSupply, truncated, pagesFetched,
//         bagsTeam: { isBagsToken, creators:[{wallet,username,provider,isAdmin}],
//                      excludedFromSnapshot:[{wallet,balance,pct}] } | null,
//         stats: { rawHolderCount, tokenAccountCount, humanHolderCount, contractHolderCount,
//                   filteredCount, totalHeldFiltered, totalHeldFilteredPct, excludedTotal,
//                   excludedPct, excludedBreakdown:{lp,locker,contract}, median, mean, dustCount,
//                   top10Share, top50Share, top100Share },
//         excludedTop:[{wallet,balance,category,pct}],
//         holders:[{ wallet, balance, type:"human"|"contract", bagsTeam?:true, category?, label? }] }
//   402/403 — pass_required / insufficient_holdings / bad_pass / pass_expired (toolPassGate)
//   400 { success:false, error:"Invalid mint" }
//   404 { success:false, error:"Mint not found on Solana" }
//   500 { success:false, error }
//
// "Say what's on-chain, never why": every row is a balance and a classification, never a
// safe/scam label. A holder is only ever called "creator"/"team" when `bagsTeam` is true — a
// BAGS-CONFIRMED launchpad fact (CLAUDE.md's recorded rule), never inferred from balance size.
import React from "react";
import { t, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, useOnline } from "../pane.jsx";
import { usePass } from "../pass.js";
import { PassGate, gatedToolFetch } from "../passgate.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
function fmtPct(p) {
  if (p == null) return t("Unknown");
  const v = p * 100;
  return (v < 0.01 ? "<0.01" : v.toFixed(v < 1 ? 3 : 2)) + "%";
}
function safeHref(u) { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : null; }
function solscanToken(mint) { return safeHref(`https://solscan.io/token/${encodeURIComponent(mint)}`); }
function solscanAcct(addr) { return safeHref(`https://solscan.io/account/${encodeURIComponent(addr)}`); }

// The tools-pass gate lives in ONE file — src/seeker/passgate.jsx. It used to be a 79-line
// copy in each of the three pass-gated panes, differing by a single string; see that file's
// header for why it was extracted before it drifted rather than after.

function HolderRow({ h, rank, decimals, mint }) {
  const isTeam = !!h.bagsTeam;
  const isHuman = h.type === "human";
  return (
    <div className="seeker-forensic-row">
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top">
          <span>#{rank} {shortAddr(h.wallet)}</span>
        </div>
        <div className="seeker-forensic-row-sub">
          {h.pct != null ? fmtPct(h.pct) + " " + t("of supply") : ""}
        </div>
        <span className="seeker-forensic-row-tag">
          {isTeam ? t("Team (Bags-verified)") : isHuman ? t("Wallet") : (h.label || t("Contract"))}
        </span>
      </div>
      <div className="seeker-forensic-row-value">{fmtNum(h.balance)}</div>
    </div>
  );
}

export default function HoldersPane({ wallet }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const pass = usePass();
  const [input, setInput] = React.useState("");
  const [formError, setFormError] = React.useState(null);
  const [phase, setPhase] = React.useState("form"); // form | loading | result | unavailable | refused
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [data, setData] = React.useState(null);
  const [gateOpen, setGateOpen] = React.useState(false);
  const [shown, setShown] = React.useState(30);
  const abortRef = React.useRef(null);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  function doScan(mint) {
    if (!online) { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
    setPhase("loading");
    setShown(30);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = `/api/snapshot?mint=${encodeURIComponent(mint)}&excludeNonHuman=0&excludeBagsTeam=0&minBalance=0`;
    gatedToolFetch(pass.gatedFetch, url).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        if (pass.isDenial(res.body)) { pass.refresh(); setGateOpen(true); setPhase("form"); return; }
        if (res.kind === "offline") { setPhase("unavailable"); setErrKind("offline"); setErrMsg(null); return; }
        if (res.kind === "refused") { setPhase("refused"); setErrMsg((res.body && res.body.error) || t("That mint wasn't something we could use.")); return; }
        setPhase("unavailable"); setErrKind("unavailable");
        setErrMsg(t("Could not read that token's holders from the chain right now. Try again shortly."));
        return;
      }
      // Attach `pct of supply` to each holder client-side — the server already computes it for
      // excludedTop, but the main `holders` array does not carry it, and re-deriving it per row
      // needs only totalSupply from the same response, never a second fetch.
      const supply = res.data.totalSupply || 0;
      const holders = (res.data.holders || []).map((h) => ({ ...h, pct: supply ? h.balance / supply : null }));
      setData({ ...res.data, holders });
      setPhase("result");
    });
  }

  function run() {
    const mint = input.trim();
    if (!MINT_RE.test(mint)) { setFormError(t("Enter a valid Solana token mint address.")); return; }
    setFormError(null);
    // "unsignable" — no wallet on this device can produce a signature, so a pass can never
    // be obtained here. The plain explanation is already rendered under the form; running
    // the tool anyway would just draw a real 402 from the server, so do nothing rather than
    // fire a call that cannot succeed.
    if (pass.status === "unsignable") return;
    if (pass.status === "needed") { setGateOpen(true); return; }
    doScan(mint);
  }

  function onUnlocked() { setGateOpen(false); pass.refresh(); doScan(input.trim()); }

  const runDisabled = phase === "loading" || pass.status === "loading";
  const stats = data && data.stats;

  return (
    <Pane icon="👥" title="Holders">
      <p className="seeker-tool-lede">{t("Paste any Solana token's mint to see who holds it, how concentrated it is, and what's a wallet versus a pool, lock or contract.")}</p>

      <div className="seeker-forensic-form">
        <label className="seeker-listing-label" htmlFor="hold-mint">{t("Token mint address")}</label>
        <input
          id="hold-mint"
          className="seeker-listing-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder={t("Paste a token's mint address")}
          autoComplete="off"
          spellCheck="false"
        />
        {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
        <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={run} disabled={runDisabled}>
          {phase === "loading" ? t("Reading holders…") : t("Run Holders")}
        </button>
        {pass.status === "unsignable" ? (
          <div className="seeker-tool-notyet" role="status">
            <p className="seeker-tool-notyet-title">🔒 {t("No wallet on this device can sign")}</p>
            <p>{t("The tools pass needs a signature, and this device has no wallet that can produce one yet. This resolves itself once wallet support lands in the app — nothing you can do here unlocks it early.")}</p>
          </div>
        ) : null}
      </div>

      {phase === "loading" ? <Loading label={t("Walking every token account on-chain — this can take a moment for a big token…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={() => doScan(input.trim())} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && data && data.holders.length === 0 ? (
        <Empty>{t("No holders with a balance were found for this mint.")}</Empty>
      ) : null}

      {phase === "result" && data && data.holders.length > 0 ? (
        <>
          {data.truncated ? <p className="seeker-tool-note seeker-forensic-truncnote">{t("This token has more holder pages than the scan reached — figures reflect what was scanned.")}</p> : null}

          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Total holders")}</div><div className="seeker-forensic-stat-value">{fmtInt(stats.rawHolderCount)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Wallets vs contracts")}</div><div className="seeker-forensic-stat-value">{fmtInt(stats.humanHolderCount)} / {fmtInt(stats.contractHolderCount)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Top 10 hold")}</div><div className="seeker-forensic-stat-value">{fmtPct(stats.top10Share)}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Top 100 hold")}</div><div className="seeker-forensic-stat-value">{fmtPct(stats.top100Share)}</div></div>
          </div>

          {data.bagsTeam && data.bagsTeam.isBagsToken && data.bagsTeam.creators && data.bagsTeam.creators.length ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Bags-verified creators")}</strong>
              <div className="seeker-forensic-rows" style={{ marginTop: 8 }}>
                {data.bagsTeam.creators.map((c, i) => (
                  <div className="seeker-forensic-row" key={i}>
                    <div className="seeker-forensic-row-main">{c.username || shortAddr(c.wallet)}{c.isAdmin ? " · " + t("admin") : ""}</div>
                    <div className="seeker-forensic-row-value">{c.provider || ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {stats.excludedTotal > 0 ? (
            <div className="seeker-forensic-verdict">
              <strong>{t("Held by pools, locks and contracts")}</strong>
              <p style={{ margin: "6px 0 0" }}>
                {fmtInt(stats.contractHolderCount)} {t("non-wallet holders")} — {fmtInt(stats.excludedBreakdown.lp || 0)} {t("liquidity pool")}, {fmtInt(stats.excludedBreakdown.locker || 0)} {t("locker")}, {fmtInt(stats.excludedBreakdown.contract || 0)} {t("other contract")} — {fmtPct(stats.excludedPct)} {t("of supply")}.
              </p>
            </div>
          ) : null}

          <div className="seeker-listing-card">
            <h2 className="seeker-listing-card-title">{t("Holders, largest first")}</h2>
            <div className="seeker-forensic-rows">
              {data.holders.slice(0, shown).map((h, i) => <HolderRow key={h.wallet} h={h} rank={i + 1} decimals={data.decimals} mint={data.mint} />)}
            </div>
            {data.holders.length > shown ? (
              <button type="button" className="seeker-btn seeker-btn-quiet seeker-forensic-more" onClick={() => setShown((n) => n + 30)}>
                {t("Show more")} ({shown} {t("of")} {data.holders.length})
              </button>
            ) : null}
          </div>

          {solscanToken(data.mint) ? (
            <p style={{ textAlign: "center" }}>
              <a className="seeker-forensic-link" href={solscanToken(data.mint)} target="_blank" rel="noopener noreferrer">{t("View token on Solscan")} ↗</a>
            </p>
          ) : null}
        </>
      ) : null}

      {gateOpen ? (
        <PassGate pass={pass} wallet={wallet} tool="holders" onUnlocked={onUnlocked} onClose={() => setGateOpen(false)} />
      ) : null}
    </Pane>
  );
}
