// Tailwind v3's @tailwind directives resolve to plain, flat CSS at build time (its own
// internal @layer usage is a PostCSS-time-only organizational concept predating the real
// CSS Cascade Layers spec, not a native @layer at-rule shipped to the browser) - unlike
// v4, there is nothing here that needs a compatibility polyfill for older WebView
// engines. autoprefixer still earns its keep for vendor-prefixed properties this app
// actually uses (backdrop-filter, etc.) - see .browserslistrc for the target floor.
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default {
  plugins: [tailwindcss, autoprefixer],
};
