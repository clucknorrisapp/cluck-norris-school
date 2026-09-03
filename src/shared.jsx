// Shared primitives extracted from App.jsx so lazy-loaded sections can reuse them
// without importing the whole app (which would defeat code-splitting). Keep this
// module dependency-light: constants + small presentational components only.
import { useState, useEffect, useRef } from "react";

export const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
export const JUPITER_REFERRAL = "A4fSbCMAya9rLWY4incNYaVfhYA9mpCownbFEW3dUZAg";
export const LOGO_B64 = "/cluck-norris-logo.jpg";
const _DESK = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;
export const COL  = _DESK ? 900 : 520;
export const COLW = _DESK ? 920 : 540;
export const READ = _DESK ? 640 : 520;
// LP lesson count for progress stats without eager-loading the lazy LP Lab chunk.
// Keep in sync with LP_LESSONS in src/sections/LPLab.jsx.
export const LP_LESSONS_COUNT = 14;

// RootCrak — our third-party security-scan partner. ONE source of truth for the grade/score,
// the links, and the handle, so the footer badge and the /rootcrak page can never disagree.
// The grade/score are a STATIC snapshot: if a rescan moves them, update HERE (and the vanilla
// badge in public/home.html, which can't import this) — the verifyUrl always shows live truth.
export const ROOTCRAK = {
  grade: "A+",
  score: 99,
  verifyUrl: "https://rootcrak.com/verify/clucknorris.app",
  referral: "https://rootcrak.com/?ref=clucknorris",
  handle: "@ro0TCr4k",
  handleUrl: "https://x.com/ro0TCr4k",
};

// The green "A+ · SECURITY · ROOTCRAK" pill, rendered from ROOTCRAK so it can't drift out of
// sync with the number. Links to the live verify page. Reused by the app footer and /rootcrak.
export function RootCrakBadge({ style }) {
  return (
    <a href={ROOTCRAK.verifyUrl} target="_blank" rel="noopener noreferrer"
       title={`Security verified by RootCrak — ${ROOTCRAK.grade} · ${ROOTCRAK.score}/100`}
       style={{display:"inline-flex",alignItems:"center",gap:8,background:"#0f0f0f",border:"1px solid #1a1a1a",borderRadius:6,padding:"5px 11px",textDecoration:"none",...style}}>
      <span style={{fontFamily:"system-ui,-apple-system,sans-serif",fontSize:15,fontWeight:900,color:"#22c55e",lineHeight:1}}>{ROOTCRAK.grade}</span>
      <span style={{width:1,height:14,background:"#222"}}/>
      <span style={{fontFamily:"system-ui,-apple-system,sans-serif",fontSize:10,fontWeight:600,color:"#888",letterSpacing:0.5}}>SECURITY</span>
      <span style={{fontFamily:"system-ui,-apple-system,sans-serif",fontSize:10,fontWeight:700,letterSpacing:0.5}}><span style={{color:"#fff"}}>ROOT</span><span style={{color:"#22c55e"}}>CRAK</span></span>
    </a>
  );
}

export function MintAddress({ compact }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(CLKN_MINT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  if (compact) return (
    <div onClick={copy} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>
      <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>CA:</span>
      <span style={{fontFamily:"monospace",fontSize:9,color:"#9CA3AF"}}>{CLKN_MINT.slice(0,8)}...{CLKN_MINT.slice(-6)}</span>
      <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:copied?"#10B981":"#FF7A18",letterSpacing:1}}>{copied?"✓ COPIED":"COPY"}</span>
    </div>
  );
  return (
    <div onClick={copy} style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:10,padding:"10px 14px",cursor:"pointer",marginTop:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2}}>CONTRACT ADDRESS</span>
        <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:copied?"#10B981":"#FF7A18",letterSpacing:1}}>{copied?"✓ COPIED":"TAP TO COPY"}</span>
      </div>
      <div style={{fontFamily:"monospace",fontSize:12.5,color:"#D1D5DB",wordBreak:"break-all",lineHeight:1.6}}>{CLKN_MINT}</div>
    </div>
  );
}

