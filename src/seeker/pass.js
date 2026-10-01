// The unified tools pass, bound into the Seeker app (docs/SEEKER_TOOLS_BUILD.md §5).
//
// ⚠️ THIS FILE DELIBERATELY IMPLEMENTS ALMOST NOTHING. public/cluck-gate.js is the one pass
// client the whole platform uses, and CLAUDE.md's standing rule is that re-typing a shared
// browser module into a page is how private copies drift into real bugs. So the credential
// itself — the localStorage key, the server-issued token, what counts as proof, which errors
// mean "the pass died, clear it" — is used from window.CluckGate, never re-derived here.
//
// The ONE thing not reused is `CluckGate.guard()`. Not because it is wrong: because it renders
// its own DOM "gate card", which is desktop tool-page chrome. A phone app needs a native sheet,
// and the hackathon scores exactly that difference ("direct ports ... will score poorly"). So
// this file reuses the whole credential surface and replaces only the presentation:
//
//   reused   → config() pass() proof() fetch() clear() denied() grant()
//   replaced → guard()'s card, by <PassGate> in the app's own visual language
//
// If cluck-gate.js changes how a pass is proven, this file inherits it for free. That is the
// point.
import React from "react";

function gate() {
  try { return (typeof window !== "undefined" && window.CluckGate) || null; } catch (_) { return null; }
}

// Can this device produce a signature at all? The pass is a SIGNED SESSION — the wallet signs a
// server-issued nonce and /api/tool-gate/session returns the token. Inside the bundled app the
// native MWA bridge does not exist yet, so there is no wallet and no signature to be had. A pane
// must say that plainly rather than offering a button that cannot work.
export function canSign() {
  try {
    const CW = window.CluckWallet;
    if (!CW || typeof CW.available !== "function") return false;
    return CW.available().length > 0;
  } catch (_) { return false; }
}

// Live pass terms. NEVER hardcode the CLKN amount, the SOL price or the duration — they are
// computed server-side from the live price and are an append-only schedule; a number frozen into
// the app would be wrong the first time the offer moves, in an app that cannot be hot-fixed.
// A null config means the gate is down, and the documented behaviour there is FAIL OPEN.
export function usePassConfig() {
  const [cfg, setCfg] = React.useState({ phase: "loading", data: null });
  React.useEffect(() => {
    let alive = true;
    const g = gate();
    if (!g) { setCfg({ phase: "unavailable", data: null }); return undefined; }
    Promise.resolve(g.config())
      .then((d) => { if (alive) setCfg(d ? { phase: "ok", data: d } : { phase: "open", data: null }); })
      .catch(() => { if (alive) setCfg({ phase: "open", data: null }); });
    return () => { alive = false; };
  }, []);
  return cfg;
}

// The pass as the app needs to reason about it.
//   "off"         — the gate is disabled or its config is down. Everything runs. (Fail open.)
//   "held"        — a live pass/grant exists and carries server-issued proof.
//   "needed"      — no proof; a run must open the gate.
//   "unsignable"  — no wallet on this device can sign, so a pass cannot be obtained here.
export function usePass() {
  const cfg = usePassConfig();
  const [tick, setTick] = React.useState(0);
  const refresh = React.useCallback(() => setTick((n) => n + 1), []);

  const status = React.useMemo(() => {
    const g = gate();
    if (!g) return "off";
    if (cfg.phase === "loading") return "loading";
    if (cfg.phase === "open" || (cfg.data && cfg.data.enabled === false)) return "off";
    try { if (g.proof()) return "held"; } catch (_) {}
    return canSign() ? "needed" : "unsignable";
  }, [cfg, tick]);

  // The gated fetch. Sends x-clkn-pass, and — this is the part worth reusing rather than
  // rewriting — when the server refuses the pass it DROPS the local grant, so the next run
  // re-opens the gate instead of the tool silently retrying with a dead credential.
  const gatedFetch = React.useCallback(async (url, opts) => {
    const g = gate();
    if (!g || typeof g.fetch !== "function") return fetch(url, opts);
    return g.fetch(url, opts);
  }, []);

  // True when a {success:false} body is a PASS denial rather than an unrelated tool error. Call
  // it before showing an error: a denial should re-open the gate, not print a raw code on screen.
  const isDenial = React.useCallback((body) => {
    const g = gate();
    try { return !!(g && typeof g.denied === "function" && g.denied(body)); } catch (_) { return false; }
  }, []);

  const clear = React.useCallback(() => {
    const g = gate();
    try { g && g.clear && g.clear(); } catch (_) {}
    refresh();
  }, [refresh]);

  return { status, config: cfg.data, gatedFetch, isDenial, clear, refresh, expiresAt: (() => {
    const g = gate();
    try { const p = g && g.pass && g.pass(); return (p && p.expiresAt) || null; } catch (_) { return null; }
  })() };
}
