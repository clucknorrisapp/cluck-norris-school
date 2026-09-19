// Cluck Norris — Seeker app shell (increment 1, docs/SEEKER_APP_PLAN.md).
//
// A phone-shaped entry surface, built fresh for a phone — not the desktop tool pages reflowed:
// safe-area insets, a bottom nav, >=44px tap targets, no site-wide nav pill or desktop chrome.
// Hash routing (HashRouter) is load-bearing, not a style choice: this bundle ships INSIDE the
// Capacitor app with no server behind it to rewrite a deep path back to index.html, so every
// route must resolve client-side off the `#` fragment (CLKN-SEEKER's DELIVERY-CONTRACT.md).
//
// Three placeholder panes only — Rent Reclaim, Ask Cluck, Wallet Checkup — per the plan's
// increment-1 scope. The wallet control in the header exercises the shared, MWA-aware registry
// (public/cluck-wallet.js) end to end (connect/disconnect through window.CluckWallet), but the
// three features themselves are not built here.
import React from "react";
import { HashRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { t, useI18nReady } from "./i18n.js";

function shortAddr(address) {
  try {
    if (window.CluckUtil && typeof window.CluckUtil.shortAddr === "function") return window.CluckUtil.shortAddr(address);
  } catch (_) {}
  const a = String(address || "");
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

// Anywhere a user can connect a wallet, they must be able to disconnect (CLAUDE.md) — this is
// the one control surface, so both live in the same place with the provider's own disconnect()
// called and local state cleared either way.
function useWallet() {
  const [state, setState] = React.useState({ connected: false, address: null, name: null, error: null });
  const connect = React.useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const CW = typeof window !== "undefined" && window.CluckWallet;
      if (!CW) throw new Error("Wallet layer did not load.");
      const r = await CW.connect();
      setState({ connected: true, address: r.pubkey, name: r.name, error: null });
    } catch (e) {
      setState((s) => ({ ...s, error: (e && e.message) || String(e) }));
    }
  }, []);
  const disconnect = React.useCallback(() => {
    try { window.CluckWallet && window.CluckWallet.disconnect(); } catch (_) {}
    setState({ connected: false, address: null, name: null, error: null });
  }, []);
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

function Pane({ title, blurb, icon }) {
  useI18nReady();
  return (
    <section className="seeker-pane">
      <div className="seeker-paneicon" aria-hidden="true">{icon}</div>
      <h1>{t(title)}</h1>
      <p>{t(blurb)}</p>
      <span className="seeker-badge">{t("Coming soon")}</span>
    </section>
  );
}

const TABS = [
  { to: "/rent", label: "Rent Reclaim", icon: "💰" },
  { to: "/ask", label: "Ask Cluck", icon: "🐔" },
  { to: "/checkup", label: "Wallet Checkup", icon: "🛡" },
];

function BottomNav() {
  useI18nReady();
  return (
    <nav className="seeker-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
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
            <Route path="/" element={<Navigate to="/rent" replace />} />
            <Route
              path="/rent"
              element={<Pane icon="💰" title="Rent Reclaim" blurb="Find dead token accounts and reclaim the SOL locked inside them." />}
            />
            <Route
              path="/ask"
              element={<Pane icon="🐔" title="Ask Cluck" blurb="Ask the AI tutor anything about crypto, in plain words." />}
            />
            <Route
              path="/checkup"
              element={<Pane icon="🛡" title="Wallet Checkup" blurb="Check approvals, freeze and mint authority — read-only and free." />}
            />
            <Route path="*" element={<Navigate to="/rent" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  );
}
