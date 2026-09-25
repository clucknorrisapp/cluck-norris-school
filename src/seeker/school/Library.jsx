// The Library — every term in the school, searchable, each one linked to the lessons that teach it.
//
// Owner (2026-09-25): "can we bring the library into the IOS version, seems like that would be easy
// to add as it is just terms and easily searchable and then can link into the school". The website
// Library (src/sections/Library.jsx) is three things: the Deep Dives and the liquidity articles —
// both already courses in this app — and a glossary. This is the glossary, merged with every
// lesson's own key terms (GLOSSARY in ./curriculum.js). It ships inside the bundle like the lessons
// do, so it works with no signal, and it needs no wallet: it belongs in every edition.
//
// Search runs over the term and its definition in BOTH English and the reader's language, so a
// Spanish reader can type "deslizamiento" or "slippage" and find the same entry.
import React from "react";
import { Link } from "react-router-dom";
import { t, tf, useI18nReady } from "../i18n.js";
import { GLOSSARY } from "./curriculum.js";

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function Library() {
  useI18nReady();
  const [q, setQ] = React.useState("");
  const needle = fold(q.trim());

  const shown = React.useMemo(() => {
    if (!needle) return GLOSSARY;
    const inTerm = [], inDef = [];
    for (const e of GLOSSARY) {
      const term = fold(e.term) + " " + fold(t(e.term));
      if (term.includes(needle)) { inTerm.push(e); continue; }
      if ((fold(e.def) + " " + fold(t(e.def))).includes(needle)) inDef.push(e);
    }
    return inTerm.concat(inDef);   // a match in the term itself ranks above one in a definition
  }, [needle]);

  return (
    <div className="seeker-pane seeker-school seeker-school-read seeker-library">
      {/* A bottom-nav tab since 2026-09-25 (it took the Solana Room's slot), so no "back" link —
          like Ask and Daily, it is a place you go, not a page you drill into. */}
      <h1 className="seeker-school-title">📖 {t("The Library")}</h1>
      <p className="seeker-tool-lede">
        {t("Every term in the school, in plain words. Tap a lesson to learn it properly.")}
      </p>

      <input
        className="seeker-library-search"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("Search a term")}
        aria-label={t("Search a term")}
      />
      <div className="seeker-library-count" aria-live="polite">
        {needle ? tf("{n} of {total} terms", { n: shown.length, total: GLOSSARY.length }) : tf("{total} terms", { total: GLOSSARY.length })}
      </div>

      {shown.length ? (
        <ul className="seeker-library-list">
          {shown.map((e) => (
            <li key={e.key} className="seeker-library-item">
              <div className="seeker-library-term">{t(e.term)}</div>
              {/* Outside English, the English name sits under the translated one: wallets,
                  explorers and exchanges show these words in English, so a reader can match what
                  they learned here to the screen in front of them (owner, 2026-09-25: "little
                  things where someone in another language notices that we spend extra time"). */}
              {/* translate="no": public/i18n.js walks the DOM translating text nodes, and without it
                  this line came out in Spanish too — the same words twice. */}
              {t(e.term) !== e.term ? <div className="seeker-library-en" lang="en" translate="no">{e.term}</div> : null}
              <p className="seeker-library-def">{t(e.def)}</p>
              {e.lessons.length ? (
                <div className="seeker-library-links">
                  <span className="seeker-library-learn">{t("Learn it in")}</span>
                  {e.lessons.map((l) => (
                    <Link key={l.key} className="seeker-library-link" to={`/school/${l.courseId}/${l.lessonId}`}>
                      <span aria-hidden="true">{l.icon}</span> {l.title}
                    </Link>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="seeker-library-empty">
          <p>{tf("Nothing in the Library matches “{q}”.", { q: q.trim() })}</p>
          <Link className="seeker-btn" to="/ask">{t("Ask Cluck instead")}</Link>
        </div>
      )}
    </div>
  );
}
