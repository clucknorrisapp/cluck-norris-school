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

// i18n.js finishes loading its dictionary asynchronously (a fetch, in the shipped runtime), so a
// component that read t() at first render can be stuck showing English forever with no prompt to
// re-read it. This mirrors solana-room.html's waitForI18n(): poll briefly, then stop — never an
// indefinite loop, never a network call of its own.
export function useI18nReady(timeoutMs) {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && !!window.CLKN_I18N);
  useEffect(() => {
    if (ready) return undefined;
    let stopped = false;
    const start = Date.now();
    const limit = timeoutMs || 1500;
    function poll() {
      if (stopped) return;
      if ((typeof window !== "undefined" && window.CLKN_I18N) || Date.now() - start > limit) {
        if (!stopped) setReady(true);
        return;
      }
      setTimeout(poll, 30);
    }
    poll();
    return () => { stopped = true; };
  }, [ready, timeoutMs]);
  return ready;
}
