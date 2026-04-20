"use client";

import { useCallback, useEffect, useState } from "react";

const SECTION_SELECTOR = "[data-horizon-section]";

export type HorizonSectionId =
  | "brief"
  | "arc"
  | "priority"
  | "pulse"
  | "drafts"
  | "signals";

const PLACEHOLDER: Record<HorizonSectionId, string> = {
  brief: "Ask about your morning brief…",
  arc: "Ask about today’s timeline…",
  priority: "Ask about a priority client…",
  pulse: "Ask about portfolio KPIs…",
  drafts: "Ask about a drafted action…",
  signals: "Ask about live signals…",
};

export function useViewportSection(debounceMs = 140): {
  sectionId: HorizonSectionId | null;
  placeholder: string;
  contextLine: string | null;
} {
  const [sectionId, setSectionId] = useState<HorizonSectionId | null>(null);

  const compute = useCallback(() => {
    const nodes = document.querySelectorAll(SECTION_SELECTOR);
    if (!nodes.length) {
      setSectionId(null);
      return;
    }
    const mid = window.innerHeight * 0.38;
    let bestId: HorizonSectionId | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    nodes.forEach((el) => {
      const raw = el.getAttribute("data-horizon-section");
      if (!raw || !(raw in PLACEHOLDER)) return;
      const id = raw as HorizonSectionId;
      const r = el.getBoundingClientRect();
      const dist = Math.abs(r.top + r.height / 2 - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    });
    setSectionId(bestId);
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = undefined;
        compute();
      }, debounceMs);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [compute, debounceMs]);

  const placeholder =
    sectionId && PLACEHOLDER[sectionId]
      ? PLACEHOLDER[sectionId]
      : "Ask Horizon anything about your book… (⌘K)";

  const contextLine = sectionId
    ? `The banker is visually focused on the "${sectionId}" section of the home page.`
    : null;

  return { sectionId, placeholder, contextLine };
}
