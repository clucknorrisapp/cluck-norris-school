// A drawn liquidity droplet, used for the LP Lab tab in the education edition's bottom nav
// (edu.jsx's TABS) — liquidity is literally what the course teaches, so a droplet reads clearer
// than an abstract flask. Same drawn-icon posture as ShieldIcon: crisp on every platform, takes
// the surrounding text colour via `currentColor`.
import React from "react";

export default function DropletIcon({ size = "1em", className, style }) {
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
      <path
        d="M12 2.8c2.6 3.4 6 8 6 11.4a6 6 0 1 1-12 0c0-3.4 3.4-8 6-11.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.3 15.4a2.9 2.9 0 0 0 2.9 2.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
