// Cluck Norris — Seeker app, Ask Cluck pane (increment 3, docs/SEEKER_APP_PLAN.md §4).
//
// A mobile-first chat surface over the existing, ungated, free AI tutor endpoint
// (POST /api/ask-cluck — server.js ~15176). Nothing here is gated by the tools pass; do not
// add one. Request/response shape verified by reading server.js directly, not guessed:
//   POST /api/ask-cluck  { question: string (3-2000 chars), context?: string, lang?: string }
//   200  { success: true, answer: string }
//   400  { success: false, error: "Question too short" | "Question too long" }
//   429  { success: false, ok: false, error: string, retryAfterSec: number, retryAfter: number }
//        — the SAME shape for the per-minute limiter (15/min, windowMs 60000, generic message)
//        and the daily cap (rateLimit("aiday"), windowMs 86400000, a friendly server message).
//        There is no field that names which one fired, so this tells them apart by
//        windowSec (added server-side with this pane) says which limiter fired outright; the old
//        retryAfterSec heuristic is kept only as a fallback for an older server. We build our own
//        t()-wrapped copy for both rather than showing the raw
//        server `error` string, which is untranslated English regardless of `lang` (the rate
//        limiter runs before aiLangDirective ever sees the request).
//   500  { success: false, error: "AI not configured" | "No response from AI" | <caught msg> }
//
// Four states, never conflated (RentReclaim.jsx's rule, CLAUDE.md): each turn in the thread is
// exactly one of THINKING, ANSWER or UNAVAILABLE, and the pane as a whole starts in an IDLE/EMPTY
// state (no messages yet) with starter prompts. A failed call renders a distinct error bubble —
// never an empty or blank answer bubble.
//
// Offline is first-class: this bundle ships inside a Capacitor app with no guarantee of a
// connection. `navigator.onLine` is checked before every send (skips the fetch entirely) and a
// failed fetch while offline is reported the same way; both recover automatically on the browser's
// `online` event.
//
// The answer is rendered as plain React text (never dangerouslySetInnerHTML) — it is model
// output and must not be trusted as markup.
//
// Conversation lives in useState only. Nothing here writes to localStorage — these are the
// user's own questions, and CLAUDE.md's "conversation stays in memory for the session" applies.
import React from "react";
import { t, tf, useI18nReady } from "./i18n.js";

const MAX_QUESTION_LEN = 2000;
const MIN_QUESTION_LEN = 3;

// Short, tappable starters drawn from what the school actually teaches (rent, wallet safety,
// liquidity, reading a receipt) — not generic chatbot filler.
const STARTERS = [
  "What is rent on Solana?",
  "How do I spot a wallet scam?",
  "What is liquidity, in plain words?",
  "How do I read a transaction receipt?",
];

function currentLang() {
  try {
    return (typeof window !== "undefined" && window.CLKN_I18N && window.CLKN_I18N.lang) || "en";
  } catch (_) {
    return "en";
  }
}

function isOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch (_) {
    return true;
  }
}

// A duration in whole seconds -> a short, mostly-static phrase. Kept out of one giant
// interpolated sentence so every fixed word still goes through t(); only the number itself
// (never translatable content) is concatenated in.
function formatWait(sec) {
  if (!(sec > 0)) return null;
  if (sec < 60) return tf("Try again in {n} seconds.", { n: sec });
  const mins = Math.ceil(sec / 60);
  if (mins < 60) return `${t("Try again in about")} ${mins} ${mins === 1 ? t("minute") : t("minutes")}.`;
  const hours = Math.ceil(sec / 3600);
  return `${t("Try again in about")} ${hours} ${hours === 1 ? t("hour") : t("hours")}.`;
}

// Maps a failed call to one small, stable shape so the bubble renderer never has to see a raw
// server error string or an exception message.
function classifyFailure({ offline, res, body }) {
  if (offline) {
    return { kind: "offline", text: t("Cluck needs a connection for this one. You're offline right now.") };
  }
  if (res && res.status === 429) {
    const retrySec = Number((body && (body.retryAfterSec || body.retryAfter)) || 0);
    // The server now SAYS which limiter fired, via windowSec (server.js's rateLimit) — anything
    // measured in hours is a daily cap, anything in seconds is the per-minute one. The old
    // heuristic stays only as a fallback for a server that predates that field (staging and
    // production deploy separately, so the app can meet either).
    const windowSec = Number((body && body.windowSec) || 0);
    const isDaily = windowSec > 0 ? windowSec >= 3600 : retrySec > 90;
    const wait = formatWait(retrySec);
    if (isDaily) {
      return {
        kind: "daily",
        text: t("You've hit today's free question limit.") + " " + (wait || t("It resets daily.")),
      };
    }
    return {
      kind: "rate",
      text: t("Slow down a little — too many questions at once.") + " " + (wait || t("Try again in a moment.")),
    };
  }
  // A 4xx that isn't the rate limiter is a refusal the CALLER caused — today that's the server's
  // own "Question too short" / "Question too long" validation (server.js ~15176), in the
  // server's own English regardless of `lang` (same caveat as the 429 branch above, and the same
  // reason this pane doesn't run it through t() — it isn't our dictionary's text to translate).
  // Showing that reason beats the generic outage text below, which tells someone to "try again in
  // a moment" — meaningless advice for a question that will be refused every time until they
  // change it. `detail`/`error` are plain server text rendered as a React text node, never HTML.
  if (res && res.status >= 400 && res.status < 500 && res.status !== 429) {
    const serverText = (body && (body.detail || body.error)) || null;
    // The fallback reuses Buy Special's already-translated "refused" wording verbatim (the exact
    // same key, already in all six dictionaries) rather than adding a new string for this pane
    // alone — see BuySpecial.jsx's own "refused" phase for the sibling usage.
    return { kind: "refused", text: serverText || t("That request wasn't something we could use.") };
  }
  return { kind: "unavailable", text: t("Cluck couldn't answer that one. Try again in a moment.") };
}

