// The FULL edition of the shell — the Solana Seeker dApp Store app. Every tool, a wallet, the
// signing flows. This is what src/seeker/App.jsx imports as "@seeker-edition" by default.
//
// ⚠️ WHY THE SHELL HAS EDITIONS, AND WHY THEY ARE SEPARATE MODULES. The Google Play / iOS app is
// an education-only bundle (docs/STORE_EDITION.md): no wallet, no payments, no address, compiled
// OUT rather than hidden. The owner asked for that app to look and work like this shell rather
// than the reflowed website it shipped as (v1.0.x). Two ways to do that: gate the wallet pieces
// with `if (STORE)` and trust tree-shaking, or give each edition its own module that DECLARES its
// tabs, routes and wallet and simply never imports what it must not carry. The second is the one
// whose safety can be read off the import list, so that is the one — vite.config.js aliases
// "@seeker-edition" to this file or to ./edu.jsx at build time, and the store build's forbidden-
// string scan (store-edition.json) is the second lock on the door.
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { t, useI18nReady } from "../i18n.js";
import { shortAddr } from "../addr.js";
import { NeedsWallet } from "../needswallet.jsx";
import RentReclaimPane from "../RentReclaim.jsx";
import AskCluckPane from "../AskCluck.jsx";
import WalletCheckupPane from "../WalletCheckup.jsx";
import { AddressForm, AddressBar } from "../addressform.jsx";
import ToolsHome from "../ToolsHome.jsx";
import { SolanaRoomIndex, SolanaRoomPage } from "../solana/SolanaRoom.jsx";
import { SeekerWingIndexSection, SeekerWingPage } from "../solana/SeekerWing.jsx";
import { SchoolHome, SchoolCourse, SchoolLesson } from "../school/School.jsx";
import ListingCheckup from "../tools/ListingCheckup.jsx";
import DailyBrief from "../tools/DailyBrief.jsx";
import Firepit from "../tools/Firepit.jsx";
import ProjectBurn from "../tools/ProjectBurn.jsx";
import LockerRoom from "../tools/LockerRoom.jsx";
import WalletXray from "../tools/WalletXray.jsx";
import Holders from "../tools/Holders.jsx";
import Trace from "../tools/Trace.jsx";
import Airdropper from "../tools/Airdropper.jsx";
import Hatchery from "../tools/Hatchery.jsx";
import ShieldIcon from "../icons/ShieldIcon.jsx";
import "./full.css";

export const EDITION_ID = "full";
export const HAS_WALLET = true;

