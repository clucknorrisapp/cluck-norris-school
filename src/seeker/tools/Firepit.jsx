// Cluck Norris — Seeker app, Firepit pane (docs/SEEKER_TOOLS_BUILD.md — registry id "firepit").
//
// Signs and sends. Every transaction goes through src/seeker/sign.js's signSendConfirm() — the
// app's one signing seam (confirmation-err-first, three outcomes, live-pubkey re-read, message-
// byte diff). This file does not re-implement any of that.
//
// Server: GET /api/burn-scan?wallet=<address> (server.js, read-only) —
//   200 { success:true, wallet, count, capped, rentSolTotal, valueUsdTotal,
//         surplusAvailable, surplusLamportsTotal, surplusSolTotal,
//         accounts: [{ tokenAccount, mint, program, amountRaw, decimals, uiAmount, rentLamports,
//                       frozen, delegated, space, isNative, owner, symbol, name, logo, priceUsd,
//                       valueUsd, priceKnown, rentExemptLamports, surplusLamports, surplusEligible,
//                       empty, isNft }] }
//   400 { success:false, error }   — bad wallet address
//   500 { success:false, error }   — server/RPC trouble
// Firepit has no receipt/broadcast endpoint of its own (unlike Project Burn) — this pane never
// calls /api/burn-receipt; that is a Project Burn feature for a project's OWN token, and firepit's
// desktop page (public/firepit.html) does not call it either. Confirmed by reading it.
//
// ── surplus rent (WithdrawExcessLamports), added 2026-09-25 ─────────────────────────────
// A rent-parameter cut (e.g. the p-token/SIMD-0266 rollout) lowers the network's rent-exempt
// minimum without touching what an already-open account deposited, so some accounts now hold more
// SOL than today's rule requires — on top of, not instead of, the ordinary close-to-reclaim job
// above. This pulls ONLY that surplus (instruction opcode 38, both token programs), NEVER closes
// the account and NEVER touches its token balance. `surplusEligible` is the server's OWN decision
// (lib/rent-surplus.js: excludes wrapped SOL, an owner mismatch, and any surplus that is zero or
// unreadable) — this pane trusts that flag rather than re-deriving it, the same way it trusts
// `empty` for the close job. `surplusLamports`/`rentExemptLamports` are `null` (never 0) when the
// server couldn't read today's minimum; `surplusAvailable` is the wallet-wide version of the same
// fact. Carried over faithfully from public/firepit.html's own surplus job — see that file for the
// same guardrails documented from the desktop side.
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
// ⚠️ FRESH READ BEFORE SIGNING: tapping Reclaim/Burn does not open the confirm sheet on
// whatever the last scan happened to hold — it re-scans on-chain right then, matches the fresh
// rows back to what was selected, and freezes THAT exact list (`confirmSel`, same role as
// firepit.html's variable of the same name). The transaction-building step reads only that frozen
// list; it never recomputes the selection at signing time, so a checkbox that changes while the
// sheet is open (or a row that closed/emptied between scans) cannot silently swap what gets signed.
//
// ⚠️ NEVER BURN WRAPPED SOL (firepit.html, by name): closing a wSOL account just UNWRAPS it back
// to the owner's SOL balance — it is not a burn, and its value is never counted as destroyed.
//
// Amounts sent to the chain are `amountRaw` (base units) from the server's scan, exact strings —
// never `uiAmount` (a float) and never a float multiply.
//
// "Say what's on-chain, never why" (CLAUDE.md): this pane reports balances, rent and price facts.
// It never labels a token safe, verified, scam or worthless — only what it is priced at.
import React from "react";
import { t, tf, useI18nReady } from "../i18n.js";
import { Pane, Loading, Empty, Unavailable, Refused, Confirm, toolFetch, useOnline } from "../pane.jsx";
import { NeedsWallet } from "../needswallet.jsx";
import { shortAddr } from "../addr.js";
import { signSendConfirm, splTokenShim } from "../sign.js";
import "./tools.css";

// Closing a wrapped-SOL account UNWRAPS it back to the owner — it is not a burn, and its value
// is never counted as "destroyed" (matches public/firepit.html's isNativeSol()).
const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Token accounts per transaction (burn + close = up to 2 instructions each) — matches
// firepit.html's CHUNK, kept well under the 1232-byte tx limit.
const CHUNK = 8;
// The surplus job is ONE instruction per account (no burn/close pair), so more fit per
// transaction — matches firepit.html's CHUNK_SURPLUS.
const CHUNK_SURPLUS = 16;

