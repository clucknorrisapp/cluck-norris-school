// Cluck Norris — Seeker app, the "Disconnect & clean up" card under Wallet Checkup.
//
// Owner, 2026-09-29, after nearly connecting the treasury to a lookalike Meteora: "I need
// something on my app to help people disconnect from things." This card is honest about what it
// can and cannot do, because the thing people are actually worried about — a connection stored
// inside their WALLET APP — is not something any website or app can remove for them:
//
//   · what THIS does: calls the wallet's own disconnect() and clears every credential this device
//     holds for the wallet — the unified tools pass (CluckGate.clear(), the one pass client) and
//     the Airdropper's receipt sign-in. The paid-pass payment marker (cluck-gate.js PAYKEY) is
//     deliberately LEFT: it is the proof of a payment already made, and wiping it can cost someone
//     a pass they bought. Said on screen.
//   · what only the WALLET can do: forget the site. The card says where that lives, in the words
//     the wallets use ("Connected apps", "Trusted apps", "Connected sites"), and names the one
//     path we are sure of (Phantom → Settings → Connected Apps). Nothing here can read or edit
//     that list — an app that claimed to would be lying.
//   · the teaching line: connecting shares an address; SIGNING is what can move funds. That is
//     the difference between "I nearly connected to a fake site" (fine) and "I signed on one"
//     (revoke, then move what matters).
//
// FULL EDITION ONLY — imports CluckWallet-adjacent state through the wallet prop; the education
// edition has no wallet and never mounts this.
import React from "react";
import { t, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import { forgetReceiptSession } from "./receipt-session.js";

function clearDevicePass() {
  try { const g = window.CluckGate; if (g && typeof g.clear === "function") g.clear(); } catch (_) {}
}

export default function DisconnectCard({ wallet }) {
  useI18nReady();
  const [done, setDone] = React.useState(null); // { address } after the button

  if (!wallet) return null;

  function onDisconnect() {
    const address = wallet.address;
    clearDevicePass();
    forgetReceiptSession(null);
    try { wallet.disconnect && wallet.disconnect(); } catch (_) {}
    setDone({ address });
  }

  return (
    <section className="seeker-disconnect" aria-label={t("Disconnect & clean up")}>
      <div className="seeker-checkup-section-title">{t("Disconnect & clean up")}</div>
      {wallet.connected ? (
        <>
          <p className="seeker-disconnect-who">
            {t("Connected wallet")}: <span className="seeker-checkup-mono">{shortAddr(wallet.address)}</span>{wallet.name ? ` · ${wallet.name}` : ""}
          </p>
          <p className="seeker-disconnect-explain">
            {t("Connecting only shares your public address. Signing is what can move funds. If you connected to a site you don't trust — a lookalike of a real one — disconnect it in your wallet app and revoke anything it asked you to sign.")}
          </p>
          <button type="button" className="seeker-btn seeker-btn-quiet seeker-disconnect-btn" onClick={onDisconnect}>
            {t("Disconnect and forget this device's pass")}
          </button>
        </>
      ) : done ? (
        <p className="seeker-disconnect-done" role="status">
          {t("Disconnected. This device no longer holds a tools pass or a receipt sign-in for that wallet. A receipt for a pass you paid for is kept, so you don't lose it.")}
        </p>
      ) : (
        <p className="seeker-disconnect-explain">{t("No wallet is connected to this app right now.")}</p>
      )}

      <div className="seeker-disconnect-steps">
        <p className="seeker-disconnect-steps-title">{t("Still to do in your wallet app")}</p>
        <p>{t("Open your wallet's settings and look for Connected apps, Trusted apps or Connected sites. Remove clucknorris.app and anything you don't recognise. In Phantom: Settings → Connected Apps.")}</p>
        <p>{t("If you signed anything on a site you don't trust, revoke the approvals above and move what matters to a fresh wallet.")}</p>
        <p className="seeker-disconnect-limit">{t("Nothing here can see or remove connections stored inside your wallet app — only the wallet can.")}</p>
      </div>
    </section>
  );
}
