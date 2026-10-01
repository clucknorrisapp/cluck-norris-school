// The certificate of completion — the education edition's graduation (docs/STORE_EDITION.md).
//
// Issued by POST /api/claim/certificate against the SAME server-side lesson ledger the website's
// wallet claim checks (lib/school-progress), keyed by this device's own anonymous session id —
// the one every lesson beacon already carries (src/track.js). No wallet, no address, no account;
// the name typed here stays on the device and is never sent. One certificate per learner session,
// verifiable by anyone at /certificate/<id>.
//
// ⚠️ THIS IS NOT THE DIPLOMA cNFT, and it must not be described as one. That claim is wallet-signed
// and treasury-paid and lives on the website. This is a dated record with a verification code.
//
// The gate can say "not yet" (403 not_yet): the ledger's live-spread check has not seen enough
// real lessons from this device yet. That is a true statement about the record, so it is shown as
// one — finish more lessons, minutes apart — never as an error the app caused.
import React from "react";
import { Link } from "react-router-dom";
import { t, tf, useI18nReady } from "../i18n.js";
import { sessionId, flushTrackQueue, track } from "../../track.js";
import { COURSES, TOTAL_LESSONS, completedIds } from "./curriculum.js";

const NAME_KEY = "clkn_cert_name";

// The website's certificate carries the same two counts (its readCoursework()); here they come
// from the shell's course-scoped keys. Informational on the server — the ledger is the record.
function coursework() {
  const done = completedIds();
  const count = (courseId) => done.filter((k) => k.indexOf(courseId + ":") === 0).length;
  return { lpLab: count("lp"), incubator: count("basics") };
}

export default function Certificate() {
  useI18nReady();
  const [cert, setCert] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [notYet, setNotYet] = React.useState(null);   // the gate's own sentence, when it says so
  const [err, setErr] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [name, setName] = React.useState(() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch (_) { return ""; } });

  const doneCount = React.useMemo(() => {
    const done = completedIds();
    return COURSES.reduce((n, c) => n + c.lessons.filter((l) => done.indexOf(l.key) !== -1).length, 0);
  }, []);

  const issue = React.useCallback(async () => {
    setBusy(true); setErr(""); setNotYet(null);
    try {
      // Any lesson mark that never reached the ledger goes first — a certificate refused because a
      // beacon was lost on a bad connection would be wrong, and this is the fix the website uses.
      await flushTrackQueue();
      const res = await fetch("/api/claim/certificate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: sessionId(), coursework: coursework() }),
      });
      const d = await res.json().catch(() => null);
      if (d && d.ok && d.certificate) { setCert(d.certificate); track("certificate_issued"); }
      else if (res.status === 403 && d && d.error === "not_yet") setNotYet(d.detail || "");
      else setErr((d && (d.detail || d.error)) || t("The certificate could not be issued just now — try again in a moment."));
    } catch (_) {
      setErr(t("No connection — try again when you're back online."));
    }
    setBusy(false);
  }, []);

  React.useEffect(() => { issue(); }, [issue]);

  const saveName = (v) => { setName(v); try { localStorage.setItem(NAME_KEY, v); } catch (_) {} };

  async function share() {
    if (!cert) return;
    const text = tf("I completed the School of Crypto Hard Knocks. Certificate {id}: {url}", { id: cert.id, url: cert.verifyUrl });
    try { if (navigator.share) { await navigator.share({ title: t("Certificate of completion"), text, url: cert.verifyUrl }); return; } } catch (_) {}
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch (_) {}
  }

  return (
    <div className="seeker-pane seeker-school">
      <Link className="seeker-school-back" to="/school">{t("Back to the school")}</Link>
      <div className="seeker-school-passed">
        <div className="seeker-school-passed-mark" aria-hidden="true">🎓</div>
        <h1 className="seeker-school-title">{t("Certificate of completion")}</h1>
        <p className="seeker-tool-lede">
          {tf("{done} of {total} lessons finished on this phone. Free, no wallet, no sign-up — and nothing to buy.", { done: doneCount, total: TOTAL_LESSONS })}
        </p>
      </div>

      <div className="seeker-cert-card">
        <div className="seeker-cert-kicker">{t("Certificate of completion")}</div>
        <label className="seeker-cert-label" htmlFor="cert-name">
          {t("Name on the certificate (stays on this device — never sent anywhere)")}
        </label>
        <input
          id="cert-name"
          className="seeker-edu-addrinput"
          value={name}
          onChange={(e) => saveName(e.target.value.slice(0, 60))}
          placeholder={t("Your name (optional)")}
          autoComplete="off"
        />

        {cert ? (
          <div className="seeker-cert-paper">
            <div className="seeker-cert-school">CLUCK NORRIS · {t("School of Crypto Hard Knocks")}</div>
            <div className="seeker-cert-name">{name.trim() || t("A Hard Knocks graduate")}</div>
            <div className="seeker-cert-line">{t("completed the School of Crypto Hard Knocks curriculum.")}</div>
            <div className="seeker-cert-meta">
              {tf("Issued {date} · Certificate ID {id}", { date: new Date(cert.issuedAt).toLocaleDateString(), id: cert.id })}
            </div>
            <div className="seeker-cert-verify">{t("Verify:")} {cert.verifyUrl}</div>
          </div>
        ) : null}

        {!cert && busy ? <p className="seeker-tool-note">{t("Issuing your certificate…")}</p> : null}

        {!cert && notYet !== null ? (
          <div className="seeker-tool-unavailable" role="status">
            <p>{t("The school's record does not show the full curriculum for this phone yet. Finish every lesson here — a few minutes apart, the way a real learner does — then try again.")}</p>
          </div>
        ) : null}

        {err ? <div className="seeker-tool-unavailable" role="alert"><p>{err}</p></div> : null}
        {copied ? <p className="seeker-tool-note">{t("Copied to clipboard.")}</p> : null}

        {cert
          ? <button type="button" className="seeker-btn seeker-cert-btn" onClick={share}>{t("Share")}</button>
          : <button type="button" className="seeker-btn seeker-cert-btn" onClick={issue} disabled={busy}>{t("Try again")}</button>}
      </div>
    </div>
  );
}
