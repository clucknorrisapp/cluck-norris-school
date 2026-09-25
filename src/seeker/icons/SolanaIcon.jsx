// A drawn mark for the Solana Room tab in the education edition's bottom nav (edu.jsx's TABS) —
// three offset bars, reminiscent of Solana's own trademarked three-bar logo in spirit (this is
// the Solana Room, a Solana-specific school section) without reproducing it: plain flat bars, one
// stroke colour (`currentColor`, no gradient), evenly spaced rather than skewed/overlapping. Same
// drawn-icon posture as ShieldIcon: crisp on every platform, takes the surrounding text colour.
import React from "react";

export default function SolanaIcon({ size = "1em", className, style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="5.5" width="17" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="10.7" width="12" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="15.9" width="17" height="2.6" rx="1.3" fill="currentColor" />
    </svg>
  );
}
