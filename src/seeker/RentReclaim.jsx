// Cluck Norris — Seeker app, Rent Reclaim pane (increment 2 = the read side; increment 3 = the
// SIGNING path, docs/SEEKER_APP_PLAN.md / docs/SEEKER_RECLAIM_SIGNING_SPEC.md — THIS MOVES USER
// FUNDS, read the spec before touching this file).
//
// The scan itself is still read-only: GET /api/seeker/reclaimable?wallet=<address>
// (lib/rent-reclaim.js) — free, ungated, no wallet signature needed. Tapping Reclaim now DOES
// build and sign a real transaction, but ALL of that logic lives in
// public/rent-reclaim-plan.js (the pure decisions) and src/seeker/reclaim-sign.js (the thin
// browser seam that talks to the wallet) — this component only renders states and calls
// runFullReclaim(). It never itself decides who is eligible, builds an instruction, or touches a
// destination address.
//
// Distinct states, never conflated: not-connected, loading, an honest empty result (scanned fine,
// nothing reclaimable), "unavailable" (the chain could not be read — CLAUDE.md's "RPC failure
// must read as unavailable, never as zero" applies here exactly as it does to the scan), a confirm
// step naming the exact count and SOL before any signature, signing-in-progress, a rejected
// signature (a NORMAL outcome, not an error — the user changed their mind), and a result screen
// with per-account confirmed/failed/skipped rows and a confirmed-only total.
import React from "react";
import { Link } from "react-router-dom";
import { t, tf, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import { useOnline } from "./pane.jsx";
import { NeedsWallet } from "./needswallet.jsx";
import { runFullReclaim, prepareConfirmation } from "./reclaim-sign.js";

// public/rent-math.js is loaded as a plain <script> in seeker.html (same pattern as
// cluck-util.js/cluck-wallet.js — see that file's header) so this pane and /solana/rent format
// SOL amounts with the exact same function. Falls back gracefully if it somehow didn't load.
function fmtSol(lamports) {
  try {
    if (typeof window !== "undefined" && window.CluckRentMath && typeof window.CluckRentMath.fmtSol === "function") {
      return window.CluckRentMath.fmtSol(lamports);
    }
  } catch (_) {}
  return (Number(lamports || 0) / 1e9).toFixed(6) + " SOL";
}

// ⚠️ P1-C (adversarial review, 2026-09-21): the spec ("Nothing says 'verified' or 'safe' about
// any token") and SEEKER_TOOLS_BUILD.md §3.3 both forbid labeling a token safe — and it was
// untrue here too: a Token-2022 account with withheld transfer fees can read as zero and is NOT
// closable. "can be closed" states only what this screen actually knows.
//
// ⚠️ P2-G: this used to be the ONLY source of the row's reason text — the server's own per-
// account `reason` (lib/rent-reclaim.js's classify()) was silently discarded, and this function's
// unconditional final `return` defaulted every unrecognized status to the wrapped-SOL sentence.
// Accidentally correct while only three statuses existed; a fourth would have lied on every row.
// AccountRow below now prefers `a.reason` and falls back to this ONLY when the server sent none —
// and the fallback for anything this function doesn't recognize is neutral, never a guess.
function reasonFor(status) {
  if (status === "reclaimable") return t("No token balance — can be closed.");
  if (status === "holds_balance") return t("Still holds tokens — won't be closed.");
  if (status === "refused") return t("Wrapped SOL — not handled here.");
  return "";
}

function AccountRow({ a }) {
  return (
    <div className={"seeker-reclaim-row seeker-reclaim-row-" + a.status}>
      <div className="seeker-reclaim-row-main">
        <span className="seeker-reclaim-row-mint">{shortAddr(a.mint)}</span>
        <span className="seeker-reclaim-row-sol">{fmtSol(a.lamports)}</span>
      </div>
      <div className="seeker-reclaim-row-reason">{a.reason ? t(a.reason) : reasonFor(a.status)}</div>
    </div>
  );
}

function Group({ status, title, accounts, emptyText }) {
  if (!accounts.length) {
    if (!emptyText) return null;
    return (
      <div className="seeker-reclaim-group">
        <div className="seeker-reclaim-group-title">{title}</div>
        <div className="seeker-reclaim-empty">{emptyText}</div>
      </div>
    );
  }
  return (
    <div className="seeker-reclaim-group">
      <div className="seeker-reclaim-group-title">{title} · {accounts.length}</div>
      {accounts.map((a) => <AccountRow key={a.tokenAccount} a={a} />)}
    </div>
  );
}

// Increment 3 — signing. Vocabulary is closed/reclaimed/refused, per docs/SEEKER_RECLAIM_SIGNING_
// SPEC.md — never "verified" or "safe" about any token, and a declined signature reads as a plain,
// unalarming fact, not an error.
function outcomeLabel(outcome) {
  if (outcome === "confirmed") return t("Closed");
  if (outcome === "rejected") return t("Declined");
  if (outcome === "skipped") return t("Skipped");
  // ⚠️ "Not confirmed" is NOT a softer word for "Failed" — it is a different fact. The account
  // may be closed and the rent may already be back. Reporting it as Failed tells someone
  // nothing happened when something may have, and invites them to sign the same close again.
  if (outcome === "unconfirmed") return t("Not confirmed");
  return t("Failed");
}

// ⚠️ The plan module (public/rent-reclaim-plan.js) is shared vanilla JS with no access to the
// dictionary, so every `reason` it produces is English. Rendering it raw meant a Spanish run
// showed a fully translated result screen and then one English sentence — precisely on the rows
// where something went wrong with someone's money, which is the worst possible place to drop a
// language. Translate at the render boundary instead: the plan module keeps producing one stable
// English string per case (which is also what its own tests assert on), and this maps it.
//
// The two dynamic ones carry an appended chain error; that error is a node's own text and stays
// as it is, because inventing a translation for it would be worse than showing it.
const REASON_PREFIX = "closing transaction failed on-chain: ";
function reasonText(r) {
  const raw = r && r.reason;
  if (!raw) return "";
  if (raw.indexOf(REASON_PREFIX) === 0) {
    return t("The closing transaction failed on chain.") + " " + raw.slice(REASON_PREFIX.length);
  }
  // A miss falls through to the original English rather than an empty cell — never lose the
  // reason to a dictionary gap.
  const known = {
    "already closed in a previous run": t("Already closed in an earlier run."),
    "no longer exists — already closed": t("This account no longer exists — it was already closed."),
    "gained a balance since the scan": t("It gained a balance after the scan, so it was left alone."),
    "the mint on-chain doesn't match what was scanned — refused": t("The token on chain is not the one that was scanned, so this was refused."),
    "this account isn't controlled by the connected wallet — refused": t("This account is not controlled by the connected wallet, so this was refused."),
    "you declined to sign": t("You declined to sign."),
    "submitted but not confirmed — look this signature up before trying again": t("Submitted, but not confirmed. Look this signature up before trying again."),
    "could not submit": t("It could not be submitted."),
  };
  return known[raw] || raw;
}

function ResultRow({ r }) {
  return (
    <div className={"seeker-reclaim-row seeker-reclaim-resultrow seeker-reclaim-resultrow-" + r.outcome}>
      <div className="seeker-reclaim-row-main">
        <span className="seeker-reclaim-row-mint">{shortAddr(r.mint)}</span>
        <span className="seeker-reclaim-row-outcome">{outcomeLabel(r.outcome)}</span>
      </div>
      <div className="seeker-reclaim-row-reason">
        {r.outcome === "confirmed" ? fmtSol(r.lamports) : reasonText(r)}
      </div>
      {r.sig ? (
        <a className="seeker-reclaim-siglink" href={`https://solscan.io/tx/${encodeURIComponent(r.sig)}`} target="_blank" rel="noopener noreferrer">
          {t("View signature")}
        </a>
      ) : null}
    </div>
  );
}

// The confirm step every signature gets (spec Rule 5): names the EXACT account count and the
// EXACT SOL coming back, before any wallet prompt fires. First-timers get warned before they can
// hurt themselves — that's the brand (CLAUDE.md).
//
// ⚠️ P2-E (adversarial review, 2026-09-21): this used to name only the reward, never the
// consequence — not that closing is PERMANENT, not that it CANNOT be undone, and not that
// receiving this same token again re-creates the account and charges the rent deposit again.
// SEEKER_TOOLS_BUILD.md §3.4 requires the exact consequence in plain words before the signature;
// guardrails-before-power is the brand claim, and this is the screen where it has to be true.
function ConfirmSheet({ count, lamports, busy, onConfirm, onCancel }) {
  return (
    <div className="seeker-reclaim-confirm" role="alertdialog" aria-modal="true">
      <h2 className="seeker-reclaim-confirm-title">{t("Confirm reclaim")}</h2>
      <div className="seeker-reclaim-confirm-row">
        <span>{t("Accounts to close")}</span>
        <strong>{count}</strong>
      </div>
      <div className="seeker-reclaim-confirm-row">
        <span>{t("SOL returning to your wallet (before network fees)")}</span>
        <strong>{fmtSol(lamports)}</strong>
      </div>
      <p className="seeker-reclaim-confirm-consequence">
        {t("This closes the accounts permanently — it can't be undone. If you're ever sent this token again, the account is re-created and you pay this deposit again.")}
      </p>
      <p className="seeker-reclaim-confirm-note">{t("Your wallet will ask you to approve this next.")}</p>
      <div className="seeker-reclaim-confirm-actions">
        <button type="button" className="seeker-reclaim-confirm-cancel" onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button type="button" className="seeker-reclaim-confirm-go" onClick={onConfirm} disabled={busy}>
          {busy ? t("Signing…") : t("Confirm and sign")}
        </button>
      </div>
    </div>
  );
}

export default function RentReclaimPane({ wallet }) {
  useI18nReady();
  const online = useOnline();
  // Read through a ref inside scan() so scan's identity never changes with connectivity: with
  // `online` in its deps, every signal blip re-ran the mount effect, which re-scanned and BLANKED a
  // just-completed reclaim's result behind "You're offline" (verifier on #396, P2-5). The mount
  // effect runs on connect only, as it always did; Try again covers the rest.
  const onlineRef = React.useRef(online); onlineRef.current = online;
  // kind (unavailable phase only): "offline" | "unavailable" — a phone losing signal is not the
  // same fact as the chain being unreachable, and pane.jsx's other tools already say so (the
  // wording below is copied from pane.jsx's own <Unavailable> and from WalletCheckup.jsx).
  const [state, setState] = React.useState({ phase: "idle", data: null, kind: null, errMsg: null });
  // Signing state, kept separate from the scan state above: "idle" (no sign in flight),
  // "confirmloading" (P2-I's fresh re-read is running, before the sheet can show real numbers),
  // "confirming" (the pre-signature sheet is up, showing THAT fresh read), "signing"
  // (runFullReclaim is running), "done" (a run finished — status ok/rejected/unavailable, see
  // r.status). `confirm` holds the confirmloading/confirming state's own data: { count, lamports,
  // toClose } — the exact, just-re-verified candidate set the sheet is showing and doReclaim runs.
  const [sign, setSign] = React.useState({ phase: "idle", result: null, error: null, confirm: null });
  // Idempotency across repeated taps IN THIS SESSION (spec §5 Test 7): tokenAccounts a run has
  // already confirmed closed are remembered here and excluded from every later run's candidate
  // pool by CluckReclaimPlan.excludeAlreadyClosed — a retry after a partial failure never
  // re-attempts (or double-counts) an account this pane has already seen confirmed.
  const [closedTokenAccounts, setClosedTokenAccounts] = React.useState([]);
  // Guards for the confirm/sign path (mirrors Firepit.jsx's own confirmAbortRef): confirmAbortRef
  // marks an in-flight openConfirm re-read STALE the moment a newer openConfirm call (or unmount)
  // supersedes it; liveRef additionally covers "this pane is still mounted" for doReclaim's own
  // await, since runFullReclaim/prepareConfirmation don't take an AbortSignal (reclaim-sign.js has
  // no signal plumbing) — the guard can't cancel the in-flight read/send, only stop it from
  // committing state that would clobber whatever is on screen by the time it resolves.
  const confirmAbortRef = React.useRef(null);
  const liveRef = React.useRef(true);
  React.useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
    };
  }, []);

  const scan = React.useCallback((address, signal) => {
    if (!address) return;
    // Short-circuit BEFORE the request — a phone losing signal must read as offline, not as a
    // generic "could not read the chain" (this pane never checked navigator.onLine before; every
    // other pane's fetch does, via pane.jsx's toolFetch or its own explicit check).
    // Offline and unavailable KEEP whatever data is on screen (functional update): after a reclaim
    // the post-run rescan can fail, and the run's own result must stay visible — a landed
    // transaction is never shown as a read failure (verifier on #396, P2-5).
    if (!onlineRef.current) { setState((p) => ({ phase: "unavailable", data: p.data, kind: "offline", errMsg: null })); return; }
    setState({ phase: "loading", data: null, kind: null, errMsg: null });
    fetch(`/api/seeker/reclaimable?wallet=${encodeURIComponent(address)}`, { signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // A 4xx OTHER than 429 (this route has no per-minute limiter reachable from the client
        // the way the tools with a rate branch do) is the wallet address itself, not the chain —
        // pane.jsx's split: "refused" is a 4xx the CALLER caused, "unavailable" is everything
        // else. This used to fold both into the same generic "could not read the chain" line.
        if (r.status >= 400 && r.status < 500 && r.status !== 429) {   // 429 = the forensic rate bucket, transient → unavailable with its Try-again (verifier on #396, P1-2)
          setState({ phase: "refused", data: null, kind: null, errMsg: (j && j.error) || null });
          return;
        }
        // Both any other HTTP-level failure and a body-level status:"unavailable" (or a malformed
        // body) land here — never fall through to rendering a zero/empty result off a failed read.
        if (!j || !r.ok || j.status === "unavailable" || j.success !== true) {
          setState((p) => ({ phase: "unavailable", data: p.data, kind: "unavailable", errMsg: null }));
          return;
        }
        setState({ phase: "ok", data: j, kind: null, errMsg: null });
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setState((p) => ({ phase: "unavailable", data: p.data, kind: "unavailable", errMsg: null }));
      });
  }, []);

  React.useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setState({ phase: "idle", data: null });
      setSign({ phase: "idle", result: null, error: null, confirm: null });
      setClosedTokenAccounts([]);
      return undefined;
    }
    const ctrl = new AbortController();
    scan(wallet.address, ctrl.signal);
    return () => ctrl.abort();
  }, [wallet.connected, wallet.address, scan]);

  const reclaimableNow = (state.data && state.data.accounts || []).filter(
    (a) => a.status === "reclaimable" && !closedTokenAccounts.includes(a.tokenAccount)
  );
  const reclaimableLamports = reclaimableNow.reduce((s, a) => s + (Number(a.lamports) || 0), 0);

  // ⚠️ P2-I (adversarial review, 2026-09-21): the confirm sheet used to name numbers straight off
  // this scan — which can be minutes old by the time someone actually taps Reclaim. Before
  // showing it, re-read the chain (the exact same select -> exclude-closed -> fresh-re-verify
  // sequence the real run applies, via CluckReclaimPlan.planConfirmation) so what a person is
  // asked to sign for is what is ACTUALLY there right now, not a stale scan's guess.
  const openConfirm = React.useCallback(async () => {
    if (!reclaimableNow.length) return;
    // A new openConfirm supersedes whatever fresh-read was already in flight — exactly Firepit's
    // own openConfirm guard, so a fast double-tap (or Cancel-then-Reclaim-again) can't let an
    // older, slower read land its result over a newer one.
    try { confirmAbortRef.current && confirmAbortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    confirmAbortRef.current = ctrl;
    setSign({ phase: "confirmloading", result: null, error: null, confirm: null });
    try {
      const prep = await prepareConfirmation({ wallet, accounts: reclaimableNow, closedTokenAccounts });
      // The pane may have unmounted, or a newer openConfirm call may already be running its own
      // fresh read — either way this result is stale and must not commit any state.
      if (!liveRef.current || confirmAbortRef.current !== ctrl) return;
      if (prep.status === "unavailable") {
        setSign({ phase: "error", result: null, error: t("Could not read the chain right now. Try again shortly."), confirm: null });
        return;
      }
      if (!prep.toClose.length) {
        // Everything eligible a moment ago is gone now (closed elsewhere, or gained a balance) —
        // an honest re-scan says so rather than opening a sheet for zero accounts.
        setSign({ phase: "idle", result: null, error: null, confirm: null });
        scan(wallet.address);
        return;
      }
      setSign({
        phase: "confirming", result: null, error: null,
        confirm: { count: prep.toClose.length, lamports: prep.lamports, toClose: prep.toClose },
      });
    } catch (e) {
      if (!liveRef.current || confirmAbortRef.current !== ctrl) return;
      setSign({ phase: "error", result: null, error: (e && e.message) || String(e), confirm: null });
    }
  }, [wallet, reclaimableNow, closedTokenAccounts, scan]);

  const cancelConfirm = React.useCallback(() => {
    setSign({ phase: "idle", result: null, error: null, confirm: null });
  }, []);

  const doReclaim = React.useCallback(async () => {
    // The exact, just-re-verified set openConfirm's fresh read produced — never re-derive from
    // the (older) scan-based reclaimableNow when a fresher list is sitting right here.
    const toClose = (sign.confirm && sign.confirm.toClose) || reclaimableNow;
    setSign((s) => ({ ...s, phase: "signing", result: null, error: null }));
    try {
      const result = await runFullReclaim({ wallet, accounts: toClose, closedTokenAccounts });
      // If the pane unmounted while the sign/send was in flight, don't touch state at all — this
      // never changes what was signed or sent, only whether this component still commits it.
      if (!liveRef.current) return;
      const newlyConfirmed = (result.rows || []).filter((r) => r.outcome === "confirmed").map((r) => r.tokenAccount);
      if (newlyConfirmed.length) setClosedTokenAccounts((prev) => prev.concat(newlyConfirmed));
      setSign({ phase: "done", result, error: null, confirm: null });
      // ⚠️ P2-F (adversarial review, 2026-09-21): the scan this pane is showing goes stale the
      // instant any account closes, or gains/loses a balance — without this, a row the run
      // dropped as "gained a balance since the scan" kept appearing under Reclaimable a few lines
      // below its own result row, and its lamports stayed counted in the total. Re-read the
      // chain rather than patch the old scan's classifications by hand.
      scan(wallet.address);
    } catch (e) {
      if (!liveRef.current) return;
      // A hard failure BEFORE the pure module could even report a status (e.g. the wallet layer
      // never loaded, or P2-J's account-switch guard fired) — never rendered as a fabricated
      // result, always its own honest error state.
      setSign({ phase: "error", result: null, error: (e && e.message) || String(e), confirm: null });
    }
  }, [wallet, reclaimableNow, closedTokenAccounts, sign.confirm, scan]);

  if (!wallet.connected) {
    // ⚠️ THE CONNECT BUTTON IS THE POINT. This used to be a title and one sentence — "Connect
    // your wallet to scan for reclaimable rent." — with no control, on the second bottom-nav tab
    // of the app, on the free tool that literally hands people money back. The only way forward
    // was to notice the small button in the header. NeedsWallet is the shared answer every other
    // pane already uses: it offers the button, and where no wallet app exists on the device it
    // says so plainly instead of offering one that cannot work.
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <NeedsWallet why="Connect your wallet to scan for reclaimable rent." wallet={wallet} />
        {/* The Solana Room's own rent page, IN-APP rather than the old website-only pointer —
            same already-translated sentence public/solana-wallet.html uses for the same link, so
            this ships correctly in all seven languages with no new string to translate. */}
        <Link className="seeker-reclaim-learnmore" to="/solana/rent">
          {t("The full breakdown of that deposit, what changed recently, and the scam it invites →")}
        </Link>
      </section>
    );
  }

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p>{t("Scanning your wallet…")}</p>
      </section>
    );
  }

  // Same wording pane.jsx's shared <Unavailable> and WalletCheckup.jsx already use for
  // "offline" — a phone losing signal is a different fact from the chain being unreachable,
  // and this pane used to say the second thing for both.
  const unavailableText = state.kind === "offline"
    ? t("You're offline. This needs a connection — it'll work again as soon as you're back.")
    : t("Could not read the chain right now. Try again shortly.");
  // A finished run's result OUTRANKS a failed rescan: when a reclaim is done and we still hold
  // data, the notice renders inline inside the results view below instead of replacing it.
  const showResultsDespiteUnavailable = state.phase === "unavailable" && sign.phase === "done" && !!state.data;
  if (state.phase === "unavailable" && !showResultsDespiteUnavailable) {
    const text = unavailableText;
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p className="seeker-reclaim-errtext" role="alert">{text}</p>
        <button
          type="button"
          className="seeker-reclaim-retrybtn"
          onClick={() => scan(wallet.address)}
        >
          {t("Try again")}
        </button>
      </section>
    );
  }

  if (state.phase === "refused") {
    // A 4xx on the wallet's own address — not something a retry button can fix here (the address
    // comes from the connected wallet, never typed), same posture as ListingCheckup/ProjectBurn's
    // <Refused>: explain, don't offer a retry that would just repeat the same request.
    return (
      <section className="seeker-pane">
        <div className="seeker-paneicon" aria-hidden="true">💰</div>
        <h1>{t("Rent Reclaim")}</h1>
        <p className="seeker-reclaim-errtext" role="alert">{state.errMsg || t("That address wasn't something we could use.")}</p>
      </section>
    );
  }

  const data = state.data;
  const accounts = data.accounts || [];
  // reclaimableNow (computed above, before the early returns, since it also feeds the confirm
  // sheet) already excludes anything this session has confirmed closed — reuse it here rather
  // than a second, un-filtered list that would keep showing a closed account as "Reclaimable"
  // right next to its own "Closed" result row.
  const reclaimable = reclaimableNow;
  const holdsBalance = accounts.filter((a) => a.status === "holds_balance");
  const refused = accounts.filter((a) => a.status === "refused");

  const signResult = sign.phase === "done" ? sign.result : null;

  return (
    <div className="seeker-reclaim">
      <div className="seeker-reclaim-topicon" aria-hidden="true">💰</div>
      <h1 className="seeker-reclaim-title">{t("Rent Reclaim")}</h1>

      {showResultsDespiteUnavailable ? (
        <div className="seeker-reclaim-rescan-note">
          <p className="seeker-reclaim-errtext" role="alert">{unavailableText}</p>
          <button type="button" className="seeker-reclaim-retrybtn" onClick={() => scan(wallet.address)}>{t("Try again")}</button>
        </div>
      ) : null}

      <div className="seeker-reclaim-total">
        <span className="seeker-reclaim-total-label">{t("Total reclaimable")}</span>
        <span className="seeker-reclaim-total-val">{fmtSol(reclaimableLamports)}</span>
      </div>

      {data.truncated ? (
        // P3: name the actual numbers so the gap is visible and actionable, not just "more
        // exist somewhere" — and say what to do about it.
        <p className="seeker-reclaim-truncnote">
          {t("Showing")} {data.accountsExamined} {t("of")} {data.accountsTotal}. {t("Reclaim these, then rescan for the rest.")}
        </p>
      ) : null}

      {sign.phase === "confirmloading" ? (
        <p className="seeker-reclaim-confirmloading" role="status">{t("Checking the current balances before you sign…")}</p>
      ) : null}

      {sign.phase === "confirming" || sign.phase === "signing" ? (
        <ConfirmSheet
          count={sign.confirm ? sign.confirm.count : reclaimableNow.length}
          lamports={sign.confirm ? sign.confirm.lamports : reclaimableLamports}
          busy={sign.phase === "signing"}
          onConfirm={doReclaim}
          onCancel={cancelConfirm}
        />
      ) : (
        <button type="button" className="seeker-reclaim-btn" disabled={!reclaimableNow.length || sign.phase === "confirmloading"} onClick={openConfirm}>
          {t("Reclaim")}
        </button>
      )}

      {sign.phase === "error" ? (
        <p className="seeker-reclaim-errtext" role="alert">{sign.error}</p>
      ) : null}

      {signResult && signResult.status === "unavailable" ? (
        <p className="seeker-reclaim-errtext" role="alert">{t("Could not read the chain right now. Try again shortly.")}</p>
      ) : null}

      {signResult && signResult.status === "rejected" ? (
        <p className="seeker-reclaim-declinedtext">{t("You declined to sign — nothing was closed.")}</p>
      ) : null}

      {signResult && signResult.rows && signResult.rows.length ? (
        <div className="seeker-reclaim-group">
          <div className="seeker-reclaim-group-title">
            {/* P3: this is one run's own total, not a lifetime figure — say so. */}
            {t("Reclaimed this run")} · {fmtSol(signResult.reclaimedLamports)}
          </div>
          {signResult.unconfirmedCount > 0 ? (
            /* The total above counts ONLY confirmed closes, so it may understate what actually
               came back. Say that plainly rather than letting the number speak for a run that
               had an ambiguous outcome — and point at the signature, not at a retry button. */
            <p className="seeker-reclaim-unconfirmedtext" role="alert">
              {tf("{n} of these could not be confirmed. They may have gone through — the amount above counts only the confirmed ones. Open the signature to check before you try those again.", { n: signResult.unconfirmedCount })}
            </p>
          ) : null}
          {signResult.rows.map((r, i) => <ResultRow key={r.tokenAccount + ":" + i} r={r} />)}
        </div>
      ) : null}

      <Group status="reclaimable" title={t("Reclaimable")} accounts={reclaimable} emptyText={t("No reclaimable rent found in this wallet right now.")} />
      <Group status="holds_balance" title={t("Holds a balance")} accounts={holdsBalance} />
      <Group status="refused" title={t("Refused")} accounts={refused} />

      <button
        type="button"
        className="seeker-reclaim-retrybtn"
        onClick={() => { const ctrl = new AbortController(); scan(wallet.address, ctrl.signal); }}
      >
        {t("Rescan")}
      </button>
    </div>
  );
}
