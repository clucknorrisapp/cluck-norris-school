// A drawn speech bubble, used for the Ask tab in the education edition's bottom nav (edu.jsx's
// TABS) instead of the bare "🐔" text-presentation emoji — a chicken reads too fiddly at nav-icon
// size (~20px); a speech bubble says "ask a question" plainly at any size. Same drawn-icon
// posture as ShieldIcon: crisp on every platform, takes the surrounding text colour via
// `currentColor`.
import React from "react";

export default function ChatIcon({ size = "1em", className, style }) {
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
        d="M3.5 6.2c0-1.3 1.1-2.4 2.4-2.4h12.2c1.3 0 2.4 1.1 2.4 2.4v7.4c0 1.3-1.1 2.4-2.4 2.4H9.4l-4 3.4v-3.4H5.9c-1.3 0-2.4-1.1-2.4-2.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7.6 8.6h8.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7.6 11.7h5.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
