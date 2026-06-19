// Shared primitives extracted from App.jsx so lazy-loaded sections can reuse them
// without importing the whole app (which would defeat code-splitting). Keep this
// module dependency-light: constants + small presentational components only.
import { useState, useEffect } from "react";

export const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
export const JUPITER_REFERRAL = "A4fSbCMAya9rLWY4incNYaVfhYA9mpCownbFEW3dUZAg";
export const LOGO_B64 = "/cluck-norris-logo.jpg";
const _DESK = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;
export const COL  = _DESK ? 900 : 520;
export const COLW = _DESK ? 920 : 540;
export const READ = _DESK ? 640 : 520;
// LP lesson count for progress stats without eager-loading the lazy LP Lab chunk.
// Keep in sync with LP_LESSONS in src/sections/LPLab.jsx.
export const LP_LESSONS_COUNT = 12;

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
      <div style={{fontFamily:"monospace",fontSize:10,color:"#D1D5DB",wordBreak:"break-all",lineHeight:1.6}}>{CLKN_MINT}</div>
    </div>
  );
}

export function JupiterSwapButton({ label, style }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && window.Jupiter) {
      window.Jupiter.init({
        displayMode: "modal",
        formProps: {
          initialOutputMint: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS",
          swapMode: "ExactInOrOut",
        },
        referralAccount: JUPITER_REFERRAL,
        referralFee: 10, // 0.1% in basis points * 100
        defaultExplorer: "Solscan",
      });
      window.Jupiter.resume();
      setOpen(false);
    }
  }, [open]);

  return (
    <button
      onClick={() => setOpen(true)}
      style={style}
    >
      {label}
    </button>
  );
}


export const CLKN_TRADE_LINK = "https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007";
export const JUPITER_TRADE_LINK = "https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
export const TELEGRAM_LINK = "https://t.me/FireChicken007";