export function JupiterSwapButton({ label, style }) {
  const inited = useRef(false);

  function openSwap() {
    if (!window.Jupiter) return;            // plugin script not loaded yet
    if (!inited.current) {
      // Jupiter Plugin (plugin-v1.js): init ONCE — re-initing on every open broke it.
      // referralAccount/referralFee live INSIDE formProps (not top-level). Output locked
      // to CLKN so it's a dedicated "buy CLKN" widget. swapMode "ExactIn" = user enters
      // the SOL/USDC amount to spend.
      window.Jupiter.init({
        displayMode: "modal",
        formProps: {
          initialOutputMint: CLKN_MINT,
          fixedOutputMint: true,
          swapMode: "ExactIn",
          // Referral fee OFF until the referral account is initialized under the Plugin's
          // referral project (DkiqsTrw1u1bYFumumC7sCG2S8K25qc2v). Frictionless buy meanwhile.
        },
        defaultExplorer: "Solscan",
      });
      inited.current = true;
    }
    window.Jupiter.resume();                // init mounts; resume opens (and re-opens later)
  }

  return (
    <button onClick={openSwap} style={style}>
      {label}
    </button>
  );
}


export const CLKN_TRADE_LINK = "https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007";
export const JUPITER_TRADE_LINK = "https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
export const TELEGRAM_LINK = "https://t.me/FireChicken007";

// The paid "unlock 20 more questions" door — send 500.xyz CLKN by hand, poll the
// chain for it — was retired 2026-07-30 (owner's call: the send-and-wait flow
// complicated every gated tool for no real uptake). Ask Cluck keeps its free daily
// allowance; when it runs out you simply come back tomorrow. AutoVerify,
// CluckUnlock and generateUnlockAmount lived here and went with it.


const DAILY_LIMIT = 10;
const STORAGE_KEY = "cluck_questions";

function getQuestionsToday() {
  const today = new Date().toDateString();
  const fresh = { count: 0, limit: DAILY_LIMIT, date: today };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fresh;
    const data = JSON.parse(stored);
    if (!data || typeof data !== "object" || Array.isArray(data)) return fresh;
    if (data.date !== today) return fresh;
    const count = Number(data.count);
    const limit = Number(data.limit);
    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      limit: Number.isFinite(limit) && limit > 0 ? limit : DAILY_LIMIT,
      date: today
    };
  } catch(e) { return fresh; }
}

