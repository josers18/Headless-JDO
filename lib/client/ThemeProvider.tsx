"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LIGHT_THEME_ID,
  DEFAULT_THEME_ID,
  getTheme,
} from "@/lib/themes/registry";

const LS_KEY = "hz-theme";

function resolveInitialTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored && getTheme(stored)) return stored;
  } catch {
    /* ignore */
  }
  if (window.matchMedia?.("(prefers-color-scheme: light)")?.matches) {
    return DEFAULT_LIGHT_THEME_ID;
  }
  return DEFAULT_THEME_ID;
}

export type ThemeContextValue = {
  theme: string;
  preview: string | null;
  ready: boolean;
  commit: (id: string) => void;
  startPreview: (id: string) => void;
  stopPreview: () => void;
  setThemeForced: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Single source of truth for `data-theme` on `<html>`. Must wrap the app
 * once (see `app/layout.tsx`). Applies with `useLayoutEffect` so the
 * attribute updates before paint.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<string>(DEFAULT_THEME_ID);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setTheme(resolveInitialTheme());
    setReady(true);
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const active = preview ?? theme;
    document.documentElement.setAttribute("data-theme", active);
  }, [theme, preview, ready]);

  const commit = useCallback((id: string) => {
    const meta = getTheme(id);
    if (!meta) return;
    try {
      window.localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
    setPreview(null);
    setTheme(id);
  }, []);

  const startPreview = useCallback((id: string) => {
    if (!getTheme(id)) return;
    setPreview(id);
  }, []);

  const stopPreview = useCallback(() => {
    setPreview(null);
  }, []);

  const setThemeForced = useCallback((id: string) => {
    if (!getTheme(id)) return;
    setPreview(null);
    setTheme(id);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      preview,
      ready,
      commit,
      startPreview,
      stopPreview,
      setThemeForced,
    }),
    [
      theme,
      preview,
      ready,
      commit,
      startPreview,
      stopPreview,
      setThemeForced,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
