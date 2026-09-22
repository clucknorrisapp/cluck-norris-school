// Cluck Norris — Seeker app, the "paste any Solana wallet address" form + its "check another"
// bar. ONE copy, shared by BOTH editions (CLAUDE.md: "Don't re-type these into a page — private
// copies drifted badly enough to cause real bugs"):
//   - the education edition (edition/edu.jsx) has no wallet at all, so this is the ONLY way it
//     ever gets an address to check;
//   - the full edition (edition/full.jsx) defaults Wallet Checkup to the connected wallet, but
//     offers this same form so a pasted address can override it (parity with the website's own
//     Wallet Checkup, which takes any address).
// A Solana address is public information; typing one in is not "collecting an address" — nothing
// is stored, nothing leaves the device but the scan request itself (the caller decides what to do
// with the address; this module never fetches anything).
//
// ⚠️ Class names below are still "seeker-edu-*" even though the full edition now renders them
// too. That is deliberate, not a leftover: `scripts/store-shell-boot-test.cjs` selects
// `.seeker-edu-addrinput` / `.seeker-edu-addrbtn` directly, and `src/seeker/school/Certificate.jsx`
// reuses `.seeker-edu-addrinput` for its own address field — renaming would touch both for no
// behavioural gain. The styles live in `addressform.css`, imported by this file alone.
// This module imports no wallet API (no `CluckWallet`, no gate) so the store build's
// forbidden-string scan (store-edition/store-edition.json) never has anything to catch here.
import React from "react";
import { t, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import "./addressform.css";

// Base58, 32–44 chars, checked before any request is made.
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function AddressForm({ onSubmit }) {
  useI18nReady();
  const [value, setValue] = React.useState("");
  const [err, setErr] = React.useState("");
  function submit(e) {
    e.preventDefault();
    const v = value.trim();
    if (!ADDR_RE.test(v)) { setErr(t("That doesn't look like a Solana address.")); return; }
    setErr("");
    onSubmit(v);
  }
  return (
    <form className="seeker-edu-addrform" onSubmit={submit}>
      <p className="seeker-tool-note">{t("Paste any Solana wallet address to check its approvals and the authorities on what it holds. Read-only — nothing is stored.")}</p>
      <input
        className="seeker-edu-addrinput"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("Paste a wallet address")}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
      />
      {err ? <div className="seeker-tool-refused" role="alert"><p>{err}</p></div> : null}
      <button type="submit" className="seeker-btn seeker-edu-addrbtn">{t("Run the checkup")}</button>
    </form>
  );
}

// The bar shown once an address has been picked (pasted here, or — full edition only — chosen
// over the connected wallet): the short address plus a "Check another" control that clears it.
export function AddressBar({ address, onClear }) {
  useI18nReady();
  return (
    <div className="seeker-edu-addrbar">
      <span className="seeker-edu-addrbar-addr">{shortAddr(address)}</span>
      <button type="button" className="seeker-btn seeker-btn-quiet" onClick={onClear}>{t("Check another")}</button>
    </div>
  );
}