function AutoVerify({ unlockAmount, onUnlock, onBack }) {
  const [status, setStatus] = useState("watching"); // watching | found | failed
  const [attempts, setAttempts] = useState(0);
  const [dots, setDots] = useState(".");
  const [grantedQ, setGrantedQ] = useState(20);
  const maxAttempts = 40; // 40 × 3s = 2 minutes

  // Animate dots
  useEffect(() => {
    if (status !== "watching") return;
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? "." : d + ".");
    }, 500);
    return () => clearInterval(interval);
  }, [status]);

  // Auto poll every 3 seconds
  useEffect(() => {
    if (status !== "watching") return;
    if (attempts >= maxAttempts) {
      setStatus("failed");
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/verify-clkn-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unlockAmount })
        });
        const data = await res.json();
        if (data.success) {
          // Grant questions. Guard every storage op — the user has already paid CLKN at this
          // point, so a corrupt key or a quota error must not block the unlock.
          const today = new Date().toDateString();
          let current = {};
          try {
            const parsed = JSON.parse(localStorage.getItem("cluck_questions") || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
          } catch(e) {}
          const prevLimit = (current.date === today) ? Number(current.limit) : NaN;
          const currentLimit = Number.isFinite(prevLimit) && prevLimit > 0 ? prevLimit : DAILY_LIMIT;
          const newLimit = currentLimit + data.questionsGranted;
          const prevCount = Number(current.count);
          try {
            localStorage.setItem("cluck_questions", JSON.stringify({
              count: Number.isFinite(prevCount) && prevCount > 0 ? prevCount : 0,
              limit: newLimit,
              date: today
            }));
          } catch(e) {}
          try { localStorage.removeItem("cluck_unlock_amount"); } catch(e) {}
          setGrantedQ(data.questionsGranted);
          setStatus("found");
          setTimeout(() => onUnlock(data.questionsGranted), 99999999);
        } else {
          setAttempts(a => a + 1);
        }
      } catch(e) {
        setAttempts(a => a + 1);
      }
    };

    const timer = setTimeout(poll, attempts === 0 ? 2000 : 3000);
    return () => clearTimeout(timer);
  }, [attempts, status]);

  if (status === "found") return (
    <div style={{textAlign:"center",padding:"28px 0"}}>
      <div style={{fontSize:64,marginBottom:16}}>🎉</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:20,fontWeight:900,color:"#10B981",letterSpacing:3,marginBottom:12}}>PAYMENT VERIFIED!</div>
      <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:12,padding:"14px 20px",marginBottom:12}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:"#FFB627",marginBottom:4}}>+20 QUESTIONS</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12,color:"#D1D5DB",letterSpacing:1}}>UNLOCKED AND READY</div>
      </div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:12,color:"#9CA3AF",lineHeight:1.7,marginBottom:16}}>
        Cluck Norris is impressed. Don't waste them. 🐔
      </div>
      <button onClick={()=>onUnlock(grantedQ)} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
        ASK NEXT QUESTION →
      </button>
    </div>
  );

  if (status === "failed") return (
    <div style={{textAlign:"center",padding:"16px 0"}}>
      <div style={{fontSize:32,marginBottom:10}}>⏱️</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#EF4444",letterSpacing:1,marginBottom:8}}>PAYMENT NOT FOUND</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.7}}>
        Could not find your {unlockAmount.toFixed(3)} CLKN payment after 2 minutes. Make sure you sent the exact amount to the correct wallet.
      </p>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onBack} style={{flex:1,background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:8,padding:"10px",fontFamily:"'Anton',sans-serif",fontSize:11,color:"#6B7280",cursor:"pointer"}}>← TRY AGAIN</button>
        <button onClick={()=>window.open(TELEGRAM_LINK,"_blank")} style={{flex:1,background:"rgba(255,122,24,0.15)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:8,padding:"10px",fontFamily:"'Anton',sans-serif",fontSize:11,color:"#FF7A18",cursor:"pointer"}}>📱 GET HELP</button>
      </div>
    </div>
  );

  return (
    <div style={{textAlign:"center",padding:"16px 0"}}>
      <div style={{fontSize:36,marginBottom:12}}>🔍</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#FF7A18",letterSpacing:2,marginBottom:8}}>
        WATCHING FOR YOUR PAYMENT{dots}
      </div>
      <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>LOOKING FOR EXACTLY</div>
        <div style={{fontFamily:"monospace",fontSize:24,color:"#FFB627",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</div>
      </div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
        Checking every 3 seconds{dots} usually takes less than 15 seconds after your transaction confirms.
      </p>
      <div style={{height:4,background:"rgba(255,122,24,0.18)",borderRadius:2,marginBottom:12}}>
        <div style={{height:"100%",width:`${(attempts/maxAttempts)*100}%`,background:"linear-gradient(90deg,#FF7A18,#EF4444)",borderRadius:2,transition:"width 0.3s"}}/>
      </div>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:1,cursor:"pointer"}}>← BACK</button>
    </div>
  );
}

// ── CLKN UNLOCK COMPONENT ──
// Build a "{baseCost}.XXX" amount where the integer floor always equals the tool's price
// (server-side anti-tampering check) and the 3-decimal portion is the per-session
// uniqueness token used to match the on-chain tx to this exact unlock request.
// 1000 decimal slots gives ~96% all-unique probability with 10 concurrent unlocks
// (birthday-problem math) — effectively no collisions at hackathon scale.
function generateUnlockAmount(baseCost = 500) {
  const decimal = Math.floor(Math.random() * 1000); // 0-999
  const padded = String(decimal).padStart(3, "0");
  return parseFloat(`${baseCost}.${padded}`);
}

