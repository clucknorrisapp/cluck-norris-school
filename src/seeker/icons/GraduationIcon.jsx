// A drawn graduation cap, used for the School tab in the education edition's bottom nav
// (edu.jsx's TABS) instead of the bare "🎓" text-presentation emoji — same reasoning as
// ShieldIcon: a crisp, consistent shape on every platform, no font-fallback risk, and it takes
// the surrounding text colour (`currentColor`) so the nav's active/inactive states just work.
import React from "react";

export default function GraduationIcon({ size = "1em", className, style }) {
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
        d="M12 4.2L21.5 8.6 12 13 2.5 8.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.6v4.3c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7v-4.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21.5 8.6v6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
