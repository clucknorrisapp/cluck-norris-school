// A drawn calendar, used for the Daily tab in the education edition's bottom nav (edu.jsx's
// TABS) instead of the bare "📅" text-presentation emoji — same drawn-icon posture as
// ShieldIcon: crisp on every platform, takes the surrounding text colour via `currentColor`.
import React from "react";

export default function CalendarIcon({ size = "1em", className, style }) {
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
      <rect
        x="3.5" y="5" width="17" height="15" rx="2"
        fill="none" stroke="currentColor" strokeWidth="1.6"
      />
      <path d="M3.5 9.3h17" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.6 3.4v3.2M16.4 3.4v3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="6.8" y="12" width="2.8" height="2.8" rx="0.6" fill="currentColor" />
    </svg>
  );
}
