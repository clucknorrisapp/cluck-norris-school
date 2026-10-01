// The "connect a wallet" gate a pane renders instead of its body.
//
// ⚠️ IN ITS OWN MODULE ON PURPOSE. This lived in pane.jsx beside Loading/Unavailable/Refused,
// and pane.jsx is imported by every pane — including the ones the Google Play / iOS edition
// carries (Daily, Listing Checkup). That edition is education-only and its build REFUSES the
// string "CluckWallet" anywhere in the bundle (store-edition.json `forbidden`), so a wallet gate
// living in the shared module would have failed the store build the first time it was tried —
// or worse, shipped a wallet reference into a bundle whose listing says there is none. Only the
// wallet panes import this file, and the education edition's route table never mounts one.
//
// It NEVER fakes a connection and never renders a result implying a wallet was read. Inside the
// bundled app with no native MWA bridge, `CluckWallet.available()` is empty — say that plainly
// rather than spinning.
import React from "react";
import { t, useI18nReady } from "./i18n.js";

export function NeedsWallet({ why, wallet }) {
  useI18nReady();
  const [noWallet, setNoWallet] = React.useState(false);
  React.useEffect(() => {
    try {
      const CW = window.CluckWallet;
      setNoWallet(!!(CW && typeof CW.available === "function" && CW.available().length === 0));
    } catch (_) { setNoWallet(false); }
  }, []);
  return (
    <div className="seeker-tool-needswallet">
      <p>{t(why || "Connect your wallet to use this.")}</p>
      {noWallet
        ? <p className="seeker-tool-note">{t("No wallet app was found on this device.")}</p>
        : <button type="button" className="seeker-btn" onClick={wallet && wallet.connect}>{t("Connect Wallet")}</button>}
    </div>
  );
}
