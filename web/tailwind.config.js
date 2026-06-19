/** @type {import('tailwindcss').Config} */
export default {
  // Scan source so utility classes used in components are generated.
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    // The app ships a hand-written CSS design system (styles.css). Disabling
    // Tailwind's Preflight keeps its global reset from clobbering those styles.
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
