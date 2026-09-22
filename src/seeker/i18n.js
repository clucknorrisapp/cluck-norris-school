// Cluck Norris — Seeker app i18n.
//
// Same small page-local lookup as public/hub-glossary.html and public/solana-room.html: a
// curated dict lookup over window.CLKN_I18N.dict (populated by /i18n.js, loaded as a plain
// script in seeker.html before this module runs), English literal on a miss, no
// machine-translation fallback FOR THIS CALL — i18n.js's own MutationObserver still walks the
// rendered DOM and fills in machine translation for anything t() didn't already catch, exactly
// as it does on every other page. scripts/i18n-audit.cjs's Hub-pages gate (and
// scripts/seeker-build-test.cjs) scan for every literal passed to t() and expect it in all six
// curated dictionaries.
import { useEffect, useState } from "react";

export function t(s) {
  try {
    const d = typeof window !== "undefined" && window.CLKN_I18N && window.CLKN_I18N.dict;
    if (d && d[s]) return d[s];
  } catch (_) {}
  return s;
}

// A translated sentence with a VALUE in it — the repo's existing `{name}` convention, the same
// one public/hub-verify.html's tf() uses and the one scripts/i18n-audit.cjs already checks for
// placeholder mismatches between English and each translation.
//
// ⚠️ THIS EXISTS BECAUSE THE OBVIOUS THING IS BROKEN IN SIX LANGUAGES. "Try again in " + n + "s"
// was built from three separate t() calls in three panes. It reads fine in English and cannot be
// translated at all: word order differs, and "s" is not how any of our six languages marks
// seconds. A translator handed "Try again in" and "s" as separate strings has no way to produce
// a correct sentence — one of them returned "" for the "s" and said so, which was the honest
// answer and is what surfaced this. A value goes INSIDE one whole sentence, always.
export function tf(s, vars) {
  let out = t(s);
  if (vars) for (const k of Object.keys(vars)) out = out.split("{" + k + "}").join(String(vars[k]));
  return out;
}

// A BLOCK of prose — a lesson section body, paragraphs separated by blank lines.
//
// ⚠️ THE DICTIONARY KEYS ARE NORMALISED, THE VALUES ARE NOT. i18n.js stores every curated key
// with whitespace collapsed (`norm()` — 0 of the 4,238 school keys contain a newline), and the
// professionally translated VALUE keeps its "\n\n" paragraph breaks. So a multi-paragraph body
// is found only by looking up the WHOLE body, collapsed, and then splitting the translation —
// never by splitting the English first and looking up each paragraph (10 of 529 paragraphs
// exist as keys; 107 of 125 whole bodies do). The first build split first, and every LP Lab and
// Deep Dive body rendered in English under a translated heading (Codex on PR #390, from the APK).
//
// Returns the translated block and whether it was curated, so the caller can mark the element
// `data-i18n-skip` — otherwise i18n.js's observer sees Spanish, misses the lookup, and queues it
// for machine translation, which costs money to make worse.
export function tBlock(s) {
  const src = String(s || "");
  const key = src.replace(/\s+/g, " ").trim();
  try {
    const d = typeof window !== "undefined" && window.CLKN_I18N && window.CLKN_I18N.dict;
    if (key && d && d[key] && d[key] !== key) return { text: d[key], translated: true };
  } catch (_) {}
  return { text: src, translated: false };
}

// i18n.js finishes loading its dictionary asynchronously (a fetch, in the shipped runtime), so a
// component that read t() at first render would show English forever with nothing prompting it
// to re-read. This re-renders the caller when the dictionary lands.
//
// ⚠️ EVENT-DRIVEN, WITH NO TIMEOUT ON THE LISTENER. The first version polled for 1.5 s and then
// gave up, which meant a lesson opened directly (a deep link, a reload) on a slow load rendered
// English, was never told the dictionary had arrived, and stayed English — and the page observer
// then machine-translated the English paragraphs it found (Codex, PR #390 round 9). i18n.js now
// dispatches "clkn:i18n-ready" the moment window.CLKN_I18N is set; the listener stays for the
// life of the component. A short bounded poll covers the race between the first render's check
// and the listener attaching. Never a network call of its own.
//
// ⚠️ Every pane that renders t() or a lesson body must call this — not just the header and the
// nav. The hook re-renders ITS OWN caller only.
export function useI18nReady() {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.CLKN_I18N);
  useEffect(() => {
    if (ready || typeof window === "undefined") return undefined;
    let stopped = false;
    const arrive = () => { if (!stopped) setReady(true); };
    window.addEventListener("clkn:i18n-ready", arrive);
    const poll = setInterval(() => { if (window.CLKN_I18N) arrive(); }, 50);
    const stopPoll = setTimeout(() => clearInterval(poll), 3000);
    return () => { stopped = true; window.removeEventListener("clkn:i18n-ready", arrive); clearInterval(poll); clearTimeout(stopPoll); };
  }, [ready]);
  return ready;
}
