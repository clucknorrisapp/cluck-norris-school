// A drawn shield, used everywhere Wallet Checkup needs an icon (registry.js, the bottom nav, the
// pane headers) instead of the bare text-presentation "🛡" (U+1F6E1 with no emoji variation
// selector). On the real Seeker device that glyph fell back to a monochrome pixel-outline font
// render — the owner's own words: "the graphic for wallet checkup looks cheap." An inline SVG
// always renders the same crisp shape, on every platform, and takes the surrounding text colour
// (`currentColor`) so the bottom nav's active/inactive states and every pane's own text colour
// just work with zero extra CSS.
//
// `size` defaults to "1em" so it scales with whatever font-size the wrapping element already
// sets (the nav icon, the pane icon, the tool-card icon each use a different font-size today) —
// exactly the sizing behaviour the emoji it replaces had, so no caller needs a size prop.
import React from "react";

export default function ShieldIcon({ size = "1em", className, style }) {
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
        d="M12 2.4l7.2 2.7v5.4c0 5.1-3.1 8.9-7.2 10.9-4.1-2-7.2-5.8-7.2-10.9V5.1L12 2.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 12.1l2.3 2.3 4.5-4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