function CluckUnlock({ onUnlock }) {
  const [unlockAmount] = useState(() => {
    try {
      const stored = localStorage.getItem("cluck_unlock_amount");
      if (stored) {
        const n = parseFloat(stored);
        // Reject stale values from before the floor-check fix (whole part wandered 475-525).
        // A stored amount whose floor isn't 500 will be rejected by the server every time,
        // so regenerate to get the user unstuck.
        if (Number.isFinite(n) && n > 0 && Math.floor(n) === 500) return n;
      }
    } catch(e) {}
    const amount = generateUnlockAmount();
    try { localStorage.setItem("cluck_unlock_amount", amount.toString()); } catch(e) {}
    return amount;
  });
  const [step, setStep] = useState(1);
  const [walletCopied, setWalletCopied] = useState(false);
  const [amountCopied, setAmountCopied] = useState(false);



  return (
    <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:16,marginTop:8}}>
      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:28,marginBottom:6}}>🪙</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:14,fontWeight:700,color:"#FF7A18",letterSpacing:2,marginBottom:4}}>DAILY LIMIT REACHED</div>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#9CA3AF",margin:0,lineHeight:1.7}}>
          Cluck Norris has answered enough questions today. Send <span style={{color:"#FFB627",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</span> to unlock <span style={{color:"#FFB627",fontWeight:700}}>20 more questions</span>. No memo needed — the exact amount is your key.
        </p>
      </div>

      {/* Step indicator */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[1,2,3].map(s=>(
          <div key={s} style={{flex:1,height:3,borderRadius:2,background:step>=s?"#FF7A18":"rgba(255,122,24,0.2)"}}/>
        ))}
      </div>

      {step===1 && (
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:10,color:"#FF7A18",letterSpacing:2,marginBottom:8}}>STEP 1 — YOUR EXACT SEND AMOUNT</div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"14px",marginBottom:10,textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:1,marginBottom:4}}>SEND EXACTLY</div>
            <div style={{fontFamily:"monospace",fontSize:28,color:"#FFB627",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:4}}>THIS EXACT AMOUNT VERIFIES YOUR PAYMENT</div>
          </div>
          <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
            The specific decimal amount is how we identify your payment — no memo needed. Send the exact amount shown above.
          </p>
          <button onClick={()=>setStep(2)} style={{width:"100%",background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:8,padding:"11px",fontFamily:"'Anton',sans-serif",fontSize:12,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
            GOT IT — NEXT →
          </button>
        </div>
      )}

      {step===2 && (
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:10,color:"#FF7A18",letterSpacing:2,marginBottom:8}}>STEP 2 — SEND {unlockAmount.toFixed(3)} CLKN</div>
          {/* Clickable wallet address */}
          <div onClick={()=>{navigator.clipboard?.writeText("7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H");setWalletCopied(true);setTimeout(()=>setWalletCopied(false),2000);}} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:10,cursor:"pointer",border:`1px solid ${walletCopied?"rgba(16,185,129,0.5)":"rgba(255,122,24,0.18)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>SEND TO: (TAP TO COPY)</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:walletCopied?"#10B981":"#FF7A18",letterSpacing:1}}>{walletCopied?"✓ COPIED!":"📋 COPY"}</div>
            </div>
            <div style={{fontFamily:"monospace",fontSize:10,color:"#F9FAFB",wordBreak:"break-all",lineHeight:1.5}}>7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H</div>
          </div>
          {/* Clickable amount */}
          <div onClick={()=>{navigator.clipboard?.writeText(unlockAmount.toFixed(3));setAmountCopied(true);setTimeout(()=>setAmountCopied(false),2000);}} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:10,cursor:"pointer",border:`1px solid ${amountCopied?"rgba(16,185,129,0.5)":"rgba(255,122,24,0.3)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>EXACT AMOUNT: (TAP TO COPY)</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:amountCopied?"#10B981":"#FF7A18",letterSpacing:1}}>{amountCopied?"✓ COPIED!":"📋 COPY"}</div>
            </div>
            <div style={{fontFamily:"monospace",fontSize:20,color:"#FFB627",fontWeight:700,letterSpacing:2}}>{unlockAmount.toFixed(3)} CLKN</div>
          </div>
          <div style={{background:"rgba(255,122,24,0.06)",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:6}}>HOW TO SEND:</div>
            {["Open the wallet holding your CLKN", "Select CLKN token", "Tap Send", `Enter amount: ${unlockAmount.toFixed(3)}`, "Paste the wallet address above", "Confirm and send"].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}>
                <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",minWidth:14}}>{i+1}.</span>
                <span style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#D1D5DB"}}>{s}</span>
              </div>
            ))}
          </div>
          {/* Don't hold CLKN yet */}
          <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",letterSpacing:1,marginBottom:6}}>DON'T HOLD CLKN YET? GET SOME HERE:</div>
            <div style={{display:"flex",gap:8}}>
              <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"rgba(255,122,24,0.15)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:6,padding:"7px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:10,color:"#FF7A18",letterSpacing:1,textAlign:"center"}}>🔥 BAGS.FM</a>
              <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:6,padding:"7px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:10,color:"#4ADE80",letterSpacing:1,textAlign:"center"}}>⚡ JUPITER</a>
            </div>
          </div>
          <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
            Need help? Come find us on Telegram — the flock will sort you out. 🐔
          </p>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setStep(1)} style={{flex:1,background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:8,padding:"10px",fontFamily:"'Anton',sans-serif",fontSize:11,color:"#6B7280",cursor:"pointer"}}>← BACK</button>
            <button onClick={()=>setStep(3)} style={{flex:2,background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:8,padding:"10px",fontFamily:"'Anton',sans-serif",fontSize:11,fontWeight:700,color:"#fff",letterSpacing:1,cursor:"pointer"}}>SENT IT →</button>
          </div>
        </div>
      )}

      {step===3 && (
        <AutoVerify
          unlockAmount={unlockAmount}
          onUnlock={onUnlock}
          onBack={()=>setStep(2)}
        />
      )}
    </div>
  );
}

