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

export function MintAddress({ compact }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(CLKN_MINT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  if (compact) return (
    <div onClick={copy} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>CA:</span>
      <span style={{fontFamily:"monospace",fontSize:9,color:"#9CA3AF"}}>{CLKN_MINT.slice(0,8)}...{CLKN_MINT.slice(-6)}</span>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:copied?"#10B981":"#D97706",letterSpacing:1}}>{copied?"✓ COPIED":"COPY"}</span>
    </div>
  );
  return (
    <div onClick={copy} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 14px",cursor:"pointer",marginTop:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2}}>CONTRACT ADDRESS</span>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:copied?"#10B981":"#D97706",letterSpacing:1}}>{copied?"✓ COPIED":"TAP TO COPY"}</span>
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

