// Tailwind CSS v4 emits its utilities wrapped in native CSS cascade layers
// (@layer base/components/utilities/...), which it relies on for its cascade
// ordering instead of source-order tricks. That's a Chrome 99+ feature - browsers
// older than that don't recognize @layer as a known at-rule, and per the CSS
// error-recovery spec an unrecognized at-rule's entire block gets discarded, not
// unwrapped. Since v4 wraps essentially all of its generated CSS this way, the
// practical effect on an old WebView was the *entire* stylesheet being dropped:
// raw unstyled HTML (oversized <img> tags, no grid/flex layout at all).
//
// postcss-preset-env's cascade-layers feature flattens @layer blocks into plain
// rules, reordered to preserve the same effective cascade priority without relying
// on native layer support - see .browserslistrc for the target floor.
import postcssPresetEnv from 'postcss-preset-env';

export default {
  plugins: [
    // Default stage (2) picks up broader compatibility transforms "for free" (oklch
    // among them). cascade-layers is forced on explicitly since it's not enabled by
    // the stage-2 default and it's the one that actually broke layout on old WebView -
    // shouldn't be left to a stage default that might change between versions. (Tailwind
    // v4's other modern-CSS usage, e.g. color-mix() for opacity utilities, is already
    // self-guarded with @supports + a plain-color fallback, so it degrades safely
    // without needing a polyfill here.)
    postcssPresetEnv({
      features: {
        'cascade-layers': true,
        // The .browserslistrc target (needed for cascade-layers above) includes
        // browsers old enough to lack native CSS logical properties, which made
        // postcss-preset-env auto-enable this feature too, even though it was never
        // asked for. Its default conversion collapses inset-inline-start/
        // padding-inline-start/etc. to a *fixed* physical left or right at build time -
        // it has no way to know this app flips dir per-language at runtime - so every
        // rtl-language screen using ps-*/start-* utilities (there are ~9 of them, all
        // of the app's main content wrappers, all reserving space for the sidebar)
        // silently got the LTR-only side, in both dev and production builds. Force it
        // off so Tailwind's native inset-inline-start/padding-inline-start output
        // reaches the browser as-is, which resolves correctly per-direction on its own
        // (logical properties are a much older, better-supported feature than cascade
        // layers - not something this app's actual old-WebView target needs help with).
        'logical-properties-and-values': false,
      },
    }),
  ],
};