// Anywhere a user can connect a wallet, they must be able to disconnect (CLAUDE.md) — this is
// the one control surface, so both live in the same place with the provider's own disconnect()
// called and local state cleared either way.
export function useWallet() {
  // `provider` is kept here (not just address/name) because Rent Reclaim signing
  // (src/seeker/reclaim-sign.js) needs the CONNECTED wallet's own provider object to ask for a
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

// The header's wallet zone: status + the one connect/disconnect control.
export function HeaderExtra({ wallet }) {
  return (
    <>
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
    </>
  );
}

// ── Wallet Checkup: the connected wallet by default, any pasted address as an override ─────────
// Parity with the website's own Wallet Checkup (any address, always) while still defaulting to
// "just works" for someone who already connected. Three states, in priority order:
//   1. a pasted address is set — it WINS, however the wallet is doing. The bar shows it (shared
//      with the education edition's own AddressBar) with "Check another" to drop back to the
//      connected wallet (or the form, if none is connected).
//   2. no pasted address, wallet connected — the checkup runs on wallet.address with no paste
//      needed, plus a quiet "Check another" control that reveals the paste form.
//   3. no pasted address, no wallet — the paste form AND the connect gate render together, so
//      connecting stays one tap without losing the option to check someone else's address first.
function FullCheckup({ wallet }) {
  useI18nReady();
  const [pasted, setPasted] = React.useState(null);
  const [pasting, setPasting] = React.useState(false);

  if (pasted) {
    return (
      <>
        <AddressBar address={pasted} onClear={() => { setPasted(null); setPasting(false); }} />
        <WalletCheckupPane address={pasted} />
      </>
    );
  }

  if (wallet.connected && !pasting) {
    return (
      <>
        <WalletCheckupPane address={wallet.address} />
        <button type="button" className="seeker-btn seeker-btn-quiet seeker-checkup-another" onClick={() => setPasting(true)}>
          {t("Check another")}
        </button>
      </>
    );
  }

  // No address decided yet — routed through the pane itself (address=null) so its own "Wallet
  // Checkup" header and .seeker-pane wrapper still render here, same as every other state; a
  // bare form with no pane around it briefly shipped and both the app's own route-render and
  // grid-mount checks caught it (a tool card whose pane never mounts a recognised pane class).
  const gate = wallet.connected
    ? <AddressForm onSubmit={setPasted} />
    : (
      <>
        <AddressForm onSubmit={setPasted} />
        <NeedsWallet why="Connect your wallet to run a checkup." wallet={wallet} />
      </>
    );
  return <WalletCheckupPane address={null} gate={gate} />;
}

// ⚠️ THE SCHOOL LEADS. AGENTS.md records the owner's flagship list — "the school, the LP lab,
// the airdropper, the locker room, the fire pit, project burn" — and the school is first. The app
// shipped landing on /tools with no school in it at all; do not put the toolkit back in front.
export const TABS = [
  { to: "/school", label: "School", icon: "🎓" },
  { to: "/tools", label: "Toolkit", icon: "🧰" },
  { to: "/rent", label: "Rent", icon: "💰" },
  { to: "/ask", label: "Ask", icon: "🐔" },
  { to: "/checkup", label: "Checkup", icon: <ShieldIcon /> },
];

// The routes THIS edition registers — kept as data so a doc-mentioned, not-yet-shipped feature
// (the in-app swap, docs/SWAP_DESIGN.md / PR #420) can be announced once its own route actually
// exists here, rather than a hand-set boolean silently drifting from the truth. Keep this list in
// sync with the <Route> elements below; scripts/seeker-solana-room-test.cjs pins that it is.
export const REGISTERED_ROUTES = [
  "/", "/school", "/school/:courseId", "/school/:courseId/:lessonId",
  "/solana", "/solana/:pageId", "/solana/seeker/:pageId",
  "/tools", "/rent", "/ask", "/checkup",
  "/tools/listing", "/tools/alpha", "/tools/firepit", "/tools/burn", "/tools/lock",
  "/tools/xray", "/tools/holders", "/tools/trace", "/tools/airdrop", "/tools/hatchery",
];
const SWAP_AVAILABLE = REGISTERED_ROUTES.includes("/tools/swap");

export function EditionRoutes({ wallet }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/school" replace />} />
      <Route path="/school" element={<SchoolHome />} />
      <Route path="/school/:courseId" element={<SchoolCourse />} />
      <Route path="/school/:courseId/:lessonId" element={<SchoolLesson />} />
      <Route path="/solana" element={<SolanaRoomIndex extra={<SeekerWingIndexSection />} />} />
      <Route path="/solana/:pageId" element={<SolanaRoomPage />} />
      <Route path="/solana/seeker/:pageId" element={<SeekerWingPage swapAvailable={SWAP_AVAILABLE} />} />
      <Route path="/tools" element={<ToolsHome />} />
      <Route path="/rent" element={<RentReclaimPane wallet={wallet} />} />
      <Route path="/ask" element={<AskCluckPane />} />
      <Route path="/checkup" element={<FullCheckup wallet={wallet} />} />
      <Route path="/tools/listing" element={<ListingCheckup />} />
      <Route path="/tools/alpha" element={<DailyBrief />} />
      <Route path="/tools/firepit" element={<Firepit wallet={wallet} />} />
      <Route path="/tools/burn" element={<ProjectBurn wallet={wallet} />} />
      <Route path="/tools/lock" element={<LockerRoom wallet={wallet} />} />
      <Route path="/tools/xray" element={<WalletXray wallet={wallet} />} />
      <Route path="/tools/holders" element={<Holders wallet={wallet} />} />
      <Route path="/tools/trace" element={<Trace wallet={wallet} />} />
      <Route path="/tools/airdrop" element={<Airdropper wallet={wallet} />} />
      <Route path="/tools/hatchery" element={<Hatchery wallet={wallet} />} />
      <Route path="*" element={<Navigate to="/tools" replace />} />
    </Routes>
  );
}

// The full app has no legal footer of its own — the dApp Store listing carries the links.
export function Footer() { return null; }
