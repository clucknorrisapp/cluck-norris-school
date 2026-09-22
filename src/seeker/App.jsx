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
import { HashRouter, NavLink } from "react-router-dom";
import { t, useI18nReady } from "./i18n.js";
// ⚠️ THE EDITION. vite.config.js aliases "@seeker-edition" to src/seeker/edition/full.jsx (the
// Solana Seeker dApp Store app — every tool, a wallet) or to src/seeker/edition/edu.jsx (the
// Google Play / iOS app — education only, no wallet, compiled out rather than hidden). Each
// module declares its own tabs, routes, wallet and footer, and the education one never imports a
// wallet pane at all — the safety argument is its import list, not a conditional in this file.
// Read both headers before touching the shape of this shell.
import { useWallet, HeaderExtra, TABS, EditionRoutes, Footer } from "@seeker-edition";

function Header({ wallet }) {
  useI18nReady();
  return (
    <header className="seeker-header">
      <div className="seeker-brand" data-clkn-avoid="1">Cluck Norris</div>
      <HeaderExtra wallet={wallet} />
    </header>
  );
}

// ⚠️ THE SCHOOL LEADS in both editions — the first tab is /school (AGENTS.md's flagship list; the
// app once shipped landing on /tools with no school in it). Each edition's TABS starts there.
function BottomNav() {
  useI18nReady();
  return (
    <nav className="seeker-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/tools" || tab.to === "/school"}
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
          <EditionRoutes wallet={wallet} />
          <Footer />
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  );
}
