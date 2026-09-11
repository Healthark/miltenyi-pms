/* Tailwind Play-CDN configuration mirroring frontend/src/index.css (@theme block).
   Colors resolve to the same CSS variables the React app uses, so toggling
   <html class="dark"> swaps the palette exactly like the app does. */
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: "var(--brand)",
        "brand-light": "var(--brand-light)",
        "brand-accent": "var(--brand-accent)",
        accent: "var(--accent)",
        background: "var(--background)",
        surface: "var(--surface)",
        "text-main": "var(--text-main)",
        "text-muted": "var(--text-muted)",
        border: "var(--border)",
      },
      fontFamily: {
        display: ["Poppins", "sans-serif"],
        body: ['"DM Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
};