// ⚠️ THIS TAKES LAMPORTS. It used to take SOL — and every one of its eight call sites in this
// file passes lamports, so the whole tool was rendering its SOL figures a BILLION times too big:
// a row's rent showed as "2039280 SOL" instead of "0.00204 SOL", including on the action line
// directly above the Burn button and on the confirm sheet.
//
// Found on 2026-09-21 by the new boot-test section L, whose "the SOL returning includes the
// wrapped balance" assertion could not match any plausible number — not by either adversarial
// review pass, and not by any source scan, because nothing about `fmtSol(a.rentLamports)` looks
// wrong until you read what fmtSol does with it. That is the whole argument for a behavioural
// test on a surface that states amounts.
//
// Rent Reclaim already had this right: delegate to CluckRentMath (the shared, tested converter)
// and keep a local fallback with the SAME contract for a page where it has not loaded.
function fmtSol(lamports) {
  try {
    if (typeof window !== "undefined" && window.CluckRentMath && typeof window.CluckRentMath.fmtSol === "function") {
      return window.CluckRentMath.fmtSol(lamports);
    }
  } catch (_) {}
  return (Number(lamports || 0) / 1e9).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") + " SOL";
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

// ⚠️ NEVER read `a.empty` directly (adversarial review P1-6, 2026-09-21). The server used to
// derive that flag from `uiAmount`, which is `f64 | null` in the RPC schema — so any account a
// node declined to ui-scale (the Token-2022 withheld-transfer-fee case) came back `empty: true`
// while still holding a balance. This pane PRE-SELECTS every empty row, the only place in the
// app that pre-selects anything, and then tells the person "these accounts are empty — nothing
// of value is destroyed".
//
// The server side is fixed. This check exists anyway, and is not belt-and-braces: the store
// build is a PINNED bundle (docs/STORE_EDITION.md) talking to whatever the live API is that day,
// so an installed app can be older or newer than the server that answers it. A sentence this
// load-bearing should not depend on which side is which.
//
// `amountRaw` is the base-unit integer STRING the same response already carries. Anything that
// is not a clean integer string is UNREADABLE, and unreadable is not empty.
function isEmpty(a) {
  const raw = a && a.amountRaw;
  return typeof raw === "string" && /^[0-9]+$/.test(raw) && Number(raw) === 0;
}
// UNKNOWN value, never zero — see the header note. Only meaningful for a non-empty, non-wSOL row.
function isUnpriced(a) { return !isEmpty(a) && !isWsol(a) && a.priceKnown === false; }
// The server's OWN decision (lib/rent-surplus.js) on whether this account is a candidate for the
// surplus job — never re-derived here. `surplusLamports`/`rentExemptLamports` are `null` (never a
// fabricated 0) when the minimum couldn't be read, and this flag is already false in that case.
function surplusEligible(a) { return a && a.surplusEligible === true; }

function RowTags({ a }) {
  return (
    <>
      {a.frozen ? <span className="seeker-firepit-tag seeker-firepit-tag-frozen">{t("Frozen")}</span> : null}
      {a.isNft ? <span className="seeker-firepit-tag seeker-firepit-tag-nft">{t("NFT — not yet supported here")}</span> : null}
      {isUnpriced(a) ? <span className="seeker-firepit-tag seeker-firepit-tag-unknown">{t("Value unknown")}</span> : null}
      {!isEmpty(a) && !isUnpriced(a) && Number(a.valueUsd) > 0 ? <span className="seeker-firepit-tag seeker-firepit-tag-value">{t("Worth")} {fmtUsd(a.valueUsd)}</span> : null}
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
          {!isEmpty(a) ? <span>{fmtBal(a.uiAmount)} · </span> : null}
          <span className="seeker-firepit-row-mint">{shortAddr(a.mint)}</span>
        </div>
        <div className="seeker-firepit-row-tags"><RowTags a={a} /></div>
      </div>
    </label>
  );
}

// The surplus job's own row — a different instruction (WithdrawExcessLamports, not burn/close),
// so it shows different numbers: the surplus itself (the amount that would move), and what the
// account currently holds vs. today's minimum. Frozen accounts ARE offered here (no `actionable()`
// gate, unlike TokenRow): this is a pure lamport operation, never a token move, so a frozen state
// has no bearing on it (CLAUDE.md / the task brief: "Frozen accounts are FINE").
function SurplusRow({ a, checked, onToggle }) {
  return (
    <label className={"seeker-firepit-row" + (checked ? " seeker-firepit-row-sel" : "")}>
      <input
        type="checkbox"
        className="seeker-firepit-checkbox"
        checked={!!checked}
        onChange={() => onToggle(a.tokenAccount)}
        aria-label={t("Select")}
      />
      <div className="seeker-firepit-row-body">
        <div className="seeker-firepit-row-top">
          <span className="seeker-firepit-row-name">{a.symbol || t("Unknown token")}</span>
          <span className="seeker-firepit-row-rent">{fmtSol(a.surplusLamports)}</span>
        </div>
        <div className="seeker-firepit-row-sub">
          {tf("{cur} now, {min} required", { cur: fmtSol(a.rentLamports), min: fmtSol(a.rentExemptLamports) })} · <span className="seeker-firepit-row-mint">{shortAddr(a.mint)}</span>
        </div>
        <div className="seeker-firepit-row-tags">
          {a.frozen ? <span className="seeker-firepit-tag seeker-firepit-tag-frozen">{t("Frozen")}</span> : null}
        </div>
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

// The three (well, four — declined joins them) post-signature outcomes, one look each, never a
// dimmed version of another. Reuses Airdropper's row classes (tools.css §2j) and forensic row
// shape (§2g) rather than a fourth private copy of the same idea; declined gets its own neutral
// class defined in this pane's own §2d (nothing went wrong, so it must not look like a failure).
const OUTCOME_LABEL = {
  sent: "Done",
  failed: "Failed",
  unconfirmed: "Unconfirmed",
  declined: "Declined — nothing sent",
};
const OUTCOME_CLASS = {
  sent: " seeker-drop-row-sent",
  failed: " seeker-drop-row-failed",
  unconfirmed: " seeker-drop-row-unconfirmed",
  declined: " seeker-firepit-row-declined",
};
// `kind` picks which figure this outcome is actually about — every account now carries BOTH
// `rentLamports` (its full balance) and `surplusLamports` (the surplus above today's minimum), so
// a surplus-job outcome must show the surplus it asked for, never the account's whole balance.
function OutcomeRow({ a, status, error, kind }) {
  const amount = kind === "surplus" ? a.surplusLamports : a.rentLamports;
  return (
    <div className={"seeker-forensic-row" + (OUTCOME_CLASS[status] || "")}>
      <div className="seeker-forensic-row-main">
        <div className="seeker-forensic-row-top"><span>{a.symbol || shortAddr(a.mint)}</span></div>
        <div className="seeker-forensic-row-sub">
          {t(OUTCOME_LABEL[status] || status)}{error ? ` · ${error}` : ""}
        </div>
      </div>
      <div className="seeker-forensic-row-value">{fmtSol(amount)}</div>
    </div>
  );
}

export default function FirepitPane({ wallet }) {
  // Re-render when the dictionary lands. <Pane> subscribes too, but React does not re-render
  // children it was handed as props, so this pane's own t() strings need their own subscription.
  useI18nReady();
  const online = useOnline();
  const [phase, setPhase] = React.useState("idle"); // idle | loading | result | unavailable | refused
  const [errKind, setErrKind] = React.useState("unavailable");
  const [errMsg, setErrMsg] = React.useState(null);
  const [data, setData] = React.useState(null);
  const [selEmpty, toggleEmpty, selectAllEmpty, clearEmpty, setSelEmpty] = useToggleSet();
  const [selBurn, toggleBurn, selectAllBurn, clearBurn, setSelBurn] = useToggleSet();
  const [selSurplus, toggleSurplus, selectAllSurplus, clearSurplus, setSelSurplus] = useToggleSet();
  const [confirmKind, setConfirmKind] = React.useState(null); // null | "reclaim" | "burn" | "surplus"
  // confirmPhase: "idle" (no sheet) | "checking" (fresh re-read in flight) | "ready" (sheet open,
  // signing frozen against confirmSel) | "stale" (nothing selected survived the re-read) | "error"
  const [confirmPhase, setConfirmPhase] = React.useState("idle");
  const [confirmSel, setConfirmSel] = React.useState([]);   // the exact rows the sheet showed — see header note
  const [busy, setBusy] = React.useState(false);
  const [runMsg, setRunMsg] = React.useState("");
  const [runResults, setRunResults] = React.useState([]);   // [{ a, status, sig, error }] flattened, in send order
  const [runNotAttempted, setRunNotAttempted] = React.useState(0);
  const abortRef = React.useRef(null);
  const confirmAbortRef = React.useRef(null);

  const scan = React.useCallback((address) => {
    if (!address) return;
    setPhase("loading");
    setRunResults([]);   // a fresh scan retires any earlier run report — it must not persist forever
    setRunNotAttempted(0);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    toolFetch(`/api/burn-scan?wallet=${encodeURIComponent(address)}`, { signal: ctrl.signal }).then((res) => {
      if (res.kind === "aborted") return;
      if (!res.ok) {
        // A 4xx here is the wallet address itself, not the chain — ListingCheckup/ProjectBurn's
        // same split: `refused` gets the server's own error/detail (the person can fix it),
        // everything else (offline, 5xx, rate limit) is `unavailable` (never their fault).
        if (res.kind === "refused") {
          setPhase("refused");
          setErrMsg((res.body && (res.body.error || res.body.detail)) || t("That address wasn't something we could use."));
          return;
        }
        setErrKind(res.kind === "offline" ? "offline" : "unavailable");
        setErrMsg(null);
        setPhase("unavailable");
        return;
      }
      const accounts = res.data.accounts || [];
      setData(res.data);
      // Pre-select the empty (rent-only) accounts, same as the desktop tool: reclaiming them is
      // risk-free, so the total is meaningful the moment the scan lands. Nothing that could
      // destroy value is ever pre-selected.
      setSelEmpty(new Set(accounts.filter((a) => isEmpty(a) && actionable(a)).map((a) => a.tokenAccount)));
      setSelBurn(new Set());
      // Unlike the empty-reclaim job, the surplus job is NEVER pre-selected: it can legitimately
      // apply to dozens of accounts a wallet still actively uses (a rent cut touches everything
      // opened before it), so "select everything" has to be a deliberate tap, not a default.
      setSelSurplus(new Set());
      setPhase("result");
    });
  }, [setSelEmpty, setSelBurn, setSelSurplus]);

  React.useEffect(() => {
    if (!wallet.connected || !wallet.address) { setPhase("idle"); setData(null); return undefined; }
    scan(wallet.address);
    return () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address]);

  React.useEffect(() => () => { try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {} }, []);

  if (!wallet.connected) {
    return (
      <Pane icon="🔥" title="Firepit">
        <p className="seeker-tool-lede">{t("Burn worthless junk tokens and reclaim the SOL rent locked in their accounts. Non-custodial — you sign, we take nothing.")}</p>
        <NeedsWallet why="Connect your wallet to scan for junk tokens and reclaimable rent." wallet={wallet} />
      </Pane>
    );
  }

  const accounts = (data && data.accounts) || [];
  const emptyAccts = accounts.filter((a) => isEmpty(a));
  const burnAccts = accounts.filter((a) => !isEmpty(a));

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

  const surplusAccts = accounts.filter(surplusEligible);
  const surplusUnavailable = data && data.surplusAvailable === false;
  const selSurplusRows = surplusAccts.filter((a) => selSurplus.has(a.tokenAccount));
  const surplusLamportsSel = selSurplusRows.reduce((s, a) => s + (Number(a.surplusLamports) || 0), 0);
  // An estimated network fee so "tiny surpluses may not be worth the fee" (the task brief) is
  // visible, not just the gross — one signature per CHUNK_SURPLUS accounts at the standard base
  // fee; the wallet shows the exact figure at signing.
  const surplusTxCount = selSurplusRows.length ? Math.ceil(selSurplusRows.length / CHUNK_SURPLUS) : 0;
  const surplusFeeLamports = surplusTxCount * 5000;
  const surplusNetLamports = Math.max(0, surplusLamportsSel - surplusFeeLamports);

  // ── open the confirm sheet on a FRESH chain read (see header note) ─────────────────────────
  async function openConfirm(kind) {
    const rows = kind === "reclaim" ? selEmptyRows : kind === "surplus" ? selSurplusRows : selBurnRows;
    if (!rows.length) return;
    const ids = new Set(rows.map((a) => a.tokenAccount));
    setConfirmKind(kind);
    setConfirmPhase("checking");
    setConfirmSel([]);
    try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    confirmAbortRef.current = ctrl;
    const res = await toolFetch(`/api/burn-scan?wallet=${encodeURIComponent(wallet.address)}`, { signal: ctrl.signal });
    if (res.kind === "aborted") return;
    if (!res.ok) { setConfirmPhase("error"); return; }
    const freshAccounts = res.data.accounts || [];
    // Keep the underlying page in step with the same fresh read — never leave it showing an
    // older scan next to a sheet built from a newer one.
    setData(res.data);
    setSelEmpty((s) => { const ok = new Set(freshAccounts.filter((a) => isEmpty(a) && actionable(a)).map((a) => a.tokenAccount)); const n = new Set(); s.forEach((id) => { if (ok.has(id)) n.add(id); }); return n; });
    setSelBurn((s) => { const ok = new Set(freshAccounts.filter((a) => !isEmpty(a) && actionable(a)).map((a) => a.tokenAccount)); const n = new Set(); s.forEach((id) => { if (ok.has(id)) n.add(id); }); return n; });
    setSelSurplus((s) => { const ok = new Set(freshAccounts.filter(surplusEligible).map((a) => a.tokenAccount)); const n = new Set(); s.forEach((id) => { if (ok.has(id)) n.add(id); }); return n; });
    const matched = kind === "surplus"
      ? freshAccounts.filter((a) => ids.has(a.tokenAccount) && surplusEligible(a))
      : freshAccounts.filter((a) => ids.has(a.tokenAccount) && actionable(a) && (kind === "reclaim" ? isEmpty(a) : !isEmpty(a)));
    if (!matched.length) { setConfirmPhase("stale"); return; }
    setConfirmSel(matched);
    setConfirmPhase("ready");
  }
  function cancelConfirm() { setConfirmKind(null); setConfirmPhase("idle"); setConfirmSel([]); }

  // ── build + sign, exactly the frozen confirmSel — never a recomputed selection ─────────────
  async function onConfirmed() {
    const sel = confirmSel;
    const kind = confirmKind;   // captured BEFORE the reset below — every branch past this point reads `kind`, never state
    setConfirmKind(null);
    setConfirmPhase("idle");
    setConfirmSel([]);
    if (!sel.length) return;

    setBusy(true);
    setRunResults([]);
    setRunNotAttempted(0);
    const collected = [];
    const chunks = [];
    // The surplus job is ONE instruction per account (no burn/close pair), so more fit per
    // transaction — matches firepit.html's CHUNK_SURPLUS.
    const chunkSize = kind === "surplus" ? CHUNK_SURPLUS : CHUNK;
    for (let i = 0; i < sel.length; i += chunkSize) chunks.push(sel.slice(i, i + chunkSize));

    // One builder, used for a full chunk and for a single-account retry alike — a second copy is
    // how the two would drift apart, and one of them handles money.
    const buildFor = (group) => (web3, blockhash, owner) => {
      const { Transaction, PublicKey } = web3;
      const spl = splTokenShim();
      const ownerKey = new PublicKey(owner);
      const tx = new Transaction();
      group.forEach((a) => {
        const ta = new PublicKey(a.tokenAccount);
        if (kind === "surplus") {
          // WithdrawExcessLamports — pulls ONLY the surplus above today's rent-exempt minimum.
          // Never touches the token balance, never closes the account. Destination AND authority
          // are ALWAYS the connected wallet — never user-editable (CLAUDE.md guardrail).
          tx.add(spl.createWithdrawExcessLamportsInstruction(ta, ownerKey, ownerKey, a.program));
          return;
        }
        const mint = new PublicKey(a.mint);
        // Burn any balance to zero first — but NEVER "burn" wrapped SOL; closing it just
        // unwraps it back to SOL (header note, and firepit.html by name).
        if (!isEmpty(a) && !isWsol(a)) {
          tx.add(spl.createBurnCheckedInstruction(ta, mint, ownerKey, a.amountRaw, a.decimals, a.program));
        }
        // Close the (now-empty) account and send its rent to the owner.
        tx.add(spl.createCloseAccountInstruction(ta, ownerKey, ownerKey, a.program));
      });
      tx.feePayer = ownerKey;
      tx.recentBlockhash = blockhash;
      return tx;
    };
    const signGroup = (group) => signSendConfirm({
      provider: wallet.provider,
      owner: wallet.address,
      skipPreflight: true,   // matches firepit.html — preflight runs at 'finalized' and rejects a fresh 'confirmed' blockhash
      build: buildFor(group),
    });

    let declined = false;
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      setRunMsg(`${t("Approve transaction")} ${c + 1} ${t("of")} ${chunks.length} ${t("in your wallet…")}`);
      // eslint-disable-next-line no-await-in-loop
      const res = await signGroup(chunk);

      // ⚠️ A CHUNK IS ONE ATOMIC TRANSACTION, so ONE poisoned account fails all eight — and this
      // loop used to mark all eight "Failed" and then `break`, abandoning every remaining chunk
      // (adversarial review P2-7, 2026-09-21). With 24 accounts selected and one Token-2022
      // account carrying withheld fees, 8 rows failed, 16 were "never attempted", nothing
      // identified the poisoned row, and re-running reproduced it exactly — the only way forward
      // was bisecting the selection by hand.
      //
      // Rent Reclaim already solved this (rent-reclaim-plan.js's P1-D): re-plan a chunk that
      // failed OUTRIGHT as one transaction per account and retry once. Same rules here:
      //   · only a FAILED chunk, never a declined one (a decline is a normal "no")
      //   · and never an UNCONFIRMED one — those may have landed, and re-signing them is the
      //     double-spend this codebase keeps having to relearn
      //   · a chunk of one is not re-planned; resending the identical failing transaction gains
      //     nothing a manual retry would not
      if (res.status === "declined") {
        collected.push({ chunk, status: res.status, sig: res.sig, error: res.error });
        declined = true;
      } else if (res.status === "failed" && chunk.length > 1) {
        setRunMsg(t("One of these was refused — retrying them one at a time so the rest still go through…"));
        // eslint-disable-next-line no-await-in-loop
        for (const a of chunk) {
          // eslint-disable-next-line no-await-in-loop
          const one = await signGroup([a]);
          collected.push({ chunk: [a], status: one.status, sig: one.sig, error: one.error });
          setRunResults(collected.flatMap(({ chunk: ch, status, sig, error }) => ch.map((x) => ({ a: x, status, sig, error, kind }))));
          if (one.status === "declined") { declined = true; break; }
        }
      } else {
        collected.push({ chunk, status: res.status, sig: res.sig, error: res.error });
      }
      setRunResults(collected.flatMap(({ chunk: ch, status, sig, error }) => ch.map((a) => ({ a, status, sig, error, kind }))));

      // A decline is the one thing that still stops the run: the person said no, and asking them
      // again for every remaining chunk is not a guardrail, it is nagging.
      if (declined) {
        setRunNotAttempted(sel.length - collected.reduce((n, r) => n + r.chunk.length, 0));
        break;
      }
      // "unconfirmed" continues to the next chunk (matches firepit.html) — it may still land, and
      // stopping the whole run over one ambiguous chunk would leave easy, safe reclaims undone.
      // A genuinely failed account now continues too: its neighbours are not its fault.
    }

    // Only act on rows we watched actually land (status "sent") — an unconfirmed or failed row is
    // untouched on-chain and must stay in the list so Rescan can re-check it truthfully.
    const sentIds = new Set();
    collected.forEach(({ chunk, status }) => { if (status === "sent") chunk.forEach((a) => sentIds.add(a.tokenAccount)); });
    if (sentIds.size) {
      if (kind === "surplus") {
        // Unlike reclaim/burn, the account is NOT removed — it is still open and still holds its
        // tokens, exactly as promised. Optimistically mark it as having no remaining surplus (so
        // it drops out of THIS job's table) rather than trusting the requested amount as what
        // arrived; a Rescan re-reads the real chain state (CLAUDE.md: "report what actually
        // arrived", not what was asked for).
        setData((d) => (d ? { ...d, accounts: (d.accounts || []).map((a) => (sentIds.has(a.tokenAccount) ? { ...a, surplusLamports: 0, surplusEligible: false } : a)) } : d));
        setSelSurplus((s) => { const n = new Set(s); sentIds.forEach((id) => n.delete(id)); return n; });
      } else {
        setData((d) => (d ? { ...d, accounts: (d.accounts || []).filter((a) => !sentIds.has(a.tokenAccount)) } : d));
        setSelEmpty((s) => { const n = new Set(s); sentIds.forEach((id) => n.delete(id)); return n; });
        setSelBurn((s) => { const n = new Set(s); sentIds.forEach((id) => n.delete(id)); return n; });
      }
    }
    setRunMsg("");
    setBusy(false);
  }

  // ⚠️ A COUNT IS NOT AN ACCOUNT OF WHAT IS ABOUT TO HAPPEN (adversarial review P1-3,
  // 2026-09-21). The burn sheet said "Accounts affected: 12" and named not one symbol, mint or
  // amount — on the one screen standing between a mis-tap and a permanent, unrecoverable burn.
  // Worse, openConfirm can legitimately SHRINK the set between the tick and the sheet (a fresh
  // re-read drops anything that stopped qualifying), so the number could differ from what was
  // ticked with no row-level account of which rows went.
  //
  // public/firepit.html — which this pane's own header claims to carry over faithfully — has had
  // both this list and the typed gate from the start. They are the two pieces of friction that
  // were dropped, and they are the two that matter.
  //
  // Row text mirrors the desktop's wording per case: reclaim / unwrap / burn, with the amount in
  // the person's own units and the value beside it, or "value unknown" — never a silent $0 for a
  // token we simply could not price.
  function confirmRowFor(a) {
    const v = Number(a.valueUsd) || 0;
    let right;
    // Checked FIRST: a surplus-job row can also be `isEmpty(a)` (an empty account can still carry
    // a surplus), and must never fall through to the close-job's "reclaim X SOL" wording — that
    // would understate what stays behind and imply the account is being closed, which it is not.
    if (confirmKind === "surplus") right = `${t("pull")} ${fmtSol(Number(a.surplusLamports) || 0)} · ${t("stays open")}`;
    else if (isEmpty(a)) right = `${t("reclaim")} ${fmtSol(Number(a.rentLamports) || 0)}`;
    else if (isWsol(a)) right = `${t("unwrap")} ${fmtBal(a.uiAmount)} SOL → ${t("back to you")}`;
    else if (isUnpriced(a)) right = `${t("burn")} ${fmtBal(a.uiAmount)} · ${t("value unknown")}`;
    else right = `${t("burn")} ${fmtBal(a.uiAmount)} · ${v > 0 ? fmtUsd(v) : "$0"}`;
    return { key: a.tokenAccount, left: a.symbol || shortAddr(a.mint), right };
  }
  const confirmRows = confirmSel.map(confirmRowFor);

  const reclaimLines = confirmKind === "reclaim" ? [
    <span key="c">{t("Accounts to close")}: <strong>{confirmSel.length}</strong></span>,
    <span key="s">{t("SOL returning to your wallet")}: <strong>{fmtSol(confirmSel.reduce((s, a) => s + (Number(a.rentLamports) || 0), 0))}</strong></span>,
    <span key="n">{t("These accounts are empty — nothing of value is destroyed.")}</span>,
  ] : [];
  const confirmBurnValueUsd = confirmKind === "burn" ? confirmSel.reduce((s, a) => s + (isWsol(a) ? 0 : Number(a.valueUsd) || 0), 0) : 0;
  const confirmBurnUnpriced = confirmKind === "burn" ? confirmSel.filter((a) => isUnpriced(a)) : [];
  // ⚠️ WRAPPED SOL IS NOT BURNED, AND BOTH NUMBERS ON THIS SHEET USED TO SAY OTHERWISE
  // (adversarial review P1-4, 2026-09-21). wSOL is non-empty, unfrozen and not an NFT, so it
  // lands in the Burn group and "Select all" ticks it. onConfirmed builds NO burn for it —
  // CloseAccount unwraps, and the whole wrapped balance comes back with the rent. But the sheet
  // counted only the rent, so a 5 wSOL row was announced as "0.00204 SOL returning" and
  // "this burns the token balance permanently. It cannot be undone" — two false numbers and a
  // false sentence, on the screen immediately before a signature. (The row tag does say
  // "unwraps, isn't burned", but the sheet is a full-screen overlay and the tag is behind it.)
  //
  // wSOL has 9 decimals, so its base-unit amount IS lamports — no conversion, no float.
  const wsolSel = confirmKind === "burn" ? confirmSel.filter((a) => isWsol(a)) : [];
  const wsolLamports = wsolSel.reduce((n, a) => n + (/^[0-9]+$/.test(String(a.amountRaw)) ? Number(a.amountRaw) : 0), 0);
  // Is anything here actually destroyed? Empty rows close, wSOL unwraps; only a non-empty,
  // non-wSOL row has a burn instruction built for it (see onConfirmed).
  const reallyBurning = confirmKind === "burn" ? confirmSel.filter((a) => !isEmpty(a) && !isWsol(a)) : [];
  const burnLines = confirmKind === "burn" ? [
    <span key="c">{t("Accounts affected")}: <strong>{confirmSel.length}</strong></span>,
    <span key="s">{t("SOL returning to your wallet")}: <strong>{fmtSol(confirmSel.reduce((s, a) => s + (Number(a.rentLamports) || 0), 0) + wsolLamports)}</strong></span>,
    wsolSel.length ? (
      <span key="w">{tf("{n} of these is wrapped SOL — it is unwrapped, not burned, and the whole balance comes back to you.", { n: wsolSel.length })}</span>
    ) : null,
    confirmBurnValueUsd > 0 ? <span key="v">{t("Known value being destroyed")}: <strong className="seeker-firepit-destroyval">{fmtUsd(confirmBurnValueUsd)}</strong></span> : null,
    confirmBurnUnpriced.length > 0 ? (
      <span key="u">{confirmBurnUnpriced.length} {confirmBurnUnpriced.length === 1 ? t("token could not be priced — its value is unknown, not zero. It may be worth money.") : t("tokens could not be priced — their value is unknown, not zero. They may be worth money.")}</span>
    ) : null,
    // Only claim a permanent burn when one is actually being built. Saying it over a selection
    // that only unwraps and closes is the same class of lie as the numbers above.
    reallyBurning.length ? (
      <span key="p">{t("This burns the token balance permanently. It cannot be undone — the tokens cannot be recovered.")}</span>
    ) : (
      <span key="p">{t("Nothing here is burned — these accounts are closed and their SOL comes back to you.")}</span>
    ),
  ].filter(Boolean) : [];

  // Surplus job's own sheet: never destroys anything and never touches a balance, so it gets none
  // of the burn value-guard machinery above (no typed confirmation, no "destroying value"
  // language) — same reasoning as onConfirmed's own early branch.
  const surplusLines = confirmKind === "surplus" ? [
    <span key="c">{t("Accounts")}: <strong>{confirmSel.length}</strong></span>,
    <span key="s">{t("Surplus returning to your wallet")}: <strong>{fmtSol(confirmSel.reduce((s, a) => s + (Number(a.surplusLamports) || 0), 0))}</strong></span>,
    <span key="n">{t("These accounts and their tokens stay exactly as they are — only the surplus above today's minimum moves to you.")}</span>,
  ] : [];

  const counts = runResults.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const runDone = !busy && runResults.length > 0;

  return (
    <Pane icon="🔥" title="Firepit">
      <p className="seeker-tool-lede">{t("Burn worthless junk tokens and reclaim the SOL rent locked in their accounts. Non-custodial — you sign, we take nothing. Every token is priced live, and anything still worth money — or whose value we couldn't read — is flagged before it can burn.")}</p>

      {phase === "loading" ? <Loading label={t("Scanning your wallet on-chain…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} message={errMsg} onRetry={() => scan(wallet.address)} /> : null}
      {phase === "refused" ? <Refused message={errMsg} /> : null}

      {phase === "result" && accounts.length === 0 && !busy && !runDone ? (
        <Empty>{t("Clean wallet — no token accounts to burn or reclaim.")}</Empty>
      ) : null}

      {busy ? (
        <>
          <Loading label="Working…" />
          {runMsg ? <p className="seeker-tool-note">{runMsg}</p> : null}
          {runResults.length ? <div className="seeker-forensic-rows">{runResults.map((r, i) => <OutcomeRow key={i} a={r.a} status={r.status} error={r.error} kind={r.kind} />)}</div> : null}
        </>
      ) : null}

      {runDone ? (
        <div className="seeker-firepit-runreport">
          <div className="seeker-forensic-statgrid">
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Done")}</div><div className="seeker-forensic-stat-value">{counts.sent || 0}</div></div>
            <div className="seeker-forensic-stat"><div className="seeker-forensic-stat-label">{t("Failed")}</div><div className="seeker-forensic-stat-value">{counts.failed || 0}</div></div>
          </div>
          {counts.unconfirmed ? (
            <div className="seeker-drop-unconfirmed" role="alert">
              <p className="seeker-tool-notyet-title">⏳ {counts.unconfirmed} {t("unconfirmed")}</p>
              <p>{t("These were submitted but had no on-chain status after 30 seconds. They may still have landed. Hit Rescan to check — do not sign them again until you've confirmed they didn't land, or you risk trying to burn the same tokens twice.")}</p>
            </div>
          ) : null}
          {counts.declined ? <p className="seeker-tool-note">{t("You declined a transaction, so nothing in it was sent.")}</p> : null}
          {runNotAttempted > 0 ? <p className="seeker-tool-note">{runNotAttempted} {t("account(s) were never attempted and are unchanged.")}</p> : null}
          <div className="seeker-forensic-rows">{runResults.map((r, i) => <OutcomeRow key={i} a={r.a} status={r.status} error={r.error} kind={r.kind} />)}</div>
          {/* Always reachable, even when the burn/reclaim cleared out every remaining account and
              the sections below have nothing left to show. */}
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-firepit-rescan" disabled={!online} onClick={() => scan(wallet.address)}>{t("Rescan")}</button>
        </div>
      ) : null}

      {phase === "result" && accounts.length > 0 && !busy ? (
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
                  <button type="button" className="seeker-btn" disabled={selEmptyRows.length === 0 || confirmPhase === "checking"} onClick={() => openConfirm("reclaim")}>{t("Reclaim")}</button>
                </div>
              </>
            )}
          </section>

          <section className="seeker-firepit-section">
            <h2 className="seeker-firepit-section-title">{t("Reclaim surplus rent — keep accounts open")}</h2>
            <p className="seeker-tool-note">{t("A network rent cut means some of your older token accounts hold more SOL than today's minimum requires. This keeps the account and its tokens exactly as they are — it only withdraws the part Solana no longer requires. You pay the normal network fee, so a very small surplus may not be worth reclaiming on its own.")}</p>
            {surplusUnavailable ? (
              <p className="seeker-tool-note seeker-passgate-err" role="alert">{t("Couldn't check today's rent-exempt minimum right now — hit Rescan to try again. This is never reported as \"nothing to reclaim.\"")}</p>
            ) : null}
            {surplusAccts.length === 0 ? (
              <Empty>{surplusUnavailable ? t("Couldn't check surplus rent right now.") : t("No surplus rent to reclaim right now — every account is already at today's minimum.")}</Empty>
            ) : (
              <>
                <div className="seeker-firepit-toolbar">
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={() => selectAllSurplus(surplusAccts.map((a) => a.tokenAccount))}>{t("Select all")}</button>
                  <button type="button" className="seeker-btn seeker-btn-quiet" onClick={clearSurplus}>{t("Clear")}</button>
                </div>
                <div className="seeker-firepit-rows">
                  {surplusAccts.map((a) => <SurplusRow key={a.tokenAccount} a={a} checked={selSurplus.has(a.tokenAccount)} onToggle={toggleSurplus} />)}
                </div>
                <div className="seeker-firepit-actionrow">
                  <span className="seeker-firepit-actiontotal">
                    {t("Surplus")}: <strong>{fmtSol(surplusLamportsSel)}</strong>
                    {" · "}{t("Est. fee")}: <strong>{fmtSol(surplusFeeLamports)}</strong>
                    {" · "}{t("Net")}: <strong>{fmtSol(surplusNetLamports)}</strong>
                  </span>
                  <button type="button" className="seeker-btn" disabled={selSurplusRows.length === 0 || confirmPhase === "checking"} onClick={() => openConfirm("surplus")}>{t("Reclaim surplus")}</button>
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
                    {/* ⚠️ P3-10: the trailing ": <strong>SOL</strong>" used to sit OUTSIDE the
                        ternary, so with any known value this line read "Value to destroy: $6.10:
                        0.0244 SOL" — the SOL figure losing its own label and reading as an
                        equivalence with the dollar figure, directly above the Burn button. Each
                        number gets its own label now. */}
                    {burnValueUsd > 0 ? (
                      <>
                        {t("Value to destroy")}: <strong className="seeker-firepit-destroyval">{fmtUsd(burnValueUsd)}</strong>
                        {" · "}{t("SOL back")}: <strong>{fmtSol(burnLamports)}</strong>
                      </>
                    ) : (
                      <>{t("Reclaim")}: <strong>{fmtSol(burnLamports)}</strong></>
                    )}
                  </span>
                  <button type="button" className="seeker-btn seeker-btn-danger" disabled={selBurnRows.length === 0 || confirmPhase === "checking"} onClick={() => openConfirm("burn")}>{t("Burn")}</button>
                </div>
              </>
            )}
          </section>

          <button type="button" className="seeker-btn seeker-btn-quiet seeker-firepit-rescan" disabled={!online} onClick={() => scan(wallet.address)}>{t("Rescan")}</button>
        </>
      ) : null}

      {confirmPhase === "checking" ? <Loading label={t("Re-checking your wallet on-chain before you sign…")} /> : null}
      {confirmPhase === "stale" ? (
        <div className="seeker-tool-note seeker-passgate-err" role="alert">
          {t("Those accounts changed since the last scan — nothing left to act on. Rescan and try again.")}
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={cancelConfirm}>{t("OK")}</button>
        </div>
      ) : null}
      {confirmPhase === "error" ? (
        <div className="seeker-tool-note seeker-passgate-err" role="alert">
          {t("Could not re-check your wallet on-chain. Try again.")}
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={cancelConfirm}>{t("OK")}</button>
        </div>
      ) : null}

      <Confirm
        open={confirmKind === "reclaim" && confirmPhase === "ready"}
        title="Confirm reclaim"
        lines={reclaimLines}
        rows={confirmRows}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
      />
      <Confirm
        open={confirmKind === "burn" && confirmPhase === "ready"}
        title="Confirm burn"
        lines={burnLines}
        rows={confirmRows}
        // The desktop's own condition, unchanged: type BURN whenever ANY known value is being
        // destroyed, or whenever ANY selected token could not be priced. Unpriced is not "worth
        // nothing" — it is "we could not find out", and that is exactly when someone should be
        // made to stop and read. Below that bar (every row empty or priced at zero) there is
        // nothing to lose and no reason to add friction.
        typeToConfirm={confirmBurnValueUsd > 0 || confirmBurnUnpriced.length > 0 ? "BURN" : null}
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />
      <Confirm
        open={confirmKind === "surplus" && confirmPhase === "ready"}
        title="Reclaim surplus rent"
        lines={surplusLines}
        rows={confirmRows}
        // Never destroys anything and never touches a balance — no typed confirmation gate.
        confirmLabel="Confirm and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
      />
    </Pane>
  );
}
