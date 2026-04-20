"use client";

import { useRef, useState } from "react";
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
  onRescheduleIntent,
}: {
  node: ArcNodePayload;
  leftPct: number;
  selected: boolean;
  onSelect: () => void;
  /** Fires after a horizontal drag gesture (best-effort reschedule intent). */
  onRescheduleIntent?: (node: ArcNodePayload, deltaX: number) => void;
}) {
  const st = typeStyles[node.type];
  const clamped = Math.min(96, Math.max(2, leftPct));
  const [tx, setTx] = useState(0);
  const active = useRef(false);
  const startX = useRef(0);
  const lastDx = useRef(0);
  const suppressClick = useRef(false);

  return (
    <div
      className="absolute top-[38px] z-20 -translate-x-1/2"
      style={{ left: `${clamped}%` }}
    >
      <button
        type="button"
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            return;
          }
          onSelect();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          active.current = true;
          startX.current = e.clientX;
          lastDx.current = 0;
          setTx(0);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!active.current) return;
          const nx = Math.max(-56, Math.min(56, e.clientX - startX.current));
          lastDx.current = nx;
          setTx(nx);
        }}
        onPointerUp={(e) => {
          if (!active.current) return;
          active.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          const d = lastDx.current;
          setTx(0);
          if (Math.abs(d) > 26) {
            suppressClick.current = true;
            onRescheduleIntent?.(node, d);
          }
        }}
        onPointerCancel={(e) => {
          active.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          setTx(0);
        }}
        className={cn(
          "group flex min-h-[44px] min-w-[44px] flex-col items-center gap-1.5 rounded-md px-0.5 py-1 transition duration-med ease-out md:min-h-0 md:min-w-0",
          selected && "scale-105"
        )}
        style={{ transform: `translateX(${tx}px)` }}
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
