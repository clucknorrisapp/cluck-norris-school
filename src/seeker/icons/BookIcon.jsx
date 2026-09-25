// A drawn open book, for the Library tab in the education edition's bottom nav (edu.jsx's TABS).
// Owner (2026-09-25): the Library earns a tab — "people won't go to the Solana room every day" —
// so it takes the Solana Room's slot, and the room keeps its card on the School home. Same
// drawn-icon posture as the other tab icons: crisp on every platform, takes the surrounding text
// colour via `currentColor`, never an emoji.
import React from "react";

export default function BookIcon({ size = "1em", className, style }) {
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
        d="M12 6.4C10.3 5 8.1 4.4 4.2 4.6c-.4 0-.7.3-.7.7v11.9c0 .4.3.7.7.7 3.8-.1 5.9.5 7.8 1.9 1.9-1.4 4-2 7.8-1.9.4 0 .7-.3.7-.7V5.3c0-.4-.3-.7-.7-.7-3.9-.2-6.1.4-7.8 1.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 6.4v12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
