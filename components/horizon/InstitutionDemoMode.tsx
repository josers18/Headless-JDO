"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/client/useTheme";
import {
  getTheme,
  INSTITUTION_DEMO_SEQUENCE,
  type ThemeMeta,
} from "@/lib/themes/registry";

/**
 * THEMES B-1 — Institution Demo Mode.
 *
 * Hidden trigger: ⌘/Ctrl + Shift + D cycles the app through 8 institution-
 * matched themes on a 2-second cadence for ~16 seconds total. Purpose-built
 * for the video architecture reveal: "The same Horizon, deployed for…".
 *
 * Press any key while running to abort. The mode snapshots the banker's
 * pre-demo theme and restores it at the end.
 */
export function InstitutionDemoMode() {
  const { theme, setThemeForced } = useTheme();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<ThemeMeta | null>(null);
  const savedThemeRef = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const trigger =
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "d" || e.key === "D");
      if (trigger) {
        e.preventDefault();
        start();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, running]);

  // Abort on any key while running.
  useEffect(() => {
    if (!running) return;
    function onAbort(e: KeyboardEvent) {
      if (e.key === "Escape" || !e.metaKey) {
        stop();
      }
    }
    window.addEventListener("keydown", onAbort);
    return () => window.removeEventListener("keydown", onAbort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  function start() {
    if (running) return;
    savedThemeRef.current = theme;
    setRunning(true);
    const step = 2000;
    INSTITUTION_DEMO_SEQUENCE.forEach((id, i) => {
      const t = setTimeout(() => {
        const meta = getTheme(id);
        if (!meta) return;
        setThemeForced(id);
        setCurrent(meta);
      }, i * step);
      timersRef.current.push(t);
    });
    const finalT = setTimeout(
      () => stop(),
      INSTITUTION_DEMO_SEQUENCE.length * step + 200
    );
    timersRef.current.push(finalT);
  }

  function stop() {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    if (savedThemeRef.current) {
      setThemeForced(savedThemeRef.current);
      savedThemeRef.current = null;
    }
    setRunning(false);
    setCurrent(null);
  }

  if (!running || !current) return null;
  return (
    <div
      className={cn(
        "pointer-events-none fixed right-6 top-6 z-[60] flex items-center gap-3 rounded-lg border border-border bg-surface/90 px-4 py-2.5 text-[12px] shadow-2xl backdrop-blur-md"
      )}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      <div className="min-w-0">
        {current.institution && (
          <div className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-text">
            {current.institution}
          </div>
        )}
        <div className="truncate text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {current.displayName} · press any key to stop
        </div>
      </div>
    </div>
  );
}
