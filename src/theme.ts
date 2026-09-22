import { s } from "./scale";

// Design tokens mirrored from the original WebView app (src/index.css, tailwind.config.js)
// so the native rebuild reads as the same product, not a re-skin.
export const colors = {
  // Pure black (was a bluish #090b11) - per explicit request, every screen background and every fade
  // into it (gradients that end in colors.bg) is now true black.
  bg: "#000000",
  cardBg: "#050505",
  cardBgAlt: "#000000",
  border: "#27272a",
  borderLight: "rgba(255,255,255,0.12)",
  textPrimary: "#ffffff",
  textSecondary: "#d4d4d8",
  textMuted: "#a1a1aa",
  textFaint: "#71717a",
  accentRed: "#ef4444",
  imdbYellow: "#F5C518",
  overlayDark: "rgba(0,0,0,0.85)",
};

export const font = {
  regular: "Cairo-Regular",
  semiBold: "Cairo-SemiBold",
  bold: "Cairo-Bold",
  extraBold: "Cairo-ExtraBold",
  black: "Cairo-Black",
};

export const spacing = {
  sidebarWidth: s(88),
  contentStart: s(94), // was 104 - the gap between the sidebar and page content read as too wide on some TVs
};

// Pill radius for every CTA-style button across the app (hero/details actions, settings
// options, control-bar buttons) - half of a typical button's own height, so it always reads
// as a full stadium/pill shape regardless of that button's own padding.
export const radius = {
  pill: 999,
};

// Retired. This was a shadowColor/shadowOpacity/shadowRadius "glow" meant to ring a focused
// element - already known to be trouble (see the removed `elevation` mitigation this comment
// used to describe, for the "distorted halo" it drew behind non-white buttons), and repeatedly
// reported since as a visible diagonal hatch/crosshatch artifact instead of a smooth glow on real
// device hardware, worst on elements that also turn solid white on focus (where the glow is
// redundant anyway). Rather than keep chasing which specific combination of fill/shape/GPU
// triggers it, every call site's `focused && focusShadow(Tight)` now just spreads an empty
// object - harmless everywhere it's still referenced, and guarantees the effect can't resurface
// anywhere it's added back to in the future. The focused-state color/border/scale changes at each
// call site (already the primary focus indicator everywhere) are what actually communicate focus
// now.
export const focusShadow = {};
export const focusShadowTight = {};

export const cardShadow = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 10,
  elevation: 6,
};
