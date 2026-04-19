export const tokens = {
  colors: {
    bg: "#0A0B0D",
    surface: "#111316",
    surface2: "#17191D",
    border: "#23262B",
    text: "#F2F3F5",
    textMuted: "#8A8F98",
    accent: "#5B8DEF",
    accentDim: "#3A5FA8",
    success: "#4ADE80",
    warn: "#F5A524",
    danger: "#F87171",
  },
  font: {
    sans: '"Inter", system-ui, sans-serif',
    display: '"Söhne", "Inter", sans-serif',
    mono: '"JetBrains Mono", ui-monospace',
  },
  radius: { sm: "6px", md: "10px", lg: "14px", xl: "20px" },
  motion: {
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    fast: "140ms",
    med: "280ms",
  },
} as const;

export type Tokens = typeof tokens;
