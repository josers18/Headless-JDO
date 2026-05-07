"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * SectionRail — fixed-position progress indicator on the left edge.
 *
 * Watches every <div data-horizon-section="..."> element on the page
 * via IntersectionObserver, highlights the one currently in view, and
 * lets the banker click any dot to jump there. Connected dots + line
 * give a "you've traveled" visual without taking real estate.
 *
 * Visible only at >=1280px so it doesn't fight the right-rail Signal
 * Feed at lg widths or compete with the sticky header on narrow.
 */

type Section = {
  id: string;
  label: string;
};

const SECTIONS: Section[] = [
  { id: "brief", label: "Morning brief" },
  { id: "arc", label: "Today's arc" },
  { id: "priority", label: "Priority queue" },
  { id: "pulse", label: "Portfolio pulse" },
  { id: "drafts", label: "Pre-drafted actions" },
  { id: "signals", label: "Live signals" },
];

export function SectionRail() {
  const [active, setActive] = useState<string>(SECTIONS[0]!.id);

  useEffect(() => {
    const sections = SECTIONS.map((s) =>
      document.querySelector<HTMLElement>(
        `[data-horizon-section="${s.id}"]`
      )
    ).filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    // Observe each section. The "active" section is the one whose top
    // edge is closest to (and at or above) the viewport's vertical
    // mid-line. We track every intersection event and recompute on
    // each, since IO doesn't directly answer "which one is most
    // visible right now."
    const visibility = new Map<string, number>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.getAttribute("data-horizon-section");
          if (!id) continue;
          visibility.set(id, e.intersectionRatio);
        }
        // Pick the most-visible section currently intersecting. Ties
        // break to whichever appears first in SECTIONS (the page
        // order), which keeps short sections from "stealing" focus
        // when scrolling fast.
        let best: { id: string; ratio: number } | null = null;
        for (const s of SECTIONS) {
          const r = visibility.get(s.id) ?? 0;
          if (r <= 0) continue;
          if (!best || r > best.ratio) best = { id: s.id, ratio: r };
        }
        if (best) setActive(best.id);
      },
      {
        // Bias the "active" zone toward the upper-middle of the
        // viewport so the dot updates as soon as a new section enters
        // from below — feels more responsive than waiting until it's
        // centered.
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const el of sections) io.observe(el);
    return () => io.disconnect();
  }, []);

  function jumpTo(id: string) {
    const el = document.querySelector<HTMLElement>(
      `[data-horizon-section="${id}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const activeIndex = SECTIONS.findIndex((s) => s.id === active);

  return (
    <nav
      aria-label="Section navigation"
      className="pointer-events-none fixed left-6 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
    >
      <ol className="pointer-events-auto relative flex flex-col gap-5">
        {/* Connecting line — drawn as a single absolute element behind
            the dots so it doesn't have to be threaded between list
            items. Total height matches the gap × (count - 1). */}
        <span
          aria-hidden
          className="absolute left-[5px] top-2 bottom-2 w-px bg-border-soft/60"
        />
        {/* Active progress segment that fills as we scroll deeper.
            Height is computed from active index. */}
        <span
          aria-hidden
          className="absolute left-[5px] top-2 w-px bg-accent/70 transition-[height] duration-med"
          style={{
            height:
              activeIndex <= 0
                ? "0px"
                : `calc((100% - 1rem) * ${activeIndex} / ${SECTIONS.length - 1})`,
          }}
        />
        {SECTIONS.map((s, i) => {
          const isActive = s.id === active;
          const isPassed = i < activeIndex;
          return (
            <li key={s.id} className="group relative flex items-center">
              <button
                type="button"
                onClick={() => jumpTo(s.id)}
                aria-label={`Jump to ${s.label}`}
                aria-current={isActive ? "true" : undefined}
                className="relative flex h-3 w-3 items-center justify-center"
              >
                <span
                  className={cn(
                    "block h-[11px] w-[11px] rounded-full border transition-all duration-med",
                    isActive &&
                      "border-accent bg-accent shadow-[0_0_0_4px_rgba(255,255,255,0.04),0_0_18px_rgba(255,255,255,0.18)]",
                    !isActive &&
                      isPassed &&
                      "border-accent/50 bg-accent/40",
                    !isActive &&
                      !isPassed &&
                      "border-border bg-bg group-hover:border-text-muted"
                  )}
                />
              </button>
              {/* Label sits to the right of the dot and fades in when
                  the section is active or the rail is hovered. We use
                  group-hover on the <li> so labels light up
                  individually rather than all-at-once. */}
              <span
                className={cn(
                  "pointer-events-none ml-3 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.18em] transition-opacity duration-med",
                  isActive
                    ? "text-text opacity-100"
                    : "text-text-muted opacity-0 group-hover:opacity-80"
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
