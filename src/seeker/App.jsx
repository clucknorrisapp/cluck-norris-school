// Cluck Norris — Seeker app shell (increment 1, docs/SEEKER_APP_PLAN.md).
//
// A phone-shaped entry surface, built fresh for a phone — not the desktop tool pages reflowed:
// safe-area insets, a bottom nav, >=44px tap targets, no site-wide nav pill or desktop chrome.
// Hash routing (HashRouter) is load-bearing, not a style choice: this bundle ships INSIDE the
// Capacitor app with no server behind it to rewrite a deep path back to index.html, so every
// route must resolve client-side off the `#` fragment (CLKN-SEEKER's DELIVERY-CONTRACT.md).
//
// Increment 2 (docs/SEEKER_APP_PLAN.md): Rent Reclaim is now the real, read-side pane
// (RentReclaim.jsx) — enumerate + classify only, no signing (that's increment 3). The wallet
// control in the header exercises the shared, MWA-aware registry (public/cluck-wallet.js) end to
// end (connect/disconnect through window.CluckWallet) and now feeds the connected address to
// Rent Reclaim's scan.
//
// Increment 3: Ask Cluck (AskCluck.jsx) is real content too.
//
// Increment 4: Wallet Checkup (WalletCheckup.jsx) is the last of the three tabs to go real — a
// read-only, free, ungated scan over GET /api/wallet-checkup. All three bottom-nav tabs are now
// real panes; the shared placeholder <Pane> ("Coming soon") this comment used to describe is gone.
import React from "react";
import { HashRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { t, useI18nReady } from "./i18n.js";
import { shortAddr } from "./addr.js";
import RentReclaimPane from "./RentReclaim.jsx";
import AskCluckPane from "./AskCluck.jsx";
import WalletCheckupPane from "./WalletCheckup.jsx";
import ToolsHome from "./ToolsHome.jsx";
import ListingCheckup from "./tools/ListingCheckup.jsx";
import Launches from "./tools/Launches.jsx";
import DailyBrief from "./tools/DailyBrief.jsx";
import Firepit from "./tools/Firepit.jsx";
import ProjectBurn from "./tools/ProjectBurn.jsx";
import LockerRoom from "./tools/LockerRoom.jsx";
import WalletXray from "./tools/WalletXray.jsx";
import Holders from "./tools/Holders.jsx";
import Trace from "./tools/Trace.jsx";
import Airdropper from "./tools/Airdropper.jsx";

// Anywhere a user can connect a wallet, they must be able to disconnect (CLAUDE.md) — this is
// the one control surface, so both live in the same place with the provider's own disconnect()
// called and local state cleared either way.
function useWallet() {
  // `provider` is kept here (not just address/name) because increment 3 (Rent Reclaim signing,
  // src/seeker/reclaim-sign.js) needs the CONNECTED wallet's own provider object to ask for a
  // signature — it must come from this live connection, never be re-derived or looked up by
  // address, per docs/SEEKER_RECLAIM_SIGNING_SPEC.md's "destination is always the connected
  // wallet" rule.
  const [state, setState] = React.useState({ connected: false, address: null, name: null, provider: null, error: null });
  // ⚠️ P2-J (adversarial review, 2026-09-21): best-effort live tracking of the wallet's OWN
  // account-switch event, on top of reclaim-sign.js's own point-in-time check right before
  // signing (the check that actually matters — this is a second line of defense, not a
  // replacement for it: not every provider fires this event, and a background switch between
  // renders can still land only at sign time). Provider is whatever CluckWallet.connect()
  // returned, exactly as the spec requires — never re-derived or looked up by address.
  const listenerRef = React.useRef(null);
  const clearListener = React.useCallback(() => {
    if (listenerRef.current) { try { listenerRef.current(); } catch (_) {} listenerRef.current = null; }
  }, []);
  const attachAccountChanged = React.useCallback((provider) => {
    clearListener();
    if (!provider || typeof provider.on !== "function") return; // not every provider supports it
    const handler = () => {
      // The account changed under us — never silently re-point an in-flight scan or a confirm
      // sheet at a different wallet. Drop the connection; the pane's own "not connected" state
      // and reasonForConnect prompt the person to reconnect and rescan explicitly.
      setState({ connected: false, address: null, name: null, provider: null, error: null });
    };
    try {
      const off = provider.on("accountChanged", handler);
      listenerRef.current = typeof off === "function" ? off : () => { try { provider.off && provider.off("accountChanged", handler); } catch (_) {} };
    } catch (_) {}
  }, [clearListener]);
  const connect = React.useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const CW = typeof window !== "undefined" && window.CluckWallet;
      if (!CW) throw new Error("Wallet layer did not load.");
      const r = await CW.connect();
      setState({ connected: true, address: r.pubkey, name: r.name, provider: r.provider, error: null });
      attachAccountChanged(r.provider);
    } catch (e) {
      setState((s) => ({ ...s, error: (e && e.message) || String(e) }));
    }
  }, [attachAccountChanged]);
  const disconnect = React.useCallback(() => {
    clearListener();
    try { window.CluckWallet && window.CluckWallet.disconnect(); } catch (_) {}
    setState({ connected: false, address: null, name: null, provider: null, error: null });
  }, [clearListener]);
  React.useEffect(() => clearListener, [clearListener]); // unmount safety net
  return { ...state, connect, disconnect };
}