function Bubble({ turn }) {
  return (
    <div className="seeker-ask-turn">
      <div className="seeker-ask-bubble seeker-ask-bubble-user">{turn.question}</div>
      {turn.status === "thinking" ? (
        <div className="seeker-ask-bubble seeker-ask-bubble-cluck seeker-ask-bubble-thinking" role="status" aria-live="polite">
          <span className="seeker-ask-dot" /><span className="seeker-ask-dot" /><span className="seeker-ask-dot" />
        </div>
      ) : null}
      {turn.status === "ok" ? (
        <div className="seeker-ask-bubble seeker-ask-bubble-cluck">{turn.answer}</div>
      ) : null}
      {turn.status === "error" ? (
        <div className={"seeker-ask-bubble seeker-ask-bubble-error seeker-ask-bubble-error-" + turn.error.kind} role="alert">
          {turn.error.text}
        </div>
      ) : null}
    </div>
  );
}

export default function AskCluckPane() {
  useI18nReady();
  const [messages, setMessages] = React.useState([]); // { id, question, status: 'thinking'|'ok'|'error', answer?, error? }
  const [input, setInput] = React.useState("");
  const [online, setOnline] = React.useState(isOnline());
  const nextId = React.useRef(1);
  const threadRef = React.useRef(null);
  const abortRef = React.useRef(null);

  React.useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    if (typeof window !== "undefined") {
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      }
    };
  }, []);

  React.useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch (_) {} }, []);

  React.useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const send = React.useCallback((raw) => {
    const question = String(raw || "").trim();
    if (question.length < MIN_QUESTION_LEN) return;
    const q = question.length > MAX_QUESTION_LEN ? question.slice(0, MAX_QUESTION_LEN) : question;
    const id = nextId.current++;
    setInput("");

    if (!isOnline()) {
      setMessages((m) => [...m, { id, question: q, status: "error", error: classifyFailure({ offline: true }) }]);
      return;
    }

    setMessages((m) => [...m, { id, question: q, status: "thinking" }]);
    try { abortRef.current && abortRef.current.abort(); } catch (_) {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch("/api/ask-cluck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, lang: currentLang() }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (res.ok && body && body.success === true && typeof body.answer === "string" && body.answer) {
          setMessages((m) => m.map((t2) => (t2.id === id ? { ...t2, status: "ok", answer: body.answer } : t2)));
          return;
        }
        setMessages((m) => m.map((t2) => (t2.id === id ? { ...t2, status: "error", error: classifyFailure({ res, body }) } : t2)));
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return;
        setMessages((m) => m.map((t2) => (t2.id === id ? { ...t2, status: "error", error: classifyFailure({ offline: !isOnline() }) } : t2)));
      });
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    send(input);
  };

  const busy = messages.length > 0 && messages[messages.length - 1].status === "thinking";
  const canSend = !busy && online && input.trim().length >= MIN_QUESTION_LEN;

  return (
    <div className="seeker-ask">
      <div className="seeker-ask-topicon" aria-hidden="true">🐔</div>
      <h1 className="seeker-ask-title">{t("Ask Cluck")}</h1>

      {messages.length === 0 ? (
        <div className="seeker-ask-intro">
          <p>{t("Ask the AI tutor anything about crypto, in plain words.")}</p>
          <p className="seeker-ask-introsub">{t("Free, no wallet needed. He doesn't give financial advice — he teaches.")}</p>
          <div className="seeker-ask-starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="seeker-ask-starter"
                onClick={() => send(s)}
                disabled={!online}
              >
                {t(s)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="seeker-ask-thread" ref={threadRef}>
          {messages.map((turn) => <Bubble key={turn.id} turn={turn} />)}
        </div>
      )}

      {!online ? (
        <div className="seeker-ask-offline" role="status">
          {t("You're offline. Ask Cluck needs a connection — you'll be able to send as soon as you're back online.")}
        </div>
      ) : null}

      <form className="seeker-ask-composer" onSubmit={onSubmit}>
        <textarea
          className="seeker-ask-input"
          value={input}
          maxLength={MAX_QUESTION_LEN}
          rows={1}
          placeholder={t("Ask a question…")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={busy}
        />
        <button type="submit" className="seeker-ask-sendbtn" disabled={!canSend}>
          {t("Send")}
        </button>
      </form>
    </div>
  );
}
