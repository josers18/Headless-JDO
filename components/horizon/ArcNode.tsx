"use client";

import type { ArcNodePayload, ArcNodeType } from "@/types/horizon";
import { cn } from "@/lib/utils";

const typeStyles: Record<
  ArcNodeType,
  { shape: string; ring: string; label: string; fill?: string }
> = {
  event: {
    shape: "h-3.5 w-3.5 rounded-full",
    ring: "ring-2 ring-accent/40",
    fill: "bg-accent/85",
    label: "Event",
  },
  deadline: {
    shape: "h-2.5 w-2.5 rotate-45 rounded-[1px]",
    ring: "ring-1 ring-accent-warm/70",
    fill: "bg-accent-warm/80",
    label: "Deadline",
  },
  recommended: {
    shape: "h-3 w-3 rounded-full border-2 border-dashed border-emerald-400/70 bg-transparent",
    ring: "",
    fill: "bg-transparent",
    label: "Suggested",
  },
  blocked: {
    shape: "h-2 w-2 rounded-sm",
    ring: "ring-1 ring-text-muted/50",
    fill: "bg-text-muted/30",
    label: "Blocked",
  },
};

export function ArcNode({
  node,
  leftPct,
  selected,
  onSelect,
}: {
  node: ArcNodePayload;
  leftPct: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const st = typeStyles[node.type];
  const clamped = Math.min(96, Math.max(2, leftPct));

  return (
    <div
      className="absolute top-[38px] z-20 -translate-x-1/2"
      style={{ left: `${clamped}%` }}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "group flex flex-col items-center gap-1.5 rounded-md px-0.5 py-1 transition duration-med ease-out",
          selected && "scale-105"
        )}
        aria-pressed={selected}
        aria-label={`${st.label}: ${node.title}`}
      >
        <span
          className={cn(
            "flex items-center justify-center shadow-sm transition group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent/40",
            st.fill ?? "bg-surface2",
            st.shape,
            st.ring
          )}
        />
        <span className="max-w-[88px] text-center font-mono text-[9px] uppercase leading-tight tracking-tight text-text-muted group-hover:text-text/90">
          {node.title}
        </span>
      </button>
    </div>
  );
}
