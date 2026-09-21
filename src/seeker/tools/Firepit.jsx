// Cluck Norris — Seeker app, Firepit pane (docs/SEEKER_TOOLS_BUILD.md — registry id "firepit").
//
// ⛔ SCOPE LINE (owner-set, tonight's build): READ SIDE + CLASSIFICATION + THE FULL CONFIRM UX
// ONLY. No transaction is built, no signature is requested, nothing is sent. An adversarial
// review found a P0 in the reclaim path — `getSignatureStatuses` returns both `err` and a
// `confirmationStatus` for a transaction that LANDED AND FAILED, and testing the status first
// reported a failed burn as a success — and the identical bug was already live in
// public/airdrop-engine.js because the send/confirm logic had been copy-pasted. The hardened
// send/confirm seam is being extracted into a shared helper in a parallel fix round; signing for
// this pane lands on top of it, once, reviewed. So: tapping "Confirm and sign" here renders the
// SigningNotYet block instead of touching a wallet's signTransaction — never a fabricated result.
//
// Server: GET /api/burn-scan?wallet=<address> (server.js, read-only) —
//   200 { success:true, wallet, count, capped, rentSolTotal, valueUsdTotal,
//         accounts: [{ tokenAccount, mint, program, amountRaw, decimals, uiAmount, rentLamports,
//                       frozen, delegated, symbol, name, logo, priceUsd, valueUsd, priceKnown,
//                       empty, isNft }] }
//   400 { success:false, error }   — bad wallet address
//   500 { success:false, error }   — server/RPC trouble
//
// ⚠️ THE VALUE GUARD IS THE WHOLE POINT (CLAUDE.md, the task brief) and it is carried over
// FAITHFULLY from public/firepit.html's `burnable()` / `openConfirm()` logic and the server's own
// scan comment: `priceKnown` is true only when GeckoTerminal actually returned a price for that
// mint. A non-empty account GeckoTerminal never priced — new, low-liquidity, or a transient
// 429/5xx that dropped a whole pricing chunk — reads as `priceKnown:false`, and that is UNKNOWN
// value, never zero. This pane never says "worthless" or "safe to burn" about such a row; it says
// the value could not be read and treats it exactly like a row with a known positive value for
// every guardrail (the confirm sheet, the danger styling, the count of "still worth something").
// A failed price read is `unavailable` information, not permission to destroy the asset.
//
// "Say what's on-chain, never why" (CLAUDE.md): this pane reports balances, rent and price facts.
// It never labels a token safe, verified, scam or worthless — only what it is priced at.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Confirm, NeedsWallet, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import "./tools.css";

// Closing a wrapped-SOL account UNWRAPS it back to the owner — it is not a burn, and its value
// is never counted as "destroyed" (matches public/firepit.html's isNativeSol()).
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function fmtSol(n) {
  n = Number(n) || 0;
  return (n < 0.001 ? n.toFixed(6) : n.toFixed(4)).replace(/0+$/, "").replace(/\.$/, "") + " SOL";
}
function fmtUsd(n) {
  n = Number(n) || 0;
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBal(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });
}
// A row can be closed/burned at all only when it's not frozen and not (yet) handled as an NFT —
// NFT floor-price safety is a later phase, same as the desktop tool.
function actionable(a) { return !a.frozen && !a.isNft; }
function isWsol(a) { return a.mint === WSOL_MINT; }
// UNKNOWN value, never zero — see the header note. Only meaningful for a non-empty, non-wSOL row.
function isUnpriced(a) { return !a.empty && !isWsol(a) && a.priceKnown === false; }

function RowTags({ a }) {
  return (
    <>
      {a.frozen ? <span className="seeker-firepit-tag seeker-firepit-tag-frozen">{t("Frozen")}</span> : null}
      {a.isNft ? <span className="seeker-firepit-tag seeker-firepit-tag-nft">{t("NFT — not yet supported here")}</span> : null}
      {isUnpriced(a) ? <span className="seeker-firepit-tag seeker-firepit-tag-unknown">{t("Value unknown")}</span> : null}
      {!a.empty && !isUnpriced(a) && Number(a.valueUsd) > 0 ? <span className="seeker-firepit-tag seeker-firepit-tag-value">{t("Worth")} {fmtUsd(a.valueUsd)}</span> : null}
      {isWsol(a) ? <span className="seeker-firepit-tag">{t("Wrapped SOL — unwraps, isn't burned")}</span> : null}
    </>
  );
}

