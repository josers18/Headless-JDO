"use client";

import { useCallback, useEffect, useState } from "react";
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

/**
 * useTheme — persists the active `data-theme` on <html>, with session
 * localStorage + system `prefers-color-scheme` fallback.
 *
 * Also exposes `preview(id)` so the switcher can live-preview a theme on
 * hover without committing to it. `commit(id)` persists + stops previewing.
 */
export function useTheme() {
  const [theme, setTheme] = useState<string>(DEFAULT_THEME_ID);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    setReady(true);
  }, []);

  useEffect(() => {
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
    const meta = getTheme(id);
    if (!meta) return;
    setPreview(id);
  }, []);

  const stopPreview = useCallback(() => {
    setPreview(null);
  }, []);

  return {
    theme,
    preview,
    ready,
    commit,
    startPreview,
    stopPreview,
    /** `setThemeForced` — bypasses persistence; used by Institution Demo Mode. */
    setThemeForced: (id: string) => {
      const meta = getTheme(id);
      if (!meta) return;
      setPreview(null);
      setTheme(id);
    },
  };
}
