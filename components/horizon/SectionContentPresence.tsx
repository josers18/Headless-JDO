"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SectionKind } from "@/lib/prompts/section-insight";

/**
 * Lightweight cross-section "does this surface actually have content on
 * screen right now?" signal. Priority Queue, Portfolio Pulse, Pre-drafted
 * Actions, Live Signals each call `setSectionHasContent(section, true)`
 * once they successfully render rows/tiles/drafts/signals, and `false`
 * when they drop back to empty or error state.
 *
 * The SectionInsight banner consults this to suppress pessimistic copy
 * ("temporarily unavailable", "check back shortly") when the surface
 * below it is actually showing data — which happens when the insight
 * agent ran before the section's data agent finished, or when a
 * sub-query inside the insight turn failed even though the real section
 * agent recovered.
 */

export type SectionPresenceMap = Partial<Record<SectionKind, boolean>>;

type SectionPresenceContextValue = {
  has: SectionPresenceMap;
  setHas: (section: SectionKind, has: boolean) => void;
};

const Ctx = createContext<SectionPresenceContextValue | null>(null);

export function SectionContentPresenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [has, setState] = useState<SectionPresenceMap>({});

  const setHas = useCallback((section: SectionKind, next: boolean) => {
    setState((prev) => {
      if (prev[section] === next) return prev;
      return { ...prev, [section]: next };
    });
  }, []);

  const value = useMemo(() => ({ has, setHas }), [has, setHas]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSectionHasContent(
  section: SectionKind
): boolean | undefined {
  const ctx = useContext(Ctx);
  return ctx?.has[section];
}

export function useSectionContentReporter(
  section: SectionKind
): (has: boolean) => void {
  const ctx = useContext(Ctx);
  const noop = useCallback(() => {}, []);
  return ctx ? (next: boolean) => ctx.setHas(section, next) : noop;
}