// ── ASK CLUCK NORRIS COMPONENT ──
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
        body: JSON.stringify({ question, context })
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
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:11,fontWeight:700,color:"#FF7A18",letterSpacing:1}}>ASK CLUCK NORRIS</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12,color:"#9CA3AF",letterSpacing:1}}>Need clarification? Ask the professor. ({questionsLeft} left today)</div>
      </div>
      <span style={{color:"#FF7A18",fontSize:14}}>→</span>
    </button>
  );

  return (
    <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:16,marginTop:12,overflow:"hidden",minWidth:0,maxWidth:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <img src={LOGO_B64} alt="CN" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #FF7A18"}}/>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#FF7A18",letterSpacing:1}}>ASK CLUCK NORRIS</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>
            {questionsLeft > 0 ? `${questionsLeft} questions remaining today` : "Daily limit reached — come back tomorrow"}
          </div>
        </div>
        {compact && <button onClick={()=>setExpanded(false)} style={{marginLeft:"auto",background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:16}}>✕</button>}
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
                  style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"rgba(255,122,24,0.18)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",color:"#9CA3AF",cursor:"pointer",fontSize:11,fontFamily:"system-ui,sans-serif",padding:0,lineHeight:1}}
                >✕</button>
              )}
            </div>
            <button onClick={askQuestion} disabled={!question.trim()||loading} style={{background:question.trim()&&!loading?"linear-gradient(135deg,#FF7A18,#EF4444)":"rgba(255,122,24,0.07)",border:"none",borderRadius:8,padding:"9px 14px",fontFamily:"'Anton',sans-serif",fontSize:11,fontWeight:700,color:question.trim()&&!loading?"#fff":"#4B5563",cursor:question.trim()&&!loading?"pointer":"default",letterSpacing:1,whiteSpace:"nowrap"}}>
              {loading ? "..." : "ASK →"}
            </button>
          </div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1,marginBottom:answer?10:0}}>
            Don't abuse Cluck Norris's generosity — it's not very common. 🐔
          </div>
        </>
      ) : (
        <CluckUnlock onUnlock={(q)=>{setQuestionsLeft(prev => prev + q);}} />
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
