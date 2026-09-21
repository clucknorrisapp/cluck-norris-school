// Cluck Norris — Seeker app, Hatchery pane (docs/SEEKER_TOOLS_BUILD.md — registry id "hatchery",
// the app's one "paid" tier tool).
//
// The flow (owner brief): the SERVER builds the unsigned mint transaction (name/symbol/supply/
// decimals/authorities/fee, all encoded server-side with real @solana/web3.js + @solana/spl-token
// instruction builders — none of that runs in this file), the CONNECTED WALLET signs it, and the
// server co-signs with the ephemeral mint keypair it holds and submits. This file only: renders
// the form, asks the wallet to sign an ALREADY-BUILT transaction, and confirms the result. It
// never constructs an instruction and never touches `SystemProgram.transfer()` or any web3.js
// layout encoder (AGENTS.md — that needs the Node `Buffer` global browsers don't have and killed
// three money paths at once). The only web3.js use here is `Transaction.from()` / `.serialize()`
// on the vendored IIFE (`window.solanaWeb3`, loaded by seeker.html — same posture as
// reclaim-sign.js), never an instruction builder.
//
// Mint != launch (hatchery.js's own header, STRATEGY.md): this creates a fixed-supply SPL token
// with metadata. It adds no liquidity and lists nowhere. Nothing here implies a price, a market,
// or that holding the result is an investment.
//
// ── hatchery.js contracts, pinned exactly as read (2026-09-21) ──────────────────────────────────
//   GET /api/hatchery/config[?wallet=<address>] — the live fee terms. NEVER hardcoded.
//     200 always (even its own internal-error path returns 200 — see the ⚠️ below), body:
//       { feeSol, feeClkn, feeClknSol, clknSavingPct, holderThreshold,
//         solEnabled, clknEnabled, feeWaived }
//     ⚠️ SURPRISE: the route's catch-all returns `{ solEnabled:false, clknEnabled:false }` on ANY
//     internal failure (a thrown price fetch, a bad wallet parse, …) — no `error`, no `success`,
//     no distinct status. That payload is BYTE-IDENTICAL in shape to "no fee is configured right
//     now" (a real, intentional state during the free beta). A pane cannot tell "free" from
//     "the config read broke" from this response alone. Detected here as `cfgDegraded` (the
//     success payload always carries `feeSol`; the failure one never does) and rendered as an
//     honest "couldn't confirm the fee" note rather than a confident "this is free" claim. This is
//     purely a DISPLAY concern — hatchery.js's /build computes and enforces the real fee straight
//     from server env vars regardless of what /config returned, so nothing here can under-charge
//     by trusting a broken config read.
//   POST /api/hatchery/build — uploads the logo + metadata JSON to Arweave (a REAL, permanent
//     action — this is not a dry-run/simulate the way Locker Room's create-tx is) and builds the
//     unsigned, fee-inclusive mint transaction.
//     body: { creator, name, symbol, description, decimals, supply, imageBase64, imageMime,
//             revokeMint, revokeFreeze, payWith:"sol"|"clkn" }   (cluster omitted → mainnet-beta;
//             see the file-level note below on why this pane never exposes a cluster switch)
//     200 { txBase64, mintAddress, metadataUri, imageUri, cluster }
//       ⚠️ NOTE: this response never echoes back what fee (if any) was actually included in
//       txBase64 — no feeSol/feeClkn/feeWaived field. The confirm sheet's fee line is therefore
//       always a CLIENT-SIDE ESTIMATE from the most recent /config read, refreshed right before
//       the sheet opens to minimize staleness, with an explicit line telling the person their
//       wallet's own approval screen is the final word on the real amount.
//     400 { error } — bad/missing field, logo too large, insufficient SOL/CLKN, etc. — a fixable
//       FORM problem, rendered inline over the still-visible form, never a blocking full-page error.
//     500 { error } — Arweave/RPC/server trouble.
//   POST /api/hatchery/submit — the browser returns the WALLET-signed (mint-key-unsigned) tx;
//     the server verifies its core instructions still match what /build produced (so the fee
//     instruction can't be stripped), co-signs with the mint key, and submits.
//     body: { mintAddress, signedTxBase64 }
//     200 { signature }
//     400 { error } — missing fields, unreadable tx, the wallet altered/dropped a fee-bearing
//       instruction, or a missing/invalid wallet signature — a form-level problem.
//     410 { error } — "this mint request expired or was already submitted — build it again."
//       ⚠️ SURPRISE: hatchery.js deletes the pending mint-keypair entry BEFORE calling
//       `sendRawTransaction`, not after it succeeds. So a network hiccup or an RPC-level throw at
//       send time still lands as a 500 (see below) with the entry ALREADY GONE — a naive "retry
//       the same submit" would 410, and there is no way to resubmit that exact signed transaction
//       again. This pane never offers that retry: a submit-time failure or a confirmation timeout
//       both route to the AMBIGUOUS state below (check the mint on Solscan; start a fresh mint —
//       never resend blindly, a second attempt can create and charge for a second token).
//     500 { error } — RPC/submit trouble AFTER the pending entry was already deleted (see above).
//   POST /api/hatchery/minted — best-effort Telegram announce for a REAL, verified mint. This pane
//     calls it once, fire-and-forget, after a landed+confirmed mint; its `{ok:true|false}` result
//     is never surfaced to the user (server re-verifies everything server-side regardless of what
//     name/symbol this call sends).
//
// ── Confirming a submitted signature (the P0 this app has shipped twice) ────────────────────────
// `getSignatureStatuses` returns BOTH `err` and `confirmationStatus` for a transaction that landed
// and then failed — checking confirmationStatus first mis-reports a failed mint as a success. This
// file does not re-implement that check: it imports `confirmSignature` from ../sign.js,
// the one place in this app that already has the fix (err checked first) and the adversarial-review
// comment explaining why, and the generic `isUserRejection` normalizer from the same file. Only two
// browser-primitive helpers are duplicated locally (base64 codec, the `window.solanaWeb3` guard) —
// see the note by web3() below for why those two, and only those two, are not imported.
//
// A mint transaction here is genuinely all-or-nothing: if it lands and fails on-chain, NOTHING in
// it executed — no token was created and no fee was charged (hatchery.js's own comment on why the
// tamper-check only needs to protect the fee instruction's presence, not its execution). So a
// confirmed on-chain failure is reported as safe to retry; an AMBIGUOUS result (a submit-time
// network failure, or a confirmation timeout) is not, and this pane never guesses which one it was.
//
// "Guardrails before power": nothing is signed without the Confirm sheet naming the exact name,
// symbol, supply, decimals, fee (best-known), and the plain consequence of each authority toggle —
// in the row, not a tooltip — plus the fact that this is permanent the moment it is approved.
//
// No cluster switch is exposed — every other signing pane in this app (Firepit, Project Burn,
// Locker Room, Rent Reclaim) mints/burns/locks/reclaims on mainnet only with no devnet toggle in
// its UI, and this pane matches that.
//
// Image upload — the one place this build had to make an honest call, not a copied one:
// hatchery.js hard-refuses any logo over 100 KiB, and the desktop tool's response to that is "compress
// it yourself and try again" (public/hatchery.html has no resize step at all). On a phone that is a
// dead end — a camera-roll photo or a fresh camera shot is routinely 1–15 MB, and a Seeker phone has
// no built-in image editor to shrink it before picking it here. So a file over the limit (or not
// already one of the three accepted mime types) is downscaled and re-compressed client-side via
// <canvas> before it is ever read into base64 — see prepareLogo() below. A file that ALREADY fits is
// sent through untouched (so a project that already has a proper small PNG logo keeps its exact
// pixels and its transparency). This has NOT been exercised on a real device or even a real browser
// in this session — no browser tool was available to test it — so treat the canvas path as
// code-reviewed, not device-verified, until someone runs it on an actual Seeker/Android webview.
import React from "react";
import { t } from "../i18n.js";
import { Pane, Loading, Unavailable, Confirm, NeedsWallet, toolFetch, useOnline } from "../pane.jsx";
import { shortAddr } from "../addr.js";
import { confirmSignature, isUserRejection } from "../sign.js";
import "./tools.css";

