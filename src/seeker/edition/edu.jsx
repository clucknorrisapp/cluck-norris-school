// The EDUCATION edition of the shell — the Google Play / iOS app (docs/STORE_EDITION.md).
//
// ⚠️ READ THE IMPORT LIST BEFORE ANYTHING ELSE. It is the whole safety argument: this module
// never imports a wallet pane, the wallet gate, the tools registry, the pass client, or the
// signing helpers, so none of them can reach the store bundle — no tree-shaking to trust, no
// `if (STORE)` to get wrong. What it carries is the school, Daily, Ask Cluck (with the report
// control Google's generative-AI policy asks for), a paste-an-address Wallet Checkup (scan only —
// the revoke flow is a signed transaction and lives on the website), Listing Checkup (its gate
// was client-side only; free here), the certificate of completion (no wallet, issued against the
// same server-side lesson ledger the website's wallet claim uses), and the store's own privacy
// and terms links. The build's forbidden-string scan (store-edition.json) is the second lock.
//
// The store listing, `/privacy/store` and `/terms/store` all say "no wallet, no payments, no
// address collection". Anything added here has to keep that sentence true.
import React from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { t, useI18nReady } from "../i18n.js";
import AskCluckPane from "../AskCluck.jsx";
import WalletCheckupPane from "../WalletCheckup.jsx";
import { AddressForm, AddressBar } from "../addressform.jsx";
import { SchoolHome, SchoolCourse, SchoolLesson } from "../school/School.jsx";
import Certificate from "../school/Certificate.jsx";
import ListingCheckup from "../tools/ListingCheckup.jsx";
import DailyBrief from "../tools/DailyBrief.jsx";
import ShieldIcon from "../icons/ShieldIcon.jsx";
import "./edu.css";

export const EDITION_ID = "edu";

// Hosts a backend-provided link may point at from inside this edition (the listing venues the
// checkup reads, plus our own site). ⚠️ Must stay a SUBSET of store-edition.json `allowedHosts` —
// scripts/store-edition-test.cjs asserts that — so the page never links where the build would
// refuse a hard-coded link. Not imported from that file: it also carries the forbidden-string
// list, which would put every forbidden string into the bundle.
export const LINK_HOSTS = [
  "clucknorris.app", "dexscreener.com", "geckoterminal.com", "birdeye.so", "coingecko.com",
  "coinmarketcap.com", "solscan.io", "rugcheck.xyz", "bubblemaps.io", "solana.com",
];
export const HAS_WALLET = false;

// No wallet in this edition — the shell still calls useWallet() so the two editions share one
// App.jsx; here it is nothing, and nothing downstream is handed it.
export function useWallet() { return null; }
export function HeaderExtra() { return null; }

// ── Wallet Checkup, by pasted address ────────────────────────────────────────────────────────
// AddressForm + AddressBar now live in ../addressform.jsx (shared with the full edition, which
// offers the same paste form as an override over the connected wallet — CLAUDE.md's one-copy
// rule). Behaviour here is unchanged: paste an address, scan it, "Check another" clears it.
function EduCheckup() {
  useI18nReady();
  const [address, setAddress] = React.useState(null);
  return (
    <>
      {address ? <AddressBar address={address} onClear={() => setAddress(null)} /> : null}
      <WalletCheckupPane address={address} gate={<AddressForm onSubmit={setAddress} />} />
    </>
  );
}

// ── the school's finished state, in this edition ─────────────────────────────────────────────
// The full app tells the truth that the diploma is claimed on the website. This edition can do
// better: the certificate of completion needs no wallet, and it is issued to THIS device's own
// lesson record — the same anonymous session id the beacons carry — so nothing is transferred
// and nothing is a bearer credential (docs/SEEKER_TRANSCRIPT_HANDOFF.md, design 4).
function FinishedEdu() {
  useI18nReady();
  return (
    <Link className="seeker-school-continue" to="/school/certificate">
      <span className="seeker-school-continue-label">{t("You've finished every lesson")}</span>
      <span className="seeker-school-continue-title">🎓 {t("Get your certificate of completion")}</span>
    </Link>
  );
}

export const TABS = [
  { to: "/school", label: "School", icon: "🎓" },
  { to: "/tools/alpha", label: "Daily", icon: "📅" },
  { to: "/ask", label: "Ask", icon: "🐔" },
  { to: "/checkup", label: "Checkup", icon: <ShieldIcon /> },
  { to: "/tools/listing", label: "Listing", icon: "📋" },
];

export function EditionRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/school" replace />} />
      <Route
        path="/school"
        element={<SchoolHome finished={<FinishedEdu />} progressNote="Finish every lesson to earn a certificate of completion. Free, no wallet, no sign-up." />}
      />
      <Route path="/school/certificate" element={<Certificate />} />
      <Route path="/school/:courseId" element={<SchoolCourse />} />
      <Route path="/school/:courseId/:lessonId" element={<SchoolLesson />} />
      <Route path="/ask" element={<AskCluckPane report />} />
      <Route path="/checkup" element={<EduCheckup />} />
      <Route path="/tools/listing" element={<ListingCheckup linkHosts={LINK_HOSTS} />} />
      <Route path="/tools/alpha" element={<DailyBrief />} />
      {/* Anything else — a stale deep link, a route the full app has and this one does not —
          lands on the school, never on a blank pane and never on a tool this edition lacks. */}
      <Route path="*" element={<Navigate to="/school" replace />} />
    </Routes>
  );
}

// The store's own legal pages (they describe THIS bundle: no wallet, no payments, no address),
// linked from inside the app because the store edition strips the website's nav pill where the
// site's legal links live — a v1.0.2 review finding, kept true here.
export function Footer() {
  useI18nReady();
  return (
    <footer className="seeker-edu-footer">
      <a href="https://clucknorris.app/privacy/store" target="_blank" rel="noopener noreferrer">{t("Privacy policy")}</a>
      <span aria-hidden="true">·</span>
      <a href="https://clucknorris.app/terms/store" target="_blank" rel="noopener noreferrer">{t("Terms of use")}</a>
      <span aria-hidden="true">·</span>
      <a href="https://clucknorris.app" target="_blank" rel="noopener noreferrer">{t("The full toolkit lives on clucknorris.app")}</a>
    </footer>
  );
}
