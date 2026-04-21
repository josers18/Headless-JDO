/**
 * lib/themes/registry.ts — the canonical list of all 42 Horizon themes.
 *
 * Each theme's CSS lives in `app/themes.css` as a `[data-theme="<id>"]`
 * block that overrides the `--hz-*` custom properties set in
 * `app/globals.css`. This file is the TypeScript mirror of that catalog,
 * used by:
 *   - the Theme Switcher UI (A-3)
 *   - the Institution Demo Mode (B-1)
 *   - analytics / telemetry (which theme the banker picks)
 *
 * Contract: every entry here MUST have a matching CSS block. If you add
 * a theme, add both.
 */

export type ThemeFamily =
  | "original"
  | "elegant"
  | "greens_oranges"
  | "blues_greys"
  | "midtones"
  | "sf_light"
  | "wealth"
  | "traditional";

export type ThemeMode = "dark" | "light";

export interface ThemeMeta {
  id: string;
  displayName: string;
  family: ThemeFamily;
  mode: ThemeMode;
  institution?: string;
  description: string;
  /** Small palette chips for the theme switcher preview tile. */
  preview: {
    bg: string;
    surface: string;
    accent: string;
  };
}

export const THEMES: ThemeMeta[] = [
  // -------------------------------------------------------------------
  // Original (4)
  // -------------------------------------------------------------------
  {
    id: "horizon-dark",
    displayName: "Horizon Dark",
    family: "original",
    mode: "dark",
    description: "The default Horizon. Warm near-black with electric blue accent.",
    preview: { bg: "#0a0b0d", surface: "#111316", accent: "#5b8def" },
  },
  {
    id: "obsidian",
    displayName: "Obsidian",
    family: "original",
    mode: "dark",
    description: "Deep warm-black with burnished gold accent.",
    preview: { bg: "#0c0a0f", surface: "#110e09", accent: "#b8956a" },
  },
  {
    id: "midnight",
    displayName: "Midnight",
    family: "original",
    mode: "dark",
    description: "Cool navy-black with luminous blue accent.",
    preview: { bg: "#0a0d18", surface: "#0e1224", accent: "#6ea8ff" },
  },
  {
    id: "graphite",
    displayName: "Graphite",
    family: "original",
    mode: "dark",
    description: "Neutral graphite with soft violet accent.",
    preview: { bg: "#121214", surface: "#1a1a1d", accent: "#a08cff" },
  },
  {
    id: "ivory",
    displayName: "Ivory",
    family: "original",
    mode: "light",
    description: "Warm ivory light theme with charcoal text.",
    preview: { bg: "#f5f1e8", surface: "#ffffff", accent: "#6a4a2a" },
  },

  // -------------------------------------------------------------------
  // Elegant Neutrals (5)
  // -------------------------------------------------------------------
  {
    id: "dusk",
    displayName: "Dusk",
    family: "elegant",
    mode: "dark",
    description: "Plum-black twilight with rose accent.",
    preview: { bg: "#15101a", surface: "#1c1626", accent: "#d48ca3" },
  },
  {
    id: "slate",
    displayName: "Slate",
    family: "elegant",
    mode: "dark",
    description: "Cool slate with silver accent.",
    preview: { bg: "#12151a", surface: "#181c22", accent: "#b0bac7" },
  },
  {
    id: "parchment",
    displayName: "Parchment",
    family: "elegant",
    mode: "light",
    description: "Aged paper with sepia accent.",
    preview: { bg: "#f4ecd8", surface: "#fbf6e6", accent: "#8b6a3a" },
  },
  {
    id: "onyx",
    displayName: "Onyx",
    family: "elegant",
    mode: "dark",
    description: "Pure black with cool white accent.",
    preview: { bg: "#050506", surface: "#0d0d0f", accent: "#e0e4eb" },
  },
  {
    id: "fog",
    displayName: "Fog",
    family: "elegant",
    mode: "light",
    description: "Soft grey-white with quiet blue accent.",
    preview: { bg: "#ecedef", surface: "#ffffff", accent: "#4e6e96" },
  },

  // -------------------------------------------------------------------
  // Greens & Oranges (5)
  // -------------------------------------------------------------------
  {
    id: "forest",
    displayName: "Forest",
    family: "greens_oranges",
    mode: "dark",
    description: "Pine-black with moss green accent.",
    preview: { bg: "#0a120d", surface: "#0f1a14", accent: "#6aad7a" },
  },
  {
    id: "ember",
    displayName: "Ember",
    family: "greens_oranges",
    mode: "dark",
    description: "Char-black with burnt orange accent.",
    preview: { bg: "#120c08", surface: "#1a110b", accent: "#e07a3a" },
  },
  {
    id: "sage",
    displayName: "Sage",
    family: "greens_oranges",
    mode: "light",
    description: "Pale sage with olive accent.",
    preview: { bg: "#eef0e8", surface: "#f7f8f1", accent: "#6a7a4a" },
  },
  {
    id: "copper",
    displayName: "Copper",
    family: "greens_oranges",
    mode: "dark",
    description: "Deep bronze-black with copper accent.",
    preview: { bg: "#120a06", surface: "#1c1108", accent: "#c87642" },
  },
  {
    id: "verdant",
    displayName: "Verdant",
    family: "greens_oranges",
    mode: "light",
    description: "Cream white with deep emerald accent.",
    preview: { bg: "#f1f3ec", surface: "#ffffff", accent: "#2f7a4a" },
  },

  // -------------------------------------------------------------------
  // Blues & Greys (5)
  // -------------------------------------------------------------------
  {
    id: "steel",
    displayName: "Steel",
    family: "blues_greys",
    mode: "dark",
    description: "Gunmetal grey with steel blue accent.",
    preview: { bg: "#10131a", surface: "#171c24", accent: "#5b8db3" },
  },
  {
    id: "mercury",
    displayName: "Mercury",
    family: "blues_greys",
    mode: "dark",
    description: "Liquid silver-black with ice accent.",
    preview: { bg: "#0e1116", surface: "#141821", accent: "#89a9cf" },
  },
  {
    id: "arctic",
    displayName: "Arctic",
    family: "blues_greys",
    mode: "light",
    description: "Snow white with glacial blue accent.",
    preview: { bg: "#eff3f7", surface: "#ffffff", accent: "#3e6d9c" },
  },
  {
    id: "indigo",
    displayName: "Indigo",
    family: "blues_greys",
    mode: "dark",
    description: "Deep indigo with violet accent.",
    preview: { bg: "#0c0f22", surface: "#131634", accent: "#8c7aff" },
  },
  {
    id: "glacier",
    displayName: "Glacier",
    family: "blues_greys",
    mode: "light",
    description: "Pale blue-white with cobalt accent.",
    preview: { bg: "#eaf1f7", surface: "#f8fbfe", accent: "#1d5aa8" },
  },

  // -------------------------------------------------------------------
  // Mid-Tones (5)
  // -------------------------------------------------------------------
  {
    id: "bordeaux",
    displayName: "Bordeaux",
    family: "midtones",
    mode: "dark",
    description: "Wine-black with rose gold accent.",
    preview: { bg: "#13090c", surface: "#1c0e12", accent: "#c88a70" },
  },
  {
    id: "pewter",
    displayName: "Pewter",
    family: "midtones",
    mode: "dark",
    description: "Cool pewter grey with soft gold accent.",
    preview: { bg: "#15161a", surface: "#1e2026", accent: "#c7a86a" },
  },
  {
    id: "walnut",
    displayName: "Walnut",
    family: "midtones",
    mode: "dark",
    description: "Warm walnut brown with caramel accent.",
    preview: { bg: "#13100c", surface: "#1d1913", accent: "#c89360" },
  },
  {
    id: "denim",
    displayName: "Denim",
    family: "midtones",
    mode: "dark",
    description: "Worn denim blue with brass accent.",
    preview: { bg: "#10161f", surface: "#161e2a", accent: "#b89656" },
  },
  {
    id: "moss",
    displayName: "Moss",
    family: "midtones",
    mode: "dark",
    description: "Dark moss with copper accent.",
    preview: { bg: "#0e120d", surface: "#141a13", accent: "#b27b48" },
  },

  // -------------------------------------------------------------------
  // SF Light Optimised (6)
  // -------------------------------------------------------------------
  {
    id: "birch",
    displayName: "Birch",
    family: "sf_light",
    mode: "light",
    description: "Pale birch with forest green accent.",
    preview: { bg: "#f5f2e9", surface: "#fffefa", accent: "#3a6a4a" },
  },
  {
    id: "mist",
    displayName: "Mist",
    family: "sf_light",
    mode: "light",
    description: "Foggy white with dusty blue accent.",
    preview: { bg: "#eceef2", surface: "#fbfcfe", accent: "#5a7499" },
  },
  {
    id: "cashew",
    displayName: "Cashew",
    family: "sf_light",
    mode: "light",
    description: "Warm cream with terracotta accent.",
    preview: { bg: "#f4ece0", surface: "#fffcf4", accent: "#a8562e" },
  },
  {
    id: "mineral",
    displayName: "Mineral",
    family: "sf_light",
    mode: "light",
    description: "Cool stone white with charcoal accent.",
    preview: { bg: "#eef0f0", surface: "#fafcfc", accent: "#2c3e4a" },
  },
  {
    id: "blush",
    displayName: "Blush",
    family: "sf_light",
    mode: "light",
    description: "Soft blush with rose accent.",
    preview: { bg: "#f7ecec", surface: "#fffafa", accent: "#a0526a" },
  },
  {
    id: "chamois",
    displayName: "Chamois",
    family: "sf_light",
    mode: "light",
    description: "Buttery chamois with olive accent.",
    preview: { bg: "#f4efe2", surface: "#fffaec", accent: "#7a704a" },
  },

  // -------------------------------------------------------------------
  // Wealth Management (6)
  // -------------------------------------------------------------------
  {
    id: "bullion",
    displayName: "Bullion",
    family: "wealth",
    mode: "dark",
    institution: "Goldman Sachs / BlackRock",
    description: "Pure gold on black — the Wall Street reference.",
    preview: { bg: "#12100a", surface: "#1c180c", accent: "#d4a820" },
  },
  {
    id: "prussian",
    displayName: "Prussian",
    family: "wealth",
    mode: "dark",
    institution: "JP Morgan / Deutsche Bank",
    description: "Prussian blue with aged gold accent.",
    preview: { bg: "#0c1422", surface: "#13203a", accent: "#c8a060" },
  },
  {
    id: "coutts",
    displayName: "Coutts",
    family: "wealth",
    mode: "dark",
    institution: "Coutts / RBS Private",
    description: "Burgundy on ink with silver accent.",
    preview: { bg: "#0e0a10", surface: "#170e14", accent: "#b8a46a" },
  },
  {
    id: "vault",
    displayName: "Vault",
    family: "wealth",
    mode: "dark",
    institution: "UBS / Credit Suisse",
    description: "Deep vault-steel with platinum accent.",
    preview: { bg: "#0a0e10", surface: "#101418", accent: "#c2c9d1" },
  },
  {
    id: "endowment",
    displayName: "Endowment",
    family: "wealth",
    mode: "dark",
    institution: "Brown Brothers / Harvard Mgmt",
    description: "Forest green with brass accent.",
    preview: { bg: "#0a1210", surface: "#0f1a17", accent: "#b8975a" },
  },
  {
    id: "trust",
    displayName: "Trust",
    family: "wealth",
    mode: "dark",
    institution: "Northern Trust / Bessemer",
    description: "Oxblood on ink with old gold accent.",
    preview: { bg: "#0d0a0c", surface: "#180e10", accent: "#c0993a" },
  },

  // -------------------------------------------------------------------
  // Traditional Banking (6)
  // -------------------------------------------------------------------
  {
    id: "cobalt",
    displayName: "Cobalt",
    family: "traditional",
    mode: "dark",
    institution: "Chase / Citibank",
    description: "Classic cobalt on ink.",
    preview: { bg: "#081224", surface: "#0e1e36", accent: "#3379d9" },
  },
  {
    id: "heritage",
    displayName: "Heritage",
    family: "traditional",
    mode: "dark",
    institution: "Wells Fargo",
    description: "Burgundy + gold stagecoach heritage.",
    preview: { bg: "#100608", surface: "#1c0a0e", accent: "#e0b84a" },
  },
  {
    id: "civic",
    displayName: "Civic",
    family: "traditional",
    mode: "dark",
    institution: "US Bank / Truist",
    description: "Deep navy with civic blue accent.",
    preview: { bg: "#091224", surface: "#0e1b36", accent: "#4d84d4" },
  },
  {
    id: "cardinal",
    displayName: "Cardinal",
    family: "traditional",
    mode: "dark",
    institution: "Bank of America",
    description: "Cardinal red on ink — BofA brand anchor.",
    preview: { bg: "#0f0608", surface: "#1e0a10", accent: "#d43a4a" },
  },
  {
    id: "meridian",
    displayName: "Meridian",
    family: "traditional",
    mode: "dark",
    institution: "HSBC",
    description: "Crimson on ink with silver accent.",
    preview: { bg: "#0c0607", surface: "#180a0c", accent: "#cf3a3a" },
  },
  {
    id: "union",
    displayName: "Union",
    family: "traditional",
    mode: "dark",
    institution: "Union Bank / Capital One",
    description: "Navy-charcoal with royal blue accent.",
    preview: { bg: "#0a0d16", surface: "#11162a", accent: "#3e6ad4" },
  },
];

/** Lookup helper — used by the ThemeSwitcher and Demo Mode. */
export function getTheme(id: string): ThemeMeta | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_THEME_ID = "horizon-dark";
export const DEFAULT_LIGHT_THEME_ID = "ivory";

/** Family grouping for the switcher sheet. Order matters — this is the
 *  visual rhythm of the switcher. */
export const FAMILY_ORDER: ThemeFamily[] = [
  "original",
  "wealth",
  "traditional",
  "blues_greys",
  "greens_oranges",
  "midtones",
  "elegant",
  "sf_light",
];

export const FAMILY_LABELS: Record<ThemeFamily, string> = {
  original: "Original",
  elegant: "Elegant neutrals",
  greens_oranges: "Greens & oranges",
  blues_greys: "Blues & greys",
  midtones: "Mid-tones",
  sf_light: "SF Light optimised",
  wealth: "Wealth management",
  traditional: "Traditional banking",
};

/** The fixed 8-theme sequence used by Institution Demo Mode. */
export const INSTITUTION_DEMO_SEQUENCE: string[] = [
  "horizon-dark",
  "bullion",
  "prussian",
  "cobalt",
  "cardinal",
  "heritage",
  "trust",
  "horizon-dark",
];
