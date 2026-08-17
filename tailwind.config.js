/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        disp: ['Tajawal', 'Cairo', 'Outfit', 'sans-serif'],
        display: ['Tajawal', 'Cairo', 'Outfit', 'sans-serif'],
        number: ['Space Grotesk', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
