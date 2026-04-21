"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PulseKpi } from "@/lib/client/pulseMetricHygiene";
import {
  classifyPulseTile,
  isZeroWinsTile,
  pulsePrimarySpec,
} from "@/lib/client/pulseTileModel";
import { sanitizeBankerFacingPulseCopy } from "@/lib/client/pulseCopySanitize";
import { dispatchAction } from "@/lib/client/actions/registry";

function DirectionBadge({
  direction,
}: {
  direction: PulseKpi["direction"];
}) {
  if (direction === "up") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
        <ArrowUpRight size={12} strokeWidth={2.4} />
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-400/15 text-red-300">
        <ArrowDownRight size={12} strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-text-muted">
      <Minus size={12} strokeWidth={2.4} />
    </span>
  );
}

export function PulseTile({
  kpi,
  index,
}: {
  kpi: PulseKpi;
  index: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const kind = classifyPulseTile(kpi);
  const primary = pulsePrimarySpec(kpi, kind);
  const zeroWins = isZeroWinsTile(kpi);
  const explanation = kpi.explanation
    ? sanitizeBankerFacingPulseCopy(kpi.explanation)
    : undefined;

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const dir = kpi.direction;
  const stagger =
    index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3";
  const directionTint =
    dir === "up"
      ? "from-emerald-400/25"
      : dir === "down"
        ? "from-red-400/25"
        : "from-accent/20";
  const deltaClass =
    dir === "up"
      ? "text-emerald-300"
      : dir === "down"
        ? "text-red-300"
        : "text-text-muted";

  const overflowExplain = () =>
    void dispatchAction({
      kind: "investigate",
      label: "Explain",
      question: `Explain ${kpi.label} (${kpi.value}, ${kpi.delta}) in banker terms — what moved and why it matters this week?`,
      context: `KPI: ${kpi.label} = ${kpi.value} (${kpi.delta})`,
    });

  return (
    <div
      className={cn(
        "group relative w-[min(88vw,280px)] shrink-0 snap-center animate-fade-rise overflow-hidden rounded-xl border border-border-soft bg-surface p-5 sm:w-auto sm:shrink",
        stagger
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent",
          directionTint
        )}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-card-sheen opacity-60"
        aria-hidden
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-[10px] uppercase tracking-[0.18em] text-text-muted">
            <span className="block truncate">{kpi.label}</span>
          </div>
          <DirectionBadge direction={dir} />
        </div>

        <div className="mt-3 font-display text-[30px] font-medium leading-none tracking-tight text-text md:text-[34px]">
          {kpi.value}
        </div>

        {kpi.delta !== "—" && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1.5 font-mono text-[11px]",
              deltaClass
            )}
          >
            {sanitizeBankerFacingPulseCopy(kpi.delta)}
          </div>
        )}

        {zeroWins && (
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            No wins in 30d — focus on what can still close this month.
          </p>
        )}

        {explanation && (
          <div className="mt-3 text-[12px] leading-snug text-text-muted">
            {explanation}
          </div>
        )}

        <div className="relative mt-4 flex items-center gap-2 border-t border-border-soft/40 pt-3">
          <button
            type="button"
            onClick={() =>
              void dispatchAction({
                kind: "investigate",
                label: primary.label,
                question: primary.question,
                context: primary.context,
              })
            }
            className="min-h-[44px] flex-1 rounded-md bg-accent/15 px-3 py-2 text-left text-[11px] font-medium text-accent transition hover:bg-accent/25 md:min-h-0"
          >
            {primary.label}
          </button>

          <div className="relative shrink-0" ref={wrapRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex size-9 items-center justify-center rounded-md text-text-muted transition hover:bg-surface2 hover:text-text"
              title="More actions"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute bottom-[calc(100%+6px)] right-0 z-20 w-[200px] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] sm:bottom-auto sm:top-[calc(100%+6px)]"
              >
                <OverflowItem
                  label="Explain"
                  onPick={() => {
                    setMenuOpen(false);
                    overflowExplain();
                  }}
                />
                <OverflowItem
                  label="Set target"
                  onPick={() => {
                    setMenuOpen(false);
                    void dispatchAction({
                      kind: "investigate",
                      label: "Set target",
                      question: `Help me set a personal book target for ${kpi.label} given current ${kpi.value}. One concrete target and how to track it weekly.`,
                      context: `KPI: ${kpi.label}`,
                    });
                  }}
                />
                <OverflowItem
                  label="View trend"
                  onPick={() => {
                    setMenuOpen(false);
                    void dispatchAction({
                      kind: "investigate",
                      label: "View trend",
                      question: `Narrate week-over-week trend for ${kpi.label} on my book (${kpi.value}). What is accelerating or decelerating?`,
                      context: `KPI: ${kpi.label}`,
                    });
                  }}
                />
                <OverflowItem
                  label="Share with manager"
                  onPick={() => {
                    setMenuOpen(false);
                    void dispatchAction({
                      kind: "investigate",
                      label: "Share with manager",
                      question: `Draft a 4-sentence manager update summarizing ${kpi.label} (${kpi.value}, ${kpi.delta}) and the one risk I want visibility on.`,
                      context: `KPI: ${kpi.label}`,
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverflowItem({
  label,
  onPick,
}: {
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className="flex w-full px-3 py-2.5 text-left text-[12px] text-text transition hover:bg-surface2"
    >
      {label}
    </button>
  );
}
