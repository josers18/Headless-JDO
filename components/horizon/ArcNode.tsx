"use client";

import { useRef, useState } from "react";
import type { ArcNodePayload, ArcNodeType } from "@/types/horizon";
import { cn } from "@/lib/utils";
import { ARC_TRACK_LINE_PX } from "./ArcTimeline";

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

function titleShort(s: string): string {
  const w = s.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const all = s.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  return all.length > 3 ? `${w.join(" ")}…` : w.join(" ");
}

// "Focus window" / "Deadline" / "Meeting" make much cleaner axis tick
// labels than a 3-word truncation of a prose sentence — which often reads
// as "Clear afternoon to…" or "Open window to…" and wraps awkwardly at
// 92px. We use the node type to pick a short label for the axis caption;
// the full title + context is still shown in the hover tooltip and in the
// selected detail card below the timeline.
function axisLabelFor(type: string, title: string): string {
  switch (type) {
    case "recommended":
      return "Focus";
    case "deadline":
      return "Due";
    case "event":
      return titleShort(title) || "Meeting";
    case "blocked":
      return "Blocked";
    default:
      return titleShort(title);
  }
}

function oneLineContext(s: string, max = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function ArcNode({
  node,
  leftPct,
  selected,
  onActivate,
  onRescheduleIntent,
}: {
  node: ArcNodePayload;
  leftPct: number;
  selected: boolean;
  onActivate: () => void;
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
  const shortTitle = titleShort(node.title);
  const axisLabel = axisLabelFor(node.type, node.title);

  return (
    <div
      className="group pointer-events-auto absolute z-20"
      style={{
        left: `${clamped}%`,
        top: ARC_TRACK_LINE_PX,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className={cn(
          "pointer-events-none invisible absolute bottom-[calc(100%+10px)] left-1/2 z-40 w-max max-w-[min(240px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border-soft bg-surface2/95 px-3 py-2 text-left text-[11.5px] leading-snug text-text shadow-lg opacity-0 shadow-black/40 transition duration-fast",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        )}
        role="tooltip"
      >
        <span className="block font-medium text-text">{shortTitle}</span>
        <span className="mt-1 block text-text-muted">
          {oneLineContext(node.context)}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            return;
          }
          onActivate();
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
          "flex min-h-[44px] min-w-[44px] flex-col items-center gap-1 rounded-md px-0.5 py-1 transition duration-med ease-out md:min-h-0 md:min-w-0",
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
        <span className="max-w-[110px] whitespace-nowrap text-center font-mono text-[9px] uppercase leading-tight tracking-tight text-text-muted group-hover:text-text/90">
          {axisLabel}
        </span>
      </button>
    </div>
  );
}
