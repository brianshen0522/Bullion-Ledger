/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // Visual branding is intentionally left unset per PRD §31 (unresolved
  // branding). The palette below is a neutral default; swap in a final brand
  // token set once locked.
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        paper: '#f8fafc',
        accent: '#0f766e',
        danger: '#b91c1c',
      },
    },
  },
  plugins: [],
};