// ── constants ────────────────────────────────────────────────────────────────────────────────
// Mirrors hatchery.js's own MAX_LOGO_BYTES. Can't be imported (that file is a Node/Express router
// pulling in @solana/web3.js and @solana/spl-token — not browser-bundleable) so it is restated
// here; if the server's limit ever moves, this constant has to move with it by hand.
const MAX_LOGO_BYTES = 100 * 1024;
// Compress toward comfortably under the server's hard cap, not right up against it — quality/size
// search below is coarse-grained (12% steps), so leaving headroom avoids landing one step over.
const LOGO_TARGET_BYTES = 92 * 1024;
const LOGO_START_DIM = 512;   // generous for a token logo/icon; most source photos are far bigger
const LOGO_MIN_DIM = 96;      // stop shrinking here even if the target still isn't hit
const MINT_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;
const DEFAULT_DECIMALS = "9";
const DEFAULT_SUPPLY = "1000000000";
const DESC_MAX = 200; // server allows up to 1000; capped tighter here for a clean phone form

// ── tiny formatters ──────────────────────────────────────────────────────────────────────────
// Comma-groups an arbitrarily long digit STRING without ever routing it through Number() (a
// supply can exceed 2^53 and lose precision) — display-only, the raw string is what's ever sent.
function fmtDigits(s) {
  const str = String(s || "").replace(/\D/g, "");
  if (!str) return "0";
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtClkn(n) { return Math.round(Number(n) || 0).toLocaleString(); }

// Only ever build an href from a value THIS PANE validated — chain data (and here, a
// server-generated address) is never trusted straight into an href even when it came from our own
// API (CLAUDE.md: React escapes text but not attributes).
function safeHref(u) { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : null; }
function mintHref(addr) { return MINT_ADDR_RE.test(String(addr || "")) ? safeHref(`https://solscan.io/token/${encodeURIComponent(addr)}`) : null; }
function txHref(sig) { return SIG_RE.test(String(sig || "")) ? safeHref(`https://solscan.io/tx/${encodeURIComponent(sig)}`) : null; }

// ── logo: read-as-is when it already fits, downscale+recompress on <canvas> when it doesn't ────
// See the file header for why this exists at all (a camera-roll photo is nothing like a
// pre-made 100 KB logo). Always flattens onto white and encodes JPEG when compressing — a plain,
// universally-supported codec chosen over WebP specifically BECAUSE this path is untested on a
// real device: fewer format-support branches to be wrong about. A file that already fits its mime
// type and size ships untouched, so a project with a real small PNG logo keeps its transparency.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error(t("Could not read that image.")));
    reader.readAsDataURL(blob);
  });
}
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t("Could not read that image."))); };
    img.src = url;
  });
}
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}
async function prepareLogo(file) {
  if (!file) throw new Error(t("Choose a logo image first."));
  if (!/^image\//.test(file.type)) throw new Error(t("That file isn't an image."));
  const ACCEPTED = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp";
  if (file.size <= MAX_LOGO_BYTES && ACCEPTED) {
    const base64 = await blobToBase64(file);
    return { base64, mime: file.type, resized: false };
  }
  const { img, url } = await loadImageFromFile(file);
  try {
    const srcMax = Math.max(img.naturalWidth || LOGO_START_DIM, img.naturalHeight || LOGO_START_DIM);
    for (let dim = Math.min(LOGO_START_DIM, srcMax); dim >= LOGO_MIN_DIM; dim = Math.floor(dim * 0.75)) {
      const scale = dim / srcMax;
      const w = Math.max(1, Math.round((img.naturalWidth || dim) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || dim) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      for (let q = 0.88; q >= 0.35; q -= 0.12) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await canvasToBlob(canvas, "image/jpeg", q);
        if (blob && blob.size <= LOGO_TARGET_BYTES) {
          // eslint-disable-next-line no-await-in-loop
          const base64 = await blobToBase64(blob);
          return { base64, mime: "image/jpeg", resized: true };
        }
      }
    }
    throw new Error(t("Couldn't compress this image small enough — try a simpler image, or crop it first."));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── signing: the vendored web3 IIFE only, never an instruction encoder ─────────────────────────
// Same rule and the same reasoning as reclaim-sign.js's own web3()/bytesToBase64 — duplicated here
// (rather than imported) because they are NOT exported from that file and are trivial, pure
// byte-shuffling with no judgment call in them (unlike confirmSignature/isUserRejection above,
// which ARE imported because they encode a real, previously-shipped-twice bug fix). Importing an
// un-exported binding isn't possible without editing that file, and editing a shared seam another
// pane (Rent Reclaim) depends on is out of scope here.
function web3() {
  const w = typeof window !== "undefined" ? window.solanaWeb3 : null;
  if (!w) throw new Error(t("Solana web3 did not load on this page."));
  return w;
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── fee line — shared by the form panel and the Confirm sheet so they never disagree ───────────
function feeState(cfg, payWith) {
  if (!cfg) return { kind: "loading" };
  if (typeof cfg.feeSol === "undefined") return { kind: "degraded" }; // the /config catch-all shape, see header
  if (cfg.feeWaived) return { kind: "waived" };
  if (!cfg.solEnabled && !cfg.clknEnabled) return { kind: "free" };
  if (payWith === "clkn" && cfg.clknEnabled) return { kind: "clkn", amount: cfg.feeClkn, savingPct: cfg.clknSavingPct };
  if (cfg.solEnabled) return { kind: "sol", amount: cfg.feeSol };
  if (cfg.clknEnabled) return { kind: "clkn", amount: cfg.feeClkn, savingPct: cfg.clknSavingPct };
  return { kind: "free" };
}
function FeeLine({ cfg, payWith }) {
  const fs = feeState(cfg, payWith);
  if (fs.kind === "loading") return <p className="seeker-tool-note">{t("Loading today's fee…")}</p>;
  if (fs.kind === "degraded") return <p className="seeker-hatch-feenote">{t("Couldn't confirm today's fee. You can still continue — your wallet will show the exact amount before you approve anything.")}</p>;
  if (fs.kind === "waived") return <p className="seeker-hatch-waived">{t("Minting is free for your wallet right now — it holds enough CLKN.")}</p>;
  if (fs.kind === "free") return <p className="seeker-hatch-waived">{t("No mint fee is charged right now (beta).")}</p>;
  if (fs.kind === "sol") return <p className="seeker-tool-note">{t("Fee")}: <strong>{fs.amount} SOL</strong>{cfg.holderThreshold ? <> · {t("free if you hold")} {fmtClkn(cfg.holderThreshold)} {t("CLKN or more")}</> : null}</p>;
  return <p className="seeker-tool-note">{t("Fee")}: <strong>{fmtClkn(fs.amount)} CLKN</strong>{fs.savingPct ? <> ({fs.savingPct}% {t("cheaper than SOL")})</> : null}</p>;
}
function feeConfirmLine(cfg, payWith) {
  const fs = feeState(cfg, payWith);
  if (fs.kind === "waived") return t("Fee: free — your wallet holds enough CLKN.");
  if (fs.kind === "free") return t("Fee: none charged right now (beta).");
  if (fs.kind === "sol") return `${t("Fee")}: ${fs.amount} SOL`;
  if (fs.kind === "clkn") return `${t("Fee")}: ${fmtClkn(fs.amount)} CLKN`;
  return t("Fee could not be confirmed — your wallet will show the exact amount.");
}

export default function HatcheryPane({ wallet }) {
  const online = useOnline();

  // ── live fee config — never hardcoded, refetched on wallet connect and again right before the
  // Confirm sheet opens (the freshest read this pane can get without polling). ──
  const [cfg, setCfg] = React.useState(null);
  const [cfgPhase, setCfgPhase] = React.useState("loading"); // loading | ok | offline
  const loadCfg = React.useCallback(() => {
    setCfgPhase("loading");
    const q = wallet.connected && wallet.address ? `?wallet=${encodeURIComponent(wallet.address)}` : "";
    toolFetch(`/api/hatchery/config${q}`).then((res) => {
      if (res.ok) { setCfg(res.data); setCfgPhase("ok"); return; }
      setCfgPhase(res.kind === "offline" ? "offline" : "ok"); // /config never itself 4xx/5xxs meaningfully — see header
    });
  }, [wallet.connected, wallet.address]);
  React.useEffect(() => { if (wallet.connected) loadCfg(); }, [wallet.connected, wallet.address, loadCfg]);

  // ── form state ──
  const [name, setName] = React.useState("");
  const [symbol, setSymbol] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [decimals, setDecimals] = React.useState(DEFAULT_DECIMALS);
  const [supply, setSupply] = React.useState(DEFAULT_SUPPLY);
  const [logoFile, setLogoFile] = React.useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = React.useState(null);
  const [revokeMint, setRevokeMint] = React.useState(true);
  const [revokeFreeze, setRevokeFreeze] = React.useState(true);
  const [payWith, setPayWith] = React.useState("sol");
  const [formError, setFormError] = React.useState(null);   // client-side validation, fixable inline
  const [buildError, setBuildError] = React.useState(null); // server refused /build, fixable inline

  // Once /config loads, don't leave payWith pointed at a method that isn't actually enabled.
  React.useEffect(() => {
    if (!cfg) return;
    if (!cfg.solEnabled && cfg.clknEnabled) setPayWith("clkn");
    else if (cfg.solEnabled && !cfg.clknEnabled) setPayWith("sol");
  }, [cfg]);

  React.useEffect(() => () => { try { logoPreviewUrl && URL.revokeObjectURL(logoPreviewUrl); } catch (_) {} }, [logoPreviewUrl]);

  function onPickLogo(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file name after a change
    if (!f) return;
    if (!/^image\//.test(f.type)) { setFormError(t("Choose an image file for the logo.")); return; }
    setFormError(null);
    try { logoPreviewUrl && URL.revokeObjectURL(logoPreviewUrl); } catch (_) {}
    setLogoFile(f);
    setLogoPreviewUrl(URL.createObjectURL(f));
  }

  // ── flow state ──
  // form → building (/build in flight) → reviewed (plan in hand, Confirm not yet opened) →
  // signing (wallet + submit + confirmation in flight) → done | failed (on-chain, safe to retry) |
  // ambiguous (unknown outcome, never auto-retry) | unavailable (a plain network hiccup)
  const [phase, setPhase] = React.useState("form");
  const [errKind, setErrKind] = React.useState("unavailable");
  const [plan, setPlan] = React.useState(null);       // /build's response
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [outcomeMsg, setOutcomeMsg] = React.useState(null); // text for failed/ambiguous states
  const [result, setResult] = React.useState(null);   // { signature, mintAddress, name, symbol }

  function validateForm() {
    if (!name.trim() || name.trim().length > 32) return t("Enter a token name, up to 32 characters.");
    if (!symbol.trim() || symbol.trim().length > 10) return t("Enter a token symbol, up to 10 characters.");
    const dec = parseInt(decimals, 10);
    if (!Number.isInteger(dec) || dec < 0 || dec > 9) return t("Decimals must be a whole number from 0 to 9.");
    if (!/^[1-9]\d*$/.test(String(supply || "").trim())) return t("Enter a whole number greater than zero for the supply.");
    if (!logoFile) return t("Choose a logo image.");
    return null;
  }

  async function review() {
    const err = validateForm();
    if (err) { setFormError(err); return; }
    setFormError(null);
    setBuildError(null);
    if (!online) { setPhase("unavailable"); setErrKind("offline"); return; }
    let logo;
    try {
      logo = await prepareLogo(logoFile);
    } catch (e) {
      setFormError((e && e.message) || t("Couldn't prepare that logo. Try a different image."));
      return;
    }
    setPhase("building");
    const res = await toolFetch("/api/hatchery/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creator: wallet.address,
        name: name.trim(), symbol: symbol.trim(), description: description.trim(),
        decimals: parseInt(decimals, 10), supply: String(supply).trim(),
        imageBase64: logo.base64, imageMime: logo.mime,
        revokeMint, revokeFreeze, payWith,
      }),
    });
    if (!res.ok) {
      if (res.kind === "offline") { setErrKind("offline"); setPhase("unavailable"); return; }
      if (res.kind === "refused") {
        setBuildError((res.body && res.body.error) || t("That couldn't be built as entered."));
        setPhase("form");
        return;
      }
      setErrKind("unavailable");
      setPhase("unavailable");
      return;
    }
    setPlan(res.data);
    setPhase("reviewed");
    loadCfg(); // freshest possible fee figure before the Confirm sheet shows one
  }

  function openConfirm() { if (plan) setConfirmOpen(true); }
  function cancelConfirm() { setConfirmOpen(false); }

  async function onConfirmed() {
    setConfirmOpen(false);
    setPhase("signing");
    try {
      // Same class of guard as reclaim-sign.js's P2-J finding, and it matters even more here:
      // every authority and the fee payer in this transaction is the creator address /build was
      // called with. If the wallet's live account has drifted from that, refuse outright rather
      // than let a real wallet's own signing rules decide what happens.
      const liveKey = wallet.provider && wallet.provider.publicKey && typeof wallet.provider.publicKey.toString === "function"
        ? wallet.provider.publicKey.toString() : null;
      if (liveKey && liveKey !== wallet.address) {
        throw new Error(t("Your wallet switched accounts — reconnect and start over."));
      }
      if (!wallet.provider || typeof wallet.provider.signTransaction !== "function") {
        throw new Error(t("This wallet can't sign a transaction from this app — try Phantom, Solflare or Backpack."));
      }
      // Wallet signs FIRST — never signAndSendTransaction here. The mint keypair still has to
      // co-sign server-side before this is broadcast; sending it now would submit a
      // one-signature transaction that is missing a required signer and would also be exactly
      // the multi-signer shape Phantom's Lighthouse flags as suspicious (AGENTS.md).
      const { Transaction } = web3();
      const tx = Transaction.from(base64ToBytes(plan.txBase64));
      let signedTx;
      try {
        signedTx = await wallet.provider.signTransaction(tx);
      } catch (e) {
        if (isUserRejection(e)) {
          setPhase("form");
          setFormError(t("You declined to sign — nothing was created."));
          return;
        }
        throw e;
      }
      const signedTxBase64 = bytesToBase64(signedTx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      const subRes = await toolFetch("/api/hatchery/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mintAddress: plan.mintAddress, signedTxBase64 }),
      });
      if (!subRes.ok) {
        if (subRes.kind === "offline") { setErrKind("offline"); setPhase("unavailable"); return; }
        if (subRes.kind === "refused") {
          // 400 (tampered/invalid) or 410 (expired) — both are "build it again" per hatchery.js.
          setPhase("form");
          setBuildError((subRes.body && subRes.body.error) || t("That mint request could not be submitted — build it again."));
          return;
        }
        // A 500 here can land AFTER hatchery.js already deleted the pending mint entry (see the
        // file header) — the transaction may or may not have reached the network. Never treat
        // this as "failed, retry" and never resubmit; only a Solscan check tells the truth.
        setResult({ mintAddress: plan.mintAddress, name: name.trim(), symbol: symbol.trim() });
        setOutcomeMsg((subRes.body && subRes.body.error) || t("Could not confirm whether this was submitted."));
        setPhase("ambiguous");
        return;
      }
      const signature = subRes.data.signature;
      const CU = typeof window !== "undefined" ? window.CluckUtil : null;
      if (!CU || typeof CU.rpc !== "function") throw new Error(t("RPC layer did not load."));
      const rpc = (method, params) => CU.rpc(method, params);
      let landed;
      try {
        landed = await confirmSignature(rpc, signature);
      } catch (e) {
        // Landed AND failed on-chain. All-or-nothing: nothing was created, nothing was charged.
        setResult({ signature, mintAddress: plan.mintAddress, name: name.trim(), symbol: symbol.trim() });
        setOutcomeMsg((e && e.message) || t("The transaction failed on-chain."));
        setPhase("failed");
        return;
      }
      if (!landed) {
        setResult({ signature, mintAddress: plan.mintAddress, name: name.trim(), symbol: symbol.trim() });
        setOutcomeMsg(t("Timed out waiting for the network to confirm it."));
        setPhase("ambiguous");
        return;
      }
      setResult({ signature, mintAddress: plan.mintAddress, name: name.trim(), symbol: symbol.trim() });
      setPhase("done");
      // Best-effort announce — never affects what the user sees, and the server re-verifies
      // everything on-chain before it ever posts anything (hatchery.js's /minted header).
      toolFetch("/api/hatchery/minted", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature, mintAddress: plan.mintAddress, name: name.trim(), symbol: symbol.trim() }),
      }).catch(() => {});
    } catch (e) {
      setOutcomeMsg((e && e.message) || String(e));
      setPhase("ambiguous");
    }
  }

  function startOver() {
    setPlan(null);
    setResult(null);
    setOutcomeMsg(null);
    setBuildError(null);
    setFormError(null);
    setPhase("form");
  }

  if (!wallet.connected) {
    return (
      <Pane icon="🥚" title="Hatchery">
        <p className="seeker-tool-lede">{t("Mint a real SPL token on Solana — name, symbol, supply and logo, with each authority choice explained in plain words. This creates a token; it doesn't add liquidity or list it anywhere.")}</p>
        <NeedsWallet why="Connect the wallet that will create and pay for this token." wallet={wallet} />
      </Pane>
    );
  }

  const dec = parseInt(decimals, 10) || 0;
  const feeText = feeConfirmLine(cfg, payWith);
  const confirmLines = plan ? [
    <span key="a">{t("Creating")}: <strong>{name.trim()}</strong> (<strong>{symbol.trim()}</strong>)</span>,
    <span key="s">{t("Total supply")}: <strong>{fmtDigits(supply)}</strong> · {dec} {t("decimals")}</span>,
    <span key="f">{feeText}</span>,
    <span key="rm">{revokeMint
      ? t("Mint authority will be revoked — supply is fixed forever, and nobody, including you, can ever mint more.")
      : t("You keep mint authority — you'll be able to mint more of this token later.")}</span>,
    <span key="rf">{revokeFreeze
      ? t("Freeze authority will be revoked — nobody, including us, can ever freeze a holder's tokens.")
      : t("You keep freeze authority — you'd be able to freeze a holder's tokens later.")}</span>,
    <span key="m">{t("This creates a real token on Solana mainnet. It costs a small amount of SOL in network fees regardless of the amount above, and once you approve it, it cannot be undone.")}</span>,
    <span key="w">{t("Your wallet will show the exact amounts before you approve — check them there too.")}</span>,
  ] : [];

  return (
    <Pane icon="🥚" title="Hatchery">
      <p className="seeker-tool-lede">{t("Mint a real SPL token on Solana — name, symbol, supply and logo, with each authority choice explained in plain words. This creates a token; it doesn't add liquidity or list it anywhere — that's a separate step you'd take yourself, elsewhere.")}</p>

      {phase === "form" ? (
        <div className="seeker-hatch-form">
          <label className="seeker-listing-label" htmlFor="hatch-name">{t("Token name")}</label>
          <input id="hatch-name" className="seeker-listing-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder={t("Cluck Coin")} autoComplete="off" />

          <div className="seeker-hatch-row2">
            <div>
              <label className="seeker-listing-label" htmlFor="hatch-symbol">{t("Symbol")}</label>
              <input id="hatch-symbol" className="seeker-listing-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} placeholder="CLUCK" autoComplete="off" />
            </div>
            <div>
              <label className="seeker-listing-label" htmlFor="hatch-decimals">{t("Decimals")}</label>
              <input id="hatch-decimals" className="seeker-listing-input" inputMode="numeric" value={decimals} onChange={(e) => setDecimals(e.target.value.replace(/\D/g, "").slice(-1))} placeholder="9" />
            </div>
          </div>

          <label className="seeker-listing-label" htmlFor="hatch-supply">{t("Total supply")}</label>
          <input id="hatch-supply" className="seeker-listing-input" inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/\D/g, ""))} placeholder="1000000000" />
          {supply ? <p className="seeker-tool-note">{fmtDigits(supply)} {t("tokens total")}</p> : null}

          <label className="seeker-listing-label" htmlFor="hatch-desc">{t("Description")} <span className="seeker-hatch-optional">({t("optional")})</span></label>
          <input id="hatch-desc" className="seeker-listing-input" value={description} onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))} maxLength={DESC_MAX} placeholder={t("A short line about the token")} />

          <label className="seeker-listing-label">{t("Logo")}</label>
          {logoPreviewUrl ? <img className="seeker-hatch-logopreview" src={logoPreviewUrl} alt="" /> : null}
          <input type="file" id="hatch-logo" className="seeker-hatch-fileinput" accept="image/*" onChange={onPickLogo} />
          <label htmlFor="hatch-logo" className="seeker-btn seeker-btn-quiet seeker-hatch-filelabel">
            {logoFile ? t("Change logo") : t("Choose a logo image")}
          </label>
          <p className="seeker-tool-note">{t("Any photo works — it's resized and compressed automatically to fit. A pre-made square logo under 100 KB keeps its exact pixels and transparency.")}</p>

          <label className="seeker-lock-toggle">
            <input type="checkbox" checked={revokeMint} onChange={(e) => setRevokeMint(e.target.checked)} />
            <span>
              <span className="seeker-lock-toggle-label">{t("Revoke mint authority")}</span>
              <span className="seeker-lock-toggle-note">{t("Recommended. After the full supply is minted, no more can ever be created — supply is fixed forever. This cannot be undone.")}</span>
            </span>
          </label>
          <label className="seeker-lock-toggle">
            <input type="checkbox" checked={revokeFreeze} onChange={(e) => setRevokeFreeze(e.target.checked)} />
            <span>
              <span className="seeker-lock-toggle-label">{t("Revoke freeze authority")}</span>
              <span className="seeker-lock-toggle-note">{t("Recommended. Nobody — including us — will ever be able to freeze a holder's tokens. This cannot be undone.")}</span>
            </span>
          </label>

          <label className="seeker-listing-label">{t("Mint fee")}</label>
          {cfg && !cfg.feeWaived && cfg.solEnabled && cfg.clknEnabled ? (
            <div className="seeker-hatch-payrow">
              <button type="button" className={"seeker-launch-tabbtn" + (payWith === "sol" ? " active" : "")} onClick={() => setPayWith("sol")}>{t("Pay in SOL")}</button>
              <button type="button" className={"seeker-launch-tabbtn" + (payWith === "clkn" ? " active" : "")} onClick={() => setPayWith("clkn")}>{t("Pay in CLKN")}</button>
            </div>
          ) : null}
          <FeeLine cfg={cfg} payWith={payWith} />
          {cfgPhase === "offline" ? <p className="seeker-tool-note">{t("Offline — fee terms will load once you're back online.")}</p> : null}

          {formError ? <p className="seeker-listing-formerror" role="alert">{formError}</p> : null}
          {buildError ? <p className="seeker-lock-simwarning" role="alert">{buildError}</p> : null}

          <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={review}>{t("Review mint")}</button>
        </div>
      ) : null}

      {phase === "building" ? <Loading label={t("Uploading metadata and preparing the mint…")} /> : null}
      {phase === "unavailable" ? <Unavailable kind={errKind} onRetry={review} /> : null}

      {phase === "reviewed" && plan ? (
        <div className="seeker-burn-tokencard">
          <div className="seeker-burn-tokenhead">
            {logoPreviewUrl ? <img className="seeker-hatch-cardlogo" src={logoPreviewUrl} alt="" /> : <span className="seeker-burn-tokenicon">{(symbol.trim() || "?").slice(0, 2).toUpperCase()}</span>}
            <div>
              <div className="seeker-burn-tokenname">{name.trim()} · {symbol.trim()}</div>
              <div className="seeker-tool-note">{t("Mint")}: {shortAddr(plan.mintAddress)}</div>
            </div>
          </div>
          <dl className="seeker-listing-facts">
            <div><dt>{t("Supply")}</dt><dd>{fmtDigits(supply)}</dd></div>
            <div><dt>{t("Decimals")}</dt><dd>{dec}</dd></div>
            <div><dt>{t("Mint authority")}</dt><dd>{revokeMint ? t("Revoked") : t("Kept")}</dd></div>
            <div><dt>{t("Freeze authority")}</dt><dd>{revokeFreeze ? t("Revoked") : t("Kept")}</dd></div>
          </dl>
          <FeeLine cfg={cfg} payWith={payWith} />
          <button type="button" className="seeker-btn seeker-btn-danger seeker-burn-actionbtn" onClick={openConfirm}>{t("Mint")}</button>
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-hatch-startover" onClick={startOver}>{t("Start over")}</button>
        </div>
      ) : null}

      {phase === "signing" ? <Loading label={t("Waiting for your wallet and the network…")} /> : null}

      {phase === "failed" && result ? (
        <div className="seeker-hatch-failed" role="alert">
          <p className="seeker-hatch-outcome-title">{t("Nothing was created")}</p>
          <p>{t("The transaction landed and failed on-chain — because it's all-or-nothing, nothing was created and no fee was charged.")}</p>
          {outcomeMsg ? <p className="seeker-tool-note">{outcomeMsg}</p> : null}
          {txHref(result.signature) ? <a className="seeker-listing-link" href={txHref(result.signature)} target="_blank" rel="noopener noreferrer">{t("View the transaction →")}</a> : null}
          <button type="button" className="seeker-btn" onClick={review}>{t("Try again")}</button>
        </div>
      ) : null}

      {phase === "ambiguous" && result ? (
        <div className="seeker-hatch-ambiguous" role="alert">
          <p className="seeker-hatch-outcome-title">{t("Couldn't confirm what happened")}</p>
          <p>{t("We lost track of whether this went through. Check the mint below on Solscan before doing anything else — starting a new mint now could create and pay for a second token.")}</p>
          {outcomeMsg ? <p className="seeker-tool-note">{outcomeMsg}</p> : null}
          {mintHref(result.mintAddress) ? <a className="seeker-listing-link" href={mintHref(result.mintAddress)} target="_blank" rel="noopener noreferrer">{t("Check the mint on Solscan →")}</a> : null}
          {txHref(result.signature) ? <a className="seeker-listing-link" href={txHref(result.signature)} target="_blank" rel="noopener noreferrer">{t("View the transaction →")}</a> : null}
          <button type="button" className="seeker-btn seeker-btn-quiet" onClick={startOver}>{t("Start a new mint")}</button>
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="seeker-hatch-done">
          <p className="seeker-hatch-outcome-title">🥚 {t("Token created")}</p>
          <p>{result.name} · {result.symbol}</p>
          <p className="seeker-tool-note">{t("Mint")}: {shortAddr(result.mintAddress)}</p>
          <p className="seeker-tool-note">{t("This created the token only — it has no liquidity and isn't listed anywhere yet. Adding liquidity is a separate step you'd take yourself, elsewhere.")}</p>
          {mintHref(result.mintAddress) ? <a className="seeker-listing-link" href={mintHref(result.mintAddress)} target="_blank" rel="noopener noreferrer">{t("View on Solscan →")}</a> : null}
          {txHref(result.signature) ? <a className="seeker-listing-link" href={txHref(result.signature)} target="_blank" rel="noopener noreferrer">{t("View the transaction →")}</a> : null}
          <button type="button" className="seeker-btn seeker-listing-runbtn" onClick={startOver}>{t("Mint another")}</button>
        </div>
      ) : null}

      <Confirm
        open={confirmOpen}
        title="Confirm mint"
        lines={confirmLines}
        confirmLabel="Create and sign"
        onConfirm={onConfirmed}
        onCancel={cancelConfirm}
        danger
      />
    </Pane>
  );
}
