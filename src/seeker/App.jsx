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

// The 🌐 language picker lives in the header, not floating over the page (owner, 2026-09-25: it
// "randomly moves from bottom right to up higher", and its menu ran off the top of the screen).
// public/i18n.js builds the picker; this empty slot is where it docks. Whichever renders first,
// the other completes the move: i18n.js looks for [data-clkn-lang-host] when it injects, and this
// effect hands the slot over if the picker already exists. React renders no children into the
// slot, so it never removes the node i18n.js puts there.
function LangHost() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    try { if (window.__clknLangDockInto && ref.current) window.__clknLangDockInto(ref.current); } catch (_) {}
  }, []);
  return <div className="seeker-langhost" data-clkn-lang-host="1" ref={ref} />;
}

function Header({ wallet }) {
  useI18nReady();
  return (
    <header className="seeker-header">
      <div className="seeker-brand-wrap" data-clkn-avoid="1">
        <img className="seeker-brand-logo" src="/cluck-norris.png" alt="" decoding="async" />
        <div className="seeker-brand">Cluck Norris</div>
      </div>
      <LangHost />
      <HeaderExtra wallet={wallet} />
    </header>
  );
}

// ⚠️ THE SCHOOL LEADS in both editions — the first tab is /school (AGENTS.md's flagship list; the
// app once shipped landing on /tools with no school in it). Each edition's TABS starts there.
// A tab may name its own dictionary key when its English label is ambiguous. "Ask" is the case:
// the school dictionaries translate "Ask" as the ORDER-BOOK term (a sell order — the Library's
// glossary uses it), so the tab read "Ask (orden de venta)" in Spanish (owner, 2026-09-25).
function tabLabel(tab) {
  if (tab.i18nKey) { const v = t(tab.i18nKey); if (v !== tab.i18nKey) return v; }
  return t(tab.label);
}

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
          <span className="seeker-navlabel">{tabLabel(tab)}</span>
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