function Header({ wallet }) {
  useI18nReady();
  return (
    <header className="seeker-header">
      <div className="seeker-brand" data-clkn-avoid="1">Cluck Norris</div>
      <div className="seeker-walletzone">
        <span className="seeker-walletstatus">
          {wallet.connected ? shortAddr(wallet.address) : t("Not connected")}
        </span>
        <button
          type="button"
          className="seeker-walletbtn"
          onClick={wallet.connected ? wallet.disconnect : wallet.connect}
        >
          {wallet.connected ? t("Disconnect") : t("Connect Wallet")}
        </button>
      </div>
      {wallet.error ? <div className="seeker-walleterr" role="alert">{wallet.error}</div> : null}
    </header>
  );
}

const TABS = [
  { to: "/tools", label: "Toolkit", icon: "🧰" },
  { to: "/rent", label: "Rent", icon: "💰" },
  { to: "/ask", label: "Ask", icon: "🐔" },
  { to: "/checkup", label: "Checkup", icon: "🛡" },
];

function BottomNav() {
  useI18nReady();
  return (
    <nav className="seeker-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/tools"}
          className={({ isActive }) => "seeker-navbtn" + (isActive ? " active" : "")}
        >
          <span className="seeker-navicon" aria-hidden="true">{tab.icon}</span>
          <span className="seeker-navlabel">{t(tab.label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const wallet = useWallet();
  return (
    <HashRouter>
      <div className="seeker-shell">
        <Header wallet={wallet} />
        <main className="seeker-main">
          <Routes>
            <Route path="/" element={<Navigate to="/tools" replace />} />
            <Route path="/tools" element={<ToolsHome />} />
            <Route path="/rent" element={<RentReclaimPane wallet={wallet} />} />
            <Route path="/ask" element={<AskCluckPane />} />
            <Route path="/checkup" element={<WalletCheckupPane wallet={wallet} />} />
            <Route path="/tools/listing" element={<ListingCheckup />} />
            <Route path="/tools/bags" element={<Launches />} />
            <Route path="/tools/alpha" element={<DailyBrief />} />
            <Route path="/tools/firepit" element={<Firepit wallet={wallet} />} />
            <Route path="/tools/burn" element={<ProjectBurn wallet={wallet} />} />
            <Route path="/tools/lock" element={<LockerRoom wallet={wallet} />} />
            <Route path="/tools/xray" element={<WalletXray wallet={wallet} />} />
            <Route path="/tools/holders" element={<Holders wallet={wallet} />} />
            <Route path="/tools/trace" element={<Trace wallet={wallet} />} />
            <Route path="/tools/airdrop" element={<Airdropper wallet={wallet} />} />
            <Route path="*" element={<Navigate to="/tools" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  );
}
