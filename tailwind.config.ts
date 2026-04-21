import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // THEMES A-1 — all brand-level colors route through `--hz-*` CSS vars
      // defined in globals.css so a theme file can swap the entire palette
      // at runtime without rebuilding Tailwind. Default values (Horizon
      // dark) live in :root; overrides per theme live in `[data-theme]` blocks.
      colors: {
        bg: "var(--hz-bg)",
        surface: "var(--hz-surface)",
        surface2: "var(--hz-surface2)",
        border: "var(--hz-border)",
        "border-soft": "var(--hz-border-soft)",
        text: "var(--hz-text)",
        "text-muted": "var(--hz-text-muted)",
        "text-dim": "var(--hz-text-dim)",
        accent: "var(--hz-accent)",
        "accent-dim": "var(--hz-accent-dim)",
        "accent-2": "var(--hz-accent-2)",
        "accent-warm": "var(--hz-accent-warm)",
        success: "var(--hz-success)",
        warn: "var(--hz-warn)",
        danger: "var(--hz-danger)",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        display: ['"Söhne"', '"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
        "2xl": "28px",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        fast: "140ms",
        med: "280ms",
        slow: "480ms",
      },
      boxShadow: {
        glow: "0 0 40px rgba(91, 141, 239, 0.28)",
        "glow-2": "0 0 40px rgba(167, 139, 250, 0.24)",
        "glow-warm": "0 0 40px rgba(240, 179, 122, 0.22)",
        "glow-danger": "0 0 32px rgba(248, 113, 113, 0.22)",
        "inset-border":
          "inset 0 0 0 1px rgba(255, 255, 255, 0.04), 0 1px 0 rgba(0,0,0,0.3)",
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(60% 50% at 30% 0%, rgba(91, 141, 239, 0.18) 0%, rgba(91, 141, 239, 0) 70%), radial-gradient(50% 40% at 80% 10%, rgba(167, 139, 250, 0.10) 0%, rgba(167, 139, 250, 0) 80%)",
        "accent-sheen":
          "linear-gradient(135deg, #5B8DEF 0%, #A78BFA 100%)",
        "card-sheen":
          "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 100%)",
        noise:
          "radial-gradient(1px 1px at 25% 40%, rgba(255,255,255,0.04) 50%, transparent 50%), radial-gradient(1px 1px at 75% 60%, rgba(255,255,255,0.03) 50%, transparent 50%)",
      },
      keyframes: {
        "fade-rise": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "sheen-sweep": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" },
        },
        "accent-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(2%, 1%, 0)" },
        },
        // FINAL-7 — Theme switcher primer. The four dots on the Theme
        // button each run this keyframe with a staggered animation-delay
        // so at any moment they show four different theme tokens.
        // Using var(--hz-*) means the primer automatically re-paints
        // itself into whatever institutional palette is currently
        // active, which is exactly the thing the button is advertising.
        "theme-dot-cycle": {
          "0%, 100%": {
            backgroundColor: "var(--hz-accent)",
          },
          "25%": { backgroundColor: "var(--hz-accent-2)" },
          "50%": { backgroundColor: "var(--hz-warn)" },
          "75%": { backgroundColor: "var(--hz-success)" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 380ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 2.2s linear infinite",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        "sheen-sweep": "sheen-sweep 2.4s ease-in-out infinite",
        "accent-drift":
          "accent-drift 12s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "theme-dot-cycle":
          "theme-dot-cycle 12s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
