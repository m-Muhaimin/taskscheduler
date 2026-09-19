import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-faint": "var(--ink-faint)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        accent: "var(--accent)",
        "accent-deep": "var(--accent-deep)",
        field: "var(--field-border)",
        band: "var(--band-bg)",
        "band-ink": "var(--band-ink)",
        "band-muted": "var(--band-muted)",
        "band-accent": "var(--band-accent)",
        "band-rule": "var(--band-rule)",
        "accent-ink": "var(--accent-ink)",
        success: "var(--success)",
        "success-bg": "var(--success-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
      },
      fontFamily: {
        head: ["var(--font-head)", "IBM Plex Sans", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        DEFAULT: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
