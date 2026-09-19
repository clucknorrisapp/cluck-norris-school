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