function incrementQuestions() {
  const data = getQuestionsToday();
  const updated = { count: data.count + 1, limit: data.limit, date: new Date().toDateString() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch(e) {}
  return updated;
}

export function AskCluck({ context, compact }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [questionsLeft, setQuestionsLeft] = useState(() => {
    const today = getQuestionsToday();
    return today.limit - today.count;
  });
  const [expanded, setExpanded] = useState(false);

  async function askQuestion() {
    if (!question.trim() || loading || questionsLeft <= 0) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask-cluck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context, lang: (function(){ try { if (window.CLKN_I18N && window.CLKN_I18N.lang) return window.CLKN_I18N.lang; var s = localStorage.getItem("clkn_lang"); if (s) return s; } catch(e){} var _l=(navigator.language||"").toLowerCase().slice(0,2); return ["zh","es","hi","it","pt","vi"].indexOf(_l)!==-1?_l:"en"; })() })
      });
      const data = await res.json();
      if (data.success) {
        setAnswer(data.answer);
        const updated = incrementQuestions();
        setQuestionsLeft(updated.limit - updated.count);
      } else {
        setAnswer("Cluck Norris is unavailable right now. Hit the books instead.");
      }
    } catch(e) {
      setAnswer("Something went wrong in the schoolyard. Try again.");
    }
    setLoading(false);
  }

  if (compact && !expanded && questionsLeft > 0) return (
    <button onClick={()=>setExpanded(true)} style={{
      display:"flex",alignItems:"center",gap:8,background:"rgba(255,122,24,0.1)",
      border:"1px solid rgba(255,122,24,0.3)",borderRadius:10,padding:"10px 14px",
      width:"100%",cursor:"pointer",marginTop:12
    }}>
      <img src={LOGO_B64} alt="CN" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}}/>
      <div style={{textAlign:"left",flex:1}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#FF7A18",letterSpacing:1}}>ASK CLUCK NORRIS</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#9CA3AF",letterSpacing:1}}>Need clarification? Ask the professor. ({questionsLeft} left today)</div>
      </div>
      <span style={{color:"#FF7A18",fontSize:15.5}}>→</span>
    </button>
  );

  return (
    <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:16,marginTop:12,overflow:"hidden",minWidth:0,maxWidth:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <img src={LOGO_B64} alt="CN" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #FF7A18"}}/>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#FF7A18",letterSpacing:1}}>ASK CLUCK NORRIS</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>
            {questionsLeft > 0 ? `${questionsLeft} questions remaining today` : "Daily limit reached — come back tomorrow"}
          </div>
        </div>
        {compact && <button onClick={()=>setExpanded(false)} aria-label="Close" style={{marginLeft:"auto",background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:16}}>✕</button>}
      </div>

      {questionsLeft > 0 ? (
        <>
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <div style={{flex:1,position:"relative"}}>
              <input
                value={question}
                onChange={e=>setQuestion(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&askQuestion()}
                placeholder="Ask anything about crypto, DeFi, or this lesson..."
                style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:8,padding:question?"10px 34px 10px 12px":"10px 12px",color:"#F9FAFB",fontFamily:"'Anton',sans-serif",fontSize:15,outline:"none",boxSizing:"border-box"}}
              />
              {question && (
                <button
                  onClick={()=>setQuestion("")}
                  aria-label="Clear question"
                  title="Clear"
                  style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"rgba(255,122,24,0.18)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",color:"#9CA3AF",cursor:"pointer",fontSize:13,fontFamily:"system-ui,sans-serif",padding:0,lineHeight:1}}
                >✕</button>
              )}
            </div>
            <button onClick={askQuestion} disabled={!question.trim()||loading} style={{background:question.trim()&&!loading?"#FF7A18":"rgba(255,122,24,0.07)",border:"none",borderRadius:8,padding:"9px 14px",fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:question.trim()&&!loading?"#fff":"#4B5563",cursor:question.trim()&&!loading?"pointer":"default",letterSpacing:1,whiteSpace:"nowrap"}}>
              {loading ? "..." : "ASK →"}
            </button>
          </div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1,marginBottom:answer?10:0}}>
            Don't abuse Cluck Norris's generosity — it's not very common. 🐔
          </div>
        </>
      ) : (
        <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:16,marginTop:8}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#FFB627",letterSpacing:1.5,marginBottom:6}}>THAT'S THE LOT FOR TODAY</div>
          <p style={{margin:0,fontSize:14.5,color:"#EAD8C8",lineHeight:1.7}}>
            Cluck Norris has answered his {DAILY_LIMIT} questions for the day. Your allowance
            resets at midnight UTC — come back then and he'll pick up where you left off.
          </p>
          <p style={{margin:"10px 0 0",fontSize:13.5,color:"#C9A892",lineHeight:1.65}}>
            In the meantime the whole curriculum, the Library and every free tool are still
            open — nothing here is behind the question limit.
          </p>
        </div>
      )}

      {answer && (
        <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:10,padding:"12px 14px",overflow:"hidden",minWidth:0}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-start",minWidth:0}}>
            <span style={{fontSize:16,flexShrink:0}}>🐔</span>
            <p style={{margin:0,fontSize:15,color:"#D1D5DB",lineHeight:1.8,fontFamily:"inherit",wordBreak:"break-word",overflowWrap:"break-word",whiteSpace:"pre-wrap"}}>
            {answer.replace(/\*\*([^*]+)\*\*/g, (_,t)=>t).replace(/\*([^*]+)\*/g, (_,t)=>t)}
          </p>
          </div>
          <button onClick={()=>{setAnswer(null);setQuestion("");}} style={{marginTop:8,background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:1,cursor:"pointer"}}>
            ASK ANOTHER →
          </button>
        </div>
      )}
    </div>
  );
}