function TokenRow({ a, checked, onToggle }) {
  const canAct = actionable(a);
  return (
    <label className={"seeker-firepit-row" + (canAct ? "" : " seeker-firepit-row-disabled") + (checked ? " seeker-firepit-row-sel" : "")}>
      <input
        type="checkbox"
        className="seeker-firepit-checkbox"
        checked={!!checked}
        disabled={!canAct}
        onChange={() => onToggle(a.tokenAccount)}
        aria-label={t("Select")}
      />
      <div className="seeker-firepit-row-body">
        <div className="seeker-firepit-row-top">
          <span className="seeker-firepit-row-name">{a.symbol || t("Unknown token")}</span>
          <span className="seeker-firepit-row-rent">{fmtSol(a.rentLamports)}</span>
        </div>
        <div className="seeker-firepit-row-sub">
          {!a.empty ? <span>{fmtBal(a.uiAmount)} · </span> : null}
          <span className="seeker-firepit-row-mint">{shortAddr(a.mint)}</span>
        </div>
        <div className="seeker-firepit-row-tags"><RowTags a={a} /></div>
      </div>
    </label>
  );
}

function useToggleSet(initial) {
  const [set, setSet] = React.useState(initial || (() => new Set()));
  const toggle = React.useCallback((id) => {
    setSet((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const selectAll = React.useCallback((ids) => setSet(new Set(ids)), []);
  const clear = React.useCallback(() => setSet(new Set()), []);
  return [set, toggle, selectAll, clear, setSet];
}

export default function FirepitPane({ wallet }) {
  const online = useOnline();
  const [phase, setPhase] = React.useState("idle"); // idle | loading | result | unavailable
  const [errKind, setErrKind] = React.useState("unavailable");
  const [data, setData] = React.useState(null);
  const [selEmpty, toggleEmpty, selectAllEmpty, clearEmpty, setSelEmpty] = useToggleSet();
  const [selBurn, toggleBurn, selectAllBurn, clearBurn, setSelBurn] = useToggleSet();
  const [confirmKind, setConfirmKind] = React.useState(null); // null | "reclaim" | "burn"
  const [notice, setNotice] = React.useState(null); // { kind, count, lamports, valueUsd, unpricedCount }
  const abortRef = React.useRef(null);

  const scan = React.useCallback((address) => {
    if (!address) return;
    setPhase("loading");
    setNotice(null);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    toolFetch(`/api/burn-scan?wallet=${encodeURIComponent(address)}`, { signal: ctrl.signal }).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        setErrKind(res.kind === "offline" ? "offline" : "unavailable");
        setPhase("unavailable");
        return;
      }
      const accounts = res.data.accounts || [];
      setData(res.data);
      // Pre-select the empty (rent-only) accounts, same as the desktop tool: reclaiming them is
      // risk-free, so the total is meaningful the moment the scan lands. Nothing that could
      // destroy value is ever pre-selected.
      setSelEmpty(new Set(accounts.filter((a) => a.empty && actionable(a)).map((a) => a.tokenAccount)));
      setSelBurn(new Set());
      setPhase("result");
    });
  }, [setSelEmpty, setSelBurn]);

  React.useEffect(() => {
    if (!wallet.connected || !wallet.address) { setPhase("idle"); setData(null); return undefined; }
    scan(wallet.address);
    return () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address]);

  if (!wallet.connected) {
    return (
      <Pane icon="🔥" title="Firepit">
        <p className="seeker-tool-lede">{t("Burn worthless junk tokens and reclaim the SOL rent locked in their accounts. Non-custodial — you sign, we take nothing.")}</p>
        <NeedsWallet why="Connect your wallet to scan for junk tokens and reclaimable rent." wallet={wallet} />
      </Pane>
    );
  }

  const accounts = (data && data.accounts) || [];
  const emptyAccts = accounts.filter((a) => a.empty);
  const burnAccts = accounts.filter((a) => !a.empty);

  const selEmptyRows = emptyAccts.filter((a) => selEmpty.has(a.tokenAccount) && actionable(a));
  const selBurnRows = burnAccts.filter((a) => selBurn.has(a.tokenAccount) && actionable(a));
  const emptyLamports = selEmptyRows.reduce((s, a) => s + (Number(a.rentLamports) || 0), 0);
  const burnLamports = selBurnRows.reduce((s, a) => s + (Number(a.rentLamports) || 0), 0);
  // "Value destroyed" excludes wrapped SOL (unwrapping isn't destruction) but INCLUDES unpriced
  // rows in spirit — their dollar figure is 0 in this sum by necessity (we have no number for
  // them), which is exactly why the unpriced count below is reported alongside it, never in
  // place of it.
  const burnValueUsd = selBurnRows.reduce((s, a) => s + (isWsol(a) ? 0 : Number(a.valueUsd) || 0), 0);
  const burnUnpriced = selBurnRows.filter((a) => isUnpriced(a));

  function openConfirm(kind) {
    if (kind === "reclaim" && selEmptyRows.length === 0) return;
    if (kind === "burn" && selBurnRows.length === 0) return;
    setConfirmKind(kind);
  }
  function cancelConfirm() { setConfirmKind(null); }
  function onConfirmed() {
    // ⛔ NO SIGNING TONIGHT. See the file header — this is the deliberate stop, not a bug.
    const kind = confirmKind;
    setConfirmKind(null);
    if (kind === "reclaim") {
      setNotice({ kind, count: selEmptyRows.length, lamports: emptyLamports });
    } else {
      setNotice({ kind, count: selBurnRows.length, lamports: burnLamports, valueUsd: burnValueUsd, unpricedCount: burnUnpriced.length });
    }
  }

  const reclaimLines = [
    <span key="c">{t("Accounts to close")}: <strong>{selEmptyRows.length}</strong></span>,
    <span key="s">{t("SOL returning to your wallet")}: <strong>{fmtSol(emptyLamports)}</strong></span>,
    <span key="n">{t("These accounts are empty — nothing of value is destroyed.")}</span>,
  ];
  const burnLines = [
    <span key="c">{t("Accounts affected")}: <strong>{selBurnRows.length}</strong></span>,
    <span key="s">{t("SOL returning to your wallet")}: <strong>{fmtSol(burnLamports)}</strong></span>,
    burnValueUsd > 0 ? <span key="v">{t("Known value being destroyed")}: <strong className="seeker-firepit-destroyval">{fmtUsd(burnValueUsd)}</strong></span> : null,
    burnUnpriced.length > 0 ? (
      <span key="u">{burnUnpriced.length} {burnUnpriced.length === 1 ? t("token could not be priced — its value is unknown, not zero. It may be worth money.") : t("tokens could not be priced — their value is unknown, not zero. They may be worth money.")}</span>
    ) : null,
    <span key="p">{t("This burns the token balance permanently. It cannot be undone — the tokens cannot be recovered.")}</span>,
  ].filter(Boolean);

  return (
    <Pane icon="🔥" title="Firepit">
      <p className="seeker-tool-lede">{t("Burn worthless junk tokens and reclaim the SOL rent locked in their accounts. Non-custodial — you sign, we take nothing. Every token is priced live, and anything still worth money — or whose value we couldn't read — is flagged before it can burn.")}</p>

      {phase === "loading" ? <Loading label={t("Scanning your wallet on-chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} onRetry={() => scan(wallet.address)} /> : null}

      {phase === "result" && accounts.length === 0 ? (
        <Empty>{t("Clean wallet — no token accounts to burn or reclaim.")}</Empty>
      ) : null}

      {phase === "result" && accounts.length > 0 ? (
        <>
          {data && data.capped ? <p className="seeker-tool-note">{t("More accounts exist in this wallet than are shown here (first 200).")}</p> : null}

          <section className="seeker-firepit-section">
            <h2 className="seeker-firepit-section-title">{t("Reclaim rent — empty accounts")}</h2>
            <p className="seeker-tool-note">{t("These accounts hold a zero balance but still lock a small SOL deposit. Closing them is risk-free — nothing of value is destroyed, only the deposit comes back to you.")}</p>
            {emptyAccts.length === 0 ? (
              <Empty>{t("No empty accounts to reclaim right now.")}</Empty>
            ) : (
              <>
                <div className="seeker-firepit-toolbar">
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => selectAllEmpty(emptyAccts.filter(actionable).map((a) => a.tokenAccount))}>{t("Select all")}</button>
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={clearEmpty}>{t("Clear")}</button>
                </div>
                <div className="seeker-firepit-rows">
                  {emptyAccts.map((a) => <TokenRow key={a.tokenAccount} a={a} checked={selEmpty.has(a.tokenAccount)} onToggle={toggleEmpty} />)}
                </div>
                <div className="seeker-firepit-actionrow">
                  <span className="seeker-firepit-actiontotal">{t("You'll receive")}: <strong>{fmtSol(emptyLamports)}</strong></span>
                  <button type="button" className="seeker-btn" disabled={selEmptyRows.length === 0} onClick={() => openConfirm("reclaim")}>{t("Reclaim")}</button>
                </div>
              </>
            )}
          </section>

          <section className="seeker-firepit-section">
            <h2 className="seeker-firepit-section-title">{t("Burn tokens — and reclaim rent too")}</h2>
            <p className="seeker-tool-note">{t("These accounts hold a balance. Burning it is permanent — read the confirm step carefully before anything is destroyed.")}</p>
            {burnAccts.length === 0 ? (
              <Empty>{t("No tokens with a balance found.")}</Empty>
            ) : (
              <>
                <div className="seeker-firepit-toolbar">
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => selectAllBurn(burnAccts.filter(actionable).map((a) => a.tokenAccount))}>{t("Select all")}</button>
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={clearBurn}>{t("Clear")}</button>
                </div>
                <div className="seeker-firepit-rows">
                  {burnAccts.map((a) => <TokenRow key={a.tokenAccount} a={a} checked={selBurn.has(a.tokenAccount)} onToggle={toggleBurn} />)}
                </div>
                <div className="seeker-firepit-actionrow">
                  <span className="seeker-firepit-actiontotal">
                    {burnValueUsd > 0 ? <>{t("Value to destroy")}: <strong className="seeker-firepit-destroyval">{fmtUsd(burnValueUsd)}</strong></> : t("Reclaim")}: <strong>{fmtSol(burnLamports)}</strong>
                  </span>
                  <button type="button" className="seeker-btn seeker-btn-danger" disabled={selBurnRows.length === 0} onClick={() => openConfirm("burn")}>{t("Burn")}</button>
                </div>
              </>
            )}
          </section>

          <button type="button" className="seeker-btn seeker-btn-quiet seeker-firepit-rescan" disabled={!online} onClick={() => scan(wallet.address)}>{t("Rescan")}</button>
        </>
      ) : null}

      <Confirm
        open={confirmKind === "reclaim"}
        title="Confirm reclaim"
        lines={reclaimLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
      />
      <Confirm
        open={confirmKind === "burn"}
        title="Confirm burn"
        lines={burnLines}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />

      {notice ? (
        <div className="seeker-tool-notyet" role="status">
          <p className="seeker-tool-notyet-title">🚧 {t("Signing lands in the next build")}</p>
          <p>{t("Nothing was sent or signed. This build ships the scan, the value guard and this confirm step; the actual burn/close transaction ships in a follow-up build on a hardened, shared send-and-confirm helper.")}</p>
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => setNotice(null)}>{t("OK")}</button>
        </div>
      ) : null}
    </Pane>
  );
}
